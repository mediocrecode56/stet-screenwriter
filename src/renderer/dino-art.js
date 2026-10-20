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
// Lying on its front, chin on the ground.
const LIE = [
  BLANK, BLANK, BLANK, BLANK, BLANK, BLANK,
  '...........######.',
  '..........##o#####',
  '..........########',
  '..........####....',
  '........######....',
  '#.....##########..',
  '################..',
  '..#############...',
];
// On its back, feet in the air: the standing dinosaur upside down, its head turned to the side.
const FALLEN = [
  BLANK, BLANK, BLANK, BLANK,
  '....###..###......',
  '....##...##.......',
  '...########.......',
  '..##########......',
  '.############.....',
  '###...##########..',
  '##.....#########..',
  '#.......##########',
  '#........###o#####',
  '...........######.',
];
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
/** `head` drawn over `base` with its top at row `top` (sniffing, digging, bowing, cowering). */
function headOver(base, head, top) {
  return base.map((row, r) => {
    const h = HEAD[head][r - top];
    if (!h) return row;
    let out = '';
    for (let i = 0; i < W; i++) out += h[i] !== '.' ? h[i] : row[i];
    return out;
  });
}
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
  lieBreath: withRow(LIE, 10, '.......#######....'),
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
  mug: [['###.', '#.##', '#.#.', '###.']],
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
};
// Drawn lighter: water, light and things far off.
export const ALPHA = { puddle: 0.5, rainbow: 0.4, cloud: 0.85, sun: 0.75, moon: 0.8 };

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
