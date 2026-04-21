import { describe, expect, it } from "vitest";
import { ReorderBuffer } from "../../../src/session/reorder-buffer.js";

describe("ReorderBuffer", () => {
  it("scaffold: exists and is a constructor", () => {
    expect(typeof ReorderBuffer).toBe("function");
  });
});
