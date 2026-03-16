import settings from '../../config/settings.json';
import type { JobRecord } from '../queue/db';

export interface RuleResult {
  pass: boolean;
  reason?: string;
}

const CORE_SKILLS = [
  'python', 'javascript', 'typescript', 'node.js', 'nodejs', 'react',
  'fastapi', 'flask', 'aws', 'kubernetes', 'docker', 'sql', ' go ',
  'golang', 'redis', 'kafka', 'langchain', 'rag', 'postgresql', 'postgres',
  'mongodb',
];

export function applyHardRules(job: JobRecord): RuleResult {
  const desc  = ((job.description ?? '') + ' ' + job.title).toLowerCase();
  const loc   = (job.location ?? '').toLowerCase();
  const isRemote = desc.includes('remote') || loc.includes('remote');

  // ── 1. Location: must be US or remote ──────────────────────────────────────
  if (!isRemote) {
    const isUS =
      loc.includes('united states') ||
      loc.includes(', us') ||
      loc.includes(', usa') ||
      /,\s*[a-z]{2}(\s|$)/.test(loc); // matches ", TX", ", NY" etc.

    if (!isUS) {
      return { pass: false, reason: `Location not US or remote: ${job.location}` };
    }
  }

  // ── 2. Security clearance ──────────────────────────────────────────────────
  const clearancePhrases = [
    'security clearance', 'clearance required', 'ts/sci', 'top secret',
    'secret clearance', 'active clearance', 'dod clearance',
  ];
  for (const phrase of clearancePhrases) {
    if (desc.includes(phrase)) {
      return { pass: false, reason: `Clearance required: "${phrase}"` };
    }
  }

  // ── 3. US citizenship required ─────────────────────────────────────────────
  const citizenshipPhrases = [
    'must be us citizen', 'us citizens only', 'citizenship required',
    'must be a us citizen', 'requires us citizenship', 'us citizenship required',
    'must be an american citizen',
  ];
  for (const phrase of citizenshipPhrases) {
    if (desc.includes(phrase)) {
      return { pass: false, reason: `Citizenship required: "${phrase}"` };
    }
  }

  // ── 4. Explicit no-sponsorship (only reject if explicitly stated) ──────────
  const noSponsorPhrases = [
    'no sponsorship', 'will not sponsor', 'cannot sponsor',
    'does not sponsor', 'not able to sponsor', 'unable to sponsor',
    'no visa sponsorship', 'sponsorship is not available',
  ];
  for (const phrase of noSponsorPhrases) {
    if (desc.includes(phrase)) {
      return { pass: false, reason: `No sponsorship: "${phrase}"` };
    }
  }

  // ── 5. Requires 5+ years experience ───────────────────────────────────────
  const maxYears = (settings.job_preferences as { max_years_experience_required?: number })
    .max_years_experience_required ?? 5;
  const yearsMatch = (job.description ?? '').match(/(\d+)\+?\s*years?\s+(of\s+)?(relevant\s+|professional\s+)?experience/i);
  if (yearsMatch) {
    const required = parseInt(yearsMatch[1]);
    if (required > maxYears) {
      return { pass: false, reason: `Requires ${required}+ years experience (max: ${maxYears})` };
    }
  }

  // ── 6. Zero core skill matches ─────────────────────────────────────────────
  const hasSkillMatch = CORE_SKILLS.some(skill => desc.includes(skill));
  if (!hasSkillMatch) {
    return { pass: false, reason: 'No core skill match in JD' };
  }

  return { pass: true };
}
