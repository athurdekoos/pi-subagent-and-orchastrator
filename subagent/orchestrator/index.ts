/**
 * Execution Orchestrator — Entry Point
 *
 * Registers the "orchestrator" tool (LLM-callable), "/exec" command (user-facing),
 * and session_start hook for resuming in-progress workflows.
 */

import * as path from "node:path";
import { execSync } from "node:child_process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateHead } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

import type { OrchestratorAction, OrchestratorToolDetails, WorkflowState, Plan, ApprovalRecord } from "./types.js";
import { ORCHESTRATOR_ACTIONS, ORCHESTRATOR_CONFIG_DEFAULTS, HIGH_IMPACT_PATTERNS } from "./types.js";
import { OrchestratorFSM, TERMINAL_STATES, RESUMABLE_STATES } from "./fsm.js";
import { StepLedger } from "./ledger.js";
import { BudgetTracker } from "./budget.js";
import { evaluatePolicy, defaultPolicyContext } from "./policy.js";
import { enforceEnvelope } from "./envelope.js";
import { bindSubagent, validateSubagentAction, isSubagentBudgetExhausted } from "./subagent-gov.js";
import {
	initOrchestratorStructure, saveWorkflow, loadWorkflow,
	getActiveWorkflowId, setActiveWorkflowId, getWorkflowDir, generateWorkflowId,
	listWorkflows,
} from "./persistence.js";
import {
	initOrchestratorShowboat, logTransition, logStepStart, logStepCommit,
	logStepFailure, logApprovalRequest, logApprovalResolution, logRetry,
	logVerification, logToolExecution, logBudgetStatus, logTerminalOutcome,
} from "./showboat.js";
import { setStreamCallback, clearStreamCallback } from "../planner/showboat.js";
import { loadPlan as loadPlannerPlan } from "../planner/persistence.js";
import { getExecutionOrder } from "../planner/graph.js";
import { readFileSafe } from "../file-manager/paths.js";

// ── In-memory state ──

let activeFsm: OrchestratorFSM | null = null;
let activeWorkflow: WorkflowState | null = null;
let activeLedger: StepLedger | null = null;
let activeBudget: BudgetTracker | null = null;
let loadedPlan: Plan | null = null;
let pendingApprovalTriggers: string[] = [];
let pendingApprovalScope: "phase" | "action" = "phase";

// ── Helpers ──

/**
 * Check if a file path matches any HIGH_IMPACT_PATTERNS.
 */
function isHighImpact(filePath: string): boolean {
	const basename = path.basename(filePath);
	for (const pattern of HIGH_IMPACT_PATTERNS) {
		if (pattern.includes("**")) {
			// Directory glob like ".github/**" — check prefix
			const prefix = pattern.replace(/\/?\*\*.*$/, "");
			if (prefix && (filePath.startsWith(prefix + "/") || filePath === prefix)) return true;
		} else if (pattern.includes("*")) {
			// Wildcard like "tsconfig.*.json" or ".eslintrc*"
			const prefix = pattern.replace(/\*.*$/, "");
			if (prefix && (basename.startsWith(prefix) || filePath.startsWith(prefix))) return true;
		} else {
			// Exact match like "package.json", "Dockerfile"
			if (filePath === pattern || filePath.endsWith("/" + pattern) || basename === pattern) return true;
		}
	}
	return false;
}

function makeResult(action: OrchestratorAction, success: boolean, message: string, data?: unknown): OrchestratorToolDetails {
	return { action, success, message, data };
}

function persistWorkflow(cwd: string): boolean {
	if (!activeWorkflow || !activeFsm || !activeLedger || !activeBudget) return false;
	const serialized = activeLedger.serialize();
	activeWorkflow.fsm = activeFsm.serialize();
	activeWorkflow.ledger = serialized.entries;
	activeWorkflow.retryCounters = serialized.retryCounters;
	activeWorkflow.budgetSnapshot = activeBudget.serialize();
	activeWorkflow.pendingStep = activeLedger.getPending()?.taskId ?? null;
	activeWorkflow.updatedAt = new Date().toISOString();
	return saveWorkflow(cwd, activeWorkflow);
}

function clearSession(): void {
	clearStreamCallback();
	activeFsm = null;
	activeWorkflow = null;
	activeLedger = null;
	activeBudget = null;
	loadedPlan = null;
	pendingApprovalTriggers = [];
	pendingApprovalScope = "phase";
}

/** Reset all in-memory state. Exported for testing. */
export function resetOrchestratorState(): void {
	clearSession();
}

export function registerOrchestrator(pi: ExtensionAPI) {
	// ── Tool Registration ──

	pi.registerTool({
		name: "orchestrator",
		label: "Orchestrator",
		description: "Execution orchestrator: load approved plans, execute tasks in dependency order with TDD phases, track budget, verify results. Manages the full execution lifecycle.",
		promptSnippet: "Execute approved plans with FSM, step ledger, budget tracking, and Showboat audit",
		promptGuidelines: [
			"Follow this action sequence: load_plan → start → execute_step (repeat) → report_result (repeat) → verify",
			"Use 'load_plan' with plan_id to load an approved plan for execution",
			"Use 'start' to begin execution — this creates the step ledger and budget tracker",
			"Use 'execute_step' to get the next task to work on (respects dependency order)",
			"Use 'report_result' after completing a step — include files_modified, lines_changed, audit_note",
			"Use 'verify' when all tasks are committed — this runs verification steps and completes the workflow",
			"Use 'abort' to cancel the workflow at any time",
			"Use 'status' to check current state, budget usage, and progress",
		],
		parameters: Type.Object({
			action: StringEnum([...ORCHESTRATOR_ACTIONS]),
			plan_id: Type.Optional(Type.String({ description: "Plan ID for load_plan" })),
			task_id: Type.Optional(Type.String({ description: "Specific task ID for execute_step" })),
			files_modified: Type.Optional(Type.Array(Type.String(), { description: "Files modified during step" })),
			files_created: Type.Optional(Type.Array(Type.String(), { description: "Files created during step" })),
			lines_changed: Type.Optional(Type.Number({ description: "Lines changed during step" })),
			audit_note: Type.Optional(Type.String({ description: "Audit note for report_result" })),
			reason: Type.Optional(Type.String({ description: "Reason for abort or skip" })),
		}),

		async execute(_toolCallId, params, _signal, onUpdate, ctx) {
			const cwd = ctx.cwd;
			const action = params.action as OrchestratorAction;

			// ── status (always allowed) ──
			if (action === "status") {
				const state = activeFsm?.getState() ?? "idle";
				const data: Record<string, unknown> = { state };
				if (activeWorkflow) {
					data.workflowId = activeWorkflow.workflowId;
					data.planId = activeWorkflow.planId;
				}
				if (activeBudget) {
					data.budget = activeBudget.getUsage();
				}
				if (activeLedger) {
					data.pendingStep = activeLedger.getPending()?.taskId ?? null;
					data.committedCount = activeLedger.getCommitted().length;
				}
				if (loadedPlan) {
					data.totalTasks = loadedPlan.tasks.length;
				}
				const msg = activeWorkflow
					? `State: ${state} | Workflow: ${activeWorkflow.workflowId} | Plan: ${activeWorkflow.planId}`
					: `State: ${state} | No active workflow`;
				return {
					content: [{ type: "text" as const, text: msg }],
					details: makeResult(action, true, msg, data),
				};
			}

			// ── load_plan ──
			if (action === "load_plan") {
				const planId = params.plan_id as string | undefined;
				if (!planId) {
					const r = makeResult(action, false, "Missing required parameter: plan_id");
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				// Check FSM is idle (or create new)
				if (activeFsm && activeFsm.getState() !== "idle") {
					const r = makeResult(action, false, `Cannot load_plan: orchestrator is in "${activeFsm.getState()}" state, not "idle"`);
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				// Load plan from planner persistence
				const plannerSession = loadPlannerPlan(cwd, planId);
				if (!plannerSession) {
					const r = makeResult(action, false, `Plan "${planId}" not found`);
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				// Check plan's FSM state is "planned" (approved)
				if (plannerSession.fsm.state !== "planned") {
					const r = makeResult(action, false, `Plan "${planId}" is in "${plannerSession.fsm.state}" state, not "planned" (approved)`);
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				// Create FSM and transition to loading_plan
				activeFsm = new OrchestratorFSM("idle");
				const t1 = activeFsm.transition("loading_plan", "load_plan");
				if (!t1.ok) {
					const r = makeResult(action, false, (t1 as any).reason);
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				loadedPlan = plannerSession.plan;

				// Generate workflow ID and init structure
				const workflowId = generateWorkflowId(planId);
				initOrchestratorStructure(cwd);
				const workflowDir = getWorkflowDir(cwd, workflowId);
				const showboatPath = path.join(workflowDir, "showboat.md");

				// Create WorkflowState
				const now = new Date().toISOString();
				activeWorkflow = {
					workflowId,
					planId,
					fsm: activeFsm.serialize(),
					pendingStep: null,
					ledger: [],
					retryCounters: {},
					approvalRecords: [],
					subagentBindings: [],
					budgetSnapshot: {
						filesModified: [],
						filesCreated: [],
						totalLinesChanged: 0,
						budget: loadedPlan.envelope.changeBudget,
					},
					showboatPath,
					createdAt: now,
					updatedAt: now,
				};

				// Init empty ledger and budget for now (fully created on start)
				activeLedger = new StepLedger();
				activeBudget = new BudgetTracker(loadedPlan.envelope.changeBudget);

				// Init Showboat document — mandatory audit artifact (AC 7.1)
				const showboatOk = initOrchestratorShowboat(showboatPath, planId, workflowId);
				if (!showboatOk) {
					clearSession();
					const r = makeResult(action, false, "Fatal: failed to create mandatory Showboat audit artifact");
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}
				logTransition(showboatPath, "idle", "loading_plan", "load_plan");

				// Set active workflow and persist
				setActiveWorkflowId(cwd, workflowId);
				persistWorkflow(cwd);

				const msg = `Plan "${planId}" loaded. Workflow "${workflowId}" created. State: loading_plan. Call start to begin execution.`;
				return {
					content: [{ type: "text" as const, text: msg }],
					details: makeResult(action, true, msg, { workflowId, planId }),
				};
			}

			// ── All other actions require active state ──
			if (!activeFsm || !activeWorkflow) {
				const r = makeResult(action, false, "No active workflow. Use load_plan first.");
				return { content: [{ type: "text" as const, text: r.message }], details: r };
			}

			const currentState = activeFsm.getState();

			// ── start ──
			if (action === "start") {
				if (currentState !== "loading_plan") {
					const r = makeResult(action, false, `Cannot start: orchestrator is in "${currentState}" state, needs "loading_plan"`);
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				if (!loadedPlan) {
					const r = makeResult(action, false, "No plan loaded");
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				// Get execution order (topological sort returns reverse dependency order, so reverse it)
				const rawOrder = getExecutionOrder(loadedPlan.tasks);
				if (!rawOrder) {
					const r = makeResult(action, false, "Cyclic dependencies detected — cannot determine execution order");
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}
				const execOrder = [...rawOrder].reverse();

				// Create StepLedger and BudgetTracker
				activeLedger = new StepLedger();
				activeBudget = new BudgetTracker(loadedPlan.envelope.changeBudget);

				// Transition to executing
				const t1 = activeFsm.transition("executing", "start");
				if (!t1.ok) {
					const r = makeResult(action, false, (t1 as any).reason);
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				logTransition(activeWorkflow.showboatPath, "loading_plan", "executing", "start");
				persistWorkflow(cwd);

				const msg = `Execution started. ${execOrder.length} tasks in dependency order: ${execOrder.join(" → ")}`;
				return {
					content: [{ type: "text" as const, text: msg }],
					details: makeResult(action, true, msg, { executionOrder: execOrder }),
				};
			}

			// ── execute_step ──
			if (action === "execute_step") {
				if (currentState !== "executing") {
					const r = makeResult(action, false, `Cannot execute_step: orchestrator is in "${currentState}" state, needs "executing"`);
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				if (!loadedPlan || !activeLedger || !activeBudget) {
					const r = makeResult(action, false, "Internal error: missing plan or ledger");
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				// Check if there's already a pending step
				const pending = activeLedger.getPending();
				if (pending) {
					const r = makeResult(action, false, `Step "${pending.taskId}" is already in progress. Call report_result first.`);
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				// Check budget before allowing next step
				const budgetCheck = activeBudget.isExceeded();
				if (budgetCheck.exceeded) {
					const r = makeResult(action, false, `Budget exceeded on: ${budgetCheck.dimensions.join(", ")}. Cannot start new steps.`);
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				// Get execution order and find next non-committed task
				const rawExecOrder = getExecutionOrder(loadedPlan.tasks);
				if (!rawExecOrder) {
					const r = makeResult(action, false, "Cyclic dependencies — cannot proceed");
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}
				const execOrder = [...rawExecOrder].reverse();

				let targetTaskId = params.task_id as string | undefined;
				if (!targetTaskId) {
					// Find next task that isn't committed
					targetTaskId = execOrder.find(id => !activeLedger!.isCommitted(id));
				}

				if (!targetTaskId) {
					const r = makeResult(action, false, "All tasks are committed. Call verify.");
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				const task = loadedPlan.tasks.find(t => t.id === targetTaskId);
				if (!task) {
					const r = makeResult(action, false, `Task "${targetTaskId}" not found in plan`);
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				// Check dependencies are committed
				for (const depId of task.dependencies) {
					if (!activeLedger.isCommitted(depId)) {
						const r = makeResult(action, false, `Dependency "${depId}" is not committed yet`);
						return { content: [{ type: "text" as const, text: r.message }], details: r };
					}
				}

				// Evaluate policy for the task
				const policyCtx = defaultPolicyContext();
				const phase = loadedPlan.phases.find(p => p.name === task.phaseRef);
				if (phase) {
					policyCtx.isTestFileWriteInRedPhase = phase.type === "red";
					policyCtx.isInScopeMutation = true;
				}

				// Check if budget is near threshold
				const nearThreshold = activeBudget.isNearThreshold();
				policyCtx.isBudgetNearThreshold = nearThreshold.near;

				// Edit-after-green detection: if any green-phase step is committed
				// and this task is not a verify phase, require approval
				const committedEntries = activeLedger.getCommitted();
				const hasGreenCommitted = committedEntries.some(e => e.phaseType === "green");
				if (hasGreenCommitted && phase && phase.type !== "verify") {
					policyCtx.isEditAfterGreen = true;
				}

				const policyDecision = evaluatePolicy(policyCtx);

				if (policyDecision.riskLevel === "approval_required") {
					// Transition to awaiting_approval
					pendingApprovalTriggers = policyDecision.triggers;
					pendingApprovalScope = policyDecision.scope;
					const t1 = activeFsm.transition("awaiting_approval", "approval_required");
					if (t1.ok) {
						logTransition(activeWorkflow.showboatPath, "executing", "awaiting_approval", "approval_required");
						persistWorkflow(cwd);
					}
					const r = makeResult(action, false, `Approval required: ${policyDecision.triggers.join(", ")}`, {
						taskId: targetTaskId,
						triggers: policyDecision.triggers,
					});
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				// Subagent binding: create if task has assignedSubagent and binding doesn't exist yet
				if (task.assignedSubagent && phase && activeWorkflow) {
					const existingBinding = activeWorkflow.subagentBindings.find(b => b.taskId === targetTaskId);
					if (existingBinding) {
						// Check subagent budget exhaustion
						if (isSubagentBudgetExhausted(existingBinding)) {
							const r = makeResult(action, false, `Subagent budget exhausted for task "${targetTaskId}" (${existingBinding.stepsUsed}/${existingBinding.stepBudget} steps used)`);
							return { content: [{ type: "text" as const, text: r.message }], details: r };
						}
					} else {
						const binding = bindSubagent(task, loadedPlan.envelope, phase);
						if (binding) {
							activeWorkflow.subagentBindings.push(binding);
						}
					}
				}

				// Begin step in ledger
				const phaseType = phase?.type ?? "red";
				const began = activeLedger.beginStep(targetTaskId, task.phaseRef, phaseType, `execute ${task.title}`);
				if (!began) {
					const r = makeResult(action, false, `Could not begin step for task "${targetTaskId}"`);
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				logStepStart(activeWorkflow.showboatPath, targetTaskId, task.title, task.phaseRef);
				persistWorkflow(cwd);

				const msg = `Executing task "${targetTaskId}": ${task.title} (phase: ${task.phaseRef})`;
				return {
					content: [{ type: "text" as const, text: msg }],
					details: makeResult(action, true, msg, {
						taskId: targetTaskId,
						title: task.title,
						description: task.description,
						phaseRef: task.phaseRef,
						expectedOutcome: task.expectedOutcome,
						verificationStep: task.verificationStep,
					}),
				};
			}

			// ── report_result ──
			if (action === "report_result") {
				if (currentState !== "executing") {
					const r = makeResult(action, false, `Cannot report_result: orchestrator is in "${currentState}" state, needs "executing"`);
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				if (!activeLedger || !activeBudget) {
					const r = makeResult(action, false, "Internal error: missing ledger or budget");
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				const pending = activeLedger.getPending();
				if (!pending) {
					const r = makeResult(action, false, "No step in progress. Call execute_step first.");
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				const filesModified = (params.files_modified as string[] | undefined) ?? [];
				const filesCreated = (params.files_created as string[] | undefined) ?? [];
				const linesChanged = (params.lines_changed as number | undefined) ?? 0;
				const auditNote = (params.audit_note as string | undefined) ?? "";

				// ── Policy checks before committing ──
				if (loadedPlan) {
					const reportPolicyCtx = defaultPolicyContext();
					reportPolicyCtx.isInScopeMutation = true;

					// High-impact file detection
					const allFiles = [...filesModified, ...filesCreated];
					if (allFiles.some(f => isHighImpact(f))) {
						reportPolicyCtx.isHighImpactFile = true;
					}

					// Envelope enforcement — check for out-of-scope files
					for (const f of allFiles) {
						const check = enforceEnvelope(loadedPlan.envelope, { filePath: f });
						if (!check.allowed) {
							reportPolicyCtx.isFirstWriteOutsidePlanScope = true;
							break;
						}
					}

					// Bulk edit detection
					if (allFiles.length >= ORCHESTRATOR_CONFIG_DEFAULTS.bulkEditThreshold) {
						reportPolicyCtx.isBulkEdit = true;
					}

					// Budget near threshold
					const nearThreshold = activeBudget.isNearThreshold();
					reportPolicyCtx.isBudgetNearThreshold = nearThreshold.near;

					// Edit-after-green detection
					const committedEntries = activeLedger.getCommitted();
					const hasGreenCommitted = committedEntries.some(e => e.phaseType === "green");
					if (hasGreenCommitted && pending.phaseType !== "verify") {
						reportPolicyCtx.isEditAfterGreen = true;
					}

					// Test file write in red phase is auto-allowed, but only when
					// no higher-priority risk triggers are active (high-impact,
					// out-of-scope, bulk-edit)
					if (pending.phaseType === "red"
						&& !reportPolicyCtx.isHighImpactFile
						&& !reportPolicyCtx.isFirstWriteOutsidePlanScope
						&& !reportPolicyCtx.isBulkEdit) {
						reportPolicyCtx.isTestFileWriteInRedPhase = true;
					}

					const reportPolicy = evaluatePolicy(reportPolicyCtx);
					if (reportPolicy.riskLevel === "approval_required") {
						// Transition to awaiting_approval without committing
						pendingApprovalTriggers = reportPolicy.triggers;
						pendingApprovalScope = reportPolicy.scope;
						const t1 = activeFsm.transition("awaiting_approval", "approval_required");
						if (t1.ok) {
							logTransition(activeWorkflow.showboatPath, "executing", "awaiting_approval", "approval_required");
							persistWorkflow(cwd);
						}
						const r = makeResult(action, false, `Approval required: ${reportPolicy.triggers.join(", ")}`, {
							taskId: pending.taskId,
							triggers: reportPolicy.triggers,
							approval_required: true,
						});
						return { content: [{ type: "text" as const, text: r.message }], details: r };
					}
				}

				// Commit the step
				const committed = activeLedger.commitStep(pending.taskId, {
					filesModified,
					filesCreated,
					linesChanged,
					auditNote,
				});

				if (!committed) {
					const r = makeResult(action, false, `Failed to commit step for task "${pending.taskId}"`);
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				// Update budget tracker
				for (const f of filesModified) {
					activeBudget.recordModification(f, 0);
				}
				for (const f of filesCreated) {
					activeBudget.recordCreation(f, 0);
				}
				// Record lines changed as a single batch
				if (linesChanged > 0) {
					activeBudget.recordModification("__lines__", linesChanged);
				}

				// Increment subagent stepsUsed if applicable
				if (activeWorkflow) {
					const binding = activeWorkflow.subagentBindings.find(b => b.taskId === pending.taskId);
					if (binding) {
						binding.stepsUsed += 1;
					}
				}

				// Check budget exceeded
				const budgetCheck = activeBudget.isExceeded();
				const budgetWarning = budgetCheck.exceeded
					? ` WARNING: Budget exceeded on: ${budgetCheck.dimensions.join(", ")}.`
					: "";

				// Log to showboat
				const entry = activeLedger.getCommitted().find(e => e.taskId === pending.taskId);
				if (entry) {
					logStepCommit(activeWorkflow.showboatPath, entry);
				}
				logBudgetStatus(activeWorkflow.showboatPath, activeBudget.getUsage());

				persistWorkflow(cwd);

				const msg = `Step "${pending.taskId}" committed.${budgetWarning}`;
				return {
					content: [{ type: "text" as const, text: msg }],
					details: makeResult(action, true, msg, {
						taskId: pending.taskId,
						budgetExceeded: budgetCheck.exceeded,
						budgetDimensions: budgetCheck.dimensions,
					}),
				};
			}

			// ── request_approval ──
			if (action === "request_approval") {
				// Resume from awaiting_approval to executing
				if (currentState !== "awaiting_approval") {
					const r = makeResult(action, false, `Cannot request_approval: not in "awaiting_approval" state`);
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				// Create approval record
				const approvalId = `approval-${Date.now()}`;
				const pendingEntry = activeLedger?.getPending();
				const record: ApprovalRecord = {
					id: approvalId,
					stepId: pendingEntry?.stepId ?? "unknown",
					reason: params.reason ?? "Step requires approval",
					riskTriggers: [...pendingApprovalTriggers],
					requestedAt: new Date().toISOString(),
					resolvedAt: null,
					approved: null,
					scope: pendingApprovalScope,
				};
				activeWorkflow.approvalRecords.push(record);
				logApprovalRequest(activeWorkflow.showboatPath, record);

				const approved = await ctx.ui.confirm("Approve Step", params.reason ?? "Step requires approval");

				// Update record with resolution
				record.resolvedAt = new Date().toISOString();
				record.approved = approved;
				logApprovalResolution(activeWorkflow.showboatPath, record);
				pendingApprovalTriggers = [];
				pendingApprovalScope = "phase";

				if (approved) {
					activeFsm.transition("executing", "approval_granted");
					logTransition(activeWorkflow.showboatPath, "awaiting_approval", "executing", "approval_granted");
					persistWorkflow(cwd);
					const r = makeResult(action, true, "Approval granted. Resuming execution.");
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				} else {
					activeFsm.transition("blocked", "approval_denied");
					logTransition(activeWorkflow.showboatPath, "awaiting_approval", "blocked", "approval_denied");
					persistWorkflow(cwd);
					const r = makeResult(action, false, "Approval denied. Workflow blocked.");
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}
			}

			// ── skip_step ──
			if (action === "skip_step") {
				if (currentState !== "executing") {
					const r = makeResult(action, false, `Cannot skip_step in "${currentState}" state`);
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				if (!activeLedger) {
					const r = makeResult(action, false, "No active ledger");
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				const pending = activeLedger.getPending();
				if (!pending) {
					const r = makeResult(action, false, "No step in progress to skip");
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				const reason = (params.reason as string) ?? "skipped";
				activeLedger.skipStep(pending.taskId, reason);
				persistWorkflow(cwd);

				const r = makeResult(action, true, `Step "${pending.taskId}" skipped: ${reason}`);
				return { content: [{ type: "text" as const, text: r.message }], details: r };
			}

			// ── retry_step ──
			if (action === "retry_step") {
				if (currentState !== "executing") {
					const r = makeResult(action, false, `Cannot retry_step in "${currentState}" state`);
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				const taskId = params.task_id as string | undefined;
				if (!taskId) {
					const r = makeResult(action, false, "Missing required: task_id");
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				if (!activeLedger) {
					const r = makeResult(action, false, "No active ledger");
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				const count = activeLedger.incrementRetry(taskId);
				if (count > ORCHESTRATOR_CONFIG_DEFAULTS.maxRetriesPerStep) {
					const r = makeResult(action, false, `Max retries (${ORCHESTRATOR_CONFIG_DEFAULTS.maxRetriesPerStep}) exceeded for task "${taskId}"`);
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				logRetry(activeWorkflow.showboatPath, taskId, count);
				persistWorkflow(cwd);

				const r = makeResult(action, true, `Retry #${count} for task "${taskId}"`);
				return { content: [{ type: "text" as const, text: r.message }], details: r };
			}

			// ── fail_step ──
			if (action === "fail_step") {
				if (currentState !== "executing") {
					const r = makeResult(action, false, `Cannot fail_step in "${currentState}" state`);
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				if (!activeLedger) {
					const r = makeResult(action, false, "No active ledger");
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				const failPending = activeLedger.getPending();
				if (!failPending) {
					const r = makeResult(action, false, "No step in progress to fail");
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				const failReason = (params.reason as string) ?? "Step failed";
				activeLedger.failStep(failPending.taskId, failReason);
				logStepFailure(activeWorkflow.showboatPath, failPending.taskId, failReason);
				persistWorkflow(cwd);

				const r = makeResult(action, true, `Step "${failPending.taskId}" failed: ${failReason}`);
				return { content: [{ type: "text" as const, text: r.message }], details: r };
			}

			// ── verify ──
			if (action === "verify") {
				if (currentState !== "executing") {
					const r = makeResult(action, false, `Cannot verify: orchestrator is in "${currentState}" state, needs "executing"`);
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				if (!loadedPlan || !activeLedger) {
					const r = makeResult(action, false, "Internal error: missing plan or ledger");
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				// Check all tasks committed
				const uncommitted = loadedPlan.tasks.filter(t => !activeLedger!.isCommitted(t.id));
				if (uncommitted.length > 0) {
					const ids = uncommitted.map(t => t.id).join(", ");
					const r = makeResult(action, false, `Not all tasks committed. Remaining: ${ids}`);
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				// Transition to verifying
				const t1 = activeFsm.transition("verifying", "verify");
				if (!t1.ok) {
					const r = makeResult(action, false, (t1 as any).reason);
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				logTransition(activeWorkflow.showboatPath, "executing", "verifying", "verify");

				// Execute verification steps
				const verResults: Array<{ step: string; passed: boolean; output: string }> = [];
				for (const vs of loadedPlan.verificationSteps) {
					if (vs.command) {
						try {
							const output = execSync(vs.command, {
								cwd,
								timeout: 60000,
								encoding: "utf-8",
								stdio: ["pipe", "pipe", "pipe"],
							});
							verResults.push({
								step: vs.description,
								passed: true,
								output: (typeof output === "string" ? output.trim() : "") || vs.expectedResult,
							});
						} catch (err: any) {
							const output = err.stdout?.toString?.() ?? err.stderr?.toString?.() ?? err.message ?? "command failed";
							verResults.push({ step: vs.description, passed: false, output });
						}
					} else {
						verResults.push({ step: vs.description, passed: true, output: vs.expectedResult });
					}
				}
				if (verResults.length > 0) {
					logVerification(activeWorkflow.showboatPath, verResults);
				}

				// Check if any verification failed
				const anyFailed = verResults.some(r => !r.passed);
				if (anyFailed) {
					const failedSteps = verResults.filter(r => !r.passed).map(r => r.step).join(", ");
					const t2 = activeFsm.transition("failed", "verification_failed");
					if (!t2.ok) {
						const r = makeResult(action, false, (t2 as any).reason);
						return { content: [{ type: "text" as const, text: r.message }], details: r };
					}
					logTerminalOutcome(activeWorkflow.showboatPath, "failed", `Verification failed: ${failedSteps}`);
					persistWorkflow(cwd);
					setActiveWorkflowId(cwd, null);
					clearSession();

					const msg = `Verification failed: ${failedSteps}`;
					return {
						content: [{ type: "text" as const, text: msg }],
						details: makeResult(action, false, msg),
					};
				}

				// Transition to completed
				const t2 = activeFsm.transition("completed", "verification_passed");
				if (!t2.ok) {
					const r = makeResult(action, false, (t2 as any).reason);
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				logTerminalOutcome(activeWorkflow.showboatPath, "completed", "All tasks committed and verification passed.");

				// Capture task count before clearing
				const taskCount = loadedPlan.tasks.length;

				// Persist final state then clear
				persistWorkflow(cwd);
				setActiveWorkflowId(cwd, null);
				clearSession();

				const msg = `Workflow completed. All ${taskCount} tasks committed and verified.`;
				return {
					content: [{ type: "text" as const, text: msg }],
					details: makeResult(action, true, msg),
				};
			}

			// ── abort ──
			if (action === "abort") {
				const t1 = activeFsm.transition("aborted", "user_abort");
				if (!t1.ok) {
					const r = makeResult(action, false, `Cannot abort: ${(t1 as any).reason}`);
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				logTerminalOutcome(activeWorkflow.showboatPath, "aborted", params.reason ?? "User aborted.");

				persistWorkflow(cwd);
				setActiveWorkflowId(cwd, null);
				clearSession();

				const msg = "Workflow aborted.";
				return {
					content: [{ type: "text" as const, text: msg }],
					details: makeResult(action, true, msg),
				};
			}

			// Unknown action
			const r = makeResult(action, false, `Unknown action: ${action}`);
			return { content: [{ type: "text" as const, text: r.message }], details: r };
		},

		renderCall(args: { action?: string; plan_id?: string; task_id?: string }, theme) {
			const fg = theme.fg.bind(theme);
			const actionLabel = fg("accent", args.action ?? "orchestrator");
			let detail = "";
			if (args.plan_id) detail += ` ${fg("muted", args.plan_id)}`;
			if (args.task_id) detail += ` ${fg("warning", args.task_id)}`;
			return new Text(`orchestrator ${actionLabel}${detail}`, 0, 0);
		},

		renderResult(result, _opts, theme) {
			const details = result.details as OrchestratorToolDetails | undefined;
			if (!details) return undefined;
			const fg = theme.fg.bind(theme);
			const status = details.success ? fg("success", "✓") : fg("error", "✗");
			return new Text(`${status} ${details.message}`, 0, 0);
		},
	});

	// ── Command Registration ──

	pi.registerCommand("exec", {
		description: "Orchestrator: status | list | view | showboat | resume | abort | reset",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/);
			const subcommand = parts[0] || "status";
			const rest = parts.slice(1).join(" ");
			const cwd = ctx.cwd;

			switch (subcommand) {
				case "status": {
					const state = activeFsm?.getState() ?? "idle";
					if (activeWorkflow) {
						const budgetStr = activeBudget ? (() => {
							const u = activeBudget.getUsage();
							return ` | Budget: ${u.filesModified.used}/${u.filesModified.budget} files, ${u.linesChanged.used}/${u.linesChanged.budget} lines`;
						})() : "";
						ctx.ui.notify(`State: ${state} | Workflow: ${activeWorkflow.workflowId}${budgetStr}`, "info");
					} else {
						ctx.ui.notify(`State: ${state} | No active workflow`, "info");
					}
					break;
				}
				case "list": {
					const workflows = listWorkflows(cwd);
					if (workflows.length === 0) {
						ctx.ui.notify("No workflows found.", "info");
					} else {
						const lines = workflows.map(w => `${w.id} [${w.state}] plan:${w.planId} ${w.createdAt}`).join("\n");
						ctx.ui.notify(lines, "info");
					}
					break;
				}
				case "view": {
					const wfId = rest || activeWorkflow?.workflowId;
					if (!wfId) {
						ctx.ui.notify("No workflow specified and no active workflow.", "error");
						return;
					}
					const wf = rest ? loadWorkflow(cwd, wfId) : activeWorkflow;
					if (!wf) {
						ctx.ui.notify(`Workflow "${wfId}" not found.`, "error");
						return;
					}
					pi.sendMessage({
						customType: "orchestrator-view",
						content: JSON.stringify(wf, null, 2),
					});
					break;
				}
				case "showboat": {
					const wfId = rest || activeWorkflow?.workflowId;
					if (!wfId) {
						ctx.ui.notify("No workflow specified and no active workflow.", "error");
						return;
					}
					const wf = rest ? loadWorkflow(cwd, wfId) : activeWorkflow;
					if (!wf) {
						ctx.ui.notify(`Workflow "${wfId}" not found.`, "error");
						return;
					}
					const content = readFileSafe(wf.showboatPath);
					if (content) {
						pi.sendMessage({
							customType: "orchestrator-showboat",
							content,
						});
					} else {
						ctx.ui.notify("Showboat document not found.", "error");
					}
					break;
				}
				case "resume": {
					const wfId = rest;
					if (!wfId) {
						ctx.ui.notify("Specify a workflow ID to resume.", "error");
						return;
					}
					const restored = restoreWorkflow(cwd, wfId);
					if (!restored) {
						ctx.ui.notify(`Workflow "${wfId}" not found or not resumable.`, "error");
						return;
					}
					setActiveWorkflowId(cwd, wfId);
					ctx.ui.notify(`Resumed workflow "${wfId}" in state "${activeFsm?.getState()}"`, "info");
					break;
				}
				case "abort": {
					if (!activeFsm || !activeWorkflow) {
						ctx.ui.notify("No active workflow to abort.", "error");
						return;
					}
					const result = activeFsm.transition("aborted", "user_abort");
					if (!result.ok) {
						ctx.ui.notify(`Cannot abort: ${(result as any).reason}`, "error");
						return;
					}
					logTerminalOutcome(activeWorkflow.showboatPath, "aborted", "User aborted via command.");
					persistWorkflow(cwd);
					setActiveWorkflowId(cwd, null);
					ctx.ui.notify(`Workflow "${activeWorkflow.workflowId}" aborted.`, "info");
					clearSession();
					break;
				}
				case "reset": {
					setActiveWorkflowId(cwd, null);
					clearSession();
					ctx.ui.notify("Active workflow cleared.", "info");
					break;
				}
				default: {
					ctx.ui.notify(`Unknown subcommand: ${subcommand}. Use: status | list | view | showboat | resume | abort | reset`, "error");
				}
			}
		},
	});

	// ── Session Start Hook ──

	pi.on("session_start", async (_event, ctx) => {
		const cwd = ctx.cwd;
		const wfId = getActiveWorkflowId(cwd);
		if (!wfId) return;

		const restored = restoreWorkflow(cwd, wfId);
		if (!restored) return;

		ctx.ui.notify(`Resumed workflow "${wfId}" in state "${activeFsm?.getState()}"`, "info");
	});
}

/**
 * Restore a workflow from disk into in-memory state.
 * Returns true on success, false if not found or not resumable.
 */
function restoreWorkflow(cwd: string, wfId: string): boolean {
	const wf = loadWorkflow(cwd, wfId);
	if (!wf) return false;

	const fsm = OrchestratorFSM.deserialize(wf.fsm);
	if (!fsm.isResumable()) return false;

	// Reload the plan from planner persistence
	const plannerSession = loadPlannerPlan(cwd, wf.planId);
	if (!plannerSession) return false;

	activeFsm = fsm;
	activeWorkflow = wf;
	loadedPlan = plannerSession.plan;
	activeLedger = StepLedger.deserialize({
		entries: wf.ledger,
		retryCounters: wf.retryCounters,
	});
	activeBudget = BudgetTracker.deserialize(wf.budgetSnapshot);

	return true;
}
