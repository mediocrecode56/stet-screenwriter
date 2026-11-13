// A stand-in for the Codex CLI in tests: `login status` exits 0, and `exec` writes a findings
// answer to the -o file (or reports a usage limit when STET_FAKE_CODEX=limit).
import fs from 'node:fs';
const a = process.argv.slice(2);
if (a[0] === 'login') process.exit(0);
let input = '';
process.stdin.setEncoding('utf8').on('data', (d) => { input += d; }).on('end', () => {
  if (process.env.STET_FAKE_CODEX === 'limit') { process.stderr.write('ERROR: You have hit your usage limit.\n'); process.exit(1); }
  const out = a[a.indexOf('-o') + 1];
  if (!a.includes('--output-schema')) { fs.writeFileSync(out, 'Fake Codex says: a direction.'); return; } // (the guidelines' direction: plain words)
  const ok = a.includes('--output-schema') && a.includes('read-only') && input.includes('SYSTEM-TEXT');
  fs.writeFileSync(out, JSON.stringify({ findings: ok ? [{ element: 'e1', category: 'grammar', original: 'enter', replacement: 'enters', explanation: 'x', confidence: 'high' }] : [] }));
});
