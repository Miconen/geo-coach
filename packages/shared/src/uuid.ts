let lastTimestamp = -1;
let lastSeq = 0;

/**
 * Generates an RFC 9562 UUIDv7 string (time-ordered, monotonic within the same ms).
 * Uses Web Crypto API (`crypto.getRandomValues`) so it works in both Node and browsers.
 */
export function uuidv7(timestampMs: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);

  if (timestampMs === lastTimestamp) {
    lastSeq = (lastSeq + 1) & 0x0fff;
    if (lastSeq === 0) {
      timestampMs += 1;
      lastTimestamp = timestampMs;
    }
  } else {
    lastTimestamp = timestampMs;
    lastSeq = ((bytes[6]! & 0x0f) << 8) | bytes[7]!;
  }

  // 48-bit big-endian Unix ms timestamp
  const tsBig = BigInt(timestampMs);
  bytes[0] = Number((tsBig >> 40n) & 0xffn);
  bytes[1] = Number((tsBig >> 32n) & 0xffn);
  bytes[2] = Number((tsBig >> 24n) & 0xffn);
  bytes[3] = Number((tsBig >> 16n) & 0xffn);
  bytes[4] = Number((tsBig >> 8n) & 0xffn);
  bytes[5] = Number(tsBig & 0xffn);

  // Version 7 (0b0111) + 12-bit monotonic sequence
  bytes[6] = 0x70 | ((lastSeq >> 8) & 0x0f);
  bytes[7] = lastSeq & 0xff;

  // Variant 10xx
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  let hex = "";
  for (let i = 0; i < 16; i++) {
    hex += bytes[i]!.toString(16).padStart(2, "0");
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
