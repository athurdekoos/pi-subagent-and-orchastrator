import { describe, it, expect } from "vitest";
import {
	isPathInScope,
	isOperationAllowed,
	isToolAllowed,
	enforceEnvelope,
} from "../envelope.js";
import type { ExecutionEnvelope } from "../types.js";

function makeEnvelope(overrides: Partial<ExecutionEnvelope> = {}): ExecutionEnvelope {
	return {
		pathScope: ["src/**"],
		allowedOperations: ["read", "write", "create"],
		allowedTools: ["files", "grep", "glob"],
		subagentPermissions: {
			maxConcurrent: 2,
			allowedCapabilities: ["read-only", "execution"],
		},
		changeBudget: {
			maxFilesModified: 10,
			maxFilesCreated: 5,
			maxLinesChanged: 500,
		},
		...overrides,
	};
}

describe("isPathInScope", () => {
	it("returns true for path matching an envelope glob", () => {
		expect(isPathInScope("src/foo.ts", ["src/**"])).toBe(true);
	});

	it("returns false for path outside scope", () => {
		expect(isPathInScope("dist/foo.ts", ["src/**"])).toBe(false);
	});

	it('returns true when "**" is in scope (matches everything)', () => {
		expect(isPathInScope("anything/deep/nested.ts", ["**"])).toBe(true);
	});
});

describe("isOperationAllowed", () => {
	it("returns true for allowed operations", () => {
		expect(isOperationAllowed("read", ["read", "write", "create"])).toBe(true);
	});

	it("returns false for disallowed operations", () => {
		expect(isOperationAllowed("delete", ["read", "write", "create"])).toBe(false);
	});
});

describe("isToolAllowed", () => {
	it("returns true for allowed tools", () => {
		expect(isToolAllowed("files", ["files", "grep", "glob"])).toBe(true);
	});

	it("returns false for disallowed tools", () => {
		expect(isToolAllowed("exec", ["files", "grep", "glob"])).toBe(false);
	});
});

describe("enforceEnvelope", () => {
	it("composes all checks and returns combined result", () => {
		const envelope = makeEnvelope();
		const result = enforceEnvelope(envelope, {
			filePath: "src/utils.ts",
			operation: "write",
			tool: "files",
		});
		expect(result.allowed).toBe(true);
		expect(result.violations).toEqual([]);
	});

	it("rejects delete when delete not in allowedOperations", () => {
		const envelope = makeEnvelope({ allowedOperations: ["read", "write", "create"] });
		const result = enforceEnvelope(envelope, {
			filePath: "src/utils.ts",
			operation: "delete",
			tool: "files",
		});
		expect(result.allowed).toBe(false);
		expect(result.violations.length).toBeGreaterThan(0);
		expect(result.violations.some((v) => v.includes("delete"))).toBe(true);
	});
});
