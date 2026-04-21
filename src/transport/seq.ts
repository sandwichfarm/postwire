// src/transport/seq.ts
// 32-bit wraparound-safe sequence number arithmetic — TCP-style modular comparison.
// seqA < seqB (in modular space) iff ((seqA - seqB) >>> 0) > HALF_WINDOW
// This correctly handles the 0xFFFFFFFF → 0 wraparound boundary.

const SEQ_BITS: number = 32;
const SEQ_MASK: number = 0xffff_ffff;
const HALF_WINDOW: number = 0x8000_0000; // 2^31

/** Mask a sequence number to 32 bits (unsigned) */
export function seqMask(n: number): number {
  return n >>> 0;
}

/**
 * Wraparound-safe: returns true if seqA < seqB in the modular 32-bit sequence space.
 * TCP-style: ((a - b) >>> 0) > HALF_WINDOW
 */
export function seqLT(a: number, b: number): boolean {
  return ((seqMask(a) - seqMask(b)) >>> 0) > HALF_WINDOW;
}

/**
 * Wraparound-safe: returns true if seqA > seqB in the modular 32-bit sequence space.
 */
export function seqGT(a: number, b: number): boolean {
  return seqLT(b, a);
}

/**
 * Wraparound-safe: returns true if seqA <= seqB in the modular 32-bit sequence space.
 */
export function seqLTE(a: number, b: number): boolean {
  return !seqGT(a, b);
}

/**
 * Increment a sequence number with 32-bit wraparound.
 * seqNext(0xFFFFFFFF) === 0
 */
export function seqNext(n: number): number {
  return (n + 1) >>> 0;
}

export { SEQ_BITS, SEQ_MASK, HALF_WINDOW };
