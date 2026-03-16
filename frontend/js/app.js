/**
 * app.js — streaming orchestrator
 *
 * Pipeline:
 *  Phase 1 — Fetch (parallel): all 4 sources fire simultaneously.
 *            Each source card updates as it resolves.
 *  Phase 2 — Dedup: fast synchronous pass.
 *  Phase 3 — Classify (streaming): Gemini batches fire sequentially.
 *            Cards render immediately after each batch via onBatch().
 *
 * Feed persistence: cards are NEVER cleared between runs. New items are
 * prepended so the feed accumulates across refreshes. SeenGuids ensures
 * already-rendered items are never re-classified or re-rendered.
 *
 * Auto-poll: configurable interval (default 5 min) that fires run()
 * automatically with a live countdown in the header.
 */

import { GEMINI_API_KEY }                      from './config.js';
import { RSS_SOURCES, fetchSource }             from './fetcher.js';
import { deduplicate, loadSeenGuids,
         saveSeenGuids, markSeen }              from './dedup.js';
import { classifyAll }                          from './agent.js';
import { parseDate, formatDate, relativeAge,
         escapeHtml, truncate }                 from './utils.js';
import { log }                                  from './logger.js';
import { filterStore }                          from './filters.js';

// ── State ────────────────────────────────────────────────────
let isRunning    = false;
let seenGuids    = loadSeenGuids();
let acceptedN    = 0;   // cumulative total across all runs
let rejectedN    = 0;
let startMs      = 0;
let hasEverRun   = false;

// ── Auto-poll state ──────────────────────────────────────────
let autoPollTimer     = null;
let countdownTimer    = null;
let nextRunAt         = null;
let autoPollMins      = 5;

// ── Boot ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Clear any stale seenGuids left by older versions that persisted to localStorage
  try { localStorage.removeItem('ai_signal_seen_guids'); } catch { /* ignore */ }
  startClock();
  initErrorDismiss();
  filterStore.init();
  document.getElementById('fetchBtn').addEventListener('click', () => run());
  initAutoPoll();
});

// ── Clock ─────────────────────────────────────────────────────
function startClock() {
  const el = document.getElementById('clock');
  const tick = () => {
    const n = new Date();
    const pad = x => String(x).padStart(2, '0');
    el.textContent = `${pad(n.getUTCHours())}:${pad(n.getUTCMinutes())}:${pad(n.getUTCSeconds())} UTC`;
  };
  tick();
  setInterval(tick, 1000);
}

// ── Auto-poll ─────────────────────────────────────────────────
function initAutoPoll() {
  const select = document.getElementById('autoPollSelect');
  if (!select) return;

  autoPollMins = parseInt(select.value, 10);
  select.addEventListener('change', () => {
    autoPollMins = parseInt(select.value, 10);
    restartAutoPoll();
  });

  restartAutoPoll();
}

function restartAutoPoll() {
  if (autoPollTimer)  { clearTimeout(autoPollTimer);  autoPollTimer  = null; }
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  nextRunAt = null;

  const select = document.getElementById('autoPollSelect');
  if (!select || select.value === 'off') {
    updateCountdownDisplay(null);
    return;
  }

  autoPollMins = parseInt(select.value, 10);
  scheduleNextRun();
}

function scheduleNextRun() {
  const intervalMs = autoPollMins * 60 * 1000;
  nextRunAt = new Date(Date.now() + intervalMs);

  autoPollTimer = setTimeout(async () => {
    autoPollTimer = null;
    await run();
    scheduleNextRun();
  }, intervalMs);

  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(() => updateCountdownDisplay(nextRunAt), 1000);
  updateCountdownDisplay(nextRunAt);
}

function updateCountdownDisplay(target) {
  const el = document.getElementById('countdownDisplay');
  if (!el) return;

  if (!target) {
    el.textContent = '';
    el.hidden = true;
    return;
  }

  const secsLeft = Math.max(0, Math.round((target - Date.now()) / 1000));
  const m = Math.floor(secsLeft / 60);
  const s = secsLeft % 60;
  el.textContent = `Next in ${m}:${String(s).padStart(2, '0')}`;
  el.hidden = false;
}

// ── Config guard ──────────────────────────────────────────────
function checkConfig() {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY_HERE') {
    const msg =
      'No API key found.\n\n' +
      '1. Open  frontend/js/config.js\n' +
      '2. Replace YOUR_GEMINI_API_KEY_HERE with your key\n' +
      '3. Free key: https://aistudio.google.com/apikey';
    showError(msg);
    log.error('Missing Gemini API key — check frontend/js/config.js');
    return false;
  }
  return true;
}

// ── Progress bar ──────────────────────────────────────────────
function setProgress(pct) {
  const track = document.getElementById('progressTrack');
  const fill  = document.getElementById('progressFill');
  track.hidden = false;
  fill.style.width = `${Math.min(100, pct)}%`;
  if (pct >= 100) {
    setTimeout(() => { track.hidden = true; fill.style.width = '0%'; }, 800);
  }
}

// ── Status pill ───────────────────────────────────────────────
function setStatusText(text, state = '') {
  const pill = document.getElementById('sourceStatus');
  const txt  = document.getElementById('sourceStatusText');
  pill.className = `nav-pill ${state}`;
  txt.textContent = text;
}

// ── Source cards ──────────────────────────────────────────────
function setSourceCard(provider, state, statusText) {
  const card   = document.querySelector(`.source-card[data-provider="${provider}"]`);
  const status = document.getElementById(`src-${provider}`);
  if (!card) return;
  card.className = `source-card ${state}`;
  if (status) status.textContent = statusText;
}

// ── Counts ────────────────────────────────────────────────────
function updateCount(type, n) {
  document.getElementById(`${type}Count`).textContent = n;
}

// ── Error banner ──────────────────────────────────────────────
function initErrorDismiss() {
  document.getElementById('errorDismiss')
    ?.addEventListener('click', hideError);
}
function showError(msg) {
  if (!msg?.trim()) return;
  const el  = document.getElementById('errorBanner');
  const txt = document.getElementById('errorText');
  txt.textContent = msg;
  el.hidden = false;
}
function hideError() {
  document.getElementById('errorBanner').hidden = true;
}

// ── Skeleton loaders ──────────────────────────────────────────
function showSkeletons(streamId, n = 3) {
  const stream = document.getElementById(streamId);
  if (stream.querySelectorAll('.news-card').length > 0) return; // already has cards
  for (let i = 0; i < n; i++) {
    const sk = document.createElement('div');
    sk.className = 'card-skeleton';
    sk.dataset.skeleton = '1';
    sk.innerHTML = `
      <div class="skel-line w30"></div>
      <div class="skel-line h14 w80" style="margin:10px 0 8px"></div>
      <div class="skel-line w100"></div>
      <div class="skel-line w60" style="margin-top:6px"></div>`;
    stream.appendChild(sk);
  }
}

function clearSkeletons(streamId) {
  document.getElementById(streamId)
    ?.querySelectorAll('[data-skeleton]')
    .forEach(el => el.remove());
}

function clearEmpty(streamId) {
  document.getElementById(streamId)
    ?.querySelectorAll('.stream-empty')
    .forEach(el => el.remove());
}

// ── "New items" toast ─────────────────────────────────────────
function showNewItemsToast(count, runN) {
  if (runN <= 1 || count === 0) return;

  const existing = document.getElementById('newItemsToast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'newItemsToast';
  toast.className = 'new-items-toast';
  toast.innerHTML = `
    <span class="toast-icon">✦</span>
    <span class="toast-msg">${count} new signal item${count !== 1 ? 's' : ''} added</span>
    <button class="toast-dismiss" aria-label="Dismiss">✕</button>
  `;
  toast.querySelector('.toast-dismiss').addEventListener('click', () => toast.remove());
  document.body.appendChild(toast);
  setTimeout(() => toast?.remove(), 6000);
}

// ── Run divider ───────────────────────────────────────────────
let runCounter = 0;

function insertRunDivider(streamId, runNum, timestamp) {
  if (runNum <= 1) return;
  const container = document.getElementById(streamId);
  if (!container) return;

  const divider = document.createElement('div');
  divider.className = 'run-divider';
  divider.dataset.run = runNum;
  divider.innerHTML = `<span class="run-divider-label">↑ Run #${runNum} · ${timestamp}</span>`;
  container.insertBefore(divider, container.firstChild);
}

// ── Card rendering (prepend, not append) ─────────────────────
function prependCard(streamId, item, classification, isNew) {
  clearSkeletons(streamId);
  clearEmpty(streamId);

  const date       = parseDate(item.pubDate);
  const catLabel   = (classification.category ?? 'unknown').replace(/_/g, ' ');
  const isRejected = classification.decision !== 'SIGNAL';

  const card = document.createElement('article');
  card.className = `news-card${isRejected ? ' rejected' : ''}${isNew ? ' card-new' : ''}`;
  card.dataset.provider = item.provider;

  card.innerHTML = `
    <div class="card-head">
      <span class="card-provider" data-p="${escapeHtml(item.provider)}">${escapeHtml(item.providerName)}</span>
      ${!isRejected ? `<span class="card-category">${escapeHtml(catLabel)}</span>` : ''}
      ${isNew ? `<span class="card-badge-new">NEW</span>` : ''}
      <span class="card-date" title="${escapeHtml(item.pubDate)}">${relativeAge(date) || formatDate(date)}</span>
    </div>
    <div class="card-title">
      ${item.link
        ? `<a href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>`
        : escapeHtml(item.title)}
    </div>
    ${item.description && !isRejected
      ? `<p class="card-summary">${escapeHtml(truncate(item.description, 200))}</p>`
      : ''}
    ${!isRejected && classification.reason
      ? `<p class="card-reason">→ ${escapeHtml(classification.reason)}</p>`
      : ''}
    ${isRejected && classification.reason
      ? `<div class="card-reject-reason">${escapeHtml(classification.reason)}</div>`
      : ''}
  `;

  const container = document.getElementById(streamId);
  // Insert right after the run-divider for this run (if present), else at top
  const divider = container.querySelector(`.run-divider[data-run="${runCounter}"]`);
  if (divider) {
    divider.insertAdjacentElement('afterend', card);
  } else {
    container.insertBefore(card, container.firstChild);
  }

  return card;
}

// ── Stats strip ───────────────────────────────────────────────
function updateStats(totalFetchedThisRun, dedupThisRun) {
  document.getElementById('statAccepted').textContent  = acceptedN;
  document.getElementById('statRejected').textContent  = rejectedN;
  document.getElementById('statDedup').textContent     = dedupThisRun;
  document.getElementById('statFetched').textContent   = totalFetchedThisRun;
  document.getElementById('statRuntime').textContent   = ((Date.now() - startMs) / 1000).toFixed(1) + 's';
  document.getElementById('runTimestamp').textContent  = new Date().toUTCString();
  document.getElementById('statsStrip').hidden = false;
}

// ── Main run ──────────────────────────────────────────────────
async function run() {
  if (isRunning) return;
  if (!checkConfig()) return;

  isRunning = true;
  startMs   = Date.now();
  runCounter++;
  const thisRun = runCounter;

  const btn = document.getElementById('fetchBtn');
  btn.disabled = true;
  btn.querySelector('.run-btn-label').textContent = 'Fetching…';

  hideError();
  setStatusText('Fetching feeds…', 'running');
  setProgress(5);

  // First-ever run: clear placeholder empties. Subsequent runs: keep all cards.
  if (!hasEverRun) {
    ['acceptedStream', 'rejectedStream'].forEach(id => {
      document.getElementById(id).innerHTML = '';
    });
    updateCount('accepted', 0);
    updateCount('rejected', 0);
    document.getElementById('statsStrip').hidden = true;
  }

  showSkeletons('acceptedStream', 3);

  RSS_SOURCES.forEach(s => setSourceCard(s.provider, 'fetching', '…'));

  log.separator();
  log.running();
  log.info(`Run #${thisRun} started — fetching ${RSS_SOURCES.length} sources in parallel`);

  // ── Phase 1: Fetch ───────────────────────────────────────────
  let allItems     = [];
  let totalFetched = 0;
  let fetchedSoFar = 0;

  const fetchPromises = RSS_SOURCES.map(source =>
    fetchSource(source)
      .then(result => {
        fetchedSoFar++;
        if (result.items.length > 0) {
          allItems.push(...result.items);
          totalFetched += result.items.length;
          setSourceCard(source.provider, 'done', `${result.items.length} items`);
          log.success(`${source.name} → ${result.items.length} items fetched`);
        } else {
          setSourceCard(source.provider, 'error', 'unavailable');
          log.warn(`${source.name} → feed unavailable or empty${result.error ? ` (${result.error.split('\n')[0]})` : ''}`);
        }
        setProgress(5 + (fetchedSoFar / RSS_SOURCES.length) * 30);
        return result;
      })
      .catch(err => {
        fetchedSoFar++;
        setSourceCard(source.provider, 'error', 'failed');
        log.error(`${source.name} → fetch failed: ${err.message}`);
        setProgress(5 + (fetchedSoFar / RSS_SOURCES.length) * 30);
        return { items: [], error: err.message };
      })
  );

  await Promise.all(fetchPromises);
  setProgress(35);
  log.info(`Fetch complete — ${totalFetched} total items from ${RSS_SOURCES.length} sources`);

  if (allItems.length === 0) {
    clearSkeletons('acceptedStream');
    if (!hasEverRun) {
      document.getElementById('acceptedStream').innerHTML =
        '<div class="stream-empty">No items fetched — check network or try again.</div>';
    }
    showError('All RSS feeds returned empty. Check network and try again.');
    log.error('All feeds returned empty — aborting');
    setStatusText('Failed', 'error');
    log.done();
    finish(btn);
    hasEverRun = true;
    return;
  }

  // ── Phase 2: Dedup ───────────────────────────────────────────
  setStatusText('Deduplicating…', 'running');
  log.info('Running deduplication…');

  const { fresh, dupCount, seenCount } = deduplicate(allItems, seenGuids);
  const removed = dupCount + seenCount;

  setProgress(40);

  if (dupCount > 0)   log.info(`Within-run duplicates removed: ${dupCount}`);
  if (seenCount > 0)  log.info(`Already seen from prior runs: ${seenCount}`);
  log.success(`Dedup complete — ${fresh.length} fresh items to classify`);

  if (fresh.length === 0) {
    clearSkeletons('acceptedStream');
    if (!hasEverRun) {
      document.getElementById('acceptedStream').innerHTML =
        '<div class="stream-empty">No new items since last run.</div>';
    }
    updateStats(totalFetched, removed);
    log.info('Nothing new — run complete');
    setStatusText('Up to date', 'done');
    log.done();
    finish(btn);
    hasEverRun = true;
    return;
  }

  // ── Phase 3: Classify ────────────────────────────────────────
  btn.querySelector('.run-btn-label').textContent = 'Classifying…';
  setStatusText(`Classifying ${fresh.length} items…`, 'running');

  const BATCH      = 15;
  let classified   = 0;
  const batchTotal = Math.ceil(fresh.length / BATCH);
  let batchNum     = 0;

  // Prepend a divider above this run's incoming cards
  const runTimestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  insertRunDivider('acceptedStream', thisRun, runTimestamp);
  insertRunDivider('rejectedStream', thisRun, runTimestamp);

  log.info(`Starting classification — ${fresh.length} items in ${batchTotal} batch${batchTotal > 1 ? 'es' : ''} of ${BATCH}`);

  let newSignalThisRun = 0;

  async function onBatch(batchItems, batchMap) {
    batchNum++;
    classified += batchItems.length;
    const pct = 40 + (classified / fresh.length) * 55;
    setProgress(pct);
    setStatusText(`Classifying… ${classified}/${fresh.length}`, 'running');

    let batchAccepted = 0;
    let batchRejected = 0;

    const sorted = [...batchItems].sort((a, b) => {
      const da = parseDate(a.pubDate), db = parseDate(b.pubDate);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return db - da;
    });

    for (const item of sorted) {
      const cl = batchMap.get(item.guid) ?? {
        decision: 'NOISE', category: 'other', reason: 'No classification returned.'
      };
      if (cl.decision === 'SIGNAL') {
        clearSkeletons('acceptedStream');
        acceptedN++;
        newSignalThisRun++;
        batchAccepted++;
        updateCount('accepted', acceptedN);
        const cardEl = prependCard('acceptedStream', item, cl, true);
        filterStore.add('acceptedStream', item, cl, cardEl);
        log.success(`[SIGNAL] ${item.providerName} — ${item.title.slice(0, 70)}${item.title.length > 70 ? '…' : ''}`);
      } else {
        rejectedN++;
        batchRejected++;
        updateCount('rejected', rejectedN);
        const cardEl = prependCard('rejectedStream', item, cl, false);
        filterStore.add('rejectedStream', item, cl, cardEl);
        log.info(`[noise]  ${item.providerName} — ${item.title.slice(0, 60)}${item.title.length > 60 ? '…' : ''}`);
      }
    }

    log.batch(
      `Batch ${batchNum}/${batchTotal} done — ` +
      `${batchAccepted} signal, ${batchRejected} noise` +
      (batchNum < batchTotal ? ` (waiting ~4s for rate limit…)` : '')
    );

    filterStore.applyAll();
    document.getElementById('toolbar').hidden = false;
    updateStats(totalFetched, removed);
    btn.querySelector('.run-btn-label').textContent =
      `${acceptedN} signal, ${rejectedN} filtered`;
  }

  try {
    await classifyAll(fresh, GEMINI_API_KEY, { batchSize: BATCH, onBatch });
  } catch (err) {
    showError(`Classification error: ${err.message}`);
    log.error(`Gemini error: ${err.message}`);
    setStatusText('Error', 'error');
    log.done();
    finish(btn);
    hasEverRun = true;
    return;
  }

  markSeen(fresh, seenGuids);
  saveSeenGuids(seenGuids);

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  log.success(
    `Run #${thisRun} complete — ${newSignalThisRun} new signal, ${fresh.length - newSignalThisRun} filtered, ` +
    `${removed} deduped, ${elapsed}s total`
  );

  showNewItemsToast(newSignalThisRun, thisRun);

  setProgress(100);
  setStatusText(`Done — ${acceptedN} signal total`, 'done');
  updateStats(totalFetched, removed);
  log.done();
  finish(btn);
  hasEverRun = true;
}

// ── Finish ────────────────────────────────────────────────────
function finish(btn) {
  isRunning = false;
  btn.disabled = false;
  btn.querySelector('.run-btn-label').textContent = 'Refresh Updates';
}
