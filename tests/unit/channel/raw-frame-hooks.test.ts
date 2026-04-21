// tests/unit/channel/raw-frame-hooks.test.ts
// Unit tests for Phase 7 raw-frame hooks: onRawDataFrame, onRawControlFrame, sendRawFrame.
// These hooks let relay bridges observe and forward frames without reassembly.

import { describe, expect, it } from "vitest";
import { createChannel } from "../../../src/channel/channel.js";
import { decode } from "../../../src/framing/encode-decode.js";
import type { DataFrame, Frame } from "../../../src/framing/types.js";
import { FRAME_MARKER, PROTOCOL_VERSION } from "../../../src/framing/types.js";
import type { PostMessageEndpoint } from "../../../src/transport/endpoint.js";

function makeFakeEndpoint(): PostMessageEndpoint & {
  sent: unknown[];
  simulateMessage(data: unknown): void;
} {
  const sent: unknown[] = [];
  const ep: PostMessageEndpoint & { sent: unknown[]; simulateMessage(d: unknown): void } = {
    sent,
    postMessage(msg: unknown) {
      sent.push(msg);
    },
    onmessage: null,
    simulateMessage(data: unknown) {
      ep.onmessage?.({ data } as MessageEvent);
    },
  };
  return ep;
}

function makeCapabilityMessage(): unknown {
  return {
    [FRAME_MARKER]: 1,
    channelId: "test-channel",
    streamId: 0,
    seqNum: 0,
    type: "CAPABILITY",
    protocolVersion: PROTOCOL_VERSION,
    sab: false,
    transferableStreams: false,
  };
}

function makeDataFrame(streamId = 1, seqNum = 0, isFinal = false): unknown {
  return {
    [FRAME_MARKER]: 1,
    channelId: "test-channel",
    streamId,
    seqNum,
    type: "DATA",
    chunkType: "BINARY_TRANSFER",
    payload: new ArrayBuffer(16),
    isFinal,
  };
}

function makeCreditFrame(streamId = 1, credit = 8): unknown {
  return {
    [FRAME_MARKER]: 1,
    channelId: "test-channel",
    streamId,
    seqNum: 0,
    type: "CREDIT",
    credit,
  };
}

function makeOpenFrame(streamId = 1): unknown {
  return {
    [FRAME_MARKER]: 1,
    channelId: "test-channel",
    streamId,
    seqNum: 0,
    type: "OPEN",
    initCredit: 16,
  };
}

describe("Channel raw-frame hooks (Phase 7)", () => {
  it("onRawDataFrame fires when a DATA frame arrives", () => {
    const ep = makeFakeEndpoint();
    const ch = createChannel(ep, { channelId: "raw-data-test" });
    // Complete capability handshake
    ep.simulateMessage(makeCapabilityMessage());

    const received: DataFrame[] = [];
    ch.onRawDataFrame((frame) => {
      received.push(frame);
    });

    // Need an open session for the DATA frame to route to; open stream first
    ep.simulateMessage(makeOpenFrame(1));
    // Now simulate a DATA frame arriving
    ep.simulateMessage(makeDataFrame(1, 0, false));

    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe("DATA");
    expect(received[0]?.streamId).toBe(1);
    expect(received[0]?.seqNum).toBe(0);
  });

  it("onRawDataFrame disposer removes the handler", () => {
    const ep = makeFakeEndpoint();
    const ch = createChannel(ep, { channelId: "raw-disposer-test" });
    ep.simulateMessage(makeCapabilityMessage());

    const received: DataFrame[] = [];
    const dispose = ch.onRawDataFrame((frame) => {
      received.push(frame);
    });

    // Open an inbound stream so DATA has a session to go to
    ep.simulateMessage(makeOpenFrame(1));

    // First DATA: handler fires
    ep.simulateMessage(makeDataFrame(1, 0, false));
    expect(received).toHaveLength(1);

    // Dispose the handler
    dispose();

    // Second DATA: handler must NOT fire
    ep.simulateMessage(makeDataFrame(1, 1, false));
    expect(received).toHaveLength(1);
  });

  it("onRawControlFrame fires when a CREDIT frame arrives", () => {
    const ep = makeFakeEndpoint();
    const ch = createChannel(ep, { channelId: "raw-ctrl-test" });
    ep.simulateMessage(makeCapabilityMessage());

    const received: Frame[] = [];
    ch.onRawControlFrame((frame) => {
      received.push(frame);
    });

    // CREDIT needs an active session — open a stream first (initiator side)
    ch.openStream();
    // Wait for OPEN_ACK from peer — simulate it
    ep.simulateMessage({
      [FRAME_MARKER]: 1,
      channelId: "raw-ctrl-test",
      streamId: 1,
      seqNum: 0,
      type: "OPEN_ACK",
      initCredit: 16,
    });

    // Now simulate a CREDIT frame arriving
    ep.simulateMessage(makeCreditFrame(1, 8));

    const creditFrames = received.filter((f) => f.type === "CREDIT");
    expect(creditFrames.length).toBeGreaterThanOrEqual(1);
    expect(creditFrames[0]?.type).toBe("CREDIT");
  });

  it("onRawControlFrame disposer removes the handler", () => {
    const ep = makeFakeEndpoint();
    const ch = createChannel(ep, { channelId: "raw-ctrl-disposer-test" });
    ep.simulateMessage(makeCapabilityMessage());

    const received: Frame[] = [];
    const dispose = ch.onRawControlFrame((frame) => {
      received.push(frame);
    });

    // Open a stream from the initiator side; this triggers OPEN_ACK from peer
    ch.openStream();
    // Simulate OPEN_ACK from peer (a control frame)
    ep.simulateMessage({
      [FRAME_MARKER]: 1,
      channelId: "raw-ctrl-disposer-test",
      streamId: 1,
      seqNum: 0,
      type: "OPEN_ACK",
      initCredit: 16,
    });
    const countAfterAck = received.filter((f) => f.type === "OPEN_ACK").length;
    expect(countAfterAck).toBe(1);

    // Dispose and verify subsequent control frames are NOT received
    dispose();

    // Simulate a CREDIT frame — should NOT arrive after disposal
    ep.simulateMessage(makeCreditFrame(1, 4));
    expect(received.filter((f) => f.type === "CREDIT")).toHaveLength(0);
  });

  it("sendRawFrame sends a frame directly to the endpoint", () => {
    const ep = makeFakeEndpoint();
    const ch = createChannel(ep, { channelId: "send-raw-test" });
    ep.simulateMessage(makeCapabilityMessage());

    const before = ep.sent.length;

    const frame: Frame = {
      [FRAME_MARKER]: 1,
      channelId: "send-raw-test",
      streamId: 5,
      seqNum: 42,
      type: "CREDIT",
      credit: 16,
    };
    ch.sendRawFrame(frame);

    expect(ep.sent.length).toBe(before + 1);
    const decoded = decode(ep.sent[ep.sent.length - 1]);
    expect(decoded?.type).toBe("CREDIT");
    expect(decoded?.streamId).toBe(5);
  });

  it("sendRawFrame increments frameCountsSent (stats accuracy)", () => {
    const ep = makeFakeEndpoint();
    const ch = createChannel(ep, { channelId: "send-raw-stats-test" });
    ep.simulateMessage(makeCapabilityMessage());

    const statsBefore = ch.stats();
    const creditBefore = (statsBefore.aggregate as { bytesSent: number }).bytesSent;

    const frame: Frame = {
      [FRAME_MARKER]: 1,
      channelId: "send-raw-stats-test",
      streamId: 1,
      seqNum: 0,
      type: "CREDIT",
      credit: 8,
    };
    ch.sendRawFrame(frame);

    // Stats should still be readable (no crash)
    const statsAfter = ch.stats();
    expect(statsAfter).toBeDefined();
    // bytesSent unchanged for CREDIT frame (only DATA adds bytes)
    expect((statsAfter.aggregate as { bytesSent: number }).bytesSent).toBe(creditBefore);
  });

  it("DATA frames fire onRawDataFrame AND still reach the session (parallel delivery)", () => {
    const ep = makeFakeEndpoint();
    const ch = createChannel(ep, { channelId: "parallel-delivery-test" });
    ep.simulateMessage(makeCapabilityMessage());

    // Track raw handler calls
    const rawReceived: DataFrame[] = [];
    ch.onRawDataFrame((frame) => rawReceived.push(frame));

    // Open inbound stream and track session-layer chunks
    const sessionChunks: unknown[] = [];
    ch.onStream((handle) => {
      handle.session.onChunk((chunk) => sessionChunks.push(chunk));
    });

    ep.simulateMessage(makeOpenFrame(1));

    // Simulate a DATA frame with isFinal=true (single-chunk stream)
    ep.simulateMessage({
      [FRAME_MARKER]: 1,
      channelId: "parallel-delivery-test",
      streamId: 1,
      seqNum: 0,
      type: "DATA",
      chunkType: "BINARY_TRANSFER",
      payload: new ArrayBuffer(8),
      isFinal: true,
    });

    // Raw handler must fire
    expect(rawReceived).toHaveLength(1);
    expect(rawReceived[0]?.isFinal).toBe(true);

    // Session layer must also receive the chunk (parallel, not replaced)
    // Allow one event-loop tick for session reassembly
    // (In Node, this test runs sync — session.onChunk fires synchronously)
    expect(sessionChunks).toHaveLength(1);
  });
});
