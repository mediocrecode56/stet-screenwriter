import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduledTheme, effectiveTheme, toAmPm, fromAmPm, label, parseTime } from '../src/core/schedule.js';

const at = (h, m = 0) => new Date(2026, 9, 19, h, m);

test('schedule crossing midnight (dark 7 PM -> light 7 AM)', () => {
  const s = { enabled: true, darkAt: '19:00', lightAt: '07:00' };
  assert.equal(scheduledTheme(s, at(18, 59)), 'light');
  assert.equal(scheduledTheme(s, at(19, 0)), 'dark');
  assert.equal(scheduledTheme(s, at(23, 59)), 'dark');
  assert.equal(scheduledTheme(s, at(0, 0)), 'dark');
  assert.equal(scheduledTheme(s, at(6, 59)), 'dark');
  assert.equal(scheduledTheme(s, at(7, 0)), 'light');
  assert.equal(scheduledTheme(s, at(12, 0)), 'light');
});

test('schedule within one day (dark 1 AM -> light 9 AM)', () => {
  const s = { enabled: true, darkAt: '01:00', lightAt: '09:00' };
  assert.equal(scheduledTheme(s, at(0, 30)), 'light');
  assert.equal(scheduledTheme(s, at(1, 0)), 'dark');
  assert.equal(scheduledTheme(s, at(8, 59)), 'dark');
  assert.equal(scheduledTheme(s, at(9, 0)), 'light');
});

test('degenerate schedules fall back to light', () => {
  assert.equal(scheduledTheme({ darkAt: '08:00', lightAt: '08:00' }, at(3)), 'light');
  assert.equal(scheduledTheme({ darkAt: 'nope', lightAt: '08:00' }, at(3)), 'light');
  assert.equal(parseTime('24:00'), null);
});

test('manual choice stands when scheduling is off', () => {
  const settings = { theme: 'light', schedule: { enabled: false, darkAt: '00:00', lightAt: '23:59' } };
  for (const h of [0, 6, 12, 23]) assert.equal(effectiveTheme(settings, at(h)), 'light');
  settings.schedule.enabled = true;
  assert.equal(effectiveTheme(settings, at(6)), 'dark');
  assert.equal(effectiveTheme({ theme: 'system' }, at(6), false), 'light');
});

test('AM/PM conversion round-trips every minute of the day', () => {
  for (let m = 0; m < 1440; m++) {
    const { hour, minute, ampm } = toAmPm(m);
    assert.ok(hour >= 1 && hour <= 12);
    assert.equal(fromAmPm(hour, minute, ampm), m);
  }
  assert.equal(label('00:05'), '12:05 AM');
  assert.equal(label('12:00'), '12:00 PM');
  assert.equal(label('19:30'), '7:30 PM');
});
