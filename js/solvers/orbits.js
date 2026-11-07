// Orbital mechanics (no DOM): two-body orbits and the six classical elements, Kepler's equation, Hohmann, bi-elliptic
// and plane-change manoeuvres, J2 secular drift, ground tracks and coverage, and Δv budgets with the rocket equation.
// SI units throughout (m, s, rad) unless a name says otherwise.

export const G0 = 9.80665;
export const DAY = 86400, SIDEREAL_DAY = 86164.0905, YEAR = 365.25636 * DAY, TROPICAL_YEAR = 365.24219 * DAY;
const TAU = 2 * Math.PI;

// mu (m³/s²), equatorial radius R (m), J2, rotation rate w (rad/s), heliocentric orbit radius au (m), sphere of influence soi (m)
export const BODIES = {
  earth: { id: 'earth', label: 'Earth', mu: 3.986004418e14, R: 6378137, J2: 1.08262668e-3, w: 7.2921159e-5, a: 1.495978707e11, soi: 9.25e8, color: '#3b82f6' },
  moon: { id: 'moon', label: 'Moon', mu: 4.9048695e12, R: 1737400, J2: 2.0323e-4, w: 2.6617e-6, a: 3.844e8, soi: 6.61e7, color: '#9ca3af' },
  mars: { id: 'mars', label: 'Mars', mu: 4.282837e13, R: 3396200, J2: 1.96045e-3, w: 7.088218e-5, a: 2.2794e11, soi: 5.77e8, color: '#dc6b3a' },
  venus: { id: 'venus', label: 'Venus', mu: 3.24859e14, R: 6051800, J2: 4.458e-6, w: -2.9924e-7, a: 1.0821e11, soi: 6.16e8, color: '#e3b55a' },
  jupiter: { id: 'jupiter', label: 'Jupiter', mu: 1.26686534e17, R: 71492000, J2: 1.4736e-2, w: 1.75852e-4, a: 7.7857e11, soi: 4.82e10, color: '#c99a6b' },
  sun: { id: 'sun', label: 'Sun', mu: 1.32712440018e20, R: 695700000, J2: 2e-7, w: 2.865e-6, a: 0, soi: Infinity, color: '#f5b335' },
};
export const body = id => BODIES[id] || BODIES.earth;

export const wrap2pi = x => ((x % TAU) + TAU) % TAU;
export const wrapPi = x => { const y = wrap2pi(x + Math.PI) - Math.PI; return y; };

// ---------------- the shape of one orbit ----------------
// el: { a, e, i, raan, argp, nu } (a in m, angles in rad); returns the derived quantities
export function props(el, mu) {
  const { a, e } = el, p = a * (1 - e * e), n = Math.sqrt(mu / a ** 3);
  const rp = a * (1 - e), ra = e < 1 ? a * (1 + e) : Infinity;
  return {
    p, n, rp, ra, T: TAU / n, h: Math.sqrt(mu * p), energy: -mu / (2 * a), b: a * Math.sqrt(Math.max(0, 1 - e * e)),
    vp: Math.sqrt(mu * (2 / rp - 1 / a)), va: e < 1 ? Math.sqrt(mu * (2 / ra - 1 / a)) : NaN,
    vesc: Math.sqrt(2 * mu / rp), vc: Math.sqrt(mu / a),
  };
}
export const rAt = (el, nu) => el.a * (1 - el.e * el.e) / (1 + el.e * Math.cos(nu));
export const visViva = (mu, r, a) => Math.sqrt(mu * (2 / r - 1 / a));
export const flightPathAngle = (e, nu) => Math.atan2(e * Math.sin(nu), 1 + e * Math.cos(nu));

// Kepler's equation M = E − e sin E (elliptic), solved by Newton from a safe start
export function eccentricAnomaly(M, e) {
  M = wrapPi(M);
  let E = e < 0.8 ? M : Math.PI * Math.sign(M || 1);
  for (let k = 0; k < 50; k++) {
    const f = E - e * Math.sin(E) - M, d = f / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-14) break;
  }
  return E;
}
export const trueFromE = (E, e) => 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
export const eFromTrue = (nu, e) => 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
export const trueFromMean = (M, e) => trueFromE(eccentricAnomaly(M, e), e);
export const meanFromTrue = (nu, e) => { const E = eFromTrue(nu, e); return E - e * Math.sin(E); };

// rotation from the perifocal frame (P toward periapsis, Q 90° ahead, W normal) into the inertial frame
export function perifocal(i, raan, argp) {
  const cO = Math.cos(raan), sO = Math.sin(raan), ci = Math.cos(i), si = Math.sin(i), cw = Math.cos(argp), sw = Math.sin(argp);
  return {
    P: [cO * cw - sO * sw * ci, sO * cw + cO * sw * ci, sw * si],
    Q: [-cO * sw - sO * cw * ci, -sO * sw + cO * cw * ci, cw * si],
    W: [sO * si, -cO * si, ci],
  };
}

// classical elements → position and velocity (inertial)
export function coe2rv(el, mu) {
  const { a, e, i, raan, argp, nu } = el, p = a * (1 - e * e), r = p / (1 + e * Math.cos(nu)), k = Math.sqrt(mu / p);
  const { P, Q } = perifocal(i, raan, argp);
  const xp = r * Math.cos(nu), yp = r * Math.sin(nu), vx = -k * Math.sin(nu), vy = k * (e + Math.cos(nu));
  return { r: [0, 1, 2].map(j => xp * P[j] + yp * Q[j]), v: [0, 1, 2].map(j => vx * P[j] + vy * Q[j]) };
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => Math.hypot(a[0], a[1], a[2]);
export const vec = { dot, cross, norm };

// position and velocity → classical elements (the usual special cases handled: circular → argp = 0, equatorial → raan = 0)
export function rv2coe(r, v, mu) {
  const R = norm(r), V = norm(v), h = cross(r, v), H = norm(h), n = [-h[1], h[0], 0], N = norm(n);
  const ev = [0, 1, 2].map(j => ((V * V - mu / R) * r[j] - dot(r, v) * v[j]) / mu), e = norm(ev);
  const a = 1 / (2 / R - V * V / mu), i = Math.acos(Math.max(-1, Math.min(1, h[2] / H)));
  const tiny = 1e-10;
  let raan = N > tiny ? Math.atan2(n[1], n[0]) : 0;
  let argp, nu;
  if (e > tiny) {
    argp = N > tiny ? Math.atan2(dot(cross(n, ev), h) / H, dot(n, ev)) : Math.atan2(ev[1], ev[0]) * Math.sign(h[2] || 1);
    nu = Math.atan2(dot(cross(ev, r), h) / H, dot(ev, r));
  } else {
    argp = 0;
    const ref = N > tiny ? n : [1, 0, 0];
    nu = Math.atan2(dot(cross(ref, r), h) / H, dot(ref, r));
  }
  return { a, e, i, raan: wrap2pi(raan), argp: wrap2pi(argp), nu: wrap2pi(nu) };
}

// sample one orbit in the inertial frame: n points evenly spaced in true anomaly (smooth near periapsis)
export function orbitPoints(el, n = 240) {
  const { P, Q } = perifocal(el.i, el.raan, el.argp), p = el.a * (1 - el.e * el.e), out = [];
  for (let k = 0; k <= n; k++) {
    const nu = k / n * TAU, r = p / (1 + el.e * Math.cos(nu)), x = r * Math.cos(nu), y = r * Math.sin(nu);
    out.push([x * P[0] + y * Q[0], x * P[1] + y * Q[1], x * P[2] + y * Q[2], nu]);
  }
  return out;
}

// one orbit sampled evenly in time: true anomaly, radius and speed vs time since periapsis
export function timeHistory(el, mu, n = 200) {
  const { T } = props(el, mu), out = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n * T, nu = trueFromMean(TAU * k / n, el.e), r = rAt(el, nu);
    out.push({ t, nu: wrap2pi(nu), r, v: visViva(mu, r, el.a), fpa: flightPathAngle(el.e, nu) });
  }
  return out;
}

// ---------------- manoeuvres ----------------
// Hohmann between circular coplanar orbits r1 → r2
export function hohmann(r1, r2, mu) {
  const at = (r1 + r2) / 2, v1 = Math.sqrt(mu / r1), v2 = Math.sqrt(mu / r2);
  const vt1 = visViva(mu, r1, at), vt2 = visViva(mu, r2, at);
  const dv1 = Math.abs(vt1 - v1), dv2 = Math.abs(v2 - vt2);
  return { at, et: Math.abs(r2 - r1) / (r1 + r2), v1, v2, vt1, vt2, dv1, dv2, dv: dv1 + dv2, tof: Math.PI * Math.sqrt(at ** 3 / mu) };
}

// bi-elliptic r1 → rb → r2 (rb beyond both): three burns
export function biElliptic(r1, r2, rb, mu) {
  const a1 = (r1 + rb) / 2, a2 = (r2 + rb) / 2, v1 = Math.sqrt(mu / r1), v2 = Math.sqrt(mu / r2);
  const dv1 = Math.abs(visViva(mu, r1, a1) - v1), dv2 = Math.abs(visViva(mu, rb, a2) - visViva(mu, rb, a1)), dv3 = Math.abs(visViva(mu, r2, a2) - v2);
  return { a1, a2, dv1, dv2, dv3, dv: dv1 + dv2 + dv3, tof: Math.PI * (Math.sqrt(a1 ** 3 / mu) + Math.sqrt(a2 ** 3 / mu)) };
}

// a pure plane change at speed v through angle di; and the general burn that turns v1 into v2 through angle d
export const planeChange = (v, di) => 2 * v * Math.sin(Math.abs(di) / 2);
export const turnBurn = (v1, v2, d) => Math.sqrt(Math.max(0, v1 * v1 + v2 * v2 - 2 * v1 * v2 * Math.cos(d)));

// Hohmann with an inclination change di shared between the two burns: frac = share done at the first burn.
// mode: 'end' (all at the final, slower burn), 'start', 'split' (the share that minimises total Δv), or a number 0..1
export function hohmannPlane(r1, r2, di, mu, mode = 'split') {
  const H = hohmann(r1, r2, mu);
  const tot = f => turnBurn(H.v1, H.vt1, f * di) + turnBurn(H.vt2, H.v2, (1 - f) * di);
  let f;
  if (typeof mode === 'number') f = mode;
  else if (mode === 'start') f = 1;
  else if (mode === 'end') f = 0;
  else { // golden-section search on [0, 1]
    let lo = 0, hi = 1; const g = (Math.sqrt(5) - 1) / 2;
    let x1 = hi - g * (hi - lo), x2 = lo + g * (hi - lo), f1 = tot(x1), f2 = tot(x2);
    for (let k = 0; k < 80; k++) { if (f1 < f2) { hi = x2; x2 = x1; f2 = f1; x1 = hi - g * (hi - lo); f1 = tot(x1); } else { lo = x1; x1 = x2; f1 = f2; x2 = lo + g * (hi - lo); f2 = tot(x2); } }
    f = (lo + hi) / 2;
    if (tot(0) <= tot(f)) f = 0;
    if (tot(1) < tot(f)) f = 1;
  }
  const dv1 = turnBurn(H.v1, H.vt1, f * di), dv2 = turnBurn(H.vt2, H.v2, (1 - f) * di);
  // for comparison: the coplanar Hohmann plus a separate plane change made in the initial circular orbit
  const separate = H.dv + planeChange(H.v1, di);
  return { ...H, frac: f, dv1, dv2, dv: dv1 + dv2, coplanar: H.dv, separate };
}

// phasing for a Hohmann rendezvous with a target in the outer (or inner) circle: the angle the target must lead by
// at the first burn, the synodic period between opportunities
export function rendezvous(r1, r2, mu) {
  const H = hohmann(r1, r2, mu), n2 = Math.sqrt(mu / r2 ** 3), n1 = Math.sqrt(mu / r1 ** 3);
  const lead = wrapPi(Math.PI - n2 * H.tof);
  return { lead, synodic: TAU / Math.abs(n1 - n2), tof: H.tof };
}

// ---------------- J2 secular drift ----------------
export function j2Rates(el, B) {
  const { a, e, i } = el, n = Math.sqrt(B.mu / a ** 3), p = a * (1 - e * e), k = 1.5 * n * B.J2 * (B.R / p) ** 2;
  return {
    n, raanDot: -k * Math.cos(i),
    argpDot: k / 2 * (5 * Math.cos(i) ** 2 - 1),
    mDot: n + k / 2 * Math.sqrt(1 - e * e) * (3 * Math.cos(i) ** 2 - 1),
  };
}
// inclination that makes the node precess once per year (sun-synchronous); NaN if out of reach
export function sunSyncInclination(a, e, B = BODIES.earth) {
  const n = Math.sqrt(B.mu / a ** 3), p = a * (1 - e * e), want = TAU / (B.id === 'mars' ? 686.98 * DAY : TROPICAL_YEAR);
  const c = -want / (1.5 * n * B.J2 * (B.R / p) ** 2);
  return Math.abs(c) <= 1 ? Math.acos(c) : NaN;
}
// inclinations where the apsides stand still (5 cos²i = 1): 63.43° and 116.57°
export const CRITICAL_INC = Math.acos(Math.sqrt(1 / 5));

// ---------------- ground tracks ----------------
// propagate with J2 secular rates; t0 = 0 puts the satellite at el.nu with the prime meridian at gst0 (rad)
// returns [{ t, lat, lon, alt, r, x, y, z }]; lon wrapped to (−π, π]
export function groundTrack(el, B, { duration, n = 1000, gst0 = 0, j2 = true } = {}) {
  const rates = j2 ? j2Rates(el, B) : { raanDot: 0, argpDot: 0, mDot: Math.sqrt(B.mu / el.a ** 3) };
  const M0 = meanFromTrue(el.nu, el.e), out = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n * duration;
    const cur = { ...el, raan: el.raan + rates.raanDot * t, argp: el.argp + rates.argpDot * t, nu: trueFromMean(M0 + rates.mDot * t, el.e) };
    const p = subPoint(cur, B, gst0 + B.w * t);
    out.push({ t, ...p });
  }
  return out;
}
export function subPoint(el, B, gst) {
  const { P, Q } = perifocal(el.i, el.raan, el.argp), r = rAt(el, el.nu), x0 = r * Math.cos(el.nu), y0 = r * Math.sin(el.nu);
  const X = x0 * P[0] + y0 * Q[0], Y = x0 * P[1] + y0 * Q[1], Z = x0 * P[2] + y0 * Q[2];
  const c = Math.cos(gst), s = Math.sin(gst), x = c * X + s * Y, y = -s * X + c * Y;
  return { lat: Math.asin(Z / r), lon: wrapPi(Math.atan2(y, x)), r, alt: r - B.R, x: X, y: Y, z: Z };
}
// Earth-central half-angle of the area seen above a minimum elevation angle eps from altitude alt (spherical body)
export function coverageAngle(alt, R, eps = 0) {
  const rho = Math.asin(R / (R + alt));
  const eta = Math.asin(Math.cos(eps) * Math.sin(rho)); // nadir angle to the edge
  return Math.PI / 2 - eps - eta;
}
// westward shift of the track at the equator from one revolution to the next (rad, positive = westward)
export function trackShift(el, B) {
  const r = j2Rates(el, B), Tn = TAU / (r.mDot + r.argpDot); // nodal period
  return { Tn, shift: (B.w - r.raanDot) * Tn, revsPerDay: (TAU / (B.w - r.raanDot)) / Tn };
}

// ---------------- Δv budgets ----------------
export const massRatio = (dv, isp) => Math.exp(dv / (isp * G0));
export const propFraction = (dv, isp) => 1 - 1 / massRatio(dv, isp);
// departure (or capture) burn from a circular parking orbit of radius r onto a hyperbola with excess speed vinf
export const hyperbolicBurn = (vinf, r, mu) => Math.sqrt(vinf * vinf + 2 * mu / r) - Math.sqrt(mu / r);
// a Hohmann between two planets' (circular, coplanar) orbits around the Sun: excess speeds at each end
export function interplanetary(from, to) {
  const S = BODIES.sun, H = hohmann(from.a, to.a, S.mu);
  const dep = Math.abs(H.vt1 - H.v1), arr = Math.abs(H.v2 - H.vt2);
  const n1 = Math.sqrt(S.mu / from.a ** 3), n2 = Math.sqrt(S.mu / to.a ** 3);
  return { vinfDep: dep, vinfArr: arr, tof: H.tof, synodic: TAU / Math.abs(n1 - n2), lead: wrapPi(Math.PI - n2 * H.tof) };
}
// launch from the surface to a circular orbit at altitude h, inclination inc, from latitude lat:
// circular speed plus losses, minus the eastward speed the ground already has along the launch azimuth
export function launchDv(h, inc, lat, losses, B = BODIES.earth) {
  const r = B.R + h, vc = Math.sqrt(B.mu / r), vrot = B.w * B.R * Math.cos(lat);
  const sinAz = Math.abs(Math.cos(lat)) > 1e-9 ? Math.cos(inc) / Math.cos(lat) : 0;
  const reachable = Math.abs(sinAz) <= 1 + 1e-12;
  const az = Math.asin(Math.max(-1, Math.min(1, sinAz)));
  // inertial velocity needed along the azimuth, relative to the rotating ground (vector difference)
  const vn = vc * Math.cos(az), ve = vc * Math.sin(az) - vrot, rel = Math.hypot(vn, ve);
  return { vc, vrot, az, reachable, dv: rel + losses, gain: vc - rel };
}

// presets
const RE = BODIES.earth.R, D = Math.PI / 180;
export const ORBIT_PRESETS = [
  { id: 'iss', short: 'LEO, 51.6°', label: 'ISS', note: 'Low Earth orbit, 51.6°: reachable from Baikonur, so the station passes over most of the populated world.', body: 'earth', a: RE + 418e3, e: 0.0004, i: 51.64 * D, raan: 0, argp: 0, nu: 0 },
  { id: 'hubble', short: 'LEO, 28.5°', label: 'Hubble', note: '540 km, 28.5°: the latitude of Cape Canaveral, so the Shuttle could reach it launching due east.', body: 'earth', a: RE + 540e3, e: 0.0003, i: 28.47 * D, raan: 0, argp: 0, nu: 0 },
  { id: 'sso', short: '98.2°, 705 km', label: 'Sun-synchronous', note: 'Landsat-like: 705 km and 98.2°. J2 turns the orbit plane once a year, so it crosses the equator at the same local time every pass.', body: 'earth', a: RE + 705e3, e: 0.0001, i: 98.2 * D, raan: 0, argp: 0, nu: 0 },
  { id: 'gps', short: 'MEO, 12 h', label: 'GPS', note: 'Medium Earth orbit, half a sidereal day: the track repeats every day.', body: 'earth', a: 26559.7e3, e: 0.01, i: 55 * D, raan: 0, argp: 0, nu: 0 },
  { id: 'molniya', short: '12 h, e 0.72', label: 'Molniya', note: 'Highly elliptical, 12-hour, at the critical inclination 63.4° so J2 does not turn the apogee away from the north.', body: 'earth', a: 26554e3, e: 0.72, i: 63.4 * D, raan: 0, argp: 270 * D, nu: 0 },
  { id: 'tundra', short: '24 h, e 0.27', label: 'Tundra', note: 'Geosynchronous but elliptical and inclined: a figure-eight track that dwells over one hemisphere.', body: 'earth', a: 42164e3, e: 0.27, i: 63.4 * D, raan: 0, argp: 270 * D, nu: 0 },
  { id: 'geo', short: '35 786 km', label: 'Geostationary', note: 'One sidereal day, equatorial and circular: the satellite hangs over one point.', body: 'earth', a: 42164e3, e: 0.0002, i: 0.05 * D, raan: 0, argp: 0, nu: 0 },
  { id: 'gto', short: '200 × 35 786 km', label: 'GTO', note: 'Geostationary transfer orbit from Cape Canaveral: perigee at 200 km, apogee at GEO height.', body: 'earth', a: (2 * RE + 200e3 + 35786e3) / 2, e: (35786e3 - 200e3) / (2 * RE + 200e3 + 35786e3), i: 28.5 * D, raan: 0, argp: 180 * D, nu: 0 },
  { id: 'lro', short: 'polar, 50 km', label: 'LRO (Moon)', note: 'Lunar Reconnaissance Orbiter: a polar orbit 50 km above the Moon. No atmosphere, so very low orbits are possible.', body: 'moon', a: 1737.4e3 + 50e3, e: 0.004, i: 90 * D, raan: 0, argp: 0, nu: 0 },
  { id: 'mro', short: '300 km, 93°', label: 'MRO (Mars)', note: 'Mars Reconnaissance Orbiter: about 300 km, sun-synchronous at Mars (93°).', body: 'mars', a: 3396.2e3 + 300e3, e: 0.008, i: 93 * D, raan: 0, argp: 270 * D, nu: 0 },
];

export function defaults() { return { body: 'earth', a: RE + 418e3, e: 0.0004, i: 51.64 * D, raan: 0, argp: 0, nu: 0 }; }
