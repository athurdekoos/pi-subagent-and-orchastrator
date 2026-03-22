import type { Plan, ValidationResult, ValidationIssue } from "./types.js";
import { PHASE_TYPES } from "./types.js";
import { ERROR_MESSAGES } from "./errors.js";
import { validateDependencyGraph } from "./graph.js";
import { validateEnvelopeConstraints, validateSubagentScopes, validateFileManagerCompatibility } from "./envelope.js";
import { computeScore } from "./scoring.js";

/** Validate all required fields are present and non-empty. */
export function validateStructure(plan: Plan): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	if (!plan.version) issues.push({ code: "MISSING_VERSION", severity: "error", message: ERROR_MESSAGES.MISSING_VERSION() });
	if (plan.phases.length === 0) issues.push({ code: "EMPTY_PHASES", severity: "error", message: ERROR_MESSAGES.EMPTY_PHASES() });
	if (plan.tasks.length === 0) issues.push({ code: "EMPTY_TASKS", severity: "error", message: ERROR_MESSAGES.EMPTY_TASKS() });

	// Check for duplicate phase names
	const phaseNames = new Set<string>();
	for (const phase of plan.phases) {
		if (phaseNames.has(phase.name)) {
			issues.push({ code: "DUPLICATE_PHASE_NAME", severity: "error", message: ERROR_MESSAGES.DUPLICATE_PHASE_NAME(phase.name), path: `phases[${phase.name}]` });
		}
		phaseNames.add(phase.name);
		if (!(PHASE_TYPES as readonly string[]).includes(phase.type)) {
			issues.push({ code: "INVALID_PHASE_TYPE", severity: "error", message: ERROR_MESSAGES.INVALID_PHASE_TYPE(phase.type), path: `phases[${phase.name}].type` });
		}
	}

	// Check for duplicate task IDs
	const taskIds = new Set<string>();
	for (const task of plan.tasks) {
		if (taskIds.has(task.id)) {
			issues.push({ code: "DUPLICATE_TASK_ID", severity: "error", message: ERROR_MESSAGES.DUPLICATE_TASK_ID(task.id), path: `tasks[${task.id}]` });
		}
		taskIds.add(task.id);
	}

	// Validate timestamps
	if (plan.createdAt && isNaN(Date.parse(plan.createdAt))) {
		issues.push({ code: "INVALID_TIMESTAMP", severity: "error", message: ERROR_MESSAGES.INVALID_TIMESTAMP("createdAt", plan.createdAt) });
	}
	if (plan.updatedAt && isNaN(Date.parse(plan.updatedAt))) {
		issues.push({ code: "INVALID_TIMESTAMP", severity: "error", message: ERROR_MESSAGES.INVALID_TIMESTAMP("updatedAt", plan.updatedAt) });
	}

	return issues;
}

/** Validate TDD phase ordering: red before green, verify after green. */
export function validatePhaseOrdering(plan: Plan): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const typeIndices = new Map<string, number>();
	for (let i = 0; i < plan.phases.length; i++) {
		const existing = typeIndices.get(plan.phases[i].type);
		if (existing === undefined) typeIndices.set(plan.phases[i].type, i);
	}

	if (!typeIndices.has("red")) issues.push({ code: "MISSING_RED_PHASE", severity: "error", message: ERROR_MESSAGES.MISSING_RED_PHASE() });
	if (!typeIndices.has("green")) issues.push({ code: "MISSING_GREEN_PHASE", severity: "error", message: ERROR_MESSAGES.MISSING_GREEN_PHASE() });
	if (!typeIndices.has("verify")) issues.push({ code: "MISSING_VERIFY_PHASE", severity: "error", message: ERROR_MESSAGES.MISSING_VERIFY_PHASE() });

	const redIdx = typeIndices.get("red");
	const greenIdx = typeIndices.get("green");
	const verifyIdx = typeIndices.get("verify");

	if (redIdx !== undefined && greenIdx !== undefined && redIdx >= greenIdx) {
		issues.push({ code: "RED_NOT_BEFORE_GREEN", severity: "error", message: ERROR_MESSAGES.RED_NOT_BEFORE_GREEN() });
	}
	if (greenIdx !== undefined && verifyIdx !== undefined && verifyIdx <= greenIdx) {
		issues.push({ code: "VERIFY_NOT_AFTER_GREEN", severity: "error", message: ERROR_MESSAGES.VERIFY_NOT_AFTER_GREEN() });
	}

	return issues;
}

/** Validate task-to-phase references are bidirectionally consistent. */
export function validateTaskPhaseRefs(plan: Plan): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const phaseNames = new Set(plan.phases.map(p => p.name));
	const allPhaseTasks = new Set(plan.phases.flatMap(p => p.tasks));

	for (const task of plan.tasks) {
		if (!phaseNames.has(task.phaseRef)) {
			issues.push({ code: "TASK_PHASE_REF_NOT_FOUND", severity: "error", message: ERROR_MESSAGES.TASK_PHASE_REF_NOT_FOUND(task.id, task.phaseRef), path: `tasks[${task.id}].phaseRef` });
		} else {
			const phase = plan.phases.find(p => p.name === task.phaseRef);
			if (phase && !phase.tasks.includes(task.id)) {
				issues.push({ code: "TASK_NOT_IN_PHASE", severity: "error", message: ERROR_MESSAGES.TASK_NOT_IN_PHASE(task.id, task.phaseRef), path: `tasks[${task.id}]` });
			}
		}
		if (!allPhaseTasks.has(task.id)) {
			issues.push({ code: "ORPHAN_TASK", severity: "warning", message: ERROR_MESSAGES.ORPHAN_TASK(task.id), path: `tasks[${task.id}]` });
		}
	}

	return issues;
}

/** Validate dependencies form a valid DAG. */
export function validateDependencies(plan: Plan): ValidationIssue[] {
	const phaseOrder = new Map<string, number>();
	for (let i = 0; i < plan.phases.length; i++) {
		phaseOrder.set(plan.phases[i].name, i);
	}
	return validateDependencyGraph(plan.tasks, phaseOrder);
}

/** Validate subagent assignments against policy. */
export function validateSubagentPolicy(plan: Plan): ValidationIssue[] {
	return validateSubagentScopes(plan.envelope, plan.tasks);
}

/** Validate verification coverage. */
export function validateVerification(plan: Plan): ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	if (plan.verificationSteps.length === 0) {
		issues.push({ code: "NO_VERIFICATION_STEPS", severity: "error", message: ERROR_MESSAGES.NO_VERIFICATION_STEPS() });
	}

	for (const task of plan.tasks) {
		if (!task.verificationStep || task.verificationStep.trim() === "") {
			issues.push({ code: "TASK_MISSING_VERIFICATION", severity: "error", message: ERROR_MESSAGES.TASK_MISSING_VERIFICATION(task.id), path: `tasks[${task.id}].verificationStep` });
		}
	}

	for (const criterion of plan.successCriteria) {
		if (!criterion.measurable) {
			issues.push({ code: "SUCCESS_CRITERION_NOT_MEASURABLE", severity: "warning", message: ERROR_MESSAGES.SUCCESS_CRITERION_NOT_MEASURABLE(criterion.id), path: `successCriteria[${criterion.id}]` });
		}
	}

	return issues;
}

/** Full plan validation. Single entry point. */
export function validatePlan(plan: Plan): ValidationResult {
	const issues: ValidationIssue[] = [
		...validateStructure(plan),
		...validatePhaseOrdering(plan),
		...validateTaskPhaseRefs(plan),
		...validateDependencies(plan),
		...validateEnvelopeConstraints(plan.envelope),
		...validateFileManagerCompatibility(plan.envelope),
		...validateSubagentPolicy(plan),
		...validateVerification(plan),
	];

	const score = computeScore(plan, issues);
	const valid = issues.filter(i => i.severity === "error").length === 0;

	return { valid, issues, score };
}
