// Jet Engine Cycles module: tabbed tools sharing one layout (controls left, visuals right).
import { h } from '../../lib/ui.js';
import { session } from '../../lib/state.js';
import { concepts } from './learn.js';

const TABS = [
  { id: 'cycle', label: 'Cycle analysis', load: () => import('./cycleTab.js').then(m => m.cycleTab) },
  { id: 'trade', label: 'Trade studies', load: () => import('./tradeTab.js').then(m => m.tradeTab) },
  { id: 'stages', label: 'Stage calculators', load: () => import('./stagesTab.js').then(m => m.stagesTab) },
  { id: 'inlet', label: 'Inlets & shocks', load: () => import('./inletTab.js').then(m => m.inletTab) },
  { id: 'turbo', label: 'Turbomachinery', load: () => import('./turboTab.js').then(m => m.turboTab) },
  { id: 'cea', label: 'Chemical equilibrium (CEA)', load: () => import('./ceaTab.js').then(m => m.ceaTab) },
];

export const propulsionModule = {
  id: 'turbine',
  title: 'Jet Engine Cycles',
  tabs: TABS.filter(t => t.load).map(t => ({ id: t.id, label: t.label })), concepts,
  mount(root) {
    const controls = h('aside', { class: 'af-controls cf-controls' });
    const main = h('section', { class: 'cf-main' });
    const head = h('div', { class: 'af-head cf-head' });
    const tabs = h('div', { class: 'tabs tabs-wrap', role: 'tablist' });
    head.append(h('div', {}, h('h2', { class: 'af-title' }, 'Jet Engine Cycles'), h('div', { class: 'af-sub' }, 'Turbojets, turbofans, turboprops, ramjets and scramjets — station by station')), tabs);
    const body = h('div', { class: 'cf-body' });
    const learn = h('div', { class: 'cf-learn' }, h('h3', {}, 'Learn the concepts'),
      h('div', { class: 'cf-concepts' }, ...concepts.map(c => h('details', { class: 'concept' }, h('summary', {}, c.title), h('div', { class: 'body', html: c.html })))));
    main.append(head, body, learn);
    root.append(h('div', { class: 'af cf' }, controls, main));
    const sess = session('turbine', { title: 'Jet Engine Cycles', tab: () => cur && cur.id });
    head.append(sess.toolbar()); sess.watch(root);
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
      const url = '#/turbine?tab=' + t.id;
      if (location.hash !== url) history.replaceState(null, '', url);
    };
    for (const t of TABS) {
      const b = h('button', { type: 'button', role: 'tab' }, t.label);
      b.addEventListener('click', () => setTab(t.id));
      tabs.append(b); btns[t.id] = b;
    }
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    setTab(q.get('tab') || 'cycle');
    this._cleanup = () => { token++; sess.dispose(); for (const k in cache) cache[k].destroy && cache[k].destroy(); };
  },
  unmount() { this._cleanup && this._cleanup(); },
};
