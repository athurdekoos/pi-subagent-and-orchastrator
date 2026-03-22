/**
 * State detection — computed from filesystem, never stored separately.
 * All functions never throw; they return null/false on errors.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { isDirectory, isFile, readFileSafe, resolveRoot } from "./paths.js";
import type { FileManagerConfig, Phase, StateInfo } from "./types.js";
import { SENTINEL, SUBDIRS } from "./types.js";

/**
 * Detect the root directory. Returns absolute path if it exists, null otherwise.
 */
export function detectRoot(cwd: string, configuredRoot: string): string | null {
	try {
		const root = resolveRoot(cwd, configuredRoot);
		return isDirectory(root) ? root : null;
	} catch {
		return null;
	}
}

/**
 * Check if the directory structure is fully initialized.
 * All subdirectories must exist.
 */
export function isFullyInitialized(root: string): boolean {
	try {
		for (const subdir of SUBDIRS) {
			if (!isDirectory(path.join(root, subdir))) return false;
		}
		return true;
	} catch {
		return false;
	}
}

/**
 * Check if the active file contains real (non-sentinel) content.
 */
export function hasActiveContent(root: string, activeFilename: string): boolean {
	try {
		const filePath = path.join(root, "active", activeFilename);
		if (!isFile(filePath)) return false;
		const content = readFileSafe(filePath);
		if (content === null) return false;
		const trimmed = content.trim();
		return trimmed.length > 0 && trimmed !== SENTINEL;
	} catch {
		return false;
	}
}

/**
 * Compute the current phase from filesystem state.
 * - "uninitialized": root doesn't exist
 * - "initialized": dirs exist, no active content
 * - "active": active file has real content
 * - "archived": archives dir has entries (regardless of active state)
 */
export function getPhase(root: string, activeFilename: string): Phase {
	try {
		if (!isDirectory(root)) return "uninitialized";

		// Check if archives exist
		const archivesDir = path.join(root, "archives");
		if (isDirectory(archivesDir)) {
			try {
				const entries = fs.readdirSync(archivesDir);
				const hasArchives = entries.some(
					(e: string) => e.endsWith(".md") && e !== "INDEX.md",
				);
				if (hasArchives) return "archived";
			} catch {
				// fall through
			}
		}

		if (hasActiveContent(root, activeFilename)) return "active";
		if (isFullyInitialized(root)) return "initialized";
		return "uninitialized";
	} catch {
		return "uninitialized";
	}
}

/**
 * Get a complete state info snapshot.
 */
export function getStateInfo(cwd: string, config: FileManagerConfig): StateInfo {
	const root = detectRoot(cwd, config.rootDir);
	if (!root) {
		return { root: null, initialized: false, hasActive: false, phase: "uninitialized" };
	}
	return {
		root,
		initialized: isFullyInitialized(root),
		hasActive: hasActiveContent(root, config.activeFilename),
		phase: getPhase(root, config.activeFilename),
	};
}
