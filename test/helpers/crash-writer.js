// Child process for the crash test: saves ever-growing documents in a tight
// loop until it is killed.
import { atomicWrite } from '../../src/main/files.js';
import { encode } from '../../src/main/container.js';
import { serialize } from '../../src/core/serialize.js';
import { newDocument } from '../../src/core/model.js';
import { generateScript } from '../../src/dev/sample.js';

const file = process.argv[2];
const doc = newDocument();
let n = 0;
for (;;) {
  doc.blocks = generateScript(20 + (n++ % 60), n);
  await atomicWrite(file, await encode(serialize(doc)));
}
