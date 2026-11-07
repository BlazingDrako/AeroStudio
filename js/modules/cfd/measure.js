// Signal tools for the sandbox's measurements (no DOM): window statistics, frequency from zero crossings,
// amplitude spectrum, and reference values for a circular cylinder.

export function meanOf(a) { let s = 0; for (const v of a) s += v; return a.length ? s / a.length : NaN; }
export function rmsAbout(a, m = meanOf(a)) { let s = 0; for (const v of a) s += (v - m) ** 2; return a.length ? Math.sqrt(s / a.length) : NaN; }

// Samples with t ≥ tFrom
export function windowFrom(t, v, tFrom) {
  let i = 0; while (i < t.length && t[i] < tFrom) i++;
  return { t: t.slice(i), v: v.slice(i) };
}

// Dominant frequency (cycles per unit t) from upward and downward crossings of the mean.
// Needs at least two full cycles; returns { f, cycles, amp } or null.
export function crossingFreq(t, v) {
  if (t.length < 8) return null;
  const m = meanOf(v), amp = (Math.max(...v) - Math.min(...v)) / 2;
  if (!(amp > 0)) return null;
  // hysteresis: a crossing counts only after the signal has moved 10% of the amplitude away from the mean
  const band = 0.1 * amp, cross = [];
  let side = 0;
  for (let i = 1; i < v.length; i++) {
    const d = v[i] - m;
    const s = d > band ? 1 : d < -band ? -1 : 0;
    if (s && side && s !== side) {
      let k = i; while (k > 0 && (v[k - 1] - m) * s > 0) k--; // last sample on the other side
      const a = v[k - 1] - m, b = v[k] - m;
      cross.push(k > 0 && b !== a ? t[k - 1] + (t[k] - t[k - 1]) * (-a) / (b - a) : t[k]);
    }
    if (s) side = s;
  }
  if (cross.length < 5) return null;
  const f = (cross.length - 1) / 2 / (cross[cross.length - 1] - cross[0]);
  return { f, cycles: (cross.length - 1) / 2, amp };
}

// In-place radix-2 FFT
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
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

// Amplitude spectrum of an unevenly sampled signal: resampled to n points, mean removed, Hann window.
// Returns { f (cycles per unit t), a (amplitude, same units as v), peak } or null.
export function spectrum(t, v, n = 512) {
  if (t.length < 16) return null;
  const t0 = t[0], T = t[t.length - 1] - t0; if (!(T > 0)) return null;
  const re = new Float64Array(n), im = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const ti = t0 + T * i / (n - 1);
    while (j < t.length - 2 && t[j + 1] < ti) j++;
    const u = (ti - t[j]) / ((t[j + 1] - t[j]) || 1);
    re[i] = v[j] + (v[j + 1] - v[j]) * Math.min(1, Math.max(0, u));
  }
  const m = meanOf(re);
  for (let i = 0; i < n; i++) re[i] = (re[i] - m) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)));
  fft(re, im);
  const dt = T / (n - 1), f = [], a = [];
  let kp = 0;
  for (let k = 1; k < n / 2; k++) {
    const amp = 4 * Math.hypot(re[k], im[k]) / n; // ×2 one-sided, ×2 Hann gain
    f.push(k / (n * dt)); a.push(amp);
    if (amp > a[kp]) kp = a.length - 1;
  }
  // refine the peak between bins: parabola through the log amplitudes of the three highest bins
  let df = 0, ap = a[kp];
  if (kp > 0 && kp < a.length - 1) {
    const l = Math.log(a[kp - 1] || 1e-30), c = Math.log(a[kp] || 1e-30), r = Math.log(a[kp + 1] || 1e-30), d = l - 2 * c + r;
    if (d < 0) { df = 0.5 * (l - r) / d; ap = Math.exp(c - 0.25 * (l - r) * df); }
  }
  return { f, a, peak: { f: (kp + 1 + df) / (n * dt), a: ap } };
}

// Circular cylinder in open flow: Williamson's (1988) Strouhal fit for parallel laminar shedding (49 < Re < 178)
// and White's empirical drag fit C_D ≈ 1 + 10/Re^(2/3) (for a long cylinder, 1 < Re < 2×10⁵).
export const cylinderSt = Re => (Re >= 49 && Re <= 178 ? -3.3265 / Re + 0.1816 + 1.6e-4 * Re : NaN);
export const cylinderCd = Re => 1 + 10 / Re ** (2 / 3);
