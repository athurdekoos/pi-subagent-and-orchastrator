import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
	BUILT_IN_TEMPLATES,
	loadTemplate,
	listTemplates,
	substituteVariables,
	analyzeTemplate,
	parseSections,
} from "../templates.js";

let tmpDir: string;
let root: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fm-tpl-"));
	root = path.join(tmpDir, "file-manager");
	fs.mkdirSync(path.join(root, "templates"), { recursive: true });
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("BUILT_IN_TEMPLATES", () => {
	it("has default template", () => {
		expect(BUILT_IN_TEMPLATES["default"]).toBeDefined();
	});

	it("has minimal template", () => {
		expect(BUILT_IN_TEMPLATES["minimal"]).toBeDefined();
	});

	it("has meeting template", () => {
		expect(BUILT_IN_TEMPLATES["meeting"]).toBeDefined();
	});

	it("has plan template", () => {
		expect(BUILT_IN_TEMPLATES["plan"]).toBeDefined();
	});
});

describe("loadTemplate", () => {
	it("returns built-in template by name", () => {
		const tpl = loadTemplate(root, "default");
		expect(tpl).not.toBeNull();
		expect(tpl).toContain("{{TITLE}}");
	});

	it("returns null for unknown template", () => {
		expect(loadTemplate(root, "nonexistent")).toBeNull();
	});

	it("prefers local template over built-in", () => {
		fs.writeFileSync(
			path.join(root, "templates", "default.md"),
			"# Custom Default\n{{TITLE}}",
		);
		const tpl = loadTemplate(root, "default");
		expect(tpl).toContain("Custom Default");
	});

	it("loads local-only template", () => {
		fs.writeFileSync(
			path.join(root, "templates", "custom.md"),
			"# Custom Template",
		);
		const tpl = loadTemplate(root, "custom");
		expect(tpl).toBe("# Custom Template");
	});
});

describe("listTemplates", () => {
	it("lists built-in templates", () => {
		const list = listTemplates(root);
		expect(list).toContain("default");
		expect(list).toContain("minimal");
		expect(list).toContain("meeting");
		expect(list).toContain("plan");
	});

	it("includes local templates", () => {
		fs.writeFileSync(path.join(root, "templates", "custom.md"), "# Custom");
		const list = listTemplates(root);
		expect(list).toContain("custom");
	});

	it("deduplicates built-in and local", () => {
		fs.writeFileSync(path.join(root, "templates", "default.md"), "# Custom Default");
		const list = listTemplates(root);
		const defaultCount = list.filter((n) => n === "default").length;
		expect(defaultCount).toBe(1);
	});

	it("returns sorted list", () => {
		const list = listTemplates(root);
		const sorted = [...list].sort();
		expect(list).toEqual(sorted);
	});
});

describe("substituteVariables", () => {
	it("replaces single variable", () => {
		expect(substituteVariables("Hello {{NAME}}", { NAME: "World" })).toBe("Hello World");
	});

	it("replaces multiple variables", () => {
		const result = substituteVariables("{{A}} and {{B}}", { A: "x", B: "y" });
		expect(result).toBe("x and y");
	});

	it("leaves unknown variables as-is", () => {
		expect(substituteVariables("{{UNKNOWN}}", {})).toBe("{{UNKNOWN}}");
	});

	it("handles template with no variables", () => {
		expect(substituteVariables("plain text", { A: "1" })).toBe("plain text");
	});

	it("replaces same variable multiple times", () => {
		expect(substituteVariables("{{X}} {{X}}", { X: "a" })).toBe("a a");
	});
});

describe("analyzeTemplate", () => {
	it("extracts variables", () => {
		const result = analyzeTemplate("# {{TITLE}}\n{{BODY}}");
		expect(result.variables).toContain("TITLE");
		expect(result.variables).toContain("BODY");
	});

	it("extracts H2 sections", () => {
		const result = analyzeTemplate("# Title\n## Overview\ntext\n## Details\nmore");
		expect(result.sections).toContain("Overview");
		expect(result.sections).toContain("Details");
	});

	it("classifies explicit-placeholders", () => {
		const result = analyzeTemplate("# {{TITLE}}\n## Section\ncontent");
		expect(result.classification).toBe("explicit-placeholders");
	});

	it("classifies legacy-fallback (vars but no sections)", () => {
		const result = analyzeTemplate("Hello {{NAME}}");
		expect(result.classification).toBe("legacy-fallback");
	});

	it("classifies default-fallback (no vars)", () => {
		const result = analyzeTemplate("# Static Content\nNo variables here.");
		expect(result.classification).toBe("default-fallback");
	});

	it("classifies invalid for empty template", () => {
		expect(analyzeTemplate("").classification).toBe("invalid");
		expect(analyzeTemplate("   ").classification).toBe("invalid");
	});

	it("deduplicates variable names", () => {
		const result = analyzeTemplate("{{A}} {{A}} {{B}}");
		expect(result.variables.filter((v) => v === "A").length).toBe(1);
	});
});

describe("parseSections", () => {
	it("parses H2 sections", () => {
		const sections = parseSections("# Title\n## Intro\nIntro text\n## Details\nDetail text");
		expect(sections.get("Intro")).toBe("Intro text");
		expect(sections.get("Details")).toBe("Detail text");
	});

	it("returns empty map for no sections", () => {
		const sections = parseSections("Just plain text");
		expect(sections.size).toBe(0);
	});

	it("handles empty sections", () => {
		const sections = parseSections("## Empty\n## Another\ncontent");
		expect(sections.get("Empty")).toBe("");
		expect(sections.get("Another")).toBe("content");
	});
});

describe("template edge cases", () => {
	it("substituteVariables handles variable-like but incomplete syntax", () => {
		// Single braces should not be substituted
		expect(substituteVariables("{NOT_A_VAR}", { NOT_A_VAR: "x" })).toBe("{NOT_A_VAR}");
	});

	it("substituteVariables handles empty variable name", () => {
		// {{}} should not match \w+
		expect(substituteVariables("{{}}", {})).toBe("{{}}");
	});

	it("analyzeTemplate with whitespace-only content", () => {
		const result = analyzeTemplate("   \n   \n   ");
		expect(result.classification).toBe("invalid");
	});

	it("parseSections handles H3 (not H2) as non-section", () => {
		const sections = parseSections("### Not H2\ncontent");
		expect(sections.size).toBe(0);
	});

	it("parseSections handles H2 with special characters", () => {
		const sections = parseSections("## Section (v2.0) — Updated!\ncontent");
		expect(sections.has("Section (v2.0) — Updated!")).toBe(true);
	});

	it("loadTemplate returns null when templates dir missing", () => {
		fs.rmSync(path.join(root, "templates"), { recursive: true });
		// Built-in should still work
		expect(loadTemplate(root, "default")).not.toBeNull();
		// But custom should not
		expect(loadTemplate(root, "custom")).toBeNull();
	});
});

describe("template variable edge cases", () => {
	it("handles variable with special regex chars in value", () => {
		const result = substituteVariables("{{NAME}}", { NAME: "a$b.c*d" });
		expect(result).toBe("a$b.c*d");
	});

	it("handles template with adjacent variables", () => {
		const result = substituteVariables("{{A}}{{B}}", { A: "x", B: "y" });
		expect(result).toBe("xy");
	});

	it("analyzeTemplate counts unique variables correctly", () => {
		const result = analyzeTemplate("{{A}} {{B}} {{A}} {{C}} {{B}}");
		expect(result.variables.length).toBe(3);
	});
});
