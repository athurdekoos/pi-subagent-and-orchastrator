import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createMeta, readMeta, updateMeta, getMetaPath } from "../metadata.js";

let tmpDir: string;
let root: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fm-meta-"));
	root = path.join(tmpDir, "file-manager");
	fs.mkdirSync(path.join(root, "metadata"), { recursive: true });
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
	vi.restoreAllMocks();
});

describe("createMeta", () => {
	it("creates metadata with defaults", () => {
		const meta = createMeta();
		expect(meta.version).toBe("1.0.0");
		expect(meta.title).toBe("");
		expect(meta.createdAt).toBeTruthy();
		expect(meta.updatedAt).toBeTruthy();
		expect(meta.custom).toEqual({});
	});

	it("creates metadata with custom title", () => {
		const meta = createMeta("My Doc");
		expect(meta.title).toBe("My Doc");
	});

	it("creates metadata with custom fields", () => {
		const meta = createMeta("Doc", { priority: "high" });
		expect(meta.custom).toEqual({ priority: "high" });
	});

	it("sets createdAt and updatedAt to same timestamp", () => {
		const meta = createMeta();
		expect(meta.createdAt).toBe(meta.updatedAt);
	});
});

describe("readMeta", () => {
	it("returns null when no metadata file", () => {
		expect(readMeta(root)).toBeNull();
	});

	it("returns null for invalid JSON", () => {
		fs.writeFileSync(path.join(root, "metadata", "meta.json"), "not json");
		expect(readMeta(root)).toBeNull();
	});

	it("returns null for array JSON", () => {
		fs.writeFileSync(path.join(root, "metadata", "meta.json"), "[]");
		expect(readMeta(root)).toBeNull();
	});

	it("reads valid metadata", () => {
		const meta = createMeta("Test");
		fs.writeFileSync(path.join(root, "metadata", "meta.json"), JSON.stringify(meta));
		const result = readMeta(root);
		expect(result).not.toBeNull();
		expect(result!.title).toBe("Test");
		expect(result!.version).toBe("1.0.0");
	});

	it("fills missing fields with defaults", () => {
		fs.writeFileSync(
			path.join(root, "metadata", "meta.json"),
			JSON.stringify({ title: "Partial" }),
		);
		const result = readMeta(root);
		expect(result).not.toBeNull();
		expect(result!.title).toBe("Partial");
		expect(result!.version).toBe("1.0.0");
		expect(result!.custom).toEqual({});
	});

	it("handles corrupt custom field", () => {
		fs.writeFileSync(
			path.join(root, "metadata", "meta.json"),
			JSON.stringify({ title: "Test", custom: "not an object" }),
		);
		const result = readMeta(root);
		expect(result!.custom).toEqual({});
	});
});

describe("updateMeta", () => {
	it("creates metadata file if it does not exist", async () => {
		const result = await updateMeta(root, { title: "New" });
		expect(result).not.toBeNull();
		expect(result!.title).toBe("New");
		expect(fs.existsSync(path.join(root, "metadata", "meta.json"))).toBe(true);
	});

	it("updates existing metadata", async () => {
		const initial = createMeta("Old");
		fs.writeFileSync(
			path.join(root, "metadata", "meta.json"),
			JSON.stringify(initial),
		);

		const result = await updateMeta(root, { title: "New" });
		expect(result!.title).toBe("New");
		expect(result!.createdAt).toBe(initial.createdAt); // preserved
	});

	it("always updates updatedAt", async () => {
		const initial = createMeta("Test");
		fs.writeFileSync(
			path.join(root, "metadata", "meta.json"),
			JSON.stringify(initial),
		);

		// Small delay to get different timestamp
		await new Promise((r) => setTimeout(r, 10));
		const result = await updateMeta(root, { title: "Updated" });
		expect(result!.updatedAt).not.toBe(initial.updatedAt);
	});

	it("merges custom fields", async () => {
		const initial = createMeta("Test", { key1: "val1" });
		fs.writeFileSync(
			path.join(root, "metadata", "meta.json"),
			JSON.stringify(initial),
		);

		const result = await updateMeta(root, { custom: { key2: "val2" } });
		expect(result!.custom).toEqual({ key1: "val1", key2: "val2" });
	});
});

describe("getMetaPath", () => {
	it("returns correct path", () => {
		expect(getMetaPath("/root")).toBe("/root/metadata/meta.json");
	});
});

describe("metadata edge cases", () => {
	it("updateMeta handles concurrent-like updates", async () => {
		// Simulate rapid updates
		await updateMeta(root, { title: "First" });
		await updateMeta(root, { title: "Second" });
		await updateMeta(root, { title: "Third" });
		const meta = readMeta(root);
		expect(meta!.title).toBe("Third");
	});

	it("readMeta handles null JSON", () => {
		fs.writeFileSync(path.join(root, "metadata", "meta.json"), "null");
		expect(readMeta(root)).toBeNull();
	});

	it("updateMeta preserves createdAt across updates", async () => {
		await updateMeta(root, { title: "Initial" });
		const meta1 = readMeta(root);
		const createdAt = meta1!.createdAt;

		await new Promise((r) => setTimeout(r, 10));
		await updateMeta(root, { title: "Updated" });
		const meta2 = readMeta(root);
		expect(meta2!.createdAt).toBe(createdAt);
	});
});
