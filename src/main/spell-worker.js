// Worker thread: one Hunspell dictionary, read with the encoding its .aff names, and words checked against it.
import { parentPort } from 'node:worker_threads';
import fs from 'node:fs/promises';
import { Speller } from '../core/spell.js';

let speller = null;

const decode = (buf, enc) => { try { return new TextDecoder(enc || 'utf-8').decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); } };

async function load(base) {
  const affBuf = await fs.readFile(base + '.aff'), dicBuf = await fs.readFile(base + '.dic');
  const enc = /^SET\s+(\S+)/m.exec(affBuf.toString('latin1'))?.[1];
  speller = new Speller(decode(affBuf, enc), decode(dicBuf, enc));
  return speller.words.size;
}

parentPort.on('message', async ({ id, op, arg }) => {
  try {
    let value;
    if (op === 'load') value = await load(arg);
    else if (op === 'check') { value = {}; for (const w of arg) value[w] = speller ? speller.check(w) : null; }
    parentPort.postMessage({ id, ok: true, value });
  } catch (e) {
    parentPort.postMessage({ id, ok: false, error: e.message });
  }
});
