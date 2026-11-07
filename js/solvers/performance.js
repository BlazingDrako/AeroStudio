// Aircraft performance (no DOM). Point-mass, steady-flight models in SI on the shared standard atmosphere.
//   Aircraft: parabolic drag polar CD = CD0(M) + K(M)·CL² with transonic/supersonic wave drag, and engine models
//   with altitude and Mach lapse (Mattingly, Heiser & Pratt, "Aircraft Engine Design": installed thrust lapse and TSFC).
//   Analyses: level-flight state, characteristic speeds, ceilings and time to climb, cruise range and endurance,
//   payload–range, takeoff and landing distances (Raymer, "Aircraft Design: A Conceptual Approach", ch. 17),
//   turn performance, V–n diagram (FAR 23/25 gust lines with the Pratt alleviation factor), and the
//   altitude–Mach map of specific excess power with Rutowski's energy-climb path.
import { atmosphere, geometric, G0, SEA } from './atmosphere.js';
import { normalShock } from './gasdyn.js';

const KT = 0.514444, FT = 0.3048, LB = 0.45359237, HP = 745.7;
const TSFC_UNIT = 2.832545e-5;       // 1 lb/(lbf·h) in kg/(N·s)

// Representative public figures, rounded; "-class" because these are teaching models, not manufacturer data.
// Masses in kg, areas in m², speeds as EAS in m/s, thrust in N (all engines), power in W.
export const AIRCRAFT = [
  {
    id: 'c172', name: 'Light single (Cessna 172-class)', short: 'Light single', engine: 'piston', screen: 50 * FT,
    S: 16.2, b: 11.0, e: 0.70, CD0: 0.032, CLa: 4.6, CLmax: 1.50, CLmaxNeg: -0.9,
    to: { CLmax: 1.65, dCD0: 0.010, CLg: 0.35, mu: 0.04, lof: 1.1 }, land: { CLmax: 2.0, dCD0: 0.035, CLg: 0.3, mu: 0.35, app: 1.3, free: 1 },
    mass: { empty: 767, max: 1111, def: 1050, fuel: 144, payload: 300 },
    P0: 134e3, eta: 0.82, Vstar: 46, bsfc: 0.45,
    limits: { nPos: 3.8, nNeg: -1.52, VC: 129 * KT, VD: 181 * KT, VNE: 163 * KT },
    mcrit: 0.6, plot: { Mmax: 0.32, zMax: 6500 },
    note: 'Fixed-pitch propeller, 180 hp normally aspirated piston engine, fixed gear.',
  },
  {
    id: 'glider', name: 'Sailplane (15 m standard class)', short: 'Sailplane', engine: 'none', screen: 50 * FT,
    S: 10.5, b: 15.0, e: 0.93, CD0: 0.0105, CLa: 5.5, CLmax: 1.40, CLmaxNeg: -0.8,
    to: null, land: { CLmax: 1.5, dCD0: 0.025, CLg: 0.3, mu: 0.25, app: 1.3, free: 1 },
    mass: { empty: 260, max: 525, def: 400, fuel: 0, payload: 0, ballast: 140 },
    limits: { nPos: 5.3, nNeg: -2.65, VC: 150 * KT * 0.75, VD: 146 * KT, VNE: 146 * KT },
    mcrit: 0.6, plot: { Mmax: 0.25, zMax: 6000 },
    note: 'Unpowered. Water ballast raises the wing loading: the same glide ratio at a higher speed.',
  },
  {
    id: 'a320', name: 'Airliner (A320-class)', short: 'Airliner', engine: 'hbp', screen: 35 * FT,
    S: 122.6, b: 35.8, e: 0.80, CD0: 0.020, CLa: 5.5, CLmax: 1.45, CLmaxNeg: -0.8,
    to: { CLmax: 2.3, dCD0: 0.030, CLg: 0.6, mu: 0.02, lof: 1.12 }, land: { CLmax: 2.9, dCD0: 0.065, CLg: 0.0, mu: 0.45, app: 1.3, free: 3 },
    mass: { empty: 42600, max: 78000, def: 65000, fuel: 18700, payload: 19900 },
    T0: 2 * 120e3, tsfcK: 0.9,
    limits: { nPos: 2.5, nNeg: -1.0, VC: 350 * KT, VD: 390 * KT, MMO: 0.82, MD: 0.89 },
    mcrit: 0.72, plot: { Mmax: 0.95, zMax: 13500 },
    note: 'Two high-bypass turbofans (≈ 27,000 lbf each); cruise M 0.78 at FL350–390.',
  },
  {
    id: 'cca', name: 'Combat drone (CCA-class, illustrative)', short: 'CCA drone', engine: 'dry', screen: 50 * FT,
    S: 10.0, b: 8.2, e: 0.80, CD0: 0.021, CLa: 4.8, CLmax: 1.30, CLmaxNeg: -0.8,
    to: { CLmax: 1.5, dCD0: 0.020, CLg: 0.4, mu: 0.02, lof: 1.1 }, land: { CLmax: 1.6, dCD0: 0.040, CLg: 0.1, mu: 0.4, app: 1.25, free: 2 },
    mass: { empty: 1300, max: 2700, def: 2300, fuel: 1000, payload: 400 },
    T0: 9.0e3, tsfcK: 0.85, TR: 1.0,
    limits: { nPos: 7, nNeg: -3, VC: 450 * KT, VD: 550 * KT, MMO: 0.85, MD: 0.9 },
    mcrit: 0.72, plot: { Mmax: 0.95, zMax: 15500 },
    note: 'Small turbofan without afterburner, high-aspect-ratio wing for range. Numbers are illustrative of the class.',
  },
  {
    id: 'f16', name: 'Fighter (F-16-class)', short: 'Fighter', engine: 'ab', screen: 50 * FT,
    S: 27.87, b: 9.45, e: 0.83, CD0: 0.0175, CLa: 3.6, CLmax: 1.6, CLmaxNeg: -0.8, kSup: 1.5,
    wave: { Mpeak: 1.1, dCD0: 0.024, fall: 0.35 },
    to: { CLmax: 1.2, dCD0: 0.015, CLg: 0.15, mu: 0.02, lof: 1.1 }, land: { CLmax: 1.5, dCD0: 0.030, CLg: 0.1, mu: 0.35, app: 1.2, free: 2 },
    mass: { empty: 8570, max: 19190, def: 12000, fuel: 3200, payload: 5400 },
    T0: 131e3, milRatio: 0.58, tsfcK: 1.0, TR: 1.07, pitotInlet: true,
    limits: { nPos: 9, nNeg: -3, VC: 700 * KT, VD: 800 * KT, Mmax: 2.05 },
    mcrit: 0.85, plot: { Mmax: 2.4, zMax: 18500 },
    note: 'One afterburning low-bypass turbofan (≈ 29,000 lbf with afterburner), fixed normal-shock inlet. Speed is limited to M 2.05; the steady-flight ceiling here is above the real 50,000+ ft, which engine and pilot-protection limits set.',
  },
];
export const byId = id => AIRCRAFT.find(a => a.id === id) || AIRCRAFT[0];
export const RATINGS = { ab: [{ value: 'ab', label: 'Afterburner' }, { value: 'mil', label: 'Military (dry)' }], hbp: [{ value: 'max', label: 'Max thrust' }], dry: [{ value: 'max', label: 'Max thrust' }], piston: [{ value: 'max', label: 'Full throttle' }], none: [] };
export const defaultRating = ac => (RATINGS[ac.engine][0] || {}).value || 'none';

// ---------- aerodynamics ----------
const smooth = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
// Zero-lift drag and induced-drag factor at Mach M
export function polar(ac, M) {
  const K0 = 1 / (Math.PI * ac.e * ac.b * ac.b / ac.S);
  let CD0 = ac.CD0, K = K0;
  if (ac.wave) {                       // supersonic aircraft: rise to a peak just past M 1, then a slow fall
    const w = ac.wave, Mc = ac.mcrit;
    const f = M <= w.Mpeak ? smooth((M - Mc) / (w.Mpeak - Mc)) : Math.max(1 - w.fall, 1 - w.fall * (M - w.Mpeak) / 0.9);
    CD0 += w.dCD0 * f;
    if (M > 0.9) K = K0 * (1 + (ac.kSup || 1) * (M - 0.9));
  } else if (M > ac.mcrit) CD0 += 20 * (M - ac.mcrit) ** 4;   // Lock's fourth-power drag rise above critical Mach
  return { CD0, K };
}

// ---------- engines ----------
// Total installed thrust (N) available at the condition; rating 'ab' | 'mil' | 'max'. Props also return shaft power.
export function thrust(ac, atm, V, rating) {
  if (ac.engine === 'none') return { T: 0, P: 0 };
  const M = V / atm.a, th = atm.T / SEA.T, dl = atm.p / SEA.p;
  if (ac.engine === 'piston') {
    const P = ac.P0 * Math.max(0, 1.132 * atm.sigma - 0.132);          // Gagg–Ferrar power lapse
    const eta = ac.eta * Math.tanh(Math.max(V, 1e-3) / ac.Vstar);       // fixed-pitch prop: efficiency builds with speed
    return { T: V < 0.5 ? ac.eta * P / ac.Vstar : eta * P / V, P, eta };
  }
  const f = 1 + 0.2 * M * M, th0 = th * f, d0 = dl * f ** 3.5, TR = ac.TR ?? 1.0;
  let a;
  if (ac.engine === 'hbp') a = d0 * (1 - 0.49 * Math.sqrt(M) - (th0 > TR ? 3 * (th0 - TR) / (1.5 + M) : 0));
  else if (ac.engine === 'ab' && rating === 'ab') a = d0 * (th0 > TR ? 1 - 3.5 * (th0 - TR) / th0 : 1);
  else {
    a = d0 * (th0 > TR ? 1 - 3.8 * (th0 - TR) / th0 : 1);
    if (ac.engine === 'ab') a *= ac.milRatio;
  }
  if (ac.pitotInlet && M > 1) a *= normalShock(M, 1.4).p02_p01;    // fixed normal-shock inlet loses total pressure
  return { T: ac.T0 * Math.max(0, a) };
}
// Fuel flow (kg/s) to produce thrust T (jets) or, for props, to deliver thrust T at speed V
export function fuelFlow(ac, atm, V, T, rating) {
  if (ac.engine === 'none') return 0;
  if (ac.engine === 'piston') { const { eta } = thrust(ac, atm, V, rating); return ac.bsfc * LB / (HP * 3600) * T * V / eta; }
  const M = V / atm.a, sq = Math.sqrt(atm.T / SEA.T);
  const tsfc = ac.engine === 'hbp' ? (0.4 + 0.45 * M) * sq : ac.engine === 'ab' && rating === 'ab' ? (1.6 + 0.27 * M) * sq : (0.9 + 0.30 * M) * sq;
  return tsfc * (ac.tsfcK || 1) * TSFC_UNIT * T;
}

// ---------- level flight ----------
// State in steady flight at load factor n. V is TAS (m/s); W weight (N).
export function state(ac, atm, V, W, rating, n = 1) {
  const M = V / atm.a, q = 0.5 * atm.rho * V * V, { CD0, K } = polar(ac, M);
  const CL = n * W / (q * ac.S), CDi = K * CL * CL, CD = CD0 + CDi;
  const D = q * ac.S * CD, { T, P, eta } = thrust(ac, atm, V, rating);
  const Ps = (T - D) * V / W;
  return { V, M, q, CL, CD, CD0, CDi, K, D, Dp: q * ac.S * CD0, Di: q * ac.S * CDi, T, P, eta, Ps, LD: CL / CD, stalled: CL > ac.CLmax, Preq: D * V, Pav: T * V, gamma: Math.asin(Math.max(-1, Math.min(1, (T - D) / W))) };
}
export const stallSpeed = (ac, atm, W, CLmax = ac.CLmax, n = 1) => Math.sqrt(2 * n * W / (atm.rho * ac.S * CLmax));
// Operating speed limit as TAS at this altitude: VNE (light aircraft), or VMO/MMO (jets), or the fighter's
// q limit and maximum Mach. Indicated limits are treated as EAS.
export function speedLimit(ac, atm) {
  const L = ac.limits, Vop = L.VNE ?? (L.MMO ? L.VC : L.VD), Mop = L.MMO ?? L.Mmax ?? Infinity;
  return Math.min(Vop / Math.sqrt(atm.sigma), Mop * atm.a);
}
// Search ceiling for level-flight speeds (beyond the limits, so the aerodynamic maximum is found)
const vSearchMax = (ac, atm) => (ac.limits.Mmax ? 3.0 : ac.wave ? 2.6 : ac.mcrit + 0.35) * atm.a;

function golden(f, a, b, it = 50) { // maximise f on [a, b]
  const r = (Math.sqrt(5) - 1) / 2; let c = b - r * (b - a), d = a + r * (b - a), fc = f(c), fd = f(d);
  for (let i = 0; i < it; i++) { if (fc > fd) { b = d; d = c; fd = fc; c = b - r * (b - a); fc = f(c); } else { a = c; c = d; fc = fd; d = a + r * (b - a); fd = f(d); } }
  return (a + b) / 2;
}
function argmax(f, a, b, n = 240) {
  let best = a, bv = -Infinity;
  for (let i = 0; i <= n; i++) { const x = a + (b - a) * i / n, v = f(x); if (v > bv) { bv = v; best = x; } }
  const h = (b - a) / n;
  return golden(f, Math.max(a, best - h), Math.min(b, best + h));
}

// Characteristic speeds at one altitude (TAS, m/s)
export function speeds(ac, atm, W, rating) {
  const Vs = stallSpeed(ac, atm, W), Vhi = vSearchMax(ac, atm);
  const st = V => state(ac, atm, V, W, rating);
  const Vmd = argmax(V => -st(V).D, Vs, Vhi), Vmp = argmax(V => -st(V).Preq, Vs, Vhi);
  const out = { Vs, Vmd, Vmp, LDmax: st(Vmd).LD, Vlimit: speedLimit(ac, atm) };
  if (ac.engine === 'none') {
    // glide: best glide at Vmd, minimum sink at Vmp
    out.sinkMin = st(Vmp).Preq / W; out.sinkAtVmd = st(Vmd).Preq / W;
    return out;
  }
  out.Vy = argmax(V => st(V).Ps, Vs, Vhi); out.RoCmax = st(out.Vy).Ps;
  out.Vx = argmax(V => st(V).gamma, Vs, Vhi); out.gammaMax = st(out.Vx).gamma;
  // level-flight speed range: where T ≥ D above the stall
  const N = 400; let lo = NaN, hi = NaN;
  for (let i = 0; i <= N; i++) { const V = Vs + (Vhi - Vs) * i / N, ok = st(V).T >= st(V).D; if (ok) { if (isNaN(lo)) lo = V; hi = V; } }
  const refine = (a, b) => { for (let k = 0; k < 50; k++) { const m = (a + b) / 2; if ((st(m).T >= st(m).D) === (st(a).T >= st(a).D)) a = m; else b = m; } return (a + b) / 2; };
  if (!isNaN(hi)) { const step = (Vhi - Vs) / N; if (hi < Vhi - 1e-9) hi = refine(hi, hi + step); if (lo > Vs + 1e-9) lo = refine(lo - step, lo); }
  out.VmaxAero = hi; out.Vmin = isNaN(lo) ? NaN : Math.max(lo, Vs); out.Vmax = Math.min(hi, out.Vlimit); out.limitedBy = hi > out.Vlimit ? 'limit' : 'thrust';
  return out;
}

// Best climb rate at a geometric altitude (m/s), or −sink for gliders
export function roCmax(ac, z, dT, W, rating) {
  const atm = atmosphere(z, dT), Vs = stallSpeed(ac, atm, W), Vhi = vSearchMax(ac, atm);
  const V = argmax(v => state(ac, atm, v, W, rating).Ps, Vs, Vhi, 120);
  return { V, RoC: state(ac, atm, V, W, rating).Ps };
}
// Absolute (RoC = 0) and service (RoC = 100 ft/min) ceilings, and time to climb along best-rate speeds
export function ceilings(ac, dT, W, rating) {
  if (ac.engine === 'none') return { abs: NaN, service: NaN };
  const find = target => {
    if (roCmax(ac, 0, dT, W, rating).RoC < target) return 0;
    let lo = 0, hi = 30000; if (roCmax(ac, hi, dT, W, rating).RoC > target) return hi;
    for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (roCmax(ac, m, dT, W, rating).RoC > target) lo = m; else hi = m; }
    return (lo + hi) / 2;
  };
  return { abs: find(1e-4), service: find(100 * FT / 60) };
}
export function timeToClimb(ac, dT, W, rating, z1, z0 = 0, n = 60) {
  let t = 0; const pts = [[z0, 0]];
  for (let i = 0; i < n; i++) {
    const a = z0 + (z1 - z0) * i / n, b = z0 + (z1 - z0) * (i + 1) / n, r = roCmax(ac, (a + b) / 2, dT, W, rating).RoC;
    if (!(r > 0)) return { t: Infinity, pts };
    t += (b - a) / r; pts.push([b, t]);
  }
  return { t, pts };
}

// ---------- cruise ----------
// Speed for a cruise rule at weight W: 'mrc' max specific range, 'lrc' 99% of it (faster side), 'end' min fuel flow, number = Mach
export function cruiseSpeed(ac, atm, W, rating, rule) {
  if (typeof rule === 'number') return rule * atm.a;
  const Vs = stallSpeed(ac, atm, W), Vhi = Math.min(vSearchMax(ac, atm), speedLimit(ac, atm));
  const ok = V => { const s = state(ac, atm, V, W, rating); return s.T >= s.D; };
  const sr = V => { const s = state(ac, atm, V, W, rating); return ok(V) ? V / fuelFlow(ac, atm, V, s.D, rating) : -Infinity; };
  if (rule === 'end') return argmax(V => { const s = state(ac, atm, V, W, rating); return ok(V) ? -fuelFlow(ac, atm, V, s.D, rating) : -Infinity; }, Vs * 1.05, Vhi);
  const Vm = argmax(sr, Vs * 1.05, Vhi);
  if (rule !== 'lrc') return Vm;
  const t = 0.99 * sr(Vm); let a = Vm, b = Vhi;
  if (sr(b) >= t) return b;
  for (let k = 0; k < 50; k++) { const m = (a + b) / 2; if (sr(m) > t) a = m; else b = m; }
  return (a + b) / 2;
}
export function specificRange(ac, atm, V, W, rating) {
  const s = state(ac, atm, V, W, rating);
  return s.T >= s.D && !s.stalled ? V / fuelFlow(ac, atm, V, s.D, rating) : NaN; // m per kg
}
// Integrate a constant-altitude cruise burning `burn` kg of fuel from mass m0
export function cruise(ac, { z, dT, m0, burn, rating, rule }) {
  const atm = atmosphere(z, dT), n = 60; let R = 0, t = 0, m = m0, feasible = true;
  const track = [];
  for (let i = 0; i < n; i++) {
    const dm = burn / n, mm = m - dm / 2, W = mm * G0;
    const V = cruiseSpeed(ac, atm, W, rating, rule), s = state(ac, atm, V, W, rating);
    if (s.T < s.D || s.stalled) feasible = false;
    const ff = fuelFlow(ac, atm, V, s.D, rating), dt = dm / ff;
    R += V * dt; t += dt; m -= dm; track.push({ m: mm, V, LD: s.LD, ff });
  }
  return { range: R, time: t, feasible, Vstart: track[0]?.V, Vend: track[n - 1]?.V, LD: track[n >> 1]?.LD, track };
}
// Payload–range corners, 5% of the fuel kept as reserve
export function payloadRange(ac, { z, dT, rating, rule, reserve = 0.05 }) {
  const M = ac.mass, pts = [];
  const leg = (payload, fuel) => cruise(ac, { z, dT, m0: M.empty + payload + fuel, burn: fuel * (1 - reserve), rating, rule });
  const fB = Math.min(M.fuel, M.max - M.empty - M.payload);
  const pC = Math.min(M.payload, M.max - M.empty - M.fuel);
  pts.push({ R: 0, payload: M.payload, label: 'A' });
  if (fB > 0) pts.push({ R: leg(M.payload, fB).range, payload: M.payload, fuel: fB, label: 'max payload' });
  if (pC > 0) pts.push({ R: leg(pC, M.fuel).range, payload: pC, fuel: M.fuel, label: 'max fuel' });
  pts.push({ R: leg(0, M.fuel).range, payload: 0, fuel: M.fuel, label: 'ferry' });
  return pts;
}

// ---------- takeoff and landing (Raymer ch. 17) ----------
export function takeoff(ac, { elev = 0, dT = 0, W, wind = 0, rating }) {
  if (!ac.to) return null;
  const c = ac.to, atm = atmosphere(elev, dT), m = W / G0, K = polar(ac, 0).K;
  const Vs = stallSpeed(ac, atm, W, c.CLmax), Vlof = c.lof * Vs;
  let V = Math.max(0, wind), x = 0, t = 0; const dt = 0.02;
  while (V < Vlof && t < 300) {
    const q = 0.5 * atm.rho * V * V, T = thrust(ac, atm, V, rating).T;
    const L = q * ac.S * c.CLg, D = q * ac.S * (ac.CD0 + c.dCD0 + K * c.CLg ** 2);
    const a = (T - D - c.mu * Math.max(0, W - L)) / m;
    if (a <= 0) return { Vs, Vlof, fail: true };
    V += a * dt; x += (V - wind) * dt; t += dt;
  }
  // transition arc at VTR = 1.15 Vs with n = 1.2, then a straight climb to the screen height
  const VTR = 1.15 * Vs, R = VTR * VTR / (0.2 * G0), V2 = 1.2 * Vs;
  const q2 = 0.5 * atm.rho * V2 * V2, CL2 = W / (q2 * ac.S);
  const D2 = q2 * ac.S * (ac.CD0 + c.dCD0 + K * CL2 * CL2), T2 = thrust(ac, atm, V2, rating).T;
  const gam = Math.asin(Math.max(0.005, Math.min(0.5, (T2 - D2) / W)));
  const hTR = R * (1 - Math.cos(gam)), h = ac.screen;
  let air = hTR >= h ? Math.sqrt(R * R - (R - h) ** 2) : R * Math.sin(gam) + (h - hTR) / Math.tan(gam);
  air *= Math.max(0, 1 - wind / VTR);
  return { Vs, Vlof, V2, ground: x, air, total: x + air, time: t, gamma: gam, screen: h };
}
export function landing(ac, { elev = 0, dT = 0, W, wind = 0 }) {
  const c = ac.land, atm = atmosphere(elev, dT), m = W / G0, K = polar(ac, 0).K;
  const Vs = stallSpeed(ac, atm, W, c.CLmax), Va = c.app * Vs, Vf = 1.23 * Vs, VTD = 1.15 * Vs, ga = 3 * Math.PI / 180, h = ac.screen;
  const R = Vf * Vf / (0.2 * G0), hf = R * (1 - Math.cos(ga));
  let air = (h - hf) / Math.tan(ga) + R * Math.sin(ga);
  air *= Math.max(0, 1 - wind / Va);
  const free = c.free * (VTD - wind);
  let V = VTD, x = 0, t = 0; const dt = 0.02;
  while (V > Math.max(wind, 0) + 0.05 && t < 300) {
    const q = 0.5 * atm.rho * V * V, L = q * ac.S * c.CLg, D = q * ac.S * (ac.CD0 + c.dCD0 + K * c.CLg ** 2);
    const a = -(D + c.mu * Math.max(0, W - L)) / m;
    V += a * dt; x += Math.max(0, V - wind) * dt; t += dt;
  }
  const total = air + free + x;
  return { Vs, Va, VTD, air, free, ground: x, total, field: ac.engine === 'hbp' ? total / 0.6 : NaN, screen: h };
}

// ---------- turning ----------
export function turnAt(ac, atm, V, W, rating) {
  const q = 0.5 * atm.rho * V * V, M = V / atm.a, { CD0, K } = polar(ac, M), T = thrust(ac, atm, V, rating).T;
  const nStall = q * ac.S * ac.CLmax / W, nInst = Math.min(nStall, ac.limits.nPos);
  const CLs = Math.sqrt(Math.max(0, (T / (q * ac.S) - CD0) / K));
  const nSus = Math.min(q * ac.S * CLs / W, nInst);
  const rate = n => (n > 1 ? G0 * Math.sqrt(n * n - 1) / V : 0), radius = n => (n > 1 ? V * V / (G0 * Math.sqrt(n * n - 1)) : Infinity);
  return { V, M, q, nStall, nInst, nSus, rateInst: rate(nInst), rateSus: rate(nSus), radiusInst: radius(nInst), radiusSus: radius(nSus), bankSus: nSus > 1 ? Math.acos(1 / nSus) : 0, bankInst: nInst > 1 ? Math.acos(1 / nInst) : 0 };
}
// Load factor for a given specific excess power Ps at speed V (the doghouse Ps contours); NaN if unreachable
export function nForPs(ac, atm, V, W, rating, Ps) {
  const q = 0.5 * atm.rho * V * V, { CD0, K } = polar(ac, V / atm.a), T = thrust(ac, atm, V, rating).T;
  const D = T - Ps * W / V, CL2 = (D / (q * ac.S) - CD0) / K;
  return CL2 >= 0 ? q * ac.S * Math.sqrt(CL2) / W : NaN;
}
export function turnSummary(ac, atm, W, rating) {
  const Vs = stallSpeed(ac, atm, W), Vhi = Math.min(vSearchMax(ac, atm), speedLimit(ac, atm));
  const corner = Math.min(stallSpeed(ac, atm, W, ac.CLmax, ac.limits.nPos), Vhi);
  const Vsus = argmax(V => turnAt(ac, atm, V, W, rating).rateSus, Vs, Vhi);
  const tc = turnAt(ac, atm, corner, W, rating), ts = turnAt(ac, atm, Vsus, W, rating);
  return { corner, rateInstMax: tc.rateInst, radiusMin: argminRadius(ac, atm, W, rating, Vs, Vhi), Vsus, rateSusMax: ts.rateSus, nAtSus: ts.nSus, Vs, Vhi };
}
function argminRadius(ac, atm, W, rating, a, b) { const V = argmax(v => -turnAt(ac, atm, v, W, rating).radiusInst, a, b); return turnAt(ac, atm, V, W, rating).radiusInst; }

// ---------- V–n diagram (EAS, sea-level density) ----------
export function vnDiagram(ac, { W, z = 0 }) {
  const L = ac.limits, WS = W / ac.S, r0 = SEA.rho, atm = atmosphere(z);
  const Vs1 = Math.sqrt(2 * WS / (r0 * ac.CLmax)), VsNeg = Math.sqrt(2 * WS / (r0 * -ac.CLmaxNeg));
  const VA = Vs1 * Math.sqrt(L.nPos), VG = VsNeg * Math.sqrt(-L.nNeg);
  const c = ac.S / ac.b, mu = 2 * WS / (atm.rho * c * ac.CLa * G0), Kg = 0.88 * mu / (5.3 + mu);
  const gust = (U, Ve) => Kg * r0 * U * Ve * ac.CLa / (2 * WS);
  const UC = (z < 20000 * FT ? 50 : 50 - (z / FT - 20000) * 25 / 30000) * FT, UD = UC / 2;
  return { Vs1, VsNeg, VA, VG, VC: L.VC, VD: L.VD, nPos: L.nPos, nNeg: L.nNeg, Kg, mu, UC, UD, gustC: gust(UC, L.VC), gustD: gust(UD, L.VD), nStall: Ve => r0 * Ve * Ve * ac.CLmax / (2 * WS), nStallNeg: Ve => r0 * Ve * Ve * ac.CLmaxNeg / (2 * WS) };
}

// ---------- energy maneuverability ----------
// Specific excess power on an altitude × Mach grid (1 g, given rating); NaN outside the flyable region
export function psMap(ac, { W, dT, rating, Mmax, zMax, nx = 90, ny = 70 }) {
  const Ms = Array.from({ length: nx }, (_, i) => 0.02 + (Mmax - 0.02) * i / (nx - 1));
  const zs = Array.from({ length: ny }, (_, j) => zMax * j / (ny - 1));
  const Ps = zs.map(z => { const atm = atmosphere(z, dT); return Ms.map(M => { const V = M * atm.a, s = state(ac, atm, V, W, rating); return s.stalled ? NaN : s.Ps; }); });
  return { Ms, zs, Ps };
}
// Rutowski minimum-time climb: on each energy-height level fly where Ps is largest; t = ∫ dHe/Ps
export function energyClimb(ac, { W, dT, rating, z1, M1, steps = 120 }) {
  const atm1 = atmosphere(z1, dT), He1 = z1 + (M1 * atm1.a) ** 2 / (2 * G0);
  const s0 = speeds(ac, atmosphere(0, dT), W, rating), V0 = Math.max(s0.Vy || s0.Vs * 1.3, s0.Vs * 1.2);
  const He0 = V0 * V0 / (2 * G0);
  if (He1 <= He0) return { path: [], time: 0, He1 };
  const best = He => {
    let b = null;
    for (let i = 0; i <= 160; i++) {
      const z = He * i / 160, V = Math.sqrt(Math.max(0, 2 * G0 * (He - z)));
      if (z > 30000) break;
      const atm = atmosphere(z, dT);
      if (V > speedLimit(ac, atm) || V < 1) continue;
      const s = state(ac, atm, V, W, rating);
      if (s.stalled) continue;
      if (!b || s.Ps > b.Ps) b = { z, V, M: V / atm.a, Ps: s.Ps };
    }
    return b;
  };
  const path = []; let t = 0, prev = best(He0);
  if (!prev) return { path, time: Infinity, He1 };
  path.push({ ...prev, He: He0, t: 0 });
  for (let k = 1; k <= steps; k++) {
    const He = He0 + (He1 - He0) * k / steps, b = best(He);
    if (!b || b.Ps <= 0 || prev.Ps <= 0) return { path, time: Infinity, He1, stuck: He };
    t += (He - path[path.length - 1].He) * 2 / (b.Ps + prev.Ps);
    path.push({ ...b, He, t }); prev = b;
  }
  return { path, time: t, He1, target: { z: z1, M: M1 } };
}
export const energyHeight = (z, V) => z + V * V / (2 * G0);
export { KT, FT, LB, HP, geometric };
