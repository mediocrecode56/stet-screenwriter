// A side panel made wider by dragging its inner edge (Scenes on its right, Notes and the revision on
// their left): the resize cursor shows within a few pixels of the edge, a drag widens it from its
// usual width up to twice that, a double-click on the edge puts it back. The panel itself watches the
// pointer (no handle element), so a panel that redraws its contents keeps working. While the toolbar's
// lock is on, nothing is resizable.

const GRIP = 5; // px inside the edge that take the drag

/**
 * el: the panel; edge: 'left' | 'right' (the side that moves); base: its usual width;
 * locked(): resizing is off; onDone(width): the width it was left at (to keep).
 */
export function resizable(el, { edge, base, locked, onDone }) {
  const max = base * 2;
  el.dataset.edge = edge;
  const near = (e) => {
    if (locked()) return false;
    const r = el.getBoundingClientRect();
    return edge === 'right' ? e.clientX >= r.right - GRIP && e.clientX <= r.right + 1 : e.clientX <= r.left + GRIP && e.clientX >= r.left - 1;
  };
  const set = (w) => { el.style.width = Math.round(Math.max(base, Math.min(max, w))) + 'px'; };
  el.addEventListener('mousemove', (e) => { if (!document.body.classList.contains('rs-drag')) el.classList.toggle('rs-near', near(e)); });
  el.addEventListener('mouseleave', () => el.classList.remove('rs-near'));
  // Captured, so the list under the edge never takes the press as a click on a row.
  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !near(e)) return;
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, w0 = el.getBoundingClientRect().width, dir = edge === 'right' ? 1 : -1;
    document.body.classList.add('rs-drag');
    el.classList.add('rs-near');
    const move = (m) => set(w0 + (m.clientX - x0) * dir);
    const up = () => {
      removeEventListener('mousemove', move, true);
      removeEventListener('mouseup', up, true);
      document.body.classList.remove('rs-drag');
      el.classList.remove('rs-near');
      onDone(el.getBoundingClientRect().width);
    };
    addEventListener('mousemove', move, true);
    addEventListener('mouseup', up, true);
  }, true);
  el.addEventListener('dblclick', (e) => { if (near(e)) { e.preventDefault(); e.stopPropagation(); set(base); onDone(base); } }, true);
  return { set, max };
}
