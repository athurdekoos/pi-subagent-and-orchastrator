import * as path from "node:path";
import * as fs from "node:fs";
import type { WorkflowState, OrchestratorConfig } from "./types.js";
import { readFileSafe, writeFileSafe, ensureDir, isDirectory } from "../file-manager/paths.js";
import { slugify, timestampPrefix } from "../file-manager/naming.js";

const ORCHESTRATOR_ROOT = ".pi/orchestrator";
const WORKFLOWS_DIR = "workflows";
const ACTIVE_WORKFLOW_FILE = "active-workflow.json";

/** Resolve orchestrator root directory. */
export function resolveOrchestratorRoot(cwd: string, config?: OrchestratorConfig): string {
	const rootDir = config?.rootDir ?? ORCHESTRATOR_ROOT;
	return path.resolve(cwd, rootDir);
}

/** Initialize orchestrator directory structure (idempotent). */
export function initOrchestratorStructure(cwd: string): boolean {
	const root = resolveOrchestratorRoot(cwd);
	return ensureDir(path.join(root, WORKFLOWS_DIR));
}

/** Resolve a workflow directory path. */
export function getWorkflowDir(cwd: string, workflowId: string): string {
	const root = resolveOrchestratorRoot(cwd);
	return path.join(root, WORKFLOWS_DIR, workflowId);
}

/** Generate a unique workflow ID from a plan ID. */
export function generateWorkflowId(planId: string): string {
	return `${timestampPrefix("full")}-exec-${slugify(planId, 30)}`;
}

/** Save a workflow state (workflow.json). */
export function saveWorkflow(cwd: string, state: WorkflowState): boolean {
	const wfDir = getWorkflowDir(cwd, state.workflowId);
	if (!ensureDir(wfDir)) return false;
	return writeFileSafe(path.join(wfDir, "workflow.json"), JSON.stringify(state, null, 2));
}

/** Load a workflow state. Returns null on error or missing. */
export function loadWorkflow(cwd: string, workflowId: string): WorkflowState | null {
	const wfDir = getWorkflowDir(cwd, workflowId);
	const raw = readFileSafe(path.join(wfDir, "workflow.json"));
	if (!raw) return null;
	try {
		return JSON.parse(raw) as WorkflowState;
	} catch {
		return null;
	}
}

/** Get the active workflow ID. Returns null if none. */
export function getActiveWorkflowId(cwd: string): string | null {
	const root = resolveOrchestratorRoot(cwd);
	const raw = readFileSafe(path.join(root, ACTIVE_WORKFLOW_FILE));
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		return typeof parsed?.workflowId === "string" ? parsed.workflowId : null;
	} catch {
		return null;
	}
}

/** Set the active workflow ID (or null to clear). */
export function setActiveWorkflowId(cwd: string, workflowId: string | null): boolean {
	const root = resolveOrchestratorRoot(cwd);
	ensureDir(root);
	return writeFileSafe(
		path.join(root, ACTIVE_WORKFLOW_FILE),
		JSON.stringify(workflowId ? { workflowId } : null, null, 2),
	);
}

/** List all workflows with basic info, sorted by createdAt descending. */
export function listWorkflows(cwd: string): Array<{ id: string; planId: string; state: string; createdAt: string }> {
	const root = resolveOrchestratorRoot(cwd);
	const wfDir = path.join(root, WORKFLOWS_DIR);
	if (!isDirectory(wfDir)) return [];
	try {
		const entries = fs.readdirSync(wfDir, { withFileTypes: true });
		const results: Array<{ id: string; planId: string; state: string; createdAt: string }> = [];
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const raw = readFileSafe(path.join(wfDir, entry.name, "workflow.json"));
			if (!raw) continue;
			try {
				const wf = JSON.parse(raw);
				results.push({
					id: entry.name,
					planId: wf.planId ?? "",
					state: wf.fsm?.state ?? "unknown",
					createdAt: wf.createdAt ?? "",
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
