/**
 * form-filler.ts
 * Playwright-based form filling. Handles text, select, checkbox, radio, and file inputs.
 * Escalates to Telegram when a question can't be resolved from profile/memory.
 */
import { Page, ElementHandle } from 'playwright';
import { resolveQuestion } from './question-handler';
import { sendInterrupt } from '../interrupt/telegram-bot';
import { normalizeAndSave } from '../interrupt/answer-normalizer';
import type { JobRecord } from '../queue/db';

export type FillResult = 'completed' | 'paused' | 'failed';

export async function fillForm(page: Page, job: JobRecord): Promise<FillResult> {
  // Get all visible, enabled input fields
  const fields = await page.$$('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea');

  for (const field of fields) {
    try {
      const isVisible = await field.isVisible();
      const isDisabled = await field.isDisabled();
      if (!isVisible || isDisabled) continue;

      const label = await getLabelText(page, field);
      if (!label) continue;

      const fieldType = (await field.getAttribute('type') ?? 'text') as 'text' | 'select' | 'radio' | 'checkbox' | 'file';

      // Skip file inputs here — resume upload is handled separately in worker.ts
      if (fieldType === 'file') continue;

      // Get select options if applicable
      const tagName = await field.evaluate((el: Element) => el.tagName.toLowerCase());
      let options: string[] | undefined;
      if (tagName === 'select') {
        options = await field.$$eval('option', (opts: HTMLOptionElement[]) =>
          opts.map(o => o.text).filter(t => t.trim())
        );
      }

      const resolution = await resolveQuestion(label, fieldType, options);

      if (resolution.type === 'profile' || resolution.type === 'memory') {
        const source = resolution.type === 'profile' ? 'profile' : `memory(${resolution.confidence.toFixed(2)})`;
        console.log(`    [${source}] "${label}" → "${resolution.value}"`);
        await fillField(field, resolution.value, fieldType, tagName, options);

      } else {
        // Escalate to Telegram
        console.log(`    [interrupt] "${label}" — escalating to Telegram`);
        const reply = await sendInterrupt(
          { job_id: job.job_id, company: job.company, title: job.title },
          label,
          fieldType,
          options
        );

        if (reply === null) {
          // Timeout — pause this application
          console.log(`    Timeout waiting for reply — pausing application`);
          return 'paused';
        }

        await fillField(field, reply, fieldType, tagName, options);

        // Save to memory for future reuse (fire-and-forget)
        normalizeAndSave(label, reply, {
          job_id:  job.job_id,
          company: job.company,
          title:   job.title,
        }).catch(err => console.warn('[normalizer]', err.message));
      }

      // Small delay between fields to appear human-like
      await page.waitForTimeout(300 + Math.random() * 400);

    } catch (err) {
      console.warn(`    [form-filler] Error on field:`, (err as Error).message);
      // Continue to next field — don't abort the whole form
    }
  }

  return 'completed';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fillField(
  field: ElementHandle,
  value: string,
  type: string,
  tagName: string,
  options?: string[]
): Promise<void> {
  if (tagName === 'select') {
    // Try to match by value text or option number
    const optionIndex = parseInt(value, 10);
    if (!isNaN(optionIndex) && options && options[optionIndex - 1]) {
      await field.selectOption({ label: options[optionIndex - 1] });
    } else {
      await field.selectOption({ label: value }).catch(() =>
        field.selectOption(value) // fallback: match by value attribute
      );
    }
  } else if (type === 'checkbox') {
    const shouldCheck = /yes|true|1/i.test(value);
    const isChecked = await (field as any).isChecked();
    if (shouldCheck !== isChecked) await (field as any).click();
  } else if (type === 'radio') {
    await (field as any).check();
  } else {
    // text / textarea / email / tel / number
    await field.click();
    await field.fill('');         // clear first
    await field.type(value, { delay: 40 + Math.random() * 30 }); // human-like typing speed
  }
}

async function getLabelText(page: Page, field: ElementHandle): Promise<string | null> {
  // Strategy 1: aria-label attribute
  const ariaLabel = await field.getAttribute('aria-label');
  if (ariaLabel?.trim()) return ariaLabel.trim();

  // Strategy 2: <label for="fieldId">
  const fieldId = await field.getAttribute('id');
  if (fieldId) {
    const labelEl = await page.$(`label[for="${fieldId}"]`);
    if (labelEl) {
      const text = await labelEl.textContent();
      if (text?.trim()) return text.trim();
    }
  }

  // Strategy 3: closest wrapping <label>
  const parentLabel = await field.evaluate((el: Element) => {
    let node: Element | null = el;
    while (node) {
      if (node.tagName === 'LABEL') return node.textContent?.trim() ?? null;
      node = node.parentElement;
    }
    return null;
  });
  if (parentLabel) return parentLabel;

  // Strategy 4: placeholder text
  const placeholder = await field.getAttribute('placeholder');
  if (placeholder?.trim()) return placeholder.trim();

  // Strategy 5: name attribute (last resort)
  const name = await field.getAttribute('name');
  if (name?.trim()) return name.replace(/[-_]/g, ' ').trim();

  return null;
}
