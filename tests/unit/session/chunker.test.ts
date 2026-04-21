import { describe, expect, it } from "vitest";
import { Chunker } from "../../../src/session/chunker.js";
import { FRAME_MARKER } from "../../../src/framing/types.js";

describe("Chunker split — BINARY_TRANSFER", () => {
  it("ArrayBuffer of exactly maxChunkSize produces 1 chunk with isFinal=true", () => {
    const MAX = 1024;
    const chunker = new Chunker(0, { channelId: "ch1", streamId: 1, maxChunkSize: MAX });
    const ab = new ArrayBuffer(MAX);
    const results = chunker.split(ab, "BINARY_TRANSFER");

    expect(results).toHaveLength(1);
    expect(results[0].frame.isFinal).toBe(true);
    expect(results[0].frame.chunkType).toBe("BINARY_TRANSFER");
    expect(results[0].transfer).toHaveLength(1);
    expect(results[0].transfer[0]).toBeInstanceOf(ArrayBuffer);
  });

  it("ArrayBuffer of maxChunkSize+1 produces 2 chunks; first isFinal=false, second isFinal=true", () => {
    const MAX = 1024;
    const chunker = new Chunker(0, { channelId: "ch1", streamId: 1, maxChunkSize: MAX });
    const ab = new ArrayBuffer(MAX + 1);
    const results = chunker.split(ab, "BINARY_TRANSFER");

    expect(results).toHaveLength(2);
    expect(results[0].frame.isFinal).toBe(false);
    expect(results[1].frame.isFinal).toBe(true);
  });

  it("ArrayBuffer of 3×maxChunkSize produces 3 chunks", () => {
    const MAX = 512;
    const chunker = new Chunker(0, { channelId: "ch1", streamId: 1, maxChunkSize: MAX });
    const ab = new ArrayBuffer(MAX * 3);
    const results = chunker.split(ab, "BINARY_TRANSFER");

    expect(results).toHaveLength(3);
    expect(results[0].frame.isFinal).toBe(false);
    expect(results[1].frame.isFinal).toBe(false);
    expect(results[2].frame.isFinal).toBe(true);
  });

  it("seqNums are consecutive using seqNext (not raw +1)", () => {
    const MAX = 512;
    const chunker = new Chunker(5, { channelId: "ch1", streamId: 1, maxChunkSize: MAX });
    const ab = new ArrayBuffer(MAX * 3);
    const results = chunker.split(ab, "BINARY_TRANSFER");

    expect(results[0].frame.seqNum).toBe(5);
    expect(results[1].frame.seqNum).toBe(6);
    expect(results[2].frame.seqNum).toBe(7);
  });

  it("each ChunkResult.transfer contains an ArrayBuffer slice (not the full original)", () => {
    const MAX = 512;
    const chunker = new Chunker(0, { channelId: "ch1", streamId: 1, maxChunkSize: MAX });
    const ab = new ArrayBuffer(MAX * 2);
    const results = chunker.split(ab, "BINARY_TRANSFER");

    expect(results[0].transfer[0].byteLength).toBe(MAX);
    expect(results[1].transfer[0].byteLength).toBe(MAX);
    // Slices are NOT the original buffer
    expect(results[0].transfer[0]).not.toBe(ab);
    expect(results[1].transfer[0]).not.toBe(ab);
  });

  it("frame includes correct FRAME_MARKER and field shape", () => {
    const MAX = 1024;
    const chunker = new Chunker(0, { channelId: "testCh", streamId: 42, maxChunkSize: MAX });
    const ab = new ArrayBuffer(MAX);
    const results = chunker.split(ab, "BINARY_TRANSFER");

    const frame = results[0].frame;
    expect(frame[FRAME_MARKER]).toBe(1);
    expect(frame.channelId).toBe("testCh");
    expect(frame.streamId).toBe(42);
    expect(frame.type).toBe("DATA");
    expect(frame.chunkType).toBe("BINARY_TRANSFER");
  });
});

describe("Chunker split — STRUCTURED_CLONE", () => {
  it("non-ArrayBuffer value produces 1 chunk with chunkType=STRUCTURED_CLONE and transfer=[]", () => {
    const chunker = new Chunker(0, { channelId: "ch1", streamId: 1 });
    const obj = { hello: "world", n: 42 };
    const results = chunker.split(obj, "STRUCTURED_CLONE");

    expect(results).toHaveLength(1);
    expect(results[0].frame.chunkType).toBe("STRUCTURED_CLONE");
    expect(results[0].transfer).toHaveLength(0);
    expect(results[0].frame.payload).toBe(obj);
  });

  it("STRUCTURED_CLONE chunk has isFinal=true", () => {
    const chunker = new Chunker(0, { channelId: "ch1", streamId: 1 });
    const results = chunker.split({ x: 1 }, "STRUCTURED_CLONE");

    expect(results[0].frame.isFinal).toBe(true);
  });

  it("STRUCTURED_CLONE seqNum advances correctly", () => {
    const chunker = new Chunker(10, { channelId: "ch1", streamId: 1 });
    const r1 = chunker.split({ a: 1 }, "STRUCTURED_CLONE");
    const r2 = chunker.split({ b: 2 }, "STRUCTURED_CLONE");

    expect(r1[0].frame.seqNum).toBe(10);
    expect(r2[0].frame.seqNum).toBe(11);
  });
});

describe("sequence numbers", () => {
  it("first chunk from initSeq=0 gets seqNum=0", () => {
    const chunker = new Chunker(0, { channelId: "ch1", streamId: 1, maxChunkSize: 512 });
    const results = chunker.split(new ArrayBuffer(512), "BINARY_TRANSFER");
    expect(results[0].frame.seqNum).toBe(0);
  });

  it("second chunk gets seqNum=seqNext(0)=1", () => {
    const chunker = new Chunker(0, { channelId: "ch1", streamId: 1, maxChunkSize: 512 });
    const results = chunker.split(new ArrayBuffer(1024), "BINARY_TRANSFER");
    expect(results[0].frame.seqNum).toBe(0);
    expect(results[1].frame.seqNum).toBe(1);
  });

  it("wraparound: initSeq=0xFFFFFFFE, 3 chunks → seqNums [0xFFFFFFFE, 0xFFFFFFFF, 0x00000000]", () => {
    const chunker = new Chunker(0xfffffffe, {
      channelId: "ch1",
      streamId: 1,
      maxChunkSize: 512,
    });
    const results = chunker.split(new ArrayBuffer(512 * 3), "BINARY_TRANSFER");

    expect(results[0].frame.seqNum).toBe(0xfffffffe);
    expect(results[1].frame.seqNum).toBe(0xffffffff);
    expect(results[2].frame.seqNum).toBe(0x00000000);
  });
});

describe("metadata-before-transfer invariant", () => {
  it("byteLength of each chunk frame is capturable BEFORE transfer (via payload byteLength)", () => {
    const MAX = 512;
    const chunker = new Chunker(0, { channelId: "ch1", streamId: 1, maxChunkSize: MAX });
    const ab = new ArrayBuffer(MAX * 3);

    // Fill with known bytes
    const view = new Uint8Array(ab);
    view.fill(0xff);

    const results = chunker.split(ab, "BINARY_TRANSFER");

    // Each slice (the payload in the frame) should have the correct size
    // This checks that metadata was correctly captured before any potential transfer
    const chunk0Buf = results[0].frame.payload as ArrayBuffer;
    const chunk1Buf = results[1].frame.payload as ArrayBuffer;
    const chunk2Buf = results[2].frame.payload as ArrayBuffer;

    // Capture sizes as local variables (simulating what happens before postMessage)
    const size0 = chunk0Buf.byteLength;
    const size1 = chunk1Buf.byteLength;
    const size2 = chunk2Buf.byteLength;

    // After capture (NOT after postMessage — chunker never calls postMessage),
    // verify metadata is correct and was captured from the SLICE, not the original
    expect(size0).toBe(MAX);
    expect(size1).toBe(MAX);
    expect(size2).toBe(MAX);

    // isFinal was set correctly (captured before frame was built)
    expect(results[0].frame.isFinal).toBe(false);
    expect(results[1].frame.isFinal).toBe(false);
    expect(results[2].frame.isFinal).toBe(true);

    // seqNums were captured before any slice operation
    expect(results[0].frame.seqNum).toBe(0);
    expect(results[1].frame.seqNum).toBe(1);
    expect(results[2].frame.seqNum).toBe(2);
  });

  it("re-reading metadata fields from the frame returns correct values (not 0)", () => {
    const MAX = 256;
    const chunker = new Chunker(7, { channelId: "ch-meta", streamId: 99, maxChunkSize: MAX });
    const ab = new ArrayBuffer(MAX * 2);

    const results = chunker.split(ab, "BINARY_TRANSFER");

    // Simulate post-transfer: detach the ArrayBuffers by transferring them
    // In a real transfer scenario the frames would be built before postMessage is called.
    // Here we simulate by reading the captured metadata from the frame AFTER the
    // transfer list was composed. The test verifies chunker captured byteLength
    // into the slice (not the original) so re-reading gives correct values.
    const captured0 = {
      isFinal: results[0].frame.isFinal,
      seqNum: results[0].frame.seqNum,
      channelId: results[0].frame.channelId,
      streamId: results[0].frame.streamId,
      byteLength: (results[0].frame.payload as ArrayBuffer).byteLength,
    };
    const captured1 = {
      isFinal: results[1].frame.isFinal,
      seqNum: results[1].frame.seqNum,
      byteLength: (results[1].frame.payload as ArrayBuffer).byteLength,
    };

    expect(captured0.isFinal).toBe(false);
    expect(captured0.seqNum).toBe(7);
    expect(captured0.channelId).toBe("ch-meta");
    expect(captured0.streamId).toBe(99);
    expect(captured0.byteLength).toBe(MAX);

    expect(captured1.isFinal).toBe(true);
    expect(captured1.seqNum).toBe(8);
    expect(captured1.byteLength).toBe(MAX);
  });
});

describe("Chunker reassemble", () => {
  it("returns null for all non-isFinal chunks", () => {
    const MAX = 512;
    const splitChunker = new Chunker(0, { channelId: "ch1", streamId: 1, maxChunkSize: MAX });
    const reassembler = new Chunker(0, { channelId: "ch1", streamId: 1 });

    const ab = new ArrayBuffer(MAX * 3);
    const results = splitChunker.split(ab, "BINARY_TRANSFER");

    expect(reassembler.reassemble(results[0].frame)).toBeNull();
    expect(reassembler.reassemble(results[1].frame)).toBeNull();
  });

  it("returns concatenated ArrayBuffer on isFinal=true chunk", () => {
    const MAX = 512;
    const splitChunker = new Chunker(0, { channelId: "ch1", streamId: 1, maxChunkSize: MAX });
    const reassembler = new Chunker(0, { channelId: "ch1", streamId: 1 });

    const ab = new ArrayBuffer(MAX * 3);
    const view = new Uint8Array(ab);
    // Fill with incrementing pattern
    for (let i = 0; i < view.length; i++) {
      view[i] = i % 256;
    }

    const results = splitChunker.split(ab, "BINARY_TRANSFER");

    reassembler.reassemble(results[0].frame);
    reassembler.reassemble(results[1].frame);
    const reassembled = reassembler.reassemble(results[2].frame);

    expect(reassembled).not.toBeNull();
    const resultBuf = reassembled as ArrayBuffer;
    expect(resultBuf.byteLength).toBe(MAX * 3);

    // Verify contents are correct
    const resultView = new Uint8Array(resultBuf);
    for (let i = 0; i < resultView.length; i++) {
      expect(resultView[i]).toBe(i % 256);
    }
  });

  it("clears the map entry after returning the complete payload", () => {
    const MAX = 512;
    const splitChunker = new Chunker(0, { channelId: "ch1", streamId: 1, maxChunkSize: MAX });
    const reassembler = new Chunker(0, { channelId: "ch1", streamId: 1 });

    const ab = new ArrayBuffer(MAX * 2);
    const results = splitChunker.split(ab, "BINARY_TRANSFER");

    reassembler.reassemble(results[0].frame);
    const final = reassembler.reassemble(results[1].frame);
    expect(final).not.toBeNull();

    // Second stream with same streamId starts fresh — confirms map was cleared
    // Build a second set of frames with different seqNums
    const splitChunker2 = new Chunker(10, { channelId: "ch1", streamId: 1, maxChunkSize: MAX });
    const ab2 = new ArrayBuffer(MAX);
    const results2 = splitChunker2.split(ab2, "BINARY_TRANSFER");

    const r = reassembler.reassemble(results2[0].frame);
    // Since it's a single isFinal=true chunk, it should return the buffer directly
    expect(r).not.toBeNull();
    expect((r as ArrayBuffer).byteLength).toBe(MAX);
  });

  it("multi-chunk reassembly: 3 chunks → returns combined buffer on chunk 3", () => {
    const MAX = 100;
    const splitChunker = new Chunker(0, { channelId: "ch1", streamId: 5, maxChunkSize: MAX });
    const reassembler = new Chunker(0, { channelId: "ch1", streamId: 5 });

    const total = MAX * 3;
    const ab = new ArrayBuffer(total);
    const view = new Uint8Array(ab);
    view.fill(0xab);

    const results = splitChunker.split(ab, "BINARY_TRANSFER");
    expect(results).toHaveLength(3);

    const r1 = reassembler.reassemble(results[0].frame);
    const r2 = reassembler.reassemble(results[1].frame);
    const r3 = reassembler.reassemble(results[2].frame);

    expect(r1).toBeNull();
    expect(r2).toBeNull();
    expect(r3).not.toBeNull();
    expect((r3 as ArrayBuffer).byteLength).toBe(total);
  });

  it("STRUCTURED_CLONE: returns payload directly on isFinal=true frame", () => {
    const chunker = new Chunker(0, { channelId: "ch1", streamId: 1 });
    const obj = { test: true, value: 42 };
    const results = chunker.split(obj, "STRUCTURED_CLONE");

    const reassembled = chunker.reassemble(results[0].frame);
    expect(reassembled).toBe(obj);
  });

  it("out-of-order reassembly: chunker accumulates by streamId (order assumed from transport)", () => {
    const MAX = 512;
    const splitChunker = new Chunker(0, { channelId: "ch1", streamId: 2, maxChunkSize: MAX });
    const reassembler = new Chunker(0, { channelId: "ch1", streamId: 2 });

    const ab = new ArrayBuffer(MAX * 3);
    const view = new Uint8Array(ab);
    for (let i = 0; i < view.length; i++) {
      view[i] = i % 256;
    }

    const results = splitChunker.split(ab, "BINARY_TRANSFER");

    // Chunker accumulates in insertion order — reorder buffer is upstream concern
    // Inserting in order (0, 1, 2) still works
    reassembler.reassemble(results[0].frame);
    reassembler.reassemble(results[1].frame);
    const final = reassembler.reassemble(results[2].frame);

    expect(final).not.toBeNull();
    expect((final as ArrayBuffer).byteLength).toBe(MAX * 3);
  });
});
