/**
 * answer-normalizer.ts
 * After you reply via Telegram, normalizes the answer into a reusable
 * memory record and saves it to SQLite via answer-store.ts.
 * Uses OpenAI gpt-4o-mini (same as the rest of the project).
 */

import 'dotenv/config';
import OpenAI from 'openai';
import { saveAnswer } from '../memory/answer-store';
import rawSettings from '../../config/settings.json';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || (rawSettings.llm as any).api_key as string });

const NORMALIZE_PROMPT = `You are normalizing a job application Q&A pair for reuse in future applications.

Question asked on the form: "{QUESTION}"
User's answer: "{ANSWER}"
Job context: {COMPANY}, {TITLE}

Return ONLY a JSON object, no other text:
{
  "normalized_intent": "<snake_case label, e.g. salary_expectation, visa_sponsorship, relocation>",
  "answer_type": "<yes_no | number | text | select>",
  "conditions": "<when this answer applies, e.g. 'general' or 'senior roles in NY'>",
  "confidence": <0.0 to 1.0>
}`;

export interface NormalizationResult {
  normalized_intent: string;
  answer_type: 'yes_no' | 'number' | 'text' | 'select';
  conditions: string;
  confidence: number;
}

export async function normalizeAndSave(
  rawQuestion: string,
  userAnswer:  string,
  jobContext:  { job_id: string; company: string; title: string }
): Promise<void> {
  const prompt = NORMALIZE_PROMPT
    .replace('{QUESTION}', rawQuestion)
    .replace('{ANSWER}',   userAnswer)
    .replace('{COMPANY}',  jobContext.company)
    .replace('{TITLE}',    jobContext.title);

  let normalized: NormalizationResult = {
    normalized_intent: 'general',
    answer_type:       'text',
    conditions:        'general',
    confidence:        0.7,
  };

  try {
    const response = await client.chat.completions.create({
      model:       'gpt-4o-mini',
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens:  150,
    });

    const raw     = response.choices[0]?.message?.content ?? '{}';
    const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim();
    normalized    = JSON.parse(cleaned);
  } catch (err) {
    console.warn('[answer-normalizer] Normalization failed, using defaults:', (err as Error).message);
  }

  saveAnswer({
    raw_question:       rawQuestion,
    normalized_intent:  normalized.normalized_intent,
    approved_answer:    userAnswer,
    answer_type:        normalized.answer_type,
    conditions:         normalized.conditions,
    confidence:         normalized.confidence,
    job_id:             jobContext.job_id,
    company:            jobContext.company,
    last_used:          new Date().toISOString(),
  });

  console.log(`[memory] Saved: "${normalized.normalized_intent}" → "${userAnswer}"`);
}
