// Vibration response: single-degree-of-freedom oscillators (free, harmonic, base motion, pulses,
// sweeps, earthquakes), frequency response functions, shock response spectra, a 2-DOF tuned
// absorber, and modal superposition for structures. SI units, no DOM.

const TAU = 2 * Math.PI;

// ---------------------------------------------------------------- SDOF time integration
// Exact solution for a load that varies linearly over each step (Nigam–Jennings / Chopra Table 5.2.1).
// Unit mass: ü + 2ζωu̇ + ω²u = p(t). Returns {u, v, a} arrays. For ζ ≥ 1 uses Newmark average acceleration.
export function sdofResponse(wn, zeta, p, dt, u0 = 0, v0 = 0) {
  const n = p.length, u = new Float64Array(n), v = new Float64Array(n), a = new Float64Array(n);
  u[0] = u0; v[0] = v0;
  const k = wn * wn;
  if (zeta < 1 && wn > 0) {
    const sq = Math.sqrt(1 - zeta * zeta), wd = wn * sq, e = Math.exp(-zeta * wn * dt), s = Math.sin(wd * dt), c = Math.cos(wd * dt);
    const A = e * (zeta / sq * s + c), B = e * s / wd;
    const C = (2 * zeta / (wn * dt) + e * (((1 - 2 * zeta * zeta) / (wd * dt) - zeta / sq) * s - (1 + 2 * zeta / (wn * dt)) * c)) / k;
    const D = (1 - 2 * zeta / (wn * dt) + e * ((2 * zeta * zeta - 1) / (wd * dt) * s + 2 * zeta / (wn * dt) * c)) / k;
    const A1 = -e * (wn / sq * s), B1 = e * (c - zeta / sq * s);
    const C1 = (-1 / dt + e * ((wn / sq + zeta / (dt * sq)) * s + c / dt)) / k;
    const D1 = (1 - e * (zeta / sq * s + c)) / (k * dt);
    for (let i = 0; i + 1 < n; i++) {
      u[i + 1] = A * u[i] + B * v[i] + C * p[i] + D * p[i + 1];
      v[i + 1] = A1 * u[i] + B1 * v[i] + C1 * p[i] + D1 * p[i + 1];
    }
  } else {
    // Newmark (γ = 1/2, β = 1/4), unconditionally stable
    const c = 2 * zeta * wn;
    a[0] = p[0] - c * v[0] - k * u[0];
    const kh = k + 2 * c / dt + 4 / (dt * dt);
    for (let i = 0; i + 1 < n; i++) {
      const ph = p[i + 1] + (4 / (dt * dt)) * u[i] + (4 / dt) * v[i] + a[i] + c * (2 / dt * u[i] + v[i]);
      u[i + 1] = ph / kh;
      v[i + 1] = 2 / dt * (u[i + 1] - u[i]) - v[i];
      a[i + 1] = 4 / (dt * dt) * (u[i + 1] - u[i]) - 4 / dt * v[i] - a[i];
    }
  }
  for (let i = 0; i < n; i++) a[i] = p[i] - 2 * zeta * wn * v[i] - k * u[i];
  return { u, v, a };
}

// Closed-form free vibration of a unit-mass oscillator (any damping)
export function freeResponse(wn, zeta, u0, v0, t) {
  if (wn <= 0) return u0 + v0 * t;
  if (zeta < 1) { const wd = wn * Math.sqrt(1 - zeta * zeta); return Math.exp(-zeta * wn * t) * (u0 * Math.cos(wd * t) + (v0 + zeta * wn * u0) / wd * Math.sin(wd * t)); }
  if (zeta === 1) return Math.exp(-wn * t) * (u0 + (v0 + wn * u0) * t);
  const s = wn * Math.sqrt(zeta * zeta - 1), r1 = -zeta * wn + s, r2 = -zeta * wn - s;
  const c2 = (v0 - r1 * u0) / (r2 - r1), c1 = u0 - c2;
  return c1 * Math.exp(r1 * t) + c2 * Math.exp(r2 * t);
}

// ---------------------------------------------------------------- frequency response
export const magnification = (r, z) => 1 / Math.sqrt((1 - r * r) ** 2 + (2 * z * r) ** 2);
export const phaseLag = (r, z) => Math.atan2(2 * z * r, 1 - r * r);
export const transmissibility = (r, z) => Math.sqrt(1 + (2 * z * r) ** 2) / Math.sqrt((1 - r * r) ** 2 + (2 * z * r) ** 2);

// 2-DOF primary + absorber under harmonic force on the primary mass. Returns complex amplitudes.
// m1, k1, c1 primary; m2, k2, c2 absorber; force F0 at frequency w.
export function absorberFRF(m1, k1, c1, m2, k2, c2, F0, w) {
  // [k1+k2 − ω²m1 + iω(c1+c2), −(k2 + iωc2); −(k2 + iωc2), k2 − ω²m2 + iωc2] x = [F0, 0]
  const a = [k1 + k2 - w * w * m1, w * (c1 + c2)], b = [-k2, -w * c2], d = [k2 - w * w * m2, w * c2];
  const mul = (x, y) => [x[0] * y[0] - x[1] * y[1], x[0] * y[1] + x[1] * y[0]];
  const div = (x, y) => { const q = y[0] * y[0] + y[1] * y[1]; return [(x[0] * y[0] + x[1] * y[1]) / q, (x[1] * y[0] - x[0] * y[1]) / q]; };
  const det = [mul(a, d)[0] - mul(b, b)[0], mul(a, d)[1] - mul(b, b)[1]];
  const x1 = div(mul([F0, 0], d), det), x2 = div(mul([F0, 0], [-b[0], -b[1]]), det);
  return { x1, x2, X1: Math.hypot(...x1), X2: Math.hypot(...x2) };
}
// Den Hartog optimum tuning for a damped absorber on an undamped primary
export function denHartog(mu) { return { f: 1 / (1 + mu), zeta: Math.sqrt(3 * mu / (8 * (1 + mu) ** 3)) }; }

// ---------------------------------------------------------------- input histories
// Each returns {t, f} sampled at dt; amplitude 1 (scaled by the caller) unless stated.
export function makeInput(kind, o, dt, T) {
  const n = Math.max(2, Math.ceil(T / dt) + 1), t = new Float64Array(n), f = new Float64Array(n);
  for (let i = 0; i < n; i++) t[i] = i * dt;
  const td = o.td || 0.01;
  for (let i = 0; i < n; i++) {
    const x = t[i];
    switch (kind) {
      case 'harmonic': f[i] = Math.sin(TAU * o.freq * x); break;
      case 'step': f[i] = x > 0 ? 1 : 0; break;
      case 'rect': f[i] = x > 0 && x <= td ? 1 : 0; break;
      case 'halfsine': f[i] = x <= td ? Math.sin(Math.PI * x / td) : 0; break;
      case 'triangle': f[i] = x <= td / 2 ? 2 * x / td : x <= td ? 2 * (1 - x / td) : 0; break;
      case 'impulse': f[i] = x <= td ? 1 / td : 0; break; // unit impulse spread over td
      case 'sweep': { const f0 = o.f0, f1 = o.f1, Ts = o.Ts || T; const ph = TAU * (f0 * x + (f1 - f0) * x * x / (2 * Ts)); f[i] = x <= Ts ? Math.sin(ph) : 0; break; }
      default: f[i] = 0;
    }
  }
  if (kind === 'quake') return quake(o, dt, T);
  return { t, f };
}
// Synthetic earthquake: Kanai–Tajimi filtered white noise with a Jennings envelope, scaled to unit peak.
function quake(o, dt, T) {
  const n = Math.ceil(T / dt) + 1, t = new Float64Array(n), w = new Float64Array(n);
  let s = (o.seed || 7) >>> 0;
  const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let x = Math.imul(s ^ (s >>> 15), 1 | s); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  for (let i = 0; i < n; i++) { t[i] = i * dt; const u1 = Math.max(1e-12, rnd()), u2 = rnd(); w[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(TAU * u2); }
  const wg = o.wg || 15, zg = o.zg || 0.6;
  const r = sdofResponse(wg, zg, w.map(x => -x), dt);
  const D = o.duration || Math.min(T, 15), t1 = 0.15 * D, t2 = 0.55 * D;
  const f = new Float64Array(n);
  let pk = 0;
  for (let i = 0; i < n; i++) {
    const x = t[i], env = x < t1 ? (x / t1) ** 2 : x < t2 ? 1 : x <= D ? Math.exp(-3 * (x - t2) / (D - t2)) : 0;
    f[i] = -(2 * zg * wg * r.v[i] + wg * wg * r.u[i]) * env;
    pk = Math.max(pk, Math.abs(f[i]));
  }
  for (let i = 0; i < n; i++) f[i] /= pk || 1;
  return { t, f };
}

// Pulse shock spectrum: peak |u|·k/F0 versus td/Tn for a force pulse (classic design chart).
export function shockSpectrum(kind, zeta, { n = 90, rmin = 0.05, rmax = 6 } = {}) {
  const ratio = [], peak = [], resid = [];
  const td = 1;
  for (let i = 0; i < n; i++) {
    const r = rmin * (rmax / rmin) ** (i / (n - 1)), Tn = td / r, wn = TAU / Tn;
    const dt = Math.min(Tn, td) / 60, T = td + 1.2 * Tn;
    const { f } = makeInput(kind, { td }, dt, T);
    const { u } = sdofResponse(wn, zeta, f, dt);
    let pk = 0, pr = 0; const iEnd = Math.round(td / dt);
    for (let k = 0; k < u.length; k++) { const val = Math.abs(u[k]) * wn * wn; if (val > pk) pk = val; if (k > iEnd && val > pr) pr = val; }
    ratio.push(r); peak.push(pk); resid.push(pr);
  }
  return { ratio, peak, resid };
}

// Base-shock response spectrum: peak absolute acceleration of oscillators of natural frequency fn
// on a base with acceleration ag(t) (any units).
export function baseSRS(ag, dt, zeta, fs) {
  return fs.map(fn => {
    const wn = TAU * fn, step = Math.min(dt, 1 / (fn * 40)), sub = Math.max(1, Math.round(dt / step)), h = dt / sub;
    const p = new Float64Array((ag.length - 1) * sub + 1);
    for (let i = 0; i + 1 < ag.length; i++) for (let k = 0; k < sub; k++) p[i * sub + k] = -(ag[i] + (ag[i + 1] - ag[i]) * k / sub);
    p[p.length - 1] = -ag[ag.length - 1];
    // extend with free vibration
    const extra = Math.ceil(1.5 / fn / h), q = new Float64Array(p.length + extra); q.set(p);
    const r = sdofResponse(wn, zeta, q, h);
    let pk = 0;
    for (let i = 0; i < q.length; i++) { const absA = -(2 * zeta * wn * r.v[i] + wn * wn * r.u[i]); pk = Math.max(pk, Math.abs(absA)); }
    return pk;
  });
}

// ---------------------------------------------------------------- modal superposition
// modes: [{omega, phi (M-normalised, full DOF vector)}]. Harmonic force F (DOF vector, amplitude) at ω:
// complex response at DOF `out`.
export function modalFRF(modes, zeta, inDof, outDof, w, F0 = 1) {
  let re = 0, im = 0;
  for (const m of modes) {
    const wr = m.omega, a = wr * wr - w * w, b = 2 * zeta * wr * w, den = a * a + b * b;
    const g = m.phi[outDof] * m.phi[inDof] * F0;
    re += g * a / den; im += -g * b / den;
  }
  return [re, im];
}
// complex modal coordinates for harmonic force at one DOF
export function modalHarmonic(modes, zeta, inDof, w, F0 = 1) {
  return modes.map(m => { const wr = m.omega, a = wr * wr - w * w, b = 2 * zeta * wr * w, den = a * a + b * b, g = m.phi[inDof] * F0; return [g * a / den, -g * b / den]; });
}
// Time history of modal coordinates for p_r(t) = gamma_r · f(t)
export function modalTransient(modes, zeta, gammas, f, dt) {
  return modes.map((m, r) => sdofResponse(m.omega, zeta, f.map(x => x * gammas[r]), dt));
}
