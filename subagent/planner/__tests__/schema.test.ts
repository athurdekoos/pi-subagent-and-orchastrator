import { describe, it, expect, beforeEach } from "vitest";
import {
	createPlan, createPhase, createTask, createEnvelope,
	createSuccessCriterion, createVerificationStep, resetIdCounter, generatePlanId,
} from "../schema.js";

describe("schema", () => {
	beforeEach(() => {
		resetIdCounter();
	});

	describe("createPlan", () => {
		it("creates a valid plan scaffold", () => {
			const plan = createPlan("add caching");
			expect(plan.version).toBe("1.0.0");
			expect(plan.intent).toBe("add caching");
			expect(plan.phases).toEqual([]);
			expect(plan.tasks).toEqual([]);
			expect(plan.createdAt).toBeTruthy();
			expect(plan.highImpact).toBe(false);
			expect(plan.validationResult).toBeNull();
		});

		it("generates unique plan IDs", () => {
			const p1 = createPlan("task A");
			const p2 = createPlan("task B");
			expect(p1.id).not.toBe(p2.id);
		});
	});

	describe("createPhase", () => {
		it("creates a phase with correct type", () => {
			const phase = createPhase("test-setup", "red", "Write failing tests");
			expect(phase.name).toBe("test-setup");
			expect(phase.type).toBe("red");
			expect(phase.description).toBe("Write failing tests");
			expect(phase.tasks).toEqual([]);
		});
	});

	describe("createTask", () => {
		it("creates a task with defaults", () => {
			const task = createTask("red", "Write test", "Create unit test");
			expect(task.id).toMatch(/^task-/);
			expect(task.phaseRef).toBe("red");
			expect(task.dependencies).toEqual([]);
			expect(task.status).toBe("pending");
		});

		it("creates a task with options", () => {
			const task = createTask("green", "Implement", "Do it", {
				dependencies: ["task-1"],
				expectedOutcome: "Code works",
				verificationStep: "npm test",
			});
			expect(task.dependencies).toEqual(["task-1"]);
			expect(task.expectedOutcome).toBe("Code works");
			expect(task.verificationStep).toBe("npm test");
		});

		it("generates unique task IDs", () => {
			const t1 = createTask("red", "A", "a");
			const t2 = createTask("red", "B", "b");
			expect(t1.id).not.toBe(t2.id);
		});
	});

	describe("createEnvelope", () => {
		it("creates default envelope", () => {
			const env = createEnvelope();
			expect(env.pathScope).toEqual([]);
			expect(env.allowedOperations).toEqual([]);
			expect(env.subagentPermissions.maxConcurrent).toBe(4);
		});

		it("accepts overrides", () => {
			const env = createEnvelope({
				pathScope: ["src/**"],
				allowedOperations: ["read", "write"],
			});
			expect(env.pathScope).toEqual(["src/**"]);
			expect(env.allowedOperations).toEqual(["read", "write"]);
		});
	});

	describe("createSuccessCriterion", () => {
		it("creates a measurable criterion", () => {
			const c = createSuccessCriterion("all tests pass");
			expect(c.description).toBe("all tests pass");
			expect(c.measurable).toBe(true);
			expect(c.id).toMatch(/^criterion-/);
		});
	});

	describe("createVerificationStep", () => {
		it("creates a step with command", () => {
			const v = createVerificationStep("run tests", "npm test", "0 failures");
			expect(v.description).toBe("run tests");
			expect(v.command).toBe("npm test");
			expect(v.expectedResult).toBe("0 failures");
		});
	});

	describe("generatePlanId", () => {
		it("includes timestamp and slug", () => {
			const id = generatePlanId("add redis caching");
			expect(id).toMatch(/^\d{4}-\d{2}-\d{2}-\d{4}-add-redis-caching$/);
		});
	});
});
