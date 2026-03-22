/**
 * Acceptance Tests — Execution Orchestrator
 *
 * Tests the orchestrator/index.ts entry point which registers
 * the "orchestrator" tool and "/exec" command. Each test calls
 * the execute handler directly via a mock pi extension API.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { registerOrchestrator, resetOrchestratorState } from "../index.js";
import { OrchestratorFSM } from "../fsm.js";
import { StepLedger } from "../ledger.js";
import {
	initOrchestratorStructure, saveWorkflow, loadWorkflow,
	getActiveWorkflowId, setActiveWorkflowId, generateWorkflowId,
} from "../persistence.js";

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

function createApprovedPlan(cwd: string, planId: string) {
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
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-ac-"));
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
// 1. load_plan
// ═══════════════════════════════════════════════════════════════

describe("load_plan", () => {
	it("loads an approved plan and transitions to loading_plan", async () => {
		const planId = "test-plan-001";
		createApprovedPlan(tmpDir, planId);

		const { details } = await execAction(getTool(), ctx, { action: "load_plan", plan_id: planId });

		expect(details.success).toBe(true);
		expect(details.action).toBe("load_plan");
		expect(details.message).toContain(planId);

		// Workflow should be created on disk
		const wfId = getActiveWorkflowId(tmpDir);
		expect(wfId).toBeTruthy();
	});

	it("rejects when no plan_id provided", async () => {
		const { details } = await execAction(getTool(), ctx, { action: "load_plan" });

		expect(details.success).toBe(false);
		expect(details.message).toMatch(/plan_id/i);
	});

	it("rejects plan that is not in planned state", async () => {
		const planId = "draft-plan";
		const planDir = path.join(tmpDir, ".pi/planner/plans", planId);
		fs.mkdirSync(planDir, { recursive: true });

		const plan = {
			version: "1.0.0", id: planId, intent: "test", goal: "test", summary: "test",
			phases: [], tasks: [], envelope: { pathScope: ["src/**"], allowedOperations: ["read"], allowedTools: ["files"], subagentPermissions: { maxConcurrent: 1, allowedCapabilities: [], scopeConstraints: [] }, changeBudget: { maxFilesModified: 1, maxFilesCreated: 1, maxLinesChanged: 100 } },
			successCriteria: [], verificationSteps: [],
			createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
			highImpact: false, validationResult: null,
		};
		const stateJson = { planId, fsm: { state: "drafting", history: [] }, showboatPath: path.join(planDir, "showboat.md") };
		fs.writeFileSync(path.join(planDir, "plan.json"), JSON.stringify(plan));
		fs.writeFileSync(path.join(planDir, "state.json"), JSON.stringify(stateJson));

		const { details } = await execAction(getTool(), ctx, { action: "load_plan", plan_id: planId });

		expect(details.success).toBe(false);
		expect(details.message).toMatch(/planned|approved/i);
	});
});

// ═══════════════════════════════════════════════════════════════
// 2. start
// ═══════════════════════════════════════════════════════════════

describe("start", () => {
	it("transitions from loading_plan to executing", async () => {
		const planId = "test-plan-002";
		createApprovedPlan(tmpDir, planId);
		await execAction(getTool(), ctx, { action: "load_plan", plan_id: planId });

		const { details } = await execAction(getTool(), ctx, { action: "start" });

		expect(details.success).toBe(true);
		expect(details.action).toBe("start");
		// Should include execution order
		expect(details.data).toBeDefined();
	});

	it("rejects if not in loading_plan state", async () => {
		const { details } = await execAction(getTool(), ctx, { action: "start" });

		expect(details.success).toBe(false);
		expect(details.message).toMatch(/loading_plan|idle|no active/i);
	});
});

// ═══════════════════════════════════════════════════════════════
// 3. execute_step
// ═══════════════════════════════════════════════════════════════

describe("execute_step", () => {
	async function setupExecuting() {
		const planId = "test-plan-exec";
		createApprovedPlan(tmpDir, planId);
		await execAction(getTool(), ctx, { action: "load_plan", plan_id: planId });
		await execAction(getTool(), ctx, { action: "start" });
	}

	it("returns next task in dependency order", async () => {
		await setupExecuting();

		const { details } = await execAction(getTool(), ctx, { action: "execute_step" });

		expect(details.success).toBe(true);
		expect(details.action).toBe("execute_step");
		// First task in topological order should be task-1 (no dependencies)
		expect(details.data).toBeDefined();
		const data = details.data as any;
		expect(data.taskId).toBe("task-1");
	});

	it("skips already committed steps", async () => {
		await setupExecuting();

		// Execute and commit task-1
		await execAction(getTool(), ctx, { action: "execute_step" });
		await execAction(getTool(), ctx, {
			action: "report_result",
			files_modified: ["src/test.ts"],
			lines_changed: 10,
			audit_note: "wrote test",
		});

		// Next step should be task-2
		const { details } = await execAction(getTool(), ctx, { action: "execute_step" });
		expect(details.success).toBe(true);
		const data = details.data as any;
		expect(data.taskId).toBe("task-2");
	});
});

// ═══════════════════════════════════════════════════════════════
// 4. report_result
// ═══════════════════════════════════════════════════════════════

describe("report_result", () => {
	async function setupWithStep() {
		const planId = "test-plan-report";
		createApprovedPlan(tmpDir, planId);
		await execAction(getTool(), ctx, { action: "load_plan", plan_id: planId });
		await execAction(getTool(), ctx, { action: "start" });
		await execAction(getTool(), ctx, { action: "execute_step" });
	}

	it("commits step and updates budget", async () => {
		await setupWithStep();

		const { details } = await execAction(getTool(), ctx, {
			action: "report_result",
			files_modified: ["src/a.ts", "src/b.ts"],
			lines_changed: 50,
			audit_note: "implemented feature",
		});

		expect(details.success).toBe(true);
		expect(details.action).toBe("report_result");
	});

	it("rejects when no pending step", async () => {
		const planId = "test-plan-nopending";
		createApprovedPlan(tmpDir, planId);
		await execAction(getTool(), ctx, { action: "load_plan", plan_id: planId });
		await execAction(getTool(), ctx, { action: "start" });

		// No execute_step called, so no pending step
		const { details } = await execAction(getTool(), ctx, {
			action: "report_result",
			files_modified: ["src/x.ts"],
			lines_changed: 5,
			audit_note: "test",
		});

		expect(details.success).toBe(false);
		expect(details.message).toMatch(/pending|in.progress/i);
	});
});

// ═══════════════════════════════════════════════════════════════
// 5. verify
// ═══════════════════════════════════════════════════════════════

describe("verify", () => {
	async function setupAllCommitted() {
		const planId = "test-plan-verify";
		createApprovedPlan(tmpDir, planId);
		await execAction(getTool(), ctx, { action: "load_plan", plan_id: planId });
		await execAction(getTool(), ctx, { action: "start" });

		// Execute and commit all 3 tasks
		for (const taskId of ["task-1", "task-2", "task-3"]) {
			await execAction(getTool(), ctx, { action: "execute_step" });
			await execAction(getTool(), ctx, {
				action: "report_result",
				files_modified: [`src/${taskId}.ts`],
				lines_changed: 10,
				audit_note: `completed ${taskId}`,
			});
		}
	}

	it("transitions to verifying then completed", async () => {
		await setupAllCommitted();

		const { details } = await execAction(getTool(), ctx, { action: "verify" });

		expect(details.success).toBe(true);
		expect(details.action).toBe("verify");
		expect(details.message).toMatch(/completed|verified/i);
	});

	it("rejects if tasks not all committed", async () => {
		const planId = "test-plan-noverify";
		createApprovedPlan(tmpDir, planId);
		await execAction(getTool(), ctx, { action: "load_plan", plan_id: planId });
		await execAction(getTool(), ctx, { action: "start" });

		// Only complete task-1
		await execAction(getTool(), ctx, { action: "execute_step" });
		await execAction(getTool(), ctx, {
			action: "report_result",
			files_modified: ["src/test.ts"],
			lines_changed: 10,
			audit_note: "done",
		});

		const { details } = await execAction(getTool(), ctx, { action: "verify" });

		expect(details.success).toBe(false);
		expect(details.message).toMatch(/committed|complete/i);
	});
});

// ═══════════════════════════════════════════════════════════════
// 6. abort
// ═══════════════════════════════════════════════════════════════

describe("abort", () => {
	it("from executing transitions to aborted", async () => {
		const planId = "test-plan-abort";
		createApprovedPlan(tmpDir, planId);
		await execAction(getTool(), ctx, { action: "load_plan", plan_id: planId });
		await execAction(getTool(), ctx, { action: "start" });

		const { details } = await execAction(getTool(), ctx, { action: "abort" });

		expect(details.success).toBe(true);
		expect(details.message).toMatch(/aborted/i);
	});

	it("rejects from completed state", async () => {
		// Complete a full workflow first
		const planId = "test-plan-abort-complete";
		createApprovedPlan(tmpDir, planId);
		await execAction(getTool(), ctx, { action: "load_plan", plan_id: planId });
		await execAction(getTool(), ctx, { action: "start" });

		for (const _taskId of ["task-1", "task-2", "task-3"]) {
			await execAction(getTool(), ctx, { action: "execute_step" });
			await execAction(getTool(), ctx, {
				action: "report_result",
				files_modified: ["src/f.ts"],
				lines_changed: 5,
				audit_note: "done",
			});
		}
		await execAction(getTool(), ctx, { action: "verify" });

		// Now try to abort — should fail since completed
		const { details } = await execAction(getTool(), ctx, { action: "abort" });

		expect(details.success).toBe(false);
	});
});

// ═══════════════════════════════════════════════════════════════
// 7. status
// ═══════════════════════════════════════════════════════════════

describe("status", () => {
	it("returns current state and budget when idle", async () => {
		const { details } = await execAction(getTool(), ctx, { action: "status" });

		expect(details.success).toBe(true);
		expect(details.action).toBe("status");
		expect(details.message).toMatch(/idle/i);
	});

	it("returns budget info when executing", async () => {
		const planId = "test-plan-status";
		createApprovedPlan(tmpDir, planId);
		await execAction(getTool(), ctx, { action: "load_plan", plan_id: planId });
		await execAction(getTool(), ctx, { action: "start" });

		const { details } = await execAction(getTool(), ctx, { action: "status" });

		expect(details.success).toBe(true);
		expect(details.data).toBeDefined();
		const data = details.data as any;
		expect(data.state).toBe("executing");
	});
});

// ═══════════════════════════════════════════════════════════════
// 8. resume after crash
// ═══════════════════════════════════════════════════════════════

describe("resume after crash", () => {
	it("restores state from disk on session_start", async () => {
		const planId = "test-plan-resume";
		createApprovedPlan(tmpDir, planId);
		await execAction(getTool(), ctx, { action: "load_plan", plan_id: planId });
		await execAction(getTool(), ctx, { action: "start" });

		// Verify active workflow exists
		const wfId = getActiveWorkflowId(tmpDir);
		expect(wfId).toBeTruthy();

		// Simulate crash: create new pi mock and register
		const pi2 = createMockPi();
		registerOrchestrator(pi2 as any);

		// Trigger session_start
		const handlers = pi2.events["session_start"];
		expect(handlers).toBeDefined();
		expect(handlers.length).toBeGreaterThan(0);
		await handlers[0]({}, createMockCtx(tmpDir));

		// Status should show executing state
		const tool2 = pi2.tools["orchestrator"];
		const { details } = await execAction(tool2, createMockCtx(tmpDir), { action: "status" });

		expect(details.success).toBe(true);
		const data = details.data as any;
		expect(data.state).toBe("executing");
	});
});

// ═══════════════════════════════════════════════════════════════
// 9. Full TDD workflow end-to-end
// ═══════════════════════════════════════════════════════════════

describe("full TDD workflow end-to-end", () => {
	it("load_plan -> start -> execute all tasks -> verify -> completed", async () => {
		const planId = "test-plan-e2e";
		createApprovedPlan(tmpDir, planId);

		// 1. load_plan
		const load = await execAction(getTool(), ctx, { action: "load_plan", plan_id: planId });
		expect(load.details.success).toBe(true);

		// 2. start
		const start = await execAction(getTool(), ctx, { action: "start" });
		expect(start.details.success).toBe(true);

		// 3. execute all 3 tasks in dependency order
		const taskOrder = ["task-1", "task-2", "task-3"];
		for (let i = 0; i < taskOrder.length; i++) {
			const step = await execAction(getTool(), ctx, { action: "execute_step" });
			expect(step.details.success).toBe(true);
			const stepData = step.details.data as any;
			expect(stepData.taskId).toBe(taskOrder[i]);

			const report = await execAction(getTool(), ctx, {
				action: "report_result",
				files_modified: [`src/${taskOrder[i]}.ts`],
				lines_changed: 20,
				audit_note: `completed ${taskOrder[i]}`,
			});
			expect(report.details.success).toBe(true);
		}

		// 4. verify
		const verify = await execAction(getTool(), ctx, { action: "verify" });
		expect(verify.details.success).toBe(true);
		expect(verify.details.message).toMatch(/completed|verified/i);

		// 5. Final status check — should either be completed or idle after completion
		const status = await execAction(getTool(), ctx, { action: "status" });
		expect(status.details.success).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════════
// 10. Showboat document
// ═══════════════════════════════════════════════════════════════

describe("Showboat document", () => {
	it("is created on load_plan", async () => {
		const planId = "test-plan-showboat";
		createApprovedPlan(tmpDir, planId);

		await execAction(getTool(), ctx, { action: "load_plan", plan_id: planId });

		// The orchestrator creates its showboat in the workflow dir
		const wfId = getActiveWorkflowId(tmpDir);
		expect(wfId).toBeTruthy();

		const wfDir = path.join(tmpDir, ".pi/orchestrator/workflows", wfId!);
		const showboatPath = path.join(wfDir, "showboat.md");
		expect(fs.existsSync(showboatPath)).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════════
// 11. Budget exceeded
// ═══════════════════════════════════════════════════════════════

describe("budget exceeded", () => {
	it("blocks progression when budget is exceeded", async () => {
		// Create plan with tiny budget
		const planId = "test-plan-budget";
		const planDir = path.join(tmpDir, ".pi/planner/plans", planId);
		fs.mkdirSync(planDir, { recursive: true });

		const plan = {
			version: "1.0.0", id: planId, intent: "test", goal: "test", summary: "test",
			phases: [
				{ name: "write-tests", type: "red", description: "Write tests", tasks: ["task-1"] },
				{ name: "implement", type: "green", description: "Implement", tasks: ["task-2"] },
				{ name: "verify-all", type: "verify", description: "Verify", tasks: ["task-3"] },
			],
			tasks: [
				{ id: "task-1", phaseRef: "write-tests", title: "Write test", description: "test", dependencies: [], expectedOutcome: "test", verificationStep: "test", status: "pending" },
				{ id: "task-2", phaseRef: "implement", title: "Implement", description: "test", dependencies: ["task-1"], expectedOutcome: "test", verificationStep: "test", status: "pending" },
				{ id: "task-3", phaseRef: "verify-all", title: "Verify", description: "test", dependencies: ["task-2"], expectedOutcome: "test", verificationStep: "test", status: "pending" },
			],
			envelope: {
				pathScope: ["src/**"],
				allowedOperations: ["read", "write", "create"],
				allowedTools: ["files", "bash"],
				subagentPermissions: { maxConcurrent: 1, allowedCapabilities: ["read-only"], scopeConstraints: ["src/**"] },
				changeBudget: { maxFilesModified: 1, maxFilesCreated: 1, maxLinesChanged: 50 },
			},
			successCriteria: [{ id: "sc-1", description: "Tests pass", measurable: true }],
			verificationSteps: [{ id: "vs-1", description: "Run tests", expectedResult: "0 failures" }],
			createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
			highImpact: false,
			validationResult: { valid: true, issues: [], score: { overall: 100, breakdown: { structuralCompleteness: 100, phaseOrdering: 100, dependencyIntegrity: 100, envelopeConstraints: 100, verificationCoverage: 100, subagentPolicy: 100 } } },
		};
		const stateJson = { planId, fsm: { state: "planned", history: [] }, showboatPath: path.join(planDir, "showboat.md") };
		fs.writeFileSync(path.join(planDir, "plan.json"), JSON.stringify(plan));
		fs.writeFileSync(path.join(planDir, "state.json"), JSON.stringify(stateJson));

		await execAction(getTool(), ctx, { action: "load_plan", plan_id: planId });
		await execAction(getTool(), ctx, { action: "start" });

		// Execute and commit task-1 with files that exceed budget
		await execAction(getTool(), ctx, { action: "execute_step" });
		const report = await execAction(getTool(), ctx, {
			action: "report_result",
			files_modified: ["src/a.ts", "src/b.ts"],
			lines_changed: 30,
			audit_note: "wrote lots of code",
		});

		// The report_result should succeed but warn about budget, or the next step should be blocked
		// Either: report fails due to budget, or it succeeds and next execute_step is blocked
		if (report.details.success) {
			// Budget exceeded should show in message or block next step
			const nextStep = await execAction(getTool(), ctx, { action: "execute_step" });
			// Either blocked or warning about budget
			expect(
				report.details.message.match(/budget/i) ||
				nextStep.details.message.match(/budget/i) ||
				!nextStep.details.success,
			).toBeTruthy();
		} else {
			expect(report.details.message).toMatch(/budget/i);
		}
	});
});

// ═══════════════════════════════════════════════════════════════
// 12. Registration
// ═══════════════════════════════════════════════════════════════

describe("registration", () => {
	it("registers orchestrator tool", () => {
		expect(pi.tools["orchestrator"]).toBeDefined();
		expect(pi.tools["orchestrator"].name).toBe("orchestrator");
	});

	it("registers /exec command", () => {
		expect(pi.commands["exec"]).toBeDefined();
	});

	it("registers session_start hook", () => {
		expect(pi.events["session_start"]).toBeDefined();
		expect(pi.events["session_start"].length).toBeGreaterThan(0);
	});
});

// ═══════════════════════════════════════════════════════════════
// 13. Command subcommands
// ═══════════════════════════════════════════════════════════════

describe("/exec command", () => {
	it("status subcommand works", async () => {
		const notifications: string[] = [];
		const cmdCtx = {
			...ctx,
			ui: { ...ctx.ui, notify: (msg: string, _level: string) => { notifications.push(msg); } },
		};

		await pi.commands["exec"].handler("status", cmdCtx);
		expect(notifications.length).toBeGreaterThan(0);
		expect(notifications[0]).toMatch(/idle|state/i);
	});

	it("unknown subcommand gives error", async () => {
		const notifications: string[] = [];
		const cmdCtx = {
			...ctx,
			ui: { ...ctx.ui, notify: (msg: string, _level: string) => { notifications.push(msg); } },
		};

		await pi.commands["exec"].handler("nonsense", cmdCtx);
		expect(notifications.length).toBeGreaterThan(0);
		expect(notifications[0]).toMatch(/unknown/i);
	});
});
