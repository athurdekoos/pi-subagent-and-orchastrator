/**
 * CI Verification — Orchestrator workflow validation for CI pipelines.
 *
 * These functions use only Node.js builtins and orchestrator types,
 * with no dependency on the ExtensionAPI.
 */

import * as fs from "node:fs";
import type { WorkflowState, LedgerEntry } from "./types.js";
import { TERMINAL_STATES } from "./fsm.js";

/** Result of a CI workflow verification. */
export interface WorkflowVerificationResult {
	valid: boolean;
	issues: string[];
	summary: {
		workflowId: string;
		planId: string;
		fsmState: string;
		isTerminal: boolean;
		totalSteps: number;
		committedSteps: number;
		failedSteps: number;
		hasShowboat: boolean;
		hasApprovalRecords: boolean;
		budgetExceeded: boolean;
	};
}

/**
 * Validate a workflow from a JSON string.
 */
export function validateWorkflowFromString(json: string): WorkflowVerificationResult {
	const wf = JSON.parse(json) as WorkflowState;
	return validateWorkflow(wf);
}

/**
 * Validate a workflow from a workflow.json file on disk.
 */
export function validateWorkflowFromDisk(workflowJsonPath: string): WorkflowVerificationResult {
	const raw = fs.readFileSync(workflowJsonPath, "utf-8");
	return validateWorkflowFromString(raw);
}

/**
 * Validate a workflow state object against orchestrator invariants.
 */
export function validateWorkflow(wf: WorkflowState): WorkflowVerificationResult {
	const issues: string[] = [];

	// Required fields
	if (!wf.workflowId) issues.push("Missing workflowId");
	if (!wf.planId) issues.push("Missing planId");
	if (!wf.fsm?.state) issues.push("Missing FSM state");
	if (!wf.showboatPath) issues.push("Missing showboatPath");

	// FSM state validity
	const isTerminal = (TERMINAL_STATES as readonly string[]).includes(wf.fsm?.state);

	// Ledger integrity
	const committed = wf.ledger.filter(e => e.status === "committed");
	const failed = wf.ledger.filter(e => e.status === "failed");
	const inProgress = wf.ledger.filter(e => e.status === "in_progress");

	if (isTerminal && inProgress.length > 0) {
		issues.push(`Terminal state "${wf.fsm.state}" has ${inProgress.length} in-progress steps`);
	}

	// Duplicate committed step check
	const committedTaskIds = committed.map(e => e.taskId);
	const uniqueCommitted = new Set(committedTaskIds);
	if (committedTaskIds.length !== uniqueCommitted.size) {
		issues.push("Duplicate committed steps detected");
	}

	// Showboat existence
	const hasShowboat = wf.showboatPath ? fs.existsSync(wf.showboatPath) : false;
	if (!hasShowboat && isTerminal) {
		issues.push("Terminal workflow missing showboat artifact");
	}

	// Budget check
	const budget = wf.budgetSnapshot?.budget;
	let budgetExceeded = false;
	if (budget) {
		const modCount = wf.budgetSnapshot.filesModified?.length ?? 0;
		const createCount = wf.budgetSnapshot.filesCreated?.length ?? 0;
		const lines = wf.budgetSnapshot.totalLinesChanged ?? 0;
		if (modCount > budget.maxFilesModified) budgetExceeded = true;
		if (createCount > budget.maxFilesCreated) budgetExceeded = true;
		if (lines > budget.maxLinesChanged) budgetExceeded = true;
	}

	return {
		valid: issues.length === 0,
		issues,
		summary: {
			workflowId: wf.workflowId ?? "",
			planId: wf.planId ?? "",
			fsmState: wf.fsm?.state ?? "unknown",
			isTerminal,
			totalSteps: wf.ledger.length,
			committedSteps: committed.length,
			failedSteps: failed.length,
			hasShowboat,
			hasApprovalRecords: (wf.approvalRecords?.length ?? 0) > 0,
			budgetExceeded,
		},
	};
}

/**
 * Validate a showboat document exists and has expected content.
 */
export function validateShowboat(showboatPath: string): { valid: boolean; issues: string[] } {
	const issues: string[] = [];

	if (!fs.existsSync(showboatPath)) {
		return { valid: false, issues: ["Showboat file does not exist"] };
	}

	const content = fs.readFileSync(showboatPath, "utf-8");

	if (!content.includes("## Metadata")) {
		issues.push("Missing Metadata section");
	}
	if (!content.includes("State Transition")) {
		issues.push("Missing State Transition entries");
	}
	if (!content.includes("## Outcome")) {
		issues.push("Missing Outcome section (workflow may not be terminal)");
	}

	return { valid: issues.length === 0, issues };
}
