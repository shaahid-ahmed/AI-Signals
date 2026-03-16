/**
 * utils.js
 * Shared date helpers, DOM utilities, and string sanitisation.
 */

// ── Date helpers ─────────────────────────────────────────────────────────────

/**
 * Parses any reasonable date string into a Date object.
 * Returns null if the string cannot be parsed.
 * @param {string|null|undefined} str
 * @returns {Date|null}
 */
export function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Formats a Date as "MMM D, YYYY" (e.g. "Mar 4, 2025").
 * @param {Date|null} date
 * @returns {string}
 */
export function formatDate(date) {
  if (!date) return 'Unknown';
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Returns a human-readable relative age string.
 * Examples: "today", "1 day ago", "3 weeks ago", "2 months ago", "1 year ago"
 * @param {Date|null} date
 * @returns {string}
 */
export function relativeAge(date) {
  if (!date) return '';
  const diffMs = Date.now() - date.getTime();
  const days = Math.floor(diffMs / 86_400_000);

  if (days < 1)  return 'today';
  if (days === 1) return '1 day ago';
  if (days < 7)  return `${days} days ago`;
  if (days < 14) return '1 week ago';
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 60) return '1 month ago';
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? '1 year ago' : `${years} years ago`;
}

/**
 * Returns the UTC time string "HH:MM:SS UTC".
 * @returns {string}
 */
export function utcTimeString() {
  return new Date().toUTCString().slice(17, 25) + ' UTC';
}

// ── String / DOM helpers ─────────────────────────────────────────────────────

/**
 * Escapes a string for safe insertion as HTML text content.
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  return (str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Adds or removes a CSS class based on a boolean condition.
 * @param {Element} el
 * @param {string} cls
 * @param {boolean} condition
 */
export function toggleClass(el, cls, condition) {
  el.classList.toggle(cls, condition);
}

/**
 * Shows or hides an element using the `hidden` attribute.
 * @param {Element} el
 * @param {boolean} visible
 */
export function setVisible(el, visible) {
  el.hidden = !visible;
}

/**
 * Clamps a string to a max character count, appending "…" if truncated.
 * @param {string} str
 * @param {number} max
 * @returns {string}
 */
export function truncate(str, max = 180) {
  if (!str || str.length <= max) return str ?? '';
  return str.slice(0, max) + '…';
}
