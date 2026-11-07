// Shock tube: exact Riemann solution, animated gas parcels, x–t wave diagram, profiles.
import { h, section, slider, select, field, icon, cssVar, segmented } from '../../lib/ui.js';
import { Plot } from '../../lib/plot.js';
import * as G from '../../solvers/gasdyn.js';
import { metricsGrid, insightsList, card, fmt } from './common.js';
import { turbo } from './field.js';

export function tubeTab({ keep = o => o } = {}) {
  const S = keep({ drv: 'air', dvn: 'air', p41: 10, T41: 1, p1: 100, T1: 300, L: 10, xd: 0.4, t: 0.5, play: false, q: 'p' });
  const gasOpts = G.GASES.map(g => ({ value: g.id, label: g.label }));
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });
  const secG = section('Gases');
  const dSel = select(gasOpts, S.drv, v => { S.drv = v; update(true); }), nSel = select(gasOpts, S.dvn, v => { S.dvn = v; update(true); });
  secG.body.append(field('Driver gas (4, high pressure)', dSel, 'Light, hot driver gases (helium, hydrogen) have a high speed of sound and make much stronger shocks for the same pressure ratio.'), field('Driven / test gas (1)', nSel));
  const secP = section('Initial state');
  const p41S = slider({ label: 'Pressure ratio p₄/p₁', min: 1.01, max: 10000, log: true, value: S.p41, format: v => (+v).toFixed(2), onInput: v => { S.p41 = v; update(true); } });
  const T41S = slider({ label: 'Temperature ratio T₄/T₁', min: 0.2, max: 15, step: 0.01, value: S.T41, digits: 2, info: 'Heating the driver raises its sound speed, which strengthens the shock.', onInput: v => { S.T41 = v; update(true); } });
  const p1S = slider({ label: 'Driven pressure p₁', min: 0.1, max: 1000, log: true, value: S.p1, format: v => (+v).toFixed(2) + ' kPa', onInput: v => { S.p1 = v; update(true); } });
  const T1S = slider({ label: 'Driven temperature T₁', min: 50, max: 2000, step: 1, value: S.T1, format: v => (+v).toFixed(0) + ' K', onInput: v => { S.T1 = v; update(true); } });
  const xdS = slider({ label: 'Diaphragm position', min: 0.1, max: 0.9, step: 0.01, value: S.xd, format: v => (100 * v).toFixed(0) + '% of L', onInput: v => { S.xd = v; update(true); } });
  const LS = slider({ label: 'Tube length L', min: 0.5, max: 50, step: 0.1, value: S.L, format: v => (+v).toFixed(1) + ' m', onInput: v => { S.L = v; update(true); } });
  secP.body.append(p41S.el, T41S.el, p1S.el, T1S.el, xdS.el, LS.el);
  const ex = select([{ value: '', label: 'Load an example…' }, { value: 'sod', label: 'Sod problem (air, p₄/p₁=10, ρ₄/ρ₁=8)' }, { value: 'he', label: 'Helium driver into air (p₄/p₁=100)' }, { value: 'strong', label: 'Strong shock (He, p₄/p₁=5000, hot)' }, { value: 'weak', label: 'Weak shock (acoustic limit, p₄/p₁=1.1)' }], '', v => {
    const P = { sod: { drv: 'air', dvn: 'air', p41: 10, T41: 1.25 }, he: { drv: 'he', dvn: 'air', p41: 100, T41: 1 }, strong: { drv: 'he', dvn: 'air', p41: 5000, T41: 3 }, weak: { drv: 'air', dvn: 'air', p41: 1.1, T41: 1 } }[v];
    if (P) { Object.assign(S, P); dSel.value = S.drv; nSel.value = S.dvn; p41S.set(S.p41); T41S.set(S.T41); update(true); }
    ex.value = '';
  });
  secG.body.prepend(field('Examples', ex));
  controls.append(secG.el, secP.el);

  // main
  const metrics = metricsGrid();
  const playBtn = h('button', { class: 'btn', type: 'button' });
  const tS = slider({ label: 'Time after diaphragm burst', min: 0, max: 1, step: 0.001, value: S.t, format: v => (v * 100).toFixed(0) + '%', onInput: v => { S.t = v; S.play = false; paintPlay(); draw(); } });
  const resetBtn = h('button', { class: 'btn', type: 'button', title: 'Restart' }, icon('reset', 16));
  resetBtn.addEventListener('click', () => { S.t = 0; tS.set(0); S.play = true; paintPlay(); draw(); });
  const paintPlay = () => playBtn.replaceChildren(icon(S.play ? 'pause' : 'play', 16), S.play ? 'Pause' : 'Play');
  playBtn.addEventListener('click', () => { S.play = !S.play; if (S.play && S.t >= 0.999) S.t = 0; paintPlay(); });
  const tLabel = h('span', { class: 'hint', style: { margin: 0, minWidth: '90px' } });
  const qSeg = segmented([{ value: 'p', label: 'Pressure' }, { value: 'rho', label: 'Density' }, { value: 'T', label: 'Temperature' }, { value: 'u', label: 'Velocity' }], 'p', v => { S.q = v; draw(); });
  const tube = h('canvas', { style: { width: '100%', height: '150px', display: 'block' } });
  const tubeCard = h('div', { class: 'plot-card' }, h('div', { class: 'plot-head' }, h('h4', {}, 'Tube'), qSeg.el), tube, h('div', { class: 'cf-play', style: { marginTop: '8px' } }, playBtn, resetBtn, tS.el, tLabel));
  const xtCard = card('x–t wave diagram', 'Space–time paths of the shock, contact surface and expansion fan, plus gas-parcel paths (thin). The horizontal line is the current time.');
  const xtPlot = new Plot(xtCard, { xlabel: 'x (m)', ylabel: 't (ms)', xname: 'x', yname: 't ms', xfmt: v => v.toFixed(3), yfmt: v => v.toFixed(3), legend: true });
  const pCard = card('Profiles at this time', 'Normalized by the driven-gas state 1. Regions: 4 driver · fan · 3 expanded driver · 2 shocked test gas · 1 test gas.');
  const pPlot = new Plot(pCard, { xlabel: 'x (m)', ylabel: 'ratio to state 1', xname: 'x', yname: 'value', xfmt: v => v.toFixed(3), yfmt: v => v.toPrecision(4) });
  const insEl = h('div');
  const insCard = h('div', { class: 'plot-card' }, h('div', { class: 'plot-head' }, h('h4', {}, 'What you\'re seeing')), insEl);
  const resCard = card('Wave and region results'); const resEl = h('div', { class: 'cf-res' }); resCard.append(resEl);
  main.append(metrics.el, tubeCard, h('div', { class: 'plots' }, xtCard, pCard), h('div', { class: 'cf-grid2' }, resCard, insCard));

  let sol = null, tmax = 1, parcels = [], A = null;
  function update(resetParcels) {
    const g4 = G.GASES.find(g => g.id === S.drv), g1 = G.GASES.find(g => g.id === S.dvn);
    const p1 = S.p1 * 1000, T1 = S.T1, p4 = p1 * S.p41, T4 = T1 * S.T41;
    const L = { rho: p4 / (g4.R * T4), u: 0, p: p4, g: g4.g }, R = { rho: p1 / (g1.R * T1), u: 0, p: p1, g: g1.g };
    sol = G.riemann(L, R);
    A = { L, R, g4, g1, p1, T1, p4, T4, a1: Math.sqrt(g1.g * g1.R * T1), a4: Math.sqrt(g4.g * g4.R * T4) };
    const xd = S.xd * S.L;
    const right = sol.right.type === 'shock' ? sol.right.S : sol.right.head;
    tmax = 0.98 * Math.min((S.L - xd) / Math.abs(right), xd / Math.abs(sol.left.type === 'fan' ? sol.left.head : sol.left.S));
    // parcels
    parcels = Array.from({ length: 90 }, (_, i) => (i + 0.5) / 90 * S.L);
    xtCache = null;
    // results
    const Ms = sol.right.S / A.a1, s2 = sol.sample(0.5 * (sol.u + sol.right.S)), s3 = sol.sample(0.5 * (sol.left.tail + sol.u));
    const T2 = s2.p / (s2.rho * g1.R), T3 = s3.p / (s3.rho * g4.R);
    const testX = xd + 0.85 * (S.L - xd), tShock = (testX - xd) / sol.right.S, tContact = (testX - xd) / sol.u;
    metrics.set([{ k: 'Shock Mach Ms', v: fmt(Ms, 3) }, { k: 'Shock speed', v: sol.right.S.toFixed(0) + ' m/s' }, { k: 'p₂/p₁', v: fmt(sol.p / p1, 3) }, { k: 'T₂/T₁', v: fmt(T2 / T1, 3) }, { k: 'Gas speed u₂', v: sol.u.toFixed(0) + ' m/s', s: 'M₂ = ' + (sol.u / Math.sqrt(g1.g * g1.R * T2)).toFixed(3) }, { k: 'Test time @85%', v: ((tContact - tShock) * 1000).toFixed(3) + ' ms', s: 'shock → contact' }]);
    const rows = [['p₄/p₁', fmt(S.p41)], ['p₂/p₁ = p₃/p₁', fmt(sol.p / p1)], ['Shock Mach Ms', fmt(Ms)], ['Shock speed W', sol.right.S.toFixed(1) + ' m/s'], ['Contact speed u₂ = u₃', sol.u.toFixed(1) + ' m/s'],
      ['ρ₂/ρ₁', fmt(s2.rho / R.rho)], ['T₂', T2.toFixed(1) + ' K'], ['T₃', T3.toFixed(1) + ' K'], ['ρ₃/ρ₄', fmt(s3.rho / L.rho)],
      ['Fan head speed', (sol.left.head ?? sol.left.S).toFixed(1) + ' m/s'], ['Fan tail speed', (sol.left.tail ?? 0).toFixed(1) + ' m/s'], ['Sound speed a₁ / a₄', A.a1.toFixed(1) + ' / ' + A.a4.toFixed(1) + ' m/s'],
      ['Ideal shock-tube check', 'p₄/p₁ = ' + fmt(shockTubeEq(Ms, g1.g, g4.g, A.a1 / A.a4), 4)]];
    resEl.replaceChildren(...rows.map(([k, v], i) => h('div', { class: 'r' + (i < 3 ? ' hl' : '') }, h('span', {}, k), h('span', {}, v))));
    const ins = [{ type: 'i', t: 'Three waves from one burst', d: `The diaphragm bursts at t = 0. A shock (Ms = ${Ms.toFixed(2)}) races into the test gas, a contact surface (the driver/test gas interface) follows at ${sol.u.toFixed(0)} m/s, and an expansion fan runs back into the driver. Pressure and velocity match across the contact; density and temperature don't.` },
      { type: 'g', t: 'The shock-tube equation', d: 'p₄/p₁ = [2γ₁Ms² − (γ₁−1)]/(γ₁+1) · [1 − (γ₄−1)/(γ₁+1)·(a₁/a₄)(Ms − 1/Ms)]^(−2γ₄/(γ₄−1)). Even infinite p₄/p₁ only gives a finite Ms, set by a₄/a₁ — which is why hot, light driver gases are used.' }];
    if (Ms > 3) ins.push({ type: 'w', t: 'Real-gas effects', d: `T₂ ≈ ${T2.toFixed(0)} K. Above ~2000 K, air molecules start vibrating and dissociating, so the ideal-gas (constant-γ) answer overestimates T₂.` });
    insightsList(insEl, ins);
    if (resetParcels) { S.t = Math.min(S.t, 1); }
    draw();
  }
  function shockTubeEq(Ms, g1, g4, a14) { return (2 * g1 * Ms * Ms - (g1 - 1)) / (g1 + 1) * (1 - (g4 - 1) / (g1 + 1) * a14 * (Ms - 1 / Ms)) ** (-2 * g4 / (g4 - 1)); }

  const stateAt = (x, t) => {
    const xd = S.xd * S.L;
    if (t <= 0) return x < xd ? { ...A.L, region: 'L' } : { ...A.R, region: 'R' };
    return sol.sample((x - xd) / t);
  };
  const Rgas = s => (['L', 'L*', 'fan'].includes(s.region) ? A.g4.R : A.g1.R);
  function parcelPos(t, n = 160) {
    const out = parcels.slice();
    const dt = t / n;
    for (let k = 0; k < n; k++) { const tm = (k + 0.5) * dt; for (let i = 0; i < out.length; i++) out[i] += stateAt(out[i], tm).u * dt; }
    return out;
  }
  function draw() {
    if (!sol) return;
    const t = S.t * tmax, xd = S.xd * S.L, css = cssVar;
    tLabel.textContent = 't = ' + (t * 1000).toFixed(3) + ' ms';
    // profiles
    const xs = [], P = [], Rh = [], T = [], U = [];
    for (let i = 0; i <= 600; i++) { const x = S.L * i / 600, s = stateAt(x, t); xs.push(x); P.push(s.p / A.p1); Rh.push(s.rho / A.R.rho); T.push(s.p / (s.rho * Rgas(s)) / A.T1); U.push(s.u / A.a1); }
    pPlot.setData({ series: [{ x: xs, y: P, color: css('--accent'), label: 'p/p₁' }, { x: xs, y: Rh, color: css('--lower'), label: 'ρ/ρ₁' }, { x: xs, y: T, color: css('--bad'), label: 'T/T₁' }, { x: xs, y: U, color: css('--good'), label: 'u/a₁' }] });
    // x–t (cached per input state)
    if (!xtCache) xtCache = buildXT(xd, css);
    xtPlot.setData({ series: xtCache, hlines: [{ y: t * 1000, color: css('--accent'), dash: [4, 3], bound: true }] });
    xtPlot.setOpts({ xlim: [0, S.L], ylim: [0, tmax * 1000] });
    drawTube(t, xd, css, xs, P, Rh, T, U);
  }
  let xtCache = null;
  function buildXT(xd, css) {
    const tm = tmax * 1000, line = (sp, c, lab, dash, w = 2) => ({ x: [xd, xd + sp * tmax], y: [0, tm], color: c, label: lab, dash, width: w });
    const series = [line(sol.right.S, css('--bad'), 'shock', null, 2.4), line(sol.u, css('--turb'), 'contact', [6, 4]), line(sol.left.head, css('--good'), 'fan head'), line(sol.left.tail, css('--good'), 'fan tail', [3, 3], 1.4)];
    for (let k = 1; k < 4; k++) { const a = sol.left.head + (sol.left.tail - sol.left.head) * k / 4; series.push({ ...line(a, css('--good'), null, null, 0.8), alpha: 0.5, noHover: true }); }
    // parcel paths (every 8th)
    const nT = 40, paths = parcels.map(() => ({ x: [], y: [] }));
    for (let k = 0; k <= nT; k++) { const pp = parcelPos(tmax * k / nT, 20 + k * 2); for (let i = 0; i < parcels.length; i += 6) { paths[i].x.push(pp[i]); paths[i].y.push(tm * k / nT); } }
    for (let i = 0; i < parcels.length; i += 6) series.push({ ...paths[i], color: css('--text-3'), width: 0.8, alpha: 0.6, noHover: true });
    return series;
  }
  function drawTube(t, xd, css, xs, P, Rh, T, U) {
    const W = tube.clientWidth, H = 150, dpr = Math.min(devicePixelRatio || 1, 2);
    if (tube.width !== Math.round(W * dpr)) { tube.width = Math.round(W * dpr); tube.height = H * dpr; }
    const c = tube.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    const top = 30, ht = 70, X = x => 8 + (W - 16) * x / S.L;
    const arr = S.q === 'p' ? P : S.q === 'rho' ? Rh : S.q === 'T' ? T : U;
    let lo = Math.min(...arr), hi = Math.max(...arr); if (hi - lo < 1e-9) { hi = lo + 1; }
    for (let i = 0; i < xs.length - 1; i++) { const [r, g, b] = turbo((arr[i] - lo) / (hi - lo)); c.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`; c.fillRect(X(xs[i]), top, X(xs[i + 1]) - X(xs[i]) + 1, ht); }
    c.strokeStyle = css('--border-strong'); c.lineWidth = 3; c.strokeRect(8, top, W - 16, ht);
    // parcels
    const pp = parcelPos(t);
    c.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 0; i < pp.length; i++) for (let k = 0; k < 3; k++) c.fillRect(X(pp[i]) - 1, top + 10 + k * 25 + (i % 2) * 10, 2, 8);
    // wave markers
    const mark = (x, text, col) => { c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 2; c.beginPath(); c.moveTo(X(x), top - 4); c.lineTo(X(x), top + ht + 4); c.stroke(); c.font = '600 11px ' + css('--font'); c.textAlign = 'center'; c.fillText(text, X(x), top - 9); };
    if (t > 0) { mark(xd + sol.right.S * t, 'shock', css('--bad')); mark(xd + sol.u * t, 'contact', css('--turb')); mark(xd + sol.left.head * t, 'fan head', css('--good')); mark(xd + sol.left.tail * t, 'tail', css('--good')); }
    else mark(xd, 'diaphragm', css('--text-2'));
    c.fillStyle = css('--text-3'); c.font = '11px ' + css('--mono'); c.textAlign = 'left';
    const nm = { p: 'p/p₁', rho: 'ρ/ρ₁', T: 'T/T₁', u: 'u/a₁' }[S.q];
    c.fillText(`${nm}: ${lo.toFixed(2)} (blue) → ${hi.toFixed(2)} (red)`, 8, top + ht + 22);
    c.textAlign = 'right'; c.fillText(`driver: ${A.g4.label} · test gas: ${A.g1.label}`, W - 8, top + ht + 22);
  }
  let alive = true, lastT = performance.now();
  const loop = now => { if (!alive) return; const dt = (now - lastT) / 1000; lastT = now; if (S.play) { S.t = Math.min(1, S.t + dt / 6); tS.set(S.t); if (S.t >= 1) { S.play = false; paintPlay(); } draw(); } requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  paintPlay(); update(true);
  return { controls, main, show: () => requestAnimationFrame(draw), destroy: () => { alive = false; } };
}
