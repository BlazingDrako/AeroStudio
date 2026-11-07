// Turbomachinery: mean-line design of axial compressor and turbine stages (velocity triangles,
// animated cascades, loading limits), centrifugal / mixed-flow compressors, specific speed and maps.
import { h, section, field, segmented, select } from '../../lib/ui.js';
import { Plot } from '../../lib/plot.js';
import * as TB from '../../solvers/turbo.js';
import { bound, boundSelect, card, metricsGrid, insightsList, canvasBox, fmt, deg, kPa, put } from './common.js';

const DEG = Math.PI / 180;
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

// ---------- drawing helpers ----------
function arrow(g, x0, y0, x1, y1, col, lab, w = 2) {
  g.strokeStyle = col; g.fillStyle = col; g.lineWidth = w;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  const a = Math.atan2(y1 - y0, x1 - x0), s = 8;
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 - s * Math.cos(a - 0.35), y1 - s * Math.sin(a - 0.35)); g.lineTo(x1 - s * Math.cos(a + 0.35), y1 - s * Math.sin(a + 0.35)); g.fill();
  if (lab) { g.font = '12px ' + cssv('--font'); g.textAlign = 'center'; g.textBaseline = 'middle'; const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, nx = -(y1 - y0), ny = x1 - x0, L = Math.hypot(nx, ny) || 1; g.fillText(lab, mx + nx / L * 12, my + ny / L * 12); }
}
// velocity triangles: list of {title, C:[cx,ct], W:[cx,wt], U} ; axial to the right, tangential (rotation) up
function triangles(g, W, H, list) {
  const n = list.length, cw = W / n;
  let vmax = 0; for (const t of list) vmax = Math.max(vmax, Math.hypot(...t.C), Math.hypot(...t.W), t.U + Math.abs(t.C[1]) + Math.abs(t.W[1]));
  const sc = Math.min((cw - 50) / Math.max(...list.map(t => Math.max(t.C[0], t.W[0]))), (H - 60) / (vmax * 1.05));
  list.forEach((t, i) => {
    const ox = i * cw + 30, ys = [0, t.C[1], t.W[1]], ymid = (Math.max(...ys) + Math.min(...ys)) / 2, oy = H / 2 + ymid * sc + 8;
    g.fillStyle = cssv('--text-2'); g.font = '600 12px ' + cssv('--font'); g.textAlign = 'left'; g.fillText(t.title, i * cw + 12, 16);
    const P = v => [ox + v[0] * sc, oy - v[1] * sc];
    const [cxp, cyp] = P(t.C), [wxp, wyp] = P(t.W);
    arrow(g, ox, oy, cxp, cyp, cssv('--lower'), t.cl || 'C');
    arrow(g, ox, oy, wxp, wyp, cssv('--upper'), t.wl || 'W');
    arrow(g, wxp, wyp, cxp, cyp, cssv('--text-2'), 'U', 1.6);
    g.strokeStyle = cssv('--border-strong'); g.setLineDash([3, 3]); g.lineWidth = 1; g.beginPath(); g.moveTo(ox - 10, oy); g.lineTo(ox + Math.max(t.C[0], t.W[0]) * sc + 14, oy); g.stroke(); g.setLineDash([]);
    g.fillStyle = cssv('--text-3'); g.font = '11px ' + cssv('--mono'); g.textAlign = 'left';
    const lines = t.info || [];
    lines.forEach((l, k) => g.fillText(l, i * cw + 12, H - 14 - (lines.length - 1 - k) * 14));
  });
}
// cambered blade from inlet angle a0 to exit angle a1 (from axial, + = rotation direction)
function blade(g, x0, y0, cx, a0, a1, tmax, fill) {
  const n = 24, pts = []; let x = x0, y = y0;
  for (let i = 0; i <= n; i++) { const s = i / n, a = a0 + (a1 - a0) * s; pts.push([x, y, a, s]); x += cx / n; y -= cx / n * Math.tan(a); }
  g.fillStyle = fill; g.beginPath();
  pts.forEach(([x, y, a, s], i) => { const t = tmax * Math.min(1, 4.2 * s * (1 - s) + 0.08), nx = Math.sin(a) * t, ny = Math.cos(a) * t; i ? g.lineTo(x + nx, y + ny) : g.moveTo(x + nx, y + ny); });
  for (let i = pts.length - 1; i >= 0; i--) { const [x, y, a, s] = pts[i]; const t = tmax * Math.min(1, 4.2 * s * (1 - s) + 0.08), nx = Math.sin(a) * t, ny = Math.cos(a) * t; g.lineTo(x - nx, y - ny); }
  g.closePath(); g.fill();
}
function cascade(g, W, H, rows, t) {
  // rows: [{label, a0, a1, moving, U}]
  const n = rows.length, cx = Math.min(90, W / (n * 2.4)), pitch = cx * 0.9, gap = cx * 0.7;
  const total = n * cx + (n - 1) * gap, x0 = (W - total) / 2;
  rows.forEach((r, i) => {
    const xs = x0 + i * (cx + gap), off = r.moving ? (t * r.speed) % pitch : 0;
    g.fillStyle = cssv('--text-2'); g.font = '600 12px ' + cssv('--font'); g.textAlign = 'center'; g.fillText(r.label, xs + cx / 2, 16);
    g.save(); g.beginPath(); g.rect(xs - cx, 24, cx * 3, H - 48); g.clip();
    for (let k = -3; k < H / pitch + 3; k++) {
      const yl = 24 + k * pitch - off;
      blade(g, xs, yl, cx, r.a0, r.a1, cx * 0.07, r.moving ? cssv('--accent') : cssv('--text-3'));
    }
    g.restore();
    if (r.moving) { arrow(g, xs + cx / 2 + 22, H - 34, xs + cx / 2 + 22, H - 62, cssv('--text-2'), '', 1.6); g.fillStyle = cssv('--text-2'); g.font = '11px ' + cssv('--font'); g.fillText('U', xs + cx / 2 + 34, H - 46); }
  });
  g.fillStyle = cssv('--text-3'); g.font = '11px ' + cssv('--font'); g.textAlign = 'left'; g.fillText('flow →', 10, H - 10);
}

export function turboTab({ keep = o => o } = {}) {
  const S = keep({
    mode: 'axc',
    axc: { U: 350, phi: 0.55, psi: 0.35, R: 0.5, eta: 0.9, sigma: 1.2, T01: 288.15, p01: 101.325, n: 10, target: 0 },
    axt: { U: 400, phi: 0.6, psi: 1.8, R: 0.5, eta: 0.9, T01: 1600, p01: 2000, n: 2, Z: 0.8, g: 1.3, cp: 1239 },
    cen: { rpm: 36000, D2: 0.28, beta2b: 30, Z: 17, slip: 'wiesner', phi2: 0.28, ppf: 1.04, eta: 0.82, T01: 288.15, p01: 101.325, mdot: 2.5, D1t: 0.17, hubTip: 0.35, cone: 90 },
    ns: { rpm: 30000, mdot: 5, PR: 4, T01: 288.15, p01: 101.325 },
    map: { piD: 8, kind: 'axial', n: 1.0, throttle: 1.0 },
  });
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });
  const metrics = metricsGrid();
  const triBox = canvasBox('cf-chart tri-chart'), casBox = canvasBox('cf-chart tri-chart');
  const triCard = card('Velocity triangles', 'C absolute velocity (orange), W relative to the blade (blue), U blade speed. Axial to the right, rotation upward.'); triCard.append(triBox.el);
  const casCard = card('Blade rows (mean-line cascade)', 'Blades drawn with their inlet and exit flow angles. The rotor row moves at the blade speed.'); casCard.append(casBox.el);
  const stCard = card('Stage by stage'), stPlot = new Plot(stCard, { xlabel: 'stage', ylabel: '', xname: 'stage', yname: 'value' });
  const insCard = card('Design checks'); const insEl = h('div'); insCard.append(insEl);
  const extraCard = card(''); const extraBox = canvasBox('cf-chart tri-chart'); extraCard.append(extraBox.el);
  const nsCard = card('Specific speed and machine type', 'Approximate best-efficiency envelopes (after Balje). Low specific speed → centrifugal; high → axial.'), nsPlot = new Plot(nsCard, { xlabel: 'Specific speed Ns = ω√Q / Δh₀s^¾', ylabel: 'peak η', xname: 'Ns', yname: 'η', yfmt: v => v.toFixed(3) });
  nsPlot.wrap.style.height = '320px';
  const mapBox = canvasBox('cf-chart');
  let t0 = performance.now(), raf = 0, animOn = false;

  const build = () => {
    const sec = section('Machine');
    const seg = segmented([{ value: 'axc', label: 'Axial compressor' }, { value: 'axt', label: 'Axial turbine' }, { value: 'cen', label: 'Centrifugal / mixed' }, { value: 'ns', label: 'Specific speed' }, { value: 'map', label: 'Compressor map' }], S.mode, v => { S.mode = v; build(); run(); });
    seg.el.classList.add('seg-wrap');
    put(sec.body, field('Tool', seg.el));
    const p = section('Design');
    if (S.mode === 'axc') {
      const A = S.axc;
      put(p.body, bound(A, 'U', 'Mean blade speed U', 150, 550, { step: 1, digits: 0, unit: 'm/s', onInput: run }), bound(A, 'phi', 'Flow coefficient φ = Cx/U', 0.25, 1, { step: 0.005, digits: 3, onInput: run }),
        bound(A, 'psi', 'Stage loading ψ = Δh₀/U²', 0.1, 0.7, { step: 0.005, digits: 3, onInput: run, tip: 'Typical 0.3–0.45. Above ~0.5 the blades struggle to diffuse the flow.' }), bound(A, 'R', 'Degree of reaction R', 0, 1, { step: 0.01, onInput: run, tip: 'Share of the stage static-enthalpy rise in the rotor. 0.5 gives symmetric blading.' }),
        bound(A, 'sigma', 'Solidity σ = c/s', 0.5, 2.5, { step: 0.01, onInput: run }), bound(A, 'eta', 'Stage efficiency', 0.75, 0.96, { step: 0.005, digits: 3, onInput: run }),
        bound(A, 'n', 'Number of stages', 1, 20, { step: 1, digits: 0, onInput: run }), bound(A, 'target', 'Or: target pressure ratio (0 = off)', 0, 40, { step: 0.1, digits: 1, onInput: run }),
        bound(A, 'T01', 'Inlet T₀₁', 200, 900, { step: 1, digits: 1, unit: 'K', onInput: run }), bound(A, 'p01', 'Inlet p₀₁', 10, 5000, { log: true, digits: 2, unit: 'kPa', onInput: run }));
    } else if (S.mode === 'axt') {
      const A = S.axt;
      put(p.body, bound(A, 'U', 'Mean blade speed U', 150, 650, { step: 1, digits: 0, unit: 'm/s', onInput: run }), bound(A, 'phi', 'Flow coefficient φ', 0.3, 1.3, { step: 0.005, digits: 3, onInput: run }),
        bound(A, 'psi', 'Stage loading ψ', 0.6, 3.2, { step: 0.01, onInput: run, tip: 'Typical 1.2–2.5 — turbines take much more loading than compressors because the flow accelerates.' }), bound(A, 'R', 'Degree of reaction R', 0, 1, { step: 0.01, onInput: run }),
        bound(A, 'Z', 'Zweifel coefficient', 0.6, 1.2, { step: 0.01, onInput: run, tip: 'Blade-loading coefficient used to set pitch; ~0.8 is the classic optimum.' }), bound(A, 'eta', 'Stage efficiency', 0.75, 0.95, { step: 0.005, digits: 3, onInput: run }),
        bound(A, 'n', 'Number of stages', 1, 8, { step: 1, digits: 0, onInput: run }), bound(A, 'T01', 'Inlet T₀₁', 600, 2100, { step: 5, digits: 0, unit: 'K', onInput: run }), bound(A, 'p01', 'Inlet p₀₁', 50, 6000, { log: true, digits: 1, unit: 'kPa', onInput: run }),
        bound(A, 'g', 'γ', 1.2, 1.4, { step: 0.005, digits: 3, onInput: run }), bound(A, 'cp', 'cp', 1000, 1300, { step: 1, digits: 0, unit: 'J/kg·K', onInput: run }));
    } else if (S.mode === 'cen') {
      const A = S.cen;
      put(p.body, bound(A, 'cone', 'Exit cone angle (90° = radial)', 20, 90, { step: 1, digits: 0, unit: 'deg', onInput: run, tip: '90°: centrifugal (flow leaves radially). 30–60°: mixed-flow, a compromise between centrifugal pressure ratio and axial flow capacity.' }),
        bound(A, 'rpm', 'Shaft speed', 5000, 150000, { log: true, digits: 0, unit: 'rpm', onInput: run }), bound(A, 'D2', 'Impeller tip diameter D₂', 0.03, 1, { log: true, digits: 3, unit: 'm', onInput: run }),
        bound(A, 'beta2b', 'Backsweep β₂b', 0, 55, { step: 0.5, digits: 1, unit: 'deg', onInput: run, tip: 'Blade angle at exit measured from radial, swept against rotation. More backsweep: less work, wider stable range, better efficiency.' }),
        bound(A, 'Z', 'Blade count Z', 6, 36, { step: 1, digits: 0, onInput: run }), boundSelect(A, 'slip', 'Slip model', [{ value: 'wiesner', label: 'Wiesner (1967)' }, { value: 'stodola', label: 'Stodola' }, { value: 'stanitz', label: 'Stanitz' }], run, 'The flow leaves with less swirl than the blades because of the relative eddy between blades.'),
        bound(A, 'phi2', 'Exit flow coefficient Cr₂/U₂', 0.1, 0.5, { step: 0.005, digits: 3, onInput: run }), bound(A, 'ppf', 'Power input factor', 1, 1.12, { step: 0.005, digits: 3, onInput: run, tip: 'Extra work absorbed by disk friction and recirculation (heats the gas without raising pressure).' }),
        bound(A, 'eta', 'Stage efficiency (t-t)', 0.65, 0.92, { step: 0.005, digits: 3, onInput: run }), bound(A, 'mdot', 'Mass flow', 0.05, 30, { log: true, digits: 2, unit: 'kg/s', onInput: run }),
        bound(A, 'D1t', 'Inducer tip diameter D₁t', 0.02, 0.8, { log: true, digits: 3, unit: 'm', onInput: run }), bound(A, 'hubTip', 'Inducer hub/tip ratio', 0.1, 0.7, { step: 0.01, onInput: run }),
        bound(A, 'T01', 'Inlet T₀₁', 200, 600, { step: 1, digits: 1, unit: 'K', onInput: run }), bound(A, 'p01', 'Inlet p₀₁', 10, 2000, { log: true, digits: 2, unit: 'kPa', onInput: run }));
    } else if (S.mode === 'ns') {
      const A = S.ns;
      put(p.body, bound(A, 'rpm', 'Shaft speed', 1000, 150000, { log: true, digits: 0, unit: 'rpm', onInput: run }), bound(A, 'mdot', 'Mass flow', 0.05, 500, { log: true, digits: 2, unit: 'kg/s', onInput: run }),
        bound(A, 'PR', 'Stage pressure ratio', 1.05, 10, { step: 0.01, onInput: run }), bound(A, 'T01', 'Inlet T₀₁', 200, 900, { step: 1, digits: 1, unit: 'K', onInput: run }), bound(A, 'p01', 'Inlet p₀₁', 10, 5000, { log: true, digits: 1, unit: 'kPa', onInput: run }));
    } else {
      const A = S.map;
      put(p.body, bound(A, 'piD', 'Design pressure ratio', 1.5, 30, { step: 0.1, digits: 1, onInput: run }), boundSelect(A, 'kind', 'Machine', [{ value: 'axial', label: 'Multistage axial' }, { value: 'centrifugal', label: 'Centrifugal' }], run),
        bound(A, 'n', 'Corrected speed N/N_design', 0.6, 1.05, { step: 0.005, digits: 3, onInput: run }), bound(A, 'throttle', 'Throttle (nozzle area factor)', 0.6, 1.3, { step: 0.005, digits: 3, onInput: run, tip: 'Closing the nozzle/turbine flow area (below 1) pushes the operating point up the speed line toward surge.' }));
    }
    controls.replaceChildren(sec.el, p.el);
    main.replaceChildren(metrics.el);
    if (S.mode === 'axc' || S.mode === 'axt') main.append(h('div', { class: 'cf-grid2b' }, triCard, casCard), h('div', { class: 'cf-grid2b' }, stCard, insCard));
    else if (S.mode === 'cen') { extraCard.querySelector('h4').textContent = 'Impeller: front view, meridional section and exit triangle'; main.append(extraCard, h('div', { class: 'cf-grid2b' }, nsCard, insCard)); }
    else if (S.mode === 'ns') main.append(nsCard, insCard);
    else main.append(card('Compressor map (illustrative)', 'Generic map shape: speed lines, surge line, efficiency islands and the engine operating line. Real maps come from rig tests; this shows how they are read.'), mapBox.el, insCard);
  };

  let R = null, pending = false;
  const run = () => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; compute(); }); };
  const compute = () => {
    if (S.mode === 'axc') paintAxc();
    else if (S.mode === 'axt') paintAxt();
    else if (S.mode === 'cen') paintCen();
    else if (S.mode === 'ns') paintNs();
    else paintMap();
    animate(S.mode === 'axc' || S.mode === 'axt' || S.mode === 'cen');
  };
  const animate = on => {
    animOn = on; cancelAnimationFrame(raf);
    if (!on) return;
    const loop = () => { if (!animOn) return; casBox.draw(); if (S.mode === 'cen') extraBox.draw(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
  };
  const now = () => (performance.now() - t0) / 1000;

  function paintAxc() {
    const A = S.axc;
    R = TB.axialCompressor({ ...A, p01: A.p01 * 1e3, nStages: Math.round(A.n), targetPR: A.target });
    const a = R.angles;
    metrics.set([
      { k: 'Stage ΔT₀', v: R.dT0.toFixed(2) + ' K' }, { k: 'First-stage PR', v: fmt(R.stages[0].pr, 4) },
      { k: 'Overall PR', v: fmt(R.PR, 3), s: `${R.stages.length} stages` }, { k: 'Polytropic η', v: fmt(R.etaPoly, 4) },
      { k: 'de Haller W₂/W₁', v: fmt(R.deHaller, 3), cls: R.deHaller < 0.72 ? 'bad' : '', s: '≥ 0.72 recommended' },
      { k: 'Diffusion factor', v: `${fmt(R.DFr, 3)} / ${fmt(R.DFs, 3)}`, s: 'rotor / stator, ≤ 0.45', cls: Math.max(R.DFr, R.DFs) > 0.5 ? 'bad' : '' },
      { k: 'Rotor relative M₁', v: fmt(R.Mrel1, 3), s: R.Mrel1 > 1 ? 'transonic rotor' : 'subsonic' },
      { k: 'Exit T₀ / p₀', v: `${R.stages[R.stages.length - 1].T0.toFixed(0)} K`, s: `${kPa(R.stages[R.stages.length - 1].p0)} kPa` },
    ]);
    triBox.set(({ W, H, g }) => { g.clearRect(0, 0, W, H); triangles(g, W, H, [
      { title: 'Rotor inlet (1)', C: [R.Cx, R.Ct1], W: [R.Cx, -R.Wt1], U: A.U, cl: 'C₁', wl: 'W₁', info: [`α₁ ${deg(a.a1)}  β₁ ${deg(a.b1)}`, `C₁ ${R.C1.toFixed(0)}  W₁ ${R.W1.toFixed(0)} m/s`] },
      { title: 'Rotor exit (2)', C: [R.Cx, R.Ct2], W: [R.Cx, -R.Wt2], U: A.U, cl: 'C₂', wl: 'W₂', info: [`α₂ ${deg(a.a2)}  β₂ ${deg(a.b2)}`, `C₂ ${R.C2.toFixed(0)}  W₂ ${R.W2.toFixed(0)} m/s`] }]); });
    casBox.set(({ W, H, g }) => { g.clearRect(0, 0, W, H); cascade(g, W, H, [{ label: 'Rotor', a0: -a.b1, a1: -a.b2, moving: true, speed: 30 }, { label: 'Stator', a0: a.a2, a1: a.a1 }], now()); });
    stPlot.setOpts({ ylabel: 'cumulative PR / stage PR' });
    stPlot.setData({ series: [{ x: R.stages.map(s => s.k), y: R.stages.map(s => s.PR), color: cssv('--upper'), points: true, label: 'overall PR' }, { x: R.stages.map(s => s.k), y: R.stages.map(s => s.pr * 5), color: cssv('--lower'), points: true, dash: [5, 4], label: 'stage PR ×5', extra: i => `stage PR ${R.stages[i].pr.toFixed(4)}` }] });
    const L = [];
    L.push(R.deHaller < 0.72 ? { type: 'b', t: 'Rotor diffuses too much', d: `W₂/W₁ = ${R.deHaller.toFixed(3)}. The blade boundary layer will separate; reduce ψ or raise φ.` } : { type: 'g', t: 'de Haller criterion met', d: `W₂/W₁ = ${R.deHaller.toFixed(3)} ≥ 0.72.` });
    if (R.statorRatio < 0.72) L.push({ type: 'b', t: 'Stator diffuses too much', d: `C₃/C₂ = ${R.statorRatio.toFixed(3)}. Raise the reaction or lower the loading.` });
    if (Math.max(R.DFr, R.DFs) > 0.45) L.push({ type: 'w', t: 'High diffusion factor', d: 'Lieblein DF above 0.45 means rising profile loss. Increase solidity σ.' });
    if (R.Mrel1 > 1.3) L.push({ type: 'w', t: 'Supersonic relative flow', d: `M_rel = ${R.Mrel1.toFixed(2)} at the mean line (tips are higher): shock losses rise. Fan and front stages accept this, rear stages should not.` });
    if (A.U > 450) L.push({ type: 'w', t: 'High blade speed', d: 'Disk stresses scale with U²; above ~450–500 m/s titanium disks are at their limit.' });
    if (A.R < 0.2 || A.R > 0.8) L.push({ type: 'i', t: 'Unusual reaction', d: 'Very low or high reaction puts nearly all diffusion on one row.' });
    insightsList(insEl, L);
  }
  function paintAxt() {
    const A = S.axt;
    R = TB.axialTurbine({ ...A, p01: A.p01 * 1e3, nStages: Math.round(A.n) });
    const a = R.angles;
    const last = R.stages[R.stages.length - 1];
    metrics.set([
      { k: 'Stage ΔT₀', v: R.dT0.toFixed(1) + ' K' }, { k: 'Stage expansion ratio', v: R.stages.length ? fmt(R.stages[0].er, 4) : '—' },
      { k: 'Overall p₀₁/p₀ₑ', v: fmt(R.ER, 3), s: `${R.stages.length} stages` }, { k: 'Exit T₀', v: last ? last.T0.toFixed(0) + ' K' : '—' },
      { k: 'Nozzle exit M₂', v: fmt(R.M2, 3), s: R.M2 > 1 ? 'supersonic vane exit' : 'subsonic', cls: R.M2 > 1.2 ? 'bad' : '' },
      { k: 'Rotor exit M_rel', v: fmt(R.Mrel3, 3) }, { k: 'Flow turning', v: `${deg(R.nozzleTurn)} / ${deg(R.rotorTurn)}`, s: 'vane / rotor' },
      { k: 'Pitch/axial chord', v: `${fmt(R.sNoz, 3)} / ${fmt(R.sRot, 3)}`, s: `vane / rotor at Z = ${A.Z}` },
    ]);
    triBox.set(({ W, H, g }) => { g.clearRect(0, 0, W, H); triangles(g, W, H, [
      { title: 'Rotor inlet (2)', C: [R.Cx, R.Ct2], W: [R.Cx, R.Wt2], U: A.U, cl: 'C₂', wl: 'W₂', info: [`α₂ ${deg(a.a2)}  β₂ ${deg(a.b2)}`, `C₂ ${R.C2.toFixed(0)}  W₂ ${R.W2.toFixed(0)} m/s`] },
      { title: 'Rotor exit (3)', C: [R.Cx, -R.Ct3], W: [R.Cx, -R.Wt3], U: A.U, cl: 'C₃', wl: 'W₃', info: [`α₃ ${deg(a.a3)}  β₃ ${deg(a.b3)}`, `C₃ ${R.C3.toFixed(0)}  W₃ ${R.W3.toFixed(0)} m/s`] }]); });
    casBox.set(({ W, H, g }) => { g.clearRect(0, 0, W, H); cascade(g, W, H, [{ label: 'Nozzle vanes', a0: -a.a3, a1: a.a2 }, { label: 'Rotor', a0: a.b2, a1: -a.b3, moving: true, speed: 30 }], now()); });
    stPlot.setOpts({ ylabel: 'T₀ (K)' });
    stPlot.setData({ series: [{ x: [0, ...R.stages.map(s => s.k)], y: [A.T01, ...R.stages.map(s => s.T0)], color: cssv('--lower'), points: true, label: 'T₀ after stage', extra: i => i ? `p₀ ${kPa(R.stages[i - 1].p0)} kPa` : 'inlet' }] });
    const L = [];
    if (Math.abs(a.a3) > 20 * DEG) L.push({ type: 'w', t: 'Exit swirl', d: `α₃ = ${deg(a.a3)}. Swirl leaving the last stage is wasted kinetic energy; zero swirl needs ψ ≈ 2(1 − R).` });
    else L.push({ type: 'g', t: 'Low exit swirl', d: `α₃ = ${deg(a.a3)}.` });
    if (A.psi > 2.5) L.push({ type: 'w', t: 'Very high loading', d: 'Efficiency falls off on the Smith chart above ψ ≈ 2.5; it saves a stage at the cost of losses.' });
    if (R.M2 > 1) L.push({ type: 'i', t: 'Transonic vane', d: 'HP turbine vanes often run choked (M₂ ≈ 1); this sets the engine flow capacity.' });
    if (A.T01 > 1350) L.push({ type: 'i', t: 'Cooled blading', d: `T₀₁ = ${A.T01} K exceeds uncooled nickel-alloy limits (~1350 K). Cooling flow costs a few points of efficiency.` });
    insightsList(insEl, L);
  }
  function paintCen() {
    const A = S.cen;
    R = TB.centrifugal({ ...A, beta2b: A.beta2b * DEG, p01: A.p01 * 1e3, cone: A.cone * DEG });
    metrics.set([
      { k: 'Pressure ratio', v: fmt(R.PR, 3), s: `η = ${A.eta}` }, { k: 'Tip speed U₂', v: R.U2.toFixed(0) + ' m/s', s: `tip Mach ${R.Mu2.toFixed(2)}`, cls: R.U2 > 600 ? 'bad' : '' },
      { k: 'Slip factor σ', v: fmt(R.sigma, 4) }, { k: 'Work coefficient', v: fmt(R.lambda, 3), s: 'Cθ₂/U₂' },
      { k: 'Specific work', v: (R.dh0 / 1e3).toFixed(1) + ' kJ/kg', s: `power ${(R.power / 1e3).toFixed(0)} kW` },
      { k: 'Exit absolute M₂', v: fmt(R.M2, 3), s: `flow angle ${deg(R.alpha2)} from radial` },
      { k: 'Inducer tip M_rel', v: fmt(R.Mrel1t, 3), cls: R.Mrel1t > 1.3 ? 'bad' : '', s: `C₁ ${R.C1.toFixed(0)} m/s` },
      { k: 'Specific speed Ns', v: fmt(R.Ns, 3), s: `Ds ${fmt(R.Ds, 2)}` },
    ]);
    extraBox.set(({ W, H, g }) => {
      g.clearRect(0, 0, W, H);
      const t = now(), w3 = W / 3;
      // front view
      const cx = w3 / 2, cy = H / 2 + 6, r2 = Math.min(w3, H) * 0.4, r1 = r2 * Math.min(0.8, A.D1t / A.D2), rh = r1 * A.hubTip;
      g.fillStyle = cssv('--text-2'); g.font = '600 12px ' + cssv('--font'); g.textAlign = 'center'; g.fillText('Front view (rotating)', cx, 16);
      g.strokeStyle = cssv('--border-strong'); g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, r2, 0, 2 * Math.PI); g.stroke();
      g.fillStyle = cssv('--border-strong'); g.beginPath(); g.arc(cx, cy, rh, 0, 2 * Math.PI); g.fill();
      const rot = t * 1.2, tb = Math.tan(A.beta2b * DEG);
      g.strokeStyle = cssv('--accent'); g.lineWidth = 2;
      for (let k = 0; k < Math.round(A.Z); k++) {
        g.beginPath(); let th = rot + k * 2 * Math.PI / Math.round(A.Z);
        const n = 30;
        for (let i = 0; i <= n; i++) { const r = rh + (r2 - rh) * i / n; const frac = Math.max(0, (r - r1) / (r2 - r1)); const x = cx + r * Math.cos(th), y = cy + r * Math.sin(th); i ? g.lineTo(x, y) : g.moveTo(x, y); th += (r2 - rh) / n * (tb * frac) / r * 1; }
        g.stroke();
      }
      g.fillStyle = cssv('--text-3'); g.font = '11px ' + cssv('--font'); g.fillText('rotation ↻, blades swept back', cx, H - 10);
      // meridional section
      const mx = w3 + 20, mw = w3 - 40, base = H - 30, top = 34, sc = Math.min(mw / 1.1, (base - top) / 1.05);
      g.fillStyle = cssv('--text-2'); g.font = '600 12px ' + cssv('--font'); g.fillText(A.cone >= 85 ? 'Meridional section (centrifugal)' : 'Meridional section (mixed-flow)', w3 * 1.5, 16);
      const cone = A.cone * DEG, R2 = 1, R1t = Math.min(0.8, A.D1t / A.D2), R1h = R1t * A.hubTip;
      const P = (x, r) => [mx + x * sc, base - r * sc];
      const exitDir = [Math.cos(cone), Math.sin(cone)];
      const sh = [[0, R1t], [0.25, R1t], [0.25 + 0.35 * Math.cos(cone) + 0.1, R2 - 0.08 * Math.sin(cone)], [0.25 + 0.35 * Math.cos(cone) + 0.1 + 0.08 * exitDir[0], R2]];
      const hu = [[0, R1h], [0.1, R1h], [0.55 + 0.35 * Math.cos(cone), R2 - 0.18 * Math.sin(cone) - 0.12 * Math.cos(cone)], [0.55 + 0.35 * Math.cos(cone) + 0.12 * exitDir[0], R2 - 0.12 * Math.cos(cone)]];
      g.fillStyle = cssv('--accent-soft');
      g.beginPath(); { const [a, b] = P(...sh[0]); g.moveTo(a, b); } { const [a, b] = P(...sh[1]), [c, d] = P(...sh[2]), [e, f] = P(...sh[3]); g.bezierCurveTo(a, b, c, d, e, f); }
      { const [a, b] = P(...hu[3]); g.lineTo(a, b); } { const [a, b] = P(...hu[2]), [c, d] = P(...hu[1]), [e, f] = P(...hu[0]); g.bezierCurveTo(a, b, c, d, e, f); } g.closePath(); g.fill();
      g.strokeStyle = cssv('--text-2'); g.lineWidth = 2; g.stroke();
      g.strokeStyle = cssv('--border-strong'); g.setLineDash([5, 4]); g.lineWidth = 1; { const [a, b] = P(-0.05, 0), [c] = P(1.1, 0); g.beginPath(); g.moveTo(a, b); g.lineTo(c, b); g.stroke(); } g.setLineDash([]);
      g.fillStyle = cssv('--text-3'); g.font = '11px ' + cssv('--font'); g.textAlign = 'left'; g.fillText('axis of rotation', mx, base + 14);
      arrow(g, ...P(-0.08, (R1t + R1h) / 2), ...P(0.05, (R1t + R1h) / 2), cssv('--text-2'), '', 1.5);
      { const [ex, ey] = P(...sh[3]); arrow(g, ex, ey + 6, ex + 26 * exitDir[0], ey + 6 - 26 * exitDir[1], cssv('--text-2'), '', 1.5); }
      // exit triangle
      g.save(); g.translate(2 * w3, 0);
      triangles(g, w3, H, [{ title: 'Impeller exit triangle', C: [R.Cr2, R.Ct2], W: [R.Cr2, R.Ct2 - R.U2], U: R.U2, cl: 'C₂', wl: 'W₂', info: [`radial → right, U ↑`, `Cθ₂ ${R.Ct2.toFixed(0)}  Cr₂ ${R.Cr2.toFixed(0)} m/s`, `slip ${R.slipV.toFixed(0)} m/s`] }]);
      g.restore();
    });
    paintNsChart(R.Ns, A.cone >= 85 ? 'radial' : 'mixed');
    const L = [];
    if (R.U2 > 600) L.push({ type: 'b', t: 'Tip speed too high', d: `U₂ = ${R.U2.toFixed(0)} m/s: titanium impellers top out near 550–600 m/s.` });
    if (R.Mrel1t > 1.2) L.push({ type: 'w', t: 'Transonic inducer', d: `Inducer tip relative Mach ${R.Mrel1t.toFixed(2)}. Shock losses rise; a larger inducer or inlet guide vanes (pre-swirl) help.` });
    if (R.wRatio < 0.55) L.push({ type: 'w', t: 'Strong impeller diffusion', d: `W₂/W₁t = ${R.wRatio.toFixed(2)} (< 0.55): expect separation (jet-wake flow).` });
    if (R.M2 > 1) L.push({ type: 'i', t: 'Supersonic diffuser inlet', d: `M₂ = ${R.M2.toFixed(2)}: a vaned diffuser must handle shocks; pressure ratios above ~5 usually do.` });
    L.push({ type: 'i', t: A.cone >= 85 ? 'Centrifugal stage' : 'Mixed-flow stage', d: A.cone >= 85 ? 'One robust stage gives what 4–6 axial stages would. Used in turboshafts, APUs, small turbofans and turbochargers.' : 'Mixed-flow impellers pass more flow per frontal area than radial ones, with higher pressure ratio than an axial stage.' });
    insightsList(insEl, L);
  }
  function paintNsChart(NsVal, kind) {
    const xs = []; for (let l = Math.log(0.1); l <= Math.log(20); l += 0.04) xs.push(Math.exp(l));
    const cols = { radial: '--lower', mixed: '--turb', axial: '--upper' };
    const series = TB.NS_TYPES.map(t => ({ x: xs.map(Math.log10), y: xs.map(n => TB.nsEff(t, n)), color: cssv(cols[t.id]), label: t.label }));
    if (isFinite(NsVal)) series.push({ x: [Math.log10(NsVal)], y: [Math.max(...TB.NS_TYPES.map(t => TB.nsEff(t, NsVal)))], color: cssv('--text'), line: false, points: true, pointSize: 5, label: 'your design' });
    nsPlot.setOpts({ xlabel: 'log₁₀ specific speed Ns (ω in rad/s, Q in m³/s, Δh in J/kg)', xfmt: v => (10 ** v).toFixed(3), ylim: [0.4, 0.95] });
    nsPlot.setData({ series });
  }
  function paintNs() {
    const A = S.ns;
    const Ns = TB.specificSpeed({ ...A, p01: A.p01 * 1e3 });
    const best = TB.NS_TYPES.map(t => ({ t, e: TB.nsEff(t, Ns) })).sort((a, b) => b.e - a.e)[0];
    metrics.set([{ k: 'Specific speed Ns', v: fmt(Ns, 3) }, { k: 'Best type', v: best.t.label }, { k: 'Expected peak η', v: fmt(best.e, 3), s: 'approximate' }]);
    paintNsChart(Ns);
    insightsList(insEl, [{ type: 'i', t: `Ns = ${Ns.toFixed(2)} → ${best.t.label}`, d: 'Specific speed combines flow, work and rotational speed into one number that is the same for geometrically similar machines. It tells you which machine shape will be most efficient for the duty.' },
      { type: 'i', t: 'Change the duty', d: 'Higher shaft speed or more flow raises Ns (toward axial). A higher pressure ratio per stage lowers it (toward centrifugal).' }]);
  }
  function paintMap() {
    const A = S.map, M = TB.compressorMap(A.piD, { kind: A.kind });
    // operating point: speed line n meets the throttle line π = 1 + (πd−1)·(m/throttle)²
    const ms = n => (A.kind === 'axial' ? 0.80 : 0.70) * n ** 1.2, mc = n => 1.04 * n ** (A.kind === 'axial' ? 0.75 : 0.9);
    const op = (() => {
      const n = A.n; let best = null;
      const ps = n2 => 1 + (A.piD - 1) * 1.2 * n2 ** 2.1, pcF = n2 => 1 + (ps(n2) - 1) * (A.kind === 'axial' ? 0.55 : 0.4);
      const k = Math.log((ps(1) - A.piD) / (ps(1) - pcF(1))) / Math.log((1 - ms(1)) / (mc(1) - ms(1)));
      const piAt = m => ps(n) - (ps(n) - pcF(n)) * Math.max(0, (m - ms(n)) / (mc(n) - ms(n))) ** k;
      const thr = m => 1 + (A.piD - 1) * (m / A.throttle) ** 2;
      let lo = ms(n), hi = mc(n);
      for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (piAt(m) > thr(m)) lo = m; else hi = m; }
      const m = (lo + hi) / 2; best = [m, piAt(m)];
      return { m: best[0], p: best[1], pts: Array.from({ length: 41 }, (_, i) => { const mm = ms(n) + (mc(n) - ms(n)) * i / 40; return [mm, piAt(mm)]; }), surge: [ms(n), ps(n)] };
    })();
    const SM = (M.surgeAt(op.m) - op.p) / op.p;
    const eff = M.eff(op.m, op.p);
    metrics.set([{ k: 'Operating PR', v: fmt(op.p, 3) }, { k: 'Corrected flow', v: fmt(op.m, 3), s: 'relative to design' }, { k: 'Surge margin', v: (SM * 100).toFixed(1) + '%', cls: SM < 0.1 ? 'bad' : '', s: '(π_surge − π)/π at same flow' }, { k: 'Efficiency (approx.)', v: fmt(eff, 3) }]);
    mapBox.set(({ W, H, g }) => {
      g.clearRect(0, 0, W, H);
      const pad = [20, 20, 40, 56], x0 = 0.45, x1 = 1.12, y0 = 1, y1 = 1 + (A.piD - 1) * 1.35;
      const X = m => pad[3] + (m - x0) / (x1 - x0) * (W - pad[1] - pad[3]), Y = p => H - pad[2] - (p - y0) / (y1 - y0) * (H - pad[0] - pad[2]);
      // efficiency shading
      const step = 4;
      for (let py = pad[0]; py < H - pad[2]; py += step) for (let px = pad[3]; px < W - pad[1]; px += step) {
        const m = x0 + (px - pad[3]) / (W - pad[1] - pad[3]) * (x1 - x0), p = y0 + (H - pad[2] - py) / (H - pad[0] - pad[2]) * (y1 - y0);
        if (p > M.surgeAt(m)) continue;
        const e = M.eff(m, p);
        const lvl = Math.floor((e - 0.7) / 0.03);
        if (lvl < 0) continue;
        const a = Math.min(0.5, 0.06 + lvl * 0.07);
        g.fillStyle = `rgba(47,111,237,${a})`; g.fillRect(px, py, step, step);
      }
      g.strokeStyle = cssv('--border'); g.lineWidth = 1; g.font = '10.5px ' + cssv('--mono'); g.fillStyle = cssv('--text-3');
      for (let m = 0.5; m <= 1.1; m += 0.1) { g.beginPath(); g.moveTo(X(m), pad[0]); g.lineTo(X(m), H - pad[2]); g.stroke(); g.textAlign = 'center'; g.fillText(m.toFixed(1), X(m), H - pad[2] + 14); }
      const dp = (y1 - y0) / 6; for (let p = y0; p <= y1; p += dp) { g.beginPath(); g.moveTo(pad[3], Y(p)); g.lineTo(W - pad[1], Y(p)); g.stroke(); g.textAlign = 'right'; g.fillText(p.toFixed(1), pad[3] - 6, Y(p) + 3); }
      g.fillStyle = cssv('--text-2'); g.font = '11px ' + cssv('--font'); g.textAlign = 'center'; g.fillText('Corrected mass flow / design', (W + pad[3]) / 2, H - 8);
      g.save(); g.translate(14, H / 2); g.rotate(-Math.PI / 2); g.fillText('Pressure ratio', 0, 0); g.restore();
      // speed lines
      g.strokeStyle = cssv('--text-2'); g.lineWidth = 1.4;
      for (const s of M.speeds) { g.beginPath(); s.pts.forEach(([m, p], i) => i ? g.lineTo(X(m), Y(p)) : g.moveTo(X(m), Y(p))); g.stroke(); const l = s.pts[s.pts.length - 1]; g.fillStyle = cssv('--text-3'); g.font = '10.5px ' + cssv('--font'); g.textAlign = 'left'; g.fillText(`${(s.n * 100).toFixed(0)}%`, X(l[0]) + 4, Y(l[1])); }
      // current speed line
      g.strokeStyle = cssv('--accent'); g.lineWidth = 2; g.beginPath(); op.pts.forEach(([m, p], i) => i ? g.lineTo(X(m), Y(p)) : g.moveTo(X(m), Y(p))); g.stroke();
      // surge line
      g.strokeStyle = cssv('--bad'); g.lineWidth = 2.2; g.beginPath(); M.surge.forEach(([m, p], i) => i ? g.lineTo(X(m), Y(p)) : g.moveTo(X(m), Y(p))); g.stroke();
      g.fillStyle = cssv('--bad'); g.textAlign = 'left'; g.font = '600 11px ' + cssv('--font'); const sl = M.surge[Math.floor(M.surge.length * 0.6)]; g.fillText('SURGE LINE', X(sl[0]) - 80, Y(sl[1]) - 8);
      // operating line (throttle)
      g.strokeStyle = cssv('--good'); g.setLineDash([6, 4]); g.lineWidth = 1.8; g.beginPath();
      for (let i = 0; i <= 50; i++) { const m = 0.5 + 0.6 * i / 50, p = 1 + (A.piD - 1) * (m / A.throttle) ** 2; i ? g.lineTo(X(m), Y(p)) : g.moveTo(X(m), Y(p)); } g.stroke(); g.setLineDash([]);
      g.fillStyle = cssv('--good'); g.fillText('operating line', X(0.62) + 6, Y(1 + (A.piD - 1) * (0.62 / A.throttle) ** 2) + 14);
      // point
      g.fillStyle = cssv('--text'); g.beginPath(); g.arc(X(op.m), Y(op.p), 5.5, 0, 2 * Math.PI); g.fill();
      g.fillStyle = cssv('--text-3'); g.font = '11px ' + cssv('--font'); g.textAlign = 'left'; g.fillText('Shading: efficiency islands (darker = higher)', pad[3] + 8, pad[0] + 12);
    });
    insightsList(insEl, [
      SM < 0.1 ? { type: 'b', t: 'Close to surge', d: 'Surge is a violent flow reversal through the whole compressor. Engines keep 15–25% margin; open the throttle factor or lower the speed.' } : { type: 'g', t: `Surge margin ${(SM * 100).toFixed(0)}%`, d: 'Enough margin for transients and inlet distortion.' },
      { type: 'i', t: 'Reading a map', d: 'Each speed line shows how pressure ratio falls as flow rises toward choke. The engine runs where the compressor and turbine flow capacities agree: the operating line. Accelerating (adding fuel) pushes the point toward surge before speed catches up.' },
    ]);
  }

  build(); compute();
  return { controls, main, show() { compute(); }, hide() { animate(false); }, destroy() { animate(false); } };
}
