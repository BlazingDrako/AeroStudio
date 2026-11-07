// Static and dynamic stability (no DOM). Small-disturbance, stability-axis models about steady level flight.
//   Geometry → derivatives by the classical estimation methods (Nelson, "Flight Stability and Automatic Control";
//   Etkin & Reid, "Dynamics of Flight"; DATCOM-style lift slopes): neutral point, static margin, trim, elevator
//   per g; longitudinal [u, w, q, θ] and lateral [β, p, r, φ] state matrices; eigenvalues and eigenvectors (modes);
//   linear time responses; MIL-F-8785C handling-quality levels (Category B, cruise).
import { atmosphere, G0 } from './atmosphere.js';
import { byId, polar } from './performance.js';

const DEG = Math.PI / 180;

// Geometry per aircraft (SI). Representative values from published three-views and specifications.
//   c MAC, sweep quarter-chord, taper λ, dihedral Γ, wing position, fuselage length/width, wing c/4 position along
//   the fuselage; horizontal tail (area, aspect ratio, arm from the wing-body aerodynamic centre, efficiency η,
//   elevator effectiveness τ); vertical tail (area, AR, arm, height of its centre above the CG); aileron span (y/semi-span)
//   and effectiveness; rudder effectiveness; zero-α lift and wing pitching moment; CG limits (fraction of MAC);
//   moments of inertia at mass mI.
export const GEOMETRY = {
  c172: { c: 1.49, sweep: 0, taper: 0.69, dihedral: 1.73, wing: 'high', L: 8.28, wf: 1.0, xw: 0.30,
    ht: { S: 3.25, AR: 4.0, l: 4.65, eta: 0.9, tau: 0.5, sweep: 5 }, vt: { S: 1.70, AR: 1.5, l: 4.8, z: 0.9, sweep: 35 },
    ail: [0.46, 0.95, 0.45], rud: 0.5, CL0: 0.25, Cmac: -0.05, cg: [0.16, 0.36, 0.27], mI: 1043, I: [1285, 1825, 2667, 0] },
  glider: { c: 0.73, sweep: 0, taper: 0.5, dihedral: 3, wing: 'mid', L: 6.7, wf: 0.62, xw: 0.33,
    ht: { S: 0.98, AR: 6.5, l: 3.85, eta: 0.95, tau: 0.45, sweep: 5 }, vt: { S: 0.95, AR: 1.3, l: 4.0, z: 0.8, sweep: 25 },
    ail: [0.55, 0.98, 0.4], rud: 0.5, CL0: 0.35, Cmac: -0.08, cg: [0.22, 0.42, 0.32], mI: 400, I: [1500, 580, 2100, 0] },
  a320: { c: 4.19, sweep: 25, taper: 0.24, dihedral: 5.1, wing: 'low', L: 37.6, wf: 3.95, xw: 0.43,
    ht: { S: 31, AR: 5.0, l: 16.4, eta: 0.9, tau: 0.5, sweep: 29 }, vt: { S: 21.5, AR: 1.8, l: 14.5, z: 3.8, sweep: 34 },
    ail: [0.73, 0.93, 0.4], rud: 0.55, CL0: 0.25, Cmac: -0.08, cg: [0.17, 0.41, 0.30], mI: 65000, I: [1.18e6, 3.3e6, 4.4e6, 0] },
  cca: { c: 1.30, sweep: 15, taper: 0.4, dihedral: 2, wing: 'mid', L: 9.1, wf: 0.9, xw: 0.5,
    ht: { S: 2.5, AR: 3.0, l: 3.6, eta: 0.9, tau: 0.55, sweep: 30 }, vt: { S: 1.3, AR: 1.4, l: 3.4, z: 0.7, sweep: 35 },
    ail: [0.5, 0.9, 0.45], rud: 0.5, CL0: 0.10, Cmac: -0.03, cg: [0.16, 0.30, 0.22], mI: 2300, I: [3480, 5520, 9500, 0] },
  // dhn: lift of the strakes (LEX) and blended body, missing from the simple estimate; set so the aircraft is
  // about 4% unstable at its 35% MAC reference CG (relaxed static stability)
  f16: { c: 3.45, sweep: 32, taper: 0.23, dihedral: 0, wing: 'mid', L: 15.0, wf: 1.2, xw: 0.52, dhn: 0.06,
    ht: { S: 5.92, AR: 2.6, l: 5.6, eta: 0.9, tau: 1.0, sweep: 35 }, vt: { S: 5.09, AR: 1.3, l: 4.6, z: 1.7, sweep: 40 },
    ail: [0.25, 0.65, 0.5], rud: 0.5, CL0: 0.05, Cmac: -0.02, cg: [0.30, 0.40, 0.35], mI: 9295, I: [12875, 75674, 85552, 1331],
    relaxed: true },
};

// DATCOM/Helmbold lift-curve slope of a finite wing (per rad), subsonic
export function liftSlope(AR, sweepDeg, M) {
  const b2 = Math.max(0.05, 1 - M * M), t = Math.tan(sweepDeg * DEG);
  return 2 * Math.PI * AR / (2 + Math.sqrt(AR * AR * b2 / 0.95 ** 2 * (1 + t * t / b2) + 4));
}
// Perkins & Hage fuselage pitching-moment factor (per deg) against the wing's position along the fuselage
const KF = [[0.1, 0.002], [0.2, 0.004], [0.3, 0.008], [0.4, 0.013], [0.5, 0.020], [0.6, 0.031]];
const interp = (T, x) => { if (x <= T[0][0]) return T[0][1]; for (let i = 1; i < T.length; i++) if (x <= T[i][0]) { const [a, fa] = T[i - 1], [b, fb] = T[i]; return fa + (fb - fa) * (x - a) / (b - a); } return T[T.length - 1][1]; };

// All derivatives at a flight condition. opts: { id, mass, z, dT, V, cg, ht: area factor, vt: area factor, dihedral: Δdeg }
export function derivatives(o) {
  const ac = byId(o.id), g = GEOMETRY[o.id], atm = atmosphere(o.z, o.dT ?? 0);
  const V = o.V, M = Math.min(V / atm.a, 0.95), q = 0.5 * atm.rho * V * V, S = ac.S, b = ac.b, c = g.c, m = o.mass, W = m * G0;
  const A = b * b / S, lam = g.taper, h = o.cg;
  const St = g.ht.S * (o.ht ?? 1), Sv = g.vt.S * (o.vt ?? 1), Gam = (g.dihedral + (o.dihedral ?? 0)) * DEG;
  const CLaw = liftSlope(A, g.sweep, M), CLat = liftSlope(g.ht.AR, g.ht.sweep, M), CLav = liftSlope(1.55 * g.vt.AR, g.vt.sweep, M);
  const deda = 2 * CLaw / (Math.PI * A), eta = g.ht.eta;
  // wing-body aerodynamic centre: quarter chord shifted forward by the fuselage (destabilising)
  const Cmaf = interp(KF, g.xw) / DEG * g.wf ** 2 * g.L / (S * c);
  const hacwb = 0.25 - Cmaf / CLaw;
  const tailLift = eta * St / S * CLat * (1 - deda);
  const CLa = CLaw + tailLift;
  const hn = (hacwb * CLaw + tailLift * (hacwb + g.ht.l / c)) / CLa + (g.dhn || 0);
  const ltcg = g.ht.l + (hacwb - h) * c, VH = St * ltcg / (S * c);
  const Cma = CLa * (h - hn);
  // pitch damping: tail (+10% for the fuselage) plus the wing's own (DATCOM, low-speed factor 0.7)
  const xb = hacwb - h, cL = Math.cos(g.sweep * DEG), tL = Math.tan(g.sweep * DEG);
  const Cmqw = -0.7 * CLaw * cL * (A * (2 * xb * xb + 0.5 * xb) / (A + 2 * cL) + A ** 3 * tL * tL / (24 * (A + 6 * cL)) + 0.125);
  const Cmq = -2.2 * eta * VH * CLat * ltcg / c + Cmqw, Cmad = -2 * eta * VH * CLat * ltcg / c * deda;
  const CLq = 2 * eta * VH * CLat, CLad = 2 * eta * VH * CLat * deda;
  const CLde = eta * St / S * CLat * g.ht.tau, Cmde = -eta * VH * CLat * g.ht.tau;
  // zero-α terms (tail incidence chosen so the design condition trims with the elevator at zero)
  const eps0 = 2 * g.CL0 / (Math.PI * A), it = o.it ?? 0, CLt0 = CLat * (it - eps0);
  const CL0 = g.CL0 + eta * St / S * CLt0;
  const Cm0 = g.Cmac + g.CL0 * (h - hacwb) - eta * VH * CLt0;
  // drag
  const CLtrim = W / (q * S), pol = polar(ac, M), CD = pol.CD0 + pol.K * CLtrim ** 2, CDa = 2 * pol.K * CLtrim * CLa;
  const CLu = M < 0.9 ? M * M / (1 - M * M) * CLtrim : 0;
  // lateral-directional
  const zw = g.wing === 'high' ? 1 : g.wing === 'low' ? -1 : 0;
  const sidewash = 0.724 + 3.06 * (Sv / S) / (1 + Math.cos(g.sweep * DEG)) + 0.4 * zw * 0.3 + 0.009 * A;
  const Cybv = -sidewash * Sv / S * CLav, VV = Sv * g.vt.l / (S * b);
  const vol = Math.PI / 4 * g.wf ** 2 * g.L * 0.65;
  const Cyb = Cybv - 0.3 * g.wf ** 2 / S;
  const Cnb = sidewash * VV * CLav - 1.3 * vol / (S * b);
  const Clb = -CLaw * Gam * (1 + 2 * lam) / (6 * (1 + lam)) - CLtrim * Math.tan(g.sweep * DEG) * (1 + 2 * lam) / (6 * (1 + lam)) * 1.2
    - 0.6 * zw * g.wf / b * 1.2 * Math.sqrt(A) / 6 + Cybv * g.vt.z / b;
  const Clp = -CLaw / 12 * (1 + 3 * lam) / (1 + lam);
  const Cnp = -CLtrim / 8;
  const Clr = CLtrim / 4 - 2 * g.vt.l * g.vt.z / (b * b) * Cybv;
  const Cnr = -2 * eta * VV * g.vt.l / b * CLav - pol.CD0 / 4;
  const Cyr = -2 * g.vt.l / b * Cybv, Cyp = 0;
  const cr = 2 * S / (b * (1 + lam)), y1 = g.ail[0] * b / 2, y2 = g.ail[1] * b / 2;
  const I = y => cr * (y * y / 2 - (1 - lam) * 2 / b * y ** 3 / 3);
  const Clda = 2 * CLaw * g.ail[2] / (S * b) * (I(y2) - I(y1)), Cnda = -0.2 * CLtrim * Clda;
  const Cydr = sidewash * Sv / S * CLav * g.rud, Cndr = -sidewash * VV * CLav * g.rud, Cldr = Cydr * g.vt.z / b;
  const k = m / g.mI, [Ixx, Iyy, Izz, Ixz] = g.I.map(x => x * k);
  return {
    ac, g, atm, V, M, q, S, b, c, m, W, A, h, hn, hacwb, SM: hn - h, CLaw, CLat, CLav, deda, CLa, Cma, Cmq, Cmad, CLq, CLad, CLde, Cmde, CL0, Cm0, it,
    CLtrim, CD, CDa, CLu, Cyb, Cnb, Clb, Clp, Cnp, Clr, Cnr, Cyr, Cyp, Clda, Cnda, Cydr, Cndr, Cldr, Ixx, Iyy, Izz, Ixz, VH, VV, sidewash, St, Sv,
    cgRange: g.cg,
  };
}

// Trim: solve CL = W/qS and Cm = 0 for α and δe (rad)
export function trim(d) {
  const det = d.CLa * d.Cmde - d.CLde * d.Cma;
  const alpha = ((d.CLtrim - d.CL0) * d.Cmde + d.CLde * d.Cm0) / det;
  const de = (-d.Cm0 * d.CLa - d.Cma * (d.CLtrim - d.CL0)) / det;
  return { alpha, de };
}
// Tail incidence that trims the design condition with δe = 0
export function designIncidence(o) {
  const d0 = derivatives({ ...o, it: 0 }), d1 = derivatives({ ...o, it: 0.01 });
  const e0 = trim(d0).de, e1 = trim(d1).de;
  return -e0 * 0.01 / (e1 - e0);
}
// Elevator per g in a symmetric pull-up, and the stick-fixed maneuver point
export function perG(d) {
  const qhat = G0 * d.c / (2 * d.V * d.V);       // q̂ per unit (n − 1)
  const r1 = d.CLtrim - d.CLq * qhat, r2 = -d.Cmq * qhat;
  const det = d.CLa * d.Cmde - d.CLde * d.Cma;
  const dde = (d.CLa * r2 - d.Cma * r1) / det;
  const mu = 2 * d.m / (d.atm.rho * d.S * d.c);
  return { dePerG: dde, hm: d.hn - d.Cmq / (2 * mu) };
}

// Dimensional derivatives (Nelson's notation) from the nondimensional set
export function longDim(d) {
  const { q, S, c, m, V, Iyy } = d, eng = d.ac.engine, k = q * S / (m * V), kc = q * S * c / (Iyy * V);
  return {
    U: V, Xu: -(2 * d.CD + (eng === 'piston' ? d.CD : 0)) * k, Xw: -(d.CDa - d.CLtrim) * k,
    Zu: -(d.CLu + 2 * d.CLtrim) * k, Zw: -(d.CLa + d.CD) * k,
    Zwd: -d.CLad * c / (2 * V) * q * S / (m * V), Zq: -d.CLq * c / (2 * V) * q * S / m,
    Mu: 0, Mw: d.Cma * kc, Mwd: d.Cmad * c / (2 * V) * q * S * c / (Iyy * V), Mq: d.Cmq * c / (2 * V) * q * S * c / Iyy,
    Zde: -d.CLde * q * S / m, Mde: d.Cmde * q * S * c / Iyy,
  };
}
// Longitudinal state matrix for x = [u, w, q, θ] (level flight, stability axes); ẇ terms eliminated
export function longFromDim(D) {
  const f = 1 / (1 - (D.Zwd || 0)), Zq = D.Zq || 0, Mwd = D.Mwd || 0;
  const a2 = [D.Zu * f, D.Zw * f, (D.U + Zq) * f, 0], b2 = (D.Zde || 0) * f;
  const A = [[D.Xu, D.Xw, 0, -G0], a2, [(D.Mu || 0) + Mwd * a2[0], D.Mw + Mwd * a2[1], D.Mq + Mwd * a2[2], 0], [0, 0, 1, 0]];
  return { A, B: [0, b2, (D.Mde || 0) + Mwd * b2, 0], names: ['u', 'w', 'q', 'θ'] };
}
export const longMatrix = d => longFromDim(longDim(d));
export function latDim(d) {
  const { q, S, b, m, V, Ixx, Izz } = d;
  const L = (cl, rate) => q * S * b * cl / Ixx * (rate ? b / (2 * V) : 1), N = (cn, rate) => q * S * b * cn / Izz * (rate ? b / (2 * V) : 1);
  return {
    U: V, Ixx, Izz, Ixz: d.Ixz, Yb: q * S * d.Cyb / m, Yp: q * S * b * d.Cyp / (2 * m * V), Yr: q * S * b * d.Cyr / (2 * m * V),
    Lb: L(d.Clb), Lp: L(d.Clp, 1), Lr: L(d.Clr, 1), Nb: N(d.Cnb), Np: N(d.Cnp, 1), Nr: N(d.Cnr, 1),
    Lda: L(d.Clda), Nda: N(d.Cnda), Ldr: L(d.Cldr), Ndr: N(d.Cndr), Ydr: q * S * d.Cydr / m,
  };
}
// Lateral state matrix for x = [β, p, r, φ]; product of inertia Ixz handled with primed derivatives
export function latFromDim(D) {
  const Ixz = D.Ixz || 0, den = Ixz ? 1 - Ixz * Ixz / (D.Ixx * D.Izz) : 1;
  const P = (l, n) => (Ixz ? (l + Ixz / D.Ixx * n) / den : l), Q = (l, n) => (Ixz ? (n + Ixz / D.Izz * l) / den : n);
  const A = [
    [D.Yb / D.U, (D.Yp || 0) / D.U, -(1 - (D.Yr || 0) / D.U), G0 / D.U],
    [P(D.Lb, D.Nb), P(D.Lp, D.Np), P(D.Lr, D.Nr), 0],
    [Q(D.Lb, D.Nb), Q(D.Lp, D.Np), Q(D.Lr, D.Nr), 0],
    [0, 1, 0, 0],
  ];
  return { A, Ba: [0, P(D.Lda || 0, D.Nda || 0), Q(D.Lda || 0, D.Nda || 0), 0], Br: [(D.Ydr || 0) / D.U, P(D.Ldr || 0, D.Ndr || 0), Q(D.Ldr || 0, D.Ndr || 0), 0], names: ['β', 'p', 'r', 'φ'] };
}
export const latMatrix = d => latFromDim(latDim(d));

// ---------- eigen-analysis of 4×4 real matrices ----------
// characteristic polynomial coefficients (monic, highest first) by Faddeev–LeVerrier
export function charPoly(A) {
  const n = A.length, c = [1];
  let M = A.map((r, i) => r.map((_, j) => (i === j ? 1 : 0)));      // M₁ = I
  for (let k = 1; k <= n; k++) {
    const AM = A.map(r => M[0].map((_, j) => r.reduce((s, a, l) => s + a * M[l][j], 0)));
    const ck = -AM.reduce((s, r, i) => s + r[i], 0) / k;              // c_k = −tr(A·M_k)/k
    c.push(ck);
    M = AM.map((r, i) => r.map((v, j) => v + (i === j ? ck : 0)));    // M_{k+1} = A·M_k + c_k·I
  }
  return c;
}
// roots of a monic polynomial by Durand–Kerner, then Newton polishing
export function polyRoots(c) {
  const n = c.length - 1;
  const ev = (re, im) => { let pr = 1, pi = 0; for (let k = 1; k <= n; k++) { const r = pr * re - pi * im + c[k], i = pr * im + pi * re; pr = r; pi = i; } return [pr, pi]; };
  const R = 1 + Math.max(...c.slice(1).map(Math.abs));
  let z = Array.from({ length: n }, (_, k) => [R * 0.5 * Math.cos(2 * Math.PI * k / n + 0.4), R * 0.5 * Math.sin(2 * Math.PI * k / n + 0.4)]);
  for (let it = 0; it < 800; it++) {
    let moved = 0;
    z = z.map((zi, i) => {
      let [nr, ni] = ev(zi[0], zi[1]), dr = 1, di = 0;
      z.forEach((zj, j) => { if (j !== i) { const ar = zi[0] - zj[0], ai = zi[1] - zj[1], r = dr * ar - di * ai; di = dr * ai + di * ar; dr = r; } });
      const d2 = dr * dr + di * di || 1e-300, qr = (nr * dr + ni * di) / d2, qi = (ni * dr - nr * di) / d2;
      moved = Math.max(moved, Math.hypot(qr, qi) / (1 + Math.hypot(zi[0], zi[1])));
      return [zi[0] - qr, zi[1] - qi];
    });
    if (moved < 1e-15) break;
  }
  // tidy: tiny imaginary parts are real roots
  return z.map(([re, im]) => [re, Math.abs(im) < 1e-9 * (1 + Math.abs(re)) ? 0 : im]);
}
// eigenvector for eigenvalue λ (complex), normalised so its largest component is 1
export function eigvec(A, lr, li) {
  const n = A.length, M = A.map((r, i) => r.map((v, j) => [v - (i === j ? lr : 0), i === j ? -li : 0]));
  // set component k = 1 for the k giving the best-conditioned reduced system; solve remaining n−1 equations
  let best = null;
  for (let k = 0; k < n; k++) {
    const idx = [...Array(n).keys()].filter(j => j !== k);
    for (let drop = 0; drop < n; drop++) {
      const rows = [...Array(n).keys()].filter(i => i !== drop);
      const Mm = rows.map(i => idx.map(j => M[i][j].slice())), rhs = rows.map(i => [-M[i][k][0], -M[i][k][1]]);
      const x = csolve(Mm, rhs);
      if (!x) continue;
      const v = Array(n); v[k] = [1, 0]; idx.forEach((j, t) => { v[j] = x[t]; });
      const res = A.map((r, i) => { let sr = -lr * v[i][0] + li * v[i][1], si = -lr * v[i][1] - li * v[i][0]; r.forEach((a, j) => { sr += a * v[j][0]; si += a * v[j][1]; }); return Math.hypot(sr, si); }).reduce((a, b) => a + b, 0);
      const mag = Math.max(...v.map(c => Math.hypot(c[0], c[1])));
      if (!best || res / mag < best.res) best = { v, res: res / mag };
    }
  }
  const v = best.v; let im = 0; v.forEach((c, i) => { if (Math.hypot(...c) > Math.hypot(...v[im])) im = i; });
  const [pr, pi] = v[im], d = pr * pr + pi * pi;
  return v.map(([a, b]) => [(a * pr + b * pi) / d, (b * pr - a * pi) / d]);
}
function csolve(M, b) {
  const n = M.length, A = M.map((r, i) => [...r.map(c => c.slice()), b[i].slice()]);
  for (let col = 0; col < n; col++) {
    let p = col; for (let r = col + 1; r < n; r++) if (Math.hypot(...A[r][col]) > Math.hypot(...A[p][col])) p = r;
    if (Math.hypot(...A[p][col]) < 1e-14) return null;
    [A[col], A[p]] = [A[p], A[col]];
    const [pr, pi] = A[col][col], d = pr * pr + pi * pi;
    for (let r = 0; r < n; r++) if (r !== col) {
      const [ar, ai] = A[r][col], fr = (ar * pr + ai * pi) / d, fi = (ai * pr - ar * pi) / d;
      for (let k = col; k <= n; k++) { const [cr, ci] = A[col][k]; A[r][k] = [A[r][k][0] - (fr * cr - fi * ci), A[r][k][1] - (fr * ci + fi * cr)]; }
    }
  }
  return A.map((r, i) => { const [pr, pi] = r[i], d = pr * pr + pi * pi, [br, bi] = r[n]; return [(br * pr + bi * pi) / d, (bi * pr - br * pi) / d]; });
}
export function eig(A) { return polyRoots(charPoly(A)); }

const modeOf = ([re, im]) => {
  if (im === 0) return { re, im, real: true, tau: -1 / re, t2: re > 0 ? Math.LN2 / re : Infinity, thalf: re < 0 ? -Math.LN2 / re : Infinity };
  const wn = Math.hypot(re, im), zeta = -re / wn;
  return { re, im: Math.abs(im), real: false, wn, zeta, wd: Math.abs(im), period: 2 * Math.PI / Math.abs(im), thalf: re < 0 ? -Math.LN2 / re : Infinity, t2: re > 0 ? Math.LN2 / re : Infinity };
};
// Identify the classical modes. Longitudinal: the faster pair is the short period, the slower the phugoid.
export function longModes(A) {
  const r = eig(A).sort((a, b) => Math.hypot(...b) - Math.hypot(...a));
  const sp = r.slice(0, 2), ph = r.slice(2);
  const pick = pr => (pr[0][1] !== 0 ? modeOf(pr[0][1] > 0 ? pr[0] : pr[1]) : { real: true, roots: pr.map(modeOf), re: Math.max(pr[0][0], pr[1][0]) });
  return { roots: r, sp: { ...pick(sp), lam: sp }, ph: { ...pick(ph), lam: ph } };
}
// Lateral: the complex pair is the Dutch roll; of the real roots the faster is roll subsidence, the slower the spiral
export function latModes(A) {
  const r = eig(A), cx = r.filter(z => z[1] !== 0), re = r.filter(z => z[1] === 0).sort((a, b) => Math.abs(b[0]) - Math.abs(a[0]));
  const dr = cx.length ? modeOf(cx.find(z => z[1] > 0)) : null;
  return { roots: r, dr: dr && { ...dr, lam: cx }, roll: re[0] ? { ...modeOf(re[0]), lam: [re[0]] } : null, spiral: re[1] ? { ...modeOf(re[1]), lam: [re[1]] } : null };
}

// Linear response ẋ = Ax + B u(t) by RK4
export function simulate(A, B, x0, u, T, dt = 0.01) {
  const n = A.length, f = (x, t) => A.map((r, i) => r.reduce((s, a, j) => s + a * x[j], 0) + (B ? B[i] * u(t) : 0));
  const out = { t: [], x: [] }; let x = x0.slice(), t = 0;
  const every = Math.max(1, Math.round(T / dt / 600));
  for (let k = 0; t <= T + 1e-9; k++) {
    if (k % every === 0) { out.t.push(t); out.x.push(x.slice()); }
    const k1 = f(x, t), k2 = f(x.map((v, i) => v + dt / 2 * k1[i]), t + dt / 2), k3 = f(x.map((v, i) => v + dt / 2 * k2[i]), t + dt / 2), k4 = f(x.map((v, i) => v + dt * k3[i]), t + dt);
    x = x.map((v, i) => v + dt / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])); t += dt;
    if (!x.every(isFinite) || Math.max(...x.map(Math.abs)) > 1e6) break;
  }
  return out;
}

// ---------- handling qualities: MIL-F-8785C, Category B (cruise, climb, descent) ----------
export const CLASS = { c172: 'I', glider: 'I', a320: 'III', cca: 'IV', f16: 'IV' };
export function levels(d, L, Lt) {
  const nAlpha = d.q * d.S * d.CLa / d.W, sp = L.sp, ph = L.ph, out = {};
  if (!sp.real) {
    const cap = sp.wn ** 2 / nAlpha; out.cap = cap; out.nAlpha = nAlpha;
    const z = sp.zeta;
    out.sp = z >= 0.30 && z <= 2.0 && cap >= 0.085 && cap <= 3.6 ? 1 : z >= 0.20 && z <= 2.0 && cap >= 0.038 && cap <= 10 ? 2 : z >= 0.15 ? 3 : 4;
  } else out.sp = 4;
  out.ph = ph.real ? (ph.re <= 0 ? 1 : ph.t2 >= 55 ? 3 : 4) : ph.zeta >= 0.04 ? 1 : ph.zeta >= 0 ? 2 : ph.t2 >= 55 ? 3 : 4;
  const dr = Lt.dr, cls = CLASS[d.ac.id];
  if (dr) { const zw = dr.zeta * dr.wn; out.dr = dr.zeta >= 0.08 && zw >= 0.15 && dr.wn >= 0.4 ? 1 : dr.zeta >= 0.02 && zw >= 0.05 && dr.wn >= 0.4 ? 2 : dr.zeta >= 0 && dr.wn >= 0.4 ? 3 : 4; } else out.dr = 4;
  const tr = Lt.roll ? Lt.roll.tau : Infinity, lim = cls === 'III' ? [1.4, 3.0, 10] : [1.4, 3.0, 10];
  out.roll = tr > 0 && tr <= lim[0] ? 1 : tr > 0 && tr <= lim[1] ? 2 : tr > 0 && tr <= lim[2] ? 3 : 4;
  const sp2 = Lt.spiral; const t2 = sp2 ? sp2.t2 : Infinity;
  out.spiral = t2 >= 20 ? 1 : t2 >= 12 ? 2 : t2 >= 4 ? 3 : 4;
  out.cls = cls;
  return out;
}

// Everything at one condition: derivatives with the design tail incidence, trim, per-g, matrices and modes
export function analyse(o) {
  const it = o.it ?? designIncidence({ ...o, cg: GEOMETRY[o.id].cg[2], V: o.Vdesign ?? o.V, z: o.zDesign ?? o.z });
  const d = derivatives({ ...o, it });
  const tr = trim(d), pg = perG(d), lon = longMatrix(d), lat = latMatrix(d);
  const L = longModes(lon.A), Lt = latModes(lat.A);
  return { d, trim: tr, perG: pg, lon, lat, L, Lt, hq: levels(d, L, Lt), it };
}
