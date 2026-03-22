/**
 * Metadata tracking — JSON-based metadata with read-patch-write semantics.
 * Never throws; returns null/defaults on errors.
 */

import * as path from "node:path";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { readFileSafe, writeFileSafe } from "./paths.js";
import type { FileManagerMeta } from "./types.js";

/** Relative path to the metadata file within root. */
const META_FILE = "metadata/meta.json";

/** Current metadata schema version. */
const META_VERSION = "1.0.0";

/**
 * Create a new metadata object with defaults.
 */
export function createMeta(title: string = "", custom: Record<string, unknown> = {}): FileManagerMeta {
	const now = new Date().toISOString();
	return {
		version: META_VERSION,
		title,
		createdAt: now,
		updatedAt: now,
		custom,
	};
}

/**
 * Read metadata from the metadata file.
 * Returns null if missing, corrupt, or unreadable. Never throws.
 */
export function readMeta(root: string): FileManagerMeta | null {
	try {
		const metaPath = path.join(root, META_FILE);
		const raw = readFileSafe(metaPath);
		if (raw === null) return null;

		const parsed = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

		return {
			version: typeof parsed.version === "string" ? parsed.version : META_VERSION,
			title: typeof parsed.title === "string" ? parsed.title : "",
			createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
			updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
			custom: typeof parsed.custom === "object" && parsed.custom !== null && !Array.isArray(parsed.custom)
				? parsed.custom
				: {},
		};
	} catch {
		return null;
	}
}

/**
 * Update metadata with a partial patch. Performs read-patch-write.
 * Always updates `updatedAt`. Creates the file if missing.
 * Returns the updated metadata, or null on write failure.
 */
export async function updateMeta(
	root: string,
	patch: Partial<FileManagerMeta>,
): Promise<FileManagerMeta | null> {
	const metaPath = path.join(root, META_FILE);

	return withFileMutationQueue(metaPath, async () => {
		try {
			const existing = readMeta(root) ?? createMeta();
			const updated: FileManagerMeta = {
				...existing,
				...patch,
				updatedAt: new Date().toISOString(),
				custom: {
					...existing.custom,
					...(patch.custom ?? {}),
				},
			};

			if (writeFileSafe(metaPath, JSON.stringify(updated, null, 2) + "\n")) {
				return updated;
			}
			return null;
		} catch {
			return null;
		}
	});
}

/**
 * Get the path where metadata is stored.
 */
export function getMetaPath(root: string): string {
	return path.join(root, META_FILE);
}
