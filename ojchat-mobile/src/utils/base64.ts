/**
 * Dependency-free Base64 helpers used by the file system layer
 * (react-native-fs reads/writes binary data as base64 strings).
 */

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodeChar(code: number): number {
  if (code >= 65 && code <= 90) return code - 65; // A-Z
  if (code >= 97 && code <= 122) return code - 97 + 26; // a-z
  if (code >= 48 && code <= 57) return code - 48 + 52; // 0-9
  if (code === 43) return 62; // +
  if (code === 47) return 63; // /
  return 0; // '=' padding
}

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    out += CHARS[b0 >> 2];
    out += CHARS[((b0 & 0x03) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    out += b1 === undefined ? '=' : CHARS[((b1 & 0x0f) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    out += b2 === undefined ? '=' : CHARS[b2 & 0x3f];
  }
  return out;
}

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[\r\n\s]/g, '');
  if (clean.length === 0) return new Uint8Array(0);
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const outLength = (clean.length / 4) * 3 - padding;
  const out = new Uint8Array(outLength);
  let index = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = decodeChar(clean.charCodeAt(i));
    const c1 = decodeChar(clean.charCodeAt(i + 1));
    const c2 = decodeChar(clean.charCodeAt(i + 2));
    const c3 = decodeChar(clean.charCodeAt(i + 3));
    if (index < outLength) out[index++] = (c0 << 2) | (c1 >> 4);
    if (index < outLength) out[index++] = ((c1 & 0x0f) << 4) | (c2 >> 2);
    if (index < outLength) out[index++] = ((c2 & 0x3f) << 6) | c3;
  }
  return out;
}
