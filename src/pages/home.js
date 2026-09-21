import { t, getLang } from '../i18n.js';
import { icon } from '../icons.js';
import {
  getProfile, getHabits, addHabit, updateHabit, removeHabit, toggleHabitToday, habitStreak,
  todayStr, eventsForDate,
} from '../db.js';
import { hasTourBeenSeen, startTour } from '../lib/tour.js';

let showAddForm = false;
let dismissedSuggestion = false;
let editingHabitId = null;

function greetingKey() {
  const h = new Date().getHours();
  if (h < 12) return 'greetMorning';
  if (h < 18) return 'greetAfternoon';
  return 'greetEvening';
}

function greetingIcon() {
  const h = new Date().getHours();
  if (h < 12) return icon.sun;
  if (h < 18) return icon.cloudSun;
  return icon.moon;
}

function weekStrip() {
  const lang = getLang();
  const dayLetters = lang === 'ar'
    ? ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س']
    : ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - today.getDay());
  let html = '<div class="week-strip">';
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const isToday = d.toDateString() === today.toDateString();
    html += `<div class="day-pill ${isToday ? 'today' : ''}">
      <div class="d">${dayLetters[i]}</div>
      <div class="n">${d.getDate()}${isToday ? '<span class="dot"></span>' : ''}</div>
    </div>`;
  }
  html += '</div>';
  return html;
}

function computeSuggestion() {
  const events = eventsForDate(todayStr());
  if (events.length === 0) return null;
  for (let i = 0; i < events.length; i++) {
    const cur = events[i];
    const nextStart = events[i + 1] ? toMinutes(events[i + 1].start) : toMinutes(cur.end) + 999;
    const gap = nextStart - toMinutes(cur.end);
    if (gap >= 30) {
      return { after: cur.title, time: cur.end };
    }
  }
  return null;
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function renderHome(root) {
  const profile = getProfile();
  const habits = getHabits();
  const suggestion = dismissedSuggestion ? null : computeSuggestion();

  root.innerHTML = `
    <div class="page">
      <div>
        <div class="row between">
          <div>
            <div class="label-sm">${t(greetingKey())}</div>
            <div class="value-lg">${profile?.firstName || ''}</div>
          </div>
          <div class="icon-circle filled">${greetingIcon()}</div>
        </div>
        <div class="screen-subtitle">${new Date().toLocaleDateString(getLang() === 'ar' ? 'ar' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
      </div>

      ${weekStrip()}

      <div>
        <div class="section-head" style="margin-bottom:8px;">
          <span class="title">${t('todaysHabits')}</span>
          <button class="chip accent clickable" id="addHabitToggle">+ ${t('addHabit')}</button>
        </div>

        ${showAddForm ? habitFormHtml() : ''}

        ${habits.length === 0 && !showAddForm ? emptyHabitsHtml() : ''}

        <div class="col" id="habitList">
          ${habits.map(habitRowHtml).join('')}
        </div>
      </div>

      ${suggestion ? suggestionHtml(suggestion) : ''}
    </div>
  `;

  root.querySelector('#addHabitToggle').addEventListener('click', () => {
    showAddForm = !showAddForm;
    renderHome(root);
  });

  const emptyBtn = root.querySelector('#emptyAddBtn');
  if (emptyBtn) emptyBtn.addEventListener('click', () => { showAddForm = true; renderHome(root); });

  const form = root.querySelector('#habitForm');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = form.querySelector('#habitName').value.trim();
      const stackAfter = form.querySelector('#habitStack').value.trim();
      const time = form.querySelector('#habitTime').value;
      if (!name) return;
      addHabit({ name, stackAfter, time });
      showAddForm = false;
      renderHome(root);
    });
  }

  root.querySelectorAll('.habit-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      toggleHabitToday(btn.dataset.id);
      renderHome(root);
    });
  });

  root.querySelectorAll('.habit-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      removeHabit(btn.dataset.id);
      renderHome(root);
    });
  });

  root.querySelectorAll('.habit-edit-trigger').forEach((el) => {
    el.addEventListener('click', () => {
      editingHabitId = el.dataset.id;
      renderHome(root);
    });
  });

  const editForm = root.querySelector('#editHabitForm');
  if (editForm) {
    editForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = editForm.querySelector('#editHabitName').value.trim();
      const stackAfter = editForm.querySelector('#editHabitStack').value.trim();
      const time = editForm.querySelector('#editHabitTime').value;
      if (!name) return;
      updateHabit(editingHabitId, { name, stackAfter, time });
      editingHabitId = null;
      renderHome(root);
    });
    editForm.querySelector('#cancelEditBtn').addEventListener('click', () => {
      editingHabitId = null;
      renderHome(root);
    });
  }

  const addSuggestBtn = root.querySelector('#addSuggestBtn');
  if (addSuggestBtn) {
    addSuggestBtn.addEventListener('click', () => {
      addHabit({ name: t('habitNamePlaceholder'), stackAfter: suggestion.after });
      dismissedSuggestion = true;
      renderHome(root);
    });
  }
  const notNowBtn = root.querySelector('#notNowBtn');
  if (notNowBtn) notNowBtn.addEventListener('click', () => { dismissedSuggestion = true; renderHome(root); });

  if (!hasTourBeenSeen()) {
    requestAnimationFrame(() => startTour());
  }
}

function emptyHabitsHtml() {
  return `
    <div class="empty-state card">
      <div class="icon-circle">${icon.circle}</div>
      <div class="title">${t('noHabitsYetTitle')}</div>
      <div class="body">${t('noHabitsYetBody')}</div>
      <button class="btn primary" id="emptyAddBtn" style="margin-top:12px;">${t('addFirstHabit')}</button>
    </div>
  `;
}

function habitFormHtml() {
  return `
    <form id="habitForm" class="card col" style="margin-bottom:10px;">
      <div class="label-sm">${t('newHabit')}</div>
      <input class="field" id="habitName" placeholder="${t('habitNamePlaceholder')}" required />
      <label class="label-sm">${t('stackAfterLabel')}</label>
      <input class="field" id="habitStack" placeholder="${t('stackAfterPlaceholder')}" />
      <label class="label-sm">${t('habitTimeLabel')}</label>
      <input class="field" type="time" id="habitTime" />
      <div class="label-sm">${t('habitTimeHint')}</div>
      <button class="btn primary" type="submit">${t('saveHabit')}</button>
    </form>
  `;
}

function editHabitFormHtml(habit) {
  return `
    <form id="editHabitForm" class="card strong col">
      <div class="label-sm">${t('editHabit')}</div>
      <input class="field" id="editHabitName" value="${escapeAttr(habit.name)}" required />
      <label class="label-sm">${t('stackAfterLabel')}</label>
      <input class="field" id="editHabitStack" value="${escapeAttr(habit.stackAfter)}" placeholder="${t('stackAfterPlaceholder')}" />
      <label class="label-sm">${t('habitTimeLabel')}</label>
      <input class="field" type="time" id="editHabitTime" value="${escapeAttr(habit.time)}" />
      <div class="label-sm">${t('habitTimeHint')}</div>
      <div class="row" style="gap:8px;">
        <button class="btn secondary grow" type="button" id="cancelEditBtn">${t('cancel')}</button>
        <button class="btn primary grow" type="submit">${t('save')}</button>
      </div>
    </form>
  `;
}

function habitRowHtml(habit) {
  if (habit.id === editingHabitId) return editHabitFormHtml(habit);
  const doneToday = !!habit.history[todayStr()];
  const streak = habitStreak(habit);
  const subParts = [];
  if (habit.time) subParts.push(`<span dir="ltr">${habit.time}</span>`);
  if (habit.stackAfter) subParts.push(`${t('stackedAfter')}: ${escapeHtml(habit.stackAfter)}`);
  return `
    <div class="card row">
      <button class="icon-circle sm ${doneToday ? 'filled' : 'muted'} habit-toggle" data-id="${habit.id}" style="border:none;cursor:pointer;">
        ${doneToday ? icon.check : icon.circle}
      </button>
      <div class="grow habit-edit-trigger" data-id="${habit.id}" style="cursor:pointer;">
        <div style="font-size:12px; font-weight:700;">${escapeHtml(habit.name)}</div>
        <div style="font-size:10px; color:var(--text-muted);">${subParts.length ? subParts.join(' · ') : t('noStack')}</div>
      </div>
      ${streak > 0 ? `<span class="chip">${streak}🔥</span>` : ''}
      <button class="chip clickable habit-remove" data-id="${habit.id}" title="${t('removeHabit')}">${icon.trash}</button>
    </div>
  `;
}

function suggestionHtml(suggestion) {
  return `
    <div class="card dashed">
      <div class="row between" style="margin-bottom:4px;">
        <span style="font-size:11.5px; font-weight:700; color:var(--accent);">${t('suggestedStackTitle')}</span>
      </div>
      <div style="font-size:11px; margin-bottom:9px;">${t('suggestedStackBody') !== 'suggestedStackBody' ? '' : ''}${suggestionCopy(suggestion)}</div>
      <div class="row" style="gap:6px;">
        <button class="chip solid clickable" id="addSuggestBtn" style="flex:1; justify-content:center; padding:7px 0;">${t('addBtn')}</button>
        <button class="chip clickable" id="notNowBtn" style="flex:1; justify-content:center; padding:7px 0;">${t('notNow')}</button>
      </div>
    </div>
  `;
}

function suggestionCopy(suggestion) {
  const lang = getLang();
  if (lang === 'ar') return `أضف عادة قصيرة بعد "${escapeHtml(suggestion.after)}" (${suggestion.time})؟`;
  return `Add a short habit right after "${escapeHtml(suggestion.after)}" (${suggestion.time})?`;
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function escapeAttr(s) {
  return String(s || '').replace(/"/g, '&quot;');
}
