# Architecture

## System Composition

The extension entry point (`subagent/index.ts`) registers four subsystems into the Pi Coding Agent runtime:

```typescript
export default function (pi: ExtensionAPI) {
    registerSubagentTool(pi);   // subagent/subagent.ts
    registerFileManager(pi);     // file-manager/index.ts
    registerPlanner(pi);         // planner/index.ts
    registerOrchestrator(pi);    // orchestrator/index.ts
}
```

Each subsystem registers its own tool (LLM-callable) and commands (user-facing slash commands).

## Data Flow

```
                    ┌─────────────────────────────────┐
                    │       Pi Coding Agent Runtime     │
                    │  (registerTool, registerCommand)  │
                    └──────────┬──────────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
    ┌─────▼─────┐       ┌─────▼─────┐       ┌─────▼─────┐
    │  Subagent  │       │  Planner  │       │Orchestrator│
    │   Tool     │       │           │       │            │
    └─────┬──────┘       └─────┬─────┘       └──────┬─────┘
          │                    │                    │
          │   spawns           │   creates          │   executes
          │   agents           │   plans            │   plans
          ▼                    ▼                    ▼
    ┌──────────┐        ┌──────────┐        ┌──────────┐
    │  scout   │        │  Plan    │        │ Workflow  │
    │  planner │        │  JSON    │        │  State    │
    │  worker  │        │  on disk │        │  on disk  │
    │  reviewer│        └──────────┘        └──────────┘
    └──────────┘
                         ┌──────────┐
                         │   File   │
                         │ Manager  │
                         └──────────┘
                         (independent lifecycle)
```

The typical end-to-end workflow:
1. **Subagent** spawns a scout to gather codebase context
2. **Planner** creates a validated TDD plan with an execution envelope
3. **Orchestrator** loads the approved plan and executes it step-by-step
4. **Subagent** spawns workers/reviewers for individual tasks during execution
5. **File Manager** handles structured content I/O throughout

Each subsystem can also be used independently.

## Persistence Model

All state is persisted as JSON files under `.pi/`:

| Subsystem | Root Directory | Key Files |
|-----------|---------------|-----------|
| File Manager | `.pi/file-manager/` | `config/settings.json`, `active/current.md`, `archives/`, `metadata/meta.json`, `templates/` |
| Planner | `.pi/planner/` | `plans/<planId>/plan.json`, `plans/<planId>/state.json`, `config/settings.json` |
| Orchestrator | `.pi/orchestrator/` | `workflows/<workflowId>/workflow.json` |

Session state (active plan ID, active workflow ID) is tracked via `active-plan.json` and `active-workflow.json` marker files, enabling resume across sessions.

## FSM Pattern

Both the Planner and Orchestrator use the same finite-state-machine pattern:

- A `TRANSITIONS` map defines legal state transitions
- `TERMINAL_STATES` — states that represent completed runs
- `RESUMABLE_STATES` — states from which a run can be resumed after restart
- `serialize()` / `deserialize()` — checkpoint and restore FSM state
- `transition(to, action)` — validated state change with history tracking
- `canTransition(to)` — pre-check without side effects

This pattern ensures:
- Invalid state transitions are rejected
- Complete audit trail via transition history
- Crash recovery by deserializing from persisted state

### Planner FSM

```
idle → analyzing → drafting → validating → awaiting_approval → planned
                     ↺ self        ↓                ↓
                              → drafting        → blocked → drafting | idle
failed → idle | analyzing
aborted → idle
```

Terminal: `planned`, `blocked`, `failed`, `aborted`
Resumable: `analyzing`, `drafting`, `validating`, `awaiting_approval`

### Orchestrator FSM

```
idle → loading_plan → executing → verifying → completed
                        ↺ self  ↗     ↓
                   ← awaiting_approval
                        ↓
                   blocked | failed
failed → idle | loading_plan
aborted → idle
```

Terminal: `completed`, `failed`, `blocked`, `aborted`
Resumable: `loading_plan`, `executing`, `awaiting_approval`, `verifying`

## Security Model

Safety is enforced at multiple layers:

1. **Agent confirmation** — project-local agents (`.pi/agents/`) require user confirmation before running. User-level agents (`~/.pi/agent/agents/`) run without confirmation.

2. **Execution envelopes** — each plan declares path scope, allowed operations, allowed tools, subagent permissions, and change budgets. The orchestrator enforces these constraints at runtime.

3. **Policy engine** — evaluates each action against risk triggers (delete, rename, bulk edit, high-impact file, scope expansion, budget threshold). Risky actions require approval; safe actions (read-only, test execution, linter) are auto-allowed.

4. **Subagent governance** — maps planner capability levels to runtime capability classes. Constrains each subagent's path scope, available tools, and step budget. Read-only agents cannot mutate files; execution agents can run commands but not write.

5. **Budget tracking** — monitors files modified, files created, and lines changed against plan envelope limits. Triggers approval warnings at 80% threshold.
