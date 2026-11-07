// Engine design: propellants, chamber pressure, thrust and expansion ratio in; a sized engine out — throat and
// exit diameters, chamber length from L*, the nozzle contour, mass flows, Isp and thrust at sea level and in vacuum,
// equilibrium chemistry, and a cut-away with the plume at a chosen altitude.
import { h, section, segmented, select, field, toggle } from '../../lib/ui.js';
import { Plot } from '../../lib/plot.js';
import * as R from '../../solvers/rocket.js';
import * as TH from '../../solvers/thermo.js';
import { store, schedule, loadEngine, preset, bound, metricsGrid, insightsList, card, fmt, put, resultRows, G0, kN, klbf, bar, len, REGIMES, propLabel } from './common.js';
import { EngineView, VIEW_MODES } from './engineView.js';
import { sendTo, sendSection } from '../../lib/send.js';

export function designTab(shell) {
  const S = store.S;
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });
  const status = h('div', { class: 'hint' });
  const metrics = metricsGrid();
  const view = new EngineView();
  const vcard = card('Engine cut-away (to scale)', 'Chamber, convergent section, throat and nozzle drawn to scale from the sizing below. The gas is colored by the chosen quantity from the equilibrium solution; the plume is drawn for the ambient pressure at the altitude set on the left. Hover for local values.');
  const modeSeg = segmented(VIEW_MODES.filter(m => m.value !== 'q'), 'T', v => view.set({ mode: v }));
  vcard.querySelector('.plot-head').append(h('div', { class: 'grow' }), modeSeg.el);
  const regime = h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap', marginBottom: '8px' } });
  vcard.append(regime, view.el);
  const sizeCard = card('Sizing', 'Throat area from the thrust requirement: At = F / (CF·Pc). Chamber volume from the characteristic length: Vc = L*·At. Contraction ratio from the Huzel & Huang correlation unless set by hand.');
  const sizeEl = h('div', { class: 'cf-res' }); sizeCard.append(sizeEl);
  const cmpCard = card('Compared with the real engine', 'Published values (approximate, from manufacturer and NASA data). The model is an ideal infinite-area combustor scaled by the c* and nozzle efficiencies on the left; a gas-generator cycle also dumps turbine exhaust at low Isp.');
  const cmpEl = h('div'); cmpCard.append(cmpEl);
  const alongCard = card('Along the engine', 'Quasi-one-dimensional isentropic flow with the composition re-equilibrating at each pressure (or frozen). The wall radius is drawn dashed for reference.');
  let alongQ = 'M';
  const alongSeg = segmented([{ value: 'M', label: 'Mach' }, { value: 'T', label: 'T' }, { value: 'P', label: 'p' }, { value: 'u', label: 'Velocity' }, { value: 'W', label: 'Molar mass' }], alongQ, v => { alongQ = v; paintAlong(); });
  alongCard.querySelector('.plot-head').append(h('div', { class: 'grow' }), alongSeg.el);
  const alongPlot = new Plot(alongCard, { xlabel: 'distance from throat (cm)', xname: 'x', yname: 'value', xfmt: v => v.toFixed(1) + ' cm', yfmt: v => v.toPrecision(4) });
  alongPlot.wrap.style.height = '240px';
  const compCard = card('Exhaust composition (mole fractions)', 'Chamber vs nozzle exit. At chamber temperature the products dissociate (H, O, OH, CO); as the gas expands and cools they recombine and release energy, which is why equilibrium flow gives more Isp than frozen.');
  const compEl = h('div'); compCard.append(compEl);
  const insCard = card('What the design tells you'); const insEl = h('div'); insCard.append(insEl);
  main.append(status, metrics.el, vcard, h('div', { class: 'cf-grid2b' }, sizeCard, cmpCard), h('div', { class: 'cf-grid2b' }, alongCard, compCard), insCard);

  const changed = () => { S.preset = ''; presetSel.value = ''; schedule(); };
  let presetSel;
  // hand this engine to other modules
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const sendSec = sendSection([
    { label: 'Shocks & Nozzles', sub: 'This nozzle: flow, shocks and plume at sea level', go: () => {
      const D = store.D; if (!D) return 'The engine has not been designed yet';
      const name = preset()?.name || 'this engine';
      sendTo({ mod: 'compressible', tab: 'nozzle', note: `Opened the nozzle of ${name} (ε ${+S.eps.toFixed(1)}, γ ${D.id.throat.gamma.toFixed(3)}, ${Math.round(D.Tc)} K) at sea level`, values: {
        type: S.nozzle === 'bell' ? 'bell' : 'conical', eps: clamp(S.eps, 1.05, 100), half: S.half, gas: 'custom', g: +D.id.throat.gamma.toFixed(4), R: +D.id.chamber.R.toFixed(2),
        p0: S.Pc * 100, T0: clamp(D.Tc, 100, 4000), At: clamp(D.At * 1e4, 0.1, 10000), pb: clamp(101.325 / (S.Pc * 100), 0.001, 0.999) } });
    } },
    { label: 'Jet Engine Cycles · Chemical equilibrium', sub: 'The same propellants, O/F, Pc and ε in the full CEA rocket problem', go: () => {
      sendTo({ mod: 'turbine', tab: 'cea', note: `Opened ${propLabel(S.ox)} / ${propLabel(S.fuel)} at O/F ${S.of}, ${S.Pc} bar, ε ${S.eps}`, values: {
        prob: 'rocket', fuel: S.fuel, ox: S.ox, mixBy: 'of', of: S.of, Pc: S.Pc, exit: 'eps', eps: S.eps, frozen: !!S.frozen } });
    } },
  ]);
  const build = () => {
    const secE = section('Engine');
    presetSel = select([{ value: '', label: 'Custom design' }, ...R.ENGINES.map(e => ({ value: e.id, label: e.name }))], S.preset || '', v => { if (v) { loadEngine(v); build(); schedule(); } else S.preset = ''; });
    const cyc = select(Object.entries(R.CYCLES).map(([value, label]) => ({ value, label })), S.cycle, v => { S.cycle = v; build(); schedule(); });
    put(secE.body, field('Example engines', presetSel, 'Loads propellants, mixture ratio, chamber pressure, expansion ratio and thrust of a real engine so you can compare the model with published data.'),
      field('Power cycle', cyc, 'How the turbopumps are driven. Only the <b>gas generator</b> (open) cycle changes performance here: a few percent of the propellant drives the turbine and is dumped overboard at low Isp. Closed cycles (staged combustion, expander) send it all through the chamber.'),
      S.cycle === 'gg' ? bound(S, 'gg', 'Gas generator flow', 0.005, 0.08, { step: 0.001, digits: 3, scale: 1, onInput: changed, tip: 'Fraction of total propellant flow burned in the gas generator (Merlin, F-1 ≈ 3%). Its exhaust is assumed to leave at one third of the main chamber Isp.' }) : null);
    const secP = section('Propellants');
    const ofst = TH.stoichOF(S.fuel, S.ox);
    const best = h('button', { class: 'btn sm', type: 'button', title: 'Find the O/F that maximises vacuum Isp at this Pc and ε' }, 'Set O/F for max Isp');
    best.addEventListener('click', () => { best.textContent = 'Searching…'; setTimeout(() => { S.of = bestOF(); build(); changed(); }, 20); });
    put(secP.body,
      field('Fuel', select(R.FUELS.map(v => ({ value: v, label: TH.REACTANTS[v].label })), S.fuel, v => { S.fuel = v; const c = R.comboOf(S.fuel, S.ox); if (c) { S.of = c.of; S.Lstar = c.Lstar; } else S.of = TH.stoichOF(S.fuel, S.ox) * 0.8; build(); changed(); })),
      field('Oxidizer', select(R.OXIDIZERS.map(v => ({ value: v, label: TH.REACTANTS[v].label })), S.ox, v => { S.ox = v; const c = R.comboOf(S.fuel, S.ox); if (c) { S.of = c.of; S.Lstar = c.Lstar; } else S.of = TH.stoichOF(S.fuel, S.ox) * 0.8; build(); changed(); })),
      bound(S, 'of', 'Mixture ratio O/F', 0.3, Math.max(12, ofst * 1.6), { log: true, digits: 3, onInput: changed, tip: `Oxidizer-to-fuel mass ratio. Stoichiometric O/F = ${ofst.toFixed(3)}. Engines run fuel-rich: lighter exhaust molecules and less dissociation more than make up for the lower temperature.` }),
      h('div', { class: 'row', style: { marginBottom: '10px' } }, best));
    const secC = section('Chamber & thrust');
    const atSeg = segmented([{ value: 'sl', label: 'At sea level' }, { value: 'vac', label: 'In vacuum' }], S.at, v => { S.at = v; changed(); });
    atSeg.el.classList.add('seg-wrap');
    put(secC.body,
      bound(S, 'F', 'Thrust', 0.1, 10000, { log: true, digits: 1, unit: 'kN', onInput: changed, tip: 'Required thrust. Sets the throat area (and so every dimension) at the chosen condition.' }),
      field('Thrust specified', atSeg.el),
      bound(S, 'Pc', 'Chamber pressure Pc', 3, 350, { log: true, digits: 1, unit: 'bar', onInput: changed, tip: 'Higher Pc shrinks the engine for the same thrust and allows a bigger ε at sea level, but needs more pump power. Pressure-fed engines: 5–25 bar; pump-fed boosters: 70–300 bar.' }),
      bound(S, 'Lstar', 'Characteristic length L*', 0.4, 2.5, { step: 0.01, digits: 2, unit: 'm', onInput: changed, tip: 'L* = chamber volume / throat area: a measure of residence time for droplets to vaporise and burn. Typical: LOX/LH₂ 0.76–1.0 m, LOX/RP-1 1.0–1.3 m, storables 0.75–0.9 m.' }),
      toggle('Contraction ratio from throat size', S.autoCont, v => { S.autoCont = v; build(); changed(); }, { tip: 'Ac/At from the Huzel & Huang correlation 8·Dt^−0.6 + 1.25 (Dt in cm): small engines need relatively fatter chambers.' }).el,
      S.autoCont ? null : bound(S, 'contraction', 'Contraction ratio Ac/At', 1.5, 12, { step: 0.05, digits: 2, onInput: changed }));
    const secN = section('Nozzle');
    const nz = segmented([{ value: 'bell', label: '80% bell (Rao)' }, { value: 'cone', label: 'Cone' }], S.nozzle, v => { S.nozzle = v; build(); changed(); });
    nz.el.classList.add('seg-wrap');
    put(secN.body,
      bound(S, 'eps', 'Expansion ratio Ae/At', 1.5, 300, { log: true, digits: 1, onInput: changed, tip: 'Exit area / throat area. Bigger ε gives more vacuum Isp but over-expands (and may separate) at sea level. Boosters 15–40, vacuum stages 60–300.' }),
      field('Contour', nz.el, 'An 80% bell (Rao thrust-optimised parabola) is 20% shorter than a 15° cone of the same ε with almost no divergence loss.'),
      S.nozzle === 'cone' ? bound(S, 'half', 'Cone half-angle', 8, 25, { step: 0.5, digits: 1, unit: '°', onInput: changed, tip: 'Divergence factor λ = (1 + cos α)/2: 15° loses 1.7% of the momentum thrust.' }) : null,
      bound(S, 'etaC', 'c* efficiency', 0.88, 1, { step: 0.001, digits: 3, onInput: changed, tip: 'Combustion efficiency: real c* / ideal c*. Good injectors reach 0.97–0.99.' }),
      bound(S, 'etaN', 'Nozzle efficiency', 0.9, 1, { step: 0.001, digits: 3, onInput: changed, tip: 'Boundary-layer drag and finite-rate chemistry losses on the momentum thrust, on top of divergence. Typically 0.97–0.99.' }),
      toggle('Frozen composition in the nozzle', S.frozen, v => { S.frozen = v; changed(); }, { tip: 'Frozen: the composition stays as it left the chamber (no recombination; lower bound on Isp). Equilibrium: infinitely fast chemistry (upper bound). Real engines lie between, closer to equilibrium at high Pc.' }).el);
    const secA = section('Ambient');
    put(secA.body, bound(S, 'alt', 'Altitude for the plume', 0, 100, { step: 0.1, digits: 1, unit: 'km', onInput: () => paint(), tip: 'Ambient pressure from the US Standard Atmosphere (vacuum above 86 km). Changes the plume shape and the thrust shown, not the design.' }));
    controls.replaceChildren(secE.el, secP.el, secC.el, secN.el, secA.el, sendSec);
  };
  const bestOF = () => {
    const c = R.comboOf(S.fuel, S.ox), st = TH.stoichOF(S.fuel, S.ox);
    let [lo, hi] = c ? c.range : [st * 0.3, st * 1.3];
    const I = of => { try { return TH.rocket({ reactants: R.reactantsFor(S.fuel, S.ox, of), Pc: S.Pc * 1e5, eps: S.eps, frozen: S.frozen }).Ivac; } catch { return 0; } };
    // golden-section search on vacuum Isp
    const gr = 0.618034; let a = lo, b = hi, x1 = b - gr * (b - a), x2 = a + gr * (b - a), f1 = I(x1), f2 = I(x2);
    for (let i = 0; i < 22; i++) { if (f1 > f2) { b = x2; x2 = x1; f2 = f1; x1 = b - gr * (b - a); f1 = I(x1); } else { a = x1; x1 = x2; f1 = f2; x2 = a + gr * (b - a); f2 = I(x2); } }
    return +((a + b) / 2).toFixed(3);
  };

  const paint = () => {
    if (store.err) { status.textContent = 'Could not solve: ' + store.err.message; return; }
    const D = store.D; if (!D) return;
    const pa = R.ambient(S.alt * 1000), pf = D.perf(pa);
    const ofst = TH.stoichOF(S.fuel, S.ox);
    status.textContent = `${propLabel(S.ox)} / ${propLabel(S.fuel)} · O/F ${S.of.toFixed(2)} (φ = ${(ofst / S.of).toFixed(2)}, ${S.of < ofst ? 'fuel-rich' : 'oxidizer-rich'}) · ${S.frozen ? 'frozen' : 'equilibrium'} expansion · solved in ${store.ms.toFixed(0)} ms`;
    metrics.set([
      { k: 'Thrust, sea level', v: kN(D.sl.F), s: klbf(D.sl.F) + (D.sl.sep ? ' · separated' : ''), cls: D.sl.F < 0 ? 'bad' : '' },
      { k: 'Thrust, vacuum', v: kN(D.vac.F), s: klbf(D.vac.F) },
      { k: 'Isp, sea level', v: D.sl.Isp.toFixed(1) + ' s', s: (D.sl.Isp * G0).toFixed(0) + ' m/s effective', tip: 'Specific impulse = thrust / (propellant weight flow). Effective exhaust velocity c = Isp·g₀.' },
      { k: 'Isp, vacuum', v: D.vac.Isp.toFixed(1) + ' s', s: (D.vac.Isp * G0).toFixed(0) + ' m/s' },
      { k: 'c*', v: D.cstar.toFixed(0) + ' m/s', s: `ideal ${D.cstarI.toFixed(0)}`, tip: 'Characteristic velocity Pc·At/ṁ: how well the chamber turns propellant into hot, light gas. Independent of the nozzle.' },
      { k: 'CF vacuum', v: fmt(D.CFvac, 3), s: `sea level ${fmt(D.sl.CF, 3)}`, tip: 'Thrust coefficient F/(Pc·At): what the nozzle adds. Isp = CF·c*/g₀.' },
      { k: 'Chamber temperature', v: D.Tc.toFixed(0) + ' K', s: `γ ${D.id.chamber.gamma.toFixed(3)} · ${(D.id.chamber.W * 1000).toFixed(1)} g/mol` },
      { k: 'Propellant flow', v: D.mdot.toFixed(D.mdot < 10 ? 2 : 1) + ' kg/s', s: `ox ${D.mdotOx.toFixed(1)} · fuel ${D.mdotFuel.toFixed(1)}` },
      { k: 'Throat diameter', v: len(D.Dt), s: `exit ${len(D.De)}` },
      { k: 'Engine length', v: len(D.geo.length), s: 'injector face to exit' },
      { k: 'Exit pressure', v: bar(D.pe), s: `exit Mach ${D.id.exit.M.toFixed(2)}` },
      { k: `At ${S.alt.toFixed(1)} km`, v: kN(pf.F), s: `${pf.Isp.toFixed(1)} s · ${REGIMES[pf.regime][0].toLowerCase()}`, cls: pf.sep ? 'bad' : '' },
    ]);
    view.set({ D, pa });
    const [rl, rc] = REGIMES[pf.regime];
    regime.replaceChildren(h('span', { class: 'regime' }, h('span', { class: 'dot', style: { background: `var(${rc})` } }), rl),
      h('span', { class: 'hint', style: { margin: 0 } }, pa > 0 ? `pₑ/pₐ = ${(D.pe / pa).toFixed(3)} · ambient ${(pa / 1e5).toPrecision(3)} bar` : 'ambient pressure 0'));
    // sizing
    const geo = D.geo;
    resultRows(sizeEl, [
      ['Throat diameter Dt', len(D.Dt), true], ['Exit diameter De', len(D.De), true], ['Chamber diameter Dc', len(2 * geo.Rc)],
      ['Contraction Ac/At', D.contraction.toFixed(2)], ['Chamber volume', (geo.Vc * 1000).toFixed(2) + ' L', false, 'L*·At, injector face to throat'],
      ['Cylinder length', len(geo.Lcyl)], ['Convergent length', len(geo.Lconv)], ['Nozzle length (throat→exit)', len(geo.Ldiv)],
      ['Total length', len(geo.length), true], ['Throat area', (D.At * 1e4).toFixed(1) + ' cm²'],
      [S.nozzle === 'bell' ? 'Bell angles θn / θe' : 'Half-angle', S.nozzle === 'bell' ? `${(geo.thetaN * 57.2958).toFixed(1)}° / ${(geo.thetaE * 57.2958).toFixed(1)}°` : S.half.toFixed(1) + '°'],
      ['Divergence factor λ', D.lambda.toFixed(4), false, 'Fraction of exit momentum that is axial'],
      ['Oxidizer flow', `${D.mdotOx.toFixed(2)} kg/s · ${(D.mdotOx / R.PROPS[S.ox].rho * 1000).toFixed(1)} L/s`],
      ['Fuel flow', `${D.mdotFuel.toFixed(2)} kg/s · ${(D.mdotFuel / R.PROPS[S.fuel].rho * 1000).toFixed(1)} L/s`],
      ['Bulk density', R.bulkDensity(S.fuel, S.ox, S.of).toFixed(0) + ' kg/m³'],
      ['Thrust / throat area', ((D.vac.F / D.At) / 1e6).toFixed(1) + ' MN/m²'],
    ]);
    // comparison
    const P = preset();
    if (P) {
      const rows = [['Sea-level thrust', P.pub.Fsl, D.sl.F / 1e3, ' kN'], ['Vacuum thrust', P.pub.Fvac, D.vac.F / 1e3, ' kN'], ['Sea-level Isp', P.pub.Isl, D.sl.Isp, ' s'], ['Vacuum Isp', P.pub.Ivac, D.vac.Isp, ' s']].filter(r => r[1]);
      cmpEl.replaceChildren(h('div', { class: 'hint', style: { marginBottom: '6px' } }, `${P.name}: ${R.CYCLES[P.cycle]} cycle, ${propLabel(P.ox)}/${propLabel(P.fuel)}, O/F ${P.of}, Pc ${P.Pc} bar, ε ${P.eps}.`),
        h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, h('th', { style: { textAlign: 'left' } }, ''), h('th', {}, 'Published'), h('th', {}, 'Model'), h('th', {}, 'Difference'))),
          h('tbody', {}, ...rows.map(([k, pub, mod, u]) => h('tr', {}, h('td', { style: { textAlign: 'left', fontFamily: 'var(--font)' } }, k), h('td', {}, pub + u), h('td', {}, mod.toFixed(1) + u),
            h('td', { style: { color: Math.abs(mod / pub - 1) < 0.03 ? 'var(--good)' : 'var(--warn)' } }, ((mod / pub - 1) * 100).toFixed(1) + '%')))))));
    } else {
      cmpEl.replaceChildren(h('div', { class: 'hint' }, 'Custom design. Pick an example engine on the left to compare the model with a real one; changing any input afterwards makes the design custom again.'));
    }
    paintAlong(); paintComp(); paintInsights(pf, pa);
  };
  const paintAlong = () => {
    const D = store.D; if (!D) return;
    const xs = D.along.map(p => p.x * 100);
    const get = { M: p => p.M, T: p => p.T, P: p => p.P / 1e5, u: p => p.u, W: p => p.W * 1000 }[alongQ];
    const lab = { M: 'Mach number', T: 'static temperature (K)', P: 'static pressure (bar)', u: 'velocity (m/s)', W: 'molar mass (g/mol)' }[alongQ];
    const ys = D.along.map(get), ymax = Math.max(...ys);
    const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    alongPlot.setOpts({ ylabel: lab, logy: alongQ === 'P' });
    const rmax = Math.max(D.geo.Rc, D.geo.Re);
    const series = [{ x: xs, y: ys, color: css('--accent'), label: lab }];
    if (alongQ !== 'P') series.push({ x: xs, y: D.along.map(p => p.r / rmax * ymax * 0.9), color: css('--text-3'), dash: [4, 4], width: 1.2, label: 'wall radius (scaled)', noHover: true });
    alongPlot.setData({ series, vlines: [{ x: 0, color: css('--text-3') }] });
  };
  const paintComp = () => {
    const D = store.D, ch = TH.moleFractions(D.id.chamber.comp, 1e-4), ex = TH.moleFractions(D.id.exit.comp, 1e-4);
    const names = [...new Set([...ch, ...ex].map(x => x.name))].slice(0, 10);
    const get = (set, n) => (set.find(x => x.name === n) || { x: 0 }).x;
    names.sort((a, b) => get(ch, b) - get(ch, a));
    compEl.replaceChildren(h('table', { class: 'data' }, h('thead', {}, h('tr', {}, h('th', { style: { textAlign: 'left' } }, 'Species'), h('th', {}, 'Chamber'), h('th', {}, 'Exit'), h('th', { style: { width: '40%' } }, ''))),
      h('tbody', {}, ...names.map(n => h('tr', {}, h('td', { style: { textAlign: 'left', fontFamily: 'var(--font)' } }, TH.displayName(n)), h('td', {}, fx(get(ch, n))), h('td', {}, fx(get(ex, n))),
        h('td', {}, h('div', { class: 'xbar rk-xbar' }, h('div', { style: { width: (get(ch, n) * 100) + '%' } }), h('div', { class: 'ex', style: { width: (get(ex, n) * 100) + '%' } }))))))),
      h('div', { class: 'hint', style: { marginTop: '6px' } }, S.frozen ? 'Frozen flow: the exit composition equals the chamber composition.' : 'Bars: chamber (top) and exit (bottom) mole fraction.'));
  };
  const fx = x => x === 0 ? '—' : x < 1e-3 ? x.toExponential(1) : x.toFixed(4);
  const paintInsights = (pf, pa) => {
    const D = store.D, L = [], ofst = TH.stoichOF(S.fuel, S.ox);
    const regTxt = {
      vacuum: ['In vacuum the plume keeps expanding', `Exit pressure ${bar(D.pe)} pushes on nothing, so all of pₑAₑ adds to thrust. The jet turns outward by up to ${(R.plume(D, 0).delta * 57.3).toFixed(0)}° at the lip.`],
      under: ['Under-expanded', `Exit pressure is ${(D.pe / pa).toFixed(2)}× ambient: the jet keeps expanding outside the nozzle through expansion fans at the lip, then over-shoots and forms shock cells (Mach diamonds). A longer nozzle would add thrust here.`],
      design: ['Ideally expanded', 'Exit pressure matches ambient: this ε gives the most thrust possible at this altitude. The plume leaves almost parallel.'],
      over: ['Over-expanded', `Exit pressure is only ${(D.pe / pa).toFixed(2)}× ambient. Oblique shocks at the lip squeeze the jet; the area near the exit is pushed inward by the atmosphere, costing thrust (pₑ − pₐ)Aₑ < 0.`],
      separated: ['Flow separation inside the nozzle', `The wall pressure would drop below the ${R.SEP_CRITERIA[S.sepModel || 'kb']} limit, so the jet detaches about ${pf.xSep > 0 ? len(pf.xSep) + ' downstream of the throat' : 'inside the bell'}. That actually recovers some thrust, but asymmetric separation causes violent side loads — the reason vacuum nozzles cannot be tested at sea level without a diffuser.`],
    }[pf.regime];
    L.push({ type: pf.regime === 'separated' ? 'b' : pf.regime === 'over' ? 'w' : 'i', t: regTxt[0] + ` at ${S.alt.toFixed(1)} km`, d: regTxt[1] });
    if (S.of < ofst) L.push({ type: 'i', t: `Running fuel-rich (${(100 * S.of / ofst).toFixed(0)}% of stoichiometric O/F)`, d: `Isp ∝ √(Tc/M): excess fuel lowers temperature a little but lowers the exhaust molar mass more (${(D.id.chamber.W * 1000).toFixed(1)} g/mol here), and reduces dissociation and wall oxidation.` });
    else L.push({ type: 'w', t: 'Oxidizer-rich mixture', d: 'Hot oxygen-rich gas attacks most metals; only oxidizer-rich preburners (RD-180, Raptor) run this way, and only at turbine temperatures.' });
    if (D.sl.sep && S.at === 'vac') L.push({ type: 'w', t: 'Vacuum-only nozzle', d: `At sea level this nozzle separates (pₑ = ${(D.pe / 101325).toFixed(3)} atm). Fine for an upper stage; a booster would need a smaller ε or a higher Pc.` });
    if (D.geo.Lcyl <= 1e-6) L.push({ type: 'w', t: 'L* is too small for this contraction', d: 'The convergent section alone holds more than L*·At, so there is no cylindrical section. Raise L* or lower the contraction ratio.' });
    if (S.cycle === 'gg') L.push({ type: 'i', t: `Gas-generator loss: ${(100 * (1 - (1 - D.ggFrac) * D.ggThrustFactor)).toFixed(1)}% of Isp`, d: `${(D.ggFrac * 100).toFixed(1)}% of the propellant drives the turbopump and is dumped through the turbine exhaust at low velocity. Staged-combustion engines avoid this by burning that gas in the main chamber.` });
    const fr = S.frozen ? null : (() => { try { return TH.rocket({ reactants: D.reactants, Pc: D.Pc, eps: S.eps, frozen: true }); } catch { return null; } })();
    if (fr) L.push({ type: 'i', t: `Recombination is worth ${((D.id.Ivac - fr.Ivac) / G0).toFixed(1)} s of vacuum Isp`, d: `Ideal vacuum Isp is ${(D.id.Ivac / G0).toFixed(1)} s with equilibrium flow vs ${(fr.Ivac / G0).toFixed(1)} s frozen: radicals formed in the hot chamber give their energy back as the gas cools.` });
    if (S.Pc < 15 && S.at === 'sl') L.push({ type: 'w', t: 'Low chamber pressure for a sea-level engine', d: 'With little pressure ratio to the atmosphere the nozzle cannot expand far before over-expanding, so sea-level Isp suffers.' });
    insightsList(insEl, L);
  };

  store.subs.add(() => { if (visible) paint(); else dirty = true; });
  let visible = false, dirty = false;
  build();
  return {
    controls, main,
    show() { visible = true; build(); if (dirty || store.D) paint(); dirty = false; },
    hide() { visible = false; },
    destroy() { view.destroy(); },
  };
}
