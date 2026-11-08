// OpenAI Codex as the revision's backup when Claude has no usage left: finding it, checking
// its sign-in and reading one review's answer — against a fake CLI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findCodex, codexSignedIn, prepareCodex, reviewChunkCodex } from '../../src/main/codex.js';

const FAKE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'helpers', 'fake-codex.mjs');

test('Codex reviews a section read-only in the findings schema, and reports its own usage limit', async () => {
  process.env.STET_CODEX = FAKE;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stet-codex-test-'));
  try {
    const cli = await findCodex();
    assert.equal(cli.path, FAKE);
    assert.equal(await codexSignedIn(cli), true);
    const schema = await prepareCodex(dir);
    const r = await reviewChunkCodex(cli, dir, schema, 'SYSTEM-TEXT', { prompt: 'John enter.' });
    assert.equal(r.ok, true);
    assert.equal(r.findings[0].replacement, 'enters');
    process.env.STET_FAKE_CODEX = 'limit';
    const l = await reviewChunkCodex(cli, dir, schema, 'SYSTEM-TEXT', { prompt: 'John enter.' });
    assert.equal(l.ok, false);
    assert.equal(l.error.code, 'rate_limit');
    process.env.STET_CODEX = 'none';
    assert.equal(await findCodex(), null);
  } finally {
    delete process.env.STET_CODEX; delete process.env.STET_FAKE_CODEX;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
