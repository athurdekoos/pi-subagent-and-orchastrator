import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { slugify, timestampPrefix, generateFilename, collisionSafePath } from "../naming.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fm-naming-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
	vi.restoreAllMocks();
});

describe("slugify", () => {
	it("converts text to lowercase", () => {
		expect(slugify("Hello World")).toBe("hello-world");
	});

	it("replaces non-alphanumeric characters with hyphens", () => {
		expect(slugify("Hello, World! #1")).toBe("hello-world-1");
	});

	it("collapses consecutive hyphens", () => {
		expect(slugify("a---b")).toBe("a-b");
	});

	it("trims leading and trailing hyphens", () => {
		expect(slugify("---hello---")).toBe("hello");
	});

	it("respects max length", () => {
		const long = "a".repeat(100);
		expect(slugify(long, 10).length).toBeLessThanOrEqual(10);
	});

	it("handles empty string", () => {
		expect(slugify("")).toBe("");
	});

	it("handles string with only special characters", () => {
		expect(slugify("!@#$%")).toBe("");
	});

	it("does not leave trailing hyphen after truncation", () => {
		// "abcde-fghij" truncated to 6 should be "abcde" not "abcde-"
		const result = slugify("abcde fghij", 6);
		expect(result.endsWith("-")).toBe(false);
	});

	it("preserves numbers", () => {
		expect(slugify("task 42 done")).toBe("task-42-done");
	});
});

describe("timestampPrefix", () => {
	it("returns YYYY-MM-DD-HHMM format for full", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-03-22T14:30:00Z"));
		const result = timestampPrefix("full");
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}-\d{4}$/);
		vi.useRealTimers();
	});

	it("returns YYYY-MM-DD format for date-only", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-03-22T14:30:00Z"));
		const result = timestampPrefix("date-only");
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		vi.useRealTimers();
	});

	it("defaults to full format", () => {
		const result = timestampPrefix();
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}-\d{4}$/);
	});
});

describe("generateFilename", () => {
	it("combines timestamp and slug", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-03-22T14:30:00Z"));
		const result = generateFilename("My Document", "full");
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}-\d{4}-my-document\.md$/);
		vi.useRealTimers();
	});

	it("handles empty title", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-03-22T14:30:00Z"));
		const result = generateFilename("", "full");
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}-\d{4}\.md$/);
		vi.useRealTimers();
	});

	it("uses custom extension", () => {
		const result = generateFilename("test", "full", ".txt");
		expect(result).toMatch(/\.txt$/);
	});

	it("uses date-only format", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-03-22T14:30:00Z"));
		const result = generateFilename("test", "date-only");
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}-test\.md$/);
		vi.useRealTimers();
	});

	it("produces sortable filenames", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		const a = generateFilename("aaa");
		vi.setSystemTime(new Date("2026-12-31T23:59:00Z"));
		const b = generateFilename("bbb");
		expect(a < b).toBe(true);
		vi.useRealTimers();
	});
});

describe("collisionSafePath", () => {
	it("returns original path when no collision", () => {
		const p = path.join(tmpDir, "file.md");
		expect(collisionSafePath(p)).toBe(p);
	});

	it("appends -1 on first collision", () => {
		const p = path.join(tmpDir, "file.md");
		fs.writeFileSync(p, "exists");
		const result = collisionSafePath(p);
		expect(result).toBe(path.join(tmpDir, "file-1.md"));
	});

	it("appends -2 when -1 also exists", () => {
		const base = path.join(tmpDir, "file.md");
		fs.writeFileSync(base, "exists");
		fs.writeFileSync(path.join(tmpDir, "file-1.md"), "also exists");
		const result = collisionSafePath(base);
		expect(result).toBe(path.join(tmpDir, "file-2.md"));
	});

	it("handles custom extensions", () => {
		const p = path.join(tmpDir, "data.json");
		fs.writeFileSync(p, "{}");
		const result = collisionSafePath(p, ".json");
		expect(result).toBe(path.join(tmpDir, "data-1.json"));
	});
});

describe("slugify edge cases", () => {
	it("handles unicode characters", () => {
		const result = slugify("Héllo Wörld café");
		// Should strip accented chars, keep basic latin
		expect(result).not.toContain(" ");
		expect(result.length).toBeGreaterThan(0);
	});

	it("handles only-number input", () => {
		expect(slugify("12345")).toBe("12345");
	});

	it("handles single character", () => {
		expect(slugify("a")).toBe("a");
	});

	it("handles maxLen of 1", () => {
		const result = slugify("hello", 1);
		expect(result.length).toBeLessThanOrEqual(1);
		expect(result).toBe("h");
	});

	it("handles maxLen of 0", () => {
		expect(slugify("hello", 0)).toBe("");
	});

	it("handles very long input", () => {
		const long = "word ".repeat(1000);
		const result = slugify(long);
		expect(result.length).toBeLessThanOrEqual(50);
	});

	it("handles input that becomes empty after stripping", () => {
		expect(slugify("!!!")).toBe("");
	});
});

describe("collisionSafePath edge cases", () => {
	it("handles many collisions", () => {
		const base = path.join(tmpDir, "test.md");
		// Create base + 10 collisions
		fs.writeFileSync(base, "");
		for (let i = 1; i <= 10; i++) {
			fs.writeFileSync(path.join(tmpDir, `test-${i}.md`), "");
		}
		const result = collisionSafePath(base);
		expect(result).toBe(path.join(tmpDir, "test-11.md"));
	});
});

describe("slugify boundary cases", () => {
	it("handles tab characters", () => {
		expect(slugify("hello\tworld")).toBe("hello-world");
	});

	it("handles newline characters", () => {
		expect(slugify("hello\nworld")).toBe("hello-world");
	});

	it("truncation at maxLen boundary does not create trailing hyphen", () => {
		// "hello-w" is 7 chars, truncated to 6 is "hello-", which should trim to "hello"
		const result = slugify("hello world", 6);
		expect(result.endsWith("-")).toBe(false);
	});

	it("handles repeated special chars", () => {
		expect(slugify("a!!!b@@@c###d")).toBe("a-b-c-d");
	});
});
