// Inertial and satellite navigation.
// (1) INS errors: the phi-angle error model of a local-level INS for a slow vehicle (Titterton & Weston 2004 §12.3;
//     Groves 2013 §14.2). 12 states: north/east position and velocity error, attitude errors about N, E and down
//     (the last is the heading error), three gyro biases and two horizontal accelerometer biases, all in the
//     local frame (the body is taken as pointing north). It gives the 84.4-minute Schuler oscillation, the Earth-rate
//     coupling (24 h terms and the Foucault rotation) and, separately, the unstable vertical channel.
// (2) GNSS: a nominal 24-satellite GPS constellation on circular orbits (Walker 24/6/1), pseudoranges with a receiver
//     clock bias, iterative least squares and dilution of precision (Misra & Enge 2011 ch. 6). No atmosphere, Sagnac
//     or relativity terms: the user range error is one Gaussian number.
// (3) A loosely coupled INS/GNSS Kalman filter on the same error model, with GNSS position fixes and outages
//     (Brown & Hwang 2012; Groves ch. 14).
import { WGS84, geodeticToEcef } from './navigation.js';

export const OMEGA_E = 7.2921151467e-5, G0 = 9.80665, R_E = 6371000, MU = 3.986004418e14, C_LIGHT = 299792458, A_GPS = 26559700;
export const SCHULER = Math.sqrt(G0 / R_E);   // rad/s; period 2π/ωs = 84.4 min
const D = Math.PI / 180, HR = 3600;

// ---------- small dense linear algebra ----------
export const zeros = (n, m = n) => Array.from({ length: n }, () => new Float64Array(m));
export const eye = n => { const A = zeros(n); for (let i = 0; i < n; i++) A[i][i] = 1; return A; };
export function mul(A, B) {
  const n = A.length, k = B.length, m = B[0].length, C = zeros(n, m);
  for (let i = 0; i < n; i++) { const a = A[i], c = C[i]; for (let p = 0; p < k; p++) { const v = a[p]; if (!v) continue; const b = B[p]; for (let j = 0; j < m; j++) c[j] += v * b[j]; } }
  return C;
}
export function transpose(A) { const n = A.length, m = A[0].length, T = zeros(m, n); for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) T[j][i] = A[i][j]; return T; }
export function mulV(A, v) { const out = new Float64Array(A.length); for (let i = 0; i < A.length; i++) { let s = 0; const a = A[i]; for (let j = 0; j < v.length; j++) s += a[j] * v[j]; out[i] = s; } return out; }
const sandwich = (A, P) => mul(mul(A, P), transpose(A));   // A P Aᵀ
const addTo = (A, B, s = 1) => { for (let i = 0; i < A.length; i++) for (let j = 0; j < A[0].length; j++) A[i][j] += s * B[i][j]; return A; };
const symmetrize = P => { for (let i = 0; i < P.length; i++) for (let j = 0; j < i; j++) { const v = 0.5 * (P[i][j] + P[j][i]); P[i][j] = P[j][i] = v; } return P; };
// flat row-major 12×12 helpers for the time loops (much faster than arrays of rows)
const N2 = 144;
const flat = A => { const n = A.length, f = new Float64Array(n * n); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) f[i * n + j] = A[i][j]; return f; };
// out = Φ P Φᵀ + Qd (symmetric)
function propP(Phi, P, Qd, tmp, out, n = 12) {
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { let s = 0; const io = i * n; for (let k = 0; k < n; k++) s += Phi[io + k] * P[k * n + j]; tmp[io + j] = s; }
  for (let i = 0; i < n; i++) for (let j = i; j < n; j++) { let s = Qd[i * n + j]; const io = i * n, jo = j * n; for (let k = 0; k < n; k++) s += tmp[io + k] * Phi[jo + k]; out[io + j] = s; out[jo + i] = s; }
  return out;
}
function propX(Phi, x, out, n = 12) { for (let i = 0; i < n; i++) { let s = 0; const io = i * n; for (let k = 0; k < n; k++) s += Phi[io + k] * x[k]; out[i] = s; } return out; }
// Kalman update for a direct measurement of states 0 and 1 (north and east position), variance r each
function posUpdate(x, P, z0, z1, r, n = 12) {
  const a = P[0] + r, b = P[1], c = P[n + 1] + r, det = a * c - b * b, s00 = c / det, s01 = -b / det, s11 = a / det;
  const y0 = z0 - x[0], y1 = z1 - x[1], r0 = P.slice(0, n), r1 = P.slice(n, 2 * n);
  for (let i = 0; i < n; i++) {
    const k0 = P[i * n] * s00 + P[i * n + 1] * s01, k1 = P[i * n] * s01 + P[i * n + 1] * s11;
    x[i] += k0 * y0 + k1 * y1;
    for (let j = 0; j < n; j++) P[i * n + j] -= k0 * r0[j] + k1 * r1[j];
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) { const v = 0.5 * (P[i * n + j] + P[j * n + i]); P[i * n + j] = P[j * n + i] = v; }
}
export function inv(A) {
  const n = A.length, M = A.map((r, i) => { const row = new Float64Array(2 * n); row.set(r); row[n + i] = 1; return row; });
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-300) throw new Error('singular matrix');
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c]; for (let j = 0; j < 2 * n; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; if (f) for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j]; }
  }
  return M.map(r => r.slice(n));
}
// e^(A·dt) by scaling and squaring a Taylor series
export function expm(A, dt) {
  const n = A.length; let nrm = 0;
  for (const r of A) nrm = Math.max(nrm, r.reduce((s, v) => s + Math.abs(v * dt), 0));
  const s = Math.max(0, Math.ceil(Math.log2(nrm || 1e-12)) + 1), sc = dt / 2 ** s;
  const M = A.map(r => r.map(v => v * sc));
  let E = eye(n), term = eye(n);
  for (let k = 1; k <= 12; k++) { term = mul(term, M).map(r => r.map(v => v / k)); addTo(E, term); }
  for (let i = 0; i < s; i++) E = mul(E, E);
  return E;
}
// seeded normal random numbers (mulberry32 + Box–Muller) so runs are repeatable
export function rng(seed = 1) {
  let a = seed >>> 0, spare = null;
  const u = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return () => { if (spare !== null) { const v = spare; spare = null; return v; } let x = 0; while (!x) x = u(); const r = Math.sqrt(-2 * Math.log(x)), th = 2 * Math.PI * u(); spare = r * Math.sin(th); return r * Math.cos(th); };
}

// ---------- sensor grades (Groves 2013 tables 4.1–4.2, typical values) ----------
// gyro bias °/h, accelerometer bias µg, angle random walk °/√h, accelerometer noise µg/√Hz
export const GRADES = {
  nav: { label: 'Navigation grade (ring-laser gyro, airliner)', gyro: 0.01, accel: 50, arw: 0.002, vrw: 10 },
  inter: { label: 'Intermediate (fibre-optic gyro, business jet)', gyro: 0.1, accel: 200, arw: 0.01, vrw: 30 },
  tact: { label: 'Tactical (missile, drone)', gyro: 3, accel: 1000, arw: 0.1, vrw: 100 },
  mems: { label: 'Consumer MEMS (phone class)', gyro: 150, accel: 10000, arw: 0.5, vrw: 300 },
};
export const toSI = g => ({ gyro: g.gyro * D / HR, accel: g.accel * 1e-6 * G0, arw: g.arw * D / 60, vrw: g.vrw * 1e-6 * G0 });

// ---------- INS error model ----------
// state: 0 δpN, 1 δpE, 2 δvN, 3 δvE, 4 φN, 5 φE, 6 φD (heading), 7–9 gyro bias N/E/D, 10–11 accel bias N/E
export const NX = 12;
export function errorModel(lat, fh = [0, 0], earth = true) {
  const W = earth ? OMEGA_E : 0, s = Math.sin(lat), c = Math.cos(lat), t = Math.tan(lat), R = R_E, g = G0, [fN, fE] = fh;
  const F = zeros(NX);
  F[0][2] = 1; F[1][3] = 1;
  // δv̇ = f × φ − 2Ω × δv + accelerometer bias   (f = [fN, fE, −g])
  F[2][5] = g; F[2][6] = fE; F[2][3] = -2 * W * s; F[2][10] = 1;
  F[3][4] = -g; F[3][6] = -fN; F[3][2] = 2 * W * s; F[3][11] = 1;
  // φ̇ = −Ω × φ + δω_ie (latitude error) + δω_en (velocity error) − gyro bias
  F[4][5] = -W * s; F[4][0] = -W * s / R; F[4][3] = 1 / R; F[4][7] = -1;
  F[5][4] = W * s; F[5][6] = W * c; F[5][2] = -1 / R; F[5][8] = -1;
  F[6][5] = -W * c; F[6][0] = -W * c / R; F[6][3] = -t / R; F[6][9] = -1;
  return F;
}
// Continuous noise spectral densities: angle random walk on the attitude, accelerometer noise on the velocity
function noiseQ(si) { const Q = zeros(NX); Q[2][2] = Q[3][3] = si.vrw ** 2; Q[4][4] = Q[5][5] = Q[6][6] = si.arw ** 2; return Q; }
const discreteQ = (Phi, Qc, dt) => { const A = sandwich(Phi, Qc); addTo(A, Qc); return A.map(r => r.map(v => v * dt / 2)); };

// Self-alignment on the ground: levelling leaves the tilt that cancels the accelerometer biases, and gyrocompassing
// leaves the heading error that cancels the east gyro bias. b = [εN, εE, εD, ∇N, ∇E].
export function alignedState(lat, b, earth = true) {
  const x = new Float64Array(NX); for (let i = 0; i < 5; i++) x[7 + i] = b[i];
  x[4] = b[4] / G0; x[5] = -b[3] / G0;
  const W = earth ? OMEGA_E : 0;
  x[6] = W ? (b[1] - W * Math.sin(lat) * x[4]) / (W * Math.cos(lat)) : 0;
  return x;
}
export function gyrocompassError(lat, epsE) { return epsE / (OMEGA_E * Math.cos(lat)); }
// Gyrocompassing only works when the gyro bias is small next to Earth rate (15°/h). Past a 1° heading error the
// heading is taken from an outside source instead (magnetic, or a transfer alignment), good to 1°.
export const HEAD_MAX = 1 * D;
export const canGyrocompass = (lat, gyro, aligned = true, earth = true) => !aligned || !earth || Math.abs(gyro) / (OMEGA_E * Math.cos(lat)) <= HEAD_MAX;
// the 12×5 map from biases to the initial error state (aligned or not)
function biasMap(lat, aligned, earth, gyro = 0) {
  const M = zeros(NX, 5);
  for (let j = 0; j < 5; j++) { const e = [0, 0, 0, 0, 0]; e[j] = 1; const x = aligned ? alignedState(lat, e, earth) : (() => { const v = new Float64Array(NX); v[7 + j] = 1; return v; })(); for (let i = 0; i < NX; i++) M[i][j] = x[i]; }
  if (!canGyrocompass(lat, gyro, aligned, earth)) M[6].fill(0);
  return M;
}

// Free-inertial error growth for given biases, plus the 1σ envelope for random biases of the grade's size and noise.
// bias = [εN, εE, εD (rad/s), ∇N, ∇E (m/s²)]; sig = SI grade (toSI) or null.
export function insRun({ lat, T, dt = 10, bias, aligned = true, earth = true, tilt0 = 0, vel0 = 0, sig = null }) {
  const F = errorModel(lat, [0, 0], earth), Phi = expm(F, dt), n = Math.round(T / dt);
  let x = aligned ? alignedState(lat, bias, earth) : (() => { const v = new Float64Array(NX); for (let i = 0; i < 5; i++) v[7 + i] = bias[i]; return v; })();
  const gc = canGyrocompass(lat, bias[1], aligned, earth);
  if (!gc) x[6] = 0;
  x[5] += tilt0; x[2] += vel0;
  let P = null, Qd = null, tmp = null, Pn = null;
  if (sig) {
    const M = biasMap(lat, aligned, earth, sig.gyro), Pb = zeros(5);
    [sig.gyro, sig.gyro, sig.gyro, sig.accel, sig.accel].forEach((v, i) => { Pb[i][i] = v * v; });
    const P0 = mul(mul(M, Pb), transpose(M)); if (!canGyrocompass(lat, sig.gyro, aligned, earth)) P0[6][6] += HEAD_MAX ** 2;
    P = flat(P0); Qd = flat(discreteQ(Phi, noiseQ(sig), dt)); tmp = new Float64Array(N2); Pn = new Float64Array(N2);
  }
  const Pf = flat(Phi), out = { t: [], x: [], sr: [], sN: [], sE: [], gyrocompass: gc };
  for (let k = 0; k <= n; k++) {
    out.t.push(k * dt); out.x.push(x);
    if (P) { out.sN.push(Math.sqrt(P[0])); out.sE.push(Math.sqrt(P[13])); out.sr.push(Math.sqrt(P[0] + P[13])); }
    x = propX(Pf, x, new Float64Array(NX));
    if (P) { propP(Pf, P, Qd, tmp, Pn); [P, Pn] = [Pn, P]; }
  }
  return out;
}

// Vertical channel: gravity falls off with height, so an altitude error feeds itself, δḧ = (2g/R)·δh + ∇D, and
// diverges with time constant √(R/2g) ≈ 9.5 min. A barometric altimeter closes a second-order loop around it.
export function vertical({ T, dt = 1, accel, baro = false, tau = 120, zeta = 0.7, baroErr = 0 }) {
  const k2 = 2 * G0 / R_E, wn = 2 * Math.PI / tau, c1 = baro ? 2 * zeta * wn : 0, c2 = baro ? wn * wn + k2 : 0;
  const f = (h, v) => [v, k2 * h + accel - c1 * v - c2 * (h - baroErr)];
  let h = 0, v = 0; const out = { t: [0], h: [0] }, n = Math.round(T / dt);
  for (let k = 1; k <= n; k++) {
    const a = f(h, v), b = f(h + a[0] * dt / 2, v + a[1] * dt / 2), c = f(h + b[0] * dt / 2, v + b[1] * dt / 2), d = f(h + c[0] * dt, v + c[1] * dt);
    h += dt / 6 * (a[0] + 2 * b[0] + 2 * c[0] + d[0]); v += dt / 6 * (a[1] + 2 * b[1] + 2 * c[1] + d[1]);
    out.t.push(k * dt); out.h.push(h);
  }
  out.tau = 1 / Math.sqrt(k2);
  return out;
}

// ---------- GNSS ----------
export const GPS_PERIOD = 2 * Math.PI * Math.sqrt(A_GPS ** 3 / MU);
// 24 satellites, 6 planes 60° apart, inclination 55°, 4 per plane, planes phased 15° (Walker 24/6/1). ECEF at time t (s).
export function gpsSats(t) {
  const n = Math.sqrt(MU / A_GPS ** 3), inc = 55 * D, th = OMEGA_E * t, out = [];
  for (let p = 0; p < 6; p++) for (let j = 0; j < 4; j++) {
    const raan = p * 60 * D, u = (j * 90 + p * 15) * D + n * t;
    const xo = A_GPS * Math.cos(u), yo = A_GPS * Math.sin(u);
    const X = xo * Math.cos(raan) - yo * Math.cos(inc) * Math.sin(raan), Y = xo * Math.sin(raan) + yo * Math.cos(inc) * Math.cos(raan), Z = yo * Math.sin(inc);
    out.push({ id: 'ABCDEF'[p] + (j + 1), pos: [X * Math.cos(th) + Y * Math.sin(th), -X * Math.sin(th) + Y * Math.cos(th), Z] });
  }
  return out;
}
// ECEF vector → local east, north, up
export function toEnu(lat, lon, d) {
  const sl = Math.sin(lat), cl = Math.cos(lat), so = Math.sin(lon), co = Math.cos(lon);
  return [-so * d[0] + co * d[1], -sl * co * d[0] - sl * so * d[1] + cl * d[2], cl * co * d[0] + cl * so * d[1] + sl * d[2]];
}
export function lookAngles(lat, lon, user, sat) {
  const d = [sat[0] - user[0], sat[1] - user[1], sat[2] - user[2]], r = Math.hypot(...d), [e, nn, u] = toEnu(lat, lon, d);
  return { az: (Math.atan2(e, nn) + 2 * Math.PI) % (2 * Math.PI), el: Math.asin(u / r), range: r, los: [e / r, nn / r, u / r] };
}
// Dilution of precision from the unit lines of sight in ENU: rows [−e, −n, −u, 1]
export function dop(los) {
  if (los.length < 4) return null;
  const G = los.map(l => [-l[0], -l[1], -l[2], 1]), Gt = transpose(G);
  let Q; try { Q = inv(mul(Gt, G)); } catch { return null; }
  const H = Math.sqrt(Q[0][0] + Q[1][1]), V = Math.sqrt(Q[2][2]), Tt = Math.sqrt(Q[3][3]);
  return { Q, H, V, T: Tt, P: Math.hypot(H, V), G: Math.sqrt(H * H + V * V + Tt * Tt) };
}
// Iterative least squares for position and clock bias from pseudoranges ρᵢ = |sᵢ − x| + b (b = c·δt, metres)
export function lsFix(sats, rho, x0 = [0, 0, 0, 0], tol = 1e-4, maxIt = 12) {
  let x = [...x0]; const hist = [];
  for (let it = 1; it <= maxIt; it++) {
    const H = [], dz = [];
    sats.forEach((s, i) => { const d = [s[0] - x[0], s[1] - x[1], s[2] - x[2]], r = Math.hypot(...d); H.push([-d[0] / r, -d[1] / r, -d[2] / r, 1]); dz.push(rho[i] - r - x[3]); });
    const Ht = transpose(H), dx = mulV(mul(inv(mul(Ht, H)), Ht), dz);
    for (let k = 0; k < 4; k++) x[k] += dx[k];
    const step = Math.hypot(dx[0], dx[1], dx[2], dx[3]); hist.push(step);
    if (step < tol) return { x, iter: it, hist, ok: true };
  }
  return { x, iter: maxIt, hist, ok: false };
}
// One epoch: visible satellites above the mask, DOP, a least-squares fix from noisy pseudoranges and a Monte Carlo cloud.
export function gnssEpoch({ lat, lon, h = 0, t = 0, mask = 10 * D, sigma = 5, clock = 1e-3, off = [], nMC = 200, seed = 7 }) {
  const user = geodeticToEcef(lat, lon, h), all = gpsSats(t).map(s => ({ ...s, ...lookAngles(lat, lon, user, s.pos) }));
  all.forEach(s => { s.visible = s.el >= mask; s.used = s.visible && !off.includes(s.id); });
  const used = all.filter(s => s.used), dp = dop(used.map(s => s.los)), b = C_LIGHT * clock, rnd = rng(seed);
  const res = { all, used, dop: dp, user, b };
  if (!dp) return res;
  const pos = used.map(s => s.pos), pr = () => used.map(s => s.range + b + sigma * rnd());
  res.fix = lsFix(pos, pr());
  const enuErr = x => toEnu(lat, lon, [x[0] - user[0], x[1] - user[1], x[2] - user[2]]);
  res.fixErr = enuErr(res.fix.x); res.clockErr = res.fix.x[3] - b;
  res.cloud = [];
  for (let k = 0; k < nMC; k++) { const f = lsFix(pos, pr(), [...user, b]); res.cloud.push(enuErr(f.x)); }
  return res;
}
export function dopSeries({ lat, lon, h = 0, mask = 10 * D, off = [], T0 = 0, T1 = 86400, step = 300 }) {
  const user = geodeticToEcef(lat, lon, h), out = [];
  for (let t = T0; t <= T1 + 1e-9; t += step) {
    const los = gpsSats(t).filter(s => !off.includes(s.id)).map(s => lookAngles(lat, lon, user, s.pos)).filter(l => l.el >= mask).map(l => l.los);
    out.push({ t, n: los.length, dop: dop(los) });
  }
  return out;
}

// ---------- Kalman filter ----------
export function kfUpdate(x, P, z, H, R) {
  const PHt = mul(P, transpose(H)), S = addTo(mul(H, PHt), R), K = mul(PHt, inv(S)), y = z.map((v, i) => v - H[i].reduce((s, h, j) => s + h * x[j], 0));
  const xn = Float64Array.from(x, (v, i) => v + K[i].reduce((s, k, j) => s + k * y[j], 0));
  const Pn = symmetrize(addTo(P.map(r => Float64Array.from(r)), mul(mul(K, S), transpose(K)), -1));
  return { x: xn, P: Pn, K, y, S };
}

// Loosely coupled INS/GNSS: the error state above, GNSS position fixes every gpsDt seconds (none during the outage).
// The truth draws its biases from the grade and adds sensor noise; the filter knows only the statistics.
// S-turns add a ±2 m/s² sideways acceleration, which makes the heading error observable.
export function insGnssKF({ lat, T = 3600, dt = 1, grade, gpsDt = 1, gpsSigma = 5, outage = [1200, 2100], manoeuvre = false, aligned = true, seed = 3, earth = true, rec = 5 }) {
  const si = toSI(grade), r = rng(seed), Qc = noiseQ(si), cache = {};
  const model = fE => { const k = fE.toFixed(3); if (!cache[k]) { const Phi = expm(errorModel(lat, [0, fE], earth), dt); cache[k] = { Phi: flat(Phi), Qd: flat(discreteQ(Phi, Qc, dt)) }; } return cache[k]; };
  const sb = [si.gyro, si.gyro, si.gyro, si.accel, si.accel], b = sb.map(s => s * r());
  const M = biasMap(lat, aligned, earth, si.gyro), Pb = zeros(5); sb.forEach((s, i) => { Pb[i][i] = s * s; });
  const gc = canGyrocompass(lat, si.gyro, aligned, earth);
  const sp0 = gpsSigma, sv0 = 0.1, st0 = 1e-4;   // start: a GNSS-quality position, small velocity and levelling noise
  const P0 = mul(mul(M, Pb), transpose(M)); P0[0][0] += sp0 ** 2; P0[1][1] += sp0 ** 2; P0[2][2] += sv0 ** 2; P0[3][3] += sv0 ** 2; P0[4][4] += st0 ** 2; P0[5][5] += st0 ** 2; if (!gc) P0[6][6] += HEAD_MAX ** 2;
  let P = flat(P0), Pn = new Float64Array(N2); const tmp = new Float64Array(N2);
  let x = mulV(M, b); x[0] += sp0 * r(); x[1] += sp0 * r(); x[2] += sv0 * r(); x[3] += sv0 * r(); x[4] += st0 * r(); x[5] += st0 * r(); if (!gc) x[6] += HEAD_MAX * r();
  let xh = new Float64Array(NX);
  const r2 = gpsSigma ** 2, qs = [0, 0, si.vrw, si.vrw, si.arw, si.arw, si.arw].map(v => v * Math.sqrt(dt));
  // P is stored flat (row-major, 12×12): element (i, j) is P[i*12 + j]
  const out = { t: [], x: [], xh: [], P: [], fixes: [], b, f: [], gyrocompass: gc };
  const n = Math.round(T / dt), gpsEvery = Math.max(1, Math.round(gpsDt / dt));
  const save = (k, fE) => { out.t.push(k * dt); out.x.push(x); out.xh.push(Float64Array.from(xh)); out.P.push(Float64Array.from(P)); out.f.push(fE); };
  save(0, 0);
  for (let k = 1; k <= n; k++) {
    const t = k * dt, fE = manoeuvre ? 2 * Math.sign(Math.sin(2 * Math.PI * t / 300)) : 0, { Phi, Qd } = model(fE);
    x = propX(Phi, x, new Float64Array(NX)); for (let i = 2; i < 7; i++) x[i] += qs[i] * r();
    xh = propX(Phi, xh, new Float64Array(NX)); propP(Phi, P, Qd, tmp, Pn); [P, Pn] = [Pn, P];
    const dark = t >= outage[0] && t < outage[1];
    if (k % gpsEvery === 0 && !dark) {
      const z0 = x[0] + gpsSigma * r(), z1 = x[1] + gpsSigma * r();
      posUpdate(xh, P, z0, z1, r2);
      if (k % (gpsEvery * Math.max(1, Math.round(30 / gpsDt))) === 0) out.fixes.push([t, z0, z1]);
    }
    if (k % rec === 0) save(k, fE);
  }
  return out;
}
export { WGS84 };
