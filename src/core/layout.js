// Layout cache and incremental pagination.
//
// Layout of a block (its wrapped line starts) depends only on the block value,
// so it is cached by object identity in a WeakMap: unchanged blocks are never
// re-wrapped. Pagination is a linear pass over cached line counts; after an
// edit it restarts a few blocks before the change and stops as soon as a page
// boundary lines up with the previous result ("resync"), reusing the rest.

import { ELEMENT, PAGE, spaceBefore, wrap, lineText } from './format.js';
import { cueName } from './model.js';

const cache = new WeakMap();

/** Wrapped line starts for a block (cached). */
export function linesOf(block) {
  let l = cache.get(block);
  if (l === undefined) {
    l = wrap(block.text, ELEMENT[block.type].width);
    cache.set(block, l);
  }
  return l;
}

/** Whether visual line k of block b is an empty line: the gap between two paragraphs of a speech. */
function blankLine(b, starts, k) {
  return k > 0 && k < starts.length && b.text.charCodeAt(starts[k] - 1) === 10 && lineText(b.text, starts, k) === '';
}

/** Lines of the paragraph of b that starts at line k: up to its next empty line. */
function paraLines(b, starts, k) {
  let e = k;
  while (e < starts.length && !blankLine(b, starts, e)) e++;
  return e - k;
}

const BODY = PAGE.bodyRows;
const LOOKBACK = 4; // keep-with-next chains reach at most 3 blocks ahead

function chainNext(type, nextType) {
  switch (type) {
    case 'scene': case 'shot': return nextType !== 'scene' && nextType !== 'shot';
    case 'character': return nextType === 'paren' || nextType === 'dialogue';
    case 'paren': return nextType === 'dialogue';
    default: return false;
  }
}

/** Rows that must fit on the current page before block bi may start there. */
function minNeed(blocks, bi, settings) {
  const b = blocks[bi];
  const n = linesOf(b).length;
  switch (b.type) {
    case 'action': return n < 4 ? n : 2;
    case 'dialogue': { // its first paragraph, or 2 lines + (MORE)
      const p = paraLines(b, linesOf(b), 0);
      return p < 4 ? p : 3;
    }
    case 'transition': return n;
    default: {
      const next = blocks[bi + 1];
      if (next && chainNext(b.type, next.type)) return n + spaceBefore(next.type, settings, b.type) + minNeed(blocks, bi + 1, settings);
      return n;
    }
  }
}

function inSpeech(blocks, bi) {
  const t = blocks[bi].type;
  if (t !== 'paren' && t !== 'dialogue') return false;
  const p = blocks[bi - 1];
  return !!p && (p.type === 'character' || p.type === 'paren' || p.type === 'dialogue');
}

/** "NAME (CONT'D)" cue text for a speech that continues at block bi, or null. */
export function contCue(blocks, bi, line) {
  const t = blocks[bi].type;
  if (t !== 'paren' && t !== 'dialogue') return null;
  if (line === 0 && !inSpeech(blocks, bi)) return null;
  // A page that starts with a new paragraph of the speech goes on without a cue, as Final Draft does.
  if (line > 0 && blankLine(blocks[bi], linesOf(blocks[bi]), line - 1)) return null;
  for (let i = bi - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.type === 'character') {
      const ext = b.text.replace(/\(CONT'?D\)/gi, '').trim();
      return (ext || cueName(b.text)) + " (CONT'D)";
    }
    if (b.type !== 'paren' && b.type !== 'dialogue') return null;
  }
  return null;
}

function makePage(blocks, bi, line) {
  const text = bi < blocks.length ? contCue(blocks, bi, line) : null;
  return { startBi: bi, startLine: line, items: [], more: -1, cont: text, contRow: text ? 0 : -1 };
}

/**
 * Paginate `blocks`. With `prev` (previous pages) and `dirty` ({from, to, delta}
 * in new-index space: blocks [from, to) changed, total length changed by delta)
 * only the affected region is recomputed.
 */
export function paginate(blocks, settings, prev = null, dirty = null) {
  const N = blocks.length;
  let pages = [];
  let startBi = 0, startLine = 0;
  let resyncFrom = Infinity, delta = 0, oldIdx = 0;

  if (prev && dirty && prev.length && !dirty.full) {
    // Keep every page that starts safely before the change.
    const limit = dirty.from - LOOKBACK;
    let p = 0;
    for (let i = 0; i < prev.length; i++) {
      if (prev[i].startBi <= limit) p = i; else break;
    }
    if (limit < 0) p = 0;
    pages = prev.slice(0, p);
    startBi = prev[p].startBi;
    startLine = prev[p].startLine;
    resyncFrom = dirty.to;
    delta = dirty.delta;
    oldIdx = p + 1;
  }

  if (N === 0) return [makePage(blocks, 0, 0)];

  let page = makePage(blocks, startBi, startLine);
  pages.push(page);
  let y = page.cont ? 1 : 0;
  let bi = startBi, line = startLine;

  const newPage = (nbi, nline) => {
    // A speech continuing onto the next page gets (MORE) on this one.
    if (nbi < N && page.items.length && contCue(blocks, nbi, nline)) page.more = y;
    // Resync with the previous pagination once we're past the edit: a page that starts at the
    // same place, with or without a (CONT'D) line as before, lays out as before.
    if (nbi >= resyncFrom) {
      const want = nbi - delta;
      while (oldIdx < prev.length && (prev[oldIdx].startBi < want || (prev[oldIdx].startBi === want && prev[oldIdx].startLine < nline))) oldIdx++;
      const old = prev[oldIdx];
      if (old && old.startBi === want && old.startLine === nline && !!contCue(blocks, nbi, nline) === !!old.cont) {
        let k = oldIdx;
        for (; k < prev.length; k++) {
          const shifted = shiftPage(blocks, prev[k], delta);
          if (!!shifted.cont !== !!prev[k].cont) break;
          pages.push(shifted);
        }
        if (k === prev.length) return true;
        // Page k gained or lost its (CONT'D) line (the edit changed whose speech it continues),
        // which moves its lines and the (MORE) at the foot of the page before: lay both out again.
        pages.pop();
        oldIdx = k;
        nbi = prev[k - 1].startBi + delta;
        nline = prev[k - 1].startLine;
      }
    }
    page = makePage(blocks, nbi, nline);
    pages.push(page);
    y = page.cont ? 1 : 0;
    bi = nbi; line = nline;
    return false;
  };

  while (bi < N) {
    const b = blocks[bi];
    const L = linesOf(b);
    const n = L.length - line;
    const sb = y === 0 || line > 0 || (page.cont && y === 1) ? 0 : spaceBefore(b.type, settings, bi > 0 ? blocks[bi - 1].type : null);

    if (line === 0 && y > 0) {
      const need = sb + minNeed(blocks, bi, settings);
      if (y + need > BODY && !(page.cont && y === 1)) {
        if (newPage(bi, 0)) return pages;
        continue;
      }
    }
    if (y + sb + n <= BODY) {
      page.items.push({ bi, l0: line, l1: line + n, y: y + sb });
      y += sb + n;
      bi++; line = 0;
      continue;
    }
    const isDlg = b.type === 'dialogue';
    if (isDlg) {
      // A speech of several paragraphs breaks between them, as Final Draft breaks its paragraphs:
      // after the last one that fits, unless the paragraph that doesn't is long enough to split.
      const room = BODY - y - sb;
      let e = -1;
      for (let k = line + 1; k - line <= room && k < L.length - 1; k++) if (blankLine(b, L, k)) e = k;
      if (e > 0) {
        const ps = e + 1, p = paraLines(b, L, ps);
        const take = Math.min(room - (ps - line) - 1, p - 2);
        const end = p >= 4 && take >= 2 ? ps + take : ps;
        // The empty line may sit just below the last row: it prints nothing.
        page.items.push({ bi, l0: line, l1: end, y: y + sb });
        y += sb + end - line;
        if (newPage(bi, end)) return pages;
        continue;
      }
    }
    let avail = BODY - y - sb - (isDlg ? 1 : 0);
    const fresh = page.items.length === 0;
    if (!fresh) avail = Math.min(avail, n - 2); // leave at least two lines for the next page
    if (avail >= 2 || (fresh && avail >= 1)) {
      page.items.push({ bi, l0: line, l1: line + avail, y: y + sb });
      y += sb + avail;
      if (newPage(bi, line + avail)) return pages;
      continue;
    }
    if (newPage(bi, line)) return pages;
  }
  return pages;
}

function shiftPage(blocks, p, delta) {
  const cont = p.startBi + delta < blocks.length ? contCue(blocks, p.startBi + delta, p.startLine) : null;
  if (delta === 0 && cont === p.cont) return p;
  return {
    startBi: p.startBi + delta,
    startLine: p.startLine,
    items: delta === 0 ? p.items : p.items.map((it) => ({ bi: it.bi + delta, l0: it.l0, l1: it.l1, y: it.y })),
    more: p.more,
    cont,
    contRow: cont ? 0 : -1,
  };
}

/** Merge a splice (s, removed r, added a) into an accumulated dirty range. */
export function mergeDirty(d, s, r, a) {
  if (!d) return { from: s, to: s + a, delta: a - r };
  if (d.full) return d;
  const t = d.to <= s ? d.to : d.to >= s + r ? d.to - r + a : s + a;
  return { from: Math.min(d.from, s), to: Math.max(t, s + a), delta: d.delta + a - r };
}

/** Index of the page containing (bi, line). Binary search over page starts. */
export function pageOf(pages, bi, line = 0) {
  let lo = 0, hi = pages.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const p = pages[mid];
    if (p.startBi < bi || (p.startBi === bi && p.startLine <= line)) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** Row on its page of visual line `line` of block bi, or -1. */
export function rowOf(page, bi, line) {
  for (const it of page.items) {
    if (it.bi === bi && line >= it.l0 && line < it.l1) return it.y + line - it.l0;
  }
  return -1;
}
