/**
 * Policy Integration Tests — Execution Orchestrator
 *
 * RED-phase TDD tests for policy gaps in the orchestrator tool handler.
 * These tests verify that the orchestrator enforces policy checks for:
 *   - High-impact file detection (AC 8.3)
 *   - Envelope path-scope enforcement (AC 9.1)
 *   - Edit-after-green detection (AC 8.3)
 *   - Bulk edit detection (AC 8.3)
 *
 * All tests are expected to FAIL until the corresponding features are implemented.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { registerOrchestrator, resetOrchestratorState } from "../index.js";
import { getActiveWorkflowId } from "../persistence.js";

// ── Mock pi extension API ──

function createMockPi() {
	const tools: Record<string, any> = {};
	const commands: Record<string, any> = {};
	const events: Record<string, any[]> = {};
	return {
		registerTool(config: any) { tools[config.name] = config; },
		registerCommand(name: string, config: any) { commands[name] = config; },
		on(event: string, handler: any) {
			if (!events[event]) events[event] = [];
			events[event].push(handler);
		},
		sendMessage(_msg: any) {},
		tools,
		commands,
		events,
	};
}

function createMockCtx(cwd: string) {
	return {
		cwd,
		ui: {
			confirm: async (_title: string, _msg: string) => true,
			notify: (_msg: string, _level: string) => {},
		},
	};
}

// ── Helper to create a minimal approved plan on disk ──

function createApprovedPlan(cwd: string, planId: string, overrides?: Partial<any>) {
	const planDir = path.join(cwd, ".pi/planner/plans", planId);
	fs.mkdirSync(planDir, { recursive: true });

	const plan = {
		version: "1.0.0",
		id: planId,
		intent: "test intent",
		goal: "test goal",
		summary: "test summary",
		phases: [
			{ name: "write-tests", type: "red", description: "Write failing tests", tasks: ["task-1"] },
			{ name: "implement", type: "green", description: "Make tests pass", tasks: ["task-2"] },
			{ name: "verify-all", type: "verify", description: "Run all tests", tasks: ["task-3"] },
		],
		tasks: [
			{
				id: "task-1", phaseRef: "write-tests", title: "Write test", description: "Write a failing test",
				dependencies: [], expectedOutcome: "failing test", verificationStep: "npm test fails",
				status: "pending",
			},
			{
				id: "task-2", phaseRef: "implement", title: "Implement", description: "Make test pass",
				dependencies: ["task-1"], expectedOutcome: "passing test", verificationStep: "npm test passes",
				status: "pending",
			},
			{
				id: "task-3", phaseRef: "verify-all", title: "Verify", description: "Run full suite",
				dependencies: ["task-2"], expectedOutcome: "all pass", verificationStep: "npm test",
				status: "pending",
			},
		],
		envelope: {
			pathScope: ["src/**"],
			allowedOperations: ["read", "write", "create"],
			allowedTools: ["files", "bash"],
			subagentPermissions: { maxConcurrent: 4, allowedCapabilities: ["read-only", "execution"], scopeConstraints: ["src/**"] },
			changeBudget: { maxFilesModified: 10, maxFilesCreated: 5, maxLinesChanged: 1000 },
		},
		successCriteria: [{ id: "sc-1", description: "Tests pass", measurable: true }],
		verificationSteps: [{ id: "vs-1", description: "Run tests", expectedResult: "0 failures" }],
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		highImpact: false,
		validationResult: { valid: true, issues: [], score: { overall: 100, breakdown: { structuralCompleteness: 100, phaseOrdering: 100, dependencyIntegrity: 100, envelopeConstraints: 100, verificationCoverage: 100, subagentPolicy: 100 } } },
		...overrides,
	};

	const stateJson = {
		planId,
		fsm: { state: "planned", history: [] },
		showboatPath: path.join(planDir, "showboat.md"),
	};

	fs.writeFileSync(path.join(planDir, "plan.json"), JSON.stringify(plan, null, 2));
	fs.writeFileSync(path.join(planDir, "state.json"), JSON.stringify(stateJson, null, 2));

	return plan;
}

// ── Helper to execute orchestrator tool actions ──

async function execAction(tool: any, ctx: any, params: Record<string, any>) {
	const result = await tool.execute("test-call-id", params, undefined, undefined, ctx);
	return { content: result.content, details: result.details };
}

// ── Test Suite ──

let tmpDir: string;
let pi: ReturnType<typeof createMockPi>;
let ctx: ReturnType<typeof createMockCtx>;

beforeEach(() => {
	resetOrchestratorState();
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-policy-"));
	pi = createMockPi();
	registerOrchestrator(pi as any);
	ctx = createMockCtx(tmpDir);
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function getTool() {
	return pi.tools["orchestrator"];
}

// ═══════════════════════════════════════════════════════════════
// AC 8.3 — High-impact file detection
// ═══════════════════════════════════════════════════════════════

describe("high-impact file detection (AC 8.3)", () => {
	async function setupWithPendingStep() {
		const planId = "test-plan-highimpact";
		createApprovedPlan(tmpDir, planId);
		await execAction(getTool(), ctx, { action: "load_plan", plan_id: planId });
		await execAction(getTool(), ctx, { action: "start" });
		await execAction(getTool(), ctx, { action: "execute_step" });
	}

	it("report_result with package.json in files_modified triggers approval", async () => {
		await setupWithPendingStep();

		const { details } = await execAction(getTool(), ctx, {
			action: "report_result",
			files_modified: ["package.json"],
			lines_changed: 5,
			audit_note: "added dependency",
		});

		// The orchestrator should detect package.json as a high-impact file
		// and either transition to awaiting_approval or signal approval_required.
		const triggersApproval =
			details.success === false ||
			details.message?.match(/approval/i) ||
			details.data?.approval_required === true;
		expect(triggersApproval).toBeTruthy();
	});

	it("report_result with .github/workflows/ci.yml in files_modified triggers approval", async () => {
		await setupWithPendingStep();

		const { details } = await execAction(getTool(), ctx, {
			action: "report_result",
			files_modified: [".github/workflows/ci.yml"],
			lines_changed: 3,
			audit_note: "updated CI pipeline",
		});

		// .github/** matches HIGH_IMPACT_PATTERNS — should require approval.
		const triggersApproval =
			details.success === false ||
			details.message?.match(/approval/i) ||
			details.data?.approval_required === true;
		expect(triggersApproval).toBeTruthy();
	});
});

// ═══════════════════════════════════════════════════════════════
// AC 9.1 — Envelope path-scope enforcement
// ═══════════════════════════════════════════════════════════════

describe("envelope enforcement (AC 9.1)", () => {
	async function setupWithPendingStep() {
		const planId = "test-plan-envelope";
		createApprovedPlan(tmpDir, planId);
		await execAction(getTool(), ctx, { action: "load_plan", plan_id: planId });
		await execAction(getTool(), ctx, { action: "start" });
		await execAction(getTool(), ctx, { action: "execute_step" });
	}

	it("report_result with out-of-scope file transitions to awaiting_approval", async () => {
		await setupWithPendingStep();

		// pathScope is ["src/**"], so config/settings.json is out of scope
		const { details } = await execAction(getTool(), ctx, {
			action: "report_result",
			files_modified: ["config/settings.json"],
			lines_changed: 10,
			audit_note: "updated config",
		});

		// The orchestrator should detect that config/settings.json is outside
		// the envelope's pathScope and require approval.
		const triggersApproval =
			details.success === false ||
			details.message?.match(/approval|scope|envelope/i) ||
			details.data?.approval_required === true;
		expect(triggersApproval).toBeTruthy();
	});
});

// ═══════════════════════════════════════════════════════════════
// AC 8.3 — Edit-after-green detection
// ═══════════════════════════════════════════════════════════════

describe("edit-after-green detection (AC 8.3)", () => {
	it("execute_step after green committed requires approval for non-verify task", async () => {
		// Create a plan with 4 tasks: red, green, refactor (non-verify), verify.
		// After green is committed, executing the refactor task should trigger approval.
		const planId = "test-plan-edit-after-green";
		createApprovedPlan(tmpDir, planId, {
			phases: [
				{ name: "write-tests", type: "red", description: "Write failing tests", tasks: ["task-1"] },
				{ name: "implement", type: "green", description: "Make tests pass", tasks: ["task-2"] },
				{ name: "refactor", type: "refactor", description: "Refactor code", tasks: ["task-4"] },
				{ name: "verify-all", type: "verify", description: "Run all tests", tasks: ["task-3"] },
			],
			tasks: [
				{
					id: "task-1", phaseRef: "write-tests", title: "Write test", description: "Write a failing test",
					dependencies: [], expectedOutcome: "failing test", verificationStep: "npm test fails",
					status: "pending",
				},
				{
					id: "task-2", phaseRef: "implement", title: "Implement", description: "Make test pass",
					dependencies: ["task-1"], expectedOutcome: "passing test", verificationStep: "npm test passes",
					status: "pending",
				},
				{
					id: "task-4", phaseRef: "refactor", title: "Refactor", description: "Clean up code",
					dependencies: ["task-2"], expectedOutcome: "cleaner code", verificationStep: "npm test passes",
					status: "pending",
				},
				{
					id: "task-3", phaseRef: "verify-all", title: "Verify", description: "Run full suite",
					dependencies: ["task-4"], expectedOutcome: "all pass", verificationStep: "npm test",
					status: "pending",
				},
			],
		});

		await execAction(getTool(), ctx, { action: "load_plan", plan_id: planId });
		await execAction(getTool(), ctx, { action: "start" });

		// Complete task-1 (red phase)
		await execAction(getTool(), ctx, { action: "execute_step" });
		await execAction(getTool(), ctx, {
			action: "report_result",
			files_modified: ["src/test.ts"],
			lines_changed: 20,
			audit_note: "wrote failing test",
		});

		// Complete task-2 (green phase)
		await execAction(getTool(), ctx, { action: "execute_step" });
		await execAction(getTool(), ctx, {
			action: "report_result",
			files_modified: ["src/impl.ts"],
			lines_changed: 30,
			audit_note: "made test pass",
		});

		// Now execute task-4 (refactor phase — non-verify edit after green).
		// This should require approval because it is an edit after the green phase committed.
		const { details } = await execAction(getTool(), ctx, { action: "execute_step" });

		const triggersApproval =
			details.success === false ||
			details.message?.match(/approval|edit.after.green/i) ||
			details.data?.triggers?.some((t: string) => /green/i.test(t));
		expect(triggersApproval).toBeTruthy();
	});
});

// ═══════════════════════════════════════════════════════════════
// AC 8.3 — Bulk edit detection
// ═══════════════════════════════════════════════════════════════

describe("bulk edit detection (AC 8.3)", () => {
	async function setupWithPendingStep() {
		const planId = "test-plan-bulkedit";
		createApprovedPlan(tmpDir, planId);
		await execAction(getTool(), ctx, { action: "load_plan", plan_id: planId });
		await execAction(getTool(), ctx, { action: "start" });
		await execAction(getTool(), ctx, { action: "execute_step" });
	}

	it("report_result with 5+ files triggers bulk edit approval", async () => {
		await setupWithPendingStep();

		// bulkEditThreshold defaults to 5, so 6 files should trigger approval.
		const { details } = await execAction(getTool(), ctx, {
			action: "report_result",
			files_modified: [
				"src/a.ts",
				"src/b.ts",
				"src/c.ts",
				"src/d.ts",
				"src/e.ts",
				"src/f.ts",
			],
			lines_changed: 60,
			audit_note: "bulk refactor",
		});

		// The orchestrator should detect that 6 files exceed the bulk edit
		// threshold (5) and require approval.
		const triggersApproval =
			details.success === false ||
			details.message?.match(/approval|bulk/i) ||
			details.data?.approval_required === true;
		expect(triggersApproval).toBeTruthy();
	});
});
