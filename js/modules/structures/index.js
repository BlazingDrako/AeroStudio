// Structures Workbench module: free-body diagrams, statics, frame/truss analysis, sections, stress & strain.
import { h, select } from '../../lib/ui.js';
import { units, UNIT_SYSTEMS } from '../../solvers/units.js';
import { session } from '../../lib/state.js';
import { sharedStore, normalize, exampleModel } from './model.js';
import { sharedStore3d, normalize3d, example3d } from './model3d.js';
import { concepts } from './learn.js';

const TABS = [
  { id: 'structure', label: 'Structure & FBD', load: () => import('./structureTab.js').then(m => m.structureTab) },
  { id: 'frame3d', label: '3D Frame', load: () => import('./frame3dTab.js').then(m => m.frame3dTab) },
  { id: 'fea', label: '2D FEA', load: () => import('./feaTab.js').then(m => m.feaTab) },
  { id: 'vibration', label: 'Vibration', load: () => import('./vibrationTab.js').then(m => m.vibrationTab) },
  { id: 'section', label: 'Sections', load: () => import('./sectionTab.js').then(m => m.sectionTab) },
  { id: 'stress', label: 'Stress & strain', load: () => import('./stressTab.js').then(m => m.stressTab) },
];

export const structuresModule = {
  id: 'structures',
  title: 'Structures Workbench',
  tabs: TABS.filter(t => t.load).map(t => ({ id: t.id, label: t.label })), concepts,
  mount(root) {
    const controls = h('aside', { class: 'af-controls cf-controls' });
    const main = h('section', { class: 'cf-main' });
    const tabs = h('div', { class: 'tabs tabs-wrap', role: 'tablist' });
    const unitSel = select(UNIT_SYSTEMS, units.system, v => units.set(v), { class: 'select st-units', 'aria-label': 'Unit system', title: 'Unit system for every input and result' });
    const head = h('div', { class: 'af-head cf-head' },
      h('div', {}, h('h2', { class: 'af-title' }, 'Structures Workbench'), h('div', { class: 'af-sub' }, 'Free-body diagrams, 2D and 3D frames, reactions, internal forces, deflection, stress, friction, FEA, vibration and buckling')),
      h('div', { class: 'st-headr' }, unitSel, tabs));
    const body = h('div', { class: 'cf-body' });
    const learn = h('div', { class: 'cf-learn' }, h('h3', {}, 'Learn the concepts'),
      h('div', { class: 'cf-concepts' }, ...concepts.map(c => h('details', { class: 'concept' }, h('summary', {}, c.title), h('div', { class: 'body', html: c.html })))));
    main.append(head, body, learn);
    root.append(h('div', { class: 'af cf' }, controls, main));
    const sess = session('structures', { title: 'Structures Workbench', tab: () => cur && cur.id });
    head.append(sess.toolbar()); sess.watch(root);
    // the drawn 2-D and 3-D models travel with links and project files
    const sameAs = (st, m) => st.snapshot() === JSON.stringify(m);
    sess.extra('model2d', { get: () => sharedStore().model, set: m => { const n = normalize(m); if (!sameAs(sharedStore(), n)) sharedStore().replace(n, false); }, reset: () => sharedStore().replace(exampleModel('beam'), false) });
    sess.extra('model3d', { get: () => sharedStore3d().model, set: m => { const n = normalize3d(m); if (!sameAs(sharedStore3d(), n)) sharedStore3d().replace(n, false); }, reset: () => sharedStore3d().replace(example3d('lbent'), false) });
    const btns = {}, cache = {};
    let cur = null, token = 0;
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
      const url = '#/structures?tab=' + t.id;
      if (location.hash !== url) history.replaceState(null, '', url);
    };
    for (const t of TABS) {
      const b = h('button', { type: 'button', role: 'tab' }, t.label);
      b.addEventListener('click', () => setTab(t.id));
      tabs.append(b); btns[t.id] = b;
    }
    const onUnits = () => { unitSel.value = units.system; };
    addEventListener('unitschange', onUnits);
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    setTab(q.get('tab') || 'structure');
    this._cleanup = () => { token++; sess.dispose(); removeEventListener('unitschange', onUnits); for (const k in cache) cache[k].destroy && cache[k].destroy(); };
  },
  unmount() { this._cleanup && this._cleanup(); },
};
