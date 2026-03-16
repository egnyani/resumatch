# Component Spec: Clawbot Worker

**Files:** `src/clawbot/`, `src/application/`
**Phase:** 3 (build after intelligence pipeline is working)
**Depends on:** Playwright, profile-memory, answer-store, Human Interrupt layer

---

## Purpose

Clawbot is the browser hands of the system. It opens application pages, fills in known fields, uploads resumes, navigates multi-step forms, takes screenshots, and logs progress. When it encounters a question it cannot answer confidently, it pauses and triggers the human interrupt layer. Clawbot has no decision-making intelligence of its own — it only executes instructions from the application controller.

**Core principle: Clawbot is hands, not brain.**

---

## Inputs

- Job rows from SQLite where `status = 'ready_to_apply'`
- Profile memory from `src/application/profile-memory.ts`
- Answer store from `src/memory/answer-store.ts`
- Tailored resume file path from DB `resume_version` field
- ATS platform tag from DB `ats_platform` field

## Outputs

- Filled and submitted application forms
- Screenshots saved to `data/screenshots/{jobId}/`
- DB status updates throughout execution
- Unresolved questions forwarded to Human Interrupt layer

---

## Files

### `src/application/profile-memory.ts`

Static answers to standard profile questions. These are known and safe to auto-fill.

```typescript
import settings from '../../config/settings.json';

export interface ProfileMemory {
  // Identity
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  linkedin_url: string;
  github_url: string;
  portfolio_url: string;

  // Work authorization
  authorized_to_work: boolean;
  requires_sponsorship: boolean;
  visa_type: string;   // e.g. 'H-1B', 'OPT', 'Green Card'

  // Standard answers
  willing_to_relocate: boolean;
  preferred_work_type: string;   // 'remote' | 'hybrid' | 'onsite'
  salary_expectation_min: number;
  salary_expectation_max: number;
  earliest_start_date: string;   // e.g. '2 weeks'
  years_total_experience: number;
}

export const profile: ProfileMemory = {
  first_name: settings.profile.name.split(' ')[0],
  last_name: settings.profile.name.split(' ').slice(1).join(' '),
  email: settings.profile.email,
  phone: settings.profile.phone,
  // ... load the rest from settings
};
```

---

### `src/clawbot/question-handler.ts`

The decision module for each form field Clawbot encounters. Checks profile memory, then answer store, then escalates.

```typescript
import { profile } from '../application/profile-memory';
import { findAnswer } from '../memory/answer-store';

export type QuestionResolution =
  | { type: 'profile'; value: string | boolean | number }
  | { type: 'memory'; value: string; confidence: number }
  | { type: 'interrupt'; reason: string };

export async function resolveQuestion(
  questionText: string,
  fieldType: 'text' | 'select' | 'radio' | 'checkbox',
  options?: string[]
): Promise<QuestionResolution> {

  // Step 1: try profile fields (exact semantic match)
  const profileAnswer = matchProfileField(questionText, profile);
  if (profileAnswer !== null) {
    return { type: 'profile', value: profileAnswer };
  }

  // Step 2: try answer store (semantic similarity search)
  const memoryAnswer = await findAnswer(questionText, options);
  if (memoryAnswer && memoryAnswer.confidence >= 0.8) {
    return { type: 'memory', value: memoryAnswer.answer, confidence: memoryAnswer.confidence };
  }

  // Step 3: escalate to human
  return {
    type: 'interrupt',
    reason: `Cannot confidently answer: "${questionText}"`,
  };
}

function matchProfileField(question: string, profile: ProfileMemory): string | boolean | number | null {
  const q = question.toLowerCase();

  if (q.includes('first name')) return profile.first_name;
  if (q.includes('last name')) return profile.last_name;
  if (q.includes('email')) return profile.email;
  if (q.includes('phone') || q.includes('mobile')) return profile.phone;
  if (q.includes('linkedin')) return profile.linkedin_url;
  if (q.includes('github')) return profile.github_url;
  if (q.includes('authorized to work') || q.includes('legally authorized')) return profile.authorized_to_work;
  if (q.includes('sponsorship')) return profile.requires_sponsorship;
  if (q.includes('relocat')) return profile.willing_to_relocate;
  if (q.includes('salary') || q.includes('compensation')) return `${profile.salary_expectation_min}-${profile.salary_expectation_max}`;
  if (q.includes('start date') || q.includes('available')) return profile.earliest_start_date;

  return null;
}
```

---

### `src/clawbot/form-filler.ts`

Playwright-based field-filling logic. Handles text inputs, selects, checkboxes, radio buttons, and file uploads.

```typescript
import { Page } from 'playwright';
import { resolveQuestion } from './question-handler';
import { sendInterrupt, waitForInterruptReply } from '../interrupt/telegram-bot';
import { saveAnswer } from '../memory/answer-store';

export async function fillForm(page: Page, job: JobRecord): Promise<'completed' | 'paused' | 'failed'> {
  // Get all visible form fields
  const fields = await page.$$('input, select, textarea');

  for (const field of fields) {
    const label = await getLabelForField(page, field);
    const fieldType = await field.getAttribute('type') ?? 'text';

    if (!label) continue;  // skip unlabeled hidden fields

    const resolution = await resolveQuestion(label, fieldType as any);

    if (resolution.type === 'profile' || resolution.type === 'memory') {
      await fillField(page, field, resolution.value.toString(), fieldType);
    } else {
      // Send interrupt and wait for reply
      const reply = await sendInterrupt(job, label, fieldType);
      if (!reply) return 'paused';  // timeout — pause application

      await fillField(page, field, reply, fieldType);

      // Save answer to memory for future reuse
      await saveAnswer({
        raw_question: label,
        answer: reply,
        job_id: job.job_id,
        company: job.company,
      });
    }
  }

  return 'completed';
}

async function fillField(page: Page, field: any, value: string, type: string): Promise<void> {
  if (type === 'file') {
    // Handled separately by uploadResume()
    return;
  } else if (type === 'checkbox') {
    const checked = value === 'true' || value === 'yes';
    if (checked) await field.check();
  } else if (type === 'radio') {
    await field.check();
  } else {
    await field.fill(value);
  }
}
```

---

### `src/clawbot/worker.ts`

Main Playwright runner. Orchestrates the full application lifecycle for one job.

```typescript
import { chromium, Browser, Page } from 'playwright';
import { fillForm } from './form-filler';
import { takeScreenshot } from './session-logger';
import { updateJobStatus } from '../queue/db';
import { submitPolicy } from '../application/submit-policy';
import path from 'path';

export async function applyToJob(job: JobRecord): Promise<void> {
  let browser: Browser | null = null;

  try {
    updateJobStatus(job.job_id, 'applying');
    browser = await chromium.launch({ headless: false });  // visible window during Phase 3
    const context = await browser.newContext();
    const page = await context.newPage();

    await takeScreenshot(page, job.job_id, '01_start');
    await page.goto(job.apply_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await takeScreenshot(page, job.job_id, '02_apply_page');

    // Upload resume
    const resumePath = path.resolve(__dirname, `../../data/resumes/generated/${job.resume_version}`);
    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.isVisible()) {
      await fileInput.setInputFiles(resumePath);
      await takeScreenshot(page, job.job_id, '03_resume_uploaded');
    }

    // Fill form
    const result = await fillForm(page, job);

    if (result === 'paused') {
      updateJobStatus(job.job_id, 'needs_answer');
      return;
    }

    await takeScreenshot(page, job.job_id, '04_form_filled');

    // Check submit policy
    const shouldSubmit = await submitPolicy(job);
    if (shouldSubmit) {
      await clickSubmit(page);
      await takeScreenshot(page, job.job_id, '05_submitted');
      updateJobStatus(job.job_id, 'submitted');
      console.log(`✓ Submitted: ${job.company} — ${job.title}`);
    } else {
      updateJobStatus(job.job_id, 'ready_to_apply');  // back to queue for manual review
      console.log(`⏸ Paused for review: ${job.company} — ${job.title}`);
    }

  } catch (err) {
    console.error(`Clawbot error for ${job.job_id}:`, err);
    updateJobStatus(job.job_id, 'failed', { notes: String(err) });
  } finally {
    await browser?.close();
  }
}

async function clickSubmit(page: Page): Promise<void> {
  // Try common submit button patterns
  const submitSelectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Submit")',
    'button:has-text("Apply")',
    'button:has-text("Submit Application")',
  ];

  for (const selector of submitSelectors) {
    const btn = page.locator(selector).first();
    if (await btn.isVisible()) {
      await btn.click();
      await page.waitForLoadState('networkidle');
      return;
    }
  }
  throw new Error('Could not find submit button');
}
```

---

### `src/clawbot/session-logger.ts`

Saves screenshots at each step for debugging and audit trail.

```typescript
import { Page } from 'playwright';
import path from 'path';
import fs from 'fs';

export async function takeScreenshot(page: Page, jobId: string, step: string): Promise<void> {
  const dir = path.resolve(__dirname, `../../data/screenshots/${jobId}`);
  fs.mkdirSync(dir, { recursive: true });
  const filepath = path.join(dir, `${step}.png`);
  await page.screenshot({ path: filepath, fullPage: true });
}
```

---

### `src/application/submit-policy.ts`

Decides whether to click submit based on config mode.

```typescript
import settings from '../../config/settings.json';

export async function submitPolicy(job: JobRecord): Promise<boolean> {
  const mode = settings.submission_policy.mode;
  const trustedATS = settings.submission_policy.trusted_ats_platforms;

  if (mode === 'watch_only') return false;
  if (mode === 'prefill_and_wait') return false;
  if (mode === 'safe_auto_submit') {
    return trustedATS.includes(job.ats_platform);
  }
  return false;
}
```

---

## ATS Strategy Notes

Different ATS platforms need slightly different Clawbot strategies. Start with generic form-filling. Add ATS-specific strategies in Phase 5.

| ATS | Known quirks |
|---|---|
| Greenhouse | Standard HTML form — works well with generic filler |
| Lever | Single-page form — mostly reliable |
| Ashby | React SPA — wait for hydration before filling |
| Workday | Multi-step wizard, lots of dynamic loading — most complex |
| Taleo | Very old Java-based UI — slow, needs long waits |
| iCIMS | Dynamic field visibility — check visibility before filling |

---

## Vibe Coding Prompt

```
Build the Clawbot browser worker for a job application bot in Node.js + TypeScript.

Files:
- src/application/profile-memory.ts — static profile object loaded from config/settings.json.
  Contains: name, email, phone, linkedin, visa status, relocation, salary expectations.

- src/clawbot/question-handler.ts — resolves each form question to an answer.
  Priority order: (1) profile memory, (2) SQLite answer store, (3) trigger human interrupt.
  Returns { type: 'profile'|'memory'|'interrupt', value?, confidence? }

- src/clawbot/form-filler.ts — uses Playwright to fill visible form fields on a page.
  Gets label for each field, calls question-handler, fills or escalates.
  Handles: text, select, checkbox, radio, file upload (resume).

- src/clawbot/worker.ts — main Playwright runner for one job.
  Opens apply_url, uploads resume, fills form, takes screenshots, calls submit-policy.
  Updates SQLite status at each step: applying → submitted/failed/needs_answer.
  Use chromium, non-headless during Phase 3 testing.

- src/clawbot/session-logger.ts — saves full-page screenshots to data/screenshots/{jobId}/

- src/application/submit-policy.ts — reads config.submission_policy.mode, returns boolean.
  'watch_only' → never submit. 'prefill_and_wait' → never submit. 'safe_auto_submit' → submit only for trusted_ats_platforms.

Use playwright npm package. All decisions come from question-handler and submit-policy — worker has no LLM calls.
```

---

## Integration Points

- **Reads from:** SQLite `jobs` where `status = 'ready_to_apply'`
- **Reads:** `data/resumes/generated/*.docx`
- **Reads:** `src/application/profile-memory.ts`
- **Reads:** `src/memory/answer-store.ts`
- **Calls:** `src/interrupt/telegram-bot.ts` when question cannot be resolved
- **Writes to:** `data/screenshots/{jobId}/`
- **Writes to:** SQLite: status updates
