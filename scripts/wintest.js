// Runs STET's tests inside WinTest's hidden Windows Sandbox, so no test window ever opens on the
// owner's desktop (E:\CODING\WinTest). On a Mac, on Linux, in CI, or already inside the guest, the
// same command runs the tests right here.
//
//   node scripts/wintest.js quick            unit tests and the smoke test (before any push)
//   node scripts/wintest.js e2e              unit tests and every app test (before a version)
//   node scripts/wintest.js unit|smoke|app|web   one part (web: the browser version's tests)
//   node scripts/wintest.js app test/app/look.app.js [--test-name-pattern=fit]   chosen files
//   node scripts/wintest.js script scripts/mem.js [--type]   a script that drives the app (measurements, probes)
//
// What goes into the guest: src/, test/, scripts/ and package.json (copied again only when they
// changed), and the runtime they need from node_modules (Electron and the Anthropic SDK, copied
// once per Sandbox). The guest runs this same script with STET_WINTEST=1.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [mode = 'quick', ...rest] = process.argv.slice(2);
const files = rest.filter((a) => !a.startsWith('--'));
const flags = rest.filter((a) => a.startsWith('--'));

// (node --test options go before the files: after them they are taken as more files)
const UNIT = ['--test', '--test-isolation=none', '--test-timeout=30000', ...flags, 'test/unit/*.test.js'];
const SMOKE = ['--test', '--test-force-exit', ...flags, 'test/app/smoke*.app.js'];
const APP = (list, n = process.env.STET_TEST_CONCURRENCY || 4) => ['--test', '--test-force-exit', '--test-timeout=120000', `--test-concurrency=${n}`, ...flags, ...list];
// Lanes run side by side; the runs in a lane one after the other. The app tests' windows never take the
// focus (harness.js, `focus`), except smoke.app.js (pointer lock: no inactive window can take that from it)
// and window.app.js (Alt+Tab: it needs Windows' window list to itself, so it runs once the others are done).
const SOLO = ['test/app/smoke.app.js', 'test/app/window.app.js'];
const BACKGROUND = fs.readdirSync(path.join(ROOT, 'test', 'app')).filter((f) => f.endsWith('.app.js')).map((f) => `test/app/${f}`).filter((f) => !SOLO.includes(f));
const ALL_APP = [[APP(BACKGROUND), APP(['test/app/window.app.js'], 1)], [APP(['test/app/smoke.app.js'], 1)]];
const PLAN = {
  unit: [[UNIT]], smoke: [[SMOKE]], quick: [[UNIT], [SMOKE]], e2e: [[UNIT], ...ALL_APP], app: files.length ? [[APP(files)]] : ALL_APP,
  web: [[['--test', ...flags, 'web/test/*.test.js']]], // the browser version's own tests (web/README.md)
  script: [[rest]], // any script that drives the app (scripts/mem.js, a probe): node <file> <args>
};
if (!PLAN[mode]) { console.error(`unknown mode ${mode}: ${Object.keys(PLAN).join(', ')}`); process.exit(2); }


// The parts run side by side (the unit tests are CPU work, the app tests mostly wait on the app),
// each printed whole once it ends, so their reports never interleave.
async function runHere() {
  const one = PLAN[mode].length === 1 && PLAN[mode][0].length === 1;
  const run = (args) => new Promise((resolve) => {
    const t = Date.now(), out = [];
    const c = spawn(process.execPath, args, { cwd: ROOT, stdio: one ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
    c.stdout?.on('data', (d) => out.push(d)); c.stderr?.on('data', (d) => out.push(d));
    c.on('exit', (code) => {
      process.stdout.write(Buffer.concat(out));
      const what = args.filter((a) => !a.startsWith('--'));
      console.log(`# ${what.length > 2 ? `${what.length} files` : what.join(' ')}: exit ${code ?? 1} in ${((Date.now() - t) / 1000).toFixed(1)} s`);
      resolve(code ?? 1);
    });
  });
  const lane = async (runs) => { let worst = 0; for (const args of runs) { const code = await run(args); worst ||= code; } return worst; }; // (every run, even after a failure)
  return (await Promise.all(PLAN[mode].map(lane))).find((c) => c) || 0;
}

// ---- the host side ----

const WINTEST = process.env.WINTEST || 'E:\\CODING\\WinTest\\WinTest.ps1';
const RUNS = process.env.WINTEST_RUNS || 'E:\\WinTestRuns';
const DEV = path.join(RUNS, 'stet-dev'), RUNTIME = path.join(RUNS, 'stet-runtime');
const GUEST_NODE = 'C:\\WinApp\\work\\toolbox\\node\\node.exe';

function wintest(args, { timeoutSec } = {}) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', WINTEST, ...args], {
    encoding: 'utf8', env: { ...process.env, ...(timeoutSec ? { WINTEST_CALL_SEC: String(timeoutSec) } : {}) }, maxBuffer: 64 << 20,
  });
  return { code: r.status ?? 1, out: r.stdout || '', err: r.stderr || '' };
}
function must(what, r) {
  if (r.code) { console.error(`WinTest ${what} failed (exit ${r.code}):\n${r.out}${r.err}`); process.exit(r.code); }
  return r;
}
/** robocopy /MIR keeps each file's time, so a folder that did not change keeps its WinTest signature (no copy). */
function mirror(from, to, ...extra) {
  const r = spawnSync('robocopy.exe', [from, to, ...extra, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1'], { encoding: 'utf8' });
  if (r.status >= 8) throw new Error(`copying ${from} failed (robocopy ${r.status}): ${r.stdout}`);
}

/** The packages the app needs at run time (Electron's own dependencies only download it). */
function runtimePackages() {
  const seen = new Set(), todo = ['electron', ...Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).dependencies || {})];
  while (todo.length) {
    const name = todo.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    if (name === 'electron') continue;
    const pj = path.join(ROOT, 'node_modules', name, 'package.json');
    if (fs.existsSync(pj)) todo.push(...Object.keys(JSON.parse(fs.readFileSync(pj, 'utf8')).dependencies || {}));
  }
  return [...seen];
}

function stage() {
  fs.mkdirSync(DEV, { recursive: true });
  for (const d of ['src', 'test', 'scripts']) mirror(path.join(ROOT, d), path.join(DEV, d));
  mirror(path.join(ROOT, 'web'), path.join(DEV, 'web'), '/XD', 'dist', 'node_modules');
  const pj = path.join(ROOT, 'package.json'), to = path.join(DEV, 'package.json'), st = fs.statSync(pj);
  if (!fs.existsSync(to) || fs.statSync(to).mtimeMs !== st.mtimeMs) { fs.copyFileSync(pj, to); fs.utimesSync(to, st.atime, st.mtime); }
  const mods = path.join(RUNTIME, 'node_modules');
  for (const name of runtimePackages()) mirror(path.join(ROOT, 'node_modules', name), path.join(mods, name), '/XF', '*.d.ts', '*.map');
}

async function runInSandbox() {
  const t0 = Date.now(), step = (what) => console.log(`# wintest: ${what} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  stage(); step('staged');
  must('start', wintest(['start'])); step('sandbox ready');
  must('need node', wintest(['need', 'node']));
  const rt = JSON.parse(must('sync runtime', wintest(['sync', RUNTIME], { timeoutSec: 300 })).out.trim().split('\n').at(-1));
  const dev = JSON.parse(must('sync tests', wintest(['sync', DEV])).out.trim().split('\n').at(-1));
  step(`files in the guest (runtime ${rt.copied ? 'copied' : 'already there'}, tests ${dev.copied ? 'copied' : 'unchanged'})`);
  // node_modules in the test folder points at the runtime folder (a junction: rmdir on the next sync removes only the link).
  const cmd = [
    `cd /d ${dev.guestFolder}`,
    `(if not exist node_modules mklink /J node_modules ${rt.guestFolder}\\node_modules >nul)`,
    `set STET_WINTEST=1`,
    `${GUEST_NODE} scripts\\wintest.js ${[mode, ...(mode === 'script' ? rest : [...files, ...flags]).map((a) => (a.startsWith('--') ? a : a.replaceAll('/', '\\')))].join(' ')}`,
  ].join(' && ');
  const r = wintest(['exec', 'cmd.exe', '/c', cmd], { timeoutSec: 900 });
  process.stdout.write(r.out); process.stderr.write(r.err);
  step(`tests finished, exit ${r.code}`);
  return r.code;
}

const here = process.platform !== 'win32' || process.env.CI || process.env.STET_WINTEST;
process.exitCode = here ? await runHere() : await runInSandbox();
