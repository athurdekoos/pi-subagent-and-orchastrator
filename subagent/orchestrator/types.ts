/**
 * Types, constants, and interfaces for the Execution Orchestrator extension.
 */

import type {
	PhaseType,
	SubagentCapability,
	ChangeBudget,
	ExecutionEnvelope,
	Plan,
	PlanPhase,
	PlanTask,
} from "../planner/types.js";

// Re-export planner types used by orchestrator consumers
export type { PhaseType, SubagentCapability, ChangeBudget, ExecutionEnvelope, Plan, PlanPhase, PlanTask };

// ── FSM States ──

/** Finite-state-machine states for the orchestrator lifecycle. */
export const ORCHESTRATOR_STATES = [
	"idle",
	"loading_plan",
	"executing",
	"awaiting_approval",
	"verifying",
	"completed",
	"failed",
	"blocked",
	"aborted",
] as const;
export type OrchestratorState = (typeof ORCHESTRATOR_STATES)[number];

// ── Orchestrator Tool Actions ──

/** Actions exposed by the orchestrator tool. */
export const ORCHESTRATOR_ACTIONS = [
	"load_plan",
	"start",
	"execute_step",
	"report_result",
	"request_approval",
	"skip_step",
	"retry_step",
	"fail_step",
	"verify",
	"abort",
	"status",
] as const;
export type OrchestratorAction = (typeof ORCHESTRATOR_ACTIONS)[number];

// ── Step Status ──

/** Lifecycle status of a step in the ledger. */
export const STEP_STATUSES = [
	"pending",
	"in_progress",
	"committed",
	"failed",
	"skipped",
] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

// ── Capability Classes ──

/** Runtime capability classes for subagent governance. */
export const CAPABILITY_CLASSES = ["read-only", "execution", "mutation-capable"] as const;
export type CapabilityClass = (typeof CAPABILITY_CLASSES)[number];

// ── Risk Level ──

/** Risk classification for policy decisions. */
export type RiskLevel = "auto" | "approval_required";

// ── Approval Scope ──

/** Scope of an approval grant. */
export type ApprovalScope = "phase" | "action";

// ── Step Ledger Entry ──

/** A single entry in the step ledger tracking execution of one task. */
export interface LedgerEntry {
	/** Unique step identifier. */
	stepId: string;
	/** The plan task ID this step corresponds to. */
	taskId: string;
	/** Phase this task belongs to. */
	phaseRef: string;
	/** Phase type (red/green/verify/refactor). */
	phaseType: PhaseType;
	/** Current step status. */
	status: StepStatus;
	/** Description of the action taken. */
	action: string;
	/** Files modified during this step. */
	filesModified: string[];
	/** Files created during this step. */
	filesCreated: string[];
	/** Total lines changed during this step. */
	linesChanged: number;
	/** ISO 8601 timestamp when step began. */
	startedAt: string;
	/** ISO 8601 timestamp when step was committed, or null. */
	committedAt: string | null;
	/** Number of times this step has been retried. */
	retryCount: number;
	/** Error message if failed, or null. */
	error: string | null;
	/** Audit note written to Showboat. */
	auditNote: string;
}

// ── Approval Record ──

/** Record of an approval request and its resolution. */
export interface ApprovalRecord {
	/** Unique approval ID. */
	id: string;
	/** Step ID that triggered the approval. */
	stepId: string;
	/** Why approval is needed. */
	reason: string;
	/** What triggered the approval requirement. */
	riskTriggers: string[];
	/** ISO 8601 timestamp when requested. */
	requestedAt: string;
	/** ISO 8601 timestamp when resolved, or null if pending. */
	resolvedAt: string | null;
	/** True if approved, false if denied, null if pending. */
	approved: boolean | null;
	/** Scope of this approval. */
	scope: ApprovalScope;
}

// ── Budget Snapshot ──

/** Serializable snapshot of budget usage. */
export interface BudgetSnapshot {
	/** Paths of modified files (serialized as array). */
	filesModified: string[];
	/** Paths of created files. */
	filesCreated: string[];
	/** Total lines changed across all steps. */
	totalLinesChanged: number;
	/** The budget limits from the plan envelope. */
	budget: ChangeBudget;
}

// ── Subagent Runtime Binding ──

/** Runtime binding constraining a subagent's capabilities for a specific task. */
export interface SubagentRuntimeBinding {
	/** Task ID this binding applies to. */
	taskId: string;
	/** Descriptive role name. */
	role: string;
	/** Runtime capability class. */
	capabilityClass: CapabilityClass;
	/** Glob patterns constraining file access. */
	pathScope: string[];
	/** Tools the subagent may use. */
	allowedTools: string[];
	/** Whether the subagent may mutate files. */
	mutationRights: boolean;
	/** Maximum number of steps the subagent may take. */
	stepBudget: number;
	/** Number of steps used so far. */
	stepsUsed: number;
	/** Phase this binding applies to. */
	phaseRef: string;
}

// ── Policy Decision ──

/** Result of a policy evaluation. */
export interface PolicyDecision {
	/** Whether the action is auto-allowed or requires approval. */
	riskLevel: RiskLevel;
	/** Reasons that triggered approval requirement (empty for auto). */
	triggers: string[];
	/** Approval scope when approval is required. */
	scope: ApprovalScope;
}

// ── Policy Context ──

/** Context provided to the policy engine for evaluation. */
export interface PolicyContext {
	/** Whether this is the first write outside plan-declared path scope. */
	isFirstWriteOutsidePlanScope: boolean;
	/** Whether the action involves a delete operation. */
	isDelete: boolean;
	/** Whether the action involves a rename/move. */
	isRename: boolean;
	/** Whether this is a bulk edit (>N files). */
	isBulkEdit: boolean;
	/** Whether this edit happens after green phase is committed. */
	isEditAfterGreen: boolean;
	/** Whether this action expands scope beyond the envelope. */
	isScopeExpansion: boolean;
	/** Whether affected files are high-impact (package.json, CI, etc.). */
	isHighImpactFile: boolean;
	/** Whether budget is near threshold (>80%). */
	isBudgetNearThreshold: boolean;
	/** Whether the action is read-only. */
	isReadOnly: boolean;
	/** Whether the action is a test execution. */
	isTestExecution: boolean;
	/** Whether the action is a linter/typecheck. */
	isLinterExecution: boolean;
	/** Whether the action is Showboat generation. */
	isShowboatGeneration: boolean;
	/** Whether this is a test-file write during red phase. */
	isTestFileWriteInRedPhase: boolean;
	/** Whether this is a non-destructive mutation within plan scope. */
	isInScopeMutation: boolean;
}

// ── Serialized FSM ──

/** Serialized snapshot of the orchestrator FSM. */
export interface SerializedOrchestratorFSM {
	/** Current FSM state. */
	state: OrchestratorState;
	/** Ordered history of state transitions. */
	history: Array<{
		from: OrchestratorState;
		to: OrchestratorState;
		at: string;
		action: string;
	}>;
}

// ── Workflow State ──

/** Full persisted workflow state for checkpoint/resume. */
export interface WorkflowState {
	/** Unique workflow identifier. */
	workflowId: string;
	/** Plan ID being executed. */
	planId: string;
	/** Serialized FSM state. */
	fsm: SerializedOrchestratorFSM;
	/** Task ID currently being executed, or null. */
	pendingStep: string | null;
	/** All ledger entries. */
	ledger: LedgerEntry[];
	/** Per-task retry counters. */
	retryCounters: Record<string, number>;
	/** All approval records. */
	approvalRecords: ApprovalRecord[];
	/** Subagent runtime bindings. */
	subagentBindings: SubagentRuntimeBinding[];
	/** Budget usage snapshot. */
	budgetSnapshot: BudgetSnapshot;
	/** Path to the Showboat document. */
	showboatPath: string;
	/** ISO 8601 creation timestamp. */
	createdAt: string;
	/** ISO 8601 last-update timestamp. */
	updatedAt: string;
}

// ── Tool Result ──

/** Structured details returned by an orchestrator tool invocation. */
export interface OrchestratorToolDetails {
	/** The action that was invoked. */
	action: OrchestratorAction;
	/** Whether the action succeeded. */
	success: boolean;
	/** Human-readable result or error message. */
	message: string;
	/** Optional payload returned by the action. */
	data?: unknown;
}

// ── Config ──

/** Runtime configuration for the orchestrator extension. */
export interface OrchestratorConfig {
	/** Root directory relative to project root (default ".pi/orchestrator"). */
	rootDir: string;
	/** Maximum retries per step before failure (default 3). */
	maxRetriesPerStep: number;
	/** Bulk edit threshold: file count that triggers approval (default 5). */
	bulkEditThreshold: number;
	/** Budget warning threshold as fraction (default 0.8 = 80%). */
	budgetWarningThreshold: number;
}

/** Default orchestrator configuration. */
export const ORCHESTRATOR_CONFIG_DEFAULTS: OrchestratorConfig = {
	rootDir: ".pi/orchestrator",
	maxRetriesPerStep: 3,
	bulkEditThreshold: 5,
	budgetWarningThreshold: 0.8,
};

// ── High-Impact File Patterns ──

/** Glob patterns for files that always require approval for modification. */
export const HIGH_IMPACT_PATTERNS = [
	"package.json",
	"package-lock.json",
	"yarn.lock",
	"pnpm-lock.yaml",
	"tsconfig.json",
	"tsconfig.*.json",
	".eslintrc*",
	".prettierrc*",
	".github/**",
	".ci/**",
	"Dockerfile",
	"docker-compose*",
	".env*",
] as const;
