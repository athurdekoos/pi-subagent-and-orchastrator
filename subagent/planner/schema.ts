import type { Plan, PlanPhase, PlanTask, ExecutionEnvelope, SuccessCriterion, VerificationStep, SubagentAssignment, PhaseType, ChangeBudget, SubagentPermissions } from "./types.js";
import { slugify, timestampPrefix } from "../file-manager/naming.js";

let idCounter = 0;

/** Generate a unique ID for plan elements. */
export function generateId(prefix: string): string {
	idCounter++;
	return `${prefix}-${idCounter}`;
}

/** Reset the ID counter (for testing). */
export function resetIdCounter(): void {
	idCounter = 0;
}

/** Generate a plan ID from intent text. */
export function generatePlanId(intent: string): string {
	const ts = timestampPrefix("full");
	const slug = slugify(intent, 40);
	return `${ts}-${slug}`;
}

/** Create an empty plan scaffold. */
export function createPlan(intent: string): Plan {
	const now = new Date().toISOString();
	return {
		version: "1.0.0",
		id: generatePlanId(intent),
		intent,
		goal: "",
		summary: "",
		phases: [],
		tasks: [],
		envelope: createEnvelope(),
		successCriteria: [],
		verificationSteps: [],
		createdAt: now,
		updatedAt: now,
		highImpact: false,
		validationResult: null,
	};
}

/** Create a plan phase. */
export function createPhase(name: string, type: PhaseType, description: string): PlanPhase {
	return { name, type, description, tasks: [] };
}

/** Create a plan task. */
export function createTask(
	phaseRef: string,
	title: string,
	description: string,
	opts?: {
		dependencies?: string[];
		expectedOutcome?: string;
		verificationStep?: string;
		assignedSubagent?: SubagentAssignment;
	},
): PlanTask {
	return {
		id: generateId("task"),
		phaseRef,
		title,
		description,
		dependencies: opts?.dependencies ?? [],
		expectedOutcome: opts?.expectedOutcome ?? "",
		verificationStep: opts?.verificationStep ?? "",
		assignedSubagent: opts?.assignedSubagent,
		status: "pending",
	};
}

/** Create a default execution envelope. */
export function createEnvelope(overrides?: Partial<ExecutionEnvelope>): ExecutionEnvelope {
	return {
		pathScope: overrides?.pathScope ?? [],
		allowedOperations: overrides?.allowedOperations ?? [],
		allowedTools: overrides?.allowedTools ?? [],
		subagentPermissions: overrides?.subagentPermissions ?? {
			maxConcurrent: 4,
			allowedCapabilities: ["read-only"],
			scopeConstraints: [],
		},
		changeBudget: overrides?.changeBudget ?? {
			maxFilesModified: 0,
			maxFilesCreated: 0,
			maxLinesChanged: 0,
		},
	};
}

/** Create a success criterion. */
export function createSuccessCriterion(description: string, measurable: boolean = true): SuccessCriterion {
	return {
		id: generateId("criterion"),
		description,
		measurable,
	};
}

/** Create a verification step. */
export function createVerificationStep(
	description: string,
	command?: string,
	expectedResult?: string,
): VerificationStep {
	return {
		id: generateId("verify"),
		description,
		command,
		expectedResult: expectedResult ?? "",
	};
}
