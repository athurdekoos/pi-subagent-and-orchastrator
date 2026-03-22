/**
 * Orchestrator-specific Showboat integration.
 *
 * Wraps the planner/showboat.ts primitives with orchestrator-aware formatting
 * for execution logging, state transitions, approvals, and budget tracking.
 */

import { showboatInit, showboatNote, showboatExec } from "../planner/showboat.js";
import type { LedgerEntry, ApprovalRecord } from "./types.js";

/**
 * Initialize a Showboat document for an orchestrator execution workflow.
 */
export function initOrchestratorShowboat(
	filePath: string,
	planId: string,
	workflowId: string,
): boolean {
	try {
		const ok = showboatInit(filePath, `Execution: ${planId}`);
		if (!ok) return false;
		const ts = new Date().toISOString();
		return showboatNote(
			filePath,
			`## Metadata\n\nWorkflow ID: ${workflowId}\nPlan ID: ${planId}\nStarted: ${ts}`,
		);
	} catch {
		return false;
	}
}

/**
 * Log a state transition in the orchestrator FSM.
 */
export function logTransition(
	filePath: string,
	from: string,
	to: string,
	action: string,
): boolean {
	try {
		const ts = new Date().toISOString();
		return showboatNote(
			filePath,
			`## State Transition\n\n${from} → ${to} (${action}) at ${ts}`,
		);
	} catch {
		return false;
	}
}

/**
 * Log the start of a step execution.
 */
export function logStepStart(
	filePath: string,
	taskId: string,
	title: string,
	phase: string,
): boolean {
	try {
		const ts = new Date().toISOString();
		return showboatNote(
			filePath,
			`## Step: ${title}\n\nTask: ${taskId}\nPhase: ${phase}\nStarted: ${ts}`,
		);
	} catch {
		return false;
	}
}

/**
 * Log a committed step with its ledger entry details.
 */
export function logStepCommit(filePath: string, entry: LedgerEntry): boolean {
	try {
		const lines = [
			`## Step Committed`,
			``,
			`Task: ${entry.taskId}`,
			`Phase: ${entry.phaseRef}`,
			`Files modified: ${entry.filesModified.length > 0 ? entry.filesModified.join(", ") : "none"}`,
			`Files created: ${entry.filesCreated.length > 0 ? entry.filesCreated.join(", ") : "none"}`,
			`Lines changed: ${entry.linesChanged}`,
			`Audit: ${entry.auditNote}`,
		];
		return showboatNote(filePath, lines.join("\n"));
	} catch {
		return false;
	}
}

/**
 * Log a step failure.
 */
export function logStepFailure(
	filePath: string,
	taskId: string,
	error: string,
): boolean {
	try {
		const ts = new Date().toISOString();
		return showboatNote(
			filePath,
			`## Step Failed\n\nTask: ${taskId}\nError: ${error}\nAt: ${ts}`,
		);
	} catch {
		return false;
	}
}

/**
 * Log an approval request.
 */
export function logApprovalRequest(
	filePath: string,
	record: ApprovalRecord,
): boolean {
	try {
		const lines = [
			`## Approval Requested`,
			``,
			`Step: ${record.stepId}`,
			`Reason: ${record.reason}`,
			`Risk triggers: ${record.riskTriggers.join(", ")}`,
			`Requested at: ${record.requestedAt}`,
		];
		return showboatNote(filePath, lines.join("\n"));
	} catch {
		return false;
	}
}

/**
 * Log the resolution of an approval request.
 */
export function logApprovalResolution(
	filePath: string,
	record: ApprovalRecord,
): boolean {
	try {
		const decision = record.approved === true ? "Approved" : "Denied";
		const lines = [
			`## Approval Resolved`,
			``,
			`Step: ${record.stepId}`,
			`Decision: ${decision}`,
			`Resolved at: ${record.resolvedAt ?? new Date().toISOString()}`,
		];
		return showboatNote(filePath, lines.join("\n"));
	} catch {
		return false;
	}
}

/**
 * Log a retry attempt for a step.
 */
export function logRetry(
	filePath: string,
	taskId: string,
	attempt: number,
): boolean {
	try {
		const ts = new Date().toISOString();
		return showboatNote(
			filePath,
			`## Retry\n\nTask: ${taskId}\nAttempt: ${attempt}\nAt: ${ts}`,
		);
	} catch {
		return false;
	}
}

/**
 * Log verification results as a summary table.
 */
export function logVerification(
	filePath: string,
	results: Array<{ step: string; passed: boolean; output: string }>,
): boolean {
	try {
		const rows = results.map(
			(r) => `| ${r.step} | ${r.passed ? "PASS" : "FAIL"} | ${r.output} |`,
		);
		const lines = [
			`## Verification Results`,
			``,
			`| Step | Result | Output |`,
			`| --- | --- | --- |`,
			...rows,
		];
		return showboatNote(filePath, lines.join("\n"));
	} catch {
		return false;
	}
}

/**
 * Log a tool execution as an executable Showboat block.
 */
export function logToolExecution(
	filePath: string,
	language: string,
	code: string,
	workdir?: string,
): { ok: boolean; output: string } {
	try {
		return showboatExec(filePath, language, code, workdir);
	} catch {
		return { ok: false, output: "" };
	}
}

/**
 * Log current budget usage status.
 */
export function logBudgetStatus(
	filePath: string,
	usage: {
		filesModified: { used: number; budget: number; fraction: number };
		filesCreated: { used: number; budget: number; fraction: number };
		linesChanged: { used: number; budget: number; fraction: number };
	},
): boolean {
	try {
		const fmt = (u: { used: number; budget: number; fraction: number }): string =>
			`${u.used}/${u.budget} (${(u.fraction * 100).toFixed(0)}%)`;
		const lines = [
			`## Budget Status`,
			``,
			`Files modified: ${fmt(usage.filesModified)}`,
			`Files created: ${fmt(usage.filesCreated)}`,
			`Lines changed: ${fmt(usage.linesChanged)}`,
		];
		return showboatNote(filePath, lines.join("\n"));
	} catch {
		return false;
	}
}

/**
 * Log the terminal outcome of the orchestrator workflow.
 */
export function logTerminalOutcome(
	filePath: string,
	state: string,
	summary: string,
): boolean {
	try {
		const ts = new Date().toISOString();
		return showboatNote(
			filePath,
			`## Outcome: ${state}\n\n${summary}\nAt: ${ts}`,
		);
	} catch {
		return false;
	}
}
