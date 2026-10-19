# Performance

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
