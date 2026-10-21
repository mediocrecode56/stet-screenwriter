// Shortcuts on a Mac. Command does what Ctrl does everywhere else (src/renderer/ui/commands.js),
// so shortcuts written in STET as Ctrl+Shift+S are shown the Mac way, ⇧⌘S: ⌘ for Ctrl,
// ⌥ for Alt, ⇧ for Shift, in the order Mac menus use.

export const MAC = typeof navigator !== 'undefined' && /^Mac/.test(navigator.platform || '');

/** Every shortcut in a text, the Mac way on a Mac; unchanged elsewhere. */
export function macKeys(text, mac = MAC) {
  if (!mac) return text;
  return String(text).replace(/\bCtrl\+Y\b/g, 'Ctrl+Shift+Z') // redo
    .replace(/\b((?:(?:Ctrl|Alt|Shift)\+)+)(?=\S)/g, (m) => {
      const mods = m.split('+');
      return (mods.includes('Alt') ? '⌥' : '') + (mods.includes('Shift') ? '⇧' : '') + (mods.includes('Ctrl') ? '⌘' : '');
    });
}
