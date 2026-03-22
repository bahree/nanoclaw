/**
 * Observability facade for NanoClaw.
 * Re-exports event-log functions and provides thin wrappers for pipeline instrumentation.
 * Import this instead of event-log.ts directly from core files.
 */
export {
  logEvent,
  logAction,
  logToolCall,
  startLogPruning,
} from './event-log.js';
import { logEvent } from './event-log.js';

/**
 * Infer the channel name from a JID string.
 */
function inferChannel(chatJid: string): string {
  if (chatJid.includes('@g.us') || chatJid.includes('@s.whatsapp.net'))
    return 'whatsapp';
  if (chatJid.startsWith('tg:')) return 'telegram';
  if (chatJid.startsWith('dc:')) return 'discord';
  if (chatJid.startsWith('sl:')) return 'slack';
  return 'channel';
}

/**
 * Log an inbound message event (fire-and-forget).
 * Replaces the inline channel-detection + logEvent block in onMessage.
 */
export function logInboundMessage(
  chatJid: string,
  msg: { id: string; sender_name: string; content?: string },
): void {
  logEvent(
    inferChannel(chatJid),
    msg.id,
    { sender: msg.sender_name, content: msg.content?.slice(0, 200) },
    `Message from ${msg.sender_name}: ${(msg.content || '').slice(0, 80)}`,
  );
}
