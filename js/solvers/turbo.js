// Mean-line turbomachinery: axial compressor and turbine stages (velocity triangles, loading,
// diffusion limits), centrifugal / mixed-flow compressors (slip, inducer), specific speed, and a
// generic compressor map. Angles measured from the axial (or radial) direction, in radians.
const DEG = Math.PI / 180;

// ---------- axial compressor, repeating stage (α3 = α1) ----------
export function axialCompressor({ U, phi, psi, R, eta = 0.9, T01 = 288.15, p01 = 101325, cp = 1004.5, g = 1.4, sigma = 1.2, nStages = 8, targetPR = 0 }) {
  const tb1 = (R + psi / 2) / phi, tb2 = (R - psi / 2) / phi, ta1 = (1 - R - psi / 2) / phi, ta2 = (1 - R + psi / 2) / phi;
  const b1 = Math.atan(tb1), b2 = Math.atan(tb2), a1 = Math.atan(ta1), a2 = Math.atan(ta2);
  const Cx = phi * U, C1 = Cx / Math.cos(a1), C2 = Cx / Math.cos(a2), W1 = Cx / Math.cos(b1), W2 = Cx / Math.cos(b2);
  const dT0 = psi * U * U / cp;
  const deHaller = W2 / W1, statorRatio = Math.cos(a2) / Math.cos(a1);
  const DFr = 1 - W2 / W1 + psi * U / (2 * sigma * W1);
  const DFs = 1 - C1 / C2 + psi * U / (2 * sigma * C2);
  const T1 = T01 - C1 * C1 / (2 * cp), aa = Math.sqrt(g * (cp * (g - 1) / g) * T1);
  const stages = [];
  let T0 = T01, p0 = p01, k = 0;
  const N = targetPR > 1 ? 60 : nStages;
  while (k < N) {
    const pr = (1 + eta * dT0 / T0) ** (g / (g - 1));
    T0 += dT0; p0 *= pr; k++;
    stages.push({ k, pr, T0, p0, PR: p0 / p01 });
    if (targetPR > 1 && p0 / p01 >= targetPR) break;
  }
  const PR = p0 / p01, etaPoly = (g - 1) / g * Math.log(PR) / Math.log(T0 / T01);
  return {
    angles: { a1, a2, b1, b2, a3: a1 }, Cx, C1, C2, W1, W2, U, Ct1: Cx * ta1, Ct2: Cx * ta2, Wt1: Cx * tb1, Wt2: Cx * tb2,
    dT0, deHaller, statorRatio, DFr, DFs, Mrel1: W1 / aa, M1: C1 / aa, T1, stages, PR, etaPoly, rotorTurn: b1 - b2, statorTurn: a2 - a1,
  };
}

// ---------- axial turbine, repeating stage (α3 = α1) ----------
export function axialTurbine({ U, phi, psi, R, eta = 0.9, T01 = 1600, p01 = 2e6, cp = 1239, g = 1.3, Z = 0.8, nStages = 1 }) {
  const tb3 = (psi / 2 + R) / phi, tb2 = (psi / 2 - R) / phi, ta2 = tb2 + 1 / phi, ta3 = tb3 - 1 / phi;
  const a2 = Math.atan(ta2), a3 = Math.atan(ta3), b2 = Math.atan(tb2), b3 = Math.atan(tb3);
  const Cx = phi * U, C2 = Cx / Math.cos(a2), C3 = Cx / Math.cos(a3), W2 = Cx / Math.cos(b2), W3 = Cx / Math.cos(b3);
  const dT0 = psi * U * U / cp, Rg = cp * (g - 1) / g;
  const T2 = T01 - C2 * C2 / (2 * cp), M2 = C2 / Math.sqrt(g * Rg * T2);
  const T3 = T01 - dT0 - C3 * C3 / (2 * cp), Mrel3 = W3 / Math.sqrt(g * Rg * T3);
  // Zweifel: pitch / axial chord for loading coefficient Z
  const sNoz = Z / (2 * Math.cos(a2) ** 2 * (Math.tan(a3) + ta2));
  const sRot = Z / (2 * Math.cos(b3) ** 2 * (tb2 + tb3));
  const stages = [];
  let T0 = T01, p0 = p01;
  for (let k = 1; k <= nStages; k++) {
    const er = (1 - dT0 / (eta * T0)) ** (-g / (g - 1));
    if (!(er > 0) || !isFinite(er)) break;
    T0 -= dT0; p0 /= er; stages.push({ k, er, T0, p0, ER: p01 / p0 });
  }
  return { angles: { a2, a3, b2, b3, a1: a3 }, Cx, C2, C3, W2, W3, U, Ct2: Cx * ta2, Ct3: Cx * ta3, Wt2: Cx * tb2, Wt3: Cx * tb3, dT0, M2, Mrel3, sNoz, sRot, stages, rotorTurn: b2 + b3, nozzleTurn: a2 + a3, ER: stages.length ? p01 / stages[stages.length - 1].p0 : NaN };
}

// ---------- centrifugal / mixed-flow compressor ----------
export function centrifugal({ rpm = 40000, D2 = 0.3, beta2b = 30 * DEG, Z = 17, slip = 'wiesner', phi2 = 0.3, ppf = 1.04, eta = 0.82, T01 = 288.15, p01 = 101325, cp = 1004.5, g = 1.4, mdot = 2, D1t = 0.18, hubTip = 0.35, cone = 90 * DEG }) {
  const w = rpm * Math.PI / 30, U2 = w * D2 / 2, Rg = cp * (g - 1) / g;
  const Cr2 = phi2 * U2, tb = Math.tan(beta2b);
  const slipV = slip === 'stodola' ? U2 * Math.PI * Math.cos(beta2b) / Z : slip === 'stanitz' ? 0.63 * Math.PI * U2 / Z : U2 * Math.sqrt(Math.cos(beta2b)) / Z ** 0.7;
  const Ct2inf = U2 * (1 - phi2 * tb), Ct2 = Ct2inf - slipV;
  const sigma = Ct2 / Ct2inf, lambda = Ct2 / U2;
  const dh0 = ppf * U2 * Ct2, dT0 = dh0 / cp;
  const PR = (1 + eta * dT0 / T01) ** (g / (g - 1));
  const T02 = T01 + dT0, C2 = Math.hypot(Cr2, Ct2), T2 = T02 - C2 * C2 / (2 * cp), M2 = C2 / Math.sqrt(g * Rg * T2);
  const alpha2 = Math.atan2(Ct2, Cr2), W2 = Math.hypot(Cr2, U2 - Ct2), beta2 = Math.atan2(U2 - Ct2, Cr2);
  // inducer
  const A1 = Math.PI / 4 * D1t * D1t * (1 - hubTip * hubTip), rho01 = p01 / (Rg * T01);
  let C1 = mdot / (rho01 * A1);
  for (let i = 0; i < 60; i++) { const T1 = T01 - C1 * C1 / (2 * cp); if (T1 <= 0) { C1 = NaN; break; } const rho1 = rho01 * (T1 / T01) ** (1 / (g - 1)); C1 = 0.5 * C1 + 0.5 * mdot / (rho1 * A1); }
  const T1 = T01 - C1 * C1 / (2 * cp), a1 = Math.sqrt(g * Rg * T1), U1t = w * D1t / 2, W1t = Math.hypot(C1, U1t);
  const Mrel1t = W1t / a1, beta1t = Math.atan2(U1t, C1);
  const power = mdot * dh0;
  const Q1 = mdot / rho01, dhs = cp * T01 * (PR ** ((g - 1) / g) - 1);
  const Ns = w * Math.sqrt(Q1) / dhs ** 0.75, Ds = D2 * dhs ** 0.25 / Math.sqrt(Q1);
  return { U2, Cr2, Ct2, Ct2inf, slipV, sigma, lambda, dh0, dT0, PR, T02, C2, M2, alpha2, W2, beta2, C1, U1t, W1t, Mrel1t, beta1t, T1, power, Ns, Ds, Mu2: U2 / Math.sqrt(g * Rg * T01), wRatio: W2 / W1t, D1t, D2, cone };
}

// Specific speed of an axial stage group (for the chart)
export function specificSpeed({ rpm, mdot, T01, p01, PR, cp = 1004.5, g = 1.4 }) {
  const Rg = cp * (g - 1) / g, w = rpm * Math.PI / 30, Q = mdot / (p01 / (Rg * T01)), dhs = cp * T01 * (PR ** ((g - 1) / g) - 1);
  return w * Math.sqrt(Q) / dhs ** 0.75;
}
// Approximate peak-efficiency envelopes vs specific speed (after Balje / Rodgers charts)
export const NS_TYPES = [
  { id: 'radial', label: 'Centrifugal', peak: 0.86, at: 0.75, width: 0.55 },
  { id: 'mixed', label: 'Mixed-flow', peak: 0.88, at: 1.6, width: 0.45 },
  { id: 'axial', label: 'Axial (single stage)', peak: 0.91, at: 3.2, width: 0.5 },
];
export const nsEff = (t, Ns) => t.peak * Math.exp(-((Math.log(Ns / t.at)) ** 2) / (2 * t.width ** 2));

// ---------- generic (illustrative) compressor map ----------
export function compressorMap(piD, { kind = 'axial' } = {}) {
  const steep = kind === 'axial' ? 1 : 0.6;
  const ms = n => (kind === 'axial' ? 0.80 : 0.70) * n ** 1.2;
  const mc = n => 1.04 * n ** (kind === 'axial' ? 0.75 : 0.9);
  const ps = n => 1 + (piD - 1) * 1.2 * n ** 2.1;
  const pc = n => 1 + (ps(n) - 1) * (kind === 'axial' ? 0.55 : 0.4);
  const k = Math.log((ps(1) - piD) / (ps(1) - pc(1))) / Math.log((1 - ms(1)) / (mc(1) - ms(1)));
  const line = n => { const pts = []; for (let i = 0; i <= 40; i++) { const t = i / 40, m = ms(n) + t * (mc(n) - ms(n)); pts.push([m, ps(n) - (ps(n) - pc(n)) * t ** k]); } return pts; };
  const speeds = [0.6, 0.7, 0.8, 0.9, 1.0, 1.05].map(n => ({ n, pts: line(n) }));
  const surge = []; for (let n = 0.5; n <= 1.08; n += 0.02) surge.push([ms(n), ps(n)]);
  const opLine = []; for (let m = 0.5; m <= 1.05; m += 0.01) opLine.push([m, 1 + (piD - 1) * m ** (2.2 / steep * steep)]);
  const eff = (m, p) => {
    // efficiency island centred slightly above the operating line near design speed
    let best = 0;
    const n = Math.max(0.4, Math.min(1.1, Math.sqrt((p - 1) / ((piD - 1) * 1.0)) * 0.95 + 0.05));
    const mid = ms(n) + 0.6 * (mc(n) - ms(n)), span = mc(n) - ms(n);
    best = 0.9 - 0.35 * (n - 0.92) ** 2 - 0.18 * ((m - mid) / span) ** 2;
    return best;
  };
  const surgeAt = m => { let lo = 0.3, hi = 1.3; for (let i = 0; i < 50; i++) { const md = (lo + hi) / 2; if (ms(md) < m) lo = md; else hi = md; } return ps((lo + hi) / 2); };
  const SM = surgeAt(1) / piD - 1;
  return { speeds, surge, opLine, eff, SM, design: [1, piD], surgeAt };
}
export { DEG };
