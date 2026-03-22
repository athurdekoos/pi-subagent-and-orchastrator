/**
 * CI Verification — Plan validation entry points for CI pipelines.
 *
 * These functions use only Node.js builtins and the existing validator,
 * with no dependency on the ExtensionAPI.
 */

import * as fs from "node:fs";
import type { Plan, ValidationResult } from "./types.js";
import { validatePlan } from "./validator.js";

/**
 * Validate a plan from a JSON string.
 * Throws if the JSON is unparseable.
 */
export function validatePlanFromString(json: string): ValidationResult {
	const plan = JSON.parse(json) as Plan;
	return validatePlan(plan);
}

/**
 * Validate a plan from a JSON file on disk.
 * Throws if the file is missing or unparseable.
 */
export function validatePlanFromDisk(planJsonPath: string): ValidationResult {
	const raw = fs.readFileSync(planJsonPath, "utf-8");
	return validatePlanFromString(raw);
}
