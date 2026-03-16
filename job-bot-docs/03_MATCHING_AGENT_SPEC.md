# Component Spec: Matching Agent

**Files:** `src/matching/`
**Phase:** 2
**Depends on:** DB queue, LLM API (Anthropic or OpenAI), `config/settings.json`

---

## Purpose

The matching agent reads each unscored job from the DB, sends the job description and your master resume to an LLM, and gets back a fit score, a decision (apply/skip/review), and reasoning. It also applies hard rules (visa, location, blacklist) before even calling the LLM, to save API costs.

---

## Inputs

- Jobs with `status = 'new'` from SQLite
- Master resume text (read from `data/resumes/master_resume.docx` or a `.txt` version)
- User preferences from `config/settings.json`
- Blacklist from `config/blacklist.json`

## Outputs

- Updated DB rows: `fit_score`, `fit_decision`, `fit_reasoning`, `status`
- Status transitions:
  - High score → `status = 'matched'`
  - Low score → `status = 'skipped'`
  - Needs review → `status = 'review'`

---

## Files

### `src/matching/rules.ts`

Hard rules that reject or flag a job before any LLM call. Fast and cheap.

```typescript
import settings from '../../config/settings.json';
import blacklist from '../../config/blacklist.json';

export interface RuleResult {
  pass: boolean;
  reason?: string;
}

export function applyHardRules(job: JobRecord): RuleResult {
  const desc = (job.description + ' ' + job.title).toLowerCase();

  // Check blacklist keywords
  for (const word of blacklist.keywords) {
    if (desc.includes(word.toLowerCase())) {
      return { pass: false, reason: `Blacklist keyword: "${word}"` };
    }
  }

  // Check blacklist companies
  for (const company of blacklist.companies) {
    if (job.company.toLowerCase().includes(company.toLowerCase())) {
      return { pass: false, reason: `Blacklist company: "${company}"` };
    }
  }

  // Visa rule: if sponsorship required, check description doesn't say "must be authorized"
  if (settings.job_preferences.visa_sponsorship_required) {
    const noSponsorPhrases = [
      'must be authorized to work',
      'no visa sponsorship',
      'us citizen or permanent resident only',
      'security clearance required',
    ];
    for (const phrase of noSponsorPhrases) {
      if (desc.includes(phrase)) {
        return { pass: false, reason: `No sponsorship: "${phrase}"` };
      }
    }
  }

  // Location rule: if not remote-friendly and location doesn't match
  if (!desc.includes('remote') && settings.job_preferences.relocation_open === false) {
    const matchesTargetLocation = settings.job_preferences.target_locations
      .some(loc => job.location.toLowerCase().includes(loc.toLowerCase()));
    if (!matchesTargetLocation) {
      return { pass: false, reason: `Location mismatch: ${job.location}` };
    }
  }

  return { pass: true };
}
```

---

### `src/matching/jd-parser.ts`

Extracts structured requirements from a raw job description using regex + simple heuristics. This is a pre-processing step before the LLM call to reduce token count.

```typescript
export interface ParsedJD {
  required_skills: string[];
  preferred_skills: string[];
  years_experience: number | null;
  education_requirement: string | null;
  employment_type: string | null;  // 'full-time' | 'contract' | 'part-time'
  remote_policy: string | null;    // 'remote' | 'hybrid' | 'onsite'
  summary: string;                 // first 500 chars of JD for LLM
}

export function parseJD(description: string): ParsedJD {
  const lower = description.toLowerCase();

  // Extract remote policy
  let remote_policy: string | null = null;
  if (lower.includes('fully remote') || lower.includes('100% remote')) remote_policy = 'remote';
  else if (lower.includes('hybrid')) remote_policy = 'hybrid';
  else if (lower.includes('on-site') || lower.includes('onsite') || lower.includes('in-office')) remote_policy = 'onsite';

  // Extract years of experience
  const yearsMatch = description.match(/(\d+)\+?\s*years? of experience/i);
  const years_experience = yearsMatch ? parseInt(yearsMatch[1]) : null;

  // Extract employment type
  let employment_type: string | null = null;
  if (lower.includes('full-time') || lower.includes('full time')) employment_type = 'full-time';
  else if (lower.includes('contract')) employment_type = 'contract';
  else if (lower.includes('part-time')) employment_type = 'part-time';

  return {
    required_skills: [],   // LLM will handle this — too complex for regex
    preferred_skills: [],
    years_experience,
    education_requirement: null,
    employment_type,
    remote_policy,
    summary: description.slice(0, 800),
  };
}
```

---

### `src/matching/scorer.ts`

The main LLM scoring call. Reads the matching prompt template and calls the API.

```typescript
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { updateJobStatus, db } from '../queue/db';
import { applyHardRules } from './rules';
import { parseJD } from './jd-parser';
import settings from '../../config/settings.json';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MASTER_RESUME = fs.readFileSync(
  path.resolve(__dirname, '../../data/resumes/master_resume.txt'), 'utf-8'
);

const PROMPT_TEMPLATE = fs.readFileSync(
  path.resolve(__dirname, '../../prompts/matching-prompt.md'), 'utf-8'
);

export interface ScoreResult {
  fit_score: number;           // 0-100
  decision: 'apply' | 'skip' | 'review';
  reasoning: string;
  missing_requirements: string[];
  keyword_matches: string[];
  recommended_base_resume: string;
}

export async function scoreJob(job: JobRecord): Promise<ScoreResult> {
  // Step 1: apply hard rules first (free)
  const ruleResult = applyHardRules(job);
  if (!ruleResult.pass) {
    return {
      fit_score: 0,
      decision: 'skip',
      reasoning: ruleResult.reason ?? 'Failed hard rule',
      missing_requirements: [],
      keyword_matches: [],
      recommended_base_resume: '',
    };
  }

  // Step 2: parse JD for structured fields
  const parsed = parseJD(job.description);

  // Step 3: build the prompt
  const prompt = PROMPT_TEMPLATE
    .replace('{{JOB_TITLE}}', job.title)
    .replace('{{COMPANY}}', job.company)
    .replace('{{LOCATION}}', job.location)
    .replace('{{JD}}', job.description.slice(0, 3000))  // truncate very long JDs
    .replace('{{MASTER_RESUME}}', MASTER_RESUME)
    .replace('{{PREFERENCES}}', JSON.stringify(settings.job_preferences, null, 2));

  // Step 4: call LLM
  const response = await client.messages.create({
    model: settings.llm.model,
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  // Step 5: parse JSON from response
  const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
  if (!jsonMatch) throw new Error('LLM did not return valid JSON block');

  return JSON.parse(jsonMatch[1]) as ScoreResult;
}

export async function runMatchingAgent(): Promise<void> {
  const jobs = db.prepare("SELECT * FROM jobs WHERE status = 'new'").all() as JobRecord[];
  console.log(`Scoring ${jobs.length} new jobs...`);

  for (const job of jobs) {
    try {
      const result = await scoreJob(job);
      const newStatus = result.decision === 'apply' ? 'matched' : 'skipped';

      updateJobStatus(job.job_id, newStatus, {
        fit_score: result.fit_score,
        fit_decision: result.decision,
        fit_reasoning: result.reasoning,
      });

      console.log(`[${job.company}] ${job.title} → score: ${result.fit_score} → ${result.decision}`);
    } catch (err) {
      console.error(`Failed to score job ${job.job_id}:`, err);
    }
  }
}
```

---

## Scoring Logic

The LLM returns a score from 0–100. Your config drives what happens next:

| Score range | Action |
|---|---|
| ≥ `auto_apply_threshold` (default 85) | `status = 'matched'`, proceed to tailoring automatically |
| ≥ `min_fit_score_to_apply` (default 70) | `status = 'matched'`, but mark for manual review first |
| < 70 | `status = 'skipped'` |

---

## Vibe Coding Prompt

```
Build the matching agent for a job application bot in Node.js + TypeScript.

Files:
- src/matching/rules.ts — applies hard rules (visa/blacklist/location) before any LLM call.
  Returns { pass: boolean, reason?: string }. Reads from config/settings.json and config/blacklist.json.

- src/matching/jd-parser.ts — extracts structured fields from a raw JD string:
  remote_policy, employment_type, years_experience. Returns ParsedJD interface.

- src/matching/scorer.ts — sends job description + master resume to Anthropic Claude API,
  gets back a JSON response: { fit_score, decision, reasoning, missing_requirements,
  keyword_matches, recommended_base_resume }. Runs hard rules first before LLM.
  Exports runMatchingAgent() which processes all jobs with status='new' from SQLite.

Use @anthropic-ai/sdk. Prompt template is in prompts/matching-prompt.md.
Master resume text is in data/resumes/master_resume.txt.
Update job status in SQLite after scoring: 'matched' or 'skipped'.
Handle LLM errors gracefully — log and continue to next job.
```

---

## Integration Points

- **Reads from:** SQLite `jobs` table where `status = 'new'`
- **Reads:** `data/resumes/master_resume.txt`
- **Reads:** `prompts/matching-prompt.md`
- **Reads:** `config/settings.json`, `config/blacklist.json`
- **Writes to:** SQLite: `fit_score`, `fit_decision`, `fit_reasoning`, `status`
- **Feeds:** Resume Tailoring Agent (which reads `status = 'matched'`)
