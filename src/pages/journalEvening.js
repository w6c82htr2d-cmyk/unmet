import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { getMorningEntry, getEveningEntry, saveEveningEntry, todayStr } from '../db.js';
import { navigate } from '../router.js';

let draft = null;

export function renderEvening(root) {
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
    draft = existing
      ? { completion: [...existing.completion], obstacle: existing.obstacle || '', mood: existing.mood || 3 }
      : { completion: morning.priorities.map(() => false), obstacle: '', mood: 3 };
  }

  root.innerHTML = `
    <div class="page">
      <button class="back-row" id="backBtn">${icon.back} ${t('back')}</button>
      <div>
        <h2 class="screen-title">${t('eveningTitle')}</h2>
        <div class="screen-subtitle">${t('eveningSubtitle')}</div>
      </div>
      ${existing ? `<div class="label-sm">${t('alreadyLoggedEvening')}</div>` : ''}

      <div style="font-size:12px; color:var(--text-muted);">${t('eveningPrompt')}</div>
      <div class="col" id="completionList">
        ${morning.priorities.map((p, i) => `
          <div class="card row between" style="padding:10px 12px; ${draft.completion[i] ? '' : 'opacity:.85;'}">
            <span style="font-size:12px; font-weight:600;">${escapeHtml(p.text || t('priorityPlaceholder', { n: i + 1 }))}</span>
            <button class="chip clickable completion-toggle ${draft.completion[i] ? 'solid' : ''}" data-i="${i}">${draft.completion[i] ? t('markComplete') : t('markMissed')}</button>
          </div>
        `).join('')}
      </div>

      <div>
        <div style="font-size:12px; color:var(--text-muted); margin-bottom:6px;">${t('obstaclePrompt')}</div>
        <textarea class="field" id="obstacleInput" rows="2" placeholder="${t('obstaclePlaceholder')}">${escapeHtml(draft.obstacle)}</textarea>
      </div>

      <div>
        <div style="font-size:12px; color:var(--text-muted); margin-bottom:8px;">${t('feelingPrompt')}</div>
        <div class="scale-dots">
          ${[1, 2, 3, 4, 5].map((n) => `<button class="scale-dot ${draft.mood === n ? 'on' : ''}" data-n="${n}"></button>`).join('')}
        </div>
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
      renderEvening(root);
    });
  });

  root.querySelector('#obstacleInput').addEventListener('input', (e) => { draft.obstacle = e.target.value; });

  root.querySelectorAll('.scale-dot').forEach((dot) => {
    dot.addEventListener('click', () => { draft.mood = Number(dot.dataset.n); renderEvening(root); });
  });

  root.querySelector('#saveBtn').addEventListener('click', () => {
    saveEveningEntry(todayStr(), draft);
    draft = null;
    navigate('/checkin');
  });
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
