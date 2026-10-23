# What's new

Every version of STET, newest first. The newest one is always on the [download page](https://github.com/mediocrecode56/stet-screenwriter/releases/latest).

## 0.33.0 · 23 Oct 2026

- Timeline: right-click a scene to give it its own timecode. It shows beside the scene heading in the script, and the timeline's clock adjusts around it like any other timecode.
- The timeline is on by default (Ctrl+Shift+T still hides it), with a short guide to it on the download page.
- Holding Ctrl over the timeline no longer reaches anything else: wherever the hidden pointer wanders, the toolbar above and the script below stay untouched, nothing gets selected, and the caret moves only once the line does. Esc puts the caret back where it was.
- Timecodes outside scene headings are quieter on the timeline (a hollow marker and a faint line); scene ticks now cross the script line.
- The pointer is drawn a little more strongly to scenes, notes, highlights and timecodes.
- STET opens the screenplay you last edited, not just the last one you opened.
- Fix: with the timeline on, STET could fail to start before a screenplay was open.

## 0.32.0 · 23 Oct 2026

- Timeline: with Ctrl (Cmd on a Mac) held, the mouse pointer hides and the line moves in its place at a slower, steadier pace, a second at a time, so landing on the exact second for a timecode is easy. Nothing pulls it towards scenes or notes while Ctrl is held.
- Timecodes close together no longer pile up: the newest keeps its time and tag on the ruler, older ones show just their line (point at one to read it).
- The pointer is drawn a third more strongly to scenes, notes, highlights and timecodes.
- Over a timecode the pointer turns into a pencil, and a plain click opens its editor.
- Timeline polish: the line under the pointer while stepping has a cap like the caret, and the timecode you point at stands out more.

## 0.31.0 · 23 Oct 2026

- Timeline: while holding Ctrl (Cmd on a Mac) over it, a right-click pins a timecode at that exact second straight away, no menu.
- Timecodes have a small editor of their own under the bar (right-click a timecode): type the exact time, nudge it a second with the arrow keys (ten with Shift), give it an optional tag and one of the highlight colours, or remove it. Enter or a click away keeps it, Esc leaves it as it was.
- Timecodes show as a line across the bar in their colour, with their tag on the ruler, and draw the pointer slightly like scenes and notes.
- Writing goals: the boxes at the top are as wide as the chart under them.
- Fix: a time that would come after the next timecode is refused with the reason, instead of that next timecode quietly stopping counting.

## 0.30.0 · 23 Oct 2026

- Timeline: hold Ctrl (Cmd on a Mac) and just move the pointer over it, no click needed, to step through the script a second at a time. The script follows, the exact time is shown, and right-clicking there offers that second for a timecode. Let go of Ctrl and the caret stays where you stopped.
- The button that shows the whole script again is bigger and clearer, with a reset icon, centred on the right of the bar.
- Fixes: a newly opened script shows its full length on the timeline at once; hiding the timeline while Ctrl is held no longer leaves it stepping.

## 0.29.0 · 23 Oct 2026

- Timeline: drag sideways anywhere on it to zoom around that point (right to zoom in, left to zoom out). It now zooms in about ten times further, down to single seconds. A small button in the right corner shows the whole script again.
- Hold Ctrl (Cmd on a Mac) and drag to move through the script second by second, with the exact time shown as you go.
- The pointer is drawn slightly to scenes, notes, highlights and timecodes as it passes them. A click there goes to that scene's heading or opens that note.
- The pointer shows left and right arrows on the ruler and while dragging, instead of a magnifier.

## 0.28.0 · 23 Oct 2026

- **Timeline** (*View → Timeline*, Ctrl+Shift+T): the whole script as a strip under the toolbar, page by page. Highlights show in their colour on the script line, each scene has a small tick and each note an icon. A soft band marks the part of the script on screen. It's off until you turn it on.
- Click anywhere on it to go there. Drag along it to scrub through the script, drag the band to move through the script, and drag the ruler sideways to scroll or up and down to zoom. Double-click the ruler for the whole script again.
- The ruler counts a minute a page and ends with the script's estimated length. Right-click to pin a real time (HH:MM:SS) at any point: the rest of the timeline is estimated from it. Timecodes stay with their line as you edit and are saved with the script.

## 0.27.0 · 23 Oct 2026

- English Revision lists its suggestions in the order they appear in the script, and keeps that order as you edit. Each one says what kind it is. The decided ones are in script order too.
- *Accept all…* asks whether to accept every open suggestion or only one kind.
- A suggestion you reopen after accepting it can be accepted again: it goes back to Decided, and the script is not changed a second time.
- Reviews stick to the English: grammar, unnatural English and clumsy wording. Claude no longer flags a line because it could be clearer, simpler or easier to follow, or because it lacks context.
- Near the lower end of the list, a floating **DECIDED** button takes you to the decided suggestions while they are out of sight.

## 0.26.0 · 23 Oct 2026

- STET no longer makes scene headings, character names or shots bold, and no longer adds blank lines of its own: none before dialogue, and new screenplays are back to one blank line before a scene heading. Bold and extra blank lines are yours to add.
- Letters sit 7pt apart, as Final Draft sets its Courier, on screen, in PDFs and in print, and the letters are drawn as thin as Final Draft's. A Final Draft PDF and STET's PDF of the same script now match letter for letter, within a fifth of a point.
- The PDF page is exactly the size of Final Draft's A4 page.
- Importing a Final Draft script keeps the blank lines you put in it: an empty line a paragraph begins or ends with, and an empty paragraph. It no longer changes the screenplay's scene heading spacing.

## 0.25.0 · 22 Oct 2026

- Pages print like Final Draft's. They are A4, in the Courier Final Draft uses (Bitstream's Courier 10 Pitch, now built into STET and embedded in every PDF), with scene headings, character names and shots in bold. The page number, the margins and where each line sits match a Final Draft PDF line for line. The screen shows the same font, the same bold and the same A4 page.
- Lines break after a hyphen inside a word ("twenty-year-" / "old."), as in Final Draft.
- A speech of several paragraphs breaks across pages between its paragraphs, without (MORE) and (CONT'D), as Final Draft does. A paragraph too long to move to the next page still splits with them.
- New screenplays leave two blank lines before a scene heading, as Final Draft does (File → Preferences still offers one). Importing a Final Draft script takes the spacing it uses, and keeps the empty lines that end its paragraphs, which move its page breaks.
- Dialogue that doesn't come under a character name (after a shot or action) starts with a blank line.
- Parenthetical now comes after Dialogue everywhere: the toolbar, the Element menu, Ctrl+4 (Dialogue) and Ctrl+5 (Parenthetical).
- Tab steps through the element types in the toolbar's order, only through the ones outlined there. All of them are outlined at first; Ctrl+click a type (⌘-click on a Mac) to take it out of the cycle or back in, or drag either end of an outline to take in or leave out the types it passes over.
- Changing the element with the toolbar or Ctrl+number works like Tab: it changes the selected text, or starts a new element at the caret for what you write next. It no longer changes a paragraph you only had the caret in.
- Alignment works the same way: it aligns the selected text, or what you write next, and never other text. Aligning one paragraph of a speech leaves the others as they were.
- Scene navigation ends with the scene heading at the top of the view and no line of the scene before it showing.
- A title page with nothing on it but "Written by" is no longer printed.

## 0.24.0 · 22 Oct 2026

- Alignment: a small menu on the toolbar aligns a paragraph left, centred, right or justified, and Format has the same. Ctrl+L, Ctrl+E, Ctrl+R and Ctrl+J do it from the keyboard. It prints and exports as shown, and changes nothing else about the text.
- Every shortcut can be changed in Help → Keyboard Shortcuts. Click one and press the new keys, up to three combinations one after another (for example Ctrl+K, then S). A shortcut already in use is named first, and only taken from the other command if you choose Replace. Backspace leaves a command without a shortcut, and Reset All goes back to the defaults.
- Tab no longer changes text that is already written. Inside a line it starts a new element at the caret, and with a selection it changes only the selected text. In an empty line it still changes that line.
- Turning Dialogue into a Character (or any element shown in capitals) and back keeps the capitalisation it was written with, instead of leaving it all in capitals.
- Scene navigation (Alt+↓, Alt+↑ and the Scene Navigator) glides to the scene like suggestions and notes do, with the scene heading at the top of the view.
- Opening the notes by clicking a note slides the panel in the same way as NOTES does. A note is plain text to click and write in, with no box around it.

## 0.23.3 · 22 Oct 2026

- File → Import Final Draft… opens a Final Draft (.fdx) script as a new STET screenplay. Scene headings, action, characters, parentheticals, dialogue, transitions and shots come across formatted as they were, with bold, italic, underline and strikeout, the title page and the cast. STET then asks where to save the new .stet file and how to back it up, as for any new screenplay. It never overwrites a screenplay that is already there.
- Opening or dropping an .fdx file on STET imports it the same way.
- A name made only of characters a file can't hold (like `???`) no longer makes a file called `.stet`, and emptying "Save in" saves where it was set, not in a folder of STET's.
- Renaming a screenplay to a name with a `$` in it keeps its backups' names right.
- Text pasted from another app keeps its tabs as spaces, as it already did over several lines. A note pasted in from another screenplay can be written in.
- A PDF export that fails inside STET now says so instead of waiting forever.

## 0.23.2 · 22 Oct 2026

- Help → Open .stet Files with STET now really makes double-clicking a screenplay open it in STET, on Windows and on the Mac. Before, Windows could still ask "How do you want to open this file?" or open another app it remembered, and on a Mac nothing changed.
- On Windows, STET is also listed under Settings → Apps → Default apps. If Windows keeps an earlier choice it protects, STET says so and opens Windows' own "Open with" window, so you can pick STET once.
- The installer's "Open .stet screenplays with STET" box does the same.

## 0.23.1 · 22 Oct 2026

- Help → Open .stet Files with STET works now. Before, clicking it did nothing.
- After it, double-clicking a screenplay opens it in STET, and screenplays show the STET icon right away. With the portable STET.exe, it's that STET.exe that opens them.
- If you once told Windows to always open .stet files with another app, Windows doesn't let STET change that. STET now opens Windows' own "Open with" window, so you can pick STET.
- On a Mac, STET becomes the app that opens .stet files.

## 0.23.0 · 22 Oct 2026

- Character names complete as you type a cue. Once a character has been named in a screenplay, typing the first letters shows the rest of the name in grey. Enter, Tab or → takes it, and Escape or any other key ignores it. The names you used most recently come first, and the screenplay keeps them in its file.
- The zoom buttons and shortcuts now move in 5% steps, like the mouse wheel.
- The icons in Open Recent are now the same size, evenly spaced and centred.
- The installer has a box, ticked already, to open .stet screenplays with STET. Help → Open .stet Files with STET does the same later, for example for the portable STET.exe.
- STET starts a little faster: the Claude connection only loads when you use the English revision. Downloads and updates are a little smaller.

## 0.22.0 · 21 Oct 2026

- STET for the Mac: STET-macOS.dmg, for Macs with Apple silicon. Open it and drag STET to Applications.
- On a Mac, shortcuts use ⌘ instead of Ctrl and are shown that way. Option moves by word, ⌘ with the arrows goes to the start or end of a line or of the screenplay.
- It updates itself the same way as on Windows, with a small download and a restart.

## 0.21.1 · 21 Oct 2026

- While STET is in the background, grass comes up sooner and more of it: up to twelve tufts instead of five.

## 0.21.0 · 21 Oct 2026

- Updates are small now, usually about a megabyte instead of a hundred.
- Updating no longer runs an installer. STET restarts and is on the new version.
- Fixed: an update could finish and then offer itself again. STET now waits until it has fully closed before anything is replaced.
- The full download is a little smaller.

## 0.20.2 · 21 Oct 2026

- The dinosaur now doodles in the sand. It keeps the drawing for a while, or scuffs it out.
- The dinosaur's habits are better balanced. Everyday things happen more often, gags less often. It digs when it has energy, dozes when it hasn't, and reads your page when you stop for a bit.

## 0.20.1 · 21 Oct 2026

- Deleting a character's name could leave the next page with a blank line too many at the top, until the page was redrawn. Fixed.

## 0.20.0 · 21 Oct 2026

- STET checks for a new version when it starts. If there is one, UPDATE appears in the status bar.
- Update now downloads it in the background. Restart now saves your work and opens the new version.
- Works for the installed STET and for the portable STET.exe.
- Help menu: Check for Updates, and STET on GitHub.
- The check on start can be turned off in Preferences.

## 0.19.4 · 21 Oct 2026

- The explanatory notes in windows are back, except in Open Recent.
- The Revise panel's introduction is one sentence.

## 0.19.3 · 21 Oct 2026

- Explanatory notes removed from windows.
- Warnings and consent notes kept.

## 0.19.2 · 21 Oct 2026

- Words typed by the speed test no longer count as your writing. The 1,526 it added are removed, and your streak is rebuilt.
- Three separate checks stop it from happening again.

## 0.19.1 · 21 Oct 2026

- The speed test gives a score out of 100.
- It takes half as long.
- Your screenplay is left exactly as it was.

## 0.19.0 · 21 Oct 2026

- Page margins match the industry standard.
- Long paths in Open Recent are cut at the end, not the start.
- A clock replaces the save text. The square by the title shows whether you're saved.
- Text in windows can no longer be selected by accident.

## 0.18.5 · 21 Oct 2026

- Clicking elsewhere finishes renaming.
- No outlines around focused buttons.

## 0.18.4 · 21 Oct 2026

- Double-clicking the title renames the screenplay, instead of maximising the window.

## 0.18.3 · 21 Oct 2026

- The autocomplete popup is removed.

## 0.18.2 · 21 Oct 2026

- Leftovers from the rounded corners removed.
- One hover style everywhere.

## 0.18.1 · 21 Oct 2026

- Square corners again.

## 0.18.0 · 21 Oct 2026

- Double-click the title to rename the screenplay.
- Open Recent can show a file in its folder.
- STET reopens your last screenplay, instead of a blank page.
- The dinosaur grooms itself and follows scents.

## 0.17.0 · 21 Oct 2026

- Your last ten screenplays appear when you hover Open Recent in the File menu.

## 0.16.7 · 21 Oct 2026

- Smaller weekly view.

## 0.16.6 · 21 Oct 2026

- Save goals closes the window.
- The weekly chart has a scale.

## 0.16.5 · 21 Oct 2026

- Changing the daily goal adjusts the weekly goal, and the other way round.

## 0.16.4 · 21 Oct 2026

- Weekly view layout evened out.

## 0.16.3 · 21 Oct 2026

- Weekly view: one redundant line removed.

## 0.16.2 · 21 Oct 2026

- Weekly view: facts on one line.

## 0.16.1 · 21 Oct 2026

- A day joins your streak when you reach your daily goal, not with its first word.
- Rest days follow the same rule.

## 0.16.0 · 21 Oct 2026

- A shield shows the rest days left this week.
- STET no longer opens as an empty window first.

## 0.15.4 · 21 Oct 2026

- The selected suggestion is marked with grey only.

## 0.15.3 · 21 Oct 2026

- Clicking anywhere on a suggestion goes to it.

## 0.15.2 · 21 Oct 2026

- Clicking a suggestion always centres it on screen.
- Review highlights are grey, not yellow.

## 0.15.1 · 20 Oct 2026

- Clicking a suggestion scrolls to it smoothly.

## 0.15.0 · 20 Oct 2026

- The English review works without an API key again.
- You choose how STET connects to Claude.
- A signed-out Claude account is reported once, before the review starts.
- The dinosaur's face no longer breaks in some poses.
- STET uses almost nothing while the dinosaur is asleep.

## 0.14.0 · 20 Oct 2026

- Two rest days a week for your streak.
- Grass grows around the dinosaur while you're away. It eats it once you're writing again.
- After a long absence it falls asleep.
- It makes its bed, lines up pebbles, walks a tightrope and plants flowers.

## 0.13.0 · 20 Oct 2026

- The dinosaur can use the whole width of the window.
- Occasionally it bites the corner of the window.
- Plants come and go.
- It walks instead of sliding.

## 0.12.0 · 20 Oct 2026

- The dinosaur is STET's icon.
- Sitting and lying poses redrawn.
- Rare events always come round eventually.

## 0.11.0 · 20 Oct 2026

- The dinosaur watches the sun set and rise when the theme changes on schedule.
- New visitors: a balloon, a paper plane, a frog, a ladybird, a dandelion and a worm.
- Everyday routines vary more.

## 0.10.0 · 20 Oct 2026

- Bold, italic, underline and strikethrough (Ctrl+B, I, U, D).
- Printed and exported as shown.

## 0.9.0 · 20 Oct 2026

- A writing streak, shown as a flame.
- The dinosaur grows with your streak.
- Weather and visitors in the dinosaur's world.
- Clicking it gets a reaction suited to what it was doing.

## 0.8.0 · 20 Oct 2026

- More room for the dinosaur, none taken from the page.
- The weekly view handles large numbers.
- All panels slide the same way.
- Open Recent's buttons no longer go off-screen.

## 0.7.0 · 20 Oct 2026

- Your writing is recorded across all screenplays.
- A weekly view with a chart (F9).
- Resetting statistics asks first and keeps a copy.
- Deleting text no longer stops today's count.
- The dinosaur plays with balls, bones and butterflies, and sometimes types.

## 0.6.1 · 19 Oct 2026

- A line above the toolbar was too long. Shortened.

## 0.6.0 · 19 Oct 2026

- Claude's suggestions stay until you decide.
- Hovering a suggestion shows the words it refers to.
- A pixel dinosaur lives above the word count.
- Open Recent can remove a file from the list or move it to the Recycle Bin.
- Today's count no longer stalls after pasting.

## 0.5.0 · 19 Oct 2026

- The English review works with your Claude account. No API key needed.

## 0.4.0 · 19 Oct 2026

- Claude can review your English and suggest fixes.
- Nothing changes until you accept.

## 0.3.1 · 19 Oct 2026

- The cursor no longer drifts into the text.

## 0.3.0 · 19 Oct 2026

- Light and dark switch on a schedule.
- STET has an icon.
- Faster word counting.

## 0.2.1 · 19 Oct 2026

- STET runs as a Windows program.

## 0.2.0 · 19 Oct 2026

- Safer crash recovery.
- Tab after dialogue starts a parenthetical.
- Small fixes.

## 0.1.0 · 19 Oct 2026

- First version.
- Standard screenplay formatting and page breaks.
- Autosave, backups and crash recovery.
- Print, PDF, title page, notes, highlights, light and dark.
