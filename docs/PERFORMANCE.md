# Performance

The numbers on this page are a dated record of 2026-10-19. For how a computer is judged today, see the
next section.

## The Performance Probe

*Tools → Run Performance Probe* says whether a computer runs STET smoothly, as a score from 0 to 100.
Its rules are in `src/core/perfscore.js`, its measurements in `src/renderer/perf.js`.

- **The score comes from behaviour, never from hardware.** No CPU or graphics card is looked up, so a
  future computer, a virtual machine or a remote desktop is judged by what actually happens. What the
  computer says about itself is shown for the reader only.
- **Marks are what people notice.** Each measure has an ideal (100), a smooth mark (70) and a limit (0),
  and the score falls by ratio between them. Marks that wait for a frame follow the display's measured
  frame time, so a slow display is allowed its own frame and a fast one earns nothing a person cannot see.
- **A feature-length script counts most** (70%), with a long one for the rest. Typing and scrolling
  decide: the score stands at most 25 above the worst of them, because a fast computer that stutters
  while typing is not smooth.
- **It cannot hang.** Every step has a time limit and asks the clock rather than counting, so a slow
  computer takes fewer samples. The window stays responsive, the whole run is held to 45 seconds, and
  Esc ends it at once. A step that fails is named and the rest still score.
- **It says when not to be trusted.** A covered window, a computer that slowed down during the test, uneven
  frames or a missing step lower the stated reliability; too little measured gives no score at all.

Keeping it working across releases: the steps call the real editor and view, so a renamed method shows up
as a failed step. `test/app/smoke.app.js` fails on any failed step, on every release.

Checked with the CPU slowed down in the real app (i9-13900K): 100 at full speed, 84 at 6×, 41 at 20×, 22 at
60× (there the long script is left out for time). Full speed takes about 7 seconds.

## Memory

`npm run mem` prints what each of STET's processes takes, with a feature-length script open and a real
dictionary loaded (`scripts/mem.js`; `-- --type` types for a while first). `test/app/memory.app.js` fails a
release that brings back a network process, lets either side's JavaScript pass 40 MB, or lets spelling's
caches outgrow the screenplay.

Measured 2026-11-13 on the machine below, the sample script, a 97 000-word English dictionary, Windows
private working set (Task Manager's Memory column), three runs each:

| process | 0.60.0 | now |
|---|---|---|
| main (with the spelling worker) | 69 MB | 56 MB |
| network service | 7.5 MB | (in the main process) |
| GPU | 34 MB | 33 MB |
| window | 37 MB | 40 MB |
| **all of STET** | **148 MB** | **130 MB** |
| window JavaScript after typing 3 000 characters into one paragraph | 11.3 MB | 6.8 MB |

A bare Electron window with nothing in it takes 70 MB, so STET's own share fell from 78 to 60 MB. Typing,
scrolling and opening measured the same as before (Performance Probe, both 100).

The rules that keep it there:

- **One copy of the dictionary, compactly.** Words with the same affix flags share one `Set` of them
  (a dictionary has a few thousand combinations, not 100 000): 25 → 8 MB. The made-up candidates a
  suggestion tries are never cached, only words someone wrote (20 000 at most).
- **Small nurseries where little is short-lived.** The spelling worker runs with a 2 MB young generation
  (−7 MB; loading measured no slower). The same flag for the window measured no gain, so it isn't set.
- **No process for what one can do.** The network service runs inside the main process
  (`NetworkServiceInProcess2`): STET fetches only an update, a dictionary and its own files. Its
  process took 7.5 MB; in its place the main process takes nothing measurable and the window about
  2 MB more, so about 5 MB in all.
- **Caches forget what only undo remembers.** Per-block results heavier than a number live in a
  `BlockMemo`, which drops blocks the screenplay no longer holds (see ARCHITECTURE.md, the editing
  pipeline). A finished review lets go of its request unless a section failed and may be retried.
- **Nothing written twice, nothing downloaded kept.** Settings and statistics are written only when they
  changed (a quit used to start a second write the exit cut short, leaving a `.tmp` file each time; those
  left over are cleaned up a minute after starting). Update and dictionary downloads skip Chromium's disk
  cache.

What remains is Chromium's own: about 33 MB of GPU process and 38 MB of window for any real page,
which STET can't lower without changing how it looks or feels (software rendering, fewer effects).
Chromium's own textarea undo (1 000 steps, about 0.3 MB) and event-timing records are capped by
Chromium.

## Speed

Performance is measured two ways, both reproducible from the repo:

- `npm run bench` — the document engine in Node with high-resolution timers
  (`bench/core-bench.js`; raw output in `.perf/core-results.json`).
- `npm run perf` — the **real app**: opens a window, generates scripts, and
  drives the actual input → editor → layout → render path, measuring until
  the next frame callback (`src/renderer/perf.js`; raw output in
  `.perf/renderer-results.json`). Also available in the app under
  *Tools → Run Performance Probe*.

## Test conditions

| | |
|---|---|
| CPU | Intel Core i9-13900K (32 logical cores), 64 GB RAM |
| OS | Windows 11 Pro (NT 10.0.26300) |
| Runtime | Electron 44.5.1 (Chromium 152.0.7977.130), Node 24.18.0 for `bench` |
| Window | 1280×860, device pixel ratio 1, dark theme, 100 % zoom |
| Documents | generated scripts (`src/dev/sample.js`): realistic mix of headings, action, cues, parentheticals and dialogue |
| Sizes | **138 pages** (2 284 elements, 29 k words) and **456 pages** (7 612 elements, 97 k words) |

Renderer timings use `performance.now()`, which Chromium clamps to 0.1 ms;
values below 0.1 ms read as 0.0–0.1. Measured 2026-10-19.

## Results — in the app (`npm run perf`)

| operation | 138 pages p50 / p95 / max | 456 pages p50 / p95 / max |
|---|---|---|
| **keystroke → next frame** (246 chars typed mid-script) | 5.6 / 5.8 / 6.5 ms | 5.5 / 5.7 / 6.1 ms |
| keystroke JS (edit + repaginate + repaint page) | 0.6 / 0.7 / 1.7 ms | 0.5 / 0.8 / 1.0 ms |
| keystroke → frame **while autosaving** | 5.5 / 5.7 / 5.8 ms | 5.5 / 5.7 / 6.1 ms |
| Enter (new element) | 0.5 / 0.9 / 1.0 ms | 0.6 / 0.7 / 0.9 ms |
| Arrow-down caret move | 0.1 / 0.3 / 0.6 ms | 0.2 / 0.3 / 0.7 ms |
| scroll by one viewport (render frame) | 0.4 / 0.6 / 0.8 ms | 0.4 / 0.7 / 0.9 ms |
| jump to a scene (select, reveal, render) | 1.2 / 1.8 / 3.6 ms | 1.2 / 1.6 / 2.6 ms |
| find all "the" | 0.2 / 0.8 ms (749 hits) | 0.5 / 0.7 ms |
| replace all "rain" → "snow" (one undo step) | 2.9 ms (606 hits) | 5.4 ms (2 027 hits) |
| open (load + paginate + first paint) | 9.0 ms | 9.9 ms |
| serialize for save (UI thread) | 0.3 ms | 1.0 ms |
| full save round trip (serialize → IPC → gzip → atomic write → verify) | 21.5 ms | 31.2 ms |
| JS heap after load | 3.2 MB | 7.1 MB |
| JS heap after 5 000 further edits (incl. undo history) | 7.1 MB | 10.7 MB |

"Keystroke → next frame" is flat across document sizes: it is bounded by the
display's frame cadence, not by work (the work is ~0.5 ms). Typing latency
does not change while saves run because compression and disk I/O happen in
the main process thread pool.

## Results — engine (`npm run bench`, Node, µs-resolution)

| operation | 135 pages p50 | 454 pages p50 |
|---|---|---|
| keystroke through the editor engine incl. incremental repagination | 0.009 ms | 0.012 ms |
| incremental repagination after a one-element edit | 0.007 ms | 0.009 ms |
| full pagination (layout cached) | 0.117 ms | 0.378 ms |
| wrap every element, cold (opening) | 0.165 ms | 0.480 ms |
| find all | 0.153 ms | 0.518 ms |
| serialize | 0.236 ms | 0.891 ms |
| encode (gzip + CRC, async) | 5.6 ms | 19.1 ms |
| decode + deserialize (open) | 0.7 + 0.6 ms | 1.9 + 1.9 ms |
| PDF, whole script (worker thread) | 8.5 ms | 28.4 ms |
| file size / JSON size | 41 KB / 223 KB | 132 KB / 745 KB |
| PDF size | 127 KB | 427 KB |

Incremental repagination does 18× (135 p) to 42× (454 p) less work than a
full pass, which is why typing cost is independent of script length.

## Targets

Set from the architecture and confirmed by the measurements above:

| target | status |
|---|---|
| keystroke handling < 2 ms of JS at p95 on a 450-page script | met (0.8 ms) |
| typing never waits for a save, backup, statistics or PDF | met (no change while saving; PDF and gzip off-thread) |
| scene / page jump < 5 ms | met (≤ 3.6 ms max) |
| open a 450-page script to first paint < 100 ms | met (≈ 10 ms after the file is read) |
| no memory growth beyond undo history in long sessions | 5 000 edits ≈ +3.5 MB including 2 000-step undo history cap |

## Toolbar latency (v0.3.0)

Measured with `node bench/toolbar-latency.js`: real mouse events (CDP) on a
visible window holding the 456-page script; time from mousedown to the
handler finishing ("JS") and to the next frame.

| control | JS before → after | next frame p50 before → after |
|---|---|---|
| element type (CHARACTER / ACTION) | 1.6 / 1.0 → 1.7 / 0.9 ms | 3.7 / 3.0 → 3.4 / 1.9 ms |
| highlight | 0.9 → 1.1 ms | 4.3 → 2.8 ms |
| SCENES open / close | 0.3 → 0.2 ms | 4.6 / 11.2 → 5.3 / 11.4 ms |
| theme LIGHT / DARK | 0.2 → 0.1 ms | 2.1 / 3.7 → 2.4 / 4.3 ms |
| zoom + / − | 4.8 / 1.7 → 5.2 / 1.7 ms | 6.0 / 7.2 → 6.3 / 2.8 ms |
| File menu | 2.3 → 1.4 ms | 6.5 → 2.4 ms |

Every control already reached the screen within one frame, so the felt delay
was not computation. It came from the visual path:

- **no pressed state** — nothing changed under the pointer until the
  command's own result appeared. Controls now get a `pressed` class on
  `pointerdown`, painted in the same frame, independent of the command.
- **fade-from-transparent animations** — panels faded in from opacity 0 over
  80 ms and menus over 60 ms, so their content was half-visible for several
  frames. They are now fully opaque on the first frame with a short 50–60 ms
  positional nudge (motion kept, delay removed); dialogs keep the backdrop
  fade but the dialog itself is solid immediately.
- **redundant work** — theme switches no longer tear down and repaint every
  page (colours are CSS variables), panel toggles no longer force a full
  repaint, and autosave no longer rewrites settings.json on every save.

## Word counting (v0.3.0)

Replaced the Unicode-regex scan with a table-driven state machine (see
[ARCHITECTURE.md](ARCHITECTURE.md#native-code)): 3.95 → 1.59 ms per full count on English, 14.6 →
1.5 ms on Cyrillic-heavy text; opening a 456-page script 14.5 → 13.0 ms.

## What was optimised, and why

1. **Character-grid layout** instead of DOM measurement — removed text
   measurement from the edit path entirely.
2. **Identity-keyed caches** (layout, word counts) on immutable blocks — an
   edit re-wraps exactly one element.
3. **Incremental pagination with resync** — measured 18–42× cheaper than a
   full pass; verified equal to a full pass by a randomised test.
4. **Page-signature repaint + virtualisation** — a keystroke repaints one page;
   scrolling creates at most one new page per frame.
5. **Off-thread compression and PDF** — the only multi-millisecond tasks.

Nothing else was optimised, because nothing else measured as significant.
