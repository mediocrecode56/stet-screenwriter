// Word counting: old regex vs the shipped JS state machine vs the C kernel
// (WebAssembly). `node bench/native-experiment/bench.js`
import fs from 'node:fs';
import { generateScript } from '../../src/dev/sample.js';
import { countWords, WORD_RE } from '../../src/core/text.js';
import { initNative, countWordsBatch } from './native.js';

await initNative(fs.readFileSync(new URL('./stet_text.wasm', import.meta.url)));
const regex = (s) => { if (!s) return 0; let n = 0; const re = new RegExp(WORD_RE); while (re.exec(s) !== null) n++; return n; };
const t = (f, n = 40) => { for (let i = 0; i < 300; i++) f(); const xs = []; for (let i = 0; i < n; i++) { const s = performance.now(); f(); xs.push(performance.now() - s); } xs.sort((a, b) => a - b); return +xs[n >> 1].toFixed(3); };

const base = generateScript(400, 5).map((b) => b.text);
const es = { the: 'el', window: 'ventana', coffee: 'café', door: 'puerta', looks: 'mira', silence: 'silencio', her: 'su', his: 'él', street: 'calle', rain: 'lluvia', light: 'luz', city: 'ciudad', phone: 'teléfono', neon: 'neón', counter: 'mostrador', flickers: 'parpadea', idles: 'ralentí' };
const ru = { the: 'это', a: 'и', window: 'окно', coffee: 'кофе', door: 'дверь', looks: 'смотрит', rain: 'дождь', light: 'свет', city: 'город', street: 'улица', waits: 'ждёт', table: 'стол', hands: 'руки', phone: 'телефон', silence: 'тишина', slowly: 'медленно', her: 'её', his: 'его', car: 'машина', clock: 'часы' };
const tr = (m) => base.map((s) => s.replace(/[A-Za-z]+/g, (w) => m[w.toLowerCase()] ?? w));
const out = {};
for (const [k, texts] of Object.entries({ english: base, spanish: tr(es), russianMix: tr(ru) })) {
  const ref = texts.map(regex), js = texts.map(countWords), c = countWordsBatch(texts);
  if (ref.some((v, i) => v !== js[i] || v !== c[i])) throw new Error('mismatch in ' + k);
  out[k] = {
    elements: texts.length,
    'old regex (ms)': t(() => { for (const x of texts) regex(x); }),
    'JS state machine, shipped (ms)': t(() => { for (const x of texts) countWords(x); }),
    'C → WebAssembly incl. copy (ms)': t(() => countWordsBatch(texts)),
  };
}
console.table(out);
