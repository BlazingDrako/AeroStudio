// "Open in another module": hand the current design to a module that can take it further.
//
// A send works like a shared link (js/lib/state.js) with merge: the values are added to the target tab's remembered
// settings, everything else there stays as the user left it, and the target opens with a note saying what came over.
import { h, icon, section } from './ui.js';
import { encodeState, toast } from './state.js';

// values: settings for the target tab's settings object (same names and units as in that tab).
// states: several { key: values } at once. replace: start those settings from their defaults instead of merging.
export async function sendTo({ mod, tab, key = tab, values, states, note, replace = false }) {
  const s = await encodeState({ v: 1, merge: !replace, note, states: states || { [key]: values } });
  location.hash = `#/${mod}?${tab ? 'tab=' + encodeURIComponent(tab) + '&' : ''}s=${s}`;
}

// items: [{ label, sub, go: () => void | string }]; go returns a string to explain why it can't send right now
export function sendSection(items) {
  const sec = section('Open in another module', { collapsible: true });
  for (const it of items) {
    const b = h('button', { class: 'send-btn', type: 'button' },
      h('span', { class: 'send-txt' }, h('span', { class: 'send-label' }, it.label), it.sub ? h('span', { class: 'send-sub' }, it.sub) : null),
      icon('send', 15));
    b.addEventListener('click', async () => { const why = await it.go(); if (typeof why === 'string') toast(why); });
    sec.body.append(b);
  }
  return sec.el;
}
