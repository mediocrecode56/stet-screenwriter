// While another application has the focus, STET takes no clicks (core/wake.js): the press that brings
// the window back, and everything that press would set off (its release, click, double click, context
// menu), is stopped here, before any other listener sees it. Imported first, so these run first.

import { wakingPress } from '../../core/wake.js';

let away = !document.hasFocus(), backAt = -Infinity, eating = false;
addEventListener('blur', () => { away = true; });
addEventListener('focus', (e) => { backAt = e.timeStamp; });
const eat = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
addEventListener('pointerdown', (e) => {
  eating = wakingPress({ away, focused: document.hasFocus(), backAt, at: e.timeStamp });
  away = false;
  if (eating) eat(e);
}, true);
for (const type of ['mousedown', 'pointerup', 'mouseup', 'click', 'auxclick', 'dblclick', 'contextmenu']) {
  addEventListener(type, (e) => { if (eating) eat(e); }, true);
}
