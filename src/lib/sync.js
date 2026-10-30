import { exportAll } from '../db.js';
import { validateImportData, saveBackup, downloadJson, applyImport } from './backup.js';
import { localDateStr } from './dates.js';

const CODE_KEY = 'unmet_sync_code';
const META_KEY = 'unmet_sync_meta'; // { rev, lastPush, lastPull, expiresAt } for this device
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L, less mis-typing
export const NEW_CODE_LENGTH = 12; // 32^12 ≈ 2^60 possible codes

// 256 is a multiple of 32, so `b % 32` is unbiased.
export function generateCode(length = NEW_CODE_LENGTH) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

// People may type codes with spaces, dashes or lowercase letters.
export function normalizeCode(input) {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Shown in groups of four for readability: ABCD-EFGH-JKLM.
export function formatCode(code) {
  return String(code || '').replace(/(.{4})(?=.)/g, '$1-');
}

export function getSavedCode() {
  return localStorage.getItem(CODE_KEY);
}

export function getSyncMeta() {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) || 'null') || {};
  } catch {
    return {};
  }
}

function saveSyncMeta(update) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify({ ...getSyncMeta(), ...update }));
  } catch {
    // Only affects the "last synced" display and conflict check; the sync itself succeeded.
  }
}

export function saveCodeLocally(code) {
  localStorage.setItem(CODE_KEY, code);
}

export function forgetCodeLocally() {
  localStorage.removeItem(CODE_KEY);
  localStorage.removeItem(META_KEY);
}

async function callSync(action, code, extra = {}) {
  const res = await fetch('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, code, ...extra }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || 'Sync request failed.');
    err.code = body.code || `http_${res.status}`; // conflict, rate_limited, not_found, …
    throw err;
  }
  return body;
}

// Uploads this device's data. Sends the revision this device last saw, so the server refuses
// (code 'conflict') instead of overwriting newer data pushed from another device.
export async function pushToCode(code, { force = false } = {}) {
  const meta = getSyncMeta();
  const extra = { data: exportAll() };
  if (!force && Number.isInteger(meta.rev)) extra.baseRev = meta.rev;
  const { rev, expiresAt } = await callSync('push', code, extra);
  saveSyncMeta({ rev, expiresAt, lastPush: new Date().toISOString() });
}

export async function pullFromCode(code) {
  const { data, rev, expiresAt } = await callSync('pull', code);
  // Same safeguards as a file import: validate first, back up the current data, then apply.
  const result = validateImportData(data);
  if (!result.ok) throw new Error('Synced data failed validation.');
  if (!saveBackup('sync-pull')) downloadJson(exportAll(), `unmet-backup-${localDateStr()}.json`);
  applyImport(result.data);
  saveSyncMeta({ rev, expiresAt, lastPull: new Date().toISOString() });
}

// Deletes the copy stored on the server (the data on this device stays).
export async function deleteRemoteCopy(code) {
  await callSync('delete', code);
  forgetCodeLocally();
}
