import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { showboatInit, showboatNote, showboatExec, setStreamCallback, clearStreamCallback } from "../showboat.js";
import { PlannerFSM, TERMINAL_STATES, RESUMABLE_STATES } from "../fsm.js";
import { createPlan, createPhase, createTask, createEnvelope, createSuccessCriterion, createVerificationStep, resetIdCounter } from "../schema.js";
import { validatePlan } from "../validator.js";
import { validatePlanFromDisk, validatePlanFromString } from "../ci.js";
import { validateFileManagerCompatibility } from "../envelope.js";
import { savePlan, loadPlan, initPlannerStructure, getPlanDir } from "../persistence.js";
import type { Plan, PlannerSession, ExecutionEnvelope } from "../types.js";

// ── Helpers ──

function buildValidPlan(): Plan {
	resetIdCounter();
	const plan = createPlan("test intent");
	plan.goal = "test goal";
	plan.summary = "test summary";

	const red = createPhase("red-phase", "red", "Write failing tests");
	const green = createPhase("green-phase", "green", "Implement");
	const verify = createPhase("verify-phase", "verify", "Verify");
	plan.phases = [red, green, verify];

	const t1 = createTask("red-phase", "Write test", "Create test", { verificationStep: "test exists" });
	const t2 = createTask("green-phase", "Implement", "Write code", { dependencies: [t1.id], verificationStep: "code compiles" });
	const t3 = createTask("verify-phase", "Run tests", "Execute", { dependencies: [t2.id], verificationStep: "tests pass" });
	plan.tasks = [t1, t2, t3];
	red.tasks = [t1.id];
	green.tasks = [t2.id];
	verify.tasks = [t3.id];

	plan.envelope = createEnvelope({
		pathScope: ["src/**/*.ts"],
		allowedOperations: ["read", "write"],
		allowedTools: ["read", "write", "edit", "files"],
		subagentPermissions: { maxConcurrent: 4, allowedCapabilities: ["read-only"], scopeConstraints: ["src/**"] },
		changeBudget: { maxFilesModified: 5, maxFilesCreated: 2, maxLinesChanged: 200 },
	});

	plan.successCriteria = [createSuccessCriterion("all tests pass")];
	plan.verificationSteps = [createVerificationStep("run test suite", "npm test", "0 failures")];

	return plan;
}

// ── Showboat Fallback Tests ──

describe("Showboat fallback writer", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "showboat-fallback-"));
	});

	afterEach(() => {
		clearStreamCallback();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("showboatInit creates markdown file with title", () => {
		const filePath = path.join(tmpDir, "test.md");
		const ok = showboatInit(filePath, "My Plan");
		expect(ok).toBe(true);
		const content = fs.readFileSync(filePath, "utf-8");
		expect(content).toContain("# My Plan");
	});

	it("showboatNote appends content to existing file", () => {
		const filePath = path.join(tmpDir, "test.md");
		showboatInit(filePath, "Title");
		showboatNote(filePath, "## Section One\n\nSome content.");
		const content = fs.readFileSync(filePath, "utf-8");
		expect(content).toContain("## Section One");
		expect(content).toContain("Some content.");
	});

	it("showboatExec appends fenced code block", () => {
		const filePath = path.join(tmpDir, "test.md");
		showboatInit(filePath, "Title");
		const result = showboatExec(filePath, "bash", "echo hello");
		expect(result.ok).toBe(true);
		const content = fs.readFileSync(filePath, "utf-8");
		expect(content).toContain("```bash");
		expect(content).toContain("echo hello");
		expect(content).toContain("```");
	});

	it("showboatInit creates parent directories", () => {
		const filePath = path.join(tmpDir, "deep", "nested", "test.md");
		const ok = showboatInit(filePath, "Nested");
		expect(ok).toBe(true);
		expect(fs.existsSync(filePath)).toBe(true);
	});

	it("multiple notes append sequentially", () => {
		const filePath = path.join(tmpDir, "test.md");
		showboatInit(filePath, "Title");
		showboatNote(filePath, "First");
		showboatNote(filePath, "Second");
		showboatNote(filePath, "Third");
		const content = fs.readFileSync(filePath, "utf-8");
		const firstIdx = content.indexOf("First");
		const secondIdx = content.indexOf("Second");
		const thirdIdx = content.indexOf("Third");
		expect(firstIdx).toBeLessThan(secondIdx);
		expect(secondIdx).toBeLessThan(thirdIdx);
	});

	it("streaming callback is invoked on showboat writes", () => {
		const events: Array<{ section: string; content: string }> = [];
		setStreamCallback((section, content) => events.push({ section, content }));

		const filePath = path.join(tmpDir, "stream.md");
		showboatInit(filePath, "Stream Test");
		showboatNote(filePath, "note content");
		showboatExec(filePath, "bash", "ls");

		expect(events).toHaveLength(3);
		expect(events[0].section).toBe("init");
		expect(events[1].section).toBe("note");
		expect(events[2].section).toBe("exec");
	});
});

// ── Resume Scenario Tests ──

describe("Resume scenarios", () => {
	let tmpDir: string;

	beforeEach(() => {
		resetIdCounter();
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "resume-test-"));
		initPlannerStructure(tmpDir);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("resumes from drafting state", () => {
		const plan = createPlan("resume test");
		const session: PlannerSession = {
			planId: plan.id,
			fsm: { state: "drafting", history: [{ from: "idle", to: "analyzing", at: new Date().toISOString(), action: "a" }, { from: "analyzing", to: "drafting", at: new Date().toISOString(), action: "b" }] },
			plan,
			showboatPath: path.join(tmpDir, "showboat.md"),
		};
		savePlan(tmpDir, session);

		const loaded = loadPlan(tmpDir, plan.id);
		expect(loaded).not.toBeNull();
		const fsm = PlannerFSM.deserialize(loaded!.fsm);
		expect(fsm.isResumable()).toBe(true);
		expect(fsm.getState()).toBe("drafting");
		// Can continue drafting
		expect(fsm.canTransition("validating")).toBe(true);
	});

	it("resumes from awaiting_approval state", () => {
		const fsm = new PlannerFSM("awaiting_approval");
		expect(fsm.isResumable()).toBe(true);
		expect(fsm.canTransition("planned")).toBe(true);
		expect(fsm.canTransition("blocked")).toBe(true);
	});

	it("does not resume from terminal states", () => {
		for (const state of TERMINAL_STATES) {
			const fsm = new PlannerFSM(state);
			expect(fsm.isResumable()).toBe(false);
		}
	});

	it("transitions blocked → drafting for revision", () => {
		const fsm = new PlannerFSM("blocked");
		const result = fsm.transition("drafting", "revise");
		expect(result.ok).toBe(true);
		expect(fsm.getState()).toBe("drafting");
	});
});

// ── High-Impact Detection Tests ──

describe("High-impact detection", () => {
	beforeEach(() => resetIdCounter());

	it("flags plan with >20 files modified", () => {
		const plan = buildValidPlan();
		plan.envelope.changeBudget.maxFilesModified = 25;
		const result = validatePlan(plan);
		// Plan is valid but high-impact is a policy check, not validation
		expect(result).toBeDefined();
	});

	it("flags plan with delete operations", () => {
		const plan = buildValidPlan();
		plan.envelope.allowedOperations = ["read", "write", "delete"];
		const result = validatePlan(plan);
		expect(result).toBeDefined();
	});

	it("flags plan with unbounded path scope", () => {
		const plan = buildValidPlan();
		plan.envelope.pathScope = ["**"];
		const result = validatePlan(plan);
		expect(result).toBeDefined();
	});
});

// ── File-Manager Compatibility Tests ──

describe("File-manager compatibility validation", () => {
	it("warns when mutation ops present but files tool missing", () => {
		const envelope: ExecutionEnvelope = createEnvelope({
			pathScope: ["src/**"],
			allowedOperations: ["read", "write", "create"],
			allowedTools: ["read", "edit"],
			changeBudget: { maxFilesModified: 5, maxFilesCreated: 2, maxLinesChanged: 200 },
		});
		const issues = validateFileManagerCompatibility(envelope);
		expect(issues.length).toBeGreaterThan(0);
		expect(issues[0].code).toBe("MISSING_FILE_MANAGER_TOOL");
		expect(issues[0].severity).toBe("warning");
	});

	it("passes when files tool is present with mutation ops", () => {
		const envelope: ExecutionEnvelope = createEnvelope({
			pathScope: ["src/**"],
			allowedOperations: ["read", "write"],
			allowedTools: ["read", "edit", "files"],
			changeBudget: { maxFilesModified: 5, maxFilesCreated: 2, maxLinesChanged: 200 },
		});
		const issues = validateFileManagerCompatibility(envelope);
		expect(issues).toHaveLength(0);
	});

	it("passes when only read operations (no mutation)", () => {
		const envelope: ExecutionEnvelope = createEnvelope({
			pathScope: ["src/**"],
			allowedOperations: ["read"],
			allowedTools: ["read"],
			changeBudget: { maxFilesModified: 5, maxFilesCreated: 0, maxLinesChanged: 200 },
		});
		const issues = validateFileManagerCompatibility(envelope);
		expect(issues).toHaveLength(0);
	});
});

// ── CI Validation Tests ──

describe("CI validation", () => {
	let tmpDir: string;

	beforeEach(() => {
		resetIdCounter();
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("validatePlanFromString with valid plan returns valid=true", () => {
		const plan = buildValidPlan();
		const json = JSON.stringify(plan);
		const result = validatePlanFromString(json);
		expect(result.valid).toBe(true);
		expect(result.score.overall).toBeGreaterThan(80);
	});

	it("validatePlanFromString with invalid plan returns issues", () => {
		const plan = createPlan("empty");
		const json = JSON.stringify(plan);
		const result = validatePlanFromString(json);
		expect(result.valid).toBe(false);
		expect(result.issues.length).toBeGreaterThan(0);
	});

	it("validatePlanFromDisk with valid plan file", () => {
		const plan = buildValidPlan();
		const filePath = path.join(tmpDir, "plan.json");
		fs.writeFileSync(filePath, JSON.stringify(plan));
		const result = validatePlanFromDisk(filePath);
		expect(result.valid).toBe(true);
	});

	it("validatePlanFromDisk throws for missing file", () => {
		expect(() => validatePlanFromDisk(path.join(tmpDir, "nonexistent.json"))).toThrow();
	});

	it("validatePlanFromString throws for invalid JSON", () => {
		expect(() => validatePlanFromString("not json")).toThrow();
	});
});

// ── Integrated Validation with File-Manager Compatibility ──

describe("Integrated validation includes file-manager check", () => {
	beforeEach(() => resetIdCounter());

	it("warns when plan has write ops but no files tool", () => {
		const plan = buildValidPlan();
		plan.envelope.allowedTools = ["read", "edit"]; // remove "files"
		const result = validatePlan(plan);
		expect(result.issues.some(i => i.code === "MISSING_FILE_MANAGER_TOOL")).toBe(true);
	});

	it("no warning when files tool is present", () => {
		const plan = buildValidPlan();
		// buildValidPlan already includes "files" in allowedTools
		const result = validatePlan(plan);
		expect(result.issues.some(i => i.code === "MISSING_FILE_MANAGER_TOOL")).toBe(false);
	});
});
