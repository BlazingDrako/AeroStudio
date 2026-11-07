// Classical control for single-input, single-output loops: transfer functions from the aircraft state matrices,
// poles and zeros, frequency response, gain/phase/delay margins, root locus, closed loops and step responses,
// and the standard compensators (PID, lead–lag, washout), first-order actuators and Padé delays.
// DOM-free. Polynomials are real coefficient arrays, highest power first: [1, 3, 2] is s² + 3s + 2.
// Sources: Franklin, Powell & Emami-Naeini, Feedback Control of Dynamic Systems; Ogata, Modern Control Engineering;
// Nelson, Flight Stability and Automatic Control, ch. 9–10; Stevens, Lewis & Johnson, Aircraft Control and Simulation.
import { polyRoots } from './stability.js';

// ---------- polynomials ----------
export const polyMul = (a, b) => { const r = new Array(a.length + b.length - 1).fill(0); a.forEach((x, i) => b.forEach((y, j) => { r[i + j] += x * y; })); return r; };
export function polyAdd(a, b) {
  const n = Math.max(a.length, b.length), r = new Array(n).fill(0);
  a.forEach((x, i) => { r[n - a.length + i] += x; }); b.forEach((x, i) => { r[n - b.length + i] += x; });
  return r;
}
export const polyScale = (a, k) => a.map(x => x * k);
export const polyVal = (p, x) => p.reduce((s, c) => s * x + c, 0);
// value at a complex point z = [re, im]
export function polyValC(p, re, im) { let a = 0, b = 0; for (const c of p) { const r = a * re - b * im + c; b = a * im + b * re; a = r; } return [a, b]; }
// polynomial with the given (complex-conjugate-closed) roots, times k
export function polyFromRoots(roots, k = 1) {
  let p = [1];
  const done = new Set();
  roots.forEach(([re, im], i) => {
    if (done.has(i)) return;
    if (Math.abs(im) > 0) {
      p = polyMul(p, [1, -2 * re, re * re + im * im]);
      const j = roots.findIndex(([r2, i2], jj) => jj !== i && !done.has(jj) && Math.abs(r2 - re) < 1e-9 * (1 + Math.abs(re)) && Math.abs(i2 + im) < 1e-9 * (1 + Math.abs(im)));
      if (j >= 0) done.add(j);
    } else p = polyMul(p, [1, -re]);
    done.add(i);
  });
  return polyScale(p, k);
}
// drop leading coefficients that are round-off at the frequency scale ws (|c_k| ws^(n−k) tiny against the rest)
export function trimPoly(p, ws = 1, tol = 1e-11) {
  const n = p.length - 1, size = p.map((c, k) => Math.abs(c) * ws ** (n - k)), big = Math.max(...size);
  let i = 0; while (i < n && size[i] <= tol * big) i++;
  return big === 0 ? [0] : p.slice(i);
}
// roots of any real polynomial: exact zero roots first, then the rest with the frequency scaled to about 1 so that
// roots spread over several decades (phugoid 0.05 rad/s, actuator 50 rad/s) are found accurately
export function roots(p) {
  let q = p.slice(); while (q.length > 1 && q[0] === 0) q.shift();
  const out = [];
  while (q.length > 1 && q[q.length - 1] === 0) { q.pop(); out.push([0, 0]); }
  const n = q.length - 1;
  if (n < 1) return out;
  if (n === 1) return [...out, [-q[1] / q[0], 0]];
  const sc = Math.abs(q[n] / q[0]) ** (1 / n) || 1;
  const m = q.map((c, k) => c / q[0] / sc ** k);
  return [...out, ...polyRoots(m).map(([re, im]) => [re * sc, im * sc])];
}

// ---------- transfer functions {num, den} ----------
export const tf = (num, den) => ({ num: num.slice(), den: den.slice() });
export const tfMul = (...gs) => gs.reduce((a, b) => ({ num: polyMul(a.num, b.num), den: polyMul(a.den, b.den) }));
export const tfScale = (g, k) => ({ num: polyScale(g.num, k), den: g.den.slice() });
// complex value G(jω) = [re, im]
export function freqResp(g, w) {
  const [nr, ni] = polyValC(g.num, 0, w), [dr, di] = polyValC(g.den, 0, w), d2 = dr * dr + di * di;
  return [(nr * dr + ni * di) / d2, (ni * dr - nr * di) / d2];
}
export const dcGain = g => polyVal(g.num, 0) / polyVal(g.den, 0);
export const poles = g => roots(g.den);
export const zeros = g => (g.num.length > 1 ? roots(g.num) : []);
// negative feedback: forward G, feedback H (default 1) → G / (1 + G H)
export function feedback(G, H = { num: [1], den: [1] }) {
  return { num: polyMul(G.num, H.den), den: polyAdd(polyMul(G.den, H.den), polyMul(G.num, H.num)) };
}
export const isStable = g => poles(g).every(([re]) => re < 0);

// State space (A, B column, C row, D) → transfer function by the Faddeev–LeVerrier recursion:
// adj(sI − A) = Σ M_{k+1} s^{n−1−k} with M₁ = I, M_{k+1} = A M_k + c_k I, and det(sI − A) = Σ c_k s^{n−k}.
export function ssToTf(A, B, C, D = 0) {
  const n = A.length, den = [1], num = [];
  let M = A.map((r, i) => r.map((_, j) => (i === j ? 1 : 0)));
  for (let k = 1; k <= n; k++) {
    num.push(C.reduce((s, ci, i) => s + ci * M[i].reduce((t, m, j) => t + m * B[j], 0), 0));
    const AM = A.map(r => M[0].map((_, j) => r.reduce((s, a, l) => s + a * M[l][j], 0)));
    const ck = -AM.reduce((s, r, i) => s + r[i], 0) / k;
    den.push(ck);
    M = AM.map((r, i) => r.map((v, j) => v + (i === j ? ck : 0)));
  }
  const full = D ? polyAdd([0, ...num], polyScale(den, D)) : [0, ...num];
  const dm = roots(den).map(z => Math.hypot(...z)), ws = 1 + Math.max(...dm), wlow = Math.min(...dm.filter(m => m > 0), 1);
  const nm = trimPoly(full, ws), k = nm.length - 1;
  // a structural zero at the origin (q = sθ) comes out as round-off: snap it to exactly zero
  if (k >= 1 && Math.abs(nm[k]) < 1e-10 * Math.abs(nm[k - 1]) * wlow) nm[k] = 0;
  return { num: nm, den };
}
// Add an integrator state ż = c·x (+ d·u), e.g. altitude ḣ = U θ − w or heading ψ̇ = r
export function augment(A, B, c, d = 0) {
  return { A: [...A.map(r => [...r, 0]), [...c, 0]], B: [...B, d] };
}

// ---------- building blocks ----------
export const gain = k => tf([k], [1]);
export const integrator = () => tf([1], [1, 0]);
export const actuator = wa => tf([wa], [1, wa]);                     // first-order lag, bandwidth wa rad/s
export const washout = tau => tf([tau, 0], [tau, 1]);                // τs / (τs + 1): passes changes, blocks steady values
export const leadLag = (k, z, p) => tf([k / z, k], [1 / p, 1]);       // k (s/z + 1)/(s/p + 1)
// PID in parallel form with a filtered derivative: Kp + Ki/s + Kd s/(τf s + 1)
export function pid({ kp = 0, ki = 0, kd = 0, tf: tauF = 0.02 }) {
  // common denominator s (τf s + 1)
  const den = ki ? [tauF, 1, 0] : [tauF, 1];
  let num = polyMul([kp], [tauF, 1]);
  if (ki) num = polyAdd(polyMul(num, [1, 0]), [ki * tauF, ki]);
  num = polyAdd(num, kd ? (ki ? [kd, 0, 0] : [kd, 0]) : [0]);
  if (!kd && !ki) return tf([kp], [1]);
  if (!kd) return tf([kp, ki], [1, 0]);                                // PI: (Kp s + Ki)/s
  return tf(trimPoly(num), den);
}
// Padé approximation of a pure delay e^(−sT), order 1 or 2 (all-pass: gain exactly 1, phase ≈ −ωT)
export function pade(T, order = 2) {
  if (!(T > 0)) return tf([1], [1]);
  if (order === 1) return tf([-T / 2, 1], [T / 2, 1]);
  return tf([T * T / 12, -T / 2, 1], [T * T / 12, T / 2, 1]);
}

// ---------- frequency response from roots: continuous phase without unwrapping ----------
// G(s) = k Π(s − z)/Π(s − p). Phase is the sum of the factor angles, so it is continuous in ω.
export function factor(g) {
  const z = zeros(g), p = poles(g);
  const lead = g.num.find(c => c !== 0) ?? 0;   // skip leading zero coefficients (e.g. a PI with Kp = 0)
  return { z, p, k: lead / g.den[0] };
}
export function bodePoint(f, w) {
  let mag = Math.abs(f.k), ph = f.k < 0 ? -Math.PI : 0;
  for (const [re, im] of f.z) { mag *= Math.hypot(-re, w - im); ph += Math.atan2(w - im, -re); }
  for (const [re, im] of f.p) { mag /= Math.hypot(-re, w - im); ph -= Math.atan2(w - im, -re); }
  return { mag, db: 20 * Math.log10(mag), ph };
}
// default frequency range: a decade beyond the slowest and fastest finite roots
export function freqRange(f) {
  const ms = [...f.z, ...f.p].map(z => Math.hypot(...z)).filter(m => m > 1e-9);
  const lo = ms.length ? Math.min(...ms) : 1, hi = ms.length ? Math.max(...ms) : 1;
  return [Math.max(1e-3, lo / 10), Math.min(1e4, Math.max(hi * 10, lo * 100))];
}
// Frequencies for plotting: a log grid plus dense points across every lightly damped resonance (and anti-resonance),
// so a sharp phugoid or Dutch-roll peak is drawn smoothly
export function freqGrid(f, w0, w1, n = 400) {
  const ws = Array.from({ length: n + 1 }, (_, i) => w0 * (w1 / w0) ** (i / n));
  for (const z of [...f.p, ...f.z]) {
    if (!(z[1] > 0)) continue;
    const { wn, zeta } = damping(z), half = wn * Math.max(4 * Math.abs(zeta), 0.01);
    for (let i = 0; i <= 120; i++) { const w = wn - half + 2 * half * i / 120; if (w > w0 && w < w1) ws.push(w); }
  }
  return ws.sort((a, b) => a - b);
}
export function bode(g, w0, w1, n = 400) {
  const f = factor(g); if (!w0) [w0, w1] = freqRange(f);
  const out = freqGrid(f, w0, w1, n).map(w => ({ w, ...bodePoint(f, w) }));
  // shift the whole phase curve by a multiple of 360° so it starts in (−180°, +180°]
  const turns = Math.ceil((out[0].ph - Math.PI) / (2 * Math.PI) - 1e-9);
  for (const o of out) o.ph -= turns * 2 * Math.PI;
  return out;
}

// Gain and phase margins of a loop transfer function L(s), with negative feedback.
// Returns every crossing: gain crossovers (|L| = 1) with their phase margins, and phase crossovers (∠L = −180°)
// with |L| there. The gain margin is how far the gain can rise (or fall, for a conditionally stable loop) before
// the closed loop loses stability. The delay margin is the extra time delay that uses up the phase margin.
export function margins(L, w0, w1) {
  const f = factor(L); if (!w0) [w0, w1] = freqRange(f);
  w0 = Math.min(w0, 1e-3); w1 = Math.max(w1, 1e3);
  const n = 3000, ws = Array.from({ length: n + 1 }, (_, i) => w0 * (w1 / w0) ** (i / n));
  const P = w => bodePoint(f, w);
  const wrap = a => { let x = (a + Math.PI) % (2 * Math.PI); if (x < 0) x += 2 * Math.PI; return x - Math.PI; };   // (−π, π]
  const pc = w => wrap(P(w).ph + Math.PI);                                                // zero at a phase crossover
  const bis = (fn, a, b) => { let fa = fn(a); for (let i = 0; i < 80; i++) { const m = Math.sqrt(a * b), fm = fn(m); if ((fm > 0) === (fa > 0)) { a = m; fa = fm; } else b = m; } return Math.sqrt(a * b); };
  const gc = [], ph = [];
  let prev = P(ws[0]), prevPc = pc(ws[0]);
  for (let i = 1; i <= n; i++) {
    const cur = P(ws[i]), curPc = pc(ws[i]);
    if ((prev.db > 0) !== (cur.db > 0)) {
      const w = bis(x => P(x).db, ws[i - 1], ws[i]), pt = P(w), pm = wrap(pt.ph + Math.PI);
      gc.push({ w, pm, pmDeg: pm * 180 / Math.PI, delay: pm > 0 ? pm / w : 0 });
    }
    if ((prevPc > 0) !== (curPc > 0) && Math.abs(curPc - prevPc) < Math.PI) {
      const w = bis(pc, ws[i - 1], ws[i]), pt = P(w);
      ph.push({ w, mag: pt.mag, db: pt.db, gmDb: -pt.db });
    }
    prev = cur; prevPc = curPc;
  }
  // ω = 0 is a phase crossover too when L(0) is real and negative (typical of an open-loop-unstable airframe):
  // the closed loop then needs |L(0)| > 1, so the gain can only fall by |L(0)| before it diverges
  const n0 = polyVal(L.num, 0), d0 = polyVal(L.den, 0), nBig = Math.max(...L.num.map(Math.abs));
  if (d0 !== 0 && n0 / d0 < 0 && Math.abs(n0) > 1e-9 * nBig) { const mag = Math.abs(n0 / d0); ph.unshift({ w: 0, mag, db: 20 * Math.log10(mag), gmDb: -20 * Math.log10(mag) }); }
  // With the closed loop stable, every margin is a distance from the critical point, so phase margins are the
  // angle between ∠L and −180° at each crossover (a crossover near +180° is as close to instability as one at −180°)
  // (a root creeping out slower than doubling in ~6 minutes, like a near-neutral spiral, counts as stable here)
  const stable = clPoles(L).every(z => z[0] < 2e-3);
  if (stable) for (const g of gc) { g.pm = Math.abs(g.pm); g.pmDeg = Math.abs(g.pmDeg); g.delay = g.pm / g.w; }
  // the critical crossover: for a stable loop the one with the smallest delay margin (a thin margin at a slow
  // phugoid crossover still allows seconds of delay, so it is not the one that matters); otherwise the smallest |PM|
  const pm = !gc.length ? null : stable ? gc.reduce((a, b) => (b.delay < a.delay ? b : a)) : gc.reduce((a, b) => (Math.abs(b.pm) < Math.abs(a.pm) ? b : a));
  const up = ph.filter(x => x.db < 0).sort((a, b) => b.db - a.db)[0] || null;   // |L| < 1 at −180°: room to raise gain
  const down = ph.filter(x => x.db > 0).sort((a, b) => a.db - b.db)[0] || null;  // |L| > 1 at −180°: room to lower it
  return { gc, ph, pm, gmUp: up, gmDown: down, stable, w0, w1 };
}

// ---------- root locus: closed-loop poles of den + K·num as K runs from 0 to ∞ ----------
// Each step starts the root finder from the previous roots (Durand–Kerner converges in a few iterations from a good
// guess and keeps every root on its own branch), matches the new roots to the old by the globally closest pairs, and
// halves the gain step wherever any root moved more than a few percent of its size, so branches stay smooth through
// break-away points and do not swap.
function dkFrom(p, guess) {
  const a0 = p[0], c = p.map(x => x / a0), n = c.length - 1;
  if (guess.length !== n) return null;
  let z = guess.map(g => [g[0] + 1e-9 * (1 + Math.abs(g[1])), g[1] + 1e-9 * (1 + Math.abs(g[0]))]);
  for (let it = 0; it < 80; it++) {
    let moved = 0;
    z = z.map((zi, i) => {
      let pr = 1, pi = 0;
      for (let k = 1; k <= n; k++) { const r = pr * zi[0] - pi * zi[1] + c[k], im = pr * zi[1] + pi * zi[0]; pr = r; pi = im; }
      let dr = 1, di = 0;
      z.forEach((zj, j) => { if (j !== i) { const ar = zi[0] - zj[0], ai = zi[1] - zj[1], r = dr * ar - di * ai; di = dr * ai + di * ar; dr = r; } });
      const d2 = dr * dr + di * di || 1e-300, qr = (pr * dr + pi * di) / d2, qi = (pi * dr - pr * di) / d2;
      moved = Math.max(moved, Math.hypot(qr, qi) / (1 + Math.hypot(zi[0], zi[1])));
      return [zi[0] - qr, zi[1] - qi];
    });
    if (!z.every(v => isFinite(v[0]) && isFinite(v[1]))) return null;
    if (moved < 1e-13) return z.map(([re, im]) => [re, Math.abs(im) < 1e-9 * (1 + Math.abs(re)) ? 0 : im]);
  }
  return null;
}
// order the roots `cur` to follow `prev`: closest pairs first
function matchRoots(prev, cur) {
  const pairs = [];
  prev.forEach((p, i) => p && cur.forEach((c, j) => pairs.push([Math.hypot(p[0] - c[0], p[1] - c[1]), i, j])));
  pairs.sort((x, y) => x[0] - y[0]);
  const out = new Array(prev.length).fill(null), usedP = new Set(), usedC = new Set();
  for (const [, i, j] of pairs) { if (usedP.has(i) || usedC.has(j)) continue; out[i] = cur[j]; usedP.add(i); usedC.add(j); }
  return out;
}
export function rootLocus(L, k0 = 1e-4, k1 = 1e4, n = 120, { rel = 0.02, maxSolves = 6000, floor: fl } = {}) {
  const poly = k => polyAdd(L.den, polyScale(L.num, k));
  let solves = 0;
  const solve = (k, guess) => { solves++; const p = trimPoly(poly(k)); const z = guess && guess.every(Boolean) && dkFrom(p, guess); return z ? matchRoots(guess, z) : (guess ? matchRoots(guess, roots(p)) : roots(p)); };
  const r0 = solve(0, null), all = [...roots(L.den), ...(L.num.length > 1 ? roots(L.num) : [])];
  const floor = fl ?? 2e-4 * Math.max(1e-6, ...all.map(z => Math.hypot(...z)));
  const tooFar = (a, b) => a.some((x, i) => x && b[i] && Math.hypot(x[0] - b[i][0], x[1] - b[i][1]) > rel * (Math.hypot(...x) + floor) + floor);
  const pts = [{ k: 0, r: r0 }];
  const ks = Array.from({ length: n + 1 }, (_, i) => k0 * (k1 / k0) ** (i / n));
  let prev = pts[0];
  for (const kb of ks) {
    // walk from prev.k to kb, halving the step while roots jump
    let target = kb;
    while (prev.k < kb) {
      let r = solve(target, prev.r), depth = 0;
      while (tooFar(prev.r, r) && depth < 16 && solves < maxSolves) {
        target = prev.k === 0 ? target / 2 : Math.sqrt(prev.k * target);
        r = solve(target, prev.r); depth++;
      }
      prev = { k: target, r }; pts.push(prev);
      target = kb;
    }
  }
  return r0.map((_, i) => pts.filter(p => p.r[i]).map(p => ({ k: p.k, re: p.r[i][0], im: p.r[i][1] })));
}
// closed-loop poles at one gain multiplier
export const clPoles = (L, k = 1) => roots(polyAdd(L.den, polyScale(L.num, k)));

// ---------- time response ----------
// Controllable canonical realisation of a proper G, then RK4. Returns t, y (and the input) at up to ~800 points.
export function tfToSs(g) {
  const a0 = g.den[0], den = g.den.map(c => c / a0), n = den.length - 1;
  let num = g.num.map(c => c / a0);
  while (num.length < n + 1) num = [0, ...num];
  const D = num[0], b = num.slice(1).map((c, i) => c - D * den[i + 1]);   // strictly proper part
  const A = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i < n - 1 ? (j === i + 1 ? 1 : 0) : -den[n - j])));
  const B = Array.from({ length: n }, (_, i) => (i === n - 1 ? 1 : 0));
  const C = Array.from({ length: n }, (_, j) => b[n - 1 - j]);
  return { A, B, C, D };
}
export function response(g, u, T, dt) {
  const { A, B, C, D } = tfToSs(g), n = A.length;
  if (!dt) { const r = roots(g.den).map(z => Math.hypot(...z)); dt = Math.min(0.01, T / 2000, 0.25 / Math.max(1e-6, ...r)); }
  const f = (x, t) => A.map((row, i) => row.reduce((s, a, j) => s + a * x[j], 0) + B[i] * u(t));
  const every = Math.max(1, Math.round(T / dt / 800));
  const out = { t: [], y: [], diverged: false };
  let x = new Array(n).fill(0), t = 0;
  for (let k = 0; t <= T + 1e-9; k++) {
    if (k % every === 0) { out.t.push(t); out.y.push(C.reduce((s, c, j) => s + c * x[j], 0) + D * u(t)); }
    if (n === 0) { t += dt; continue; }
    const k1 = f(x, t), k2 = f(x.map((v, i) => v + dt / 2 * k1[i]), t + dt / 2), k3 = f(x.map((v, i) => v + dt / 2 * k2[i]), t + dt / 2), k4 = f(x.map((v, i) => v + dt * k3[i]), t + dt);
    x = x.map((v, i) => v + dt / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])); t += dt;
    if (!x.every(isFinite) || Math.max(...x.map(Math.abs)) > 1e9) { out.diverged = true; break; }
  }
  return out;
}
export const step = (g, T, dt) => response(g, () => 1, T, dt);

// Step-response figures: final value (DC gain if stable), 10–90% rise time, peak overshoot, 2% settling time
export function stepInfo(r, final) {
  const { t, y } = r, n = y.length;
  if (final === undefined) final = y[n - 1];
  if (!isFinite(final) || Math.abs(final) < 1e-12) return { final, rise: NaN, overshoot: NaN, settle: NaN, peak: Math.max(...y.map(Math.abs)) };
  const s = Math.sign(final), yy = y.map(v => v * s), F = Math.abs(final);
  const t10 = t[yy.findIndex(v => v >= 0.1 * F)], t90 = t[yy.findIndex(v => v >= 0.9 * F)];
  let pk = -Infinity, tp = NaN; yy.forEach((v, i) => { if (v > pk) { pk = v; tp = t[i]; } });
  let settle = 0; for (let i = n - 1; i >= 0; i--) if (Math.abs(yy[i] - F) > 0.02 * F) { settle = i < n - 1 ? t[i + 1] : NaN; break; }
  return { final, rise: t90 !== undefined && t10 !== undefined ? t90 - t10 : NaN, overshoot: Math.max(0, (pk - F) / F), peakTime: tp, settle };
}

// ---------- second-order reference results (used by the tests and the insights) ----------
// Unity feedback around ωn²/(s(s + 2ζωn)): the closed loop is the standard second-order system.
export function secondOrder(zeta, wn) {
  const wc = wn * Math.sqrt(Math.sqrt(1 + 4 * zeta ** 4) - 2 * zeta ** 2);
  return {
    overshoot: zeta < 1 ? Math.exp(-Math.PI * zeta / Math.sqrt(1 - zeta * zeta)) : 0,
    peakTime: zeta < 1 ? Math.PI / (wn * Math.sqrt(1 - zeta * zeta)) : Infinity,
    wc, pm: Math.atan(2 * zeta * wn / wc),
  };
}

// ---------- mode labels for plant poles ----------
export function damping([re, im]) { const wn = Math.hypot(re, im); return { wn, zeta: wn > 0 ? -re / wn : 1 }; }

// ---------- aircraft loops ----------
// The loops a designer closes first. Input signs are chosen so a positive command gives a positive response:
// elevator is used as −δe (trailing edge up, nose up), rudder as −δr for yaw rate.
// Output units for display: angles in degrees, rates in deg/s, load factor in g; inputs in degrees of surface.
export const LOOPS = [
  { id: 'q', label: 'Pitch rate q', short: 'q', axis: 'lon', input: 'elevator', sign: -1, unit: 'deg/s', role: 'pitch damper' },
  { id: 'theta', label: 'Pitch attitude θ', short: 'θ', axis: 'lon', input: 'elevator', sign: -1, unit: 'deg', role: 'attitude hold' },
  { id: 'alpha', label: 'Angle of attack α', short: 'α', axis: 'lon', input: 'elevator', sign: -1, unit: 'deg', role: 'α feedback' },
  { id: 'nz', label: 'Normal load factor nz', short: 'nz', axis: 'lon', input: 'elevator', sign: -1, unit: 'g', role: 'g command' },
  { id: 'p', label: 'Roll rate p', short: 'p', axis: 'lat', input: 'aileron', sign: 1, unit: 'deg/s', role: 'roll damper' },
  { id: 'phi', label: 'Bank angle φ', short: 'φ', axis: 'lat', input: 'aileron', sign: 1, unit: 'deg', role: 'wing leveller' },
  { id: 'r', label: 'Yaw rate r', short: 'r', axis: 'lat', input: 'rudder', sign: -1, unit: 'deg/s', role: 'yaw damper' },
  { id: 'beta', label: 'Sideslip β', short: 'β', axis: 'lat', input: 'rudder', sign: 1, unit: 'deg', role: 'turn coordinator' },
];
// Plant transfer function (output per degree of input) from a stability analysis (stability.js analyse()).
export function aircraftPlant(an, id) {
  const L = LOOPS.find(l => l.id === id) || LOOPS[0];
  const G0 = 9.80665, DEG = Math.PI / 180;
  let A, B, C, D = 0, k = 1;
  if (L.axis === 'lon') {
    A = an.lon.A; B = an.lon.B;
    const U = an.d.V;
    if (id === 'q') C = [0, 0, 1, 0];
    else if (id === 'theta') C = [0, 0, 0, 1];
    else if (id === 'alpha') C = [0, 1 / U, 0, 0];
    else { C = A[1].map((a, j) => ((j === 2 ? U : 0) - a) / G0); D = -B[1] / G0; k = DEG; }   // nz = (U q − ẇ)/g
  } else {
    A = an.lat.A; B = L.input === 'aileron' ? an.lat.Ba : an.lat.Br;
    C = { p: [0, 1, 0, 0], phi: [0, 0, 0, 1], r: [0, 0, 1, 0], beta: [1, 0, 0, 0] }[id];
  }
  const G = tfScale(ssToTf(A, B.map(b => b * L.sign), C, D * L.sign), k);
  return { loop: L, G, A, B, C, D };
}
