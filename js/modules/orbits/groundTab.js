// Ground tracks: the point under the satellite as the body turns beneath the orbit, with J2 node and apsides drift,
// the area seen above a minimum elevation, launch sites and ground stations, repeat cycles, and the J2 rates that make
// sun-synchronous and critical-inclination orbits.
import { h, section, slider, toggle, icon } from '../../lib/ui.js';
import { Plot } from '../../lib/plot.js';
import * as O from '../../solvers/orbits.js';
import { orbit, changed, elOf, orbitControls, metricsGrid, insightsList, card, canvasBox, km, dur, css, D } from './common.js';
import { LAND, WATER, SITES } from './worldMap.js';

export function groundTab({ keep }) {
  const S = orbit;
  const G = keep({ revs: 3, j2: true, elev: 10, cover: true, sites: true });
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });
  const metrics = metricsGrid();
  const map = canvasBox('cf-chart', 'auto');
  map.el.style.aspectRatio = '2 / 1'; map.el.style.height = 'auto'; map.el.style.minHeight = '280px';
  const mCard = card('Ground track', 'Equirectangular map (longitude across, latitude up). Each revolution is drawn a little brighter than the one before. The ring around the satellite is the area that sees it above the minimum elevation; ground sites inside it light up.');
  mCard.append(map.el);
  const nCard = card('J2: node drift against inclination', 'How fast the bulge turns the orbit plane at this size and shape. Prograde orbits drift west (negative), retrograde east. Where the curve crosses +0.986°/day the orbit is sun-synchronous; at 90° there is no drift.');
  const nPlot = new Plot(nCard, { xlabel: 'inclination (°)', ylabel: 'node drift (°/day)', xname: 'i', yname: 'dΩ/dt', xfmt: v => v.toFixed(1) + '°', yfmt: v => v.toFixed(3) + '°/day', legend: false });
  const sCard = card('Sun-synchronous inclination against altitude', 'Circular orbits: the inclination that turns the plane once a year. Higher orbits feel the bulge less, so they need to be tilted further past the pole; above about 5 970 km it is impossible.');
  const sPlot = new Plot(sCard, { xlabel: 'altitude (km)', ylabel: 'inclination (°)', xname: 'altitude', yname: 'i', xfmt: v => v.toFixed(0) + ' km', yfmt: v => v.toFixed(2) + '°', legend: false });
  for (const p of [nPlot, sPlot]) p.wrap.style.height = '240px';
  const insCard = card('Notes'); const insEl = h('div'); insCard.append(insEl);
  main.append(metrics.el, mCard, h('div', { class: 'cf-grid2b' }, nCard, sCard), insCard);

  let playing = false, raf = 0, tNow = 0;
  const play = h('button', { class: 'btn sm primary', type: 'button' });
  const paintPlay = () => play.replaceChildren(icon(playing ? 'pause' : 'play', 14), playing ? ' Pause' : ' Play');
  paintPlay();
  play.addEventListener('click', () => {
    playing = !playing; paintPlay();
    if (!playing) { cancelAnimationFrame(raf); return; }
    if (!R || tNow >= R.dur) tNow = 0;
    let last = performance.now();
    const step = t => {
      if (!playing || !R) return;
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      tNow += dt * R.P.T / 6; // one revolution in about 6 s
      if (tNow >= R.dur) { tNow = R.dur; playing = false; paintPlay(); }
      timeS.set(tNow / R.dur * 100);
      map.draw(); paintNow();
      if (playing) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  });

  const ctl = orbitControls({ onChange: () => { changed(); paint(); } });
  const secT = section('Track');
  let timeS;
  secT.body.append(
    slider({ label: 'Revolutions to draw', min: 1, max: 40, step: 1, value: G.revs, digits: 0, onInput: v => { G.revs = Math.round(v); paint(); } }).el,
    (timeS = slider({ label: 'Time along the track (%)', min: 0, max: 100, step: 0.1, value: 0, digits: 1, onInput: v => { if (R) { tNow = v / 100 * R.dur; map.draw(); paintNow(); } } })).el,
    h('div', { class: 'row', style: { marginBottom: '8px' } }, play),
    toggle('J2 drift', G.j2, v => { G.j2 = v; paint(); }, { tip: 'Include the secular drift of the node, periapsis and mean motion caused by the equatorial bulge. Off: a pure two-body orbit.' }).el,
    toggle('Coverage ring', G.cover, v => { G.cover = v; map.draw(); }, { tip: 'The area on the ground that sees the satellite at least the minimum elevation above the horizon.' }).el,
    toggle('Launch sites and stations', G.sites, v => { G.sites = v; map.draw(); }).el,
    slider({ label: 'Minimum elevation (°)', min: 0, max: 45, step: 1, value: G.elev, digits: 0, info: 'Antennas and observers need the satellite some way above the horizon: 5–10° for ground stations, more in cities or mountains.', onInput: v => { G.elev = v; paint(); } }).el,
    h('div', { class: 'hint' }, 'Ω here is the longitude where the track first crosses the equator northbound (the prime meridian starts at ♈).'));
  controls.append(ctl.el.firstChild, secT.el, ctl.el.lastChild);

  let R = null;
  const compute = () => {
    const el = elOf(), B = O.body(S.body), P = O.props(el, B.mu), dur0 = G.revs * P.T;
    const track = O.groundTrack(el, B, { duration: dur0, n: Math.min(8000, 300 * G.revs), j2: G.j2 });
    R = { el, B, P, dur: dur0, track, shift: O.trackShift(el, B), rates: O.j2Rates(el, B) };
    if (tNow > dur0) tNow = dur0;
  };
  const paint = () => {
    compute();
    const { el, B, P, shift, rates } = R;
    // node drift vs inclination at this a, e
    const is = [], dr = [];
    for (let k = 0; k <= 180; k++) { is.push(k); dr.push(O.j2Rates({ ...el, i: k * D }, B).raanDot / D * 86400); }
    const sso = 360 / 365.2422;
    nPlot.setData({ series: [{ x: is, y: dr, color: css('--accent'), width: 2.2, label: 'dΩ/dt' }, { x: [el.i / D], y: [rates.raanDot / D * 86400], color: css('--text'), points: true, line: false, pointSize: 4.5, noLegend: true }],
      hlines: [{ y: sso, color: css('--good'), label: 'sun-synchronous +0.986°/day' }], vlines: [{ x: 63.43, color: css('--border-strong'), dash: [2, 4] }, { x: 116.57, color: css('--border-strong'), dash: [2, 4] }] });
    const hs = [], ss = [];
    for (let k = 0; k <= 200; k++) { const hh = 150 + k * 30; const v = O.sunSyncInclination(B.R + hh * 1e3, 0, B); hs.push(hh); ss.push(v / D); }
    sPlot.setData({ series: [{ x: hs, y: ss, color: css('--accent'), width: 2.2 }, { x: [(el.a - B.R) / 1e3], y: [O.sunSyncInclination(el.a, el.e, B) / D], color: css('--text'), points: true, line: false, pointSize: 4.5 }] });
    sPlot.wrap.parentElement.style.display = S.body === 'earth' || S.body === 'mars' ? '' : 'none';
    // notes
    const L = [], inc = el.i / D, maxLat = inc > 90 ? 180 - inc : inc;
    L.push({ type: 'i', t: `Track reaches ${maxLat.toFixed(1)}° latitude`, d: 'A ground track never goes further from the equator than the inclination (180° − i for retrograde orbits). The ISS at 51.6° passes over most of the inhabited world; polar orbits see everywhere.' });
    L.push({ type: 'i', t: `Each pass is ${(shift.shift / D).toFixed(2)}° further west`, d: `In one nodal period (${dur(shift.Tn)}) ${B.label} turns ${(B.w * shift.Tn / D).toFixed(2)}° beneath the orbit${G.j2 ? `, and the node moves ${(rates.raanDot * shift.Tn / D).toFixed(3)}°` : ''}. That is ${((shift.shift / D) * Math.PI / 180 * B.R / 1e3).toFixed(0)} km at the equator.` });
    const rep = repeatCycle(shift);
    if (rep) L.push({ type: 'g', t: `Repeats after ${rep.revs} revolutions in ${rep.days} day${rep.days > 1 ? 's' : ''}`, d: `The track closes to within ${rep.err.toFixed(2)}° of longitude, so the same places are overflown again on the same schedule. Earth-observation and altimetry satellites are tuned to exact repeat cycles like this.` });
    if (S.body === 'earth' && Math.abs(P.T - O.SIDEREAL_DAY) < 300) L.push({ type: 'g', t: inc < 1 && el.e < 0.01 ? 'Geostationary: the track is a point' : 'Geosynchronous: a closed figure', d: inc < 1 && el.e < 0.01 ? 'One turn per sidereal day over the equator: the satellite stays over one longitude, and dishes can be fixed.' : 'One turn per sidereal day: the track repeats every day. Inclination makes a figure eight; eccentricity makes it lopsided, lingering near apoapsis.' });
    if (el.e > 0.3) L.push({ type: 'i', t: 'Lingering at apoapsis', d: 'The satellite moves slowly far out, so the track bunches up there and the satellite spends most of its time over that region. With ω = 270° the apoapsis is over the north: Molniya satellites cover Russia for 8 of their 12 hours.' });
    if (!G.j2) L.push({ type: 'w', t: 'J2 is off', d: 'Without the bulge the orbit plane stays fixed in space. Turn J2 on to see the node regress, which is what makes sun-synchronous orbits possible.' });
    insightsList(insEl, L);
    map.draw(); paintNow();
  };
  const paintNow = () => {
    if (!R) return;
    const { el, B, P, shift, rates } = R;
    const p = trackAt(tNow), lam = O.coverageAngle(Math.max(1, p.alt), B.R, G.elev * D);
    const sso = O.sunSyncInclination(el.a, el.e, B);
    metrics.set([
      { k: 'Period', v: dur(P.T), s: `nodal ${dur(shift.Tn)}` },
      { k: 'Revolutions per day', v: shift.revsPerDay.toFixed(3), s: 'relative to the turning ground' },
      { k: 'Shift per orbit', v: (shift.shift / D).toFixed(2) + '° W', s: `${((shift.shift) * B.R / 1e3).toFixed(0)} km at the equator` },
      { k: 'Node drift (J2)', v: (rates.raanDot / D * 86400).toFixed(3) + '°/day', s: `periapsis ${(rates.argpDot / D * 86400).toFixed(3)}°/day` },
      { k: 'Coverage radius', v: km(lam * B.R), s: `above ${G.elev}° elevation, from ${km(p.alt)}`, tip: 'Ground distance from the sub-satellite point to the edge of the area that sees the satellite above the minimum elevation.' },
      { k: 'Sun-sync inclination', v: isFinite(sso) ? (sso / D).toFixed(2) + '°' : 'impossible', s: S.body === 'earth' || S.body === 'mars' ? 'at this a and e' : 'Earth and Mars only' },
      { k: 'Under the satellite', v: `${Math.abs(p.lat / D).toFixed(1)}° ${p.lat < 0 ? 'S' : 'N'}`, s: `${Math.abs(p.lon / D).toFixed(1)}° ${p.lon < 0 ? 'W' : 'E'} · after ${dur(tNow)}` },
    ]);
  };
  const trackAt = t => {
    const { el, B } = R, rates = G.j2 ? R.rates : { raanDot: 0, argpDot: 0, mDot: Math.sqrt(B.mu / el.a ** 3) };
    const M0 = O.meanFromTrue(el.nu, el.e);
    return O.subPoint({ ...el, raan: el.raan + rates.raanDot * t, argp: el.argp + rates.argpDot * t, nu: O.trueFromMean(M0 + rates.mDot * t, el.e) }, B, B.w * t);
  };

  map.set(({ W, H, g }) => {
    if (!R) return;
    const { B, track, P } = R;
    const X = lon => (lon / D + 180) / 360 * W, Y = lat => (90 - lat / D) / 180 * H;
    const XL = lon => (lon + 180) / 360 * W, YL = lat => (90 - lat) / 180 * H;
    const dark = document.documentElement.dataset.resolvedTheme === 'dark';
    g.fillStyle = dark ? '#0f1b2d' : '#dbe8f5'; g.fillRect(0, 0, W, H);
    if (S.body === 'earth') {
      g.fillStyle = dark ? '#24364d' : '#f4f1e8'; g.strokeStyle = dark ? '#3a5170' : '#b9b3a3'; g.lineWidth = 0.8;
      for (const poly of LAND) { g.beginPath(); poly.forEach(([lo, la], j) => j ? g.lineTo(XL(lo), YL(la)) : g.moveTo(XL(lo), YL(la))); g.closePath(); g.fill(); g.stroke(); }
      g.fillStyle = dark ? '#0f1b2d' : '#dbe8f5';
      for (const poly of WATER) { g.beginPath(); poly.forEach(([lo, la], j) => j ? g.lineTo(XL(lo), YL(la)) : g.moveTo(XL(lo), YL(la))); g.closePath(); g.fill(); g.stroke(); }
    } else {
      g.fillStyle = B.color; g.globalAlpha = 0.18; g.fillRect(0, 0, W, H); g.globalAlpha = 1;
    }
    // graticule
    g.strokeStyle = dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)'; g.lineWidth = 1;
    const grid = []; // grid labels are drawn last, over the track and coverage area
    for (let lo = -150; lo <= 150; lo += 30) { g.beginPath(); g.moveTo(XL(lo), 0); g.lineTo(XL(lo), H); g.stroke(); grid.push([`${Math.abs(lo)}°${lo < 0 ? 'W' : lo > 0 ? 'E' : ''}`, XL(lo) + 2, H - 12]); }
    for (let la = -60; la <= 60; la += 30) { g.beginPath(); g.moveTo(0, YL(la)); g.lineTo(W, YL(la)); g.stroke(); grid.push([`${Math.abs(la)}°${la < 0 ? 'S' : la > 0 ? 'N' : ''}`, 3, YL(la) + 2]); }
    g.strokeStyle = dark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.2)'; g.beginPath(); g.moveTo(0, YL(0)); g.lineTo(W, YL(0)); g.stroke();
    // track: past part brighter, future part faint; each revolution a little brighter than the last
    const acc = css('--accent');
    const iNow = Math.min(track.length - 1, Math.round(tNow / R.dur * (track.length - 1)));
    const drawPart = (a, b, alphaFn, w) => {
      g.strokeStyle = acc; g.lineWidth = w;
      let prev = null, curRev = -1;
      g.beginPath();
      for (let j = a; j <= b; j++) {
        const p = track[j], rev = Math.floor(p.t / P.T);
        if (rev !== curRev) { g.stroke(); g.globalAlpha = alphaFn(rev); g.beginPath(); curRev = rev; if (prev) g.moveTo(X(prev.lon), Y(prev.lat)); }
        if (!prev || Math.abs(p.lon - prev.lon) > Math.PI) g.moveTo(X(p.lon), Y(p.lat)); else g.lineTo(X(p.lon), Y(p.lat));
        prev = p;
      }
      g.stroke(); g.globalAlpha = 1;
    };
    const nR = Math.max(1, G.revs);
    drawPart(0, track.length - 1, rev => 0.3 + 0.4 * (rev + 1) / nR, 1.4);
    if (iNow > 0) drawPart(0, iNow, () => 1, 2.4);
    // northbound equator crossings of the first revolution: the ascending node
    // current point, coverage ring
    const p = trackAt(tNow);
    const lam = O.coverageAngle(Math.max(1, p.alt), B.R, G.elev * D);
    const ring = [];
    for (let k = 0; k <= 180; k++) {
      const az = k / 180 * 2 * Math.PI, la2 = Math.asin(Math.sin(p.lat) * Math.cos(lam) + Math.cos(p.lat) * Math.sin(lam) * Math.cos(az));
      const lo2 = O.wrapPi(p.lon + Math.atan2(Math.sin(az) * Math.sin(lam) * Math.cos(p.lat), Math.cos(lam) - Math.sin(p.lat) * Math.sin(la2)));
      ring.push([la2, lo2]);
    }
    const inView = (la, lo) => Math.acos(Math.max(-1, Math.min(1, Math.sin(la) * Math.sin(p.lat) + Math.cos(la) * Math.cos(p.lat) * Math.cos(lo - p.lon)))) <= lam;
    if (G.cover) {
      const wraps = ring.some((q, j) => j && Math.abs(q[1] - ring[j - 1][1]) > Math.PI);
      const poleIn = inView(Math.PI / 2, 0) || inView(-Math.PI / 2, 0);
      g.strokeStyle = css('--warn'); g.lineWidth = 1.6; g.fillStyle = css('--warn');
      if (!wraps && !poleIn) { g.beginPath(); ring.forEach(([la, lo], j) => j ? g.lineTo(X(lo), Y(la)) : g.moveTo(X(lo), Y(la))); g.closePath(); g.globalAlpha = 0.14; g.fill(); g.globalAlpha = 1; g.stroke(); }
      else { g.beginPath(); ring.forEach(([la, lo], j) => { if (!j || Math.abs(lo - ring[j - 1][1]) > Math.PI) g.moveTo(X(lo), Y(la)); else g.lineTo(X(lo), Y(la)); }); g.stroke(); }
    }
    if (G.sites && S.body === 'earth') {
      g.font = '10px ' + css('--font'); g.textBaseline = 'middle';
      // labels try right, left, below, then above their marker and are skipped if all four would hit another label
      const placed = [], hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      const sites = SITES.map(([n, la, lo]) => ({ n, x: XL(lo), y: YL(la), on: G.cover && inView(la * D, lo * D) }));
      for (const s of sites) {
        g.fillStyle = s.on ? css('--good') : css('--text-2');
        g.beginPath(); g.moveTo(s.x, s.y - 4); g.lineTo(s.x + 3.5, s.y + 3); g.lineTo(s.x - 3.5, s.y + 3); g.closePath(); g.fill();
        placed.push({ x: s.x - 4, y: s.y - 5, w: 8, h: 9 });
      }
      for (const s of [...sites].sort((a, b) => b.on - a.on)) {
        if (!s.on && W <= 700) continue;
        const w = g.measureText(s.n).width, hh = 11;
        const spots = [[s.x + 6, s.y - hh / 2], [s.x - 6 - w, s.y - hh / 2], [s.x - w / 2, s.y + 5], [s.x - w / 2, s.y - 6 - hh]]
          .map(([x, y]) => ({ x, y, w, h: hh })).filter(r => r.x >= 2 && r.x + r.w <= W - 2 && r.y >= 2 && r.y + r.h <= H - 16);
        const r = spots.find(r => !placed.some(q => hit(r, q)));
        if (!r) continue;
        placed.push(r);
        g.textAlign = 'left'; g.lineJoin = 'round'; g.strokeStyle = dark ? '#0f1b2d' : '#dbe8f5'; g.lineWidth = 3; g.strokeText(s.n, r.x, r.y + hh / 2); g.fillStyle = s.on ? css('--good') : css('--text-3'); g.fillText(s.n, r.x, r.y + hh / 2);
      }
    }
    g.font = '9.5px ' + css('--mono'); g.textBaseline = 'top'; g.textAlign = 'left'; g.lineJoin = 'round';
    g.strokeStyle = dark ? '#0f1b2d' : '#dbe8f5'; g.lineWidth = 3;
    for (const [t, x, y] of grid) { g.strokeText(t, x, y); }
    g.fillStyle = css('--text-3'); for (const [t, x, y] of grid) g.fillText(t, x, y);
    g.beginPath(); g.arc(X(p.lon), Y(p.lat), 5.5, 0, 2 * Math.PI); g.fillStyle = css('--text'); g.fill(); g.strokeStyle = css('--bg-elev'); g.lineWidth = 2; g.stroke();
    if (S.body !== 'earth') { g.fillStyle = css('--text-2'); g.font = '11px ' + css('--font'); g.textBaseline = 'top'; g.fillText(`${B.label}: no map, latitude and longitude only`, 8, 8); }
  });

  let visible = false;
  return {
    controls, main,
    show() { visible = true; ctl.sync(); paint(); },
    hide() { visible = false; playing = false; paintPlay(); cancelAnimationFrame(raf); },
    destroy() { playing = false; cancelAnimationFrame(raf); },
  };
}

// smallest whole number of days (up to 30) after which a whole number of revolutions brings the track back within 1°
function repeatCycle(shift) {
  let best = null;
  for (let days = 1; days <= 30; days++) {
    const revs = Math.round(shift.revsPerDay * days);
    if (revs < 1) continue;
    const err = Math.abs(O.wrapPi(revs * shift.shift - days * 2 * Math.PI)) / D;
    if (err < 1) { best = { days, revs, err }; break; }
  }
  return best;
}
