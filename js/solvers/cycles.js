// Gas-turbine and ramjet/scramjet cycle analysis, station by station (SAE ARP 755 numbering).
// One cycle code works with three gas models through a common interface:
//   'ideal'    calorically perfect air everywhere (cp = 1004.5, γ = 1.4)
//   'twoGamma' cold section air γ=1.4, hot section products γ=1.3 (Mattingly's "model with losses")
//   'real'     NASA polynomials, equilibrium combustion products (frozen through turbine and nozzle)
import * as TH from './thermo.js';
import { milSpecRecovery, oswatitschRamps, analyzeInlet } from './inlets.js';
import { rayleigh } from './gasdyn.js';
import { atmosphere } from './atmosphere.js';

const G0 = 9.80665;

// ---------- ISA standard atmosphere (geometric altitude, 0–86 km): shared model in atmosphere.js ----------
export function isa(z) { const s = atmosphere(z); return { T: s.T, p: s.p, rho: s.rho, a: s.a }; }

// ---------- gas models ----------
class IdealMix {
  constructor(cp, R) { this.cp0 = cp; this.R = R; }
  h(T) { return this.cp0 * T; }
  cp() { return this.cp0; }
  s(T, p) { return this.cp0 * Math.log(T / 298.15) - this.R * Math.log(p / 1e5); }
  gamma() { return this.cp0 / (this.cp0 - this.R); }
  T_h(h) { return h / this.cp0; }
  T_sp(s, p) { return 298.15 * Math.exp((s + this.R * Math.log(p / 1e5)) / this.cp0); }
}
const AIR_SP = TH.PRODUCTS;
const spIndex = Object.fromEntries(AIR_SP.map((s, i) => [s.name, i]));
function airFrozen() {
  const mixDef = TH.REACTANTS.Air.mix; let W = 0;
  for (const [k, x] of Object.entries(mixDef)) W += x * TH.SPECIES[k].W;
  const n = new Float64Array(AIR_SP.length);
  for (const [k, x] of Object.entries(mixDef)) n[spIndex[k]] = x / W;
  return new TH.FrozenMix(AIR_SP, n);
}
function elementsOf(mix) {
  const b = {};
  for (let j = 0; j < AIR_SP.length; j++) if (mix.n[j] > 0) for (const [e, c] of Object.entries(AIR_SP[j].el)) b[e] = (b[e] || 0) + c * mix.n[j];
  return b;
}
function frozenFromEq(st) {
  const n = new Float64Array(AIR_SP.length);
  st.sys.sp.forEach((s, j) => { if (st.n[j] / st.nt > 1e-9) n[spIndex[s.name]] = st.n[j]; });
  return new TH.FrozenMix(AIR_SP, n);
}

export const FUELS = {
  'Jet-A(L)': { label: 'Jet-A (kerosene)' },
  'H2': { label: 'Hydrogen (gas)' },
  'CH4': { label: 'Methane (gas)' },
  'RP-1': { label: 'RP-1' },
};

export function makeGas(model, fuelId) {
  const LHV = TH.lowerHeatingValue(fuelId);
  const fst = 1 / TH.stoichOF(fuelId, 'Air');
  const fuel = TH.reactantProps(fuelId);
  if (model !== 'real') {
    const air = new IdealMix(1004.5, 287.05);
    const hot = model === 'twoGamma' ? new IdealMix(1239, 1239 * 0.3 / 1.3) : air;
    return {
      model, LHV, fst, air, hot,
      // per unit mass of incoming gas: fuel f gives total enthalpy hOut (sensible, h_fuel neglected)
      burnF(mixIn, hIn, f, p, eta) { const h = (hIn + f * eta * LHV) / (1 + f); return { mix: hot, T: hot.T_h(h), h }; },
      burnT(mixIn, hIn, Tout, p, eta) { const ho = hot.h(Tout); const f = (ho - hIn) / (eta * LHV - ho); return { f, mix: hot, T: Tout, h: ho, capped: !(f >= 0) || f > fst }; },
      mixStreams(list) { let m = 0, cp = 0, R = 0; for (const [mi, x] of list) { m += mi; cp += mi * x.cp0; R += mi * x.R; } return new IdealMix(cp / m, R / m); },
    };
  }
  const air = airFrozen();
  const fuelB = {}; for (const [e, c] of Object.entries(fuel.el)) fuelB[e] = c / fuel.W; // mol element per kg fuel
  const hFuel = fuel.h / fuel.W;
  let warm = null;
  const eqAt = (mixIn, hIn, f, p, eta) => {
    const bi = elementsOf(mixIn), b0 = {};
    for (const e of new Set([...Object.keys(bi), ...Object.keys(fuelB)])) b0[e] = ((bi[e] || 0) + f * (fuelB[e] || 0)) / (1 + f);
    const h = (hIn + f * (hFuel - (1 - eta) * LHV)) / (1 + f);
    const sys = new TH.System(b0);
    const st = TH.equilibrate(sys, 'HP', { h, P: p, init: warm && warm.sys.els.join() === sys.els.join() ? { ...warm, sys } : null, T0: warm ? warm.T : 2000 });
    warm = st;
    return { st, h };
  };
  return {
    model, LHV, fst, air, hot: null,
    burnF(mixIn, hIn, f, p, eta) {
      if (f <= 0) return { mix: mixIn, T: mixIn.T_h(hIn), h: hIn };
      const { st, h } = eqAt(mixIn, hIn, f, p, eta); return { mix: frozenFromEq(st), T: st.T, h, eq: st };
    },
    burnT(mixIn, hIn, Tout, p, eta) {
      const Tin = mixIn.T_h(hIn);
      if (Tout <= Tin) return { f: 0, mix: mixIn, T: Tin, h: hIn, capped: true };
      const Tf = f => eqAt(mixIn, hIn, f, p, eta).st.T;
      // bracket on the lean side of the flame-temperature peak
      let lo = 0, hi = Math.min(1.2 * fst, Math.max(1e-4, (1150 * Tout - 1100 * Tin) / (eta * LHV - 1150 * Tout)) * 1.6);
      let Thi = Tf(hi), capped = false;
      while (Thi < Tout && hi < 1.05 * fst) { hi = Math.min(1.05 * fst, hi * 1.5); Thi = Tf(hi); }
      if (Thi < Tout) { capped = true; const r = this.burnF(mixIn, hIn, hi, p, eta); return { ...r, f: hi, capped }; }
      for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (Tf(m) < Tout) lo = m; else hi = m; if (hi - lo < 1e-9) break; }
      const f = (lo + hi) / 2, r = this.burnF(mixIn, hIn, f, p, eta);
      return { ...r, f, capped };
    },
    mixStreams(list) {
      let m = 0; const n = new Float64Array(AIR_SP.length);
      for (const [mi, x] of list) { m += mi; for (let j = 0; j < n.length; j++) n[j] += mi * x.n[j]; }
      for (let j = 0; j < n.length; j++) n[j] /= m;
      return new TH.FrozenMix(AIR_SP, n);
    },
  };
}

// ---------- flow processes on total states {Tt, pt, ht, mix} ----------
const total = (mix, Tt, pt) => ({ mix, Tt, pt, ht: mix.h(Tt), s: mix.s(Tt, pt) });
function compress(st, pi, eff, poly) {
  const p2 = st.pt * pi, path = [[st.Tt, st.pt]];
  if (!poly) {
    const Ts = st.mix.T_sp(st.s, p2, st.Tt * pi ** 0.28), h = st.ht + (st.mix.h(Ts) - st.ht) / eff;
    const T = st.mix.T_h(h, Ts);
    return { ...total(st.mix, T, p2), path: [[st.Tt, st.pt], [T, p2]] };
  }
  const n = 24; let T = st.Tt, p = st.pt, h = st.ht;
  for (let k = 0; k < n; k++) {
    const pn = p * pi ** (1 / n), s = st.mix.s(T, p), Ts = st.mix.T_sp(s, pn, T);
    h += (st.mix.h(Ts) - h) / eff; T = st.mix.T_h(h, Ts); p = pn; path.push([T, p]);
  }
  return { ...total(st.mix, T, p), path };
}
// expand delivering specific work dh (J per kg of this gas)
function expandWork(st, dh, eff, poly) {
  const m = st.mix;
  if (!poly) {
    const Ts = m.T_h(st.ht - dh / eff, st.Tt * 0.8), p = st.pt * Math.exp((m.s(Ts, st.pt) - st.s) / m.R);
    const T = m.T_h(st.ht - dh, Ts);
    return { ...total(m, T, p), path: [[st.Tt, st.pt], [T, p]] };
  }
  const n = 24; let T = st.Tt, p = st.pt, h = st.ht; const path = [[T, p]];
  for (let k = 0; k < n; k++) {
    const d = dh / n, s = m.s(T, p), Ts = m.T_h(h - d / eff, T);
    p = p * Math.exp((m.s(Ts, p) - s) / m.R); h -= d; T = m.T_h(h, Ts); path.push([T, p]);
  }
  return { ...total(m, T, p), path };
}
function expandTo(st, pOut, eff, poly) {
  const m = st.mix;
  if (!poly) { const Ts = m.T_sp(st.s, pOut, st.Tt * 0.8), h = st.ht - eff * (st.ht - m.h(Ts)), T = m.T_h(h, Ts); return { ...total(m, T, pOut), path: [[st.Tt, st.pt], [T, pOut]] }; }
  const n = 24; let T = st.Tt, p = st.pt, h = st.ht; const path = [[T, p]];
  const r = (pOut / st.pt) ** (1 / n);
  for (let k = 0; k < n; k++) { const pn = p * r, Ts = m.T_sp(m.s(T, p), pn, T); h -= eff * (h - m.h(Ts)); T = m.T_h(h, Ts); p = pn; path.push([T, p]); }
  return { ...total(m, T, p), path };
}
const pressureLoss = (st, pi) => ({ ...total(st.mix, st.Tt, st.pt * pi), path: [[st.Tt, st.pt], [st.Tt, st.pt * pi]] });

// static state for a given total state and velocity or Mach
function staticAtP(st, p) { const T = st.mix.T_sp(st.s, p, st.Tt * 0.8), h = st.mix.h(T), V = Math.sqrt(Math.max(0, 2 * (st.ht - h))), a = Math.sqrt(st.mix.gamma(T) * st.mix.R * T); return { T, p, V, a, M: V / a, rho: p / (st.mix.R * T) }; }
function staticAtM(st, M) {
  let lo = Math.log(st.pt) - 12, hi = Math.log(st.pt);
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2, s = staticAtP(st, Math.exp(mid)); if (s.M > M) lo = mid; else hi = mid; }
  return staticAtP(st, Math.exp((lo + hi) / 2));
}
// nozzle: convergent (chokes at M=1) or converging–diverging (fully expanded to pe = pa·peRatio)
function nozzle(st, pa, type, peRatio = 1) {
  const crit = staticAtM(st, 1);
  let ex;
  if (type === 'conv') ex = pa < crit.p ? crit : staticAtP(st, Math.min(pa, st.pt * 0.99999));
  else ex = staticAtP(st, Math.min(pa * peRatio, st.pt * 0.99999));
  const Fs = ex.V + (ex.p - pa) / (ex.rho * ex.V);   // gross thrust per unit mass flow
  return { ...ex, Fs, crit, choked: crit.p >= ex.p - 1e-6, AperM: 1 / (ex.rho * ex.V), AthPerM: 1 / (crit.rho * crit.V) };
}

function inletRecovery(inlet, M0) {
  if (M0 <= 1) return { eta: 1, label: 'subsonic' };
  if (inlet.model === 'mil') return { eta: milSpecRecovery(M0), label: 'MIL-E-5008B' };
  if (inlet.model === 'normal') return { eta: analyzeInlet(M0, [], { terminal: 'normal' }).recovery, label: 'Normal-shock (pitot) inlet' };
  const N = inlet.nRamps ?? 2, o = oswatitschRamps(M0, N), r = analyzeInlet(M0, o.thetas, { terminal: 'normal' });
  return { eta: r.recovery, label: `${N}-ramp external compression`, thetas: o.thetas };
}

// ---------- main entry ----------
export const ENGINE_TYPES = {
  turbojet: 'Turbojet', turbofan: 'Turbofan', turboprop: 'Turboprop', ramjet: 'Ramjet', scramjet: 'Scramjet',
};

export function defaults(type) {
  const base = { type, gas: 'twoGamma', fuel: 'Jet-A(L)', alt: 11000, M0: 0.85, mdot: 100, inlet: { model: 'mil', pidMax: 0.98, nRamps: 2 }, poly: true, etaB: 0.99, piB: 0.96, etaM: 0.99, piN: 0.98, nozzle: 'conv' };
  switch (type) {
    case 'turbojet': return { ...base, M0: 0.9, piC: 20, eC: 0.90, Tt4: 1600, eT: 0.90, ab: false, Tt7: 2000, piAB: 0.94, etaAB: 0.95, nozzle: 'conv' };
    case 'turbofan': return { ...base, M0: 0.8, alt: 10668, piC: 36, piF: 1.6, bpr: 8, eC: 0.90, eF: 0.89, Tt4: 1650, eT: 0.90, mixed: false, ab: false, Tt7: 2000, piAB: 0.94, etaAB: 0.95, piM: 0.98, mdot: 500, nozzle: 'conv' };
    case 'turboprop': return { ...base, M0: 0.5, alt: 6000, piC: 16, eC: 0.89, Tt4: 1450, eT: 0.89, x: 0.85, etaProp: 0.85, etaG: 0.98, autoX: true, mdot: 10, nozzle: 'conv' };
    case 'ramjet': return { ...base, M0: 3, alt: 18000, Tt4: 2200, inlet: { model: 'ramps', pidMax: 0.96, nRamps: 2 }, Mb: 0.2, nozzle: 'cd', mdot: 30 };
    case 'scramjet': return { ...base, M0: 10, alt: 30000, fuel: 'H2', gas: 'real', psi: 7, etaC: 0.90, phi: 1, etaB: 0.90, CfA: 0.02, etaE: 0.90, pRatio: 1, mdot: 20, combustor: 'p' };
  }
}

export function runCycle(P) {
  const warn = [];
  const gas = makeGas(P.gas, P.fuel);
  const amb = isa(P.alt), T0 = P.T0 ?? amb.T, p0 = P.p0 ?? amb.p;
  const air = gas.air;
  const a0 = Math.sqrt(air.gamma(T0) * air.R * T0), V0 = P.M0 * a0;
  const ht0 = air.h(T0) + V0 * V0 / 2, Tt0 = air.T_h(ht0, T0), pt0 = p0 * Math.exp((air.s(Tt0, p0) - air.s(T0, p0)) / air.R);
  const S = [];  // stations
  const add = (id, name, st, extra = {}) => { const o = { id, name, Tt: st.Tt, pt: st.pt, ht: st.ht, s: st.s, mix: st.mix, path: st.path, comb: !!st.comb, ...extra }; S.push(o); return o; };
  const fs = total(air, Tt0, pt0);
  add('0', 'Freestream', fs, { T: T0, p: p0, V: V0, M: P.M0, m: 1 });
  if (P.type === 'scramjet') return scramjet(P, gas, { T0, p0, V0, a0, fs, S, add, warn, amb });

  // inlet
  const rec = inletRecovery(P.inlet, P.M0);
  const pid = P.inlet.pidMax * rec.eta;
  const st2 = pressureLoss(fs, pid);
  const s2 = add('2', P.type === 'ramjet' ? 'Diffuser exit' : (P.type === 'turbofan' ? 'Fan face' : 'Compressor face'), st2, { note: `πd = ${pid.toFixed(4)} (${rec.label})` });
  if (P.type === 'ramjet' && P.M0 < 1) warn.push({ type: 'w', t: 'Ramjets need ram pressure', d: 'Below about Mach 1 the ram compression is too weak; real ramjets are boosted to Mach 2+ before lighting.' });

  const res = { gas, amb, T0, p0, V0, a0, S, warn, inlet: { ...rec, pid } };
  let fTot = 0, streams = [], shaft = 0, m0tot = 1;

  if (P.type === 'ramjet') {
    const b = gas.burnT(st2.mix, st2.ht, P.Tt4, st2.pt, P.etaB);
    if (b.capped) warn.push({ type: 'b', t: 'Tt4 not reachable', d: `Even at stoichiometric fuel/air the flame cannot reach ${P.Tt4} K; using f = ${b.f.toFixed(4)}.` });
    const st4 = { ...total(b.mix, b.T, st2.pt * P.piB), path: [[st2.Tt, st2.pt], [b.T, st2.pt * P.piB]], comb: true };
    fTot = b.f;
    add('4', 'Combustor exit', st4, { m: 1 + fTot, note: `f = ${fTot.toFixed(4)}` });
    // thermal choking check (Rayleigh, γ≈1.4 entry)
    const ratio = b.T / st2.Tt, lim = 1 / rayleigh.T0(P.Mb, 1.4);
    if (ratio > lim) warn.push({ type: 'b', t: 'Thermal choking', d: `Heating by Tt4/Tt2 = ${ratio.toFixed(2)} exceeds the Rayleigh limit ${lim.toFixed(2)} for a combustor entry Mach ${P.Mb}. Lower the entry Mach or the heat release.` });
    else res.rayleigh = { ratio, lim };
    const nz = nozzle(pressureLoss(st4, P.piN), p0, P.nozzle);
    streams.push({ id: '9', m: 1 + fTot, nz, st: pressureLoss(st4, P.piN) });
  } else {
    const poly = P.poly;
    let st3, st13 = null, st25 = null;
    const bpr = P.type === 'turbofan' ? P.bpr : 0;
    m0tot = 1 + bpr;
    if (P.type === 'turbofan') {
      st13 = compress(st2, P.piF, P.eF, poly);
      add('13', 'Fan exit', st13, { m: bpr, note: `πf = ${P.piF}` });
      st3 = compress({ ...st13, path: null }, P.piC / P.piF, P.eC, poly);
      add('3', 'HPC exit', st3, { m: 1, note: `OPR = ${P.piC}` });
    } else {
      st3 = compress(st2, P.piC, P.eC, poly);
      add('3', 'Compressor exit', st3, { m: 1, note: `πc = ${P.piC}` });
    }
    const b = gas.burnT(st3.mix, st3.ht, P.Tt4, st3.pt, P.etaB);
    if (b.capped) warn.push({ type: 'b', t: 'Tt4 not reachable', d: `The burner cannot reach ${P.Tt4} K with this fuel and Tt3; using f = ${b.f.toFixed(4)}.` });
    const f = b.f; fTot = f;
    const st4 = { ...total(b.mix, b.T, st3.pt * P.piB), path: [[st3.Tt, st3.pt], [b.T, st3.pt * P.piB]], comb: true };
    add('4', 'Turbine inlet', st4, { m: 1 + f, note: `f = ${f.toFixed(4)}` });
    let st5;
    if (P.type === 'turbofan') {
      const wH = (st3.ht - st13.ht) / (P.etaM * (1 + f));
      const st45 = expandWork(st4, wH, P.eT, poly);
      add('45', 'HPT exit', st45, { m: 1 + f });
      const wL = (1 + bpr) * (st13.ht - st2.ht) / (P.etaM * (1 + f));
      st5 = expandWork(st45, wL, P.eT, poly);
      add('5', 'LPT exit', st5, { m: 1 + f });
    } else if (P.type === 'turboprop') {
      const wH = (st3.ht - st2.ht) / (P.etaM * (1 + f));
      const st45 = expandWork(st4, wH, P.eT, poly);
      add('45', 'Gas-generator turbine exit', st45, { m: 1 + f });
      // power turbine: share x of the remaining log pressure drop to ambient
      const evalX = x => {
        const p5 = st45.pt * Math.exp(x * Math.log(p0 / st45.pt));
        const s5 = expandTo(st45, Math.max(p5, p0 * 1.0001), P.eT, poly);
        const w = (1 + f) * (st45.ht - s5.ht) * P.etaM * P.etaG;
        const nz = nozzle(pressureLoss(s5, P.piN), p0, P.nozzle);
        const Fp = V0 > 1 ? P.etaProp * w / V0 : NaN;
        return { s5, w, nz, F: Fp + (1 + f) * nz.Fs - V0 };
      };
      let x = Math.min(0.995, Math.max(0, P.x));
      if (P.autoX && V0 > 1) {
        let lo = 0, hi = 0.995;
        for (let i = 0; i < 26; i++) { const m1 = lo + (hi - lo) * 0.382, m2 = lo + (hi - lo) * 0.618; if (evalX(m1).F < evalX(m2).F) lo = m1; else hi = m2; }
        x = (lo + hi) / 2;
      }
      res.xUsed = x;
      const r = evalX(x);
      st5 = r.s5; shaft = r.w;
      add('5', 'Power turbine exit', st5, { m: 1 + f, note: `x = ${x.toFixed(3)}` });
      if (V0 < 1) warn.push({ type: 'w', t: 'Static condition', d: 'At M0 = 0 the propeller thrust needs a static thrust model; shaft power is still shown.' });
    } else {
      const w = (st3.ht - st2.ht) / (P.etaM * (1 + f));
      st5 = expandWork(st4, w, P.eT, poly);
      add('5', 'Turbine exit', st5, { m: 1 + f });
    }
    let core = st5, mCore = 1 + f;
    if (P.type === 'turbofan' && P.mixed) {
      const mm = mCore + bpr;
      const mix = gas.mixStreams([[mCore, st5.mix], [bpr, st13.mix]]);
      const ht = (mCore * st5.ht + bpr * st13.ht) / mm;
      const pt = P.piM * (mCore * st5.pt + bpr * st13.pt) / mm;
      const T = mix.T_h(ht, st5.Tt);
      core = { ...total(mix, T, pt), path: [[st5.Tt, st5.pt], [T, pt]] };
      add('6A', 'Mixer exit', core, { m: mm });
      const mis = st13.pt / st5.pt - 1;
      res.mixMismatch = mis;
      if (Math.abs(mis) > 0.05) warn.push({ type: 'w', t: 'Mixer pressures not matched', d: `Bypass total pressure is ${(mis * 100).toFixed(1)}% ${mis > 0 ? 'above' : 'below'} the core. Real mixers need nearly equal static pressures; use "Match fan PR".` });
      mCore = mm;
    }
    if (P.ab && (P.type === 'turbojet' || (P.type === 'turbofan' && P.mixed))) {
      const bb = gas.burnT(core.mix, core.ht, P.Tt7, core.pt, P.etaAB);
      if (bb.capped) warn.push({ type: 'w', t: 'Afterburner limited', d: `Not enough oxygen left to reach Tt7 = ${P.Tt7} K.` });
      const fab = bb.f * mCore;   // per unit core air
      fTot += fab;
      const st7 = { ...total(bb.mix, bb.T, core.pt * P.piAB), path: [[core.Tt, core.pt], [bb.T, core.pt * P.piAB]], comb: true };
      add('7', 'Afterburner exit', st7, { m: mCore + fab, note: `f_AB = ${(fab / m0tot).toFixed(4)}` });
      mCore += fab; core = st7;
    }
    const stn = pressureLoss(core, P.piN);
    const nz = nozzle(stn, p0, P.nozzle);
    streams.push({ id: '9', m: mCore, nz, st: stn });
    if (P.type === 'turbofan' && !P.mixed) {
      const stf = pressureLoss(st13, P.piN);
      const nzf = nozzle(stf, p0, P.nozzle);
      streams.push({ id: '19', m: bpr, nz: nzf, st: stf });
    }
  }
  // exits
  for (const s of streams) {
    add(s.id, s.id === '19' ? 'Fan nozzle exit' : 'Nozzle exit', s.st, { T: s.nz.T, p: s.nz.p, V: s.nz.V, M: s.nz.M, m: s.m, exit: true, choked: s.nz.choked, path: [[s.st.Tt, s.st.pt]] });
    if (s.nz.p > p0 * 1.02) warn.push({ type: 'i', t: `Nozzle ${s.id} underexpanded`, d: `Exit static pressure ${(s.nz.p / 1000).toFixed(1)} kPa > ambient ${(p0 / 1000).toFixed(1)} kPa: a convergent nozzle is choked; a C-D nozzle would gain thrust.` });
  }
  return finishPerf(P, res, streams, fTot, shaft, m0tot);
}

function finishPerf(P, res, streams, fTot, shaft, m0tot) {
  const { V0, gas } = res;
  res.S[0].m = m0tot; const s2 = res.S.find(s => s.id === '2'); if (s2) s2.m = m0tot;
  let Fgross = 0, KE = 0;
  // kinetic energy on the effective exhaust velocity (includes pressure thrust of underexpanded nozzles)
  for (const s of streams) { Fgross += s.m * s.nz.Fs; KE += 0.5 * s.m * s.nz.Fs ** 2; }
  // Earth-frame energy balance: the fuel already moves at V0, so its kinetic energy ½fV0² is an input
  // (available = F·V0 + wake KE = Σ½mV² − ½ṁ0V0² + ½ṁfV0²)
  KE += -0.5 * m0tot * V0 * V0 + 0.5 * fTot * V0 * V0;
  let Fcore = Fgross - m0tot * V0;     // per unit core air
  let Fprop = 0;
  if (P.type === 'turboprop') Fprop = V0 > 1 ? P.etaProp * shaft / V0 : 0;
  const F = Fcore + Fprop;
  const Q = fTot * (gas.LHV + V0 * V0 / 2);
  const Fs = F / m0tot;                 // per unit total air
  const TSFC = fTot / F;                // kg/(N s)
  const useful = KE + shaft;
  const perf = {
    Fs, TSFC, f: fTot / m0tot, fCore: fTot, Isp: F / (fTot * G0),
    etaTh: useful / Q, etaP: V0 > 1 ? (F * V0) / useful : NaN, etaO: (F * V0) / Q,
    Fprop: Fprop / m0tot, Fjet: Fcore / m0tot, shaft: shaft / m0tot,
    thrust: Fs * P.mdot, fuelFlow: fTot / m0tot * P.mdot, capture: P.mdot / (isaRho(res) * V0),
  };
  if (P.type === 'turboprop') {
    const esp = shaft + (V0 > 1 ? Fcore * V0 / P.etaProp : 0);
    perf.ESP = esp * P.mdot; perf.BSFC = fTot / esp; perf.power = shaft * P.mdot; perf.xUsed = res.xUsed;
  }
  // a design is only physical if every nozzle has total pressure above ambient and fuel is positive
  perf.valid = F > 0 && fTot >= 0 && streams.every(s => !s.st || s.st.pt > res.p0 * 1.005);
  const w = res.warn;
  if (!streams.every(s => !s.st || s.st.pt > res.p0 * 1.005)) w.push({ type: 'b', t: 'Turbine cannot drive the load', d: 'A nozzle has less total pressure than ambient: the turbines take so much energy that the core cannot exhaust. Lower the bypass ratio or fan pressure ratio, or raise Tt4.' });
  if (F <= 0) w.push({ type: 'b', t: 'No net thrust', d: 'The jet leaves slower than the incoming air (ram drag wins). Raise Tt4 or the pressure ratio, or fly slower.' });
  const gt = P.type !== 'ramjet' && P.type !== 'scramjet';
  const st3 = res.S.find(s => s.id === '3');
  if (gt && st3 && st3.Tt > 950) w.push({ type: 'w', t: 'Hot compressor exit', d: `Tt3 = ${st3.Tt.toFixed(0)} K. Above ~950 K the last compressor stages need nickel alloys and the burner has less temperature rise to work with.` });
  const st4 = res.S.find(s => s.id === '4');
  if (gt && st4 && st4.Tt > 1700) w.push({ type: 'i', t: 'Turbine cooling required', d: `Tt4 = ${st4.Tt.toFixed(0)} K is far above blade-metal limits (~1350 K); modern engines rely on film cooling and thermal-barrier coatings.` });
  return { ...res, streams, perf };
}
function isaRho(res) { return res.p0 / (287.05 * res.T0); }

// Scramjet: Heiser & Pratt "first-law" model. Inlet compression to T3 = ψ·T0 with efficiency ηc,
// constant-pressure (or constant-area) supersonic combustion with wall friction, expansion with ηe.
function scramjet(P, gas, ctx) {
  const { T0, p0, V0, fs, add, warn, S } = ctx;
  const air = gas.air;
  const h0 = air.h(T0), T3 = P.psi * T0, h3 = air.h(T3);
  const V3sq = V0 * V0 - 2 * (h3 - h0);
  if (V3sq <= 0) { warn.push({ type: 'b', t: 'Over-compressed', d: 'ψ is too high: the inlet would stop the flow.' }); }
  const V3 = Math.sqrt(Math.max(1, V3sq));
  const hx = h3 - P.etaC * (h3 - h0), Tx = air.T_h(hx, T0);
  const p3 = p0 * Math.exp((air.s(T3, p0) - air.s(Tx, p0)) / air.R);
  const a3 = Math.sqrt(air.gamma(T3) * air.R * T3), M3 = V3 / a3;
  const st3 = { ...total(air, air.T_h(h3 + V3 * V3 / 2, T3), 0), path: null };
  st3.pt = p3 * Math.exp((air.s(st3.Tt, p3) - air.s(T3, p3)) / air.R); st3.s = air.s(T3, p3);
  add('3', 'Combustor entry', { ...st3, path: [[fs.Tt, fs.pt], [st3.Tt, st3.pt]] }, { T: T3, p: p3, V: V3, M: M3, m: 1 });
  if (M3 < 1) warn.push({ type: 'b', t: 'Subsonic combustor entry', d: `M3 = ${M3.toFixed(2)}: this is ramjet territory. Lower ψ or fly faster.` });
  // combustion
  const f = P.phi * gas.fst;
  let V4 = V3 * (1 - P.CfA / 2) / (1 + f);
  // energy: total enthalpy per unit mass after fuel addition (fuel kinetic energy neglected)
  const ht3 = h3 + V3 * V3 / 2;
  let b, p4 = p3, M4, T4, V4f = V4;
  if (P.combustor === 'p') {
    const htEff = ht3;                                // per unit air
    const hIn4 = htEff - (1 + f) * V4 * V4 / 2;       // static enthalpy content of incoming per unit air
    b = gas.burnF(air, hIn4, f, p3, P.etaB);
    T4 = b.T;
  } else {
    // constant area: iterate p4 with momentum and continuity (Rayleigh-like)
    let pp = p3;
    for (let i = 0; i < 60; i++) {
      // momentum: p3 + ρ3V3² (1 - CfA/2) = p4 + ρ4V4² ; continuity: ρ4V4 = (1+f)ρ3V3
      const rho3 = p3 / (air.R * T3), G = (1 + f) * rho3 * V3, I = p3 + rho3 * V3 * V3 * (1 - P.CfA / 2);
      V4f = (I - pp) / G;
      const hIn4 = ht3 - (1 + f) * V4f * V4f / 2;
      b = gas.burnF(air, hIn4, f, pp, P.etaB);
      // enforce continuity ρ4 V4 = G, then momentum gives the new pressure
      const rho4 = pp / (b.mix.R * b.T);
      const Vc = G / rho4, pnew = I - G * Vc;
      if (Math.abs(pnew - pp) < 1e-7 * pp) { pp = pnew; break; }
      pp = 0.5 * pp + 0.5 * Math.max(p3 * 0.5, pnew);
    }
    p4 = pp; V4 = V4f; T4 = b.T;
  }
  const mix4 = b.mix, a4 = Math.sqrt(mix4.gamma(T4) * mix4.R * T4); M4 = V4 / a4;
  const s4 = mix4.s(T4, p4);
  const ht4 = mix4.h(T4) + V4 * V4 / 2, Tt4 = mix4.T_h(ht4, T4);
  const pt4 = p4 * Math.exp((mix4.s(Tt4, p4) - s4) / mix4.R);
  add('4', 'Combustor exit', { mix: mix4, Tt: Tt4, pt: pt4, ht: ht4, s: s4, path: [[st3.Tt, st3.pt], [Tt4, pt4]], comb: true }, { T: T4, p: p4, V: V4, M: M4, m: 1 + f, note: `φ = ${P.phi}, f = ${f.toFixed(4)}` });
  if (M4 < 1) warn.push({ type: 'b', t: 'Thermal choking', d: `The combustor exit is subsonic (M4 = ${M4.toFixed(2)}); the heat release chokes the flow. Raise ψ less, or reduce φ.` });
  if (T4 > 2800 && gas.model !== 'real') warn.push({ type: 'w', t: 'Dissociation ignored', d: 'Above ~2500 K products dissociate and absorb energy. Use the real-gas (equilibrium) model.' });
  // expansion
  const p10 = p0 * P.pRatio, T10s = mix4.T_sp(s4, p10, T4 * 0.5), h10 = mix4.h(T4) - P.etaE * (mix4.h(T4) - mix4.h(T10s));
  const T10 = mix4.T_h(h10, T10s), V10 = Math.sqrt(Math.max(0, 2 * (ht4 - h10)));
  const a10 = Math.sqrt(mix4.gamma(T10) * mix4.R * T10);
  const s10 = mix4.s(T10, p10);
  add('10', 'Nozzle exit', { mix: mix4, Tt: Tt4, pt: p10 * Math.exp((mix4.s(Tt4, p10) - s10) / mix4.R), ht: ht4, s: s10, path: null }, { T: T10, p: p10, V: V10, M: V10 / a10, m: 1 + f, exit: true });
  const rho10 = p10 / (mix4.R * T10);
  const Fs = (1 + f) * V10 - V0 + (1 + f) * (p10 - p0) / (rho10 * V10);
  const nz = { V: V10, Fs: V10 + (p10 - p0) / (rho10 * V10), p: p10, T: T10, M: V10 / a10 };
  const res = { gas, amb: ctx.amb, T0, p0, V0, a0: ctx.a0, S, warn, scram: { T3, p3, M3, V3, T4, p4, M4, V4, T10, V10 } };
  return finishPerf(P, res, [{ id: '10', m: 1 + f, nz }], f, 0, 1);
}

// Solve for fan pressure ratio that makes pt13 = pt5 (mixed-flow turbofan)
export function matchFanPR(P) {
  let lo = 1.05, hi = Math.min(P.piC * 0.95, 6);
  const g = pf => { const r = runCycle({ ...P, piF: pf, mixed: true, ab: false }); return r.mixMismatch; };
  let glo = g(lo), ghi = g(hi);
  if (glo * ghi > 0) return NaN;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2, gm = g(m); if (gm * glo > 0) { lo = m; glo = gm; } else hi = m; }
  return (lo + hi) / 2;
}

// Sweep one parameter. key: 'M0' | 'alt' | 'piC' | 'Tt4' | 'bpr' | 'piF' | 'psi' | 'phi' | 'x'
export function sweep(P, key, values) {
  return values.map(v => {
    let Q = { ...P };
    if (key === 'nRamps') Q.inlet = { ...P.inlet, nRamps: v };
    else Q[key] = v;
    if (key === 'x') Q.autoX = false;
    try { const r = runCycle(Q); return { v, r, ok: isFinite(r.perf.Fs) && r.perf.valid }; } catch (e) { return { v, ok: false }; }
  });
}
