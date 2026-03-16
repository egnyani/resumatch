/**
 * resume-builder.ts
 * Calls scripts/build_resume.py to fill template.docx with proper OOXML formatting
 * (bold names, tab-aligned dates, ListParagraph bullets, bold skill labels).
 * Outputs data/resumes/generated/Company_Title_JobId.docx
 */

import { execSync } from 'child_process';
import { writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import { updateJobStatus } from '../queue/db';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TailoredContent {
  summary: string;
  experience: Array<{
    company: string;
    role: string;
    dates: string;
    location: string;
    bullets: string[];
  }>;
  education: Array<{
    degree: string;
    school: string;
    dates: string;
    details?: string;
  }>;
  skills: {
    languages?: string;
    frameworks?: string;
    databases?: string;
    cloud_devops?: string;
    tools?: string;
  };
  projects: Array<{
    name: string;
    date?: string;
    bullets: string[];
  }>;
  keyword_coverage?: {
    covered: string[];
    warnings: Array<{ keyword: string; reason: string }>;
  };
  coverage_percent?: number;
}

// ─── Safe filename helper ─────────────────────────────────────────────────────

function safeName(str: string): string {
  return str.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').slice(0, 30).replace(/_$/, '');
}

// ─── Main builder ─────────────────────────────────────────────────────────────

export interface BuildResumeOptions {
  jobId: string;
  company: string;
  title: string;
  candidateName?: string;
  tailored: TailoredContent;
}

export async function buildResume(opts: BuildResumeOptions): Promise<string> {
  const { jobId, company, title, tailored } = opts;
  const candidateName = opts.candidateName ?? 'GNYANI ENUGANDULA';

  const templatePath = resolve(__dirname, '../../data/resumes/base/template.docx');
  if (!existsSync(templatePath)) {
    throw new Error(`Template not found at ${templatePath}`);
  }

  const scriptPath  = resolve(__dirname, '../../scripts/build_resume.py');
  const outputDir   = resolve(__dirname, '../../data/resumes/generated');
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const filename   = `${safeName(company)}_${safeName(title)}_${jobId}.docx`;
  const outputPath = resolve(outputDir, filename);

  // Write payload JSON to a temp file
  const tempJson = resolve(outputDir, `._tmp_${jobId}.json`);
  const payload = { name: candidateName, ...tailored };
  writeFileSync(tempJson, JSON.stringify(payload, null, 2), 'utf-8');

  try {
    // Call Python builder
    const result = execSync(
      `python3 "${scriptPath}" "${tempJson}" "${templatePath}" "${outputPath}"`,
      { encoding: 'utf-8', timeout: 30000 }
    ).trim();

    if (!result.startsWith('OK:')) {
      throw new Error(`build_resume.py unexpected output: ${result}`);
    }
  } finally {
    // Clean up temp JSON (best-effort)
    try { if (existsSync(tempJson)) unlinkSync(tempJson); } catch {}
  }

  const sizeKb = Math.round(require('fs').statSync(outputPath).size / 1024);

  // Update DB
  updateJobStatus(jobId, 'resume_generated', { resume_version: filename });

  console.log(`  ✓ Resume: ${filename}  (${sizeKb}KB)`);
  if (tailored.coverage_percent !== undefined) {
    console.log(`    Keyword coverage: ${tailored.coverage_percent}%`);
  }
  if (tailored.keyword_coverage?.warnings?.length) {
    for (const w of tailored.keyword_coverage.warnings) {
      console.log(`    ⚠ Could not incorporate "${w.keyword}": ${w.reason}`);
    }
  }

  return outputPath;
}
