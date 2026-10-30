import { exportAll } from '../db.js';
import { validateImportData, saveBackup, downloadJson, applyImport } from './backup.js';
import { localDateStr } from './dates.js';

const CODE_KEY = 'unmet_sync_code';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L, less mis-typing

export function generateCode(length = 8) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export function getSavedCode() {
  return localStorage.getItem(CODE_KEY);
}

export function saveCodeLocally(code) {
  localStorage.setItem(CODE_KEY, code);
}

export function forgetCodeLocally() {
  localStorage.removeItem(CODE_KEY);
}

async function callSync(action, code, data) {
  const res = await fetch('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, code, data }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || 'Sync request failed.');
  }
  return body;
}

export async function pushToCode(code) {
  await callSync('push', code, exportAll());
}

export async function pullFromCode(code) {
  const { data } = await callSync('pull', code);
  // Same safeguards as a file import: validate first, back up the current data, then apply.
  const result = validateImportData(data);
  if (!result.ok) throw new Error('Synced data failed validation.');
  if (!saveBackup('sync-pull')) downloadJson(exportAll(), `unmet-backup-${localDateStr()}.json`);
  applyImport(result.data);
}
