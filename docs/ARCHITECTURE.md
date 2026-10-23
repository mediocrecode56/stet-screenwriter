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
    text.js        the word-count rule / word boundaries
    serialize.js   document <-> .stet JSON payload, validation, migrations
    printmodel.js  printable pages (title page, ranges, text styles, highlights, notes)
    pdf.js         PDF writer;  printhtml.js  HTML for the OS print dialog
    stats.js       writing-statistics ledger (pure);  plaintext.js  clipboard interchange
    streak.js      the writing streak: day rules, milestones, growth and unlocks
    chart.js       the weekly chart's adaptive scale and number formatting
  main/        Electron main process: all disk I/O
    main.js        window, stet:// protocol, IPC handlers, print, close flow
    container.js   binary container (header, CRC-32, gzip)
    files.js       atomic writes, save queue, backups, retention, recovery
    store.js       settings JSON store;  statsstore.js  the saved statistics (backups, upgrades, reset)
    pdf-worker.js  worker thread: JSON -> pages -> PDF bytes
  renderer/    sandboxed UI (no Node access)
    app.js         composition root, commands, document operations
    view.js        virtualised page renderer, caret/selection overlays, hit testing, zoom
    input.js       keyboard, mouse, clipboard, IME
    session.js     save / autosave / recovery / backup orchestration
    dino.js        the writing companion: behaviour engine and canvas;  dino-acts.js  its repertoire;  dino-art.js  its pixel art
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

**The character grid.** The page is a grid of 0.1in columns and 1/6in rows (12pt
Courier's line). The characters of a line follow one another at `PITCH` columns
(7pt, as Final Draft sets its Courier). Every element is specified in columns (`format.js`): action
at column 15 (1.5in) and 60 columns wide, dialogue at 25 and 35 wide,
character cue at 37, parenthetical at 31 and 25 wide, transitions
right-aligned to column 75. Lines break at spaces, or after a hyphen inside a word
("twenty-year-" / "old."), as Final Draft breaks them. Wrapping is therefore integer arithmetic — no text
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
there as whole words (`findWhole`), minimal word-aligned span, no overlaps); and later revalidates findings
against the live document. Blocks are immutable, so identity tells whether an
element changed, and undo/redo of an accepted suggestion is recognised because
undo restores the exact block objects. `src/main/claude.js` calls the API with
the Anthropic SDK in the main process (key via safeStorage, streaming, adaptive
thinking, `fallbacks: "default"`, AbortController cancellation). With no key it
runs the Claude Code CLI instead (`src/main/claude-code.js`, no Electron, unit-tested:
`claude -p --output-format json --json-schema … --tools "" --setting-sources ""
--strict-mcp-config --no-session-persistence`), found on PATH, in `~/.local/bin`, or
in the Claude desktop app's own folders (`%LOCALAPPDATA%\Claude-Data\*\claude-code`,
the older `%APPDATA%\Claude\claude-code` and its MSIX `Packages\Claude_*\LocalCache`
copy; the newest version wins). `claude auth status` checks the sign-in first (only
`loggedIn` is read); the prompt goes over stdin, the process is spawned without a
shell, cancelling kills it, and its result is validated exactly like an API response.
Which one is used is `provider` in `claude-connection.json` (auto / cli / api, set
in the Claude Connection dialog); a failure is reported, never answered by switching.
Since 0.6 a suggestion never changes or resolves by itself: `locate()`
recomputes only its position — unchanged element, exact diff against the
element version last seen, same text with the same context, a distinctive
unique phrase — and otherwise reports it as not locatable. Decisions
(accepted / discarded / ignored / dictionary) change only through the panel.
The review is stored in the document (`doc.revision.review`) and serialised
with it. `src/renderer/revision.js` is the panel. Accepting goes through
`Editor.replaceRanges`, so it is ordinary, undoable editing.

## Word counting and writing statistics

**The count.** `countWords()` in `core/text.js` is the one definition of a
word (documented there; `test/helpers/wordref.js` is an independent reference
implementation every test compares against). The editor's block array is the
single source of the text; `Editor.words` is maintained per transaction from
per-block counts cached by block identity (blocks are immutable). The app
recounts the whole document every ~15 s while idle (`verifyWords()`, a few ms)
as a safety net that would repair and report any drift.

**Writing credits.** Statistics don't compare word counts (that's what made
0.6's high-water mark stop counting after a deletion). Instead every committed
transaction earns a *credit* (`Editor._earn`): words added by the writer's own
editing count; paste and replace earn 0; deletions earn nothing negative except
inside the "fresh" stretch just written (tracked as paragraph + offsets), so a
fixed typo isn't counted twice. Each transaction stores its credit, undo emits
exactly its negative and redo re-emits it — so Σ credits always equals the
credit of the history currently in effect (`creditInEffect`, fuzz-tested over
20 000 random edits). Loading a document clears history and earns nothing.

**The ledger.** The app drains credits on every change and books them in a
`StatsBook` (`core/stats.js`, pure) twice: in the window for an instant TODAY,
and — sent within 250 ms in numbered batches, re-sent with the same id on
failure, booked at most once — in the main process, whose `StatsStore` owns
`<userData>/stats.json` (atomic writes, a daily `stats.bak.json`, damaged
files kept aside, a newer format left untouched, 0.6's format upgraded with
`stats-v1.json` kept). Credits carry the time the words were written, so an
undo is charged to the right day. The only reset is the confirmed one in the
weekly view: it archives the ledger, clears it and records the reset; credits
older than the reset are ignored afterwards.

**The writing streak** (`core/streak.js`) is booked by the same `apply()`:
the first positive credit on a calendar day books that day (once, however many
documents or sessions), and a day whose words are all undone is unbooked
again. It is stored in the ledger (`streak: { last, count, best, prev }`), so
the window and the main process agree and it is saved, backed up and upgraded
with everything else; statistics from before 0.9 get the streak their days
already show. The current streak is `count` while `last` is today or
yesterday, else 0. Growth is one pixel per milestone reached (1, 2, 4, 8, 16,
32 days) and a special loop is unlocked per two; both are pure functions of
the current streak, so nothing can be applied twice and a broken streak
resets them. A Reset keeps the streak.

## Motion

One set of easing curves and durations (CSS variables `--ease-out`,
`--ease-in-out`, `--dur-fast`, `--dur-panel`, mirrored in `ui/motion.js`).
Nothing overshoots. Every surface that opens uses the same few functions in
`ui/motion.js`: docked panels (scenes, notes, English revision, and the find
bar from under the toolbar) slide by animating their outer margin (Web
Animations API), so the page glides and panel text never re-wraps, and a
toggle mid-way reverses from the current position; floating surfaces (dialogs,
menus) drop a few pixels into place as they fade in and fade out as they
close. Motion never holds anything up: focus, typing and the command's effect
are immediate, a closing dialog stops taking input at once, and a dialog that
replaces another just swaps. `prefers-reduced-motion` turns interface motion
off.

## Writing companion

**The face.** Every frame's head is one of the `HEAD` drawings, unchanged:
frames that lower, lay down or turn over the head build it with `headOver()`,
which draws the head in front of the body from its outline on, so the body never
fills the mouth or cuts the jaw. `FACE` records where each frame's head is, and
`spriteEdges()` gives the drawing code pixel edges by sprite index (so a mirrored
or upside-down drawing has the same shape) with the head's rows and columns at one
whole device-px size; the fractional part of a grown or odd-scaled cell goes to the
body, tail and legs. Tests check every frame and rasterise faces at every size.

**Dormant.** In a deep sleep with the window still in the background and nothing
else going on (`Critter.dormant`), the sleep loop yields one still `lie` step of
`TIMING.dormantTick` (60 s) instead of breaths, `tickDelay()` ticks only when
something is due (a tuft, at most once a minute), and `Dino.onDormant` lets the
app rest: `:root.dormant` pauses every CSS animation, the goal poll stops and the
theme poll slows to a minute. Autosave, backups and saving are untouched. Focus
ends the still step at once (a breath on the next tick), clears the class, restarts
the polls and refreshes the goal and theme; the deep wake-up follows as before.

The pixel art (`dino-art.js`: frames, props, glyphs as character grids) and
the repertoire (`dino-acts.js`: 79 activities and 102 reactions, generator
functions yielding short steps of ≤ 1.5 s) are data for the engine in
`dino.js`. `Critter` is the behaviour engine, pure and simulated in tests for
hours at a time: props with a little physics, a drifting mood and a memory of
recent activities and reactions that tilt weighted choices. A click captures
`context()` — the activity, posture, whether it is on the move, what it
carries or wears, what is near (a ball, a flower, a puddle, the palm), the
rain, the time of day — and picks a reaction by weight (category × agitation ×
mood × fit to that context × how recently it was used × cooldown); context
reactions only exist where they fit. At most two queue, they run at the next
step boundary, and the interrupted activity then resumes. The pointer is not
tracked at all: only a click tells it where you are.

**The environment.** Timed events (rain, a breeze, a bird, a tumbleweed, a
shooting star, a plant sprouting) start only when it can take part (`canHost()`: on stage, not
reacting, nothing queued, not in the middle of something absorbing), one at a
time (`event`), a few minutes apart and each kind on its own cooldown.
A sprouted plant (`wild`: cactus, grass or palm, one at a time) is noticed
when the dinosaur is free (`plantNotice`, a few to thirty seconds after it
comes up) and may be visited later (`visitPlant`) while it has time left.
A cactus or a palm lasts 6–14 minutes, small plants a minute or two.
**In the background.** `Dino` passes the window's focus to `Critter.setFocus()`
(window `focus`/`blur`, `document.hasFocus()`), which is separate from being idle
(no writing) with the window focused. While unfocused, tufts of grass
(`tuft` props, outside the `loose` count the other limits use) come up on a
timestamp schedule (`growWhileAway()`, `TIMING`), so a throttled or hidden
window catches up on its next tick; at most `tuftsMax`. Nothing eats small
plants while unfocused (`graze` and the grass nibble require `focused`), and
large plants' lifetimes are extended by the time spent unfocused. After
`TIMING.deepSleep` unfocused it ends what it was doing and sleeps (`deep`): no
events, and ticks only at each 1.5 s breath. If no ticks ran meanwhile
(hidden), `sleepDeeply()` puts it straight to sleep, unseen. On focus a
`deepWake` reaction is queued a moment later (dropped if the window loses focus
first); grazing waits for writing after the return plus `grazeAfter`.
Things floating about (`floating()`) are kept to a few: floating visitors and
events wait while two are already up, and a breeze is one or two faint gusts.
Things that grow (palm, flower, mushroom, dandelion) and visitors (a balloon,
a paper plane, a frog, a ladybird, a worm) are activities it starts itself,
each on its own cooldown. When AUTO turns the theme, `app.js` tells the
companion (`Dino.themeChanged`, ignored in the first seconds after launch):
`Critter.themeShift()` queues `nightfall` or `daybreak` as the next
activity and ends the current one at its next step, unless it is something
absorbing; a sleeper sleeps on through nightfall (only the moon rises), and a
sun or moon already in the sky is turned round rather than doubled.
Each has a lifecycle — fading or growing in, its part for the dinosaur
(`envDue`, chosen by `envReaction()` from the context at the start, run like a
reaction), and a natural end (fading, withering, drying) with failsafes so
nothing can rain for ever. Background things (a tree growing, a cloud drifting
in) carry on while it does something else. Raindrops land on the ground, on
the dinosaur, its leaf umbrella or the palm's fronds.

**Growth.** `du`, the dinosaur's own pixel, is `u + g / 14`: exactly `g` CSS
px taller (and proportionally wider). It is drawn cell by cell with whole
device-pixel edges, so it stays crisp at any size; a milestone reached while
writing plays `grow` at its next natural moment, a restored one is simply
applied at start-up. `bridged()` guarantees no posture jumps
(lying → standing always passes through sitting and crouching). Energy is an
exponentially decaying count of words written, smoothed over ~20 s.

Responsiveness is separate from pacing: a click is acknowledged in the same
moment (`ack`: a blink and a one-pixel start drawn over the current frame),
and a step that merely holds a pose (`isHold`) may end early so a due
reaction starts at once. Moves, jumps and lifts always run their
full length. Destinations are centre-weighted within the home stretch
(`zone()`, `spot()`); `explore` and the very rare `cornerBite` (only where
the strip's left end is the window's corner) go beyond it, and what it just
did tilts what comes next. Nothing walks off the strip. Moving along the
ground is always stepping: `walkTo()` never strides further than the legs
reach (2.5 dinosaur pixels walking, 3 running; a faster pace means quicker
strides), the engine takes each ground stride with its frame rather than
gliding through it, and legs that cannot move stand. The canvas ticks on time
for each step, so every stride is shown.

`Dino` draws it on one canvas laid over the bottom of the editor area: the
whole width of `#scroller` (never over a side panel or the scrollbar), with
its home stretch up to 560 px wide centred on TODAY, and 30 rows of headroom
where props, clouds, fireworks and visitors stay whole. Visitors come in from
24 px out of sight (or fade in, when that end is far off). The canvas's bottom
edge is the status bar's top edge, on a whole device pixel, so the feet stand
on the border without covering it.
When the strip moves, the dinosaur keeps its place on screen; if the strip
shrank out from under it, the critter walks back in (`comeBack`) and the
canvas stretches to keep it whole meanwhile. Only the dinosaur's own hit box
takes clicks, and not while a drag that started elsewhere is in progress.
Redrawn only when the picture changes, with no timers while the window is
hidden.

## Native code

See [NATIVE.md](NATIVE.md): measured, not needed.
