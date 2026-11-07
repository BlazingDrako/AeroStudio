// Guidance, Navigation & Control module: tabbed tools sharing the Flight & Atmosphere layout and aircraft state
// (perfShared.js), so the aircraft, flight condition and CG chosen in either module carry over to the other.
import { h } from '../../lib/ui.js';
import { session } from '../../lib/state.js';
import { perf, PERF0 } from '../flight/perfShared.js';
import { concepts } from './learn.js';
import { unitsControl } from '../flight/common.js';

// load: null marks a tab that is planned but not built yet (shown greyed out)
const TABS = [
  { id: 'loops', label: 'Control loops', load: () => import('./loopsTab.js').then(m => m.loopsTab) },
  { id: 'fbw', label: 'Augmentation & FBW', load: () => import('./fbwTab.js').then(m => m.fbwTab) },
  { id: 'autopilot', label: 'Autopilots', load: () => import('./autopilotTab.js').then(m => m.autopilotTab) },
  { id: 'nav', label: 'Navigation', load: () => import('./navTab.js').then(m => m.navTab) },
  { id: 'ins', label: 'INS & GNSS', load: () => import('./insTab.js').then(m => m.insTab) },
  { id: 'collab', label: 'Collaborative flight', load: () => import('./collabTab.js').then(m => m.collabTab) },
];

export const gncModule = {
  id: 'gnc',
  title: 'Guidance, Navigation & Control',
  tabs: TABS.filter(t => t.load).map(t => ({ id: t.id, label: t.label })), concepts,
  mount(root) {
    const controls = h('aside', { class: 'af-controls cf-controls' });
    const main = h('section', { class: 'cf-main' });
    const head = h('div', { class: 'af-head cf-head' });
    const tabs = h('div', { class: 'tabs tabs-wrap', role: 'tablist' });
    head.append(h('div', {}, h('h2', { class: 'af-title' }, 'Guidance, Navigation & Control'), h('div', { class: 'af-sub' }, 'Feedback that flies the aircraft, finds where it is, and flies it as part of a team')),
      h('div', { class: 'flt-units' }, unitsControl()), tabs);
    const body = h('div', { class: 'cf-body' });
    const learn = h('div', { class: 'cf-learn' }, h('h3', {}, 'Learn the concepts'),
      h('div', { class: 'cf-concepts' }, ...concepts.map(c => h('details', { class: 'concept' }, h('summary', {}, c.title), h('div', { class: 'body', html: c.html })))));
    main.append(head, body, learn);
    root.append(h('div', { class: 'af cf flt-mod' }, controls, main));
    const sess = session('gnc', { title: 'Guidance, Navigation & Control', tab: () => cur && cur.id });
    head.append(sess.toolbar()); sess.watch(root);
    sess.keep('aircraft', perf, { defaults: PERF0, skip: ['version'] }); perf.version++;
    const btns = {};
    let cur = null, token = 0;
    const cache = {};
    const live = TABS.filter(t => t.load);
    const setTab = async (id, params) => {
      const t = live.find(x => x.id === id) || live[0];
      for (const [k, b] of Object.entries(btns)) b.classList.toggle('on', k === t.id);
      const my = ++token;
      if (cur && cur.id !== t.id) { cur.inst.controls.remove(); cur.inst.main.remove(); }
      if (!cache[t.id]) {
        body.replaceChildren(h('div', { class: 'hint', style: { padding: '20px' } }, 'Loading…'));
        const fn = await t.load();
        if (my !== token) return;
        cache[t.id] = fn({ go: setTab, keep: (o, opt) => sess.keep(t.id, o, opt) });
      }
      if (my !== token) return;
      const inst = cache[t.id];
      controls.replaceChildren(inst.controls); body.replaceChildren(inst.main);
      cur = { id: t.id, inst };
      if (params && inst.load) inst.load(params);
      inst.show && inst.show();
      const url = '#/gnc?tab=' + t.id;
      if (location.hash !== url) history.replaceState(null, '', url);
    };
    for (const t of TABS) {
      const b = h('button', { type: 'button', role: 'tab', disabled: t.load ? null : '', title: t.load ? '' : 'Coming soon', style: t.load ? null : { opacity: 0.45, cursor: 'default' } }, t.label);
      if (t.load) b.addEventListener('click', () => setTab(t.id));
      tabs.append(b); btns[t.id] = b;
    }
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    setTab(q.get('tab') || 'loops');
    this._cleanup = () => { token++; sess.dispose(); for (const k in cache) cache[k].destroy && cache[k].destroy(); };
  },
  unmount() { this._cleanup && this._cleanup(); },
};
