// Orbital mechanics checks: Kepler's equation and the element ↔ state round trip, vis-viva and the period, Hohmann and
// bi-elliptic against textbook values (Curtis, Vallado), the bi-elliptic crossover ratios, plane changes, J2 node
// regression for the ISS and a sun-synchronous orbit, the critical inclination, ground-track repeat for GEO and GPS,
// coverage geometry, and the Earth–Mars Hohmann.
import * as O from '../js/solvers/orbits.js';

export function orbitsTests(log) {
  const near = (name, v, ref, tol, unit = '') => log(name, Math.abs(v - ref) <= tol, `got ${(+v).toPrecision(7)}${unit}, expected ${ref}${unit} (±${tol})`);
  const E = O.BODIES.earth, mu = E.mu, D = Math.PI / 180;

  // --- Kepler's equation ---
  let worst = 0;
  for (const e of [0, 0.1, 0.5, 0.9, 0.99]) for (let k = 0; k < 64; k++) {
    const M = -Math.PI + k / 63 * 2 * Math.PI, Ea = O.eccentricAnomaly(M, e);
    worst = Math.max(worst, Math.abs(O.wrapPi(Ea - e * Math.sin(Ea) - M)));
  }
  log('Kepler: E − e sin E = M for e up to 0.99', worst < 1e-12, `worst residual ${worst.toExponential(2)}`);
  near('Kepler: true ↔ mean anomaly round trip (e = 0.9)', O.trueFromMean(O.meanFromTrue(2.5, 0.9), 0.9), 2.5, 1e-10);
  near('Kepler: E = π/2 when M = π/2 − e (e = 0.5)', O.eccentricAnomaly(Math.PI / 2 - 0.5, 0.5), Math.PI / 2, 1e-12);

  // --- elements ↔ state ---
  const el = { a: 12000e3, e: 0.3, i: 40 * D, raan: 1, argp: 2, nu: 3 };
  const rv = O.coe2rv(el, mu), back = O.rv2coe(rv.r, rv.v, mu);
  let err = 0; for (const k of ['i', 'raan', 'argp', 'nu']) err = Math.max(err, Math.abs(O.wrapPi(back[k] - el[k])));
  log('elements → r, v → elements round trip', Math.abs(back.a / el.a - 1) < 1e-12 && Math.abs(back.e - el.e) < 1e-12 && err < 1e-10, `a ${back.a.toFixed(3)} m, e ${back.e.toFixed(12)}, worst angle error ${err.toExponential(2)} rad`);
  near('|r| from the state equals the conic radius', O.vec.norm(rv.r), O.rAt(el, el.nu), 1e-6, ' m');
  near('|v| from the state equals vis-viva', O.vec.norm(rv.v), O.visViva(mu, O.rAt(el, el.nu), el.a), 1e-8, ' m/s');
  const hv = O.vec.cross(rv.r, rv.v), P = O.props(el, mu);
  near('specific angular momentum √(μp)', O.vec.norm(hv) / P.h, 1, 1e-12);

  // --- one orbit ---
  const iss = O.props({ a: E.R + 400e3, e: 0 }, mu);
  near('400 km circular: speed', iss.vc, 7668.6, 1, ' m/s');
  near('400 km circular: period', iss.T / 60, 92.56, 0.02, ' min');
  near('geostationary period equals the sidereal day', O.props({ a: 42164.17e3, e: 0 }, mu).T, O.SIDEREAL_DAY, 1, ' s');
  const hist = O.timeHistory({ a: 26554e3, e: 0.72, i: 0, raan: 0, argp: 0, nu: 0 }, mu, 2000);
  let dA = []; for (let k = 1; k < hist.length; k++) { const a = hist[k - 1], b = hist[k]; dA.push(0.5 * a.r * b.r * Math.sin(O.wrapPi(b.nu - a.nu))); }
  const spread = (Math.max(...dA) - Math.min(...dA)) / (dA.reduce((s, x) => s + x, 0) / dA.length);
  log('Kepler\'s second law: equal areas in equal times (Molniya)', spread < 1e-3, `spread ${(spread * 100).toFixed(3)}% of the mean sector`);

  // --- Hohmann (Vallado example 6-1: 191.34 km → 35 781.35 km: 2.457 + 1.478 km/s, 5.256 h) ---
  const H = O.hohmann(6569.4811e3, 42159.4855e3, mu);
  near('Hohmann LEO → GEO (Vallado 6-1): first burn', H.dv1, 2457.0, 1, ' m/s');
  near('Hohmann LEO → GEO (Vallado 6-1): second burn', H.dv2, 1478.2, 1, ' m/s');
  near('Hohmann LEO → GEO (Vallado 6-1): time of flight', H.tof / 3600, 5.256, 0.005, ' h');
  near('Hohmann is reversible: r2 → r1 costs the same', O.hohmann(42159.4855e3, 6569.4811e3, mu).dv, H.dv, 1e-6, ' m/s');

  // --- bi-elliptic crossovers (Vallado): never better below R = 11.94, always better above 15.58 ---
  const hoh = R => O.hohmann(1, R, 1).dv;
  log('bi-elliptic (rb → ∞) beats Hohmann above R = 11.94', O.biElliptic(1, 11.8, 1e9, 1).dv > hoh(11.8) && O.biElliptic(1, 12.1, 1e9, 1).dv < hoh(12.1), `R 11.8: ${O.biElliptic(1, 11.8, 1e9, 1).dv.toFixed(5)} vs ${hoh(11.8).toFixed(5)}; R 12.1: ${O.biElliptic(1, 12.1, 1e9, 1).dv.toFixed(5)} vs ${hoh(12.1).toFixed(5)}`);
  log('between 11.94 and 15.58 bi-elliptic needs a far rb', O.biElliptic(1, 14, 14 * 1.2, 1).dv > hoh(14) && O.biElliptic(1, 14, 1e9, 1).dv < hoh(14), `R 14: rb 1.2R ${O.biElliptic(1, 14, 16.8, 1).dv.toFixed(5)}, rb → ∞ ${O.biElliptic(1, 14, 1e9, 1).dv.toFixed(5)}, Hohmann ${hoh(14).toFixed(5)}`);
  log('above 15.58 any rb beyond the target beats Hohmann', O.biElliptic(1, 16, 16 * 1.02, 1).dv < hoh(16), `R 16, rb 1.02R: ${O.biElliptic(1, 16, 16.32, 1).dv.toFixed(6)} vs ${hoh(16).toFixed(6)}`);
  near('Hohmann peak cost at R = 15.58 (0.536 vc1)', hoh(15.5817), 0.5363, 1e-4);

  // --- plane changes ---
  near('pure 60° plane change costs the orbital speed', O.planeChange(7.5, 60 * D), 7.5, 1e-12);
  const hp = O.hohmannPlane(6678e3, 42164e3, 28.5 * D, mu, 'split');
  const he = O.hohmannPlane(6678e3, 42164e3, 28.5 * D, mu, 'end');
  log('GTO from the Cape: plane change at apogee beats doing it in LEO', he.dv < hp.separate, `apogee ${he.dv.toFixed(0)} m/s vs separate ${hp.separate.toFixed(0)} m/s`);
  log('splitting the plane change beats doing it all at apogee', hp.dv <= he.dv + 1e-6 && hp.frac > 0 && hp.frac < 0.2, `split ${hp.dv.toFixed(0)} m/s (${(hp.frac * 100).toFixed(1)}% at perigee) vs ${he.dv.toFixed(0)} m/s`);
  near('LEO → GEO with the Cape\'s 28.5° (≈ 4.24 km/s)', hp.dv, 4240, 40, ' m/s');

  // --- J2 ---
  const issEl = { a: E.R + 418e3, e: 0.0004, i: 51.64 * D };
  near('ISS node regression (≈ −5.0°/day)', O.j2Rates(issEl, E).raanDot / D * 86400, -5.0, 0.15, '°/day');
  near('sun-synchronous inclination at 705 km (Landsat 98.2°)', O.sunSyncInclination(E.R + 705e3, 0) / D, 98.2, 0.1, '°');
  near('sun-synchronous node rate = 360°/year', O.j2Rates({ a: E.R + 705e3, e: 0, i: O.sunSyncInclination(E.R + 705e3, 0) }, E).raanDot / D * O.TROPICAL_YEAR, 360, 0.01, '°/yr');
  near('critical inclination 63.43°', O.CRITICAL_INC / D, 63.435, 0.001, '°');
  near('argument of perigee frozen at the critical inclination', O.j2Rates({ a: 26554e3, e: 0.72, i: O.CRITICAL_INC }, E).argpDot, 0, 1e-15);

  // --- ground tracks ---
  const geo = O.groundTrack({ a: 42164.17e3, e: 0, i: 0, raan: 0, argp: 0, nu: 0 }, E, { duration: O.SIDEREAL_DAY, n: 50, j2: false });
  const drift = Math.max(...geo.map(p => Math.abs(O.wrapPi(p.lon - geo[0].lon))));
  log('geostationary sub-point stays put', drift < 2e-4, `drift ${(drift / D).toFixed(5)}° over a sidereal day`);
  const gps = O.trackShift({ a: 26559.7e3, e: 0, i: 55 * D }, E);
  near('GPS: about 2 revolutions per day', gps.revsPerDay, 2.0, 0.01);
  const issS = O.trackShift(issEl, E);
  near('ISS: track moves ≈ 23.6° west each orbit', issS.shift / D, 23.6, 0.2, '°');
  const tr = O.groundTrack({ ...issEl, raan: 0, argp: 0, nu: 0 }, E, { duration: 6 * 3600, n: 2000 });
  near('ground track never exceeds the inclination in latitude', Math.max(...tr.map(p => Math.abs(p.lat))) / D, 51.64, 0.05, '°');
  near('coverage: ISS horizon half-angle at 0° elevation', O.coverageAngle(418e3, E.R, 0) / D, Math.acos(E.R / (E.R + 418e3)) / D, 1e-9, '°');
  near('coverage: GEO sees ±81.3° to the horizon', O.coverageAngle(35786e3, E.R, 0) / D, 81.3, 0.05, '°');

  // --- interplanetary and budgets ---
  const M = O.interplanetary(E, O.BODIES.mars);
  near('Earth → Mars Hohmann: departure v∞ ≈ 2.94 km/s', M.vinfDep, 2945, 15, ' m/s');
  near('Earth → Mars Hohmann: 259 days', M.tof / 86400, 259, 1.5, ' d');
  near('Earth–Mars synodic period ≈ 780 days', M.synodic / 86400, 780, 3, ' d');
  near('trans-Mars injection from 200 km LEO ≈ 3.6 km/s', O.hyperbolicBurn(M.vinfDep, E.R + 200e3, mu), 3600, 30, ' m/s');
  near('escape from LEO with v∞ = 0 is (√2 − 1)·vc', O.hyperbolicBurn(0, E.R + 200e3, mu) / Math.sqrt(mu / (E.R + 200e3)), Math.SQRT2 - 1, 1e-12);
  near('rocket equation: Δv = Isp·g₀ needs mass ratio e', O.massRatio(300 * O.G0, 300), Math.E, 1e-12);
  const L = O.launchDv(200e3, 28.5 * D, 28.5 * D, 0);
  near('due-east launch from the Cape gains ≈ 408 m/s', L.gain, 408, 3, ' m/s');
  log('a 20° orbit cannot be reached directly from 28.5°', !O.launchDv(200e3, 20 * D, 28.5 * D, 0).reachable, 'sin(azimuth) = cos i / cos φ > 1');
}
