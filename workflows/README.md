# Workflows

Pre-built workflow templates for NanoClaw. Each template is a markdown file with YAML frontmatter that the agent can enable as a scheduled task.

## Format

```markdown
---
name: workflow-name
description: One-line description
schedule: "0 7 * * *"
context_mode: isolated
---

# Workflow Title

Instructions for the agent...
```

## Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier (matches filename without .md) |
| `description` | Yes | One-line description shown when listing workflows |
| `schedule` | Yes | Default cron expression (user can override when enabling) |
| `context_mode` | Yes | `isolated` (no chat history) or `group` (with chat history) |

## Adding a workflow

Create a new `.md` file in `workflows/available/`. The agent will pick it up automatically on the next container spawn.

## How it works

1. Templates are mounted read-only into agent containers at `/workspace/workflows/`
2. The agent reads templates and uses `schedule_task` to create scheduled tasks
3. Tasks are linked back to their template via `workflow_id`
4. Users enable/disable via chat: `@Claw enable morning-briefing`
