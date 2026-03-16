import 'dotenv/config';
import path from 'path';
import fs from 'fs';

import { scrapeIndeed }   from './apify/indeed';
import { scrapeLinkedin } from './apify/linkedin';
import { scrapeLever }    from './apify/lever';
import { scrapeAshby }   from './apify/ashby';

import {
  normalizeIndeedJob,
  normalizeLinkedinJob,
  normalizeLeverJob,
  normalizeAshbyJob,
  type NormalizedJob,
} from './normalizer';

import { dedupeJobs } from './dedupe';
import { classifyATS } from './ats-classifier';
import { insertJob, db } from '../queue/db';
import { exportToExcel } from '../queue/excel-export';

// ─── Load settings ────────────────────────────────────────────────────────────

interface Settings {
  job_preferences: {
    target_titles: string[];
    target_locations: string[];
  };
  apify?: {
    api_token?: string;
    lever_companies?: string[];
    ashby_companies?: string[];
  };
}

const SETTINGS_PATH = path.resolve(__dirname, '../../config/settings.json');
const settings: Settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));

// APIFY_TOKEN: env var takes priority, then settings file
if (!process.env.APIFY_TOKEN && settings.apify?.api_token) {
  process.env.APIFY_TOKEN = settings.apify.api_token;
}

// ─── Scraper run tracker ──────────────────────────────────────────────────────

function logRunStart(source: string): number {
  const result = db.prepare(`
    INSERT INTO scraper_runs (source, started_at, status)
    VALUES (?, datetime('now'), 'running')
  `).run(source);
  return result.lastInsertRowid as number;
}

function logRunEnd(
  runId: number,
  status: 'success' | 'failed',
  found: number,
  newJobs: number,
  duped: number,
  error?: string
): void {
  db.prepare(`
    UPDATE scraper_runs
    SET finished_at = datetime('now'), status = ?, jobs_found = ?,
        jobs_new = ?, jobs_duped = ?, error = ?
    WHERE id = ?
  `).run(status, found, newJobs, duped, error ?? null, runId);
}

// ─── Per-source scrape helper ────────────────────────────────────────────────

async function runSource(
  name: string,
  scrapeAll: () => Promise<NormalizedJob[]>
): Promise<{ newCount: number; totalCount: number }> {
  const runId = logRunStart(name);
  try {
    const normalized = await scrapeAll();
    const unique = dedupeJobs(normalized);
    const duped = normalized.length - unique.length;

    let inserted = 0;
    for (const job of unique) {
      const ats = classifyATS(job.apply_url);
      const rows = insertJob({ ...job, ats_platform: ats, status: 'new' });
      if (rows > 0) inserted++;
    }

    logRunEnd(runId, 'success', normalized.length, inserted, duped);
    console.log(`  [${name}] done — ${normalized.length} found, ${inserted} new, ${duped} duped`);
    return { newCount: inserted, totalCount: normalized.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logRunEnd(runId, 'failed', 0, 0, 0, msg);
    console.error(`  [${name}] FAILED: ${msg}`);
    return { newCount: 0, totalCount: 0 };
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function runScrapers(): Promise<void> {
  console.log('=== Scraper run started ===');

  const titles    = settings.job_preferences.target_titles;
  const locations = settings.job_preferences.target_locations;
  const leverSlugs = settings.apify?.lever_companies ?? [];
  const ashbySlugs = settings.apify?.ashby_companies ?? [];

  let totalNew = 0;

  // ── Indeed ────────────────────────────────────────────────────────────────
  for (const title of titles) {
    for (const loc of locations) {
      const { newCount } = await runSource(`indeed:${title}@${loc}`, async () => {
        const raw = await scrapeIndeed([title], loc);
        return raw.map(r => normalizeIndeedJob(r as Record<string, unknown>));
      });
      totalNew += newCount;
    }
  }

  // ── LinkedIn ──────────────────────────────────────────────────────────────
  for (const title of titles) {
    for (const loc of locations) {
      const { newCount } = await runSource(`linkedin:${title}@${loc}`, async () => {
        const raw = await scrapeLinkedin([title], loc);
        return raw.map(r => normalizeLinkedinJob(r as Record<string, unknown>));
      });
      totalNew += newCount;
    }
  }

  // ── Lever (direct API, no location filter) ────────────────────────────────
  if (leverSlugs.length > 0) {
    const { newCount } = await runSource('lever', async () => {
      const raw = await scrapeLever(titles, '', leverSlugs);
      return raw.map(r => normalizeLeverJob(r as Record<string, unknown>));
    });
    totalNew += newCount;
  }

  // ── Ashby (direct API, no location filter) ────────────────────────────────
  if (ashbySlugs.length > 0) {
    const { newCount } = await runSource('ashby', async () => {
      const raw = await scrapeAshby(titles, '', ashbySlugs);
      return raw.map(r => normalizeAshbyJob(r as Record<string, unknown>));
    });
    totalNew += newCount;
  }

  // ── Export ────────────────────────────────────────────────────────────────
  console.log(`\nTotal new jobs this run: ${totalNew}`);
  await exportToExcel();
  console.log('=== Scraper run complete ===');
}

runScrapers().catch(err => {
  console.error('Fatal scraper error:', err);
  process.exit(1);
});
