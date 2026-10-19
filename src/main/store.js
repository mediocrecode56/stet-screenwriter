// Small JSON stores (settings, writing statistics) with atomic, coalesced writes.

import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { atomicWrite } from './files.js';

export class JsonStore {
  constructor(file, defaults) {
    this.file = file;
    this.data = structuredClone(defaults);
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8'));
      if (raw && typeof raw === 'object') this.data = deepMerge(this.data, raw);
    } catch (e) {
      if (e.code !== 'ENOENT') {
        // Keep the unreadable file for inspection instead of overwriting it.
        fs.rename(file, file + '.corrupt-' + Date.now()).catch(() => {});
      }
    }
    this.timer = null;
    this.writing = Promise.resolve();
  }

  get() { return this.data; }

  set(patch) {
    this.data = deepMerge(this.data, patch);
    this.schedule();
    return this.data;
  }

  replace(data) { this.data = data; this.schedule(); }

  schedule(delay = 400) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), delay);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    const snapshot = JSON.stringify(this.data, null, 1);
    this.writing = this.writing.then(() => atomicWrite(this.file, Buffer.from(snapshot), { verify: (b) => JSON.parse(b.toString('utf8')) })).catch((e) => console.error('store write failed', this.file, e));
    return this.writing;
  }
}

function deepMerge(a, b) {
  if (Array.isArray(b) || typeof b !== 'object' || b === null) return b;
  const out = { ...(typeof a === 'object' && a && !Array.isArray(a) ? a : {}) };
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(out[k], v) : v;
  return out;
}
