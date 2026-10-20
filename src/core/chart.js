// Number formatting and the adaptive scale of the writing-week chart (pure, so
// it can be tested; drawn by ui/dialogs.js).

/** Word counts: exact with thousands separators; abbreviated only where room is short (axis labels, a million or more). */
export function fmtWords(n, short = false) {
  if (!short && n < 1e6) return n.toLocaleString();
  const [d, u] = n >= 1e6 ? [1e6, 'M'] : n >= 1e3 ? [1e3, 'k'] : [1, ''];
  const v = n / d;
  return (v >= 100 || d === 1 || Number.isInteger(v) ? Math.round(v) : Math.round(v * 10) / 10).toLocaleString() + u;
}

/** A round number at or above n for the top of the scale: 1, 2, 2.5 or 5 × a power of ten. */
export function niceTop(n) {
  if (n <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(n));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= n) return m * p;
  return 10 * p;
}

/**
 * The chart's scale adapts to the week: it runs to a round number just above
 * the highest day (or the goal, if higher), linear from zero, so bars compare
 * honestly. When one day dwarfs all the others (more than four times the
 * next highest and the goal), the scale is set by the others instead and that
 * day's bar is drawn full height with a break in it — its exact number is
 * printed on it as always — so the rest of the week stays readable. A day with
 * any words shows at least a sliver. `days` = [{ words, known, future }];
 * heights are in pixels out of `barH`.
 */
export function weekScale(days, goal, barH) {
  const vals = days.filter((d) => d.known && !d.future).map((d) => d.words).sort((a, b) => b - a);
  const max = vals[0] || 0, next = Math.max(vals[1] || 0, goal || 0);
  const breaks = next > 0 && max > 4 * next;
  const top = niceTop(breaks ? next * 1.25 : Math.max(max, goal || 0));
  const over = (n) => n > top;
  const px = (n) => (n <= 0 ? 0 : over(n) ? barH : Math.max(2, Math.round((n / top) * barH)));
  return { top, px, over };
}
