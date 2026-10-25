# What's new

Every version of STET, newest first. The newest one is always on the [download page](https://github.com/mediocrecode56/stet-screenwriter/releases/latest).

## 0.47.0 · 25 Oct 2026

- Highlights in the script are now the same colours as their marks on the timeline and the note colours, instead of a lighter, different shade. In the dark theme they are a deeper version of the same colours, so the text stays readable.
- Timeline: a note, highlight or timecode chosen outside the glass box never lands right against the toolbar. At the start of a paragraph it keeps the blank space before it, with the line before it still hidden. In the middle of a paragraph it keeps two lines of room, so the paragraph's line before it shows. Right under a line of text with no blank line between (dialogue under its character), it keeps one line.
- Timeline: while you hold Ctrl over the timeline to step through the script, the pointer is held there even if Windows refuses to lock it the first time (it does for a moment after a lock was just let go). STET asks again until the pointer is locked, so it can't drift out of the window and click something else.
- Jumping to a point in the script (from the timeline, the scene list, a note or the scene keys) is 10% faster.

## 0.46.0 · 25 Oct 2026

- Tab cycle: the outline now lies exactly on the edges of the buttons it takes in, drawn inwards, so it never stands out past them or over the toolbar's lines.
- Colours: the highlights and the mark colours (timeline, note squares, note cards, timecodes) are all softer and more pastel, the yellow no brighter than the blue or the pink, in the dark theme and in print too.
- Timeline: a note, highlight or timecode chosen outside the glass box comes to the top of the window with only the blank space before it as its margin. The line of text before it no longer shows.
- Restore Backup: RESTORE no longer asks for a second press. The window that names the new screenplay is the confirmation, and it can be cancelled.
- Timeline: zooming in stops at two minutes across the bar. The strip stays a sensible size at the closest zoom, so zooming and scrolling there are lighter. A screenplay shorter than two minutes doesn't zoom at all.

## 0.45.0 · 25 Oct 2026

- Confirm buttons never time out. Deleting a note or a backup, restoring a backup, or resetting the guidelines waits for the second press for as long as you like; a press anywhere else (or Esc) cancels it. The bar that ran out under the button is gone.
- When STET is in the background, the click that brings it forward only brings it forward: it presses no button, moves no caret and starts no drag. The next click works as usual.
- Restore Backup now makes a new screenplay. It is named after the screenplay and the time of the backup (for example "Heist 2026-10-25 1430"), saved by default in the same folder, with its own backup folder named to match. You can change the name and the folder first. The screenplay you have open stays exactly as it is.
- Timeline: the playhead is a fine line hung from a small flat tab, and it fades into the ruler instead of stopping on it. It sits on the caret's whole second, like every mark, so after you click a note, highlight or scene it sits exactly on that mark instead of a little to one side. The line under the pointer also moves from second to second; nothing on the timeline sits between two seconds.
- Timeline: a coloured note shows just its coloured square. Before, its highlight was drawn there as well.
- Timeline: a note, highlight or timecode chosen outside the glass box comes to the top of the window with the same room above it as a scene heading. The room is made of whole lines, so no part of a line shows at the top edge.
- Tab cycle: the outline's top and bottom now lie on the toolbar's own lines, and its sides stand the same three pixels clear of a filled button as the top and bottom do, in every combination. Each element button is a whole number of pixels wide, so no edge is soft.
- The line under a note's passage is now a fine, light dotted line instead of a black dashed one.
- Highlights: the yellow is a warm cream instead of a bright lemon, and the three colours now match in lightness and softness, like highlighter on paper (in the dark theme too).
- Notes and timecodes list their colours in the toolbar's order (blue, yellow, pink, then none).

## 0.44.0 · 25 Oct 2026

- Timeline, zooming: what you zoom around stays perfectly still. Before, the whole strip shivered by half a pixel on every frame, the mark under the pointer blinked, and ruler labels and grid lines popped in and out as the steps changed; now they fade. With the pointer drawn to a scene, note or highlight, the zoom holds that mark under the line.
- Timeline, the glass box: it moves smoothly with the script. Before, it waited at blank lines and page breaks and then jumped, and it snapped hard onto any mark near its edge; now the pull towards a mark is as soft as the pointer's.
- Timeline: clicking a note, highlight or timecode outside the glass box now glides the script so that it sits at the top and the box begins exactly on it, just as scenes already did. A note or highlight in the middle of a paragraph now goes right to the top of the window instead of two lines below it.
- Timeline: dragging the glass box follows the pointer exactly, with no lag and no stretching where page breaks pass its edges; when you let go it eases into place.
- Timeline: the glass box's edges are a lens: what passes under them blurs a little more towards the edge and bends very slightly. Its middle stays clear.
- Timeline: the fade at the right end starts to come up a little further from the end.
- Notes and highlights are now one colour. A note made on highlighted text takes that highlight's colour; giving a note a colour highlights its passage (one step you can undo); removing the highlight removes the note's colour. The colour shows the same on the page, the margin marker, the note card and the timeline. Notes coloured in 0.40 to 0.43 open with their passage highlighted in that colour.
- Tab: going round the element types with text selected, and round again, now changes only the element. Before, passing from PAREN into the capital elements left the text in capitals for good.
- Tab cycle: the outline around the elements Tab steps through now stands the same pixel clear of the white fill on every side; before, it overlapped the fill at the sides and its right edge fell on half a pixel.
- The dinosaur never walks on the spot any more: dance steps and turns on the spot now shuffle a little, one way then the other, and a stride with nowhere to go becomes a stand. A new check runs on every frame of the hours-long simulation.
- Checked again: the dinosaur is livelier the nearer you are to today's goal (now with its own test), and the streak's special routines unlock as before.
- Tests: the AUTO theme tests no longer fail on the night the clocks go back.

## 0.43.0 · 25 Oct 2026

- A screenplay now opens where you left it, whether STET reopens it at launch or you open it again: the caret where it was, and the page scrolled just as it was.
- Timeline: clicking a scene, a note or any spot outside the glass box glides the script so the box starts exactly there; a scene's box now begins right on its tick. Clicking something already inside the box glides it to the middle of the box (and of the page).
- Timeline: the glass box has no bright line along its top any more. Its top and bottom are the same faint edge, its sides fade out towards them, and it brightens softly when you point at it or drag it.
- Timeline: when the caret leaves the zoomed-in part of the bar, the bar glides along instead of jumping.
- Cursors: on the timeline, pointing at a note, scene or highlight shows the hand even on the ruler row (a click goes there); before, it could still show the resize cursor. After a drag or Ctrl-stepping, the cursor matches where the pointer is. Scene rows and Revise cards show the hand, like note cards; small buttons (the timecode editor, the spelling menu, the whole-script button) show the arrow, like every other button.
- Highlights on the page are a little more muted.
- The dinosaur has five new neighbours: a dragonfly it snaps at (mostly near puddles; sometimes it lands on its head), a bee it runs away from (mostly near flowers), a kite on the breeze it hangs on to (seldom; a gust lifts it off its feet), a rock it digs up and climbs (seldom, and a different shape every time), and a dung beetle whose ball it nudges along.
- Three new habits: it sweeps fallen leaves into a heap and leaps in, plays hide and seek behind a palm, cactus or rock, and tidies away the things it left lying around.
- The dinosaur is a little calmer overall, and its rare moments (an egg, a UFO, a gem, the corner bite and others) are a little less rare. What it does next now always depends on its surroundings (weather, time of day, what's lying or growing around it) and on what it just did. A new test checks that every behaviour and event can actually happen.
- Clicking the dinosaur while it stands on something (a rock, its skateboard) gets a reaction once it's back down, instead of it dropping to the ground at once.

## 0.42.0 · 24 Oct 2026

- Notes: giving a note a colour now also highlights its passage in the script in that colour, and its marker in the page's right margin takes the colour too. With highlights turned on, the passage prints highlighted as well.
- Notes: the marker in the right margin is a small square, a little larger for the note you're on.
- Notes: deleting a note still takes a second press, but the bin now turns into an X with no countdown. It waits until you click somewhere else.
- Timeline: the part of the script on screen is a pane of glass the full height of the bar. It softens the grid behind it, so the marks on it are easier to read.
- Timeline: each note is a small square hanging from the line, like its marker on the page. The whole-script button has a clearer icon (arrows out to both ends).
- Timeline: the stretch of the scene you're in is much more subtle. Scene ticks are a little taller.
- Timeline: zoomed in, the fade behind the whole-script button now comes up gradually as the pointer nears the right end, and goes the same way, so it no longer switches on at an edge.
- The dinosaur blinks now and then on its own. When it jumps, its shadow shows on the ground under it, and it lands with a moment's crouch and a little dust.
- A tidier codebase: unused code removed, and the docs brought up to date.

- Spelling: choosing a suggestion from the right-click menu now only replaces the word. Before, if the caret was somewhere else in the script, the page jumped there after the fix.
- Notes: a click anywhere on a note (its top line or its margins, not just the passage) goes to its page and centres it.
- Notes: deleting a note still takes a second press, but the bin now turns into a check mark instead of the word CONFIRM. The note's buttons are a little larger.
- Zoom also sizes the side panels, by less than the script: the notes and Revise follow half of it (at 200% their text is 150%), the scenes a tenth (110%).
- Zoom now stops at 200%. Beyond that, the layout around the pages broke.
- Scenes: less empty space on the left of the list.

## 0.40.0 · 24 Oct 2026

- Notes: each note has three small buttons that show when you point at it: a colour, a pin and a bin. The colour button gives the note one of the highlight colours (blue, yellow or pink). The colour shows on the note's passage in the list and on its mark on the timeline. The pin moves the note to the top of the list, where it stays (pinned notes keep their script order among themselves); the cards glide to their new places, and a note you are writing in keeps your typing. The bin replaces DELETE and still takes a second press.
- Colours and pins are saved with the screenplay. Older versions of STET open the file as before and ignore them.
- Timeline: zoomed in, the fade and the whole-script button now come up only when the pointer nears the right end of the bar, not anywhere on it.
- Timeline: the script line is a little thinner.
- Timeline: holding Ctrl to step through the script no longer starts from under the faded right end, which is out of play.

## 0.39.2 · 24 Oct 2026

- Help > Check for Updates always finds the newest version. Before, once an update had been downloaded and was waiting for a restart, checking again only offered that one, even if a newer version had come out since. GitHub's answer is also never taken from a cache any more, so a version released a minute ago is found.
- Timeline: zoomed in, the faded right end of the bar (behind the whole-script button) is out of play. Nothing under it lights up, shows its time or takes a click, so pointing at the corner no longer picks up the next timecode or scene and draws its label half off the bar.
- Timeline: the pointer is only drawn to marks you can see, never to one scrolled out of view at either end.

## 0.39.1 · 24 Oct 2026

- Timeline: the fade behind the whole-script button is subtler. It is narrower, has no blur, blends smoothly into the bar with no visible edge, and clears quickly when the pointer leaves the bar. The grid clears just as quickly.
- Notices (a dictionary installed, say) rise in from the status bar and sink back down, centred the whole time. Before, they jerked sideways as they appeared and left. A newer notice now replaces the text in the same box instead of the box vanishing and arriving again.
- Smoother timeline marks: a highlight or scene tick under the pointer now eases in like the rest, instead of snapping its glow.
- Hover is consistent everywhere: a note, a Revise card, the spelling menu's actions and the recent-files buttons light up at once under the pointer and fade out as it leaves, like every other row and button.

## 0.39.0 · 24 Oct 2026

- File > Restore Backup (Ctrl+Shift+B) is redesigned. It lists the backups of the screenplay you have open, newest first and grouped by day (Today, Yesterday, then the date). Each row shows when the backup was made, how long ago, how many words it holds, how that compares with your script now ("−120 vs now"), and its size.
- Restore and delete a backup right on its row. Point at a row (or pick one with the arrow keys) and RESTORE and DELETE appear. Each takes a second press, as DELETE does on a note, so one click never loses anything. Restoring keeps what you have now as a backup first. BACKUP NOW adds one at the top, and OPEN FOLDER shows them on disk. A backup that can't be read is marked as such and can't be restored, but can still be deleted.
- Timeline: zoomed in, with the pointer on the bar, the right end of the bar softly fades and blurs behind the button that shows the whole script, so the button stands clear of the marks and labels passing under it.
- Fix: a note started with +NOTE could lose what you typed into it. If the notes list refreshed itself a moment after the note opened (as it does), while you were already typing, the rest of your typing went elsewhere.
- Fix: opening a screenplay and starting a note straight away could send the note's first keys into the script.
- Fix: on Windows, holding Ctrl over the timeline could still jump the line when the system sent an empty move first, as the pointer locked.
- Releases come out faster: the Mac version is built at the same time as the Windows one instead of after it, the installer is compressed on every core, and Electron's own download is kept between builds.

## 0.38.1 · 24 Oct 2026

- Timeline: on Windows, holding Ctrl to step through the script no longer makes the line jump about 20 seconds on the first move.
- Fix: switching to another window in the middle of a drag (selecting text, widening a side panel, moving the Tab cycle's ends) left the drag going: the selection kept following the pointer with no button held. The drag now ends there.
- Releases are quicker and more reliable: a new version is built once instead of twice, and a busy build machine no longer stops a release.

## 0.38.0 · 24 Oct 2026

- Revise works in any language. Claude works out the language of each passage and judges it by that language's own grammar and idiom (and its regional variety, such as Brazilian Portuguese or British English). A character who speaks another language on purpose is reviewed in that language, never translated. Explanations come in the language your script is written in. Passages in Chinese, Japanese, Thai and other languages written without spaces are matched exactly, and an accented letter is found however it is stored.
- The Revise panel is redesigned in the style of the notes. The ENGLISH REVISION title is gone. The last review is summed up in one line at the top, with REVIEW AGAIN centred under it. Each suggestion is a card: its kind and confidence on top, the change in the script's own type, then the explanation and the buttons.
- Revise guidelines learn much more from what you set aside. Beyond single passages and single changes, they now notice when you keep the same words whatever fix Claude offers ("gonna", say), and when you keep setting aside one kind of suggestion in one character's lines (their voice). Claude is told about both as patterns to apply to similar passages. A clear, high-confidence error needs more evidence before it's held back than a low-confidence one. A passage counts as the same however it's capitalised, quoted or punctuated. The guidelines you already have keep working as before. Once a guideline is well understood, setting it aside again adds nothing new, and the list never forgets what it has learned to make room.
- Tools > Revise Guidelines says what it's for in one sentence and shows the patterns learned. A new RESET button forgets every guideline. It asks for a second press, so one click never wipes them.
- The notes panel is redesigned: each note is a card with its page and time on top, the passage it's about in the script's type, then your note. The note you're on stands out.
- Deleting a note takes a second press: DELETE turns into CONFIRM, with a short bar running out under it. Press again before it runs out and the note folds away. Otherwise nothing happens.
- +NOTE pressed again on the same selection takes you back to the note it just made, instead of making another. Select something else, or edit the script, and the next +NOTE makes a new one.
- While you're away, the grass and plants come up and grow a quarter faster. They still stop at the same number, and still wait for you to start writing again before they go.
- Timeline: the time and scene under the pointer stay right while the bar scrolls or zooms beneath it. A plain scroll during a zoom is no longer pulled back. A wider window that now fits the whole script shows it whole, without a leftover reset button. The timecode editor stays on its timecode when the bar changes size.
- Fix: the Spelling Dictionary window (and the Revise Guidelines window) drew two lines one above the other at the bottom of its list.

## 0.37.0 · 24 Oct 2026

- Focus Mode (View > Focus Mode, or F11): STET fills the screen with nothing but the page and your text. Everything else slides away in one smooth move. Spelling fixes, name completions and Find still come up as you write. Move the pointer to the top edge and the menus and toolbar drop back in. Move it to the right edge for a small rail: WINDOW takes you back (so does Esc), and REVISE, SCENES and NOTES open their panels beside the page. When you leave, the panels you had open before come back.
- View > Hide Toolbar slides the toolbar out of the way, and Show Toolbar brings it back. STET remembers your choice.
- Revise has its own guidelines, kept apart from the spelling dictionary. +GUIDELINE on a suggestion (it replaces +DICTIONARY) sets it aside for every screenplay, with an optional note on why it's fine ("a band name", "Rosa mixes in Spanish on purpose").
- Revise guidelines are soft, and STET learns from them. Set aside once, a similar suggestion still comes up, marked GUIDELINE?, and Claude is only told about it as a hint. Set aside twice, or the same change set aside four times in different places, it stops coming up. Accepting one that looked like a guideline weakens that guideline again. Tools > Revise Guidelines lists them as FIRM or LEARNING. You can remove any of them there, or write one yourself as a note for Claude.
- Spelling has its own dictionary window (Tools > Spelling Dictionary, also at the bottom of the SPELLING menu). The words you add there no longer change what Claude's revision flags.
- Spelling: no dictionary on your computer? STET now downloads the one for your language by itself, in the background, with a notice when it's ready. There's no Install Dictionary item to find any more. If the download doesn't work, Add a Language is highlighted in the menu instead.
- Spelling: languages are named with their country, for example Spanish (Spain) instead of European Spanish, English (United Kingdom) instead of British English, and Portuguese (Portugal).
- Spelling: the red underline under a misspelt word is a little thicker and stronger, so it's easier to spot.
- Timeline: zooming is one continuous, smooth motion. The Ctrl+wheel, a pinch, dragging the ruler and the button that shows the whole script all glide to their new scale. The point under the pointer stays put, and the marks and labels stay sharp the whole way (no stretching, no flicker). Going back to the whole script is a single smooth zoom out, without the old flash.
- Fix: closing STET while it was full screen saved the full-screen size as the window's normal size.
- Fix: in a menu's side list (Open Recent, Add a Language), pointing at the current item made its text invisible in the light theme.
- Fix: a few corners were still rounded and a few shadows soft (the toast, the DECIDED button, the timeline's small buttons, the spelling menu). They're square and hard like the rest of STET now.
- Fix: removing a word from the spelling dictionary and adding another one could leave the old underlines as they were until you edited the script.

## 0.36.0 · 24 Oct 2026

- Spelling: a new SPELLING menu on the toolbar. It uses the dictionaries already installed on your computer (from LibreOffice, Firefox or your system; on a Mac, its own checker): pick the language there, and switch spelling on or off.
- Spelling: only obvious slips are marked, with a thin pale red underline. Names, all-caps words, scene headings and cues are left alone. Right-click a marked word for the fix, or use the small Dictionary button to add it to your dictionary (every screenplay) or Ignore to leave it be in this script. STET remembers both; Tools > Dictionary & Ignored lists them.
- Spelling: with Auto on, those same slips are corrected as you press Space. Ctrl+Z takes a correction back.
- Spelling: no dictionary on your computer? The SPELLING button shows a small dot, and Install Dictionary downloads one for your language in the background while you keep writing; a short notice says when it's ready. Add a Language in the same menu downloads any other common language. Dictionaries are kept in STET's own folder, and STET finds them in several places online, so a moved file doesn't stop it.
- Scene list: each scene shows its time on the timeline instead of its number (darker when a timecode is pinned to it), and right-clicking a scene gives it its own timecode, just as on the timeline.
- Side panels: drag the inner edge of the scene list, the notes or the revision panel to widen it, up to twice its usual width (double-click the edge to put it back). The lock beside REVISE keeps them as they are. STET remembers the widths.
- Timeline: the little cap on the line is centred again (it sat half a pixel to the left), and the scene you're in is drawn as a slightly thicker stretch of the line, so you can see where you are and how long the scene runs.
- Timeline: the button that shows the whole script again has the usual zoom-reset icon and matches the rest of the bar; the line stops at the ruler instead of crossing its labels, and timecode labels stay readable over the grid.
- The dinosaur's new routines: it crumples up a page of its own draft and tosses it over its shoulder (sometimes it has second thoughts), laps at a puddle after the rain (more so after a run about), and, rarely, finds a stick and settles down to chew it.
- Something small lives in the grass that grows while you're away: now and then a mouse, a lizard or a bunny darts out, and the dinosaur may give chase. It never catches one.
- After a very long while away, rarer plants (a fern, a bloom, a reed) slowly come up too. Once you start writing again, they wither away a little at a time.
- The dinosaur answers clicks more quietly: sitting, lying down or busy with something, it looks round at you from where it is instead of leaping up, and leaps come more as the clicks keep coming.
- While STET rests in the background (the dinosaur in a deep sleep), the clock in the status bar checks the time once a minute instead of every second. A minimised window, or one with the companion turned off, now rests the same way.
- Fix: right-clicking the page moved the keyboard away from the script, so the next keys you typed went nowhere until you clicked the page.
- Fix: opening a screenplay while the page was still gliding to a scene could carry the new one away from its start.

## 0.35.0 · 24 Oct 2026

- Timeline: right-clicking a scene opens its timecode with a check and a bin. The check (or Enter) keeps it and the bin removes it. Clicking away or pressing Esc changes nothing, so a scene you right-click for the first time only gets a timecode once you click the check. The same goes for every timecode you add or edit.
- Timeline: scenes, notes and highlights now sit on the nearest whole second instead of between two, and the time shown when you point at one is that second. Clicking one still takes you to exactly that line.
- Timeline: a timecode flashes briefly when you keep it, pointing at a highlight says which colour it is, and the timecode editor drops in gently from the bar.
- The dinosaur spends much less time lying on its back: about a third as often as before.
- The dinosaur has four new finds, each with its own odds: an acorn that drops out of nowhere (it nudges it along and buries it), a cricket that chirps and is always one hop ahead, a feather that drifts down onto its head and makes it sneeze, and, only rarely, a gem glinting in the sand, which it digs up, admires and buries again.
- Fix: clicking away from the timecode editor too quickly after it opened could be missed.

## 0.34.3 · 24 Oct 2026

- Timeline: when you let go of Ctrl (Cmd on a Mac) after stepping, the pointer is on the line, at the place you stepped to, instead of back where you started. While you step, the line stays under the pointer and the timeline slides beneath it.
- Timeline: gentler motion. The time readout fades in, scenes, notes and highlights lift slightly as the pointer nears them, the line glides to where you click, and showing the whole script settles in with a slight zoom.
- Fix: opening a screenplay could delete a recovery copy or backup STET was writing at that very moment.
- Updates inside STET are about a quarter smaller.
- Behind the scenes: a tidier code base and a leaner, faster test suite.

## 0.34.2 · 24 Oct 2026

- Timeline: holding Ctrl (Cmd on a Mac) to step through the script now does only that. The script follows the line, but your caret stays where it was, so nothing else in the window changes, not while you step and not when you let go: not the elements or the alignment in the toolbar, not the status bar, the scene list or the notes. Click while stepping to put the caret there. Let go to stay at that place in the script, or press Esc to go back.
- Fix: STET reported an error behind the scenes on every key you pressed (harmless, but wasteful).
- Behind the scenes: the tests now fail on any error STET reports while they run, even one nobody sees, and two of the tests' own mix-ups that could make them check the wrong window are gone.

## 0.34.1 · 24 Oct 2026

- Timeline: while you hold Ctrl (Cmd on a Mac) to step through the script, the toolbar no longer flickers through ACTION, CHARACTER and the other elements, and the alignment, the status bar, the scene list and the notes stay as they were. Only the line on the timeline and the script move. Everything shows where you are as soon as you let go.

## 0.34.0 · 23 Oct 2026

- Timeline: holding Ctrl (Cmd on a Mac) now holds the pointer still while you step through the script, so it can no longer drift onto the toolbar or the script and light up or click something there. When you let go it is back on the timeline, where you started. Esc while stepping puts the caret back, and stepping waits until you press Ctrl again.
- The dinosaur has four new habits: a good scratch on its back in the dust (all the more after the rain), a shameless strut up and down (all the more once you've met today's goal), a burp after a snack, and photobombing whatever is worth a look nearby. Click it while it shows off and it takes a bow.
- Fix: saving under a new name while STET was still saving the old file could report success without writing the new file.
- Fix: renaming a screenplay from its title could rename another one opened in the meantime.
- Fix: the Open Recent window left the typing focus in the script behind it, so Escape didn't close it.
- Fix: a click on a window that was already closing could close the next one with it.
- Fix: STET reopening your last screenplay at start-up could interrupt you if you had already started writing.
- A cleaner download page.
- Behind the scenes: the tests were rebuilt to run in a fraction of the time, so they run more often.

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
