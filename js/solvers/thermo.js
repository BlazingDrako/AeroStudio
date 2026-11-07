// Ideal-gas thermochemistry and chemical equilibrium, following the NASA CEA method
// (Gordon & McBride, NASA RP-1311, 1994): minimize Gibbs energy with element-potential
// Newton iterations for TP, HP and SP problems, plus the CEA rocket problem
// (infinite-area combustor, equilibrium or frozen expansion).
import { SPECIES } from './thermoData.js';
export { SPECIES };

export const Ru = 8.314462618;       // J/mol/K
export const P_REF = 1e5;            // Pa (standard state, 1 bar)
export const G0 = 9.80665;
export const ATOMIC = { H: 1.00794e-3, C: 12.0107e-3, N: 14.0067e-3, O: 15.9994e-3, Ar: 39.948e-3, He: 4.002602e-3 }; // kg/mol

// ---------- species properties (nondimensional) ----------
const coef = (sp, T) => { const r = sp.T; return sp.a.length === 1 || T < r[1] ? sp.a[0] : sp.a[1]; };
export function cpR(sp, T) { const a = coef(sp, T); return a[0] + T * (a[1] + T * (a[2] + T * (a[3] + T * a[4]))); }
export function hRT(sp, T) { const a = coef(sp, T); return a[0] + T * (a[1] / 2 + T * (a[2] / 3 + T * (a[3] / 4 + T * a[4] / 5))) + a[5] / T; }
export function sR(sp, T) { const a = coef(sp, T); return a[0] * Math.log(T) + T * (a[1] + T * (a[2] / 2 + T * (a[3] / 3 + T * a[4] / 4))) + a[6]; }
export function molarMass(el) { let m = 0; for (const k in el) m += el[k] * ATOMIC[k]; return m; }
for (const [k, sp] of Object.entries(SPECIES)) { sp.name = k; sp.W = molarMass(sp.el); }
export const spH = (name, T) => hRT(SPECIES[name], T) * Ru * T; // J/mol

// Combustion products considered in equilibrium (gas phase, C/H/O/N/Ar/He systems).
export const PRODUCTS = ['N2', 'O2', 'Ar', 'He', 'H2O', 'CO2', 'CO', 'H2', 'OH', 'H', 'O', 'N', 'NO', 'NO2', 'N2O', 'HO2', 'H2O2',
  'NH3', 'NH2', 'NH', 'HNO', 'HCO', 'HCN', 'CN', 'CH4', 'CH3', 'C2H2,acetylene', 'C'].map(n => SPECIES[n]);
export const displayName = n => n.replace(',acetylene', '').replace(/(\d+)/g, m => m.split('').map(d => '₀₁₂₃₄₅₆₇₈₉'[d]).join(''));

// ---------- reactant library ----------
// state: 'g' uses the polynomial at the given T; 'l' uses the assigned enthalpy at its boiling/storage T (CEA thermo.inp values).
export const REACTANTS = {
  'H2': { label: 'H₂ (gas)', el: { H: 2 }, gas: 'H2', T: 298.15, kind: 'fuel' },
  'H2(L)': { label: 'LH₂ (liquid, 20 K)', el: { H: 2 }, hf: -9012, T: 20.27, kind: 'fuel' },
  'CH4': { label: 'CH₄ methane (gas)', el: { C: 1, H: 4 }, gas: 'CH4', T: 298.15, kind: 'fuel' },
  'CH4(L)': { label: 'LCH₄ (liquid, 112 K)', el: { C: 1, H: 4 }, hf: -89233, T: 111.64, kind: 'fuel' },
  'C3H8': { label: 'C₃H₈ propane (gas)', el: { C: 3, H: 8 }, gas: 'C3H8', T: 298.15, kind: 'fuel' },
  'C2H4': { label: 'C₂H₄ ethylene (gas)', el: { C: 2, H: 4 }, gas: 'C2H4', T: 298.15, kind: 'fuel' },
  'Jet-A(L)': { label: 'Jet-A / Jet A-1 (liquid)', el: { C: 12, H: 23 }, hf: -303403.2, T: 298.15, kind: 'fuel' },
  'Jet-A(g)': { label: 'Jet-A (vapor)', el: { C: 12, H: 23 }, gas: 'Jet-A(g)', T: 298.15, kind: 'fuel' },
  'RP-1': { label: 'RP-1 kerosene (liquid)', el: { C: 1, H: 1.9423 }, hf: -24717.7, T: 298.15, kind: 'fuel' },
  'C8H18': { label: 'n-octane (gas)', el: { C: 8, H: 18 }, gas: 'C8H18,n-octane', T: 298.15, kind: 'fuel' },
  'C2H5OH(L)': { label: 'Ethanol (liquid)', el: { C: 2, H: 6, O: 1 }, hf: -277510, T: 298.15, kind: 'fuel' },
  'N2H4(L)': { label: 'Hydrazine N₂H₄ (liquid)', el: { N: 2, H: 4 }, hf: 50630, T: 298.15, kind: 'fuel' },
  'MMH(L)': { label: 'MMH CH₃NHNH₂ (liquid)', el: { C: 1, H: 6, N: 2 }, hf: 54200, T: 298.15, kind: 'fuel' },
  'UDMH(L)': { label: 'UDMH (liquid)', el: { C: 2, H: 8, N: 2 }, hf: 48900, T: 298.15, kind: 'fuel' },
  'Air': { label: 'Air (gas)', mix: { N2: 0.78084, O2: 0.209476, Ar: 0.009365, CO2: 0.000319 }, T: 298.15, kind: 'ox' },
  'O2': { label: 'O₂ (gas)', el: { O: 2 }, gas: 'O2', T: 298.15, kind: 'ox' },
  'O2(L)': { label: 'LOX (liquid, 90 K)', el: { O: 2 }, hf: -12979, T: 90.17, kind: 'ox' },
  'N2O4(L)': { label: 'N₂O₄ (liquid)', el: { N: 2, O: 4 }, hf: -19564, T: 298.15, kind: 'ox' },
  'N2O': { label: 'N₂O nitrous oxide (gas)', el: { N: 2, O: 1 }, gas: 'N2O', T: 298.15, kind: 'ox' },
  'H2O2(L)': { label: 'H₂O₂ (liquid, 100%)', el: { H: 2, O: 2 }, hf: -187780, T: 298.15, kind: 'ox' },
};

// Elements and enthalpy of one mole of a reactant (for 'mix', one mole of mixture).
export function reactantProps(id, T) {
  const r = REACTANTS[id];
  if (r.mix) {
    const el = {}; let h = 0, W = 0;
    for (const [s, x] of Object.entries(r.mix)) {
      const sp = SPECIES[s]; W += x * sp.W; h += x * spH(s, T ?? r.T);
      for (const [e, c] of Object.entries(sp.el)) el[e] = (el[e] || 0) + x * c;
    }
    return { el, h, W };
  }
  const W = molarMass(r.el);
  const h = r.gas ? spH(r.gas, T ?? r.T) : r.hf;
  return { el: r.el, h, W };
}

// Build a reactant mixture: items [{id, mass, T}] -> element moles per kg (b0) and enthalpy per kg (h0)
export function mixReactants(items) {
  const b0 = {}; let h0 = 0, mt = 0;
  for (const it of items) mt += it.mass;
  for (const it of items) {
    const p = reactantProps(it.id, it.T), nmol = it.mass / mt / p.W;
    h0 += nmol * p.h;
    for (const [e, c] of Object.entries(p.el)) b0[e] = (b0[e] || 0) + nmol * c;
  }
  return { b0, h0 };
}

// Stoichiometric oxidizer/fuel mass ratio: oxygen balance with products CO2, H2O, N2 (oxidizer may carry H or C, e.g. H2O2).
export function stoichOF(fuelId, oxId) {
  const f = reactantProps(fuelId), o = reactantProps(oxId);
  const val = el => 4 * (el.C || 0) + (el.H || 0) - 2 * (el.O || 0); // electrons needed (+) / supplied (−)
  const vf = val(f.el), vo = val(o.el);
  if (!(vo < 0) || !(vf > 0)) return NaN;
  return (vf / -vo) * o.W / f.W;
}

// Lower heating value (J/kg fuel) at 298.15 K: complete combustion to CO2 + H2O(g) (+ N2).
export function lowerHeatingValue(fuelId) {
  const f = reactantProps(fuelId), el = f.el;
  const nO2 = (el.C || 0) + (el.H || 0) / 4 - (el.O || 0) / 2;
  const T = 298.15;
  const hp = (el.C || 0) * spH('CO2', T) + (el.H || 0) / 2 * spH('H2O', T) + (el.N || 0) / 2 * spH('N2', T);
  return (f.h + nO2 * spH('O2', T) - hp) / f.W;
}

// ---------- linear solve (small dense, partial pivoting) ----------
function gauss(A, b) {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c, m = Math.abs(A[c][c]);
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > m) { m = Math.abs(A[r][c]); p = r; }
    if (m < 1e-300) return null;
    if (p !== c) { [A[p], A[c]] = [A[c], A[p]]; [b[p], b[c]] = [b[c], b[p]]; }
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c]; if (!f) continue;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) { let s = b[r]; for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k]; x[r] = s / A[r][r]; }
  return x;
}

// ---------- equilibrium system ----------
// A System fixes the element totals and the candidate species list.
export class System {
  constructor(b0, species = PRODUCTS) {
    const els = Object.keys(b0).filter(e => b0[e] > 1e-12);
    this.els = els;
    this.b0 = els.map(e => b0[e]);
    this.sp = species.filter(s => Object.keys(s.el).every(e => els.includes(e)));
    this.a = this.sp.map(s => els.map(e => s.el[e] || 0)); // a[j][i]
    this.ns = this.sp.length;
  }
  // initial guess: CEA uses equal moles; per kg ~ 0.1 mol/g
  guess() { const n = 1 / 0.03; return { lnn: Math.log(n), lnnj: new Float64Array(this.ns).fill(Math.log(n / this.ns)), T: 3800 }; }
}

// Solve equilibrium. prob: 'TP' {T,P} | 'HP' {h (J/kg), P} | 'SP' {s (J/kg/K), P}. Optional warm start `init` (a previous result).
export function equilibrate(sys, prob, opts) {
  const { P } = opts, NE = sys.els.length, NS = sys.ns, a = sys.a, sp = sys.sp;
  const st = opts.init && opts.init.sys === sys ? { lnn: opts.init.lnn, lnnj: Float64Array.from(opts.init.lnnj), T: opts.init.T } : sys.guess();
  let T = prob === 'TP' ? opts.T : (opts.T0 ?? (opts.init && opts.init.sys === sys ? opts.init.T : 3800));
  let lnn = st.lnn; const lnnj = st.lnnj;
  const lnP = Math.log(P / P_REF);
  const H = new Float64Array(NS), S0 = new Float64Array(NS), Cp = new Float64Array(NS), Gj = new Float64Array(NS), nj = new Float64Array(NS), Sj = new Float64Array(NS);
  const varT = prob !== 'TP';
  const N = NE + 1 + (varT ? 1 : 0);
  let converged = false, it = 0;
  for (it = 0; it < 300; it++) {
    const n = Math.exp(lnn);
    let sumN = 0;
    for (let j = 0; j < NS; j++) {
      nj[j] = Math.exp(lnnj[j]); sumN += nj[j];
      H[j] = hRT(sp[j], T); S0[j] = sR(sp[j], T); Cp[j] = cpR(sp[j], T);
      const lnx = lnnj[j] - lnn;
      Gj[j] = H[j] - S0[j] + lnx + lnP;
      Sj[j] = S0[j] - lnx - lnP;
    }
    const A = Array.from({ length: N }, () => new Float64Array(N)), r = new Float64Array(N);
    for (let i = 0; i < NE; i++) {
      let bi = 0;
      for (let j = 0; j < NS; j++) {
        const aij = a[j][i]; if (!aij) continue;
        const w = aij * nj[j];
        for (let k = 0; k < NE; k++) if (a[j][k]) A[i][k] += a[j][k] * w;
        A[i][NE] += w; bi += w;
        if (varT) A[i][NE + 1] += w * H[j];
        r[i] += w * Gj[j];
      }
      r[i] += sys.b0[i] - bi;
      A[NE][i] = bi;
    }
    let sNH = 0, sNG = 0, sNHG = 0, sNCp = 0, sNH2 = 0, sNS = 0, sNSG = 0, sNHS = 0, h = 0, s = 0;
    for (let j = 0; j < NS; j++) {
      sNH += nj[j] * H[j]; sNG += nj[j] * Gj[j]; sNHG += nj[j] * H[j] * Gj[j]; sNCp += nj[j] * Cp[j]; sNH2 += nj[j] * H[j] * H[j];
      sNS += nj[j] * Sj[j]; sNSG += nj[j] * Sj[j] * Gj[j]; sNHS += nj[j] * H[j] * Sj[j];
    }
    A[NE][NE] = sumN - n; r[NE] = n - sumN + sNG;
    if (varT) {
      A[NE][NE + 1] = sNH;
      const row = NE + 1;
      if (prob === 'HP') {
        for (let i = 0; i < NE; i++) { let v = 0; for (let j = 0; j < NS; j++) if (a[j][i]) v += a[j][i] * nj[j] * H[j]; A[row][i] = v; }
        A[row][NE] = sNH; A[row][NE + 1] = sNCp + sNH2;
        r[row] = opts.h / (Ru * T) - sNH + sNHG;
      } else {
        for (let i = 0; i < NE; i++) { let v = 0; for (let j = 0; j < NS; j++) if (a[j][i]) v += a[j][i] * nj[j] * Sj[j]; A[row][i] = v; }
        A[row][NE] = sNS; A[row][NE + 1] = sNCp + sNHS;
        r[row] = opts.s / Ru - sNS + n - sumN + sNSG;
      }
    }
    const x = gauss(A, Array.from(r));
    if (!x) break;
    const dlnn = x[NE], dlnT = varT ? x[NE + 1] : 0;
    const dj = new Float64Array(NS);
    let big = Math.max(5 * Math.abs(dlnT), 5 * Math.abs(dlnn)), lam2 = 1;
    for (let j = 0; j < NS; j++) {
      let v = -Gj[j] + dlnn + H[j] * dlnT;
      for (let i = 0; i < NE; i++) v += a[j][i] * x[i];
      dj[j] = v;
      const lnx = lnnj[j] - lnn;
      if (lnx > -18.420681) { if (v > 0) big = Math.max(big, Math.abs(v)); }
      else if (v - dlnn > 0) lam2 = Math.min(lam2, Math.abs((-lnx - 9.2103404) / (v - dlnn)));
    }
    let lam = Math.min(1, big > 2 ? 2 / big : 1, lam2);
    let errN = 0;
    for (let j = 0; j < NS; j++) { lnnj[j] += lam * dj[j]; errN += nj[j] * Math.abs(dj[j]); }
    lnn += lam * dlnn;
    // keep trace species from underflowing
    for (let j = 0; j < NS; j++) if (lnnj[j] - lnn < -70) lnnj[j] = lnn - 70;
    if (varT) T = Math.min(6000, Math.max(160, T * Math.exp(lam * dlnT)));
    if (errN / sumN < 0.5e-5 && Math.abs(dlnn) < 0.5e-5 && Math.abs(dlnT) < 1e-4 && it > 0) { converged = true; break; }
  }
  return finish(sys, T, P, lnn, lnnj, converged, it);
}

function finish(sys, T, P, lnn, lnnj, converged, iters) {
  const NS = sys.ns, sp = sys.sp, n = new Float64Array(NS);
  let nt = 0, h = 0, s = 0, cp = 0;
  for (let j = 0; j < NS; j++) { n[j] = Math.exp(lnnj[j]); nt += n[j]; }
  const lnP = Math.log(P / P_REF);
  for (let j = 0; j < NS; j++) {
    const x = n[j] / nt;
    h += n[j] * hRT(sp[j], T) * Ru * T;
    cp += n[j] * cpR(sp[j], T) * Ru;
    s += n[j] * (sR(sp[j], T) - (x > 0 ? Math.log(x) : 0) - lnP) * Ru;
  }
  const W = 1 / nt;            // kg/mol
  const R = Ru * nt;           // J/kg/K
  const rho = P / (R * T);
  const gf = cp / (cp - R);
  return { sys, T, P, n, nt, lnn: Math.log(nt), lnnj: Float64Array.from(lnnj), h, s, cp, R, W, rho, gammaFrozen: gf, aFrozen: Math.sqrt(gf * R * T), converged, iters };
}

// Equilibrium derivatives by finite differences: cp_eq, gamma_s and sound speed.
export function eqDerivs(st) {
  const sys = st.sys, e = 1e-4;
  const a = equilibrate(sys, 'TP', { T: st.T * (1 + e), P: st.P, init: st }), b = equilibrate(sys, 'TP', { T: st.T * (1 - e), P: st.P, init: st });
  const cpEq = (a.h - b.h) / (2 * e * st.T);
  const p1 = equilibrate(sys, 'SP', { s: st.s, P: st.P * (1 + e), init: st }), p2 = equilibrate(sys, 'SP', { s: st.s, P: st.P * (1 - e), init: st });
  const gs = Math.log((1 + e) / (1 - e)) / Math.log(p1.rho / p2.rho);
  return { cpEq, gammaS: gs, a: Math.sqrt(gs * st.P / st.rho) };
}

export function moleFractions(st, min = 5e-6) {
  const out = [];
  for (let j = 0; j < st.sys.ns; j++) { const x = st.n[j] / st.nt; if (x >= min) out.push({ name: st.sys.sp[j].name, x }); }
  return out.sort((p, q) => q.x - p.x);
}

// ---------- frozen-composition mixture (used for frozen expansion and in cycle analysis) ----------
export class FrozenMix {
  constructor(sp, n) { this.sp = sp; this.n = Float64Array.from(n); let nt = 0; for (const v of n) nt += v; this.nt = nt; this.R = Ru * nt; this.W = 1 / nt; }
  h(T) { let v = 0; for (let j = 0; j < this.sp.length; j++) if (this.n[j]) v += this.n[j] * hRT(this.sp[j], T); return v * Ru * T; }
  cp(T) { let v = 0; for (let j = 0; j < this.sp.length; j++) if (this.n[j]) v += this.n[j] * cpR(this.sp[j], T); return v * Ru; }
  s(T, P) {
    let v = 0; const lnP = Math.log(P / P_REF);
    for (let j = 0; j < this.sp.length; j++) { const nj = this.n[j]; if (nj > 0) v += nj * (sR(this.sp[j], T) - Math.log(nj / this.nt) - lnP); }
    return v * Ru;
  }
  gamma(T) { const c = this.cp(T); return c / (c - this.R); }
  T_h(h, T = 1000) { for (let i = 0; i < 60; i++) { const d = (this.h(T) - h) / this.cp(T); T -= d; T = Math.max(50, Math.min(7000, T)); if (Math.abs(d) < 1e-7 * T) break; } return T; }
  T_sp(s, P, T = 1000) { for (let i = 0; i < 60; i++) { const d = (this.s(T, P) - s) / (this.cp(T) / T); T *= Math.exp(-d / this.cp(T)); T = Math.max(50, Math.min(7000, T)); if (Math.abs(d) < 1e-9 * this.cp(T)) break; } return T; }
}
export const frozenOf = st => new FrozenMix(st.sys.sp, st.n);

// ---------- rocket problem (CEA "rocket", infinite-area combustor) ----------
// opts: {reactants:[{id,mass,T}], Pc (Pa), pcpe | eps (supersonic area ratio), frozen: bool, pa (Pa)}
export function rocket(opts) {
  const { b0, h0 } = mixReactants(opts.reactants);
  const sys = new System(b0);
  const ch = equilibrate(sys, 'HP', { h: h0, P: opts.Pc });
  const s = ch.s;
  const mix = frozenOf(ch);
  const stateAt = (P, init) => {
    if (opts.frozen) {
      const T = mix.T_sp(s, P, init ? init.T : ch.T * 0.8);
      const R = mix.R, cp = mix.cp(T), g = cp / (cp - R), rho = P / (R * T);
      return { T, P, h: mix.h(T), s, rho, R, W: mix.W, cp, gamma: g, a: Math.sqrt(g * R * T), comp: ch, frozen: true };
    }
    const e = equilibrate(sys, 'SP', { s, P, init: init && init.eq ? init.eq : ch });
    const d = eqDerivs(e);
    return { T: e.T, P, h: e.h, s, rho: e.rho, R: e.R, W: e.W, cp: d.cpEq, gamma: d.gammaS, a: d.a, eq: e, comp: e };
  };
  const vel = st => Math.sqrt(Math.max(0, 2 * (h0 - st.h)));
  // chamber derivatives
  const chD = eqDerivs(ch);
  const chamber = { T: ch.T, P: ch.P, h: ch.h, s, rho: ch.rho, R: ch.R, W: ch.W, cp: opts.frozen ? mix.cp(ch.T) : chD.cpEq, gamma: opts.frozen ? ch.gammaFrozen : chD.gammaS, a: opts.frozen ? ch.aFrozen : chD.a, comp: ch, u: 0, M: 0 };
  // throat: u = a. Secant on ln P.
  let g = chamber.gamma, lp1 = Math.log(opts.Pc / ((g + 1) / 2) ** (g / (g - 1)));
  let f = lp => { const st = stateAt(Math.exp(lp), last); last = st; const u = vel(st); return { r: (u * u - st.a * st.a) / (st.a * st.a), st }; };
  let last = null;
  let A = f(lp1), lp0 = lp1 + 0.02, B = f(lp0);
  for (let i = 0; i < 30 && Math.abs(A.r) > 1e-7; i++) {
    const lp = lp1 - A.r * (lp1 - lp0) / (A.r - B.r);
    lp0 = lp1; B = A; lp1 = lp; A = f(lp);
  }
  const th = A.st; th.u = vel(th); th.M = th.u / th.a;
  const Gt = th.rho * th.u;
  // exit
  let ex;
  if (opts.eps) {
    let lo = Math.log(th.P) - 1e-6, hi = Math.log(th.P) - 25, prev = th; // ln P range, supersonic branch
    for (let i = 0; i < 70; i++) {
      const mid = (lo + hi) / 2, st = stateAt(Math.exp(mid), prev); prev = st;
      const ar = Gt / (st.rho * vel(st));
      if (ar < opts.eps) lo = mid; else hi = mid;
      ex = st; if (Math.abs(ar / opts.eps - 1) < 1e-9) break;
    }
  } else ex = stateAt(opts.Pc / opts.pcpe, th);
  ex.u = vel(ex); ex.M = ex.u / ex.a;
  const eps = Gt / (ex.rho * ex.u);
  const cstar = opts.Pc / Gt;
  const pa = opts.pa ?? 0;
  const Ivac = ex.u + ex.P / (ex.rho * ex.u);
  const Isp = ex.u + (ex.P - pa) / (ex.rho * ex.u);
  const out = st => ({ ...st, eps: st === chamber ? NaN : Gt / (st.rho * st.u) });
  return {
    chamber: out(chamber), throat: { ...th, eps: 1 }, exit: { ...ex, eps }, cstar, eps,
    CFvac: Ivac / cstar, CF: Isp / cstar, Ivac, Isp, h0, b0, converged: ch.converged,
  };
}

// Adiabatic flame (HP) or fixed-T (TP) problem for a reactant mixture.
export function flame({ reactants, P, T, prob = 'HP', init }) {
  const { b0, h0 } = mixReactants(reactants);
  const sys = init && sameB(init.sys, b0) ? init.sys : new System(b0);
  const st = prob === 'TP' ? equilibrate(sys, 'TP', { T, P, init }) : equilibrate(sys, 'HP', { h: h0, P, init });
  const d = eqDerivs(st);
  return { ...st, cpEq: d.cpEq, gammaS: d.gammaS, aEq: d.a, h0, b0 };
}
function sameB(sys, b0) { return sys && Object.keys(b0).filter(e => b0[e] > 1e-12).every((e, i) => sys.els[i] === e && Math.abs(sys.b0[i] - b0[e]) < 1e-14); }
