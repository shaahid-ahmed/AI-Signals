/**
 * agent.js
 * Classifies feed items as SIGNAL or NOISE using the Google Gemini API.
 *
 * Free tier (gemini-2.0-flash-lite):
 *   - 15 RPM, 1,500 RPD, 1M TPM  →  no credit card required
 *   - Get a free key: https://aistudio.google.com/apikey
 *
 * Streaming support:
 *   classifyAll() accepts an `onBatch` callback that fires immediately
 *   after each Gemini batch completes, with (batchItems, batchMap).
 *   The caller can render those results right away without waiting for
 *   all remaining batches to finish.
 */

const GEMINI_BASE  = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL        = 'gemini-2.5-flash';
const BATCH_SIZE   = 15;
const RPM_DELAY_MS = 4200;   // ~14 req/min — safely under the 15 RPM free-tier cap

// ── Prompt ──────────────────────────────────────────────────
const SYSTEM_INSTRUCTION = `You are an AI product news classifier. Analyse blog post titles and summaries from AI companies (OpenAI, Anthropic, Google, Microsoft) and classify each item as SIGNAL or NOISE.

SIGNAL (include) — genuine product news:
• New model releases or version bumps (e.g. GPT-4o, Claude 3.5 Sonnet, Gemini 1.5 Pro)
• New product features or UI capabilities
• API updates, new endpoints, new modalities, pricing changes
• Research that directly enables a shipping product capability
• Major platform integrations that affect product availability

NOISE (exclude) — everything else:
• Tutorials, how-to guides, prompt engineering tips
• Customer case studies or success stories
• General AI safety / policy / ethics thought-leadership without a product announcement
• Company culture, hiring, awards, anniversaries
• Recap/roundup posts
• Marketing copy without new product information
• Event announcements (conferences, webinars, hackathons)

Return a JSON array — one object per input item — with exactly these fields:
  "index"    : integer (0-based, matching the input order)
  "decision" : "SIGNAL" | "NOISE"
  "category" : one of ["model_release","feature_update","api_update",
                "capability_announcement","research","policy_or_safety",
                "tutorial","case_study","marketing","event","recap","other"]
  "reason"   : one concise sentence (25 words max) explaining the decision

Rules:
• Output ONLY the JSON array — no markdown fences, no preamble, no commentary.
• Every input index must appear in the output exactly once.
• If unsure, default to NOISE.`;

// ── Helpers ──────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function cleanJson(raw) {
  return raw
    .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();
}

// ── Batch classify ───────────────────────────────────────────
async function classifyBatch(batch, apiKey) {
  const userText = batch
    .map((item, i) => `[${i}] TITLE: ${item.title}\nSUMMARY: ${item.description || 'N/A'}`)
    .join('\n\n');

  const url = `${GEMINI_BASE}/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 403) throw new Error('Gemini API 403 — invalid key. Check frontend/js/config.js');
    if (res.status === 429) throw new Error('Gemini API 429 — rate limit hit. Wait a minute and try again.');
    throw new Error(`Gemini API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const raw  = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]';

  let parsed;
  try {
    parsed = JSON.parse(cleanJson(raw));
  } catch {
    throw new Error(`Gemini returned non-JSON: ${raw.slice(0, 200)}`);
  }

  if (!Array.isArray(parsed)) throw new Error('Classification response is not an array');
  return parsed;
}

// ── Public API ───────────────────────────────────────────────
/**
 * Classifies all items in batches.
 *
 * @param {FeedItem[]} items
 * @param {string} apiKey
 * @param {{
 *   batchSize?: number,
 *   onBatch?: (batchItems: FeedItem[], batchMap: Map<string, object>) => void,
 *   onProgress?: (done: number, total: number) => void
 * }} opts
 *
 * `onBatch` fires immediately after each batch with:
 *   - batchItems: the FeedItem[] that were just classified
 *   - batchMap:   Map<guid, classification> for those items only
 *
 * This allows the caller to render cards for a batch before the next
 * batch has even been sent to the API.
 */
export async function classifyAll(items, apiKey, opts = {}) {
  const { batchSize = BATCH_SIZE, onBatch, onProgress } = opts;
  const fullMap = new Map();

  for (let start = 0; start < items.length; start += batchSize) {
    const batch = items.slice(start, start + batchSize);

    const classifications = await classifyBatch(batch, apiKey);

    // Build a per-batch map (guid → classification)
    const batchMap = new Map();
    classifications.forEach(cl => {
      const item = batch[cl.index];
      if (item) {
        batchMap.set(item.guid, cl);
        fullMap.set(item.guid, cl);
      }
    });

    // Fire streaming callback immediately with this batch's results
    if (onBatch) await onBatch(batch, batchMap);

    const done = Math.min(start + batchSize, items.length);
    onProgress?.(done, items.length);

    // Rate-limit delay (skip after final batch)
    if (start + batchSize < items.length) {
      await sleep(RPM_DELAY_MS);
    }
  }

  // Fallback: anything not classified → NOISE
  items.forEach(item => {
    if (!fullMap.has(item.guid)) {
      fullMap.set(item.guid, {
        index: -1, decision: 'NOISE', category: 'other',
        reason: 'No classification returned by model.',
      });
    }
  });

  return fullMap;
}
