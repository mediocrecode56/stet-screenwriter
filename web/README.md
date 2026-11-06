# STET in the browser (ALPHA)

An early browser version of STET: open, write and save `.stet` screenplays on any device, without
installing anything. It is a separate project from the desktop app, which does not depend on it.

## The boundary with the desktop app

- Everything for the browser lives in this folder. It has its own `package.json`, tests, deployment
  (`.github/workflows/web.yml`) and version. It has no dependencies.
- It **reads** the desktop's shared code and never changes it: `src/core/` (the document engine) and, from
  `src/renderer/`, the page view, input, menus, dialogs and `style.css`. `build.mjs` follows the imports
  from `src/app.js` and copies only what is reached.
- Nothing flows the other way. No file in `src/` imports from here, `web/` is left out of the packaged
  app (`APP_IGNORE`), and no cloud address appears in `src/`. The only link is **Tools > Open STET in
  the Browser**, which opens this site in the writer's own browser. `test/separation.test.js` fails if
  any of that stops being true.
- If a change to shared desktop code breaks the browser version, the fix belongs here. Do not add
  browser conditions to desktop files.

## Working on it

```bash
cd web
npm test          # no browser needed; includes reading and writing files with the desktop's own code
npm run serve     # builds and serves http://localhost:8127
```

Add `#test` to the address to get `window.__stet` for checks in the browser console.

## What is here

| file | what it does |
|---|---|
| `src/app.js` | composition root: wires the desktop's editor and view to the files below |
| `src/container.js` | the `.stet` container with browser APIs, byte-compatible with `src/main/container.js` |
| `src/document.js` | a document to and from file bytes; `.fdx` import |
| `src/saving.js` | what is saved where, one write at a time, never overwriting a change from elsewhere |
| `src/drafts.js` | every change kept in IndexedDB until it reaches its file |
| `src/device.js` | files on this device, and through it iCloud Drive |
| `src/drive.js`, `src/google.js` | Google Drive: REST calls, and sign-in with the picker |
| `src/fit.js` | how the page sits on a narrow screen |

Read next: [what is missing and why](docs/BROWSER_GAPS.md), [iCloud and Google Drive](docs/CLOUD.md).
Design follows `docs/DESIGN_DIRECTION.md` at the repository's root.
