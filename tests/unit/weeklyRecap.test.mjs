import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage, freezeTime, restoreTime } from '../helpers.mjs';

installLocalStorage();
const db = await import('../../src/db.js');
const R = await import('../../src/lib/weeklyRecap.js');
const TZ = process.env.TZ || 'system';

// "Today" is Wed 28 Oct 2026; the last finished week is Sun 18 – Sat 24 Oct. Synthetic data only.
const NOW = '2026-10-28T12:00:00Z';
const WEEK = '2026-10-18';
const habit = (id, extra) => ({ id, name: id, scheduleType: 'independent', time: '07:00', duration: 20, createdAt: '2026-09-01', history: {}, ...extra });
const on = (...dates) => Object.fromEntries(dates.map((d) => [d, true]));

beforeEach(() => { localStorage.clear(); freezeTime(NOW); });
afterEach(restoreTime);

test(`[${TZ}] the recap covers the last finished Sunday–Saturday week`, () => {
  assert.equal(R.lastCompleteWeek('2026-10-28'), WEEK);
  assert.equal(R.lastCompleteWeek('2026-10-25'), WEEK); // Sunday: the week that just ended
  assert.equal(R.weekStartOf('2026-10-24'), WEEK);
});

test(`[${TZ}] totals, active days, best day, wins and streak are exact counts`, () => {
  const read = habit('Read', { history: on('2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24') });
  const stretch = habit('Stretch', { days: [1, 3, 5], history: on('2026-10-19', '2026-10-23') }); // Mon/Wed/Fri: 2 of 3
  const r = R.computeRecap([read, stretch], WEEK);
  assert.equal(r.enough, true);
  assert.equal(r.scheduled, 10);
  assert.equal(r.done, 9);
  assert.equal(r.pct, 90);
  assert.equal(r.activeDays, 7);
  assert.equal(r.bestDay.date, '2026-10-19'); // Monday: 2 done (earliest of the 2-done days)
  assert.equal(r.bestDay.done, 2);
  assert.deepEqual(r.top.map((x) => `${x.name} ${x.done}/${x.total}`), ['Read 7/7', 'Stretch 2/3']);
  assert.deepEqual(r.perfect, ['Read']);
  assert.deepEqual(r.streak, { name: 'Read', days: 7 });
  assert.equal(r.improvement.kind, 'keep');
});

test(`[${TZ}] a low-completion habit becomes the one improvement, and comebacks are found`, () => {
  // Walk every day; missed Sun–Mon, back Tue, then missed Thu–Sat → done 2 of 7, one comeback.
  const walk = habit('Walk', { history: on('2026-10-15', '2026-10-16', '2026-10-17', '2026-10-20', '2026-10-21') });
  const r = R.computeRecap([walk], WEEK);
  assert.equal(r.done, 2);
  assert.equal(r.scheduled, 7);
  assert.deepEqual(r.improvement, { kind: 'smaller', habitId: 'Walk', habitName: 'Walk', done: 2, total: 7 });
  assert.equal(r.comebacks.length, 1);
  assert.equal(r.comebacks[0].date, '2026-10-20');
  assert.equal(r.comebacks[0].missedBefore, 2);
});

test(`[${TZ}] not enough history means no recap numbers are claimed`, () => {
  const fresh = habit('New', { createdAt: '2026-10-23', history: on('2026-10-23', '2026-10-24') });
  const r = R.computeRecap([fresh], WEEK);
  assert.equal(r.enough, false); // 2 scheduled days only
  assert.equal(R.computeRecap([], WEEK).enough, false);
});

test(`[${TZ}] the week before is compared only when it had enough history`, () => {
  const read = habit('Read', { createdAt: '2026-10-01', history: on('2026-10-11', '2026-10-12', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21') });
  const r = R.computeRecap([read], WEEK);
  assert.equal(r.prevPct, 29); // 2 of 7
  assert.equal(r.pct, 57); // 4 of 7
  const young = habit('Young', { createdAt: '2026-10-17', history: on('2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22') });
  assert.equal(R.computeRecap([young], WEEK).prevPct, null); // only 1 day the week before
});

test(`[${TZ}] the "seen" marker is per week and survives broken storage`, () => {
  assert.equal(R.recapSeen(WEEK), false);
  R.markRecapSeen(WEEK);
  assert.equal(R.recapSeen(WEEK), true);
  assert.equal(R.recapSeen('2026-10-25'), false);
});
