# Component Spec: Memory / Answer Store

**Files:** `src/memory/`
**Phase:** 3–4
**Depends on:** SQLite (`better-sqlite3`), Anthropic API (for semantic similarity)

---

## Purpose

The answer store is what makes this system improve over time. Every question you answer via Telegram is normalized and saved. The next time Clawbot sees a similar question — even if worded differently — it looks here first before interrupting you. Over time, you answer fewer and fewer questions manually.

---

## The Memory Improvement Curve

```
Week 1:  20 jobs → ~60 interrupts (lots of unknown questions)
Week 2:  20 jobs → ~30 interrupts (half already in memory)
Week 3:  20 jobs → ~10 interrupts (most covered)
Month 2: 20 jobs → ~3 interrupts  (only truly novel questions)
```

---

## Files

### `src/memory/answer-store.ts`

CRUD operations for the `answer_memory` table.

```typescript
import { db } from '../queue/db';

export interface AnswerRecord {
  id?: number;
  raw_question: string;
  normalized_intent: string;
  approved_answer: string;
  answer_type: 'yes_no' | 'number' | 'text' | 'select';
  conditions: string;
  confidence: number;
  job_id: string;
  company: string;
  use_count: number;
  last_used: string;
  created_at?: string;
}

export function saveAnswer(record: Omit<AnswerRecord, 'id' | 'created_at' | 'use_count'>): void {
  db.prepare(`
    INSERT INTO answer_memory
      (raw_question, normalized_intent, approved_answer, answer_type,
       conditions, confidence, job_id, company, use_count, last_used, created_at)
    VALUES
      (@raw_question, @normalized_intent, @approved_answer, @answer_type,
       @conditions, @confidence, @job_id, @company, 0, @last_used, datetime('now'))
  `).run(record);
}

export function findAnswer(
  question: string,
  options?: string[]
): AnswerRecord | null {
  // Step 1: Try exact match on raw_question
  const exact = db.prepare(
    'SELECT * FROM answer_memory WHERE lower(raw_question) = lower(?) ORDER BY use_count DESC LIMIT 1'
  ).get(question) as AnswerRecord | null;

  if (exact && exact.confidence >= 0.8) {
    incrementUseCount(exact.id!);
    return exact;
  }

  // Step 2: Try normalized intent keyword match
  const keywords = extractKeywords(question);
  for (const kw of keywords) {
    const match = db.prepare(
      "SELECT * FROM answer_memory WHERE normalized_intent LIKE ? AND confidence >= 0.7 ORDER BY use_count DESC LIMIT 1"
    ).get(`%${kw}%`) as AnswerRecord | null;

    if (match) {
      incrementUseCount(match.id!);
      return match;
    }
  }

  return null;
}

export function getAllAnswers(): AnswerRecord[] {
  return db.prepare('SELECT * FROM answer_memory ORDER BY use_count DESC').all() as AnswerRecord[];
}

export function updateAnswer(id: number, newAnswer: string): void {
  db.prepare(
    "UPDATE answer_memory SET approved_answer = ?, last_used = datetime('now') WHERE id = ?"
  ).run(newAnswer, id);
}

export function deleteAnswer(id: number): void {
  db.prepare('DELETE FROM answer_memory WHERE id = ?').run(id);
}

function incrementUseCount(id: number): void {
  db.prepare("UPDATE answer_memory SET use_count = use_count + 1, last_used = datetime('now') WHERE id = ?").run(id);
}

function extractKeywords(question: string): string[] {
  const lower = question.toLowerCase();
  const intentKeywords: Record<string, string[]> = {
    'salary_expectation':   ['salary', 'compensation', 'pay', 'wage', 'ctc'],
    'visa_sponsorship':     ['sponsor', 'visa', 'h1b', 'h-1b', 'ead', 'opt'],
    'work_authorization':   ['authorized', 'eligible', 'legally', 'work in the us'],
    'relocation':           ['relocat', 'willing to move', 'open to moving'],
    'remote_preference':    ['remote', 'hybrid', 'on-site', 'work from home'],
    'start_date':           ['start date', 'available', 'when can you', 'notice period'],
    'why_company':          ['why this company', 'why us', 'why are you interested'],
    'years_experience':     ['years of experience', 'how many years'],
    'highest_education':    ['degree', 'education', 'bachelor', 'master', 'phd'],
    'gender':               ['gender', 'sex', 'pronouns'],
    'ethnicity':            ['race', 'ethnicity', 'hispanic', 'diversity'],
    'disability':           ['disability', 'disabled', 'accommodation'],
    'veteran':              ['veteran', 'military', 'armed forces'],
  };

  const matches: string[] = [];
  for (const [intent, patterns] of Object.entries(intentKeywords)) {
    if (patterns.some(p => lower.includes(p))) {
      matches.push(intent);
    }
  }
  return matches;
}
```

---

## Answer Memory Table Schema

```sql
CREATE TABLE IF NOT EXISTS answer_memory (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_question       TEXT NOT NULL,
  normalized_intent  TEXT NOT NULL,   -- e.g. 'salary_expectation'
  approved_answer    TEXT NOT NULL,
  answer_type        TEXT NOT NULL,   -- 'yes_no' | 'number' | 'text' | 'select'
  conditions         TEXT,            -- e.g. 'senior roles' or 'general'
  confidence         REAL DEFAULT 1.0,
  job_id             TEXT,
  company            TEXT,
  use_count          INTEGER DEFAULT 0,
  last_used          TEXT,
  created_at         TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_answer_intent ON answer_memory(normalized_intent);
CREATE INDEX IF NOT EXISTS idx_answer_question ON answer_memory(raw_question);
```

---

## Pre-Seeded Answers

Seed the answer store with your standard answers before running Clawbot for the first time. This means the first run already has answers for common questions.

Create a file `data/seed-answers.json`:

```json
[
  {
    "raw_question": "Are you legally authorized to work in the United States?",
    "normalized_intent": "work_authorization",
    "approved_answer": "Yes",
    "answer_type": "yes_no",
    "conditions": "general",
    "confidence": 1.0
  },
  {
    "raw_question": "Will you now or in the future require sponsorship for an employment visa?",
    "normalized_intent": "visa_sponsorship",
    "approved_answer": "Yes",
    "answer_type": "yes_no",
    "conditions": "general",
    "confidence": 1.0
  },
  {
    "raw_question": "What is your expected salary?",
    "normalized_intent": "salary_expectation",
    "approved_answer": "$150,000 - $180,000",
    "answer_type": "text",
    "conditions": "senior software engineering roles",
    "confidence": 0.9
  },
  {
    "raw_question": "Are you open to relocation?",
    "normalized_intent": "relocation",
    "approved_answer": "Open to remote or hybrid. Not currently open to relocation.",
    "answer_type": "text",
    "conditions": "general",
    "confidence": 1.0
  },
  {
    "raw_question": "What is your earliest available start date?",
    "normalized_intent": "start_date",
    "approved_answer": "2 weeks after offer acceptance",
    "answer_type": "text",
    "conditions": "general",
    "confidence": 1.0
  }
]
```

And a seed script `src/memory/seed.ts`:

```typescript
import { saveAnswer } from './answer-store';
import seedData from '../../data/seed-answers.json';

export function seedAnswerMemory(): void {
  for (const answer of seedData) {
    saveAnswer({
      ...answer,
      job_id: 'SEED',
      company: 'SEED',
      last_used: new Date().toISOString(),
    });
  }
  console.log(`Seeded ${seedData.length} answers into memory store`);
}
```

---

## Vibe Coding Prompt

```
Build the answer memory store for a job application bot in Node.js + TypeScript.

Files:
- src/memory/answer-store.ts — SQLite CRUD for answer_memory table.
  saveAnswer(record) — inserts a new memory record.
  findAnswer(question, options?) — looks up an answer. Try exact match first,
  then keyword-based intent matching. Return the record or null. Increment use_count on match.
  getAllAnswers() — returns all records sorted by use_count desc.
  updateAnswer(id, newAnswer), deleteAnswer(id).

- src/memory/seed.ts — reads data/seed-answers.json and bulk-inserts into answer_memory.
  Run this once at first setup.

answer_memory table:
(id, raw_question, normalized_intent, approved_answer, answer_type, conditions,
 confidence, job_id, company, use_count, last_used, created_at)

Intent keyword matching: build a lookup table mapping common intent names
(salary_expectation, visa_sponsorship, work_authorization, relocation, start_date)
to trigger phrases. When findAnswer is called, extract which intent the question
belongs to and search by that intent.

Use better-sqlite3. No LLM calls in this file — just SQLite reads/writes.
```

---

## Integration Points

- **Written by:** `src/interrupt/answer-normalizer.ts` (after Telegram replies)
- **Written by:** `src/memory/seed.ts` (initial setup)
- **Read by:** `src/clawbot/question-handler.ts` (before escalating to interrupt)
- **Read by:** Dashboard (to show learned answers)
