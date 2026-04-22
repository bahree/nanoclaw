---
name: check-email
description: Process and summarize unread emails
schedule: "0 9,14 * * 1-5"
context_mode: isolated
---

# Email Check

Check for unread emails and provide a prioritized summary. Requires Gmail access.

1. **Read unread emails** from the inbox
2. **Categorize** into: urgent/action-needed, informational, newsletters/promotions
3. **Summarize** each email in one line: sender, subject, what's needed
4. **Flag** anything that needs a reply or action today

Presentation:
- Lead with urgent items
- Group newsletters and promotions into a single "also received" line
- If nothing urgent, say so clearly: "Inbox is clean - nothing needs attention"
- Don't read emails that are clearly automated (shipping updates, receipts) unless they seem important
