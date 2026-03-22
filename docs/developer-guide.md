# Developer Guide

## Prerequisites

- Node.js (ES2022+ support)
- npm

## Setup

```bash
cd subagent
npm install
```

## Running Tests

```bash
npm test              # Single run (vitest)
npm run test:watch    # Watch mode
```

The test suite has 30 test files with 683 tests covering all four subsystems.

## Type Checking

```bash
cd subagent
npx tsc --noEmit
```

This reports ~128 type errors. These are **pre-existing and structural** — they do not indicate bugs:

- The `pi` global (`ExtensionAPI` from `@mariozechner/pi-coding-agent`) is untyped in the test/mock context
- Mock type mismatches exist between `__mocks__/` stubs and actual Pi API interfaces
- These do not affect test execution because vitest transpiles TypeScript independently of tsc

## Project Structure

```
subagent/
├── index.ts                  # Extension entry point — registers all 4 subsystems
├── subagent/                 # Subagent delegation tool
│   ├── subagent.ts           # Tool registration, process spawning, JSON output
│   └── agents.ts             # Agent discovery from user + project directories
├── file-manager/             # Structured content management
│   ├── index.ts              # Tool + /files command registration
│   ├── types.ts              # Constants, interfaces (Phase, ArchiveEntry, etc.)
│   ├── config.ts             # Load/save config with defaults
│   ├── content.ts            # Active content CRUD with safety checks
│   ├── archives.ts           # Immutable archive lifecycle
│   ├── metadata.ts           # JSON metadata read-patch-write
│   ├── state.ts              # Filesystem-computed state detection
│   ├── init.ts               # Idempotent directory creation
│   ├── paths.ts              # Safe path resolution, file I/O helpers
│   ├── naming.ts             # Slug, timestamp, filename generation
│   ├── templates.ts          # Template loading and variable substitution
│   ├── diagnostics.ts        # Read-only state snapshots
│   ├── migration.ts          # Legacy layout detection and migration
│   ├── index-gen.ts          # Full-rebuild archive index generation
│   └── __tests__/            # All file-manager tests
├── planner/                  # TDD plan creation with validation
│   ├── index.ts              # Tool + /plan command registration
│   ├── types.ts              # Plan schema, FSM states, validation codes
│   ├── fsm.ts                # Planner FSM (9 states, serialize/deserialize)
│   ├── schema.ts             # Plan/phase/task/envelope creation helpers
│   ├── validator.ts          # Multi-stage plan validation
│   ├── graph.ts              # DAG analysis (topological sort, cycle detection)
│   ├── scoring.ts            # Completeness scoring across 6 dimensions
│   ├── envelope.ts           # Glob validation, scope constraint checks
│   ├── errors.ts             # Standardized error messages
│   ├── persistence.ts        # Plan save/load/list from disk
│   ├── showboat.ts           # Audit log generation
│   ├── ci.ts                 # CI validation helpers
│   └── __tests__/            # All planner tests
├── orchestrator/             # Plan execution engine
│   ├── index.ts              # Tool + /exec command registration
│   ├── types.ts              # Workflow schema, FSM states, policy types
│   ├── fsm.ts                # Orchestrator FSM (9 states)
│   ├── ledger.ts             # Step ledger (task execution tracking)
│   ├── budget.ts             # Budget tracker (files, lines limits)
│   ├── policy.ts             # Risk evaluation (auto-allow vs approval)
│   ├── envelope.ts           # Runtime envelope enforcement
│   ├── subagent-gov.ts       # Subagent capability binding and validation
│   ├── persistence.ts        # Workflow save/load
│   ├── showboat.ts           # Execution audit logging
│   ├── ci.ts                 # CI validation and reporting
│   └── __tests__/            # All orchestrator tests
├── agents/                   # Agent definitions (markdown + YAML frontmatter)
├── prompts/                  # Workflow preset templates
├── __mocks__/                # Mock stubs for external dependencies
│   ├── pi-coding-agent.ts    # Mock ExtensionAPI
│   ├── pi-ai.ts              # Mock StringEnum
│   ├── pi-tui.ts             # Mock UI components
│   └── typebox.ts            # Mock TypeBox schema builders
```

## Test Organization

Tests are colocated with their modules in `__tests__/` subdirectories.

**Naming conventions**:
- `<module>.test.ts` — unit tests for a module (e.g., `config.test.ts`, `naming.test.ts`)
- `<subsystem>-<aspect>.test.ts` — focused tests (e.g., `orchestrator-budget.test.ts`, `orchestrator-policy.test.ts`)
- `<subsystem>-ac.test.ts` — acceptance criteria tests (e.g., `planner-ac.test.ts`, `orchestrator-ac.test.ts`)

**Test patterns**:
- Vitest with globals enabled (`describe`, `it`, `expect` without imports)
- Temp directories for isolated filesystem tests (`beforeEach` creates, `afterEach` removes)
- External dependencies mocked via `__mocks__/` directory and `vitest.config.ts` path aliases
- Data builders (`buildValidPlan()`, `makeEnvelope()`, `makeTask()`) for test fixtures

## Conventions

- **ES Modules** — `"type": "module"` in package.json; imports use `.js` extensions
- **Strict TypeScript** — strict mode enabled in tsconfig.json
- **Target**: ES2022 with ESNext module format, bundler resolution
- **FSM pattern** — stateful subsystems (planner, orchestrator) use the shared FSM class pattern with `transition()`, `canTransition()`, `serialize()`, `deserialize()`
- **JSON persistence** — all state persisted as JSON files with safe read/write helpers from `file-manager/paths.ts`
- **Path aliases** — `tsconfig.json` maps external package names to `__mocks__/` for testing

## Extension Deployment

The `subagent/` directory is symlinked into `.pi/extensions/pi-tools/` so Pi's runtime auto-discovers it. See [extension-compatibility.md](extension-compatibility.md) for details.

## Adding a New Subsystem

Follow the pattern of existing subsystems:

1. Create a directory under `subagent/` (e.g., `my-tool/`)
2. Add `index.ts` with a `registerMyTool(pi: ExtensionAPI)` function that calls `pi.registerTool()` and optionally `pi.registerCommand()`
3. Add `types.ts` with constants and interfaces
4. If stateful, add `fsm.ts` following the `PlannerFSM` / `OrchestratorFSM` pattern
5. Register in the root `index.ts`:
   ```typescript
   import { registerMyTool } from "./my-tool/index.js";
   // ...
   registerMyTool(pi);
   ```
6. Add test files in `my-tool/__tests__/`
