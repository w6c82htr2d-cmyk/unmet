// Unsaved journal text, kept on this device so a reload, a closed tab or a wrong tap never loses
// what someone was writing. Morning and evening drafts belong to one day; a draft from an earlier
// day is ignored. Drafts never leave the device and are removed once the entry is saved.
import { todayStr } from '../db.js';

const KEY = 'unmet_journal_drafts';

function readAll() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function writeAll(all) {
  try {
    if (Object.keys(all).length) localStorage.setItem(KEY, JSON.stringify(all));
    else localStorage.removeItem(KEY);
  } catch {
    // Drafts are a convenience: if storage is full the entry itself still saves normally.
  }
}

export function getDraft(kind, { daily = true } = {}) {
  const d = readAll()[kind];
  if (!d || (daily && d.date !== todayStr())) return null;
  return d.value;
}

export function saveDraft(kind, value) {
  const all = readAll();
  all[kind] = { date: todayStr(), value };
  writeAll(all);
}

export function clearDraft(kind) {
  const all = readAll();
  delete all[kind];
  writeAll(all);
}
