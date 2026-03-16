/**
 * worker.ts
 * Main Playwright runner. Handles the full application lifecycle for one job:
 * navigate → upload resume → fill form → screenshot → submit (if policy allows)
 */
import { chromium, Browser } from 'playwright';
import { fillForm } from './form-filler';
import { takeScreenshot } from './session-logger';
import { shouldSubmit, getMode } from '../application/submit-policy';
import { updateJobStatus } from '../queue/db';
import { sendStatusUpdate } from '../interrupt/telegram-bot';
import type { JobRecord } from '../queue/db';
import path from 'path';
import fs from 'fs';

export async function applyToJob(job: JobRecord): Promise<void> {
  let browser: Browser | null = null;

  console.log(`\n[Clawbot] ${job.company} — ${job.title}`);
  console.log(`  URL: ${job.apply_url}`);
  console.log(`  ATS: ${job.ats_platform ?? 'unknown'}`);
  console.log(`  Mode: ${getMode()}`);

  try {
    updateJobStatus(job.job_id, 'applying');

    browser = await chromium.launch({
      headless: false,        // visible window — you can watch every application
      slowMo: 50,             // slight slow-down so fills look human
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    // ── 1. Navigate ──────────────────────────────────────────────────────────
    await takeScreenshot(page, job.job_id, '01_before_navigate');
    await page.goto(job.apply_url ?? '', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(1500); // let JS hydrate
    await takeScreenshot(page, job.job_id, '02_apply_page');

    // ── 2. Upload resume ─────────────────────────────────────────────────────
    if (job.resume_version) {
      const resumePath = path.resolve(
        __dirname, `../../data/resumes/generated/${job.resume_version}`
      );

      if (fs.existsSync(resumePath)) {
        const fileInputs = await page.$$('input[type="file"]');
        for (const input of fileInputs) {
          const isVisible = await input.isVisible().catch(() => false);
          if (isVisible) {
            await input.setInputFiles(resumePath);
            await page.waitForTimeout(1000);
            console.log(`  📎 Resume uploaded: ${job.resume_version}`);
            break;
          }
        }

        // Some ATSes hide the file input — try filechooser event approach
        if (fileInputs.length === 0 || !(await fileInputs[0].isVisible().catch(() => false))) {
          const uploadBtn = page.locator(
            'button:has-text("Upload"), button:has-text("Attach"), button:has-text("Resume")'
          ).first();
          if (await uploadBtn.isVisible().catch(() => false)) {
            const [fileChooser] = await Promise.all([
              page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null),
              uploadBtn.click(),
            ]);
            if (fileChooser) await (fileChooser as any).setFiles(resumePath);
          }
        }

        await takeScreenshot(page, job.job_id, '03_resume_uploaded');
      } else {
        console.warn(`  ⚠ Resume file not found: ${resumePath}`);
      }
    }

    // ── 3. Fill form ─────────────────────────────────────────────────────────
    const fillResult = await fillForm(page, job);
    await takeScreenshot(page, job.job_id, '04_form_filled');

    if (fillResult === 'paused') {
      updateJobStatus(job.job_id, 'needs_answer');
      await sendStatusUpdate(job, 'needs_answer');
      console.log(`  ⏸ Paused — waiting for Telegram reply`);
      return;
    }

    // ── 4. Submit (if policy allows) ─────────────────────────────────────────
    if (shouldSubmit(job.ats_platform ?? null)) {
      await clickSubmit(page);
      await page.waitForTimeout(2000);
      await takeScreenshot(page, job.job_id, '05_submitted');
      updateJobStatus(job.job_id, 'submitted');
      await sendStatusUpdate(job, 'submitted');
      console.log(`  ✅ Submitted!`);
    } else {
      console.log(`  ⏸ Mode is "${getMode()}" — form filled but not submitted`);
      console.log(`     Review the browser window and submit manually if looks good.`);
      // Wait so you can review the filled form
      await page.waitForTimeout(10_000);
      updateJobStatus(job.job_id, 'ready_to_apply');
    }

  } catch (err) {
    const msg = (err as Error).message;
    console.error(`  ❌ Error: ${msg}`);
    updateJobStatus(job.job_id, 'failed', { fit_reasoning: msg });
    await sendStatusUpdate(job, 'failed').catch(() => {});
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

// ─── Submit button detection ──────────────────────────────────────────────────

async function clickSubmit(page: any): Promise<void> {
  const selectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Submit Application")',
    'button:has-text("Submit")',
    'button:has-text("Apply Now")',
    'button:has-text("Apply")',
    'button:has-text("Send Application")',
  ];

  for (const sel of selectors) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      console.log(`  🖱 Clicked submit: "${sel}"`);
      return;
    }
  }

  throw new Error('Could not find a submit button on this page');
}
