import type { ExecutionEnvelope } from "./types.js";

/**
 * Check if a file path is within the given path scope globs.
 *
 * Uses a simple prefix-matching approach consistent with isGlobSubset
 * in planner/envelope.ts.
 */
export function isPathInScope(filePath: string, pathScope: string[]): boolean {
	if (!filePath || !pathScope || pathScope.length === 0) return false;

	for (const pattern of pathScope) {
		// Universal wildcard matches everything
		if (pattern === "**" || pattern === "**/*") return true;

		// Exact match
		if (filePath === pattern) return true;

		// Extract directory prefix from glob (strip trailing /*... or ** portions)
		const dirPrefix = pattern.replace(/\/?\*.*$/, "");
		if (dirPrefix && filePath.startsWith(dirPrefix + "/")) return true;
		if (dirPrefix && filePath === dirPrefix) return true;
	}

	return false;
}

/**
 * Check if an operation is in the allowed operations list.
 */
export function isOperationAllowed(operation: string, allowedOperations: string[]): boolean {
	if (!operation || !allowedOperations) return false;
	return allowedOperations.includes(operation);
}

/**
 * Check if a tool is in the allowed tools list.
 */
export function isToolAllowed(tool: string, allowedTools: string[]): boolean {
	if (!tool || !allowedTools) return false;
	return allowedTools.includes(tool);
}

/**
 * Compose all envelope checks and return a combined enforcement result.
 */
export function enforceEnvelope(
	envelope: ExecutionEnvelope,
	action: { filePath?: string; operation?: string; tool?: string },
): { allowed: boolean; violations: string[] } {
	const violations: string[] = [];

	if (action.filePath != null) {
		if (!isPathInScope(action.filePath, envelope.pathScope)) {
			violations.push(`Path "${action.filePath}" is outside the allowed scope`);
		}
	}

	if (action.operation != null) {
		if (!isOperationAllowed(action.operation, envelope.allowedOperations)) {
			violations.push(`Operation "${action.operation}" is not allowed`);
		}
	}

	if (action.tool != null) {
		if (!isToolAllowed(action.tool, envelope.allowedTools)) {
			violations.push(`Tool "${action.tool}" is not allowed`);
		}
	}

	return { allowed: violations.length === 0, violations };
}
