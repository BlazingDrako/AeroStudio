// Dynamic modes tab: eigenvalues of the longitudinal and lateral small-disturbance models, a root locus as CG, speed
// or altitude changes, an animation of any mode (or a control pulse) with its time history, and MIL-F-8785C
// handling-quality levels including the CAP–ζ chart.
import { h, segmented, cssVar, icon } from '../../lib/ui.js';
import { Plot } from '../../lib/plot.js';
import * as St from '../../solvers/stability.js';
import { atmosphere, G0 } from '../../solvers/atmosphere.js';
import { card, metricsGrid, insightsList, onUnits, unit, toDisp, num, canvasBox } from './common.js';
import { perf, aircraftSection, conditionSection, designSection, stabInput, axes } from './perfShared.js';

const DEG = 180 / Math.PI;
const MODES = [
  { id: 'sp', label: 'Short period', axis: 'lon' }, { id: 'ph', label: 'Phugoid', axis: 'lon' },
  { id: 'dr', label: 'Dutch roll', axis: 'lat' }, { id: 'roll', label: 'Roll', axis: 'lat' }, { id: 'spiral', label: 'Spiral', axis: 'lat' },
  { id: 'elev', label: 'Elevator pulse', axis: 'lon', control: true }, { id: 'rud', label: 'Rudder doublet', axis: 'lat', control: true },
];
const COL = { sp: '--accent', ph: '--good', dr: '--lower', roll: '--turb', spiral: '--warn' };

export function modesTab({ keep = o => o } = {}) {
  const S = keep({ mode: 'sp', sweep: 'cg', zoom: 'fast', playing: true });
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });
  let R = null, seen = -1;
  const acSec = aircraftSection(src => { if (src === 'aircraft') { cond.rebuild(); des.rebuild(); } schedule(); });
  const cond = conditionSection(() => schedule());
  const des = designSection(() => schedule());
  controls.append(acSec.el, cond.el, des.el);

  const metrics = metricsGrid();
  const sweepSeg = segmented([{ value: 'cg', label: 'vary CG' }, { value: 'speed', label: 'vary speed' }, { value: 'alt', label: 'vary altitude' }], S.sweep, v => { S.sweep = v; sweep(); loc.paint(); });
  const zoomSeg = segmented([{ value: 'fast', label: 'Fast modes' }, { value: 'slow', label: 'Slow modes' }], S.zoom, v => { S.zoom = v; loc.paint(); });
  const loc = canvasBox('430px', drawLocus);
  const locCard = h('div', { class: 'plot-card' }, h('div', { class: 'plot-head' }, h('h4', {}, 'Root locus (s-plane)'), h('div', { class: 'row' }, sweepSeg.el, zoomSeg.el)), loc.el,
    h('div', { class: 'hint', style: { marginTop: '4px' } }, 'Each mode is a root λ = σ ± iω. Left of the axis decays, right grows; height is the oscillation frequency; radial lines are constant damping ratio ζ. The faint trails show where the roots move as the chosen quantity changes.'));
  const modeSeg = segmented(MODES.map(m => ({ value: m.id, label: m.label })), S.mode, v => { S.mode = v; excite(); });
  modeSeg.el.classList.add('seg-wrap');
  const playBtn = h('button', { class: 'btn', type: 'button', onclick: () => { S.playing = !S.playing; paintPlay(); if (S.playing) { S.t0 = performance.now() - (S.tp || 0) * 1000; loop(); } else S.tp = animTime(); } });
  const paintPlay = () => playBtn.replaceChildren(icon(S.playing ? 'pause' : 'play', 14), S.playing ? 'Pause' : 'Play');
  paintPlay();
  const anim = canvasBox('300px', drawAnim, 'flt-scene');
  const animCard = h('div', { class: 'plot-card' }, h('div', { class: 'plot-head' }, h('h4', {}, 'Watch the motion'), playBtn), h('div', { style: { marginBottom: '6px' } }, modeSeg.el), anim.el);
  const histHost = h('div', { class: 'plot' });
  const histCard = card('Time history', 'The motion variables for the selected mode or control pulse (linear model).', histHost);
  const hist = new Plot(histHost, { legend: true, xname: 't', yname: 'value' });
  const hq = canvasBox('300px', drawHQ);
  const hqCard = card('Handling qualities (MIL-F-8785C, Category B)', 'Short-period damping against the control anticipation parameter CAP = ωsp²/(n/α), with the Level 1 (satisfactory) and Level 2 (acceptable) regions; and the level of every mode. Category B is cruise, climb and descent.', hq.el);
  const hqTable = h('div'); hqCard.append(hqTable);
  const insCard = card('What is happening here'); const ins = h('div'); insCard.append(ins);
  main.append(metrics.el, h('div', { class: 'flt-grid2' }, locCard, animCard), h('div', { class: 'flt-grid2' }, histCard, hqCard), insCard);

  let tm = 0;
  const schedule = () => { clearTimeout(tm); tm = setTimeout(compute, 16); };

  const modeText = m => {
    if (!m) return { v: '—', s: '' };
    if (m.real === true && m.roots) { const up = m.roots.find(x => x.re > 0); return up ? { v: `diverges`, s: `doubles in ${up.t2.toFixed(2)} s`, cls: 'bad' } : { v: 'two real roots', s: `τ ${m.roots.map(x => x.tau.toFixed(2)).join(', ')} s` }; }
    if (m.real) return m.re > 0 ? { v: `T2 ${m.t2.toFixed(1)} s`, s: 'divergent', cls: m.t2 < 12 ? 'bad' : 'warn' } : { v: `τ ${m.tau.toFixed(m.tau < 10 ? 2 : 0)} s`, s: `half in ${m.thalf.toFixed(m.thalf < 10 ? 2 : 0)} s` };
    return { v: `ζ ${m.zeta.toFixed(3)}`, s: `ωn ${m.wn.toFixed(m.wn < 1 ? 3 : 2)} rad/s · period ${m.period.toFixed(m.period < 10 ? 2 : 1)} s`, cls: m.zeta < 0 ? 'bad' : '' };
  };
  const lvl = n => (n === 4 ? 'worse than Level 3' : `Level ${n}`);

  function compute() {
    const inp = stabInput(), r = St.analyse(inp);
    R = { inp, r }; seen = perf.version;
    const { L, Lt, hq: q } = r;
    const sp = modeText(L.sp), ph = modeText(L.ph), dr = modeText(Lt.dr), ro = modeText(Lt.roll), spi = modeText(Lt.spiral);
    metrics.set([
      { k: 'Short period', v: sp.v, s: `${sp.s} · ${lvl(q.sp)}`, cls: sp.cls || (q.sp > 2 ? 'warn' : '') },
      { k: 'Phugoid', v: ph.v, s: `${ph.s} · ${lvl(q.ph)}`, cls: ph.cls || (q.ph > 2 ? 'warn' : '') },
      { k: 'Dutch roll', v: dr.v, s: `${dr.s} · ${lvl(q.dr)}`, cls: dr.cls || (q.dr > 2 ? 'warn' : '') },
      { k: 'Roll subsidence', v: ro.v, s: `${lvl(q.roll)}` },
      { k: 'Spiral', v: spi.v, s: `${spi.s} · ${lvl(q.spiral)}`, cls: spi.cls },
      { k: 'CAP', v: isFinite(q.cap) ? q.cap.toFixed(3) : '—', s: isFinite(q.cap) ? `g⁻¹s⁻² · n/α ${q.nAlpha.toFixed(1)} g/rad` : 'no short-period oscillation', tip: 'Control anticipation parameter: initial pitch acceleration per g of steady load factor. Too low: sluggish; too high: abrupt.' },
    ]);
    sweep(); excite(); hq.paint(); hqLevels(); insights();
  }

  // ---- root locus ----
  function sweep() {
    const { inp, r } = R, g = r.d.g, pts = [];
    let vals;
    if (S.sweep === 'cg') { const a = g.cg[0] - 0.08, b = Math.max(r.d.hn + 0.1, g.cg[1] + 0.12); vals = Array.from({ length: 36 }, (_, i) => a + (b - a) * i / 35).map(v => ({ ...inp, cg: v })); }
    else if (S.sweep === 'speed') { const atm = atmosphere(inp.z, inp.dT), Vs = Math.sqrt(2 * r.d.W / (atm.rho * r.d.S * r.d.ac.CLmax)), b = 0.9 * atm.a; vals = Array.from({ length: 36 }, (_, i) => 1.25 * Vs + (b - 1.25 * Vs) * i / 35).map(v => ({ ...inp, V: Math.min(v, b) })); }
    else { const zt = r.d.ac.plot.zMax; vals = Array.from({ length: 36 }, (_, i) => zt * i / 35).map(z => { const at = atmosphere(z, inp.dT); return { ...inp, z, V: Math.min(inp.V, 0.9 * at.a) }; }); }
    for (const o of vals) {
      const a = St.analyse({ ...o, it: r.it });
      const add = (m, key) => { if (!m) return; for (const l of m.lam || []) pts.push({ re: l[0], im: Math.abs(l[1]), key }); };
      add(a.L.sp, 'sp'); add(a.L.ph, 'ph'); add(a.Lt.dr, 'dr'); add(a.Lt.roll, 'roll'); add(a.Lt.spiral, 'spiral');
    }
    R.trail = pts;
  }
  function drawLocus(c, Wd, Hd) {
    if (!R) return;
    const { r } = R, cur = [];
    const add = (m, key) => { if (!m) return; for (const l of m.lam || []) cur.push({ re: l[0], im: Math.abs(l[1]), key }); };
    add(r.L.sp, 'sp'); add(r.L.ph, 'ph'); add(r.Lt.dr, 'dr'); add(r.Lt.roll, 'roll'); add(r.Lt.spiral, 'spiral');
    const fast = S.zoom === 'fast', keys = fast ? ['sp', 'dr', 'roll'] : ['ph', 'spiral'];
    const sel = [...cur, ...(R.trail || [])].filter(p => keys.includes(p.key));
    const rmax = Math.max(...sel.map(p => Math.abs(p.re)), ...sel.map(p => p.im), fast ? 1 : 0.05) * 1.15;
    const x0 = Math.min(-rmax * 0.15, ...sel.map(p => p.re * 1.1)), x1 = Math.max(rmax * 0.25, ...sel.map(p => p.re * 1.15 + 0.01));
    const tr = axes(c, Wd, Hd, { x0, x1, y0: -0.04 * rmax, y1: rmax, xlabel: 'Real part σ (1/s): decay ←  → growth', ylabel: 'Imaginary part ω (rad/s)', xfmt: v => num(v, fast ? 1 : 3), yfmt: v => num(v, fast ? 1 : 3) });
    tr.clip();
    c.fillStyle = cssVar('--bad'); c.globalAlpha = 0.07; c.fillRect(tr.sx(0), tr.pt, tr.pl + tr.iw - tr.sx(0), tr.ih); c.globalAlpha = 1;
    tr.line([[0, -1e9], [0, 1e9]], cssVar('--border-strong'), 1.2);
    for (const z of [0.1, 0.2, 0.4, 0.7]) { const th = Math.acos(z); tr.line([[0, 0], [-rmax * 3 * Math.cos(th), rmax * 3 * Math.sin(th)]], cssVar('--text-3'), 0.8, [3, 4], 0.7); const rr = Math.min(-x0, rmax) * 0.92; tr.text(-rr * Math.cos(th), rr * Math.sin(th), `ζ ${z}`, cssVar('--text-3'), 'right', 'bottom', '10px'); }
    for (const p of R.trail || []) if (keys.includes(p.key)) { c.fillStyle = cssVar(COL[p.key]); c.globalAlpha = 0.28; c.beginPath(); c.arc(tr.sx(p.re), tr.sy(p.im), 2.4, 0, 2 * Math.PI); c.fill(); c.globalAlpha = 1; }
    const names = { sp: 'short period', ph: 'phugoid', dr: 'Dutch roll', roll: 'roll', spiral: 'spiral' };
    const done = new Set(), placed = [];
    for (const p of cur) if (keys.includes(p.key)) {
      const col = cssVar(COL[p.key]); c.fillStyle = col; c.strokeStyle = cssVar('--bg-elev'); c.lineWidth = 2;
      const X = tr.sx(p.re), Y = tr.sy(p.im);
      if (['sp', 'ph'].includes(p.key)) { c.beginPath(); c.arc(X, Y, 6, 0, 2 * Math.PI); c.fill(); c.stroke(); }
      else { c.beginPath(); c.moveTo(X, Y - 7); c.lineTo(X + 7, Y); c.lineTo(X, Y + 7); c.lineTo(X - 7, Y); c.closePath(); c.fill(); c.stroke(); }
      if (!done.has(p.key)) {                          // nudge a label down if another one is already there
        let ly = Y - 4; while (placed.some(q => Math.abs(q[0] - X) < 90 && Math.abs(q[1] - ly) < 13)) ly += 14;
        placed.push([X, ly]); c.fillStyle = col; c.font = '600 11px ' + cssVar('--font'); c.textAlign = 'left'; c.textBaseline = 'bottom'; c.fillText(`  ${names[p.key]}`, X, ly);
        done.add(p.key);
      }
    }
    c.restore();
    c.fillStyle = cssVar('--text-3'); c.font = '10.5px ' + cssVar('--font'); c.textAlign = 'right'; c.textBaseline = 'top';
    c.fillText('● longitudinal   ◆ lateral', tr.pl + tr.iw - 6, tr.pt + 6);
  }

  // ---- excitation: a mode (eigenvector) or a control pulse, precomputed as a time series ----
  function excite() {
    const { r } = R, m = MODES.find(x => x.id === S.mode), lon = m.axis === 'lon', sys = lon ? r.lon : r.lat, U = r.d.V;
    let T = 10, series = null, rate = 1, note = '';
    if (m.control) {
      const pulse = lon ? (t => (t < 0.5 ? -2 / DEG : 0)) : (t => (t < 1 ? 5 / DEG : t < 2 ? -5 / DEG : 0));
      const spP = lon ? r.L.ph : r.Lt.spiral;
      T = lon ? Math.min(Math.max(12, (spP && spP.period ? spP.period * 1.2 : 30)), 120) : 30;
      series = St.simulate(sys.A, lon ? sys.B : sys.Br, [0, 0, 0, 0], pulse, T, Math.min(0.01, T / 4000));
      note = lon ? 'elevator 2° up for 0.5 s' : 'rudder 5° right for 1 s, then 5° left for 1 s';
    } else {
      const md = lon ? r.L[S.mode] : r.Lt[S.mode];
      const lam = md && md.lam ? (md.lam.find(l => l[1] > 0) || md.lam.reduce((a, b) => (b[0] > a[0] ? b : a))) : null;
      if (!lam) { R.anim = null; anim.paint(); return; }
      const v = St.eigvec(sys.A, lam[0], lam[1]);
      // scale so the attitude (θ or φ), or the speed/sideslip if larger, starts near 5–8°
      const angMag = Math.max(Math.hypot(...v[3]), Math.hypot(...v[0]) / (lon ? U : 1), 1e-9);
      const k = (lon ? 5 : 8) / DEG / angMag;
      const s = lam[0], w = lam[1];
      T = w > 0 ? Math.min(Math.max(3 * 2 * Math.PI / w, 4), 300) : Math.min(s < 0 ? 4 / -s : 3 * Math.LN2 / s, 240);
      if (s > 0 && w > 0) T = Math.min(T, 2 * Math.LN2 / s + 2 * Math.PI / w);
      const n = 600; series = { t: [], x: [] };
      for (let i = 0; i <= n; i++) { const t = T * i / n, e = Math.exp(s * t); series.t.push(t); series.x.push(v.map(([a, b]) => k * e * (a * Math.cos(w * t) - b * Math.sin(w * t)))); }
      note = `${MODES.find(x => x.id === S.mode).label} alone (eigenvector), ${s > 0 ? 'growing' : 'decaying'}`;
    }
    // Small-disturbance model: stop where the motion is no longer small (|α| or |β| > 20°, |θ| > 30°, |φ| > 60°)
    const lim = lon ? [[1, 20 / DEG, 'angle of attack', U], [3, 30 / DEG, 'pitch attitude', 1]] : [[0, 20 / DEG, 'sideslip', 1], [3, 60 / DEG, 'bank angle', 1]];
    let departed = null;
    for (let i = 0; i < series.t.length && !departed; i++) for (const [k, max, what, scale] of lim) if (Math.abs(series.x[i][k] / scale) > max) { departed = { t: series.t[i], what, deg: Math.round(max * DEG) }; series = { t: series.t.slice(0, i + 1), x: series.x.slice(0, i + 1) }; T = series.t[i]; break; }
    rate = T > 20 ? niceRate(T / 10) : 1;
    // integrate height (longitudinal) or heading (lateral) for the picture
    const ext = []; let acc = 0;
    for (let i = 0; i < series.t.length; i++) { const x = series.x[i], dt = i ? series.t[i] - series.t[i - 1] : 0; acc += dt * (lon ? U * x[3] - x[1] : x[2]); ext.push(acc); }
    R.anim = { lon, series, ext, T, rate, note, U, departed };
    S.t0 = performance.now(); S.tp = 0;
    drawHist(); loop();
  }
  const niceRate = x => [2, 5, 10, 20, 50].find(v => v >= x) || 100;
  function animTime() { const a = R && R.anim; if (!a) return 0; const t = S.playing ? (performance.now() - S.t0) / 1000 * a.rate : S.tp || 0; return t % (a.T + (a.departed ? 4 : 1.5) * a.rate); }
  function sample(t) {
    const a = R.anim, ts = a.series.t; if (t >= ts[ts.length - 1]) return { x: a.series.x[ts.length - 1], e: a.ext[ts.length - 1], t: ts[ts.length - 1] };
    let lo = 0, hi = ts.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ts[m] <= t) lo = m; else hi = m; }
    const f = (t - ts[lo]) / (ts[hi] - ts[lo] || 1);
    return { x: a.series.x[lo].map((v, i) => v + (a.series.x[hi][i] - v) * f), e: a.ext[lo] + (a.ext[hi] - a.ext[lo]) * f, t };
  }
  let raf = 0;
  function loop() { cancelAnimationFrame(raf); const tick = () => { if (!main.isConnected || !S.playing) return; anim.paint(); raf = requestAnimationFrame(tick); }; raf = requestAnimationFrame(tick); }

  function drawAnim(c, Wd, Hd) {
    if (!R || !R.anim) { if (R) { c.fillStyle = cssVar('--text-3'); c.font = '12px ' + cssVar('--font'); c.fillText('This mode is not present at this condition.', 16, 30); } return; }
    const a = R.anim, s = sample(animTime()), x = s.x, t2 = cssVar('--text-2');
    c.fillStyle = t2; c.font = '11.5px ' + cssVar('--font'); c.textAlign = 'left'; c.textBaseline = 'top';
    c.fillText(`${a.note} · t = ${s.t.toFixed(1)} s${a.rate > 1 ? ` · playing ×${a.rate}` : ''}`, 10, 8);
    if (a.departed && s.t >= a.T - 1e-9) {
      const msg = `Departed after ${a.departed.t.toFixed(1)} s: ${a.departed.what} passed ${a.departed.deg}°.`;
      const sub = R.r.d.g.relaxed ? 'Unaugmented, this aircraft is unstable in pitch: a real one would pitch up out of control. Its fly-by-wire computer prevents this.' : 'The disturbance keeps growing; past this point the small-disturbance model no longer applies.';
      c.fillStyle = cssVar('--bad'); c.font = '600 12px ' + cssVar('--font'); c.fillText(msg, 10, 26);
      c.fillStyle = cssVar('--text-2'); c.font = '11px ' + cssVar('--font'); c.fillText(sub, 10, 42);
    }
    if (a.lon) {
      // side view: pitch attitude θ, flight path, and height change
      const th = x[3], al = x[1] / a.U, du = x[0], dh = s.e;
      const cx = Wd * 0.45, cy = Hd * 0.55 - Math.max(-Hd * 0.3, Math.min(Hd * 0.3, dh * (Hd * 0.25) / Math.max(1, a.hScale || (a.hScale = Math.max(1, ...a.ext.map(Math.abs))))));
      // moving ground grid conveys speed changes
      const off = (s.t * (a.U + du)) % 40;
      c.strokeStyle = cssVar('--border'); c.lineWidth = 1; c.beginPath(); for (let X = -off * 4; X < Wd; X += 160) { c.moveTo(X, Hd - 40); c.lineTo(X + 30, Hd - 40); } c.stroke();
      c.save(); c.translate(cx, cy); c.rotate(-th); c.scale(2.2, 2.2); plane(c, cssVar('--text')); c.restore();
      // velocity vector (flight path γ = θ − α)
      const gam = th - al;
      c.strokeStyle = cssVar('--accent'); c.lineWidth = 2; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + 90 * Math.cos(gam), cy - 90 * Math.sin(gam)); c.stroke();
      c.fillStyle = cssVar('--text-2'); c.font = '11px ' + cssVar('--mono'); c.textAlign = 'left'; c.textBaseline = 'bottom';
      c.fillText(`θ ${(th * DEG).toFixed(2)}°  α ${(al * DEG >= 0 ? '+' : '')}${(al * DEG).toFixed(2)}°  Δspeed ${num(toDisp('speed', du), 2)} ${unit('speed').u}  Δh ${num(toDisp('alt', dh), 1)} ${unit('alt').u}`, 10, Hd - 10);
    } else {
      // two views: from behind (bank φ) and from above (heading ψ, sideslip β)
      const ph = x[3], be = x[0], ps = s.e;
      const bx = Wd * 0.27, by = Hd * 0.52, L0 = Math.min(Wd * 0.18, Hd * 0.32);
      c.fillStyle = t2; c.font = '600 11.5px ' + cssVar('--font'); c.textAlign = 'center'; c.fillText('From behind', bx, 26); c.fillText('From above', Wd * 0.72, 26);
      c.save(); c.translate(bx, by); c.rotate(ph);
      c.fillStyle = cssVar('--text'); c.fillRect(-L0, -2, 2 * L0, 4); c.beginPath(); c.arc(0, 0, 9, 0, 2 * Math.PI); c.fill(); c.fillRect(-2, -26, 4, 20); c.fillRect(-L0 * 0.3, -10, L0 * 0.6, 3);
      c.restore();
      const ax = Wd * 0.72, ay = Hd * 0.52;
      c.save(); c.translate(ax, ay); c.rotate(ps - Math.PI / 2);   // nose up the screen, heading ψ clockwise
      c.scale(2.2, 2.2); topView(c, cssVar('--text')); c.restore();
      const vd = ps + be;   // velocity direction = heading + sideslip (seen from above)
      c.strokeStyle = cssVar('--accent'); c.lineWidth = 2; c.beginPath(); c.moveTo(ax, ay); c.lineTo(ax + 80 * Math.sin(vd), ay - 80 * Math.cos(vd)); c.stroke();
      c.fillStyle = cssVar('--text-2'); c.font = '11px ' + cssVar('--mono'); c.textAlign = 'left'; c.textBaseline = 'bottom';
      c.fillText(`φ ${(ph * DEG).toFixed(2)}°  β ${(be * DEG).toFixed(2)}°  ψ ${(ps * DEG).toFixed(2)}°  p ${(x[1] * DEG).toFixed(1)}°/s  r ${(x[2] * DEG).toFixed(1)}°/s`, 10, Hd - 10);
    }
  }
  function drawHist() {
    const a = R.anim; if (!a) return;
    const t = a.series.t, col = i => a.series.x.map(x => x[i]);
    const series = a.lon
      ? [{ x: t, y: col(0).map(v => toDisp('speed', v)), color: cssVar('--good'), label: `Δspeed (${unit('speed').u})` }, { x: t, y: col(1).map(v => v / a.U * DEG), color: cssVar('--lower'), label: 'α (°)' }, { x: t, y: col(3).map(v => v * DEG), color: cssVar('--accent'), label: 'θ (°)' }, { x: t, y: col(2).map(v => v * DEG), color: cssVar('--turb'), label: 'q (°/s)', alpha: 0.7 }]
      : [{ x: t, y: col(0).map(v => v * DEG), color: cssVar('--lower'), label: 'β (°)' }, { x: t, y: col(3).map(v => v * DEG), color: cssVar('--accent'), label: 'φ (°)' }, { x: t, y: col(1).map(v => v * DEG), color: cssVar('--turb'), label: 'p (°/s)', alpha: 0.7 }, { x: t, y: col(2).map(v => v * DEG), color: cssVar('--good'), label: 'r (°/s)' }];
    histCard.querySelector('h4').textContent = a.departed ? `Time history (stopped at ${a.departed.t.toFixed(1)} s: model limit)` : 'Time history';
    hist.setOpts({ xlabel: 'Time (s)', ylabel: 'Response', xfmt: v => v.toFixed(2), yfmt: v => v.toFixed(3) });
    hist.setData({ series });
  }

  // ---- handling qualities ----
  function drawHQ(c, Wd, Hd) {
    if (!R) return;
    const q = R.r.hq, sp = R.r.L.sp;
    const lx = z => z, ly = v => Math.log10(v);
    const tr = axes(c, Wd, Hd, { x0: 0, x1: 2.2, y0: ly(0.01), y1: ly(20), xlabel: 'Short-period damping ratio ζsp', ylabel: 'CAP (g⁻¹ s⁻²), log', xfmt: v => v.toFixed(1), yfmt: v => String(+(10 ** v).toPrecision(2)), ystep: 1, pb: 38 });
    tr.clip();
    const box = (z0, z1, c0, c1, col, alpha) => { c.fillStyle = col; c.globalAlpha = alpha; c.fillRect(tr.sx(z0), tr.sy(ly(c1)), tr.sx(z1) - tr.sx(z0), tr.sy(ly(c0)) - tr.sy(ly(c1))); c.globalAlpha = 1; c.strokeStyle = col; c.lineWidth = 1.5; c.strokeRect(tr.sx(z0), tr.sy(ly(c1)), tr.sx(z1) - tr.sx(z0), tr.sy(ly(c0)) - tr.sy(ly(c1))); };
    box(0.20, 2.0, 0.038, 10, cssVar('--warn'), 0.08);
    box(0.30, 2.0, 0.085, 3.6, cssVar('--good'), 0.14);
    tr.text(1.95, ly(3.0), 'Level 1', cssVar('--good'), 'right', 'top', '600 11px');
    tr.text(1.95, ly(8.5), 'Level 2', cssVar('--warn'), 'right', 'top', '600 11px');
    if (!sp.real && isFinite(q.cap)) { const z = Math.min(2.15, Math.max(0.01, sp.zeta)); tr.dot(lx(z), ly(Math.max(0.011, Math.min(19, q.cap))), cssVar('--accent'), 6); tr.text(lx(z), ly(Math.max(0.011, Math.min(19, q.cap))), '  this aircraft', cssVar('--text'), 'left', 'bottom', '600 11px'); }
    else tr.text(1.1, ly(0.3), 'No short-period oscillation: unstable or overdamped', cssVar('--bad'), 'center', 'middle', '600 11.5px');
    c.restore();
  }
  function hqLevels() {
    const q = R.r.hq, rows = [['Short period', q.sp, 'ζ 0.30–2.0 and CAP 0.085–3.6'], ['Phugoid', q.ph, 'ζ ≥ 0.04'], ['Dutch roll', q.dr, 'ζ ≥ 0.08, ζωn ≥ 0.15, ωn ≥ 0.4'], ['Roll mode', q.roll, 'τ ≤ 1.4 s'], ['Spiral', q.spiral, 'doubling time ≥ 20 s']];
    const badge = n => h('span', { class: 'flt-lvl l' + n }, n === 4 ? 'beyond L3' : 'Level ' + n);
    hqTable.replaceChildren(h('table', { class: 'data', style: { marginTop: '6px' } }, h('tbody', {}, ...rows.map(([k, n, req]) => h('tr', {}, h('td', { style: { textAlign: 'left', fontFamily: 'var(--font)' } }, k), h('td', {}, badge(n)), h('td', { style: { textAlign: 'left', fontFamily: 'var(--font)', color: 'var(--text-3)' } }, 'Level 1: ' + req))))),
      h('div', { class: 'hint' }, `Class ${q.cls} aircraft. Level 1: clearly adequate; Level 2: adequate with some increase in pilot workload; Level 3: controllable.`));
  }

  function insights() {
    const { r } = R, { L, Lt, d } = r, list = [];
    if (L.sp.real) { const up = L.sp.roots && L.sp.roots.find(x => x.re > 0); list.push(up ? { type: 'b', t: `Pitch divergence: doubles every ${up.t2.toFixed(2)} s`, d: d.g.relaxed ? 'Relaxed static stability: without the flight-control computer the F-16 would pitch away faster than a pilot could react. The Controls tab (coming next) closes the loop.' : 'The CG is behind the neutral point: the short-period oscillation has split into two real roots, one unstable.' } : { type: 'i', t: 'Short period overdamped', d: 'Two real, stable roots instead of an oscillation.' }); }
    else list.push({ type: 'i', t: `Short period: ${L.sp.period.toFixed(2)} s, ζ ${L.sp.zeta.toFixed(2)}`, d: 'A quick angle-of-attack oscillation at nearly constant speed, set by pitch stiffness (Cmα) and damping (Cmq). It is what the pilot feels on every stick input.' });
    if (!L.ph.real) list.push({ type: L.ph.zeta < 0 ? 'w' : 'i', t: `Phugoid: ${L.ph.period.toFixed(0)} s period, ζ ${L.ph.zeta.toFixed(3)}`, d: `A slow exchange of height and speed at nearly constant angle of attack, like a roller coaster. Lanchester's estimate π√2·V/g = ${(Math.PI * Math.SQRT2 * d.V / G0).toFixed(0)} s. Its damping comes from drag, so clean, efficient aircraft have weak phugoid damping; pilots (and autopilots) control it without noticing.` });
    if (Lt.dr) list.push({ type: Lt.dr.zeta < 0.08 ? 'w' : 'i', t: `Dutch roll: ${Lt.dr.period.toFixed(1)} s, ζ ${Lt.dr.zeta.toFixed(3)}`, d: Lt.dr.zeta < 0.08 ? 'Lightly damped wallowing yaw and roll. Swept-wing jets at high altitude are prone to this, which is why they carry a yaw damper. Try a bigger fin, or less dihedral.' : 'A coupled yaw–roll wag: the fin swings the nose back, the dihedral effect rolls the wings, and they chase each other.' });
    if (Lt.spiral) list.push({ type: Lt.spiral.re > 0 ? 'w' : 'g', t: Lt.spiral.re > 0 ? `Spiral divergence: doubles in ${Lt.spiral.t2.toFixed(0)} s` : 'Spiral stable', d: Lt.spiral.re > 0 ? 'Slowly, a bank keeps steepening into a descending spiral unless corrected. Mild divergence is normal and easily held by the pilot; more dihedral stabilises it (at the cost of Dutch roll).' : 'A banked aircraft slowly rolls itself level: strong dihedral effect relative to the fin.' });
    if (Lt.roll) list.push({ type: 'i', t: `Roll mode: τ = ${Lt.roll.tau.toFixed(2)} s`, d: 'After an aileron input the roll rate settles exponentially; roll damping (Clp) against roll inertia sets how quickly. Long, heavy wings roll sluggishly.' });
    insightsList(ins, list);
  }

  const offU = onUnits(() => { acSec.rebuild(); cond.rebuild(); schedule(); });
  compute();
  return {
    controls, main,
    show: () => { if (seen !== perf.version) { acSec.rebuild(); cond.rebuild(); des.rebuild(); compute(); } else { loc.paint(); hq.paint(); hist.draw(); if (S.playing) loop(); } },
    destroy: () => { offU(); clearTimeout(tm); cancelAnimationFrame(raf); },
  };
}

function plane(c, color) {
  c.fillStyle = color; c.beginPath();
  c.moveTo(26, 0); c.quadraticCurveTo(22, -4, 10, -4); c.lineTo(-18, -3); c.lineTo(-26, -13); c.lineTo(-30, -13); c.lineTo(-26, -2); c.lineTo(-28, 2); c.lineTo(-18, 3); c.lineTo(10, 3); c.quadraticCurveTo(22, 3, 26, 0); c.fill();
  c.globalAlpha = 0.85; c.beginPath(); c.moveTo(4, 0); c.lineTo(-8, 7); c.lineTo(-12, 7); c.lineTo(-6, 0); c.fill(); c.globalAlpha = 1;
}
function topView(c, color) {
  c.fillStyle = color; c.beginPath();
  c.moveTo(14, 0); c.lineTo(4, -2); c.lineTo(0, -14); c.lineTo(-4, -14); c.lineTo(-3, -2); c.lineTo(-10, -2); c.lineTo(-12, -6); c.lineTo(-14, -6); c.lineTo(-13, 0);
  c.lineTo(-14, 6); c.lineTo(-12, 6); c.lineTo(-10, 2); c.lineTo(-3, 2); c.lineTo(-4, 14); c.lineTo(0, 14); c.lineTo(4, 2); c.closePath(); c.fill();
}
