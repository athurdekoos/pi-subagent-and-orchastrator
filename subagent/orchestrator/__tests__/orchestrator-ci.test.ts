/**
 * CI Verification Tests — Orchestrator
 *
 * Tests the CI validation entry points for orchestrator workflows.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
	validateWorkflow,
	validateWorkflowFromString,
	validateWorkflowFromDisk,
	validateShowboat,
} from "../ci.js";
import type { WorkflowState } from "../types.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-ci-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function buildValidWorkflow(): WorkflowState {
	return {
		workflowId: "wf-001",
		planId: "plan-001",
		fsm: { state: "completed", history: [] },
		pendingStep: null,
		ledger: [
			{
				stepId: "step-task-1-0", taskId: "task-1", phaseRef: "red", phaseType: "red",
				status: "committed", action: "write test", filesModified: ["src/test.ts"],
				filesCreated: [], linesChanged: 10, startedAt: "2026-01-01T00:00:00Z",
				committedAt: "2026-01-01T00:01:00Z", retryCount: 0, error: null, auditNote: "done",
			},
		],
		retryCounters: {},
		approvalRecords: [],
		subagentBindings: [],
		budgetSnapshot: {
			filesModified: ["src/test.ts"],
			filesCreated: [],
			totalLinesChanged: 10,
			budget: { maxFilesModified: 10, maxFilesCreated: 5, maxLinesChanged: 1000 },
		},
		showboatPath: path.join(tmpDir, "showboat.md"),
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:01:00Z",
	};
}

describe("validateWorkflow", () => {
	it("accepts a valid completed workflow", () => {
		const wf = buildValidWorkflow();
		// Create showboat file
		fs.writeFileSync(wf.showboatPath, "## Metadata\n## State Transition\n## Outcome: completed\n");
		const result = validateWorkflow(wf);
		expect(result.valid).toBe(true);
		expect(result.summary.isTerminal).toBe(true);
		expect(result.summary.committedSteps).toBe(1);
	});

	it("flags missing showboat for terminal workflow", () => {
		const wf = buildValidWorkflow();
		// Don't create showboat file
		const result = validateWorkflow(wf);
		expect(result.valid).toBe(false);
		expect(result.issues.some(i => /showboat/i.test(i))).toBe(true);
	});

	it("flags duplicate committed steps", () => {
		const wf = buildValidWorkflow();
		fs.writeFileSync(wf.showboatPath, "## Metadata\n## State Transition\n## Outcome: completed\n");
		// Add duplicate committed entry
		wf.ledger.push({ ...wf.ledger[0] });
		const result = validateWorkflow(wf);
		expect(result.issues.some(i => /duplicate/i.test(i))).toBe(true);
	});

	it("flags in-progress steps in terminal state", () => {
		const wf = buildValidWorkflow();
		fs.writeFileSync(wf.showboatPath, "## Metadata\n## State Transition\n## Outcome: completed\n");
		wf.ledger.push({
			stepId: "step-task-2-0", taskId: "task-2", phaseRef: "green", phaseType: "green",
			status: "in_progress", action: "implement", filesModified: [], filesCreated: [],
			linesChanged: 0, startedAt: "2026-01-01T00:00:00Z", committedAt: null, retryCount: 0,
			error: null, auditNote: "",
		});
		const result = validateWorkflow(wf);
		expect(result.issues.some(i => /in-progress/i.test(i))).toBe(true);
	});
});

describe("validateWorkflowFromString", () => {
	it("parses and validates JSON string", () => {
		const wf = buildValidWorkflow();
		fs.writeFileSync(wf.showboatPath, "## Metadata\n## State Transition\n## Outcome: completed\n");
		const result = validateWorkflowFromString(JSON.stringify(wf));
		expect(result.valid).toBe(true);
	});
});

describe("validateWorkflowFromDisk", () => {
	it("loads and validates from file", () => {
		const wf = buildValidWorkflow();
		fs.writeFileSync(wf.showboatPath, "## Metadata\n## State Transition\n## Outcome: completed\n");
		const wfPath = path.join(tmpDir, "workflow.json");
		fs.writeFileSync(wfPath, JSON.stringify(wf));
		const result = validateWorkflowFromDisk(wfPath);
		expect(result.valid).toBe(true);
	});
});

describe("validateShowboat", () => {
	it("accepts valid showboat with all sections", () => {
		const sbPath = path.join(tmpDir, "showboat.md");
		fs.writeFileSync(sbPath, "## Metadata\n\n## State Transition\nidle → executing\n\n## Outcome: completed\n");
		const result = validateShowboat(sbPath);
		expect(result.valid).toBe(true);
	});

	it("flags missing file", () => {
		const result = validateShowboat(path.join(tmpDir, "missing.md"));
		expect(result.valid).toBe(false);
		expect(result.issues[0]).toMatch(/not exist/i);
	});

	it("flags missing sections", () => {
		const sbPath = path.join(tmpDir, "incomplete.md");
		fs.writeFileSync(sbPath, "# Some title\n");
		const result = validateShowboat(sbPath);
		expect(result.valid).toBe(false);
		expect(result.issues.length).toBeGreaterThan(0);
	});
});
