/**
 * dedup.js
 * Two-layer deduplication for feed items.
 *
 * Layer 1 – within-run: normalise titles and discard near-duplicates that
 *            appear in multiple feeds during the same fetch.
 * Layer 2 – cross-run (session-only): an in-memory Set tracks GUIDs seen
 *            during this page session so auto-poll runs don't re-show cards
 *            already visible on screen. Intentionally NOT persisted to
 *            localStorage — a page reload always shows a fresh feed.
 */

// ── Normalisation ─────────────────────────────────────────────────────────────

/**
 * Produces a collision key from a title for within-run dedup.
 * Strips punctuation/spaces and takes the first 60 chars.
 * @param {string} title
 * @returns {string}
 */
export function normaliseTitle(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 60);
}

// ── Session-scoped seen-GUID helpers ──────────────────────────────────────────

/**
 * Returns a fresh empty Set. Lives only for this page session —
 * reloading the page resets it automatically, so closing and re-opening
 * always shows a full fresh feed.
 * @returns {Set<string>}
 */
export function loadSeenGuids() {
  return new Set();
}

/**
 * No-op: we no longer persist seen GUIDs across sessions.
 * Kept so call-sites in app.js don't need to change.
 * @param {Set<string>} _set
 */
export function saveSeenGuids(_set) {
  // intentionally empty — session-only dedup, nothing to persist
}

/**
 * No-op: nothing to clear since we never write to localStorage.
 */
export function clearSeenGuids() {
  // intentionally empty
}

// ── Main dedup function ───────────────────────────────────────────────────────

/**
 * Deduplicates an array of FeedItems.
 *
 * Returns:
 *  - `fresh`     — items that are genuinely new (pass both layers)
 *  - `dupCount`  — removed in layer 1 (same-run cross-feed duplicates)
 *  - `seenCount` — removed in layer 2 (already rendered this session)
 *
 * Does NOT mutate the seenGuids set — call `markSeen` after classification
 * so we only track items we actually surfaced.
 *
 * @param {import('./fetcher.js').FeedItem[]} items
 * @param {Set<string>} seenGuids
 * @returns {{ fresh: import('./fetcher.js').FeedItem[], dupCount: number, seenCount: number }}
 */
export function deduplicate(items, seenGuids) {
  // Layer 1: within-run dedup by normalised title
  const titleSeen  = new Map();
  const afterLayer1 = [];
  let dupCount = 0;

  for (const item of items) {
    const key = normaliseTitle(item.title);
    if (titleSeen.has(key)) {
      dupCount++;
    } else {
      titleSeen.set(key, true);
      afterLayer1.push(item);
    }
  }

  // Layer 2: session dedup by GUID (in-memory only, resets on page load)
  const fresh = [];
  let seenCount = 0;

  for (const item of afterLayer1) {
    if (seenGuids.has(item.guid)) {
      seenCount++;
    } else {
      fresh.push(item);
    }
  }

  return { fresh, dupCount, seenCount };
}

/**
 * Adds items' GUIDs to the seen set.
 * Call this after classifying and rendering items.
 *
 * @param {import('./fetcher.js').FeedItem[]} items
 * @param {Set<string>} seenGuids  — mutated in place
 */
export function markSeen(items, seenGuids) {
  for (const item of items) seenGuids.add(item.guid);
}
