/**
 * Active content management — CRUD operations with safety checks.
 * Safe write refuses to overwrite real content without explicit intent.
 */

import * as path from "node:path";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { ensureDir, isFile, readFileSafe, writeFileSafe } from "./paths.js";
import type { SafeWriteResult } from "./types.js";
import { SENTINEL } from "./types.js";

/**
 * Get the absolute path to the active content file.
 */
export function getActiveFilePath(root: string, activeFilename: string): string {
	return path.join(root, "active", activeFilename);
}

/**
 * Read the active content file.
 * Returns the content string, or null if the file is missing, empty, or contains only the sentinel.
 */
export function readContent(root: string, activeFilename: string): string | null {
	const filePath = getActiveFilePath(root, activeFilename);
	const content = readFileSafe(filePath);
	if (content === null) return null;
	const trimmed = content.trim();
	if (trimmed.length === 0 || trimmed === SENTINEL) return null;
	return content;
}

/**
 * Check if the active file contains real (non-sentinel) content.
 */
export function hasRealContent(root: string, activeFilename: string): boolean {
	return readContent(root, activeFilename) !== null;
}

/**
 * Safe write — refuses to overwrite files containing real content.
 * Use this when the caller has NOT handled archival.
 */
export async function safeWrite(
	root: string,
	activeFilename: string,
	content: string,
): Promise<SafeWriteResult> {
	const filePath = getActiveFilePath(root, activeFilename);

	return withFileMutationQueue(filePath, async () => {
		if (hasRealContent(root, activeFilename)) {
			return {
				ok: false,
				reason: "Active content exists; archive first or use force write",
			};
		}

		ensureDir(path.dirname(filePath));
		if (writeFileSafe(filePath, content)) {
			return { ok: true };
		}
		return { ok: false, reason: "Failed to write file" };
	});
}

/**
 * Force write — unconditional write when caller has already handled archival.
 */
export async function forceWrite(
	root: string,
	activeFilename: string,
	content: string,
): Promise<boolean> {
	const filePath = getActiveFilePath(root, activeFilename);

	return withFileMutationQueue(filePath, async () => {
		ensureDir(path.dirname(filePath));
		return writeFileSafe(filePath, content);
	});
}

/**
 * Reset the active file to its placeholder state with sentinel.
 * Does not delete the file — writes the sentinel value back.
 */
export async function resetContent(
	root: string,
	activeFilename: string,
): Promise<boolean> {
	const filePath = getActiveFilePath(root, activeFilename);

	return withFileMutationQueue(filePath, async () => {
		return writeFileSafe(filePath, SENTINEL + "\n");
	});
}
