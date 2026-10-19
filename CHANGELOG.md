# Changelog

All notable changes to STET. Each version is one git commit, tagged `vX.Y.Z`.
Versions stay below 1.0 while the app is in beta.
Every version also gets a Windows build: `dist/STET-vX.Y.Z-win32-x64/STET.exe` (`npm run exe`).

## 0.4.0 — 2026-10-19 — English revision with Claude

### Added
- **English Revision** (Tools menu, REVISE in the toolbar, Ctrl+Shift+R): Claude (`claude-opus-5-5`) reviews action, dialogue and parentheticals and reports Grammar Errors, Non-Native Constructions and Awkward Phrasing. Each finding has the original, a minimal replacement, an explanation and a confidence level.
- The instructions protect the writer's voice: dialogue isn't formalised; slang, dialect and fragments are left alone; screenplay conventions aren't flagged; possibly deliberate choices are flagged cautiously or not at all; clean text gets no findings.
- Review panel grouped by category; flagged passages underlined in the script (one style per category); F7 / Shift+F7 navigate.
- Accept, Reject, Dismiss, **Ignore** (remembered in the screenplay's .stet file) and **+Dict** (a dictionary shared by every screenplay, editable under *Dictionary & Ignored…*). Accept all — per category or overall — asks for confirmation and is one undo step.
- Every finding is validated against the text it was made for. Edits during or after a review mark affected findings *outdated*; moved text is followed only when unambiguous; overlapping suggestions are never both applied; undo/redo of an accepted suggestion re-opens or re-accepts it.
- Long scripts are reviewed in scene-aligned sections with preceding text as context, three at a time. Rate limits are retried with backoff; failed sections can be retried; the review can be cancelled. Refusals, truncated answers and unreadable output are reported per section.
- The API key is stored encrypted (Windows DPAPI via Electron safeStorage) and used only in the main process, never in screenplay files. The script is sent only when you press Review, after a confirmation showing request count and approximate tokens; the title page and notes are never sent; Claude is never called automatically.
- Tests: 10 unit tests for the revision core and 6 end-to-end tests against a local mock of the Messages API.

### Changed
- No INT./EXT. prompt while typing a scene heading (location and time-of-day suggestions after the prefix remain).
- Ctrl+F toggles Find & Replace; Escape closes it from the find bar or the script.

## 0.3.1 — 2026-10-19 — the caret no longer covers your text

### Fixed
- **The blinking caret drifted into the text.** Script pages inherited the interface's `letter-spacing: .02em` (0.22 px), so Chromium drew every glyph 0.22 px wider than the caret, selection and click maths assumed. The error grew along the line: 1.8 px after 8 characters, 12.8 px after 58. It was the same at every zoom level and display scale.
- The caret is now drawn just after the glyph boundary instead of centred on it, so it never covers the previous character. It's snapped to whole device pixels so it stays crisp at 125 %, 150 % and 200 % display scaling.

### Changed — robust text metrics
- Glyph width is no longer assumed or taken from a canvas. It's measured in the DOM, on a hidden probe page that uses the page's own CSS, so anything that affects glyph placement (fonts, spacing, display scale, zoom) is what the caret, selection, highlights and click hit-testing use.
- It's re-measured on zoom, when the window moves to a monitor with a different scale, and when fonts finish loading.
- Script text is isolated from interface typography: no letter-spacing, word-spacing, kerning or ligatures on pages, title-page fields, the input field, suggestions or print-preview sheets.
- The caret's blink restarts without forcing a layout on every keystroke.

### Added
- `test/e2e/caret.e2e.js`: at display scales 1 and 1.5 and zooms 80 / 100 / 125 %, checks that the caret starts at the painted glyph edge (never over it), that selection edges match the glyphs, and that clicking any character puts the caret there. It fails on v0.3.0 and passes now.
- `bench/caret-drift.js`: measures caret vs glyph across 4 display scales × 3 zooms × 3 line lengths. Worst case went from 12.8 px to 0.02 px.

## 0.3.0 — 2026-10-19 — readability, theme schedule, responsiveness, icon

### Changed
- Dark mode is brighter: lighter page (#1e1e1e) and desk, brighter text at every level. Muted labels rose from about 2.9:1 to 5.2:1 contrast, and the four grey levels stay distinct.
- Light mode is slightly deeper: darker desk and bars, darker secondary text (muted labels about 2.6:1 → 4.3:1), stronger page edge.
- Highlight colours retuned for the new dark page (≥ 7.7:1 text contrast in dark, ≥ 14.9:1 in light).
- The theme toggle moved to the status bar: LIGHT · DARK · AUTO, active state inverted, always visible. Lower-priority status items hide first on narrow windows.

### Added
- Automatic theme schedule: dark-mode and light-mode start times picked with AM/PM controls (right-click AUTO, View → Theme Schedule…, or Preferences). Applies at launch and as soon as it's enabled, handles schedules that cross midnight, and re-checks every 15 s and on focus/wake, so clock and time-zone changes take effect. Picking LIGHT or DARK by hand turns the schedule off, so it never overrides a manual choice. Settings persist across restarts.
- Custom icon: a line of text, the typing caret, and the proofreader's stet dots ("let it stand"). Used for the window, the taskbar, the top-bar mark and the .exe, with pixel-grid versions for 16–32 px.
- Toolbar latency benchmark (`bench/toolbar-latency.js`) and the C/WebAssembly word-count experiment (`bench/native-experiment/`).
- Tests: 6 scheduler unit tests, a 4 000-case word-count fuzz test, and 5 end-to-end tests (toggle, pressed state, AUTO vs manual, time-zone change, persistence across restart).

### Faster
- Toolbar controls paint a pressed state at pointerdown. Panels and menus are fully visible on their first frame (a short motion nudge instead of a fade from transparent). Theme and panel toggles no longer repaint every page. Autosave no longer rewrites settings.json on every save.
- Word counting uses a table-driven state machine instead of a Unicode regex: 2.5× faster on English, 9.6× on Cyrillic. Opening a 456-page script went from 14.5 ms to 13.0 ms. A C kernel compiled to WebAssembly was built and benchmarked; it was not faster than the same algorithm in JavaScript, so it isn't shipped (docs/NATIVE.md).

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
