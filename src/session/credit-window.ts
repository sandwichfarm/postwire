// src/session/credit-window.ts
// QUIC WINDOW_UPDATE-style credit accounting with stall detection (SESS-02, SESS-03)

export interface CreditWindowOptions {
  initialCredit?: number; // default: 16
  highWaterMark?: number; // default: 32
  stallTimeoutMs?: number; // default: 30000; 0 or negative = disabled
  onStall?: () => void;
  onCreditNeeded?: (grant: number) => void;
}

export class CreditWindow {
  #sendCredit: number;
  #recvConsumed: number = 0;
  readonly #hwm: number;
  readonly #stallTimeoutMs: number;
  readonly #onStall: (() => void) | undefined;
  readonly #onCreditNeeded: ((grant: number) => void) | undefined;
  #stallTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: CreditWindowOptions = {}) {
    this.#sendCredit = opts.initialCredit ?? 16;
    this.#hwm = opts.highWaterMark ?? 32;
    this.#stallTimeoutMs = opts.stallTimeoutMs ?? 30000;
    this.#onStall = opts.onStall;
    this.#onCreditNeeded = opts.onCreditNeeded;
    // Start stall timer if we begin with zero credits
    if (this.#sendCredit <= 0) this.#startStallTimer();
  }

  get sendCredit(): number {
    return this.#sendCredit;
  }

  /** Phase 3 WHATWG Streams wires controller.desiredSize to this value (SESS-03) */
  get desiredSize(): number {
    return this.#hwm - this.#recvConsumed;
  }

  /** Returns true and decrements if credit available; false (no change) if at zero */
  consumeSendCredit(): boolean {
    if (this.#sendCredit <= 0) return false;
    this.#sendCredit--;
    if (this.#sendCredit === 0) this.#startStallTimer();
    return true;
  }

  /** CREDIT frame received from remote — add grant to send side */
  addSendCredit(grant: number): void {
    this.#sendCredit += grant;
    if (this.#sendCredit > 0) this.#clearStallTimer();
  }

  /** Called by the receive path when a buffered chunk has been delivered to consumer */
  notifyRead(): void {
    this.#recvConsumed = Math.max(0, this.#recvConsumed - 1);
    this.#clearStallTimer();
    // Re-arm: if still zero credits after read, reset stall timer
    if (this.#sendCredit === 0) this.#startStallTimer();
    // Issue CREDIT when recvConsumed falls at or below half HWM (RFC 9000 §4.1)
    if (this.#recvConsumed <= Math.floor(this.#hwm / 2)) {
      const grant = this.#hwm - this.#recvConsumed;
      this.#onCreditNeeded?.(grant);
    }
  }

  /** Called when a DATA frame arrives (increments recv consumed count) */
  addRecvConsumed(n: number = 1): void {
    this.#recvConsumed += n;
  }

  destroy(): void {
    this.#clearStallTimer();
  }

  #startStallTimer(): void {
    if (this.#stallTimeoutMs <= 0 || !this.#onStall) return;
    this.#clearStallTimer();
    this.#stallTimer = setTimeout(() => {
      this.#stallTimer = null;
      this.#onStall?.();
    }, this.#stallTimeoutMs);
  }

  #clearStallTimer(): void {
    if (this.#stallTimer !== null) {
      clearTimeout(this.#stallTimer);
      this.#stallTimer = null;
    }
  }
}
