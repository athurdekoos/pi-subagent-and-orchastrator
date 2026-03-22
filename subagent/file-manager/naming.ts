/**
 * File naming utilities.
 * Pure functions for generating deterministic, sortable, collision-safe filenames.
 */

import * as fs from "node:fs";
import type { ArchiveDateFormat } from "./types.js";

/**
 * Convert text to a URL/filesystem-safe slug.
 * Lowercase, alphanumeric + hyphens, collapsed, trimmed, max length.
 */
export function slugify(text: string, maxLen: number = 50): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/-{2,}/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, maxLen)
		.replace(/-$/, "");
}

/**
 * Generate a timestamp prefix for filenames.
 * "full" → YYYY-MM-DD-HHMM, "date-only" → YYYY-MM-DD.
 */
export function timestampPrefix(format: ArchiveDateFormat = "full"): string {
	const now = new Date();
	const y = now.getFullYear();
	const mo = String(now.getMonth() + 1).padStart(2, "0");
	const d = String(now.getDate()).padStart(2, "0");
	if (format === "date-only") return `${y}-${mo}-${d}`;
	const h = String(now.getHours()).padStart(2, "0");
	const mi = String(now.getMinutes()).padStart(2, "0");
	return `${y}-${mo}-${d}-${h}${mi}`;
}

/**
 * Generate a complete filename from a title.
 * Combines timestamp prefix + slugified title + extension.
 */
export function generateFilename(
	title: string,
	format: ArchiveDateFormat = "full",
	ext: string = ".md",
): string {
	const ts = timestampPrefix(format);
	const slug = slugify(title);
	if (!slug) return `${ts}${ext}`;
	return `${ts}-${slug}${ext}`;
}

/**
 * Find a collision-free path by appending -1, -2, etc. if the base path exists.
 * Returns the final available path.
 */
export function collisionSafePath(basePath: string, ext: string = ".md"): string {
	if (!fs.existsSync(basePath)) return basePath;

	const withoutExt = basePath.slice(0, basePath.length - ext.length);
	let counter = 1;
	while (true) {
		const candidate = `${withoutExt}-${counter}${ext}`;
		if (!fs.existsSync(candidate)) return candidate;
		counter++;
		if (counter > 1000) break; // safety valve
	}
	return `${withoutExt}-${Date.now()}${ext}`;
}
