// Narrow bridge between the sandboxed renderer and the main process.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const INVOKE = new Set([
  'settings:get', 'settings:set', 'app:info', 'app:changelog', 'app:close-ready', 'app:close-cancel',
  'doc:open-dialog', 'doc:read', 'doc:save', 'doc:save-dialog', 'doc:known', 'doc:forget', 'doc:rename', 'doc:exists',
  'dialog:folder', 'path:join', 'path:default-dir',
  'recovery:write', 'recovery:clear', 'recovery:list', 'recovery:read',
  'backup:create', 'backup:list', 'backup:prune', 'backup:read', 'backup:dir', 'backup:reveal',
  'stats:get', 'stats:set',
  'export:pdf', 'print:html', 'theme:apply', 'perf:report', 'shell:reveal', 'app:pending-open',
]);
const EVENTS = new Set(['app:before-close', 'app:open-file', 'perf:start']);

contextBridge.exposeInMainWorld('stet', {
  invoke(channel, ...args) {
    if (!INVOKE.has(channel)) return Promise.reject(new Error('blocked channel ' + channel));
    return ipcRenderer.invoke(channel, ...args);
  },
  on(channel, fn) {
    if (!EVENTS.has(channel)) throw new Error('blocked event ' + channel);
    ipcRenderer.on(channel, (_e, ...args) => fn(...args));
  },
  pathForFile(file) { return webUtils.getPathForFile(file); },
  platform: process.platform,
});
