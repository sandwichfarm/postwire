// tests/unit/channel/channel.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChannel } from "../../../src/channel/channel.js";
import { decode } from "../../../src/framing/encode-decode.js";
import { FRAME_MARKER, PROTOCOL_VERSION } from "../../../src/framing/types.js";
import type { PostMessageEndpoint } from "../../../src/transport/endpoint.js";
import { StreamError } from "../../../src/types.js";

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

describe("Channel — error event routing (OBS-02)", () => {
  it("emits StreamError(PROTOCOL_MISMATCH) on channel.on('error') when version mismatches", () => {
    const ep = makeFakeEndpoint();
    const ch = createChannel(ep, { channelId: "err-routing-1" });
    const errors: StreamError[] = [];
    ch.on("error", (e) => errors.push(e));

    // Simulate CAPABILITY frame with wrong protocolVersion
    ep.simulateMessage({
      [FRAME_MARKER]: 1,
      channelId: "err-routing-1",
      streamId: 0,
      seqNum: 0,
      type: "CAPABILITY",
      protocolVersion: 999, // mismatch
      sab: false,
      transferableStreams: false,
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("PROTOCOL_MISMATCH");
    expect(errors[0]).toBeInstanceOf(StreamError);
  });

  it("emits StreamError(DataCloneError) on channel.on('error') when postMessage throws", () => {
    // Create an endpoint whose postMessage throws a DataCloneError on the second call
    // (first call is the CAPABILITY frame on construction)
    let callCount = 0;
    const ep: PostMessageEndpoint & { sent: unknown[]; simulateMessage(d: unknown): void } = {
      sent: [],
      postMessage(msg: unknown) {
        callCount++;
        if (callCount > 1) {
          // Simulate Node DataCloneError (not a DOMException in Node)
          throw new Error("value could not be cloned");
        }
        this.sent.push(msg);
      },
      onmessage: null,
      simulateMessage(data: unknown) {
        ep.onmessage?.({ data } as MessageEvent);
      },
    };

    const ch = createChannel(ep, { channelId: "err-routing-2" });
    const errors: StreamError[] = [];
    ch.on("error", (e) => errors.push(e));

    // Open a stream (creates session, sends OPEN frame — second postMessage call which throws)
    ch.openStream();

    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("DataCloneError");
    expect(errors[0]).toBeInstanceOf(StreamError);
  });

  it("emits StreamError(CREDIT_DEADLOCK) via channel.on('error') when session stall fires", () => {
    vi.useFakeTimers();
    try {
      const ep = makeFakeEndpoint();
      const ch = createChannel(ep, {
        channelId: "err-routing-3",
        sessionOptions: {
          stallTimeoutMs: 1000,
          initialCredit: 0, // start with 0 send credit — stall timer arms immediately
        },
      });
      const errors: StreamError[] = [];
      ch.on("error", (e) => errors.push(e));

      // Simulate incoming OPEN to create session on responder side
      ep.simulateMessage({
        [FRAME_MARKER]: 1,
        channelId: "err-routing-3",
        streamId: 1,
        seqNum: 0,
        type: "OPEN",
        initCredit: 0, // 0 credit so stall timer fires
      });

      // Advance fake clock past stallTimeoutMs
      vi.advanceTimersByTime(1001);

      expect(errors.some((e) => e.code === "CREDIT_DEADLOCK")).toBe(true);
      expect(errors[0]).toBeInstanceOf(StreamError);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Channel — trace events (OBS-03)", () => {
  it("emits trace events when trace:true", () => {
    const ep = makeFakeEndpoint();
    const ch = createChannel(ep, { channelId: "trace-on", trace: true });
    const traces: unknown[] = [];
    ch.on("trace", (t) => traces.push(t));

    // Simulate inbound CAPABILITY message (triggers inbound trace)
    ep.simulateMessage({
      [FRAME_MARKER]: 1,
      channelId: "trace-on",
      streamId: 0,
      seqNum: 0,
      type: "CAPABILITY",
      protocolVersion: PROTOCOL_VERSION,
      sab: false,
      transferableStreams: false,
    });

    // Should have at least one trace event (outbound CAPABILITY on construction + inbound)
    expect(traces.length).toBeGreaterThanOrEqual(1);
    const inboundTrace = traces.find(
      (t: unknown) => (t as { direction: string }).direction === "in",
    );
    expect(inboundTrace).toBeDefined();
    expect((inboundTrace as { frameType: string }).frameType).toBe("CAPABILITY");
    expect((inboundTrace as { timestamp: number }).timestamp).toBeTypeOf("number");

    ch.close();
  });

  it("does NOT emit trace events when trace option is absent", () => {
    const ep = makeFakeEndpoint();
    const ch = createChannel(ep, { channelId: "trace-off" }); // no trace option
    const traces: unknown[] = [];
    ch.on("trace", (t) => traces.push(t));

    ep.simulateMessage({
      [FRAME_MARKER]: 1,
      channelId: "trace-off",
      streamId: 0,
      seqNum: 0,
      type: "CAPABILITY",
      protocolVersion: PROTOCOL_VERSION,
      sab: false,
      transferableStreams: false,
    });

    expect(traces).toHaveLength(0);
    ch.close();
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
