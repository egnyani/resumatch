# job-bot

Automated job application bot — scrapes listings, tailors resumes with GPT-4o-mini, and fills out applications via Playwright. Human-in-the-loop via Telegram for sensitive questions.

## Stack
- **Node.js + TypeScript** — core pipeline
- **Python** — OOXML resume generation (`scripts/build_resume.py`)
- **Playwright** — browser automation (Clawbot)
- **SQLite** — job queue and answer memory
- **OpenAI gpt-4o-mini** — resume tailoring + keyword matching
- **Telegram Bot** — human interrupt layer

## Setup

```bash
git clone https://github.com/egnyani/resumatch.git
cd resumatch/job-bot
npm install
npx playwright install chromium
pip install python-docx
```

Create a `.env` file in `job-bot/`:
```
APIFY_TOKEN=your_apify_token
OPENAI_API_KEY=your_openai_key
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_chat_id
SIMPLIFY_PASSWORD=your_password
CAREER_PORTAL_PASSWORD=your_password
```

Seed the answer memory:
```bash
npm run seed
```

## Usage

```bash
npm run scrape      # pull new job listings
npm run match       # score + filter by fit
npm run tailor      # generate tailored resumes
npm run apply       # launch Clawbot to fill applications
```

Or run the full pipeline at once:
```bash
npm run pipeline
```

## Project structure

```
job-bot/
├── config/           # settings.json (profile, preferences, policy)
├── data/
│   ├── queue/        # jobs.xlsx (editable job queue)
│   ├── resumes/      # base resume + generated outputs
│   └── seed-answers.json
├── prompts/          # LLM prompt templates
├── scripts/          # Python resume builder
└── src/
    ├── scrapers/     # Apify-based job scrapers
    ├── matching/     # scoring + filtering
    ├── tailoring/    # GPT resume tailoring
    ├── clawbot/      # Playwright form filler
    ├── interrupt/    # Telegram human-in-the-loop
    ├── memory/       # SQLite answer store
    ├── queue/        # DB + Excel sync
    └── application/  # controller + profile memory
```

## Notes
- Submission policy is set to `prefill_and_wait` by default — the bot fills forms but does **not** auto-submit. You review and click Submit yourself.
- Workday, Taleo, and iCIMS are skipped by the controller (handled manually for now).
- All secrets live in `.env` — never committed to git.
