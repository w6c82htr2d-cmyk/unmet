// Calendar-date helpers. UNMET stores days as plain 'YYYY-MM-DD' strings that mean a date on the
// user's own wall calendar, not an instant in time. Two rules keep them correct in every time zone:
//
// 1. "Today" is read from the device's local clock (getFullYear/getMonth/getDate) — never from
//    toISOString(), which reports the UTC date and is a day off for part of the day east or west
//    of UTC (e.g. Riyadh after midnight, New York in the evening).
// 2. Arithmetic on a date string (add days, weekday) is done in UTC space, where every day is
//    exactly 24h, so daylight-saving changes and the local offset can never shift the result.

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(n) {
  return String(n).padStart(2, '0');
}

// Malformed input (e.g. from a hand-edited import) must not crash a page render, so the helpers
// below degrade instead of throwing: addDays returns its input, dayOfWeek returns -1 (matches no
// weekday), daysBetween returns NaN.
function parts(dateStr) {
  const m = typeof dateStr === 'string' ? DATE_RE.exec(dateStr) : null;
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function isDateStr(value) {
  const p = parts(value);
  if (!p) return false;
  const [y, mo, d] = p;
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

// Local calendar date of a Date instant (defaults to now).
export function localDateStr(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addDays(dateStr, n) {
  const p = parts(dateStr);
  if (!p) return dateStr;
  const [y, mo, d] = p;
  const t = new Date(Date.UTC(y, mo - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function todayStr(offsetDays = 0) {
  const today = localDateStr();
  return offsetDays ? addDays(today, offsetDays) : today;
}

// 0 = Sunday … 6 = Saturday, independent of the device time zone.
export function dayOfWeek(dateStr) {
  const p = parts(dateStr);
  if (!p) return -1;
  const [y, mo, d] = p;
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

// Whole days from a to b (b - a).
export function daysBetween(a, b) {
  const pa = parts(a);
  const pb = parts(b);
  if (!pa || !pb) return NaN;
  const [y1, m1, d1] = pa;
  const [y2, m2, d2] = pb;
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

// A local Date at midday on that calendar date, for toLocaleDateString() display only. Midday
// rather than midnight because a few zones skip midnight on their daylight-saving change day.
export function dateForDisplay(dateStr) {
  const p = parts(dateStr);
  if (!p) return new Date(NaN);
  const [y, mo, d] = p;
  return new Date(y, mo - 1, d, 12);
}
