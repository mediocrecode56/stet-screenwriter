import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WheelZoom, stepZoom, panelScale } from '../../src/core/wheelzoom.js';

test('each wheel notch is exactly one 5-point step, in and out', () => {
  const w = new WheelZoom();
  let z = 1, t = 0;
  for (let i = 0; i < 5; i++) z = stepZoom(z, w.feed(-100, 0, (t += 500)));
  assert.equal(z, 1.25);
  for (let i = 0; i < 5; i++) z = stepZoom(z, w.feed(100, 0, (t += 500)));
  assert.equal(z, 1);
  z = stepZoom(z, w.feed(-3, 1, (t += 500))); // line mode
  assert.equal(z, 1.05);
});

test('fast spins and huge deltas never jump more than one step per event', () => {
  const w = new WheelZoom();
  let z = 1, t = 0;
  for (let i = 0; i < 10; i++) z = stepZoom(z, w.feed(-600, 0, (t += 8)));
  assert.equal(z, 1.5);
});

test('trackpad-sized deltas accumulate into whole steps; direction change discards residue', () => {
  const w = new WheelZoom();
  let z = 1, t = 0;
  for (let i = 0; i < 25; i++) z = stepZoom(z, w.feed(-4, 0, (t += 16))); // 100 px total
  assert.equal(z, 1.1);
  for (let i = 0; i < 10; i++) z = stepZoom(z, w.feed(-4, 0, (t += 16))); // 40 px pending
  z = stepZoom(z, w.feed(30, 0, (t += 16))); // reversed: residue dropped, 30 < step
  assert.equal(z, 1.1);
});

test('limits and exact 5-point steps are kept', () => {
  assert.equal(stepZoom(1.99, 1), 2);
  assert.equal(stepZoom(2, 1), 2);
  assert.equal(stepZoom(0.51, -1), 0.5);
  assert.equal(stepZoom(1.13, 1), 1.18);
  assert.equal(stepZoom(1, -1), 0.95);
  assert.equal(stepZoom(0.95, 1), 1);
});

test('the side panels follow a share of the zoom: notes and Revise half, scenes a tenth', () => {
  assert.equal(panelScale(1, 0.5), 1);
  assert.equal(panelScale(2, 0.5), 1.5);
  assert.equal(panelScale(2, 0.1), 1.1);
  assert.equal(panelScale(0.5, 0.5), 0.75);
  assert.equal(panelScale(1.25, 0.1), 1.025);
});
