import type { AuthCtx, Env } from './types';
import { HttpError, newId, nowIso, randomToken, sha256Hex } from './util';

export const DEVICE_TYPES = ['web', 'android', 'desktop'] as const;
export type DeviceTypeName = (typeof DEVICE_TYPES)[number];

export function hashAuthSecret(salt: string, secret: string): Promise<string> {
  return sha256Hex(`${salt}:${secret}`);
}

export async function authenticateToken(env: Env, token: string): Promise<AuthCtx | null> {
  if (!token || token.length < 20 || token.length > 128) return null;
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare('SELECT id, user_id FROM devices WHERE token_hash = ?')
    .bind(tokenHash)
    .first<{ id: string; user_id: string }>();
  return row ? { userId: row.user_id, deviceId: row.id } : null;
}

export async function authenticateRequest(env: Env, req: Request): Promise<AuthCtx | null> {
  const header = req.headers.get('Authorization') || '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? authenticateToken(env, match[1]) : null;
}

export function requireAuth(auth: AuthCtx | null): AuthCtx {
  if (!auth) throw new HttpError(401, 'انتهت الجلسة، يرجى تسجيل الدخول من جديد');
  return auth;
}

export async function createDevice(
  env: Env,
  userId: string,
  name: string,
  type: string
): Promise<{ token: string; deviceId: string }> {
  const token = randomToken(32);
  const deviceId = newId('dev');
  const now = nowIso();
  const safeType: DeviceTypeName = (DEVICE_TYPES as readonly string[]).includes(type)
    ? (type as DeviceTypeName)
    : 'web';
  await env.DB.prepare(
    `INSERT INTO devices (id, user_id, token_hash, device_name, device_type, last_active, push_enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
  )
    .bind(deviceId, userId, await sha256Hex(token), name.slice(0, 80) || 'جهاز', safeType, now, now)
    .run();
  return { token, deviceId };
}

const MAX_FAILS = 8;
const WINDOW_MS = 10 * 60 * 1000;

export async function assertNotThrottled(env: Env, username: string): Promise<void> {
  const row = await env.DB.prepare('SELECT fails, window_start FROM login_attempts WHERE username = ?')
    .bind(username)
    .first<{ fails: number; window_start: number }>();
  if (row && Date.now() - row.window_start < WINDOW_MS && row.fails >= MAX_FAILS) {
    throw new HttpError(429, 'محاولات كثيرة خاطئة. حاول مجدداً بعد بضع دقائق');
  }
}

export async function recordLoginFailure(env: Env, username: string): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO login_attempts (username, fails, window_start) VALUES (?, 1, ?)
     ON CONFLICT(username) DO UPDATE SET
       fails = CASE WHEN ? - window_start >= ? THEN 1 ELSE fails + 1 END,
       window_start = CASE WHEN ? - window_start >= ? THEN ? ELSE window_start END`
  )
    .bind(username, now, now, WINDOW_MS, now, WINDOW_MS, now)
    .run();
}

export async function clearLoginFailures(env: Env, username: string): Promise<void> {
  await env.DB.prepare('DELETE FROM login_attempts WHERE username = ?').bind(username).run();
}
