import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handleApi } from './api';
import type { Env } from './types';

/** D1-compatible shim on node:sqlite so the real handlers run unmodified. */
function makeD1(): D1Database {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const make = (sql: string, params: unknown[] = []): D1PreparedStatement => ({
    bind: (...p: unknown[]) => make(sql, p),
    first: async <T>() => ((sqlite.prepare(sql).get(...(params as never[])) as T | undefined) ?? null),
    all: async <T>() => ({ results: sqlite.prepare(sql).all(...(params as never[])) as T[], success: true, meta: {} }),
    run: async () => {
      const info = sqlite.prepare(sql).run(...(params as never[]));
      return { results: [], success: true, meta: { changes: Number(info.changes) } };
    },
    // exposed for batch
    ...({ _sql: sql, _params: params } as object),
  });
  return {
    prepare: (sql: string) => make(sql),
    batch: async (stmts: D1PreparedStatement[]) => {
      sqlite.exec('BEGIN');
      try {
        for (const s of stmts as unknown as Array<{ _sql: string; _params: unknown[] }>) {
          sqlite.prepare(s._sql).run(...(s._params as never[]));
        }
        sqlite.exec('COMMIT');
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
      return stmts.map(() => ({ results: [], success: true, meta: {} }));
    },
  };
}

const hubCalls: Array<{ path: string; body: unknown }> = [];
const online = new Set<string>();
const env: Env = {
  DB: makeD1(),
  EMAIL_VERIFICATION: 'off', // existing tests register without mail; the OTP test below turns it on
  ASSETS: { fetch: async () => new Response('asset') },
  HUB: {
    idFromName: () => ({}),
    get: () => ({
      fetch: async (input: Request | string, init?: RequestInit) => {
        const url = new URL(typeof input === 'string' ? input : input.url);
        if (url.pathname === '/online') return Response.json({ userIds: [...online] });
        hubCalls.push({ path: url.pathname, body: JSON.parse(String(init?.body ?? 'null')) });
        return Response.json({ ok: true });
      },
    }),
  },
};

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await handleApi(
    new Request(`https://x.test${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env
  );
  return { status: res.status, data: (await res.json()) as Record<string, any> };
}

const pub = JSON.stringify({ kty: 'EC', crv: 'P-256', x: 'a'.repeat(43), y: 'b'.repeat(43) });
const secret = 'S'.repeat(44);
const reg = (email: string, displayName = email.split('@')[0], handle = email.split('@')[0].replace(/[^a-z0-9]/g, '')) => ({
  email,
  displayName,
  handle,
  authSecret: secret,
  publicKey: pub,
  encryptedPrivateKey: 'QUJD'.repeat(10),
  privateKeyIv: 'AAAAAAAAAAAAAAAA',
  deviceName: 'test',
  deviceType: 'web',
});

test('register, login, /me and wrong-password handling', async () => {
  const r = await call('POST', '/api/auth/register', reg('layla@test.dev', 'ليلى'));
  assert.equal(r.status, 200);
  assert.ok(r.data.token);
  assert.match(r.data.user.avatar, /^data:image\/svg\+xml/);

  const dup = await call('POST', '/api/auth/register', reg('layla@test.dev'));
  assert.equal(dup.status, 409);

  const badName = await call('POST', '/api/auth/register', reg('A b'));
  assert.equal(badName.status, 400);

  const me = await call('GET', '/api/me', undefined, r.data.token);
  assert.equal(me.data.user.email, 'layla@test.dev');
  assert.match(me.data.user.uid, /^\d{5}$/);
  assert.equal(r.data.user.isAdmin, false);
  assert.equal((await call('GET', '/api/me')).status, 401);
  assert.equal((await call('GET', '/api/me', undefined, 'x'.repeat(40))).status, 401);

  const ok = await call('POST', '/api/auth/login', { identifier: 'layla@test.dev', authSecret: secret, deviceName: 'ph', deviceType: 'android' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.encryptedPrivateKey, 'QUJD'.repeat(10));

  for (let i = 0; i < 8; i++) {
    const bad = await call('POST', '/api/auth/login', { identifier: 'layla@test.dev', authSecret: 'W'.repeat(44) });
    assert.equal(bad.status, 401);
  }
  const locked = await call('POST', '/api/auth/login', { identifier: 'layla@test.dev', authSecret: secret });
  assert.equal(locked.status, 429);
  assert.equal((await call('POST', '/api/auth/login', { identifier: 'ghost@test.dev', authSecret: secret })).status, 401);
});

test('conversations, encrypted messages, read receipts, notifications, devices', async () => {
  const a = (await call('POST', '/api/auth/register', reg('amal@test.dev'))).data;
  const b = (await call('POST', '/api/auth/register', reg('basem@test.dev'))).data;
  const c = (await call('POST', '/api/auth/register', reg('carim@test.dev'))).data;

  // Search works by exact username or 5-digit ID only: never by display name or email.
  const found = await call('GET', '/api/users/search?q=basem', undefined, a.token);
  assert.deepEqual(found.data.users.map((u: any) => u.displayName), ['basem']);
  assert.ok(!('email' in found.data.users[0]), 'emails are never shown to other users');
  assert.equal(found.data.users[0].handle, 'basem');
  assert.equal((await call('GET', `/api/users/search?q=${b.user.uid}`, undefined, a.token)).data.users.length, 1);
  assert.equal((await call('GET', '/api/users/search?q=@BASEM', undefined, a.token)).data.users.length, 1);
  assert.equal((await call('GET', '/api/users/search?q=bas', undefined, a.token)).data.users.length, 0, 'partial names do not match');
  assert.equal((await call('GET', '/api/users/search?q=basem%40test.dev', undefined, a.token)).data.users.length, 0, 'email search is not allowed');

  const keys = (ids: string[]) => ids.map((userId) => ({ userId, wrappedKey: 'QUJD'.repeat(12), iv: 'AAAAAAAAAAAAAAAA' }));
  const missing = await call('POST', '/api/conversations', { memberIds: [b.user.id], keys: keys([a.user.id]) }, a.token);
  assert.equal(missing.status, 400);

  const conv = await call('POST', '/api/conversations', { memberIds: [b.user.id], keys: keys([a.user.id, b.user.id]) }, a.token);
  assert.equal(conv.status, 200);
  const convId = conv.data.conversation.id;
  assert.equal(conv.data.conversation.type, 'direct');
  assert.equal(conv.data.conversation.title, 'basem');
  assert.equal(conv.data.conversation.keyInfo.wrappedBy, a.user.id);

  const again = await call('POST', '/api/conversations', { memberIds: [a.user.id], keys: keys([a.user.id, b.user.id]) }, b.token);
  assert.equal(again.data.conversation.id, convId, 'direct chats are de-duplicated');

  online.add(b.user.id);
  const send = await call('POST', `/api/conversations/${convId}/messages`, { id: 'msg_test_000001', type: 'text', ciphertext: 'QUJD'.repeat(8), iv: 'AAAAAAAAAAAAAAAA' }, a.token);
  assert.equal(send.status, 200);
  assert.equal(send.data.message.status, 'delivered');
  const idem = await call('POST', `/api/conversations/${convId}/messages`, { id: 'msg_test_000001', type: 'text', ciphertext: 'QUJD'.repeat(8), iv: 'AAAAAAAAAAAAAAAA' }, a.token);
  assert.equal(idem.data.message.id, 'msg_test_000001');

  const outsider = await call('POST', `/api/conversations/${convId}/messages`, { id: 'msg_test_000002', type: 'text', ciphertext: 'QUJD', iv: 'AAAAAAAAAAAAAAAA' }, c.token);
  assert.equal(outsider.status, 403);
  assert.equal((await call('GET', `/api/conversations/${convId}/messages`, undefined, c.token)).status, 403);
  assert.equal((await call('GET', `/api/conversations/${convId}`, undefined, c.token)).status, 404);
  assert.equal((await call('POST', `/api/conversations/${convId}/messages`, { id: 'msg_test_000003', type: 'text', ciphertext: 'A'.repeat(2_000_000), iv: 'AAAAAAAAAAAAAAAA' }, a.token)).status, 413);
  assert.equal((await call('POST', `/api/conversations/${convId}/messages`, { id: 'msg_test_000004', type: 'text', ciphertext: 'not base64!!', iv: 'AAAAAAAAAAAAAAAA' }, a.token)).status, 400);

  const list = await call('GET', '/api/conversations', undefined, b.token);
  assert.equal(list.data.conversations.length, 1);
  assert.equal(list.data.conversations[0].unreadCount, 1);
  assert.equal(list.data.conversations[0].title, 'amal');
  assert.equal(list.data.conversations[0].lastMessage.id, 'msg_test_000001');
  assert.equal(list.data.conversations[0].keyInfo.wrappedBy, a.user.id);

  const msgs = await call('GET', `/api/conversations/${convId}/messages`, undefined, b.token);
  assert.equal(msgs.data.messages.length, 1);
  assert.equal(msgs.data.messages[0].ciphertext, 'QUJD'.repeat(8));

  const notifs = await call('GET', '/api/notifications', undefined, b.token);
  assert.equal(notifs.data.notifications.length, 1);
  assert.equal(notifs.data.pushEnabled, true);
  const poll = await call('GET', `/api/notifications?after=${encodeURIComponent('2000-01-01T00:00:00.000Z')}`, undefined, b.token);
  assert.equal(poll.data.notifications.length, 1);

  hubCalls.length = 0;
  await call('POST', `/api/conversations/${convId}/read`, {}, b.token);
  assert.equal(hubCalls.some((h) => JSON.stringify(h.body).includes('message:read_receipt')), true);
  const after = await call('GET', `/api/conversations/${convId}/messages`, undefined, a.token);
  assert.equal(after.data.messages[0].status, 'read');
  assert.equal((await call('GET', '/api/conversations', undefined, b.token)).data.conversations[0].unreadCount, 0);

  const group = await call('POST', '/api/conversations', { memberIds: [b.user.id, c.user.id], title: 'فريق', keys: keys([a.user.id, b.user.id, c.user.id]) }, a.token);
  assert.equal(group.data.conversation.type, 'group');
  assert.equal(group.data.conversation.members.length, 3);

  const devs = await call('GET', '/api/devices', undefined, b.token);
  assert.equal(devs.data.devices.length, 1);
  await call('PATCH', `/api/devices/${devs.data.devices[0].id}`, { pushEnabled: false }, b.token);
  assert.equal((await call('GET', '/api/notifications', undefined, b.token)).data.pushEnabled, false);
  // can't touch somebody else's device
  await call('DELETE', `/api/devices/${devs.data.devices[0].id}`, undefined, a.token);
  assert.equal((await call('GET', '/api/me', undefined, b.token)).status, 200);
  await call('POST', '/api/auth/logout', undefined, b.token);
  assert.equal((await call('GET', '/api/me', undefined, b.token)).status, 401);

  assert.equal((await call('GET', '/api/ice', undefined, a.token)).data.turn, false);
  assert.equal((await call('GET', '/api/nope', undefined, a.token)).status, 404);
});

test('developer account is reserved, admin APIs are admin-only, bans and ID edits work', async () => {
  const admin = 'zmalqpgg7777@gmail.com';
  const noSecret = await call('POST', '/api/auth/register', { ...reg(admin), setupCode: 'x' });
  assert.equal(noSecret.status, 403, 'blocked while ADMIN_SETUP_CODE is unset');

  env.ADMIN_SETUP_CODE = 's3cret-code';
  const wrong = await call('POST', '/api/auth/register', { ...reg(admin), setupCode: 'nope' });
  assert.equal(wrong.status, 403);
  const adm = await call('POST', '/api/auth/register', { ...reg(admin), setupCode: 's3cret-code' });
  assert.equal(adm.status, 200);
  assert.equal(adm.data.user.isAdmin, true);

  const user = (await call('POST', '/api/auth/register', reg('dina@test.dev', 'دينا'))).data;
  assert.equal(user.user.isAdmin, false);
  assert.equal((await call('GET', '/api/admin/stats', undefined, user.token)).status, 403);
  assert.equal((await call('GET', '/api/admin/users', undefined, user.token)).status, 403);

  const stats = await call('GET', '/api/admin/stats', undefined, adm.data.token);
  assert.equal(stats.status, 200);
  assert.ok(stats.data.users >= 2);

  const list = await call('GET', `/api/admin/users?q=${user.user.uid}`, undefined, adm.data.token);
  assert.equal(list.data.users.length, 1);
  assert.ok(!('email' in list.data.users[0]), 'the developer panel never exposes emails');
  assert.equal(list.data.users[0].handle, 'dina');

  const taken = await call('PATCH', `/api/admin/users/${user.user.id}`, { uid: adm.data.user.uid }, adm.data.token);
  assert.equal(taken.status, 409);
  const badId = await call('PATCH', `/api/admin/users/${user.user.id}`, { uid: '12' }, adm.data.token);
  assert.equal(badId.status, 400);
  const freeId = adm.data.user.uid === '55555' ? '55556' : '55555';
  assert.equal((await call('PATCH', `/api/admin/users/${user.user.id}`, { uid: freeId }, adm.data.token)).status, 200);
  assert.equal((await call('GET', '/api/me', undefined, user.token)).data.user.uid, freeId);

  assert.equal((await call('PATCH', `/api/admin/users/${adm.data.user.id}`, { banned: true }, adm.data.token)).status, 400);
  assert.equal((await call('PATCH', `/api/admin/users/${user.user.id}`, { banned: true }, adm.data.token)).status, 200);
  assert.equal((await call('GET', '/api/me', undefined, user.token)).status, 401, 'banned sessions are dropped');
  const loginBanned = await call('POST', '/api/auth/login', { identifier: 'dina@test.dev', authSecret: secret });
  assert.equal(loginBanned.status, 403);

  const t = await call('POST', '/api/support', { message: 'مرحبا، عندي مشكلة' }, adm.data.token);
  assert.equal(t.status, 200);
  const tickets = await call('GET', '/api/admin/tickets', undefined, adm.data.token);
  assert.equal(tickets.data.tickets.length, 1);
  const replied = await call('POST', `/api/admin/tickets/${tickets.data.tickets[0].id}/reply`, { reply: 'تم' }, adm.data.token);
  assert.equal(replied.status, 200);
});

test('profile photo: upload, validation, removal and fallback avatar', async () => {
  const u = await call('POST', '/api/auth/register', reg('photo@test.dev', 'سارة'));
  assert.equal(u.status, 200);
  const token = u.data.token as string;
  const photo = 'data:image/jpeg;base64,' + 'QUJD'.repeat(50);

  assert.equal((await call('PUT', '/api/me/avatar', { avatar: photo })).status, 401);
  assert.equal((await call('PUT', '/api/me/avatar', {}, token)).status, 400);
  assert.equal((await call('PUT', '/api/me/avatar', { avatar: 'https://evil.test/x.png' }, token)).status, 415);
  assert.equal((await call('PUT', '/api/me/avatar', { avatar: 'data:image/svg+xml;base64,QUJD' }, token)).status, 415);
  assert.equal(
    (await call('PUT', '/api/me/avatar', { avatar: 'data:image/jpeg;base64,' + 'A'.repeat(100_000) }, token)).status,
    413
  );

  const ok = await call('PUT', '/api/me/avatar', { avatar: photo }, token);
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.avatar, photo);
  assert.equal((await call('GET', '/api/me', undefined, token)).data.user.avatar, photo);

  const del = await call('DELETE', '/api/me/avatar', undefined, token);
  assert.equal(del.status, 200);
  assert.match(del.data.user.avatar, /^data:image\/svg\+xml/);
});

test('public settings are readable; admin settings require admin', async () => {
  const pub = await call('GET', '/api/settings');
  assert.equal(pub.status, 200);
  assert.equal(pub.data.registrationOpen, true);
  assert.equal(pub.data.maintenance, false);
  assert.equal(pub.data.announcement, '');
  assert.equal((await call('PUT', '/api/admin/settings', { maintenance: true })).status, 401);
  assert.equal((await call('GET', '/api/admin/audit')).status, 401);
});

test('message edit and delete: sender-only edit, windows, delete for me and for everyone', async () => {
  const a = (await call('POST', '/api/auth/register', reg('edit-a@test.dev'))).data;
  const b = (await call('POST', '/api/auth/register', reg('edit-b@test.dev'))).data;
  const keys = [a.user.id, b.user.id].map((userId) => ({ userId, wrappedKey: 'QUJD'.repeat(12), iv: 'AAAAAAAAAAAAAAAA' }));
  const conv = await call('POST', '/api/conversations', { memberIds: [b.user.id], keys }, a.token);
  const convId = conv.data.conversation.id;
  const body = (id: string) => ({ id, type: 'text', ciphertext: 'QUJD'.repeat(8), iv: 'AAAAAAAAAAAAAAAA' });
  const text2 = { ciphertext: 'REVG'.repeat(8), iv: 'BBBBBBBBBBBBBBBB' };

  assert.equal((await call('POST', `/api/conversations/${convId}/messages`, body('msg_edit_000001'), a.token)).status, 200);
  assert.equal((await call('POST', `/api/conversations/${convId}/messages`, body('msg_edit_000002'), a.token)).status, 200);
  assert.equal((await call('POST', `/api/conversations/${convId}/messages`, body('msg_edit_000003'), a.token)).status, 200);

  // Edit: only the sender, only valid ciphertext, marks editedAt.
  assert.equal((await call('PATCH', '/api/messages/msg_edit_000001', text2)).status, 401);
  assert.equal((await call('PATCH', '/api/messages/msg_edit_000001', text2, b.token)).status, 403);
  assert.equal((await call('PATCH', '/api/messages/msg_edit_000001', { ciphertext: 'bad!!', iv: 'BBBB' }, a.token)).status, 400);
  const edited = await call('PATCH', '/api/messages/msg_edit_000001', text2, a.token);
  assert.equal(edited.status, 200);
  assert.equal(edited.data.message.ciphertext, text2.ciphertext);
  assert.ok(edited.data.message.editedAt);
  assert.equal((await call('PATCH', '/api/messages/msg_missing_0001', text2, a.token)).status, 404);

  // Edit window (15 min): back-date the message.
  const old = new Date(Date.now() - 20 * 60_000).toISOString();
  await env.DB.prepare('UPDATE messages SET created_at = ? WHERE id = ?').bind(old, 'msg_edit_000002').run();
  assert.equal((await call('PATCH', '/api/messages/msg_edit_000002', text2, a.token)).status, 403);

  // Delete for me: hidden for b only.
  assert.equal((await call('DELETE', '/api/messages/msg_edit_000001?scope=me', undefined, b.token)).status, 200);
  const bList = await call('GET', `/api/conversations/${convId}/messages`, undefined, b.token);
  assert.ok(!bList.data.messages.some((m: any) => m.id === 'msg_edit_000001'));
  const aList = await call('GET', `/api/conversations/${convId}/messages`, undefined, a.token);
  assert.ok(aList.data.messages.some((m: any) => m.id === 'msg_edit_000001'));

  // Delete for everyone: sender only; ciphertext wiped, placeholder remains for both.
  assert.equal((await call('DELETE', '/api/messages/msg_edit_000003?scope=all', undefined, b.token)).status, 403);
  assert.equal((await call('DELETE', '/api/messages/msg_edit_000003?scope=all', undefined, a.token)).status, 200);
  const after = await call('GET', `/api/conversations/${convId}/messages`, undefined, b.token);
  const gone = after.data.messages.find((m: any) => m.id === 'msg_edit_000003');
  assert.equal(gone.deleted, true);
  assert.equal(gone.ciphertext, '');
  assert.equal((await call('PATCH', '/api/messages/msg_edit_000003', text2, a.token)).status, 409);
  // Idempotent.
  assert.equal((await call('DELETE', '/api/messages/msg_edit_000003?scope=all', undefined, a.token)).status, 200);

  // Delete-for-everyone window (48 h).
  const veryOld = new Date(Date.now() - 49 * 3_600_000).toISOString();
  await env.DB.prepare('UPDATE messages SET created_at = ? WHERE id = ?').bind(veryOld, 'msg_edit_000002').run();
  assert.equal((await call('DELETE', '/api/messages/msg_edit_000002?scope=all', undefined, a.token)).status, 403);
});

test('usernames: unique, validated, chosen once, and emails stay private', async () => {
  const bad = await call('POST', '/api/auth/register', reg('h1@test.dev', 'a', 'ab'));
  assert.equal(bad.status, 400);
  assert.equal((await call('POST', '/api/auth/register', reg('h2@test.dev', 'a', '9lives'))).status, 400);
  assert.equal((await call('POST', '/api/auth/register', reg('h3@test.dev', 'a', 'Admin'))).status, 400, 'reserved');
  const ok = await call('POST', '/api/auth/register', reg('h4@test.dev', 'Hana', 'hana_99'));
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.handle, 'hana_99');
  assert.equal(ok.data.user.email, 'h4@test.dev', 'own profile shows own email');
  const dup = await call('POST', '/api/auth/register', reg('h5@test.dev', 'Other', 'HANA_99'));
  assert.equal(dup.status, 409, 'case-insensitive uniqueness');

  const chk = await call('GET', '/api/handle/check?h=hana_99');
  assert.equal(chk.data.available, false);
  assert.equal((await call('GET', '/api/handle/check?h=free_name')).data.available, true);

  // Existing account without a handle can pick one once; it cannot be changed afterwards.
  const old = await call('POST', '/api/auth/register', reg('h6@test.dev', 'Old', 'oldname'));
  await env.DB.prepare('UPDATE users SET handle = NULL WHERE id = ?').bind(old.data.user.id).run();
  assert.equal((await call('PUT', '/api/me/handle', { handle: 'hana_99' }, old.data.token)).status, 409);
  const set = await call('PUT', '/api/me/handle', { handle: 'new_one' }, old.data.token);
  assert.equal(set.status, 200);
  assert.equal(set.data.user.handle, 'new_one');
  assert.equal((await call('PUT', '/api/me/handle', { handle: 'another1' }, old.data.token)).status, 409);

  // Other users never receive the email.
  const seen = await call('GET', '/api/users/search?q=hana_99', undefined, old.data.token);
  assert.equal(seen.data.users.length, 1);
  assert.ok(!('email' in seen.data.users[0]));
});

/** Helpers for the social tests: two users that already chat directly. */
async function pair(tag: string) {
  const a = (await call('POST', '/api/auth/register', reg(`${tag}a@test.dev`, `${tag}A`, `${tag}aa`))).data;
  const b = (await call('POST', '/api/auth/register', reg(`${tag}b@test.dev`, `${tag}B`, `${tag}bb`))).data;
  const keys = [a.user.id, b.user.id].map((userId) => ({ userId, wrappedKey: 'QUJD'.repeat(12), iv: 'AAAAAAAAAAAAAAAA' }));
  const conv = await call('POST', '/api/conversations', { memberIds: [b.user.id], keys }, a.token);
  return { a, b, convId: conv.data.conversation.id as string };
}

test('statuses: contacts only, green-ring feed, views, privacy, delete and expiry', async () => {
  const { a, b } = await pair('st');
  const stranger = (await call('POST', '/api/auth/register', reg('ststr@test.dev', 'Stranger', 'stranger1'))).data;

  assert.equal((await call('POST', '/api/statuses', { type: 'text', text: '' }, a.token)).status, 400);
  assert.equal((await call('POST', '/api/statuses', { type: 'image', image: 'http://x/y.png' }, a.token)).status, 415);
  const made = await call('POST', '/api/statuses', { type: 'text', text: 'صباح الخير', bg: '#0f766e' }, a.token);
  assert.equal(made.status, 200);
  const sid = made.data.status.id as string;

  // Contact sees it; a stranger (no direct chat) does not.
  const feedB = await call('GET', '/api/statuses', undefined, b.token);
  assert.equal(feedB.data.groups.length, 1);
  assert.equal(feedB.data.groups[0].user.id, a.user.id);
  assert.equal(feedB.data.groups[0].allViewed, false);
  assert.ok(!('email' in feedB.data.groups[0].user));
  assert.equal((await call('GET', '/api/statuses', undefined, stranger.token)).data.groups.length, 0);
  assert.equal((await call('POST', `/api/statuses/${sid}/view`, {}, stranger.token)).status, 403);

  // Viewing flips allViewed and shows up for the owner.
  assert.equal((await call('POST', `/api/statuses/${sid}/view`, {}, b.token)).status, 200);
  assert.equal((await call('GET', '/api/statuses', undefined, b.token)).data.groups[0].allViewed, true);
  const mine = await call('GET', '/api/statuses', undefined, a.token);
  assert.equal(mine.data.mine[0].viewCount, 1);
  const viewers = await call('GET', `/api/statuses/${sid}/views`, undefined, a.token);
  assert.equal(viewers.data.viewers[0].user.id, b.user.id);
  assert.equal((await call('GET', `/api/statuses/${sid}/views`, undefined, b.token)).status, 404);

  // Privacy "nobody" hides statuses from everyone.
  assert.equal((await call('PATCH', '/api/me', { statusPrivacy: 'nobody' }, a.token)).status, 200);
  assert.equal((await call('GET', '/api/statuses', undefined, b.token)).data.groups.length, 0);
  await call('PATCH', '/api/me', { statusPrivacy: 'contacts' }, a.token);

  // Blocking hides statuses too; unblocking restores.
  assert.equal((await call('POST', '/api/blocks', { userId: b.user.id }, a.token)).status, 200);
  assert.equal((await call('GET', '/api/statuses', undefined, b.token)).data.groups.length, 0);
  assert.equal((await call('DELETE', `/api/blocks/${b.user.id}`, undefined, a.token)).status, 200);
  assert.equal((await call('GET', '/api/statuses', undefined, b.token)).data.groups.length, 1);

  // Expiry after 24 h; only the owner can delete.
  await env.DB.prepare('UPDATE statuses SET expires_at = ? WHERE id = ?').bind(new Date(Date.now() - 1000).toISOString(), sid).run();
  assert.equal((await call('GET', '/api/statuses', undefined, b.token)).data.groups.length, 0);
  const second = await call('POST', '/api/statuses', { type: 'text', text: 'ثانية' }, a.token);
  assert.equal((await call('DELETE', `/api/statuses/${second.data.status.id}`, undefined, b.token)).status, 404);
  assert.equal((await call('DELETE', `/api/statuses/${second.data.status.id}`, undefined, a.token)).status, 200);
});

test('blocking: no new chats or messages, blocker is hidden from search', async () => {
  const { a, b, convId } = await pair('bl');
  const c = (await call('POST', '/api/auth/register', reg('blc@test.dev', 'C', 'blcc'))).data;
  assert.equal((await call('POST', '/api/blocks', { userId: a.user.id }, a.token)).status, 400, 'cannot block yourself');
  assert.equal((await call('POST', '/api/blocks', { userId: b.user.id }, a.token)).status, 200);
  assert.equal((await call('GET', '/api/blocks', undefined, a.token)).data.users[0].id, b.user.id);
  const msg = { id: 'msg_blocked_0001', type: 'text', ciphertext: 'QUJD'.repeat(8), iv: 'AAAAAAAAAAAAAAAA' };
  assert.equal((await call('POST', `/api/conversations/${convId}/messages`, msg, b.token)).status, 403);
  assert.equal((await call('POST', `/api/conversations/${convId}/messages`, msg, a.token)).status, 403);
  assert.equal((await call('GET', `/api/users/search?q=${a.user.uid}`, undefined, b.token)).data.users.length, 0);
  const keys = [c.user.id, a.user.id].map((userId) => ({ userId, wrappedKey: 'QUJD'.repeat(12), iv: 'AAAAAAAAAAAAAAAA' }));
  assert.equal((await call('POST', '/api/conversations', { memberIds: [a.user.id], keys }, c.token)).status, 200, 'unrelated users still chat');
  await call('DELETE', `/api/blocks/${b.user.id}`, undefined, a.token);
  assert.equal((await call('POST', `/api/conversations/${convId}/messages`, msg, b.token)).status, 200);
});

test('groups: roles, add/remove, rename, leave with ownership transfer, delete', async () => {
  const mk = async (n: string) => (await call('POST', '/api/auth/register', reg(`g${n}@test.dev`, `G${n}`, `gg${n}x`))).data;
  const [o, m1, m2, m3] = [await mk('o'), await mk('p'), await mk('q'), await mk('r')];
  const key = (userId: string) => ({ userId, wrappedKey: 'QUJD'.repeat(12), iv: 'AAAAAAAAAAAAAAAA' });
  const created = await call('POST', '/api/conversations', { memberIds: [m1.user.id, m2.user.id], title: 'فريق', keys: [o, m1, m2].map((u) => key(u.user.id)) }, o.token);
  assert.equal(created.status, 200);
  const cid = created.data.conversation.id as string;
  assert.equal(created.data.conversation.createdBy, o.user.id);
  assert.equal(created.data.conversation.members.find((x: any) => x.id === o.user.id).role, 'admin');

  // Rename / add: admins only.
  assert.equal((await call('PATCH', `/api/conversations/${cid}`, { title: 'جديد' }, m1.token)).status, 403);
  assert.equal((await call('PATCH', `/api/conversations/${cid}`, { title: 'اسم جديد' }, o.token)).data.conversation.title, 'اسم جديد');
  assert.equal((await call('POST', `/api/conversations/${cid}/members`, { members: [key(m3.user.id)] }, m1.token)).status, 403);
  const added = await call('POST', `/api/conversations/${cid}/members`, { members: [key(m3.user.id)] }, o.token);
  assert.equal(added.status, 200);
  assert.equal(added.data.conversation.members.length, 4);
  assert.equal((await call('POST', `/api/conversations/${cid}/members`, { members: [key(m3.user.id)] }, o.token)).status, 400, 'already a member');

  // Roles: only the owner promotes; an admin can add but cannot remove other admins.
  assert.equal((await call('PATCH', `/api/conversations/${cid}/members/${m1.user.id}`, { role: 'admin' }, m2.token)).status, 403);
  assert.equal((await call('PATCH', `/api/conversations/${cid}/members/${m1.user.id}`, { role: 'admin' }, o.token)).status, 200);
  assert.equal((await call('DELETE', `/api/conversations/${cid}/members/${o.user.id}`, undefined, m1.token)).status, 403, 'owner cannot be removed');
  assert.equal((await call('DELETE', `/api/conversations/${cid}/members/${m2.user.id}`, undefined, m3.token)).status, 403, 'plain members cannot remove');
  assert.equal((await call('DELETE', `/api/conversations/${cid}/members/${m2.user.id}`, undefined, m1.token)).status, 200);
  assert.equal((await call('GET', `/api/conversations/${cid}/messages`, undefined, m2.token)).status, 403, 'removed member loses access');

  // Owner leaves: ownership moves to the first admin.
  assert.equal((await call('POST', `/api/conversations/${cid}/leave`, {}, o.token)).status, 200);
  const after = await call('GET', `/api/conversations/${cid}`, undefined, m1.token);
  assert.equal(after.data.conversation.createdBy, m1.user.id);
  assert.equal(after.data.conversation.members.length, 2);

  // Delete for everyone: owner only.
  assert.equal((await call('DELETE', `/api/conversations/${cid}?scope=all`, undefined, m3.token)).status, 403);
  assert.equal((await call('DELETE', `/api/conversations/${cid}?scope=all`, undefined, m1.token)).status, 200);
  assert.equal((await call('GET', `/api/conversations/${cid}`, undefined, m1.token)).status, 404);
});

test('clear chat for me, profile edit and account deletion', async () => {
  const { a, b, convId } = await pair('pr');
  const msg = (id: string) => ({ id, type: 'text', ciphertext: 'QUJD'.repeat(8), iv: 'AAAAAAAAAAAAAAAA' });
  await call('POST', `/api/conversations/${convId}/messages`, msg('msg_clear_000001'), a.token);

  // Clearing hides the chat and its history for me only; a new message brings it back with just the new text.
  assert.equal((await call('DELETE', `/api/conversations/${convId}`, undefined, b.token)).status, 200);
  assert.equal((await call('GET', '/api/conversations', undefined, b.token)).data.conversations.length, 0);
  assert.equal((await call('GET', '/api/conversations', undefined, a.token)).data.conversations.length, 1);
  await new Promise((r) => setTimeout(r, 5));
  await call('POST', `/api/conversations/${convId}/messages`, msg('msg_clear_000002'), a.token);
  assert.equal((await call('GET', '/api/conversations', undefined, b.token)).data.conversations.length, 1);
  const history = await call('GET', `/api/conversations/${convId}/messages`, undefined, b.token);
  assert.deepEqual(history.data.messages.map((m: any) => m.id), ['msg_clear_000002']);

  // Profile edit (username is not editable here).
  assert.equal((await call('PATCH', '/api/me', { displayName: 'x' }, a.token)).status, 400);
  const edited = await call('PATCH', '/api/me', { displayName: 'اسم جديد', bio: 'نبذة', handle: 'hacked' }, a.token);
  assert.equal(edited.status, 200);
  assert.equal(edited.data.user.displayName, 'اسم جديد');
  assert.equal(edited.data.user.bio, 'نبذة');
  assert.equal(edited.data.user.handle, 'praa', 'handle never changes through PATCH /api/me');
  assert.equal((await call('PATCH', '/api/me', {}, a.token)).status, 400);
  assert.equal((await call('PATCH', '/api/me', { statusPrivacy: 'everyone' }, a.token)).status, 400);

  // Deleting the account needs the password secret.
  assert.equal((await call('DELETE', '/api/me', { authSecret: 'wrong' }, b.token)).status, 403);
  assert.equal((await call('DELETE', '/api/me', { authSecret: secret }, b.token)).status, 200);
  assert.equal((await call('GET', '/api/me', undefined, b.token)).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { identifier: 'prb@test.dev', authSecret: secret })).status, 401);
});

test('email OTP: request, wrong/expired/reused codes, cooldown, and existing emails', async () => {
  const { setMailSenderForTests } = await import('./mailer');
  const sent: Record<string, string> = {};
  setMailSenderForTests(async (to, _subject, text) => {
    sent[to] = (text.match(/\d{6}/) || [''])[0];
  });
  env.EMAIL_VERIFICATION = 'on';
  try {
    const email = 'otp-user@test.dev';
    const body = (code?: string) => ({ ...reg(email, 'Otp', 'otpuser'), code });

    // Registering without a code is refused.
    assert.equal((await call('POST', '/api/auth/register', body())).status, 400);

    // Request a code; a second request inside 60s is refused.
    assert.equal((await call('POST', '/api/auth/otp/request', { email })).status, 200);
    assert.equal((await call('POST', '/api/auth/otp/request', { email })).status, 429);
    const code = sent[email];
    assert.match(code, /^\d{6}$/);

    // Wrong code is refused and counts an attempt.
    const wrong = code === '000000' ? '111111' : '000000';
    assert.equal((await call('POST', '/api/auth/register', body(wrong))).status, 400);

    // Correct code creates the account; the same code cannot be reused.
    assert.equal((await call('POST', '/api/auth/register', body(code))).status, 200);
    assert.equal((await call('POST', '/api/auth/register', { ...reg('otp-user2@test.dev', 'Two', 'otpuser2'), code })).status, 400);

    // An email that already has an account cannot request a code.
    assert.equal((await call('POST', '/api/auth/otp/request', { email })).status, 409);

    // Too many wrong attempts lock the code.
    const other = 'otp-lock@test.dev';
    await call('POST', '/api/auth/otp/request', { email: other });
    await env.DB.prepare('UPDATE email_otps SET created_at = ? WHERE email = ?').bind(new Date(Date.now() - 120000).toISOString(), other).run();
    for (let i = 0; i < 5; i++) await call('POST', '/api/auth/register', { ...reg(other, 'L', 'lockuser'), code: '999999' });
    assert.equal((await call('POST', '/api/auth/register', { ...reg(other, 'L', 'lockuser'), code: sent[other] })).status, 429);
  } finally {
    setMailSenderForTests(null);
    env.EMAIL_VERIFICATION = 'off';
  }
});
