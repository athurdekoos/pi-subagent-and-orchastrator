import type { Plan, ValidationIssue, PlanCompletenessScore } from "./types.js";

const WEIGHTS = {
	structuralCompleteness: 20,
	phaseOrdering: 20,
	dependencyIntegrity: 20,
	envelopeConstraints: 15,
	verificationCoverage: 15,
	subagentPolicy: 10,
} as const;

const CATEGORY_CODES: Record<keyof typeof WEIGHTS, string[]> = {
	structuralCompleteness: [
		"MISSING_REQUIRED_FIELD", "EMPTY_PHASES", "EMPTY_TASKS",
		"INVALID_PHASE_TYPE", "INVALID_TASK_STATUS",
		"DUPLICATE_TASK_ID", "DUPLICATE_PHASE_NAME",
		"MISSING_VERSION", "INVALID_TIMESTAMP",
	],
	phaseOrdering: [
		"MISSING_RED_PHASE", "MISSING_GREEN_PHASE", "MISSING_VERIFY_PHASE",
		"RED_NOT_BEFORE_GREEN", "VERIFY_NOT_AFTER_GREEN",
	],
	dependencyIntegrity: [
		"CIRCULAR_DEPENDENCY", "DEPENDENCY_NOT_FOUND", "SELF_DEPENDENCY",
		"CROSS_PHASE_BACKWARD_DEPENDENCY",
		"TASK_PHASE_REF_NOT_FOUND", "TASK_NOT_IN_PHASE", "ORPHAN_TASK",
	],
	envelopeConstraints: [
		"INVALID_GLOB_PATTERN", "EMPTY_PATH_SCOPE", "EMPTY_ALLOWED_OPERATIONS",
		"EMPTY_ALLOWED_TOOLS", "UNBOUNDED_CHANGE_BUDGET", "NEGATIVE_BUDGET_VALUE",
		"EXCESSIVE_BUDGET_VALUE", "INVALID_SUBAGENT_MAX_CONCURRENT",
		"MISSING_FILE_MANAGER_TOOL",
	],
	verificationCoverage: [
		"NO_VERIFICATION_STEPS", "TASK_MISSING_VERIFICATION",
		"SUCCESS_CRITERION_NOT_MEASURABLE",
	],
	subagentPolicy: [
		"MUTATION_CAPABILITY_UNJUSTIFIED", "SUBAGENT_SCOPE_EXCEEDS_ENVELOPE",
		"INVALID_SUBAGENT_CAPABILITY",
	],
};

function categoryScore(issues: ValidationIssue[], codes: string[]): number {
	let penalty = 0;
	for (const issue of issues) {
		if (codes.includes(issue.code)) {
			penalty += issue.severity === "error" ? 25 : 10;
		}
	}
	return Math.max(0, 100 - penalty);
}

/** Compute plan completeness score from validation issues. */
export function computeScore(plan: Plan, issues: ValidationIssue[]): PlanCompletenessScore {
	const breakdown = {
		structuralCompleteness: categoryScore(issues, CATEGORY_CODES.structuralCompleteness),
		phaseOrdering: categoryScore(issues, CATEGORY_CODES.phaseOrdering),
		dependencyIntegrity: categoryScore(issues, CATEGORY_CODES.dependencyIntegrity),
		envelopeConstraints: categoryScore(issues, CATEGORY_CODES.envelopeConstraints),
		verificationCoverage: categoryScore(issues, CATEGORY_CODES.verificationCoverage),
		subagentPolicy: categoryScore(issues, CATEGORY_CODES.subagentPolicy),
	};

	let overall = 0;
	for (const [key, weight] of Object.entries(WEIGHTS)) {
		overall += (breakdown[key as keyof typeof WEIGHTS] / 100) * weight;
	}

	return { overall: Math.round(overall), breakdown };
}
