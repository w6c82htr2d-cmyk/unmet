import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from '../helpers.mjs';

installLocalStorage();
const db = await import('../../src/db.js');
const backup = await import('../../src/lib/backup.js');

const GOOD = {
  unmet_profile: { firstName: 'Test', onboarded: true },
  unmet_habits: [{ id: 'h1', name: 'Read', scheduleType: 'independent', time: '21:00', duration: 20, history: { '2026-10-20': true, '2026-10-21': false }, createdAt: '2026-10-01' }],
  unmet_events: [
    { id: 'e1', seriesId: 's1', title: 'Classes', type: 'weekly', dayOfWeek: 0, startDate: '2026-09-01', start: '08:00', end: '10:50', source: 'manual' },
    { id: 'e2', seriesId: 's1', title: 'Classes', type: 'weekly', dayOfWeek: 2, startDate: '2026-09-01', start: '08:00', end: '10:50', source: 'manual' },
    { id: 'e3', title: 'Dentist', type: 'once', date: '2026-10-27', start: '15:30', end: '16:15' },
  ],
  unmet_morning: { '2026-10-20': { priorities: [{ text: 'Study' }] } },
  unmet_evening: { '2026-10-20': { completion: [true] } },
  unmet_freeform: [{ id: 'f1', text: 'Thoughts', createdAt: '2026-10-20T10:00:00Z', plan: null }],
  unmet_goals: [{ id: 'g1', text: 'Midterm', subtasks: [{ id: 'st0', text: 'Review notes', importance: 'hi', urgency: 'hi', done: false }] }],
  unmet_calendar_view: 'week',
};

beforeEach(() => localStorage.clear());

test('a real export validates and summarizes', () => {
  const r = backup.validateImportData(structuredClone(GOOD));
  assert.ok(r.ok);
  assert.deepEqual(backup.summarize(r.data), { habits: 1, completions: 1, routines: 2, journal: 3, goals: 1 });
});

test('unknown keys are dropped, not written', () => {
  const r = backup.validateImportData({ ...structuredClone(GOOD), unmet_theme: 'light', evil: '<script>' });
  assert.ok(r.ok);
  assert.ok(!('evil' in r.data) && !('unmet_theme' in r.data));
});

test('invalid files are rejected without writing anything', () => {
  localStorage.setItem('unmet_habits', JSON.stringify([{ id: 'keep', name: 'Mine', history: {} }]));
  const cases = [
    'not json',
    '[]',
    '{}',
    JSON.stringify({ something: 1 }),
    JSON.stringify({ unmet_habits: 'oops' }),
    JSON.stringify({ unmet_habits: [{ id: 'x' }] }),
    JSON.stringify({ unmet_habits: [{ id: 'x', name: 'n', history: { 'not-a-date': true } }] }),
    JSON.stringify({ unmet_events: [{ id: 'e', title: 't', type: 'weekly', dayOfWeek: 9, start: '08:00', end: '09:00' }] }),
    JSON.stringify({ unmet_events: [{ id: 'e', title: 't', type: 'once', date: '2026-02-30', start: '08:00', end: '09:00' }] }),
    JSON.stringify({ unmet_events: [{ id: 'e', title: 't', type: 'once', date: '2026-02-03', start: '8am', end: '09:00' }] }),
    JSON.stringify({ unmet_morning: { yesterday: {} } }),
    JSON.stringify({ unmet_calendar_view: 'month' }),
    JSON.stringify({ ...GOOD, unmet_goals: [{ id: 'g', text: 'x' }] }), // one bad section rejects the whole file
  ];
  for (const text of cases) {
    const r = backup.parseImportText(text);
    assert.equal(r.ok, false, text.slice(0, 60));
  }
  assert.equal(JSON.parse(localStorage.getItem('unmet_habits'))[0].id, 'keep');
  assert.equal(backup.parseImportText('x'.repeat(backup.MAX_IMPORT_BYTES + 1)).section, 'size');
});

test('import keeps sections the file does not contain', () => {
  localStorage.setItem('unmet_freeform', JSON.stringify([{ id: 'mine', text: 'private' }]));
  const r = backup.validateImportData({ unmet_habits: GOOD.unmet_habits });
  backup.saveBackup('import');
  backup.applyImport(r.data);
  assert.equal(db.getHabits()[0].id, 'h1');
  assert.equal(db.getFreeformEntries()[0].id, 'mine');
});

test('backup + restore round-trips exactly, and restore can be undone', () => {
  backup.applyImport(structuredClone(GOOD));
  const original = db.exportAll();
  assert.ok(backup.saveBackup('import'));
  backup.applyImport({ unmet_habits: [] , unmet_goals: [] });
  assert.equal(db.getHabits().length, 0);
  assert.ok(backup.restoreBackup());
  assert.deepEqual(db.exportAll(), original); // back exactly as it was
  assert.equal(backup.getBackup().reason, 'restore');
  assert.ok(backup.restoreBackup()); // swap back to the post-import state
  assert.equal(db.getHabits().length, 0);
});

test('restore clears sections that were empty in the backup', () => {
  backup.applyImport({ unmet_habits: GOOD.unmet_habits });
  backup.saveBackup('import');
  localStorage.setItem('unmet_goals', JSON.stringify(GOOD.unmet_goals));
  backup.restoreBackup();
  assert.equal(localStorage.getItem('unmet_goals'), null);
});

test('saveBackup reports failure when storage is full', () => {
  const realSet = localStorage.setItem;
  localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  try {
    assert.equal(backup.saveBackup('import'), false);
  } finally {
    localStorage.setItem = realSet;
  }
});

test('goal delete can be undone exactly', () => {
  backup.applyImport({ unmet_goals: [{ id: 'g1', text: 'A', subtasks: [] }, { id: 'g2', text: 'B', subtasks: [] }] });
  const before = localStorage.getItem('unmet_goals');
  const removed = db.removeGoal('g1');
  assert.equal(db.getGoals().length, 1);
  db.restoreGoal(removed);
  assert.equal(localStorage.getItem('unmet_goals'), before);
  assert.equal(db.removeGoal('missing'), null);
});

test('values that would land in HTML attributes or unescaped spots are rejected', () => {
  const evil = '" onmouseover="alert(1)';
  const bad = [
    { unmet_habits: [{ id: evil, name: 'x', history: {} }] },
    { unmet_habits: [{ id: 'h', name: 'x', history: {}, stackEventIds: [evil] }] },
    { unmet_events: [{ id: 'e', seriesId: evil, title: 't', type: 'once', date: '2026-10-01', start: '08:00', end: '09:00' }] },
    { unmet_events: [{ id: 'e', title: 't', type: 'weekly', dayOfWeek: 1, startDate: '<img src=x onerror=alert(1)>', start: '08:00', end: '09:00' }] },
    { unmet_goals: [{ id: 'g', text: 't', subtasks: [{ id: evil, text: 's' }] }] },
    { unmet_freeform: [{ id: 'f', text: 't', plan: { goals: 'nope' } }] },
    { unmet_profile: { firstName: 'x'.repeat(101) } },
    { unmet_profile: { goalTracks: [evil] } },
  ];
  for (const data of bad) assert.equal(backup.validateImportData(data).ok, false, JSON.stringify(data).slice(0, 80));
  // Markup inside free text is allowed as data — pages escape it when rendering.
  assert.ok(backup.validateImportData({ unmet_profile: { firstName: '<b>Lay</b>' } }).ok);
  assert.ok(backup.validateImportData({ unmet_events: [{ id: 'abc123@google.com', title: '<i>x</i>', type: 'once', date: '2026-10-01', start: '08:00', end: '09:00' }] }).ok);
});
