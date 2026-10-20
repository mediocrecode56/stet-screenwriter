// A tiny pixel-art dinosaur that lives on the edge of the desk, above TODAY.
//
// Two parts:
//  * Critter — the behaviour engine. Pure logic (no DOM), so its whole life
//    can be simulated in tests: activities, props, moods, reactions to clicks
//    and to the cursor, and how lively it is.
//  * Dino — draws the critter on one canvas laid over the bottom of the desk
//    (it takes no room in the layout and no clicks except on the dinosaur
//    itself) and feeds it time, clicks, the cursor and the writer's words. It
//    redraws only when the picture changes, ~11 times a second at most while
//    something moves, and not at all while the window is hidden.
//
// The play area is a generous stretch of the desk centred on TODAY (up to
// 560 px), with an invisible margin around it where props, glyphs and visitors
// can still be drawn, so nothing is ever cut off by the canvas edge. The
// dinosaur prefers the middle of it and only now and then strolls out towards
// the ends. It never walks out of sight.
//
// Behaviour is a sequence of activities (walking about, resting, playing with a
// ball, digging up a bone, watching a leaf fall, typing along while you write,
// and some rarer, odder ones). Each activity is a generator yielding short
// steps (≤ 1.5 s), so a click's reaction is slotted in at the next step
// boundary: the current motion always finishes, the dinosaur gets up first if
// it was sitting or lying, reacts, and then carries on with what it was doing.
// Nothing is ever cut off mid-move. Responsiveness doesn't come from speeding
// anything up: a click is acknowledged on the spot (a blink and a little
// start, drawn over whatever it is doing), and a pose that is merely being
// held (sitting, standing, looking) is simply held a little shorter so the
// reaction or a glance at the cursor can begin at once. Moves, jumps and
// walking steps always finish.
//
// How lively it is follows the words you actually write, smoothed over minutes
// so it warms up and calms down gradually. Time passing alone never makes it
// busier, and it never nags: an idle writer just gets a dinosaur having a nap.
// A slowly drifting mood (playful, curious, sleepy, grumpy, silly…) and a
// memory of what it did recently keep it from feeling mechanical.

// ---- pixel art (facing right; '#' ink, 'o' eye hole, '.' empty) ------------------------

const W = 18, H = 14;
const HEAD = {
  open: [
    '...........######.',
    '..........##o#####',
    '..........########',
    '..........####....',
    '..........######..',
  ],
  blink: [
    '...........######.',
    '..........########',
    '..........########',
    '..........####....',
    '..........######..',
  ],
  roar: [
    '...........######.',
    '..........##o#####',
    '..........#####...',
    '..........###.....',
    '..........#####...',
  ],
  up: [
    '............#####.',
    '...........##o###.',
    '..........#######.',
    '..........#####...',
    '..........####....',
  ],
};
const BODY = [
  '#........#####....',
  '#.......######....',
  '##.....#########..',
  '###...########.#..',
  '.############.....',
  '..##########......',
  '...########.......',
];
const BODY_ARMS_UP = [
  '#........#####.#..',
  '#.......#######...',
  '##.....#######....',
  '###...########....',
  '.############.....',
  '..##########......',
  '...########.......',
];
const LEGS = {
  stand: ['....##...##.......', '....###..###......'],
  walk1: ['...##.....##......', '...###....###.....'],
  walk2: ['......##.##.......', '......#####.......'],
  tuck: ['.....######.......', '..................'],
  kick: ['....##.....###....', '....###.......##..'],
  oneLeg: ['......##..........', '......###.........'],
};
const SIT_BOTTOM = ['..############....', '.##############...'];
const LIE = [
  '..................',
  '..................',
  '..................',
  '..................',
  '..................',
  '..................',
  '..................',
  '...........######.',
  '..........########',
  '#.....############',
  '###########.......',
  '.##############...',
  '..############....',
  '..................',
];
const FALLEN = [
  '..................',
  '..................',
  '..................',
  '..................',
  '..................',
  '..................',
  '..................',
  '...#..#...........',
  '...#..#...........',
  '..##########......',
  '#############.###.',
  '.#############o##.',
  '..########...####.',
  '..................',
];

function compose(head, body, legs) { return [...HEAD[head], ...body, ...legs]; }
function sit(head) { return ['..................', '..................', ...HEAD[head], ...BODY.slice(0, 5), ...SIT_BOTTOM].slice(0, H); }
/** Head lowered by `dy` rows onto the standing body (sniffing, digging, bowing). */
function headDown(head, dy) {
  const base = ['..................', '..................', '..................', '..................', '..................', ...BODY, ...LEGS.stand];
  return base.map((row, r) => {
    const h = HEAD[head][r - dy];
    if (!h) return row;
    let out = '';
    for (let i = 0; i < W; i++) out += h[i] !== '.' ? h[i] : row[i];
    return out;
  });
}
const withRow = (rows, i, row) => rows.map((r, k) => (k === i ? row : r));
// Tall and long: head pushed up and forward, arms up, legs straight.
const STRETCH = [
  '.............#####',
  '............##o###',
  '...........#######',
  '...........#####..',
  '..........#####...',
  '#........#####.#..',
  '##......######.#..',
  '###....#######....',
  '.############.....',
  '..##########......',
  '...########.......',
  '....#.....#.......',
  '....#.....#.......',
  '....##....##......',
];

const FRAMES = {
  stand: compose('open', BODY, LEGS.stand),
  blink: compose('blink', BODY, LEGS.stand),
  walk1: compose('open', BODY, LEGS.walk1),
  walk2: compose('open', BODY, LEGS.walk2),
  roar: compose('roar', BODY, LEGS.stand),
  yawn: compose('roar', BODY, LEGS.stand).map((r) => r.replace('o', '#')),
  up: compose('up', BODY, LEGS.stand),
  armsUp: compose('open', BODY_ARMS_UP, LEGS.stand),
  crouch: ['..................', ...compose('open', BODY, LEGS.tuck)].slice(0, H),
  jump: compose('open', BODY, LEGS.tuck),
  kick: compose('open', BODY, LEGS.kick),
  oneLeg: compose('open', BODY_ARMS_UP, LEGS.oneLeg),
  sniff: headDown('open', 4),
  sniffBlink: headDown('blink', 4),
  stretch: STRETCH,
  sit: sit('open'),
  sitBlink: sit('blink'),
  sitBreath: sit('open').map((r, i) => (i === 8 ? '#.......#######....'.slice(0, W) : r)),
  sitUp: sit('up'),
  sitChew: sit('roar'),
  sitTap1: sit('open'),
  sitTap2: withRow(withRow(sit('open'), 10, '###...########....'), 11, '.############.#...'),
  lie: LIE,
  lieBreath: LIE.map((r, i) => (i === 10 ? '############......' : r)),
  fallen: FALLEN,
};
// Postures, so a reaction can get up first and the activity can sit back down after.
const POSTURE = { sit: 'sit', sitBlink: 'sit', sitBreath: 'sit', sitUp: 'sit', sitChew: 'sit', sitTap1: 'sit', sitTap2: 'sit', lie: 'lie', lieBreath: 'lie', fallen: 'lie' };
const postureOf = (f) => POSTURE[f] || 'stand';
// Where the mouth and the top of the head are (col, row) — for carried props and hats.
const MOUTH = { stand: [16, 3], up: [16, 2], sniff: [16, 7], sniffBlink: [16, 7], crouch: [16, 4], jump: [16, 3], sit: [16, 5], sitUp: [16, 4], sitChew: [16, 5], sitBlink: [16, 5], sitBreath: [16, 5], sitTap1: [16, 5], sitTap2: [16, 5], roar: [16, 3], yawn: [16, 3], stretch: [17, 3], lie: [17, 10], lieBreath: [17, 10] };
const HEAD_TOP = { stand: [14, 0], blink: [14, 0], walk1: [14, 0], walk2: [14, 0], roar: [14, 0], yawn: [14, 0], up: [15, 0], armsUp: [14, 0], kick: [14, 0], oneLeg: [14, 0], jump: [14, 0], crouch: [14, 1], sniff: [14, 4], sniffBlink: [14, 4], stretch: [15, 0], sit: [14, 2], sitBlink: [14, 2], sitBreath: [14, 2], sitUp: [15, 2], sitChew: [14, 2], sitTap1: [14, 2], sitTap2: [14, 2], lie: [14, 7], lieBreath: [14, 7] };

// Props and accessories (same pixel scale as the dinosaur).
const PROPS = {
  ball: [['.##.', '#.##', '####', '.##.'], ['.##.', '##.#', '####', '.##.'], ['.##.', '####', '##.#', '.##.'], ['.##.', '####', '#.##', '.##.']],
  bone: [['#....#', '######', '#....#']],
  leaf: [['..##', '.###', '###.', '#...'], ['##..', '###.', '.###', '...#']],
  butterfly: [['#.#', '###', '#.#'], ['.#.', '.#.', '.#.']],
  egg: [['.##.', '####', '####', '####', '.##.'], ['.##.', '#.##', '##.#', '####', '.##.']],
  shell: [['#..#', '####']],
  baby: [['....##.', '...###o', '#.####.', '.####..', '.#..#..'], ['....##.', '...###o', '#.####.', '.####..', '..##...']],
  ufo: [['...###...', '.#######.', '#########', '.#.#.#.#.']],
  typewriter: [['..###..', '..#.#..', '#######', '#.#.#.#', '#######']],
  party: [['..#..', '.###.', '#####']],
  pebble: [['.##', '###']],
};
// 3×5 pixel glyphs for little effects above the head.
const GLYPHS = {
  z: ['###', '..#', '.#.', '#..', '###'],
  '!': ['.#.', '.#.', '.#.', '...', '.#.'],
  '?': ['##.', '..#', '.#.', '...', '.#.'],
  note: ['.##', '.#.', '.#.', '##.', '##.'],
  dots: ['...', '...', '...', '...', '#.#'],
  star: ['...', '.#.', '###', '.#.', '...'],
  heart: ['#.#', '###', '###', '.#.', '...'],
  puff: ['.#.', '#.#', '.#.', '...', '...'],
  hash: ['#.#', '###', '#.#', '###', '#.#'],
  drop: ['.#.', '.#.', '###', '###', '.#.'],
};

// ---- activities ----------------------------------------------------------------------------
//
// Step: { f: frame, t: ms, dx?: px moved, jump?: arc height, lift?: [y0, y1] height,
//         face?: ±1, fx?: glyph, flip?: upside down,
//         do?: (critter) => void, run at the start of the step }

const ACTIVITIES = {
  *rest(d) {
    yield* d.getTo('sit');
    const n = d.rint(6, 14);
    for (let i = 0; i < n; i++) {
      yield { f: 'sit', t: d.rnd(450, 700) };
      yield { f: 'sitBreath', t: d.rnd(450, 650) };
      if (d.chance(0.25)) yield { f: 'sitBlink', t: 140 };
      if (d.chance(0.12)) yield { f: 'sit', t: 400, face: -d.face };
    }
  },
  *sleep(d) {
    yield* d.getTo('sit');
    yield { f: 'sitBlink', t: 500 };
    yield { f: 'lie', t: 500 };
    const n = d.rint(12, 30);
    for (let i = 0; i < n; i++) {
      yield { f: 'lie', t: 600, fx: i % 3 === 0 ? 'z' : null };
      yield { f: 'lieBreath', t: 600 };
    }
    yield { f: 'lie', t: 400 };
    yield { f: 'sitBlink', t: 300 };
    yield { f: 'sit', t: 400 };
  },
  *look(d) {
    yield* d.getTo('stand');
    const n = d.rint(2, 4);
    for (let i = 0; i < n; i++) {
      yield { f: 'stand', t: d.rnd(500, 900) };
      if (d.chance(0.4)) yield { f: 'blink', t: 130 };
      yield { f: d.chance(0.3) ? 'up' : 'stand', t: d.rnd(400, 700), face: -d.face };
    }
    yield { f: 'stand', t: 400 };
  },
  *walk(d) {
    // Somewhere worth walking to: a fair way off, usually in the middle stretch.
    let target = d.spot();
    for (let i = 0; i < 4 && Math.abs(target - d.x) < d.maxX / 4; i++) target = d.spot();
    yield* d.walkTo(target, 1, { pauses: true });
    yield { f: 'stand', t: 300 };
  },
  *stretch(d) {
    yield* d.getTo('stand');
    yield { f: 'crouch', t: 300 };
    yield { f: 'stretch', t: 900 };
    yield { f: 'armsUp', t: 500 };
    yield { f: 'stand', t: 200 };
    if (d.chance(0.5)) { yield { f: 'yawn', t: 700 }; yield { f: 'blink', t: 200 }; }
    yield { f: 'stand', t: 300 };
  },
  *hop(d) {
    yield* d.getTo('stand');
    const n = d.rint(2, 4);
    const dir = d.inward() || (d.chance(0.5) ? 1 : -1);
    yield { f: 'stand', t: 120, face: dir };
    for (let i = 0; i < n; i++) {
      yield { f: 'crouch', t: 110 };
      yield { f: 'jump', t: 360, jump: 4 + 3 * d.energy, dx: 6 * dir };
    }
    yield { f: 'crouch', t: 120 };
    yield { f: 'stand', t: 300 };
  },
  *dance(d) {
    yield* d.getTo('stand');
    const n = d.rint(6, 10);
    for (let i = 0; i < n; i++) {
      yield { f: i % 2 ? 'walk1' : 'walk2', t: 220, fx: i % 4 === 0 ? 'note' : null };
      if (i % 3 === 2) yield { f: 'armsUp', t: 220, face: -d.face };
    }
    yield { f: 'stand', t: 300 };
  },
  *trip(d) {
    yield* d.getTo('stand');
    const dir = d.x > d.maxX / 2 ? -1 : 1;
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
    const dir = d.x > d.maxX / 2 ? -1 : 1;
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
    yield { f: 'crouch', t: 160, dx: -2 * d.face, fx: 'puff' };
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
    const fromLeft = d.x > d.maxX / 2;
    const ball = d.spawn('ball', { x: fromLeft ? 0 : d.stripW - 4 * d.u, vx: (fromLeft ? 1 : -1) * d.rnd(40, 70) });
    yield { f: 'stand', t: 500 };
    yield { f: 'up', t: 400, face: Math.sign(ball.x - d.x) || 1, fx: '!' };
    const kicks = d.rint(2, 5);
    for (let i = 0; i < kicks && d.has(ball); i++) {
      yield* d.walkTo(() => d.reach(ball), 1.5, { max: 60 });
      if (!d.has(ball) || Math.abs(d.reach(ball) - d.x) > 4) break;
      yield { f: 'stand', t: 160, face: Math.sign(ball.x - d.x) || d.face };
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
    while (d.has(leaf) && leaf.y > 12) yield { f: 'up', t: 300, face: Math.sign(leaf.x - d.x - 7 * d.u) || d.face };
    const plan = d.pick([['catch', 3], ['head', 2], ['watch', 2]]);
    if (plan === 'catch') {
      yield* d.walkTo(() => d.clampX(leaf.x - 8 * d.u), 2, { max: 10 });
      yield { f: 'crouch', t: 100 };
      yield { f: 'jump', t: 380, jump: 6, do: (c) => { c.remove(leaf); c.wear('leaf', 20000); } };
      yield { f: 'stand', t: 300 };
      yield { f: 'armsUp', t: 500, fx: 'star' };
      yield { f: 'stand', t: 600 };
    } else if (plan === 'head') {
      yield* d.walkTo(() => d.clampX(leaf.x - 8 * d.u), 1.5, { max: 10 });
      yield* d.watch(leaf, 3000, 'up');
      yield { f: 'up', t: 300, do: (c) => { c.remove(leaf); c.wear('leaf', 3000); } };
      yield { f: 'yawn', t: 300 };
      yield { f: 'crouch', t: 160, fx: 'puff', do: (c) => { c.unwear(); c.spawn('leaf', { x: c.clampProp(c.x + c.face * 14 * c.u), y: 10, fall: true, life: 12000 }); } };
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
    const b = d.spawn('butterfly', { x: left ? -4 : d.stripW, y: 12, vx: left ? 14 : -14, life: 16000 });
    for (let i = 0; i < 6 && d.has(b); i++) yield { f: d.chance(0.5) ? 'up' : 'stand', t: 400, face: Math.sign(b.x - d.x) || d.face };
    const tries = d.rint(1, 3);
    for (let i = 0; i < tries && d.has(b); i++) {
      yield* d.walkTo(() => d.clampX(b.x - 8 * d.u), 2, { max: 12 });
      yield { f: 'crouch', t: 100 };
      yield { f: 'jump', t: 360, jump: 7, do: (c) => { b.vy = 18; b.vx = (c.chance(0.5) ? 1 : -1) * 20; } };
      yield { f: 'stand', t: 300, fx: i === tries - 1 ? 'dots' : null };
    }
    if (d.has(b) && d.chance(0.35)) {
      // It lands on the dinosaur's nose. Hold still…
      yield { f: 'stand', t: 300, do: (c) => { c.remove(b); c.wear('butterfly', 4000); } };
      yield { f: 'blink', t: 800, fx: 'heart' };
      yield { f: 'stand', t: 1200 };
      yield { f: 'stand', t: 900, do: (c) => { c.unwear(); c.spawn('butterfly', { x: c.x + 14 * c.u, y: 14, vx: 16 * c.face, vy: 10, life: 4000 }); } };
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
    const what = d.pick([['nudge', 2], ['carry', p.kind === 'ball' ? 0 : 2], ['kick', p.kind === 'ball' ? 3 : 0], ['leave', 1]]);
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
  *writeAlong(d) {
    // Typing along on a tiny typewriter while you write.
    yield* d.getTo('stand');
    const room = d.face > 0 ? d.maxX - d.x : d.x;
    if (room < 10 * d.u) yield { f: 'stand', t: 200, face: -d.face };
    yield* d.getTo('sit');
    const tw = d.spawn('typewriter', { x: d.clampProp(d.x + (d.face > 0 ? 15 : -5) * d.u), y: 0 });
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
  *juggle(d) {
    yield* d.getTo('stand');
    const ball = d.spawn('ball', { balance: true });
    yield { f: 'up', t: 300, fx: '!' };
    const n = d.rint(6, 14);
    for (let i = 0; i < n; i++) yield { f: 'up', t: 260, dx: d.chance(0.5) ? d.rnd(-1.5, 1.5) : 0 };
    if (d.chance(0.35)) {
      yield { f: 'up', t: 200, do: (c) => { ball.balance = false; ball.y = 6; ball.vy = -5; ball.vx = 0; } };
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

  // -- little routines --
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
    for (let i = 0; i < n; i++) yield { f: 'oneLeg', t: d.rnd(400, 800), dx: d.chance(0.5) ? (d.chance(0.5) ? 1 : -1) : 0 };
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
      yield { f: i % 2 ? 'sniffBlink' : 'sniff', t: 260, dx: 1.5 * dir };
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
    for (let i = 0; i < n; i++) yield { f: i % 2 ? 'armsUp' : 'stand', t: 140, dx: i % 4 < 2 ? 1.5 : -1.5, fx: i === 4 ? 'star' : null };
    yield { f: 'stand', t: 300, fx: 'drop' };
  },
  *patrol(d) {
    // A longer stroll: to one end, a look around, to the other end, a proud pause.
    // The ends of the play area are an occasional excursion, not a habit.
    yield* d.walkTo(d.maxX * (d.x < d.maxX / 2 ? 0.06 : 0.94), 1);
    yield { f: 'up', t: 700 };
    yield { f: 'stand', t: 500, face: -d.face };
    yield* d.walkTo(d.maxX * (d.face > 0 ? 0.94 : 0.06), 1, { pauses: true });
    yield { f: 'up', t: 600 };
    yield { f: 'armsUp', t: 500, fx: 'star' };
    yield { f: 'stand', t: 400 };
  },
  *stargaze(d) {
    yield* d.getTo('sit');
    const n = d.rint(6, 12);
    for (let i = 0; i < n; i++) {
      yield { f: 'sitUp', t: d.rnd(700, 1200), fx: d.chance(0.3) ? 'star' : null };
      if (d.chance(0.2)) yield { f: 'sitBlink', t: 150 };
    }
    yield { f: 'sit', t: 500 };
  },
  *celebrate(d) {
    // Today's goal was just reached.
    yield* d.getTo('stand');
    yield { f: 'up', t: 300, fx: '!' };
    for (let i = 0; i < 2; i++) { yield { f: 'crouch', t: 110 }; yield { f: 'jump', t: 380, jump: 8, fx: i ? 'heart' : 'star' }; }
    for (let i = 0; i < 6; i++) yield { f: i % 2 ? 'armsUp' : 'walk2', t: 200, fx: i === 2 ? 'note' : null };
    yield { f: 'stand', t: 400 };
  },

  // -- rare surprises --
  *egg(d) {
    yield* d.getTo('stand');
    const x = d.clampProp(d.x + (d.x < d.maxX / 2 ? 1 : -1) * d.rnd(30, 60));
    const egg = d.spawn('egg', { x, y: 20, gravity: true });
    yield { f: 'stand', t: 700 };
    yield { f: 'up', t: 500, fx: '!', face: Math.sign(egg.x - d.x) || d.face };
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
      const dir = egg.x > c.stripW / 2 ? -1 : 1; // toddles off towards the middle, then blinks away
      c.spawn('baby', { x: egg.x, vx: 9 * dir, hops: true, face: dir, life: 7000 });
    } };
    yield { f: 'sitUp', t: 800, fx: 'heart' };
    yield* d.getTo('stand');
    for (let i = 0; i < 3; i++) { yield { f: 'armsUp', t: 300 }; yield { f: 'stand', t: 300 }; }
    yield { f: 'stand', t: 800, fx: 'heart' };
  },
  *ufo(d) {
    yield* d.getTo('stand');
    const ufo = d.spawn('ufo', { x: d.x < d.maxX / 2 ? d.stripW : -12 * d.u, y: 24, tx: d.x + 4 * d.u });
    yield { f: 'stand', t: 1200 };
    yield { f: 'up', t: 800, fx: '!', face: Math.sign(ufo.x - d.x) || d.face };
    yield { f: 'up', t: 600, do: () => { ufo.beam = true; } };
    yield { f: 'armsUp', t: 700, lift: [0, 4] };
    yield { f: 'jump', t: 600, lift: [4, 7], face: -d.face };
    yield { f: 'jump', t: 500, lift: [7, 7], face: -d.face, flip: true };
    yield { f: 'jump', t: 500, lift: [7, 6], face: -d.face };
    yield { f: 'armsUp', t: 600, lift: [6, 2], do: () => { ufo.beam = false; } };
    yield { f: 'jump', t: 200, lift: [2, 0] };
    yield { f: 'fallen', t: 1000, fx: 'star', do: (c) => { ufo.tx = ufo.x + (ufo.x < c.stripW / 2 ? -1 : 1) * 30; ufo.leaving = true; c.expire(ufo, 1600); } };
    yield { f: 'sit', t: 500 };
    yield { f: 'stand', t: 400 };
    yield { f: 'up', t: 900, fx: '?' };
    yield { f: 'stand', t: 600, face: -d.face, fx: 'dots' };
  },
};
const GET_UP = new Set(['crouch', 'sniff', 'sniffBlink']);
// Poses that are merely held: one of these can be cut short (never a move, a jump or a lift).
const HOLD = new Set(['stand', 'blink', 'up', 'sit', 'sitBlink', 'sitBreath', 'sitUp', 'armsUp', 'yawn', 'oneLeg']);
const isHold = (s) => HOLD.has(s.f) && !s.dx && !s.jump && !s.lift && !s.flip;
// Activities during which the dinosaur may turn to look at a nearby cursor.
const ATTENTIVE = new Set(['rest', 'look', 'stretch', 'stargaze', 'hiccups', 'sneeze', 'roar']);

// ---- reactions to a click --------------------------------------------------------------------
//
// cat: subtle | normal | big | absurd | none | escalate | asleep.  w: base weight.
// cool: minimum ms between two uses (rare jokes stay rare). delay: [min, max]
// ms before it happens. asleep: usable on a sleeping dinosaur; wakes: false
// keeps it asleep. stay: don't get up first (it reacts in its current posture).

const REACTIONS = {
  // subtle — an acknowledgement
  ack: { cat: 'subtle', w: 1.2, stay: true, *fn(d) { yield { f: d.sitting() ? 'sitBlink' : 'blink', t: 160, face: d.towardCursor() }; yield { f: d.sitting() ? 'sit' : 'stand', t: 400 }; } },
  lookUp: { cat: 'subtle', w: 1, *fn(d) { yield { f: 'up', t: 700, face: d.towardCursor() }; yield { f: 'blink', t: 150 }; } },
  wave: { cat: 'subtle', w: 1, *fn(d) { yield { f: 'stand', t: 120, face: d.towardCursor() }; for (let i = 0; i < 2; i++) { yield { f: 'armsUp', t: 220 }; yield { f: 'stand', t: 180 }; } } },
  tilt: { cat: 'subtle', w: 0.9, stay: true, *fn(d) { yield { f: d.sitting() ? 'sitUp' : 'up', t: 600, fx: '?' }; yield { f: d.sitting() ? 'sit' : 'stand', t: 300 }; } },
  nod: { cat: 'subtle', w: 0.8, *fn(d) { for (let i = 0; i < 2; i++) { yield { f: 'sniff', t: 160 }; yield { f: 'stand', t: 180 }; } } },
  // normal
  startle: { cat: 'normal', w: 1, asleep: true, *fn(d) { yield { f: 'crouch', t: 80 }; yield { f: 'jump', t: 420, jump: 8, fx: '!' }; yield { f: 'crouch', t: 120 }; yield { f: 'stand', t: 300 }; yield { f: 'blink', t: 150 }; } },
  love: { cat: 'normal', w: 1, *fn(d) { yield { f: 'crouch', t: 100, face: d.towardCursor() }; yield { f: 'jump', t: 360, jump: 4, fx: 'heart' }; yield { f: 'stand', t: 400 }; } },
  spin: { cat: 'normal', w: 0.9, *fn(d) { for (let i = 0; i < 6; i++) yield { f: i % 2 ? 'walk1' : 'walk2', t: 110, face: -d.face }; yield { f: 'stand', t: 500, fx: 'star' }; } },
  confused: { cat: 'normal', w: 0.9, asleep: true, *fn(d) { yield { f: 'stand', t: 300, fx: '?' }; yield { f: 'stand', t: 300, face: -d.face }; yield { f: 'stand', t: 300, face: -d.face }; yield { f: 'blink', t: 150 }; } },
  roarBack: { cat: 'normal', w: 0.8, *fn(d) { yield { f: 'up', t: 200, face: d.towardCursor() }; yield { f: 'roar', t: 600, fx: '!' }; yield { f: 'roar', t: 300 }; yield { f: 'stand', t: 300 }; } },
  boogie: { cat: 'normal', w: 0.8, *fn(d) { for (let i = 0; i < 6; i++) yield { f: i % 2 ? 'armsUp' : 'walk2', t: 180, fx: i === 0 ? 'note' : null }; yield { f: 'stand', t: 250 }; } },
  hopAway: { cat: 'normal', w: 0.8, *fn(d) { const dir = -d.towardCursor(); yield { f: 'crouch', t: 90, face: dir }; yield { f: 'jump', t: 380, jump: 6, dx: 10 * dir, fx: '!' }; yield { f: 'stand', t: 300, face: -dir }; } },
  giggle: { cat: 'normal', w: 0.8, *fn(d) { for (let i = 0; i < 3; i++) { yield { f: 'crouch', t: 120 }; yield { f: 'stand', t: 120, fx: i === 1 ? 'note' : null }; } yield { f: 'blink', t: 200 }; } },
  shy: { cat: 'normal', w: 0.6, *fn(d) { yield { f: 'stand', t: 200, face: -d.towardCursor() }; yield { f: 'sniffBlink', t: 900, fx: 'heart' }; yield { f: 'stand', t: 300, face: d.towardCursor() }; } },
  // big — exaggerated
  faint: { cat: 'big', w: 0.8, *fn(d) { yield { f: 'up', t: 250 }; yield { f: 'armsUp', t: 250, fx: '!' }; yield { f: 'fallen', t: 1400 }; yield { f: 'fallen', t: 500, fx: 'star' }; yield { f: 'sit', t: 350 }; yield { f: 'stand', t: 300 }; } },
  flatten: { cat: 'big', w: 0.7, *fn(d) { yield { f: 'crouch', t: 120 }; yield { f: 'lie', t: 900 }; yield { f: 'lie', t: 400, fx: '?' }; yield { f: 'sit', t: 250 }; yield { f: 'stand', t: 250 }; } },
  backflip: { cat: 'big', w: 0.7, cool: 30000, *fn(d) {
    yield { f: 'crouch', t: 140 };
    yield { f: 'jump', t: 200, lift: [0, 7] };
    yield { f: 'jump', t: 170, lift: [7, 9], flip: true };
    yield { f: 'jump', t: 170, lift: [9, 6], flip: true };
    yield { f: 'jump', t: 200, lift: [6, 0] };
    yield { f: 'crouch', t: 150 };
    yield { f: 'armsUp', t: 500, fx: 'star' };
    yield { f: 'stand', t: 250 };
  } },
  bigJump: { cat: 'big', w: 0.7, *fn(d) { yield { f: 'crouch', t: 200 }; yield { f: 'jump', t: 600, jump: 13, fx: '!' }; yield { f: 'crouch', t: 160 }; yield { f: 'stand', t: 300, fx: 'star' }; } },
  runAway: { cat: 'big', w: 0.5, cool: 60000, *fn(d) {
    // Bolts off towards the roomier side, sulks with its back turned, then peeks round.
    const dir = d.x < d.maxX / 2 ? 1 : -1;
    const start = d.x;
    yield { f: 'stand', t: 150, face: dir, fx: '!' };
    yield* d.walkTo(d.x + dir * Math.min(140, d.maxX * 0.45), 3);
    yield* d.getTo('sit');
    yield { f: 'sit', t: d.rnd(600, 1000), fx: 'dots' };
    yield { f: 'sitUp', t: 500, face: -dir, fx: '?' };
    yield { f: 'sitBlink', t: 200 };
    yield* d.walkTo(start, 2.2);
  } },
  // absurd — completely unexpected
  partyHat: { cat: 'absurd', w: 0.6, cool: 120000, *fn(d) { yield { f: 'crouch', t: 150, do: (c) => c.wear('party', 45000) }; yield { f: 'jump', t: 380, jump: 5, fx: 'star' }; yield { f: 'armsUp', t: 400, fx: 'note' }; yield { f: 'stand', t: 300 }; } },
  statue: { cat: 'absurd', w: 0.6, cool: 40000, *fn(d) { yield { f: 'stand', t: 1300 }; yield { f: 'stand', t: 1200, fx: 'dots' }; yield { f: 'blink', t: 250 }; yield { f: 'stand', t: 300, fx: 'heart' }; } },
  playDead: { cat: 'absurd', w: 0.6, cool: 40000, *fn(d) { yield { f: 'armsUp', t: 250, fx: '!' }; yield { f: 'fallen', t: 1500 }; yield { f: 'fallen', t: 800, fx: 'dots' }; yield { f: 'sitBlink', t: 300 }; yield { f: 'lie', t: 400 }; yield { f: 'sit', t: 300 }; yield { f: 'stand', t: 300, fx: '?' }; } },
  pretendSleep: { cat: 'absurd', w: 0.5, cool: 40000, *fn(d) { yield* d.getTo('lie'); for (let i = 0; i < 3; i++) { yield { f: 'lie', t: 450, fx: i === 0 ? 'z' : null }; yield { f: 'lieBreath', t: 450 }; } yield { f: 'sitBlink', t: 250, fx: '!' }; yield* d.getTo('stand'); } },
  bow: { cat: 'absurd', w: 0.5, *fn(d) { yield { f: 'stand', t: 150, face: d.towardCursor() }; yield { f: 'sniff', t: 700 }; yield { f: 'sniffBlink', t: 300 }; yield { f: 'armsUp', t: 400, fx: 'star' }; yield { f: 'stand', t: 200 }; } },
  sneezeLeaf: { cat: 'absurd', w: 0.5, cool: 30000, *fn(d) { yield { f: 'up', t: 300 }; yield { f: 'yawn', t: 300 }; yield { f: 'crouch', t: 160, dx: -2 * d.face, fx: 'puff', do: (c) => c.spawn('leaf', { x: c.clampProp(c.x + c.face * 15 * c.u), y: 9, fall: true, life: 12000 }) }; yield { f: 'stand', t: 600, fx: '?' }; } },
  gift: { cat: 'absurd', w: 0.5, cool: 60000, *fn(d) {
    // Brings you something: a prop that's lying about, or one dug up on the spot.
    let p = d.restingProp();
    if (p) { yield* d.walkTo(() => d.reach(p), 2, { max: 40 }); if (!d.has(p)) return; yield { f: 'sniff', t: 200, do: (c) => c.pickUp(p) }; }
    else { yield { f: 'sniff', t: 300 }; for (let i = 0; i < 4; i++) yield { f: i % 2 ? 'sniff' : 'crouch', t: 130, do: (c) => c.dirt(2) }; yield { f: 'sniff', t: 200, do: (c) => { p = c.spawn('bone', { carried: true }); } }; }
    yield { f: 'up', t: 300 };
    yield* d.walkTo(d.clampX(d.cursorX() - 9 * d.u), 2, { max: 40 });
    yield { f: 'sniff', t: 250, do: (c) => { c.drop(p, 0); c.expire(p, 30000); } };
    yield { f: 'up', t: 600, face: d.towardCursor(), fx: 'heart' };
  } },
  // none — as if nothing happened (sometimes noticed a moment later)
  nothing: { cat: 'none', w: 1, stay: true, *fn() {} },
  noticeLater: { cat: 'none', w: 0.8, stay: true, delay: [1500, 3800], *fn(d) { yield { f: d.sitting() ? 'sitUp' : 'up', t: 600, face: d.towardCursor(), fx: '?' }; yield { f: d.sitting() ? 'sit' : 'stand', t: 300 }; } },
  // escalation — lots of clicks
  annoyed: { cat: 'escalate', w: 1, *fn(d) { for (let i = 0; i < 3; i++) { yield { f: 'crouch', t: 120 }; yield { f: 'stand', t: 140, fx: i === 0 ? 'hash' : null }; } yield { f: 'roar', t: 500 }; yield { f: 'stand', t: 300, face: -d.face }; } },
  dizzy: { cat: 'escalate', w: 1, *fn(d) { for (let i = 0; i < 10; i++) yield { f: i % 2 ? 'walk1' : 'walk2', t: 90, face: -d.face, fx: i === 6 ? 'star' : null }; yield { f: 'fallen', t: 1000, fx: 'star' }; yield { f: 'sit', t: 300 }; yield { f: 'stand', t: 300 }; } },
  storm: { cat: 'escalate', w: 1, *fn(d) { yield { f: 'roar', t: 400, fx: 'hash', face: d.towardCursor() }; const dir = d.x < d.maxX / 2 ? 1 : -1; yield { f: 'stand', t: 150, face: dir }; yield* d.walkTo(d.x + dir * Math.min(150, d.maxX * 0.5), 2.2); yield* d.getTo('sit'); yield { f: 'sit', t: 1200, face: dir, fx: 'dots' }; yield* d.getTo('stand'); } },
  // asleep — clicks on a sleeping dinosaur
  snore: { cat: 'asleep', w: 1, asleep: true, wakes: false, stay: true, *fn() { yield { f: 'lieBreath', t: 500, fx: 'z' }; yield { f: 'lie', t: 400, fx: 'z' }; } },
  grumble: { cat: 'asleep', w: 0.8, asleep: true, wakes: false, stay: true, *fn() { yield { f: 'sitBlink', t: 300 }; yield { f: 'sit', t: 400, fx: 'hash' }; yield { f: 'lie', t: 400 }; } },
};

const CATEGORY = {
  subtle: (a) => Math.max(0.15, 1.6 - 0.35 * a),
  normal: () => 1,
  big: (a) => 0.25 + 0.3 * a,
  absurd: (a) => 0.18 + 0.22 * a,
  none: (a) => (a <= 1 ? 0.45 : 0.08),
  escalate: () => 0,
  asleep: () => 0,
};

// Moods drift every several minutes and tilt the odds.
const MOODS = {
  content: { act: {}, react: {} },
  playful: { act: { fetch: 2.5, hop: 1.6, dance: 1.5, juggle: 2, peekaboo: 1.6, butterfly: 1.4 }, react: { normal: 1.3, absurd: 1.3 } },
  curious: { act: { inspect: 2.5, look: 1.5, leaf: 2, butterfly: 2, dig: 1.8, patrol: 1.5 }, react: { subtle: 1.4 } },
  sleepy: { act: { rest: 1.8, sleep: 2, stretch: 1.5, stargaze: 1.4, dance: 0.4, hop: 0.4 }, react: { none: 2, subtle: 1.3, big: 0.6 } },
  grumpy: { act: { roar: 2.5, look: 1.3, dance: 0.3, rest: 1.2 }, react: { normal: 1.2, none: 1.6, big: 0.8 } },
  silly: { act: { trip: 2.5, moonwalk: 2, chaseTail: 2, flamingo: 2.5, hiccups: 2, shadowbox: 2 }, react: { absurd: 2, big: 1.4 } },
};

// ---- the behaviour engine ---------------------------------------------------------------------

export class Critter {
  constructor({ rng = Math.random, unit = () => 1.25, width = () => 160, margin = () => 24, progress = () => ({}), clock = () => Date.now() } = {}) {
    this.rng = rng;
    this.unitOf = unit;
    this.widthOf = width;
    this.marginOf = margin;  // drawable room beyond each end of the strip (props, visitors)
    this.getProgress = progress;
    this.clock = clock;     // wall clock (time of day, for star-gazing)
    this.x = 30; this.face = 1; this.y = 0; this.flip = false;
    this.frame = 'sit';
    this.effects = [];
    this.particles = [];
    this.props = [];
    this.hat = null;        // { kind, until }
    this.energy = 0;        // 0 calm … 1 lively (smoothed)
    this.heat = 0;          // recent writing (decays)
    this.lastWrite = 0;
    this.queue = [];        // pending reactions: { name, at }
    this.pokes = [];
    this.history = [];      // recent reactions, newest last
    this.lastUsed = {};
    this.recent = [];       // recent activities
    this.step = null;
    this.gen = null;
    this.paused = null;     // activity interrupted by a reaction
    this.inReaction = null;
    this.activity = '';
    this.pending = null;    // an activity to do next (e.g. celebrate)
    this.mood = 'content';
    this.moodUntil = 0;
    this.cursor = null;     // { x, y, t } in strip coordinates
    this.attention = { near: false, since: 0, lastFx: -1e9, due: 0, lastTurn: -1e9 };
    this.ack = null;        // { t0 } — a click acknowledged on the spot
    this.celebrated = '';
    this.force = null;      // test hook: name of the next reaction
    this.lastTick = null;
    this.now = 0;
    this.held = [];         // steps waiting behind an inserted get-up step
    this.pid = 0;
  }

  // -- randomness --
  rnd(a, b) { return a + this.rng() * (b - a); }
  rint(a, b) { return Math.floor(this.rnd(a, b + 1)); }
  chance(p) { return this.rng() < p; }
  /** Weighted pick from [[value, weight], …] or { value: weight }. */
  pick(items) {
    const list = Array.isArray(items) ? items : Object.entries(items);
    let sum = 0;
    for (const [, w] of list) sum += Math.max(0, w);
    if (sum <= 0) return list[0][0];
    let r = this.rng() * sum;
    for (const [v, w] of list) { r -= Math.max(0, w); if (r <= 0) return v; }
    return list[list.length - 1][0];
  }

  // -- geometry (x in CSS px along the strip, heights in sprite pixels) --
  get u() { return this.unitOf(); }
  get stripW() { return this.widthOf(); }
  get margin() { return this.marginOf(); }
  get maxX() { return Math.max(0, this.stripW - W * this.u); }
  clampX(x) { return Math.max(0, Math.min(this.maxX, x)); }
  clampProp(x, cols = 6) { return Math.max(0, Math.min(this.stripW - cols * this.u, x)); }
  /** A place to go: usually the middle stretch of the strip, now and then further out. */
  spot() {
    if (this.chance(0.12)) return this.rnd(0.05, 0.95) * this.maxX;
    return (0.5 + (this.rng() + this.rng() - 1) * 0.38) * this.maxX;
  }
  /** Near an end of the strip: the direction back towards the middle (else 0). */
  inward() { return this.x > this.maxX * 0.8 ? -1 : this.x < this.maxX * 0.2 ? 1 : 0; }
  sitting() { return postureOf(this.frame) === 'sit'; }
  onstage() { return this.x >= -0.5 && this.x <= this.maxX + 0.5; }
  center() { return this.x + (W * this.u) / 2; }
  cursorX() { return this.cursor ? this.cursor.x : this.center(); }
  towardCursor() { return this.cursor ? (this.cursor.x >= this.center() ? 1 : -1) : this.face; }
  /** Dinosaur x at which its nose reaches a prop on the ground. */
  reach(p) {
    const pw = this.propCols(p) * this.u;
    return this.clampX(p.x + pw / 2 < this.center() ? p.x + pw - 2 * this.u : p.x - 15 * this.u);
  }

  // -- writing and energy --
  wrote(n, now) {
    if (n <= 0) return;
    this.heat += Math.min(n, 50); // a single big change counts like a burst, not a marathon
    this.lastWrite = now;
  }

  updateEnergy(dt) {
    this.heat *= Math.exp(-dt / 120000);                       // words written, fading over ~2 min
    const wpm = this.heat / 2;                                  // ≈ words per minute recently
    const { today = 0, goal = 0 } = this.getProgress() || {};
    const goalPart = goal > 0 ? 0.12 * Math.min(1, today / goal) : 0;
    const target = Math.min(1, 1 - Math.exp(-wpm / 14) + goalPart * (wpm > 1 ? 1 : 0.3));
    this.energy += (target - this.energy) * (1 - Math.exp(-dt / 20000)); // glide, never jump
  }

  updateMood(now) {
    if (now < this.moodUntil) return;
    const e = this.energy;
    const h = new Date(this.clock()).getHours();
    const night = h >= 22 || h < 6;
    this.mood = this.pick({ content: 3, playful: 0.5 + 2.5 * e, curious: 1.5, sleepy: (night ? 2 : 0.5) + 2 * (1 - e), grumpy: 0.5, silly: 0.6 + e });
    this.moodUntil = now + this.rnd(6, 20) * 60000;
  }

  // -- choosing what to do --
  pickActivity(now) {
    if (this.pending) { const a = this.pending; this.pending = null; return a; }
    const e = this.energy;
    const idle = (now - this.lastWrite) / 1000;
    const writing = this.heat > 6;
    const h = new Date(this.clock()).getHours();
    const night = h >= 22 || h < 5;
    const free = this.props.length < 2;
    const w = {
      sleep: e < 0.15 ? (idle > 240 ? 6 : 0.8) : 0,
      rest: 4 * (1 - e) + 0.4,
      look: 2,
      walk: 0.6 + 4 * e,
      stretch: 0.5 + 0.8 * (1 - e),
      hop: 2.5 * e * e,
      dance: e > 0.45 ? 2 * e * e : 0,
      roar: 0.2 + 0.5 * e,
      trip: 0.15 + 0.5 * e,
      moonwalk: e > 0.35 ? 0.6 * e : 0,
      chaseTail: 0.1 + 0.6 * e,
      sneeze: 0.25,
      fetch: free ? 0.25 + 1.3 * e : 0,
      dig: free ? 0.3 + 0.3 * (1 - e) : 0,
      leaf: free ? 0.15 + 0.4 * (1 - e) : 0,
      butterfly: free ? 0.3 : 0,
      inspect: this.restingProp() ? 1.4 : 0,
      writeAlong: writing ? 0.5 + 1.5 * e : 0,
      juggle: free ? 0.08 + 0.5 * e * e : 0,
      hiccups: 0.12,
      flamingo: 0.15,
      peekaboo: 0.12 + 0.2 * e,
      shadowbox: 0.08 + 0.35 * e,
      patrol: 0.2 + 0.3 * e,
      stargaze: night ? 0.8 : 0,
      egg: free ? 0.012 : 0,   // rare surprises
      ufo: 0.01,
    };
    const m = MOODS[this.mood].act;
    for (const k in m) if (w[k]) w[k] *= m[k];
    this.recent.forEach((k, i) => { if (w[k]) w[k] *= i === this.recent.length - 1 ? 0.2 : 0.55; }); // variety
    return this.pick(w);
  }

  // -- clicks --
  poke(now) {
    this.pokes = this.pokes.filter((t) => now - t < 4000);
    this.pokes.push(now);
    const a = this.pokes.length;
    // Acknowledged on the spot, whatever it is doing and whatever comes next:
    // a blink and a little start drawn over the current frame (see Dino.draw),
    // and a held pose turns to face you.
    this.ack = { t0: now };
    if (this.step && now < this.step.end && isHold(this.step) && !this.asleep()) this.face = this.towardCursor();
    if (this.queue.length >= 2) {
      // Plenty queued already: extra clicks are absorbed — or turn the last one into something bigger.
      if (a === 5 || (a >= 8 && a % 3 === 2)) this.queue[this.queue.length - 1] = { name: this.chooseReaction(now, a), at: now };
      return;
    }
    const name = this.chooseReaction(now, a);
    const R = REACTIONS[name];
    let at = now;
    if (R.delay) at += this.rnd(R.delay[0], R.delay[1]);
    else if (this.chance(0.2)) at += this.rnd(200, 700); // sometimes a beat before reacting
    this.queue.push({ name, at });
  }
  /** The click acknowledgement is showing (blink for 160 ms, a 1-pixel start for the first 90). */
  acking(now) { return this.ack && now - this.ack.t0 < 160 ? (now - this.ack.t0 < 90 ? 2 : 1) : 0; }

  asleep() { return this.activity === 'sleep' && postureOf(this.frame) === 'lie'; }

  chooseReaction(now, agitation = 1) {
    if (this.force) { const n = this.force; this.force = null; this.remember(n, now); return n; }
    let name;
    if (agitation === 5) name = 'annoyed';
    else if (agitation >= 8 && agitation % 3 === 2) name = this.pick({ dizzy: 1, storm: 1, runAway: this.lastUsed.runAway && now - this.lastUsed.runAway < 60000 ? 0 : 1, playDead: 0.7 });
    if (!name) {
      const sleeping = this.asleep();
      const moodW = MOODS[this.mood].react;
      const w = {};
      for (const [k, R] of Object.entries(REACTIONS)) {
        if (sleeping ? !R.asleep : R.cat === 'asleep') continue;
        let x = R.w * (sleeping ? 1 : CATEGORY[R.cat](agitation)) * (moodW[R.cat] || 1);
        if (R.cool && now - (this.lastUsed[k] ?? -1e12) < R.cool) x = 0;
        if (k === 'gift' && !this.cursor) x = 0;
        const i = this.history.lastIndexOf(k);
        if (i >= 0) { const ago = this.history.length - i; x *= ago <= 2 ? 0.03 : ago <= 6 ? 0.3 : ago <= 14 ? 0.7 : 1; }
        if (x > 0) w[k] = x;
      }
      name = this.pick(w);
    }
    this.remember(name, now);
    return name;
  }

  remember(name, now) {
    this.history.push(name);
    if (this.history.length > 30) this.history.shift();
    this.lastUsed[name] = now;
  }

  // -- the cursor --
  cursorAt(x, y, now) { this.cursor = { x, y, t: now }; }
  cursorNear(now) {
    const c = this.cursor;
    if (!c || now - c.t > 6000) return false;
    const dx = c.x - this.center();
    return Math.abs(dx) < 80 && c.y > -30 && c.y < 80;
  }
  /**
   * Notice the cursor: when it comes close, or crosses to the dinosaur's other
   * side, a glance is due. It happens at once if only a pose is being held
   * (the hold is shortened, nothing is cut), otherwise as soon as the current
   * move ends — and is dropped if that takes longer than a second.
   */
  notice(now) {
    const A = this.attention, near = this.cursorNear(now);
    if (near && !A.near) { A.since = now; A.due = now; }
    else if (near && this.towardCursor() !== this.face && now - A.lastTurn > 700 && !A.due) A.due = now;
    A.near = near;
    if (!near || (A.due && now - A.due > 1000)) A.due = 0;
    const s = this.step;
    if (A.due && s && now < s.end && now - s.start >= 50 && isHold(s) && this.glanceable()) s.end = now;
  }
  glanceable() {
    return !this.inReaction && this.activity !== 'sleep' && !this.held.length && HOLD.has(this.frame) && !(this.queue.length && this.queue[0].at <= this.now);
  }
  /** The glance itself: a blink as it turns (if it has to), then a look towards the cursor. */
  glance(now) {
    const A = this.attention;
    if (!A.due || !this.glanceable() || !this.cursor) return null;
    A.due = 0; A.lastTurn = now;
    const sitting = this.sitting(), dir = this.towardCursor();
    const above = this.cursor.y > H * this.u;
    const look = sitting ? (above ? 'sitUp' : 'sit') : (above || this.chance(0.3) ? 'up' : 'stand');
    let fx = null;
    if (now - A.lastFx > 30000 && this.chance(0.35)) { fx = this.pick({ heart: 2, '?': 1.5, note: 1, star: 0.7 }); A.lastFx = now; }
    const steps = [{ f: look, t: this.rnd(550, 950), face: dir, fx }];
    if (dir !== this.face) steps.unshift({ f: sitting ? 'sitBlink' : 'blink', t: 90 });
    this.held.push(...steps.slice(1));
    return steps[0];
  }
  /** Casual attention to a nearby cursor, folded into the step about to start (never adds steps). */
  attend(v, now) {
    const near = this.cursorNear(now);
    const A = this.attention;
    if (near && !A.near) A.since = now;
    A.near = near;
    if (!near || v.dx || v.jump || v.lift || v.flip) return v;
    const out = { ...v };
    const looks = { stand: 'up', blink: null, sit: 'sitUp', sitBlink: null, sitBreath: null, up: null, sitUp: null };
    if (ATTENTIVE.has(this.activity) && v.f in looks && !v.face) {
      out.face = this.towardCursor();
      const above = this.cursor.y > H * this.u;
      if (above && looks[v.f] && this.chance(0.5)) out.f = looks[v.f];
    }
    if (!out.fx && now - A.since < 1500 && now - A.lastFx > 30000 && this.chance(0.2) && this.activity !== 'sleep') {
      out.fx = this.pick({ heart: 2, '?': 1.5, note: 1, star: 0.7 });
      A.lastFx = now;
    }
    return out;
  }

  // -- props --
  spawn(kind, o = {}) {
    const p = { id: ++this.pid, kind, x: this.x, y: 0, vx: 0, vy: 0, frame: 0, carried: false, born: this.now, life: Infinity, ...o };
    this.props.push(p);
    return p;
  }
  has(p) { return this.props.includes(p); }
  remove(p) { this.props = this.props.filter((q) => q !== p); }
  expire(p, ms) { p.life = this.now - p.born + ms; }
  propCols(p) { return PROPS[p.kind][0][0].length; }
  restingProp() { return this.props.find((p) => !p.carried && !p.balance && p.y === 0 && !p.vx && ['ball', 'bone', 'leaf', 'pebble'].includes(p.kind)); }
  pickUp(p) { p.carried = true; p.vx = p.vy = 0; p.life = Infinity; }
  drop(p, vx) {
    if (!p) return;
    const [col] = MOUTH[this.frame] || MOUTH.stand;
    p.carried = false;
    p.x = this.clampProp(this.x + (this.face > 0 ? col : W - 1 - col) * this.u - this.propCols(p) * this.u / 2, this.propCols(p));
    p.y = 2; p.vy = 0; p.vx = vx; p.gravity = true;
  }
  kick(p, dir, power = 1) { p.vx = dir * this.rnd(70, 140) * power; p.vy = this.rnd(15, 40) * power; p.gravity = true; }
  wear(kind, ms) { this.hat = { kind, until: this.now + ms }; }
  unwear() { this.hat = null; }
  dirt(n) {
    const fx = this.x + (this.face > 0 ? 16 : 1) * this.u;
    for (let i = 0; i < n; i++) this.particles.push({ x: fx, y: 1, vx: -this.face * this.rnd(10, 40), vy: this.rnd(15, 35), t0: this.now });
  }
  puffAt(x) { for (let i = 0; i < 4; i++) this.particles.push({ x: x + this.rnd(0, 6), y: this.rnd(1, 4), vx: this.rnd(-20, 20), vy: this.rnd(10, 25), t0: this.now }); }

  /** Steps that walk to x (a number or a function, re-read every step, so moving targets can be chased). */
  *walkTo(target, speed = 1, { max = 200, pauses = false } = {}) {
    yield* this.getTo('stand');
    let k = 0;
    for (let i = 0; i < max; i++) {
      const tx = typeof target === 'function' ? target() : target;
      if (tx == null || Number.isNaN(tx)) return;
      const goal = this.clampX(tx);
      const diff = goal - this.x;
      if (Math.abs(diff) < 1) return;
      const dir = Math.sign(diff);
      const stride = Math.min((2 + 2 * this.energy) * speed, Math.abs(diff));
      yield { f: k++ % 2 ? 'walk2' : 'walk1', t: Math.max(110, (240 - 90 * this.energy) / Math.sqrt(speed)), dx: stride * dir, face: dir };
      if (pauses && this.chance(0.05)) { yield { f: 'stand', t: 500 }; yield { f: 'up', t: 400 }; }
    }
  }

  /** Watch a moving prop until it settles (turning to follow it). */
  *watch(p, maxMs, frame = 'stand') {
    let t = 0;
    while (this.has(p) && t < maxMs && (p.vx || p.vy || (p.fall && p.y > 0))) {
      const dir = Math.sign(p.x - this.center()) || this.face;
      yield { f: frame, t: 250, face: postureOf(this.frame) === 'stand' ? dir : undefined };
      t += 250;
    }
  }

  /** Steps to move from the current posture to another (used before reactions and after them). */
  *getTo(posture) {
    const cur = postureOf(this.frame);
    if (cur === posture) return;
    if (cur === 'lie') { yield { f: 'sitBlink', t: 260 }; if (posture === 'sit') return; }
    if (posture === 'lie') { if (cur === 'stand') yield { f: 'crouch', t: 200 }; yield { f: 'sit', t: 300 }; yield { f: 'lie', t: 300 }; return; }
    if (posture === 'sit') { yield { f: 'crouch', t: 200 }; yield { f: 'sit', t: 250 }; return; }
    yield { f: 'crouch', t: 220 }; // up from sitting
    yield { f: 'stand', t: 200 };
  }

  nextStep(now) {
    // The play area shrank under it (window resized, a panel opened): stroll back
    // in before anything else, then carry on with whatever it was doing.
    if (!this.onstage() && !this.inReaction) {
      const self = this;
      this.paused = this.gen;
      this.inReaction = 'comeBack';
      const speed = Math.max(1.4, Math.min(3, Math.abs(this.clampX(this.x) - this.x) / 40)); // a long way back: a brisker walk
      this.gen = (function* () { yield* self.walkTo(() => self.clampX(self.x), speed); })();
    }
    // Reactions go in between steps of the current activity, never through one.
    const due = this.queue.length && this.queue[0].at <= now;
    if (due && !this.inReaction && this.onstage()) {
      const { name } = this.queue.shift();
      const R = REACTIONS[name];
      const self = this;
      const sleeping = this.activity === 'sleep';
      const wakes = R.wakes !== false;
      const resume = postureOf(this.frame);
      const stay = R.stay && (resume !== 'lie' || R.asleep); // never pop up from lying without getting up
      this.paused = this.gen;
      this.inReaction = name;
      this.wakeUp = sleeping && wakes;
      this.gen = (function* () {
        if (!stay) yield* self.getTo('stand');
        yield* R.fn(self);
        if (sleeping && !wakes) yield* self.getTo('lie');
        else if (!sleeping && postureOf(self.frame) !== resume) yield* self.getTo(resume);
      })();
    }
    for (let guard = 0; guard < 6; guard++) {
      if (!this.gen) {
        const a = this.pickActivity(now);
        this.inReaction = null; this.paused = null; // a fresh activity: nothing left over from a reaction
        this.activity = a;
        this.recent.push(a);
        if (this.recent.length > 4) this.recent.shift();
        this.gen = ACTIVITIES[a](this);
      }
      const r = this.gen.next();
      if (!r.done) return this.inReaction ? r.value : this.attend(r.value, now);
      if (this.inReaction) {
        this.inReaction = null;
        this.gen = this.wakeUp ? null : this.paused; // a poked sleeper stays awake
        this.wakeUp = false;
        this.paused = null;
        if (this.queue.length && this.queue[0].at <= now) return this.nextStep(now);
      } else this.gen = null;
    }
    const rest = postureOf(this.frame);
    return { f: rest === 'lie' ? 'lie' : rest === 'sit' ? 'sit' : 'stand', t: 500 };
  }

  // -- world --
  updateWorld(dt, now) {
    const s = dt / 1000, u = this.u, W2 = this.stripW;
    for (const p of [...this.props]) {
      const cols = this.propCols(p);
      if (p.carried) continue;
      if (now - p.born > p.life) { this.remove(p); continue; }
      if (p.wobble) p.wobble = Math.max(0, p.wobble - dt);
      switch (p.kind) {
        case 'leaf':
          if (p.y > 0) { p.y = Math.max(0, p.y - 5 * s); p.x = this.clampProp(p.x + Math.sin((now - p.born) / 380) * 9 * s, cols); p.frame = Math.sin((now - p.born) / 380) > 0 ? 0 : 1; }
          else { p.fall = false; p.x += p.vx * s; p.vx *= Math.exp(-s * 3); if (Math.abs(p.vx) < 1) p.vx = 0; }
          break;
        case 'butterfly': {
          const age = now - p.born;
          if (this.rng() < s * 0.8) p.vx = -p.vx;
          p.x = Math.max(-this.margin, Math.min(W2 + this.margin - cols * u, p.x + p.vx * s));
          if (p.vy) { p.y += p.vy * s; p.vy = Math.max(0, p.vy - 20 * s); }
          if (age > p.life - 3000) p.y += 4 * s; // flutters off upward, blinking away
          else p.y += (12 + 4 * Math.sin(age / 300) - p.y) * Math.min(1, s * 2);
          if (p.x < 4 - this.margin && p.vx < 0 && age > 2000) p.vx = Math.abs(p.vx);
          if (p.x > W2 + this.margin - 8 && p.vx > 0 && age > 2000) p.vx = -Math.abs(p.vx);
          p.frame = Math.floor(age / 160) % 2;
          if (p.y > H + 20) this.remove(p);
          break;
        }
        case 'baby':
          p.x += p.vx * s;
          p.y = p.hops ? Math.abs(Math.sin((now - p.born) / 220)) * 2 : 0;
          p.frame = Math.floor((now - p.born) / 200) % 2;
          if (p.x < -this.margin || p.x > W2 + this.margin - 8) p.vx = 0;
          break;
        case 'ufo':
          p.x += (p.tx - p.x) * (1 - Math.exp(-s * (p.leaving ? 1.2 : 1.8)));
          p.y = 24 + Math.sin((now - p.born) / 300);
          break;
        default: // ball, bone, egg, pebble, shell, typewriter: simple physics
          if (p.balance) {
            const [col, row] = MOUTH.up;
            p.x = this.x + (this.face > 0 ? col - 2 : W - 1 - col - 2) * u;
            p.y = (H - row) + 1 + Math.abs(Math.sin((now - p.born) / 160)) * 3;
            p.frame = Math.floor((now - p.born) / 160) % 4;
            break;
          }
          if (p.gravity || p.y > 0) {
            p.vy -= 160 * s; p.y += p.vy * s;
            if (p.y <= 0) { p.y = 0; p.vy = Math.abs(p.vy) > 18 && p.kind === 'ball' ? -p.vy * 0.45 : 0; if (!p.vy) p.gravity = false; }
          }
          if (p.vx) {
            p.x += p.vx * s;
            if (p.y === 0) p.vx *= Math.exp(-s * (p.kind === 'ball' ? 1.1 : 6));
            const right = W2 - cols * u;
            if (p.x < 0) { p.x = 0; p.vx = Math.abs(p.vx) * 0.5; }
            if (p.x > right) { p.x = right; p.vx = -Math.abs(p.vx) * 0.5; }
            if (Math.abs(p.vx) < 2) p.vx = 0;
            if (p.kind === 'ball') p.frame = ((Math.floor(p.x / (2 * u)) % 4) + 4) % 4;
          }
      }
    }
    this.particles = this.particles.filter((q) => now - q.t0 < 650);
    for (const q of this.particles) { q.x += q.vx * s; q.y = Math.max(0, q.y + q.vy * s); q.vy -= 90 * s; }
    if (this.hat && now > this.hat.until) this.hat = null;
  }

  /** Advance to time `now`. Returns true while anything is moving (the caller ticks faster). */
  advance(now) {
    this.now = now;
    if (this.lastTick === null) this.lastTick = now;
    const dt = Math.min(1000, now - this.lastTick);
    this.lastTick = now;
    this.updateEnergy(dt);
    this.updateMood(now);
    const { today = 0, goal = 0 } = this.getProgress() || {};
    const day = new Date(this.clock()).toDateString();
    if (goal > 0 && today >= goal && this.celebrated !== day) { this.celebrated = day; if (this.lastWrite && now - this.lastWrite < 60000) this.pending = 'celebrate'; }
    this.updateWorld(dt, now);
    let s = this.step;
    // A reaction that has fallen due starts as soon as the pose being held allows.
    if (s && now < s.end && !this.inReaction && this.queue.length && this.queue[0].at <= now && isHold(s) && this.onstage()) s.end = now;
    this.notice(now);
    if (!s || now >= s.end) {
      if (s) { this.x = s.x1; this.y = s.lift ? s.lift[1] : 0; }
      const v = this.bridged(this.held.length ? this.held.shift() : this.glance(now) || this.nextStep(now));
      if (v.do) v.do(this);
      if (v.face) this.face = v.face;
      // Steps stay on the strip; off it (after a resize), they may only head back.
      const x1 = Math.max(Math.min(0, this.x), Math.min(Math.max(this.maxX, this.x), this.x + (v.dx || 0)));
      s = this.step = { ...v, start: now, end: now + v.t, x0: this.x, x1 };
      this.frame = v.f;
      this.flip = !!v.flip;
      if (v.fx) this.effects.push({ g: v.fx, t0: now, face: this.face });
    }
    const k = Math.min(1, (now - s.start) / (s.end - s.start));
    this.x = s.x0 + (s.x1 - s.x0) * k;
    this.y = s.lift ? s.lift[0] + (s.lift[1] - s.lift[0]) * k : s.jump ? s.jump * 4 * k * (1 - k) : 0;
    this.effects = this.effects.filter((e) => now - e.t0 < 1400);
    return s.x1 !== s.x0 || !!s.jump || !!s.lift || this.effects.length > 0 || this.particles.length > 0 || this.acking(now) > 0 ||
      this.props.some((p) => p.vx || p.vy || p.balance || p.wobble || (p.fall && p.y > 0) || ['butterfly', 'baby', 'ufo'].includes(p.kind));
  }

  /** Never jump between postures: getting up from lying or sitting always shows the in-between frames. */
  bridged(v) {
    const from = postureOf(this.frame), to = postureOf(v.f);
    if (from === 'lie' && to === 'stand') { this.held.unshift({ f: 'crouch', t: 170 }, v); return { f: 'sitBlink', t: 220 }; }
    if (from === 'sit' && to === 'stand' && !GET_UP.has(v.f)) { this.held.unshift(v); return { f: 'crouch', t: 170 }; }
    return v;
  }

  /** When the next step starts or a queued reaction falls due (for scheduling). */
  nextEvent() {
    let t = this.step ? this.step.end : 0;
    if (this.queue.length) t = Math.min(t, this.queue[0].at);
    if (this.ack && this.ack.t0 + 160 > this.now) t = Math.min(t, this.ack.t0 + 160);
    return t;
  }
}

// ---- drawing and wiring ---------------------------------------------------------------------

// The play area: a stretch of the desk just above the status bar, centred on
// TODAY, up to PLAY_MAX px wide, kept inside the editor area (never over the
// side panels). MARGIN px beyond each end are drawn too, so props and visitors
// that roll or fly a little past the ends stay whole.
const PLAY_MAX = 560, MARGIN = 24, HEADROOM = 24;

export class Dino {
  constructor({ anchor, area, getProgress }) {
    this.anchor = anchor;           // the TODAY element in the status bar
    this.area = area;               // the editor area the dinosaur lives above
    this.root = document.createElement('div');
    this.root.id = 'dino';
    this.root.setAttribute('aria-hidden', 'true');
    this.canvas = document.createElement('canvas');
    this.hit = document.createElement('div');
    this.hit.className = 'dino-hit';
    this.root.append(this.canvas, this.hit);
    document.body.append(this.root);
    this.ctx = this.canvas.getContext('2d');
    this.stripW = 300;
    this.stripLeft = null;          // the strip's left edge in the window
    this.off = MARGIN;              // canvas x of the strip's left edge
    this.c = new Critter({ unit: () => this.pxDev / (window.devicePixelRatio || 1), width: () => this.stripW, margin: () => MARGIN, progress: getProgress });
    this.c.lastWrite = performance.now(); // idle time counts from launch: it starts awake
    this.born = performance.now();
    this.timer = 0;
    this.lastSig = '';
    this.enabled = true;

    this.hit.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); this.poke(); });
    // The cursor: noticed as soon as it comes close (or crosses to the other
    // side). Moving it elsewhere costs nothing — the loop is only woken when
    // that changes.
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled || this.root.hidden || this.stripLeft == null) return;
      const now = performance.now();
      this.c.cursorAt(e.clientX - this.stripLeft, this.bottom - e.clientY, now);
      const A = this.c.attention;
      if (this.c.cursorNear(now) !== A.near || (A.near && this.c.towardCursor() !== this.c.face)) this.schedule(0);
    }, { passive: true });
    document.documentElement.addEventListener('mouseleave', () => { this.c.cursor = null; });
    // While a mouse button is held elsewhere (selecting text, dragging a
    // scrollbar), the dinosaur lets everything through, so it can never catch
    // a drag that passes over it.
    window.addEventListener('pointerdown', (e) => { if (e.target !== this.hit) this.root.classList.add('pass'); }, true);
    window.addEventListener('pointerup', () => this.root.classList.remove('pass'), true);
    window.addEventListener('blur', () => this.root.classList.remove('pass'));
    // TODAY moves whenever anything before it in the status bar changes width;
    // the editor area narrows and widens as side panels open and close.
    const ro = new ResizeObserver(() => this.place());
    for (const el of anchor.parentElement.children) ro.observe(el);
    if (area) ro.observe(area);
    window.addEventListener('resize', () => this.place());
    document.addEventListener('visibilitychange', () => this.schedule(0));
    new MutationObserver(() => { this.lastSig = ''; this.draw(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    this.place();
    this.schedule(0);
  }

  setEnabled(on) {
    this.enabled = on;
    this.root.hidden = !on;
    if (on) { this.place(); this.schedule(0); } else clearTimeout(this.timer);
  }

  /** Words the writer just wrote (net, own writing only). */
  wrote(n) { this.c.wrote(n, performance.now()); }
  poke() { this.c.poke(performance.now()); this.schedule(0); }

  // -- layout --
  get pxDev() { return Math.max(1, Math.round(1.25 * (window.devicePixelRatio || 1))); }

  /**
   * Fit the play area to the window. The dinosaur and its props keep their
   * place on screen when the area moves or changes size; if the area shrinks
   * out from under it, it walks back in (Critter.nextStep) rather than jumping,
   * and the canvas stretches to keep it whole meanwhile.
   */
  place() {
    const r = this.anchor.getBoundingClientRect();
    const a = this.area ? this.area.getBoundingClientRect() : { left: 0, right: window.innerWidth };
    const lo = Math.max(a.left, 0) + MARGIN, hi = Math.min(a.right - 10, window.innerWidth) - MARGIN; // 10: the editor's scrollbar
    const visible = this.enabled && r.width > 0 && getComputedStyle(this.anchor).display !== 'none' && hi - lo >= 140;
    this.root.hidden = !visible;
    if (!visible) return;
    const c = this.c, dpr = window.devicePixelRatio || 1, p = this.pxDev;
    const width = Math.round(Math.min(PLAY_MAX, hi - lo));
    const left = Math.round(Math.max(lo, Math.min(hi - width, r.left + r.width / 2 - width / 2)));
    // While the window is still laying itself out it simply starts in the middle; after that it
    // keeps its place on screen.
    if (performance.now() - this.born < 1500 && !c.step?.dx) c.x = (width - W * c.u) / 2;
    else if (this.stripLeft != null && left !== this.stripLeft) {
      const d = this.stripLeft - left;
      c.x += d;
      if (c.step) { c.step.x0 += d; c.step.x1 += d; }
      for (const q of c.props) { q.x += d; if (q.tx != null) q.tx += d; }
      for (const q of c.particles) q.x += d;
      if (c.cursor) c.cursor.x += d;
    }
    this.stripLeft = left;
    this.stripW = width;
    // Never further out than the window allows.
    const dw = W * c.u;
    c.x = Math.max(-left + 2, Math.min(window.innerWidth - left - dw - 2, c.x));
    // The canvas: the strip, its margins, and wherever the dinosaur is right now.
    const from = Math.max(-left, Math.min(-MARGIN, Math.floor(c.x) - 4));
    const to = Math.min(window.innerWidth - left, Math.max(width + MARGIN, Math.ceil(c.x + dw) + 4));
    this.off = -from;
    this.wide = from < -MARGIN || to > width + MARGIN;
    const wDev = Math.round((to - from) * dpr), hDev = (H + HEADROOM) * p; // headroom for jumps, glyphs and visitors
    if (this.canvas.width !== wDev || this.canvas.height !== hDev) {
      this.canvas.width = wDev;
      this.canvas.height = hDev;
      this.canvas.style.width = wDev / dpr + 'px';
      this.canvas.style.height = hDev / dpr + 'px';
    }
    this.bottom = Math.round(r.top);
    Object.assign(this.root.style, { left: left + from + 'px', top: Math.round(r.top - hDev / dpr) + 'px' });
    this.lastSig = '';
    this.draw();
  }

  schedule(delay) {
    clearTimeout(this.timer);
    if (document.hidden || !this.enabled) return; // no work at all in the background
    this.timer = setTimeout(() => this.tick(), delay);
  }

  tick() {
    const now = performance.now();
    const moving = this.c.advance(now);
    if (this.wide && this.c.onstage()) this.place(); // back inside: the canvas can shrink again
    this.draw(now);
    this.schedule(moving ? 90 : Math.max(16, Math.min(250, this.c.nextEvent() - now)));
  }

  draw(now = performance.now()) {
    if (this.root.hidden) return;
    const c = this.c, p = this.pxDev, dpr = window.devicePixelRatio || 1;
    const off = this.off;
    const snap = (x) => Math.round(((x + off) * dpr) / p) * p;  // strip x → canvas, on the sprite's pixel grid
    const ack = c.acking(now);
    const px = snap(c.x);
    const py = (Math.round(c.y) + (ack === 2 && c.y === 0 ? 1 : 0)) * p;
    const fx = c.effects.map((e) => `${e.g}${Math.round((now - e.t0) / 140)}`).join();
    const props = c.props.map((q) => `${q.kind}${q.frame}${snap(q.x)},${Math.round(q.y)}${q.carried ? 'c' : ''}${q.wobble ? Math.round(now / 90) % 2 : ''}${q.beam ? 'b' : ''}${this.blinkOut(q, now) ? 'x' : ''}`).join();
    const parts = c.particles.map((q) => `${snap(q.x)},${Math.round(q.y)}`).join();
    const sig = `${c.frame}|${px}|${py}|${c.face}|${c.flip}|${ack}|${fx}|${props}|${parts}|${c.hat ? c.hat.kind : ''}`;
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    const g = this.ctx, cw = this.canvas.width, ch = this.canvas.height;
    g.clearRect(0, 0, cw, ch);
    g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#000';
    const ground = ch;
    const grid = (rows, x, bottomY, mirror = false, flip = false) => {
      const h = rows.length, w = rows[0].length;
      for (let r = 0; r < h; r++) {
        const row = rows[flip ? h - 1 - r : r];
        for (let i = 0; i < w; i++) {
          if (row[i] !== '#') continue;
          g.fillRect(x + (mirror ? w - 1 - i : i) * p, bottomY - (h - r) * p, p, p);
        }
      }
    };
    // Loose props behind the dinosaur.
    for (const q of c.props) {
      if (q.carried || this.blinkOut(q, now)) continue;
      const art = PROPS[q.kind][q.frame] || PROPS[q.kind][0];
      const jitter = q.wobble ? (Math.round(now / 90) % 2 ? p : -p) : 0;
      grid(art, snap(q.x) + jitter, ground - Math.round(q.y) * p, q.kind === 'baby' && q.vx < 0);
      if (q.kind === 'ufo' && q.beam) {
        const bx = snap(q.x) + 4 * p;
        for (let y = ground - Math.round(q.y) * p + p; y < ground; y += 2 * p) { g.fillRect(bx - 3 * p, y, p, p); g.fillRect(bx + 3 * p, y, p, p); }
      }
    }
    // The dinosaur.
    let rows = FRAMES[c.frame] || FRAMES.stand;
    if (ack) rows = rows.map((r) => r.replace('o', '#')); // a blink: noticed!
    grid(rows, px, ground - py, c.face < 0, c.flip);
    const top = ground - py - H * p;
    const at = (col) => px + (c.face > 0 ? col : W - 1 - col) * p;
    // Carried props, held in the mouth: just past the snout, centred on the mouth row.
    for (const q of c.props) {
      if (!q.carried) continue;
      const [col, row] = MOUTH[c.frame] || MOUTH.stand;
      const art = PROPS[q.kind][0], aw = art[0].length;
      const x = c.face > 0 ? px + (col + 1) * p : px + (W - 2 - col - aw) * p;
      grid(art, x, top + (row + 1 + Math.ceil(art.length / 2)) * p, c.face < 0);
    }
    // Something on its head.
    if (c.hat && HEAD_TOP[c.frame] && !c.flip) {
      const [col, row] = HEAD_TOP[c.frame];
      const art = c.hat.kind === 'party' ? PROPS.party[0] : c.hat.kind === 'leaf' ? PROPS.leaf[0] : PROPS.butterfly[Math.floor(now / 400) % 2];
      grid(art, at(col) - Math.floor(art[0].length / 2) * p, top + row * p + (c.hat.kind === 'leaf' ? p : 0));
    }
    for (const q of c.particles) g.fillRect(snap(q.x), ground - (Math.round(q.y) + 1) * p, p, p);
    for (const e of c.effects) {
      const gl = GLYPHS[e.g];
      if (!gl) continue;
      const age = (now - e.t0) / 1400;
      const rise = Math.round(age * 5) * p;
      const gx = px + (e.face > 0 ? 13 : 2) * p + (e.g === 'z' ? Math.round(age * 3) * p * e.face : 0);
      const gy = top - 6 * p - rise + 2 * p;
      for (let r = 0; r < 5; r++) for (let i = 0; i < 3; i++) if (gl[r][i] === '#') g.fillRect(gx + i * p, gy + r * p, p, p);
    }
    // Click target follows the dinosaur, with a pixel or two to spare.
    const s = p / dpr;
    Object.assign(this.hit.style, { left: px / dpr - 2 + 'px', top: top / dpr - 2 + 'px', width: W * s + 4 + 'px', height: H * s + 2 + 'px' });
  }

  /** Props about to vanish blink for their last 1.2 s. */
  blinkOut(q, now) {
    const left = q.life - (now - q.born);
    return left < 1200 && Math.floor(left / 150) % 2 === 1;
  }
}

export const _test = { FRAMES, PROPS, GLYPHS, W, H, ACTIVITIES, REACTIONS, MOODS, postureOf, MOUTH, HEAD_TOP };
