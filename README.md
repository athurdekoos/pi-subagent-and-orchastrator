# Pi Tools

Workflow orchestration extension for [Pi Coding Agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent). Adds subagent delegation, structured file management, TDD plan creation, and plan execution with safety controls.

## Quick Start

```bash
cd subagent
npm install
npm test        # 683 tests across 30 files
```

## Mental Model

Pi Tools registers four subsystems into the Pi runtime. Each is an independent tool that can be used alone or composed via workflow presets:

```
User Intent
    │
    ▼
┌──────────────┐   Delegates to scout / planner / worker / reviewer
│ Subagent Tool│
└──────┬───────┘
       │
       ▼
┌──────────────┐   Creates validated TDD plans with execution envelopes
│   Planner    │
└──────┬───────┘
       │
       ▼
┌──────────────┐   Executes plans with budget tracking + policy approval
│ Orchestrator │
└──────┬───────┘
       │
       ▼
┌──────────────┐   Structured content I/O with archiving + metadata
│ File Manager │
└──────────────┘
```

**Subagent** spawns specialized agents (scout, planner, worker, reviewer) in isolated processes. Supports single, parallel, and chain modes.

**Planner** creates TDD-oriented implementation plans with execution envelopes that constrain what changes are allowed. Plans go through validation (36 checks across 6 dimensions) and require user approval.

**Orchestrator** executes approved plans step-by-step. Tracks a step ledger, enforces change budgets, evaluates policy (auto-allow safe actions, require approval for risky ones), and governs subagent capabilities at runtime.

**File Manager** provides structured content management with safe path resolution, immutable archiving, metadata, templates, and diagnostics.

## Agents

| Agent | Model | Purpose | Tools |
|-------|-------|---------|-------|
| `scout` | `claude-haiku-4-5` | Fast codebase reconnaissance | read, grep, find, ls, bash |
| `planner` | `claude-opus-4.6` | Implementation planning | read, grep, find, ls |
| `reviewer` | `claude-opus-4.6` | Code review | read, grep, find, ls, bash |
| `worker` | `claude-sonnet-4-5` | General-purpose implementation | all default tools |

## Workflow Presets

| Command | Pipeline | Description |
|---------|----------|-------------|
| `/implement <task>` | scout → planner → worker | Full implementation workflow |
| `/scout-and-plan <task>` | scout → planner | Analysis and planning only |
| `/implement-and-review <task>` | worker → reviewer → worker | Implement, review, apply feedback |

## Project Layout

```
pi-subagent/
├── subagent/                    # All source code
│   ├── index.ts                 # Extension entry point
│   ├── subagent/                # Agent delegation (single, parallel, chain)
│   ├── file-manager/            # Content management with archiving
│   │   └── __tests__/
│   ├── planner/                 # TDD plan creation + validation
│   │   └── __tests__/
│   ├── orchestrator/            # Plan execution engine
│   │   └── __tests__/
│   ├── agents/                  # Agent definitions (markdown + YAML)
│   ├── prompts/                 # Workflow preset templates
│   └── __mocks__/               # Test mocks for external deps
├── docs/                        # Documentation
└── .pi/extensions/pi-tools      # Symlink → subagent/ (Pi discovery)
```

## Documentation

- [Technical Reference](subagent/README.md) — full tool/command API for all 4 subsystems
- [Architecture](docs/architecture.md) — system design, data flow, persistence model
- [Planner](docs/planner.md) — TDD plan creation, validation, execution envelopes
- [Orchestrator](docs/orchestrator.md) — execution engine, budget tracking, policy engine
- [Agents](docs/agents.md) — agent definitions, workflow presets, custom agents
- [Developer Guide](docs/developer-guide.md) — setup, testing, conventions
- [Extension Compatibility](docs/extension-compatibility.md) — Pi extension system integration
