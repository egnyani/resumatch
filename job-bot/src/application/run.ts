/**
 * run.ts
 * Full pipeline entry point: Scrape → Match → Tailor → Apply
 * Usage: npm run pipeline
 */
import 'dotenv/config';
import { runScrapers } from '../scrapers/run-scrapers';
import { runMatchingAgent } from '../matching/scorer';
import { runTailoringAgent } from '../tailoring/run-tailoring';
import { runApplicationController } from './controller';

async function runFullPipeline(): Promise<void> {
  console.log('╔══════════════════════════════════════╗');
  console.log('║       Job Bot — Full Pipeline        ║');
  console.log('╚══════════════════════════════════════╝\n');

  console.log('━━━ Step 1: Discovery (Scraping) ━━━');
  await runScrapers();

  console.log('\n━━━ Step 2: Matching & Filtering ━━━');
  await runMatchingAgent();

  console.log('\n━━━ Step 3: Resume Tailoring ━━━');
  await runTailoringAgent();

  console.log('\n━━━ Step 4: Applying ━━━');
  await runApplicationController({ maxJobs: 10 });

  console.log('\n╔══════════════════════════════════════╗');
  console.log('║         Pipeline Complete            ║');
  console.log('╚══════════════════════════════════════╝');
}

runFullPipeline().catch(err => {
  console.error('Pipeline failed:', err);
  process.exit(1);
});
