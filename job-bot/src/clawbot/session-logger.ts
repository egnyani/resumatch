/**
 * session-logger.ts
 * Saves full-page screenshots at each step for debugging and audit trail.
 * Output: data/screenshots/{jobId}/{step}.png
 */
import { Page } from 'playwright';
import path from 'path';
import fs from 'fs';

export async function takeScreenshot(
  page: Page,
  jobId: string,
  step: string
): Promise<void> {
  const dir = path.resolve(__dirname, `../../data/screenshots/${jobId}`);
  fs.mkdirSync(dir, { recursive: true });

  const filepath = path.join(dir, `${step}.png`);
  await page.screenshot({ path: filepath, fullPage: true });
  console.log(`  📸 Screenshot: ${jobId}/${step}.png`);
}

export function getScreenshotDir(jobId: string): string {
  return path.resolve(__dirname, `../../data/screenshots/${jobId}`);
}
