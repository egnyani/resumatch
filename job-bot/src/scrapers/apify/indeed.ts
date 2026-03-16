import { ApifyClient } from 'apify-client';
import type { NormalizedJob } from '../normalizer';

export type RawJob = Record<string, unknown>;

export async function scrapeIndeed(keywords: string[], location: string): Promise<RawJob[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('APIFY_TOKEN is not set');

  const client = new ApifyClient({ token });

  console.log(`  [indeed] Scraping "${keywords.join(' OR ')}" @ ${location}...`);

  const run = await client.actor('misceres/indeed-scraper').call({
    position: keywords.join(' OR '),
    country: 'US',
    location,
    maxItems: 100,
  });

  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  return items as RawJob[];
}
