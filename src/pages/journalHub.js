import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { getMorningEntry, getEveningEntry, todayStr, getFreeformEntries } from '../db.js';
import { navigate } from '../router.js';

export function renderJournalHub(root) {
  const hasMorning = !!getMorningEntry(todayStr());
  const hasEvening = !!getEveningEntry(todayStr());
  const freeformCount = getFreeformEntries().length;

  root.innerHTML = `
    <div class="page">
      <div>
        <h2 class="screen-title">${t('navJournal')}</h2>
      </div>

      <button class="card row journal-link" data-path="/journal/morning" style="text-align:start; border:none; cursor:pointer;">
        <div class="icon-circle ${hasMorning ? 'filled' : ''}">${icon.sun}</div>
        <div class="grow">
          <div style="font-weight:700; font-size:13px;">${t('morningTitle')}</div>
          <div style="font-size:11px; color:var(--text-muted);">${t('morningSubtitle')}</div>
        </div>
        ${hasMorning ? `<span class="chip solid">${t('done')}</span>` : ''}
      </button>

      <button class="card row journal-link" data-path="/journal/evening" style="text-align:start; border:none; cursor:pointer;">
        <div class="icon-circle ${hasEvening ? 'filled' : ''}">${icon.moon}</div>
        <div class="grow">
          <div style="font-weight:700; font-size:13px;">${t('eveningTitle')}</div>
          <div style="font-size:11px; color:var(--text-muted);">${t('eveningSubtitle')}</div>
        </div>
        ${hasEvening ? `<span class="chip solid">${t('done')}</span>` : ''}
      </button>

      <button class="card row journal-link" data-path="/journal/freeform" style="text-align:start; border:none; cursor:pointer;">
        <div class="icon-circle">${icon.sparkle}</div>
        <div class="grow">
          <div style="font-weight:700; font-size:13px;">${t('freeformTitle')}</div>
          <div style="font-size:11px; color:var(--text-muted);">${t('freeformSubtitle')}</div>
        </div>
        ${freeformCount ? `<span class="chip">${freeformCount}</span>` : ''}
      </button>
    </div>
  `;

  root.querySelectorAll('.journal-link').forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.path));
  });
}
