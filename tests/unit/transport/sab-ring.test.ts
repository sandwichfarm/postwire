// src/transport/sab-ring.test.ts
// Unit tests for the SPSC ring buffer over SharedArrayBuffer.
// Runs in pure Node — no browser or worker_threads setup needed.

import { describe, expect, it } from "vitest";
import { allocSabRing, SabRingConsumer, SabRingProducer } from "../../../src/transport/sab-ring.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRing(capacity: number) {
  const view = allocSabRing(capacity);
  const producer = new SabRingProducer(view);
  const consumer = new SabRingConsumer(view);
  return { view, producer, consumer };
}

function bytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  for (let i = 0; i < n; i++) buf[i] = i & 0xff;
  return buf;
}

// ---------------------------------------------------------------------------
// Basic round-trip
// ---------------------------------------------------------------------------

describe("sab-ring: round-trip", () => {
  it("writes and reads 3 frames in order", async () => {
    const { producer, consumer } = makeRing(4096);

    const payloads = [bytes(100), bytes(200), bytes(50)];
    const seqs = [1, 2, 3];
    const chunkTypes = [0, 1, 0];

    // Write all
    for (let i = 0; i < payloads.length; i++) {
      const ok = await producer.write(payloads[i]!, seqs[i]!, chunkTypes[i]!);
      expect(ok).toBe(true);
    }

    // Read all — should arrive in order
    for (let i = 0; i < payloads.length; i++) {
      const msg = await consumer.read(1000);
      expect(msg).not.toBeNull();
      expect(msg!.seq).toBe(seqs[i]);
      expect(msg!.chunkType).toBe(chunkTypes[i]);
      expect(msg!.payload).toEqual(payloads[i]);
    }
  });

  it("preserves byte values across write/read", async () => {
    const { producer, consumer } = makeRing(1024);
    // Create a payload with all 256 byte values
    const payload = new Uint8Array(256);
    for (let i = 0; i < 256; i++) payload[i] = i;

    await producer.write(payload, 42, 3);
    const msg = await consumer.read(1000);

    expect(msg).not.toBeNull();
    expect(msg!.seq).toBe(42);
    expect(msg!.chunkType).toBe(3);
    expect(msg!.payload).toEqual(payload);
  });
});

// ---------------------------------------------------------------------------
// Wrap-around
// ---------------------------------------------------------------------------

describe("sab-ring: wrap-around", () => {
  it("handles wrap: 4 frames of 80 bytes each in a 256-byte ring", async () => {
    // Each frame: 12 header + 80 payload = 92 bytes
    // Ring capacity = 256 bytes
    // Frame 1: pos 0..91, head=92
    // Frame 2: pos 92..183, head=184
    // Frame 3: pos 184..275 — won't fit (256-184=72 < 92), writes padding at 184, head=256
    //   Then writes frame 3 at pos 0, head=92
    // Frame 4: pos 92..183, head=184
    const { producer, consumer } = makeRing(256);

    const payloads: Uint8Array[] = [];
    for (let i = 0; i < 4; i++) {
      const p = new Uint8Array(80);
      p.fill(i + 1); // distinct values so we can verify order
      payloads.push(p);
    }

    // Write first two frames (they fit without wrap)
    expect(await producer.write(payloads[0]!, 10, 0)).toBe(true);
    expect(await producer.write(payloads[1]!, 11, 0)).toBe(true);

    // Read first two frames to free space
    const m0 = await consumer.read(1000);
    const m1 = await consumer.read(1000);
    expect(m0!.seq).toBe(10);
    expect(m1!.seq).toBe(11);

    // Now write frames 3 and 4 — frame 3 will trigger a wrap
    expect(await producer.write(payloads[2]!, 12, 0)).toBe(true);
    expect(await producer.write(payloads[3]!, 13, 0)).toBe(true);

    // Read frames 3 and 4
    const m2 = await consumer.read(1000);
    const m3 = await consumer.read(1000);
    expect(m2!.seq).toBe(12);
    expect(m2!.payload).toEqual(payloads[2]);
    expect(m3!.seq).toBe(13);
    expect(m3!.payload).toEqual(payloads[3]);
  });

  it("consumer skips padding marker and reads frame at offset 0", async () => {
    // Force a wrap by writing a frame that barely doesn't fit at the current ringPos
    // Ring capacity = 128, frame size = 12 + 60 = 72 bytes
    // After writing one frame at pos 0 (head=72), read it (tail=72).
    // Remaining = 128 - 72 = 56 bytes. Write another 72-byte frame → triggers wrap.
    const { producer, consumer } = makeRing(128);

    const p1 = new Uint8Array(60);
    p1.fill(0xaa);
    const p2 = new Uint8Array(60);
    p2.fill(0xbb);

    // Write first, read first (to free space)
    await producer.write(p1, 1, 0);
    const r1 = await consumer.read(500);
    expect(r1!.seq).toBe(1);

    // Write second — should wrap
    await producer.write(p2, 2, 0);
    const r2 = await consumer.read(500);
    expect(r2!.seq).toBe(2);
    expect(r2!.payload).toEqual(p2);
  });
});

// ---------------------------------------------------------------------------
// Terminator
// ---------------------------------------------------------------------------

describe("sab-ring: terminator", () => {
  it("writeTerminator causes consumer to return null", async () => {
    const { producer, consumer } = makeRing(1024);

    // Write a real frame
    await producer.write(bytes(50), 1, 0);
    // Write terminator
    producer.writeTerminator();

    // Read the real frame
    const m1 = await consumer.read(1000);
    expect(m1).not.toBeNull();
    expect(m1!.seq).toBe(1);

    // Next read hits terminator → null
    const m2 = await consumer.read(1000);
    expect(m2).toBeNull();
  });

  it("terminator on empty ring: consumer returns null immediately", async () => {
    const { producer, consumer } = makeRing(512);
    producer.writeTerminator();
    const result = await consumer.read(1000);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Capacity full (producer timeout)
// ---------------------------------------------------------------------------

describe("sab-ring: capacity full", () => {
  it("producer.write returns false when ring is full and timeout expires", async () => {
    // Ring capacity = 64 bytes. Frame = 12 + 40 = 52 bytes.
    // First write succeeds. Second would need 52 bytes but only 12 remain → full.
    const { producer } = makeRing(64);

    const p1 = new Uint8Array(40);
    p1.fill(1);
    const ok1 = await producer.write(p1, 1, 0, 5000); // large timeout — will succeed
    expect(ok1).toBe(true);

    // Second write: ring is full (64-52=12 bytes, need 52) → must timeout
    const p2 = new Uint8Array(40);
    p2.fill(2);
    const ok2 = await producer.write(p2, 2, 0, 50); // 50 ms timeout
    expect(ok2).toBe(false); // timed out
  });
});

// ---------------------------------------------------------------------------
// Close via flags
// ---------------------------------------------------------------------------

describe("sab-ring: close", () => {
  it("producer.close() sets FLAG_CLOSED; consumer returns null on next read (empty ring)", async () => {
    const { producer, consumer } = makeRing(512);
    producer.close();
    const result = await consumer.read(200);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Fuzz: random frames, sequential consume
// ---------------------------------------------------------------------------

describe("sab-ring: fuzz", () => {
  it("50 random frames arrive intact and in order (sequential write-then-read)", async () => {
    const { producer, consumer } = makeRing(8192);

    const NUM = 50;
    const sent: Array<{ payload: Uint8Array; seq: number; chunkType: number }> = [];

    for (let i = 0; i < NUM; i++) {
      // Random size 1..200 bytes
      const size = Math.floor(Math.random() * 200) + 1;
      const payload = new Uint8Array(size);
      for (let j = 0; j < size; j++) payload[j] = Math.floor(Math.random() * 256);
      const seq = (i * 3 + 7) & 0xffff_ffff;
      const chunkType = i % 4;
      sent.push({ payload, seq, chunkType });
    }

    // Write all, then read all (sequential)
    for (const s of sent) {
      await producer.write(s.payload, s.seq, s.chunkType);
    }
    for (const s of sent) {
      const msg = await consumer.read(1000);
      expect(msg).not.toBeNull();
      expect(msg!.seq).toBe(s.seq);
      expect(msg!.chunkType).toBe(s.chunkType);
      expect(msg!.payload).toEqual(s.payload);
    }
  });

  it("50 random frames arrive intact with interleaved writes and reads", async () => {
    const { producer, consumer } = makeRing(4096);

    const NUM = 50;
    const promises: Promise<void>[] = [];

    // Write 50 frames with small delays, read them concurrently
    const received: Array<{ seq: number; chunkType: number; payload: Uint8Array }> = [];
    const allReceived = new Promise<void>((resolve) => {
      let count = 0;
      const readNext = async () => {
        while (count < NUM) {
          const msg = await consumer.read(5000);
          if (msg === null) break;
          received.push(msg);
          count++;
          if (count >= NUM) resolve();
        }
      };
      readNext().catch(() => {});
    });

    const sent: Array<{ seq: number; chunkType: number; payload: Uint8Array }> = [];
    for (let i = 0; i < NUM; i++) {
      const size = Math.floor(Math.random() * 100) + 1;
      const payload = new Uint8Array(size);
      payload.fill(i & 0xff);
      const seq = i;
      const chunkType = i % 3;
      sent.push({ seq, chunkType, payload });
      promises.push(
        (async () => {
          await producer.write(payload, seq, chunkType, 5000);
        })(),
      );
    }

    await Promise.all(promises);
    await allReceived;

    expect(received).toHaveLength(NUM);
    for (let i = 0; i < NUM; i++) {
      expect(received[i]!.seq).toBe(sent[i]!.seq);
      expect(received[i]!.payload).toEqual(sent[i]!.payload);
    }
  });
});

// ---------------------------------------------------------------------------
// allocSabRing validation
// ---------------------------------------------------------------------------

describe("sab-ring: allocSabRing", () => {
  it("throws RangeError for too-small capacity", () => {
    expect(() => allocSabRing(0)).toThrow(RangeError);
    expect(() => allocSabRing(11)).toThrow(RangeError);
  });

  it("capacity stored correctly in header", () => {
    const cap = 1024;
    const { sab } = allocSabRing(cap);
    const int32 = new Int32Array(sab, 0, 16);
    expect(Atomics.load(int32, 3)).toBe(cap); // IDX_CAPACITY = 3
  });
});
