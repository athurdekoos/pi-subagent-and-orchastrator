/**
 * Template system — repo-local templates with built-in defaults,
 * variable substitution, and template analysis.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { readFileSafe } from "./paths.js";
import type { TemplateClassification } from "./types.js";

/** Built-in default templates. */
export const BUILT_IN_TEMPLATES: Record<string, string> = {
	default: `# {{TITLE}}

## Overview

{{DESCRIPTION}}

## Details

<!-- Add your content here -->
`,
	minimal: `# {{TITLE}}

{{CONTENT}}
`,
	meeting: `# {{TITLE}}

## Date

{{DATE}}

## Attendees

- {{ATTENDEES}}

## Agenda

1. {{AGENDA}}

## Notes

## Action Items

- [ ]
`,
	plan: `# {{TITLE}}

## Goal

{{GOAL}}

## Plan

1.

## Files to Modify

-

## Risks

-
`,
};

/**
 * Load a template by name.
 * Checks repo-local templates directory first, then built-in defaults.
 * Returns null if not found.
 */
export function loadTemplate(root: string, name: string): string | null {
	// Check repo-local templates first
	const localPath = path.join(root, "templates", `${name}.md`);
	const localContent = readFileSafe(localPath);
	if (localContent !== null) return localContent;

	// Fall back to built-in templates
	return BUILT_IN_TEMPLATES[name] ?? null;
}

/**
 * List available templates (both local and built-in).
 */
export function listTemplates(root: string): string[] {
	const names = new Set(Object.keys(BUILT_IN_TEMPLATES));

	try {
		const templateDir = path.join(root, "templates");
		const entries = fs.readdirSync(templateDir, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.isFile() && entry.name.endsWith(".md")) {
				names.add(entry.name.replace(/\.md$/, ""));
			}
		}
	} catch {
		// templates dir may not exist
	}

	return Array.from(names).sort();
}

/**
 * Substitute {{VARIABLE}} placeholders in a template.
 */
export function substituteVariables(
	template: string,
	vars: Record<string, string>,
): string {
	return template.replace(/\{\{(\w+)\}\}/g, (match, varName: string) => {
		return vars[varName] ?? match;
	});
}

/**
 * Analyze a template and extract metadata.
 */
export function analyzeTemplate(template: string): {
	variables: string[];
	sections: string[];
	classification: TemplateClassification;
} {
	// Extract {{VARIABLE}} names
	const variableSet = new Set<string>();
	const varRegex = /\{\{(\w+)\}\}/g;
	let match: RegExpExecArray | null;
	while ((match = varRegex.exec(template)) !== null) {
		variableSet.add(match[1]);
	}

	// Extract ## Section headings
	const sections: string[] = [];
	const sectionRegex = /^## (.+)$/gm;
	while ((match = sectionRegex.exec(template)) !== null) {
		sections.push(match[1].trim());
	}

	// Classify
	let classification: TemplateClassification;
	if (template.trim().length === 0) {
		classification = "invalid";
	} else if (variableSet.size > 0 && sections.length > 0) {
		classification = "explicit-placeholders";
	} else if (variableSet.size > 0) {
		classification = "legacy-fallback";
	} else {
		classification = "default-fallback";
	}

	return {
		variables: Array.from(variableSet),
		sections,
		classification,
	};
}

/**
 * Parse H2 sections from markdown content.
 * Returns a map of section heading → section content.
 */
export function parseSections(content: string): Map<string, string> {
	const sections = new Map<string, string>();
	const lines = content.split("\n");
	let currentHeading: string | null = null;
	let currentLines: string[] = [];

	for (const line of lines) {
		const headingMatch = line.match(/^## (.+)$/);
		if (headingMatch) {
			if (currentHeading !== null) {
				sections.set(currentHeading, currentLines.join("\n").trim());
			}
			currentHeading = headingMatch[1].trim();
			currentLines = [];
		} else if (currentHeading !== null) {
			currentLines.push(line);
		}
	}

	if (currentHeading !== null) {
		sections.set(currentHeading, currentLines.join("\n").trim());
	}

	return sections;
}
