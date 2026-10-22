// Worker thread: document JSON -> paginated print model -> PDF bytes.
import { parentPort, workerData } from 'node:worker_threads';
import zlib from 'node:zlib';
import { deserialize } from '../core/serialize.js';
import { buildPrintPages } from '../core/printmodel.js';
import { buildPdf } from '../core/pdf.js';

try {
  const { json, options, fonts } = workerData;
  const { doc } = deserialize(json);
  const { pages } = buildPrintPages(doc, options);
  if (!pages.length) throw new Error('Nothing to export: the selected range contains no pages.');
  const bytes = buildPdf(pages, {
    title: doc.titlePage.title || '',
    author: doc.titlePage.author || '',
    creator: 'STET ' + (options.appVersion || ''),
    deflate: (b) => zlib.deflateSync(b, { level: 6 }),
    fonts,
  });
  parentPort.postMessage({ ok: true, bytes }, [bytes.buffer]);
} catch (e) {
  parentPort.postMessage({ ok: false, error: e.message });
}
