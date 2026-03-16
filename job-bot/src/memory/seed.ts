/**
 * seed.ts
 * Pre-populates the answer_memory table with standard answers.
 * Run once at first setup: npm run seed
 */

import 'dotenv/config';
import { saveAnswer } from './answer-store';
import seedData from '../../data/seed-answers.json';
import { db } from '../queue/db';

function seedAnswerMemory(): void {
  // Check how many are already seeded to avoid duplicates
  const existing = (db.prepare(
    "SELECT COUNT(*) as cnt FROM answer_memory WHERE job_id = 'SEED'"
  ).get() as { cnt: number }).cnt;

  if (existing > 0) {
    console.log(`Answer memory already seeded (${existing} seed records found).`);
    console.log('To re-seed, delete existing seed records first:');
    console.log("  DELETE FROM answer_memory WHERE job_id = 'SEED';");
    return;
  }

  let saved = 0;
  for (const answer of seedData) {
    try {
      saveAnswer({
        raw_question:      answer.raw_question,
        normalized_intent: answer.normalized_intent,
        approved_answer:   answer.approved_answer,
        answer_type:       answer.answer_type as 'yes_no' | 'number' | 'text' | 'select',
        conditions:        answer.conditions,
        confidence:        answer.confidence,
        job_id:            'SEED',
        company:           'SEED',
        last_used:         new Date().toISOString(),
      });
      saved++;
    } catch (err) {
      console.error(`Failed to seed: "${answer.raw_question}"`, (err as Error).message);
    }
  }

  console.log(`\n✓ Seeded ${saved} answers into answer_memory`);
  console.log('Your bot will now auto-answer these question types without interrupting you:\n');

  const intents = [...new Set(seedData.map(a => a.normalized_intent))];
  for (const intent of intents) {
    const count = seedData.filter(a => a.normalized_intent === intent).length;
    console.log(`  • ${intent} (${count} variant${count > 1 ? 's' : ''})`);
  }
  console.log('');
}

seedAnswerMemory();
