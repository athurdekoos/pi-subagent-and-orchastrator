/**
 * Planning Orchestrator — Entry Point
 *
 * Registers the "planner" tool (LLM-callable), "/plan" command (user-facing),
 * and session_start hook for resuming in-progress plans.
 */

import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateHead } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

import type { PlannerAction, PlannerToolDetails, Plan, PlannerSession } from "./types.js";
import { PLANNER_ACTIONS } from "./types.js";
import { PlannerFSM, RESUMABLE_STATES } from "./fsm.js";
import { createPlan, createPhase, createTask, createEnvelope, createSuccessCriterion, createVerificationStep } from "./schema.js";
import { validatePlan } from "./validator.js";
import { getExecutionOrder } from "./graph.js";
import {
	initPlannerStructure, savePlan, loadPlan, getActivePlanId, setActivePlanId,
	listPlans, loadPlannerConfig, getPlanDir, resolvePlannerRoot,
} from "./persistence.js";
import { showboatInit, showboatNote, showboatExec, setStreamCallback, clearStreamCallback } from "./showboat.js";
import { validatePlanFromDisk } from "./ci.js";
import { readFileSafe } from "../file-manager/paths.js";

// In-memory session state
let activeFsm: PlannerFSM | null = null;
let activeSession: PlannerSession | null = null;

function makeResult(action: PlannerAction, success: boolean, message: string, data?: unknown, score?: any): PlannerToolDetails {
	return { action, success, message, data, score };
}

function persistSession(cwd: string): boolean {
	if (!activeSession || !activeFsm) return false;
	activeSession.fsm = activeFsm.serialize();
	activeSession.plan.updatedAt = new Date().toISOString();
	return savePlan(cwd, activeSession);
}

/** Determine if a plan is high-impact based on its envelope. Returns trigger reasons. */
function checkHighImpact(plan: Plan): { isHighImpact: boolean; triggers: string[] } {
	const triggers: string[] = [];
	const { changeBudget, allowedOperations, pathScope } = plan.envelope;
	if (changeBudget.maxFilesModified > 20) triggers.push(`>${changeBudget.maxFilesModified} files modified (limit: 20)`);
	if (allowedOperations.includes("delete")) triggers.push("includes delete operations");
	if (pathScope.some(p => p === "**" || p === "**/*")) triggers.push("unbounded path scope (**)");
	if (plan.tasks.length > 10) triggers.push(`${plan.tasks.length} tasks (limit: 10)`);
	return { isHighImpact: triggers.length > 0, triggers };
}

/** Clear streaming callback on terminal/reset. */
function clearSession(): void {
	clearStreamCallback();
	activeFsm = null;
	activeSession = null;
}

export function registerPlanner(pi: ExtensionAPI) {
	// ── Tool Registration ──

	pi.registerTool({
		name: "planner",
		label: "Planner",
		description: "Planning orchestrator: analyze repository, build structured workflow plans with TDD phases, define execution envelopes, validate, and submit for approval. All actions are read-only on the repository.",
		promptSnippet: "Structured planning with FSM, validation, TDD phases, execution envelopes, and Showboat audit",
		promptGuidelines: [
			"Follow this action sequence: analyze_repo → draft_plan → add_phase (multiple) → add_task (multiple) → set_envelope → add_criterion → add_verification → validate → submit",
			"Use 'analyze_repo' with intent to start a new plan — this reads the repo and initializes the Showboat document",
			"Use 'draft_plan' to set the plan's goal and summary",
			"Use 'add_phase' to add TDD phases: must include red (failing test), green (implementation), and verify phases in that order. Refactor is optional.",
			"Use 'add_task' to add tasks to phases — include dependencies, success_criteria, and verification for each",
			"Use 'set_envelope' to define execution constraints: allowed file paths (globs), operations, tools, subagent permissions, and change budget",
			"Use 'add_criterion' to add measurable success criteria",
			"Use 'add_verification' to add verification steps with optional commands",
			"Use 'validate' to run deterministic validation — check score and fix issues before submitting",
			"Use 'submit' when validation passes — this triggers user approval",
			"Use 'status' at any time to check the current FSM state and plan progress",
			"The planner is read-only on the repository — it may read files but never modifies them",
			"Plans require red/green/verify phases (TDD-oriented), bounded execution envelopes, and user approval",
		],
		parameters: Type.Object({
			action: StringEnum([...PLANNER_ACTIONS]),
			intent: Type.Optional(Type.String({ description: "User intent for analyze_repo" })),
			observations: Type.Optional(Type.String({ description: "Repository observations for analyze_repo (recorded in Showboat)" })),
			analysis_commands: Type.Optional(Type.Array(
				Type.Object({
					language: Type.String({ description: "Language identifier for the code block (e.g. bash, typescript)" }),
					code: Type.String({ description: "Read-only analysis command or code to record" }),
				}),
				{ description: "Read-only analysis commands to record as executable blocks in Showboat" },
			)),
			goal: Type.Optional(Type.String({ description: "Plan goal for draft_plan" })),
			summary: Type.Optional(Type.String({ description: "Plan summary for draft_plan" })),
			name: Type.Optional(Type.String({ description: "Phase name for add_phase" })),
			phase_type: Type.Optional(StringEnum(["red", "green", "verify", "refactor"])),
			description: Type.Optional(Type.String({ description: "Description for add_phase, add_task, add_criterion, add_verification" })),
			phase: Type.Optional(Type.String({ description: "Phase name to add task to" })),
			title: Type.Optional(Type.String({ description: "Task title for add_task" })),
			dependencies: Type.Optional(Type.Array(Type.String(), { description: "Task dependency IDs" })),
			success_criteria: Type.Optional(Type.String({ description: "Success criteria for add_task" })),
			verification: Type.Optional(Type.String({ description: "Verification step for add_task" })),
			expected_outcome: Type.Optional(Type.String({ description: "Expected outcome for add_task" })),
			subagent_role: Type.Optional(Type.String({ description: "Subagent role for add_task" })),
			subagent_capability: Type.Optional(StringEnum(["read-only", "execution", "mutation"])),
			subagent_scope: Type.Optional(Type.Array(Type.String(), { description: "Subagent scope constraints" })),
			allowed_paths: Type.Optional(Type.Array(Type.String(), { description: "Path scope globs for set_envelope" })),
			allowed_ops: Type.Optional(Type.Array(Type.String(), { description: "Allowed operations for set_envelope" })),
			allowed_tools: Type.Optional(Type.Array(Type.String(), { description: "Allowed tools for set_envelope" })),
			max_concurrent: Type.Optional(Type.Number({ description: "Max concurrent subagents" })),
			max_files_modified: Type.Optional(Type.Number({ description: "Change budget: max files modified" })),
			max_files_created: Type.Optional(Type.Number({ description: "Change budget: max files created" })),
			max_lines_changed: Type.Optional(Type.Number({ description: "Change budget: max lines changed" })),
			command: Type.Optional(Type.String({ description: "Command for add_verification" })),
			expected_result: Type.Optional(Type.String({ description: "Expected result for add_verification" })),
		}),

		async execute(_toolCallId, params, _signal, onUpdate, ctx) {
			const cwd = ctx.cwd;
			const action = params.action as PlannerAction;

			// ── status (always allowed) ──
			if (action === "status") {
				const state = activeFsm?.getState() ?? "idle";
				const plan = activeSession?.plan;
				const data: Record<string, unknown> = { state };
				if (plan) {
					data.planId = plan.id;
					data.phases = plan.phases.length;
					data.tasks = plan.tasks.length;
					data.successCriteria = plan.successCriteria.length;
					data.verificationSteps = plan.verificationSteps.length;
					if (plan.validationResult) {
						data.validationValid = plan.validationResult.valid;
						data.score = plan.validationResult.score;
					}
				}
				const msg = plan
					? `State: ${state} | Plan: ${plan.id} | ${plan.phases.length} phases, ${plan.tasks.length} tasks`
					: `State: ${state} | No active plan`;
				return {
					content: [{ type: "text" as const, text: msg }],
					details: makeResult(action, true, msg, data),
				};
			}

			// ── analyze_repo ──
			if (action === "analyze_repo") {
				const intent = params.intent;
				if (!intent) {
					const r = makeResult(action, false, "Missing required parameter: intent");
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				// Initialize FSM if idle, or reject
				if (activeFsm && activeFsm.getState() !== "idle") {
					const r = makeResult(action, false, `Cannot analyze_repo: planner is in "${activeFsm.getState()}" state, not "idle"`);
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				activeFsm = new PlannerFSM("idle");
				const t1 = activeFsm.transition("analyzing", "analyze_repo");
				if (!t1.ok) {
					const r = makeResult(action, false, t1.reason);
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				// Create plan scaffold
				const plan = createPlan(intent);
				initPlannerStructure(cwd);
				const planDir = getPlanDir(cwd, plan.id);
				const showboatPath = path.join(planDir, "showboat.md");

				activeSession = {
					planId: plan.id,
					fsm: activeFsm.serialize(),
					plan,
					showboatPath,
				};

				// Wire streaming callback if onUpdate is available
				if (onUpdate) {
					setStreamCallback((section, content) => {
						onUpdate({ type: "showboat", section, content });
					});
				}

				// Initialize Showboat (always — falls back to direct markdown if CLI absent)
				showboatInit(showboatPath, `Plan: ${intent}`);
				showboatNote(showboatPath, `## Intent\n\n${intent}`);

				// Repository observations
				const obsText = params.observations
					? `## Repository Observations\n\nWorking directory: ${cwd}\n\n${params.observations}`
					: `## Repository Observations\n\nWorking directory: ${cwd}`;
				showboatNote(showboatPath, obsText);

				// Record analysis commands as executable blocks
				const commands = params.analysis_commands as Array<{ language: string; code: string }> | undefined;
				if (commands && Array.isArray(commands)) {
					for (const cmd of commands) {
						showboatExec(showboatPath, cmd.language, cmd.code, cwd);
					}
				}

				// Transition to drafting
				activeFsm.transition("drafting", "analyze_repo_complete");

				setActivePlanId(cwd, plan.id);
				persistSession(cwd);

				const msg = `Plan "${plan.id}" created. State: drafting. Add phases, tasks, envelope, then validate.`;
				const r = makeResult(action, true, msg, { planId: plan.id });
				return { content: [{ type: "text" as const, text: msg }], details: r };
			}

			// ── All other actions require active session ──
			if (!activeFsm || !activeSession) {
				const r = makeResult(action, false, "No active plan. Use analyze_repo first.");
				return { content: [{ type: "text" as const, text: r.message }], details: r };
			}

			const currentState = activeFsm.getState();
			const plan = activeSession.plan;

			// ── draft_plan ──
			if (action === "draft_plan") {
				if (currentState !== "drafting") {
					const r = makeResult(action, false, `Cannot draft_plan in "${currentState}" state`);
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}
				if (params.goal) plan.goal = params.goal;
				if (params.summary) plan.summary = params.summary;

				showboatNote(activeSession.showboatPath, `## Goal\n\n${plan.goal}\n\n## Summary\n\n${plan.summary}`);

				persistSession(cwd);
				const msg = `Plan goal and summary set.`;
				return { content: [{ type: "text" as const, text: msg }], details: makeResult(action, true, msg) };
			}

			// ── add_phase ──
			if (action === "add_phase") {
				if (currentState !== "drafting") {
					const r = makeResult(action, false, `Cannot add_phase in "${currentState}" state`);
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}
				const name = params.name;
				const phaseType = params.phase_type;
				const desc = params.description ?? "";
				if (!name || !phaseType) {
					const r = makeResult(action, false, "Missing required: name, phase_type");
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}
				const phase = createPhase(name, phaseType as any, desc);
				plan.phases.push(phase);

				showboatNote(activeSession.showboatPath, `## Phase: ${name} (${phaseType})\n\n${desc}`);

				persistSession(cwd);
				const msg = `Phase "${name}" (${phaseType}) added. Total: ${plan.phases.length} phases.`;
				return { content: [{ type: "text" as const, text: msg }], details: makeResult(action, true, msg) };
			}

			// ── add_task ──
			if (action === "add_task") {
				if (currentState !== "drafting") {
					const r = makeResult(action, false, `Cannot add_task in "${currentState}" state`);
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}
				const phaseRef = params.phase;
				const title = params.title;
				const desc = params.description ?? "";
				if (!phaseRef || !title) {
					const r = makeResult(action, false, "Missing required: phase, title");
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				const targetPhase = plan.phases.find(p => p.name === phaseRef);
				if (!targetPhase) {
					const r = makeResult(action, false, `Phase "${phaseRef}" not found. Add it first.`);
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				const subagent = params.subagent_role ? {
					role: params.subagent_role,
					capability: (params.subagent_capability ?? "read-only") as any,
					scopeConstraints: params.subagent_scope ?? [],
				} : undefined;

				const task = createTask(phaseRef, title, desc, {
					dependencies: params.dependencies,
					expectedOutcome: params.expected_outcome,
					verificationStep: params.verification ?? params.success_criteria ?? "",
					assignedSubagent: subagent,
				});
				plan.tasks.push(task);
				targetPhase.tasks.push(task.id);

				const depStr = task.dependencies.length > 0 ? `\nDependencies: ${task.dependencies.join(", ")}` : "";
				showboatNote(activeSession.showboatPath, `### Task: ${title}\n\n${desc}${depStr}\nVerification: ${task.verificationStep}`);

				persistSession(cwd);
				const msg = `Task "${task.id}" added to phase "${phaseRef}". Total: ${plan.tasks.length} tasks.`;
				return { content: [{ type: "text" as const, text: msg }], details: makeResult(action, true, msg, { taskId: task.id }) };
			}

			// ── set_envelope ──
			if (action === "set_envelope") {
				if (currentState !== "drafting") {
					const r = makeResult(action, false, `Cannot set_envelope in "${currentState}" state`);
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}
				plan.envelope = createEnvelope({
					pathScope: params.allowed_paths,
					allowedOperations: params.allowed_ops as any,
					allowedTools: params.allowed_tools,
					subagentPermissions: {
						maxConcurrent: params.max_concurrent ?? 4,
						allowedCapabilities: ["read-only", "execution"],
						scopeConstraints: params.allowed_paths ?? [],
					},
					changeBudget: {
						maxFilesModified: params.max_files_modified ?? 10,
						maxFilesCreated: params.max_files_created ?? 5,
						maxLinesChanged: params.max_lines_changed ?? 1000,
					},
				});

				showboatNote(activeSession.showboatPath,
					`## Execution Envelope\n\nPaths: ${plan.envelope.pathScope.join(", ")}\nOps: ${plan.envelope.allowedOperations.join(", ")}\nTools: ${plan.envelope.allowedTools.join(", ")}\nBudget: ${plan.envelope.changeBudget.maxFilesModified} files modified, ${plan.envelope.changeBudget.maxLinesChanged} lines`);

				persistSession(cwd);
				const msg = `Execution envelope set.`;
				return { content: [{ type: "text" as const, text: msg }], details: makeResult(action, true, msg) };
			}

			// ── add_criterion ──
			if (action === "add_criterion") {
				if (currentState !== "drafting") {
					const r = makeResult(action, false, `Cannot add_criterion in "${currentState}" state`);
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}
				const desc = params.description;
				if (!desc) {
					const r = makeResult(action, false, "Missing required: description");
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}
				const criterion = createSuccessCriterion(desc);
				plan.successCriteria.push(criterion);
				persistSession(cwd);
				const msg = `Success criterion "${criterion.id}" added. Total: ${plan.successCriteria.length}.`;
				return { content: [{ type: "text" as const, text: msg }], details: makeResult(action, true, msg) };
			}

			// ── add_verification ──
			if (action === "add_verification") {
				if (currentState !== "drafting") {
					const r = makeResult(action, false, `Cannot add_verification in "${currentState}" state`);
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}
				const desc = params.description;
				if (!desc) {
					const r = makeResult(action, false, "Missing required: description");
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}
				const step = createVerificationStep(desc, params.command, params.expected_result);
				plan.verificationSteps.push(step);
				persistSession(cwd);
				const msg = `Verification step "${step.id}" added. Total: ${plan.verificationSteps.length}.`;
				return { content: [{ type: "text" as const, text: msg }], details: makeResult(action, true, msg) };
			}

			// ── validate ──
			if (action === "validate") {
				if (currentState !== "drafting") {
					const r = makeResult(action, false, `Cannot validate in "${currentState}" state`);
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				const t1 = activeFsm.transition("validating", "validate");
				if (!t1.ok) {
					const r = makeResult(action, false, t1.reason);
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				const result = validatePlan(plan);
				plan.validationResult = result;
				const impact = checkHighImpact(plan);
				plan.highImpact = impact.isHighImpact;

				// Showboat: validation results
				const errorCount = result.issues.filter(i => i.severity === "error").length;
				const warnCount = result.issues.filter(i => i.severity === "warning").length;
				const issueList = result.issues.map(i => `- [${i.severity}] ${i.code}: ${i.message}`).join("\n");
				showboatNote(activeSession.showboatPath,
					`## Validation\n\nResult: ${result.valid ? "PASS" : "FAIL"}\nScore: ${result.score.overall}/100\nErrors: ${errorCount}, Warnings: ${warnCount}\n\n${issueList}`);

				// Showboat: dependency structure
				const execOrder = getExecutionOrder(plan.tasks);
				if (execOrder) {
					const orderList = execOrder.map((id, i) => {
						const task = plan.tasks.find(t => t.id === id);
						return `${i + 1}. ${id} (${task?.phaseRef ?? "?"}) — ${task?.title ?? ""}`;
					}).join("\n");
					showboatNote(activeSession.showboatPath, `## Dependency Structure\n\nExecution order:\n${orderList}`);
				} else {
					showboatNote(activeSession.showboatPath, `## Dependency Structure\n\nCyclic dependencies detected — no valid execution order.`);
				}

				if (result.valid) {
					activeFsm.transition("awaiting_approval", "validation_passed");
					persistSession(cwd);
					const msg = `Validation passed (score: ${result.score.overall}/100). Ready for approval — call submit.`;
					return {
						content: [{ type: "text" as const, text: msg }],
						details: makeResult(action, true, msg, { issues: result.issues }, result.score),
					};
				} else {
					activeFsm.transition("drafting", "validation_failed");
					persistSession(cwd);
					const errors = result.issues.filter(i => i.severity === "error");
					const errorSummary = errors.map(e => `  ${e.code}: ${e.message}`).join("\n");
					const msg = `Validation failed (score: ${result.score.overall}/100, ${errors.length} errors). Fix issues and re-validate:\n${errorSummary}`;
					return {
						content: [{ type: "text" as const, text: truncateHead(msg).content }],
						details: makeResult(action, false, msg, { issues: result.issues }, result.score),
					};
				}
			}

			// ── submit ──
			if (action === "submit") {
				if (currentState !== "awaiting_approval") {
					const r = makeResult(action, false, `Cannot submit: planner is in "${currentState}" state, needs "awaiting_approval"`);
					return { content: [{ type: "text" as const, text: r.message }], details: r };
				}

				const config = loadPlannerConfig(cwd);
				const impact = checkHighImpact(plan);
				plan.highImpact = impact.isHighImpact;

				// High-impact plans always require approval, even if config.requireApproval is false
				if (config.requireApproval || plan.highImpact) {
					const impactWarning = plan.highImpact ? "HIGH IMPACT — " : "";
					const triggerList = plan.highImpact
						? `\nTriggers: ${impact.triggers.join("; ")}`
						: "";
					const summary = [
						`${impactWarning}Plan: ${plan.goal}`,
						`Phases: ${plan.phases.length} | Tasks: ${plan.tasks.length}`,
						`Envelope: ${plan.envelope.pathScope.join(", ")}`,
						`Budget: ${plan.envelope.changeBudget.maxFilesModified} files, ${plan.envelope.changeBudget.maxLinesChanged} lines`,
						triggerList,
					].filter(Boolean).join("\n");

					const approved = await ctx.ui.confirm("Approve Plan", summary);

					if (!approved) {
						activeFsm.transition("blocked", "approval_denied");
						showboatNote(activeSession.showboatPath, `## Approval\n\n**DENIED** by user.`);
						persistSession(cwd);
						clearStreamCallback();
						const msg = "Plan approval denied. State: blocked. Revise the plan or abort.";
						return { content: [{ type: "text" as const, text: msg }], details: makeResult(action, false, msg) };
					}
				}

				activeFsm.transition("planned", "approved");
				showboatNote(activeSession.showboatPath, `## Approval\n\n**APPROVED** by user.`);
				showboatNote(activeSession.showboatPath, `## Final Plan\n\n\`\`\`json\n${JSON.stringify(plan, null, 2)}\n\`\`\``);
				persistSession(cwd);
				clearStreamCallback();

				const msg = `Plan "${plan.id}" approved and finalized. State: planned.`;
				return { content: [{ type: "text" as const, text: msg }], details: makeResult(action, true, msg, { planId: plan.id }) };
			}

			// Unknown action (should not happen due to StringEnum)
			const r = makeResult(action, false, `Unknown action: ${action}`);
			return { content: [{ type: "text" as const, text: r.message }], details: r };
		},

		renderCall(args: { action?: string; intent?: string; name?: string; title?: string; description?: string }, theme) {
			const fg = theme.fg.bind(theme);
			const actionLabel = fg("accent", args.action ?? "planner");
			let detail = "";
			if (args.intent) detail += ` ${fg("muted", args.intent.substring(0, 60))}`;
			if (args.name) detail += ` ${fg("warning", args.name)}`;
			if (args.title) detail += ` ${fg("warning", args.title)}`;
			return new Text(`planner ${actionLabel}${detail}`, 0, 0);
		},

		renderResult(result, _opts, theme) {
			const details = result.details as PlannerToolDetails | undefined;
			if (!details) return undefined;
			const fg = theme.fg.bind(theme);
			const status = details.success ? fg("success", "✓") : fg("error", "✗");
			const scoreStr = details.score ? fg("muted", ` [${details.score.overall}/100]`) : "";
			return new Text(`${status} ${details.message}${scoreStr}`, 0, 0);
		},
	});

	// ── Command Registration ──

	pi.registerCommand("plan", {
		description: "Planning: status | list | view | showboat | resume | abort | reset | ci-check",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/);
			const subcommand = parts[0] || "status";
			const rest = parts.slice(1).join(" ");
			const cwd = ctx.cwd;

			switch (subcommand) {
				case "status": {
					const state = activeFsm?.getState() ?? "idle";
					const plan = activeSession?.plan;
					if (plan) {
						const scoreStr = plan.validationResult
							? ` | Score: ${plan.validationResult.score.overall}/100`
							: "";
						ctx.ui.notify(`State: ${state} | Plan: ${plan.id} | ${plan.phases.length} phases, ${plan.tasks.length} tasks${scoreStr}`, "info");
					} else {
						ctx.ui.notify(`State: ${state} | No active plan`, "info");
					}
					break;
				}
				case "list": {
					const plans = listPlans(cwd);
					if (plans.length === 0) {
						ctx.ui.notify("No plans found.", "info");
					} else {
						const lines = plans.map(p => `${p.id} [${p.state}] ${p.createdAt}`).join("\n");
						ctx.ui.notify(lines, "info");
					}
					break;
				}
				case "view": {
					const planId = rest || activeSession?.planId;
					if (!planId) {
						ctx.ui.notify("No plan specified and no active plan.", "error");
						return;
					}
					const session = rest ? loadPlan(cwd, planId) : activeSession;
					if (!session) {
						ctx.ui.notify(`Plan "${planId}" not found.`, "error");
						return;
					}
					pi.sendMessage({
						customType: "planner-view",
						content: JSON.stringify(session.plan, null, 2),
					});
					break;
				}
				case "showboat": {
					const planId = rest || activeSession?.planId;
					if (!planId) {
						ctx.ui.notify("No plan specified and no active plan.", "error");
						return;
					}
					const session = rest ? loadPlan(cwd, planId) : activeSession;
					if (!session) {
						ctx.ui.notify(`Plan "${planId}" not found.`, "error");
						return;
					}
					const content = readFileSafe(session.showboatPath);
					if (content) {
						pi.sendMessage({
							customType: "planner-showboat",
							content,
						});
					} else {
						ctx.ui.notify("Showboat document not found.", "error");
					}
					break;
				}
				case "resume": {
					const planId = rest;
					if (!planId) {
						ctx.ui.notify("Specify a plan ID to resume.", "error");
						return;
					}
					const session = loadPlan(cwd, planId);
					if (!session) {
						ctx.ui.notify(`Plan "${planId}" not found.`, "error");
						return;
					}
					activeFsm = PlannerFSM.deserialize(session.fsm);
					activeSession = session;
					setActivePlanId(cwd, planId);
					ctx.ui.notify(`Resumed plan "${planId}" in state "${activeFsm.getState()}"`, "info");
					break;
				}
				case "abort": {
					if (!activeFsm || !activeSession) {
						ctx.ui.notify("No active plan to abort.", "error");
						return;
					}
					const result = activeFsm.transition("aborted", "user_abort");
					if (!result.ok) {
						ctx.ui.notify(`Cannot abort: ${result.reason}`, "error");
						return;
					}
					showboatNote(activeSession.showboatPath, `## Aborted\n\nPlan aborted by user.`);
					persistSession(cwd);
					setActivePlanId(cwd, null);
					ctx.ui.notify(`Plan "${activeSession.planId}" aborted.`, "info");
					clearSession();
					break;
				}
				case "reset": {
					setActivePlanId(cwd, null);
					clearSession();
					ctx.ui.notify("Active plan cleared.", "info");
					break;
				}
				case "ci-check": {
					const planId = rest;
					if (!planId) {
						ctx.ui.notify("Specify a plan ID to validate.", "error");
						return;
					}
					const planDir = getPlanDir(cwd, planId);
					const planJsonPath = path.join(planDir, "plan.json");
					try {
						const result = validatePlanFromDisk(planJsonPath);
						const errorCount = result.issues.filter(i => i.severity === "error").length;
						const warnCount = result.issues.filter(i => i.severity === "warning").length;
						const status = result.valid ? "PASS" : "FAIL";
						ctx.ui.notify(
							`CI Check: ${status} | Score: ${result.score.overall}/100 | Errors: ${errorCount}, Warnings: ${warnCount}`,
							result.valid ? "info" : "error",
						);
					} catch (err) {
						ctx.ui.notify(`CI Check failed: ${err instanceof Error ? err.message : String(err)}`, "error");
					}
					break;
				}
				default: {
					ctx.ui.notify(`Unknown subcommand: ${subcommand}. Use: status | list | view | showboat | resume | abort | reset | ci-check`, "error");
				}
			}
		},
	});

	// ── Session Start Hook ──

	pi.on("session_start", async (_event, ctx) => {
		const cwd = ctx.cwd;
		const planId = getActivePlanId(cwd);
		if (!planId) return;

		const session = loadPlan(cwd, planId);
		if (!session) return;

		const fsm = PlannerFSM.deserialize(session.fsm);
		if (!fsm.isResumable()) return;

		activeFsm = fsm;
		activeSession = session;
		ctx.ui.notify(`Resumed plan "${planId}" in state "${fsm.getState()}"`, "info");
	});
}
