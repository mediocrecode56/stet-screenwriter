// npm run perf: the Performance Probe on a feature-length script, in WinTest's guest (scripts/wintest.js),
// never on the desktop. STET writes its results to .perf/renderer-results.json; they are printed here.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const out = path.join(ROOT, '.perf', 'renderer-results.json');
fs.rmSync(out, { force: true });
const code = await new Promise((resolve) => spawn(ELECTRON, [ROOT, '--perf-probe'], { stdio: 'inherit' }).on('exit', (c) => resolve(c ?? 1)));
if (!fs.existsSync(out)) { console.error('The probe gave no results.'); process.exit(code || 1); }
console.log(fs.readFileSync(out, 'utf8'));
