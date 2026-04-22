---
name: qmd
description: Search past conversations and documentation. Use when users ask about things mentioned before, past discussions, or need context from history.
allowed-tools: Bash(npx qmd:*), Grep, Glob, Read
---

# QMD - Conversation Search

Search past conversations and documentation **scoped to this group only**.

Each group has its own isolated QMD collection. Your collection name is in the
environment variable `NANOCLAW_GROUP_FOLDER`. Always pass it as the collection
filter — never search across groups.

## MCP Tools (Preferred)

QMD MCP server runs on the host at `http://host.docker.internal:8182/mcp`.

Available tools:
- `mcp__qmd__query` - Search with lex/vec/hyde queries
- `mcp__qmd__get` - Retrieve document by path or docid
- `mcp__qmd__multi_get` - Batch retrieve by glob pattern
- `mcp__qmd__status` - Check index health

Before searching, resolve your collection name:
```bash
echo $NANOCLAW_GROUP_FOLDER   # e.g. whatsapp_main
```

Then pass it as the collection filter in every query:
```json
{
  "searches": [
    { "type": "lex", "query": "search term" },
    { "type": "vec", "query": "natural language question" }
  ],
  "collections": ["<value of NANOCLAW_GROUP_FOLDER>"],
  "limit": 10
}
```

## CLI Fallback

If MCP tools are unavailable, use the QMD CLI directly:

```bash
COLLECTION=$NANOCLAW_GROUP_FOLDER

# Keyword search (fast, no models needed)
npx qmd search "search term" -c "$COLLECTION"

# Semantic search
npx qmd vsearch "natural language question" -c "$COLLECTION"

# Hybrid search with reranking (best quality)
npx qmd query "question" -c "$COLLECTION"
```

## If Collection Doesn't Exist Yet

New groups are indexed automatically by a background sync job. If the collection
isn't available yet (group has no archived conversations), fall back to direct
file search:

```bash
# Find conversations containing a term
grep -r "term" /workspace/group/conversations/

# List recent conversations
ls -lt /workspace/group/conversations/ | head -10
```

## Conversation Files Location

- Conversations: `/workspace/group/conversations/*.md`
- Documentation: `/workspace/group/docs/*.md`
- Group memory: `/workspace/group/CLAUDE.md`

## When to Use

- User asks "what did we discuss about X"
- User mentions something from a past conversation
- Need context from previous sessions
- Looking up decisions or preferences mentioned before
