/**
 * filters.js
 * Filter + sort engine for the AI Signal card feed.
 *
 * Strategy: all rendered cards are stored in `cardStore` as rich
 * objects (item data + DOM node). Filtering/sorting never re-fetches
 * or re-classifies — it manipulates the existing DOM nodes by toggling
 * the `filtered-out` class and re-ordering them in the stream container.
 *
 * Public API:
 *   filterStore.add(streamId, item, classification)  — called by app.js per card
 *   filterStore.applyAll()                           — re-runs all active filters+sort
 *   filterStore.clear()                              — wipe state on new run
 *   filterStore.init()                               — wire up toolbar event listeners
 */

import { parseDate } from './utils.js';

// ── State ─────────────────────────────────────────────────────

const cardStore = {
  accepted: [],   // [{ item, classification, el }]
  rejected: [],
};

let activeFilters = {
  search:   '',
  provider: 'all',
  category: 'all',
  sort:     'date-desc',
};

// ── Public API ────────────────────────────────────────────────

export const filterStore = {

  /** Register a newly rendered card with the store. */
  add(streamId, item, classification, el) {
    const bucket = streamId === 'acceptedStream' ? 'accepted' : 'rejected';
    cardStore[bucket].push({ item, classification, el });
    // Don't re-apply on every add during streaming — too expensive.
    // applyAll() is called after each batch instead.
  },

  /** Wipe state (call at start of each run). */
  clear() {
    cardStore.accepted = [];
    cardStore.rejected = [];
    activeFilters = { search: '', provider: 'all', category: 'all', sort: 'date-desc' };
    _resetToolbarUI();
  },

  /** Wire all toolbar controls. Call once on DOMContentLoaded. */
  init() {
    // Search
    const searchInput = document.getElementById('filterSearch');
    const clearBtn    = document.getElementById('clearSearch');

    searchInput?.addEventListener('input', () => {
      activeFilters.search = searchInput.value.trim().toLowerCase();
      clearBtn.hidden = !activeFilters.search;
      filterStore.applyAll();
    });

    clearBtn?.addEventListener('click', () => {
      searchInput.value = '';
      activeFilters.search = '';
      clearBtn.hidden = true;
      filterStore.applyAll();
    });

    // Provider chips
    document.getElementById('providerChips')
      ?.addEventListener('click', e => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        activeFilters.provider = chip.dataset.provider;
        filterStore.applyAll();
      });

    // Category select
    document.getElementById('filterCategory')
      ?.addEventListener('change', e => {
        activeFilters.category = e.target.value;
        e.target.classList.toggle('active', e.target.value !== 'all');
        filterStore.applyAll();
      });

    // Sort select
    document.getElementById('sortOrder')
      ?.addEventListener('change', e => {
        activeFilters.sort = e.target.value;
        filterStore.applyAll();
      });

    // Reset button
    document.getElementById('toolbarReset')
      ?.addEventListener('click', () => {
        filterStore.clear();
        filterStore.applyAll();
      });
  },

  /** Re-run all active filters + sort and update the DOM. */
  applyAll() {
    _applyToStream('acceptedStream', cardStore.accepted);
    _applyToStream('rejectedStream', cardStore.rejected);
    _updateToolbarState();
  },
};

// ── Internal helpers ──────────────────────────────────────────

function _matches(entry) {
  const { item, classification } = entry;

  // Search filter
  if (activeFilters.search) {
    const haystack = (item.title + ' ' + (item.description ?? '')).toLowerCase();
    if (!haystack.includes(activeFilters.search)) return false;
  }

  // Provider filter
  if (activeFilters.provider !== 'all') {
    if (item.provider !== activeFilters.provider) return false;
  }

  // Category filter
  if (activeFilters.category !== 'all') {
    if (classification?.category !== activeFilters.category) return false;
  }

  return true;
}

function _sortEntries(entries) {
  const sorted = [...entries];

  switch (activeFilters.sort) {
    case 'date-desc':
      sorted.sort((a, b) => _dateDiff(b, a));
      break;
    case 'date-asc':
      sorted.sort((a, b) => _dateDiff(a, b));
      break;
    case 'provider':
      sorted.sort((a, b) =>
        (a.item.providerName ?? '').localeCompare(b.item.providerName ?? '') ||
        _dateDiff(b, a)
      );
      break;
    case 'category':
      sorted.sort((a, b) =>
        (a.classification?.category ?? '').localeCompare(b.classification?.category ?? '') ||
        _dateDiff(b, a)
      );
      break;
  }

  return sorted;
}

function _dateDiff(a, b) {
  const da = parseDate(a.item.pubDate);
  const db = parseDate(b.item.pubDate);
  if (!da && !db) return 0;
  if (!da) return 1;
  if (!db) return -1;
  return db - da;
}

function _applyToStream(streamId, entries) {
  const container = document.getElementById(streamId);
  if (!container) return;

  // Remove stale filter-empty placeholders
  container.querySelectorAll('.filter-empty').forEach(el => el.remove());

  const sorted  = _sortEntries(entries);
  let visibleN  = 0;

  // Reorder nodes + toggle visibility
  sorted.forEach(entry => {
    const visible = _matches(entry);
    entry.el.classList.toggle('filtered-out', !visible);
    if (visible) visibleN++;
    // Move node to end to enforce sort order
    container.appendChild(entry.el);
  });

  // Show empty state if everything is filtered out
  if (entries.length > 0 && visibleN === 0) {
    const msg = document.createElement('div');
    msg.className = 'filter-empty';
    msg.textContent = 'No items match the current filters.';
    container.appendChild(msg);
  }

  return visibleN;
}

function _updateToolbarState() {
  const hasFilter =
    activeFilters.search ||
    activeFilters.provider !== 'all' ||
    activeFilters.category !== 'all';

  const resetBtn = document.getElementById('toolbarReset');
  if (resetBtn) resetBtn.hidden = !hasFilter;

  // Count visible accepted cards only (the "signal" column is what users care about)
  const visibleAccepted = cardStore.accepted.filter(_matches).length;
  const totalAccepted   = cardStore.accepted.length;

  const countEl = document.getElementById('toolbarResultCount');
  if (countEl) {
    if (hasFilter && totalAccepted > 0) {
      countEl.textContent = `${visibleAccepted} of ${totalAccepted} signal items`;
    } else {
      countEl.textContent = '';
    }
  }
}

function _resetToolbarUI() {
  const searchInput = document.getElementById('filterSearch');
  if (searchInput) searchInput.value = '';

  const clearBtn = document.getElementById('clearSearch');
  if (clearBtn) clearBtn.hidden = true;

  document.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('active', c.dataset.provider === 'all');
  });

  const catSelect = document.getElementById('filterCategory');
  if (catSelect) { catSelect.value = 'all'; catSelect.classList.remove('active'); }

  const sortSelect = document.getElementById('sortOrder');
  if (sortSelect) sortSelect.value = 'date-desc';

  const resetBtn = document.getElementById('toolbarReset');
  if (resetBtn) resetBtn.hidden = true;

  const countEl = document.getElementById('toolbarResultCount');
  if (countEl) countEl.textContent = '';
}
