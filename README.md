# resumatch

ATS resume tailoring tool built with Next.js 14, Ollama or Gemini, Mammoth, DOCX XML editing, and Vercel-friendly PDF conversion.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env.local` with these variables:

```bash
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:7b-instruct
GEMINI_API_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## Environment Variables

- `LLM_PROVIDER`
  `ollama` for local Ollama usage, or `gemini` if you want to use Gemini instead.
- `OLLAMA_BASE_URL`
  Base URL for the local or remote Ollama server.
- `OLLAMA_MODEL`
  Ollama model name used for job parsing and resume tailoring.
- `GEMINI_API_KEY`
  Optional Gemini API key if you set `LLM_PROVIDER=gemini`.
- `NEXT_PUBLIC_SUPABASE_URL`
  Public Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  Public Supabase anon key for browser-side storage access.
- `SUPABASE_SERVICE_ROLE_KEY`
  Server-side Supabase key for privileged storage operations.
- `NEXT_PUBLIC_APP_URL`
  Base app URL used for internal server-to-server calls in local development.

## Run Locally

Start the development server:

```bash
ollama serve
ollama pull qwen2.5:7b-instruct
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Notes:

- Resume uploads must be `.docx` and 5MB or smaller.
- Pasted job descriptions must be at least 200 characters.
- Local rate limiting for `/api/tailor-resume` uses an in-memory map.
  For production, replace it with Upstash Redis or another shared store.
- The default local LLM provider is Ollama.
- PDF conversion prefers LibreOffice when available locally.
  If LibreOffice is unavailable, the app falls back to Mammoth HTML plus headless Chromium.

## Deploy To Vercel

1. Add the same environment variables in your Vercel project settings.
2. Keep [vercel.json](/Users/gnyani/resumatch/vercel.json) committed so the tailoring route gets a 60 second function timeout.
3. Deploy:

```bash
vercel --prod
```

## Project Highlights

- `/api/scrape-jd`
  Scrapes a job page, extracts readable text, and uses Ollama or Gemini to return title, company, keywords, and summary.
- `/api/tailor-resume`
  Applies rate limiting, validates inputs, requests Ollama or Gemini modifications, edits the DOCX XML, and returns DOCX/PDF as base64.
- `/api/convert-pdf`
  Uses LibreOffice first, then falls back to Mammoth + Puppeteer + Sparticuz Chromium for Vercel-friendly PDF generation.
