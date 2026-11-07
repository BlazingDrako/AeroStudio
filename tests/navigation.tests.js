// Navigation checks against published geodesy and closed forms: Vincenty's Flinders Peak – Buninyong line (Survey
// Review 1975; Geoscience Australia), the WGS-84 quarter meridian 10 001 965.729 m, the equator, ECEF round trips and
// the local frame's curvature drop, rhumb versus great circle, the wind triangle and its inverse, dead-reckoning
// drift, and VOR / DME / ILS geometry.
import * as N from '../js/solvers/navigation.js';

export function navigationTests(log) {
  const D = Math.PI / 180, dms = (d, m, s, sign = 1) => sign * (d + m / 60 + s / 3600) * D, KT = 0.514444;
  const near = (name, v, ref, tol, unit = '') => log(name, Math.abs(v - ref) <= tol, `got ${(+v).toFixed(6)}${unit}, expected ${(+ref).toFixed(6)}${unit} (±${tol})`);

  // ---- Vincenty's test line ----
  const fp = [dms(37, 57, 3.72030, -1), dms(144, 25, 29.52440)], bu = [dms(37, 39, 10.15610, -1), dms(143, 55, 35.38390)];
  const g = N.inverse(...fp, ...bu);
  near('Vincenty inverse: Flinders Peak → Buninyong 54 972.271 m', g.s, 54972.271, 0.001, ' m');
  near('…forward azimuth 306°52′05.37″', g.az1 / D * 3600, (306 * 3600 + 52 * 60 + 5.37), 0.01, '″');
  near('…reverse azimuth 127°10′25.07″', N.wrap2Pi(g.az2 + Math.PI) / D * 3600, (127 * 3600 + 10 * 60 + 25.07), 0.01, '″');
  const d = N.direct(fp[0], fp[1], g.az1, g.s);
  log('Vincenty direct lands back on Buninyong (within 1 mm)', N.inverse(d.lat, d.lon, ...bu).s < 1e-3, `${(N.inverse(d.lat, d.lon, ...bu).s * 1000).toFixed(4)} mm`);

  // ---- the ellipsoid itself ----
  near('WGS-84 quarter meridian (equator → pole) 10 001 965.729 m', N.meridianArc(Math.PI / 2), 10001965.729, 0.001, ' m');
  near('geodesic along the equator over 90° of longitude = a·π/2', N.inverse(0, 0, 0, Math.PI / 2).s, N.WGS84.a * Math.PI / 2, 0.001, ' m');
  near('rhumb line along a meridian equals the meridian arc', N.rhumb(0, 0, 60 * D, 0).s, N.meridianArc(60 * D), 1e-6, ' m');
  near('…and along the equator equals a·Δλ, course 090°', N.rhumb(0, 0, 0, 30 * D).s, N.WGS84.a * 30 * D, 1e-6, ' m');
  near('pole to pole through the meridian: inverse matches twice the quarter meridian', N.inverse(-Math.PI / 2 + 1e-12, 0, Math.PI / 2 - 1e-12, 0).s, 2 * 10001965.729, 0.01, ' m');

  // ---- frames ----
  const pts = [[0, 0, 0], [51.47 * D, -0.45 * D, 25], [-33.95 * D, 151.18 * D, 6], [89.9 * D, 45 * D, 11000], [-45 * D, -120 * D, -50]];
  let worst = 0;
  for (const [la, lo, hh] of pts) { const e = N.ecefToGeodetic(N.geodeticToEcef(la, lo, hh)); worst = Math.max(worst, Math.abs(e.lat - la) * 6.4e6, Math.abs(N.wrapPi(e.lon - lo)) * 6.4e6 * Math.cos(la), Math.abs(e.h - hh)); }
  log('geodetic → ECEF → geodetic round trip (sub-millimetre)', worst < 1e-3, `worst ${(worst * 1000).toFixed(5)} mm`);
  const e0 = N.geodeticToEcef(0, 0, 0), ep = N.geodeticToEcef(Math.PI / 2, 0, 0);
  log('ECEF of (0°, 0°) is (a, 0, 0); of the North Pole (0, 0, b)', Math.abs(e0[0] - N.WGS84.a) < 1e-6 && Math.abs(ep[2] - N.WGS84.b) < 1e-6 && Math.abs(ep[0]) < 1e-6, '');
  const lat0 = 45 * D, s1 = Math.sin(lat0), M = N.WGS84.a * (1 - N.WGS84.e2) / (1 - N.WGS84.e2 * s1 * s1) ** 1.5, dl = 10000 / M;
  const ned = N.nedOf(lat0, 0, 0, lat0 + dl, 0, 0);
  near('local NED: a point 10 km north on the ellipsoid lies d²/2M below the horizon (7.8 m)', ned[2], 10000 ** 2 / (2 * M), 0.01, ' m');

  // ---- great circle vs rhumb ----
  const jfk = [40.64 * D, -73.78 * D], lhr = [51.47 * D, -0.45 * D];
  const gc = N.inverse(...jfk, ...lhr), rl = N.rhumb(...jfk, ...lhr), sp = N.sphere(...jfk, ...lhr);
  log('New York → London: the rhumb line is longer than the geodesic', rl.s > gc.s * 1.03, `geodesic ${(gc.s / 1852).toFixed(1)} nm, rhumb ${(rl.s / 1852).toFixed(1)} nm (+${((rl.s / gc.s - 1) * 100).toFixed(1)}%)`);
  log('…and a sphere of mean radius gets within 0.5% of the ellipsoid', Math.abs(sp.s / gc.s - 1) < 0.005, `${((sp.s / gc.s - 1) * 100).toFixed(3)}%`);
  const path = N.geodesicPath(...jfk, ...lhr, 200), vmax = Math.max(...path.pts.map(p => p.lat));
  near('vertex latitude from Clairaut (sphere) vs the highest point of the path', N.vertexLat(jfk[0], sp.az1) / D, vmax / D, 0.3, '°');

  // ---- wind triangle ----
  const w = N.windTriangle(120, 0, 90 * D, 20);
  near('wind triangle: 120 kt TAS, course 360°, wind 090°/20 kt → WCA asin(1/6) = 9.594°', w.wca / D, Math.asin(1 / 6) / D, 1e-9, '°');
  near('…groundspeed 120·cos(WCA) = 118.32 kt', w.gs, 120 * Math.cos(Math.asin(1 / 6)), 1e-9, ' kt');
  const back = N.windFrom(120, w.heading, w.gs, 0);
  log('…and the wind recovered from heading, TAS, track and GS', Math.abs(back.speed - 20) < 1e-9 && Math.abs(back.from / D - 90) < 1e-9, `${back.speed.toFixed(6)} kt from ${(back.from / D).toFixed(6)}°`);
  log('a wind stronger than the airspeed across track cannot be corrected for', N.windTriangle(50, 0, 90 * D, 60) === null, '');

  // ---- dead reckoning ----
  const dr = N.deadReckon({ tas: 120 * KT, course: 0, dist: 120 * 1852, fcWind: 0, fcFrom: 0, wind: 10 * KT, from: 90 * D });
  near('unforecast 10 kt crosswind for one hour: 10 nm off track', -dr.cross / 1852, 10, 1e-6, ' nm');
  near('…a drift of atan(10/120) = 4.76°', -dr.drift / D, Math.atan(10 / 120) / D, 1e-6, '°');
  near('1-in-60 rule: 1 nm off after 60 nm is about 1°', N.oneInSixty(1, 60), 1, 1e-12, '°');

  // ---- radio navigation ----
  const n10 = 10 * 1852;
  const a = N.vor(n10, 0, 0), b = N.vor(n10, 0, Math.PI), c = N.vor(n10 * Math.cos(10 * D), n10 * Math.sin(10 * D), 0), e = N.vor(n10 * Math.cos(10 * D), n10 * Math.sin(10 * D), Math.PI);
  log('VOR: due north on radial 360 → FROM with course 360, TO with course 180, needle centred', Math.abs(a.radial) < 1e-12 && a.from && !b.from && Math.abs(a.dots) < 1e-9 && Math.abs(b.dots) < 1e-9, '');
  log('VOR: on radial 010, outbound 360 → fly left full scale; inbound 180 → fly right full scale', Math.abs(c.dots + 5) < 1e-9 && Math.abs(e.dots - 5) < 1e-9, `dots ${c.dots.toFixed(3)} / ${e.dots.toFixed(3)}`);
  near('DME over the station reads the height (6,000 ft = 0.987 nm)', N.dme(0, 0, 6000 * 0.3048).slant / 1852, 6000 * 0.3048 / 1852, 1e-12, ' nm');
  const il = N.ils({ d: 3 * 1852, y: 0, z: Math.tan(3 * D) * (3 * 1852 + 300) });
  log('ILS: on the 3° glide path at 3 nm the needles are centred', Math.abs(il.gs) < 1e-12 && Math.abs(il.loc) < 1e-12, '');
  near('3° glide path: about 318 ft of height per nautical mile', Math.tan(3 * D) * 1852 / 0.3048, 318.5, 0.5, ' ft');
}
