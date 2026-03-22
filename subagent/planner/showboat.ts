import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Streaming callback ──

let streamCallback: ((section: string, content: string) => void) | null = null;

/** Set the live streaming callback for Showboat writes. */
export function setStreamCallback(cb: (section: string, content: string) => void): void {
	streamCallback = cb;
}

/** Clear the live streaming callback. */
export function clearStreamCallback(): void {
	streamCallback = null;
}

// ── Fallback writers (markdown via fs, no CLI dependency) ──

function ensureParentDir(filePath: string): void {
	const dir = path.dirname(filePath);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function fallbackInit(filePath: string, title: string): boolean {
	try {
		ensureParentDir(filePath);
		fs.writeFileSync(filePath, `---\ntitle: "${title.replace(/"/g, '\\"')}"\ndate: ${new Date().toISOString()}\n---\n\n# ${title}\n`);
		return true;
	} catch {
		return false;
	}
}

function fallbackNote(filePath: string, text: string): boolean {
	try {
		fs.appendFileSync(filePath, `\n\n${text}\n`);
		return true;
	} catch {
		return false;
	}
}

function fallbackExec(
	filePath: string,
	language: string,
	code: string,
): { ok: boolean; output: string } {
	try {
		fs.appendFileSync(filePath, `\n\n\`\`\`${language}\n${code}\n\`\`\`\n\n<!-- output not captured (no showboat CLI) -->\n`);
		return { ok: true, output: "" };
	} catch {
		return { ok: false, output: "" };
	}
}

// ── Public API (CLI with fallback) ──

/** Initialize a new Showboat document. Tries CLI first, falls back to direct markdown. */
export function showboatInit(filePath: string, title: string): boolean {
	try {
		ensureParentDir(filePath);
		execFileSync("showboat", ["init", filePath, title], { stdio: "pipe" });
		streamCallback?.("init", title);
		return true;
	} catch {
		const ok = fallbackInit(filePath, title);
		if (ok) streamCallback?.("init", title);
		return ok;
	}
}

/** Add a note (text section) to a Showboat document. Tries CLI first, falls back to append. */
export function showboatNote(filePath: string, text: string): boolean {
	try {
		execFileSync("showboat", ["note", filePath], {
			input: text,
			stdio: ["pipe", "pipe", "pipe"],
		});
		streamCallback?.("note", text);
		return true;
	} catch {
		const ok = fallbackNote(filePath, text);
		if (ok) streamCallback?.("note", text);
		return ok;
	}
}

/** Execute a command and capture output in the Showboat document. Tries CLI first, falls back to code block. */
export function showboatExec(
	filePath: string,
	language: string,
	code: string,
	workdir?: string,
): { ok: boolean; output: string } {
	try {
		const args = workdir
			? ["--workdir", workdir, "exec", filePath, language]
			: ["exec", filePath, language];
		const result = execFileSync("showboat", args, {
			input: code,
			stdio: ["pipe", "pipe", "pipe"],
			timeout: 30000,
		});
		const output = result.toString();
		streamCallback?.("exec", code);
		return { ok: true, output };
	} catch {
		const result = fallbackExec(filePath, language, code);
		if (result.ok) streamCallback?.("exec", code);
		return result;
	}
}

/** Verify a Showboat document by re-executing all code blocks. */
export function showboatVerify(filePath: string): { ok: boolean; output: string } {
	try {
		const result = execFileSync("showboat", ["verify", filePath], {
			stdio: ["pipe", "pipe", "pipe"],
			timeout: 120000,
		});
		return { ok: true, output: result.toString() };
	} catch (err: unknown) {
		const output = err && typeof err === "object" && "stdout" in err
			? String((err as { stdout: Buffer }).stdout)
			: "";
		return { ok: false, output };
	}
}
