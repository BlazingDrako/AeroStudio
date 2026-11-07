// INS & GNSS tab, three tools. Inertial drift: how an INS's position error grows from its sensor errors (the 84-minute
// Schuler oscillation, Earth-rate coupling, alignment and the unstable vertical channel). GNSS fix: a GPS
// constellation on a sky plot, the least-squares fix with its receiver clock bias, and dilution of precision.
// INS + GNSS: a Kalman filter blending the two, with a GNSS outage, covariance ellipses and bias estimates.
import { h, section, slider, segmented, select, field, cssVar, icon } from '../../lib/ui.js';
import * as I from '../../solvers/ins.js';
import { card, metricsGrid, insightsList, onUnits, units, num, canvasBox } from '../flight/common.js';
import { axes, legend } from '../flight/perfShared.js';
import { f3 } from './plots.js';

const D = Math.PI / 180, DEG = 180 / Math.PI, FT = 0.3048, NM = 1852, HR = 3600, AM = D / 60;
const PLACES = [
  ['JFK', 'New York', 40.64, -73.78], ['LHR', 'London', 51.47, -0.45], ['SIN', 'Singapore (equator)', 1.36, 103.99], ['SYD', 'Sydney', -33.95, 151.18],
  ['ANC', 'Anchorage', 61.17, -149.99], ['KEF', 'Reykjavík', 63.99, -22.62], ['LYR', 'Svalbard (78°N)', 78.25, 15.47], ['MCM', 'McMurdo, Antarctica (78°S)', -77.85, 166.67],
];
const us = () => units() === 'us';
const bigU = () => (us() ? NM : 1000), bigL = () => (us() ? 'nm' : 'km');
const smU = () => (us() ? FT : 1), smL = () => (us() ? 'ft' : 'm');
// a length in the most readable unit: feet/metres when small, nautical miles/kilometres when large
const len = m => { const a = Math.abs(m); if (us()) return a < NM ? `${num(m / FT, a / FT < 10 ? 1 : 0)} ft` : `${f3(m / NM)} nm`; return a < 1000 ? `${num(m, a < 10 ? 1 : 0)} m` : `${f3(m / 1000)} km`; };
const CAP = 2e5, capLen = m => (Math.abs(m) > CAP ? `> ${len(CAP)}` : len(m));
const ang = r => { const a = Math.abs(r * DEG); return a >= 1 ? `${f3(r * DEG)}°` : a * 60 >= 1 ? `${f3(r * DEG * 60)}′` : `${f3(r * DEG * 3600)}″`; };
const sig2 = v => (v >= 100 ? num(v, 0) : v >= 10 ? num(v, 1) : v >= 1 ? num(v, 2) : +v.toPrecision(2) + '');
const short = v => { const a = Math.abs(v); return a >= 1e6 ? `${+(v / 1e6).toPrecision(2)}M` : a >= 1e3 ? `${+(v / 1e3).toPrecision(2)}k` : `${+v.toPrecision(2)}`; };
const shade = (c, tr, x0, x1, color, alpha = 0.1) => { c.save(); c.globalAlpha = alpha; c.fillStyle = color; c.fillRect(tr.sx(x0), tr.pt, tr.sx(x1) - tr.sx(x0), tr.ih); c.restore(); };
function band(c, tr, xs, lo, hi, color, alpha = 0.16) {
  c.save(); c.globalAlpha = alpha; c.fillStyle = color; c.beginPath();
  xs.forEach((x, i) => (i ? c.lineTo(tr.sx(x), tr.sy(hi[i])) : c.moveTo(tr.sx(x), tr.sy(hi[i]))));
  for (let i = xs.length - 1; i >= 0; i--) c.lineTo(tr.sx(xs[i]), tr.sy(lo[i]));
  c.closePath(); c.fill(); c.restore();
}
// axes with equal scales on x and y, centred on (cx, cy), at least ±ext in both
function eqAxes(c, W, H, ext, o, cx = 0, cy = 0) {
  const iw = W - (o.pl ?? 58) - 16, ih = H - 54, ex = iw >= ih ? ext * iw / ih : ext, ey = iw >= ih ? ext : ext * ih / iw;
  return axes(c, W, H, { x0: cx - ex, x1: cx + ex, y0: cy - ey, y1: cy + ey, ...o });
}
function ellipse(c, tr, cov, k, color, w = 1.8, dash = null, cx = 0, cy = 0) {
  const [a, b, d] = cov, m = (a + d) / 2, q = Math.sqrt(((a - d) / 2) ** 2 + b * b), l1 = Math.max(0, m + q), l2 = Math.max(0, m - q), th = 0.5 * Math.atan2(2 * b, a - d);
  const pts = []; for (let i = 0; i <= 72; i++) { const t = i / 72 * 2 * Math.PI, u = k * Math.sqrt(l1) * Math.cos(t), v = k * Math.sqrt(l2) * Math.sin(t); pts.push([cx + u * Math.cos(th) - v * Math.sin(th), cy + u * Math.sin(th) + v * Math.cos(th)]); }
  tr.line(pts, color, w, dash);
}
const logRange = vals => { const v = vals.filter(x => x > 0 && isFinite(x)); const lo = Math.floor(Math.log10(Math.max(1e-3, Math.min(...v)))), hi = Math.ceil(Math.log10(Math.max(...v)) + 0.05); return [lo, Math.max(hi, lo + 1)]; };
const lg = v => (v > 0 ? Math.log10(v) : NaN);

export function insTab({ keep = o => o } = {}) {
  const S = keep({ tool: 'ins',
    grade: 'nav', gyro: 0.01, accel: 50, lat: 45, hours: 6, aligned: true, earth: true,
    place: 'JFK', gt: 2, mask: 10, sigma: 5, clockUs: 100, off: [],
    kgrade: 'nav', ksig: 5, kdt: 1, oStart: 20, oLen: 15, kT: 60, man: true, seed: 3, kbias: 8 });
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });
  const toolSec = section('Tool');
  const toolSeg = segmented([{ value: 'ins', label: 'Inertial drift' }, { value: 'gnss', label: 'GNSS fix & DOP' }, { value: 'kf', label: 'INS + GNSS filter' }], S.tool, v => { S.tool = v; build(); });
  toolSeg.el.classList.add('seg-wrap');
  toolSec.body.append(toolSeg.el);
  const inSec = section('Inputs');
  controls.append(toolSec.el, inSec.el);
  const metrics = metricsGrid(), body = h('div'), insCard = card('What is happening here'), ins = h('div'), eqCard = card('Step by step'), eq = h('div');
  insCard.append(ins); eqCard.append(eq);
  main.append(metrics.el, body, h('div', { class: 'flt-grid2' }, insCard, eqCard));
  let R = null, canvases = [];
  const sl = (label, min, max, step, get, set, opts = {}) => slider({ label, min, max, step, value: get(), format: opts.fmt || (v => num(+v, opts.d ?? 0)), info: opts.info, onInput: v => { set(+v); compute(); } }).el;
  const seg = (label, opts, get, set, tip) => { const s = segmented(opts, get(), v => { set(v); compute(); }); s.el.classList.add('seg-wrap'); return field(label, s.el, tip); };
  const repaint = () => canvases.forEach(c => c.paint());
  const gradeOpts = Object.entries(I.GRADES).map(([k, g]) => ({ value: k, label: g.label }));

  function build() {
    if (S.tool === 'ins') buildIns(); else if (S.tool === 'gnss') buildGnss(); else buildKf();
    compute();
  }
  function compute() { if (S.tool === 'ins') computeIns(); else if (S.tool === 'gnss') computeGnss(); else computeKf(); repaint(); }

  // ================= Inertial drift =================
  let pc, tc, ac, vc;
  function buildIns() {
    const gyroSl = () => sl('Gyro bias (°/h, log scale)', -3, 2.5, 0.05, () => Math.log10(S.gyro), v => { S.gyro = 10 ** v; }, { fmt: v => `${sig2(10 ** v)} °/h`, info: 'A constant rate the gyros read when not turning. Earth turns at 15.04°/h. Applied to all three gyros.' });
    const accSl = () => sl('Accelerometer bias (µg, log scale)', 0, 4.3, 0.05, () => Math.log10(S.accel), v => { S.accel = 10 ** v; }, { fmt: v => `${sig2(10 ** v)} µg`, info: '1 µg = 9.8 µm/s². Applied to the north, east and vertical accelerometers.' });
    const sliders = h('div');
    const fillSliders = () => sliders.replaceChildren(gyroSl(), accSl());
    fillSliders();
    inSec.body.replaceChildren(
      field('Sensor grade', select(gradeOpts, S.grade, v => { S.grade = v; S.gyro = I.GRADES[v].gyro; S.accel = I.GRADES[v].accel; fillSliders(); compute(); }), 'Typical bias and noise for each class of inertial unit (Groves 2013). The sliders start at the grade\'s values; the random-walk noise always comes from the grade.'),
      sliders,
      sl('Latitude (°)', 0, 80, 1, () => S.lat, v => { S.lat = v; }, { info: 'Sets how Earth\'s rotation couples into the errors, and how well gyrocompassing finds north.' }),
      sl('Duration (h)', 1, 24, 1, () => S.hours, v => { S.hours = v; }),
      seg('Start', [{ value: true, label: 'Self-aligned' }, { value: false, label: 'Perfect attitude' }], () => S.aligned, v => { S.aligned = v; }, 'Self-aligned: the INS levels itself and finds north on the ground, which bakes the biases into the starting attitude (and cancels some of them). Perfect attitude: the biases act on an exactly right start.'),
      seg('Earth rotation', [{ value: true, label: 'On' }, { value: false, label: 'Off (textbook)' }], () => S.earth, v => { S.earth = v; }, 'Off gives the single-channel textbook results; on adds the 24-hour and Foucault coupling.'),
      h('div', { class: 'hint' }, 'A stationary or slow vehicle, body pointing north. The linear error model is only indicative once errors reach many kilometres.'));
    pc = canvasBox('300px', drawPos); tc = canvasBox('300px', drawTrack); ac = canvasBox('240px', drawAtt); vc = canvasBox('240px', drawVert);
    canvases = [pc, tc, ac, vc];
    body.replaceChildren(
      card('Position error', 'North and east error and their magnitude for these biases. Dashed: the 1σ radial error when the biases point in random directions, plus the sensor noise. Ticks mark Schuler periods (84.4 min).', pc.el),
      h('div', { class: 'flt-grid2' },
        card('The error seen from above', 'The tip of the position-error vector. The Schuler oscillation draws loops; Earth\'s rotation turns them slowly (the Foucault effect).', tc.el),
        card('Attitude errors', 'Tilts about north and east and the heading error. A tilt makes the accelerometers feel a sliver of gravity as acceleration.', ac.el)),
      card('The vertical channel', 'Altitude error from the vertical accelerometer\'s bias alone. Gravity weakens with height, so an altitude error feeds itself; a barometric altimeter keeps it bounded.', vc.el));
  }
  function computeIns() {
    const lat = S.lat * D, gy = S.gyro * D / HR, acc = S.accel * 1e-6 * I.G0, gsi = I.toSI(I.GRADES[S.grade]), T = S.hours * HR, dt = Math.max(5, Math.round(T / 1500 / 5) * 5);
    const run = I.insRun({ lat, T, dt, bias: [gy, gy, gy, acc, acc], aligned: S.aligned, earth: S.earth, sig: { gyro: gy, accel: acc, arw: gsi.arw, vrw: gsi.vrw } });
    const vu = I.vertical({ T: 3600, dt: 5, accel: acc }), vb = I.vertical({ T: 3600, dt: 5, accel: acc, baro: true, tau: 120 });
    const k1 = run.t.findIndex(t => t >= Math.min(T, HR)), rad = run.x.map(x => Math.hypot(x[0], x[1])), imax = rad.indexOf(Math.max(...rad));
    const v30 = vu.h[vu.t.findIndex(t => t >= 1800)], ts = 2 * Math.PI / I.SCHULER;
    R = { run, vu, vb, rad, T, lat, gy, acc };
    const rate = run.sr[k1] / (run.t[k1] / HR);
    metrics.set([
      { k: `Error after ${run.t[k1] >= HR ? '1 h' : S.hours + ' h'}`, v: capLen(rad[k1]), s: `these biases; ${capLen(run.sr[k1])} 1σ if random`, tip: 'Radial horizontal error, |δp|.', cls: rad[k1] > CAP ? 'bad' : '' },
      { k: 'Drift rate (1σ)', v: rate / NM > 100 ? '> 100 nm/h' : `${f3(rate / NM)} nm/h`, s: 'over the first hour; navigation grade is about 1 nm/h', tip: 'The 1σ radial error after an hour: the usual way an INS is specified.', cls: rate / NM < 2 ? 'good' : rate / NM > 20 ? 'bad' : '' },
      { k: 'Largest error', v: capLen(rad[imax]), s: rad[imax] > CAP ? 'the INS is simply lost' : `at ${f3(run.t[imax] / HR)} h`, cls: rad[imax] > CAP ? 'bad' : '' },
      { k: 'Schuler period', v: `${num(ts / 60, 1)} min`, s: '2π√(R/g): the period of a pendulum as long as the Earth\'s radius' },
      !S.aligned ? { k: 'Heading at the start', v: 'exact', s: 'perfect attitude chosen' } : { k: 'Heading after alignment', v: run.gyrocompass ? (S.earth ? ang(run.x[0][6]) : 'exact') : 'external', s: run.gyrocompass ? (S.earth ? 'gyrocompassing: εE/(Ω cos L)' : 'no Earth rate to find north by: taken as exact') : 'gyro bias too large to find north: 1° from outside', cls: run.gyrocompass ? '' : 'warn' },
      { k: 'Altitude error at 30 min', v: capLen(v30), s: `unaided; ${len(vb.h[vb.t.findIndex(t => t >= 1800)])} with baro aiding`, cls: v30 > 300 ? 'bad' : '' },
    ]);
    const L = [];
    const amp = 2 * acc / I.SCHULER ** 2;
    if (rad[imax] > CAP) L.push({ type: 'b', t: 'This INS is lost', d: `With these sensors the error passes ${len(CAP)} ${run.t[rad.findIndex(v => v > CAP)] < HR ? `within ${num(run.t[rad.findIndex(v => v > CAP)] / 60, 0)} minutes` : 'within hours'}. The plots follow the linear error model, which stops meaning anything long before the curves end: the INS has no idea where it is. Sensors of this class are only useful blended with GNSS, a camera or a magnetometer (see the INS + GNSS filter).` });
    if (!S.aligned) L.push({ type: 'i', t: `An accelerometer bias gives a bounded error: up to ${len(amp)}`, d: `You might expect a constant acceleration error to grow as ½∇t². Instead the INS tilts: the position error makes it think it is somewhere else on the curved Earth, where "down" points differently, and gravity then pushes the error back. The result is an oscillation of period 2π√(R/g) = 84.4 min and peak 2∇R/g. Max Schuler (1923) showed a gyrocompass tuned this way ignores the ship's accelerations.` });
    else L.push({ type: 'g', t: 'Alignment cancels the accelerometer biases', d: `On the ground the INS levels itself by nulling what its accelerometers read sideways, so it settles with exactly the tilt that hides each accelerometer bias (∇/g = ${ang(acc / I.G0)} here). The bias and the tilt then cancel in flight, and the horizontal error comes from the gyros.${S.earth ? ' With Earth rotation on, the tilted platform resolves Earth\'s spin slightly wrongly, which acts like a small extra gyro drift.' : ''}` });
    L.push({ type: rate / NM > 20 ? 'b' : rate / NM > 2 ? 'w' : 'g', t: `Gyro drift makes the error grow: about ${f3(I.R_E * gy * HR / NM)} nm per hour`, d: `A gyro bias ε tilts the computed vertical steadily, so the error grows as R·ε·t with the Schuler wiggle on top: 0.6 nm/h for each 0.01°/h. Airliners' ring-laser units (0.01°/h) cross an ocean with a few miles of error; a phone-grade MEMS gyro (100°/h and more) would be lost by kilometres within minutes.` });
    if (S.aligned && !run.gyrocompass) L.push({ type: 'w', t: 'Too much gyro bias to find north', d: `Gyrocompassing finds north by sensing Earth's rotation, 15°/h × cos(latitude) on the horizontal. With a ${sig2(S.gyro)}°/h bias the heading would be off by ${ang(I.gyrocompassError(lat, gy))}: useless. Units like this take heading from a magnetometer, a transfer alignment from the aircraft, or GNSS while moving; here it is assumed good to 1°.` });
    else if (S.aligned && S.earth) L.push({ type: 'i', t: `Gyrocompassing leaves a ${ang(run.x[0][6])} heading error`, d: 'The INS finds north by sensing the horizontal part of Earth\'s rotation. An east gyro bias looks like a slightly different north, giving a heading error εE/(Ω cos L). It grows towards the poles, where there is little horizontal Earth rate to measure: at 80° it is 5.8 times the equator\'s value.' });
    if (S.earth) L.push({ type: 'i', t: `Earth's rotation turns the loops once every ${f3(2 * Math.PI / (I.OMEGA_E * Math.sin(lat)) / HR)} h`, d: `Coriolis acceleration acts on the velocity error just as on a Foucault pendulum, rotating the Schuler oscillation at Ω·sin(latitude): the two frequencies ωs ± Ω sin L beat. A third, 24-hour mode comes from the attitude errors resolving Earth's rotation wrongly.${S.lat < 1 ? ' At the equator there is no rotation of the loops.' : ''}` });
    L.push({ type: v30 > 300 ? 'b' : 'w', t: `Without a barometer the altitude error is ${capLen(v30)} after 30 minutes`, d: `Gravity falls by about 3 µg per metre of height. If the INS thinks it is too high, it computes too little gravity, reads the difference as climbing, and climbs further: the error grows as cosh(t/τ) with τ = √(R/2g) = 9.5 min. Every aircraft INS therefore blends in barometric altitude (here a second-order loop with a 2-minute time constant), and the error stays at ${len(vb.h[vb.h.length - 1])}.` });
    insightsList(ins, L);
    const t1 = Math.min(T, HR);
    eq.replaceChildren(h('span', { class: 'eq', html: [
      `Schuler frequency ωs = √(g/R) = √(${I.G0} / ${num(I.R_E, 0)}) = ${(I.SCHULER * 1e3).toFixed(4)}×10⁻³ rad/s, period ${num(ts / 60, 2)} min`,
      `Accelerometer bias, perfect start: δp = (∇/ωs²)(1 − cos ωs t) → peak 2∇R/g = ${len(amp)}`,
      `Gyro drift: δp = −Rε(t − sin ωs t / ωs) → at ${f3(t1 / HR)} h: ${len(I.R_E * gy * (t1 - Math.sin(I.SCHULER * t1) / I.SCHULER))}`,
      `Initial tilt φ: δp = Rφ(1 − cos ωs t);  initial velocity error δv: δp = δv·sin(ωs t)/ωs`,
      `Levelling: φN = ∇E/g, φE = −∇N/g = ${ang(acc / I.G0)};  gyrocompassing: ψ = εE/(Ω cos L) = ${ang(I.gyrocompassError(lat, gy))}`,
      `Vertical: δḧ = (2g/R)δh + ∇ → δh = ∇τ²(cosh(t/τ) − 1), τ = √(R/2g) = ${num(vu.tau / 60, 2)} min`,
      `Error state (12): δpN, δpE, δvN, δvE, φN, φE, ψ, three gyro and two accelerometer biases; propagated exactly with Φ = e^(FΔt), Δt = ${dt} s`,
    ].join('<br>') }));
  }
  function drawPos(c, W, H) {
    if (!R) return;
    const { run, rad } = R, u = bigU(), th = run.t.map(t => t / HR), nN = run.x.map(x => x[0] / u), nE = run.x.map(x => x[1] / u), rr = rad.map(v => v / u), sr = run.sr.map(v => v / u);
    const ymax = Math.max(...rr, ...sr) * 1.08 || 1, ymin = Math.min(0, ...nN, ...nE) * 1.08;
    const tr = axes(c, W, H, { x0: 0, x1: R.T / HR, y0: ymin, y1: ymax, xlabel: 'Time (h)', ylabel: `Position error (${bigL()})`, xfmt: v => num(v, 0), yfmt: v => f3(v) });
    tr.clip();
    const ts = 2 * Math.PI / I.SCHULER / HR; c.strokeStyle = cssVar('--text-3'); c.globalAlpha = 0.5;
    for (let k = 1; k * ts < R.T / HR; k++) { c.beginPath(); c.moveTo(tr.sx(k * ts), tr.pt + tr.ih - 8); c.lineTo(tr.sx(k * ts), tr.pt + tr.ih); c.stroke(); }
    c.globalAlpha = 1;
    tr.line(th.map((t, i) => [t, sr[i]]), cssVar('--text-3'), 1.6, [5, 4]);
    tr.line(th.map((t, i) => [t, nN[i]]), cssVar('--good'), 1.5);
    tr.line(th.map((t, i) => [t, nE[i]]), cssVar('--warn'), 1.5);
    tr.line(th.map((t, i) => [t, rr[i]]), cssVar('--accent'), 2.4);
    c.restore();
    legend(c, tr, [[cssVar('--accent'), '|error|', null, 2.4], [cssVar('--good'), 'north', null, 1.5], [cssVar('--warn'), 'east', null, 1.5], [cssVar('--text-3'), '1σ, random biases', [5, 4], 1.6]]);
  }
  function drawTrack(c, W, H) {
    if (!R) return;
    const u = bigU(), pts = R.run.x.map(x => [x[1] / u, x[0] / u]), xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2, ext = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 * 1.12 || 1;
    const tr = eqAxes(c, W, H, ext, { xlabel: `East error (${bigL()})`, ylabel: `North error (${bigL()})`, xfmt: v => f3(v), yfmt: v => f3(v) }, cx, cy);
    tr.clip(); tr.line(pts, cssVar('--accent'), 1.6); c.restore();
    tr.dot(0, 0, cssVar('--text-3'), 4); tr.dot(pts[pts.length - 1][0], pts[pts.length - 1][1], cssVar('--accent'), 5);
    tr.text(pts[pts.length - 1][0], pts[pts.length - 1][1], `  ${S.hours} h`, cssVar('--text-2'));
  }
  function drawAtt(c, W, H) {
    if (!R) return;
    const run = R.run, th = run.t.map(t => t / HR), s = run.x.map(x => [x[4], x[5], x[6]]), mx = Math.max(...s.flat().map(Math.abs)) || AM;
    const unit = mx >= 2 * D ? D : mx >= 2 * AM ? AM : AM / 60, ul = unit === D ? '°' : unit === AM ? 'arcmin' : 'arcsec';
    const ymax = mx / unit * 1.1;
    const tr = axes(c, W, H, { x0: 0, x1: R.T / HR, y0: -ymax, y1: ymax, xlabel: 'Time (h)', ylabel: `Attitude error (${ul})`, xfmt: v => num(v, 0), yfmt: v => f3(v) });
    tr.clip();
    tr.line(th.map((t, i) => [t, s[i][0] / unit]), cssVar('--good'), 1.5);
    tr.line(th.map((t, i) => [t, s[i][1] / unit]), cssVar('--warn'), 1.5);
    tr.line(th.map((t, i) => [t, s[i][2] / unit]), cssVar('--accent'), 2.2);
    c.restore();
    legend(c, tr, [[cssVar('--accent'), 'heading ψ', null, 2.2], [cssVar('--good'), 'tilt about north', null, 1.5], [cssVar('--warn'), 'tilt about east', null, 1.5]], tr.pl + tr.iw - 140);
  }
  function drawVert(c, W, H) {
    if (!R) return;
    const u = smU(), A = R.vu.t.map((t, i) => [t / 60, lg(Math.abs(R.vu.h[i]) / u)]), B = R.vb.t.map((t, i) => [t / 60, lg(Math.abs(R.vb.h[i]) / u)]);
    const [y0, y1] = logRange([...A, ...B].map(p => 10 ** p[1]).filter(v => v > 1e-2));
    const tr = axes(c, W, H, { x0: 0, x1: 60, y0, y1, ystep: 1, xlabel: 'Time (min)', ylabel: `Altitude error (${smL()}, log)`, xfmt: v => num(v, 0), yfmt: v => short(10 ** v) });
    tr.clip(); tr.line(A, cssVar('--bad'), 2.2); tr.line(B, cssVar('--good'), 2.2); c.restore();
    legend(c, tr, [[cssVar('--bad'), 'inertial only', null, 2.2], [cssVar('--good'), 'baro-aided', null, 2.2]]);
  }

  // ================= GNSS fix & DOP =================
  let sky, fx, dc, dopCache = null;
  const place = () => PLACES.find(p => p[0] === S.place);
  function buildGnss() {
    inSec.body.replaceChildren(
      field('Receiver location', select(PLACES.map(p => ({ value: p[0], label: p[1] })), S.place, v => { S.place = v; S.off = []; dopCache = null; compute(); })),
      sl('Time (h)', 0, 24, 0.05, () => S.gt, v => { S.gt = v; }, { fmt: v => `${num(+v, 2)} h`, info: 'Hours from the constellation\'s reference epoch. The pattern repeats every sidereal day (23 h 56 min).' }),
      sl('Elevation mask (°)', 0, 40, 1, () => S.mask, v => { S.mask = v; dopCache = null; }, { info: 'Satellites below this elevation are ignored: terrain, buildings, the aircraft\'s own wing in a bank, and the long noisy path through the atmosphere near the horizon.' }),
      sl(`Range error σ (${smL()})`, 0.5 / smU(), 20 / smU(), 0.5, () => S.sigma / smU(), v => { S.sigma = v * smU(); }, { d: 1, info: 'User equivalent range error: the 1σ error of each pseudorange (ionosphere, troposphere, clocks, orbits, multipath, noise). About 5 m for single-frequency GPS without corrections.' }),
      sl('Receiver clock error (µs)', -1000, 1000, 10, () => S.clockUs, v => { S.clockUs = v; }, { info: 'The receiver\'s cheap quartz clock is off by this much. Light covers 300 m per microsecond, so every pseudorange is off by the same large amount.' }),
      h('button', { class: 'btn', type: 'button', onclick: () => { S.off = []; dopCache = null; compute(); } }, icon('reset', 14), 'Use all satellites'),
      h('div', { class: 'hint' }, 'Click a satellite on the sky plot to switch it off or on. A nominal 24-satellite constellation on circular orbits; no ionosphere or troposphere model.'));
    sky = canvasBox('360px', drawSky); fx = canvasBox('360px', drawFix); dc = canvasBox('250px', drawDop);
    canvases = [sky, fx, dc];
    sky.canvas.style.cursor = 'pointer';
    sky.canvas.addEventListener('click', e => {
      if (!R || !R.ep) return;
      const b = sky.canvas.getBoundingClientRect(), mx = e.clientX - b.left, my = e.clientY - b.top, g = skyGeom(b.width, b.height);
      let best = null, bd = 16;
      for (const s of R.ep.all) { if (s.el < 0) continue; const [x, y] = g.xy(s.az, s.el), d = Math.hypot(x - mx, y - my); if (d < bd) { bd = d; best = s; } }
      if (!best || !best.visible) return;
      S.off = S.off.includes(best.id) ? S.off.filter(i => i !== best.id) : [...S.off, best.id]; dopCache = null; compute();
    });
    body.replaceChildren(h('div', { class: 'flt-grid2' },
      card('Sky plot', 'Looking up: the centre is overhead, the rim is the horizon, north at the top. Filled: used in the fix. Hollow: switched off. Faint: below the mask. Tails show the next hour of motion.', sky.el),
      card('Where the fixes land', 'Each dot is one fix from a fresh set of noisy pseudoranges. Ellipses: 1σ and 2σ predicted from the geometry, σ·√(DOP matrix). The big dot is the fix the step-by-step uses.', fx.el)),
      card('Dilution of precision over the day', 'How much the geometry multiplies the range error, for this place, mask and set of satellites. The line marks the chosen time.', dc.el));
  }
  function computeGnss() {
    const p = place(), lat = p[2] * D, lon = p[3] * D, mask = S.mask * D;
    const ep = I.gnssEpoch({ lat, lon, h: 0, t: S.gt * HR, mask, sigma: S.sigma, clock: S.clockUs * 1e-6, off: S.off, nMC: 300, seed: 7 });
    const key = `${S.place}|${S.mask}|${S.off.join(',')}`;
    if (!dopCache || dopCache.key !== key) dopCache = { key, s: I.dopSeries({ lat, lon, mask, off: S.off, step: 300 }) };
    const tails = {};
    for (let k = 0; k <= 12; k++) for (const s of I.gpsSats(S.gt * HR + k * 300)) { const la = I.lookAngles(lat, lon, ep.user, s.pos); (tails[s.id] ||= []).push([la.az, la.el]); }
    R = { ep, lat, lon, tails };
    const vis = ep.all.filter(s => s.visible).length, d = ep.dop;
    if (!d) {
      metrics.set([{ k: 'Satellites used', v: `${ep.used.length} of ${vis}`, s: 'need at least 4: x, y, z and the clock', cls: 'bad' }, { k: 'Fix', v: 'none', s: 'switch satellites back on, or lower the mask', cls: 'bad' }]);
      insightsList(ins, [{ type: 'b', t: 'No fix with fewer than four satellites', d: 'Each pseudorange gives one equation; the receiver has four unknowns (three position coordinates and its clock error). With an altitude from a barometer three satellites can do, which is how some aviation receivers coast through brief losses.' }]);
      eq.replaceChildren(); return;
    }
    const fe = ep.fixErr, hErr = Math.hypot(fe[0], fe[1]);
    metrics.set([
      { k: 'Satellites used', v: `${ep.used.length} of ${vis}`, s: `above ${S.mask}°; ${ep.all.filter(s => s.el > 0).length} above the horizon` },
      { k: 'HDOP / VDOP', v: `${f3(d.H)} / ${f3(d.V)}`, s: `PDOP ${f3(d.P)}, TDOP ${f3(d.T)}, GDOP ${f3(d.G)}`, cls: d.P > 6 ? 'bad' : d.P > 3 ? 'warn' : 'good', tip: 'Below 2 is excellent, above 6 poor.' },
      { k: 'Expected error (1σ)', v: `${len(S.sigma * d.H)} horizontal`, s: `${len(S.sigma * d.V)} vertical (σ × DOP)` },
      { k: 'This fix', v: `${len(hErr)} horizontal`, s: `${len(fe[2])} vertical, ${ep.fix.iter} iterations` },
      { k: 'Clock error solved', v: `${num(ep.fix.x[3] / I.C_LIGHT * 1e6, 3)} µs`, s: `true ${num(S.clockUs, 0)} µs; residual ${num(ep.clockErr / I.C_LIGHT * 1e9, 1)} ns`, tip: 'Solved alongside the position: the receiver becomes a clock good to tens of nanoseconds.' },
      { k: 'Range to the nearest satellite', v: `${num(Math.min(...ep.used.map(s => s.range)) / 1000, 0)} km`, s: `signal travel ${num(Math.min(...ep.used.map(s => s.range)) / I.C_LIGHT * 1000, 1)} ms` },
    ]);
    const L = [];
    L.push({ type: 'i', t: `A ${num(Math.abs(S.clockUs), 0)} µs clock error is ${len(Math.abs(S.clockUs) * 1e-6 * I.C_LIGHT)} of range, and it does not matter`, d: 'The satellites carry atomic clocks; the receiver has a cheap quartz one. Its error adds the same amount to every pseudorange, so the receiver treats it as a fourth unknown and solves for it with the position. That is why four satellites are needed, and why a GNSS receiver is also a very good clock.' });
    L.push({ type: d.V > 1.5 * d.H ? 'i' : 'g', t: `Vertical ${f3(d.V / d.H)}× worse than horizontal`, d: 'The satellites are all above you: none can be seen through the Earth. Horizontal errors are pinned from all sides, but a height error and a clock error look alike (both lengthen every range, the overhead ones most), so they trade off against each other. Aircraft use GNSS height for approaches only with augmentation (SBAS/WAAS), and keep barometric altitude for separation.' });
    if (Math.abs(p[2]) > 60) L.push({ type: 'i', t: 'High latitude: no satellite ever passes overhead', d: 'GPS orbits are inclined 55°, so above about 60° latitude the satellites are always towards the equator side of the sky and low. There are plenty of them, so horizontal accuracy is fine, but vertical suffers. Galileo (56°) and GLONASS (64.8°) help a little.' });
    if (S.off.length) L.push({ type: d.P > 4 ? 'w' : 'i', t: `${S.off.length} satellite${S.off.length > 1 ? 's' : ''} switched off`, d: 'Removing a satellite never improves the geometry. Losing the ones low and spread around the horizon hurts horizontal accuracy; losing the high ones hurts vertical. Receiver autonomous integrity monitoring (RAIM) needs a fifth satellite to detect a faulty one and a sixth to exclude it.' });
    if (S.mask >= 20) L.push({ type: 'w', t: 'A high mask throws away the satellites that matter', d: 'Low satellites spread the lines of sight and pin the vertical and the clock apart. A banked aircraft\'s wing or a valley wall has the same effect as a high mask.' });
    L.push({ type: 'i', t: 'What is not modelled', d: 'Real ranges have biases that do not average out: the ionosphere (several metres, removed by dual-frequency receivers or SBAS corrections), the troposphere, orbit and satellite-clock errors, and multipath. Here each range error is independent noise of σ.' });
    insightsList(ins, L);
    eq.replaceChildren(h('span', { class: 'eq', html: [
      `Pseudorange: ρᵢ = |sᵢ − x| + b + εᵢ,   b = c·δt = ${num(ep.b, 1)} m,   εᵢ ~ N(0, ${len(S.sigma)})`,
      `Linearise about a guess x₀: δρᵢ = −eᵢ·δx + δb,  eᵢ the unit line of sight;  solve δx = (GᵀG)⁻¹Gᵀ δρ and repeat`,
      `Starting from the Earth's centre: step sizes ${ep.fix.hist.map(v => len(v)).join(' → ')}`,
      `Q = (GᵀG)⁻¹ in east–north–up–clock;  HDOP = √(Q_EE + Q_NN) = ${f3(d.H)},  VDOP = √Q_UU = ${f3(d.V)},  TDOP = √Q_bb = ${f3(d.T)}`,
      `Expected error = σ × DOP: ${len(S.sigma * d.H)} horizontal, ${len(S.sigma * d.V)} vertical (1σ)`,
      `Orbit: a = 26 560 km, period 2π√(a³/μ) = ${num(I.GPS_PERIOD / 60, 1)} min (half a sidereal day), 6 planes at 55°`,
    ].join('<br>') }));
  }
  function skyGeom(W, H) {
    const rr = Math.min(W, H) / 2 - 22, cx = W / 2, cy = H / 2;
    return { rr, cx, cy, xy: (az, el) => { const r = rr * (90 - el * DEG) / 90; return [cx + r * Math.sin(az), cy - r * Math.cos(az)]; } };
  }
  function drawSky(c, W, H) {
    if (!R) return;
    const g = skyGeom(W, H), { rr, cx, cy } = g;
    c.fillStyle = cssVar('--text-3'); c.globalAlpha = 0.12; c.beginPath(); c.arc(cx, cy, rr, 0, 2 * Math.PI); c.arc(cx, cy, rr * (90 - S.mask) / 90, 0, 2 * Math.PI, true); c.fill(); c.globalAlpha = 1;
    c.strokeStyle = cssVar('--border'); c.lineWidth = 1;
    for (const e of [0, 30, 60]) { c.beginPath(); c.arc(cx, cy, rr * (90 - e) / 90, 0, 2 * Math.PI); c.stroke(); }
    c.beginPath(); c.moveTo(cx - rr, cy); c.lineTo(cx + rr, cy); c.moveTo(cx, cy - rr); c.lineTo(cx, cy + rr); c.stroke();
    c.fillStyle = cssVar('--text-3'); c.font = '10.5px ' + cssVar('--mono'); c.textAlign = 'left'; c.textBaseline = 'bottom';
    for (const e of [30, 60]) c.fillText(`${e}°`, cx + 3, cy - rr * (90 - e) / 90 - 1);
    c.fillStyle = cssVar('--text-2'); c.font = '12px ' + cssVar('--font'); c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('N', cx, cy - rr - 11); c.fillText('S', cx, cy + rr + 11); c.fillText('E', cx + rr + 11, cy); c.fillText('W', cx - rr - 11, cy);
    for (const s of R.ep.all) {
      const tl = R.tails[s.id].filter(p => p[1] > 0).map(p => g.xy(p[0], p[1]));
      if (s.el < 0 && !tl.length) continue;
      c.strokeStyle = cssVar('--text-3'); c.globalAlpha = 0.45; c.lineWidth = 1.2; c.beginPath();
      R.tails[s.id].forEach((p, i) => { if (p[1] < 0) return; const [x, y] = g.xy(p[0], p[1]); i && R.tails[s.id][i - 1][1] >= 0 ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke(); c.globalAlpha = 1;
      if (s.el < 0) continue;
      const [x, y] = g.xy(s.az, s.el), on = s.used, off = s.visible && !s.used;
      c.beginPath(); c.arc(x, y, 7, 0, 2 * Math.PI);
      if (on) { c.fillStyle = cssVar('--accent'); c.fill(); } else { c.strokeStyle = off ? cssVar('--bad') : cssVar('--text-3'); c.lineWidth = 1.6; c.globalAlpha = off ? 1 : 0.6; c.stroke(); c.globalAlpha = 1; }
      c.fillStyle = on ? cssVar('--text') : cssVar('--text-3'); c.font = '10.5px ' + cssVar('--font'); c.textAlign = 'left'; c.fillText(s.id, x + 9, y - 6);
    }
  }
  function drawFix(c, W, H) {
    if (!R || !R.ep.dop) return;
    const u = smU(), ep = R.ep, Q = ep.dop.Q, s2 = S.sigma ** 2, cov = [Q[0][0] * s2 / u / u, Q[0][1] * s2 / u / u, Q[1][1] * s2 / u / u];
    const ext = 2.6 * Math.sqrt(Math.max(cov[0], cov[2]) + Math.abs(cov[1]));
    const tr = eqAxes(c, W, H, ext, { xlabel: `East error (${smL()})`, ylabel: `North error (${smL()})`, xfmt: v => num(v, Math.abs(ext) < 5 ? 1 : 0), yfmt: v => num(v, Math.abs(ext) < 5 ? 1 : 0) });
    tr.clip();
    c.fillStyle = cssVar('--text-3'); c.globalAlpha = 0.55;
    for (const p of ep.cloud) { c.beginPath(); c.arc(tr.sx(p[0] / u), tr.sy(p[1] / u), 1.8, 0, 2 * Math.PI); c.fill(); }
    c.globalAlpha = 1;
    ellipse(c, tr, cov, 1, cssVar('--accent'), 2.2); ellipse(c, tr, cov, 2, cssVar('--accent'), 1.4, [5, 4]);
    c.restore();
    tr.dot(ep.fixErr[0] / u, ep.fixErr[1] / u, cssVar('--warn'), 5.5); tr.dot(0, 0, cssVar('--good'), 3.5);
    legend(c, tr, [[cssVar('--accent'), '1σ', null, 2.2], [cssVar('--accent'), '2σ', [5, 4], 1.4]]);
  }
  function drawDop(c, W, H) {
    if (!R || !dopCache) return;
    const s = dopCache.s, cap = 8, Hs = s.map(p => [p.t / HR, p.dop ? Math.min(p.dop.H, cap) : NaN]), Vs = s.map(p => [p.t / HR, p.dop ? Math.min(p.dop.V, cap) : NaN]);
    const ymax = Math.min(cap, Math.max(2, ...Vs.map(p => p[1]).filter(isFinite)) * 1.1);
    const tr = axes(c, W, H, { x0: 0, x1: 24, y0: 0, y1: ymax, xstep: 3, xlabel: 'Time (h)', ylabel: 'DOP', xfmt: v => num(v, 0), yfmt: v => num(v, 1) });
    tr.clip();
    s.forEach((p, i) => { if (!p.dop && i < s.length - 1) shade(c, tr, p.t / HR, s[i + 1].t / HR, cssVar('--bad'), 0.12); });
    tr.line(Hs, cssVar('--accent'), 2.2); tr.line(Vs, cssVar('--warn'), 2.2);
    c.strokeStyle = cssVar('--text-2'); c.setLineDash([4, 3]); c.beginPath(); c.moveTo(tr.sx(S.gt), tr.pt); c.lineTo(tr.sx(S.gt), tr.pt + tr.ih); c.stroke(); c.setLineDash([]);
    c.restore();
    legend(c, tr, [[cssVar('--accent'), 'HDOP', null, 2.2], [cssVar('--warn'), 'VDOP', null, 2.2]]);
  }

  // ================= INS + GNSS Kalman filter =================
  let ec, hc, bc, elc;
  const BIAS = { 7: ['Gyro bias, north', 'gyro'], 8: ['Gyro bias, east', 'gyro'], 9: ['Gyro bias, vertical', 'gyro'], 10: ['Accelerometer bias, north', 'acc'], 11: ['Accelerometer bias, east', 'acc'] };
  function buildKf() {
    inSec.body.replaceChildren(
      field('Sensor grade', select(gradeOpts, S.kgrade, v => { S.kgrade = v; compute(); })),
      sl(`GNSS position σ (${smL()})`, 1 / smU(), 30 / smU(), 0.5, () => S.ksig / smU(), v => { S.ksig = v * smU(); }, { d: 1, info: 'Standard deviation of each GNSS position fix, per axis.' }),
      sl('GNSS fix every (s)', 1, 30, 1, () => S.kdt, v => { S.kdt = v; }),
      sl('Flight time (min)', 30, 120, 5, () => S.kT, v => { S.kT = v; }),
      sl('Outage starts at (min)', 0, 110, 1, () => S.oStart, v => { S.oStart = v; }),
      sl('Outage length (min)', 0, 60, 1, () => S.oLen, v => { S.oLen = v; }, { info: 'GNSS lost: jamming, a canyon, a fault. The INS coasts on what the filter has learned.' }),
      seg('Flight path', [{ value: false, label: 'Straight' }, { value: true, label: 'S-turns' }], () => S.man, v => { S.man = v; }, 'S-turns: ±2 m/s² sideways, reversing every 2.5 minutes. Acceleration makes a heading error show up as a velocity error, so the filter can see it.'),
      field('Bias to plot', select(Object.entries(BIAS).map(([k, b]) => ({ value: k, label: b[0] })), String(S.kbias), v => { S.kbias = +v; compute(); })),
      h('button', { class: 'btn', type: 'button', onclick: () => { S.seed++; compute(); } }, icon('reset', 14), 'New random run'),
      h('div', { class: 'hint' }, 'Loosely coupled: GNSS positions update the 12-state INS error model. The truth draws its biases at random from the grade; the filter knows only their statistics.'));
    ec = canvasBox('300px', drawErr); hc = canvasBox('240px', drawHead); bc = canvasBox('240px', drawBias); elc = canvasBox('250px', drawEll);
    canvases = [ec, hc, bc, elc];
    body.replaceChildren(
      card('Horizontal position error', 'Log scale. Amber: the INS alone (no GNSS from take-off). Blue: the filter\'s error, with its own 1σ estimate dashed. Green dotted: the accuracy of a single GNSS fix. Red band: GNSS lost.', ec.el),
      h('div', { class: 'flt-grid2' },
        card('Heading error', 'Truth (thin) and the filter\'s estimate with its ±1σ band. In straight flight heading is almost invisible to the filter.', hc.el),
        card('Bias estimate', 'The filter learns the sensor biases as it goes: truth (dashed) against estimate and ±1σ.', bc.el)),
      card('Error ellipses (1σ, each to its own scale)', 'Position uncertainty just before the outage, at its end, and one minute after GNSS returns. Dots: the filter\'s actual error at that moment.', elc.el));
  }
  function computeKf() {
    const T = S.kT * 60, o0 = Math.min(S.oStart, S.kT) * 60, o1 = Math.min(T, o0 + S.oLen * 60), outage = S.oLen > 0 ? [o0, o1] : [1e9, 1e9], lat = 45 * D;
    const r = I.insGnssKF({ lat, T, dt: 1, grade: I.GRADES[S.kgrade], gpsDt: S.kdt, gpsSigma: S.ksig, outage, manoeuvre: S.man, seed: S.seed, rec: 5 });
    const n = r.t.length, sr = k => Math.sqrt(r.P[k][0] + r.P[k][13]), er = k => Math.hypot(r.x[k][0] - r.xh[k][0], r.x[k][1] - r.xh[k][1]), fr = k => Math.hypot(r.x[k][0], r.x[k][1]);
    const idx = t => { const i = r.t.findIndex(v => v >= t); return i < 0 ? n - 1 : i; };
    const hasOut = S.oLen > 0 && o0 < T;
    const kB = idx(Math.max(0, o0 - 5)), kE = idx(Math.max(0, o1 - 5)), kA = idx(Math.min(T, o1 + 60));
    let rec = null;
    if (hasOut && o1 < T) for (let k = idx(o1); k < n; k++) if (sr(k) < 2 * sr(kB)) { rec = r.t[k] - o1; break; }
    let inside = 0; for (let k = 0; k < n; k++) if (Math.abs(r.x[k][0] - r.xh[k][0]) <= 2 * Math.sqrt(r.P[k][0])) inside++;
    R = { r, n, sr, er, fr, idx, T, outage: hasOut ? [o0, o1] : null, kB, kE, kA };
    const hs = Math.sqrt(r.P[n - 1][78]), single = S.ksig * Math.SQRT2;
    metrics.set([
      { k: 'With GNSS (1σ)', v: len(sr(hasOut ? kB : n - 1)), s: `single fix ${len(single)}; actual error ${len(er(hasOut ? kB : n - 1))}`, cls: 'good', tip: 'Radial horizontal 1σ of the filter just before the outage.' },
      hasOut ? { k: `End of the ${S.oLen}-min outage`, v: len(sr(kE)), s: `1σ; actual ${len(er(kE))}`, cls: sr(kE) > 1000 ? 'bad' : sr(kE) > 100 ? 'warn' : '' } : { k: 'Outage', v: 'none', s: 'set a length to cut GNSS' },
      { k: 'INS alone at the same time', v: len(fr(hasOut ? kE : n - 1)), s: 'no GNSS since take-off', cls: 'bad' },
      hasOut ? { k: 'Back to normal', v: rec == null ? '—' : `${num(rec, 0)} s`, s: 'after GNSS returns (1σ within 2× its earlier value)' } : { k: 'Fixes used', v: num(Math.floor(T / S.kdt), 0), s: `one every ${S.kdt} s` },
      { k: 'Heading 1σ at the end', v: ang(hs), s: r.gyrocompass ? 'started from gyrocompassing' : 'started from a 1° external heading' },
      { k: 'Filter honesty', v: `${num(100 * inside / n, 0)}%`, s: 'of north errors inside ±2σ (95% expected)', cls: inside / n > 0.85 ? 'good' : 'warn' },
    ]);
    const L = [];
    L.push({ type: 'g', t: `Better than any single fix: ${len(sr(kB))} against ${len(single)}`, d: 'The INS is smooth but drifts; GNSS fixes are noisy but do not drift. The filter weights each by its uncertainty: between fixes it trusts the INS, and each fix pulls the estimate part of the way. Over many fixes the noise averages out, and the filter also learns the INS\'s own errors (velocity, tilt, gyro biases).' });
    if (hasOut) L.push({ type: sr(kE) > 1000 ? 'b' : sr(kE) > 100 ? 'w' : 'i', t: `Coasting through the outage: ${len(er(kE))} after ${S.oLen} min, against ${len(fr(kE))} for the INS alone`, d: `When GNSS goes, the INS carries on from a well-calibrated state: its velocity and tilt errors are small and its gyro biases partly known, so it drifts far more slowly than an INS that was never corrected. How long it can coast depends on the grade: an airliner's unit holds a mile for well over an hour; a phone-grade unit loses kilometres within minutes, which is why jamming matters so much for drones.` });
    if (hasOut && o1 < T) L.push({ type: 'i', t: 'One fix collapses the uncertainty', d: 'The first fix after the outage brings position straight back to a single fix\'s accuracy. Velocity and tilt take a few more fixes, and the filter uses the error it accumulated during the outage to sharpen its estimate of the biases that caused it.' });
    L.push({ type: S.man ? 'g' : 'i', t: S.man ? 'S-turns make heading visible' : 'Flying straight, heading is nearly unobservable', d: 'A heading error only shows in the velocity when the aircraft accelerates: the INS resolves the acceleration in the wrong direction. Flying straight and level the filter can barely see it, so its heading uncertainty stays near where it started; turns (or a transfer alignment manoeuvre) reveal it within a minute.' });
    L.push({ type: 'i', t: 'Accelerometer bias and tilt cannot be told apart when level', d: 'A tilt makes an accelerometer feel g·φ; a bias adds ∇. In level flight only their sum shows, so the accelerometer-bias estimate never improves (pick it in "Bias to plot"). Changing attitude, as real aircraft do, separates them.' });
    insightsList(ins, L);
    eq.replaceChildren(h('span', { class: 'eq', html: [
      'State x (12): δpN, δpE, δvN, δvE, φN, φE, ψ, εN, εE, εD, ∇N, ∇E',
      'Predict: x̂⁻ = Φ x̂,  P⁻ = Φ P Φᵀ + Q,   Φ = e^(FΔt), Δt = 1 s,  Q from the angle random walk and accelerometer noise',
      `Update with a GNSS fix z = (δpN, δpE) + v,  R = σ²I = (${len(S.ksig)})² I:`,
      'K = P⁻Hᵀ(HP⁻Hᵀ + R)⁻¹,   x̂ = x̂⁻ + K(z − Hx̂⁻),   P = P⁻ − K(HP⁻Hᵀ + R)Kᵀ',
      `Grade: ${I.GRADES[S.kgrade].gyro}°/h gyro bias, ${I.GRADES[S.kgrade].accel} µg accelerometer bias, ${I.GRADES[S.kgrade].arw}°/√h angle random walk, ${I.GRADES[S.kgrade].vrw} µg/√Hz accelerometer noise`,
      `This run's biases: gyro ${r.b.slice(0, 3).map(v => num(v * DEG * HR, 3)).join(', ')} °/h; accelerometer ${r.b.slice(3).map(v => num(v / I.G0 * 1e6, 0)).join(', ')} µg`,
    ].join('<br>') }));
  }
  function drawErr(c, W, H) {
    if (!R) return;
    const { r, n, sr, er, fr } = R, u = smU(), tm = r.t.map(t => t / 60);
    const F = [], E = [], Sg = [];
    for (let k = 0; k < n; k++) { F.push([tm[k], lg(fr(k) / u)]); E.push([tm[k], lg(er(k) / u)]); Sg.push([tm[k], lg(sr(k) / u)]); }
    const single = S.ksig * Math.SQRT2 / u, [y0, y1] = logRange([...F, ...E, ...Sg].map(p => 10 ** p[1]).concat([single]).filter(v => v > 0.05 / u));
    const tr = axes(c, W, H, { x0: 0, x1: R.T / 60, y0, y1, ystep: 1, xlabel: 'Time (min)', ylabel: `Error (${smL()}, log)`, xfmt: v => num(v, 0), yfmt: v => short(10 ** v) });
    tr.clip();
    if (R.outage) { shade(c, tr, R.outage[0] / 60, R.outage[1] / 60, cssVar('--bad'), 0.1); tr.text((R.outage[0] + R.outage[1]) / 120, y1 - 0.15, 'GNSS outage', cssVar('--bad'), 'center', 'top'); }
    tr.line([[0, lg(single)], [R.T / 60, lg(single)]], cssVar('--good'), 1.4, [2, 3]);
    tr.line(F, cssVar('--warn'), 2); tr.line(E, cssVar('--accent'), 1.3, null, 0.75); tr.line(Sg, cssVar('--accent'), 2.2, [6, 4]);
    c.restore();
    legend(c, tr, [[cssVar('--warn'), 'INS alone', null, 2], [cssVar('--accent'), 'INS + GNSS error', null, 1.3], [cssVar('--accent'), 'filter 1σ', [6, 4], 2.2], [cssVar('--good'), 'one GNSS fix', [2, 3], 1.4]]);
  }
  function timeSeries(c, W, H, truth, est, sd, unit, ul, color) {
    const tm = R.r.t.map(t => t / 60), lo = est.map((v, i) => v - sd[i]), hi = est.map((v, i) => v + sd[i]);
    const vals = [...truth, ...lo, ...hi].map(v => v / unit), mn = Math.min(...vals), mx = Math.max(...vals), pd = (mx - mn) * 0.08 || 1;
    const tr = axes(c, W, H, { x0: 0, x1: R.T / 60, y0: mn - pd, y1: mx + pd, xlabel: 'Time (min)', ylabel: ul, xfmt: v => num(v, 0), yfmt: v => f3(v) });
    tr.clip();
    if (R.outage) shade(c, tr, R.outage[0] / 60, R.outage[1] / 60, cssVar('--bad'), 0.1);
    band(c, tr, tm, lo.map(v => v / unit), hi.map(v => v / unit), color);
    tr.line(tm.map((t, i) => [t, truth[i] / unit]), cssVar('--text-2'), 1.3, [5, 3]);
    tr.line(tm.map((t, i) => [t, est[i] / unit]), color, 2.2);
    c.restore();
    legend(c, tr, [[cssVar('--text-2'), 'truth', [5, 3], 1.3], [color, 'estimate ± 1σ', null, 2.2]]);
  }
  function drawHead(c, W, H) {
    if (!R) return;
    const { r } = R, tru = r.x.map(x => x[6]), est = r.xh.map(x => x[6]), sd = r.P.map(p => Math.sqrt(p[78])), mx = Math.max(...tru.map(Math.abs), ...sd);
    const unit = mx >= 2 * D ? D : AM; timeSeries(c, W, H, tru, est, sd, unit, `Heading error (${unit === D ? '°' : 'arcmin'})`, cssVar('--accent'));
  }
  function drawBias(c, W, H) {
    if (!R) return;
    const { r } = R, i = S.kbias, [name, kind] = BIAS[i], unit = kind === 'gyro' ? D / HR : 1e-6 * I.G0, ul = kind === 'gyro' ? '°/h' : 'µg';
    timeSeries(c, W, H, r.x.map(x => x[i]), r.xh.map(x => x[i]), r.P.map(p => Math.sqrt(p[i * 13])), unit, `${name} (${ul})`, cssVar('--good'));
  }
  function drawEll(c, W, H) {
    if (!R) return;
    const { r, kB, kE, kA } = R, u = smU();
    const shots = R.outage ? [[kB, 'before the outage', cssVar('--good')], [kE, 'end of the outage', cssVar('--bad')], [kA, '1 min after it', cssVar('--accent')]].filter(s => s[0] != null) : [[R.n - 1, 'end of the flight', cssVar('--good')]];
    const w = W / shots.length;
    shots.forEach(([k, label, color], j) => {
      const P = r.P[k], cov = [P[13] / u / u, P[1] / u / u, P[0] / u / u], ex = r.x[k][1] - r.xh[k][1], nn = r.x[k][0] - r.xh[k][0];   // (east, north)
      const ext = Math.max(2.2 * Math.sqrt(Math.max(cov[0], cov[2])), Math.hypot(ex, nn) / u * 1.2);
      c.save(); c.translate(j * w, 0);
      const tr = eqAxes(c, w, H - 32, ext, { xlabel: `East (${smL()})`, ylabel: j ? '' : `North (${smL()})`, xfmt: v => short(v), yfmt: v => short(v), pl: 46 });
      tr.clip(); ellipse(c, tr, cov, 1, color, 2.2); c.restore();
      tr.dot(ex / u, nn / u, color, 4);
      c.fillStyle = cssVar('--text-2'); c.font = '11.5px ' + cssVar('--font'); c.textAlign = 'center'; c.textBaseline = 'bottom';
      c.fillText(`${label}, ${num(r.t[k] / 60, 1)} min`, w / 2 + 12, H - 16);
      c.fillStyle = color; c.fillText(`1σ ${len(Math.sqrt(P[0] + P[13]))}`, w / 2 + 12, H - 1);
      c.restore();
    });
  }

  const offU = onUnits(() => build());
  build();
  return { controls, main, show: () => repaint(), destroy: () => offU() };
}
