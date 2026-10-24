import { t, getLang } from '../i18n.js';
import { icon } from '../icons.js';
import {
  getProfile, getHabits, addHabit, updateHabit, removeHabit, toggleHabitForDate, habitStreak, longestHabitStreak,
  habitsForDate, habitNeedsRelink, habitLinkedEventTitle, weeklyConsistency, todayStr, dayOfWeek,
  getEventSeriesList, previewStackedOccurrences, previewIndependentOccurrences, eventsForDate,
} from '../db.js';
import { hasTourBeenSeen, startTour } from '../lib/tour.js';
import { detectPattern, patternSentence, weekdayKey } from '../lib/patterns.js';
import { navigate } from '../router.js';

let showAddForm = false;
let dismissedSuggestion = false;
let dismissedInsight = false;
let editingHabitId = null;
let selectedDate = todayStr();
let justToggledId = null;
let addDraft = freshDraft();
let editDraft = {};

function freshDraft() {
  return { name: '', scheduleType: 'independent', days: [], time: '', seriesId: '', offset: 0 };
}

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

function motivationKey() {
  const h = new Date().getHours();
  if (h < 12) return 'motivationMorning';
  if (h < 18) return 'motivationAfternoon';
  return 'motivationEvening';
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
    const dateStr = d.toISOString().slice(0, 10);
    const isToday = d.toDateString() === today.toDateString();
    const isSelected = dateStr === selectedDate;
    html += `<button class="day-pill ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}" data-date="${dateStr}">
      <div class="d">${dayLetters[i]}</div>
      <div class="n">${d.getDate()}${isToday ? '<span class="dot"></span>' : ''}</div>
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
      return { after: cur.title, time: cur.end, seriesId: cur.seriesId };
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
  const allHabits = getHabits();
  const dayHabits = habitsForDate(selectedDate);
  const brokenHabits = allHabits.filter(habitNeedsRelink);
  const completedCount = dayHabits.filter((h) => h.history[selectedDate]).length;
  const totalCount = dayHabits.length;
  const longest = allHabits.length ? Math.max(0, ...allHabits.map(longestHabitStreak)) : 0;
  const pattern = dismissedInsight ? null : detectPattern();
  const suggestion = (pattern || dismissedSuggestion) ? null : computeSuggestion();
  const sectionLabel = selectedDate === todayStr() ? t('todaysHabits') : t('habitsForDateLabel', { day: t(weekdayKey(dayOfWeek(selectedDate))) });

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
        <div class="screen-subtitle" style="color:var(--accent); margin-top:4px;">${t(motivationKey())}</div>
      </div>

      ${weekStrip()}

      ${allHabits.length ? progressCardHtml(completedCount, totalCount) : ''}
      ${allHabits.length ? weeklyConsistencyHtml(longest) : ''}
      ${relinkBannerHtml(brokenHabits)}

      <div>
        <div class="section-head" style="margin-bottom:8px;">
          <span class="title">${sectionLabel}</span>
          <button class="chip accent clickable" id="addHabitToggle">+ ${t('addHabit')}</button>
        </div>

        ${showAddForm ? habitFormHtml('add', addDraft) : ''}

        ${allHabits.length === 0 && !showAddForm ? emptyHabitsHtml() : ''}
        ${allHabits.length > 0 && totalCount === 0 && !showAddForm ? noneScheduledHtml() : ''}

        <div class="col" id="habitList">
          ${dayHabits.map((h) => habitRowHtml(h)).join('')}
        </div>
      </div>

      ${pattern ? insightCardHtml(pattern) : (suggestion ? suggestionHtml(suggestion) : '')}
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
    if (showAddForm) addDraft = freshDraft();
    renderHome(root);
  });

  const emptyBtn = root.querySelector('#emptyAddBtn');
  if (emptyBtn) emptyBtn.addEventListener('click', () => { showAddForm = true; addDraft = freshDraft(); renderHome(root); });

  wireHabitForm(root, 'add', addDraft, () => {
    const form = root.querySelector('#addForm');
    const name = form.querySelector('#addName').value.trim();
    if (!name) return;
    if (addDraft.scheduleType === 'stacked' && !addDraft.seriesId) return;
    addHabit({
      name,
      scheduleType: addDraft.scheduleType,
      days: addDraft.scheduleType === 'independent' ? addDraft.days : undefined,
      time: addDraft.scheduleType === 'independent' ? form.querySelector('#addTime').value : '',
      stackSeriesId: addDraft.scheduleType === 'stacked' ? addDraft.seriesId : undefined,
      offsetMinutes: addDraft.scheduleType === 'stacked' ? addDraft.offset : undefined,
    });
    showAddForm = false;
    addDraft = freshDraft();
    renderHome(root);
  });

  root.querySelectorAll('.habit-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const habit = allHabits.find((h) => h.id === id);
      const wasDone = !!(habit && habit.history[selectedDate]);
      toggleHabitForDate(id, selectedDate);
      justToggledId = wasDone ? null : id;
      renderHome(root);
    });
  });

  root.querySelectorAll('.habit-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      removeHabit(btn.dataset.id);
      renderHome(root);
    });
  });

  root.querySelectorAll('.habit-edit-trigger, .relink-trigger').forEach((el) => {
    el.addEventListener('click', () => {
      const habit = allHabits.find((h) => h.id === el.dataset.id);
      if (!habit) return;
      editingHabitId = habit.id;
      editDraft = {
        name: habit.name,
        scheduleType: habit.scheduleType === 'stacked' ? 'stacked' : 'independent',
        days: habit.days ? [...habit.days] : [],
        time: habit.time || '',
        seriesId: habit.stackSeriesId || '',
        offset: habit.offsetMinutes ?? 0,
      };
      renderHome(root);
    });
  });

  const editForm = root.querySelector('#editForm');
  if (editForm) {
    wireHabitForm(root, 'edit', editDraft, () => {
      const name = editForm.querySelector('#editName').value.trim();
      if (!name) return;
      if (editDraft.scheduleType === 'stacked' && !editDraft.seriesId) return;
      updateHabit(editingHabitId, {
        name,
        scheduleType: editDraft.scheduleType,
        days: editDraft.scheduleType === 'independent' ? (editDraft.days.length ? editDraft.days : undefined) : undefined,
        time: editDraft.scheduleType === 'independent' ? editForm.querySelector('#editTime').value : '',
        stackSeriesId: editDraft.scheduleType === 'stacked' ? editDraft.seriesId : undefined,
        offsetMinutes: editDraft.scheduleType === 'stacked' ? editDraft.offset : undefined,
        needsRelink: false,
      });
      editingHabitId = null;
      editDraft = {};
      renderHome(root);
    });
    editForm.querySelector('#cancelEditBtn').addEventListener('click', () => {
      editingHabitId = null;
      editDraft = {};
      renderHome(root);
    });
  }

  const addSuggestBtn = root.querySelector('#addSuggestBtn');
  if (addSuggestBtn) {
    addSuggestBtn.addEventListener('click', () => {
      addHabit({ name: t('habitNamePlaceholder'), scheduleType: 'stacked', stackSeriesId: suggestion.seriesId, offsetMinutes: 0 });
      dismissedSuggestion = true;
      renderHome(root);
    });
  }
  const notNowBtn = root.querySelector('#notNowBtn');
  if (notNowBtn) notNowBtn.addEventListener('click', () => { dismissedSuggestion = true; renderHome(root); });

  const viewInsightBtn = root.querySelector('#viewInsightBtn');
  if (viewInsightBtn) viewInsightBtn.addEventListener('click', () => navigate('/insight'));
  const dismissInsightBtn = root.querySelector('#dismissInsightBtn');
  if (dismissInsightBtn) dismissInsightBtn.addEventListener('click', () => { dismissedInsight = true; renderHome(root); });

  if (!hasTourBeenSeen()) {
    requestAnimationFrame(() => startTour());
  }
}

// Shared wiring for both the add-habit and edit-habit forms: captures text-field values before
// any re-render triggered by a sibling control (weekday chip, schedule toggle, select) so typed
// text isn't lost, exactly the same fix applied to the calendar event form.
function wireHabitForm(root, prefix, draft, onSubmit) {
  const form = root.querySelector(`#${prefix}Form`);
  if (!form) return;

  const capture = () => {
    const nameEl = form.querySelector(`#${prefix}Name`);
    const timeEl = form.querySelector(`#${prefix}Time`);
    if (nameEl) draft.name = nameEl.value;
    if (timeEl) draft.time = timeEl.value;
  };

  form.querySelectorAll(`input[name="${prefix}ScheduleType"]`).forEach((r) => {
    r.addEventListener('change', () => { capture(); draft.scheduleType = r.value; renderHome(root); });
  });

  form.querySelectorAll('.weekday-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      capture();
      const day = Number(chip.dataset.day);
      draft.days = draft.days.includes(day) ? draft.days.filter((d) => d !== day) : [...draft.days, day];
      renderHome(root);
    });
  });

  const seriesSelect = form.querySelector('.stack-series-select');
  if (seriesSelect) {
    seriesSelect.addEventListener('change', () => { capture(); draft.seriesId = seriesSelect.value; renderHome(root); });
  }
  const offsetSelect = form.querySelector('.stack-offset-select');
  if (offsetSelect) {
    offsetSelect.addEventListener('change', () => { capture(); draft.offset = Number(offsetSelect.value); renderHome(root); });
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    onSubmit();
  });
}

function progressCardHtml(completed, total) {
  const pct = total ? Math.round((completed / total) * 100) : 0;
  const allDone = total > 0 && completed === total;
  let big;
  let sub;
  if (total === 0) {
    big = t('freeDayTitle');
    sub = t('freeDayBody');
  } else {
    big = t('progressCount', { done: completed, total });
    sub = allDone ? t('allDoneBody') : t('progressSub');
  }
  return `
    <div class="card dash-card">
      <div class="progress-ring" style="--pct:${total ? pct : 0}"><span class="ring-label">${total ? pct + '%' : '—'}</span></div>
      <div class="dash-progress-text grow">
        <div class="big">${big}</div>
        <div class="sub">${sub}</div>
      </div>
    </div>
  `;
}

function weeklyConsistencyHtml(longest) {
  const data = weeklyConsistency(7);
  const lang = getLang();
  const letters = lang === 'ar' ? ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'] : ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const bars = data.map((d) => {
    const isToday = d.date === todayStr();
    const dow = dayOfWeek(d.date);
    const barHtml = d.rate === null
      ? `<div class="wc-bar free"></div>`
      : `<div class="wc-bar" style="height:${Math.max(Math.round(d.rate * 100), d.completedCount > 0 ? 10 : 4)}%"></div>`;
    return `<div class="wc-col ${isToday ? 'today' : ''}" title="${escapeAttr(d.date)}"><div class="wc-bar-track">${barHtml}</div><div class="wc-label">${letters[dow]}</div></div>`;
  }).join('');
  return `
    <div class="card col">
      <div class="row between">
        <span class="label-sm">${t('weeklyConsistencyTitle')}</span>
        ${longest >= 2 ? `<span class="label-sm">🔥 ${t('longestStreakLabel', { n: longest })}</span>` : ''}
      </div>
      <div class="week-consistency">${bars}</div>
    </div>
  `;
}

function relinkBannerHtml(brokenHabits) {
  if (!brokenHabits.length) return '';
  return `
    <div class="card dashed" style="border-color:var(--danger); background:color-mix(in srgb, var(--danger) 12%, transparent);">
      <div class="row" style="gap:7px; margin-bottom:6px;">
        ${icon.warnTriangle}
        <span style="font-size:11.5px; font-weight:700; color:var(--danger);">${t('needsRelinkTitle')}</span>
      </div>
      <div class="col" style="gap:6px;">
        ${brokenHabits.map((h) => `
          <div class="row between" style="font-size:11.5px;">
            <span>${escapeHtml(h.name)}</span>
            <button class="chip solid clickable relink-trigger" data-id="${h.id}">${t('relinkBtn')}</button>
          </div>
        `).join('')}
      </div>
    </div>
  `;
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

function noneScheduledHtml() {
  return `
    <div class="empty-state card compact">
      <div class="icon-circle">${icon.circle}</div>
      <div class="title">${t('noneScheduledTodayTitle')}</div>
      <div class="body">${t('noneScheduledTodayBody')}</div>
    </div>
  `;
}

function habitFormHtml(prefix, draft) {
  const titleKey = prefix === 'add' ? 'newHabit' : 'editHabit';
  const submitKey = prefix === 'add' ? 'saveHabit' : 'save';
  return `
    <form id="${prefix}Form" class="card col" style="margin-bottom:10px;">
      <div class="label-sm">${t(titleKey)}</div>
      <input class="field" id="${prefix}Name" placeholder="${t('habitNamePlaceholder')}" value="${escapeAttr(draft.name)}" required />

      <div class="schedule-toggle">
        <label class="${draft.scheduleType === 'independent' ? 'checked' : ''}">
          <input type="radio" name="${prefix}ScheduleType" value="independent" ${draft.scheduleType === 'independent' ? 'checked' : ''}/>
          ${t('scheduleIndependent')}
        </label>
        <label class="${draft.scheduleType === 'stacked' ? 'checked' : ''}">
          <input type="radio" name="${prefix}ScheduleType" value="stacked" ${draft.scheduleType === 'stacked' ? 'checked' : ''}/>
          ${t('scheduleStacked')}
        </label>
      </div>

      ${draft.scheduleType === 'independent' ? independentFieldsHtml(prefix, draft) : stackedFieldsHtml(prefix, draft)}

      <button class="btn primary" type="submit">${t(submitKey)}</button>
    </form>
  `;
}

function independentFieldsHtml(prefix, draft) {
  return `
    <div>
      <label class="label-sm" style="display:block; margin-bottom:6px;">${t('independentDaysLabel')}</label>
      <div class="wrap-gap">
        ${[0, 1, 2, 3, 4, 5, 6].map((d) => `
          <button type="button" class="chip clickable weekday-chip ${draft.days.includes(d) ? 'solid' : ''}" data-day="${d}">${t(weekdayKey(d))}</button>
        `).join('')}
      </div>
      <div class="label-sm" style="margin-top:4px;">${draft.days.length ? '' : t('everyDayHint')}</div>
    </div>
    <label class="label-sm">${t('habitTimeLabel')}</label>
    <input class="field" type="time" id="${prefix}Time" value="${escapeAttr(draft.time)}" />
    <div class="label-sm">${t('habitTimeHint')}</div>
  `;
}

function stackedFieldsHtml(prefix, draft) {
  const seriesList = getEventSeriesList();
  const idPrefix = prefix;
  if (!seriesList.length) {
    return `
      <div class="empty-state card compact">
        <div class="icon-circle">${icon.calendar}</div>
        <div class="title">${t('noEventsToStackTitle')}</div>
        <div class="body">${t('noEventsToStackBody')}</div>
      </div>
    `;
  }
  return `
    <label class="label-sm">${t('stackEventLabel')}</label>
    <select class="field stack-series-select" id="${idPrefix}SeriesId">
      <option value="">—</option>
      ${seriesList.map((s) => `<option value="${s.seriesId}" ${s.seriesId === draft.seriesId ? 'selected' : ''}>${escapeHtml(seriesSummary(s))}</option>`).join('')}
    </select>
    <label class="label-sm">${t('stackOffsetLabel')}</label>
    <select class="field stack-offset-select" id="${idPrefix}Offset">
      <option value="0" ${draft.offset === 0 ? 'selected' : ''}>${t('offsetNow')}</option>
      <option value="10" ${draft.offset === 10 ? 'selected' : ''}>${t('offset10')}</option>
      <option value="30" ${draft.offset === 30 ? 'selected' : ''}>${t('offset30')}</option>
    </select>
    ${draft.seriesId ? previewHtml(draft.seriesId, draft.offset) : ''}
  `;
}

function seriesSummary(series) {
  const first = series.members[0];
  if (first.type === 'once') {
    return `${series.title} · ${first.date} · ${first.start}–${first.end}`;
  }
  const days = series.members.map((m) => t(weekdayKey(m.dayOfWeek))).join(', ');
  return `${series.title} · ${days} · ${first.start}–${first.end}`;
}

function previewHtml(seriesId, offset) {
  const occ = previewStackedOccurrences(seriesId, offset, 4);
  if (!occ.length) return `<div class="label-sm">${t('noUpcomingPreview')}</div>`;
  return `
    <div class="occurrence-preview">
      <div class="label-sm">${t('upcomingPreviewLabel')}</div>
      ${occ.map((o) => `<div class="occurrence-chip"><span class="d">${fmtPreviewDate(o.date)}</span><span dir="ltr">${o.time}</span></div>`).join('')}
    </div>
  `;
}

function fmtPreviewDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(getLang() === 'ar' ? 'ar' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function habitRowHtml(habit) {
  if (habit.id === editingHabitId) return habitFormHtml('edit', editDraft);
  const doneToday = !!habit.history[selectedDate];
  const streak = habitStreak(habit);
  const needsRelink = habitNeedsRelink(habit);
  const subParts = [];
  if (habit.resolvedTime) subParts.push(`<span dir="ltr">${habit.resolvedTime}</span>`);
  if (habit.scheduleType === 'stacked') {
    const linkedTitle = habitLinkedEventTitle(habit);
    if (linkedTitle) subParts.push(`${t('stackedAfter')}: ${escapeHtml(linkedTitle)}`);
  } else if (habit.days && habit.days.length && habit.days.length < 7) {
    subParts.push(habit.days.slice().sort((a, b) => a - b).map((d) => t(weekdayKey(d))).join(', '));
  }
  return `
    <div class="card row habit-row-card ${doneToday ? 'done' : ''}">
      <button class="icon-circle sm ${doneToday ? 'filled' : 'muted'} habit-toggle-btn habit-toggle ${habit.id === justToggledId ? 'pulse' : ''}" data-id="${habit.id}" title="${doneToday ? t('markUndone') : t('markDone')}" style="border:none;cursor:pointer;">
        ${doneToday ? icon.check : icon.circle}
      </button>
      <div class="grow habit-edit-trigger" data-id="${habit.id}" style="cursor:pointer;">
        <div class="habit-name" style="font-size:12px; font-weight:700;">${escapeHtml(habit.name)}</div>
        <div style="font-size:10px; color:var(--text-muted);">${subParts.length ? subParts.join(' · ') : t('everyDayLabel')}</div>
        ${needsRelink ? `<div class="relink-warning">${icon.warnTriangle}${t('needsRelinkWarning')}</div>` : ''}
      </div>
      ${streak > 0 ? `<span class="chip streak"><span class="streak-flame">🔥</span>${streak}</span>` : ''}
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
      <div style="font-size:11px; margin-bottom:9px;">${suggestionCopy(suggestion)}</div>
      <div class="row" style="gap:6px;">
        <button class="chip solid clickable" id="addSuggestBtn" style="flex:1; justify-content:center; padding:7px 0;">${t('addBtn')}</button>
        <button class="chip clickable" id="notNowBtn" style="flex:1; justify-content:center; padding:7px 0;">${t('notNow')}</button>
      </div>
    </div>
  `;
}

function insightCardHtml(pattern) {
  return `
    <div class="card dashed">
      <div class="row" style="gap:7px; margin-bottom:6px;">
        ${icon.alert}
        <span style="font-size:11.5px; font-weight:700; color:var(--accent);">${t('insightTitle')}</span>
      </div>
      <div style="font-size:12px; line-height:1.5; margin-bottom:9px;">${patternSentence(pattern)}</div>
      <div class="row" style="gap:6px;">
        <button class="chip solid clickable" id="viewInsightBtn" style="flex:1; justify-content:center; padding:7px 0;">${t('insightCta')}</button>
        <button class="chip clickable" id="dismissInsightBtn" style="flex:1; justify-content:center; padding:7px 0;">${t('notNow')}</button>
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
