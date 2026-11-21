import test from 'node:test';
import assert from 'node:assert/strict';
import { addToOutbox, loadOutbox, outboxKey, removeFromOutbox, type KeyValueStore, type OutboxItem } from './outbox';

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k)! : null),
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

function item(id: string, extra: Partial<OutboxItem> = {}): OutboxItem {
  return {
    id,
    conversationId: 'conv_1',
    type: 'text',
    ciphertext: 'c_' + id,
    iv: 'iv_' + id,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

test('outbox key is scoped to the user id', () => {
  assert.equal(outboxKey('u1'), 'mirsal_outbox_v1_u1');
  assert.notEqual(outboxKey('u1'), outboxKey('u2'));
});

test('add keeps insertion order and dedupes by id', () => {
  const s = memoryStore();
  const key = outboxKey('u1');
  assert.equal(addToOutbox(s, key, item('a')), true);
  assert.equal(addToOutbox(s, key, item('b')), true);
  assert.equal(addToOutbox(s, key, item('a', { ciphertext: 'updated' })), true);
  const items = loadOutbox(s, key);
  assert.deepEqual(
    items.map((x) => x.id),
    ['b', 'a']
  );
  assert.equal(items[1].ciphertext, 'updated');
});

test('remove deletes by id and ignores unknown ids', () => {
  const s = memoryStore();
  const key = outboxKey('u1');
  addToOutbox(s, key, item('a'));
  addToOutbox(s, key, item('b'));
  removeFromOutbox(s, key, 'a');
  removeFromOutbox(s, key, 'missing');
  assert.deepEqual(
    loadOutbox(s, key).map((x) => x.id),
    ['b']
  );
});

test('ciphertext larger than the limit is rejected', () => {
  const s = memoryStore();
  const key = outboxKey('u1');
  const big = item('big', { ciphertext: 'x'.repeat(200_001) });
  assert.equal(addToOutbox(s, key, big), false);
  assert.deepEqual(loadOutbox(s, key), []);
});

test('cap of 50 keeps the newest items', () => {
  const s = memoryStore();
  const key = outboxKey('u1');
  for (let i = 0; i < 55; i++) addToOutbox(s, key, item('m' + i));
  const items = loadOutbox(s, key);
  assert.equal(items.length, 50);
  assert.equal(items[0].id, 'm5');
  assert.equal(items[49].id, 'm54');
});

test('corrupt or foreign storage is ignored', () => {
  const s = memoryStore();
  const key = outboxKey('u1');
  s.data.set(key, '{not json');
  assert.deepEqual(loadOutbox(s, key), []);

  s.data.set(key, JSON.stringify({ hello: 'world' }));
  assert.deepEqual(loadOutbox(s, key), []);

  s.data.set(key, JSON.stringify([item('ok'), { id: 1, foo: 'bar' }, null, 'x']));
  assert.deepEqual(
    loadOutbox(s, key).map((x) => x.id),
    ['ok']
  );
});

test('a throwing setItem makes add return false', () => {
  const throwing: KeyValueStore = {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  };
  assert.equal(addToOutbox(throwing, outboxKey('u1'), item('a')), false);
  assert.doesNotThrow(() => removeFromOutbox(throwing, outboxKey('u1'), 'a'));
});
