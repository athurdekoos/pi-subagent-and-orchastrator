import type { PlannerState, SerializedFSM } from "./types.js";

/** Legal state transitions. */
const TRANSITIONS: Record<PlannerState, readonly PlannerState[]> = {
	idle: ["analyzing", "aborted"],
	analyzing: ["drafting", "failed", "aborted"],
	drafting: ["validating", "drafting", "failed", "aborted"],
	validating: ["awaiting_approval", "drafting", "failed", "aborted"],
	awaiting_approval: ["planned", "blocked", "aborted"],
	planned: ["idle"],
	blocked: ["drafting", "idle", "aborted"],
	failed: ["idle", "analyzing"],
	aborted: ["idle"],
};

/** Terminal states that represent completed planning runs. */
export const TERMINAL_STATES: readonly PlannerState[] = ["planned", "blocked", "failed", "aborted"];

/** States from which a plan can be resumed. */
export const RESUMABLE_STATES: readonly PlannerState[] = ["analyzing", "drafting", "validating", "awaiting_approval"];

interface HistoryEntry {
	from: PlannerState;
	to: PlannerState;
	at: string;
	action: string;
}

export class PlannerFSM {
	private state: PlannerState;
	private history: HistoryEntry[];

	constructor(initial: PlannerState = "idle") {
		this.state = initial;
		this.history = [];
	}

	getState(): PlannerState {
		return this.state;
	}

	getHistory(): ReadonlyArray<HistoryEntry> {
		return this.history;
	}

	canTransition(to: PlannerState): boolean {
		const allowed = TRANSITIONS[this.state];
		return allowed !== undefined && allowed.includes(to);
	}

	transition(to: PlannerState, action: string): { ok: true } | { ok: false; reason: string } {
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

	serialize(): SerializedFSM {
		return {
			state: this.state,
			history: [...this.history],
		};
	}

	static deserialize(data: SerializedFSM): PlannerFSM {
		const fsm = new PlannerFSM(data.state);
		fsm.history = Array.isArray(data.history) ? [...data.history] : [];
		return fsm;
	}
}
