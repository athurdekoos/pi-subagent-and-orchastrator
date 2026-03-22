import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { captureSnapshot, writeSnapshot } from "../diagnostics.js";
import { SENTINEL, SUBDIRS } from "../types.js";
import { CONFIG_DEFAULTS } from "../config.js";
import type { FileManagerConfig } from "../types.js";

let tmpDir: string;
let root: string;
let config: FileManagerConfig;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fm-diag-"));
	root = path.join(tmpDir, "file-manager");
	for (const subdir of SUBDIRS) {
		fs.mkdirSync(path.join(root, subdir), { recursive: true });
	}
	config = { ...CONFIG_DEFAULTS };
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("captureSnapshot", () => {
	it("captures state with no content", () => {
		fs.writeFileSync(path.join(root, "active", "current.md"), SENTINEL + "\n");
		const snapshot = captureSnapshot(root, config);
		expect(snapshot.timestamp).toBeTruthy();
		expect(snapshot.phase).toBe("initialized");
		expect(snapshot.hasActiveContent).toBe(false);
		expect(snapshot.archiveCount).toBe(0);
		expect(snapshot.errors).toEqual([]);
	});

	it("detects active content", () => {
		fs.writeFileSync(path.join(root, "active", "current.md"), "# Real Plan");
		const snapshot = captureSnapshot(root, config);
		expect(snapshot.hasActiveContent).toBe(true);
		expect(snapshot.activeFileSize).toBeGreaterThan(0);
		expect(snapshot.activeFileLines).toBeGreaterThan(0);
	});

	it("counts archives", () => {
		fs.writeFileSync(path.join(root, "archives", "2026-03-22-a.md"), "#A");
		fs.writeFileSync(path.join(root, "archives", "2026-03-23-b.md"), "#B");
		const snapshot = captureSnapshot(root, config);
		expect(snapshot.archiveCount).toBe(2);
	});

	it("checks subdirectory existence", () => {
		const snapshot = captureSnapshot(root, config);
		for (const subdir of SUBDIRS) {
			expect(snapshot.subdirs[subdir]).toBe(true);
		}
	});

	it("detects config file presence", () => {
		const snapshot1 = captureSnapshot(root, config);
		expect(snapshot1.configPresent).toBe(false);

		fs.writeFileSync(
			path.join(root, "config", "settings.json"),
			JSON.stringify({ debug: true }),
		);
		const snapshot2 = captureSnapshot(root, config);
		expect(snapshot2.configPresent).toBe(true);
	});

	it("detects metadata presence", () => {
		const snapshot1 = captureSnapshot(root, config);
		expect(snapshot1.metadataPresent).toBe(false);

		fs.writeFileSync(
			path.join(root, "metadata", "meta.json"),
			JSON.stringify({ version: "1.0.0" }),
		);
		const snapshot2 = captureSnapshot(root, config);
		expect(snapshot2.metadataPresent).toBe(true);
	});

	it("never includes file body content", () => {
		fs.writeFileSync(path.join(root, "active", "current.md"), "SECRET CONTENT");
		const snapshot = captureSnapshot(root, config);
		const json = JSON.stringify(snapshot);
		expect(json).not.toContain("SECRET CONTENT");
	});
});

describe("writeSnapshot", () => {
	it("writes snapshot to logs directory", async () => {
		const snapshot = captureSnapshot(root, config);
		const filePath = await writeSnapshot(root, snapshot);
		expect(filePath).not.toBeNull();
		expect(filePath!).toContain("logs");
		expect(filePath!).toContain("diagnostic-");
		expect(fs.existsSync(filePath!)).toBe(true);
	});

	it("writes valid JSON", async () => {
		const snapshot = captureSnapshot(root, config);
		const filePath = await writeSnapshot(root, snapshot);
		const content = fs.readFileSync(filePath!, "utf-8");
		const parsed = JSON.parse(content);
		expect(parsed.timestamp).toBeTruthy();
		expect(parsed.phase).toBeTruthy();
	});

	it("uses collision-safe naming", async () => {
		const snapshot = captureSnapshot(root, config);
		const path1 = await writeSnapshot(root, snapshot);
		const path2 = await writeSnapshot(root, snapshot);
		expect(path1).not.toBe(path2);
	});
});

describe("diagnostics edge cases", () => {
	it("captureSnapshot works when some subdirs are deleted", () => {
		fs.rmSync(path.join(root, "templates"), { recursive: true });
		const snapshot = captureSnapshot(root, config);
		expect(snapshot.subdirs["templates"]).toBe(false);
		expect(snapshot.subdirs["active"]).toBe(true);
	});

	it("writeSnapshot creates logs dir if missing", async () => {
		fs.rmSync(path.join(root, "logs"), { recursive: true });
		const snapshot = captureSnapshot(root, config);
		const filePath = await writeSnapshot(root, snapshot);
		expect(filePath).not.toBeNull();
		expect(fs.existsSync(filePath!)).toBe(true);
	});
});

describe("snapshot captures all states correctly", () => {
	it("snapshot of fresh initialized state", () => {
		fs.writeFileSync(path.join(root, "active", "current.md"), SENTINEL + "\n");
		const snapshot = captureSnapshot(root, config);
		expect(snapshot.phase).toBe("initialized");
		expect(snapshot.hasActiveContent).toBe(false);
		expect(snapshot.archiveCount).toBe(0);
		expect(snapshot.activeFileSize).toBeGreaterThan(0); // sentinel has content
		expect(snapshot.activeFileLines).toBeGreaterThan(0);
	});

	it("snapshot of active state", () => {
		fs.writeFileSync(path.join(root, "active", "current.md"), "# Plan\nLine 2\nLine 3");
		const snapshot = captureSnapshot(root, config);
		expect(snapshot.phase).toBe("active");
		expect(snapshot.hasActiveContent).toBe(true);
		expect(snapshot.activeFileLines).toBe(3);
	});
});
