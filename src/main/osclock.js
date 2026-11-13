// The operating system's own clock: how far its local time is from UTC right now, asked of the
// system itself instead of worked out by this runtime (core/stats.js, "the day", says why).
//
// Windows keeps it in the registry as ActiveTimeBias: the minutes to add to local time to get UTC,
// as the clock in the taskbar uses them, summer time included. Reading it is one short run of
// reg.exe (no window, a few milliseconds). Elsewhere the runtime's local time already is the
// system's, and null says so. No Electron here.

import { execFile } from 'node:child_process';
import path from 'node:path';

const KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\TimeZoneInformation';

/** "    ActiveTimeBias    REG_DWORD    0xffffffc4" → 60 (minutes east of UTC), or null. */
export function parseActiveBias(text) {
  const m = /ActiveTimeBias\s+REG_DWORD\s+0x([0-9a-f]{1,8})/i.exec(String(text || ''));
  if (!m) return null;
  const bias = parseInt(m[1], 16) | 0; // (a signed 32-bit number: minutes west of UTC)
  return Math.abs(bias) <= 16 * 60 ? 0 - bias : null;
}

/** The system's offset from UTC now, in minutes east; null where the runtime's own is the system's, or it can't be read. */
export function systemUtcOffset({ platform = process.platform, env = process.env, run = execFile } = {}) {
  if (platform !== 'win32') return Promise.resolve(null);
  if (env.STET_UTC_OFFSET != null && env.STET_UTC_OFFSET !== '') return Promise.resolve(Number(env.STET_UTC_OFFSET)); // tests
  const reg = path.join(env.SystemRoot || env.windir || 'C:\\Windows', 'System32', 'reg.exe');
  return new Promise((resolve) => {
    try {
      run(reg, ['query', KEY, '/v', 'ActiveTimeBias'], { windowsHide: true, timeout: 5000 }, (err, out) => resolve(err ? null : parseActiveBias(out)));
    } catch { resolve(null); }
  });
}

/**
 * Keep `apply(offset)` told of the system's offset: now (resolving once that answer is in) and
 * every few minutes after. Returns a function that asks again at once (the computer woke up).
 */
export async function followSystemClock(apply, { everyMs = 5 * 60000, read = systemUtcOffset } = {}) {
  const check = async () => apply(await read());
  await check();
  setInterval(check, everyMs).unref?.();
  return check;
}
