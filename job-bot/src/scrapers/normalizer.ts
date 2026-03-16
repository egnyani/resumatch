// ─── Shared NormalizedJob shape ──────────────────────────────────────────────

export interface NormalizedJob {
  title: string;
  company: string;
  location: string;
  description: string;
  source_site: string;   // 'indeed' | 'linkedin' | 'glassdoor' | 'greenhouse' | 'lever' | 'ashby'
  source_link: string;   // link to the job posting page
  apply_url: string;     // direct apply link if available
  salary_min: number | null;
  salary_max: number | null;
  posted_date: string | null;  // ISO date string
  dedupe_hash?: string;        // filled in by dedupe step
  ats_platform?: string;       // filled in by classifier step
  raw: object;                 // full original object for debugging
}

// ─── Salary parser ───────────────────────────────────────────────────────────

function parseSalary(raw: unknown): { min: number; max: number } | null {
  if (!raw) return null;
  const str = String(raw).replace(/,/g, '');
  const nums = str.match(/\d+(\.\d+)?/g);
  if (!nums) return null;
  if (nums.length === 1) {
    const n = Math.round(parseFloat(nums[0]));
    return { min: n, max: n };
  }
  return { min: Math.round(parseFloat(nums[0])), max: Math.round(parseFloat(nums[1])) };
}

// ─── Indeed ──────────────────────────────────────────────────────────────────

export function normalizeIndeedJob(raw: Record<string, unknown>): NormalizedJob {
  return {
    title:       (raw.positionName as string)     ?? '',
    company:     (raw.company as string)           ?? '',
    location:    (raw.location as string)          ?? '',
    description: (raw.description as string)       ?? '',
    source_site: 'indeed',
    source_link: (raw.url as string)               ?? '',
    apply_url:   (raw.externalApplyLink as string) ?? (raw.url as string) ?? '',
    salary_min:  parseSalary(raw.salary)?.min      ?? null,
    salary_max:  parseSalary(raw.salary)?.max      ?? null,
    posted_date: (raw.postedAt as string)          ?? null,
    raw,
  };
}

// ─── LinkedIn ────────────────────────────────────────────────────────────────

export function normalizeLinkedinJob(raw: Record<string, unknown>): NormalizedJob {
  return {
    title:       (raw.title as string)        ?? '',
    company:     (raw.companyName as string)  ?? '',
    location:    (raw.location as string)     ?? '',
    description: (raw.description as string)  ?? '',
    source_site: 'linkedin',
    source_link: (raw.jobUrl as string)       ?? '',
    apply_url:   (raw.applyUrl as string)     ?? (raw.jobUrl as string) ?? '',
    salary_min:  parseSalary(raw.salary)?.min ?? null,
    salary_max:  parseSalary(raw.salary)?.max ?? null,
    posted_date: (raw.postedAt as string)     ?? null,
    raw,
  };
}

// ─── Glassdoor ───────────────────────────────────────────────────────────────

export function normalizeGlassdoorJob(raw: Record<string, unknown>): NormalizedJob {
  return {
    title:       (raw.jobTitle as string)       ?? '',
    company:     (raw.employer as string)       ?? '',
    location:    (raw.location as string)       ?? '',
    description: (raw.jobDescription as string) ?? '',
    source_site: 'glassdoor',
    source_link: (raw.jobLink as string)        ?? '',
    apply_url:   (raw.applyUrl as string)       ?? (raw.jobLink as string) ?? '',
    salary_min:  parseSalary(raw.salaryEstimate)?.min ?? null,
    salary_max:  parseSalary(raw.salaryEstimate)?.max ?? null,
    posted_date: (raw.datePosted as string)     ?? null,
    raw,
  };
}

// ─── Greenhouse ──────────────────────────────────────────────────────────────

export function normalizeGreenhouseJob(raw: Record<string, unknown>): NormalizedJob {
  return {
    title:       (raw.title as string)              ?? '',
    company:     (raw.company as string)             ?? '',
    location:    (raw.location as string)            ?? '',
    description: (raw.content as string)             ?? '',
    source_site: 'greenhouse',
    source_link: (raw.absolute_url as string)        ?? '',
    apply_url:   (raw.absolute_url as string)        ?? '',
    salary_min:  null,
    salary_max:  null,
    posted_date: (raw.updated_at as string)          ?? null,
    raw,
  };
}

// ─── Lever ───────────────────────────────────────────────────────────────────

export function normalizeLeverJob(raw: Record<string, unknown>): NormalizedJob {
  const text = raw.text as string ?? '';
  const applyUrl = `https://jobs.lever.co/${raw.company as string ?? ''}/${raw.id as string ?? ''}`;
  return {
    title:       text,
    company:     (raw.company as string)  ?? '',
    location:    ((raw.categories as Record<string, string>)?.location) ?? '',
    description: (raw.descriptionPlain as string) ?? (raw.description as string) ?? '',
    source_site: 'lever',
    source_link: (raw.hostedUrl as string) ?? applyUrl,
    apply_url:   (raw.applyUrl as string)  ?? applyUrl,
    salary_min:  null,
    salary_max:  null,
    posted_date: raw.createdAt
      ? new Date(raw.createdAt as number).toISOString()
      : null,
    raw,
  };
}

// ─── Ashby ───────────────────────────────────────────────────────────────────

export function normalizeAshbyJob(raw: Record<string, unknown>): NormalizedJob {
  return {
    title:       (raw.title as string)    ?? '',
    company:     (raw.company as string)  ?? '',
    location:    (raw.locationName as string) ?? '',
    description: (raw.descriptionHtml as string) ?? (raw.description as string) ?? '',
    source_site: 'ashby',
    source_link: (raw.jobUrl as string)   ?? '',
    apply_url:   (raw.jobUrl as string)   ?? '',
    salary_min:  null,
    salary_max:  null,
    posted_date: (raw.publishedDate as string) ?? null,
    raw,
  };
}
