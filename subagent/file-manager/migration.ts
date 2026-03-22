/**
 * Migration support — detect legacy layouts and safely migrate.
 * Never deletes files; copies/moves only. Idempotent.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { ensureDir, isDirectory, isFile, readFileSafe, writeFileSafe } from "./paths.js";
import type { FileManagerConfig, MigrationResult } from "./types.js";
import { SUBDIRS } from "./types.js";

/**
 * Detect legacy file layouts that need migration.
 */
export function detectLegacyLayout(root: string): { isLegacy: boolean; details: string[] } {
	const details: string[] = [];

	// Check for missing subdirectories
	for (const subdir of SUBDIRS) {
		if (!isDirectory(path.join(root, subdir))) {
			details.push(`Missing subdirectory: ${subdir}`);
		}
	}

	// Check for monolithic file at root level (legacy pattern)
	const rootFiles = ["current.md", "plan.md", "notes.md", "content.md"];
	for (const file of rootFiles) {
		if (isFile(path.join(root, file))) {
			details.push(`Legacy file at root: ${file} (should be in active/)`);
		}
	}

	// Check for archives at root level instead of in archives/
	try {
		const entries = fs.readdirSync(root, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.isFile() && entry.name.endsWith(".md") && entry.name.match(/^\d{4}-\d{2}-\d{2}/)) {
				details.push(`Archive at root level: ${entry.name} (should be in archives/)`);
			}
		}
	} catch {
		// ignore
	}

	return { isLegacy: details.length > 0, details };
}

/**
 * Migrate a legacy layout to the current structure.
 * Never deletes legacy files — copies them to the correct location.
 * Idempotent — safe to re-run.
 */
export async function migrate(
	root: string,
	config: FileManagerConfig,
): Promise<MigrationResult> {
	const actions: string[] = [];
	let isLegacy = false;

	return withFileMutationQueue(root, async () => {
		// Ensure all subdirectories exist
		for (const subdir of SUBDIRS) {
			const subdirPath = path.join(root, subdir);
			if (!isDirectory(subdirPath)) {
				ensureDir(subdirPath);
				actions.push(`Created missing subdirectory: ${subdir}`);
				isLegacy = true;
			}
		}

		// Move root-level content files to active/
		const rootFiles = ["current.md", "plan.md", "notes.md", "content.md"];
		for (const file of rootFiles) {
			const srcPath = path.join(root, file);
			if (!isFile(srcPath)) continue;

			const destPath = path.join(root, "active", file);
			if (isFile(destPath)) {
				actions.push(`Skipped ${file}: already exists in active/`);
				continue;
			}

			const content = readFileSafe(srcPath);
			if (content !== null && writeFileSafe(destPath, content)) {
				actions.push(`Copied ${file} → active/${file}`);
				isLegacy = true;
			}
		}

		// Move root-level archive files to archives/
		try {
			const entries = fs.readdirSync(root, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isFile()) continue;
				if (!entry.name.match(/^\d{4}-\d{2}-\d{2}/)) continue;
				if (!entry.name.endsWith(".md")) continue;

				const srcPath = path.join(root, entry.name);
				const destPath = path.join(root, "archives", entry.name);
				if (isFile(destPath)) {
					actions.push(`Skipped ${entry.name}: already exists in archives/`);
					continue;
				}

				const content = readFileSafe(srcPath);
				if (content !== null && writeFileSafe(destPath, content)) {
					actions.push(`Copied ${entry.name} → archives/${entry.name}`);
					isLegacy = true;
				}
			}
		} catch {
			// ignore
		}

		return { isLegacy, actions };
	});
}

/**
 * Import content from an external file path into the active content.
 * Does not delete the source file.
 */
export async function importFromExternal(
	root: string,
	sourcePath: string,
	activeFilename: string,
): Promise<{ ok: boolean; error?: string }> {
	return withFileMutationQueue(root, async () => {
		if (!isFile(sourcePath)) {
			return { ok: false, error: `Source file not found: ${sourcePath}` };
		}

		const content = readFileSafe(sourcePath);
		if (content === null) {
			return { ok: false, error: `Failed to read source file: ${sourcePath}` };
		}

		const destPath = path.join(root, "active", activeFilename);
		if (writeFileSafe(destPath, content)) {
			return { ok: true };
		}
		return { ok: false, error: "Failed to write to active content" };
	});
}
