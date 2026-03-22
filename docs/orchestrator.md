# Orchestrator

The orchestrator executes validated plans step-by-step with budget tracking, a step ledger, policy-driven approval, and subagent governance.

## Tool and Commands

- **Tool**: `orchestrator` (LLM-callable)
- **Command**: `/exec` (user-facing)

## FSM Lifecycle

The orchestrator uses a finite-state machine with 9 states:

```
idle → loading_plan → executing → verifying → completed
                        ↺ self  ↗     ↓
                   ← awaiting_approval
                        ↓
                   blocked | failed
failed → idle | loading_plan
aborted → idle
```

| State | Description |
|-------|-------------|
| `idle` | No active workflow |
| `loading_plan` | Loading and validating a plan from disk |
| `executing` | Running plan tasks step-by-step |
| `awaiting_approval` | Blocked on user approval for a risky action |
| `verifying` | Running post-execution verification |
| `completed` | All tasks and verification complete |
| `failed` | Unrecoverable error during execution |
| `blocked` | Approval denied or policy violation |
| `aborted` | User aborted the workflow |

**Terminal states**: `completed`, `failed`, `blocked`, `aborted`
**Resumable states**: `loading_plan`, `executing`, `awaiting_approval`, `verifying`

## Tool Actions

| Action | Description |
|--------|-------------|
| `load_plan` | Load an approved plan by ID |
| `start` | Begin execution of the loaded plan |
| `execute_step` | Execute the next pending task |
| `report_result` | Report outcome of a completed step |
| `request_approval` | Request user approval for a risky action |
| `skip_step` | Skip a task |
| `retry_step` | Retry a failed task |
| `fail_step` | Mark a task as permanently failed |
| `verify` | Run post-execution verification |
| `abort` | Abort the workflow |
| `status` | Get current orchestrator state |

## `/exec` Commands

| Command | Description |
|---------|-------------|
| `/exec status` | Show current workflow state |
| `/exec load <planId>` | Load a plan for execution |
| `/exec resume` | Resume an interrupted workflow |
| `/exec abort` | Abort the current workflow |
| `/exec reset` | Reset to idle state |

## Step Ledger

The `StepLedger` tracks execution of each task as a `LedgerEntry`:

| Field | Type | Description |
|-------|------|-------------|
| `stepId` | string | Unique step identifier |
| `taskId` | string | Plan task this step executes |
| `phaseRef` | string | Phase the task belongs to |
| `phaseType` | PhaseType | red / green / verify / refactor |
| `status` | StepStatus | pending / in_progress / committed / failed / skipped |
| `filesModified` | string[] | Files modified during this step |
| `filesCreated` | string[] | Files created during this step |
| `linesChanged` | number | Total lines changed |
| `retryCount` | number | Times this step has been retried |
| `error` | string \| null | Error message if failed |
| `auditNote` | string | Note written to Showboat |

**Invariants**:
- Only one step may be `in_progress` at a time
- On deserialization, any `in_progress` entries are reset to `pending` (crash recovery)

## Budget Tracker

The `BudgetTracker` monitors three dimensions against the plan's change budget:

| Dimension | Tracking | Source |
|-----------|----------|--------|
| Files modified | Set (deduped by path) | `envelope.changeBudget.maxFilesModified` |
| Files created | Count | `envelope.changeBudget.maxFilesCreated` |
| Lines changed | Running total | `envelope.changeBudget.maxLinesChanged` |

- `isExceeded()` — returns true if any dimension exceeds its limit
- `isNearThreshold(fraction)` — returns true if any dimension exceeds the warning threshold (default 80%)
- `getUsage()` — returns current usage snapshot for reporting

## Policy Engine

The policy engine (`orchestrator/policy.ts`) evaluates each action to determine whether it's auto-allowed or requires user approval.

### Auto-Allow Conditions

These conditions bypass risk evaluation — if any is true, the action is auto-allowed:

| Condition | Description |
|-----------|-------------|
| `isReadOnly` | Read-only operation |
| `isTestExecution` | Running tests |
| `isLinterExecution` | Running linter/typecheck |
| `isShowboatGeneration` | Generating audit logs |
| `isTestFileWriteInRedPhase` | Writing test files during red phase |
| `isInScopeMutation` (no triggers) | Non-destructive mutation within plan scope with no risk triggers |

### Risk Triggers

If no auto-allow condition matches, these flags trigger an approval requirement:

| Trigger | Approval Scope |
|---------|---------------|
| Delete operation | `action` (per-action approval) |
| Rename/move operation | `action` |
| Bulk edit exceeds threshold | `phase` |
| Edit after green phase | `phase` |
| Scope expansion beyond envelope | `phase` |
| High-impact file modification | `phase` |
| First write outside plan scope | `phase` |
| Budget near threshold | `phase` |

If no triggers and no auto-allow conditions match, the action is auto-allowed by default.

## Subagent Governance

The orchestrator maps planner-declared subagent capabilities to runtime capability classes:

| Planner Capability | Runtime Class | Permissions |
|-------------------|---------------|-------------|
| `read-only` | `read-only` | Read files, search, no mutations |
| `execution` | `execution` | Run commands, no file writes |
| `mutation` | `mutation-capable` | Full file read/write/create |

Each subagent binding includes:
- **Path scope** — glob patterns constraining file access
- **Allowed tools** — tools the subagent may invoke
- **Mutation rights** — whether file writes are permitted
- **Step budget** — maximum steps the subagent may take (default 10)

## High-Impact File Patterns

Files matching these patterns always trigger approval:

```
package.json, package-lock.json, yarn.lock, pnpm-lock.yaml,
tsconfig.json, tsconfig.*.json,
.eslintrc*, .prettierrc*,
.github/**, .ci/**,
Dockerfile, docker-compose*,
.env*
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `rootDir` | `.pi/orchestrator` | Persistence root |
| `maxRetriesPerStep` | 3 | Max retries before failure |
| `bulkEditThreshold` | 5 | File count that triggers bulk edit approval |
| `budgetWarningThreshold` | 0.8 | Fraction that triggers near-threshold warning |

## Persistence

Workflows are stored at `.pi/orchestrator/workflows/<workflowId>/workflow.json`.

The `WorkflowState` captures:
- FSM state and transition history
- Step ledger entries
- Per-task retry counters
- Approval records
- Subagent runtime bindings
- Budget usage snapshot
- Showboat document path

Active workflow tracked via `.pi/orchestrator/active-workflow.json`.

## Showboat Integration

The orchestrator streams audit logs recording step execution, approvals, budget usage, and verification results.
