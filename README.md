# STET

A calm, simple place to write your screenplay.

![STET with a screenplay open](docs/images/writing.png)

### [Download STET for Windows](https://github.com/mediocrecode56/stet-screenwriter/releases/latest/download/STET-Windows.zip)

### [Download STET for Mac](https://github.com/mediocrecode56/stet-screenwriter/releases/latest/download/STET-macOS.dmg)

Free. For Windows 10 and 11, and Macs with Apple silicon (M1 or later) on macOS 12
or later.

## Get started on Windows

1. Download **STET-Windows.zip** with the link above.
2. Open the zip and drag **STET.exe** to your Desktop, or any folder you like.
3. Double-click **STET.exe**. The very first start takes a few seconds; after
   that it opens straight away.

Windows may say *"Windows protected your PC"* because STET is a new app it
doesn't know yet. Click **More info**, then **Run anyway**. You only need to do
this once.

To open screenplays with a double-click, choose **Help → Open .stet Files with
STET** once.

**Prefer a regular install?** Download the
[installer](https://github.com/mediocrecode56/stet-screenwriter/releases/latest/download/STET-Setup.exe)
instead. It adds STET to your Start menu, lets you open screenplays with a
double-click (a box you can untick), and can be removed from Settings → Apps. It updates the same way,
from inside STET.

## Get started on a Mac

1. Download **STET-macOS.dmg** with the link above and open it.
2. Drag **STET** to the **Applications** folder.
3. Open STET from Applications.

The first time, macOS may say it can't check STET for malware, because STET is
a new app from an independent developer. Click **Done**, then open **System
Settings → Privacy & Security**, scroll down and click **Open Anyway** next to
STET. You only need to do this once.

## Updating

STET checks for a new version when it opens. When there is one,
**UPDATE** appears at the bottom right: click it, then **Update now**. STET
downloads it while you keep writing (usually about a megabyte) and asks to
restart when it's ready. A second later you're on the new version. Your
screenplays, settings and writing statistics stay just as they are. You can also
check any time under **Help → Check for Updates**.

## What it's like

**Just write; it formats itself.** Press Enter and Tab, and scene headings,
characters and dialogue fall into place in the standard screenplay layout.

**Your work is always safe.** STET saves as you type, keeps backups, and brings
back anything unsaved if your computer shuts down unexpectedly.

**Day or night.** A light page for the day, a dark one for the evening, or let
STET switch by itself at the times you choose.

![STET in dark mode, with the scene list and notes](docs/images/dark.png)

**Notes and highlights.** Leave yourself a note on any line, mark passages in
colour, and jump between scenes from the scene list.

**A goal for every day.** Set how much you want to write each day and each week,
watch your week fill up, and keep a streak going.

![Your writing week](docs/images/week.png)

**A little companion.** A tiny dinosaur lives at the bottom of the window and
keeps you company while you write. It grows as your streak does. You can hide
it from the View menu.

**Print and PDF.** Print your screenplay or save it as a PDF, title page
included, ready to send.

![Print and export](docs/images/print.png)

**Bring your Final Draft scripts.** File → Import Final Draft… turns an .fdx
file into a STET screenplay: scenes, action, characters, dialogue, the title
page and bold, italic, underline and strikeout come across as they were.

**A second pair of eyes (optional).** If you use Claude, it can read through
your dialogue and action and suggest fixes to the English. Nothing changes
until you accept.

## The timeline

![The timeline above the script, with two scene timecodes and the time under the pointer](docs/images/timeline.png)

The strip under the toolbar is your whole screenplay from left to right, like a track
in a video editor: a tick for each scene, your highlights in their colours, a small
icon for each note, and a time ruler with the script's estimated running time at the
right end. The shaded band is the part you're looking at, and the line with the little
cap is where you're typing. Hide or show it with **Ctrl+Shift+T**.

- **Point** at it to see the time and the scene there. **Click** to go there; a click
  near a scene, note or highlight lands right on it.
- **Drag sideways** to zoom in and out around that point. **Drag the shaded band** to
  scroll the script. **Double-click the ruler** to see the whole script again.
- **Timecodes** set the clock: the ruler counts a minute a page until you pin real
  times to it, then spreads the time evenly between them and estimates the rest.
  **Right-click a scene** to give it its own timecode: it shows beside the scene
  heading in your script. Right-click anywhere else to add one there, or click a
  timecode to change its time, give it a tag and a colour, or remove it.
- **Hold Ctrl** (**Cmd** on a Mac) over the strip to move through the script a second
  at a time, slower than the mouse so you can land on the exact second. While Ctrl
  is held, a **right-click** pins a timecode at that second. Let go to stay there, or
  press **Esc** to go back.

## Handy keys

| Press | To |
|---|---|
| Enter | move on to the next line: after a character, their dialogue |
| Tab | start a different kind of line, or change an empty one (the outlined ones in the toolbar; Ctrl+click one to leave it out) |
| Ctrl+S | save (STET also saves by itself) |
| Ctrl+F | find |
| Ctrl+P | print or save as PDF |
| F9 | see your writing week |
| Ctrl+K | search every command |
| Ctrl+Shift+T | show or hide the timeline (above) |
| Ctrl+L, E, R, J | align left, centre, right, or justify |
| F1 | see all the keys, and change any of them |

## Good to know

- Screenplays are saved as `.stet` files, in your **Documents\STET** folder
  unless you choose another place.
- Pages are A4 and look like Final Draft's: the same Courier, letter spacing, margins, line spacing and page breaks.
- STET is young and improving often. See [what's new](CHANGELOG.md).

---

<sub>Building or changing STET? See [STET for developers](docs/DEVELOPING.md).</sub>
