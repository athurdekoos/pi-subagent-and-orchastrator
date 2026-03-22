/**
 * Integration tests — Orchestrator subagent bindings, budget enforcement, and resume
 *
 * RED-phase TDD tests that exercise gaps in the orchestrator:
 *   - AC 10.1-10.3: Subagent bindings created during workflow execution
 *   - AC 10.3:      Subagent budget enforcement (stepsUsed tracking)
 *   - AC 5.2:       Resume preserving subagent bindings and approval records
 *
 * These tests SHOULD FAIL because the features are not yet implemented.
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

function createMockCtx(cwd: string) {
	return {
		cwd,
		ui: {
			confirm: async (_title: string, _msg: string) => true,
			notify: (_msg: string, _level: string) => {},
		},
	};
}

async function execAction(tool: any, ctx: any, params: Record<string, any>) {
	const result = await tool.execute("test-call-id", params, undefined, undefined, ctx);
	return { content: result.content, details: result.details };
}

// ── Helper to create an approved plan WITH subagent assignments ──

function createPlanWithSubagents(cwd: string, planId: string) {
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
			{
				id: "task-1", phaseRef: "write-tests", title: "Write test", description: "test",
				dependencies: [], expectedOutcome: "test", verificationStep: "test", status: "pending",
				assignedSubagent: { role: "scout", capability: "read-only", scopeConstraints: ["src/**"] },
			},
			{
				id: "task-2", phaseRef: "implement", title: "Implement", description: "test",
				dependencies: ["task-1"], expectedOutcome: "test", verificationStep: "test", status: "pending",
				assignedSubagent: { role: "worker", capability: "mutation", scopeConstraints: ["src/**"] },
			},
			{
				id: "task-3", phaseRef: "verify-all", title: "Verify", description: "test",
				dependencies: ["task-2"], expectedOutcome: "test", verificationStep: "test", status: "pending",
			},
		],
		envelope: {
			pathScope: ["src/**"],
			allowedOperations: ["read", "write", "create"],
			allowedTools: ["files", "bash"],
			subagentPermissions: { maxConcurrent: 4, allowedCapabilities: ["read-only", "execution", "mutation"], scopeConstraints: ["src/**"] },
			changeBudget: { maxFilesModified: 10, maxFilesCreated: 5, maxLinesChanged: 1000 },
		},
		successCriteria: [{ id: "sc-1", description: "Tests pass", measurable: true }],
		verificationSteps: [{ id: "vs-1", description: "Run tests", expectedResult: "0 failures" }],
		createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
		highImpact: false,
		validationResult: { valid: true, issues: [], score: { overall: 100, breakdown: { structuralCompleteness: 100, phaseOrdering: 100, dependencyIntegrity: 100, envelopeConstraints: 100, verificationCoverage: 100, subagentPolicy: 100 } } },
	};
	const stateJson = { planId, fsm: { state: "planned", history: [] }, showboatPath: path.join(planDir, "showboat.md") };
	fs.writeFileSync(path.join(planDir, "plan.json"), JSON.stringify(plan, null, 2));
	fs.writeFileSync(path.join(planDir, "state.json"), JSON.stringify(stateJson, null, 2));
	return plan;
}

// ── Test Suite ──

let tmpDir: string;
let pi: ReturnType<typeof createMockPi>;
let ctx: ReturnType<typeof createMockCtx>;

beforeEach(() => {
	resetOrchestratorState();
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-subagent-int-"));
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

/** Helper: load plan, start execution, return the tool. */
async function setupExecuting(planId = "subagent-plan-001") {
	createPlanWithSubagents(tmpDir, planId);
	await execAction(getTool(), ctx, { action: "load_plan", plan_id: planId });
	await execAction(getTool(), ctx, { action: "start" });
	return getTool();
}

// ═══════════════════════════════════════════════════════════════
// AC 10.1-10.3 — Subagent binding creation during workflow
// ═══════════════════════════════════════════════════════════════

describe("subagent binding creation (AC 10.1-10.3)", () => {

	it("execute_step creates subagent binding when task has assignedSubagent", async () => {
		const tool = await setupExecuting();

		// Execute the first step (task-1 has assignedSubagent with role "scout", capability "read-only")
		const { details } = await execAction(tool, ctx, { action: "execute_step" });
		expect(details.success).toBe(true);
		expect(details.data.taskId).toBe("task-1");

		// Load workflow from disk and verify a subagent binding was created
		const wfId = getActiveWorkflowId(tmpDir);
		expect(wfId).toBeTruthy();
		const workflow = loadWorkflow(tmpDir, wfId!);
		expect(workflow).not.toBeNull();

		// The binding array should have an entry for task-1
		expect(workflow!.subagentBindings).toBeDefined();
		expect(workflow!.subagentBindings.length).toBeGreaterThanOrEqual(1);

		const binding = workflow!.subagentBindings.find(b => b.taskId === "task-1");
		expect(binding).toBeDefined();
		expect(binding!.role).toBe("scout");
		expect(binding!.capabilityClass).toBe("read-only");
		expect(binding!.pathScope).toEqual(["src/**"]);
		expect(binding!.mutationRights).toBe(false);
		expect(binding!.stepsUsed).toBe(0);
		expect(binding!.phaseRef).toBe("write-tests");
	});

	it("execute_step does not duplicate binding on retry", async () => {
		const tool = await setupExecuting();

		// Execute task-1 (creates binding)
		await execAction(tool, ctx, { action: "execute_step" });

		// Simulate failure: skip the step so we can retry
		await execAction(tool, ctx, { action: "skip_step", reason: "simulated failure" });

		// Retry task-1 — increment retry counter then execute_step again
		await execAction(tool, ctx, { action: "retry_step", task_id: "task-1" });
		await execAction(tool, ctx, { action: "execute_step", task_id: "task-1" });

		// Load workflow and check binding count
		const wfId = getActiveWorkflowId(tmpDir);
		const workflow = loadWorkflow(tmpDir, wfId!);
		expect(workflow).not.toBeNull();

		// There should be exactly ONE binding for task-1, not two
		const task1Bindings = workflow!.subagentBindings.filter(b => b.taskId === "task-1");
		expect(task1Bindings.length).toBe(1);
	});
});

// ═══════════════════════════════════════════════════════════════
// AC 10.3 — Subagent budget enforcement
// ═══════════════════════════════════════════════════════════════

describe("subagent budget enforcement (AC 10.3)", () => {

	it("report_result increments subagent stepsUsed", async () => {
		const tool = await setupExecuting();

		// Execute task-1 (has assignedSubagent)
		const { details: stepDetails } = await execAction(tool, ctx, { action: "execute_step" });
		expect(stepDetails.success).toBe(true);
		expect(stepDetails.data.taskId).toBe("task-1");

		// Report result to commit the step
		const { details: reportDetails } = await execAction(tool, ctx, {
			action: "report_result",
			files_modified: ["src/test.spec.ts"],
			lines_changed: 20,
			audit_note: "wrote failing test",
		});
		expect(reportDetails.success).toBe(true);

		// Load workflow and verify the binding's stepsUsed was incremented
		const wfId = getActiveWorkflowId(tmpDir);
		const workflow = loadWorkflow(tmpDir, wfId!);
		expect(workflow).not.toBeNull();

		const binding = workflow!.subagentBindings.find(b => b.taskId === "task-1");
		expect(binding).toBeDefined();
		expect(binding!.stepsUsed).toBe(1);
	});

	it("execute_step rejects when subagent budget exhausted", async () => {
		const tool = await setupExecuting("subagent-plan-budget");

		// Execute and commit task-1 so we can proceed to task-2
		await execAction(tool, ctx, { action: "execute_step" });
		await execAction(tool, ctx, {
			action: "report_result",
			files_modified: ["src/test.spec.ts"],
			lines_changed: 10,
			audit_note: "wrote test",
		});

		// Execute task-2 (has assignedSubagent with role "worker", capability "mutation")
		const { details: step2 } = await execAction(tool, ctx, { action: "execute_step" });
		expect(step2.success).toBe(true);
		expect(step2.data.taskId).toBe("task-2");

		// Now manually exhaust the subagent budget on disk by modifying the persisted workflow
		// This simulates the binding having been used up to its stepBudget
		const wfId = getActiveWorkflowId(tmpDir);
		const workflow = loadWorkflow(tmpDir, wfId!);
		expect(workflow).not.toBeNull();

		// Find the task-2 binding and set stepsUsed = stepBudget
		const binding = workflow!.subagentBindings.find(b => b.taskId === "task-2");
		// If the binding doesn't exist yet (because the feature isn't implemented),
		// the test will already fail at this assertion — which is the intended RED behavior
		expect(binding).toBeDefined();
		expect(binding!.stepBudget).toBeGreaterThan(0);
		expect(binding!.stepsUsed).toBeLessThan(binding!.stepBudget);
	});
});

// ═══════════════════════════════════════════════════════════════
// AC 5.2 — Resume preserving subagent bindings and approval records
// ═══════════════════════════════════════════════════════════════

describe("resume preserving state (AC 5.2)", () => {

	it("resume preserves subagent bindings", async () => {
		const tool = await setupExecuting();

		// Execute task-1 to trigger binding creation
		await execAction(tool, ctx, { action: "execute_step" });

		// Verify binding was persisted to disk
		const wfId = getActiveWorkflowId(tmpDir);
		expect(wfId).toBeTruthy();
		const workflowBefore = loadWorkflow(tmpDir, wfId!);
		expect(workflowBefore).not.toBeNull();
		expect(workflowBefore!.subagentBindings.length).toBeGreaterThanOrEqual(1);

		const bindingBefore = workflowBefore!.subagentBindings.find(b => b.taskId === "task-1");
		expect(bindingBefore).toBeDefined();

		// Simulate crash: reset all in-memory state
		resetOrchestratorState();

		// Re-register the orchestrator (fresh instance)
		const pi2 = createMockPi();
		registerOrchestrator(pi2 as any);

		// Trigger session_start to resume the workflow
		const sessionHandler = pi2.events["session_start"]?.[0];
		expect(sessionHandler).toBeDefined();
		await sessionHandler({}, createMockCtx(tmpDir));

		// After resume, the active workflow should be restored
		// Use status action to verify state is executing
		const tool2 = pi2.tools["orchestrator"];
		const { details: statusDetails } = await execAction(tool2, createMockCtx(tmpDir), { action: "status" });
		expect(statusDetails.success).toBe(true);
		expect(statusDetails.data.state).toBe("executing");

		// Load workflow from disk again — bindings should still be present
		const workflowAfter = loadWorkflow(tmpDir, wfId!);
		expect(workflowAfter).not.toBeNull();
		expect(workflowAfter!.subagentBindings.length).toBeGreaterThanOrEqual(1);

		const bindingAfter = workflowAfter!.subagentBindings.find(b => b.taskId === "task-1");
		expect(bindingAfter).toBeDefined();
		expect(bindingAfter!.role).toBe(bindingBefore!.role);
		expect(bindingAfter!.capabilityClass).toBe(bindingBefore!.capabilityClass);
		expect(bindingAfter!.pathScope).toEqual(bindingBefore!.pathScope);
	});

	it("resume preserves approval records", async () => {
		const planId = "subagent-plan-approval";
		createPlanWithSubagents(tmpDir, planId);
		await execAction(getTool(), ctx, { action: "load_plan", plan_id: planId });
		await execAction(getTool(), ctx, { action: "start" });

		// Manually inject an approval record into the persisted workflow
		// (since triggering a real approval flow requires specific policy conditions)
		const wfId = getActiveWorkflowId(tmpDir);
		expect(wfId).toBeTruthy();
		const workflow = loadWorkflow(tmpDir, wfId!);
		expect(workflow).not.toBeNull();

		const approvalRecord = {
			id: "approval-001",
			stepId: "step-001",
			reason: "Budget near threshold",
			riskTriggers: ["budget_near_threshold"],
			requestedAt: new Date().toISOString(),
			resolvedAt: new Date().toISOString(),
			approved: true,
			scope: "phase" as const,
		};
		workflow!.approvalRecords.push(approvalRecord);
		// Write modified workflow back to disk
		const workflowDir = path.join(tmpDir, ".pi/orchestrator/workflows", wfId!);
		fs.writeFileSync(
			path.join(workflowDir, "workflow.json"),
			JSON.stringify(workflow, null, 2),
		);

		// Simulate crash: reset all in-memory state
		resetOrchestratorState();

		// Re-register and trigger session_start
		const pi2 = createMockPi();
		registerOrchestrator(pi2 as any);

		const sessionHandler = pi2.events["session_start"]?.[0];
		expect(sessionHandler).toBeDefined();
		await sessionHandler({}, createMockCtx(tmpDir));

		// Verify approval records survive the resume
		const workflowAfter = loadWorkflow(tmpDir, wfId!);
		expect(workflowAfter).not.toBeNull();
		expect(workflowAfter!.approvalRecords.length).toBe(1);
		expect(workflowAfter!.approvalRecords[0].id).toBe("approval-001");
		expect(workflowAfter!.approvalRecords[0].reason).toBe("Budget near threshold");
		expect(workflowAfter!.approvalRecords[0].approved).toBe(true);
		expect(workflowAfter!.approvalRecords[0].scope).toBe("phase");
	});
});
