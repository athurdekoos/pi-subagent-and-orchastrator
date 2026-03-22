import type { ValidationErrorCode } from "./types.js";

/** Maps each validation error code to a message template function. */
export const ERROR_MESSAGES: Record<ValidationErrorCode, (...args: string[]) => string> = {
	// Structural
	MISSING_REQUIRED_FIELD: (field) => `Required field "${field}" is missing or empty.`,
	EMPTY_PHASES: () => `Plan must contain at least one phase.`,
	EMPTY_TASKS: () => `Plan must contain at least one task.`,
	INVALID_PHASE_TYPE: (type) => `Phase type "${type}" is invalid. Must be one of: red, green, verify, refactor.`,
	INVALID_TASK_STATUS: (status, taskId) => `Task "${taskId}" has invalid status "${status}".`,
	DUPLICATE_TASK_ID: (id) => `Duplicate task ID "${id}". All task IDs must be unique.`,
	DUPLICATE_PHASE_NAME: (name) => `Duplicate phase name "${name}". All phase names must be unique.`,

	// Phase ordering
	MISSING_RED_PHASE: () => `TDD requires a "red" phase (failing tests first). Add a phase with type "red".`,
	MISSING_GREEN_PHASE: () => `TDD requires a "green" phase (implementation). Add a phase with type "green".`,
	MISSING_VERIFY_PHASE: () => `Plan must include a "verify" phase to confirm success.`,
	RED_NOT_BEFORE_GREEN: () => `The "red" phase must appear before the "green" phase.`,
	VERIFY_NOT_AFTER_GREEN: () => `The "verify" phase must appear after the "green" phase.`,

	// Dependencies
	CIRCULAR_DEPENDENCY: (cycle) => `Circular dependency detected: ${cycle}.`,
	DEPENDENCY_NOT_FOUND: (taskId, depId) => `Task "${taskId}" depends on "${depId}", which does not exist.`,
	SELF_DEPENDENCY: (taskId) => `Task "${taskId}" depends on itself.`,
	CROSS_PHASE_BACKWARD_DEPENDENCY: (taskId, depId, taskPhase, depPhase) =>
		`Task "${taskId}" (phase "${taskPhase}") depends on "${depId}" (phase "${depPhase}"), which comes later.`,

	// Task-Phase refs
	TASK_PHASE_REF_NOT_FOUND: (taskId, phaseRef) => `Task "${taskId}" references phase "${phaseRef}", which does not exist.`,
	TASK_NOT_IN_PHASE: (taskId, phaseRef) => `Task "${taskId}" references phase "${phaseRef}", but that phase does not list this task.`,
	ORPHAN_TASK: (taskId) => `Task "${taskId}" is not referenced by any phase.`,

	// Envelope
	INVALID_GLOB_PATTERN: (pattern) => `Path scope pattern "${pattern}" is not a valid glob.`,
	EMPTY_PATH_SCOPE: () => `Execution envelope must define at least one path scope glob.`,
	EMPTY_ALLOWED_OPERATIONS: () => `Execution envelope must allow at least one operation.`,
	EMPTY_ALLOWED_TOOLS: () => `Execution envelope must allow at least one tool.`,
	UNBOUNDED_CHANGE_BUDGET: (field) => `Change budget field "${field}" is zero or missing.`,
	NEGATIVE_BUDGET_VALUE: (field, value) => `Change budget field "${field}" has negative value ${value}.`,
	EXCESSIVE_BUDGET_VALUE: (field, value, max) => `Change budget field "${field}" (${value}) exceeds maximum (${max}).`,
	INVALID_SUBAGENT_MAX_CONCURRENT: (value) => `Subagent maxConcurrent (${value}) must be between 1 and 8.`,

	// Subagent policy
	MUTATION_CAPABILITY_UNJUSTIFIED: (taskId, role) =>
		`Task "${taskId}" assigns subagent role "${role}" with mutation capability but no scope constraints.`,
	SUBAGENT_SCOPE_EXCEEDS_ENVELOPE: (taskId, scope) =>
		`Task "${taskId}" subagent scope "${scope}" is not within the envelope's pathScope.`,
	INVALID_SUBAGENT_CAPABILITY: (capability) =>
		`Subagent capability "${capability}" is not valid. Must be: read-only, execution, or mutation.`,

	// Verification
	NO_VERIFICATION_STEPS: () => `Plan must include at least one verification step.`,
	TASK_MISSING_VERIFICATION: (taskId) => `Task "${taskId}" has no verification step defined.`,
	SUCCESS_CRITERION_NOT_MEASURABLE: (criterionId) => `Success criterion "${criterionId}" is not marked as measurable.`,

	// General
	INVALID_TIMESTAMP: (field, value) => `Field "${field}" value "${value}" is not a valid ISO 8601 timestamp.`,
	MISSING_VERSION: () => `Plan must include a version string.`,

	// File-manager compatibility
	MISSING_FILE_MANAGER_TOOL: (ops) =>
		`Plan includes mutation operations (${ops}) but "files" tool is not in allowedTools. Add it for file-manager compatibility.`,
};
