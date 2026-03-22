import { describe, it, expect } from "vitest";
import { BudgetTracker } from "../budget.js";
import type { ChangeBudget } from "../types.js";

function makeBudget(overrides: Partial<ChangeBudget> = {}): ChangeBudget {
	return {
		maxFilesModified: 10,
		maxFilesCreated: 5,
		maxLinesChanged: 500,
		...overrides,
	};
}

describe("BudgetTracker", () => {
	it("starts with zero usage", () => {
		const tracker = new BudgetTracker(makeBudget());
		const usage = tracker.getUsage();
		expect(usage.filesModified.used).toBe(0);
		expect(usage.filesCreated.used).toBe(0);
		expect(usage.linesChanged.used).toBe(0);
	});

	it("recordModification increments filesModified count", () => {
		const tracker = new BudgetTracker(makeBudget());
		tracker.recordModification("src/a.ts", 10);
		tracker.recordModification("src/b.ts", 5);
		const usage = tracker.getUsage();
		expect(usage.filesModified.used).toBe(2);
	});

	it("recordModification deduplicates same file path", () => {
		const tracker = new BudgetTracker(makeBudget());
		tracker.recordModification("src/a.ts", 10);
		tracker.recordModification("src/a.ts", 20);
		const usage = tracker.getUsage();
		expect(usage.filesModified.used).toBe(1);
	});

	it("recordCreation increments filesCreated count", () => {
		const tracker = new BudgetTracker(makeBudget());
		tracker.recordCreation("src/new.ts", 50);
		const usage = tracker.getUsage();
		expect(usage.filesCreated.used).toBe(1);
	});

	it("recordModification accumulates linesChanged", () => {
		const tracker = new BudgetTracker(makeBudget());
		tracker.recordModification("src/a.ts", 10);
		tracker.recordModification("src/a.ts", 20);
		const usage = tracker.getUsage();
		expect(usage.linesChanged.used).toBe(30);
	});

	it("recordCreation also accumulates linesChanged", () => {
		const tracker = new BudgetTracker(makeBudget());
		tracker.recordCreation("src/new.ts", 40);
		tracker.recordModification("src/a.ts", 10);
		const usage = tracker.getUsage();
		expect(usage.linesChanged.used).toBe(50);
	});

	it("isExceeded returns false when within budget", () => {
		const tracker = new BudgetTracker(makeBudget());
		tracker.recordModification("src/a.ts", 10);
		const result = tracker.isExceeded();
		expect(result.exceeded).toBe(false);
		expect(result.dimensions).toEqual([]);
	});

	it("isExceeded returns true when filesModified exceeds budget", () => {
		const tracker = new BudgetTracker(makeBudget({ maxFilesModified: 1 }));
		tracker.recordModification("src/a.ts", 1);
		tracker.recordModification("src/b.ts", 1);
		const result = tracker.isExceeded();
		expect(result.exceeded).toBe(true);
		expect(result.dimensions).toContain("filesModified");
	});

	it("isExceeded returns true when filesCreated exceeds budget", () => {
		const tracker = new BudgetTracker(makeBudget({ maxFilesCreated: 1 }));
		tracker.recordCreation("src/a.ts", 10);
		tracker.recordCreation("src/b.ts", 10);
		const result = tracker.isExceeded();
		expect(result.exceeded).toBe(true);
		expect(result.dimensions).toContain("filesCreated");
	});

	it("isExceeded returns true when linesChanged exceeds budget", () => {
		const tracker = new BudgetTracker(makeBudget({ maxLinesChanged: 20 }));
		tracker.recordModification("src/a.ts", 25);
		const result = tracker.isExceeded();
		expect(result.exceeded).toBe(true);
		expect(result.dimensions).toContain("linesChanged");
	});

	it("isExceeded returns which dimensions are exceeded", () => {
		const tracker = new BudgetTracker(
			makeBudget({ maxFilesModified: 1, maxLinesChanged: 10 }),
		);
		tracker.recordModification("src/a.ts", 5);
		tracker.recordModification("src/b.ts", 8);
		const result = tracker.isExceeded();
		expect(result.exceeded).toBe(true);
		expect(result.dimensions).toContain("filesModified");
		expect(result.dimensions).toContain("linesChanged");
		expect(result.dimensions).not.toContain("filesCreated");
	});

	it("isNearThreshold detects >80% usage", () => {
		const tracker = new BudgetTracker(
			makeBudget({ maxFilesModified: 10, maxLinesChanged: 100 }),
		);
		// 9 files = 90% of 10 => near
		for (let i = 0; i < 9; i++) {
			tracker.recordModification(`src/file${i}.ts`, 1);
		}
		const result = tracker.isNearThreshold();
		expect(result.near).toBe(true);
		expect(result.dimensions).toContain("filesModified");
		// linesChanged is 9/100 = 9% => not near
		expect(result.dimensions).not.toContain("linesChanged");
	});

	it("getUsage returns correct fractions", () => {
		const tracker = new BudgetTracker(
			makeBudget({ maxFilesModified: 10, maxFilesCreated: 5, maxLinesChanged: 200 }),
		);
		tracker.recordModification("src/a.ts", 50);
		tracker.recordCreation("src/b.ts", 30);
		const usage = tracker.getUsage();
		expect(usage.filesModified.used).toBe(1);
		expect(usage.filesModified.budget).toBe(10);
		expect(usage.filesModified.fraction).toBeCloseTo(0.1);
		expect(usage.filesCreated.used).toBe(1);
		expect(usage.filesCreated.budget).toBe(5);
		expect(usage.filesCreated.fraction).toBeCloseTo(0.2);
		expect(usage.linesChanged.used).toBe(80);
		expect(usage.linesChanged.budget).toBe(200);
		expect(usage.linesChanged.fraction).toBeCloseTo(0.4);
	});

	it("serialize converts Set to Array and deserialize reconstructs Set behavior", () => {
		const tracker = new BudgetTracker(makeBudget());
		tracker.recordModification("src/a.ts", 10);
		tracker.recordModification("src/b.ts", 20);
		tracker.recordCreation("src/c.ts", 30);

		const snapshot = tracker.serialize();
		expect(Array.isArray(snapshot.filesModified)).toBe(true);
		expect(snapshot.filesModified).toHaveLength(2);
		expect(snapshot.filesModified).toContain("src/a.ts");
		expect(snapshot.filesModified).toContain("src/b.ts");
		expect(snapshot.filesCreated).toEqual(["src/c.ts"]);
		expect(snapshot.totalLinesChanged).toBe(60);

		// Deserialize and verify Set dedup behavior is restored
		const restored = BudgetTracker.deserialize(snapshot);
		restored.recordModification("src/a.ts", 5); // duplicate - should not increase file count
		const usage = restored.getUsage();
		expect(usage.filesModified.used).toBe(2); // still 2, not 3
		expect(usage.linesChanged.used).toBe(65); // 60 + 5
	});
});
