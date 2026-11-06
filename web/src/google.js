// Signing in to Google and its file picker. Nothing here loads until the writer first asks for Google
// Drive, so a writer who never does sends nothing to Google. The access token lives in memory only, for
// about an hour; when it ends, the screenplay stays safe in drafts until the writer signs in again.

import { GOOGLE } from './config.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
let token = null, expires = 0, tokenClient = null, ready = null;

const script = (src) => new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = src; s.async = true; s.onload = resolve; s.onerror = () => reject(new Error('Google could not be reached.'));
  document.head.appendChild(s);
});

function load() {
  ready ||= Promise.all([script('https://accounts.google.com/gsi/client'), script('https://apis.google.com/js/api.js')])
    .then(() => new Promise((r) => window.gapi.load('picker', r)))
    .catch((e) => { ready = null; throw e; });
  return ready;
}

export const currentToken = () => (token && Date.now() < expires ? token : null);

/** Sign in, or renew. Must follow a click: browsers block the window otherwise. */
export async function signIn() {
  await load();
  if (currentToken()) return token;
  return new Promise((resolve, reject) => {
    tokenClient ||= window.google.accounts.oauth2.initTokenClient({ client_id: GOOGLE.clientId, scope: SCOPE, callback: () => {} });
    tokenClient.callback = (r) => {
      if (r.error) return reject(new Error(r.error_description || r.error));
      token = r.access_token;
      expires = Date.now() + (Number(r.expires_in) - 60) * 1000;
      resolve(token);
    };
    tokenClient.error_callback = (e) => reject(new Error(e.message || 'Signing in to Google did not finish.'));
    tokenClient.requestAccessToken({ prompt: '' });
  });
}

export function signOut() {
  if (token) window.google?.accounts?.oauth2?.revoke(token);
  token = null;
  expires = 0;
}

/** Google's own file picker. Resolves { id, name }, or null if closed. */
export async function pickDriveFile() {
  await signIn();
  const { picker } = window.google;
  return new Promise((resolve) => {
    const view = new picker.DocsView(picker.ViewId.DOCS).setMode(picker.DocsViewMode.LIST).setIncludeFolders(true).setQuery('.stet');
    new picker.PickerBuilder()
      .setDeveloperKey(GOOGLE.apiKey).setAppId(GOOGLE.projectNumber).setOAuthToken(token)
      .addView(view).setTitle('Open a screenplay')
      .setCallback((d) => {
        if (d.action === picker.Action.PICKED) resolve({ id: d.docs[0].id, name: d.docs[0].name });
        else if (d.action === picker.Action.CANCEL) resolve(null);
      })
      .build().setVisible(true);
  });
}
