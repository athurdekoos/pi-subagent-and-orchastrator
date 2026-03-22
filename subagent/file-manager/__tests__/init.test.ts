import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { initializeStructure, isInitialized } from "../init.js";
import { SENTINEL, SUBDIRS } from "../types.js";
import { CONFIG_DEFAULTS } from "../config.js";
import { safeWrite, forceWrite, readContent } from "../content.js";
import { archiveActive, listArchives, getArchive } from "../archives.js";
import { regenerateIndex } from "../index-gen.js";
import { getStateInfo } from "../state.js";
import type { FileManagerConfig } from "../types.js";

let tmpDir: string;
let root: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fm-init-"));
	root = path.join(tmpDir, "file-manager");
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("initializeStructure", () => {
	it("creates root and all subdirectories", async () => {
		const result = await initializeStructure(root, "current.md");
		expect(fs.existsSync(root)).toBe(true);
		for (const subdir of SUBDIRS) {
			expect(fs.existsSync(path.join(root, subdir))).toBe(true);
		}
		expect(result.created.length).toBeGreaterThan(0);
	});

	it("creates placeholder active file with sentinel", async () => {
		await initializeStructure(root, "current.md");
		const activePath = path.join(root, "active", "current.md");
		expect(fs.existsSync(activePath)).toBe(true);
		const content = fs.readFileSync(activePath, "utf-8");
		expect(content.trim()).toBe(SENTINEL);
	});

	it("is idempotent — second call skips existing", async () => {
		const first = await initializeStructure(root, "current.md");
		const second = await initializeStructure(root, "current.md");
		expect(second.skipped.length).toBeGreaterThan(0);
		expect(second.created.length).toBe(0);
	});

	it("never overwrites existing active file", async () => {
		// Pre-create with real content
		fs.mkdirSync(path.join(root, "active"), { recursive: true });
		fs.writeFileSync(path.join(root, "active", "current.md"), "# My Real Content");

		await initializeStructure(root, "current.md");

		const content = fs.readFileSync(path.join(root, "active", "current.md"), "utf-8");
		expect(content).toBe("# My Real Content"); // not overwritten
	});

	it("creates missing subdirs even if root exists", async () => {
		fs.mkdirSync(root, { recursive: true });
		fs.mkdirSync(path.join(root, "active"), { recursive: true });
		// only "active" exists, others missing

		const result = await initializeStructure(root, "current.md");
		for (const subdir of SUBDIRS) {
			expect(fs.existsSync(path.join(root, subdir))).toBe(true);
		}
		// active was skipped, others were created
		expect(result.skipped).toContain(path.join(root, "active"));
	});
});

describe("isInitialized", () => {
	it("returns false when root does not exist", () => {
		expect(isInitialized(root)).toBe(false);
	});

	it("returns false when subdirs are incomplete", () => {
		fs.mkdirSync(path.join(root, "active"), { recursive: true });
		expect(isInitialized(root)).toBe(false);
	});

	it("returns true after full initialization", async () => {
		await initializeStructure(root, "current.md");
		expect(isInitialized(root)).toBe(true);
	});
});

describe("full lifecycle integration", () => {
	let config: FileManagerConfig;

	beforeEach(() => {
		config = { ...CONFIG_DEFAULTS };
	});

	it("init → write → archive → restore → archive cycle", async () => {
		const freshRoot = path.join(tmpDir, "lifecycle");
		await initializeStructure(freshRoot, "current.md");

		// Write
		const writeResult = await safeWrite(freshRoot, "current.md", "# Plan v1");
		expect(writeResult.ok).toBe(true);

		// Archive
		const entry1 = await archiveActive(freshRoot, "current.md", config);
		expect(entry1).not.toBeNull();
		await regenerateIndex(freshRoot);

		// Verify clean state
		expect(readContent(freshRoot, "current.md")).toBeNull();

		// Write again
		await safeWrite(freshRoot, "current.md", "# Plan v2");

		// Restore v1 (should archive v2 first)
		const v1Content = getArchive(freshRoot, entry1!.filename);
		expect(v1Content).toBe("# Plan v1");

		// Archive v2 before restoring
		const entry2 = await archiveActive(freshRoot, "current.md", config);
		expect(entry2).not.toBeNull();
		await regenerateIndex(freshRoot);

		// Force write v1 back
		await forceWrite(freshRoot, "current.md", v1Content!);
		expect(readContent(freshRoot, "current.md")).toBe("# Plan v1");

		// Should have 2 archives now
		const archives = listArchives(freshRoot);
		expect(archives.length).toBe(2);
	});

	it("state transitions through full lifecycle", async () => {
		const freshRoot = path.join(tmpDir, "states");
		const stateConfig = { ...config, rootDir: "states" };

		// Uninitialized
		expect(getStateInfo(tmpDir, stateConfig).phase).toBe("uninitialized");

		// Initialized
		await initializeStructure(freshRoot, "current.md");
		expect(getStateInfo(tmpDir, stateConfig).phase).toBe("initialized");

		// Active
		await forceWrite(freshRoot, "current.md", "# Content");
		expect(getStateInfo(tmpDir, stateConfig).phase).toBe("active");

		// Archived
		await archiveActive(freshRoot, "current.md", config);
		expect(getStateInfo(tmpDir, stateConfig).phase).toBe("archived");
	});
});

describe("initializeStructure with existing real content", () => {
	it("preserves pre-existing files in subdirectories", async () => {
		// Create archives dir with existing file
		fs.mkdirSync(path.join(root, "archives"), { recursive: true });
		fs.writeFileSync(path.join(root, "archives", "existing.md"), "# Keep Me");

		await initializeStructure(root, "current.md");

		// Existing file should be preserved
		expect(fs.readFileSync(path.join(root, "archives", "existing.md"), "utf-8"))
			.toBe("# Keep Me");
	});
});
