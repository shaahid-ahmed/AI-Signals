/**
 * render.js
 * Builds the accepted and rejected table rows from classified items.
 * Pure DOM manipulation — no framework dependencies.
 */

import { parseDate, formatDate, relativeAge, escapeHtml, truncate } from './utils.js';

// ── Accepted table ───────────────────────────────────────────────────────────

/**
 * @param {Array<{ item: import('./fetcher.js').FeedItem, classification: object, isNew: boolean }>} entries
 */
export function renderAccepted(entries) {
  const tbody = document.getElementById('acceptedBody');
  const count = document.getElementById('acceptedCount');
  tbody.innerHTML = '';

  count.textContent = `${entries.length} item${entries.length !== 1 ? 's' : ''}`;

  if (entries.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">No signal items found in this batch.</td></tr>`;
    return;
  }

  // Sort newest-first by published date
  const sorted = [...entries].sort((a, b) => {
    const da = parseDate(a.item.pubDate);
    const db = parseDate(b.item.pubDate);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return db - da;
  });

  sorted.forEach(({ item, classification, isNew }, i) => {
    const date = parseDate(item.pubDate);
    const catLabel = (classification.category ?? 'unknown').replace(/_/g, ' ');

    const tr = document.createElement('tr');
    tr.style.animationDelay = `${i * 25}ms`;

    tr.innerHTML = `
      <td>
        <span class="provider-badge ${escapeHtml(item.provider)}">
          ${escapeHtml(item.providerName)}
        </span>
      </td>
      <td>
        <div class="item-title">
          <a href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">
            ${escapeHtml(item.title)}
          </a>
          ${isNew ? '<span class="badge-new">NEW</span>' : ''}
        </div>
        ${item.description
          ? `<div class="item-summary">${escapeHtml(truncate(item.description, 160))}</div>`
          : ''}
        ${classification.reason
          ? `<div class="item-reason">${escapeHtml(classification.reason)}</div>`
          : ''}
      </td>
      <td><span class="category-tag">${escapeHtml(catLabel)}</span></td>
      <td>
        <div class="date-primary">${formatDate(date)}</div>
        <div class="date-age">${relativeAge(date)}</div>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

// ── Rejected table ───────────────────────────────────────────────────────────

/**
 * @param {Array<{ item: import('./fetcher.js').FeedItem, classification: object }>} entries
 */
export function renderRejected(entries) {
  const tbody = document.getElementById('rejectedBody');
  const count = document.getElementById('rejectedCount');
  tbody.innerHTML = '';

  count.textContent = `${entries.length} item${entries.length !== 1 ? 's' : ''}`;

  if (entries.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Nothing filtered — all items were accepted as signal.</td></tr>`;
    return;
  }

  const sorted = [...entries].sort((a, b) => {
    const da = parseDate(a.item.pubDate);
    const db = parseDate(b.item.pubDate);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return db - da;
  });

  sorted.forEach(({ item, classification }, i) => {
    const date = parseDate(item.pubDate);

    const tr = document.createElement('tr');
    tr.style.animationDelay = `${i * 20}ms`;

    tr.innerHTML = `
      <td>
        <span class="provider-badge ${escapeHtml(item.provider)}">
          ${escapeHtml(item.providerName)}
        </span>
      </td>
      <td>
        <div class="item-title">
          <a href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">
            ${escapeHtml(item.title)}
          </a>
        </div>
      </td>
      <td>
        <div class="reject-reason">
          ${escapeHtml(classification.reason ?? classification.category ?? 'filtered')}
        </div>
      </td>
      <td>
        <div class="date-primary">${formatDate(date)}</div>
        <div class="date-age">${relativeAge(date)}</div>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

// ── Stats bar ────────────────────────────────────────────────────────────────

/**
 * Populates the summary stat bar.
 * @param {{ accepted:number, rejected:number, dedup:number, fetched:number, runtimeMs:number }} stats
 */
export function renderStats({ accepted, rejected, dedup, fetched, runtimeMs }) {
  document.getElementById('statAccepted').textContent = accepted;
  document.getElementById('statRejected').textContent = rejected;
  document.getElementById('statDedup').textContent = dedup;
  document.getElementById('statFetched').textContent = fetched;
  document.getElementById('statRuntime').textContent = (runtimeMs / 1000).toFixed(1) + 's';
}
