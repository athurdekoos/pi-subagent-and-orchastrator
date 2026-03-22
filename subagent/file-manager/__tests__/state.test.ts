import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { detectRoot, isFullyInitialized, hasActiveContent, getPhase, getStateInfo } from "../state.js";
import { SENTINEL, SUBDIRS } from "../types.js";
import { CONFIG_DEFAULTS } from "../config.js";
import { initializeStructure } from "../init.js";
import { forceWrite } from "../content.js";
import { archiveActive } from "../archives.js";
import type { FileManagerConfig } from "../types.js";

let tmpDir: string;
let root: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fm-state-"));
	root = path.join(tmpDir, "file-manager");
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createFullStructure() {
	for (const subdir of SUBDIRS) {
		fs.mkdirSync(path.join(root, subdir), { recursive: true });
	}
}

describe("detectRoot", () => {
	it("returns null when directory does not exist", () => {
		expect(detectRoot(tmpDir, "file-manager")).toBeNull();
	});

	it("returns path when directory exists", () => {
		fs.mkdirSync(root, { recursive: true });
		expect(detectRoot(tmpDir, "file-manager")).toBe(root);
	});
});

describe("isFullyInitialized", () => {
	it("returns false when root does not exist", () => {
		expect(isFullyInitialized(root)).toBe(false);
	});

	it("returns false when some subdirs are missing", () => {
		fs.mkdirSync(path.join(root, "active"), { recursive: true });
		expect(isFullyInitialized(root)).toBe(false);
	});

	it("returns true when all subdirs exist", () => {
		createFullStructure();
		expect(isFullyInitialized(root)).toBe(true);
	});
});

describe("hasActiveContent", () => {
	it("returns false when file does not exist", () => {
		createFullStructure();
		expect(hasActiveContent(root, "current.md")).toBe(false);
	});

	it("returns false when file contains sentinel", () => {
		createFullStructure();
		fs.writeFileSync(path.join(root, "active", "current.md"), SENTINEL + "\n");
		expect(hasActiveContent(root, "current.md")).toBe(false);
	});

	it("returns false when file is empty", () => {
		createFullStructure();
		fs.writeFileSync(path.join(root, "active", "current.md"), "");
		expect(hasActiveContent(root, "current.md")).toBe(false);
	});

	it("returns true when file has real content", () => {
		createFullStructure();
		fs.writeFileSync(path.join(root, "active", "current.md"), "# My Plan\nReal content");
		expect(hasActiveContent(root, "current.md")).toBe(true);
	});

	it("returns false when file is only whitespace", () => {
		createFullStructure();
		fs.writeFileSync(path.join(root, "active", "current.md"), "   \n  \n  ");
		expect(hasActiveContent(root, "current.md")).toBe(false);
	});
});

describe("getPhase", () => {
	it("returns uninitialized when root does not exist", () => {
		expect(getPhase(root, "current.md")).toBe("uninitialized");
	});

	it("returns uninitialized when subdirs are missing", () => {
		fs.mkdirSync(root, { recursive: true });
		expect(getPhase(root, "current.md")).toBe("uninitialized");
	});

	it("returns initialized when structure exists but no content", () => {
		createFullStructure();
		fs.writeFileSync(path.join(root, "active", "current.md"), SENTINEL + "\n");
		expect(getPhase(root, "current.md")).toBe("initialized");
	});

	it("returns active when content exists but no archives", () => {
		createFullStructure();
		fs.writeFileSync(path.join(root, "active", "current.md"), "# Real Plan");
		expect(getPhase(root, "current.md")).toBe("active");
	});

	it("returns archived when archives exist", () => {
		createFullStructure();
		fs.writeFileSync(path.join(root, "archives", "2026-03-22-some-archive.md"), "# Old");
		expect(getPhase(root, "current.md")).toBe("archived");
	});

	it("returns archived even when active content also exists", () => {
		createFullStructure();
		fs.writeFileSync(path.join(root, "active", "current.md"), "# Current");
		fs.writeFileSync(path.join(root, "archives", "2026-03-22-old.md"), "# Old");
		expect(getPhase(root, "current.md")).toBe("archived");
	});

	it("ignores INDEX.md in archives", () => {
		createFullStructure();
		fs.writeFileSync(path.join(root, "archives", "INDEX.md"), "# Index");
		fs.writeFileSync(path.join(root, "active", "current.md"), SENTINEL);
		expect(getPhase(root, "current.md")).toBe("initialized");
	});
});

describe("getStateInfo", () => {
	it("returns uninitialized state when root does not exist", () => {
		const config = { ...CONFIG_DEFAULTS, rootDir: "file-manager" };
		const state = getStateInfo(tmpDir, config);
		expect(state.root).toBeNull();
		expect(state.initialized).toBe(false);
		expect(state.hasActive).toBe(false);
		expect(state.phase).toBe("uninitialized");
	});

	it("returns correct state when fully initialized", () => {
		createFullStructure();
		fs.writeFileSync(path.join(root, "active", "current.md"), "# Content");
		const config = { ...CONFIG_DEFAULTS, rootDir: "file-manager" };
		const state = getStateInfo(tmpDir, config);
		expect(state.root).toBe(root);
		expect(state.initialized).toBe(true);
		expect(state.hasActive).toBe(true);
		expect(state.phase).toBe("active");
	});
});

describe("state edge cases", () => {
	let config: FileManagerConfig;

	beforeEach(() => {
		createFullStructure();
		config = { ...CONFIG_DEFAULTS };
	});

	it("getPhase with archived phase when active has sentinel", () => {
		fs.writeFileSync(path.join(root, "active", "current.md"), SENTINEL);
		fs.writeFileSync(path.join(root, "archives", "2026-03-22-test.md"), "# Test");
		expect(getPhase(root, "current.md")).toBe("archived");
	});

	it("getStateInfo with partially missing structure", () => {
		// Remove one subdir
		fs.rmSync(path.join(root, "templates"), { recursive: true });
		const state = getStateInfo(tmpDir, { ...config, rootDir: "file-manager" });
		expect(state.initialized).toBe(false);
	});

	it("hasActiveContent returns false when active dir is missing", () => {
		fs.rmSync(path.join(root, "active"), { recursive: true });
		expect(hasActiveContent(root, "current.md")).toBe(false);
	});
});

describe("phase transitions", () => {
	let config: FileManagerConfig;

	beforeEach(() => {
		createFullStructure();
		config = { ...CONFIG_DEFAULTS };
	});

	it("uninitialized → initialized via init", async () => {
		const freshRoot = path.join(tmpDir, "phase-test");
		expect(getPhase(freshRoot, "current.md")).toBe("uninitialized");
		await initializeStructure(freshRoot, "current.md");
		expect(getPhase(freshRoot, "current.md")).toBe("initialized");
	});

	it("initialized → active via write", async () => {
		fs.writeFileSync(path.join(root, "active", "current.md"), SENTINEL + "\n");
		expect(getPhase(root, "current.md")).toBe("initialized");
		await forceWrite(root, "current.md", "# Content");
		expect(getPhase(root, "current.md")).toBe("active");
	});

	it("active → archived via archive", async () => {
		await forceWrite(root, "current.md", "# Content");
		expect(getPhase(root, "current.md")).toBe("active");
		await archiveActive(root, "current.md", config);
		expect(getPhase(root, "current.md")).toBe("archived");
	});

	it("archived stays archived even after reset", async () => {
		await forceWrite(root, "current.md", "# Content");
		await archiveActive(root, "current.md", config);
		// Archives exist, active is reset
		expect(getPhase(root, "current.md")).toBe("archived");
	});
});

describe("getPhase with only root dir (no subdirs)", () => {
	it("returns uninitialized when root exists but has no subdirs", () => {
		fs.mkdirSync(root, { recursive: true });
		// Root exists but no subdirs — not fully initialized
		expect(isFullyInitialized(root)).toBe(false);
		expect(getPhase(root, "current.md")).toBe("uninitialized");
	});
});
