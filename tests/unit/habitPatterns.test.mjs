import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage, freezeTime, restoreTime } from '../helpers.mjs';

installLocalStorage();
const db = await import('../../src/db.js');
const P = await import('../../src/lib/habitPatterns.js');
const TZ = process.env.TZ || 'system';

// Synthetic history only. "Today" is Wed 28 Oct 2026 (midday UTC is the same date in every zone tested).
const NOW = '2026-10-28T12:00:00Z';
const TODAY = '2026-10-28';

// History for the 40 days before today where keep(date, dow) is true.
function hist(keep) {
  const h = {};
  for (let i = 1; i <= 40; i++) {
    const d = db.addDays(TODAY, -i);
    if (keep(d, db.dayOfWeek(d), i)) h[d] = true;
  }
  return h;
}
const habit = (id, extra) => ({ id, name: id, scheduleType: 'independent', time: '07:00', duration: 20, createdAt: '2026-09-01', history: {}, ...extra });

beforeEach(() => { localStorage.clear(); freezeTime(NOW); });
afterEach(restoreTime);

test(`[${TZ}] a weekday that clearly lags is found, with the real counts, and can be skipped`, () => {
  const stretch = habit('Stretch', { history: hist((d, dow) => dow !== 1) }); // never on Mondays
  const [p] = P.findHabitPatterns([stretch], TODAY).filter((x) => x.type === 'weekday');
  assert.ok(p);
  assert.equal(p.dow, 1);
  assert.equal(p.onDone, 0);
  assert.equal(p.onTotal, 4); // four Mondays in the 4-week window
  assert.equal(p.offDone, 24);
  assert.equal(p.offTotal, 24);
  assert.deepEqual(p.action, { kind: 'skipDay', dow: 1 });
});

test(`[${TZ}] a stacked habit's weekday pattern only suggests editing (its days come from the routine)`, () => {
  localStorage.setItem('unmet_events', JSON.stringify([
    { id: 'c0', seriesId: 'c', title: 'Classes', type: 'weekly', dayOfWeek: 0, startDate: '2026-09-01', start: '08:00', end: '10:00' },
    { id: 'c2', seriesId: 'c', title: 'Classes', type: 'weekly', dayOfWeek: 2, startDate: '2026-09-01', start: '08:00', end: '10:00' },
    { id: 'c4', seriesId: 'c', title: 'Classes', type: 'weekly', dayOfWeek: 4, startDate: '2026-09-01', start: '08:00', end: '10:00' },
  ]));
  const review = habit('Review', { scheduleType: 'stacked', stackEventIds: ['c0', 'c2', 'c4'], history: hist((d, dow) => dow !== 4) });
  const filler = habit('Filler', { history: hist(() => true) }); // gives the window enough history
  const ps = P.findHabitPatterns([review, filler], TODAY).filter((x) => x.habitId === 'Review' && x.type === 'weekday');
  assert.equal(ps.length, 1);
  assert.equal(ps[0].dow, 4);
  assert.equal(ps[0].onTotal + ps[0].offTotal, 12); // only real class days count
  assert.deepEqual(ps[0].action, { kind: 'edit' });
});

test(`[${TZ}] a recent slide is reported against the weeks before, with a shorter option`, () => {
  const walk = habit('Walk', { duration: 20, history: hist((d, dow, i) => i > 7 || i === 3) });
  const p = P.findHabitPatterns([walk], TODAY).find((x) => x.type === 'slide');
  assert.ok(p);
  assert.equal(p.recentDone, 1);
  assert.equal(p.recentTotal, 7);
  assert.equal(p.beforeDone, 21);
  assert.equal(p.beforeTotal, 21);
  assert.deepEqual(p.action, { kind: 'shorten', minutes: 10 });
});

test(`[${TZ}] steady habits and linked-vs-unlinked differences use real rates only`, () => {
  localStorage.setItem('unmet_events', JSON.stringify([
    { id: 'w1', seriesId: 'w', title: 'Work', type: 'weekly', dayOfWeek: 1, startDate: '2026-09-01', start: '09:00', end: '17:00' },
    { id: 'w3', seriesId: 'w', title: 'Work', type: 'weekly', dayOfWeek: 3, startDate: '2026-09-01', start: '09:00', end: '17:00' },
    { id: 'w5', seriesId: 'w', title: 'Work', type: 'weekly', dayOfWeek: 5, startDate: '2026-09-01', start: '09:00', end: '17:00' },
  ]));
  const linked = habit('After work walk', { scheduleType: 'stacked', stackEventIds: ['w1', 'w3', 'w5'], history: hist(() => true) });
  const loose = habit('Read', { history: hist((d, dow, i) => i % 3 === 0) }); // about a third
  const ps = P.findHabitPatterns([linked, loose], TODAY);
  const steady = ps.find((x) => x.type === 'steady');
  assert.equal(steady.habitId, 'After work walk');
  assert.equal(steady.done, steady.total);
  const l = ps.find((x) => x.type === 'linked');
  assert.equal(l.habitId, 'Read');
  assert.equal(l.linkedPct, 100);
  assert.ok(l.unlinkedPct >= 30 && l.unlinkedPct <= 36, String(l.unlinkedPct));
});

test(`[${TZ}] nothing is claimed without two weeks of history, or for habits done every day`, () => {
  const fresh = habit('New', { createdAt: db.addDays(TODAY, -6), history: {} });
  assert.equal(P.historyDays([fresh], TODAY), 6);
  assert.deepEqual(P.findHabitPatterns([fresh], TODAY), []);
  const perfect = habit('Perfect', { history: hist(() => true) });
  assert.deepEqual(P.findHabitPatterns([perfect], TODAY).map((x) => x.type), ['steady']);
  // Today (not over yet) never counts as a miss
  const p = P.scheduledDays(perfect, db.addDays(TODAY, -2), db.addDays(TODAY, -1));
  assert.ok(p.every((x) => x.done));
});

test(`[${TZ}] dismissing hides an insight for 4 weeks, then it can return`, () => {
  const stretch = habit('Stretch', { history: hist((d, dow) => dow !== 1) });
  const id = P.findHabitPatterns([stretch], TODAY)[0].id;
  P.dismissInsight(id, TODAY);
  assert.ok(!P.activeHabitPatterns([stretch], TODAY).some((x) => x.id === id));
  assert.ok(P.isDismissed(id, db.addDays(TODAY, 27)));
  assert.ok(!P.isDismissed(id, db.addDays(TODAY, 28)));
  localStorage.setItem('unmet_insights_dismissed', 'not json');
  assert.ok(!P.isDismissed(id, TODAY)); // corrupt storage never breaks the page
});

test(`[${TZ}] comebacks are a return after two or more missed scheduled days`, () => {
  // Missed the 4th and 3rd days ago, done 2 days ago.
  const h = habit('Walk', { history: hist((d, dow, i) => !(i === 4 || i === 3)) });
  const c = P.comebacks([h], db.addDays(TODAY, -7), db.addDays(TODAY, -1));
  assert.equal(c.length, 1);
  assert.equal(c[0].date, db.addDays(TODAY, -2));
  assert.equal(c[0].missedBefore, 2);
});
