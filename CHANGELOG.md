# What's new

Every version of STET, newest first. The newest one is always on the [download page](https://github.com/mediocrecode56/stet-screenwriter/releases/latest).

## 0.60.1 · 13 Nov 2026

### BUGS, PERFORMANCE

- STET uses less memory: about 130 MB instead of 148 MB with a feature-length script open and spelling on. The spelling dictionary takes a third of the room it did, and STET runs one process fewer.
- A long writing session no longer slowly builds up memory: spelling stopped keeping notes on every earlier version of a paragraph that Undo remembers.
- A finished review lets go of its copy of the script straight away, unless a section failed and can be tried again.
- Quitting no longer leaves a stray temporary file in STET's settings folder each time, and the ones already there are cleared up a minute after starting.
- Updates and dictionaries you download are no longer also kept in a hidden download cache.

## 0.60.0 · 13 Nov 2026

### FEATURES

- Revise has a new Strict Review button beside the usual one. It reviews the script without your guidelines, so you see everything Claude finds.
- The Guidelines window is new: bigger, with one tab for every screenplay and one for this screenplay, a count of each kind of guideline you can press to see only those, and a field to find a passage. Each guideline says how often you set it aside and when.
- At the top of the Guidelines window, one sentence now tells you where your guidelines are taking the review. Claude writes it again each time you add or remove a guideline.
- What your guidelines hold back is no longer hidden. It sits in the Revise panel under Held Back, and Reopen brings a suggestion back.
- Spelling works on several words at once: select some text, right-click one of the underlined words in it, and correct, add or ignore all of them together.
- With no spelling dictionary on your computer, STET now offers to download one instead of doing it unasked. You can say not now, or never again. Until there is one, the Spelling button shows a small exclamation mark that tells you what is missing.

### BUGS, PERFORMANCE

- Your guidelines can no longer make a review go quiet. A clear error is always shown unless you set aside that very passage several times, a character's way of speaking alone never hides a suggestion, and fixing one missing word no longer teaches Revise to skip all the others.
- Scrolling the Guidelines window no longer slides the list over its first row.
- The day for Today, the week and the streak now follows the Windows clock exactly, and changes at midnight on the dot.
- Reviews use less of your Claude plan for the same findings.
- Resetting the passages ignored in a screenplay no longer clears the words you told Spelling to ignore.

## 0.59.0 · 9 Nov 2026

### BUGS, PERFORMANCE

- STET opens your last screenplay again at launch, even from a slow drive. Before, a drive that took a few seconds to wake up could leave you on a blank page, and typing there cancelled the reopening. Now typing waits until the screenplay is in, with an "Opening…" notice if it takes a while. A file another program is holding for a moment (a backup or sync tool) is tried again instead of skipped.
- Capitals come off again when a line goes back to an element that isn't in capitals, however the text got there. Before, text pasted into a scene heading, character, transition or shot, lines joined into one, and words replaced in one stayed in capitals for good.

## 0.58.0 · 8 Nov 2026

### FEATURES

- Revise keeps going when Claude has no usage left: if OpenAI Codex is installed and signed in on your computer, it takes over the rest of the review. If no Claude is set up at all, Revise uses Codex on its own. Tools → Claude Connection… says when Codex is there as the backup.

## 0.57.0 · 6 Nov 2026

### FEATURES

- Tools has a new Open STET in the Browser: an early version of STET that runs in any web browser, for writing away from your own computer. It opens and saves .stet files, and works on phones and tablets too. Nothing changes in the app if you don't use it.
- The dinosaur moves more naturally from one thing to the next: it catches its breath, stretches when it gets up, turns round before it settles, licks its lips after eating and sniffs before it digs.
- The Performance Probe now tells you plainly whether your computer runs STET smoothly, with a score from 0 to 100 and how reliable that result is. It shows its progress and can be cancelled.

### BUGS, PERFORMANCE

- The Performance Probe no longer freezes the window or gets stuck, and takes seconds instead of nearly a minute.
- The probe's score is now fair: fast computers no longer show as slow.
- Typing is lighter on long scripts with spelling turned on.
- In Focus Mode, the buttons that appear when you press Tab now work exactly like the toolbar's, also when the toolbar is hidden.
- Undo still works after running the Performance Probe.

## 0.56.0 · 5 Nov 2026

### FEATURES

- The View menu now says what each option will do: Show or Hide, Enter or Leave, Turn On or Turn Off. That includes the Writing Companion in Focus Mode, the Scene Navigator, the Notes Panel and the Timeline.

### BUGS, PERFORMANCE

- Pages keep the screenplay standard on A4: a full 1 inch margin on the right, so action no longer runs too far across.
- The page number sits exactly where it should, 1.25 inches from the right edge.
- Transitions and the title page follow the same margins.

## 0.55.1 · 5 Nov 2026

### BUGS, PERFORMANCE

- In Focus Mode, the SCENE, ACTION and other element buttons now appear on their own only when you press Tab, and stay for a few seconds so you can click them.
- Moving the pointer to the top of the screen in Focus Mode always shows the full toolbar.

## 0.55.0 · 5 Nov 2026

### FEATURES

- The title page slides in and out smoothly when you show or hide it, like the side panels.
- Focus Mode can be turned on and off in Preferences.
- Preferences has a Keyboard Shortcuts button that opens the shortcuts list.
- In Focus Mode, the SCENE, ACTION and other element buttons appear at the top left when you change the element or move the pointer there.
- View has a new option to keep the dinosaur in Focus Mode. It is off by default.

### BUGS, PERFORMANCE

- Showing or hiding the title page further down the script no longer moves your place.

## 0.54.1 · 3 Nov 2026

### BUGS, PERFORMANCE

- Highlights leave a little room above and below the words, like in a word processor, instead of sitting tight on the letters. The same in print and PDF.
- Find no longer shifts as you type: the match count keeps one width.
- Pressing Enter in Find glides to the match and places it near the middle of the window, the same way a click on the timeline does.

## 0.54.0 · 31 Oct 2026

### FEATURES

- Highlights have clearer, more natural colours: fuller pastels in light mode, deep rich tones in dark mode, with yellow a warm honey.
- Selected text over a highlight now shows a deeper shade of that colour, instead of turning it grey or metallic.
- The timeline marks and note colours match the new highlight colours.

### BUGS, PERFORMANCE

- The toolbar's colour swatches, B I U S and small icons are evenly spaced and centred.
- The right-click menu's buttons are the same width, with their icons lined up.
- SPELLING on the toolbar no longer shows a gap in the middle of the word.
- The panel lock icon has square corners, like the rest of STET.
- Behind the scenes: colours and icons are each defined in one place, so future changes are simpler and more consistent.

## 0.53.0 · 30 Oct 2026

### FEATURES

- The right-click menu shows the toolbar's icons for text style, alignment and highlight, instead of words.
- The words-per-minute count sits at the top right of the scene list.
- Words per minute counts only spoken dialogue. Notes like (beat) inside a line no longer count.
- Revise guidelines: a cleaner, easier-to-read list, with each detail on its own line and a small × to remove an entry.
- The dinosaur never freezes. While it rests it glances around, blinks or taps its tail every few seconds.
- The dinosaur gets a short break after a reaction, so several things no longer happen at once.
- Small things drift by now and then: a falling leaf, dandelion fluff, a butterfly, a feather, a firefly at night, a breeze. The dinosaur looks their way.
- New dinosaur habits: humming a tune, watching the clouds on its back, and dribbling a pebble.
- Preferences: the explanation under the automatic theme is gone, and each section has a clear heading.

### BUGS, PERFORMANCE

- The yellow and pink highlights look softer and more natural, in both themes and in print.
- The Clear Formatting button lines up with the other style buttons and has the same look.
- Revise guidelines: notes no longer sit under the label, and empty details no longer leave a stray dot.

## 0.52.0 · 30 Oct 2026

### FEATURES

- Highlights come in five colours: blue, yellow, pink, red and green. All are pale and easy to read.
- The right-click menu on selected text has a Highlight button.
- Its dropdowns open on a click only, and open like every other menu.
- A Clear Formatting button removes bold, italic, underline and strikethrough (Ctrl+Shift+Space).
- A small title page button on the toolbar shows or hides the title page.
- The first page of the script has a page number.
- Find is a compact box at the top right. Enter goes to the next match.
- While you use Find, the timeline marks where the match is.
- Timecode editor: scroll the mouse wheel over the hours, minutes or seconds to change them.
- Timecode editor: a click outside keeps what you typed.
- A timecode can be set at 00:00:00, at the very start or on the first scene.
- Timeline: click near a timecode's label to edit it. Higher up, a click goes to that line.
- Timeline: zoomed in, the left end has a fade and a whole-script button, like the right end.
- Notes panel: a colour filter shows only the notes of one colour, in the panel, the script and the timeline.
- Notes panel: CLEAR ALL deletes the notes listed, after a second press.
- Each note shows the scene it is in.
- The note you pinned last goes to the top. Drag pinned notes to reorder them.
- Scene list: the runtime and the dialogue's words per minute, at the bottom.
- A scene's timecode editor shows its dialogue's words per minute.
- Revise: each suggestion shows its scene and page.
- Revise guidelines: the ignored passages and the guidelines are now two sections. Each folds and has its own reset.
- STET opens with a soft fade.
- The first start of each version shows a short beta notice.

### BUGS, PERFORMANCE

- Deleting a note also removes its colour from the script. One undo brings both back.
- Going to a note or a timeline mark puts the caret at its start, without selecting the text.
- Deleting an empty line no longer changes the element of the line below.
- Changing the element of a line with only spaces stays on that line.
- Jumps in the script are 3% faster.
- Buttons inside notes, scenes and Revise cards show the hand pointer, like the cards.
- Text in fields can always be selected.
- Menus at the right edge stay inside the window.

## 0.51.2 · 26 Oct 2026

### BUGS, PERFORMANCE

- Revise uses much less of your Claude usage. It runs on Claude Sonnet 5.5 at medium effort.

## 0.51.1 · 25 Oct 2026

### BUGS, PERFORMANCE

- The scene list shows the open screenplay's scenes at once, never the previous one's.

## 0.51.0 · 25 Oct 2026

### FEATURES

- Double-click a scene in the scene list to rename it.
- The dinosaur sets out a little table for its coffee.

### BUGS, PERFORMANCE

- The right-click menu's dropdowns open more smoothly.
- A smaller, plainer rock for the dinosaur.
- Quieter scrollbars.
- The window appears only once STET is fully ready.

## 0.50.0 · 25 Oct 2026

### FEATURES

- The right-click menu on selected text has an element type button.
- New icons: a bold B for text style, a square for notes.

### BUGS, PERFORMANCE

- Timeline: the glass box moves to a jump in one smooth move.
- The right-click menu animates its buttons and dropdowns.

## 0.49.0 · 25 Oct 2026

### FEATURES

- Right-click selected text for a small menu: text style, alignment and a note.
- View > Hide Note Underlines.

### BUGS, PERFORMANCE

- Timeline: the glass box lands where the chosen line is in the window.
- The line under a note is easier to see.

## 0.48.0 · 25 Oct 2026

### BUGS, PERFORMANCE

- A note, highlight or timecode you go to always lands a little above the middle of the window.

## 0.47.0 · 25 Oct 2026

### BUGS, PERFORMANCE

- Highlights in the script match their colours on the timeline and in notes.
- Timeline: a chosen line never lands right against the toolbar.
- Timeline: holding Ctrl keeps the pointer in place, even when Windows is slow to lock it.
- Jumps in the script are 10% faster.

## 0.46.0 · 25 Oct 2026

### BUGS, PERFORMANCE

- Softer, more pastel colours for highlights and marks.
- The Tab cycle outline sits exactly on its buttons.
- Restore Backup no longer asks twice.
- Timeline: zooming stops at two minutes across the bar.

## 0.45.0 · 25 Oct 2026

### FEATURES

- Restore Backup makes a new screenplay and leaves yours as it is.

### BUGS, PERFORMANCE

- Confirm buttons wait for the second press as long as you like.
- The click that brings STET forward presses nothing.
- Timeline: a finer playhead, and every mark sits on a whole second.
- The line under a note is a light dotted line.
- A warmer, softer yellow.

## 0.44.0 · 25 Oct 2026

### FEATURES

- Notes and highlights share one colour.

### BUGS, PERFORMANCE

- Timeline: zooming is perfectly steady.
- Timeline: the glass box follows the script smoothly, and its edges are a lens.
- Tab around the elements no longer leaves text in capitals.
- The dinosaur never walks on the spot.

## 0.43.0 · 25 Oct 2026

### FEATURES

- A screenplay opens where you left it.
- Five new neighbours and three new habits for the dinosaur.

### BUGS, PERFORMANCE

- Timeline: clicks and the glass box line up exactly with the script.
- Clearer pointers on the timeline, scene rows and Revise cards.

## 0.42.0 · 24 Oct 2026

### FEATURES

- A note's colour highlights its passage.
- Timeline: the part on screen is a pane of glass.
- The dinosaur blinks, casts a shadow and lands with a little dust.

### BUGS, PERFORMANCE

- A spelling fix no longer jumps the page.
- Zoom sizes the side panels too, and stops at 200%.
- Deleting a note shows an X instead of a countdown.

## 0.40.0 · 24 Oct 2026

### FEATURES

- Notes have a colour, a pin and a bin.

### BUGS, PERFORMANCE

- Timeline: the fade at the right end shows only near the end.

## 0.39.2 · 24 Oct 2026

### BUGS, PERFORMANCE

- Check for Updates always finds the newest version.
- Timeline: the faded end takes no clicks.

## 0.39.1 · 24 Oct 2026

### BUGS, PERFORMANCE

- A subtler fade on the timeline.
- Notices rise and sink smoothly.
- One hover style everywhere.

## 0.39.0 · 24 Oct 2026

### FEATURES

- A new Restore Backup window: backups by day, with their words and size.

### BUGS, PERFORMANCE

- A new note no longer loses what you type.
- Faster releases.

## 0.38.1 · 24 Oct 2026

### BUGS, PERFORMANCE

- Timeline: no jump on the first Ctrl step on Windows.
- Switching windows mid-drag ends the drag.

## 0.38.0 · 24 Oct 2026

### FEATURES

- Revise works in any language.
- A redesigned Revise panel and notes panel.
- Revise guidelines learn patterns and voices. RESET forgets them.
- +NOTE again on the same text goes back to its note.

### BUGS, PERFORMANCE

- Timeline: the readout stays right while it scrolls or zooms.

## 0.37.0 · 24 Oct 2026

### FEATURES

- Focus Mode (F11): only the page and your text.
- View > Hide Toolbar.
- Revise has its own guidelines, which learn from you.
- Spelling has its own dictionary window, and downloads a dictionary by itself.

### BUGS, PERFORMANCE

- Timeline: zooming is one smooth motion.
- Every corner is square again.

## 0.36.0 · 24 Oct 2026

### FEATURES

- Spelling: a SPELLING menu, quiet underlines, fixes on right-click, and Auto.
- Scene list: each scene shows its time. Right-click for its timecode.
- Drag a side panel's edge to widen it. The lock keeps the sizes.
- New dinosaur routines, and small animals in the grass.

### BUGS, PERFORMANCE

- STET rests more while in the background.
- A right-click on the page keeps the keyboard in the script.

## 0.35.0 · 24 Oct 2026

### FEATURES

- Timeline: right-click a scene for its timecode, with keep and remove buttons.
- Four new finds for the dinosaur.

### BUGS, PERFORMANCE

- Timeline marks sit on whole seconds.
- The dinosaur lies on its back less often.

## 0.34.3 · 24 Oct 2026

### BUGS, PERFORMANCE

- Timeline: gentler motion, and the pointer stays where you stepped to.
- Smaller updates.

## 0.34.2 · 24 Oct 2026

### BUGS, PERFORMANCE

- Stepping with Ctrl moves only the script, never the caret.

## 0.34.1 · 24 Oct 2026

### BUGS, PERFORMANCE

- Stepping with Ctrl no longer flickers the toolbar.

## 0.34.0 · 23 Oct 2026

### FEATURES

- Four new dinosaur habits.

### BUGS, PERFORMANCE

- Timeline: Ctrl holds the pointer still while you step.
- Several saving and renaming fixes.
- Much faster tests.

## 0.33.0 · 23 Oct 2026

### FEATURES

- A scene can have its own timecode, shown beside its heading.
- The timeline is on by default.

### BUGS, PERFORMANCE

- STET opens the screenplay you last edited.
- Holding Ctrl over the timeline touches nothing else.

## 0.32.0 · 23 Oct 2026

### FEATURES

- Timeline: hold Ctrl to step a second at a time.

### BUGS, PERFORMANCE

- Close timecodes no longer pile up.

## 0.31.0 · 23 Oct 2026

### FEATURES

- A timecode editor: exact time, tag and colour.
- Ctrl + right-click pins a timecode at once.

## 0.30.0 · 23 Oct 2026

### FEATURES

- Timeline: hold Ctrl and move to step through the script.

## 0.29.0 · 23 Oct 2026

### FEATURES

- Timeline: drag sideways to zoom, down to single seconds.

## 0.28.0 · 23 Oct 2026

### FEATURES

- The timeline: the whole script as a strip, with its scenes, notes, highlights and timecodes.

## 0.27.0 · 23 Oct 2026

### FEATURES

- Revise lists its suggestions in script order. Accept All can take one kind.

### BUGS, PERFORMANCE

- Revise sticks to grammar and wording.

## 0.26.0 · 23 Oct 2026

### BUGS, PERFORMANCE

- No automatic bold or extra blank lines.
- Letters and pages match Final Draft exactly.

## 0.25.0 · 22 Oct 2026

### FEATURES

- Pages print like Final Draft's, on A4, in its Courier.
- Choose which elements Tab steps through.

### BUGS, PERFORMANCE

- Element and alignment changes touch only the selection or what you write next.

## 0.24.0 · 22 Oct 2026

### FEATURES

- Paragraph alignment.
- Every shortcut can be changed.

### BUGS, PERFORMANCE

- Tab no longer changes text already written.

## 0.23.3 · 22 Oct 2026

### FEATURES

- Import Final Draft (.fdx) scripts.

### BUGS, PERFORMANCE

- Safer file names, pastes and PDF export.

## 0.23.2 · 22 Oct 2026

### BUGS, PERFORMANCE

- Double-clicking a screenplay really opens it in STET, on Windows and Mac.

## 0.23.1 · 22 Oct 2026

### BUGS, PERFORMANCE

- Open .stet Files with STET works.

## 0.23.0 · 22 Oct 2026

### FEATURES

- Character names complete as you type.

### BUGS, PERFORMANCE

- Zoom in 5% steps. Faster start, smaller downloads.

## 0.22.0 · 21 Oct 2026

### FEATURES

- STET for the Mac.

## 0.21.1 · 21 Oct 2026

### BUGS, PERFORMANCE

- More grass, sooner.

## 0.21.0 · 21 Oct 2026

### BUGS, PERFORMANCE

- Updates are about a megabyte, with no installer.

## 0.20.2 · 21 Oct 2026

### FEATURES

- The dinosaur doodles in the sand.

## 0.20.1 · 21 Oct 2026

### BUGS, PERFORMANCE

- No stray blank line after deleting a name.

## 0.20.0 · 21 Oct 2026

### FEATURES

- STET updates itself.

## 0.19.4 · 21 Oct 2026

### BUGS, PERFORMANCE

- Short notes in windows are back.

## 0.19.3 · 21 Oct 2026

### BUGS, PERFORMANCE

- Fewer notes in windows.

## 0.19.2 · 21 Oct 2026

### BUGS, PERFORMANCE

- Words typed by the speed test no longer count as yours.

## 0.19.1 · 21 Oct 2026

### BUGS, PERFORMANCE

- A shorter speed test with a score.

## 0.19.0 · 21 Oct 2026

### BUGS, PERFORMANCE

- Standard page margins, and a clock in the status bar.

## 0.18.5 · 21 Oct 2026

### BUGS, PERFORMANCE

- Renaming finishes on a click elsewhere.

## 0.18.4 · 21 Oct 2026

### BUGS, PERFORMANCE

- Double-clicking the title renames, not maximises.

## 0.18.3 · 21 Oct 2026

### BUGS, PERFORMANCE

- The autocomplete popup is gone.

## 0.18.2 · 21 Oct 2026

### BUGS, PERFORMANCE

- One hover style everywhere.

## 0.18.1 · 21 Oct 2026

### BUGS, PERFORMANCE

- Square corners again.

## 0.18.0 · 21 Oct 2026

### FEATURES

- Double-click the title to rename. STET reopens your last screenplay.

## 0.17.0 · 21 Oct 2026

### FEATURES

- Open Recent lists your last ten screenplays.

## 0.16.7 · 21 Oct 2026

### BUGS, PERFORMANCE

- Weekly view fixes (0.16.2 to 0.16.7).

## 0.16.1 · 21 Oct 2026

### BUGS, PERFORMANCE

- A day joins your streak when you reach your goal.

## 0.16.0 · 21 Oct 2026

### FEATURES

- Rest days left this week, shown as a shield.

## 0.15.4 · 21 Oct 2026

### BUGS, PERFORMANCE

- Revise suggestion fixes (0.15.1 to 0.15.4).

## 0.15.0 · 20 Oct 2026

### FEATURES

- Choose how STET connects to Claude.

### BUGS, PERFORMANCE

- Almost no power used while the dinosaur sleeps.

## 0.14.0 · 20 Oct 2026

### FEATURES

- Two rest days a week, and grass that grows while you're away.

## 0.13.0 · 20 Oct 2026

### FEATURES

- The dinosaur can use the whole window.

## 0.12.0 · 20 Oct 2026

### FEATURES

- The dinosaur is STET's icon.

## 0.11.0 · 20 Oct 2026

### FEATURES

- Sunsets and new visitors for the dinosaur.

## 0.10.0 · 20 Oct 2026

### FEATURES

- Bold, italic, underline and strikethrough.

## 0.9.0 · 20 Oct 2026

### FEATURES

- A writing streak, and a dinosaur that grows with it.

## 0.8.0 · 20 Oct 2026

### BUGS, PERFORMANCE

- More room for the dinosaur. Panels slide the same way.

## 0.7.0 · 20 Oct 2026

### FEATURES

- Writing statistics and a weekly view (F9).

## 0.6.1 · 19 Oct 2026

### BUGS, PERFORMANCE

- A toolbar line fixed.

## 0.6.0 · 19 Oct 2026

### FEATURES

- A pixel dinosaur. Suggestions stay until you decide.

## 0.5.0 · 19 Oct 2026

### FEATURES

- Revise works with your Claude account.

## 0.4.0 · 19 Oct 2026

### FEATURES

- Claude can review your English.

## 0.3.1 · 19 Oct 2026

### BUGS, PERFORMANCE

- The cursor no longer drifts.

## 0.3.0 · 19 Oct 2026

### FEATURES

- Light and dark on a schedule. An icon.

## 0.2.1 · 19 Oct 2026

### FEATURES

- STET runs as a Windows program.

## 0.2.0 · 19 Oct 2026

### BUGS, PERFORMANCE

- Safer crash recovery.

## 0.1.0 · 19 Oct 2026

### FEATURES

- First version: screenplay formatting, autosave, backups, PDF, notes and highlights.
