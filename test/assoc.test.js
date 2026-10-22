import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windowsCommands, userChoice, linkFiles, PROG_ID } from '../src/main/assoc.js';

const EXE = 'C:\\Users\\Ann\\STET\\STET.exe';

test('Windows: the same per-user keys as the installer, pointing at this STET.exe', () => {
  const cmds = windowsCommands(EXE);
  assert.deepEqual(cmds[0], ['add', 'HKCU\\Software\\Classes\\.stet', '/ve', '/t', 'REG_SZ', '/d', PROG_ID, '/f']);
  assert.deepEqual(cmds[1].slice(1, 4), ['HKCU\\Software\\Classes\\.stet\\OpenWithProgids', '/v', PROG_ID]);
  assert.equal(cmds[3][6], EXE + ',0');
  assert.deepEqual(cmds[4].slice(1, 3), ['HKCU\\Software\\Classes\\STET.Screenplay\\shell\\open\\command', '/ve']);
  assert.equal(cmds[4][6], `"${EXE}" "%1"`);
});

test('a choice made earlier in Windows is reported, not overridden', async () => {
  assert.equal(userChoice('\r\nHKEY_CURRENT_USER\\...\\UserChoice\r\n    ProgId    REG_SZ    Applications\\notepad.exe\r\n'), 'Applications\\notepad.exe');
  assert.equal(userChoice(''), '');
  const calls = [];
  const exec = async (file, args) => { calls.push([file, args]); return args[0] === 'query' ? '    ProgId    REG_SZ    Applications\\notepad.exe' : ''; };
  const r = await linkFiles({ platform: 'win32', exe: EXE, exec });
  assert.equal(r.ok, true);
  assert.match(r.message, /Open with/);
  assert.equal(calls.filter(([, a]) => a[0] === 'add').length, 5);
  const plain = await linkFiles({ platform: 'win32', exe: EXE, exec: async () => '' });
  assert.match(plain.message, /now opens it in STET/);
  const failed = await linkFiles({ platform: 'win32', exe: EXE, exec: async () => { throw new Error('denied'); } });
  assert.equal(failed.ok, false);
});

test('Mac: STET.app is registered again with Launch Services', async () => {
  const calls = [];
  const r = await linkFiles({ platform: 'darwin', exe: '/Applications/STET.app/Contents/MacOS/STET', exec: async (f, a) => { calls.push([f, a]); return ''; } });
  assert.equal(r.ok, true);
  assert.match(calls[0][0], /lsregister$/);
  assert.deepEqual(calls[0][1], ['-f', '/Applications/STET.app']);
  assert.equal((await linkFiles({ platform: 'darwin', exe: '/opt/electron/electron', exec: async () => '' })).ok, false);
  assert.equal((await linkFiles({ platform: 'linux', exe: '/x', exec: async () => '' })).ok, false);
});
