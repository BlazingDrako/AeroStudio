// Navigation: WGS-84 geodesy (geodetic ↔ ECEF ↔ local NED, Vincenty's inverse and direct geodesic, rhumb lines on the
// ellipsoid, spherical comparisons), the wind triangle and dead reckoning with its error growth, and the geometry of
// VOR, DME and ILS. DOM-free. Angles in radians, distances in metres, speeds in m/s unless noted.
// Sources: NIMA TR8350.2 (WGS-84); T. Vincenty, "Direct and inverse solutions of geodesics on the ellipsoid with
// application of nested equations", Survey Review 23 (176), 1975; Bowring (1976) for ECEF → geodetic; ICAO Annex 10
// (VOR, DME, ILS); FAA Pilot's Handbook of Aeronautical Knowledge ch. 16 (wind triangle, dead reckoning).

export const WGS84 = { a: 6378137, f: 1 / 298.257223563 };
WGS84.b = WGS84.a * (1 - WGS84.f);
WGS84.e2 = WGS84.f * (2 - WGS84.f);
export const R_MEAN = (2 * WGS84.a + WGS84.b) / 3;   // mean radius for spherical comparisons (6 371 008.8 m)
export const NM = 1852;
const TAU = 2 * Math.PI;
export const wrapPi = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
export const wrap2Pi = a => { a %= TAU; return a < 0 ? a + TAU : a; };

// ---------- frames ----------
export function geodeticToEcef(lat, lon, h = 0) {
  const { a, e2 } = WGS84, s = Math.sin(lat), N = a / Math.sqrt(1 - e2 * s * s);
  return [(N + h) * Math.cos(lat) * Math.cos(lon), (N + h) * Math.cos(lat) * Math.sin(lon), (N * (1 - e2) + h) * s];
}
// Bowring's method, refined twice (sub-millimetre everywhere outside the Earth's centre)
export function ecefToGeodetic([x, y, z]) {
  const { a, b, e2 } = WGS84, ep2 = (a * a - b * b) / (b * b), p = Math.hypot(x, y), lon = Math.atan2(y, x);
  let lat = Math.atan2(z, p * (1 - e2));
  for (let i = 0; i < 4; i++) {
    const beta = Math.atan2((1 - WGS84.f) * Math.sin(lat), Math.cos(lat));
    lat = Math.atan2(z + ep2 * b * Math.sin(beta) ** 3, p - e2 * a * Math.cos(beta) ** 3);
  }
  const s = Math.sin(lat), N = a / Math.sqrt(1 - e2 * s * s);
  const h = Math.abs(lat) < 1.5 ? p / Math.cos(lat) - N : z / s - N * (1 - e2);
  return { lat, lon, h };
}
// Vector from point 0 to point 1 in point 0's local north–east–down frame
export function nedOf(lat0, lon0, h0, lat1, lon1, h1) {
  const p0 = geodeticToEcef(lat0, lon0, h0), p1 = geodeticToEcef(lat1, lon1, h1), d = p1.map((v, i) => v - p0[i]);
  const sl = Math.sin(lat0), cl = Math.cos(lat0), so = Math.sin(lon0), co = Math.cos(lon0);
  return [-sl * co * d[0] - sl * so * d[1] + cl * d[2], -so * d[0] + co * d[1], -cl * co * d[0] - cl * so * d[1] - sl * d[2]];
}

// ---------- geodesics on the ellipsoid (Vincenty 1975) ----------
// Inverse: distance s and forward azimuths at both ends. Near-antipodal points may not converge; then the
// spherical result is returned with converged: false.
export function inverse(lat1, lon1, lat2, lon2) {
  const { a, b, f } = WGS84, L = wrapPi(lon2 - lon1);
  const U1 = Math.atan((1 - f) * Math.tan(lat1)), U2 = Math.atan((1 - f) * Math.tan(lat2));
  const sU1 = Math.sin(U1), cU1 = Math.cos(U1), sU2 = Math.sin(U2), cU2 = Math.cos(U2);
  let lam = L, it = 0, sinS, cosS, sig, sinA, cos2A, cos2Sm, lamP;
  do {
    const sl = Math.sin(lam), cl = Math.cos(lam);
    sinS = Math.hypot(cU2 * sl, cU1 * sU2 - sU1 * cU2 * cl);
    if (sinS === 0) return { s: 0, az1: 0, az2: 0, iterations: it, converged: true };
    cosS = sU1 * sU2 + cU1 * cU2 * cl; sig = Math.atan2(sinS, cosS);
    sinA = cU1 * cU2 * sl / sinS; cos2A = 1 - sinA * sinA;
    cos2Sm = cos2A ? cosS - 2 * sU1 * sU2 / cos2A : 0;
    const C = f / 16 * cos2A * (4 + f * (4 - 3 * cos2A));
    lamP = lam; lam = L + (1 - C) * f * sinA * (sig + C * sinS * (cos2Sm + C * cosS * (-1 + 2 * cos2Sm * cos2Sm)));
  } while (Math.abs(lam - lamP) > 1e-12 && ++it < 200);
  if (it >= 200) { const g = sphere(lat1, lon1, lat2, lon2); return { ...g, s: g.s * WGS84.a / R_MEAN, iterations: it, converged: false }; }
  const u2 = cos2A * (a * a - b * b) / (b * b);
  const A = 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2))), B = u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  const dS = B * sinS * (cos2Sm + B / 4 * (cosS * (-1 + 2 * cos2Sm * cos2Sm) - B / 6 * cos2Sm * (-3 + 4 * sinS * sinS) * (-3 + 4 * cos2Sm * cos2Sm)));
  const s = b * A * (sig - dS), sl = Math.sin(lam), cl = Math.cos(lam);
  const az1 = Math.atan2(cU2 * sl, cU1 * sU2 - sU1 * cU2 * cl), az2 = Math.atan2(cU1 * sl, -sU1 * cU2 + cU1 * sU2 * cl);
  return { s, az1: wrap2Pi(az1), az2: wrap2Pi(az2), iterations: it + 1, converged: true };
}
// Direct: from a point, an azimuth and a distance to the end point and its azimuth
export function direct(lat1, lon1, az1, s) {
  const { a, b, f } = WGS84, sA1 = Math.sin(az1), cA1 = Math.cos(az1);
  const tU1 = (1 - f) * Math.tan(lat1), cU1 = 1 / Math.sqrt(1 + tU1 * tU1), sU1 = tU1 * cU1;
  const s1 = Math.atan2(tU1, cA1), sinA = cU1 * sA1, cos2A = 1 - sinA * sinA;
  const u2 = cos2A * (a * a - b * b) / (b * b);
  const A = 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2))), B = u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  let sig = s / (b * A), sigP, cos2Sm, sinS, cosS, it = 0;
  do {
    cos2Sm = Math.cos(2 * s1 + sig); sinS = Math.sin(sig); cosS = Math.cos(sig);
    const dS = B * sinS * (cos2Sm + B / 4 * (cosS * (-1 + 2 * cos2Sm * cos2Sm) - B / 6 * cos2Sm * (-3 + 4 * sinS * sinS) * (-3 + 4 * cos2Sm * cos2Sm)));
    sigP = sig; sig = s / (b * A) + dS;
  } while (Math.abs(sig - sigP) > 1e-12 && ++it < 200);
  sinS = Math.sin(sig); cosS = Math.cos(sig); cos2Sm = Math.cos(2 * s1 + sig);
  const tmp = sU1 * sinS - cU1 * cosS * cA1;
  const lat2 = Math.atan2(sU1 * cosS + cU1 * sinS * cA1, (1 - f) * Math.hypot(sinA, tmp));
  const lam = Math.atan2(sinS * sA1, cU1 * cosS - sU1 * sinS * cA1), C = f / 16 * cos2A * (4 + f * (4 - 3 * cos2A));
  const L = lam - (1 - C) * f * sinA * (sig + C * sinS * (cos2Sm + C * cosS * (-1 + 2 * cos2Sm * cos2Sm)));
  return { lat: lat2, lon: wrapPi(lon1 + L), az2: wrap2Pi(Math.atan2(sinA, -tmp)) };
}
// Points along the geodesic (for drawing), with the forward azimuth at each
export function geodesicPath(lat1, lon1, lat2, lon2, n = 120) {
  const g = inverse(lat1, lon1, lat2, lon2), pts = [];
  for (let i = 0; i <= n; i++) {
    const d = g.s * i / n;
    if (i === 0) pts.push({ lat: lat1, lon: lon1, az: g.az1, d });
    else { const p = direct(lat1, lon1, g.az1, d); pts.push({ lat: p.lat, lon: p.lon, az: p.az2, d }); }
  }
  return { ...g, pts };
}
// Great circle on a sphere of radius R: haversine distance and initial/final course
export function sphere(lat1, lon1, lat2, lon2, R = R_MEAN) {
  const dl = lon2 - lon1, h = Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dl / 2) ** 2;
  const sig = 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  const az1 = Math.atan2(Math.sin(dl) * Math.cos(lat2), Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dl));
  const az2 = Math.atan2(Math.sin(dl) * Math.cos(lat1), -Math.cos(lat2) * Math.sin(lat1) + Math.sin(lat2) * Math.cos(lat1) * Math.cos(dl));
  return { s: R * sig, az1: wrap2Pi(az1), az2: wrap2Pi(az2) };
}
// Vertex: the highest latitude a great circle reaches (Clairaut: cos φ · sin α is constant)
export const vertexLat = (lat1, az1) => Math.acos(Math.min(1, Math.abs(Math.cos(lat1) * Math.sin(az1))));

// ---------- rhumb lines (loxodromes) on the ellipsoid ----------
// Meridian arc from the equator (Helmert's series in the third flattening n)
export function meridianArc(lat) {
  const { a, f } = WGS84, n = f / (2 - f), n2 = n * n;
  const A = a / (1 + n) * (1 + n2 / 4 + n2 * n2 / 64);
  return A * (lat - (3 * n / 2 - 27 * n * n2 / 32) * Math.sin(2 * lat) + (21 * n2 / 16 - 55 * n2 * n2 / 32) * Math.sin(4 * lat) - (151 * n * n2 / 96) * Math.sin(6 * lat) + (1097 * n2 * n2 / 512) * Math.sin(8 * lat));
}
// Isometric latitude: the Mercator y coordinate on the ellipsoid
export function isometric(lat) {
  const e = Math.sqrt(WGS84.e2), s = Math.sin(lat);
  return Math.atanh(s) - e * Math.atanh(e * s);
}
export function rhumb(lat1, lon1, lat2, lon2) {
  const dl = wrapPi(lon2 - lon1), dq = isometric(lat2) - isometric(lat1), az = Math.atan2(dl, dq);
  const dm = meridianArc(lat2) - meridianArc(lat1);
  let s;
  if (Math.abs(lat2 - lat1) < 1e-12) { const sl = Math.sin(lat1), N = WGS84.a / Math.sqrt(1 - WGS84.e2 * sl * sl); s = Math.abs(dl) * N * Math.cos(lat1); }
  else s = Math.abs(dm / Math.cos(az));
  return { s, az: wrap2Pi(az) };
}
export function rhumbPath(lat1, lon1, lat2, lon2, n = 120) {
  const r = rhumb(lat1, lon1, lat2, lon2), dl = wrapPi(lon2 - lon1), q1 = isometric(lat1), q2 = isometric(lat2), pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, lat = Math.abs(q2 - q1) < 1e-12 ? lat1 : latFromIsometric(q1 + (q2 - q1) * t);
    pts.push({ lat, lon: wrapPi(lon1 + dl * t), az: r.az, d: r.s * t });
  }
  return { ...r, pts };
}
export function latFromIsometric(q) {
  const e = Math.sqrt(WGS84.e2); let lat = 2 * Math.atan(Math.exp(q)) - Math.PI / 2;
  for (let i = 0; i < 8; i++) lat = 2 * Math.atan(Math.exp(q) * ((1 + e * Math.sin(lat)) / (1 - e * Math.sin(lat))) ** (e / 2)) - Math.PI / 2;
  return lat;
}

// ---------- wind triangle ----------
// course: desired track (true), windFrom: direction the wind blows from, speeds in any one unit.
// Returns the heading to fly, the wind-correction angle and the groundspeed; null if the wind is stronger than the
// airspeed across the track (the track cannot be held).
export function windTriangle(tas, course, windFrom, wind) {
  const rel = windFrom - course, x = wind * Math.sin(rel) / tas;
  if (Math.abs(x) > 1) return null;
  const wca = Math.asin(x), gs = tas * Math.cos(wca) - wind * Math.cos(rel);
  return { heading: wrap2Pi(course + wca), wca, gs, head: wind * Math.cos(rel), cross: wind * Math.sin(rel) };
}
// The other way round: the wind from what the aircraft is doing (heading and TAS) and what the ground sees (track, GS)
export function windFrom(tas, heading, gs, track) {
  const vn = gs * Math.cos(track) - tas * Math.cos(heading), ve = gs * Math.sin(track) - tas * Math.sin(heading);
  return { speed: Math.hypot(vn, ve), from: wrap2Pi(Math.atan2(-ve, -vn)) };
}

// ---------- dead reckoning ----------
// Fly a heading worked out from the forecast wind through the actual wind; return both tracks and the error, plus a
// 1σ error ellipse from random heading (σψ) and speed (σV) errors growing along the way: cross-track σ = d·σψ,
// along-track σ = t·σV (independent, for short legs).
export function deadReckon({ tas, course, dist, fcWind, fcFrom, wind, from, sigPsi = 0, sigV = 0, n = 60 }) {
  const plan = windTriangle(tas, course, fcFrom, fcWind);
  if (!plan) return null;
  const tPlan = dist / plan.gs;
  const vn = tas * Math.cos(plan.heading) - wind * Math.cos(from), ve = tas * Math.sin(plan.heading) - wind * Math.sin(from);
  const track = [], planned = [], ell = [];
  for (let i = 0; i <= n; i++) {
    const t = tPlan * i / n, d = plan.gs * t;
    planned.push([d * Math.cos(course), d * Math.sin(course)]);
    track.push([vn * t, ve * t]);
    ell.push({ t, along: sigV * t, cross: d * sigPsi });
  }
  const end = track[n], pe = planned[n], err = [end[0] - pe[0], end[1] - pe[1]];
  const actTrack = Math.atan2(ve, vn), along = err[0] * Math.cos(course) + err[1] * Math.sin(course), cross = -err[0] * Math.sin(course) + err[1] * Math.cos(course);
  return { plan, tPlan, track, planned, ell, err: Math.hypot(...err), along, cross, actTrack: wrap2Pi(actTrack), actGs: Math.hypot(vn, ve), drift: wrapPi(actTrack - course) };
}
// 1-in-60 rule: 1° of track error puts you about 1 unit off per 60 units flown (sin 1° ≈ 1/57.3)
export const oneInSixty = (offTrack, distance) => offTrack / distance * 60;

// ---------- radio navigation (flat local frame around the station: fine within ~100 nm) ----------
// Aircraft at north/east offsets (m) and height h above the station. VOR radial = bearing from the station.
export function vor(north, east, obs, variation = 0) {
  const radial = wrap2Pi(Math.atan2(east, north) - variation);   // magnetic bearing from the station
  const from = Math.abs(wrapPi(radial - obs)) < Math.PI / 2;      // FROM: the selected course leads away from the station
  // angle off the selected course line, signed so + means "the course is to the right: fly right"
  const fly = from ? -wrapPi(radial - obs) : wrapPi(radial - (obs + Math.PI));
  return { radial, from, fly, dots: Math.max(-5, Math.min(5, fly / (2 * Math.PI / 180))) };   // full scale ±10°, 2° a dot
}
export function dme(north, east, h) { const g = Math.hypot(north, east); return { slant: Math.hypot(g, h), ground: g, error: Math.hypot(g, h) - g }; }
// ILS: runway threshold at the origin, approach from the -x side along +x; aircraft at distance d before the threshold,
// lateral offset y (m, + right of the centreline seen on approach) and height z. Localizer antenna beyond the far end.
export function ils({ d, y, z, gsAngle = 3 * Math.PI / 180, tch = 15, locDist = 3000 + 300, gpiDist = 300 }) {
  const loc = Math.atan2(y, d + locDist);                                  // + : right of centreline
  const gs = Math.atan2(z, d + gpiDist), onGp = Math.tan(gsAngle) * (d + gpiDist);
  return { loc, gs: gs - gsAngle, height: z, onGp, above: z - onGp, locDots: Math.max(-2.5, Math.min(2.5, loc / (1.25 * Math.PI / 180))), gsDots: Math.max(-2.5, Math.min(2.5, (gs - gsAngle) / (0.35 * Math.PI / 180))), tch };
}
