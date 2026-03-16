# Component Spec: Job Queue (DB + Excel)

**Files:** `src/queue/`, `db/schema.sql`
**Phase:** 1 (build first — everything depends on this)
**Depends on:** `better-sqlite3`, `exceljs`

---

## Purpose

The queue is the shared memory of the entire system. SQLite is the authoritative source of truth. Excel is the visible control panel — you can filter, sort, manually change statuses, and pause rows. Changes made in Excel sync back to SQLite via a sync script.

---

## Files

### `db/schema.sql`

See `11_DATABASE_SCHEMA.md` for the full schema. The key table is `jobs`.

### `src/queue/db.ts`

Single shared DB connection used across all modules.

```typescript
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.resolve(__dirname, '../../db/jobs.db');
export const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');

// Create tables on first run
const schema = require('fs').readFileSync(
  path.resolve(__dirname, '../../db/schema.sql'), 'utf-8'
);
db.exec(schema);

// Job CRUD
export function insertJob(job: Partial<JobRecord>): number {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO jobs
      (job_id, title, company, location, description, source_site,
       source_link, apply_url, salary_min, salary_max, posted_date,
       dedupe_hash, ats_platform, status, created_at)
    VALUES
      (@job_id, @title, @company, @location, @description, @source_site,
       @source_link, @apply_url, @salary_min, @salary_max, @posted_date,
       @dedupe_hash, @ats_platform, 'new', datetime('now'))
  `);
  const result = stmt.run({ job_id: generateId(), ...job });
  return result.lastInsertRowid as number;
}

export function updateJobStatus(jobId: string, status: string, extra?: object): void {
  const fields = extra ? Object.keys(extra).map(k => `${k} = @${k}`).join(', ') + ', ' : '';
  db.prepare(`UPDATE jobs SET ${fields}status = @status, updated_at = datetime('now') WHERE job_id = @jobId`)
    .run({ jobId, status, ...extra });
}

export function getJobsByStatus(status: string): JobRecord[] {
  return db.prepare('SELECT * FROM jobs WHERE status = ?').all(status) as JobRecord[];
}

export function getAllJobs(): JobRecord[] {
  return db.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all() as JobRecord[];
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}
```

---

### `src/queue/excel-export.ts`

Writes all DB rows to `data/queue/jobs.xlsx`. Run this after any scraper run or status change.

```typescript
import ExcelJS from 'exceljs';
import path from 'path';
import { getAllJobs } from './db';

const EXCEL_PATH = path.resolve(__dirname, '../../data/queue/jobs.xlsx');

export async function exportToExcel(): Promise<void> {
  const jobs = getAllJobs();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Job Queue');

  // Define columns
  sheet.columns = [
    { header: 'job_id',          key: 'job_id',          width: 12 },
    { header: 'status',          key: 'status',          width: 18 },
    { header: 'company',         key: 'company',         width: 22 },
    { header: 'title',           key: 'title',           width: 35 },
    { header: 'location',        key: 'location',        width: 18 },
    { header: 'source',          key: 'source_site',     width: 14 },
    { header: 'ats_platform',    key: 'ats_platform',    width: 14 },
    { header: 'fit_score',       key: 'fit_score',       width: 10 },
    { header: 'fit_decision',    key: 'fit_decision',    width: 10 },
    { header: 'resume_version',  key: 'resume_version',  width: 28 },
    { header: 'salary_min',      key: 'salary_min',      width: 12 },
    { header: 'salary_max',      key: 'salary_max',      width: 12 },
    { header: 'apply_url',       key: 'apply_url',       width: 50 },
    { header: 'posted_date',     key: 'posted_date',     width: 14 },
    { header: 'notes',           key: 'notes',           width: 40 },
    { header: 'created_at',      key: 'created_at',      width: 20 },
    { header: 'updated_at',      key: 'updated_at',      width: 20 },
  ];

  // Style header row
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: 'pattern', pattern: 'solid',
    fgColor: { argb: 'FF1F4E79' }
  };
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  // Color-code rows by status
  const STATUS_COLORS: Record<string, string> = {
    new:              'FFFFFFFF',
    matched:          'FFE2EFDA',
    resume_generated: 'FFDDEBF7',
    ready_to_apply:   'FFFFF2CC',
    applying:         'FFFCE4D6',
    needs_answer:     'FFFFEB9C',
    submitted:        'FFC6EFCE',
    failed:           'FFFFC7CE',
    skipped:          'FFF2F2F2',
    duplicate:        'FFF2F2F2',
  };

  jobs.forEach(job => {
    const row = sheet.addRow(job);
    const color = STATUS_COLORS[job.status] ?? 'FFFFFFFF';
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
  });

  // Freeze header row and add auto-filter
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: 'Q1' };

  await workbook.xlsx.writeFile(EXCEL_PATH);
  console.log(`Excel queue updated: ${jobs.length} rows`);
}
```

---

### `src/queue/excel-sync.ts`

Reads manual edits from Excel back into SQLite. Run this before any pipeline that reads from the DB, so manual changes (like a status you changed by hand) are respected.

```typescript
import ExcelJS from 'exceljs';
import path from 'path';
import { updateJobStatus, db } from './db';

const EXCEL_PATH = path.resolve(__dirname, '../../data/queue/jobs.xlsx');

// Fields that are safe to sync back from Excel to DB
const SYNCABLE_FIELDS = ['status', 'notes', 'fit_score'];

export async function syncFromExcel(): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(EXCEL_PATH);

  const sheet = workbook.getWorksheet('Job Queue');
  if (!sheet) throw new Error('Job Queue sheet not found in Excel file');

  // Get header row to map column positions
  const headers: string[] = [];
  sheet.getRow(1).eachCell(cell => headers.push(cell.value as string));

  let updated = 0;

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // skip header

    const jobId = row.getCell(headers.indexOf('job_id') + 1).value as string;
    if (!jobId) return;

    const excelRow: Record<string, any> = {};
    headers.forEach((header, idx) => {
      excelRow[header] = row.getCell(idx + 1).value;
    });

    // Only sync allowed fields
    const updates: Record<string, any> = {};
    for (const field of SYNCABLE_FIELDS) {
      if (excelRow[field] !== undefined) {
        updates[field] = excelRow[field];
      }
    }

    if (Object.keys(updates).length > 0) {
      const sets = Object.keys(updates).map(k => `${k} = @${k}`).join(', ');
      db.prepare(`UPDATE jobs SET ${sets}, updated_at = datetime('now') WHERE job_id = @jobId`)
        .run({ ...updates, jobId });
      updated++;
    }
  });

  console.log(`Synced ${updated} rows from Excel to DB`);
}
```

---

## Excel Column Reference

| Column | Type | Who writes it | Editable by user? |
|---|---|---|---|
| job_id | text | System | No |
| status | text | System + User | Yes |
| company | text | Scraper | No |
| title | text | Scraper | No |
| location | text | Scraper | No |
| source | text | Scraper | No |
| ats_platform | text | ATS Classifier | No |
| fit_score | number | Matching Agent | Yes (override) |
| fit_decision | text | Matching Agent | Yes (override) |
| resume_version | text | Tailoring Agent | No |
| salary_min | number | Scraper | No |
| salary_max | number | Scraper | No |
| apply_url | text | Scraper | No |
| posted_date | date | Scraper | No |
| notes | text | User | Yes |
| created_at | datetime | System | No |
| updated_at | datetime | System | No |

---

## Valid Status Values

| Status | Meaning |
|---|---|
| `new` | Just scraped, not yet scored |
| `matched` | LLM scored it, decision = apply |
| `resume_generated` | Tailored resume ready |
| `ready_to_apply` | Waiting for Clawbot to pick up |
| `applying` | Clawbot is actively working on it |
| `needs_answer` | Human interrupt triggered, waiting |
| `submitted` | Application complete |
| `failed` | Error during application |
| `skipped` | LLM decided not to apply |
| `duplicate` | Same job already in queue |
| `paused` | Manually paused by user |

---

## Vibe Coding Prompt

```
Build the job queue module for a job application bot in Node.js + TypeScript.

Files to create:
- src/queue/db.ts — SQLite connection using better-sqlite3, creates tables from schema.sql on first run,
  exports: insertJob(), updateJobStatus(), getJobsByStatus(), getAllJobs()
- src/queue/excel-export.ts — exports all DB rows to data/queue/jobs.xlsx using exceljs,
  color-codes rows by status (green = submitted, yellow = ready_to_apply, red = failed, etc.),
  freezes header row, adds auto-filter
- src/queue/excel-sync.ts — reads jobs.xlsx and syncs the 'status', 'notes', 'fit_score'
  columns back into SQLite (SQLite is always source of truth, Excel is view layer)

JobRecord interface:
{ job_id, title, company, location, description, source_site, source_link,
  apply_url, salary_min, salary_max, posted_date, dedupe_hash, ats_platform,
  status, fit_score, fit_decision, fit_reasoning, resume_version, notes,
  created_at, updated_at }

No frameworks. Pure TypeScript modules. Use better-sqlite3 and exceljs.
```

---

## Integration Points

- **Written by:** Scraper Hub (inserts new jobs)
- **Read by:** Matching Agent (reads `status = 'new'`)
- **Written by:** Matching Agent (updates `fit_score`, `fit_decision`, `status`)
- **Read by:** Application Controller (reads `status = 'ready_to_apply'`)
- **Written by:** Clawbot (updates `status` during execution)
- **Visible to:** User via Excel
