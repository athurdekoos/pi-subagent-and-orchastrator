/**
 * Diagnostic snapshots — read-only state capture for debugging.
 * Never logs file body content; only metadata (sizes, counts, existence).
 */

import * as path from "node:path";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { countArchives } from "./archives.js";

import { collisionSafePath } from "./naming.js";
import { fileLineCount, fileSize, isDirectory, isFile, writeFileSafe } from "./paths.js";
import { getPhase, hasActiveContent } from "./state.js";
import { analyzeTemplate, loadTemplate } from "./templates.js";
import type { DiagnosticSnapshot, FileManagerConfig, SubdirName } from "./types.js";
import { SUBDIRS } from "./types.js";

/**
 * Capture a read-only diagnostic snapshot.
 * Never modifies content files. Never logs file body content.
 */
export function captureSnapshot(
	root: string,
	config: FileManagerConfig,
): DiagnosticSnapshot {
	const errors: string[] = [];
	const timestamp = new Date().toISOString();

	// Phase detection
	const phase = getPhase(root, config.activeFilename);

	// Active content check
	let hasActive = false;
	let activeFileSize = 0;
	let activeFileLines = 0;
	try {
		hasActive = hasActiveContent(root, config.activeFilename);
		const activePath = path.join(root, "active", config.activeFilename);
		activeFileSize = fileSize(activePath);
		activeFileLines = fileLineCount(activePath);
	} catch (e) {
		errors.push(`Active content check failed: ${e}`);
	}

	// Archive count
	let archiveCount = 0;
	try {
		archiveCount = countArchives(root);
	} catch (e) {
		errors.push(`Archive count failed: ${e}`);
	}

	// Config presence
	const configPresent = isFile(path.join(root, "config", "settings.json"));

	// Metadata presence
	const metadataPresent = isFile(path.join(root, "metadata", "meta.json"));

	// Subdirectory existence
	const subdirs = {} as Record<SubdirName, boolean>;
	for (const subdir of SUBDIRS) {
		subdirs[subdir] = isDirectory(path.join(root, subdir));
	}

	// Config source
	let configSource = "defaults";
	if (configPresent) configSource = "config/settings.json";

	// Template analysis
	let templateAnalysis = null;
	try {
		const template = loadTemplate(root, "default");
		if (template) {
			templateAnalysis = analyzeTemplate(template).classification;
		}
	} catch {
		// ignore
	}

	return {
		timestamp,
		phase,
		hasActiveContent: hasActive,
		archiveCount,
		configPresent,
		metadataPresent,
		subdirs,
		activeFileSize,
		activeFileLines,
		configSource,
		templateAnalysis,
		errors,
	};
}

/**
 * Write a diagnostic snapshot to the log directory.
 * Uses collision-safe naming. Returns the written file path, or null on failure.
 */
export async function writeSnapshot(
	root: string,
	snapshot: DiagnosticSnapshot,
): Promise<string | null> {
	const logDir = path.join(root, "logs");

	return withFileMutationQueue(logDir, async () => {
		const now = new Date();
		const ts = [
			now.getFullYear(),
			String(now.getMonth() + 1).padStart(2, "0"),
			String(now.getDate()).padStart(2, "0"),
			"-",
			String(now.getHours()).padStart(2, "0"),
			String(now.getMinutes()).padStart(2, "0"),
		].join("");
		const basePath = path.join(logDir, `diagnostic-${ts}.json`);
		const finalPath = collisionSafePath(basePath, ".json");

		const content = JSON.stringify(snapshot, null, 2) + "\n";
		if (writeFileSafe(finalPath, content)) {
			return finalPath;
		}
		return null;
	});
}
