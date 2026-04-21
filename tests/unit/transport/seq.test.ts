import { describe, expect, it } from "vitest";
import { seqGT, seqLT, seqLTE, seqNext } from "../../../src/transport/seq.js";

describe("seqLT — normal cases", () => {
  it("seqLT(0, 1) === true", () => {
    expect(seqLT(0, 1)).toBe(true);
  });

  it("seqLT(1, 0) === false", () => {
    expect(seqLT(1, 0)).toBe(false);
  });

  it("seqLT(100, 100) === false (equal is not LT)", () => {
    expect(seqLT(100, 100)).toBe(false);
  });

  it("seqLT(0xFFFFFFFE, 0xFFFFFFFF) === true (near wraparound)", () => {
    expect(seqLT(0xfffffffe, 0xffffffff)).toBe(true);
  });
});

describe("seqLT — wraparound cases", () => {
  it("seqLT(0xFFFFFFFF, 0) === true (0xFFFFFFFF < 0 in modular space)", () => {
    expect(seqLT(0xffffffff, 0)).toBe(true);
  });

  it("seqLT(0, 0xFFFFFFFF) === false (0 > 0xFFFFFFFF in modular space)", () => {
    expect(seqLT(0, 0xffffffff)).toBe(false);
  });
});

describe("seqGT", () => {
  it("seqGT(1, 0) === true", () => {
    expect(seqGT(1, 0)).toBe(true);
  });

  it("seqGT(0, 1) === false", () => {
    expect(seqGT(0, 1)).toBe(false);
  });

  it("seqGT(b, a) === seqLT(a, b) symmetry", () => {
    const pairs: [number, number][] = [
      [0, 1],
      [1, 0],
      [0xffffffff, 0],
      [0, 0xffffffff],
      [100, 200],
      [0xfffffffe, 0xffffffff],
    ];
    for (const [a, b] of pairs) {
      expect(seqGT(b, a)).toBe(seqLT(a, b));
    }
  });
});

describe("seqLTE", () => {
  it("seqLTE(0, 1) === true", () => {
    expect(seqLTE(0, 1)).toBe(true);
  });

  it("seqLTE(1, 1) === true (equal case)", () => {
    expect(seqLTE(1, 1)).toBe(true);
  });

  it("seqLTE(2, 1) === false", () => {
    expect(seqLTE(2, 1)).toBe(false);
  });
});

describe("seqNext", () => {
  it("seqNext(0xFFFFFFFF) === 0 (wraps to 0)", () => {
    expect(seqNext(0xffffffff)).toBe(0);
  });

  it("seqNext(0) === 1", () => {
    expect(seqNext(0)).toBe(1);
  });

  it("seqNext(99) === 100", () => {
    expect(seqNext(99)).toBe(100);
  });
});

describe("seqLT wraparound fuzz — 32 values through the 0xFFFFFFF0 wrap point", () => {
  it("correctly orders 32 values through the 0xFFFFFFF0 wrap point", () => {
    const start = 0xfffffff0;
    const values: number[] = [];
    let s = start;
    for (let i = 0; i < 32; i++) {
      values.push(s);
      s = seqNext(s);
    }
    for (let i = 0; i < values.length - 1; i++) {
      expect(seqLT(values[i], values[i + 1])).toBe(true);
      expect(seqGT(values[i + 1], values[i])).toBe(true);
    }
  });
});
