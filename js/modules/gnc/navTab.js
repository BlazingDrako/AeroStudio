// Navigation tab, three tools. Routes: the geodesic (great circle) and the rhumb line between two airports on the
// WGS-84 ellipsoid, on a globe you can turn and on a Mercator chart, with the course along the way and the local frames.
// Wind & dead reckoning: the wind triangle, then a leg flown on a forecast wind that is wrong, with the drift and the
// growing error ellipse. Radio nav: VOR radial and course deviation, DME slant range, and ILS localizer and glide path.
import { h, section, slider, segmented, select, field, cssVar } from '../../lib/ui.js';
import * as N from '../../solvers/navigation.js';
import { card, metricsGrid, insightsList, onUnits, units, num, canvasBox } from '../flight/common.js';
import { axes, legend } from '../flight/perfShared.js';
import { topView, f3 } from './plots.js';

const D = Math.PI / 180, DEG = 180 / Math.PI, KT = 0.514444, FT = 0.3048;
// Major airports, coordinates rounded to 0.01° (for route geometry only)
const AIRPORTS = [
  ['JFK', 'New York JFK', 40.64, -73.78], ['LHR', 'London Heathrow', 51.47, -0.45], ['LAX', 'Los Angeles', 33.94, -118.41], ['NRT', 'Tokyo Narita', 35.76, 140.39],
  ['SYD', 'Sydney', -33.95, 151.18], ['SIN', 'Singapore Changi', 1.36, 103.99], ['DXB', 'Dubai', 25.25, 55.36], ['JNB', 'Johannesburg', -26.14, 28.25],
  ['GRU', 'São Paulo Guarulhos', -23.43, -46.47], ['SCL', 'Santiago', -33.39, -70.79], ['ANC', 'Anchorage', 61.17, -149.99], ['HNL', 'Honolulu', 21.32, -157.92],
  ['AKL', 'Auckland', -37.01, 174.79], ['CDG', 'Paris CDG', 49.01, 2.55], ['FRA', 'Frankfurt', 50.03, 8.57], ['ORD', 'Chicago O\'Hare', 41.98, -87.90],
  ['PEK', 'Beijing Capital', 40.08, 116.58], ['HKG', 'Hong Kong', 22.31, 113.92], ['DEL', 'Delhi', 28.56, 77.10], ['KEF', 'Reykjavík Keflavík', 63.99, -22.62],
  ['YVR', 'Vancouver', 49.19, -123.18], ['MIA', 'Miami', 25.79, -80.29], ['PTY', 'Panama City', 9.07, -79.38], ['CPT', 'Cape Town', -33.97, 18.60],
];
const ap = c => AIRPORTS.find(a => a[0] === c);
const dist = m => { const v = m / (units() === 'us' ? N.NM : 1000), u = units() === 'us' ? 'nm' : 'km'; return `${Math.abs(v) < 10 ? v.toFixed(Math.abs(v) < 1 ? 2 : 1) : num(v, 0)} ${u}`; };
const distU = () => (units() === 'us' ? N.NM : 1000), distL = () => (units() === 'us' ? 'nm' : 'km');
const spd = v => (units() === 'us' ? `${num(v / KT, 0)} kt` : `${num(v, 0)} m/s`), spdU = () => (units() === 'us' ? KT : 1), spdL = () => (units() === 'us' ? 'kt' : 'm/s');
const brg = a => `${String(Math.round(((a * DEG) % 360 + 360) % 360) || 360).padStart(3, '0')}°`;
const latS = la => `${Math.abs(la * DEG).toFixed(2)}°${la >= 0 ? 'N' : 'S'}`, lonS = lo => `${Math.abs(lo * DEG).toFixed(2)}°${lo >= 0 ? 'E' : 'W'}`;

export function navTab({ keep = o => o } = {}) {
  const S = keep({ tool: 'routes', from: 'JFK', to: 'NRT', tas: 480 * KT, view: null,
    wtas: 120 * KT, course: 360 * D, fcFrom: 270 * D, fcW: 20 * KT, acFrom: 300 * D, acW: 30 * KT, leg: 120 * N.NM, sigPsi: 2 * D, sigV: 5 * KT,
    radial: 30 * D, rdist: 18 * N.NM, alt: 6000 * FT, obs: 210 * D, ilsD: 4 * N.NM, ilsY: 300 * FT, ilsAbove: 100 * FT });
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });
  const toolSec = section('Tool');
  const toolSeg = segmented([{ value: 'routes', label: 'Routes' }, { value: 'wind', label: 'Wind & dead reckoning' }, { value: 'radio', label: 'Radio nav' }], S.tool, v => { S.tool = v; build(); });
  toolSeg.el.classList.add('seg-wrap');
  toolSec.body.append(toolSeg.el);
  const inSec = section('Inputs');
  controls.append(toolSec.el, inSec.el);
  const metrics = metricsGrid(), body = h('div'), insCard = card('What is happening here'), ins = h('div'), eqCard = card('Step by step'), eq = h('div');
  insCard.append(ins); eqCard.append(eq);
  main.append(metrics.el, body, h('div', { class: 'flt-grid2' }, insCard, eqCard));
  let R = null, canvases = [];
  const sl = (label, min, max, step, get, set, opts = {}) => slider({ label, min, max, step, value: get(), format: opts.fmt || (v => num(+v, opts.d ?? 0)), info: opts.info, onInput: v => { set(+v); compute(); } }).el;
  const repaint = () => canvases.forEach(c => c.paint());

  function build() {
    if (S.tool === 'routes') buildRoutes(); else if (S.tool === 'wind') buildWind(); else buildRadio();
    compute();
  }
  function compute() { if (S.tool === 'routes') computeRoutes(); else if (S.tool === 'wind') computeWind(); else computeRadio(); repaint(); }

  // ================= Routes =================
  let globe, merc, crs;
  function buildRoutes() {
    const opts = AIRPORTS.map(a => ({ value: a[0], label: `${a[0]} · ${a[1]}` }));
    inSec.body.replaceChildren(field('From', select(opts, S.from, v => { S.from = v; S.view = null; compute(); })), field('To', select(opts, S.to, v => { S.to = v; S.view = null; compute(); })),
      sl(`Cruise speed (${spdL()})`, Math.round(100 * KT / spdU()), Math.round(1000 * KT / spdU()), 5, () => S.tas / spdU(), v => { S.tas = v * spdU(); }, { info: 'Ground speed in still air, for the flight times.' }),
      h('div', { class: 'hint' }, 'Drag the globe to turn it. Coordinates are rounded to 0.01°.'));
    globe = canvasBox('400px', drawGlobe); merc = canvasBox('400px', drawMerc); crs = canvasBox('260px', drawCourse);
    canvases = [globe, merc, crs];
    let drag = null;
    globe.canvas.style.cursor = 'grab'; globe.canvas.style.touchAction = 'none';
    globe.canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, v: { ...S.view } }; globe.canvas.setPointerCapture(e.pointerId); });
    globe.canvas.addEventListener('pointermove', e => { if (!drag) return; const k = 0.4 * D; S.view = { lat: Math.max(-89 * D, Math.min(89 * D, drag.v.lat + (e.clientY - drag.y) * k)), lon: N.wrapPi(drag.v.lon - (e.clientX - drag.x) * k) }; globe.paint(); });
    globe.canvas.addEventListener('pointerup', () => { drag = null; });
    body.replaceChildren(h('div', { class: 'flt-grid2' },
      card('On the globe', 'Orthographic view. Accent: the geodesic (the shortest path on the ellipsoid, a great circle on a sphere). Amber: the rhumb line, which crosses every meridian at the same angle.', globe.el),
      card('On a Mercator chart', 'Mercator keeps angles true, so a rhumb line is a straight line: easy to fly with a compass, but longer. The great circle bows towards the pole.', merc.el)),
      card('Course along the way', 'The true course along the geodesic changes continuously (it would be flown as a series of shorter legs); the rhumb line keeps one course.', crs.el));
  }
  function computeRoutes() {
    const A = ap(S.from), B = ap(S.to), la1 = A[2] * D, lo1 = A[3] * D, la2 = B[2] * D, lo2 = B[3] * D;
    if (S.from === S.to) { metrics.set([{ k: 'Route', v: 'same airport', s: 'pick two different ones' }]); R = null; return; }
    const g = N.geodesicPath(la1, lo1, la2, lo2, 240), r = N.rhumbPath(la1, lo1, la2, lo2, 240), sp = N.sphere(la1, lo1, la2, lo2);
    const vtx = Math.max(...g.pts.map(p => Math.abs(p.lat))), ned = N.nedOf(la1, lo1, 0, la2, lo2, 0);
    if (!S.view) { const m = g.pts[120]; S.view = { lat: m.lat, lon: m.lon }; }
    R = { A, B, la1, lo1, la2, lo2, g, r, sp, vtx, ned };
    const extra = r.s / g.s - 1;
    metrics.set([
      { k: 'Great-circle distance', v: dist(g.s), s: `${g.converged ? `Vincenty, ${g.iterations} iterations` : 'near-antipodal: spherical estimate'}`, tip: 'Geodesic on the WGS-84 ellipsoid.' },
      { k: 'Initial / final course', v: `${brg(g.az1)} → ${brg(g.az2)}`, s: 'true; it changes all the way' },
      { k: 'Rhumb line', v: dist(r.s), s: `constant course ${brg(r.az)}`, cls: extra > 0.05 ? 'warn' : '' },
      { k: 'Extra on the rhumb line', v: `${f3(extra * 100)}%`, s: `${dist(r.s - g.s)} · ${f3((r.s - g.s) / S.tas / 60)} min at ${spd(S.tas)}` },
      { k: 'Flight time (still air)', v: `${f3(g.s / S.tas / 3600)} h`, s: `at ${spd(S.tas)}` },
      { k: 'Highest latitude', v: latS(Math.sign(g.pts.reduce((a, p) => (Math.abs(p.lat) > Math.abs(a) ? p.lat : a), 0)) * vtx), s: `ends at ${latS(la1)} and ${latS(la2)}` },
      { k: 'Sphere vs ellipsoid', v: `${f3((sp.s / g.s - 1) * 100)}%`, s: `${dist(Math.abs(sp.s - g.s))} on a sphere of mean radius`, tip: 'Haversine on a 6 371 km sphere against Vincenty on the ellipsoid.' },
      { k: 'Destination below the horizon', v: dist(ned[2]), s: 'the "down" of the local frame at departure' },
    ]);
    const L = [];
    if (Math.abs(g.az1 - g.az2) > 20 * D) L.push({ type: 'i', t: `The course swings from ${brg(g.az1)} to ${brg(g.az2)}`, d: 'A great circle crosses each meridian at a different angle (except along the equator or a meridian). Flight-management systems fly it as a chain of short legs and update the course as they go; in the past navigators split it into rhumb-line legs between waypoints read off a gnomonic chart.' });
    L.push({ type: extra > 0.02 ? 'w' : 'g', t: `Rhumb line ${f3(extra * 100)}% longer`, d: `The rhumb line spirals towards the pole at a constant course, so it is simple to steer by compass, but at these latitudes it costs ${dist(r.s - g.s)}. East–west routes far from the equator gain the most from great circles; north–south ones hardly at all.` });
    if (vtx > 60 * D) L.push({ type: 'i', t: `Up to ${latS(vtx)}`, d: 'Great circles between mid-latitude cities bow far poleward: New York–Tokyo passes close to Alaska, Europe–US West Coast crosses Greenland. Polar routes and their navigation (grid navigation, magnetic compasses unreliable near the magnetic pole) follow from this.' });
    L.push({ type: 'i', t: `Ellipsoid vs sphere: ${f3(Math.abs(sp.s / g.s - 1) * 100)}%`, d: 'The Earth is flattened by 1/298: 21 km shorter from pole to centre than at the equator. A sphere is good to a few tenths of a percent for flight planning; navigation systems and GNSS work on WGS-84.' });
    insightsList(ins, L);
    const pE = N.geodeticToEcef(la1, lo1, 0), pB = N.geodeticToEcef(la2, lo2, 0);
    eq.replaceChildren(h('span', { class: 'eq', html: [
      `WGS-84: a = 6 378 137 m, f = 1/298.257223563, b = ${num(N.WGS84.b, 3)} m`,
      `${A[0]}: ${latS(la1)} ${lonS(lo1)} → ECEF (${num(pE[0] / 1000, 1)}, ${num(pE[1] / 1000, 1)}, ${num(pE[2] / 1000, 1)}) km`,
      `${B[0]}: ${latS(la2)} ${lonS(lo2)} → ECEF (${num(pB[0] / 1000, 1)}, ${num(pB[1] / 1000, 1)}, ${num(pB[2] / 1000, 1)}) km`,
      `${B[0]} in ${A[0]}'s north–east–down frame: N ${num(ned[0] / 1000, 0)} km, E ${num(ned[1] / 1000, 0)} km, D ${num(ned[2] / 1000, 0)} km`,
      `Vincenty inverse (reduced latitudes U = atan((1−f) tan φ), iterate λ until it changes by < 10⁻¹²): s = ${num(g.s, 1)} m`,
      `Rhumb: course = atan2(Δλ, Δψ) with isometric latitude ψ = atanh(sin φ) − e·atanh(e·sin φ); s = Δ(meridian arc)/cos(course)`,
    ].join('<br>') }));
  }
  const ortho = (lat, lon, v) => { const cl = Math.cos(lat), x = cl * Math.sin(lon - v.lon), y = Math.cos(v.lat) * Math.sin(lat) - Math.sin(v.lat) * cl * Math.cos(lon - v.lon), z = Math.sin(v.lat) * Math.sin(lat) + Math.cos(v.lat) * cl * Math.cos(lon - v.lon); return [x, y, z]; };
  function drawGlobe(c, W, H) {
    if (!R) return;
    const v = S.view, rad = Math.min(W, H) / 2 - 14, cx = W / 2, cy = H / 2, P = (la, lo) => { const [x, y, z] = ortho(la, lo, v); return [cx + rad * x, cy - rad * y, z]; };
    c.fillStyle = cssVar('--bg-sunk'); c.beginPath(); c.arc(cx, cy, rad, 0, 2 * Math.PI); c.fill(); c.strokeStyle = cssVar('--border-strong'); c.lineWidth = 1.2; c.stroke();
    const line = (pts, col, w, dash) => { c.strokeStyle = col; c.lineWidth = w; c.setLineDash(dash || []); c.beginPath(); let pen = false; for (const [la, lo] of pts) { const [x, y, z] = P(la, lo); if (z < 0) { pen = false; continue; } pen ? c.lineTo(x, y) : c.moveTo(x, y); pen = true; } c.stroke(); c.setLineDash([]); };
    for (let la = -75; la <= 75; la += 15) line(Array.from({ length: 181 }, (_, i) => [la * D, (i * 2 - 180) * D]), la === 0 ? cssVar('--text-3') : cssVar('--border'), la === 0 ? 1.2 : 0.8);
    for (let lo = -180; lo < 180; lo += 15) line(Array.from({ length: 91 }, (_, i) => [(i * 2 - 90) * D, lo * D]), lo === 0 ? cssVar('--text-3') : cssVar('--border'), lo === 0 ? 1.2 : 0.8);
    for (const a of AIRPORTS) { const [x, y, z] = P(a[2] * D, a[3] * D); if (z < 0) continue; c.fillStyle = cssVar('--text-3'); c.fillRect(x - 1.5, y - 1.5, 3, 3); c.font = '9.5px ' + cssVar('--font'); c.fillText(a[0], x + 3, y - 3); }
    line(R.r.pts.map(p => [p.lat, p.lon]), cssVar('--warn'), 2.2, [6, 4]);
    line(R.g.pts.map(p => [p.lat, p.lon]), cssVar('--accent'), 2.6);
    for (const [a, la, lo] of [[R.A, R.la1, R.lo1], [R.B, R.la2, R.lo2]]) { const [x, y, z] = P(la, lo); if (z < 0) continue; c.fillStyle = cssVar('--text'); c.beginPath(); c.arc(x, y, 4.5, 0, 2 * Math.PI); c.fill(); c.font = '600 12px ' + cssVar('--font'); c.fillText(a[0], x + 6, y + 12); }
    legend(c, { pl: 0, pt: 0, iw: W, ih: H }, [[cssVar('--accent'), 'great circle (geodesic)', null, 2.6], [cssVar('--warn'), 'rhumb line', [6, 4], 2.2]], 10, 14);
  }
  function drawMerc(c, W, H) {
    if (!R) return;
    // centre the chart on the route's mean longitude so it does not split across the date line
    const lc = N.wrapPi(R.lo1 + N.wrapPi(R.lo2 - R.lo1) / 2), latMax = 80 * D, qMax = N.isometric(latMax);
    const all = [...R.g.pts, ...R.r.pts], dl = all.map(p => N.wrapPi(p.lon - lc)), qs = all.map(p => N.isometric(Math.max(-latMax, Math.min(latMax, p.lat))));
    let x0 = Math.min(...dl), x1 = Math.max(...dl), y0 = Math.min(...qs), y1 = Math.max(...qs);
    const padX = (x1 - x0) * 0.15 + 5 * D, padY = (y1 - y0) * 0.15 + 0.1; x0 -= padX; x1 += padX; y0 = Math.max(-qMax, y0 - padY); y1 = Math.min(qMax, y1 + padY);
    const pl = 46, pt = 10, pb = 30, iw = W - pl - 10, ih = H - pt - pb, k = Math.min(iw / (x1 - x0), ih / (y1 - y0));
    const ox = pl + (iw - (x1 - x0) * k) / 2, oy = pt + (ih - (y1 - y0) * k) / 2;
    const X = l => ox + (N.wrapPi(l - lc) - x0) * k, Y = q => oy + (y1 - q) * k;
    c.fillStyle = cssVar('--bg-sunk'); c.fillRect(ox, oy, (x1 - x0) * k, (y1 - y0) * k);
    c.save(); c.beginPath(); c.rect(ox, oy, (x1 - x0) * k, (y1 - y0) * k); c.clip();
    c.strokeStyle = cssVar('--border'); c.lineWidth = 0.8; c.fillStyle = cssVar('--text-3'); c.font = '9.5px ' + cssVar('--mono');
    for (let la = -75; la <= 75; la += 15) { const y = Y(N.isometric(la * D)); c.beginPath(); c.moveTo(ox, y); c.lineTo(W, y); c.stroke(); c.fillText(`${Math.abs(la)}°${la >= 0 ? 'N' : 'S'}`, ox + 3, y - 2); }
    for (let lo = -180; lo < 180; lo += 15) { const x = X(lo * D); c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
    const path = (pts, col, w, dash) => { c.strokeStyle = col; c.lineWidth = w; c.setLineDash(dash || []); c.beginPath(); pts.forEach((p, i) => { const x = X(p.lon), y = Y(N.isometric(Math.max(-latMax, Math.min(latMax, p.lat)))); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke(); c.setLineDash([]); };
    path(R.r.pts, cssVar('--warn'), 2.2, [6, 4]); path(R.g.pts, cssVar('--accent'), 2.6);
    for (const a of AIRPORTS) { const x = X(a[3] * D), y = Y(N.isometric(a[2] * D)); c.fillStyle = cssVar('--text-3'); c.fillRect(x - 1.5, y - 1.5, 3, 3); c.fillText(a[0], x + 3, y - 3); }
    for (const [a, la, lo] of [[R.A, R.la1, R.lo1], [R.B, R.la2, R.lo2]]) { const x = X(lo), y = Y(N.isometric(la)); c.fillStyle = cssVar('--text'); c.beginPath(); c.arc(x, y, 4.5, 0, 2 * Math.PI); c.fill(); c.font = '600 12px ' + cssVar('--font'); c.fillText(a[0], x + 6, y + 12); }
    c.restore();
    c.fillStyle = cssVar('--text-3'); c.font = '10.5px ' + cssVar('--font'); c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText(`centred on ${lonS(lc)}`, ox + 4, oy + (y1 - y0) * k + 6);
  }
  function drawCourse(c, W, H) {
    if (!R) return;
    const u = distU(), gp = R.g.pts.map(p => [p.d / u, ((p.az * DEG) % 360 + 360) % 360]), rp = [[0, R.r.az * DEG], [R.r.s / u, R.r.az * DEG]];
    const ys = [...gp.map(p => p[1]), R.r.az * DEG], lo = Math.min(...ys), hi = Math.max(...ys), pd = Math.max(5, (hi - lo) * 0.1);
    const tr = axes(c, W, H, { x0: 0, x1: Math.max(R.g.s, R.r.s) / u, y0: lo - pd, y1: hi + pd, xlabel: `Distance flown (${distL()})`, ylabel: 'True course (°)', xfmt: v => num(v, 0), yfmt: v => num(v, 0) });
    tr.clip(); tr.line(rp, cssVar('--warn'), 2.2, [6, 4]); tr.line(gp, cssVar('--accent'), 2.6); c.restore();
    legend(c, tr, [[cssVar('--accent'), 'great circle', null, 2.6], [cssVar('--warn'), 'rhumb line', [6, 4], 2.2]], tr.pl + tr.iw - 130);
  }

  // ================= Wind & dead reckoning =================
  let tri, drc;
  function buildWind() {
    const vs = (label, key, min, max, step) => sl(`${label} (${spdL()})`, Math.round(min / spdU()), Math.round(max / spdU()), step, () => S[key] / spdU(), v => { S[key] = v * spdU(); });
    const ds = (label, key, info) => sl(label, 0, 360, 5, () => ((S[key] * DEG) % 360 + 360) % 360, v => { S[key] = v * D; }, { info });
    inSec.body.replaceChildren(vs('True airspeed', 'wtas', 40 * KT, 600 * KT, 1), ds('Desired true course (°)', 'course'),
      h('h4', { style: { margin: '10px 0 2px', fontSize: '12px', color: 'var(--text-2)' } }, 'Forecast wind (what you plan with)'), ds('Wind from (°)', 'fcFrom', 'Winds are given as the direction they blow FROM.'), vs('Wind speed', 'fcW', 0, 150 * KT, 1),
      h('h4', { style: { margin: '10px 0 2px', fontSize: '12px', color: 'var(--text-2)' } }, 'Actual wind (what you fly in)'), ds('Wind from (°)', 'acFrom'), vs('Wind speed', 'acW', 0, 150 * KT, 1),
      sl(`Leg length (${distL()})`, 10, 1000, 5, () => S.leg / distU(), v => { S.leg = v * distU(); }),
      sl('Heading error, 1σ (°)', 0, 10, 0.5, () => S.sigPsi * DEG, v => { S.sigPsi = v * D; }, { d: 1, info: 'Random compass and steering error: grows the cross-track uncertainty in proportion to distance.' }),
      vs('Speed error, 1σ', 'sigV', 0, 30 * KT, 1));
    tri = canvasBox('380px', drawTri); drc = canvasBox('380px', drawDR); canvases = [tri, drc];
    body.replaceChildren(h('div', { class: 'flt-grid2' },
      card('The wind triangle', 'Air vector (heading, true airspeed) plus wind vector equals ground vector (track, groundspeed). To hold the course the nose points into the wind by the wind-correction angle.', tri.el),
      card('Dead reckoning on a wrong forecast', 'Dashed: the planned track. Solid: where the aircraft actually goes, flying the heading worked out from the forecast. Ellipses: 1σ position uncertainty from random heading and speed errors.', drc.el)));
  }
  function computeWind() {
    const w = N.windTriangle(S.wtas, S.course, S.fcFrom, S.fcW);
    const dr = N.deadReckon({ tas: S.wtas, course: S.course, dist: S.leg, fcWind: S.fcW, fcFrom: S.fcFrom, wind: S.acW, from: S.acFrom, sigPsi: S.sigPsi, sigV: S.sigV });
    R = { w, dr };
    if (!w || !dr) { metrics.set([{ k: 'Wind triangle', v: 'no solution', s: 'the crosswind is stronger than the airspeed', cls: 'bad' }]); insightsList(ins, [{ type: 'b', t: 'The course cannot be held', d: 'The wind component across the track exceeds the true airspeed: no heading keeps the aircraft on it.' }]); eq.replaceChildren(); return; }
    const end = dr.ell[dr.ell.length - 1];
    metrics.set([
      { k: 'Heading to fly', v: brg(w.heading), s: `wind correction ${w.wca >= 0 ? 'right' : 'left'} ${f3(Math.abs(w.wca) * DEG)}°` },
      { k: 'Groundspeed', v: spd(w.gs), s: `${w.head >= 0 ? 'headwind' : 'tailwind'} ${spd(Math.abs(w.head))} · crosswind ${spd(Math.abs(w.cross))}` },
      { k: 'Time on the leg', v: `${f3(dr.tPlan / 60)} min`, s: `${f3(S.leg / S.wtas / 60)} min in still air` },
      { k: 'Actual track', v: brg(dr.actTrack), s: `drift ${dr.drift >= 0 ? 'right' : 'left'} ${f3(Math.abs(dr.drift) * DEG)}° off course` },
      { k: 'Error at the end', v: dist(dr.err), s: `${dist(Math.abs(dr.cross))} ${dr.cross >= 0 ? 'right' : 'left'}, ${dist(Math.abs(dr.along))} ${dr.along >= 0 ? 'beyond' : 'short'}`, cls: dr.err > 0.05 * S.leg ? 'warn' : '' },
      { k: 'Uncertainty at the end (1σ)', v: `±${dist(end.cross)} across`, s: `±${dist(end.along)} along the track` },
    ]);
    const L = [];
    const back = N.windTriangle(S.wtas, S.course + Math.PI, S.fcFrom, S.fcW), round = back ? S.leg / w.gs + S.leg / back.gs : NaN, still = 2 * S.leg / S.wtas;
    if (isFinite(round) && S.fcW > 0) L.push({ type: 'i', t: `A round trip takes ${f3((round / still - 1) * 100)}% longer than in still air`, d: 'The headwind leg costs more time than the tailwind leg saves, because you spend longer in the headwind. Crosswind costs too: only TAS·cos(WCA) of the airspeed is along the track.' });
    if (dr.err > 1) L.push({ type: 'w', t: `The forecast was off: ${dist(dr.err)} from the destination`, d: `The difference between forecast and actual wind (${spd(Math.hypot(S.acW * Math.cos(S.acFrom) - S.fcW * Math.cos(S.fcFrom), S.acW * Math.sin(S.acFrom) - S.fcW * Math.sin(S.fcFrom)))}) blows the aircraft off for the whole leg: error = wind error × time. The 1-in-60 rule turns the off-track distance into a correction: ${dist(Math.abs(dr.cross))} off after ${dist(S.leg)} is about ${f3(N.oneInSixty(Math.abs(dr.cross), S.leg))}° of track error.` });
    L.push({ type: 'i', t: 'Why dead reckoning is not enough', d: 'Every error (wind, heading, speed) grows with time and is never corrected without a position fix. That is what radio aids, inertial systems and GNSS add: see the Radio nav tool and the INS & GNSS tab.' });
    insightsList(ins, L);
    eq.replaceChildren(h('span', { class: 'eq', html: [
      `Wind angle to the course: ${f3(N.wrapPi(S.fcFrom - S.course) * DEG)}°;  crosswind = W·sin = ${spd(Math.abs(w.cross))}, headwind = W·cos = ${spd(w.head)}`,
      `WCA = asin(crosswind / TAS) = ${f3(w.wca * DEG)}°;  heading = course + WCA = ${brg(w.heading)}`,
      `GS = TAS·cos(WCA) − headwind = ${spd(w.gs)}`,
      `Actual ground vector = air vector + actual wind → track ${brg(dr.actTrack)}, GS ${spd(dr.actGs)}`,
      `1σ after the leg: cross = d·σψ = ${dist(end.cross)}, along = t·σV = ${dist(end.along)}`,
    ].join('<br>') }));
  }
  function drawTri(c, W, H) {
    if (!R || !R.w) return;
    const { w } = R, tas = S.wtas, ah = [tas * Math.cos(w.heading), tas * Math.sin(w.heading)], wv = [-S.fcW * Math.cos(S.fcFrom), -S.fcW * Math.sin(S.fcFrom)], gv = [ah[0] + wv[0], ah[1] + wv[1]];
    const pts = [[0, 0], ah, gv], ext = Math.max(...pts.flat().map(Math.abs)) * 1.25, sc = Math.min(W, H) / 2 / ext;
    const ox = W / 2 - (Math.min(...pts.map(p => p[1])) + Math.max(...pts.map(p => p[1]))) / 2 * sc, oy = H / 2 + (Math.min(...pts.map(p => p[0])) + Math.max(...pts.map(p => p[0]))) / 2 * sc;
    const X = p => ox + p[1] * sc, Y = p => oy - p[0] * sc;
    // labels sit beside each arrow, pushed away from the triangle's centre so they never overlap
    const gx = (X([0, 0]) + X(ah) + X(gv)) / 3, gy = (Y([0, 0]) + Y(ah) + Y(gv)) / 3;
    const arrow = (a, b, col, lab, w0 = 2.6) => {
      c.strokeStyle = col; c.fillStyle = col; c.lineWidth = w0; c.beginPath(); c.moveTo(X(a), Y(a)); c.lineTo(X(b), Y(b)); c.stroke();
      const an = Math.atan2(Y(b) - Y(a), X(b) - X(a)); c.beginPath(); c.moveTo(X(b), Y(b)); c.lineTo(X(b) - 11 * Math.cos(an - 0.35), Y(b) - 11 * Math.sin(an - 0.35)); c.lineTo(X(b) - 11 * Math.cos(an + 0.35), Y(b) - 11 * Math.sin(an + 0.35)); c.fill();
      const mx = (X(a) + X(b)) / 2, my = (Y(a) + Y(b)) / 2; let nx = -Math.sin(an), ny = Math.cos(an);
      if (nx * (mx - gx) + ny * (my - gy) < 0) { nx = -nx; ny = -ny; }
      c.font = '600 11.5px ' + cssVar('--font'); c.textAlign = nx > 0.3 ? 'left' : nx < -0.3 ? 'right' : 'center'; c.textBaseline = ny > 0.3 ? 'top' : ny < -0.3 ? 'bottom' : 'middle';
      c.fillText(lab, mx + 12 * nx, my + 12 * ny);
    };
    // course line
    c.strokeStyle = cssVar('--border-strong'); c.setLineDash([4, 4]); c.lineWidth = 1; c.beginPath(); c.moveTo(X([0, 0]), Y([0, 0])); c.lineTo(X([ext * 2 * Math.cos(S.course), ext * 2 * Math.sin(S.course)]), Y([ext * 2 * Math.cos(S.course), ext * 2 * Math.sin(S.course)])); c.stroke(); c.setLineDash([]);
    arrow([0, 0], ah, cssVar('--accent'), `air ${brg(w.heading)} / ${spd(tas)}`);
    arrow(ah, gv, cssVar('--lower'), `wind ${spd(S.fcW)}`);
    arrow([0, 0], gv, cssVar('--good'), `ground ${brg(S.course)} / ${spd(w.gs)}`, 3);
    c.save(); c.translate(X([0, 0]), Y([0, 0])); c.rotate(w.heading - Math.PI / 2); c.scale(1.3, 1.3); topView(c, cssVar('--text')); c.restore();
    c.fillStyle = cssVar('--text-2'); c.font = '600 11px ' + cssVar('--font'); c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText('N ↑', 8, 8); c.fillText(`wind correction ${w.wca >= 0 ? 'right' : 'left'} ${f3(Math.abs(w.wca) * DEG)}°`, 8, 24);
  }
  function drawDR(c, W, H) {
    if (!R || !R.dr) return;
    const { dr } = R, u = distU(), all = [...dr.track, ...dr.planned].map(([n, e]) => [e / u, n / u]);
    const ex = Math.max(...dr.ell.map(q => Math.max(q.along, q.cross))) / u;
    const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
    let x0 = Math.min(...xs) - ex, x1 = Math.max(...xs) + ex, y0 = Math.min(...ys) - ex, y1 = Math.max(...ys) + ex;
    const span = Math.max(x1 - x0, y1 - y0) * 1.1, mx = (x0 + x1) / 2, my = (y0 + y1) / 2, pl = 50, pb = 36, iw = W - pl - 14, ih = H - 12 - pb;
    const ax = iw / ih >= 1 ? [span * iw / ih, span] : [span, span * ih / iw];
    const tr = axes(c, W, H, { pl, pb, x0: mx - ax[0] / 2, x1: mx + ax[0] / 2, y0: my - ax[1] / 2, y1: my + ax[1] / 2, xlabel: `East (${distL()})`, ylabel: `North (${distL()})`, xfmt: v => num(v, 0), yfmt: v => num(v, 0) });
    tr.clip();
    c.strokeStyle = cssVar('--accent'); c.globalAlpha = 0.25; c.lineWidth = 1;
    dr.ell.forEach((q, i) => { if (i % 10 || !i) return; const [n, e] = dr.planned[i]; c.save(); c.translate(tr.sx(e / u), tr.sy(n / u)); c.rotate(S.course); c.scale(Math.max(0.5, q.cross / u * (tr.sx(1) - tr.sx(0))), Math.max(0.5, q.along / u * (tr.sx(1) - tr.sx(0)))); c.beginPath(); c.arc(0, 0, 1, 0, 2 * Math.PI); c.restore(); c.stroke(); });
    c.globalAlpha = 1;
    tr.line(dr.planned.map(([n, e]) => [e / u, n / u]), cssVar('--text-3'), 1.8, [6, 4]);
    tr.line(dr.track.map(([n, e]) => [e / u, n / u]), cssVar('--lower'), 2.6);
    const pe = dr.planned[dr.planned.length - 1], te = dr.track[dr.track.length - 1];
    tr.dot(pe[1] / u, pe[0] / u, cssVar('--good'), 6); tr.text(pe[1] / u, pe[0] / u, '  destination', cssVar('--text'), 'left', 'middle', '600 11px');
    tr.dot(te[1] / u, te[0] / u, cssVar('--lower'), 5); tr.dot(0, 0, cssVar('--text-2'), 4);
    c.restore();
    legend(c, tr, [[cssVar('--text-3'), 'planned track', [6, 4], 1.8], [cssVar('--lower'), 'actual track', null, 2.6], [cssVar('--accent'), '1σ uncertainty', null, 1]]);
  }

  // ================= Radio nav =================
  let vmap, cdi, ilsSide, ilsPlan, ilsInd;
  function buildRadio() {
    inSec.body.replaceChildren(
      h('h4', { style: { margin: '4px 0 2px', fontSize: '12px', color: 'var(--text-2)' } }, 'VOR / DME (or drag the aircraft)'),
      sl('Aircraft on radial (°)', 0, 359, 1, () => ((S.radial * DEG) % 360 + 360) % 360, v => { S.radial = v * D; }, { info: 'The radial is the magnetic bearing FROM the station to the aircraft (variation taken as zero here).' }),
      sl(`Distance from the station (${distL()})`, 0, 60, 0.5, () => S.rdist / distU(), v => { S.rdist = v * distU(); }, { d: 1 }),
      sl(`Height above the station (${units() === 'us' ? 'ft' : 'm'})`, 0, units() === 'us' ? 40000 : 12000, 100, () => S.alt / (units() === 'us' ? FT : 1), v => { S.alt = v * (units() === 'us' ? FT : 1); }),
      sl('Selected course, OBS (°)', 0, 359, 1, () => ((S.obs * DEG) % 360 + 360) % 360, v => { S.obs = v * D; }, { info: 'The course set on the omni-bearing selector. The needle shows where that course line is; the flag shows whether flying it takes you TO or FROM the station.' }),
      h('h4', { style: { margin: '12px 0 2px', fontSize: '12px', color: 'var(--text-2)' } }, 'ILS approach'),
      sl(`Distance to the threshold (${distL()})`, 0.2, 15, 0.1, () => S.ilsD / distU(), v => { S.ilsD = v * distU(); }, { d: 1 }),
      sl(`Lateral offset, + right (${units() === 'us' ? 'ft' : 'm'})`, units() === 'us' ? -3000 : -900, units() === 'us' ? 3000 : 900, 10, () => S.ilsY / (units() === 'us' ? FT : 1), v => { S.ilsY = v * (units() === 'us' ? FT : 1); }),
      sl(`Height above the glide path (${units() === 'us' ? 'ft' : 'm'})`, units() === 'us' ? -600 : -180, units() === 'us' ? 600 : 180, 5, () => S.ilsAbove / (units() === 'us' ? FT : 1), v => { S.ilsAbove = v * (units() === 'us' ? FT : 1); }));
    vmap = canvasBox('380px', drawVor); cdi = canvasBox('380px', drawCdi); ilsSide = canvasBox('220px', drawIlsSide); ilsPlan = canvasBox('220px', drawIlsPlan); ilsInd = canvasBox('220px', drawIlsInd);
    canvases = [vmap, cdi, ilsSide, ilsPlan, ilsInd];
    let drag = false;
    const move = e => { const r = vmap.canvas.getBoundingClientRect(), x = e.clientX - r.left - r.width / 2, y = -(e.clientY - r.top - r.height / 2), sc = vmap._sc || 1; const n = y / sc, ea = x / sc; S.radial = N.wrap2Pi(Math.atan2(ea, n)); S.rdist = Math.min(60 * distU(), Math.hypot(n, ea)); buildRadioInputsOnly(); compute(); };
    vmap.canvas.style.cursor = 'crosshair'; vmap.canvas.style.touchAction = 'none';
    vmap.canvas.addEventListener('pointerdown', e => { drag = true; vmap.canvas.setPointerCapture(e.pointerId); move(e); });
    vmap.canvas.addEventListener('pointermove', e => { if (drag) move(e); });
    vmap.canvas.addEventListener('pointerup', () => { drag = false; buildRadio(); compute(); });
    body.replaceChildren(h('div', { class: 'flt-grid2' },
      card('VOR and DME', 'Station at the centre, north up. Each radial is a magnetic bearing from the station; the selected course is drawn through it. The circle is the DME range the aircraft would read (its slant range).', vmap.el),
      card('Course deviation indicator', 'The needle is the selected course line: fly towards it. Full scale is 10°, 2° per dot. The flag says whether that course takes you TO or FROM the station.', cdi.el)),
      h('div', { class: 'flt-grid2e' }, card('ILS from the side', 'Glide slope (3°) with its ±0.7° full-scale sector, and the aircraft.', ilsSide.el), card('ILS from above', 'Localizer centreline with its sector (full scale about ±2.5°), approaching from the left: the right of the centreline is down the page.', ilsPlan.el)), card('ILS indicator', 'Vertical needle: localizer; horizontal needle: glide slope. Fly towards the needles.', ilsInd.el));
  }
  const buildRadioInputsOnly = () => {};
  function computeRadio() {
    const n = S.rdist * Math.cos(S.radial), e = S.rdist * Math.sin(S.radial), v = N.vor(n, e, S.obs), dm = N.dme(n, e, S.alt);
    const z = Math.tan(3 * D) * (S.ilsD + 300) + S.ilsAbove, il = N.ils({ d: S.ilsD, y: S.ilsY, z });
    R = { n, e, v, dm, il, z };
    const hu = units() === 'us' ? 'ft' : 'm', hk = units() === 'us' ? FT : 1;
    metrics.set([
      { k: 'Radial', v: brg(v.radial), s: `bearing to the station ${brg(v.radial + Math.PI)}` },
      { k: 'Flag', v: v.from ? 'FROM' : 'TO', s: `course ${brg(S.obs)} ${v.from ? 'leads away from' : 'leads to'} the station` },
      { k: 'Needle', v: Math.abs(v.dots) < 0.05 ? 'centred' : `fly ${v.dots > 0 ? 'right' : 'left'}`, s: `${f3(Math.abs(v.fly) * DEG)}° off · ${f3(Math.abs(v.dots))} dots${Math.abs(v.dots) >= 5 ? ' (full scale)' : ''}`, cls: Math.abs(v.dots) >= 5 ? 'warn' : '' },
      { k: 'DME', v: dist(dm.slant), s: `ground ${dist(dm.ground)} · reads ${dist(dm.error)} long`, cls: dm.error > 0.1 * dm.ground && dm.ground > 0 ? 'warn' : '' },
      { k: 'Localizer', v: Math.abs(il.locDots) < 0.05 ? 'centred' : `${f3(Math.abs(il.loc) * DEG)}° ${il.loc > 0 ? 'right' : 'left'}`, s: `${f3(Math.abs(il.locDots))} dots · fly ${il.loc > 0 ? 'left' : 'right'}`, cls: Math.abs(il.locDots) >= 2.5 ? 'warn' : '' },
      { k: 'Glide slope', v: Math.abs(il.gsDots) < 0.05 ? 'on slope' : `${f3(Math.abs(il.gs) * DEG)}° ${il.gs > 0 ? 'high' : 'low'}`, s: `${num(il.above / hk, 0)} ${hu} ${il.above >= 0 ? 'above' : 'below'} · on slope ${num(il.onGp / hk, 0)} ${hu}`, cls: Math.abs(il.gsDots) >= 2.5 ? 'warn' : '' },
    ]);
    const L = [];
    L.push({ type: 'i', t: 'The needle ignores the heading', d: 'A VOR measures only which radial you are on. The needle says where the selected course line is, whichever way the nose points; flying with a FROM flag on an inbound heading (reverse sensing) makes the needle move the wrong way.' });
    if (dm.ground < 3 * S.alt) L.push({ type: 'w', t: `DME reads ${dist(dm.error)} more than the ground distance`, d: `DME measures slant range. Close to the station and high up the difference is large: overhead at ${num(S.alt / FT, 0)} ft it reads ${dist(S.alt)}. Rule of thumb: negligible beyond about 1 nm of range per 1,000 ft of height.` });
    L.push({ type: 'i', t: 'Angular guidance gets sharper closer in', d: `The needles show angles, so the same deflection is a smaller distance near the runway: 1° of localizer at ${dist(S.ilsD)} is ${num(Math.tan(D) * (S.ilsD + 3300) / hk, 0)} ${hu} of offset. The glide path loses 318 ft of height per nautical mile flown at 3°.` });
    insightsList(ins, L);
    eq.replaceChildren(h('span', { class: 'eq', html: [
      `Aircraft at N ${dist(n)}, E ${dist(e)} from the station → radial = atan2(E, N) = ${brg(v.radial)}`,
      `${v.from ? 'FROM' : 'TO'}: |radial − course| ${v.from ? '<' : '>'} 90°;  off course ${f3(v.fly * DEG)}° → ${f3(v.dots)} dots (2°/dot)`,
      `DME slant = √(ground² + height²) = ${dist(dm.slant)}`,
      `Glide path height at ${dist(S.ilsD)} = tan 3° × (d + 300 m to the glide-path antenna) = ${num(il.onGp / hk, 0)} ${hu}`,
      `Localizer angle = atan(offset / (d + 3.3 km to the antenna)) = ${f3(il.loc * DEG)}°`,
    ].join('<br>') }));
  }
  function drawVor(c, W, H) {
    if (!R) return;
    const maxR = Math.max(R.dm.ground, 10 * distU()) * 1.25, sc = Math.min(W, H) / 2 / maxR, cx = W / 2, cy = H / 2; vmap._sc = sc;
    const P = (n, e) => [cx + e * sc, cy - n * sc];
    c.strokeStyle = cssVar('--border'); c.lineWidth = 0.8; c.fillStyle = cssVar('--text-3'); c.font = '9.5px ' + cssVar('--mono'); c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let a = 0; a < 360; a += 30) { const [x, y] = P(maxR * Math.cos(a * D), maxR * Math.sin(a * D)); c.beginPath(); c.moveTo(cx, cy); c.lineTo(x, y); c.stroke(); const [lx, ly] = P(maxR * 0.93 * Math.cos(a * D), maxR * 0.93 * Math.sin(a * D)); c.fillText(String(a || 360).padStart(3, '0'), lx, ly); }
    const step = units() === 'us' ? 10 * N.NM : 20000;
    for (let r = step; r < maxR; r += step) { c.beginPath(); c.arc(cx, cy, r * sc, 0, 2 * Math.PI); c.stroke(); }
    // selected course line (both ways through the station), DME circle, radial to the aircraft
    c.strokeStyle = '#e040fb'; c.lineWidth = 2; c.setLineDash([8, 5]); c.beginPath(); const [a1, b1] = P(-maxR * Math.cos(S.obs), -maxR * Math.sin(S.obs)), [a2, b2] = P(maxR * Math.cos(S.obs), maxR * Math.sin(S.obs)); c.moveTo(a1, b1); c.lineTo(a2, b2); c.stroke(); c.setLineDash([]);
    c.strokeStyle = cssVar('--accent'); c.globalAlpha = 0.5; c.beginPath(); c.arc(cx, cy, R.dm.slant * sc, 0, 2 * Math.PI); c.stroke(); c.globalAlpha = 1;
    const [ax, ay] = P(R.n, R.e);
    c.strokeStyle = cssVar('--good'); c.lineWidth = 1.6; c.beginPath(); c.moveTo(cx, cy); c.lineTo(ax, ay); c.stroke();
    c.fillStyle = cssVar('--text'); c.beginPath(); for (let i = 0; i < 6; i++) { const a = i / 6 * 2 * Math.PI; c.lineTo(cx + 8 * Math.cos(a), cy + 8 * Math.sin(a)); } c.fill();
    c.save(); c.translate(ax, ay); c.rotate(S.obs + (R.v.from ? 0 : 0) - Math.PI / 2); c.scale(1.2, 1.2); topView(c, cssVar('--text')); c.restore();
    c.fillStyle = cssVar('--text-2'); c.font = '600 11px ' + cssVar('--font'); c.textAlign = 'left'; c.textBaseline = 'top';
    c.fillText(`radial ${brg(R.v.radial)} · DME ${dist(R.dm.slant)}`, 8, 8); c.fillStyle = '#e040fb'; c.fillText(`course ${brg(S.obs)}`, 8, 24);
    c.fillStyle = cssVar('--text-3'); c.font = '10.5px ' + cssVar('--font'); c.fillText('aircraft drawn on the selected course', 8, H - 18);
  }
  function drawCdi(c, W, H) {
    if (!R) return;
    const cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2 - 16;
    c.fillStyle = '#111'; c.beginPath(); c.arc(cx, cy, r, 0, 2 * Math.PI); c.fill(); c.strokeStyle = cssVar('--border-strong'); c.lineWidth = 2; c.stroke();
    // course card: rotates so the selected course is at the top
    c.save(); c.translate(cx, cy); c.rotate(-S.obs);
    c.strokeStyle = '#ddd'; c.fillStyle = '#ddd'; c.font = '11px ' + cssVar('--mono'); c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let a = 0; a < 360; a += 5) { const t = a * D, l = a % 30 ? (a % 10 ? 5 : 9) : 13; c.lineWidth = a % 30 ? 1 : 1.8; c.beginPath(); c.moveTo((r - 2) * Math.sin(t), -(r - 2) * Math.cos(t)); c.lineTo((r - 2 - l) * Math.sin(t), -(r - 2 - l) * Math.cos(t)); c.stroke(); if (!(a % 30)) { c.save(); c.translate((r - 26) * Math.sin(t), -(r - 26) * Math.cos(t)); c.rotate(t); c.fillText(a === 0 ? 'N' : a === 90 ? 'E' : a === 180 ? 'S' : a === 270 ? 'W' : String(a / 10), 0, 0); c.restore(); } }
    c.restore();
    // course pointer, dots, needle, flag (in the instrument frame: course up)
    const dotS = r * 0.13;
    c.fillStyle = '#ddd'; for (let k = -5; k <= 5; k++) { if (!k) continue; c.beginPath(); c.arc(cx + k * dotS * 0.55, cy, 2.6, 0, 2 * Math.PI); c.fill(); }
    c.strokeStyle = '#e040fb'; c.lineWidth = 4; c.beginPath(); c.moveTo(cx, cy - r + 16); c.lineTo(cx, cy - r * 0.55); c.moveTo(cx, cy + r * 0.55); c.lineTo(cx, cy + r - 16); c.stroke();
    const nx = cx + R.v.dots * dotS * 0.55;
    c.strokeStyle = '#e040fb'; c.lineWidth = 4; c.beginPath(); c.moveTo(nx, cy - r * 0.5); c.lineTo(nx, cy + r * 0.5); c.stroke();
    c.fillStyle = '#fff'; c.beginPath(); if (R.v.from) { c.moveTo(cx + r * 0.32, cy + r * 0.3); c.lineTo(cx + r * 0.24, cy + r * 0.18); c.lineTo(cx + r * 0.4, cy + r * 0.18); } else { c.moveTo(cx + r * 0.32, cy - r * 0.3); c.lineTo(cx + r * 0.24, cy - r * 0.18); c.lineTo(cx + r * 0.4, cy - r * 0.18); } c.fill();
    c.font = '600 11px ' + cssVar('--mono'); c.fillText(R.v.from ? 'FR' : 'TO', cx + r * 0.32, R.v.from ? cy + r * 0.38 : cy - r * 0.38);
    c.fillStyle = cssVar('--text-2'); c.font = '600 12px ' + cssVar('--mono'); c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText(`CRS ${brg(S.obs)}`, 8, 8); c.textAlign = 'right'; c.fillText(`DME ${dist(R.dm.slant)}`, W - 8, 8);
  }
  function drawIlsSide(c, W, H) {
    if (!R) return;
    const hk = units() === 'us' ? FT : 1, u = distU(), dmax = Math.max(S.ilsD * 1.3, 2 * u);
    const zs = [R.z, Math.tan(3.7 * D) * (dmax + 300)], zmax = Math.max(...zs) * 1.1;
    const tr = axes(c, W, H, { x0: -dmax / u, x1: 0.3, y0: 0, y1: zmax / hk, xlabel: `Distance to the threshold (${distL()})`, ylabel: `Height (${units() === 'us' ? 'ft' : 'm'})`, xfmt: v => num(Math.abs(v), 1), yfmt: v => num(v, 0) });
    tr.clip();
    const gp = a => [[0.3, 0], [-dmax / u, Math.tan(a) * (dmax + 300) / hk]].map(([x, y], i) => (i ? [x, y] : [300 / u, 0]));
    const fill = (a0, a1, col, al) => { c.fillStyle = col; c.globalAlpha = al; c.beginPath(); c.moveTo(tr.sx(300 / u), tr.sy(0)); c.lineTo(tr.sx(-dmax / u), tr.sy(Math.tan(a1) * (dmax + 300) / hk)); c.lineTo(tr.sx(-dmax / u), tr.sy(Math.tan(a0) * (dmax + 300) / hk)); c.closePath(); c.fill(); c.globalAlpha = 1; };
    fill(2.3 * D, 3.7 * D, cssVar('--good'), 0.12);
    tr.line(gp(3 * D), cssVar('--good'), 2);
    tr.line([[-dmax / u, 0], [0.3, 0]], cssVar('--text-3'), 3);
    tr.dot(-S.ilsD / u, R.z / hk, cssVar('--accent'), 6);
    c.restore();
  }
  function drawIlsPlan(c, W, H) {
    if (!R) return;
    const hk = units() === 'us' ? FT : 1, u = distU(), dmax = Math.max(S.ilsD * 1.3, 2 * u), ymax = Math.max(Math.abs(S.ilsY) * 1.4, Math.tan(2.6 * D) * (dmax + 3300));
    const tr = axes(c, W, H, { x0: -dmax / u, x1: 0.3, y0: -ymax / hk, y1: ymax / hk, xlabel: `Distance to the threshold (${distL()})`, ylabel: `Offset (${units() === 'us' ? 'ft' : 'm'}), right is down`, xfmt: v => num(Math.abs(v), 1), yfmt: v => num(v, 0) });
    tr.clip();
    const ant = 3300 / u; c.fillStyle = cssVar('--good'); c.globalAlpha = 0.12; c.beginPath(); c.moveTo(tr.sx(ant), tr.sy(0)); c.lineTo(tr.sx(-dmax / u), tr.sy(Math.tan(2.5 * D) * (dmax + 3300) / hk)); c.lineTo(tr.sx(-dmax / u), tr.sy(-Math.tan(2.5 * D) * (dmax + 3300) / hk)); c.closePath(); c.fill(); c.globalAlpha = 1;
    tr.line([[-dmax / u, 0], [ant, 0]], cssVar('--good'), 2);
    c.fillStyle = cssVar('--text-3'); c.fillRect(tr.sx(0), tr.sy(25 / hk), tr.sx(3000 / u) - tr.sx(0), tr.sy(-25 / hk) - tr.sy(25 / hk));
    tr.dot(-S.ilsD / u, -S.ilsY / hk, cssVar('--accent'), 6);   // flying left to right, the right-hand side is down the page
    c.restore();
  }
  function drawIlsInd(c, W, H) {
    if (!R) return;
    const s = Math.min(W, H) - 30, cx = W / 2, cy = H / 2, d = s / 2 / 3;
    c.fillStyle = '#111'; c.fillRect(cx - s / 2, cy - s / 2, s, s); c.strokeStyle = cssVar('--border-strong'); c.strokeRect(cx - s / 2, cy - s / 2, s, s);
    c.fillStyle = '#ddd'; for (let k = -2; k <= 2; k++) { if (!k) continue; c.beginPath(); c.arc(cx + k * d, cy, 3, 0, 2 * Math.PI); c.fill(); c.beginPath(); c.arc(cx, cy + k * d, 3, 0, 2 * Math.PI); c.fill(); }
    c.strokeStyle = '#ffcc33'; c.lineWidth = 2; c.beginPath(); c.arc(cx, cy, 6, 0, 2 * Math.PI); c.stroke();
    // needles show where the beam is: localizer right of us when we are left of it; glide slope below when we are high
    const lx = cx - R.il.locDots * d, gy = cy + R.il.gsDots * d;
    c.strokeStyle = '#e040fb'; c.lineWidth = 4; c.beginPath(); c.moveTo(lx, cy - s / 2 + 8); c.lineTo(lx, cy + s / 2 - 8); c.moveTo(cx - s / 2 + 8, gy); c.lineTo(cx + s / 2 - 8, gy); c.stroke();
    c.fillStyle = cssVar('--text-2'); c.font = '11px ' + cssVar('--font'); c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText('LOC ↔  GS ↕', cx - s / 2, cy + s / 2 + 2);
  }

  const offU = onUnits(() => build());
  build();
  return { controls, main, show: () => repaint(), destroy: () => offU() };
}
