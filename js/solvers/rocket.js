// Liquid rocket engine design (no DOM): sizing from a thrust requirement, chamber and nozzle contour,
// equilibrium (or frozen) flow along the nozzle, performance vs ambient pressure with flow separation,
// the exhaust plume shape, and convective heat flux to the wall (Bartz).
// Chemistry comes from thermo.js (NASA CEA method, infinite-area combustor).
import * as TH from './thermo.js';
import { raoAngles, isen, M_from_A, M_from_p, betaFromPressure, obliqueShock, thetaMax, DEG } from './gasdyn.js';
import { atmosphere } from './atmosphere.js';

export const G0 = 9.80665;
const SIGMA_SB = 5.670374e-8;

// Liquid propellant data: density at storage temperature (kg/m³), normal boiling point (K), liquid heat capacity
// for regenerative cooling (J/kg·K; LH₂ uses a supercritical average), and the bulk-temperature limit for cooling.
export const PROPS = {
  'H2(L)': { rho: 70.8, Tb: 20.3, cp: 14000, Tmax: 300, note: 'deep cryogenic; superb coolant' },
  'O2(L)': { rho: 1141, Tb: 90.2, cp: 1700, Tmax: 150, note: 'cryogenic oxidizer' },
  'CH4(L)': { rho: 422.6, Tb: 111.6, cp: 3480, Tmax: 500, note: 'mild cryogenic; does not coke' },
  'RP-1': { rho: 810, Tb: 490, cp: 2010, Tmax: 560, note: 'storable; cokes above ~560 K' },
  'C2H5OH(L)': { rho: 789, Tb: 351.4, cp: 2440, Tmax: 420, note: 'storable' },
  'Jet-A(L)': { rho: 800, Tb: 450, cp: 2000, Tmax: 540, note: 'storable' },
  'N2O4(L)': { rho: 1440, Tb: 294.3, cp: 1550, Tmax: 320, note: 'storable oxidizer, hypergolic' },
  'MMH(L)': { rho: 875, Tb: 360.6, cp: 2930, Tmax: 400, note: 'storable, hypergolic' },
  'UDMH(L)': { rho: 791, Tb: 336, cp: 2730, Tmax: 380, note: 'storable, hypergolic' },
  'N2H4(L)': { rho: 1004, Tb: 387, cp: 3080, Tmax: 420, note: 'storable, hypergolic' },
  'H2O2(L)': { rho: 1450, Tb: 423, cp: 2620, Tmax: 400, note: 'storable, decomposes on a catalyst' },
};
export const FUELS = ['H2(L)', 'CH4(L)', 'RP-1', 'C2H5OH(L)', 'Jet-A(L)', 'MMH(L)', 'UDMH(L)', 'N2H4(L)'];
export const OXIDIZERS = ['O2(L)', 'N2O4(L)', 'H2O2(L)'];

// Propellant combinations for comparison: typical mixture ratio, sweep range, characteristic length L* (m)
export const COMBOS = [
  { id: 'loxlh2', fuel: 'H2(L)', ox: 'O2(L)', of: 6.0, range: [2.5, 9], Lstar: 0.9, label: 'LOX / LH₂', use: 'Upper stages and core stages (RS-25, RL10, Vulcain)' },
  { id: 'loxch4', fuel: 'CH4(L)', ox: 'O2(L)', of: 3.6, range: [2, 5], Lstar: 1.0, label: 'LOX / LCH₄', use: 'Reusable boosters (Raptor, BE-4)' },
  { id: 'loxrp1', fuel: 'RP-1', ox: 'O2(L)', of: 2.6, range: [1.5, 3.6], Lstar: 1.1, label: 'LOX / RP-1', use: 'Boosters (Merlin, F-1, RD-180)' },
  { id: 'loxeth', fuel: 'C2H5OH(L)', ox: 'O2(L)', of: 1.5, range: [0.8, 2.6], Lstar: 1.1, label: 'LOX / ethanol', use: 'Early rockets (V-2, Redstone used diluted ethanol)' },
  { id: 'ntommh', fuel: 'MMH(L)', ox: 'N2O4(L)', of: 1.65, range: [0.9, 3], Lstar: 0.8, label: 'N₂O₄ / MMH', use: 'Spacecraft and orbital manoeuvring (AJ10, Draco)' },
  { id: 'ntoudmh', fuel: 'UDMH(L)', ox: 'N2O4(L)', of: 2.1, range: [1.1, 3.6], Lstar: 0.8, label: 'N₂O₄ / UDMH', use: 'Storable boosters (Proton RD-275, Long March YF-20)' },
  { id: 'ntohz', fuel: 'N2H4(L)', ox: 'N2O4(L)', of: 1.25, range: [0.7, 2.2], Lstar: 0.8, label: 'N₂O₄ / N₂H₄', use: 'Storable (Titan used a 50/50 hydrazine–UDMH blend)' },
  { id: 'htprp1', fuel: 'RP-1', ox: 'H2O2(L)', of: 7.0, range: [4, 10], Lstar: 1.3, label: 'H₂O₂ / RP-1', use: 'Non-toxic storable (Gamma, modern small launchers)' },
];
export const comboOf = (fuel, ox) => COMBOS.find(c => c.fuel === fuel && c.ox === ox);

// Real engines for comparison. pub: published thrust (kN) and Isp (s), approximate; cycle as flown.
export const ENGINES = [
  { id: 'merlin', name: 'Merlin 1D (sea level)', fuel: 'RP-1', ox: 'O2(L)', of: 2.36, Pc: 97, eps: 16, F: 845, at: 'sl', cycle: 'gg', gg: 0.03, nozzle: 'bell', pub: { Fsl: 845, Fvac: 914, Isl: 282, Ivac: 311 } },
  { id: 'mvac', name: 'Merlin 1D Vacuum', fuel: 'RP-1', ox: 'O2(L)', of: 2.36, Pc: 97, eps: 165, F: 981, at: 'vac', cycle: 'gg', gg: 0.03, nozzle: 'bell', pub: { Fvac: 981, Ivac: 348 } },
  { id: 'f1', name: 'F-1 (Saturn V first stage)', fuel: 'RP-1', ox: 'O2(L)', of: 2.27, Pc: 70, eps: 16, F: 6770, at: 'sl', cycle: 'gg', gg: 0.03, nozzle: 'bell', pub: { Fsl: 6770, Fvac: 7770, Isl: 263, Ivac: 304 } },
  { id: 'rd180', name: 'RD-180 (one chamber of two)', fuel: 'RP-1', ox: 'O2(L)', of: 2.72, Pc: 261, eps: 36.9, F: 1915, at: 'sl', cycle: 'staged', nozzle: 'bell', pub: { Fsl: 1915, Fvac: 2075, Isl: 311, Ivac: 338 } },
  { id: 'rs25', name: 'RS-25 (Space Shuttle main engine)', fuel: 'H2(L)', ox: 'O2(L)', of: 6.03, Pc: 206, eps: 69, F: 2279, at: 'vac', cycle: 'staged', nozzle: 'bell', pub: { Fsl: 1860, Fvac: 2279, Isl: 366, Ivac: 452 } },
  { id: 'rl10', name: 'RL10B-2 (upper stage)', fuel: 'H2(L)', ox: 'O2(L)', of: 5.88, Pc: 44, eps: 280, F: 110, at: 'vac', cycle: 'expander', nozzle: 'bell', pub: { Fvac: 110, Ivac: 465.5 } },
  { id: 'raptor', name: 'Raptor 2 (sea level)', fuel: 'CH4(L)', ox: 'O2(L)', of: 3.6, Pc: 300, eps: 34, F: 2256, at: 'sl', cycle: 'ffsc', nozzle: 'bell', pub: { Fsl: 2256, Isl: 327, Ivac: 347 } },
  { id: 'aj10', name: 'AJ10-190 (Shuttle OMS)', fuel: 'MMH(L)', ox: 'N2O4(L)', of: 1.65, Pc: 8.6, eps: 55, F: 26.7, at: 'vac', cycle: 'pressure', nozzle: 'bell', pub: { Fvac: 26.7, Ivac: 316 } },
];

export const CYCLES = {
  pressure: 'Pressure-fed', gg: 'Gas generator (open)', staged: 'Staged combustion', ffsc: 'Full-flow staged combustion', expander: 'Expander', electric: 'Electric pump',
};

export function defaults() {
  return { fuel: 'RP-1', ox: 'O2(L)', of: 2.36, Pc: 97, eps: 16, F: 845, at: 'sl', nozzle: 'bell', half: 15, frozen: false,
    Lstar: 1.1, autoCont: true, contraction: 3, etaC: 0.98, etaN: 0.985, cycle: 'gg', gg: 0.03, alt: 0, sepModel: 'kb', sep: 0.4, preset: 'merlin' };
}

export function reactantsFor(fuel, ox, of) { return [{ id: fuel, mass: 1 }, { id: ox, mass: of }]; }

// Bulk density of the propellant load at mixture ratio O/F (both tanks, kg/m³)
export function bulkDensity(fuel, ox, of) {
  const rf = PROPS[fuel]?.rho, ro = PROPS[ox]?.rho;
  return (1 + of) / (of / ro + 1 / rf);
}

// Huzel & Huang correlation for contraction ratio vs throat size (Dt in cm)
export const autoContraction = Dt => 8.0 * (Dt * 100) ** -0.6 + 1.25;

// Combustion-gas viscosity (Pa·s) from the Bartz empirical fit, molar mass W in g/mol, T in K
export const gasViscosity = (W, T) => 1.184e-7 * W ** 0.5 * T ** 0.6;
// Eucken estimate of Prandtl number from the frozen γ
export const prandtl = g => 4 * g / (9 * g - 5);

// ---------- isentropic expansion table ----------
// States from the chamber to past the exit along the isentrope, with area ratio A/At from mass conservation.
// Subsonic branch (chamber → throat) and supersonic branch (throat → pMin). Uses the CEA solver directly.
export function expansionTable({ reactants, Pc, frozen = false, Pt, Gt, pMin, nSub = 28, nSup = 64 }) {
  const { b0, h0 } = TH.mixReactants(reactants);
  const sys = new TH.System(b0);
  const ch = TH.equilibrate(sys, 'HP', { h: h0, P: Pc });
  const s = ch.s, mix = TH.frozenOf(ch);
  let prev = ch;
  const at = P => {
    if (frozen) {
      const T = mix.T_sp(s, P, prev.T), cp = mix.cp(T), R = mix.R;
      const st = { T, P, h: mix.h(T), rho: P / (R * T), W: mix.W, cpf: cp, gf: cp / (cp - R), comp: ch };
      prev = st; return st;
    }
    const e = TH.equilibrate(sys, 'SP', { s, P, init: prev.sys ? prev : ch });
    prev = e;
    return { T: e.T, P, h: e.h, rho: e.rho, W: e.W, cpf: e.cp, gf: e.gammaFrozen, comp: e, eq: e };
  };
  const rows = [];
  for (let k = 0; k <= nSub; k++) {
    const t = (k / nSub) ** 1.7; // dense near the chamber, where the area ratio changes fastest
    const P = Pc - (Pc - Pt) * Math.max(1e-5, t);
    rows.push({ ...at(P), branch: k === nSub ? 'throat' : 'sub' });
  }
  for (let k = 1; k <= nSup; k++) {
    const P = Math.exp(Math.log(Pt) + (Math.log(pMin) - Math.log(Pt)) * k / nSup);
    rows.push({ ...at(P), branch: 'sup' });
  }
  for (const r of rows) { r.u = Math.sqrt(Math.max(0, 2 * (h0 - r.h))); r.eps = Gt / (r.rho * r.u); }
  // sound speed along the isentrope: a² = dP/dρ (central differences on the table)
  for (let i = 0; i < rows.length; i++) {
    const a = rows[Math.max(0, i - 1)], b = rows[Math.min(rows.length - 1, i + 1)];
    rows[i].a = Math.sqrt((b.P - a.P) / (b.rho - a.rho));
    rows[i].M = rows[i].u / rows[i].a;
  }
  return { rows, ch, h0, s, sub: rows.filter(r => r.branch !== 'sup'), sup: rows.filter(r => r.branch !== 'sub') };
}

// Interpolate a table branch by area ratio (log). branch rows must be monotonic in eps.
function byEps(branch, eps, keys) {
  const n = branch.length, le = Math.log(Math.max(1, eps));
  // subsonic branch: eps decreasing toward the throat; supersonic: increasing
  const lv = i => Math.log(Math.max(1, branch[i].eps));
  const inc = lv(n - 1) > lv(0);
  let lo = 0, hi = n - 1;
  if (inc ? le <= lv(0) : le >= lv(0)) return pick(branch[0], branch[0], 0, keys);
  if (inc ? le >= lv(n - 1) : le <= lv(n - 1)) return pick(branch[n - 1], branch[n - 1], 0, keys);
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if ((lv(m) < le) === inc) lo = m; else hi = m; }
  const t = (le - lv(lo)) / (lv(hi) - lv(lo) || 1);
  return pick(branch[lo], branch[hi], t, keys);
}
function byP(branch, P, keys) {
  const n = branch.length, lp = Math.log(P);
  let lo = 0, hi = n - 1;
  if (lp >= Math.log(branch[0].P)) return pick(branch[0], branch[0], 0, keys);
  if (lp <= Math.log(branch[n - 1].P)) return pick(branch[n - 1], branch[n - 1], 0, keys);
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (Math.log(branch[m].P) > lp) lo = m; else hi = m; }
  const t = (lp - Math.log(branch[lo].P)) / (Math.log(branch[hi].P) - Math.log(branch[lo].P) || 1);
  return pick(branch[lo], branch[hi], t, keys);
}
const KEYS = ['P', 'T', 'rho', 'u', 'a', 'M', 'eps', 'W', 'cpf', 'gf'];
function pick(a, b, t, keys = KEYS) { const o = {}; for (const k of keys) o[k] = a[k] + t * (b[k] - a[k]); o.comp = t < 0.5 ? a.comp : b.comp; return o; }

// ---------- chamber + nozzle contour ----------
// Dimensions in metres, throat at x = 0. Chamber: cylinder, fillet R2, 30° cone, upstream throat arc 1.5 Rt.
// Divergent: arc 0.382 Rt then an 80% Rao bell (parabola) or a straight cone.
export function contour({ Rt, eps, contraction, nozzle = 'bell', half = 15, Lstar = 1, conv = 30 }) {
  const Rc = Rt * Math.sqrt(contraction), Re = Rt * Math.sqrt(eps);
  const th = conv * DEG, R1 = 1.5 * Rt;
  let R2 = Math.min(1.0 * Rc, 2.5 * Rt);
  const rA = Rt + R1 * (1 - Math.cos(th)), xA = -R1 * Math.sin(th);
  let rB = Rc - R2 * (1 - Math.cos(th));
  if (rB < rA) { R2 = (Rc - rA) / (1 - Math.cos(th)); rB = rA; }
  const xB = xA - (rB - rA) / Math.tan(th), xF = xB - R2 * Math.sin(th);
  const conv_ = [];
  const N = 24;
  for (let i = 0; i <= N; i++) { const p = th * i / N; conv_.push([xF + R2 * Math.sin(p), Rc - R2 * (1 - Math.cos(p))]); }
  for (let i = 1; i <= 10; i++) { const t = i / 10; conv_.push([xB + (xA - xB) * t, rB + (rA - rB) * t]); }
  for (let i = 1; i <= N; i++) { const p = th * (1 - i / N); conv_.push([-R1 * Math.sin(p), Rt + R1 * (1 - Math.cos(p))]); }
  // convergent volume from the fillet start to the throat (trapezoidal on r²)
  let Vconv = 0;
  for (let i = 1; i < conv_.length; i++) { const [x0, r0] = conv_[i - 1], [x1, r1] = conv_[i]; Vconv += Math.PI * (x1 - x0) * (r0 * r0 + r0 * r1 + r1 * r1) / 3; }
  const At = Math.PI * Rt * Rt, Ac = Math.PI * Rc * Rc;
  const Vc = Lstar * At;
  const Lcyl = Math.max(0, (Vc - Vconv) / Ac);
  const xInj = xF - Lcyl;
  const pts = [[xInj, Rc], ...conv_];
  // divergent
  const Rd = 0.382 * Rt;
  let thetaN, thetaE, lambda, xE;
  if (nozzle === 'cone') {
    const a = half * DEG; thetaN = a; thetaE = a;
    for (let i = 1; i <= 16; i++) { const p = a * i / 16; pts.push([Rd * Math.sin(p), Rt + Rd * (1 - Math.cos(p))]); }
    const [x0, r0] = pts[pts.length - 1];
    xE = x0 + (Re - r0) / Math.tan(a);
    for (let i = 1; i <= 30; i++) { const t = i / 30; pts.push([x0 + (xE - x0) * t, r0 + (Re - r0) * t]); }
    lambda = 0.5 * (1 + Math.cos(a));
  } else {
    ({ thetaN, thetaE } = raoAngles(eps));
    for (let i = 1; i <= 16; i++) { const p = thetaN * i / 16; pts.push([Rd * Math.sin(p), Rt + Rd * (1 - Math.cos(p))]); }
    const [xN, rN] = pts[pts.length - 1];
    xE = 0.8 * (Math.sqrt(eps) - 1) * Rt / Math.tan(15 * DEG);
    const m1 = Math.tan(thetaN), m2 = Math.tan(thetaE), c1 = rN - m1 * xN, c2 = Re - m2 * xE;
    const qx = (c2 - c1) / (m1 - m2), qy = m1 * qx + c1;
    for (let i = 1; i <= 60; i++) { const t = i / 60, u = 1 - t; pts.push([u * u * xN + 2 * u * t * qx + t * t * xE, u * u * rN + 2 * u * t * qy + t * t * Re]); }
    lambda = 0.5 * (1 + Math.cos(thetaE));
  }
  // area of the wall (for heat load) and arc length
  return { pts, Rt, Rc, Re, At, Ac, Ae: Math.PI * Re * Re, xInj, xF, xE, Lcyl, Lconv: -xF, Ldiv: xE, length: xE - xInj, Vc: Lcyl * Ac + Vconv, Vconv, thetaN, thetaE, lambda, R1, Rd, R2 };
}

// ---------- full design ----------
export function design(S) {
  const reactants = reactantsFor(S.fuel, S.ox, S.of);
  const Pc = S.Pc * 1e5;
  const id = TH.rocket({ reactants, Pc, eps: S.eps, frozen: !!S.frozen });
  const cstarI = id.cstar, cstar = cstarI * S.etaC;
  // divergence factor depends only on the contour angles, which depend only on ε and type
  const lambda = S.nozzle === 'cone' ? 0.5 * (1 + Math.cos(S.half * DEG)) : 0.5 * (1 + Math.cos(raoAngles(S.eps).thetaE));
  const kMom = lambda * S.etaN;
  const pe = id.exit.P, ue = id.exit.u;
  const CFvac = kMom * ue / cstarI + pe * S.eps / Pc;
  const tbl = expansionTable({ reactants, Pc, frozen: !!S.frozen, Pt: id.throat.P, Gt: id.throat.rho * id.throat.u, pMin: pe * 0.985 });
  const D = { S, reactants, Pc, id, cstarI, cstar, lambda, kMom, pe, ue, CFvac, tbl, Tc: id.chamber.T, eps: S.eps };
  // gas-generator cycles dump a fraction of the flow through the turbine at low exhaust velocity
  D.ggFrac = S.cycle === 'gg' ? S.gg : 0;
  const paDesign = S.at === 'vac' ? 0 : atmosphere(0).p;
  const pd = rawPerf(D, paDesign);
  // F_total = F_main (1 + f·k) where turbine exhaust gives Isp ≈ 1/3 of the main chamber's
  const ggF = 1 + D.ggFrac / (1 - D.ggFrac) * (1 / 3);
  D.ggThrustFactor = ggF;
  const At = S.F * 1e3 / (pd.CF * Pc * ggF);
  D.At = At; D.Rt = Math.sqrt(At / Math.PI); D.Dt = 2 * D.Rt; D.Ae = At * S.eps; D.De = 2 * Math.sqrt(D.Ae / Math.PI);
  D.contraction = S.autoCont ? autoContraction(D.Dt) : S.contraction;
  D.geo = contour({ Rt: D.Rt, eps: S.eps, contraction: D.contraction, nozzle: S.nozzle, half: S.half, Lstar: S.Lstar });
  D.mdotMain = Pc * At / cstar;
  D.mdot = D.mdotMain / (1 - D.ggFrac);
  D.mdotOx = D.mdot * S.of / (1 + S.of); D.mdotFuel = D.mdot / (1 + S.of);
  D.perf = pa => perfAt(D, pa);
  D.sl = D.perf(atmosphere(0).p); D.vac = D.perf(0);
  // gas properties along the engine (wall points)
  D.along = D.geo.pts.map(([x, r]) => {
    const e = (r / D.Rt) ** 2;
    const st = x <= D.geo.xF ? byEps(tbl.sub, D.contraction, KEYS) : byEps(x < 0 ? tbl.sub : tbl.sup, e, KEYS);
    return { x, r, ...st, eps: x <= D.geo.xF ? D.contraction : e };
  });
  D.throat = byP(tbl.sup, id.throat.P, KEYS);
  return D;
}

// Wall pressure at which the boundary layer separates in an over-expanded nozzle (free-shock separation).
// Kalt–Badal: p_sep/pa = 0.667 (Pc/pa)^−0.2. Schmucker: p_sep/pa = (1.88 M_sep − 1)^−0.64. Summerfield: k·pa.
export const SEP_CRITERIA = { kb: 'Kalt–Badal', schmucker: 'Schmucker', summerfield: 'Summerfield (k·pa)' };
export function sepPressure(D, pa) {
  const crit = D.S.sepModel || 'kb';
  if (crit === 'summerfield') return (D.S.sep ?? 0.4) * pa;
  if (crit === 'schmucker') {
    let ps = 0.3 * pa;
    for (let i = 0; i < 30; i++) { const M = byP(D.tbl.sup, Math.max(ps, D.tbl.sup[D.tbl.sup.length - 1].P), ['M']).M; const n = pa * (1.88 * M - 1) ** -0.64; if (Math.abs(n - ps) < 1e-6 * pa) { ps = n; break; } ps = n; }
    return ps;
  }
  return 0.667 * (D.Pc / pa) ** -0.2 * pa;
}

// Thrust coefficient at ambient pa for the main chamber. If over-expanded beyond the separation limit, the jet
// leaves the wall where p = p_sep; the nozzle then behaves like one truncated at that area ratio.
function rawPerf(D, pa) {
  const { Pc, eps, pe, ue, cstarI, kMom } = D;
  const psep = pa > 0 ? sepPressure(D, pa) : 0;
  if (pa > 0 && pe < psep) {
    const st = byP(D.tbl.sup, psep, KEYS);
    const CF = kMom * st.u / cstarI + (st.P - pa) * st.eps / Pc;
    return { CF, sep: true, ps: st.P, epsSep: st.eps };
  }
  return { CF: kMom * ue / cstarI + (pe - pa) * eps / Pc, sep: false };
}
export function perfAt(D, pa) {
  const r = rawPerf(D, pa);
  const Fmain = r.CF * D.Pc * D.At, F = Fmain * D.ggThrustFactor;
  const Isp = F / (D.mdot * G0);
  const ratio = pa > 0 ? D.pe / pa : Infinity;
  const regime = pa <= 0.5 ? 'vacuum' : r.sep ? 'separated' : ratio > 1.05 ? 'under' : ratio < 0.95 ? 'over' : 'design';
  let xSep = NaN;
  if (r.sep) { const e = r.epsSep; const p = D.geo ? D.geo.pts.find(([x, rr]) => x > 0 && (rr / D.Rt) ** 2 >= e) : null; xSep = p ? p[0] : NaN; }
  return { pa, CF: r.CF, F, Isp, sep: r.sep, ps: r.ps, epsSep: r.epsSep, xSep, ratio, regime };
}

// Isp of an ideally expanded nozzle (pe = pa) at this chamber condition: the best any fixed ε can do at pa
export function adaptedIsp(D, pa) {
  if (pa <= 0) return NaN;
  const r = TH.rocket({ reactants: D.reactants, Pc: D.Pc, pcpe: D.Pc / pa, frozen: !!D.S.frozen });
  const lam = D.S.nozzle === 'cone' ? D.lambda : 0.5 * (1 + Math.cos(raoAngles(Math.max(2, r.eps)).thetaE));
  const CF = lam * D.S.etaN * r.exit.u / r.cstar;
  return { Isp: CF * D.cstar / G0 * (1 - D.ggFrac) * D.ggThrustFactor, eps: r.eps };
}

export const ambient = altM => altM >= 86000 ? 0 : atmosphere(altM).p;

// ---------- exhaust plume ----------
// Fully expanded jet Mach number Mj, diameter Dj, lip turning angle, lip shock, Mach disk test and
// shock-cell length (Tam: L ≈ 1.22 Dj √(Mj²−1)). Uses the exit γ for the plume as a perfect gas.
export function plume(D, pa) {
  const ex = D.id.exit, g = ex.gamma, Me = ex.M, Re = D.De / 2, wall = D.geo.thetaE;
  const out = { Me, g, Re, pe: D.pe, pa, ratio: pa > 0 ? D.pe / pa : Infinity };
  const p0e = D.pe * isen.p0_p(Me, g);
  if (pa <= 0.5) {
    out.regime = 'vacuum';
    out.Mj = Infinity; out.delta = isen.numax(g) - isen.nu(Me, g) + wall;
    out.Dj = Infinity; out.cell = Infinity; return out;
  }
  const perf = perfAt(D, pa);
  out.regime = perf.regime;
  let Mexit = Me, pex = D.pe, Rex = Re;
  if (perf.sep) { // jet leaves the wall at the separation point
    const st = byP(D.tbl.sup, perf.ps, ['M', 'eps', 'P']);
    Mexit = st.M; pex = st.P; Rex = D.Rt * Math.sqrt(st.eps); out.xSep = perf.xSep; out.Rsep = Rex;
  }
  out.Mexit = Mexit; out.Rexit = Rex;
  const pr = pex / pa;
  out.Mj = M_from_p(pa / (pex * isen.p0_p(Mexit, g)), g);
  // fully expanded jet area from mass flow: Aj/Ae = (A/A*)(Mj)/(A/A*)(Mexit)
  const Aj = Math.PI * Rex * Rex * isen.A_As(out.Mj, g) / isen.A_As(Mexit, g);
  out.Dj = 2 * Math.sqrt(Aj / Math.PI);
  out.cell = 1.22 * out.Dj * Math.sqrt(Math.max(0.05, out.Mj * out.Mj - 1));
  if (pr > 1.0001) {
    out.delta = isen.nu(out.Mj, g) - isen.nu(Mexit, g) + (perf.sep ? 0 : wall);
    out.machDisk = pr > 2.5;
    out.mdX = 0.67 * 2 * Rex * Math.sqrt(pr) * 0.6;
  } else if (pr < 0.9999) {
    const beta = betaFromPressure(Mexit, 1 / pr, g);
    if (isFinite(beta)) {
      const sh = obliqueShock(Mexit, beta, g);
      out.beta = beta; out.delta = -(sh.theta) + (perf.sep ? 0 : wall);
      // regular reflection at the axis needs the reflected shock to turn the flow back by θ
      out.machDisk = !(sh.M2 > 1 && thetaMax(sh.M2, g) > sh.theta);
      out.mdX = Rex / Math.tan(beta) * 0.75;
    } else { out.beta = Math.PI / 2; out.delta = 0; out.machDisk = true; out.mdX = 0.3 * Rex; }
  } else out.delta = perf.sep ? 0 : wall;
  return out;
}

// ---------- heat transfer ----------
// Bartz (1957) convective coefficient along the wall with the σ correction for property variation,
// adiabatic wall temperature with turbulent recovery r = Pr^(1/3), wall conduction through the liner,
// coolant temperature rise, and the radiation-equilibrium wall temperature of an uncooled extension.
export const LINERS = {
  copper: { label: 'Copper alloy (GRCop / NARloy-Z)', k: 300, Tmax: 800 },
  steel: { label: 'Stainless steel', k: 20, Tmax: 1000 },
  inconel: { label: 'Inconel 718', k: 15, Tmax: 1100 },
  niobium: { label: 'Niobium C-103 (radiative)', k: 45, Tmax: 1600 },
};
export function bartz(D, { Twg = 800, coolant = 'fuel', liner = 'copper', t = 1.0e-3, emiss = 0.8, epsCool = Infinity } = {}) {
  const ch = D.tbl.ch, Tc = D.Tc, Pc = D.Pc;
  const W = ch.W * 1000, g0 = ch.gammaFrozen, cp0 = ch.cp;
  const mu0 = gasViscosity(W, Tc), Pr = prandtl(g0), rec = Pr ** (1 / 3);
  const Rcurv = 0.5 * (D.geo.R1 + D.geo.Rd);
  const base = 0.026 / D.Dt ** 0.2 * (mu0 ** 0.2 * cp0 / Pr ** 0.6) * (Pc / D.cstar) ** 0.8 * (D.Dt / Rcurv) ** 0.1;
  const k = LINERS[liner].k;
  const pts = D.along.map(p => {
    const M = p.M, m2 = 1 + 0.5 * (g0 - 1) * M * M;
    const sigma = 1 / ((0.5 * Twg / Tc * m2 + 0.5) ** 0.68 * m2 ** 0.12);
    const hg = base * (1 / p.eps) ** 0.9 * sigma;
    const Taw = p.T + rec * (Tc - p.T);
    const q = hg * Math.max(0, Taw - Twg);
    // radiation equilibrium: hg (Taw − Tw) = ε σ Tw⁴
    let Tr = Math.min(Taw, 1500);
    for (let i = 0; i < 40; i++) { const f = hg * (Taw - Tr) - emiss * SIGMA_SB * Tr ** 4, df = -hg - 4 * emiss * SIGMA_SB * Tr ** 3; const d = f / df; Tr -= d; if (Math.abs(d) < 1e-3) break; }
    return { x: p.x, r: p.r, eps: p.eps, M, hg, Taw, q, sigma, Trad: Tr, Twc: Twg - q * t / k };
  });
  // heat load into the coolant: ∫ q · 2πr ds along the regeneratively cooled wall (up to A/At = epsCool)
  const cooled = p => p.x <= 0 || p.eps <= epsCool;
  let Q = 0, Qconv = 0, Qall = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], ds = Math.hypot(b.x - a.x, b.r - a.r);
    const dq = 0.5 * (a.q * 2 * Math.PI * a.r + b.q * 2 * Math.PI * b.r) * ds;
    Qall += dq; if (cooled(b)) Q += dq; if (b.x <= 0) Qconv += dq;
  }
  const xCool = pts.filter(cooled).pop().x;
  const iMax = pts.reduce((m, p, i) => (p.q > pts[m].q ? i : m), 0);
  const cid = coolant === 'ox' ? D.S.ox : D.S.fuel, cprop = PROPS[cid];
  const mc = coolant === 'ox' ? D.mdotOx : D.mdotFuel;
  const Tin = TH.REACTANTS[cid].T;
  const dT = Q / (mc * cprop.cp);
  return { pts, Q, Qall, Qconv, xCool, epsCool, peak: pts[iMax], iMax, mu0, Pr, rec, cp0, g0, W, Rcurv, coolant: cid, mc, Tin, dT, Tout: Tin + dT, cprop, liner: LINERS[liner], k, t, Twg };
}
