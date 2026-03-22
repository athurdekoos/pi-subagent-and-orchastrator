import type { PolicyDecision, PolicyContext, ApprovalScope } from "./types.js";

/**
 * Risk trigger definitions mapping context flags to human-readable trigger strings.
 */
const RISK_TRIGGER_MAP: ReadonlyArray<{
	key: keyof PolicyContext;
	trigger: string;
}> = [
	{ key: "isDelete", trigger: "delete operation" },
	{ key: "isRename", trigger: "rename/move operation" },
	{ key: "isBulkEdit", trigger: "bulk edit exceeds threshold" },
	{ key: "isEditAfterGreen", trigger: "edit after green phase" },
	{ key: "isScopeExpansion", trigger: "scope expansion beyond envelope" },
	{ key: "isHighImpactFile", trigger: "high-impact file modification" },
	{
		key: "isFirstWriteOutsidePlanScope",
		trigger: "first write outside plan scope",
	},
	{ key: "isBudgetNearThreshold", trigger: "budget near threshold" },
];

/** Auto-allow context keys (checked before risk triggers). */
const AUTO_ALLOW_KEYS: ReadonlyArray<keyof PolicyContext> = [
	"isReadOnly",
	"isTestExecution",
	"isLinterExecution",
	"isShowboatGeneration",
	"isTestFileWriteInRedPhase",
];

/**
 * Evaluate policy for an action, returning whether it's auto-allowed or requires approval.
 */
export function evaluatePolicy(context: PolicyContext): PolicyDecision {
	// Collect risk triggers first — needed to evaluate isInScopeMutation.
	const triggers: string[] = [];
	for (const { key, trigger } of RISK_TRIGGER_MAP) {
		if (context[key]) {
			triggers.push(trigger);
		}
	}

	// Check unconditional auto-allow conditions.
	for (const key of AUTO_ALLOW_KEYS) {
		if (context[key]) {
			return { riskLevel: "auto", triggers: [], scope: "phase" };
		}
	}

	// isInScopeMutation is auto-allow only when no risk triggers are active.
	if (context.isInScopeMutation && triggers.length === 0) {
		return { riskLevel: "auto", triggers: [], scope: "phase" };
	}

	// If any triggers, require approval.
	if (triggers.length > 0) {
		const scope: ApprovalScope =
			context.isDelete || context.isRename ? "action" : "phase";
		return { riskLevel: "approval_required", triggers, scope };
	}

	// Default: auto-allow.
	return { riskLevel: "auto", triggers: [], scope: "phase" };
}

/** Create a default PolicyContext with all flags false. */
export function defaultPolicyContext(): PolicyContext {
	return {
		isFirstWriteOutsidePlanScope: false,
		isDelete: false,
		isRename: false,
		isBulkEdit: false,
		isEditAfterGreen: false,
		isScopeExpansion: false,
		isHighImpactFile: false,
		isBudgetNearThreshold: false,
		isReadOnly: false,
		isTestExecution: false,
		isLinterExecution: false,
		isShowboatGeneration: false,
		isTestFileWriteInRedPhase: false,
		isInScopeMutation: false,
	};
}
