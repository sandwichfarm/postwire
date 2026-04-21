import { describe, expect, it } from "vitest";
import { Chunker } from "../../../src/session/chunker.js";

describe("Chunker", () => {
  it("scaffold: exists and is a constructor", () => {
    expect(typeof Chunker).toBe("function");
  });
});
