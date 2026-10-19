// Automatic light/dark schedule. Times are "HH:MM" (24h) in the OS's local
// time; the UI presents them as AM/PM. Pure functions — the caller polls them,
// so system clock and time-zone changes are picked up on the next check.

export const DEFAULT_SCHEDULE = { enabled: false, darkAt: '19:00', lightAt: '07:00' };

export function parseTime(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s || '');
  if (!m) return null;
  const h = +m[1], min = +m[2];
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function formatTime(minutes) {
  const h = Math.floor(minutes / 60) % 24, m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 24h minutes -> { hour 1–12, minute, ampm } */
export function toAmPm(minutes) {
  const h = Math.floor(minutes / 60) % 24;
  return { hour: h % 12 === 0 ? 12 : h % 12, minute: minutes % 60, ampm: h < 12 ? 'AM' : 'PM' };
}

export function fromAmPm(hour, minute, ampm) {
  const h = (hour % 12) + (ampm === 'PM' ? 12 : 0);
  return h * 60 + minute;
}

export function label(hhmm) {
  const t = parseTime(hhmm);
  if (t == null) return '?';
  const { hour, minute, ampm } = toAmPm(t);
  return `${hour}:${String(minute).padStart(2, '0')} ${ampm}`;
}

/**
 * Theme the schedule calls for at `now`. Dark runs from darkAt up to lightAt,
 * wrapping past midnight when darkAt is later in the day than lightAt.
 * Identical times are treated as "always light".
 */
export function scheduledTheme(schedule, now = new Date()) {
  const d = parseTime(schedule.darkAt), l = parseTime(schedule.lightAt);
  if (d == null || l == null || d === l) return 'light';
  const m = now.getHours() * 60 + now.getMinutes();
  const dark = d < l ? m >= d && m < l : m >= d || m < l;
  return dark ? 'dark' : 'light';
}

/** Minutes from `now` until the next scheduled switch (1…1440). */
export function minutesToNextSwitch(schedule, now = new Date()) {
  const d = parseTime(schedule.darkAt), l = parseTime(schedule.lightAt);
  if (d == null || l == null || d === l) return 1440;
  const m = now.getHours() * 60 + now.getMinutes();
  const until = (t) => ((t - m + 1440) % 1440) || 1440;
  return Math.min(until(d), until(l));
}

/**
 * The theme to show. With scheduling on, the schedule decides; with it off,
 * the user's manual choice stands and is never changed by the clock.
 */
export function effectiveTheme(settings, now = new Date(), systemDark = true) {
  const s = settings.schedule;
  if (s && s.enabled) return scheduledTheme(s, now);
  const t = settings.theme;
  if (t === 'system') return systemDark ? 'dark' : 'light';
  return t === 'light' ? 'light' : 'dark';
}
