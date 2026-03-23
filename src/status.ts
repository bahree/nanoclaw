import { ASSISTANT_NAME, TIMEZONE } from './config.js';
import {
  getUsageSummary,
  getUsageByGroup,
  getUsageTimeline,
} from './usage-log.js';
import {
  getAllRegisteredGroups,
  getAllTasks,
  getTaskById,
  updateTask,
  deleteTask,
} from './db.js';
import {
  getLastActions,
  getLastActionWithToolCalls,
  getActionsForEvent,
  buildLogReport,
} from './event-log.js';
import { GroupQueue } from './group-queue.js';
import { getActiveSession } from './remote-control.js';
import { Channel, ScheduledTask } from './types.js';

const startTime = Date.now();

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function formatTimeAgo(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  if (ms < 0) return 'just now';
  return formatDuration(ms) + ' ago';
}

function formatTimeUntil(isoDate: string): string {
  const ms = new Date(isoDate).getTime() - Date.now();
  if (ms < 0) return 'overdue';
  return 'in ' + formatDuration(ms);
}

function formatTaskLine(task: ScheduledTask, index: number): string {
  const status =
    task.status === 'active'
      ? ''
      : task.status === 'paused'
        ? ' [paused]'
        : ' [done]';
  const schedule =
    task.schedule_type === 'cron'
      ? `cron: ${task.schedule_value}`
      : task.schedule_type === 'interval'
        ? `every ${task.schedule_value}`
        : `once`;
  const prompt =
    task.prompt.length > 50 ? task.prompt.slice(0, 50) + '...' : task.prompt;
  const next = task.next_run ? formatTimeUntil(task.next_run) : 'n/a';
  const lastRun = task.last_run ? formatTimeAgo(task.last_run) : 'never';

  return [
    `*${index + 1}.* ${prompt}${status}`,
    `   Schedule: ${schedule}`,
    `   Next: ${next} | Last: ${lastRun}`,
    `   ID: ${task.id}`,
  ].join('\n');
}

export function buildStatus(queue: GroupQueue, channels: Channel[]): string {
  const uptime = formatDuration(Date.now() - startTime);
  const mem = Math.round(process.memoryUsage.rss() / 1024 / 1024);

  // Queue status
  const qs = queue.getStatus();

  // Channels
  const channelNames = channels.map((ch) => ch.name).join(', ');

  // Registered groups
  const groups = getAllRegisteredGroups();
  const groupEntries = Object.entries(groups);

  // Tasks
  const tasks = getAllTasks();
  const activeTasks = tasks.filter((t) => t.status === 'active');
  const pausedTasks = tasks.filter((t) => t.status === 'paused');

  // Remote control
  const rc = getActiveSession();

  // Build output
  const lines: string[] = [
    `*${ASSISTANT_NAME} Status*`,
    `────────────────`,
    `Uptime: ${uptime}`,
    `Memory: ${mem} MB`,
    `Timezone: ${TIMEZONE}`,
    ``,
    `*Containers:* ${qs.activeCount}/${qs.maxConcurrent} active${qs.waitingCount > 0 ? `, ${qs.waitingCount} waiting` : ''}`,
    `*Channels:* ${channelNames || 'none'}`,
  ];

  // Active containers detail
  if (qs.groups.length > 0) {
    lines.push('');
    for (const g of qs.groups) {
      const groupName = groups[g.jid]?.name || g.jid;
      const state = g.active
        ? g.idleWaiting
          ? 'idle'
          : g.isTaskContainer
            ? 'running task'
            : 'processing'
        : 'queued';
      const pending: string[] = [];
      if (g.pendingMessages) pending.push('msgs pending');
      if (g.pendingTaskCount > 0)
        pending.push(`${g.pendingTaskCount} tasks pending`);
      const extra = pending.length > 0 ? ` (${pending.join(', ')})` : '';
      lines.push(`  ${groupName}: ${state}${extra}`);
    }
  }

  // Groups
  lines.push('');
  lines.push(`*Groups (${groupEntries.length}):*`);
  for (const [_jid, group] of groupEntries) {
    const main = group.isMain ? ' [main]' : '';
    lines.push(`  ${group.name}${main}`);
  }

  // Tasks summary
  if (tasks.length > 0) {
    lines.push('');
    lines.push(
      `*Tasks:* ${activeTasks.length} active${pausedTasks.length > 0 ? `, ${pausedTasks.length} paused` : ''}`,
    );
    const nextTask = activeTasks
      .filter((t) => t.next_run)
      .sort((a, b) => (a.next_run! < b.next_run! ? -1 : 1))[0];
    if (nextTask) {
      lines.push(
        `  Next: "${nextTask.prompt.slice(0, 40)}${nextTask.prompt.length > 40 ? '...' : ''}" ${formatTimeUntil(nextTask.next_run!)}`,
      );
    }
    lines.push(`  _Send /status tasks for details_`);
  }

  // Remote control
  if (rc) {
    lines.push('');
    lines.push(
      `*Remote Control:* active since ${formatTimeAgo(rc.startedAt).replace(' ago', '')}`,
    );
  }

  return lines.join('\n');
}

export function buildGroupStatus(
  chatJid: string,
  groupName: string,
  queue: GroupQueue,
): string {
  const qs = queue.getStatus();
  const groupState = qs.groups.find((g) => g.jid === chatJid);

  const lines: string[] = [
    `*${groupName} - Status*`,
    `────────────────`,
  ];

  if (groupState?.active) {
    const state = groupState.idleWaiting
      ? 'idle (waiting for input)'
      : groupState.isTaskContainer
        ? 'running a task'
        : 'processing a query';
    lines.push(`*Container:* ${state}`);
    const pending: string[] = [];
    if (groupState.pendingMessages) pending.push('messages queued');
    if (groupState.pendingTaskCount > 0)
      pending.push(`${groupState.pendingTaskCount} tasks queued`);
    if (pending.length > 0) lines.push(`  ${pending.join(', ')}`);
  } else {
    lines.push(`*Container:* not running`);
  }

  // Tasks for this group
  const allTasks = getAllTasks();
  const groupTasks = allTasks.filter((t) => t.chat_jid === chatJid);
  const activeTasks = groupTasks.filter((t) => t.status === 'active');
  const pausedTasks = groupTasks.filter((t) => t.status === 'paused');

  if (groupTasks.length > 0) {
    lines.push('');
    lines.push(
      `*Tasks:* ${activeTasks.length} active${pausedTasks.length > 0 ? `, ${pausedTasks.length} paused` : ''}`,
    );
    for (const [i, task] of [...activeTasks, ...pausedTasks].entries()) {
      lines.push(formatTaskLine(task, i));
    }
  } else {
    lines.push('', 'No scheduled tasks for this group.');
  }

  return lines.join('\n');
}

export function buildGroupTasksStatus(chatJid: string): string {
  const allTasks = getAllTasks();
  const groupTasks = allTasks.filter((t) => t.chat_jid === chatJid);

  if (groupTasks.length === 0) {
    return 'No scheduled tasks for this group.';
  }

  const active = groupTasks.filter((t) => t.status === 'active');
  const paused = groupTasks.filter((t) => t.status === 'paused');
  const completed = groupTasks.filter((t) => t.status === 'completed');

  const lines: string[] = [
    `*Scheduled Tasks (${groupTasks.length})*`,
    `────────────────`,
  ];

  const ordered = [...active, ...paused, ...completed];
  for (const [i, task] of ordered.entries()) {
    lines.push(formatTaskLine(task, i));
  }

  return lines.join('\n');
}

export function buildTasksStatus(): string {
  const tasks = getAllTasks();

  if (tasks.length === 0) {
    return 'No scheduled tasks.';
  }

  const lines: string[] = [
    `*Scheduled Tasks (${tasks.length})*`,
    `────────────────`,
  ];

  const activeTasks = tasks.filter((t) => t.status === 'active');
  const pausedTasks = tasks.filter((t) => t.status === 'paused');
  const completedTasks = tasks.filter((t) => t.status === 'completed');

  if (activeTasks.length > 0) {
    lines.push('');
    lines.push(`*Active (${activeTasks.length}):*`);
    activeTasks.forEach((t, i) => lines.push(formatTaskLine(t, i)));
  }

  if (pausedTasks.length > 0) {
    lines.push('');
    lines.push(`*Paused (${pausedTasks.length}):*`);
    pausedTasks.forEach((t, i) => lines.push(formatTaskLine(t, i)));
  }

  if (completedTasks.length > 0) {
    lines.push('');
    lines.push(`*Completed (${completedTasks.length}):*`);
    completedTasks.forEach((t, i) => lines.push(formatTaskLine(t, i)));
  }

  lines.push('');
  lines.push('_Commands:_');
  lines.push('/task pause <id>');
  lines.push('/task resume <id>');
  lines.push('/task delete <id>');

  return lines.join('\n');
}

export function handleTaskCommand(
  args: string,
): { ok: true; message: string } | { ok: false; error: string } {
  const parts = args.trim().split(/\s+/);
  const action = parts[0]?.toLowerCase();
  const taskId = parts.slice(1).join(' ');

  if (!action || !taskId) {
    return { ok: false, error: 'Usage: /task <pause|resume|delete> <task-id>' };
  }

  const task = getTaskById(taskId);
  if (!task) {
    return { ok: false, error: `Task not found: ${taskId}` };
  }

  switch (action) {
    case 'pause':
      if (task.status !== 'active') {
        return { ok: false, error: `Task is already ${task.status}` };
      }
      updateTask(taskId, { status: 'paused' });
      return {
        ok: true,
        message: `Paused: "${task.prompt.slice(0, 50)}"`,
      };

    case 'resume':
      if (task.status !== 'paused') {
        return { ok: false, error: `Task is ${task.status}, not paused` };
      }
      updateTask(taskId, { status: 'active' });
      return {
        ok: true,
        message: `Resumed: "${task.prompt.slice(0, 50)}"`,
      };

    case 'delete':
      deleteTask(taskId);
      return {
        ok: true,
        message: `Deleted: "${task.prompt.slice(0, 50)}"`,
      };

    default:
      return {
        ok: false,
        error: `Unknown action: ${action}. Use pause, resume, or delete.`,
      };
  }
}

export function handleDebugCommand(
  args: string,
): { ok: true; message: string } | { ok: false; error: string } {
  const parts = args.trim().split(/\s+/);
  const subcommand = parts[0]?.toLowerCase();

  if (subcommand === 'last') {
    const n = parseInt(parts[1], 10) || 10;
    const results = getLastActions(Math.min(n, 50));
    if (results.length === 0) {
      return { ok: true, message: 'No actions logged yet.' };
    }

    const lines: string[] = [
      `*Last ${results.length} Actions*`,
      `────────────────`,
    ];
    for (const { action, event } of results) {
      const trigger = event
        ? `${event.source}${event.summary ? ': ' + event.summary : ''}`
        : 'unknown';
      const content = action.content
        ? action.content.slice(0, 80) +
          (action.content.length > 80 ? '...' : '')
        : '';
      lines.push(
        `\n*${action.action_type}* → ${action.target || 'n/a'}`,
        `  ${formatTimeAgo(action.timestamp)}`,
        `  Trigger: ${trigger}`,
        content ? `  Content: ${content}` : '',
      );
    }

    return { ok: true, message: lines.filter(Boolean).join('\n') };
  }

  if (subcommand === 'why') {
    const result = getLastActionWithToolCalls();
    if (!result) {
      return { ok: true, message: 'No actions logged yet.' };
    }

    const { action, event, toolCalls } = result;
    const lines: string[] = [`*Most Recent Action*`, `────────────────`];

    if (event) {
      lines.push(
        `*Event:* ${event.source} (${event.source_id || 'n/a'})`,
        `  ${event.summary || 'no summary'}`,
        `  ${formatTimeAgo(event.timestamp)}`,
        `  ID: ${event.id}`,
      );
    }

    lines.push(
      '',
      `*Action:* ${action.action_type}`,
      `  Target: ${action.target || 'n/a'}`,
      `  ${formatTimeAgo(action.timestamp)}`,
    );
    if (action.content) {
      lines.push(`  Content: ${action.content.slice(0, 200)}`);
    }

    if (toolCalls.length > 0) {
      lines.push('', `*Tool Calls (${toolCalls.length}):*`);
      for (const tc of toolCalls) {
        const status = tc.success ? 'ok' : 'FAILED';
        lines.push(`  ${tc.tool_name} (${tc.duration_ms}ms, ${status})`);
      }
    }

    return { ok: true, message: lines.join('\n') };
  }

  if (subcommand === 'event') {
    const eventId = parts.slice(1).join(' ');
    if (!eventId) {
      return { ok: false, error: 'Usage: /debug event <id>' };
    }

    const result = getActionsForEvent(eventId);
    if (!result.event) {
      return { ok: false, error: `Event not found: ${eventId}` };
    }

    const lines: string[] = [`*Event Details*`, `────────────────`];
    lines.push(
      `*Source:* ${result.event.source} (${result.event.source_id || 'n/a'})`,
      `*Summary:* ${result.event.summary || 'none'}`,
      `*Time:* ${formatTimeAgo(result.event.timestamp)}`,
      `*ID:* ${result.event.id}`,
    );

    if (result.actions.length === 0) {
      lines.push('', 'No actions triggered by this event.');
    } else {
      lines.push('', `*Actions (${result.actions.length}):*`);
      for (const { action, toolCalls } of result.actions) {
        lines.push(
          `\n  *${action.action_type}* → ${action.target || 'n/a'}`,
          `    ${formatTimeAgo(action.timestamp)}`,
        );
        if (toolCalls.length > 0) {
          for (const tc of toolCalls) {
            const status = tc.success ? 'ok' : 'FAILED';
            lines.push(
              `    └ ${tc.tool_name} (${tc.duration_ms}ms, ${status})`,
            );
          }
        }
      }
    }

    return { ok: true, message: lines.join('\n') };
  }

  if (subcommand === 'report') {
    const report = buildLogReport();
    const lines: string[] = [
      `*Event Log Report*`,
      `────────────────`,
      `Retention: ${report.retentionDays} days`,
      `Period: ${formatTimeAgo(report.period.from).replace(' ago', '')} → now`,
      '',
      `*Table Sizes:*`,
      `  Events: ${report.tableSizes.events}`,
      `  Actions: ${report.tableSizes.actions}`,
      `  Tool Calls: ${report.tableSizes.toolCalls}`,
    ];

    if (report.eventsBySource.length > 0) {
      lines.push('', `*Events by Source:*`);
      for (const { source, count } of report.eventsBySource) {
        lines.push(`  ${source}: ${count}`);
      }
    }

    if (report.actionsByType.length > 0) {
      lines.push('', `*Actions by Type:*`);
      for (const { action_type, count } of report.actionsByType) {
        lines.push(`  ${action_type}: ${count}`);
      }
    }

    if (report.busiestHours.length > 0) {
      lines.push('', `*Busiest Hours:*`);
      const top5 = report.busiestHours.slice(0, 5);
      for (const { hour, count } of top5) {
        lines.push(`  ${hour}: ${count} events`);
      }
    }

    if (report.failedToolCalls.length > 0) {
      lines.push('', `*Recent Failed Tool Calls:*`);
      for (const tc of report.failedToolCalls) {
        lines.push(
          `  ${tc.tool_name} (${tc.duration_ms}ms) ${formatTimeAgo(tc.timestamp)}`,
          `    ${(tc.output || 'no output').slice(0, 100)}`,
        );
      }
    }

    if (report.recentErrors.length > 0) {
      lines.push('', `*Recent Errors:*`);
      for (const err of report.recentErrors) {
        const trigger = err.event_summary || 'unknown trigger';
        lines.push(
          `  ${err.action_type} → ${err.target || 'n/a'} (${formatTimeAgo(err.timestamp)})`,
          `    Trigger: ${trigger}`,
        );
      }
    }

    if (
      report.failedToolCalls.length === 0 &&
      report.recentErrors.length === 0
    ) {
      lines.push('', 'No errors or failed tool calls.');
    }

    return { ok: true, message: lines.join('\n') };
  }

  return {
    ok: false,
    error: [
      'Usage:',
      '  /debug last <n> — show last n actions',
      '  /debug why — show most recent action with tool calls',
      '  /debug event <id> — show all actions for an event',
      '  /debug report — summary report with stats and errors',
    ].join('\n'),
  };
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

export function handleUsageCommand(
  args: string,
  opts?: {
    groupJid?: string;
    groupName?: string;
    queue?: GroupQueue;
    registeredGroups?: Record<string, { name: string }>;
  },
): { ok: true; message: string } | { ok: false; error: string } {
  if (args === 'help') {
    return {
      ok: true,
      message: [
        '*Usage Command*',
        '────────────────',
        "  /usage - today's summary + 7-day trend",
        '  /usage week - last 7 days',
        '  /usage month - last 30 days',
        '  /usage all - all time',
        '  /usage help - this message',
        '',
        'Shows token counts (in/out), cache usage, cost, duration, and per-group breakdown.',
      ].join('\n'),
    };
  }

  const period =
    args === 'week'
      ? 'week'
      : args === 'month'
        ? 'month'
        : args === 'all'
          ? 'all'
          : 'today';

  const periodLabel =
    period === 'today'
      ? 'Today'
      : period === 'week'
        ? 'Last 7 Days'
        : period === 'month'
          ? 'Last 30 Days'
          : 'All Time';

  const isGroupScoped = !!opts?.groupJid;
  const summary = getUsageSummary(period, opts?.groupJid);

  const title = isGroupScoped
    ? `*Usage - ${opts!.groupName} - ${periodLabel}*`
    : `*Usage - ${periodLabel}*`;

  const lines: string[] = [
    title,
    `────────────────`,
    `Invocations: ${summary.invocations}`,
    `Tokens: ${formatTokens(summary.input_tokens)} in / ${formatTokens(summary.output_tokens)} out`,
    `Cache: ${formatTokens(summary.cache_read_tokens)} read / ${formatTokens(summary.cache_creation_tokens)} created`,
    `Cost: ${formatCost(summary.total_cost_usd)}`,
    `Duration: ${formatDuration(summary.total_duration_ms)}`,
    `Turns: ${summary.total_turns}`,
  ];

  if (!isGroupScoped) {
    const byGroup = getUsageByGroup(period);
    if (byGroup.length > 0) {
      lines.push('', `*By Group:*`);
      for (const g of byGroup) {
        lines.push(
          `  ${g.group_name}: ${g.invocations} calls, ${formatTokens(g.input_tokens + g.output_tokens)} tokens, ${formatCost(g.total_cost_usd)}`,
        );
      }
    }

    if (period === 'today') {
      const timeline = getUsageTimeline(7);
      if (timeline.length > 1) {
        lines.push('', `*Daily Trend (last 7 days):*`);
        for (const day of timeline) {
          lines.push(
            `  ${day.date}: ${day.invocations} calls, ${formatTokens(day.input_tokens + day.output_tokens)} tokens, ${formatCost(day.total_cost_usd)}`,
          );
        }
      }
    }
  }

  // Show active containers (usage not yet captured)
  if (opts?.queue) {
    const qs = opts.queue.getStatus();
    const activeGroups = qs.groups.filter((g) => g.active);
    if (activeGroups.length > 0) {
      const groupMap = opts.registeredGroups || {};
      lines.push('', `*In Progress (not yet counted):*`);
      for (const ag of activeGroups) {
        const name = groupMap[ag.jid]?.name || ag.jid;
        const label = ag.isTaskContainer ? 'task' : 'query';
        lines.push(`  ${name}: ${label} running`);
      }
    }
  }

  lines.push('', '_/usage [week|month|all] for other periods_');

  return { ok: true, message: lines.join('\n') };
}
