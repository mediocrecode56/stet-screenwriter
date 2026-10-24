// The writing companion's pixel art: the dinosaur's frames, its props and the
// things it meets (a palm tree, a rain cloud, a flower…), and the little
// glyphs drawn above its head. Facing right; '#' ink, 'o' eye hole, '.' empty.
// Pure data, shared by the behaviour engine (sizes, mouth and head positions)
// and the drawing code.

export const W = 18, H = 14;

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
  // Head up, mouth open: howling, singing, catching raindrops.
  howl: [
    '............#####.',
    '...........##o###.',
    '..........#####...',
    '..........###.....',
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
// The tail swung down (alternating with BODY, a wag).
const BODY_TAIL_DOWN = [
  '.........#####....',
  '........######....',
  '.......#########..',
  '#.....########.#..',
  '#############.....',
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
  run1: ['..##.......##.....', '.##.........##....'],
  run2: ['.....##.##........', '.....#####........'],
  tuck: ['.....######.......', '..................'],
  kick: ['....##.....###....', '....###.......##..'],
  oneLeg: ['......##..........', '......###.........'],
};
// Sitting and lying keep the head and body at their standing size, so it is always recognisably itself.
// Sitting: the legs folded under, a thigh and a foot on the ground.
const SIT_BOTTOM = ['..###########.....', '.#####...#####....'];
const BLANK = '..................';
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

function compose(head, body, legs) { return [...HEAD[head], ...body, ...legs]; }
function sit(head) { return [BLANK, BLANK, ...HEAD[head], ...BODY.slice(0, 5), ...SIT_BOTTOM].slice(0, H); }
// The face is always one of the HEAD drawings, whole and unchanged: frames that lower, lay
// down or turn over the head place it with headOver(), so nothing of the body shows through
// it (the mouth stays open, the jaw whole). FACE says where each frame's head is; a test checks every frame.
/**
 * `head` drawn over `base` with its top at row `top` (sniffing, digging, bowing,
 * cowering, lying; `upsideDown` on its back). The head is in front: from its outline
 * on, each row is the head's own, so the body never fills its mouth or changes its shape.
 */
function headOver(base, head, top, upsideDown = false) {
  const rows = upsideDown ? [...HEAD[head]].reverse() : HEAD[head];
  return base.map((row, r) => {
    const h = rows[r - top];
    if (!h) return row;
    const from = h.search(/[^.]/);
    return row.slice(0, from) + h.slice(from);
  });
}
// Lying on its front, chin on the ground: neck and body low, the head as when standing.
const LIE = headOver([
  BLANK, BLANK, BLANK, BLANK, BLANK, BLANK, BLANK, BLANK, BLANK, BLANK,
  '........##........',
  '#.....##########..',
  '################..',
  '..#############...',
], 'open', 6);
// On its back, feet in the air: the standing dinosaur upside down, head and all.
const FALLEN = headOver([BLANK, BLANK, BLANK, BLANK, ...LEGS.stand.slice().reverse(), ...BODY.slice().reverse(), BLANK], 'open', 9, true);
// Lying on its front with the head raised, looking up at the sky.
const LIE_UP = [
  BLANK, BLANK, BLANK, BLANK,
  '............#####.',
  '...........##o###.',
  '..........#######.',
  '..........#####...',
  '..........####....',
  '..........####....',
  '.........#####....',
  ...LIE.slice(11),
];
const STAND_BASE = [BLANK, BLANK, BLANK, BLANK, BLANK, ...BODY, ...LEGS.stand];
const CROUCH_BASE = [BLANK, BLANK, BLANK, BLANK, BLANK, BLANK, ...BODY, LEGS.tuck[0]];
const withRow = (rows, i, row) => rows.map((r, k) => (k === i ? row : r));

export const FRAMES = {
  stand: compose('open', BODY, LEGS.stand),
  blink: compose('blink', BODY, LEGS.stand),
  walk1: compose('open', BODY, LEGS.walk1),
  walk2: compose('open', BODY, LEGS.walk2),
  run1: compose('open', BODY, LEGS.run1),
  run2: compose('open', BODY_TAIL_DOWN, LEGS.run2),
  roar: compose('roar', BODY, LEGS.stand),
  yawn: compose('roar', BODY, LEGS.stand).map((r) => r.replace('o', '#')),
  up: compose('up', BODY, LEGS.stand),
  howl: compose('howl', BODY, LEGS.stand),
  wag: compose('open', BODY_TAIL_DOWN, LEGS.stand),
  armsUp: compose('open', BODY_ARMS_UP, LEGS.stand),
  crouch: [BLANK, ...compose('open', BODY, LEGS.tuck)].slice(0, H),
  cower: headOver(CROUCH_BASE, 'blink', 4),
  jump: compose('open', BODY, LEGS.tuck),
  kick: compose('open', BODY, LEGS.kick),
  oneLeg: compose('open', BODY_ARMS_UP, LEGS.oneLeg),
  sniff: headOver(STAND_BASE, 'open', 4),
  sniffBlink: headOver(STAND_BASE, 'blink', 4),
  // Creeping along with its nose to the ground: the sniffing head on walking legs.
  creep1: headOver([BLANK, BLANK, BLANK, BLANK, BLANK, ...BODY, ...LEGS.walk1], 'open', 4),
  creep2: headOver([BLANK, BLANK, BLANK, BLANK, BLANK, ...BODY, ...LEGS.walk2], 'open', 4),
  // Crouched right down, jaws at the ground: biting at the very edge of things.
  gnaw: headOver(CROUCH_BASE, 'roar', 7),
  gnawShut: headOver(CROUCH_BASE, 'blink', 7),
  chomp: headOver(STAND_BASE, 'roar', 4),
  hunch: headOver(STAND_BASE, 'blink', 2),
  stretch: STRETCH,
  sit: sit('open'),
  sitBlink: sit('blink'),
  sitBreath: sit('open').map((r, i) => (i === 8 ? '#.......#######....'.slice(0, W) : r)),
  sitUp: sit('up'),
  sitHowl: sit('howl'),
  sitChew: sit('roar'),
  sitTap1: sit('open'),
  sitTap2: withRow(withRow(sit('open'), 10, '###...########....'), 11, '.############.#...'),
  sitScratch1: withRow(sit('blink'), 10, '###...########.##.'),
  sitScratch2: withRow(withRow(sit('blink'), 9, '##.....##########.'), 10, '###...########....'),
  lie: LIE,
  lieBreath: withRow(LIE, 10, '.......#########..'), // the back rises; the jaw stays as it is
  lieUp: LIE_UP,
  lieUpBlink: LIE_UP.map((r) => r.replace('o', '#')),
  lieUpHowl: withRow(withRow(LIE_UP, 6, '..........#####...'), 7, '..........###.....'),
  lieUpTail: withRow(LIE_UP, 11, '##....##########..'),
  fallen: FALLEN,
};

// Postures, so a reaction can get up first and the activity can sit back down after.
const POSTURE = { sit: 'sit', sitBlink: 'sit', sitBreath: 'sit', sitUp: 'sit', sitHowl: 'sit', sitChew: 'sit', sitTap1: 'sit', sitTap2: 'sit', sitScratch1: 'sit', sitScratch2: 'sit', lie: 'lie', lieBreath: 'lie', lieUp: 'lie', lieUpBlink: 'lie', lieUpHowl: 'lie', lieUpTail: 'lie', fallen: 'lie' };
export const postureOf = (f) => POSTURE[f] || 'stand';
// Frames that may follow a sitting one directly (they are the getting-up movement themselves).
export const GET_UP = new Set(['crouch', 'cower', 'sniff', 'sniffBlink']);

// Where the mouth and the top of the head are (col, row) — for carried props and hats.
const at = (pairs) => Object.fromEntries(pairs.flatMap(([names, v]) => names.split(' ').map((n) => [n, v])));
export const MOUTH = at([
  ['stand blink walk1 walk2 run1 run2 roar yawn jump wag kick armsUp oneLeg', [16, 3]],
  ['up howl', [16, 2]], ['sniff sniffBlink chomp creep1 creep2', [16, 7]], ['gnaw gnawShut', [16, 10]], ['cower', [16, 7]], ['hunch', [16, 5]], ['crouch', [16, 4]],
  ['sit sitChew sitBlink sitBreath sitTap1 sitTap2 sitScratch1 sitScratch2', [16, 5]], ['sitUp sitHowl', [16, 4]],
  ['stretch', [17, 3]], ['lie lieBreath', [17, 8]], ['lieUp lieUpBlink lieUpHowl lieUpTail', [16, 6]],
]);
export const HEAD_TOP = at([
  ['stand blink walk1 walk2 run1 run2 roar yawn armsUp kick oneLeg jump wag', [14, 0]], ['up howl stretch', [15, 0]],
  ['crouch', [14, 1]], ['sniff sniffBlink chomp cower creep1 creep2', [14, 4]], ['gnaw gnawShut', [14, 7]], ['hunch', [14, 2]],
  ['sit sitBlink sitBreath sitChew sitTap1 sitTap2 sitScratch1 sitScratch2', [14, 2]], ['sitUp sitHowl', [15, 2]],
  ['lie lieBreath', [14, 6]], ['lieUp lieUpBlink lieUpHowl lieUpTail', [15, 4]],
]);

/**
 * Where each frame's head is: its top row, its left column (its HEAD drawing's columns
 * from there on) and whether it is upside down. The drawing code keeps these rows and
 * columns at one even pixel size, so the face never changes shape (turning round,
 * turning over, growing); a test checks that every frame's head is a HEAD drawing.
 */
export const FACE = Object.fromEntries(Object.keys(FRAMES).map((f) => [f,
  f === 'fallen' ? { top: 9, left: 10, upsideDown: true } : { top: HEAD_TOP[f][1], left: f === 'stretch' ? 11 : 10, upsideDown: false }]));
export const HEADS = HEAD;

/**
 * Pixel edges for drawing a frame `cell` device px per sprite pixel: `cols` (W+1) and
 * `rows` (H+1) running sums from the left and the top of the sprite, by sprite pixel,
 * never by screen position, so a mirrored or upside-down drawing has exactly the same
 * shape. A cell that isn't a whole number of device px (growing with the streak, odd
 * display scales) makes some pixels a device px bigger than others: the head's rows and
 * columns all get the same whole size, and the difference goes to the body, tail and legs.
 */
const edgeCache = new Map();
export function spriteEdges(frame, cell) {
  const key = frame + '|' + cell;
  let e = edgeCache.get(key);
  if (!e) {
    const f = FACE[frame] || FACE.stand;
    e = { cols: edges(W, cell, (i) => i >= f.left), rows: edges(H, cell, (r) => r >= f.top && r < f.top + 5) };
    if (edgeCache.size > 400) edgeCache.clear();
    edgeCache.set(key, e);
  }
  return e;
}
function edges(n, cell, inHead) {
  const total = Math.round(n * cell), k = Math.max(1, Math.round(cell));
  const head = [...Array(n).keys()].filter(inHead), rest = n - head.length;
  const left = total - k * head.length; // device px for everything else
  const base = rest ? Math.floor(left / rest) : 0, extra = rest ? left - base * rest : 0;
  const out = [0];
  let j = 0;
  for (let i = 0; i < n; i++) {
    let size = k;
    if (!inHead(i)) { size = base + (Math.floor(((j + 1) * extra) / rest) - Math.floor((j * extra) / rest)); j++; } // the extra px spread evenly
    out.push(out[i] + Math.max(0, size));
  }
  return out;
}

/** A rainbow: two dotted arcs, w×h. */
function rainbow(w, h) {
  const rows = [];
  const cx = (w - 1) / 2;
  for (let y = 0; y < h; y++) {
    let row = '';
    for (let x = 0; x < w; x++) {
      const d = Math.hypot((x - cx) / (w / 2), (h - y - 0.5) / h);
      row += (d > 0.86 && d <= 1) || (d > 0.66 && d <= 0.76 && (x + y) % 2 === 0) ? '#' : '.';
    }
    rows.push(row);
  }
  return rows;
}

// Props and the things it meets (same pixel scale as the dinosaur; every frame of one kind is the same width).
export const PROPS = {
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
  // A palm tree, from a sprout to full height (taller than the dinosaur when grown).
  palm: [
    ['.....#.#.....', '......#......'],
    ['.....#.#.....', '....#.#.#....', '......#......', '......#......', '......#......', '.....###.....'],
    ['....##.##....', '..##..#..##..', '.#...###...#.', '....#.##.#...', '......##.....', '......##.....', '.......##....', '.......##....', '......##.....', '......##.....', '......##.....', '.....####....'],
    ['...###.###...', '.##...#...##.', '#...#####...#', '...##.#.##...', '..#..###..#..', '.#....##...#.', '......##.....', '......##.....', '.......##....', '.......##....', '.......##....', '......##.....', '......##.....', '......##.....', '.....##......', '.....##......', '.....##......', '......##.....', '......##.....', '....######...'],
  ],
  coconut: [['.##.', '####', '.##.']],
  cloud: [
    ['......####........', '...#########......', '..############....', '.###############..', '##################', '.################.'],
    ['......####........', '...#########......', '..############....', '.###############..', '##################', '#.#.#.#.#.#.#.#.#.'],
  ],
  puddle: [['......####......'], ['...##########...'], ['################']],
  rainbow: [rainbow(37, 17)],
  flower: [
    ['..#.#..', '...#...'],
    ['.#...#.', '..#.#..', '...#...', '...#...'],
    ['...#...', '..###..', '...#...', '.#.#.#.', '..##...', '...#...', '...#...'],
    ['..###..', '.#...#.', '#..#..#', '.#...#.', '..###..', '...#...', '.#.#...', '..##.#.', '...##..', '...#...'],
    ['...#...', '...#...', '.#.#...', '..##.#.', '...##..', '...#...'],
  ],
  mushroom: [
    ['..#####..'],
    ['..#####..', '.#######.', '...###...'],
    ['..#####..', '.##.#.##.', '#########', '.#######.', '...###...', '...###...', '..#####..'],
    ['.#######.', '#########', '...###...', '..#####..'],
  ],
  snail: [['..##..#', '.#..#.#', '.#.##.#', '#######'], ['..##...', '.#..#..', '.#.##..', '.####..']],
  bird: [['...##', '####.', '.#...'], ['#...#', '.#.#.', '..#..'], ['.....', '#####', '..#..']],
  bubble: [['.#.', '#.#', '.#.']],
  firefly: [['#']],
  page: [['####', '#..#', '####']],
  wad: [['.##.', '#.##', '.##.']], // a page crumpled up
  // Little creatures that live in the grass (the tufts that grow while you're away), facing right.
  mouse: [['....#.', '#####.', '.#..#.'], ['....#.', '#####.', '#....#']],
  lizard: [['.....##', '#######', '.#..#..'], ['.....##', '#######', '#....#.']],
  bunny: [['..#.#', '..###', '####.', '.#.#.'], ['..#.#', '..###', '####.', '#...#']],
  // Plants that come up only after a very long sleep, growing a stage at a time (and withering back).
  fern: [['.......', '.......', '.......', '..#.#..', '...#...'], ['.......', '.......', '.#...#.', '..#.#..', '...#...'], ['.......', '#..#..#', '.#.#.#.', '..###..', '...#...'], ['.#.#.#.', '#..#..#', '.#.#.#.', '..###..', '...#...']],
  bloom: [['.......', '.......', '.......', '.......', '...#...', '...#...'], ['.......', '.......', '..###..', '...#...', '..##...', '...#...'], ['.......', '.#.#.#.', '..###..', '.#.#.#.', '..##...', '...#...'], ['.#...#.', '###.###', '.#.#.#.', '..###..', '.#.#...', '...#...']],
  reed: [['.....', '.....', '.....', '.#.#.', '.#.#.'], ['.....', '.....', '#.#..', '.#.#.', '.#.#.'], ['.....', '#.#.#', '#.#.#', '.#.#.', '.#.#.'], ['#...#', '#.#.#', '#.#.#', '.#.#.', '.#.#.']],
  stick: [['#......', '.######', '...#...']], // a twig with a stub of a branch
  mug: [['###.', '#.##', '#.#.', '###.']],
  // A squiggle scratched into the sand, a stroke at a time.
  doodle: [['.......', '#......'], ['.#.....', '#.#....'], ['.#...#.', '#.#.#..'], ['.#...#.', '#.#.#.#']],
  mound: [['......', '......', '..##..'], ['......', '.####.', '######'], ['..##..', '.####.', '######']],
  tumbleweed: [
    ['..###..', '.#.#.#.', '#.###.#', '##.#.##', '#.###.#', '.#.#.#.', '..###..'],
    ['..###..', '.##.##.', '#.#.#.#', '###.###', '#.#.#.#', '.##.##.', '..###..'],
  ],
  skateboard: [['#######', '.#...#.']],
  rocket: [['.#.', '###', '###', '#.#']],
  umbrella: [['..###..', '.#####.', '#######', '...#...']],
  // The sun and the moon, for the theme turning to day or to night.
  sun: [['...#...', '.#...#.', '..###..', '#.###.#', '..###..', '.#...#.', '...#...'], ['.......', '..#.#..', '.#####.', '..###..', '.#####.', '..#.#..', '.......']],
  moon: [['..##.', '.##..', '##...', '##...', '.##..', '..##.']],
  // Visitors that turn up now and then.
  balloon: [['.###.', '#####', '#####', '.###.', '..#..', '..#..', '.#...'], ['.###.', '#####', '#####', '.###.', '..#..', '..#..', '...#.']],
  plane: [['###...', '.#####', '..##..'], ['......', '######', '.###..']],
  frog: [['....#.', '.#####', '######', '##..##'], ['....#.', '.#####', '#####.', '#....#']],
  ladybug: [['.#.', '###'], ['#.#', '.#.']],
  seed: [['#.#', '.#.', '.#.']],
  dandelion: [
    ['..#..', '..#..'],
    ['..#..', '.##..', '..#..', '..#..'],
    ['#.#.#', '.###.', '#.#.#', '..#..', '.##..', '..#..', '..#..'],
    ['.....', '..#..', '.....', '..#..', '.##..', '..#..', '..#..'],
  ],
  // Plants that come up on their own along the ground, and wither away in their time.
  cactus: [
    ['...#...', '...#...'],
    ['...#...', '..###..', '..###.#', '..#####', '..###..', '..###..'],
    ['...#...', '..###..', '..###.#', '#.###.#', '#.#####', '#.###..', '#####..', '..###..', '..###..', '..###..'],
  ],
  grass: [
    ['.#..#..', '.##.#..'],
    ['#..#...', '.#.#.#.', '.##.##.'],
    ['...#...', '#..#..#', '.#.#.#.', '.##.##.'],
  ],
  worm: [['.....', '.....', '#####'], ['..#..', '..#..', '#####'], ['.##..', '..#..', '#####']],
  // Small finds: an acorn, a cricket (sitting, hopping), a feather (swaying), a gem (dug up, glinting in the sand).
  acorn: [['..#.', '####', '.##.', '.##.']],
  cricket: [['#....', '.###.', '#.#.#'], ['#....', '.###.', '.#.#.']],
  feather: [['...#', '.##.', '#...'], ['#...', '.##.', '...#']],
  gem: [['.#.', '###', '.#.'], ['...', '...', '.#.']],
  // Five newer neighbours (0.43). Three fly: a dragonfly (wings up, down), a bee, a kite (its tail
  // swaying; the string is drawn to whoever holds it). A rock comes out of the sand different every
  // time (rockArt, below: this one only gives its kind a size). A dung beetle rolls its ball along.
  dragonfly: [['..#.#..', '#######', '.......'], ['.......', '#######', '..#.#..']],
  bee: [['..##.', '#.#.#', '.###.'], ['.....', '#.#.#', '.###.']],
  kite: [['..#..', '.#.#.', '#.#.#', '.#.#.', '..#..', '..#..', '.#...'], ['..#..', '.#.#.', '#.#.#', '.#.#.', '..#..', '..#..', '...#.']],
  rock: [['..####..', '.######.', '########']],
  beetle: [['.###', '#.#.'], ['.###', '.#.#']],
  dung: [['.#.', '###', '.#.'], ['.##', '###', '##.']],
  pile: [['..#.#...', '.######.', '########']], // leaves swept together
};
// Drawn lighter: water, light and things far off.
export const ALPHA = { doodle: 0.55, puddle: 0.5, rainbow: 0.4, cloud: 0.85, sun: 0.75, moon: 0.8, kite: 0.9 };

/**
 * A rock as it comes out of the sand, never the same twice: 7 to 12 columns wide and 3 to 5 rows high,
 * its top a rounded random profile (highest somewhere near the middle), a few dents in its face, and
 * always a solid bottom row to stand on. `rnd` gives numbers in [0, 1).
 */
export function rockArt(rnd) {
  const w = 7 + Math.floor(rnd() * 6), h = 3 + Math.floor(rnd() * 3), peak = (0.3 + rnd() * 0.4) * (w - 1);
  const tops = [];
  for (let i = 0; i < w; i++) {
    const d = Math.abs(i - peak) / Math.max(peak, w - 1 - peak); // 0 at the peak, 1 at the far end
    tops.push(Math.max(1, Math.min(h, Math.round(h * (1 - d * d * 0.8) + (rnd() - 0.5)))));
  }
  tops[0] = Math.min(tops[0], h - 1); tops[w - 1] = Math.min(tops[w - 1], h - 1); // rounded off at both ends
  const rows = [];
  for (let r = 0; r < h; r++) {
    let row = '';
    for (let i = 0; i < w; i++) {
      const fill = h - r <= tops[i];
      const dent = fill && r > 0 && r < h - 1 && i > 0 && i < w - 1 && h - r < tops[i] && rnd() < 0.12;
      row += fill && !dent ? '#' : '.';
    }
    rows.push(row);
  }
  return rows;
}

// 3×5 pixel glyphs for little effects above the head.
export const GLYPHS = {
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
  spark: ['#.#', '.#.', '#.#', '...', '...'],
};
