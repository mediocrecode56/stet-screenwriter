# Changelog

What changed in each version of STET, and why it matters to you.

STET is in beta, so version numbers stay below 1.0. Every version is saved as its own snapshot (a tagged git commit, `vX.Y.Z`) and gets its own Windows program in `dist\STET-vX.Y.Z-win32-x64\STET.exe`. From 0.6.0 on, the newest version is also always available as a single file, `Documents\STET\STET.exe`.

## 0.16.2 — 21 October 2026

### Improved

- **A tidier weekly view.** The week's facts are now one short line: days written, how often you met the goal, and your best day. The streak lines are gone, because the flame and the shield in the status bar already show them.

## 0.16.1 — 21 October 2026

### Fixed

- **The streak and the shield follow your daily goal.** A day now joins your streak when you reach your daily goal, not with its first word. Each day that ends short of the goal uses one of the week's two rest days, whether or not a streak is running. The shield counts down from there.
  - **Example:** this week you wrote 1 word on Tuesday with a goal of 600, so the shield now shows 1 left instead of 2. Today counts once it's over, or as soon as you reach the goal.
  - **Your flame:** since your statistics were reset on Tuesday, no day has reached 600 yet. So the flame shows 0 for now, and the dinosaur is back to its first size. The first day you reach 600 starts it.
- **The rest of the rules are unchanged:** a third day short of the goal in the same week ends the streak, and Monday brings two new rest days. With no daily goal set, any day with a new word counts, as before.
- **The shield is only dimmed when no rest days are left.** Before, it was also dimmed when there was no streak.

### For the technically curious

- **The cause:** the streak in the status bar was booked when a day got its first word. Only the weekly view's goal streak used the goal. Rest days were also spent only while a streak was running.
- **Now:**
  - `StatsBook.setGoal()`: the window tells both copies of the statistics the daily goal, with every batch of credits (`goal`) and whenever it changes.
  - A day is booked when it reaches that goal, and unbooked if its words drop below it.
  - Each day stores the goal it was written under (`days[k].g`), so a later goal change only re-judges today.
  - A streak starting mid-week counts the week's earlier missed days as already spent.
  - With no streak, the shield counts the week's missed days directly.
  - The weekly view's goal streak is now the same number.
- **Upgrading:** a record from 0.16.0 or earlier, booked by any word, is rebuilt once from your daily totals when the goal is first known, and marked `rule: "goal"`. A Reset still keeps the streak.
- **Tests:** 167 unit tests pass, four of them new:
  - your week, day by day;
  - a streak starting mid-week;
  - goal changes not rewriting earlier days;
  - the one-time rebuild, with the window and the main process agreeing through a restart.

  The day-by-day reference check over random months now follows the new rule.
- **End to end:** a new test checks that typing up to the goal is what lights the flame. All the streak, statistics, layout and quick end-to-end tests pass.

## 0.16.0 — 21 October 2026

### New

- **A shield for your rest days.** Next to the streak flame at the bottom, a small shield shows how many of this week's two rest days you have left. It's dimmed when none are left, or when there's no streak yet. Hover it to see how rest days work.

### Fixed

- **No more jump when STET opens.** If you had left the window maximized, STET appeared empty for a moment and then filled in. Now it opens maximized with everything already drawn.

### For the technically curious

- **The jump:** on Windows, `BrowserWindow.maximize()` shows a hidden window at once, so maximizing right after creating the window put it on screen before the interface had loaded. A maximized window is now maximized at `ready-to-show` instead, so it appears in one go. A recording of the first frames from the first paint showed nothing moving inside the page.
- **The shield:** `#st-rest`, after `#st-streak` inside `#st-goal`. It's a 9×12 pixel drawing (`SHIELD_ART` in `app.js`, drawn in the text colour) showing `rest.left` from the statistics. The flame's tooltip no longer repeats the rest days.
- **Tests:**
  - an end-to-end test for the shield's count, tooltip, dimming and place beside the flame;
  - all 163 unit tests, the 23 quick end-to-end tests, and the streak, layout and app tests pass.
- **New checks:** `bench/launch-shift.js` and `bench/launch-frames.js` record layout shifts and the first frames when STET opens.

## 0.15.4 — 21 October 2026

### Improved

- **Just a soft highlight on the suggestion you're looking at.** The passage you point at or click no longer has a box with a hard line around it, or its underline. It's marked by the soft light grey alone, so the text reads cleanly. The other suggestions keep their underlines, so you can still tell which kind each one is.
- **Tidier code:** a little leftover code was removed. Nothing you use has changed.

### For the technically curious

- **The marks:** `.revr.hov` and `.revr.cur` have no box-shadow or bottom border, and slightly rounded corners. The glide test now checks this too.
- **The cleanup:**
  - removed `WILD` in `dino.js`, which nothing read (sprouts are picked by weight in `sprout()`);
  - removed an empty message element left in the Claude Connection dialog;
  - moved the note on faces in `dino-art.js` next to `headOver()`, which it describes.
- **The checks behind the cleanup:**
  - a scan of `src/` for unused imports, declarations and exports: the rest were false positives, such as names used through a namespace or a spread;
  - a scan for CSS classes the renderer never uses: there are none.
- **Tests:** 163 of 163 unit tests, the 23 quick end-to-end tests, and all 13 review and Claude Code end-to-end tests pass.

## 0.15.3 — 21 October 2026

### Improved

- **Click anywhere on a suggestion to go to it.** Clicking anywhere on a suggestion's card now glides the script to the passage: the change, the explanation, the space around the buttons or the card's edge. Before, only the line with the change worked. The buttons (Accept, Discard, Ignore, +Dictionary, Reopen) still do just their own job.

### For the technically curious

- The whole `.rv-item` is the `select` target. The panel acts on the nearest `data-act`, so a button inside the card still wins.
- The glide test now presses a different part of the card each time (the explanation, the change, the button row, the card itself), and checks that Discard still discards.

## 0.15.2 — 21 October 2026

### Fixed

- **Clicking a suggestion always takes you there, centred.** The glide could stop partway, or not move at all if the passage was already somewhere on screen. Now every click glides the passage to the middle of the screen, as near as the start and end of the script allow. That works whether it's far away or already visible, and if you click again mid-glide it simply heads for the new one. Scrolling with the wheel or clicking in the script takes over at once. With reduced motion turned on, it goes straight there.
- **Review highlights are no longer yellow.** The passage you clicked is now marked with a soft light grey in the dark theme, and a soft grey in the light theme. The text stays easy to read. Colour is kept for your own highlights.

### For the technically curious

- **Why it stopped:** the browser's built-in smooth scroll could be interrupted while pages were drawn in as they came into view, and it never moves in a window that isn't drawing.
- **The glide:** `View.glideTo(a, b)` now moves the scroll itself, frame by frame, recomputing the passage's middle each time. It always ends exactly there, and is put there when its time is up even if no frames were drawn. A wheel or a press on the script cancels it.
- **The shades:** `--rev-cur` and `--rev-hover` are neutral greys.
- **The test:** every click on a 240-line script, in a hidden and a shown window, must end with the passage centred to within a line. That covers far away, already on screen, rapid clicks mid-glide, and checking the shade is a grey. It passed three runs in a row.

## 0.15.1 — 20 October 2026

### Improved

- **Clicking a suggestion glides you to it.** The script now scrolls smoothly to the passage instead of jumping there, so you keep your bearings. If the passage is already comfortably on screen, nothing moves. With reduced motion turned on in Windows, it goes straight there as before.

### For the technically curious

- `View.revealCaret(center, smooth)` scrolls with `behavior: "smooth"`, and only when the caret isn't comfortably in view. The review panel uses it through `jump(…, smooth)`.
- A new end-to-end test, in a shown window (a hidden one draws no frames):
  - the script passes through several in-between positions on the way down, never jumping back;
  - the passage ends up in view;
  - a passage already in view stays put.

## 0.15.0 — 20 October 2026

The English review works again with no API key, through your Claude sign-in, and you can now choose how STET connects. The dinosaur's face stays itself in every pose. And while it sleeps deeply, STET rests too.

### Fixed

- **The review without an API key works again.** Newer versions of the Claude desktop app keep their copy of Claude Code in a different folder, so STET couldn't find it and asked for an API key. STET now looks in every place the app has used and takes the newest copy.
- **The dinosaur's face stays the same in every pose.**
  - **Lowered or lying down:** when it sniffed, chomped, crept, gnawed, lay down or rolled onto its back, its body showed through its head. Its open jaws looked shut, the mouth line disappeared, and when lying down its chin was cut short. Now its head is always drawn whole, in front of its body.
  - **As it grows:** the bigger it grows with your streak, the more its face changed shape when it turned round or rolled over. Its face now keeps exactly the same pixels whichever way it faces, upside down and at any size.
- **No more false matches in reviews.** A suggestion has to quote whole words from your script. Before, Claude quoting part of a word, such as "creatur" from "creature", could still get through.

### New

- **Choose how STET connects to Claude.** Under *Tools → Claude Connection…*, *Connect through* has three choices:
  - **Automatic** (the default): an API key if you have set one up, otherwise your Claude sign-in.
  - **Claude sign-in:** never an API key.
  - **API key:** never Claude Code.

  STET never switches on its own: if the one you chose isn't available, the review tells you what to do and mentions the other one if it's set up. *Check* tests the connection.
- **Signed out? You'll know right away.** STET checks your Claude sign-in before a review starts. If you're signed out, you get one clear message instead of every section of the review failing.
- **STET rests while the dinosaur sleeps.** When it's deep asleep and you're working in another program, it lies still, nothing animates and STET's background checks slow down, so the app uses almost nothing. Click back into STET and everything is there at once: the dinosaur breathes again straight away, then wakes up slowly as before. Saving and backups carry on as normal.

### For the technically curious

- **Finding Claude Code:** the copy the Claude app keeps is now found in `%LOCALAPPDATA%\Claude-Data\<install>\claude-code\<version>\<build>\claude.exe`, as well as the older `%APPDATA%\Claude\claude-code` and the MSIX `Packages\Claude_*\LocalCache` copies, and `~/Library/Application Support` on macOS. The newest version wins.
- **Claude Code code:** it now lives in `src/main/claude-code.js`, without Electron, so it can be unit-tested. `claude auth status` checks the sign-in, and only `loggedIn` is read from it.
- **The choice of connection** is saved in `claude-connection.json` in the app's settings folder, never in a script.
- **Faces:**
  - `headOver()` draws the head opaque from its outline on. The lying and on-its-back frames are built with it.
  - `FACE` records where each frame's head is.
  - `spriteEdges()` gives pixel edges by sprite index, with the head at one whole device-pixel size.
- **Dormant:** `Critter.dormant`, `Critter.tickDelay()`, `TIMING.dormantTick` (60 s), `Dino.onDormant` and `:root.dormant`.
  - **Ticks:** in a live run, 112 ticks and 47 redraws per 20 s in the background before the deep sleep, and none at all while dormant. Simulated over an hour dormant: 73 ticks, against about 2,400 before.
  - **Coming back:** the next breath came 14 ms after the window got the focus back.
- **Tests:** seven new unit tests (163 in all) and two new end-to-end tests:
  - unit: every frame's head; faces rasterised at every size, mirrored and upside down; the dormant state; whole-word quotes; finding Claude Code in the app's folder layouts; the sign-in check; a review section through a fake CLI;
  - end to end: the sign-in checked before anything is sent; the connection choice kept and never switched.
- **Live checks:** `bench/dormant-live.js` checks the dormant state in the running app. A live review through the real Claude Code with no key (`bench/revision-live.js`) took 27 s and found 6 problems.

## 0.14.0 — 20 October 2026

Your streak now has two rest days a week. The dinosaur notices when you're in another program: grass grows around it, it eventually falls fast asleep, and when you're back and writing it eats the grass. It also has four new routines.

### New

- **Two rest days a week for your streak.** You can miss up to two days a week (Monday to Sunday) without losing your writing streak, whether they're back to back or days apart. A third day off in the same week ends it. Writing in between doesn't give a rest day back, and you get two fresh ones every Monday. Hover the flame to see how many are left this week. The goal streak in the weekly view follows the same rule.
- **Grass while you're away.** When STET is in the background because you're working in another program, little tufts of grass slowly come up around the dinosaur, five at most. It leaves them alone while you're gone.
- **A deep sleep.** If you're away for a good while (about twelve minutes), it finishes what it was doing and settles into a deep sleep. When you come back it wakes up slowly, with a stretch and a yawn. Once you're writing again, it gets round to eating the grass, a bite at a time, over the next quarter of an hour or so.
- **Making its bed.** Before a proper rest it often turns round and round on the spot, scrapes it smooth and flops down with a sigh. Sometimes it isn't quite right and it starts again.
- **Lining up pebbles.** It finds pebbles one by one and sets them down in a neat little row. Then it's proud of it, sits and admires it, or knocks it flying with its tail.
- **Now and then: a tightrope act.** Arms out, careful steps along the line it stands on, a wobble that nearly has it off, then a bow, a hop down or a tumble.
- **Now and then: planting a flower.** It digs a little hole, drops in a seed, pats it down and waits, and up comes a flower.

### Improved

- **Cacti and palms stay longer:** six to fourteen minutes instead of under three. They don't wither while STET is in the background. The dinosaur never eats them.
- **Quieter in the background.** In a deep sleep nothing else happens, and the dinosaur needs less than one update a second.

### For the technically curious

- **Streak data:**
  - The streak record gains `spared`, the rest days spent; only those from the week of `last` are kept.
  - A day off spends a rest day on the day it carries the streak over, using the Monday-start local weeks of the weekly view.
  - The goal streak in `summary()` is replayed through the same code.
  - Records from 0.13 load with no rest days spent.
- **Focus and timing:** `Critter.setFocus()` and `TIMING` (deep sleep 12 min, tufts every 3–7 min, at most 5) handle the background behaviour. Tuft growth runs on timestamps, so a throttled or hidden window catches up on its next tick.
- **Repertoire:**
  - Activities: `graze`, `settleIn`, `gatherPebbles`, `tightrope` and `plantSeed`.
  - Reaction: `deepWake`.
  - Rare routines: the last two are on a 35-minute cooldown.
- **Engine fix:** a step that can't move at the end of the strip no longer keeps its `dx`.
- **Twelve new unit tests:**
  - streak rest days:
    - consecutive and separate days off;
    - the weekly reset;
    - a day never spent twice, through evaluation, rebooking, undo and restart;
    - migration;
    - a day-by-day reference over random months;
    - the goal streak;
  - grass growth on the clock;
  - eating only after you're back and writing;
  - deep sleep and the gentle wake-up, including coming and going at once and a hidden window;
  - large plants;
  - the four routines and how often they come up.

## 0.13.0 — 20 October 2026

The dinosaur has the whole width of the window to play in, walks properly wherever it goes, stands on the line instead of on top of it, and its little world is calmer, with plants that come and go.

### New

- **The whole width is its playground.** The stretch above TODAY is still home, and that's where it spends nearly all its time. But now and then curiosity takes it out towards the ends of the window for a look around before it strolls back.
- **A very rare trip to the corner.** Every so often (expect it once in a few hours at most) it walks all the way to the bottom-left corner of the window and has a good bite at the border. Then it walks home again, proud, puzzled or a little sore.
- **Plants come and go.** A cactus, a tuft of grass or a palm sometimes comes up out of the ground, growing stage by stage. The dinosaur notices it in its own good time, and sometimes goes over to see. It sniffs the cactus (and learns why you shouldn't), takes a bite of the grass, lies down beside it, or sits in the palm's shade. After a while the plant withers away again. Only one comes up at a time.

### Improved

- **Its feet stand on the line.** The dinosaur used to stand a pixel too low, its feet covering the status bar's top border. Now it stands on top of the border, at any window size and display scale, in every pose.
- **No more sliding.** It sometimes glided along the ground without moving its legs. Now it only moves when it takes a step, one stride per step and never further than its legs reach. That goes for creeping up on something too. Little hops and shuffles are real hops, and if it can't go any further it stands still instead of walking on the spot.
- **A calmer scene.** The wind used to send a stream of streaks across the screen. Now it's a gentle breeze: a faint gust or two and perhaps a single leaf. Fewer things float about at once (balloons, butterflies, bubbles, seeds, fireflies), and the weather and other surprises come along a little less often.
- **Less predictable.** What it just did now colours what it does next: after a romp it is more likely to sit down for a while, after a long rest to stretch and go for a stroll.

### For the technically curious

- The strip is now the whole width of `#scroller` (minus the scrollbar). The home stretch around TODAY is `Dino.home`, and `Critter.zone(f)` replaces fractions of `maxX` in the repertoire. The ground is the status bar's top edge (`Math.floor(bar.top × dpr)`), not TODAY's top.
- Ground steps (`dx` without `jump`, `lift` or `flip`) set `x` to `x1` for the whole step, and `walkTo()` caps strides at 2.5 or 3 `du`. Ticks are scheduled to land on step ends.
- New: the `sprout` event, the `wild` plants `cactus` and `grass`, the `creep`/`gnaw` frames, the `explore`, `cornerBite` and `visitPlant` activities, and the `plantNotice` reaction. Wind streaks are capped at 2.
- Five new tests:
  - no ground move without stepping, and every stride held, over hours of use;
  - the home preference and excursions;
  - the corner bite: rare, walked the whole way, biting at x = 0 facing the corner;
  - the breeze and the floating cap;
  - the plants' life cycle.
- The layout test now checks that the canvas's bottom edge sits on the border's top edge, both at full width and with a side panel open.

## 0.12.0 — 20 October 2026

The dinosaur stays itself when it sits or lies down, it is now STET's icon, its rarest surprises always come round again, and the status bar is tidier.

### New

- **The dinosaur is STET's icon.** The program, the taskbar, the window and the little mark at the bottom left all show the pixel dinosaur now, drawn crisp at every size.

### Improved

- **Sitting and lying down look like the dinosaur.** These poses used to squash it into a shapeless lump. Now its head, eye and body keep their standing size. Sitting, its legs fold under it with a thigh and a foot on the ground. Lying down, it rests its chin on the ground. Looking up from lying, only its head and neck rise, and on its back it is clearly itself upside down with its feet in the air.
- **Rare surprises always come round again.** The hatching egg and the UFO stay rare, but the longer it has been since the last one, the likelier the next. Expect one every hour or two of the app being open. The weather, the visitors and the growing things were checked too: they still turn up regularly.
- **Status bar labels are centred.** The element, page, scene and word count now sit in the middle of their boxes instead of hugging the left edge, and the version label has the same space on both sides.

### For the technically curious

- `SIT_BOTTOM`, `LIE`, `LIE_UP` and `FALLEN` are redrawn from the standing head and body; mouth and hat anchors follow. `scripts/icon.svg.js` now draws `FRAMES.stand` (or a slimmer 14 × 13 version where that comes out larger) on whole device pixels; `npx electron scripts/make-icon.cjs` rebuilds `build/icon.ico` and `mark.svg`. Rare surprises get a `luck` factor (up to 5×) from `lastRare`. A new test checks that over 4 simulated hours there is always at least one rare surprise, and never a flood of them.

## 0.11.0 — 20 October 2026

The dinosaur watches the sky, sees the sun set and rise with your theme, varies its everyday routines, and gets more visitors.

### New

- **Chin up, looking at the sky.** A new pose: lying on its front with its head raised. It daydreams like this (a butterfly may drift over), stargazes like this, sometimes ends a rest stretched out like this, lies like this in the palm's shade, and looks up at the sky before getting up from a nap.
- **Sunset and sunrise.** When AUTO switches the theme on its schedule, the dinosaur stops to watch. Going dark, the sun sinks, it waves goodbye and yawns, the moon rises, and it lies chin up as stars come out (with a little song for the moon). Going light, the moon fades, the sun comes up — waking it if it was asleep — and it stretches, roars good morning and hops for joy. Switching the theme by hand doesn't trigger it, and a dinosaur asleep at nightfall sleeps on while the moon comes up.
- **Visitors now and then:** a balloon on the breeze (it catches it and is lifted a little, misses, or pops it), a paper plane (it reads the note or sends it flying again), a frog (they take turns hopping), a ladybird (it climbs onto the dinosaur's head), a dandelion (a deep breath or a sneeze, and the seeds float away) and a worm that pops up here and there, always a moment too quick.
- **A few more answers to a click:** a smile, a peek, a sneeze, and lifting its chin to look at you when it is lying down.

### Improved

- **Less repetition.** The things it does most often now come out a little different each time. A rest has its own habit (a tail tap, a gaze about, a scratch). A walk has its own pace, sometimes a sniff halfway and a different arrival. Looking about can be at the ground, the sky or into the distance. Naps can include turning over, a spell on its back with its feet in the air, a dream or a yawn first. Hops sometimes end with a big one, a dance has a favourite move of the day, and a stretch may be a long one on the ground or end in a wobbly balance.

### For the technically curious

- New frames `lieUp`, `lieUpBlink`, `lieUpHowl` and `lieUpTail` (posture `lie`), and new props: sun, moon, balloon, plane, frog, ladybird, seed, dandelion and worm. `Dino.themeChanged()` is called from `refreshTheme()` only while the schedule is on. `Critter.themeShift()` queues `nightfall` or `daybreak`, and `sky()` reuses a sun or moon that is already up. There are now 71 activities and 100 reactions. New tests cover the chin-up pose, sunset and sunrise (also flipped at random over two simulated hours), variety in the everyday activities and every visitor coming and going; a new real-app test checks that AUTO, and not a manual switch, triggers the scene.

## 0.10.0 — 20 October 2026

Bold, italic, underline and strikethrough, one keystroke away.

### New

- **Text styles.** Select some text and press **Ctrl+B** for bold, **Ctrl+I** for italic, **Ctrl+U** for underline or **Ctrl+D** for strikethrough; press it again to turn it off. With nothing selected, the style applies to what you type next, and typing on at the end of a styled word keeps the style going. Styles combine freely, never change your words or your word count, and each change undoes in one step (Ctrl+Z).
- **B, I, U and S buttons** on the toolbar, right after the highlight colours. They light up to show the styles at the cursor or across your selection, and clicking one keeps you typing.
- **In the Format menu** too, with their shortcuts, and in the command palette (Ctrl+K) and the key list (F1).
- **Printed as you see them.** Styled text keeps its look in the PDF, when printing and in the print preview, on exactly the same layout: Courier stays the same width in every style, so nothing moves on the page. Styles are saved in your screenplay; a replaced word keeps its styles.

### Improved

- **Tidier code.** Leftover functions, imports and styles nobody used any more are gone, and the two highlight commands share one implementation.

### For the technically curious

- Styles are marks like highlights (`b`, `i`, `u`, `s`), split into runs per line by `styleRuns()`. The PDF uses the standard Courier, Courier-Bold, Courier-Oblique and Courier-BoldOblique fonts, so it still embeds none; underline and strikethrough are drawn as rules. A style toggled with no selection waits at the caret and is forgotten if the caret moves away first. New: `test/styles.test.js`, `test/e2e/styles.e2e.js`, and `npm run quick` — every unit test plus the core real-app tests in under a minute.

## 0.9.0 — 20 October 2026

A dinosaur with a much richer life and a little world around it, a writing streak that makes it grow, and simpler boxes at the top of the weekly view.

### New

- **A writing streak, beside TODAY.** A small flame and the number of days in a row you have written at least one new word. Today counts from your first word, a day that isn't over yet never breaks it, and a whole day without writing does. Opening, importing or pasting text never counts, and writing in several screenplays on the same day counts as one day. It's saved with your statistics, so it survives restarts and new versions (and even a statistics Reset). Hover it for your best streak and what's next.
- **The dinosaur grows with your streak.** One pixel at 1, 2, 4, 8, 16 and 32 days in a row — six at most, with a proud stretch when it happens, and always crisp. Every second milestone (2, 8 and 32 days) unlocks a special routine it may take up now and then: a skateboard ride with an ollie, a few tiny fireworks, and a rain dance that ends in the shade of a palm tree it has just grown. If the streak ends, it goes back to its first size and the next streak starts again.
- **Its own little world.** Now and then — never two things at once, and never too often — a rain cloud drifts over and rains on it, the wind gets up, a bird drops in (on its head, if it holds still), a tumbleweed rolls through, or a star falls at night. It may grow a palm tree and settle in its shade, shake it for a coconut, find a flower (and sneeze, or eat it), bounce on a mushroom, lie nose to nose with a snail, jump in the puddle the rain left, or chase fireflies. Each comes in, plays out and goes away gently: trees grow and wither, clouds and rainbows fade.
- **Rain, its way.** What it does depends on what it was doing when the cloud came: it sleeps right through it, runs for the palm tree, makes a run for it (the cloud follows), opens its mouth to catch the drops, holds a leaf over its head, dances in it, or just sits it out looking damp.

### Improved

- **Clicks that make sense.** A click now gets a reaction that fits what the dinosaur was doing at that moment: it stops mid-stride, skips or trips while walking; guards (or almost shares) its bone; rings the typewriter's bell or holds up its page; scoots over when sitting; talks in its sleep, rolls over, or glares and goes back to sleep; hides behind the palm's very thin trunk; shoos a bird off its head. Plus many new ones anywhere — from a double take to a full show-off routine — so repeated clicks keep surprising you. It still notices a click in the same instant, and still never speeds anything up or cuts a movement short.
- **More than twice as much to do.** 62 activities and 96 reactions (up from 28 and 33), all different — new poses (a tail wag, a scratch behind the ear, a howl, a cower, a run), short moments and longer stories, and moods that steer them: playful, curious, sleepy, grumpy, silly.
- **The weekly view's top boxes are simpler.** Each shows just the day or week, the words written and the target — no percentages or extra notes — so you can read them at a glance, even in the hundreds of thousands. The details are still below.

### Changed

- **The dinosaur no longer reacts when the pointer passes over it.** Only clicks count, so it never distracts you while you move about the page.

### For the technically curious

- The companion is now three files: the pixel art (`dino-art.js`), the repertoire (`dino-acts.js`) and the engine (`dino.js`). A click is answered from a snapshot of what it is doing (`context()`); environmental events have a lifecycle and start only when it can take part, one at a time.
- The streak lives in the statistics ledger (`core/streak.js`), booked by the same code in the window and the main process; statistics from 0.8 get the streak their days already show.
- The end-to-end test driver no longer waits for ever on an app that closes mid-request (an occasional hang in long runs).
- New tests: every behaviour played through from every posture, reactions that fit the context, the weather and the palm tree from start to finish, a few events an hour and never two at once, exactly one pixel per milestone; the streak's day rules, all milestones, restarts and Reset; and in the real app the streak from 0 to 32 days with the dinosaur measured pixel by pixel, several screenplays in a day, opened and pasted text, a restart, an update from 0.8, the weekly boxes in both themes, and a rain shower, a palm tree and a skateboard ride drawn whole.

## 0.8.0 — 20 October 2026

A livelier, more attentive dinosaur with room to play, a weekly view that copes with big writing days, the same smooth slide for every panel, a fixed Open Recent, and a tidier header.

### New

- **The dinosaur has room to play.** It now roams a much wider stretch of the desk above the status bar instead of a strip the width of TODAY — without taking any space from the editor, which works underneath it exactly as before. It mostly keeps to the middle, strolls out towards the ends now and then, and never disappears off an edge: balls, butterflies, leaves and the occasional visitor stay whole all the way. If a panel opens or the window gets smaller, it simply walks back into view.
- **It notices you.** Bring the pointer near and it turns to look at you straight away (sometimes with a little heart or question mark). Click it and it reacts in the same instant with a blink and a little start, then carries on into its reaction — the same wide, unpredictable range as before, from a nod to fainting dramatically. Nothing it does is sped up or cut short for this: only a pose it is simply holding gives way early.

### Improved

- **The weekly view (F9) handles big numbers.** Days of several thousand words — or a hundred thousand — are shown exactly, with separators, and never overlap. The chart's scale now follows your week, with round numbers and the goal marked at the side. If one day is far above the rest, its bar is drawn with a break so the other days stay readable. The window is also smaller and tidier, and shows how far past your goal you went (for example "3.2× the goal"). For past weeks, the second box shows your daily average.
- **Every panel slides the same way.** Find & Replace (Ctrl+F) now slides out from under the toolbar just as the Scenes, Notes and Revise panels slide in from the side, with the same speed and easing. Dialogs and menus drop softly into place and fade away when closed. You can type in the search field the moment you press Ctrl+F, and toggling a panel mid-slide reverses smoothly. With *reduce motion* turned on in Windows, nothing moves.
- **A cleaner header.** File, Edit and Element now start at the very left. The centre shows only the screenplay's title, centred on the window and shortened with "…" if it is very long. The STET icon and version moved to the bottom-left corner, a little smaller (click them for this changelog).
- **The dinosaur's sneakier side.** Instead of walking off the edge of the bar, it now creeps along with its head down and pops up with a "boo!", and when it runs off in a huff it sulks at the far end with its back to you before peeking round.

### Fixed

- **Open Recent: the move-to-bin and remove icons were out of sight.** A long file path made the list wider than the window, pushing both icons off to the right behind a sideways scrollbar. The list now always fits: long paths are shortened from the start ("…\Second Draft\Night Ferry.stet", with the full path on hover), names keep priority, and the icons — *Remove from Recent* and *Move to Recycle Bin* — appear on whichever row you hover, at any window size.
- **The dinosaur no longer catches a text selection** dragged across it.
- **The status bar no longer shifts** by a few pixels when the cursor moves into a scene heading.

### For the technically curious

- One set of motion helpers (`ui/motion.js`: `setPanel` for docked panels on any side, `arrive`/`leave` for dialogs and menus) now drives every surface that opens.
- The weekly chart sizes its bars in pixels against a round-number scale (`core/chart.js`), so a label can never squeeze a bar.
- New tests: the dinosaur on a wide strip for hours (always in view, mostly in the middle, every move at full length, clicks and the cursor answered within a frame or two, walking back in after a resize), the chart's scale and number formatting, and end-to-end tests in the real app for the header, the dinosaur, the weekly view with very large numbers, panel motion (including reduced motion) and Open Recent with long paths at two window widths.

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
