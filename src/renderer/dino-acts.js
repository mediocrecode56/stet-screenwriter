// The writing companion's repertoire: what it does on its own (activities),
// how it answers a click (reactions, chosen by what it was doing at that
// moment), and how it takes part in what happens around it (environment
// reactions: rain, wind, a visiting bird…).
//
// Every activity and reaction is a generator of short steps (≤ 1.5 s):
//   { f: frame, t: ms, dx?: px moved, jump?: arc height, lift?: [y0, y1] height,
//     face?: ±1, fx?: glyph, flip?: upside down, hatUp?: raise the hat,
//     do?: (critter) => void, run at the start of the step }
// The engine (dino.js) plays them one at a time, slots reactions in between
// steps, and bridges postures so nothing ever jumps. `d` is the Critter.

import { postureOf } from './dino-art.js';

export const ACTIVITIES = {
  // -- idle, rest and personality --
  *rest(d) {
    yield* d.getTo('sit');
    const n = d.rint(6, 14);
    // Each rest has its own little habit: tapping its tail, gazing about, a scratch.
    const habit = d.pick({ none: 2, tap: 1, gaze: 1, scratch: 0.6 });
    for (let i = 0; i < n; i++) {
      yield { f: 'sit', t: d.rnd(450, 700) };
      yield { f: 'sitBreath', t: d.rnd(450, 650) };
      if (d.chance(0.25)) yield { f: 'sitBlink', t: 140 };
      if (d.chance(0.12)) yield { f: 'sit', t: 400, face: -d.face };
      if (!d.chance(0.2)) continue;
      if (habit === 'tap') for (let k = 0; k < 4; k++) yield { f: k % 2 ? 'sitTap2' : 'sitTap1', t: 160 };
      else if (habit === 'gaze') yield { f: 'sitUp', t: d.rnd(700, 1200), fx: d.chance(0.3) ? d.pick({ note: 1, heart: 1, '?': 1 }) : null };
      else if (habit === 'scratch') for (let k = 0; k < 4; k++) yield { f: k % 2 ? 'sitScratch1' : 'sitScratch2', t: 120 };
    }
    if (d.chance(0.25)) {
      // …and stretches out on the ground, chin up.
      yield* d.getTo('lie');
      for (let i = 0, m = d.rint(2, 4); i < m; i++) { yield { f: 'lieUp', t: d.rnd(900, 1300) }; yield { f: d.chance(0.3) ? 'lieUpBlink' : 'lieUp', t: 300 }; }
      yield { f: 'lie', t: 500 };
    }
  },
  *sleep(d) {
    yield* d.getTo('sit');
    yield { f: 'sitBlink', t: 500 };
    if (d.chance(0.3)) { yield { f: 'sitChew', t: 700 }; yield { f: 'sitBlink', t: 300 }; } // a big yawn first
    yield { f: 'lie', t: 500 };
    const n = d.rint(12, 30);
    const turn = d.chance(0.4) ? d.rint(3, n - 3) : -1, back = d.chance(0.25) ? d.rint(2, n - 4) : -1;
    for (let i = 0; i < n; i++) {
      if (i === turn) { yield { f: 'lieBreath', t: 400 }; yield { f: 'fallen', t: 500 }; yield { f: 'lie', t: 500, face: -d.face }; } // turns over
      if (i === back) for (let k = 0; k < 3; k++) yield { f: 'fallen', t: 900, fx: k === 1 ? 'z' : null }; // a while on its back, feet in the air
      const dream = d.chance(0.06) ? d.pick({ note: 1, heart: 1, '?': 0.6 }) : null;
      yield { f: 'lie', t: 600, fx: dream || (i % 3 === 0 ? 'z' : null) };
      yield { f: 'lieBreath', t: 600 };
    }
    yield { f: 'lie', t: 400 };
    if (d.chance(0.5)) { yield { f: 'lieUpBlink', t: 500 }; yield { f: 'lieUp', t: 800 }; yield { f: 'lieUpBlink', t: 200 }; } // a look at the sky before getting up
    yield { f: 'sitBlink', t: 300 };
    yield { f: 'sit', t: 400 };
  },
  *look(d) {
    yield* d.getTo('stand');
    const n = d.rint(2, 4);
    for (let i = 0; i < n; i++) {
      yield { f: 'stand', t: d.rnd(500, 900) };
      if (d.chance(0.4)) yield { f: 'blink', t: 130 };
      const what = d.pick({ turn: 3, ground: 1, sky: 1, wag: 0.6, peer: 0.7 });
      if (what === 'ground') { yield { f: 'sniff', t: d.rnd(500, 800) }; yield { f: 'sniffBlink', t: 200 }; yield { f: 'stand', t: 300 }; }
      else if (what === 'sky') yield { f: 'up', t: d.rnd(700, 1100), fx: d.chance(0.3) ? '?' : null };
      else if (what === 'wag') for (let k = 0; k < 4; k++) yield { f: k % 2 ? 'wag' : 'stand', t: 170 };
      else if (what === 'peer') { yield { f: 'hunch', t: 700, fx: d.chance(0.3) ? 'dots' : null }; yield { f: 'stand', t: 300 }; } // squints into the distance
      else yield { f: d.chance(0.3) ? 'up' : 'stand', t: d.rnd(400, 700), face: -d.face };
    }
    yield { f: 'stand', t: 400 };
  },
  *walk(d) {
    // Somewhere worth walking to: a fair way off, usually in the middle stretch.
    let target = d.spot();
    for (let i = 0; i < 4 && Math.abs(target - d.x) < (d.zone(1) - d.zone(0)) / 4; i++) target = d.spot();
    const pace = d.rnd(0.75, 1.3);
    if (d.chance(0.3)) {
      // Halfway there, something smells interesting.
      yield* d.walkTo((d.x + target) / 2, pace);
      yield { f: 'sniff', t: 600 };
      yield { f: 'sniffBlink', t: 300, do: d.chance(0.4) ? (c) => c.dirt(1) : undefined };
      yield { f: 'stand', t: 250 };
    }
    yield* d.walkTo(target, pace, { pauses: true });
    const end = d.pick({ stand: 3, up: 1, wag: 1, back: 1 });
    if (end === 'up') yield { f: 'up', t: 700, fx: d.chance(0.3) ? 'note' : null };
    else if (end === 'wag') for (let k = 0; k < 4; k++) yield { f: k % 2 ? 'wag' : 'stand', t: 170 };
    else if (end === 'back') yield { f: 'stand', t: 600, face: -d.face }; // a look back at where it came from
    yield { f: 'stand', t: 300 };
  },
  *stretch(d) {
    if (d.chance(0.25)) {
      // A long stretch out on the ground, front first, with a yawn at the sky.
      yield* d.getTo('lie');
      yield { f: 'lieUp', t: 600 };
      yield { f: 'lieUpHowl', t: 800 };
      yield { f: 'lieUpBlink', t: 300 };
      yield* d.getTo('stand');
      yield { f: 'stretch', t: 800 };
      yield { f: 'stand', t: 300 };
      return;
    }
    yield* d.getTo('stand');
    yield { f: 'crouch', t: 300 };
    yield { f: 'stretch', t: 900 };
    yield { f: 'armsUp', t: 500 };
    if (d.chance(0.3)) yield { f: 'oneLeg', t: 700, fx: d.chance(0.4) ? 'dots' : null }; // and a wobbly balance to finish
    yield { f: 'stand', t: 200 };
    if (d.chance(0.5)) { yield { f: 'yawn', t: 700 }; yield { f: 'blink', t: 200 }; }
    yield { f: 'stand', t: 300 };
  },
  *wag(d) {
    // Pleased with life: the tail goes.
    yield* d.getTo('stand');
    yield { f: 'stand', t: 300, face: d.inward() || d.face };
    const n = d.rint(6, 12);
    for (let i = 0; i < n; i++) yield { f: i % 2 ? 'wag' : 'stand', t: d.rnd(150, 200), fx: i === 3 ? 'heart' : null };
    yield { f: 'blink', t: 150 };
    yield { f: 'stand', t: 400 };
  },
  *scratch(d) {
    yield* d.getTo('sit');
    yield { f: 'sit', t: 400 };
    const n = d.rint(6, 12);
    for (let i = 0; i < n; i++) yield { f: i % 2 ? 'sitScratch1' : 'sitScratch2', t: 120, do: i % 4 === 0 ? (c) => c.dirt(1) : undefined };
    yield { f: 'sitBlink', t: 400, fx: d.chance(0.5) ? 'heart' : null };
    yield { f: 'sit', t: 500 };
  },
  *doze(d) {
    // Nodding off sitting up, then jerking awake — did anyone see?
    yield* d.getTo('sit');
    const n = d.rint(3, 5);
    for (let i = 0; i < n; i++) {
      yield { f: 'sit', t: d.rnd(500, 900) };
      yield { f: 'sitBlink', t: d.rnd(600, 1100), fx: i === n - 1 ? 'z' : null };
    }
    yield { f: 'sitBlink', t: 1200 };
    yield { f: 'sitUp', t: 300, fx: '!' };
    yield { f: 'sit', t: 300, face: -d.face };
    yield { f: 'sit', t: 300, face: -d.face };
    yield { f: 'sitBlink', t: 200, fx: 'dots' };
    yield { f: 'sit', t: 500 };
  },
  *ponder(d) {
    // Paces, thinking, until the idea arrives.
    yield* d.getTo('stand');
    const home = d.x, span = d.rnd(18, 30), n = d.rint(2, 3);
    for (let i = 0; i < n; i++) {
      yield* d.walkTo(d.clampX(home + span), 0.7);
      yield { f: 'up', t: 500, fx: i === 0 ? '?' : null };
      yield* d.walkTo(d.clampX(home - span), 0.7);
      yield { f: 'stand', t: 400 };
    }
    yield { f: 'up', t: 300, fx: '!' };
    yield { f: 'crouch', t: 100 };
    yield { f: 'jump', t: 340, jump: 5 };
    yield { f: 'armsUp', t: 400 };
    yield { f: 'stand', t: 300 };
  },
  *sunbathe(d) {
    yield* d.getTo('lie');
    yield { f: 'lie', t: 800 };
    yield { f: 'fallen', t: 400 }; // rolls onto its back
    const n = d.rint(4, 8);
    for (let i = 0; i < n; i++) yield { f: 'fallen', t: d.rnd(700, 1100), fx: i === 1 ? 'heart' : null };
    yield { f: 'lie', t: 500, face: -d.face }; // and back, the other way round
    yield { f: 'lieBreath', t: 600 };
    yield { f: 'lie', t: 400 };
  },
  *watchWriter(d) {
    // Sits in the middle and watches the page fill up.
    yield* d.walkTo(d.zone(d.rnd(0.4, 0.6)), 1);
    yield* d.getTo('sit');
    const n = d.rint(5, 9);
    for (let i = 0; i < n; i++) {
      yield { f: 'sitUp', t: d.rnd(900, 1400), face: d.chance(0.3) ? -d.face : d.face };
      if (d.heat > 3 && d.chance(0.4)) yield { f: 'sitUp', t: 400, fx: d.pick({ '!': 1, heart: 1, note: 0.6 }) };
      else yield { f: 'sitBlink', t: 160 };
    }
    yield { f: 'sit', t: 500 };
  },
  *readScript(d) {
    // Reads a page of its own, then gives its verdict.
    yield* d.getTo('sit');
    let pg;
    yield { f: 'sit', t: 300, do: (c) => { pg = c.spawn('page', { carried: true }); c.puffAt(c.center()); } };
    const n = d.rint(4, 7);
    for (let i = 0; i < n; i++) {
      yield { f: 'sitUp', t: d.rnd(800, 1300) };
      yield { f: 'sit', t: 400, fx: i % 2 ? null : 'dots' };
      if (d.chance(0.35)) yield { f: 'sitBlink', t: 150, do: (c) => c.puffAt(c.nose()) }; // turns the page
    }
    const verdict = d.pick([['love', 2], ['hmm', 1.5], ['nod', 2]]);
    if (verdict === 'love') yield { f: 'sitUp', t: 700, fx: 'heart' };
    else if (verdict === 'hmm') yield { f: 'sitUp', t: 700, fx: '?' };
    else for (let i = 0; i < 2; i++) { yield { f: 'sit', t: 200 }; yield { f: 'sitUp', t: 200 }; }
    yield { f: 'sit', t: 300, do: (c) => { c.remove(pg); c.puffAt(c.center()); } };
    yield { f: 'sitBreath', t: 400 };
  },
  *coffeeBreak(d) {
    yield* d.getTo('sit');
    const mug = d.spawn('mug', { x: d.front(4, 0) });
    yield { f: 'sitBlink', t: 300, fx: 'puff', do: (c) => c.puffAt(mug.x) };
    const n = d.rint(3, 5);
    for (let i = 0; i < n; i++) {
      yield { f: 'sit', t: d.rnd(900, 1300), do: (c) => c.steam(mug) };
      yield { f: 'sitUp', t: 500, do: () => { mug.carried = true; } }; // a sip
      yield { f: 'sitBlink', t: 500, fx: i === 1 ? 'heart' : null, do: () => { mug.carried = false; } };
    }
    yield { f: 'sit', t: 300, do: (c) => { c.remove(mug); c.puffAt(mug.x); } };
    yield { f: 'sitBreath', t: 400 };
  },
  *writeAlong(d) {
    // Typing along on a tiny typewriter while you write.
    yield* d.getTo('stand');
    const room = d.face > 0 ? d.maxX - d.x : d.x;
    if (room < 10 * d.du) yield { f: 'stand', t: 200, face: -d.face };
    yield* d.getTo('sit');
    const tw = d.spawn('typewriter', { x: d.front(7, -3) });
    yield { f: 'sitBlink', t: 200, fx: 'puff' };
    const n = d.rint(14, 34);
    for (let i = 0; i < n; i++) {
      yield { f: i % 2 ? 'sitTap1' : 'sitTap2', t: d.rnd(90, 170) };
      if (i % 9 === 8) yield { f: 'sitUp', t: 260, fx: d.chance(0.5) ? '!' : 'note' };
      if (d.chance(0.06)) yield { f: 'sitBlink', t: 300 };
    }
    yield { f: 'sit', t: 300, do: (c) => { c.remove(tw); c.puffAt(tw.x); } };
    yield { f: 'sitBreath', t: 400 };
  },
  *stargaze(d) {
    const lying = d.chance(0.4);
    yield* d.getTo(lying ? 'lie' : 'sit');
    const n = d.rint(6, 12);
    for (let i = 0; i < n; i++) {
      yield { f: lying ? 'lieUp' : 'sitUp', t: d.rnd(700, 1200), fx: d.chance(0.3) ? 'star' : null };
      if (d.chance(0.2)) yield { f: lying ? 'lieUpBlink' : 'sitBlink', t: 150 };
    }
    yield { f: lying ? 'lie' : 'sit', t: 500 };
  },
  *howl(d) {
    // At night, a song for the moon.
    yield* d.getTo('sit');
    yield { f: 'sitUp', t: 800 };
    const n = d.rint(2, 3);
    for (let i = 0; i < n; i++) { yield { f: 'sitHowl', t: 900, fx: 'note' }; yield { f: 'sitUp', t: 600 }; }
    yield { f: 'sitBlink', t: 300 };
    yield { f: 'sit', t: 500, fx: d.chance(0.4) ? 'heart' : null };
  },
  *sing(d) {
    yield* d.getTo(d.chance(0.5) ? 'sit' : 'stand');
    const sitting = d.sitting();
    const n = d.rint(5, 9);
    for (let i = 0; i < n; i++) yield { f: sitting ? (i % 2 ? 'sitHowl' : 'sitUp') : (i % 2 ? 'howl' : 'up'), t: d.rnd(300, 500), fx: i % 2 ? 'note' : null };
    yield { f: sitting ? 'sitBlink' : 'blink', t: 400 };
    if (sitting) yield { f: 'sit', t: 400 };
    else { yield { f: 'sniff', t: 500 }; yield { f: 'stand', t: 300 }; } // a bow
  },
  *yoga(d) {
    yield* d.getTo('stand');
    for (const [f, t] of [['stretch', 1200], ['oneLeg', 1300], ['crouch', 900], ['armsUp', 1200], ['sniff', 1000]]) {
      yield { f, t: t * d.rnd(0.9, 1.1), fx: f === 'oneLeg' && d.chance(0.3) ? 'dots' : null };
    }
    yield { f: 'stand', t: 400 };
    yield { f: 'blink', t: 400, fx: 'heart' };
    yield { f: 'stand', t: 300 };
  },
  *workout(d) {
    yield* d.getTo('stand');
    const n = d.rint(4, 7);
    for (let i = 0; i < n; i++) { yield { f: 'crouch', t: 300 }; yield { f: 'armsUp', t: 300 }; }
    yield { f: 'oneLeg', t: 700 };
    yield { f: 'oneLeg', t: 600, face: -d.face };
    yield { f: 'stand', t: 400, fx: 'drop' };
    yield { f: 'yawn', t: 500 };
    yield { f: 'stand', t: 300 };
  },
  *shakeOff(d) {
    // A good shake, like a wet dog.
    yield* d.getTo('stand');
    yield { f: 'crouch', t: 200 };
    for (let i = 0; i < 8; i++) yield { f: i % 2 ? 'hunch' : 'stand', t: 90, jump: 1, dx: i % 2 ? 1 : -1, do: i % 2 ? (c) => c.splashAt(c.center(), 2) : undefined };
    yield { f: 'stand', t: 300, fx: 'star' };
    yield { f: 'blink', t: 200 };
    yield { f: 'stand', t: 400 };
  },

  *daydream(d) {
    // Lies on its front, chin up, watching the sky go by — and now and then something in it.
    yield* d.getTo('lie');
    yield { f: 'lie', t: 500 };
    yield { f: 'lieUp', t: 900 };
    let b = null;
    if (d.props.length < 3 && d.floating() < 2 && d.chance(0.35)) { const left = d.chance(0.5); b = d.spawn('butterfly', d.arrive({ y: 14, vx: left ? 14 : -14, life: 14000 }, 3, left ? -1 : 1)); }
    const n = d.rint(5, 10);
    for (let i = 0; i < n; i++) {
      const r = d.rng();
      if (r < 0.2) yield { f: 'lieUpBlink', t: 160 };
      else if (r < 0.35) for (let k = 0; k < 3; k++) yield { f: k % 2 ? 'lieUp' : 'lieUpTail', t: 220 }; // the tail sways
      else if (r < 0.45) yield { f: 'lieUp', t: 700, face: -d.face };
      else if (r < 0.55) yield { f: 'lieUp', t: 900, fx: d.pick({ heart: 1, note: 1, '?': 0.7, star: d.night() ? 1.5 : 0.3 }) };
      yield { f: 'lieUp', t: d.rnd(800, 1400), face: b && d.has(b) ? d.dirTo(b) : undefined };
    }
    if (d.chance(0.35)) { yield { f: 'lieUpHowl', t: 700 }; yield { f: 'lieUpBlink', t: 300, fx: 'dots' }; } // a yawn
    yield { f: 'lie', t: 600 };
  },

  // -- on the move --
  *hop(d) {
    yield* d.getTo('stand');
    const n = d.rint(2, 4);
    const dir = d.inward() || (d.chance(0.5) ? 1 : -1);
    const big = d.chance(0.3);
    yield { f: 'stand', t: 120, face: dir };
    for (let i = 0; i < n; i++) {
      const last = big && i === n - 1; // saving the best for last
      yield { f: 'crouch', t: last ? 220 : 110 };
      yield { f: 'jump', t: last ? 480 : 360, jump: (4 + 3 * d.energy) * (last ? 1.8 : 1), dx: 6 * dir, fx: last ? 'star' : null };
    }
    if (d.chance(0.25)) { yield { f: 'crouch', t: 110 }; yield { f: 'jump', t: 360, jump: 4, face: -dir }; } // and one turning back
    yield { f: 'crouch', t: 120 };
    yield { f: 'stand', t: 300 };
  },
  *zoomies(d) {
    // A sudden burst: there and back at full tilt, skidding at each end, then a sit and a pant.
    yield* d.getTo('stand');
    yield { f: 'crouch', t: 250, fx: '!' };
    const a = d.zone(d.rnd(0.2, 0.32)), b = d.zone(d.rnd(0.68, 0.8));
    const first = d.x < d.zone(0.5) ? b : a;
    yield* d.walkTo(first, 3);
    yield { f: 'crouch', t: 120, do: (c) => c.dirt(3) };
    yield* d.walkTo(first === a ? b : a, 3);
    yield { f: 'crouch', t: 120, do: (c) => c.dirt(3) };
    if (d.chance(0.5)) yield* d.walkTo(d.zone(0.5), 3);
    yield* d.getTo('sit');
    for (let i = 0; i < 4; i++) yield { f: i % 2 ? 'sitChew' : 'sit', t: 220 };
    yield { f: 'sitBlink', t: 300, fx: 'heart' };
  },
  *patrol(d) {
    // A longer stroll: to one end, a look around, to the other end, a proud pause.
    // The ends of the play area are an occasional excursion, not a habit.
    yield* d.walkTo(d.zone(d.x < d.zone(0.5) ? 0.06 : 0.94), 1);
    yield { f: 'up', t: 700 };
    yield { f: 'stand', t: 500, face: -d.face };
    yield* d.walkTo(d.zone(d.face > 0 ? 0.94 : 0.06), 1, { pauses: true });
    yield { f: 'up', t: 600 };
    yield { f: 'armsUp', t: 500, fx: 'star' };
    yield { f: 'stand', t: 400 };
  },
  *explore(d) {
    // Curiosity: a long stroll out past its home stretch, a good look around out there, and home again.
    const lo = d.zone(0), hi = d.zone(1);
    const left = lo > d.maxX - hi ? d.chance(0.7) : d.chance(0.3);
    const target = left ? d.rnd(0.1, 0.8) * Math.max(0, lo - 30) : hi + 30 + d.rnd(0.2, 0.9) * Math.max(0, d.maxX - hi - 30);
    yield* d.getTo('stand');
    yield { f: 'up', t: 500, face: left ? -1 : 1, fx: '?' };
    yield* d.walkTo(target, d.rnd(0.9, 1.2), { max: 600, pauses: true });
    yield { f: 'stand', t: 500 };
    const what = d.pick({ look: 2, sniff: 1.5, sit: 1, dig: 0.6 });
    if (what === 'look') { yield { f: 'up', t: 900 }; yield { f: 'stand', t: 500, face: -d.face }; yield { f: 'up', t: 700, fx: d.chance(0.4) ? '!' : null }; }
    else if (what === 'sniff') { yield { f: 'sniff', t: 700, fx: '?' }; yield { f: 'creep1', t: 260, dx: 1.5 * d.face }; yield { f: 'creep2', t: 260, dx: 1.5 * d.face }; yield { f: 'sniffBlink', t: 300 }; }
    else if (what === 'sit') { yield* d.getTo('sit'); for (let i = 0; i < 3; i++) { yield { f: 'sitUp', t: 900 }; yield { f: 'sit', t: 600, face: -d.face }; } yield* d.getTo('stand'); }
    else for (let i = 0; i < 4; i++) yield { f: 'sniff', t: 160, do: (c) => c.dirt(2) };
    yield { f: 'stand', t: 400, fx: d.chance(0.3) ? 'heart' : null };
    yield* d.walkTo(d.spot(), d.rnd(1, 1.3), { max: 600 });
    yield { f: 'stand', t: 400 };
  },
  *cornerBite(d) {
    // Very rarely: all the way to the bottom-left corner of the window, for a bite at the border.
    yield* d.getTo('stand');
    yield { f: 'up', t: 600, face: -1, fx: '!' };
    yield* d.walkTo(0, 1.4, { max: 800, pauses: true });
    yield { f: 'stand', t: 500, face: -1 };
    yield { f: 'sniff', t: 700, fx: '?' };
    yield { f: 'sniffBlink', t: 250 };
    yield { f: 'crouch', t: 250 };
    for (let i = 0, n = d.rint(3, 5); i < n; i++) {
      yield { f: 'gnaw', t: 180 };
      yield { f: 'gnawShut', t: 160, do: (c) => c.puffAt(c.x - c.u, 0) };
    }
    yield { f: 'crouch', t: 300 };
    const end = d.pick({ proud: 1, ouch: 1, puzzled: 1 });
    if (end === 'proud') yield { f: 'armsUp', t: 700, fx: 'star' };
    else if (end === 'ouch') { yield { f: 'roar', t: 400, fx: 'hash' }; yield { f: 'stand', t: 500, fx: 'dots' }; }
    else { yield { f: 'up', t: 800, fx: '?' }; yield { f: 'stand', t: 400, face: 1 }; yield { f: 'stand', t: 400, face: -1 }; }
    yield { f: 'stand', t: 400, face: 1 };
    yield* d.walkTo(d.spot(), 1.2, { max: 800, pauses: true });
    yield { f: 'stand', t: 400 };
  },
  *pounce(d) {
    // Stalks something in the grass, pounces — and finds nothing there.
    yield* d.getTo('stand');
    const dir = d.inward() || d.face;
    yield { f: 'sniff', t: 500, face: dir, fx: '?' };
    yield { f: 'crouch', t: 400 };
    for (let i = 0; i < 4; i++) yield { f: 'crouch', t: 110, dx: i % 2 ? 1 : -1 };
    yield { f: 'jump', t: 420, jump: 7, dx: 22 * dir };
    yield { f: 'sniff', t: 400, do: (c) => c.dirt(2) };
    yield { f: 'sniffBlink', t: 300 };
    yield { f: 'up', t: 500, fx: d.chance(0.6) ? '?' : 'star' };
    yield { f: 'stand', t: 300 };
  },
  *roll(d) {
    yield* d.getTo('lie');
    const dir = d.inward() || (d.chance(0.5) ? 1 : -1);
    yield { f: 'lie', t: 300, face: dir };
    const n = d.rint(2, 4);
    for (let i = 0; i < n; i++) { yield { f: 'fallen', t: 260, dx: 5 * dir }; yield { f: 'lie', t: 260, dx: 5 * dir }; }
    yield { f: 'lie', t: 600, fx: 'star' };
    yield { f: 'lieBreath', t: 500 };
  },
  *somersault(d) {
    yield* d.getTo('stand');
    const dir = d.inward() || d.face;
    yield { f: 'stand', t: 200, face: dir };
    const n = d.rint(1, 3);
    for (let i = 0; i < n; i++) {
      yield { f: 'crouch', t: 150 };
      yield { f: 'jump', t: 180, lift: [0, 4], dx: 5 * dir };
      yield { f: 'crouch', t: 180, lift: [4, 4], dx: 5 * dir, flip: true };
      yield { f: 'jump', t: 180, lift: [4, 0], dx: 5 * dir };
    }
    yield { f: 'crouch', t: 200 };
    yield { f: 'armsUp', t: 500, fx: d.chance(0.5) ? 'star' : 'note' };
    yield { f: 'stand', t: 300 };
  },
  *headstand(d) {
    yield* d.getTo('stand');
    yield { f: 'crouch', t: 300 };
    yield { f: 'sniff', t: 300 };
    yield { f: 'stand', t: 400, flip: true };
    const n = d.rint(3, 6);
    for (let i = 0; i < n; i++) yield { f: i % 2 ? 'armsUp' : 'stand', t: d.rnd(300, 500), flip: true, dx: d.chance(0.5) ? (d.chance(0.5) ? 1 : -1) : 0 };
    if (d.chance(0.5)) { yield { f: 'fallen', t: 900, fx: 'star' }; yield { f: 'sit', t: 300 }; }
    else { yield { f: 'crouch', t: 200 }; yield { f: 'armsUp', t: 500, fx: 'star' }; }
    yield { f: 'stand', t: 300 };
  },
  *dance(d) {
    yield* d.getTo('stand');
    const n = d.rint(6, 10);
    const move = d.pick({ shuffle: 2, bounce: 1, kick: 1, twirl: 1 }); // today's favourite move
    for (let i = 0; i < n; i++) {
      yield { f: i % 2 ? 'walk1' : 'walk2', t: 220, fx: i % 4 === 0 ? 'note' : null };
      if (i % 3 !== 2) continue;
      if (move === 'bounce') { yield { f: 'crouch', t: 110 }; yield { f: 'jump', t: 300, jump: 3 }; }
      else if (move === 'kick') { yield { f: 'kick', t: 200 }; yield { f: 'oneLeg', t: 220, face: -d.face }; }
      else if (move === 'twirl') for (let k = 0; k < 3; k++) yield { f: k % 2 ? 'up' : 'armsUp', t: 140, face: -d.face };
      else yield { f: 'armsUp', t: 220, face: -d.face };
    }
    yield { f: 'stand', t: 300 };
  },
  *trip(d) {
    yield* d.getTo('stand');
    const dir = d.x > d.zone(0.5) ? -1 : 1;
    yield { f: 'stand', t: 100, face: dir };
    for (let i = 0; i < 4; i++) yield { f: i % 2 ? 'walk2' : 'walk1', t: 170, dx: 3 * dir };
    yield { f: 'walk1', t: 120, dx: 2 * dir };
    yield { f: 'fallen', t: 900, fx: 'star' };
    yield { f: 'fallen', t: 700 };
    yield { f: 'sit', t: 400 };
    yield { f: 'stand', t: 300 };
    yield { f: 'stand', t: 500, face: -d.face, fx: 'dots' }; // nobody saw that
    yield { f: 'blink', t: 150 };
    yield { f: 'stand', t: 500, face: -d.face };
  },
  *moonwalk(d) {
    yield* d.getTo('stand');
    const dir = d.x > d.zone(0.5) ? -1 : 1;
    yield { f: 'stand', t: 200, face: -dir };
    for (let i = 0; i < 10 && d.x + 3 * dir >= 0 && d.x + 3 * dir <= d.maxX; i++) yield { f: i % 2 ? 'walk2' : 'walk1', t: 200, dx: 3 * dir };
    yield { f: 'armsUp', t: 400, fx: 'star' };
    yield { f: 'stand', t: 300 };
  },
  *chaseTail(d) {
    yield* d.getTo('stand');
    for (let i = 0; i < 8; i++) yield { f: i % 2 ? 'walk1' : 'walk2', t: 130, face: -d.face };
    yield { f: 'stand', t: 400, fx: 'star' };
    yield { f: 'blink', t: 200 };
    yield { f: 'stand', t: 400, fx: 'star' };
  },
  *sneeze(d) {
    yield* d.getTo('stand');
    yield { f: 'up', t: 300 };
    yield { f: 'yawn', t: 300 };
    yield { f: 'yawn', t: 300 };
    yield { f: 'crouch', t: 160, jump: 2, dx: -2 * d.face, fx: 'puff' };
    yield { f: 'stand', t: 300 };
    yield { f: 'blink', t: 150 };
    yield { f: 'stand', t: 400 };
  },
  *roar(d) {
    yield* d.getTo('stand');
    yield { f: 'up', t: 300 };
    yield { f: 'roar', t: 700, fx: '!' };
    yield { f: 'stand', t: 300 };
    yield { f: 'blink', t: 150 };
  },

  // -- with props --
  *fetch(d) {
    yield* d.getTo('stand');
    const fromLeft = d.x > d.zone(0.5);
    const ball = d.spawn('ball', d.arrive({ vx: (fromLeft ? 1 : -1) * d.rnd(40, 70) }, 4, fromLeft ? -1 : 1));
    ball.x = d.clampProp(ball.x, 4);
    yield { f: 'stand', t: 500 };
    yield { f: 'up', t: 400, face: d.dirTo(ball), fx: '!' };
    const kicks = d.rint(2, 5);
    for (let i = 0; i < kicks && d.has(ball); i++) {
      yield* d.walkTo(() => d.reach(ball), 1.5, { max: 60 });
      if (!d.has(ball) || Math.abs(d.reach(ball) - d.x) > 4) break;
      yield { f: 'stand', t: 160, face: d.dirTo(ball) };
      yield { f: 'kick', t: 220, do: (c) => c.kick(ball, c.face, 0.8 + 0.6 * c.energy) };
      yield { f: 'stand', t: 250 };
      if (d.chance(0.3)) yield { f: 'armsUp', t: 300, fx: d.chance(0.5) ? 'note' : 'star' };
      yield* d.watch(ball, 2500);
    }
    if (d.has(ball)) d.expire(ball, 25000);
    yield { f: 'stand', t: 400 };
  },
  *dig(d) {
    if (d.chance(0.6)) yield* d.walkTo(d.x + d.rnd(-50, 50), 1); // a spot nearby smells interesting
    yield* d.getTo('stand');
    yield { f: 'sniff', t: 500, fx: '?' };
    yield { f: 'sniffBlink', t: 200 };
    const n = d.rint(6, 11);
    for (let i = 0; i < n; i++) yield { f: i % 2 ? 'sniff' : 'crouch', t: 150, do: (c) => c.dirt(3) };
    const found = d.chance(0.8) ? 'bone' : 'pebble';
    let prop;
    yield { f: 'sniff', t: 300, do: (c) => { prop = c.spawn(found, { carried: true }); } };
    yield { f: 'up', t: 600, fx: found === 'bone' ? '!' : '?' };
    if (found === 'pebble') {
      yield { f: 'stand', t: 400, do: (c) => c.drop(prop, -c.face * 20) };
      yield { f: 'blink', t: 150, fx: 'dots' };
      d.expire(prop, 15000);
      return;
    }
    if (d.chance(0.6)) yield* d.walkTo(d.spot(), 1);
    yield* d.getTo('sit');
    const chews = d.rint(8, 16);
    for (let i = 0; i < chews; i++) yield { f: i % 2 ? 'sitChew' : 'sit', t: d.rnd(160, 260), fx: i === 3 && d.chance(0.4) ? 'heart' : null };
    yield { f: 'sitBlink', t: 200 };
    yield* d.getTo('stand');
    if (d.chance(0.5)) {
      // Bury it for later.
      yield { f: 'sniff', t: 300, do: (c) => { c.drop(prop, 0); } };
      for (let i = 0; i < 6; i++) yield { f: i % 2 ? 'sniff' : 'crouch', t: 150, do: (c) => { c.dirt(2); if (i === 5) c.remove(prop); } };
      yield { f: 'stand', t: 400, fx: 'star' };
    } else {
      yield { f: 'stand', t: 300, do: (c) => c.drop(prop, c.face * 6) };
      d.expire(prop, 40000);
      yield { f: 'blink', t: 200 };
    }
  },
  *leaf(d) {
    yield* d.getTo('stand');
    const leaf = d.spawn('leaf', { x: d.clampProp(d.x + d.face * d.rnd(8, 40)), y: 25, fall: true });
    while (d.has(leaf) && leaf.y > 12) yield { f: 'up', t: 300, face: d.dirTo(leaf) };
    const plan = d.pick([['catch', 3], ['head', 2], ['watch', 2]]);
    if (plan === 'catch') {
      yield* d.walkTo(() => d.centreOn(leaf), 2, { max: 10 });
      yield { f: 'crouch', t: 100 };
      yield { f: 'jump', t: 380, jump: 6, do: (c) => { c.remove(leaf); c.wear('leaf', 20000); } };
      yield { f: 'stand', t: 300 };
      yield { f: 'armsUp', t: 500, fx: 'star' };
      yield { f: 'stand', t: 600 };
    } else if (plan === 'head') {
      yield* d.walkTo(() => d.centreOn(leaf), 1.5, { max: 10 });
      yield* d.watch(leaf, 3000, 'up');
      yield { f: 'up', t: 300, do: (c) => { c.remove(leaf); c.wear('leaf', 3000); } };
      yield { f: 'yawn', t: 300 };
      yield { f: 'crouch', t: 160, fx: 'puff', do: (c) => { c.unwear(); c.spawn('leaf', { x: c.clampProp(c.center() + c.face * 5 * c.du), y: 10, fall: true, life: 12000 }); } };
      yield { f: 'stand', t: 500, fx: 'dots' };
    } else {
      yield* d.watch(leaf, 4000, 'up');
      yield* d.walkTo(() => d.reach(leaf), 1, { max: 30 });
      yield { f: 'sniff', t: 600, fx: '?' };
      yield { f: 'sniffBlink', t: 200 };
      yield { f: 'stand', t: 400 };
      d.expire(leaf, 15000);
    }
  },
  *butterfly(d) {
    yield* d.getTo('stand');
    const left = d.chance(0.5);
    const b = d.spawn('butterfly', d.arrive({ y: 12, vx: left ? 14 : -14, life: 16000 }, 3, left ? -1 : 1));
    for (let i = 0; i < 6 && d.has(b); i++) yield { f: d.chance(0.5) ? 'up' : 'stand', t: 400, face: d.dirTo(b) };
    const tries = d.rint(1, 3);
    for (let i = 0; i < tries && d.has(b); i++) {
      yield* d.walkTo(() => d.centreOn(b), 2, { max: 12 });
      yield { f: 'crouch', t: 100 };
      yield { f: 'jump', t: 360, jump: 7, do: (c) => { b.vy = 18; b.vx = (c.chance(0.5) ? 1 : -1) * 20; } };
      yield { f: 'stand', t: 300, fx: i === tries - 1 ? 'dots' : null };
    }
    if (d.has(b) && d.chance(0.35)) {
      // It lands on the dinosaur's nose. Hold still…
      yield { f: 'stand', t: 300, do: (c) => { c.remove(b); c.wear('butterfly', 4000); } };
      yield { f: 'blink', t: 800, fx: 'heart' };
      yield { f: 'stand', t: 1200 };
      yield { f: 'stand', t: 900, do: (c) => { c.unwear(); c.spawn('butterfly', { x: c.center() + 5 * c.du, y: 14, vx: 16 * c.face, vy: 10, life: 4000 }); } };
    }
    yield { f: 'stand', t: 400 };
  },
  *inspect(d) {
    const p = d.restingProp();
    if (!p) return yield* ACTIVITIES.look(d);
    yield* d.walkTo(() => d.reach(p), 1, { max: 80 });
    if (!d.has(p)) return;
    yield { f: 'sniff', t: 600, fx: '?' };
    yield { f: 'sniffBlink', t: 200 };
    const round = p.kind === 'ball' || p.kind === 'coconut';
    const what = d.pick([['nudge', 2], ['carry', round ? 0 : 2], ['kick', round ? 3 : 0], ['leave', 1]]);
    if (what === 'nudge') { yield { f: 'sniff', t: 250, do: (c) => { p.vx = c.face * 18; } }; yield { f: 'stand', t: 500, fx: 'dots' }; }
    else if (what === 'kick') { yield { f: 'kick', t: 220, do: (c) => c.kick(p, c.face, 1) }; yield* d.watch(p, 2000); }
    else if (what === 'carry') {
      yield { f: 'sniff', t: 200, do: (c) => c.pickUp(p) };
      yield { f: 'up', t: 400 };
      yield* d.walkTo(d.spot(), 1);
      yield { f: 'sniff', t: 300, do: (c) => c.drop(p, 0) };
      yield { f: 'stand', t: 400, fx: 'star' };
    }
    d.expire(p, 20000);
    yield { f: 'stand', t: 300 };
  },
  *juggle(d) {
    yield* d.getTo('stand');
    const ball = d.spawn('ball', { balance: true });
    yield { f: 'up', t: 300, fx: '!' };
    const n = d.rint(6, 14);
    for (let i = 0; i < n; i++) yield { f: 'up', t: 260, ...(d.chance(0.5) ? { dx: d.rnd(-1.5, 1.5), jump: 1 } : {}) }; // little hops under the ball
    if (d.chance(0.35)) {
      yield { f: 'up', t: 200, do: () => { ball.balance = false; ball.y = 6; ball.vy = -5; ball.vx = 0; } };
      yield { f: 'crouch', t: 200 };
      yield { f: 'fallen', t: 900, fx: 'star' };
      yield { f: 'sit', t: 300 };
      yield { f: 'stand', t: 300 };
    } else {
      yield { f: 'kick', t: 220, do: (c) => { ball.balance = false; ball.y = 10; c.kick(ball, c.face, 0.7); } };
      yield { f: 'armsUp', t: 500, fx: 'star' };
    }
    if (d.has(ball)) d.expire(ball, 20000);
    yield { f: 'stand', t: 300 };
  },
  *pebbleToss(d) {
    // Tosses a pebble and catches it on its snout… until it doesn't.
    yield* d.getTo('stand');
    yield { f: 'sniff', t: 400, fx: '?' };
    let p;
    yield { f: 'sniff', t: 250, do: (c) => { p = c.spawn('pebble', { carried: true }); } };
    yield { f: 'up', t: 400 };
    const n = d.rint(3, 5), miss = d.chance(0.45);
    for (let i = 0; i < n; i++) {
      const last = i === n - 1;
      yield { f: 'up', t: 150, do: (c) => c.toss(p) };
      yield { f: 'up', t: 330 };
      if (last && miss) break;
      yield { f: 'crouch', t: 160, do: (c) => c.pickUp(p) };
      yield { f: 'up', t: 200 };
    }
    if (miss) {
      yield { f: 'crouch', t: 200, fx: 'star' }; // bonk
      yield { f: 'blink', t: 300 };
      yield { f: 'stand', t: 400, fx: 'dots' };
    } else {
      yield { f: 'armsUp', t: 400, fx: 'star' };
      yield { f: 'stand', t: 200, do: (c) => c.drop(p, c.face * 10) };
    }
    if (d.has(p)) d.expire(p, 12000);
    yield { f: 'stand', t: 300 };
  },
  *sandcastle(d) {
    // Builds a little mound of earth, admires it — and then…
    if (d.chance(0.5)) yield* d.walkTo(d.spot(), 1);
    yield* d.getTo('stand');
    const x = d.front(6, -1);
    let m;
    yield { f: 'sniff', t: 400, do: (c) => { m = c.spawn('mound', { x, frame: 0 }); } };
    for (let i = 0; i < 9; i++) yield { f: i % 2 ? 'sniff' : 'crouch', t: 170, do: (c) => { c.dirt(1); if (i === 3 || i === 7) m.frame = Math.min(2, m.frame + 1); } };
    yield { f: 'stand', t: 400 };
    yield { f: 'up', t: 700, fx: 'star' };
    const end = d.pick([['stomp', 2], ['collapse', 1.5], ['keep', 1.5]]);
    if (end === 'stomp') {
      yield { f: 'crouch', t: 150 };
      yield { f: 'jump', t: 380, jump: 6, dx: 4 * d.face };
      yield { f: 'crouch', t: 200, do: (c) => { c.remove(m); c.puffAt(m.x); c.dirt(4); } };
      yield { f: 'armsUp', t: 500, fx: 'note' };
    } else if (end === 'collapse') {
      yield { f: 'stand', t: 600, do: (c) => { m.frame = 0; c.puffAt(m.x); } };
      yield { f: 'blink', t: 300 };
      yield { f: 'stand', t: 700, fx: 'dots' };
      d.expire(m, 6000);
    } else {
      yield { f: 'sniffBlink', t: 400 };
      d.expire(m, 30000);
      yield { f: 'stand', t: 300, fx: 'heart' };
    }
    yield { f: 'stand', t: 300 };
  },
  *bubbles(d) {
    yield* d.getTo('stand');
    yield { f: 'up', t: 400 };
    const mine = [];
    const n = d.rint(2, 3);
    for (let i = 0; i < n; i++) {
      yield { f: 'yawn', t: 350 };
      yield { f: 'up', t: 300, do: (c) => mine.push(c.blowBubble()) };
    }
    const b = mine.find((x) => d.has(x));
    if (b) {
      yield { f: 'up', t: 300, face: d.dirTo(b) };
      yield { f: 'crouch', t: 100 };
      yield { f: 'jump', t: 360, jump: 6, do: (c) => { if (c.has(b)) { c.remove(b); c.puffAt(b.x, b.y); } } };
    }
    yield { f: 'stand', t: 400, fx: d.chance(0.5) ? 'star' : 'note' };
    yield { f: 'up', t: 600 };
    yield { f: 'stand', t: 300 };
  },

  // -- its environment: things that grow and visit, and what it does with them --
  *palmTree(d) {
    // A palm tree grows from the ground; it watches, goes over, inspects it, and settles in.
    yield* d.getTo('stand');
    const side = d.inward() || (d.chance(0.5) ? 1 : -1);
    const tree = d.spawn('palm', { x: d.clampProp(d.center() + side * d.rnd(50, 90) - 6.5 * d.u, 13), grows: true, life: d.rnd(100000, 160000) });
    d.envMark('palm');
    yield { f: 'stand', t: 600, do: (c) => c.puffAt(tree.x + 4 * c.u) };
    yield { f: 'up', t: 700, face: d.dirTo(tree), fx: '!' };
    yield { f: 'blink', t: 150 };
    for (let i = 0; i < 12 && d.has(tree) && tree.frame < 3; i++) yield { f: 'up', t: 500 };
    yield* d.walkTo(() => d.reach(tree, 6), 1, { max: 50 });
    yield { f: 'sniff', t: 600, fx: '?', face: d.dirTo(tree) };
    yield { f: 'sniffBlink', t: 200 };
    yield { f: 'up', t: 700, fx: 'heart' };
    const plan = d.pick([['shade', 3], ['nap', 1.5], ['admire', 2]]);
    if (plan === 'admire') { yield { f: 'armsUp', t: 500, fx: 'star' }; yield { f: 'stand', t: 400 }; return; }
    yield* d.walkTo(() => d.under(tree), 1, { max: 30 });
    yield* d.getTo(plan === 'nap' ? 'lie' : 'sit');
    const n = d.rint(4, 8);
    for (let i = 0; i < n && d.has(tree); i++) {
      if (plan === 'nap') { yield { f: 'lie', t: 700, fx: i % 2 ? 'z' : null }; yield { f: 'lieBreath', t: 700 }; }
      else { yield { f: 'sit', t: d.rnd(600, 900) }; yield { f: 'sitBreath', t: 600 }; if (d.chance(0.3)) yield { f: 'sitUp', t: 600 }; }
    }
    yield* d.getTo('sit');
    yield { f: 'sitBlink', t: 300 };
  },
  *treeShade(d) {
    const tree = d.grownTree();
    if (!tree) return yield* ACTIVITIES.rest(d);
    yield* d.walkTo(() => d.under(tree), 1, { max: 80 });
    if (d.chance(0.3)) {
      // Stretched out in the shade, looking up into the fronds.
      yield* d.getTo('lie');
      for (let i = 0, n = d.rint(4, 7); i < n && d.has(tree); i++) { yield { f: 'lieUp', t: d.rnd(800, 1200), fx: i === 1 ? 'heart' : null }; yield { f: d.chance(0.3) ? 'lieUpBlink' : 'lieUpTail', t: 300 }; }
      yield { f: 'lie', t: 400 };
      return;
    }
    yield* d.getTo('sit');
    yield { f: 'sit', t: 300, face: d.awayFrom(tree) };
    const n = d.rint(5, 10);
    for (let i = 0; i < n && d.has(tree); i++) {
      yield { f: 'sit', t: d.rnd(600, 900) };
      yield { f: 'sitBreath', t: d.rnd(500, 700) };
      if (d.chance(0.25)) yield { f: 'sitUp', t: 600, fx: d.chance(0.5) ? 'heart' : null }; // up into the fronds
      if (d.chance(0.15)) yield { f: 'sitBlink', t: 800, fx: 'z' };
    }
    yield { f: 'sitBlink', t: 300 };
  },
  *shakeTree(d) {
    // Bumps the palm to see what falls out: a coconut (on its head, sometimes), a frond, or a startled bird.
    const tree = d.grownTree();
    if (!tree) return yield* ACTIVITIES.look(d);
    yield* d.walkTo(() => d.reach(tree, 6), 1, { max: 80 });
    yield { f: 'up', t: 600, face: d.dirTo(tree), fx: '?' };
    for (let i = 0; i < 3; i++) { yield { f: 'crouch', t: 120 }; yield { f: 'jump', t: 320, jump: 4, do: () => { tree.wobble = 450; } }; }
    const what = d.pick([['coconut', 3], ['leaf', 1.5], ['bird', 0.7]]);
    if (what === 'coconut') {
      const bonk = d.chance(0.5);
      let nut;
      yield { f: 'up', t: 320, do: (c) => { nut = c.spawn('coconut', { x: bonk ? c.headX() - 2 * c.u : c.trunk(tree) + c.face * 3 * c.u, y: 22, gravity: true }); } };
      if (bonk) {
        yield { f: 'crouch', t: 250, fx: 'star', do: (c) => { nut.y = c.height(); nut.vy = 25; nut.vx = -c.face * 35; } };
        yield { f: 'sitBlink', t: 400 };
        yield { f: 'sit', t: 500, fx: 'dots' };
        yield* d.getTo('stand');
      } else yield { f: 'up', t: 500, fx: '!' };
      yield { f: 'stand', t: 300, face: d.dirTo(nut) };
      yield* d.walkTo(() => d.reach(nut), 1, { max: 40 });
      yield { f: 'kick', t: 220, do: (c) => c.kick(nut, c.face, 0.8) };
      yield* d.watch(nut, 2000);
      d.expire(nut, 25000);
    } else if (what === 'leaf') {
      yield { f: 'up', t: 400, do: (c) => c.spawn('leaf', { x: c.trunk(tree) - 2 * c.u, y: 15, fall: true, life: 14000 }) };
      yield* d.watch(d.find('leaf'), 3000, 'up');
      yield { f: 'stand', t: 400, fx: 'dots' };
    } else {
      yield { f: 'up', t: 300, do: (c) => c.spawn('bird', { x: c.trunk(tree) - 2 * c.u, y: 19, vx: 30 * c.face, vy: 14, fly: true, life: 3500, frame: 1 }) };
      yield { f: 'cower', t: 500, fx: '!' };
      yield { f: 'up', t: 600, fx: '?' };
    }
    yield { f: 'stand', t: 300 };
  },
  *visitPlant(d) {
    // Goes over to see the plant that came up: sniffs it, and then… depends what it is.
    const p = d.plantToVisit();
    if (!p) return yield* ACTIVITIES.look(d);
    p.visited = true;
    yield* d.getTo('stand');
    yield { f: 'up', t: 500, face: d.dirTo(p), fx: d.chance(0.5) ? '?' : null };
    const careful = p.kind === 'cactus';
    yield* d.walkTo(() => (d.has(p) ? d.reach(p, careful ? -3 : 0) : null), d.gap(p) > 200 ? 1.8 : d.rnd(0.9, 1.3), { max: 600, pauses: d.gap(p) <= 200 }); // brisker when it's a long way
    if (!d.has(p)) return;
    yield* d.walkTo(() => (d.has(p) ? d.reach(p, careful ? -1 : 1) : null), 0.6, { max: 12, creep: true }); // the last bit, nose first
    if (!d.has(p)) return;
    yield { f: 'sniff', t: d.rnd(500, 800), face: d.dirTo(p) };
    yield { f: 'sniffBlink', t: 200 };
    if (p.kind === 'palm' && d.grownTree() === p) return yield* ACTIVITIES.treeShade(d);
    if (p.kind === 'palm') {
      for (let i = 0; i < 6 && d.has(p) && p.frame < 3; i++) yield { f: 'up', t: 500 }; // watches it grow
      yield { f: 'up', t: 600, fx: 'heart' };
    } else if (p.kind === 'cactus') {
      const plan = d.pick({ prick: 2, admire: 1.2, wary: 1 });
      if (plan === 'prick') {
        yield { f: 'creep1', t: 300, dx: 1.5 * d.face };
        yield { f: 'cower', t: 260, fx: '!' };
        yield { f: 'jump', t: 320, jump: 4, dx: -6 * d.face }; // ow!
        yield { f: 'stand', t: 500, fx: 'dots' };
        if (d.chance(0.4)) yield { f: 'roar', t: 400, fx: 'hash' };
      } else if (plan === 'admire') {
        yield* d.getTo('sit');
        for (let i = 0, n = d.rint(3, 5); i < n; i++) { yield { f: 'sit', t: d.rnd(600, 900) }; yield { f: 'sitUp', t: 600, fx: i === 1 ? 'heart' : null }; }
        yield* d.getTo('stand');
      } else { yield { f: 'hunch', t: 700, fx: '?' }; yield { f: 'stand', t: 300, face: -d.face }; }
    } else {
      const plan = d.pick({ nibble: 2, lieBy: 1.2, sniff: 0.8 });
      if (plan === 'nibble') {
        for (let i = 0; i < 3; i++) { yield { f: 'chomp', t: 220 }; yield { f: 'sniff', t: 220 }; }
        yield { f: 'sniff', t: 200, do: () => { p.cut = 1; } }; // a bite taken out of it
        yield* d.getTo('sit');
        for (let i = 0; i < 4; i++) yield { f: i % 2 ? 'sitChew' : 'sit', t: 260 };
        yield { f: 'sitBlink', t: 400, fx: 'heart' };
      } else if (plan === 'lieBy') {
        yield* d.getTo('lie');
        for (let i = 0, n = d.rint(3, 6); i < n; i++) { yield { f: 'lieUp', t: d.rnd(800, 1200) }; yield { f: d.chance(0.4) ? 'lieUpTail' : 'lieUpBlink', t: 300 }; }
        yield { f: 'lie', t: 500 };
      } else { yield { f: 'up', t: 600, fx: 'note' }; yield { f: 'wag', t: 200 }; yield { f: 'stand', t: 200 }; }
    }
    yield { f: d.sitting() ? 'sit' : postureOf(d.frame) === 'lie' ? 'lie' : 'stand', t: 400 };
    if (d.away() && d.chance(0.7)) yield* d.walkTo(d.spot(), 1, { max: 600 }); // and back home
  },
  *flower(d) {
    // A flower comes up and opens. A sniff — and then a sneeze, a snack, a long look, or a gift.
    yield* d.getTo('stand');
    const fl = d.spawn('flower', { x: d.front(7, 3), grows: true, life: 70000 });
    d.envMark('flower');
    yield { f: 'stand', t: 800 };
    yield { f: 'sniff', t: 500, fx: '!', face: d.dirTo(fl) };
    for (let i = 0; i < 10 && d.has(fl) && fl.frame < 3; i++) yield { f: 'sniffBlink', t: 400 };
    yield* d.walkTo(() => d.reach(fl), 0.8, { max: 30 });
    yield { f: 'sniff', t: 800, fx: 'heart' };
    const plan = d.pick([['sneeze', 2], ['eat', 1.5], ['admire', 2], ['pick', 1]]);
    if (plan === 'sneeze') {
      yield { f: 'up', t: 300 };
      yield { f: 'yawn', t: 300 };
      yield { f: 'crouch', t: 160, jump: 2, dx: -2 * d.face, fx: 'puff', do: (c) => { fl.grows = false; fl.frame = 4; c.puffAt(fl.x, 4); } };
      yield { f: 'stand', t: 600, fx: 'dots' };
      d.expire(fl, 15000);
    } else if (plan === 'eat') {
      for (let i = 0; i < 4; i++) yield { f: i % 2 ? 'sniff' : 'chomp', t: 220, do: i === 3 ? (c) => c.remove(fl) : undefined };
      yield { f: 'blink', t: 400, fx: 'heart' };
      yield { f: 'stand', t: 400 };
    } else if (plan === 'admire') {
      yield* d.getTo('sit');
      for (let i = 0; i < 4; i++) yield { f: i % 2 ? 'sitBreath' : 'sit', t: 800, fx: i === 1 ? 'heart' : null };
    } else {
      yield { f: 'chomp', t: 250, do: (c) => { fl.grows = false; fl.frame = 3; c.pickUp(fl); } };
      yield { f: 'up', t: 500 };
      yield* d.walkTo(d.spot(), 1);
      yield { f: 'armsUp', t: 600, fx: 'heart' };
      yield { f: 'sniff', t: 300, do: (c) => { c.drop(fl, 0); c.expire(fl, 20000); } };
    }
    yield { f: d.sitting() ? 'sit' : 'stand', t: 300 };
  },
  *mushroom(d) {
    // A mushroom pops up; it makes a fine trampoline.
    yield* d.getTo('stand');
    const m = d.spawn('mushroom', { x: d.clampProp(d.center() + (d.inward() || d.face) * d.rnd(30, 60) - 4.5 * d.u, 9), grows: true, life: 60000 });
    d.envMark('mushroom');
    yield { f: 'stand', t: 500, do: (c) => c.puffAt(m.x + 2 * c.u) };
    yield { f: 'up', t: 600, fx: '?', face: d.dirTo(m) };
    yield* d.walkTo(() => d.reach(m), 1, { max: 40 });
    yield { f: 'sniff', t: 600 };
    yield { f: 'sniffBlink', t: 200 };
    yield { f: 'crouch', t: 200 };
    yield { f: 'jump', t: 350, lift: [0, 7], jump: 3, dx: d.centreOn(m) - d.x, do: () => { m.grows = false; m.frame = 2; } };
    const n = d.rint(3, 5);
    for (let i = 0; i < n; i++) {
      yield { f: 'crouch', t: 150, lift: [7, 4], do: () => { m.frame = 3; } };
      yield { f: 'jump', t: 520, lift: [4, 7], jump: 9 + 2 * i, fx: i === n - 1 ? 'star' : null, do: () => { m.frame = 2; } };
    }
    const off = d.inward() || d.face;
    yield { f: 'jump', t: 400, lift: [7, 0], jump: 5, dx: 16 * off, face: off };
    yield { f: 'crouch', t: 150 };
    yield { f: 'armsUp', t: 500, fx: 'note', do: () => { m.grows = true; m.frame = 2; } };
    yield { f: 'stand', t: 300 };
    if (d.chance(0.5)) d.wither(m); else d.expire(m, 25000);
  },
  *snail(d) {
    // A snail crawls up. It lies down nose to nose to watch; a sniff sends the snail into its shell.
    yield* d.getTo('stand');
    const side = d.inward() || (d.chance(0.5) ? 1 : -1);
    const sn = d.spawn('snail', { x: d.clampProp(d.center() + side * d.rnd(60, 80), 7), alpha: 0, fadeIn: true, life: 60000 });
    d.envMark('snail');
    sn.face = -side;
    sn.tx = d.clampProp(d.center() + side * 22, 7);
    yield { f: 'stand', t: 900 };
    yield { f: 'sniff', t: 600, fx: '?', face: side };
    yield* d.getTo('lie');
    yield { f: 'lie', t: 400, face: side };
    for (let i = 0; i < 14 && d.has(sn) && Math.abs(sn.x - sn.tx) > 1; i++) yield { f: i % 2 ? 'lieBreath' : 'lie', t: 600, fx: i === 3 ? 'heart' : null };
    yield { f: 'lie', t: 500, fx: '!', do: () => { sn.hide = 3000; } }; // boop
    yield { f: 'lie', t: 1000, fx: '?' };
    yield { f: 'lieBreath', t: 900 };
    yield { f: 'lie', t: 800 };
    yield { f: 'lie', t: 900, fx: 'note', do: (c) => { sn.face = side; sn.tx = c.clampProp(sn.x + side * 30, 7); c.fadeOut(sn, 7000); } };
    yield { f: 'lieBreath', t: 900 };
    yield* d.getTo('sit');
    yield { f: 'sitUp', t: 700, fx: 'heart' };
    yield { f: 'sit', t: 400 };
  },
  *fireflies(d) {
    // At night: fireflies drift about; it watches, and tries to catch one.
    yield* d.getTo('sit');
    const flies = [];
    for (let i = 0; i < 2; i++) flies.push(d.spawn('firefly', { x: d.clampProp(d.center() + d.rnd(-60, 60), 1), y: d.rnd(6, 18), wander: true, alpha: 0, fadeIn: true, life: d.rnd(22000, 28000) }));
    d.envMark('fireflies');
    yield { f: 'sitUp', t: 800, fx: '!' };
    const n = d.rint(4, 7);
    for (let i = 0; i < n; i++) yield { f: 'sitUp', t: d.rnd(600, 900), face: d.dirTo(flies[i % 3]) };
    const f0 = flies.find((f) => d.has(f));
    if (f0) {
      yield* d.getTo('stand');
      yield* d.walkTo(() => d.centreOn(f0), 1.5, { max: 20 });
      yield { f: 'crouch', t: 120 };
      const caught = d.chance(0.5);
      yield { f: 'jump', t: 380, jump: 7, do: (c) => { if (caught && c.has(f0)) c.pickUp(f0); } };
      if (caught) {
        yield { f: 'up', t: 900, fx: 'heart' };
        yield { f: 'up', t: 500, do: (c) => c.release(f0) };
      } else yield { f: 'stand', t: 500, fx: '?' };
      yield { f: 'stand', t: 300 };
      yield* d.getTo('sit');
    }
    yield { f: 'sitUp', t: 900 };
    yield { f: 'sit', t: 500, do: (c) => { for (const f of flies) if (c.has(f)) c.fadeOut(f, 3000); } };
  },
  *puddleJump(d) {
    // What a puddle is for.
    const pd = d.find('puddle');
    if (!pd) return yield* ACTIVITIES.hop(d);
    yield* d.walkTo(() => d.reach(pd, 4), 1, { max: 60 });
    yield { f: 'up', t: 500, fx: '!', face: d.dirTo(pd) };
    const n = d.rint(2, 4);
    for (let i = 0; i < n; i++) {
      yield { f: 'crouch', t: 150 };
      yield { f: 'jump', t: 380, jump: 6 + i, dx: i === 0 ? d.centreOn(pd) - d.x : 0 };
      yield { f: 'crouch', t: 120, do: (c) => c.splashAt(c.center(), 6) };
    }
    yield { f: 'armsUp', t: 500, fx: 'note' };
    yield* ACTIVITIES.shakeOff(d);
  },

  // -- visitors that turn up now and then --
  *balloon(d) {
    // A balloon drifts by on the breeze. It jumps for the string: catches it (and is lifted, just a little), misses, or pops it.
    yield* d.getTo('stand');
    const left = d.chance(0.5);
    const b = d.spawn('balloon', d.arrive({ y: 9, vx: (left ? 1 : -1) * d.rnd(16, 22), vy: 0.35, life: 40000 }, 5, left ? -1 : 1));
    d.envMark('balloon');
    yield { f: 'stand', t: 700 };
    yield { f: 'up', t: 600, face: d.dirTo(b), fx: '!' };
    yield* d.walkTo(() => (d.has(b) ? d.centreOn(b) : null), 1.6, { max: 40 });
    if (!d.has(b)) return;
    yield { f: 'up', t: 300, face: d.dirTo(b) };
    yield { f: 'crouch', t: 120 };
    const plan = d.pick([['catch', 2], ['miss', 1.5], ['pop', 0.7]]);
    if (plan === 'pop') {
      yield { f: 'jump', t: 380, jump: 7, do: (c) => { c.remove(b); c.puffAt(b.x, b.y); } };
      yield { f: 'cower', t: 600, fx: '!' };
      yield { f: 'up', t: 600, fx: '?' };
    } else if (plan === 'miss') {
      yield { f: 'jump', t: 380, jump: 6 };
      yield { f: 'stand', t: 200, do: () => { b.vy = 4; b.vx *= 0.6; } };
      for (let i = 0; i < 6 && d.has(b); i++) yield { f: 'up', t: 400, face: d.dirTo(b) };
      yield { f: 'stand', t: 500, fx: 'dots' };
    } else {
      yield { f: 'jump', t: 380, jump: 6, do: () => { b.held = true; } };
      yield { f: 'up', t: 600, fx: 'heart' };
      yield { f: 'armsUp', t: 700, lift: [0, 3] }; // up it goes…
      yield { f: 'armsUp', t: 900, lift: [3, 3], fx: '!' };
      yield { f: 'up', t: 700, lift: [3, 0] };
      for (let i = 0; i < 4; i++) yield { f: i % 2 ? 'walk1' : 'walk2', t: 260, dx: 2 * d.face }; // a proud little stroll with it
      yield { f: 'up', t: 400, do: (c) => { b.held = false; b.vy = 4; b.vx = c.face * 6; } }; // and lets it go
      for (let i = 0; i < 4 && d.has(b); i++) yield { f: 'up', t: 400 };
      yield { f: 'armsUp', t: 500, fx: 'heart' };
    }
    yield { f: 'stand', t: 300 };
  },
  *paperPlane(d) {
    // A paper plane glides in and lands nearby. It reads the note, or sends the plane off again.
    yield* d.getTo('stand');
    const left = d.chance(0.5), dir = left ? 1 : -1;
    const pl = d.spawn('plane', d.arrive({ y: 24, vx: dir * d.rnd(55, 75), sink: d.rnd(3.5, 5), face: dir, life: 45000 }, 6, -dir));
    d.envMark('paperPlane');
    yield { f: 'stand', t: 500 };
    yield { f: 'up', t: 500, face: d.dirTo(pl), fx: '!' };
    for (let i = 0; i < 20 && d.has(pl) && pl.vx; i++) yield { f: 'up', t: 300, face: d.dirTo(pl) };
    if (!d.has(pl) || pl.fadeOutAt != null) return yield { f: 'stand', t: 500, fx: '?' };
    yield* d.walkTo(() => (d.has(pl) ? d.reach(pl) : null), 1.3, { max: 60 });
    if (!d.has(pl)) return;
    yield { f: 'sniff', t: 500, fx: '?' };
    yield { f: 'sniff', t: 250, do: (c) => c.pickUp(pl) };
    yield { f: 'up', t: 500 };
    if (d.chance(0.5)) {
      // Unfolds it: a note, just for it.
      yield* d.getTo('sit');
      yield { f: 'sitUp', t: 1100, fx: 'dots' };
      yield { f: 'sitUp', t: 900, fx: d.pick({ heart: 2, '!': 1, note: 1 }) };
      yield { f: 'sit', t: 400, do: (c) => { c.remove(pl); c.puffAt(c.nose()); } };
    } else {
      // Off it goes again.
      yield { f: 'crouch', t: 200 };
      yield { f: 'armsUp', t: 250, do: (c) => {
        const m = c.mouthAt();
        Object.assign(pl, { carried: false, x: c.clampProp(m.x - 3 * c.u, 6), y: Math.min(20, m.y + 1), vx: c.face * c.rnd(50, 70), sink: 2.5, face: c.face });
        c.expire(pl, 15000);
      } };
      for (let i = 0; i < 10 && d.has(pl) && pl.vx; i++) yield { f: 'up', t: 300, face: d.dirTo(pl) };
      yield { f: 'armsUp', t: 500, fx: 'star' };
    }
    yield { f: d.sitting() ? 'sit' : 'stand', t: 300 };
  },
  *frog(d) {
    // A frog hops up. They take turns, hop for hop — then the frog leaps off.
    yield* d.getTo('stand');
    const side = d.inward() || (d.chance(0.5) ? 1 : -1);
    const fr = d.spawn('frog', { x: d.clampProp(d.center() + side * d.rnd(90, 110), 6), vx: -side * 30, face: -side, tx: d.clampProp(d.center() + side * d.rnd(36, 50), 6), alpha: 0, fadeIn: true, life: 50000 });
    d.envMark('frog');
    yield { f: 'stand', t: 600 };
    yield { f: 'sniff', t: 500, face: side, fx: '?' };
    for (let i = 0; i < 20 && d.has(fr) && fr.vx; i++) yield { f: 'stand', t: 300 };
    yield { f: 'crouch', t: 400, fx: '!' };
    const n = d.rint(3, 5);
    for (let i = 0; i < n && d.has(fr); i++) {
      yield { f: 'stand', t: 700, face: d.dirTo(fr), do: () => { fr.bounce = true; } }; // the frog hops…
      yield { f: 'crouch', t: 120, do: () => { fr.bounce = false; } };
      yield { f: 'jump', t: 360, jump: 4 + i, fx: i === n - 1 ? 'note' : null }; // …and so does it
    }
    yield { f: 'up', t: 400, fx: d.chance(0.5) ? 'heart' : 'star' };
    yield { f: 'stand', t: 300, do: (c) => { if (c.has(fr)) fr.vx = c.dirTo(fr) * 24; } }; // the frog leaps away
    for (let i = 0; i < 8 && d.has(fr); i++) yield { f: 'up', t: 300, face: d.dirTo(fr) };
    yield { f: 'stand', t: 400, fx: 'dots' };
    if (d.has(fr)) d.fadeOut(fr, 1500);
  },
  *ladybug(d) {
    // A ladybird crawls up. It watches nose to the ground; the ladybird climbs onto its head, or flies off.
    yield* d.getTo('stand');
    const side = d.inward() || d.face;
    const lb = d.spawn('ladybug', { x: d.clampProp(d.center() + side * d.rnd(45, 60), 3), alpha: 0, fadeIn: true, life: 50000 });
    d.envMark('ladybug');
    yield { f: 'stand', t: 600, face: side };
    yield { f: 'sniff', t: 700, fx: '?', do: (c) => { lb.tx = c.front(3, 1); } };
    for (let i = 0; i < 16 && d.has(lb) && Math.abs(lb.x - lb.tx) > 1; i++) yield { f: i % 2 ? 'sniffBlink' : 'sniff', t: 500 };
    yield { f: 'sniff', t: 600, fx: 'heart' };
    if (d.chance(0.6)) {
      yield { f: 'sniff', t: 400, do: (c) => { c.remove(lb); c.wear('ladybug', 6000); } }; // it climbs aboard
      yield { f: 'up', t: 900, fx: '!' };
      yield { f: 'blink', t: 300 };
      yield { f: 'up', t: 1000 };
      yield { f: 'up', t: 600, do: (c) => { c.unwear(); c.spawn('ladybug', { x: c.clampProp(c.headX(), 3), y: c.height(), fly: true, vx: c.face * 10, life: 6000 }); } };
      yield { f: 'up', t: 900, fx: 'heart' };
    } else {
      yield { f: 'sniff', t: 300, fx: '!', do: () => { Object.assign(lb, { fly: true, vx: side * 12, y: 1 }); } };
      yield { f: 'up', t: 900, fx: 'dots' };
    }
    yield { f: 'stand', t: 400 };
  },
  *dandelion(d) {
    // A dandelion comes up and goes to seed. A deep breath — or a sneeze — and the seeds float away.
    yield* d.getTo('stand');
    const dl = d.spawn('dandelion', { x: d.front(5, 3), grows: true, life: 60000 });
    d.envMark('dandelion');
    yield { f: 'stand', t: 700 };
    yield { f: 'sniff', t: 500, fx: '?', face: d.dirTo(dl) };
    for (let i = 0; i < 10 && d.has(dl) && dl.frame < 2; i++) yield { f: 'sniffBlink', t: 400 };
    yield* d.walkTo(() => d.reach(dl), 0.8, { max: 30 });
    yield { f: 'sniff', t: 700, fx: 'heart' };
    const sneeze = d.chance(0.35);
    if (sneeze) { yield { f: 'up', t: 300 }; yield { f: 'yawn', t: 300 }; } else { yield { f: 'stand', t: 400 }; yield { f: 'up', t: 500 }; }
    yield { f: sneeze ? 'crouch' : 'sniff', t: 300, fx: 'puff', dx: sneeze ? -2 * d.face : 0, jump: sneeze ? 2 : 0, do: (c) => {
      dl.grows = false; dl.frame = 3; c.expire(dl, 15000);
      for (let i = 0, k = c.rint(2, 3); i < k && c.props.length < 6; i++) c.spawn('seed', { x: c.clampProp(dl.x + c.u, 3), y: 5 + i, vx: c.face * c.rnd(10, 22), vy: c.rnd(2, 3.5), life: 14000 });
    } };
    for (let i = 0; i < 5; i++) yield { f: 'up', t: 500 };
    yield { f: 'stand', t: 400, fx: sneeze ? 'dots' : 'star' };
  },
  *worm(d) {
    // A worm pokes its head out of the ground — here, then there. It pounces each time, a moment too late.
    yield* d.getTo('stand');
    d.envMark('worm');
    const n = d.rint(2, 4);
    for (let k = 0; k < n; k++) {
      const wm = d.spawn('worm', { x: d.clampProp(d.center() + (d.chance(0.5) ? 1 : -1) * d.rnd(30, 60), 5), life: 20000 });
      yield { f: 'stand', t: 300, do: () => { wm.frame = 1; } };
      yield { f: 'up', t: 400, face: d.dirTo(wm), fx: '!', do: () => { wm.frame = 2; } };
      yield* d.walkTo(() => d.reach(wm), 1.8, { max: 20 });
      yield { f: 'crouch', t: 300 };
      yield { f: 'jump', t: 420, jump: 6, dx: d.centreOn(wm) - d.x, do: () => { wm.frame = 0; } }; // gone again
      yield { f: 'sniff', t: 500, do: (c) => c.dirt(2) };
      yield { f: 'sniffBlink', t: 300, fx: '?', do: (c) => { c.remove(wm); c.puffAt(wm.x); } };
    }
    yield { f: 'up', t: 500, fx: d.chance(0.5) ? 'hash' : 'dots' };
    yield { f: 'stand', t: 300 };
  },

  // -- the theme turning dark or light on its schedule --
  *nightfall(d) {
    // The sun goes down, it waves goodnight, the moon comes up, and it lies chin up to watch the stars come out.
    yield* d.getTo('stand');
    const side = d.inward() || (d.chance(0.5) ? 1 : -1);
    const sun = d.sky('sun', { x: d.clampProp(d.center() + side * d.rnd(60, 100), 7), y: 22, ty: 0, life: 12000 });
    yield { f: 'stand', t: 500, face: side };
    yield { f: 'up', t: 800, fx: '!' };
    for (let i = 0; i < 2; i++) { yield { f: 'armsUp', t: 300 }; yield { f: 'stand', t: 300 }; } // bye, sun
    for (let i = 0; i < 8 && d.has(sun) && sun.y > 2; i++) yield { f: 'up', t: 500 };
    yield { f: 'yawn', t: 700, do: (c) => c.fadeOut(sun, 1200) };
    yield { f: 'blink', t: 200 };
    yield { f: 'stand', t: 500, face: -side, do: (c) => { c.sky('moon', { x: c.clampProp(c.center() - side * c.rnd(50, 90), 5), y: 2, ty: 24, alpha: 0, fadeIn: true, life: 40000 }); } };
    yield { f: 'up', t: 900, fx: 'heart' };
    yield* d.getTo('lie');
    const n = d.rint(5, 8);
    for (let i = 0; i < n; i++) {
      yield { f: 'lieUp', t: d.rnd(800, 1200), do: (c) => c.twinkle(c.rint(1, 3)) };
      if (i === 2) yield { f: 'lieUpHowl', t: 900, fx: 'note' }; // a song for the moon
      else if (d.chance(0.3)) yield { f: 'lieUpBlink', t: 160, fx: d.chance(0.4) ? 'star' : null };
    }
    yield { f: 'lieUpBlink', t: 400 };
    yield { f: 'lie', t: 600, fx: 'z' };
  },
  *daybreak(d) {
    // The moon goes, the sun comes up, and it greets the day: a stretch, a good-morning roar, a hop for joy.
    const moon = d.find('moon');
    if (moon) d.fadeOut(moon, 1500);
    const side = d.inward() || (d.chance(0.5) ? 1 : -1);
    const sun = d.sky('sun', { x: d.clampProp(d.center() + side * d.rnd(60, 100), 7), y: 0, ty: 22, alpha: 0, fadeIn: true, life: 30000 });
    if (postureOf(d.frame) === 'lie') {
      // Woken by the light.
      yield { f: 'lie', t: 900 };
      yield { f: 'lieBreath', t: 700 };
      yield { f: 'lieUpBlink', t: 500 };
      yield { f: 'lieUp', t: 900, face: d.dirTo(sun), fx: '!' };
      yield { f: 'lieUpBlink', t: 200 };
    }
    yield* d.getTo('stand');
    yield { f: 'up', t: 900, face: d.dirTo(sun), fx: '!' };
    yield { f: 'crouch', t: 300 };
    yield { f: 'stretch', t: 1000 };
    yield { f: 'yawn', t: 700 };
    yield { f: 'roar', t: 800, fx: 'note' }; // good morning!
    yield { f: 'up', t: 500 };
    for (let i = 0; i < 2; i++) { yield { f: 'crouch', t: 110 }; yield { f: 'jump', t: 360, jump: 5, fx: i ? 'heart' : 'star' }; }
    yield { f: 'armsUp', t: 600 };
    yield { f: 'stand', t: 400 };
  },

  // -- celebrations and growth --
  *celebrate(d) {
    // Today's goal was just reached.
    yield* d.getTo('stand');
    yield { f: 'up', t: 300, fx: '!' };
    for (let i = 0; i < 2; i++) { yield { f: 'crouch', t: 110 }; yield { f: 'jump', t: 380, jump: 8, fx: i ? 'heart' : 'star' }; }
    for (let i = 0; i < 6; i++) yield { f: i % 2 ? 'armsUp' : 'walk2', t: 200, fx: i === 2 ? 'note' : null };
    yield { f: 'stand', t: 400 };
  },
  *grow(d) {
    // A writing-streak milestone: it grows a pixel, with a proud stretch.
    yield* d.walkTo(d.zone(d.rnd(0.35, 0.65)), 1);
    yield* d.getTo('stand');
    yield { f: 'up', t: 500, fx: '!' };
    yield { f: 'crouch', t: 300 };
    yield { f: 'stretch', t: 900, fx: 'star', do: (c) => { c.g = c.targetG; c.sparkle(); } };
    yield { f: 'armsUp', t: 600, fx: 'heart' };
    yield { f: 'stand', t: 400 };
  },
  *shrink(d) {
    // The streak ended: back to its first size, no fuss.
    yield* d.getTo('stand');
    yield { f: 'blink', t: 400 };
    yield { f: 'crouch', t: 500, fx: 'dots', do: (c) => { c.g = c.targetG; c.puffAt(c.center()); } };
    yield { f: 'stand', t: 600 };
    yield { f: 'blink', t: 300 };
  },

  // -- special loops, unlocked by the writing streak --
  *skateboard(d) {
    // Rides a tiny skateboard along the desk, with an ollie in the middle.
    yield* d.getTo('stand');
    const dir = d.x < d.zone(0.5) ? 1 : -1;
    const board = d.spawn('skateboard', { x: d.front(7, 1) });
    yield { f: 'stand', t: 300, face: dir, do: (c) => c.puffAt(board.x) };
    yield { f: 'up', t: 500, fx: '!' };
    yield { f: 'crouch', t: 150 };
    yield { f: 'jump', t: 360, jump: 4, lift: [0, 2], dx: d.centreOn(board) - d.x };
    yield { f: 'crouch', t: 150, lift: [2, 2], do: () => { board.ride = true; } };
    const end = d.zone(dir > 0 ? 0.85 : 0.15);
    let ollie = false;
    for (let i = 0; i < 60 && Math.abs(end - d.x) > 3; i++) {
      if (!ollie && Math.abs(d.x - d.zone(0.5)) < 12) {
        ollie = true;
        yield { f: 'crouch', t: 120, lift: [2, 2], dx: 4 * dir };
        yield { f: 'jump', t: 440, lift: [2, 2], jump: 7, dx: 14 * dir, fx: 'star', do: () => { board.ollie = true; } };
        yield { f: 'crouch', t: 120, lift: [2, 2], dx: 3 * dir, do: () => { board.ollie = false; } };
      } else yield { f: 'stand', t: 150, lift: [2, 2], dx: Math.min(7, Math.abs(end - d.x)) * dir };
    }
    yield { f: 'armsUp', t: 400, lift: [2, 2], face: -dir };
    yield { f: 'jump', t: 360, lift: [2, 0], jump: 4, do: () => { board.ride = false; } };
    yield { f: 'crouch', t: 150 };
    yield { f: 'stand', t: 400, fx: 'heart', do: (c) => { c.remove(board); c.puffAt(board.x); } };
  },
  *fireworks(d) {
    // Sets off a few tiny fireworks — and covers its ears.
    yield* d.getTo('stand');
    const n = d.rint(2, 3);
    for (let k = 0; k < n; k++) {
      const dir = d.inward() || d.face;
      const r = d.spawn('rocket', { x: d.clampProp(d.center() + dir * 6 * d.du, 3) });
      yield { f: 'stand', t: 300, face: dir, do: (c) => c.puffAt(r.x) };
      yield { f: 'sniff', t: 400, do: (c) => c.spark(r.x + c.u, 3, 3) };
      yield* d.walkTo(d.clampX(d.x - dir * 30), 2);
      yield { f: 'cower', t: 600, face: dir, fx: '!' };
      yield { f: 'cower', t: 500, do: () => { r.launch = true; } };
      yield { f: 'up', t: 900 };
      yield { f: 'armsUp', t: 700, fx: 'star' };
      yield { f: 'stand', t: 400 };
    }
    yield { f: 'armsUp', t: 500, fx: 'heart' };
    yield { f: 'stand', t: 300 };
  },
  *rainDance(d) {
    // The long one: a rain dance; a cloud answers, a palm tree grows where the rain fell, a rainbow — and a rest in the shade.
    yield* d.walkTo(d.zone(d.rnd(0.35, 0.65)), 1);
    yield* d.getTo('stand');
    for (let i = 0; i < 8; i++) yield { f: i % 2 ? 'armsUp' : 'walk2', t: 230, face: i % 4 === 3 ? -d.face : undefined, fx: i % 3 === 0 ? 'note' : null };
    yield { f: 'crouch', t: 120 };
    yield { f: 'jump', t: 400, jump: 7, fx: '!' };
    const side = d.inward() || d.face;
    const spot = d.clampProp(d.center() + side * 45 - 6.5 * d.u, 13);
    const cl = d.summonCloud(spot + 6.5 * d.u);
    yield { f: 'up', t: 900, face: side };
    for (let i = 0; i < 15 && d.has(cl) && cl.phase === 'enter'; i++) yield { f: 'up', t: 300 };
    yield { f: 'up', t: 1200, do: () => { cl.raining = true; } };
    let tree = d.grownTree();
    yield { f: 'up', t: 1000, fx: '!', do: (c) => { if (!tree) tree = c.spawn('palm', { x: spot, grows: true, life: 120000 }); } };
    for (let i = 0; i < 10 && tree && d.has(tree) && tree.frame < 3; i++) yield { f: 'up', t: 500 };
    yield { f: 'armsUp', t: 800, fx: 'heart', do: (c) => { c.endRain(); c.spawnRainbow(); } };
    if (tree && d.has(tree)) {
      yield* d.walkTo(() => d.under(tree), 1, { max: 40 });
      yield* d.getTo('sit');
      for (let i = 0; i < 4; i++) yield { f: i % 2 ? 'sitBreath' : 'sitUp', t: 900, fx: i === 2 ? 'heart' : null };
    }
    yield { f: d.sitting() ? 'sit' : 'stand', t: 400 };
  },

  // -- rare surprises --
  *egg(d) {
    yield* d.getTo('stand');
    const x = d.clampProp(d.x + (d.x < d.zone(0.5) ? 1 : -1) * d.rnd(30, 60));
    const egg = d.spawn('egg', { x, y: 20, gravity: true });
    yield { f: 'stand', t: 700 };
    yield { f: 'up', t: 500, fx: '!', face: d.dirTo(egg) };
    yield* d.walkTo(() => d.reach(egg), 0.8, { max: 80 });
    yield { f: 'sniff', t: 700, fx: '?' };
    yield { f: 'sniffBlink', t: 300 };
    yield* d.getTo('sit');
    for (let i = 0; i < 3; i++) { yield { f: 'sit', t: 900 }; yield { f: 'sitUp', t: 300, do: () => { egg.wobble = 600; } }; }
    yield { f: 'sitUp', t: 600, fx: '!', do: () => { egg.frame = 1; egg.wobble = 900; } };
    yield { f: 'sit', t: 900 };
    yield { f: 'sitUp', t: 300, do: (c) => {
      c.remove(egg);
      c.spawn('shell', { x: egg.x, life: 9000 });
      const dir = egg.x > c.zone(0.5) + c.dw / 2 ? -1 : 1; // toddles off towards the middle, then blinks away
      c.spawn('baby', { x: egg.x, vx: 9 * dir, hops: true, face: dir, life: 7000 });
    } };
    yield { f: 'sitUp', t: 800, fx: 'heart' };
    yield* d.getTo('stand');
    for (let i = 0; i < 3; i++) { yield { f: 'armsUp', t: 300 }; yield { f: 'stand', t: 300 }; }
    yield { f: 'stand', t: 800, fx: 'heart' };
  },
  *ufo(d) {
    yield* d.getTo('stand');
    const ufo = d.spawn('ufo', d.arrive({ y: 24, tx: d.center() - 4.5 * d.u }, 9, d.x < d.zone(0.5) ? 1 : -1));
    yield { f: 'stand', t: 1200 };
    yield { f: 'up', t: 800, fx: '!', face: d.dirTo(ufo) };
    yield { f: 'up', t: 600, do: () => { ufo.beam = true; } };
    yield { f: 'armsUp', t: 700, lift: [0, 4] };
    yield { f: 'jump', t: 600, lift: [4, 7], face: -d.face };
    yield { f: 'jump', t: 500, lift: [7, 7], face: -d.face, flip: true };
    yield { f: 'jump', t: 500, lift: [7, 6], face: -d.face };
    yield { f: 'armsUp', t: 600, lift: [6, 2], do: () => { ufo.beam = false; } };
    yield { f: 'jump', t: 200, lift: [2, 0] };
    yield { f: 'fallen', t: 1000, fx: 'star', do: (c) => { ufo.tx = ufo.x + (ufo.x < c.zone(0.5) + c.dw / 2 ? -1 : 1) * 30; ufo.leaving = true; c.expire(ufo, 1600); } };
    yield { f: 'sit', t: 500 };
    yield { f: 'stand', t: 400 };
    yield { f: 'up', t: 900, fx: '?' };
    yield { f: 'stand', t: 600, face: -d.face, fx: 'dots' };
  },

  // -- odd little routines --
  *hiccups(d) {
    yield* d.getTo('stand');
    const n = d.rint(5, 9);
    for (let i = 0; i < n; i++) {
      yield { f: 'stand', t: d.rnd(500, 1400) };
      yield { f: 'jump', t: 180, jump: 2, fx: 'puff' };
      yield { f: 'blink', t: 150 };
    }
    yield { f: 'stand', t: 600, fx: 'dots' };
  },
  *flamingo(d) {
    yield* d.getTo('stand');
    const n = d.rint(3, 6);
    for (let i = 0; i < n; i++) yield { f: 'oneLeg', t: d.rnd(400, 800), ...(d.chance(0.5) ? { dx: d.chance(0.5) ? 1 : -1, jump: 1 } : {}) };
    if (d.chance(0.35)) { yield { f: 'fallen', t: 900, fx: 'star' }; yield { f: 'sit', t: 300 }; }
    else yield { f: 'armsUp', t: 500, fx: 'star' };
    yield { f: 'stand', t: 300 };
  },
  *peekaboo(d) {
    // Creeps off with its head down, as if nobody can see it, freezes when it
    // thinks it's been spotted, then pops up: boo!
    const dir = d.inward() || (d.chance(0.5) ? 1 : -1);
    yield* d.getTo('stand');
    yield { f: 'stand', t: 300, face: dir };
    yield { f: 'sniff', t: 250 };
    for (let i = 0, n = d.rint(5, 9); i < n; i++) {
      yield { f: i % 2 ? 'creep2' : 'creep1', t: 260, dx: 1.5 * dir, face: dir };
      if (d.chance(0.18)) { yield { f: 'sniff', t: d.rnd(500, 900), face: -dir }; yield { f: 'sniff', t: 200, face: dir }; } // freeze, look back
    }
    yield { f: 'crouch', t: 400, face: -dir };
    yield { f: 'crouch', t: d.rnd(400, 900) };
    yield { f: 'jump', t: 380, jump: 6, fx: '!' };
    yield { f: 'armsUp', t: 500, fx: d.chance(0.5) ? 'heart' : 'star' };
    yield { f: 'stand', t: 400 };
  },
  *shadowbox(d) {
    yield* d.getTo('stand');
    const n = d.rint(6, 12);
    for (let i = 0; i < n; i++) yield { f: i % 2 ? 'armsUp' : 'stand', t: 140, jump: 1, dx: i % 4 < 2 ? 1.5 : -1.5, fx: i === 4 ? 'star' : null };
    yield { f: 'stand', t: 300, fx: 'drop' };
  },
};

// Activities that start something of their own in the environment.
export const ENV_ACTIVITIES = new Set(['visitPlant', 'palmTree', 'flower', 'mushroom', 'snail', 'fireflies', 'rainDance', 'balloon', 'paperPlane', 'frog', 'ladybug', 'dandelion', 'worm']);
// Activities in the middle of which nothing else should happen in the environment.
export const ABSORBED = new Set([...ENV_ACTIVITIES, 'cornerBite', 'egg', 'ufo', 'skateboard', 'fireworks', 'grow', 'shrink', 'celebrate', 'zoomies', 'nightfall', 'daybreak']);
// The streak's special loops, in the order they are unlocked.
export const SPECIALS = ['skateboard', 'fireworks', 'rainDance'];

// ---- reactions ---------------------------------------------------------------------------------
//
// cat: subtle | normal | big | absurd | none | context | escalate | asleep | env.  w: base weight.
// ctx(k, d): for a reaction that only makes sense in some situations, how
// fitting it is in the one the click came in (k = d.context() at the click;
// 0 = not at all). mood: extra weight per mood. cool: minimum ms between two
// uses (rare jokes stay rare). delay: [min, max] ms before it happens.
// asleep: usable on a sleeping dinosaur; wakes: false keeps it asleep.
// stay: don't get up first (it reacts in its current posture; when lying, only
// with asleep or lying: true).
// env reactions are never chosen for a click: the environment picks them.

const DANCING = new Set(['dance', 'sing', 'celebrate', 'rainDance']);
const QUIET = new Set(['writeAlong', 'readScript', 'stargaze', 'watchWriter', 'coffeeBreak', 'yoga', 'treeShade', 'daydream']);
const sitOr = (d, sitting, standing) => (d.sitting() ? sitting : standing);

export const REACTIONS = {
  // subtle — an acknowledgement
  ack: { cat: 'subtle', w: 1.2, stay: true, *fn(d) { yield { f: sitOr(d, 'sitBlink', 'blink'), t: 160, face: d.towardCursor() }; yield { f: sitOr(d, 'sit', 'stand'), t: 400 }; } },
  lookUp: { cat: 'subtle', w: 1, *fn(d) { yield { f: 'up', t: 700, face: d.towardCursor() }; yield { f: 'blink', t: 150 }; } },
  wave: { cat: 'subtle', w: 1, *fn(d) { yield { f: 'stand', t: 120, face: d.towardCursor() }; for (let i = 0; i < 2; i++) { yield { f: 'armsUp', t: 220 }; yield { f: 'stand', t: 180 }; } } },
  tilt: { cat: 'subtle', w: 0.9, stay: true, *fn(d) { yield { f: sitOr(d, 'sitUp', 'up'), t: 600, fx: '?' }; yield { f: sitOr(d, 'sit', 'stand'), t: 300 }; } },
  nod: { cat: 'subtle', w: 0.8, *fn() { for (let i = 0; i < 2; i++) { yield { f: 'sniff', t: 160 }; yield { f: 'stand', t: 180 }; } } },
  wagHappy: { cat: 'subtle', w: 0.9, mood: { playful: 1.5 }, *fn(d) { yield { f: 'stand', t: 150, face: d.towardCursor() }; for (let i = 0; i < 6; i++) yield { f: i % 2 ? 'wag' : 'stand', t: 160, fx: i === 2 ? 'heart' : null }; } },
  scratchHead: { cat: 'subtle', w: 0.7, stay: true, mood: { curious: 1.5 }, *fn(d) {
    yield* d.getTo('sit');
    for (let i = 0; i < 4; i++) yield { f: i % 2 ? 'sitScratch1' : 'sitScratch2', t: 130, fx: i === 0 ? '?' : null };
    yield { f: 'sitBlink', t: 300 };
  } },
  doubleTake: { cat: 'subtle', w: 0.8, stay: true, *fn(d) {
    yield { f: sitOr(d, 'sit', 'stand'), t: 700 }; // didn't notice… wait, what?
    yield { f: sitOr(d, 'sitUp', 'up'), t: 120, face: d.towardCursor(), fx: '!' };
    yield { f: sitOr(d, 'sitBlink', 'blink'), t: 160 };
    yield { f: sitOr(d, 'sitUp', 'up'), t: 500 };
  } },
  yawnBored: { cat: 'subtle', w: 0.6, stay: true, mood: { sleepy: 3, grumpy: 1.5 }, *fn(d) {
    yield { f: sitOr(d, 'sitChew', 'yawn'), t: 700 };
    yield { f: sitOr(d, 'sitBlink', 'blink'), t: 400, fx: 'dots' };
    yield { f: sitOr(d, 'sit', 'stand'), t: 300, face: -d.towardCursor() };
  } },
  smile: { cat: 'subtle', w: 0.8, stay: true, *fn(d) { yield { f: sitOr(d, 'sitBlink', 'blink'), t: 500, face: d.towardCursor(), fx: 'heart' }; yield { f: sitOr(d, 'sitUp', 'up'), t: 400 }; } },
  peek: { cat: 'subtle', w: 0.7, *fn(d) { yield { f: 'sniff', t: 400, face: d.towardCursor() }; yield { f: 'sniffBlink', t: 200 }; yield { f: 'up', t: 500, fx: '?' }; yield { f: 'stand', t: 200 }; } },
  // normal
  achoo: { cat: 'normal', w: 0.6, *fn(d) { yield { f: 'up', t: 250, face: d.towardCursor() }; yield { f: 'yawn', t: 250 }; yield { f: 'yawn', t: 200 }; yield { f: 'crouch', t: 160, jump: 2, dx: -2 * d.face, fx: 'puff' }; yield { f: 'blink', t: 300, fx: '?' }; } },
  startle: { cat: 'normal', w: 1, asleep: true, *fn() { yield { f: 'crouch', t: 80 }; yield { f: 'jump', t: 420, jump: 8, fx: '!' }; yield { f: 'crouch', t: 120 }; yield { f: 'stand', t: 300 }; yield { f: 'blink', t: 150 }; } },
  love: { cat: 'normal', w: 1, *fn(d) { yield { f: 'crouch', t: 100, face: d.towardCursor() }; yield { f: 'jump', t: 360, jump: 4, fx: 'heart' }; yield { f: 'stand', t: 400 }; } },
  spin: { cat: 'normal', w: 0.9, *fn(d) { for (let i = 0; i < 6; i++) yield { f: i % 2 ? 'walk1' : 'walk2', t: 110, face: -d.face }; yield { f: 'stand', t: 500, fx: 'star' }; } },
  confused: { cat: 'normal', w: 0.9, asleep: true, *fn(d) { yield { f: 'stand', t: 300, fx: '?' }; yield { f: 'stand', t: 300, face: -d.face }; yield { f: 'stand', t: 300, face: -d.face }; yield { f: 'blink', t: 150 }; } },
  roarBack: { cat: 'normal', w: 0.8, *fn(d) { yield { f: 'up', t: 200, face: d.towardCursor() }; yield { f: 'roar', t: 600, fx: '!' }; yield { f: 'roar', t: 300 }; yield { f: 'stand', t: 300 }; } },
  boogie: { cat: 'normal', w: 0.8, *fn() { for (let i = 0; i < 6; i++) yield { f: i % 2 ? 'armsUp' : 'walk2', t: 180, fx: i === 0 ? 'note' : null }; yield { f: 'stand', t: 250 }; } },
  hopAway: { cat: 'normal', w: 0.8, *fn(d) { const dir = -d.towardCursor(); yield { f: 'crouch', t: 90, face: dir }; yield { f: 'jump', t: 380, jump: 6, dx: 10 * dir, fx: '!' }; yield { f: 'stand', t: 300, face: -dir }; } },
  giggle: { cat: 'normal', w: 0.8, *fn() { for (let i = 0; i < 3; i++) { yield { f: 'crouch', t: 120 }; yield { f: 'stand', t: 120, fx: i === 1 ? 'note' : null }; } yield { f: 'blink', t: 200 }; } },
  shy: { cat: 'normal', w: 0.6, *fn(d) { yield { f: 'stand', t: 200, face: -d.towardCursor() }; yield { f: 'sniffBlink', t: 900, fx: 'heart' }; yield { f: 'stand', t: 300, face: d.towardCursor() }; } },
  pounceCursor: { cat: 'normal', w: 0.7, mood: { playful: 2 }, *fn(d) {
    const dir = d.towardCursor();
    yield { f: 'crouch', t: 300, face: dir };
    for (let i = 0; i < 4; i++) yield { f: 'crouch', t: 110, dx: i % 2 ? 1 : -1 };
    yield { f: 'jump', t: 420, jump: 6, dx: 14 * dir };
    yield { f: 'sniff', t: 400, fx: '?' };
    yield { f: 'stand', t: 300 };
  } },
  highFive: { cat: 'normal', w: 0.7, *fn(d) { yield { f: 'crouch', t: 120, face: d.towardCursor() }; yield { f: 'armsUp', t: 400, jump: 9, fx: 'star' }; yield { f: 'crouch', t: 150 }; yield { f: 'stand', t: 300 }; } },
  cower: { cat: 'normal', w: 0.6, mood: { sleepy: 1.3 }, *fn() {
    yield { f: 'cower', t: 200, fx: '!' };
    for (let i = 0; i < 4; i++) yield { f: 'cower', t: 100, dx: i % 2 ? 1 : -1 };
    yield { f: 'cower', t: 600 };
    yield { f: 'up', t: 400, fx: '?' }; // peeks
    yield { f: 'stand', t: 300 };
  } },
  sulk: { cat: 'normal', w: 0.5, mood: { grumpy: 4, sleepy: 1.5 }, *fn(d) {
    const away = -d.towardCursor();
    yield { f: 'stand', t: 200, face: away, fx: 'hash' };
    yield* d.getTo('sit');
    yield { f: 'sit', t: 900, fx: 'dots' };
    yield { f: 'sitBlink', t: 300 };
    yield { f: 'sitUp', t: 400, face: -away }; // a glance back
    yield { f: 'sit', t: 600, face: away };
  } },
  puffUp: { cat: 'normal', w: 0.6, mood: { grumpy: 2 }, *fn(d) { yield { f: 'crouch', t: 150, face: d.towardCursor() }; yield { f: 'stretch', t: 700, fx: '!' }; yield { f: 'roar', t: 400 }; yield { f: 'stand', t: 300 }; } },
  curiousFollow: { cat: 'normal', w: 0.6, cool: 20000, mood: { curious: 3 }, *fn(d) {
    // Goes to see what was over there, sniffs about, looks back at you.
    const dir = d.towardCursor();
    yield { f: 'up', t: 300, face: dir, fx: '?' };
    yield* d.walkTo(d.clampX(d.x + dir * d.rnd(30, 50)), 1.6);
    yield { f: 'sniff', t: 500 };
    yield { f: 'sniffBlink', t: 200 };
    yield { f: 'sniff', t: 400, do: (c) => c.dirt(1) };
    yield { f: 'up', t: 600, face: -dir, fx: d.chance(0.5) ? 'heart' : '?' };
  } },
  // big — exaggerated
  faint: { cat: 'big', w: 0.8, *fn() { yield { f: 'up', t: 250 }; yield { f: 'armsUp', t: 250, fx: '!' }; yield { f: 'fallen', t: 1400 }; yield { f: 'fallen', t: 500, fx: 'star' }; yield { f: 'sit', t: 350 }; yield { f: 'stand', t: 300 }; } },
  flatten: { cat: 'big', w: 0.7, *fn() { yield { f: 'crouch', t: 120 }; yield { f: 'lie', t: 900 }; yield { f: 'lie', t: 400, fx: '?' }; yield { f: 'sit', t: 250 }; yield { f: 'stand', t: 250 }; } },
  backflip: { cat: 'big', w: 0.7, cool: 30000, *fn() {
    yield { f: 'crouch', t: 140 };
    yield { f: 'jump', t: 200, lift: [0, 7] };
    yield { f: 'jump', t: 170, lift: [7, 9], flip: true };
    yield { f: 'jump', t: 170, lift: [9, 6], flip: true };
    yield { f: 'jump', t: 200, lift: [6, 0] };
    yield { f: 'crouch', t: 150 };
    yield { f: 'armsUp', t: 500, fx: 'star' };
    yield { f: 'stand', t: 250 };
  } },
  bigJump: { cat: 'big', w: 0.7, *fn() { yield { f: 'crouch', t: 200 }; yield { f: 'jump', t: 600, jump: 13, fx: '!' }; yield { f: 'crouch', t: 160 }; yield { f: 'stand', t: 300, fx: 'star' }; } },
  runAway: { cat: 'big', w: 0.5, cool: 60000, *fn(d) {
    // Bolts off towards the roomier side, sulks with its back turned, then peeks round.
    const dir = d.x < d.zone(0.5) ? 1 : -1;
    const start = d.x;
    yield { f: 'stand', t: 150, face: dir, fx: '!' };
    yield* d.walkTo(d.x + dir * Math.min(140, d.maxX * 0.45), 3);
    yield* d.getTo('sit');
    yield { f: 'sit', t: d.rnd(600, 1000), fx: 'dots' };
    yield { f: 'sitUp', t: 500, face: -dir, fx: '?' };
    yield { f: 'sitBlink', t: 200 };
    yield* d.walkTo(start, 2.2);
  } },
  zoomAround: { cat: 'big', w: 0.6, mood: { playful: 2.5 }, *fn(d) {
    const start = d.x, dir = d.inward() || d.towardCursor();
    yield { f: 'crouch', t: 150, face: dir, fx: '!' };
    yield* d.walkTo(d.clampX(d.x + dir * 60), 3);
    yield { f: 'crouch', t: 120, do: (c) => c.dirt(3) };
    yield* d.walkTo(start, 3);
    yield { f: 'crouch', t: 120, do: (c) => c.dirt(2) };
    yield { f: 'armsUp', t: 400, fx: 'star', face: d.towardCursor() };
  } },
  cartwheel: { cat: 'big', w: 0.5, cool: 30000, *fn(d) {
    const dir = d.inward() || -d.towardCursor();
    yield { f: 'stand', t: 150, face: dir };
    for (let i = 0; i < 2; i++) {
      yield { f: 'armsUp', t: 160, lift: [0, 3], dx: 4 * dir };
      yield { f: 'stand', t: 160, lift: [3, 3], dx: 4 * dir, flip: true };
      yield { f: 'armsUp', t: 160, lift: [3, 0], dx: 4 * dir };
    }
    yield { f: 'armsUp', t: 500, fx: 'star', face: -dir };
    yield { f: 'stand', t: 250 };
  } },
  showOff: { cat: 'big', w: 0.5, cool: 45000, mood: { playful: 2, silly: 2 }, *fn(d) {
    // A whole routine, just for you.
    yield { f: 'up', t: 300, face: d.towardCursor(), fx: '!' };
    yield { f: 'crouch', t: 110 };
    yield { f: 'jump', t: 360, jump: 6 };
    for (let i = 0; i < 4; i++) yield { f: i % 2 ? 'walk1' : 'walk2', t: 120, face: -d.face };
    yield { f: 'crouch', t: 140 };
    yield { f: 'jump', t: 200, lift: [0, 6] };
    yield { f: 'jump', t: 200, lift: [6, 6], flip: true };
    yield { f: 'jump', t: 200, lift: [6, 0] };
    yield { f: 'armsUp', t: 500, fx: 'star', face: d.towardCursor() };
    yield { f: 'sniff', t: 500 }; // a bow
    yield { f: 'stand', t: 300, fx: 'heart' };
  } },
  // absurd — completely unexpected
  partyHat: { cat: 'absurd', w: 0.6, cool: 120000, *fn() { yield { f: 'crouch', t: 150, do: (c) => c.wear('party', 45000) }; yield { f: 'jump', t: 380, jump: 5, fx: 'star' }; yield { f: 'armsUp', t: 400, fx: 'note' }; yield { f: 'stand', t: 300 }; } },
  statue: { cat: 'absurd', w: 0.6, cool: 40000, *fn() { yield { f: 'stand', t: 1300 }; yield { f: 'stand', t: 1200, fx: 'dots' }; yield { f: 'blink', t: 250 }; yield { f: 'stand', t: 300, fx: 'heart' }; } },
  playDead: { cat: 'absurd', w: 0.6, cool: 40000, *fn() { yield { f: 'armsUp', t: 250, fx: '!' }; yield { f: 'fallen', t: 1500 }; yield { f: 'fallen', t: 800, fx: 'dots' }; yield { f: 'sitBlink', t: 300 }; yield { f: 'lie', t: 400 }; yield { f: 'sit', t: 300 }; yield { f: 'stand', t: 300, fx: '?' }; } },
  pretendSleep: { cat: 'absurd', w: 0.5, cool: 40000, *fn(d) { yield* d.getTo('lie'); for (let i = 0; i < 3; i++) { yield { f: 'lie', t: 450, fx: i === 0 ? 'z' : null }; yield { f: 'lieBreath', t: 450 }; } yield { f: 'sitBlink', t: 250, fx: '!' }; yield* d.getTo('stand'); } },
  bow: { cat: 'absurd', w: 0.5, *fn(d) { yield { f: 'stand', t: 150, face: d.towardCursor() }; yield { f: 'sniff', t: 700 }; yield { f: 'sniffBlink', t: 300 }; yield { f: 'armsUp', t: 400, fx: 'star' }; yield { f: 'stand', t: 200 }; } },
  sneezeLeaf: { cat: 'absurd', w: 0.5, cool: 30000, *fn(d) { yield { f: 'up', t: 300 }; yield { f: 'yawn', t: 300 }; yield { f: 'crouch', t: 160, jump: 2, dx: -2 * d.face, fx: 'puff', do: (c) => c.spawn('leaf', { x: c.clampProp(c.center() + c.face * 6 * c.du), y: 9, fall: true, life: 12000 }) }; yield { f: 'stand', t: 600, fx: '?' }; } },
  gift: { cat: 'absurd', w: 0.5, cool: 60000, *fn(d) {
    // Brings you something: a prop that's lying about, or one dug up on the spot.
    let p = d.restingProp();
    if (p) { yield* d.walkTo(() => d.reach(p), 2, { max: 40 }); if (!d.has(p)) return; yield { f: 'sniff', t: 200, do: (c) => c.pickUp(p) }; }
    else { yield { f: 'sniff', t: 300 }; for (let i = 0; i < 4; i++) yield { f: i % 2 ? 'sniff' : 'crouch', t: 130, do: (c) => c.dirt(2) }; yield { f: 'sniff', t: 200, do: (c) => { p = c.spawn('bone', { carried: true }); } }; }
    yield { f: 'up', t: 300 };
    yield* d.walkTo(d.clampX(d.cursorX() - d.dw / 2), 2, { max: 40 });
    yield { f: 'sniff', t: 250, do: (c) => { c.drop(p, 0); c.expire(p, 30000); } };
    yield { f: 'up', t: 600, face: d.towardCursor(), fx: 'heart' };
  } },
  // none — as if nothing happened (sometimes noticed a moment later)
  nothing: { cat: 'none', w: 1, stay: true, *fn() {} },
  noticeLater: { cat: 'none', w: 0.8, stay: true, delay: [1500, 3800], *fn(d) { yield { f: sitOr(d, 'sitUp', 'up'), t: 600, face: d.towardCursor(), fx: '?' }; yield { f: sitOr(d, 'sit', 'stand'), t: 300 }; } },

  // context — only where they fit what it was doing
  stopInTracks: { cat: 'context', w: 1, ctx: (k) => (k.moving ? 5 : 0), *fn(d) {
    // Freezes mid-stride, looks at you, and carries on.
    yield { f: 'walk1', t: 600, face: d.towardCursor() };
    yield { f: 'up', t: 500, fx: '?' };
    yield { f: 'blink', t: 150 };
    yield { f: 'stand', t: 200, face: -d.face };
  } },
  skip: { cat: 'context', w: 1, ctx: (k) => (k.moving ? 3 : 0), *fn(d) {
    const dir = d.face;
    for (let i = 0; i < 2; i++) { yield { f: 'crouch', t: 100 }; yield { f: 'jump', t: 300, jump: 4, dx: 6 * dir, fx: i ? 'note' : null }; }
    yield { f: 'stand', t: 250 };
  } },
  tripUp: { cat: 'context', w: 1, ctx: (k) => (k.moving ? 2 : 0), *fn(d) {
    yield { f: 'walk2', t: 120, dx: 2 * d.face, fx: '!' };
    yield { f: 'fallen', t: 900, fx: 'star' };
    yield { f: 'sit', t: 400 };
    yield { f: 'stand', t: 300, fx: 'dots' };
  } },
  guardBone: { cat: 'context', w: 1, ctx: (k) => (k.carrying === 'bone' ? 5 : k.near.bone ? 2 : 0), mood: { grumpy: 2 }, *fn(d) {
    // Mine.
    const away = -d.towardCursor();
    yield { f: 'cower', t: 200, face: away, fx: 'hash' };
    yield { f: 'cower', t: 900 };
    yield { f: 'up', t: 300, face: -away };
    yield { f: 'cower', t: 600, face: away, fx: 'dots' };
  } },
  shareSnack: { cat: 'context', w: 1, ctx: (k) => (k.carrying === 'bone' ? 3 : 0), *fn(d) {
    // Holds the bone out to you… and thinks better of it.
    yield { f: 'up', t: 600, face: d.towardCursor(), fx: 'heart' };
    yield { f: 'armsUp', t: 500 };
    yield { f: 'up', t: 400, fx: '?' };
    yield { f: 'stand', t: 400, face: -d.towardCursor(), fx: 'dots' };
  } },
  kickToYou: { cat: 'context', w: 1, ctx: (k) => (k.near.ball || k.near.coconut || k.activity === 'fetch' ? 4 : 0), *fn(d) {
    const ball = d.find('ball') || d.find('coconut');
    if (!ball) { yield { f: 'kick', t: 220 }; yield { f: 'stand', t: 300, fx: '?' }; return; }
    yield* d.walkTo(() => d.reach(ball), 1.5, { max: 30 });
    yield { f: 'stand', t: 150, face: d.dirTo(ball) };
    yield { f: 'kick', t: 220, do: (c) => c.kick(ball, c.towardCursor(), 0.7) };
    yield { f: 'up', t: 500, fx: 'star', face: d.towardCursor() };
  } },
  headBall: { cat: 'context', w: 1, ctx: (k) => (k.near.ball ? 3 : k.activity === 'juggle' ? 3 : 0), *fn(d) {
    const ball = d.find('ball');
    if (!ball) { yield { f: 'up', t: 400, fx: '?' }; return; }
    yield* d.walkTo(() => d.reach(ball), 1.5, { max: 30 });
    yield { f: 'sniff', t: 250, do: () => { ball.balance = true; ball.carried = false; } };
    for (let i = 0; i < 4; i++) yield { f: 'up', t: 260 };
    yield { f: 'kick', t: 220, do: (c) => { ball.balance = false; ball.y = 10; c.kick(ball, c.towardCursor(), 0.6); } };
    yield { f: 'armsUp', t: 400, fx: 'star' };
  } },
  carriageReturn: { cat: 'context', w: 1, stay: true, ctx: (k) => (k.activity === 'writeAlong' && k.posture === 'sit' ? 5 : 0), *fn(d) {
    // Ding!
    const tw = d.find('typewriter');
    yield* d.getTo('sit');
    yield { f: 'sitUp', t: 250, fx: '!' };
    yield { f: 'sitTap2', t: 160, do: () => { if (tw) tw.wobble = 400; } };
    yield { f: 'sitUp', t: 500, fx: 'note' };
    yield { f: 'sit', t: 250 };
  } },
  showPage: { cat: 'context', w: 1, stay: true, ctx: (k) => ((k.activity === 'writeAlong' || k.activity === 'readScript') && k.posture === 'sit' ? 4 : 0), *fn(d) {
    // Holds up its page for you to see.
    let pg = d.props.find((p) => p.kind === 'page' && p.carried), own = false;
    yield* d.getTo('sit');
    yield { f: 'sitBlink', t: 200, face: d.towardCursor(), do: (c) => { if (!pg) { pg = c.spawn('page', { carried: true }); own = true; } } };
    yield { f: 'sitUp', t: 900, fx: '!' };
    yield { f: 'sitUp', t: 600, fx: 'heart' };
    yield { f: 'sit', t: 300, do: (c) => { if (own) { c.remove(pg); c.puffAt(c.nose()); } } };
  } },
  shush: { cat: 'context', w: 1, stay: true, ctx: (k) => (QUIET.has(k.activity) ? 3 : 0), *fn(d) {
    const was = d.face;
    yield { f: sitOr(d, 'sitBlink', 'blink'), t: 700, face: d.towardCursor(), fx: 'dots' };
    yield { f: sitOr(d, 'sit', 'stand'), t: 300, face: was };
  } },
  dancePartner: { cat: 'context', w: 1, ctx: (k) => (DANCING.has(k.activity) || k.reaction === 'boogie' ? 5 : 0), *fn(d) {
    yield { f: 'stand', t: 150, face: d.towardCursor(), fx: 'heart' };
    for (let i = 0; i < 6; i++) yield { f: i % 3 === 2 ? 'armsUp' : i % 2 ? 'walk1' : 'walk2', t: 200, fx: i === 3 ? 'note' : null };
    yield { f: 'sniff', t: 500 };
    yield { f: 'stand', t: 300 };
  } },
  twirl: { cat: 'context', w: 1, ctx: (k) => (DANCING.has(k.activity) ? 3 : 0), *fn(d) {
    for (let i = 0; i < 4; i++) yield { f: i % 2 ? 'armsUp' : 'stand', t: 140, lift: i === 0 ? [0, 2] : i === 3 ? [2, 0] : [2, 2], face: -d.face };
    yield { f: 'armsUp', t: 400, fx: 'star' };
  } },
  pointUp: { cat: 'context', w: 1, stay: true, ctx: (k) => (k.night || k.activity === 'stargaze' || k.activity === 'howl' ? 4 : 0), *fn(d) {
    // Look — up there!
    yield { f: sitOr(d, 'sitUp', 'up'), t: 600, face: d.towardCursor(), fx: '!' };
    yield { f: sitOr(d, 'sitUp', 'up'), t: 600, face: -d.face, fx: 'star' };
    yield { f: sitOr(d, 'sitBlink', 'blink'), t: 200 };
  } },
  treeHide: { cat: 'context', w: 1, ctx: (k) => (k.tree ? 4 : 0), *fn(d) {
    // Hides behind the (very thin) trunk. Nobody can see it there.
    const tree = d.grownTree();
    if (!tree) { yield { f: 'cower', t: 800, fx: 'dots' }; return; }
    yield* d.walkTo(() => d.under(tree), 2.6, { max: 30 });
    yield { f: 'cower', t: 900, fx: 'dots', face: d.towardCursor() };
    yield { f: 'cower', t: 600, face: -d.face };
    yield { f: 'crouch', t: 100 };
    yield { f: 'jump', t: 360, jump: 6, fx: '!', face: d.towardCursor() };
    yield { f: 'armsUp', t: 400, fx: 'heart' };
  } },
  bumpTree: { cat: 'context', w: 1, ctx: (k) => (k.tree ? 3 : 0), *fn(d) {
    // Jumps in surprise, straight into the palm; a frond lands on its head.
    const tree = d.grownTree();
    yield { f: 'crouch', t: 80 };
    yield { f: 'jump', t: 400, jump: 7, fx: '!', do: () => { if (tree) tree.wobble = 500; } };
    yield { f: 'crouch', t: 150, do: (c) => c.wear('leaf', 8000) };
    yield { f: 'stand', t: 500, fx: 'star' };
    yield { f: 'up', t: 400, fx: '?' };
  } },
  splash: { cat: 'context', w: 1, ctx: (k) => (k.near.puddle ? 4 : k.raining ? 3 : 0), *fn(d) {
    yield { f: 'crouch', t: 120, face: d.towardCursor() };
    yield { f: 'jump', t: 360, jump: 5 };
    yield { f: 'crouch', t: 150, do: (c) => c.splashAt(c.center(), 7, c.towardCursor()) };
    yield { f: 'armsUp', t: 400, fx: 'note' };
  } },
  shakeDry: { cat: 'context', w: 1, ctx: (k) => (k.raining || k.wet ? 4 : 0), *fn(d) {
    yield { f: 'stand', t: 150, face: d.towardCursor() };
    for (let i = 0; i < 6; i++) yield { f: i % 2 ? 'hunch' : 'stand', t: 90, jump: 1, dx: i % 2 ? 1 : -1, do: (c) => c.splashAt(c.center(), 2) };
    yield { f: 'stand', t: 400, fx: 'dots' };
  } },
  tipHat: { cat: 'context', w: 1, ctx: (k) => (k.hat === 'party' || k.hat === 'leaf' || k.hat === 'umbrella' ? 4 : 0), *fn(d) {
    yield { f: 'stand', t: 150, face: d.towardCursor() };
    yield { f: 'sniff', t: 600, hatUp: true };
    yield { f: 'stand', t: 400, fx: 'star' };
  } },
  birdShoo: { cat: 'context', w: 1, stay: true, ctx: (k) => (k.hat === 'bird' ? 6 : 0), *fn(d) {
    yield { f: sitOr(d, 'sitUp', 'up'), t: 200, fx: '!', do: (c) => c.birdOff() };
    yield { f: sitOr(d, 'sitUp', 'up'), t: 600, fx: '?' };
    yield { f: sitOr(d, 'sitBlink', 'blink'), t: 200 };
  } },
  offerFlower: { cat: 'context', w: 1, ctx: (k) => (k.near.flower ? 4 : 0), *fn(d) {
    const fl = d.find('flower');
    if (!fl) { yield { f: 'sniff', t: 400, fx: '?' }; return; }
    yield* d.walkTo(() => d.reach(fl), 1.5, { max: 30 });
    yield { f: 'chomp', t: 250, do: (c) => { fl.grows = false; fl.frame = 3; c.pickUp(fl); } };
    yield { f: 'up', t: 900, face: d.towardCursor(), fx: 'heart' };
    yield { f: 'sniff', t: 300, do: (c) => { c.drop(fl, 0); c.expire(fl, 20000); } };
  } },
  snailBoop: { cat: 'context', w: 1, stay: true, lying: true, ctx: (k) => (k.activity === 'snail' && k.posture === 'lie' ? 5 : 0), *fn(d) {
    const sn = d.find('snail');
    yield* d.getTo('lie');
    yield { f: 'lie', t: 300, fx: '!', do: () => { if (sn) sn.hide = 2500; } };
    yield { f: 'lie', t: 900, fx: '?' };
    yield { f: 'lieBreath', t: 500 };
  } },
  dropIt: { cat: 'context', w: 1, ctx: (k) => (k.carrying && k.carrying !== 'bone' ? 3 : 0), *fn(d) {
    // Startled into dropping what it's holding — then picks it back up.
    const p = d.props.find((q) => q.carried);
    yield { f: 'jump', t: 300, jump: 3, fx: '!', do: (c) => { if (p) c.drop(p, 0); } };
    yield { f: 'stand', t: 400, fx: '?' };
    yield { f: 'sniff', t: 300, do: (c) => { if (p && c.has(p)) c.pickUp(p); } };
    yield { f: 'stand', t: 200 };
  } },
  scootOver: { cat: 'context', w: 1, stay: true, ctx: (k) => (k.posture === 'sit' && !k.asleep ? 3 : 0), *fn(d) {
    const dir = -d.towardCursor();
    yield* d.getTo('sit');
    for (let i = 0; i < 3; i++) yield { f: i % 2 ? 'sitBreath' : 'sit', t: 220, jump: 1, dx: 3 * dir }; // a little hitch over on its haunches
    yield { f: 'sitUp', t: 500, face: -dir, fx: d.chance(0.5) ? 'dots' : 'heart' };
  } },
  tailThump: { cat: 'context', w: 1, stay: true, ctx: (k) => (k.posture === 'sit' && !k.asleep ? 2 : 0), *fn(d) {
    yield* d.getTo('sit');
    yield { f: 'sitBlink', t: 160, face: d.towardCursor() };
    for (let i = 0; i < 6; i++) yield { f: i % 2 ? 'sitTap2' : 'sitTap1', t: 150, fx: i === 3 ? 'heart' : null };
    yield { f: 'sit', t: 300 };
  } },
  chinUp: { cat: 'context', w: 1, stay: true, lying: true, ctx: (k) => (k.posture === 'lie' && !k.asleep ? 3 : 0), *fn(d) {
    // Lying down: lifts its chin to look at you.
    yield* d.getTo('lie');
    yield { f: 'lieUp', t: 500, face: d.towardCursor(), fx: '!' };
    yield { f: 'lieUpBlink', t: 200 };
    yield { f: 'lieUp', t: 700, fx: d.chance(0.5) ? 'heart' : '?' };
    yield { f: 'lie', t: 300 };
  } },
  rollUp: { cat: 'context', w: 1, stay: true, lying: true, ctx: (k) => (k.posture === 'lie' && !k.asleep ? 4 : 0), *fn(d) {
    yield* d.getTo('lie');
    yield { f: 'fallen', t: 300, fx: '!' };
    yield { f: 'lie', t: 300 };
    yield { f: 'sitBlink', t: 300 };
    yield { f: 'sit', t: 400, fx: 'dots' };
  } },

  // escalation — lots of clicks
  annoyed: { cat: 'escalate', w: 1, *fn(d) { for (let i = 0; i < 3; i++) { yield { f: 'crouch', t: 120 }; yield { f: 'stand', t: 140, fx: i === 0 ? 'hash' : null }; } yield { f: 'roar', t: 500 }; yield { f: 'stand', t: 300, face: -d.face }; } },
  stomp: { cat: 'escalate', w: 1, *fn(d) { yield { f: 'roar', t: 300, face: d.towardCursor(), fx: 'hash' }; for (let i = 0; i < 4; i++) { yield { f: 'crouch', t: 120 }; yield { f: 'stand', t: 160, do: (c) => c.dirt(3) }; } yield { f: 'roar', t: 500 }; yield { f: 'stand', t: 300 }; } },
  dizzy: { cat: 'escalate', w: 1, *fn(d) { for (let i = 0; i < 10; i++) yield { f: i % 2 ? 'walk1' : 'walk2', t: 90, face: -d.face, fx: i === 6 ? 'star' : null }; yield { f: 'fallen', t: 1000, fx: 'star' }; yield { f: 'sit', t: 300 }; yield { f: 'stand', t: 300 }; } },
  storm: { cat: 'escalate', w: 1, *fn(d) { yield { f: 'roar', t: 400, fx: 'hash', face: d.towardCursor() }; const dir = d.x < d.zone(0.5) ? 1 : -1; yield { f: 'stand', t: 150, face: dir }; yield* d.walkTo(d.x + dir * Math.min(150, d.maxX * 0.5), 2.2); yield* d.getTo('sit'); yield { f: 'sit', t: 1200, face: dir, fx: 'dots' }; yield* d.getTo('stand'); } },
  hideFace: { cat: 'escalate', w: 1, *fn(d) { yield { f: 'cower', t: 1200, face: -d.towardCursor(), fx: 'dots' }; yield { f: 'cower', t: 900 }; yield { f: 'up', t: 300, fx: '?' }; yield { f: 'cower', t: 600 }; } },

  // asleep — clicks on a sleeping dinosaur
  snore: { cat: 'asleep', w: 1, asleep: true, wakes: false, stay: true, *fn() { yield { f: 'lieBreath', t: 500, fx: 'z' }; yield { f: 'lie', t: 400, fx: 'z' }; } },
  grumble: { cat: 'asleep', w: 0.8, asleep: true, wakes: false, stay: true, *fn() { yield { f: 'sitBlink', t: 300 }; yield { f: 'sit', t: 400, fx: 'hash' }; yield { f: 'lie', t: 400 }; } },
  sleepTalk: { cat: 'asleep', w: 0.8, asleep: true, wakes: false, stay: true, *fn() { yield { f: 'lie', t: 500, fx: 'note' }; yield { f: 'lieBreath', t: 500 }; yield { f: 'lie', t: 500, fx: '?' }; yield { f: 'lieBreath', t: 500 }; } },
  rollOver: { cat: 'asleep', w: 0.8, asleep: true, wakes: false, stay: true, *fn(d) { yield { f: 'lie', t: 300 }; yield { f: 'fallen', t: 500 }; yield { f: 'lie', t: 400, face: -d.face }; yield { f: 'lieBreath', t: 500, fx: 'z' }; } },
  wakeGrumpy: { cat: 'asleep', w: 0.7, asleep: true, wakes: false, stay: true, *fn(d) {
    // Sits up, glares, and lies back down with its back to you.
    yield { f: 'sitBlink', t: 300 };
    yield { f: 'sit', t: 600, face: d.towardCursor(), fx: 'hash' };
    yield { f: 'sitBlink', t: 300 };
    yield { f: 'lie', t: 500, face: -d.towardCursor() };
    yield { f: 'lieBreath', t: 500, fx: 'z' };
  } },

  // env — its part in what happens around it (chosen by the event, never by a click)
  rainTolerate: { cat: 'env', w: 1, stay: true, *fn(d) {
    // Sits (or stands) it out, a little damp and unimpressed.
    const s = d.sitting();
    for (let i = 0; i < 3; i++) {
      yield { f: s ? 'sitBlink' : 'hunch', t: 900, fx: i === 0 ? 'drop' : i === 2 ? 'dots' : null };
      yield { f: s ? 'sit' : 'blink', t: 800 };
    }
    yield { f: s ? 'sitUp' : 'up', t: 700, fx: '?', do: (c) => c.endRain() };
  } },
  rainEscape: { cat: 'env', w: 1, *fn(d) {
    // Runs for it. The cloud follows. It gives up.
    const dir = d.x < d.zone(0.5) ? 1 : -1;
    yield { f: 'up', t: 300, fx: '!' };
    yield* d.walkTo(d.clampX(d.x + dir * Math.min(110, d.maxX * 0.35)), 2.8);
    yield { f: 'up', t: 500, fx: '?' };
    yield* d.walkTo(d.clampX(d.x - dir * 50), 2.8);
    yield { f: 'up', t: 400 };
    yield { f: 'hunch', t: 1200, fx: 'hash' };
    yield { f: 'hunch', t: 900, do: (c) => c.endRain() };
    yield { f: 'stand', t: 300, fx: 'dots' };
  } },
  rainShelter: { cat: 'env', w: 1, *fn(d) {
    // Off to the palm tree; the fronds keep it dry.
    const tree = d.grownTree();
    yield { f: 'up', t: 300, fx: '!' };
    if (tree) yield* d.walkTo(() => d.under(tree), 2.6, { max: 40 });
    yield* d.getTo('sit');
    yield { f: 'sit', t: 1200, do: (c) => { c.sheltered = true; } };
    yield { f: 'sitUp', t: 800, fx: 'heart' };
    yield { f: 'sitBreath', t: 1000 };
    yield { f: 'sit', t: 1000, do: (c) => c.endRain() };
    yield { f: 'sitBlink', t: 300, do: (c) => { c.sheltered = false; } };
  } },
  rainDrink: { cat: 'env', w: 1, *fn() {
    // Mouth open to the sky.
    yield { f: 'up', t: 400, fx: '!' };
    yield { f: 'howl', t: 900 };
    yield { f: 'howl', t: 900, fx: 'drop' };
    yield { f: 'blink', t: 300 }; // gulp
    yield { f: 'howl', t: 800 };
    yield { f: 'armsUp', t: 500, fx: 'heart', do: (c) => c.endRain() };
  } },
  rainUmbrella: { cat: 'env', w: 1, *fn() {
    // Produces a big leaf and holds it over its head.
    yield { f: 'sniff', t: 400, fx: '!' };
    yield { f: 'stand', t: 300, do: (c) => c.wear('umbrella', 25000) };
    yield { f: 'stand', t: 1200, fx: 'note' };
    yield { f: 'blink', t: 300 };
    yield { f: 'stand', t: 1500 };
    yield { f: 'stand', t: 800, fx: 'star', do: (c) => c.endRain() };
  } },
  rainSleep: { cat: 'env', w: 1, asleep: true, wakes: false, stay: true, *fn() {
    // Sleeps right through it.
    for (let i = 0; i < 3; i++) { yield { f: 'lie', t: 900, fx: i === 0 ? 'drop' : 'z' }; yield { f: 'lieBreath', t: 900 }; }
    yield { f: 'lie', t: 600, do: (c) => c.endRain() };
  } },
  rainJig: { cat: 'env', w: 1, *fn(d) {
    // Dances in the rain.
    for (let i = 0; i < 10; i++) yield { f: i % 3 === 2 ? 'armsUp' : i % 2 ? 'walk1' : 'walk2', t: 230, face: i % 4 === 3 ? -d.face : undefined, fx: i % 4 === 0 ? 'note' : null, do: i % 2 ? (c) => c.splashAt(c.center(), 2) : undefined };
    yield { f: 'armsUp', t: 500, fx: 'heart', do: (c) => c.endRain() };
  } },
  windLean: { cat: 'env', w: 1, *fn(d) {
    // Leans into the wind, and is pushed back a step anyway.
    const dir = d.windDir();
    yield { f: 'hunch', t: 400, face: -dir };
    for (let i = 0; i < 4; i++) { yield { f: 'hunch', t: 300 }; yield { f: i % 2 ? 'walk2' : 'walk1', t: 250, dx: 1.5 * dir }; } // staggers back a step
    yield { f: 'blink', t: 300 };
    yield { f: 'stand', t: 400, fx: 'dots' };
  } },
  windHat: { cat: 'env', w: 1, *fn(d) {
    // The wind takes its hat. After it!
    const hat = d.props.find((p) => p.blownHat);
    yield { f: 'up', t: 300, fx: '!' };
    if (hat) {
      yield* d.walkTo(() => (d.has(hat) ? d.reach(hat) : null), 2.6, { max: 40 });
      if (d.has(hat)) yield { f: 'sniff', t: 300, do: (c) => { c.remove(hat); c.wear(hat.kind, 20000); } };
    }
    yield { f: 'armsUp', t: 400, fx: 'star' };
    yield { f: 'stand', t: 300 };
  } },
  windHunker: { cat: 'env', w: 1, asleep: true, wakes: false, stay: true, *fn(d) {
    const p = postureOf(d.frame);
    for (let i = 0; i < 3; i++) {
      if (p === 'lie') { yield { f: 'lie', t: 800, fx: i === 1 ? 'z' : null }; yield { f: 'lieBreath', t: 700 }; }
      else if (p === 'sit') { yield { f: 'sitBlink', t: 800, fx: i === 1 ? 'dots' : null }; yield { f: 'sit', t: 500 }; }
      else { yield { f: 'cower', t: 800 }; yield { f: 'hunch', t: 500 }; }
    }
  } },
  windEnjoy: { cat: 'env', w: 1, *fn(d) {
    yield { f: 'stand', t: 300, face: -d.windDir() };
    yield { f: 'armsUp', t: 900, fx: 'note' };
    yield { f: 'stand', t: 600 };
    yield { f: 'armsUp', t: 800 };
    yield { f: 'blink', t: 300, fx: 'heart' };
  } },
  birdHead: { cat: 'env', w: 1, stay: true, *fn(d) {
    // A bird lands on its head. It holds very still… until it has to sneeze.
    const s = d.sitting();
    yield { f: s ? 'sit' : 'stand', t: 900 };
    yield { f: s ? 'sitUp' : 'up', t: 700, fx: 'heart' };
    yield { f: s ? 'sitBlink' : 'blink', t: 600, fx: 'note' };
    yield { f: s ? 'sit' : 'stand', t: 800, fx: 'note' };
    yield { f: s ? 'sitChew' : 'yawn', t: 300 };
    yield { f: s ? 'sitBlink' : 'crouch', t: 200, fx: 'puff', do: (c) => c.birdOff() };
    yield { f: s ? 'sitUp' : 'up', t: 600, fx: '?' };
  } },
  birdSleep: { cat: 'env', w: 1, asleep: true, wakes: false, stay: true, *fn() {
    yield { f: 'lie', t: 900, fx: 'note' };
    yield { f: 'lieBreath', t: 900 };
    yield { f: 'lie', t: 900, fx: 'z' };
    yield { f: 'lieBreath', t: 700, fx: 'note' };
    yield { f: 'lie', t: 600, do: (c) => c.birdOff() };
  } },
  birdTree: { cat: 'env', w: 1, *fn(d) {
    const bird = d.find('bird');
    yield { f: 'up', t: 800, face: bird ? d.dirTo(bird) : d.face, fx: '?' };
    yield { f: 'up', t: 700, fx: 'note' };
    yield { f: 'armsUp', t: 500 };
    yield { f: 'crouch', t: 120 };
    yield { f: 'jump', t: 380, jump: 6, do: (c) => c.birdOff() };
    yield { f: 'stand', t: 400, fx: 'dots' };
  } },
  tumbleJump: { cat: 'env', w: 1, *fn(d) {
    // Waits for the tumbleweed and hops clean over it.
    const tw = d.find('tumbleweed');
    for (let i = 0; i < 14 && tw && d.has(tw) && d.gap(tw) > 22; i++) yield { f: 'up', t: 150, face: d.dirTo(tw) };
    yield { f: 'crouch', t: 120 };
    yield { f: 'jump', t: 520, jump: 10, fx: '!' };
    yield { f: 'crouch', t: 150 };
    yield { f: 'stand', t: 400, fx: 'star', face: tw ? -d.face : d.face };
  } },
  tumbleBowled: { cat: 'env', w: 1, *fn(d) {
    // Doesn't see it coming.
    const tw = d.find('tumbleweed');
    for (let i = 0; i < 16 && tw && d.has(tw) && d.gap(tw) > 6; i++) yield { f: 'stand', t: 150 };
    yield { f: 'fallen', t: 900, fx: 'star', do: () => { if (tw) tw.bump = 1; } };
    yield { f: 'sit', t: 300 };
    yield { f: 'stand', t: 400, fx: '?' };
  } },
  tumbleChase: { cat: 'env', w: 1, *fn(d) {
    const tw = d.find('tumbleweed');
    for (let i = 0; i < 14 && tw && d.has(tw) && d.gap(tw) > 10; i++) yield { f: 'up', t: 150, face: d.dirTo(tw) };
    yield { f: 'up', t: 300, fx: '!' };
    if (tw) yield* d.walkTo(() => (d.has(tw) ? d.reach(tw) : null), 2.6, { max: 22 });
    yield { f: 'up', t: 500, fx: '?' };
    yield { f: 'stand', t: 300 };
  } },
  tumbleWatch: { cat: 'env', w: 1, stay: true, *fn(d) {
    const tw = d.find('tumbleweed'), s = d.sitting();
    for (let i = 0; i < 12 && tw && d.has(tw); i++) yield { f: s ? 'sitUp' : 'up', t: 300, face: d.dirTo(tw) };
    yield { f: s ? 'sit' : 'stand', t: 300, fx: '?' };
  } },
  wish: { cat: 'env', w: 1, stay: true, *fn(d) {
    // A shooting star: a wish, eyes shut tight.
    yield { f: sitOr(d, 'sitUp', 'up'), t: 500, fx: '!' };
    yield* d.getTo('sit');
    yield { f: 'sitBlink', t: 1200, fx: 'heart' };
    yield { f: 'sitUp', t: 600, fx: 'star' };
    yield { f: 'sit', t: 300 };
  } },
  plantNotice: { cat: 'env', w: 1, stay: true, lying: true, *fn(d) {
    // Something new has come up: a look at it from where it is, in its own good time.
    const p = d.props.find((q) => q.wild && q.noticed && !q.visited), face = p ? d.dirTo(p) : d.face, pose = postureOf(d.frame);
    const fx = d.pick({ '!': 1, '?': 1.4, heart: 0.4 });
    if (pose === 'lie') { yield { f: 'lieUp', t: 700, face, fx }; yield { f: 'lieUpBlink', t: 200 }; yield { f: 'lieUp', t: 500 }; }
    else if (pose === 'sit') { yield { f: 'sitUp', t: 800, face, fx }; yield { f: 'sitBlink', t: 200 }; }
    else { yield { f: 'up', t: 700, face, fx }; yield { f: d.chance(0.5) ? 'hunch' : 'blink', t: 400 }; yield { f: 'stand', t: 300 }; }
  } },
  rainbowLook: { cat: 'env', w: 1, *fn(d) {
    yield { f: 'up', t: 900, fx: '!' };
    yield { f: 'armsUp', t: 600, fx: 'heart' };
    yield { f: 'up', t: 900 };
    yield* d.getTo('sit');
    yield { f: 'sitUp', t: 1200 };
    yield { f: 'sit', t: 400 };
  } },
};

export const CATEGORY = {
  subtle: (a) => Math.max(0.15, 1.6 - 0.35 * a),
  normal: () => 1,
  big: (a) => 0.25 + 0.3 * a,
  absurd: (a) => 0.18 + 0.22 * a,
  none: (a) => (a <= 1 ? 0.45 : 0.08),
  context: () => 1,
  escalate: () => 0,
  asleep: () => 0,
  env: () => 0,
};

// Moods drift every several minutes and tilt the odds.
export const MOODS = {
  content: { act: {}, react: {} },
  playful: { act: { balloon: 1.6, frog: 1.8, worm: 1.6, fetch: 2.5, hop: 1.6, dance: 1.5, juggle: 2, peekaboo: 1.6, butterfly: 1.4, zoomies: 2, pounce: 2, bubbles: 1.6, pebbleToss: 1.5, somersault: 1.5, wag: 1.5 }, react: { normal: 1.3, absurd: 1.3, big: 1.2 } },
  curious: { act: { explore: 2.2, visitPlant: 2, ladybug: 2, dandelion: 1.8, paperPlane: 1.6, inspect: 2.5, look: 1.5, leaf: 2, butterfly: 2, dig: 1.8, patrol: 1.5, readScript: 1.8, sandcastle: 1.5, ponder: 1.8, watchWriter: 1.5 }, react: { subtle: 1.4, context: 1.3 } },
  sleepy: { act: { explore: 0.4, daydream: 2, rest: 1.8, sleep: 2, stretch: 1.5, stargaze: 1.4, doze: 2.5, sunbathe: 1.6, coffeeBreak: 1.5, yoga: 1.4, dance: 0.4, hop: 0.4, zoomies: 0.2 }, react: { none: 2, subtle: 1.3, big: 0.6 } },
  grumpy: { act: { roar: 2.5, look: 1.3, dance: 0.3, rest: 1.2, scratch: 1.5, wag: 0.3, sing: 0.4 }, react: { normal: 1.2, none: 1.6, big: 0.8 } },
  silly: { act: { trip: 2.5, moonwalk: 2, chaseTail: 2, flamingo: 2.5, hiccups: 2, shadowbox: 2, headstand: 2.5, somersault: 2, roll: 2, sing: 1.6 }, react: { absurd: 2, big: 1.4 } },
};

/** The audit baseline: what 0.8.0 had (activities + click reactions + the cursor glance). */
export const BASELINE_0_8 = 28 + 33 + 1;
