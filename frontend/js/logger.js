/**
 * logger.js
 * In-UI log panel for the AI Signal dashboard.
 *
 * API:
 *   log.info(msg)     grey  — general info
 *   log.success(msg)  green — something completed successfully
 *   log.warn(msg)     amber — non-fatal issue
 *   log.error(msg)    red   — something failed
 *   log.batch(msg)    blue  — per-batch classification result
 *   log.separator()         — visual divider between runs
 *   log.clear()             — wipe all entries
 *
 * The panel is toggled via a floating button.
 * Error-level entries flash the toggle button red.
 * A badge on the toggle counts unseen errors during a run.
 */

// ── State ────────────────────────────────────────────────────
let errorCount   = 0;
let panelOpen    = false;
let initialized  = false;

// ── DOM refs (resolved lazily after DOMContentLoaded) ────────
function $id(id) { return document.getElementById(id); }

// ── Init ─────────────────────────────────────────────────────
function init() {
  if (initialized) return;
  initialized = true;

  const toggle = $id('logToggle');
  const panel  = $id('logPanel');
  const close  = $id('logClose');
  const clear  = $id('logClear');

  toggle.addEventListener('click', () => {
    panelOpen = !panelOpen;
    panel.classList.toggle('open', panelOpen);

    if (panelOpen) {
      // Reset error badge when panel is opened
      errorCount = 0;
      const badge = $id('logBadge');
      badge.hidden = true;
      badge.textContent = '0';
      toggle.classList.remove('has-errors');
      scrollToBottom();
    }
  });

  close.addEventListener('click', () => {
    panelOpen = false;
    panel.classList.remove('open');
  });

  clear.addEventListener('click', () => {
    $id('logEntries').innerHTML = '';
    errorCount = 0;
    $id('logBadge').hidden = true;
    toggle.classList.remove('has-errors');
  });
}

// ── Timestamp ─────────────────────────────────────────────────
function ts() {
  const n   = new Date();
  const pad = x => String(x).padStart(2, '0');
  return `${pad(n.getUTCHours())}:${pad(n.getUTCMinutes())}:${pad(n.getUTCSeconds())}`;
}

// ── Level icons ───────────────────────────────────────────────
const ICONS = {
  info:    '·',
  success: '✓',
  warn:    '▲',
  error:   '✕',
  batch:   '◆',
};

// ── Core append ───────────────────────────────────────────────
function append(level, msg) {
  init();

  const entries = $id('logEntries');
  if (!entries) return;

  // Remove the "idle" placeholder on first real entry
  entries.querySelectorAll('.log-idle').forEach(el => el.remove());

  const li = document.createElement('li');
  li.className = `log-entry log-${level}`;
  li.innerHTML = `
    <span class="log-ts">${ts()}</span>
    <span class="log-icon">${ICONS[level] ?? '·'}</span>
    <span class="log-msg">${escapeLogHtml(String(msg))}</span>
  `;
  entries.appendChild(li);

  // Auto-scroll if panel is open
  if (panelOpen) scrollToBottom();

  // Error badge on toggle button
  if (level === 'error') {
    errorCount++;
    const badge = $id('logBadge');
    if (!panelOpen) {
      badge.textContent = errorCount;
      badge.hidden = false;
    }
    $id('logToggle').classList.add('has-errors');
  }
}

function scrollToBottom() {
  const entries = $id('logEntries');
  if (entries) entries.scrollTop = entries.scrollHeight;
}

// Safe HTML — only escapes, no sanitize library needed for log text
function escapeLogHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Set toggle running state ──────────────────────────────────
function setRunning(isRunning) {
  $id('logToggle')?.classList.toggle('running', isRunning);
}

// ── Public API ────────────────────────────────────────────────
export const log = {
  info:      msg => append('info',    msg),
  success:   msg => append('success', msg),
  warn:      msg => append('warn',    msg),
  error:     msg => append('error',   msg),
  batch:     msg => append('batch',   msg),
  running:   ()  => setRunning(true),
  done:      ()  => setRunning(false),
  separator: ()  => {
    init();
    const sep = document.createElement('li');
    sep.className = 'log-separator';
    $id('logEntries')?.appendChild(sep);
  },
  clear: () => {
    init();
    const entries = $id('logEntries');
    if (entries) entries.innerHTML = '';
    errorCount = 0;
    const badge = $id('logBadge');
    if (badge) { badge.hidden = true; badge.textContent = '0'; }
    $id('logToggle')?.classList.remove('has-errors', 'running');
  },
  open: () => {
    init();
    panelOpen = true;
    $id('logPanel')?.classList.add('open');
  },
};
