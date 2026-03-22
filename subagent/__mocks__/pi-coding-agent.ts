/**
 * Mock for @mariozechner/pi-coding-agent
 * withFileMutationQueue just runs the callback directly.
 */
export async function withFileMutationQueue<T>(
	_path: string,
	fn: () => Promise<T>,
): Promise<T> {
	return fn();
}

export function truncateHead(content: string) {
	return { content, truncated: false };
}

export function truncateTail(content: string) {
	return { content, truncated: false };
}

export const DEFAULT_MAX_BYTES = 50 * 1024;
export const DEFAULT_MAX_LINES = 2000;

export function getAgentDir() {
	return "/tmp/pi-agent";
}

export function parseFrontmatter<T>(content: string): { frontmatter: T; body: string } {
	const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!match) return { frontmatter: {} as T, body: content };
	const frontmatter: Record<string, string> = {};
	for (const line of match[1].split("\n")) {
		const [key, ...rest] = line.split(":");
		if (key && rest.length > 0) {
			frontmatter[key.trim()] = rest.join(":").trim();
		}
	}
	return { frontmatter: frontmatter as T, body: match[2] };
}

export type ExtensionAPI = Record<string, unknown>;
