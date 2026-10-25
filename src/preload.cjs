// Narrow bridge between the sandboxed renderer and the main process.
const { contextBridge, ipcRenderer, webUtils, webFrame } = require('electron');

const INVOKE = new Set([
  'settings:get', 'settings:set', 'app:info', 'app:changelog', 'app:close-ready', 'app:close-cancel',
  'doc:open-dialog', 'doc:import-fdx', 'doc:read', 'doc:save', 'doc:save-dialog', 'doc:known', 'doc:forget', 'doc:rename', 'doc:exists',
  'dialog:folder', 'path:join', 'path:default-dir',
  'recovery:write', 'recovery:clear', 'recovery:list', 'recovery:read',
  'backup:create', 'backup:list', 'backup:delete', 'backup:prune', 'backup:read', 'backup:dir', 'backup:reveal',
  'stats:get', 'stats:add', 'stats:flush', 'stats:reset', 'e2e:close-window',
  'export:pdf', 'print:html', 'theme:apply', 'perf:report', 'perf:scratch', 'perf:cleanup','shell:reveal', 'app:pending-open', 'app:ready',
  'recent:list', 'recent:dismiss', 'recent:trash',
  'claude:key-status', 'claude:key-set', 'claude:key-clear', 'claude:key-test', 'claude:provider-set', 'review:start', 'review:cancel',
  'app:open-url', 'app:link-files', 'update:check', 'update:download', 'update:cancel', 'update:install', 'pointer:lock', 'win:fullscreen',
  'spell:list', 'spell:load', 'spell:check', 'spell:off', 'spell:install-offer', 'spell:install',
]);
const EVENTS = new Set(['app:before-close', 'app:open-file', 'perf:start', 'review:chunk', 'review:done', 'update:progress', 'app:fullscreen']);

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
  // A Mac's own spelling checker (Spelling, with "macOS (automatic)" chosen).
  misspelled: (word) => webFrame.isWordMisspelled(word),
  suggestions: (word) => webFrame.getWordSuggestions(word),
});
