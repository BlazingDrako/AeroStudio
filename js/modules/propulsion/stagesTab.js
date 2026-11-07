// Stage calculators: one engine component at a time, with the equations shown step by step
// (calorically perfect gas; γ and cp are inputs so cold and hot sections can differ).
import { h, section, select, field, info, parseNum } from '../../lib/ui.js';
import * as G from '../../solvers/gasdyn.js';
import { isa } from '../../solvers/cycles.js';
import { milSpecRecovery } from '../../solvers/inlets.js';
import { card, fmt, resultRows, put } from './common.js';

const f3 = v => fmt(v, 3), f4 = v => fmt(v, 4), f1 = v => isFinite(v) ? v.toFixed(1) : '—', f0 = v => isFinite(v) ? v.toFixed(0) : '—';
const kP = p => isFinite(p) ? (p / 1000).toFixed(3) : '—';
const Rof = (g, cp) => cp * (g - 1) / g;

// static from total at Mach M
const stat = (Tt, pt, M, g) => { const tr = 1 + (g - 1) / 2 * M * M; return { T: Tt / tr, p: pt / tr ** (g / (g - 1)) }; };

const STAGES = [
  {
    id: 'atm', label: 'Atmosphere & freestream', inputs: [['alt', 'Altitude (m)', 11000], ['M0', 'Flight Mach M₀', 0.85], ['g', 'γ', 1.4], ['cp', 'cp (J/kg·K)', 1004.5]],
    solve(v) {
      const a = isa(v.alt), R = Rof(v.g, v.cp), a0 = Math.sqrt(v.g * R * a.T), V0 = v.M0 * a0;
      const tr = 1 + (v.g - 1) / 2 * v.M0 ** 2, pr = tr ** (v.g / (v.g - 1));
      const mu = 1.458e-6 * a.T ** 1.5 / (a.T + 110.4), rho = a.p / (R * a.T), q = 0.5 * rho * V0 * V0;
      return {
        rows: [['T₀ (K)', f3(a.T)], ['p₀ (kPa)', kP(a.p)], ['ρ₀ (kg/m³)', f4(rho)], ['a₀ (m/s)', f1(a0)], ['V₀ (m/s)', f1(V0), true], ['τr = Tt₀/T₀', f4(tr)], ['πr = pt₀/p₀', f4(pr)], ['Tt₀ (K)', f1(a.T * tr), true], ['pt₀ (kPa)', kP(a.p * pr), true], ['Dynamic pressure q (kPa)', kP(q)], ['Unit Reynolds number (1/m)', (rho * V0 / mu).toExponential(3)]],
        steps: [`ISA at ${v.alt} m: T₀ = ${f3(a.T)} K, p₀ = ${kP(a.p)} kPa`, `R = cp(γ−1)/γ = ${f3(R)} J/kg·K`, `a₀ = √(γRT₀) = √(${v.g}·${f3(R)}·${f3(a.T)}) = ${f1(a0)} m/s`, `V₀ = M₀a₀ = ${f1(V0)} m/s`, `τr = 1 + (γ−1)/2·M₀² = ${f4(tr)}`, `πr = τr^(γ/(γ−1)) = ${f4(pr)}`, `Tt₀ = τr·T₀ = ${f1(a.T * tr)} K,   pt₀ = πr·p₀ = ${kP(a.p * pr)} kPa`, `μ (Sutherland) = ${mu.toExponential(4)} Pa·s,  Re/L = ρV/μ`],
      };
    },
  },
  {
    id: 'inlet', label: 'Inlet / diffuser', inputs: [['M0', 'Flight Mach M₀', 2], ['T0', 'Static T₀ (K)', 216.65], ['p0', 'Static p₀ (kPa)', 22.63], ['pidMax', 'Subsonic πd,max', 0.97], ['M2', 'Compressor-face Mach M₂', 0.5], ['g', 'γ', 1.4]],
    sel: [['model', 'Supersonic recovery', [['mil', 'MIL-E-5008B'], ['normal', 'Normal shock (pitot)']]]],
    solve(v) {
      const g = v.g, tr = 1 + (g - 1) / 2 * v.M0 ** 2, Tt = v.T0 * tr, pt0 = v.p0 * 1e3 * tr ** (g / (g - 1));
      let er = 1, how = 'subsonic: ηr = 1';
      if (v.M0 > 1) { if (v.model === 'mil') { er = milSpecRecovery(v.M0); how = `ηr = 1 − 0.075(M₀−1)^1.35 = ${f4(er)}`; } else { er = G.normalShock(v.M0, g).p02_p01; how = `normal shock at M₀: p₀₂/p₀₁ = ${f4(er)}`; } }
      const pid = v.pidMax * er, pt2 = pt0 * pid, s2 = stat(Tt, pt2, v.M2, g);
      const Ar = G.isen.A_As(v.M2, g) / G.isen.A_As(Math.max(v.M0, 1e-3), g) * (1 / pid);
      return {
        rows: [['Tt₂ = Tt₀ (K)', f1(Tt)], ['pt₀ (kPa)', kP(pt0)], ['Shock recovery ηr', f4(er)], ['πd = pt₂/pt₀', f4(pid), true], ['pt₂ (kPa)', kP(pt2), true], ['T₂ static (K)', f1(s2.T)], ['p₂ static (kPa)', kP(s2.p)], ['Entropy rise Δs (J/kg·K)', f3(-Rof(g, 1004.5) * Math.log(pid))], ['Capture/face area A₀/A₂', isFinite(Ar) && v.M0 > 0 ? f4(1 / Ar) : '—', false, 'For a subsonic inlet, the streamtube area ratio from A/A* at M₀ and M₂ with the pressure loss.']],
        steps: [`Adiabatic: Tt₂ = Tt₀ = T₀(1 + (γ−1)/2·M₀²) = ${f1(Tt)} K`, `pt₀ = p₀·τr^(γ/(γ−1)) = ${kP(pt0)} kPa`, how, `πd = πd,max·ηr = ${v.pidMax}·${f4(er)} = ${f4(pid)}`, `pt₂ = πd·pt₀ = ${kP(pt2)} kPa`, `At M₂ = ${v.M2}: T₂ = Tt₂/(1+(γ−1)/2·M₂²) = ${f1(s2.T)} K,  p₂ = ${kP(s2.p)} kPa`],
      };
    },
  },
  {
    id: 'comp', label: 'Compressor / fan', inputs: [['Tt2', 'Inlet Tt₂ (K)', 288.15], ['pt2', 'Inlet pt₂ (kPa)', 101.325], ['pi', 'Pressure ratio πc', 20], ['eff', 'Efficiency', 0.9], ['mdot', 'Mass flow (kg/s)', 50], ['g', 'γ', 1.4], ['cp', 'cp (J/kg·K)', 1004.5]],
    sel: [['type', 'Efficiency given as', [['poly', 'Polytropic ec'], ['isen', 'Isentropic ηc']]]],
    solve(v) {
      const k = (v.g - 1) / v.g, tauS = v.pi ** k;
      let tau, ec, etc;
      if (v.type === 'poly') { ec = v.eff; tau = v.pi ** (k / ec); etc = (tauS - 1) / (tau - 1); }
      else { etc = v.eff; tau = 1 + (tauS - 1) / etc; ec = k * Math.log(v.pi) / Math.log(tau); }
      const Tt3 = v.Tt2 * tau, w = v.cp * (Tt3 - v.Tt2);
      return {
        rows: [['τc = Tt₃/Tt₂', f4(tau)], ['Tt₃ (K)', f1(Tt3), true], ['pt₃ (kPa)', kP(v.pt2 * v.pi), true], ['Isentropic ηc', f4(etc)], ['Polytropic ec', f4(ec)], ['Specific work (kJ/kg)', f3(w / 1e3), true], ['Power (MW)', f3(w * v.mdot / 1e6)], ['Ideal Tt₃s (K)', f1(v.Tt2 * tauS)]],
        steps: [`Isentropic: τcs = πc^((γ−1)/γ) = ${v.pi}^${f4(k)} = ${f4(tauS)}`, v.type === 'poly' ? `Polytropic: τc = πc^((γ−1)/(γ·ec)) = ${f4(tau)}` : `τc = 1 + (τcs − 1)/ηc = ${f4(tau)}`, v.type === 'poly' ? `⇒ ηc = (τcs − 1)/(τc − 1) = ${f4(etc)}` : `⇒ ec = ((γ−1)/γ)·ln πc / ln τc = ${f4(ec)}`, `Tt₃ = τc·Tt₂ = ${f1(Tt3)} K`, `w = cp(Tt₃ − Tt₂) = ${f3(w / 1e3)} kJ/kg`, `P = ṁw = ${f3(w * v.mdot / 1e6)} MW`],
      };
    },
  },
  {
    id: 'burn', label: 'Combustor / afterburner', inputs: [['Tt3', 'Inlet Tt₃ (K)', 750], ['pt3', 'Inlet pt₃ (kPa)', 2000], ['Tt4', 'Exit Tt₄ (K)', 1600], ['hPR', 'Fuel heating value (MJ/kg)', 43.03], ['etaB', 'Burner efficiency ηb', 0.99], ['piB', 'Pressure ratio πb', 0.96], ['M3', 'Entry Mach (Rayleigh check)', 0.25], ['cpc', 'cp in (J/kg·K)', 1004.5], ['cpt', 'cp out (J/kg·K)', 1239], ['fst', 'Stoichiometric f', 0.0682]],
    solve(v) {
      const h = v.hPR * 1e6, f = (v.cpt * v.Tt4 - v.cpc * v.Tt3) / (v.etaB * h - v.cpt * v.Tt4);
      const phi = f / v.fst, lim = 1 / G.rayleigh.T0(v.M3, 1.4), ratio = v.Tt4 / v.Tt3;
      // exit Mach from Rayleigh (γ=1.4 approx)
      const T0r = G.rayleigh.T0(v.M3, 1.4) * ratio;
      const M4 = T0r <= 1 ? G.invertBranch((M, g) => G.rayleigh.T0(M, g), T0r, 1.4, false) : NaN;
      const rows = [['Fuel/air ratio f', f4(f), true], ['Equivalence ratio φ', f3(phi)], ['pt₄ (kPa)', kP(v.pt3 * v.piB), true], ['Heat added (kJ/kg air)', f1(f * v.etaB * h / 1e3)], ['Tt₄/Tt₃', f4(ratio)], ['Rayleigh limit Tt₄/Tt₃ at M₃', f4(lim), false, 'Maximum heating before the flow chokes thermally (Mach 1 at the exit).'], ['Exit Mach (Rayleigh, constant area)', f4(M4)]];
      return {
        rows, warn: phi > 1 ? 'φ > 1: more fuel than the air can burn — the exit temperature is not reachable.' : ratio > lim ? 'Thermal choking: the heat addition exceeds the Rayleigh limit at this entry Mach.' : '',
        steps: [`Energy: (1 + f)·cp,out·Tt₄ = cp,in·Tt₃ + f·ηb·h_PR`, `f = (cp,out Tt₄ − cp,in Tt₃)/(ηb h_PR − cp,out Tt₄) = (${v.cpt}·${v.Tt4} − ${v.cpc}·${v.Tt3})/(${v.etaB}·${h.toExponential(4)} − ${v.cpt}·${v.Tt4}) = ${f4(f)}`, `φ = f/f_st = ${f3(phi)}`, `pt₄ = πb·pt₃ = ${kP(v.pt3 * v.piB)} kPa`, `Rayleigh: T₀/T₀*(M₃=${v.M3}) = ${f4(G.rayleigh.T0(v.M3, 1.4))} ⇒ max Tt₄/Tt₃ = ${f4(lim)}`],
      };
    },
  },
  {
    id: 'turb', label: 'Turbine', inputs: [['Tt4', 'Inlet Tt₄ (K)', 1600], ['pt4', 'Inlet pt₄ (kPa)', 1920], ['w', 'Work to deliver (kJ/kg of air)', 460], ['f', 'Fuel/air ratio f', 0.025], ['etaM', 'Mechanical ηm', 0.99], ['eff', 'Efficiency', 0.9], ['g', 'γt', 1.3], ['cp', 'cpt (J/kg·K)', 1239]],
    sel: [['type', 'Efficiency given as', [['poly', 'Polytropic et'], ['isen', 'Isentropic ηt']]]],
    solve(v) {
      const k = (v.g - 1) / v.g, dT = v.w * 1e3 / (v.etaM * (1 + v.f) * v.cp), Tt5 = v.Tt4 - dT, tau = Tt5 / v.Tt4;
      let pi, et, eta;
      if (v.type === 'poly') { et = v.eff; pi = tau ** (1 / (k * et)); eta = (1 - tau) / (1 - pi ** k); }
      else { eta = v.eff; pi = (1 - (1 - tau) / eta) ** (1 / k); et = Math.log(tau) / (k * Math.log(pi)); }
      return {
        rows: [['Tt₅ (K)', f1(Tt5), true], ['τt = Tt₅/Tt₄', f4(tau)], ['πt = pt₅/pt₄', f4(pi), true], ['pt₅ (kPa)', kP(v.pt4 * pi), true], ['Expansion ratio pt₄/pt₅', f3(1 / pi)], ['Isentropic ηt', f4(eta)], ['Polytropic et', f4(et)]],
        warn: !(pi > 0) ? 'The turbine cannot deliver that much work from this inlet temperature.' : '',
        steps: [`Power balance: ηm(1 + f)·cpt(Tt₄ − Tt₅) = w`, `Tt₄ − Tt₅ = ${v.w}e3 / (${v.etaM}·${(1 + v.f).toFixed(4)}·${v.cp}) = ${f1(dT)} K ⇒ Tt₅ = ${f1(Tt5)} K`, v.type === 'poly' ? `πt = τt^(γt/((γt−1)·et)) = ${f4(pi)}` : `πt = [1 − (1 − τt)/ηt]^(γt/(γt−1)) = ${f4(pi)}`, `pt₅ = πt·pt₄ = ${kP(v.pt4 * pi)} kPa`],
      };
    },
  },
  {
    id: 'noz', label: 'Exhaust nozzle', inputs: [['Tt', 'Inlet Tt (K)', 950], ['pt', 'Inlet pt (kPa)', 250], ['pa', 'Ambient pa (kPa)', 22.63], ['mdot', 'Mass flow (kg/s)', 50], ['piN', 'Nozzle πn', 0.98], ['g', 'γ', 1.33], ['cp', 'cp (J/kg·K)', 1156]],
    sel: [['type', 'Nozzle', [['conv', 'Convergent'], ['cd', 'Converging–diverging (ideally expanded)']]]],
    solve(v) {
      const g = v.g, R = Rof(g, v.cp), pt = v.pt * 1e3 * v.piN, pa = v.pa * 1e3, crit = ((g + 1) / 2) ** (g / (g - 1));
      const pstar = pt / crit, choked = pa < pstar;
      const pe = v.type === 'conv' ? (choked ? pstar : pa) : pa;
      const Me = Math.sqrt(2 / (g - 1) * ((pt / pe) ** ((g - 1) / g) - 1)), Te = v.Tt / (1 + (g - 1) / 2 * Me * Me), Ve = Me * Math.sqrt(g * R * Te), rhoe = pe / (R * Te);
      const Ae = v.mdot / (rhoe * Ve), Ts = v.Tt * 2 / (g + 1), At = v.mdot / ((pstar / (R * Ts)) * Math.sqrt(g * R * Ts));
      const F = v.mdot * Ve + Ae * (pe - pa);
      return {
        rows: [['Critical pressure p* (kPa)', kP(pstar)], ['pt/pa', f3(pt / pa)], ['Choked?', choked ? 'yes' : 'no', true], ['Exit pressure pe (kPa)', kP(pe)], ['Exit Mach Me', f4(Me), true], ['Exit T (K)', f1(Te)], ['Exit velocity Ve (m/s)', f1(Ve), true], ['Throat area A* (m²)', choked ? f4(At) : '—'], ['Exit area Ae (m²)', f4(Ae)], ['Ae/A*', choked ? f4(Ae / At) : '—'], ['Gross thrust (kN)', f3(F / 1e3), true], ['of which pressure thrust (kN)', f3(Ae * (pe - pa) / 1e3)]],
        steps: [`pt,exit = πn·pt = ${kP(pt)} kPa`, `Critical ratio pt/p* = ((γ+1)/2)^(γ/(γ−1)) = ${f4(crit)} ⇒ p* = ${kP(pstar)} kPa`, v.type === 'conv' ? (choked ? `pa < p*: the convergent nozzle chokes, pe = p*` : `pa ≥ p*: unchoked, pe = pa`) : `C-D nozzle expands to pe = pa`, `Me = √[2/(γ−1)·((pt/pe)^((γ−1)/γ) − 1)] = ${f4(Me)}`, `Te = Tt/(1 + (γ−1)/2·Me²) = ${f1(Te)} K,  Ve = Me√(γRTe) = ${f1(Ve)} m/s`, `F = ṁVe + Ae(pe − pa) = ${f3(F / 1e3)} kN`],
      };
    },
  },
  {
    id: 'mix', label: 'Mixer (two streams)', inputs: [['m1', 'Core ṁ (kg/s)', 20], ['T1', 'Core Tt (K)', 1000], ['p1', 'Core pt (kPa)', 300], ['cp1', 'Core cp', 1239], ['m2', 'Bypass ṁ (kg/s)', 15], ['T2', 'Bypass Tt (K)', 420], ['p2', 'Bypass pt (kPa)', 310], ['cp2', 'Bypass cp', 1004.5], ['piM', 'Mixing πM', 0.98]],
    solve(v) {
      const m = v.m1 + v.m2, cp = (v.m1 * v.cp1 + v.m2 * v.cp2) / m, Tt = (v.m1 * v.cp1 * v.T1 + v.m2 * v.cp2 * v.T2) / (m * cp);
      const pt = v.piM * (v.m1 * v.p1 + v.m2 * v.p2) / m;
      const R1 = Rof(1.3, v.cp1), R2 = Rof(1.4, v.cp2), R = (v.m1 * R1 + v.m2 * R2) / m;
      const ds = (v.m1 * (v.cp1 * Math.log(Tt / v.T1) - R1 * Math.log(pt / v.p1)) + v.m2 * (v.cp2 * Math.log(Tt / v.T2) - R2 * Math.log(pt / v.p2))) / m;
      return {
        rows: [['Mixed ṁ (kg/s)', f3(m)], ['Mixed cp', f1(cp)], ['Mixed Tt (K)', f1(Tt), true], ['Mixed pt (kPa)', f3(pt), true], ['Bypass/core pt', f4(v.p2 / v.p1)], ['Entropy generated (J/kg·K)', f3(ds), false, 'Irreversibility of mixing hot and cold streams (approximate, γ 1.3/1.4).']],
        warn: Math.abs(v.p2 / v.p1 - 1) > 0.05 ? 'The stream pressures differ by more than 5%: real mixers need nearly equal static pressures.' : '',
        steps: [`Energy: ṁ₁cp₁Tt₁ + ṁ₂cp₂Tt₂ = (ṁ₁+ṁ₂)·cp,m·Tt,m`, `cp,m = ${f1(cp)},  Tt,m = ${f1(Tt)} K`, `pt,m ≈ πM·(mass-weighted pt) = ${f3(pt)} kPa`],
      };
    },
  },
  {
    id: 'prop', label: 'Propeller (actuator disk)', inputs: [['T', 'Thrust (kN)', 20], ['V0', 'Flight speed V₀ (m/s)', 150], ['D', 'Diameter (m)', 3.9], ['rho', 'Air density (kg/m³)', 0.66], ['etaV', 'Profile/viscous efficiency', 0.92]],
    solve(v) {
      const A = Math.PI * v.D * v.D / 4, T = v.T * 1e3;
      const vi = -v.V0 / 2 + Math.sqrt(v.V0 * v.V0 / 4 + T / (2 * v.rho * A));
      const Pi = T * (v.V0 + vi), etaI = v.V0 > 0 ? T * v.V0 / Pi : 0, P = Pi / v.etaV;
      const Pstatic = Math.sqrt(T ** 3 / (2 * v.rho * A));
      return {
        rows: [['Disk area (m²)', f3(A)], ['Disk loading T/A (kPa)', f4(T / A / 1e3)], ['Induced velocity vᵢ (m/s)', f3(vi), true], ['Far-wake velocity V₀ + 2vᵢ (m/s)', f1(v.V0 + 2 * vi)], ['Ideal (Froude) efficiency', f4(etaI), true], ['Ideal power (kW)', f1(Pi / 1e3)], ['Shaft power incl. losses (kW)', f1(P / 1e3), true], ['Static hover power (kW)', f1(Pstatic / 1e3)]],
        steps: [`Momentum theory: T = 2ρA(V₀ + vᵢ)vᵢ`, `vᵢ = −V₀/2 + √(V₀²/4 + T/(2ρA)) = ${f3(vi)} m/s`, `P_ideal = T(V₀ + vᵢ) = ${f1(Pi / 1e3)} kW`, `η_Froude = V₀/(V₀ + vᵢ) = 2/(1 + √(1 + T/(½ρV₀²A))) = ${f4(etaI)}`, `Bigger disks (lower T/A) give higher efficiency — the same idea as a high bypass ratio.`],
      };
    },
  },
];

export function stagesTab({ keep = o => o } = {}) {
  const S = keep({ id: 'comp', vals: {}, sel: {} });
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });
  const resCard = card('Results'); const resEl = h('div', { class: 'cf-res' }); resCard.append(resEl);
  const warnEl = h('div', { class: 'insight', style: { display: 'none' } });
  const stepCard = card('Step by step', 'The equations used, with your numbers substituted.'); const stepEl = h('div', { class: 'cf-steps' }); stepCard.append(stepEl);
  const pipe = h('div', { class: 'stage-pipe' });
  main.append(pipe, warnEl, resCard, stepCard);
  const inputsEl = h('div');
  const build = () => {
    const st = STAGES.find(s => s.id === S.id);
    const sec = section('Component');
    put(sec.body, field('Stage', select(STAGES.map(s => ({ value: s.id, label: s.label })), S.id, v => { S.id = v; build(); solve(); })));
    const sec2 = section('Inputs');
    inputsEl.replaceChildren();
    for (const [k, lab, opts] of st.sel || []) { S.sel[k] = S.sel[k] ?? opts[0][0]; inputsEl.append(field(lab, select(opts.map(([value, label]) => ({ value, label })), S.sel[k], v => { S.sel[k] = v; solve(); }))); }
    for (const [k, lab, def] of st.inputs) {
      const key = st.id + '.' + k; if (S.vals[key] === undefined) S.vals[key] = def;
      const inp = h('input', { class: 'text-input', value: S.vals[key], inputmode: 'decimal' });
      inp.addEventListener('input', () => { const x = parseNum(inp.value); if (isFinite(x)) { S.vals[key] = x; solve(); } });
      inputsEl.append(field(lab, inp));
    }
    put(sec2.body, inputsEl);
    controls.replaceChildren(sec.el, sec2.el);
    pipe.replaceChildren(...STAGES.map(s => { const b = h('button', { type: 'button', class: s.id === S.id ? 'on' : '' }, s.label); b.addEventListener('click', () => { S.id = s.id; build(); solve(); }); return b; }));
  };
  const solve = () => {
    const st = STAGES.find(s => s.id === S.id), v = { ...S.sel };
    for (const [k] of st.inputs) v[k] = S.vals[st.id + '.' + k];
    let r;
    try { r = st.solve(v); } catch (e) { r = { rows: [], steps: ['Error: ' + e.message] }; }
    resultRows(resEl, r.rows);
    stepEl.replaceChildren(...r.steps.map(s => h('div', {}, s)));
    if (r.warn) { warnEl.style.display = ''; warnEl.replaceChildren(h('div', { class: 'ic w' }, '!'), h('div', {}, h('div', { class: 't' }, 'Check'), h('div', { class: 'd' }, r.warn))); } else warnEl.style.display = 'none';
  };
  build(); solve();
  return { controls, main };
}
