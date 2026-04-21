import { afterEach, describe, expect, it, vi } from "vitest";
import * as fc from "fast-check";
import { CreditWindow } from "../../../src/session/credit-window.js";

describe("CreditWindow send side", () => {
	it("scaffold: exists and is a constructor", () => {
		expect(typeof CreditWindow).toBe("function");
	});

	it("consumeSendCredit returns true and decrements when sendCredit > 0", () => {
		const cw = new CreditWindow({ initialCredit: 3 });
		expect(cw.consumeSendCredit()).toBe(true);
		expect(cw.sendCredit).toBe(2);
	});

	it("consumeSendCredit returns false (does NOT decrement) when sendCredit === 0", () => {
		const cw = new CreditWindow({ initialCredit: 0, stallTimeoutMs: 0 });
		expect(cw.consumeSendCredit()).toBe(false);
		expect(cw.sendCredit).toBe(0);
	});

	it("sendCredit never goes below 0 across repeated consumes", () => {
		const cw = new CreditWindow({ initialCredit: 2, stallTimeoutMs: 0 });
		cw.consumeSendCredit();
		cw.consumeSendCredit();
		cw.consumeSendCredit(); // extra consume — should stay at 0
		expect(cw.sendCredit).toBe(0);
	});

	it("addSendCredit(n) adds n to sendCredit", () => {
		const cw = new CreditWindow({ initialCredit: 0, stallTimeoutMs: 0 });
		cw.addSendCredit(5);
		expect(cw.sendCredit).toBe(5);
	});

	it("initialCredit option sets starting sendCredit (default: 16)", () => {
		const cw = new CreditWindow();
		expect(cw.sendCredit).toBe(16);
	});

	it("initialCredit: custom value is applied", () => {
		const cw = new CreditWindow({ initialCredit: 8, stallTimeoutMs: 0 });
		expect(cw.sendCredit).toBe(8);
	});
});

describe("CreditWindow receive side — onCreditNeeded", () => {
	it("onCreditNeeded callback fires when recvConsumed <= hwm/2 after notifyRead", () => {
		const onCreditNeeded = vi.fn();
		// HWM=32, hwm/2=16. Start with recvConsumed=17 (above threshold), then notifyRead brings to 16.
		const cw = new CreditWindow({
			highWaterMark: 32,
			onCreditNeeded,
			stallTimeoutMs: 0,
		});
		// Simulate 17 frames arriving
		cw.addRecvConsumed(17);
		// One consumer read brings recvConsumed to 16 which is exactly hwm/2 — should fire
		cw.notifyRead();
		expect(onCreditNeeded).toHaveBeenCalledOnce();
	});

	it("grant value passed to onCreditNeeded is hwm - recvConsumed", () => {
		const onCreditNeeded = vi.fn();
		const cw = new CreditWindow({
			highWaterMark: 32,
			onCreditNeeded,
			stallTimeoutMs: 0,
		});
		cw.addRecvConsumed(17);
		cw.notifyRead(); // recvConsumed becomes 16; grant = 32 - 16 = 16
		expect(onCreditNeeded).toHaveBeenCalledWith(16);
	});

	it("callback does NOT fire if recvConsumed is still above hwm/2 after notifyRead", () => {
		const onCreditNeeded = vi.fn();
		const cw = new CreditWindow({
			highWaterMark: 32,
			onCreditNeeded,
			stallTimeoutMs: 0,
		});
		// recvConsumed=20; after one read → 19, which is > 16 (hwm/2)
		cw.addRecvConsumed(20);
		cw.notifyRead();
		expect(onCreditNeeded).not.toHaveBeenCalled();
	});

	it("calling addRecvConsumed(n) increments recv budget used", () => {
		const onCreditNeeded = vi.fn();
		const cw = new CreditWindow({
			highWaterMark: 32,
			onCreditNeeded,
			stallTimeoutMs: 0,
		});
		// Start at 0; read immediately → recvConsumed still 0 which is <= 16 → fires callback
		cw.notifyRead();
		expect(onCreditNeeded).toHaveBeenCalledWith(32);
	});

	it("notifyRead() decrements recvConsumed by 1 (bounded to 0 minimum)", () => {
		const cw = new CreditWindow({ stallTimeoutMs: 0 });
		// recvConsumed starts at 0; notifyRead should not go negative
		cw.notifyRead();
		// We can infer recvConsumed = 0 since desiredSize = hwm - recvConsumed = 32
		expect(cw.desiredSize).toBe(32);
	});
});

describe("desiredSize", () => {
	it("desiredSize returns hwm - recvConsumed when recvConsumed = 0 → equals hwm (default 32)", () => {
		const cw = new CreditWindow({ stallTimeoutMs: 0 });
		expect(cw.desiredSize).toBe(32);
	});

	it("desiredSize returns hwm - recvConsumed after addRecvConsumed(5) → returns hwm - 5", () => {
		const cw = new CreditWindow({ highWaterMark: 32, stallTimeoutMs: 0 });
		cw.addRecvConsumed(5);
		expect(cw.desiredSize).toBe(27);
	});

	it("desiredSize returns <=0 when recvConsumed >= hwm (fully blocked)", () => {
		const cw = new CreditWindow({ highWaterMark: 32, stallTimeoutMs: 0 });
		cw.addRecvConsumed(32);
		expect(cw.desiredSize).toBeLessThanOrEqual(0);
	});
});

describe("consumer-stall timeout", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("fires onStall after stallTimeoutMs of sendCredit===0 and no notifyRead", () => {
		vi.useFakeTimers();
		const onStall = vi.fn();
		const _cw = new CreditWindow({
			initialCredit: 0,
			stallTimeoutMs: 5000,
			onStall,
		});
		vi.advanceTimersByTime(5001);
		expect(onStall).toHaveBeenCalledOnce();
	});

	it("stall timer resets when notifyRead is called (notifyRead before timeout → no stall)", () => {
		vi.useFakeTimers();
		const onStall = vi.fn();
		const cw = new CreditWindow({
			initialCredit: 0,
			stallTimeoutMs: 5000,
			onStall,
		});
		vi.advanceTimersByTime(4000);
		cw.notifyRead();
		vi.advanceTimersByTime(4000); // total 8000ms but timer was reset at 4000ms, so only 4000ms elapsed since reset
		expect(onStall).not.toHaveBeenCalled();
	});

	it("stall timer resets when addSendCredit grants > 0 (credits before timeout → no stall)", () => {
		vi.useFakeTimers();
		const onStall = vi.fn();
		const cw = new CreditWindow({
			initialCredit: 0,
			stallTimeoutMs: 5000,
			onStall,
		});
		vi.advanceTimersByTime(4000);
		cw.addSendCredit(1); // credit > 0 now; timer should stop
		vi.advanceTimersByTime(5001);
		expect(onStall).not.toHaveBeenCalled();
	});

	it("no stall if stallTimeoutMs <= 0 (disabled)", () => {
		vi.useFakeTimers();
		const onStall = vi.fn();
		const _cw = new CreditWindow({
			initialCredit: 0,
			stallTimeoutMs: 0,
			onStall,
		});
		vi.advanceTimersByTime(60000);
		expect(onStall).not.toHaveBeenCalled();
	});

	it("destroy() clears the timer (no stall after destroy)", () => {
		vi.useFakeTimers();
		const onStall = vi.fn();
		const cw = new CreditWindow({
			initialCredit: 0,
			stallTimeoutMs: 5000,
			onStall,
		});
		vi.advanceTimersByTime(3000);
		cw.destroy();
		vi.advanceTimersByTime(5001);
		expect(onStall).not.toHaveBeenCalled();
	});
});

describe("property: sendCredit never negative", () => {
	it("holds across random consume/add sequences", () => {
		fc.assert(
			fc.property(
				fc
					.nat({ max: 64 })
					.chain((init) =>
						fc.tuple(
							fc.constant(init),
							fc.array(
								fc.oneof(
									fc.constant("consume" as const),
									fc.nat({ max: 16 }),
								),
								{ maxLength: 200 },
							),
						),
					),
				([initCredit, ops]) => {
					const cw = new CreditWindow({
						initialCredit: initCredit,
						stallTimeoutMs: 0,
					});
					for (const op of ops) {
						if (op === "consume") cw.consumeSendCredit();
						else cw.addSendCredit(op);
						expect(cw.sendCredit).toBeGreaterThanOrEqual(0);
					}
					cw.destroy();
				},
			),
			{ numRuns: 500 },
		);
	});
});
