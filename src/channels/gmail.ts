import fs from 'fs';
import os from 'os';
import path from 'path';

const PROCESSED_IDS_PATH = path.join(process.cwd(), 'store', 'gmail-processed-ids.json');

import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

// isMain flag is used instead of MAIN_GROUP_FOLDER constant
import { log as logger } from '../log.js';
import { registerChannelAdapter } from './channel-registry.js';
import type { ChannelAdapter, ChannelSetup, OutboundMessage } from './adapter.js';

function loadProcessedIds(): string[] {
  try {
    if (fs.existsSync(PROCESSED_IDS_PATH)) {
      return JSON.parse(fs.readFileSync(PROCESSED_IDS_PATH, 'utf-8')) as string[];
    }
  } catch {
    // ignore corrupt file — start fresh
  }
  return [];
}

function saveProcessedIds(ids: Set<string>): void {
  try {
    fs.mkdirSync(path.dirname(PROCESSED_IDS_PATH), { recursive: true });
    fs.writeFileSync(PROCESSED_IDS_PATH, JSON.stringify([...ids]));
  } catch {
    // non-fatal
  }
}

interface ThreadMeta {
  sender: string;
  senderName: string;
  subject: string;
  messageId: string; // RFC 2822 Message-ID for In-Reply-To
}

export class GmailChannel implements ChannelAdapter {
  name = 'gmail';
  channelType = 'gmail';
  supportsThreads = false;

  private oauth2Client: OAuth2Client | null = null;
  private gmail: gmail_v1.Gmail | null = null;
  private setupCallbacks: ChannelSetup | null = null;
  private pollIntervalMs: number;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private processedIds = new Set<string>(loadProcessedIds());
  private threadMeta = new Map<string, ThreadMeta>();
  private lastThreadId: string | null = null; // most recently received thread, used by inbox deliver
  private consecutiveErrors = 0;
  private userEmail = '';
  private connected = false;

  constructor(pollIntervalMs = 60000) {
    this.pollIntervalMs = pollIntervalMs;
  }

  async setup(config: ChannelSetup): Promise<void> {
    this.setupCallbacks = config;
    await this.connect();
  }

  async teardown(): Promise<void> {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async deliver(platformId: string, _threadId: string | null, message: OutboundMessage): Promise<string | undefined> {
    const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
    await this.sendMessage(platformId, content);
    return undefined;
  }

  async connect(): Promise<void> {
    const credDir = path.join(os.homedir(), '.gmail-mcp');
    const keysPath = path.join(credDir, 'gcp-oauth.keys.json');
    const tokensPath = path.join(credDir, 'credentials.json');

    if (!fs.existsSync(keysPath) || !fs.existsSync(tokensPath)) {
      logger.warn('Gmail credentials not found in ~/.gmail-mcp/. Skipping Gmail channel. Run /add-gmail to set up.');
      return;
    }

    const keys = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));
    const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));

    const clientConfig = keys.installed || keys.web || keys;
    const { client_id, client_secret, redirect_uris } = clientConfig;
    this.oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris?.[0]);
    this.oauth2Client.setCredentials(tokens);

    // Persist refreshed tokens
    this.oauth2Client.on('tokens', (newTokens) => {
      try {
        const current = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
        Object.assign(current, newTokens);
        fs.writeFileSync(tokensPath, JSON.stringify(current, null, 2));
        logger.debug('Gmail OAuth tokens refreshed');
      } catch (err) {
        logger.warn('Failed to persist refreshed Gmail tokens', { err });
      }
    });

    this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });

    // Verify connection
    const profile = await this.gmail.users.getProfile({ userId: 'me' });
    this.userEmail = profile.data.emailAddress || '';
    this.connected = true;
    logger.info('Gmail channel connected', { email: this.userEmail });

    // Start polling with error backoff
    const schedulePoll = () => {
      const backoffMs =
        this.consecutiveErrors > 0
          ? Math.min(this.pollIntervalMs * Math.pow(2, this.consecutiveErrors), 30 * 60 * 1000)
          : this.pollIntervalMs;
      this.pollTimer = setTimeout(() => {
        this.pollForMessages()
          .catch((err) => logger.error('Gmail poll error', { err }))
          .finally(() => {
            if (this.gmail) schedulePoll();
          });
      }, backoffMs);
    };

    // Initial poll
    await this.pollForMessages();
    schedulePoll();
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.gmail) {
      logger.warn('Gmail not initialized');
      return;
    }

    const rawId = jid.replace(/^gmail:/, '');
    // 'inbox' is the fixed routing jid — fall back to the last received thread
    const threadId = rawId === 'inbox' ? (this.lastThreadId ?? rawId) : rawId;
    const meta = this.threadMeta.get(threadId);

    if (!meta) {
      logger.warn('No thread metadata for reply, cannot send', { jid, threadId });
      return;
    }

    const subject = meta.subject.startsWith('Re:') ? meta.subject : `Re: ${meta.subject}`;

    const headers = [
      `To: ${meta.sender}`,
      `From: ${this.userEmail}`,
      `Subject: ${subject}`,
      `In-Reply-To: ${meta.messageId}`,
      `References: ${meta.messageId}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      text,
    ].join('\r\n');

    const encodedMessage = Buffer.from(headers)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    try {
      await this.gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedMessage,
          threadId,
        },
      });
      logger.info('Gmail reply sent', { to: meta.sender, threadId });
    } catch (err) {
      logger.error('Failed to send Gmail reply', { jid, err });
    }
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('gmail:');
  }

  async disconnect(): Promise<void> {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.gmail = null;
    this.oauth2Client = null;
    logger.info('Gmail channel stopped');
  }

  // --- Private ---

  private buildQuery(): string {
    return 'is:unread category:primary';
  }

  private async pollForMessages(): Promise<void> {
    if (!this.gmail) return;

    try {
      const query = this.buildQuery();
      const res = await this.gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 10,
      });

      const messages = res.data.messages || [];

      for (const stub of messages) {
        if (!stub.id || this.processedIds.has(stub.id)) continue;
        this.processedIds.add(stub.id);
        saveProcessedIds(this.processedIds);

        await this.processMessage(stub.id);
      }

      // Cap processed ID set to prevent unbounded growth
      if (this.processedIds.size > 5000) {
        const ids = [...this.processedIds];
        this.processedIds = new Set(ids.slice(ids.length - 2500));
        saveProcessedIds(this.processedIds);
      }

      this.consecutiveErrors = 0;
    } catch (err) {
      this.consecutiveErrors++;
      const backoffMs = Math.min(this.pollIntervalMs * Math.pow(2, this.consecutiveErrors), 30 * 60 * 1000);
      logger.error('Gmail poll failed', {
        err,
        consecutiveErrors: this.consecutiveErrors,
        nextPollMs: backoffMs,
      });
    }
  }

  private async processMessage(messageId: string): Promise<void> {
    if (!this.gmail) return;

    const msg = await this.gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    const headers = msg.data.payload?.headers || [];
    const getHeader = (name: string) => headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

    const from = getHeader('From');
    const subject = getHeader('Subject');
    const rfc2822MessageId = getHeader('Message-ID');
    const threadId = msg.data.threadId || messageId;
    const timestamp = new Date(parseInt(msg.data.internalDate || '0', 10)).toISOString();

    // Extract sender name and email
    const senderMatch = from.match(/^(.+?)\s*<(.+?)>$/);
    const senderName = senderMatch ? senderMatch[1].replace(/"/g, '') : from;
    const senderEmail = senderMatch ? senderMatch[2] : from;

    // Skip emails from self (our own replies)
    if (senderEmail === this.userEmail) return;

    // Extract body text
    const body = this.extractTextBody(msg.data.payload);

    if (!body) {
      logger.debug('Skipping email with no text body', { messageId, subject });
      return;
    }

    // Cache thread metadata for replies and track most recent thread
    this.threadMeta.set(threadId, {
      sender: senderEmail,
      senderName,
      subject,
      messageId: rfc2822MessageId,
    });
    this.lastThreadId = threadId;

    if (!this.setupCallbacks) return;

    // All emails route to a single inbox group (matches v1 behaviour).
    // Thread ID is included in content so the agent can use Gmail MCP tools
    // to reply to the correct thread.
    const inboxJid = 'gmail:inbox';
    this.setupCallbacks.onMetadata(inboxJid, 'Gmail inbox', false);

    const content = `[Email from ${senderName} <${senderEmail}>]\nSubject: ${subject}\nThreadId: ${threadId}\n\n${body}`;

    this.setupCallbacks.onInbound(inboxJid, null, {
      id: messageId,
      kind: 'chat',
      content: { text: content, sender: senderEmail, senderName },
      timestamp,
    });

    logger.info('Gmail email delivered via v2 inbound', { chatJid: inboxJid, from: senderName, subject, threadId });
  }

  private extractTextBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
    if (!payload) return '';

    // Direct text/plain body
    if (payload.mimeType === 'text/plain' && payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }

    // Multipart: search parts recursively
    if (payload.parts) {
      // Prefer text/plain
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          return Buffer.from(part.body.data, 'base64').toString('utf-8');
        }
      }
      // Recurse into nested multipart
      for (const part of payload.parts) {
        const text = this.extractTextBody(part);
        if (text) return text;
      }
    }

    return '';
  }
}

registerChannelAdapter('gmail', {
  factory: () => {
    const credDir = path.join(os.homedir(), '.gmail-mcp');
    if (
      !fs.existsSync(path.join(credDir, 'gcp-oauth.keys.json')) ||
      !fs.existsSync(path.join(credDir, 'credentials.json'))
    ) {
      logger.warn('Gmail: credentials not found in ~/.gmail-mcp/. Skipping. Run /add-gmail to set up.');
      return null;
    }
    return new GmailChannel();
  },
});
