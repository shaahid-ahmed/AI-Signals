/**
 * fetcher.js
 * Fetches RSS/Atom feeds through the built-in server-side proxy
 * at /api/feed?url=<encoded>.
 *
 * No third-party CORS proxies. The Python server (scripts/serve.py)
 * fetches feeds directly and relays them — cleaner, faster, reliable.
 *
 * For production deployment use server/proxy.py (Flask) or any
 * server that exposes the same /api/feed endpoint.
 */

// ── Config ────────────────────────────────────────────────────

const MAX_ITEMS_PER_SOURCE = 40;   // cap per source; keep classify batches sane
const FETCH_TIMEOUT_MS     = 15_000;

// ── Source definitions ────────────────────────────────────────

/**
 * @typedef {Object} FeedItem
 * @property {string} title
 * @property {string} link
 * @property {string} pubDate
 * @property {string} description
 * @property {string} guid
 * @property {string} provider
 * @property {string} providerName
 * @property {string} product
 */

export const RSS_SOURCES = [
  {
    name: 'OpenAI',
    provider: 'openai',
    product: 'ChatGPT',
    urls: [
      'https://openai.com/news/rss.xml',
    ],
  },
  {
    name: 'Anthropic',
    provider: 'anthropic',
    product: 'Claude',
    urls: [
      'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml',
      'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_research.xml',
      'https://www.anthropic.com/rss.xml',
    ],
  },
  {
    name: 'Google DeepMind',
    provider: 'google',
    product: 'Gemini',
    urls: [
      'https://deepmind.google/blog/rss.xml',
      'https://blog.google/products/gemini/rss/',
    ],
  },
  {
    name: 'Microsoft Copilot',
    provider: 'microsoft',
    product: 'Copilot',
    urls: [
      'https://www.microsoft.com/en-us/microsoft-copilot/blog/feed/',
    ],
  },
];

// ── Proxy fetch ───────────────────────────────────────────────

/**
 * Fetches a feed URL via the local /api/feed proxy.
 * Falls back to the raw URL if the proxy returns an error
 * (useful when opening index.html directly as a file:// URL).
 */
async function proxyFetch(feedUrl) {
  const proxyUrl = `/api/feed?url=${encodeURIComponent(feedUrl)}`;

  const res = await fetch(proxyUrl, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`proxy HTTP ${res.status} for ${feedUrl}`);
  }

  const text = await res.text();
  if (!text?.trim()) throw new Error(`proxy returned empty body for ${feedUrl}`);
  return text;
}

// ── XML parsing ───────────────────────────────────────────────

function stripTags(str) {
  return (str ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function getText(el, ...selectors) {
  for (const sel of selectors) {
    try {
      const found = el.querySelector(sel);
      if (found?.textContent?.trim()) return found.textContent.trim();
    } catch { /* skip invalid selectors */ }
  }
  return '';
}

function parseXML(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML parse error');
  return extractItems(doc);
}

function extractItems(doc) {
  const items = [];

  // RSS 2.0 — <item>
  doc.querySelectorAll('item').forEach(item => {
    const title = stripTags(getText(item, 'title'));
    if (!title) return;

    const linkEl = item.querySelector('link');
    const link   = linkEl?.textContent?.trim()
                || linkEl?.getAttribute('href')
                || '';

    const pubDate = getText(item, 'pubDate', 'pubdate', 'published', 'updated');
    const desc    = stripTags(getText(item, 'description', 'summary', 'content'));
    const guid    = getText(item, 'guid') || link || title;

    items.push({ title, link, pubDate, description: desc.slice(0, 400), guid });
  });

  // Atom — <entry>
  if (items.length === 0) {
    doc.querySelectorAll('entry').forEach(entry => {
      const title = stripTags(getText(entry, 'title'));
      if (!title) return;

      const link =
        entry.querySelector('link[rel="alternate"]')?.getAttribute('href') ||
        entry.querySelector('link')?.getAttribute('href') ||
        entry.querySelector('link')?.textContent?.trim() || '';

      const pubDate = getText(entry, 'published', 'updated');
      const desc    = stripTags(getText(entry, 'summary', 'content'));
      const guid    = getText(entry, 'id') || link;

      items.push({ title, link, pubDate, description: desc.slice(0, 400), guid });
    });
  }

  return items;
}

// ── Sort + cap ────────────────────────────────────────────────

function sortAndCap(items, max) {
  const withDate    = items.filter(i => i.pubDate).sort((a, b) => {
    const da = new Date(a.pubDate), db = new Date(b.pubDate);
    if (isNaN(da) && isNaN(db)) return 0;
    if (isNaN(da)) return 1;
    if (isNaN(db)) return -1;
    return db - da;
  });
  const withoutDate = items.filter(i => !i.pubDate);
  return [...withDate, ...withoutDate].slice(0, max);
}

// ── Public API ────────────────────────────────────────────────

export async function fetchSource(source) {
  const urlErrors = [];

  for (const feedUrl of source.urls) {
    try {
      const xml   = await proxyFetch(feedUrl);
      const raw   = parseXML(xml);
      if (raw.length === 0) { urlErrors.push(`${feedUrl}: 0 items`); continue; }

      const capped = sortAndCap(raw, MAX_ITEMS_PER_SOURCE);
      const items  = capped.map(item => ({
        ...item,
        provider:     source.provider,
        providerName: source.name,
        product:      source.product,
      }));

      return { items, error: null };
    } catch (err) {
      urlErrors.push(`${feedUrl}: ${err.message}`);
    }
  }

  return { items: [], error: urlErrors.join('\n') };
}

export async function fetchAll() {
  const settled  = await Promise.allSettled(RSS_SOURCES.map(fetchSource));
  const allItems = [];
  const results  = [];

  settled.forEach((outcome, i) => {
    const source = RSS_SOURCES[i];
    if (outcome.status === 'fulfilled') {
      allItems.push(...outcome.value.items);
      results.push({
        source: source.name,
        count:  outcome.value.items.length,
        error:  outcome.value.error,
      });
    } else {
      results.push({
        source: source.name,
        count:  0,
        error:  outcome.reason?.message ?? 'Unknown',
      });
    }
  });

  return { allItems, results };
}
