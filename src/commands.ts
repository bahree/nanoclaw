/**
 * Command router for NanoClaw built-in slash commands.
 * Centralizes command dispatch so index.ts doesn't need per-command if/else blocks.
 * Commands are intercepted before message storage - they never reach the agent.
 */
import {
  buildStatus,
  buildTasksStatus,
  handleDebugCommand,
  handleTaskCommand,
  handleUsageCommand,
} from './status.js';
import { TRIGGER_PATTERN } from './config.js';
import { startRemoteControl, stopRemoteControl } from './remote-control.js';
import { findChannel } from './router.js';
import { GroupQueue } from './group-queue.js';
import { Channel, NewMessage, RegisteredGroup } from './types.js';
import { logger } from './logger.js';

export interface CommandContext {
  registeredGroups: () => Record<string, RegisteredGroup>;
  channels: Channel[];
  queue: GroupQueue;
}

/**
 * Try to handle a slash command. Returns true if the message was a command
 * (and was handled), false if it should continue to normal processing.
 */
export function tryHandleCommand(
  chatJid: string,
  msg: NewMessage,
  ctx: CommandContext,
): boolean {
  const trimmed = msg.content.trim();

  // Remote control commands
  if (trimmed === '/remote-control' || trimmed === '/remote-control-end') {
    handleRemoteControlCmd(trimmed, chatJid, msg, ctx).catch((err) =>
      logger.error({ err, chatJid }, 'Remote control command error'),
    );
    return true;
  }

  // /usage works in any registered group (scoped to that group's data)
  const group = ctx.registeredGroups()[chatJid];
  const channel = findChannel(ctx.channels, chatJid);

  if (group && channel) {
    // Strip trigger pattern (e.g. "@Claw /usage" -> "/usage")
    const stripped = trimmed.replace(TRIGGER_PATTERN, '').trim();
    if (stripped === '/usage' || stripped.startsWith('/usage ')) {
      const args = stripped.slice('/usage'.length).trim();
      const opts = group.isMain
        ? undefined
        : { groupJid: chatJid, groupName: group.name };
      const result = handleUsageCommand(args, opts);
      channel
        .sendMessage(chatJid, result.ok ? result.message : result.error)
        .catch((err) =>
          logger.error({ err, chatJid }, 'Usage command error'),
        );
      return true;
    }
  }

  // All remaining commands are main-group only
  if (!group?.isMain) return false;
  if (!channel) return false;

  if (trimmed === '/status' || trimmed === '/status tasks') {
    const text =
      trimmed === '/status tasks'
        ? buildTasksStatus()
        : buildStatus(ctx.queue, ctx.channels);
    channel
      .sendMessage(chatJid, text)
      .catch((err) => logger.error({ err, chatJid }, 'Status command error'));
    return true;
  }

  if (trimmed.startsWith('/task ')) {
    const args = trimmed.slice('/task '.length);
    const result = handleTaskCommand(args);
    channel
      .sendMessage(chatJid, result.ok ? result.message : result.error)
      .catch((err) => logger.error({ err, chatJid }, 'Task command error'));
    return true;
  }

  if (trimmed.startsWith('/debug')) {
    const args = trimmed.slice('/debug'.length).trim();
    const result = handleDebugCommand(args);
    channel
      .sendMessage(chatJid, result.ok ? result.message : result.error)
      .catch((err) => logger.error({ err, chatJid }, 'Debug command error'));
    return true;
  }

  return false;
}

async function handleRemoteControlCmd(
  command: string,
  chatJid: string,
  msg: NewMessage,
  ctx: CommandContext,
): Promise<void> {
  const group = ctx.registeredGroups()[chatJid];
  if (!group?.isMain) {
    logger.warn(
      { chatJid, sender: msg.sender },
      'Remote control rejected: not main group',
    );
    return;
  }

  const channel = findChannel(ctx.channels, chatJid);
  if (!channel) return;

  if (command === '/remote-control') {
    const result = await startRemoteControl(msg.sender, chatJid, process.cwd());
    if (result.ok) {
      await channel.sendMessage(chatJid, result.url);
    } else {
      await channel.sendMessage(
        chatJid,
        `Remote Control failed: ${result.error}`,
      );
    }
  } else {
    const result = stopRemoteControl();
    if (result.ok) {
      await channel.sendMessage(chatJid, 'Remote Control session ended.');
    } else {
      await channel.sendMessage(chatJid, result.error);
    }
  }
}
