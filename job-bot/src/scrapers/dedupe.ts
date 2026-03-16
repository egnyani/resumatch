import crypto from 'crypto';
import { db } from '../queue/db';
import type { NormalizedJob } from './normalizer';

export function hashJob(job: NormalizedJob): string {
  const key = [
    job.company.toLowerCase().trim(),
    job.title.toLowerCase().trim(),
    job.location.toLowerCase().trim(),
  ].join('|');
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
