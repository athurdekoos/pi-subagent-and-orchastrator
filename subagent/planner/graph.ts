import type { PlanTask, ValidationIssue } from "./types.js";
import { ERROR_MESSAGES } from "./errors.js";

/** Kahn's topological sort. Returns sorted order and any cycle nodes. */
export function topologicalSort(
	taskIds: string[],
	edges: Map<string, string[]>,
): { sorted: string[]; cycleNodes: string[] } {
	const inDegree = new Map<string, number>();
	for (const id of taskIds) inDegree.set(id, 0);
	for (const [, deps] of edges) {
		for (const dep of deps) {
			inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
		}
	}

	const queue: string[] = [];
	for (const [id, deg] of inDegree) {
		if (deg === 0) queue.push(id);
	}

	const sorted: string[] = [];
	while (queue.length > 0) {
		const node = queue.shift()!;
		sorted.push(node);
		for (const dep of edges.get(node) ?? []) {
			const newDeg = (inDegree.get(dep) ?? 1) - 1;
			inDegree.set(dep, newDeg);
			if (newDeg === 0) queue.push(dep);
		}
	}

	const cycleNodes = taskIds.filter((id) => !sorted.includes(id));
	return { sorted, cycleNodes };
}

/** Validate the dependency graph of tasks. */
export function validateDependencyGraph(
	tasks: PlanTask[],
	phaseOrder: Map<string, number>,
): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const taskIds = new Set(tasks.map((t) => t.id));
	const edges = new Map<string, string[]>();

	for (const task of tasks) {
		edges.set(task.id, []);
		for (const dep of task.dependencies) {
			// Self-dependency
			if (dep === task.id) {
				issues.push({
					code: "SELF_DEPENDENCY",
					severity: "error",
					message: ERROR_MESSAGES.SELF_DEPENDENCY(task.id),
					path: `tasks[${task.id}].dependencies`,
				});
				continue;
			}
			// Dangling reference
			if (!taskIds.has(dep)) {
				issues.push({
					code: "DEPENDENCY_NOT_FOUND",
					severity: "error",
					message: ERROR_MESSAGES.DEPENDENCY_NOT_FOUND(task.id, dep),
					path: `tasks[${task.id}].dependencies`,
				});
				continue;
			}
			edges.get(task.id)!.push(dep);

			// Cross-phase backward dependency check
			const taskPhaseIdx = phaseOrder.get(task.phaseRef);
			const depTask = tasks.find((t) => t.id === dep);
			if (depTask && taskPhaseIdx !== undefined) {
				const depPhaseIdx = phaseOrder.get(depTask.phaseRef);
				if (depPhaseIdx !== undefined && depPhaseIdx > taskPhaseIdx) {
					issues.push({
						code: "CROSS_PHASE_BACKWARD_DEPENDENCY",
						severity: "warning",
						message: ERROR_MESSAGES.CROSS_PHASE_BACKWARD_DEPENDENCY(
							task.id, dep, task.phaseRef, depTask.phaseRef,
						),
						path: `tasks[${task.id}].dependencies`,
					});
				}
			}
		}
	}

	// Cycle detection
	const { cycleNodes } = topologicalSort([...taskIds], edges);
	if (cycleNodes.length > 0) {
		issues.push({
			code: "CIRCULAR_DEPENDENCY",
			severity: "error",
			message: ERROR_MESSAGES.CIRCULAR_DEPENDENCY(cycleNodes.join(" → ")),
			path: "tasks",
		});
	}

	return issues;
}

/** Get execution order respecting dependencies. Returns null if cycles exist. */
export function getExecutionOrder(tasks: PlanTask[]): string[] | null {
	const taskIds = tasks.map((t) => t.id);
	const edges = new Map<string, string[]>();
	for (const task of tasks) {
		edges.set(task.id, task.dependencies.filter((d) => taskIds.includes(d)));
	}
	const { sorted, cycleNodes } = topologicalSort(taskIds, edges);
	return cycleNodes.length > 0 ? null : sorted;
}
