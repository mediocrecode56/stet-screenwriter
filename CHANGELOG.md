# Changelog

All notable changes to STET. Each version is one git commit, tagged `vX.Y.Z`.
Versions stay below 1.0 while the app is in beta.
Every version also gets a Windows build: `dist/STET-vX.Y.Z-win32-x64/STET.exe` (`npm run exe`).

## 0.2.1 — 2026-10-19 — an .exe for every version

### Added
- `npm run exe` builds a portable `STET.exe` for every tagged version into `dist/STET-vX.Y.Z-win32-x64/`, each from its own tag in a temporary git worktree (the working tree is untouched). Replaces `npm run package`.

## 0.2.0 — 2026-10-19 — verified, measured, packaged

### Fixed
- Tab at the end of written dialogue (or a cue) now starts a parenthetical on a new line instead of converting the dialogue itself; Tab mid-text or on an empty element still cycles the type.
- Opening a script that has unsaved changes left by a crash now offers to restore them first (the on-disk file is backed up before restoring). Previously, postponing recovery and then opening the script could let the first autosave discard those changes.
- A session only deletes recovery copies it wrote or restored itself.
- Find results refresh on a short debounce instead of re-searching synchronously on every keystroke.
- With side panels open, a page wider than the viewport is centred on the text column instead of clipped.
- Dialog number fields no longer stretch; checkboxes are monochrome.
- Print preview thumbnails are larger and readable.

### Added
- End-to-end test suite (`npm run e2e`) driving the real app over the DevTools protocol: element flow, shortcuts, autocomplete, capitalisation, highlights, notes, find, zoom, themes, save/autosave/reopen, backups, PDF export and recovery after a forced kill. Runs against a packaged build with `STET_E2E_EXE`.
- Unit/integration tests for the file container, serialization round-trips, atomic writes, save ordering, external-change detection, backups and retention, recovery, a kill-mid-save crash test, PDF structure, page ranges, plain-text interchange and statistics (54 total).
- Engine benchmarks (`npm run bench`) and an in-app performance probe (`npm run perf`, *Tools → Run Performance Probe*).
- `npm run package` builds a portable `dist/STET-win32-x64/STET.exe`.
- Documentation: architecture, file format, performance (with measured results), native-code decision.
- Dev flags: `--sample`, `--screenshot=<png>`, `--run=<command>`, `--hidden`, `--e2e`.

## 0.1.0 — 2026-10-19 — first working build

### Engine
- Semantic document model: immutable blocks (scene, action, character, parenthetical, dialogue, transition, shot) with highlight and comment marks.
- Character-grid layout (Courier 12pt = 10 cpi × 6 lpi): wrapping is arithmetic, cached per block by identity.
- Incremental pagination with resync; keep-with-next for headings/cues/parentheticals, widow/orphan control, (MORE)/(CONT'D) for split speeches.
- Undo/redo as invertible splice transactions, typing grouped by word.

### Editor
- Virtualised page view: only visible pages exist in the DOM; a keystroke repaints one page.
- Final Draft–style flow: Enter/Tab/Shift+Tab element transitions, Ctrl+1…7 element types, `(` starts a parenthetical, `int.` becomes a scene heading.
- Autocomplete for scene prefixes, locations, times of day, character names, extensions and transitions.
- First-appearance capitalisation of known character names in action (Capitalised words only, own undo step).
- Mouse selection (word/element on double/triple click), keyboard selection, structured copy/paste with Fountain-like plain-text fallback, IME support.
- Find & replace (case, whole word, replace all in one undo step).
- Zoom (Ctrl+wheel, Ctrl+=/−/0) anchored to the pointer or caret.

### Files
- `.stet` format: checksummed binary container + gzip JSON, schema versioning and migrations.
- Atomic writes with read-back verification; revision-guarded save queue; external-modification detection.
- Autosave (debounced), crash recovery snapshots, automatic backups every 5 minutes with 30-day retention that never deletes the last good copy.
- New-document setup (name, location, backup folder, interval, retention); open, recent, save as, rename, restore from backup.

### Pages & output
- Title page edited in place; empty fields are never printed.
- Print preview, PDF export (pure-JS writer, base-14 Courier, worker thread) and OS printing with page ranges, optional title page, highlights and notes.

### Interface
- Monochrome light and dark themes, compact menu bar, element bar, command palette (Ctrl+K), scene navigator, notes panel.
- Highlights (blue / yellow / pink) and comments with navigation.
- Writing goals: daily/weekly targets, net-new-word tracking, averages, streaks, 28-day chart.
