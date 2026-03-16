# Component Spec: Resume Tailoring Agent

**Files:** `src/tailoring/`
**Phase:** 2
**Depends on:** Matching Agent output, `docx` or `docxtemplater` npm package, LLM API

---

## Purpose

Takes a job that has been scored as "apply" and generates a tailored version of your resume for that specific job. The LLM rewrites your bullet points to match the job description keywords, highlights the most relevant experience, and outputs a `.docx` file ready to upload.

---

## Inputs

- Jobs with `status = 'matched'` from SQLite
- Master resume text (`data/resumes/master_resume.txt`)
- Base resume for the relevant role (`data/resumes/base/` folder)
- Full job description from DB
- Tailoring prompt template (`prompts/tailoring-prompt.md`)

## Outputs

- `data/resumes/generated/{company}_{title}_{jobId}.docx`
- DB updated: `resume_version`, `status = 'resume_generated'`

---

## How the Resume System Works

You maintain three layers:

```
master_resume.txt / .docx
    Everything you've ever done. Source of truth.
    Never sent to employers directly.

data/resumes/base/
    ├── backend_engineer_base.docx
    ├── data_engineer_base.docx
    └── fullstack_engineer_base.docx
    Role-scoped versions of your master resume.
    Pre-trimmed to the right length and focus.
    These are the starting point for tailoring.

data/resumes/generated/
    ├── Databricks_Data_Engineer_A3B2.docx
    ├── Stripe_Backend_Engineer_X9K1.docx
    These are the job-specific tailored versions.
    One per application. Never reused.
```

The matching agent's `recommended_base_resume` field tells this component which base resume to start from.

---

## Files

### `src/tailoring/keyword-mapper.ts`

Extracts the important keywords from the JD and checks which ones your base resume already covers.

```typescript
export interface KeywordReport {
  jd_keywords: string[];
  covered: string[];
  missing: string[];
  coverage_percent: number;
}

export async function mapKeywords(jdText: string, resumeText: string): Promise<KeywordReport> {
  // Use LLM to extract keywords from JD and check coverage
  // Returns structured keyword gap analysis
  // See prompts/tailoring-prompt.md for the full prompt
}
```

---

### `src/tailoring/bullet-rewriter.ts`

The core of tailoring: rewrites or generates resume bullets to match JD keywords without making false claims.

```typescript
export interface RewriteRequest {
  original_bullet: string;
  jd_context: string;   // relevant section of the JD
  target_keywords: string[];
}

export interface RewriteResult {
  rewritten_bullet: string;
  keywords_incorporated: string[];
  warning?: string;   // e.g. "could not naturally incorporate 'Kafka' — no evidence in resume"
}

export async function rewriteBullet(req: RewriteRequest): Promise<RewriteResult> {
  // Call LLM with specific rewrite instruction
  // Key constraint: never add experience that isn't in the original bullet
  // Only rephrase, reorder, and emphasize what's already there
}
```

---

### `src/tailoring/resume-builder.ts`

Assembles the final `.docx` file from the tailored bullets.

```typescript
import { Document, Paragraph, TextRun, HeadingLevel, Packer } from 'docx';
import fs from 'fs';
import path from 'path';
import { updateJobStatus } from '../queue/db';

export interface TailoredResume {
  job: JobRecord;
  tailored_sections: ResumeSection[];
  keyword_report: KeywordReport;
}

export async function buildResume(tailored: TailoredResume): Promise<string> {
  const { job, tailored_sections } = tailored;

  // Build docx structure
  const doc = new Document({
    sections: [{
      properties: {},
      children: tailored_sections.flatMap(section => [
        new Paragraph({
          text: section.heading,
          heading: HeadingLevel.HEADING_2,
        }),
        ...section.bullets.map(bullet =>
          new Paragraph({
            text: bullet,
            bullet: { level: 0 },
          })
        ),
      ]),
    }],
  });

  // Generate filename
  const safeName = (str: string) => str.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
  const filename = `${safeName(job.company)}_${safeName(job.title)}_${job.job_id}.docx`;
  const outputPath = path.resolve(__dirname, `../../data/resumes/generated/${filename}`);

  // Write file
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);

  // Update DB
  updateJobStatus(job.job_id, 'resume_generated', {
    resume_version: filename,
  });

  console.log(`Resume generated: ${filename}`);
  return outputPath;
}
```

---

### `src/tailoring/run-tailoring.ts`

Orchestrates the full tailoring pipeline for all matched jobs.

```typescript
import { db } from '../queue/db';
import { mapKeywords } from './keyword-mapper';
import { buildResume } from './resume-builder';
import fs from 'fs';
import path from 'path';

export async function runTailoringAgent(): Promise<void> {
  const jobs = db.prepare("SELECT * FROM jobs WHERE status = 'matched'").all() as JobRecord[];
  console.log(`Tailoring resumes for ${jobs.length} matched jobs...`);

  const masterResume = fs.readFileSync(
    path.resolve(__dirname, '../../data/resumes/master_resume.txt'), 'utf-8'
  );

  for (const job of jobs) {
    try {
      // Select base resume
      const baseResumePath = path.resolve(
        __dirname, `../../data/resumes/base/${job.recommended_base_resume ?? 'backend_engineer_base'}.txt`
      );
      const baseResume = fs.existsSync(baseResumePath)
        ? fs.readFileSync(baseResumePath, 'utf-8')
        : masterResume;

      // Run keyword mapping
      const keywordReport = await mapKeywords(job.description, baseResume);
      console.log(`[${job.company}] coverage: ${keywordReport.coverage_percent}%`);

      // Build tailored resume
      await buildResume({
        job,
        tailored_sections: [],   // populated inside buildResume via LLM
        keyword_report: keywordReport,
      });

    } catch (err) {
      console.error(`Tailoring failed for ${job.job_id}:`, err);
    }
  }
}
```

---

## Key Constraint: No Hallucination

The most important rule in the tailoring prompt is:

> **Only rephrase what is already in the resume. Never add experience, tools, or skills that are not already present.**

The LLM is explicitly told to flag any keyword it cannot naturally incorporate as a warning. Those warnings are saved to the keyword report.

---

## Vibe Coding Prompt

```
Build the resume tailoring agent for a job application bot in Node.js + TypeScript.

Files:
- src/tailoring/keyword-mapper.ts — calls LLM to extract keywords from a JD and check which
  ones are covered in the base resume. Returns KeywordReport with covered, missing, coverage_percent.

- src/tailoring/bullet-rewriter.ts — takes individual resume bullets and rewrites them
  to incorporate target keywords, without fabricating experience. Uses LLM.
  Returns rewritten_bullet + keywords_incorporated + optional warning.

- src/tailoring/resume-builder.ts — assembles a .docx file using the 'docx' npm package.
  Takes tailored bullet sections and outputs a formatted resume file to data/resumes/generated/.
  Filename format: Company_Title_JobId.docx
  Updates SQLite: sets resume_version and status = 'resume_generated'.

- src/tailoring/run-tailoring.ts — reads all jobs with status='matched' from SQLite,
  runs the full tailoring pipeline for each, handles errors per-job without stopping the batch.

Use the 'docx' npm package for Word file generation.
Use @anthropic-ai/sdk for LLM calls.
Prompt templates live in prompts/tailoring-prompt.md.
Never hallucinate skills — LLM must only rephrase existing content.
```

---

## Integration Points

- **Reads from:** SQLite `jobs` table where `status = 'matched'`
- **Reads:** `data/resumes/master_resume.txt` and `data/resumes/base/*.txt`
- **Reads:** `prompts/tailoring-prompt.md`
- **Writes to:** `data/resumes/generated/*.docx`
- **Writes to:** SQLite: `resume_version`, `status = 'resume_generated'`
- **Feeds:** Application Controller (reads `status = 'resume_generated'` or `'ready_to_apply'`)
