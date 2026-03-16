import { ApifyClient } from 'apify-client';
import type { RawJob } from './indeed';

export async function scrapeGlassdoor(keywords: string[], location: string): Promise<RawJob[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('APIFY_TOKEN is not set');

  const client = new ApifyClient({ token });

  console.log(`  [glassdoor] Scraping "${keywords.join(' OR ')}" @ ${location}...`);

  const run = await client.actor('bebity/glassdoor-jobs-scraper').call({
    keyword: keywords.join(' OR '),
    location,
    maxItems: 100,
  });

  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  return items as RawJob[];
}
