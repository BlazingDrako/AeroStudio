// Rocket Engines module: tabbed tools sharing one engine design (common.js store) and one layout
// (controls left, visuals right), like the Jet Engine Cycles module.
import { h } from '../../lib/ui.js';
import { session } from '../../lib/state.js';
import { concepts } from './learn.js';
import { store, recompute, loadEngine, ENGINE0 } from './common.js';

const TABS = [
  { id: 'design', label: 'Engine design', load: () => import('./designTab.js').then(m => m.designTab) },
  { id: 'altitude', label: 'Altitude & expansion', load: () => import('./altitudeTab.js').then(m => m.altitudeTab) },
  { id: 'propellants', label: 'Propellants', load: () => import('./propellantsTab.js').then(m => m.propellantsTab) },
  { id: 'cooling', label: 'Cooling', load: () => import('./coolingTab.js').then(m => m.coolingTab) },
];

export const rocketModule = {
  id: 'rocket',
  title: 'Rocket Engines',
  tabs: TABS.filter(t => t.load).map(t => ({ id: t.id, label: t.label })), concepts,
  mount(root) {
    const controls = h('aside', { class: 'af-controls cf-controls' });
    const main = h('section', { class: 'cf-main' });
    const head = h('div', { class: 'af-head cf-head' });
    const tabs = h('div', { class: 'tabs tabs-wrap', role: 'tablist' });
    head.append(h('div', {}, h('h2', { class: 'af-title' }, 'Rocket Engines'), h('div', { class: 'af-sub' }, 'Liquid-propellant engines from the chemistry in the chamber to the plume behind the nozzle')), tabs);
    const body = h('div', { class: 'cf-body' });
    const learn = h('div', { class: 'cf-learn' }, h('h3', {}, 'Learn the concepts'),
      h('div', { class: 'cf-concepts' }, ...concepts.map(c => h('details', { class: 'concept' }, h('summary', {}, c.title), h('div', { class: 'body', html: c.html })))));
    main.append(head, body, learn);
    root.append(h('div', { class: 'af cf rk-mod' }, controls, main));
    const sess = session('rocket', { title: 'Rocket Engines', tab: () => cur && cur.id });
    head.append(sess.toolbar()); sess.watch(root);
    if (!store.D) loadEngine(store.S.preset || 'merlin');
    sess.keep('engine', store.S, { defaults: ENGINE0 }); recompute();
    const btns = {};
    let cur = null, token = 0;
    const cache = {};
    const shell = { go: id => setTab(id) };
    const setTab = async (id, params) => {
      const t = TABS.find(x => x.id === id) || TABS[0];
      for (const [k, b] of Object.entries(btns)) b.classList.toggle('on', k === t.id);
      const my = ++token;
      if (cur && cur.id !== t.id) { cur.inst.controls.remove(); cur.inst.main.remove(); cur.inst.hide && cur.inst.hide(); }
      if (!cache[t.id]) {
        body.replaceChildren(h('div', { class: 'hint', style: { padding: '20px' } }, 'Loading…'));
        const fn = await t.load();
        if (my !== token) return;
        cache[t.id] = fn({ ...shell, keep: (o, opt) => sess.keep(t.id, o, opt) });
      }
      if (my !== token) return;
      const inst = cache[t.id];
      controls.replaceChildren(inst.controls); body.replaceChildren(inst.main);
      cur = { id: t.id, inst };
      if (params && inst.load) inst.load(params);
      inst.show && inst.show();
      const url = '#/rocket?tab=' + t.id;
      if (location.hash !== url) history.replaceState(null, '', url);
    };
    for (const t of TABS) {
      const b = h('button', { type: 'button', role: 'tab' }, t.label);
      b.addEventListener('click', () => setTab(t.id));
      tabs.append(b); btns[t.id] = b;
    }
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    setTab(q.get('tab') || 'design');
    this._cleanup = () => { token++; sess.dispose(); store.subs.clear(); for (const k in cache) cache[k].destroy && cache[k].destroy(); };
  },
  unmount() { this._cleanup && this._cleanup(); },
};
