import { describe, it, expect, beforeEach } from "vitest";
import { validatePlan, validateStructure, validatePhaseOrdering, validateDependencies, validateVerification } from "../validator.js";
import { createPlan, createPhase, createTask, createEnvelope, createSuccessCriterion, createVerificationStep, resetIdCounter } from "../schema.js";
import type { Plan } from "../types.js";

/** Build a complete valid plan for testing. */
function buildValidPlan(): Plan {
	resetIdCounter();
	const plan = createPlan("test intent");
	plan.goal = "test goal";
	plan.summary = "test summary";

	// TDD phases
	const red = createPhase("red-phase", "red", "Write failing tests");
	const green = createPhase("green-phase", "green", "Implement");
	const verify = createPhase("verify-phase", "verify", "Verify");
	plan.phases = [red, green, verify];

	// Tasks
	const t1 = createTask("red-phase", "Write test", "Create test", { verificationStep: "test exists" });
	const t2 = createTask("green-phase", "Implement", "Write code", { dependencies: [t1.id], verificationStep: "code compiles" });
	const t3 = createTask("verify-phase", "Run tests", "Execute", { dependencies: [t2.id], verificationStep: "tests pass" });
	plan.tasks = [t1, t2, t3];
	red.tasks = [t1.id];
	green.tasks = [t2.id];
	verify.tasks = [t3.id];

	// Envelope
	plan.envelope = createEnvelope({
		pathScope: ["src/**/*.ts"],
		allowedOperations: ["read", "write"],
		allowedTools: ["read", "write", "edit"],
		subagentPermissions: { maxConcurrent: 4, allowedCapabilities: ["read-only"], scopeConstraints: ["src/**"] },
		changeBudget: { maxFilesModified: 5, maxFilesCreated: 2, maxLinesChanged: 200 },
	});

	// Success criteria + verification
	plan.successCriteria = [createSuccessCriterion("all tests pass")];
	plan.verificationSteps = [createVerificationStep("run test suite", "npm test", "0 failures")];

	return plan;
}

describe("validator", () => {
	beforeEach(() => resetIdCounter());

	it("accepts a complete valid plan", () => {
		const result = validatePlan(buildValidPlan());
		expect(result.valid).toBe(true);
		expect(result.issues.filter(i => i.severity === "error")).toHaveLength(0);
		expect(result.score.overall).toBeGreaterThan(80);
	});

	it("rejects empty plan", () => {
		const plan = createPlan("empty");
		const result = validatePlan(plan);
		expect(result.valid).toBe(false);
		expect(result.issues.some(i => i.code === "EMPTY_PHASES")).toBe(true);
		expect(result.issues.some(i => i.code === "EMPTY_TASKS")).toBe(true);
	});

	it("rejects missing red phase", () => {
		const plan = buildValidPlan();
		plan.phases = plan.phases.filter(p => p.type !== "red");
		plan.tasks = plan.tasks.filter(t => t.phaseRef !== "red-phase");
		const result = validatePlan(plan);
		expect(result.issues.some(i => i.code === "MISSING_RED_PHASE")).toBe(true);
	});

	it("rejects wrong phase order (green before red)", () => {
		const plan = buildValidPlan();
		const [red, green, verify] = plan.phases;
		plan.phases = [green, red, verify];
		const result = validatePlan(plan);
		expect(result.issues.some(i => i.code === "RED_NOT_BEFORE_GREEN")).toBe(true);
	});

	it("detects circular dependencies", () => {
		const plan = buildValidPlan();
		// Create cycle: t1 → t2, t2 → t1
		plan.tasks[0].dependencies = [plan.tasks[1].id];
		plan.tasks[1].dependencies = [plan.tasks[0].id];
		const result = validatePlan(plan);
		expect(result.issues.some(i => i.code === "CIRCULAR_DEPENDENCY")).toBe(true);
	});

	it("detects self-dependency", () => {
		const plan = buildValidPlan();
		plan.tasks[0].dependencies = [plan.tasks[0].id];
		const result = validatePlan(plan);
		expect(result.issues.some(i => i.code === "SELF_DEPENDENCY")).toBe(true);
	});

	it("detects missing dependency reference", () => {
		const plan = buildValidPlan();
		plan.tasks[0].dependencies = ["nonexistent-task"];
		const result = validatePlan(plan);
		expect(result.issues.some(i => i.code === "DEPENDENCY_NOT_FOUND")).toBe(true);
	});

	it("rejects empty envelope path scope", () => {
		const plan = buildValidPlan();
		plan.envelope.pathScope = [];
		const result = validatePlan(plan);
		expect(result.issues.some(i => i.code === "EMPTY_PATH_SCOPE")).toBe(true);
	});

	it("rejects negative budget", () => {
		const plan = buildValidPlan();
		plan.envelope.changeBudget.maxFilesModified = -1;
		const result = validatePlan(plan);
		expect(result.issues.some(i => i.code === "NEGATIVE_BUDGET_VALUE")).toBe(true);
	});

	it("rejects task missing verification", () => {
		const plan = buildValidPlan();
		plan.tasks[0].verificationStep = "";
		const result = validatePlan(plan);
		expect(result.issues.some(i => i.code === "TASK_MISSING_VERIFICATION")).toBe(true);
	});

	it("rejects no verification steps", () => {
		const plan = buildValidPlan();
		plan.verificationSteps = [];
		const result = validatePlan(plan);
		expect(result.issues.some(i => i.code === "NO_VERIFICATION_STEPS")).toBe(true);
	});

	it("rejects duplicate task IDs", () => {
		const plan = buildValidPlan();
		plan.tasks[1].id = plan.tasks[0].id;
		const result = validatePlan(plan);
		expect(result.issues.some(i => i.code === "DUPLICATE_TASK_ID")).toBe(true);
	});

	it("rejects duplicate phase names", () => {
		const plan = buildValidPlan();
		plan.phases[1].name = plan.phases[0].name;
		const result = validatePlan(plan);
		expect(result.issues.some(i => i.code === "DUPLICATE_PHASE_NAME")).toBe(true);
	});

	it("score is 0-100", () => {
		const plan = buildValidPlan();
		const result = validatePlan(plan);
		expect(result.score.overall).toBeGreaterThanOrEqual(0);
		expect(result.score.overall).toBeLessThanOrEqual(100);
	});
});
