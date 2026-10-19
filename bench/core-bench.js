// Core benchmarks (Node, high-resolution timers). `npm run bench`
// Measures the document engine without the UI: layout, pagination,
// editing, serialization, file container, PDF.

import os from 'node:os';
import zlib from 'node:zlib';
import { generateScript } from '../src/dev/sample.js';
import { newDocument, withText } from '../src/core/model.js';
import { paginate, mergeDirty, linesOf } from '../src/core/layout.js';
import { wrap } from '../src/core/format.js';
import { Editor, pos } from '../src/core/editor.js';
import { serialize, deserialize } from '../src/core/serialize.js';
import { encode, decode } from '../src/main/container.js';
import { buildPrintPages } from '../src/core/printmodel.js';
import { buildPdf } from '../src/core/pdf.js';

const now = () => Number(process.hrtime.bigint()) / 1e6;
function bench(fn, n) {
  const xs = [];
  for (let i = 0; i < Math.max(2, Math.ceil(n / 10)); i++) fn(); // warm-up
  for (let i = 0; i < n; i++) { const t = now(); fn(); xs.push(now() - t); }
  xs.sort((a, b) => a - b);
  return { p50: +xs[Math.floor(n / 2)].toFixed(4), p95: +xs[Math.floor(n * 0.95)].toFixed(4), max: +xs[n - 1].toFixed(4) };
}
async function abench(fn, n) {
  const xs = [];
  for (let i = 0; i < n; i++) { const t = now(); await fn(); xs.push(now() - t); }
  xs.sort((a, b) => a - b);
  return { p50: +xs[Math.floor(n / 2)].toFixed(3), p95: +xs[Math.floor(n * 0.95)].toFixed(3), max: +xs[n - 1].toFixed(3) };
}

const out = { node: process.version, cpu: os.cpus()[0].model, cores: os.cpus().length, platform: `${os.type()} ${os.release()}`, cases: {} };

for (const target of [120, 400]) {
  const doc = newDocument('BENCH');
  doc.blocks = generateScript(target, 5);
  const settings = doc.settings;
  const r = {};
  r.blocks = doc.blocks.length;

  // Cold layout: wrap every block (what opening a document costs).
  r.wrapAllCold = bench(() => { for (const b of doc.blocks) wrap(b.text, 60); }, 30);
  const pages = paginate(doc.blocks, settings);
  r.pages = pages.length;
  r.paginateWarm = bench(() => paginate(doc.blocks, settings), 50);

  // Incremental repagination after a one-block edit in the middle vs full.
  const blocks = doc.blocks.slice();
  let prev = paginate(blocks, settings);
  let i = 0;
  r.repaginateIncremental = bench(() => {
    const k = Math.floor(blocks.length / 2) + (i++ % 50);
    blocks[k] = withText(blocks[k], blocks[k].text + ' x');
    linesOf(blocks[k]);
    prev = paginate(blocks, settings, prev, mergeDirty(null, k, 1, 1));
  }, 200);

  // A keystroke through the editor engine (edit + undo bookkeeping + layout).
  const ed = new Editor(doc.blocks.slice());
  let bi = Math.floor(ed.blocks.length / 2);
  while (ed.blocks[bi].type !== 'action') bi++;
  ed.setSel(pos(bi, ed.blocks[bi].text.length));
  let pp = paginate(ed.blocks, settings);
  r.keystrokeEngine = bench(() => { ed.insertText('a'); pp = paginate(ed.blocks, settings, pp, ed.takeDirty()); }, 500);

  r.findAll = bench(() => ed.findAll('the'), 30);

  // Save path: serialize (renderer) + gzip/crc (main, async thread pool).
  r.serialize = bench(() => serialize(doc), 30);
  const json = serialize(doc);
  r.jsonKB = Math.round(json.length / 1024);
  r.encode = await abench(() => encode(json), 20);
  const buf = await encode(json);
  r.fileKB = Math.round(buf.length / 1024);
  // Open path: decode + parse + validate.
  r.decode = await abench(() => decode(buf), 20);
  r.deserialize = bench(() => deserialize(json), 20);

  // PDF (runs on a worker thread in the app).
  r.pdf = bench(() => buildPdf(buildPrintPages(doc, { titlePage: true }).pages, { deflate: (b) => zlib.deflateSync(b) }), 10);
  r.pdfKB = Math.round(buildPdf(buildPrintPages(doc, { titlePage: true }).pages, { deflate: (b) => zlib.deflateSync(b) }).length / 1024);

  out.cases[`${target}p`] = r;
}
console.log(JSON.stringify(out, null, 1));
