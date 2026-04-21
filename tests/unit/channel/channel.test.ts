// tests/unit/channel/channel.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("Channel — SW heartbeat (LIFE-02)", () => {
  afterEach(() => vi.useRealTimers());

  it("emits CHANNEL_DEAD after timeoutMs when no CAPABILITY pong arrives", () => {
    vi.useFakeTimers();
    const ep = makeFakeEndpoint();
    const ch = createChannel(ep, {
      channelId: "hb-1",
      heartbeat: { intervalMs: 10_000, timeoutMs: 30_000 },
    });
    const errors: unknown[] = [];
    ch.on("error", (e) => errors.push(e));

    // Advance past one heartbeat interval to trigger the ping
    vi.advanceTimersByTime(10_001);
    // Initial CAPABILITY (sent on construction) + heartbeat ping CAPABILITY
    expect(ep.sent.length).toBeGreaterThanOrEqual(2);

    // Advance past the timeout without any pong arriving
    vi.advanceTimersByTime(30_001);
    expect(errors).toHaveLength(1);
    expect((errors[0] as { code: string }).code).toBe("CHANNEL_DEAD");
  });

  it("does NOT emit CHANNEL_DEAD when CAPABILITY pong arrives before timeout", () => {
    vi.useFakeTimers();
    const ep = makeFakeEndpoint();
    const ch = createChannel(ep, {
      channelId: "hb-2",
      heartbeat: { intervalMs: 10_000, timeoutMs: 30_000 },
    });
    const errors: unknown[] = [];
    ch.on("error", (e) => errors.push(e));

    // Complete the initial handshake so #remoteCap is set (isPostHandshake check works)
    ep.simulateMessage({
      [FRAME_MARKER]: 1,
      channelId: "hb-2",
      streamId: 0,
      seqNum: 0,
      type: "CAPABILITY",
      protocolVersion: PROTOCOL_VERSION,
      sab: false,
      transferableStreams: false,
    });

    // Advance past one interval so the ping is sent and timeout is armed
    vi.advanceTimersByTime(10_001);

    // Simulate pong: a second CAPABILITY frame arriving from the remote before timeout.
    // Because #remoteCap is now set, this is recognized as a post-handshake pong.
    ep.simulateMessage({
      [FRAME_MARKER]: 1,
      channelId: "hb-2",
      streamId: 0,
      seqNum: 0,
      type: "CAPABILITY",
      protocolVersion: PROTOCOL_VERSION,
      sab: false,
      transferableStreams: false,
    });

    // Advance well past what the timeout would have been — no CHANNEL_DEAD expected
    vi.advanceTimersByTime(30_001);
    expect(errors).toHaveLength(0);
    ch.close();
  });

  it("heartbeat timers are cleared after channel.close()", () => {
    vi.useFakeTimers();
    const ep = makeFakeEndpoint();
    const ch = createChannel(ep, {
      channelId: "hb-3",
      heartbeat: { intervalMs: 10_000, timeoutMs: 30_000 },
    });
    const errors: unknown[] = [];
    ch.on("error", (e) => errors.push(e));

    ch.close();
    // Advance well past any interval + timeout combination
    vi.advanceTimersByTime(200_000);
    expect(errors).toHaveLength(0);
  });
});
