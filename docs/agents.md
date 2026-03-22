# Agents and Workflow Presets

## Agent Definition Format

Agents are defined as markdown files with YAML frontmatter:

```markdown
---
name: agent-name
description: What the agent does
tools: comma, separated, tool, list
model: claude-model-id
---

System prompt for the agent goes here.
```

Agent definitions live in `subagent/agents/`.

## Agent Roster

### scout

- **Model**: `claude-haiku-4-5`
- **Tools**: read, grep, find, ls, bash
- **Purpose**: Fast codebase reconnaissance. Quickly investigates a codebase and returns structured findings for handoff to other agents.
- **Restrictions**: Read-only operations. Does not modify files.
- **Output format**: Files Retrieved, Key Code, Architecture, Start Here

### planner

- **Model**: `claude-opus-4.6`
- **Tools**: read, grep, find, ls
- **Purpose**: Creates implementation plans from scout context and requirements. Produces clear, actionable plans.
- **Restrictions**: Must not make any changes. Read, analyze, and plan only.
- **Output format**: Goal, Plan, Files to Modify, Risks

### reviewer

- **Model**: `claude-opus-4.6`
- **Tools**: read, grep, find, ls, bash
- **Purpose**: Code review specialist. Analyzes code for quality, security, and maintainability.
- **Restrictions**: Bash is for read-only git commands only (`git diff`, `git log`, `git show`). Does not modify files.
- **Output format**: Files Reviewed, Critical/Warnings/Suggestions, Summary

### worker

- **Model**: `claude-sonnet-4-5`
- **Tools**: all default tools
- **Purpose**: General-purpose subagent with full capabilities. Operates in an isolated context window to handle delegated tasks.
- **Restrictions**: None — full read/write/execute capabilities.
- **Output format**: Completed, Files Changed, Notes

## Agent Discovery

Agent discovery is handled by `subagent/agents.ts`. Agents are loaded from two locations:

1. **User-level** (`~/.pi/agent/agents/`) — loaded by default, no confirmation required
2. **Project-level** (`.pi/agents/`) — requires user confirmation before running

User-level agents take precedence if names conflict.

## Workflow Presets

Workflow presets are prompt templates in `subagent/prompts/` that chain agents together using the subagent tool's chain mode with `{previous}` placeholder for context handoff.

### `/implement <task>`

Full implementation workflow:
1. **scout** gathers all code relevant to the task
2. **planner** creates an implementation plan using scout's context
3. **worker** implements the plan

### `/scout-and-plan <task>`

Analysis and planning only (no implementation):
1. **scout** gathers all code relevant to the task
2. **planner** creates an implementation plan using scout's context

### `/implement-and-review <task>`

Implementation with code review feedback loop:
1. **worker** implements the task
2. **reviewer** reviews the implementation
3. **worker** applies feedback from the review

## Creating Custom Agents

To create a custom agent, add a markdown file to `subagent/agents/` (or `~/.pi/agent/agents/` for user-level):

```markdown
---
name: my-agent
description: What this agent specializes in
tools: read, grep, find, ls
model: claude-sonnet-4-5
---

Your system prompt here. Be specific about:
- What the agent should do
- What it should NOT do
- Expected output format
```

Available fields in frontmatter:
- `name` (required) — unique identifier
- `description` (required) — one-line purpose description
- `tools` (optional) — comma-separated tool names; omit for all defaults
- `model` (optional) — Claude model ID; defaults to the runtime default
