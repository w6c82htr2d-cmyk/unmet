// Turns a plain-language description into a draft calendar entry, without any AI or network call:
//   "Classes every Sunday, Tuesday and Thursday from 8 AM to 11 AM"
//   "Work Mon-Wed 1pm-5pm" · "Gym on Saturdays at 9 for 1 hour" · "Dentist tomorrow 3:30pm to 4:15pm"
//   "محاضرات كل أحد وثلاثاء وخميس من 8 إلى 11 صباحًا"
// The result is only a suggestion: the app shows it for review and never saves it without the
// user confirming. Anything it couldn't work out is listed in `missing`.
import { addDays, dayOfWeek, isDateStr } from './dates.js';

const DAY_WORDS = [
  [0, ['sunday', 'sundays', 'sun', 'الأحد', 'الاحد', 'أحد']],
  [1, ['monday', 'mondays', 'mon', 'الاثنين', 'الإثنين', 'اثنين', 'إثنين']],
  [2, ['tuesday', 'tuesdays', 'tue', 'tues', 'الثلاثاء', 'ثلاثاء']],
  [3, ['wednesday', 'wednesdays', 'wed', 'الأربعاء', 'الاربعاء', 'أربعاء', 'اربعاء']],
  [4, ['thursday', 'thursdays', 'thu', 'thur', 'thurs', 'الخميس', 'خميس']],
  [5, ['friday', 'fridays', 'fri', 'الجمعة', 'جمعة']],
  [6, ['saturday', 'saturdays', 'sat', 'السبت', 'سبت']],
];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const AR_DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };

function dayIndex(word) {
  const w = word.toLowerCase().replace(/^و/, ''); // Arabic "and" prefix: وثلاثاء
  for (const [i, words] of DAY_WORDS) if (words.includes(w)) return i;
  return -1;
}

const pad = (n) => String(n).padStart(2, '0');

function to24(h, m, mer) {
  let hour = h % 24;
  if (mer === 'pm' && hour < 12) hour += 12;
  if (mer === 'am' && hour === 12) hour = 0;
  return hour * 60 + m;
}

function fmt(min) {
  const v = ((min % 1440) + 1440) % 1440;
  return `${pad(Math.floor(v / 60))}:${pad(v % 60)}`;
}

function meridiem(s) {
  if (!s) return '';
  s = s.toLowerCase().replace(/\./g, '');
  if (s === 'am' || s === 'a' || s.startsWith('ص')) return 'am';
  if (s === 'pm' || s === 'p' || s.startsWith('م')) return 'pm';
  return '';
}

// Guess AM/PM when only one side (or neither) says: "1-5pm" → both PM, "11-1pm" → 11 AM–1 PM,
// "from 2 to 4" → afternoon (nobody schedules classes at 2 AM), "8 to 11" → morning.
function resolveTimes(a, b) {
  let ma = a.mer;
  let mb = b ? b.mer : '';
  if (b) {
    if (!ma && mb) ma = (a.h < 12 && a.h > (b.h % 12) && mb === 'pm') ? 'am' : mb;
    if (!mb && ma) mb = (ma === 'am' && b.h < a.h) ? 'pm' : ma;
  }
  const guess = (h) => (h >= 1 && h <= 6 ? 'pm' : '');
  const start = to24(a.h, a.m, ma || (a.h < 12 ? guess(a.h) : ''));
  let end = b ? to24(b.h, b.m, mb || (b.h < 12 ? guess(b.h) : '')) : null;
  if (end !== null && end <= start && !mb && b.h < 12) end += 12 * 60; // "from 10 to 1" → 1 PM
  return { start, end };
}

export function parseEventText(input, { today, lang = 'en' } = {}) {
  const original = String(input || '').slice(0, 300);
  let text = original.replace(/[٠-٩]/g, (d) => AR_DIGITS[d]).replace(/[–—]/g, '-');
  const lower = text.toLowerCase();
  const consumed = [];
  // Matches, remembers (to strip from the title) and blanks out the text, so a date such as
  // 2026-10-30 can't later be read as the time "10-30".
  const take = (re) => {
    const m = re.exec(text);
    if (m) {
      consumed.push(m[0].trim());
      text = text.slice(0, m.index) + ' '.repeat(m[0].length) + text.slice(m.index + m[0].length);
    }
    return m;
  };

  const result = { title: '', type: null, days: [], date: null, start: null, end: null, missing: [] };

  // ---- Recurrence words ----
  const recurring = /\b(every|each|weekly|daily|weekdays|weekends)\b|كل\s|يوميًا|يوميا|أسبوعيًا|اسبوعيا/i.test(lower)
    || /\b(sundays|mondays|tuesdays|wednesdays|thursdays|fridays|saturdays)\b/i.test(lower);

  // ---- Days ----
  const days = new Set();
  let m;
  if (/\b(every ?day|daily)\b|كل يوم|يوميًا|يوميا/i.test(lower)) { [0, 1, 2, 3, 4, 5, 6].forEach((d) => days.add(d)); take(/\b(every ?day|daily)\b|كل يوم|يوميًا|يوميا/i); }
  if ((m = take(/\bweekdays\b|أيام الأسبوع/i))) (lang === 'ar' ? [0, 1, 2, 3, 4] : [1, 2, 3, 4, 5]).forEach((d) => days.add(d));
  if ((m = take(/\bweekends?\b|عطلة الأسبوع|نهاية الأسبوع/i))) (lang === 'ar' ? [5, 6] : [0, 6]).forEach((d) => days.add(d));
  // Ranges: "mon-fri", "monday to wednesday", "من الأحد إلى الخميس"
  const dayAlt = DAY_WORDS.flatMap(([, w]) => w).sort((a, b) => b.length - a.length).join('|');
  const rangeRe = new RegExp(`(?:من\\s+)?(${dayAlt})\\s*(?:-|to|through|thru|until|till|إلى|الى|حتى)\\s*(${dayAlt})(?![a-z])`, 'i');
  while ((m = rangeRe.exec(text))) {
    const a = dayIndex(m[1]);
    const b = dayIndex(m[2]);
    if (a >= 0 && b >= 0) for (let d = a; ; d = (d + 1) % 7) { days.add(d); if (d === b) break; }
    consumed.push(m[0].trim());
    text = text.replace(m[0], ' ');
  }
  const singleRe = new RegExp(`(^|[\\s,،/&]|و)(${dayAlt})(?![a-z\\u0600-\\u06FF])`, 'gi');
  while ((m = singleRe.exec(text))) {
    const d = dayIndex(m[2]);
    if (d >= 0) { days.add(d); consumed.push(m[2]); }
  }
  result.days = [...days].sort((a, b) => a - b);

  // ---- One-time dates ----
  if ((m = take(/\b(today)\b|اليوم/i))) result.date = today;
  else if ((m = take(/\b(tomorrow)\b|غدًا|غدا|بكرة/i))) result.date = addDays(today, 1);
  else if ((m = take(/\b(\d{4})-(\d{2})-(\d{2})\b/))) result.date = isDateStr(m[0]) ? m[0] : null;
  else if ((m = take(new RegExp(`\\b(${MONTHS.join('|')})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i')))) result.date = dateFrom(today, MONTHS.indexOf(m[1].toLowerCase().slice(0, 3)), Number(m[2]));
  else if ((m = take(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTHS.join('|')})[a-z]*\\b`, 'i')))) result.date = dateFrom(today, MONTHS.indexOf(m[2].toLowerCase().slice(0, 3)), Number(m[1]));

  // ---- Times ----
  const T = '(\\d{1,2})(?:[:.](\\d{2}))?\\s*(?:(a\\.m\\.|p\\.m\\.|am|pm|a|p|صباحًا|صباحا|مساءً|مساء|ص|م)(?![a-z\\u0621-\\u064A]))?';
  const rangeT = new RegExp(`(?:from|من)?\\s*(?<![\\d:])${T}\\s*(?:-|to|until|till|إلى|الى|حتى)\\s*${T}(?![\\d])`, 'i');
  const atT = new RegExp(`(?:at|@|الساعة|الساعه|عند)\\s*${T}(?![\\d])`, 'i');
  const bareT = /(?<![\d:])(\d{1,2})(?:[:.](\d{2}))?\s*(a\.m\.|p\.m\.|am|pm|صباحًا|صباحا|مساءً|مساء)(?![a-z])/i;
  const durRe = /(?:for\s+)?(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|ساعة|ساعات|دقيقة|دقائق)(?![a-z])|(ساعتين)/i;
  const part = (h, mm, mer) => ({ h: Number(h), m: mm ? Number(mm) : 0, mer: meridiem(mer) });
  const validHM = (p) => p.h <= 24 && p.m < 60;
  if ((m = take(rangeT))) {
    const a = part(m[1], m[2], m[3]);
    const b = part(m[4], m[5], m[6]);
    if (validHM(a) && validHM(b)) {
      const r = resolveTimes(a, b);
      result.start = fmt(r.start);
      result.end = fmt(r.end);
    }
  } else if ((m = take(atT)) || (m = take(bareT))) {
    const a = part(m[1], m[2], m[3]);
    if (validHM(a)) {
      const r = resolveTimes(a, null);
      result.start = fmt(r.start);
      const d = take(durRe);
      if (d) {
        const mins = d[3] ? 120 : (/^h|ساع/i.test(d[2]) ? Number(d[1]) * 60 : Number(d[1]));
        result.end = fmt(r.start + Math.round(mins));
      }
    }
  }

  // ---- Type ----
  if (result.date) result.type = 'once';
  else if (result.days.length && (recurring || result.days.length > 1)) result.type = 'weekly';
  else if (result.days.length === 1) {
    // "Gym on Saturday" without "every": treat as the next Saturday; the preview lets the user switch.
    result.type = 'once';
    const delta = (result.days[0] - dayOfWeek(today) + 7) % 7;
    result.date = addDays(today, delta);
  }

  // ---- Title: what's left once dates, times and filler words are removed ----
  let title = original.replace(/[٠-٩]/g, (d) => AR_DIGITS[d]).replace(/[–—]/g, '-');
  for (const c of consumed.sort((a, b) => b.length - a.length)) title = title.replace(c, ' ');
  title = title
    .replace(/\b(every|each|weekly|on|from|at|for|and|the|in|this|next)\b/gi, ' ')
    .replace(/(^|\s)(كل|في|من|إلى|الى|يوم|أيام|و)(?=\s|$)/g, ' ')
    .replace(/[,،&/@]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  result.title = title ? title.charAt(0).toUpperCase() + title.slice(1) : '';

  if (!result.title) result.missing.push('title');
  if (!result.type) result.missing.push('days');
  if (!result.start) result.missing.push('start');
  if (!result.end) result.missing.push('end');
  return result;
}

function dateFrom(today, month, day) {
  if (month < 0 || day < 1 || day > 31) return null;
  const year = Number(today.slice(0, 4));
  let candidate = `${year}-${pad(month + 1)}-${pad(day)}`;
  if (!isDateStr(candidate)) return null;
  if (candidate < today) candidate = `${year + 1}-${pad(month + 1)}-${pad(day)}`; // next occurrence
  return isDateStr(candidate) ? candidate : null;
}
