const BYDAY_MAP = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

function parseDateTime(value) {
  // formats: YYYYMMDD or YYYYMMDDTHHMMSS(Z)
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return {
    date: `${y}-${mo}-${d}`,
    time: h !== undefined ? `${h}:${mi}` : null,
  };
}

function parseVEvent(block) {
  const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
  const props = {};
  lines.forEach((line) => {
    const idx = line.indexOf(':');
    if (idx === -1) return;
    let key = line.slice(0, idx);
    const value = line.slice(idx + 1);
    key = key.split(';')[0].toUpperCase();
    props[key] = value;
  });

  const title = props.SUMMARY || 'Untitled event';
  const start = parseDateTime(props.DTSTART || '');
  const end = parseDateTime(props.DTEND || '');
  if (!start) return [];

  const startTime = start.time || '09:00';
  const endTime = (end && end.time) || addMinutes(startTime, 60);

  if (props.RRULE && /FREQ=WEEKLY/i.test(props.RRULE)) {
    const bydayMatch = props.RRULE.match(/BYDAY=([A-Z,]+)/i);
    const days = bydayMatch
      ? bydayMatch[1].split(',').map((d) => BYDAY_MAP[d.toUpperCase()]).filter((d) => d !== undefined)
      : [new Date(start.date + 'T00:00:00').getDay()];
    return days.map((dayOfWeek) => ({
      title,
      type: 'weekly',
      dayOfWeek,
      start: startTime,
      end: endTime,
      source: 'ics',
    }));
  }

  return [{
    title,
    type: 'once',
    date: start.date,
    start: startTime,
    end: endTime,
    source: 'ics',
  }];
}

function addMinutes(hhmm, minutes) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const nh = Math.floor((total % (24 * 60)) / 60);
  const nm = total % 60;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
}

export function parseIcs(text) {
  const unfolded = unfold(text);
  const blocks = unfolded.split(/BEGIN:VEVENT/i).slice(1);
  const events = [];
  blocks.forEach((raw) => {
    const block = raw.split(/END:VEVENT/i)[0];
    events.push(...parseVEvent(block));
  });
  return events;
}
