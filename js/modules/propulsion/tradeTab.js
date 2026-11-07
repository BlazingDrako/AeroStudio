// Trade studies: sweep one design or flight variable (optionally a second as a family of curves)
// and see specific thrust, TSFC and efficiencies; plus an all-engine Isp vs Mach comparison.
import { h, section, select, field, segmented } from '../../lib/ui.js';
import { Plot } from '../../lib/plot.js';
import * as C from '../../solvers/cycles.js';
import { card, shared, bound, put } from './common.js';

const VARS = {
  M0: { label: 'Flight Mach M₀', lo: 0, hi: 3 },
  alt: { label: 'Altitude (m)', lo: 0, hi: 20000 },
  piC: { label: 'Overall pressure ratio', lo: 2, hi: 60 },
  Tt4: { label: 'Turbine inlet Tt4 (K)', lo: 1000, hi: 2100 },
  bpr: { label: 'Bypass ratio α', lo: 0, hi: 14 },
  piF: { label: 'Fan pressure ratio', lo: 1.1, hi: 4 },
  x: { label: 'Power-turbine share x', lo: 0.3, hi: 0.99 },
  psi: { label: 'Scramjet ψ = T₃/T₀', lo: 3, hi: 12 },
  phi: { label: 'Equivalence ratio φ', lo: 0.2, hi: 1.4 },
};
const VALID = {
  turbojet: ['M0', 'alt', 'piC', 'Tt4'], turbofan: ['M0', 'alt', 'piC', 'Tt4', 'bpr', 'piF'], turboprop: ['M0', 'alt', 'piC', 'Tt4', 'x'],
  ramjet: ['M0', 'alt', 'Tt4'], scramjet: ['M0', 'alt', 'psi', 'phi'],
};
const COLORS = ['--upper', '--lower', '--lam', '--turb', '--warn', '--sep'];

export function tradeTab({ keep = o => o } = {}) {
  const T = keep({ type: 'turbofan', xv: 'bpr', fam: 'piF', nFam: 4, lo: 0, hi: 14, flo: 1.3, fhi: 2.2, gas: 'twoGamma', mode: 'sweep' });
  let base = C.defaults('turbofan');
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });
  const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  const fsCard = card('Specific thrust F/ṁ₀', 'Thrust per unit air mass flow.'), fsPlot = new Plot(fsCard, { xlabel: '', ylabel: 'N·s/kg', yname: 'F/ṁ₀', yZero: true });
  const tsCard = card('TSFC', 'Fuel flow per unit thrust, mg/(N·s).'), tsPlot = new Plot(tsCard, { xlabel: '', ylabel: 'mg/(N·s)', yname: 'TSFC' });
  const etaCard = card('Efficiencies', 'Thermal (solid), propulsive (dashed) and overall (dotted) for the base family member.'), etaPlot = new Plot(etaCard, { xlabel: '', ylabel: '%', yname: 'η' });
  const carpetCard = card('Carpet: TSFC vs specific thrust', 'Each curve is one family value; moving along it changes the sweep variable. Designers pick the point with the best compromise between engine size (F/ṁ₀) and fuel burn.'), carpetPlot = new Plot(carpetCard, { xlabel: 'F/ṁ₀ (N·s/kg)', ylabel: 'TSFC mg/(N·s)', xname: 'F/ṁ₀', yname: 'TSFC' });
  const cmpCard = card('Engine comparison: specific impulse vs Mach', 'Each engine type over its useful Mach range with typical design values (default settings, hydrocarbon fuel except the scramjet which uses H₂; rockets shown for reference). This is the classic chart explaining why each engine exists.');
  const cmpPlot = new Plot(cmpCard, { xlabel: 'Flight Mach', ylabel: 'Isp (s)', xname: 'M', yname: 'Isp', yfmt: v => v.toFixed(0) + ' s', ylim: [0, 9000] });
  cmpPlot.wrap.style.height = '340px';
  const note = h('div', { class: 'hint' });
  const sweepBox = h('div', { class: 'cf-main-inner' }, note, h('div', { class: 'cf-grid2b' }, fsCard, tsCard), h('div', { class: 'cf-grid2b' }, carpetCard, etaCard));
  main.append(sweepBox, cmpCard);

  const build = () => {
    const sec = section('Study');
    const valid = VALID[T.type];
    if (!valid.includes(T.xv)) T.xv = valid[0];
    if (T.fam !== 'none' && (!valid.includes(T.fam) || T.fam === T.xv)) T.fam = 'none';
    const useCur = h('button', { class: 'btn sm', type: 'button' }, 'Use design from Cycle analysis');
    useCur.addEventListener('click', () => { if (shared.cycle) { base = { ...shared.cycle, inlet: { ...shared.cycle.inlet } }; T.type = base.type; T.gas = base.gas; build(); run(); } });
    put(sec.body, 
      field('Engine', select(Object.entries(C.ENGINE_TYPES).map(([value, label]) => ({ value, label })), T.type, v => { T.type = v; base = C.defaults(v); T.gas = base.gas; setRange(); build(); run(); })),
      h('div', { style: { marginBottom: '12px' } }, useCur),
      field('Gas model', select([{ value: 'ideal', label: 'Ideal' }, { value: 'twoGamma', label: 'Two-γ' }, { value: 'real', label: 'Real gas (slower)' }], T.gas, v => { T.gas = v; run(); })),
      field('Sweep (x-axis)', select(valid.map(k => ({ value: k, label: VARS[k].label })), T.xv, v => { T.xv = v; setRange(); build(); run(); })),
      bound(T, 'lo', 'From', VARS[T.xv].lo, VARS[T.xv].hi, { step: (VARS[T.xv].hi - VARS[T.xv].lo) / 200, onInput: run }).el,
      bound(T, 'hi', 'To', VARS[T.xv].lo, VARS[T.xv].hi, { step: (VARS[T.xv].hi - VARS[T.xv].lo) / 200, onInput: run }).el,
      field('Family of curves', select([{ value: 'none', label: 'None' }, ...valid.filter(k => k !== T.xv).map(k => ({ value: k, label: VARS[k].label }))], T.fam, v => { T.fam = v; setFam(); build(); run(); })));
    if (T.fam !== 'none') put(sec.body, 
      bound(T, 'flo', 'Family from', VARS[T.fam].lo, VARS[T.fam].hi, { step: (VARS[T.fam].hi - VARS[T.fam].lo) / 200, onInput: run }).el,
      bound(T, 'fhi', 'Family to', VARS[T.fam].lo, VARS[T.fam].hi, { step: (VARS[T.fam].hi - VARS[T.fam].lo) / 200, onInput: run }).el,
      bound(T, 'nFam', 'Curves', 2, 6, { step: 1, digits: 0, onInput: run }).el);
    const secB = section('Base design', { collapsible: true, collapsed: true });
    put(secB.body, h('div', { class: 'hint' }, describe(base)));
    controls.replaceChildren(sec.el, secB.el);
  };
  const setRange = () => {
    const v = VARS[T.xv];
    const b = base[T.xv];
    T.lo = v.lo; T.hi = v.hi;
    if (T.xv === 'M0') { if (T.type === 'ramjet') { T.lo = 1.5; T.hi = 6; } else if (T.type === 'scramjet') { T.lo = 5; T.hi = 15; } else if (T.type === 'turboprop') { T.lo = 0.1; T.hi = 0.8; } else { T.lo = 0; T.hi = 2.5; } }
    if (T.xv === 'Tt4' && T.type === 'ramjet') { T.lo = 1200; T.hi = 2600; }
    if (isFinite(b) && (b < T.lo || b > T.hi)) { T.lo = Math.min(T.lo, b); T.hi = Math.max(T.hi, b); }
  };
  const setFam = () => { if (T.fam === 'none') return; const v = VARS[T.fam], b = base[T.fam]; T.flo = Math.max(v.lo, b * 0.7); T.fhi = Math.min(v.hi, b * 1.3); if (T.fam === 'bpr') { T.flo = 0; T.fhi = 12; } };
  const describe = b => `${C.ENGINE_TYPES[b.type]} · M₀ ${b.M0} · ${(b.alt / 1000).toFixed(1)} km` + (b.piC ? ` · OPR ${b.piC}` : '') + (b.bpr !== undefined ? ` · α ${b.bpr} · πf ${b.piF}` : '') + (b.Tt4 ? ` · Tt4 ${b.Tt4} K` : '') + (b.psi ? ` · ψ ${b.psi} · φ ${b.phi}` : '');

  let pending = false;
  const run = () => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; compute(); }); };
  const compute = () => {
    const B = { ...base, gas: T.gas, type: T.type };
    const n = T.gas === 'real' ? 24 : 50;
    const xs = Array.from({ length: n }, (_, i) => T.lo + (T.hi - T.lo) * i / (n - 1));
    const fams = T.fam === 'none' ? [null] : Array.from({ length: Math.round(T.nFam) }, (_, i) => T.flo + (T.fhi - T.flo) * i / Math.max(1, Math.round(T.nFam) - 1));
    const fsS = [], tsS = [], cpS = [], etaS = [];
    const fmtv = (k, v) => k === 'alt' ? (v / 1000).toFixed(1) + ' km' : (+v.toPrecision(3)).toString();
    fams.forEach((fv, k) => {
      const Q = fv === null ? B : { ...B, [T.fam]: fv };
      const res = C.sweep(Q, T.xv, xs).filter(r => r.ok && r.r.perf.Fs > 0);
      const col = cssv(COLORS[k % COLORS.length]);
      const label = fv === null ? C.ENGINE_TYPES[T.type] : `${VARS[T.fam].label.split(' (')[0]} = ${fmtv(T.fam, fv)}`;
      const X = res.map(r => r.v), Fs = res.map(r => r.r.perf.Fs), Ts = res.map(r => r.r.perf.TSFC * 1e6);
      fsS.push({ x: X, y: Fs, color: col, label }); tsS.push({ x: X, y: Ts, color: col, label }); cpS.push({ x: Fs, y: Ts, color: col, label, points: true, pointSize: 2, extra: i => `${VARS[T.xv].label.split(' (')[0]} = ${fmtv(T.xv, X[i])}` });
      if (k === 0) etaS.push({ x: X, y: res.map(r => r.r.perf.etaTh * 100), color: cssv('--lower'), label: 'thermal' }, { x: X, y: res.map(r => r.r.perf.etaP * 100), color: cssv('--upper'), dash: [6, 4], label: 'propulsive' }, { x: X, y: res.map(r => r.r.perf.etaO * 100), color: cssv('--good'), dash: [2, 3], label: 'overall' });
    });
    const xl = VARS[T.xv].label;
    for (const p of [fsPlot, tsPlot, etaPlot]) p.setOpts({ xlabel: xl, xname: VARS[T.xv].label.split(' (')[0] });
    fsPlot.setData({ series: fsS }); tsPlot.setData({ series: tsS }); etaPlot.setData({ series: etaS }); carpetPlot.setData({ series: cpS });
    note.textContent = 'Base: ' + describe(B) + '. Points with no net thrust are hidden.';
  };
  let cmpDone = false;
  const comparison = () => {
    if (cmpDone) return; cmpDone = true;
    const lines = [
      { type: 'turboprop', range: [0.1, 0.75], col: '--turb', label: 'Turboprop' },
      { type: 'turbofan', range: [0.05, 0.95], col: '--upper', label: 'High-bypass turbofan' },
      { type: 'turbojet', range: [0.05, 3], col: '--lower', label: 'Turbojet', over: { ab: false, nozzle: 'cd', piC: 12, inlet: { model: 'mil', pidMax: 0.97 } } },
      { type: 'turbojet', range: [0.3, 3], col: '--sep', label: 'Turbojet + afterburner', over: { ab: true, Tt7: 2100, nozzle: 'cd', piC: 12, inlet: { model: 'mil', pidMax: 0.97 } } },
      { type: 'ramjet', range: [1.2, 6], col: '--warn', label: 'Ramjet' },
      { type: 'scramjet', range: [5, 15], col: '--lam', label: 'Scramjet (H₂)' },
    ];
    const series = [];
    for (const L of lines) {
      const n = 28, xs = Array.from({ length: n }, (_, i) => L.range[0] + (L.range[1] - L.range[0]) * i / (n - 1));
      const B = { ...C.defaults(L.type), ...(L.over || {}), gas: L.type === 'scramjet' ? 'real' : 'twoGamma' };
      if (L.type === 'turbofan') B.alt = 10668;
      const alt = m => L.type === 'scramjet' ? altForQ(m, 50e3) : L.type === 'ramjet' ? altForQ(m, 60e3) : (m > 1 ? 11000 : 10668);
      const res = xs.map(m => { try { const r = C.runCycle({ ...B, M0: m, alt: alt(m) }); return r.perf.valid ? r.perf.Isp : NaN; } catch { return NaN; } });
      series.push({ x: xs, y: res, color: cssv(L.col), label: L.label });
    }
    series.push({ x: [0, 15], y: [450, 450], color: cssv('--text-3'), dash: [5, 4], label: 'LOX/LH₂ rocket (~450 s)' }, { x: [0, 15], y: [330, 330], color: cssv('--text-3'), dash: [2, 3], label: 'LOX/RP-1 rocket (~330 s)' });
    cmpPlot.setData({ series });
  };
  // altitude for a constant dynamic pressure q = ½ γ p M²
  const altForQ = (M, q) => { let lo = 0, hi = 50000; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (0.7 * C.isa(m).p * M * M > q) lo = m; else hi = m; } return (lo + hi) / 2; };

  setRange(); setFam(); build();
  return { controls, main, show() { if (shared.cycle && shared.cycle.type === T.type && !T.loaded) { T.loaded = true; } compute(); setTimeout(comparison, 30); } };
}
