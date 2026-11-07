// Flight & Atmosphere checks: US Standard Atmosphere 1976 table values (NOAA-S/T 76-1562), airspeed
// identities, density and true altitude, and the Dryden turbulence model (variances and spectra).
import * as A from '../js/solvers/atmosphere.js';
import { isa } from '../js/solvers/cycles.js';
import { isaDensity } from '../js/modules/airfoil/vehicles.js';
import { isaPressure } from '../js/modules/compressible/nozzleTab.js';

export function flightTests(log) {
  const near = (name, v, ref, tol, unit = '') => log(name, Math.abs(v - ref) <= tol, `got ${(+v).toPrecision(6)}${unit}, expected ${ref}${unit} (±${tol})`);
  const rel = (name, v, ref, tol) => log(name, Math.abs(v / ref - 1) <= tol, `got ${(+v).toPrecision(6)}, expected ${ref} (±${(tol * 100).toFixed(2)}%)`);
  const KT = 0.514444, FT = 0.3048;

  // ---- US Standard Atmosphere 1976, geometric altitudes ----
  const TABLE = [ // z m, T K, p Pa, rho kg/m³
    [0, 288.150, 101325, 1.2250], [10000, 223.252, 26500, 0.41351], [20000, 216.650, 5529.3, 0.088910],
    [30000, 226.509, 1197.0, 0.018410], [50000, 270.650, 79.779, 1.0269e-3], [70000, 219.585, 5.2209, 8.2829e-5],
  ];
  for (const [z, T, p, rho] of TABLE) {
    const s = A.atmosphere(z);
    near(`US 1976 T at ${z / 1000} km`, s.T, T, 0.005, ' K');
    rel(`US 1976 p at ${z / 1000} km`, s.p, p, 2e-4);
    rel(`US 1976 ρ at ${z / 1000} km`, s.rho, rho, 3e-4);
  }
  const top = A.atmosphere(86000);
  near('US 1976 at 86 km: molecular-scale T', top.T, 186.946, 0.01, ' K');
  rel('US 1976 at 86 km: p', top.p, 0.37338, 5e-4);
  const sl = A.atmosphere(0);
  near('sea level speed of sound', sl.a, 340.294, 0.001, ' m/s');
  rel('sea level viscosity (Sutherland)', sl.mu, 1.7894e-5, 2e-4);
  rel('sea level kinematic viscosity', sl.nu, 1.4607e-5, 3e-4);
  rel('sea level mean free path', sl.lambda, 6.6328e-8, 1e-3);
  rel('sea level number density', sl.n, 2.5470e25, 1e-3);
  rel('sea level pressure scale height', sl.scaleHeight, 8434.5, 1e-3);
  near('geopotential of 11 km geometric', A.geopotential(11000), 10981.0, 0.5, ' m');
  near('geometric ↔ geopotential round trip', A.geometric(A.geopotential(54321)), 54321, 1e-6, ' m');
  rel('gravity at 86 km', A.gravity(86000), 9.5466, 2e-4);

  // ---- shared model now used by the other modules ----
  near('Jet Engine Cycles ISA uses the shared model', isa(11000).p, A.atmosphere(11000).p, 1e-9, ' Pa');
  near('Vehicle aero density uses the shared model', isaDensity(11000), A.atmosphere(11000).rho, 1e-12);
  near('Nozzle back pressure uses the shared model', isaPressure(30000), A.atmosphere(30000).p, 1e-9, ' Pa');

  // ---- pressure, density and true altitude ----
  for (const H of [0, 5000, 11000, 25000, 60000]) near(`pressure altitude inverts p at ${H} m'`, A.pressureAltitude(A.stdTP(H).p), H, 0.01, ' m');
  const hot = A.atmosphere(0, 20), coldDa = A.atmosphere(0, -20).densityAlt;
  const sd = A.stdTP(hot.densityAlt);
  rel('density altitude reproduces the hot-day density', sd.p / (A.R_AIR * sd.T), hot.rho, 1e-6);
  log('ISA+20 sea level: density altitude ≈ 120 ft per °C rule (±15%)', Math.abs(hot.densityAlt / FT - 2400) < 360, `${(hot.densityAlt / FT).toFixed(0)} ft`);
  log('cold day gives a negative density altitude', coldDa < 0, `${(coldDa / FT).toFixed(0)} ft`);
  // troposphere: ∫(T+dT)/T dH = H + dT·ln(T0/T1)/|L| exactly
  const Hp = 5000 * FT, dT = 15, T1 = 288.15 - 0.0065 * Hp;
  near('true altitude of a warm column (closed form)', A.geopotential(A.trueAltitude(Hp, dT)), Hp + dT * Math.log(288.15 / T1) / 0.0065, 0.01, ' m');

  // ---- airspeeds ----
  near('sea level: M = 1 is 661.47 KCAS', A.airspeeds('mach', 1, sl).cas / KT, 661.47, 0.02, ' kt');
  for (const v of [100, 300, 500]) near(`sea level standard: CAS = EAS = TAS (${v} m/s)`, A.airspeeds('tas', v, sl).cas, v, 1e-6, ' m/s');
  near('pitot behind a normal shock: qc/p at M = 2 (Rayleigh)', A.qcOverP(2), 4.6404, 1e-3);
  log('impact pressure is continuous through M = 1', Math.abs(A.qcOverP(1 - 1e-9) - A.qcOverP(1 + 1e-9)) < 1e-7, `${A.qcOverP(1).toFixed(6)}`);
  const fl350 = A.atmosphere(A.geometric(35000 * FT));
  for (const [k, v] of [['cas', 250 * KT], ['cas', 900 * KT], ['eas', 200 * KT], ['tas', 450 * KT], ['mach', 2.2]]) {
    const r = A.airspeeds(k, v, fl350), back = A.airspeeds('mach', r.M, fl350);
    near(`FL350 round trip from ${k.toUpperCase()} ${k === 'mach' ? v : (v / KT).toFixed(0) + ' kt'}`, back[k === 'mach' ? 'M' : k], v, 1e-6 * Math.max(1, v));
  }
  const r = A.airspeeds('cas', 250 * KT, fl350);
  rel('dynamic pressure q = ½ ρ₀ EAS²', r.q, 0.5 * A.SEA.rho * r.eas ** 2, 1e-9);
  log('compressibility: EAS < CAS at altitude', r.eas < r.cas, `CAS ${(r.cas / KT).toFixed(1)} kt, EAS ${(r.eas / KT).toFixed(1)} kt`);
  near('FL350 ISA: M 0.80 is 461 KTAS', A.airspeeds('mach', 0.8, fl350).tas / KT, 461.0, 0.6, ' kt');

  // ---- wind and turbulence ----
  near('log wind profile returns W20 at 20 ft', A.windProfile(6.096, 10, 0.0457), 10, 1e-9, ' m/s');
  const p1 = A.dryden(1000 * FT, 15 * KT);
  near('Dryden at 1000 ft: Lu = 1000 ft', p1.Lu / FT, 1000, 1e-6, ' ft');
  near('Dryden at 1000 ft: σu = σw = 0.1·W20', p1.su, 0.1 * 15 * KT, 1e-9, ' m/s');
  const p2 = A.dryden(5000 * FT, 15 * KT);
  near('Dryden above 2000 ft: L = 1750 ft', p2.Lw / FT, 1750, 1e-6, ' ft');
  const low = A.dryden(200 * FT, 30 * KT);
  log('Dryden at low altitude: σu > σw and Lu > Lw', low.su > low.sw && low.Lu > low.Lw, `σu ${low.su.toFixed(2)}, σw ${low.sw.toFixed(2)} m/s; Lu ${(low.Lu / FT).toFixed(0)}, Lw ${(low.Lw / FT).toFixed(0)} ft`);
  // PSD integrates to the variance
  for (const c of ['u', 'w']) {
    const s = 2, L = 300, V = 80; let I = 0; const n = 200000, wmax = 2000;
    for (let i = 0; i < n; i++) { const w = (i + 0.5) * wmax / n; I += A.drydenPSD(c, w, s, L, V) * wmax / n; }
    rel(`Dryden ${c} spectrum integrates to σ²`, I, s * s, 2e-3);
  }
  const S = A.drydenSeries({ h: 300 * FT, W20: 30 * KT, V: 60, dt: 0.02, n: 2 ** 17, seed: 7 });
  for (const c of ['u', 'v', 'w']) rel(`simulated ${c} gust RMS matches σ (131k samples)`, A.rms(S[c]), S.params['s' + c], 0.06);
  const W = A.welch(S.w, 0.02, 1024);
  let band = 0, theory = 0;
  for (let k = 1; k < W.w.length; k++) if (W.w[k] > 0.3 && W.w[k] < 10) { band += W.P[k]; theory += A.drydenPSD('w', W.w[k], S.params.sw, S.params.Lw, 60); }
  rel('simulated w spectrum follows Dryden (0.3–10 rad/s band)', band, theory, 0.1);
}
