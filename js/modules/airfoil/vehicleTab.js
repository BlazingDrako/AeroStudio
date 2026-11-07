// Airfoil Lab, Vehicle aero tab: cars and planes in side profile. The flow pattern, pressure and how the force is
// shared between the parts come from an inviscid panel method with ground effect (js/solvers/panel2d.js); real units
// come from one calibration constant (cars) or from the aircraft's weight (planes); drag uses published typical
// values. Wakes, wheels, windows, fuselages and other details are drawn, not computed.
// Built like the Supersonic tab: vehicleTab({ setHeader }) → { controls, main, side, show, hide, destroy }.
import { h, info, section, slider, toggle, select, field, cssVar } from '../../lib/ui.js';
import { solvePanels } from '../../solvers/panel2d.js';
import { VEHICLES, defaults, solverBodies, isaDensity, outlinesOf, smoothClosed } from './vehicles.js';
import { divergingJS } from './flowView.js';
import { fmt as U, UNIT_SYSTEMS, unitSystem, setUnitSystem, sliderUnits } from './vehicleUnits.js';
import { vehicleInsights, HOW } from './vehicleInsights.js';
import { vehicleConcepts } from './vehicleLearn.js';

const G0 = 9.81, RHO0 = 1.225;
// 2-D → 3-D: C_L·A = (2-D force per unit span and dynamic pressure) × an effective width. Each race car's width is
// set so its default setup reproduces its published C_L·A; the sliders then change the force as the panel method
// finds. The road car (no published downforce) uses the race cars' average. Widths below the real ~2 m stand for
// 3-D losses: air spilling round the sides and wing tips.
const weffCache = new Map();
export function effectiveWidth(v) {
  if (weffCache.has(v.id)) return weffCache.get(v.id);
  let w;
  if (v.calibrate) {
    const b = v.build(defaults(v)), sb = solverBodies(b), S = solvePanels(sb.bodies, { ground: b.ground });
    w = v.CLA / S.forces.reduce((s, f) => s + f.fy, 0);
  } else { const race = VEHICLES.filter(x => x.kind === 'car' && x.calibrate); w = race.reduce((s, x) => s + effectiveWidth(x), 0) / race.length; }
  weffCache.set(v.id, w); return w;
}
const DOWN = '#22c55e', UP = '#f59e0b';  // as the Airfoil Lab's lift and drag arrows; they stand apart from the blue/red pressure map
const CP_MIN = -2;                        // pressure colour scale: Cp from −2 (suction) to +1 (stagnation)

const ctx2 = document.createElement('canvas').getContext('2d');
function rgb(css, fb = '#888888') { ctx2.fillStyle = fb; ctx2.fillStyle = css || fb; const s = ctx2.fillStyle; return s[0] === '#' ? [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16)) : (s.match(/[\d.]+/g) || [136, 136, 136]).slice(0, 3).map(Number); }
const isDark = () => (document.documentElement.dataset.resolvedTheme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';

// Results in real units for a vehicle and its solved flow
export function evaluate(v, p, built, S, owner) {
  const parts = built.parts.map((part, i) => {
    let fy = 0, fx = 0, m = 0;
    S.forces.forEach((f, k) => { if (owner[k] === i) { fy += f.fy; fx += f.fx; m += f.fy * (isFinite(f.xcp) ? f.xcp : 0); } });
    return { name: part.name, short: part.short || part.name, role: part.role, fy, fx, xcp: Math.abs(fy) > 1e-12 ? m / fy : NaN };
  });
  // bodies: split into the upper surface (panels facing up) and the underside (facing down), each with its centre
  parts.forEach((x, i) => {
    if (x.role !== 'body') return;
    const sub = { up: { fy: 0, m: 0 }, down: { fy: 0, m: 0 } };
    S.ranges.forEach(([a, e], k) => {
      if (owner[k] !== i) return;
      for (let j = a; j < e; j++) { const pn = S.panels[j], f = -S.Cp[j] * pn.len * pn.ny, t = pn.ny >= 0 ? sub.up : sub.down; t.fy += f; t.m += f * pn.mx; }
    });
    x.sub = ['up', 'down'].map(k => ({ side: k, fy: sub[k].fy, xcp: Math.abs(sub[k].fy) > 1e-12 ? sub[k].m / sub[k].fy : NaN }));
  });
  const fyTot = parts.reduce((s, x) => s + x.fy, 0);
  if (v.kind === 'car') {
    const V = p.speed / 3.6, q = 0.5 * RHO0 * V * V, W_EFF = effectiveWidth(v);
    parts.forEach(x => { x.N = q * x.fy * W_EFF; if (x.sub) x.sub.forEach(u => { u.N = q * u.fy * W_EFF; }); }); // vertical force, + up
    const lift = q * fyTot * W_EFF, drag = q * v.CdA, weight = v.mass * G0;
    const CLA = -fyTot * W_EFF;                                      // downforce coefficient × area (m²), + down
    const [xf, xr] = built.axles;
    const front = parts.reduce((s, x) => s + (isFinite(x.xcp) ? x.N * (xr - x.xcp) / (xr - xf) : 0), 0);
    return { kind: 'car', parts, lift, drag, weight, q, V, CLA, weff: W_EFF, power: drag * V, frontShare: Math.abs(lift) > 1e-9 ? front / lift : NaN,
      invertSpeed: CLA > 0 ? Math.sqrt(2 * weight / (RHO0 * CLA)) : NaN };
  }
  // plane: total lift = n × weight, shared between wing and tail as the panel method finds
  const rho = isaDensity(p.alt), V = p.speed / 3.6, q = 0.5 * rho * V * V, W = v.mass * G0, L = p.n * W;
  const ok = fyTot > 1e-6;
  parts.forEach(x => { x.N = ok ? L * x.fy / fyTot : NaN; });
  const CL = L / (q * v.S);
  const CD0 = v.CD0, k = 1 / (4 * CD0 * v.LD * v.LD); // simple drag polar giving the stated best L/D
  const drag = q * v.S * (CD0 + k * CL * CL);
  return { kind: 'plane', parts, lift: L, weight: W, q, V, rho, CL, stallMargin: v.CLmax / CL, drag, LD: L / drag, ok };
}

// Lowest point of a part's outlines on the vertical line x
function bottomAt(part, x) {
  let best = Infinity;
  for (const P of outlinesOf(part)) for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [x1, y1] = P[j], [x2, y2] = P[i];
    if ((x1 <= x && x2 >= x) || (x2 <= x && x1 >= x)) { const t = x2 === x1 ? 0 : (x - x1) / (x2 - x1); best = Math.min(best, y1 + t * (y2 - y1)); }
  }
  return best;
}
// Highest point of a part's outlines on the vertical line x (NaN if the line misses them)
function topAt(part, x) {
  let best = -Infinity;
  for (const P of outlinesOf(part)) for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [x1, y1] = P[j], [x2, y2] = P[i];
    if ((x1 <= x && x2 >= x) || (x2 <= x && x1 >= x)) { const t = x2 === x1 ? 0 : (x - x1) / (x2 - x1); best = Math.max(best, y1 + t * (y2 - y1)); }
  }
  return best;
}

export function vehicleTab({ setHeader, keep = o => o }) {
  const qp = new URLSearchParams(location.hash.split('?')[1] || '');
  // last vehicle and setup are remembered; settings in the address bar win
  const box = keep({ v: null, p: null }, { nulls: ['v', 'p'] });
  let v = VEHICLES.find(x => x.id === qp.get('v')) || VEHICLES.find(x => x.id === box.v) || VEHICLES.find(x => x.id === 'f1');
  let p = defaults(v);
  if (!qp.get('v') && box.v === v.id && box.p) for (const pr of v.params) if (typeof box.p[pr.key] === typeof p[pr.key]) p[pr.key] = box.p[pr.key];
  Object.defineProperty(box, 'v', { get: () => v.id, enumerable: true, configurable: true });
  Object.defineProperty(box, 'p', { get: () => p, enumerable: true, configurable: true });
  for (const pr of v.params) if (qp.has(pr.key)) p[pr.key] = pr.type === 'toggle' ? qp.get(pr.key) === '1' : Math.min(pr.max, Math.max(pr.min, +qp.get(pr.key) || pr.value));
  const show = { pressure: true, streamlines: true, particles: true, arrows: true, wake: true, labels: true };
  let built = null, drawn = [], S = null, owner = null, R = null, F = null, lines = [], parts = [], alive = true, visible = false, loopOn = false, computeTimer = null, fineTimer = null;

  // ---------------- controls
  const controls = h('div');
  const groups = []; for (const x of VEHICLES) { let g = groups.find(y => y.group === x.group); if (!g) groups.push(g = { group: x.group, items: [] }); g.items.push({ value: x.id, label: x.label }); }
  const secV = section('Vehicle');
  const blurb = h('div', { class: 'hint' });
  secV.body.append(field('Shape', select(groups, v.id, id => { v = VEHICLES.find(x => x.id === id); p = defaults(v); parts = []; buildParams(); recompute(true); })), blurb,
    field('Units', select(UNIT_SYSTEMS, unitSystem(), s => { setUnitSystem(s); buildParams(); if (R) paintInfo(); })));
  const secP = section('Setup');
  const secS = section('Show');
  const tips = { pressure: 'Pressure coefficient: blue where the air is fast and pressure low (suction), red where it is slowed and pressure high.', streamlines: 'Lines the air follows.', particles: 'Moving tracers carried by the flow.', arrows: 'Forces on each part, in real units. Each arrow ends where that part\'s force acts.', wake: 'Where the flow separates behind the vehicle. Drawn, not computed: the panel method has no viscosity.', labels: 'Names and values next to the arrows.' };
  for (const [k, lab] of [['pressure', 'Pressure colours'], ['streamlines', 'Streamlines'], ['particles', 'Moving particles'], ['arrows', 'Force arrows'], ['wake', 'Wake (illustration)'], ['labels', 'Labels']])
    secS.body.append(toggle(lab, show[k], val => { show[k] = val; legendRow.style.visibility = show.pressure || show.arrows ? '' : 'hidden'; }, { tip: tips[k] }).el);
  controls.append(secV.el, secP.el, secS.el);
  function buildParams() {
    blurb.textContent = v.blurb;
    secP.body.replaceChildren(...v.params.map(pr => {
      if (pr.type === 'toggle') return toggle(pr.label, !!p[pr.key], val => { p[pr.key] = val; parts = []; recompute(); }, { tip: pr.info }).el;
      const su = sliderUnits(pr.key); // speed, altitude and ride height run in the chosen units
      if (!su) {
        const sl = slider({ label: pr.label, min: pr.min, max: pr.max, step: pr.step, value: p[pr.key], format: pr.fmt, info: pr.info,
          onInput: val => { const c = Math.min(pr.max, Math.max(pr.min, val)); if (c !== val) sl.set(c); p[pr.key] = c; recompute(); } });
        return sl.el;
      }
      const lo = Math.ceil(pr.min * su.k / su.step - 1e-9) * su.step, hi = Math.floor(pr.max * su.k / su.step + 1e-9) * su.step;
      const sl = slider({ label: pr.label, min: lo, max: hi, step: su.step, value: p[pr.key] * su.k, format: su.fmt, info: pr.info,
        onInput: val => { const c = Math.min(hi, Math.max(lo, val)); if (c !== val) sl.set(c); p[pr.key] = Math.min(pr.max, Math.max(pr.min, c / su.k)); recompute(); } });
      return sl.el;
    }));
  }

  // ---------------- main
  const main = h('div', { class: 'vh-main', style: { display: 'none' } });
  const metrics = h('div', { class: 'metrics vh-metrics' });
  const canvas = h('canvas', { class: 'vh-canvas', 'aria-label': 'Flow around the vehicle' });
  const badge = h('div', { class: 'fs-hud' });
  const stage = h('div', { class: 'stage vh-stage' }, canvas, badge);
  const legendRow = h('div', { class: 'vh-legend' });
  const barsEl = h('div', { class: 'vh-bars' });
  const barsCard = h('div', { class: 'plot-card' }, h('div', { class: 'plot-head' }, h('div', { class: 'row' }, h('h4', {}, 'Where the force comes from'), info('Vertical force on each part. Totals are in real units; the split between the parts and how it changes with the sliders come from the panel calculation.'))), barsEl);
  const howCard = h('div', { class: 'plot-card vh-how' }, h('div', { class: 'plot-head' }, h('h4', {}, 'How this tab works')), h('div', { html: HOW }));
  const learn = h('div', { class: 'cf-learn' }, h('h3', {}, 'Learn the concepts'),
    h('div', { class: 'cf-concepts' }, ...vehicleConcepts.map(c => h('details', { class: 'concept' }, h('summary', {}, c.title), h('div', { class: 'body', html: c.html })))));
  main.append(metrics, stage, legendRow, barsCard, howCard, learn);
  const insEl = h('div');
  const side = h('div', {}, h('div', { class: 'side-section' }, h('h3', {}, 'What you\'re seeing'), insEl));
  const g = canvas.getContext('2d');

  // ---------------- computation
  function domain(b) {
    let xa = Infinity, xb = -Infinity, ya = Infinity, yb = -Infinity;
    const eat = P => { for (const [x, y] of P) { xa = Math.min(xa, x); xb = Math.max(xb, x); ya = Math.min(ya, y); yb = Math.max(yb, y); } };
    for (const part of b.parts) outlinesOf(part).forEach(eat);
    for (const d of b.details) if (d.pts && (d.role === 'ghost' || d.role === 'plate')) eat(d.pts);
    const L = xb - xa, pl = v.kind === 'plane', x0 = xa - (pl ? 0.08 : 0.14) * L, x1 = xb + (pl ? 0.14 : 0.3) * L, Wd = x1 - x0;
    let Hd = Wd / 3;
    if (b.ground) return { x0, x1, y0: 0, y1: Math.max(Hd, yb * 1.35) };
    Hd = Math.max(Hd, (yb - ya) * 1.25); const cy = (ya + yb) / 2; return { x0, x1, y0: cy - Hd / 2, y1: cy + Hd / 2 };
  }
  function recompute(now = false) {
    clearTimeout(computeTimer);
    const run = () => {
      built = v.build(p);
      drawn = built.parts.map(part => outlinesOf(part).map(P => smoothClosed(P)));
      const sb = solverBodies(built); owner = sb.owner;
      S = solvePanels(sb.bodies, { ground: built.ground });
      R = evaluate(v, p, built, S, owner);
      if (v.kind === 'plane' && p.runway) { // same aircraft away from the ground, to show what the runway changes
        const fb = solverBodies(v.build({ ...p, runway: false })), Sf = solvePanels(fb.bodies, { ground: false });
        R.groundRatio = S.forces[0].fy / Sf.forces[0].fy;
      }
      const D = domain(built);
      stage.style.aspectRatio = `${(D.x1 - D.x0) / (D.y1 - D.y0)}`;
      setField(S.grid(D.x0, D.x1, D.y0, D.y1, 96, Math.round(96 * (D.y1 - D.y0) / (D.x1 - D.x0))));
      clearTimeout(fineTimer);
      fineTimer = setTimeout(() => { if (alive && S) setField(S.grid(D.x0, D.x1, D.y0, D.y1, FINE, Math.round(FINE * (D.y1 - D.y0) / (D.x1 - D.x0)))); }, 260);
      paintInfo(); writeHash();
    };
    if (now) run(); else computeTimer = setTimeout(run, 40);
  }
  let cpImg = null;
  const FINE = 340; // columns of the fine pressure/velocity grid
  function setField(f) {
    F = f;
    const { GX, GY, U, V, mask } = f, img = new ImageData(GX, GY), bg = rgb(cssVar('--stage'));
    // Cp in fluid cells; cells inside a body take the value of a fluid neighbour, so the smooth outline drawn on top
    // hides the grid's staircase instead of showing a ragged edge
    const cp = new Float32Array(GX * GY), known = new Uint8Array(GX * GY);
    for (let k = 0; k < GX * GY; k++) if (!mask[k]) { cp[k] = 1 - (U[k] * U[k] + V[k] * V[k]); known[k] = 1; }
    for (let pass = 0; pass < 3; pass++) {
      const add = [];
      for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) {
        const k = j * GX + i; if (known[k]) continue;
        let s = 0, n = 0;
        for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + a, jj = j + b; if (ii >= 0 && jj >= 0 && ii < GX && jj < GY && known[jj * GX + ii]) { s += cp[jj * GX + ii]; n++; } }
        if (n) add.push([k, s / n]);
      }
      for (const [k, val] of add) { cp[k] = val; known[k] = 1; }
    }
    for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) {
      const k = j * GX + i, o = 4 * ((GY - 1 - j) * GX + i);
      const c = known[k] ? divergingJS(cp[k] < 0 ? -Math.min(1, cp[k] / CP_MIN) : Math.min(1, cp[k]), bg) : bg;
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
    }
    cpImg = document.createElement('canvas'); cpImg.width = GX; cpImg.height = GY; cpImg.getContext('2d').putImageData(img, 0, 0);
    lines = [];
    const nSeed = Math.round(26 * (f.y1 - f.y0) / ((f.x1 - f.x0) / 3));
    for (let s = 0; s < nSeed; s++) {
      let x = f.x0 + 0.002 * (f.x1 - f.x0), y = f.y0 + (s + 0.5) / nSeed * (f.y1 - f.y0); const L = [[x, y]];
      const ds = (f.x1 - f.x0) / f.GX * 0.6;
      for (let it = 0; it < 4000; it++) {
        const a = vel(x, y); if (!a) break; const m = Math.hypot(a[0], a[1]); if (m < 1e-4) break;
        const xm = x + 0.5 * ds * a[0] / m, ym = y + 0.5 * ds * a[1] / m, b2 = vel(xm, ym); if (!b2) break; const m2 = Math.hypot(b2[0], b2[1]); if (m2 < 1e-4) break;
        x += ds * b2[0] / m2; y += ds * b2[1] / m2;
        if (x > f.x1 || y < f.y0 || y > f.y1) break;
        L.push([x, y]);
      }
      lines.push(L);
    }
    if (!parts.length) for (let k = 0; k < 600; k++) parts.push(spawn(true));
  }
  function vel(x, y) {
    const f = F; if (!f) return null;
    const fx = (x - f.x0) / (f.x1 - f.x0) * f.GX - 0.5, fy = (y - f.y0) / (f.y1 - f.y0) * f.GY - 0.5;
    const i = Math.floor(fx), j = Math.floor(fy);
    if (i < -1 || j < -1 || i >= f.GX || j >= f.GY) return null;
    const ci = Math.min(f.GX - 1, Math.max(0, Math.round(fx))), cj = Math.min(f.GY - 1, Math.max(0, Math.round(fy)));
    if (f.mask[cj * f.GX + ci]) return null;
    const tx = fx - i, ty = fy - j; let u = 0, w = 0, ws = 0;
    for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
      const ii = Math.min(f.GX - 1, Math.max(0, i + a)), jj = Math.min(f.GY - 1, Math.max(0, j + b)), k = jj * f.GX + ii;
      if (f.mask[k]) continue;
      const wt = (a ? tx : 1 - tx) * (b ? ty : 1 - ty) + 1e-9; u += wt * f.U[k]; w += wt * f.V[k]; ws += wt;
    }
    return ws ? [u / ws, w / ws] : null;
  }
  const spawn = anywhere => ({ x: F.x0 + Math.random() * (F.x1 - F.x0) * (anywhere ? 1 : 0.03), y: F.y0 + Math.random() * (F.y1 - F.y0), age: Math.random() * (anywhere ? 600 : 200) }); // staggered, so no particles move as a wave

  // ---------------- drawing
  let wheelAngle = 0, last = performance.now();
  // Same look as the Airfoil Lab: solid grey bodies with a thin outline, plain arrows, text labels on the field
  function palette() {
    const dk = isDark();
    return {
      dk, text: cssVar('--text'), text2: cssVar('--text-2'), text3: cssVar('--text-3'), stage: cssVar('--stage'), font: cssVar('--font'),
      body: dk ? '#2b313c' : '#cfd5de', edge: cssVar('--text'), dark: cssVar('--text'),
      tyre: dk ? '#14171d' : '#3b414c', rim: dk ? '#59616f' : '#eef0f3', road: cssVar('--bg-sunk'),
      neutral: cssVar('--text'), wake: cssVar('--wake'),
    };
  }
  const ghostLayer = document.createElement('canvas'), gg = ghostLayer.getContext('2d');
  function draw() {
    if (!alive) { loopOn = false; return; }
    if (!visible) { loopOn = false; return; }
    requestAnimationFrame(draw);
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    const dpr = Math.min(devicePixelRatio || 1, 2), r = stage.getBoundingClientRect();
    const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    if (!W || !H) return;
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    if (!F || !built) return;
    const f = F, sx = W / (f.x1 - f.x0), X = x => (x - f.x0) * sx, Y = y => H - (y - f.y0) * sx;
    const C = palette(), tour = (f.x1 - f.x0) / 3.5; // the free stream crosses the view in 3.5 s
    const path = (P, c = g) => { c.beginPath(); P.forEach(([x, y], i) => (i ? c.lineTo(X(x), Y(y)) : c.moveTo(X(x), Y(y)))); };
    const lw = 1.3 * dpr;
    g.clearRect(0, 0, W, H);
    g.fillStyle = C.stage; g.fillRect(0, 0, W, H);
    if (show.pressure && cpImg) { g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(cpImg, 0, 0, W, H); }
    // illustrated wake
    if (show.wake && built.wake) {
      const wk = built.wake, x0 = X(wk.x), len = (f.x1 - wk.x) * sx, yt = Y(wk.y1), yb = Y(wk.y0), hh = yb - yt, wc = rgb(C.wake);
      const grad = g.createLinearGradient(x0, 0, x0 + len, 0);
      grad.addColorStop(0, `rgba(${wc},${C.dk ? 0.3 : 0.22})`); grad.addColorStop(1, `rgba(${wc},0)`);
      g.fillStyle = grad; g.beginPath(); g.moveTo(x0, yt); g.bezierCurveTo(x0 + len * 0.4, yt - hh * 0.2, x0 + len * 0.7, yt - hh * 0.28, x0 + len, yt - hh * 0.32);
      g.lineTo(x0 + len, Math.min(H, yb + hh * 0.08)); g.lineTo(x0, yb); g.closePath(); g.fill();
    }
    if (show.streamlines) {
      g.strokeStyle = C.dk ? 'rgba(240,244,255,0.42)' : 'rgba(20,28,45,0.36)'; g.lineWidth = dpr; g.lineJoin = 'round';
      for (const L of lines) { path(L); g.stroke(); }
    }
    if (show.particles) {
      g.fillStyle = C.dk ? 'rgba(240,244,255,0.75)' : 'rgba(20,28,45,0.6)';
      for (const pt of parts) {
        const a = vel(pt.x, pt.y);
        if (!a || pt.x > f.x1 || pt.y < f.y0 || pt.y > f.y1 || ++pt.age > 600) { Object.assign(pt, spawn(false)); continue; }
        pt.x += a[0] * tour * dt; pt.y += a[1] * tour * dt;
        g.beginPath(); g.arc(X(pt.x), Y(pt.y), 1.1 * dpr, 0, 2 * Math.PI); g.fill();
      }
    }
    if (built.ground) { // road, with lane marks sliding past for cars (a rolling road)
      const y0 = Y(0);
      g.fillStyle = C.road; g.fillRect(0, y0, W, Math.max(4 * dpr, H - y0));
      g.strokeStyle = C.text3; g.lineWidth = dpr; g.beginPath(); g.moveTo(0, y0 + 0.5 * dpr); g.lineTo(W, y0 + 0.5 * dpr); g.stroke();
      if (v.kind === 'car') {
        const per = 2.5 * sx, off = (now / 1000 * tour * sx) % per;
        g.fillStyle = C.text3; g.globalAlpha = 0.6;
        for (let x = -per + off; x < W; x += per) g.fillRect(x, y0 + 3 * dpr, per * 0.45, 1.5 * dpr);
        g.globalAlpha = 1;
      }
    }
    wheelAngle += dt * tour / 0.35;
    // faded shapes beside the slice (fuselage, fin, engine, missile body): merged into one silhouette, so where they
    // overlap no edges cross. Edges are stroked at double width, then covered by the fills, leaving the outer half.
    const ghosts = built.details.filter(d => d.role === 'ghost');
    if (ghosts.length) {
      if (ghostLayer.width !== W || ghostLayer.height !== H) { ghostLayer.width = W; ghostLayer.height = H; }
      gg.clearRect(0, 0, W, H); gg.lineJoin = 'round';
      gg.strokeStyle = C.text2; gg.lineWidth = 2 * lw;
      for (const d of ghosts) { path(d.pts, gg); gg.closePath(); gg.stroke(); }
      gg.fillStyle = C.body;
      for (const d of ghosts) { path(d.pts, gg); gg.closePath(); gg.fill(); }
      g.globalAlpha = v.kind === 'car' ? 0.45 : C.dk ? 0.7 : 0.6; g.drawImage(ghostLayer, 0, 0); g.globalAlpha = 1; // lighter on cars, so the flow round the wings shows through
    }
    const line = d => { // mounts and edges: a thick line in the body colour with the same thin outline as the bodies
      const wpx = Math.max(2 * dpr, (d.w || 0.02) * sx); g.lineCap = 'round'; g.lineJoin = 'round';
      path(d.pts); g.strokeStyle = C.edge; g.lineWidth = wpx + 2 * lw; g.stroke(); g.strokeStyle = C.body; g.lineWidth = wpx; g.stroke();
    };
    for (const d of built.details) if (d.kind === 'line' && !d.front) line(d);
    // the computed parts, drawn from smooth outlines through the panel corners
    g.lineJoin = 'round';
    for (const outs of drawn) for (const P of outs) { path(P); g.closePath(); g.fillStyle = C.body; g.fill(); g.strokeStyle = C.edge; g.lineWidth = lw; g.stroke(); }
    for (const d of built.details) if (d.kind === 'line' && d.front) line(d);
    for (const d of built.details) if (d.kind === 'wheel') drawWheel(d, X, Y, sx, C, dpr, lw);
    if (show.arrows && R) drawForces(X, Y, sx, W, H, dpr, C);
  }
  function drawWheel(d, X, Y, sx, C, dpr, lw) {
    const cx = X(d.x), cy = Y(d.y), rr = d.r * sx, rim = d.rim * sx;
    g.fillStyle = C.tyre; g.beginPath(); g.arc(cx, cy, rr, 0, 2 * Math.PI); g.fill();
    g.strokeStyle = C.edge; g.lineWidth = lw; g.stroke();
    g.fillStyle = C.rim; g.beginPath(); g.arc(cx, cy, rim, 0, 2 * Math.PI); g.fill();
    g.strokeStyle = C.tyre; g.lineWidth = Math.max(dpr, 0.02 * sx); g.lineCap = 'round';
    const n = d.cover ? 3 : 5;
    for (let k = 0; k < n; k++) { const a = wheelAngle + k * 2 * Math.PI / n; g.beginPath(); g.moveTo(cx + Math.cos(a) * rim * 0.28, cy + Math.sin(a) * rim * 0.28); g.lineTo(cx + Math.cos(a) * rim * 0.9, cy + Math.sin(a) * rim * 0.9); g.stroke(); }
    g.fillStyle = C.tyre; g.beginPath(); g.arc(cx, cy, rim * 0.2, 0, 2 * Math.PI); g.fill();
  }
  // plain arrow, as in the Airfoil Lab: shaft and a filled head
  function arrow(x, y, dx, dy, col, C, dpr) {
    const len = Math.hypot(dx, dy); if (len < 2) return;
    const ux = dx / len, uy = dy / len, hh = Math.min(10 * dpr, len * 0.6);
    g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 2.5 * dpr; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + dx - ux * hh * 0.6, y + dy - uy * hh * 0.6); g.stroke();
    g.beginPath(); g.moveTo(x + dx, y + dy); g.lineTo(x + dx - ux * hh - uy * hh * 0.5, y + dy - uy * hh + ux * hh * 0.5);
    g.lineTo(x + dx - ux * hh + uy * hh * 0.5, y + dy - uy * hh - ux * hh * 0.5); g.closePath(); g.fill();
  }
  function dot(x, y, col, C, dpr) { g.fillStyle = col; g.beginPath(); g.arc(x, y, 2.4 * dpr, 0, 2 * Math.PI); g.fill(); }
  // labels as in the Airfoil Lab (text with a thin stage-coloured edge), placed so they do not overlap or leave the canvas
  function labeller(W, H, dpr, C, avoid = []) {
    const placed = [...avoid]; // small parts (wings, fins, wheels) count as taken, so labels never cover them
    const hit = r => placed.some(q => r.x < q.x + q.w + 4 * dpr && q.x < r.x + r.w + 4 * dpr && r.y < q.y + q.h + 2 * dpr && q.y < r.y + r.h + 2 * dpr);
    const f1 = `600 ${12 * dpr}px ${C.font}`, f2 = `${11.5 * dpr}px ${C.font}`;
    return (t1, t2, ax, ay, col, prefer = 'right') => {
      if (!show.labels) return;
      g.font = f1; const w1 = g.measureText(t1).width; g.font = f2; const w2 = t2 ? g.measureText(t2).width : 0;
      const w = Math.max(w1, w2) + 4 * dpr, hh = (t2 ? 30 : 16) * dpr, gap = 8 * dpr;
      const cands = [];
      for (const side of prefer === 'right' ? [1, -1] : [-1, 1]) for (const dy of [0, -1, 1, -2, 2, -3, 3]) cands.push({ x: side > 0 ? ax + gap : ax - gap - w, y: ay - hh / 2 + dy * (hh + 3 * dpr) });
      let r = cands.map(c => ({ x: Math.min(W - w - 3 * dpr, Math.max(3 * dpr, c.x)), y: Math.min(H - hh - 3 * dpr, Math.max(3 * dpr, c.y)), w, h: hh })).find(c => !hit(c));
      if (!r) r = { x: Math.min(W - w - 3 * dpr, Math.max(3 * dpr, ax + gap)), y: Math.min(H - hh - 3 * dpr, Math.max(3 * dpr, ay - hh / 2)), w, h: hh };
      placed.push(r);
      // a label pushed away from its arrow gets a thin leader line back to it
      const nx = Math.min(r.x + r.w, Math.max(r.x, ax)), ny = Math.min(r.y + r.h, Math.max(r.y, ay));
      if (Math.hypot(nx - ax, ny - ay) > 14 * dpr) { g.strokeStyle = col; g.globalAlpha = 0.6; g.lineWidth = dpr; g.beginPath(); g.moveTo(ax, ay); g.lineTo(nx, ny); g.stroke(); g.globalAlpha = 1; }
      g.textAlign = 'left'; g.textBaseline = 'middle'; g.lineJoin = 'round'; g.lineWidth = 3.5 * dpr; g.strokeStyle = C.stage;
      const txt = (t, font, colr, yy) => { g.font = font; g.strokeText(t, r.x + 2 * dpr, yy); g.fillStyle = colr; g.fillText(t, r.x + 2 * dpr, yy); };
      txt(t1, f1, col, r.y + 8 * dpr);
      if (t2) txt(t2, f2, C.text2, r.y + 22 * dpr);
    };
  }
  function drawForces(X, Y, sx, W, H, dpr, C) {
    const items = [];
    R.parts.forEach((x, i) => {
      const part = built.parts[i];
      if (x.sub && R.kind === 'car') for (const u of x.sub) { if (isFinite(u.N) && isFinite(u.xcp)) items.push({ ...u, part, short: u.side === 'up' ? (v.id === 'f1' ? 'Bodywork on top' : 'Roof and bonnet') : (v.id === 'road' ? 'Underbody' : 'Floor'), split: true }); }
      else if (isFinite(x.N) && isFinite(x.xcp)) items.push({ ...x, part });
    });
    const ref = Math.max(R.weight, ...items.map(x => Math.abs(x.N)));
    const avoid = [];
    built.parts.forEach(pp => { if (pp.role !== 'body') for (const P of outlinesOf(pp)) { const xs = P.map(q => X(q[0])), ys = P.map(q => Y(q[1])), x = Math.min(...xs), y = Math.min(...ys); avoid.push({ x: x - 2 * dpr, y: y - 2 * dpr, w: Math.max(...xs) - x + 4 * dpr, h: Math.max(...ys) - y + 4 * dpr }); } });
    for (const d of built.details) if (d.kind === 'wheel') avoid.push({ x: X(d.x - d.r), y: Y(d.y + d.r), w: 2 * d.r * sx, h: 2 * d.r * sx });
    const scale = 0.3 * H / ref, label = labeller(W, H, dpr, C, avoid), queue = [];
    const total = items.reduce((s, x) => s + x.N, 0);
    for (const x of items) {
      let ys = x.split && x.side === 'down' ? bottomAt(x.part, x.xcp) : topAt(x.part, x.xcp);
      if (!isFinite(ys)) { // force centre beyond the outline (it can be, for a spread-out part): use its nearest point
        const pts = outlinesOf(x.part).flat(); const near = pts.reduce((a, q) => (Math.abs(q[0] - x.xcp) < Math.abs(a[0] - x.xcp) ? q : a)); ys = topAt(x.part, near[0]); x.xcp = near[0];
      }
      const px = X(x.xcp), py = Y(ys), up = x.N > 0, col = up ? UP : DOWN;
      const len = Math.min(Math.max(14 * dpr, Math.abs(x.N) * scale), up ? py - 6 * dpr : H);
      const value = R.kind === 'car' ? U.load(x.N) : U.force(x.N);
      const share = R.kind === 'car' && !x.split && Math.abs(total) > 1 && items.length > 1 ? ` · ${Math.round(100 * x.N / total)}%` : '';
      // labels go at the outer (tail) end of the arrow, away from the vehicle
      if (x.split && x.side === 'down' && !up) { // suction on the underside: arrow from the underside down toward the road
        const room = Math.max(10 * dpr, Y(0) - py - 3 * dpr), l2 = Math.min(len, room);
        arrow(px, py + 2 * dpr, 0, l2, col, C, dpr); dot(px, py, col, C, dpr);
        queue.push([x.short, `${value} down (suction)`, px, py + l2 * 0.5, col]); continue;
      }
      if (up) { arrow(px, py - 4 * dpr, 0, -len, col, C, dpr); queue.push([x.short, `${value} ${R.kind === 'car' ? 'lift' : 'up'}${share}`, px, py - 4 * dpr - len, col]); }
      else { const l = Math.min(len, py - 10 * dpr); arrow(px, py - 6 * dpr - l, 0, l, col, C, dpr); queue.push([x.short, `${value} down${share}`, px, py - 6 * dpr - l, col]); }
      dot(px, py, col, C, dpr);
    }
    // weight at the centre of gravity
    const cg = built.cg, cgx = X(cg[0]), cgy = Y(cg[1]), wl = Math.min(Math.max(R.weight * scale, 20 * dpr), Math.max(20 * dpr, H - cgy - 8 * dpr));
    arrow(cgx, cgy, 0, wl, C.neutral, C, dpr); dot(cgx, cgy, C.neutral, C, dpr);
    queue.push(['Weight', R.kind === 'car' ? U.load(R.weight) : U.force(R.weight), cgx, cgy + wl * 0.6, C.neutral, 'left']);
    // drag (and thrust for planes): fixed length, value in the label, always kept inside the canvas
    const allPts = built.parts.flatMap(pp => outlinesOf(pp).flat()), rearX = Math.max(...allPts.map(q => q[0]));
    const fit = (x0, want, dir) => Math.max(18 * dpr, Math.min(want, dir > 0 ? W - 6 * dpr - x0 : x0 - 6 * dpr));
    const fmtD = U.force;
    if (R.kind === 'car') {
      const yD = Y(cg[1] + 0.35 * (Math.max(...allPts.map(q => q[1])) - cg[1]));
      let x0 = X(rearX) + 8 * dpr; const dl = fit(x0, 0.09 * W, 1); x0 = Math.min(x0, W - 6 * dpr - dl);
      arrow(x0, yD, dl, 0, C.neutral, C, dpr);
      queue.push(['Drag (typical)', U.force(R.drag), x0 + dl * 0.5, yD + 22 * dpr, C.neutral]);
    } else { // through the centre of gravity, like a free-body diagram
      const dl = Math.min(0.09 * W, fit(cgx, 0.09 * W, 1), fit(cgx, 0.09 * W, -1)), gap = 0.06 * W;
      const xd = Math.min(cgx + gap, W - 6 * dpr - dl), xt = Math.max(cgx - gap, dl + 6 * dpr);
      arrow(xd, cgy, dl, 0, C.neutral, C, dpr); queue.push(['Drag', fmtD(R.drag), xd + dl, cgy, C.neutral]);
      arrow(xt, cgy, -dl, 0, C.neutral, C, dpr); queue.push([v.missile ? 'Thrust needed' : 'Thrust', fmtD(R.drag), xt - dl, cgy, C.neutral, 'left']);
    }
    for (const q of queue) label(...q);
  }

  // ---------------- read-outs
  function paintInfo() {
    const m = (k, val, s, tip, cls) => h('div', { class: 'metric' + (cls ? ' ' + cls : '') }, h('div', { class: 'k' }, k, tip ? info(tip) : null), h('div', { class: 'v' }, val), h('div', { class: 's' }, s || ''));
    if (R.kind === 'car') {
      const isDown = R.lift < 0;
      if (v.id === 'road') metrics.replaceChildren(
        m(isDown ? 'Downforce (smooth model)' : 'Lift (smooth model)', U.load(R.lift), 'computed with a perfectly smooth underbody', 'The inviscid model treats the underbody as smooth, so the gap under the car acts as a venturi. See the notes.'),
        m('Real road cars', `≈ ${U.load(R.q * 0.3)} lift`, 'typical measured C_L·A ≈ +0.3 m²', 'Published typical value: cluttered underbodies and rear separation leave a small net lift.'),
        m('Drag', U.force(R.drag), `${U.power(R.power)} to push through the air`, 'From a published typical drag area C_D·A ≈ 0.66 m²; not computed. Power = drag × speed.'),
        m('Drag at 2× speed', U.force(4 * R.drag), `${U.power(8 * R.power)} (8× the power)`, 'Drag grows with speed², the power to overcome it with speed³.'));
      else metrics.replaceChildren(
        m(isDown ? 'Downforce' : 'Lift', U.load(R.lift), `${(Math.abs(R.lift) / R.weight).toFixed(2)} × the car's weight`, 'Vertical aerodynamic force at this speed, shown as the weight it equals. It grows with speed squared.'),
        m('Drag', U.force(R.drag), `${U.power(R.power)} to push through the air`, 'From a published typical drag area C_D·A; not computed (an inviscid method gives no drag). Power = drag × speed.'),
        m('Downforce / drag', (Math.abs(R.lift) / R.drag).toFixed(2), 'aerodynamic efficiency', 'How much downforce each newton of drag buys.'),
        m('Aero balance', isFinite(R.frontShare) && R.frontShare >= 0 && R.frontShare <= 1 ? `${Math.round(100 * R.frontShare)}% front` : '—', 'share on the front axle', 'How the vertical force splits between the front and rear axles, from where each part\'s force acts.'),
        m('Upside down above', isFinite(R.invertSpeed) ? U.speed(R.invertSpeed * 3.6) : '—', isFinite(R.invertSpeed) ? 'downforce > weight' : 'no downforce', 'The speed at which downforce equals the car\'s weight, so in theory it could drive on a ceiling.'),
        m('C_L·A', (-R.CLA).toFixed(2) + ' m²', 'lift coefficient × area (− = down)', `From the 2-D slice × an effective width of ${R.weff.toFixed(2)} m${v.calibrate ? ', set so the default setup matches the published value' : ' (average of the race cars)'}.`));
    } else {
      const stall = R.stallMargin < 1, tail = R.parts.find(x => x.role === 'tail');
      metrics.replaceChildren(
        m('Lift', U.force(R.lift), `${p.n.toFixed(1)} × weight (${U.mass(v.mass)})`, v.missile ? 'Lift = load factor × weight: the force needed to turn at this many g.' : 'In steady flight lift = load factor × weight.'),
        m('Lift coefficient needed', R.CL.toFixed(2), stall ? (v.missile ? 'more than the fins can give' : 'more than the wing can give') : `${v.missile ? 'max' : 'wing max'} ≈ ${v.CLmax}`, v.missile ? 'C_L = lift / (½ρV²·S) with S the area of one pair of tail fins and one of canards (0.27 m²); the maximum includes the body\'s lift.' : 'C_L = lift / (½ρV²·S) with the published wing area. Above C_L,max the wing stalls.', stall ? 'bad' : ''),
        m(v.missile ? 'Lift margin' : 'Stall margin', stall ? (v.missile ? 'not enough' : 'stalled') : `${R.stallMargin.toFixed(2)}×`, 'C_L,max / C_L needed', v.missile ? 'How much more lift the missile could make at this speed and altitude.' : 'How far the wing is from stalling at this speed, altitude and load factor.', stall ? 'bad' : ''),
        m(v.missile ? 'Drag' : 'Drag = thrust', U.force(R.drag), `L/D ${R.LD.toFixed(1)}`, 'From a simple drag polar C_D = C_D0 + k·C_L² matching a typical best L/D; not computed.'),
        m('Air density', `${R.rho.toFixed(3)} kg/m³`, `${U.alt(p.alt)} (standard atmosphere)`),
        v.missile ? m('Canard share', R.ok ? `${Math.round(100 * R.parts[0].N / R.lift)}%` : '—', 'of the lift, the rest on the tail fins', 'Share of the lift on the steering canards in this slice.')
          : m('Tail load', R.ok ? `${U.force(tail.N)} ${tail.N < 0 ? 'down' : 'up'}` : '—', 'tailplane', 'Share of the lift on the tailplane in this slice. The tail usually pushes down.'));
    }
    const total = R.parts.reduce((s, x) => s + (isFinite(x.N) ? Math.abs(x.N) : 0), 0) || 1;
    barsEl.replaceChildren(...R.parts.map(x => {
      const val = isFinite(x.N) ? x.N : 0, pct = 100 * Math.abs(val) / total, isUp = val > 0;
      const subTxt = x.sub && R.kind === 'car' ? x.sub.map(u => `${u.side === 'up' ? 'top' : 'underside'} ${U.load(u.N)} ${u.N > 0 ? 'up' : 'down'}`).join(', ') : '';
      return h('div', { class: 'vh-bar' }, h('span', { class: 'n' }, x.name, subTxt ? h('small', {}, subTxt) : null),
        h('span', { class: 'b' }, h('i', { style: { width: pct.toFixed(1) + '%', background: isUp ? UP : DOWN } })),
        h('b', {}, R.kind === 'car' ? `${U.load(val)} ${isUp ? 'lift' : 'down'}` : `${U.force(val)} ${isUp ? 'up' : 'down'}`));
    }));
    const icons = { i: 'i', w: '!', b: '×', g: '✓' };
    insEl.replaceChildren(...vehicleInsights(v, p, R).map(x => h('div', { class: 'insight' }, h('div', { class: 'ic ' + x.type }, icons[x.type]), h('div', {}, h('div', { class: 't' }, x.t), h('div', { class: 'd', html: x.d })))));
    badge.textContent = v.kind === 'car' ? `${v.label} · ${U.speed(p.speed)} · centre-line slice` : `${v.label} · ${U.speed(p.speed)} · ${U.alt(p.alt)} · slice through ${v.missile ? 'canards and tail fins' : 'wing and tail'}`;
    const bg = rgb(cssVar('--stage')), stops = [];
    for (let k = 0; k <= 12; k++) { const cp = CP_MIN + (1 - CP_MIN) * k / 12, c = divergingJS(cp < 0 ? -Math.min(1, cp / CP_MIN) : Math.min(1, cp), bg); stops.push(`rgb(${c}) ${(100 * k / 12).toFixed(1)}%`); }
    const key = (col, t) => h('span', { class: 'vh-key' }, h('i', { style: { background: col } }), t);
    legendRow.replaceChildren(
      h('div', { class: 'vh-cp' }, h('span', { class: 'hint', style: { margin: 0 } }, 'Pressure Cp (computed)'), h('span', { class: 'fs-bar', style: { background: `linear-gradient(90deg,${stops.join(',')})` } }), h('span', { class: 'ticks' }, h('span', {}, '−2 suction'), h('span', {}, '0'), h('span', {}, '+1'))),
      key(DOWN, 'downforce'), key(UP, 'lift'), key(cssVar('--text'), 'weight, drag, thrust'),
      h('span', { class: 'hint', style: { margin: 0 } }, v.kind === 'car' ? 'Wheels and the wake are drawn, not computed.' : v.missile ? 'Solid: computed canard and tail-fin slice. Faded: body and vertical fins.' : 'Solid: computed wing and tail slice. Faded: fuselage beside the slice.'));
    setHeader('Vehicle aero', `${v.label} · side profile`, 'ok', 'Panel method · inviscid');
  }
  function writeHash() {
    if (!visible) return;
    const qs = v.params.map(pr => `${pr.key}=${pr.type === 'toggle' ? (p[pr.key] ? 1 : 0) : +(+p[pr.key]).toPrecision(4)}`).join('&');
    const url = `#/airfoil?tab=vehicles&v=${v.id}&${qs}`;
    if (location.hash !== url) history.replaceState(null, '', url);
  }
  const onTheme = () => { if (S && built) { const D = domain(built); setField(S.grid(D.x0, D.x1, D.y0, D.y1, FINE, Math.round(FINE * (D.y1 - D.y0) / (D.x1 - D.x0)))); paintInfo(); } };
  addEventListener('themechange', onTheme);
  buildParams();
  stage.__vehicle = () => ({ v, p, R, built, S }); // test hook
  return {
    controls, main, side,
    show() {
      visible = true; main.style.display = 'flex';
      if (!built) recompute(true); else { paintInfo(); writeHash(); }
      if (!loopOn) { loopOn = true; last = performance.now(); requestAnimationFrame(draw); }
    },
    hide() { visible = false; main.style.display = 'none'; },
    destroy() { alive = false; clearTimeout(computeTimer); clearTimeout(fineTimer); removeEventListener('themechange', onTheme); },
  };
}
