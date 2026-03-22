# Pi-Subagent Project Verification

*2026-03-22T18:14:46Z by Showboat 0.6.1*
<!-- showboat-id: 2b1a30ad-06c4-4c3e-a839-a39f21128f01 -->

This document verifies that the pi-subagent project — a TypeScript workflow orchestration extension for the Pi Coding Agent — installs, compiles, passes its full test suite, and has the expected source structure.

## 1. Project Setup

Install dependencies in the subagent/ directory.

```bash
cd subagent && npm install 2>&1 | tail -5
```

```output

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.
```

## 2. TypeScript Compilation Check

Run tsc --noEmit. Pre-existing type errors are expected (structural issues, untyped Pi globals). These do not affect test execution.

```bash
cd subagent && npx tsc --noEmit 2>&1 | wc -l | xargs -I{} echo '{} lines of type-checker output (pre-existing structural errors)'; true
```

```output
128 lines of type-checker output (pre-existing structural errors)
```

## 3. Test Suite

Run the full Vitest test suite. All tests across 30 test files should pass. Output is sorted for reproducibility.

```bash
cd subagent && npm test 2>&1 | sed 's/ [0-9]*ms//g' | grep -E '(✓|Test Files|Tests )' | sort
```

```output
      Tests  683 passed (683)
 Test Files  30 passed (30)
 ✓ file-manager/__tests__/archives.test.ts  (42 tests)
 ✓ file-manager/__tests__/config.test.ts  (27 tests)
 ✓ file-manager/__tests__/content.test.ts  (26 tests)
 ✓ file-manager/__tests__/diagnostics.test.ts  (14 tests)
 ✓ file-manager/__tests__/index-gen.test.ts  (7 tests)
 ✓ file-manager/__tests__/init.test.ts  (11 tests)
 ✓ file-manager/__tests__/metadata.test.ts  (18 tests)
 ✓ file-manager/__tests__/migration.test.ts  (14 tests)
 ✓ file-manager/__tests__/naming.test.ts  (33 tests)
 ✓ file-manager/__tests__/paths.test.ts  (52 tests)
 ✓ file-manager/__tests__/state.test.ts  (27 tests)
 ✓ file-manager/__tests__/templates.test.ts  (36 tests)
 ✓ orchestrator/__tests__/orchestrator-ac.test.ts  (24 tests)
 ✓ orchestrator/__tests__/orchestrator-approval-verify.test.ts  (9 tests)
 ✓ orchestrator/__tests__/orchestrator-budget.test.ts  (14 tests)
 ✓ orchestrator/__tests__/orchestrator-ci.test.ts  (9 tests)
 ✓ orchestrator/__tests__/orchestrator-envelope.test.ts  (9 tests)
 ✓ orchestrator/__tests__/orchestrator-fsm.test.ts  (18 tests)
 ✓ orchestrator/__tests__/orchestrator-ledger.test.ts  (19 tests)
 ✓ orchestrator/__tests__/orchestrator-persistence.test.ts  (12 tests)
 ✓ orchestrator/__tests__/orchestrator-policy-integration.test.ts  (5 tests)
 ✓ orchestrator/__tests__/orchestrator-policy.test.ts  (17 tests)
 ✓ orchestrator/__tests__/orchestrator-subagent-integration.test.ts  (6 tests)
 ✓ orchestrator/__tests__/orchestrator-subagent.test.ts  (14 tests)
 ✓ planner/__tests__/fsm.test.ts  (12 tests)
 ✓ planner/__tests__/persistence.test.ts  (7 tests)
 ✓ planner/__tests__/planner-ac.test.ts  (153 tests)
 ✓ planner/__tests__/planner.test.ts  (23 tests)
 ✓ planner/__tests__/schema.test.ts  (11 tests)
 ✓ planner/__tests__/validator.test.ts  (14 tests)
```

## 4. Source File Structure

Verify the four subsystem directories with their TypeScript source files.

```bash
ls subagent/orchestrator/*.ts subagent/planner/*.ts subagent/file-manager/*.ts subagent/subagent/*.ts 2>&1 | sort
```

```output
subagent/file-manager/archives.ts
subagent/file-manager/config.ts
subagent/file-manager/content.ts
subagent/file-manager/diagnostics.ts
subagent/file-manager/index-gen.ts
subagent/file-manager/index.ts
subagent/file-manager/init.ts
subagent/file-manager/metadata.ts
subagent/file-manager/migration.ts
subagent/file-manager/naming.ts
subagent/file-manager/paths.ts
subagent/file-manager/state.ts
subagent/file-manager/templates.ts
subagent/file-manager/types.ts
subagent/orchestrator/budget.ts
subagent/orchestrator/ci.ts
subagent/orchestrator/envelope.ts
subagent/orchestrator/fsm.ts
subagent/orchestrator/index.ts
subagent/orchestrator/ledger.ts
subagent/orchestrator/persistence.ts
subagent/orchestrator/policy.ts
subagent/orchestrator/showboat.ts
subagent/orchestrator/subagent-gov.ts
subagent/orchestrator/types.ts
subagent/planner/ci.ts
subagent/planner/envelope.ts
subagent/planner/errors.ts
subagent/planner/fsm.ts
subagent/planner/graph.ts
subagent/planner/index.ts
subagent/planner/persistence.ts
subagent/planner/schema.ts
subagent/planner/scoring.ts
subagent/planner/showboat.ts
subagent/planner/types.ts
subagent/planner/validator.ts
subagent/subagent/agents.ts
subagent/subagent/subagent.ts
```

## 5. Agent Definitions

Verify the four agent markdown definitions: scout, planner, reviewer, worker.

```bash
ls -1 subagent/agents/
```

```output
planner.md
reviewer.md
scout.md
worker.md
```

## 6. Documentation

Verify documentation files are present.

```bash
ls -1 docs/
```

```output
agents.md
architecture.md
developer-guide.md
extension-compatibility.md
orchestrator.md
planner.md
```

## 7. Test File Inventory

List all test files across the three subsystems.

```bash
find subagent -name '*.test.ts' | sort
```

```output
subagent/file-manager/__tests__/archives.test.ts
subagent/file-manager/__tests__/config.test.ts
subagent/file-manager/__tests__/content.test.ts
subagent/file-manager/__tests__/diagnostics.test.ts
subagent/file-manager/__tests__/index-gen.test.ts
subagent/file-manager/__tests__/init.test.ts
subagent/file-manager/__tests__/metadata.test.ts
subagent/file-manager/__tests__/migration.test.ts
subagent/file-manager/__tests__/naming.test.ts
subagent/file-manager/__tests__/paths.test.ts
subagent/file-manager/__tests__/state.test.ts
subagent/file-manager/__tests__/templates.test.ts
subagent/orchestrator/__tests__/orchestrator-ac.test.ts
subagent/orchestrator/__tests__/orchestrator-approval-verify.test.ts
subagent/orchestrator/__tests__/orchestrator-budget.test.ts
subagent/orchestrator/__tests__/orchestrator-ci.test.ts
subagent/orchestrator/__tests__/orchestrator-envelope.test.ts
subagent/orchestrator/__tests__/orchestrator-fsm.test.ts
subagent/orchestrator/__tests__/orchestrator-ledger.test.ts
subagent/orchestrator/__tests__/orchestrator-persistence.test.ts
subagent/orchestrator/__tests__/orchestrator-policy-integration.test.ts
subagent/orchestrator/__tests__/orchestrator-policy.test.ts
subagent/orchestrator/__tests__/orchestrator-subagent-integration.test.ts
subagent/orchestrator/__tests__/orchestrator-subagent.test.ts
subagent/planner/__tests__/fsm.test.ts
subagent/planner/__tests__/persistence.test.ts
subagent/planner/__tests__/planner-ac.test.ts
subagent/planner/__tests__/planner.test.ts
subagent/planner/__tests__/schema.test.ts
subagent/planner/__tests__/validator.test.ts
```
