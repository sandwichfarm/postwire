// src/session/fsm.ts
// Stub — implementation in 02-04-PLAN.md (Wave 1)

export type StreamState =
  | "IDLE"
  | "OPENING"
  | "OPEN"
  | "LOCAL_HALF_CLOSED"
  | "REMOTE_HALF_CLOSED"
  | "CLOSING"
  | "CLOSED"
  | "ERRORED"
  | "CANCELLED";

export type StreamEvent =
  | { type: "OPEN_SENT" }
  | { type: "OPEN_RECEIVED" }
  | { type: "OPEN_ACK_SENT"; initCredit: number }
  | { type: "OPEN_ACK_RECEIVED"; initCredit: number }
  | { type: "DATA_SENT" }
  | { type: "DATA_RECEIVED" }
  | { type: "CLOSE_SENT" }
  | { type: "CLOSE_RECEIVED" }
  | { type: "CANCEL_SENT"; reason: string }
  | { type: "CANCEL_RECEIVED"; reason: string }
  | { type: "RESET_SENT"; reason: string }
  | { type: "RESET_RECEIVED"; reason: string }
  | { type: "FINAL_SEQ_DELIVERED" }
  | { type: "STALL_TIMEOUT" };

export class IllegalTransitionError extends Error {
  constructor(state: StreamState, event: StreamEvent) {
    super(`Illegal FSM transition: ${state} + ${event.type}`);
    this.name = "IllegalTransitionError";
  }
}

export const TERMINAL_STATES: Set<StreamState> = new Set<StreamState>([
  "CLOSED",
  "ERRORED",
  "CANCELLED",
]);

export function isTerminalState(state: StreamState): boolean {
  return TERMINAL_STATES.has(state);
}

export function transition(state: StreamState, event: StreamEvent): StreamState {
  throw new IllegalTransitionError(state, event);
}
