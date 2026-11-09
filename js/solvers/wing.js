// Wings & 3D Aero solver (no DOM). Finite wings by:
//   - a vortex-lattice method (horseshoe vortices, bound leg at the panel quarter chord, control point at three
//     quarters, legs trailing to infinity along x) for any planform with sweep, taper, twist, dihedral and winglets;
//   - Glauert's lifting-line theory (Fourier series) for straight wings, as the classic reference;
//   - induced drag in the Trefftz plane, downwash anywhere behind the wing, ground effect by a mirror-image wing,
//     compressibility by Göthert's rule (x stretched by 1/β);
//   - a nonlinear strip loop (the α-correction method) that makes each strip follow its section's cl(α) curve, so the
//     wing can stall: either a simple model section or tabulated polars from the Airfoil Lab;
//   - a 2-D roll-up of the trailing vortex sheet (point vortices with Krasny smoothing) for the wake picture.
// Lengths in metres, angles in degrees at the interface (radians inside). Forces are computed for V = 1, ρ = 1, so
// they scale with ρV².
import { luFactor, luSolve } from '../lib/linalg.js';

const PI = Math.PI, DEG = PI / 180, FOUR_PI = 4 * PI;

// ---------------- sections ----------------

// Zero-lift angle (deg) of a NACA 4-digit section by thin-airfoil theory: α0 = −(1/π)∫ dz/dx (cos θ − 1) dθ.
export function nacaAlpha0(code) {
  const s = String(code || '').trim();
  if (!/^\d{4}$/.test(s)) return 0;
  const m = +s[0] / 100, p = +s[1] / 10;
  if (m === 0 || p === 0) return 0;
  const n = 400; let sum = 0;
  for (let i = 0; i < n; i++) {
    const th = (i + 0.5) * PI / n, x = (1 - Math.cos(th)) / 2;
    const dz = x < p ? 2 * m / (p * p) * (p - x) : 2 * m / ((1 - p) ** 2) * (p - x);
    sum += dz * (Math.cos(th) - 1) * PI / n;
  }
  return -sum / PI / DEG;
}
export const thickness = code => /^\d{4}$/.test(String(code)) ? +String(code).slice(2) / 100 : 0.12;

// A simple model section: linear lift up to near cl,max, a rounded top and a gentle drop after the stall, tending to
// flat-plate values at high angle. a: lift slope per rad, alpha0 (deg), clmax.
export function modelSection(o = {}) {
  // scale the internal top so the peak lands exactly on the requested cl,max
  let k = 1, m;
  for (let i = 0; i < 4; i++) { m = rawSection({ ...o, clmax: (o.clmax ?? 1.5) * k }); k *= (o.clmax ?? 1.5) / m.clmax; }
  return m;
}
function rawSection({ a = 2 * PI * 0.9, alpha0 = 0, clmax = 1.5, cd0 = 0.008 } = {}) {
  const as = alpha0 + clmax / a / DEG;            // where the straight line would reach cl,max
  const clmin = -0.8 * clmax, asn = alpha0 + clmin / a / DEG;
  const sat = (lin, top) => { const x = lin / top; return top * x / (1 + x ** 8) ** 0.125; };
  const cl = al => {
    const lin = a * (al - alpha0) * DEG;
    let c = lin >= 0 ? sat(lin, clmax * 1.07) : -sat(-lin, -clmin * 1.07);
    if (al > as) { const t = Math.min(1, (al - as) / 7); c -= clmax * 0.32 * t * t * (3 - 2 * t); }
    if (al < asn) { const t = Math.min(1, (asn - al) / 7); c += -clmin * 0.32 * t * t * (3 - 2 * t); }
    const hi = Math.min(1, Math.max(0, (Math.abs(al) - 22) / 14));          // blend to a flat plate at high angle
    return c * (1 - hi) + hi * 1.05 * Math.sin(2 * al * DEG);
  };
  const cd = al => { const c = cl(al); let d = cd0 + 0.006 * c * c; if (al > as) d += 1.1 * Math.sin((al - as) * DEG) ** 2 + 0.02 * (al - as) / 10; if (al < asn) d += 1.1 * Math.sin((asn - al) * DEG) ** 2; return d; };
  // α of the peak, found numerically so it matches cl() exactly
  let aMax = as, cMax = -Infinity; for (let x = as - 6; x <= as + 6; x += 0.02) { const c = cl(x); if (c > cMax) { cMax = c; aMax = x; } }
  return { cl, cd, alphaStall: aMax, clmax: cMax, alpha0, a, kind: 'model' };
}

// A section from tabulated polar points [{ alpha, cl, cd }] (Airfoil Lab sweeps). Past the last converged point the
// section is assumed stalled: lift falls off towards ~60% of the peak and drag grows.
export function tableSection(points, { alpha0 } = {}) {
  const P = points.filter(p => isFinite(p.cl) && isFinite(p.alpha)).sort((a, b) => a.alpha - b.alpha);
  if (P.length < 3) return null;
  let iMax = 0; for (let i = 1; i < P.length; i++) if (P[i].cl > P[iMax].cl) iMax = i;
  let iMin = 0; for (let i = 1; i < P.length; i++) if (P[i].cl < P[iMin].cl) iMin = i;
  const lo = P[0], hi = P[P.length - 1], peak = P[iMax];
  const reached = iMax < P.length - 1;            // the sweep went past the peak
  // lift slope from points near zero lift
  let a = 2 * PI * 0.9;
  const lin = P.filter(p => p.alpha >= -2 && p.alpha <= 5);
  if (lin.length >= 2) a = (lin[lin.length - 1].cl - lin[0].cl) / ((lin[lin.length - 1].alpha - lin[0].alpha) * DEG);
  let a0 = alpha0;
  if (a0 === undefined) { const z = P.findIndex((p, i) => i > 0 && P[i - 1].cl <= 0 && p.cl > 0); a0 = z > 0 ? P[z - 1].alpha + (P[z].alpha - P[z - 1].alpha) * (-P[z - 1].cl) / (P[z].cl - P[z - 1].cl) : 0; }
  const interp = (al, k) => {
    for (let i = 1; i < P.length; i++) if (al <= P[i].alpha) { const u = (al - P[i - 1].alpha) / (P[i].alpha - P[i - 1].alpha); return P[i - 1][k] + u * (P[i][k] - P[i - 1][k]); }
    return hi[k];
  };
  const cl = al => {
    if (al > hi.alpha) { const t = Math.min(1, (al - hi.alpha) / 8); return hi.cl - (hi.cl - 0.6 * peak.cl) * t * t * (3 - 2 * t); }
    if (al < lo.alpha) { const t = Math.min(1, (lo.alpha - al) / 8); return lo.cl - (lo.cl - 0.6 * P[iMin].cl) * t * t * (3 - 2 * t); }
    return interp(al, 'cl');
  };
  const cd = al => {
    if (al > hi.alpha) return (hi.cd || 0.02) + 1.1 * Math.sin((al - hi.alpha) * DEG) ** 2;
    if (al < lo.alpha) return (lo.cd || 0.02) + 1.1 * Math.sin((lo.alpha - al) * DEG) ** 2;
    return interp(al, 'cd') || 0.01;
  };
  return { cl, cd, alphaStall: peak.alpha, clmax: peak.cl, alpha0: a0, a, kind: 'table', reached };
}

// ---------------- wing description and presets ----------------
// W: { shape: 'trapezoid' | 'elliptic', S (m²), AR, taper λ, sweep (quarter-chord, deg), twist (tip relative to root,
//      deg, negative = washout), dihedral (deg), root, tip (NACA codes), winglet: { on, h (fraction of semi-span),
//      cant (deg from vertical), taper, sweep (leading edge, deg) } }
export function defaults() {
  return { preset: 'c172', shape: 'trapezoid', S: 16.2, AR: 7.47, taper: 0.69, sweep: 0, twist: -3, dihedral: 1.7, root: '2412', tip: '2412',
    winglet: { on: false, h: 0.12, cant: 15, taper: 0.4, sweep: 35 } };
}
const W0 = defaults();
export const PRESETS = [
  { id: 'rect', label: 'Rectangular wing (AR 6)', group: 'Textbook wings', w: { shape: 'trapezoid', S: 6, AR: 6, taper: 1, sweep: 0, twist: 0, dihedral: 0, root: '0012', tip: '0012' },
    note: 'The classic test case: constant chord means too much lift near the tips, so e < 1 and the root stalls first.' },
  { id: 'ellip', label: 'Elliptic wing (AR 8)', group: 'Textbook wings', w: { shape: 'elliptic', S: 8, AR: 8, taper: 1, sweep: 0, twist: 0, dihedral: 0, root: '0012', tip: '0012' },
    note: 'Elliptic chord, no twist: elliptic lift, constant downwash and the least induced drag for its span (e = 1).' },
  { id: 'taper', label: 'Highly tapered wing (λ 0.2)', group: 'Textbook wings', w: { shape: 'trapezoid', S: 8, AR: 8, taper: 0.2, sweep: 0, twist: 0, dihedral: 0, root: '2412', tip: '2412' },
    note: 'Small tips carry too high a local cl: efficient in cruise, but the tips stall first unless the wing is washed out.' },
  { id: 'swept', label: 'Swept-back wing (35°)', group: 'Textbook wings', w: { shape: 'trapezoid', S: 10, AR: 6, taper: 0.4, sweep: 35, twist: 0, dihedral: 0, root: '2412', tip: '2412' },
    note: 'Sweep moves lift outboard and the boundary layer drifts outward: swept wings tend to stall at the tips and pitch up.' },
  { id: 'fsw', label: 'Forward-swept wing (−25°)', group: 'Textbook wings', w: { shape: 'trapezoid', S: 10, AR: 7, taper: 0.4, sweep: -25, twist: 0, dihedral: 0, root: '2412', tip: '2412' },
    note: 'X-29-style forward sweep loads the root and stalls there first, keeping the ailerons working.' },
  { id: 'delta', label: 'Delta wing (60° leading edge)', group: 'Textbook wings', w: { shape: 'trapezoid', S: 20, AR: 2.31, taper: 0, sweep: 52.4, twist: 0, dihedral: 0, root: '0005', tip: '0005' },
    note: 'Low aspect ratio: a low lift slope and high induced drag. Real deltas gain extra vortex lift at high angle that this linear model leaves out.' },
  { id: 'c172', label: 'Light single (Cessna 172-class)', group: 'Aircraft', ac: 'c172', w: { shape: 'trapezoid', S: 16.2, AR: 7.47, taper: 0.69, sweep: 0, twist: -3, dihedral: 1.7, root: '2412', tip: '2412' },
    note: 'Straight, mildly tapered wing with about 3° of washout so the stall starts at the root, away from the ailerons.' },
  { id: 'glider', label: 'Sailplane (15 m class)', group: 'Aircraft', ac: 'glider', w: { shape: 'trapezoid', S: 10.5, AR: 21.4, taper: 0.5, sweep: 0, twist: -2, dihedral: 3, root: '4412', tip: '4412' },
    note: 'Very high aspect ratio for low induced drag: the whole design is about span.' },
  { id: 'a320', label: 'Airliner (A320-class)', group: 'Aircraft', ac: 'a320', w: { shape: 'trapezoid', S: 122.6, AR: 10.45, taper: 0.24, sweep: 25, twist: -3, dihedral: 5.1, root: '2414', tip: '2410' },
    note: 'Swept for cruise at Mach 0.78 and washed out to keep the tips from stalling. The real wing has a kink (Yehudi) that this straight-tapered planform smooths over.' },
  { id: 'cca', label: 'Combat drone (CCA-class)', group: 'Aircraft', ac: 'cca', w: { shape: 'trapezoid', S: 10, AR: 6.72, taper: 0.4, sweep: 15, twist: -2, dihedral: 2, root: '2412', tip: '2410' },
    note: 'Moderate sweep and aspect ratio for range at high subsonic speed. Illustrative of the class.' },
  { id: 'f16', label: 'Fighter (F-16-class)', group: 'Aircraft', ac: 'f16', w: { shape: 'trapezoid', S: 27.87, AR: 3.2, taper: 0.23, sweep: 32, twist: 0, dihedral: 0, root: '0004', tip: '0004' },
    note: 'Thin, low-aspect-ratio swept wing. The strakes and the vortex lift they make at high angle are not modelled.' },
];
export function applyPreset(W, id) {
  const p = PRESETS.find(x => x.id === id); if (!p) return W;
  Object.assign(W, { ...W0, ...p.w, winglet: { ...W0.winglet, ...(W.winglet || {}), on: false }, preset: id });
  return W;
}

// planform numbers
export function planform(W) {
  const b = Math.sqrt(W.AR * W.S), s = b / 2, ell = W.shape === 'elliptic';
  const lam = ell ? 1 : Math.max(0, W.taper), tS = Math.tan(W.sweep * DEG);
  const cr = ell ? 4 * W.S / (PI * b) : 2 * W.S / (b * (1 + lam)), ct = ell ? 0 : cr * lam;
  const chord = e => ell ? cr * Math.sqrt(Math.max(0, 1 - e * e)) : cr * (1 - (1 - lam) * e);
  const xc4 = e => cr / 4 + e * s * tS;               // quarter-chord line, root leading edge at x = 0
  const xle = e => xc4(e) - chord(e) / 4;
  const zof = e => e * s * Math.tan(W.dihedral * DEG);
  // mean aerodynamic chord and its position
  let A = 0, Ac2 = 0, Ay = 0, Ax = 0; const n = 400;
  for (let i = 0; i < n; i++) { const e = (i + 0.5) / n, c = chord(e), dy = s / n; A += c * dy; Ac2 += c * c * dy; Ay += c * c * e * s * dy; Ax += c * c * xle(e) * dy; }
  const mac = Ac2 / A, yMac = Ay / Ac2, xMac = Ax / Ac2;
  const sweepLE = Math.atan(tS + (ell ? 0 : (1 - lam) / (W.AR * (1 + lam)))) / DEG;
  const sweepTE = Math.atan(tS - (ell ? 0 : 3 * (1 - lam) / (W.AR * (1 + lam)))) / DEG;
  return { b, s, cr, ct, lam, mac, yMac, xMac, xRef: xMac + mac / 4, sweepLE, sweepTE, chord, xle, xc4, z: zof, S: W.S, AR: W.AR, elliptic: ell };
}

// ---------------- lattice ----------------
// Stations run along the whole span from the left (winglet) tip to the right one; a strip lies between neighbours.
function stations(W, P, nS, spacing = 'sine') {
  const g = t => spacing === 'uniform' ? t : Math.sin(PI / 2 * t);
  const st = [], wl = W.winglet && W.winglet.on && W.winglet.h > 0;
  const tw = e => W.twist * Math.abs(e), a0r = nacaAlpha0(W.root), a0t = nacaAlpha0(W.tip);
  const a0 = e => a0r + (a0t - a0r) * Math.abs(e);
  const right = [];
  for (let k = 0; k <= nS; k++) {
    const e = g(k / nS);
    // the elliptic tip has zero chord; keep a sliver so the tip panel is not degenerate
    const c = Math.max(P.chord(e), P.cr * 1e-3);
    right.push({ x: P.xc4(e) - c / 4, y: e * P.s, z: P.z(e), c, tw: tw(e), a0: a0(e), eta: e, part: 'wing', t: k / nS, g: e });
  }
  if (wl) {
    const wg = W.winglet, hw = wg.h * P.s, cant = wg.cant * DEG, tip = right[right.length - 1];
    const nW = Math.max(4, Math.round(nS * wg.h * 2.2)), tL = Math.tan(wg.sweep * DEG);
    // a short fillet would be nicer; a sharp corner is the usual vortex-lattice model
    for (let k = 1; k <= nW; k++) {
      const t = g(k / nW), d = t * hw;
      right.push({ x: tip.x + d * tL, y: tip.y + d * Math.sin(cant), z: tip.z + d * Math.cos(cant), c: Math.max(tip.c * (1 - (1 - wg.taper) * t), tip.c * 0.02), tw: tip.tw, a0: tip.a0, eta: 1 + t * wg.h, part: 'winglet', t: 1 + k / nW, g: 1 + t });
    }
  }
  for (let k = right.length - 1; k >= 1; k--) { const r = right[k]; st.push({ ...r, y: -r.y, eta: -r.eta }); }
  for (const r of right) st.push(r);
  st.gmap = t => t <= 1 ? g(t) : 1 + g(t - 1);
  return st;
}

const LAT_CACHE = new Map();
export function lattice(W, { nS = 24, nC = 6, M = 0, ground = null, spacing = 'sine' } = {}) {
  const key = JSON.stringify([W.shape, W.S, W.AR, W.taper, W.sweep, W.twist, W.dihedral, W.root, W.tip, W.winglet && W.winglet.on ? W.winglet : 0, nS, nC, +M.toFixed(4), ground, spacing]);
  if (LAT_CACHE.has(key)) { const L = LAT_CACHE.get(key); LAT_CACHE.delete(key); LAT_CACHE.set(key, L); return L; }
  const P = planform(W), beta = Math.sqrt(Math.max(0.05, 1 - Math.min(M, 0.95) ** 2));
  const st = stations(W, P, nS, spacing), ns = st.length - 1;
  const strips = [], pan = [];
  for (let k = 0; k < ns; k++) {
    const a = st[k], b = st[k + 1];
    const ly = b.y - a.y, lz = b.z - a.z, len = Math.hypot(ly, lz);
    const n0 = [0, -lz / len, ly / len];             // x̂ × l̂: "up" for the wing, inboard for a winglet
    // control point at the parametric middle of the strip (the "semi-circle" rule for cosine-type spacing), which
    // keeps the discrete wing from beating the elliptic optimum
    const f = (st.gmap((a.t + b.t) / 2) - a.g) / (b.g - a.g);
    const lp = (u, v) => u + (v - u) * f;
    const mid = { y: lp(a.y, b.y), z: lp(a.z, b.z), c: lp(a.c, b.c), x: lp(a.x, b.x), tw: lp(a.tw, b.tw), a0: lp(a.a0, b.a0), eta: lp(a.eta, b.eta), f };
    const part = a.part === 'winglet' || b.part === 'winglet' ? 'winglet' : 'wing';
    strips.push({ k, a, b, ly, lz, len, n0, ...mid, part, i0: pan.length });
    for (let j = 0; j < nC; j++) {
      const f0 = j / nC, f1 = (j + 1) / nC, fb = f0 + 0.25 / nC, fc = f0 + 0.75 / nC;
      const A = [a.x + fb * a.c, a.y, a.z], B = [b.x + fb * b.c, b.y, b.z];
      const C = [lp(a.x + fc * a.c, b.x + fc * b.c), mid.y, mid.z];
      const corners = [[a.x + f0 * a.c, a.y, a.z], [b.x + f0 * b.c, b.y, b.z], [b.x + f1 * b.c, b.y, b.z], [a.x + f1 * a.c, a.y, a.z]];
      const area = len * ((f1 - f0) * (a.c + b.c) / 2);
      pan.push({ s: k, j, A, B, C, corners, area, xb: (A[0] + B[0]) / 2 });
    }
  }
  const N = pan.length, Amat = new Float64Array(N * N);
  const sx = 1 / beta, core = 1e-9 * P.b * P.b;
  const S3 = p => [p[0] * sx, p[1], p[2]];
  const As = pan.map(p => S3(p.A)), Bs = pan.map(p => S3(p.B)), Cs = pan.map(p => S3(p.C));
  const img = p => [p[0], p[1], -2 * ground - p[2]];
  const v = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    const n = strips[pan[i].s].n0, C = Cs[i];
    for (let j = 0; j < N; j++) {
      v[0] = v[1] = v[2] = 0;
      horseshoe(C, As[j], Bs[j], 1, v, core);
      if (ground !== null) horseshoe(C, img(As[j]), img(Bs[j]), -1, v, core);
      Amat[i * N + j] = v[0] * 0 + v[1] * n[1] + v[2] * n[2];   // x-velocity times n0x (= 0); the tilt is in the RHS
    }
  }
  const F = luFactor(Amat, N);
  const L = { W: JSON.parse(JSON.stringify(W)), P, st, strips, pan, N, F, nS, nC, M, beta, ground, As, Bs, core };
  LAT_CACHE.set(key, L); if (LAT_CACHE.size > 12) LAT_CACHE.delete(LAT_CACHE.keys().next().value);
  return L;
}

// velocity at P from a horseshoe A→B with legs trailing to +x, strength G, added into out
function horseshoe(P, A, B, G, out, core) {
  segment(P, A, B, G, out, core);
  semiInf(P, B, G, out, core);
  semiInf(P, A, -G, out, core);
}
function segment(P, A, B, G, out, core) {
  const r1x = P[0] - A[0], r1y = P[1] - A[1], r1z = P[2] - A[2];
  const r2x = P[0] - B[0], r2y = P[1] - B[1], r2z = P[2] - B[2];
  const cx = r1y * r2z - r1z * r2y, cy = r1z * r2x - r1x * r2z, cz = r1x * r2y - r1y * r2x;
  const c2 = cx * cx + cy * cy + cz * cz;
  const r0x = B[0] - A[0], r0y = B[1] - A[1], r0z = B[2] - A[2];
  const l2 = r0x * r0x + r0y * r0y + r0z * r0z;
  if (c2 < core * l2 || c2 === 0) return;
  const n1 = Math.sqrt(r1x * r1x + r1y * r1y + r1z * r1z), n2 = Math.sqrt(r2x * r2x + r2y * r2y + r2z * r2z);
  const k = G / (FOUR_PI * c2) * (r0x * (r1x / n1 - r2x / n2) + r0y * (r1y / n1 - r2y / n2) + r0z * (r1z / n1 - r2z / n2));
  out[0] += k * cx; out[1] += k * cy; out[2] += k * cz;
}
// semi-infinite line from A along +x, strength G
function semiInf(P, A, G, out, core) {
  const rx = P[0] - A[0], ry = P[1] - A[1], rz = P[2] - A[2];
  const d2 = ry * ry + rz * rz;
  if (d2 < core) return;
  const r = Math.sqrt(rx * rx + d2), k = G * (1 + rx / r) / (FOUR_PI * d2);
  out[1] += -k * rz; out[2] += k * ry;
}

// ---------------- linear solve ----------------
// cond: { alpha (deg), extra: per-strip extra incidence (deg) }; several angles at once via alphas[]
function rhs(L, alphaDeg, extra) {
  const b = new Float64Array(L.N);
  const al = alphaDeg * DEG;
  for (let i = 0; i < L.N; i++) {
    const s = L.strips[L.pan[i].s];
    const io = (s.tw - s.a0 + (extra ? extra[s.k] : 0)) * DEG;
    // freestream (cos α, 0, sin α) on the tilted normal n0·cos ι + x̂·sin ι
    b[i] = -(Math.cos(al) * Math.sin(io) + Math.sin(al) * Math.cos(io) * s.n0[2] + 0 * s.n0[1]);
  }
  return b;
}

export function solveLattice(L, alphaDeg, extra = null) {
  const G = luSolve(L.F, rhs(L, alphaDeg, extra), 1);
  return post(L, G, alphaDeg);
}

function post(L, G, alphaDeg) {
  const { strips, pan, P, W } = L, S = W.S;
  const ns = strips.length;
  const Gs = new Float64Array(ns);
  for (let i = 0; i < pan.length; i++) Gs[pan[i].s] += G[i];
  // Trefftz plane: shed vortices at the station points, normal wash at strip midpoints
  const kap = new Float64Array(ns + 1);
  for (let k = 0; k <= ns; k++) kap[k] = (k > 0 ? Gs[k - 1] : 0) - (k < ns ? Gs[k] : 0);
  const sy = L.st.map(p => p.y), sz = L.st.map(p => p.z);
  const wn = new Float64Array(ns);
  for (let s = 0; s < ns; s++) {
    const st = strips[s]; let vy = 0, vz = 0;
    for (let k = 0; k <= ns; k++) {
      let dy = st.y - sy[k], dz = st.z - sz[k], r2 = dy * dy + dz * dz;
      if (r2 > 0) { vy += -kap[k] * dz / (2 * PI * r2); vz += kap[k] * dy / (2 * PI * r2); }
      if (L.ground !== null) { const zi = -2 * L.ground - sz[k]; dz = st.z - zi; r2 = dy * dy + dz * dz; if (r2 > 0) { vy -= -kap[k] * dz / (2 * PI * r2); vz -= kap[k] * dy / (2 * PI * r2); } }
    }
    wn[s] = vy * st.n0[1] + vz * st.n0[2];
  }
  let Lz = 0, Di = 0, My = 0, Mb = 0, Fy = 0;
  const xRef = P.xRef;
  const out = [];
  for (let s = 0; s < ns; s++) {
    const st = strips[s], g = Gs[s];
    Lz += g * st.ly; Fy += -g * st.lz;
    Di += -0.5 * g * wn[s] * st.len;
    if (st.y > 0) Mb += g * st.ly * st.y - (-g * st.lz) * st.z;    // right-wing root bending moment about x
    const cl = 2 * g / st.c;
    out.push({ eta: st.eta, y: st.y, z: st.z, c: st.c, x: st.x, part: st.part, G: g, cl, ccl: cl * st.c / P.mac, ai: -wn[s] / 2 / DEG, len: st.len, tw: st.tw, a0: st.a0 });
  }
  for (let i = 0; i < pan.length; i++) { const st = strips[pan[i].s]; My += -G[i] * st.ly * (pan[i].xb - xRef); }
  const q = 0.5;
  const CL = Lz / (q * S), CDi = Di / (q * S), Cm = My / (q * S * P.mac);
  const e = CDi > 1e-12 ? CL * CL / (PI * W.AR * CDi) : NaN;
  // arc length along the span (for winglet plots), from the root outward
  let arc = 0; const ar = new Float64Array(ns);
  const half = ns / 2;
  for (let s = half; s < ns; s++) { arc += strips[s].len / 2; ar[s] = arc; arc += strips[s].len / 2; }
  arc = 0; for (let s = half - 1; s >= 0; s--) { arc += strips[s].len / 2; ar[s] = -arc; arc += strips[s].len / 2; }
  out.forEach((o, s) => { o.arc = ar[s] / P.s; });
  const dcp = new Float64Array(pan.length);
  for (let i = 0; i < pan.length; i++) dcp[i] = 2 * G[i] * strips[pan[i].s].len / pan[i].area;
  return { alpha: alphaDeg, CL, CDi, e, Cm, CY: Fy / (q * S), Mb, Cb: Mb / (q * S * P.s), ycp: Lz > 1e-12 ? 2 * Mb / Lz / P.s : NaN,
    G, Gs, kap, strips: out, dcp, L };
}

// Linear analysis at one angle, with the slope, aerodynamic centre and zero-lift angle from a second solve.
export function analyze(W, cond = {}) {
  const L = lattice(W, { nS: cond.nS ?? 24, nC: cond.nC ?? 6, M: cond.M ?? 0, ground: cond.ground ?? null, spacing: cond.spacing });
  const a = cond.alpha ?? 4, da = 1;
  const B = new Float64Array(L.N * 2), r1 = rhs(L, a), r2 = rhs(L, a + da);
  for (let i = 0; i < L.N; i++) { B[i * 2] = r1[i]; B[i * 2 + 1] = r2[i]; }
  const X = luSolve(L.F, B, 2), G1 = new Float64Array(L.N), G2 = new Float64Array(L.N);
  for (let i = 0; i < L.N; i++) { G1[i] = X[i * 2]; G2[i] = X[i * 2 + 1]; }
  const s1 = post(L, G1, a), s2 = post(L, G2, a + da);
  const CLa = (s2.CL - s1.CL) / (da * DEG), Cma = (s2.Cm - s1.Cm) / (da * DEG);
  // aerodynamic centre: x where Cm does not change with α, as a fraction of the MAC aft of its leading edge
  const xac = (L.P.xRef - Cma / CLa * L.P.mac - L.P.xMac) / L.P.mac;
  s1.CLa = CLa; s1.xac = xac; s1.alphaL0 = a - s1.CL / CLa / DEG; s1.Cm0 = s1.Cm - Cma * (a * DEG - s1.alphaL0 * DEG);
  s1.G2 = G2; s1.P = L.P; s1.beta = L.beta;
  return s1;
}

// velocity induced at a physical point by a solution (V = 1); includes the ground image
export function induced(sol, p) {
  const L = sol.L, sx = 1 / L.beta, P = [p[0] * sx, p[1], p[2]], v = [0, 0, 0];
  const img = q => [q[0], q[1], -2 * L.ground - q[2]];
  const core = Math.max(L.core, 1e-4 * L.P.b * L.P.b);
  for (let j = 0; j < L.N; j++) {
    horseshoe(P, L.As[j], L.Bs[j], sol.G[j], v, core);
    if (L.ground !== null) horseshoe(P, img(L.As[j]), img(L.Bs[j]), -sol.G[j], v, core);
  }
  return v;
}
// downwash angle (deg) at a point, measured from the freestream
export const downwash = (sol, p) => -induced(sol, p)[2] / DEG;

// ---------------- lifting-line theory (Glauert) ----------------
// Straight wing only: sweep, dihedral and winglets are ignored. Section slope a0 per rad.
export function liftingLine(W, { alpha = 4, N = 40, a0 = 2 * PI } = {}) {
  const P = planform(W), b = P.b, a0r = nacaAlpha0(W.root), a0t = nacaAlpha0(W.tip);
  const th = [], M = new Float64Array(N * N), r = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const t = (i + 1) * PI / (2 * N); th.push(t);
    const e = Math.abs(Math.cos(t)), c = P.chord(e), mu = a0 * c / (4 * b);
    const ag = (alpha + W.twist * e - (a0r + (a0t - a0r) * e)) * DEG;
    for (let k = 0; k < N; k++) { const n = 2 * k + 1; M[i * N + k] = Math.sin(n * t) * (Math.sin(t) + n * mu); }
    r[i] = mu * ag * Math.sin(t);
  }
  const An = luSolve(luFactor(M, N), r, 1);
  const CL = PI * W.AR * An[0];
  let sum = 0; for (let k = 0; k < N; k++) { const n = 2 * k + 1; sum += n * An[k] * An[k]; }
  const CDi = PI * W.AR * sum, delta = An[0] !== 0 ? sum / (An[0] * An[0]) - 1 : 0;
  const strips = th.map(t => { const e = Math.cos(t); let g = 0; for (let k = 0; k < N; k++) g += An[k] * Math.sin((2 * k + 1) * t); const c = P.chord(e); g *= 2 * b; return { eta: e, y: e * P.s, G: g, cl: c > 1e-9 ? 2 * g / c : NaN, ccl: 2 * g / P.mac }; });
  return { CL, CDi, e: 1 / (1 + delta), delta, An, strips };
}

// ---------------- nonlinear strips (stall) ----------------
// sect(eta, M) → section { cl(α), cd(α), alphaStall, clmax, a }; returns strips with α_eff, cl, stalled flags.
// warm: a previous result to start from (alpha sweeps).
export function nonlinear(W, { alpha, M = 0, ground = null, nS = 20, sect, warm = null, iters = 120 } = {}) {
  const L = lattice(W, { nS, nC: 1, M, ground });
  const ns = L.strips.length, a2d = 2 * PI / L.beta;
  const secs = L.strips.map(s => sect(s.eta, s.part));
  const dA = warm && warm.dA && warm.dA.length === ns ? Float64Array.from(warm.dA) : new Float64Array(ns);
  let sol, res = 1, it = 0;
  const relax = 0.45;
  const aeff = new Float64Array(ns), clt = new Float64Array(ns);
  for (; it < iters; it++) {
    sol = solveLattice(L, alpha, dA);
    res = 0;
    for (let s = 0; s < ns; s++) {
      const st = sol.strips[s];
      // the angle this section sees from its own chord: the lattice's cl read back through a thin section's slope,
      // less the artificial extra incidence (in the linear range this is α + twist − induced angle)
      aeff[s] = st.cl / a2d / DEG + st.a0 - dA[s];
      clt[s] = secs[s].cl(aeff[s]);
      const d = clt[s] - st.cl;
      res = Math.max(res, Math.abs(d));
      dA[s] += relax * d / a2d / DEG;
    }
    // past the peak each strip has more than one answer, and neighbours can settle on opposite branches (a sawtooth
    // of stalled and attached strips). Light spanwise smoothing of the correction on stalled strips picks the
    // contiguous stall cell real wings show; attached strips are left exactly as they are.
    const sm = Float64Array.from(dA);
    for (let s = 1; s < ns - 1; s++) {
      if (aeff[s] <= secs[s].alphaStall || L.strips[s - 1].part !== L.strips[s].part || L.strips[s + 1].part !== L.strips[s].part) continue;
      sm[s] = dA[s] + 0.35 * ((dA[s - 1] + dA[s + 1]) / 2 - dA[s]);
    }
    dA.set(sm);
    if (res < 2e-4) break;
  }
  let CDp = 0;
  const strips = sol.strips.map((st, s) => {
    const sec = secs[s], cd = sec.cd(aeff[s]);
    if (st.part === 'wing') CDp += cd * st.c * st.len / W.S;
    return { ...st, aeff: aeff[s], clSec: clt[s], clmax: sec.clmax, alphaStall: sec.alphaStall, margin: sec.alphaStall - aeff[s], stalled: aeff[s] > sec.alphaStall, cd };
  });
  return { alpha, CL: sol.CL, CDi: sol.CDi, CDp, Cm: sol.Cm, strips, conv: res < 2e-3, res, iters: it, dA, sol };
}

// CL–α sweep of the nonlinear model, marching out from zero
export function sweepAlpha(W, { a0 = -4, a1 = 24, step = 0.5, ...o } = {}) {
  const out = []; let warm = null;
  for (let a = Math.max(0, a0); a <= a1 + 1e-9; a += step) { const r = nonlinear(W, { ...o, alpha: a, warm }); warm = r; out.push(r); }
  warm = out[0];
  const neg = [];
  for (let a = Math.min(0, a1) - step; a >= a0 - 1e-9; a -= step) { const r = nonlinear(W, { ...o, alpha: a, warm }); warm = r; neg.unshift(r); }
  const all = [...neg, ...out];
  let iMax = 0; for (let i = 1; i < all.length; i++) if (all[i].CL > all[iMax].CL) iMax = i;
  // first stall: the lowest angle at which any wing strip passes its section's stall angle
  const first = all.find(r => r.alpha >= 0 && r.strips.some(s => s.part === 'wing' && s.stalled));
  let where = NaN;
  if (first) { let best = -Infinity; for (const s of first.strips) if (s.part === 'wing' && s.y >= 0 && -s.margin > best) { best = -s.margin; where = s.eta; } }
  return { pts: all, CLmax: all[iMax].CL, alphaCLmax: all[iMax].alpha, firstStall: first ? { alpha: first.alpha, eta: where } : null };
}

// ---------------- wake roll-up ----------------
// The Trefftz-plane vortices advected by their own velocity (2-D, Krasny smoothing δ). Returns frames at distances
// x behind the trailing edge (in spans), each with the points (y, z) of the sheet.
export function rollup(sol, { spans = 6, frames = 60, delta = 0.04, sub = 4 } = {}) {
  const L = sol.L, b = L.P.b, n = sol.kap.length;
  let y = Float64Array.from(L.st.map(p => p.y)), z = Float64Array.from(L.st.map(p => p.z));
  const k = sol.kap, d2 = (delta * b / 2) ** 2;
  const vel = (Y, Z) => {
    const vy = new Float64Array(n), vz = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let a = 0, c = 0;
      for (let j = 0; j < n; j++) {
        if (i === j || k[j] === 0) continue;
        let dy = Y[i] - Y[j], dz = Z[i] - Z[j], r2 = dy * dy + dz * dz + d2;
        a += -k[j] * dz / (2 * PI * r2); c += k[j] * dy / (2 * PI * r2);
        if (L.ground !== null) { const zi = -2 * L.ground - Z[j]; dz = Z[i] - zi; r2 = dy * dy + dz * dz + d2; a -= -k[j] * dz / (2 * PI * r2); c -= k[j] * dy / (2 * PI * r2); }
      }
      vy[i] = a; vz[i] = c;
    }
    return [vy, vz];
  };
  const out = [{ x: 0, y: Array.from(y), z: Array.from(z) }];
  const dx = spans * b / frames / sub;              // V = 1, so distance = time
  for (let f = 1; f <= frames; f++) {
    for (let s = 0; s < sub; s++) {
      const [a1, c1] = vel(y, z);
      const ym = y.map((v, i) => v + 0.5 * dx * a1[i]), zm = z.map((v, i) => v + 0.5 * dx * c1[i]);
      const [a2, c2] = vel(ym, zm);
      y = y.map((v, i) => v + dx * a2[i]); z = z.map((v, i) => v + dx * c2[i]);
    }
    out.push({ x: f * dx * sub, y: Array.from(y), z: Array.from(z) });
  }
  return out;
}

// Wieselsberger's ground-effect factor on induced drag (h: height of the wing above the ground, b: span)
export const wieselsberger = (h, b) => { const r = 16 * h / b; return r * r / (1 + r * r); };

// The same factor for an elliptically loaded lifting line and its mirror-image trailing sheet (h/b = height/span),
// by direct integration: the image's upwash at the wing over the wing's own uniform downwash.
export function imageGround(h, b) {
  // semi-span 1, so the image sheet lies d = 2h/(b/2) below; y = cos θ and η = cos φ take out the tip singularities
  const n = 300, d = 4 * h / b, dt = PI / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const th = (i + 0.5) * dt, y = Math.cos(th); let wi = 0;
    // shed vorticity −dΓ/dη = η/√(1 − η²) with dη = sin φ dφ: the integrand becomes cos φ
    for (let j = 0; j < n; j++) { const e = Math.cos((j + 0.5) * dt), dy = y - e; wi += e * dy / (dy * dy + d * d) * dt; }
    const Gdy = Math.sin(th) ** 2 * dt;            // Γ dy
    num += Gdy * wi / (4 * PI); den += Gdy / 4;    // wing's own downwash is Γ0/(2b) = 1/4
  }
  return 1 + num / den;           // num is the (negative) image upwash, which lowers the induced drag
}

// Span extension that gives the same right-wing root bending moment as a reference solution, at the same CL.
export function equalMomentExtension(W, ref, { alpha, M = 0, nS = 24, nC = 4 } = {}) {
  const at = ext => {
    const w = { ...W, winglet: { ...W.winglet, on: false } };
    const P = planform(W), b = P.b * (1 + ext);
    // grow the span at constant root chord and taper; area follows
    const lam = W.shape === 'elliptic' ? 1 : W.taper, cr = P.cr;
    w.S = W.shape === 'elliptic' ? PI * b * cr / 4 : b * cr * (1 + lam) / 2; w.AR = b * b / w.S;
    const s = analyze(w, { alpha, M, nS, nC });
    // trim to the reference lift, so lift and bending are compared at the same force
    const k = (ref.CL * W.S) / (s.CL * w.S);
    return { w, s, Mb: s.Mb * k, CDiF: s.CDi * w.S * k * k / W.S };
  };
  let lo = 0, hi = 0.4, r = at(hi);
  if (r.Mb < ref.Mb) return r;
  for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; r = at(m); if (r.Mb > ref.Mb) hi = m; else lo = m; }
  r = at((lo + hi) / 2); r.ext = (lo + hi) / 2;
  return r;
}
