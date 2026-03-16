import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DB_PATH = path.resolve(__dirname, '../../db/jobs.db');

export const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');

// Create tables on first run
const schema = fs.readFileSync(
  path.resolve(__dirname, '../../db/schema.sql'),
  'utf-8'
);
db.exec(schema);

// ─── Types ───────────────────────────────────────────────────────────────────

export interface JobRecord {
  id?: number;
  job_id: string;
  title: string;
  company: string;
  location?: string;
  description?: string;
  source_site?: string;
  source_link?: string;
  apply_url?: string;
  salary_min?: number | null;
  salary_max?: number | null;
  posted_date?: string | null;
  dedupe_hash?: string;
  ats_platform?: string;
  status: string;
  fit_score?: number | null;
  fit_decision?: string | null;
  fit_reasoning?: string | null;
  resume_version?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export function insertJob(job: Omit<JobRecord, 'id' | 'job_id'> & { job_id?: string }): number {
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

export function updateJobStatus(jobId: string, status: string, extra?: Record<string, unknown>): void {
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

export function getJobById(jobId: string): JobRecord | undefined {
  return db.prepare('SELECT * FROM jobs WHERE job_id = ?').get(jobId) as JobRecord | undefined;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateId(): string {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}
