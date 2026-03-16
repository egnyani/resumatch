/**
 * controller.ts
 * Coordinates the execution pipeline: reads ready jobs, calls Clawbot,
 * handles rate limiting, skips unsupported ATS, sends Telegram summary.
 *
 * Usage: npm run apply
 * Flags: --limit=N  --dry-run
 */
import 'dotenv/config';
import { db, updateJobStatus } from '../queue/db';
import { applyToJob } from '../clawbot/worker';
import { syncFromExcel } from '../queue/excel-sync';
import { exportToExcel } from '../queue/excel-export';
import { sendNotification } from '../interrupt/telegram-bot';
import type { JobRecord } from '../queue/db';

// ATS platforms Clawbot can't handle yet
const UNSUPPORTED_ATS = ['taleo', 'icims', 'workday'];

const DELAY_BETWEEN_JOBS_MS = 30_000; // 30 seconds — human-like pacing

interface ControllerOptions {
  maxJobs?: number;
  dryRun?:  boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export async function runApplicationController(opts: ControllerOptions = {}): Promise<void> {
  const args   = process.argv.slice(2);
  const limit  = opts.maxJobs ?? parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] ?? '10', 10);
  const dryRun = opts.dryRun ?? args.includes('--dry-run');

  // Step 1: sync Excel → DB so manual status changes are reflected
  try {
    await syncFromExcel();
  } catch (e) {
    console.warn('[controller] Excel sync skipped:', (e as Error).message);
  }

  // Step 2: fetch jobs ready to apply
  const jobs = db.prepare(`
    SELECT * FROM jobs
    WHERE status = 'ready_to_apply'
    AND resume_version IS NOT NULL
    ORDER BY created_at ASC
    LIMIT ?
  `).all(limit) as JobRecord[];

  console.log(`\n=== Application Controller ===`);
  console.log(`Jobs ready:  ${jobs.length}`);
  console.log(`Mode:        ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);

  if (jobs.length === 0) {
    console.log('No jobs to apply to. Run npm run tailor first.');
    return;
  }

  const results = { submitted: 0, filled: 0, paused: 0, skipped: 0, failed: 0 };

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    console.log(`[${i + 1}/${jobs.length}] ${job.company} — ${job.title}`);

    // Skip unsupported ATS platforms
    if (UNSUPPORTED_ATS.includes(job.ats_platform ?? '')) {
      console.log(`  ⏭ Skipping — ATS "${job.ats_platform}" not yet supported`);
      updateJobStatus(job.job_id, 'paused', { fit_reasoning: `ATS ${job.ats_platform} not supported` });
      results.skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`  [DRY RUN] Would apply to: ${job.apply_url}`);
      console.log(`  Resume: ${job.resume_version}`);
      results.skipped++;
      continue;
    }

    try {
      await applyToJob(job);

      const updated = db.prepare('SELECT status FROM jobs WHERE job_id = ?').get(job.job_id) as { status: string } | undefined;
      const finalStatus = updated?.status ?? 'unknown';
      if (finalStatus === 'submitted')    results.submitted++;
      else if (finalStatus === 'needs_answer') results.paused++;
      else                                results.filled++;

    } catch (err) {
      console.error(`  ❌ Fatal error:`, (err as Error).message);
      results.failed++;
    }

    // Delay between jobs (skip delay after last job)
    if (i < jobs.length - 1) {
      console.log(`  ⏳ Waiting ${DELAY_BETWEEN_JOBS_MS / 1000}s before next application...`);
      await sleep(DELAY_BETWEEN_JOBS_MS);
    }
  }

  // Step 3: refresh Excel
  try {
    await exportToExcel();
  } catch (e) {
    console.warn('[controller] Excel export skipped:', (e as Error).message);
  }

  // Step 4: send Telegram summary
  const summary =
    `🤖 *Application Run Complete*\n\n` +
    `✅ Submitted: ${results.submitted}\n` +
    `📝 Filled (review): ${results.filled}\n` +
    `⏸ Paused: ${results.paused}\n` +
    `⏭ Skipped: ${results.skipped}\n` +
    `❌ Failed: ${results.failed}\n` +
    `Total: ${jobs.length}`;

  await sendNotification(summary).catch(e => console.warn('[telegram]', e.message));

  console.log('\n=== Done ===');
  console.log(`Submitted: ${results.submitted}  Filled: ${results.filled}  Paused: ${results.paused}  Failed: ${results.failed}`);
}

runApplicationController().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
