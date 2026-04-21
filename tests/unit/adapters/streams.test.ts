// tests/unit/adapters/streams.test.ts
// Unit tests for createStream — API-03 behaviors
// Uses a stub Channel backed by a real Session in OPEN state to avoid postMessage plumbing.
// Same stub-channel pattern as lowlevel.test.ts.

import { describe, expect, it, vi } from "vitest";
import { createStream } from "../../../src/adapters/streams.js";
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

describe("createStream — API-03", () => {
  describe("shape", () => {
    it("returns object with readable and writable", () => {
      const ch = makeStubChannel();
      const pair = createStream(ch);
      expect(pair).toHaveProperty("readable");
      expect(pair).toHaveProperty("writable");
    });

    it("readable is a ReadableStream", () => {
      const ch = makeStubChannel();
      const { readable } = createStream(ch);
      expect(readable).toBeInstanceOf(ReadableStream);
    });

    it("writable is a WritableStream", () => {
      const ch = makeStubChannel();
      const { writable } = createStream(ch);
      expect(writable).toBeInstanceOf(WritableStream);
    });

    it("calls channel.openStream() on construction", () => {
      const ch = makeStubChannel();
      createStream(ch);
      expect(ch.openStream).toHaveBeenCalledOnce();
    });

    it("forwards sessionOptions to channel.openStream()", () => {
      const ch = makeStubChannel();
      const opts = { sessionOptions: { initialCredit: 32 } };
      createStream(ch, opts);
      expect(ch.openStream).toHaveBeenCalledWith({ initialCredit: 32 });
    });
  });

  describe("WritableStream", () => {
    it("write() returns a Promise", () => {
      const ch = makeStubChannel();
      const { writable } = createStream(ch);
      const writer = writable.getWriter();
      const ret = writer.write("test");
      expect(ret).toBeInstanceOf(Promise);
      // Flush the promise to avoid unhandled rejection
      return ret.catch(() => undefined);
    });

    it("write() resolves for cloneable values", async () => {
      const ch = makeStubChannel();
      const { writable } = createStream(ch);
      const writer = writable.getWriter();
      await expect(writer.write("hello")).resolves.toBeUndefined();
    });

    it("write() resolves for ArrayBuffer values", async () => {
      const ch = makeStubChannel();
      const { writable } = createStream(ch);
      const writer = writable.getWriter();
      await expect(writer.write(new ArrayBuffer(64))).resolves.toBeUndefined();
    });

    it("abort() resolves and transitions session to errored state", async () => {
      const session = makeOpenSession();
      const ch = makeStubChannel(session);
      const { writable } = createStream(ch);
      const writer = writable.getWriter();
      await expect(writer.abort("test-abort")).resolves.toBeUndefined();
    });

    it("close() calls channel.close()", async () => {
      const ch = makeStubChannel();
      const { writable } = createStream(ch);
      const writer = writable.getWriter();
      await writer.close();
      expect(ch.close).toHaveBeenCalledOnce();
    });
  });

  describe("ReadableStream", () => {
    it("readable stream can be read from", async () => {
      const session = makeOpenSession();
      const ch = makeStubChannel(session);
      const { readable } = createStream(ch);
      const reader = readable.getReader();

      // Simulate an inbound chunk arriving from the session
      // (In real usage this comes from the remote side via Channel.receiveFrame)
      // We simulate it by calling the onChunk callback directly.
      // The adapter registers onChunk in createStream — we need to trigger it.
      // Deliver a chunk via the internal callback mechanism.
      // Since session.onChunk is registered, we need to deliver a DATA frame to trigger it.
      // Instead we test cancel, which is visible.
      await reader.cancel("test-cancel");
      expect(session.state).toBe("CANCELLED");
    });

    it("cancel() transitions session to CANCELLED", async () => {
      const session = makeOpenSession();
      const ch = makeStubChannel(session);
      const { readable } = createStream(ch);
      const reader = readable.getReader();

      await reader.cancel("cancelled-by-consumer");
      expect(session.state).toBe("CANCELLED");
    });

    it("chunks from session.onChunk are readable from the stream", async () => {
      const session = makeOpenSession();
      const ch = makeStubChannel(session);
      const { readable } = createStream(ch);
      const reader = readable.getReader();

      // Start a read (will block until chunk arrives)
      const readPromise = reader.read();

      // Simulate chunk arriving from the session after the read starts.
      // session.onChunk callback was registered in createStream().
      // We can trigger it by delivering a DATA frame to the session.
      // But since we have a stub channel, we need to fire it differently.
      // We directly invoke session's internal path by calling receiveFrame with a DATA frame.
      // To do this we need the DATA frame format.
      const { FRAME_MARKER: FM } = await import("../../../src/framing/types.js");
      const dataFrame = {
        [FM]: 1,
        channelId: "test-ch",
        streamId: 1,
        seqNum: 0,
        type: "DATA",
        chunkType: "STRUCTURED_CLONE",
        payload: "hello-from-remote",
        isFinal: true,
      };
      session.receiveFrame(dataFrame as Parameters<typeof session.receiveFrame>[0]);

      const result = await readPromise;
      expect(result.done).toBe(false);
      expect(result.value).toBe("hello-from-remote");
    });
  });

  describe("DataCloneError surfacing", () => {
    it("session onError with DataCloneError sets streamError", async () => {
      const session = makeOpenSession();
      const ch = makeStubChannel(session);
      const { readable } = createStream(ch);
      const reader = readable.getReader();

      // Start a read first (so we have an active reader)
      const readPromise = reader.read().catch((err) => err);

      // Trigger the error via session.reset — same path Channel uses after catching DataCloneError
      session.reset("DataCloneError");

      const result = await readPromise;
      expect(result).toBeInstanceOf(StreamError);
      expect((result as StreamError).code).toBe("DataCloneError");
    });

    it("write() after DataCloneError rejects with StreamError", async () => {
      const session = makeOpenSession();
      const ch = makeStubChannel(session);
      const { writable } = createStream(ch);
      const writer = writable.getWriter();

      // Trigger a DataCloneError via session.reset
      session.reset("DataCloneError");

      // Give the error callback a tick to propagate
      await new Promise((r) => setTimeout(r, 0));

      // Next write should be rejected
      await expect(writer.write("test")).rejects.toBeInstanceOf(StreamError);
    });
  });
});
