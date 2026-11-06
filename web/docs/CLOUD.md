# iCloud and Google Drive

What each service allows a website to do, what is built, and what is deliberately not. Research date:
November 2026. Recheck the "as far as found" points before relying on them.

## Summary

| | Open | Save over the same file | Automatic saving | State |
|---|---|---|---|---|
| Device file, Chrome or Edge | yes | yes | yes | working, tested |
| Device file, Safari or Firefox | yes | no, saves a new copy | no, drafts only | built, not tried on real devices |
| Google Drive | yes | yes | yes | built, **needs the owner's Google setup**, never run against real Google |
| iCloud Drive, iPhone or iPad | yes, through Files | no, saves a new copy | no, drafts only | built, not tried on real devices |
| iCloud Drive, Mac | yes, through the file dialog | Chrome/Edge: to be tested. Safari: no | as for saving | not tried |
| iCloud Drive, Windows | yes, via the iCloud Drive folder | Chrome/Edge: expected to work | as for saving | not tried |

Whatever the service, every change is kept in the browser (IndexedDB) until it reaches the file.

## iCloud Drive

**There is no iCloud Drive API for websites.** Apple exposes iCloud Drive to apps through operating
system document APIs. CloudKit JS exists, but it reaches an app's own CloudKit container, not the files
in a person's iCloud Drive, so a `.stet` file there cannot be seen through it.

Unofficial routes (signing in to icloud.com on the writer's behalf, private endpoints) are ruled out:
they ask for an Apple password and break without notice. That is the fragile workaround not to build.

What works instead is the device itself, which already knows iCloud Drive:

- **Opening:** the system file picker shows iCloud Drive on an iPhone, iPad or Mac. On iPhone and iPad
  STET offers every file, because iOS greys out extensions it does not know; the file's own header then
  decides whether it is a screenplay.
- **Saving on iPhone and iPad:** the share sheet, then Save to Files, then iCloud Drive. This makes a
  **new copy** each time (iOS asks about replacing it). The menu says "Save to Files or iCloud Drive".
- **Saving on a computer with Chrome or Edge:** the iCloud Drive folder is an ordinary folder there, so
  saving in place should work. To test: Chromium refuses some system folders, and iCloud Drive on a Mac
  lives under `~/Library`; this may be refused.

**Not possible for now:** seeing a change made on another device while the screenplay is open, automatic
saving back to iCloud on iPhone and iPad, and a list of screenplays in iCloud inside STET.

**The real route later:** a native iOS/macOS wrapper with iCloud entitlements, or Safari gaining the File
System Access API (not supported as far as found).

## Google Drive

Google has what is needed, so this is a full integration:

- **Sign-in:** Google Identity Services token client in the browser. There is no server. The token stays
  in memory for about an hour and is never stored.
- **Scope:** `drive.file` only. STET sees only the files the writer opens with it or creates with it,
  never the rest of their Drive.
- **Opening:** Google's own Picker, which is also what grants access to a file under `drive.file`.
- **Saving:** in place through the REST API, automatically, a moment after writing stops. Before each
  save STET compares the file's `version`, and if it changed elsewhere it asks instead of overwriting.
  Drive keeps earlier versions in the file's history as well.
- **Privacy:** `google.js` is loaded only when the writer first chooses Google Drive. A writer who never
  does makes no request to Google (`test/separation.test.js`).

### What the owner must do to turn it on

It stays off, with a plain message in the app, until `src/config.js` is filled in. These can only be done
with the owner's Google account:

1. Create a project in the Google Cloud console and enable the **Google Drive API** and **Google Picker API**.
2. Configure the OAuth consent screen, with the scope `.../auth/drive.file`, and publish it. Check
   Google's current rules on whether this scope needs verification; while the app is in testing only
   listed test users can sign in.
3. Create an **OAuth client ID** (Web application) with the authorised JavaScript origin
   `https://mediocrecode56.github.io`.
4. Create an **API key** restricted to that site and to the Picker API.
5. Put the client ID, the API key and the project number in `src/config.js`. All three are public by
   design, which is why that is safe.

### Limits to know

- After about an hour the sign-in ends. Writing carries on, the status bar says KEPT IN THIS BROWSER, and
  a click signs in again. Signing in needs a click: browsers block it otherwise.
- The check before saving and the save are two calls, so a change landing between them can be missed.
  Drive's version history is the safety net.
- New files go to the top of My Drive. A folder choice can come later.
- Not yet run against real Google: `drive.js` is tested against a stand-in for the API; `google.js` (the
  sign-in and Picker) cannot be tested until the setup above is done. **Try this first once it is set up.**

## Sources

- [File System Access API (Chrome for Developers)](https://developer.chrome.com/articles/file-system-access)
- [Opening files in the browser (web.dev)](https://web.dev/articles/files/open-one-or-multiple-files)
- [Google Picker for web apps](https://developers.google.com/picker/docs)
- [Apple Developer Forums: iCloud Drive REST API](https://developer.apple.com/forums/thread/733237)
