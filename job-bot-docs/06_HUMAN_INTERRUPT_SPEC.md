# Component Spec: Human Interrupt Layer

**Files:** `src/interrupt/`
**Phase:** 3
**Depends on:** Telegram Bot API (`node-telegram-bot-api`), SQLite answer store

---

## Purpose

When Clawbot encounters a form question it cannot answer from profile memory or the answer store, it pauses and sends you a Telegram message. You reply on your phone, the answer is saved to memory, and the bot resumes. This is what makes the system practical at scale — one unknown question no longer kills the entire run.

---

## Why Telegram over WhatsApp

WhatsApp Business API requires Meta business verification, typically takes days to weeks, and costs money via Twilio or similar. Telegram Bot API is free, instant to create, and a Telegram bot can be sending messages within 30 minutes. Once the system is stable you can always add WhatsApp as an alternative channel.

---

## Setup (One-Time)

1. Open Telegram and message `@BotFather`
2. Send `/newbot`, give it a name, get your bot token
3. Start a chat with your new bot, send it any message
4. Go to `https://api.telegram.org/bot{TOKEN}/getUpdates` to get your `chat_id`
5. Add both to `.env`:
   ```
   TELEGRAM_BOT_TOKEN=7xxxxxxxx:AAxxxxxx
   TELEGRAM_CHAT_ID=1xxxxxxxx
   ```

---

## Files

### `src/interrupt/telegram-bot.ts`

Sends interrupt messages to you and waits for your reply with a timeout.

```typescript
import TelegramBot from 'node-telegram-bot-api';
import { updateJobStatus } from '../queue/db';

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN!, { polling: true });
const CHAT_ID = process.env.TELEGRAM_CHAT_ID!;
const REPLY_TIMEOUT_MS = 10 * 60 * 1000;  // 10 minutes

// Map of pending questions waiting for replies: questionId → resolve function
const pendingReplies = new Map<string, (answer: string) => void>();

// Listen for all incoming messages
bot.on('message', (msg) => {
  const text = msg.text;
  if (!text) return;

  // Check if this is a reply to a pending question
  if (msg.reply_to_message) {
    const originalMsgId = msg.reply_to_message.message_id.toString();
    const resolver = pendingReplies.get(originalMsgId);
    if (resolver) {
      resolver(text);
      pendingReplies.delete(originalMsgId);
      bot.sendMessage(CHAT_ID, `✓ Got it. Resuming application.`);
    }
  }
});

export async function sendInterrupt(
  job: JobRecord,
  question: string,
  fieldType: string,
  options?: string[]
): Promise<string | null> {
  // Build the message
  let messageText = `
🤖 *Job Bot needs your help*

*Company:* ${job.company}
*Role:* ${job.title}

*Question on the form:*
_${question}_
`;

  if (options && options.length > 0) {
    messageText += `\n*Options:*\n${options.map((o, i) => `${i + 1}. ${o}`).join('\n')}`;
    messageText += `\n\nReply with the option number or your own answer.`;
  } else {
    messageText += `\nReply to this message with your answer.`;
  }

  // Send the message
  const sent = await bot.sendMessage(CHAT_ID, messageText, {
    parse_mode: 'Markdown',
    reply_markup: { force_reply: true, selective: true },
  });

  // Wait for reply with timeout
  return new Promise((resolve) => {
    const msgId = sent.message_id.toString();

    const timeout = setTimeout(() => {
      pendingReplies.delete(msgId);
      bot.sendMessage(CHAT_ID, `⏰ No reply received for "${question}". Application paused.`);
      resolve(null);
    }, REPLY_TIMEOUT_MS);

    pendingReplies.set(msgId, (answer) => {
      clearTimeout(timeout);
      resolve(answer);
    });
  });
}

export async function sendNotification(message: string): Promise<void> {
  await bot.sendMessage(CHAT_ID, message, { parse_mode: 'Markdown' });
}

export async function sendStatusUpdate(job: JobRecord, status: string): Promise<void> {
  const emoji: Record<string, string> = {
    submitted:    '✅',
    failed:       '❌',
    needs_answer: '❓',
    applying:     '🔄',
  };
  const icon = emoji[status] ?? '📋';
  await sendNotification(`${icon} *${status.toUpperCase()}*\n${job.company} — ${job.title}`);
}
```

---

### `src/interrupt/question-router.ts`

Decides the priority and urgency of an interrupt. Some questions are higher risk than others.

```typescript
export type QuestionRisk = 'low' | 'medium' | 'high';

export interface RoutedQuestion {
  risk: QuestionRisk;
  category: string;
  suggested_answer?: string;
  warning?: string;
}

const HIGH_RISK_PATTERNS = [
  /salary/i,
  /compensation/i,
  /equity/i,
  /start date/i,
  /notice period/i,
  /why.*company/i,
  /why.*role/i,
];

const MEDIUM_RISK_PATTERNS = [
  /sponsor/i,
  /visa/i,
  /authorized/i,
  /relocat/i,
  /travel/i,
  /background check/i,
];

export function routeQuestion(question: string): RoutedQuestion {
  if (HIGH_RISK_PATTERNS.some(p => p.test(question))) {
    return {
      risk: 'high',
      category: 'negotiation',
      warning: 'This answer may affect your offer. Review carefully.',
    };
  }
  if (MEDIUM_RISK_PATTERNS.some(p => p.test(question))) {
    return {
      risk: 'medium',
      category: 'eligibility',
    };
  }
  return {
    risk: 'low',
    category: 'general',
  };
}
```

---

### `src/interrupt/answer-normalizer.ts`

Converts your Telegram reply into a structured memory record that can be reused.

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { saveAnswer } from '../memory/answer-store';

export interface NormalizedAnswer {
  raw_question: string;
  normalized_intent: string;   // e.g. "salary_expectation", "visa_sponsorship", "relocation"
  approved_answer: string;
  answer_type: 'yes_no' | 'number' | 'text' | 'select';
  conditions: string;          // e.g. "for senior roles in Bay Area"
  confidence: number;          // 0-1
}

export async function normalizeAndSave(
  rawQuestion: string,
  userAnswer: string,
  jobContext: { job_id: string; company: string; title: string }
): Promise<void> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages: [{
      role: 'user',
      content: `
You are normalizing a job application Q&A for reuse in future applications.

Question asked: "${rawQuestion}"
User's answer: "${userAnswer}"
Job context: ${jobContext.company}, ${jobContext.title}

Return a JSON object with:
- normalized_intent: short snake_case label for this type of question (e.g. "salary_expectation")
- answer_type: "yes_no" | "number" | "text" | "select"
- conditions: any conditions where this answer applies (or "general" if always applicable)
- confidence: 0.0 to 1.0 (how reusable is this answer)

Only return the JSON, no other text.
`
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
  const normalized = JSON.parse(text);

  await saveAnswer({
    raw_question: rawQuestion,
    normalized_intent: normalized.normalized_intent,
    approved_answer: userAnswer,
    answer_type: normalized.answer_type,
    conditions: normalized.conditions,
    confidence: normalized.confidence,
    job_id: jobContext.job_id,
    company: jobContext.company,
    last_used: new Date().toISOString(),
  });
}
```

---

## Message Flow Diagram

```
Clawbot hits unknown question
        │
        ▼
question-router.ts
  determines risk level
        │
        ▼
telegram-bot.ts
  sends you message:
  "❓ Company: Stripe
   Role: Backend Engineer
   Question: What is your expected salary?
   (Reply to this message)"
        │
        ▼
You reply on phone: "$160k-$180k"
        │
        ▼
telegram-bot.ts
  receives reply, resolves Promise
        │
        ▼
answer-normalizer.ts
  normalizes to memory record:
  { intent: "salary_expectation",
    answer: "$160k-$180k",
    conditions: "senior backend roles" }
        │
        ▼
answer-store.ts
  saves to SQLite
        │
        ▼
Clawbot resumes form filling
```

---

## Vibe Coding Prompt

```
Build the human interrupt layer for a job application bot in Node.js + TypeScript.

Files:
- src/interrupt/telegram-bot.ts — creates a Telegram bot using node-telegram-bot-api.
  sendInterrupt(job, question, fieldType, options?) — sends a message to the user via Telegram
  and waits up to 10 minutes for a reply. Returns the reply string or null on timeout.
  sendStatusUpdate(job, status) — sends a status notification (submitted/failed/etc).
  Uses polling mode. Bot token and chat_id from .env.

- src/interrupt/question-router.ts — classifies each question as low/medium/high risk.
  High risk: salary, equity, start date, "why this company".
  Medium risk: visa, sponsorship, relocation.
  Returns { risk, category, suggested_answer?, warning? }

- src/interrupt/answer-normalizer.ts — after user replies via Telegram, calls Claude Haiku
  to normalize the answer into a reusable memory record with normalized_intent, answer_type,
  conditions, and confidence. Saves to answer_memory SQLite table via answer-store.ts.

Use node-telegram-bot-api. Reply detection uses reply_to_message.message_id to match.
Handle timeout gracefully: pause the application, update DB status to 'needs_answer'.
```

---

## Integration Points

- **Called by:** `src/clawbot/question-handler.ts` when resolution type is 'interrupt'
- **Calls:** `src/memory/answer-store.ts` to save normalized answers
- **Writes to:** SQLite: `status = 'needs_answer'` on timeout
- **Communicates with:** You via Telegram
