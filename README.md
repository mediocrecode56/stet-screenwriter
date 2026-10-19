# STET

*stet* (Latin, "let it stand") — a fast, minimal, dependable screenwriting
application. Monochrome, typographic, deliberately beta in look; strict about
formatting and about never losing your work.

Version 0.5.0 β.

## Run it

Requirements: **Node.js 20+** (tested with 24.18) and npm. Nothing else — no
compiler, no native modules. Windows is the primary target; macOS/Linux run
from source as well.

```bash
npm install
```

```bash
npm start
```

If `npm install` skipped Electron's download (npm 11 can block install
scripts), fetch the binary once:

```bash
node node_modules/electron/install.js
```

### Get a Windows .exe (no Electron knowledge needed)

```bash
npm run exe
```

builds every released version that isn't built yet into
`dist/STET-vX.Y.Z-win32-x64/STET.exe` — double-click it, nothing to install.
Each version is built from its own git tag, so old versions stay runnable.
`npm run exe -- v0.2.0` rebuilds one version; `npm run exe -- --all` rebuilds all.

### Tests and measurements

| command | what it does |
|---|---|
| `npm test` | 71 unit/integration tests: formatting, pagination (incl. randomised incremental-vs-full), editing, undo, serialization round-trips, container corruption, atomic writes, save ordering, external-change detection, backups & retention, recovery, a kill-mid-save crash test, PDF structure, page ranges, statistics, theme schedule, word-count fuzz |
| `npm run e2e` | drives the real app over the DevTools protocol with real key events: element flow, shortcuts, autocomplete, capitalisation, highlights, notes, find, zoom, themes, save/autosave/reopen, backups, PDF export, **recovery after a forced kill**, theme toggle and schedule (incl. a time-zone change), caret/selection/click alignment with rendered glyphs at several display scales and zooms, and the English revision against a local mock of the API and a fake Claude Code CLI (request shape, CLI flags, signed-out errors, accept/undo/redo, edits during a review, rate limits, server errors, cancellation, ignore/dictionary persistence). `STET_E2E_EXE=path\to\STET.exe npm run e2e` runs it against a packaged build |
| `npm run bench` | engine benchmarks (Node) |
| `npm run perf` | in-app performance probe; writes `.perf/renderer-results.json` |

Results and test conditions: [docs/PERFORMANCE.md](docs/PERFORMANCE.md).

## Writing

| key | action |
|---|---|
| Enter | next element (scene → action, cue → dialogue, dialogue → action …); on an empty element, steps back to Action, then Scene Heading |
| Tab / Shift+Tab | at the end of written text: start the usual follower (dialogue → parenthetical, action → cue); otherwise cycle the element type |
| Ctrl+1 … 7 | Scene Heading · Action · Character · Parenthetical · Dialogue · Transition · Shot |
| Shift+Enter | line break inside an element |
| `(` on an empty dialogue line | starts a parenthetical |
| `int.` / `ext.` in action | becomes a scene heading |
| Enter / Tab in a suggestion list | accept (scene prefixes, locations, times, names, extensions, transitions); Esc dismisses |
| Alt+1 / 2 / 3 / 0 | highlight blue / yellow / pink / remove |
| Ctrl+Alt+M · F8 · Shift+F8 | add note · next · previous |
| Ctrl+F · Ctrl+H · F3 | find · replace · next |
| Alt+↑/↓ · Ctrl+G · PgUp/PgDn | previous/next scene · go to page · page |
| Ctrl+wheel · Ctrl+= / − / 0 | zoom |
| LIGHT · DARK · AUTO (bottom right) · Ctrl+Shift+L | theme; AUTO follows a schedule — right-click it to set the dark and light start times (AM/PM). Picking LIGHT or DARK turns the schedule off |
| Ctrl+K | command palette — every command, searchable |
| Ctrl+P · Ctrl+Shift+E | print preview · export PDF |
| F9 | writing goals & statistics |
| F1 | all shortcuts |

## English revision (Claude)

*Tools → English Revision* (Ctrl+Shift+R, or **REVISE** in the toolbar) reviews
the action, dialogue and parentheticals with Claude (`claude-opus-5-5`) and
lists findings in three groups — **Grammar Error**, **Non-Native Construction**,
**Awkward Phrasing** — each with the original, a minimal replacement, a short
explanation and a confidence level. Flagged passages are underlined in the
script (solid / dashed / dotted). F7 / Shift+F7 move between suggestions.

- Per suggestion: **Accept** (one undo step), **Reject**, **Dismiss**, **Ignore**
  (remembered in this screenplay's .stet file — never flagged again here) and
  **+Dict** (added to your dictionary, shared by every screenplay). *Accept all*
  per category or overall asks first and is a single undo step.
- Nothing changes until you click. If you edit during or after a review,
  suggestions whose text changed are marked *outdated* and can't be applied;
  moved text is followed only when it can be identified unambiguously.
- **No setup if you use Claude:** with no API key, STET runs the review through
  Claude Code (the copy inside the Claude desktop app, or a `claude` install) on
  your existing Claude sign-in — it counts toward your plan's usage. It runs in
  print mode with every tool, MCP server, settings file, skill and saved session
  switched off, in an empty temporary folder; the script goes in on stdin and
  answers come back in the findings schema. *Tools → Claude Connection…* shows
  which connection is in use.
- **API key (optional):** paste one under *Tools → Claude Connection…* to bill an
  Anthropic API account instead. Encrypted with Windows DPAPI (Electron
  safeStorage) in the app's settings folder, used only by the main process,
  never shown to the editor UI and never written into screenplays.
  `ANTHROPIC_API_KEY` in the environment also works. A key takes precedence.
- The script is sent only when you press **Review**; a confirmation shows how
  many requests and roughly how many tokens it will use. The title page and
  your notes are never sent. Reviews run in sections (~6 000 characters, split
  at scene headings, with preceding text as context), three at a time, with
  retries on rate limits; cancel at any time; failed sections can be retried.
- Live check: `node bench/revision-live.js` (uses your Claude sign-in, or a key if set).

## Your work is safe because

- every save is atomic (temp file → fsync → verify → rename);
- autosave runs ~1.2 s after you stop typing; a failed save keeps retrying
  and a recovery copy is written meanwhile;
- a never-saved script lives in a recovery area until you give it a home;
- after a crash, STET offers to restore unsaved work at the next start;
- timed backups land in `<Name> Backups/` next to the script, every 5 minutes
  while it changes, kept 30 days — and the newest good backup is never pruned;
- damaged or newer-format files are refused, never overwritten;
- if another program changes the file, STET asks before overwriting.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — modules, editing pipeline, pagination rules, integrity design
- [File format](docs/FILE_FORMAT.md) — `.stet` container and schema, versioning, migrations
- [Performance](docs/PERFORMANCE.md) — measured results and conditions
- [Native code](docs/NATIVE.md) — the C/WebAssembly word-count experiment and why it isn't shipped (measured)
- [Changelog](CHANGELOG.md) — one git commit and tag per version; also in the app under *Help → Changelog*

## Known limitations

- **Dual dialogue, scene numbers, revision marks / colored pages, and
  Final Draft (.fdx) or Fountain file import/export** are not implemented.
  Plain-text paste does recover element types (Fountain-like heuristics).
- Page layout is **US Letter only**; A4 is not offered.
- Action and dialogue split across pages at line boundaries (with 2-line
  widow/orphan control), not preferentially at sentence ends as Final Draft does.
- PDF text uses the PDF base-14 Courier font with WinAnsi (cp1252) encoding:
  characters outside Western European scripts print as "?" in the PDF (the
  editor and OS printing show them correctly).
- The OS print path (Ctrl+P → Print…) is exercised up to Electron's print
  call; driving the native print dialog is not covered by automated tests.
- The packaged build is a portable folder: there is no installer, so `.stet`
  files are not associated with STET in Explorer (drag a file onto the window
  or use Open).
- Spell-checking is off (it would fight the custom renderer).
- Writing statistics count net new words per day (high-water mark); heavy
  rewriting that keeps the word count flat is not credited.
