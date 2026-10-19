# Changelog

All notable changes to STET. Each version is one git commit, tagged `vX.Y.Z`.
Versions stay below 1.0 while the app is in beta.

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
