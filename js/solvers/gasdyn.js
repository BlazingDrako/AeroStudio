// Gas dynamics engine: isentropic, normal/oblique shock, Prandtl–Meyer, Fanno, Rayleigh,
// quasi-1D nozzle flow, exact Riemann (shock tube), method of characteristics (nozzle + jet plume).
// Angles are in radians unless a name ends in Deg. All functions are pure.

export const DEG = Math.PI / 180;

// ---------- root finding ----------
// Bisection on a function that changes sign over [lo, hi]. Works for increasing or decreasing f.
export function bisect(f, lo, hi, tol = 1e-13, maxit = 200) {
  let flo = f(lo), fhi = f(hi);
  if (!isFinite(flo) || !isFinite(fhi) || flo * fhi > 0) return NaN;
  for (let i = 0; i < maxit; i++) {
    const mid = 0.5 * (lo + hi), fm = f(mid);
    if (fm === 0 || (hi - lo) < tol * Math.max(1, Math.abs(mid))) return mid;
    if (fm * flo < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return 0.5 * (lo + hi);
}
// Solve f(x) = target for x in [lo, hi]; uses log spacing for wide supersonic ranges.
export function invert(f, target, lo, hi) { return bisect(x => f(x) - target, lo, hi); }

// ---------- isentropic ----------
export const isen = {
  T0_T: (M, g) => 1 + 0.5 * (g - 1) * M * M,
  p0_p: (M, g) => (1 + 0.5 * (g - 1) * M * M) ** (g / (g - 1)),
  r0_r: (M, g) => (1 + 0.5 * (g - 1) * M * M) ** (1 / (g - 1)),
  A_As: (M, g) => (1 / M) * ((2 / (g + 1)) * (1 + 0.5 * (g - 1) * M * M)) ** ((g + 1) / (2 * (g - 1))),
  mu: M => (M >= 1 ? Math.asin(1 / M) : NaN),
  nu: (M, g) => {
    if (M < 1) return NaN;
    const a = Math.sqrt((g + 1) / (g - 1)), b = Math.sqrt(M * M - 1);
    return a * Math.atan(b / a) - Math.atan(b);
  },
  numax: g => 0.5 * Math.PI * (Math.sqrt((g + 1) / (g - 1)) - 1),
  // mass-flow parameter m·sqrt(R T0)/(p0 A)
  mfp: (M, g) => Math.sqrt(g) * M * (1 + 0.5 * (g - 1) * M * M) ** (-(g + 1) / (2 * (g - 1))),
};
export const MBIG = 1e3;
export function M_from_T(r, g) { return Math.sqrt(Math.max(0, (1 / r - 1) * 2 / (g - 1))); } // r = T/T0
export function M_from_p(r, g) { return M_from_T(r ** ((g - 1) / g), g); }                     // r = p/p0
export function M_from_rho(r, g) { return M_from_T(r ** (g - 1), g); }                         // r = rho/rho0
export function M_from_A(ratio, g, supersonic) {
  if (ratio < 1) return NaN;
  if (Math.abs(ratio - 1) < 1e-14) return 1;
  return supersonic ? invert(M => isen.A_As(M, g), ratio, 1, MBIG) : invert(M => isen.A_As(M, g), ratio, 1e-10, 1);
}
export function M_from_nu(nu, g) {
  if (nu <= 0) return 1;
  if (nu >= isen.numax(g)) return Infinity;
  return invert(m => isen.nu(m, g), nu, 1, 1e5);
}
export function M_from_mu(mu) { return 1 / Math.sin(mu); }

export function isentropicAll(M, g) {
  const T = 1 / isen.T0_T(M, g), p = 1 / isen.p0_p(M, g), r = 1 / isen.r0_r(M, g);
  return {
    M, T_T0: T, p_p0: p, rho_rho0: r, A_As: isen.A_As(M, g), mu: isen.mu(M), nu: isen.nu(M, g),
    Ts: T * (g + 1) / 2, ps: p * ((g + 1) / 2) ** (g / (g - 1)), // T/T*, p/p*
    mfp: isen.mfp(M, g),
  };
}

// ---------- normal shock ----------
export function normalShock(M1, g) {
  const m2 = M1 * M1;
  if (M1 < 1) return null;
  const M2 = Math.sqrt((1 + 0.5 * (g - 1) * m2) / (g * m2 - 0.5 * (g - 1)));
  const p21 = 1 + 2 * g / (g + 1) * (m2 - 1);
  const r21 = (g + 1) * m2 / ((g - 1) * m2 + 2);
  const T21 = p21 / r21;
  const p0ratio = r21 ** (g / (g - 1)) * (1 / p21) ** (1 / (g - 1));
  const p02_p1 = p21 * isen.p0_p(M2, g);
  return { M1, M2, p2_p1: p21, rho2_rho1: r21, T2_T1: T21, u2_u1: 1 / r21, p02_p01: p0ratio, p02_p1, p1_p02: 1 / p02_p1, ds_R: -Math.log(p0ratio) };
}
// Find M1 from any downstream quantity. key in: M2, p2_p1, rho2_rho1, T2_T1, p02_p01, p1_p02, p02_p1
export function normalShockFrom(key, v, g) {
  switch (key) {
    case 'M1': return v;
    case 'M2': { if (v >= 1 || v <= Math.sqrt((g - 1) / (2 * g))) return NaN; const m2 = v * v; return Math.sqrt((1 + 0.5 * (g - 1) * m2) / (g * m2 - 0.5 * (g - 1))); }
    case 'p2_p1': return v < 1 ? NaN : Math.sqrt((v - 1) * (g + 1) / (2 * g) + 1);
    case 'rho2_rho1': { const lim = (g + 1) / (g - 1); if (v < 1 || v >= lim) return NaN; return Math.sqrt(2 * v / ((g + 1) - v * (g - 1))); }
    case 'T2_T1': return v < 1 ? NaN : invert(M => normalShock(M, g).T2_T1, v, 1, MBIG);
    case 'p02_p01': return v > 1 || v <= 0 ? NaN : invert(M => normalShock(M, g).p02_p01, v, 1, MBIG);
    case 'p1_p02': return invert(M => normalShock(M, g).p1_p02, v, 1, MBIG);
    case 'p02_p1': return invert(M => normalShock(M, g).p02_p1, v, 1, MBIG);
  }
  return NaN;
}
// Pitot-static Mach: subsonic uses isentropic p0/p; supersonic uses Rayleigh pitot formula.
export function machFromPitot(p02_p1, g) {
  const crit = isen.p0_p(1, g);
  if (p02_p1 < 1) return NaN;
  if (p02_p1 <= crit) return M_from_p(1 / p02_p1, g);
  return normalShockFrom('p02_p1', p02_p1, g);
}

// ---------- oblique shock ----------
export function thetaFromBeta(M, beta, g) {
  const s = Math.sin(beta), num = 2 / Math.tan(beta) * (M * M * s * s - 1), den = M * M * (g + Math.cos(2 * beta)) + 2;
  return Math.atan(num / den);
}
export function betaMax(M, g) {
  const m2 = M * M;
  const s2 = (1 / (g * m2)) * ((g + 1) / 4 * m2 - 1 + Math.sqrt((g + 1) * (1 + (g - 1) / 2 * m2 + (g + 1) / 16 * m2 * m2)));
  return Math.asin(Math.sqrt(Math.min(1, s2)));
}
export function thetaMax(M, g) { return M <= 1 ? 0 : thetaFromBeta(M, betaMax(M, g), g); }
// Shock angle for deflection theta: 'weak' or 'strong'. NaN if detached.
export function betaFromTheta(M, theta, g, branch = 'weak') {
  if (M <= 1) return NaN;
  const mu = Math.asin(1 / M);
  if (theta <= 0) return branch === 'weak' ? mu : Math.PI / 2;
  const bm = betaMax(M, g), tm = thetaFromBeta(M, bm, g);
  if (theta > tm) return NaN;
  if (Math.abs(theta - tm) < 1e-12) return bm;
  return branch === 'weak' ? bisect(b => thetaFromBeta(M, b, g) - theta, mu + 1e-12, bm) : bisect(b => thetaFromBeta(M, b, g) - theta, bm, Math.PI / 2);
}
// Mach number that gives deflection theta with shock angle beta (closed form).
export function machFromThetaBeta(theta, beta, g) {
  const den = Math.sin(2 * beta) - Math.tan(theta) * (g + Math.cos(2 * beta));
  const m2 = 2 * (1 / Math.tan(beta) + Math.tan(theta)) / den;
  return m2 > 1 ? Math.sqrt(m2) : NaN;
}
export function obliqueShock(M1, beta, g) {
  const theta = thetaFromBeta(M1, beta, g);
  const Mn1 = M1 * Math.sin(beta);
  const ns = normalShock(Mn1, g);
  if (!ns) return null;
  const M2 = ns.M2 / Math.sin(beta - theta);
  return { M1, beta, theta, Mn1, Mn2: ns.M2, M2, p2_p1: ns.p2_p1, rho2_rho1: ns.rho2_rho1, T2_T1: ns.T2_T1, p02_p01: ns.p02_p01, ds_R: ns.ds_R,
    thetaMax: thetaMax(M1, g), betaMax: betaMax(M1, g), mu1: Math.asin(1 / M1), strong: beta > betaMax(M1, g) };
}
// Shock angle at which M2 = 1 (sonic line on the θ–β–M chart)
export function betaSonic(M, g) {
  if (M <= 1) return NaN;
  return bisect(b => obliqueShock(M, b, g).M2 - 1, Math.asin(1 / M) + 1e-9, Math.PI / 2 - 1e-9);
}
// Oblique shock that produces a given pressure ratio (used for jet lip shocks).
export function betaFromPressure(M, p21, g) {
  const Mn = Math.sqrt((p21 - 1) * (g + 1) / (2 * g) + 1);
  return Mn > M ? NaN : Math.asin(Mn / M);
}

// ---------- Prandtl–Meyer expansion ----------
export function expansion(M1, dtheta, g) {
  const nu1 = isen.nu(M1, g), nu2 = nu1 + dtheta;
  const M2 = M_from_nu(nu2, g);
  const r = (M) => isen.p0_p(M, g);
  return { M1, M2, nu1, nu2, dtheta, mu1: isen.mu(M1), mu2: isen.mu(M2), p2_p1: r(M1) / r(M2), T2_T1: isen.T0_T(M1, g) / isen.T0_T(M2, g), rho2_rho1: isen.r0_r(M1, g) / isen.r0_r(M2, g), p02_p01: 1 };
}

// ---------- Fanno (adiabatic, friction) ----------
export const fanno = {
  T: (M, g) => (g + 1) / (2 + (g - 1) * M * M),
  p: (M, g) => (1 / M) * Math.sqrt((g + 1) / (2 + (g - 1) * M * M)),
  rho: (M, g) => (1 / M) * Math.sqrt((2 + (g - 1) * M * M) / (g + 1)),
  p0: (M, g) => (1 / M) * ((2 + (g - 1) * M * M) / (g + 1)) ** ((g + 1) / (2 * (g - 1))),
  V: (M, g) => M * Math.sqrt((g + 1) / (2 + (g - 1) * M * M)),
  fL: (M, g) => (1 - M * M) / (g * M * M) + (g + 1) / (2 * g) * Math.log((g + 1) * M * M / (2 + (g - 1) * M * M)),
};
// ---------- Rayleigh (heat addition, frictionless) ----------
export const rayleigh = {
  p: (M, g) => (1 + g) / (1 + g * M * M),
  T: (M, g) => M * M * (1 + g) ** 2 / (1 + g * M * M) ** 2,
  rho: (M, g) => (1 + g * M * M) / ((1 + g) * M * M),
  V: (M, g) => (1 + g) * M * M / (1 + g * M * M),
  T0: (M, g) => 2 * (g + 1) * M * M * (1 + 0.5 * (g - 1) * M * M) / (1 + g * M * M) ** 2,
  p0: (M, g) => (1 + g) / (1 + g * M * M) * ((2 + (g - 1) * M * M) / (g + 1)) ** (g / (g - 1)),
};
// Invert a Fanno/Rayleigh ratio on the chosen branch.
export function invertBranch(fn, v, g, supersonic) {
  return supersonic ? invert(M => fn(M, g), v, 1 + 1e-12, MBIG) : invert(M => fn(M, g), v, 1e-6, 1 - 1e-12);
}

// ---------- exact Riemann solver (shock tube), per-side gamma (Toro ch. 4) ----------
export function riemann(L, R) {
  // L, R: {rho, u, p, g}
  const aL = Math.sqrt(L.g * L.p / L.rho), aR = Math.sqrt(R.g * R.p / R.rho);
  const fK = (p, K, a) => {
    if (p > K.p) {
      const A = 2 / ((K.g + 1) * K.rho), B = (K.g - 1) / (K.g + 1) * K.p, q = Math.sqrt(A / (p + B));
      return [(p - K.p) * q, q * (1 - (p - K.p) / (2 * (B + p)))];
    }
    const pr = p / K.p;
    return [2 * a / (K.g - 1) * (pr ** ((K.g - 1) / (2 * K.g)) - 1), 1 / (K.rho * a) * pr ** (-(K.g + 1) / (2 * K.g))];
  };
  const du = R.u - L.u;
  if (2 * aL / (L.g - 1) + 2 * aR / (R.g - 1) <= du) return null; // vacuum
  // two-rarefaction guess
  const gm = 0.5 * (L.g + R.g), z = (gm - 1) / (2 * gm);
  let p = ((aL + aR - 0.5 * (gm - 1) * du) / (aL / L.p ** z + aR / R.p ** z)) ** (1 / z);
  if (!(p > 0)) p = 0.5 * (L.p + R.p);
  for (let i = 0; i < 100; i++) {
    const [fl, dl] = fK(p, L, aL), [fr, dr] = fK(p, R, aR);
    const dp = (fl + fr + du) / (dl + dr);
    let pn = p - dp; if (pn <= 0) pn = p * 0.1;
    if (Math.abs(pn - p) / (0.5 * (pn + p)) < 1e-12) { p = pn; break; }
    p = pn;
  }
  const fl = fK(p, L, aL)[0], fr = fK(p, R, aR)[0];
  const u = 0.5 * (L.u + R.u) + 0.5 * (fr - fl);
  const side = (K, a, sgn) => { // sgn = -1 left, +1 right
    if (p > K.p) {
      const pr = p / K.p, gg = (K.g - 1) / (K.g + 1);
      const rho = K.rho * (pr + gg) / (gg * pr + 1);
      const S = K.u + sgn * a * Math.sqrt((K.g + 1) / (2 * K.g) * pr + (K.g - 1) / (2 * K.g));
      return { type: 'shock', rho, S, a: Math.sqrt(K.g * p / rho) };
    }
    const rho = K.rho * (p / K.p) ** (1 / K.g), as = a * (p / K.p) ** ((K.g - 1) / (2 * K.g));
    return { type: 'fan', rho, head: K.u + sgn * a, tail: u + sgn * as, a: as };
  };
  const wl = side(L, aL, -1), wr = side(R, aR, +1);
  const sample = s => { // s = x/t, returns {rho,u,p,g,region}
    if (s <= u) {
      if (wl.type === 'shock') return s <= wl.S ? { ...L, region: 'L' } : { rho: wl.rho, u, p, g: L.g, region: 'L*' };
      if (s <= wl.head) return { ...L, region: 'L' };
      if (s >= wl.tail) return { rho: wl.rho, u, p, g: L.g, region: 'L*' };
      const g = L.g, c = 2 / (g + 1) + (g - 1) / ((g + 1) * aL) * (L.u - s);
      return { rho: L.rho * c ** (2 / (g - 1)), u: 2 / (g + 1) * (aL + 0.5 * (g - 1) * L.u + s), p: L.p * c ** (2 * g / (g - 1)), g, region: 'fan' };
    }
    if (wr.type === 'shock') return s >= wr.S ? { ...R, region: 'R' } : { rho: wr.rho, u, p, g: R.g, region: 'R*' };
    if (s >= wr.head) return { ...R, region: 'R' };
    if (s <= wr.tail) return { rho: wr.rho, u, p, g: R.g, region: 'R*' };
    const g = R.g, c = 2 / (g + 1) - (g - 1) / ((g + 1) * aR) * (R.u - s);
    return { rho: R.rho * c ** (2 / (g - 1)), u: 2 / (g + 1) * (-aR + 0.5 * (g - 1) * R.u + s), p: R.p * c ** (2 * g / (g - 1)), g, region: 'fan' };
  };
  return { p, u, left: wl, right: wr, aL, aR, sample };
}

// ---------- nozzle geometry ----------
// Returns { xs, rs, xt, planar, info } with throat radius 1 at x=0, chamber radius Rc upstream.
const RAO = { eps: [2, 4, 5, 10, 20, 30, 40, 50, 100], tn: [18, 21.5, 23, 26.5, 29.5, 31.5, 33, 34, 36], te: [16, 14, 13, 10.5, 8.5, 7.5, 7, 6.5, 5.5] };
function interpTable(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]) { const t = (Math.log(x) - Math.log(xs[i - 1])) / (Math.log(xs[i]) - Math.log(xs[i - 1])); return ys[i - 1] + t * (ys[i] - ys[i - 1]); }
  return ys[ys.length - 1];
}
export function raoAngles(eps) { return { thetaN: interpTable(RAO.eps, RAO.tn, eps) * DEG, thetaE: interpTable(RAO.eps, RAO.te, eps) * DEG }; }

export function nozzleGeometry({ type = 'conical', eps = 4, halfAngleDeg = 15, contraction = 3, g = 1.4, nChar = 16 }) {
  const planar = type === 'moc';
  const Rc = planar ? contraction : Math.sqrt(contraction);
  const Lc = 1.6 * (Rc - 1) + 0.8;
  const xs = [], rs = [];
  const Nc = 50;
  for (let i = 0; i <= Nc; i++) { const x = -Lc + Lc * i / Nc, s = -x / Lc; xs.push(x); rs.push(1 + (Rc - 1) * 0.5 * (1 - Math.cos(Math.PI * s))); }
  const info = { planar, Rc, type };
  if (type === 'converging') { info.Re = 1; info.lambda = 1; return { xs, rs, xt: 0, xe: 0, planar, info }; }
  const Re = planar ? eps : Math.sqrt(eps);
  info.Re = Re;
  if (type === 'conical') {
    const a = halfAngleDeg * DEG, Rd = 0.382;
    const N = 20;
    for (let i = 1; i <= N; i++) { const p = a * i / N; xs.push(Rd * Math.sin(p)); rs.push(1 + Rd * (1 - Math.cos(p))); }
    const x0 = xs[xs.length - 1], r0 = rs[rs.length - 1];
    const L = (Re - r0) / Math.tan(a);
    for (let i = 1; i <= 40; i++) { xs.push(x0 + L * i / 40); rs.push(r0 + (Re - r0) * i / 40); }
    info.lambda = planar ? Math.sin(a) / a : 0.5 * (1 + Math.cos(a));
    info.length = x0 + L;
  } else if (type === 'bell') {
    const { thetaN, thetaE } = raoAngles(eps), Rd = 0.382;
    const N = 20;
    for (let i = 1; i <= N; i++) { const p = thetaN * i / N; xs.push(Rd * Math.sin(p)); rs.push(1 + Rd * (1 - Math.cos(p))); }
    const xN = xs[xs.length - 1], rN = rs[rs.length - 1];
    const xE = 0.8 * (Math.sqrt(eps) - 1) / Math.tan(15 * DEG);
    // quadratic Bezier with end tangents thetaN and thetaE
    const m1 = Math.tan(thetaN), m2 = Math.tan(thetaE), c1 = rN - m1 * xN, c2 = Re - m2 * xE;
    const qx = (c2 - c1) / (m1 - m2), qy = m1 * qx + c1;
    for (let i = 1; i <= 60; i++) { const t = i / 60, u = 1 - t; xs.push(u * u * xN + 2 * u * t * qx + t * t * xE); rs.push(u * u * rN + 2 * u * t * qy + t * t * Re); }
    info.thetaN = thetaN; info.thetaE = thetaE; info.lambda = 0.5 * (1 + Math.cos(thetaE)); info.length = xE;
  } else if (type === 'moc') {
    const Me = M_from_A(eps, g, true);
    const moc = minLengthNozzle(Me, g, nChar);
    for (const w of moc.wall) { xs.push(w.x); rs.push(w.y); }
    info.moc = moc; info.lambda = 1; info.length = moc.wall[moc.wall.length - 1].x;
    info.Re = moc.wall[moc.wall.length - 1].y;
  }
  return { xs, rs, xt: 0, xe: xs[xs.length - 1], planar, info };
}
export function radiusAt(geo, x) {
  const { xs, rs } = geo;
  if (x <= xs[0]) return rs[0];
  if (x >= xs[xs.length - 1]) return rs[rs.length - 1];
  let lo = 0, hi = xs.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] > x) hi = m; else lo = m; }
  const t = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
  return rs[lo] + t * (rs[hi] - rs[lo]);
}

// ---------- quasi-1D nozzle flow ----------
// geo from nozzleGeometry; pb = back pressure / chamber stagnation pressure.
export function nozzleFlow(geo, g, pb) {
  const areaOf = r => (geo.planar ? r : r * r);
  const At = areaOf(1), Ae = areaOf(geo.rs[geo.rs.length - 1]), eps = Ae / At;
  const conv = geo.info.type === 'converging' || eps <= 1 + 1e-9;
  const pcrit = 1 / isen.p0_p(1, g);
  const Msub = M_from_A(eps, g, false), Msup = conv ? 1 : M_from_A(eps, g, true);
  const p1 = conv ? pcrit : 1 / isen.p0_p(Msub, g);      // 1st critical: just choked, subsonic exit
  const p3 = conv ? pcrit : 1 / isen.p0_p(Msup, g);      // 3rd critical: design (isentropic supersonic)
  const p2 = conv ? pcrit : p3 * normalShock(Msup, g).p2_p1; // 2nd critical: normal shock at exit
  const crit = { p1, p2, p3, eps, Msub, Msup, pcrit };
  let regime, Me, pe, shock = null, As = At, p0e = 1, choked = true;
  if (pb >= 1) { regime = 'noflow'; Me = 0; pe = 1; choked = false; As = Infinity; }
  else if (pb >= p1) {
    regime = 'subsonic'; choked = false; Me = M_from_p(pb, g); pe = pb; As = Ae / isen.A_As(Me, g);
  } else if (conv) {
    regime = pb > pcrit * 0.999999 ? 'choked' : 'under'; Me = 1; pe = pcrit;
  } else if (pb > p2) {
    regime = 'shock';
    const K = pb * Ae / At;
    Me = invert(M => isen.A_As(M, g) / isen.p0_p(M, g), K, 1e-9, 1);
    pe = pb;
    const p02 = pe * isen.p0_p(Me, g);
    const M1 = normalShockFrom('p02_p01', p02, g);
    const Asr = isen.A_As(M1, g);
    // locate shock in divergent section where A/At = Asr
    let xs = NaN;
    for (let i = 1; i < geo.xs.length; i++) {
      if (geo.xs[i] <= 0) continue;
      const a0 = areaOf(geo.rs[i - 1]) / At, a1 = areaOf(geo.rs[i]) / At;
      if ((a0 - Asr) * (a1 - Asr) <= 0) { const t = (Asr - a0) / (a1 - a0 || 1); xs = geo.xs[i - 1] + t * (geo.xs[i] - geo.xs[i - 1]); break; }
    }
    shock = { x: xs, M1, M2: normalShock(M1, g).M2, A_At: Asr, p02_p01: p02 };
    p0e = p02;
  } else {
    Me = Msup; pe = p3;
    regime = Math.abs(pb - p3) / p3 < 0.004 ? 'design' : pb > p3 ? 'over' : 'under';
  }
  // profile
  const N = 260, x0 = geo.xs[0], x1 = geo.xs[geo.xs.length - 1];
  const prof = { x: [], M: [], p: [], T: [], rho: [], r: [], p0: [] };
  for (let i = 0; i <= N; i++) {
    const x = x0 + (x1 - x0) * i / N, r = radiusAt(geo, x), ar = areaOf(r);
    let M, p0 = 1, Astar = As;
    if (regime === 'noflow') M = 0;
    else if (regime === 'subsonic') M = M_from_A(ar / As, g, false);
    else if (x <= 0) M = M_from_A(ar / At, g, false);
    else if (regime === 'shock' && x > shock.x) { p0 = p0e; Astar = At / p0e; M = M_from_A(ar / Astar, g, false); }
    else M = conv ? 1 : M_from_A(ar / At, g, true);
    if (!isFinite(M)) M = x > 0 && regime !== 'subsonic' ? 1 : 0;
    prof.x.push(x); prof.r.push(r); prof.M.push(M); prof.p0.push(p0);
    prof.p.push(p0 / isen.p0_p(M, g)); prof.T.push(1 / isen.T0_T(M, g)); prof.rho.push(p0 / isen.r0_r(M, g));
  }
  return { regime, crit, Me, pe, pb, shock, choked, p0e, eps, conv, prof, Te: 1 / isen.T0_T(Me, g) };
}
// Sample the quasi-1D state at x (linear interpolation of the profile, exact jump at shock)
export function nozzleStateAt(flow, x) {
  const P = flow.prof, n = P.x.length;
  if (x <= P.x[0]) return { M: P.M[0], p: P.p[0], T: P.T[0], rho: P.rho[0], p0: P.p0[0] };
  if (x >= P.x[n - 1]) return { M: P.M[n - 1], p: P.p[n - 1], T: P.T[n - 1], rho: P.rho[n - 1], p0: P.p0[n - 1] };
  const t = (x - P.x[0]) / (P.x[n - 1] - P.x[0]) * (n - 1), i = Math.min(n - 2, Math.floor(t)), f = t - i;
  if (flow.shock && P.x[i] <= flow.shock.x && P.x[i + 1] > flow.shock.x) {
    const j = x < flow.shock.x ? i : i + 1;
    return { M: P.M[j], p: P.p[j], T: P.T[j], rho: P.rho[j], p0: P.p0[j] };
  }
  const L = (a) => a[i] + f * (a[i + 1] - a[i]);
  return { M: L(P.M), p: L(P.p), T: L(P.T), rho: L(P.rho), p0: L(P.p0) };
}
export function thrust(flow, g, { p0 = 1e6, T0 = 3000, At = 1e-2, R = 287, pa = 101325, lambda = 1 } = {}) {
  const pb = pa / p0;
  // choked: set by the throat; unchoked: set by the (subsonic) exit
  const mdot = flow.choked ? p0 * At / Math.sqrt(R * T0) * isen.mfp(1, g) : p0 * At * flow.eps / Math.sqrt(R * T0) * isen.mfp(flow.Me, g);
  const Te = T0 * flow.Te, Ve = flow.Me * Math.sqrt(g * R * Te);
  const Ae = At * flow.eps;
  const F = lambda * mdot * Ve + (flow.pe * p0 - pa) * Ae;
  const g0 = 9.80665;
  return { mdot, Ve, Te, pe: flow.pe * p0, F, CF: F / (p0 * At), Isp: F / (mdot * g0), cstar: p0 * At / mdot, Ae, pb };
}

// ---------- method of characteristics: minimum-length planar nozzle (Anderson §11.7) ----------
export function minLengthNozzle(Me, g, n = 16) {
  const twmax = isen.nu(Me, g) / 2;
  const th = [];
  const t0 = Math.min(0.2 * DEG, twmax / (4 * n));
  for (let i = 0; i < n; i++) th.push(n === 1 ? twmax : t0 + (twmax - t0) * i / (n - 1));
  const corner = { x: 0, y: 1 };
  const mk = (x, y, theta, nu) => ({ x, y, theta, nu, M: M_from_nu(nu, g), mu: Math.asin(1 / M_from_nu(nu, g)) });
  const P = []; // P[i][j], i >= j  (C- index i, C+ index j)
  const wall = [{ x: 0, y: 1, theta: twmax, nu: twmax, M: M_from_nu(twmax, g) }];
  const inter = (p1, s1, p2, s2) => { // line through p1 slope s1, through p2 slope s2
    const x = (p2.y - p1.y + s1 * p1.x - s2 * p2.x) / (s1 - s2); return { x, y: p1.y + s1 * (x - p1.x) };
  };
  const cornerState = i => ({ x: 0, y: 1, theta: th[i], nu: th[i], mu: Math.asin(1 / M_from_nu(Math.max(th[i], 1e-9), g)) });
  for (let j = 0; j < n; j++) {
    P[j] = P[j] || [];
    for (let i = j; i < n; i++) {
      P[i] = P[i] || [];
      const theta = th[i] - th[j], nu = th[i] + th[j];
      const Mloc = M_from_nu(nu, g), mu = Math.asin(1 / Mloc);
      const up = j === 0 ? cornerState(i) : P[i][j - 1]; // previous point along C- i
      if (i === j) {
        const s = Math.tan(0.5 * ((up.theta - up.mu) + (theta - mu)));
        const x = up.x - up.y / s;
        P[i][j] = { x, y: 0, theta, nu, M: Mloc, mu };
      } else {
        const lo = P[i - 1][j]; // previous point along C+ j
        const sm = Math.tan(0.5 * ((up.theta - up.mu) + (theta - mu)));
        const sp = Math.tan(0.5 * ((lo.theta + lo.mu) + (theta + mu)));
        const q = inter(up, sm, lo, sp);
        P[i][j] = { ...q, theta, nu, M: Mloc, mu };
      }
    }
    // wall point on C+ j
    const last = P[n - 1][j], prevW = wall[wall.length - 1];
    const sp = Math.tan(last.theta + last.mu);
    const sw = Math.tan(0.5 * (prevW.theta + last.theta));
    const q = inter(last, sp, prevW, sw);
    wall.push({ ...q, theta: last.theta, nu: last.nu, M: last.M, mu: last.mu });
  }
  const ye = wall[wall.length - 1].y;
  return { P, wall, n, twmax, th, Me, AeAt: ye, AeAtExact: isen.A_As(Me, g), corner };
}

// ---------- jet plume: planar wave-lattice method (characteristics with finite-strength waves) ----------
// Exit flow Me (uniform, parallel), pressure ratio pe/pa. Half-height 1. Returns region polygons with states.
// Expansions are split into nFan waves; compressions are single waves (weak-shock approximation).
export function jetPlume(Me, peRatio, g, { nFan = 10, xmax = 12, maxLines = 4000 } = {}) {
  Me = Math.max(Me, 1.0005);
  const p0e = isen.p0_p(Me, g);           // p0/pe at exit
  const pa_p0 = 1 / (p0e * peRatio);
  const Mb = M_from_p(pa_p0, g);
  const nue = isen.nu(Me, g);
  if (!(Mb > 1)) return { ok: false, reason: 'subsonic-boundary', Mb };
  const nub = isen.nu(Mb, g);
  const state = (Km, Kp) => {
    const nu = 0.5 * (Km + Kp), theta = 0.5 * (Km - Kp);
    const M = M_from_nu(Math.max(nu, 1e-9), g);
    return { nu, theta, M, mu: Math.asin(1 / M), p: 1 / isen.p0_p(M, g), T: 1 / isen.T0_T(M, g), rho: 1 / isen.r0_r(M, g) };
  };
  const cache = new Map();
  const st = (Km, Kp) => { const k = Km.toFixed(10) + ',' + Kp.toFixed(10); let s = cache.get(k); if (!s) { s = state(Km, Kp); cache.set(k, s); } return s; };
  const inter = (p1, s1, p2, s2) => { const x = (p2.y - p1.y + s1 * p1.x - s2 * p2.x) / (s1 - s2); return { x, y: p1.y + s1 * (x - p1.x) }; };
  const totalDK = 2 * (nub - nue);
  const nWaves = totalDK > 0 ? nFan : 1;
  const lip = { x: 0, y: 1 };
  // virtual initial line
  let q = { pts: [lip], Km: nue, segKp: [nue], csign: [0], kind: 'start' };
  const polys = [], waves = [], boundary = [{ x: 0, y: 1 }];
  let firstAxis = null, crossed = false;
  const pushPoly = (pts, Km, Kp) => { const s = st(Km, Kp); polys.push({ pts, s }); };
  for (let line = 0; line < maxLines; line++) {
    const m = q.pts.length - 1;
    const fan = line < nWaves;
    let r;
    if (fan) {
      const Km = q.Km + totalDK / nWaves;
      const pts = [lip];
      const segKp = [];
      for (let j = 0; j <= m; j++) segKp.push(q.segKp[j]);
      // interior points: C- r from r_{j-1} with C+ through q_j
      for (let j = 1; j <= m; j++) {
        const up = st(q.Km, q.segKp[j - 1]), dn = st(Km, q.segKp[j - 1]);
        const sm = Math.tan(0.5 * ((up.theta - up.mu) + (dn.theta - dn.mu)));
        const a = st(q.Km, q.segKp[j - 1]), b = st(q.Km, q.segKp[j]);
        const sp = Math.tan(0.5 * ((a.theta + a.mu) + (b.theta + b.mu)));
        pts.push(inter(pts[j - 1], sm, q.pts[j], sp));
      }
      // axis point
      { const up = st(q.Km, q.segKp[m]), dn = st(Km, q.segKp[m]);
        const sm = Math.tan(0.5 * ((up.theta - up.mu) + (dn.theta - dn.mu)));
        const p = pts[m]; pts.push({ x: p.x - p.y / sm, y: 0 }); }
      segKp.push(Km); // axis region after reflection
      r = { pts, Km, segKp, csign: [0, ...q.csign.slice(1), Math.sign(totalDK)], kind: 'fan' };
      // polygons between q and r
      if (q.kind === 'start') polys.push({ pts: [lip, { x: 0, y: 0 }, pts[pts.length - 1]], s: st(nue, nue) });
      else {
        for (let j = 0; j < m; j++) pushPoly([q.pts[j], q.pts[j + 1], pts[j + 1], pts[j]], q.Km, q.segKp[j]);
        pushPoly([q.pts[m], pts[m], pts[m + 1]], q.Km, q.segKp[m]);
      }
      if (!firstAxis) firstAxis = pts[pts.length - 1];
    } else {
      if (m < 1) break;
      const Km = 2 * nub - q.segKp[1];
      const pts = [];
      // boundary point: C+ through q_1 meets boundary streamline from q_0
      { const a = st(q.Km, q.segKp[0]), b = st(q.Km, q.segKp[1]);
        const sp = Math.tan(0.5 * ((a.theta + a.mu) + (b.theta + b.mu)));
        const sb = Math.tan(a.theta);
        pts.push(inter(q.pts[1], sp, q.pts[0], sb)); }
      for (let j = 1; j <= m - 1; j++) {
        const up = st(q.Km, q.segKp[j]), dn = st(Km, q.segKp[j]);
        const sm = Math.tan(0.5 * ((up.theta - up.mu) + (dn.theta - dn.mu)));
        const a = st(q.Km, q.segKp[j]), b = st(q.Km, q.segKp[j + 1]);
        const sp = Math.tan(0.5 * ((a.theta + a.mu) + (b.theta + b.mu)));
        pts.push(inter(pts[j - 1], sm, q.pts[j + 1], sp));
      }
      { const up = st(q.Km, q.segKp[m]), dn = st(Km, q.segKp[m]);
        const sm = Math.tan(0.5 * ((up.theta - up.mu) + (dn.theta - dn.mu)));
        const p = pts[m - 1]; pts.push({ x: p.x - p.y / sm, y: 0 }); }
      const segKp = [];
      for (let j = 0; j < m; j++) segKp.push(q.segKp[j + 1]);
      segKp.push(Km);
      const csign = [0, ...q.csign.slice(2), Math.sign(Km - q.Km)];
      r = { pts, Km, segKp, csign, kind: 'refl' };
      pushPoly([q.pts[0], q.pts[1], pts[0]], q.Km, q.segKp[0]);
      for (let j = 1; j < m; j++) pushPoly([q.pts[j], q.pts[j + 1], pts[j], pts[j - 1]], q.Km, q.segKp[j]);
      pushPoly([q.pts[m], pts[m - 1], pts[m]], q.Km, q.segKp[m]);
      boundary.push(pts[0]);
      // detect same-family crossing (wave coalescence → shock forms)
      for (let j = 1; j < pts.length; j++) if (pts[j].x < pts[j - 1].x - 1e-9 && pts[j].y > pts[j - 1].y) crossed = true;
    }
    waves.push({ pts: r.pts, sign: Math.sign(r.Km - q.Km), fam: '-' });
    // C+ wave segments between q and r
    if (q.kind !== 'start') {
      const off = fan ? 0 : 1;
      for (let j = 1; j <= m; j++) { const a = q.pts[j], b = r.pts[j - off]; if (q.csign[j]) waves.push({ pts: [a, b], sign: q.csign[j], fam: '+' }); }
    }
    q = r;
    if (q.pts[0].x > xmax && q.pts[q.pts.length - 1].x > xmax) break;
    if (!isFinite(q.pts[0].x) || q.pts[0].y > 50) break;
  }
  const cellLen = estimateCell(boundary);
  let ymax = 1; for (const p of boundary) if (p.x < 2.2 * (cellLen || xmax)) ymax = Math.max(ymax, p.y);
  return { ok: true, ymax, polys, waves, boundary, Mb, nub, nue, totalTurn: nub - nue, crossed, cellLen, Me, peRatio, pa_p0: pa_p0, p0e, firstAxis };
}
function estimateCell(b) {
  // boundary height oscillates: find first local minimum (for under-) or maximum after start
  for (let i = 2; i < b.length - 1; i++) {
    const y0 = b[i - 1].y, y1 = b[i].y, y2 = b[i + 1].y;
    if ((y1 <= y0 && y1 < y2 && b[1].y > b[0].y) || (y1 >= y0 && y1 > y2 && b[1].y < b[0].y)) {
      // first extremum of the opposite sense = where the jet returns to its exit state: one full cell
      return b[i].x;
    }
  }
  return NaN;
}

// Gas presets
export const GASES = [
  { id: 'air', label: 'Air', g: 1.4, R: 287.05 },
  { id: 'comb', label: 'Rocket exhaust (γ=1.22)', g: 1.22, R: 330 },
  { id: 'he', label: 'Helium', g: 5 / 3, R: 2077.1 },
  { id: 'ar', label: 'Argon', g: 5 / 3, R: 208.1 },
  { id: 'h2', label: 'Hydrogen', g: 1.405, R: 4124.2 },
  { id: 'co2', label: 'CO₂', g: 1.289, R: 188.9 },
  { id: 'steam', label: 'Steam (γ=1.33)', g: 1.33, R: 461.5 },
];
