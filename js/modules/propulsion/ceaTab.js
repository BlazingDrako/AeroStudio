// Chemical equilibrium calculator in the style of NASA CEA: rocket (chamber/throat/exit,
// equilibrium or frozen), adiabatic flame (HP) and fixed-temperature (TP) problems.
import { h, section, field, select, segmented, toggle, downloadText } from '../../lib/ui.js';
import { Plot } from '../../lib/plot.js';
import * as TH from '../../solvers/thermo.js';
import { bound, card, metricsGrid, insightsList, fmt, put } from './common.js';
import { sendTo, sendSection } from '../../lib/send.js';
import * as RK from '../../solvers/rocket.js';

const G0 = 9.80665;
const opt = kind => Object.entries(TH.REACTANTS).filter(([, r]) => r.kind === kind).map(([value, r]) => ({ value, label: r.label }));

const PRESETS = [
  { t: 'LOX / LH₂ (RS-25-like), O/F 6, 206 bar, ε 69', s: { prob: 'rocket', fuel: 'H2(L)', ox: 'O2(L)', mixBy: 'of', of: 6, Pc: 206, exit: 'eps', eps: 69 } },
  { t: 'LOX / RP-1 (Merlin-like), O/F 2.36, 97 bar, ε 16', s: { prob: 'rocket', fuel: 'RP-1', ox: 'O2(L)', mixBy: 'of', of: 2.36, Pc: 97, exit: 'eps', eps: 16 } },
  { t: 'LOX / LCH₄ (Raptor-like), O/F 3.6, 300 bar, ε 40', s: { prob: 'rocket', fuel: 'CH4(L)', ox: 'O2(L)', mixBy: 'of', of: 3.6, Pc: 300, exit: 'eps', eps: 40 } },
  { t: 'N₂O₄ / MMH (storable), O/F 1.65, 10 bar, ε 100', s: { prob: 'rocket', fuel: 'MMH(L)', ox: 'N2O4(L)', mixBy: 'of', of: 1.65, Pc: 10, exit: 'eps', eps: 100 } },
  { t: 'CEA validation: H₂ / O₂ flame at 1 atm (≈ 3079 K)', s: { prob: 'hp', fuel: 'H2', ox: 'O2', mixBy: 'phi', phi: 1, Pc: 1.01325 } },
  { t: 'Methane / air flame, φ = 1, 1 atm (≈ 2226 K)', s: { prob: 'hp', fuel: 'CH4', ox: 'Air', mixBy: 'phi', phi: 1, Pc: 1.01325 } },
  { t: 'Jet-A / air at gas-turbine burner conditions (Tair 800 K, 30 bar)', s: { prob: 'hp', fuel: 'Jet-A(L)', ox: 'Air', mixBy: 'phi', phi: 0.45, Pc: 30, Tox: 800 } },
  { t: 'Air at 3500 K, 1 atm (dissociation)', s: { prob: 'tp', fuel: 'H2', ox: 'Air', mixBy: 'of', of: 1e6, Pc: 1.01325, T: 3500 } },
];

export function ceaTab({ keep = o => o } = {}) {
  const S = keep({ prob: 'rocket', fuel: 'H2(L)', ox: 'O2(L)', mixBy: 'of', of: 6, phi: 1, Pc: 68.95, exit: 'pr', pr: 68.05, eps: 40, pa: 1.01325, frozen: false, T: 3000, Tfuel: 298.15, Tox: 298.15 });
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });
  const metrics = metricsGrid();
  const tabCard = card('Thermodynamic properties', 'CEA-style output. h and s are absolute (NASA reference: elements in their standard state at 298.15 K have h = 0).');
  const copyBtn = h('button', { class: 'btn sm', type: 'button' }, 'Download text output');
  tabCard.querySelector('.plot-head').append(copyBtn);
  const tabEl = h('div', { class: 'table-wrap' }); tabCard.append(tabEl);
  const molCard = card('Equilibrium composition (mole fractions)', 'Species above 5 ppm. Dissociation products (H, O, OH, CO…) soak up energy at high temperature and recombine as the gas cools in the nozzle.');
  const molEl = h('div', { class: 'mol-bars' }); molCard.append(molEl);
  const swCard = card('Sweep over mixture ratio', 'Recomputed across the mixture range. Peak Isp is usually fuel-rich of stoichiometric: the lighter exhaust outweighs the lower temperature.');
  const swPlot = new Plot(swCard, { xlabel: 'O/F', ylabel: '', xname: 'O/F', yname: 'value' });
  const swPlot2 = new Plot(swCard, { xlabel: 'O/F', ylabel: 'molar mass (g/mol) / γ', xname: 'O/F', yname: 'value' });
  swPlot.wrap.style.height = '220px'; swPlot2.wrap.style.height = '160px';
  const insCard = card('Notes'); const insEl = h('div'); insCard.append(insEl);
  const status = h('div', { class: 'hint' });
  main.append(status, metrics.el, tabCard, h('div', { class: 'cf-grid2b' }, molCard, swCard), insCard);

  const sendSec = sendSection([
    { label: 'Rocket Engines', sub: 'Size an engine with this chemistry: chamber, nozzle, plume and cooling', go: () => {
      if (S.prob !== 'rocket') return 'Switch the problem to "Rocket" first';
      if (!RK.FUELS.includes(S.fuel) || !RK.OXIDIZERS.includes(S.ox)) return `Rocket Engines takes ${RK.FUELS.length} fuels and LOX, N₂O₄ or H₂O₂; this pair isn't one of them`;
      const of = S.mixBy === 'of' ? S.of : TH.stoichOF(S.fuel, S.ox) / S.phi, c = RK.comboOf(S.fuel, S.ox);
      const values = { fuel: S.fuel, ox: S.ox, of: +of.toFixed(3), Pc: S.Pc, frozen: !!S.frozen, preset: '' };
      if (S.exit === 'eps') values.eps = S.eps;
      if (c) values.Lstar = c.Lstar;
      sendTo({ mod: 'rocket', tab: 'design', key: 'engine', values, note: `Designing an engine at O/F ${values.of}, ${S.Pc} bar${values.eps ? ', ε ' + S.eps : ''}` });
    } },
  ]);
  const build = () => {
    const sec = section('Problem');
    const ps = segmented([{ value: 'rocket', label: 'Rocket' }, { value: 'hp', label: 'Flame (HP)' }, { value: 'tp', label: 'Fixed T (TP)' }], S.prob, v => { S.prob = v; build(); run(); });
    ps.el.classList.add('seg-wrap');
    const pre = select([{ value: '', label: 'Load an example…' }, ...PRESETS.map((p, i) => ({ value: String(i), label: p.t }))], '', v => { if (v === '') return; Object.assign(S, { Tfuel: 298.15, Tox: 298.15, frozen: false }, PRESETS[+v].s); build(); run(); });
    put(sec.body, field('Type', ps.el, '<b>Rocket</b>: infinite-area combustor at Pc, isentropic expansion through throat to exit (CEA "rocket"). <b>HP</b>: adiabatic flame at constant pressure. <b>TP</b>: equilibrium at a fixed temperature and pressure.'), field('Examples', pre));
    const secR = section('Reactants');
    const fr = TH.REACTANTS[S.fuel], orx = TH.REACTANTS[S.ox];
    put(secR.body, 
      field('Fuel', select(opt('fuel'), S.fuel, v => { S.fuel = v; build(); run(); })),
      fr.gas ? bound(S, 'Tfuel', 'Fuel temperature', 200, 1000, { step: 1, digits: 1, unit: 'K', onInput: run }) : h('div', { class: 'hint', style: { marginBottom: '10px' } }, `Liquid at ${fr.T} K, ΔHf = ${(fr.hf / 1000).toFixed(2)} kJ/mol (CEA value).`),
      field('Oxidizer', select(opt('ox'), S.ox, v => { S.ox = v; if (v === 'Air') { S.mixBy = 'phi'; } build(); run(); })),
      (orx.gas || orx.mix) ? bound(S, 'Tox', 'Oxidizer temperature', 200, 1200, { step: 1, digits: 1, unit: 'K', onInput: run }) : h('div', { class: 'hint', style: { marginBottom: '10px' } }, `Liquid at ${orx.T} K, ΔHf = ${(orx.hf / 1000).toFixed(2)} kJ/mol.`));
    const ofst = TH.stoichOF(S.fuel, S.ox);
    const mixSeg = segmented([{ value: 'of', label: 'O/F mass ratio' }, { value: 'phi', label: 'Equivalence ratio φ' }], S.mixBy, v => { S.mixBy = v; build(); run(); });
    put(secR.body, field('Mixture', mixSeg.el, `Stoichiometric O/F = ${fmt(ofst, 4)}. φ = (O/F)st / (O/F): φ > 1 is fuel-rich.`),
      S.mixBy === 'of' ? bound(S, 'of', 'O/F', 0.1, Math.max(40, ofst * 2.5), { log: true, digits: 3, onInput: run }) : bound(S, 'phi', 'φ', 0.1, 4, { step: 0.01, digits: 3, onInput: run }));
    const secC = section('Conditions');
    put(secC.body, bound(S, 'Pc', S.prob === 'rocket' ? 'Chamber pressure Pc' : 'Pressure', 0.01, 500, { log: true, digits: 3, unit: 'bar', onInput: run }));
    if (S.prob === 'tp') put(secC.body, bound(S, 'T', 'Temperature', 300, 6000, { step: 10, digits: 0, unit: 'K', onInput: run }));
    if (S.prob === 'rocket') {
      const es = segmented([{ value: 'pr', label: 'Pc/Pe' }, { value: 'eps', label: 'Area ratio Ae/At' }], S.exit, v => { S.exit = v; build(); run(); });
      put(secC.body, field('Exit given by', es.el),
        S.exit === 'pr' ? bound(S, 'pr', 'Pressure ratio Pc/Pe', 1.5, 10000, { log: true, digits: 2, onInput: run }) : bound(S, 'eps', 'Area ratio Ae/At', 1.05, 300, { log: true, digits: 2, onInput: run }),
        bound(S, 'pa', 'Ambient pressure pa', 0, 1.2, { step: 0.001, digits: 4, unit: 'bar', onInput: run, tip: 'For Isp at ambient. 0 = vacuum.' }),
        toggle('Frozen composition after the chamber', S.frozen, v => { S.frozen = v; run(); }, { tip: 'Frozen: no recombination in the nozzle (lower-bound Isp). Equilibrium: composition shifts as the gas cools (upper bound). Real engines lie between.' }).el);
    }
    controls.replaceChildren(sec.el, secR.el, secC.el, sendSec);
  };

  const reactants = (of) => {
    const ofv = of ?? (S.mixBy === 'of' ? S.of : TH.stoichOF(S.fuel, S.ox) / S.phi);
    return [{ id: S.fuel, mass: 1, T: TH.REACTANTS[S.fuel].gas ? S.Tfuel : undefined }, { id: S.ox, mass: ofv, T: (TH.REACTANTS[S.ox].gas || TH.REACTANTS[S.ox].mix) ? S.Tox : undefined }];
  };
  const solve = of => {
    const re = reactants(of);
    if (S.prob === 'rocket') return TH.rocket({ reactants: re, Pc: S.Pc * 1e5, ...(S.exit === 'pr' ? { pcpe: S.pr } : { eps: S.eps }), frozen: S.frozen, pa: S.pa * 1e5 });
    return TH.flame({ reactants: re, P: S.Pc * 1e5, T: S.T, prob: S.prob === 'tp' ? 'TP' : 'HP' });
  };

  let R = null, pending = false, swT = 0;
  const run = () => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; compute(); clearTimeout(swT); swT = setTimeout(sweep, 200); }); };
  const compute = () => {
    const t0 = performance.now();
    try { R = solve(); } catch (e) { console.error(e); status.textContent = 'Could not solve: ' + e.message; return; }
    const ofv = S.mixBy === 'of' ? S.of : TH.stoichOF(S.fuel, S.ox) / S.phi, ofst = TH.stoichOF(S.fuel, S.ox);
    status.textContent = `O/F = ${fmt(ofv, 4)} · φ = ${fmt(ofst / ofv, 4)} · fuel ${(100 / (1 + ofv)).toFixed(3)}% by mass · solved in ${(performance.now() - t0).toFixed(0)} ms` + (R.converged === false ? ' · WARNING: not converged' : '');
    paint();
  };
  const cols = () => S.prob === 'rocket' ? [['Chamber', R.chamber], ['Throat', R.throat], ['Exit', R.exit]] : [[S.prob === 'tp' ? 'Equilibrium' : 'Flame', { T: R.T, P: R.P, rho: R.rho, h: R.h, s: R.s, W: R.W, cp: R.cpEq, gamma: R.gammaS, a: R.aEq, comp: R, gf: R.gammaFrozen }]];
  const paint = () => {
    const C = cols();
    if (S.prob === 'rocket') {
      metrics.set([
        { k: 'Chamber T', v: R.chamber.T.toFixed(1) + ' K' }, { k: 'c*', v: R.cstar.toFixed(1) + ' m/s', tip: 'Characteristic velocity Pc·At/ṁ: combustion quality, independent of the nozzle.' },
        { k: 'Isp (pe = pa, ue)', v: (R.exit.u / G0).toFixed(1) + ' s', s: `${R.exit.u.toFixed(0)} m/s` }, { k: 'Vacuum Isp', v: (R.Ivac / G0).toFixed(1) + ' s' },
        { k: `Isp at pa = ${S.pa} bar`, v: (R.Isp / G0).toFixed(1) + ' s', cls: R.Isp < 0 ? 'bad' : '' }, { k: 'CF (vacuum)', v: fmt(R.CFvac, 4) },
        { k: 'Ae/At', v: fmt(R.eps, 3) }, { k: 'Exit Mach', v: fmt(R.exit.M, 3) }, { k: 'Exhaust M', v: (R.chamber.W * 1000).toFixed(3) + ' g/mol' }, { k: 'γs chamber', v: fmt(R.chamber.gamma, 4) },
      ]);
    } else {
      metrics.set([{ k: 'Temperature', v: R.T.toFixed(2) + ' K' }, { k: 'Molar mass', v: (R.W * 1000).toFixed(3) + ' g/mol' }, { k: 'γs (equilibrium)', v: fmt(R.gammaS, 4) }, { k: 'γ frozen', v: fmt(R.gammaFrozen, 4) }, { k: 'cp eq.', v: (R.cpEq / 1000).toFixed(4) + ' kJ/kg·K' }, { k: 'Sound speed', v: R.aEq.toFixed(1) + ' m/s' }, { k: 'Density', v: R.rho.toPrecision(5) + ' kg/m³' }]);
    }
    const rows = [
      ['P, bar', c => (c.P / 1e5).toFixed(4)], ['T, K', c => c.T.toFixed(2)], ['ρ, kg/m³', c => c.rho.toPrecision(5)], ['h, kJ/kg', c => (c.h / 1000).toFixed(2)], ['s, kJ/(kg·K)', c => (c.s / 1000).toFixed(4)],
      ['M, g/mol', c => (c.W * 1000).toFixed(3)], ['cp, kJ/(kg·K)', c => (c.cp / 1000).toFixed(4)], ['γs', c => c.gamma.toFixed(4)], ['Son. vel., m/s', c => c.a.toFixed(1)],
    ];
    if (S.prob === 'rocket') rows.push(['Mach', c => c.M.toFixed(3)], ['Ae/At', c => isFinite(c.eps) ? c.eps.toFixed(4) : '—'], ['C*, m/s', (c, i) => i ? R.cstar.toFixed(1) : '—'], ['CF', (c, i) => i ? (c.u / R.cstar).toFixed(4) : '—'], ['Ivac, s', (c, i) => i ? ((c.u + c.P / (c.rho * c.u)) / G0).toFixed(1) : '—'], ['Isp (pe), s', (c, i) => i ? (c.u / G0).toFixed(1) : '—']);
    tabEl.replaceChildren(h('table', { class: 'data' }, h('thead', {}, h('tr', {}, h('th', { style: { textAlign: 'left' } }, ''), ...C.map(c => h('th', {}, c[0])))),
      h('tbody', {}, ...rows.map(([lab, f]) => h('tr', {}, h('td', { style: { textAlign: 'left', fontFamily: 'var(--font)' } }, lab), ...C.map((c, i) => h('td', {}, f(c[1], i))))))));
    // composition
    const sets = C.map(c => TH.moleFractions(c[1].comp));
    const names = [...new Set(sets.flat().map(x => x.name))];
    const comp0 = sets[0], maxX = Math.max(...comp0.map(x => x.x));
    const get = (set, n) => (set.find(x => x.name === n) || { x: 0 }).x;
    names.sort((a, b) => get(comp0, b) - get(comp0, a));
    molEl.replaceChildren(h('table', { class: 'data' }, h('thead', {}, h('tr', {}, h('th', { style: { textAlign: 'left' } }, 'Species'), ...C.map(c => h('th', {}, c[0])), h('th', { style: { width: '40%' } }, ''))),
      h('tbody', {}, ...names.map(n => h('tr', {}, h('td', { style: { textAlign: 'left', fontFamily: 'var(--font)' } }, TH.displayName(n)), ...sets.map(s => h('td', {}, fmtX(get(s, n)))),
        h('td', {}, h('div', { class: 'xbar' }, h('div', { style: { width: (Math.log10(Math.max(get(comp0, n), 1e-6) / 1e-6) / Math.log10(Math.max(maxX, 1e-5) / 1e-6) * 100) + '%' } }))))))));
    // notes
    const L = [];
    const top = sets[0].filter(x => ['H', 'O', 'OH', 'CO', 'NO', 'N'].includes(x.name)).reduce((a, x) => a + x.x, 0);
    if (top > 0.02) L.push({ type: 'i', t: `Dissociation: ${(top * 100).toFixed(1)}% radicals and CO/NO`, d: 'These species store chemical energy. In an equilibrium nozzle they recombine and give some of it back as the gas cools.' });
    const ofv = S.mixBy === 'of' ? S.of : TH.stoichOF(S.fuel, S.ox) / S.phi, phi = TH.stoichOF(S.fuel, S.ox) / ofv;
    if (phi > 1.6 && (TH.REACTANTS[S.fuel].el.C || 0) > 0) L.push({ type: 'w', t: 'Very fuel-rich hydrocarbon', d: 'Real combustion would form soot (solid carbon); this gas-only model does not include condensed species.' });
    if (S.prob === 'rocket') {
      L.push({ type: 'i', t: S.frozen ? 'Frozen expansion' : 'Equilibrium expansion', d: S.frozen ? 'Composition fixed at the chamber values: a conservative lower bound on performance.' : 'Composition re-equilibrates at every pressure (infinitely fast chemistry): an upper bound.' });
      if (R.exit.T < 600 && (TH.REACTANTS[S.fuel].el.H || 0) > 0) L.push({ type: 'w', t: 'Water may condense', d: `Exit temperature ${R.exit.T.toFixed(0)} K; condensed phases are not modelled.` });
      if (R.Isp < R.exit.u * 0.9 && S.pa > 0) L.push({ type: 'w', t: 'Overexpanded at this ambient', d: `Exit pressure ${(R.exit.P / 1e5).toFixed(3)} bar is below ambient ${S.pa} bar; flow separation is likely below about 0.3–0.4 × pa.` });
    }
    if (!R.converged) L.push({ type: 'b', t: 'Not converged', d: 'The Newton iteration did not reach tolerance. Try a different mixture ratio or pressure.' });
    insightsList(insEl, L.length ? L : [{ type: 'g', t: 'Converged', d: 'Gibbs-energy minimum found to CEA tolerance.' }]);
  };
  const fmtX = x => x === 0 ? '—' : x < 1e-4 ? x.toExponential(2) : x.toFixed(5);
  const sweep = () => {
    if (S.prob === 'tp' && S.mixBy === 'of' && S.of > 1e4) { swPlot.setData({ series: [] }); swPlot2.setData({ series: [] }); return; }
    const ofst = TH.stoichOF(S.fuel, S.ox), cur = S.mixBy === 'of' ? S.of : ofst / S.phi;
    const lo = Math.min(cur, ofst) * 0.35, hi = Math.max(cur, ofst) * 1.8, n = S.prob === 'rocket' ? 26 : 40;
    const xs = [], T = [], I = [], W = [], gm = [], cs = [];
    for (let i = 0; i < n; i++) {
      const of = lo * (hi / lo) ** (i / (n - 1));
      try { const r = solve(of); xs.push(of); if (S.prob === 'rocket') { T.push(r.chamber.T); I.push(r.Ivac / G0); cs.push(r.cstar); W.push(r.chamber.W * 1000); gm.push(r.chamber.gamma); } else { T.push(r.T); W.push(r.W * 1000); gm.push(r.gammaS); } } catch { }
    }
    const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const vl = [{ x: cur, color: cssv('--accent') }, { x: ofst, color: cssv('--text-3'), dash: [2, 3] }];
    if (S.prob === 'rocket') {
      swPlot.setOpts({ ylabel: 'K  |  s ×5' });
      swPlot.setData({ series: [{ x: xs, y: T, color: cssv('--lower'), label: 'chamber T (K)' }, { x: xs, y: I.map(v => v * 5), color: cssv('--upper'), label: 'vacuum Isp ×5 (s)', extra: i => `Ivac ${I[i].toFixed(1)} s, c* ${cs[i].toFixed(0)} m/s` }], vlines: vl });
    } else { swPlot.setOpts({ ylabel: 'T (K)' }); swPlot.setData({ series: [{ x: xs, y: T, color: cssv('--lower'), label: S.prob === 'hp' ? 'adiabatic flame T' : 'T' }], vlines: vl }); }
    swPlot2.setData({ series: [{ x: xs, y: W, color: cssv('--turb'), label: 'molar mass (g/mol)' }, { x: xs, y: gm.map(g => g * 20), color: cssv('--lam'), label: 'γs ×20', extra: i => `γs ${gm[i].toFixed(4)}` }], vlines: vl });
  };
  copyBtn.addEventListener('click', () => downloadText('cea-output.txt', textOutput(), 'text/plain'));
  const textOutput = () => {
    const C = cols(), pad = (s, n) => String(s).padStart(n);
    let o = `Pteronautics chemical equilibrium (NASA CEA method, RP-1311)\nMade by Andrew Aguiar\n\nProblem: ${S.prob.toUpperCase()}  ${S.frozen && S.prob === 'rocket' ? 'FROZEN' : 'EQUILIBRIUM'}\nFuel: ${TH.REACTANTS[S.fuel].label}   Oxidizer: ${TH.REACTANTS[S.ox].label}\nO/F = ${(S.mixBy === 'of' ? S.of : TH.stoichOF(S.fuel, S.ox) / S.phi).toFixed(5)}   P = ${S.Pc} bar\n\n`;
    o += pad('', 18) + C.map(c => pad(c[0].toUpperCase(), 13)).join('') + '\n';
    const line = (lab, f) => { o += lab.padEnd(18) + C.map((c, i) => pad(f(c[1], i), 13)).join('') + '\n'; };
    line('P, BAR', c => (c.P / 1e5).toFixed(4)); line('T, K', c => c.T.toFixed(2)); line('RHO, KG/M3', c => c.rho.toExponential(4)); line('H, KJ/KG', c => (c.h / 1e3).toFixed(2)); line('S, KJ/(KG)(K)', c => (c.s / 1e3).toFixed(4));
    line('M, (1/n)', c => (c.W * 1e3).toFixed(3)); line('Cp, KJ/(KG)(K)', c => (c.cp / 1e3).toFixed(4)); line('GAMMAs', c => c.gamma.toFixed(4)); line('SON VEL,M/SEC', c => c.a.toFixed(1));
    if (S.prob === 'rocket') { line('MACH NUMBER', c => c.M.toFixed(3)); o += `\nAe/At ${R.eps.toFixed(4)}  CSTAR ${R.cstar.toFixed(1)} m/s  CF ${(R.exit.u / R.cstar).toFixed(4)}  Ivac ${(R.Ivac / G0).toFixed(2)} s  Isp ${(R.exit.u / G0).toFixed(2)} s\n`; }
    o += '\nMOLE FRACTIONS\n';
    const sets = C.map(c => TH.moleFractions(c[1].comp)); const names = [...new Set(sets.flat().map(x => x.name))];
    for (const n of names) o += ('*' + n).padEnd(18) + sets.map(s => pad(((s.find(x => x.name === n) || { x: 0 }).x).toExponential(4), 13)).join('') + '\n';
    return o;
  };

  build(); compute(); sweep();
  return { controls, main };
}
