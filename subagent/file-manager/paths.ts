/**
 * Path safety utilities.
 * All path operations resolve relative to a known root to prevent traversal attacks.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Resolve the root directory as an absolute path anchored to cwd.
 */
export function resolveRoot(cwd: string, configuredRoot: string): string {
	return path.resolve(cwd, configuredRoot);
}

/**
 * Check if a child path is contained within a parent path.
 * Both paths are resolved to absolute before comparison.
 * When the child path exists on disk, resolves symlinks to prevent symlink escapes.
 */
export function isContainedIn(child: string, parent: string): boolean {
	let resolvedChild = path.resolve(child);
	const resolvedParent = path.resolve(parent);

	// If the path exists, resolve symlinks to prevent symlink-based escapes
	try {
		resolvedChild = fs.realpathSync(resolvedChild);
	} catch {
		// Path doesn't exist yet — fall back to logical resolution
	}
	let realParent = resolvedParent;
	try {
		realParent = fs.realpathSync(resolvedParent);
	} catch {
		// Parent doesn't exist — fall back to logical resolution
	}

	return resolvedChild === realParent || resolvedChild.startsWith(realParent + path.sep);
}

/**
 * Resolve a relative path safely within a root directory.
 * Returns the absolute path if safe, null if it would escape root or contains "..".
 */
export function safePath(root: string, relativePath: string): string | null {
	if (relativePath.includes("..")) return null;
	const resolved = path.resolve(root, relativePath);
	if (!isContainedIn(resolved, root)) return null;
	return resolved;
}

/**
 * Validate an ID string for use as a filesystem path segment.
 * Rejects IDs containing path traversal sequences, path separators, or null bytes.
 * Returns true if the ID is safe to use in path.join().
 */
export function isValidId(id: string): boolean {
	if (!id || id.length === 0) return false;
	if (id.length > 255) return false;
	if (id === "..") return false;
	if (id.includes("/")) return false;
	if (id.includes("\\")) return false;
	if (id.includes("\0")) return false;
	return true;
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 * Never throws — returns false on error.
 */
export function ensureDir(dir: string): boolean {
	try {
		fs.mkdirSync(dir, { recursive: true });
		return true;
	} catch {
		return false;
	}
}

/**
 * Check if a path exists and is a directory.
 */
export function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Check if a path exists and is a file.
 */
export function isFile(p: string): boolean {
	try {
		return fs.statSync(p).isFile();
	} catch {
		return false;
	}
}

/**
 * Read a file's contents as UTF-8. Returns null on error.
 */
export function readFileSafe(filePath: string): string | null {
	try {
		return fs.readFileSync(filePath, "utf-8");
	} catch {
		return null;
	}
}

/**
 * Write content to a file, creating parent directories if needed.
 * Returns true on success, false on error.
 */
export function writeFileSafe(filePath: string, content: string): boolean {
	try {
		ensureDir(path.dirname(filePath));
		fs.writeFileSync(filePath, content, "utf-8");
		return true;
	} catch {
		return false;
	}
}

/**
 * Get file size in bytes. Returns 0 on error.
 */
export function fileSize(filePath: string): number {
	try {
		return fs.statSync(filePath).size;
	} catch {
		return 0;
	}
}

/**
 * Count lines in a file. Returns 0 on error.
 */
export function fileLineCount(filePath: string): number {
	const content = readFileSafe(filePath);
	if (content === null) return 0;
	return content.split("\n").length;
}
