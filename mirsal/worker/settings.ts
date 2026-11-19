import type { Env } from './types';
import { newId, nowIso, str } from './util';

/** إعدادات التطبيق التي يديرها المطور من لوحة التحكم. تُخزَّن في app_settings كقيمة JSON واحدة. */
export interface AppSettings {
  registrationOpen: boolean;
  announcement: string; // شريط إعلان يظهر لكل المستخدمين، فارغ = مخفي
  maintenance: boolean; // وضع الصيانة: يمنع الرسائل الجديدة ويعرض رسالة للمستخدمين
}

export const DEFAULT_SETTINGS: AppSettings = { registrationOpen: true, announcement: '', maintenance: false };

export async function readSettings(env: Env): Promise<AppSettings> {
  const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'app'").first<{ value: string }>();
  if (!row) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(row.value) as Partial<AppSettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function sanitizeSettings(input: unknown, current: AppSettings): AppSettings {
  const b = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  return {
    registrationOpen: typeof b.registrationOpen === 'boolean' ? b.registrationOpen : current.registrationOpen,
    announcement: typeof b.announcement === 'string' ? str(b.announcement, 300).trim() : current.announcement,
    maintenance: typeof b.maintenance === 'boolean' ? b.maintenance : current.maintenance,
  };
}

export async function writeSettings(env: Env, s: AppSettings): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES ('app', ?, ?) " +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
  )
    .bind(JSON.stringify(s), nowIso())
    .run();
}

/** سجل تدقيق: كل إجراء إداري يُكتب هنا (من، ماذا، على من، متى). لا يُحذف منه شيء. */
export async function writeAudit(env: Env, actorId: string, action: string, target: string | null, detail = ''): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO admin_audit (id, actor_id, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  )
    .bind(newId('aud'), actorId, action, target, detail.slice(0, 300), nowIso())
    .run();
}

export async function listAudit(env: Env, limit = 100): Promise<unknown[]> {
  const { results } = await env.DB.prepare(
    'SELECT a.id, a.action, a.target, a.detail, a.created_at, u.display_name AS actor_name ' +
      'FROM admin_audit a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC LIMIT ?'
  )
    .bind(Math.min(Math.max(limit, 1), 200))
    .all();
  return results;
}
