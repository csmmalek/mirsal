import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSafetyFingerprint, decryptMessagePayload, deriveFromPassword, encryptMessagePayload,
  generateConversationKeyBytes, generateIdentityKeyPair, importConversationKey,
  unwrapConversationKey, unwrapPrivateKey, wrapConversationKey, wrapPrivateKey,
} from './crypto';

test('password derivation is deterministic and backs up the private key', async () => {
  const a = await deriveFromPassword('Layla', 'correct horse battery');
  const b = await deriveFromPassword('layla', 'correct horse battery');
  assert.equal(a.authSecret, b.authSecret);
  assert.notEqual(a.authSecret, (await deriveFromPassword('layla', 'other password')).authSecret);
  const kp = await generateIdentityKeyPair();
  const w = await wrapPrivateKey(kp.privateKeyJwk, a.wrapKey);
  assert.equal(await unwrapPrivateKey(w.ciphertext, w.iv, b.wrapKey), kp.privateKeyJwk);
});

test('conversation key is shared via ECDH; outsiders cannot open it', async () => {
  const alice = await generateIdentityKeyPair();
  const bob = await generateIdentityKeyPair();
  const eve = await generateIdentityKeyPair();
  const raw = generateConversationKeyBytes();
  const forBob = await wrapConversationKey(raw, alice.privateKeyJwk, bob.publicKeyJwk);
  const forAlice = await wrapConversationKey(raw, alice.privateKeyJwk, alice.publicKeyJwk);

  const aliceKey = await importConversationKey(raw);
  const msg = { text: 'مرحباً ليلى، هل وصل التصميم؟' };
  const { ciphertext, iv } = await encryptMessagePayload(msg, aliceKey);
  assert.ok(!ciphertext.includes('مرحبا'));

  const bobKey = await unwrapConversationKey(forBob.wrappedKey, forBob.iv, bob.privateKeyJwk, alice.publicKeyJwk);
  assert.deepEqual(await decryptMessagePayload(ciphertext, iv, bobKey), msg);
  const aliceKey2 = await unwrapConversationKey(forAlice.wrappedKey, forAlice.iv, alice.privateKeyJwk, alice.publicKeyJwk);
  assert.deepEqual(await decryptMessagePayload(ciphertext, iv, aliceKey2), msg);
  await assert.rejects(unwrapConversationKey(forBob.wrappedKey, forBob.iv, eve.privateKeyJwk, alice.publicKeyJwk));
});

test('safety number is order-independent and key-dependent', async () => {
  const a = (await generateIdentityKeyPair()).publicKeyJwk;
  const b = (await generateIdentityKeyPair()).publicKeyJwk;
  const c = (await generateIdentityKeyPair()).publicKeyJwk;
  assert.equal(await computeSafetyFingerprint([a, b]), await computeSafetyFingerprint([b, a]));
  assert.notEqual(await computeSafetyFingerprint([a, b]), await computeSafetyFingerprint([a, c]));
});
