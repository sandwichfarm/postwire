// tests/unit/channel/channel.test.ts
import { describe, expect, it, vi } from "vitest";
import { createChannel } from "../../../src/channel/channel.js";
import { decode } from "../../../src/framing/encode-decode.js";
import { FRAME_MARKER, PROTOCOL_VERSION } from "../../../src/framing/types.js";
import type { PostMessageEndpoint } from "../../../src/transport/endpoint.js";

// Minimal fake endpoint that captures postMessage calls and lets tests inject messages
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

function makeCapabilityMessage(version: number): unknown {
  return {
    [FRAME_MARKER]: 1,
    channelId: "test-channel",
    streamId: 0,
    seqNum: 0,
    type: "CAPABILITY",
    protocolVersion: version,
    sab: false,
    transferableStreams: false,
  };
}

describe("Channel — CAPABILITY handshake", () => {
  it("sends CAPABILITY frame on construction", () => {
    const ep = makeFakeEndpoint();
    createChannel(ep);
    expect(ep.sent).toHaveLength(1);
    const frame = decode(ep.sent[0]);
    expect(frame?.type).toBe("CAPABILITY");
  });

  it("CAPABILITY frame has sab: false and transferableStreams: false in Phase 3", () => {
    const ep = makeFakeEndpoint();
    createChannel(ep);
    const frame = decode(ep.sent[0]) as { sab: boolean; transferableStreams: boolean } | null;
    expect(frame?.sab).toBe(false);
    expect(frame?.transferableStreams).toBe(false);
  });

  it("CAPABILITY frame has correct protocolVersion", () => {
    const ep = makeFakeEndpoint();
    createChannel(ep);
    const frame = decode(ep.sent[0]) as { protocolVersion: number } | null;
    expect(frame?.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it("capabilityReady resolves when remote CAPABILITY has matching version", async () => {
    const ep = makeFakeEndpoint();
    const ch = createChannel(ep, { channelId: "test-channel" });
    ep.simulateMessage(makeCapabilityMessage(PROTOCOL_VERSION));
    await expect(ch.capabilityReady).resolves.toBeUndefined();
  });

  it("capabilityReady rejects with PROTOCOL_MISMATCH on version mismatch", async () => {
    const ep = makeFakeEndpoint();
    const onError = vi.fn();
    const ch = createChannel(ep, { channelId: "test-channel" });
    ch.onError(onError);
    ep.simulateMessage(makeCapabilityMessage(99));
    await expect(ch.capabilityReady).rejects.toMatchObject({ code: "PROTOCOL_MISMATCH" });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "PROTOCOL_MISMATCH" }));
  });

  it("non-library messages are ignored silently", () => {
    const ep = makeFakeEndpoint();
    const ch = createChannel(ep, { channelId: "test-channel" });
    const onError = vi.fn();
    ch.onError(onError);
    // Simulate a non-library message (no __ibf_v1__ marker)
    ep.simulateMessage({ type: "OPEN", streamId: 1 });
    expect(onError).not.toHaveBeenCalled();
  });

  it("sets onmessage handler on the endpoint", () => {
    const ep = makeFakeEndpoint();
    createChannel(ep);
    expect(ep.onmessage).toBeTypeOf("function");
  });
});

describe("Channel — CAPABILITY negotiated caps", () => {
  it("capabilities returns sab: false after successful handshake (Phase 3)", async () => {
    const ep = makeFakeEndpoint();
    const ch = createChannel(ep, { channelId: "test-channel" });
    ep.simulateMessage(makeCapabilityMessage(PROTOCOL_VERSION));
    await ch.capabilityReady;
    expect(ch.capabilities.sab).toBe(false);
    expect(ch.capabilities.transferableStreams).toBe(false);
  });
});
