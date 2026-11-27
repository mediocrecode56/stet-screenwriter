// The Google Cloud OAuth client STET's Google Drive sync signs in through (src/main/drive.js): type Desktop
// app, project stet-516011, "STET desktop" (docs/DRIVE.md). Google treats a desktop app's client secret as
// public (it ships inside the app); the writer's sign-in never is.
//
// Left empty in git, where GitHub's push protection refuses it: the release build fills both from the
// repository secrets STET_DRIVE_CLIENT and STET_DRIVE_SECRET (writeDriveConfig in scripts/package-tools.js).
// A development run reads the same two environment variables; without them the File menu has no Drive.

export const GOOGLE_DESKTOP = {
  clientId: '',
  clientSecret: '',
};
