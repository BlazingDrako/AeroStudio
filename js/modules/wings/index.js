// Wings & 3D Aero module: tabbed tools sharing one wing and flight condition (common.js store) and one layout
// (controls left, visuals right), like the Rocket Engines module.
import { h } from '../../lib/ui.js';
import { session } from '../../lib/state.js';
import { PRESETS } from '../../solvers/wing.js';
import { concepts } from './learn.js';
import { store, recompute, loadPreset, WING0, COND0 } from './common.js';

const TABS = [
  { id: 'planform', label: 'Planform & lift', load: () => import('./planformTab.js').then(m => m.planformTab) },
  { id: 'stall', label: 'Stall', load: () => import('./stallTab.js').then(m => m.stallTab) },
  { id: 'wake', label: 'Wake & downwash', load: () => import('./wakeTab.js').then(m => m.wakeTab) },
  { id: 'winglets', label: 'Winglets & span', load: () => import('./wingletTab.js').then(m => m.wingletTab) },
  { id: 'aircraft', label: 'Aircraft', load: () => import('./aircraftTab.js').then(m => m.aircraftTab) },
];

export const wingsModule = {
  id: 'wings',
  title: 'Wings & 3D Aero',
  tabs: TABS.map(t => ({ id: t.id, label: t.label })), concepts,
  links: PRESETS.map(p => ({ title: p.label, sub: 'Wings & 3D Aero · ' + p.group, href: '#/wings?tab=planform&w=' + p.id, alias: p.id, body: p.note })),
  mount(root) {
    const controls = h('aside', { class: 'af-controls cf-controls' });
    const main = h('section', { class: 'cf-main' });
    const head = h('div', { class: 'af-head cf-head' });
    const tabs = h('div', { class: 'tabs tabs-wrap', role: 'tablist' });
    head.append(h('div', {}, h('h2', { class: 'af-title' }, 'Wings & 3D Aero'), h('div', { class: 'af-sub' }, 'From airfoil to whole wing: how lift spreads across the span, where the wing stalls, and what the wake costs')), tabs);
    const body = h('div', { class: 'cf-body' });
    const learn = h('div', { class: 'cf-learn' }, h('h3', {}, 'Learn the concepts'),
      h('div', { class: 'cf-concepts' }, ...concepts.map(c => h('details', { class: 'concept' }, h('summary', {}, c.title), h('div', { class: 'body', html: c.html })))));
    main.append(head, body, learn);
    root.append(h('div', { class: 'af cf wg-mod' }, controls, main));
    const sess = session('wings', { title: 'Wings & 3D Aero', tab: () => cur && cur.id });
    head.append(sess.toolbar()); sess.watch(root);
    sess.keep('wing', store.W, { defaults: WING0 });
    sess.keep('cond', store.C, { defaults: COND0 });
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    // a search result or link can open a preset wing: #/wings?w=delta
    const wq = q.get('w');
    if (wq && PRESETS.some(p => p.id === wq)) loadPreset(wq);
    recompute();
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
      const url = '#/wings?tab=' + t.id;
      if (location.hash !== url) history.replaceState(null, '', url);
    };
    for (const t of TABS) {
      const b = h('button', { type: 'button', role: 'tab' }, t.label);
      b.addEventListener('click', () => setTab(t.id));
      tabs.append(b); btns[t.id] = b;
    }
    setTab(q.get('tab') || 'planform');
    this._cleanup = () => { token++; sess.dispose(); store.subs.clear(); for (const k in cache) cache[k].destroy && cache[k].destroy(); };
  },
  unmount() { this._cleanup && this._cleanup(); },
};
