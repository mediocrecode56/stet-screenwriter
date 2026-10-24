// When something happened, said the way a person would: the day it belongs to ("Today",
// "Yesterday", "Wed, Oct 22", with the year once it isn't this one) and how long ago ("just now",
// "12 min ago", "3 h ago", "5 days ago"). Used by File > Restore Backup.

const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** Whole calendar days from t to now (0: today, 1: yesterday). */
export function daysAgo(t, now = Date.now()) {
  return Math.round((startOfDay(now) - startOfDay(t)) / 86400000); // (rounded: a day with a clock change is 23 or 25 hours)
}

/** The day t belongs to, for a heading. */
export function dayLabel(t, now = Date.now()) {
  const n = daysAgo(t, now);
  if (n === 0) return 'Today';
  if (n === 1) return 'Yesterday';
  const d = new Date(t), sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** How long ago t was, short. */
export function ago(t, now = Date.now()) {
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const n = Math.max(1, daysAgo(t, now));
  return n === 1 ? '1 day ago' : `${n} days ago`;
}
