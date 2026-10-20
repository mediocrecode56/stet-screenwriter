# Changelog

What changed in each version of STET, and why it matters to you.

STET is in beta, so version numbers stay below 1.0. Every version is saved as its own snapshot (a tagged git commit, `vX.Y.Z`) and gets its own Windows program in `dist\STET-vX.Y.Z-win32-x64\STET.exe`. From 0.6.0 on, the newest version is also always available as a single file, `Documents\STET\STET.exe`.

## 0.7.0 — 20 October 2026

Word counting and writing statistics rebuilt from the ground up, a clearer weekly progress view with a safe Reset, and a dinosaur with a lot more personality.

### New

- **Your writing is recorded across every screenplay, for good.** STET now keeps a running record of the words you actually write — per day, per week, per screenplay and in total — across all your projects, including new ones. It is kept in STET's data folder, separate from the program, so it survives closing STET, restarting the computer, replacing STET.exe and installing newer versions. Your statistics from 0.6 are carried over automatically.
- **A clear weekly view (F9, or click TODAY).** This week's total and today's progress towards your goals are at the top. Below is a simple chart with every day's word count printed above its bar and a dashed line for your daily goal: solid bars are days you reached it, grey bars days you wrote less, and dotted ones days still to come. Days from before statistics began show "—" rather than a misleading zero. A short line sums up the week (days written, goal met, best day, streak), and a small list shows which screenplays the words went into. Use ‹ › to look at earlier weeks.
- **Reset statistics, safely.** A small *Reset statistics…* button in the weekly view is the only way to clear your statistics. It never erases anything straight away: a confirmation says exactly what will be cleared (all recorded writing — not your screenplays, their word counts or your goals) and only the *Reset statistics* button confirms. Cancel, Escape or clicking outside leave everything as it was. If the reset can't be saved, nothing is cleared and STET tells you. A copy of the cleared statistics is kept in STET's data folder.
- **The dinosaur has a life of its own.** It now plays with things: it chases and kicks a ball, digs up a bone and chews it (or buries it for later, or turns up a disappointing pebble), watches a leaf drift down and tries to catch it, chases butterflies, balances a ball on its nose, and walks off the edge of the bar to peek back in. While you're writing it sometimes sits down at a tiny typewriter and types along. It has moods that drift through the day (playful, curious, sleepy, grumpy, silly), stargazes late at night, celebrates when you reach your daily goal, and every so often something rare and strange happens.
- **The dinosaur notices you.** Move the pointer near it and it may glance your way or show a little heart — without interrupting what it's doing.

### Improved

- **Clicking the dinosaur is full of surprises.** There are now more than 30 reactions, from a quiet blink or a wave to a backflip, fainting, playing dead, putting on a party hat, bringing you a bone or bowing. Which one you get is random but weighted, it avoids repeating itself, and it sometimes reacts after a beat, sometimes notices a moment later — and sometimes carries on as if nothing happened. Click a lot in a row and it gets dizzy, annoyed, or storms off. Reactions still wait for the end of its current move, and it always gets up properly instead of jumping between poses.
- **Ctrl + mouse wheel zooms in steps of 5 percentage points** (100 → 105 → 110 %), instead of 2. Everything else about wheel zoom is unchanged.

### Fixed

- **TODAY stopped counting after you deleted text.** In 0.6, TODAY only counted words once the screenplay grew past its largest size that day, so after cutting a passage, nothing you typed counted until you had made up the difference. Now every word you write counts the moment you write it, whatever you deleted before. Deleting never takes away writing you've already done; only fixing words you have just typed (a typo, a phrase you rephrase on the spot) is netted out, so a corrected word isn't counted twice.
- **Statistics could be lost or overwritten.** They used to be saved every few seconds as a whole by the window, and a crash in between lost the latest words. Words now reach the saved copy within a quarter of a second, the file is backed up daily, and a damaged file is set aside and the backup used instead of silently starting from zero.
- **Opening, switching and reopening never count as writing.** Opening a 10,000-word screenplay adds nothing, nor does switching between screenplays, restoring a backup or undoing and redoing.
- **One clear rule for what a word is.** For example, *don't*, *well-known*, *3.5* and *(V.O.)* are one word each; *wait—what* is two; a lone "—" or "…" isn't a word. Tabs, several spaces, line breaks and non-breaking spaces all just separate words, and Chinese and Japanese characters count one word each. The status bar total is checked against a full recount in the background, so it can't drift.

### For the technically curious

- The editor now gives every edit a word *credit* (typing earns words, paste and replace earn none, undo returns exactly what the edit earned, redo gives it back). A ledger books those credits per day and per screenplay, in the window for an instant TODAY and in the main process for the saved copy (`%APPDATA%\STET\stats.json`, format version 2), in numbered batches that are never booked twice.
- New tests: the word rule checked against a separate reference implementation on 20,000 random strings, a 20,000-edit fuzz of the count and the credits, the statistics ledger and its file (restarts, upgrade from 0.6, damaged files, failed reset, a year of heavy use), the dinosaur simulated for hours at a time, and end-to-end tests in the real app including a restart, a crash and the whole Reset flow.

## 0.6.1 — 19 October 2026

### Fixed

- **The line above the toolbar no longer runs over REVISE.** The thin line that separates the menu bar from the toolbar now ends a small margin (12 px) before the REVISE button instead of running across the top of REVISE, SCENES and NOTES. It looks the same in light and dark mode.

## 0.6.0 — 19 October 2026

English Revision suggestions now stay put until you decide, word counting is reliable again, and a small pixel dinosaur keeps you company while you write.

### New

- **Suggestions stay until you decide.** Each suggestion keeps its original text, proposed replacement, explanation, category and confidence exactly as Claude wrote them, until you click Accept, Discard, Ignore or +Dictionary. Editing your script never changes, removes or resolves a suggestion on its own.
- **Hover to see where.** Pointing at a suggestion highlights exactly the passage it refers to in the script; moving away removes the highlight. If your edits mean the passage can no longer be identified with certainty, the suggestion stays in the list with a note saying so. STET never highlights a different passage by guessing.
- **Suggestions and decisions are saved with your screenplay.** They're stored in the .stet file, so they are still there after you close STET or restart the computer.
- **Clear progress while Claude works.** The English Revision panel shows a calm animated bar, what is happening ("Sending the script to Claude…", "Claude is reviewing your script…", "Checking the suggestions…"), how many sections are done and how long it has taken. Because Claude can't report how far along it is, the bar never shows a made-up percentage. You can keep writing, and Cancel, network errors and failed sections each get a clear message. The indicator disappears when the review finishes, fails or is cancelled.
- **Tidy up Open Recent.** Hover over a project to show two small icons: **×** removes it from the list without touching the file, and the **bin icon** moves the file to the Windows Recycle Bin after you confirm. Nothing is ever permanently deleted. Missing files are marked; the screenplay that's currently open can't be binned.
- **A writing companion.** A tiny 8-bit dinosaur lives just above TODAY. It walks about, looks around, stretches, sits, naps and now and then does something silly. The more you actually write, the livelier it gets; when you stop, it gradually calms down and eventually dozes off. Pasting, opening files or time passing doesn't excite it. Click it and it reacts: startled, faints, pretends nothing happened, dances, roars back… The reaction joins in at its next natural moment rather than cutting its current move short. Turn it off with *View → Hide Writing Companion*.
- **One always-current STET.exe.** Every build now also writes the newest version as a single, self-contained file: `Documents\STET\STET.exe`. The versioned copies in `dist` are kept as before. The single file is only replaced after a new build has succeeded and been checked, so a failed build never breaks it. On the first launch of a new version it unpacks once, showing a small "preparing" window; after that it starts straight away.

### Improved

- **Ctrl + mouse wheel zoom is precise.** Each wheel notch now changes the zoom by exactly 2 percentage points (100 → 102 → 104 %), in and out. A fast spin can't jump by more than one step at a time, trackpad pinches add up evenly, and the 50–300 % limits are unchanged.
- **Calmer, smoother animation everywhere.** All motion now uses one shared set of gentle easing curves with no bounce or overshoot. Toolbar buttons change colour smoothly instead of popping, and pressed and active states still appear instantly. Side panels slide in and out with a smooth start and stop at about the same speed as before, and reverse cleanly if you toggle them mid-way. Menus and dialogs fade in briefly. With Windows' "Animation effects" setting turned off, interface motion is switched off too.
- **The status bar no longer shifts sideways** when you switch between element types (SCENE HEADING ↔ DIALOGUE and so on), because its labels now have fixed widths.
- **Toolbar spacing.** Highlighted toolbar buttons, such as REVISE when its panel is open, now sit inside the toolbar with a small even margin instead of running into the separator lines above and below them.
- **English Revision decisions are simpler.** The five buttons are now four clear choices: Accept, Discard, Ignore and +Dictionary. Decided suggestions move to a folded "Decided" group, and Reopen makes one undecided again. Running a review again replaces all suggestions and decisions from the previous review; it asks first if some are still undecided. Your Ignore list and dictionary are kept.
- TODAY updates within a fraction of a second after you type (it used to wait 1.5 seconds).

### Fixed

- **Word counting stopped counting after some pastes.** The WORDS total was always right, but TODAY could freeze for a long time:
  - After a paste, STET set aside the pasted text's word count as "not your writing". If you then undid the paste, pasted over a selection, or pasted into the middle of a word, that amount was wrong and never given back, so new typing didn't count until you had typed past it.
  - Now STET measures how many words each change actually added or removed, and undoing or redoing a paste or replace gives the allowance back.
  - Every change is recorded immediately, so switching documents straight after typing can't credit words to the wrong script.
  - Covered by new regression tests: typing, large and repeated pastes, odd whitespace, deleting everything, undo/redo, switching documents and reopening, plus a 3,000-step random-editing check.

### For the technically curious

- Suggestions are found again after edits by comparing the old and new text of the element exactly, then by the same words with the same surrounding context, and only then by a distinctive phrase that appears exactly once. Otherwise the suggestion is reported as not locatable.
- The review is saved in the .stet file under `revision.review`; element positions are stored by index because block ids are not saved. Older STET versions ignore this field.
- The single-file STET.exe is built with the C# compiler included in Windows (`csc.exe`, .NET Framework 4), with the packaged app embedded as a zip. It unpacks to `%LOCALAPPDATA%\STET\runtime\<version>` and cleans up older unpacked versions that aren't in use.
- Tests: 89 unit tests and 35 end-to-end tests, all passing.

## 0.5.0 — 19 October 2026

English Revision works without an API key.

### New

- **No API key needed.** If you use Claude, the English review now runs through Claude Code with the Claude account you are already signed in to. STET finds the copy that comes with the Claude desktop app automatically, or a separate `claude` installation. Reviews count toward your Claude plan's usage.
- It runs in a locked-down way: Claude Code gets the script text and nothing else (no tools, plugins, settings, skills or saved history) in a temporary folder that is deleted afterwards. The same model, instructions and checks are used as with an API key.
- Clear messages if Claude Code is signed out, has reached a usage limit, or returns something unreadable. Cancel stops the review immediately.

### Improved

- *Tools → Claude API Key…* is now *Tools → Claude Connection…* and shows which connection STET will use. An API key is now optional; if you add one, it takes priority.
- The confirmation before a review says whether it uses your Claude plan or your API account.

## 0.4.0 — 19 October 2026

English Revision with Claude.

### New

- **English Revision** (*Tools* menu, **REVISE** in the toolbar, or Ctrl+Shift+R). Claude reads your action, dialogue and parentheticals and suggests minimal fixes in three groups:
  - **Grammar Error**: plain mistakes.
  - **Non-Native Construction**: phrasing that reads like a translation.
  - **Awkward Phrasing**: correct but clumsy.
  
  Each suggestion shows the original, the replacement, a short explanation and how confident Claude is.
- **Your voice is protected.** Dialogue isn't made formal; slang, dialect and sentence fragments are left alone; screenplay conventions aren't "corrected"; anything that may be deliberate is flagged cautiously or not at all.
- Flagged passages are underlined in the script, with a different style per group. F7 / Shift+F7 jump between them.
- **Ignore** remembers a passage in this screenplay so it is never flagged again. **+Dict** adds words to a personal dictionary used for every screenplay (*Tools → Dictionary & Ignored…* to edit both). *Accept all*, per group or overall, asks first and can be undone in one step.
- Nothing changes in your script until you accept a suggestion. Every suggestion is checked against the text it was made for, and overlapping suggestions are never both applied.
- Long scripts are reviewed in sections that follow scene breaks, three at a time, with automatic retries if the service is busy. Failed sections can be retried, and the whole review can be cancelled.
- **Privacy:** the script is sent only when you press Review, after a confirmation showing how much will be sent. The title page and your notes are never sent, and Claude is never called automatically. An API key is stored encrypted by Windows and never written into screenplay files.

### Improved

- No more INT./EXT. prompt while typing a scene heading. Location and time-of-day suggestions after the prefix remain.
- Ctrl+F opens and closes Find & Replace; Escape closes it.

## 0.3.1 — 19 October 2026

The caret no longer covers your text.

### Fixed

- **The blinking caret drifted into the text, more so on long lines.** Script pages inherited a tiny amount of letter spacing from the interface, so letters were drawn about 0.2 px wider than STET calculated, which added up to 13 px by the end of a line. Script text is now fully isolated from interface typography, and the real letter width is measured on screen, re-measured when you zoom, change display scaling or move the window to another monitor.
- The caret now sits just after a letter instead of over it, and is aligned to whole screen pixels so it stays sharp at 125 %, 150 % and 200 % display scaling.

### For the technically curious

- Worst-case caret misalignment went from 12.8 px to 0.02 px across 4 display scales × 3 zoom levels (`bench/caret-drift.js`). A new end-to-end test checks the caret, selection and clicks against the painted letters.

## 0.3.0 — 19 October 2026

Easier on the eyes, automatic theme switching, snappier controls and an icon.

### New

- **Automatic theme schedule.** Choose when dark mode and light mode start, with AM/PM times (right-click AUTO, *View → Theme Schedule…*, or Preferences). It works across midnight and notices clock, time-zone and sleep/wake changes. Picking LIGHT or DARK by hand turns the schedule off, so it never overrides you.
- **The theme switch is in the status bar** (LIGHT · DARK · AUTO), always visible.
- **STET has an icon:** a line of text, the typing caret, and the proofreader's "stet" dots ("let it stand"). It's used for the window, the taskbar and the program file.

### Improved

- **Dark mode is brighter and light mode slightly deeper,** with clearly higher contrast for secondary text in both. Highlight colours were retuned to stay readable on the new page colours.
- **Toolbar buttons respond instantly** when pressed. Panels and menus appear fully on their first frame. Switching theme or panels no longer redraws every page.
- **Faster word counting:** 2.5× faster on English and almost 10× on Cyrillic text.

### For the technically curious

- A C version of the word counter (compiled to WebAssembly) was built and measured. It wasn't faster than the improved JavaScript, so it isn't included (`docs/NATIVE.md`).

## 0.2.1 — 19 October 2026

### New

- A Windows program file (`STET.exe`) is built for every version, each from its own saved snapshot, into `dist\STET-vX.Y.Z-win32-x64\`.

## 0.2.0 — 19 October 2026

Verified, measured and packaged.

### Fixed

- Pressing Tab at the end of a dialogue line now starts a parenthetical on the next line instead of turning the dialogue into something else.
- **Crash recovery is safer.** If a script was left with unsaved changes by a crash, opening it now offers to restore them first, after backing up the file on disk. Previously the first autosave could overwrite those changes.
- STET only deletes recovery copies it created or restored itself.
- Find no longer re-searches on every single keystroke, which keeps typing smooth.
- With side panels open, a page wider than the window is centred on the text instead of being cut off.
- Smaller fixes to dialog fields, checkboxes and print preview thumbnails, which are now readable.

### New

- Automated tests that drive the real app, plus engine tests (54 at the time), benchmarks and an in-app performance check (*Tools → Run Performance Probe*).
- Documentation: architecture, file format, performance results and the native-code decision.

## 0.1.0 — 19 October 2026

The first working version.

### Writing

- Standard US screenplay formatting (Courier 12 pt, industry margins) with correct page breaks: headings and character names stay with what follows, speeches split across pages get (MORE) and (CONT'D), and widows and orphans are avoided.
- Final Draft–style element flow: Enter and Tab move between scene heading, action, character, parenthetical, dialogue and transition; Ctrl+1…7 set the element; typing "int." starts a scene heading; "(" starts a parenthetical.
- Suggestions while you type for locations, times of day, character names and transitions; character names are capitalised on first appearance in action.
- Undo and redo grouped by word, mouse and keyboard selection, copy and paste that keeps formatting, find and replace, and zoom.

### Your work is safe

- STET's own `.stet` file format with a checksum, so damage is detected rather than silently loaded.
- Every save is written safely and verified; autosave; crash recovery; automatic backups every 5 minutes, kept for 30 days (the last good copy is never deleted).

### Pages and output

- Title page edited in place; empty fields are never printed.
- Print preview, PDF export and printing, with page ranges and optional title page, highlights and notes.

### Interface

- Monochrome light and dark themes, a command palette (Ctrl+K), scene navigator and notes panel.
- Highlights in three colours, and comments with navigation.
- Writing goals: daily and weekly targets, counting only new words you write, with averages, streaks and a 28-day chart.
