import { describe, it, expect } from "vitest";
import {
	evaluatePolicy,
	defaultPolicyContext,
} from "../policy.js";

describe("evaluatePolicy", () => {
	// ── Auto-allow conditions ──

	it("auto-allows when isReadOnly is true", () => {
		const result = evaluatePolicy({
			...defaultPolicyContext(),
			isReadOnly: true,
		});
		expect(result.riskLevel).toBe("auto");
		expect(result.triggers).toEqual([]);
		expect(result.scope).toBe("phase");
	});

	it("auto-allows when isTestExecution is true", () => {
		const result = evaluatePolicy({
			...defaultPolicyContext(),
			isTestExecution: true,
		});
		expect(result.riskLevel).toBe("auto");
		expect(result.triggers).toEqual([]);
		expect(result.scope).toBe("phase");
	});

	it("auto-allows when isLinterExecution is true", () => {
		const result = evaluatePolicy({
			...defaultPolicyContext(),
			isLinterExecution: true,
		});
		expect(result.riskLevel).toBe("auto");
		expect(result.triggers).toEqual([]);
		expect(result.scope).toBe("phase");
	});

	it("auto-allows when isTestFileWriteInRedPhase is true", () => {
		const result = evaluatePolicy({
			...defaultPolicyContext(),
			isTestFileWriteInRedPhase: true,
		});
		expect(result.riskLevel).toBe("auto");
		expect(result.triggers).toEqual([]);
		expect(result.scope).toBe("phase");
	});

	it("auto-allows when isInScopeMutation is true and no risk triggers", () => {
		const result = evaluatePolicy({
			...defaultPolicyContext(),
			isInScopeMutation: true,
		});
		expect(result.riskLevel).toBe("auto");
		expect(result.triggers).toEqual([]);
		expect(result.scope).toBe("phase");
	});

	it("auto-allows when isShowboatGeneration is true", () => {
		const result = evaluatePolicy({
			...defaultPolicyContext(),
			isShowboatGeneration: true,
		});
		expect(result.riskLevel).toBe("auto");
		expect(result.triggers).toEqual([]);
		expect(result.scope).toBe("phase");
	});

	// ── Risk triggers requiring approval ──

	it("requires approval when isDelete is true", () => {
		const result = evaluatePolicy({
			...defaultPolicyContext(),
			isDelete: true,
		});
		expect(result.riskLevel).toBe("approval_required");
		expect(result.triggers).toContain("delete operation");
	});

	it("requires approval when isRename is true", () => {
		const result = evaluatePolicy({
			...defaultPolicyContext(),
			isRename: true,
		});
		expect(result.riskLevel).toBe("approval_required");
		expect(result.triggers).toContain("rename/move operation");
	});

	it("requires approval when isBulkEdit is true", () => {
		const result = evaluatePolicy({
			...defaultPolicyContext(),
			isBulkEdit: true,
		});
		expect(result.riskLevel).toBe("approval_required");
		expect(result.triggers).toContain("bulk edit exceeds threshold");
	});

	it("requires approval when isEditAfterGreen is true", () => {
		const result = evaluatePolicy({
			...defaultPolicyContext(),
			isEditAfterGreen: true,
		});
		expect(result.riskLevel).toBe("approval_required");
		expect(result.triggers).toContain("edit after green phase");
	});

	it("requires approval when isScopeExpansion is true", () => {
		const result = evaluatePolicy({
			...defaultPolicyContext(),
			isScopeExpansion: true,
		});
		expect(result.riskLevel).toBe("approval_required");
		expect(result.triggers).toContain("scope expansion beyond envelope");
	});

	it("requires approval when isHighImpactFile is true", () => {
		const result = evaluatePolicy({
			...defaultPolicyContext(),
			isHighImpactFile: true,
		});
		expect(result.riskLevel).toBe("approval_required");
		expect(result.triggers).toContain("high-impact file modification");
	});

	it("requires approval when isFirstWriteOutsidePlanScope is true", () => {
		const result = evaluatePolicy({
			...defaultPolicyContext(),
			isFirstWriteOutsidePlanScope: true,
		});
		expect(result.riskLevel).toBe("approval_required");
		expect(result.triggers).toContain("first write outside plan scope");
	});

	it("requires approval when isBudgetNearThreshold is true", () => {
		const result = evaluatePolicy({
			...defaultPolicyContext(),
			isBudgetNearThreshold: true,
		});
		expect(result.riskLevel).toBe("approval_required");
		expect(result.triggers).toContain("budget near threshold");
	});

	// ── Scope determination ──

	it("returns per-phase scope by default for approval", () => {
		const result = evaluatePolicy({
			...defaultPolicyContext(),
			isBulkEdit: true,
		});
		expect(result.riskLevel).toBe("approval_required");
		expect(result.scope).toBe("phase");
	});

	it("escalates to per-action scope for destructive operations (delete, rename)", () => {
		const deleteResult = evaluatePolicy({
			...defaultPolicyContext(),
			isDelete: true,
		});
		expect(deleteResult.scope).toBe("action");

		const renameResult = evaluatePolicy({
			...defaultPolicyContext(),
			isRename: true,
		});
		expect(renameResult.scope).toBe("action");
	});

	// ── Multiple triggers ──

	it("returns multiple triggers when multiple risk conditions are true", () => {
		const result = evaluatePolicy({
			...defaultPolicyContext(),
			isDelete: true,
			isBulkEdit: true,
			isHighImpactFile: true,
		});
		expect(result.riskLevel).toBe("approval_required");
		expect(result.triggers).toHaveLength(3);
		expect(result.triggers).toContain("delete operation");
		expect(result.triggers).toContain("bulk edit exceeds threshold");
		expect(result.triggers).toContain("high-impact file modification");
		expect(result.scope).toBe("action");
	});
});
