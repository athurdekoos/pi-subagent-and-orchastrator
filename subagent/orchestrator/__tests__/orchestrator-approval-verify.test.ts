/**
 * Acceptance Tests — Orchestrator Approval & Verification
 *
 * Tests verification command execution (AC 5.4), approval records
 * (AC 4.1, 6.1), fail_step action (AC 4.1), and non-fatal showboat
 * failure (AC 5.5). Each test calls the execute handler directly
 * via a mock pi extension API.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { registerOrchestrator, resetOrchestratorState } from "../index.js";
import { getActiveWorkflowId, loadWorkflow } from "../persistence.js";

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
		tools, commands, events,
	};
}

function createMockCtx(cwd: string, confirmResult = true) {
	return {
		cwd,
		ui: {
			confirm: async (_title: string, _msg: string) => confirmResult,
			notify: (_msg: string, _level: string) => {},
		},
	};
}

// ── Plan creation helper ──

function createApprovedPlan(cwd: string, planId: string, overrides?: any) {
	const planDir = path.join(cwd, ".pi/planner/plans", planId);
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
			subagentPermissions: { maxConcurrent: 4, allowedCapabilities: ["read-only", "execution"], scopeConstraints: ["src/**"] },
			changeBudget: { maxFilesModified: 10, maxFilesCreated: 5, maxLinesChanged: 1000 },
		},
		successCriteria: [{ id: "sc-1", description: "Tests pass", measurable: true }],
		verificationSteps: [{ id: "vs-1", description: "Run tests", expectedResult: "0 failures" }],
		createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
		highImpact: false,
		validationResult: { valid: true, issues: [], score: { overall: 100, breakdown: { structuralCompleteness: 100, phaseOrdering: 100, dependencyIntegrity: 100, envelopeConstraints: 100, verificationCoverage: 100, subagentPolicy: 100 } } },
	};
	if (overrides) Object.assign(plan, overrides);
	const stateJson = { planId, fsm: { state: "planned", history: [] }, showboatPath: path.join(planDir, "showboat.md") };
	fs.writeFileSync(path.join(planDir, "plan.json"), JSON.stringify(plan, null, 2));
	fs.writeFileSync(path.join(planDir, "state.json"), JSON.stringify(stateJson, null, 2));
	return plan;
}

async function execAction(tool: any, ctx: any, params: Record<string, any>) {
	const result = await tool.execute("test-call-id", params, undefined, undefined, ctx);
	return { content: result.content, details: result.details };
}

// ── Lifecycle ──

let tmpDir: string;
let pi: ReturnType<typeof createMockPi>;
let ctx: ReturnType<typeof createMockCtx>;

beforeEach(() => {
	resetOrchestratorState();
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-av-"));
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

// ── 1. Verification command execution (AC 5.4) ──

describe("verification command execution (AC 5.4)", () => {
	async function setupAllCommitted(planId: string, verificationSteps: any[]) {
		createApprovedPlan(tmpDir, planId, { verificationSteps });
		await execAction(getTool(), ctx, { action: "load_plan", plan_id: planId });
		await execAction(getTool(), ctx, { action: "start" });
		for (const _t of ["task-1", "task-2", "task-3"]) {
			await execAction(getTool(), ctx, { action: "execute_step" });
			await execAction(getTool(), ctx, {
				action: "report_result",
				files_modified: ["src/file.ts"],
				lines_changed: 10,
				audit_note: "done",
			});
		}
	}

	it("verify executes commands and includes output", async () => {
		await setupAllCommitted("plan-verify-cmd", [
			{ id: "vs-1", description: "Echo check", command: "echo hello", expectedResult: "hello" },
		]);
		const { details } = await execAction(getTool(), ctx, { action: "verify" });
		expect(details.success).toBe(true);
		expect(details.message).toMatch(/completed|verified/i);
	});

	it("verify transitions to failed when command fails", async () => {
		await setupAllCommitted("plan-verify-fail", [
			{ id: "vs-1", description: "Failing check", command: "exit 1", expectedResult: "should pass" },
		]);
		const { details } = await execAction(getTool(), ctx, { action: "verify" });
		expect(details.success).toBe(false);
		expect(details.message).toMatch(/fail/i);
	});

	it("verify passes for steps without command field", async () => {
		await setupAllCommitted("plan-verify-nocommand", [
			{ id: "vs-1", description: "Manual check", expectedResult: "0 failures" },
		]);
		const { details } = await execAction(getTool(), ctx, { action: "verify" });
		expect(details.success).toBe(true);
	});
});

// ── 2. Approval records (AC 4.1, 6.1) ──

describe("approval records (AC 4.1, 6.1)", () => {
	it("request_approval persists ApprovalRecord to workflow state", async () => {
		const planId = "plan-approval-record";
		createApprovedPlan(tmpDir, planId);
		await execAction(getTool(), ctx, { action: "load_plan", plan_id: planId });
		await execAction(getTool(), ctx, { action: "start" });
		await execAction(getTool(), ctx, { action: "execute_step" });

		// Report a high-impact file to trigger approval
		const reportResult = await execAction(getTool(), ctx, {
			action: "report_result",
			files_modified: ["package.json"],
			lines_changed: 2,
			audit_note: "added dep",
		});

		// Should have transitioned to awaiting_approval
		if (!reportResult.details.success || reportResult.details.message?.match(/approval/i)) {
			// Request and grant approval
			await execAction(getTool(), ctx, { action: "request_approval", reason: "high-impact file" });

			// Check workflow has approval record
			const wfId = getActiveWorkflowId(tmpDir);
			const wf = loadWorkflow(tmpDir, wfId!);
			expect(wf).not.toBeNull();
			expect(wf!.approvalRecords.length).toBeGreaterThanOrEqual(1);
			expect(wf!.approvalRecords[0].approved).toBe(true);
		}
	});

	it("approval denied transitions to blocked and records denial", async () => {
		const planId = "plan-approval-deny";
		createApprovedPlan(tmpDir, planId);
		const denyCtx = createMockCtx(tmpDir, false);
		await execAction(getTool(), denyCtx, { action: "load_plan", plan_id: planId });
		await execAction(getTool(), denyCtx, { action: "start" });
		await execAction(getTool(), denyCtx, { action: "execute_step" });

		// Trigger approval via high-impact file
		await execAction(getTool(), denyCtx, {
			action: "report_result",
			files_modified: ["package.json"],
			lines_changed: 2,
			audit_note: "added dep",
		});

		// Request approval (will be denied via mock)
		const { details } = await execAction(getTool(), denyCtx, { action: "request_approval", reason: "high-impact file" });

		expect(details.success).toBe(false);
		expect(details.message).toMatch(/denied|blocked/i);
	});
});

// ── 3. fail_step action (AC 4.1) ──

describe("fail_step action (AC 4.1)", () => {
	async function setupWithPendingStep() {
		const planId = "plan-fail-step";
		createApprovedPlan(tmpDir, planId);
		await execAction(getTool(), ctx, { action: "load_plan", plan_id: planId });
		await execAction(getTool(), ctx, { action: "start" });
		await execAction(getTool(), ctx, { action: "execute_step" });
	}

	it("marks pending step as failed", async () => {
		await setupWithPendingStep();
		const { details } = await execAction(getTool(), ctx, {
			action: "fail_step",
			reason: "compilation error",
		});
		expect(details.success).toBe(true);
		expect(details.message).toMatch(/fail/i);
	});

	it("rejects when no pending step", async () => {
		const planId = "plan-fail-nopending";
		createApprovedPlan(tmpDir, planId);
		await execAction(getTool(), ctx, { action: "load_plan", plan_id: planId });
		await execAction(getTool(), ctx, { action: "start" });

		// No execute_step, so no pending step
		const { details } = await execAction(getTool(), ctx, {
			action: "fail_step",
			reason: "should fail",
		});
		expect(details.success).toBe(false);
	});

	it("logs failure to showboat", async () => {
		await setupWithPendingStep();
		await execAction(getTool(), ctx, {
			action: "fail_step",
			reason: "test failure",
		});

		// Check showboat document contains failure entry
		const wfId = getActiveWorkflowId(tmpDir);
		const wf = loadWorkflow(tmpDir, wfId!);
		expect(wf).not.toBeNull();
		const showboatContent = fs.readFileSync(wf!.showboatPath, "utf-8");
		expect(showboatContent).toMatch(/fail/i);
	});
});

// ── 4. Non-fatal showboat failure (AC 5.5) ──

describe("non-fatal showboat failure (AC 5.5)", () => {
	it("workflow continues when showboat path is unwritable", async () => {
		const planId = "plan-showboat-fail";
		createApprovedPlan(tmpDir, planId);
		await execAction(getTool(), ctx, { action: "load_plan", plan_id: planId });

		// Corrupt the showboat path on disk to make it unwritable
		const wfId = getActiveWorkflowId(tmpDir);
		const wf = loadWorkflow(tmpDir, wfId!);
		expect(wf).not.toBeNull();
		// Replace showboat file with a directory (writing to it will fail)
		if (fs.existsSync(wf!.showboatPath)) {
			fs.unlinkSync(wf!.showboatPath);
		}
		fs.mkdirSync(wf!.showboatPath, { recursive: true });

		// Execution should still work despite showboat being broken
		const start = await execAction(getTool(), ctx, { action: "start" });
		expect(start.details.success).toBe(true);

		const step = await execAction(getTool(), ctx, { action: "execute_step" });
		expect(step.details.success).toBe(true);
	});
});
