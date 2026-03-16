# Job Bot — Master Architecture Document

**Stack:** Node.js (TypeScript) · SQLite · Apify · Playwright · OpenAI/Anthropic API · ExcelJS · Telegram Bot API
**Version:** 1.0
**Build style:** Vibe coding — each component is an isolated module with clear inputs/outputs

---

## 1. System Overview

The Job Bot is a semi-autonomous job application engine split into three pipelines:

| Pipeline | What it does |
|---|---|
| **Discovery** | Finds jobs from many sources, normalizes them, deduplicates, and loads them into a queue |
| **Intelligence** | Scores each job against your profile, decides whether to apply, and creates a tailored resume |
| **Execution** | Opens the actual application page, fills the form, asks you when stuck, and submits safely |

The key design principle is that **intelligence lives in your pipeline, not on job boards.** Each pipeline is independently runnable. You can build and test Discovery before touching Execution.

---

## 2. Full Component Map

```
┌──────────────────────────────────────────────────────────────────┐
│  DISCOVERY PIPELINE                                              │
│                                                                  │
│  [Apify Scraper Hub]                                             │
│      Indeed · Hiring Cafe · LinkedIn · Glassdoor                 │
│      ZipRecruiter · Greenhouse · Lever · Ashby · Career Pages    │
│           │                                                      │
│           ▼                                                      │
│  [Ingestion Normalizer]                                          │
│      title · company · location · JD · source · apply_url       │
│      salary · posted_date                                        │
│           │                                                      │
│           ▼                                                      │
│  [Dedupe Engine]                                                 │
│      hash by (company + title + location)                        │
│      keep best apply_url                                         │
│           │                                                      │
│           ▼                                                      │
│  [ATS Classifier]          ← NEW — classifies Greenhouse/Lever   │
│      detects ATS platform from apply_url                        │
│           │                                                      │
│           ▼                                                      │
│  [DB + Excel Job Queue]                                          │
│      SQLite = source of truth                                    │
│      Excel = visible control panel                               │
└──────────────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────┐
│  INTELLIGENCE PIPELINE                                           │
│                                                                  │
│  [Matching Agent]                                                │
│      LLM scores job vs. master resume + rules                    │
│      output: fit_score · decision · reasoning                   │
│           │                                                      │
│           ▼                                                      │
│  [Resume Tailoring Agent]                                        │
│      LLM creates tailored resume from base + JD                 │
│      output: tailored .docx + keyword coverage report           │
└──────────────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────┐
│  EXECUTION PIPELINE                                              │
│                                                                  │
│  [Application Controller]                                        │
│      reads DB for status = ready_to_apply                        │
│      assigns jobs to Clawbot worker                              │
│           │                                                      │
│           ▼                                                      │
│  [Clawbot Worker]          [Human Interrupt Layer]               │
│      Playwright browser  ←→  Telegram bot                        │
│      fills known fields      asks you unknown questions          │
│           │                           │                          │
│           ▼                           ▼                          │
│  [Memory / Answer Store]                                         │
│      saves approved answers for reuse                            │
│           │                                                      │
│           ▼                                                      │
│  [Submission Policy Engine]                                      │
│      watch_only · prefill_and_wait · safe_auto_submit            │
│           │                                                      │
│           ▼                                                      │
│  [Logs + Dashboard]                                              │
│      tracks all statuses and metrics                             │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. Tech Stack — Component by Component

| Component | Technology | Why |
|---|---|---|
| Job scraping | Apify cloud actors | Handles JS-heavy sites, managed proxies, no infrastructure |
| Ingestion / dedupe | Node.js scripts | Simple field parsing and hash comparison |
| ATS classification | String match + regex on URL | Fast, no LLM cost needed |
| Database | SQLite via `better-sqlite3` | Zero server, file-based, works locally |
| Excel queue | ExcelJS | Read/write `.xlsx` files from Node |
| Matching agent | Anthropic Claude API or OpenAI | Best at reasoning over long JDs |
| Resume tailoring | Anthropic Claude API | Strong at rewriting bullets and matching keywords |
| Resume file output | `docxtemplater` or `docx` npm package | Generate `.docx` from templates |
| Clawbot browser | Playwright (Node.js) | Handles modern SPAs, good screenshot API |
| Human interrupt | Telegram Bot API (`node-telegram-bot-api`) | Easiest self-hosted messaging; WhatsApp requires Meta approval |
| Answer memory | SQLite table | Same DB, separate table |
| Submit policy | Config-driven logic in controller | Simple JSON config |
| Dashboard | Simple Express + plain HTML | Lightweight, no framework needed |

---

## 4. Folder Structure

```
job-bot/
│
├── src/
│   ├── scrapers/
│   │   ├── apify/
│   │   │   ├── indeed.ts
│   │   │   ├── linkedin.ts
│   │   │   ├── greenhouse.ts
│   │   │   ├── lever.ts
│   │   │   └── ashby.ts
│   │   ├── normalizer.ts          # standardizes raw scrape output
│   │   ├── dedupe.ts              # removes duplicate jobs
│   │   └── ats-classifier.ts     # detects Greenhouse/Lever/Workday
│   │
│   ├── queue/
│   │   ├── db.ts                  # SQLite connection + queries
│   │   ├── excel-export.ts       # writes DB jobs to Excel
│   │   └── excel-sync.ts         # reads Excel changes back to DB
│   │
│   ├── matching/
│   │   ├── jd-parser.ts          # extracts requirements from JD
│   │   ├── scorer.ts             # LLM scoring call
│   │   └── rules.ts              # visa / location / blacklist rules
│   │
│   ├── tailoring/
│   │   ├── keyword-mapper.ts     # maps JD keywords to resume bullets
│   │   ├── bullet-rewriter.ts    # LLM rewrites bullets
│   │   └── resume-builder.ts    # assembles final .docx
│   │
│   ├── application/
│   │   ├── controller.ts         # reads queue, assigns to worker
│   │   ├── submit-policy.ts      # apply / wait / skip logic
│   │   └── profile-memory.ts    # static profile answers (name, visa, etc)
│   │
│   ├── clawbot/
│   │   ├── worker.ts             # main Playwright runner
│   │   ├── form-filler.ts        # fills known fields
│   │   ├── question-handler.ts  # decides known vs unknown questions
│   │   └── session-logger.ts    # logs screenshots and progress
│   │
│   ├── interrupt/
│   │   ├── telegram-bot.ts       # sends/receives messages
│   │   ├── question-router.ts   # routes unknown Qs to telegram
│   │   └── answer-normalizer.ts # converts replies to memory records
│   │
│   ├── memory/
│   │   └── answer-store.ts      # CRUD for answer_memory SQLite table
│   │
│   └── dashboard/
│       ├── server.ts             # Express API
│       └── public/
│           └── index.html        # metrics UI
│
├── data/
│   ├── resumes/
│   │   ├── master_resume.docx
│   │   ├── base/                 # role-specific base resumes
│   │   └── generated/           # tailored output resumes
│   ├── queue/
│   │   └── jobs.xlsx
│   └── screenshots/
│
├── prompts/
│   ├── matching-prompt.md
│   └── tailoring-prompt.md
│
├── config/
│   ├── settings.json             # user preferences, rules, API keys
│   └── blacklist.json           # companies/keywords to skip
│
├── db/
│   └── schema.sql
│
├── .env
├── package.json
└── tsconfig.json
```

---

## 5. Data Flow — One Job End to End

```
1.  Apify actor runs for Indeed
2.  Returns raw job objects (title, company, JD, apply_url, etc.)
3.  normalizer.ts cleans and standardizes each job
4.  dedupe.ts hashes (company + title + location)
        → if hash exists in DB: skip
        → if new: continue
5.  ats-classifier.ts reads apply_url
        → tags job as greenhouse / lever / ashby / workday / other
6.  Job inserted into SQLite with status = 'new'
7.  excel-export.ts writes new rows to jobs.xlsx
8.  scorer.ts sends JD + master resume to LLM
        → returns fit_score (0–100) + decision + reasoning
9.  If decision = 'skip':
        → DB status = 'skipped'
10. If decision = 'apply':
        → bullet-rewriter.ts tailors resume
        → resume-builder.ts saves Databricks_Backend_Resume.docx
        → DB status = 'ready_to_apply'
11. controller.ts picks up rows where status = 'ready_to_apply'
12. worker.ts launches Playwright browser
        → opens apply_url
        → form-filler.ts fills known fields from profile-memory
        → encounters "Are you open to relocation?"
13. question-handler.ts cannot match to memory store
        → telegram-bot.ts sends you a message on Telegram
        → you reply "Yes, open to hybrid in Austin or remote"
14. answer-normalizer.ts saves the answer to answer_memory DB
15. form-filler.ts fills the answer and continues
16. submit-policy.ts checks mode
        → if 'safe_auto_submit': clicks submit
        → if 'prefill_and_wait': pauses, notifies you
17. status updated to 'submitted' in DB + Excel
18. session-logger.ts saves screenshots
19. dashboard/server.ts reflects updated metrics
```

---

## 6. Job Status State Machine

```
new
 │
 ├─→ matched          (fit_score calculated, decision = apply)
 │    │
 │    ├─→ resume_generated    (tailored resume ready)
 │    │    │
 │    │    ├─→ ready_to_apply  (waiting for Clawbot)
 │    │    │    │
 │    │    │    ├─→ applying        (Clawbot is running)
 │    │    │    │    │
 │    │    │    │    ├─→ needs_answer   (human interrupt triggered)
 │    │    │    │    │    │
 │    │    │    │    │    └─→ applying  (resumed after answer)
 │    │    │    │    │
 │    │    │    │    ├─→ submitted      (success)
 │    │    │    │    └─→ failed         (error, screenshot saved)
 │    │    │    │
 │    │    │    └─→ paused        (user manually paused)
 │    │
 │    └─→ skipped     (decision = skip, low score)
 │
 └─→ duplicate        (same job already exists in DB)
```

---

## 7. Config File Shape (`config/settings.json`)

```json
{
  "profile": {
    "name": "Your Name",
    "email": "you@email.com",
    "phone": "+1-xxx-xxx-xxxx",
    "location": "Austin, TX",
    "linkedin": "https://linkedin.com/in/yourprofile",
    "github": "https://github.com/yourusername"
  },
  "job_preferences": {
    "target_titles": ["Software Engineer", "Backend Engineer", "Data Engineer"],
    "target_locations": ["Remote", "Austin TX", "New York NY"],
    "min_salary": 120000,
    "visa_sponsorship_required": true,
    "relocation_open": false
  },
  "scoring": {
    "min_fit_score_to_apply": 70,
    "auto_apply_threshold": 85
  },
  "submission_policy": {
    "mode": "prefill_and_wait",
    "trusted_ats_platforms": ["greenhouse", "lever", "ashby"]
  },
  "blacklist": {
    "companies": [],
    "keywords": ["unpaid", "commission only", "must be US citizen"]
  },
  "apify": {
    "api_token": "your_apify_token"
  },
  "llm": {
    "provider": "anthropic",
    "model": "claude-opus-4-6",
    "api_key": "your_api_key"
  },
  "telegram": {
    "bot_token": "your_bot_token",
    "chat_id": "your_chat_id"
  }
}
```

---

## 8. Phased Build Order

### Phase 1 — Manual queue, no automation (Week 1)
Goal: get jobs flowing into Excel manually so you have a real queue to test against.

- Set up SQLite schema
- Write Apify connector for one source (Indeed)
- Write normalizer and dedupe
- Write excel-export so you see jobs in a spreadsheet
- Manually set fit scores in Excel

### Phase 2 — Intelligence (Week 2–3)
Goal: LLM scores and resumes are generated automatically.

- Build matching agent (scorer.ts)
- Build resume tailoring pipeline
- Wire status transitions: new → matched → resume_generated → ready_to_apply

### Phase 3 — Execution with human in the loop (Week 4–5)
Goal: Clawbot applies with you watching and answering questions.

- Build Clawbot worker with Playwright
- Build form-filler with profile-memory
- Build human interrupt via Telegram
- Test on 5 real applications in 'prefill_and_wait' mode

### Phase 4 — Memory and learning (Week 6)
Goal: The bot stops asking questions it already knows.

- Build answer-store
- Build answer-normalizer
- Wire question-handler to check memory before interrupting

### Phase 5 — Scale and dashboard (Week 7+)
Goal: Add more scraper sources, tune rules, build dashboard.

- Add LinkedIn, Greenhouse, Lever scrapers
- Add ATS-specific form strategies to Clawbot
- Build dashboard for metrics
- Tune min_fit_score and blacklist based on results

---

## 9. Key Design Decisions

**SQLite is source of truth, Excel is view layer.**
The DB owns all data. Excel is generated from the DB. Manual Excel edits (like changing a status) sync back to DB via excel-sync.ts. Never let them diverge.

**Clawbot is hands, not brain.**
Clawbot only navigates. All decisions (what to fill, whether to submit) come from the controller and memory store. Clawbot should not have any LLM calls inside it.

**ATS classification gates Clawbot strategy.**
A Greenhouse form behaves differently than a Workday form. The ATS type tag is set at ingestion time so Clawbot can load the right strategy module.

**Telegram over WhatsApp.**
Telegram Bot API is free, instant to set up, and requires no business approval. A Telegram bot can be running in under 30 minutes.

**Memory is the compounding asset.**
Every question you answer once should never interrupt you again for the same intent. The answer store is what turns this from a one-time tool into a system that gets smarter.
