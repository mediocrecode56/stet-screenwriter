# Google Drive sync (desktop)

How STET keeps screenplays in the writer's Google Drive, and what the owner must do once to turn it on.
The browser version has its own Drive integration (web/docs/CLOUD.md); both can use the same Google
Cloud project, with one OAuth client each.

## What it does

- **Off until the writer connects.** File > Connect Google Drive… opens Google's sign-in in the system
  browser. Nothing is sent to Google before that, and a copy of STET without the setup below shows no
  Drive section at all.
- **Local first.** STET works on the file on the computer and saves it exactly as before. A few seconds
  after the writer stops saving (never more than 30 s after the first unsent change), the same `.stet`
  file is uploaded to a `STET` folder in their Drive. The folder is made once and found again by any
  computer that connects.
- **Which screenplays.** Every screenplay opened or saved while connected, including ones never synced
  before (they go up when opened). File > Stop Syncing This Screenplay leaves one out; the choice is
  kept in the file (`"drive": false`, docs/FILE_FORMAT.md) and the copy already in Drive stays.
- **Changes from elsewhere.** The open screenplay is checked once a minute and when the window comes
  back to the front (one small request). If Drive has a version this computer hasn't seen, a line above
  the status bar offers OPEN THAT VERSION (this one is backed up first) or KEEP THIS ONE (Drive keeps the
  other in its version history). A save is never sent over a version changed elsewhere unasked.
- **Few requests.** One upload per screenplay per burst of saves, one check a minute for the open one.
  When Google says to slow down (429, rate-limit 403, 5xx) or can't be reached, every wait doubles, from
  5 s up to 5 minutes, and resets after the next success. Quitting sends what is pending, for at most
  4 seconds.
- **Where things are.** File > Open Google Drive Folder opens the folder in the browser; File > Open
  from Google Drive… lists it and downloads a screenplay into the screenplays folder (one already on this
  computer is simply opened). Open Recent and the status bar show a cloud for synced screenplays.

## Privacy and permissions

- Scope `drive.file` only: STET sees the files it created, never the rest of the writer's Drive.
- The sign-in (a refresh token) is kept encrypted by the operating system (`safeStorage`) in
  `drive-token.bin` in STET's settings folder. Which local file is which Drive file is in `drive.json`
  there. Neither ever goes into a screenplay.
- Disconnect (File menu) forgets the sign-in and gives it back to Google; the files stay in Drive and on
  the computer.

## The Google Cloud setup

Done on 2026-11-27: project `stet-516011`, Desktop client "STET desktop", consent screen External and
**In production** (scope `drive.file` only, which is non-sensitive, so no Google review; no logo, so no
brand verification). Home page and privacy policy: the browser version's site, `privacy.html`
(web/privacy.html), with `mediocrecode56.github.io` as the authorised domain. Adding a logo or a
sensitive scope would need Google's verification first.

To set it up again from scratch, with the owner's Google account:

1. In the Google Cloud console, open (or create) the project used for STET and enable the
   **Google Drive API**.
2. **OAuth consent screen:** app name STET, the owner's support email, the scope
   `https://www.googleapis.com/auth/drive.file`. While the app is in Testing, only the test users listed
   there can sign in; publish it for everyone. Check Google's current rules on verification for this
   scope before publishing.
3. **Credentials > Create credentials > OAuth client ID**, type **Desktop app**. Google shows a client
   ID and a client secret. For a desktop app the secret is not confidential (it ships inside the app).
4. Store both as the repository secrets `STET_DRIVE_CLIENT` and `STET_DRIVE_SECRET` (GitHub > Settings >
   Secrets and variables > Actions, or `gh secret set`). The release build writes them into the packaged
   copy of `src/main/drive-config.js` (`writeDriveConfig` in scripts/package-tools.js); git keeps that
   file empty, because GitHub's push protection refuses an OAuth client in a commit. A release build
   without the secrets stops.

For a development run: set `STET_DRIVE_CLIENT` and `STET_DRIVE_SECRET` in the environment.

## Code and tests

- `src/main/drive.js`: sign-in (loopback redirect with PKCE), the upload queue, checks, conflicts, the
  folder, listing and downloading. `src/main/main.js` wires it to saving, renaming, Recent, the window's
  focus and quitting.
- `src/renderer/drive.js`: the File menu's section, the status bar cloud, the offer, Open from Google
  Drive.
- `test/unit/drive.test.js` runs the module against `test/helpers/fake-drive.js`, a stand-in for
  Google's sign-in and the Drive API; `test/app/drive.app.js` runs the real app against it
  (`STET_DRIVE_URL`, honoured only in tests and development runs, where the "browser" is a fetch).
- Checked against the real Google on 2026-11-27 with the shipped client (sign-in, upload, a later save,
  a change from elsewhere noticed and opened, listing, download on a second computer, disconnect). Repeat
  that after any change to the sign-in or the requests.
