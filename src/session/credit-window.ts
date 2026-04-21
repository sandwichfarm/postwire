// src/session/credit-window.ts
// Stub — implementation in 02-02-PLAN.md (Wave 1)

export interface CreditWindowOptions {
  initialCredit?: number;
  highWaterMark?: number;
  stallTimeoutMs?: number;
  onStall?: () => void;
  onCreditNeeded?: (grant: number) => void;
}

export class CreditWindow {
  constructor(_opts?: CreditWindowOptions) {}
  consumeSendCredit(): boolean {
    return false;
  }
  addSendCredit(_grant: number): void {}
  notifyRead(): void {}
  get sendCredit(): number {
    return 0;
  }
  get desiredSize(): number {
    return 0;
  }
  destroy(): void {}
}
