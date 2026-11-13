// What the two command-line helpers (claude-code.js, codex.js) share: seeing whether a file is
// there, and running one with its input on stdin, a time limit and a way to cancel. No Electron.

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';

export async function exists(p) { try { return (await fs.stat(p)).isFile(); } catch { return false; } }

/**
 * Run a CLI ({ path, node? }: a script is run with this app's own Node) and resolve with
 * { code, out, err, killedBy: null | 'cancelled' | 'timeout' }. `dropEnv` names environment
 * variables the CLI must not see. Rejects only when it cannot be started.
 */
export function runCli(cli, args, { cwd, input, signal, timeoutMs = 10 * 60 * 1000, dropEnv = [] } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    for (const k of dropEnv) delete env[k];
    const [cmd, argv] = cli.node ? [process.execPath, [cli.path, ...args]] : [cli.path, args];
    if (cli.node) env.ELECTRON_RUN_AS_NODE = '1';
    let child;
    try { child = spawn(cmd, argv, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) { reject(e); return; }
    let out = '', err = '', killedBy = null;
    const kill = (why) => { if (killedBy) return; killedBy = why; try { child.kill(); } catch { /* gone */ } };
    const onAbort = () => kill('cancelled');
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    const timer = setTimeout(() => kill('timeout'), timeoutMs);
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); };
    child.stdout.setEncoding('utf8').on('data', (d) => { out += d; });
    child.stderr.setEncoding('utf8').on('data', (d) => { err += d; });
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
    child.on('error', (e) => { done(); reject(e); });
    child.on('close', (code) => { done(); resolve({ code, out, err, killedBy }); });
  });
}

/** What a run that was stopped answers with, or null when it ran to its end. */
export function stopped(r, who) {
  if (r.killedBy === 'cancelled') return { ok: false, error: { code: 'cancelled', message: 'Cancelled.' } };
  if (r.killedBy === 'timeout') return { ok: false, error: { code: 'network', message: `${who} did not answer in time.` } };
  return null;
}
