// Getting a screenplay to where it lives, and knowing what is safe. It holds none of the page: `read`
// gives the bytes, so all of this runs in tests without a browser.
//
// The same promise as the desktop: a save carries the revision it wrote, and `savedRev` only moves
// forward, so a slow save can never mark newer writing as saved. Writes run one at a time.

export class Saver {
  /**
   * rev(): the document's revision. read(): the bytes to write. draft(): keep a draft now.
   * saved(): everything has reached the file, so the draft is no longer needed.
   * onState(saver): after every change of state. ask(place): something else changed the file;
   * resolves 'overwrite' or 'keep' (leave the file alone).
   */
  constructor({ rev, read, draft, saved = () => {}, onState = () => {}, ask, delay = 1200, timers = globalThis }) {
    Object.assign(this, { rev, read, draft, saved, onState, ask, delay, timers });
    this.place = null;
    this.savedRev = 0;
    this.status = 'saved'; // saved | unsaved | saving | offline | conflict
    this.error = null;
    this.timer = 0;
    this.writing = null;
  }

  get dirty() { return this.rev() !== this.savedRev; }

  /** A document was opened, from `place`. */
  opened(place, saved = true) {
    this.timers.clearTimeout(this.timer);
    this.place = place;
    this.savedRev = saved ? this.rev() : -1;
    this.status = saved ? 'saved' : 'unsaved';
    this.error = null;
    this.onState(this);
  }

  /** Called after every change: a draft soon, and the file itself if it can be saved in place. */
  changed() {
    if (!this.dirty) return;
    if (this.status === 'saved') this.status = 'unsaved';
    this.onState(this);
    this.timers.clearTimeout(this.timer);
    this.timer = this.timers.setTimeout(() => this.tick(), this.delay);
  }

  async tick() {
    if (!this.dirty) return;
    await this.draft();
    if (this.place?.inPlace && this.status !== 'conflict') await this.save();
  }

  /** Save to the place the document lives. Returns true when it got there. */
  async save({ force = false } = {}) {
    if (this.writing) await this.writing;
    if (!this.place?.inPlace) return false;
    this.writing = this.write(force);
    try { return await this.writing; } finally { this.writing = null; }
  }

  async write(force) {
    const place = this.place, rev = this.rev();
    if (rev === this.savedRev && !force) return true;
    this.status = 'saving';
    this.onState(this);
    try {
      if (!(await place.allowed())) throw Object.assign(new Error('Saving needs your permission again.'), { code: 'auth' });
      if (!force && (await place.changedElsewhere())) {
        this.status = 'conflict';
        this.onState(this);
        if ((await this.ask(place)) !== 'overwrite') return false;
        this.status = 'saving';
      }
      await place.write(await this.read());
      if (rev > this.savedRev) this.savedRev = rev;
      this.status = this.dirty ? 'unsaved' : 'saved';
      this.error = null;
      if (this.dirty) this.changed();
      else await this.saved();
      this.onState(this);
      return true;
    } catch (e) {
      await this.draft();
      this.status = 'offline';
      this.error = e;
      this.onState(this);
      return false;
    }
  }

  /** It reached somewhere else: a copy handed over, or a new place chosen. */
  savedAs(place, rev) {
    this.place = place;
    if (rev > this.savedRev) this.savedRev = rev;
    this.status = this.dirty ? 'unsaved' : 'saved';
    this.error = null;
    this.onState(this);
  }
}

/** The state as a few words for the status bar. */
export function stateText(s) {
  const where = s.place?.label;
  if (s.status === 'saving') return 'SAVING';
  if (s.status === 'conflict') return 'CHANGED ELSEWHERE';
  if (s.status === 'offline') return 'KEPT IN THIS BROWSER';
  if (s.status === 'unsaved') return s.place?.inPlace ? 'UNSAVED' : 'KEPT IN THIS BROWSER';
  if (!s.place) return 'NEW';
  return s.place.inPlace ? `SAVED TO ${where.toUpperCase()}` : 'COPY SAVED';
}
