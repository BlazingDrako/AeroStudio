// Flight & Atmosphere module: tabbed tools sharing one layout (controls left, visuals right).
import { h } from '../../lib/ui.js';
import { session } from '../../lib/state.js';
import { perf, PERF0 } from '../flight/perfShared.js';
import { concepts } from './learn.js';
import { unitsControl } from './common.js';

const TABS = [
  { id: 'atmosphere', label: 'Atmosphere', load: () => import('./atmosphereTab.js').then(m => m.atmosphereTab) },
  { id: 'airspeed', label: 'Airspeeds', load: () => import('./airspeedTab.js').then(m => m.airspeedTab) },
  { id: 'turbulence', label: 'Wind & turbulence', load: () => import('./turbulenceTab.js').then(m => m.turbulenceTab) },
  { id: 'performance', label: 'Performance', load: () => import('./performanceTab.js').then(m => m.performanceTab) },
  { id: 'turn', label: 'Turn & V–n', load: () => import('./turnTab.js').then(m => m.turnTab) },
  { id: 'envelope', label: 'Envelope', load: () => import('./envelopeTab.js').then(m => m.envelopeTab) },
  { id: 'stability', label: 'Stability & trim', load: () => import('./stabilityTab.js').then(m => m.stabilityTab) },
  { id: 'modes', label: 'Dynamic modes', load: () => import('./modesTab.js').then(m => m.modesTab) },
];

export const flightModule = {
  id: 'flight',
  title: 'Flight & Atmosphere',
  tabs: TABS.filter(t => t.load).map(t => ({ id: t.id, label: t.label })), concepts,
  mount(root) {
    const controls = h('aside', { class: 'af-controls cf-controls' });
    const main = h('section', { class: 'cf-main' });
    const head = h('div', { class: 'af-head cf-head' });
    const tabs = h('div', { class: 'tabs tabs-wrap', role: 'tablist' });
    head.append(h('div', {}, h('h2', { class: 'af-title' }, 'Flight & Atmosphere'), h('div', { class: 'af-sub' }, 'The air an aircraft flies through, and what the aircraft can do in it')),
      h('div', { class: 'flt-units' }, unitsControl()), tabs);
    const body = h('div', { class: 'cf-body' });
    const learn = h('div', { class: 'cf-learn' }, h('h3', {}, 'Learn the concepts'),
      h('div', { class: 'cf-concepts' }, ...concepts.map(c => h('details', { class: 'concept' }, h('summary', {}, c.title), h('div', { class: 'body', html: c.html })))));
    main.append(head, body, learn);
    root.append(h('div', { class: 'af cf flt-mod' }, controls, main));
    const sess = session('flight', { title: 'Flight & Atmosphere', tab: () => cur && cur.id });
    head.append(sess.toolbar()); sess.watch(root);
    sess.keep('aircraft', perf, { defaults: PERF0, skip: ['version'] }); perf.version++;
    const btns = {};
    let cur = null, token = 0;
    const cache = {};
    const setTab = async (id, params) => {
      const t = TABS.find(x => x.id === id) || TABS[0];
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
      const url = '#/flight?tab=' + t.id;
      if (location.hash !== url) history.replaceState(null, '', url);
    };
    for (const t of TABS) {
      const b = h('button', { type: 'button', role: 'tab' }, t.label);
      b.addEventListener('click', () => setTab(t.id));
      tabs.append(b); btns[t.id] = b;
    }
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    setTab(q.get('tab') || 'atmosphere');
    this._cleanup = () => { token++; sess.dispose(); for (const k in cache) cache[k].destroy && cache[k].destroy(); };
  },
  unmount() { this._cleanup && this._cleanup(); },
};
