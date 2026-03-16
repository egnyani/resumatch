# Component Spec: Logs + Dashboard

**Files:** `src/dashboard/`
**Phase:** 4 (build after execution pipeline is working)
**Depends on:** Express, SQLite

---

## Purpose

A lightweight local web dashboard that shows the real-time state of your job application pipeline. Runs on localhost. Lets you see what the bot has been doing, spot failures, review submitted applications, and monitor your pipeline health without opening Excel.

---

## Files

### `src/dashboard/server.ts`

Express server that reads from SQLite and serves the dashboard.

```typescript
import express from 'express';
import path from 'path';
import { db } from '../queue/db';

const app = express();
const PORT = 3000;

app.use(express.static(path.resolve(__dirname, '../../public/dashboard')));

// API: summary metrics
app.get('/api/metrics', (_req, res) => {
  const metrics = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as new_count,
      SUM(CASE WHEN status = 'matched' THEN 1 ELSE 0 END) as matched,
      SUM(CASE WHEN status = 'resume_generated' THEN 1 ELSE 0 END) as resume_ready,
      SUM(CASE WHEN status = 'ready_to_apply' THEN 1 ELSE 0 END) as ready,
      SUM(CASE WHEN status = 'applying' THEN 1 ELSE 0 END) as applying,
      SUM(CASE WHEN status = 'needs_answer' THEN 1 ELSE 0 END) as needs_answer,
      SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) as submitted,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped,
      AVG(CASE WHEN fit_score IS NOT NULL THEN fit_score END) as avg_score
    FROM jobs
  `).get();
  res.json(metrics);
});

// API: recent jobs
app.get('/api/jobs', (req, res) => {
  const status = req.query.status as string | undefined;
  const limit = parseInt(req.query.limit as string ?? '50');

  const query = status
    ? 'SELECT * FROM jobs WHERE status = ? ORDER BY updated_at DESC LIMIT ?'
    : 'SELECT * FROM jobs ORDER BY updated_at DESC LIMIT ?';
  const params = status ? [status, limit] : [limit];

  const jobs = db.prepare(query).all(...params);
  res.json(jobs);
});

// API: answer memory
app.get('/api/memory', (_req, res) => {
  const answers = db.prepare('SELECT * FROM answer_memory ORDER BY use_count DESC').all();
  res.json(answers);
});

// API: screenshots for a job
app.get('/api/screenshots/:jobId', (req, res) => {
  const fs = require('fs');
  const dir = path.resolve(__dirname, `../../data/screenshots/${req.params.jobId}`);
  if (!fs.existsSync(dir)) return res.json([]);
  const files = fs.readdirSync(dir).map((f: string) => `/screenshots/${req.params.jobId}/${f}`);
  res.json(files);
});

app.use('/screenshots', express.static(path.resolve(__dirname, '../../data/screenshots')));

app.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
});
```

---

### `public/dashboard/index.html`

Single-file dashboard. No build step, no framework.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Job Bot Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; padding: 24px; }
    h1 { font-size: 1.5rem; margin-bottom: 24px; color: #f8fafc; }
    h2 { font-size: 1rem; margin-bottom: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }

    .metrics { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; margin-bottom: 32px; }
    .metric-card { background: #1e293b; border-radius: 8px; padding: 16px; text-align: center; }
    .metric-card .value { font-size: 2rem; font-weight: 700; margin-bottom: 4px; }
    .metric-card .label { font-size: 0.75rem; color: #64748b; }

    .submitted .value  { color: #4ade80; }
    .applying .value   { color: #60a5fa; }
    .needs .value      { color: #fbbf24; }
    .failed .value     { color: #f87171; }
    .matched .value    { color: #a78bfa; }
    .new .value        { color: #94a3b8; }

    table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 8px; overflow: hidden; }
    th { background: #0f172a; padding: 10px 14px; text-align: left; font-size: 0.75rem; color: #64748b; text-transform: uppercase; }
    td { padding: 10px 14px; font-size: 0.85rem; border-bottom: 1px solid #0f172a; }
    tr:hover td { background: #263447; }

    .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 0.7rem; font-weight: 600; }
    .badge-submitted    { background: #14532d; color: #4ade80; }
    .badge-failed       { background: #450a0a; color: #f87171; }
    .badge-applying     { background: #1e3a5f; color: #60a5fa; }
    .badge-needs_answer { background: #451a03; color: #fbbf24; }
    .badge-matched      { background: #2e1065; color: #a78bfa; }
    .badge-skipped      { background: #1e1e1e; color: #64748b; }
    .badge-new          { background: #1e293b; color: #94a3b8; border: 1px solid #334155; }

    .filter-bar { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
    .filter-btn { padding: 6px 14px; border-radius: 6px; border: 1px solid #334155;
                  background: transparent; color: #94a3b8; cursor: pointer; font-size: 0.8rem; }
    .filter-btn.active { background: #3b82f6; border-color: #3b82f6; color: white; }

    .section { margin-bottom: 40px; }
    .refresh { float: right; font-size: 0.75rem; color: #475569; }
  </style>
</head>
<body>
  <h1>🤖 Job Bot Dashboard</h1>

  <section class="section">
    <h2>Pipeline Status <span class="refresh" id="last-updated"></span></h2>
    <div class="metrics" id="metrics"></div>
  </section>

  <section class="section">
    <h2>Job Queue</h2>
    <div class="filter-bar" id="filters"></div>
    <table>
      <thead>
        <tr>
          <th>Status</th><th>Company</th><th>Title</th>
          <th>Score</th><th>ATS</th><th>Source</th><th>Updated</th>
        </tr>
      </thead>
      <tbody id="jobs-table"></tbody>
    </table>
  </section>

  <script>
    const STATUSES = ['all','new','matched','resume_generated','ready_to_apply',
                      'applying','needs_answer','submitted','failed','skipped'];
    let currentFilter = 'all';

    async function loadMetrics() {
      const data = await fetch('/api/metrics').then(r => r.json());
      const cards = [
        { key: 'submitted', label: 'Submitted', cls: 'submitted' },
        { key: 'applying', label: 'Applying', cls: 'applying' },
        { key: 'needs_answer', label: 'Needs Answer', cls: 'needs' },
        { key: 'failed', label: 'Failed', cls: 'failed' },
        { key: 'matched', label: 'Matched', cls: 'matched' },
        { key: 'new_count', label: 'New', cls: 'new' },
        { key: 'total', label: 'Total', cls: '' },
        { key: 'avg_score', label: 'Avg Score', cls: '' },
      ];
      document.getElementById('metrics').innerHTML = cards.map(c =>
        `<div class="metric-card ${c.cls}">
          <div class="value">${c.key === 'avg_score' ? (data[c.key]?.toFixed(0) ?? '—') : (data[c.key] ?? 0)}</div>
          <div class="label">${c.label}</div>
        </div>`
      ).join('');
      document.getElementById('last-updated').textContent = 'Updated ' + new Date().toLocaleTimeString();
    }

    function renderFilters() {
      document.getElementById('filters').innerHTML = STATUSES.map(s =>
        `<button class="filter-btn ${s === currentFilter ? 'active' : ''}"
           onclick="setFilter('${s}')">${s}</button>`
      ).join('');
    }

    async function loadJobs() {
      const url = currentFilter === 'all' ? '/api/jobs?limit=100' : `/api/jobs?status=${currentFilter}&limit=100`;
      const jobs = await fetch(url).then(r => r.json());
      document.getElementById('jobs-table').innerHTML = jobs.map(j => `
        <tr>
          <td><span class="badge badge-${j.status}">${j.status}</span></td>
          <td>${j.company}</td>
          <td>${j.title}</td>
          <td>${j.fit_score ?? '—'}</td>
          <td>${j.ats_platform ?? '—'}</td>
          <td>${j.source_site ?? '—'}</td>
          <td>${j.updated_at ? new Date(j.updated_at).toLocaleDateString() : '—'}</td>
        </tr>
      `).join('');
    }

    function setFilter(s) {
      currentFilter = s;
      renderFilters();
      loadJobs();
    }

    async function refresh() {
      await Promise.all([loadMetrics(), loadJobs()]);
    }

    renderFilters();
    refresh();
    setInterval(refresh, 30000); // auto-refresh every 30 seconds
  </script>
</body>
</html>
```

---

## Vibe Coding Prompt

```
Build the dashboard for a job application bot in Node.js + TypeScript.

Files:
- src/dashboard/server.ts — Express server on port 3000.
  GET /api/metrics — aggregated counts by status, avg fit_score from SQLite.
  GET /api/jobs?status=&limit= — recent jobs from SQLite, sorted by updated_at.
  GET /api/memory — all answer_memory records.
  GET /api/screenshots/:jobId — list screenshot files for a job.
  Serves static files from public/dashboard/ and data/screenshots/.

- public/dashboard/index.html — single-file dashboard (no build step, no framework).
  Shows metric cards for each status (submitted, applying, needs_answer, failed, matched, new).
  Shows filterable jobs table with status, company, title, score, ATS, source, date.
  Color-coded badges per status. Auto-refreshes every 30 seconds.

Use express npm package. Dark theme. No React, no Tailwind, no build tools.
```

---

## Integration Points

- **Reads from:** SQLite `jobs` table (all statuses)
- **Reads from:** SQLite `answer_memory` table
- **Reads from:** `data/screenshots/` folder
- **Used by:** You — open in browser while bot is running
