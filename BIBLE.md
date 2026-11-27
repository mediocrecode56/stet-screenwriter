# STET: bible

Last verified: 2026-11-27.

## What it is
Free screenplay editor for Windows and macOS (Electron). It formats as you type and saves as you go.

## Rules (never break)
- The owner decides when a release happens. Never raise `version` in `package.json` or push a tag unasked: a push to `main` that raises it publishes automatically (`.github/workflows/release.yml`).
- Tests must pass on Windows and macOS: no platform-specific paths in assertions. App tests wait with `app.until`, never a fixed sleep, and drive the app through `test/app/harness.js`.
- New behaviour gets a unit test in `test/unit`. A workflow a release must not break gets a step in `test/app/smoke.app.js`.
- Read `docs/DESIGN_DIRECTION.md` before UI work, and add the owner's direction to it.
- Fetch before release work. Local `main` can be behind `origin/main`: inspect the divergence before any fast-forward, and never reset or pull over local commits.

## Quirks
- Only the newest GitHub release is kept. Tags stay.
- A release needs all four assets: `STET-Windows.zip`, `STET-Setup.exe`, `STET-macOS.dmg`, `STET-Patch-electron-<version>.zip`. The Mac DMG can lag a release by design.

## Build and test
- All testing runs in WinTest's hidden Sandbox, never on the owner's desktop (owner, 2026-11-26). `scripts/wintest.js` copies the tests in (only what changed) and runs them there: `npm run quick` (unit and smoke, about 25 s warm) before any push, `npm run e2e` (everything, about 60 s warm) before a version, `npm run app -- test/app/x.app.js [--test-name-pattern=...]` for chosen files, `npm run web-test` for `web/`. `npm run startup`, `npm run perf` and `npm run mem` measure there too. On Windows the app tests refuse to start outside it (`test/app/harness.js`); `npm test` is the plain unit run CI uses. A packaged build: `E:\CODING\WinTest\WinTest.ps1 launch stet` (read its bible).
- In the guest every window is 1280 × 860 at 100% (emulated: the shared guest's screen changes), app windows open without taking the focus except `smoke.app.js` (pointer lock) and `window.app.js` (real Alt+Tab, run once the others are done), and Windows' animations are on (WinTest prepares it; a guest reporting reduced motion fails at launch). Time animations in the page (`app.frames()`, `app.animations()`, `app.metrics()`): WinTest's screen recorder sees about two changes a second.
- Other projects use the same guest and their windows may be open: rely on nothing in it (screen size, focus, the window list) that a test does not set up itself.

## Release
- Google Drive sync needs the repository secrets `STET_DRIVE_CLIENT` and `STET_DRIVE_SECRET`: the builds write them into the packaged app (`docs/DRIVE.md`). Never commit them; push protection refuses it.
- Version: `package.json` `version`. `CHANGELOG.md` needs a section for it (`scripts/release-notes.js`). The tag `vX.Y.Z` must equal it.
- Automatic: a push to `main` that raises the version, a pushed tag, or manual "Run workflow". The Windows job publishes; the Mac job adds the DMG when a runner is free. Watch the run; if it fails, fix the cause and push (each push retries).
- Publish: `mediocrecode56/stet-screenwriter`. The owner decides.
- Verify: all four assets are present and the notes match the CHANGELOG section.
- Page: the README's Download buttons link to `releases/latest/download/<fixed asset name>`, so asset names never change. CHANGELOG.md is newest first, with `## X.Y.Z · D Mon YYYY` headings and FEATURES / BUGS sections. A release's notes are that section: short lines for writers, nothing technical. The technical record of each version goes in `docs/CHANGELOG_INTERNAL.md`.
- Rollback: a new patch version. Never reuse a version number, move or delete tags.

## Browser (`web/`, ALPHA)
- Its own version (`web/package.json`), README and tests; it reads the shared core and renderer. The desktop never depends on `web/`: fix browser needs there, never with browser conditions in `src/`. Keep the separation tests passing.
- `build.mjs` copies the code its imports reach into `web/dist/` (not committed); no runtime install step.
- Tests: `npm run web-test` from the root (in WinTest); in `web/`, `npm run build`; `npm run serve` serves port 8127. Run its tests after any change to `src/core` or the shared renderer.
- Test saves and IndexedDB drafts with disposable documents only. Read `docs/CLOUD.md` before changing cloud storage.
- A push to `main` touching `web/` or shared files deploys GitHub Pages (`web.yml`), even without a version bump. Verify the reported URL with disposable `.stet` files (open, edit, save, cloud) apart from the Node tests. Rollback: revert and redeploy.

## Look here first
- Also: `.github/workflows/release.yml` (the release automation), `docs/DESIGN_DIRECTION.md` (design decisions), `docs/DRIVE.md` (Google Drive sync and its Google Cloud setup).
