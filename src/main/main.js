// Electron main process: window, app protocol, and all disk I/O on behalf of
// the renderer (which is sandboxed and never touches the filesystem).

import { app, BrowserWindow, ipcMain, dialog, protocol, net, nativeTheme, shell, Menu } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { JsonStore } from './store.js';
import { StatsStore } from './statsstore.js';
import { effectiveTheme, DEFAULT_SCHEDULE } from '../core/schedule.js';
import { ClaudeService } from './claude.js';
import {
  SaveQueue, Recovery, readDocument, isValidDocument, atomicWrite, cleanTemps,
  backupDirFor, createBackup, listBackups, pruneBackups, docBase,
} from './files.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'src');
const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));

const argv = process.argv.slice(1);
const flag = (name) => argv.find((a) => a === name || a.startsWith(name + '='));
const flagValue = (name) => { const f = flag(name); return f && f.includes('=') ? f.slice(name.length + 1) : null; };
const PERF = !!flag('--perf-probe');
const SHOT = flagValue('--screenshot');
const SAMPLE = !!flag('--sample');
const E2E = !!flag('--e2e');
const RUN = flagValue('--run'); // dev: run a command after startup (used for screenshots)
if (process.env.STET_USER_DATA) app.setPath('userData', path.resolve(process.env.STET_USER_DATA));

protocol.registerSchemesAsPrivileged([{ scheme: 'stet', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

if (!PERF && !SHOT && !E2E && !app.requestSingleInstanceLock()) app.quit();

let win = null;
let allowClose = false;
let closeAsked = 0;
let settings, stats, recovery, claude;
const queue = new SaveQueue();

const defaultDir = () => path.join(app.getPath('documents'), 'STET');

const THEME_BAR = {
  dark: { color: '#161616', symbolColor: '#f0f0ed', bg: '#0f0f0f' },
  light: { color: '#e9e9e6', symbolColor: '#000000', bg: '#d9d9d5' },
};

function resolvedTheme() {
  return effectiveTheme(settings.get(), new Date(), nativeTheme.shouldUseDarkColors);
}

function fileArg(args) {
  return args.find((a) => /\.stet$/i.test(a) && !a.startsWith('--'));
}

function createWindow() {
  const s = settings.get();
  const theme = resolvedTheme();
  const b = s.window || {};
  win = new BrowserWindow({
    width: b.width || 1280, height: b.height || 860, x: b.x, y: b.y,
    minWidth: 720, minHeight: 480,
    icon: path.join(ROOT, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    show: false,
    backgroundColor: THEME_BAR[theme].bg,
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? true : { color: THEME_BAR[theme].color, symbolColor: THEME_BAR[theme].symbolColor, height: 30 },
    webPreferences: {
      preload: path.join(SRC, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  win.loadURL('stet://app/renderer/index.html');
  // Shown only once the interface has painted, in one go. A maximized window is maximized here,
  // not at creation: on Windows maximize() shows a hidden window at once, so it used to appear
  // empty and then fill in (a jump on every start).
  win.once('ready-to-show', () => {
    if (SHOT || flag('--hidden')) return;
    if (b.maximized) win.maximize(); else win.show();
  });
  win.on('close', (e) => {
    saveBounds();
    if (allowClose) return;
    e.preventDefault();
    // If the renderer doesn't answer (hung), a second close request within 4s forces it.
    if (closeAsked && Date.now() - closeAsked > 4000) { allowClose = true; win.close(); return; }
    closeAsked = Date.now();
    win.webContents.send('app:before-close');
  });
  win.on('closed', () => { win = null; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('render-process-gone', (_e, d) => console.error('renderer gone', d));
  if (SHOT || PERF || process.env.STET_DEBUG) {
    win.webContents.on('console-message', (e) => console.log(`[renderer:${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})`));
  }
  if (SHOT) {
    win.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, Number(process.env.STET_SHOT_DELAY || 1500)));
      const img = await win.webContents.capturePage();
      await fs.writeFile(SHOT, img.toPNG());
      allowClose = true;
      app.quit();
    });
  }
}

function saveBounds() {
  if (!win || SHOT || PERF) return;
  const maximized = win.isMaximized();
  const bounds = maximized ? (settings.get().window || {}) : win.getBounds();
  settings.set({ window: { ...bounds, maximized } });
}

let probeDir = null; // the performance probe's scratch folder while it runs

function addRecent(file) {
  const s = settings.get();
  // Autosave calls this every few seconds: only touch settings.json when the list changes.
  if (s.recent && s.recent[0] && s.recent[0].path === file) return;
  const recent = (s.recent || []).filter((r) => r.path !== file);
  recent.unshift({ path: file, name: docBase(file), opened: Date.now() });
  settings.set({ recent: recent.slice(0, 12) });
  if (process.platform === 'win32' || process.platform === 'darwin') app.addRecentDocument(file);
}

function backupDirOf({ path: file, id, dir }) {
  return file ? backupDirFor(file, dir) : recovery.backupDir(id);
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => fn(...args));
}

function registerIpc() {
  handle('app:info', () => ({
    version: pkg.version, platform: process.platform, perf: PERF, shot: !!SHOT, sample: SAMPLE, e2e: E2E, run: RUN,
    defaultDir: defaultDir(), userData: app.getPath('userData'), electron: process.versions.electron,
  }));
  handle('app:changelog', () => fs.readFile(path.join(ROOT, 'CHANGELOG.md'), 'utf8').catch(() => ''));
  handle('app:close-ready', () => { allowClose = true; setImmediate(() => win && win.close()); });
  handle('app:close-cancel', () => { closeAsked = 0; });

  handle('settings:get', () => settings.get());
  handle('settings:set', (patch) => settings.set(patch));

  handle('path:default-dir', () => settings.get().defaultDir || defaultDir());
  handle('path:join', (...parts) => path.join(...parts));
  handle('dialog:folder', async (defaultPath) => {
    const r = await dialog.showOpenDialog(win, { defaultPath, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  handle('doc:open-dialog', async () => {
    const r = await dialog.showOpenDialog(win, {
      defaultPath: settings.get().defaultDir || defaultDir(),
      filters: [{ name: 'STET Screenplay', extensions: ['stet'] }, { name: 'All files', extensions: ['*'] }],
      properties: ['openFile'],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('doc:save-dialog', async ({ name, dir }) => {
    const r = await dialog.showSaveDialog(win, {
      defaultPath: path.join(dir || settings.get().defaultDir || defaultDir(), (name || 'Untitled') + '.stet'),
      filters: [{ name: 'STET Screenplay', extensions: ['stet'] }],
    });
    if (r.canceled || !r.filePath) return null;
    return /\.stet$/i.test(r.filePath) ? r.filePath : r.filePath + '.stet';
  });
  handle('doc:read', async (file) => {
    try {
      await cleanTemps(path.dirname(file));
      const r = await readDocument(file);
      queue.known(file, r.mtimeMs);
      addRecent(file);
      return { ok: true, ...r };
    } catch (e) {
      return { ok: false, code: e.code, error: e.code === 'ENOENT' ? 'The file no longer exists.' : e.message };
    }
  });
  handle('doc:save', async ({ path: file, rev, json, force }) => {
    const r = await queue.save(file, rev, json, { force });
    if (r.ok && !r.skipped && !(probeDir && path.dirname(file) === probeDir)) addRecent(file);
    return r;
  });
  handle('doc:known', (file, mtimeMs) => queue.known(file, mtimeMs));
  handle('doc:forget', (file) => queue.forget(file));
  handle('doc:exists', async (file) => { try { await fs.access(file); return true; } catch { return false; } });
  handle('doc:rename', async ({ path: file, name, backupDir }) => {
    const clean = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
    if (!clean) return { ok: false, error: 'Invalid name.' };
    const target = path.join(path.dirname(file), clean + '.stet');
    if (target === file) return { ok: true, path: file };
    try { await fs.access(target); return { ok: false, error: 'A file with that name already exists.' }; } catch { /* free */ }
    try {
      await fs.rename(file, target);
      const oldB = backupDirFor(file, backupDir), newB = backupDirFor(target, backupDir);
      let renamedBackups = false;
      try { await fs.access(newB); } catch {
        try { await fs.rename(oldB, newB); renamedBackups = true; } catch { /* no backups yet */ }
      }
      if (renamedBackups) {
        // Backup files carry the document name; rename them so they stay associated.
        for (const bk of await listBackups(newB)) {
          const nn = bk.name.replace(docBase(file), clean);
          if (nn !== bk.name) await fs.rename(bk.file, path.join(newB, nn)).catch(() => {});
        }
      }
      queue.forget(file);
      const st = await fs.stat(target);
      queue.known(target, st.mtimeMs);
      const s = settings.get();
      settings.set({ recent: (s.recent || []).map((r) => (r.path === file ? { ...r, path: target, name: clean } : r)) });
      return { ok: true, path: target };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  handle('recovery:write', ({ id, info, json }) => recovery.write(id, info, json).then(() => ({ ok: true }), (e) => ({ ok: false, error: e.message })));
  handle('recovery:clear', (id) => recovery.clear(id));
  handle('recovery:list', () => recovery.list());
  handle('recovery:read', async (file) => {
    try { return { ok: true, ...(await readDocument(file)) }; } catch (e) { return { ok: false, error: e.message }; }
  });

  handle('backup:dir', (ref) => backupDirOf(ref));
  handle('backup:create', async (ref) => {
    try {
      const dir = backupDirOf(ref);
      const base = ref.path ? docBase(ref.path) : 'Untitled';
      const file = await createBackup(dir, base, ref.json);
      return { ok: true, file };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  handle('backup:list', (ref) => listBackups(backupDirOf(ref)));
  handle('backup:prune', async (ref) => {
    const dir = backupDirOf(ref);
    const primaryValid = ref.path ? await isValidDocument(ref.path) : await isValidDocument(path.join(recovery.dir, ref.id + '.stet'));
    try { return { ok: true, removed: await pruneBackups(dir, ref.retentionDays, primaryValid) }; } catch (e) { return { ok: false, error: e.message }; }
  });
  handle('backup:read', async (file) => {
    try { return { ok: true, ...(await readDocument(file)) }; } catch (e) { return { ok: false, error: e.message }; }
  });
  handle('backup:reveal', async (ref) => {
    const dir = backupDirOf(ref);
    await fs.mkdir(dir, { recursive: true });
    return shell.openPath(dir);
  });
  handle('shell:reveal', (file) => shell.showItemInFolder(file));

  // Open Recent: dismissing only edits the list; trashing moves the file to the
  // system Recycle Bin / Trash (never a permanent delete) and then drops it from the list.
  const dropRecent = (file) => { const s = settings.get(); settings.set({ recent: (s.recent || []).filter((r) => r.path !== file) }); return settings.get().recent; };
  handle('recent:list', async () => {
    const list = settings.get().recent || [];
    return Promise.all(list.map(async (r) => ({ ...r, exists: await fs.stat(r.path).then((st) => st.isFile(), () => false) })));
  });
  handle('recent:dismiss', (file) => ({ ok: true, recent: dropRecent(file) }));
  handle('recent:trash', async (file) => {
    if (!(settings.get().recent || []).some((r) => r.path === file)) return { ok: false, error: 'That project is not in the recent list.' };
    try { if (!(await fs.stat(file)).isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOENT' }); } catch (e) {
      if (e.code === 'ENOENT') return { ok: false, missing: true, error: 'The file no longer exists, so there is nothing to move to the bin. It has been removed from the list.', recent: dropRecent(file) };
      return { ok: false, error: e.message };
    }
    try {
      const testBin = process.env.STET_TEST_TRASH_DIR; // tests only: stands in for the Recycle Bin
      if (testBin) await fs.rename(file, path.join(testBin, path.basename(file)));
      else await shell.trashItem(file);
    } catch (e) {
      return { ok: false, error: `Could not move it to the bin: ${e.message}` };
    }
    queue.forget(file);
    return { ok: true, recent: dropRecent(file) };
  });

  handle('claude:key-status', () => claude.keyStatus());
  handle('claude:key-set', (key) => claude.setKey(key));
  handle('claude:key-clear', () => claude.clearKey());
  handle('claude:key-test', () => claude.testKey());
  handle('claude:provider-set', (p) => claude.setProvider(p));
  handle('review:start', (req) => { claude.start(req); return true; });
  handle('review:cancel', (id) => claude.cancel(id));

  // Test driver only: close the window the way its X button does.
  handle('e2e:close-window', () => { if (E2E && win) setImmediate(() => win && win.close()); return E2E; });
  handle('stats:get', () => stats.state());
  handle('stats:add', (batch) => stats.add(batch));
  handle('stats:flush', () => stats.flush().then(() => true));
  handle('stats:reset', async () => {
    try { const r = await stats.reset(); return { ok: true, data: r.data }; } catch (e) { return { ok: false, error: e.message || String(e) }; }
  });

  // The renderer decides the theme (manual choice or schedule); main just matches the window chrome.
  handle('theme:apply', (resolved) => {
    const t = THEME_BAR[resolved === 'light' ? 'light' : 'dark'];
    if (win && process.platform !== 'darwin') { try { win.setTitleBarOverlay({ color: t.color, symbolColor: t.symbolColor, height: 30 }); } catch { /* unsupported */ } }
    if (win) win.setBackgroundColor(t.bg);
    return true;
  });

  handle('export:pdf', async ({ json, options, name, file }) => {
    let target = file;
    if (!target) {
      const r = await dialog.showSaveDialog(win, {
        defaultPath: path.join(settings.get().lastExportDir || settings.get().defaultDir || defaultDir(), (name || 'Screenplay') + '.pdf'),
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (r.canceled || !r.filePath) return { ok: false, canceled: true };
      target = r.filePath;
    }
    try {
      const t0 = performance.now();
      const bytes = await renderPdf(json, options);
      await atomicWrite(target, Buffer.from(bytes), { verify: (b) => { if (b.subarray(0, 5).toString() !== '%PDF-') throw new Error('PDF verification failed'); } });
      settings.set({ lastExportDir: path.dirname(target) });
      return { ok: true, file: target, ms: performance.now() - t0, bytes: bytes.byteLength };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  handle('print:html', async ({ html }) => {
    const tmp = path.join(os.tmpdir(), `stet-print-${process.pid}-${Date.now()}.html`);
    await fs.writeFile(tmp, html, 'utf8');
    const pw = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
    try {
      await pw.loadFile(tmp);
      return await new Promise((resolve) => {
        pw.webContents.print({ silent: false, printBackground: true, margins: { marginType: 'none' }, pageSize: 'Letter' }, (success, reason) => {
          resolve({ ok: success, error: success ? null : reason });
        });
      });
    } finally {
      pw.destroy();
      fs.rm(tmp, { force: true }).catch(() => {});
    }
  });

  // The performance probe saves into a scratch folder of its own, which never reaches Open Recent
  // and is deleted as soon as the probe ends.
  handle('perf:scratch', async () => {
    probeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stet-probe-'));
    return path.join(probeDir, 'probe.stet');
  });
  handle('perf:cleanup', async () => {
    if (!probeDir) return;
    const dir = probeDir;
    probeDir = null;
    queue.forget(path.join(dir, 'probe.stet'));
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  handle('perf:report', async (data) => {
    const dir = app.isPackaged ? path.join(app.getPath('userData'), 'perf') : path.join(ROOT, '.perf');
    await fs.mkdir(dir, { recursive: true });
    const out = path.join(dir, 'renderer-results.json');
    await fs.writeFile(out, JSON.stringify({ ...data, electron: process.versions.electron, chrome: process.versions.chrome, platform: `${os.type()} ${os.release()}`, cpu: os.cpus()[0]?.model, cores: os.cpus().length, memGB: Math.round(os.totalmem() / 2 ** 30) }, null, 2));
    if (PERF) { allowClose = true; setTimeout(() => app.quit(), 100); }
    return out;
  });
}

/** Generate a PDF on a worker thread so neither window nor main loop stalls. */
function renderPdf(json, options) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./pdf-worker.js', import.meta.url), { workerData: { json, options } });
    w.once('message', (m) => { m.ok ? resolve(m.bytes) : reject(new Error(m.error)); w.terminate(); });
    w.once('error', reject);
  });
}

app.on('second-instance', (_e, args) => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  const f = fileArg(args);
  if (f) win.webContents.send('app:open-file', f);
});

app.on('open-file', (e, file) => { // macOS
  e.preventDefault();
  if (win) win.webContents.send('app:open-file', file);
  else pendingOpen = file;
});
let pendingOpen = fileArg(argv);

if (process.platform === 'win32') app.setAppUserModelId('app.stet.screenwriting');

app.whenReady().then(async () => {
  const ud = app.getPath('userData');
  settings = new JsonStore(path.join(ud, 'settings.json'), {
    theme: 'dark', zoom: 1, defaultDir: null, recent: [], autosave: true, autosaveDelayMs: 1200,
    goals: { daily: 1000, weekly: 5000 }, schedule: DEFAULT_SCHEDULE, dictionary: [], reviewConsent: false, showTitlePage: true, panels: { scenes: false, notes: false },
  });
  stats = new StatsStore(ud);
  recovery = new Recovery(path.join(ud, 'recovery'));
  claude = new ClaudeService(ud, (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); });
  await fs.mkdir(recovery.dir, { recursive: true });

  protocol.handle('stet', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(SRC, decodeURIComponent(pathname)));
    if (!file.startsWith(SRC + path.sep)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });

  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
  } else {
    Menu.setApplicationMenu(null);
  }
  registerIpc();
  handle('app:pending-open', () => { const f = pendingOpen; pendingOpen = null; return f; });
  createWindow();
  if (PERF) win.webContents.once('did-finish-load', () => setTimeout(() => win.webContents.send('perf:start'), 800));
});

app.on('before-quit', () => { settings?.flush(); stats?.flush(); });
app.on('window-all-closed', async () => {
  await Promise.all([settings?.flush(), stats?.flush()]);
  app.quit();
});
