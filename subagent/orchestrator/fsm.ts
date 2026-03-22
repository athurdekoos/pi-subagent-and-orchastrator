import type { OrchestratorState, SerializedOrchestratorFSM } from "./types.js";

/** Legal state transitions. */
const TRANSITIONS: Record<OrchestratorState, readonly OrchestratorState[]> = {
	idle: ["loading_plan", "aborted"],
	loading_plan: ["executing", "failed", "aborted"],
	executing: ["executing", "awaiting_approval", "verifying", "failed", "blocked", "aborted"],
	awaiting_approval: ["executing", "blocked", "aborted"],
	verifying: ["completed", "failed", "blocked", "aborted"],
	completed: ["idle"],
	failed: ["idle", "loading_plan"],
	blocked: ["executing", "idle", "aborted"],
	aborted: ["idle"],
};

/** Terminal states that represent completed orchestrator runs. */
export const TERMINAL_STATES: readonly OrchestratorState[] = ["completed", "failed", "blocked", "aborted"];

/** States from which an orchestrator run can be resumed. */
export const RESUMABLE_STATES: readonly OrchestratorState[] = ["loading_plan", "executing", "awaiting_approval", "verifying"];

interface HistoryEntry {
	from: OrchestratorState;
	to: OrchestratorState;
	at: string;
	action: string;
}

export class OrchestratorFSM {
	private state: OrchestratorState;
	private history: HistoryEntry[];

	constructor(initial: OrchestratorState = "idle") {
		this.state = initial;
		this.history = [];
	}

	getState(): OrchestratorState {
		return this.state;
	}

	getHistory(): ReadonlyArray<HistoryEntry> {
		return this.history;
	}

	canTransition(to: OrchestratorState): boolean {
		const allowed = TRANSITIONS[this.state];
		return allowed !== undefined && allowed.includes(to);
	}

	transition(to: OrchestratorState, action: string): { ok: true } | { ok: false; reason: string } {
		if (!this.canTransition(to)) {
			return {
				ok: false,
				reason: `Cannot transition from "${this.state}" to "${to}". Allowed: ${TRANSITIONS[this.state].join(", ")}`,
			};
		}
		const entry: HistoryEntry = {
			from: this.state,
			to,
			at: new Date().toISOString(),
			action,
		};
		this.history.push(entry);
		this.state = to;
		return { ok: true };
	}

	isTerminal(): boolean {
		return (TERMINAL_STATES as readonly string[]).includes(this.state);
	}

	isResumable(): boolean {
		return (RESUMABLE_STATES as readonly string[]).includes(this.state);
	}

	serialize(): SerializedOrchestratorFSM {
		return {
			state: this.state,
			history: [...this.history],
		};
	}

	static deserialize(data: SerializedOrchestratorFSM): OrchestratorFSM {
		const fsm = new OrchestratorFSM(data.state);
		fsm.history = Array.isArray(data.history) ? [...data.history] : [];
		return fsm;
	}
}
