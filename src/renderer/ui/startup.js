// STET starts with its window hidden (main.js) and shows it in one go once everything it restores
// (theme, panels, toolbar, the screenplay) is in place and painted. Until then the page has the
// class "starting": panels and menus take their place without moving (motion.js), and no CSS
// transition runs (style.css).

let done = false;

/** STET has started (or needs to be seen now: a question while starting): show the window. */
export function started() {
  if (done) return;
  done = true;
  document.documentElement.classList.remove('starting');
  window.stet.invoke('app:ready').catch(() => {});
}
