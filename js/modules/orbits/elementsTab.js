// Orbit & elements: one two-body orbit in 3-D from its six classical elements, with the satellite moving at the right
// speed (Kepler's equation), the r, v and h vectors, the element angles, equal-area sectors, and radius, speed and
// flight-path angle through one orbit.
import { h, section, segmented, toggle, icon } from '../../lib/ui.js';
import { Plot } from '../../lib/plot.js';
import * as O from '../../solvers/orbits.js';
import { orbit, changed, elOf, orbitControls, metricsGrid, insightsList, card, resultRows, km, kms, deg, dur, css, D } from './common.js';
import { OrbitView } from './view3d.js';

export function elementsTab({ keep }) {
  const S = orbit;
  const V = keep({ speed: 'orbit12', areas: false, angles: true, vectors: true, nodes: true, plane: true });
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });
  const metrics = metricsGrid();
  const view = new OrbitView();
  view.setLayers({ areas: V.areas, angles: V.angles, vectors: V.vectors, nodes: V.nodes, plane: V.plane, apsides: true });
  const vCard = card('The orbit in 3-D', 'Inertial frame: X toward the vernal equinox ♈, Z toward the north pole. Accent: the orbit (solid north of the equator, dashed south). Amber: line of nodes. Green: periapsis and the angular momentum h. Red: velocity v and the inclination i.');
  const layerRow = h('div', { class: 'row orb-layers', style: { gap: '4px 14px', flexWrap: 'wrap', marginBottom: '8px' } });
  for (const [k, l, tip] of [['angles', 'Element angles', 'Arcs showing Ω, i, ω and ν where they are measured.'], ['vectors', 'r, v, h', 'Position, velocity and the angular momentum vector, normal to the orbit plane.'], ['nodes', 'Line of nodes', 'Where the orbit plane cuts the equatorial plane.'], ['plane', 'Equatorial plane', 'The reference plane the orbit is tilted against.'], ['areas', 'Equal-area sectors', 'Kepler\'s second law: twelve sectors each swept in one twelfth of the period, alternately shaded. Same area, very different shapes.']])
    layerRow.append(toggle(l, V[k], v => { V[k] = v; view.setLayers({ [k]: v }); }, { tip }).el);
  const camRow = h('div', { class: 'row', style: { gap: '6px', marginLeft: 'auto' } });
  for (const [l, a, e] of [['3-D', -55, 22], ['From above', -90, 89.5], ['Along the equator', -90, 0], ['Edge-on', 0, 0]]) {
    const b = h('button', { class: 'btn sm', type: 'button' }, l);
    b.addEventListener('click', () => { if (l === 'Edge-on') { const el = elOf(); view.setView(el.raan / D, 0); } else view.setView(a, e); });
    camRow.append(b);
  }
  vCard.append(h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '8px', alignItems: 'center' } }, layerRow, camRow), view.el);
  const rCard = card('Altitude over one orbit', 'Time runs evenly here, so the satellite whips through periapsis and dawdles at apoapsis.');
  const rPlot = new Plot(rCard, { xlabel: 'time since periapsis (min)', ylabel: 'altitude (km)', xname: 't', yname: 'altitude', xfmt: v => v.toFixed(1) + ' min', yfmt: v => v.toFixed(0) + ' km', legend: false });
  const vPlot0 = card('Speed and flight-path angle', 'Speed from vis-viva, v² = μ(2/r − 1/a). Flight-path angle γ: how far the velocity tilts above the local horizontal; zero at periapsis and apoapsis, climbing on the way out.');
  const vPlot = new Plot(vPlot0, { xlabel: 'time since periapsis (min)', ylabel: 'speed (km/s) · γ (°/10)', xname: 't', yname: 'value', xfmt: v => v.toFixed(1) + ' min', yfmt: v => v.toFixed(3), legendPos: 'above' });
  const insCard = card('Notes'); const insEl = h('div'); insCard.append(insEl);
  const stCard = card('State vectors and constants', 'Position and velocity in the inertial frame, from the elements (and back again, as a check). Specific values are per kilogram.');
  const stEl = h('div', { class: 'cf-res' }); stCard.append(stEl);
  main.append(metrics.el, vCard, h('div', { class: 'cf-grid2b' }, rCard, vPlot0), h('div', { class: 'cf-grid2b' }, insCard, stCard));

  // ---- animation ----
  let playing = false, raf = 0, tSim = 0, lastSlider = 0;
  const play = h('button', { class: 'btn sm primary', type: 'button' });
  const paintPlay = () => play.replaceChildren(icon(playing ? 'pause' : 'play', 14), playing ? ' Pause' : ' Play');
  paintPlay();
  play.addEventListener('click', () => { playing = !playing; paintPlay(); if (playing) start(); else cancelAnimationFrame(raf); });
  const start = () => {
    let last = performance.now();
    const step = t => {
      if (!playing) return;
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      const el = elOf(), B = O.body(S.body), Pp = O.props(el, B.mu);
      const warp = V.speed === 'orbit12' ? Pp.T / 12 : V.speed === 'orbit40' ? Pp.T / 40 : V.speed === 'x600' ? 600 : 60;
      tSim += dt * warp;
      const M = O.meanFromTrue(el.nu, el.e) + Pp.n * dt * warp;
      S.nu = O.wrap2pi(O.trueFromMean(M, el.e)) / D;
      if (t - lastSlider > 80) { ctl.setNu(S.nu); lastSlider = t; }
      paintNow();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  };
  const animSec = section('Animation');
  const speedSeg = segmented([{ value: 'orbit12', label: 'Orbit in 12 s' }, { value: 'orbit40', label: 'in 40 s' }, { value: 'x600', label: '600×' }, { value: 'x60', label: '60×' }], V.speed, v => { V.speed = v; });
  speedSeg.el.classList.add('seg-wrap');
  animSec.body.append(h('div', { class: 'row', style: { marginBottom: '8px' } }, play), speedSeg.el,
    h('div', { class: 'hint' }, 'The satellite moves by Kepler\'s equation: fast near periapsis, slow near apoapsis. 600× and 60× are real time sped up; the body turns beneath at its true rate.'));

  const ctl = orbitControls({ onChange: what => { if (what === 'nu') paintNow(); else { changed(); paint(); } } });
  controls.append(ctl.el, animSec.el);

  // ---- painting ----
  let hist = null;
  const paint = () => {
    const el = elOf(), B = O.body(S.body), P = O.props(el, B.mu);
    hist = O.timeHistory(el, B.mu, 240);
    const tm = hist.map(p => p.t / 60);
    rPlot.setData({ series: [{ x: tm, y: hist.map(p => (p.r - B.R) / 1e3), color: css('--accent'), width: 2.2 }], hlines: [{ y: (P.rp - B.R) / 1e3, color: css('--good'), label: 'periapsis', bound: true, labelAt: 0.5 }, ...(el.e > 0.002 ? [{ y: (P.ra - B.R) / 1e3, color: css('--lower'), label: 'apoapsis' }] : [])] });
    vPlot.setData({ series: [{ x: tm, y: hist.map(p => p.v / 1e3), color: css('--bad'), label: 'speed (km/s)', width: 2.2 }, { x: tm, y: hist.map(p => p.fpa / D / 10), color: css('--turb'), dash: [5, 4], label: 'flight-path angle γ (°/10)' }] });
    const L = [], hp = (P.rp - B.R) / 1e3, rates = O.j2Rates(el, B);
    if (hp < 0) L.push({ type: 'b', t: 'Periapsis is below the surface', d: `The ellipse dips ${(-hp).toFixed(0)} km inside ${B.label}: this is a ballistic path that ends on the ground, not an orbit.` });
    else if (S.body === 'earth' && hp < 160) L.push({ type: 'b', t: 'Inside the atmosphere at periapsis', d: 'Below about 160 km drag brings a satellite down within days; below 120 km within a few orbits. Reentry capsules use exactly this.' });
    else if (S.body === 'earth' && hp < 350) L.push({ type: 'w', t: 'Drag shortens its life', d: 'Between 200 and 350 km the thin upper atmosphere still drags. The ISS (about 420 km) is reboosted every few months; at 300 km a small satellite lasts weeks to months, depending on solar activity.' });
    if (el.e < 0.002) L.push({ type: 'i', t: 'Nearly circular', d: `Constant speed ${kms(P.vc)} and constant altitude. ω and ν lose their meaning when there is no periapsis; the argument of latitude u = ω + ν is used instead.` });
    else L.push({ type: 'i', t: `Speed varies ${(P.vp / P.va).toFixed(2)}× around the orbit`, d: `${kms(P.vp)} at periapsis, ${kms(P.va)} at apoapsis: the ratio is (1 + e)/(1 − e), the same as the ratio of the radii the other way round (angular momentum r·v is the same at both).` });
    const inc = el.i / D;
    if (inc > 90) L.push({ type: 'i', t: 'Retrograde', d: 'Inclination above 90°: the satellite goes round against the body\'s rotation. Launching into it costs extra, since the ground\'s rotation works against the rocket.' });
    if (S.body === 'earth' || S.body === 'mars') {
      const iss = O.sunSyncInclination(el.a, el.e, B);
      if (isFinite(iss) && Math.abs(inc - iss / D) < 0.5) L.push({ type: 'g', t: 'Sun-synchronous', d: `J2 turns the plane by ${(rates.raanDot / D * 86400).toFixed(3)}°/day, once a year, so the orbit keeps the same angle to the Sun.` });
      if (Math.abs(inc - 63.43) < 0.5 || Math.abs(inc - 116.57) < 0.5) L.push({ type: 'g', t: 'Critical inclination', d: 'The apsides stand still under J2 (5cos²i = 1), so the apoapsis stays over the same latitude. Molniya and Tundra orbits use this.' });
    }
    if (S.body === 'earth' && Math.abs(P.T - O.SIDEREAL_DAY) / O.SIDEREAL_DAY < 0.003) L.push({ type: 'g', t: inc < 1 && el.e < 0.01 ? 'Geostationary' : 'Geosynchronous', d: 'One revolution per sidereal day (23 h 56 min): the track repeats daily. Equatorial and circular, the satellite hangs over one longitude.' });
    if (B.J2 > 0 && hp > 0) L.push({ type: 'i', t: `J2: node ${(rates.raanDot / D * 86400).toFixed(2)}°/day, periapsis ${(rates.argpDot / D * 86400).toFixed(2)}°/day`, d: 'The equatorial bulge slowly turns the orbit. Prograde orbits regress (node moves west), retrograde ones advance. Shown in the Ground tracks tab.' });
    insightsList(insEl, L);
    paintNow();
  };
  const paintNow = () => {
    const el = elOf(), B = O.body(S.body), P = O.props(el, B.mu);
    const r = O.rAt(el, el.nu), v = O.visViva(B.mu, r, el.a), fpa = O.flightPathAngle(el.e, el.nu), M = O.wrap2pi(O.meanFromTrue(el.nu, el.e)), tp = M / P.n;
    metrics.set([
      { k: 'Period', v: dur(P.T), s: `n = ${(P.n / D * 3600).toFixed(2)}°/h`, tip: 'T = 2π√(a³/μ): depends only on the semi-major axis.' },
      { k: 'Semi-major axis', v: km(el.a), s: `e = ${el.e.toFixed(4)}` },
      { k: 'Periapsis', v: km(P.rp - B.R), s: `altitude · ${kms(P.vp)}`, cls: P.rp < B.R ? 'bad' : '' },
      { k: 'Apoapsis', v: km(P.ra - B.R), s: `altitude · ${kms(P.va)}` },
      { k: 'Now', v: km(r - B.R), s: `${kms(v)} · γ ${(fpa / D).toFixed(2)}°`, tip: 'Altitude and speed at the current true anomaly, with the flight-path angle above the local horizontal.' },
      { k: 'Time since periapsis', v: dur(tp), s: `M ${(M / D).toFixed(1)}° · E ${(O.wrap2pi(O.eFromTrue(el.nu, el.e)) / D).toFixed(1)}°`, tip: 'Mean anomaly M = n·t runs evenly in time; eccentric anomaly E links it to ν through Kepler\'s equation M = E − e sin E.' },
      { k: 'Energy (MJ/kg)', v: (P.energy / 1e6).toFixed(3), s: `escape at periapsis ${kms(P.vesc)}`, tip: 'ε = v²/2 − μ/r = −μ/(2a). Negative: bound. It takes |ε| more per kilogram to escape.' },
    ]);
    view.set({ el, B, gst: B.w * tSim });
    const rv = O.coe2rv(el, B.mu), back = O.rv2coe(rv.r, rv.v, B.mu), f = a => a.map(x => (x / 1e3).toFixed(1)).join(', ');
    resultRows(stEl, [
      ['r (km)', `[${f(rv.r)}]`], ['v (km/s)', `[${rv.v.map(x => (x / 1e3).toFixed(3)).join(', ')}]`],
      ['|r|', km(r)], ['|v|', kms(v)],
      ['h = |r × v|', (P.h / 1e6).toFixed(2) + ' km²/s'], ['semi-latus rectum p', km(P.p)],
      ['semi-minor axis b', km(P.b)], ['circular speed at a', kms(P.vc)],
      ['back to elements: a', km(back.a)], ['back to elements: e, i', `${back.e.toFixed(4)}, ${deg(back.i, 2)}`],
    ]);
    if (hist) {
      const vl = [{ x: tp / 60, color: css('--text-2'), dash: [3, 3] }];
      for (const p of [rPlot, vPlot]) { p.data.vlines = vl; p.draw(); }
    }
  };

  let visible = false, dirty = true;
  orbit.subs.add(() => { if (!visible) dirty = true; });
  return {
    controls, main,
    show() { visible = true; ctl.sync(); paint(); dirty = false; },
    hide() { visible = false; playing = false; paintPlay(); cancelAnimationFrame(raf); },
    destroy() { playing = false; cancelAnimationFrame(raf); view.destroy(); },
  };
}
