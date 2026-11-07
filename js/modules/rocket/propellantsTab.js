// Propellant comparison: every combination run through the same equilibrium solver at the same chamber pressure
// and expansion ratio. Isp vs mixture ratio, chamber temperature, exhaust molar mass, bulk density and density
// impulse — the trade between a light, high-Isp propellant and a dense one that needs smaller tanks.
import { h, section, segmented, toggle, hexToRgb } from '../../lib/ui.js';
import { Plot } from '../../lib/plot.js';
import * as R from '../../solvers/rocket.js';
import * as TH from '../../solvers/thermo.js';
import { store, schedule, bound, insightsList, card, put, G0, propLabel } from './common.js';

const COLORS = ['--upper', '--turb', '--lower', '--good', '--warn', '--lam', '--bad', '--text-2'];
const NPTS = 15;

export function propellantsTab(shell) {
  const P = { Pc: 70, eps: 40, frozen: false, on: Object.fromEntries(R.COMBOS.map(c => [c.id, true])) };
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });
  const status = h('div', { class: 'hint' });
  const tCard = card('Propellant combinations at their best mixture ratio', 'Each row uses the O/F that maximises vacuum Isp at the chamber pressure and ε on the left. Sea-level Isp is for a nozzle expanded to exactly 1 atm. Density impulse = bulk density × Isp: what matters when tank volume (drag, structure) limits the vehicle.');
  const tEl = h('div', { class: 'table-wrap' }); tCard.append(tEl);
  const cCard = card('Sweep over mixture ratio', 'Solid: the chosen quantity across each combination\'s practical O/F range. Dots: the maximum-Isp point.');
  let q = 'Ivac';
  const qSeg = segmented([{ value: 'Ivac', label: 'Vacuum Isp' }, { value: 'Isl', label: 'Sea-level Isp' }, { value: 'Tc', label: 'Chamber T' }, { value: 'W', label: 'Molar mass' }, { value: 'cstar', label: 'c*' }, { value: 'rhoI', label: 'Density Isp' }], q, v => { q = v; paintSweep(); });
  qSeg.el.classList.add('seg-wrap');
  cCard.querySelector('.plot-head').append(h('div', { class: 'grow' }), qSeg.el);
  const cPlot = new Plot(cCard, { xlabel: 'mixture ratio O/F', xname: 'O/F', yname: 'value', logx: true, xfmt: v => v.toFixed(2), legendPos: 'bottom' });
  cPlot.wrap.style.height = '320px';
  const dCard = card('Isp vs bulk density', 'Upper right is best on both. Hydrogen is in a corner of its own: the highest Isp by far, but at a tenth of the density of the others, so its stages are huge. Dense storables lose Isp but fit in small tanks and keep for years.');
  const dPlot = new Plot(dCard, { xlabel: 'bulk density (kg/m³)', ylabel: 'vacuum Isp (s)', xname: 'ρ', yname: 'Isp', xfmt: v => v.toFixed(0) + ' kg/m³', yfmt: v => v.toFixed(1) + ' s', legend: true, legendPos: 'bottom', xPad: true });
  dPlot.wrap.style.height = '320px';
  const insCard = card('Notes'); const insEl = h('div'); insCard.append(insEl);
  main.append(status, tCard, h('div', { class: 'cf-grid2b' }, cCard, dCard), insCard);

  const build = () => {
    const sec = section('Conditions');
    put(sec.body,
      bound(P, 'Pc', 'Chamber pressure Pc', 5, 300, { log: true, digits: 1, unit: 'bar', onInput: run }),
      bound(P, 'eps', 'Expansion ratio for vacuum Isp', 3, 300, { log: true, digits: 1, onInput: run }),
      toggle('Frozen composition', P.frozen, v => { P.frozen = v; run(); }, { tip: 'No recombination in the nozzle (lower bound).' }).el);
    const secC = section('Combinations');
    for (const c of R.COMBOS) put(secC.body, toggle(c.label, P.on[c.id], v => { P.on[c.id] = v; paintAll(); }, { swatch: `var(${COLORS[R.COMBOS.indexOf(c) % COLORS.length]})` }).el);
    put(secC.body, h('div', { class: 'hint' }, 'Solid propellants (ammonium perchlorate / aluminium) need chlorine and aluminium species that this chemistry set does not include.'));
    controls.replaceChildren(sec.el, secC.el);
  };

  // ---------- computation (chunked so the page stays responsive) ----------
  let res = {}, job = 0, timer = null;
  const run = () => { clearTimeout(timer); timer = setTimeout(start, 150); };
  const solveOne = (c, of) => {
    const re = R.reactantsFor(c.fuel, c.ox, of), Pc = P.Pc * 1e5;
    const v = TH.rocket({ reactants: re, Pc, eps: P.eps, frozen: P.frozen });
    const s = TH.rocket({ reactants: re, Pc, pcpe: Pc / 101325, frozen: P.frozen });
    const rho = R.bulkDensity(c.fuel, c.ox, of);
    return { of, Ivac: v.Ivac / G0, Isl: Pc > 101325 * 1.9 ? s.exit.u / G0 : NaN, Tc: v.chamber.T, W: v.chamber.W * 1000, cstar: v.cstar, gamma: v.chamber.gamma, rho, rhoI: rho * v.Ivac / G0 / 1000, epsSL: s.eps };
  };
  const start = () => {
    const my = ++job; res = {};
    const list = R.COMBOS.slice();
    status.textContent = 'Computing…';
    const next = () => {
      if (my !== job) return;
      const c = list.shift();
      if (!c) { status.textContent = `${R.COMBOS.length} combinations × ${NPTS} mixture ratios, ${P.frozen ? 'frozen' : 'equilibrium'} expansion, Pc ${P.Pc.toFixed(0)} bar, ε ${P.eps.toFixed(0)} (vacuum).`; paintAll(); return; }
      const [lo, hi] = c.range, pts = [];
      for (let i = 0; i < NPTS; i++) { const of = lo * (hi / lo) ** (i / (NPTS - 1)); try { pts.push(solveOne(c, of)); } catch { } }
      // refine the peak with a parabola through the best three points (in log O/F)
      let k = 0; pts.forEach((p, i) => { if (p.Ivac > pts[k].Ivac) k = i; });
      let best = pts[k];
      if (k > 0 && k < pts.length - 1) {
        const [a, b, d] = [pts[k - 1], pts[k], pts[k + 1]].map(p => [Math.log(p.of), p.Ivac]);
        const den = (a[0] - b[0]) * (a[0] - d[0]) * (b[0] - d[0]);
        const A = (d[0] * (b[1] - a[1]) + b[0] * (a[1] - d[1]) + a[0] * (d[1] - b[1])) / den;
        const B = (d[0] ** 2 * (a[1] - b[1]) + b[0] ** 2 * (d[1] - a[1]) + a[0] ** 2 * (b[1] - d[1])) / den;
        if (A < 0) { try { best = solveOne(c, Math.exp(-B / (2 * A))); } catch { } }
      }
      res[c.id] = { pts, best };
      status.textContent = `Computing… ${Object.keys(res).length}/${R.COMBOS.length}`;
      paintAll();
      setTimeout(next, 0);
    };
    setTimeout(next, 0);
  };

  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const colorOf = c => css(COLORS[R.COMBOS.indexOf(c) % COLORS.length]);
  const shown = () => R.COMBOS.filter(c => P.on[c.id] && res[c.id]);
  const paintAll = () => { paintTable(); paintSweep(); paintScatter(); paintNotes(); };
  const paintTable = () => {
    const rows = shown().map(c => ({ c, b: res[c.id].best })).sort((a, b) => b.b.Ivac - a.b.Ivac);
    const best = k => Math.max(...rows.map(r => r.b[k]).filter(isFinite));
    const hl = (k, v) => ({ style: { color: Math.abs(v - best(k)) < 1e-9 ? 'var(--accent)' : null, fontWeight: Math.abs(v - best(k)) < 1e-9 ? '600' : null } });
    const head = ['Combination', 'O/F', 'Chamber T', 'Molar mass', 'γ', 'c*', 'Isp vac', 'Isp SL', 'Bulk ρ', 'Density Isp', 'Storage', ''];
    tEl.replaceChildren(h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ...head.map((x, i) => h('th', { style: i === 0 ? { textAlign: 'left' } : null }, x)))),
      h('tbody', {}, ...rows.map(({ c, b }) => {
        const use = h('button', { class: 'btn sm', type: 'button', title: 'Open this combination in Engine design' }, 'Design');
        use.addEventListener('click', () => { Object.assign(store.S, { fuel: c.fuel, ox: c.ox, of: +b.of.toFixed(3), Lstar: c.Lstar, preset: '' }); schedule(); shell.go('design'); });
        const cryo = [c.fuel, c.ox].filter(id => R.PROPS[id].Tb < 200).map(propLabel);
        return h('tr', {},
          h('td', { style: { textAlign: 'left', fontFamily: 'var(--font)' } }, h('span', { class: 'swatch', style: { background: colorOf(c), display: 'inline-block', width: '9px', height: '9px', borderRadius: '2px', marginRight: '6px' } }), c.label),
          h('td', {}, b.of.toFixed(2)), h('td', {}, b.Tc.toFixed(0) + ' K'), h('td', {}, b.W.toFixed(1)), h('td', {}, b.gamma.toFixed(3)), h('td', {}, b.cstar.toFixed(0)),
          h('td', hl('Ivac', b.Ivac), b.Ivac.toFixed(1) + ' s'), h('td', hl('Isl', b.Isl), isFinite(b.Isl) ? b.Isl.toFixed(1) + ' s' : '—'),
          h('td', hl('rho', b.rho), b.rho.toFixed(0)), h('td', hl('rhoI', b.rhoI), b.rhoI.toFixed(0)),
          h('td', { style: { fontFamily: 'var(--font)', textAlign: 'left' } }, cryo.length ? 'cryogenic (' + cryo.join(', ') + ')' : 'storable'),
          h('td', {}, use));
      }))),
      h('div', { class: 'hint', style: { marginTop: '6px' } }, 'Molar mass in g/mol, c* in m/s, bulk density in kg/m³, density Isp in kg·s/L (= g·s/cm³ × 1000). Highlighted: best in column.'));
  };
  const paintSweep = () => {
    const lab = { Ivac: 'vacuum Isp (s)', Isl: 'sea-level Isp (s)', Tc: 'chamber temperature (K)', W: 'exhaust molar mass (g/mol)', cstar: 'c* (m/s)', rhoI: 'density Isp (kg·s/L)' }[q];
    cPlot.setOpts({ ylabel: lab });
    const series = [];
    for (const c of shown()) {
      const r = res[c.id], col = colorOf(c);
      series.push({ x: r.pts.map(p => p.of), y: r.pts.map(p => p[q]), color: col, label: c.label, extra: i => `Isp vac ${r.pts[i].Ivac.toFixed(1)} s · Tc ${r.pts[i].Tc.toFixed(0)} K` });
      series.push({ x: [r.best.of], y: [r.best[q]], color: col, line: false, points: true, pointSize: 4, noLegend: true, noHover: true });
    }
    cPlot.setData({ series });
  };
  const paintScatter = () => {
    const series = shown().map(c => { const b = res[c.id].best; return { x: [b.rho], y: [b.Ivac], color: colorOf(c), line: false, points: true, pointSize: 6, label: c.label, extra: () => `O/F ${b.of.toFixed(2)} · density Isp ${b.rhoI.toFixed(0)}` }; });
    // iso-lines of density impulse
    const [r, g, b] = hexToRgb(css('--text-3'));
    for (const di of [150, 300, 450]) { const xs = [], ys = []; for (let x = 200; x <= 1500; x += 25) { const y = di * 1000 / x; if (y > 250 && y < 480) { xs.push(x); ys.push(y); } } series.push({ x: xs, y: ys, color: `rgba(${r},${g},${b},0.6)`, dash: [2, 4], width: 1, noLegend: true, noHover: true, skipBounds: true }); }
    const ys = shown().map(c => res[c.id].best.Ivac);
    if (ys.length) dPlot.setOpts({ ylim: [Math.min(...ys) - 12 - 7 * Math.ceil(ys.length / 4), Math.max(...ys) + 8] });
    dPlot.setData({ series });
  };
  const paintNotes = () => {
    const s = shown(); if (!s.length) { insightsList(insEl, []); return; }
    const by = k => s.reduce((a, c) => (res[c.id].best[k] > res[a.id].best[k] ? c : a));
    const hi = by('Ivac'), dens = by('rhoI'), hot = by('Tc');
    insightsList(insEl, [
      { type: 'g', t: `Highest Isp: ${hi.label}, ${res[hi.id].best.Ivac.toFixed(0)} s`, d: `Its exhaust is light (${res[hi.id].best.W.toFixed(1)} g/mol, mostly H₂O and H₂). Isp scales with √(T/M), so the molar mass matters as much as the flame temperature.` },
      { type: 'i', t: `Most impulse per litre: ${dens.label}`, d: `Density impulse ${res[dens.id].best.rhoI.toFixed(0)} kg·s/L. First stages fight drag and gravity with heavy, dense loads, which is why boosters often burn kerosene or methane and leave hydrogen to the upper stages.` },
      { type: 'i', t: `Hottest chamber: ${hot.label}, ${res[hot.id].best.Tc.toFixed(0)} K`, d: 'Far above what any metal survives: the wall is kept cool by the propellant flowing through cooling channels (see the Cooling tab).' },
      { type: 'i', t: 'Best O/F is fuel-rich of stoichiometric', d: 'For every combination the Isp peak sits at less oxidizer than complete combustion needs, where the falling molar mass outweighs the falling temperature.' },
    ]);
  };

  let visible = false;
  build();
  return {
    controls, main,
    show() { visible = true; if (!Object.keys(res).length) start(); },
    hide() { visible = false; },
    destroy() { job++; },
  };
}
