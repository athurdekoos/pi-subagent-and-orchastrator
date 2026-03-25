import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	initPlannerStructure, savePlan, loadPlan, getActivePlanId,
	setActivePlanId, listPlans, loadPlannerConfig, PLANNER_CONFIG_DEFAULTS,
	resolvePlannerRoot, getPlanDir,
} from "../persistence.js";
import { createPlan, resetIdCounter } from "../schema.js";
import type { PlannerSession } from "../types.js";

describe("persistence", () => {
	let tmpDir: string;

	beforeEach(() => {
		resetIdCounter();
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "planner-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("initializes planner structure (idempotent)", () => {
		expect(initPlannerStructure(tmpDir)).toBe(true);
		expect(initPlannerStructure(tmpDir)).toBe(true);
		const root = resolvePlannerRoot(tmpDir);
		expect(fs.existsSync(path.join(root, "plans"))).toBe(true);
		expect(fs.existsSync(path.join(root, "config"))).toBe(true);
	});

	it("saves and loads plan", () => {
		initPlannerStructure(tmpDir);
		const plan = createPlan("test");
		plan.goal = "test goal";
		const session: PlannerSession = {
			planId: plan.id,
			fsm: { state: "drafting", history: [] },
			plan,
			showboatPath: "/tmp/showboat.md",
		};
		expect(savePlan(tmpDir, session)).toBe(true);

		const loaded = loadPlan(tmpDir, plan.id);
		expect(loaded).not.toBeNull();
		expect(loaded!.plan.goal).toBe("test goal");
		expect(loaded!.fsm.state).toBe("drafting");
	});

	it("returns null for missing plan", () => {
		initPlannerStructure(tmpDir);
		expect(loadPlan(tmpDir, "nonexistent")).toBeNull();
	});

	it("get/set active plan ID", () => {
		initPlannerStructure(tmpDir);
		expect(getActivePlanId(tmpDir)).toBeNull();
		setActivePlanId(tmpDir, "my-plan");
		expect(getActivePlanId(tmpDir)).toBe("my-plan");
		setActivePlanId(tmpDir, null);
		expect(getActivePlanId(tmpDir)).toBeNull();
	});

	it("lists plans", () => {
		initPlannerStructure(tmpDir);
		const p1 = createPlan("first");
		const p2 = createPlan("second");
		savePlan(tmpDir, { planId: p1.id, fsm: { state: "drafting", history: [] }, plan: p1, showboatPath: "" });
		savePlan(tmpDir, { planId: p2.id, fsm: { state: "planned", history: [] }, plan: p2, showboatPath: "" });
		const plans = listPlans(tmpDir);
		expect(plans).toHaveLength(2);
	});

	it("loads default config when no config file exists", () => {
		initPlannerStructure(tmpDir);
		const config = loadPlannerConfig(tmpDir);
		expect(config).toEqual(PLANNER_CONFIG_DEFAULTS);
	});

	it("rejects plan IDs with path traversal sequences", () => {
		expect(getPlanDir(tmpDir, "../../../etc")).toBeNull();
		expect(getPlanDir(tmpDir, "foo/bar")).toBeNull();
		expect(getPlanDir(tmpDir, "foo\\bar")).toBeNull();
		expect(getPlanDir(tmpDir, "")).toBeNull();
		expect(getPlanDir(tmpDir, "valid-plan-id")).not.toBeNull();
	});

	it("loadPlan returns null for traversal IDs", () => {
		initPlannerStructure(tmpDir);
		expect(loadPlan(tmpDir, "../../../etc")).toBeNull();
	});

	it("handles corrupt plan.json gracefully", () => {
		initPlannerStructure(tmpDir);
		const planDir = getPlanDir(tmpDir, "corrupt-plan")!;
		fs.mkdirSync(planDir, { recursive: true });
		fs.writeFileSync(path.join(planDir, "plan.json"), "not json");
		fs.writeFileSync(path.join(planDir, "state.json"), "not json");
		expect(loadPlan(tmpDir, "corrupt-plan")).toBeNull();
	});
});
