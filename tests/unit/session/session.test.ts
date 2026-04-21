import { describe, expect, it } from "vitest";
import { Session } from "../../../src/session/index.js";

describe("Session", () => {
  it("scaffold: exists and is a constructor", () => {
    expect(typeof Session).toBe("function");
  });
});
