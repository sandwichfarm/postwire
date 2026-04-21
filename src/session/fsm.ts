// src/session/fsm.ts
// Pure FSM reducer for per-stream lifecycle.
// No I/O, no side effects, no timers.
// Side effects (emit RESET/CANCEL frames) are the Session's responsibility.

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
  readonly state: StreamState;
  readonly eventType: string;

  constructor(state: StreamState, event: StreamEvent) {
    super(`Illegal FSM transition: ${state} + ${event.type}`);
    this.name = "IllegalTransitionError";
    this.state = state;
    this.eventType = event.type;
  }
}

export const TERMINAL_STATES: ReadonlySet<StreamState> = new Set<StreamState>([
  "CLOSED",
  "ERRORED",
  "CANCELLED",
]);

export function isTerminalState(state: StreamState): boolean {
  return TERMINAL_STATES.has(state);
}

/**
 * Pure FSM reducer. Returns next state for valid transitions.
 * Throws IllegalTransitionError for all invalid (state, event) pairs.
 * Terminal states (CLOSED, ERRORED, CANCELLED) throw on ANY event.
 */
export function transition(state: StreamState, event: StreamEvent): StreamState {
  switch (state) {
    case "IDLE":
      if (event.type === "OPEN_SENT") return "OPENING";
      if (event.type === "OPEN_RECEIVED") return "OPENING";
      break;

    case "OPENING":
      if (event.type === "OPEN_ACK_SENT") return "OPEN";
      if (event.type === "OPEN_ACK_RECEIVED") return "OPEN";
      if (event.type === "RESET_RECEIVED") return "ERRORED";
      break;

    case "OPEN":
      if (event.type === "DATA_SENT") return "OPEN";
      if (event.type === "DATA_RECEIVED") return "OPEN";
      if (event.type === "CLOSE_SENT") return "LOCAL_HALF_CLOSED";
      if (event.type === "CLOSE_RECEIVED") return "REMOTE_HALF_CLOSED";
      if (event.type === "CANCEL_SENT") return "CANCELLED";
      if (event.type === "CANCEL_RECEIVED") return "CANCELLED";
      if (event.type === "RESET_SENT") return "ERRORED";
      if (event.type === "RESET_RECEIVED") return "ERRORED";
      if (event.type === "STALL_TIMEOUT") return "ERRORED";
      break;

    case "LOCAL_HALF_CLOSED":
      if (event.type === "DATA_RECEIVED") return "LOCAL_HALF_CLOSED";
      if (event.type === "CLOSE_RECEIVED") return "CLOSING";
      if (event.type === "RESET_SENT") return "ERRORED";
      if (event.type === "RESET_RECEIVED") return "ERRORED";
      if (event.type === "CANCEL_RECEIVED") return "CANCELLED";
      break;

    case "REMOTE_HALF_CLOSED":
      if (event.type === "DATA_SENT") return "REMOTE_HALF_CLOSED";
      if (event.type === "CLOSE_SENT") return "CLOSING";
      if (event.type === "RESET_SENT") return "ERRORED";
      if (event.type === "RESET_RECEIVED") return "ERRORED";
      if (event.type === "CANCEL_SENT") return "CANCELLED";
      break;

    case "CLOSING":
      if (event.type === "FINAL_SEQ_DELIVERED") return "CLOSED";
      if (event.type === "RESET_SENT") return "ERRORED";
      if (event.type === "RESET_RECEIVED") return "ERRORED";
      break;

    case "CLOSED":
    case "ERRORED":
    case "CANCELLED":
      throw new IllegalTransitionError(state, event);
  }

  throw new IllegalTransitionError(state, event);
}
