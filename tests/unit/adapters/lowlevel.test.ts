// tests/unit/adapters/lowlevel.test.ts
// Unit tests for createLowLevelStream — API-01 behaviors
// Uses a stub Channel backed by a real Session in OPEN state to avoid postMessage plumbing.

import { describe, expect, it, vi } from "vitest";
import { createLowLevelStream } from "../../../src/adapters/lowlevel.js";
import type { Channel, StreamHandle } from "../../../src/channel/channel.js";
import type { OpenAckFrame } from "../../../src/framing/types.js";
import { FRAME_MARKER } from "../../../src/framing/types.js";
import { Session } from "../../../src/session/index.js";
import { StreamError } from "../../../src/types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Build a Session that is already in OPEN state (has send credits) for unit testing. */
function makeOpenSession(channelId = "test-ch", streamId = 1): Session {
  const session = new Session({
    channelId,
    streamId,
    role: "initiator",
    stallTimeoutMs: 0, // disable stall timer in unit tests
    initialCredit: 16,
  });

  // Wire a no-op onFrameOut so the session can emit frames without error
  session.onFrameOut((_frame, _transfer) => {
    // no-op: frame discarded in unit tests
  });

  // Transition: IDLE → OPENING (by calling open())
  session.open();

  // Transition: OPENING → OPEN (by feeding OPEN_ACK)
  const openAck: OpenAckFrame = {
    [FRAME_MARKER]: 1,
    channelId,
    streamId,
    seqNum: 0,
    type: "OPEN_ACK",
    initCredit: 16,
  };
  session.receiveFrame(openAck);

  return session;
}

/** Build a stub Channel that returns a StreamHandle with the given session. */
function makeStubChannel(session?: Session): Channel {
  const sess = session ?? makeOpenSession();
  const handle: StreamHandle = { session: sess, channel: undefined as unknown as Channel };

  const channel: Channel = {
    openStream: vi.fn(() => handle),
    onStream: vi.fn(),
    close: vi.fn(),
    onError: vi.fn(),
    get capabilityReady() {
      return Promise.resolve();
    },
    get lastDataSeqOut() {
      return -1;
    },
    sendFrame: vi.fn(),
    get capabilities() {
      return { sab: false, transferableStreams: false };
    },
  } as unknown as Channel;

  return channel;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createLowLevelStream — API-01", () => {
  describe("shape", () => {
    it("returns object with send, onChunk, onClose, onError, close", () => {
      const ch = makeStubChannel();
      const ll = createLowLevelStream(ch);
      expect(typeof ll.send).toBe("function");
      expect(typeof ll.onChunk).toBe("function");
      expect(typeof ll.onClose).toBe("function");
      expect(typeof ll.onError).toBe("function");
      expect(typeof ll.close).toBe("function");
    });

    it("calls channel.openStream() on construction", () => {
      const ch = makeStubChannel();
      createLowLevelStream(ch);
      expect(ch.openStream).toHaveBeenCalledOnce();
    });

    it("forwards sessionOptions to channel.openStream()", () => {
      const ch = makeStubChannel();
      const opts = { sessionOptions: { initialCredit: 32 } };
      createLowLevelStream(ch, opts);
      expect(ch.openStream).toHaveBeenCalledWith({ initialCredit: 32 });
    });
  });

  describe("send()", () => {
    it("is async and resolves with undefined", async () => {
      const ch = makeStubChannel();
      const ll = createLowLevelStream(ch);
      const result = await ll.send("hello");
      expect(result).toBeUndefined();
    });

    it("returns a Promise", () => {
      const ch = makeStubChannel();
      const ll = createLowLevelStream(ch);
      const ret = ll.send("x");
      expect(ret).toBeInstanceOf(Promise);
    });

    it("send without transfer list resolves (STRUCTURED_CLONE path)", async () => {
      const ch = makeStubChannel();
      const ll = createLowLevelStream(ch);
      await expect(ll.send({ key: "value" })).resolves.toBeUndefined();
    });

    it("send with transfer list resolves (BINARY_TRANSFER path)", async () => {
      const ch = makeStubChannel();
      const ll = createLowLevelStream(ch);
      const buf = new ArrayBuffer(64);
      await expect(ll.send(buf, [buf])).resolves.toBeUndefined();
    });
  });

  describe("close()", () => {
    it("calls channel.close()", () => {
      const ch = makeStubChannel();
      const ll = createLowLevelStream(ch);
      ll.close();
      expect(ch.close).toHaveBeenCalledOnce();
    });

    it("is synchronous", () => {
      const ch = makeStubChannel();
      const ll = createLowLevelStream(ch);
      // Should not throw or return a Promise
      const result = ll.close();
      expect(result).toBeUndefined();
    });
  });

  describe("onChunk()", () => {
    it("registers callback — does not throw on registration", () => {
      const ch = makeStubChannel();
      const ll = createLowLevelStream(ch);
      const handler = vi.fn();
      expect(() => ll.onChunk(handler)).not.toThrow();
    });

    it("callback is not called before any data arrives", () => {
      const ch = makeStubChannel();
      const ll = createLowLevelStream(ch);
      const handler = vi.fn();
      ll.onChunk(handler);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("onError()", () => {
    it("registers callback — does not throw on registration", () => {
      const ch = makeStubChannel();
      const ll = createLowLevelStream(ch);
      const handler = vi.fn();
      expect(() => ll.onError(handler)).not.toThrow();
    });

    it("surfaces session consumer-stall error as StreamError{code:CONSUMER_STALL}", () => {
      const session = makeOpenSession();
      const ch = makeStubChannel(session);
      const ll = createLowLevelStream(ch);

      const errors: StreamError[] = [];
      ll.onError((err) => errors.push(err));

      // Simulate stall by triggering onError directly on the session
      // We do this by manually calling the internal error trigger via reset()
      session.reset("consumer-stall");

      expect(errors).toHaveLength(1);
      expect(errors[0]).toBeInstanceOf(StreamError);
      expect(errors[0]?.code).toBe("CONSUMER_STALL");
    });

    it("surfaces DataCloneError session error as StreamError{code:DataCloneError}", () => {
      const session = makeOpenSession();
      const ch = makeStubChannel(session);
      const ll = createLowLevelStream(ch);

      const errors: StreamError[] = [];
      ll.onError((err) => errors.push(err));

      session.reset("DataCloneError");

      expect(errors).toHaveLength(1);
      expect(errors[0]).toBeInstanceOf(StreamError);
      expect(errors[0]?.code).toBe("DataCloneError");
    });
  });

  describe("onClose()", () => {
    it("registers callback — does not throw on registration", () => {
      const ch = makeStubChannel();
      const ll = createLowLevelStream(ch);
      const handler = vi.fn();
      expect(() => ll.onClose(handler)).not.toThrow();
    });
  });
});
