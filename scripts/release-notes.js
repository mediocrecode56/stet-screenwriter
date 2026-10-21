// Print one version's section of CHANGELOG.md, for the GitHub Release notes.
//
//   node scripts/release-notes.js v0.19.4
//
// Prints everything under "## 0.19.4 — …" up to the next "## " heading.
// Exits with an error if CHANGELOG.md has no section for that version.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = (process.argv[2] || '').replace(/^v/, '');
if (!version) { console.error('Usage: node scripts/release-notes.js vX.Y.Z'); process.exit(1); }

const lines = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8').split(/\r?\n/);
const start = lines.findIndex((l) => l.startsWith('## ') && l.slice(3).split(/\s/)[0] === version);
if (start < 0) { console.error(`CHANGELOG.md has no section for ${version}`); process.exit(1); }
let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
if (end < 0) end = lines.length;
process.stdout.write(lines.slice(start + 1, end).join('\n').trim() + '\n');
