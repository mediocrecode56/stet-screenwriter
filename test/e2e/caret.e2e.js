// Caret, selection and click positions must match where Chromium paints the
// glyphs — at every display scale and zoom. Regression test for the caret
// drifting into the text (v0.3.0: inherited letter-spacing).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { App } from './cdp.js';

const LINE = 'INT. COFFEE SHOP - NIGHT AND THE RAIN KEEPS FALLING ON IT';
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'stet-caret-'));
after(() => fs.rm(tmp, { recursive: true, force: true }).catch(() => {}));

// Glyph boundaries measured from the DOM vs the editor's own geometry.
const probe = (app) => app.eval(`(() => {
  const ed = __stet.editor, view = __stet.view;
  const line = [...document.querySelectorAll('.page .l')].find((l) => l.textContent === ed.block.text);
  const t = line.firstChild, r = document.createRange();
  const edge = (i) => { r.setStart(t, i); r.setEnd(t, i + 1); return r.getBoundingClientRect(); };
  const caret = document.getElementById('caret').getBoundingClientRect();
  // The caret starts at the glyph boundary (never over the glyph) and hugs it.
  const caretErr = caret.left - edge(t.length - 1).right;
  // Select chars [5, 20) and compare the selection rectangle with the glyphs.
  ed.setSel({ b: 0, o: 5 }, { b: 0, o: 20 }); view.frame();
  const sel = document.querySelector('.selr').getBoundingClientRect();
  const selErr = Math.max(Math.abs(sel.left - edge(5).left), Math.abs(sel.right - edge(19).right));
  // Hit-test: the centre of every glyph must map to that glyph's offset.
  let hitErrors = 0;
  for (let i = 0; i < t.length; i += 3) {
    const g = edge(i);
    const p = view.posAt(g.left + g.width * 0.25, g.top + g.height / 2);
    if (p.o !== i) hitErrors++;
  }
  ed.setSel({ b: 0, o: ed.block.text.length }); view.frame();
  return { caretErr, selErr, hitErrors };
})()`);

for (const dpr of [1, 1.5]) {
  test(`caret, selection and clicks align with glyphs at display scale ${dpr}`, async () => {
    const app = await App.launch({ userData: path.join(tmp, 'ud' + dpr), args: [`--force-device-scale-factor=${dpr}`] });
    try {
      await app.eval(`(() => { const ed = __stet.editor; ed.setType('action'); for (const ch of ${JSON.stringify(LINE)}) ed.insertText(ch); __stet.input.after(); })()`);
      for (const z of [1, 1.25, 0.8]) {
        await app.eval(`__stet.view.setZoom(${z})`);
        const m = await probe(app);
        assert.ok(m.caretErr >= -0.05, `zoom ${z}: caret overlaps the last glyph by ${(-m.caretErr).toFixed(2)}px`);
        assert.ok(m.caretErr < 1.01, `zoom ${z}: caret ${m.caretErr.toFixed(2)}px away from the text`);
        assert.ok(m.selErr < 0.75, `zoom ${z}: selection ${m.selErr.toFixed(2)}px off`);
        assert.equal(m.hitErrors, 0, `zoom ${z}: clicks landed on the wrong character`);
      }
    } finally {
      await app.close();
    }
  });
}
