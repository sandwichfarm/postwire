// tests/integration/data-clone-error.test.ts
// FAST-03: Proves DataCloneError surfaces as typed StreamError — never swallowed.
//
// Design:
//   - Use real Node MessageChannel so postMessage throws real DataCloneError
//     for non-cloneable values (functions).
//   - Channel.#sendRaw catches the synchronous DataCloneError throw, calls
//     session.reset('DataCloneError'), which fires session.onError.
//   - The Streams adapter's onError handler creates StreamError{code:'DataCloneError'}
//     and calls controller.error() — surfacing it on the readable side.
//   - The writable side: subsequent write() calls are rejected with the same error.
//
// RESEARCH.md Pattern 1 + PITFALLS Pitfall 2 + FAST-03 requirement.

import { afterEach, describe, expect, it } from "vitest";
import { createStream } from "../../src/adapters/streams.js";
import { createChannel } from "../../src/channel/channel.js";
import { StreamError } from "../../src/types.js";
import type { MockEndpointPair } from "../helpers/mock-endpoint.js";
import { createMessageChannelPair } from "../helpers/mock-endpoint.js";

describe("DataCloneError (FAST-03)", () => {
  let pair: MockEndpointPair | undefined;

  afterEach(() => {
    pair?.close();
    pair = undefined;
  });

  it("non-cloneable chunk (function) surfaces error on readable side", async () => {
    pair = createMessageChannelPair();
    const CHANNEL_ID = "test-dce-readable";

    const chA = createChannel(pair.a, { channelId: CHANNEL_ID });
    const chB = createChannel(pair.b, { channelId: CHANNEL_ID });

    // Wait for CAPABILITY handshake
    await Promise.all([chA.capabilityReady, chB.capabilityReady]);

    // Side B: register receiver (responder)
    chB.onStream((_handle) => {});

    // Side A: open stream (initiator) and get streams pair
    const { readable, writable } = createStream(chA);

    // Wait for OPEN/OPEN_ACK
    await new Promise<void>((r) => setTimeout(r, 50));

    const writer = writable.getWriter();
    const reader = readable.getReader();

    // Start a read — will block until data or error arrives
    const readPromise = reader.read().catch((err: unknown) => ({ error: err }));

    // Send a non-cloneable value (function) — postMessage will throw DataCloneError
    // This resolves immediately (Channel catches the error internally) but triggers
    // session.reset('DataCloneError') which fires session.onError synchronously
    try {
      await writer.write(() => {}); // function is not structured-cloneable
    } catch {
      // The write itself may or may not reject depending on timing of error propagation
      // We don't assert here — we check the readable side instead
    }

    // Give the event loop a tick for the error to propagate through session.onError
    await new Promise<void>((r) => setTimeout(r, 10));

    // The readable side should surface a StreamError
    const result = await readPromise;

    expect(result).toMatchObject({ error: expect.any(StreamError) });
    if ("error" in result && result.error instanceof StreamError) {
      expect(result.error.code).toBe("DataCloneError");
    }
  }, 5000);

  it("non-cloneable error does not silently fail (FAST-03)", async () => {
    pair = createMessageChannelPair();
    const CHANNEL_ID = "test-dce-nosilent";

    const chA = createChannel(pair.a, { channelId: CHANNEL_ID });
    const chB = createChannel(pair.b, { channelId: CHANNEL_ID });

    await Promise.all([chA.capabilityReady, chB.capabilityReady]);

    chB.onStream((_handle) => {});

    const { writable } = createStream(chA);

    await new Promise<void>((r) => setTimeout(r, 50));

    const writer = writable.getWriter();

    // Track whether the channel-level onError fired
    let channelErrorFired = false;
    chA.onError((err) => {
      if (err.code === "DataCloneError") {
        channelErrorFired = true;
      }
    });

    // Send a non-cloneable value
    try {
      await writer.write(async () => {
        // async function is not structured-cloneable
      });
    } catch {
      // ignore
    }

    // Give the event loop a tick for the error callback to fire
    await new Promise<void>((r) => setTimeout(r, 10));

    // The channel-level onError MUST have been called (error is NOT silent)
    expect(channelErrorFired).toBe(true);
  }, 5000);

  it("subsequent write() after DataCloneError rejects with StreamError", async () => {
    pair = createMessageChannelPair();
    const CHANNEL_ID = "test-dce-subsequent";

    const chA = createChannel(pair.a, { channelId: CHANNEL_ID });
    const chB = createChannel(pair.b, { channelId: CHANNEL_ID });

    await Promise.all([chA.capabilityReady, chB.capabilityReady]);

    chB.onStream((_handle) => {});

    const { writable } = createStream(chA);

    await new Promise<void>((r) => setTimeout(r, 50));

    const writer = writable.getWriter();

    // Send a non-cloneable value — Channel internally resets the session
    try {
      await writer.write(() => {}); // function is not cloneable
    } catch {
      // ignore first write outcome
    }

    // Give time for error to propagate to the adapter's streamError state
    await new Promise<void>((r) => setTimeout(r, 20));

    // The next write must now reject (streamError is set)
    await expect(writer.write("after-error")).rejects.toBeInstanceOf(StreamError);
  }, 5000);

  it("cloneable values do not error (control test)", async () => {
    pair = createMessageChannelPair();
    const CHANNEL_ID = "test-dce-control";

    const chA = createChannel(pair.a, { channelId: CHANNEL_ID });
    const chB = createChannel(pair.b, { channelId: CHANNEL_ID });

    await Promise.all([chA.capabilityReady, chB.capabilityReady]);

    // Track received chunks on B
    const receivedChunks: unknown[] = [];
    chB.onStream((handle) => {
      handle.session.onChunk((chunk) => receivedChunks.push(chunk));
    });

    const { writable } = createStream(chA);

    await new Promise<void>((r) => setTimeout(r, 50));

    const writer = writable.getWriter();

    // Cloneable values must not trigger DataCloneError
    await expect(writer.write("hello")).resolves.toBeUndefined();
    await expect(writer.write(42)).resolves.toBeUndefined();
    await expect(writer.write({ key: "value" })).resolves.toBeUndefined();
    await expect(writer.write(new ArrayBuffer(16))).resolves.toBeUndefined();

    writer.releaseLock();

    // Wait for delivery
    await new Promise<void>((resolve) => {
      const start = Date.now();
      const check = setInterval(() => {
        if (receivedChunks.length >= 4 || Date.now() - start > 2000) {
          clearInterval(check);
          resolve();
        }
      }, 10);
    });

    expect(receivedChunks.length).toBe(4);
  }, 5000);
});
