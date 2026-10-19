// Caret vs rendered glyph position. For each display scale and zoom, types a
// line and reports how far the caret is from the right edge of the last glyph
// as Chromium actually painted it (DOM Range), at several column positions.
// `node bench/caret-drift.js`
import path from 'node:path';
import os from 'node:os';
import { App } from '../test/e2e/cdp.js';

export async function measureDrift(app) {
  return app.eval(`(() => {
    const out = [];
    const caret = document.getElementById('caret').getBoundingClientRect();
    const lines = [...document.querySelectorAll('.page .l')];
    const ed = __stet.editor, b = ed.block;
    // the caret's line is the last line div of the current block text
    const line = lines.filter(l => b.text.endsWith(l.textContent) && l.textContent.length).pop();
    if (!line) return null;
    const r = document.createRange(); const t = line.firstChild;
    r.setStart(t, t.length - 1); r.setEnd(t, t.length);
    const glyphRight = r.getBoundingClientRect().right;
    return { chars: t.length, caretLeft: +caret.left.toFixed(2), caretCenter: +(caret.left + caret.width / 2).toFixed(2), glyphRight: +glyphRight.toFixed(2), drift: +((caret.left + caret.width / 2) - glyphRight).toFixed(2), cw: +__stet.view.cw.toFixed(4), col: +__stet.view.col.toFixed(4) };
  })()`);
}

if (process.argv[1] && process.argv[1].endsWith('caret-drift.js')) {
  const res = [];
  for (const dpr of [1, 1.25, 1.5, 2]) {
    const app = await App.launch({ userData: path.join(os.tmpdir(), 'stet-drift-' + dpr), args: [`--force-device-scale-factor=${dpr}`], hidden: false });
    await app.eval('__stet.input.focus()');
    for (const z of [1, 1.1, 1.5]) {
      await app.eval(`__stet.view.setZoom(${z})`);
      await app.eval(`__stet.editor.setSel(__stet.editor.caret); __stet.editor.selectAll(); __stet.editor.backspace(); __stet.editor.setType('action'); __stet.input.after()`);
      for (const n of [8, 30, 58]) {
        await app.eval(`(() => { const ed = __stet.editor; ed.selectAll(); ed.backspace(); for (const ch of ${JSON.stringify('INT. COFFEE SHOP - NIGHT AND THE RAIN KEEPS FALLING ON THE ROOF'.slice(0, 58))}.slice(0, ${n})) ed.insertText(ch); __stet.input.after(true); })()`);
        await new Promise((r) => setTimeout(r, 60));
        const m = await measureDrift(app);
        res.push({ dpr, zoom: z, ...m });
      }
    }
    await app.close();
  }
  console.table(res);
}
