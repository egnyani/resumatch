/**
 * answer-store.ts
 * SQLite CRUD for the answer_memory table.
 * No LLM calls here — just fast reads and writes.
 */

import { db } from '../queue/db';

export interface AnswerRecord {
  id?:                number;
  raw_question:       string;
  normalized_intent:  string;
  approved_answer:    string;
  answer_type:        'yes_no' | 'number' | 'text' | 'select';
  conditions:         string;
  confidence:         number;
  job_id:             string;
  company:            string;
  use_count?:         number;
  last_used:          string;
  created_at?:        string;
}

// ─── Keyword intent map ───────────────────────────────────────────────────────
// Maps a normalized_intent slug to phrases that trigger it

const INTENT_KEYWORDS: Record<string, string[]> = {
  salary_expectation:   ['salary', 'compensation', 'pay', 'wage', 'ctc', 'expected salary'],
  visa_sponsorship:     ['sponsor', 'visa', 'h1b', 'h-1b', 'ead', 'opt', 'sponsorship'],
  work_authorization:   ['authorized', 'legally', 'work in the us', 'eligible to work'],
  relocation:           ['relocat', 'willing to move', 'open to moving'],
  remote_preference:    ['remote', 'hybrid', 'on-site', 'work from home', 'office'],
  start_date:           ['start date', 'available', 'when can you', 'notice period', 'earliest'],
  why_company:          ['why this company', 'why us', 'why are you interested', 'why do you want'],
  years_experience:     ['years of experience', 'how many years', 'years experience'],
  highest_education:    ['degree', 'education', 'bachelor', 'master', 'phd', 'highest level'],
  gender:               ['gender', 'pronouns'],
  ethnicity:            ['race', 'ethnicity', 'hispanic', 'diversity', 'origin'],
  disability:           ['disability', 'disabled', 'accommodation'],
  veteran:              ['veteran', 'military', 'armed forces', 'service member'],
  linkedin_profile:     ['linkedin', 'linkedin url', 'linkedin profile'],
  portfolio:            ['portfolio', 'github', 'website', 'personal site'],
  cover_letter:         ['cover letter', 'why should we', 'tell us about yourself'],
};

// ─── Write ────────────────────────────────────────────────────────────────────

export function saveAnswer(
  record: Omit<AnswerRecord, 'id' | 'created_at' | 'use_count'>
): void {
  db.prepare(`
    INSERT INTO answer_memory
      (raw_question, normalized_intent, approved_answer, answer_type,
       conditions, confidence, job_id, company, use_count, last_used, created_at)
    VALUES
      (@raw_question, @normalized_intent, @approved_answer, @answer_type,
       @conditions, @confidence, @job_id, @company, 0, @last_used, datetime('now'))
  `).run(record);
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Look up the best stored answer for a given question.
 * Priority: 1) exact match  2) intent keyword match
 * Returns null if nothing found or confidence too low.
 */
export function findAnswer(
  question: string,
  _options?: string[]
): AnswerRecord | null {
  // 1. Exact match (case-insensitive)
  const exact = db.prepare(`
    SELECT * FROM answer_memory
    WHERE lower(raw_question) = lower(?)
    ORDER BY use_count DESC, confidence DESC
    LIMIT 1
  `).get(question) as AnswerRecord | null;

  if (exact && exact.confidence >= 0.8) {
    incrementUseCount(exact.id!);
    return exact;
  }

  // 2. Intent keyword match
  const intents = extractIntents(question);
  for (const intent of intents) {
    const match = db.prepare(`
      SELECT * FROM answer_memory
      WHERE normalized_intent = ? AND confidence >= 0.7
      ORDER BY use_count DESC
      LIMIT 1
    `).get(intent) as AnswerRecord | null;

    if (match) {
      incrementUseCount(match.id!);
      return match;
    }
  }

  return null;
}

export function getAllAnswers(): AnswerRecord[] {
  return db.prepare(
    'SELECT * FROM answer_memory ORDER BY use_count DESC, created_at DESC'
  ).all() as AnswerRecord[];
}

export function getAnswersByIntent(intent: string): AnswerRecord[] {
  return db.prepare(
    'SELECT * FROM answer_memory WHERE normalized_intent = ? ORDER BY use_count DESC'
  ).all(intent) as AnswerRecord[];
}

// ─── Update / Delete ──────────────────────────────────────────────────────────

export function updateAnswer(id: number, newAnswer: string): void {
  db.prepare(`
    UPDATE answer_memory
    SET approved_answer = ?, last_used = datetime('now')
    WHERE id = ?
  `).run(newAnswer, id);
}

export function deleteAnswer(id: number): void {
  db.prepare('DELETE FROM answer_memory WHERE id = ?').run(id);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function incrementUseCount(id: number): void {
  db.prepare(`
    UPDATE answer_memory
    SET use_count = use_count + 1, last_used = datetime('now')
    WHERE id = ?
  `).run(id);
}

function extractIntents(question: string): string[] {
  const lower  = question.toLowerCase();
  const found: string[] = [];
  for (const [intent, phrases] of Object.entries(INTENT_KEYWORDS)) {
    if (phrases.some(p => lower.includes(p))) {
      found.push(intent);
    }
  }
  return found;
}
