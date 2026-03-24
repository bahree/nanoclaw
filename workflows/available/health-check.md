---
name: health-check
description: Daily system health check for NanoClaw
schedule: "0 */6 * * *"
context_mode: isolated
---

# System Health Check

Run a health check on the NanoClaw system. Check:

1. **Groups** - verify all registered groups are still accessible
2. **Scheduled tasks** - list any failed task runs in the last 24 hours
3. **Container stats** - note any unusual patterns (repeated failures, long-running containers)

Reporting rules:
- Only send a message if something needs attention
- If everything is healthy, wrap the output in <internal> tags (suppresses the message)
- If issues are found, send a brief alert with the problem and suggested fix
