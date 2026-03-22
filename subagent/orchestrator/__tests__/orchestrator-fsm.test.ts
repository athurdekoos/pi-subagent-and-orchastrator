import { describe, it, expect, beforeEach } from "vitest";
import { OrchestratorFSM, TERMINAL_STATES, RESUMABLE_STATES } from "../fsm.js";
import type { OrchestratorState } from "../types.js";
import { ORCHESTRATOR_STATES } from "../types.js";

describe("OrchestratorFSM", () => {
	let fsm: OrchestratorFSM;

	beforeEach(() => {
		fsm = new OrchestratorFSM();
	});

	it("starts in idle state", () => {
		expect(fsm.getState()).toBe("idle");
	});

	it("defines exactly 9 states", () => {
		expect(ORCHESTRATOR_STATES).toHaveLength(9);
	});

	it("allows legal transition idle → loading_plan", () => {
		expect(fsm.canTransition("loading_plan")).toBe(true);
		const result = fsm.transition("loading_plan", "load plan");
		expect(result.ok).toBe(true);
		expect(fsm.getState()).toBe("loading_plan");
	});

	it("rejects illegal transition idle → executing", () => {
		expect(fsm.canTransition("executing")).toBe(false);
		const result = fsm.transition("executing", "test");
		expect(result.ok).toBe(false);
	});

	it("rejects illegal transition idle → completed", () => {
		expect(fsm.canTransition("completed")).toBe(false);
		const result = fsm.transition("completed", "test");
		expect(result.ok).toBe(false);
	});

	it("allows full happy path: idle → loading_plan → executing → verifying → completed", () => {
		fsm.transition("loading_plan", "load");
		fsm.transition("executing", "exec");
		fsm.transition("verifying", "verify");
		const result = fsm.transition("completed", "done");
		expect(result.ok).toBe(true);
		expect(fsm.getState()).toBe("completed");
	});

	it("allows executing self-loop (executing → executing)", () => {
		fsm.transition("loading_plan", "load");
		fsm.transition("executing", "exec1");
		const result = fsm.transition("executing", "exec2");
		expect(result.ok).toBe(true);
		expect(fsm.getState()).toBe("executing");
	});

	it("allows executing → awaiting_approval", () => {
		fsm.transition("loading_plan", "load");
		fsm.transition("executing", "exec");
		const result = fsm.transition("awaiting_approval", "need approval");
		expect(result.ok).toBe(true);
		expect(fsm.getState()).toBe("awaiting_approval");
	});

	it("allows awaiting_approval → executing (approval granted)", () => {
		fsm.transition("loading_plan", "load");
		fsm.transition("executing", "exec");
		fsm.transition("awaiting_approval", "need approval");
		const result = fsm.transition("executing", "approved");
		expect(result.ok).toBe(true);
		expect(fsm.getState()).toBe("executing");
	});

	it("allows awaiting_approval → blocked (approval denied)", () => {
		fsm.transition("loading_plan", "load");
		fsm.transition("executing", "exec");
		fsm.transition("awaiting_approval", "need approval");
		const result = fsm.transition("blocked", "denied");
		expect(result.ok).toBe(true);
		expect(fsm.getState()).toBe("blocked");
	});

	it("allows abort from any non-terminal state", () => {
		const nonTerminalStates: OrchestratorState[] = [
			"idle",
			"loading_plan",
			"executing",
			"awaiting_approval",
			"verifying",
			"blocked",
		];
		for (const startState of nonTerminalStates) {
			const f = new OrchestratorFSM(startState);
			expect(f.canTransition("aborted")).toBe(true);
		}
	});

	it("rejects transitions from completed (except to idle)", () => {
		const f = new OrchestratorFSM("completed");
		expect(f.canTransition("idle")).toBe(true);
		// All other states should be rejected
		const others: OrchestratorState[] = [
			"loading_plan",
			"executing",
			"awaiting_approval",
			"verifying",
			"completed",
			"failed",
			"blocked",
			"aborted",
		];
		for (const s of others) {
			expect(f.canTransition(s)).toBe(false);
		}
	});

	it("rejects transitions from aborted (except to idle)", () => {
		const f = new OrchestratorFSM("aborted");
		expect(f.canTransition("idle")).toBe(true);
		const others: OrchestratorState[] = [
			"loading_plan",
			"executing",
			"awaiting_approval",
			"verifying",
			"completed",
			"failed",
			"blocked",
			"aborted",
		];
		for (const s of others) {
			expect(f.canTransition(s)).toBe(false);
		}
	});

	it("isTerminal returns true for completed, failed, blocked, aborted", () => {
		for (const state of TERMINAL_STATES) {
			const f = new OrchestratorFSM(state);
			expect(f.isTerminal()).toBe(true);
		}
		// Verify the exact set
		expect(TERMINAL_STATES).toContain("completed");
		expect(TERMINAL_STATES).toContain("failed");
		expect(TERMINAL_STATES).toContain("blocked");
		expect(TERMINAL_STATES).toContain("aborted");
		expect(TERMINAL_STATES).toHaveLength(4);
	});

	it("isResumable returns true for loading_plan, executing, awaiting_approval, verifying", () => {
		for (const state of RESUMABLE_STATES) {
			const f = new OrchestratorFSM(state);
			expect(f.isResumable()).toBe(true);
		}
		expect(RESUMABLE_STATES).toContain("loading_plan");
		expect(RESUMABLE_STATES).toContain("executing");
		expect(RESUMABLE_STATES).toContain("awaiting_approval");
		expect(RESUMABLE_STATES).toContain("verifying");
		expect(RESUMABLE_STATES).toHaveLength(4);
	});

	it("records history with timestamps and actions", () => {
		fsm.transition("loading_plan", "step1");
		fsm.transition("executing", "step2");
		const history = fsm.getHistory();
		expect(history).toHaveLength(2);
		expect(history[0].from).toBe("idle");
		expect(history[0].to).toBe("loading_plan");
		expect(history[0].action).toBe("step1");
		expect(history[0].at).toBeDefined();
		expect(typeof history[0].at).toBe("string");
		// Verify ISO 8601 format
		expect(new Date(history[0].at).toISOString()).toBe(history[0].at);
		expect(history[1].from).toBe("loading_plan");
		expect(history[1].to).toBe("executing");
		expect(history[1].action).toBe("step2");
	});

	it("serializes and deserializes correctly (state + history preserved)", () => {
		fsm.transition("loading_plan", "a");
		fsm.transition("executing", "b");
		const serialized = fsm.serialize();
		const restored = OrchestratorFSM.deserialize(serialized);
		expect(restored.getState()).toBe("executing");
		expect(restored.getHistory()).toHaveLength(2);
		expect(restored.getHistory()[0].from).toBe("idle");
		expect(restored.getHistory()[0].to).toBe("loading_plan");
		expect(restored.getHistory()[1].from).toBe("loading_plan");
		expect(restored.getHistory()[1].to).toBe("executing");
	});

	it("rejects illegal transition with descriptive reason containing both states", () => {
		const result = fsm.transition("completed", "test");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain("idle");
			expect(result.reason).toContain("completed");
		}
	});
});
