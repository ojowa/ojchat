import { AES } from '@stablelib/aes';
import { GCM } from '@stablelib/gcm';

import { bytesToHex, concatBytes, hexToBytes } from './primitives';

/**
 * Bare React Native replacement for the `expo-crypto` APIs this app used.
 *
 * AES-256-GCM is implemented with @stablelib (pure JavaScript, no native
 * dependency), so encrypted payloads stay wire-compatible with data that was
 * produced by the previous expo-crypto implementation (same IV size, same
 * 16-byte tag, same hex key encoding).
 *
 * Randomness comes from the global `crypto.getRandomValues`, which is
 * provided in React Native by importing `react-native-get-random-values`
 * at the very top of `index.ts`.
 */

const GCM_TAG_LENGTH = 12; // nonce length
const TAG_LENGTH = 16;

function webCrypto(): Crypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error(
      'crypto.getRandomValues is not available. Make sure "react-native-get-random-values" is imported before any other module.',
    );
  }
  return c;
}

/** Fills `array` with cryptographically secure random values (expo-crypto compatible). */
export function getRandomValues<T extends Uint8Array>(array: T): T {
  webCrypto().getRandomValues(array);
  return array;
}

/** RFC 4122 v4 UUID (expo-crypto compatible). */
export function randomUUID(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  const bytes = getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** AES key handle, importable from hex (matches expo-crypto's AESEncryptionKey.import). */
export class AESEncryptionKey {
  private constructor(readonly raw: Uint8Array) {}

  static import(key: string, encoding: 'hex' | 'utf8' = 'hex'): AESEncryptionKey {
    let bytes: Uint8Array;
    if (encoding === 'hex') {
      bytes = hexToBytes(key);
    } else {
      bytes = new TextEncoder().encode(key);
    }
    if (bytes.length !== 16 && bytes.length !== 24 && bytes.length !== 32) {
      throw new Error(`Invalid AES key length: ${bytes.length} bytes`);
    }
    return new AESEncryptionKey(bytes);
  }
}

/** IV + ciphertext + tag triplet (matches expo-crypto's AESSealedData). */
export class AESSealedData {
  private constructor(
    private readonly ivBytes: Uint8Array,
    private readonly ciphertextBytes: Uint8Array,
    private readonly tagBytes: Uint8Array,
  ) {}

  static fromParts(iv: Uint8Array, ciphertext: Uint8Array, tag: Uint8Array): AESSealedData {
    return new AESSealedData(iv, ciphertext, tag);
  }

  async iv(): Promise<Uint8Array> {
    return this.ivBytes;
  }

  async ciphertext(): Promise<Uint8Array> {
    return this.ciphertextBytes;
  }

  async tag(): Promise<Uint8Array> {
    return this.tagBytes;
  }
}

export interface AESencryptOptions {
  nonce?: { bytes: Uint8Array };
  additionalData?: Uint8Array;
}

export interface AESdecryptOptions {
  output?: 'bytes';
  additionalData?: Uint8Array;
}

/** AES-GCM encryption (expo-crypto compatible signature). */
export async function aesEncryptAsync(
  plaintext: Uint8Array,
  key: AESEncryptionKey,
  options: AESencryptOptions = {},
): Promise<AESSealedData> {
  const iv = options.nonce?.bytes ?? getRandomValues(new Uint8Array(GCM_TAG_LENGTH));
  if (iv.length !== GCM_TAG_LENGTH) {
    throw new Error(`AES-GCM requires a ${GCM_TAG_LENGTH}-byte nonce, got ${iv.length}`);
  }
  const gcm = new GCM(new AES(key.raw));
  try {
    // seal() returns ciphertext with the 16-byte authentication tag appended.
    const sealed = gcm.seal(iv, plaintext, options.additionalData);
    const ciphertext = sealed.subarray(0, sealed.length - TAG_LENGTH);
    const tag = sealed.subarray(sealed.length - TAG_LENGTH);
    return AESSealedData.fromParts(iv, ciphertext, tag);
  } finally {
    gcm.clean();
  }
}

/** AES-GCM decryption (expo-crypto compatible signature). Throws when authentication fails. */
export async function aesDecryptAsync(
  sealed: AESSealedData,
  key: AESEncryptionKey,
  options: AESdecryptOptions = {},
): Promise<Uint8Array> {
  const iv = await sealed.iv();
  const ciphertext = await sealed.ciphertext();
  const tag = await sealed.tag();
  const gcm = new GCM(new AES(key.raw));
  try {
    const plaintext = gcm.open(iv, concatBytes(ciphertext, tag), options.additionalData);
    if (plaintext === null) {
      throw new Error('AES-GCM decryption failed: authentication tag mismatch');
    }
    return plaintext;
  } finally {
    gcm.clean();
  }
}
