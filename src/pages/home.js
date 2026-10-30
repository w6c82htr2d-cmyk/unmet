import { t, getLang } from '../i18n.js';
import { icon } from '../icons.js';
import {
  getProfile, getHabits, addHabit, updateHabit, removeHabit, restoreHabit, toggleHabitForDate, habitStreak, longestHabitStreak,
  habitsForDate, habitNeedsRelink, habitLinkedEventTitles, habitDuration, habitDayStates, DEFAULT_HABIT_DURATION,
  weeklyConsistency, consistencyRate, todayStr, dayOfWeek, getEvents, getEventSeriesList,
  previewStackedOccurrences, previewIndependentOccurrences, eventsForDate,
} from '../db.js';
import { hasTourBeenSeen, startTour } from '../lib/tour.js';
import { weekdayKey } from '../lib/patterns.js';
import { navigate } from '../router.js';
import { consumePendingHabitEdit, consumePendingAddHabit, requestAddRoutine } from '../lib/pendingEdit.js';
import { showUndoToast } from '../lib/undoToast.js';
import { addDays, dateForDisplay } from '../lib/dates.js';
import { homeInsightHtml, wireHomeInsight } from '../lib/homeInsight.js';

let showAddForm = false;
let dismissedSuggestion = false;
let editingHabitId = null;
let selectedDate = todayStr();
let lastSeenToday = todayStr(); // lets a page left open past midnight follow the date forward
let justToggledId = null;
let addDraft = freshDraft();
let editDraft = {};
let formError = '';

const DURATION_CHOICES = [5, 10, 15, 20, 30, 45, 60];
const GAP_CHOICES = [0, 5, 10, 15, 30];

// when: 'everyday' | 'days' | 'routine'
function freshDraft() {
  return { name: '', duration: DEFAULT_HABIT_DURATION, customDuration: false, when: 'everyday', days: [], time: '', eventIds: [], eventFilter: '', offset: 0, customOffset: false, position: 'after' };
}

function draftFromHabit(habit) {
  const stacked = habit.scheduleType === 'stacked';
  const duration = habitDuration(habit);
  const offset = habit.offsetMinutes ?? 0;
  return {
    name: habit.name,
    duration,
    customDuration: !DURATION_CHOICES.includes(duration),
    when: stacked ? 'routine' : (habit.days && habit.days.length && habit.days.length < 7 ? 'days' : 'everyday'),
    days: habit.days ? [...habit.days] : [],
    time: habit.time || '',
    eventIds: habit.stackEventIds ? [...habit.stackEventIds] : [],
    eventFilter: '',
    offset,
    customOffset: !GAP_CHOICES.includes(offset),
    position: habit.stackPosition === 'before' ? 'before' : 'after',
  };
}

function greetingKey() {
  const h = new Date().getHours();
  if (h < 12) return 'greetMorning';
  if (h < 18) return 'greetAfternoon';
  return 'greetEvening';
}

function weekStrip() {
  const lang = getLang();
  const dayLetters = lang === 'ar'
    ? ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س']
    : ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const today = todayStr();
  const start = addDays(today, -dayOfWeek(today));
  let html = `<div class="week-strip" role="group" aria-label="${escapeAttr(t('chooseDayLabel'))}">`;
  for (let i = 0; i < 7; i++) {
    const dateStr = addDays(start, i);
    const isToday = dateStr === today;
    const isSelected = dateStr === selectedDate;
    html += `<button class="day-pill ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}" data-date="${dateStr}" aria-pressed="${isSelected}" aria-label="${escapeAttr(fmtLongDate(dateStr))}">
      <div class="d">${dayLetters[i]}</div>
      <div class="n">${Number(dateStr.slice(8, 10))}${isToday ? '<span class="dot"></span>' : ''}</div>
    </button>`;
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
      return { after: cur.title, time: cur.end, eventId: cur.id };
    }
  }
  return null;
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function renderHome(root) {
  const now = todayStr();
  if (now !== lastSeenToday) {
    if (selectedDate === lastSeenToday) selectedDate = now;
    lastSeenToday = now;
  }
  const pendingEditId = consumePendingHabitEdit();
  if (pendingEditId) {
    const h = getHabits().find((x) => x.id === pendingEditId);
    if (h) {
      editingHabitId = h.id;
      editDraft = draftFromHabit(h);
      showAddForm = false;
      formError = '';
    }
  }

  const pendingAdd = consumePendingAddHabit();
  if (pendingAdd) {
    editingHabitId = null;
    showAddForm = true;
    formError = '';
    addDraft = freshDraft();
    if (pendingAdd.eventIds.length) {
      addDraft.when = 'routine';
      addDraft.eventIds = pendingAdd.eventIds;
    }
    if (pendingAdd.prefill?.name) addDraft.name = String(pendingAdd.prefill.name).slice(0, 200);
    if (pendingAdd.prefill?.duration) {
      addDraft.duration = Math.min(240, Math.max(5, Math.round(Number(pendingAdd.prefill.duration)) || DEFAULT_HABIT_DURATION));
      addDraft.customDuration = !DURATION_CHOICES.includes(addDraft.duration);
    }
  }

  const profile = getProfile();
  const allHabits = getHabits();
  const dayHabits = habitsForDate(selectedDate);
  const brokenHabits = allHabits.filter(habitNeedsRelink);
  const completedCount = dayHabits.filter((h) => h.history[selectedDate]).length;
  const totalCount = dayHabits.length;
  const isToday = selectedDate === todayStr();
  const suggestion = dismissedSuggestion ? null : computeSuggestion();
  const insight = homeInsightHtml();
  const name = profile?.firstName ? `, ${escapeHtml(profile.firstName)}` : '';

  root.innerHTML = `
    <div class="page home">
      <header class="home-head">
        <h1 class="home-greeting font-head">${t(greetingKey())}${name}</h1>
        <div class="screen-subtitle">${escapeHtml(fmtLongDate(todayStr()))}</div>
      </header>

      ${weekStrip()}

      <section class="today-section" aria-labelledby="todayHeading">
        <div class="today-head">
          <div>
            <h2 class="section-title" id="todayHeading">${isToday ? t('todaysHabits') : t('habitsForDateLabel', { day: escapeHtml(fmtLongDate(selectedDate)) })}</h2>
            ${totalCount ? `<div class="today-count" aria-live="polite">${completedCount === totalCount ? t('allDoneShort') : t('progressCount', { done: completedCount, total: totalCount })}</div>` : ''}
          </div>
          <button class="btn primary sm add-habit-btn" id="addHabitToggle" aria-expanded="${showAddForm}">${icon.plus} ${t('addHabit')}</button>
        </div>
        ${totalCount ? `<div class="today-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${totalCount}" aria-valuenow="${completedCount}" aria-label="${escapeAttr(t('progressCount', { done: completedCount, total: totalCount }))}"><span style="width:${Math.round((completedCount / totalCount) * 100)}%"></span></div>` : ''}

        ${relinkBannerHtml(brokenHabits)}
        ${showAddForm ? habitFormHtml('add', addDraft) : ''}

        ${allHabits.length === 0 && !showAddForm ? emptyHabitsHtml() : ''}
        ${allHabits.length > 0 && totalCount === 0 && !showAddForm ? noneScheduledHtml() : ''}

        <div class="habit-list" id="habitList">
          ${dayHabits.map((h) => habitRowHtml(h)).join('')}
        </div>
      </section>

      ${allHabits.length ? weekCardHtml(allHabits) : ''}

      ${insight || (suggestion && !showAddForm ? suggestionHtml(suggestion) : '')}
    </div>
  `;
  justToggledId = null;

  root.querySelectorAll('.day-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedDate = btn.dataset.date;
      renderHome(root);
    });
  });

  root.querySelector('#addHabitToggle').addEventListener('click', () => {
    showAddForm = !showAddForm;
    editingHabitId = null;
    formError = '';
    if (showAddForm) addDraft = freshDraft();
    renderHome(root);
    if (showAddForm) focusField(root, '#addName');
  });

  const emptyBtn = root.querySelector('#emptyAddBtn');
  if (emptyBtn) emptyBtn.addEventListener('click', () => { showAddForm = true; formError = ''; addDraft = freshDraft(); renderHome(root); focusField(root, '#addName'); });

  wireHabitForm(root, 'add', addDraft, () => {
    const values = readForm(root, 'add', addDraft);
    if (!values) return;
    addHabit(values);
    showAddForm = false;
    addDraft = freshDraft();
    formError = '';
    renderHome(root);
  });

  root.querySelectorAll('.habit-check').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const habit = allHabits.find((h) => h.id === id);
      if (!habit || selectedDate > todayStr()) return;
      const wasDone = !!habit.history[selectedDate];
      const date = selectedDate;
      toggleHabitForDate(id, date); // throws (and shows the storage warning) if it can't be saved
      justToggledId = wasDone ? null : id;
      renderHome(root);
      if (!wasDone) {
        showUndoToast(t('markedDoneToast', { name: habit.name }), t('undoBtn'), () => {
          const current = getHabits().find((h) => h.id === id);
          if (current && current.history[date]) toggleHabitForDate(id, date);
          renderHome(root);
        });
      }
    });
  });

  root.querySelectorAll('.habit-edit-trigger, .relink-trigger').forEach((el) => {
    el.addEventListener('click', () => {
      const habit = allHabits.find((h) => h.id === el.dataset.id);
      if (!habit) return;
      showAddForm = false;
      formError = '';
      editingHabitId = habit.id;
      editDraft = draftFromHabit(habit);
      renderHome(root);
      focusField(root, '#editName');
    });
  });

  const editForm = root.querySelector('#editForm');
  if (editForm) {
    wireHabitForm(root, 'edit', editDraft, () => {
      const values = readForm(root, 'edit', editDraft);
      if (!values) return;
      updateHabit(editingHabitId, { ...values, needsRelink: false });
      editingHabitId = null;
      editDraft = {};
      formError = '';
      renderHome(root);
    });
    editForm.querySelector('#cancelEditBtn').addEventListener('click', () => {
      editingHabitId = null;
      editDraft = {};
      formError = '';
      renderHome(root);
    });
    editForm.querySelector('#deleteHabitBtn').addEventListener('click', () => {
      const removed = removeHabit(editingHabitId);
      editingHabitId = null;
      editDraft = {};
      renderHome(root);
      if (removed) {
        showUndoToast(t('habitRemovedToast'), t('undoBtn'), () => {
          restoreHabit(removed);
          renderHome(root);
        });
      }
    });
  }

  const addSuggestBtn = root.querySelector('#addSuggestBtn');
  if (addSuggestBtn) {
    addSuggestBtn.addEventListener('click', () => {
      // Opens the habit form already stacked after that event, so the user names it themselves.
      showAddForm = true;
      editingHabitId = null;
      formError = '';
      addDraft = { ...freshDraft(), when: 'routine', eventIds: [suggestion.eventId] };
      dismissedSuggestion = true;
      renderHome(root);
      focusField(root, '#addName');
    });
  }
  const notNowBtn = root.querySelector('#notNowBtn');
  if (notNowBtn) notNowBtn.addEventListener('click', () => { dismissedSuggestion = true; renderHome(root); });

  wireHomeInsight(root, () => renderHome(root));

  if (!hasTourBeenSeen()) {
    requestAnimationFrame(() => startTour());
  }
}

function focusField(root, selector) {
  requestAnimationFrame(() => {
    const el = root.querySelector(selector);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.focus({ preventScroll: true });
  });
}

// Validates the form and returns the values to save, or null (with formError set and shown).
function readForm(root, prefix, draft) {
  const form = root.querySelector(`#${prefix}Form`);
  captureFields(form, prefix, draft);
  const name = draft.name.trim();
  let error = '';
  if (!name) error = t('habitErrName');
  else if (draft.when === 'days' && !draft.days.length) error = t('habitErrDays');
  else if (draft.when === 'routine' && !draft.eventIds.length) error = t('habitErrRoutine');
  if (error) {
    formError = error;
    renderHome(root);
    focusField(root, `#${prefix}Form .form-error`);
    return null;
  }
  const stacked = draft.when === 'routine';
  return {
    name: name.slice(0, 200),
    duration: Math.min(240, Math.max(1, draft.duration || DEFAULT_HABIT_DURATION)),
    scheduleType: stacked ? 'stacked' : 'independent',
    days: draft.when === 'days' ? [...draft.days].sort((a, b) => a - b) : undefined,
    time: stacked ? '' : draft.time,
    stackEventIds: stacked ? draft.eventIds : undefined,
    offsetMinutes: stacked ? Math.min(240, Math.max(0, draft.offset || 0)) : undefined,
    stackPosition: stacked && draft.position === 'before' ? 'before' : undefined,
  };
}

function captureFields(form, prefix, draft) {
  if (!form) return;
  const nameEl = form.querySelector(`#${prefix}Name`);
  const timeEl = form.querySelector(`#${prefix}Time`);
  const durationEl = form.querySelector(`#${prefix}DurationCustom`);
  const offsetEl = form.querySelector(`#${prefix}OffsetCustom`);
  if (nameEl) draft.name = nameEl.value;
  if (timeEl) draft.time = timeEl.value;
  if (durationEl && durationEl.value) draft.duration = Math.round(Number(durationEl.value)) || draft.duration;
  if (offsetEl && offsetEl.value !== '') draft.offset = Math.max(0, Math.round(Number(offsetEl.value)) || 0);
}

// Re-renders while keeping focus (and cursor position) on whatever field triggered it — needed for
// the routine search box, which re-renders on every keystroke to live-filter.
function reRenderPreservingFocus(root) {
  const active = document.activeElement;
  const id = active && root.contains(active) ? active.id : null;
  const selStart = id && active.selectionStart != null ? active.selectionStart : null;
  renderHome(root);
  if (id) {
    const el = root.querySelector(`#${CSS.escape(id)}`);
    if (el) {
      el.focus();
      if (selStart != null && el.setSelectionRange) {
        try { el.setSelectionRange(selStart, selStart); } catch { /* not a text input */ }
      }
    }
  }
}

// Shared wiring for the add and edit forms. Text fields are captured before any re-render
// triggered by another control, so typed text is never lost.
function wireHabitForm(root, prefix, draft, onSubmit) {
  const form = root.querySelector(`#${prefix}Form`);
  if (!form) return;
  const rerender = () => { captureFields(form, prefix, draft); formError = ''; renderHome(root); };

  form.querySelectorAll('[data-duration]').forEach((b) => b.addEventListener('click', () => {
    captureFields(form, prefix, draft);
    if (b.dataset.duration === 'other') { draft.customDuration = true; } else { draft.customDuration = false; draft.duration = Number(b.dataset.duration); }
    formError = '';
    renderHome(root);
    if (draft.customDuration) focusField(root, `#${prefix}DurationCustom`);
  }));
  form.querySelectorAll('[data-when]').forEach((b) => b.addEventListener('click', () => {
    captureFields(form, prefix, draft);
    draft.when = b.dataset.when;
    rerender();
  }));
  form.querySelectorAll('.weekday-chip').forEach((chip) => chip.addEventListener('click', () => {
    captureFields(form, prefix, draft);
    const day = Number(chip.dataset.day);
    draft.days = draft.days.includes(day) ? draft.days.filter((d) => d !== day) : [...draft.days, day];
    rerender();
  }));
  form.querySelectorAll('[data-position]').forEach((b) => b.addEventListener('click', () => {
    captureFields(form, prefix, draft);
    draft.position = b.dataset.position;
    rerender();
  }));
  form.querySelectorAll('[data-gap]').forEach((b) => b.addEventListener('click', () => {
    captureFields(form, prefix, draft);
    if (b.dataset.gap === 'other') { draft.customOffset = true; } else { draft.customOffset = false; draft.offset = Number(b.dataset.gap); }
    formError = '';
    renderHome(root);
    if (draft.customOffset) focusField(root, `#${prefix}OffsetCustom`);
  }));
  // Typed values only refresh the preview box (never the whole form), so a blur caused by tapping
  // Save can't rebuild the form under the tap.
  ['DurationCustom', 'OffsetCustom', 'Time'].forEach((suffix) => {
    const el = form.querySelector(`#${prefix}${suffix}`);
    if (el) el.addEventListener('input', () => {
      captureFields(form, prefix, draft);
      const box = form.querySelector('.preview-slot');
      if (box) box.innerHTML = previewForDraft(draft);
    });
  });

  const searchInput = form.querySelector('.event-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      captureFields(form, prefix, draft);
      draft.eventFilter = searchInput.value;
      reRenderPreservingFocus(root);
    });
  }
  form.querySelectorAll('.event-select').forEach((cb) => {
    cb.addEventListener('change', () => {
      captureFields(form, prefix, draft);
      const id = cb.dataset.id;
      draft.eventIds = cb.checked ? [...draft.eventIds, id] : draft.eventIds.filter((x) => x !== id);
      rerender();
    });
  });
  form.querySelectorAll('.series-select-all').forEach((cb) => {
    cb.addEventListener('change', () => {
      captureFields(form, prefix, draft);
      const series = getEventSeriesList().find((s) => s.seriesId === cb.dataset.series);
      const memberIds = series ? series.members.map((m) => m.id) : [];
      draft.eventIds = cb.checked
        ? Array.from(new Set([...draft.eventIds, ...memberIds]))
        : draft.eventIds.filter((id) => !memberIds.includes(id));
      rerender();
    });
  });
  form.querySelector('#goAddRoutineBtn')?.addEventListener('click', () => {
    requestAddRoutine();
    navigate('/calendar');
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    onSubmit();
  });
}

// ---------- This week (one card instead of several overlapping charts) ----------
function weekCardHtml(allHabits) {
  const week = consistencyRate(7);
  const month = consistencyRate(30);
  const longest = Math.max(0, ...allHabits.map(longestHabitStreak));
  if (week.rate === null) {
    return `
      <section class="card week-card" aria-labelledby="weekHeading">
        <h2 class="label-sm" id="weekHeading">${t('thisWeekTitle')}</h2>
        <p class="week-empty">${t('thisWeekEmpty')}</p>
      </section>
    `;
  }
  const data = weeklyConsistency(7);
  const letters = getLang() === 'ar' ? ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'] : ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const bars = data.map((d) => {
    const isToday = d.date === todayStr();
    const label = d.rate === null ? t('nothingScheduled') : t('progressCount', { done: d.completedCount, total: d.scheduledCount });
    const bar = d.rate === null
      ? '<div class="wc-bar free"></div>'
      : `<div class="wc-bar" style="height:${Math.max(Math.round(d.rate * 100), d.completedCount > 0 ? 10 : 4)}%"></div>`;
    return `<div class="wc-col ${isToday ? 'today' : ''}" title="${escapeAttr(fmtShortDate(d.date) + ': ' + label)}"><div class="wc-bar-track">${bar}</div><div class="wc-label">${letters[dayOfWeek(d.date)]}</div></div>`;
  }).join('');
  return `
    <section class="card week-card" aria-labelledby="weekHeading">
      <h2 class="label-sm" id="weekHeading">${t('thisWeekTitle')}</h2>
      <div class="week-main">
        <div class="week-pct">${Math.round(week.rate * 100)}<span>%</span></div>
        <div class="week-desc">${t('weekDoneOfScheduled', { done: week.totalCompleted, total: week.totalScheduled })}</div>
      </div>
      <div class="week-consistency" aria-hidden="true">${bars}</div>
      <div class="week-foot">
        ${month.rate !== null ? `<span>${t('last30Days')}: <strong>${Math.round(month.rate * 100)}%</strong></span>` : ''}
        ${longest >= 2 ? `<span>${t('bestStreakLabel')}: <strong>${longest}</strong></span>` : ''}
      </div>
    </section>
  `;
}

function relinkBannerHtml(brokenHabits) {
  if (!brokenHabits.length) return '';
  return `
    <div class="card dashed relink-card">
      <div class="row" style="gap:7px; margin-bottom:6px;">
        ${icon.warnTriangle}
        <span class="relink-title">${t('needsRelinkTitle')}</span>
      </div>
      <div class="col" style="gap:6px;">
        ${brokenHabits.map((h) => `
          <div class="row between" style="font-size:13px;">
            <span>${escapeHtml(h.name)}</span>
            <button class="chip solid clickable relink-trigger" data-id="${h.id}">${t('relinkBtn')}</button>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function emptyHabitsHtml() {
  const hasRoutines = getEvents().some((e) => e.type === 'weekly');
  return `
    <div class="empty-state card">
      <div class="title">${t('noHabitsYetTitle')}</div>
      <div class="body">${t(hasRoutines ? 'noHabitsYetBodyRoutines' : 'noHabitsYetBody')}</div>
      <button class="btn primary" id="emptyAddBtn" style="margin-top:12px;">${t('addFirstHabit')}</button>
    </div>
  `;
}

function noneScheduledHtml() {
  return `
    <div class="empty-state card compact">
      <div class="title">${t('noneScheduledTodayTitle')}</div>
      <div class="body">${t('noneScheduledTodayBody')}</div>
    </div>
  `;
}

// ---------- Add / edit habit: three short questions ----------
function habitFormHtml(prefix, draft) {
  const isEdit = prefix === 'edit';
  const durationPicked = (n) => !draft.customDuration && draft.duration === n;
  return `
    <form id="${prefix}Form" class="card habit-form" novalidate aria-labelledby="${prefix}FormTitle">
      <h3 class="form-title" id="${prefix}FormTitle">${t(isEdit ? 'editHabit' : 'newHabit')}</h3>

      <div class="q">
        <label class="q-label" for="${prefix}Name"><span class="q-num">1</span>${t('habitQWhat')}</label>
        <input class="field" id="${prefix}Name" placeholder="${t('habitNameExample')}" value="${escapeAttr(draft.name)}" maxlength="200" autocomplete="off" required />
      </div>

      <div class="q" role="group" aria-labelledby="${prefix}QLong">
        <div class="q-label" id="${prefix}QLong"><span class="q-num">2</span>${t('habitQHowLong')}</div>
        <div class="choice-row">
          ${DURATION_CHOICES.map((n) => `<button type="button" class="choice ${durationPicked(n) ? 'on' : ''}" data-duration="${n}" aria-pressed="${durationPicked(n)}">${t('minutesShort', { n })}</button>`).join('')}
          <button type="button" class="choice ${draft.customDuration ? 'on' : ''}" data-duration="other" aria-pressed="${draft.customDuration}">${t('otherChoice')}</button>
        </div>
        ${draft.customDuration ? `<div class="inline-field"><input class="field" type="number" min="1" max="240" id="${prefix}DurationCustom" value="${draft.duration}" aria-label="${escapeAttr(t('durationMinutesLabel'))}" /><span>${t('minutesWord')}</span></div>` : ''}
      </div>

      <div class="q" role="group" aria-labelledby="${prefix}QWhen">
        <div class="q-label" id="${prefix}QWhen"><span class="q-num">3</span>${t('habitQWhen')}</div>
        <div class="seg" role="radiogroup">
          ${[['everyday', 'whenEveryDay'], ['days', 'whenSpecificDays'], ['routine', 'whenAroundRoutine']].map(([v, k]) => `
            <button type="button" role="radio" class="seg-btn ${draft.when === v ? 'on' : ''}" data-when="${v}" aria-checked="${draft.when === v}">${t(k)}</button>
          `).join('')}
        </div>
        ${draft.when === 'routine' ? routineFieldsHtml(prefix, draft) : independentFieldsHtml(prefix, draft)}
      </div>

      ${formError ? `<div class="form-error" role="alert" tabindex="-1">${escapeHtml(formError)}</div>` : ''}

      <div class="form-actions">
        ${isEdit ? `<button class="btn secondary grow" type="button" id="cancelEditBtn">${t('cancel')}</button>` : ''}
        <button class="btn primary grow" type="submit">${t(isEdit ? 'save' : 'saveHabit')}</button>
      </div>
      ${isEdit ? `<button class="btn ghost danger-text" type="button" id="deleteHabitBtn">${icon.trash} ${t('deleteHabitBtn')}</button><p class="form-note">${t('editKeepsHistory')}</p>` : ''}
    </form>
  `;
}

function independentFieldsHtml(prefix, draft) {
  return `
    ${draft.when === 'days' ? `
      <div class="wrap-gap" role="group" aria-label="${escapeAttr(t('independentDaysLabel'))}">
        ${[0, 1, 2, 3, 4, 5, 6].map((d) => `
          <button type="button" class="chip clickable weekday-chip ${draft.days.includes(d) ? 'solid' : ''}" data-day="${d}" aria-pressed="${draft.days.includes(d)}">${t(weekdayKey(d))}</button>
        `).join('')}
      </div>` : ''}
    <label class="label-sm" for="${prefix}Time">${t('habitTimeLabel')}</label>
    <input class="field" type="time" id="${prefix}Time" value="${escapeAttr(draft.time)}" />
    <div class="form-note">${t('habitTimeHint')}</div>
    <div class="preview-slot">${previewForDraft(draft)}</div>
  `;
}

function routineFieldsHtml(prefix, draft) {
  const allEvents = getEvents();
  if (!allEvents.length) {
    return `
      <div class="empty-state card compact">
        <div class="title">${t('noEventsToStackTitle')}</div>
        <div class="body">${t('noEventsToStackBody')}</div>
        <button type="button" class="btn secondary" id="goAddRoutineBtn" style="margin-top:10px;">${icon.plus} ${t('addRoutineBtn')}</button>
      </div>
    `;
  }
  const seriesList = getEventSeriesList();
  const filter = (draft.eventFilter || '').trim().toLowerCase();
  const filteredSeries = filter ? seriesList.filter((s) => s.title.toLowerCase().includes(filter)) : seriesList;
  const gapPicked = (n) => !draft.customOffset && draft.offset === n;
  return `
    <div class="label-sm">${t('pickRoutinesLabel')}</div>
    ${seriesList.length > 6 ? `
      <div class="search-field">
        <span aria-hidden="true">${icon.search}</span>
        <input class="field grow event-search-input" id="${prefix}EventSearch" placeholder="${t('searchEventsPlaceholder')}" aria-label="${t('searchEventsPlaceholder')}" value="${escapeAttr(draft.eventFilter || '')}" autocomplete="off" />
      </div>` : ''}
    <div class="event-picker-list">
      ${filteredSeries.length ? filteredSeries.map((s) => seriesPickerGroup(s, draft)).join('') : `<div class="label-sm" style="padding:8px 2px;">${t('noMatchingEvents')}</div>`}
    </div>

    <div class="label-sm">${t('positionLabel')}</div>
    <div class="seg small" role="radiogroup" aria-label="${escapeAttr(t('positionLabel'))}">
      ${[['before', 'positionBefore'], ['after', 'positionAfter']].map(([v, k]) => `
        <button type="button" role="radio" class="seg-btn ${draft.position === v ? 'on' : ''}" data-position="${v}" aria-checked="${draft.position === v}">${t(k)}</button>
      `).join('')}
    </div>

    <div class="label-sm">${t(draft.position === 'before' ? 'gapBeforeLabel' : 'gapAfterLabel')}</div>
    <div class="choice-row">
      ${GAP_CHOICES.map((n) => `<button type="button" class="choice ${gapPicked(n) ? 'on' : ''}" data-gap="${n}" aria-pressed="${gapPicked(n)}">${n === 0 ? t('gapNone') : t('minutesShort', { n })}</button>`).join('')}
      <button type="button" class="choice ${draft.customOffset ? 'on' : ''}" data-gap="other" aria-pressed="${draft.customOffset}">${t('otherChoice')}</button>
    </div>
    ${draft.customOffset ? `<div class="inline-field"><input class="field" type="number" min="0" max="240" id="${prefix}OffsetCustom" value="${draft.offset}" aria-label="${escapeAttr(t('gapMinutesLabel'))}" /><span>${t('minutesWord')}</span></div>` : ''}
    <div class="preview-slot">${previewForDraft(draft)}</div>
  `;
}

function seriesPickerGroup(series, draft) {
  const memberIds = series.members.map((m) => m.id);
  const allSelected = memberIds.every((id) => draft.eventIds.includes(id));
  const someSelected = !allSelected && memberIds.some((id) => draft.eventIds.includes(id));
  return `
    <div class="event-picker-group">
      <label class="event-picker-row parent">
        <input type="checkbox" class="series-select-all" data-series="${series.seriesId}" ${allSelected ? 'checked' : ''} />
        <span class="grow">
          <span class="ep-title">${escapeHtml(series.title)}</span>
          <span class="ep-sub">${escapeHtml(seriesSummary(series))}</span>
        </span>
        ${someSelected ? `<span class="chip">${t('partialLabel')}</span>` : ''}
      </label>
      ${series.members.length > 1 ? `
        <details class="event-picker-members" ${someSelected ? 'open' : ''}>
          <summary>${t('chooseSpecificDays')}</summary>
          ${series.members.map((m) => `
            <label class="event-picker-row member">
              <input type="checkbox" class="event-select" data-id="${m.id}" ${draft.eventIds.includes(m.id) ? 'checked' : ''} />
              <span>${memberLabel(m)}</span>
            </label>
          `).join('')}
        </details>
      ` : ''}
    </div>
  `;
}

function memberLabel(m) {
  if (m.type === 'once') return `<span dir="ltr">${m.date}</span> · <span dir="ltr">${m.start}–${m.end}</span>`;
  return `${t(weekdayKey(m.dayOfWeek))} · <span dir="ltr">${m.start}–${m.end}</span>`;
}

function seriesSummary(series) {
  const first = series.members[0];
  if (first.type === 'once') {
    return `${first.date} · ${first.start}–${first.end}`;
  }
  const days = series.members.map((m) => t(weekdayKey(m.dayOfWeek))).join(', ');
  return `${days} · ${first.start}–${first.end}`;
}

function previewForDraft(draft) {
  if (draft.when === 'routine') return draft.eventIds.length ? previewHtml(draft.eventIds, draft.offset, draft.duration, draft.position) : '';
  return draft.time ? previewIndepHtml(draft.when === 'days' ? draft.days : [], draft.time, draft.duration) : '';
}

function previewHtml(eventIds, offset, duration, position) {
  const occ = previewStackedOccurrences(eventIds, offset, duration, 4, todayStr(), position);
  if (!occ.length) return `<div class="form-note">${t('noUpcomingPreview')}</div>`;
  return `
    <div class="occurrence-preview">
      <div class="label-sm">${t('upcomingPreviewLabel')}</div>
      ${occ.map((o) => `<div class="occurrence-chip"><span class="d">${fmtShortDate(o.date)}</span><span dir="ltr">${o.start}–${o.end}</span></div>`).join('')}
    </div>
  `;
}

function previewIndepHtml(days, time, duration) {
  const occ = previewIndependentOccurrences(days, time, duration, 4);
  if (!occ.length || !occ[0].start) return '';
  return `
    <div class="occurrence-preview">
      <div class="label-sm">${t('upcomingPreviewLabel')}</div>
      ${occ.map((o) => `<div class="occurrence-chip"><span class="d">${fmtShortDate(o.date)}</span><span dir="ltr">${o.start}${o.end ? '–' + o.end : ''}</span></div>`).join('')}
    </div>
  `;
}

function fmtShortDate(dateStr) {
  return dateForDisplay(dateStr).toLocaleDateString(getLang() === 'ar' ? 'ar' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function fmtLongDate(dateStr) {
  return dateForDisplay(dateStr).toLocaleDateString(getLang() === 'ar' ? 'ar' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

// ---------- Habit row: big checkbox, details, streak and the last 7 days ----------
function habitRowHtml(habit) {
  if (habit.id === editingHabitId) return habitFormHtml('edit', editDraft);
  const done = !!habit.history[selectedDate];
  const future = selectedDate > todayStr();
  const streak = habitStreak(habit);
  const needsRelink = habitNeedsRelink(habit);
  const days = habitDayStates(habit, 7);
  const scheduled = days.filter((d) => d.state === 'done' || d.state === 'missed').length;
  const doneCount = days.filter((d) => d.state === 'done').length;

  const meta = [];
  if (habit.resolvedTime) meta.push(`<span dir="ltr">${habit.resolvedTime}${habit.resolvedEndTime ? '–' + habit.resolvedEndTime : ''}</span>`);
  if (habit.scheduleType === 'stacked') {
    const linkedTitles = habitLinkedEventTitles(habit);
    if (linkedTitles.length) meta.push(`${t(habit.stackPosition === 'before' ? 'stackedBefore' : 'stackedAfter')} ${escapeHtml(linkedTitles.join(', '))}`);
  } else if (habit.days && habit.days.length && habit.days.length < 7) {
    meta.push(habit.days.slice().sort((a, b) => a - b).map((d) => t(weekdayKey(d))).join(', '));
  } else {
    meta.push(t('everyDayLabel'));
  }

  let streakText = '';
  if (streak >= 2) streakText = t('streakInARow', { n: streak });
  else if (scheduled >= 2 && doneCount > 0) streakText = t('recentOfLast', { done: doneCount, total: scheduled });

  const dayLetters = getLang() === 'ar' ? ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'] : ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const stateLabel = { done: t('dayDone'), missed: t('dayMissed'), pending: t('dayPending'), off: t('dayOff') };
  const checkLabel = future ? t('cantCompleteFuture') : t(done ? 'markUndoneNamed' : 'markDoneNamed', { name: habit.name });

  return `
    <div class="habit-row ${done ? 'done' : ''}">
      <button class="habit-check ${done ? 'done' : ''} ${habit.id === justToggledId ? 'just' : ''}" data-id="${habit.id}"
        aria-pressed="${done}" aria-label="${escapeAttr(checkLabel)}" ${future ? 'disabled' : ''}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button class="habit-main habit-edit-trigger" data-id="${habit.id}" aria-label="${escapeAttr(t('editHabitNamed', { name: habit.name }))}">
        <span class="habit-name">${escapeHtml(habit.name)}</span>
        <span class="habit-meta">${meta.join(' · ')}</span>
        ${needsRelink ? `<span class="relink-warning">${icon.warnTriangle}${t('needsRelinkWarning')}</span>` : ''}
        <span class="habit-foot">
          <span class="habit-days" role="img" aria-label="${escapeAttr(t('last7DaysSummary', { done: doneCount, total: scheduled }))}">
            ${days.map((d) => `<span class="hd ${d.state}" title="${escapeAttr(fmtShortDate(d.date) + ': ' + stateLabel[d.state])}"><span class="hd-dot"></span><span class="hd-l" aria-hidden="true">${dayLetters[dayOfWeek(d.date)]}</span></span>`).join('')}
          </span>
          ${streakText ? `<span class="habit-streak">${streakText}</span>` : ''}
        </span>
      </button>
    </div>
  `;
}

function suggestionHtml(suggestion) {
  return `
    <section class="card insight-card">
      <div class="insight-kicker">${t('suggestedStackTitle')}</div>
      <p class="insight-text">${suggestionCopy(suggestion)}</p>
      <div class="row" style="gap:8px;">
        <button class="btn primary sm grow" id="addSuggestBtn">${t('addBtn')}</button>
        <button class="btn secondary sm grow" id="notNowBtn">${t('notNow')}</button>
      </div>
    </section>
  `;
}

function suggestionCopy(suggestion) {
  const lang = getLang();
  if (lang === 'ar') return `أضف عادة قصيرة بعد "${escapeHtml(suggestion.after)}" (${suggestion.time})؟`;
  return `Add a short habit right after "${escapeHtml(suggestion.after)}" (${suggestion.time})?`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
