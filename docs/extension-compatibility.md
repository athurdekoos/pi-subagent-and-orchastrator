# Extension Compatibility

Pi Tools is a [Pi Coding Agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) extension. This document explains how the project structure maps to Pi's extension system.

## How Pi Discovers Extensions

Pi auto-discovers extensions from:
- `~/.pi/agent/extensions/` — global (user-level)
- `.pi/extensions/` — project-local

Each extension is either a single `.ts` file or a directory with an `index.ts` that exports a default function:

```typescript
export default function (pi: ExtensionAPI) {
    // register tools, commands, event handlers
}
```

Pi loads extensions via [jiti](https://github.com/unjs/jiti), so TypeScript works without compilation.

## Project Layout

Development source lives at the project root in `subagent/`:

```
pi-subagent/
├── subagent/              # Development root (all source, tests, config)
│   ├── index.ts           # Extension entry point
│   ├── package.json
│   └── ...
└── .pi/
    └── extensions/
        └── pi-tools -> ../../subagent   # Symlink for Pi discovery
```

The symlink at `.pi/extensions/pi-tools` points to `subagent/`, allowing Pi to discover and load the extension while keeping the development root at a conventional location.

## Setting Up the Symlink

If the symlink doesn't exist (e.g., after a fresh clone):

```bash
mkdir -p .pi/extensions
ln -s ../../subagent .pi/extensions/pi-tools
```

## Runtime Data

The extension writes runtime data (plans, workflows, file-manager state) to `.pi/` subdirectories relative to the project's working directory:

| Subsystem | Data Directory |
|-----------|---------------|
| File Manager | `.pi/file-manager/` |
| Planner | `.pi/planner/` |
| Orchestrator | `.pi/orchestrator/` |

These are independent of the extension source location and are not affected by the symlink.

## Dependencies

The extension has `devDependencies` only (vitest, typescript, @types/node). At runtime, it imports from packages provided by the Pi host:

- `@mariozechner/pi-coding-agent` — ExtensionAPI, registerTool, etc.
- `@mariozechner/pi-ai` — model enums
- `@mariozechner/pi-tui` — UI components
- `@sinclair/typebox` — JSON schema builders

For testing, these are mocked in `subagent/__mocks__/`.
