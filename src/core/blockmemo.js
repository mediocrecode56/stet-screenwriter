// Something worked out once for each paragraph (block), kept only while the screenplay holds that
// paragraph. Blocks are replaced on every edit, so a value can be keyed on the block itself. A WeakMap
// would keep it for as long as anything holds the block, and the undo history holds every earlier
// version of a paragraph (up to 2 000 steps): a list of objects for each of them adds up to megabytes
// in a long session. Use this for anything heavier than a number; a WeakMap is fine for a number.

export class BlockMemo {
  /** make(block) → the value for a block (never undefined). */
  constructor(make) { this.make = make; this.map = new Map(); }

  get(block) {
    let v = this.map.get(block);
    if (v === undefined) { v = this.make(block); this.map.set(block, v); }
    return v;
  }

  /** Forget the blocks no longer among `blocks`, once there are clearly more of them than there are
   *  blocks (so it costs nothing on most calls). Call it from a pass over the whole screenplay. */
  keep(blocks) {
    if (this.map.size <= blocks.length * 2 + 64) return;
    const next = new Map();
    for (const b of blocks) { const v = this.map.get(b); if (v !== undefined) next.set(b, v); }
    this.map = next;
  }

  get size() { return this.map.size; }
}
