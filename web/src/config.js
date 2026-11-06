// The browser version's settings. Everything here ends up in public files: nothing secret belongs
// in it, and an OAuth client id and a browser API key are public by design (Google restricts them to
// this site's address). docs/CLOUD.md says how to get them.

export const VERSION = '0.1.0-alpha';

export const GOOGLE = {
  clientId: '',  // OAuth 2.0 client id (a web application), ending .apps.googleusercontent.com
  apiKey: '',    // browser API key, restricted to the Picker API and this site
  projectNumber: '', // the Google Cloud project's number
};

export const driveConfigured = (g = GOOGLE) => !!(g.clientId && g.apiKey && g.projectNumber);
