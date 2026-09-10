import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { getMorningEntry, saveMorningEntry, todayStr } from '../db.js';
import { navigate } from '../router.js';

const IMPORTANCE_LEVELS = ['high', 'medium', 'low'];

let draft = null;

function freshPriorities() {
  return [0, 1, 2].map(() => ({ text: '', importance: 'medium', minutes: '' }));
}

export function renderMorning(root) {
  const existing = getMorningEntry(todayStr());
  if (!draft) {
    draft = existing ? existing.priorities.map((p) => ({ ...p })) : freshPriorities();
  }

  root.innerHTML = `
    <div class="page">
      <button class="back-row" id="backBtn">${icon.back} ${t('back')}</button>
      <div>
        <h2 class="screen-title">${t('morningTitle')}</h2>
        <div class="screen-subtitle">${t('morningSubtitle')}</div>
      </div>
      ${existing ? `<div class="label-sm">${t('alreadyLoggedMorning')}</div>` : ''}
      <div style="font-size:12px; color:var(--text-muted);">${t('morningPrompt')}</div>

      <div class="col" id="priorityList">
        ${draft.map((p, i) => priorityCard(p, i)).join('')}
      </div>

      <div style="flex:1"></div>
      <button class="btn primary" id="saveBtn">${existing ? t('updateMorning') : t('startDay')}</button>
    </div>
  `;

  root.querySelector('#backBtn').addEventListener('click', () => { draft = null; navigate('/journal'); });

  root.querySelectorAll('.priority-text').forEach((input) => {
    input.addEventListener('input', () => { draft[Number(input.dataset.i)].text = input.value; });
  });
  root.querySelectorAll('.priority-minutes').forEach((input) => {
    input.addEventListener('input', () => { draft[Number(input.dataset.i)].minutes = input.value; });
  });
  root.querySelectorAll('.importance-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      draft[Number(chip.dataset.i)].importance = chip.dataset.level;
      renderMorning(root);
    });
  });

  root.querySelector('#saveBtn').addEventListener('click', () => {
    saveMorningEntry(todayStr(), draft);
    draft = null;
    navigate('/');
  });
}

function priorityCard(p, i) {
  return `
    <div class="card col">
      <div class="row" style="gap:8px;">
        <div class="chip solid" style="min-width:20px; justify-content:center;">${i + 1}</div>
        <input class="field grow priority-text" data-i="${i}" placeholder="${t('priorityPlaceholder', { n: i + 1 })}" value="${escapeAttr(p.text)}" />
      </div>
      <div class="row between">
        <div class="row" style="gap:4px;">
          ${IMPORTANCE_LEVELS.map((lvl) => `
            <button class="chip clickable importance-chip ${p.importance === lvl ? 'accent' : ''}" data-i="${i}" data-level="${lvl}">${t('tag' + capitalize(lvl))}</button>
          `).join('')}
        </div>
        <span class="label-sm">${t('timeEstimate')}</span>
        <input class="field priority-minutes" data-i="${i}" type="number" min="0" style="width:64px; padding:6px 8px;" placeholder="${t('timeEstimatePlaceholder')}" value="${p.minutes || ''}" />
      </div>
    </div>
  `;
}

function capitalize(s) {
  if (s === 'medium') return 'Med';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function escapeAttr(s) {
  return String(s || '').replace(/"/g, '&quot;');
}
