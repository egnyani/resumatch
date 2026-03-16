# Component Spec: Scraper Hub + Ingestion + Dedupe + ATS Classifier

**Files:** `src/scrapers/`
**Phase:** 1 (build first)
**Depends on:** Apify account, SQLite DB

---

## Purpose

This component is the entry point of the entire system. It pulls raw job listings from multiple sources using Apify, normalizes them into a standard shape, removes duplicates, detects which ATS platform each job uses, and hands clean job records to the queue.

---

## Inputs

- Apify API token (from `config/settings.json`)
- List of search keywords and locations (from settings)
- Existing job hashes in SQLite (for dedupe)

## Outputs

- Normalized job objects inserted into SQLite `jobs` table with `status = 'new'`
- New rows appended to `data/queue/jobs.xlsx`

---

## File Breakdown

### `src/scrapers/apify/indeed.ts`

Calls the Apify Indeed scraper actor with your search terms and returns raw job arrays.

```typescript
import ApifyClient from 'apify-client';

export async function scrapeIndeed(keywords: string[], location: string): Promise<RawJob[]> {
  const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

  const run = await client.actor('misceres/indeed-scraper').call({
    position: keywords.join(' OR '),
    country: 'US',
    location,
    maxItems: 100,
  });

  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  return items as RawJob[];
}
```

Create similar files for `linkedin.ts`, `greenhouse.ts`, `lever.ts`, `ashby.ts`. Each file exports one async function that calls the relevant Apify actor.

**Apify actors to use:**
| Source | Apify Actor ID |
|---|---|
| Indeed | `misceres/indeed-scraper` |
| LinkedIn | `curious_coder/linkedin-jobs-scraper` |
| Glassdoor | `bebity/glassdoor-jobs-scraper` |
| Greenhouse | `apimaestro/greenhouse-jobs-scraper` |
| Lever | build custom — Lever job boards are public JSON endpoints |
| Ashby | build custom — Ashby boards expose `/api/jobs` endpoint |

---

### `src/scrapers/normalizer.ts`

Takes raw output from any Apify actor and maps it to the standard `NormalizedJob` shape.

```typescript
export interface NormalizedJob {
  title: string;
  company: string;
  location: string;
  description: string;
  source_site: string;        // 'indeed' | 'linkedin' | 'greenhouse' etc
  source_link: string;        // link to the job posting page
  apply_url: string;          // direct apply link if available
  salary_min: number | null;
  salary_max: number | null;
  posted_date: string | null; // ISO date string
  raw: object;                // full original object for debugging
}

export function normalizeIndeedJob(raw: any): NormalizedJob {
  return {
    title: raw.positionName ?? '',
    company: raw.company ?? '',
    location: raw.location ?? '',
    description: raw.description ?? '',
    source_site: 'indeed',
    source_link: raw.url ?? '',
    apply_url: raw.externalApplyLink ?? raw.url ?? '',
    salary_min: parseSalary(raw.salary)?.min ?? null,
    salary_max: parseSalary(raw.salary)?.max ?? null,
    posted_date: raw.postedAt ?? null,
    raw,
  };
}

// Write similar normalizeLinkedinJob(), normalizeGreenhouseJob() etc.
// The key rule: every source must produce the same NormalizedJob shape.
```

---

### `src/scrapers/dedupe.ts`

Hashes each job and checks if it already exists in the DB. Keeps the record with the best apply URL.

```typescript
import crypto from 'crypto';
import { db } from '../queue/db';

export function hashJob(job: NormalizedJob): string {
  const key = `${job.company.toLowerCase().trim()}|${job.title.toLowerCase().trim()}|${job.location.toLowerCase().trim()}`;
  return crypto.createHash('md5').update(key).digest('hex');
}

export function isDuplicate(hash: string): boolean {
  const row = db.prepare('SELECT id FROM jobs WHERE dedupe_hash = ?').get(hash);
  return !!row;
}

export function dedupeJobs(jobs: NormalizedJob[]): NormalizedJob[] {
  const seen = new Set<string>();
  const results: NormalizedJob[] = [];

  for (const job of jobs) {
    const hash = hashJob(job);
    if (!isDuplicate(hash) && !seen.has(hash)) {
      seen.add(hash);
      results.push({ ...job, dedupe_hash: hash });
    }
  }
  return results;
}
```

---

### `src/scrapers/ats-classifier.ts`

Reads the apply URL and tags the ATS platform. This tells Clawbot which form strategy to load later.

```typescript
export type ATSPlatform =
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'workday'
  | 'taleo'
  | 'icims'
  | 'smartrecruiters'
  | 'direct'
  | 'unknown';

const ATS_PATTERNS: Record<ATSPlatform, RegExp[]> = {
  greenhouse:      [/greenhouse\.io/, /boards\.greenhouse/],
  lever:           [/jobs\.lever\.co/],
  ashby:           [/jobs\.ashbyhq\.com/],
  workday:         [/myworkdayjobs\.com/, /workday\.com/],
  taleo:           [/taleo\.net/],
  icims:           [/icims\.com/],
  smartrecruiters: [/smartrecruiters\.com/],
  direct:          [],
  unknown:         [],
};

export function classifyATS(applyUrl: string): ATSPlatform {
  for (const [platform, patterns] of Object.entries(ATS_PATTERNS)) {
    if (patterns.some(pattern => pattern.test(applyUrl))) {
      return platform as ATSPlatform;
    }
  }
  return 'unknown';
}
```

---

### Main scraper runner: `src/scrapers/run-scrapers.ts`

Orchestrates the full discovery pipeline run.

```typescript
import { scrapeIndeed } from './apify/indeed';
import { normalizeIndeedJob } from './normalizer';
import { dedupeJobs, hashJob } from './dedupe';
import { classifyATS } from './ats-classifier';
import { insertJob } from '../queue/db';
import { exportToExcel } from '../queue/excel-export';
import settings from '../../config/settings.json';

async function runScrapers() {
  console.log('Starting scraper run...');
  const allJobs = [];

  for (const keyword of settings.job_preferences.target_titles) {
    for (const location of settings.job_preferences.target_locations) {
      const raw = await scrapeIndeed([keyword], location);
      const normalized = raw.map(normalizeIndeedJob);
      allJobs.push(...normalized);
    }
  }

  const unique = dedupeJobs(allJobs);
  console.log(`Found ${unique.length} new unique jobs`);

  for (const job of unique) {
    const ats = classifyATS(job.apply_url);
    await insertJob({ ...job, ats_platform: ats, status: 'new' });
  }

  await exportToExcel();
  console.log('Scraper run complete. Excel queue updated.');
}

runScrapers().catch(console.error);
```

---

## Vibe Coding Prompt

Paste this into Cursor or Claude Code to build this component:

```
Build the scraper module for a job application bot using Node.js and TypeScript.

The module lives in src/scrapers/ and has these files:
- apify/indeed.ts — calls Apify indeed-scraper actor and returns raw jobs
- normalizer.ts — maps raw Apify output to a standard NormalizedJob shape
- dedupe.ts — hashes jobs by company+title+location and filters out ones already in SQLite
- ats-classifier.ts — reads apply_url and returns the ATS platform name (greenhouse, lever, ashby, workday, unknown)
- run-scrapers.ts — orchestrates the full pipeline: scrape → normalize → dedupe → classify → insert to DB → export to Excel

NormalizedJob shape:
{ title, company, location, description, source_site, source_link, apply_url,
  salary_min, salary_max, posted_date, dedupe_hash, ats_platform, raw }

Use the apify-client npm package. API token comes from process.env.APIFY_TOKEN.
Use better-sqlite3 for DB inserts.
Write TypeScript with proper interfaces.
Do not use any framework — plain Node.js modules only.
```

---

## Integration Points

- **Writes to:** SQLite `jobs` table
- **Writes to:** `data/queue/jobs.xlsx`
- **Read by:** Matching Agent (reads `status = 'new'` rows)
- **Config read:** `config/settings.json` for keywords and locations
