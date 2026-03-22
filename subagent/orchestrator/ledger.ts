import type { LedgerEntry, PhaseType, StepStatus } from "./types.js";

export interface CommitResult {
	filesModified: string[];
	filesCreated: string[];
	linesChanged: number;
	auditNote: string;
}

export interface SerializedLedger {
	entries: LedgerEntry[];
	retryCounters: Record<string, number>;
}

export class StepLedger {
	private entries: LedgerEntry[];
	private retryCounters: Record<string, number>;

	constructor(entries: LedgerEntry[] = [], retryCounters: Record<string, number> = {}) {
		this.entries = [...entries];
		this.retryCounters = { ...retryCounters };
	}

	beginStep(taskId: string, phaseRef: string, phaseType: PhaseType, action: string): boolean {
		// Return false if taskId already committed
		if (this.isCommitted(taskId)) {
			return false;
		}
		// Return false if another step is already in_progress
		if (this.getPending() !== null) {
			return false;
		}

		const retryCount = this.getRetryCount(taskId);
		const entry: LedgerEntry = {
			stepId: `step-${taskId}-${retryCount}`,
			taskId,
			phaseRef,
			phaseType,
			status: "in_progress",
			action,
			filesModified: [],
			filesCreated: [],
			linesChanged: 0,
			startedAt: new Date().toISOString(),
			committedAt: null,
			retryCount,
			error: null,
			auditNote: "",
		};

		this.entries.push(entry);
		return true;
	}

	commitStep(taskId: string, result: CommitResult): boolean {
		const entry = this.findInProgress(taskId);
		if (!entry) {
			return false;
		}

		entry.status = "committed";
		entry.committedAt = new Date().toISOString();
		entry.filesModified = result.filesModified;
		entry.filesCreated = result.filesCreated;
		entry.linesChanged = result.linesChanged;
		entry.auditNote = result.auditNote;
		return true;
	}

	failStep(taskId: string, error: string): boolean {
		const entry = this.findInProgress(taskId);
		if (!entry) {
			return false;
		}

		entry.status = "failed";
		entry.error = error;
		return true;
	}

	skipStep(taskId: string, reason: string): boolean {
		const entry = this.findInProgress(taskId);
		if (!entry) {
			return false;
		}

		entry.status = "skipped";
		entry.auditNote = reason;
		return true;
	}

	isCommitted(taskId: string): boolean {
		return this.entries.some((e) => e.taskId === taskId && e.status === "committed");
	}

	isInProgress(taskId: string): boolean {
		return this.entries.some((e) => e.taskId === taskId && e.status === "in_progress");
	}

	getPending(): LedgerEntry | null {
		return this.entries.find((e) => e.status === "in_progress") ?? null;
	}

	getCommitted(): ReadonlyArray<LedgerEntry> {
		return this.entries.filter((e) => e.status === "committed");
	}

	getRetryCount(taskId: string): number {
		return this.retryCounters[taskId] ?? 0;
	}

	incrementRetry(taskId: string): number {
		const current = this.getRetryCount(taskId);
		this.retryCounters[taskId] = current + 1;
		return current + 1;
	}

	serialize(): SerializedLedger {
		return {
			entries: this.entries.map((e) => ({ ...e })),
			retryCounters: { ...this.retryCounters },
		};
	}

	static deserialize(data: SerializedLedger, opts?: { recover?: boolean }): StepLedger {
		const recover = opts?.recover ?? true;
		let entries = data.entries.map((e) => ({ ...e }));

		if (recover) {
			entries = entries.map((e) => {
				if (e.status === "in_progress") {
					return { ...e, status: "pending" as StepStatus };
				}
				return e;
			});
		}

		return new StepLedger(entries, data.retryCounters);
	}

	private findInProgress(taskId: string): LedgerEntry | undefined {
		return this.entries.find((e) => e.taskId === taskId && e.status === "in_progress");
	}
}
