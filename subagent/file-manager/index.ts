/**
 * File Manager Extension — Entry Point
 *
 * Registers the "files" tool (LLM-callable), "/files" command (user-facing),
 * and lifecycle hooks for the pi coding agent.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateHead } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

import { archiveActive, countArchives, extractTitle, getArchive, listArchives } from "./archives.js";
import { CONFIG_DEFAULTS, getConfigPath, loadConfig, saveConfig } from "./config.js";
import { forceWrite, readContent, safeWrite } from "./content.js";
import { captureSnapshot, writeSnapshot } from "./diagnostics.js";
import { regenerateIndex } from "./index-gen.js";
import { initializeStructure } from "./init.js";
import { readMeta, updateMeta } from "./metadata.js";
import { detectLegacyLayout, migrate } from "./migration.js";
import { resolveRoot } from "./paths.js";
import { detectRoot, getStateInfo } from "./state.js";
import { analyzeTemplate, listTemplates, loadTemplate, substituteVariables } from "./templates.js";
import type { FileManagerConfig } from "./types.js";

const TOOL_ACTIONS = [
	"init",
	"read",
	"write",
	"force_write",
	"archive",
	"list",
	"restore",
	"status",
	"config_get",
	"config_set",
	"meta_get",
	"meta_set",
	"template_apply",
	"template_list",
	"snapshot",
] as const;

type ToolAction = (typeof TOOL_ACTIONS)[number];

interface ToolParams {
	action: ToolAction;
	content?: string;
	filename?: string;
	template?: string;
	variables?: Record<string, string>;
	key?: string;
	value?: string;
}

interface ToolDetails {
	action: ToolAction;
	success: boolean;
	message: string;
	data?: unknown;
}

export function registerFileManager(pi: ExtensionAPI) {
	// --- Tool Registration (LLM-callable) ---

	pi.registerTool({
		name: "files",
		label: "File Manager",
		description:
			"Manage structured files: initialize directory structure, read/write active content, archive, list archives, restore, configure, track metadata, apply templates, and capture diagnostic snapshots.",
		promptSnippet: "Structured file management with archiving and templates",
		promptGuidelines: [
			"Use action 'init' to set up the file management directory structure",
			"Use action 'read' to read the current active content",
			"Use action 'write' to safely write content (fails if active content exists; archive first)",
			"Use action 'force_write' to overwrite active content unconditionally",
			"Use action 'archive' to archive active content and reset to placeholder",
			"Use action 'list' to list all archived files",
			"Use action 'restore' with filename to restore an archive to active",
			"Use action 'status' to check current state and phase",
			"Use action 'template_apply' with template name and variables to create content from template",
			"Use action 'template_list' to list available templates",
			"Use action 'snapshot' to capture a diagnostic snapshot",
		],
		parameters: Type.Object({
			action: StringEnum([...TOOL_ACTIONS]),
			content: Type.Optional(Type.String({ description: "Content to write (for write/force_write)" })),
			filename: Type.Optional(Type.String({ description: "Archive filename (for restore/read archive)" })),
			template: Type.Optional(Type.String({ description: "Template name (for template_apply)" })),
			variables: Type.Optional(
				Type.Record(Type.String(), Type.String(), {
					description: "Template variables (for template_apply)",
				}),
			),
			key: Type.Optional(Type.String({ description: "Config/meta field key (for config_get/set, meta_get/set)" })),
			value: Type.Optional(Type.String({ description: "Value to set (for config_set, meta_set)" })),
		}),

		async execute(_toolCallId, params: ToolParams, _signal, _onUpdate, ctx) {
			const cwd = ctx.cwd;
			const config = loadConfigForCwd(cwd);
			const root = resolveRoot(cwd, config.rootDir);

			const result = await executeAction(params, root, config, cwd);
			const truncated = truncateHead(result.message);

			return {
				content: [{ type: "text" as const, text: truncated.content }],
				details: result,
			};
		},

		renderCall(args: ToolParams, theme) {
			const fg = theme.fg.bind(theme);
			const actionLabel = fg("accent", args.action);
			let detail = "";
			if (args.filename) detail += ` ${fg("warning", args.filename)}`;
			if (args.template) detail += ` template:${fg("warning", args.template)}`;
			if (args.key) detail += ` ${fg("muted", args.key)}`;
			return new Text(`files ${actionLabel}${detail}`, 0, 0);
		},

		renderResult(result, _opts, theme) {
			const details = result.details as ToolDetails | undefined;
			if (!details) return undefined;
			const fg = theme.fg.bind(theme);
			const status = details.success ? fg("success", "✓") : fg("error", "✗");
			return new Text(`${status} ${details.message}`, 0, 0);
		},
	});

	// --- Command Registration (user-facing /files) ---

	pi.registerCommand("files", {
		description: "File management: init | create | view | list | archive | restore | debug | config",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/);
			const subcommand = parts[0] || "status";
			const rest = parts.slice(1).join(" ");
			const cwd = ctx.cwd;
			const config = loadConfigForCwd(cwd);
			const root = resolveRoot(cwd, config.rootDir);

			switch (subcommand) {
				case "init": {
					const result = await initializeStructure(root, config.activeFilename);
					ctx.ui.notify(
						`Initialized: ${result.created.length} created, ${result.skipped.length} skipped`,
						"info",
					);
					break;
				}
				case "create": {
					// Parse --template flag
					const templateMatch = rest.match(/--template\s+(\S+)/);
					const templateName = templateMatch?.[1] || "default";

					const template = loadTemplate(root, templateName);
					if (!template) {
						ctx.ui.notify(`Template not found: ${templateName}`, "error");
						return;
					}

					// Collect variables interactively
					const analysis = analyzeTemplate(template);
					const vars: Record<string, string> = {};
					for (const varName of analysis.variables) {
						const value = await ctx.ui.input(`${varName}:`, `Enter ${varName.toLowerCase()}`);
						vars[varName] = value;
					}

					const content = substituteVariables(template, vars);
					const writeResult = await safeWrite(root, config.activeFilename, content);
					if (writeResult.ok) {
						await updateMeta(root, { title: vars["TITLE"] || extractTitle(content) });
						ctx.ui.notify("Content created from template", "info");
					} else {
						ctx.ui.notify(writeResult.reason || "Write failed", "error");
					}
					break;
				}
				case "view": {
					const content = readContent(root, config.activeFilename);
					if (content) {
						pi.sendMessage({
							role: "custom",
							customType: "file-manager-view",
							content,
						});
					} else {
						ctx.ui.notify("No active content", "info");
					}
					break;
				}
				case "list": {
					const archives = listArchives(root, config.maxListEntries);
					if (archives.length === 0) {
						ctx.ui.notify("No archives", "info");
					} else {
						const lines = archives.map(
							(a) => `${a.date} — ${a.title} (${a.filename})`,
						);
						pi.sendMessage({
							role: "custom",
							customType: "file-manager-list",
							content: `## Archives (${archives.length})\n\n${lines.join("\n")}`,
						});
					}
					break;
				}
				case "archive": {
					const content = readContent(root, config.activeFilename);
					if (!content) {
						ctx.ui.notify("Nothing to archive", "info");
						return;
					}
					const ok = await ctx.ui.confirm(
						"Archive",
						"Archive active content and reset to placeholder?",
					);
					if (!ok) return;

					const entry = await archiveActive(root, config.activeFilename, config);
					if (entry) {
						await regenerateIndex(root);
						ctx.ui.notify(`Archived: ${entry.filename}`, "info");
					} else {
						ctx.ui.notify("Archive failed", "error");
					}
					break;
				}
				case "restore": {
					if (!rest) {
						ctx.ui.notify("Usage: /files restore <filename>", "error");
						return;
					}
					const archiveContent = getArchive(root, rest);
					if (!archiveContent) {
						ctx.ui.notify(`Archive not found: ${rest}`, "error");
						return;
					}

					// Archive current content first if it exists
					const current = readContent(root, config.activeFilename);
					if (current) {
						const ok = await ctx.ui.confirm(
							"Replace",
							"Active content exists. Archive it first?",
						);
						if (ok) {
							await archiveActive(root, config.activeFilename, config);
							await regenerateIndex(root);
						} else {
							return;
						}
					}

					await forceWrite(root, config.activeFilename, archiveContent);
					await updateMeta(root, { title: extractTitle(archiveContent) });
					ctx.ui.notify(`Restored: ${rest}`, "info");
					break;
				}
				case "debug": {
					const snapshot = captureSnapshot(root, config);
					const snapshotPath = await writeSnapshot(root, snapshot);
					if (snapshotPath) {
						ctx.ui.notify(`Diagnostic written: ${snapshotPath}`, "info");
					} else {
						ctx.ui.notify("Failed to write diagnostic", "error");
					}
					pi.sendMessage({
						role: "custom",
						customType: "file-manager-debug",
						content: JSON.stringify(snapshot, null, 2),
					});
					break;
				}
				case "config": {
					if (!rest) {
						// Show current config
						const current = loadConfig(root);
						pi.sendMessage({
							role: "custom",
							customType: "file-manager-config",
							content: `## Configuration\n\n\`\`\`json\n${JSON.stringify(current, null, 2)}\n\`\`\`\n\nConfig file: ${getConfigPath(root)}`,
						});
					} else {
						const [key, ...valueParts] = rest.split(/\s+/);
						const value = valueParts.join(" ");
						if (!value) {
							// Show single key
							const current = loadConfig(root);
							const val = (current as Record<string, unknown>)[key];
							ctx.ui.notify(`${key} = ${JSON.stringify(val)}`, "info");
						} else {
							// Set key
							let parsedValue: unknown;
							try {
								parsedValue = JSON.parse(value);
							} catch {
								parsedValue = value;
							}
							saveConfig(root, { [key]: parsedValue } as Partial<FileManagerConfig>);
							ctx.ui.notify(`Set ${key} = ${JSON.stringify(parsedValue)}`, "info");
						}
					}
					break;
				}
				case "status": {
					const state = getStateInfo(cwd, config);
					const archiveCount = state.root ? countArchives(state.root) : 0;
					const meta = state.root ? readMeta(state.root) : null;
					const lines = [
						`Phase: ${state.phase}`,
						`Root: ${state.root || "not initialized"}`,
						`Active content: ${state.hasActive ? "yes" : "no"}`,
						`Archives: ${archiveCount}`,
					];
					if (meta?.title) lines.push(`Title: ${meta.title}`);
					ctx.ui.notify(lines.join(" | "), "info");
					break;
				}
				default:
					ctx.ui.notify(
						`Unknown subcommand: ${subcommand}. Use: init | create | view | list | archive | restore | debug | config | status`,
						"error",
					);
			}
		},
	});

	// --- Lifecycle Hooks ---

	pi.on("session_start", async (_event, ctx) => {
		const cwd = ctx.cwd;
		const config = loadConfigForCwd(cwd);
		const root = detectRoot(cwd, config.rootDir);

		if (root) {
			// Check for legacy layout and auto-migrate
			const legacy = detectLegacyLayout(root);
			if (legacy.isLegacy) {
				await migrate(root, config);
			}
		}
	});
}

// --- Action executor for the tool ---

async function executeAction(
	params: ToolParams,
	root: string,
	config: FileManagerConfig,
	cwd: string,
): Promise<ToolDetails> {
	const { action } = params;

	switch (action) {
		case "init": {
			const result = await initializeStructure(root, config.activeFilename);
			return {
				action,
				success: true,
				message: `Initialized: ${result.created.length} created, ${result.skipped.length} skipped`,
				data: result,
			};
		}
		case "read": {
			if (params.filename) {
				// Read a specific archive
				const content = getArchive(root, params.filename);
				if (content === null) {
					return { action, success: false, message: `Archive not found: ${params.filename}` };
				}
				return { action, success: true, message: content, data: { source: "archive" } };
			}
			const content = readContent(root, config.activeFilename);
			if (content === null) {
				return { action, success: false, message: "No active content" };
			}
			return { action, success: true, message: content, data: { source: "active" } };
		}
		case "write": {
			if (!params.content) {
				return { action, success: false, message: "Content parameter required" };
			}
			const result = await safeWrite(root, config.activeFilename, params.content);
			if (result.ok) {
				await updateMeta(root, { title: extractTitle(params.content) });
				return { action, success: true, message: "Content written successfully" };
			}
			return { action, success: false, message: result.reason || "Write failed" };
		}
		case "force_write": {
			if (!params.content) {
				return { action, success: false, message: "Content parameter required" };
			}
			const ok = await forceWrite(root, config.activeFilename, params.content);
			if (ok) {
				await updateMeta(root, { title: extractTitle(params.content) });
				return { action, success: true, message: "Content force-written successfully" };
			}
			return { action, success: false, message: "Force write failed" };
		}
		case "archive": {
			const entry = await archiveActive(root, config.activeFilename, config);
			if (entry) {
				await regenerateIndex(root);
				return {
					action,
					success: true,
					message: `Archived as ${entry.filename}`,
					data: entry,
				};
			}
			return { action, success: false, message: "Nothing to archive or archive failed" };
		}
		case "list": {
			const archives = listArchives(root, config.maxListEntries);
			if (archives.length === 0) {
				return { action, success: true, message: "No archives", data: [] };
			}
			const lines = archives.map((a) => `- ${a.date} — ${a.title} (${a.filename})`);
			return {
				action,
				success: true,
				message: `${archives.length} archive(s):\n${lines.join("\n")}`,
				data: archives,
			};
		}
		case "restore": {
			if (!params.filename) {
				return { action, success: false, message: "Filename parameter required" };
			}
			const archiveContent = getArchive(root, params.filename);
			if (archiveContent === null) {
				return { action, success: false, message: `Archive not found: ${params.filename}` };
			}
			// Archive current if exists
			const current = readContent(root, config.activeFilename);
			if (current) {
				await archiveActive(root, config.activeFilename, config);
				await regenerateIndex(root);
			}
			const ok = await forceWrite(root, config.activeFilename, archiveContent);
			if (ok) {
				await updateMeta(root, { title: extractTitle(archiveContent) });
				return { action, success: true, message: `Restored ${params.filename}` };
			}
			return { action, success: false, message: "Restore failed" };
		}
		case "status": {
			const state = getStateInfo(cwd, config);
			const archiveCount = state.root ? countArchives(state.root) : 0;
			const meta = state.root ? readMeta(state.root) : null;
			return {
				action,
				success: true,
				message: `Phase: ${state.phase}, Active: ${state.hasActive}, Archives: ${archiveCount}${meta?.title ? `, Title: ${meta.title}` : ""}`,
				data: { ...state, archiveCount, meta },
			};
		}
		case "config_get": {
			const current = loadConfig(root);
			if (params.key) {
				const val = (current as Record<string, unknown>)[params.key];
				return {
					action,
					success: true,
					message: `${params.key} = ${JSON.stringify(val)}`,
					data: { key: params.key, value: val },
				};
			}
			return {
				action,
				success: true,
				message: JSON.stringify(current, null, 2),
				data: current,
			};
		}
		case "config_set": {
			if (!params.key || params.value === undefined) {
				return { action, success: false, message: "Key and value parameters required" };
			}
			let parsedValue: unknown;
			try {
				parsedValue = JSON.parse(params.value);
			} catch {
				parsedValue = params.value;
			}
			const ok = saveConfig(root, { [params.key]: parsedValue } as Partial<FileManagerConfig>);
			return {
				action,
				success: ok,
				message: ok ? `Set ${params.key} = ${JSON.stringify(parsedValue)}` : "Config save failed",
			};
		}
		case "meta_get": {
			const meta = readMeta(root);
			if (!meta) {
				return { action, success: false, message: "No metadata found" };
			}
			if (params.key) {
				const val = params.key === "custom"
					? meta.custom
					: (meta as Record<string, unknown>)[params.key];
				return {
					action,
					success: true,
					message: `${params.key} = ${JSON.stringify(val)}`,
					data: { key: params.key, value: val },
				};
			}
			return { action, success: true, message: JSON.stringify(meta, null, 2), data: meta };
		}
		case "meta_set": {
			if (!params.key || params.value === undefined) {
				return { action, success: false, message: "Key and value parameters required" };
			}
			let parsedValue: unknown;
			try {
				parsedValue = JSON.parse(params.value);
			} catch {
				parsedValue = params.value;
			}

			const patch: Partial<Record<string, unknown>> = {};
			if (params.key === "title" || params.key === "version") {
				patch[params.key] = String(parsedValue);
			} else {
				patch.custom = { [params.key]: parsedValue };
			}

			const updated = await updateMeta(root, patch as Partial<import("./types.js").FileManagerMeta>);
			return {
				action,
				success: updated !== null,
				message: updated ? `Set ${params.key} = ${JSON.stringify(parsedValue)}` : "Metadata update failed",
			};
		}
		case "template_apply": {
			const templateName = params.template || "default";
			const template = loadTemplate(root, templateName);
			if (!template) {
				return { action, success: false, message: `Template not found: ${templateName}` };
			}

			const vars = params.variables || {};
			const content = substituteVariables(template, vars);
			const writeResult = await safeWrite(root, config.activeFilename, content);
			if (writeResult.ok) {
				await updateMeta(root, { title: vars["TITLE"] || extractTitle(content) });
				return { action, success: true, message: `Template '${templateName}' applied` };
			}
			return { action, success: false, message: writeResult.reason || "Template apply failed" };
		}
		case "template_list": {
			const templates = listTemplates(root);
			return {
				action,
				success: true,
				message: templates.length > 0
					? `Available templates: ${templates.join(", ")}`
					: "No templates available",
				data: templates,
			};
		}
		case "snapshot": {
			const snapshot = captureSnapshot(root, config);
			const snapshotPath = await writeSnapshot(root, snapshot);
			return {
				action,
				success: snapshotPath !== null,
				message: snapshotPath
					? `Diagnostic snapshot written to ${snapshotPath}`
					: "Failed to write snapshot",
				data: snapshot,
			};
		}
		default:
			return { action, success: false, message: `Unknown action: ${action}` };
	}
}

// --- Helpers ---

function loadConfigForCwd(cwd: string): FileManagerConfig {
	const root = resolveRoot(cwd, CONFIG_DEFAULTS.rootDir);
	return loadConfig(root);
}
