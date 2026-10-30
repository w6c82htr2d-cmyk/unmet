import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from '../helpers.mjs';

installLocalStorage();
const events = [];
globalThis.window = { dispatchEvent: (e) => events.push(e.type) };
const db = await import('../../src/db.js');
const backup = await import('../../src/lib/backup.js');

const HABITS = [{ id: 'h1', name: 'Read', scheduleType: 'independent', history: { '2026-10-20': true }, createdAt: '2026-10-01' }];

beforeEach(() => {
  localStorage.setQuota(null);
  localStorage.clear();
  events.length = 0;
  localStorage.setItem('unmet_habits', JSON.stringify(HABITS));
});

const fillToQuota = () => localStorage.setQuota(localStorage.usedChars());

test('a failed save throws StorageError, fires the warning event and keeps the old data', () => {
  const before = localStorage.getItem('unmet_habits');
  fillToQuota();
  assert.throws(() => db.toggleHabitForDate('h1', '2026-10-21'), (e) => db.isStorageError(e));
  assert.deepEqual(events, ['unmet:storage-failed']);
  assert.equal(localStorage.getItem('unmet_habits'), before); // completion NOT recorded
});

test('every kind of user save surfaces the failure', () => {
  fillToQuota();
  const saves = [
    () => db.addHabit({ name: 'New' }),
    () => db.updateHabit('h1', { name: 'Renamed' }),
    () => db.addEvent({ title: 'Lab', type: 'once', date: '2026-10-30', start: '10:00', end: '11:00' }),
    () => db.addEvents([{ title: 'Lab', type: 'weekly', dayOfWeek: 1, start: '10:00', end: '11:00', seriesId: 's' }]),
    () => db.saveMorningEntry('2026-10-30', { priorities: [{ text: 'Study' }] }),
    () => db.saveEveningEntry('2026-10-30', { completion: [true] }),
    () => db.addFreeformEntry('my thoughts'),
    () => db.addGoal({ text: 'Midterm', subtasks: [] }),
    () => db.saveProfile({ firstName: 'L' }),
  ];
  for (const save of saves) assert.throws(save, (e) => db.isStorageError(e), save.toString());
  assert.equal(events.length, saves.length);
});

test('a multi-day routine is saved all at once or not at all', () => {
  localStorage.setItem('unmet_events', '[]');
  localStorage.setQuota(localStorage.usedChars() + 150); // room for about one row, not three
  const rows = [1, 3, 5].map((d) => ({ title: 'Lab session', type: 'weekly', dayOfWeek: d, start: '10:00', end: '11:30', source: 'manual', seriesId: 'lab' }));
  assert.throws(() => db.addEvents(rows), (e) => db.isStorageError(e));
  assert.deepEqual(db.getEvents(), []); // no half-saved routine
});

test('an import that fails part-way is rolled back completely', () => {
  localStorage.setItem('unmet_goals', JSON.stringify([{ id: 'g0', text: 'Keep me', subtasks: [] }]));
  const before = db.exportAll();
  const big = { unmet_goals: [], unmet_habits: [{ id: 'h9', name: 'x'.repeat(400), history: {} }] };
  localStorage.setQuota(localStorage.usedChars() + 50); // goals (smaller) fit, habits don't
  assert.throws(() => backup.applyImport(backup.validateImportData(big).data), (e) => db.isStorageError(e));
  assert.deepEqual(db.exportAll(), before);
});

test('reset removes backup and sync code too, keeps theme and language', () => {
  localStorage.setItem('unmet_backup', '{"data":{}}');
  localStorage.setItem('unmet_sync_code', 'ABCDEFGH');
  localStorage.setItem('unmet_tour_seen', '1');
  localStorage.setItem('unmet_theme', 'dark');
  localStorage.setItem('unmet_lang', 'ar');
  localStorage.setItem('other_site_key', 'x');
  db.resetAll();
  assert.deepEqual(Object.keys(localStorage).sort(), ['other_site_key', 'unmet_lang', 'unmet_theme']);
});
