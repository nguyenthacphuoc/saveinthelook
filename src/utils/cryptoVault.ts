export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  salt: string;
  algorithm: 'AES-256-GCM';
}

function getWebCrypto(): Crypto {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    return globalThis.crypto;
  }
  throw new Error('Web Crypto API is unavailable in this environment');
}

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveAesKey(passphrase: string, saltBytes: Uint8Array): Promise<CryptoKey> {
  const cryptoApi = getWebCrypto();
  const enc = new TextEncoder();
  const baseKey = await cryptoApi.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );

  return cryptoApi.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes as unknown as BufferSource,
      iterations: 100_000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptVaultText(
  plaintext: string,
  passphrase: string,
): Promise<EncryptedPayload> {
  const cryptoApi = getWebCrypto();
  const salt = cryptoApi.getRandomValues(new Uint8Array(16));
  const iv = cryptoApi.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(passphrase, salt);
  const encoded = new TextEncoder().encode(plaintext);

  const encryptedBuf = await cryptoApi.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    encoded,
  );

  return {
    ciphertext: toBase64(new Uint8Array(encryptedBuf)),
    iv: toBase64(iv),
    salt: toBase64(salt),
    algorithm: 'AES-256-GCM',
  };
}

export async function decryptVaultText(
  payload: EncryptedPayload,
  passphrase: string,
): Promise<string> {
  const cryptoApi = getWebCrypto();
  const salt = fromBase64(payload.salt);
  const iv = fromBase64(payload.iv);
  const ciphertext = fromBase64(payload.ciphertext);
  const key = await deriveAesKey(passphrase, salt);

  const decryptedBuf = await cryptoApi.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    ciphertext as unknown as BufferSource,
  );

  return new TextDecoder().decode(decryptedBuf);
}

export async function sha256Hex(content: string): Promise<string> {
  const cryptoApi = getWebCrypto();
  const digest = await cryptoApi.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(content),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
