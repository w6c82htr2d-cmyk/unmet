// App-wide warning shown when the browser refuses to save. Like the undo toast it lives on
// document.body, so page re-renders can't remove it; it stays until the user dismisses it.
import { t } from '../i18n.js';
import { exportAll } from '../db.js';
import { downloadJson } from './backup.js';
import { localDateStr } from './dates.js';

let el = null;

export function showStorageWarning(kind = 'failed') {
  if (el) el.remove();
  el = document.createElement('div');
  el.className = 'storage-warning';
  el.setAttribute('role', 'alert');
  const title = document.createElement('div');
  title.className = 'sw-title';
  title.textContent = t(kind === 'unavailable' ? 'storageUnavailableTitle' : 'storageFailedTitle');
  const body = document.createElement('div');
  body.className = 'sw-body';
  body.textContent = t(kind === 'unavailable' ? 'storageUnavailableBody' : 'storageFailedBody');
  const actions = document.createElement('div');
  actions.className = 'sw-actions';
  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'btn secondary sm';
  exportBtn.textContent = t('exportData');
  exportBtn.addEventListener('click', () => downloadJson(exportAll(), `unmet-export-${localDateStr()}.json`));
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn ghost sm';
  closeBtn.textContent = t('dismissBtn');
  closeBtn.addEventListener('click', hideStorageWarning);
  actions.append(exportBtn, closeBtn);
  el.append(title, body, actions);
  document.body.appendChild(el);
}

export function hideStorageWarning() {
  if (el) el.remove();
  el = null;
}

// True if this browser lets UNMET write at all (false in some private modes or with storage blocked).
export function storageWorks() {
  try {
    localStorage.setItem('unmet_probe', '1');
    localStorage.removeItem('unmet_probe');
    return true;
  } catch {
    return false;
  }
}
