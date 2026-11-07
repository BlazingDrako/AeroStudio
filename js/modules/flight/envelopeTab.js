// Envelope tab: the altitude–Mach map of specific excess power Ps (1 g), its Ps = 0 boundary (the level-flight
// envelope), stall / dynamic-pressure / Mach limits, lines of constant energy height, and Rutowski's minimum-time
// energy climb to a target point that the user picks on the map.
import { h, section, slider, toggle, cssVar } from '../../lib/ui.js';
import { Plot } from '../../lib/plot.js';
import * as P from '../../solvers/performance.js';
import { atmosphere, geometric, geopotential, G0 } from '../../solvers/atmosphere.js';
import { card, metricsGrid, insightsList, units, onUnits, unit, toDisp, fromDisp, show, num, canvasBox } from './common.js';
import { perf, ac, W, aircraftSection, axes, showTime } from './perfShared.js';

const FT = 0.3048;
const TARGET = { c172: [8000, 0.17], glider: [3000, 0.1], a320: [35000, 0.78], cca: [35000, 0.75], f16: [36000, 1.5] };

export function envelopeTab({ keep = o => o } = {}) {
  const S = keep({ heat: true, he: true, path: true, tz: 0, tM: 0, hover: null, forId: null });
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });
  let R = null, seen = -1;
  const acSec = aircraftSection(src => { if (src === 'aircraft') { resetTarget(); buildTarget(); } schedule(); });
  const tSec = section('Climb target');
  let tzS, tMS;
  function resetTarget() { const t = TARGET[perf.id]; S.tz = geometric(t[0] * FT); S.tM = t[1]; S.forId = perf.id; }
  function buildTarget() {
    const a = ac();
    tzS = slider({ label: `Pressure altitude (${unit('alt').u})`, min: 0, max: Math.round(toDisp('alt', geopotential(a.plot.zMax))), step: units() === 'us' ? 500 : 100, value: toDisp('alt', geopotential(S.tz)), format: v => num(+v, 0), onInput: v => { S.tz = geometric(fromDisp('alt', v)); schedule(); } });
    tMS = slider({ label: 'Mach', min: 0.05, max: a.plot.Mmax, step: 0.01, value: S.tM, digits: 2, onInput: v => { S.tM = v; schedule(); } });
    tSec.body.replaceChildren(tzS.el, tMS.el, h('div', { class: 'hint' }, 'Or click the map. The path is the fastest way to gain that much total energy (height plus speed).'));
  }
  resetTarget(); buildTarget();
  const lSec = section('Layers', { collapsible: true });
  lSec.body.append(toggle('Ps colour map', S.heat, v => { S.heat = v; map.paint(); }).el, toggle('Energy-height lines', S.he, v => { S.he = v; map.paint(); }).el, toggle('Minimum-time climb path', S.path, v => { S.path = v; map.paint(); }).el);
  controls.append(acSec.el, tSec.el, lSec.el);

  const metrics = metricsGrid();
  const map = canvasBox('560px', drawMap, 'flt-map');
  const legendEl = h('div', { class: 'flt-legend' });
  const paintLegend = () => {
    const items = [[cssVar('--text'), 'Ps = 0: level-flight envelope', 'solid'], ['#9aa3b2', `Ps contours every ${show('gust', R.psStep, 0)}`, 'solid'], [cssVar('--bad'), 'stall (1 g)', 'solid'], [cssVar('--warn'), 'speed limits', 'dashed'], [cssVar('--text-3'), 'constant energy height', 'dashed'], ...(S.path && R.climb ? [['#ffd34d', 'minimum-time climb', 'solid']] : [])];
    legendEl.replaceChildren(...items.map(([col, t, st]) => h('span', {}, h('i', { style: { borderTop: `3px ${st} ${col}` } }), t)));
  };
  const mapCard = card('Flight envelope and specific excess power', 'Colour: Ps = (T − D)·V/W in level 1 g flight, the rate the aircraft can gain energy height. Where Ps < 0 it cannot hold that speed and altitude. Dashed curves: constant energy height He = h + V²/2g (trading height for speed along them is free). Click to set the climb target.', map.el, legendEl);
  const sliceHost = h('div', { class: 'plot' });
  const sliceCard = card('Ps against Mach at several altitudes', 'Horizontal slices through the map.', sliceHost);
  const slices = new Plot(sliceHost, { legend: true, xname: 'M', yname: 'Ps' });
  const timeHost = h('div', { class: 'plot' });
  const timeCard = card('Along the climb path', 'Altitude and Mach against time on the minimum-time energy climb.', timeHost);
  const tplot = new Plot(timeHost, { legend: true, xname: 't', yname: 'value' });
  const insCard = card('What is happening here'); const ins = h('div'); insCard.append(ins);
  main.append(metrics.el, mapCard, h('div', { class: 'flt-grid2e' }, sliceCard, timeCard, insCard));

  let raf = 0;
  const schedule = () => { clearTimeout(raf); raf = setTimeout(compute, 16); };

  function compute() {
    if (S.forId !== perf.id) { resetTarget(); buildTarget(); }
    const a = ac(), w = W(), r = perf.rating, Mmax = a.plot.Mmax, zMax = a.plot.zMax;
    const grid = P.psMap(a, { W: w, dT: perf.dT, rating: r, Mmax, zMax, nx: 110, ny: 80 });
    let best = { Ps: -Infinity }, top = { z: 0 }, fast = { M: 0 };
    grid.zs.forEach((z, j) => grid.Ms.forEach((M, i) => { const v = grid.Ps[j][i]; if (!(v > 0)) return; if (v > best.Ps) best = { Ps: v, M, z }; if (z > top.z) top = { z, M }; if (M > fast.M) fast = { M, z }; }));
    const climb = a.engine === 'none' ? null : P.energyClimb(a, { W: w, dT: perf.dT, rating: r, z1: S.tz, M1: S.tM });
    R = { a, w, r, grid, best, top, fast, climb, Mmax, zMax }; seen = perf.version;
    const tA = atmosphere(S.tz, perf.dT), He1 = P.energyHeight(S.tz, S.tM * tA.a);
    const lim = a.limits.Mmax || a.limits.MMO;
    metrics.set([
      { k: 'Fastest (Ps = 0)', v: fast.M ? `M ${fast.M.toFixed(2)}` : '—', s: fast.M ? `at ${show('alt', geopotential(fast.z))}${lim && fast.M > lim ? ` · limited to M ${lim}` : ''}` : '' },
      { k: 'Highest (Ps = 0)', v: top.z ? (top.z >= zMax * 0.999 ? '≥ ' : '') + show('alt', geopotential(top.z)) : '—', s: top.z ? `at M ${top.M.toFixed(2)}` : '', tip: 'Highest point of the level-flight envelope: the absolute ceiling.' },
      { k: 'Max Ps', v: isFinite(best.Ps) ? show('gust', best.Ps, 0) : '—', s: isFinite(best.Ps) ? `M ${best.M.toFixed(2)} at ${show('alt', geopotential(best.z))}` : 'unpowered', tip: 'Specific excess power: climb rate available if all the excess thrust went into climbing, at constant speed.' },
      { k: 'Target energy height', v: show('alt', He1), s: `${show('alt', geopotential(S.tz))} at M ${S.tM.toFixed(2)}` },
      { k: 'Min time to target', v: climb ? showTime(climb.time) : '—', s: climb ? (isFinite(climb.time) ? 'energy climb (Rutowski)' : 'beyond the envelope') : 'no engine', cls: climb && !isFinite(climb.time) ? 'bad' : '' },
    ]);
    map.paint(); drawSlices(); drawTime(); insights();
  }

  function drawMap(c, Wd, Hd) {
    if (!R) return;
    const { a, grid, Mmax, zMax } = R, zk = z => toDisp('alt', geopotential(z)) / 1000;
    const tr = axes(c, Wd, Hd, { x0: 0, x1: Mmax, y0: 0, y1: zk(zMax), xlabel: 'Mach number', ylabel: units() === 'us' ? 'Pressure altitude (1,000 ft)' : 'Pressure altitude (km)', xfmt: v => v.toFixed(2), yfmt: v => num(v, 0) });
    R.tr = tr;
    const nx = grid.Ms.length, ny = grid.zs.length;
    let pmax = 0; for (const row of grid.Ps) for (const v of row) if (v > pmax) pmax = v;
    tr.clip();
    if (S.heat && pmax > 0) {
      const off = document.createElement('canvas'); off.width = nx; off.height = ny;
      const g2 = off.getContext('2d'), img = g2.createImageData(nx, ny);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const v = grid.Ps[j][i], k = ((ny - 1 - j) * nx + i) * 4;
        if (!(v > 0)) { img.data[k + 3] = isFinite(v) ? 26 : 0; img.data[k] = img.data[k + 1] = img.data[k + 2] = 128; continue; }
        const [rr, gg, bb] = ramp(Math.sqrt(v / pmax)); img.data[k] = rr; img.data[k + 1] = gg; img.data[k + 2] = bb; img.data[k + 3] = 170;
      }
      g2.putImageData(img, 0, 0);
      const x0 = tr.sx(grid.Ms[0]), x1 = tr.sx(grid.Ms[nx - 1]), y0 = tr.sy(zk(grid.zs[ny - 1])), y1 = tr.sy(zk(grid.zs[0]));
      c.imageSmoothingEnabled = true; c.drawImage(off, x0, y0, x1 - x0, y1 - y0);
    }
    // Ps contours (marching squares), with Ps = 0 as the bold envelope
    const kg = toDisp('gust', 1), step = niceStep((pmax * kg) / 5 || 1) / kg, levels = [0]; R.psStep = step;   // round in the units shown
    for (let L = step; L < pmax; L += step) levels.push(L);
    for (const L of levels) {
      const segs = contour(grid, L), col = L === 0 ? cssVar('--text') : 'rgba(255,255,255,0.75)';
      c.strokeStyle = col; c.lineWidth = L === 0 ? 2.6 : 1; c.beginPath();
      for (const [m0, z0, m1, z1] of segs) { c.moveTo(tr.sx(m0), tr.sy(zk(z0))); c.lineTo(tr.sx(m1), tr.sy(zk(z1))); }
      c.stroke();
      if (L > 0 && segs.length) { const sgm = segs[Math.floor(segs.length * 0.62)]; c.fillStyle = '#fff'; c.font = '10px ' + cssVar('--font'); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(units() === 'us' ? num(L / FT, 0) : num(L, 0), tr.sx(sgm[0]), tr.sy(zk(sgm[1]))); }
    }
    // energy-height lines
    if (S.he) {
      const top = P.energyHeight(zMax, Mmax * atmosphere(zMax).a), ka = toDisp('alt', 1), heStep = niceStep(top * ka / 7) / ka;
      for (let He = heStep; He < top; He += heStep) {
        const pts = []; for (let k = 0; k <= 80; k++) { const z = Math.min(He, zMax) * k / 80, at = atmosphere(z, perf.dT), V = Math.sqrt(Math.max(0, 2 * G0 * (He - z))); pts.push([V / at.a, zk(z)]); }
        tr.line(pts, cssVar('--text-3'), 1, [5, 5], 0.9);
        const lab = [...pts].reverse().find(p => p[0] <= Mmax * 0.9 && p[0] >= Mmax * 0.04 && p[1] < zk(zMax) * 0.95);  // highest visible point
        if (lab) tr.text(lab[0], lab[1], ` He ${show('alt', He)}`, cssVar('--text-3'), 'left', 'bottom', '10px');
      }
    }
    // limits: stall (1 g, CLmax), dynamic pressure, Mach
    const stall = [], qlim = [];
    for (let k = 0; k <= 80; k++) { const z = zMax * k / 80, at = atmosphere(z, perf.dT); stall.push([P.stallSpeed(a, at, R.w) / at.a, zk(z)]); const Ve = a.limits.VNE ?? a.limits.VD; qlim.push([Ve / Math.sqrt(at.sigma) / at.a, zk(z)]); }
    tr.line(stall, cssVar('--bad'), 2.2); tr.text(stall[Math.floor(stall.length * 0.35)][0], stall[Math.floor(stall.length * 0.35)][1], ' stall', cssVar('--bad'), 'left', 'middle', '600 11px');
    tr.line(qlim, cssVar('--warn'), 2, [6, 3]); const ql = qlim.find(p => p[0] < Mmax * 0.97 && p[1] > zk(zMax) * 0.2); if (ql) tr.text(ql[0], ql[1], `${a.limits.VNE ? 'VNE' : 'VD'} ${show('speed', a.limits.VNE ?? a.limits.VD, 0)} EAS `, cssVar('--warn'), 'right', 'middle', '600 10.5px');
    const ml = a.limits.Mmax || a.limits.MD; if (ml && ml < Mmax) { tr.line([[ml, 0], [ml, 999]], cssVar('--warn'), 2, [6, 3]); tr.text(ml, zk(zMax) * 0.96, ` M ${ml}`, cssVar('--warn'), 'left', 'middle', '600 10.5px'); }
    // climb path
    const cl = R.climb;
    if (S.path && cl && cl.path.length) {
      const pts = cl.path.map(p => [p.M, zk(p.z)]);
      tr.line(pts, '#ffd34d', 3.2);
      const last = cl.path[cl.path.length - 1];
      if (isFinite(cl.time)) tr.line([[last.M, zk(last.z)], [S.tM, zk(S.tz)]], '#ffd34d', 2, [3, 3]);   // zoom or dive at constant energy
      tr.dot(pts[0][0], pts[0][1], '#ffd34d', 4);
    }
    tr.dot(S.tM, zk(S.tz), cssVar('--accent'), 6); tr.text(S.tM, zk(S.tz), '  target', cssVar('--text'), 'left', 'bottom', '600 11px');
    if (S.hover) { const hv = S.hover; c.strokeStyle = cssVar('--text-3'); c.setLineDash([3, 3]); c.lineWidth = 1; c.beginPath(); c.moveTo(tr.sx(hv.M), tr.pt); c.lineTo(tr.sx(hv.M), tr.pt + tr.ih); c.moveTo(tr.pl, tr.sy(zk(hv.z))); c.lineTo(tr.pl + tr.iw, tr.sy(zk(hv.z))); c.stroke(); c.setLineDash([]); }
    c.restore();
    paintLegend();
    if (S.hover) {
      const hv = S.hover, at = atmosphere(hv.z, perf.dT), V = hv.M * at.a, s = P.state(a, at, V, R.w, R.r);
      const txt = `M ${hv.M.toFixed(2)} · ${show('alt', geopotential(hv.z))} · Ps ${s.stalled ? 'stalled' : show('gust', s.Ps, 0)} · He ${show('alt', P.energyHeight(hv.z, V))}`;
      c.font = '11px ' + cssVar('--mono'); const tw = c.measureText(txt).width + 12;
      c.fillStyle = cssVar('--bg-elev'); c.strokeStyle = cssVar('--border-strong'); c.lineWidth = 1; c.beginPath(); c.roundRect(tr.pl + 8, tr.pt + tr.ih - 28, tw, 20, 5); c.fill(); c.stroke();
      c.fillStyle = cssVar('--text'); c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(txt, tr.pl + 14, tr.pt + tr.ih - 18);
    }
  }
  const fromEvent = e => { const r = map.canvas.getBoundingClientRect(), tr = R && R.tr; if (!tr) return null; const M = tr.ix(e.clientX - r.left), zd = tr.iy(e.clientY - r.top) * 1000; if (M < 0 || M > R.Mmax || zd < 0) return null; return { M, z: geometric(fromDisp('alt', zd)) }; };
  map.canvas.addEventListener('pointermove', e => { S.hover = fromEvent(e); map.paint(); });
  map.canvas.addEventListener('pointerleave', () => { S.hover = null; map.paint(); });
  map.canvas.addEventListener('click', e => { const p = fromEvent(e); if (!p || p.z > R.zMax) return; S.tM = +p.M.toFixed(2); S.tz = p.z; tzS.set(toDisp('alt', geopotential(S.tz))); tMS.set(S.tM); schedule(); });

  function drawSlices() {
    const { a, grid } = R, k = units() === 'us' ? 1 / FT : 1;
    const want = units() === 'us' ? [0, 10000, 20000, 30000, 40000, 50000].map(f => geometric(f * FT)) : [0, 3000, 6000, 9000, 12000, 15000].map(geometric);
    const pal = [cssVar('--lower'), cssVar('--warn'), cssVar('--good'), cssVar('--accent'), cssVar('--turb'), cssVar('--bad')];
    const series = want.filter(z => z <= R.zMax).map((z, i) => { const at = atmosphere(z, perf.dT); const ys = grid.Ms.map(M => { const s = P.state(a, at, M * at.a, R.w, R.r); return s.stalled ? NaN : s.Ps * k; }); return { x: grid.Ms, y: ys, color: pal[i], label: show('alt', geopotential(z)) }; });
    slices.setOpts({ xlabel: 'Mach number', ylabel: `Ps (${unit('gust').u})`, xfmt: v => v.toFixed(2), yfmt: v => num(v, 0) });
    slices.setData({ series, hlines: [{ y: 0, color: cssVar('--text-3'), dash: [3, 3] }] });
  }
  function drawTime() {
    const cl = R.climb;
    timeCard.style.display = cl ? '' : 'none';
    if (!cl || !cl.path.length) return;
    const t = cl.path.map(p => p.t), zz = cl.path.map(p => toDisp('alt', geopotential(p.z)) / 1000), mm = cl.path.map(p => p.M * 10);
    tplot.setOpts({ xlabel: 'Time (s)', ylabel: units() === 'us' ? 'Altitude (1,000 ft) · Mach × 10' : 'Altitude (km) · Mach × 10', xfmt: v => v.toFixed(1), yfmt: v => v.toFixed(2) });
    tplot.setData({ series: [{ x: t, y: zz, color: '#e0a800', label: 'altitude' }, { x: t, y: mm, color: cssVar('--accent'), label: 'Mach × 10' }] });
  }
  function insights() {
    const { a, climb } = R, L = [];
    if (a.engine === 'none') { L.push({ type: 'i', t: 'No engine: Ps is negative everywhere', d: 'A glider can only trade energy height for speed (or lose it to drag); it gains energy from rising air, not thrust.' }); insightsList(ins, L); return; }
    L.push({ type: 'i', t: 'Energy height', d: 'He = h + V²/2g is the height the aircraft could reach by trading all its speed for altitude. Thrust minus drag changes He at the rate Ps; zooming up or diving along a dashed He line costs nothing (ideally).' });
    if (climb && isFinite(climb.time)) L.push({ type: 'g', t: `Minimum-time climb: ${showTime(climb.time)}`, d: 'At each energy level the path flies where Ps is largest (where the dashed He line touches the highest Ps contour). Then it zooms or dives along a He line to the target.' });
    else if (climb) L.push({ type: 'b', t: 'Target is outside the reachable envelope', d: 'Somewhere on the way Ps falls to zero at every point of that energy level, so the aircraft cannot accumulate that much energy in steady flight.' });
    if (a.wave) L.push({ type: 'w', t: 'The transonic dive', d: 'Wave drag near Mach 1 pinches the Ps contours. The fastest way to supersonic speed at altitude is often to climb subsonic, then dive through Mach 1 where the air is denser and thrust larger, and climb again (Rutowski, 1954).' });
    if (a.engine === 'hbp') L.push({ type: 'i', t: 'Airliners: a narrow corner at the top', d: 'At cruise altitude the envelope narrows between the stall (low-speed buffet) and Mach limits: the "coffin corner". Climbing higher at a given weight shrinks it further.' });
    insightsList(ins, L);
  }

  const offU = onUnits(() => { acSec.rebuild(); buildTarget(); schedule(); });
  compute();
  return {
    controls, main,
    show: () => { if (seen !== perf.version) { acSec.rebuild(); compute(); } else { map.paint(); slices.draw(); tplot.draw(); } },
    destroy: () => { offU(); clearTimeout(raf); },
  };
}

function niceStep(x) { const p = 10 ** Math.floor(Math.log10(x)), f = x / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; }
// dark blue → blue → green → yellow → orange
function ramp(t) {
  const stops = [[0, [30, 58, 138]], [0.3, [37, 99, 235]], [0.55, [16, 185, 129]], [0.8, [250, 204, 21]], [1, [249, 115, 22]]];
  for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) { const [a, ca] = stops[i - 1], [b, cb] = stops[i], u = (t - a) / (b - a); return ca.map((v, k) => Math.round(v + (cb[k] - v) * u)); }
  return stops[stops.length - 1][1];
}
// Marching squares: line segments [M0, z0, M1, z1] where the grid crosses level L (NaN cells skipped)
function contour({ Ms, zs, Ps }, L) {
  const segs = [];
  for (let j = 0; j + 1 < zs.length; j++) for (let i = 0; i + 1 < Ms.length; i++) {
    const v = [Ps[j][i], Ps[j][i + 1], Ps[j + 1][i + 1], Ps[j + 1][i]];
    const p = [[Ms[i], zs[j]], [Ms[i + 1], zs[j]], [Ms[i + 1], zs[j + 1]], [Ms[i], zs[j + 1]]];
    const vv = v.map(x => (isFinite(x) ? x : -1e9));       // stalled cells count as "below"
    const pts = [];
    for (let e = 0; e < 4; e++) {
      const a = vv[e], b = vv[(e + 1) % 4];
      if ((a >= L) !== (b >= L)) { const t = (L - a) / (b - a), A = p[e], B = p[(e + 1) % 4]; pts.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]); }
    }
    if (pts.length === 2) segs.push([...pts[0], ...pts[1]]);
    else if (pts.length === 4) segs.push([...pts[0], ...pts[1]], [...pts[2], ...pts[3]]);
  }
  return segs;
}
