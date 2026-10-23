import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { atomicWrite, SaveQueue, createBackup, listBackups, pruneBackups, backupTime, Recovery, cleanTemps, readDocument, backupDirFor } from '../../src/main/files.js';
import { encode, decode, check } from '../../src/main/container.js';
import { serialize } from '../../src/core/serialize.js';
import { newDocument, makeBlock } from '../../src/core/model.js';

let dir;
before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stet-test-')); });
after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

const docJson = (text) => { const d = newDocument(); d.blocks = [makeBlock('action', text)]; return serialize(d); };

test('atomicWrite replaces content and leaves no temp files', async () => {
  const f = path.join(dir, 'a.stet');
  await atomicWrite(f, await encode(docJson('one')));
  await atomicWrite(f, await encode(docJson('two')));
  assert.match(await decode(await fs.readFile(f)), /two/);
  const left = (await fs.readdir(dir)).filter((n) => n.endsWith('.tmp'));
  assert.deepEqual(left, []);
});

test('a failed verification never touches the existing file', async () => {
  const f = path.join(dir, 'b.stet');
  await atomicWrite(f, await encode(docJson('good')));
  await assert.rejects(atomicWrite(f, Buffer.from('garbage')));
  assert.match(await decode(await fs.readFile(f)), /good/);
  assert.deepEqual((await fs.readdir(dir)).filter((n) => n.endsWith('.tmp')), []);
});

test('SaveQueue drops stale revisions and serialises writes', async () => {
  const f = path.join(dir, 'q.stet');
  const q = new SaveQueue();
  const results = await Promise.all([q.save(f, 3, docJson('rev3')), q.save(f, 2, docJson('rev2')), q.save(f, 5, docJson('rev5')), q.save(f, 4, docJson('rev4'))]);
  assert.deepEqual(results.map((r) => !!r.skipped), [false, true, false, true]);
  assert.match(await decode(await fs.readFile(f)), /rev5/);
});

test('SaveQueue detects external modification and refuses to overwrite', async () => {
  const f = path.join(dir, 'ext.stet');
  const q = new SaveQueue();
  assert.ok((await q.save(f, 1, docJson('mine'))).ok);
  await new Promise((r) => setTimeout(r, 30));
  await atomicWrite(f, await encode(docJson('theirs'))); // another program
  const r = await q.save(f, 2, docJson('mine again'));
  assert.equal(r.conflict, true);
  assert.match(await decode(await fs.readFile(f)), /theirs/);
  assert.ok((await q.save(f, 3, docJson('forced'), { force: true })).ok);
});

test('backups: naming, listing, retention keeps the newest valid copy', async () => {
  const doc = path.join(dir, 'Script.stet');
  await atomicWrite(doc, await encode(docJson('main')));
  const bdir = backupDirFor(doc);
  assert.equal(bdir, path.join(dir, 'Script Backups'));
  const day = 86400000;
  const now = Date.now();
  const files = [];
  for (const age of [40, 35, 10, 1]) files.push(await createBackup(bdir, 'Script', docJson('age' + age), new Date(now - age * day)));
  const list = await listBackups(bdir);
  assert.equal(list.length, 4);
  assert.ok(list[0].time > list[3].time, 'newest first');
  assert.ok(backupTime(path.basename(files[0])) > 0);
  const removed = await pruneBackups(bdir, 30, true, now);
  assert.equal(removed.length, 2);
  assert.equal((await listBackups(bdir)).length, 2);
});

test('retention never deletes the only copy', async () => {
  const bdir = path.join(dir, 'Only Backups');
  const old = Date.now() - 400 * 86400000;
  await createBackup(bdir, 'Only', docJson('ancient'), new Date(old));
  await createBackup(bdir, 'Only', docJson('older'), new Date(old - 86400000));
  // Primary missing/invalid: nothing is deleted at all.
  assert.deepEqual(await pruneBackups(bdir, 30, false), []);
  // Primary valid: everything is expired, but the newest valid backup survives.
  const removed = await pruneBackups(bdir, 30, true);
  assert.equal(removed.length, 1);
  const left = await listBackups(bdir);
  assert.equal(left.length, 1);
  assert.match(await decode(await fs.readFile(left[0].file)), /ancient/);
});

test('damaged newest backup is not treated as the keeper', async () => {
  const bdir = path.join(dir, 'Dmg Backups');
  const old = Date.now() - 100 * 86400000;
  const good = await createBackup(bdir, 'Dmg', docJson('good'), new Date(old));
  const bad = await createBackup(bdir, 'Dmg', docJson('bad'), new Date(old + 3600000));
  await fs.writeFile(bad, 'corrupted');
  await pruneBackups(bdir, 30, true);
  const names = (await listBackups(bdir)).map((b) => b.file);
  assert.ok(names.includes(good), 'the newest *valid* backup is kept');
});

test('recovery snapshots: write, list, clear; temp files are cleaned', async () => {
  const rec = new Recovery(path.join(dir, 'recovery'));
  await rec.write('doc1', { path: null, name: 'Untitled', rev: 4 }, docJson('unsaved words'));
  await fs.writeFile(path.join(rec.dir, '.doc2.stet.123.deadbeef.tmp'), 'partial');
  const list = await rec.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'doc1');
  assert.match((await readDocument(list[0].file)).json, /unsaved words/);
  assert.deepEqual((await fs.readdir(rec.dir)).filter((n) => n.endsWith('.tmp')), []);
  await rec.clear('doc1');
  assert.equal((await rec.list()).length, 0);
  assert.equal(await cleanTemps(path.join(dir, 'nope')), 0);
});

test('killing a writer mid-save never leaves a corrupt document', { timeout: 60000 }, async () => {
  const writer = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'helpers', 'crash-writer.js');
  // Twelve writers side by side, each on its own file, each killed at a moment of its own.
  await Promise.all(Array.from({ length: 12 }, async (_, round) => {
    const f = path.join(dir, `crash${round}.stet`);
    await atomicWrite(f, await encode(docJson('seed')));
    const child = spawn(process.execPath, [writer, f], { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 120 + Math.random() * 300));
    child.kill('SIGKILL');
    await new Promise((r) => child.once('exit', r));
    check(await fs.readFile(f)); // throws if damaged
    assert.match(await decode(await fs.readFile(f)), /"format":"stet"/);
  }));
  await cleanTemps(dir);
});
