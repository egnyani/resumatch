import 'dotenv/config';
import { updateJobStatus, db } from '../queue/db';
import { exportToExcel } from '../queue/excel-export';
import { applyHardRules } from './rules';
import type { JobRecord } from '../queue/db';

export async function runMatchingAgent(): Promise<void> {
  const jobs = db.prepare("SELECT * FROM jobs WHERE status = 'new'").all() as JobRecord[];
  console.log(`Filtering ${jobs.length} jobs through hard rules...`);

  let passed = 0, skipped = 0;

  for (const job of jobs) {
    const result = applyHardRules(job);

    if (result.pass) {
      updateJobStatus(job.job_id, 'ready_to_tailor');
      passed++;
      console.log(`  PASS  ${job.company} — ${job.title}`);
    } else {
      updateJobStatus(job.job_id, 'skipped', { fit_reasoning: result.reason });
      skipped++;
      console.log(`  SKIP  ${job.company} — ${job.title} [${result.reason}]`);
    }
  }

  console.log(`\nDone. ready_to_tailor=${passed} skipped=${skipped}`);
  await exportToExcel();
  console.log('Excel queue updated.');
}

runMatchingAgent().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
