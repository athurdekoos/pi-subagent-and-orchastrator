import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
	getActiveFilePath,
	readContent,
	hasRealContent,
	safeWrite,
	forceWrite,
	resetContent,
} from "../content.js";
import { SENTINEL, SUBDIRS } from "../types.js";
import { CONFIG_DEFAULTS } from "../config.js";
import { archiveActive } from "../archives.js";
import type { FileManagerConfig } from "../types.js";

let tmpDir: string;
let root: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fm-content-"));
	root = path.join(tmpDir, "file-manager");
	fs.mkdirSync(path.join(root, "active"), { recursive: true });
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("getActiveFilePath", () => {
	it("returns correct path", () => {
		expect(getActiveFilePath("/root", "current.md")).toBe("/root/active/current.md");
	});
});

describe("readContent", () => {
	it("returns null when file does not exist", () => {
		expect(readContent(root, "current.md")).toBeNull();
	});

	it("returns null when file contains sentinel", () => {
		fs.writeFileSync(path.join(root, "active", "current.md"), SENTINEL + "\n");
		expect(readContent(root, "current.md")).toBeNull();
	});

	it("returns null when file is empty", () => {
		fs.writeFileSync(path.join(root, "active", "current.md"), "");
		expect(readContent(root, "current.md")).toBeNull();
	});

	it("returns null when file is whitespace only", () => {
		fs.writeFileSync(path.join(root, "active", "current.md"), "  \n  ");
		expect(readContent(root, "current.md")).toBeNull();
	});

	it("returns content when file has real content", () => {
		fs.writeFileSync(path.join(root, "active", "current.md"), "# My Plan\nDetails");
		expect(readContent(root, "current.md")).toBe("# My Plan\nDetails");
	});
});

describe("hasRealContent", () => {
	it("returns false for missing file", () => {
		expect(hasRealContent(root, "current.md")).toBe(false);
	});

	it("returns true for real content", () => {
		fs.writeFileSync(path.join(root, "active", "current.md"), "# Content");
		expect(hasRealContent(root, "current.md")).toBe(true);
	});
});

describe("safeWrite", () => {
	it("writes content when no active content exists", async () => {
		const result = await safeWrite(root, "current.md", "# New Content");
		expect(result.ok).toBe(true);
		const content = fs.readFileSync(path.join(root, "active", "current.md"), "utf-8");
		expect(content).toBe("# New Content");
	});

	it("writes content when file has sentinel", async () => {
		fs.writeFileSync(path.join(root, "active", "current.md"), SENTINEL + "\n");
		const result = await safeWrite(root, "current.md", "# New Content");
		expect(result.ok).toBe(true);
	});

	it("refuses to overwrite real content", async () => {
		fs.writeFileSync(path.join(root, "active", "current.md"), "# Real Content");
		const result = await safeWrite(root, "current.md", "# Replacement");
		expect(result.ok).toBe(false);
		expect(result.reason).toContain("archive first");
		// Original content preserved
		const content = fs.readFileSync(path.join(root, "active", "current.md"), "utf-8");
		expect(content).toBe("# Real Content");
	});

	it("creates parent directories if needed", async () => {
		const freshRoot = path.join(tmpDir, "new-root");
		// active/ doesn't exist yet
		const result = await safeWrite(freshRoot, "current.md", "# Content");
		expect(result.ok).toBe(true);
		expect(fs.existsSync(path.join(freshRoot, "active", "current.md"))).toBe(true);
	});
});

describe("forceWrite", () => {
	it("writes content unconditionally", async () => {
		fs.writeFileSync(path.join(root, "active", "current.md"), "# Old Content");
		const ok = await forceWrite(root, "current.md", "# New Content");
		expect(ok).toBe(true);
		const content = fs.readFileSync(path.join(root, "active", "current.md"), "utf-8");
		expect(content).toBe("# New Content");
	});

	it("creates file and dirs if needed", async () => {
		const freshRoot = path.join(tmpDir, "force-root");
		const ok = await forceWrite(freshRoot, "current.md", "# Fresh");
		expect(ok).toBe(true);
		expect(fs.existsSync(path.join(freshRoot, "active", "current.md"))).toBe(true);
	});
});

describe("resetContent", () => {
	it("resets file to sentinel", async () => {
		fs.writeFileSync(path.join(root, "active", "current.md"), "# Real Content");
		const ok = await resetContent(root, "current.md");
		expect(ok).toBe(true);
		const content = fs.readFileSync(path.join(root, "active", "current.md"), "utf-8");
		expect(content.trim()).toBe(SENTINEL);
	});

	it("content is null after reset", async () => {
		fs.writeFileSync(path.join(root, "active", "current.md"), "# Real Content");
		await resetContent(root, "current.md");
		expect(readContent(root, "current.md")).toBeNull();
	});
});

describe("content lifecycle edge cases", () => {
	let config: FileManagerConfig;

	beforeEach(() => {
		for (const subdir of SUBDIRS) {
			fs.mkdirSync(path.join(root, subdir), { recursive: true });
		}
		config = { ...CONFIG_DEFAULTS };
	});

	it("sentinel in middle of content does not count as sentinel-only", () => {
		const content = `# My Plan\n\n${SENTINEL}\n\nMore content`;
		fs.writeFileSync(path.join(root, "active", "current.md"), content);
		expect(readContent(root, "current.md")).toBe(content);
	});

	it("safe write then reset then safe write works", async () => {
		const result1 = await safeWrite(root, "current.md", "# First");
		expect(result1.ok).toBe(true);

		await resetContent(root, "current.md");

		const result2 = await safeWrite(root, "current.md", "# Second");
		expect(result2.ok).toBe(true);
		expect(readContent(root, "current.md")).toBe("# Second");
	});

	it("archive then write cycle works", async () => {
		// Write → archive → write again
		await forceWrite(root, "current.md", "# Version 1");
		const entry = await archiveActive(root, "current.md", config);
		expect(entry).not.toBeNull();

		const result = await safeWrite(root, "current.md", "# Version 2");
		expect(result.ok).toBe(true);
		expect(readContent(root, "current.md")).toBe("# Version 2");
	});

	it("multiple archive cycles produce unique filenames", async () => {
		const filenames = new Set<string>();
		for (let i = 0; i < 5; i++) {
			await forceWrite(root, "current.md", `# Version ${i}`);
			const entry = await archiveActive(root, "current.md", config);
			expect(entry).not.toBeNull();
			expect(filenames.has(entry!.filename)).toBe(false);
			filenames.add(entry!.filename);
		}
		expect(filenames.size).toBe(5);
	});
});

describe("content with special characters", () => {
	it("handles content with null bytes", async () => {
		const content = "# Title\n\0Binary content";
		const ok = await forceWrite(root, "current.md", content);
		expect(ok).toBe(true);
		expect(readContent(root, "current.md")).toBe(content);
	});

	it("handles content with only newlines", () => {
		fs.writeFileSync(path.join(root, "active", "current.md"), "\n\n\n");
		expect(readContent(root, "current.md")).toBeNull();
	});

	it("handles very large content", async () => {
		const bigContent = "# Title\n" + "x".repeat(100000);
		const ok = await forceWrite(root, "current.md", bigContent);
		expect(ok).toBe(true);
		const read = readContent(root, "current.md");
		expect(read).toBe(bigContent);
	});
});

describe("sentinel edge cases", () => {
	it("content that is exactly the sentinel value (no trailing newline)", () => {
		fs.writeFileSync(path.join(root, "active", "current.md"), SENTINEL);
		expect(readContent(root, "current.md")).toBeNull();
	});

	it("content that starts with sentinel but has more", () => {
		fs.writeFileSync(
			path.join(root, "active", "current.md"),
			SENTINEL + "\nExtra content here",
		);
		// This should be treated as real content because it has more than just sentinel
		const content = readContent(root, "current.md");
		expect(content).not.toBeNull();
	});

	it("safeWrite succeeds on sentinel-only file", async () => {
		fs.writeFileSync(path.join(root, "active", "current.md"), SENTINEL);
		const result = await safeWrite(root, "current.md", "# Real Content");
		expect(result.ok).toBe(true);
	});
});
