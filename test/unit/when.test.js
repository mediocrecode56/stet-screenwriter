// How File > Restore Backup says when a backup was made (core/when.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayLabel, ago, daysAgo, restoredName } from '../../src/core/when.js';

const now = new Date(2026, 9, 24, 18, 30).getTime();
const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime();

test('the day a backup belongs to: today, yesterday, then the date (with the year once it is another)', () => {
  assert.equal(dayLabel(at(24, 0, 1), now), 'Today');
  assert.equal(dayLabel(at(23, 23, 59), now), 'Yesterday');
  assert.equal(dayLabel(at(22, 12), now), new Date(at(22, 12)).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }));
  assert.match(dayLabel(new Date(2025, 5, 1).getTime(), now), /2025/);
  // A day with a clock change (25 October 2026 in Europe) is still one day.
  assert.equal(daysAgo(new Date(2026, 9, 25, 12).getTime(), new Date(2026, 9, 26, 12).getTime()), 1);
});

test('how long ago, short', () => {
  assert.equal(ago(now - 20e3, now), 'just now');
  assert.equal(ago(now - 12 * 60e3, now), '12 min ago');
  assert.equal(ago(now - 3 * 3600e3, now), '3 h ago');
  assert.equal(ago(at(23, 12), now), '1 day ago');
  assert.equal(ago(at(19, 12), now), '5 days ago');
  assert.equal(ago(now + 5000, now), 'just now', 'a clock a moment behind');
});

test('a restored backup is offered under the screenplay\'s name and the backup\'s time, safe for a file name', () => {
  assert.equal(restoredName('Heist', new Date(2026, 9, 5, 9, 7).getTime()), 'Heist 2026-10-05 0907');
  assert.equal(restoredName('', at(24, 14, 30)), 'Untitled 2026-10-24 1430');
  assert.doesNotMatch(restoredName('Heist', now), /[<>:"/\|?*]/);
});
