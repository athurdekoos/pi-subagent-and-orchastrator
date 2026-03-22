import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { detectLegacyLayout, migrate, importFromExternal } from "../migration.js";
import { SENTINEL, SUBDIRS } from "../types.js";
import { CONFIG_DEFAULTS } from "../config.js";
import type { FileManagerConfig } from "../types.js";

let tmpDir: string;
let root: string;
let config: FileManagerConfig;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fm-migrate-"));
	root = path.join(tmpDir, "file-manager");
	fs.mkdirSync(root, { recursive: true });
	config = { ...CONFIG_DEFAULTS };
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("detectLegacyLayout", () => {
	it("detects missing subdirectories", () => {
		const result = detectLegacyLayout(root);
		expect(result.isLegacy).toBe(true);
		expect(result.details.some((d) => d.includes("Missing subdirectory"))).toBe(true);
	});

	it("detects legacy files at root level", () => {
		for (const subdir of SUBDIRS) {
			fs.mkdirSync(path.join(root, subdir), { recursive: true });
		}
		fs.writeFileSync(path.join(root, "current.md"), "# Legacy");
		const result = detectLegacyLayout(root);
		expect(result.isLegacy).toBe(true);
		expect(result.details.some((d) => d.includes("Legacy file at root"))).toBe(true);
	});

	it("detects archive files at root level", () => {
		for (const subdir of SUBDIRS) {
			fs.mkdirSync(path.join(root, subdir), { recursive: true });
		}
		fs.writeFileSync(path.join(root, "2026-03-22-old.md"), "# Old Archive");
		const result = detectLegacyLayout(root);
		expect(result.isLegacy).toBe(true);
		expect(result.details.some((d) => d.includes("Archive at root level"))).toBe(true);
	});

	it("returns not legacy when everything is correct", () => {
		for (const subdir of SUBDIRS) {
			fs.mkdirSync(path.join(root, subdir), { recursive: true });
		}
		const result = detectLegacyLayout(root);
		expect(result.isLegacy).toBe(false);
		expect(result.details).toEqual([]);
	});
});

describe("migrate", () => {
	it("creates missing subdirectories", async () => {
		const result = await migrate(root, config);
		for (const subdir of SUBDIRS) {
			expect(fs.existsSync(path.join(root, subdir))).toBe(true);
		}
		expect(result.actions.some((a) => a.includes("Created missing subdirectory"))).toBe(true);
	});

	it("copies root-level content to active/", async () => {
		for (const subdir of SUBDIRS) {
			fs.mkdirSync(path.join(root, subdir), { recursive: true });
		}
		fs.writeFileSync(path.join(root, "current.md"), "# Legacy Content");

		await migrate(root, config);

		// Copied to active/
		expect(fs.existsSync(path.join(root, "active", "current.md"))).toBe(true);
		const content = fs.readFileSync(path.join(root, "active", "current.md"), "utf-8");
		expect(content).toBe("# Legacy Content");

		// Original still exists (never deleted)
		expect(fs.existsSync(path.join(root, "current.md"))).toBe(true);
	});

	it("copies root-level archives to archives/", async () => {
		for (const subdir of SUBDIRS) {
			fs.mkdirSync(path.join(root, subdir), { recursive: true });
		}
		fs.writeFileSync(path.join(root, "2026-03-22-old.md"), "# Old");

		await migrate(root, config);

		expect(fs.existsSync(path.join(root, "archives", "2026-03-22-old.md"))).toBe(true);
		// Original still exists
		expect(fs.existsSync(path.join(root, "2026-03-22-old.md"))).toBe(true);
	});

	it("skips if destination already exists", async () => {
		for (const subdir of SUBDIRS) {
			fs.mkdirSync(path.join(root, subdir), { recursive: true });
		}
		fs.writeFileSync(path.join(root, "current.md"), "# Legacy");
		fs.writeFileSync(path.join(root, "active", "current.md"), "# Already There");

		const result = await migrate(root, config);
		expect(result.actions.some((a) => a.includes("Skipped"))).toBe(true);

		// Existing content preserved
		const content = fs.readFileSync(path.join(root, "active", "current.md"), "utf-8");
		expect(content).toBe("# Already There");
	});

	it("is idempotent", async () => {
		const first = await migrate(root, config);
		const second = await migrate(root, config);
		// Second run should have no new creates (all dirs already exist)
		expect(second.actions.filter((a) => a.includes("Created")).length).toBe(0);
	});
});

describe("importFromExternal", () => {
	it("imports external file to active content", async () => {
		fs.mkdirSync(path.join(root, "active"), { recursive: true });
		const externalFile = path.join(tmpDir, "external.md");
		fs.writeFileSync(externalFile, "# External Content");

		const result = await importFromExternal(root, externalFile, "current.md");
		expect(result.ok).toBe(true);
		const content = fs.readFileSync(path.join(root, "active", "current.md"), "utf-8");
		expect(content).toBe("# External Content");
	});

	it("returns error for non-existent source", async () => {
		const result = await importFromExternal(root, "/nonexistent", "current.md");
		expect(result.ok).toBe(false);
		expect(result.error).toContain("not found");
	});

	it("does not delete source file", async () => {
		fs.mkdirSync(path.join(root, "active"), { recursive: true });
		const externalFile = path.join(tmpDir, "external.md");
		fs.writeFileSync(externalFile, "# Keep Me");

		await importFromExternal(root, externalFile, "current.md");
		expect(fs.existsSync(externalFile)).toBe(true);
	});
});

describe("migration edge cases", () => {
	it("migrate handles non-.md archive files at root gracefully", () => {
		for (const subdir of SUBDIRS) {
			fs.mkdirSync(path.join(root, subdir), { recursive: true });
		}
		// This looks like a date-prefixed file but isn't .md
		fs.writeFileSync(path.join(root, "2026-03-22-data.json"), "{}");
		const result = detectLegacyLayout(root);
		// Should not detect .json files as legacy archives
		expect(result.details.filter((d) => d.includes("2026-03-22-data.json")).length).toBe(0);
	});

	it("migrate is safe when root has mixed content", async () => {
		for (const subdir of SUBDIRS) {
			fs.mkdirSync(path.join(root, subdir), { recursive: true });
		}
		// Mix of legacy and proper files
		fs.writeFileSync(path.join(root, "plan.md"), "# Legacy Plan");
		fs.writeFileSync(path.join(root, "active", "current.md"), SENTINEL);
		fs.writeFileSync(path.join(root, "2026-01-01-old.md"), "# Old");
		fs.writeFileSync(path.join(root, "archives", "2026-02-01-existing.md"), "# Existing");

		const result = await migrate(root, config);
		// Legacy files copied, existing ones preserved
		expect(fs.readFileSync(path.join(root, "active", "plan.md"), "utf-8")).toBe("# Legacy Plan");
		expect(fs.readFileSync(path.join(root, "archives", "2026-01-01-old.md"), "utf-8")).toBe("# Old");
		expect(fs.readFileSync(path.join(root, "archives", "2026-02-01-existing.md"), "utf-8")).toBe("# Existing");
	});
});
