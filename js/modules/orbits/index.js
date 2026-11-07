// Orbital Mechanics module: tabbed tools in the shared layout (controls left, visuals right). The Orbit & elements
// and Ground tracks tabs show and edit one orbit (common.js); Transfers and Δv budget keep their own settings.
import { h } from '../../lib/ui.js';
import { session } from '../../lib/state.js';
import { concepts } from './learn.js';
import { orbit, ORBIT0 } from './common.js';

const TABS = [
  { id: 'elements', label: 'Orbit & elements', load: () => import('./elementsTab.js').then(m => m.elementsTab) },
  { id: 'transfers', label: 'Transfers', load: () => import('./transfersTab.js').then(m => m.transfersTab) },
  { id: 'ground', label: 'Ground tracks', load: () => import('./groundTab.js').then(m => m.groundTab) },
  { id: 'budget', label: 'Δv budget', load: () => import('./budgetTab.js').then(m => m.budgetTab) },
];

export const orbitsModule = {
  id: 'orbits',
  title: 'Orbital Mechanics',
  tabs: TABS.map(t => ({ id: t.id, label: t.label })), concepts,
  mount(root) {
    const controls = h('aside', { class: 'af-controls cf-controls' });
    const main = h('section', { class: 'cf-main' });
    const head = h('div', { class: 'af-head cf-head' });
    const tabs = h('div', { class: 'tabs tabs-wrap', role: 'tablist' });
    head.append(h('div', {}, h('h2', { class: 'af-title' }, 'Orbital Mechanics'), h('div', { class: 'af-sub' }, 'Two-body orbits, the six elements, transfers, ground tracks and Δv budgets')), tabs);
    const body = h('div', { class: 'cf-body' });
    const learn = h('div', { class: 'cf-learn' }, h('h3', {}, 'Learn the concepts'),
      h('div', { class: 'cf-concepts' }, ...concepts.map(c => h('details', { class: 'concept' }, h('summary', {}, c.title), h('div', { class: 'body', html: c.html })))));
    main.append(head, body, learn);
    root.append(h('div', { class: 'af cf rk-mod orb-mod' }, controls, main));
    const sess = session('orbits', { title: 'Orbital Mechanics', tab: () => cur && cur.id });
    head.append(sess.toolbar()); sess.watch(root);
    sess.keep('orbit', orbit, { defaults: ORBIT0, skip: ['subs'] });
    const btns = {};
    let cur = null, token = 0;
    const cache = {};
    const setTab = async (id, params) => {
      const t = TABS.find(x => x.id === id) || TABS[0];
      for (const [k, b] of Object.entries(btns)) b.classList.toggle('on', k === t.id);
      const my = ++token;
      if (cur && cur.id !== t.id) { cur.inst.controls.remove(); cur.inst.main.remove(); cur.inst.hide && cur.inst.hide(); }
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
      const url = '#/orbits?tab=' + t.id;
      if (location.hash !== url) history.replaceState(null, '', url);
    };
    for (const t of TABS) {
      const b = h('button', { type: 'button', role: 'tab' }, t.label);
      b.addEventListener('click', () => setTab(t.id));
      tabs.append(b); btns[t.id] = b;
    }
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    setTab(q.get('tab') || 'elements');
    this._cleanup = () => { token++; sess.dispose(); orbit.subs.clear(); for (const k in cache) cache[k].destroy && cache[k].destroy(); };
  },
  unmount() { this._cleanup && this._cleanup(); },
};
