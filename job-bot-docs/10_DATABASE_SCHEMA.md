# Database Schema + Excel Layout

**File:** `db/schema.sql`
**Engine:** SQLite via `better-sqlite3`

---

## Full Schema

```sql
-- ============================================================
--  JOBS TABLE
--  Source of truth for every job discovered by the system
-- ============================================================
CREATE TABLE IF NOT EXISTS jobs (
  -- Identity
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id            TEXT NOT NULL UNIQUE,        -- short alphanumeric ID, e.g. "A3B2X9"

  -- Job details (from scraper)
  title             TEXT NOT NULL,
  company           TEXT NOT NULL,
  location          TEXT,
  description       TEXT,                        -- full JD text
  source_site       TEXT,                        -- 'indeed' | 'linkedin' | 'greenhouse' etc
  source_link       TEXT,                        -- link to the job posting page
  apply_url         TEXT,                        -- direct apply link
  salary_min        INTEGER,
  salary_max        INTEGER,
  posted_date       TEXT,                        -- ISO date string
  dedupe_hash       TEXT,                        -- MD5 of company+title+location (unique)
  ats_platform      TEXT,                        -- 'greenhouse' | 'lever' | 'ashby' | 'workday' | 'unknown'

  -- Pipeline state
  status            TEXT NOT NULL DEFAULT 'new', -- see status enum below
  fit_score         INTEGER,                     -- 0-100 from matching agent
  fit_decision      TEXT,                        -- 'apply' | 'skip' | 'review'
  fit_reasoning     TEXT,                        -- LLM explanation
  resume_version    TEXT,                        -- filename of tailored resume

  -- Human notes
  notes             TEXT,                        -- manual notes by user

  -- Timestamps
  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now'))
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_jobs_status      ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_fit_score   ON jobs(fit_score);
CREATE INDEX IF NOT EXISTS idx_jobs_company     ON jobs(company);
CREATE INDEX IF NOT EXISTS idx_jobs_dedupe_hash ON jobs(dedupe_hash);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at  ON jobs(created_at);

-- ============================================================
--  ANSWER MEMORY TABLE
--  Stores reusable answers to common application questions
-- ============================================================
CREATE TABLE IF NOT EXISTS answer_memory (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_question       TEXT NOT NULL,              -- exact question text as seen on form
  normalized_intent  TEXT NOT NULL,              -- e.g. 'salary_expectation', 'visa_sponsorship'
  approved_answer    TEXT NOT NULL,              -- the answer to use
  answer_type        TEXT NOT NULL,              -- 'yes_no' | 'number' | 'text' | 'select'
  conditions         TEXT,                       -- e.g. 'senior roles' or 'general'
  confidence         REAL DEFAULT 1.0,           -- 0.0 to 1.0 — how reusable this answer is
  job_id             TEXT,                       -- job where this answer was first given
  company            TEXT,                       -- company where answer was first given
  use_count          INTEGER DEFAULT 0,          -- how many times this has been reused
  last_used          TEXT,                       -- ISO datetime
  created_at         TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_answer_intent   ON answer_memory(normalized_intent);
CREATE INDEX IF NOT EXISTS idx_answer_question ON answer_memory(raw_question);

-- ============================================================
--  APPLICATION EVENTS TABLE
--  Audit trail — every status change with timestamp
-- ============================================================
CREATE TABLE IF NOT EXISTS application_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      TEXT NOT NULL,
  event_type  TEXT NOT NULL,     -- 'status_change' | 'interrupt' | 'resume_generated' | 'error'
  old_value   TEXT,
  new_value   TEXT,
  note        TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_job_id   ON application_events(job_id);
CREATE INDEX IF NOT EXISTS idx_events_type     ON application_events(event_type);

-- ============================================================
--  SCRAPER RUNS TABLE
--  Tracks each scraper execution for monitoring
-- ============================================================
CREATE TABLE IF NOT EXISTS scraper_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source        TEXT NOT NULL,     -- 'indeed' | 'linkedin' etc
  started_at    TEXT,
  finished_at   TEXT,
  jobs_found    INTEGER DEFAULT 0,
  jobs_new      INTEGER DEFAULT 0,
  jobs_duped    INTEGER DEFAULT 0,
  status        TEXT DEFAULT 'running',  -- 'running' | 'success' | 'failed'
  error         TEXT
);

-- ============================================================
--  RESUME VERSIONS TABLE
--  Tracks every tailored resume generated
-- ============================================================
CREATE TABLE IF NOT EXISTS resume_versions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id         TEXT NOT NULL,
  filename       TEXT NOT NULL,
  base_resume    TEXT,                -- which base resume was used
  coverage_pct   INTEGER,            -- keyword coverage percent
  missing_kws    TEXT,               -- JSON array of missing keywords
  created_at     TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_resumes_job_id ON resume_versions(job_id);
```

---

## Status Enum Reference

Valid values for `jobs.status`:

| Value | Description |
|---|---|
| `new` | Just scraped, not yet scored |
| `matched` | LLM decided to apply, fit_score set |
| `resume_generated` | Tailored resume created, ready to queue |
| `ready_to_apply` | Waiting for Clawbot |
| `applying` | Clawbot is actively working |
| `needs_answer` | Human interrupt triggered, waiting for reply |
| `submitted` | Application complete |
| `failed` | Clawbot error |
| `skipped` | LLM decided not to apply |
| `duplicate` | Same job already in DB |
| `paused` | Manually paused by user or unsupported ATS |
| `review` | Score in review band — user decides manually |

---

## Excel Column Layout

Full column definitions for `data/queue/jobs.xlsx`:

| Col | Header | Source | User editable? | Notes |
|---|---|---|---|---|
| A | job_id | System | No | Primary key |
| B | status | System + User | **Yes** | See enum above |
| C | company | Scraper | No | |
| D | title | Scraper | No | |
| E | location | Scraper | No | |
| F | source | Scraper | No | indeed / linkedin / etc |
| G | ats_platform | ATS Classifier | No | greenhouse / lever / etc |
| H | fit_score | Matching Agent | **Yes** (override) | 0–100 |
| I | fit_decision | Matching Agent | **Yes** (override) | apply / skip / review |
| J | resume_version | Tailoring Agent | No | filename |
| K | salary_min | Scraper | No | |
| L | salary_max | Scraper | No | |
| M | apply_url | Scraper | No | hyperlink |
| N | posted_date | Scraper | No | |
| O | notes | User | **Yes** | Free text |
| P | created_at | System | No | |
| Q | updated_at | System | No | |

### Excel Color Coding by Status

| Status | Row Background |
|---|---|
| `new` | White |
| `matched` | Light green |
| `resume_generated` | Light blue |
| `ready_to_apply` | Light yellow |
| `applying` | Light orange |
| `needs_answer` | Yellow |
| `submitted` | Green |
| `failed` | Red |
| `skipped` | Light grey |
| `duplicate` | Light grey |
| `paused` | Grey |

---

## Database Initialization

The DB is auto-created and the schema is run on first startup (in `src/queue/db.ts`). You never need to run schema.sql manually — just run any script that imports `db.ts` and the file is created at `db/jobs.db`.

To reset everything and start fresh:

```bash
rm db/jobs.db
npx ts-node src/queue/db.ts   # recreates the file with empty tables
```

---

## Useful Queries

```sql
-- How many jobs in each status?
SELECT status, COUNT(*) as count FROM jobs GROUP BY status ORDER BY count DESC;

-- Top scored jobs not yet applied
SELECT job_id, company, title, fit_score FROM jobs
WHERE status = 'ready_to_apply' ORDER BY fit_score DESC LIMIT 20;

-- Answer memory sorted by usage
SELECT normalized_intent, approved_answer, use_count
FROM answer_memory ORDER BY use_count DESC;

-- Jobs applied this week
SELECT company, title, updated_at FROM jobs
WHERE status = 'submitted'
AND updated_at >= datetime('now', '-7 days');

-- Failed applications with error notes
SELECT job_id, company, title, notes FROM jobs
WHERE status = 'failed' ORDER BY updated_at DESC;

-- Average fit score by source
SELECT source_site, AVG(fit_score) as avg_score, COUNT(*) as count
FROM jobs WHERE fit_score IS NOT NULL
GROUP BY source_site ORDER BY avg_score DESC;
```

---

## `package.json` and Dependencies

```json
{
  "name": "job-bot",
  "version": "1.0.0",
  "scripts": {
    "scrape":     "ts-node src/scrapers/run-scrapers.ts",
    "match":      "ts-node src/matching/scorer.ts",
    "tailor":     "ts-node src/tailoring/run-tailoring.ts",
    "apply":      "ts-node src/application/controller.ts",
    "run":        "ts-node src/application/run.ts",
    "dashboard":  "ts-node src/dashboard/server.ts",
    "seed":       "ts-node src/memory/seed.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk":         "^0.24.0",
    "apify-client":              "^2.9.0",
    "better-sqlite3":            "^9.4.0",
    "docx":                      "^8.5.0",
    "exceljs":                   "^4.4.0",
    "express":                   "^4.18.0",
    "node-telegram-bot-api":     "^0.64.0",
    "playwright":                "^1.44.0"
  },
  "devDependencies": {
    "@types/better-sqlite3":     "^7.6.0",
    "@types/express":            "^4.17.0",
    "@types/node":               "^20.0.0",
    "@types/node-telegram-bot-api": "^0.64.0",
    "ts-node":                   "^10.9.0",
    "typescript":                "^5.4.0"
  }
}
```

---

## `.env` Template

```
# Apify
APIFY_TOKEN=apify_api_xxxxxxxxxxxxxxxxxxxxxxxxxx

# LLM (Anthropic)
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxx

# Telegram Bot
TELEGRAM_BOT_TOKEN=7xxxxxxxxx:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TELEGRAM_CHAT_ID=1xxxxxxxxx

# Optional: OpenAI as alternative LLM
# OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```
