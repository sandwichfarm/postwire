// tests/unit/channel/multiplex.test.ts
// Phase 8 MUX-01: Channel multiplex capability negotiation and stream ID allocator.
//
// Covers:
//   - multiplex:true both sides → CAPABILITY negotiates multiplex:true
//   - multiplex:true one side + multiplex:false other → merged false, falls back to single-stream
//   - Open 3 streams when multiplex enabled; each gets a unique streamId
//   - Single-stream mode: second openStream() call throws

import { describe, expect, it } from "vitest";
import { createChannel } from "../../../src/channel/channel.js";
import { createMessageChannelPair } from "../../helpers/mock-endpoint.js";

describe("Channel — multiplex capability negotiation (MUX-01)", () => {
  it("multiplex:true on both sides → capabilities.multiplex negotiates to true", async () => {
    const { a, b, close } = createMessageChannelPair();
    try {
      const chA = createChannel(a, { multiplex: true });
      const chB = createChannel(b, { multiplex: true });

      await Promise.all([chA.capabilityReady, chB.capabilityReady]);

      expect(chA.capabilities.multiplex).toBe(true);
      expect(chB.capabilities.multiplex).toBe(true);

      chA.close();
      chB.close();
    } finally {
      close();
    }
  });

  it("multiplex:true on one side + multiplex:false on other → merged false (single-stream fallback)", async () => {
    const { a, b, close } = createMessageChannelPair();
    try {
      const chA = createChannel(a, { multiplex: true });
      const chB = createChannel(b, { multiplex: false });

      await Promise.all([chA.capabilityReady, chB.capabilityReady]);

      // Neither side should have multiplex activated — one opted out
      expect(chA.capabilities.multiplex).toBe(false);
      expect(chB.capabilities.multiplex).toBe(false);

      chA.close();
      chB.close();
    } finally {
      close();
    }
  });

  it("multiplex disabled (default) on both sides → capabilities.multiplex is false", async () => {
    const { a, b, close } = createMessageChannelPair();
    try {
      const chA = createChannel(a);
      const chB = createChannel(b);

      await Promise.all([chA.capabilityReady, chB.capabilityReady]);

      expect(chA.capabilities.multiplex).toBe(false);
      expect(chB.capabilities.multiplex).toBe(false);

      chA.close();
      chB.close();
    } finally {
      close();
    }
  });

  it("open 3 streams in multiplex mode — each gets a unique odd streamId (initiator)", async () => {
    const { a, b, close } = createMessageChannelPair();
    try {
      const chA = createChannel(a, { multiplex: true, role: "initiator" });
      const chB = createChannel(b, { multiplex: true, role: "responder" });

      await Promise.all([chA.capabilityReady, chB.capabilityReady]);

      // Wait for OPEN/OPEN_ACK handshakes
      const streamIds: number[] = [];
      chB.onStream((handle) => {
        streamIds.push(handle.session.streamId);
      });

      // Open 3 streams from the initiator side
      const h1 = chA.openStream();
      const h2 = chA.openStream();
      const h3 = chA.openStream();

      // Wait for OPEN frames to arrive and be processed
      await new Promise<void>((r) => setTimeout(r, 50));

      // Initiator allocates odd IDs: 1, 3, 5
      expect(h1.session.streamId).toBe(1);
      expect(h2.session.streamId).toBe(3);
      expect(h3.session.streamId).toBe(5);

      // All three IDs must be unique
      const ids = [h1.session.streamId, h2.session.streamId, h3.session.streamId];
      expect(new Set(ids).size).toBe(3);

      // Responder should have received all 3 OPEN frames
      expect(streamIds.length).toBe(3);
      expect(new Set(streamIds).size).toBe(3);

      chA.close();
      chB.close();
    } finally {
      close();
    }
  });

  it("open 3 streams from responder side — each gets a unique even streamId", async () => {
    const { a, b, close } = createMessageChannelPair();
    try {
      // Swap roles: chA is responder, chB is initiator
      const chA = createChannel(a, { multiplex: true, role: "responder" });
      const chB = createChannel(b, { multiplex: true, role: "initiator" });

      await Promise.all([chA.capabilityReady, chB.capabilityReady]);

      const streamIds: number[] = [];
      chB.onStream((handle) => {
        streamIds.push(handle.session.streamId);
      });

      // Open 3 streams from chA (responder role)
      const h1 = chA.openStream();
      const h2 = chA.openStream();
      const h3 = chA.openStream();

      await new Promise<void>((r) => setTimeout(r, 50));

      // Responder allocates even IDs: 2, 4, 6
      expect(h1.session.streamId).toBe(2);
      expect(h2.session.streamId).toBe(4);
      expect(h3.session.streamId).toBe(6);

      chA.close();
      chB.close();
    } finally {
      close();
    }
  });

  it("single-stream mode: second openStream() throws", async () => {
    const { a, b, close } = createMessageChannelPair();
    try {
      const chA = createChannel(a, { multiplex: false });
      const chB = createChannel(b, { multiplex: false });

      await Promise.all([chA.capabilityReady, chB.capabilityReady]);
      chB.onStream(() => {
        /* consume */
      });

      // First openStream — should succeed
      chA.openStream();

      // Second openStream — should throw in single-stream mode
      expect(() => {
        chA.openStream();
      }).toThrow(/single-stream mode/);

      chA.close();
      chB.close();
    } finally {
      close();
    }
  });

  it("multiplex mode: per-stream stats returns an entry for each open stream", async () => {
    const { a, b, close } = createMessageChannelPair();
    try {
      const chA = createChannel(a, { multiplex: true, role: "initiator" });
      const chB = createChannel(b, { multiplex: true, role: "responder" });

      await Promise.all([chA.capabilityReady, chB.capabilityReady]);

      chB.onStream(() => {
        /* consume */
      });

      chA.openStream();
      chA.openStream();

      await new Promise<void>((r) => setTimeout(r, 50));

      const stats = chA.stats();
      expect(stats.streams.length).toBe(2);
      const ids = stats.streams.map((s) => s.streamId);
      expect(ids).toContain(1);
      expect(ids).toContain(3);

      chA.close();
      chB.close();
    } finally {
      close();
    }
  });
});
