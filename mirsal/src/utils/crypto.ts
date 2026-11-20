import type { DecryptedMessagePayload } from '../types/chat';

const enc = new TextEncoder();
const dec = new TextDecoder();

function subtle(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is unavailable (HTTPS is required)');
  return globalThis.crypto.subtle;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ---------------- Password -> (login secret, key-wrapping key) ---------------- */

const KDF_ITERATIONS = 150_000;

/**
 * One PBKDF2 run yields 64 bytes: the first half is the login secret sent to the server
 * (which only stores a hash of it); the second half never leaves the device and wraps the
 * private key backup. The server therefore cannot decrypt anyone's key backup.
 */
export async function deriveFromPassword(
  username: string,
  password: string
): Promise<{ authSecret: string; wrapKey: CryptoKey }> {
  const s = subtle();
  const base = await s.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(
    await s.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', iterations: KDF_ITERATIONS, salt: enc.encode(`mirsal-v1|${username.toLowerCase()}`) },
      base,
      512
    )
  );
  const wrapKey = await s.importKey('raw', bits.slice(32), { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { authSecret: bytesToBase64(bits.slice(0, 32)), wrapKey };
}

/* --------------------------- Identity key pair --------------------------- */

export async function generateIdentityKeyPair(): Promise<{ publicKeyJwk: string; privateKeyJwk: string }> {
  const s = subtle();
  const pair = await s.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return {
    publicKeyJwk: JSON.stringify(pickEcPublic(await s.exportKey('jwk', pair.publicKey))),
    privateKeyJwk: JSON.stringify(await s.exportKey('jwk', pair.privateKey)),
  };
}

function pickEcPublic(jwk: JsonWebKey): JsonWebKey {
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
}

export async function encryptWithKey(plain: string, key: CryptoKey): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const buf = await subtle().encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain));
  return { ciphertext: bytesToBase64(new Uint8Array(buf)), iv: bytesToBase64(iv) };
}

export async function decryptWithKey(ciphertext: string, iv: string, key: CryptoKey): Promise<string> {
  const buf = await subtle().decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(iv) as BufferSource },
    key,
    base64ToBytes(ciphertext) as BufferSource
  );
  return dec.decode(buf);
}

/** Password-protected backup of the private key so a new device can sign in. */
export function wrapPrivateKey(privateKeyJwk: string, wrapKey: CryptoKey) {
  return encryptWithKey(privateKeyJwk, wrapKey);
}

export function unwrapPrivateKey(ciphertext: string, iv: string, wrapKey: CryptoKey): Promise<string> {
  return decryptWithKey(ciphertext, iv, wrapKey);
}

/* ------------------------- Per-conversation keys ------------------------- */

async function sharedWrapKey(myPrivateJwk: string, theirPublicJwk: string): Promise<CryptoKey> {
  const s = subtle();
  const priv = await s.importKey('jwk', JSON.parse(myPrivateJwk), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const pub = await s.importKey('jwk', JSON.parse(theirPublicJwk), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = await s.deriveBits({ name: 'ECDH', public: pub }, priv, 256);
  const material = await s.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return s.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('mirsal-keywrap-v1'), info: new Uint8Array(0) },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export function generateConversationKeyBytes(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/** Wrap the raw conversation key so only `theirPublicJwk`'s owner (and the wrapper) can open it. */
export async function wrapConversationKey(
  rawKey: Uint8Array,
  myPrivateJwk: string,
  theirPublicJwk: string
): Promise<{ wrappedKey: string; iv: string }> {
  const k = await sharedWrapKey(myPrivateJwk, theirPublicJwk);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const buf = await subtle().encrypt({ name: 'AES-GCM', iv }, k, rawKey as BufferSource);
  return { wrappedKey: bytesToBase64(new Uint8Array(buf)), iv: bytesToBase64(iv) };
}

export async function unwrapConversationKey(
  wrappedKey: string,
  iv: string,
  myPrivateJwk: string,
  wrapperPublicJwk: string
): Promise<CryptoKey> {
  const k = await sharedWrapKey(myPrivateJwk, wrapperPublicJwk);
  const raw = await subtle().decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(iv) as BufferSource },
    k,
    base64ToBytes(wrappedKey) as BufferSource
  );
  return importConversationKey(new Uint8Array(raw));
}

/**
 * Opens the wrapped conversation key and returns its raw bytes. Used only when an existing member re-wraps the
 * key for someone newly added to a group; the bytes are never stored (the cached CryptoKey stays non-extractable).
 */
export async function unwrapConversationKeyRaw(
  wrappedKey: string,
  iv: string,
  myPrivateJwk: string,
  wrapperPublicJwk: string
): Promise<Uint8Array> {
  const k = await sharedWrapKey(myPrivateJwk, wrapperPublicJwk);
  const raw = await subtle().decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(iv) as BufferSource },
    k,
    base64ToBytes(wrappedKey) as BufferSource
  );
  return new Uint8Array(raw);
}

export function importConversationKey(raw: Uint8Array): Promise<CryptoKey> {
  return subtle().importKey('raw', raw as BufferSource, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/* ------------------------------- Messages ------------------------------- */

export function encryptMessagePayload(payload: DecryptedMessagePayload, key: CryptoKey) {
  return encryptWithKey(JSON.stringify(payload), key);
}

export async function decryptMessagePayload(ciphertext: string, iv: string, key: CryptoKey): Promise<DecryptedMessagePayload> {
  return JSON.parse(await decryptWithKey(ciphertext, iv, key)) as DecryptedMessagePayload;
}

/** Safety number from the participants' real public keys; compare it out-of-band to rule out a swapped key. */
export async function computeSafetyFingerprint(publicKeys: string[]): Promise<string> {
  const material = enc.encode(`MIRSAL-SAFETY-V1::${[...publicKeys].sort().join('|')}`);
  const digest = new Uint8Array(await subtle().digest('SHA-256', material));
  const blocks: string[] = [];
  for (let i = 0; i < 12; i++) {
    blocks.push(String(((digest[i * 2] << 8) | digest[i * 2 + 1]) % 100000).padStart(5, '0'));
  }
  return blocks.join(' ');
}
