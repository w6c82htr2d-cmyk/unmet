import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { getFreeformEntries, addFreeformEntry, setFreeformPlan, addHabit, addGoal } from '../db.js';
import { planFromJournal, isStubActive } from '../lib/aiPlan.js';
import { splitGoal } from '../lib/taskSplitter.js';
import { navigate } from '../router.js';

let activeTab = 'write';
let draftText = '';
let generating = false;
let currentEntry = null;

export function renderFreeform(root) {
  const entries = getFreeformEntries();

  root.innerHTML = `
    <div class="page">
      <button class="back-row" id="backBtn">${icon.back} ${t('back')}</button>
      <div>
        <h2 class="screen-title">${t('freeformTitle')}</h2>
        <div class="screen-subtitle">${t('freeformSubtitle')}</div>
      </div>

      <div class="toggle-pill" id="tabs" style="align-self:flex-start;">
        <button data-val="write" class="${activeTab === 'write' ? 'active' : ''}">${t('writeTab')}</button>
        <button data-val="plan" class="${activeTab === 'plan' ? 'active' : ''}">${t('planTab')}</button>
      </div>

      <div id="tabContent"></div>

      ${entries.length ? `
        <div>
          <div class="section-head" style="margin-bottom:8px;"><span class="title">${t('savedEntries')}</span></div>
          <div class="col">
            ${entries.slice(0, 8).map(entryRow).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;

  root.querySelector('#backBtn').addEventListener('click', () => navigate('/journal'));
  root.querySelectorAll('#tabs button').forEach((btn) => {
    btn.addEventListener('click', () => { activeTab = btn.dataset.val; renderFreeform(root); });
  });

  renderTabContent(root);
}

function renderTabContent(root) {
  const container = root.querySelector('#tabContent');

  if (activeTab === 'write') {
    container.innerHTML = `
      <div class="col" style="flex:1;">
        <textarea class="field" id="brainDump" style="min-height:180px;" placeholder="${t('brainDumpPlaceholder')}">${escapeHtml(draftText)}</textarea>
        <button class="btn primary" id="planBtn" ${generating ? 'disabled' : ''}>
          ${icon.sparkle} ${generating ? t('generatingPlan') : t('turnIntoPlan')}
        </button>
      </div>
    `;
    const textarea = container.querySelector('#brainDump');
    textarea.addEventListener('input', (e) => { draftText = e.target.value; });
    container.querySelector('#planBtn').addEventListener('click', async () => {
      const text = textarea.value.trim();
      if (!text) return;
      generating = true;
      renderTabContent(root);
      currentEntry = addFreeformEntry(text);
      const plan = await planFromJournal(text);
      setFreeformPlan(currentEntry.id, plan);
      currentEntry.plan = plan;
      generating = false;
      draftText = '';
      activeTab = 'plan';
      renderFreeform(root);
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
      <div style="font-size:10.5px; color:var(--text-muted);">${escapeHtml(g.firstStep.label)}</div>
      <button class="btn secondary sm goal-action" data-goal-id="${g.id}" style="align-self:flex-start; margin-top:4px;">
        ${g.firstStep.type === 'task' ? t('editPlan') : (g.firstStep.type === 'stack' ? t('addHabit') : t('addEvent'))}
      </button>
    </div>
  `;
}

function entryRow(entry) {
  const date = new Date(entry.createdAt).toLocaleDateString();
  return `
    <div class="card">
      <div style="font-size:11.5px; color:var(--text-muted); margin-bottom:4px;">${date}</div>
      <div style="font-size:12px;">${escapeHtml(entry.text.slice(0, 120))}${entry.text.length > 120 ? '…' : ''}</div>
      ${entry.plan ? `<div class="chip solid" style="margin-top:6px;">${entry.plan.goals.length} ${t('yourGoals')}</div>` : ''}
    </div>
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
