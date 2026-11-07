// Stability and control augmentation: feedback laws around one control surface (elevator for pitch, rudder for yaw),
// their loop transfer function broken at the actuator (closed-loop roots, margins, root migration), and a time
// simulation with the parts the linear analysis leaves out: actuator rate and position limits, a sampled flight
// computer with transport delay, Dryden turbulence and a simple pilot model (for pilot-induced oscillation).
// DOM-free. SI inside: radians, rad/s, g. Gains are surface radians per unit of the measured signal.
// Sources: Stevens, Lewis & Johnson, Aircraft Control and Simulation (stability augmentation, pitch-rate and C*
// command systems, the F-16 model); Nelson, Flight Stability and Automatic Control ch. 10; MIL-F-8785C (levels);
// Tobie, Elliott & Malcom (1966) for C*; McRuer et al. on pilot-induced oscillation and rate limiting.
import * as Ct from './control.js';
import { drydenSeries, G0 } from './atmosphere.js';

export const VCO = 122;   // m/s (400 ft/s): crossover speed weighting pitch rate in C* = nz + (Vco/g)·q

// ---------- the aircraft seen from its one control surface ----------
// "up" input: −δe (nose up) for pitch, −δr (nose right, +r) for yaw
export function plantOf(an, axis) {
  if (axis === 'lon') {
    const A = an.lon.A, B = an.lon.B.map(b => -b), U = an.d.V;
    const nzC = A[1].map((a, j) => ((j === 2 ? U : 0) - a) / G0), nzD = -B[1] / G0;
    const rows = {
      alpha: { C: [0, 1 / U, 0, 0], D: 0 }, q: { C: [0, 0, 1, 0], D: 0 }, theta: { C: [0, 0, 0, 1], D: 0 },
      nz: { C: nzC, D: nzD }, cstar: { C: nzC.map((v, j) => v + (j === 2 ? VCO / G0 : 0)), D: nzD },
    };
    return { axis, A, B, U, rows, gustCol: 1, trimUp: -an.trim.de };
  }
  const A = an.lat.A, B = an.lat.Br.map(b => -b), U = an.d.V;
  const rows = { beta: { C: [1, 0, 0, 0], D: 0 }, p: { C: [0, 1, 0, 0], D: 0 }, r: { C: [0, 0, 1, 0], D: 0 }, phi: { C: [0, 0, 0, 1], D: 0 } };
  return { axis, A, B, U, rows, gustCol: 0, trimUp: 0 };
}

// ---------- control laws ----------
// lon: { ka, kq, knz, mode: 'direct' | 'rate' | 'cstar', kp, ki, kff, kstick }   (kp, ki act on the command error)
// lat: { kr, tw (washout s, 0 = none), kb, kstick }
// Returns the feedback channels {y, tf} and the command path F (r → surface command).
export function lawChannels(law, axis) {
  const ch = [], add = (y, g) => { if (g.num.some(v => v !== 0)) ch.push({ y, tf: g }); };
  let F;
  if (axis === 'lon') {
    if (law.ka) add('alpha', Ct.gain(law.ka));
    if (law.kq) add('q', Ct.gain(law.kq));
    if (law.knz) add('nz', Ct.gain(law.knz));
    if (law.mode === 'rate' || law.mode === 'cstar') {
      const pi = Ct.pid({ kp: law.kp || 0, ki: law.ki || 0 });
      // command path: the same PI on the error, plus a feed-forward kff that moves the surface at once instead of
      // waiting for the integrator (it does not change the loop, so stability and margins are untouched)
      add(law.mode === 'rate' ? 'q' : 'cstar', pi); F = law.kff ? { num: Ct.polyAdd(pi.num, Ct.polyMul([law.kff], pi.den)), den: pi.den } : pi;
    } else F = Ct.gain(law.kstick ?? 1);
  } else {
    if (law.kr) add('r', law.tw > 0 ? Ct.tfMul(Ct.gain(law.kr), Ct.washout(law.tw)) : Ct.gain(law.kr));
    // +β (nose left of the wind) needs nose-right rudder, the positive 'up' input: so up = +Kβ·β (channels subtract)
    if (law.kb) add('beta', Ct.gain(-law.kb));
    F = Ct.gain(law.kstick ?? 1);
  }
  return { ch, F };
}
const sameDen = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= 1e-12 * (1 + Math.abs(v)));
// Plant transfer function from the surface to one measured signal
export function plantTf(P, y) { const r = P.rows[y]; return Ct.ssToTf(P.A, P.B, r.C, r.D); }

// Loop broken at the actuator input: L(s) = A(s) D(s) Σ Cᵢ(s) Gᵢ(s). Every Gᵢ shares the aircraft's
// characteristic polynomial, so channels with the same compensator denominator add without repeating it.
// hw: { wa (rad/s, 0 = ideal), delay (s) }
export function loopTf(an, law, axis, hw = {}) {
  const P = plantOf(an, axis), { ch, F } = lawChannels(law, axis);
  const act = hw.wa > 0 ? Ct.actuator(hw.wa) : Ct.gain(1), del = hw.delay > 0 ? Ct.pade(hw.delay) : Ct.gain(1);
  // Σ Cᵢ Gᵢ = [Σ Cnᵢ Nᵢ Π_{j≠i} Cdⱼ] / [Δ(s) Π Cdⱼ]: every Gᵢ = Nᵢ/Δ shares the aircraft's Δ(s), so only the
  // compensator denominators are combined (cross-multiplying Δ would add copies of the open-loop poles)
  let sum = null;
  if (ch.length) {
    const groups = [];
    for (const c of ch) {
      const G = plantTf(P, c.y), cn = Ct.polyMul(c.tf.num, G.num), g = groups.find(x => sameDen(x.cd, c.tf.den));
      if (g) g.num = Ct.polyAdd(g.num, cn); else groups.push({ cd: c.tf.den, num: cn, D: G.den });
    }
    let num = [0], cd = [1];
    for (const g of groups) { num = Ct.polyAdd(Ct.polyMul(num, g.cd), Ct.polyMul(g.num, cd)); cd = Ct.polyMul(cd, g.cd); }
    sum = { num, den: Ct.polyMul(groups[0].D, cd) };
    // an integrator on pitch rate cancels q/δe's zero at the origin (∫q dt = θ): remove the common factor s,
    // which would otherwise leave a meaningless neutral root at exactly zero
    while (sum.num.length > 1 && sum.den.length > 1 && sum.num[sum.num.length - 1] === 0 && sum.den[sum.den.length - 1] === 0) { sum.num.pop(); sum.den.pop(); }
  }
  const L = sum ? Ct.tfMul(act, del, sum) : { num: [0], den: Ct.polyMul(Ct.polyMul(act.den, del.den), plantTf(P, Object.keys(P.rows)[0]).den) };
  return { P, ch, F, L, act, del };
}
export function closedLoopRoots(L) { return Ct.roots(Ct.polyAdd(L.den, L.num)); }

// ---------- handling-quality levels (MIL-F-8785C) ----------
// Short period by CAP and ζ; Dutch roll by ζ, ζωn and ωn. Category A: precise manoeuvring (fighters in combat),
// B: cruise and climb, C: takeoff and landing. Level 1 clearly adequate, 2 extra workload, 3 controllable.
export const SP_LIMITS = {
  A: [{ z: [0.35, 1.30], cap: [0.28, 3.6] }, { z: [0.25, 2.0], cap: [0.16, 10] }],
  B: [{ z: [0.30, 2.0], cap: [0.085, 3.6] }, { z: [0.20, 2.0], cap: [0.038, 10] }],
  C: [{ z: [0.35, 1.30], cap: [0.16, 3.6] }, { z: [0.25, 2.0], cap: [0.096, 10] }],
};
export function spLevel(zeta, cap, cat = 'A') {
  const L = SP_LIMITS[cat], ok = l => zeta >= l.z[0] && zeta <= l.z[1] && cap >= l.cap[0] && cap <= l.cap[1];
  return ok(L[0]) ? 1 : ok(L[1]) ? 2 : zeta >= 0.15 ? 3 : 4;
}
export const DR_LIMITS = { A: { z: 0.19, zw: 0.35, w: 1.0 }, B: { z: 0.08, zw: 0.15, w: 0.4 }, C: { z: 0.08, zw: 0.15, w: 1.0 } };
export function drLevel(zeta, wn, cat = 'A') {
  const l = DR_LIMITS[cat];
  return zeta >= l.z && zeta * wn >= l.zw && wn >= l.w ? 1 : zeta >= 0.02 && zeta * wn >= 0.05 && wn >= 0.4 ? 2 : zeta >= 0 && wn >= 0.4 ? 3 : 4;
}
// normal-load-factor sensitivity n/α (g per rad) for CAP = ωsp² / (n/α)
export const nAlpha = an => an.d.q * an.d.S * an.d.CLa / an.d.W;

// ---------- pure rate limiter (for the describing-function check) ----------
export function rateLimiter(u, dt, R) {
  const y = new Float64Array(u.length); y[0] = u[0];
  for (let i = 1; i < u.length; i++) { const d = u[i] - y[i - 1], m = R * dt; y[i] = y[i - 1] + Math.max(-m, Math.min(m, d)); }
  return y;
}

// ---------- time simulation ----------
// hw: { wa, rate (rad/s, Infinity = none), pos (rad, total deflection limit), delay (s), fs (Hz, 0 = continuous) }
// opts: { T, dt, input: {type: 'step'|'doublet'|'pulse'|'none', amp, t0, width}, x0, gust: {W20, h, seed},
//         pilot: {gain, tau, amp, t0} (tracks a θ or φ step through the command path), augmented (default true), olGain }
export function simulate(an, law, axis, hw, opts) {
  const P = plantOf(an, axis), aug = opts.augmented !== false;
  const { ch, F } = aug ? lawChannels(law, axis) : { ch: [], F: Ct.gain(opts.olGain ?? 1) };
  const T = opts.T, dt = opts.dt || 0.0025, n = Math.ceil(T / dt);
  const wa = hw.wa > 0 ? hw.wa : 0, R = hw.rate > 0 ? hw.rate : Infinity, pos = hw.pos > 0 ? hw.pos : Infinity;
  const fs = hw.fs > 0 ? hw.fs : 0, Ts = fs ? 1 / fs : dt, delay = Math.max(0, hw.delay || 0);
  const lon = axis === 'lon', U = P.U, A = P.A, B = P.B, gc = P.gustCol;
  // controller realisations
  const blocks = ch.map(c => ({ y: c.y, ss: Ct.tfToSs(c.tf) })), Fss = Ct.tfToSs(F);
  const nx = 4, nb = blocks.reduce((s, b) => s + b.ss.A.length, 0), nf = Fss.A.length, N = nx + 1 + nb + nf;
  // gust (m/s): vertical for pitch, lateral for yaw
  let gust = null;
  if (opts.gust && opts.gust.W20 > 0) {
    const gd = 0.02, gs = drydenSeries({ h: opts.gust.h ?? 3000, W20: opts.gust.W20, V: U, dt: gd, n: Math.ceil(T / gd) + 3, seed: opts.gust.seed || 7 });
    const arr = lon ? gs.w : gs.v;
    gust = t => { const k = t / gd, i = Math.min(arr.length - 2, Math.floor(k)), f = k - i; return arr[i] * (1 - f) + arr[i + 1] * f; };
  }
  const inp = opts.input || { type: 'none' };
  const cmdAt = t => {
    const { type, amp = 0, t0 = 0.5, width = 1 } = inp;
    if (type === 'step') return t >= t0 ? amp : 0;
    if (type === 'pulse') return t >= t0 && t < t0 + width ? amp : 0;
    if (type === 'doublet') return t >= t0 && t < t0 + width ? amp : t >= t0 + width && t < t0 + 2 * width ? -amp : 0;
    return 0;
  };
  const pil = opts.pilot;
  // measured signals from the state, the surface and the gust
  const deriv = (x, d, g) => A.map((row, i) => row.reduce((s, a, j) => s + a * x[j], 0) + B[i] * d - (g ? A[i][gc] * (lon ? g : g / U) : 0));
  const measure = (x, d, g, xd) => {
    if (lon) { const nz = (U * x[2] - xd[1]) / G0; return { alpha: (x[1] - g) / U, q: x[2], theta: x[3], nz, cstar: nz + VCO / G0 * x[2] }; }
    return { beta: x[0] - g / U, p: x[1], r: x[2], phi: x[3] };
  };
  // state z = [x(4), δ, block states…, F states]; command and surface command held between computer frames
  const z = new Array(N).fill(0); (opts.x0 || []).forEach((v, i) => { z[i] = v; });
  let dc = 0, rCmd = 0;
  const queue = [];   // computer outputs waiting out the transport delay: [time, value]
  const pilotHist = [];  // [time, attitude] for the pilot's reaction delay
  const ctrlOut = (zz, y, r) => {
    let k = nx + 1, u = 0;
    for (const b of blocks) { const m = b.ss.A.length; let o = b.ss.D * y[b.y]; for (let j = 0; j < m; j++) o += b.ss.C[j] * zz[k + j]; u -= o; k += m; }
    let o = Fss.D * r; for (let j = 0; j < nf; j++) o += Fss.C[j] * zz[k + j];
    return u + o;
  };
  const f = (zz, t, g, r, dcmd) => {
    const x = zz.slice(0, nx), d = zz[nx], xd = deriv(x, d, g), y = measure(x, d, g, xd), out = new Array(N).fill(0);
    for (let i = 0; i < nx; i++) out[i] = xd[i];
    let rate = wa ? wa * (dcmd - d) : 0;
    rate = Math.max(-R, Math.min(R, rate));
    const tot = P.trimUp + d;
    if ((tot >= pos && rate > 0) || (tot <= -pos && rate < 0)) rate = 0;
    out[nx] = rate;
    let k = nx + 1;
    for (const b of blocks) { const m = b.ss.A.length; for (let i = 0; i < m; i++) { let s = b.ss.B[i] * y[b.y]; for (let j = 0; j < m; j++) s += b.ss.A[i][j] * zz[k + j]; out[k + i] = s; } k += m; }
    for (let i = 0; i < nf; i++) { let s = Fss.B[i] * r; for (let j = 0; j < nf; j++) s += Fss.A[i][j] * zz[k + j]; out[k + i] = s; }
    return { out, y, xd };
  };
  const every = Math.max(1, Math.round(n / 1000));
  const rec = { t: [], x: [], y: [], d: [], dc: [], drate: [], r: [], g: [], satRate: [], satPos: [], departed: null, trimUp: P.trimUp };
  let nextSample = 0, t = 0;
  for (let i = 0; i <= n; i++) {
    t = i * dt;
    const g = gust ? gust(t) : 0;
    // flight computer frame (and the pilot, at the same rate)
    if (t >= nextSample - 1e-12) {
      const cur = f(z, t, g, rCmd, dc).y;
      if (pil) {
        const att = lon ? z[3] : z[3];
        pilotHist.push([t, att]);
        while (pilotHist.length > 1 && pilotHist[1][0] <= t - pil.tau) pilotHist.shift();
        const seen = pilotHist[0][0] <= t - pil.tau ? pilotHist[0][1] : 0;
        const tgt = t >= (pil.t0 ?? 0.5) ? pil.amp : 0;
        rCmd = pil.gain * (tgt - seen);
      } else rCmd = cmdAt(t);
      queue.push([t, ctrlOut(z, cur, rCmd)]);
      nextSample += Ts;
    }
    while (queue.length > 1 && queue[1][0] <= t - delay + 1e-12) queue.shift();
    if (queue.length && queue[0][0] <= t - delay + 1e-12) dc = queue[0][1];
    if (!wa) z[nx] = dc;   // ideal actuator: surface follows the command (still limited below)
    const k1 = f(z, t, g, rCmd, dc);
    if (i % every === 0) {
      const tot = P.trimUp + z[nx], rate = k1.out[nx];
      rec.t.push(t); rec.x.push(z.slice(0, nx)); rec.y.push(k1.y); rec.d.push(tot); rec.dc.push(P.trimUp + dc); rec.drate.push(rate); rec.r.push(rCmd); rec.g.push(g);
      rec.satRate.push(wa > 0 && Math.abs(rate) >= R * 0.999); rec.satPos.push(Math.abs(tot) >= pos * 0.999);
    }
    if (i === n) break;
    const add = (a, b, s) => a.map((v, j) => v + s * b[j]);
    const g2 = gust ? gust(t + dt / 2) : 0, g3 = gust ? gust(t + dt) : 0;
    const k2 = f(add(z, k1.out, dt / 2), t + dt / 2, g2, rCmd, dc).out, k3 = f(add(z, k2, dt / 2), t + dt / 2, g2, rCmd, dc).out, k4 = f(add(z, k3, dt), t + dt, g3, rCmd, dc).out;
    for (let j = 0; j < N; j++) z[j] += dt / 6 * (k1.out[j] + 2 * k2[j] + 2 * k3[j] + k4[j]);
    if (!wa) z[nx] = dc;
    // position limit (total deflection) and rate limit for an ideal actuator
    const lo = -pos - P.trimUp, hi = pos - P.trimUp;
    z[nx] = Math.max(lo, Math.min(hi, z[nx]));
    // the small-disturbance model stops being meaningful beyond these angles
    const big = lon ? Math.abs(z[1] / U) > 0.5 || Math.abs(z[3]) > 1.2 : Math.abs(z[0]) > 0.5 || Math.abs(z[3]) > 1.6;
    if (big || !z.every(isFinite)) { rec.departed = { t: t + dt, what: lon ? (Math.abs(z[1] / U) > 0.5 ? 'angle of attack' : 'pitch attitude') : (Math.abs(z[0]) > 0.5 ? 'sideslip' : 'bank angle') }; break; }
  }
  return rec;
}
