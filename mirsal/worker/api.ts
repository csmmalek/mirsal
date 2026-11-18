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
import { ensureSchema } from './schema';
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

const register: Handler = async ({ req, env }) => {
  const b = await readJson(req);
  const username = str(b.username, 40).trim().toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(username)) {
    throw new HttpError(400, 'اسم المستخدم: من 3 إلى 24 حرفاً إنجليزياً صغيراً أو أرقاماً أو _');
  }
  const displayName = str(b.displayName, 40).trim() || username;
  const authSecret = requireB64(b.authSecret, 'كلمة المرور', 128);
  if (authSecret.length < 32) throw new HttpError(400, 'كلمة المرور غير صالحة');
  const publicKey = validatePublicKey(str(b.publicKey, 601));
  const encPriv = requireB64(b.encryptedPrivateKey, 'المفتاح الخاص', 4000);
  const encPrivIv = requireB64(b.privateKeyIv, 'متجه المفتاح', 64);

  const taken = await env.DB.prepare('SELECT 1 AS x FROM users WHERE username = ?').bind(username).first();
  if (taken) throw new HttpError(409, 'اسم المستخدم مستخدم مسبقاً');

  const id = newId('user');
  const salt = randomToken(16);
  const now = nowIso();
  try {
    await env.DB.prepare(
      `INSERT INTO users (id, username, display_name, bio, auth_salt, auth_hash, public_key,
                          enc_private_key, enc_private_iv, last_seen, created_at)
       VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(id, username, displayName, salt, await hashAuthSecret(salt, authSecret), publicKey, encPriv, encPrivIv, now, now)
      .run();
  } catch {
    throw new HttpError(409, 'اسم المستخدم مستخدم مسبقاً');
  }

  const { token, deviceId } = await createDevice(env, id, str(b.deviceName, 80), str(b.deviceType, 20));
  const row = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<Record<string, unknown>>();
  return json({ user: mapUser(row!, new Set([id])), token, deviceId });
};

const login: Handler = async ({ req, env }) => {
  const b = await readJson(req);
  const username = str(b.username, 40).trim().toLowerCase();
  const authSecret = str(b.authSecret, 129);
  if (!username || !authSecret || authSecret.length > 128) throw new HttpError(400, 'يرجى إدخال اسم المستخدم وكلمة المرور');

  await assertNotThrottled(env, username);
  const row = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<Record<string, unknown>>();
  const expected = row ? String(row.auth_hash) : '0'.repeat(64);
  const actual = await hashAuthSecret(row ? String(row.auth_salt) : 'x', authSecret);
  if (!row || !timingSafeEqual(expected, actual)) {
    await recordLoginFailure(env, username);
    throw new HttpError(401, 'اسم المستخدم أو كلمة المرور غير صحيحة');
  }
  await clearLoginFailures(env, username);

  const { token, deviceId } = await createDevice(env, String(row.id), str(b.deviceName, 80), str(b.deviceType, 20));
  const online = await getOnlineUserIds(env);
  return json({
    user: mapUser(row, online),
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
  return json({ user: mapUser(row, await getOnlineUserIds(env)), deviceId: a.deviceId });
};

/* ------------------------------ Users ------------------------------ */

const searchUsers: Handler = async ({ env, auth, url }) => {
  const a = requireAuth(auth);
  const q = (url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 40);
  if (q.length < 2) return json({ users: [] });
  const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const { results } = await env.DB.prepare(
    `SELECT * FROM users
     WHERE id != ? AND (username LIKE ? ESCAPE '\\' OR LOWER(display_name) LIKE ? ESCAPE '\\')
     ORDER BY username LIMIT 20`
  )
    .bind(a.userId, like, like)
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
       ORDER BY m.created_at DESC LIMIT ?
     ) ORDER BY created_at ASC`
  )
    .bind(...(before ? [convId, before, limit] : [convId, limit]))
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
  { method: 'GET', pattern: /^\/api\/users\/search$/, handler: searchUsers },
  { method: 'GET', pattern: /^\/api\/conversations$/, handler: listConversations },
  { method: 'POST', pattern: /^\/api\/conversations$/, handler: createConversation },
  { method: 'GET', pattern: /^\/api\/conversations\/([\w-]+)$/, handler: getConversation },
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
