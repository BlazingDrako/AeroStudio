// Shared state for the Rocket Engines module: one engine design that every tab reads and edits.
import * as R from '../../solvers/rocket.js';
export { bound, boundToggle, boundSelect, boundSeg, metricsGrid, insightsList, card, fmt, put, resultRows, heat, rgb } from '../propulsion/common.js';

export const store = { S: R.defaults(), D: null, err: null, ver: 0, subs: new Set() };

export function recompute() {
  const t0 = performance.now();
  try { store.D = R.design(store.S); store.err = null; } catch (e) { console.error(e); store.err = e; }
  store.ms = performance.now() - t0;
  store.ver++;
  for (const f of store.subs) f();
}
let pending = false;
export function schedule() { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; recompute(); }); }

export function loadEngine(id, S = store.S) {
  const e = R.ENGINES.find(x => x.id === id);
  if (!e) return;
  const c = R.comboOf(e.fuel, e.ox);
  Object.assign(S, { fuel: e.fuel, ox: e.ox, of: e.of, Pc: e.Pc, eps: e.eps, F: e.F, at: e.at, cycle: e.cycle, gg: e.gg ?? 0.03, nozzle: e.nozzle, Lstar: c ? c.Lstar : 1, preset: e.id, autoCont: true });
}
// the engine every visit starts from (the Merlin 1D), used to tell which settings the user changed
export const ENGINE0 = (() => { const s = R.defaults(); loadEngine(s.preset || 'merlin', s); return JSON.parse(JSON.stringify(s)); })();
export const preset = () => R.ENGINES.find(x => x.id === store.S.preset);

export const G0 = R.G0;
export const kN = F => F >= 1e6 ? (F / 1e6).toFixed(2) + ' MN' : (F / 1e3).toFixed(F < 1e5 ? 1 : 0) + ' kN';
export const klbf = F => (F / 4448.22).toFixed(F < 4.4e5 ? 1 : 0) + ' klbf';
export const bar = P => (P / 1e5).toFixed(P < 1e4 ? 4 : P < 1e5 ? 3 : 2) + ' bar';
export const len = m => m < 1 ? (m * 100).toFixed(1) + ' cm' : m.toFixed(2) + ' m';
export const REGIMES = {
  vacuum: ['Vacuum', '--turb'], under: ['Under-expanded', '--turb'], design: ['Ideally expanded', '--good'],
  over: ['Over-expanded', '--warn'], separated: ['Flow separated', '--bad'],
};
export const propLabel = id => {
  const m = { 'H2(L)': 'LH₂', 'O2(L)': 'LOX', 'CH4(L)': 'LCH₄', 'RP-1': 'RP-1', 'C2H5OH(L)': 'Ethanol', 'Jet-A(L)': 'Jet-A', 'N2O4(L)': 'N₂O₄', 'MMH(L)': 'MMH', 'UDMH(L)': 'UDMH', 'N2H4(L)': 'N₂H₄', 'H2O2(L)': 'H₂O₂' };
  return m[id] || id;
};
