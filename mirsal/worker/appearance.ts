import type { Env } from './types';
import { HttpError } from './util';

export interface Wallpaper {
  id: string;
  name: string;
  /** A CSS background-image value (gradients only). */
  css: string;
}

const MAX_WALLPAPERS = 30;
const ID_RE = /^[a-z0-9-]{1,30}$/;
/**
 * The CSS value is placed inside one declaration, so block tokens, at-rules, comments,
 * url() loads (no third-party requests) and expression() are refused.
 */
const FORBIDDEN = /[{};<>\\@]|url\(|expression\(|\/\*/i;

export function sanitizeWallpapers(input: unknown): Wallpaper[] {
  if (!Array.isArray(input)) throw new HttpError(400, 'قائمة الخلفيات غير صالحة');
  if (input.length > MAX_WALLPAPERS) throw new HttpError(400, `الحد الأقصى ${MAX_WALLPAPERS} خلفية`);
  const seen = new Set<string>();
  return input.map((raw) => {
    const w = (raw ?? {}) as Record<string, unknown>;
    const id = typeof w.id === 'string' ? w.id.trim() : '';
    const name = typeof w.name === 'string' ? w.name.trim().slice(0, 40) : '';
    const css = typeof w.css === 'string' ? w.css.trim() : '';
    if (!ID_RE.test(id) || seen.has(id)) {
      throw new HttpError(400, 'معرّف الخلفية غير صالح أو مكرر (أحرف إنجليزية صغيرة وأرقام وشرطة فقط)');
    }
    if (!name) throw new HttpError(400, 'اسم الخلفية مطلوب');
    if (!css || css.length > 1500 || FORBIDDEN.test(css)) {
      throw new HttpError(400, `قيمة CSS غير صالحة في الخلفية ${id} (تدرجات فقط، بدون روابط أو أقواس معقدة)`);
    }
    seen.add(id);
    return { id, name, css };
  });
}

export async function readWallpapers(env: Env): Promise<Wallpaper[]> {
  const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'wallpapers'").first<{ value: string }>();
  if (!row) return [];
  try {
    return sanitizeWallpapers(JSON.parse(row.value));
  } catch {
    return [];
  }
}

export async function writeWallpapers(env: Env, list: Wallpaper[]): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES ('wallpapers', ?, ?) " +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
  )
    .bind(JSON.stringify(list), new Date().toISOString())
    .run();
}
