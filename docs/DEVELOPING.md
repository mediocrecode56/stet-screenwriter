# STET for developers

Everything about running STET from source, building it, testing it and how each
feature works in detail. If you just want to write, see the [README](../README.md).

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

### Releases and the installer

Releases are built and published on GitHub by `.github/workflows/release.yml`,
on a Windows runner, then a Mac runner. **Releasing is automatic:** push a commit to `main` that
raises `version` in `package.json` and adds its `## X.Y.Z · date` section to
`CHANGELOG.md`. The workflow then:

1. checks the version is new, matches a well-formed tag and has a changelog
   section (anything wrong stops it before building);
2. runs the unit tests;
3. builds the version with `scripts/build-exe.js`, checks the single-file
   STET.exe reports that version, and zips it;
4. builds the installer with Inno Setup (`scripts/installer/STET.iss`);
5. tags the commit `vX.Y.Z`, publishes the release with the changelog section as
   its notes, and deletes the older releases (their tags stay);
6. then, on a Mac (Apple silicon), whenever GitHub has one free: runs the unit tests,
   builds `STET-macOS.dmg` with `scripts/build-mac.js`, opens the disk image, checks
   STET.app's signature, version and document icon, runs the end-to-end tests against
   it, and puts it in the release. The release never waits for this: until it is done,
   the previous release's `STET-macOS.dmg` stands in (that STET updates itself).

A push whose version is already released does nothing; one that follows a failed
release tries it again. Only one release publishes at a time. A release can also be started by pushing a tag `vX.Y.Z`, or from
GitHub: **Actions** → **Release** → **Run workflow** (leave the box empty for
the version in `package.json`). Running it for a version that is already
released replaces that release's files. Run by hand with **publish** unticked,
it only builds and tests the Mac app and keeps the disk image with the run (under
Artifacts), for trying out a change to the Mac build.

Each release has four files. The first three are named the same every time so
`https://github.com/mediocrecode56/stet-screenwriter/releases/latest/download/<name>`
always gets the newest:

- `STET-Windows.zip`: the single-file `STET.exe` described above. Unzip and
  double-click; nothing to install. On the first start of a new version it
  unpacks once into `%LOCALAPPDATA%\STET\runtime` and removes older ones.
- `STET-Setup.exe`: the installer. Per user, no administrator needed; Start
  menu and optional desktop shortcut, `.stet` files open in STET, uninstall from
  Settings > Apps. It looks for an installed STET first (Windows' uninstall
  entry for its fixed AppId): with none it installs; with an older version it
  updates in place after one confirmation, keeping the earlier shortcut choice
  and closing a running STET first (which saves as usual); with the same version
  it offers to open STET or reinstall it; with a newer version it stops, so it
  never downgrades.
- `STET-macOS.dmg`: STET.app for Macs with Apple silicon (macOS 12 or later),
  with a link to Applications to drag it to. `.stet` files open in STET from the
  Finder. It is signed ad hoc, not with an Apple Developer ID, so macOS asks once
  before the first start (README.md says how); signing with a Developer ID and
  notarizing would remove that, and needs a paid Apple developer account.
- `STET-Patch-electron-<version>.zip`: the in-app update, about a megabyte. Just
  STET's own files (what goes into `app.asar`), for a STET running on that
  Electron version, on Windows or the Mac alike.

To keep the downloads small, the build leaves out what never runs
(`scripts/package-tools.js`): type declarations, source maps and TypeScript
sources in `node_modules`, and Chromium's interface strings other than English
(on the Mac, the `.lproj` folders).
Most of what remains is Electron itself.

**In-app updates** (`src/main/update.js`, interface in `src/renderer/ui/update.js`).
A packaged STET asks the GitHub API for the latest release a few seconds after it
starts (Preferences can turn this off; Help → Check for Updates asks on demand).
If it is newer, an UPDATE button appears in the status bar, and the update window
opens once per new version with that release's notes. *Update now* downloads the
file for this copy in the background, checking it against the size and SHA-256
GitHub publishes. *Restart now* saves everything as when closing, then:

- a release with a patch for the Electron STET runs on (almost every release):
  the patch was unpacked into `%LOCALAPPDATA%\STET\app\<version>` (on a Mac
  `~/Library/Application Support/STET/app/<version>`) when it downloaded, and STET just restarts. `src/main/boot.js`, the entry point, starts
  the newest patch made for this Electron that is newer than the shipped version
  (`src/main/patch.js`). The program files are never touched. A patch that
  doesn't get as far as its window on its first start is marked failed and never
  used again (the shipped version, or the previous patch, starts instead, and
  the next update is the full download). Older patches are removed on the next
  start. In tests, `STET_PATCH_DIR` stands in for that folder.

When a release moves to a new Electron, the full download is used:

- installed copy (`unins000.exe` beside the program): runs the new
  `STET-Setup.exe /VERYSILENT /relaunch=1 /waitpid=<pid>`. Nothing shows on
  screen: it waits until every STET process has closed, updates in place and
  opens STET again;
- portable copy (the launcher passes its own path as `STET_PORTABLE_EXE`):
  unpacks the new `STET.exe` beside it as `STET.exe.new`, swaps it in by renaming
  (the previous one stays as `STET.exe.old` until the next start) and relaunches it;
- anything else (a Mac, running from source, a `dist` folder) only offers the
  download page.

Nothing changes on disk unless the download checked out. `STET_UPDATE_URL`
points the check at another address (the tests use a local stand-in for GitHub);
with `--e2e`, `STET_UPDATE_TARGET` stands in a portable STET.exe and quitting is
skipped. The check needs the repository to be public: GitHub answers 404 for a
private one, which STET reports as "No published version of STET was found."

**User data is never touched.** Settings, writing statistics, recovery copies
and the Claude connection live in `%APPDATA%\STET` (Electron's `userData` for
the app name STET); screenplays live wherever they were saved (by default
`Documents\STET`). Both are outside the program folder
(`%LOCALAPPDATA%\Programs\STET`) that the installer replaces, and the
uninstaller removes only the program, its shortcuts and its file association.
The portable STET.exe and the installed STET share the same data. On a Mac the
data is in `~/Library/Application Support/STET`, and STET.app is never changed by
an update.

The programs are not code-signed, so Windows SmartScreen warns on first run
("Windows protected your PC" → *More info* → *Run anyway*). Signing them in the
workflow would remove that warning.

### Tests and measurements

| command | what it does |
|---|---|
| `npm test` | unit and integration tests (about 200, in `test/*.test.js`): formatting and pagination, editing and undo, file format round-trips and repair, safe saving, backups and crash recovery, PDF output, word counting and writing statistics, the streak, updates and patches, packaging, file links, the writing companion. Each file says what it covers |
| `npm run quick` | the routine check, about half a minute: every unit test plus the smoke test (`test/e2e/smoke.e2e.js`: one start of the real app, then writing, the Tab cycle, element and alignment changes, scene navigation, a changed shortcut, saving, reopening and the PDF). Run it before every push |
| `npm run smoke` | the smoke test alone, about ten seconds |
| `npm run e2e` | drives the real app over the DevTools protocol with real key events (`test/e2e/*.e2e.js`): writing and element flow, styles, notes, find, zoom, themes, saving and recovery, PDF, the English revision against a mock API and a fake Claude Code, statistics and the streak, Open Recent, character completion, file links, updates, the companion, layout and caret alignment. Three files run at a time (the performance probe alone, after them); the whole suite takes about two minutes. Run it before a release or after a change to an area the smoke test doesn't reach. `STET_E2E_EXE=path\to\STET.exe npm run e2e` runs it against a packaged build |
| `npm run bench` | engine benchmarks (Node) |
| `npm run perf` | in-app performance probe; writes `.perf/renderer-results.json` |

Results and test conditions: [docs/PERFORMANCE.md](PERFORMANCE.md).

## Writing

| key | action |
|---|---|
| Enter | next element (scene → action, cue → dialogue, dialogue → action …); on an empty element, steps back to Action, then Scene Heading |
| Tab / Shift+Tab | the next (previous) element type in the toolbar's order, among those outlined there (all by default: Ctrl+click a type, or drag an end of the outline, to choose). Like every change of element, it applies to the selection, or to what is written next: in written text a new element starts at the caret |
| Ctrl+1 … 7 | Scene Heading · Action · Character · Dialogue · Parenthetical · Transition · Shot (the selection, or what is written next) |
| Ctrl+L · E · R · J | align left · centre · right · justify (the selection, or what is written next) |
| Shift+Enter | line break inside an element |
| `(` on an empty dialogue line | starts a parenthetical |
| `int.` / `ext.` in action | becomes a scene heading |
| typing a character cue | the rest of a name already used in the script shows in grey (most recently used first, kept in the .stet file): Enter, Tab or → takes it, Escape hides it |
| Ctrl+B · Ctrl+I · Ctrl+U · Ctrl+D | bold · italic · underline · strikethrough — on the selection, or with none for what you type next (also the B I U S buttons after the highlights, and the Format menu) |
| Alt+1 / 2 / 3 / 0 | highlight blue / yellow / pink / remove |
| Ctrl+Alt+M · F8 · Shift+F8 | add note · next · previous |
| Ctrl+F · Ctrl+H · F3 | find · replace · next |
| Alt+↑/↓ · Ctrl+G · PgUp/PgDn | previous/next scene · go to page · page |
| Ctrl+wheel · Ctrl+= / − / 0 | zoom, in exact 5-point steps |
| Ctrl+Shift+T | the timeline (below) |
| LIGHT · DARK · AUTO (bottom right) · Ctrl+Shift+L | theme; AUTO follows a schedule — right-click it to set the dark and light start times (AM/PM). Picking LIGHT or DARK turns the schedule off |
| Ctrl+K | command palette — every command, searchable |
| Ctrl+P · Ctrl+Shift+E | print preview · export PDF |
| F9 | your writing week: progress, goals, statistics |
| F1 | all shortcuts |

## Timeline

*View → Timeline* (Ctrl+Shift+T; off until turned on, and remembered) is a strip under the
toolbar with the whole script from left to right, a page to a unit, like a track in a
sequencer (`src/core/timeline.js` for the arithmetic, `src/renderer/timeline.js` for the bar).
The bar stays quiet and explains nothing in words: the cursor says what a drag will do. It
shows the script as a white line (grey in light mode), coloured where passages are
highlighted, a small tick for each scene, an icon for each note, a time ruler that ends in the
estimated length, the caret (the line with a cap) and a soft band for the part of the script
in the window. With the pointer on it, the grid comes in and a small readout gives the time
and scene under the pointer. The pointer is drawn to a scene, note, highlight or timecode within a few pixels
(`snapTo`), and the mark lights up. Clicking goes to the line drawn there (a scene to its
heading, a note to its passage, with the note open). Dragging sideways anywhere zooms around
the point pressed (right zooms in, down to about 100 pixels a second; left-right arrow
cursor); the band (hand cursor; its edges show) moves the window over the script. Moving
over the bar with Ctrl held (Cmd on a Mac), no click needed, steps a whole second at a time
from where Ctrl was first held (`fineTime`; at least 8 pixels a second, wider when zoomed in):
the caret and the window follow, the readout shows the exact second, a right-click there offers
that second for a timecode, and letting go of Ctrl leaves the caret there. The round button
centred on the right, or a double-click on the ruler or the band, shows the whole script.
The wheel scrolls it and Ctrl+wheel zooms; the grid steps between 1 second and an hour so it
stays readable, and the ruler is drawn only around the part in view.

The ruler under it counts a minute a page. Right-click → *Add Timecode Here…* pins the time,
as HH:MM:SS, at the start of the line there: between two timecodes the time is spread evenly,
and after the last one the rest of the script runs at the pace measured up to it (its time
over its pages), so the length at the right end is the estimate. A timecode has to be later
than the ones before it and earlier than the ones after; right-click it to change or remove
it. Timecodes are kept with their line as you edit and saved in the .stet file.

## English revision (Claude)

*Tools → English Revision* (Ctrl+Shift+R, or **REVISE** in the toolbar) reviews
the action, dialogue and parentheticals with Claude (`claude-opus-5-5`) and
lists findings in the order their passages appear in the script, each named as a
**Grammar Error**, **Non-Native Construction** or **Awkward Phrasing**, with the
original, a minimal replacement, a short explanation and a confidence level. Flagged passages are underlined in the
script (solid / dashed / dotted). F7 / Shift+F7 move between suggestions.

- Per suggestion: **Accept** (one undo step), **Discard**, **Ignore**
  (remembered in this screenplay's .stet file — never flagged again here) and
  **+Dictionary** (shared by every screenplay). *Accept all…* (all, or one kind)
  asks first and is a single undo step. Decided suggestions move to a folded
  *Decided* group, also in script order; near the lower end of the list a floating
  **DECIDED** button goes there while it is out of sight. **Reopen** makes one
  undecided again; one reopened after accepting keeps pointing at its change, and
  accepting it again only records the decision.
- **Suggestions stay until you decide.** Their text, replacement, explanation,
  category and decision never change because you edited the script. Hover a
  suggestion to highlight exactly its passage; if edits make the passage
  impossible to identify reliably, the suggestion stays and says so — nothing
  else is ever highlighted or replaced in its place.
- The latest review and every decision are saved in the .stet file, so they
  survive restarts. Running a review again replaces them completely.
- Clicking anywhere on a suggestion glides its passage smoothly to the middle of the screen
  (straight there with reduced motion) and selects it. Review marks are neutral
  greys, so the text stays readable; colour is kept for your own highlights.
- While Claude works, the panel shows an indeterminate progress bar, the
  current stage, sections done and elapsed time; you can keep writing.
- **No setup if you use Claude:** with no API key, STET runs the review through
  Claude Code (the copy inside the Claude desktop app, wherever its version
  keeps it, or a `claude` install) on your existing Claude sign-in — it counts
  toward your plan's usage. The sign-in is checked first (without using the
  model), so a signed-out Claude Code is one clear message. It runs in print
  mode with every tool, MCP server, settings file, skill and saved session
  switched off, in an empty temporary folder; the script goes in on stdin and
  answers come back in the findings schema.
- **API key (optional):** paste one under *Tools → Claude Connection…* to bill an
  Anthropic API account instead. Encrypted with Windows DPAPI (Electron
  safeStorage) in the app's settings folder, used only by the main process,
  never shown to the editor UI and never written into screenplays.
  `ANTHROPIC_API_KEY` in the environment also works.
- **Your choice of connection:** *Tools → Claude Connection…* → *Connect
  through*: **Automatic** (an API key if one is set, otherwise your Claude
  sign-in), **Claude sign-in** (never a key) or **API key** (never Claude
  Code). STET never switches by itself: if the chosen one isn't available or
  fails, the review says what to do and mentions the other one when it is set
  up. *Check* tests the connection.
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
- **F9** (or click TODAY) shows your week: two boxes at the top with just this
  week's and today's words against their targets, a chart with every day's
  exact number printed on it and the goal line, and a few plain facts (days
  written, goal met, best day, writing streak). The chart's scale follows the week, from a few dozen words to
  tens of thousands a day; a day far above the rest is drawn with a break in
  its bar so the other days stay readable. ‹ › browse earlier weeks. Days
  before statistics began show "—", not zero.
- **Reset statistics…** in that view is the only way to clear them. It asks
  first, says exactly what will be cleared (all recorded writing; not your
  screenplays, word counts, goals or writing streak), and only the Reset button confirms —
  Cancel, Escape or clicking outside change nothing. A copy of what was
  cleared is kept in the data folder.

### Writing streak

Beside TODAY in the status bar, a little flame and the number of days on which
you reached your daily goal (calendar days, local time; with no daily goal
set, any day with a new word). Today joins the streak once you reach the goal,
and a day that isn't over yet never breaks it. Up to two days a week (Monday
to Sunday) may miss the goal, together or days apart, and the streak carries
on; a third in the same week ends it. Every day that misses the goal uses one,
whether a streak is running or not; reaching it again doesn't give one back,
and every Monday brings two new ones. A little shield beside the flame shows
how many rest days are left this week (hover it for the details); it is dimmed
when none are. Each day keeps the goal it was written under, so changing your
goal never changes earlier days. The weekly view's goal streak is the same streak. Opening, importing or pasting
text never counts, and writing in several screenplays on one day counts once.
It is kept with your statistics, so restarts and new versions keep it (and so
does a Reset).

The dinosaur grows with it: one pixel at 1, 2, 4, 8, 16 and 32 days in a row —
six at most, crisp at every size — and every second milestone (2, 8 and 32
days) unlocks a special routine it may take up now and then: a skateboard
ride, a few tiny fireworks, and a rain dance that ends under a palm tree. When
a streak ends it is back to its first size, and the next streak starts the
progression again.

## Writing companion

A tiny 8-bit dinosaur lives on the edge of the desk, standing on the status
bar's top line, with a life of its own (it takes up no room: the editor and
everything else work underneath it as before). Its home is the stretch above
TODAY, but the whole width of the editor is its playground: now and then
curiosity takes it out towards the ends, and very, very rarely it walks all
the way to the bottom-left corner of the window to have a bite at the border.
It walks whenever it moves, one step at a time, and never slides. When STET is
in the background (you're working in another program), tufts of grass slowly
come up around it, five at most, and it leaves them alone; after a long while
away it curls up for a deep sleep. When you come back it wakes slowly, and once
you're writing again it gets round to the grass in its own time, a bite at a
time. While it sleeps like that, STET rests too: the dinosaur lies still,
nothing animates and the background checks slow down, so the app uses next to
nothing until you click back into it — then everything is there at once. It walks, runs and
paces about, naps and dozes, stretches and does its yoga, chases a ball and
its tail, digs up bones (and sometimes a disappointing pebble), builds little
mounds of earth, reads a page of its own, takes a coffee break, sings, blows
bubbles, stands on its head, watches leaves fall and butterflies go by, and —
while you're writing — sometimes types along on a tiny typewriter or just
watches the page fill up. Sometimes it just lies on its front, chin up, and
watches the sky. Even its everyday things come out a little different each
time — a rest with a tail tap or a scratch, a walk at its own pace with a sniff
on the way, a dance with a favourite move of the day. Before a proper rest it
often makes its bed (round and round, a scrape, a flop and a sigh), and it
likes to line up pebbles in a neat little row. Once in a while it does a
balancing act along the line it stands on, or plants a seed and waits for the
flower to come up. Its mood drifts over the
day, and it remembers what it did recently, so it doesn't repeat itself.

Its little world has a life too, now and then and never two things at once: a
rain cloud drifts over and rains on it, a breeze gets up, a bird drops by, a
tumbleweed rolls through, a star falls at night, a cactus, a tuft of grass or
a palm comes up out of the ground (it notices in its own time, and may go over
to sniff it, nibble the grass or find out the hard way about the cactus, before
the plant withers away again); it may grow a palm tree and
sit in its shade (or shake it for a coconut), find a flower, bounce on a
mushroom, meet a snail, splash in the puddle the rain left, or watch the
fireflies. Visitors turn up too: a balloon on the breeze (it jumps for the
string), a paper plane, a frog to hop along with, a ladybird that climbs onto
its head, a dandelion to blow, a worm that is always a moment quicker. When the
theme turns dark or light on its own (AUTO), it stops to watch: the sun goes
down, it waves goodnight and lies chin up as the moon rises and the stars come
out — or the sun comes up, wakes it, and gets a good-morning roar. What it does about the rain depends on what it was doing — it sleeps
through it, shelters under the palm, runs for it (the cloud follows), catches
the drops, dances in it, or holds a leaf over its head.

Its energy comes from the words you actually write (not pastes, not opening
files, not the clock) and changes gradually; idle, it calms down and dozes.
The pointer passing over it does nothing. Click it and it notices at once (a
blink and a little start), then reacts to fit what it was doing: stopped
mid-stride, guarding its bone, a *ding* on the typewriter, hiding behind the
palm tree, talking in its sleep — or anything from a nod to something
ridiculous, sometimes after a beat, sometimes with a shrug, and with mounting
indignation if you keep clicking. A pose it is just
holding gives way immediately; a step, jump or stride in progress always
finishes first, so nothing is cut off or sped up. It mostly keeps to the
middle of its patch and never wanders out of sight. *View → Hide Writing Companion* turns it off. It redraws a tiny canvas a
few times a second at most, and not at all while the window is hidden.

## Open Recent

Hover *Open Recent…* in the File menu for a quick list of your last ten
screenplays beside it: click one to open it. Long titles end in "…" (hover for
the full path), the one already open is dimmed, and a missing file can't be picked.
Click *Open Recent…* itself for the full window.

*File → Open Recent…* (Ctrl+Shift+O). Hover a project for three actions: the
**folder icon** (*Show in Folder*) shows the file in its folder; **×**
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

- [Architecture](ARCHITECTURE.md) — modules, editing pipeline, pagination rules, integrity design
- [File format](FILE_FORMAT.md) — `.stet` container and schema, versioning, migrations
- [Performance](PERFORMANCE.md) — measured results and conditions
- [Native code](NATIVE.md) — the C/WebAssembly word-count experiment and why it isn't shipped (measured)
- [Changelog](../CHANGELOG.md) — one git commit and tag per version; also in the app under *Help → Changelog*

## Known limitations

- **Dual dialogue, scene numbers, revision marks / colored pages, Final Draft
  (.fdx) export and Fountain import/export** are not implemented (.fdx import is).
  Plain-text paste does recover element types (Fountain-like heuristics).
- Pages are **A4 only**, laid out as Final Draft lays out its pages (54 lines of body from 1in down, the page number 0.5in down ending 7.25in from the left).
- A speech of several paragraphs breaks between them, without (MORE) / (CONT'D), as
  Final Draft does; a paragraph too long to move whole, and action, split at line
  boundaries (with 2-line widow/orphan control), not preferentially at sentence ends.
- PDF text uses STET Courier (src/fonts: Bitstream's Courier 10 Pitch, thinned to
  the weight of Final Draft's Courier and made into TrueType by scripts/make-fonts.py),
  set 7pt a character as Final Draft sets it, embedded, with WinAnsi (cp1252) encoding:
  characters outside Western European scripts print as "?" in the PDF (the
  editor and OS printing show them correctly), and the euro sign, which the font
  lacks, prints in the standard Courier.
- The OS print path (Ctrl+P → Print…) is exercised up to Electron's print
  call; driving the native print dialog is not covered by automated tests.
- Builds made locally with `npm run exe` are portable and don't associate `.stet`
  files with STET in Explorer until Help → Open .stet Files with STET; the installer
  from a release does (a task, ticked by default). Windows keeps a program someone
  chose earlier with "Always use this app" (UserChoice), which no program may change:
  STET then says how to change it.
- Spell-checking is off (it would fight the custom renderer).
- Writing statistics can't tell retyping from new writing: if you delete an old
  passage and type it again from memory, the retyped words count as written.
