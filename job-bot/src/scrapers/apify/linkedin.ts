import { ApifyClient } from 'apify-client';
import type { RawJob } from './indeed';

function buildLinkedinSearchUrl(keywords: string[], location: string): string {
  const params = new URLSearchParams({
    keywords: keywords.join(' '),
    location,
    sortBy: 'DD', // most recent
    f_TPR: 'r604800', // posted in last 7 days
  });
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
}

export async function scrapeLinkedin(keywords: string[], location: string): Promise<RawJob[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('APIFY_TOKEN is not set');

  const client = new ApifyClient({ token });
  const searchUrl = buildLinkedinSearchUrl(keywords, location);

  console.log(`  [linkedin] Scraping "${keywords.join(' ')}" @ ${location}...`);

  const run = await client.actor('curious_coder/linkedin-jobs-scraper').call({
    urls: [searchUrl],
    maxResults: 100,
  });

  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  return items as RawJob[];
}
