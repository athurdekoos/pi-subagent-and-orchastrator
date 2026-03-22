/**
 * Archive lifecycle — immutable, write-once archives with deterministic naming.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { readContent, resetContent } from "./content.js";
import { collisionSafePath, generateFilename } from "./naming.js";
import { isContainedIn, readFileSafe, safePath, writeFileSafe } from "./paths.js";
import type { ArchiveEntry, FileManagerConfig } from "./types.js";

/**
 * Extract a title from markdown content.
 * Tries H1 heading first, then first non-empty line, then "untitled".
 */
export function extractTitle(content: string): string {
	// Try H1 heading
	const h1Match = content.match(/^#\s+(.+)$/m);
	if (h1Match) return h1Match[1].trim();

	// Try first non-empty line
	const lines = content.split("\n");
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.length > 0) return trimmed;
	}

	return "untitled";
}

/**
 * Parse an archive filename to extract date and slug.
 * Expects format: YYYY-MM-DD-HHMM-slug.md or YYYY-MM-DD-slug.md
 */
function parseArchiveFilename(filename: string): { date: string; slug: string } | null {
	// Full format: YYYY-MM-DD-HHMM-slug.md
	const fullMatch = filename.match(/^(\d{4}-\d{2}-\d{2}-\d{4})-(.+)\.md$/);
	if (fullMatch) return { date: fullMatch[1], slug: fullMatch[2] };

	// Date-only format: YYYY-MM-DD-slug.md
	const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})-(.+)\.md$/);
	if (dateMatch) return { date: dateMatch[1], slug: dateMatch[2] };

	// Date-only without slug: YYYY-MM-DD.md
	const dateOnlyMatch = filename.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
	if (dateOnlyMatch) return { date: dateOnlyMatch[1], slug: "" };

	return null;
}

/**
 * Archive the active content file.
 * Reads active → generates archive filename → writes to archives/ → resets active.
 * Returns the archive entry, or null if nothing to archive.
 */
export async function archiveActive(
	root: string,
	activeFilename: string,
	config: FileManagerConfig,
): Promise<ArchiveEntry | null> {
	const archivesDir = path.join(root, "archives");

	return withFileMutationQueue(archivesDir, async () => {
		// Read active content
		const content = readContent(root, activeFilename);
		if (content === null) return null;

		// Generate archive filename
		const title = extractTitle(content);
		const baseFilename = generateFilename(title, config.archiveDateFormat);
		const basePath = path.join(archivesDir, baseFilename);
		const finalPath = collisionSafePath(basePath, ".md");
		const finalFilename = path.basename(finalPath);

		// Write archive (write-once)
		if (!writeFileSafe(finalPath, content)) return null;

		// Reset active content
		await resetContent(root, activeFilename);

		// Parse the filename for the entry
		const parsed = parseArchiveFilename(finalFilename);

		return {
			filename: finalFilename,
			path: finalPath,
			title,
			date: parsed?.date ?? "",
		};
	});
}

/**
 * List all archives, sorted newest-first.
 * Path traversal protection applied.
 */
export function listArchives(root: string, limit?: number): ArchiveEntry[] {
	try {
		const archivesDir = path.join(root, "archives");
		if (!fs.existsSync(archivesDir)) return [];

		const entries = fs.readdirSync(archivesDir, { withFileTypes: true });
		const archives: ArchiveEntry[] = [];

		for (const entry of entries) {
			if (!entry.isFile() && !entry.isSymbolicLink()) continue;
			if (!entry.name.endsWith(".md")) continue;
			if (entry.name === "INDEX.md") continue;

			const filePath = path.join(archivesDir, entry.name);
			if (!isContainedIn(filePath, archivesDir)) continue;

			const content = readFileSafe(filePath);
			const title = content ? extractTitle(content) : "untitled";
			const parsed = parseArchiveFilename(entry.name);

			archives.push({
				filename: entry.name,
				path: filePath,
				title,
				date: parsed?.date ?? "",
			});
		}

		// Sort newest-first (string sort descending on filename)
		archives.sort((a, b) => b.filename.localeCompare(a.filename));

		if (limit !== undefined && limit > 0) {
			return archives.slice(0, limit);
		}
		return archives;
	} catch {
		return [];
	}
}

/**
 * Count archives without loading content.
 */
export function countArchives(root: string): number {
	try {
		const archivesDir = path.join(root, "archives");
		if (!fs.existsSync(archivesDir)) return 0;

		const entries = fs.readdirSync(archivesDir);
		return entries.filter((e) => e.endsWith(".md") && e !== "INDEX.md").length;
	} catch {
		return 0;
	}
}

/**
 * Read a single archive by filename.
 * Path traversal protection via safePath.
 */
export function getArchive(root: string, filename: string): string | null {
	const archivesDir = path.join(root, "archives");
	const resolved = safePath(archivesDir, filename);
	if (resolved === null) return null;
	return readFileSafe(resolved);
}
