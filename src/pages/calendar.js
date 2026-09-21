import { t, getLang } from '../i18n.js';
import { icon } from '../icons.js';
import { getEvents, addEvent, removeEvent, eventsForDate, getHabits, todayStr } from '../db.js';
import { parseIcs } from '../lib/ics.js';
import { weekdayKey } from '../lib/patterns.js';
import { navigate } from '../router.js';

let selectedDate = todayStr();
let showForm = false;
let formType = 'once';
let selectedWeekdays = [];
let importStatus = '';
let dragActive = false;

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
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

function buildTimelineRows(events, habitsWithTime, date) {
  const eventRows = events.map((ev) => ({ type: 'event', title: ev.title, start: ev.start, end: ev.end }));
  const habitRows = habitsWithTime.map((h) => ({
    type: 'habit', title: h.name, start: h.time, done: !!h.history[date],
  }));
  return [...eventRows, ...habitRows].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
}

export function renderCalendar(root) {
  const events = eventsForDate(selectedDate);
  const habitsWithTime = getHabits().filter((h) => h.time);
  const rows = buildTimelineRows(events, habitsWithTime, selectedDate);
  const allEvents = getEvents();

  root.innerHTML = `
    <div class="page">
      <div>
        <h2 class="screen-title">${t('calendarTitle')}</h2>
        <div class="screen-subtitle">${t('calendarSubtitle')}</div>
      </div>

      <div class="row between">
        <button class="btn secondary sm" id="prevDay">${icon.back}</button>
        <div style="font-weight:700; font-size:13px;">${new Date(selectedDate + 'T00:00:00').toLocaleDateString(getLang() === 'ar' ? 'ar' : 'en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</div>
        <button class="btn secondary sm" id="nextDay" style="transform:scaleX(-1);">${icon.back}</button>
      </div>

      <div class="row" style="gap:14px;">
        <div class="row" style="gap:5px;"><span style="width:8px;height:8px;border-radius:2px;background:var(--card-strong);display:inline-block;"></span><span class="label-sm">${t('legendCalendar')}</span></div>
        <div class="row" style="gap:5px;"><span style="width:8px;height:8px;border-radius:2px;background:var(--accent-soft);border:1px dashed var(--accent);display:inline-block;"></span><span class="label-sm">${t('legendHabit')}</span></div>
      </div>

      ${rows.length === 0 ? `
        <div class="empty-state card">
          <div class="icon-circle">${icon.calendar}</div>
          <div class="title">${t('noEventsTodayTitle')}</div>
          <div class="body">${t('noEventsTodayBody')}</div>
        </div>
      ` : `
        <div class="timeline">
          ${rows.map((r) => r.type === 'event' ? `
            <div class="tl-row">
              <div class="tl-time" dir="ltr">${r.start}</div>
              <div class="tl-block event">
                <div>${escapeHtml(r.title)}</div>
                <div class="sub" dir="ltr">${r.start} – ${r.end}</div>
              </div>
            </div>
          ` : `
            <div class="tl-row">
              <div class="tl-time" dir="ltr">${r.start}</div>
              <div class="tl-block suggest habit-block-link">
                <div class="row" style="gap:5px;">${r.done ? icon.check : ''}<span>${escapeHtml(r.title)}</span></div>
                <div class="sub">${t('legendHabit')}</div>
              </div>
            </div>
          `).join('')}
        </div>
      `}

      <button class="btn secondary" id="addEventBtn">${icon.plus} ${t('manualAdd')}</button>

      <div class="card dashed center-text" id="dropZone" style="${dragActive ? 'outline:2px solid var(--accent);' : ''} cursor:pointer;">
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
  `;

  root.querySelector('#prevDay').addEventListener('click', () => {
    selectedDate = shiftDate(selectedDate, -1);
    renderCalendar(root);
  });
  root.querySelector('#nextDay').addEventListener('click', () => {
    selectedDate = shiftDate(selectedDate, 1);
    renderCalendar(root);
  });
  root.querySelector('#addEventBtn').addEventListener('click', () => {
    showForm = !showForm;
    if (showForm) selectedWeekdays = [];
    renderCalendar(root);
  });

  const dropZone = root.querySelector('#dropZone');
  const fileInput = root.querySelector('#icsFile');
  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async (e) => {
    if (e.target.files[0]) await handleIcsFile(e.target.files[0], root);
  });
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!dragActive) { dragActive = true; renderCalendar(root); }
  });
  dropZone.addEventListener('dragleave', () => {
    dragActive = false;
    renderCalendar(root);
  });
  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragActive = false;
    const file = e.dataTransfer.files[0];
    if (file) await handleIcsFile(file, root);
    else renderCalendar(root);
  });

  const form = root.querySelector('#eventForm');
  if (form) {
    root.querySelectorAll('input[name="evType"]').forEach((r) => {
      r.addEventListener('change', () => { formType = r.value; renderCalendar(root); });
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
        selectedWeekdays.forEach((dayOfWeek) => {
          addEvent({ title, type: 'weekly', dayOfWeek, start, end, source: 'manual' });
        });
      }
      selectedWeekdays = [];
      showForm = false;
      renderCalendar(root);
    });

    root.querySelectorAll('.weekday-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const day = Number(chip.dataset.day);
        selectedWeekdays = selectedWeekdays.includes(day)
          ? selectedWeekdays.filter((d) => d !== day)
          : [...selectedWeekdays, day];
        renderCalendar(root);
      });
    });
  }

  root.querySelectorAll('.event-remove').forEach((btn) => {
    btn.addEventListener('click', () => { removeEvent(btn.dataset.id); renderCalendar(root); });
  });

  root.querySelectorAll('.habit-block-link').forEach((el) => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => navigate('/'));
  });
}

function eventFormHtml() {
  return `
    <form id="eventForm" class="card col">
      <input class="field" id="evTitle" placeholder="${t('eventTitlePlaceholder')}" required />
      <div class="row" style="gap:14px;">
        <label class="row" style="gap:5px; font-size:11.5px;"><input type="radio" name="evType" value="once" ${formType === 'once' ? 'checked' : ''}/> ${t('once')}</label>
        <label class="row" style="gap:5px; font-size:11.5px;"><input type="radio" name="evType" value="weekly" ${formType === 'weekly' ? 'checked' : ''}/> ${t('recurWeekly')}</label>
      </div>
      ${formType === 'once' ? `
        <input class="field" type="date" id="evDate" value="${selectedDate}" />
      ` : `
        <div>
          <label class="label-sm" style="display:block; margin-bottom:6px;">${t('repeatsOnLabel')}</label>
          <div class="wrap-gap">
            ${[0,1,2,3,4,5,6].map((d) => `
              <button type="button" class="chip clickable weekday-chip ${selectedWeekdays.includes(d) ? 'solid' : ''}" data-day="${d}">${t(weekdayKey(d))}</button>
            `).join('')}
          </div>
        </div>
      `}
      <div class="row" style="gap:8px;">
        <div class="col grow"><label class="label-sm">${t('eventStart')}</label><input class="field" type="time" id="evStart" required /></div>
        <div class="col grow"><label class="label-sm">${t('eventEnd')}</label><input class="field" type="time" id="evEnd" required /></div>
      </div>
      <button class="btn primary" type="submit">${t('saveEvent')}</button>
    </form>
  `;
}

function eventManageRow(ev) {
  const suffix = ev.source === 'ics' ? ' · .ics' : '';
  const timeRange = `${ev.start}–${ev.end}`;
  const subtitle = ev.type === 'once'
    ? `<span dir="ltr">${ev.date} · ${timeRange}${suffix}</span>`
    : `${escapeHtml(t(weekdayKey(ev.dayOfWeek)))} · <span dir="ltr">${timeRange}</span>${suffix}`;
  return `
    <div class="card row" style="padding:10px 12px;">
      <div class="grow">
        <div style="font-size:12px; font-weight:700;">${escapeHtml(ev.title)}</div>
        <div style="font-size:10px; color:var(--text-muted);">${subtitle}</div>
      </div>
      <button class="chip clickable event-remove" data-id="${ev.id}">${icon.trash}</button>
    </div>
  `;
}

function shiftDate(dateStr, delta) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
