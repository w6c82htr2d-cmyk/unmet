import { t, getLang } from '../i18n.js';
import { icon } from '../icons.js';
import {
  getEvents, addEvent, addEvents, removeEvent, removeEventSeries, updateEvent, updateEventSeries, updateEventOccurrence,
  removeEventOccurrence, eventsForDate, habitsForDate, todayStr, dayOfWeek, addDays, uid,
  habitLinkedEventTitles, updateHabit, getCalendarView, setCalendarView, getHabits, hasRoutines,
  snapshotEventSeries, restoreEventSeries, setRoutineDays,
} from '../db.js';
import { parseEventText } from '../lib/nlEvent.js';
import { showUndoToast } from '../lib/undoToast.js';
import { weekdayKey } from '../lib/patterns.js';
import { dateForDisplay } from '../lib/dates.js';
import { navigate } from '../router.js';
import { requestHabitEdit, requestAddHabit, consumePendingAddRoutine, consumePendingAddEvent } from '../lib/pendingEdit.js';

const HOUR_START = 6;
const HOUR_END = 23;
const PX_PER_HOUR = 52;
const GRID_HEIGHT = (HOUR_END - HOUR_START) * PX_PER_HOUR;
const WEEK_PX_PER_HOUR = 30;
const WEEK_GRID_HEIGHT = (HOUR_END - HOUR_START) * WEEK_PX_PER_HOUR;
const WEEK_MIN_BLOCK_PX = 16;
const SNAP_MIN = 15;
const MIN_BLOCK_PX = 26;
const LONG_PRESS_MS = 350;
const MOVE_CANCEL_PX = 8;

// 'agenda' (Overview) | 'day' | 'week', remembered across visits. First visit: the compact
// Overview on phones, the time grid on wider screens.
let viewMode = getCalendarView() || (typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches ? 'agenda' : 'day');
let weekStart = startOfWeek(todayStr());
let selectedDate = todayStr();
let lastSeenToday = todayStr(); // lets a page left open past midnight follow the date forward
let showForm = false;
let formType = 'once';
let selectedWeekdays = [];
let formDraft = {};
let editingEvent = null; // { event, scope: 'occurrence' | 'series' }
let pointerBusy = false; // true while a create/reschedule drag session is active anywhere on the grid
let routineSuccessEventIds = null; // set right after a routine is created → "Your routine is set!"
let routineSuccessTitle = '';
let dismissedHabitNudge = false; // "Maybe later" on the routine->habit nudge, for this session only
let addMenuOpen = false;
let nlText = ''; // plain-language entry ("Classes every Sun, Tue, Thu 8–11am")
let nlResult = null; // its parsed preview, shown for confirmation before anything is saved
let formError = '';
let scrollToFormNext = false;

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function fromMinutes(min) {
  const clamped = Math.max(0, Math.min(min, 24 * 60 - 1));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function snap(min) {
  return Math.round(min / SNAP_MIN) * SNAP_MIN;
}

function clampMinutes(m) {
  return Math.min(Math.max(m, HOUR_START * 60), HOUR_END * 60);
}

function minutesToPx(min, pxPerHour = PX_PER_HOUR) {
  return (clampMinutes(min) - HOUR_START * 60) / 60 * pxPerHour;
}

function pxToMinutes(px, pxPerHour = PX_PER_HOUR) {
  return HOUR_START * 60 + (px / pxPerHour) * 60;
}

function startOfWeek(dateStr) {
  return addDays(dateStr, -dayOfWeek(dateStr));
}

function fmtShort(dateStr) {
  return dateForDisplay(dateStr).toLocaleDateString(getLang() === 'ar' ? 'ar' : 'en-US', { month: 'short', day: 'numeric' });
}

// Greedy interval-graph column layout so overlapping blocks sit side by side instead of stacking
// unreadably on top of each other.
function layoutOverlaps(rows) {
  const items = rows
    .map((row) => ({ row, s: toMinutes(row.start), e: Math.max(toMinutes(row.end), toMinutes(row.start) + 1) }))
    .sort((a, b) => a.s - b.s || a.e - b.e);
  const clusters = [];
  let current = [];
  let clusterEnd = -1;
  items.forEach((item) => {
    if (current.length && item.s >= clusterEnd) {
      clusters.push(current);
      current = [];
      clusterEnd = -1;
    }
    current.push(item);
    clusterEnd = Math.max(clusterEnd, item.e);
  });
  if (current.length) clusters.push(current);

  clusters.forEach((cluster) => {
    const colEnds = [];
    cluster.forEach((item) => {
      let col = colEnds.findIndex((end) => item.s >= end);
      if (col === -1) { col = colEnds.length; colEnds.push(item.e); } else colEnds[col] = item.e;
      item.col = col;
    });
    const totalCols = colEnds.length;
    cluster.forEach((item) => { item.row.col = item.col; item.row.cols = totalCols; });
  });
  return items.map((item) => item.row);
}

function dayRows(date) {
  const eventRows = eventsForDate(date).map((ev) => ({
    type: 'event', id: ev.id, seriesId: ev.seriesId, eventType: ev.type, title: ev.title,
    start: ev.start, end: ev.end, source: ev.source,
  }));
  const habitRows = habitsForDate(date)
    .filter((h) => h.resolvedTime && h.resolvedEndTime)
    .map((h) => ({
      type: 'habit', id: h.id, title: h.name, start: h.resolvedTime, end: h.resolvedEndTime,
      done: !!h.history[date], stacked: h.scheduleType === 'stacked', position: h.stackPosition,
      linkedTitles: h.scheduleType === 'stacked' ? habitLinkedEventTitles(h) : [],
    }));
  return layoutOverlaps([...eventRows, ...habitRows]);
}

function gridBlocksHtml(rows, pxPerHour = PX_PER_HOUR, minBlockPx = MIN_BLOCK_PX, draggableEnabled = true) {
  return rows.map((r) => {
    const top = minutesToPx(toMinutes(r.start), pxPerHour);
    const height = Math.max(minutesToPx(toMinutes(r.end), pxPerHour) - top, minBlockPx);
    const widthPct = 100 / r.cols;
    const leftPct = r.col * widthPct;
    const showTime = height >= 30;
    const typeClass = r.type === 'event' ? 'event' : (r.stacked ? 'habit stacked' : 'habit');
    const doneClass = r.type === 'habit' && r.done ? ' done' : '';
    const draggable = draggableEnabled && (r.type === 'event' || (r.type === 'habit' && !r.stacked));
    const stackWord = t(r.position === 'before' ? 'stackedBefore' : 'stackedAfter');
    const subtitle = r.type === 'habit' && r.stacked && r.linkedTitles.length
      ? `${stackWord} ${r.linkedTitles.join(', ')}`
      : `${r.start}–${r.end}`;
    return `
      <div class="grid-block ${typeClass}${doneClass}" data-row-id="${r.id}" data-row-type="${r.type}" ${draggable ? 'data-draggable="1"' : ''}
        title="${escapeAttr(r.title)} (${subtitle})"
        style="top:${top}px; height:${height}px; left:calc(${leftPct}% + 2px); width:calc(${widthPct}% - 4px);">
        <div class="gb-title">${r.type === 'habit' && r.done ? '<span class="gb-check">✓</span>' : ''}${escapeHtml(r.title)}</div>
        ${showTime ? `<div class="gb-time" dir="ltr">${r.start}–${r.end}</div>` : ''}
        ${r.type === 'habit' && r.stacked ? `<span class="gb-link" title="${escapeAttr(`${stackWord} ${r.linkedTitles.join(', ')}`)}">${icon.sync}</span>` : ''}
      </div>
    `;
  }).join('');
}

function weekDaysMeta() {
  const dayLetters = getLang() === 'ar'
    ? ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س']
    : ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  return [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const date = addDays(weekStart, i);
    return { date, letter: dayLetters[i], isToday: date === todayStr() };
  });
}

function dayStripHtml(days) {
  return `
    <div class="week-strip">
      ${days.map((d) => `
        <button class="day-pill ${d.isToday ? 'today' : ''} ${d.date === selectedDate ? 'selected' : ''}" data-date="${d.date}">
          <div class="d">${d.letter}</div>
          <div class="n">${Number(d.date.slice(8, 10))}${d.isToday ? '<span class="dot"></span>' : ''}</div>
        </button>
      `).join('')}
    </div>
  `;
}

function dayViewHtml(rows) {
  return `
    <div class="day-grid-wrap">
      <div class="hour-gutter">
        ${Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i).map((h) => `<div class="hour-label" dir="ltr" style="top:${(h - HOUR_START) * PX_PER_HOUR}px;">${h}</div>`).join('')}
      </div>
      <div class="day-col-wide" id="dayCol" style="height:${GRID_HEIGHT}px;">
        ${gridBlocksHtml(rows)}
      </div>
    </div>
    ${rows.length === 0 ? `<div class="label-sm center-text" style="margin-top:-6px;">${t('tapToCreateHint')}</div>` : ''}
  `;
}

function weekViewHtml(days) {
  const monthFmt = (d) => dateForDisplay(d).toLocaleDateString(getLang() === 'ar' ? 'ar' : 'en-US', { month: 'short' });
  return `
    <div class="week-grid-scroll">
      <div class="week-grid-inner">
        <div class="week-hour-gutter">
          <div class="week-gutter-head"></div>
          <div class="week-gutter-body" style="height:${WEEK_GRID_HEIGHT}px;">
            ${Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i).map((h) => `<div class="hour-label" dir="ltr" style="top:${(h - HOUR_START) * WEEK_PX_PER_HOUR}px;">${h}</div>`).join('')}
          </div>
        </div>
        ${days.map((d) => `
          <div class="week-day-col">
            <button class="week-day-col-header ${d.isToday ? 'today' : ''}" data-date="${d.date}" title="${t('openDayView')}">
              <span class="wl">${d.letter}</span>
              <span class="wn" dir="ltr">${Number(d.date.slice(8, 10))}</span>
              <span class="wm">${monthFmt(d.date)}</span>
            </button>
            <div class="week-day-col-body" data-date="${d.date}" style="height:${WEEK_GRID_HEIGHT}px;">
              ${gridBlocksHtml(dayRows(d.date), WEEK_PX_PER_HOUR, WEEK_MIN_BLOCK_PX, false)}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// Which guidance card to show. After saving any routine, the "Your routine is set!" card leads to
// building a habit around it; otherwise first-time users are guided until they have a habit.
function guidancePhase() {
  if (routineSuccessEventIds) return 'success';
  if (getHabits().length > 0) return null;
  if (!hasRoutines()) return 'routine';
  return 'habit';
}

function consumeHandOffs() {
  const routine = consumePendingAddRoutine();
  if (routine) {
    formType = 'weekly';
    selectedWeekdays = [];
    formDraft = { title: routine.title || '' };
    editingEvent = null;
    nlResult = null;
    addMenuOpen = false;
    formError = '';
    showForm = true;
    scrollToFormNext = true;
  }
  const ev = consumePendingAddEvent();
  if (ev) {
    const startMin = nextHalfHour();
    const minutes = Math.min(240, Math.max(15, Math.round(Number(ev.minutes) || 30)));
    formType = 'once';
    selectedWeekdays = [];
    formDraft = { title: ev.title || '', date: todayStr(), start: fromMinutes(startMin), end: fromMinutes(Math.min(startMin + minutes, 24 * 60 - 1)) };
    editingEvent = null;
    nlResult = null;
    addMenuOpen = false;
    formError = '';
    showForm = true;
    scrollToFormNext = true;
  }
}

function nextHalfHour() {
  const now = new Date();
  const m = now.getHours() * 60 + now.getMinutes();
  return Math.min(Math.ceil((m + 1) / 30) * 30, 23 * 60);
}

export function renderCalendar(root) {
  // If the app was left open across midnight and the user was still looking at "today", move to
  // the new today (and its week) instead of leaving them on yesterday.
  const now = todayStr();
  if (now !== lastSeenToday) {
    if (selectedDate === lastSeenToday) {
      selectedDate = now;
      weekStart = startOfWeek(now);
    }
    lastSeenToday = now;
  }
  consumeHandOffs();
  const rows = dayRows(selectedDate);
  const days = weekDaysMeta();
  const phase = guidancePhase();
  const guidanceHtml = guidanceCardHtml(phase);
  const onToday = viewMode === 'week' ? weekStart === startOfWeek(todayStr()) : selectedDate === todayStr();
  const navLabel = viewMode === 'week'
    ? `${fmtShort(weekStart)} – ${fmtShort(addDays(weekStart, 6))}`
    : dateForDisplay(selectedDate).toLocaleDateString(getLang() === 'ar' ? 'ar' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  root.innerHTML = `
    <div class="page cal">
      <header>
        <h1 class="screen-title">${t('calendarTitle')}</h1>
        <div class="screen-subtitle">${t('calendarSubtitle')}</div>
      </header>

      ${guidanceHtml}

      <div class="cal-actions">
        <button class="btn primary grow" id="addMenuBtn" aria-expanded="${addMenuOpen}">${icon.plus} ${t('addToCalendar')}</button>
        <button class="btn secondary grow" id="addHabitQuickBtn">${icon.plus} ${t('addHabitBtn')}</button>
      </div>
      ${addMenuOpen ? addMenuHtml() : ''}
      ${nlResult ? nlPreviewHtml(nlResult) : ''}
      ${showForm ? eventFormHtml() : ''}

      <div class="cal-toolbar">
        <div class="seg cal-views" role="radiogroup" aria-label="${escapeAttr(t('calendarViewLabel'))}" id="viewToggle">
          ${[['agenda', 'overviewViewLabel'], ['day', 'dayViewLabel'], ['week', 'weekViewLabel']].map(([v, k]) => `
            <button type="button" role="radio" class="seg-btn ${viewMode === v ? 'on' : ''}" data-val="${v}" aria-checked="${viewMode === v}">${t(k)}</button>
          `).join('')}
        </div>
      </div>

      <div class="cal-nav">
        <button class="btn secondary sm" id="prevBtn" aria-label="${t('previousPeriod')}">${icon.back}</button>
        <div class="cal-nav-label" dir="${getLang() === 'ar' ? 'rtl' : 'ltr'}">
          <span>${escapeHtml(navLabel)}</span>
          ${onToday ? '' : `<button class="chip clickable" id="todayBtn">${t('todayBtn')}</button>`}
        </div>
        <button class="btn secondary sm flip-x" id="nextBtn" aria-label="${t('nextPeriod')}">${icon.back}</button>
      </div>

      ${viewMode !== 'week' ? dayStripHtml(days) : ''}

      ${viewMode !== 'agenda' ? `
        <div class="row" style="gap:14px;">
          <div class="row" style="gap:5px;"><span class="legend-dot event"></span><span class="label-sm">${t('legendCalendar')}</span></div>
          <div class="row" style="gap:5px;"><span class="legend-dot habit"></span><span class="label-sm">${t('legendHabit')}</span></div>
        </div>` : ''}

      ${viewMode === 'agenda' ? agendaHtml(rows) : viewMode === 'day' ? dayViewHtml(rows) : weekViewHtml(days)}

      ${routineListHtml()}
    </div>

    ${editingEvent ? eventEditModalHtml(editingEvent) : ''}
  `;

  root.querySelectorAll('#viewToggle [data-val]').forEach((btn) => {
    btn.addEventListener('click', () => {
      viewMode = btn.dataset.val;
      setCalendarView(viewMode);
      renderCalendar(root);
    });
  });

  root.querySelector('#prevBtn').addEventListener('click', () => {
    if (viewMode === 'week') {
      weekStart = addDays(weekStart, -7);
      selectedDate = addDays(selectedDate, -7);
    } else {
      selectedDate = addDays(selectedDate, -1);
      weekStart = startOfWeek(selectedDate);
    }
    renderCalendar(root);
  });
  root.querySelector('#nextBtn').addEventListener('click', () => {
    if (viewMode === 'week') {
      weekStart = addDays(weekStart, 7);
      selectedDate = addDays(selectedDate, 7);
    } else {
      selectedDate = addDays(selectedDate, 1);
      weekStart = startOfWeek(selectedDate);
    }
    renderCalendar(root);
  });
  root.querySelector('#todayBtn')?.addEventListener('click', () => {
    weekStart = startOfWeek(todayStr());
    selectedDate = todayStr();
    renderCalendar(root);
  });

  root.querySelectorAll('.day-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedDate = btn.dataset.date;
      renderCalendar(root);
    });
  });

  root.querySelector('#addMenuBtn').addEventListener('click', () => {
    addMenuOpen = !addMenuOpen;
    if (addMenuOpen) { showForm = false; nlResult = null; editingEvent = null; }
    renderCalendar(root);
    if (addMenuOpen) root.querySelector('#nlInput')?.focus();
  });
  root.querySelector('#addHabitQuickBtn').addEventListener('click', () => {
    requestAddHabit([]);
    navigate('/');
  });

  if (viewMode === 'day') wireDayColumn(root);
  else if (viewMode === 'week') wireWeekView(root, days);
  else wireAgenda(root, rows);

  wireGuidanceCard(root);
  wireAddMenu(root);
  wireNlPreview(root);
  wireCreateForm(root);
  wireManageList(root);
  if (editingEvent) wireEventModal(root);

  if (scrollToFormNext) {
    scrollToFormNext = false;
    requestAnimationFrame(() => {
      const form = root.querySelector('#eventForm');
      if (!form) return;
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      form.querySelector('#evTitle')?.focus({ preventScroll: true });
    });
  }
}

// ---------- "+ Add to calendar": describe it in words, or add a routine / one-time event ----------
function addMenuHtml() {
  return `
    <div class="card add-menu">
      <form id="nlForm" class="nl-form" novalidate>
        <label class="q-label" for="nlInput">${t('nlLabel')}</label>
        <div class="nl-row">
          <input class="field grow" id="nlInput" value="${escapeAttr(nlText)}" placeholder="${escapeAttr(t('nlPlaceholder'))}" autocomplete="off" maxlength="300" />
          <button class="btn primary sm" type="submit">${t('nlPreviewBtn')}</button>
        </div>
        <p class="form-note">${t('nlHint')}</p>
      </form>
      <div class="add-menu-or">${t('orStepByStep')}</div>
      <div class="add-menu-choices">
        <button class="add-choice" id="addRoutineQuickBtn">
          <span class="ac-icon" aria-hidden="true">${icon.repeat}</span>
          <span class="ac-text"><span class="ac-title">${t('addRoutineChoice')}</span><span class="ac-sub">${t('addRoutineChoiceSub')}</span></span>
        </button>
        <button class="add-choice" id="addEventBtn">
          <span class="ac-icon" aria-hidden="true">${icon.calendar}</span>
          <span class="ac-text"><span class="ac-title">${t('addOnceChoice')}</span><span class="ac-sub">${t('addOnceChoiceSub')}</span></span>
        </button>
      </div>
    </div>
  `;
}

function wireAddMenu(root) {
  const nlForm = root.querySelector('#nlForm');
  if (!nlForm) return;
  nlForm.addEventListener('submit', (e) => {
    e.preventDefault();
    nlText = root.querySelector('#nlInput').value.trim();
    if (!nlText) return;
    nlResult = parseEventText(nlText, { today: todayStr(), lang: getLang() });
    addMenuOpen = false;
    renderCalendar(root);
    requestAnimationFrame(() => root.querySelector('.nl-preview')?.focus());
  });
  root.querySelector('#addRoutineQuickBtn').addEventListener('click', () => openRoutineForm(root));
  root.querySelector('#addEventBtn').addEventListener('click', () => {
    formType = 'once';
    selectedWeekdays = [];
    formDraft = {};
    formError = '';
    addMenuOpen = false;
    showForm = true;
    scrollToFormNext = true;
    renderCalendar(root);
  });
}

// ---------- Plain-language preview: nothing is saved until the user confirms ----------
function durationLabel(start, end) {
  const mins = toMinutes(end) - toMinutes(start);
  if (mins <= 0) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h && m ? t('durHM', { h, m }) : h ? t('durH', { h }) : t('durM', { m });
}

function daysListText(days) {
  if (days.length === 7) return t('everyDayLabel');
  return days.map((d) => t(weekdayKey(d))).join(getLang() === 'ar' ? '، ' : ', ');
}

function nlPreviewHtml(r) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const timeBad = r.start && r.end && toMinutes(r.end) <= toMinutes(r.start);
  const missing = [...r.missing];
  if (timeBad) missing.push('order');
  const missingText = { title: t('nlMissingTitle'), days: t('nlMissingDays'), start: t('nlMissingStart'), end: t('nlMissingEnd'), order: t('evErrOrder') };
  const repeats = r.type === 'weekly'
    ? t('nlRepeatsEvery', { days: daysListText(r.days) })
    : r.type === 'once' ? escapeHtml(dateForDisplay(r.date).toLocaleDateString(getLang() === 'ar' ? 'ar' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric' })) : '—';
  return `
    <section class="card nl-preview" tabindex="-1" aria-labelledby="nlPreviewTitle">
      <h2 class="insight-kicker" id="nlPreviewTitle">${t('nlCheckTitle')}</h2>
      <p class="form-note nl-quote">“${escapeHtml(nlText)}”</p>
      <dl class="nl-fields">
        <div><dt>${t('nlFieldTitle')}</dt><dd>${r.title ? escapeHtml(r.title) : '—'}</dd></div>
        <div><dt>${t(r.type === 'weekly' ? 'nlFieldRepeats' : 'nlFieldDate')}</dt><dd>${repeats}</dd></div>
        <div><dt>${t('nlFieldTime')}</dt><dd dir="ltr">${r.start || '—'}${r.end ? '–' + r.end : ''}${r.start && r.end && !timeBad ? ` <span class="nl-dur">(${durationLabel(r.start, r.end)})</span>` : ''}</dd></div>
        <div><dt>${t('nlFieldTimeZone')}</dt><dd dir="ltr">${escapeHtml(tz)}</dd></div>
      </dl>
      ${missing.length ? `<div class="form-error" role="alert">${missing.map((k) => missingText[k]).join(' ')}</div>` : ''}
      <div class="form-actions">
        <button class="btn primary grow" id="nlSaveBtn" ${missing.length ? 'disabled' : ''}>${t(r.type === 'weekly' ? 'nlSaveRoutine' : 'nlSaveEvent')}</button>
        <button class="btn secondary grow" id="nlEditBtn">${t('nlEditDetails')}</button>
      </div>
      <button class="btn ghost" id="nlCancelBtn">${t('cancel')}</button>
    </section>
  `;
}

function wireNlPreview(root) {
  const card = root.querySelector('.nl-preview');
  if (!card) return;
  root.querySelector('#nlSaveBtn').addEventListener('click', () => {
    const r = nlResult;
    if (r.type === 'weekly') {
      const seriesId = uid();
      addEvents(r.days.map((d) => ({ title: r.title, type: 'weekly', dayOfWeek: d, startDate: todayStr(), start: r.start, end: r.end, source: 'manual', seriesId })));
      afterRoutineSaved(root, seriesId);
    } else {
      addEvent({ title: r.title, type: 'once', date: r.date, start: r.start, end: r.end, source: 'manual' });
      selectedDate = r.date;
      weekStart = startOfWeek(r.date);
      nlResult = null;
      nlText = '';
      renderCalendar(root);
    }
  });
  root.querySelector('#nlEditBtn').addEventListener('click', () => {
    const r = nlResult;
    formType = r.type === 'once' ? 'once' : 'weekly';
    selectedWeekdays = r.type === 'weekly' ? [...r.days] : [];
    formDraft = { title: r.title, start: r.start || '', end: r.end || '', date: r.date || selectedDate };
    formError = '';
    nlResult = null;
    showForm = true;
    scrollToFormNext = true;
    renderCalendar(root);
  });
  root.querySelector('#nlCancelBtn').addEventListener('click', () => { nlResult = null; renderCalendar(root); });
}

// A new routine was saved (form or plain-language entry): show "Your routine is set!" at the top
// and bring it on screen, so building a habit around it is the obvious next step.
function afterRoutineSaved(root, seriesId) {
  routineSuccessEventIds = getEvents().filter((e) => e.seriesId === seriesId).map((e) => e.id);
  routineSuccessTitle = getEvents().find((e) => e.seriesId === seriesId)?.title || '';
  nlResult = null;
  nlText = '';
  showForm = false;
  selectedWeekdays = [];
  formDraft = {};
  formError = '';
  renderCalendar(root);
  requestAnimationFrame(() => {
    const card = root.querySelector('.guidance-card');
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    root.querySelector('#goAddHabitBtn')?.focus({ preventScroll: true });
  });
}

// ---------- Overview: the selected day as a simple chronological list ----------
function agendaHtml(rows) {
  const items = [...rows].sort((a, b) => a.start.localeCompare(b.start) || (a.type === 'event' ? -1 : 1));
  if (!items.length) {
    return `
      <div class="empty-state card compact agenda-empty">
        <div class="title">${t('agendaEmptyTitle')}</div>
        <div class="body">${t('agendaEmptyBody')}</div>
      </div>
    `;
  }
  const gaps = freeGaps(items);
  const parts = [];
  items.forEach((r) => {
    const gapBefore = gaps.find((g) => g.end === r.start && !g.shown);
    if (gapBefore) { gapBefore.shown = true; parts.push(gapHtml(gapBefore)); }
    parts.push(agendaItemHtml(r));
  });
  gaps.filter((g) => !g.shown).forEach((g) => parts.push(gapHtml(g)));
  return `<div class="agenda" id="agendaList">${parts.join('')}</div>`;
}

// Free stretches of at least an hour between 07:00 and 22:00, so it's easy to see where a new
// habit or event could fit.
function freeGaps(items) {
  const DAY_START = 7 * 60;
  const DAY_END = 22 * 60;
  const busy = items.map((r) => [toMinutes(r.start), toMinutes(r.end)]).sort((a, b) => a[0] - b[0]);
  const gaps = [];
  let cursor = DAY_START;
  busy.forEach(([s, e]) => {
    if (s - cursor >= 60 && s > DAY_START) gaps.push({ start: fromMinutes(cursor), end: fromMinutes(Math.min(s, DAY_END)) });
    cursor = Math.max(cursor, e);
  });
  if (DAY_END - cursor >= 60) gaps.push({ start: fromMinutes(cursor), end: fromMinutes(DAY_END) });
  return gaps.filter((g) => toMinutes(g.end) - toMinutes(g.start) >= 60);
}

function gapHtml(g) {
  return `
    <div class="agenda-gap">
      <span>${t('freeTime')} <span dir="ltr">${g.start}–${g.end}</span></span>
      <button class="chip clickable gap-add" data-start="${g.start}" aria-label="${escapeAttr(t('addAtTime', { time: g.start }))}">${icon.plus}</button>
    </div>
  `;
}

function agendaItemHtml(r) {
  const kind = r.type === 'habit'
    ? (r.stacked && r.linkedTitles.length ? `${t('legendHabit')} · ${t(r.position === 'before' ? 'stackedBefore' : 'stackedAfter')} ${escapeHtml(r.linkedTitles.join(', '))}` : t('legendHabit'))
    : t(r.eventType === 'weekly' ? 'routineLabel' : 'oneTimeLabel');
  return `
    <button class="agenda-item ${r.type}${r.done ? ' done' : ''}" data-row-id="${r.id}" data-row-type="${r.type}">
      <span class="ag-time" dir="ltr"><span>${r.start}</span><span class="ag-end">${r.end}</span></span>
      <span class="ag-body">
        <span class="ag-title">${r.type === 'habit' && r.done ? `<span class="ag-done" aria-hidden="true">${icon.check}</span><span class="sr-only">${t('dayDone')}: </span>` : ''}${escapeHtml(r.title)}</span>
        <span class="ag-meta">${durationLabel(r.start, r.end)} · ${kind}</span>
      </span>
    </button>
  `;
}

function wireAgenda(root, rows) {
  root.querySelectorAll('.agenda-item').forEach((el) => {
    const row = rows.find((r) => r.id === el.dataset.rowId && r.type === el.dataset.rowType);
    if (row) el.addEventListener('click', () => openBlockDetail(row, root));
  });
  root.querySelectorAll('.gap-add').forEach((btn) => {
    btn.addEventListener('click', () => {
      const start = btn.dataset.start;
      openCreateFormAt(selectedDate, start, fromMinutes(toMinutes(start) + 30), root);
    });
  });
}

// ---------- Guidance: "start with your routine" → "your routine is set" → build a habit ----------

function stepsIndicatorHtml(currentStep) {
  const steps = [
    { n: 1, labelKey: 'stepRoutineLabel' },
    { n: 2, labelKey: 'stepHabitLabel' },
    { n: 3, labelKey: 'stepTrackLabel' },
  ];
  return `
    <div class="steps-row">
      ${steps.map((s) => `
        <div class="step-item ${s.n === currentStep ? 'current' : ''} ${s.n < currentStep ? 'done' : ''}">
          <div class="step-dot">${s.n < currentStep ? icon.check : s.n}</div>
          <div class="step-label">${t(s.labelKey)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function guidanceCardHtml(phase) {
  if (!phase) return '';

  if (phase === 'routine') {
    return `
      <section class="card guidance-card" aria-labelledby="gcTitle">
        ${stepsIndicatorHtml(1)}
        <h2 class="gc-title" id="gcTitle">${t('startRoutineTitle')}</h2>
        <div class="gc-body">${t('startRoutineBody')}</div>
        <ul class="gc-examples">
          <li>${t('routineExampleClasses')}</li>
          <li>${t('routineExampleWork')}</li>
          <li>${t('routineExampleOther')}</li>
        </ul>
        <button class="btn primary" id="addRoutineBtn">${icon.plus} ${t('addRoutineBtn')}</button>
        <p class="form-note">${t('routineOptionalNote')}</p>
      </section>
    `;
  }

  if (phase === 'success') {
    return `
      <section class="card guidance-card accent" aria-labelledby="gcTitle">
        ${getHabits().length ? '' : stepsIndicatorHtml(2)}
        <h2 class="gc-title" id="gcTitle">${t('routineSuccessTitle')}</h2>
        <div class="gc-body">${routineSuccessTitle ? t('routineSuccessBody', { title: escapeHtml(routineSuccessTitle) }) : ''}</div>
        <div class="row" style="gap:8px; margin-top:10px;">
          <button class="btn primary grow" id="goAddHabitBtn">${t('addHabitBtn')}</button>
          <button class="btn secondary grow" id="maybeLaterBtn">${t('maybeLaterBtn')}</button>
        </div>
      </section>
    `;
  }

  if (dismissedHabitNudge) return '';

  return `
    <section class="card guidance-card" aria-labelledby="gcTitle">
      ${stepsIndicatorHtml(2)}
      <h2 class="gc-title" id="gcTitle">${t('readyForHabitTitle')}</h2>
      <div class="gc-body">${t('readyForHabitBody')}</div>
      <div class="row" style="gap:8px; margin-top:10px;">
        <button class="btn primary grow" id="goAddHabitBtn">${t('addHabitBtn')}</button>
        <button class="btn secondary grow" id="maybeLaterBtn">${t('maybeLaterBtn')}</button>
      </div>
    </section>
  `;
}

function openRoutineForm(root) {
  formType = 'weekly';
  selectedWeekdays = [];
  formDraft = {};
  formError = '';
  editingEvent = null;
  addMenuOpen = false;
  nlResult = null;
  showForm = true;
  scrollToFormNext = true;
  renderCalendar(root);
}

function wireGuidanceCard(root) {
  const addRoutineBtn = root.querySelector('#addRoutineBtn');
  if (addRoutineBtn) addRoutineBtn.addEventListener('click', () => openRoutineForm(root));

  const goAddHabitBtn = root.querySelector('#goAddHabitBtn');
  if (goAddHabitBtn) {
    goAddHabitBtn.addEventListener('click', () => {
      requestAddHabit(routineSuccessEventIds || []);
      routineSuccessEventIds = null;
      navigate('/');
    });
  }

  const maybeLaterBtn = root.querySelector('#maybeLaterBtn');
  if (maybeLaterBtn) {
    maybeLaterBtn.addEventListener('click', () => {
      routineSuccessEventIds = null;
      dismissedHabitNudge = true;
      renderCalendar(root);
    });
  }
}

// ---------- Day / week grid interaction ----------

function wireDayColumn(root) {
  const colEl = root.querySelector('#dayCol');
  const rows = dayRows(selectedDate);

  colEl.querySelectorAll('.grid-block[data-draggable]').forEach((el) => {
    const row = rows.find((r) => r.id === el.dataset.rowId && r.type === el.dataset.rowType);
    if (row) attachBlockDrag(el, row, colEl, root);
  });
  colEl.querySelectorAll('.grid-block:not([data-draggable])').forEach((el) => {
    const row = rows.find((r) => r.id === el.dataset.rowId && r.type === el.dataset.rowType);
    el.addEventListener('click', () => openBlockDetail(row, root));
  });

  let holdTimer = null;
  let pressX = 0;
  let pressY = 0;
  let armed = false;
  let anchorMin = 0;

  const clearHold = () => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } };

  colEl.addEventListener('pointerdown', (e) => {
    if (pointerBusy || e.target.closest('.grid-block')) return;
    pressX = e.clientX;
    pressY = e.clientY;
    armed = false;
    const rect = colEl.getBoundingClientRect();
    anchorMin = snap(pxToMinutes(e.clientY - rect.top));
    if (e.pointerType === 'mouse') {
      armed = true;
      beginCreateDrag(colEl, root, anchorMin);
    } else {
      holdTimer = setTimeout(() => {
        armed = true;
        colEl.style.touchAction = 'none';
        beginCreateDrag(colEl, root, anchorMin);
      }, LONG_PRESS_MS);
    }
  });
  colEl.addEventListener('pointermove', (e) => {
    if (holdTimer && !armed) {
      if (Math.abs(e.clientX - pressX) > MOVE_CANCEL_PX || Math.abs(e.clientY - pressY) > MOVE_CANCEL_PX) clearHold();
    }
  });
  colEl.addEventListener('pointerup', () => {
    if (holdTimer && !armed) {
      clearHold();
      openCreateFormAt(selectedDate, fromMinutes(anchorMin), fromMinutes(anchorMin + 30), root);
    }
  });
  colEl.addEventListener('pointercancel', clearHold);
}

// ---------- Week view interaction: simpler than Day view's drag mechanics — seven narrow columns
// aren't practical to drag precisely in, so each column supports a tap to create at that time and a
// tap on a block to open it, same as Day view's tap fallback. Tapping a day's header jumps into Day
// view focused on that date, for the richer drag-based editing there. ----------
function wireWeekView(root, days) {
  root.querySelectorAll('.week-day-col-header').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedDate = btn.dataset.date;
      viewMode = 'day';
      setCalendarView('day');
      renderCalendar(root);
    });
  });

  days.forEach((d) => {
    const bodyEl = root.querySelector(`.week-day-col-body[data-date="${d.date}"]`);
    if (!bodyEl) return;
    const rows = dayRows(d.date);
    bodyEl.addEventListener('click', (e) => {
      const blockEl = e.target.closest('.grid-block');
      if (blockEl) {
        const row = rows.find((r) => r.id === blockEl.dataset.rowId && r.type === blockEl.dataset.rowType);
        if (row) {
          // openBlockDetail (and the occurrence-scope edit it can lead to) acts on selectedDate, so
          // make sure that matches the column the user actually clicked, not whatever date Day view
          // last pointed at.
          selectedDate = d.date;
          openBlockDetail(row, root);
        }
        return;
      }
      const rect = bodyEl.getBoundingClientRect();
      const anchorMin = snap(pxToMinutes(e.clientY - rect.top, WEEK_PX_PER_HOUR));
      openCreateFormAt(d.date, fromMinutes(anchorMin), fromMinutes(anchorMin + 30), root);
    });
  });
}

function beginCreateDrag(colEl, root, anchorMin) {
  pointerBusy = true;
  const rect = colEl.getBoundingClientRect();
  const ghost = document.createElement('div');
  ghost.className = 'grid-block ghost-create';
  colEl.appendChild(ghost);
  let endMin = anchorMin + 30;

  const paint = () => {
    const s = Math.min(anchorMin, endMin);
    const e = Math.max(anchorMin, endMin);
    ghost.style.top = minutesToPx(s) + 'px';
    ghost.style.height = Math.max(minutesToPx(e) - minutesToPx(s), MIN_BLOCK_PX) + 'px';
    ghost.textContent = `${fromMinutes(s)}–${fromMinutes(e)}`;
  };
  paint();

  function onMove(ev) {
    endMin = snap(pxToMinutes(ev.clientY - rect.top));
    paint();
  }
  function onUp() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    ghost.remove();
    colEl.style.touchAction = '';
    pointerBusy = false;
    let s = Math.min(anchorMin, endMin);
    let e = Math.max(anchorMin, endMin);
    if (e - s < SNAP_MIN) e = s + 30;
    openCreateFormAt(selectedDate, fromMinutes(s), fromMinutes(e), root);
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp, { once: true });
}

function attachBlockDrag(blockEl, row, colEl, root) {
  blockEl.addEventListener('pointerdown', (e) => {
    if (pointerBusy) return;
    e.stopPropagation();
    pointerBusy = true;
    blockEl.style.touchAction = 'none';
    const startTop = parseFloat(blockEl.style.top);
    const heightPx = parseFloat(blockEl.style.height);
    const pointerStartY = e.clientY;
    let moved = false;

    function onMove(ev) {
      const dy = ev.clientY - pointerStartY;
      if (Math.abs(dy) > 4) moved = true;
      if (!moved) return;
      const newTop = Math.max(0, Math.min(startTop + dy, GRID_HEIGHT - heightPx));
      blockEl.style.top = newTop + 'px';
      blockEl.classList.add('dragging');
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      pointerBusy = false;
      if (!moved) {
        openBlockDetail(row, root);
        return;
      }
      const newStartMin = snap(pxToMinutes(parseFloat(blockEl.style.top)));
      const durationMin = toMinutes(row.end) - toMinutes(row.start);
      const newStart = fromMinutes(newStartMin);
      const newEnd = fromMinutes(newStartMin + durationMin);
      try {
        persistReschedule(row, newStart, newEnd);
      } finally {
        renderCalendar(root); // on a failed save this snaps the block back to its stored time
      }
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  });
}

function persistReschedule(row, newStart, newEnd) {
  if (row.type === 'event') {
    if (row.eventType === 'weekly') {
      updateEventOccurrence(row.seriesId, selectedDate, { start: newStart, end: newEnd });
    } else {
      updateEvent(row.id, { start: newStart, end: newEnd });
    }
  } else {
    updateHabit(row.id, { time: newStart });
  }
}

function openCreateFormAt(dateStr, start, end, root) {
  selectedDate = dateStr;
  weekStart = startOfWeek(dateStr);
  formDraft = { date: dateStr, start, end };
  formType = 'once';
  selectedWeekdays = [];
  formError = '';
  editingEvent = null;
  addMenuOpen = false;
  nlResult = null;
  showForm = true;
  scrollToFormNext = true;
  renderCalendar(root);
}

function openBlockDetail(row, root) {
  if (row.type === 'habit') {
    requestHabitEdit(row.id);
    navigate('/');
    return;
  }
  const ev = getEvents().find((e) => e.id === row.id);
  if (!ev) return;
  showForm = false;
  editingEvent = { event: ev, scope: 'occurrence', days: null };
  renderCalendar(root);
}

// ---------- Create form: one time or weekly routine ----------

function captureFormDraft(form) {
  formDraft = {
    title: form.querySelector('#evTitle')?.value ?? formDraft.title,
    start: form.querySelector('#evStart')?.value ?? formDraft.start,
    end: form.querySelector('#evEnd')?.value ?? formDraft.end,
    date: form.querySelector('#evDate')?.value ?? formDraft.date,
    recurStart: form.querySelector('#evRecurStart')?.value ?? formDraft.recurStart,
    recurEnd: form.querySelector('#evRecurEnd')?.value ?? formDraft.recurEnd,
    rangeOpen: form.querySelector('.recur-range')?.open ?? formDraft.rangeOpen,
  };
}

// Common week shapes, so a school or work week is one tap. The Arabic week runs Sunday–Thursday.
function dayPresets() {
  return getLang() === 'ar'
    ? [['presetSunThu', [0, 1, 2, 3, 4]], ['presetEveryDay', [0, 1, 2, 3, 4, 5, 6]]]
    : [['presetMonFri', [1, 2, 3, 4, 5]], ['presetSunThu', [0, 1, 2, 3, 4]], ['presetEveryDay', [0, 1, 2, 3, 4, 5, 6]]];
}

function weekdayChipsHtml(selected, cls) {
  return `
    <div class="wrap-gap" role="group">
      ${[0, 1, 2, 3, 4, 5, 6].map((day) => `
        <button type="button" class="chip clickable weekday-chip ${cls} ${selected.includes(day) ? 'solid' : ''}" data-day="${day}" aria-pressed="${selected.includes(day)}">${t(weekdayKey(day))}</button>
      `).join('')}
    </div>
  `;
}

function timeRowHtml(prefix, start, end) {
  const dur = start && end && toMinutes(end) > toMinutes(start) ? durationLabel(start, end) : '';
  return `
    <div class="row" style="gap:8px;">
      <div class="col grow"><label class="label-sm" for="${prefix}Start">${t('eventStart')}</label><input class="field" type="time" id="${prefix}Start" value="${escapeAttr(start || '')}" required /></div>
      <div class="col grow"><label class="label-sm" for="${prefix}End">${t('eventEnd')}</label><input class="field" type="time" id="${prefix}End" value="${escapeAttr(end || '')}" required /></div>
    </div>
    <div class="form-note dur-note" aria-live="polite">${dur ? t('durationIs', { dur }) : ''}</div>
  `;
}

function wireDurationNote(scope, prefix) {
  const update = () => {
    const s = scope.querySelector(`#${prefix}Start`).value;
    const e = scope.querySelector(`#${prefix}End`).value;
    const note = scope.querySelector('.dur-note');
    if (note) note.textContent = s && e && toMinutes(e) > toMinutes(s) ? t('durationIs', { dur: durationLabel(s, e) }) : '';
  };
  scope.querySelector(`#${prefix}Start`)?.addEventListener('input', update);
  scope.querySelector(`#${prefix}End`)?.addEventListener('input', update);
}

function eventFormHtml() {
  const d = formDraft;
  const weekly = formType === 'weekly';
  return `
    <form id="eventForm" class="card col event-form" novalidate aria-labelledby="eventFormTitle">
      <div class="row between">
        <h2 class="form-title" id="eventFormTitle">${t(weekly ? 'newRoutineTitle' : 'newEventTitle')}</h2>
        <button type="button" class="chip clickable" id="cancelFormBtn" aria-label="${t('cancel')}">${icon.close}</button>
      </div>
      <div class="seg" role="radiogroup" aria-label="${escapeAttr(t('eventKindLabel'))}">
        <button type="button" role="radio" class="seg-btn ${weekly ? 'on' : ''}" data-type="weekly" aria-checked="${weekly}">${t('recurWeekly')}</button>
        <button type="button" role="radio" class="seg-btn ${!weekly ? 'on' : ''}" data-type="once" aria-checked="${!weekly}">${t('once')}</button>
      </div>
      <div class="col">
        <label class="label-sm" for="evTitle">${t('eventNameLabel')}</label>
        <input class="field" id="evTitle" placeholder="${escapeAttr(t(weekly ? 'routineTitlePlaceholder' : 'eventTitlePlaceholder'))}" value="${escapeAttr(d.title || '')}" maxlength="80" required />
      </div>
      ${weekly ? `
        <div>
          <div class="label-sm" style="margin-bottom:6px;">${t('repeatsOnLabel')}</div>
          ${weekdayChipsHtml(selectedWeekdays, 'form-day')}
          <div class="wrap-gap presets">
            ${dayPresets().map(([k, days]) => `<button type="button" class="chip clickable day-preset" data-days="${days.join(',')}">${t(k)}</button>`).join('')}
          </div>
        </div>
      ` : `
        <div class="col"><label class="label-sm" for="evDate">${t('eventDate')}</label><input class="field" type="date" id="evDate" value="${escapeAttr(d.date || selectedDate)}" /></div>
      `}
      ${timeRowHtml('ev', d.start, d.end)}
      ${weekly ? `
        <details class="recur-range" ${d.rangeOpen ? 'open' : ''}>
          <summary>${t('recurRangeSummary')}</summary>
          <div class="row" style="gap:8px; margin-top:8px;">
            <div class="col grow"><label class="label-sm" for="evRecurStart">${t('recurStartLabel')}</label><input class="field" type="date" id="evRecurStart" value="${escapeAttr(d.recurStart || todayStr())}" /></div>
            <div class="col grow"><label class="label-sm" for="evRecurEnd">${t('recurEndLabel')}</label><input class="field" type="date" id="evRecurEnd" value="${escapeAttr(d.recurEnd || '')}" min="${escapeAttr(d.recurStart || todayStr())}" /></div>
          </div>
          <div class="form-note">${t('recurEndHint')}</div>
        </details>
      ` : ''}
      ${formError ? `<div class="form-error" role="alert">${formError}</div>` : ''}
      <button class="btn primary" type="submit">${t(weekly ? 'saveRoutine' : 'saveEvent')}</button>
    </form>
  `;
}

function validateTimes(title, start, end, needDays) {
  if (!title) return t('nlMissingTitle');
  if (needDays) return t('nlMissingDays');
  if (!start) return t('nlMissingStart');
  if (!end) return t('nlMissingEnd');
  if (toMinutes(end) <= toMinutes(start)) return t('evErrOrder');
  return '';
}

function wireCreateForm(root) {
  const form = root.querySelector('#eventForm');
  if (!form) return;
  const rerenderKeeping = () => { captureFormDraft(form); renderCalendar(root); };
  form.querySelectorAll('[data-type]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (formType === btn.dataset.type) return;
      formType = btn.dataset.type;
      formError = '';
      rerenderKeeping();
      root.querySelector(`#eventForm [data-type="${formType}"]`)?.focus();
    });
  });
  form.querySelectorAll('.form-day').forEach((chip) => {
    chip.addEventListener('click', () => {
      const day = Number(chip.dataset.day);
      selectedWeekdays = selectedWeekdays.includes(day) ? selectedWeekdays.filter((x) => x !== day) : [...selectedWeekdays, day].sort();
      rerenderKeeping();
      root.querySelector(`#eventForm .form-day[data-day="${day}"]`)?.focus();
    });
  });
  form.querySelectorAll('.day-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedWeekdays = btn.dataset.days.split(',').map(Number);
      rerenderKeeping();
    });
  });
  form.querySelector('#cancelFormBtn').addEventListener('click', () => {
    showForm = false;
    formDraft = {};
    selectedWeekdays = [];
    formError = '';
    renderCalendar(root);
  });
  wireDurationNote(form, 'ev');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    captureFormDraft(form);
    const title = (formDraft.title || '').trim();
    const { start, end } = formDraft;
    const weekly = formType === 'weekly';
    formError = validateTimes(title, start, end, weekly && !selectedWeekdays.length);
    if (!formError && weekly && formDraft.recurEnd && formDraft.recurEnd < (formDraft.recurStart || todayStr())) formError = t('evErrRange');
    if (formError) {
      renderCalendar(root);
      root.querySelector('#eventForm .form-error')?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (!weekly) {
      const date = formDraft.date || selectedDate;
      addEvent({ title, type: 'once', date, start, end, source: 'manual' });
      selectedDate = date;
      weekStart = startOfWeek(date);
      showForm = false;
      formDraft = {};
      renderCalendar(root);
      return;
    }
    const startDate = formDraft.recurStart || todayStr();
    const endDate = formDraft.recurEnd || undefined;
    const seriesId = uid();
    addEvents(selectedWeekdays.map((dow) => ({ title, type: 'weekly', dayOfWeek: dow, startDate, endDate, start, end, source: 'manual', seriesId })));
    afterRoutineSaved(root, seriesId);
  });
}

// ---------- Edit sheet: one-time event, one occurrence of a routine, or the whole routine ----------

function seriesRows(seriesId) {
  return getEvents().filter((e) => e.seriesId === seriesId && e.type === 'weekly');
}

function eventEditModalHtml({ event: ev, scope, days, fromList }) {
  const isWeekly = ev.type === 'weekly';
  const series = isWeekly && scope === 'series';
  const seriesDays = days || seriesRows(ev.seriesId).map((r) => r.dayOfWeek).sort();
  return `
    <div class="modal-overlay" id="eventModalOverlay">
      <div class="modal-sheet" role="dialog" aria-modal="true" aria-labelledby="eventModalTitle">
        <div class="row between" style="margin-bottom:12px;">
          <h2 class="form-title" id="eventModalTitle">${t(series ? 'editRoutineTitle' : 'editEventTitle')}</h2>
          <button class="chip clickable" id="closeModalBtn" aria-label="${t('cancel')}" title="${t('cancel')}">${icon.close}</button>
        </div>
        ${ev.source === 'ics' ? `<div class="label-sm" style="margin-bottom:8px;">${t('icsLocalCopyNote')}</div>` : ''}
        <form id="eventEditForm" class="col" novalidate>
          ${isWeekly && !fromList ? `
            <div>
              <div class="label-sm" style="margin-bottom:6px;">${t('applyToLabel')}</div>
              <div class="schedule-toggle">
                <label class="${scope === 'occurrence' ? 'checked' : ''}"><input type="radio" name="editScope" value="occurrence" ${scope === 'occurrence' ? 'checked' : ''}/>${t('thisOccurrenceOnly')}</label>
                <label class="${scope === 'series' ? 'checked' : ''}"><input type="radio" name="editScope" value="series" ${scope === 'series' ? 'checked' : ''}/>${t('entireSeries')}</label>
              </div>
            </div>
          ` : ''}
          <div class="col">
            <label class="label-sm" for="modalTitle">${t('eventNameLabel')}</label>
            <input class="field" id="modalTitle" value="${escapeAttr(ev.title)}" maxlength="80" required />
          </div>
          ${ev.type === 'once' ? `<div class="col"><label class="label-sm" for="modalDate">${t('eventDate')}</label><input class="field" type="date" id="modalDate" value="${escapeAttr(ev.date)}" /></div>` : ''}
          ${series ? `
            <div>
              <div class="label-sm" style="margin-bottom:6px;">${t('repeatsOnLabel')}</div>
              ${weekdayChipsHtml(seriesDays, 'modal-day')}
            </div>
          ` : ''}
          ${timeRowHtml('modal', ev.start, ev.end)}
          ${series ? `
            <details class="recur-range">
              <summary>${t('recurRangeSummary')}</summary>
              <div class="row" style="gap:8px; margin-top:8px;">
                <div class="col grow"><label class="label-sm" for="modalRecurStart">${t('recurStartLabel')}</label><input class="field" type="date" id="modalRecurStart" value="${escapeAttr(ev.startDate || '')}" /></div>
                <div class="col grow"><label class="label-sm" for="modalRecurEnd">${t('recurEndLabel')}</label><input class="field" type="date" id="modalRecurEnd" value="${escapeAttr(ev.endDate || '')}" /></div>
              </div>
              <div class="form-note">${t('recurEndHint')}</div>
            </details>
          ` : ''}
          ${formError ? `<div class="form-error" role="alert">${formError}</div>` : ''}
          <div class="row" style="gap:8px; margin-top:4px;">
            <button type="button" class="btn secondary grow" id="deleteEventBtn">${t(series ? 'deleteRoutineBtn' : 'delete')}</button>
            <button type="submit" class="btn primary grow">${t('save')}</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function captureModal(form) {
  const ev = editingEvent.event;
  editingEvent.event = {
    ...ev,
    title: form.querySelector('#modalTitle').value,
    start: form.querySelector('#modalStart').value,
    end: form.querySelector('#modalEnd').value,
    ...(form.querySelector('#modalDate') ? { date: form.querySelector('#modalDate').value } : {}),
    ...(form.querySelector('#modalRecurStart') ? { startDate: form.querySelector('#modalRecurStart').value || ev.startDate, endDate: form.querySelector('#modalRecurEnd').value || undefined } : {}),
  };
}

function wireEventModal(root) {
  const overlay = root.querySelector('#eventModalOverlay');
  const close = () => { editingEvent = null; formError = ''; renderCalendar(root); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  root.querySelector('#closeModalBtn').addEventListener('click', close);
  const form = root.querySelector('#eventEditForm');
  requestAnimationFrame(() => form.querySelector('#modalTitle')?.focus({ preventScroll: true }));
  wireDurationNote(form, 'modal');

  root.querySelectorAll('input[name="editScope"]').forEach((r) => {
    r.addEventListener('change', () => { captureModal(form); editingEvent.scope = r.value; formError = ''; renderCalendar(root); });
  });
  form.querySelectorAll('.modal-day').forEach((chip) => {
    chip.addEventListener('click', () => {
      captureModal(form);
      const day = Number(chip.dataset.day);
      const cur = editingEvent.days || seriesRows(editingEvent.event.seriesId).map((r) => r.dayOfWeek);
      editingEvent.days = (cur.includes(day) ? cur.filter((x) => x !== day) : [...cur, day]).sort();
      renderCalendar(root);
      root.querySelector(`.modal-day[data-day="${day}"]`)?.focus();
    });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    captureModal(form);
    const { event: ev, scope } = editingEvent;
    const title = ev.title.trim();
    const series = ev.type === 'weekly' && scope === 'series';
    const days = series ? (editingEvent.days || seriesRows(ev.seriesId).map((r) => r.dayOfWeek)) : null;
    formError = validateTimes(title, ev.start, ev.end, series && !days.length);
    if (!formError && series && ev.endDate && ev.startDate && ev.endDate < ev.startDate) formError = t('evErrRange');
    if (formError) { renderCalendar(root); return; }
    const snapshot = snapshotEventSeries(ev.seriesId);
    if (ev.type === 'once') {
      updateEvent(ev.id, { title, date: ev.date || selectedDate, start: ev.start, end: ev.end });
    } else if (series) {
      updateEventSeries(ev.seriesId, { title, start: ev.start, end: ev.end, startDate: ev.startDate, endDate: ev.endDate });
      setRoutineDays(ev.seriesId, days);
    } else {
      updateEventOccurrence(ev.seriesId, selectedDate, { title, start: ev.start, end: ev.end });
    }
    editingEvent = null;
    renderCalendar(root);
    showUndoToast(t('changesSavedToast'), t('undoBtn'), () => { restoreEventSeries(snapshot); renderCalendar(root); });
  });

  root.querySelector('#deleteEventBtn').addEventListener('click', () => {
    const { event: ev, scope } = editingEvent;
    const snapshot = snapshotEventSeries(ev.seriesId);
    if (ev.type === 'once') removeEvent(ev.id);
    else if (scope === 'series') removeEventSeries(ev.seriesId);
    else removeEventOccurrence(ev.seriesId, selectedDate);
    editingEvent = null;
    renderCalendar(root);
    offerEventUndo(root, snapshot);
  });
}

// ---------- Your routines (grouped) and one-time events ----------

function offerEventUndo(root, snapshot) {
  showUndoToast(t('eventRemovedToast'), t('undoBtn'), () => {
    restoreEventSeries(snapshot);
    renderCalendar(root);
  });
}

function routineGroups() {
  const groups = new Map();
  getEvents().filter((e) => e.type === 'weekly').forEach((e) => {
    const key = e.seriesId || e.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  });
  return [...groups.entries()].map(([seriesId, rows]) => ({ seriesId, rows, first: rows[0] }));
}

function oneTimeEvents() {
  const weeklySeries = new Set(getEvents().filter((e) => e.type === 'weekly').map((e) => e.seriesId));
  // Moved or renamed single occurrences of a routine are part of that routine, not separate events.
  return getEvents().filter((e) => e.type === 'once' && !(e.seriesId && e.seriesId !== e.id && weeklySeries.has(e.seriesId)))
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

function rangeText(ev) {
  if (!ev.startDate && !ev.endDate) return '';
  if (ev.endDate) return ` · ${t('recurUntilLabel')} <span dir="ltr">${escapeHtml(ev.endDate)}</span>`;
  return ev.startDate > todayStr() ? ` · ${t('recurFromLabel')} <span dir="ltr">${escapeHtml(ev.startDate)}</span>` : '';
}

function routineRowHtml(g) {
  const days = [...new Set(g.rows.map((r) => r.dayOfWeek))].sort();
  const ended = g.first.endDate && g.first.endDate < todayStr();
  return `
    <div class="manage-row${ended ? ' ended' : ''}">
      <span class="mr-icon" aria-hidden="true">${icon.repeat}</span>
      <div class="grow mr-text">
        <div class="mr-title">${escapeHtml(g.first.title)}${g.first.source === 'ics' ? ' <span class="mr-tag">.ics</span>' : ''}</div>
        <div class="mr-sub">${escapeHtml(daysListText(days))} · <span dir="ltr">${g.first.start}–${g.first.end}</span>${rangeText(g.first)}${ended ? ` · ${t('routineEnded')}` : ''}</div>
      </div>
      <button class="icon-btn routine-edit" data-series="${escapeAttr(g.seriesId)}" aria-label="${escapeAttr(t('editNamed', { name: g.first.title }))}">${icon.pencil}</button>
      <button class="icon-btn routine-remove" data-series="${escapeAttr(g.seriesId)}" aria-label="${escapeAttr(t('deleteNamed', { name: g.first.title }))}">${icon.trash}</button>
    </div>
  `;
}

function oneTimeRowHtml(ev) {
  const dateText = dateForDisplay(ev.date).toLocaleDateString(getLang() === 'ar' ? 'ar' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return `
    <div class="manage-row">
      <span class="mr-icon" aria-hidden="true">${icon.calendar}</span>
      <div class="grow mr-text">
        <div class="mr-title">${escapeHtml(ev.title)}${ev.source === 'ics' ? ' <span class="mr-tag">.ics</span>' : ''}</div>
        <div class="mr-sub">${escapeHtml(dateText)} · <span dir="ltr">${ev.start}–${ev.end}</span></div>
      </div>
      <button class="icon-btn event-edit" data-id="${escapeAttr(ev.id)}" aria-label="${escapeAttr(t('editNamed', { name: ev.title }))}">${icon.pencil}</button>
      <button class="icon-btn event-remove" data-id="${escapeAttr(ev.id)}" aria-label="${escapeAttr(t('deleteNamed', { name: ev.title }))}">${icon.trash}</button>
    </div>
  `;
}

function routineListHtml() {
  const groups = routineGroups();
  const once = oneTimeEvents();
  if (!groups.length && !once.length) return '';
  const today = todayStr();
  const upcoming = once.filter((e) => e.date >= today);
  const past = once.filter((e) => e.date < today).reverse();
  return `
    <section class="manage" aria-labelledby="routinesHeading">
      ${groups.length ? `
        <h2 class="section-title" id="routinesHeading">${t('yourRoutinesTitle')}</h2>
        <div class="manage-list">${groups.map(routineRowHtml).join('')}</div>
      ` : `<h2 class="section-title" id="routinesHeading">${t('oneTimeEventsTitle')}</h2>`}
      ${once.length ? `
        ${groups.length ? `<h2 class="section-title">${t('oneTimeEventsTitle')}</h2>` : ''}
        ${upcoming.length ? `<div class="manage-list">${upcoming.map(oneTimeRowHtml).join('')}</div>` : `<p class="form-note">${t('noUpcomingEvents')}</p>`}
        ${past.length ? `
          <details class="past-events">
            <summary>${t('pastEventsSummary', { n: past.length })}</summary>
            <div class="manage-list">${past.map(oneTimeRowHtml).join('')}</div>
          </details>
        ` : ''}
      ` : ''}
    </section>
  `;
}

function wireManageList(root) {
  root.querySelectorAll('.routine-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ev = getEvents().find((e) => (e.seriesId || e.id) === btn.dataset.series && e.type === 'weekly');
      if (!ev) return;
      showForm = false;
      formError = '';
      editingEvent = { event: ev, scope: 'series', days: null, fromList: true };
      renderCalendar(root);
    });
  });
  root.querySelectorAll('.routine-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      const snapshot = snapshotEventSeries(btn.dataset.series);
      removeEventSeries(btn.dataset.series);
      renderCalendar(root);
      offerEventUndo(root, snapshot);
    });
  });
  root.querySelectorAll('.event-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ev = getEvents().find((e) => e.id === btn.dataset.id);
      if (!ev) return;
      const snapshot = snapshotEventSeries(ev.seriesId);
      removeEvent(ev.id);
      renderCalendar(root);
      offerEventUndo(root, snapshot);
    });
  });
  root.querySelectorAll('.event-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ev = getEvents().find((e) => e.id === btn.dataset.id);
      if (!ev) return;
      showForm = false;
      formError = '';
      editingEvent = { event: ev, scope: 'occurrence', days: null, fromList: true };
      renderCalendar(root);
    });
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
