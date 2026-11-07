// Vibration tab: a spring–mass–damper lab (free, forced, base motion, pulses, sweeps, earthquakes,
// shock spectra), a tuned vibration absorber, and the dynamic response of the drawn structure by
// modal superposition (frequency response, impacts, base shaking).
import { h, section } from '../../lib/ui.js';
import { Plot } from '../../lib/plot.js';
import { modal, elementCurve, analyze } from '../../solvers/frame2d.js';
import { letters } from '../../solvers/statics.js';
import * as V from '../../solvers/vibration.js';
import { sharedStore } from './model.js';
import { numField, selField, segField, checkField, card, metricsGrid, insightsList, units, fmtNum, table } from './common.js';

const TAU = 2 * Math.PI, G0 = 9.80665;
const SDOF_INPUTS = [
  { value: 'free', label: 'Free vibration (released from rest)' }, { value: 'harmonic', label: 'Harmonic force F₀ sin ωt' }, { value: 'base', label: 'Harmonic base motion Y sin ωt' },
  { value: 'step', label: 'Suddenly applied force' }, { value: 'rect', label: 'Rectangular force pulse' }, { value: 'halfsine', label: 'Half-sine force pulse' },
  { value: 'impulse', label: 'Impact (short impulse)' }, { value: 'sweep', label: 'Frequency sweep (chirp)' }, { value: 'shock', label: 'Half-sine base shock (g)' }, { value: 'quake', label: 'Earthquake ground motion' },
];
const KEY = 'aerostudio-vib-v1';
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

export function vibrationTab({ go, keep = o => o }) {
  const st = keep({
    mode: 'sdof',
    sdof: { m: 10, k: 10 * (TAU * 2) ** 2, zeta: 0.05, input: 'harmonic', F0: 100, freq: 1.8, x0: 0.02, v0: 0, td: 0.15, I: 5, Y: 0.01, A: 20, pga: 0.3, dur: 12, f0: 0.2, f1: 6, Ts: 20 },
    abs: { m1: 100, f1: 5, z1: 0.01, mu: 0.05, ftune: 1 / 1.05, z2: Math.sqrt(3 * 0.05 / (8 * 1.05 ** 3)), F0: 100, fexc: 5 },
    str: { zeta: 0.02, nModes: 12, kind: 'frf', inNode: 1, inDir: 'y', outNode: 1, outDir: 'y', F0: 1000, f: null, pulse: 'halfsine', td: 0.01, baseDir: 'x', baseKind: 'quake', bA: 0.3, bf: 2, pga: 0.3, dur: 12 },
  });
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s) { for (const k of ['sdof', 'abs', 'str']) Object.assign(st[k], s[k] || {}); st.mode = s.mode || st.mode; } } catch { }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { } };

  const controls = h('div', { class: 'st-controls' });
  const sMode = section('Model'), sPar = section('Parameters'), sIn = section('Excitation');
  controls.append(sMode.el, sPar.el, sIn.el);
  const main = h('div', { class: 'cf-main-inner' });

  // shared visual pieces
  const stage = h('div', { class: 'stage st-vstage' }), cv = h('canvas'), ctx = cv.getContext('2d');
  const playBtn = h('button', { type: 'button', class: 'btn sm' }, 'Pause'), speedLab = h('span', { class: 'hint', style: { margin: 0 } });
  const tbar = h('div', { class: 'st-vbar' }, playBtn, speedLab);
  stage.append(cv, tbar);
  const metrics = metricsGrid();
  const p1Host = h('div', { class: 'st-plot' }), p2Host = h('div', { class: 'st-plot' }), p3Host = h('div', { class: 'st-plot st-plot-sm' });
  const plot1 = new Plot(p1Host, { legend: true }), plot2 = new Plot(p2Host, { legend: true }), plot3 = new Plot(p3Host, { legend: true });
  const t1 = h('h4', {}), t2 = h('h4', {}), t3 = h('h4', {});
  const c1 = h('div', { class: 'plot-card' }, h('div', { class: 'plot-head' }, t1), p1Host), c2 = h('div', { class: 'plot-card' }, h('div', { class: 'plot-head' }, t2), p2Host), c3 = h('div', { class: 'plot-card' }, h('div', { class: 'plot-head' }, t3), p3Host);
  const insights = h('div', {}), extra = h('div', {});
  main.append(h('div', { class: 'st-pair st-pair-mohr' }, stage, c1), metrics.el, h('div', { class: 'st-pair' }, c2, c3), h('div', { class: 'st-pair' }, card('What the results say', null, insights), extra));

  let playing = true, anim = null, raf = 0, t0 = performance.now(), simT = 0, lastFrame = 0;
  playBtn.addEventListener('click', () => { playing = !playing; playBtn.textContent = playing ? 'Pause' : 'Play'; if (playing) loop(); });
  const loop = () => {
    cancelAnimationFrame(raf);
    const step = now => {
      if (!stage.isConnected) return;
      const dtw = Math.min(0.05, (now - (lastFrame || now)) / 1000); lastFrame = now;
      if (playing && anim) { simT += dtw * anim.rate; if (anim.T && simT > anim.T) simT = anim.loop ? simT % anim.T : 0; }
      paint();
      if (playing) raf = requestAnimationFrame(step);
    };
    lastFrame = 0; raf = requestAnimationFrame(step);
  };
  function fit() { const W = stage.clientWidth, H = stage.clientHeight; const dpr = Math.min(devicePixelRatio || 1, 2); if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); } ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); return { W, H }; }
  function paint() { if (!anim) return; const { W, H } = fit(); if (W) anim.draw(ctx, W, H, simT); }
  new ResizeObserver(() => paint()).observe(stage);

  // ================================================================= SDOF lab
  let sd = null;
  function solveSDOF() {
    const p = st.sdof, wn = Math.sqrt(p.k / p.m), fn = wn / TAU, Tn = 1 / fn, z = p.zeta;
    const inp = p.input, base = ['base', 'shock', 'quake'].includes(inp);
    const fexc = inp === 'harmonic' || inp === 'base' ? p.freq : inp === 'sweep' ? p.f1 : fn;
    let T = 8 * Tn;
    if (inp === 'harmonic' || inp === 'base') T = Math.min(80, Math.max(12 / p.freq, z > 0 ? 5 / (z * wn) : 30 * Tn, 6 * Tn));
    if (inp === 'free') T = Math.min(80, Math.max(6 * Tn, z > 0 ? Math.min(4 / (z * wn), 40 * Tn) : 8 * Tn));
    if (['rect', 'halfsine', 'impulse', 'shock'].includes(inp)) T = p.td + Math.min(60, z > 0 ? Math.max(4 * Tn, Math.min(3 / (z * wn), 12 * Tn)) : 6 * Tn);
    if (inp === 'step') T = Math.min(60, Math.max(6 * Tn, z > 0 ? Math.min(4 / (z * wn), 12 * Tn) : 6 * Tn));
    if (inp === 'sweep') T = p.Ts * 1.1;
    if (inp === 'quake') T = p.dur + 4 * Tn;
    let dt = Math.min(Tn / 50, 1 / (Math.max(fexc, 0.01) * 50));
    if (['rect', 'halfsine', 'impulse', 'shock'].includes(inp)) dt = Math.min(dt, p.td / 40);
    if (inp === 'quake') dt = Math.min(dt, 0.005);
    dt = Math.max(dt, T / 60000);
    // excitation per unit mass
    let f, ybase = null, aIn = null, forceLabel = '';
    const n = Math.ceil(T / dt) + 1;
    if (inp === 'free') f = new Float64Array(n);
    else if (inp === 'harmonic') { f = V.makeInput('harmonic', { freq: p.freq }, dt, T).f.map(x => x * p.F0 / p.m); forceLabel = 'F₀ sin ωt'; }
    else if (inp === 'step') f = V.makeInput('step', {}, dt, T).f.map(x => x * p.F0 / p.m);
    else if (inp === 'rect' || inp === 'halfsine') f = V.makeInput(inp, { td: p.td }, dt, T).f.map(x => x * p.F0 / p.m);
    else if (inp === 'impulse') f = V.makeInput('impulse', { td: p.td }, dt, T).f.map(x => x * p.I / p.m);
    else if (inp === 'sweep') f = V.makeInput('sweep', { f0: p.f0, f1: p.f1, Ts: p.Ts }, dt, T).f.map(x => x * p.F0 / p.m);
    else {
      // base acceleration ag(t) → relative coordinate driven by −ag
      let ag;
      if (inp === 'base') { const w = TAU * p.freq; ag = V.makeInput('harmonic', { freq: p.freq }, dt, T).f.map(x => -x * p.Y * w * w); }
      else if (inp === 'shock') ag = V.makeInput('halfsine', { td: p.td }, dt, T).f.map(x => x * p.A * G0);
      else ag = V.makeInput('quake', { duration: p.dur, seed: 7 }, dt, T).f.map(x => x * p.pga * G0);
      aIn = ag; f = ag.map(x => -x);
      // base displacement by double integration (trapezoid) for drawing; harmonic case exact
      ybase = new Float64Array(n);
      if (inp === 'base') { for (let i = 0; i < n; i++) ybase[i] = p.Y * Math.sin(TAU * p.freq * i * dt); }
      else { let v = 0; for (let i = 1; i < n; i++) { v += (ag[i] + ag[i - 1]) / 2 * dt; ybase[i] = ybase[i - 1] + v * dt; } // remove drift
        const s = ybase[n - 1] / (n - 1); for (let i = 0; i < n; i++) ybase[i] -= s * i; }
    }
    const r = V.sdofResponse(wn, z, f, dt, inp === 'free' ? p.x0 : 0, inp === 'free' ? p.v0 : 0);
    const x = base ? r.u.map((u, i) => u + ybase[i]) : r.u; // absolute displacement
    let pk = 0, tpk = 0; for (let i = 0; i < n; i++) { const v = Math.abs(base ? r.u[i] : x[i]); if (v > pk) { pk = v; tpk = i * dt; } }
    // transmitted force (to the base) and absolute acceleration
    let ftr = 0, aabs = 0; for (let i = 0; i < n; i++) { ftr = Math.max(ftr, Math.abs(p.k * r.u[i] + 2 * z * wn * p.m * r.v[i])); aabs = Math.max(aabs, Math.abs(base ? -(2 * z * wn * r.v[i] + wn * wn * r.u[i]) : r.a[i])); }
    sd = { wn, fn, Tn, z, dt, n, T, f, r, x, ybase, aIn, pk, tpk, ftr, aabs, base, fexc, forceLabel };
  }
  function renderSDOF() {
    const p = st.sdof;
    sPar.body.replaceChildren(
      numField('Mass m', 'mass', () => p.m, v => { if (v > 0) { p.m = v; upd(); } }),
      numField('Stiffness k', 'kspring', () => p.k, v => { if (v > 0) { p.k = v; upd(); } }),
      numField('Natural frequency fₙ', null, () => Math.sqrt(p.k / p.m) / TAU, v => { if (v > 0) { p.k = p.m * (TAU * v) ** 2; upd(); renderSDOF(); } }, { suffix: 'Hz', tip: 'Setting fₙ changes k (keeping m).' }),
      numField('Damping ratio ζ', null, () => p.zeta, v => { if (v >= 0) { p.zeta = v; upd(); } }, { tip: 'c / c_critical. Steel structures 0.01–0.02, bolted aircraft structure ~0.02–0.05, rubber mounts 0.05–0.15, a car suspension ~0.3.' }),
      h('div', { class: 'st-quick' }, ...[0, 0.02, 0.05, 0.1, 0.3, 1].map(zv => { const b = h('button', { type: 'button', class: 'btn sm ghost' }, `ζ ${zv}`); b.addEventListener('click', () => { p.zeta = zv; renderSDOF(); upd(); }); return b; })));
    const b = sIn.body; b.replaceChildren(selField('Input', SDOF_INPUTS, p.input, v => { p.input = v; renderSDOF(); upd(); }));
    const i = p.input, add = (...els) => b.append(...els);
    if (i === 'free') add(numField('Initial displacement', 'disp', () => p.x0, v => { p.x0 = v; upd(); }), numField('Initial velocity', null, () => p.v0, v => { p.v0 = v; upd(); }, { suffix: 'm/s' }));
    if (['harmonic', 'step', 'rect', 'halfsine', 'sweep'].includes(i)) add(numField('Force amplitude F₀', 'force', () => p.F0, v => { p.F0 = v; upd(); }));
    if (i === 'harmonic' || i === 'base') add(numField('Excitation frequency', null, () => p.freq, v => { if (v > 0) { p.freq = v; upd(); } }, { suffix: 'Hz' }), h('div', { class: 'st-quick' }, ...[0.5, 0.9, 1, 1.1, 1.41, 3].map(rv => { const bb = h('button', { type: 'button', class: 'btn sm ghost' }, `r = ${rv}`); bb.addEventListener('click', () => { p.freq = rv * Math.sqrt(p.k / p.m) / TAU; renderSDOF(); upd(); }); return bb; })));
    if (i === 'base') add(numField('Base amplitude Y', 'disp', () => p.Y, v => { p.Y = v; upd(); }));
    if (['rect', 'halfsine', 'impulse', 'shock'].includes(i)) add(numField(i === 'impulse' ? 'Contact time' : 'Pulse duration t_d', null, () => p.td * 1000, v => { if (v > 0) { p.td = v / 1000; upd(); } }, { suffix: 'ms' }));
    if (i === 'impulse') add(numField('Impulse I = ∫F dt', null, () => p.I, v => { p.I = v; upd(); }, { suffix: 'N·s' }));
    if (i === 'sweep') add(numField('Start frequency', null, () => p.f0, v => { p.f0 = Math.max(0, v); upd(); }, { suffix: 'Hz' }), numField('End frequency', null, () => p.f1, v => { p.f1 = Math.max(0.01, v); upd(); }, { suffix: 'Hz' }), numField('Sweep time', null, () => p.Ts, v => { if (v > 0) { p.Ts = v; upd(); } }, { suffix: 's' }));
    if (i === 'shock') add(numField('Peak base acceleration', null, () => p.A, v => { p.A = v; upd(); }, { suffix: 'g' }));
    if (i === 'quake') add(numField('Peak ground acceleration', null, () => p.pga, v => { p.pga = v; upd(); }, { suffix: 'g' }), numField('Duration', null, () => p.dur, v => { if (v > 1) { p.dur = v; upd(); } }, { suffix: 's' }), h('div', { class: 'hint' }, 'A synthetic record: random noise filtered like firm soil (Kanai–Tajimi) with a build-up, strong phase and decay.'));
  }
  function showSDOF() {
    solveSDOF();
    const p = st.sdof, s = sd, z = s.z, c = 2 * z * Math.sqrt(p.k * p.m), ccr = 2 * Math.sqrt(p.k * p.m);
    const fd = s.fn * Math.sqrt(Math.max(0, 1 - z * z));
    const xst = ['harmonic', 'step', 'rect', 'halfsine', 'sweep'].includes(p.input) ? p.F0 / p.k : null;
    const m = [
      { k: 'Natural frequency fₙ', v: fmtNum(s.fn, 4) + ' Hz', s: `ωₙ = ${fmtNum(s.wn, 4)} rad/s · T = ${fmtNum(s.Tn, 4)} s` },
      { k: 'Damped frequency f_d', v: z < 1 ? fmtNum(fd, 4) + ' Hz' : 'none', s: z < 1 ? 'f_d = fₙ√(1 − ζ²)' : 'overdamped: no oscillation' },
      { k: 'Damping c', v: fmtNum(c, 4) + ' N·s/m', s: `c_cr = ${fmtNum(ccr, 4)} · Q = ${z > 0 ? fmtNum(1 / (2 * z), 3) : '∞'}` },
      { k: s.base ? 'Peak relative motion' : 'Peak displacement', v: units.fmt('disp', s.pk, 4), s: `at t = ${fmtNum(s.tpk, 3)} s` },
    ];
    if (xst) m.push({ k: 'Dynamic amplification', v: fmtNum(s.pk / xst, 4), s: `static F₀/k = ${units.fmt('disp', xst, 3)}`, tip: 'Peak dynamic displacement divided by the static displacement under the same peak force.' });
    if (p.input === 'impulse') m.push({ k: 'Impulse theory', v: units.fmt('disp', p.I / (p.m * s.wn), 4), s: 'peak ≈ I/(mωₙ) for a short impact' });
    m.push({ k: s.base ? 'Peak mass acceleration' : 'Peak force on the base', v: s.base ? fmtNum(s.aabs / G0, 4) + ' g' : units.fmt('force', s.ftr, 4), s: s.base ? `input peak ${fmtNum(maxAbs(s.aIn) / G0, 3)} g` : 'spring + damper force' });
    if (z > 0 && z < 1) m.push({ k: 'Log decrement δ', v: fmtNum(TAU * z / Math.sqrt(1 - z * z), 4), s: 'ln of successive peak ratio' });
    metrics.set(m);
    // time history plot (decimated)
    const stride = Math.max(1, Math.floor(s.n / 2500)), ts = [], xs = [], ys = [], fs = [];
    for (let i = 0; i < s.n; i += stride) { ts.push(i * s.dt); xs.push(units.fromSI('disp', s.x[i])); if (s.ybase) ys.push(units.fromSI('disp', s.ybase[i])); fs.push(s.base ? s.aIn[i] / G0 : s.f[i] * p.m); }
    t1.textContent = 'Response over time';
    const ser = [{ x: ts, y: xs, color: css('--accent'), label: s.base ? 'mass x(t)' : 'x(t)' }];
    if (s.ybase) ser.push({ x: ts, y: ys, color: css('--text-3'), label: 'base y(t)', width: 1.2 });
    if (z > 0 && z < 1 && p.input === 'free') { const env = ts.map(t => units.fromSI('disp', Math.hypot(p.x0, (p.v0 + z * s.wn * p.x0) / (s.wn * Math.sqrt(1 - z * z))) * Math.exp(-z * s.wn * t))); ser.push({ x: ts, y: env, color: css('--text-3'), dash: [4, 4], label: 'decay envelope', width: 1 }, { x: ts, y: env.map(v => -v), color: css('--text-3'), dash: [4, 4], width: 1, noHover: true }); }
    plot1.setOpts({ xlabel: 'time (s)', ylabel: `displacement (${units.label('disp')})`, xname: 't', yname: 'x', logx: false, logy: false, ylim: null });
    plot1.setData({ series: ser });
    // input plot
    t2.textContent = s.base ? 'Base acceleration (g)' : 'Applied force';
    plot2.setOpts({ xlabel: 'time (s)', ylabel: s.base ? 'acceleration (g)' : `force (${units.label('force')})`, xname: 't', yname: s.base ? 'a' : 'F', logx: false, logy: false, ylim: null });
    plot2.setData({ series: [{ x: ts, y: s.base ? fs : fs.map(v => units.fromSI('force', v)), color: css('--lower'), label: s.base ? 'ÿ_g(t)' : 'F(t)' }] });
    // frequency-domain / spectrum plot
    const zs = [...new Set([0.05, 0.1, 0.2, 0.5, z])].sort((a, b) => a - b);
    if (['harmonic', 'base', 'free', 'sweep', 'step'].includes(p.input)) {
      const tr = p.input === 'base';
      t3.textContent = tr ? 'Transmissibility |X/Y| vs frequency ratio' : 'Magnification |X|/(F₀/k) vs frequency ratio';
      const rs = []; for (let i = 0; i <= 400; i++) rs.push(i / 400 * 3);
      const fam = zs.map(zz => ({ x: rs, y: rs.map(r => tr ? V.transmissibility(r, zz) : V.magnification(r, zz)), color: zz === z ? css('--accent') : css('--text-3'), width: zz === z ? 2.2 : 1, label: `ζ = ${zz}`, alpha: zz === z ? 1 : 0.6 }));
      const vl = [{ x: Math.SQRT2, color: css('--border-strong') }];
      if (p.input === 'harmonic' || p.input === 'base') vl.push({ x: p.freq / s.fn, color: css('--lower'), dash: [] });
      plot3.setOpts({ xlabel: 'r = f / fₙ', ylabel: tr ? 'X / Y' : 'X k / F₀', xname: 'r', yname: 'M', logy: true, logx: false, ylim: [0.02, 60] });
      plot3.setData({ series: fam, vlines: vl });
    } else if (['rect', 'halfsine', 'impulse'].includes(p.input)) {
      const kind = p.input === 'impulse' ? 'rect' : p.input, sp = V.shockSpectrum(kind, z);
      t3.textContent = 'Shock spectrum: peak dynamic load factor vs t_d / Tₙ';
      plot3.setOpts({ xlabel: 't_d / Tₙ', ylabel: 'peak x·k / F₀', xname: 't_d/Tₙ', yname: 'DLF', logx: true, logy: false, ylim: null });
      plot3.setData({ series: [{ x: sp.ratio, y: sp.peak, color: css('--accent'), label: 'peak response' }, { x: sp.ratio, y: sp.resid, color: css('--text-3'), dash: [4, 3], label: 'after the pulse (residual)' }], vlines: [{ x: p.td / s.Tn, color: css('--lower'), dash: [] }] });
    } else {
      // base shock / earthquake: response spectrum of absolute acceleration
      t3.textContent = p.input === 'quake' ? 'Response spectrum (peak absolute acceleration)' : 'Shock response spectrum (SRS)';
      const fsr = []; for (let i = 0; i < 50; i++) fsr.push(0.2 * (500) ** (i / 49));
      const src = s.aIn.map(a => a / G0), useDt = s.dt;
      const step = Math.max(1, Math.round(0.002 / useDt)), ag = []; for (let i = 0; i < src.length; i += step) ag.push(src[i]);
      const srs = V.baseSRS(Float64Array.from(ag), useDt * step, Math.max(z, 0.01), fsr.filter(f => f < 0.5 / (useDt * step) / 4));
      plot3.setOpts({ xlabel: 'natural frequency (Hz)', ylabel: 'peak acceleration (g)', xname: 'f', yname: 'a', logx: true, logy: true, ylim: null });
      plot3.setData({ series: [{ x: fsr.slice(0, srs.length), y: srs, color: css('--accent'), label: `ζ = ${Math.max(z, 0.01)}` }], vlines: [{ x: s.fn, color: css('--lower'), dash: [] }] });
    }
    // insights
    const out = [], r = (p.input === 'harmonic' || p.input === 'base') ? p.freq / s.fn : null;
    if (r !== null) {
      if (Math.abs(r - 1) < 0.15) out.push({ type: 'b', t: 'Near resonance', d: `r = ${fmtNum(r, 3)}. At resonance the amplitude is 1/(2ζ) = ${z > 0 ? fmtNum(1 / (2 * z), 3) : '∞'} times the static value, limited only by damping. Move the natural frequency away (stiffness or mass) or add damping.` });
      else if (r < 1) out.push({ type: 'i', t: 'Below resonance: stiffness-controlled', d: 'The mass follows the force almost in phase, amplified by 1/(1 − r²).' });
      else out.push({ type: 'i', t: 'Above resonance: mass-controlled', d: 'The mass moves opposite to the force (phase ≈ 180°) and the amplitude falls as 1/r².' });
      if (p.input === 'base') out.push({ type: r > Math.SQRT2 ? 'g' : 'w', t: r > Math.SQRT2 ? 'Isolation: less motion reaches the mass than the base has' : 'No isolation below r = √2', d: `Transmissibility ${fmtNum(V.transmissibility(r, z), 3)}. Vibration isolators (engine and avionics mounts) are made soft so fₙ is well below the disturbing frequency; damping helps at resonance but hurts isolation above √2.` });
    }
    if (p.input === 'free' && z > 0 && z < 1) out.push({ type: 'i', t: `Amplitude halves every ${fmtNum(Math.log(2) / (z * s.wn), 3)} s`, d: 'Free vibration decays as e^(−ζωₙt). Measuring the ratio of successive peaks (log decrement δ = 2πζ/√(1−ζ²)) is how damping is measured in a ring-down test.' });
    if (p.input === 'free' && z >= 1) out.push({ type: 'i', t: z === 1 ? 'Critically damped' : 'Overdamped', d: 'No oscillation: the mass creeps back. Critical damping returns fastest without overshoot — the target for door closers and instrument needles.' });
    if (p.input === 'step') out.push({ type: 'i', t: 'A suddenly applied load doubles the deflection', d: 'With no damping the peak is exactly 2× the static value: why dropping a load onto a structure is worse than placing it gently.' });
    if (['rect', 'halfsine', 'impulse'].includes(p.input)) { const rr = p.td / s.Tn; out.push({ type: 'i', t: rr < 0.25 ? 'Short pulse: the impulse is what matters' : rr > 2 ? 'Long pulse: nearly a static load (plus overshoot)' : 'Pulse duration near the natural period', d: `t_d/Tₙ = ${fmtNum(rr, 3)}. Short pulses act like an impulse (peak ≈ I/(mωₙ)); long ones approach the static or suddenly-applied case. The worst amplification comes at t_d ≈ Tₙ.` }); }
    if (p.input === 'sweep') out.push({ type: 'i', t: 'Sine sweep: resonance shows up as a burst', d: 'Shaker tests on aircraft equipment sweep slowly through frequency; the response peaks when the instantaneous frequency passes fₙ (a fast sweep reduces and delays the peak).' });
    if (p.input === 'shock') out.push({ type: 'i', t: 'Shock response spectrum', d: 'Equipment is specified by its SRS: the peak acceleration an oscillator of each natural frequency would reach. Read your fₙ (orange line) to get the design acceleration.' });
    if (p.input === 'quake') out.push({ type: 'i', t: `Peak ground ${fmtNum(st.sdof.pga, 3)} g → mass ${fmtNum(s.aabs / G0, 3)} g`, d: 'Building codes use response spectra like the one shown: stiff short-period structures see about 2.5× the ground acceleration, flexible ones much less.' });
    insightsList(insights, out);
    extra.replaceChildren(card('Equation of motion', null, h('div', { class: 'cf-steps', html: sdofEquations(p, s) })));
    // animation
    const scale = 1 / Math.max(maxAbs(s.x), s.ybase ? maxAbs(s.ybase) : 0, 1e-30);
    const rate = Math.min(1, 0.8 / Math.max(s.fn, s.fexc || 0));
    speedLab.textContent = rate < 0.999 ? `slow motion ×${fmtNum(rate, 2)} · t = ` : 't = ';
    anim = { T: s.T, rate, loop: true, draw: (g, W, H, t) => drawSDOF(g, W, H, t, s, scale, p) };
    simT = 0; loop();
  }
  function sdofEquations(p, s) {
    const base = s.base;
    return `${base ? 'm·z̈ + c·ż + k·z = −m·ÿ_g(t),   z = x − y' : 'm·ẍ + c·ẋ + k·x = F(t)'}
ωₙ = √(k/m) = √(${fmtNum(p.k, 5)} / ${fmtNum(p.m, 4)}) = ${fmtNum(s.wn, 5)} rad/s
ζ = c / (2√(km)) = ${fmtNum(p.zeta, 4)}
<span class="c">Solved with the exact recurrence for a load varying linearly over each step (Δt = ${fmtNum(s.dt * 1000, 3)} ms).</span>`;
  }
  function drawSDOF(g, W, H, t, s, scale, p) {
    const i = Math.min(s.n - 1, Math.max(0, Math.round(t / s.dt)));
    const col = { text: css('--text'), t2: css('--text-2'), t3: css('--text-3'), acc: css('--accent'), load: css('--lower'), bg: css('--bg-elev'), mono: css('--mono') };
    const cx = W * 0.42, amp = Math.min(70, H * 0.17), yb0 = H * 0.82, yRest = H * 0.4;
    const yb = s.ybase ? s.ybase[i] * scale * amp : 0, xm = s.x[i] * scale * amp;
    const baseY = yb0 - yb, massY = yRest - xm;
    // ground / shaker
    g.fillStyle = s.base ? col.load : col.t3; g.globalAlpha = s.base ? 0.25 : 0.2; g.fillRect(cx - 90, baseY, 180, 14); g.globalAlpha = 1;
    g.strokeStyle = col.t2; g.lineWidth = 1.6; g.beginPath(); g.moveTo(cx - 90, baseY); g.lineTo(cx + 90, baseY); g.stroke();
    // spring (left) and damper (right)
    const top = massY + 28, bot = baseY;
    spring(g, cx - 30, bot, top, 7, 9, col.text);
    damper(g, cx + 30, bot, top, col.text);
    // mass
    g.fillStyle = col.acc; g.globalAlpha = 0.9; g.fillRect(cx - 55, massY - 28, 110, 56); g.globalAlpha = 1;
    g.fillStyle = '#fff'; g.font = `600 13px ${css('--font')}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('m', cx, massY);
    // rest line
    g.setLineDash([4, 4]); g.strokeStyle = col.t3; g.beginPath(); g.moveTo(cx + 70, yRest); g.lineTo(cx + 120, yRest); g.stroke(); g.setLineDash([]);
    // force arrow
    if (!s.base && p.input !== 'free') {
      const F = s.f[i] * p.m, Fm = Math.max(1e-30, p.F0 || 0, p.input === 'impulse' ? p.I / p.td : 0), L = 50 * Math.max(-1, Math.min(1, F / Fm)), y0 = massY - 34;
      if (L > 1) arrowLine(g, cx, y0, cx, y0 - L, col.load); else if (L < -1) arrowLine(g, cx, y0 + L, cx, y0, col.load);
    }
    // readouts
    g.fillStyle = col.t2; g.font = `11px ${col.mono}`; g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText(`x = ${units.fmt('disp', s.x[i], 3)}`, 12, 12); if (s.ybase) g.fillText(`y = ${units.fmt('disp', s.ybase[i], 3)}`, 12, 28);
    speedLab.textContent = speedLab.textContent.replace(/t = .*$/, '') + `t = ${t.toFixed(2)} s`;
    // trace of x(t) to the right (strip chart)
    const x0 = cx + 130, w = W - x0 - 14;
    if (w > 60) {
      g.strokeStyle = col.border || col.t3; g.globalAlpha = 0.5; g.beginPath(); g.moveTo(x0, yRest); g.lineTo(x0 + w, yRest); g.stroke(); g.globalAlpha = 1;
      const win = Math.min(s.T, 6 / Math.max(s.fn, 0.1)), n0 = Math.max(0, Math.round((t - win) / s.dt));
      g.strokeStyle = col.acc; g.lineWidth = 1.5; g.beginPath();
      for (let k = n0; k <= i; k += Math.max(1, Math.floor((i - n0) / 300))) { const X = x0 + w * ((k * s.dt - (t - win)) / win), Y = yRest - s.x[k] * scale * amp; k === n0 ? g.moveTo(X, Y) : g.lineTo(X, Y); }
      g.stroke();
    }
  }

  // ================================================================= tuned absorber
  function renderAbs() {
    const a = st.abs;
    sPar.body.replaceChildren(
      h('div', { class: 'st-lab' }, 'Primary system'),
      numField('Mass m₁', 'mass', () => a.m1, v => { if (v > 0) { a.m1 = v; upd(); } }), numField('Natural frequency f₁', null, () => a.f1, v => { if (v > 0) { a.f1 = v; upd(); } }, { suffix: 'Hz' }),
      numField('Damping ζ₁', null, () => a.z1, v => { if (v >= 0) { a.z1 = v; upd(); } }),
      h('div', { class: 'st-lab', style: { marginTop: '8px' } }, 'Absorber'),
      numField('Mass ratio µ = m₂/m₁', null, () => a.mu, v => { if (v > 0) { a.mu = v; upd(); } }),
      numField('Tuning f₂/f₁', null, () => a.ftune, v => { if (v > 0) { a.ftune = v; upd(); } }), numField('Damping ζ₂', null, () => a.z2, v => { if (v >= 0) { a.z2 = v; upd(); } }),
      h('div', { class: 'st-row' }, btnEl('Den Hartog optimum', () => { const o = V.denHartog(a.mu); a.ftune = o.f; a.z2 = o.zeta; renderAbs(); upd(); }), btnEl('Undamped notch', () => { a.ftune = 1; a.z2 = 0.001; renderAbs(); upd(); })));
    sIn.body.replaceChildren(numField('Force amplitude F₀', 'force', () => a.F0, v => { a.F0 = v; upd(); }), numField('Excitation frequency', null, () => a.fexc, v => { if (v > 0) { a.fexc = v; upd(); } }, { suffix: 'Hz' }),
      h('div', { class: 'hint' }, 'A small mass on a spring, tuned to the troublesome frequency, vibrates out of phase and cancels the force on the main mass — used in helicopters, skyscrapers (Taipei 101), engine mounts and power lines.'));
  }
  function showAbs() {
    const a = st.abs, w1 = TAU * a.f1, k1 = a.m1 * w1 * w1, c1 = 2 * a.z1 * a.m1 * w1, m2 = a.mu * a.m1, w2 = a.ftune * w1, k2 = m2 * w2 * w2, c2 = 2 * a.z2 * m2 * w2;
    const xs = [], with1 = [], with2 = [], without = [];
    let pkWith = 0, pkWithout = 0;
    for (let i = 1; i <= 800; i++) {
      const r = i / 800 * 2, w = r * w1, R = V.absorberFRF(a.m1, k1, c1, m2, k2, c2, a.F0, w);
      const X0 = a.F0 / Math.hypot(k1 - a.m1 * w * w, c1 * w);
      xs.push(r); with1.push(R.X1 * k1 / a.F0); with2.push(R.X2 * k1 / a.F0); without.push(X0 * k1 / a.F0);
      pkWith = Math.max(pkWith, R.X1 * k1 / a.F0); pkWithout = Math.max(pkWithout, X0 * k1 / a.F0);
    }
    const we = TAU * a.fexc, Re = V.absorberFRF(a.m1, k1, c1, m2, k2, c2, a.F0, we), X0e = a.F0 / Math.hypot(k1 - a.m1 * we * we, c1 * we);
    const opt = V.denHartog(a.mu);
    metrics.set([
      { k: 'Main mass amplitude', v: units.fmt('disp', Re.X1, 4), s: `without absorber ${units.fmt('disp', X0e, 3)}` },
      { k: 'Reduction at this frequency', v: `${fmtNum(X0e / Re.X1, 3)}×`, s: Re.X1 < X0e ? 'quieter' : 'worse', cls: Re.X1 > X0e ? 'bad' : '' },
      { k: 'Absorber stroke', v: units.fmt('disp', Math.hypot(Re.x2[0] - Re.x1[0], Re.x2[1] - Re.x1[1]), 4), s: 'relative to the main mass' },
      { k: 'Worst-case amplification', v: fmtNum(pkWith, 4), s: `without absorber ${pkWithout > 1e3 ? '∞' : fmtNum(pkWithout, 4)}` },
      { k: 'Den Hartog optimum', v: `f₂/f₁ ${fmtNum(opt.f, 4)}`, s: `ζ₂ = ${fmtNum(opt.zeta, 3)} · peak √(1+2/µ) = ${fmtNum(Math.sqrt(1 + 2 / a.mu), 3)}` },
    ]);
    t1.textContent = 'Main-mass response |X₁|·k₁/F₀';
    plot1.setOpts({ xlabel: 'excitation / primary natural frequency', ylabel: '|X₁| k₁ / F₀', xname: 'r', yname: 'X', logy: true, logx: false, ylim: [0.05, 200] });
    plot1.setData({ series: [{ x: xs, y: without, color: css('--text-3'), label: 'without absorber', dash: [5, 4] }, { x: xs, y: with1, color: css('--accent'), label: 'with absorber' }], vlines: [{ x: a.fexc / a.f1, color: css('--lower'), dash: [] }] });
    t2.textContent = 'Absorber mass response |X₂|·k₁/F₀';
    plot2.setOpts({ xlabel: 'excitation / primary natural frequency', ylabel: '|X₂| k₁ / F₀', xname: 'r', yname: 'X', logy: true, logx: false, ylim: [0.05, 2000] });
    plot2.setData({ series: [{ x: xs, y: with2, color: css('--lower'), label: 'absorber' }], vlines: [{ x: a.fexc / a.f1, color: css('--lower'), dash: [] }] });
    t3.textContent = 'Effect of absorber damping';
    const fam = [0, 0.05, opt.zeta, 0.3].map((zz, k) => ({ x: xs, y: xs.map(r => V.absorberFRF(a.m1, k1, c1, m2, k2, 2 * Math.max(zz, 1e-4) * m2 * w2, a.F0, r * w1).X1 * k1 / a.F0), color: [css('--bad'), css('--lam'), css('--accent'), css('--turb')][k], label: `ζ₂ = ${fmtNum(zz, 2)}`, width: k === 2 ? 2 : 1.3 }));
    plot3.setOpts({ xlabel: 'excitation / primary natural frequency', ylabel: '|X₁| k₁ / F₀', xname: 'r', yname: 'X', logy: true, logx: false, ylim: [0.05, 200] });
    plot3.setData({ series: fam });
    insightsList(insights, [
      { type: 'i', t: 'Two peaks replace one', d: 'Adding the absorber splits the single resonance into two. An undamped absorber gives a perfect notch at its tuning frequency but sharp peaks either side; damping trades the notch depth for lower peaks.' },
      { type: 'i', t: 'Den Hartog\'s optimum', d: `For mass ratio µ = ${a.mu}: tune to f₂/f₁ = 1/(1+µ) = ${fmtNum(opt.f, 4)} with ζ₂ = √(3µ/(8(1+µ)³)) = ${fmtNum(opt.zeta, 3)}. The two peaks become equal at √(1 + 2/µ) = ${fmtNum(Math.sqrt(1 + 2 / a.mu), 3)}× static.` },
      { type: Re.X1 > X0e ? 'w' : 'g', t: Re.X1 > X0e ? 'The absorber makes it worse here' : `Motion at ${fmtNum(a.fexc, 3)} Hz cut ${fmtNum(X0e / Re.X1, 3)}×`, d: 'A tuned absorber only works near its design frequency; off-tune it can amplify. Bigger µ widens the useful band.' },
    ]);
    extra.replaceChildren();
    const scale = 1 / Math.max(Re.X1, Math.hypot(...Re.x2), 1e-30);
    speedLab.textContent = 'steady state · ';
    anim = { T: 1 / a.fexc, rate: Math.min(1, 0.8 / a.fexc), loop: true, draw: (g, W, H, t) => drawAbs(g, W, H, t, Re, we, scale) };
    simT = 0; loop();
  }
  function drawAbs(g, W, H, t, R, w, scale) {
    const col = { text: css('--text'), t3: css('--text-3'), acc: css('--accent'), load: css('--lower') };
    const ph = w * t, x1 = (R.x1[0] * Math.cos(ph) - R.x1[1] * Math.sin(ph)) * scale, x2 = (R.x2[0] * Math.cos(ph) - R.x2[1] * Math.sin(ph)) * scale;
    const cx = W * 0.45, amp = Math.min(40, H * 0.09), yb = H * 0.88, y1 = H * 0.6 - x1 * amp, y2 = H * 0.25 - x2 * amp;
    g.strokeStyle = col.t3; g.lineWidth = 1.6; g.beginPath(); g.moveTo(cx - 90, yb); g.lineTo(cx + 90, yb); g.stroke();
    spring(g, cx - 25, yb, y1 + 26, 7, 9, col.text); damper(g, cx + 25, yb, y1 + 26, col.text);
    g.fillStyle = col.acc; g.fillRect(cx - 60, y1 - 26, 120, 52); g.fillStyle = '#fff'; g.font = `600 13px ${css('--font')}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('m₁', cx, y1);
    spring(g, cx - 15, y1 - 26, y2 + 16, 6, 6, col.text); damper(g, cx + 18, y1 - 26, y2 + 16, col.text);
    g.fillStyle = col.load; g.fillRect(cx - 32, y2 - 16, 64, 32); g.fillStyle = '#fff'; g.fillText('m₂', cx, y2);
    const F = Math.cos(ph); arrowLine(g, cx + 95, y1 + F * 18, cx + 95, y1 - F * 18, col.load);
    g.fillStyle = col.t3; g.font = `11px ${css('--mono')}`; g.textAlign = 'left'; g.fillText('F₀ sin ωt', cx + 105, y1);
  }

  // ================================================================= structure response
  const store = sharedStore();
  let md = null, sr = null, mdDirty = true;
  const unsub = store.on(() => { mdDirty = true; if (st.mode === 'structure' && main.isConnected) upd(); });
  function ensureModal() {
    if (!mdDirty && md) return;
    mdDirty = false;
    try { md = store.model.members.length ? modal(store.model, { nModes: Math.max(4, Math.min(30, st.str.nModes)) }) : { ok: false, error: 'empty' }; } catch (e) { console.error(e); md = { ok: false, error: 'exception' }; }
  }
  // selectable points: the joints plus the interior points of subdivided members
  function points() {
    if (!md?.ok) return store.model.nodes.map((n, i) => ({ value: i, label: `Node ${letters(i)}` }));
    const mesh = md.mesh, nOrig = store.model.nodes.length, out = [];
    mesh.nodes.forEach((n, i) => {
      if (i < nOrig) { out.push({ value: i, label: `Node ${letters(i)}` }); return; }
      const m = store.model.members[n.internal], a = store.node(m.a), b = store.node(m.b), L = Math.hypot(b.x - a.x, b.y - a.y);
      const t = Math.hypot(n.x - a.x, n.y - a.y) / L;
      out.push({ value: i, label: `Member ${n.internal + 1} at ${fmtNum(t * L / units.factor('len'), 3)} ${units.label('len')} (${(t * 100).toFixed(0)}%)`, member: m.id, t });
    });
    return out;
  }
  const nodeOpts = () => points().map(({ value, label }) => ({ value, label }));
  // where a point is free to move: pick the one that moves most in the first mode (prefer y)
  function validatePoints() {
    const p = st.str, ms = md?.ok ? md.modes : [], n = md?.ok ? md.mesh.nodes.length : store.model.nodes.length;
    const moves = (i, d) => ms.some(m => Math.abs(m.phi[i * 3 + (d === 'x' ? 0 : 1)]) > 1e-9 * Math.max(1e-30, ...[...m.phi].map(Math.abs)));
    const best = () => { let bi = 0, bd = 'y', bv = -1; if (!ms.length) return [0, 'y']; const ph = ms[0].phi; for (let i = 0; i < n; i++) for (const d of ['y', 'x']) { const v = Math.abs(ph[i * 3 + (d === 'x' ? 0 : 1)]) * (d === 'y' ? 1.0001 : 1); if (v > bv) { bv = v; bi = i; bd = d; } } return [bi, bd]; };
    // a different structure (topology) → start from the point that moves most in mode 1
    const sig = `${store.model.nodes.length}:${store.model.members.map(m => m.id + m.a + m.b).join(',')}`;
    if (sig !== p.sig) { p.sig = sig; [p.inNode, p.inDir] = best(); [p.outNode, p.outDir] = best(); p.f = null; return; }
    if (!(p.inNode < n) || !moves(p.inNode, p.inDir)) [p.inNode, p.inDir] = best();
    if (!(p.outNode < n) || !moves(p.outNode, p.outDir)) [p.outNode, p.outDir] = best();
  }
  const pointLabel = i => (points().find(q => q.value === i) || {}).label || '?';
  // static response by the stiffness method for the same force (exact; includes all modes)
  function staticResponse() {
    const p = st.str, pts = points(), pin = pts.find(q => q.value === p.inNode), pout = pts.find(q => q.value === p.outNode), mdl = store.model;
    try {
      const m2 = JSON.parse(JSON.stringify(mdl)); m2.settings = { ...m2.settings, selfWeight: false };
      const fx = p.inDir === 'x' ? p.F0 : 0, fy = p.inDir === 'y' ? p.F0 : 0;
      m2.loads = [pin.member ? { id: 'x', kind: 'point', member: pin.member, t: pin.t, fx, fy } : { id: 'x', kind: 'force', node: mdl.nodes[p.inNode].id, fx, fy }];
      const r = analyze(m2); if (!r.ok) return null;
      if (!pout.member) return p.outDir === 'x' ? r.nodes[p.outNode].ux : r.nodes[p.outNode].uy;
      const mr = r.members.find(m => m.id === pout.member), x = pout.t * mr.L;
      let k = 0, bd = Infinity; mr.x.forEach((xx, j) => { const d = Math.abs(xx - x); if (d < bd) { bd = d; k = j; } });
      return p.outDir === 'x' ? mr.gu[k] : mr.gv[k];
    } catch { return null; }
  }
  function renderStr() {
    ensureModal(); validatePoints();
    const p = st.str;
    sPar.body.replaceChildren(
      h('div', { class: 'hint' }, store.model.members.length ? `Using the structure from the Structure & FBD tab (${store.model.members.length} members). Edit it there; this updates automatically.` : 'Draw a structure in the Structure & FBD tab first.'),
      h('div', { class: 'st-row' }, btnEl('Open the structure', () => go('structure'))),
      numField('Damping ratio ζ (all modes)', null, () => p.zeta, v => { if (v >= 0 && v < 1) { p.zeta = v; upd(); } }),
      numField('Modes used', null, () => p.nModes, v => { p.nModes = Math.max(1, Math.min(30, Math.round(v))); mdDirty = true; upd(); }, { tip: 'Modal superposition sums this many modes. More modes capture local and higher-frequency response.' }));
    const b = sIn.body; b.replaceChildren(segField('', [{ value: 'frf', label: 'Harmonic force' }, { value: 'impact', label: 'Impact' }, { value: 'base', label: 'Base shaking' }], p.kind, v => { p.kind = v; renderStr(); upd(); }));
    const dirs = [{ value: 'x', label: 'x' }, { value: 'y', label: 'y' }];
    if (p.kind !== 'base') b.append(selField('Load at', nodeOpts(), p.inNode, v => { p.inNode = +v; upd(); }), segField('Load direction', dirs, p.inDir, v => { p.inDir = v; upd(); }), numField(p.kind === 'frf' ? 'Force amplitude F₀' : 'Peak force', 'force', () => p.F0, v => { p.F0 = v; upd(); }));
    if (p.kind === 'impact') b.append(selField('Pulse', [{ value: 'halfsine', label: 'Half-sine' }, { value: 'rect', label: 'Rectangular' }, { value: 'triangle', label: 'Triangular' }], p.pulse, v => { p.pulse = v; upd(); }), numField('Duration', null, () => p.td * 1000, v => { if (v > 0) { p.td = v / 1000; upd(); } }, { suffix: 'ms' }));
    if (p.kind === 'base') {
      b.append(segField('Shaking direction', dirs, p.baseDir, v => { p.baseDir = v; upd(); }), selField('Ground motion', [{ value: 'quake', label: 'Earthquake (synthetic)' }, { value: 'harmonic', label: 'Harmonic' }, { value: 'shock', label: 'Half-sine shock' }], p.baseKind, v => { p.baseKind = v; renderStr(); upd(); }));
      if (p.baseKind === 'quake') b.append(numField('Peak ground acceleration', null, () => p.pga, v => { p.pga = v; upd(); }, { suffix: 'g' }), numField('Duration', null, () => p.dur, v => { if (v > 1) { p.dur = v; upd(); } }, { suffix: 's' }));
      else b.append(numField('Peak acceleration', null, () => p.bA, v => { p.bA = v; upd(); }, { suffix: 'g' }), p.baseKind === 'harmonic' ? numField('Frequency', null, () => p.bf, v => { if (v > 0) { p.bf = v; upd(); } }, { suffix: 'Hz' }) : numField('Duration', null, () => p.td * 1000, v => { if (v > 0) { p.td = v / 1000; upd(); } }, { suffix: 'ms' }));
    }
    b.append(selField('Response at', nodeOpts(), p.outNode, v => { p.outNode = +v; upd(); }), segField('Response direction', dirs, p.outDir, v => { p.outDir = v; upd(); }));
  }
  function showStr() {
    ensureModal(); validatePoints();
    const p = st.str, mdl = store.model;
    if (!md?.ok || !md.modes.length) {
      metrics.set([{ k: 'Structure', v: 'No modes', s: md?.error === 'massless' ? 'members need a density' : 'draw a stable structure first', cls: 'bad' }]);
      insightsList(insights, [{ type: 'b', t: 'Nothing to vibrate', d: 'The Structure & FBD tab needs a stable structure (supports and members with mass) before its dynamic response can be computed.' }]);
      [plot1, plot2, plot3].forEach(pl => pl.setData({ series: [] })); anim = null; extra.replaceChildren(); return;
    }
    const modes = md.modes.slice(0, p.nModes).filter(m => m.omega > 0), z = p.zeta, mesh = md.mesh;
    const dofOf = (node, dir) => node * 3 + (dir === 'x' ? 0 : 1);
    const inD = dofOf(p.inNode, p.inDir), outD = dofOf(p.outNode, p.outDir);
    const fmax = modes[modes.length - 1].f * 1.25, f1 = modes[0].f;
    const dLab = (n, d) => `${pointLabel(n).replace('Node ', '')} (${d})`;
    const modeRows = modes.map((m, k) => [k + 1, fmtNum(m.f, 4), fmtNum(m.T, 4), (m.effX * 100).toFixed(1) + '%', (m.effY * 100).toFixed(1) + '%']);
    extra.replaceChildren(card('Modes used', 'Natural frequencies and effective modal mass (share of the total mass that moves with each mode in a base shake).', table(['Mode', 'f (Hz)', 'T (s)', 'eff. mass x', 'eff. mass y'], modeRows)));
    if (p.kind === 'frf') {
      const fs = [], amp = [], phs = [];
      const fmin = f1 / 6, N = 900; for (let i = 0; i <= N; i++) { const f = fmin * (fmax / fmin) ** (i / N); const [re, im] = V.modalFRF(modes, z, inD, outD, TAU * f, p.F0); fs.push(f); amp.push(units.fromSI('disp', Math.hypot(re, im))); phs.push(-Math.atan2(im, re) * 180 / Math.PI); }
      if (!p.f || p.f > fmax || p.f < f1 / 6) p.f = f1;
      const [re0] = V.modalFRF(modes, z, inD, outD, 0, p.F0);
      const st0 = staticResponse();
      const [rs, is] = V.modalFRF(modes, z, inD, outD, TAU * p.f, p.F0), A = Math.hypot(rs, is);
      t1.textContent = `Frequency response: ${dLab(p.outNode, p.outDir)} per force at ${dLab(p.inNode, p.inDir)}`;
      plot1.setOpts({ xlabel: 'frequency (Hz)', ylabel: `amplitude (${units.label('disp')})`, xname: 'f', yname: '|u|', logy: true, logx: true, ylim: null });
      plot1.setData({ series: [{ x: fs, y: amp, color: css('--accent'), label: '|u|' }], vlines: [...modes.map(m => ({ x: m.f, color: css('--border-strong') })), { x: p.f, color: css('--lower'), dash: [] }] });
      t2.textContent = 'Phase lag of the response';
      plot2.setOpts({ xlabel: 'frequency (Hz)', ylabel: 'phase (°)', xname: 'f', yname: 'φ', logy: false, logx: true, ylim: [-190, 190] });
      plot2.setData({ series: [{ x: fs, y: phs, color: css('--lam'), label: 'phase' }], vlines: [{ x: p.f, color: css('--lower'), dash: [] }] });
      t3.textContent = 'Click a frequency on the response curve to animate it';
      plot3.setOpts({ xlabel: 'mode', ylabel: 'contribution at the chosen frequency (%)', xname: 'mode', yname: '%', logy: false, logx: false, ylim: null });
      const Q = V.modalHarmonic(modes, z, inD, TAU * p.f, p.F0), contrib = Q.map((q, k) => Math.hypot(q[0] * modes[k].phi[outD], q[1] * modes[k].phi[outD]));
      const ct = contrib.reduce((a, b) => a + b, 0) || 1;
      plot3.setData({ series: [{ x: contrib.map((_, k) => k + 1), y: contrib.map(c => c / ct * 100), color: css('--accent'), label: 'share of |u|', points: true, line: false, pointSize: 4 }] });
      const near = modes.reduce((b, m) => (Math.abs(m.f - p.f) < Math.abs(b.f - p.f) ? m : b), modes[0]);
      metrics.set([
        { k: 'Frequency shown', v: fmtNum(p.f, 4) + ' Hz', s: `nearest mode ${fmtNum(near.f, 4)} Hz` },
        { k: `Amplitude at ${dLab(p.outNode, p.outDir)}`, v: units.fmt('disp', A, 4), s: `phase ${fmtNum(-Math.atan2(is, rs) * 180 / Math.PI, 3)}°` },
        { k: 'Static response', v: units.fmt('disp', Math.abs(st0 ?? re0), 4), s: st0 !== null ? `modal sum ${units.num('disp', re0, 4)}` : 'from the modes' },
        { k: 'Dynamic amplification', v: fmtNum(A / Math.abs(st0 ?? re0), 4), s: 'amplitude / static' },
        { k: 'Resonant peak (Q ≈ 1/2ζ)', v: z > 0 ? fmtNum(1 / (2 * z), 3) : '∞', s: 'amplification of a lone mode' },
      ]);
      insightsList(insights, [
        { type: 'i', t: 'Peaks at the natural frequencies', d: 'Each mode adds a resonant peak (grey lines). A peak is missing if the mode has a node (no motion) at the load or response point — that is why shakers and sensors are placed carefully in a ground vibration test.' },
        { type: Math.abs(near.f - p.f) / near.f < 0.05 ? 'w' : 'i', t: Math.abs(near.f - p.f) / near.f < 0.05 ? `Resonance with mode ${md.modes.indexOf(near) + 1}` : 'Operating deflection shape', d: 'The animation shows how the structure moves at this frequency: near a resonance it looks like that mode, between modes it is a blend.' },
        { type: 'i', t: 'Check: low-frequency limit', d: `As f → 0 the modal sum (${units.fmt('disp', re0, 4)}) approaches the static stiffness solution${st0 !== null ? ` (${units.fmt('disp', st0, 4)})` : ''}; the gap is the contribution of modes not included.` },
      ]);
      plot1.canvas.onclick = e => { const pl = plot1, r = pl.canvas.getBoundingClientRect(), X = e.clientX - r.left, { pl: L, iw } = pl.inner, B = pl.B; const v = B.x0 + (X - L) / iw * (B.x1 - B.x0), f = pl.opts.logx ? 10 ** v : v; if (f > 0) { p.f = f; upd(); } };
      const w = TAU * p.f, sc = animScale(Q.map((q, k) => [q[0], q[1], modes[k]]));
      anim = { T: 1 / p.f, rate: Math.min(1, 0.8 / p.f), loop: true, draw: (g, W, H, t) => drawStr(g, W, H, U => { const c = Math.cos(w * t), s = Math.sin(w * t); U.fill(0); Q.forEach((q, k) => { const a = q[0] * c - q[1] * s; const ph = modes[k].phi; for (let d = 0; d < U.length; d++) U[d] += a * ph[d]; }); }, sc) };
      speedLab.textContent = `${fmtNum(p.f, 3)} Hz${p.f > 0.8 ? ` · slowed ×${fmtNum(0.8 / p.f, 2)}` : ''}`;
      simT = 0; loop(); return;
    }
    // transient: impact or base shaking
    const Tmin = 1 / modes[modes.length - 1].f;
    let dt = Tmin / 25, T, f, gam, title;
    if (p.kind === 'impact') {
      dt = Math.min(dt, p.td / 30); T = p.td + Math.min(40, z > 0 ? Math.min(3 / (z * modes[0].omega), 15 / f1) : 8 / f1);
      dt = Math.max(dt, T / 40000);
      f = V.makeInput(p.pulse, { td: p.td }, dt, T).f.map(x => x * p.F0);
      gam = modes.map(m => m.phi[inD]); title = `impact at ${dLab(p.inNode, p.inDir)}`;
    } else {
      if (p.baseKind === 'quake') { dt = Math.min(dt, 0.005); T = p.dur + 3 / f1; }
      else if (p.baseKind === 'shock') { dt = Math.min(dt, p.td / 30); T = p.td + Math.min(30, 6 / f1); }
      else { dt = Math.min(dt, 1 / (p.bf * 40)); T = Math.min(60, Math.max(10 / p.bf, z > 0 ? 3 / (z * modes[0].omega) : 10 / f1)); }
      dt = Math.max(dt, T / 40000);
      const ag = p.baseKind === 'quake' ? V.makeInput('quake', { duration: p.dur, seed: 11 }, dt, T).f.map(x => x * p.pga * G0) : p.baseKind === 'shock' ? V.makeInput('halfsine', { td: p.td }, dt, T).f.map(x => x * p.bA * G0) : V.makeInput('harmonic', { freq: p.bf }, dt, T).f.map(x => x * p.bA * G0);
      f = ag.map(a => -a); gam = modes.map(m => (p.baseDir === 'x' ? m.Lx : m.Ly)); title = `base shaking in ${p.baseDir}`;
      sr = { ag };
    }
    const resp = V.modalTransient(modes, z, gam, f, dt), n = f.length;
    const u = new Float64Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < modes.length; k++) s += modes[k].phi[outD] * resp[k].u[i]; u[i] = s; }
    let pk = 0, tpk = 0; for (let i = 0; i < n; i++) if (Math.abs(u[i]) > pk) { pk = Math.abs(u[i]); tpk = i * dt; }
    const still = pk < 1e-12;
    if (still) { pk = 0; u.fill(0); }
    const stride = Math.max(1, Math.floor(n / 2500)), ts = [], us = [], fsr = [];
    for (let i = 0; i < n; i += stride) { ts.push(i * dt); us.push(units.fromSI('disp', u[i])); fsr.push(p.kind === 'impact' ? units.fromSI('force', f[i]) : -f[i] / G0); }
    t1.textContent = `Displacement at ${dLab(p.outNode, p.outDir)} — ${title}`;
    plot1.setOpts({ xlabel: 'time (s)', ylabel: `${p.kind === 'base' ? 'relative ' : ''}displacement (${units.label('disp')})`, xname: 't', yname: 'u', logy: false, logx: false, ylim: null });
    plot1.setData({ series: [{ x: ts, y: us, color: css('--accent'), label: 'u(t)' }] });
    plot1.canvas.onclick = null;
    t2.textContent = p.kind === 'impact' ? 'Applied force' : 'Ground acceleration (g)';
    plot2.setOpts({ xlabel: 'time (s)', ylabel: p.kind === 'impact' ? `force (${units.label('force')})` : 'acceleration (g)', xname: 't', yname: 'F', logy: false, logx: false, ylim: null });
    plot2.setData({ series: [{ x: ts, y: fsr, color: css('--lower'), label: p.kind === 'impact' ? 'F(t)' : 'ÿ_g(t)' }] });
    const ms = [{ k: `Peak at ${dLab(p.outNode, p.outDir)}`, v: units.fmt('disp', pk, 4), s: `at t = ${fmtNum(tpk, 3)} s` }, { k: 'Modes used', v: String(modes.length), s: `${fmtNum(modes[0].f, 3)} – ${fmtNum(modes[modes.length - 1].f, 3)} Hz` }];
    const out = [];
    if (p.kind === 'base') {
      // base shear V(t) = Σ ω² L q
      const L = modes.map(m => (p.baseDir === 'x' ? m.Lx : m.Ly)), Vb = [];
      let vpk = 0; for (let i = 0; i < n; i += stride) { let s = 0; for (let k = 0; k < modes.length; k++) s += modes[k].omega ** 2 * L[k] * resp[k].u[i]; Vb.push(units.fromSI('force', s)); vpk = Math.max(vpk, Math.abs(units.toSI('force', Vb[Vb.length - 1]))); }
      const Mt = p.baseDir === 'x' ? modes[0].mass.totX : modes[0].mass.totY, effSum = modes.reduce((a, m) => a + (p.baseDir === 'x' ? m.effX : m.effY), 0);
      t3.textContent = `Base ${p.baseDir === 'x' ? 'shear' : 'force'} (sum of support reactions)`;
      plot3.setOpts({ xlabel: 'time (s)', ylabel: `force (${units.label('force')})`, xname: 't', yname: 'V', logy: false, logx: false, ylim: null });
      plot3.setData({ series: [{ x: ts, y: Vb, color: css('--turb'), label: 'V(t)' }] });
      const pga = maxAbs(sr.ag);
      ms.push({ k: `Peak base ${p.baseDir === 'x' ? 'shear' : 'force'}`, v: units.fmt('force', vpk, 4), s: `${fmtNum(vpk / (Mt * G0), 3)} × weight` }, { k: 'Mass participating', v: (effSum * 100).toFixed(1) + '%', s: `of ${units.fmt('mass', Mt, 4)}` }, { k: 'Peak ground acceleration', v: fmtNum(pga / G0, 3) + ' g' });
      out.push({ type: 'i', t: `Peak base shear = ${fmtNum(vpk / (Mt * pga), 3)} × mass × peak ground acceleration`, d: 'A rigid structure would see exactly 1×; flexible ones see more near resonance and less when their period is long compared with the shaking. That ratio is what a design response spectrum gives.' });
      if (effSum < 0.9) out.push({ type: 'w', t: `Only ${(effSum * 100).toFixed(0)}% of the mass is captured`, d: 'Seismic codes ask for ≥ 90% effective mass. Increase the number of modes.' });
    } else {
      const sv = staticResponse(), st0 = sv === null ? null : Math.abs(sv);
      if (st0) ms.push({ k: 'Static deflection (same peak force)', v: units.fmt('disp', st0, 4) }, { k: 'Dynamic load factor', v: fmtNum(pk / st0, 4), s: `t_d·f₁ = ${fmtNum(p.td * f1, 3)}` });
      t3.textContent = 'Modal contributions (peak |φ·q| per mode)';
      const cont = modes.map((m, k) => { let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(m.phi[outD] * resp[k].u[i])); return units.fromSI('disp', mx); });
      plot3.setOpts({ xlabel: 'mode', ylabel: `peak contribution (${units.label('disp')})`, xname: 'mode', yname: 'u', logy: false, logx: false, ylim: null });
      plot3.setData({ series: [{ x: cont.map((_, k) => k + 1), y: cont, color: css('--accent'), points: true, line: false, pointSize: 4, label: 'peak per mode' }] });
      out.push({ type: 'i', t: p.td * f1 < 0.25 ? 'Short impact: many modes ring' : 'Impact comparable to the first period', d: `The pulse lasts ${fmtNum(p.td * 1000, 3)} ms against a fundamental period of ${fmtNum(1000 / f1, 3)} ms. Short, sharp impacts excite high modes (see the contributions); long pulses mostly load the structure quasi-statically.` });
    }
    if (still) out.push({ type: 'w', t: 'This point does not move in this direction', d: `For ${p.kind === 'base' ? `shaking in ${p.baseDir}` : 'this load'} the chosen point stays still along ${p.outDir} (for example a beam shaken along its length). Try the other direction or another point.` });
    out.push({ type: 'i', t: 'Modal superposition', d: `Each mode is a single-degree-of-freedom oscillator q̈ + 2ζωq̇ + ω²q = Γ·f(t), solved exactly step by step and added up as u = Σφq. ζ = ${z} is applied to every mode.` });
    metrics.set(ms); insightsList(insights, out);
    const qs = resp.map(r => r.u), sc = animScale(modes.map((m, k) => [maxAbs(qs[k]), 0, m]));
    anim = { T, rate: 1, loop: true, draw: (g, W, H, t) => drawStr(g, W, H, U => { const i = Math.min(n - 1, Math.round(t / dt)); U.fill(0); modes.forEach((m, k) => { const a = qs[k][i]; for (let d = 0; d < U.length; d++) U[d] += a * m.phi[d]; }); }, sc, t) };
    anim.rate = Math.min(1, 0.8 / f1);
    speedLab.textContent = anim.rate < 1 ? `slowed ×${fmtNum(anim.rate, 2)} · ` : '';
    simT = 0; loop();

  }
  // displacement scale: the largest nodal motion is drawn as 8% of the model size
  function animScale(terms) {
    const mesh = md.mesh; let mx = 0;
    const U = new Float64Array(mesh.ndof); for (const [re, im, m] of terms) { const a = Math.hypot(re, im); for (let d = 0; d < U.length; d++) U[d] += Math.abs(a * m.phi[d]); }
    for (let i = 0; i < mesh.nodes.length; i++) mx = Math.max(mx, Math.hypot(U[3 * i], U[3 * i + 1]));
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const n of mesh.nodes) { x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y); }
    return 0.08 * Math.max(x1 - x0, y1 - y0, 1e-3) / (mx || 1);
  }
  function drawStr(g, W, H, fill, sc, tNow) {
    const mesh = md.mesh, mdl = store.model, p = st.str;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const n of mesh.nodes) { x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y); }
    const span = Math.max(x1 - x0, y1 - y0, 1e-3), s = Math.min((W - 120) / Math.max(x1 - x0, span * 0.3), (H - 110) / Math.max(y1 - y0, span * 0.3));
    const ox = (W - (x1 - x0) * s) / 2 - x0 * s, oy = (H + (y1 - y0) * s) / 2 + y0 * s, X = x => ox + x * s, Y = y => oy - y * s;
    const col = { text: css('--text'), t3: css('--text-3'), strong: css('--border-strong'), acc: css('--accent'), load: css('--lower'), good: css('--good') };
    // base shake: draw ground offset (visual only)
    g.lineCap = 'round';
    for (const e of mesh.elems) { const a = mesh.nodes[e.n1], b = mesh.nodes[e.n2]; g.strokeStyle = col.strong; g.lineWidth = 1.5; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(X(a.x), Y(a.y)); g.lineTo(X(b.x), Y(b.y)); g.stroke(); }
    g.setLineDash([]);
    const U = new Float64Array(mesh.ndof); fill(U);
    g.strokeStyle = col.acc; g.lineWidth = 2.6;
    for (const e of mesh.elems) { const pts = elementCurve(mesh, e, U, sc, e.frame ? 5 : 1); g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.stroke(); }
    // supports
    g.fillStyle = col.t3;
    for (const sp of mdl.supports) { const i = mdl.nodes.findIndex(n => n.id === sp.node); if (i < 0) continue; const n = mesh.nodes[i]; g.beginPath(); g.moveTo(X(n.x), Y(n.y)); g.lineTo(X(n.x) - 8, Y(n.y) + 13); g.lineTo(X(n.x) + 8, Y(n.y) + 13); g.closePath(); g.fill(); }
    // load / response markers
    const nodePos = i => { const n = mesh.nodes[i]; return [X(n.x + sc * U[3 * i]), Y(n.y + sc * U[3 * i + 1])]; };
    if (p.kind !== 'base') { const [px, py] = nodePos(p.inNode); if (p.inDir === 'x') arrowLine(g, px - 40, py, px - 6, py, col.load); else arrowLine(g, px, py - 40, px, py - 6, col.load); }
    const [rx, ry] = nodePos(p.outNode); g.strokeStyle = col.good; g.lineWidth = 2; g.beginPath(); g.arc(rx, ry, 7, 0, TAU); g.stroke();
    g.font = `600 11px ${css('--font')}`; g.fillStyle = css('--text-2'); g.textAlign = 'center';
    mdl.nodes.forEach((n, i) => { const [px, py] = nodePos(i); g.fillText(letters(i), px - 10, py - 10); });
    if (tNow !== undefined) { g.fillStyle = col.t3; g.font = `11px ${css('--mono')}`; g.textAlign = 'left'; g.fillText(`t = ${tNow.toFixed(2)} s`, 12, 18); }
    g.fillStyle = col.t3; g.font = `10.5px ${css('--font')}`; g.textAlign = 'right'; g.fillText(`motion exaggerated ×${fmtNum(sc, 3)}`, W - 12, H - 12);
  }

  // ================================================================= shared
  const btnEl = (label, fn) => { const b = h('button', { type: 'button', class: 'btn sm' }, label); b.addEventListener('click', fn); return b; };
  function renderMode() {
    sMode.body.replaceChildren(segField('', [{ value: 'sdof', label: 'Spring–mass (1 DOF)' }, { value: 'abs', label: 'Tuned absorber' }, { value: 'structure', label: 'Your structure' }], st.mode, v => { st.mode = v; renderAll(); }));
  }
  let timer = 0;
  function upd() { save(); clearTimeout(timer); timer = setTimeout(show, 60); }
  function show() {
    try { if (st.mode === 'sdof') showSDOF(); else if (st.mode === 'abs') showAbs(); else showStr(); }
    catch (e) { console.error(e); insightsList(insights, [{ type: 'b', t: 'Calculation failed', d: String(e.message || e) }]); }
  }
  function renderAll() { renderMode(); if (st.mode === 'sdof') renderSDOF(); else if (st.mode === 'abs') renderAbs(); else renderStr(); save(); show(); }
  const onUnits = () => renderAll();
  addEventListener('unitschange', onUnits);
  renderAll();
  return {
    controls, main,
    show() { if (st.mode === 'structure') { mdDirty = true; renderStr(); } show(); requestAnimationFrame(() => { plot1.draw(); plot2.draw(); plot3.draw(); paint(); }); },
    hide() { cancelAnimationFrame(raf); },
    destroy() { cancelAnimationFrame(raf); removeEventListener('unitschange', onUnits); unsub(); },
  };
}

// ---------------------------------------------------------------- glyphs
function spring(g, x, yb, yt, coils, w, color) {
  g.strokeStyle = color; g.lineWidth = 1.6; g.beginPath(); g.moveTo(x, yb);
  const L = yb - yt, end = 8; g.lineTo(x, yb - end);
  const n = coils * 2; for (let k = 1; k < n; k++) g.lineTo(x + (k % 2 ? w : -w), yb - end - (L - 2 * end) * k / n);
  g.lineTo(x, yt + end); g.lineTo(x, yt); g.stroke();
}
function damper(g, x, yb, yt, color) {
  const mid = (yb + yt) / 2;
  g.strokeStyle = color; g.lineWidth = 1.6; g.beginPath();
  g.moveTo(x, yb); g.lineTo(x, mid + 10); g.moveTo(x - 9, mid + 10); g.lineTo(x - 9, mid - 8); g.moveTo(x + 9, mid + 10); g.lineTo(x + 9, mid - 8); g.moveTo(x - 9, mid + 10); g.lineTo(x + 9, mid + 10);
  g.moveTo(x - 6, Math.min(mid - 2, yt + 14)); g.lineTo(x + 6, Math.min(mid - 2, yt + 14)); g.moveTo(x, Math.min(mid - 2, yt + 14)); g.lineTo(x, yt);
  g.stroke();
}
function arrowLine(g, x1, y1, x2, y2, color) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 2;
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  g.beginPath(); g.moveTo(x2, y2); g.lineTo(x2 - 8 * Math.cos(a - 0.4), y2 - 8 * Math.sin(a - 0.4)); g.lineTo(x2 - 8 * Math.cos(a + 0.4), y2 - 8 * Math.sin(a + 0.4)); g.closePath(); g.fill();
}
function maxAbs(a) { let m = 0; for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > m) m = v; } return m; }
