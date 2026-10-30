import { t, getLang } from '../i18n.js';
import { icon } from '../icons.js';
import { getMorningEntry, getEveningEntry, todayStr, getFreeformEntries } from '../db.js';
import { navigate } from '../router.js';
import { getDraft } from '../lib/journalDrafts.js';

export function renderJournalHub(root) {
  const hasMorning = !!getMorningEntry(todayStr());
  const hasEvening = !!getEveningEntry(todayStr());
  const freeform = getFreeformEntries();
  const freeformCount = freeform.length;
  const morning = getMorningEntry(todayStr());
  const setCount = morning ? morning.priorities.filter((p) => p.text && p.text.trim()).length : 0;
  const draftNote = (kind, daily = true) => (getDraft(kind, { daily }) ? `<div class="hub-draft">${t('hubDraft')}</div>` : '');
  const last = freeform[0] ? new Date(freeform[0].createdAt).toLocaleDateString(getLang() === 'ar' ? 'ar' : 'en-US', { month: 'short', day: 'numeric' }) : '';

  root.innerHTML = `
    <div class="page">
      <div>
        <h1 class="screen-title">${t('navJournal')}</h1>
        <div class="screen-subtitle">${t('journalHubNote')}</div>
      </div>

      <button class="card row journal-link" data-path="/journal/morning" style="text-align:start; border:none; cursor:pointer;">
        <div class="icon-circle ${hasMorning ? 'filled' : ''}">${icon.sun}</div>
        <div class="grow">
          <div style="font-weight:700; font-size:13px;">${t('morningTitle')}</div>
          <div style="font-size:12px; color:var(--text-muted);">${hasMorning ? t('hubMorningSet', { n: setCount }) : t('morningSubtitle')}</div>
          ${draftNote('morning')}
        </div>
        ${hasMorning ? `<span class="chip solid">${t('done')}</span>` : ''}
      </button>

      <button class="card row journal-link" data-path="/journal/evening" style="text-align:start; border:none; cursor:pointer;">
        <div class="icon-circle ${hasEvening ? 'filled' : ''}">${icon.moon}</div>
        <div class="grow">
          <div style="font-weight:700; font-size:13px;">${t('eveningTitle')}</div>
          <div style="font-size:12px; color:var(--text-muted);">${t('eveningSubtitle')}</div>
          ${draftNote('evening')}
        </div>
        ${hasEvening ? `<span class="chip solid">${t('done')}</span>` : ''}
      </button>

      <button class="card row journal-link" data-path="/journal/freeform" style="text-align:start; border:none; cursor:pointer;">
        <div class="icon-circle">${icon.sparkle}</div>
        <div class="grow">
          <div style="font-weight:700; font-size:13px;">${t('freeformTitle')}</div>
          <div style="font-size:12px; color:var(--text-muted);">${last ? t('hubLastEntry', { date: last }) : t('freeformSubtitle')}</div>
          ${draftNote('freeform', false)}
        </div>
        ${freeformCount ? `<span class="chip">${freeformCount}</span>` : ''}
      </button>
    </div>
  `;

  root.querySelectorAll('.journal-link').forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.path));
  });
}
