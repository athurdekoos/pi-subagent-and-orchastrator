/**
 * Configuration system.
 * Loads from JSON, validates per-field with fallback to defaults, never throws.
 */

import * as path from "node:path";
import { readFileSafe, writeFileSafe } from "./paths.js";
import type { ArchiveDateFormat, FileManagerConfig } from "./types.js";

/** Default configuration values. */
export const CONFIG_DEFAULTS: FileManagerConfig = {
	rootDir: ".pi/file-manager",
	contentType: "content",
	activeFilename: "current.md",
	archiveDateFormat: "full",
	maxListEntries: 50,
	logDir: "logs",
	debug: false,
};

/** Relative path to the config file within root. */
const CONFIG_FILE = "config/settings.json";

/**
 * Load configuration from the config file.
 * Never throws — returns defaults on missing or corrupt file.
 * Per-field validation: invalid fields fall back to defaults, valid fields preserved.
 * Unknown keys are silently ignored.
 */
export function loadConfig(root: string): FileManagerConfig {
	const configPath = path.join(root, CONFIG_FILE);
	const raw = readFileSafe(configPath);
	if (raw === null) return { ...CONFIG_DEFAULTS };

	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { ...CONFIG_DEFAULTS };
	}

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return { ...CONFIG_DEFAULTS };
	}

	return {
		rootDir: validateString(parsed.rootDir, CONFIG_DEFAULTS.rootDir),
		contentType: validateString(parsed.contentType, CONFIG_DEFAULTS.contentType),
		activeFilename: validateFilename(parsed.activeFilename, CONFIG_DEFAULTS.activeFilename),
		archiveDateFormat: validateEnum(
			parsed.archiveDateFormat,
			["full", "date-only"] as const,
			CONFIG_DEFAULTS.archiveDateFormat,
		),
		maxListEntries: validatePositiveInt(parsed.maxListEntries, CONFIG_DEFAULTS.maxListEntries),
		logDir: validatePathField(parsed.logDir, CONFIG_DEFAULTS.logDir),
		debug: validateBoolean(parsed.debug, CONFIG_DEFAULTS.debug),
	};
}

/**
 * Save configuration to the config file.
 * Merges with existing config.
 */
export function saveConfig(root: string, patch: Partial<FileManagerConfig>): boolean {
	const existing = loadConfig(root);
	const merged = { ...existing, ...patch };
	const configPath = path.join(root, CONFIG_FILE);
	return writeFileSafe(configPath, JSON.stringify(merged, null, 2) + "\n");
}

/**
 * Get the path where configuration would be or is stored.
 */
export function getConfigPath(root: string): string {
	return path.join(root, CONFIG_FILE);
}

// --- Validation helpers ---

function validateString(value: unknown, fallback: string): string {
	return typeof value === "string" && value.length > 0 ? value : fallback;
}

function validateFilename(value: unknown, fallback: string): string {
	if (typeof value !== "string" || value.length === 0) return fallback;
	if (value.includes("..") || value.includes("/") || value.includes("\\")) return fallback;
	return value;
}

function validatePathField(value: unknown, fallback: string): string {
	if (typeof value !== "string" || value.length === 0) return fallback;
	if (value.includes("..")) return fallback;
	return value;
}

function validateEnum<T extends string>(
	value: unknown,
	allowed: readonly T[],
	fallback: T,
): T {
	if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
		return value as T;
	}
	return fallback;
}

function validatePositiveInt(value: unknown, fallback: number): number {
	if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
	return fallback;
}

function validateBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}
