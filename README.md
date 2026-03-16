# AI Signal - Product Updates Dashboard

> An agent-powered dashboard that monitors the leading AI model providers and surfaces a clean, rolling feed of their latest **genuine product news** - filtered, deduplicated, and honestly dated.
---

## What it does

AI Signal pulls RSS feeds from **OpenAI**, **Anthropic**, **Google DeepMind**, and **Microsoft**, then runs each item through a Gemini-powered classification agent that separates real product signal from noise.

| Included (Signal ✓) | Excluded (Noise ✕) |
|---|---|
| New model releases | Tutorials & how-to guides |
| Feature & capability announcements | Customer case studies |
| API updates & pricing changes | Marketing copy |
| Significant research → product | Event announcements |

The result is two tables:
- **Accepted** — genuine product/feature releases, sorted newest-first
- **Rejected** — filtered items with the agent's one-line reason (so you can audit its judgment)

---

## Free API setup

This project uses **Google Gemini** (`gemini-2.0-flash-lite`) which has a generous free tier:

| Limit | Value |
|---|---|
| Requests / minute | 15 |
| Requests / day | 1,500 |
| Tokens / minute | 1,000,000 |

**Get your free key:** https://aistudio.google.com/apikey (sign in with Google → Create API key → copy it)

---

## Architecture — no third-party proxies

The browser cannot fetch RSS feeds directly (CORS). Instead of routing through third-party proxies (which are unreliable and slow), AI Signal uses a **self-hosted backend proxy** you run yourself:

```
Browser → /api/feed?url=<feed> → Python server → RSS feed
```

- **Dev**: `python scripts/serve.py` (built-in, zero deps)
- **Production**: `python server/proxy.py` (Flask, deploy anywhere)

Your feeds never touch anyone else's infrastructure.

---

## Quick start

### Browser

```bash
git clone https://github.com/YOUR_USERNAME/ai-signal.git
cd ai-signal

# 1. Create your config file
cp frontend/js/config.example.js frontend/js/config.js

# 2. Add your free Gemini key (get one at https://aistudio.google.com/apikey)
#    Open frontend/js/config.js and replace YOUR_GEMINI_API_KEY_HERE

# 3. Serve and open
python scripts/serve.py
# → opens http://localhost:8000 automatically
# → click "Fetch Latest AI Updates"
```

> `scripts/serve.py` will auto-create `config.js` from the example on first run
> and print a reminder if the key hasn't been filled in yet.

### Python CLI

```bash
pip install -r requirements.txt

# Copy and fill in the env file
cp .env.example .env
# edit .env → GEMINI_API_KEY=AIzaSy-your-key-here

python scripts/fetch_and_classify.py --output results.json
```

---

## Project structure

```
ai-signal/
├── frontend/                  # Static frontend (HTML + CSS + ES modules)
│   ├── index.html
│   ├── css/main.css
│   └── js/
│       ├── app.js             # Orchestrator
│       ├── fetcher.js         # RSS fetch + XML parse
│       ├── agent.js           # Gemini API + batch classify
│       ├── dedup.js           # Two-layer deduplication
│       ├── render.js          # DOM table builder
│       └── utils.js           # Date helpers, escapeHtml, etc.
│
├── src/                       # Python mirror of the same pipeline
│   ├── agent/classifier.py    # Gemini classify (google-generativeai SDK)
│   ├── fetcher/rss.py         # feedparser-based RSS fetch
│   └── utils/{dates,dedup}.py
│
├── scripts/
│   ├── fetch_and_classify.py  # CLI: fetch → dedup → classify → JSON
│   └── serve.py               # Dev server (python scripts/serve.py)
│
├── .github/workflows/
│   └── scheduled_fetch.yml    # Daily 08:00 UTC GitHub Actions job
│
├── docs/architecture.md
├── .env.example               # GEMINI_API_KEY=AIzaSy…
├── requirements.txt           # google-generativeai, feedparser, python-dotenv
└── README.md
```

---

## Key design decisions

### Two-layer deduplication
1. **Within-run** — normalises titles and dedups across all four feeds in the same fetch
2. **Cross-run** — persists seen GUIDs in `localStorage` (browser) / `.ai_signal_seen.json` (CLI) so the same story never resurfaces

### Honest dating
Dates come from the RSS `pubDate`/`published` field — **never** from when the item was fetched. Every item shows both an absolute date and a human-readable age ("3 months ago").

### Rate-limit aware batching
Items are classified in batches of 15 with a ~4s inter-batch delay to stay comfortably within Gemini's 15 RPM free-tier limit.

---

## Configuration

```bash
cp .env.example .env
# Add your key:  GEMINI_API_KEY=AIzaSy-your-key-here
```

The browser frontend asks for the key at runtime — it's stored in `sessionStorage` only (never logged, never committed).

For GitHub Actions, add `GEMINI_API_KEY` as a repository secret under **Settings → Secrets and variables → Actions**.

---

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | Vanilla HTML5 + CSS3 custom properties + ES2022 modules |
| AI agent | Google Gemini 2.5 Pro (free tier) |
| RSS proxy | allorigins.win (CORS proxy, open-source) |
| Python utilities | Python 3.11+, `google-generativeai`, `feedparser` |
| CI/CD | GitHub Actions |

---
