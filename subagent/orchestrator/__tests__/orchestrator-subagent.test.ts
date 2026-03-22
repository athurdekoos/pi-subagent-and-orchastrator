import { describe, it, expect } from "vitest";
import {
	mapCapability,
	bindSubagent,
	validateSubagentAction,
	isSubagentBudgetExhausted,
} from "../subagent-gov.js";
import type {
	PlanTask,
	PlanPhase,
	ExecutionEnvelope,
	SubagentRuntimeBinding,
} from "../types.js";

// ── Helpers ──

function makeEnvelope(overrides?: Partial<ExecutionEnvelope>): ExecutionEnvelope {
	return {
		pathScope: ["src/**"],
		allowedOperations: ["read", "write", "create", "delete"],
		allowedTools: ["Read", "Edit", "Write", "Bash"],
		subagentPermissions: {
			maxConcurrent: 2,
			allowedCapabilities: ["read-only", "execution", "mutation"],
			scopeConstraints: ["src/**"],
		},
		changeBudget: {
			maxFilesModified: 20,
			maxFilesCreated: 10,
			maxLinesChanged: 500,
		},
		...overrides,
	};
}

function makePhase(overrides?: Partial<PlanPhase>): PlanPhase {
	return {
		name: "red-phase",
		type: "red",
		description: "Write failing tests",
		tasks: ["task-1"],
		...overrides,
	};
}

function makeTask(overrides?: Partial<PlanTask>): PlanTask {
	return {
		id: "task-1",
		phaseRef: "red-phase",
		title: "Write tests",
		description: "Write failing tests for module X",
		dependencies: [],
		expectedOutcome: "Tests written and failing",
		verificationStep: "Run tests, expect failures",
		status: "pending",
		...overrides,
	};
}

function makeBinding(overrides?: Partial<SubagentRuntimeBinding>): SubagentRuntimeBinding {
	return {
		taskId: "task-1",
		role: "test-writer",
		capabilityClass: "read-only",
		pathScope: ["src/**"],
		allowedTools: ["Read", "Edit", "Write", "Bash"],
		mutationRights: false,
		stepBudget: 10,
		stepsUsed: 0,
		phaseRef: "red-phase",
		...overrides,
	};
}

// ── mapCapability ──

describe("mapCapability", () => {
	it('maps "read-only" to "read-only"', () => {
		expect(mapCapability("read-only")).toBe("read-only");
	});

	it('maps "execution" to "execution"', () => {
		expect(mapCapability("execution")).toBe("execution");
	});

	it('maps "mutation" to "mutation-capable"', () => {
		expect(mapCapability("mutation")).toBe("mutation-capable");
	});
});

// ── bindSubagent ──

describe("bindSubagent", () => {
	it("creates a binding from task assignment + envelope", () => {
		const task = makeTask({
			assignedSubagent: {
				role: "test-writer",
				capability: "read-only",
				scopeConstraints: ["src/tests/**"],
			},
		});
		const envelope = makeEnvelope();
		const phase = makePhase();

		const binding = bindSubagent(task, envelope, phase);

		expect(binding).not.toBeNull();
		expect(binding!.taskId).toBe("task-1");
		expect(binding!.role).toBe("test-writer");
		expect(binding!.capabilityClass).toBe("read-only");
		expect(binding!.pathScope).toEqual(["src/tests/**"]);
		expect(binding!.allowedTools).toEqual(envelope.allowedTools);
		expect(binding!.mutationRights).toBe(false);
		expect(binding!.stepBudget).toBe(10);
		expect(binding!.stepsUsed).toBe(0);
		expect(binding!.phaseRef).toBe("red-phase");
	});

	it("returns null for task without assignedSubagent", () => {
		const task = makeTask(); // no assignedSubagent
		const envelope = makeEnvelope();
		const phase = makePhase();

		const binding = bindSubagent(task, envelope, phase);
		expect(binding).toBeNull();
	});

	it("sets mutationRights=true only for mutation-capable", () => {
		const mutationTask = makeTask({
			assignedSubagent: {
				role: "mutator",
				capability: "mutation",
				scopeConstraints: ["src/**"],
			},
		});
		const execTask = makeTask({
			assignedSubagent: {
				role: "executor",
				capability: "execution",
				scopeConstraints: ["src/**"],
			},
		});
		const envelope = makeEnvelope();
		const phase = makePhase();

		const mutBinding = bindSubagent(mutationTask, envelope, phase);
		const execBinding = bindSubagent(execTask, envelope, phase);

		expect(mutBinding!.mutationRights).toBe(true);
		expect(execBinding!.mutationRights).toBe(false);
	});
});

// ── validateSubagentAction ──

describe("validateSubagentAction", () => {
	it("allows reads for read-only binding", () => {
		const binding = makeBinding({ capabilityClass: "read-only" });
		const result = validateSubagentAction(binding, { type: "read", targetPath: "src/foo.ts" });
		expect(result.allowed).toBe(true);
	});

	it("rejects writes for read-only binding", () => {
		const binding = makeBinding({ capabilityClass: "read-only" });
		const result = validateSubagentAction(binding, { type: "write", targetPath: "src/foo.ts" });
		expect(result.allowed).toBe(false);
		expect(result.reason).toBeDefined();
	});

	it("allows execution for execution binding", () => {
		const binding = makeBinding({ capabilityClass: "execution" });
		const result = validateSubagentAction(binding, { type: "execute" });
		expect(result.allowed).toBe(true);
	});

	it("rejects file mutations for execution binding", () => {
		const binding = makeBinding({ capabilityClass: "execution" });
		const writeResult = validateSubagentAction(binding, { type: "write", targetPath: "src/foo.ts" });
		const deleteResult = validateSubagentAction(binding, { type: "delete", targetPath: "src/foo.ts" });
		expect(writeResult.allowed).toBe(false);
		expect(deleteResult.allowed).toBe(false);
	});

	it("allows mutations for mutation-capable within scope", () => {
		const binding = makeBinding({
			capabilityClass: "mutation-capable",
			mutationRights: true,
			pathScope: ["src/**"],
		});
		const result = validateSubagentAction(binding, { type: "write", targetPath: "src/foo.ts" });
		expect(result.allowed).toBe(true);
	});

	it("rejects mutations outside scope for mutation-capable", () => {
		const binding = makeBinding({
			capabilityClass: "mutation-capable",
			mutationRights: true,
			pathScope: ["src/**"],
		});
		const result = validateSubagentAction(binding, { type: "write", targetPath: "lib/bar.ts" });
		expect(result.allowed).toBe(false);
		expect(result.reason).toBeDefined();
	});
});

// ── isSubagentBudgetExhausted ──

describe("isSubagentBudgetExhausted", () => {
	it("returns false when steps remaining", () => {
		const binding = makeBinding({ stepBudget: 10, stepsUsed: 5 });
		expect(isSubagentBudgetExhausted(binding)).toBe(false);
	});

	it("returns true when stepsUsed equals stepBudget", () => {
		const binding = makeBinding({ stepBudget: 10, stepsUsed: 10 });
		expect(isSubagentBudgetExhausted(binding)).toBe(true);
	});
});
