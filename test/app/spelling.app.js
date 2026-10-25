// Spelling on a computer with no dictionary: the one for its language is installed at once, in the
// background, with a notice when it is ready (no Install item to find in the menu) (here from a local server standing in for the
// internet, its first source down so the next is used), keeps it in its own folder, and spells with it
// at once, and again on the next start. Add a Language downloads another; the menu chooses between them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { App, scratch, ROOT } from './harness.js';

let tmp, app, server, base, hits = [];
before(async () => {
  tmp = await scratch('stet-spell');
  await fs.mkdir(path.join(tmp, 'none'));
  const fix = path.join(ROOT, 'test', 'fixtures', 'hunspell');
  server = http.createServer(async (req, res) => {
    hits.push(req.url);
    const m = /^\/good\/[\w-]+\.(aff|dic)$/.exec(req.url);
    if (!m) { res.writeHead(404).end('gone'); return; }
    res.writeHead(200).end(await fs.readFile(path.join(fix, 'en_US.' + m[1])));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const env = { STET_DICT_DIRS: path.join(tmp, 'none'), STET_DICT_ONLY: '1',
    STET_DICT_SOURCES: JSON.stringify([{ aff: base + '/down/{code}.aff', dic: base + '/down/{code}.dic' }, { aff: base + '/good/{code}.aff', dic: base + '/good/{code}.dic' }]) };
  app = await App.launch({ userData: path.join(tmp, 'ud'), env });
  app.env = env;
});
after(async () => { await app?.close(); server?.close(); });

async function menuRow(text) {
  const r = await app.eval(`(() => { const m = [...document.querySelectorAll('.menu .mi')].find((x) => !x.closest('[style*="pointer-events: none"]') && x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!m) return null; const b = m.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  assert.ok(r, 'a menu row ' + text);
  await app.click(r.x, r.y);
}

const settled = () => app.until(`!document.querySelector('.menu')`, { what: 'the last menu gone' }); // (one fading out still holds its rows)

test('no dictionary: one is installed at once in the background, a notice says when, spelling works at once', async () => {
  // In the background: the writer still writing meanwhile.
  await app.load([['action', 'Rain on teh glass.']]);
  assert.equal(await app.dialog(), '', 'no questions');
  await app.clickOn('#btn-spell');
  const labels = await app.eval(`[...document.querySelectorAll('.menu .mi')].map((x) => x.textContent)`);
  assert.ok(!labels.some((l) => /Install Dictionary/.test(l)), 'no Install item: ' + labels.join(' | '));
  await app.key('Escape');
  await app.type('Rain. ');
  await app.until('__stet.spelling.ready', { what: 'the dictionary installed and loaded' });
  await app.until(`/dictionary installed/.test(document.querySelector('.toast')?.textContent || '')`, { what: 'the notice' });
  assert.ok(hits.some((u) => u.startsWith('/down/')) && hits.some((u) => u.startsWith('/good/')), 'the next source when one is down');
  assert.equal(await app.eval(`document.getElementById('btn-spell').classList.contains('need')`), false);
  await app.until(`[...document.querySelectorAll('.spr')].length === 1`, { what: 'teh underlined' });
  const code = await app.eval('__stet.spelling.lang.code');
  assert.ok((await fs.readdir(path.join(tmp, 'ud', 'dictionaries', code))).includes(code + '.dic'), "kept in STET's own folder");
});

test('the installed dictionary is there on the next start, nothing downloaded again', async () => {
  await app.close();
  hits = [];
  app = await App.launch({ userData: path.join(tmp, 'ud'), env: app.env });
  await app.until('__stet.spelling.ready', { what: 'spelling ready on the next start' });
  assert.deepEqual(hits, []);
});

test('Add a Language: another one downloaded and chosen; the menu switches between them', async () => {
  const first = await app.eval('__stet.spelling.lang.id');
  await app.clickOn('#btn-spell');
  await app.until(`[...document.querySelectorAll('.menu .mi')].some((x) => x.textContent.startsWith('Add a Language'))`, { what: 'the spelling menu' });
  const row = await app.eval(`(() => { const m = [...document.querySelectorAll('.menu .mi')].find((x) => x.textContent.startsWith('Add a Language')); const b = m.getBoundingClientRect(); return { x: b.left + 20, y: b.top + b.height / 2 }; })()`);
  await app.move(row.x - 10, row.y); await app.move(row.x, row.y); // in from the side, as a hand would
  await app.until(`!!document.querySelector('.msub')`, { what: 'the languages' });
  const fr = await app.eval(`(() => { const m = [...document.querySelectorAll('.msub .mi')].find((x) => x.textContent === 'French (France)'); const b = m.getBoundingClientRect(); return { x: b.left + 20, y: b.top + b.height / 2 }; })()`);
  await app.move(fr.x - 40, fr.y); await app.move(fr.x, fr.y);
  await app.click(fr.x, fr.y);
  await app.until(`__stet.spelling.ready && __stet.spelling.lang.code === 'fr_FR'`, { what: 'French installed and chosen' });
  assert.match(await app.eval(`document.querySelector('.toast').textContent`), /French \(France\) dictionary installed/);
  // Both in the menu now; choosing the first goes back to it.
  await settled();
  await app.clickOn('#btn-spell');
  const labels = await app.eval(`[...document.querySelectorAll('.menu .mi')].map((x) => x.textContent)`);
  assert.ok(labels.includes('French (France)') && labels.includes('Add a Language'), labels.join(' | '));
  await menuRow(await app.eval(`__stet.spelling.list.find((d) => d.id === ${JSON.stringify(first)}).label`));
  await app.until(`__stet.spelling.ready && __stet.spelling.lang.id === ${JSON.stringify(first)}`, { what: 'back to the first' });
});
