/**
 * Ashby scraper — uses Ashby's public API endpoint.
 * Jobs are at: https://jobs.ashbyhq.com/api/non-user-graphql
 * using the listJobPostingsWithContent query.
 *
 * Pass company slugs (as shown in the Ashby job board URL).
 */
import type { RawJob } from './indeed';

const ASHBY_QUERY = `
  query listJobPostingsWithContent($organizationHostedJobsPageName: String!) {
    jobBoard: jobBoardWithJobPostings(
      organizationHostedJobsPageName: $organizationHostedJobsPageName
    ) {
      jobPostings {
        id
        title
        locationName
        descriptionHtml
        publishedDate
        jobUrl: jobPostingUrl
      }
    }
  }
`;

async function fetchAshbyJobs(companySlug: string): Promise<RawJob[]> {
  const res = await fetch('https://jobs.ashbyhq.com/api/non-user-graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operationName: 'listJobPostingsWithContent',
      query: ASHBY_QUERY,
      variables: { organizationHostedJobsPageName: companySlug },
    }),
  });

  if (!res.ok) {
    console.warn(`  [ashby] ${companySlug} returned ${res.status} — skipping`);
    return [];
  }

  const data = await res.json() as {
    data?: {
      jobBoard?: {
        jobPostings?: RawJob[];
      };
    };
  };

  const postings = data?.data?.jobBoard?.jobPostings ?? [];
  return postings.map(job => ({ ...job, company: companySlug }));
}

export async function scrapeAshby(
  _keywords: string[],
  _location: string,
  companySlugs: string[] = []
): Promise<RawJob[]> {
  if (companySlugs.length === 0) {
    console.log('  [ashby] No company slugs provided — skipping');
    return [];
  }

  console.log(`  [ashby] Fetching jobs from ${companySlugs.length} companies...`);
  const results = await Promise.allSettled(companySlugs.map(fetchAshbyJobs));

  const jobs: RawJob[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') jobs.push(...r.value);
  }
  return jobs;
}
