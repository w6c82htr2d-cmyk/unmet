import { t, getLang } from '../i18n.js';
import { icon } from '../icons.js';
import {
  getEvents, addEvent, removeEvent, removeEventSeries, updateEvent, updateEventSeries, updateEventOccurrence,
  removeEventOccurrence, eventsForDate, habitsForDate, todayStr, dayOfWeek, addDays, uid,
  habitLinkedEventTitles, updateHabit,
} from '../db.js';
import { parseIcs } from '../lib/ics.js';
import { weekdayKey } from '../lib/patterns.js';
import { navigate } from '../router.js';
import { requestHabitEdit } from '../lib/pendingEdit.js';

const HOUR_START = 6;
const HOUR_END = 23;
const PX_PER_HOUR = 52;
const GRID_HEIGHT = (HOUR_END - HOUR_START) * PX_PER_HOUR;
const SNAP_MIN = 15;
const MIN_BLOCK_PX = 26;
const LONG_PRESS_MS = 350;
const MOVE_CANCEL_PX = 8;

let weekStart = startOfWeek(todayStr());
let selectedDate = todayStr();
let showForm = false;
let formType = 'once';
let selectedWeekdays = [];
let importStatus = '';
let dragActiveIcs = false;
let formDraft = {};
let editingEvent = null; // { event, scope: 'occurrence' | 'series' }
let pointerBusy = false; // true while a create/reschedule drag session is active anywhere on the grid

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

function minutesToPx(min) {
  return (clampMinutes(min) - HOUR_START * 60) / 60 * PX_PER_HOUR;
}

function pxToMinutes(px) {
  return HOUR_START * 60 + (px / PX_PER_HOUR) * 60;
}

function startOfWeek(dateStr) {
  return addDays(dateStr, -dayOfWeek(dateStr));
}

async function handleIcsFile(file, root) {
  try {
    const text = await file.text();
    const parsed = parseIcs(text);
    parsed.forEach((ev) => addEvent(ev));
    importStatus = t('icsImported', { n: parsed.length });
  } catch {
    importStatus = t('icsImportError');
  }
  renderCalendar(root);
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
      done: !!h.history[date], stacked: h.scheduleType === 'stacked',
      linkedTitles: h.scheduleType === 'stacked' ? habitLinkedEventTitles(h) : [],
    }));
  return layoutOverlaps([...eventRows, ...habitRows]);
}

function gridBlocksHtml(rows) {
  return rows.map((r) => {
    const top = minutesToPx(toMinutes(r.start));
    const height = Math.max(minutesToPx(toMinutes(r.end)) - top, MIN_BLOCK_PX);
    const widthPct = 100 / r.cols;
    const leftPct = r.col * widthPct;
    const showTime = height >= 32;
    const typeClass = r.type === 'event' ? 'event' : (r.stacked ? 'habit stacked' : 'habit');
    const doneClass = r.type === 'habit' && r.done ? ' done' : '';
    const draggable = r.type === 'event' || (r.type === 'habit' && !r.stacked);
    const subtitle = r.type === 'habit' && r.stacked && r.linkedTitles.length
      ? `${t('stackedAfter')}: ${r.linkedTitles.join(', ')}`
      : `${r.start}–${r.end}`;
    return `
      <div class="grid-block ${typeClass}${doneClass}" data-row-id="${r.id}" data-row-type="${r.type}" ${draggable ? 'data-draggable="1"' : ''}
        title="${escapeAttr(r.title)} (${subtitle})"
        style="top:${top}px; height:${height}px; left:calc(${leftPct}% + 2px); width:calc(${widthPct}% - 4px);">
        <div class="gb-title">${r.type === 'habit' && r.done ? '<span class="gb-check">✓</span>' : ''}${escapeHtml(r.title)}</div>
        ${showTime ? `<div class="gb-time" dir="ltr">${r.start}–${r.end}</div>` : ''}
        ${r.type === 'habit' && r.stacked ? `<span class="gb-link" title="${t('stackedAfter')}: ${escapeAttr(r.linkedTitles.join(', '))}">${icon.sync}</span>` : ''}
      </div>
    `;
  }).join('');
}

export function renderCalendar(root) {
  const rows = dayRows(selectedDate);
  const allEvents = getEvents();
  const dayLetters = getLang() === 'ar'
    ? ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س']
    : ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const date = addDays(weekStart, i);
    return { date, isToday: date === todayStr() };
  });

  root.innerHTML = `
    <div class="page">
      <div>
        <h2 class="screen-title">${t('calendarTitle')}</h2>
        <div class="screen-subtitle">${t('calendarSubtitle')}</div>
      </div>

      <div class="row between">
        <button class="btn secondary sm" id="prevWeek">${icon.back}</button>
        <button class="chip clickable" id="todayBtn">${t('todayBtn')}</button>
        <button class="btn secondary sm" id="nextWeek" style="transform:scaleX(-1);">${icon.back}</button>
      </div>

      <div class="week-strip">
        ${days.map((d, i) => `
          <button class="day-pill ${d.isToday ? 'today' : ''} ${d.date === selectedDate ? 'selected' : ''}" data-date="${d.date}">
            <div class="d">${dayLetters[i]}</div>
            <div class="n">${Number(d.date.slice(8, 10))}${d.isToday ? '<span class="dot"></span>' : ''}</div>
          </button>
        `).join('')}
      </div>

      <div class="row" style="gap:14px;">
        <div class="row" style="gap:5px;"><span class="legend-dot event"></span><span class="label-sm">${t('legendCalendar')}</span></div>
        <div class="row" style="gap:5px;"><span class="legend-dot habit"></span><span class="label-sm">${t('legendHabit')}</span></div>
      </div>

      <div class="section-head">
        <span class="title">${new Date(selectedDate + 'T00:00:00').toLocaleDateString(getLang() === 'ar' ? 'ar' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</span>
      </div>

      <div class="day-grid-wrap">
        <div class="hour-gutter">
          ${Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i).map((h) => `<div class="hour-label" dir="ltr" style="top:${(h - HOUR_START) * PX_PER_HOUR}px;">${h}</div>`).join('')}
        </div>
        <div class="day-col-wide" id="dayCol" style="height:${GRID_HEIGHT}px;">
          ${gridBlocksHtml(rows)}
        </div>
      </div>
      ${rows.length === 0 ? `<div class="label-sm center-text" style="margin-top:-6px;">${t('tapToCreateHint')}</div>` : ''}

      <button class="btn secondary" id="addEventBtn">${icon.plus} ${t('manualAdd')}</button>

      <div class="card dashed center-text" id="dropZone" style="${dragActiveIcs ? 'outline:2px solid var(--accent);' : ''} cursor:pointer;">
        <div class="icon-circle" style="margin:0 auto 8px;">${icon.upload}</div>
        <div style="font-weight:700; font-size:12.5px; margin-bottom:2px;">${t('importIcs')}</div>
        <div class="label-sm">${t('importDropHint')}</div>
        <div class="label-sm" style="margin-top:6px;">${t('importSourceHint')}</div>
        <input type="file" id="icsFile" accept=".ics" style="display:none" />
      </div>
      ${importStatus ? `<div class="label-sm">${importStatus}</div>` : ''}

      ${showForm ? eventFormHtml() : ''}

      ${allEvents.length ? `
        <div>
          <div class="section-head" style="margin-bottom:8px;"><span class="title">${t('allEvents')}</span></div>
          <div class="col">
            ${allEvents.map(eventManageRow).join('')}
          </div>
        </div>
      ` : ''}
    </div>

    ${editingEvent ? eventEditModalHtml(editingEvent) : ''}
  `;

  root.querySelector('#prevWeek').addEventListener('click', () => {
    weekStart = addDays(weekStart, -7);
    selectedDate = addDays(selectedDate, -7);
    renderCalendar(root);
  });
  root.querySelector('#nextWeek').addEventListener('click', () => {
    weekStart = addDays(weekStart, 7);
    selectedDate = addDays(selectedDate, 7);
    renderCalendar(root);
  });
  root.querySelector('#todayBtn').addEventListener('click', () => {
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

  root.querySelector('#addEventBtn').addEventListener('click', () => {
    showForm = !showForm;
    editingEvent = null;
    if (showForm) { selectedWeekdays = []; formDraft = {}; }
    renderCalendar(root);
  });

  wireDayColumn(root);

  const dropZone = root.querySelector('#dropZone');
  const fileInput = root.querySelector('#icsFile');
  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async (e) => {
    if (e.target.files[0]) await handleIcsFile(e.target.files[0], root);
  });
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!dragActiveIcs) { dragActiveIcs = true; renderCalendar(root); }
  });
  dropZone.addEventListener('dragleave', () => {
    dragActiveIcs = false;
    renderCalendar(root);
  });
  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragActiveIcs = false;
    const file = e.dataTransfer.files[0];
    if (file) await handleIcsFile(file, root);
    else renderCalendar(root);
  });

  wireCreateForm(root);
  wireManageList(root);
  if (editingEvent) wireEventModal(root);
}

// ---------- Day-column interaction: tap/click to create, drag to create a range, drag an
// existing block to reschedule it. Touch uses a short hold before arming a drag-create so an
// ordinary scroll swipe through the day isn't hijacked; a plain tap still creates instantly. ----------
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
      persistReschedule(row, newStart, newEnd);
      renderCalendar(root);
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
  formDraft = { date: dateStr, start, end };
  formType = 'once';
  selectedWeekdays = [];
  editingEvent = null;
  showForm = true;
  renderCalendar(root);
  requestAnimationFrame(() => {
    const form = root.querySelector('#eventForm');
    if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
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
  editingEvent = { event: ev, scope: 'occurrence' };
  renderCalendar(root);
}

// ---------- Create-event form (unchanged once/weekly flow, now also prefillable from a tap/drag) ----------

function captureFormDraft(form) {
  formDraft = {
    title: form.querySelector('#evTitle')?.value ?? formDraft.title,
    start: form.querySelector('#evStart')?.value ?? formDraft.start,
    end: form.querySelector('#evEnd')?.value ?? formDraft.end,
    date: form.querySelector('#evDate')?.value ?? formDraft.date,
    recurStart: form.querySelector('#evRecurStart')?.value ?? formDraft.recurStart,
    recurEnd: form.querySelector('#evRecurEnd')?.value ?? formDraft.recurEnd,
  };
}

function eventFormHtml() {
  const d = formDraft;
  return `
    <form id="eventForm" class="card col">
      <input class="field" id="evTitle" placeholder="${t('eventTitlePlaceholder')}" value="${escapeAttr(d.title || '')}" required />
      <div class="row" style="gap:14px;">
        <label class="row" style="gap:5px; font-size:11.5px;"><input type="radio" name="evType" value="once" ${formType === 'once' ? 'checked' : ''}/> ${t('once')}</label>
        <label class="row" style="gap:5px; font-size:11.5px;"><input type="radio" name="evType" value="weekly" ${formType === 'weekly' ? 'checked' : ''}/> ${t('recurWeekly')}</label>
      </div>
      ${formType === 'once' ? `
        <input class="field" type="date" id="evDate" value="${d.date || selectedDate}" />
      ` : `
        <div>
          <label class="label-sm" style="display:block; margin-bottom:6px;">${t('repeatsOnLabel')}</label>
          <div class="wrap-gap">
            ${[0, 1, 2, 3, 4, 5, 6].map((day) => `
              <button type="button" class="chip clickable weekday-chip ${selectedWeekdays.includes(day) ? 'solid' : ''}" data-day="${day}">${t(weekdayKey(day))}</button>
            `).join('')}
          </div>
        </div>
        <div class="row" style="gap:8px;">
          <div class="col grow"><label class="label-sm">${t('recurStartLabel')}</label><input class="field" type="date" id="evRecurStart" value="${d.recurStart || selectedDate}" /></div>
          <div class="col grow"><label class="label-sm">${t('recurEndLabel')}</label><input class="field" type="date" id="evRecurEnd" value="${d.recurEnd || ''}" min="${d.recurStart || selectedDate}" /></div>
        </div>
        <div style="font-size:10px; color:var(--text-muted);">${t('recurEndHint')}</div>
      `}
      <div class="row" style="gap:8px;">
        <div class="col grow"><label class="label-sm">${t('eventStart')}</label><input class="field" type="time" id="evStart" value="${d.start || ''}" required /></div>
        <div class="col grow"><label class="label-sm">${t('eventEnd')}</label><input class="field" type="time" id="evEnd" value="${d.end || ''}" required /></div>
      </div>
      <button class="btn primary" type="submit">${t('saveEvent')}</button>
    </form>
  `;
}

function wireCreateForm(root) {
  const form = root.querySelector('#eventForm');
  if (!form) return;
  root.querySelectorAll('input[name="evType"]').forEach((r) => {
    r.addEventListener('change', () => {
      captureFormDraft(form);
      formType = r.value;
      renderCalendar(root);
    });
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = form.querySelector('#evTitle').value.trim();
    const start = form.querySelector('#evStart').value;
    const end = form.querySelector('#evEnd').value;
    if (!title || !start || !end) return;
    if (formType === 'once') {
      const date = form.querySelector('#evDate').value || selectedDate;
      addEvent({ title, type: 'once', date, start, end, source: 'manual' });
    } else {
      if (!selectedWeekdays.length) return;
      const startDate = form.querySelector('#evRecurStart').value || selectedDate;
      const endDate = form.querySelector('#evRecurEnd').value || undefined;
      const seriesId = uid();
      selectedWeekdays.forEach((dow) => {
        addEvent({ title, type: 'weekly', dayOfWeek: dow, startDate, endDate, start, end, source: 'manual', seriesId });
      });
    }
    selectedWeekdays = [];
    formDraft = {};
    showForm = false;
    renderCalendar(root);
  });
  root.querySelectorAll('.weekday-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      captureFormDraft(form);
      const day = Number(chip.dataset.day);
      selectedWeekdays = selectedWeekdays.includes(day) ? selectedWeekdays.filter((d) => d !== day) : [...selectedWeekdays, day];
      renderCalendar(root);
    });
  });
}

// ---------- Event edit modal: title/start/end, this-occurrence-vs-series for recurring events ----------

function eventEditModalHtml({ event: ev, scope }) {
  const isWeekly = ev.type === 'weekly';
  return `
    <div class="modal-overlay" id="eventModalOverlay">
      <div class="modal-sheet">
        <div class="row between" style="margin-bottom:12px;">
          <span style="font-weight:700; font-size:14px;">${t('editEventTitle')}</span>
          <button class="chip clickable" id="closeModalBtn">${icon.close}</button>
        </div>
        ${ev.source === 'ics' ? `<div class="label-sm" style="margin-bottom:8px;">${t('icsLocalCopyNote')}</div>` : ''}
        <form id="eventEditForm" class="col">
          <input class="field" id="modalTitle" value="${escapeAttr(ev.title)}" required />
          ${ev.type === 'once' ? `<div class="col"><label class="label-sm">${t('eventDate')}</label><input class="field" type="date" id="modalDate" value="${ev.date}" /></div>` : ''}
          <div class="row" style="gap:8px;">
            <div class="col grow"><label class="label-sm">${t('eventStart')}</label><input class="field" type="time" id="modalStart" value="${ev.start}" required /></div>
            <div class="col grow"><label class="label-sm">${t('eventEnd')}</label><input class="field" type="time" id="modalEnd" value="${ev.end}" required /></div>
          </div>
          ${isWeekly ? `
            <div>
              <label class="label-sm" style="display:block; margin-bottom:6px;">${t('applyToLabel')}</label>
              <div class="schedule-toggle">
                <label class="${scope === 'occurrence' ? 'checked' : ''}"><input type="radio" name="editScope" value="occurrence" ${scope === 'occurrence' ? 'checked' : ''}/>${t('thisOccurrenceOnly')}</label>
                <label class="${scope === 'series' ? 'checked' : ''}"><input type="radio" name="editScope" value="series" ${scope === 'series' ? 'checked' : ''}/>${t('entireSeries')}</label>
              </div>
            </div>
          ` : ''}
          <div class="row" style="gap:8px; margin-top:4px;">
            <button type="button" class="btn secondary grow" id="deleteEventBtn">${t('delete')}</button>
            <button type="submit" class="btn primary grow">${t('save')}</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function wireEventModal(root) {
  const overlay = root.querySelector('#eventModalOverlay');
  const close = () => { editingEvent = null; renderCalendar(root); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  root.querySelector('#closeModalBtn').addEventListener('click', close);

  root.querySelectorAll('input[name="editScope"]').forEach((r) => {
    r.addEventListener('change', () => { editingEvent.scope = r.value; renderCalendar(root); });
  });

  const form = root.querySelector('#eventEditForm');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const { event: ev, scope } = editingEvent;
    const title = form.querySelector('#modalTitle').value.trim();
    const start = form.querySelector('#modalStart').value;
    const end = form.querySelector('#modalEnd').value;
    if (!title || !start || !end) return;
    if (ev.type === 'once') {
      const date = form.querySelector('#modalDate').value || ev.date;
      updateEvent(ev.id, { title, date, start, end });
    } else if (scope === 'series') {
      updateEventSeries(ev.seriesId, { title, start, end });
    } else {
      updateEventOccurrence(ev.seriesId, selectedDate, { title, start, end });
    }
    editingEvent = null;
    renderCalendar(root);
  });

  root.querySelector('#deleteEventBtn').addEventListener('click', () => {
    const { event: ev, scope } = editingEvent;
    if (ev.type === 'once') removeEvent(ev.id);
    else if (scope === 'series') removeEventSeries(ev.seriesId);
    else removeEventOccurrence(ev.seriesId, selectedDate);
    editingEvent = null;
    renderCalendar(root);
  });
}

// ---------- Full event management list (all events, any date) ----------

function wireManageList(root) {
  root.querySelectorAll('.event-remove').forEach((btn) => {
    btn.addEventListener('click', () => { removeEvent(btn.dataset.id); renderCalendar(root); });
  });
  root.querySelectorAll('.event-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ev = getEvents().find((e) => e.id === btn.dataset.id);
      if (!ev) return;
      showForm = false;
      editingEvent = { event: ev, scope: 'occurrence' };
      renderCalendar(root);
    });
  });
}

function recurRangeHtml(ev) {
  if (ev.type !== 'weekly' || !ev.startDate) return '';
  const from = ` · ${t('recurFromLabel')} <span dir="ltr">${ev.startDate}</span>`;
  const until = ev.endDate ? ` ${t('recurUntilLabel')} <span dir="ltr">${ev.endDate}</span>` : '';
  return `${from}${until}`;
}

function eventManageRow(ev) {
  const suffix = ev.source === 'ics' ? ' · .ics' : '';
  const timeRange = `${ev.start}–${ev.end}`;
  const subtitle = ev.type === 'once'
    ? `<span dir="ltr">${ev.date} · ${timeRange}${suffix}</span>`
    : `${escapeHtml(t(weekdayKey(ev.dayOfWeek)))} · <span dir="ltr">${timeRange}</span>${suffix}${recurRangeHtml(ev)}`;
  return `
    <div class="card row" style="padding:10px 12px;">
      <div class="grow">
        <div style="font-size:12px; font-weight:700;">${escapeHtml(ev.title)}</div>
        <div style="font-size:10px; color:var(--text-muted);">${subtitle}</div>
      </div>
      <button class="chip clickable event-edit" data-id="${ev.id}" title="${t('edit')}">${icon.pencil}</button>
      <button class="chip clickable event-remove" data-id="${ev.id}" title="${t('delete')}">${icon.trash}</button>
    </div>
  `;
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function escapeAttr(s) {
  return String(s || '').replace(/"/g, '&quot;');
}
