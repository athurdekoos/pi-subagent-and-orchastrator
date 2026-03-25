import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	initOrchestratorStructure,
	saveWorkflow,
	loadWorkflow,
	getActiveWorkflowId,
	setActiveWorkflowId,
	listWorkflows,
	resolveOrchestratorRoot,
	getWorkflowDir,
	generateWorkflowId,
} from "../persistence.js";
import type { WorkflowState, BudgetSnapshot } from "../types.js";

function makeWorkflowState(overrides: Partial<WorkflowState> = {}): WorkflowState {
	return {
		workflowId: "20260322-1200-exec-my-plan",
		planId: "plan-001",
		fsm: { state: "idle", history: [] },
		pendingStep: null,
		ledger: [],
		retryCounters: {},
		approvalRecords: [],
		subagentBindings: [],
		budgetSnapshot: {
			filesModified: [],
			filesCreated: [],
			totalLinesChanged: 0,
			budget: { maxFilesModified: 500, maxFilesCreated: 200, maxLinesChanged: 50000 },
		},
		showboatPath: "/tmp/showboat.md",
		createdAt: "2026-03-22T12:00:00.000Z",
		updatedAt: "2026-03-22T12:00:00.000Z",
		...overrides,
	};
}

describe("orchestrator persistence", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestrator-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("initOrchestratorStructure creates workflows directory", () => {
		expect(initOrchestratorStructure(tmpDir)).toBe(true);
		// Idempotent
		expect(initOrchestratorStructure(tmpDir)).toBe(true);
		const root = resolveOrchestratorRoot(tmpDir);
		expect(fs.existsSync(path.join(root, "workflows"))).toBe(true);
	});

	it("saveWorkflow writes workflow.json to correct path", () => {
		initOrchestratorStructure(tmpDir);
		const state = makeWorkflowState();
		expect(saveWorkflow(tmpDir, state)).toBe(true);
		const filePath = path.join(getWorkflowDir(tmpDir, state.workflowId)!, "workflow.json");
		expect(fs.existsSync(filePath)).toBe(true);
	});

	it("loadWorkflow reads and parses workflow.json", () => {
		initOrchestratorStructure(tmpDir);
		const state = makeWorkflowState();
		saveWorkflow(tmpDir, state);
		const loaded = loadWorkflow(tmpDir, state.workflowId);
		expect(loaded).not.toBeNull();
		expect(loaded!.workflowId).toBe(state.workflowId);
		expect(loaded!.planId).toBe("plan-001");
		expect(loaded!.fsm.state).toBe("idle");
	});

	it("loadWorkflow returns null for missing workflow", () => {
		initOrchestratorStructure(tmpDir);
		expect(loadWorkflow(tmpDir, "nonexistent-workflow")).toBeNull();
	});

	it("rejects workflow IDs with path traversal sequences", () => {
		expect(getWorkflowDir(tmpDir, "../../../etc")).toBeNull();
		expect(getWorkflowDir(tmpDir, "foo/bar")).toBeNull();
		expect(getWorkflowDir(tmpDir, "foo\\bar")).toBeNull();
		expect(getWorkflowDir(tmpDir, "")).toBeNull();
		expect(getWorkflowDir(tmpDir, "valid-workflow-id")).not.toBeNull();
	});

	it("loadWorkflow returns null for traversal IDs", () => {
		initOrchestratorStructure(tmpDir);
		expect(loadWorkflow(tmpDir, "../../../etc")).toBeNull();
	});

	it("loadWorkflow returns null for corrupt JSON", () => {
		initOrchestratorStructure(tmpDir);
		const wfDir = getWorkflowDir(tmpDir, "corrupt-wf")!;
		fs.mkdirSync(wfDir, { recursive: true });
		fs.writeFileSync(path.join(wfDir, "workflow.json"), "not valid json{{{");
		expect(loadWorkflow(tmpDir, "corrupt-wf")).toBeNull();
	});

	it("getActiveWorkflowId returns null when no active workflow", () => {
		initOrchestratorStructure(tmpDir);
		expect(getActiveWorkflowId(tmpDir)).toBeNull();
	});

	it("setActiveWorkflowId persists and getActiveWorkflowId reads it back", () => {
		initOrchestratorStructure(tmpDir);
		expect(setActiveWorkflowId(tmpDir, "wf-abc")).toBe(true);
		expect(getActiveWorkflowId(tmpDir)).toBe("wf-abc");
	});

	it("setActiveWorkflowId(null) clears active workflow", () => {
		initOrchestratorStructure(tmpDir);
		setActiveWorkflowId(tmpDir, "wf-abc");
		expect(getActiveWorkflowId(tmpDir)).toBe("wf-abc");
		setActiveWorkflowId(tmpDir, null);
		expect(getActiveWorkflowId(tmpDir)).toBeNull();
	});

	it("listWorkflows returns empty array for empty directory", () => {
		initOrchestratorStructure(tmpDir);
		expect(listWorkflows(tmpDir)).toEqual([]);
	});

	it("listWorkflows returns sorted list of workflows (newest first by createdAt)", () => {
		initOrchestratorStructure(tmpDir);
		const older = makeWorkflowState({
			workflowId: "wf-older",
			planId: "plan-a",
			createdAt: "2026-03-20T10:00:00.000Z",
		});
		const newer = makeWorkflowState({
			workflowId: "wf-newer",
			planId: "plan-b",
			createdAt: "2026-03-22T10:00:00.000Z",
		});
		saveWorkflow(tmpDir, older);
		saveWorkflow(tmpDir, newer);
		const list = listWorkflows(tmpDir);
		expect(list).toHaveLength(2);
		expect(list[0].id).toBe("wf-newer");
		expect(list[1].id).toBe("wf-older");
		expect(list[0].planId).toBe("plan-b");
		expect(list[0].state).toBe("idle");
		expect(list[0].createdAt).toBe("2026-03-22T10:00:00.000Z");
	});

	it("saveWorkflow then loadWorkflow roundtrips WorkflowState correctly", () => {
		initOrchestratorStructure(tmpDir);
		const state = makeWorkflowState({
			workflowId: "roundtrip-wf",
			planId: "plan-rt",
			fsm: {
				state: "executing",
				history: [{ from: "idle", to: "executing", at: "2026-03-22T12:01:00.000Z", action: "start" }],
			},
			pendingStep: "step-1",
			ledger: [{
				stepId: "step-1",
				taskId: "task-1",
				phaseRef: "phase-1",
				phaseType: "red",
				status: "in_progress",
				action: "write test",
				filesModified: ["src/foo.ts"],
				filesCreated: ["src/foo.test.ts"],
				linesChanged: 42,
				startedAt: "2026-03-22T12:01:00.000Z",
				committedAt: null,
				retryCount: 0,
				error: null,
				auditNote: "Writing test for foo",
			}],
			retryCounters: { "step-1": 1 },
			approvalRecords: [{
				id: "apr-1",
				stepId: "step-1",
				reason: "bulk edit",
				riskTriggers: ["isBulkEdit"],
				requestedAt: "2026-03-22T12:02:00.000Z",
				resolvedAt: null,
				approved: null,
				scope: "action",
			}],
			subagentBindings: [{
				taskId: "task-1",
				role: "test-writer",
				capabilityClass: "mutation-capable",
				pathScope: ["src/**"],
				allowedTools: ["write", "read"],
				mutationRights: true,
				stepBudget: 10,
				stepsUsed: 2,
				phaseRef: "phase-1",
			}],
			budgetSnapshot: {
				filesModified: ["src/foo.ts"],
				filesCreated: ["src/foo.test.ts"],
				totalLinesChanged: 42,
				budget: { maxFilesModified: 500, maxFilesCreated: 200, maxLinesChanged: 50000 },
			},
			showboatPath: "/project/.pi/orchestrator/workflows/roundtrip-wf/showboat.md",
			createdAt: "2026-03-22T12:00:00.000Z",
			updatedAt: "2026-03-22T12:05:00.000Z",
		});
		saveWorkflow(tmpDir, state);
		const loaded = loadWorkflow(tmpDir, "roundtrip-wf");
		expect(loaded).toEqual(state);
	});

	it("BudgetSnapshot filesModified serializes as string[] (not Set) in JSON", () => {
		initOrchestratorStructure(tmpDir);
		const state = makeWorkflowState({
			workflowId: "budget-serial-wf",
			budgetSnapshot: {
				filesModified: ["a.ts", "b.ts", "c.ts"],
				filesCreated: ["d.ts"],
				totalLinesChanged: 100,
				budget: { maxFilesModified: 500, maxFilesCreated: 200, maxLinesChanged: 50000 },
			},
		});
		saveWorkflow(tmpDir, state);
		// Read raw JSON and verify filesModified is an array, not an object
		const rawJson = fs.readFileSync(
			path.join(getWorkflowDir(tmpDir, "budget-serial-wf")!, "workflow.json"),
			"utf-8",
		);
		const parsed = JSON.parse(rawJson);
		expect(Array.isArray(parsed.budgetSnapshot.filesModified)).toBe(true);
		expect(parsed.budgetSnapshot.filesModified).toEqual(["a.ts", "b.ts", "c.ts"]);
	});
});
