// Stand-in for the Claude Code CLI in print mode (`claude -p --output-format json`), used
// by the E2E tests through STET_CLAUDE_CODE. It answers with the same "known mistakes"
// rules as the API mock and logs each invocation (args, cwd, stdin) to FAKE_CC_LOG.
// FAKE_CC_MODE: "" | "logged-out" (the review fails) | "auth-out" (`auth status` says so) | "slow" | "garbage".
import fs from 'node:fs';
import { elementsOf } from './mock-anthropic.js';

const RULES = [
  ['enter in the kitchen', 'enters the kitchen', 'grammar', 'high'],
  ['looking to him since five minutes', 'staring at him for five minutes', 'non_native', 'medium'],
  ['made a decision of leaving', 'decided to leave', 'awkward', 'medium'],
];

const argv = process.argv.slice(2);
if (argv[0] === 'auth' && argv[1] === 'status') { // the sign-in check: never the model
  process.stdout.write(JSON.stringify({ loggedIn: process.env.FAKE_CC_MODE !== 'auth-out', authMethod: 'claude.ai', email: 'someone@example.com' }, null, 2) + '\n');
  process.exit(0);
}

let stdin = '';
for await (const c of process.stdin) stdin += c;
const args = process.argv.slice(2);
const sp = args[args.indexOf('--system-prompt-file') + 1];
const log = process.env.FAKE_CC_LOG;
if (log) fs.appendFileSync(log, JSON.stringify({ args, cwd: process.cwd(), stdin, system: sp ? fs.readFileSync(sp, 'utf8') : null, apiKey: process.env.ANTHROPIC_API_KEY ?? null }) + '\n');

const mode = process.env.FAKE_CC_MODE || '';
const out = (o) => process.stdout.write(JSON.stringify({ type: 'result', usage: { input_tokens: 3, cache_creation_input_tokens: 900, cache_read_input_tokens: 0, output_tokens: 80 }, ...o }) + '\n');
if (mode === 'slow') await new Promise((r) => setTimeout(r, 30000));
if (mode === 'logged-out') { out({ subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' }); process.exit(1); }
if (mode === 'garbage') { process.stdout.write('panic: something broke\n'); process.exit(2); }

const findings = [];
for (const el of elementsOf(stdin)) {
  for (const [find, replacement, category, confidence] of RULES) {
    if (el.text.includes(find)) findings.push({ element: el.id, category, original: find, replacement, explanation: 'fake cli: ' + category, confidence });
  }
}
out({ subtype: 'success', is_error: false, result: JSON.stringify({ findings }), structured_output: { findings } });
