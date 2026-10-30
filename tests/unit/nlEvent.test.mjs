import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEventText } from '../../src/lib/nlEvent.js';

const today = '2026-10-30'; // a Friday
const p = (text, lang) => parseEventText(text, { today, lang });

test('the example from the brief', () => {
  const r = p('Classes every Sunday, Tuesday, and Thursday from 8 AM to 11 AM');
  assert.deepEqual(r, { title: 'Classes', type: 'weekly', days: [0, 2, 4], date: null, start: '08:00', end: '11:00', missing: [] });
});

test('ranges of days and compact times', () => {
  let r = p('Work Mon-Wed 1pm-5pm');
  assert.equal(r.title, 'Work'); assert.equal(r.type, 'weekly'); assert.deepEqual(r.days, [1, 2, 3]);
  assert.equal(r.start, '13:00'); assert.equal(r.end, '17:00');
  r = p('Lab Monday to Wednesday 11-1pm');
  assert.deepEqual(r.days, [1, 2, 3]); assert.equal(r.start, '11:00'); assert.equal(r.end, '13:00');
  r = p('Part-time job weekdays 9:30-14:15');
  assert.deepEqual(r.days, [1, 2, 3, 4, 5]); assert.equal(r.start, '09:30'); assert.equal(r.end, '14:15');
  assert.equal(r.title, 'Part-time job');
});

test('start time plus duration', () => {
  const r = p('Gym on Saturdays at 9 for 1 hour');
  assert.equal(r.type, 'weekly'); assert.deepEqual(r.days, [6]); assert.equal(r.start, '09:00'); assert.equal(r.end, '10:00'); assert.equal(r.title, 'Gym');
  const r2 = p('Study group every Tuesday at 7pm for 90 minutes');
  assert.equal(r2.start, '19:00'); assert.equal(r2.end, '20:30'); assert.equal(r2.title, 'Study group');
});

test('one-time entries', () => {
  let r = p('Dentist tomorrow 3:30pm to 4:15pm');
  assert.equal(r.type, 'once'); assert.equal(r.date, '2026-10-31'); assert.equal(r.start, '15:30'); assert.equal(r.end, '16:15'); assert.equal(r.title, 'Dentist');
  r = p('Career fair on Nov 12 from 10am to 2pm');
  assert.equal(r.date, '2026-11-12'); assert.equal(r.start, '10:00'); assert.equal(r.end, '14:00'); assert.equal(r.title, 'Career fair');
  r = p('Exam 2027-01-15 08:00-10:00');
  assert.equal(r.date, '2027-01-15'); assert.equal(r.start, '08:00'); assert.equal(r.end, '10:00'); // date not read as a time
  r = p('Meeting on Monday 10-11'); // single weekday, no "every": the next Monday
  assert.equal(r.type, 'once'); assert.equal(r.date, '2026-11-02');
  r = p('Party 5 Jan 8pm-11pm'); // past month/day this year → next year
  assert.equal(r.date, '2027-01-05');
});

test('am/pm guesses for bare hours', () => {
  assert.equal(p('Classes every Sunday from 8 to 11').start, '08:00');
  const r = p('Tutoring every Wednesday from 2 to 4');
  assert.equal(r.start, '14:00'); assert.equal(r.end, '16:00');
  const r2 = p('Shift every Friday 10 to 1');
  assert.equal(r2.start, '10:00'); assert.equal(r2.end, '13:00');
  assert.equal(p('Swim every Monday 8-9 and stretch').end, '09:00'); // "and" is not "a.m."
});

test('daily and weekends', () => {
  assert.deepEqual(p('Reading every day 21:00-21:30').days, [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(p('Hike weekends 7am-9am').days, [0, 6]);
  assert.deepEqual(p('عمل أيام الأسبوع من 9 إلى 5', 'ar').days, [0, 1, 2, 3, 4]); // Sun–Thu week
});

test('Arabic', () => {
  const r = p('محاضرات كل أحد وثلاثاء وخميس من 8 إلى 11 صباحًا', 'ar');
  assert.equal(r.type, 'weekly'); assert.deepEqual(r.days, [0, 2, 4]); assert.equal(r.start, '08:00'); assert.equal(r.end, '11:00');
  assert.equal(r.title, 'محاضرات');
  const r2 = p('نادي يوم السبت الساعة ٦ مساءً لمدة ساعتين', 'ar');
  assert.equal(r2.start, '18:00'); assert.equal(r2.end, '20:00');
  const r3 = p('طبيب الأسنان غدًا من 3 إلى 4 م', 'ar');
  assert.equal(r3.type, 'once'); assert.equal(r3.date, '2026-10-31'); assert.equal(r3.start, '15:00'); assert.equal(r3.end, '16:00');
});

test('reports what it could not work out, never guesses wildly', () => {
  assert.deepEqual(p('').missing, ['title', 'days', 'start', 'end']);
  const r = p('Yoga every Thursday');
  assert.deepEqual(r.missing, ['start', 'end']);
  const r2 = p('every Monday 9-10');
  assert.deepEqual(r2.missing, ['title']);
  assert.equal(p('Call mom at 25:00').start, null); // impossible time ignored
});
