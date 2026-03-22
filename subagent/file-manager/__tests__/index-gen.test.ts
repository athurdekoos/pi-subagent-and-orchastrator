import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { regenerateIndex } from "../index-gen.js";
import { SUBDIRS } from "../types.js";

let tmpDir: string;
let root: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fm-index-"));
	root = path.join(tmpDir, "file-manager");
	for (const subdir of SUBDIRS) {
		fs.mkdirSync(path.join(root, subdir), { recursive: true });
	}
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("regenerateIndex", () => {
	it("creates INDEX.md with no-archives message", async () => {
		const content = await regenerateIndex(root);
		expect(content).toContain("No archives");
		expect(fs.existsSync(path.join(root, "archives", "INDEX.md"))).toBe(true);
	});

	it("lists archives in the index", async () => {
		fs.writeFileSync(
			path.join(root, "archives", "2026-03-22-1430-plan.md"),
			"# My Plan",
		);
		const content = await regenerateIndex(root);
		expect(content).toContain("2026-03-22-1430-plan.md");
		expect(content).toContain("My Plan");
		expect(content).toContain("1 archive");
	});

	it("lists multiple archives", async () => {
		fs.writeFileSync(
			path.join(root, "archives", "2026-03-22-plan-a.md"),
			"# Plan A",
		);
		fs.writeFileSync(
			path.join(root, "archives", "2026-03-23-plan-b.md"),
			"# Plan B",
		);
		const content = await regenerateIndex(root);
		expect(content).toContain("2 archives");
		expect(content).toContain("Plan A");
		expect(content).toContain("Plan B");
	});

	it("is idempotent", async () => {
		fs.writeFileSync(
			path.join(root, "archives", "2026-03-22-test.md"),
			"# Test",
		);
		const first = await regenerateIndex(root);
		const second = await regenerateIndex(root);
		expect(first).toBe(second);
	});

	it("overwrites previous index completely", async () => {
		fs.writeFileSync(
			path.join(root, "archives", "2026-03-22-old.md"),
			"# Old",
		);
		await regenerateIndex(root);

		// Remove old archive, add new
		fs.unlinkSync(path.join(root, "archives", "2026-03-22-old.md"));
		fs.writeFileSync(
			path.join(root, "archives", "2026-03-23-new.md"),
			"# New",
		);
		const content = await regenerateIndex(root);
		expect(content).not.toContain("Old");
		expect(content).toContain("New");
	});
});

describe("regenerateIndex edge cases", () => {
	it("excludes INDEX.md from the index", async () => {
		fs.writeFileSync(path.join(root, "archives", "INDEX.md"), "# Old Index");
		fs.writeFileSync(path.join(root, "archives", "2026-03-22-test.md"), "# Test");
		const content = await regenerateIndex(root);
		expect(content).toContain("1 archive"); // not 2
	});

	it("handles archives with no parseable date in filename", async () => {
		fs.writeFileSync(path.join(root, "archives", "no-date-here.md"), "# No Date");
		const content = await regenerateIndex(root);
		expect(content).toContain("no-date-here.md");
	});
});
