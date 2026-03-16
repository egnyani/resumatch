# Component Spec: Application Controller

**Files:** `src/application/controller.ts`
**Phase:** 3
**Depends on:** DB queue, Clawbot worker, submit policy

---

## Purpose

The controller is the coordinator between the intelligence pipeline and the execution pipeline. It reads jobs from the DB queue where the resume is ready, validates they're safe to run, and hands them one at a time to Clawbot. It also manages rate limiting (you don't want to submit 50 applications in 5 minutes), retry logic for failures, and notifications via Telegram when batches complete.

---

## Files

### `src/application/controller.ts`

```typescript
import { db } from '../queue/db';
import { applyToJob } from '../clawbot/worker';
import { syncFromExcel } from '../queue/excel-sync';
import { exportToExcel } from '../queue/excel-export';
import { sendNotification } from '../interrupt/telegram-bot';
import settings from '../../config/settings.json';

interface ControllerOptions {
  maxJobsPerRun?: number;      // default: 10
  delayBetweenJobs?: number;  // ms, default: 30000 (30s)
  dryRun?: boolean;            // if true: log what would happen but don't apply
}

export async function runApplicationController(options: ControllerOptions = {}): Promise<void> {
  const {
    maxJobsPerRun = 10,
    delayBetweenJobs = 30000,
    dryRun = false,
  } = options;

  // Step 1: Sync Excel → DB in case user made manual changes
  await syncFromExcel();

  // Step 2: Get jobs ready to apply
  const jobs = db.prepare(`
    SELECT * FROM jobs
    WHERE status = 'ready_to_apply'
    AND resume_version IS NOT NULL
    ORDER BY fit_score DESC, created_at ASC
    LIMIT ?
  `).all(maxJobsPerRun) as JobRecord[];

  if (jobs.length === 0) {
    console.log('No jobs ready to apply. Nothing to do.');
    return;
  }

  console.log(`Running application controller: ${jobs.length} jobs queued`);
  if (dryRun) console.log('DRY RUN MODE — no applications will be submitted');

  const results = { submitted: 0, failed: 0, paused: 0, skipped: 0 };

  for (const job of jobs) {
    console.log(`\nProcessing: ${job.company} — ${job.title} (score: ${job.fit_score})`);

    if (dryRun) {
      console.log(`  [DRY RUN] Would apply to: ${job.apply_url}`);
      results.skipped++;
      continue;
    }

    // Check if this ATS platform is blocked or not yet supported
    if (isBlockedPlatform(job.ats_platform)) {
      console.log(`  Skipping: ATS platform '${job.ats_platform}' not yet supported`);
      db.prepare("UPDATE jobs SET status = 'paused', notes = ? WHERE job_id = ?")
        .run(`ATS '${job.ats_platform}' not yet supported`, job.job_id);
      results.paused++;
      continue;
    }

    try {
      await applyToJob(job);
      results.submitted++;
    } catch (err) {
      console.error(`  Error applying to ${job.job_id}:`, err);
      results.failed++;
    }

    // Delay between applications (be human-like, avoid rate limits)
    if (jobs.indexOf(job) < jobs.length - 1) {
      console.log(`  Waiting ${delayBetweenJobs / 1000}s before next application...`);
      await sleep(delayBetweenJobs);
    }
  }

  // Step 3: Refresh Excel after run
  await exportToExcel();

  // Step 4: Send summary via Telegram
  const summary = `
🤖 *Application Run Complete*

✅ Submitted: ${results.submitted}
❌ Failed: ${results.failed}
⏸ Paused: ${results.paused}
⏭ Skipped: ${results.skipped}
Total: ${jobs.length}
`;
  await sendNotification(summary);
  console.log('\nRun complete:', results);
}

function isBlockedPlatform(platform: string | null): boolean {
  // Platforms we haven't built Clawbot strategies for yet
  const unsupported = ['taleo', 'icims', 'workday'];
  return unsupported.includes(platform ?? '');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

---

### `src/application/run.ts`

Entry point to run the full pipeline end to end.

```typescript
import { runScrapers } from '../scrapers/run-scrapers';
import { runMatchingAgent } from '../matching/scorer';
import { runTailoringAgent } from '../tailoring/run-tailoring';
import { runApplicationController } from './controller';

async function runFullPipeline(): Promise<void> {
  console.log('=== Job Bot Full Pipeline ===\n');

  console.log('--- Step 1: Discovery ---');
  await runScrapers();

  console.log('\n--- Step 2: Matching ---');
  await runMatchingAgent();

  console.log('\n--- Step 3: Resume Tailoring ---');
  await runTailoringAgent();

  console.log('\n--- Step 4: Application ---');
  await runApplicationController({ maxJobsPerRun: 10 });

  console.log('\n=== Pipeline Complete ===');
}

runFullPipeline().catch(console.error);
```

---

## Run Modes

| Mode | Command | Description |
|---|---|---|
| Full pipeline | `npx ts-node src/application/run.ts` | Discovery → Match → Tailor → Apply |
| Scrape only | `npx ts-node src/scrapers/run-scrapers.ts` | Just find and queue new jobs |
| Match only | `npx ts-node src/matching/scorer.ts` | Score unscored jobs |
| Tailor only | `npx ts-node src/tailoring/run-tailoring.ts` | Generate resumes for matched jobs |
| Apply only | `npx ts-node src/application/controller.ts` | Run Clawbot on ready jobs |
| Dry run | Pass `--dry-run` flag | Log what would happen, no submissions |
| Dashboard | `npx ts-node src/dashboard/server.ts` | Start localhost:3000 |

---

## Rate Limiting Strategy

Never apply to too many jobs too fast. These defaults are reasonable starting points:

| Setting | Default | Why |
|---|---|---|
| Max jobs per controller run | 10 | Prevents bot-like behavior patterns |
| Delay between applications | 30 seconds | Human-paced |
| Daily application cap | Set in `settings.json` | Protect reputation and avoid flags |

---

## Vibe Coding Prompt

```
Build the application controller for a job application bot in Node.js + TypeScript.

Files:
- src/application/controller.ts — reads jobs where status='ready_to_apply' from SQLite,
  sorted by fit_score DESC. Calls applyToJob(job) for each. Adds a 30s delay between jobs.
  Skips unsupported ATS platforms (taleo, icims, workday) — marks them as 'paused'.
  Supports dry-run mode (logs what would happen, no actual applications).
  After run: exports updated Excel and sends Telegram summary.
  Options: { maxJobsPerRun, delayBetweenJobs, dryRun }

- src/application/run.ts — orchestrates the full pipeline:
  runScrapers → runMatchingAgent → runTailoringAgent → runApplicationController.
  Each step is sequential. Log section headers between steps.

Sync Excel → DB before reading the queue (in case user made manual status changes).
```

---

## Integration Points

- **Reads from:** SQLite `jobs` where `status = 'ready_to_apply'`
- **Calls:** `src/clawbot/worker.ts` — `applyToJob()`
- **Calls:** `src/interrupt/telegram-bot.ts` — sends batch summary
- **Calls:** `src/queue/excel-sync.ts` — before run
- **Calls:** `src/queue/excel-export.ts` — after run
- **Writes to:** SQLite: status updates
