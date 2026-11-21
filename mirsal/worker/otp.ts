import type { Env } from './types';
import { sendMail } from './mailer';
import { HttpError, nowIso } from './util';

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

export function emailVerificationRequired(env: Env): boolean {
  // Off unless EMAIL_VERIFICATION=on is set: email codes need a verified sender, so they are not required by default.
  return env.EMAIL_VERIFICATION === 'on';
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

function randomCode(): string {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return String(n[0] % 1_000_000).padStart(6, '0');
}

/** Creates a 6-digit code for an email (not yet registered) and mails it. One code per email, 60s cooldown. */
export async function requestOtp(env: Env, email: string): Promise<void> {
  const row = await env.DB.prepare('SELECT created_at FROM email_otps WHERE email = ?').bind(email).first<{ created_at: string }>();
  if (row && Date.now() - Date.parse(row.created_at) < RESEND_COOLDOWN_MS) {
    throw new HttpError(429, 'انتظر دقيقة قبل طلب رمز جديد');
  }
  const code = randomCode();
  const hash = await sha256Hex(`${email}:${code}`);
  const now = nowIso();
  const expires = new Date(Date.now() + CODE_TTL_MS).toISOString();
  await env.DB.prepare(
    'INSERT INTO email_otps (email, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, 0, ?) ' +
      'ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, created_at = excluded.created_at'
  )
    .bind(email, hash, expires, now)
    .run();
  await sendMail(
    env,
    email,
    'رمز التحقق من مِرسال',
    `رمز التحقق الخاص بك: ${code}\n\nصالح لمدة 10 دقائق. إذا لم تطلب هذا الرمز فتجاهل هذه الرسالة.`
  );
}

/** Checks a code and consumes it on success. Throws Arabic HttpErrors on failure. */
export async function verifyOtp(env: Env, email: string, code: string): Promise<void> {
  const row = await env.DB.prepare('SELECT code_hash, expires_at, attempts FROM email_otps WHERE email = ?')
    .bind(email)
    .first<{ code_hash: string; expires_at: string; attempts: number }>();
  if (!row || row.expires_at <= nowIso()) throw new HttpError(400, 'الرمز منتهٍ أو غير موجود، اطلب رمزاً جديداً');
  if (row.attempts >= MAX_ATTEMPTS) throw new HttpError(429, 'تجاوزت عدد المحاولات، اطلب رمزاً جديداً');
  await env.DB.prepare('UPDATE email_otps SET attempts = attempts + 1 WHERE email = ?').bind(email).run();
  const hash = await sha256Hex(`${email}:${code}`);
  if (hash !== row.code_hash) throw new HttpError(400, 'الرمز غير صحيح');
  await env.DB.prepare('DELETE FROM email_otps WHERE email = ?').bind(email).run();
}
