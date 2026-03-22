import type { ChangeBudget, BudgetSnapshot } from "./types.js";

export class BudgetTracker {
	private filesModified: Set<string>;
	private filesCreated: string[];
	private totalLinesChanged: number;
	private budget: ChangeBudget;

	constructor(budget: ChangeBudget) {
		this.filesModified = new Set();
		this.filesCreated = [];
		this.totalLinesChanged = 0;
		this.budget = { ...budget };
	}

	recordModification(filePath: string, linesChanged: number): void {
		this.filesModified.add(filePath);
		this.totalLinesChanged += linesChanged;
	}

	recordCreation(filePath: string, linesChanged: number): void {
		this.filesCreated.push(filePath);
		this.totalLinesChanged += linesChanged;
	}

	isExceeded(): { exceeded: boolean; dimensions: string[] } {
		const dimensions: string[] = [];
		if (this.filesModified.size > this.budget.maxFilesModified) {
			dimensions.push("filesModified");
		}
		if (this.filesCreated.length > this.budget.maxFilesCreated) {
			dimensions.push("filesCreated");
		}
		if (this.totalLinesChanged > this.budget.maxLinesChanged) {
			dimensions.push("linesChanged");
		}
		return { exceeded: dimensions.length > 0, dimensions };
	}

	isNearThreshold(threshold = 0.8): { near: boolean; dimensions: string[] } {
		const dimensions: string[] = [];
		if (this.budget.maxFilesModified > 0 && this.filesModified.size / this.budget.maxFilesModified > threshold) {
			dimensions.push("filesModified");
		}
		if (this.budget.maxFilesCreated > 0 && this.filesCreated.length / this.budget.maxFilesCreated > threshold) {
			dimensions.push("filesCreated");
		}
		if (this.budget.maxLinesChanged > 0 && this.totalLinesChanged / this.budget.maxLinesChanged > threshold) {
			dimensions.push("linesChanged");
		}
		return { near: dimensions.length > 0, dimensions };
	}

	getUsage(): {
		filesModified: { used: number; budget: number; fraction: number };
		filesCreated: { used: number; budget: number; fraction: number };
		linesChanged: { used: number; budget: number; fraction: number };
	} {
		const safeFraction = (used: number, budget: number): number =>
			budget > 0 ? used / budget : 0;

		return {
			filesModified: {
				used: this.filesModified.size,
				budget: this.budget.maxFilesModified,
				fraction: safeFraction(this.filesModified.size, this.budget.maxFilesModified),
			},
			filesCreated: {
				used: this.filesCreated.length,
				budget: this.budget.maxFilesCreated,
				fraction: safeFraction(this.filesCreated.length, this.budget.maxFilesCreated),
			},
			linesChanged: {
				used: this.totalLinesChanged,
				budget: this.budget.maxLinesChanged,
				fraction: safeFraction(this.totalLinesChanged, this.budget.maxLinesChanged),
			},
		};
	}

	serialize(): BudgetSnapshot {
		return {
			filesModified: Array.from(this.filesModified),
			filesCreated: [...this.filesCreated],
			totalLinesChanged: this.totalLinesChanged,
			budget: { ...this.budget },
		};
	}

	static deserialize(snapshot: BudgetSnapshot): BudgetTracker {
		const tracker = new BudgetTracker(snapshot.budget);
		tracker.filesModified = new Set(snapshot.filesModified);
		tracker.filesCreated = [...snapshot.filesCreated];
		tracker.totalLinesChanged = snapshot.totalLinesChanged;
		return tracker;
	}
}
