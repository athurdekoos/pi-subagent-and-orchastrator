/**
 * Directory structure initialization.
 * Idempotent — running multiple times produces the same result, never overwrites existing files.
 */

import * as path from "node:path";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { ensureDir, isDirectory, isFile, writeFileSafe } from "./paths.js";
import type { InitResult } from "./types.js";
import { SENTINEL, SUBDIRS } from "./types.js";

/**
 * Initialize the file manager directory structure.
 * Creates root + all subdirectories + placeholder active file.
 * Never overwrites existing files. Returns report of what was created vs skipped.
 */
export async function initializeStructure(
	root: string,
	activeFilename: string,
): Promise<InitResult> {
	const created: string[] = [];
	const skipped: string[] = [];

	return withFileMutationQueue(root, async () => {
		// Create root directory
		if (!isDirectory(root)) {
			if (ensureDir(root)) {
				created.push(root);
			}
		} else {
			skipped.push(root);
		}

		// Create subdirectories
		for (const subdir of SUBDIRS) {
			const subdirPath = path.join(root, subdir);
			if (!isDirectory(subdirPath)) {
				if (ensureDir(subdirPath)) {
					created.push(subdirPath);
				}
			} else {
				skipped.push(subdirPath);
			}
		}

		// Create placeholder active file
		const activeFilePath = path.join(root, "active", activeFilename);
		if (!isFile(activeFilePath)) {
			if (writeFileSafe(activeFilePath, SENTINEL + "\n")) {
				created.push(activeFilePath);
			}
		} else {
			skipped.push(activeFilePath);
		}

		return { created, skipped };
	});
}

/**
 * Check if initialization has been fully completed.
 */
export function isInitialized(root: string): boolean {
	if (!isDirectory(root)) return false;
	for (const subdir of SUBDIRS) {
		if (!isDirectory(path.join(root, subdir))) return false;
	}
	return true;
}
