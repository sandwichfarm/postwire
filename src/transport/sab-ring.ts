// src/transport/sab-ring.ts
// SPSC (Single-Producer Single-Consumer) ring buffer over SharedArrayBuffer.
//
// Layout:
//   Header (64 bytes, viewed as Int32Array of 16 slots):
//     [0] = head   — producer write position (monotonic, wraps on u32 overflow)
//     [1] = tail   — consumer read position (monotonic, wraps on u32 overflow)
//     [2] = flags  — bit 0 = closed
//     [3] = capacity — payload capacity in bytes (const)
//     [4..15] = reserved (zeroed)
//
//   Payload (bytes 64..64+capacity):
//     Ring data area. Frames are laid out contiguously.
//
// Frame layout in the ring:
//   [u32 length][u32 seq][u32 chunkType][payload bytes...]
//   - length = 0           → terminator (channel closed, consumer returns null)
//   - length = 0xFFFFFFFF  → padding-to-wrap marker; consumer skips and restarts at offset 0
//   - otherwise            → length is the payload byte count
//
// Producer/consumer coordination:
//   - Producer advances head via Atomics.store(int32, 0, newHead) then Atomics.notify(int32, 0, 1)
//   - Consumer waits for head change via Atomics.waitAsync(int32, 0, oldHead)
//   - Consumer advances tail via Atomics.store(int32, 1, newTail) then Atomics.notify(int32, 1, 1)
//   - Producer waits for tail change via Atomics.waitAsync(int32, 1, oldTail) when full
//
// All offsets are in BYTES (head, tail are byte offsets into the payload area, monotonic).
// Ring position = (head | tail) % capacity.
// Full: head - tail === capacity (modular u32 arithmetic).

const HEADER_BYTES = 64;
const IDX_HEAD = 0; // Int32 slot index for head (byte offset)
const IDX_TAIL = 1; // Int32 slot index for tail (byte offset)
const IDX_FLAGS = 2; // Int32 slot index for flags (bit 0 = closed)
const IDX_CAPACITY = 3; // Int32 slot index for capacity (const, set at alloc)

const FRAME_HEADER_BYTES = 12; // [u32 length][u32 seq][u32 chunkType]
const TERMINATOR = 0;
const PADDING_MARKER = 0xffff_ffff;
const FLAG_CLOSED = 1;

export interface SabRingView {
  sab: SharedArrayBuffer;
  capacity: number;
}

/**
 * Allocate a new SharedArrayBuffer-backed SPSC ring with the given capacity.
 * capacity must be at least 64 + FRAME_HEADER_BYTES to hold one minimal frame.
 */
export function allocSabRing(capacity: number): SabRingView {
  if (capacity < FRAME_HEADER_BYTES + 1) {
    throw new RangeError(`allocSabRing: capacity must be >= ${FRAME_HEADER_BYTES + 1}`);
  }
  const sab = new SharedArrayBuffer(HEADER_BYTES + capacity);
  // Write capacity into the header at construction time (const field)
  const int32 = new Int32Array(sab, 0, 16);
  Atomics.store(int32, IDX_CAPACITY, capacity);
  return { sab, capacity };
}

// ---------------------------------------------------------------------------
// Producer
// ---------------------------------------------------------------------------

export class SabRingProducer {
  readonly #int32: Int32Array;
  readonly #u8: Uint8Array;
  readonly #capacity: number;
  #closed = false;

  constructor(view: SabRingView) {
    this.#int32 = new Int32Array(view.sab, 0, 16);
    this.#u8 = new Uint8Array(view.sab, HEADER_BYTES, view.capacity);
    this.#capacity = view.capacity;
  }

  /**
   * Write a frame to the ring.
   * Returns true on success; false if timed out waiting for space.
   * timeoutMs defaults to 30_000 ms.
   */
  async write(
    payload: Uint8Array,
    seq: number,
    chunkType: number,
    timeoutMs = 30_000,
  ): Promise<boolean> {
    if (this.#closed) return false;
    const required = FRAME_HEADER_BYTES + payload.length;
    if (required > this.#capacity) {
      throw new RangeError(
        `SabRingProducer.write: frame (${required} bytes) exceeds ring capacity (${this.#capacity})`,
      );
    }

    // Acquire enough space — loop until available or timeout
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const head = Atomics.load(this.#int32, IDX_HEAD) >>> 0;
      const tail = Atomics.load(this.#int32, IDX_TAIL) >>> 0;
      const used = (head - tail) >>> 0;
      const available = this.#capacity - used;

      if (available < required) {
        // Full — wait for tail to advance
        const remaining = deadline - Date.now();
        if (remaining <= 0) return false;
        const result = await Atomics.waitAsync(this.#int32, IDX_TAIL, tail >>> 0, remaining).value;
        if (result === "timed-out") return false;
        continue;
      }

      // We have space — check if frame fits without wrapping
      const writePos = head >>> 0;
      const ringPos = writePos % this.#capacity;
      const bytesToEnd = this.#capacity - ringPos;

      if (bytesToEnd < required) {
        // Frame won't fit before the end of the ring: write padding marker at ringPos,
        // advance head by bytesToEnd to skip to the end, then restart the loop.
        // We need bytesToEnd bytes for padding (just 4 bytes actually, the marker value)
        // plus required bytes at position 0. Total needed: bytesToEnd + required.
        if (available < bytesToEnd + required) {
          // Not enough space even with wrap: wait
          const remaining = deadline - Date.now();
          if (remaining <= 0) return false;
          const result = await Atomics.waitAsync(this.#int32, IDX_TAIL, tail >>> 0, remaining)
            .value;
          if (result === "timed-out") return false;
          continue;
        }
        // Write the padding marker at current position
        this.#writeU32LE(ringPos, PADDING_MARKER);
        // Advance head by bytesToEnd (so it now points to start of buffer)
        const newHead = (writePos + bytesToEnd) >>> 0;
        Atomics.store(this.#int32, IDX_HEAD, newHead);
        Atomics.notify(this.#int32, IDX_HEAD, 1);
        // Now ringPos will be 0 — re-loop to write the actual frame there
        continue;
      }

      // Write frame at ringPos
      this.#writeU32LE(ringPos, payload.length);
      this.#writeU32LE(ringPos + 4, seq >>> 0);
      this.#writeU32LE(ringPos + 8, chunkType >>> 0);
      this.#u8.set(payload, ringPos + FRAME_HEADER_BYTES);

      // Advance head
      const newHead = (writePos + required) >>> 0;
      Atomics.store(this.#int32, IDX_HEAD, newHead);
      Atomics.notify(this.#int32, IDX_HEAD, 1);
      return true;
    }
  }

  /**
   * Write a terminator frame (length=0) and notify the consumer.
   * The consumer will return null when it reads this.
   */
  writeTerminator(): void {
    if (this.#closed) return;
    // Write 4-byte terminator at current head position
    const head = Atomics.load(this.#int32, IDX_HEAD) >>> 0;
    const ringPos = head % this.#capacity;
    this.#writeU32LE(ringPos, TERMINATOR);
    const newHead = (head + 4) >>> 0;
    Atomics.store(this.#int32, IDX_HEAD, newHead);
    Atomics.notify(this.#int32, IDX_HEAD, 1);
    this.close();
  }

  /**
   * Set the closed flag. Consumer will see FLAG_CLOSED on next read.
   */
  close(): void {
    this.#closed = true;
    Atomics.or(this.#int32, IDX_FLAGS, FLAG_CLOSED);
    Atomics.notify(this.#int32, IDX_HEAD, 1);
  }

  // Write a little-endian u32 into the u8 payload area
  #writeU32LE(byteOffset: number, value: number): void {
    const v = value >>> 0;
    this.#u8[byteOffset] = v & 0xff;
    this.#u8[byteOffset + 1] = (v >>> 8) & 0xff;
    this.#u8[byteOffset + 2] = (v >>> 16) & 0xff;
    this.#u8[byteOffset + 3] = (v >>> 24) & 0xff;
  }
}

// ---------------------------------------------------------------------------
// Consumer
// ---------------------------------------------------------------------------

export class SabRingConsumer {
  readonly #int32: Int32Array;
  readonly #u8: Uint8Array;
  readonly #capacity: number;
  #closed = false;

  constructor(view: SabRingView) {
    this.#int32 = new Int32Array(view.sab, 0, 16);
    this.#u8 = new Uint8Array(view.sab, HEADER_BYTES, view.capacity);
    this.#capacity = view.capacity;
  }

  /**
   * Read the next frame from the ring.
   * Returns { payload, seq, chunkType } on success.
   * Returns null if the ring is closed (terminator or FLAGS_CLOSED seen).
   * Returns null if timed out waiting for data (timeoutMs defaults to 30_000).
   */
  async read(
    timeoutMs = 30_000,
  ): Promise<{ payload: Uint8Array; seq: number; chunkType: number } | null> {
    if (this.#closed) return null;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const head = Atomics.load(this.#int32, IDX_HEAD) >>> 0;
      const tail = Atomics.load(this.#int32, IDX_TAIL) >>> 0;
      const available = (head - tail) >>> 0;

      if (available === 0) {
        // Check flags before waiting
        const flags = Atomics.load(this.#int32, IDX_FLAGS);
        if (flags & FLAG_CLOSED) {
          this.#closed = true;
          return null;
        }
        // Wait for head to advance
        const remaining = deadline - Date.now();
        if (remaining <= 0) return null;
        const result = await Atomics.waitAsync(this.#int32, IDX_HEAD, head >>> 0, remaining).value;
        if (result === "timed-out") return null;
        continue;
      }

      const tailPos = tail >>> 0;
      const ringPos = tailPos % this.#capacity;

      // Read the length field (u32 LE)
      const length = this.#readU32LE(ringPos);

      if (length === TERMINATOR) {
        // Terminator: channel closed
        this.#closed = true;
        return null;
      }

      if (length === PADDING_MARKER) {
        // Padding-to-wrap marker: skip to offset 0.
        // The producer wrote bytesToEnd bytes of "wasted" space here.
        // We need to advance tail by the number of bytes to end of ring.
        const bytesToEnd = this.#capacity - ringPos;
        const newTail = (tailPos + bytesToEnd) >>> 0;
        Atomics.store(this.#int32, IDX_TAIL, newTail);
        Atomics.notify(this.#int32, IDX_TAIL, 1);
        continue;
      }

      // Regular frame: read seq, chunkType, payload
      const seq = this.#readU32LE(ringPos + 4);
      const chunkType = this.#readU32LE(ringPos + 8);
      const payload = new Uint8Array(length);
      payload.set(
        this.#u8.subarray(ringPos + FRAME_HEADER_BYTES, ringPos + FRAME_HEADER_BYTES + length),
      );

      // Advance tail
      const frameSize = FRAME_HEADER_BYTES + length;
      const newTail = (tailPos + frameSize) >>> 0;
      Atomics.store(this.#int32, IDX_TAIL, newTail);
      Atomics.notify(this.#int32, IDX_TAIL, 1);

      return { payload, seq, chunkType };
    }
  }

  close(): void {
    this.#closed = true;
  }

  // Read a little-endian u32 from the u8 payload area
  #readU32LE(byteOffset: number): number {
    return (
      (this.#u8[byteOffset]! |
        (this.#u8[byteOffset + 1]! << 8) |
        (this.#u8[byteOffset + 2]! << 16) |
        (this.#u8[byteOffset + 3]! << 24)) >>>
      0
    );
  }
}
