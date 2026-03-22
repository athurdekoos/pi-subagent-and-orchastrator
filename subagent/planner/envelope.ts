import type { ExecutionEnvelope, PlanTask, ValidationIssue } from "./types.js";
import { ALLOWED_OPERATIONS, SUBAGENT_CAPABILITIES } from "./types.js";
import { ERROR_MESSAGES } from "./errors.js";

const MAX_FILES_MODIFIED = 500;
const MAX_FILES_CREATED = 200;
const MAX_LINES_CHANGED = 50000;
const MAX_CONCURRENT = 8;

/** Check if a glob pattern is syntactically valid (lightweight check). */
export function isValidGlob(pattern: string): boolean {
	if (!pattern || pattern.length === 0) return false;
	if (pattern.includes("\0")) return false;
	// Check for unbalanced braces
	let depth = 0;
	for (const ch of pattern) {
		if (ch === "{") depth++;
		if (ch === "}") depth--;
		if (depth < 0) return false;
	}
	return depth === 0;
}

/** Conservative check: is child glob a subset of parent glob? */
export function isGlobSubset(child: string, parent: string): boolean {
	if (parent === "**" || parent === "**/*") return true;
	if (child === parent) return true;
	// Check if child starts with the same directory prefix
	const parentDir = parent.replace(/\/?\*.*$/, "");
	const childDir = child.replace(/\/?\*.*$/, "");
	if (parentDir && childDir.startsWith(parentDir)) return true;
	return false;
}

/** Validate execution envelope constraints. */
export function validateEnvelopeConstraints(envelope: ExecutionEnvelope): ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	// Path scope
	if (envelope.pathScope.length === 0) {
		issues.push({ code: "EMPTY_PATH_SCOPE", severity: "error", message: ERROR_MESSAGES.EMPTY_PATH_SCOPE() });
	}
	for (const pattern of envelope.pathScope) {
		if (!isValidGlob(pattern)) {
			issues.push({
				code: "INVALID_GLOB_PATTERN", severity: "error",
				message: ERROR_MESSAGES.INVALID_GLOB_PATTERN(pattern),
				path: "envelope.pathScope",
			});
		}
	}

	// Operations
	if (envelope.allowedOperations.length === 0) {
		issues.push({ code: "EMPTY_ALLOWED_OPERATIONS", severity: "error", message: ERROR_MESSAGES.EMPTY_ALLOWED_OPERATIONS() });
	}

	// Tools
	if (envelope.allowedTools.length === 0) {
		issues.push({ code: "EMPTY_ALLOWED_TOOLS", severity: "error", message: ERROR_MESSAGES.EMPTY_ALLOWED_TOOLS() });
	}

	// Change budget
	const budget = envelope.changeBudget;
	for (const [field, max] of [
		["maxFilesModified", MAX_FILES_MODIFIED],
		["maxFilesCreated", MAX_FILES_CREATED],
		["maxLinesChanged", MAX_LINES_CHANGED],
	] as const) {
		const val = budget[field];
		if (val < 0) {
			issues.push({
				code: "NEGATIVE_BUDGET_VALUE", severity: "error",
				message: ERROR_MESSAGES.NEGATIVE_BUDGET_VALUE(field, String(val)),
				path: `envelope.changeBudget.${field}`,
			});
		} else if (field !== "maxFilesCreated" && val === 0) {
			issues.push({
				code: "UNBOUNDED_CHANGE_BUDGET", severity: "error",
				message: ERROR_MESSAGES.UNBOUNDED_CHANGE_BUDGET(field),
				path: `envelope.changeBudget.${field}`,
			});
		} else if (val > max) {
			issues.push({
				code: "EXCESSIVE_BUDGET_VALUE", severity: "warning",
				message: ERROR_MESSAGES.EXCESSIVE_BUDGET_VALUE(field, String(val), String(max)),
				path: `envelope.changeBudget.${field}`,
			});
		}
	}

	// Subagent permissions
	const sp = envelope.subagentPermissions;
	if (sp.maxConcurrent < 1 || sp.maxConcurrent > MAX_CONCURRENT) {
		issues.push({
			code: "INVALID_SUBAGENT_MAX_CONCURRENT", severity: "error",
			message: ERROR_MESSAGES.INVALID_SUBAGENT_MAX_CONCURRENT(String(sp.maxConcurrent)),
			path: "envelope.subagentPermissions.maxConcurrent",
		});
	}
	for (const cap of sp.allowedCapabilities) {
		if (!(SUBAGENT_CAPABILITIES as readonly string[]).includes(cap)) {
			issues.push({
				code: "INVALID_SUBAGENT_CAPABILITY", severity: "error",
				message: ERROR_MESSAGES.INVALID_SUBAGENT_CAPABILITY(cap),
				path: "envelope.subagentPermissions.allowedCapabilities",
			});
		}
	}

	return issues;
}

/** Mutation operations that require the file-manager tool. */
const MUTATION_OPS = ["write", "create", "delete"] as const;

/** Validate that planned operations are compatible with the file-manager extension. */
export function validateFileManagerCompatibility(envelope: ExecutionEnvelope): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const hasMutationOps = envelope.allowedOperations.some(op =>
		(MUTATION_OPS as readonly string[]).includes(op),
	);
	if (hasMutationOps && !envelope.allowedTools.includes("files")) {
		const mutOps = envelope.allowedOperations.filter(op =>
			(MUTATION_OPS as readonly string[]).includes(op),
		);
		issues.push({
			code: "MISSING_FILE_MANAGER_TOOL",
			severity: "warning",
			message: ERROR_MESSAGES.MISSING_FILE_MANAGER_TOOL(mutOps.join(", ")),
			path: "envelope.allowedTools",
		});
	}
	return issues;
}

/** Validate subagent scopes are within envelope pathScope. */
export function validateSubagentScopes(
	envelope: ExecutionEnvelope,
	tasks: PlanTask[],
): ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	for (const task of tasks) {
		if (!task.assignedSubagent) continue;
		const sa = task.assignedSubagent;

		// Mutation capability must have scope constraints
		if (sa.capability === "mutation" && sa.scopeConstraints.length === 0) {
			issues.push({
				code: "MUTATION_CAPABILITY_UNJUSTIFIED", severity: "error",
				message: ERROR_MESSAGES.MUTATION_CAPABILITY_UNJUSTIFIED(task.id, sa.role),
				path: `tasks[${task.id}].assignedSubagent`,
			});
		}

		// Check scope containment
		for (const scope of sa.scopeConstraints) {
			const contained = envelope.pathScope.some((parent) => isGlobSubset(scope, parent));
			if (!contained) {
				issues.push({
					code: "SUBAGENT_SCOPE_EXCEEDS_ENVELOPE", severity: "error",
					message: ERROR_MESSAGES.SUBAGENT_SCOPE_EXCEEDS_ENVELOPE(task.id, scope),
					path: `tasks[${task.id}].assignedSubagent.scopeConstraints`,
				});
			}
		}
	}

	return issues;
}
