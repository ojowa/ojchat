import { MMKV } from 'react-native-mmkv';
import { Platform } from 'react-native';
import * as Crypto from '../crypto/aesCrypto';
import { secureStorage, SecureStorageError } from './secureStorage';
import { logger } from '../../utils/logger';
import { STORAGE_KEYS } from '../../constants/storageKeys';

const MMKV_KEY_NAME = STORAGE_KEYS.MMKV_ENCRYPTION_KEY;

// react-native-mmkv v2 rejects encryption keys longer than 16 bytes, so we
// derive a 128-bit key from the 256-bit secret persisted in the keystore.
const MMKV_KEY_HEX_LENGTH = 32; // 32 hex chars = 16 bytes

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function toMMKVEncryptionKey(hexKey: string): string {
  return hexKey.slice(0, MMKV_KEY_HEX_LENGTH);
}

let storage: MMKV | null = null;
let initPromise: Promise<void> | null = null;

async function getOrCreateEncryptionKey(): Promise<string> {
  const existing = await secureStorage.get(MMKV_KEY_NAME);
  if (existing) return existing;

  const keyBytes = Crypto.getRandomValues(new Uint8Array(32));
  const key = bytesToHex(keyBytes);
  try {
    await secureStorage.set(MMKV_KEY_NAME, key);
  } catch (err) {
    if (err instanceof SecureStorageError) {
      logger.error('Failed to persist MMKV encryption key', { message: err.message });
      throw new Error(
        'Cannot safely store MMKV encryption key. Refusing to proceed with an unpersisted key — previously encrypted data would become unreadable on the next launch.',
      );
    }
    throw err;
  }
  return key;
}

function migrateOldMMKV(newStorage: MMKV): void {
  try {
    const oldMMKV = new MMKV();
    const oldKeys = oldMMKV.getAllKeys();
    if (oldKeys.length === 0) return;

    for (const key of oldKeys) {
      const value = oldMMKV.getString(key);
      if (value && !newStorage.contains(key)) {
        newStorage.set(key, value);
      }
    }
    oldMMKV.clearAll();
  } catch {
    // Old MMKV may not exist on fresh install — safe to ignore
  }
}

export function initMMKV(): Promise<void> {
  if (storage) return Promise.resolve();
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (Platform.OS === 'web') {
      storage = new MMKV({ id: STORAGE_KEYS.MMKV_ID });
    } else {
      const key = await getOrCreateEncryptionKey();
      storage = new MMKV({
        id: STORAGE_KEYS.MMKV_ID,
        encryptionKey: toMMKVEncryptionKey(key),
      });
    }
    migrateOldMMKV(storage);
  })();

  return initPromise;
}

function ensureStorage(): MMKV {
  if (!storage) {
    throw new Error('MMKV not initialized. Call initMMKV() at app startup.');
  }
  return storage;
}

export const mmkvStorage = {
  getString: (key: string): string | undefined => {
    return ensureStorage().getString(key);
  },
  set: (key: string, value: string): void => {
    ensureStorage().set(key, value);
  },
  remove: (key: string): void => {
    ensureStorage().delete(key);
  },
  contains: (key: string): boolean => {
    return ensureStorage().contains(key);
  },
  getAllKeys: (): string[] => {
    return ensureStorage().getAllKeys();
  },
  clearAll: (): void => {
    ensureStorage().clearAll();
  },
  waitForInit: (): Promise<void> => {
    return initMMKV();
  },
};
