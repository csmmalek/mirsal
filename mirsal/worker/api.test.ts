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
      sqlite.prepare(sql).run(...(params as never[]));
      return { results: [], success: true, meta: {} };
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
const reg = (email: string, displayName = email.split('@')[0]) => ({
  email,
  displayName,
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

  const found = await call('GET', '/api/users/search?q=bas', undefined, a.token);
  assert.deepEqual(found.data.users.map((u: any) => u.displayName), ['basem']);
  assert.ok(!('email' in found.data.users[0]), 'emails are never shown to other users');
  assert.equal((await call('GET', '/api/users/search?q=b', undefined, a.token)).data.users.length, 0);

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
  assert.equal(list.data.users[0].email, 'dina@test.dev');

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
