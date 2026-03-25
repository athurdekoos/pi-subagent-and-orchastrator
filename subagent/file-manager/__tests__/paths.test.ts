import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
	resolveRoot,
	isContainedIn,
	safePath,
	ensureDir,
	isDirectory,
	isFile,
	readFileSafe,
	writeFileSafe,
	fileSize,
	fileLineCount,
	isValidId,
} from "../paths.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fm-paths-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("resolveRoot", () => {
	it("resolves relative path against cwd", () => {
		const result = resolveRoot("/home/user/project", ".pi/file-manager");
		expect(result).toBe("/home/user/project/.pi/file-manager");
	});

	it("returns absolute path unchanged", () => {
		const result = resolveRoot("/home/user", "/absolute/path");
		expect(result).toBe("/absolute/path");
	});
});

describe("isContainedIn", () => {
	it("returns true for child path", () => {
		expect(isContainedIn("/a/b/c", "/a/b")).toBe(true);
	});

	it("returns true for same path", () => {
		expect(isContainedIn("/a/b", "/a/b")).toBe(true);
	});

	it("returns false for sibling path", () => {
		expect(isContainedIn("/a/bc", "/a/b")).toBe(false);
	});

	it("returns false for parent path", () => {
		expect(isContainedIn("/a", "/a/b")).toBe(false);
	});

	it("returns false for path traversal attempt", () => {
		expect(isContainedIn("/a/b/../../../etc", "/a/b")).toBe(false);
	});
});

describe("safePath", () => {
	it("returns resolved path for safe relative paths", () => {
		const result = safePath("/root", "sub/file.txt");
		expect(result).toBe("/root/sub/file.txt");
	});

	it("returns null for paths containing ..", () => {
		expect(safePath("/root", "../escape")).toBeNull();
	});

	it("returns null for paths containing .. in the middle", () => {
		expect(safePath("/root", "sub/../../escape")).toBeNull();
	});

	it("returns path for simple filenames", () => {
		expect(safePath("/root", "file.md")).toBe("/root/file.md");
	});
});

describe("ensureDir", () => {
	it("creates a directory", () => {
		const dir = path.join(tmpDir, "new-dir");
		expect(ensureDir(dir)).toBe(true);
		expect(fs.existsSync(dir)).toBe(true);
	});

	it("creates nested directories", () => {
		const dir = path.join(tmpDir, "a", "b", "c");
		expect(ensureDir(dir)).toBe(true);
		expect(fs.existsSync(dir)).toBe(true);
	});

	it("returns true if directory already exists", () => {
		expect(ensureDir(tmpDir)).toBe(true);
	});
});

describe("isDirectory", () => {
	it("returns true for existing directory", () => {
		expect(isDirectory(tmpDir)).toBe(true);
	});

	it("returns false for file", () => {
		const file = path.join(tmpDir, "file.txt");
		fs.writeFileSync(file, "hi");
		expect(isDirectory(file)).toBe(false);
	});

	it("returns false for non-existent path", () => {
		expect(isDirectory(path.join(tmpDir, "nope"))).toBe(false);
	});
});

describe("isFile", () => {
	it("returns true for existing file", () => {
		const file = path.join(tmpDir, "file.txt");
		fs.writeFileSync(file, "hi");
		expect(isFile(file)).toBe(true);
	});

	it("returns false for directory", () => {
		expect(isFile(tmpDir)).toBe(false);
	});

	it("returns false for non-existent path", () => {
		expect(isFile(path.join(tmpDir, "nope"))).toBe(false);
	});
});

describe("readFileSafe", () => {
	it("reads file content", () => {
		const file = path.join(tmpDir, "file.txt");
		fs.writeFileSync(file, "hello world");
		expect(readFileSafe(file)).toBe("hello world");
	});

	it("returns null for non-existent file", () => {
		expect(readFileSafe(path.join(tmpDir, "nope"))).toBeNull();
	});

	it("returns empty string for empty file", () => {
		const file = path.join(tmpDir, "empty.txt");
		fs.writeFileSync(file, "");
		expect(readFileSafe(file)).toBe("");
	});
});

describe("writeFileSafe", () => {
	it("writes content to file", () => {
		const file = path.join(tmpDir, "out.txt");
		expect(writeFileSafe(file, "test content")).toBe(true);
		expect(fs.readFileSync(file, "utf-8")).toBe("test content");
	});

	it("creates parent directories", () => {
		const file = path.join(tmpDir, "a", "b", "file.txt");
		expect(writeFileSafe(file, "deep")).toBe(true);
		expect(fs.readFileSync(file, "utf-8")).toBe("deep");
	});

	it("overwrites existing file", () => {
		const file = path.join(tmpDir, "overwrite.txt");
		fs.writeFileSync(file, "old");
		expect(writeFileSafe(file, "new")).toBe(true);
		expect(fs.readFileSync(file, "utf-8")).toBe("new");
	});
});

describe("fileSize", () => {
	it("returns file size in bytes", () => {
		const file = path.join(tmpDir, "sized.txt");
		fs.writeFileSync(file, "hello");
		expect(fileSize(file)).toBe(5);
	});

	it("returns 0 for non-existent file", () => {
		expect(fileSize(path.join(tmpDir, "nope"))).toBe(0);
	});
});

describe("fileLineCount", () => {
	it("counts lines in a file", () => {
		const file = path.join(tmpDir, "lines.txt");
		fs.writeFileSync(file, "line1\nline2\nline3");
		expect(fileLineCount(file)).toBe(3);
	});

	it("returns 1 for single-line file", () => {
		const file = path.join(tmpDir, "one.txt");
		fs.writeFileSync(file, "one line");
		expect(fileLineCount(file)).toBe(1);
	});

	it("returns 0 for non-existent file", () => {
		expect(fileLineCount(path.join(tmpDir, "nope"))).toBe(0);
	});
});

describe("safePath edge cases", () => {
	it("rejects encoded path traversal", () => {
		// ".." is checked literally
		expect(safePath("/root", "..")).toBeNull();
	});

	it("allows paths with dots in filenames", () => {
		// "file.test.md" should be fine — no ".." present
		expect(safePath("/root", "file.test.md")).toBe("/root/file.test.md");
	});

	it("allows deeply nested safe paths", () => {
		expect(safePath("/root", "a/b/c/d/e/f.md")).toBe("/root/a/b/c/d/e/f.md");
	});
});

describe("isContainedIn edge cases", () => {
	it("handles root path correctly", () => {
		expect(isContainedIn("/", "/")).toBe(true);
	});

	it("handles path with trailing slash", () => {
		// path.resolve normalizes trailing slashes
		expect(isContainedIn("/a/b/", "/a")).toBe(true);
	});
});

describe("fileLineCount edge cases", () => {
	it("empty file returns 1 (empty string splits to [''])", () => {
		const file = path.join(tmpDir, "empty.txt");
		fs.writeFileSync(file, "");
		expect(fileLineCount(file)).toBe(1);
	});

	it("file with trailing newline", () => {
		const file = path.join(tmpDir, "trailing.txt");
		fs.writeFileSync(file, "line1\nline2\n");
		expect(fileLineCount(file)).toBe(3);
	});
});

describe("safePath with absolute input", () => {
	it("rejects absolute paths outside root", () => {
		// An absolute path that doesn't start with root
		expect(safePath("/root", "/etc/passwd")).toBeNull();
	});
});

describe("safePath absolute path handling", () => {
	it("rejects absolute path /etc/passwd even without ..", () => {
		// safePath checks isContainedIn, which should reject this
		// BUT: safePath currently only checks for ".." in the string
		// An absolute path like "/etc/passwd" doesn't contain ".."
		// but path.resolve("/root", "/etc/passwd") = "/etc/passwd" which escapes root
		const result = safePath("/root", "/etc/passwd");
		// This should be null because /etc/passwd is not contained in /root
		expect(result).toBeNull();
	});

	it("rejects absolute path to different tree", () => {
		const result = safePath("/home/user/project", "/tmp/evil");
		expect(result).toBeNull();
	});

	it("accepts absolute path within root", () => {
		// path.resolve("/root", "/root/sub/file") = "/root/sub/file"
		// which IS contained in /root — this is an edge case
		const result = safePath("/root", "/root/sub/file.md");
		// This shouldn't contain ".." so it passes the first check
		// isContainedIn("/root/sub/file.md", "/root") should be true
		expect(result).toBe("/root/sub/file.md");
	});
});

describe("path traversal attack vectors", () => {
	let root: string;

	beforeEach(() => {
		root = path.join(tmpDir, "file-manager");
		fs.mkdirSync(root, { recursive: true });
	});

	it("rejects simple ..", () => {
		expect(safePath(root, "..")).toBeNull();
	});

	it("rejects ../ prefix", () => {
		expect(safePath(root, "../etc/passwd")).toBeNull();
	});

	it("rejects nested ../", () => {
		expect(safePath(root, "sub/../../etc/passwd")).toBeNull();
	});

	it("rejects .... (double dot dot)", () => {
		// "....", while unusual, contains ".." substring
		expect(safePath(root, "..../etc")).toBeNull();
	});

	it("rejects ..%2f encoded (literal string)", () => {
		// While this is a URL encoding, the literal string contains ".."
		expect(safePath(root, "..%2fetc")).toBeNull();
	});

	it("allows normal dotfile names", () => {
		expect(safePath(root, ".gitignore")).not.toBeNull();
	});

	it("allows directory with single dot", () => {
		expect(safePath(root, "./file.md")).not.toBeNull();
	});

	it("rejects null bytes in path", () => {
		// path.resolve handles null bytes, but the path would contain ".." check
		// This is more about defense in depth
		const result = safePath(root, "file\0../escape");
		// The ".." is in the string
		expect(result).toBeNull();
	});
});

describe("isValidId", () => {
	it("rejects empty string", () => {
		expect(isValidId("")).toBe(false);
	});

	it("rejects exact '..' traversal", () => {
		expect(isValidId("..")).toBe(false);
	});

	it("rejects path traversal with slashes (caught by slash check)", () => {
		expect(isValidId("../../../etc")).toBe(false);
		expect(isValidId("foo/..")).toBe(false);
		expect(isValidId("../foo")).toBe(false);
	});

	it("rejects forward slashes", () => {
		expect(isValidId("foo/bar")).toBe(false);
	});

	it("rejects backslashes", () => {
		expect(isValidId("foo\\bar")).toBe(false);
	});

	it("rejects null bytes", () => {
		expect(isValidId("foo\0bar")).toBe(false);
	});

	it("rejects IDs exceeding 255 characters", () => {
		expect(isValidId("a".repeat(256))).toBe(false);
		expect(isValidId("a".repeat(255))).toBe(true);
	});

	it("accepts valid IDs including consecutive dots", () => {
		expect(isValidId("2024-03-23-1545-my-plan")).toBe(true);
		expect(isValidId("simple-id")).toBe(true);
		expect(isValidId("plan.with.dots")).toBe(true);
		expect(isValidId("foo..bar")).toBe(true);
		expect(isValidId("v2..rc1")).toBe(true);
	});
});

describe("isContainedIn prefix attack", () => {
	it("rejects /root-evil from /root (prefix match attack)", () => {
		// /root-evil starts with "/root" but is NOT a child of /root
		// The path.sep check should prevent this
		expect(isContainedIn("/root-evil", "/root")).toBe(false);
	});

	it("rejects /root2 from /root", () => {
		expect(isContainedIn("/root2/sub", "/root")).toBe(false);
	});
});
