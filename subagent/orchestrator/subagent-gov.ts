import type {
	SubagentRuntimeBinding,
	CapabilityClass,
	SubagentCapability,
	PlanTask,
	PlanPhase,
	ExecutionEnvelope,
} from "./types.js";

/**
 * Check if a file path falls within any of the given scope patterns.
 * Uses simple prefix matching consistent with the envelope module.
 */
function isPathInSubagentScope(filePath: string, pathScope: string[]): boolean {
	for (const pattern of pathScope) {
		if (pattern === "**" || pattern === "**/*") return true;
		if (filePath === pattern) return true;
		const prefix = pattern.replace(/\/?\*.*$/, "");
		if (prefix && filePath.startsWith(prefix)) return true;
	}
	return false;
}

/**
 * Map a planner-level SubagentCapability to an orchestrator-level CapabilityClass.
 *
 * - "read-only"  → "read-only"
 * - "execution"  → "execution"
 * - "mutation"   → "mutation-capable"
 */
export function mapCapability(cap: SubagentCapability): CapabilityClass {
	switch (cap) {
		case "read-only":
			return "read-only";
		case "execution":
			return "execution";
		case "mutation":
			return "mutation-capable";
		default:
			return "read-only";
	}
}

/**
 * Create a SubagentRuntimeBinding from a task's assignedSubagent field.
 * Returns null if the task has no subagent assignment.
 */
export function bindSubagent(
	task: PlanTask,
	envelope: ExecutionEnvelope,
	phase: PlanPhase,
): SubagentRuntimeBinding | null {
	if (!task.assignedSubagent) {
		return null;
	}

	const { role, capability, scopeConstraints } = task.assignedSubagent;
	const capabilityClass = mapCapability(capability);
	const pathScope =
		scopeConstraints && scopeConstraints.length > 0 ? scopeConstraints : envelope.pathScope;

	return {
		taskId: task.id,
		role,
		capabilityClass,
		pathScope,
		allowedTools: envelope.allowedTools,
		mutationRights: capabilityClass === "mutation-capable",
		stepBudget: 10,
		stepsUsed: 0,
		phaseRef: phase.name,
	};
}

/**
 * Validate whether an action is permitted given a subagent's runtime binding.
 * Returns { allowed: true } or { allowed: false, reason: string }.
 */
export function validateSubagentAction(
	binding: SubagentRuntimeBinding,
	action: { type: "read" | "write" | "execute" | "delete"; targetPath?: string; tool?: string },
): { allowed: boolean; reason?: string } {
	// Tool check applies to all capability classes
	if (action.tool && !binding.allowedTools.includes(action.tool)) {
		return { allowed: false, reason: `Tool "${action.tool}" is not in allowed tools` };
	}

	switch (binding.capabilityClass) {
		case "read-only": {
			if (action.type !== "read") {
				return {
					allowed: false,
					reason: `Read-only binding does not permit "${action.type}" actions`,
				};
			}
			return { allowed: true };
		}

		case "execution": {
			if (action.type === "read" || action.type === "execute") {
				return { allowed: true };
			}
			return {
				allowed: false,
				reason: `Execution binding does not permit "${action.type}" actions`,
			};
		}

		case "mutation-capable": {
			if (action.type === "read" || action.type === "execute") {
				return { allowed: true };
			}
			// For write/delete, check path scope
			if (action.type === "write" || action.type === "delete") {
				if (!action.targetPath) {
					return { allowed: false, reason: "Mutation action requires a targetPath" };
				}
				if (!isPathInSubagentScope(action.targetPath, binding.pathScope)) {
					return {
						allowed: false,
						reason: `Path "${action.targetPath}" is outside the subagent's scope`,
					};
				}
				return { allowed: true };
			}
			return { allowed: true };
		}

		default:
			return { allowed: false, reason: "Unknown capability class" };
	}
}

/**
 * Check whether a subagent's step budget is exhausted.
 */
export function isSubagentBudgetExhausted(binding: SubagentRuntimeBinding): boolean {
	return binding.stepsUsed >= binding.stepBudget;
}
