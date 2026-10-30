import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { freezeTime, restoreTime } from '../helpers.mjs';
import { addDays, dayOfWeek, todayStr, localDateStr, daysBetween, isDateStr, dateForDisplay } from '../../src/lib/dates.js';

const TZ = process.env.TZ || 'system';
afterEach(restoreTime);

test(`[${TZ}] addDays is pure calendar arithmetic`, () => {
  assert.equal(addDays('2026-10-24', 1), '2026-10-25');
  assert.equal(addDays('2026-10-24', -1), '2026-10-23');
  assert.equal(addDays('2026-10-24', 0), '2026-10-24');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-10-24', -400), '2025-09-19');
});

test(`[${TZ}] addDays across daylight-saving changes`, () => {
  // US: 2026-03-08 spring forward, 2026-11-01 fall back. EU: 2026-03-29 / 2026-10-25.
  assert.equal(addDays('2026-03-07', 1), '2026-03-08');
  assert.equal(addDays('2026-03-08', 1), '2026-03-09');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-11-01', 1), '2026-11-02');
  assert.equal(addDays('2026-10-25', -1), '2026-10-24');
  // walking a whole year one day at a time never repeats or skips a date
  let d = '2026-01-01';
  for (let i = 0; i < 365; i++) d = addDays(d, 1);
  assert.equal(d, '2027-01-01');
});

test(`[${TZ}] dayOfWeek does not depend on the device zone`, () => {
  assert.equal(dayOfWeek('2026-10-24'), 6); // Saturday
  assert.equal(dayOfWeek('2026-10-25'), 0); // Sunday
  assert.equal(dayOfWeek('2026-03-08'), 0);
  assert.equal(dayOfWeek('2026-11-01'), 0);
  assert.equal(dayOfWeek('2027-01-01'), 5);
});

test(`[${TZ}] daysBetween / isDateStr / bad input degrades instead of throwing`, () => {
  assert.equal(daysBetween('2026-10-18', '2026-10-25'), 7);
  assert.equal(daysBetween('2026-03-01', '2026-03-31'), 30);
  assert.ok(isDateStr('2026-02-28'));
  assert.ok(!isDateStr('2026-02-30'));
  assert.ok(!isDateStr('2026-10-24T00:00:00Z'));
  assert.equal(addDays('garbage', 1), 'garbage');
  assert.equal(dayOfWeek(undefined), -1);
  assert.ok(Number.isNaN(daysBetween('x', '2026-01-01')));
});

test(`[${TZ}] dateForDisplay keeps the calendar date`, () => {
  const d = dateForDisplay('2026-11-01');
  assert.equal(localDateStr(d), '2026-11-01');
});

// "Today" must be the date on the user's wall clock. Each case is an absolute instant plus the
// local date it represents in the zone the suite is running under.
const TODAY_CASES = {
  'Asia/Riyadh': [
    ['2026-10-24T12:00:00+03:00', '2026-10-24'],
    ['2026-10-25T00:00:00+03:00', '2026-10-25'], // exactly midnight
    ['2026-10-25T01:30:00+03:00', '2026-10-25'], // old code said 10-24
    ['2026-10-24T23:59:59+03:00', '2026-10-24'],
  ],
  'America/New_York': [
    ['2026-10-24T21:00:00-04:00', '2026-10-24'], // old code said 10-25
    ['2026-10-24T23:59:59-04:00', '2026-10-24'],
    ['2026-11-01T01:30:00-04:00', '2026-11-01'], // first 01:30 on fall-back day
    ['2026-11-01T01:30:00-05:00', '2026-11-01'], // second 01:30
    ['2026-03-08T03:30:00-04:00', '2026-03-08'], // just after spring-forward gap
  ],
  'Asia/Tokyo': [
    ['2026-10-25T08:00:00+09:00', '2026-10-25'], // old code said 10-24
    ['2026-10-25T00:30:00+09:00', '2026-10-25'],
  ],
  UTC: [
    ['2026-10-24T23:59:59Z', '2026-10-24'],
    ['2026-10-25T00:00:00Z', '2026-10-25'],
  ],
};

for (const [instant, expected] of TODAY_CASES[TZ] || []) {
  test(`[${TZ}] todayStr at ${instant} is ${expected}`, () => {
    freezeTime(instant);
    assert.equal(todayStr(), expected);
    assert.equal(todayStr(-1), addDays(expected, -1));
    assert.equal(todayStr(1), addDays(expected, 1));
  });
}
