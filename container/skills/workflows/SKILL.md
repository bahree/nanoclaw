# Workflows

Pre-built workflow templates that can be enabled as scheduled tasks.

## Workflow directory

Templates are mounted at `/workspace/workflows/`. Each is a markdown file with YAML frontmatter:

```yaml
---
name: morning-briefing
description: Daily briefing with weather, news, and priorities
schedule: "0 7 * * *"
context_mode: isolated
---
```

The body contains the full instructions for the agent when the task runs.

## Commands

When the user asks about workflows, use these patterns:

### List available workflows

Read `/workspace/workflows/` and display each workflow's name, description, and default schedule from the frontmatter.

### Enable a workflow

1. Read the workflow file from `/workspace/workflows/{name}.md`
2. Parse the frontmatter for `schedule` and `context_mode`
3. Use the full markdown body (below the frontmatter) as the task prompt
4. Call `mcp__nanoclaw__schedule_task` with:
   - `prompt`: the workflow body
   - `schedule_type`: "cron"
   - `schedule_value`: the `schedule` from frontmatter (user can override)
   - `context_mode`: from frontmatter
   - `workflow_id`: the filename without `.md`
5. Confirm to the user what was enabled and when it will run

If the user specifies a custom schedule (e.g., "enable morning-briefing at 6:30am"), translate to cron and use that instead of the default.

### Disable a workflow

1. Call `mcp__nanoclaw__list_tasks` to find tasks with a matching workflow_id
2. Call `mcp__nanoclaw__cancel_task` for each matching task
3. Confirm to the user

### Show workflow status

1. Call `mcp__nanoclaw__list_tasks`
2. Match tasks that have workflow_id values
3. Cross-reference with available templates in `/workspace/workflows/`
4. Show: which workflows are enabled, their schedule, next run time

## Natural language

Users may not say "enable workflow". Watch for:
- "Set up a morning briefing" - check workflows for a match
- "I want daily news" - match to news-digest workflow
- "Stop the email check" - disable check-email workflow
- "What workflows are available?" - list all

Always check `/workspace/workflows/` for a matching template before creating a bespoke scheduled task. Templates are tested and well-structured.

## Important

- Always confirm with the user before enabling a workflow
- Show the default schedule and ask if they want to customize it
- Workflows are per-group: enabling in one group doesn't affect others
- The workflow_id field links the task to its template for easy management
