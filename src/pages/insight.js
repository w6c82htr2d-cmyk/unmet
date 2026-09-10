import { t, getLang } from '../i18n.js';
import { icon } from '../icons.js';
import { detectPattern } from '../lib/patterns.js';
import { weekdayKey } from '../lib/patterns.js';
import { navigate } from '../router.js';

export function renderInsight(root) {
  const pattern = detectPattern();

  if (!pattern) {
    root.innerHTML = `
      <div class="page">
        <button class="back-row" id="backBtn">${icon.back} ${t('back')}</button>
        <div class="empty-state card">
          <div class="icon-circle">${icon.warnTriangle}</div>
          <div class="title">${t('noPatternTitle')}</div>
          <div class="body">${t('noPatternBody')}</div>
        </div>
      </div>
    `;
    root.querySelector('#backBtn').addEventListener('click', () => navigate('/checkin'));
    return;
  }

  const day = t(weekdayKey(pattern.weekday));
  const body = getLang() === 'ar'
    ? `فوّتّ "${escapeHtml(pattern.text)}" في يوم ${day} لـ ${pattern.count} مرات متتالية.`
    : `You've missed "${escapeHtml(pattern.text)}" on ${day}s ${pattern.count} times.`;

  root.innerHTML = `
    <div class="page">
      <button class="back-row" id="backBtn">${icon.back} ${t('back')}</button>

      <div class="insight-icon-wrap">${icon.warnTriangle}</div>
      <div class="center-text">
        <h2 class="screen-title">${t('insightScreenTitle')}</h2>
      </div>
      <div class="card center-text" style="font-size:12.5px; line-height:1.6;">${body}</div>

      <div class="card strong">
        <div class="label-sm" style="margin-bottom:5px;">${t('nextStepLabel')}</div>
        <div style="font-size:12.5px; font-weight:700;">${t('nextStepGeneric', { text: escapeHtml(pattern.text) })}</div>
      </div>

      <div style="flex:1"></div>
      <button class="btn primary" id="gotItBtn">${t('gotIt')}</button>
      <button class="btn secondary" id="adjustBtn">${t('adjustSchedule')}</button>
    </div>
  `;

  root.querySelector('#backBtn').addEventListener('click', () => navigate('/checkin'));
  root.querySelector('#gotItBtn').addEventListener('click', () => navigate('/'));
  root.querySelector('#adjustBtn').addEventListener('click', () => navigate('/calendar'));
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
