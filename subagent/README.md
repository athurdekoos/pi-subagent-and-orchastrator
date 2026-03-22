# Pi Tools

Unified extension combining **subagent delegation**, **file management**, **TDD planning**, and **execution orchestration** into a single entry point.

For architecture overview and deep dives, see the [docs/](../docs/) directory.

## Structure

```
subagent/
├── index.ts                 # Unified entry point (registers all 4 subsystems)
├── subagent/
│   ├── subagent.ts          # Subagent tool (single, parallel, chain modes)
│   └── agents.ts            # Agent discovery logic
├── file-manager/
│   ├── index.ts             # File manager tool + /files command
│   ├── types.ts             # Constants, interfaces
│   ├── paths.ts             # Path safety, file I/O helpers
│   ├── naming.ts            # Slug/timestamp/filename generation
│   ├── config.ts            # Configuration with validation
│   ├── state.ts             # Filesystem-computed state detection
│   ├── init.ts              # Idempotent directory creation
│   ├── content.ts           # Active content CRUD with safety
│   ├── metadata.ts          # JSON metadata with read-patch-write
│   ├── templates.ts         # Template loading, substitution, analysis
│   ├── archives.ts          # Immutable archive lifecycle
│   ├── index-gen.ts         # Full-rebuild archive index
│   ├── diagnostics.ts       # Read-only state snapshots
│   ├── migration.ts         # Legacy layout detection and migration
│   └── __tests__/           # All file-manager tests
├── planner/
│   ├── index.ts             # Planner tool + /plan command
│   ├── types.ts             # Plan schema, FSM states, validation codes
│   ├── fsm.ts               # Planner FSM (9 states, serialize/deserialize)
│   ├── schema.ts            # Plan/phase/task/envelope creation helpers
│   ├── validator.ts         # Multi-stage plan validation
│   ├── graph.ts             # DAG analysis (topological sort, cycle detection)
│   ├── scoring.ts           # Completeness scoring across 6 dimensions
│   ├── envelope.ts          # Glob validation, scope constraint checks
│   ├── errors.ts            # Standardized error messages
│   ├── persistence.ts       # Plan save/load/list from disk
│   ├── showboat.ts          # Audit log generation
│   ├── ci.ts                # CI validation helpers
│   └── __tests__/           # All planner tests
├── orchestrator/
│   ├── index.ts             # Orchestrator tool + /exec command
│   ├── types.ts             # Workflow schema, FSM states, policy types
│   ├── fsm.ts               # Orchestrator FSM (9 states)
│   ├── ledger.ts            # Step ledger (task execution tracking)
│   ├── budget.ts            # Budget tracker (files, lines limits)
│   ├── policy.ts            # Risk evaluation (auto-allow vs approval)
│   ├── envelope.ts          # Runtime envelope enforcement
│   ├── subagent-gov.ts      # Subagent capability binding and validation
│   ├── persistence.ts       # Workflow save/load
│   ├── showboat.ts          # Execution audit logging
│   ├── ci.ts                # CI validation and reporting
│   └── __tests__/           # All orchestrator tests
├── agents/                  # Agent definitions
│   ├── scout.md             # Fast recon, returns compressed context
│   ├── planner.md           # Creates implementation plans
│   ├── reviewer.md          # Code review
│   └── worker.md            # General-purpose (full capabilities)
└── prompts/                 # Workflow presets (prompt templates)
    ├── implement.md         # scout -> planner -> worker
    ├── scout-and-plan.md    # scout -> planner (no implementation)
    └── implement-and-review.md  # worker -> reviewer -> worker
```

---

## Subagent Tool

Delegate tasks to specialized agents with isolated context windows. Each subagent runs in a separate `pi` process.

### Tool Modes

| Mode | Parameter | Description |
|------|-----------|-------------|
| Single | `{ agent, task }` | One agent, one task |
| Parallel | `{ tasks: [...] }` | Multiple agents run concurrently (max 8, 4 concurrent) |
| Chain | `{ chain: [...] }` | Sequential with `{previous}` placeholder |

### Usage

```
Use scout to find all authentication code
Run 2 scouts in parallel: one to find models, one to find providers
Use a chain: first have scout find the read tool, then have planner suggest improvements
/implement add Redis caching to the session store
/scout-and-plan refactor auth to support OAuth
/implement-and-review add input validation to API endpoints
```

### Agent Definitions

Agents are markdown files with YAML frontmatter in `~/.pi/agent/agents/` (user-level) or `.pi/agents/` (project-level).

| Agent | Purpose | Model | Tools |
|-------|---------|-------|-------|
| `scout` | Fast codebase recon | `claude-haiku-4-5` | read, grep, find, ls, bash |
| `planner` | Implementation plans | `claude-opus-4.6` | read, grep, find, ls |
| `reviewer` | Code review | `claude-opus-4.6` | read, grep, find, ls, bash |
| `worker` | General-purpose | `claude-sonnet-4-5` | (all default) |

### Security

Project-local agents (`.pi/agents/`) require confirmation before running. Only user-level agents (`~/.pi/agent/agents/`) are loaded by default.

---

## File Manager

Structured content management with directory initialization, safe read/write, immutable archiving, metadata, templates, and diagnostics.

### Commands (`/files`)

| Command | Description |
|---------|-------------|
| `/files init` | Create directory structure (idempotent) |
| `/files create [--template NAME]` | Create content from template |
| `/files view` | Display active content |
| `/files list` | List archives |
| `/files archive` | Archive active content |
| `/files restore <filename>` | Restore archive to active |
| `/files debug` | Capture diagnostic snapshot |
| `/files config [key] [value]` | Get/set configuration |
| `/files status` | Show phase, active content, archive count |

### Tool Actions (`files`)

| Action | Description |
|--------|-------------|
| `init` | Initialize directory structure |
| `read` | Read active content or specific archive |
| `write` | Safe write (fails if content exists) |
| `force_write` | Unconditional write |
| `archive` | Archive and reset |
| `list` | List archives |
| `restore` | Restore archive |
| `status` | Get current phase |
| `config_get` / `config_set` | Configuration |
| `meta_get` / `meta_set` | Metadata |
| `template_apply` / `template_list` | Templates |
| `snapshot` | Diagnostic snapshot |

### Phases

```
uninitialized -> initialized -> active -> archived
```

State computed from filesystem, never stored separately.

---

## Planner

TDD-oriented plan creation with structured validation and execution envelopes. See [docs/planner.md](../docs/planner.md) for full details.

### Commands (`/plan`)

| Command | Description |
|---------|-------------|
| `/plan status` | Show current planner state |
| `/plan list` | List saved plans |
| `/plan view [planId]` | View a specific plan |
| `/plan showboat [planId]` | View audit log |
| `/plan resume` | Resume interrupted session |
| `/plan abort` | Abort current session |
| `/plan reset` | Reset to idle |
| `/plan ci-check` | Validate plan from disk (CI mode) |

### Tool Actions (`planner`)

| Action | Description |
|--------|-------------|
| `analyze_repo` | Scan repository structure |
| `draft_plan` | Begin drafting a plan |
| `add_phase` | Add a TDD phase (red/green/verify/refactor) |
| `add_task` | Add a task to a phase |
| `set_envelope` | Set execution envelope constraints |
| `add_criterion` | Add a success criterion |
| `add_verification` | Add a verification step |
| `validate` | Run validation (36 checks across 6 dimensions) |
| `submit` | Submit for approval |
| `status` | Get current state |

### FSM Lifecycle

```
idle → analyzing → drafting → validating → awaiting_approval → planned
```

Terminal: `planned`, `blocked`, `failed`, `aborted` | Resumable: `analyzing`, `drafting`, `validating`, `awaiting_approval`

---

## Orchestrator

Plan execution engine with budget tracking, step ledger, policy-driven approval, and subagent governance. See [docs/orchestrator.md](../docs/orchestrator.md) for full details.

### Commands (`/exec`)

| Command | Description |
|---------|-------------|
| `/exec status` | Show current workflow state |
| `/exec load <planId>` | Load a plan for execution |
| `/exec resume` | Resume interrupted workflow |
| `/exec abort` | Abort current workflow |
| `/exec reset` | Reset to idle |

### Tool Actions (`orchestrator`)

| Action | Description |
|--------|-------------|
| `load_plan` | Load an approved plan by ID |
| `start` | Begin execution |
| `execute_step` | Execute next pending task |
| `report_result` | Report step outcome |
| `request_approval` | Request approval for risky action |
| `skip_step` | Skip a task |
| `retry_step` | Retry a failed task |
| `fail_step` | Mark task as permanently failed |
| `verify` | Run post-execution verification |
| `abort` | Abort workflow |
| `status` | Get current state |

### FSM Lifecycle

```
idle → loading_plan → executing → verifying → completed
```

Terminal: `completed`, `failed`, `blocked`, `aborted` | Resumable: `loading_plan`, `executing`, `awaiting_approval`, `verifying`

### Key Safety Features

- **Step Ledger** — tracks every task execution with files modified, lines changed, timestamps, and retry counts
- **Budget Tracker** — enforces change limits (files modified, files created, lines changed) with 80% warning threshold
- **Policy Engine** — auto-allows safe actions (read-only, tests, linter); requires approval for risky ones (deletes, renames, bulk edits, high-impact files, scope expansion)
- **Subagent Governance** — maps planner capabilities to runtime classes, constrains path scope and step budgets
