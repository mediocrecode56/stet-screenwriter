# STET

*stet* (Latin, "let it stand") — a fast, minimal, dependable screenwriting
application. Monochrome, typographic, deliberately beta in look; strict about
formatting and about never losing your work.

Version 0.6.1 β.

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

It also keeps **`Documents\STET\STET.exe`** up to date: the newest version that
built successfully, as one self-contained file (no folder needed). It is only
replaced after the new build has succeeded and been checked; if anything fails,
the previous one stays and the reason is printed. On the first launch of a new
version it unpacks once into `%LOCALAPPDATA%\STET\runtime`; later launches start
immediately. It is built with the C# compiler that ships with Windows, so there
is still nothing extra to install.

### Tests and measurements

| command | what it does |
|---|---|
| `npm test` | 112 unit/integration tests: formatting, pagination (incl. randomised incremental-vs-full), editing, undo, serialization round-trips, container corruption, atomic writes, save ordering, external-change detection, backups & retention, recovery, a kill-mid-save crash test, PDF structure, page ranges, theme schedule, the word-count rule against an independent reference implementation, word counting under typing / large pastes / replacing / deleting / undo / redo / reopening with a 20 000-edit fuzz, writing statistics (accumulation across documents and projects, restarts, upgrade from the 0.6 format, damaged files, double-send protection, consistency of per-document / per-project / weekly / all-time totals, Reset and a failed Reset, a year of heavy use), wheel-zoom steps, English-revision persistence, the weekly chart's adaptive scale and number formatting, and the companion simulated over hours of use (every activity and reaction, seamless posture changes, click variety and escalation, clicks and the cursor noticed at once without cutting a move short, staying in view on a wide play area and preferring its middle, walking back in when the area shrinks, props cleaned up) |
| `npm run e2e` | drives the real app over the DevTools protocol with real key events: element flow, shortcuts, autocomplete, capitalisation, highlights, notes, find, zoom, themes, save/autosave/reopen, backups, PDF export, **recovery after a forced kill**, theme toggle and schedule (incl. a time-zone change), caret/selection/click alignment with rendered glyphs at several display scales and zooms, the English revision against a local mock of the API and a fake Claude Code CLI (request shape, CLI flags, signed-out errors, progress indicator, hover highlighting, decisions, edits during a review, rate limits, server errors, cancellation, persistence across restarts), word counting and writing statistics in the real app (every editing route, switching and reopening documents, a restart, a crash, the upgrade from 0.6, the weekly view and the Reset confirmation), 5-point wheel-zoom steps, Open Recent dismiss/trash (also with long names and paths at two window widths: icons visible on hover, no horizontal scrolling), the writing companion (play area, hover and click response, drags passing through it), the weekly view with tens of thousands of words a day, the same slide for every panel (Ctrl+F included, and with reduced motion), the header layout, animation easing and toolbar spacing. `STET_E2E_EXE=path\to\STET.exe npm run e2e` runs it against a packaged build |
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
| Ctrl+wheel · Ctrl+= / − / 0 | zoom (the wheel moves in exact 5-point steps) |
| LIGHT · DARK · AUTO (bottom right) · Ctrl+Shift+L | theme; AUTO follows a schedule — right-click it to set the dark and light start times (AM/PM). Picking LIGHT or DARK turns the schedule off |
| Ctrl+K | command palette — every command, searchable |
| Ctrl+P · Ctrl+Shift+E | print preview · export PDF |
| F9 | your writing week: progress, goals, statistics |
| F1 | all shortcuts |

## English revision (Claude)

*Tools → English Revision* (Ctrl+Shift+R, or **REVISE** in the toolbar) reviews
the action, dialogue and parentheticals with Claude (`claude-opus-5-5`) and
lists findings in three groups — **Grammar Error**, **Non-Native Construction**,
**Awkward Phrasing** — each with the original, a minimal replacement, a short
explanation and a confidence level. Flagged passages are underlined in the
script (solid / dashed / dotted). F7 / Shift+F7 move between suggestions.

- Per suggestion: **Accept** (one undo step), **Discard**, **Ignore**
  (remembered in this screenplay's .stet file — never flagged again here) and
  **+Dictionary** (shared by every screenplay). *Accept all* per category or
  overall asks first and is a single undo step. Decided suggestions move to a
  folded *Decided* group; **Reopen** makes one undecided again.
- **Suggestions stay until you decide.** Their text, replacement, explanation,
  category and decision never change because you edited the script. Hover a
  suggestion to highlight exactly its passage; if edits make the passage
  impossible to identify reliably, the suggestion stays and says so — nothing
  else is ever highlighted or replaced in its place.
- The latest review and every decision are saved in the .stet file, so they
  survive restarts. Running a review again replaces them completely.
- While Claude works, the panel shows an indeterminate progress bar, the
  current stage, sections done and elapsed time; you can keep writing.
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

## Word count and writing statistics

**The word count** in the status bar is the screenplay's body (title page not
included), always exact, updated with every keystroke, paste, deletion, undo
and redo. A word is a run of characters between separators that contains a
letter or digit; separators are any whitespace, the em dash, the en dash and
"…". So *don't*, *well-known*, *3.5* and *(V.O.)* are one word each, *wait—what*
is two, and a lone "—" or "…" is none. Chinese and Japanese characters count one
word each.

**Writing statistics** record the words you actually write, across every
screenplay and project, for good:

- Typing counts as you go. Pasting, Find & Replace and accepted suggestions
  don't. Opening, switching or reopening a screenplay never counts its existing
  words, and undo/redo can never count anything twice.
- Deleting text never takes away writing you've already done — only fixing the
  words you have just typed (a typo, a phrase rephrased on the spot) is netted
  out, so a corrected word isn't counted twice.
- Statistics live in STET's data folder (`%APPDATA%\STET\stats.json`), apart
  from the program, so replacing STET.exe or installing a newer version keeps
  them. A daily backup is kept beside it; a damaged file is set aside and the
  backup used, never silently reset. Statistics from STET 0.6 are carried over.
- **F9** (or click TODAY) shows your week: the total and today's progress
  against your goals at the top, a chart with every day's exact number printed
  on it and the goal line, and a few plain facts (days written, goal met, best
  day, streak). The chart's scale follows the week, from a few dozen words to
  tens of thousands a day; a day far above the rest is drawn with a break in
  its bar so the other days stay readable. ‹ › browse earlier weeks. Days
  before statistics began show "—", not zero.
- **Reset statistics…** in that view is the only way to clear them. It asks
  first, says exactly what will be cleared (all recorded writing; not your
  screenplays, word counts or goals), and only the Reset button confirms —
  Cancel, Escape or clicking outside change nothing. A copy of what was
  cleared is kept in the data folder.

## Writing companion

A tiny 8-bit dinosaur lives on the edge of the desk above TODAY, with a life of
its own and a generous stretch of desk to roam (it takes up no room: the
editor and everything else work underneath it as before). It walks
about, naps, stretches, chases a ball, digs up bones (and sometimes a
disappointing pebble), watches leaves fall, chases butterflies, balances things
on its nose, and — while you're writing — sometimes types along on a tiny
typewriter. Now and then something rarer happens. Its mood drifts over the
day, and it remembers what it did recently, so it doesn't repeat itself.

Its energy comes from the words you actually write (not pastes, not opening
files, not the clock) and changes gradually; idle, it calms down and dozes.
Move the pointer near it and it turns to look at you straight away. Click it
and it notices at once (a blink and a little start), then reacts — anything
from a nod to something ridiculous, sometimes after a beat, sometimes with a
shrug, and with mounting indignation if you keep clicking. A pose it is just
holding gives way immediately; a step, jump or stride in progress always
finishes first, so nothing is cut off or sped up. It mostly keeps to the
middle of its patch and never wanders out of sight. *View → Hide Writing Companion* turns it off. It redraws a tiny canvas a
few times a second at most, and not at all while the window is hidden.

## Open Recent

*File → Open Recent…* (Ctrl+Shift+O). Hover a project for two actions: **×**
(*Remove from Recent*) removes it from the list only; the **bin icon** (*Move
to Recycle Bin*) moves the file to the Recycle Bin after a confirmation (never a
permanent delete). Long paths are shortened from the start ("…\Drafts\Film.stet",
full path on hover), so the list never scrolls sideways. Missing files are marked.

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
- Writing statistics can't tell retyping from new writing: if you delete an old
  passage and type it again from memory, the retyped words count as written.
