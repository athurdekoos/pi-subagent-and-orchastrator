import * as path from "node:path";
import * as fs from "node:fs";
import type { Plan, PlannerConfig, PlannerSession, SerializedFSM } from "./types.js";
import { readFileSafe, writeFileSafe, ensureDir, isDirectory, isValidId } from "../file-manager/paths.js";
import { slugify, timestampPrefix } from "../file-manager/naming.js";

const PLANNER_ROOT = ".pi/planner";
const PLANS_DIR = "plans";
const CONFIG_DIR = "config";
const ACTIVE_PLAN_FILE = "active-plan.json";
const CONFIG_FILE = "settings.json";

/** Default planner configuration. */
export const PLANNER_CONFIG_DEFAULTS: PlannerConfig = {
	rootDir: PLANNER_ROOT,
	maxFilesModifiedLimit: 500,
	maxFilesCreatedLimit: 200,
	maxLinesChangedLimit: 50000,
	maxConcurrentLimit: 8,
	requireApproval: true,
};

/** Resolve planner root directory. */
export function resolvePlannerRoot(cwd: string, config?: PlannerConfig): string {
	const rootDir = config?.rootDir ?? PLANNER_ROOT;
	return path.resolve(cwd, rootDir);
}

/** Initialize planner directory structure (idempotent). */
export function initPlannerStructure(cwd: string): boolean {
	const root = resolvePlannerRoot(cwd);
	const ok1 = ensureDir(path.join(root, PLANS_DIR));
	const ok2 = ensureDir(path.join(root, CONFIG_DIR));
	return ok1 && ok2;
}

/** Load planner config with per-field validation. */
export function loadPlannerConfig(cwd: string): PlannerConfig {
	const root = resolvePlannerRoot(cwd);
	const configPath = path.join(root, CONFIG_DIR, CONFIG_FILE);
	const raw = readFileSafe(configPath);
	if (!raw) return { ...PLANNER_CONFIG_DEFAULTS };
	try {
		const parsed = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return { ...PLANNER_CONFIG_DEFAULTS };
		return {
			rootDir: typeof parsed.rootDir === "string" ? parsed.rootDir : PLANNER_CONFIG_DEFAULTS.rootDir,
			maxFilesModifiedLimit: typeof parsed.maxFilesModifiedLimit === "number" && parsed.maxFilesModifiedLimit > 0
				? parsed.maxFilesModifiedLimit : PLANNER_CONFIG_DEFAULTS.maxFilesModifiedLimit,
			maxFilesCreatedLimit: typeof parsed.maxFilesCreatedLimit === "number" && parsed.maxFilesCreatedLimit >= 0
				? parsed.maxFilesCreatedLimit : PLANNER_CONFIG_DEFAULTS.maxFilesCreatedLimit,
			maxLinesChangedLimit: typeof parsed.maxLinesChangedLimit === "number" && parsed.maxLinesChangedLimit > 0
				? parsed.maxLinesChangedLimit : PLANNER_CONFIG_DEFAULTS.maxLinesChangedLimit,
			maxConcurrentLimit: typeof parsed.maxConcurrentLimit === "number" && parsed.maxConcurrentLimit >= 1 && parsed.maxConcurrentLimit <= 8
				? parsed.maxConcurrentLimit : PLANNER_CONFIG_DEFAULTS.maxConcurrentLimit,
			requireApproval: typeof parsed.requireApproval === "boolean"
				? parsed.requireApproval : PLANNER_CONFIG_DEFAULTS.requireApproval,
		};
	} catch {
		return { ...PLANNER_CONFIG_DEFAULTS };
	}
}

/** Save planner config. */
export function savePlannerConfig(cwd: string, patch: Partial<PlannerConfig>): boolean {
	const root = resolvePlannerRoot(cwd);
	const configPath = path.join(root, CONFIG_DIR, CONFIG_FILE);
	const current = loadPlannerConfig(cwd);
	const merged = { ...current, ...patch };
	return writeFileSafe(configPath, JSON.stringify(merged, null, 2));
}

/** Resolve a plan directory path. Returns null if planId is invalid. */
export function getPlanDir(cwd: string, planId: string): string | null {
	if (!isValidId(planId)) return null;
	const root = resolvePlannerRoot(cwd);
	return path.join(root, PLANS_DIR, planId);
}

/** Save a plan session (plan.json + state.json). */
export function savePlan(cwd: string, session: PlannerSession): boolean {
	const planDir = getPlanDir(cwd, session.planId);
	if (!planDir || !ensureDir(planDir)) return false;
	const planOk = writeFileSafe(path.join(planDir, "plan.json"), JSON.stringify(session.plan, null, 2));
	const stateOk = writeFileSafe(path.join(planDir, "state.json"), JSON.stringify({
		planId: session.planId,
		fsm: session.fsm,
		showboatPath: session.showboatPath,
	}, null, 2));
	return planOk && stateOk;
}

/** Load a plan session. Returns null on error or missing. */
export function loadPlan(cwd: string, planId: string): PlannerSession | null {
	const planDir = getPlanDir(cwd, planId);
	if (!planDir) return null;
	const planRaw = readFileSafe(path.join(planDir, "plan.json"));
	const stateRaw = readFileSafe(path.join(planDir, "state.json"));
	if (!planRaw || !stateRaw) return null;
	try {
		const plan = JSON.parse(planRaw) as Plan;
		const state = JSON.parse(stateRaw);
		return {
			planId: state.planId ?? planId,
			fsm: state.fsm as SerializedFSM,
			plan,
			showboatPath: state.showboatPath ?? path.join(planDir, "showboat.md"),
		};
	} catch {
		return null;
	}
}

/** Get the active plan ID. Returns null if none. */
export function getActivePlanId(cwd: string): string | null {
	const root = resolvePlannerRoot(cwd);
	const raw = readFileSafe(path.join(root, ACTIVE_PLAN_FILE));
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		return typeof parsed?.planId === "string" ? parsed.planId : null;
	} catch {
		return null;
	}
}

/** Set the active plan ID (or null to clear). */
export function setActivePlanId(cwd: string, planId: string | null): boolean {
	const root = resolvePlannerRoot(cwd);
	ensureDir(root);
	return writeFileSafe(
		path.join(root, ACTIVE_PLAN_FILE),
		JSON.stringify(planId ? { planId } : null, null, 2),
	);
}

/** List all plans with basic info. */
export function listPlans(cwd: string): Array<{ id: string; state: string; createdAt: string }> {
	const root = resolvePlannerRoot(cwd);
	const plansDir = path.join(root, PLANS_DIR);
	if (!isDirectory(plansDir)) return [];
	try {
		const entries = fs.readdirSync(plansDir, { withFileTypes: true });
		const results: Array<{ id: string; state: string; createdAt: string }> = [];
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const stateRaw = readFileSafe(path.join(plansDir, entry.name, "state.json"));
			const planRaw = readFileSafe(path.join(plansDir, entry.name, "plan.json"));
			if (!stateRaw || !planRaw) continue;
			try {
				const state = JSON.parse(stateRaw);
				const plan = JSON.parse(planRaw);
				results.push({
					id: entry.name,
					state: state.fsm?.state ?? "unknown",
					createdAt: plan.createdAt ?? "",
				});
			} catch {
				continue;
			}
		}
		return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	} catch {
		return [];
	}
}
