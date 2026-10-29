// STET starts with its window hidden (main.js) and shows it in one go once everything it restores
// (theme, panels, toolbar, the screenplay) is in place and painted. Until then the page has the
// class "starting": panels and menus take their place without moving (motion.js), and no CSS
// transition runs (style.css).
//
// Once the window is on screen, its contents come up in one soft fade (class "opening": style.css),
// so nothing the window system does as it shows the window (a resize, a last layout pass) is seen
// as a jump: the bar colour first, then everything in place.

let done = false;

/** STET has started (or needs to be seen now: a question while starting): show the window. */
export function started() {
  if (done) return;
  done = true;
  const root = document.documentElement;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!still) root.classList.add('opening');
  root.classList.remove('starting');
  const open = () => {
    if (!root.classList.contains('opening')) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      root.classList.replace('opening', 'opened');
      setTimeout(() => root.classList.remove('opened'), 340); // (so a menu added later doesn't fade up the same way)
    }));
  };
  window.stet.invoke('app:ready').then(open, open);
  setTimeout(() => root.classList.remove('opening'), 1500); // (never left faded, whatever happens)
}
