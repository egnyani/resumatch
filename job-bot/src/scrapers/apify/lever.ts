/**
 * Lever scraper — uses Lever's public JSON API.
 * Lever job boards are at: https://api.lever.co/v0/postings/<company>?mode=json
 *
 * We fetch from a list of known company slugs. To expand coverage, add more
 * slugs to the LEVER_COMPANIES list in config/settings.json or pass them in.
 */
import type { RawJob } from './indeed';

async function fetchLeverJobs(companySlug: string): Promise<RawJob[]> {
  const url = `https://api.lever.co/v0/postings/${companySlug}?mode=json`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`  [lever] ${companySlug} returned ${res.status} — skipping`);
    return [];
  }
  const data = (await res.json()) as RawJob[];
  // Attach company slug so normalizer can reference it
  return data.map(job => ({ ...job, company: companySlug }));
}

export async function scrapeLever(
  _keywords: string[],
  _location: string,
  companySlugs: string[] = []
): Promise<RawJob[]> {
  if (companySlugs.length === 0) {
    console.log('  [lever] No company slugs provided — skipping');
    return [];
  }

  console.log(`  [lever] Fetching jobs from ${companySlugs.length} companies...`);
  const results = await Promise.allSettled(companySlugs.map(fetchLeverJobs));

  const jobs: RawJob[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') jobs.push(...r.value);
  }
  return jobs;
}
