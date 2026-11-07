// Shocks & Nozzles module: tabbed tools sharing one layout (controls left, visuals right).
import { h } from '../../lib/ui.js';
import { session } from '../../lib/state.js';
import { concepts } from './learn.js';

const TABS = [
  { id: 'calc', label: 'Calculator', load: () => import('./calcTab.js').then(m => m.calcTab) },
  { id: 'waves', label: 'Shocks & expansions', load: () => import('./wavesTab.js').then(m => m.wavesTab) },
  { id: 'nozzle', label: 'Nozzles & plumes', load: () => import('./nozzleTab.js').then(m => m.nozzleTab) },
  { id: 'tbm', label: 'θ–β–M chart', load: () => import('./tbmTab.js').then(m => m.tbmTab) },
  { id: 'tube', label: 'Shock tube', load: () => import('./tubeTab.js').then(m => m.tubeTab) },
];

export const compressibleModule = {
  id: 'compressible',
  title: 'Shocks & Nozzles',
  tabs: TABS.filter(t => t.load).map(t => ({ id: t.id, label: t.label })), concepts,
  mount(root) {
    const controls = h('aside', { class: 'af-controls cf-controls' });
    const main = h('section', { class: 'cf-main' });
    const head = h('div', { class: 'af-head cf-head' });
    const title = h('h2', { class: 'af-title' }, 'Shocks & Nozzles');
    const tabs = h('div', { class: 'tabs', role: 'tablist' });
    head.append(h('div', {}, title, h('div', { class: 'af-sub' }, 'Compressible flow: shocks, expansions, nozzles and jets')), tabs);
    const body = h('div', { class: 'cf-body' });
    const learn = h('div', { class: 'cf-learn' }, h('h3', {}, 'Learn the concepts'),
      h('div', { class: 'cf-concepts' }, ...concepts.map(c => h('details', { class: 'concept' }, h('summary', {}, c.title), h('div', { class: 'body', html: c.html })))));
    main.append(head, body, learn);
    root.append(h('div', { class: 'af cf' }, controls, main));
    const sess = session('compressible', { title: 'Shocks & Nozzles', tab: () => cur && cur.id });
    head.append(sess.toolbar()); sess.watch(root);
    const btns = {};
    let cur = null, token = 0;
    const cache = {};
    const setTab = async (id, params) => {
      const t = TABS.find(x => x.id === id) || TABS[1];
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
      const url = '#/compressible?tab=' + t.id;
      if (location.hash !== url) history.replaceState(null, '', url);
    };
    for (const t of TABS) {
      const b = h('button', { type: 'button', role: 'tab' }, t.label);
      b.addEventListener('click', () => setTab(t.id));
      tabs.append(b); btns[t.id] = b;
    }
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    setTab(q.get('tab') || 'waves');
    this._cleanup = () => { token++; sess.dispose(); for (const k in cache) cache[k].destroy && cache[k].destroy(); };
  },
  unmount() { this._cleanup && this._cleanup(); },
};
