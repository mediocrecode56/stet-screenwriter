// A tiny pixel-art dinosaur that lives above TODAY in the status bar.
//
// It is purely decorative and costs almost nothing: one small canvas, redrawn
// only when its picture changes, at most ~10 times a second while it moves
// (less when resting) and not at all while the window is hidden.
//
// Behaviour is a sequence of longer scripted activities (walking about, looking
// around, stretching, resting, sleeping, and a few sillier ones). Each activity
// is a generator yielding short steps (≤ ~0.6 s), so a click's reaction can be
// slotted in at the next step boundary: the current motion always finishes,
// the dinosaur gets up first if it was sitting or lying, reacts, and then
// carries on with what it was doing. Nothing is ever cut off mid-move.
//
// How lively it is follows the words you actually write (fed in by the app
// from the same change tracking as TODAY), smoothed over minutes so it warms
// up and calms down gradually. Time passing alone never makes it busier, and
// it never nags: an idle writer just gets a dinosaur having a nap.

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
  stretch: STRETCH,
  sit: sit('open'),
  sitBlink: sit('blink'),
  sitBreath: sit('open').map((r, i) => (i === 8 ? '#.......#######....' .slice(0, W) : r)),
  lie: LIE,
  lieBreath: LIE.map((r, i) => (i === 10 ? '############......' : r)),
  fallen: FALLEN,
};
// Postures, so a reaction can get up first and the activity can sit back down after.
const POSTURE = { sit: 'sit', sitBlink: 'sit', sitBreath: 'sit', lie: 'lie', lieBreath: 'lie', fallen: 'lie' };
const postureOf = (f) => POSTURE[f] || 'stand';

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
};

// ---- behaviour ---------------------------------------------------------------------------

const rnd = (a, b) => a + Math.random() * (b - a);
const rint = (a, b) => Math.floor(rnd(a, b + 1));
const chance = (p) => Math.random() < p;

/** Step: { f: frame, t: ms, dx?: px moved during the step, jump?: px arc height, face?: ±1, fx?: glyph } */
const ACTIVITIES = {
  *rest(d) {
    yield* d.getTo('sit');
    const n = rint(6, 14);
    for (let i = 0; i < n; i++) {
      yield { f: 'sit', t: rnd(450, 700) };
      yield { f: 'sitBreath', t: rnd(450, 650) };
      if (chance(0.25)) { yield { f: 'sitBlink', t: 140 }; }
      if (chance(0.12)) { yield { f: 'sit', t: 400, face: -d.face }; }
    }
  },
  *sleep(d) {
    yield* d.getTo('sit');
    yield { f: 'sitBlink', t: 500 };
    yield { f: 'lie', t: 500 };
    const n = rint(12, 30);
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
    const n = rint(2, 4);
    for (let i = 0; i < n; i++) {
      yield { f: 'stand', t: rnd(500, 900) };
      if (chance(0.4)) yield { f: 'blink', t: 130 };
      yield { f: chance(0.3) ? 'up' : 'stand', t: rnd(400, 700), face: -d.face };
    }
    yield { f: 'stand', t: 400 };
  },
  *walk(d) {
    yield* d.getTo('stand');
    // Somewhere worth walking to: at least a third of the strip away.
    const far = d.maxX() / 3;
    let target = rnd(0, d.maxX());
    if (Math.abs(target - d.x) < far) target = d.x < d.maxX() / 2 ? rnd(d.x + far, d.maxX()) : rnd(0, d.x - far);
    const dir = Math.sign(target - d.x) || 1;
    yield { f: 'stand', t: 150, face: dir };
    let left = Math.abs(target - d.x);
    const stride = 2 + 2 * d.energy; // px per step
    const t = 240 - 90 * d.energy;
    let k = 0;
    while (left > 0.5) {
      const dx = Math.min(stride, left) * dir;
      left -= Math.abs(dx);
      yield { f: k++ % 2 ? 'walk2' : 'walk1', t, dx };
      if (chance(0.05)) { yield { f: 'stand', t: 500 }; yield { f: 'up', t: 400 }; }
    }
    yield { f: 'stand', t: 300 };
  },
  *stretch(d) {
    yield* d.getTo('stand');
    yield { f: 'crouch', t: 300 };
    yield { f: 'stretch', t: 900 };
    yield { f: 'armsUp', t: 500 };
    yield { f: 'stand', t: 200 };
    if (chance(0.5)) { yield { f: 'yawn', t: 700 }; yield { f: 'blink', t: 200 }; }
    yield { f: 'stand', t: 300 };
  },
  *hop(d) {
    yield* d.getTo('stand');
    const n = rint(2, 4);
    const dir = d.x > d.maxX() - 20 ? -1 : d.x < 20 ? 1 : (chance(0.5) ? 1 : -1);
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
    const n = rint(6, 10);
    for (let i = 0; i < n; i++) {
      yield { f: i % 2 ? 'walk1' : 'walk2', t: 220, fx: i % 4 === 0 ? 'note' : null };
      if (i % 3 === 2) yield { f: 'armsUp', t: 220, face: -d.face };
    }
    yield { f: 'stand', t: 300 };
  },
  *trip(d) {
    yield* d.getTo('stand');
    const dir = d.x > d.maxX() / 2 ? -1 : 1;
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
    const dir = d.x > d.maxX() / 2 ? -1 : 1;
    yield { f: 'stand', t: 200, face: -dir };
    for (let i = 0; i < 10 && d.x + 3 * dir >= 0 && d.x + 3 * dir <= d.maxX(); i++) yield { f: i % 2 ? 'walk2' : 'walk1', t: 200, dx: 3 * dir };
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
};

// Reactions to a poke. Each starts standing (the engine gets it up first).
const REACTIONS = {
  *startle(d) { yield { f: 'crouch', t: 80 }; yield { f: 'jump', t: 420, jump: 8, fx: '!' }; yield { f: 'crouch', t: 120 }; yield { f: 'stand', t: 300 }; yield { f: 'blink', t: 150 }; },
  *faint(d) { yield { f: 'up', t: 250 }; yield { f: 'armsUp', t: 250, fx: '!' }; yield { f: 'fallen', t: 1400 }; yield { f: 'fallen', t: 500, fx: 'star' }; yield { f: 'sit', t: 350 }; yield { f: 'stand', t: 300 }; },
  *ignore(d) { yield { f: 'stand', t: 250, face: -d.face }; yield { f: 'up', t: 900, fx: 'dots' }; yield { f: 'stand', t: 300, face: -d.face }; yield { f: 'blink', t: 150 }; },
  *roarBack(d) { yield { f: 'up', t: 200 }; yield { f: 'roar', t: 600, fx: '!' }; yield { f: 'roar', t: 300 }; yield { f: 'stand', t: 300 }; },
  *spin(d) { for (let i = 0; i < 6; i++) yield { f: i % 2 ? 'walk1' : 'walk2', t: 110, face: -d.face }; yield { f: 'stand', t: 500, fx: 'star' }; },
  *love(d) { yield { f: 'crouch', t: 100 }; yield { f: 'jump', t: 360, jump: 4, fx: 'heart' }; yield { f: 'stand', t: 400 }; },
  *boogie(d) { for (let i = 0; i < 6; i++) yield { f: i % 2 ? 'armsUp' : 'walk2', t: 180, fx: i === 0 ? 'note' : null }; yield { f: 'stand', t: 250 }; },
  *flatten(d) { yield { f: 'crouch', t: 120 }; yield { f: 'lie', t: 900 }; yield { f: 'lie', t: 400, fx: '?' }; yield { f: 'sit', t: 250 }; yield { f: 'stand', t: 250 }; },
  *confused(d) { yield { f: 'stand', t: 300, fx: '?' }; yield { f: 'stand', t: 300, face: -d.face }; yield { f: 'stand', t: 300, face: -d.face }; yield { f: 'blink', t: 150 }; },
  *annoyed(d) { for (let i = 0; i < 3; i++) { yield { f: 'crouch', t: 120 }; yield { f: 'stand', t: 140, fx: i === 0 ? 'hash' : null }; } yield { f: 'roar', t: 500 }; yield { f: 'stand', t: 300, face: -d.face }; },
};
const WAKE = ['startle', 'confused'];

// ---- engine ------------------------------------------------------------------------------

export class Dino {
  constructor({ anchor, getProgress }) {
    this.anchor = anchor;           // the TODAY element in the status bar
    this.getProgress = getProgress; // () => ({ today, goal })
    this.root = document.createElement('div');
    this.root.id = 'dino';
    this.root.setAttribute('aria-hidden', 'true');
    this.canvas = document.createElement('canvas');
    this.hit = document.createElement('div');
    this.hit.className = 'dino-hit';
    this.hit.title = '';
    this.root.append(this.canvas, this.hit);
    document.body.append(this.root);
    this.ctx = this.canvas.getContext('2d');

    this.x = 30; this.face = 1; this.y = 0;
    this.frame = 'sit';
    this.effects = [];
    this.energy = 0;      // 0 calm … 1 lively (smoothed)
    this.heat = 0;        // recent writing (decays)
    this.lastWrite = performance.now(); // idle time counts from launch: it starts awake
    this.queue = [];      // pending reactions
    this.pokes = [];
    this.step = null;
    this.gen = null;
    this.paused = null;   // activity interrupted by a reaction
    this.prevActivity = '';
    this.timer = 0;
    this.lastTick = performance.now();
    this.lastSig = '';
    this.enabled = true;

    this.hit.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); this.poke(); });
    // TODAY moves whenever anything before it in the status bar changes width.
    const ro = new ResizeObserver(() => this.place());
    for (const el of anchor.parentElement.children) ro.observe(el);
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
  wrote(n) {
    if (n <= 0) return;
    this.heat += Math.min(n, 50); // a single big change counts like a burst, not a marathon
    this.lastWrite = performance.now();
  }

  poke() {
    const now = performance.now();
    this.pokes = this.pokes.filter((t) => now - t < 3000);
    this.pokes.push(now);
    if (this.queue.length >= 2) return; // a couple queued is plenty; extra clicks are absorbed
    let name;
    if (this.pokes.length >= 5) { name = 'annoyed'; this.pokes = []; }
    else if (postureOf(this.frame) === 'lie' && this.activity === 'sleep') name = WAKE[rint(0, WAKE.length - 1)];
    else {
      const all = Object.keys(REACTIONS).filter((k) => k !== 'annoyed' && k !== this.lastReaction);
      name = all[rint(0, all.length - 1)];
    }
    this.lastReaction = name;
    this.queue.push(name);
    if (this.activity === 'sleep') this.wakeUp = true;
    this.schedule(0);
  }

  // -- layout --
  get pxDev() { return Math.max(1, Math.round(1.25 * (window.devicePixelRatio || 1))); }
  maxX() { return Math.max(0, this.stripW - W * this.pxDev / (window.devicePixelRatio || 1)); }

  place() {
    const r = this.anchor.getBoundingClientRect();
    const visible = this.enabled && r.width > 0 && getComputedStyle(this.anchor).display !== 'none';
    this.root.hidden = !visible;
    if (!visible) return;
    const dpr = window.devicePixelRatio || 1;
    const p = this.pxDev;
    this.stripW = Math.max(120, Math.round(r.width));
    const hDev = (H + 9) * p;
    this.canvas.width = Math.round(this.stripW * dpr);
    this.canvas.height = hDev;
    this.canvas.style.width = this.canvas.width / dpr + 'px';
    this.canvas.style.height = hDev / dpr + 'px';
    Object.assign(this.root.style, { left: Math.round(r.left) + 'px', top: Math.round(r.top - hDev / dpr) + 'px' });
    this.x = Math.min(this.x, this.maxX());
    this.lastSig = '';
    this.draw();
  }

  // -- activity level from real writing --
  updateEnergy(dt) {
    this.heat *= Math.exp(-dt / 120000);                       // words written, fading over ~2 min
    const wpm = this.heat / 2;                                  // ≈ words per minute recently
    const { today = 0, goal = 0 } = this.getProgress() || {};
    const goalPart = goal > 0 ? 0.12 * Math.min(1, today / goal) : 0;
    const target = Math.min(1, 1 - Math.exp(-wpm / 14) + goalPart * (wpm > 1 ? 1 : 0.3));
    this.energy += (target - this.energy) * (1 - Math.exp(-dt / 20000)); // glide, never jump
  }

  pickActivity() {
    const e = this.energy;
    const idle = (performance.now() - this.lastWrite) / 1000;
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
    };
    if (w[this.prevActivity]) w[this.prevActivity] *= 0.25; // variety
    let sum = 0;
    for (const k in w) sum += w[k];
    let r = Math.random() * sum;
    for (const k in w) { r -= w[k]; if (r <= 0) return k; }
    return 'rest';
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

  nextStep() {
    // Reactions go in between steps of the current activity, never through one.
    if (this.queue.length && !this.inReaction) {
      const name = this.queue.shift();
      const resumePosture = postureOf(this.frame);
      const self = this;
      this.paused = this.gen;
      this.inReaction = true;
      this.gen = (function* () {
        yield* self.getTo('stand');
        yield* REACTIONS[name](self);
        if (self.activity !== 'sleep' && resumePosture !== 'stand') yield* self.getTo(resumePosture);
      })();
    }
    for (let guard = 0; guard < 4; guard++) {
      if (!this.gen) {
        const a = this.pickActivity();
        this.activity = a;
        this.prevActivity = a;
        this.gen = ACTIVITIES[a](this);
      }
      const r = this.gen.next();
      if (!r.done) return r.value;
      if (this.inReaction) {
        this.inReaction = false;
        this.gen = this.wakeUp ? null : this.paused; // a poked sleeper stays awake
        this.wakeUp = false;
        this.paused = null;
        if (this.queue.length) return this.nextStep();
      } else this.gen = null;
    }
    return { f: 'stand', t: 500 };
  }

  schedule(delay) {
    clearTimeout(this.timer);
    if (document.hidden || !this.enabled) return; // no work at all in the background
    this.timer = setTimeout(() => this.tick(), delay);
  }

  tick() {
    const now = performance.now();
    const dt = Math.min(1000, now - this.lastTick);
    this.lastTick = now;
    this.updateEnergy(dt);
    let s = this.step;
    if (!s || now >= s.end) {
      if (s) { this.x = s.x1; this.y = 0; }
      const v = this.nextStep();
      if (v.face) this.face = v.face;
      const x1 = Math.max(0, Math.min(this.maxX(), this.x + (v.dx || 0)));
      s = this.step = { ...v, start: now, end: now + v.t, x0: this.x, x1 };
      this.frame = v.f;
      if (v.fx) this.effects.push({ g: v.fx, t0: now, x: this.x, face: this.face });
    }
    const k = Math.min(1, (now - s.start) / (s.end - s.start));
    this.x = s.x0 + (s.x1 - s.x0) * k;
    this.y = s.jump ? s.jump * 4 * k * (1 - k) : 0;
    this.effects = this.effects.filter((e) => now - e.t0 < 1400);
    this.draw(now);
    const moving = s.x1 !== s.x0 || s.jump || this.effects.length;
    this.schedule(moving ? 90 : Math.max(16, Math.min(250, s.end - now)));
  }

  draw(now = performance.now()) {
    if (this.root.hidden) return;
    const p = this.pxDev, dpr = window.devicePixelRatio || 1;
    const px = Math.round(this.x * dpr / p) * p;  // snap to the sprite's pixel grid
    const py = Math.round(this.y) * p;
    const fx = this.effects.map((e) => `${e.g}${Math.round((now - e.t0) / 140)}`).join();
    const sig = `${this.frame}|${px}|${py}|${this.face}|${fx}`;
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    const c = this.ctx, cw = this.canvas.width, ch = this.canvas.height;
    c.clearRect(0, 0, cw, ch);
    c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#000';
    const rows = FRAMES[this.frame] || FRAMES.stand;
    const top = ch - H * p - py;
    for (let r = 0; r < H; r++) {
      const row = rows[r] || '';
      for (let i = 0; i < W; i++) {
        if (row[i] !== '#') continue;
        const col = this.face > 0 ? i : W - 1 - i;
        c.fillRect(px + col * p, top + r * p, p, p);
      }
    }
    for (const e of this.effects) {
      const g = GLYPHS[e.g];
      if (!g) continue;
      const age = (now - e.t0) / 1400;
      const rise = Math.round(age * 5) * p;
      const gx = px + (e.face > 0 ? 13 : 2) * p + (e.g === 'z' ? Math.round(age * 3) * p * e.face : 0);
      const gy = top - 6 * p - rise + 2 * p;
      for (let r = 0; r < 5; r++) for (let i = 0; i < 3; i++) if (g[r][i] === '#') c.fillRect(gx + i * p, gy + r * p, p, p);
    }
    // Click target follows the dinosaur.
    const s = p / dpr;
    Object.assign(this.hit.style, { left: px / dpr + 'px', top: top / dpr + 'px', width: W * s + 'px', height: H * s + 'px' });
  }
}

export const _test = { FRAMES, W, H, ACTIVITIES, REACTIONS, postureOf };
