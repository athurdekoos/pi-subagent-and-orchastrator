# Planner

The planner creates validated, TDD-oriented implementation plans with execution envelopes that constrain what changes the plan is allowed to make.

## Tool and Commands

- **Tool**: `planner` (LLM-callable)
- **Command**: `/plan` (user-facing)

## FSM Lifecycle

The planner uses a finite-state machine with 9 states:

```
idle → analyzing → drafting → validating → awaiting_approval → planned
                     ↺ self        ↓                ↓
                              → drafting        → blocked → drafting | idle
failed → idle | analyzing
aborted → idle
```

| State | Description |
|-------|-------------|
| `idle` | No active plan session |
| `analyzing` | Scanning the repository |
| `drafting` | Building the plan document |
| `validating` | Running validation checks |
| `awaiting_approval` | Plan validated, waiting for user approval |
| `planned` | Plan approved and ready for execution |
| `blocked` | Approval denied, can return to drafting |
| `failed` | Unrecoverable error during planning |
| `aborted` | User aborted the planning session |

**Terminal states**: `planned`, `blocked`, `failed`, `aborted`
**Resumable states**: `analyzing`, `drafting`, `validating`, `awaiting_approval`

## Tool Actions

| Action | Description | Expected State |
|--------|-------------|----------------|
| `analyze_repo` | Scan repository structure and patterns | idle → analyzing |
| `draft_plan` | Begin drafting a new plan | analyzing → drafting |
| `add_phase` | Add a TDD phase to the plan | drafting |
| `add_task` | Add a task to a phase | drafting |
| `set_envelope` | Set execution envelope constraints | drafting |
| `add_criterion` | Add a success criterion | drafting |
| `add_verification` | Add a verification step | drafting |
| `validate` | Run validation on the plan | drafting → validating |
| `submit` | Submit for approval | validating → awaiting_approval |
| `status` | Get current planner state | any |

## `/plan` Commands

| Command | Description |
|---------|-------------|
| `/plan status` | Show current planner state |
| `/plan list` | List saved plans |
| `/plan view [planId]` | View a specific plan |
| `/plan showboat [planId]` | View the Showboat audit log |
| `/plan resume` | Resume an interrupted session |
| `/plan abort` | Abort the current session |
| `/plan reset` | Reset to idle state |
| `/plan ci-check` | Validate plan from disk (CI mode) |

## Plan Schema

A plan document (`Plan` interface in `planner/types.ts`) contains:

| Field | Type | Description |
|-------|------|-------------|
| `version` | string | Schema version (semver) |
| `id` | string | Unique plan identifier |
| `intent` | string | Original user intent |
| `goal` | string | High-level goal |
| `summary` | string | Human-readable summary |
| `phases` | PlanPhase[] | Ordered list of TDD phases |
| `tasks` | PlanTask[] | All tasks across all phases |
| `envelope` | ExecutionEnvelope | Sandbox constraints |
| `successCriteria` | SuccessCriterion[] | Measurable success criteria |
| `verificationSteps` | VerificationStep[] | Post-execution verification |
| `highImpact` | boolean | Whether flagged as high-impact |
| `validationResult` | ValidationResult | Most recent validation result |

## TDD Phases

Plans are structured around TDD phase types:

| Phase Type | Purpose | Ordering Constraint |
|------------|---------|-------------------|
| `red` | Write failing tests | Must appear before `green` |
| `green` | Make tests pass | Must appear after `red` |
| `verify` | Verify correctness | Must appear after `green` |
| `refactor` | Clean up implementation | Optional, after `green` |

Validation enforces: at least one `red` phase, at least one `green` phase, at least one `verify` phase, and correct ordering.

## Execution Envelope

Every plan declares an `ExecutionEnvelope` that constrains what the plan can do at runtime:

```typescript
interface ExecutionEnvelope {
    pathScope: string[];           // Glob patterns defining writable paths
    allowedOperations: string[];   // "read" | "write" | "create" | "delete"
    allowedTools: string[];        // Tool names the plan may invoke
    subagentPermissions: {
        maxConcurrent: number;             // Max simultaneous subagents
        allowedCapabilities: string[];     // "read-only" | "execution" | "mutation"
        scopeConstraints: string[];        // Glob patterns for subagent scope
    };
    changeBudget: {
        maxFilesModified: number;   // Max existing files to modify
        maxFilesCreated: number;    // Max new files to create
        maxLinesChanged: number;    // Max total lines changed
    };
}
```

## Validation

Validation checks 36 error codes across 6 dimensions:

| Dimension | What It Checks |
|-----------|---------------|
| Structural completeness | Required fields, non-empty phases/tasks, valid timestamps |
| Phase ordering | Red before green, verify after green, valid phase types |
| Dependency integrity | No cycles, no self-deps, no cross-phase backward deps, all refs exist |
| Envelope constraints | Valid globs, non-empty scopes, bounded budgets, no negative values |
| Verification coverage | Tasks have verification steps, criteria are measurable |
| Subagent policy | Valid capabilities, scope within envelope, justified mutation grants |

Issues are classified as `error` (blocks approval) or `warning` (informational). A `PlanCompletenessScore` (0-100) is computed from per-dimension scores.

## Configuration

Defaults from `planner/types.ts`:

| Setting | Default | Description |
|---------|---------|-------------|
| `rootDir` | `.pi/planner` | Persistence root |
| `maxFilesModifiedLimit` | 500 | Upper bound for change budget |
| `maxFilesCreatedLimit` | 200 | Upper bound for change budget |
| `maxLinesChangedLimit` | 50000 | Upper bound for change budget |
| `maxConcurrentLimit` | 8 | Max concurrent subagents |
| `requireApproval` | true | Whether plans need user approval |

## Persistence

Plans are stored at `.pi/planner/plans/<planId>/`:
- `plan.json` — the plan document
- `state.json` — serialized planner session (FSM + plan reference)

Active session tracked via `.pi/planner/active-plan.json`.

## Showboat Integration

The planner generates markdown-based audit logs (Showboat documents) recording state transitions, validation results, and approval decisions.
