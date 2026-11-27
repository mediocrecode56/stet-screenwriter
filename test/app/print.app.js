// The print / export preview in the real app: the row of pages over the sheets (a click picks a page,
// a drag a run, ALL every page again; the Pages field always says the same), and the zoom (− and +,
// Ctrl+wheel), with the sheets drawn as they come into view.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { App, scratch, userData } from './harness.js';

let app;
before(async () => {
  await scratch('stet-print');
  app = await App.launch({ userData: await userData({}) });
  await app.until('!!__stet.session.doc');
});
after(() => app?.close());

const state = () => app.eval(`(() => {
  const d = document.querySelector('#overlay .preview');
  return { range: d.querySelector('.opts input[type=text]').value, on: [...d.querySelectorAll('.pv-cell:not(.pv-tp)')].map((c, i) => c.classList.contains('on') ? i + 1 : 0).filter(Boolean),
    sheets: d.querySelectorAll('.sheet[data-n]').length, title: !!d.querySelector('.sheet:not([data-n])'), drawn: d.querySelectorAll('.sheet .l').length > 0, zoom: d.querySelector('.pv-z').textContent, w: d.querySelector('.sheet')?.getBoundingClientRect().width };
})()`);
const cell = (n) => app.rect('#overlay .pv-cell:not(.pv-tp)', n - 1);
const settle = () => app.eval('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');

test('the row of pages picks what is printed, and the Pages field always says the same', async () => {
  const blocks = [['scene', 'INT. LONG CORRIDOR - NIGHT']];
  for (let i = 0; i < 260; i++) blocks.push(['action', `Step ${i + 1}. The lights hum along the corridor and somebody keeps walking.`]);
  await app.load(blocks);
  await app.eval('void __stet.cmd.run("print")');
  await app.until(`!!document.querySelector('#overlay .preview .sheet .l')`, { what: 'the preview drawn' });
  let s = await state();
  const total = s.on.length;
  assert.ok(total >= 10, `a long script (${total} pages), every page picked`);
  assert.equal(s.range, '');
  assert.equal(s.sheets, total, 'every page has its sheet (drawn as it comes into view)');
  assert.equal(s.title, true, 'and the title page its own');
  // A click picks only that page.
  let c = await cell(3);
  await app.click(c.x, c.y);
  await settle();
  s = await state();
  assert.deepEqual([s.range, s.on, s.sheets], ['3', [3], 1]);
  // A drag adds a run.
  const a = await cell(5), b = await cell(7);
  await app.drag(a.x, a.y, b.x, b.y);
  await settle();
  s = await state();
  assert.deepEqual([s.range, s.on], ['3, 5-7', [3, 5, 6, 7]]);
  // A click on a picked page leaves it out.
  c = await cell(6);
  await app.click(c.x, c.y);
  await settle();
  assert.equal((await state()).range, '3, 5, 7');
  // Typed in the field: the row follows.
  await app.eval(`(() => { const x = document.querySelector('#overlay .preview .opts input[type=text]'); x.value = '2-4'; x.dispatchEvent(new Event('input')); })()`);
  await settle();
  assert.deepEqual((await state()).on, [2, 3, 4]);
  // ALL: every page again.
  await app.clickOn('#overlay .pv-all');
  await settle();
  s = await state();
  assert.deepEqual([s.range, s.on.length], ['', total]);
});

test('the preview zooms with − and +, and with Ctrl+wheel over the sheets', async () => {
  let s = await state();
  assert.equal(s.zoom, '42%');
  const w0 = s.w;
  await app.clickOn('#overlay .pv-zb[aria-label="Zoom in"]');
  await settle();
  s = await state();
  assert.equal(s.zoom, '50%');
  assert.ok(s.w > w0 * 1.15, 'the sheets larger');
  const r = await app.rect('#overlay .preview .sheets');
  await app.down('Control');
  await app.wheel(r.x, r.y, -120);
  await app.up('Control');
  await app.until(`document.querySelector('#overlay .pv-z').textContent === '62%'`, { what: 'zoomed in by the wheel' });
  await app.until(`!!document.querySelector('#overlay .preview .sheet .l')`, { what: 'drawn again at the new size' });
  for (let i = 0; i < 12; i++) await app.clickOn('#overlay .pv-zb[aria-label="Zoom out"]');
  s = await state();
  assert.equal(s.zoom, '25%');
  assert.equal(await app.eval(`document.querySelector('#overlay .pv-zb[aria-label="Zoom out"]').disabled`), true, 'the smallest size: − is off');
  await app.until(`!!document.activeElement.closest('#overlay .dlg')`, { what: 'the keyboard still in the window after clicking it' });
  await app.key('Escape');
  await app.until('!document.querySelector("#overlay .dlg")');
});
