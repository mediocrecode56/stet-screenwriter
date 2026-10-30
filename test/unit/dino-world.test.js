// The dinosaur's world, simulated headlessly: rain, wind and the other events running their course,
// plants coming up and withering, visitors, growing with the writing streak, the theme's sunset and
// sunrise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _test } from '../../src/renderer/dino.js';
import { GROW_FULL, make, wide, run, inView, doing, until, walksNotSlides } from '../helpers/dino-sim.js';

const { FRAMES, W, H, REACTIONS, SPECIALS, EVENTS, postureOf } = _test;

// ---- the environment ----------------------------------------------------------------------------

test('a rain cloud: drifts in, rains on it, it reacts to fit what it was doing, the rain ends, the cloud fades away', () => {
  const cases = [
    ['sleep', (r) => r === 'rainSleep', 'sleeps through it'],
    ['rest', (r) => ['rainTolerate', 'rainEscape', 'rainDrink', 'rainUmbrella', 'rainJig'].includes(r), 'awake'],
    ['dance', (r) => r !== 'rainSleep', 'awake'],
    ['look', (r) => r === 'rainShelter', 'shelters under the palm', (c) => c.spawn('palm', { x: c.clampProp(c.center() + 60, 11), frame: 3, life: 1e9 })],
  ];
  const seen = new Set();
  for (let seed = 1; seed <= 6; seed++) {
    for (const [activity, fits, what, setup] of cases) {
      const c = doing(activity, seed * 10 + activity.length, setup);
      if (activity === 'sleep') until(c, () => c.asleep(), 10000, 'falls asleep');
      if (setup && seed > 1) continue;
      const before = c.activity;
      c.startEvent('rain', c.now);
      const cloud = c.find('cloud');
      assert.ok(cloud && cloud.alpha === 0 && cloud.phase === 'enter', 'the cloud fades in from the side');
      let rained = false, reaction = null, hit = false;
      until(c, () => !c.has(cloud) && !c.inReaction, 40000, 'the shower passes', () => {
        if (c.drops.length) rained = true;
        if (c.inReaction && REACTIONS[c.inReaction].cat === 'env' && !reaction) reaction = c.inReaction;
        if (c.drops.some((d) => d.x > c.x && d.x < c.x + c.dw && d.y < c.height() + 3)) hit = true;
        inView(c);
      });
      assert.ok(rained, 'it rained');
      if (!setup) assert.ok(hit || reaction === 'rainEscape', 'onto the dinosaur');
      assert.ok(reaction && fits(reaction), `${activity}: ${reaction} — ${what}`);
      seen.add(reaction);
      assert.equal(c.drops.length, 0);
      assert.ok(c.find('puddle'), 'leaves a puddle');
      assert.equal(c.event, null, 'the event is over');
      if (activity === 'sleep') assert.equal(c.activity, before, 'still asleep afterwards');
    }
  }
  assert.ok(seen.size >= 4, `several different reactions to rain: ${[...seen]}`);
});

test('a palm tree grows from the ground, it goes over and settles in, and the tree withers away in its time', () => {
  const c = doing('palmTree', 44);
  const tree = c.find('palm');
  assert.ok(tree, 'a tree');
  const frames = [tree.frame];
  const dist0 = Math.abs(c.trunk(tree) - c.center());
  let closest = dist0;
  until(c, () => tree.frame === 3, 8000, 'grows to full height', () => { frames.push(tree.frame); });
  for (let i = 1; i < frames.length; i++) assert.ok(frames[i] >= frames[i - 1], 'grows, never shrinks while growing');
  assert.deepEqual([...new Set(frames)], [...new Set(frames)].sort(), 'stage by stage');
  until(c, () => c.activity !== 'palmTree', 60000, 'the visit ends', () => { closest = Math.min(closest, Math.abs(c.trunk(tree) - c.center())); });
  assert.ok(closest < dist0 && closest < 30, `it went over to the tree (${dist0.toFixed(0)} → ${closest.toFixed(0)} px)`);
  // Later, the tree withers stage by stage and is gone.
  const left = tree.life - (c.now - tree.born);
  c.envNext = Infinity;
  const late = [];
  until(c, () => !c.has(tree), left + 5000, 'the tree goes', () => { if (c.has(tree)) late.push(tree.frame); inView(c); });
  assert.ok(late.includes(2) && late.includes(1) && late.includes(0), 'withers through every stage');
});

test('every environmental event runs its course from many situations, one at a time, never stuck', () => {
  const night = Date.parse('2026-10-21T23:30:00');
  const kinds = ['rain', 'wind', 'bird', 'tumbleweed', 'shootingStar', 'sprout'];
  const reacted = new Set();
  for (const kind of kinds) {
    for (const [activity, setup] of [['rest'], ['look'], ['walk'], ['sleep'], ['look', (c) => c.spawn('palm', { x: c.clampProp(c.center() - 70, 11), frame: 3, life: 1e9 })], ['look', (c) => c.wear('party', 60000)]]) for (let seed = 0; seed < 3; seed++) {
      const c = doing(activity, kind.length * 13 + activity.length + seed * 101, (d) => { d.clock = () => night; d.glimpseNext = Infinity; d.stirGap = Infinity; if (setup) setup(d); });
      c.startEvent(kind, c.now);
      assert.ok(c.event, `${kind} under way`);
      until(c, () => !c.event && !c.inReaction && !c.envDue, 60000, `${kind} from ${activity} ends`, () => {
        if (c.inReaction && REACTIONS[c.inReaction].cat === 'env') reacted.add(c.inReaction);
        inView(c);
        assert.ok(c.drops.length <= 160 && c.sparks.length <= 60 && c.streaks.length <= 60, 'effects bounded');
      });
      assert.ok(!c.props.some((p) => ['cloud', 'bird', 'tumbleweed'].includes(p.kind)), `${kind}: visitors gone`);
    }
  }
  // (Noticing a plant comes after the sprout event is over, and waking from a deep sleep belongs to the window's focus: both tested on their own.)
  const env = Object.keys(REACTIONS).filter((n) => REACTIONS[n].cat === 'env' && n !== 'plantNotice' && n !== 'deepWake');
  const missing = env.filter((n) => !reacted.has(n));
  assert.ok(missing.length <= 2, `environment reactions seen: ${[...reacted]}; not seen: ${missing}`);
});

// ---- growing with the writing streak ------------------------------------------------------------

test('each streak milestone makes it exactly one pixel taller, crisply, and it stays on its strip', () => {
  for (let g = 0; g <= 6; g++) {
    const c = wide(50 + g);
    c.setGrowth(g, false);
    assert.ok(Math.abs(H * c.du - (H * c.u + g)) < 1e-9, `+${g} px tall`);
    assert.ok(Math.abs(c.maxX - (c.stripW - W * (c.u + g / H))) < 1e-9, 'and its width grows in proportion');
  }
  const c = wide(60);
  c.envNext = Infinity;
  c.pending = 'look';
  run(c, 3000);
  c.setGrowth(1); // a milestone reached while writing
  assert.equal(c.g, 0, 'not instantly');
  let grewIn = null;
  run(c, 60000, { from: 3000, each: () => { if (grewIn == null && c.g === 1) grewIn = c.activity; } });
  assert.equal(grewIn, 'grow', 'with a proud stretch at its next natural moment');
  assert.equal(c.g, 1);
  c.setGrowth(0); // the streak ended
  run(c, 150000, { from: 63000 }); // at its next natural moment, which can be after a long stroll
  assert.equal(c.g, 0, 'back to its first size');
});

test('special loops unlock at every second milestone, appear naturally, and stay out otherwise', () => {
  const freq = (unlocked) => {
    const c = make(70);
    c.setUnlocked(unlocked);
    const n = {};
    for (let i = 0; i < 6000; i++) { c.recent = []; c.energy = c.rng(); const a = c.pickActivity(1e9); n[a] = (n[a] || 0) + 1; }
    return n;
  };
  const none = freq(0);
  for (const s of SPECIALS) assert.ok(!none[s], `${s} locked`);
  for (let k = 1; k <= 3; k++) {
    const n = freq(k);
    SPECIALS.forEach((s, i) => {
      if (i < k) assert.ok(n[s] > 0 && n[s] / 6000 < 0.03, `${s} unlocked at ${k}, now and then (${n[s]})`);
      else assert.ok(!n[s], `${s} still locked at ${k}`);
    });
  }
});

test('its part in the weather follows what it was doing when the weather came', () => {
  const c = wide(90);
  const base = { activity: 'look', posture: 'stand', moving: false, asleep: false, near: {}, hat: null, tree: null, mood: 'content' };
  const dist = (kind, k) => { const n = {}; for (let i = 0; i < 2000; i++) { const r = c.envReaction(kind, { ...base, ...k }); n[r] = (n[r] || 0) + 1; } return n; };
  assert.deepEqual(Object.keys(dist('rain', { asleep: true, posture: 'lie', activity: 'sleep' })), ['rainSleep'], 'asleep: sleeps through it');
  assert.deepEqual(Object.keys(dist('rain', { tree: {} })), ['rainShelter'], 'a palm nearby: under it');
  assert.ok(dist('rain', { activity: 'walk', moving: true }).rainEscape > 600, 'on the move: makes a run for it');
  assert.ok(dist('rain', { hat: 'leaf' }).rainUmbrella > 700, 'a leaf on its head: an umbrella');
  assert.ok(dist('rain', { activity: 'dance' }).rainJig > 500, 'dancing: dances on in the rain');
  assert.ok(dist('rain', { activity: 'rest', posture: 'sit' }).rainTolerate > 700, 'sitting: sits it out');
  assert.deepEqual(Object.keys(dist('tumbleweed', { posture: 'sit' })), ['tumbleWatch'], 'sitting: watches it roll by');
  assert.deepEqual(Object.keys(dist('wind', { asleep: true, posture: 'lie' })), ['windHunker']);
});

// ---- chin up, the sunset and sunrise, variety, visitors -----------------------------------------

test('it lies on its front, chin up, to look at the sky — and does so while resting, sleeping, stargazing and stretching', () => {
  for (const f of ['lieUp', 'lieUpBlink', 'lieUpHowl', 'lieUpTail']) assert.equal(postureOf(f), 'lie', f);
  const top = (f) => FRAMES[f].findIndex((r) => r.includes('#'));
  assert.ok(top('lieUp') <= top('lie') - 2, 'the head is raised above the lying body');
  const c = doing('daydream', 5);
  const { steps } = run(c, 30000, { from: c.now + 50, dt: 50 });
  assert.ok(steps.filter((s) => s.activity === 'daydream' && s.f.startsWith('lieUp')).length >= 4, 'daydreaming, chin up');
  const seen = new Set();
  for (let seed = 1; seed < 30 && seen.size < 4; seed++) {
    for (const a of ['rest', 'stargaze', 'sleep', 'stretch']) {
      const d = wide(seed * 7 + a.length);
      d.envNext = Infinity;
      d.pending = a;
      for (const s of run(d, 50000, { dt: 100 }).steps) if (s.activity === a && s.f.startsWith('lieUp')) seen.add(a);
    }
  }
  assert.deepEqual([...seen].sort(), ['rest', 'sleep', 'stargaze', 'stretch']);
});

test('the theme turning dark on its schedule: it watches the sun go down and the moon come up, then lies chin up under the stars', () => {
  for (let seed = 1; seed <= 4; seed++) {
    const c = doing('look', 20 + seed);
    c.themeShift(true);
    until(c, () => c.activity === 'nightfall', 3000, 'stops what it was doing to watch');
    let sunSet = false, moonUp = false, stars = 0, chinUp = false;
    until(c, () => c.activity !== 'nightfall', 60000, 'nightfall ends', () => {
      const sun = c.find('sun');
      if (sun && sun.y < 3) sunSet = true;
      if ((c.find('moon')?.y ?? 0) > 15) moonUp = true;
      stars = Math.max(stars, c.sparks.filter((q) => !q.vx && !q.vy).length);
      if (c.frame.startsWith('lieUp')) chinUp = true;
      inView(c);
    });
    assert.ok(sunSet && moonUp && stars > 0 && chinUp, JSON.stringify({ sunSet, moonUp, stars, chinUp }));
    assert.ok(!c.find('sun'), 'the sun has gone');
  }
});

test('the theme turning light: the sun comes up and wakes it, and it greets the day', () => {
  const c = doing('sleep', 31);
  until(c, () => c.asleep(), 10000, 'falls asleep');
  c.themeShift(true); // nightfall while it sleeps: it sleeps on, the moon comes up all the same
  assert.equal(c.activity, 'sleep');
  assert.ok(c.find('moon'));
  run(c, 3000, { from: c.now + 50, dt: 50 });
  assert.ok(c.asleep(), 'still asleep');
  c.themeShift(false);
  until(c, () => c.activity === 'daybreak', 3000, 'the light wakes it');
  let sunUp = false, roar = false;
  until(c, () => c.activity !== 'daybreak', 60000, 'daybreak ends', () => {
    if ((c.find('sun')?.y ?? 0) > 15) sunUp = true;
    if (c.step.f === 'roar') roar = true;
    inView(c);
  });
  assert.ok(sunUp, 'the sun rose');
  assert.ok(roar, 'a good-morning roar');
  assert.ok(!c.find('moon'), 'the moon has gone');
  // In the middle of something it shouldn't drop, it finishes that first.
  const e = doing('egg', 32);
  e.themeShift(true);
  assert.equal(e.activity, 'egg');
  until(e, () => e.activity === 'nightfall', 60000, 'then watches the sunset');
});

test('the everyday activities come out a little different each time', () => {
  for (const a of ['rest', 'look', 'walk', 'sleep', 'dance', 'stretch']) {
    const shapes = new Set();
    for (let seed = 0; seed < 30; seed++) {
      const c = wide(seed * 31 + a.length);
      c.envNext = Infinity;
      c.pending = a;
      const own = [];
      for (const s of run(c, 60000, { dt: 100 }).steps) { if (s.activity !== a || s.reaction) { if (own.length) break; continue; } own.push(s); }
      shapes.add([...new Set(own.map((s) => s.f + (s.fx ? '+' + s.fx : '')))].sort().join());
    }
    assert.ok(shapes.size >= 4, `${a}: ${shapes.size} different shapes in 30 runs`);
  }
});

test('visitors and finds now and then: a balloon, a paper plane, a frog, a ladybird, a dandelion, a worm, an acorn, a cricket, a feather, a gem — each comes, plays its part and goes', () => {
  const kinds = { balloon: ['balloon'], paperPlane: ['plane'], frog: ['frog'], ladybug: ['ladybug'], dandelion: ['dandelion', 'seed'], worm: ['worm'], acorn: ['acorn'], cricket: ['cricket'], feather: ['feather'], gem: ['gem'] };
  for (const [a, props] of Object.entries(kinds)) {
    for (let seed = 0; seed < 6; seed++) {
      const c = wide(seed * 17 + a.length);
      c.envNext = Infinity;
      c.glimpseNext = Infinity; // (nothing small passing by meanwhile: only the visitor's own props)
      c.pending = a;
      const seen = new Set();
      const look = () => { for (const p of c.props) seen.add(p.kind); if (c.hat) seen.add(c.hat.kind); inView(c); };
      run(c, 1000, { dt: 50, each: look });
      until(c, () => c.activity !== a, 60000, `${a} ends`, look);
      assert.ok(props.every((k) => seen.has(k)), `${a}: ${[...seen]}`);
      run(c, 70000, { from: c.now + 50, each: () => { c.pending = c.pending || 'look'; inView(c); } });
      assert.ok(!c.props.some((p) => props.includes(p.kind)), `${a}: gone afterwards (${c.props.map((p) => p.kind)})`);
    }
  }
  const c = make(5);
  const n = {};
  for (let i = 0; i < 12000; i++) { c.recent = []; c.lastEnv = {}; c.energy = c.rng(); const a = c.pickActivity(1e9); n[a] = (n[a] || 0) + 1; }
  for (const k of Object.keys(kinds)) assert.ok(n[k] > 0 && n[k] / 12000 < 0.02, `${k} turns up now and then (${n[k]})`);
  let w = null; // each find has its own odds, the gem the rarest
  c.pick = ((pick) => (o) => { if ('gem' in o) w = { ...o }; return pick(o); })(c.pick.bind(c));
  c.recent = []; c.lastEnv = {}; c.mood = 'content'; c.pickActivity(1e9);
  assert.ok(w.acorn > w.cricket && w.cricket > w.feather && w.feather > w.gem && w.gem > 0, `odds: ${['acorn', 'cricket', 'feather', 'gem'].map((k) => w[k])}`);
});

// ---- plants that come and go ----------------------------------------------------------------------

test('plants come up on their own: one at a time, it notices in its own time, sometimes goes to see, and they wither away', () => {
  const kinds = new Set();
  let visits = 0, plants = 0;
  for (let seed = 0; seed < 16; seed++) {
    const c = doing('look', 70 + seed, (d) => { d.widthOf = () => 1270; d.homeOf = () => ({ lo: 450, hi: 1010 }); d.x = 700; });
    c.startEvent('sprout', c.now);
    const p = c.props.find((q) => q.wild);
    if (!p) continue;
    plants++; kinds.add(p.kind);
    assert.equal(p.frame, 0, 'starts as a sprout');
    assert.ok(p.x >= 0 && p.x + c.propW(p) <= c.stripW, 'on the playground');
    assert.ok(Math.abs(c.propCenter(p) - c.center()) > c.dw / 2, 'not under its feet');
    assert.equal(EVENTS.sprout.ok(c), false, 'no second plant while this one is up');
    const born = c.now;
    let noticedAt = null, visitedAt = null, closest = Infinity, maxFrame = 0;
    until(c, () => !c.has(p), p.life + 10000, 'the plant withers away', () => {
      if (c.inReaction === 'plantNotice' && noticedAt == null) noticedAt = c.now;
      if (c.activity === 'visitPlant' && visitedAt == null) visitedAt = c.now;
      if (c.has(p)) { maxFrame = Math.max(maxFrame, p.frame); if (c.activity === 'visitPlant') closest = Math.min(closest, c.gap(p)); }
      walksNotSlides(c);
      inView(c);
    });
    assert.equal(maxFrame, GROW_FULL[p.kind], `${p.kind} grew to full size`);
    assert.ok(noticedAt != null && noticedAt - born >= 3000, `noticed, but not at once (${noticedAt && noticedAt - born} ms)`);
    if (visitedAt != null) { visits++; assert.ok(visitedAt > noticedAt, 'visited after noticing'); assert.ok(closest < 8, `went right up to it (${closest.toFixed(1)} px)`); }
  }
  assert.ok(plants >= 12, `${plants} plants came up`);
  assert.deepEqual([...kinds].sort(), ['cactus', 'grass', 'palm'], 'cacti, grass and palms');
  assert.ok(visits >= 3 && visits < plants, `it went to see ${visits} of ${plants} — some, not all`);
  // What it does there depends on the plant.
  for (const [kind, frames] of [['cactus', ['cower', 'sitUp', 'hunch']], ['grass', ['chomp', 'lieUp', 'wag']]]) {
    const seen = new Set();
    for (let seed = 0; seed < 12; seed++) {
      const c = doing('look', 90 + seed);
      const p = c.spawn(kind, { x: c.clampProp(c.center() + 60, 7), grows: true, wild: true, life: 120000, noticed: c.now, visitAt: c.now, noticeAt: c.now });
      c.pending = 'visitPlant'; c.gen = null;
      let chomped = false;
      until(c, () => c.recent.includes('visitPlant') && c.activity !== 'visitPlant', 60000, `${kind} visit`, () => { if (c.activity === 'visitPlant') { seen.add(c.frame); if (c.frame === 'chomp') chomped = true; } walksNotSlides(c); });
      assert.equal(p.visited, true);
      if (chomped) assert.equal(p.cut, 1, 'a bite out of the grass');
    }
    assert.ok(frames.filter((f) => seen.has(f)).length >= 2, `${kind}: different visits (${frames.filter((f) => seen.has(f))})`);
  }
});
