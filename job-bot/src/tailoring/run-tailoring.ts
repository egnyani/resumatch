/**
 * run-tailoring.ts
 * Reads all jobs with status='ready_to_tailor' from SQLite,
 * calls OpenAI to tailor the resume for each, and outputs a .docx per job.
 *
 * Usage: npm run tailor
 * Options:
 *   --limit=N    Process only N jobs (default: all)
 *   --jobid=X    Process a single job by ID
 */

import OpenAI from 'openai';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { db, updateJobStatus } from '../queue/db';
import { buildResume, TailoredContent } from './resume-builder';
import rawSettings from '../../config/settings.json';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || (rawSettings.llm as any).api_key as string });

// ─── Load prompt template ─────────────────────────────────────────────────────

function loadTailoringPrompt(): string {
  const promptPath = resolve(__dirname, '../../prompts/tailoring-prompt.md');
  if (!existsSync(promptPath)) throw new Error(`Missing ${promptPath}`);
  return readFileSync(promptPath, 'utf-8');
}

// ─── Call LLM ─────────────────────────────────────────────────────────────────

async function tailorResume(
  company: string,
  title: string,
  jdText: string,
  masterResume: string,
  promptTemplate: string
): Promise<TailoredContent> {
  const prompt = promptTemplate
    .replace('{{COMPANY}}', company)
    .replace('{{JOB_TITLE}}', title)
    .replace('{{JD}}', jdText.slice(0, 3000))
    .replace('{{MASTER_RESUME}}', masterResume.slice(0, 3000));

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',   // use mini for cost — upgrade to gpt-4o for higher quality
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 2000,
  });

  const raw = response.choices[0]?.message?.content ?? '';

  // Strip markdown code block if present
  const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();

  let parsed: TailoredContent;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`JSON parse failed. Raw response:\n${raw.slice(0, 500)}`);
  }

  // Validate minimum required fields
  if (!parsed.experience || !Array.isArray(parsed.experience)) {
    throw new Error('LLM response missing "experience" array');
  }

  return parsed;
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

export async function runTailoringAgent(): Promise<void> {
  const args = process.argv.slice(2);
  const limitArg = args.find(a => a.startsWith('--limit='));
  const jobidArg = args.find(a => a.startsWith('--jobid='));

  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 0;
  const singleJobId = jobidArg ? jobidArg.split('=')[1] : null;

  // Load master resume
  const masterResumePath = resolve(__dirname, '../../data/resumes/master_resume.txt');
  if (!existsSync(masterResumePath)) {
    throw new Error(`master_resume.txt not found at ${masterResumePath}`);
  }
  const masterResume = readFileSync(masterResumePath, 'utf-8');
  const promptTemplate = loadTailoringPrompt();

  // Fetch jobs
  let jobs: any[];
  if (singleJobId) {
    jobs = db.prepare("SELECT * FROM jobs WHERE job_id = ?").all(singleJobId) as any[];
    if (jobs.length === 0) {
      console.error(`Job ID ${singleJobId} not found`);
      process.exit(1);
    }
  } else {
    const query = limit > 0
      ? "SELECT * FROM jobs WHERE status = 'ready_to_tailor' LIMIT ?"
      : "SELECT * FROM jobs WHERE status = 'ready_to_tailor'";
    jobs = limit > 0
      ? db.prepare(query).all(limit) as any[]
      : db.prepare(query).all() as any[];
  }

  console.log(`\n=== Resume Tailoring Agent ===`);
  console.log(`Jobs to tailor: ${jobs.length}`);
  console.log(`Model: gpt-4o-mini\n`);

  let success = 0;
  let failed = 0;

  for (const job of jobs) {
    const label = `[${job.company} — ${job.title}]`;
    process.stdout.write(`${label} tailoring...`);

    try {
      const tailored = await tailorResume(
        job.company,
        job.title,
        job.description ?? '',
        masterResume,
        promptTemplate
      );

      await buildResume({
        jobId: job.job_id,
        company: job.company,
        title: job.title,
        tailored,
      });

      success++;
    } catch (err) {
      process.stdout.write(` FAILED\n`);
      console.error(`  Error: ${(err as Error).message}`);
      updateJobStatus(job.job_id, 'tailor_failed');
      failed++;
    }

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n=== Done ===`);
  console.log(`  Success: ${success}`);
  console.log(`  Failed:  ${failed}`);
  console.log(`  Resumes saved to: data/resumes/generated/\n`);
}

runTailoringAgent().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
