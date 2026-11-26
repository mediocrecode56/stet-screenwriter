// npm run startup [runs] [--sample]: where starting STET spends its time, a few starts in a row, in
// WinTest's guest (scripts/wintest.js). Each step as main.js and app.js mark it (STET_STARTUP_TRACE), in
// ms since the main process began; see docs/PERFORMANCE.md, "Startup".
import path from 'node:path';
import { App, scratch } from '../test/app/harness.js';

const runs = Number(process.argv[2] || 4);
const ud = path.join(await scratch('probe-start'), 'ud');
for (let i = 0; i < runs; i++) {
  const t0 = performance.now();
  const app = await App.launch({ userData: ud, env: { STET_STARTUP_TRACE: '1' }, args: process.argv.includes('--sample') ? ['--sample'] : [] });
  const up = performance.now() - t0;
  await app.until(`!document.documentElement.matches('.starting, .opening, .opened')`, { timeout: 5000 }).catch(() => {});
  const shown = performance.now() - t0;
  const lines = (app.child.err || '').split('\n').filter((l) => l.startsWith('[startup]'));
  console.log(`--- run ${i + 1}: started ${up.toFixed(0)} ms, faded in ${shown.toFixed(0)} ms after spawn`);
  for (const l of lines) console.log('   ' + l);
  await app.close();
}
