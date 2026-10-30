import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from '../helpers.mjs';

installLocalStorage();
globalThis.document = { documentElement: {} }; // i18n sets lang/dir on import
const { dueReminders, getReminderSettings, saveReminderSettings } = await import('../../src/lib/reminders.js');

const h = (id, time, extra = {}) => ({ id, name: id, resolvedTime: time, history: {}, date: '2026-10-28', ...extra });
const at = (hhmm) => { const [a, b] = hhmm.split(':').map(Number); return a * 60 + b; };

test('a reminder is due from (start − lead) for 10 minutes, once', () => {
  const habits = [h('read', '21:30')];
  assert.deepEqual(dueReminders(habits, at('21:24'), 5, []), []);
  assert.equal(dueReminders(habits, at('21:25'), 5, []).length, 1);
  assert.equal(dueReminders(habits, at('21:34'), 5, []).length, 1);
  assert.deepEqual(dueReminders(habits, at('21:35'), 5, []), []); // tab woke up too late: skip, don't spam
  assert.deepEqual(dueReminders(habits, at('21:26'), 5, ['read@21:30']), []); // already sent
});

test('done, muted and time-less habits are never reminded', () => {
  const habits = [
    h('done', '08:00', { history: { '2026-10-28': true } }),
    h('muted', '08:00', { remind: false }),
    h('notime', null),
    h('ok', '08:00'),
  ];
  assert.deepEqual(dueReminders(habits, at('08:00'), 0, []).map((x) => x.id), ['ok']);
});

test('settings default to off with a 5-minute lead, and reject odd values', () => {
  assert.deepEqual(getReminderSettings(), { enabled: false, lead: 5 });
  saveReminderSettings({ enabled: true, lead: 10 });
  assert.deepEqual(getReminderSettings(), { enabled: true, lead: 10 });
  saveReminderSettings({ enabled: 'yes', lead: 999 });
  assert.deepEqual(getReminderSettings(), { enabled: true, lead: 5 });
  localStorage.setItem('unmet_reminders', '{broken');
  assert.deepEqual(getReminderSettings(), { enabled: false, lead: 5 });
});
