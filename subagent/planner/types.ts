/**
 * Types, constants, and interfaces for the Planning Orchestrator extension.
 */

// ── FSM States ──

/** Finite-state-machine states for the planner lifecycle. */
export const PLANNER_STATES = [
	"idle",
	"analyzing",
	"drafting",
	"validating",
	"awaiting_approval",
	"planned",
	"blocked",
	"failed",
	"aborted",
] as const;
export type PlannerState = (typeof PLANNER_STATES)[number];

// ── Phase Types ──

/** Red-green-verify-refactor phase classification. */
export const PHASE_TYPES = ["red", "green", "verify", "refactor"] as const;
export type PhaseType = (typeof PHASE_TYPES)[number];

// ── Subagent Capabilities ──

/** Capability levels assignable to a subagent. */
export const SUBAGENT_CAPABILITIES = ["read-only", "execution", "mutation"] as const;
export type SubagentCapability = (typeof SUBAGENT_CAPABILITIES)[number];

// ── Allowed Operations ──

/** Filesystem operations that may be permitted inside an execution envelope. */
export const ALLOWED_OPERATIONS = ["read", "write", "create", "delete"] as const;
export type AllowedOperation = (typeof ALLOWED_OPERATIONS)[number];

// ── Task Status ──

/** Lifecycle status of an individual plan task. */
export const TASK_STATUSES = ["pending", "in-progress", "completed", "failed", "skipped"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

// ── Planner Tool Actions ──

/** Actions exposed by the planner tool. */
export const PLANNER_ACTIONS = [
	"analyze_repo",
	"draft_plan",
	"add_phase",
	"add_task",
	"set_envelope",
	"add_criterion",
	"add_verification",
	"validate",
	"submit",
	"status",
] as const;
export type PlannerAction = (typeof PLANNER_ACTIONS)[number];

// ── Plan Schema ──

/** Assignment of a subagent to a task, including its capability and scope. */
export interface SubagentAssignment {
	/** Descriptive role name for the subagent. */
	role: string;
	/** Capability level granted to the subagent. */
	capability: SubagentCapability;
	/** Glob patterns or paths constraining the subagent's scope. */
	scopeConstraints: string[];
}

/** A single actionable task within a plan. */
export interface PlanTask {
	/** Unique task identifier. */
	id: string;
	/** Name of the phase this task belongs to. */
	phaseRef: string;
	/** Short human-readable title. */
	title: string;
	/** Detailed description of the work to be done. */
	description: string;
	/** IDs of tasks that must complete before this one. */
	dependencies: string[];
	/** What the task is expected to produce. */
	expectedOutcome: string;
	/** How completion of this task will be verified. */
	verificationStep: string;
	/** Optional subagent assignment for delegation. */
	assignedSubagent?: SubagentAssignment;
	/** Current lifecycle status. */
	status: TaskStatus;
}

/** A named phase grouping related tasks in execution order. */
export interface PlanPhase {
	/** Unique phase name. */
	name: string;
	/** Phase classification (red / green / verify / refactor). */
	type: PhaseType;
	/** Human-readable description of the phase's purpose. */
	description: string;
	/** Ordered list of task IDs belonging to this phase. */
	tasks: string[];
}

/** Concurrency and capability limits for subagent delegation. */
export interface SubagentPermissions {
	/** Maximum number of subagents that may run concurrently. */
	maxConcurrent: number;
	/** Capability levels that subagents are allowed to use. */
	allowedCapabilities: SubagentCapability[];
	/** Glob patterns constraining all subagent scopes. */
	scopeConstraints: string[];
}

/** Budget limiting the magnitude of changes a plan may make. */
export interface ChangeBudget {
	/** Maximum number of existing files that may be modified. */
	maxFilesModified: number;
	/** Maximum number of new files that may be created. */
	maxFilesCreated: number;
	/** Maximum total lines changed (added + removed). */
	maxLinesChanged: number;
}

/** Sandbox constraints governing plan execution. */
export interface ExecutionEnvelope {
	/** Glob patterns defining the writable path scope. */
	pathScope: string[];
	/** Filesystem operations the plan is allowed to perform. */
	allowedOperations: AllowedOperation[];
	/** Tool names the plan is allowed to invoke. */
	allowedTools: string[];
	/** Subagent delegation policy. */
	subagentPermissions: SubagentPermissions;
	/** Change magnitude limits. */
	changeBudget: ChangeBudget;
}

/** A measurable criterion for determining plan success. */
export interface SuccessCriterion {
	/** Unique criterion identifier. */
	id: string;
	/** Human-readable description. */
	description: string;
	/** Whether this criterion can be verified automatically. */
	measurable: boolean;
	/** Optional shell command to verify the criterion. */
	verificationCommand?: string;
}

/** A concrete step used to verify plan correctness after execution. */
export interface VerificationStep {
	/** Unique step identifier. */
	id: string;
	/** Human-readable description of what is being verified. */
	description: string;
	/** Optional shell command to run. */
	command?: string;
	/** Expected output or observable result. */
	expectedResult: string;
}

/** Top-level plan document produced by the planner. */
export interface Plan {
	/** Schema version (semver, e.g. "1.0.0"). */
	version: string;
	/** Unique plan identifier. */
	id: string;
	/** Original user intent that triggered planning. */
	intent: string;
	/** High-level goal the plan aims to achieve. */
	goal: string;
	/** Brief human-readable summary of the plan. */
	summary: string;
	/** Ordered list of phases. */
	phases: PlanPhase[];
	/** All tasks across all phases. */
	tasks: PlanTask[];
	/** Execution envelope constraining the plan's runtime behaviour. */
	envelope: ExecutionEnvelope;
	/** Criteria that must hold for the plan to be considered successful. */
	successCriteria: SuccessCriterion[];
	/** Steps used to verify the plan after execution. */
	verificationSteps: VerificationStep[];
	/** ISO 8601 creation timestamp. */
	createdAt: string;
	/** ISO 8601 last-update timestamp. */
	updatedAt: string;
	/** Whether this plan is flagged as high-impact. */
	highImpact: boolean;
	/** Result of the most recent validation pass, or null if not yet validated. */
	validationResult: ValidationResult | null;
}

// ── Validation ──

/** Error codes emitted by plan validation. */
export const VALIDATION_ERROR_CODES = [
	"MISSING_REQUIRED_FIELD",
	"EMPTY_PHASES",
	"EMPTY_TASKS",
	"INVALID_PHASE_TYPE",
	"INVALID_TASK_STATUS",
	"DUPLICATE_TASK_ID",
	"DUPLICATE_PHASE_NAME",
	"MISSING_RED_PHASE",
	"MISSING_GREEN_PHASE",
	"MISSING_VERIFY_PHASE",
	"RED_NOT_BEFORE_GREEN",
	"VERIFY_NOT_AFTER_GREEN",
	"CIRCULAR_DEPENDENCY",
	"DEPENDENCY_NOT_FOUND",
	"SELF_DEPENDENCY",
	"CROSS_PHASE_BACKWARD_DEPENDENCY",
	"TASK_PHASE_REF_NOT_FOUND",
	"TASK_NOT_IN_PHASE",
	"ORPHAN_TASK",
	"INVALID_GLOB_PATTERN",
	"EMPTY_PATH_SCOPE",
	"EMPTY_ALLOWED_OPERATIONS",
	"EMPTY_ALLOWED_TOOLS",
	"UNBOUNDED_CHANGE_BUDGET",
	"NEGATIVE_BUDGET_VALUE",
	"EXCESSIVE_BUDGET_VALUE",
	"INVALID_SUBAGENT_MAX_CONCURRENT",
	"MUTATION_CAPABILITY_UNJUSTIFIED",
	"SUBAGENT_SCOPE_EXCEEDS_ENVELOPE",
	"INVALID_SUBAGENT_CAPABILITY",
	"NO_VERIFICATION_STEPS",
	"TASK_MISSING_VERIFICATION",
	"SUCCESS_CRITERION_NOT_MEASURABLE",
	"INVALID_TIMESTAMP",
	"MISSING_VERSION",
	"MISSING_FILE_MANAGER_TOOL",
] as const;
export type ValidationErrorCode = (typeof VALIDATION_ERROR_CODES)[number];

/** Severity level for a validation issue. */
export type ValidationSeverity = "error" | "warning";

/** A single issue found during plan validation. */
export interface ValidationIssue {
	/** Machine-readable error code. */
	code: ValidationErrorCode;
	/** Whether this issue blocks approval. */
	severity: ValidationSeverity;
	/** Human-readable explanation. */
	message: string;
	/** JSON-path-like location within the plan, if applicable. */
	path?: string;
	/** Additional structured context for debugging. */
	context?: Record<string, unknown>;
}

/** Breakdown of plan quality across validation dimensions. */
export interface PlanCompletenessScore {
	/** Weighted overall score (0-100). */
	overall: number;
	/** Per-dimension scores. */
	breakdown: {
		/** Coverage of required fields and non-empty collections. */
		structuralCompleteness: number;
		/** Correctness of red-green-verify ordering. */
		phaseOrdering: number;
		/** Absence of cycles, missing refs, and backward deps. */
		dependencyIntegrity: number;
		/** Validity and tightness of envelope constraints. */
		envelopeConstraints: number;
		/** Ratio of tasks with verification coverage. */
		verificationCoverage: number;
		/** Soundness of subagent capability assignments. */
		subagentPolicy: number;
	};
}

/** Outcome of a full validation pass over a plan. */
export interface ValidationResult {
	/** Whether the plan passed validation without errors. */
	valid: boolean;
	/** All issues found during validation. */
	issues: ValidationIssue[];
	/** Completeness score computed during validation. */
	score: PlanCompletenessScore;
}

// ── Serialization ──

/** Serialized snapshot of the planner finite-state machine. */
export interface SerializedFSM {
	/** Current FSM state. */
	state: PlannerState;
	/** Ordered history of state transitions. */
	history: Array<{
		from: PlannerState;
		to: PlannerState;
		at: string;
		action: string;
	}>;
}

/** Persisted planner session tying FSM state to a plan on disk. */
export interface PlannerSession {
	/** Identifier of the associated plan. */
	planId: string;
	/** Serialized FSM state. */
	fsm: SerializedFSM;
	/** The plan document. */
	plan: Plan;
	/** Filesystem path to the showboat output file. */
	showboatPath: string;
}

// ── Config ──

/** Runtime configuration for the planner extension. */
export interface PlannerConfig {
	/** Root directory relative to project root (default ".pi/planner"). */
	rootDir: string;
	/** Upper bound for maxFilesModified in any change budget (default 500). */
	maxFilesModifiedLimit: number;
	/** Upper bound for maxFilesCreated in any change budget (default 200). */
	maxFilesCreatedLimit: number;
	/** Upper bound for maxLinesChanged in any change budget (default 50000). */
	maxLinesChangedLimit: number;
	/** Upper bound for subagent maxConcurrent (default 8). */
	maxConcurrentLimit: number;
	/** Whether plans require explicit user approval before execution (default true). */
	requireApproval: boolean;
}

// ── Tool Result ──

/** Structured details returned by a planner tool invocation. */
export interface PlannerToolDetails {
	/** The action that was invoked. */
	action: PlannerAction;
	/** Whether the action succeeded. */
	success: boolean;
	/** Human-readable result or error message. */
	message: string;
	/** Optional payload returned by the action. */
	data?: unknown;
	/** Optional completeness score, included after validation. */
	score?: PlanCompletenessScore;
}
