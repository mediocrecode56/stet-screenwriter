# Architecture

STET is an Electron application with no UI framework and one runtime
dependency (Electron itself). The document engine is plain ES modules shared
by the renderer, the main process, a PDF worker thread and the Node test suite.

```
src/
  core/        pure document engine — no DOM, no Node APIs; unit-tested in Node
    model.js       blocks, marks, document defaults
    format.js      page geometry on a character grid, word wrap
    layout.js      per-block layout cache, incremental pagination
    editor.js      editing engine: selection, transactions, undo/redo, smart Enter/Tab
    nav.js         caret movement over wrapped lines
    smart.js       autocomplete (scene prefixes, locations, times, cues, extensions)
    text.js        word counting / word boundaries
    serialize.js   document <-> .stet JSON payload, validation, migrations
    printmodel.js  printable pages (title page, ranges, highlights, notes)
    pdf.js         PDF writer;  printhtml.js  HTML for the OS print dialog
    stats.js       writing-progress tracker;  plaintext.js  clipboard interchange
  main/        Electron main process: all disk I/O
    main.js        window, stet:// protocol, IPC handlers, print, close flow
    container.js   binary container (header, CRC-32, gzip)
    files.js       atomic writes, save queue, backups, retention, recovery
    store.js       settings / statistics JSON stores
    pdf-worker.js  worker thread: JSON -> pages -> PDF bytes
  renderer/    sandboxed UI (no Node access)
    app.js         composition root, commands, document operations
    view.js        virtualised page renderer, caret/selection overlays, hit testing, zoom
    input.js       keyboard, mouse, clipboard, IME
    session.js     save / autosave / recovery / backup orchestration
    ui/            menus + palette (one command registry), dialogs, panels, find bar
  preload.cjs  whitelisted IPC bridge
```

## Why these choices

**Electron, no framework.** The machine this was built on has Node but no C
compiler, Rust or .NET toolchain; Electron gives a native window, OS print
dialog, file dialogs and a fast text renderer with no extra toolchain. A UI
framework would add a reconciliation layer between keystroke and pixels; the
editor instead writes the few DOM nodes that change directly.

**A custom editor, not `contenteditable`.** Screenplay structure is the data:
blocks have types; indentation is derived. `contenteditable` would make the
DOM the source of truth and require reconstructing structure from it. Here the
DOM is a projection of the model, so selection, undo and pagination are exact.

**The character grid.** Courier 12pt is exactly 10 characters per inch and 6
lines per inch. Every element is specified in columns (`format.js`): action
at column 15 (1.5in) and 60 columns wide, dialogue at 25 and 35 wide,
character cue at 37, parenthetical at 31 and 25 wide, transitions
right-aligned to column 75. Wrapping is therefore integer arithmetic — no text
measurement, no reflow from fonts — and the PDF, print and screen layouts are
the same computation.

## The editing pipeline

```
key event ─▶ Input ─▶ Editor command ─▶ _splice() ─▶ dirty range + undo step
                                                        │
             paint ◀─ View.frame() ◀─ paginate(prev, dirty)  (incremental)
```

- **Immutable blocks.** Each edit replaces the touched block object. Layout
  (`linesOf`) and word counts are cached in `WeakMap`s keyed by block identity,
  so unchanged blocks are never re-wrapped or re-counted, and undo steps hold
  references instead of copies.
- **Transactions.** Every mutation is a splice `{from, removed, added}` recorded
  in the open transaction; undo replays them in reverse. Typing merges into one
  step per word; formatting, type changes and auto-capitalisation are separate
  steps.
- **Incremental pagination.** After an edit, pagination restarts at the last
  page that begins at least 4 blocks before the change (keep-with-next chains
  look at most 3 blocks ahead) and stops as soon as a new page boundary lands
  on a block/line that started a page before; the rest of the old result is
  reused (indices shifted). A randomised test asserts it always equals a full
  repagination.
- **Virtualised rendering.** Only pages in the viewport ±1 exist in the DOM.
  Each page has a content signature (block versions + line ranges); a page is
  repainted only when its signature changes. Caret, selection and search hits
  are overlay layers placed with grid arithmetic.
- **Typing never waits for disk.** Saves are serialised in the renderer
  (~0.3 ms for 120 pages), compressed and written asynchronously by the main
  process; PDF generation runs on a worker thread.

## Pagination rules

54 body lines per page (1in top/bottom margins), page number top right from
page 2. Blank lines before an element are dropped at the top of a page.
Scene headings, shots, character cues and parentheticals are kept with what
follows (a cue needs its first two lines of dialogue on the same page).
Action and dialogue split only with at least two lines on each side; a split
speech gets `(MORE)` at the bottom and `NAME (CONT'D)` at the top of the next
page.

## Data-integrity design

| risk | mechanism |
|------|-----------|
| crash during a write | atomic temp-file + fsync + verify + rename; crash test kills a writer 12× mid-save |
| older save landing after newer | per-path save queue; main refuses revisions ≤ last written; `savedRev` only moves forward |
| another program changed the file | mtime check before every save → explicit overwrite / save-as choice |
| app crash / power loss | debounced recovery snapshot of unsaved state in `userData/recovery`, offered at next start |
| never-saved document | lives in recovery (with its own backups) until given a location |
| bad edit discovered later | timed backups next to the file; restore backs up the current state first |
| backups deleting the last copy | retention skips the newest *valid* backup and deletes nothing unless the primary file verifies |
| corrupt / unknown file | container checksum + schema validation; refused files are never written to |
| format evolution | schema version + migrations; pre-migration original is backed up |

## English revision

`src/core/revision.js` (pure, unit-tested) builds review sections, the system
prompt and the structured-output schema; validates every returned finding
against the snapshot it was made from (element exists, original text is really
there, minimal word-aligned span, no overlaps); and later revalidates findings
against the live document. Blocks are immutable, so identity tells whether an
element changed, and undo/redo of an accepted suggestion is recognised because
undo restores the exact block objects. `src/main/claude.js` calls the API with
the Anthropic SDK in the main process (key via safeStorage, streaming, adaptive
thinking, `fallbacks: "default"`, AbortController cancellation). With no key it
runs the Claude Code CLI instead (`claude -p --output-format json --json-schema …
--tools "" --setting-sources "" --strict-mcp-config --no-session-persistence`),
found on PATH, in `~/.local/bin`, or inside the Claude desktop app's folder;
the prompt goes over stdin, cancelling kills the process, and its result is
validated exactly like an API response.
`src/renderer/revision.js` is the panel. Accepting goes through
`Editor.replaceRanges`, so it is ordinary, undoable editing.

## Native code

See [NATIVE.md](NATIVE.md): measured, not needed.
