import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { getMorningEntry, getEveningEntry, saveEveningEntry, todayStr } from '../db.js';
import { navigate } from '../router.js';
import { getDraft, saveDraft, clearDraft } from '../lib/journalDrafts.js';
import { micButtonHtml, wireMicButton, stopActiveDictation } from '../lib/speechToText.js';

let draft = null;
let restored = false;
const MOOD_KEYS = ['moodVeryHard', 'moodHard', 'moodOkay', 'moodGood', 'moodGreat'];

export function renderEvening(root) {
  stopActiveDictation();
  const morning = getMorningEntry(todayStr());
  const existing = getEveningEntry(todayStr());

  if (!morning) {
    root.innerHTML = `
      <div class="page">
        <button class="back-row" id="backBtn">${icon.back} ${t('back')}</button>
        <div class="empty-state card">
          <div class="icon-circle">${icon.moon}</div>
          <div class="title">${t('noMorningYetTitle')}</div>
          <div class="body">${t('noMorningYetBody')}</div>
          <button class="btn primary" id="goMorning" style="margin-top:12px;">${t('goToMorning')}</button>
        </div>
      </div>
    `;
    root.querySelector('#backBtn').addEventListener('click', () => navigate('/journal'));
    root.querySelector('#goMorning').addEventListener('click', () => navigate('/journal/morning'));
    return;
  }

  if (!draft) {
    const saved = getDraft('evening');
    restored = !!saved && Array.isArray(saved.completion) && saved.completion.length === morning.priorities.length;
    draft = restored
      ? { completion: saved.completion.map(Boolean), obstacle: String(saved.obstacle || ''), mood: [1, 2, 3, 4, 5].includes(saved.mood) ? saved.mood : 3 }
      : existing
        ? { completion: [...existing.completion], obstacle: existing.obstacle || '', mood: existing.mood || 3 }
        : { completion: morning.priorities.map(() => false), obstacle: '', mood: 3 };
  }
  const keep = () => saveDraft('evening', draft);

  root.innerHTML = `
    <div class="page">
      <button class="back-row" id="backBtn">${icon.back} ${t('back')}</button>
      <div>
        <h2 class="screen-title">${t('eveningTitle')}</h2>
        <div class="screen-subtitle">${t('eveningSubtitle')}</div>
      </div>
      ${existing ? `<div class="label-sm">${t('alreadyLoggedEvening')}</div>` : ''}
      ${restored ? `<div class="draft-note" role="status">${t('draftRestored')}</div>` : ''}

      <div style="font-size:12px; color:var(--text-muted);">${t('eveningPrompt')}</div>
      <div class="col" id="completionList">
        ${morning.priorities.map((p, i) => `
          <div class="card row between" style="padding:10px 12px; ${draft.completion[i] ? '' : 'opacity:.85;'}">
            <span style="font-size:12px; font-weight:600;">${escapeHtml(p.text || t('priorityPlaceholder', { n: i + 1 }))}</span>
            <button class="chip clickable completion-toggle ${draft.completion[i] ? 'solid' : ''}" data-i="${i}" aria-pressed="${draft.completion[i]}" aria-label="${escapeAttr(`${p.text || t('priorityPlaceholder', { n: i + 1 })}: ${draft.completion[i] ? t('markComplete') : t('markMissed')}`)}">${draft.completion[i] ? t('markComplete') : t('markMissed')}</button>
          </div>
        `).join('')}
      </div>

      <div>
        <label for="obstacleInput" style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:6px;">${t('obstaclePrompt')}</label>
        <div class="textarea-wrap">
          <textarea class="field" id="obstacleInput" rows="3" placeholder="${t('obstaclePlaceholder')}">${escapeHtml(draft.obstacle)}</textarea>
          ${micButtonHtml('eveningMic')}
        </div>
      </div>

      <div>
        <div id="moodLabel" style="font-size:12px; color:var(--text-muted); margin-bottom:8px;">${t('feelingPrompt')}</div>
        <div class="scale-dots" role="radiogroup" aria-labelledby="moodLabel">
          ${[1, 2, 3, 4, 5].map((n) => `<button class="scale-dot ${draft.mood === n ? 'on' : ''}" data-n="${n}" role="radio" aria-checked="${draft.mood === n}" aria-label="${t(MOOD_KEYS[n - 1])}"></button>`).join('')}
        </div>
        <div class="scale-ends" aria-hidden="true"><span>${t(MOOD_KEYS[0])}</span><span>${t(MOOD_KEYS[4])}</span></div>
        <div class="scale-current" aria-hidden="true">${t(MOOD_KEYS[draft.mood - 1])}</div>
      </div>

      <div style="flex:1"></div>
      <button class="btn primary" id="saveBtn">${t('logDay')}</button>
    </div>
  `;

  root.querySelector('#backBtn').addEventListener('click', () => { draft = null; navigate('/journal'); });

  root.querySelectorAll('.completion-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.i);
      draft.completion[i] = !draft.completion[i];
      keep();
      renderEvening(root);
      root.querySelector(`.completion-toggle[data-i="${i}"]`)?.focus();
    });
  });

  const obstacle = root.querySelector('#obstacleInput');
  obstacle.addEventListener('input', (e) => { draft.obstacle = e.target.value; keep(); });
  wireMicButton(root, 'eveningMic', obstacle);

  root.querySelectorAll('.scale-dot').forEach((dot) => {
    dot.addEventListener('click', () => {
      draft.obstacle = obstacle.value;
      draft.mood = Number(dot.dataset.n);
      keep();
      renderEvening(root);
      root.querySelector(`.scale-dot[data-n="${draft.mood}"]`)?.focus();
    });
  });

  root.querySelector('#saveBtn').addEventListener('click', () => {
    draft.obstacle = obstacle.value;
    saveEveningEntry(todayStr(), draft);
    clearDraft('evening');
    draft = null;
    restored = false;
    navigate('/');
  });
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
