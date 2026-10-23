// Live check of the English revision against the real Claude.
// With no API key it runs through Claude Code on your Claude sign-in (no setup);
// with ANTHROPIC_API_KEY set, or STET_USE_APP_PROFILE=1 and a key saved in the app,
// it uses the API instead. `node bench/revision-live.js`
import path from 'node:path';
import os from 'node:os';
import { App, sleep } from '../test/app/harness.js';

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
const run = await app.eval('({ failed: [...__stet.revision.run.failed.values()], fatal: __stet.revision.run.fatal, rejected: __stet.revision.run.rejected })');
const findings = await app.eval('__stet.revision.findings.map((f) => ({ category: f.category, confidence: f.confidence, original: f.shownOriginal, replacement: f.shownReplacement, located: !!__stet.revision.located(f) }))');
console.log(JSON.stringify(run, null, 1));
console.table(findings);
await app.close();
