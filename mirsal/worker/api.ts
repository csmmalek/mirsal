import type { AuthCtx, Env } from './types';
import {
  assertNotThrottled,
  clearLoginFailures,
  createDevice,
  hashAuthSecret,
  authenticateRequest,
  recordLoginFailure,
  requireAuth,
} from './auth';
import {
  getConversationsForUser,
  getMemberIds,
  isMember,
  mapDevice,
  mapMessage,
  mapNotification,
  mapUser,
} from './db';
import { broadcast, getOnlineUserIds, revokeDevice } from './realtime';
import { ensureSchema, newUid } from './schema';
import { isAdminEmail } from './admin';
import { readWallpapers, sanitizeWallpapers, writeWallpapers } from './appearance';
import { listAudit, readSettings, sanitizeSettings, writeAudit, writeSettings } from './settings';
import { HttpError, json, newId, nowIso, randomToken, readJson, str, timingSafeEqual } from './util';

interface Ctx {
  req: Request;
  env: Env;
  url: URL;
  params: string[];
  auth: AuthCtx | null;
}

type Handler = (ctx: Ctx) => Promise<Response>;

const B64_RE = /^[A-Za-z0-9+/=_-]+$/;
const MAX_CIPHERTEXT = 1_900_000; // D1 rows are limited to 2 MB
const MESSAGE_TYPES = ['text', 'image', 'audio', 'file', 'call'];

function validatePublicKey(raw: string): string {
  if (!raw || raw.length > 600) throw new HttpError(400, 'مفتاح التشفير العام غير صالح');
  try {
    const jwk = JSON.parse(raw) as { kty?: string; crv?: string; x?: string; y?: string };
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) throw new Error('bad');
  } catch {
    throw new HttpError(400, 'مفتاح التشفير العام غير صالح');
  }
  return raw;
}

function requireB64(v: unknown, label: string, max: number): string {
  const s = str(v, max + 1);
  if (!s || s.length > max || !B64_RE.test(s)) throw new HttpError(400, `${label} غير صالح`);
  return s;
}

/* ------------------------------ Auth ------------------------------ */

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

const register: Handler = async ({ req, env }) => {
  if (!(await readSettings(env)).registrationOpen) throw new HttpError(403, 'التسجيل مغلق حالياً');
  const b = await readJson(req);
  const email = str(b.email, 120).trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'يرجى إدخال بريد إلكتروني صحيح');
  const displayName = str(b.displayName, 40).trim() || email.split('@')[0];
  const handle = normalizeHandle(b.handle);
  const handleError = validateHandle(handle);
  if (handleError) throw new HttpError(400, handleError);
  if (await handleTaken(env, handle)) throw new HttpError(409, 'اسم المستخدم مستخدم مسبقاً، اختر اسماً آخر');
  const authSecret = requireB64(b.authSecret, 'كلمة المرور', 128);
  if (authSecret.length < 32) throw new HttpError(400, 'كلمة المرور غير صالحة');
  const publicKey = validatePublicKey(str(b.publicKey, 601));
  const encPriv = requireB64(b.encryptedPrivateKey, 'المفتاح الخاص', 4000);
  const encPrivIv = requireB64(b.privateKeyIv, 'متجه المفتاح', 64);

  // The developer email is reserved: emails are not verified, so claiming it needs the secret setup code.
  if (isAdminEmail(email)) {
    const code = str(b.setupCode, 200);
    if (!env.ADMIN_SETUP_CODE) {
      throw new HttpError(403, 'حساب المطور غير مفعّل بعد: أضف السر ADMIN_SETUP_CODE في إعدادات Cloudflare أولاً');
    }
    if (!timingSafeEqual(code, env.ADMIN_SETUP_CODE)) {
      throw new HttpError(403, 'رمز إعداد المطور غير صحيح');
    }
  }

  const taken = await env.DB.prepare('SELECT 1 AS x FROM users WHERE email = ?').bind(email).first();
  if (taken) throw new HttpError(409, 'هذا البريد مسجّل مسبقاً، سجّل الدخول بدلاً من ذلك');

  const id = newId('user');
  const salt = randomToken(16);
  const now = nowIso();
  let created = false;
  for (let attempt = 0; attempt < 4 && !created; attempt++) {
    const uid = await newUid(env.DB);
    try {
      await env.DB.prepare(
        `INSERT INTO users (id, username, display_name, bio, auth_salt, auth_hash, public_key,
                            enc_private_key, enc_private_iv, last_seen, created_at, email, uid, handle)
         VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(id, `m${uid}`, displayName, salt, await hashAuthSecret(salt, authSecret), publicKey, encPriv, encPrivIv, now, now, email, uid, handle)
        .run();
      created = true;
    } catch {
      const again = await env.DB.prepare('SELECT 1 AS x FROM users WHERE email = ?').bind(email).first();
      if (again) throw new HttpError(409, 'هذا البريد مسجّل مسبقاً، سجّل الدخول بدلاً من ذلك');
      if (await handleTaken(env, handle)) throw new HttpError(409, 'اسم المستخدم مستخدم مسبقاً، اختر اسماً آخر');
    }
  }
  if (!created) throw new HttpError(500, 'تعذر إنشاء الحساب، حاول مرة أخرى');

  const { token, deviceId } = await createDevice(env, id, str(b.deviceName, 80), str(b.deviceType, 20));
  const row = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<Record<string, unknown>>();
  return json({ user: mapUser(row!, new Set([id]), true), token, deviceId });
};

const login: Handler = async ({ req, env }) => {
  const b = await readJson(req);
  // New accounts sign in with their email; accounts created before email login keep their old username.
  const identifier = str(b.identifier ?? b.username, 120).trim().toLowerCase();
  const authSecret = str(b.authSecret, 129);
  if (!identifier || !authSecret || authSecret.length > 128) throw new HttpError(400, 'يرجى إدخال البريد الإلكتروني وكلمة المرور');

  await assertNotThrottled(env, identifier);
  const row = await env.DB.prepare('SELECT * FROM users WHERE email = ? OR username = ?')
    .bind(identifier, identifier)
    .first<Record<string, unknown>>();
  const expected = row ? String(row.auth_hash) : '0'.repeat(64);
  const actual = await hashAuthSecret(row ? String(row.auth_salt) : 'x', authSecret);
  if (!row || !timingSafeEqual(expected, actual)) {
    await recordLoginFailure(env, identifier);
    throw new HttpError(401, 'البريد الإلكتروني أو كلمة المرور غير صحيحة');
  }
  if (Number(row.banned) === 1) throw new HttpError(403, 'تم إيقاف هذا الحساب. تواصل مع المطور');
  await clearLoginFailures(env, identifier);

  const { token, deviceId } = await createDevice(env, String(row.id), str(b.deviceName, 80), str(b.deviceType, 20));
  const online = await getOnlineUserIds(env);
  return json({
    user: mapUser(row, online, true),
    token,
    deviceId,
    encryptedPrivateKey: String(row.enc_private_key),
    privateKeyIv: String(row.enc_private_iv),
  });
};

const logout: Handler = async ({ env, auth }) => {
  const a = requireAuth(auth);
  await env.DB.prepare('DELETE FROM devices WHERE id = ? AND user_id = ?').bind(a.deviceId, a.userId).run();
  await revokeDevice(env, a.userId, a.deviceId);
  return json({ ok: true });
};

const me: Handler = async ({ env, auth }) => {
  const a = requireAuth(auth);
  const row = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(a.userId).first<Record<string, unknown>>();
  if (!row) throw new HttpError(401, 'الحساب غير موجود');
  await env.DB.prepare('UPDATE devices SET last_active = ? WHERE id = ?').bind(nowIso(), a.deviceId).run();
  return json({ user: mapUser(row, await getOnlineUserIds(env), true), deviceId: a.deviceId });
};


const MAX_AVATAR_CHARS = 90_000; // ~65 KB image; the client sends a 256px JPEG of roughly 15-30 KB
const AVATAR_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;

const putAvatar: Handler = async ({ req, env, auth }) => {
  const a = requireAuth(auth);
  const b = await readJson(req);
  const avatar = typeof b.avatar === 'string' ? b.avatar : '';
  if (!avatar) throw new HttpError(400, 'لم يتم إرسال صورة');
  if (avatar.length > MAX_AVATAR_CHARS) throw new HttpError(413, 'الصورة كبيرة جداً، اختر صورة أصغر');
  if (!AVATAR_RE.test(avatar)) throw new HttpError(415, 'نوع الصورة غير مدعوم، استخدم JPG أو PNG أو WebP');
  await env.DB.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').bind(avatar, a.userId).run();
  const row = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(a.userId).first<Record<string, unknown>>();
  if (!row) throw new HttpError(401, 'الحساب غير موجود');
  return json({ user: mapUser(row, await getOnlineUserIds(env), true) });
};

const deleteAvatar: Handler = async ({ env, auth }) => {
  const a = requireAuth(auth);
  await env.DB.prepare('UPDATE users SET avatar_url = NULL WHERE id = ?').bind(a.userId).run();
  const row = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(a.userId).first<Record<string, unknown>>();
  if (!row) throw new HttpError(401, 'الحساب غير موجود');
  return json({ user: mapUser(row, await getOnlineUserIds(env), true) });
};


const getPublicSettings: Handler = async ({ env }) => {
  const s = await readSettings(env);
  return json({ registrationOpen: s.registrationOpen, announcement: s.announcement, maintenance: s.maintenance });
};

const adminGetSettings: Handler = async ({ env, auth }) => {
  await requireAdmin(env, auth);
  return json({ settings: await readSettings(env) });
};

const adminPutSettings: Handler = async ({ req, env, auth }) => {
  const a = await requireAdmin(env, auth);
  const current = await readSettings(env);
  const next = sanitizeSettings(await readJson(req), current);
  await writeSettings(env, next);
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== current[k]);
  if (changed.length) await writeAudit(env, a.userId, 'settings.update', null, changed.join(','));
  return json({ settings: next });
};

const adminListAudit: Handler = async ({ env, auth, url }) => {
  await requireAdmin(env, auth);
  const limit = Number(new URL(url).searchParams.get('limit') ?? 100);
  return json({ entries: await listAudit(env, limit) });
};

const HANDLE_RE = /^[a-z][a-z0-9_]{2,19}$/;
const RESERVED_HANDLES = new Set(['admin', 'administrator', 'root', 'system', 'support', 'mirsal', 'moderator', 'help', 'official']);

function normalizeHandle(raw: unknown): string {
  return str(raw, 40).trim().toLowerCase().replace(/^@/, '');
}

function validateHandle(handle: string): string | null {
  if (!HANDLE_RE.test(handle)) return 'اسم المستخدم من 3 إلى 20 حرفاً: أحرف إنجليزية صغيرة وأرقام وشرطة سفلية، ويبدأ بحرف';
  if (RESERVED_HANDLES.has(handle)) return 'اسم المستخدم هذا محجوز';
  return null;
}

async function handleTaken(env: Env, handle: string): Promise<boolean> {
  return !!(await env.DB.prepare('SELECT 1 AS x FROM users WHERE handle = ?').bind(handle).first());
}

const checkHandle: Handler = async ({ env, url }) => {
  const handle = normalizeHandle(url.searchParams.get('h'));
  const invalid = validateHandle(handle);
  if (invalid) return json({ available: false, reason: invalid });
  if (await handleTaken(env, handle)) return json({ available: false, reason: 'اسم المستخدم مستخدم مسبقاً' });
  return json({ available: true });
};

const setHandle: Handler = async ({ req, env, auth }) => {
  const a = requireAuth(auth);
  const handle = normalizeHandle((await readJson(req)).handle);
  const invalid = validateHandle(handle);
  if (invalid) throw new HttpError(400, invalid);
  const current = await env.DB.prepare('SELECT handle FROM users WHERE id = ?').bind(a.userId).first<{ handle: string | null }>();
  if (!current) throw new HttpError(401, 'الحساب غير موجود');
  if (current.handle) throw new HttpError(409, 'لا يمكن تغيير اسم المستخدم بعد تحديده');
  if (await handleTaken(env, handle)) throw new HttpError(409, 'اسم المستخدم مستخدم مسبقاً');
  try {
    await env.DB.prepare('UPDATE users SET handle = ? WHERE id = ? AND handle IS NULL').bind(handle, a.userId).run();
  } catch {
    throw new HttpError(409, 'اسم المستخدم مستخدم مسبقاً');
  }
  const row = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(a.userId).first<Record<string, unknown>>();
  return json({ user: mapUser(row!, await getOnlineUserIds(env), true) });
};

/* ------------------------------ Users ------------------------------ */

const searchUsers: Handler = async ({ env, auth, url }) => {
  const a = requireAuth(auth);
  // البحث بالمعرّف الرقمي (5 أرقام) أو باسم المستخدم الكامل فقط، ولا بحث بالاسم أو البريد.
  const q = (url.searchParams.get('q') || '').trim().toLowerCase().replace(/^[#@]/, '').slice(0, 40);
  if (q.length < 3) return json({ users: [] });
  const { results } = await env.DB.prepare(
    `SELECT * FROM users
     WHERE id != ? AND banned = 0 AND (uid = ? OR handle = ?)
       AND id NOT IN (SELECT blocker_id FROM user_blocks WHERE blocked_id = ?)
     LIMIT 5`
  )
    .bind(a.userId, q, q, a.userId)
    .all<Record<string, unknown>>();
  const online = await getOnlineUserIds(env);
  return json({ users: results.map((r) => mapUser(r, online)) });
};

/* -------------------------- Conversations -------------------------- */

const listConversations: Handler = async ({ env, auth }) => {
  const a = requireAuth(auth);
  const online = await getOnlineUserIds(env);
  return json({ conversations: await getConversationsForUser(env.DB, a.userId, online) });
};

const getConversation: Handler = async ({ env, auth, params }) => {
  const a = requireAuth(auth);
  const online = await getOnlineUserIds(env);
  const [conversation] = await getConversationsForUser(env.DB, a.userId, online, params[0]);
  if (!conversation) throw new HttpError(404, 'المحادثة غير موجودة');
  return json({ conversation });
};

const createConversation: Handler = async ({ req, env, auth }) => {
  const a = requireAuth(auth);
  const b = await readJson(req);
  const rawMembers = Array.isArray(b.memberIds) ? b.memberIds.map((x) => str(x, 64)).filter(Boolean) : [];
  const others = Array.from(new Set(rawMembers)).filter((id) => id !== a.userId);
  if (others.length === 0) throw new HttpError(400, 'يرجى اختيار جهة اتصال واحدة على الأقل');
  if (others.length > 49) throw new HttpError(400, 'الحد الأقصى 50 عضواً في المجموعة');
  const title = str(b.title, 60).trim();
  const isGroup = others.length > 1 || Boolean(title);
  const allIds = [a.userId, ...others];

  const placeholders = allIds.map(() => '?').join(',');
  const { results: found } = await env.DB.prepare(`SELECT id FROM users WHERE id IN (${placeholders})`)
    .bind(...allIds)
    .all<{ id: string }>();
  if (found.length !== allIds.length) throw new HttpError(400, 'أحد الأعضاء غير موجود');

  for (const other of others) {
    if (await blockedEither(env, a.userId, other)) throw new HttpError(403, 'لا يمكنك مراسلة هذا المستخدم');
  }

  const online = await getOnlineUserIds(env);

  if (!isGroup) {
    const existing = await env.DB.prepare(
      `SELECT c.id FROM conversations c
       JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = ?
       JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = ?
       WHERE c.type = 'direct' LIMIT 1`
    )
      .bind(a.userId, others[0])
      .first<{ id: string }>();
    if (existing) {
      const [conversation] = await getConversationsForUser(env.DB, a.userId, online, existing.id);
      return json({ conversation });
    }
  }

  const keyList = Array.isArray(b.keys) ? (b.keys as Array<Record<string, unknown>>) : [];
  const keyByUser = new Map<string, { wrappedKey: string; iv: string }>();
  for (const k of keyList) {
    keyByUser.set(str(k?.userId, 64), {
      wrappedKey: requireB64(k?.wrappedKey, 'مفتاح المحادثة', 400),
      iv: requireB64(k?.iv, 'متجه المفتاح', 64),
    });
  }
  for (const id of allIds) {
    if (!keyByUser.has(id)) throw new HttpError(400, 'مفاتيح التشفير ناقصة');
  }

  const convId = newId('conv');
  const now = nowIso();
  const stmts = [
    env.DB.prepare(
      'INSERT INTO conversations (id, type, title, created_by, last_message_id, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)'
    ).bind(convId, isGroup ? 'group' : 'direct', isGroup ? title || 'مجموعة جديدة' : 'محادثة مباشرة', a.userId, now, now),
    ...allIds.map((uid) => {
      const k = keyByUser.get(uid)!;
      return env.DB.prepare(
        `INSERT INTO conversation_members (conversation_id, user_id, role, unread_count, wrapped_key, wrap_iv, wrapped_by)
         VALUES (?, ?, ?, 0, ?, ?, ?)`
      ).bind(convId, uid, uid === a.userId ? 'admin' : 'member', k.wrappedKey, k.iv, a.userId);
    }),
  ];
  await env.DB.batch(stmts);

  await broadcast(env, [{ userIds: allIds, payload: { type: 'conversation:updated', conversationId: convId } }], [convId]);
  const [conversation] = await getConversationsForUser(env.DB, a.userId, online, convId);
  return json({ conversation });
};

const listMessages: Handler = async ({ env, auth, params, url }) => {
  const a = requireAuth(auth);
  const convId = params[0];
  if (!(await isMember(env.DB, convId, a.userId))) throw new HttpError(403, 'غير مصرح');
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 150, 1), 300);
  const before = url.searchParams.get('before');
  const { results } = await env.DB.prepare(
    `SELECT * FROM (
       SELECT m.*, u.display_name AS sender_name FROM messages m
       LEFT JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = ? ${before ? 'AND m.created_at < ?' : ''}
         AND m.id NOT IN (SELECT message_id FROM message_hidden WHERE user_id = ?)
         AND m.created_at > COALESCE((SELECT hidden_at FROM conversation_members WHERE conversation_id = m.conversation_id AND user_id = ?), '')
       ORDER BY m.created_at DESC LIMIT ?
     ) ORDER BY created_at ASC`
  )
    .bind(...(before ? [convId, before, a.userId, a.userId, limit] : [convId, a.userId, a.userId, limit]))
    .all<Record<string, unknown>>();
  return json({ messages: results.map(mapMessage) });
};

function notificationSummary(type: string): string {
  switch (type) {
    case 'image':
      return 'أرسل صورة مشفرة';
    case 'audio':
      return 'أرسل رسالة صوتية';
    case 'file':
      return 'أرسل ملفاً مرفقاً';
    case 'call':
      return 'سجل مكالمة مشفرة';
    default:
      return 'رسالة مشفرة جديدة';
  }
}

const sendMessage: Handler = async ({ req, env, auth, params }) => {
  const a = requireAuth(auth);
  if ((await readSettings(env)).maintenance) throw new HttpError(503, 'التطبيق في وضع الصيانة، حاول لاحقاً');
  const convId = params[0];
  const b = await readJson(req);
  const id = str(b.id, 60);
  const type = str(b.type, 10);
  const ciphertext = str(b.ciphertext, MAX_CIPHERTEXT + 1);
  const iv = str(b.iv, 40);
  if (!/^msg_[a-z0-9_]{6,48}$/.test(id)) throw new HttpError(400, 'معرف الرسالة غير صالح');
  if (!MESSAGE_TYPES.includes(type)) throw new HttpError(400, 'نوع الرسالة غير صالح');
  if (ciphertext.length > MAX_CIPHERTEXT) {
    throw new HttpError(413, 'الرسالة كبيرة جداً (الحد الأقصى نحو 1 ميغابايت للمرفق)');
  }
  if (!ciphertext || !B64_RE.test(ciphertext)) throw new HttpError(400, 'نص التشفير غير صالح');
  if (!iv || !B64_RE.test(iv)) throw new HttpError(400, 'متجه التشفير غير صالح');

  const memberIds = await getMemberIds(env.DB, convId);
  if (!memberIds.includes(a.userId)) throw new HttpError(403, 'غير مصرح');
  const convType = await env.DB.prepare('SELECT type FROM conversations WHERE id = ?').bind(convId).first<{ type: string }>();
  if (convType?.type === 'direct') {
    const other = memberIds.find((m) => m !== a.userId);
    if (other && (await blockedEither(env, a.userId, other))) throw new HttpError(403, 'لا يمكنك مراسلة هذا المستخدم');
  }

  const existing = await env.DB.prepare(
    'SELECT m.*, u.display_name AS sender_name FROM messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.id = ?'
  )
    .bind(id)
    .first<Record<string, unknown>>();
  if (existing) {
    if (String(existing.sender_id) !== a.userId || String(existing.conversation_id) !== convId) {
      throw new HttpError(409, 'معرف الرسالة مستخدم');
    }
    return json({ message: mapMessage(existing) });
  }

  const online = await getOnlineUserIds(env);
  const recipients = memberIds.filter((m) => m !== a.userId);
  const status = recipients.some((m) => online.has(m)) ? 'delivered' : 'sent';
  const now = nowIso();

  const sender = await env.DB.prepare('SELECT display_name FROM users WHERE id = ?')
    .bind(a.userId)
    .first<{ display_name: string }>();
  const senderName = sender?.display_name || 'مستخدم مِرسال';
  const summary = notificationSummary(type);
  const purgeBefore = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const notifications = recipients.map((uid) => ({
    id: newId('notif'),
    userId: uid,
    title: senderName,
    body: summary,
    conversationId: convId,
    isRead: false,
    createdAt: now,
  }));

  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO messages (id, conversation_id, sender_id, type, ciphertext, iv, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, convId, a.userId, type, ciphertext, iv, status, now),
    env.DB.prepare('UPDATE conversations SET updated_at = ?, last_message_id = ? WHERE id = ?').bind(now, id, convId),
    env.DB.prepare(
      'UPDATE conversation_members SET unread_count = unread_count + 1 WHERE conversation_id = ? AND user_id != ?'
    ).bind(convId, a.userId),
    ...notifications.map((n) =>
      env.DB.prepare(
        'INSERT INTO notifications (id, user_id, title, body, conversation_id, is_read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
      ).bind(n.id, n.userId, n.title, n.body, n.conversationId, n.createdAt)
    ),
    ...recipients.map((uid) =>
      env.DB.prepare('DELETE FROM notifications WHERE user_id = ? AND created_at < ?').bind(uid, purgeBefore)
    ),
  ]);

  const message = mapMessage({
    id,
    conversation_id: convId,
    sender_id: a.userId,
    sender_name: senderName,
    type,
    ciphertext,
    iv,
    status,
    created_at: now,
  });

  await broadcast(env, [
    { userIds: memberIds, payload: { type: 'message:new', message } },
    ...notifications.map((n) => ({ userIds: [n.userId], payload: { type: 'notification:push', notification: n } })),
  ]);

  return json({ message });
};

const EDIT_WINDOW_MS = 15 * 60 * 1000;
const DELETE_ALL_WINDOW_MS = 48 * 3_600_000;

async function loadMessageForMember(env: Env, messageId: string, userId: string): Promise<Record<string, unknown>> {
  const row = await env.DB.prepare(
    'SELECT m.*, u.display_name AS sender_name FROM messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.id = ?'
  )
    .bind(messageId)
    .first<Record<string, unknown>>();
  if (!row || !(await isMember(env.DB, String(row.conversation_id), userId))) throw new HttpError(404, 'الرسالة غير موجودة');
  return row;
}

const editMessage: Handler = async ({ req, env, auth, params }) => {
  const a = requireAuth(auth);
  const row = await loadMessageForMember(env, params[0], a.userId);
  if (String(row.sender_id) !== a.userId) throw new HttpError(403, 'يمكنك تعديل رسائلك فقط');
  if (row.deleted_at) throw new HttpError(409, 'هذه الرسالة محذوفة');
  if (String(row.type) !== 'text') throw new HttpError(400, 'يمكن تعديل الرسائل النصية فقط');
  if (Date.now() - Date.parse(String(row.created_at)) > EDIT_WINDOW_MS) {
    throw new HttpError(403, 'انتهت مهلة التعديل (15 دقيقة من الإرسال)');
  }
  const b = await readJson(req);
  const ciphertext = str(b.ciphertext, MAX_CIPHERTEXT + 1);
  const iv = str(b.iv, 40);
  if (ciphertext.length > MAX_CIPHERTEXT) throw new HttpError(413, 'الرسالة كبيرة جداً');
  if (!ciphertext || !B64_RE.test(ciphertext)) throw new HttpError(400, 'نص التشفير غير صالح');
  if (!iv || !B64_RE.test(iv)) throw new HttpError(400, 'متجه التشفير غير صالح');

  const editedAt = nowIso();
  await env.DB.prepare('UPDATE messages SET ciphertext = ?, iv = ?, edited_at = ? WHERE id = ?')
    .bind(ciphertext, iv, editedAt, params[0])
    .run();
  const message = mapMessage({ ...row, ciphertext, iv, edited_at: editedAt });
  const memberIds = await getMemberIds(env.DB, String(row.conversation_id));
  await broadcast(env, [{ userIds: memberIds, payload: { type: 'message:edited', message } }]);
  return json({ message });
};

const deleteMessage: Handler = async ({ env, auth, params, url }) => {
  const a = requireAuth(auth);
  const scope = url.searchParams.get('scope') === 'all' ? 'all' : 'me';
  const row = await loadMessageForMember(env, params[0], a.userId);
  const convId = String(row.conversation_id);

  if (scope === 'me') {
    await env.DB.prepare('INSERT OR IGNORE INTO message_hidden (message_id, user_id, hidden_at) VALUES (?, ?, ?)')
      .bind(params[0], a.userId, nowIso())
      .run();
    await broadcast(env, [{ userIds: [a.userId], payload: { type: 'message:hidden', conversationId: convId, messageId: params[0] } }]);
    return json({ ok: true, scope });
  }

  if (String(row.sender_id) !== a.userId) throw new HttpError(403, 'يمكنك الحذف للجميع لرسائلك فقط');
  if (!row.deleted_at) {
    if (Date.now() - Date.parse(String(row.created_at)) > DELETE_ALL_WINDOW_MS) {
      throw new HttpError(403, 'انتهت مهلة الحذف للجميع (48 ساعة من الإرسال)');
    }
    await env.DB.prepare("UPDATE messages SET deleted_at = ?, ciphertext = '', iv = '' WHERE id = ?")
      .bind(nowIso(), params[0])
      .run();
  }
  const memberIds = await getMemberIds(env.DB, convId);
  await broadcast(env, [{ userIds: memberIds, payload: { type: 'message:deleted', conversationId: convId, messageId: params[0] } }]);
  return json({ ok: true, scope });
};

/* ------------------------------ Blocks ------------------------------ */

async function blockedEither(env: Env, x: string, y: string): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT 1 AS b FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)'
  )
    .bind(x, y, y, x)
    .first();
  return Boolean(row);
}

const listBlocks: Handler = async ({ env, auth }) => {
  const a = requireAuth(auth);
  const { results } = await env.DB.prepare(
    'SELECT u.* FROM user_blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ? ORDER BY b.created_at DESC'
  )
    .bind(a.userId)
    .all<Record<string, unknown>>();
  const online = await getOnlineUserIds(env);
  return json({ users: results.map((r) => mapUser(r, online)) });
};

const blockUser: Handler = async ({ req, env, auth }) => {
  const a = requireAuth(auth);
  const target = str((await readJson(req)).userId, 64);
  if (!target || target === a.userId) throw new HttpError(400, 'لا يمكنك حظر نفسك');
  const exists = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(target).first<{ email: string | null }>();
  if (!exists) throw new HttpError(404, 'المستخدم غير موجود');
  if (isAdminEmail(exists.email)) throw new HttpError(400, 'لا يمكن حظر حساب المطور');
  await env.DB.prepare('INSERT OR IGNORE INTO user_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)')
    .bind(a.userId, target, nowIso())
    .run();
  return json({ ok: true });
};

const unblockUser: Handler = async ({ env, auth, params }) => {
  const a = requireAuth(auth);
  await env.DB.prepare('DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?').bind(a.userId, params[0]).run();
  return json({ ok: true });
};

/* ------------------------------ Profile ------------------------------ */

const patchMe: Handler = async ({ req, env, auth }) => {
  const a = requireAuth(auth);
  const b = await readJson(req);
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (typeof b.displayName === 'string') {
    const name = str(b.displayName, 40).trim();
    if (name.length < 2) throw new HttpError(400, 'الاسم يجب أن يكون حرفين على الأقل');
    sets.push('display_name = ?');
    vals.push(name);
  }
  if (typeof b.bio === 'string') {
    sets.push('bio = ?');
    vals.push(str(b.bio, 140).trim());
  }
  if (b.statusPrivacy !== undefined) {
    if (b.statusPrivacy !== 'contacts' && b.statusPrivacy !== 'nobody') throw new HttpError(400, 'خيار خصوصية الحالات غير صالح');
    sets.push('status_privacy = ?');
    vals.push(b.statusPrivacy);
  }
  if (sets.length === 0) throw new HttpError(400, 'لا توجد تغييرات');
  await env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, a.userId).run();
  const row = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(a.userId).first<Record<string, unknown>>();
  if (!row) throw new HttpError(401, 'الحساب غير موجود');
  const contacts = await getContactIds(env, a.userId);
  if (contacts.length) await broadcast(env, [{ userIds: contacts, payload: { type: 'status:updated', userId: a.userId } }], []);
  return json({ user: mapUser(row, await getOnlineUserIds(env), true) });
};

const deleteMe: Handler = async ({ req, env, auth }) => {
  const a = requireAuth(auth);
  const authSecret = str((await readJson(req)).authSecret, 129);
  const row = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(a.userId).first<Record<string, unknown>>();
  if (!row) throw new HttpError(401, 'الحساب غير موجود');
  if (isAdminEmail(row.email)) throw new HttpError(400, 'لا يمكن حذف حساب المطور من هنا');
  const actual = await hashAuthSecret(String(row.auth_salt), authSecret);
  if (!authSecret || authSecret.length > 128 || !timingSafeEqual(String(row.auth_hash), actual)) {
    throw new HttpError(403, 'كلمة المرور غير صحيحة');
  }
  // Hand over groups the user owns / leave all groups before the account goes.
  const { results: convs } = await env.DB.prepare('SELECT conversation_id AS id FROM conversation_members WHERE user_id = ?')
    .bind(a.userId)
    .all<{ id: string }>();
  for (const c of convs) {
    const type = await env.DB.prepare('SELECT type FROM conversations WHERE id = ?').bind(c.id).first<{ type: string }>();
    if (type?.type === 'group') {
      const left = await removeMemberCore(env, c.id, a.userId);
      if (left.length) await broadcast(env, [{ userIds: left, payload: { type: 'conversation:updated', conversationId: c.id } }], [c.id]);
    }
  }
  const contacts = await getContactIds(env, a.userId);
  await dropUserSessions(env, a.userId);
  await env.DB.prepare('DELETE FROM support_tickets WHERE user_id = ?').bind(a.userId).run();
  await env.DB.prepare('DELETE FROM user_blocks WHERE blocker_id = ? OR blocked_id = ?').bind(a.userId, a.userId).run();
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(a.userId).run();
  if (contacts.length) await broadcast(env, [{ userIds: contacts, payload: { type: 'conversation:updated' } }], []);
  return json({ ok: true });
};

/* ------------------------------ Statuses ------------------------------ */

const STATUS_TTL_MS = 24 * 3_600_000;
const MAX_ACTIVE_STATUSES = 30;
const STATUS_IMAGE_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;

/** جهات الاتصال = من بينك وبينهم محادثة مباشرة. */
async function getContactIds(env: Env, userId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT cm2.user_id AS id FROM conversation_members cm1
     JOIN conversations c ON c.id = cm1.conversation_id AND c.type = 'direct'
     JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id != ?
     WHERE cm1.user_id = ?`
  )
    .bind(userId, userId)
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

function mapStatus(r: Record<string, unknown>, extra: Partial<{ viewed: boolean; viewCount: number }> = {}) {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    type: String(r.type) as 'text' | 'image',
    text: String(r.text ?? ''),
    bg: String(r.bg ?? ''),
    image: String(r.image ?? ''),
    createdAt: String(r.created_at),
    expiresAt: String(r.expires_at),
    ...extra,
  };
}

/** هل يحق لـ viewer رؤية حالات owner؟ (جهة اتصال، غير محظور، والخصوصية تسمح) */
async function canViewStatuses(env: Env, ownerId: string, viewerId: string): Promise<boolean> {
  if (ownerId === viewerId) return true;
  const owner = await env.DB.prepare('SELECT status_privacy, banned FROM users WHERE id = ?')
    .bind(ownerId)
    .first<{ status_privacy: string; banned: number }>();
  if (!owner || owner.banned === 1 || owner.status_privacy === 'nobody') return false;
  if (await blockedEither(env, ownerId, viewerId)) return false;
  return (await getContactIds(env, viewerId)).includes(ownerId);
}

const createStatus: Handler = async ({ req, env, auth }) => {
  const a = requireAuth(auth);
  const b = await readJson(req);
  const type = b.type === 'image' ? 'image' : 'text';
  const text = str(b.text, 501).trim();
  const bg = typeof b.bg === 'string' && /^#[0-9a-fA-F]{6}$/.test(b.bg) ? b.bg : '';
  const image = typeof b.image === 'string' ? b.image : '';
  if (text.length > 500) throw new HttpError(413, 'نص الحالة طويل (الحد 500 حرف)');
  if (type === 'text' && !text) throw new HttpError(400, 'اكتب نص الحالة أولاً');
  if (type === 'image') {
    if (!image) throw new HttpError(400, 'اختر صورة للحالة');
    if (image.length > 300_000) throw new HttpError(413, 'الصورة كبيرة جداً، اختر صورة أصغر');
    if (!STATUS_IMAGE_RE.test(image)) throw new HttpError(415, 'نوع الصورة غير مدعوم، استخدم JPG أو PNG أو WebP');
  }
  const now = nowIso();
  await env.DB.prepare('DELETE FROM statuses WHERE expires_at < ?').bind(now).run();
  const active = await env.DB.prepare('SELECT COUNT(*) AS n FROM statuses WHERE user_id = ?').bind(a.userId).first<{ n: number }>();
  if ((active?.n ?? 0) >= MAX_ACTIVE_STATUSES) throw new HttpError(429, 'وصلت للحد الأقصى من الحالات النشطة، احذف بعضها أولاً');
  const id = newId('stat');
  const expires = new Date(Date.now() + STATUS_TTL_MS).toISOString();
  await env.DB.prepare('INSERT INTO statuses (id, user_id, type, text, bg, image, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, a.userId, type, text, bg, type === 'image' ? image : '', now, expires)
    .run();
  const contacts = await getContactIds(env, a.userId);
  await broadcast(env, [{ userIds: [a.userId, ...contacts], payload: { type: 'status:updated', userId: a.userId } }], []);
  const row = await env.DB.prepare('SELECT * FROM statuses WHERE id = ?').bind(id).first<Record<string, unknown>>();
  return json({ status: mapStatus(row!, { viewCount: 0 }) });
};

const listStatuses: Handler = async ({ env, auth }) => {
  const a = requireAuth(auth);
  const now = nowIso();
  const { results: mineRows } = await env.DB.prepare(
    `SELECT s.*, (SELECT COUNT(*) FROM status_views v WHERE v.status_id = s.id) AS views
     FROM statuses s WHERE s.user_id = ? AND s.expires_at > ? ORDER BY s.created_at ASC`
  )
    .bind(a.userId, now)
    .all<Record<string, unknown>>();

  const contacts = await getContactIds(env, a.userId);
  type StatusGroupRow = { user: ReturnType<typeof mapUser>; statuses: Array<ReturnType<typeof mapStatus>>; allViewed: boolean; latest: string };
  let groups: StatusGroupRow[] = [];
  if (contacts.length) {
    const ph = contacts.map(() => '?').join(',');
    const { results: rows } = await env.DB.prepare(
      `SELECT s.*, (SELECT 1 FROM status_views v WHERE v.status_id = s.id AND v.viewer_id = ?) AS seen
       FROM statuses s JOIN users u ON u.id = s.user_id
       WHERE s.user_id IN (${ph}) AND s.expires_at > ? AND u.status_privacy != 'nobody' AND u.banned = 0
         AND s.user_id NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = ?)
         AND s.user_id NOT IN (SELECT blocker_id FROM user_blocks WHERE blocked_id = ?)
       ORDER BY s.created_at ASC`
    )
      .bind(a.userId, ...contacts, now, a.userId, a.userId)
      .all<Record<string, unknown>>();
    if (rows.length) {
      const ids = Array.from(new Set(rows.map((r) => String(r.user_id))));
      const { results: users } = await env.DB.prepare(`SELECT * FROM users WHERE id IN (${ids.map(() => '?').join(',')})`)
        .bind(...ids)
        .all<Record<string, unknown>>();
      const online = await getOnlineUserIds(env);
      const byId = new Map(users.map((u) => [String(u.id), mapUser(u, online)]));
      const map = new Map<string, StatusGroupRow>();
      for (const r of rows) {
        const uid = String(r.user_id);
        const g: StatusGroupRow = map.get(uid) ?? { user: byId.get(uid)!, statuses: [], allViewed: true, latest: '' };
        const viewed = Boolean(r.seen);
        g.statuses.push(mapStatus(r, { viewed }));
        if (!viewed) g.allViewed = false;
        g.latest = String(r.created_at);
        map.set(uid, g);
      }
      groups = Array.from(map.values()).sort((x, y) => Number(x.allViewed) - Number(y.allViewed) || y.latest.localeCompare(x.latest));
    }
  }
  return json({
    mine: mineRows.map((r) => mapStatus(r, { viewCount: Number(r.views ?? 0) })),
    groups: groups.map(({ latest: _latest, ...g }) => g),
  });
};

const viewStatus: Handler = async ({ env, auth, params }) => {
  const a = requireAuth(auth);
  const row = await env.DB.prepare('SELECT user_id, expires_at FROM statuses WHERE id = ?').bind(params[0]).first<{ user_id: string; expires_at: string }>();
  if (!row || row.expires_at <= nowIso()) throw new HttpError(404, 'الحالة غير موجودة أو انتهت');
  if (!(await canViewStatuses(env, row.user_id, a.userId))) throw new HttpError(403, 'غير مصرح');
  if (row.user_id !== a.userId) {
    await env.DB.prepare('INSERT OR IGNORE INTO status_views (status_id, viewer_id, viewed_at) VALUES (?, ?, ?)')
      .bind(params[0], a.userId, nowIso())
      .run();
  }
  return json({ ok: true });
};

const statusViewers: Handler = async ({ env, auth, params }) => {
  const a = requireAuth(auth);
  const row = await env.DB.prepare('SELECT user_id FROM statuses WHERE id = ?').bind(params[0]).first<{ user_id: string }>();
  if (!row || row.user_id !== a.userId) throw new HttpError(404, 'الحالة غير موجودة');
  const { results } = await env.DB.prepare(
    'SELECT u.*, v.viewed_at FROM status_views v JOIN users u ON u.id = v.viewer_id WHERE v.status_id = ? ORDER BY v.viewed_at DESC'
  )
    .bind(params[0])
    .all<Record<string, unknown>>();
  const online = await getOnlineUserIds(env);
  return json({ viewers: results.map((r) => ({ user: mapUser(r, online), viewedAt: String(r.viewed_at) })) });
};

const deleteStatus: Handler = async ({ env, auth, params }) => {
  const a = requireAuth(auth);
  const row = await env.DB.prepare('SELECT user_id FROM statuses WHERE id = ?').bind(params[0]).first<{ user_id: string }>();
  if (!row || row.user_id !== a.userId) throw new HttpError(404, 'الحالة غير موجودة');
  await env.DB.prepare('DELETE FROM status_views WHERE status_id = ?').bind(params[0]).run();
  await env.DB.prepare('DELETE FROM statuses WHERE id = ?').bind(params[0]).run();
  const contacts = await getContactIds(env, a.userId);
  await broadcast(env, [{ userIds: [a.userId, ...contacts], payload: { type: 'status:updated', userId: a.userId } }], []);
  return json({ ok: true });
};

/* --------------------------- Group management --------------------------- */

interface GroupRow {
  id: string;
  type: string;
  created_by: string;
}

async function loadGroup(env: Env, convId: string, userId: string): Promise<{ group: GroupRow; isOwner: boolean; isAdmin: boolean }> {
  const group = await env.DB.prepare('SELECT id, type, created_by FROM conversations WHERE id = ?').bind(convId).first<GroupRow>();
  const me = await env.DB.prepare('SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .bind(convId, userId)
    .first<{ role: string }>();
  if (!group || !me) throw new HttpError(404, 'المحادثة غير موجودة');
  const isOwner = group.created_by === userId;
  return { group, isOwner, isAdmin: isOwner || me.role === 'admin' };
}

function requireGroup(group: GroupRow): void {
  if (group.type !== 'group') throw new HttpError(400, 'هذا الإجراء للمجموعات فقط');
}

/** يزيل عضواً ويعيد الأعضاء المتبقين؛ ينقل الملكية عند خروج المالك، ويحذف المجموعة إن فرغت. */
async function removeMemberCore(env: Env, convId: string, userId: string): Promise<string[]> {
  const conv = await env.DB.prepare('SELECT created_by FROM conversations WHERE id = ?').bind(convId).first<{ created_by: string }>();
  await env.DB.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').bind(convId, userId).run();
  const { results } = await env.DB.prepare(
    "SELECT user_id, role FROM conversation_members WHERE conversation_id = ? ORDER BY (role = 'admin') DESC, rowid ASC"
  )
    .bind(convId)
    .all<{ user_id: string; role: string }>();
  if (results.length === 0) {
    await env.DB.prepare('DELETE FROM messages WHERE conversation_id = ?').bind(convId).run();
    await env.DB.prepare('DELETE FROM conversations WHERE id = ?').bind(convId).run();
    return [];
  }
  if (conv && conv.created_by === userId) {
    const next = results[0].user_id;
    await env.DB.prepare('UPDATE conversations SET created_by = ? WHERE id = ?').bind(next, convId).run();
    await env.DB.prepare("UPDATE conversation_members SET role = 'admin' WHERE conversation_id = ? AND user_id = ?").bind(convId, next).run();
  }
  return results.map((r) => r.user_id);
}

const renameGroup: Handler = async ({ req, env, auth, params }) => {
  const a = requireAuth(auth);
  const { group, isAdmin } = await loadGroup(env, params[0], a.userId);
  requireGroup(group);
  if (!isAdmin) throw new HttpError(403, 'المشرفون فقط يمكنهم تغيير اسم المجموعة');
  const title = str((await readJson(req)).title, 60).trim();
  if (title.length < 2) throw new HttpError(400, 'اسم المجموعة قصير جداً');
  await env.DB.prepare('UPDATE conversations SET title = ? WHERE id = ?').bind(title, params[0]).run();
  await broadcast(env, [{ userIds: await getMemberIds(env.DB, params[0]), payload: { type: 'conversation:updated', conversationId: params[0] } }], [params[0]]);
  const [conversation] = await getConversationsForUser(env.DB, a.userId, await getOnlineUserIds(env), params[0]);
  return json({ conversation });
};

const addGroupMembers: Handler = async ({ req, env, auth, params }) => {
  const a = requireAuth(auth);
  const { group, isAdmin } = await loadGroup(env, params[0], a.userId);
  requireGroup(group);
  if (!isAdmin) throw new HttpError(403, 'المشرفون فقط يمكنهم إضافة أعضاء');
  const b = await readJson(req);
  const list = Array.isArray(b.members) ? (b.members as Array<Record<string, unknown>>) : [];
  if (list.length === 0) throw new HttpError(400, 'اختر عضواً واحداً على الأقل');
  const existing = await getMemberIds(env.DB, params[0]);
  const adds = new Map<string, { wrappedKey: string; iv: string }>();
  for (const m of list) {
    const uid = str(m?.userId, 64);
    if (!uid || existing.includes(uid) || adds.has(uid)) continue;
    adds.set(uid, { wrappedKey: requireB64(m?.wrappedKey, 'مفتاح المحادثة', 400), iv: requireB64(m?.iv, 'متجه المفتاح', 64) });
  }
  if (adds.size === 0) throw new HttpError(400, 'هؤلاء الأعضاء موجودون في المجموعة أصلاً');
  if (existing.length + adds.size > 50) throw new HttpError(400, 'الحد الأقصى 50 عضواً في المجموعة');
  for (const uid of adds.keys()) {
    const u = await env.DB.prepare('SELECT banned FROM users WHERE id = ?').bind(uid).first<{ banned: number }>();
    if (!u || u.banned === 1) throw new HttpError(400, 'أحد الأعضاء غير موجود');
    if (await blockedEither(env, a.userId, uid)) throw new HttpError(403, 'لا يمكنك إضافة هذا المستخدم');
  }
  await env.DB.batch(
    Array.from(adds.entries()).map(([uid, k]) =>
      env.DB.prepare(
        `INSERT INTO conversation_members (conversation_id, user_id, role, unread_count, wrapped_key, wrap_iv, wrapped_by)
         VALUES (?, ?, 'member', 0, ?, ?, ?)`
      ).bind(params[0], uid, k.wrappedKey, k.iv, a.userId)
    )
  );
  await broadcast(env, [{ userIds: await getMemberIds(env.DB, params[0]), payload: { type: 'conversation:updated', conversationId: params[0] } }], [params[0]]);
  const [conversation] = await getConversationsForUser(env.DB, a.userId, await getOnlineUserIds(env), params[0]);
  return json({ conversation });
};

const removeGroupMember: Handler = async ({ env, auth, params }) => {
  const a = requireAuth(auth);
  const [convId, target] = params;
  const { group, isOwner, isAdmin } = await loadGroup(env, convId, a.userId);
  requireGroup(group);
  if (!isAdmin) throw new HttpError(403, 'المشرفون فقط يمكنهم إزالة الأعضاء');
  if (target === a.userId) throw new HttpError(400, 'استخدم «مغادرة المجموعة» للخروج');
  if (target === group.created_by) throw new HttpError(403, 'لا يمكن إزالة مالك المجموعة');
  const t = await env.DB.prepare('SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?').bind(convId, target).first<{ role: string }>();
  if (!t) throw new HttpError(404, 'العضو غير موجود في المجموعة');
  if (t.role === 'admin' && !isOwner) throw new HttpError(403, 'المالك وحده يزيل المشرفين');
  const left = await removeMemberCore(env, convId, target);
  await broadcast(
    env,
    [
      { userIds: left, payload: { type: 'conversation:updated', conversationId: convId } },
      { userIds: [target], payload: { type: 'conversation:removed', conversationId: convId } },
    ],
    [convId]
  );
  return json({ ok: true });
};

const setMemberRole: Handler = async ({ req, env, auth, params }) => {
  const a = requireAuth(auth);
  const [convId, target] = params;
  const { group, isOwner } = await loadGroup(env, convId, a.userId);
  requireGroup(group);
  if (!isOwner) throw new HttpError(403, 'المالك وحده يغيّر صلاحيات الأعضاء');
  const role = (await readJson(req)).role;
  if (role !== 'admin' && role !== 'member') throw new HttpError(400, 'الدور غير صالح');
  if (target === group.created_by) throw new HttpError(400, 'لا يمكن تغيير دور المالك');
  const res = await env.DB.prepare('UPDATE conversation_members SET role = ? WHERE conversation_id = ? AND user_id = ?')
    .bind(role, convId, target)
    .run();
  if (!res.meta?.changes) throw new HttpError(404, 'العضو غير موجود في المجموعة');
  await broadcast(env, [{ userIds: await getMemberIds(env.DB, convId), payload: { type: 'conversation:updated', conversationId: convId } }], [convId]);
  return json({ ok: true });
};

const leaveGroup: Handler = async ({ env, auth, params }) => {
  const a = requireAuth(auth);
  const { group } = await loadGroup(env, params[0], a.userId);
  requireGroup(group);
  const left = await removeMemberCore(env, params[0], a.userId);
  await broadcast(
    env,
    [
      { userIds: left, payload: { type: 'conversation:updated', conversationId: params[0] } },
      { userIds: [a.userId], payload: { type: 'conversation:removed', conversationId: params[0] } },
    ],
    [params[0]]
  );
  return json({ ok: true });
};

/** حذف المحادثة: scope=me يمسح السجل عندي فقط (تعود عند وصول رسالة جديدة)، scope=all لمالك المجموعة فقط. */
const deleteConversation: Handler = async ({ env, auth, params, url }) => {
  const a = requireAuth(auth);
  const { group, isOwner } = await loadGroup(env, params[0], a.userId);
  const scope = url.searchParams.get('scope') === 'all' ? 'all' : 'me';
  if (scope === 'me') {
    await env.DB.prepare('UPDATE conversation_members SET hidden_at = ?, unread_count = 0 WHERE conversation_id = ? AND user_id = ?')
      .bind(nowIso(), params[0], a.userId)
      .run();
    return json({ ok: true, scope });
  }
  requireGroup(group);
  if (!isOwner) throw new HttpError(403, 'مالك المجموعة وحده يحذفها للجميع');
  const members = await getMemberIds(env.DB, params[0]);
  await env.DB.prepare('DELETE FROM messages WHERE conversation_id = ?').bind(params[0]).run();
  await env.DB.prepare('DELETE FROM conversation_members WHERE conversation_id = ?').bind(params[0]).run();
  await env.DB.prepare('DELETE FROM conversations WHERE id = ?').bind(params[0]).run();
  await broadcast(env, [{ userIds: members, payload: { type: 'conversation:removed', conversationId: params[0] } }], [params[0]]);
  return json({ ok: true, scope });
};

const markRead: Handler = async ({ env, auth, params }) => {
  const a = requireAuth(auth);
  const convId = params[0];
  const memberIds = await getMemberIds(env.DB, convId);
  if (!memberIds.includes(a.userId)) throw new HttpError(403, 'غير مصرح');
  await env.DB.batch([
    env.DB.prepare('UPDATE conversation_members SET unread_count = 0 WHERE conversation_id = ? AND user_id = ?').bind(
      convId,
      a.userId
    ),
    env.DB.prepare(
      `UPDATE messages SET status = 'read' WHERE conversation_id = ? AND sender_id != ? AND status != 'read'`
    ).bind(convId, a.userId),
    env.DB.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND conversation_id = ?').bind(a.userId, convId),
  ]);
  await broadcast(env, [
    { userIds: memberIds, payload: { type: 'message:read_receipt', conversationId: convId, readerId: a.userId } },
  ]);
  return json({ ok: true });
};

/* ------------------------------ Devices ------------------------------ */

const listDevices: Handler = async ({ env, auth }) => {
  const a = requireAuth(auth);
  const { results } = await env.DB.prepare('SELECT * FROM devices WHERE user_id = ? ORDER BY last_active DESC')
    .bind(a.userId)
    .all<Record<string, unknown>>();
  return json({ devices: results.map(mapDevice) });
};

const patchDevice: Handler = async ({ req, env, auth, params }) => {
  const a = requireAuth(auth);
  const b = await readJson(req);
  await env.DB.prepare('UPDATE devices SET push_enabled = ? WHERE id = ? AND user_id = ?')
    .bind(b.pushEnabled ? 1 : 0, params[0], a.userId)
    .run();
  return json({ ok: true });
};

const deleteDevice: Handler = async ({ env, auth, params }) => {
  const a = requireAuth(auth);
  await env.DB.prepare('DELETE FROM devices WHERE id = ? AND user_id = ?').bind(params[0], a.userId).run();
  await revokeDevice(env, a.userId, params[0]);
  return json({ ok: true });
};

/* --------------------------- Notifications --------------------------- */

const listNotifications: Handler = async ({ env, auth, url }) => {
  const a = requireAuth(auth);
  const after = url.searchParams.get('after');
  const device = await env.DB.prepare('SELECT push_enabled FROM devices WHERE id = ?')
    .bind(a.deviceId)
    .first<{ push_enabled: number }>();
  const pushEnabled = device ? Boolean(device.push_enabled) : false;
  if (after) {
    // Used by the Android background service: everything newer than the last one it showed.
    const { results } = await env.DB.prepare(
      'SELECT * FROM notifications WHERE user_id = ? AND created_at > ? ORDER BY created_at ASC LIMIT 50'
    )
      .bind(a.userId, after)
      .all<Record<string, unknown>>();
    return json({ notifications: results.map(mapNotification), pushEnabled, serverTime: nowIso() });
  }
  const { results } = await env.DB.prepare(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30'
  )
    .bind(a.userId)
    .all<Record<string, unknown>>();
  return json({ notifications: results.map(mapNotification), pushEnabled, serverTime: nowIso() });
};

const readAllNotifications: Handler = async ({ env, auth }) => {
  const a = requireAuth(auth);
  await env.DB.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').bind(a.userId).run();
  return json({ ok: true });
};

const testNotification: Handler = async ({ req, env, auth }) => {
  const a = requireAuth(auth);
  const b = await readJson(req).catch(() => ({}) as Record<string, unknown>);
  const notification = {
    id: newId('notif'),
    userId: a.userId,
    title: 'تنبيه تجريبي · مِرسال',
    body: 'قناة التنبيهات تعمل وتصل إلى جميع أجهزتك المتصلة.',
    conversationId: str(b.conversationId, 64),
    isRead: false,
    createdAt: nowIso(),
  };
  await env.DB.prepare(
    'INSERT INTO notifications (id, user_id, title, body, conversation_id, is_read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
  )
    .bind(notification.id, notification.userId, notification.title, notification.body, notification.conversationId, notification.createdAt)
    .run();
  await broadcast(env, [{ userIds: [a.userId], payload: { type: 'notification:push', notification } }]);
  return json({ notification });
};

/* -------------------------------- Calls -------------------------------- */

const iceServers: Handler = async ({ env, auth }) => {
  requireAuth(auth);
  const fallback = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return json({ iceServers: fallback, turn: false });
  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: 86400 }),
      }
    );
    if (!res.ok) throw new Error(`turn ${res.status}`);
    const data = (await res.json()) as { iceServers?: unknown };
    const list = Array.isArray(data.iceServers) ? data.iceServers : data.iceServers ? [data.iceServers] : [];
    return json({ iceServers: [...fallback, ...list], turn: list.length > 0 });
  } catch (err) {
    console.error('TURN credential request failed', err);
    return json({ iceServers: fallback, turn: false });
  }
};

/* ------------------------------ Support ------------------------------ */

const createTicket: Handler = async ({ req, env, auth }) => {
  const a = requireAuth(auth);
  const b = await readJson(req);
  const message = str(b.message, 1000).trim();
  if (message.length < 3) throw new HttpError(400, 'اكتب رسالتك للدعم');
  const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM support_tickets WHERE user_id = ? AND status = 'open'")
    .bind(a.userId)
    .first<{ n: number }>();
  if ((open?.n ?? 0) >= 5) throw new HttpError(429, 'لديك عدة رسائل مفتوحة. انتظر رد المطور أولاً');
  const id = newId('tkt');
  await env.DB.prepare('INSERT INTO support_tickets (id, user_id, message, status, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, a.userId, message, 'open', nowIso())
    .run();
  return json({ ok: true, id });
};

const myTickets: Handler = async ({ env, auth }) => {
  const a = requireAuth(auth);
  const { results } = await env.DB.prepare(
    'SELECT id, message, reply, status, created_at, replied_at FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC LIMIT 30'
  )
    .bind(a.userId)
    .all<Record<string, unknown>>();
  return json({
    tickets: results.map((r) => ({
      id: String(r.id),
      message: String(r.message),
      reply: r.reply ? String(r.reply) : null,
      status: String(r.status),
      createdAt: String(r.created_at),
      repliedAt: r.replied_at ? String(r.replied_at) : null,
    })),
  });
};

/* ------------------------------ Developer ------------------------------ */

const getAppearance: Handler = async ({ env }) => json({ wallpapers: await readWallpapers(env) });

const putAppearance: Handler = async ({ req, env, auth }) => {
  await requireAdmin(env, auth);
  const body = await readJson(req);
  const list = sanitizeWallpapers(body.wallpapers);
  await writeWallpapers(env, list);
  return json({ wallpapers: list });
};


async function requireAdmin(env: Env, auth: AuthCtx | null): Promise<AuthCtx> {
  const a = requireAuth(auth);
  const row = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(a.userId).first<{ email: string | null }>();
  if (!row || !isAdminEmail(row.email)) throw new HttpError(403, 'هذه الصفحة للمطور فقط');
  return a;
}

async function dropUserSessions(env: Env, userId: string): Promise<void> {
  const { results } = await env.DB.prepare('SELECT id FROM devices WHERE user_id = ?').bind(userId).all<{ id: string }>();
  await env.DB.prepare('DELETE FROM devices WHERE user_id = ?').bind(userId).run();
  for (const d of results) await revokeDevice(env, userId, d.id);
}

const adminStats: Handler = async ({ env, auth }) => {
  await requireAdmin(env, auth);
  const count = async (sql: string) => Number((await env.DB.prepare(sql).first<{ n: number }>())?.n ?? 0);
  const online = await getOnlineUserIds(env);
  return json({
    users: await count('SELECT COUNT(*) AS n FROM users'),
    banned: await count('SELECT COUNT(*) AS n FROM users WHERE banned = 1'),
    conversations: await count('SELECT COUNT(*) AS n FROM conversations'),
    messages: await count('SELECT COUNT(*) AS n FROM messages'),
    openTickets: await count("SELECT COUNT(*) AS n FROM support_tickets WHERE status = 'open'"),
    online: online.size,
  });
};

const adminListUsers: Handler = async ({ env, auth, url }) => {
  await requireAdmin(env, auth);
  const q = (url.searchParams.get('q') || '').trim().toLowerCase().replace(/^[#@]/, '').slice(0, 60);
  const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const sql = q
    ? `SELECT u.*, (SELECT COUNT(*) FROM devices d WHERE d.user_id = u.id) AS devices
       FROM users u WHERE u.uid = ? OR u.handle = ? OR LOWER(u.display_name) LIKE ? ESCAPE '\\'
       ORDER BY u.created_at DESC LIMIT 60`
    : `SELECT u.*, (SELECT COUNT(*) FROM devices d WHERE d.user_id = u.id) AS devices
       FROM users u WHERE ? = ? AND ? = ? ORDER BY u.created_at DESC LIMIT 60`;
  const stmt = env.DB.prepare(sql);
  const { results } = await (q ? stmt.bind(q, q, like) : stmt.bind(1, 1, 1, 1)).all<Record<string, unknown>>();
  const online = await getOnlineUserIds(env);
  return json({
    users: results.map((r) => ({
      id: String(r.id),
      uid: String(r.uid ?? ''),
      handle: r.handle ? String(r.handle) : '',
      displayName: String(r.display_name),
      bio: String(r.bio ?? ''),
      banned: Number(r.banned) === 1,
      isAdmin: isAdminEmail(r.email),
      online: online.has(String(r.id)),
      devices: Number(r.devices ?? 0),
      createdAt: String(r.created_at),
      lastSeen: String(r.last_seen),
    })),
  });
};

const adminPatchUser: Handler = async ({ req, env, auth, params }) => {
  const actor = await requireAdmin(env, auth);
  const target = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(params[0]).first<Record<string, unknown>>();
  if (!target) throw new HttpError(404, 'الحساب غير موجود');
  const b = await readJson(req);
  const sets: string[] = [];
  const vals: unknown[] = [];

  if (typeof b.displayName === 'string') {
    const name = str(b.displayName, 40).trim();
    if (!name) throw new HttpError(400, 'الاسم لا يمكن أن يكون فارغاً');
    sets.push('display_name = ?');
    vals.push(name);
  }
  if (typeof b.bio === 'string') {
    sets.push('bio = ?');
    vals.push(str(b.bio, 200));
  }
  if (typeof b.uid === 'string' && b.uid !== String(target.uid)) {
    if (!/^\d{5}$/.test(b.uid)) throw new HttpError(400, 'الـ ID يجب أن يكون 5 أرقام بالضبط');
    const used = await env.DB.prepare('SELECT 1 AS x FROM users WHERE uid = ? AND id != ?').bind(b.uid, params[0]).first();
    if (used) throw new HttpError(409, 'هذا الـ ID مستخدم لحساب آخر');
    sets.push('uid = ?');
    vals.push(b.uid);
  }
  if (typeof b.banned === 'boolean') {
    if (b.banned && isAdminEmail(target.email)) throw new HttpError(400, 'لا يمكن إيقاف حساب المطور');
    sets.push('banned = ?');
    vals.push(b.banned ? 1 : 0);
  }
  if (sets.length) {
    const what = [
      typeof b.banned === 'boolean' ? (b.banned ? 'ban' : 'unban') : '',
      typeof b.displayName === 'string' ? 'name' : '',
      typeof b.bio === 'string' ? 'bio' : '',
      typeof b.uid === 'string' ? 'uid' : '',
    ].filter(Boolean).join(',');
    await writeAudit(env, actor.userId, 'user.update', params[0], what);
  }
  if (sets.length === 0) throw new HttpError(400, 'لا يوجد تعديل');
  await env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, params[0]).run();
  if (b.banned === true) await dropUserSessions(env, params[0]);
  return json({ ok: true });
};

const adminLogoutUser: Handler = async ({ env, auth, params }) => {
  await requireAdmin(env, auth);
  await dropUserSessions(env, params[0]);
  return json({ ok: true });
};

const adminDeleteUser: Handler = async ({ env, auth, params }) => {
  const actor = await requireAdmin(env, auth);
  const target = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(params[0]).first<{ email: string | null }>();
  if (!target) throw new HttpError(404, 'الحساب غير موجود');
  if (isAdminEmail(target.email)) throw new HttpError(400, 'لا يمكن حذف حساب المطور');
  await dropUserSessions(env, params[0]);
  await env.DB.prepare('DELETE FROM support_tickets WHERE user_id = ?').bind(params[0]).run();
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(params[0]).run();
  await writeAudit(env, actor.userId, 'user.delete', params[0]);
  return json({ ok: true });
};

const adminListTickets: Handler = async ({ env, auth }) => {
  await requireAdmin(env, auth);
  const { results } = await env.DB.prepare(
    `SELECT t.*, u.display_name AS display_name, u.uid AS uid
     FROM support_tickets t LEFT JOIN users u ON u.id = t.user_id
     ORDER BY (t.status = 'open') DESC, t.created_at DESC LIMIT 60`
  ).all<Record<string, unknown>>();
  return json({
    tickets: results.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      displayName: String(r.display_name ?? 'حساب محذوف'),
      uid: String(r.uid ?? ''),
      message: String(r.message),
      reply: r.reply ? String(r.reply) : null,
      status: String(r.status),
      createdAt: String(r.created_at),
    })),
  });
};

const adminReplyTicket: Handler = async ({ req, env, auth, params }) => {
  await requireAdmin(env, auth);
  const b = await readJson(req);
  const reply = str(b.reply, 1000).trim();
  if (!reply) throw new HttpError(400, 'اكتب الرد أولاً');
  const res = await env.DB.prepare("UPDATE support_tickets SET reply = ?, status = 'closed', replied_at = ? WHERE id = ?")
    .bind(reply, nowIso(), params[0])
    .run();
  if (!res.meta.changes) throw new HttpError(404, 'الرسالة غير موجودة');
  return json({ ok: true });
};

/* ------------------------------- Router ------------------------------- */

interface Route {
  method: string;
  pattern: RegExp;
  handler: Handler;
  public?: boolean;
}

const routes: Route[] = [
  { method: 'GET', pattern: /^\/api\/health$/, handler: async () => json({ ok: true, time: nowIso() }), public: true },
  { method: 'POST', pattern: /^\/api\/auth\/register$/, handler: register, public: true },
  { method: 'POST', pattern: /^\/api\/auth\/login$/, handler: login, public: true },
  { method: 'POST', pattern: /^\/api\/auth\/logout$/, handler: logout },
  { method: 'GET', pattern: /^\/api\/me$/, handler: me },
  { method: 'PUT', pattern: /^\/api\/me\/avatar$/, handler: putAvatar },
  { method: 'DELETE', pattern: /^\/api\/me\/avatar$/, handler: deleteAvatar },
  { method: 'GET', pattern: /^\/api\/users\/search$/, handler: searchUsers },
  { method: 'GET', pattern: /^\/api\/handle\/check$/, handler: checkHandle, public: true },
  { method: 'PUT', pattern: /^\/api\/me\/handle$/, handler: setHandle },
  { method: 'GET', pattern: /^\/api\/blocks$/, handler: listBlocks },
  { method: 'POST', pattern: /^\/api\/blocks$/, handler: blockUser },
  { method: 'DELETE', pattern: /^\/api\/blocks\/([\w-]+)$/, handler: unblockUser },
  { method: 'PATCH', pattern: /^\/api\/me$/, handler: patchMe },
  { method: 'DELETE', pattern: /^\/api\/me$/, handler: deleteMe },
  { method: 'GET', pattern: /^\/api\/statuses$/, handler: listStatuses },
  { method: 'POST', pattern: /^\/api\/statuses$/, handler: createStatus },
  { method: 'POST', pattern: /^\/api\/statuses\/([\w-]+)\/view$/, handler: viewStatus },
  { method: 'GET', pattern: /^\/api\/statuses\/([\w-]+)\/views$/, handler: statusViewers },
  { method: 'DELETE', pattern: /^\/api\/statuses\/([\w-]+)$/, handler: deleteStatus },
  { method: 'PATCH', pattern: /^\/api\/conversations\/([\w-]+)$/, handler: renameGroup },
  { method: 'DELETE', pattern: /^\/api\/conversations\/([\w-]+)$/, handler: deleteConversation },
  { method: 'POST', pattern: /^\/api\/conversations\/([\w-]+)\/members$/, handler: addGroupMembers },
  { method: 'PATCH', pattern: /^\/api\/conversations\/([\w-]+)\/members\/([\w-]+)$/, handler: setMemberRole },
  { method: 'DELETE', pattern: /^\/api\/conversations\/([\w-]+)\/members\/([\w-]+)$/, handler: removeGroupMember },
  { method: 'POST', pattern: /^\/api\/conversations\/([\w-]+)\/leave$/, handler: leaveGroup },
  { method: 'GET', pattern: /^\/api\/conversations$/, handler: listConversations },
  { method: 'POST', pattern: /^\/api\/conversations$/, handler: createConversation },
  { method: 'GET', pattern: /^\/api\/conversations\/([\w-]+)$/, handler: getConversation },
  { method: 'PATCH', pattern: /^\/api\/messages\/([\w-]+)$/, handler: editMessage },
  { method: 'DELETE', pattern: /^\/api\/messages\/([\w-]+)$/, handler: deleteMessage },
  { method: 'GET', pattern: /^\/api\/conversations\/([\w-]+)\/messages$/, handler: listMessages },
  { method: 'POST', pattern: /^\/api\/conversations\/([\w-]+)\/messages$/, handler: sendMessage },
  { method: 'POST', pattern: /^\/api\/conversations\/([\w-]+)\/read$/, handler: markRead },
  { method: 'GET', pattern: /^\/api\/devices$/, handler: listDevices },
  { method: 'PATCH', pattern: /^\/api\/devices\/([\w-]+)$/, handler: patchDevice },
  { method: 'DELETE', pattern: /^\/api\/devices\/([\w-]+)$/, handler: deleteDevice },
  { method: 'GET', pattern: /^\/api\/notifications$/, handler: listNotifications },
  { method: 'POST', pattern: /^\/api\/notifications\/read$/, handler: readAllNotifications },
  { method: 'POST', pattern: /^\/api\/notifications\/test$/, handler: testNotification },
  { method: 'GET', pattern: /^\/api\/ice$/, handler: iceServers },
  { method: 'POST', pattern: /^\/api\/support$/, handler: createTicket },
  { method: 'GET', pattern: /^\/api\/support$/, handler: myTickets },
  { method: 'GET', pattern: /^\/api\/admin\/stats$/, handler: adminStats },
  { method: 'GET', pattern: /^\/api\/admin\/settings$/, handler: adminGetSettings },
  { method: 'PUT', pattern: /^\/api\/admin\/settings$/, handler: adminPutSettings },
  { method: 'GET', pattern: /^\/api\/admin\/audit$/, handler: adminListAudit },
  { method: 'GET', pattern: /^\/api\/settings$/, handler: getPublicSettings, public: true },
  { method: 'GET', pattern: /^\/api\/admin\/users$/, handler: adminListUsers },
  { method: 'PATCH', pattern: /^\/api\/admin\/users\/([\w-]+)$/, handler: adminPatchUser },
  { method: 'DELETE', pattern: /^\/api\/admin\/users\/([\w-]+)$/, handler: adminDeleteUser },
  { method: 'POST', pattern: /^\/api\/admin\/users\/([\w-]+)\/logout$/, handler: adminLogoutUser },
  { method: 'GET', pattern: /^\/api\/admin\/tickets$/, handler: adminListTickets },
  { method: 'POST', pattern: /^\/api\/admin\/tickets\/([\w-]+)\/reply$/, handler: adminReplyTicket },
  { method: 'GET', pattern: /^\/api\/appearance$/, handler: getAppearance, public: true },
  { method: 'PUT', pattern: /^\/api\/admin\/appearance$/, handler: putAppearance },
];

export async function handleApi(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  try {
    let pathMatched = false;
    for (const route of routes) {
      const m = route.pattern.exec(url.pathname);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== req.method) continue;
      await ensureSchema(env.DB);
      const auth = route.public ? null : await authenticateRequest(env, req);
      return await route.handler({ req, env, url, params: m.slice(1), auth });
    }
    return json({ error: pathMatched ? 'الطريقة غير مدعومة' : 'غير موجود' }, pathMatched ? 405 : 404);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error('API error', err);
    return json({ error: 'حدث خطأ في الخادم' }, 500);
  }
}
