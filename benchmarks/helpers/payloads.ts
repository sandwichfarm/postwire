// benchmarks/helpers/payloads.ts
// Payload factories for bench scenarios.

/**
 * Fill an ArrayBuffer with pseudo-random bytes using chunked getRandomValues.
 * crypto.getRandomValues is limited to 65536 bytes per call (Web Crypto spec).
 * Prevents zero-filled buffers that compress unrealistically.
 */
export function createBinaryPayload(bytes: number): ArrayBuffer {
  const buf = new Uint8Array(bytes);
  const CHUNK = 65536; // 64 KB per-call limit
  for (let offset = 0; offset < bytes; offset += CHUNK) {
    const slice = buf.subarray(offset, Math.min(offset + CHUNK, bytes));
    crypto.getRandomValues(slice);
  }
  return buf.buffer;
}

/**
 * Build a structured-clone-friendly nested object totalling approximately
 * `bytes` bytes of string content. One top-level key per ~100 bytes.
 */
export function createStructuredPayload(bytes: number): Record<string, unknown> {
  const chunkSize = 100;
  const count = Math.max(1, Math.ceil(bytes / chunkSize));
  const result: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    // Each value is chunkSize chars — ASCII, no compression shortcut
    result[`k${i}`] = Math.random()
      .toString(36)
      .slice(2)
      .padEnd(chunkSize, "x")
      .slice(0, chunkSize);
  }
  return result;
}
