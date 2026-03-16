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
