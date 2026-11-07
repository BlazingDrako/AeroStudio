// Standard atmosphere, airspeeds, wind and turbulence (no DOM). Everything in SI.
//   atmosphere(z, dT)   US Standard Atmosphere 1976, 0–86 km, with an optional hot/cold-day offset
//   airspeeds(...)      CAS ↔ EAS ↔ TAS ↔ Mach through impact pressure (subsonic and supersonic pitot)
//   windProfile, dryden, drydenSeries, drydenPSD, welch   wind shear and Dryden turbulence (MIL-F-8785C)

export const G0 = 9.80665;          // m/s², standard gravity
export const R_UNIV = 8314.32;      // J/(kmol·K), the value the 1976 standard uses
export const M_AIR = 28.9644;       // kg/kmol, sea-level mean molecular weight
export const R_AIR = R_UNIV / M_AIR; // 287.053 J/(kg·K)
export const GAMMA = 1.4;
export const R_EARTH = 6356766;     // m, effective Earth radius used to convert geometric ↔ geopotential height
export const N_AVOGADRO = 6.022169e26; // 1/kmol
export const SEA = { T: 288.15, p: 101325, rho: 101325 / (R_AIR * 288.15), a: Math.sqrt(GAMMA * R_AIR * 288.15) }; // ρ 1.2250, a 340.294
export const Z_MAX = 86000;         // m, top of the lower atmosphere model (geometric)

// Geopotential base heights (m'), base temperatures (K) and lapse rates (K/m') of the seven layers.
export const LAYERS = [
  { H: 0, T: 288.15, L: -0.0065, name: 'Troposphere' },
  { H: 11000, T: 216.65, L: 0, name: 'Tropopause' },
  { H: 20000, T: 216.65, L: 0.001, name: 'Stratosphere' },
  { H: 32000, T: 228.65, L: 0.0028, name: 'Stratosphere' },
  { H: 47000, T: 270.65, L: 0, name: 'Stratopause' },
  { H: 51000, T: 270.65, L: -0.0028, name: 'Mesosphere' },
  { H: 71000, T: 214.65, L: -0.002, name: 'Mesosphere' },
];
export const H_TOP = 84852;         // m', geopotential height of 86 km
// base pressures, integrated once from sea level
for (let i = 0, p = SEA.p; i < LAYERS.length; i++) {
  LAYERS[i].p = p;
  const top = i + 1 < LAYERS.length ? LAYERS[i + 1].H : H_TOP;
  p = layerP(LAYERS[i], top);
}
function layerP(b, H) {
  const dH = H - b.H;
  return b.L === 0 ? b.p * Math.exp(-G0 * dH / (R_AIR * b.T)) : b.p * ((b.T + b.L * dH) / b.T) ** (-G0 / (b.L * R_AIR));
}

export const geopotential = z => R_EARTH * z / (R_EARTH + z);
export const geometric = H => R_EARTH * H / (R_EARTH - H);
export const gravity = z => G0 * (R_EARTH / (R_EARTH + z)) ** 2;

function layerIndex(H) { let i = 0; while (i + 1 < LAYERS.length && H >= LAYERS[i + 1].H) i++; return i; }
// Standard temperature and pressure at a geopotential height (below sea level the troposphere is extended)
export function stdTP(H) {
  const b = LAYERS[layerIndex(H)];
  return { T: b.T + b.L * (H - b.H), p: layerP(b, H) };
}

export const sutherland = T => 1.458e-6 * T ** 1.5 / (T + 110.4);
export const conductivity = T => 2.64638e-3 * T ** 1.5 / (T + 245.4 * 10 ** (-12 / T));

// Atmosphere at the standard-day geometric altitude z (m) with the temperature raised by dT (K).
// With dT ≠ 0 the pressure is still the standard pressure at z, so z is then the pressure altitude
// (what an altimeter set to 1013.25 hPa reads, converted to geometric); trueAlt is the real height.
export function atmosphere(z, dT = 0) {
  const H = geopotential(z);
  const std = stdTP(H);
  const T = std.T + dT, p = std.p;
  const rho = p / (R_AIR * T);
  const a = Math.sqrt(GAMMA * R_AIR * T);
  const mu = sutherland(T);
  const g = gravity(z);
  const n = N_AVOGADRO * p / (R_UNIV * T);
  const sigmaC = 3.65e-10;                     // m, effective collision diameter
  const lambda = Math.SQRT2 * R_UNIV * T / (2 * Math.PI * N_AVOGADRO * sigmaC ** 2 * p);
  const Vmean = Math.sqrt(8 * R_UNIV * T / (Math.PI * M_AIR));
  const i = layerIndex(H);
  const tAlt = dT === 0 ? z : trueAltitude(H, dT);
  return {
    z, H, T, p, rho, a, mu, nu: mu / rho, k: conductivity(T), g, n, lambda, Vmean, collisionFreq: Vmean / lambda,
    scaleHeight: R_AIR * T / g, theta: T / SEA.T, delta: p / SEA.p, sigma: rho / SEA.rho,
    layer: LAYERS[i].name, layerIndex: i, lapse: LAYERS[i].L, Tstd: std.T,
    pressureAlt: H, densityAlt: densityAltitude(rho), trueAlt: tAlt,
  };
}

// Geopotential height at which the standard atmosphere has pressure p (the pressure altitude)
export function pressureAltitude(p) { return invert(H => stdTP(H).p, p, true); }
// Geopotential height at which the standard atmosphere has density rho (the density altitude)
export function densityAltitude(rho) { return invert(H => { const s = stdTP(H); return s.p / (R_AIR * s.T); }, rho, true); }
function invert(f, target, decreasing) {
  let lo = -5000, hi = H_TOP;
  if (decreasing ? target >= f(lo) : target <= f(lo)) return lo;
  if (decreasing ? target <= f(hi) : target >= f(hi)) return hi;
  for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2; if ((f(m) > target) === decreasing) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
// Real (geometric) height of the pressure level at geopotential H when the air is dT warmer than standard:
// a warm column is taller, so each layer is stretched by T/Tstd (hypsometric equation).
export function trueAltitude(H, dT) {
  const n = 200, h = H / n; let s = 0;
  for (let k = 0; k <= n; k++) { const T = stdTP(k * h).T, w = k === 0 || k === n ? 1 : k % 2 ? 4 : 2; s += w * (T + dT) / T; }
  return geometric(s * h / 3);
}

// Table rows for a list of geometric altitudes
export function table(zs, dT = 0) { return zs.map(z => atmosphere(z, dT)); }

// ---------- airspeeds ----------
const QC_SONIC = (1 + (GAMMA - 1) / 2) ** (GAMMA / (GAMMA - 1)) - 1; // qc/p at M = 1 (0.8929)
// Pitot impact pressure ratio qc/p: isentropic below M = 1, normal shock ahead of the probe above (Rayleigh)
export function qcOverP(M, g = GAMMA) {
  if (M <= 1) return (1 + (g - 1) / 2 * M * M) ** (g / (g - 1)) - 1;
  const M2 = M * M;
  return ((g + 1) ** 2 * M2 / (4 * g * M2 - 2 * (g - 1))) ** (g / (g - 1)) * (1 - g + 2 * g * M2) / (g + 1) - 1;
}
export function machFromQcP(r, g = GAMMA) {
  if (!(r > 0)) return 0;
  if (r <= QC_SONIC) return Math.sqrt(2 / (g - 1) * ((r + 1) ** ((g - 1) / g) - 1));
  let lo = 1, hi = 2; while (qcOverP(hi, g) < r) hi *= 2;
  for (let k = 0; k < 100; k++) { const m = (lo + hi) / 2; if (qcOverP(m, g) < r) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
// Calibrated airspeed: the speed that gives the same impact pressure at sea level (what the ASI is marked in)
export const casFromQc = qc => SEA.a * machFromQcP(qc / SEA.p);
export const qcFromCas = Vc => SEA.p * qcOverP(Vc / SEA.a);

// All airspeeds from one known value. kind: 'cas' | 'eas' | 'tas' | 'mach'; value in m/s (or Mach). atm from atmosphere().
export function airspeeds(kind, value, atm) {
  let M;
  if (kind === 'mach') M = value;
  else if (kind === 'tas') M = value / atm.a;
  else if (kind === 'eas') M = value / Math.sqrt(atm.sigma) / atm.a;
  else M = machFromQcP(qcFromCas(value) / atm.p);
  const tas = M * atm.a, eas = tas * Math.sqrt(atm.sigma);
  const qc = atm.p * qcOverP(M), cas = casFromQc(qc);
  const q = 0.5 * atm.rho * tas * tas;
  const T0 = atm.T * (1 + (GAMMA - 1) / 2 * M * M);
  return { M, tas, eas, cas, q, qc, p0: atm.p + qc, T0, Re1: atm.rho * tas / atm.mu, compressibility: cas - eas };
}

// ---------- wind ----------
// Log-law wind profile (neutral surface layer, as in MIL-F-8785C with W20 the wind at 20 ft = 6.096 m)
export const ROUGHNESS = [
  { id: 'sea', label: 'Open water', z0: 0.0002 },
  { id: 'runway', label: 'Runway / MIL-F-8785C (0.15 ft)', z0: 0.0457 },
  { id: 'grass', label: 'Open grassland', z0: 0.03 },
  { id: 'crops', label: 'Farmland with hedges', z0: 0.1 },
  { id: 'suburb', label: 'Suburbs, scattered trees', z0: 0.5 },
  { id: 'city', label: 'City centre', z0: 1.0 },
];
export function windProfile(h, Wref, z0, href = 6.096) {
  if (h <= z0) return 0;
  return Wref * Math.log(h / z0) / Math.log(href / z0);
}

// ---------- Dryden turbulence (MIL-F-8785C / MIL-HDBK-1797) ----------
// h in m, W20 in m/s (wind at 20 ft: light 15 kt, moderate 30 kt, severe 45 kt).
// Below 1000 ft the scales and intensities follow the low-altitude model; above 2000 ft the scale is
// 1750 ft and the intensities are held at their 1000 ft value (a simplification of the
// probability-of-exceedance tables); in between, linear interpolation.
const FT = 0.3048;
export const SEVERITY = [
  { id: 'light', label: 'Light', W20: 15 * 0.514444 },
  { id: 'moderate', label: 'Moderate', W20: 30 * 0.514444 },
  { id: 'severe', label: 'Severe', W20: 45 * 0.514444 },
];
export function dryden(h, W20) {
  const low = hf => { hf = Math.max(hf, 10); const d = 0.177 + 0.000823 * hf; return { Lu: hf / d ** 1.2 * FT, Lv: hf / d ** 1.2 * FT, Lw: hf * FT, su: 0.1 * W20 / d ** 0.4, sv: 0.1 * W20 / d ** 0.4, sw: 0.1 * W20 }; };
  const high = { Lu: 1750 * FT, Lv: 1750 * FT, Lw: 1750 * FT, su: 0.1 * W20, sv: 0.1 * W20, sw: 0.1 * W20 };
  const hf = h / FT;
  if (hf <= 1000) return { ...low(hf), regime: 'low' };
  if (hf >= 2000) return { ...high, regime: 'high' };
  const a = low(1000), t = (hf - 1000) / 1000, out = { regime: 'transition' };
  for (const k of Object.keys(high)) out[k] = a[k] + (high[k] - a[k]) * t;
  return out;
}
// One-sided temporal PSD (m²/s² per rad/s) for the longitudinal ('u') or lateral/vertical ('v','w') component
export function drydenPSD(comp, w, sigma, L, V) {
  const x = L * w / V;
  if (comp === 'u') return sigma * sigma * (2 * L / (Math.PI * V)) / (1 + x * x);
  return sigma * sigma * (L / (Math.PI * V)) * (1 + 3 * x * x) / (1 + x * x) ** 2;
}

// Seeded normal random numbers so a gust history can be reproduced
export function rng(seed = 1) {
  let s = seed >>> 0 || 1, spare = null;
  const u = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return (s + 0.5) / 4294967296; };
  return () => {
    if (spare !== null) { const v = spare; spare = null; return v; }
    const r = Math.sqrt(-2 * Math.log(u())), t = 2 * Math.PI * u();
    spare = r * Math.sin(t); return r * Math.cos(t);
  };
}
// Gust time histories u, v, w (m/s) sampled every dt for n samples, at airspeed V through frozen turbulence.
// u is a first-order (Gauss–Markov) process; v and w use the Dryden second-order filter (1+√3τs)/(1+τs)²,
// built from two first-order stages so every stage can be stepped exactly.
export function drydenSeries({ h, W20, V, dt, n, seed = 1 }) {
  const P = dryden(h, W20), N = rng(seed);
  const t = new Float64Array(n), out = { t, u: new Float64Array(n), v: new Float64Array(n), w: new Float64Array(n), params: P };
  const first = (sigma, L) => { const tau = L / V, sub = Math.max(1, Math.ceil(dt / (tau / 20))), hs = dt / sub, e = Math.exp(-hs / tau), s = sigma * Math.sqrt(1 - e * e); let x = sigma * N(); return () => { for (let k = 0; k < sub; k++) x = e * x + s * N(); return x; }; };
  const second = (sigma, L) => {
    // x1 = n/(1+τs) with unit-intensity noise (variance 1/2τ), x2 = x1/(1+τs), y = K(√3 x1 + (1−√3) x2), K = σ√τ
    const tau = L / V, sub = Math.max(1, Math.ceil(dt / (tau / 40))), hs = dt / sub, e = Math.exp(-hs / tau);
    const v1 = 1 / (2 * tau), s1 = Math.sqrt(v1 * (1 - e * e)), K = sigma * Math.sqrt(tau), r3 = Math.sqrt(3);
    let x1 = Math.sqrt(v1) * N(), x2 = x1 * 0.7;
    for (let k = 0; k < 400; k++) { const o = x1; x1 = e * x1 + s1 * N(); x2 = e * x2 + (1 - e) * (o + x1) / 2; } // settle
    return () => { for (let k = 0; k < sub; k++) { const o = x1; x1 = e * x1 + s1 * N(); x2 = e * x2 + (1 - e) * (o + x1) / 2; } return K * (r3 * x1 + (1 - r3) * x2); };
  };
  const fu = first(P.su, P.Lu), fv = second(P.sv, P.Lv), fw = second(P.sw, P.Lw);
  for (let i = 0; i < n; i++) { t[i] = i * dt; out.u[i] = fu(); out.v[i] = fv(); out.w[i] = fw(); }
  return out;
}

// ---------- spectra ----------
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k], j = i + k + len / 2;
        const vr = re[j] * cr - im[j] * ci, vi = re[j] * ci + im[j] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[j] = ur - vr; im[j] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
// Welch one-sided PSD in units²/(rad/s); segments of length seg (power of two), Hann window, 50% overlap
export function welch(x, dt, seg = 512) {
  const n = x.length; seg = Math.min(seg, 2 ** Math.floor(Math.log2(n)));
  const win = new Float64Array(seg); let U = 0;
  for (let i = 0; i < seg; i++) { win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (seg - 1)); U += win[i] ** 2; }
  const P = new Float64Array(seg / 2 + 1); let count = 0;
  let mean = 0; for (const v of x) mean += v; mean /= n;
  for (let s = 0; s + seg <= n; s += seg / 2) {
    const re = new Float64Array(seg), im = new Float64Array(seg);
    for (let i = 0; i < seg; i++) re[i] = (x[s + i] - mean) * win[i];
    fft(re, im);
    for (let k = 0; k <= seg / 2; k++) P[k] += re[k] ** 2 + im[k] ** 2;
    count++;
  }
  // two-sided in Hz: |X|²·dt/U; one-sided ×2 (not DC/Nyquist); per rad/s ÷ 2π
  const w = new Float64Array(seg / 2 + 1);
  for (let k = 0; k <= seg / 2; k++) { w[k] = 2 * Math.PI * k / (seg * dt); P[k] = P[k] / count * dt / U * (k === 0 || k === seg / 2 ? 1 : 2) / (2 * Math.PI); }
  return { w, P };
}
export function rms(x) { let m = 0; for (const v of x) m += v; m /= x.length; let s = 0; for (const v of x) s += (v - m) ** 2; return Math.sqrt(s / x.length); }
