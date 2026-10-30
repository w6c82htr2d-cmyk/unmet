import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage, freezeTime, restoreTime } from '../helpers.mjs';

installLocalStorage();
const db = await import('../../src/db.js');
const TZ = process.env.TZ || 'system';

// Synthetic data. "Now" is Sun 25 Oct 2026, 01:30 Riyadh time = Sat 24 Oct 22:30 UTC = Sat 24 Oct
// 18:30 New York = Sun 25 Oct 07:30 Tokyo — a moment where the zones disagree on the date.
const NOW = '2026-10-24T22:30:00Z';
const LOCAL_TODAY = { 'Asia/Riyadh': '2026-10-25', 'Asia/Tokyo': '2026-10-25', 'America/New_York': '2026-10-24', UTC: '2026-10-24' };

function seed() {
  localStorage.clear();
  const events = [
    // Classes Sun/Tue/Thu 08:00–10:50 as one series (one row per weekday)
    { id: 'c0', seriesId: 'cls', title: 'Classes', type: 'weekly', dayOfWeek: 0, startDate: '2026-09-01', start: '08:00', end: '10:50', source: 'manual' },
    { id: 'c2', seriesId: 'cls', title: 'Classes', type: 'weekly', dayOfWeek: 2, startDate: '2026-09-01', start: '08:00', end: '10:50', source: 'manual' },
    { id: 'c4', seriesId: 'cls', title: 'Classes', type: 'weekly', dayOfWeek: 4, startDate: '2026-09-01', start: '08:00', end: '10:50', source: 'manual', excludeDates: ['2026-10-22'] },
    { id: 'gym', seriesId: 'gym', title: 'Gym', type: 'weekly', dayOfWeek: 6, startDate: '2026-09-01', endDate: '2026-10-31', start: '09:00', end: '10:00', source: 'manual' },
    { id: 'once', seriesId: 'once', title: 'Dentist', type: 'once', date: '2026-10-27', start: '15:30', end: '16:15', source: 'manual' },
  ];
  const history = (dates) => Object.fromEntries(dates.map((d) => [d, true]));
  const habits = [
    { id: 'daily', name: 'Read', scheduleType: 'independent', time: '21:30', duration: 20, createdAt: '2026-10-01',
      history: history(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']) },
    { id: 'mwf', name: 'Stretch', scheduleType: 'independent', days: [1, 3, 5], time: '07:00', duration: 15, createdAt: '2026-10-01',
      history: history(['2026-10-12', '2026-10-14', '2026-10-16', '2026-10-19', '2026-10-21', '2026-10-23']) },
    { id: 'stack', name: 'Review notes', scheduleType: 'stacked', stackEventIds: ['c0', 'c2', 'c4'], offsetMinutes: 10, duration: 30, createdAt: '2026-10-01',
      history: history(['2026-10-13', '2026-10-15', '2026-10-18', '2026-10-20']) },
  ];
  localStorage.setItem('unmet_events', JSON.stringify(events));
  localStorage.setItem('unmet_habits', JSON.stringify(habits));
}

beforeEach(() => { seed(); freezeTime(NOW); });
afterEach(restoreTime);

test(`[${TZ}] today follows the local wall clock`, () => {
  assert.equal(db.todayStr(), LOCAL_TODAY[TZ] ?? db.todayStr());
});

test(`[${TZ}] recurring routines occur only on their weekdays and inside their date range`, () => {
  const titlesOn = (d) => db.eventsForDate(d).map((e) => e.title);
  assert.deepEqual(titlesOn('2026-10-25'), ['Classes']); // Sunday
  assert.deepEqual(titlesOn('2026-10-24'), ['Gym']); // Saturday, inside range
  assert.deepEqual(titlesOn('2026-11-07'), []); // Saturday after Gym's endDate
  assert.deepEqual(titlesOn('2026-10-22'), []); // Thursday excluded occurrence
  assert.deepEqual(titlesOn('2026-10-27'), ['Classes', 'Dentist']);
  assert.deepEqual(titlesOn('2026-08-30'), []); // Sunday before startDate
});

test(`[${TZ}] stacked habit lands only on real occurrences, after the event end + offset`, () => {
  const habit = db.getHabits().find((h) => h.id === 'stack');
  assert.ok(db.habitOccursOnDate(habit, '2026-10-25'));
  assert.ok(!db.habitOccursOnDate(habit, '2026-10-24'));
  assert.ok(!db.habitOccursOnDate(habit, '2026-10-22')); // excluded class day
  assert.equal(db.habitTimeForDate(habit, '2026-10-25'), '11:00');
  assert.equal(db.habitEndTimeForDate(habit, '2026-10-25'), '11:30');
  const preview = db.previewStackedOccurrences(['c0', 'c2', 'c4'], 10, 30, 4, '2026-10-24');
  assert.deepEqual(preview.map((p) => p.date), ['2026-10-25', '2026-10-27', '2026-10-29', '2026-11-01']);
  assert.equal(new Set(preview.map((p) => p.date)).size, preview.length); // no duplicate days
});

test(`[${TZ}] independent habit preview walks real weekdays`, () => {
  const p = db.previewIndependentOccurrences([1, 3, 5], '07:00', 15, 3, '2026-10-24');
  assert.deepEqual(p.map((x) => x.date), ['2026-10-26', '2026-10-28', '2026-10-30']);
});

test(`[${TZ}] streaks skip unscheduled days and depend on the local "today"`, () => {
  const h = (id) => db.getHabits().find((x) => x.id === id);
  const today = db.todayStr();
  // Read: done 19–24. If today is the 24th (done) → 6; if the 25th (not done yet) → still 6.
  assert.equal(db.habitStreak(h('daily')), 6, `today=${today}`);
  // Stretch (Mon/Wed/Fri): last 6 scheduled days all done.
  assert.equal(db.habitStreak(h('mwf')), 6);
  // Review notes (class days): 13,15 done, 18 done, 20 done, 22 excluded (not a failure), then Sun 25.
  assert.equal(db.habitStreak(h('stack')), 4);
  assert.equal(db.longestHabitStreak(h('daily')), 6);
});

test(`[${TZ}] completion is recorded on the local date, history is never rewritten`, () => {
  const before = JSON.parse(localStorage.getItem('unmet_habits')).find((x) => x.id === 'daily').history;
  db.toggleHabitForDate('daily', db.todayStr());
  const after = db.getHabits().find((x) => x.id === 'daily').history;
  const today = db.todayStr();
  for (const [k, v] of Object.entries(before)) if (k !== today) assert.equal(after[k], v); // other days untouched
  for (const k of Object.keys(after)) if (k !== today) assert.ok(k in before); // nothing added elsewhere
  assert.equal(after[db.todayStr()], !before[db.todayStr()]);
});

test(`[${TZ}] weekly statistics cover the last 7 local days with the right denominators`, () => {
  const week = db.weeklyConsistency(7);
  assert.equal(week.length, 7);
  assert.equal(week[6].date, db.todayStr());
  assert.equal(week[0].date, db.addDays(db.todayStr(), -6));
  const dates = week.map((d) => d.date);
  assert.equal(new Set(dates).size, 7); // seven distinct consecutive days
  for (let i = 1; i < 7; i++) assert.equal(dates[i], db.addDays(dates[i - 1], 1));
  const tue = week.find((d) => d.date === '2026-10-20');
  assert.equal(tue.scheduledCount, 2); // Read + Review notes (Stretch is M/W/F)
  assert.equal(tue.completedCount, 2);
  const thu = week.find((d) => d.date === '2026-10-22');
  assert.equal(thu.scheduledCount, 1); // class excluded that day → only Read
});

test(`[${TZ}] event delete undo restores the exact rows, order and habit links`, () => {
  const before = localStorage.getItem('unmet_events');
  const habit = () => db.getHabits().find((h) => h.id === 'stack');
  for (const del of [
    () => db.removeEventSeries('cls'),
    () => db.removeEvent('c2'),
    () => db.removeEventOccurrence('cls', '2026-10-27'),
  ]) {
    const snap = db.snapshotEventSeries('cls');
    del();
    db.restoreEventSeries(snap);
    assert.equal(localStorage.getItem('unmet_events'), before);
    assert.ok(db.habitOccursOnDate(habit(), '2026-10-27'));
  }
});

test(`[${TZ}] stacking before a routine finishes the habit {gap} minutes before it starts`, () => {
  const ev = { start: '08:00', end: '10:50' };
  assert.equal(db.stackedStartTime(ev, 'after', 10, 30), '11:00');
  assert.equal(db.stackedStartTime(ev, undefined, 0, 30), '10:50'); // older habits: after, no gap
  assert.equal(db.stackedStartTime(ev, 'before', 15, 20), '07:25');
  assert.equal(db.stackedStartTime({ start: '00:10', end: '01:00' }, 'before', 0, 30), '23:40'); // wraps, no crash
  const id = db.addHabit({ name: 'Pack bag', scheduleType: 'stacked', stackEventIds: ['c0', 'c2', 'c4'], offsetMinutes: 15, stackPosition: 'before', duration: 20 });
  const h = db.getHabits().find((x) => x.id === id);
  assert.equal(h.stackPosition, 'before');
  assert.equal(db.habitTimeForDate(h, '2026-10-25'), '07:25');
  assert.equal(db.habitEndTimeForDate(h, '2026-10-25'), '07:45');
  const preview = db.previewStackedOccurrences(['c0', 'c2', 'c4'], 15, 20, 2, '2026-10-24', 'before');
  assert.deepEqual(preview.map((p) => `${p.date} ${p.start}-${p.end}`), ['2026-10-25 07:25-07:45', '2026-10-27 07:25-07:45']);
});

test(`[${TZ}] 7-day history tells done, missed, pending and not-scheduled apart`, () => {
  const h = db.getHabits().find((x) => x.id === 'mwf'); // Mon/Wed/Fri, done 19, 21, 23
  const states = db.habitDayStates(h, 7, '2026-10-24');
  assert.deepEqual(states.map((s) => `${s.date.slice(8)}:${s.state}`), ['18:off', '19:done', '20:off', '21:done', '22:off', '23:done', '24:off']);
  const daily = { ...db.getHabits().find((x) => x.id === 'daily'), history: { '2026-10-23': true } };
  const today = db.todayStr();
  const last = db.habitDayStates(daily, 2, today);
  assert.equal(last[1].state, daily.history[today] ? 'done' : 'pending'); // today is never "missed"
  const created = { ...daily, createdAt: today, history: {} };
  assert.equal(db.habitDayStates(created, 3, today)[0].state, 'off'); // before the habit existed
});
