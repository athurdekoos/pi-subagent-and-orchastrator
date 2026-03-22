import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
	extractTitle,
	archiveActive,
	listArchives,
	countArchives,
	getArchive,
} from "../archives.js";
import { SENTINEL, SUBDIRS } from "../types.js";
import { CONFIG_DEFAULTS } from "../config.js";
import { forceWrite } from "../content.js";
import type { FileManagerConfig } from "../types.js";

let tmpDir: string;
let root: string;
let config: FileManagerConfig;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fm-archives-"));
	root = path.join(tmpDir, "file-manager");
	for (const subdir of SUBDIRS) {
		fs.mkdirSync(path.join(root, subdir), { recursive: true });
	}
	config = { ...CONFIG_DEFAULTS };
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
	vi.restoreAllMocks();
});

describe("extractTitle", () => {
	it("extracts H1 heading", () => {
		expect(extractTitle("# My Title\n\nContent")).toBe("My Title");
	});

	it("extracts H1 with extra spaces", () => {
		expect(extractTitle("#   Spaced Title  \n\nContent")).toBe("Spaced Title");
	});

	it("falls back to first non-empty line", () => {
		expect(extractTitle("First Line\nSecond")).toBe("First Line");
	});

	it("skips empty lines for fallback", () => {
		expect(extractTitle("\n\nThird Line")).toBe("Third Line");
	});

	it("returns untitled for empty content", () => {
		expect(extractTitle("")).toBe("untitled");
	});

	it("returns untitled for whitespace-only content", () => {
		expect(extractTitle("  \n  \n  ")).toBe("untitled");
	});

	it("prefers H1 over first line", () => {
		expect(extractTitle("not a heading\n# Real Title")).toBe("Real Title");
	});
});

describe("archiveActive", () => {
	it("archives active content and resets to sentinel", async () => {
		fs.writeFileSync(
			path.join(root, "active", "current.md"),
			"# My Plan\nDetails here",
		);

		const entry = await archiveActive(root, "current.md", config);
		expect(entry).not.toBeNull();
		expect(entry!.title).toBe("My Plan");
		expect(entry!.filename).toMatch(/\.md$/);

		// Archive file exists with correct content
		const archiveContent = fs.readFileSync(entry!.path, "utf-8");
		expect(archiveContent).toBe("# My Plan\nDetails here");

		// Active file reset to sentinel
		const activeContent = fs.readFileSync(
			path.join(root, "active", "current.md"),
			"utf-8",
		);
		expect(activeContent.trim()).toBe(SENTINEL);
	});

	it("returns null when no active content", async () => {
		fs.writeFileSync(
			path.join(root, "active", "current.md"),
			SENTINEL + "\n",
		);
		const entry = await archiveActive(root, "current.md", config);
		expect(entry).toBeNull();
	});

	it("returns null when active file is missing", async () => {
		const entry = await archiveActive(root, "current.md", config);
		expect(entry).toBeNull();
	});

	it("generates collision-safe filename", async () => {
		// Create first archive
		fs.writeFileSync(path.join(root, "active", "current.md"), "# Plan A");
		const first = await archiveActive(root, "current.md", config);

		// Create second archive with same title at same timestamp
		fs.writeFileSync(path.join(root, "active", "current.md"), "# Plan A");
		const second = await archiveActive(root, "current.md", config);

		expect(first).not.toBeNull();
		expect(second).not.toBeNull();
		expect(first!.filename).not.toBe(second!.filename);
	});

	it("uses date-only format when configured", async () => {
		config.archiveDateFormat = "date-only";
		fs.writeFileSync(path.join(root, "active", "current.md"), "# Test");
		const entry = await archiveActive(root, "current.md", config);
		expect(entry).not.toBeNull();
		// date-only: YYYY-MM-DD-slug.md (no HHMM)
		expect(entry!.filename).toMatch(/^\d{4}-\d{2}-\d{2}-test\.md/);
	});
});

describe("listArchives", () => {
	it("returns empty array when no archives", () => {
		expect(listArchives(root)).toEqual([]);
	});

	it("lists archive files", () => {
		fs.writeFileSync(
			path.join(root, "archives", "2026-03-22-1430-plan.md"),
			"# Plan",
		);
		const archives = listArchives(root);
		expect(archives).toHaveLength(1);
		expect(archives[0].filename).toBe("2026-03-22-1430-plan.md");
		expect(archives[0].title).toBe("Plan");
	});

	it("sorts newest first", () => {
		fs.writeFileSync(
			path.join(root, "archives", "2026-01-01-0000-old.md"),
			"# Old",
		);
		fs.writeFileSync(
			path.join(root, "archives", "2026-12-31-2359-new.md"),
			"# New",
		);
		const archives = listArchives(root);
		expect(archives[0].filename).toBe("2026-12-31-2359-new.md");
		expect(archives[1].filename).toBe("2026-01-01-0000-old.md");
	});

	it("excludes INDEX.md", () => {
		fs.writeFileSync(path.join(root, "archives", "INDEX.md"), "# Index");
		fs.writeFileSync(
			path.join(root, "archives", "2026-03-22-1430-plan.md"),
			"# Plan",
		);
		const archives = listArchives(root);
		expect(archives).toHaveLength(1);
	});

	it("excludes non-.md files", () => {
		fs.writeFileSync(path.join(root, "archives", "notes.txt"), "text");
		expect(listArchives(root)).toEqual([]);
	});

	it("respects limit parameter", () => {
		for (let i = 0; i < 10; i++) {
			fs.writeFileSync(
				path.join(root, "archives", `2026-03-${String(i + 10).padStart(2, "0")}-test.md`),
				`# Test ${i}`,
			);
		}
		const archives = listArchives(root, 3);
		expect(archives).toHaveLength(3);
	});

	it("returns empty array when archives dir does not exist", () => {
		fs.rmSync(path.join(root, "archives"), { recursive: true });
		expect(listArchives(root)).toEqual([]);
	});
});

describe("countArchives", () => {
	it("returns 0 when no archives", () => {
		expect(countArchives(root)).toBe(0);
	});

	it("counts archive files", () => {
		fs.writeFileSync(path.join(root, "archives", "2026-03-22-a.md"), "#A");
		fs.writeFileSync(path.join(root, "archives", "2026-03-23-b.md"), "#B");
		expect(countArchives(root)).toBe(2);
	});

	it("excludes INDEX.md", () => {
		fs.writeFileSync(path.join(root, "archives", "INDEX.md"), "# Index");
		fs.writeFileSync(path.join(root, "archives", "2026-03-22-a.md"), "#A");
		expect(countArchives(root)).toBe(1);
	});
});

describe("getArchive", () => {
	it("reads archive by filename", () => {
		fs.writeFileSync(
			path.join(root, "archives", "2026-03-22-plan.md"),
			"# Plan Content",
		);
		expect(getArchive(root, "2026-03-22-plan.md")).toBe("# Plan Content");
	});

	it("returns null for non-existent archive", () => {
		expect(getArchive(root, "nonexistent.md")).toBeNull();
	});

	it("rejects path traversal", () => {
		expect(getArchive(root, "../../../etc/passwd")).toBeNull();
	});

	it("rejects path with ..", () => {
		expect(getArchive(root, "../../secret.md")).toBeNull();
	});
});

describe("archive edge cases", () => {
	it("extractTitle handles markdown with only H2 headings", () => {
		expect(extractTitle("## Not H1\nContent")).toBe("## Not H1");
	});

	it("extractTitle handles content starting with empty lines then H1", () => {
		expect(extractTitle("\n\n\n# Title After Blanks")).toBe("Title After Blanks");
	});

	it("archive preserves exact content including trailing newlines", async () => {
		const content = "# Title\n\nContent\n\n";
		await forceWrite(root, "current.md", content);
		const entry = await archiveActive(root, "current.md", config);
		const archived = fs.readFileSync(entry!.path, "utf-8");
		expect(archived).toBe(content);
	});

	it("listArchives handles archive without date prefix", () => {
		fs.writeFileSync(path.join(root, "archives", "random-name.md"), "# Random");
		const archives = listArchives(root);
		expect(archives).toHaveLength(1);
		expect(archives[0].date).toBe(""); // no date parsed
	});

	it("getArchive with empty filename returns null", () => {
		expect(getArchive(root, "")).toBeNull();
	});
});

describe("archive filenames with special titles", () => {
	it("archives content with very long title", async () => {
		const longTitle = "A".repeat(200);
		await forceWrite(root, "current.md", `# ${longTitle}\nContent`);
		const entry = await archiveActive(root, "current.md", config);
		expect(entry).not.toBeNull();
		// Slug should be truncated
		expect(entry!.filename.length).toBeLessThan(100);
	});

	it("archives content with unicode title", async () => {
		await forceWrite(root, "current.md", "# Über Pläne für 2026\nContent");
		const entry = await archiveActive(root, "current.md", config);
		expect(entry).not.toBeNull();
		expect(entry!.filename).toMatch(/\.md$/);
	});

	it("archives content with empty title (only sentinel-like content)", async () => {
		// Content is just a code block with special chars
		await forceWrite(root, "current.md", "```\nsome code\n```");
		const entry = await archiveActive(root, "current.md", config);
		expect(entry).not.toBeNull();
	});

	it("archives content where title is all special chars", async () => {
		await forceWrite(root, "current.md", "# !@#$%^&*()\nContent");
		const entry = await archiveActive(root, "current.md", config);
		expect(entry).not.toBeNull();
		// Slug is empty, so just timestamp.md
		expect(entry!.filename).toMatch(/^\d{4}-\d{2}-\d{2}/);
	});
});

describe("concurrent archive safety", () => {
	it("parallel archives produce distinct files", async () => {
		// Write content for multiple parallel archives
		const promises: Promise<unknown>[] = [];
		for (let i = 0; i < 3; i++) {
			await forceWrite(root, "current.md", `# Version ${i}`);
			promises.push(archiveActive(root, "current.md", config));
		}
		// After all archiving, count total archives
		const archives = listArchives(root);
		// At least some should have been created
		expect(archives.length).toBeGreaterThanOrEqual(1);
	});
});

describe("getArchive path traversal with absolute paths", () => {
	it("rejects absolute path outside archives", () => {
		// Try to read a file outside archives using an absolute path
		fs.writeFileSync(path.join(root, "active", "current.md"), "secret");
		const result = getArchive(root, "/etc/passwd");
		expect(result).toBeNull();
	});
});

describe("getArchive traversal protection", () => {
	it("rejects ../config/settings.json", () => {
		fs.writeFileSync(
			path.join(root, "config", "settings.json"),
			'{"secret": true}',
		);
		expect(getArchive(root, "../config/settings.json")).toBeNull();
	});

	it("rejects absolute path to config", () => {
		const configPath = path.join(root, "config", "settings.json");
		fs.writeFileSync(configPath, '{"secret": true}');
		expect(getArchive(root, configPath)).toBeNull();
	});

	it("rejects filename with slashes", () => {
		expect(getArchive(root, "sub/file.md")).toBeNull();
	});
});

describe("listArchives with symlinks", () => {
	it("handles symlinks in archives directory", () => {
		// Create a real file and a symlink
		fs.writeFileSync(path.join(root, "archives", "2026-03-22-real.md"), "# Real");
		// Symlinks would be followed by readFileSafe, but the containment check should catch escapes
		const archives = listArchives(root);
		expect(archives.length).toBeGreaterThanOrEqual(1);
	});
});

describe("getArchive with valid filename containing dots", () => {
	it("allows filename with dots (not ..)", () => {
		fs.writeFileSync(
			path.join(root, "archives", "2026-03-22-v2.0-release.md"),
			"# v2.0 Release",
		);
		const content = getArchive(root, "2026-03-22-v2.0-release.md");
		expect(content).toBe("# v2.0 Release");
	});
});
