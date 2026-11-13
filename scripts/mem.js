// npm run mem: how much memory STET takes, process by process, with a feature-length script open and
// a real dictionary loaded (yours, from STET's own folder, when there is one). The figures come from
// Electron itself (app.getAppMetrics), so they read the same on Windows, macOS and Linux. "Committed"
// (Windows only) is the private memory each process has reserved, more than Task Manager's Memory
// column, which counts only the part in RAM. See docs/PERFORMANCE.md, "Memory".
//
//   npm run mem              start, wait for STET to settle, print, quit
//   npm run mem -- --type    and type for a while first (a long session in miniature)

import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { App, scratch, sleep } from '../test/app/harness.js';

const own = process.platform === 'win32' ? path.join(process.env.APPDATA || '', 'STET', 'dictionaries')
  : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'STET', 'dictionaries')
    : path.join(os.homedir(), '.config', 'STET', 'dictionaries');
const env = existsSync(own) ? { STET_DICT_DIRS: own, STET_DICT_ONLY: '1' } : {};

const app = await App.launch({ userData: await scratch('stet-mem'), args: ['--sample'], env });
try {
  await app.until('__stet.spelling.ready || !__stet.spelling.lang', { timeout: 15000, what: 'the dictionary' }).catch(() => {});
  if (process.argv.includes('--type')) {
    const b = await app.eval(`__stet.editor.blocks.findIndex((x) => x.type === 'action')`);
    await app.caret(b, 0);
    await app.type('She walsk to the windwo and looks out at the rain, waiting. '.repeat(20));
  }
  await sleep(4000); // (settled: the first paint, the spelling pass, the timeline)
  await app.send('HeapProfiler.collectGarbage');
  const m = await app.eval(`window.stet.invoke('e2e:memory')`);
  const heap = await app.eval('performance.memory.usedJSHeapSize');
  const mb = (kb) => (kb == null ? '      -' : (kb / 1024).toFixed(1).padStart(7));
  console.log(`dictionary: ${env.STET_DICT_DIRS ? 'yours (' + own + ')' : 'the tests\u2019 small one'}\n`);
  console.log('process                          working set   committed');
  let ws = 0, priv = 0;
  for (const p of m.processes) {
    console.log(`${(p.type + (p.service ? ' (' + p.service + ')' : '')).slice(0, 32).padEnd(32)} ${mb(p.workingSetKB)} MB  ${mb(p.privateKB)} MB`);
    ws += p.workingSetKB; priv += p.privateKB ?? 0;
  }
  console.log(`${'all of STET'.padEnd(32)} ${mb(ws)} MB  ${process.platform === 'win32' ? mb(priv) : '      -'} MB\n`);
  console.log(`JavaScript in use: main process ${(m.main.heapUsed / 2 ** 20).toFixed(1)} MB, window ${(heap / 2 ** 20).toFixed(1)} MB`);
} finally {
  await app.quit().catch(() => app.kill());
}
process.exit(0);
