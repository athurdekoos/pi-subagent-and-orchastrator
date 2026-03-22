import { describe, it, expect, vi, beforeEach } from "vitest";
import { StepLedger } from "../ledger.js";
import type { LedgerEntry } from "../types.js";

describe("StepLedger", () => {
	let ledger: StepLedger;

	beforeEach(() => {
		ledger = new StepLedger();
	});

	it("starts empty (no entries)", () => {
		expect(ledger.getPending()).toBeNull();
		expect(ledger.getCommitted()).toEqual([]);
	});

	it("beginStep creates an in_progress entry", () => {
		const result = ledger.beginStep("task-1", "phase-1", "red", "write test");
		expect(result).toBe(true);
		const pending = ledger.getPending();
		expect(pending).not.toBeNull();
		expect(pending!.taskId).toBe("task-1");
		expect(pending!.phaseRef).toBe("phase-1");
		expect(pending!.phaseType).toBe("red");
		expect(pending!.action).toBe("write test");
		expect(pending!.status).toBe("in_progress");
		expect(pending!.startedAt).toBeTruthy();
	});

	it("beginStep returns false if task already committed", () => {
		ledger.beginStep("task-1", "phase-1", "red", "write test");
		ledger.commitStep("task-1", {
			filesModified: [],
			filesCreated: [],
			linesChanged: 0,
			auditNote: "done",
		});
		const result = ledger.beginStep("task-1", "phase-1", "red", "retry");
		expect(result).toBe(false);
	});

	it("beginStep returns false if another step is already in_progress", () => {
		ledger.beginStep("task-1", "phase-1", "red", "write test");
		const result = ledger.beginStep("task-2", "phase-1", "green", "implement");
		expect(result).toBe(false);
	});

	it("commitStep transitions in_progress to committed", () => {
		ledger.beginStep("task-1", "phase-1", "red", "write test");
		const result = ledger.commitStep("task-1", {
			filesModified: ["a.ts"],
			filesCreated: ["b.ts"],
			linesChanged: 42,
			auditNote: "added test",
		});
		expect(result).toBe(true);
		expect(ledger.isCommitted("task-1")).toBe(true);
		expect(ledger.getPending()).toBeNull();
	});

	it("commitStep returns false if step is not in_progress", () => {
		const result = ledger.commitStep("task-1", {
			filesModified: [],
			filesCreated: [],
			linesChanged: 0,
			auditNote: "",
		});
		expect(result).toBe(false);
	});

	it("commitStep records filesModified, filesCreated, linesChanged, auditNote", () => {
		ledger.beginStep("task-1", "phase-1", "red", "write test");
		ledger.commitStep("task-1", {
			filesModified: ["src/a.ts", "src/b.ts"],
			filesCreated: ["src/c.ts"],
			linesChanged: 100,
			auditNote: "implemented feature",
		});
		const committed = ledger.getCommitted();
		expect(committed).toHaveLength(1);
		expect(committed[0].filesModified).toEqual(["src/a.ts", "src/b.ts"]);
		expect(committed[0].filesCreated).toEqual(["src/c.ts"]);
		expect(committed[0].linesChanged).toBe(100);
		expect(committed[0].auditNote).toBe("implemented feature");
	});

	it("commitStep sets committedAt timestamp", () => {
		ledger.beginStep("task-1", "phase-1", "red", "write test");
		ledger.commitStep("task-1", {
			filesModified: [],
			filesCreated: [],
			linesChanged: 0,
			auditNote: "",
		});
		const committed = ledger.getCommitted();
		expect(committed[0].committedAt).toBeTruthy();
		expect(typeof committed[0].committedAt).toBe("string");
	});

	it("failStep marks step as failed with error message", () => {
		ledger.beginStep("task-1", "phase-1", "red", "write test");
		const result = ledger.failStep("task-1", "compilation error");
		expect(result).toBe(true);
		expect(ledger.getPending()).toBeNull();
		expect(ledger.isCommitted("task-1")).toBe(false);
	});

	it("failStep returns false if step not in_progress", () => {
		const result = ledger.failStep("task-1", "some error");
		expect(result).toBe(false);
	});

	it("skipStep marks step as skipped with reason", () => {
		ledger.beginStep("task-1", "phase-1", "red", "write test");
		const result = ledger.skipStep("task-1", "not needed");
		expect(result).toBe(true);
		expect(ledger.getPending()).toBeNull();
		expect(ledger.isCommitted("task-1")).toBe(false);
	});

	it("isCommitted returns true only for committed steps", () => {
		ledger.beginStep("task-1", "phase-1", "red", "write test");
		ledger.commitStep("task-1", {
			filesModified: [],
			filesCreated: [],
			linesChanged: 0,
			auditNote: "",
		});
		expect(ledger.isCommitted("task-1")).toBe(true);
	});

	it("isCommitted returns false for failed/skipped/pending steps", () => {
		expect(ledger.isCommitted("task-x")).toBe(false);

		ledger.beginStep("task-2", "phase-1", "red", "test");
		ledger.failStep("task-2", "err");
		expect(ledger.isCommitted("task-2")).toBe(false);

		// Need a new ledger for skipped since previous has a failed entry
		const ledger2 = new StepLedger();
		ledger2.beginStep("task-3", "phase-1", "green", "impl");
		ledger2.skipStep("task-3", "reason");
		expect(ledger2.isCommitted("task-3")).toBe(false);
	});

	it("getPending returns the in_progress entry", () => {
		ledger.beginStep("task-1", "phase-1", "red", "write test");
		const pending = ledger.getPending();
		expect(pending).not.toBeNull();
		expect(pending!.taskId).toBe("task-1");
		expect(pending!.status).toBe("in_progress");
	});

	it("getPending returns null when nothing in progress", () => {
		expect(ledger.getPending()).toBeNull();
	});

	it("getRetryCount returns 0 for new tasks", () => {
		expect(ledger.getRetryCount("task-1")).toBe(0);
	});

	it("incrementRetry increments and returns new count", () => {
		expect(ledger.incrementRetry("task-1")).toBe(1);
		expect(ledger.incrementRetry("task-1")).toBe(2);
		expect(ledger.getRetryCount("task-1")).toBe(2);
	});

	it("serialize and deserialize roundtrip preserves all entries", () => {
		ledger.beginStep("task-1", "phase-1", "red", "write test");
		ledger.commitStep("task-1", {
			filesModified: ["a.ts"],
			filesCreated: [],
			linesChanged: 10,
			auditNote: "done",
		});
		ledger.incrementRetry("task-2");

		const data = ledger.serialize();
		const restored = StepLedger.deserialize(data, { recover: false });

		expect(restored.getCommitted()).toHaveLength(1);
		expect(restored.getCommitted()[0].taskId).toBe("task-1");
		expect(restored.getRetryCount("task-2")).toBe(1);
	});

	it("deserialize with recovery: in_progress entries revert to pending", () => {
		ledger.beginStep("task-1", "phase-1", "red", "write test");
		// Simulate crash: serialize while in_progress
		const data = ledger.serialize();
		expect(data.entries[0].status).toBe("in_progress");

		const restored = StepLedger.deserialize(data, { recover: true });
		// Should have reverted to pending, so getPending returns null (pending != in_progress)
		expect(restored.getPending()).toBeNull();
		// The entry should exist but as pending, so not committed either
		expect(restored.isCommitted("task-1")).toBe(false);
	});
});
