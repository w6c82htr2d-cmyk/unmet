// Safe import/restore. Anything that replaces data on this device (a backup file import, a sync-code
// pull, restoring a backup) goes through here so that:
//  - incoming data is validated before a single key is written (a bad file changes nothing),
//  - the current data is saved as a local backup first, so the change can be undone,
//  - the user sees what is about to change before confirming.
import { exportAll, importAll, replaceAll } from '../db.js';
import { isDateStr } from './dates.js';

const BACKUP_KEY = 'unmet_backup';
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_TEXT = 20000;
const TIME_RE = /^\d{2}:\d{2}$/;
// Ids end up inside HTML attributes (data-id="…"), so only characters that can't break out of one.
const ID_RE = /^[A-Za-z0-9_.:@-]{1,100}$/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v, max = MAX_TEXT) => typeof v === 'string' && v.length <= max;
const isOptStr = (v, max) => v === undefined || v === null || isStr(v, max);
const isId = (v) => typeof v === 'string' && ID_RE.test(v);
const isOptId = (v) => v === undefined || v === null || isId(v);
const isOptDate = (v) => v === undefined || v === null || isDateStr(v);

function validHabit(h) {
  return isObj(h) && isId(h.id) && isStr(h.name, 500)
    && (h.history === undefined || (isObj(h.history) && Object.entries(h.history).every(([k, v]) => isDateStr(k) && (v === null || ['boolean', 'number'].includes(typeof v)))))
    && (h.scheduleType === undefined || h.scheduleType === 'independent' || h.scheduleType === 'stacked')
    && (h.days === undefined || (Array.isArray(h.days) && h.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)))
    && (h.stackEventIds === undefined || (Array.isArray(h.stackEventIds) && h.stackEventIds.every(isId)))
    && isOptStr(h.createdAt, 40)
    && (h.stackPosition === undefined || h.stackPosition === 'before' || h.stackPosition === 'after')
    && isOptStr(h.time, 5) && isOptStr(h.stackAfter, 500)
    && (h.remind === undefined || typeof h.remind === 'boolean');
}

function validEvent(e) {
  return isObj(e) && isId(e.id) && isOptId(e.seriesId) && isStr(e.title, 500)
    && (e.type === 'once' || e.type === 'weekly')
    && isStr(e.start, 5) && TIME_RE.test(e.start) && isStr(e.end, 5) && TIME_RE.test(e.end)
    && (e.type !== 'once' || isDateStr(e.date))
    && (e.type !== 'weekly' || (Number.isInteger(e.dayOfWeek) && e.dayOfWeek >= 0 && e.dayOfWeek <= 6))
    && isOptDate(e.startDate) && isOptDate(e.endDate)
    && (e.excludeDates === undefined || (Array.isArray(e.excludeDates) && e.excludeDates.every(isDateStr)));
}

const validDateMap = (m) => isObj(m) && Object.entries(m).every(([k, v]) => isDateStr(k) && isObj(v));
const validPlan = (p) => p === null || p === undefined
  || (isObj(p) && Array.isArray(p.goals) && p.goals.every((g) => isObj(g) && isStr(g.text, 2000) && (g.firstStep === undefined || isObj(g.firstStep))));
const validFreeform = (f) => isObj(f) && isId(f.id) && isStr(f.text) && validPlan(f.plan);
const validGoal = (g) => isObj(g) && isId(g.id) && isStr(g.text, 2000)
  && Array.isArray(g.subtasks) && g.subtasks.every((s) => isObj(s) && isId(s.id) && isStr(s.text, 2000));
const validProfile = (p) => p === null || (isObj(p) && isOptStr(p.firstName, 100)
  && (p.goalTracks === undefined || (Array.isArray(p.goalTracks) && p.goalTracks.every(isId))));

// Section key → validator. Keys mirror db.js KEYS (the export format).
const SECTIONS = {
  unmet_profile: validProfile,
  unmet_habits: (v) => Array.isArray(v) && v.every(validHabit),
  unmet_events: (v) => Array.isArray(v) && v.every(validEvent),
  unmet_morning: validDateMap,
  unmet_evening: validDateMap,
  unmet_freeform: (v) => Array.isArray(v) && v.every(validFreeform),
  unmet_goals: (v) => Array.isArray(v) && v.every(validGoal),
  unmet_calendar_view: (v) => v === 'agenda' || v === 'day' || v === 'week',
};

// Returns { ok: true, data } with only known sections, or { ok: false, section } naming the first
// invalid section ('format' when the file isn't an UNMET export at all). Nothing is written here.
export function validateImportData(raw) {
  if (!isObj(raw)) return { ok: false, section: 'format' };
  const data = {};
  for (const [key, check] of Object.entries(SECTIONS)) {
    if (raw[key] === undefined) continue;
    if (!check(raw[key])) return { ok: false, section: key };
    data[key] = raw[key];
  }
  if (!Object.keys(data).length) return { ok: false, section: 'format' };
  return { ok: true, data };
}

export function parseImportText(text) {
  if (typeof text !== 'string' || text.length > MAX_IMPORT_BYTES) return { ok: false, section: 'size' };
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, section: 'format' };
  }
  return validateImportData(raw);
}

// Counts for the confirmation screen.
export function summarize(data) {
  const habits = data.unmet_habits || [];
  const events = data.unmet_events || [];
  return {
    habits: habits.length,
    completions: habits.reduce((n, h) => n + Object.values(h.history || {}).filter(Boolean).length, 0),
    routines: new Set(events.map((e) => e.seriesId || e.id)).size,
    journal: Object.keys(data.unmet_morning || {}).length + Object.keys(data.unmet_evening || {}).length + (data.unmet_freeform || []).length,
    goals: (data.unmet_goals || []).length,
  };
}

// Saves the current data as the single local backup. Returns false if the browser refused (e.g.
// storage full) — callers must then fall back to a downloaded copy before changing anything.
export function saveBackup(reason) {
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify({ createdAt: new Date().toISOString(), reason, data: exportAll() }));
    return true;
  } catch {
    return false;
  }
}

export function getBackup() {
  try {
    const b = JSON.parse(localStorage.getItem(BACKUP_KEY) || 'null');
    return b && isObj(b.data) ? b : null;
  } catch {
    return null;
  }
}

// Import: sections present in the file replace the same sections here; others are left alone.
// All-or-nothing: if the browser refuses one section part-way, the sections already written are put
// back, and the error is re-thrown so the caller doesn't report success.
function atomically(change) {
  const before = exportAll();
  try {
    change();
  } catch (err) {
    try {
      replaceAll(before);
    } catch {
      // Rolling back failed too; the local backup (or downloaded copy) is the safety net.
    }
    throw err;
  }
}

export function applyImport(validData) {
  atomically(() => importAll(validData));
}

// Restore swaps the backup with the current data, so restoring can itself be undone.
export function restoreBackup() {
  const backup = getBackup();
  if (!backup) return false;
  const current = exportAll();
  atomically(() => replaceAll(backup.data));
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify({ createdAt: new Date().toISOString(), reason: 'restore', data: current }));
  } catch {
    // The restore itself succeeded; only the swap-back copy couldn't be kept.
  }
  return true;
}

export function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
