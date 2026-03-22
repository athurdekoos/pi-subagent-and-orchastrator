import { defineConfig } from "vitest/config";
import * as path from "node:path";

export default defineConfig({
	resolve: {
		alias: {
			"@mariozechner/pi-coding-agent": path.resolve(__dirname, "__mocks__/pi-coding-agent.ts"),
			"@mariozechner/pi-ai": path.resolve(__dirname, "__mocks__/pi-ai.ts"),
			"@mariozechner/pi-tui": path.resolve(__dirname, "__mocks__/pi-tui.ts"),
			"@sinclair/typebox": path.resolve(__dirname, "__mocks__/typebox.ts"),
		},
	},
	test: {
		globals: true,
	},
});
