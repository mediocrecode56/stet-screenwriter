// Live check of the English revision against the real Claude API.
// Needs a key: ANTHROPIC_API_KEY in the environment, or a key saved in the app
// (Tools → Claude API Key…) together with STET_USE_APP_PROFILE=1 to reuse your
// normal settings folder. `node bench/revision-live.js` — costs a few cents.
import path from 'node:path';
import os from 'node:os';
import { App, sleep } from '../test/e2e/cdp.js';

const ud = process.env.STET_USE_APP_PROFILE ? path.join(process.env.APPDATA, 'stet') : path.join(os.tmpdir(), 'stet-live');
const app = await App.launch({ userData: ud });
await app.eval(`window.stet.invoke('settings:set', { reviewConsent: true }).then((s) => Object.assign(__stet.settings(), s))`);
await app.eval(`(async () => {
  const { newDocument, makeBlock } = await import('../core/model.js');
  const d = newDocument('LIVE'); d.settings.backup.enabled = false;
  d.blocks = [
    makeBlock('scene', 'INT. KITCHEN - NIGHT'),
    makeBlock('action', 'Mara enter in the kitchen and make a coffee. Rain. Silence.'),
    makeBlock('character', 'TEO'),
    makeBlock('dialogue', "Ain't nobody awake at this hour, sis. Go back to bed."),
    makeBlock('action', 'She is looking to him since five minutes, without to say nothing.'),
    makeBlock('character', 'MARA'),
    makeBlock('dialogue', 'I have twenty-nine years and I still live with my brother.'),
    makeBlock('action', 'Teo made a decision of leaving. He grabs his keys, slams the door.'),
  ];
  __stet.session.load(d, null);
})()`);
await app.eval('__stet.revision.show(true); __stet.revision.start()');
for (let i = 0; i < 600 && !(await app.eval('!!(__stet.revision.run && __stet.revision.run.finished)')); i++) await sleep(250);
const run = await app.eval('({ failed: [...__stet.revision.run.failed.values()], fatal: __stet.revision.run.fatal, usage: __stet.revision.run.usage, rejected: __stet.revision.run.rejected })');
const findings = await app.eval('__stet.revision.findings.map((f) => ({ category: f.category, confidence: f.confidence, original: f.shownOriginal, replacement: f.shownReplacement, why: f.explanation }))');
console.log(JSON.stringify(run, null, 1));
console.table(findings);
await app.close();
