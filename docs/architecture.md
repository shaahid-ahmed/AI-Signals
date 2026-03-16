# Architecture Notes

## Overview

AI Signal is a two-runtime project:

1. **Browser app** (`frontend/`) — vanilla ES2022 modules, no build step, talks directly to Anthropic's API
2. **Python CLI** (`src/` + `scripts/`) — same pipeline logic in Python, suitable for server/CI use

Both runtimes share the same conceptual pipeline:

```
RSS Feeds
    │
    ▼
[ Fetcher ]  ──── tries multiple URLs per provider, tolerates partial failures
    │
    ▼
[ Dedup ]    ──── Layer 1: within-run title collision
             ──── Layer 2: cross-run GUID persistence (localStorage / .json file)
    │
    ▼
[ Agent ]    ──── Claude Sonnet via /v1/messages, batched 20 items at a time
    │
    ▼
[ Renderer ] ──── Two tables: Accepted (SIGNAL) + Rejected (NOISE with reason)
```

---

## Module responsibilities

### `frontend/js/fetcher.js`
- Defines `RSS_SOURCES` (4 providers, 2 URL fallbacks each)
- Fetches via `allorigins.win` CORS proxy (swap for your own proxy freely)
- Parses both RSS 2.0 (`<item>`) and Atom (`<entry>`) formats
- Returns uniform `FeedItem` objects

### `frontend/js/dedup.js`
- `normaliseTitle()` — strips non-alphanum, lowercases, truncates to 60 chars
- `deduplicate()` — pure function, returns `{ fresh, dupCount, seenCount }`
- `loadSeenGuids()` / `saveSeenGuids()` — localStorage persistence, capped at 500 GUIDs
- Intentionally does **not** mark items as seen until after successful classification (so a failed API call doesn't silently skip items forever)

### `frontend/js/agent.js`
- Sends batches of 20 items to `claude-sonnet-4-20250514`
- System prompt explicitly defines SIGNAL vs NOISE with examples
- Returns a `Map<guid, Classification>` so items are always linked by GUID, not array position
- Falls back to NOISE for any item the model doesn't classify

### `frontend/js/render.js`
- Pure DOM manipulation — no framework
- Both tables sort newest-first by `pubDate`
- Row animations are staggered by 25ms to avoid jank on large result sets
- Rejected table shows the agent's `reason` verbatim for full transparency

### `frontend/js/app.js`
- Single orchestrator that sequences the above modules
- API key prompt: stored in `sessionStorage` (tab-lifetime only), never in `localStorage` or source
- Progress stepper: 4 named steps with spinner / ✓ / ✗ states
- `finish()` resets UI state whether the run succeeds or errors

---

## Deduplication design

### Why two layers?

A single-layer approach would miss one of two failure modes:

| Scenario | Layer 1 (title) | Layer 2 (GUID) |
|---|---|---|
| Same post in two feeds | ✓ catches it | may miss it if GUIDs differ |
| Same post re-published in a later fetch | won't catch it | ✓ catches it |

Layer 1 uses normalised title matching because GUIDs aren't always stable (some blogs change their GUID scheme or re-publish with a new GUID but the same title).

Layer 2 uses raw GUIDs because titles can legitimately change slightly between edits.

Together they cover the realistic failure space.

### localStorage cap

We cap the stored GUID set at 500 entries (FIFO eviction) to prevent unbounded storage growth. In practice, 500 GUIDs covers several months of AI company blog posts before any eviction occurs.

---

## Honest dating

The date displayed always comes from the RSS `pubDate`/`published` field, never from `Date.now()` at fetch time. If a feed omits the date entirely, the item shows "Unknown" — we never fabricate a date.

The UI shows both an absolute date ("Mar 4, 2025") and a relative age ("3 months ago") so readers can judge recency themselves.

---

## API key security

- Browser: key entered in a modal, stored in `sessionStorage` (single-tab lifetime), sent only to `api.anthropic.com` via HTTPS
- Python CLI: loaded from environment variable or `.env` file (which is in `.gitignore`)
- Neither path ever logs or persists the key beyond its intended lifetime

---

## CORS proxy

The browser fetches RSS feeds via `https://api.allorigins.win/get?url=...` to avoid CORS errors. This is a free open-source proxy that simply mirrors the response.

**Swap options:**
- Deploy your own [allorigins](https://github.com/gnuns/allorigins) instance
- Use a Cloudflare Worker or AWS Lambda to proxy the feeds
- Use the Python CLI instead, which fetches directly (no CORS constraint)

---

## Extending the source list

Add a new source in `frontend/js/fetcher.js` (browser) and `src/fetcher/rss.py` (Python CLI):

```js
// frontend/js/fetcher.js
{
  name: 'Mistral',
  provider: 'mistral',
  product: 'Le Chat',
  urls: ['https://mistral.ai/news/rss.xml'],
},
```

Then add the matching CSS custom properties in `frontend/css/main.css`:

```css
--mistral:        #ff6b35;
--mistral-alpha:  rgba(255 107 53 / .10);
--mistral-border: rgba(255 107 53 / .20);
```

And add a `.provider-badge.mistral` rule in the badge section.

---

## GitHub Actions

`.github/workflows/scheduled_fetch.yml` runs daily at 08:00 UTC and uploads `results.json` as a workflow artifact. To enable:

1. Go to **Settings → Secrets and variables → Actions**
2. Add `ANTHROPIC_API_KEY` as a repository secret
3. The workflow will run automatically on the schedule

The `workflow_dispatch` trigger lets you run it manually from the Actions tab, with an option to reset the dedup state.
