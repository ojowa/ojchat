import RNFS from 'react-native-fs';

import { base64ToBytes, bytesToBase64 } from '../../utils/base64';

const CACHE_DIR_PATH = `${RNFS.CachesDirectoryPath}/ojchat/`;

function toPath(uri: string): string {
  return uri.startsWith('file://') ? uri.slice('file://'.length) : uri;
}

async function ensureCacheDirExists(): Promise<void> {
  const exists = await RNFS.exists(CACHE_DIR_PATH);
  if (!exists) {
    await RNFS.mkdir(CACHE_DIR_PATH);
  }
}

export const fileSystem = {
  async ensureCacheDir(): Promise<string> {
    await ensureCacheDirExists();
    return CACHE_DIR_PATH;
  },

  async saveToLocal(uri: string, filename: string): Promise<string> {
    await ensureCacheDirExists();
    const dest = `${CACHE_DIR_PATH}${filename}`;
    await RNFS.moveFile(toPath(uri), dest);
    return `file://${dest}`;
  },

  async deleteFile(uri: string): Promise<void> {
    const path = toPath(uri);
    if (await RNFS.exists(path)) {
      await RNFS.unlink(path);
    }
  },

  async getFileInfo(uri: string): Promise<{ uri: string; exists: boolean; size?: number } | null> {
    const path = toPath(uri);
    if (await RNFS.exists(path)) {
      const stat = await RNFS.stat(path);
      return { uri, exists: true, size: stat.size };
    }
    return null;
  },

  async clearCache(): Promise<void> {
    if (await RNFS.exists(CACHE_DIR_PATH)) {
      await RNFS.unlink(CACHE_DIR_PATH);
    }
  },

  /** Reads a file into raw bytes (replaces expo-file-system's `File.bytes()`). */
  async readBytes(uri: string): Promise<Uint8Array> {
    const base64 = await RNFS.readFile(toPath(uri), 'base64');
    return base64ToBytes(base64);
  },

  /** Writes raw bytes to a file (replaces expo-file-system's `File.write()`). */
  async writeBytes(uri: string, bytes: Uint8Array): Promise<void> {
    await RNFS.writeFile(toPath(uri), bytesToBase64(bytes), 'base64');
  },
};
