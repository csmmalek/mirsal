import type { Env } from './types';
import { HttpError } from './util';

export interface GoogleIdentity {
  /** Google's stable account id. Never changes, unlike the email. */
  sub: string;
  email: string;
  name: string;
}

/**
 * Verifies a Google ID token through Google's tokeninfo endpoint, which checks the signature and expiry.
 * The audience must be this app's client id, and Google must have verified the email.
 */
export async function verifyGoogleCredential(env: Env, credential: string): Promise<GoogleIdentity> {
  if (!env.GOOGLE_CLIENT_ID) throw new HttpError(503, 'تسجيل الدخول بـ Google غير مفعّل بعد، تواصل مع المطور');
  let res: Response;
  try {
    res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  } catch {
    throw new HttpError(502, 'تعذر الاتصال بـ Google، حاول بعد قليل');
  }
  if (!res.ok) throw new HttpError(401, 'تعذر التحقق من حساب Google، أعد المحاولة');
  const t = (await res.json()) as Record<string, string | undefined>;
  if (t.aud !== env.GOOGLE_CLIENT_ID) throw new HttpError(401, 'رمز Google لا يخص هذا التطبيق');
  if (t.iss !== 'accounts.google.com' && t.iss !== 'https://accounts.google.com') {
    throw new HttpError(401, 'رمز Google غير صالح');
  }
  if (t.email_verified !== 'true' || !t.email || !t.sub) throw new HttpError(403, 'بريد Google غير موثّق');
  return { sub: t.sub, email: t.email.trim().toLowerCase(), name: (t.name ?? '').slice(0, 40) };
}
