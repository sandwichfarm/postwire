import { describe, expect, it } from "vitest";
import { decode, encode } from "../../../src/framing/encode-decode.js";
import type {
  CancelFrame,
  CapabilityFrame,
  CloseFrame,
  CreditFrame,
  DataFrame,
  OpenAckFrame,
  OpenFrame,
  ResetFrame,
} from "../../../src/framing/types.js";
import { FRAME_MARKER } from "../../../src/framing/types.js";

// ---- Fixture frames — one concrete instance per frame type ----

const openFrame: OpenFrame = {
  [FRAME_MARKER]: 1,
  type: "OPEN",
  channelId: "ch-open",
  streamId: 1,
  seqNum: 0,
  initCredit: 64,
};

const openAckFrame: OpenAckFrame = {
  [FRAME_MARKER]: 1,
  type: "OPEN_ACK",
  channelId: "ch-ack",
  streamId: 2,
  seqNum: 1,
  initCredit: 32,
};

const dataFrame: DataFrame = {
  [FRAME_MARKER]: 1,
  type: "DATA",
  channelId: "ch-data",
  streamId: 3,
  seqNum: 7,
  chunkType: "BINARY_TRANSFER",
  payload: new Uint8Array([1, 2, 3]),
  isFinal: false,
};

const creditFrame: CreditFrame = {
  [FRAME_MARKER]: 1,
  type: "CREDIT",
  channelId: "ch-credit",
  streamId: 4,
  seqNum: 2,
  credit: 16,
};

const closeFrame: CloseFrame = {
  [FRAME_MARKER]: 1,
  type: "CLOSE",
  channelId: "ch-close",
  streamId: 5,
  seqNum: 100,
  finalSeq: 99,
};

const cancelFrame: CancelFrame = {
  [FRAME_MARKER]: 1,
  type: "CANCEL",
  channelId: "ch-cancel",
  streamId: 6,
  seqNum: 50,
  reason: "cancelled by consumer",
};

const resetFrame: ResetFrame = {
  [FRAME_MARKER]: 1,
  type: "RESET",
  channelId: "ch-reset",
  streamId: 7,
  seqNum: 10,
  reason: "protocol error",
};

const capabilityFrame: CapabilityFrame = {
  [FRAME_MARKER]: 1,
  type: "CAPABILITY",
  channelId: "ch-cap",
  streamId: 0,
  seqNum: 0,
  protocolVersion: 1,
  sab: false,
  transferableStreams: true,
};

// ---- Round-trip tests for all 8 frame types ----

describe("encode/decode round-trip", () => {
  it("encode returns the same object (identity in Phase 1)", () => {
    expect(encode(openFrame)).toBe(openFrame as unknown as Record<string, unknown>);
  });

  it("OPEN frame round-trips correctly", () => {
    expect(decode(encode(openFrame))).toEqual(openFrame);
  });

  it("OPEN_ACK frame round-trips correctly", () => {
    expect(decode(encode(openAckFrame))).toEqual(openAckFrame);
  });

  it("DATA frame round-trips correctly", () => {
    expect(decode(encode(dataFrame))).toEqual(dataFrame);
  });

  it("CREDIT frame round-trips correctly", () => {
    expect(decode(encode(creditFrame))).toEqual(creditFrame);
  });

  it("CLOSE frame round-trips correctly", () => {
    expect(decode(encode(closeFrame))).toEqual(closeFrame);
  });

  it("CANCEL frame round-trips correctly", () => {
    expect(decode(encode(cancelFrame))).toEqual(cancelFrame);
  });

  it("RESET frame round-trips correctly", () => {
    expect(decode(encode(resetFrame))).toEqual(resetFrame);
  });

  it("CAPABILITY frame round-trips correctly", () => {
    expect(decode(encode(capabilityFrame))).toEqual(capabilityFrame);
  });

  it("round-trips all 8 frame types in a batch", () => {
    const frames = [
      openFrame,
      openAckFrame,
      dataFrame,
      creditFrame,
      closeFrame,
      cancelFrame,
      resetFrame,
      capabilityFrame,
    ];
    for (const f of frames) {
      expect(decode(encode(f))).toEqual(f);
    }
  });
});

// ---- Null-return tests ----

describe("decode returns null for invalid/non-frame inputs", () => {
  it("returns null for null input", () => {
    expect(decode(null)).toBeNull();
  });

  it("returns null for string input", () => {
    expect(decode("hello")).toBeNull();
  });

  it("returns null for number input", () => {
    expect(decode(42)).toBeNull();
  });

  it("returns null for empty object (no marker)", () => {
    expect(decode({})).toBeNull();
  });

  it("returns null for object with marker but unknown type", () => {
    expect(
      decode({ [FRAME_MARKER]: 1, type: "UNKNOWN", channelId: "x", streamId: 1, seqNum: 0 }),
    ).toBeNull();
  });

  it("returns null for DATA frame missing payload", () => {
    expect(
      decode({ [FRAME_MARKER]: 1, type: "DATA", channelId: "x", streamId: 1, seqNum: 0 }),
    ).toBeNull();
  });

  it("returns null for DATA frame missing isFinal", () => {
    expect(
      decode({
        [FRAME_MARKER]: 1,
        type: "DATA",
        channelId: "x",
        streamId: 1,
        seqNum: 0,
        payload: "something",
      }),
    ).toBeNull();
  });

  it("returns null for object without the FRAME_MARKER", () => {
    expect(decode({ type: "DATA", channelId: "x", streamId: 1, seqNum: 0 })).toBeNull();
  });

  it("returns null for OPEN frame missing initCredit", () => {
    expect(
      decode({ [FRAME_MARKER]: 1, type: "OPEN", channelId: "x", streamId: 1, seqNum: 0 }),
    ).toBeNull();
  });

  it("returns null for CREDIT frame missing credit field", () => {
    expect(
      decode({ [FRAME_MARKER]: 1, type: "CREDIT", channelId: "x", streamId: 1, seqNum: 0 }),
    ).toBeNull();
  });

  it("returns null for CLOSE frame missing finalSeq", () => {
    expect(
      decode({ [FRAME_MARKER]: 1, type: "CLOSE", channelId: "x", streamId: 1, seqNum: 0 }),
    ).toBeNull();
  });

  it("returns null for CANCEL frame missing reason", () => {
    expect(
      decode({ [FRAME_MARKER]: 1, type: "CANCEL", channelId: "x", streamId: 1, seqNum: 0 }),
    ).toBeNull();
  });

  it("returns null for CAPABILITY frame missing protocolVersion", () => {
    expect(
      decode({
        [FRAME_MARKER]: 1,
        type: "CAPABILITY",
        channelId: "x",
        streamId: 0,
        seqNum: 0,
        sab: false,
        transferableStreams: false,
      }),
    ).toBeNull();
  });

  it("decode never throws for any input", () => {
    const weirdInputs = [
      null,
      undefined,
      42,
      "string",
      [],
      {},
      { [FRAME_MARKER]: 1 },
      { [FRAME_MARKER]: 1, type: null },
      { [FRAME_MARKER]: 1, type: "DATA" },
      { [FRAME_MARKER]: 0, type: "OPEN", channelId: "x", streamId: 1, seqNum: 0 },
      { [FRAME_MARKER]: 1, type: "OPEN", channelId: 123, streamId: 1, seqNum: 0 },
    ];
    for (const input of weirdInputs) {
      expect(() => decode(input)).not.toThrow();
    }
  });
});
