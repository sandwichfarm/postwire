import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { DataFrame } from "../../../src/framing/types.js";
import { FRAME_MARKER } from "../../../src/framing/types.js";
import { ReorderBuffer } from "../../../src/session/reorder-buffer.js";

function makeFrame(seq: number): DataFrame {
  return {
    [FRAME_MARKER]: 1,
    channelId: "test-channel",
    streamId: 1,
    seqNum: seq >>> 0,
    type: "DATA",
    chunkType: "STRUCTURED_CLONE",
    payload: null,
    isFinal: false,
  };
}

describe("ReorderBuffer", () => {
  describe("in-order delivery", () => {
    it("returns [frame] when inserting the next expected frame", () => {
      const buf = new ReorderBuffer(0);
      const frame = makeFrame(0);
      const out = buf.insert(frame);
      expect(out).toEqual([frame]);
      expect(buf.nextExpected).toBe(1);
    });

    it("advances nextExpected after in-order delivery", () => {
      const buf = new ReorderBuffer(5);
      buf.insert(makeFrame(5));
      expect(buf.nextExpected).toBe(6);
      buf.insert(makeFrame(6));
      expect(buf.nextExpected).toBe(7);
    });

    it("returns empty array for out-of-order frame", () => {
      const buf = new ReorderBuffer(3);
      const out = buf.insert(makeFrame(5));
      expect(out).toEqual([]);
      expect(buf.nextExpected).toBe(3);
    });
  });

  describe("out-of-order buffering and flush", () => {
    it("buffers an out-of-order frame and flushes when gap is filled", () => {
      const buf = new ReorderBuffer(3);
      const f3 = makeFrame(3);
      const f4 = makeFrame(4);
      const f5 = makeFrame(5);

      // Insert seq=5 (out-of-order)
      expect(buf.insert(f5)).toEqual([]);
      // Insert seq=4 (out-of-order, still can't flush)
      expect(buf.insert(f4)).toEqual([]);
      // Insert seq=3 (fills gap) — flushes 3, 4, 5
      const out = buf.insert(f3);
      expect(out).toEqual([f3, f4, f5]);
      expect(buf.nextExpected).toBe(6);
    });

    it("buffers one out-of-order frame and delivers on in-order arrival", () => {
      const buf = new ReorderBuffer(3);
      const f5 = makeFrame(5);
      const f3 = makeFrame(3);
      const f4 = makeFrame(4);

      expect(buf.insert(f5)).toEqual([]);
      // Insert seq=3 (in-order) — only f3 delivered (f4 still missing)
      expect(buf.insert(f3)).toEqual([f3]);
      expect(buf.nextExpected).toBe(4);
      // Insert seq=4 — flushes f4 then f5
      const out = buf.insert(f4);
      expect(out).toEqual([f4, f5]);
      expect(buf.nextExpected).toBe(6);
    });
  });

  describe("overflow", () => {
    it("throws REORDER_OVERFLOW when buffer exceeds maxReorderBuffer", () => {
      const buf = new ReorderBuffer(0, { maxReorderBuffer: 4 });
      buf.insert(makeFrame(1));
      buf.insert(makeFrame(2));
      buf.insert(makeFrame(3));
      buf.insert(makeFrame(4));
      expect(() => buf.insert(makeFrame(5))).toThrow("REORDER_OVERFLOW");
    });

    it("does not overflow when exactly at maxReorderBuffer", () => {
      const buf = new ReorderBuffer(0, { maxReorderBuffer: 4 });
      buf.insert(makeFrame(1));
      buf.insert(makeFrame(2));
      buf.insert(makeFrame(3));
      expect(() => buf.insert(makeFrame(4))).not.toThrow();
    });

    it("uses default maxReorderBuffer of 64", () => {
      const buf = new ReorderBuffer(0);
      // Fill 64 out-of-order frames (seq 1..64)
      for (let i = 1; i <= 64; i++) {
        buf.insert(makeFrame(i));
      }
      // 65th should overflow
      expect(() => buf.insert(makeFrame(65))).toThrow("REORDER_OVERFLOW");
    });
  });

  describe("duplicate detection", () => {
    it("silently drops stale frames (seqLT-based)", () => {
      const buf = new ReorderBuffer(5);
      // nextExpected = 5, insert seq=0 which is seqLT(0, 5) — stale
      const out = buf.insert(makeFrame(0));
      expect(out).toEqual([]);
      expect(buf.nextExpected).toBe(5);
    });

    it("drops frame with seq < nextExpected after some delivery", () => {
      const buf = new ReorderBuffer(0);
      buf.insert(makeFrame(0));
      buf.insert(makeFrame(1));
      buf.insert(makeFrame(2));
      expect(buf.nextExpected).toBe(3);
      // seq=1 is now stale (already delivered)
      expect(buf.insert(makeFrame(1))).toEqual([]);
    });

    it("drops duplicate out-of-order frame (same seqNum buffered twice)", () => {
      const buf = new ReorderBuffer(3);
      const f5 = makeFrame(5);
      buf.insert(f5);
      // Insert same seq again — silent drop, no overflow
      const out = buf.insert(makeFrame(5));
      expect(out).toEqual([]);
    });
  });

  describe("wraparound — deterministic", () => {
    it("delivers 32 frames across 0xFFFFFFF0 wraparound in correct order", () => {
      const START = 0xffff_fff0;
      const COUNT = 32;
      const seqs: number[] = [];
      for (let i = 0; i < COUNT; i++) seqs.push((START + i) >>> 0);

      const buf = new ReorderBuffer(START);

      // Insert frames 0x0 through 0xF first (they'll be buffered)
      const postWrap = seqs.slice(16); // 0x00000000..0x0000000F
      const preWrap = seqs.slice(0, 16); // 0xFFFFFFF0..0xFFFFFFFF

      // Buffer post-wrap frames first (all out-of-order from START)
      for (const seq of postWrap) {
        expect(buf.insert(makeFrame(seq))).toEqual([]);
      }

      // Now insert pre-wrap frames in order — each should trigger flush
      let allDelivered: number[] = [];
      for (let i = 0; i < preWrap.length; i++) {
        const out = buf.insert(makeFrame(preWrap[i]));
        allDelivered = allDelivered.concat(out.map((f) => f.seqNum));
      }

      // After inserting the last pre-wrap frame (0xFFFFFFFF), all post-wrap frames should drain
      expect(allDelivered).toEqual(seqs);
    });
  });

  describe("fast-check fuzz: SESS-06", () => {
    it("delivers all 32 frames in order through 0xFFFFFFF0 wrap (SESS-06)", () => {
      const START = 0xffff_fff0;
      const COUNT = 32;
      const seqs: number[] = [];
      for (let i = 0; i < COUNT; i++) seqs.push((START + i) >>> 0);

      fc.assert(
        fc.property(
          fc.shuffledSubarray(seqs, { minLength: COUNT, maxLength: COUNT }),
          (shuffled) => {
            const buf = new ReorderBuffer(START);
            const delivered: number[] = [];
            for (const seq of shuffled) {
              delivered.push(...buf.insert(makeFrame(seq)).map((f) => f.seqNum));
            }
            expect(delivered).toEqual(seqs);
          },
        ),
        { numRuns: 200 },
      );
    });
  });
});
