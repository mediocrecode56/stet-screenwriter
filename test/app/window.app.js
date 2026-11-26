// The window among others: switching away with Alt+Tab and back, as the writer does, through
// Windows itself (real key presses in WinTest's guest, another window to switch to). The script
// stays exactly where it was. Windows only: the keys and the window switcher are Windows'.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { App, scratch } from './harness.js';

const WIN = process.platform === 'win32';
let tmp, app, other;

// One PowerShell for the whole file (starting one and compiling the helper costs about a second):
// it runs each command line it is sent and answers with one line.
const USER32 = `using System; using System.Runtime.InteropServices; using System.Text; using System.Threading;
public static class K {
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder sb, int n);
  public static string Front() { var sb = new StringBuilder(256); GetWindowText(GetForegroundWindow(), sb, 256); return sb.ToString(); }
  static void Key(byte vk, byte scan, bool up) { keybd_event(vk, scan, up ? 2u : 0u, UIntPtr.Zero); }
  public static string AltTab(int tabs) { Key(0x12, 0x38, false); Thread.Sleep(80); for (int i = 0; i < tabs; i++) { Key(0x09, 0x0F, false); Thread.Sleep(40); Key(0x09, 0x0F, true); Thread.Sleep(80); } Key(0x12, 0x38, true); Thread.Sleep(150); return Front(); }
  public static string Minimize() { ShowWindow(GetForegroundWindow(), 6); Thread.Sleep(300); return Front(); }
  delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  // The first visible window whose title holds this text, brought to the front (a tap of Alt first: Windows lets
  // the program that sent the last input do that). Returns the title then in front.
  public static string Activate(string part) {
    IntPtr hit = IntPtr.Zero;
    EnumWindows((h, p) => { if (!IsWindowVisible(h)) return true; var sb = new StringBuilder(256); GetWindowText(h, sb, 256); if (sb.ToString().Contains(part)) { hit = h; return false; } return true; }, IntPtr.Zero);
    if (hit == IntPtr.Zero) return "";
    ShowWindow(hit, 9); Key(0x12, 0x38, false); Key(0x12, 0x38, true); SetForegroundWindow(hit); Thread.Sleep(150);
    return Front();
  }
}
`;
let shell;
function ps(line) {
  if (!shell) {
    shell = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], { stdio: ['pipe', 'pipe', 'ignore'] });
    shell.out = ''; shell.stdout.on('data', (d) => { shell.out += d; shell.wake?.(); });
    // (the helper in one line: a command read from stdin ends at its line's end)
    shell.stdin.write(`Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(USER32).toString('base64')}')))\r\n`);
  }
  const mark = '#' + Math.random().toString(36).slice(2);
  shell.stdin.write(`${line}; '${mark}'\r\n`);
  return new Promise((resolve) => {
    shell.wake = () => { const i = shell.out.indexOf(mark); if (i < 0) return; const r = shell.out.slice(0, i).trim().split('\n').at(-1)?.trim() || ''; shell.out = shell.out.slice(i + mark.length); resolve(r); };
    shell.wake();
  });
}
/** Real key presses through Windows: Alt held, Tab pressed (`tabs` times), Alt let go. Resolves the title of the window then in front. */
const altTab = (tabs = 1) => ps(`[K]::AltTab(${tabs})`);

before(async () => {
  if (!WIN) return;
  tmp = await scratch('stet-window');
  app = await App.launch({ userData: path.join(tmp, 'ud'), focus: true }); // (the window's real focus: it is what Alt+Tab moves)
  // A window to switch to (the guest has no Notepad): a plain form, which says when it is on screen.
  const shown = path.join(tmp, 'other-shown');
  other = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object Windows.Forms.Form; $f.Text = 'Other'; $f.Add_Shown({ Set-Content -LiteralPath '${shown}' 'x' }); [void]$f.ShowDialog()`], { stdio: 'ignore' });
  await app.until(async () => existsSync(shown), { what: 'the other window on screen', timeout: 15000 });
});
after(async () => { await app?.close(); for (const p of [other, shell]) try { p?.kill(); } catch { /* gone */ } });

// This test's own window, by its title (a STET window of another test file must not count).
const TITLE = 'Alt Tab Check';
/** The other window, then STET, put in front: the two last used, so one Alt+Tab goes from one to the other
 *  whatever else is open in the guest (other test files' windows are in Windows' list too). */
async function ready() {
  await ps("[K]::Activate('Other')");
  const front = await ps(`[K]::Activate('${TITLE}')`);
  assert.ok(front.includes(TITLE), `STET in front to begin with (${front})`);
  await app.until('document.hasFocus()', { what: 'STET focused', timeout: 3000 });
}
/** One real Alt+Tab, and STET is (or is no longer) the window in front, and its page knows it. (Windows'
 *  switcher now and then lets a press go while the other test files' windows are coming up: a switch that
 *  did not happen is pressed again, at most three times. What is checked, the script's place, never is.) */
async function switchTo(stet) {
  let front = '';
  for (let i = 0; i < 3; i++) {
    front = await altTab();
    if (stet ? front.includes(TITLE) : front === 'Other') return app.until(`document.hasFocus() === ${stet}`, { what: stet ? 'STET focused again' : 'STET in the background', timeout: 3000 });
    if (!stet) await ready(); // (the two in front again, in that order)
  }
  assert.fail(`Alt+Tab brought "${front}" to the front`);
}
const frames = async (n) => { for (let i = 0; i < n; i++) await app.frame(); };

test('Alt+Tab away and back leaves the script exactly where it was, wherever the caret is', { skip: !WIN && 'Windows only' }, async () => {
  const blocks = [];
  for (let i = 1; i <= 60; i++) blocks.push(['scene', `INT. ROOM ${i} - DAY`], ['action', `Mara crosses room ${i} and stops at the window.`]);
  await app.load(blocks, {}, TITLE);
  await app.send('Emulation.setFocusEmulationEnabled', { enabled: false }); // (the window's real focus, which Alt+Tab moves)
  // Every scroll STET makes, with where it came from.
  await app.eval(String.raw`(() => { const sc = __stet.view.scroller, d = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop'); window.__scrolls = [];
    Object.defineProperty(sc, 'scrollTop', { configurable: true, get() { return d.get.call(this); }, set(v) { window.__scrolls.push({ v, stack: new Error().stack.split('\n').slice(2, 6).map((l) => l.trim()).join(' < ') }); d.set.call(this, v); } }); })()`);
  const cases = [
    ['the caret on the first page, read on further down', { b: 1, o: 3 }, 'half', null],
    ['writing at the end, scrolled back up to read', { b: 119, o: 5 }, 'top', null],
    ['the same with the notes panel open', { b: 119, o: 5 }, 'top', 'Mod+Shift+\\'],
    ['the same in Focus Mode', { b: 119, o: 5 }, 'top', 'F11'],
    ['minimized, then back with Alt+Tab', { b: 119, o: 5 }, 'top', 'minimize'],
  ];
  for (const [what, caret, at, key] of cases) {
    const panel = key && key !== 'minimize';
    await ready();
    if (panel) { await app.key(key); await frames(30); }
    await app.eval(`(() => { __stet.editor.setSel(${JSON.stringify(caret)}); __stet.input.after(); const sc = __stet.view.scroller; __stet.view.stopGlide(); sc.scrollTop = ${at === 'top' ? 0 : 'Math.round(sc.scrollHeight / 2)'}; })()`);
    await frames(5);
    const top0 = await app.eval('__stet.view.scroller.scrollTop');
    await app.eval('window.__scrolls.length = 0');
    if (key === 'minimize') { await ps('[K]::Minimize()'); await app.until('!document.hasFocus()', { what: 'STET minimized', timeout: 3000 }); } else await switchTo(false);
    await switchTo(true);
    await frames(10); // (whatever follows the window coming back: a focus, a resize, a theme check)
    const top1 = await app.eval('__stet.view.scroller.scrollTop');
    assert.equal(top1, top0, `${what}: the script moved ${JSON.stringify(await app.eval('window.__scrolls'), null, 1).slice(0, 1500)}`);
    if (panel) { await app.key(key === 'F11' ? 'Escape' : key); await frames(30); }
  }
  // And typing afterwards still goes to the caret.
  await app.type('x');
  assert.equal((await app.blocks())[119][1].slice(0, 6), 'Mara x', 'typed at the caret');
});
