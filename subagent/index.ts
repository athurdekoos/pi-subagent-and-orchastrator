/**
 * Pi Tools — Unified Extension
 *
 * Combines the subagent delegation system, file manager,
 * planner, and execution orchestrator into a single extension entry point.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerSubagentTool } from "./subagent/subagent.js";
import { registerFileManager } from "./file-manager/index.js";
import { registerPlanner } from "./planner/index.js";
import { registerOrchestrator } from "./orchestrator/index.js";

export default function (pi: ExtensionAPI) {
	registerSubagentTool(pi);
	registerFileManager(pi);
	registerPlanner(pi);
	registerOrchestrator(pi);
}
