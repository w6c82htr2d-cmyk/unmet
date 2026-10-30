import { t, getLang } from '../i18n.js';
import { icon } from '../icons.js';
import { getFreeformEntries, addFreeformEntry, setFreeformPlan, addHabit, addGoal, isStorageError } from '../db.js';
import { planFromJournal, isStubActive } from '../lib/aiPlan.js';
import { splitGoal } from '../lib/taskSplitter.js';
import { navigate } from '../router.js';
import { micButtonHtml, wireMicButton, stopActiveDictation } from '../lib/speechToText.js';
import { getDraft, saveDraft, clearDraft } from '../lib/journalDrafts.js';

let activeTab = 'write';
let draftText = null; // null until read from the on-device draft
let savedMsg = '';
let showAll = false;
let generating = false;
let currentEntry = null;
let planError = null;

export function renderFreeform(root) {
  stopActiveDictation();
  const entries = getFreeformEntries();

  root.innerHTML = `
    <div class="page">
      <button class="back-row" id="backBtn">${icon.back} ${t('back')}</button>
      <div>
        <h2 class="screen-title">${t('freeformTitle')}</h2>
        <div class="screen-subtitle">${t('freeformSubtitle')}</div>
      </div>

      <div class="toggle-pill" id="tabs" style="align-self:flex-start;">
        <button data-val="write" class="${activeTab === 'write' ? 'active' : ''}" aria-pressed="${activeTab === 'write'}">${t('writeTab')}</button>
        <button data-val="plan" class="${activeTab === 'plan' ? 'active' : ''}" aria-pressed="${activeTab === 'plan'}">${t('planTab')}</button>
      </div>

      <div id="tabContent"></div>

      ${entries.length ? `
        <section aria-labelledby="pastEntriesHeading">
          <h3 class="section-title" id="pastEntriesHeading" style="margin-bottom:8px;">${t('savedEntries')} <span class="count-note">(${entries.length})</span></h3>
          <div class="col">
            ${(showAll ? entries : entries.slice(0, 8)).map(entryRow).join('')}
          </div>
          ${entries.length > 8 && !showAll ? `<button class="btn ghost" id="showAllEntries">${t('showAllEntries', { n: entries.length })}</button>` : ''}
        </section>
      ` : ''}
    </div>
  `;

  root.querySelector('#backBtn').addEventListener('click', () => navigate('/journal'));
  root.querySelectorAll('#tabs button').forEach((btn) => {
    btn.addEventListener('click', () => { activeTab = btn.dataset.val; renderFreeform(root); });
  });
  root.querySelector('#showAllEntries')?.addEventListener('click', () => { showAll = true; renderFreeform(root); });
  root.querySelectorAll('.open-plan').forEach((btn) => btn.addEventListener('click', () => {
    const entry = getFreeformEntries().find((e) => e.id === btn.dataset.id);
    if (!entry || !entry.plan) return;
    currentEntry = entry;
    activeTab = 'plan';
    renderFreeform(root);
    window.scrollTo(0, 0);
  }));

  renderTabContent(root);
}

function renderTabContent(root) {
  stopActiveDictation();
  const container = root.querySelector('#tabContent');

  if (activeTab === 'write') {
    if (draftText === null) draftText = String(getDraft('freeform', { daily: false }) || '');
    container.innerHTML = `
      <div class="col" style="flex:1;">
        <div class="textarea-wrap">
          <textarea class="field" id="brainDump" style="min-height:180px;" placeholder="${t('brainDumpPlaceholder')}" aria-label="${escapeHtml(t('freeformTitle'))}">${escapeHtml(draftText)}</textarea>
          ${micButtonHtml('journalMic')}
        </div>
        <div class="draft-status form-note" aria-live="polite">${draftText ? t('draftKept') : ''}</div>
        <button class="btn primary" id="saveEntryBtn" ${generating ? 'disabled' : ''}>${t('saveEntryOnly')}</button>
        <button class="btn secondary" id="planBtn" ${generating ? 'disabled' : ''}>
          ${icon.sparkle} ${generating ? t('generatingPlan') : t('turnIntoPlan')}
        </button>
        <p class="form-note">${t('freeformAiNote')}</p>
        ${savedMsg ? `<div class="label-sm" role="status">${escapeHtml(savedMsg)}</div>` : ''}
        ${planError ? `<div class="label-sm" style="color:var(--danger);">${escapeHtml(planError)}</div>` : ''}
      </div>
    `;
    const textarea = container.querySelector('#brainDump');
    textarea.addEventListener('input', (e) => {
      draftText = e.target.value;
      savedMsg = '';
      if (draftText.trim()) saveDraft('freeform', draftText); else clearDraft('freeform');
      container.querySelector('.draft-status').textContent = draftText ? t('draftKept') : '';
    });
    wireMicButton(root, 'journalMic', textarea);
    container.querySelector('#saveEntryBtn').addEventListener('click', () => {
      const text = textarea.value.trim();
      if (!text) { textarea.focus(); return; }
      addFreeformEntry(text); // stays on this device; nothing is sent anywhere
      clearDraft('freeform');
      draftText = '';
      planError = null;
      savedMsg = t('entrySavedPrivately');
      renderFreeform(root);
    });
    container.querySelector('#planBtn').addEventListener('click', async () => {
      const text = textarea.value.trim();
      if (!text) return;
      generating = true;
      planError = null;
      renderTabContent(root);
      try {
        const entry = addFreeformEntry(text);
        const plan = await planFromJournal(text);
        setFreeformPlan(entry.id, plan);
        entry.plan = plan;
        currentEntry = entry;
        generating = false;
        draftText = '';
        clearDraft('freeform');
        activeTab = 'plan';
        renderFreeform(root);
      } catch (err) {
        // A storage failure is reported by the app-wide warning; don't blame the AI for it.
        planError = isStorageError(err) ? t('storageNotSavedShort') : t(err?.status === 429 ? 'planRateLimited' : 'planErrorNotice');
        generating = false;
        renderTabContent(root);
      }
    });
    return;
  }

  // plan tab
  if (!currentEntry || !currentEntry.plan) {
    container.innerHTML = `
      <div class="empty-state card">
        <div class="icon-circle">${icon.sparkle}</div>
        <div class="title">${t('noEntryYetTitle')}</div>
        <div class="body">${t('noEntryYetBody')}</div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="col">
      ${isStubActive() ? `<div class="row" style="gap:6px;"><span class="label-sm" style="color:var(--accent);">${t('aiStubNotice')}</span></div>` : ''}
      <div class="row" style="gap:6px;">
        <span style="color:var(--accent); display:flex;">${icon.sparkle}</span>
        <span class="label-sm" style="color:var(--accent);">${t('aiPlanHeading')}</span>
      </div>
      ${currentEntry.plan.goals.map((g) => planGoalCard(g)).join('')}
    </div>
  `;

  container.querySelectorAll('.goal-action').forEach((btn) => {
    btn.addEventListener('click', () => {
      const goalId = btn.dataset.goalId;
      const goal = currentEntry.plan.goals.find((g) => g.id === goalId);
      if (!goal) return;
      if (goal.firstStep.type === 'stack') {
        addHabit({ name: goal.text, stackAfter: '' });
        btn.textContent = t('stackedNote', { habit: goal.text });
      } else if (goal.firstStep.type === 'task') {
        const created = addGoal({ text: goal.text, subtasks: splitGoal(goal.text) });
        navigate('/tasks');
      } else {
        navigate('/calendar');
      }
    });
  });
}

function planGoalCard(g) {
  return `
    <div class="card plan-goal-card">
      <div class="row between">
        <span style="font-size:12px; font-weight:700;">${escapeHtml(g.text)}</span>
        <span class="chip accent">${t('tag' + capitalize(g.importance))}</span>
      </div>
      <div style="font-size:11.5px; color:var(--text-muted);">${escapeHtml(g.firstStep.label)}</div>
      <button class="btn secondary sm goal-action" data-goal-id="${g.id}" style="align-self:flex-start; margin-top:4px;">
        ${g.firstStep.type === 'task' ? t('editPlan') : (g.firstStep.type === 'stack' ? t('addHabit') : t('addEvent'))}
      </button>
    </div>
  `;
}

function entryRow(entry) {
  const date = new Date(entry.createdAt).toLocaleDateString(getLang() === 'ar' ? 'ar' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const long = entry.text.length > 140;
  return `
    <article class="card entry-card">
      <div class="entry-date">${escapeHtml(date)}</div>
      ${long ? `
        <details class="entry-full">
          <summary><span class="entry-preview">${escapeHtml(entry.text.slice(0, 140))}…</span><span class="entry-more">${t('readFullEntry')}</span><span class="entry-less">${t('showLessEntry')}</span></summary>
          <div class="entry-text">${escapeHtml(entry.text)}</div>
        </details>
      ` : `<div class="entry-text">${escapeHtml(entry.text)}</div>`}
      ${entry.plan ? `<button class="btn secondary sm open-plan" data-id="${entry.id}">${icon.sparkle} ${t('openEntryPlan', { n: entry.plan.goals.length })}</button>` : ''}
    </article>
  `;
}

function capitalize(s) {
  if (s === 'medium') return 'Med';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
