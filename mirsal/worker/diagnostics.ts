import type { Env } from './types';
import { newId, nowIso } from './util';

/** Keep only the newest entries so the table stays small. */
const KEEP_ERRORS = 300;

/**
 * Records a server failure for the developer panel. Never throws: logging must not break a request.
 * Only the path, status and a short message are stored (no bodies, tokens or user data).
 */
export async function logError(env: Env, path: string, status: number, message: string): Promise<void> {
  try {
    await env.DB.prepare('INSERT INTO error_log (id, created_at, path, status, message) VALUES (?, ?, ?, ?, ?)')
      .bind(newId('err'), nowIso(), path.slice(0, 120), status, message.slice(0, 300))
      .run();
    await env.DB.prepare(
      'DELETE FROM error_log WHERE id NOT IN (SELECT id FROM error_log ORDER BY created_at DESC LIMIT ?)'
    )
      .bind(KEEP_ERRORS)
      .run();
  } catch {
    /* ignore: the request itself must still get its answer */
  }
}

export async function listErrors(env: Env, limit = 100): Promise<unknown[]> {
  const { results } = await env.DB.prepare(
    'SELECT id, created_at, path, status, message FROM error_log ORDER BY created_at DESC LIMIT ?'
  )
    .bind(Math.min(Math.max(limit, 1), 200))
    .all();
  return results;
}

export interface HealthCheck {
  name: string;
  ok: boolean;
  note: string;
}

/** Reports whether each required setting exists. Values are never returned, only yes/no. */
export async function healthChecks(env: Env): Promise<HealthCheck[]> {
  const checks: HealthCheck[] = [];

  try {
    await env.DB.prepare('SELECT 1 AS x').first();
    checks.push({ name: 'قاعدة البيانات', ok: true, note: 'متصلة' });
  } catch {
    checks.push({ name: 'قاعدة البيانات', ok: false, note: 'تعذر الاتصال بقاعدة البيانات' });
  }

  checks.push({
    name: 'تسجيل الدخول بـ Google',
    ok: Boolean(env.GOOGLE_CLIENT_ID),
    note: env.GOOGLE_CLIENT_ID ? 'معرّف العميل مضبوط' : 'أضف GOOGLE_CLIENT_ID في إعدادات Cloudflare',
  });

  checks.push({
    name: 'مفتاح إعداد المطور',
    ok: Boolean(env.ADMIN_SETUP_CODE),
    note: env.ADMIN_SETUP_CODE ? 'مضبوط' : 'أضف ADMIN_SETUP_CODE لحماية حساب المطور',
  });

  if (env.EMAIL_VERIFICATION === 'on') {
    const mailOk = Boolean(env.RESEND_API_KEY && env.MAIL_FROM);
    checks.push({
      name: 'إرسال رموز البريد',
      ok: mailOk,
      note: mailOk ? 'مفتاح الإرسال والمرسل مضبوطان' : 'التحقق بالبريد مفعّل لكن RESEND_API_KEY أو MAIL_FROM ناقص',
    });
  } else {
    checks.push({ name: 'إرسال رموز البريد', ok: true, note: 'التحقق بالبريد متوقف (لا يحتاج مزوّد بريد)' });
  }

  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM error_log WHERE status >= 500 AND created_at >= ?'
    )
      .bind(since)
      .first<{ n: number }>();
    const n = Number(row?.n ?? 0);
    checks.push({
      name: 'أخطاء الخادم (24 ساعة)',
      ok: n === 0,
      note: n === 0 ? 'لا توجد أخطاء' : `${n} خطأ، راجع تبويب الأخطاء`,
    });
  } catch {
    checks.push({ name: 'أخطاء الخادم (24 ساعة)', ok: false, note: 'تعذر قراءة سجل الأخطاء' });
  }

  return checks;
}
