// Aircraft: the five aircraft of Flight & Atmosphere, their wings solved by the vortex lattice and set against the
// simple estimates that module uses (Helmbold/DATCOM lift slope, Oswald e, dε/dα = 2CLα/(πA)), with where each
// wing would stall first relative to its ailerons.
import { h, section, select, field } from '../../lib/ui.js';
import { sendSection, sendTo } from '../../lib/send.js';
import * as Wg from '../../solvers/wing.js';
import { byId } from '../../solvers/performance.js';
import { GEOMETRY, liftSlope } from '../../solvers/stability.js';
import { atmosphere } from '../../solvers/atmosphere.js';
import { store, schedule, loadPreset, COND, wingSection, flightSection, metricsGrid, insightsList, card, fmt, pct, D } from './common.js';
import { WingView } from './view3d.js';

const IDS = ['c172', 'glider', 'a320', 'cca', 'f16'];
const machOf = id => { const c = COND[id]; return Math.min(0.85, c.V / atmosphere(c.alt).a); };

// everything the comparison needs for one aircraft, at its own cruise condition
function evaluate(id) {
  const p = Wg.PRESETS.find(x => x.id === id), W = { ...Wg.defaults(), ...p.w, winglet: { ...Wg.defaults().winglet, on: false } };
  const ac = byId(id), g = GEOMETRY[id], M = machOf(id), c = COND[id];
  const s = Wg.analyze(W, { alpha: c.alpha, M, nS: 20, nC: 4 });
  const P = s.P;
  const tail = [P.xRef + g.ht.l, 0, 0.05 * P.s];
  const deda = Wg.downwash({ ...s, G: s.G2 }, tail) - Wg.downwash(s, tail);
  const sect = () => Wg.modelSection({ clmax: 1.45, alpha0: Wg.nacaAlpha0(W.root), a: 0.95 * 2 * Math.PI });
  const st = Wg.sweepAlpha(W, { a0: 0, a1: 24, step: 1, nS: 12, sect });
  return { id, W, ac, g, M, s, deda, simple: 2 * s.CLa / (Math.PI * W.AR), helm: liftSlope(W.AR, W.sweep, M), st, ail: g.ail };
}
let ALL = null;

export function aircraftTab() {
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });
  const metrics = metricsGrid();
  const view = new WingView();
  view.setLayers({ wake: false, arrows: true, pressure: true });
  const vCard = card('The wing', 'The selected aircraft\'s wing alone (no fuselage, no tail) at its typical cruise condition. Change anything on the left to explore; pick the aircraft again to put it back.');
  vCard.append(view.el);
  const tCard = card('This wing against the simple estimates', 'Left: the vortex lattice. Right: what Flight & Atmosphere assumes for the whole aircraft, and the textbook estimate it is based on.');
  const tEl = h('div'); tCard.append(tEl);
  const aCard = card('Five aircraft side by side', 'Each at its own cruise Mach number. First stall uses the same model section (cl,max 1.45) on every wing, so only the planform and twist differ. The ailerons span the range shown.');
  const aEl = h('div'); aCard.append(aEl);
  const insCard = card('Notes'); const insEl = h('div'); insCard.append(insEl);
  main.append(metrics.el, vCard, tCard, aCard, insCard);

  let wingCtl, flightCtl;
  const changed = kind => { if (kind === 'preset') build(); else { wingCtl && wingCtl.update(); flightCtl && flightCtl.update(); } schedule(); };
  const acId = () => IDS.includes(store.W.preset) ? store.W.preset : null;
  const build = () => {
    const sa = section('Aircraft');
    const sel = select([{ value: '', label: 'Choose an aircraft…' }, ...IDS.map(id => ({ value: id, label: Wg.PRESETS.find(p => p.id === id).label }))], acId() || '', v => { if (!v) return; loadPreset(v); build(); schedule(); });
    sa.body.append(field('Aircraft', sel, 'Loads the aircraft\'s wing and its typical cruise condition, replacing the wing in every tab.'),
      h('div', { class: 'hint' }, 'Geometry from the same published three-views Flight & Atmosphere uses; washout and sections are typical of each class.'));
    wingCtl = wingSection(changed); flightCtl = flightSection(changed);
    const id = acId();
    controls.replaceChildren(sa.el, flightCtl.el, wingCtl.el, sendSection([
      { label: 'Flight & Atmosphere · Stability & trim', sub: 'This aircraft\'s trim, neutral point and dynamic modes', go: () => {
        const i = acId(); if (!i) return 'Choose one of the five aircraft first';
        return sendTo({ mod: 'flight', tab: 'stability', key: 'aircraft', values: { id: i }, note: `${byId(i).short} in Flight & Atmosphere` });
      } },
    ]));
    void id;
  };

  const row = (name, a, b, c, tip) => h('tr', {}, h('td', { style: { textAlign: 'left', fontFamily: 'var(--font)' }, title: tip || '' }, name), h('td', {}, a), h('td', {}, b), h('td', {}, c));
  const table = (head, rows) => h('div', { class: 'table-wrap' }, h('table', { class: 'data wg-table' }, h('thead', {}, h('tr', {}, ...head.map((x, i) => h('th', { style: i === 0 ? { textAlign: 'left' } : null }, x)))), h('tbody', {}, ...rows)));

  const paint = () => {
    const s = store.sol; if (!s) return;
    if (!ALL) ALL = IDS.map(evaluate);
    const id = acId(), W = store.W;
    view.set({ sol: s, ground: s.L.ground });
    const L = [];
    if (id) {
      const ac = byId(id), g = GEOMETRY[id], P = s.P, M = store.air.Mc;
      const tail = [P.xRef + g.ht.l, 0, 0.05 * P.s];
      const deda = Wg.downwash({ ...s, G: s.G2 }, tail) - Wg.downwash(s, tail);
      const helm = liftSlope(W.AR, W.sweep, M), simple = 2 * s.CLa / (Math.PI * W.AR);
      metrics.set([
        { k: 'Wing CLα (lattice)', v: s.CLa.toFixed(3) + ' /rad', s: `${(s.CLa * D).toFixed(4)} /° at M ${M.toFixed(2)}` },
        { k: 'Helmbold / DATCOM', v: helm.toFixed(3) + ' /rad', s: pct(s.CLa / helm - 1) + ' lattice vs estimate' },
        { k: 'Span efficiency', v: fmt(s.e, 3), s: `Oswald e used: ${fmt(ac.e, 2)}`, tip: 'The lattice gives the wing\'s induced drag alone. The Oswald factor of the whole aircraft is lower: it also counts the fuselage and the profile drag that grows with lift.' },
        { k: 'dε/dα at the tail', v: fmt(deda, 3), s: `estimate 2CLα/(πA) = ${fmt(simple, 3)}`, tip: `At the tail arm ${g.ht.l} m behind the wing's aerodynamic centre, just above the wing plane.` },
        { k: 'Aerodynamic centre', v: (s.xac * 100).toFixed(1) + '% MAC', s: `MAC ${P.mac.toFixed(2)} m (uses ${g.c} m)` },
      ]);
      tEl.replaceChildren(table(['', 'vortex lattice', 'Flight & Atmosphere', 'estimate'], [
        row('Wing lift slope CLα (/rad)', s.CLa.toFixed(3), ac.CLa.toFixed(2) + ' (aircraft)', helm.toFixed(3) + ' Helmbold'),
        row('Span efficiency', fmt(s.e, 3), fmt(ac.e, 2) + ' Oswald', '—'),
        row('dε/dα at the tail', fmt(deda, 3), fmt(simple, 3), '2CLα/(πA)'),
        row('Aspect ratio', W.AR.toFixed(2), (ac.b * ac.b / ac.S).toFixed(2), '—'),
        row('Quarter-chord sweep', W.sweep.toFixed(1) + '°', g.sweep + '°', '—'),
      ]));
      const ev = ALL.find(x => x.id === id), fs = ev && ev.st.firstStall;
      if (fs) L.push(fs.eta >= g.ail[0] ? { type: 'w', t: `With the reference section, stall starts at ${(fs.eta * 100).toFixed(0)}% semi-span: on the ailerons (${(g.ail[0] * 100).toFixed(0)}–${(g.ail[1] * 100).toFixed(0)}%)`, d: 'Real aircraft fix this with more washout, a better tip section, stall strips, slats or vortex generators, and certification flight tests check that roll control remains through the stall.' }
        : { type: 'g', t: `Stall starts at ${(fs.eta * 100).toFixed(0)}% semi-span, inboard of the ailerons`, d: `The ailerons (${(g.ail[0] * 100).toFixed(0)}–${(g.ail[1] * 100).toFixed(0)}% semi-span) keep working as the stall begins.` });
      L.push({ type: 'i', t: 'Why the numbers differ', d: 'The lattice sees only a thin, isolated wing. Flight & Atmosphere\'s values are for the whole aircraft: the fuselage carries some lift but breaks the spanwise load at the root, the tail adds lift slope, and Oswald\'s e folds in viscous drag that grows with lift. The lattice is the better wing number; the simple estimates are what most conceptual design starts from.' });
    } else {
      metrics.set([{ k: 'Aircraft', v: 'none chosen', s: 'pick one on the left' }]);
      tEl.replaceChildren(h('div', { class: 'hint' }, 'Choose one of the five aircraft to compare its wing with the estimates.'));
    }
    aEl.replaceChildren(table(['', ...ALL.map(x => x.ac.short)], [
      h('tr', {}, h('td', { style: { textAlign: 'left' } }, 'Aspect ratio'), ...ALL.map(x => h('td', {}, x.W.AR.toFixed(1)))),
      h('tr', {}, h('td', { style: { textAlign: 'left' } }, 'Cruise Mach'), ...ALL.map(x => h('td', {}, x.M.toFixed(2)))),
      h('tr', {}, h('td', { style: { textAlign: 'left' } }, 'CLα lattice (/rad)'), ...ALL.map(x => h('td', {}, x.s.CLa.toFixed(2)))),
      h('tr', {}, h('td', { style: { textAlign: 'left' } }, 'CLα Helmbold'), ...ALL.map(x => h('td', {}, x.helm.toFixed(2)))),
      h('tr', {}, h('td', { style: { textAlign: 'left' } }, 'CLα Flight & Atmos.'), ...ALL.map(x => h('td', {}, x.ac.CLa.toFixed(2)))),
      h('tr', {}, h('td', { style: { textAlign: 'left' } }, 'e lattice (wing)'), ...ALL.map(x => h('td', {}, x.s.e.toFixed(3)))),
      h('tr', {}, h('td', { style: { textAlign: 'left' } }, 'Oswald e used'), ...ALL.map(x => h('td', {}, x.ac.e.toFixed(2)))),
      h('tr', {}, h('td', { style: { textAlign: 'left' } }, 'dε/dα lattice'), ...ALL.map(x => h('td', {}, x.deda.toFixed(3)))),
      h('tr', {}, h('td', { style: { textAlign: 'left' } }, 'dε/dα 2CLα/(πA)'), ...ALL.map(x => h('td', {}, x.simple.toFixed(3)))),
      h('tr', {}, h('td', { style: { textAlign: 'left' } }, 'First stall (semi-span)'), ...ALL.map(x => { const f = x.st.firstStall; const on = f && f.eta >= x.ail[0]; return h('td', { style: { color: on ? 'var(--bad)' : 'var(--good)' } }, f ? (f.eta * 100).toFixed(0) + '%' : '—'); })),
      h('tr', {}, h('td', { style: { textAlign: 'left' } }, 'Ailerons'), ...ALL.map(x => h('td', {}, `${(x.ail[0] * 100).toFixed(0)}–${(x.ail[1] * 100).toFixed(0)}%`))),
    ]));
    L.push({ type: 'i', t: 'Reading the table', d: 'Aspect ratio dominates: the sailplane\'s slope is close to the 2-D 2π and its wing nearly elliptic, while the fighter\'s short swept wing lifts barely half as much per degree. dε/dα follows the lift slope over the aspect ratio, so the low-aspect-ratio fighter has the strongest downwash response at its tail.' });
    insightsList(insEl, L);
  };

  let visible = false;
  store.subs.add(() => { if (visible) paint(); });
  build();
  return {
    controls, main,
    show() { visible = true; build(); paint(); },
    hide() { visible = false; },
    destroy() { view.destroy(); },
  };
}
