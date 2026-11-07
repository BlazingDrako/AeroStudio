// Cycle analysis: pick an engine, set the design, see station-by-station states, the T–s diagram,
// performance and efficiencies, on an animated cut-away colored by total temperature.
import { h, section, segmented, select, field, info } from '../../lib/ui.js';
import { Plot } from '../../lib/plot.js';
import * as C from '../../solvers/cycles.js';
import { bound, boundToggle, boundSelect, boundSeg, metricsGrid, insightsList, card, fmt, kPa, shared, put } from './common.js';
import { EngineView } from './engineView.js';
import { sendTo, sendSection } from '../../lib/send.js';

const PRESETS = [
  { t: 'Airliner turbofan, BPR 5.5 (CFM56-class)', p: { type: 'turbofan', M0: 0.8, alt: 10668, bpr: 5.5, piF: 1.7, piC: 32, Tt4: 1600, mixed: false, ab: false, nozzle: 'conv', mdot: 400 } },
  { t: 'Widebody turbofan, BPR 9 (GE90-class)', p: { type: 'turbofan', M0: 0.83, alt: 10668, bpr: 9, piF: 1.55, piC: 42, Tt4: 1720, mixed: false, ab: false, nozzle: 'conv', mdot: 1200 } },
  { t: 'Ultra-high bypass, BPR 12 (geared-fan class)', p: { type: 'turbofan', M0: 0.78, alt: 10668, bpr: 12, piF: 1.4, piC: 50, Tt4: 1780, mixed: false, ab: false, nozzle: 'conv', mdot: 600 } },
  { t: 'Fighter, mixed low-bypass + afterburner', p: { type: 'turbofan', M0: 1.6, alt: 11000, bpr: 0.6, piF: 3.6, piC: 26, Tt4: 1750, mixed: true, ab: true, Tt7: 2100, nozzle: 'cd', mdot: 110, inlet: { model: 'ramps', pidMax: 0.97, nRamps: 1 } } },
  { t: 'Mach 2 turbojet + afterburner (J79-class)', p: { type: 'turbojet', M0: 2, alt: 11000, piC: 13.5, Tt4: 1250, ab: true, Tt7: 2000, nozzle: 'cd', mdot: 77, inlet: { model: 'ramps', pidMax: 0.97, nRamps: 1 } } },
  { t: 'First-generation turbojet (J47-class)', p: { type: 'turbojet', M0: 0.75, alt: 9000, piC: 5.5, Tt4: 1100, ab: false, nozzle: 'conv', mdot: 45, eC: 0.85, eT: 0.86 } },
  { t: 'Regional turboprop (PW100/PT6-class)', p: { type: 'turboprop', M0: 0.45, alt: 6000, piC: 14, Tt4: 1400, etaProp: 0.85, mdot: 8 } },
  { t: 'Ramjet cruise, Mach 3', p: { type: 'ramjet', M0: 3, alt: 18000, Tt4: 2200 } },
  { t: 'Ramjet, Mach 4.5', p: { type: 'ramjet', M0: 4.5, alt: 24000, Tt4: 2400, inlet: { model: 'ramps', pidMax: 0.95, nRamps: 3 } } },
  { t: 'Scramjet, Mach 7 (X-43-class)', p: { type: 'scramjet', M0: 7, alt: 29000, psi: 6, phi: 1 } },
  { t: 'Scramjet, Mach 12', p: { type: 'scramjet', M0: 12, alt: 34000, psi: 8, phi: 1 } },
];

export function cycleTab(shell) {
  // the whole engine definition is remembered (it is replaced when the type or an example changes)
  const box = (shell.keep || (o => o))({ cfg: null }, { nulls: ['cfg'] });
  const saved = box.cfg && C.ENGINE_TYPES[box.cfg.type] ? box.cfg : null;
  let S = saved ? { ...C.defaults(saved.type), ...saved, inlet: { ...C.defaults(saved.type).inlet, ...(saved.inlet || {}) } } : C.defaults('turbofan');
  Object.defineProperty(box, 'cfg', { get: () => S, enumerable: true, configurable: true });
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });
  const view = new EngineView();
  const metrics = metricsGrid();
  const ts = card('T–s diagram', 'Temperature vs entropy for the core (solid) and bypass (dashed) streams. Totals at each station; freestream and nozzle-exit static states are joined to their totals by vertical (isentropic) lines. Area enclosed ≈ net work.');
  const tsPlot = new Plot(ts, { xlabel: 's − s₀ (J/kg·K)', ylabel: 'T (K)', xname: 's−s₀', yname: 'T', xfmt: v => v.toFixed(1), yfmt: v => v.toFixed(1) + ' K', xPad: true });
  const along = card('Along the engine', 'Total temperature and total pressure at each station.');
  const alongSeg = segmented([{ value: 'pt', label: 'pt' }, { value: 'Tt', label: 'Tt' }, { value: 'both', label: 'Both (normalised)' }], 'both', v => { alongMode = v; paintAlong(); });
  let alongMode = 'both';
  along.querySelector('.plot-head').append(alongSeg.el);
  const alongPlot = new Plot(along, { xlabel: 'station (in flow order; hover for names)', ylabel: '', xname: 'station', yname: 'value', xfmt: v => stationNames[Math.round(v)] || '', yfmt: v => v.toPrecision(4) });
  const tableCard = card('Station table', 'Total (stagnation) conditions at each station; static values where the velocity is known. ṁ is relative to the total inlet air flow.');
  const tableEl = h('div', { class: 'table-wrap' }); tableCard.append(tableEl);
  const insCard = card('What the cycle tells you'); const insEl = h('div'); insCard.append(insEl);
  const energyCard = card('Where the fuel energy goes', 'Fuel power split into useful propulsive power, kinetic energy left in the wake, and heat rejected in the hot exhaust (the thermodynamic cycle loss).');
  const energyEl = h('div', { class: 'energy' }); energyCard.append(energyEl);
  const status = h('div', { class: 'row', style: { flexWrap: 'wrap' } });
  main.append(status, metrics.el, view.el, h('div', { class: 'cf-grid2b' }, ts, along), tableCard, h('div', { class: 'cf-grid2b' }, insCard, energyCard));
  let stationNames = [];

  // ---------- controls ----------
  // hand the flight condition to other tools (reads the current S, which is replaced when the engine type changes)
  const sendSec = sendSection([
    { label: 'Inlets & shocks', sub: 'Design the supersonic inlet for this flight Mach number', go: () => {
      if (S.M0 < 1.05) return 'The inlet tool is for supersonic flight (M₀ ≥ 1.05); this engine flies at M ' + S.M0;
      const scram = S.type === 'scramjet' && S.M0 >= 4;
      sendTo({ mod: 'turbine', tab: 'inlet', note: `Inlet for M ${S.M0}`, values: { M0: Math.min(scram ? 16 : 6, S.M0), mode: scram ? 'scram' : 'ext' } });
    } },
    { label: 'Flight & Atmosphere · Airspeeds', sub: 'This altitude and Mach number as CAS, EAS and TAS', go: () => sendTo({ mod: 'flight', tab: 'airspeed',
      note: `M ${S.M0} at ${Math.round(S.alt)} m`, values: { H: Math.min(25000, S.alt), dT: 0, kind: 'mach', mach: Math.min(3.5, Math.max(0.05, S.M0)) } }) },
  ]);
  const build = () => {
    const secE = section('Engine');
    const typeSeg = segmented(Object.entries(C.ENGINE_TYPES).map(([v, label]) => ({ value: v, label })), S.type, v => { const keep = { gas: S.gas }; S = { ...C.defaults(v), ...(v === 'scramjet' ? {} : keep) }; build(); run(); });
    typeSeg.el.classList.add('seg-wrap');
    const presets = select([{ value: '', label: 'Load an example engine…' }, ...PRESETS.map((p, i) => ({ value: String(i), label: p.t }))], '', v => { if (v === '') return; const pr = PRESETS[+v].p; S = { ...C.defaults(pr.type), ...pr, inlet: { ...C.defaults(pr.type).inlet, ...(pr.inlet || {}) } }; build(); run(); });
    put(secE.body, field('Type', typeSeg.el), field('Examples', presets),
      boundSelect(S, 'gas', 'Gas model', [{ value: 'ideal', label: 'Ideal air (γ = 1.4 everywhere)' }, { value: 'twoGamma', label: 'Two-γ (cold 1.40 / hot 1.30)' }, { value: 'real', label: 'Real gas (NASA polynomials + equilibrium)' }], run,
        '<b>Ideal</b>: textbook cycle with constant cp. <b>Two-γ</b>: Mattingly\'s model with losses (cp = 1004.5 / 1239 J/kg·K). <b>Real gas</b>: temperature-dependent properties for air and the actual equilibrium combustion products (frozen after the burner).'),
      boundSelect(S, 'fuel', 'Fuel', Object.entries(C.FUELS).map(([value, f]) => ({ value, label: f.label })), run, 'Heating value and stoichiometric fuel/air ratio are computed from NASA thermochemical data.'));
    const secF = section('Flight condition');
    put(secF.body, 
      bound(S, 'M0', 'Flight Mach M₀', 0, S.type === 'scramjet' ? 16 : S.type === 'ramjet' ? 6 : 3.5, { step: 0.01, onInput: run }),
      bound(S, 'alt', 'Altitude', 0, S.type === 'scramjet' ? 45 : 25, { step: 0.1, digits: 1, unit: 'km', scale: 1000, onInput: run, tip: 'ISA standard atmosphere.' }),
      bound(S, 'mdot', 'Air mass flow ṁ₀', 0.5, 2000, { log: true, digits: 1, unit: 'kg/s', onInput: run, tip: 'Total air flow through the engine (core + bypass). Only scales thrust and fuel flow.' }));
    controls.replaceChildren(secE.el, secF.el);
    if (S.type !== 'scramjet') {
      const secI = section('Inlet', { collapsible: true });
      put(secI.body, 
        boundSelect(S.inlet, 'model', 'Supersonic recovery', [{ value: 'mil', label: 'MIL-E-5008B standard' }, { value: 'normal', label: 'Normal-shock (pitot) inlet' }, { value: 'ramps', label: 'Ramp inlet (Oswatitsch optimum)' }], () => { build(); run(); }, 'Total-pressure recovery of the shock system above Mach 1. See the Inlets & shocks tab for the full picture.'),
        S.inlet.model === 'ramps' ? bound(S.inlet, 'nRamps', 'Oblique shocks', 1, 4, { step: 1, digits: 0, onInput: run }) : null,
        bound(S.inlet, 'pidMax', 'Subsonic diffuser πd,max', 0.85, 1, { step: 0.001, digits: 3, onInput: run, tip: 'Friction loss in the subsonic duct, multiplied by the shock recovery.' }));
      controls.append(secI.el);
    }
    if (['turbojet', 'turbofan', 'turboprop'].includes(S.type)) {
      const secC = section('Compression');
      put(secC.body, 
        bound(S, 'piC', S.type === 'turbofan' ? 'Overall pressure ratio' : 'Compressor πc', 2, 70, { step: 0.1, digits: 1, onInput: run }),
        S.type === 'turbofan' ? bound(S, 'piF', 'Fan pressure ratio πf', 1.05, 5, { step: 0.01, onInput: run }) : null,
        S.type === 'turbofan' ? bound(S, 'bpr', 'Bypass ratio α', 0, 16, { step: 0.05, onInput: run }) : null,
        boundSeg(S, 'poly', 'Efficiency type', [{ value: true, label: 'Polytropic' }, { value: false, label: 'Isentropic' }], run, '<b>Polytropic</b> (small-stage) efficiency is the same for any pressure ratio — the fair way to compare designs. <b>Isentropic</b> efficiency applies to the whole machine.'),
        bound(S, 'eC', 'Compressor efficiency', 0.7, 1, { step: 0.005, digits: 3, onInput: run }),
        S.type === 'turbofan' ? bound(S, 'eF', 'Fan efficiency', 0.7, 1, { step: 0.005, digits: 3, onInput: run }) : null);
      const secB = section('Burner & turbine');
      put(secB.body, 
        bound(S, 'Tt4', 'Turbine inlet Tt4', 900, 2200, { step: 5, digits: 0, unit: 'K', onInput: run, tip: 'The hottest point of the cycle; the main design lever for specific thrust.' }),
        bound(S, 'etaB', 'Burner efficiency ηb', 0.8, 1, { step: 0.005, digits: 3, onInput: run }),
        bound(S, 'piB', 'Burner pressure ratio πb', 0.85, 1, { step: 0.005, digits: 3, onInput: run }),
        bound(S, 'eT', 'Turbine efficiency', 0.7, 1, { step: 0.005, digits: 3, onInput: run }),
        bound(S, 'etaM', 'Shaft mechanical ηm', 0.9, 1, { step: 0.001, digits: 3, onInput: run }));
      controls.append(secC.el, secB.el);
    }
    if (S.type === 'turboprop') {
      const secP = section('Propeller');
      const xS = bound(S, 'x', 'Power-turbine share x', 0, 0.995, { step: 0.005, digits: 3, onInput: () => { S.autoX = false; autoT.set(false); run(); }, tip: 'Fraction of the remaining (log) pressure drop taken by the power turbine; the rest accelerates the core jet.' });
      const autoT = boundToggle(S, 'autoX', 'Optimise x for max thrust', run);
      put(secP.body, autoT.el, xS.el, bound(S, 'etaProp', 'Propeller efficiency', 0.5, 0.95, { step: 0.005, digits: 3, onInput: run }), bound(S, 'etaG', 'Gearbox efficiency', 0.9, 1, { step: 0.001, digits: 3, onInput: run }));
      controls.append(secP.el);
      S._xSlider = xS;
    }
    if (S.type === 'turbofan') {
      const secM = section('Exhaust & afterburner', { collapsible: true });
      const btn = h('button', { class: 'btn sm', type: 'button' }, 'Match fan PR to core');
      btn.addEventListener('click', () => { const pf = C.matchFanPR(S); if (isFinite(pf)) { S.piF = +pf.toFixed(3); build(); run(); } });
      put(secM.body, boundToggle(S, 'mixed', 'Mixed exhaust (one nozzle)', () => { build(); run(); }, 'Bypass and core streams mix before a common nozzle (military engines). Otherwise each stream has its own nozzle.').el);
      if (S.mixed) {
        put(secM.body, h('div', { class: 'row', style: { margin: '4px 0 10px' } }, btn, info('Finds the fan pressure ratio that makes the bypass total pressure equal the LPT exit total pressure, so the streams mix without large losses.')),
          bound(S, 'piM', 'Mixer πM', 0.9, 1, { step: 0.005, digits: 3, onInput: run }),
          boundToggle(S, 'ab', 'Afterburner', () => { build(); run(); }).el);
        if (S.ab) put(secM.body, bound(S, 'Tt7', 'Afterburner Tt7', 1200, 2400, { step: 10, digits: 0, unit: 'K', onInput: run }));
      }
      controls.append(secM.el);
    }
    if (S.type === 'turbojet') {
      const secA = section('Afterburner', { collapsible: true });
      put(secA.body, boundToggle(S, 'ab', 'Afterburner on', () => { build(); run(); }, 'Burns extra fuel in the jet pipe using the oxygen left after the turbine. Big thrust boost, poor fuel economy.').el);
      if (S.ab) put(secA.body, bound(S, 'Tt7', 'Afterburner Tt7', 1200, 2400, { step: 10, digits: 0, unit: 'K', onInput: run }), bound(S, 'piAB', 'Afterburner πAB', 0.85, 1, { step: 0.005, digits: 3, onInput: run }));
      controls.append(secA.el);
    }
    if (S.type === 'ramjet') {
      const secR = section('Combustor');
      put(secR.body, 
        bound(S, 'Tt4', 'Exit Tt4', 1000, 2600, { step: 10, digits: 0, unit: 'K', onInput: run }),
        bound(S, 'Mb', 'Combustor entry Mach', 0.05, 0.6, { step: 0.01, onInput: run, tip: 'Used for the thermal-choking (Rayleigh) check.' }),
        bound(S, 'etaB', 'Burner efficiency ηb', 0.8, 1, { step: 0.005, digits: 3, onInput: run }),
        bound(S, 'piB', 'Burner πb', 0.85, 1, { step: 0.005, digits: 3, onInput: run }));
      controls.append(secR.el);
    }
    if (S.type === 'scramjet') {
      const secS = section('Scramjet (Heiser & Pratt)');
      put(secS.body, 
        bound(S, 'psi', 'Cycle static T ratio ψ = T₃/T₀', 2, 14, { step: 0.05, onInput: run, tip: 'How much the inlet compresses the air. Higher ψ = higher pressure and efficiency, but more dissociation and risk of subsonic flow.' }),
        bound(S, 'etaC', 'Compression efficiency ηc', 0.6, 1, { step: 0.005, digits: 3, onInput: run }),
        bound(S, 'phi', 'Equivalence ratio φ', 0.1, 1.5, { step: 0.01, onInput: run }),
        bound(S, 'etaB', 'Combustion efficiency ηb', 0.5, 1, { step: 0.005, digits: 3, onInput: run }),
        bound(S, 'CfA', 'Wall friction Cf·Aw/A₃', 0, 0.2, { step: 0.002, digits: 3, onInput: run, tip: 'Friction drag of the combustor walls as a fraction of entry momentum (×2).' }),
        boundSeg(S, 'combustor', 'Combustion', [{ value: 'p', label: 'Constant pressure' }, { value: 'A', label: 'Constant area' }], run, 'Constant pressure needs a diverging duct; constant area raises pressure but risks thermal choking.'),
        bound(S, 'etaE', 'Expansion efficiency ηe', 0.6, 1, { step: 0.005, digits: 3, onInput: run }),
        bound(S, 'pRatio', 'Exit pressure p₁₀/p₀', 0.5, 4, { step: 0.01, onInput: run }));
      controls.append(secS.el);
    } else {
      const secN = section('Nozzle', { collapsible: true });
      put(secN.body, boundSeg(S, 'nozzle', 'Type', [{ value: 'conv', label: 'Convergent' }, { value: 'cd', label: 'Converging–diverging' }], () => { build(); run(); }, 'A convergent nozzle chokes at Mach 1 and leaves the jet underexpanded at high pressure ratios. A C-D nozzle expands fully to ambient.'),
        bound(S, 'piN', 'Nozzle πn', 0.85, 1, { step: 0.005, digits: 3, onInput: run }));
      controls.append(secN.el);
    }
    controls.append(sendSec);
  };

  // ---------- run + paint ----------
  let pending = false, R = null;
  const run = () => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; compute(); }); };
  const compute = () => {
    try { R = C.runCycle(S); } catch (e) { console.error(e); status.replaceChildren(h('span', { class: 'regime' }, 'Could not solve: ' + e.message)); return; }
    shared.cycle = { ...S, inlet: { ...S.inlet } };
    if (S.type === 'turboprop' && S.autoX && S._xSlider && isFinite(R.perf.xUsed)) { S.x = R.perf.xUsed; S._xSlider.set(S.x); }
    paint();
  };
  const paint = () => {
    const P = R.perf, M = [];
    const tsfcU = P.TSFC * 1e6;
    M.push({ k: 'Specific thrust', v: fmt(P.Fs, 1), s: 'N per kg/s of air', tip: 'F/ṁ₀: thrust per unit air mass flow. Sets engine size for a given thrust.' });
    if (S.type === 'turboprop') {
      M.push({ k: 'Shaft power', v: (P.power / 1e3).toFixed(0) + ' kW', s: `ESP ${(P.ESP / 1e3).toFixed(0)} kW`, tip: 'Power delivered to the propeller. ESP adds the jet thrust as equivalent shaft power.' });
      M.push({ k: 'BSFC', v: (P.BSFC * 3.6e9).toFixed(1), s: 'g/(kW·h) on ESP' });
    }
    M.push({ k: 'TSFC', v: fmt(tsfcU, 2), s: `mg/(N·s) · ${(P.TSFC * 3600 * G0lb).toFixed(3)} lb/(lbf·h)`, tip: 'Thrust-specific fuel consumption: fuel mass flow per unit thrust.' });
    M.push({ k: 'Thrust', v: (P.thrust / 1e3).toFixed(2) + ' kN', s: `${(P.thrust / 4.44822).toFixed(0)} lbf at ṁ₀ = ${S.mdot.toFixed(0)} kg/s` });
    M.push({ k: 'Fuel/air ratio f', v: P.f.toFixed(4), s: `fuel flow ${P.fuelFlow.toFixed(3)} kg/s` });
    M.push({ k: 'Specific impulse', v: P.Isp.toFixed(0) + ' s', s: 'thrust per fuel weight flow', tip: 'F/(ṁf·g₀). Compare with ~450 s for the best rockets.' });
    M.push({ k: 'Thermal η', v: (P.etaTh * 100).toFixed(1) + '%' });
    M.push({ k: 'Propulsive η', v: isFinite(P.etaP) ? (P.etaP * 100).toFixed(1) + '%' : '—' });
    M.push({ k: 'Overall η', v: (P.etaO * 100).toFixed(1) + '%', s: 'F·V₀ / (ṁf·h_PR)' });
    metrics.set(M);
    status.replaceChildren(
      h('span', { class: 'regime' }, h('span', { class: 'dot', style: { background: 'var(--accent)' } }), C.ENGINE_TYPES[S.type]),
      h('span', { class: 'hint', style: { margin: 0 } }, `ISA ${(S.alt / 1000).toFixed(1)} km: T₀ ${R.T0.toFixed(1)} K, p₀ ${kPa(R.p0)} kPa, V₀ ${R.V0.toFixed(0)} m/s · fuel LHV ${(R.gas.LHV / 1e6).toFixed(2)} MJ/kg`));
    view.set(R, S); view.start();
    paintTS(); paintAlong(); paintTable(); paintInsights(); paintEnergy();
  };
  const G0lb = 9.80665 / 1; // (kg/(N s)) → lb/(lbf h): × 3600 × g0

  const paintTS = () => {
    const st = R.S, s0 = st[0].mix.s(R.T0, R.p0);
    const core = { x: [], y: [] }, byp = { x: [], y: [] }, pts = { x: [], y: [], lab: [] };
    const push = (o, s, T) => { o.x.push(s - s0); o.y.push(T); };
    const proc = (o, prevS, prevT, stn) => {
      if (stn.comb || !stn.path) {
        const n = 16; for (let i = 1; i <= n; i++) { const t = i / n, T = prevT * (stn.Tt / prevT) ** t; const fr = Math.log(T / prevT) / Math.log(stn.Tt / prevT || 1.0001); push(o, prevS + (stn.s - prevS) * (isFinite(fr) ? fr : t), T); }
      } else for (const [T, p] of stn.path) push(o, stn.mix.s(T, p), T);
      push(o, stn.s, stn.Tt);
    };
    push(core, s0, R.T0); push(core, st[0].s, st[0].Tt);
    pts.x.push(0); pts.y.push(R.T0); pts.lab.push('0 static');
    pts.x.push(st[0].s - s0); pts.y.push(st[0].Tt); pts.lab.push('0 total');
    let prev = st[0];
    const exits = [];
    let s13 = null;
    for (const s of st.slice(1)) {
      if (s.id === '19') { exits.push(s); continue; }
      if (s.id === '13') s13 = s;
      if (s.exit) { exits.push(s); continue; }
      proc(core, prev.s, prev.Tt, s); prev = s;
      pts.x.push(s.s - s0); pts.y.push(s.Tt); pts.lab.push(s.id + ' ' + s.name);
    }
    const series = [];
    const isoT = []; for (let T = R.T0 * 0.9; T <= Math.max(...st.map(s => s.Tt)) * 1.05; T += 10) isoT.push(T);
    const air = st[0].mix;
    const pmax = Math.max(...st.map(s => s.pt));
    for (const [p, lab] of [[R.p0, 'p₀'], [pmax, 'p max']]) series.push({ x: isoT.map(T => air.s(T, p) - s0), y: isoT, color: 'var(--border-strong)', dash: [3, 4], width: 1, noHover: true, label: lab === 'p₀' ? 'isobars (air)' : undefined, skipBounds: true });
    for (const e of exits) {
      const o = e.id === '19' ? byp : core;
      if (e.id === '19' && s13) { push(byp, s13.s, s13.Tt); }
      push(o, e.s, e.Tt); push(o, e.s, e.T);
      pts.x.push(e.s - s0, e.s - s0); pts.y.push(e.Tt, e.T); pts.lab.push(e.id + ' total', e.id + ' static (exit)');
    }
    series.forEach(s => { s.color = getComputedStyle(document.documentElement).getPropertyValue('--border-strong').trim(); });
    series.push({ x: core.x, y: core.y, color: cssv('--lower'), width: 2.2, label: 'core', noHover: true });
    if (byp.x.length) series.push({ x: byp.x, y: byp.y, color: cssv('--upper'), width: 2, dash: [6, 4], label: 'bypass', noHover: true });
    series.push({ x: pts.x, y: pts.y, color: cssv('--text'), line: false, points: true, pointSize: 3, extra: i => pts.lab[i] });
    tsPlot.setData({ series });
  };
  const paintAlong = () => {
    const st = R.S.filter(s => s.id !== '0' || true);
    stationNames = st.map(s => s.id);
    const x = st.map((_, i) => i), pt = st.map(s => s.pt / 1000), Tt = st.map(s => s.Tt);
    let series;
    if (alongMode === 'pt') { alongPlot.setOpts({ ylabel: 'pt (kPa)', yname: 'pt kPa' }); series = [{ x, y: pt, color: cssv('--upper'), points: true, label: 'pt (kPa)', extra: i => st[i].name }]; }
    else if (alongMode === 'Tt') { alongPlot.setOpts({ ylabel: 'Tt (K)', yname: 'Tt K' }); series = [{ x, y: Tt, color: cssv('--lower'), points: true, label: 'Tt (K)', extra: i => st[i].name }]; }
    else {
      const mp = Math.max(...pt), mT = Math.max(...Tt);
      alongPlot.setOpts({ ylabel: 'fraction of maximum', yname: 'ratio' });
      series = [{ x, y: pt.map(v => v / mp), color: cssv('--upper'), points: true, label: `pt / ${mp.toFixed(0)} kPa`, extra: i => st[i].name + ` · ${pt[i].toFixed(1)} kPa` }, { x, y: Tt.map(v => v / mT), color: cssv('--lower'), points: true, label: `Tt / ${mT.toFixed(0)} K`, extra: i => st[i].name + ` · ${Tt[i].toFixed(0)} K` }];
    }
    alongPlot.setOpts({ xlim: [-0.3, st.length - 0.7] });
    alongPlot.setData({ series });
  };
  const paintTable = () => {
    const head = ['Station', '', 'Tt K', 'pt kPa', 'T K', 'p kPa', 'V m/s', 'M', 'ṁ/ṁ₀', ''];
    const m0 = S.type === 'turbofan' ? 1 + S.bpr : 1;
    const rows = R.S.map(s => h('tr', {}, h('td', { style: { textAlign: 'left', fontWeight: 600 } }, s.id), h('td', { style: { textAlign: 'left', fontFamily: 'var(--font)' } }, s.name),
      h('td', {}, s.Tt.toFixed(1)), h('td', {}, kPa(s.pt)), h('td', {}, s.T !== undefined ? s.T.toFixed(1) : ''), h('td', {}, s.p !== undefined ? kPa(s.p) : ''),
      h('td', {}, s.V !== undefined ? s.V.toFixed(1) : ''), h('td', {}, s.M !== undefined ? s.M.toFixed(3) + (s.choked ? ' (choked)' : '') : ''),
      h('td', {}, s.m !== undefined ? (s.m / m0).toFixed(4) : ''), h('td', { style: { textAlign: 'left', fontFamily: 'var(--font)', color: 'var(--text-3)' } }, s.note || '')));
    tableEl.replaceChildren(h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ...head.map((x, i) => h('th', { style: i < 2 || i === 9 ? { textAlign: 'left' } : null }, x)))), h('tbody', {}, ...rows)));
  };
  const paintInsights = () => {
    const P = R.perf, list = [...R.warn];
    const ex = R.S.filter(s => s.exit);
    const Vj = ex.length ? ex[0].V : 0;
    if (R.V0 > 1 && Vj > 0) list.push({ type: 'i', t: `Jet speed ${Vj.toFixed(0)} m/s vs flight ${R.V0.toFixed(0)} m/s`, d: `Propulsive efficiency ≈ 2/(1+V₉/V₀) = ${(2 / (1 + Vj / R.V0) * 100).toFixed(0)}%. ${Vj / R.V0 > 2.5 ? 'A fast jet wastes kinetic energy: more bypass (or a propeller) would raise efficiency.' : 'The jet is close to flight speed: efficient, but needs lots of air per newton.'}` });
    if (S.type === 'turbofan') list.push({ type: 'i', t: `Bypass stream gives ${(R.streams.length > 1 ? (S.bpr * R.streams[1].nz.Fs - S.bpr * R.V0) / ((1 + S.bpr) * P.Fs) * 100 : NaN).toFixed(0)}% of the thrust`, d: 'The fan stream is driven by the low-pressure turbine. Raising α moves more thrust to the cold, efficient stream.' });
    if (R.inlet && R.inlet.eta < 0.999) list.push({ type: 'i', t: `Inlet recovery ${(R.inlet.pid * 100).toFixed(1)}%`, d: `${R.inlet.label}. The Inlets & shocks tab shows the shock system.` });
    if (R.rayleigh) list.push({ type: 'g', t: 'No thermal choking', d: `Tt4/Tt2 = ${R.rayleigh.ratio.toFixed(2)} is below the Rayleigh limit ${R.rayleigh.lim.toFixed(2)}.` });
    if (R.scram) list.push({ type: R.scram.M3 > 1 ? 'g' : 'b', t: `Combustor entry M₃ = ${R.scram.M3.toFixed(2)}, T₃ = ${R.scram.T3.toFixed(0)} K, p₃ = ${kPa(R.scram.p3)} kPa`, d: `Combustor exit M₄ = ${R.scram.M4.toFixed(2)}, T₄ = ${R.scram.T4.toFixed(0)} K. Exit velocity ${R.scram.V10.toFixed(0)} m/s.` });
    if (S.gas === 'real') { const s4 = R.S.find(s => s.id === '4'); if (s4) list.push({ type: 'i', t: 'Real-gas burner', d: `Products at station 4 are the chemical equilibrium mixture at ${s4.Tt.toFixed(0)} K (mean molar mass ${(s4.mix.W * 1000).toFixed(2)} g/mol), then frozen.` }); }
    if (!list.length) list.push({ type: 'g', t: 'Healthy design', d: 'No limits exceeded.' });
    insightsList(insEl, list);
  };
  const paintEnergy = () => {
    const P = R.perf, Q = P.f * (R.gas.LHV + R.V0 * R.V0 / 2);
    const useful = Math.max(0, P.Fs * R.V0), therm = Math.max(0, Q * (1 - P.etaTh)), wake = Math.max(0, Q - useful - therm);
    const parts = [['Thrust power', useful, 'var(--good)'], ['Wake kinetic energy', wake, 'var(--upper)'], ['Exhaust heat (cycle loss)', therm, 'var(--lower)']];
    const tot = parts.reduce((a, p) => a + p[1], 0) || 1;
    energyEl.replaceChildren(
      h('div', { class: 'ebar' }, ...parts.map(p => h('div', { style: { width: (p[1] / tot * 100) + '%', background: p[2] }, title: `${p[0]}: ${(p[1] / tot * 100).toFixed(1)}%` }))),
      h('div', { class: 'cf-res', style: { marginTop: '10px' } }, ...parts.map(p => h('div', { class: 'r' }, h('span', {}, h('span', { class: 'swatch', style: { background: p[2], marginRight: '6px' } }), p[0]), h('span', {}, (p[1] / tot * 100).toFixed(1) + '%')))),
      h('div', { class: 'hint' }, `Per kg/s of air: fuel energy ${(Q / 1000).toFixed(1)} kW. ${S.type === 'turboprop' ? 'For the turboprop, wake energy includes the propeller slipstream loss (1 − ηprop).' : ''}`));
  };
  const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  build(); compute();
  return { controls, main, show() { view.start(); }, hide() { view.stop(); }, destroy() { view.stop(); } };
}
