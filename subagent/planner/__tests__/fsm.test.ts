import { describe, it, expect, beforeEach } from "vitest";
import { PlannerFSM, TERMINAL_STATES, RESUMABLE_STATES } from "../fsm.js";

describe("PlannerFSM", () => {
	let fsm: PlannerFSM;

	beforeEach(() => {
		fsm = new PlannerFSM();
	});

	it("starts in idle state", () => {
		expect(fsm.getState()).toBe("idle");
	});

	it("allows legal transition idle → analyzing", () => {
		expect(fsm.canTransition("analyzing")).toBe(true);
		const result = fsm.transition("analyzing", "test");
		expect(result.ok).toBe(true);
		expect(fsm.getState()).toBe("analyzing");
	});

	it("rejects illegal transition idle → drafting", () => {
		expect(fsm.canTransition("drafting")).toBe(false);
		const result = fsm.transition("drafting", "test");
		expect(result.ok).toBe(false);
	});

	it("records history", () => {
		fsm.transition("analyzing", "step1");
		fsm.transition("drafting", "step2");
		const history = fsm.getHistory();
		expect(history).toHaveLength(2);
		expect(history[0].from).toBe("idle");
		expect(history[0].to).toBe("analyzing");
		expect(history[1].from).toBe("analyzing");
		expect(history[1].to).toBe("drafting");
	});

	it("allows drafting self-loop", () => {
		fsm.transition("analyzing", "a");
		fsm.transition("drafting", "b");
		const result = fsm.transition("drafting", "c");
		expect(result.ok).toBe(true);
		expect(fsm.getState()).toBe("drafting");
	});

	it("allows full happy path", () => {
		fsm.transition("analyzing", "a");
		fsm.transition("drafting", "b");
		fsm.transition("validating", "c");
		fsm.transition("awaiting_approval", "d");
		fsm.transition("planned", "e");
		expect(fsm.getState()).toBe("planned");
	});

	it("allows blocked → drafting (revision)", () => {
		fsm.transition("analyzing", "a");
		fsm.transition("drafting", "b");
		fsm.transition("validating", "c");
		fsm.transition("awaiting_approval", "d");
		fsm.transition("blocked", "e");
		const result = fsm.transition("drafting", "f");
		expect(result.ok).toBe(true);
	});

	it("allows abort from any non-terminal state", () => {
		for (const startState of ["analyzing", "drafting", "validating", "awaiting_approval"]) {
			const f = new PlannerFSM(startState as any);
			expect(f.canTransition("aborted")).toBe(true);
		}
	});

	it("isTerminal returns true for terminal states", () => {
		for (const state of TERMINAL_STATES) {
			const f = new PlannerFSM(state);
			expect(f.isTerminal()).toBe(true);
		}
	});

	it("isResumable returns true for resumable states", () => {
		for (const state of RESUMABLE_STATES) {
			const f = new PlannerFSM(state);
			expect(f.isResumable()).toBe(true);
		}
	});

	it("serializes and deserializes correctly", () => {
		fsm.transition("analyzing", "a");
		fsm.transition("drafting", "b");
		const serialized = fsm.serialize();
		const restored = PlannerFSM.deserialize(serialized);
		expect(restored.getState()).toBe("drafting");
		expect(restored.getHistory()).toHaveLength(2);
	});

	it("rejects illegal transition with descriptive reason", () => {
		const result = fsm.transition("planned", "test");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain("idle");
			expect(result.reason).toContain("planned");
		}
	});
});
