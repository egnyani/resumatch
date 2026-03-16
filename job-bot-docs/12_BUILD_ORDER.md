# Build Order + Milestones

This document tells you what to build in what order, what to fake manually in early phases, and when to automate. Follow this sequence to avoid building things you'll throw away.

---

## The Golden Rule

> **Get real data flowing before writing smart code.**

A scraper that puts 20 real jobs in a spreadsheet is worth more than a perfectly architected matching agent with no data.

---

## Phase 1 — Foundation (Week 1)

**Goal:** Jobs are flowing into Excel. You can see real data. Nothing is automated yet.

### What to build

1. Create folder structure (`job-bot/` with all subfolders)
2. Set up `package.json`, install all dependencies
3. Write `db/schema.sql`
4. Write `src/queue/db.ts` (SQLite connection + basic CRUD)
5. Write `src/scrapers/apify/indeed.ts` (one scraper only)
6. Write `src/scrapers/normalizer.ts` (map Indeed fields to NormalizedJob)
7. Write `src/scrapers/dedupe.ts`
8. Write `src/scrapers/ats-classifier.ts`
9. Write `src/scrapers/run-scrapers.ts`
10. Write `src/queue/excel-export.ts`

### What to fake manually

- Fit scores: set them by hand in Excel
- Resume tailoring: not yet — just use your standard resume
- Applications: apply manually using the apply_url column

### Done when

You can run `npm run scrape` and see a populated jobs.xlsx with 20+ real job listings.

---

## Phase 2 — Intelligence (Week 2–3)

**Goal:** Jobs are automatically scored and resumes are tailored. You're still applying manually.

### What to build

1. Save your master resume as `data/resumes/master_resume.txt`
2. Save 2–3 base resumes as `.txt` in `data/resumes/base/`
3. Write `prompts/matching-prompt.md`
4. Write `src/matching/rules.ts`
5. Write `src/matching/jd-parser.ts`
6. Write `src/matching/scorer.ts`
7. Run the matching agent against your Phase 1 jobs. Review 10 results. Tune the prompt.
8. Write `prompts/tailoring-prompt.md`
9. Write `src/tailoring/keyword-mapper.ts`
10. Write `src/tailoring/bullet-rewriter.ts`
11. Write `src/tailoring/resume-builder.ts`
12. Write `src/tailoring/run-tailoring.ts`

### What to fake manually

- Applications: still manual. Use the tailored resume the bot generated, but click Apply yourself.
- Telegram: not yet needed

### Done when

You can run `npm run match` and `npm run tailor` and see scored jobs + generated `.docx` resume files in `data/resumes/generated/`.

Apply to 5 jobs manually using the bot-generated resumes. Verify the resume quality.

---

## Phase 3 — Execution with Human in the Loop (Week 4–5)

**Goal:** Clawbot applies while you watch. You answer questions via Telegram.

### What to build

1. Set up Telegram bot (15 minutes — see 06_HUMAN_INTERRUPT_SPEC.md)
2. Write `src/interrupt/telegram-bot.ts`
3. Write `src/interrupt/question-router.ts`
4. Write `src/interrupt/answer-normalizer.ts`
5. Write `src/application/profile-memory.ts`
6. Write `src/memory/answer-store.ts`
7. Write `src/memory/seed.ts` + create `data/seed-answers.json`
8. Run `npm run seed` to pre-populate common answers
9. Write `src/clawbot/question-handler.ts`
10. Write `src/clawbot/form-filler.ts`
11. Write `src/clawbot/session-logger.ts`
12. Write `src/application/submit-policy.ts` (start with `prefill_and_wait` mode)
13. Write `src/clawbot/worker.ts`
14. Write `src/application/controller.ts`

### Testing approach

- Start with Clawbot in **non-headless mode** (`headless: false` in Playwright)
- Start with **5 jobs max per run**
- Start with submit policy = `prefill_and_wait` (never auto-submits)
- Watch every application in the browser window
- For the first 10 applications: verify each screenshot in `data/screenshots/`

### Done when

Clawbot successfully navigates and fills 5 Greenhouse or Lever applications end to end. You answer questions via Telegram. Screenshots show correct fills. You manually review before each submission.

---

## Phase 4 — Memory + Learning (Week 6)

**Goal:** The bot stops asking questions it already knows.

### What to build

1. Review `data/seed-answers.json` — add any new answers you've been giving repeatedly
2. Tune `question-handler.ts` confidence thresholds (you probably set them too high in Phase 3)
3. Review all answers in the answer store — remove or update any that were wrong
4. Add more scrapers: LinkedIn, Greenhouse jobs, Lever boards

### Done when

Running 20 applications generates fewer than 5 Telegram interrupts because most questions are now in memory.

---

## Phase 5 — Scale + Dashboard (Week 7+)

**Goal:** High throughput, visibility, tuned rules.

### What to build

1. Write `src/dashboard/server.ts`
2. Write `public/dashboard/index.html`
3. Add more Apify scrapers (Glassdoor, ZipRecruiter, Ashby)
4. Add ATS-specific Clawbot strategies for Workday (if needed)
5. Tune `config/blacklist.json` based on experience
6. Tune fit_score thresholds based on response rate data
7. Add cron job or scheduled task to run the pipeline daily

### Done when

The full pipeline runs daily without you touching it. You only open Telegram when a truly novel question appears.

---

## What to Code in What Order (Vibe Coding Session Plan)

Each session below is a focused vibe coding session — paste the relevant spec's "Vibe Coding Prompt" into Cursor or Claude Code.

| Session | Spec file | Estimated time |
|---|---|---|
| 1 | `02_JOB_QUEUE_SPEC.md` — DB + Excel | 1–2 hours |
| 2 | `01_SCRAPER_SPEC.md` — Indeed scraper | 2–3 hours |
| 3 | Test: run scraper, check jobs.xlsx | 30 min |
| 4 | `03_MATCHING_AGENT_SPEC.md` | 2–3 hours |
| 5 | Test: run matcher, review 10 scored jobs | 1 hour |
| 6 | `04_RESUME_TAILORING_SPEC.md` | 2–3 hours |
| 7 | Test: review 3 generated resumes | 1 hour |
| 8 | `06_HUMAN_INTERRUPT_SPEC.md` — Telegram | 1–2 hours |
| 9 | `07_MEMORY_STORE_SPEC.md` — Answer store | 1 hour |
| 10 | `05_CLAWBOT_SPEC.md` — Playwright worker | 3–4 hours |
| 11 | Test: Clawbot on 3 real applications | 2 hours |
| 12 | `09_APPLICATION_CONTROLLER_SPEC.md` | 1 hour |
| 13 | `08_DASHBOARD_SPEC.md` | 1–2 hours |
| 14 | Add more scrapers (LinkedIn, Greenhouse) | 2–3 hours per source |

---

## What NOT to Automate Early

These things look automatable but will waste your time if you do them before the pipeline is stable:

| Don't automate early | Reason |
|---|---|
| Workday application filling | Most complex ATS, build for simpler ones first |
| Auto-submit without watching | You need to verify Clawbot behavior first |
| Running the full pipeline unattended | Until Phase 4, always supervise |
| Cover letters | Nice to have but not critical for most applications |
| Email follow-ups | Premature — get submissions working first |
| LinkedIn Easy Apply | Different enough from standard ATS to add later |

---

## Success Metrics by Phase

| Phase | Target metric |
|---|---|
| Phase 1 end | 50+ jobs in Excel queue |
| Phase 2 end | 80%+ of jobs auto-scored correctly (spot-check 20) |
| Phase 2 end | Tailored resumes look natural, no hallucinations |
| Phase 3 end | 10+ applications submitted via Clawbot |
| Phase 4 end | < 5 Telegram interrupts per 20 applications |
| Phase 5 end | Pipeline runs daily, 15+ quality applications/day |
