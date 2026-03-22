/**
 * Index management — full regeneration from archive directory contents.
 * Never patched incrementally; always rebuilt from scratch.
 */

import * as path from "node:path";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { listArchives } from "./archives.js";
import { writeFileSafe } from "./paths.js";

/** Relative path to the index file within archives/. */
const INDEX_FILE = "archives/INDEX.md";

/**
 * Regenerate the archive index from the archive directory.
 * Full rebuild — reads all archives, generates a markdown list, writes INDEX.md.
 * Idempotent — calling multiple times produces the same output.
 * Returns the generated markdown content.
 */
export async function regenerateIndex(root: string): Promise<string> {
	const indexPath = path.join(root, INDEX_FILE);

	return withFileMutationQueue(indexPath, async () => {
		const archives = listArchives(root);

		const lines: string[] = ["# Archive Index", ""];

		if (archives.length === 0) {
			lines.push("*No archives yet.*", "");
		} else {
			lines.push(`*${archives.length} archive${archives.length === 1 ? "" : "s"}*`, "");
			for (const entry of archives) {
				const dateDisplay = entry.date || "unknown date";
				lines.push(`- **${entry.filename}** — ${entry.title} (${dateDisplay})`);
			}
			lines.push("");
		}

		const content = lines.join("\n");
		writeFileSafe(indexPath, content);
		return content;
	});
}
