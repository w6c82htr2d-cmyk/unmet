// Optional habit reminders using the browser's own notifications — no server, no push service, no
// cost. The honest limit: they can only appear while Unmet is open in a browser tab (it may be in
// the background). Closed tab or closed browser → no reminder. On iPhone and iPad, Safari only
// shows web notifications for sites added to the Home Screen, and only through a push server, which
// Unmet doesn't use — so reminders there are effectively unavailable. The settings screen says so.
import { habitsForDate, todayStr } from '../db.js';
import { t } from '../i18n.js';

const SETTINGS_KEY = 'unmet_reminders'; // { enabled, lead } — per device, not exported
const SENT_KEY = 'unmet_reminders_sent'; // { date, keys: [] } — so a reload never repeats one
export const LEADS = [0, 5, 10, 15];
const WINDOW_MIN = 10; // a reminder still shows if the tab wakes up within 10 minutes of its time

export function remindersSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function permissionState() {
  if (!remindersSupported()) return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

export function isAppleMobile() {
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function getReminderSettings() {
  try {
    const v = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    return { enabled: v?.enabled === true, lead: LEADS.includes(v?.lead) ? v.lead : 5 };
  } catch {
    return { enabled: false, lead: 5 };
  }
}

export function saveReminderSettings(s) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ enabled: !!s.enabled, lead: LEADS.includes(s.lead) ? s.lead : 5 }));
  } catch {
    // Not saved: reminders simply stay as they were.
  }
}

// Asks the browser for permission (only ever from a user's tap). Returns the resulting state.
export async function requestReminderPermission() {
  if (!remindersSupported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

function toMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function readSent(today) {
  try {
    const v = JSON.parse(localStorage.getItem(SENT_KEY) || 'null');
    return v && v.date === today && Array.isArray(v.keys) ? v.keys : [];
  } catch {
    return [];
  }
}

function writeSent(today, keys) {
  try {
    localStorage.setItem(SENT_KEY, JSON.stringify({ date: today, keys: keys.slice(-200) }));
  } catch {
    // Worst case a reminder could repeat after a reload.
  }
}

// Which reminders are due right now: habits scheduled today with a time, not done, not muted,
// whose reminder moment (start − lead) passed less than WINDOW_MIN minutes ago. Pure, for tests.
export function dueReminders(habits, nowMin, lead, sent) {
  return habits.filter((h) => {
    if (h.remind === false || !h.resolvedTime || h.history?.[h.date]) return false;
    const at = toMin(h.resolvedTime) - lead;
    const key = `${h.id}@${h.resolvedTime}`;
    return nowMin >= at && nowMin < at + WINDOW_MIN && !sent.includes(key);
  });
}

export function checkReminders(now = new Date()) {
  const s = getReminderSettings();
  if (!s.enabled || permissionState() !== 'granted') return [];
  const today = todayStr();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const sent = readSent(today);
  const due = dueReminders(habitsForDate(today).map((h) => ({ ...h, date: today })), nowMin, s.lead, sent);
  due.forEach((h) => {
    try {
      const n = new Notification(h.name, {
        body: s.lead ? t('reminderBodyLead', { time: h.resolvedTime, n: s.lead }) : t('reminderBodyNow', { time: h.resolvedTime }),
        tag: `unmet-${h.id}-${today}`,
        icon: '/favicon.svg',
      });
      n.onclick = () => { window.focus(); location.hash = '#/'; n.close(); };
    } catch {
      // Some browsers only allow notifications from a service worker; nothing else to do here.
    }
    sent.push(`${h.id}@${h.resolvedTime}`);
  });
  if (due.length) writeSent(today, sent);
  return due;
}

let timer = null;

// Starts the once-a-minute check (browsers slow timers in background tabs; the 10-minute window
// covers that). Safe to call more than once.
export function startReminderLoop() {
  if (timer || !remindersSupported()) return;
  const tick = () => { try { checkReminders(); } catch { /* never break the app over a reminder */ } };
  timer = setInterval(tick, 30000);
  document.addEventListener('visibilitychange', tick);
  tick();
}
