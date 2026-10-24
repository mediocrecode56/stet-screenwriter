import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timelineOf, anchorsOf, timeScale, scriptPos, placeAt, formatTime, parseTime, rulerLabel, rulerStep, minorStep, snapTo, fineTime, onSeconds, makeTimecode, cleanTag, placeLabels, clearOf, SEC_PER_PAGE, isSceneTimecode, sceneTimecodes } from '../../src/core/timeline.js';
import { paginate } from '../../src/core/layout.js';
import { newDocument, makeBlock } from '../../src/core/model.js';
import { serialize, deserialize } from '../../src/core/serialize.js';

// A script of `scenes` scenes, each a heading and `actions` lines of action.
function script(scenes = 10, actions = 12) {
  const blocks = [];
  for (let s = 0; s < scenes; s++) {
    blocks.push(makeBlock('scene', `INT. ROOM ${s} - DAY`));
    for (let a = 0; a < actions; a++) blocks.push(makeBlock('action', `Line ${a} of scene ${s}.`));
  }
  const doc = newDocument();
  doc.blocks = blocks;
  return { doc, blocks, pages: paginate(blocks, doc.settings) };
}

test('positions run through the script in pages, and a position leads back to its line', () => {
  const { blocks, pages } = script();
  assert.ok(pages.length > 2);
  assert.equal(scriptPos(pages, 0), 0);
  let prev = -1;
  for (let bi = 0; bi < blocks.length; bi++) {
    const x = scriptPos(pages, bi);
    assert.ok(x > prev, `block ${bi} comes after the one before`);
    assert.ok(x < pages.length);
    assert.deepEqual(placeAt(pages, x), { bi, line: 0 });
    prev = x;
  }
  const p2 = pages[2];
  assert.equal(Math.floor(scriptPos(pages, p2.items[0].bi, p2.items[0].l0)), 2);
});

test('the timeline shows each scene, highlights (one across blocks) and notes', () => {
  const { blocks, pages } = script(3, 4);
  blocks[1] = { ...blocks[1], marks: [{ s: 5, e: blocks[1].text.length, k: 'hl', v: 'yellow' }] };
  blocks[2] = { ...blocks[2], marks: [{ s: 0, e: 4, k: 'hl', v: 'yellow' }, { s: 0, e: 4, k: 'cm', v: 'n1' }] };
  blocks[7] = { ...blocks[7], marks: [{ s: 0, e: 3, k: 'hl', v: 'pink' }] };
  const p = paginate(blocks, newDocument().settings);
  const tl = timelineOf(blocks, p);
  assert.equal(tl.scenes.length, 3);
  assert.deepEqual(tl.scenes.map((s) => s.b), [0, 5, 10]);
  assert.equal(tl.highlights.length, 2);
  assert.equal(tl.highlights[0].color, 'yellow');
  assert.ok(tl.highlights[0].x1 > scriptPos(p, 2), 'the yellow runs on into the next block');
  assert.equal(tl.highlights[1].color, 'pink');
  assert.deepEqual(tl.notes.map((n) => [n.id, n.b]), [['n1', 2]]);
});

test('scenes, notes and highlights sit on whole seconds, the nearest one, never between two', () => {
  const time = timeScale([{ x: 2, t: 100 }]); // 50 s a page up to the timecode, then the same pace
  const tl = { scenes: [{ x: 0.51, b: 3 }], notes: [{ x: 1.009, id: 'n' }], highlights: [{ x0: 0.3, x1: 0.304, color: 'pink' }, { x0: 2.95, x1: 3.2, color: 'blue' }] };
  const on = onSeconds(tl, time, 3);
  const whole = (x) => Math.abs(time.at(x) - Math.round(time.at(x))) < 1e-9;
  for (const x of [on.scenes[0].x, on.notes[0].x, ...on.highlights.flatMap((h) => [h.x0, h.x1])]) assert.ok(whole(x) || x === 3, `${x} on a second`);
  assert.equal(time.at(on.scenes[0].x), 26); // 25.5 s: the nearer second up
  assert.equal(time.at(on.notes[0].x), 50); // 50.45 s: the nearer one down
  assert.equal(on.scenes[0].b, 3, 'what it is stays');
  assert.equal(on.scenes[0].at, 0.51, 'and where it really is');
  assert.ok(on.highlights[0].x1 > on.highlights[0].x0, 'a highlight within one second still spans one');
  assert.ok(on.highlights[1].x1 <= 3, 'nothing past the end of the script');
});

test('the ruler counts a minute a page until a timecode is pinned', () => {
  const t = timeScale([]);
  assert.equal(t.at(0), 0);
  assert.equal(t.at(10), 10 * SEC_PER_PAGE);
  assert.equal(t.pos(90), 1.5);
});

test('timecodes spread time evenly between them and set the pace after the last', () => {
  const t = timeScale([{ x: 10, t: 300 }, { x: 20, t: 900 }]);
  assert.equal(t.at(5), 150);      // 30 s a page up to page 10
  assert.equal(t.at(15), 600);     // 60 s a page from 10 to 20
  assert.equal(t.at(30), 900 + 10 * 45); // after it, the pace so far: 900 s over 20 pages
  for (const x of [0, 3, 12, 25]) assert.ok(Math.abs(t.pos(t.at(x)) - x) < 1e-9);
});

test('timecodes stay pinned to their line, and one out of order is left out', () => {
  const { blocks, pages } = script();
  const a = blocks[13], b = blocks[52], c = blocks[80];
  const anchors = anchorsOf([{ id: c.id, line: 0, t: 100 }, { id: a.id, line: 0, t: 200 }, { id: b.id, line: 0, t: 600 }, { id: 'gone', line: 0, t: 5 }], blocks, pages);
  // a (200 s) and b (600 s) are in order; c is later in the script but earlier in time.
  assert.deepEqual(anchors.map((x) => x.id), [a.id, b.id]);
  assert.equal(anchors[0].x, scriptPos(pages, 13));
});

test('times are written and read as HH:MM:SS', () => {
  assert.equal(formatTime(0), '00:00:00');
  assert.equal(formatTime(3725), '01:02:05');
  assert.equal(parseTime('01:02:05'), 3725);
  assert.equal(parseTime(' 12:30 '), 750);
  assert.equal(parseTime('1:00:00'), 3600);
  assert.equal(parseTime('00:61:00'), null);
  assert.equal(parseTime('abc'), null);
  assert.equal(parseTime(''), null);
  assert.equal(rulerLabel(90), '1:30');
  assert.equal(rulerLabel(3700), '1:01:40');
});

test('the ruler steps out as the bar zooms out', () => {
  assert.equal(rulerStep(100), 1);
  assert.equal(rulerStep(1), 60);
  assert.ok(rulerStep(0.05) >= 600);
  assert.equal(minorStep(300, 0.24), 60);  // 5:00 labels, a tick a minute
  assert.equal(minorStep(60, 1), 10);
  assert.equal(minorStep(1, 100), 0);      // nothing finer than a second
});

test('timecodes are saved with the script and come back on their lines', () => {
  const { doc, blocks } = script(3, 4);
  doc.timecodes = [{ id: blocks[6].id, line: 0, t: 125 }, { id: 'deleted', line: 0, t: 9 }];
  const back = deserialize(serialize(doc, 'test')).doc;
  assert.deepEqual(back.timecodes, [{ id: back.blocks[6].id, line: 0, t: 125 }]);
  // None pinned: nothing is written.
  doc.timecodes = [];
  assert.ok(!serialize(doc, 'test').includes('timecodes'));
  assert.deepEqual(deserialize(serialize(doc, 'test')).doc.timecodes, []);
});

test('a timecode keeps its tag and colour, saved with the script, and drops ones that are not', () => {
  const { doc, blocks } = script(3, 4);
  assert.equal(cleanTag('  Act   two\n starts '), 'Act two starts');
  assert.equal(cleanTag('x'.repeat(60)).length, 40);
  assert.deepEqual(makeTimecode('a', 0, 5, '  ', 'green'), { id: 'a', line: 0, t: 5 }, 'no tag, no colour that is not a highlight one');
  doc.timecodes = [makeTimecode(blocks[3].id, 1, 70, 'Act two', 'pink'), makeTimecode(blocks[6].id, 0, 125)];
  const json = serialize(doc, 'test');
  const back = deserialize(json).doc;
  assert.deepEqual(back.timecodes, [{ id: back.blocks[3].id, line: 1, t: 70, tag: 'Act two', color: 'pink' }, { id: back.blocks[6].id, line: 0, t: 125 }]);
  const anchors = anchorsOf(back.timecodes, back.blocks, paginate(back.blocks));
  assert.equal(anchors[0].tag, 'Act two');
  assert.equal(anchors[0].color, 'pink');
  assert.equal(anchors[1].tag, '');
  // From a file: a colour that isn't one is left out, a tag is tidied.
  const raw = JSON.parse(json);
  raw.timecodes[0].c = 'red'; raw.timecodes[0].n = ' Act\ttwo ';
  const again = deserialize(JSON.stringify(raw)).doc;
  assert.deepEqual(again.timecodes[0], { id: again.blocks[3].id, line: 1, t: 70, tag: 'Act two' });
});

test('the pointer is drawn to the nearest mark within reach, and to none further off', () => {
  const marks = [{ x: 1, kind: 'scene' }, { x: 1.04, kind: 'note' }, { x: 3, kind: 'hl' }];
  assert.equal(snapTo(marks, 1.03, 0.05).kind, 'note');
  assert.equal(snapTo(marks, 0.99, 0.05).kind, 'scene');
  assert.equal(snapTo(marks, 2, 0.05), null);
  assert.equal(snapTo([], 1, 1), null);
});

test('fineTime: a second every so many pixels from where Ctrl was pressed, never past either end', () => {
  assert.equal(fineTime(30, 0, 8, 600), 30);
  assert.equal(fineTime(30, 80, 8, 600), 40);
  assert.equal(fineTime(30, 83, 8, 600), 40);
  assert.equal(fineTime(30, -85, 8, 600), 19);
  assert.equal(fineTime(30, -1000, 8, 600), 0);
  assert.equal(fineTime(595, 1000, 8, 600.7), 600);
  assert.equal(fineTime(30, 100, 50, 600), 32); // zoomed in, a second is wider
});

test('timecode labels too close together: the newest keeps its label, the older ones just their line', () => {
  const placed = [[900, 940]]; // the end of the script
  const labels = [{ x0: 100, x1: 160, rank: 0 }, { x0: 150, x1: 190, rank: 2 }, { x0: 195, x1: 240, rank: 1 }, { x0: 400, x1: 460, rank: 3 }, { x0: 880, x1: 920, rank: 4 }];
  assert.deepEqual(placeLabels(labels, placed), [false, true, false, true, false]);
  assert.deepEqual(placed.slice(1), [[400, 460], [150, 190]]);
  assert.equal(clearOf(placed, 300, 330), true); // a regular label between them
  assert.equal(clearOf(placed, 185, 215), false);
  assert.equal(clearOf(placed, 195, 230, 0), true);
});

test("a scene's own timecode: on the first line of its heading, shown by block id, and only while it holds", () => {
  const { blocks, pages } = script(4, 12);
  const s1 = blocks[13], s2 = blocks[26];
  assert.equal(s1.type, 'scene');
  assert.equal(isSceneTimecode({ id: s1.id, line: 0 }, blocks), true);
  assert.equal(isSceneTimecode({ id: blocks[14].id, line: 0 }, blocks), false, 'an action line is not a scene');
  const tcs = [makeTimecode(s1.id, 0, 90, 'Hook'), makeTimecode(blocks[20].id, 0, 120), makeTimecode(s2.id, 0, 100)];
  const m = sceneTimecodes(tcs, blocks, pages);
  assert.deepEqual([...m.keys()], [s1.id], 'the loose one is no scene\'s; the one out of order does not hold');
  assert.equal(m.get(s1.id).t, 90);
  assert.equal(m.get(s1.id).tag, 'Hook');
  // It sets the ruler like any other timecode.
  const time = timeScale(anchorsOf(tcs, blocks, pages));
  assert.equal(Math.round(time.at(scriptPos(pages, 13))), 90);
});
