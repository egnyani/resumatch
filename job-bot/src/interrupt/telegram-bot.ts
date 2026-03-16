/**
 * telegram-bot.ts
 * Sends interrupt messages to you via Telegram and waits for your reply.
 * Uses polling mode — no webhook server needed.
 */

import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';

const TOKEN   = process.env.TELEGRAM_BOT_TOKEN!;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID!;
const REPLY_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

if (!TOKEN || !CHAT_ID) {
  throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in .env');
}

// Lazy singleton — only starts polling when first used
let _bot: TelegramBot | null = null;

function getBot(): TelegramBot {
  if (!_bot) {
    _bot = new TelegramBot(TOKEN, { polling: true });

    _bot.on('message', (msg) => {
      const text = msg.text;
      if (!text || !msg.reply_to_message) return;

      const originalId = msg.reply_to_message.message_id.toString();
      const resolver   = pendingReplies.get(originalId);
      if (resolver) {
        resolver(text);
        pendingReplies.delete(originalId);
        _bot!.sendMessage(CHAT_ID, `✓ Got it. Resuming application.`);
      }
    });

    _bot.on('polling_error', (err) => {
      console.error('[Telegram] Polling error:', (err as any).message ?? err);
    });
  }
  return _bot;
}

// Map: message_id → resolve function for pending interrupt replies
const pendingReplies = new Map<string, (answer: string) => void>();

// ─── Public API ───────────────────────────────────────────────────────────────

export interface JobRef {
  job_id: string;
  company: string;
  title: string;
}

/**
 * Send an interrupt question to Telegram and wait up to 10 min for a reply.
 * Returns the user's answer string, or null on timeout.
 */
export async function sendInterrupt(
  job: JobRef,
  question: string,
  fieldType: string,
  options?: string[]
): Promise<string | null> {
  const bot = getBot();

  let text =
    `🤖 *Job Bot needs your help*\n\n` +
    `*Company:* ${escMd(job.company)}\n` +
    `*Role:* ${escMd(job.title)}\n\n` +
    `*Question on the form:*\n_${escMd(question)}_\n`;

  if (options && options.length > 0) {
    text += `\n*Options:*\n${options.map((o, i) => `${i + 1}\\. ${escMd(o)}`).join('\n')}`;
    text += `\n\nReply with the option number or type your own answer\\.`;
  } else {
    text += `\nReply to this message with your answer\\.`;
  }

  const sent = await bot.sendMessage(CHAT_ID, text, {
    parse_mode: 'MarkdownV2',
    reply_markup: { force_reply: true, selective: true },
  });

  return new Promise((resolve) => {
    const msgId = sent.message_id.toString();

    const timer = setTimeout(() => {
      pendingReplies.delete(msgId);
      bot.sendMessage(
        CHAT_ID,
        `⏰ No reply in 10 min for:\n"${question}"\nApplication paused\\.`,
        { parse_mode: 'MarkdownV2' }
      );
      resolve(null);
    }, REPLY_TIMEOUT_MS);

    pendingReplies.set(msgId, (answer) => {
      clearTimeout(timer);
      resolve(answer);
    });
  });
}

/**
 * Send a plain notification (no reply expected).
 */
export async function sendNotification(message: string): Promise<void> {
  const bot = getBot();
  await bot.sendMessage(CHAT_ID, message, { parse_mode: 'Markdown' });
}

/**
 * Send a status update for a job (submitted / failed / applying / etc).
 */
export async function sendStatusUpdate(job: JobRef, status: string): Promise<void> {
  const icons: Record<string, string> = {
    submitted:    '✅',
    failed:       '❌',
    needs_answer: '❓',
    applying:     '🔄',
    resume_generated: '📄',
  };
  const icon = icons[status] ?? '📋';
  await sendNotification(`${icon} *${status.toUpperCase()}*\n${job.company} — ${job.title}`);
}

/**
 * Stop polling (call on process exit to avoid lingering connections).
 */
export async function stopBot(): Promise<void> {
  if (_bot) {
    await _bot.stopPolling();
    _bot = null;
  }
}

// Escape special chars for MarkdownV2
function escMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}
