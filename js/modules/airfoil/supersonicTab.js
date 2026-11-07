// Airfoil Lab › Supersonic tab: shock-expansion theory on sharp sections (instant), or live 2-D Euler
// CFD on any airfoil, including round-nose NACA sections with a detached bow shock.
// Reuses the Shocks & Nozzles field renderer, its CFD solver and the shared gas-dynamics library.
import { h, section, slider, segmented, toggle, select, field, info, icon, cssVar, fmtSI } from '../../lib/ui.js';
import { Plot } from '../../lib/plot.js';
import { FieldStage, body as drawBody, line, label, arrow } from '../compressible/field.js';
import { metricsGrid, stageLayers, card } from '../compressible/common.js';
import { pointInPoly } from '../compressible/scenes.js';
import { Euler2D } from '../../solvers/euler2d.js';
import { AirfoilSession } from '../../solvers/mfoil/api.js';
import { solveSupersonic, sharpAirfoil, explainFailure, SHAPES, DEG } from '../../solvers/supersonic.js';
import { thetaMax } from '../../solvers/gasdyn.js';
import { superConcepts } from './learn.js';
import { drawSupersonicTheory } from '../compressible/supersonicDraw.js';

const G = 1.4;
const BOUNDS = { x0: -0.55, x1: 1.95, y0: -0.85, y1: 0.85 };

export function supersonicTab({ getAnalyzeGeom, setHeader, keep = o => o }) {
  const S = keep({ shape: 'diamond', t: 0.06, xm: 0.5, flat: 0.4, M: 2, alpha: 4, viscous: true, Re: 1e7, xtr: 1,
    model: 'theory', grid: 420, running: true, visible: false, plot2: 'M' });
  const session = new AirfoilSession();
  let R = null, geom = null, solver = null, cfdTimer = null, cfdKey = null, cfdForces = null, hist = { x: [], y: [] }, frameN = 0, alive = true;

  // ---------------- controls ----------------
  const controls = h('div');
  const secA = section('Airfoil');
  const shapeSel = select([
    { group: 'Sharp supersonic sections', items: SHAPES.map(s => ({ value: s.id, label: s.label })) },
    { group: 'Other', items: [{ value: 'analyze', label: 'Same airfoil as the Analyze tab' }] },
  ], S.shape, v => { S.shape = v; syncVis(); update(); });
  const shapeNote = h('div', { class: 'hint' });
  const tS = slider({ label: 'Thickness t/c', min: 0.005, max: 0.2, step: 0.005, value: S.t, format: v => (v * 100).toFixed(1) + '%',
    info: 'Maximum thickness / chord. Supersonic wings are thin (3–6%) because wave drag grows with thickness squared.', onInput: v => { S.t = v; update(); } });
  const xmS = slider({ label: 'Crest position x/c', min: 0.2, max: 0.8, step: 0.01, value: S.xm, digits: 2,
    info: 'Where the diamond is thickest. Moving it aft makes the nose sharper (weaker nose shock) but the rear steeper.', onInput: v => { S.xm = v; update(); } });
  const flatS = slider({ label: 'Flat middle length', min: 0.1, max: 0.7, step: 0.01, value: S.flat, digits: 2, onInput: v => { S.flat = v; update(); } });
  secA.body.append(field('Section', shapeSel), shapeNote, tS.el, xmS.el, flatS.el);

  const secM = section('Method');
  const modelSeg = segmented([{ value: 'theory', label: 'Theory (instant)' }, { value: 'cfd', label: 'Live CFD (Euler)' }], S.model, v => setModel(v));
  const modelHint = h('div', { class: 'hint' });
  secM.body.append(modelSeg.el, modelHint);

  const secF = section('Flow conditions');
  const mS = slider({ label: 'Mach number M∞', min: 0.5, max: 5, step: 0.01, value: S.M, digits: 2,
    info: 'Theory needs M∞ > 1 with an attached nose shock. Live CFD works at any Mach number here, including transonic flow near 1.', onInput: v => { S.M = v; update(); } });
  const aS = slider({ label: 'Angle of attack α', min: -10, max: 15, step: 0.1, value: S.alpha, format: v => (+v).toFixed(1) + '°', onInput: v => { S.alpha = v; update(); } });
  const tmaxHint = h('div', { class: 'hint' });
  secF.body.append(mS.el, aS.el, tmaxHint);

  const secV = section('Skin friction', { collapsible: true });
  const viscT = toggle('Include skin friction', S.viscous, v => { S.viscous = v; syncVis(); update(); }, { tip: 'Adds friction drag from a compressible flat-plate estimate (Eckert reference temperature) on each surface. Theory method only; the CFD is inviscid.' });
  const reS = slider({ label: 'Reynolds number', min: 1e5, max: 2e8, log: true, value: S.Re, format: v => fmtSI(v),
    info: 'Based on chord and free-stream conditions. Supersonic fighter wing ≈ 20–80M, missile fin ≈ 2–10M, wind-tunnel model ≈ 1–5M.', onInput: v => { S.Re = v; update(); } });
  const trS = slider({ label: 'Trip x/c', min: 0, max: 1, step: 0.01, value: S.xtr, format: v => v >= 0.999 ? 'free' : (+v).toFixed(2),
    info: 'Force turbulent flow from this point. "free" switches to turbulent where the local Reynolds number passes 1 million.', onInput: v => { S.xtr = v; update(); } });
  secV.body.append(viscT.el, reS.el, trS.el);
  controls.append(secA.el, secM.el, secF.el, secV.el);

  // ---------------- main ----------------
  const main = h('div', { style: { display: 'none', flexDirection: 'column', gap: '12px' } });
  const metrics = metricsGrid();
  const runBtn = h('button', { class: 'btn sm', type: 'button' });
  const resetBtn = h('button', { class: 'btn sm', type: 'button', title: 'Restart from uniform flow' }, icon('reset', 14), 'Restart');
  const gridSel = select([{ value: '260', label: 'Coarse grid' }, { value: '420', label: 'Medium grid' }, { value: '640', label: 'Fine grid' }, { value: '900', label: 'Very fine grid' }], String(S.grid), v => { S.grid = +v; startCFD(); }, { style: { width: 'auto' } });
  const overlayT = toggle('Theory overlay', true, v => stage.setLayers({ waves: v }), { tip: 'Dashed lines show where shock-expansion theory puts the shocks and Mach waves (sharp sections only).' });
  const cfdStatus = h('span', { class: 'hint', style: { margin: 0 } });
  const paintRun = () => runBtn.replaceChildren(icon(S.running ? 'pause' : 'play', 14), S.running ? 'Pause' : 'Run');
  runBtn.addEventListener('click', () => { S.running = !S.running; paintRun(); });
  resetBtn.addEventListener('click', () => startCFD());
  const cfdBar = h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '8px', display: 'none' } }, runBtn, resetBtn, gridSel, h('div', { style: { minWidth: '150px' } }, overlayT.el), cfdStatus);

  const stageWrap = h('div');
  const stage = new FieldStage(stageWrap, { height: 'max(420px, 54vh)' });
  stageLayers(stage, { quantities: ['M', 'p', 'T', 'p0', 'schlieren'] });

  const resCard = card('CFD convergence', 'Mean change in density per unit time (log scale). The solution is steady when this stops falling.');
  const resPlot = new Plot(resCard, { xlabel: 'iteration', ylabel: 'log₁₀ residual', legend: false, xname: 'iter', yname: 'log₁₀ R', xfmt: v => v.toFixed(0), yfmt: v => v.toFixed(2), pad: [6, 8, 30, 44] });
  resPlot.wrap.style.height = '130px';
  resCard.style.display = 'none';

  const cpCard = card('Surface pressure Cp', 'Pressure coefficient along the chord, axis flipped so suction is up. Solid = shock-expansion theory (or CFD); dashed = linear (Ackeret) theory, Cp = 2θ/√(M²−1).');
  const cpPlot = new Plot(cpCard, { xlabel: 'x / c', ylabel: 'Cp', invertY: true, xname: 'x/c', yname: 'Cp', xfmt: v => v.toFixed(3), yfmt: v => v.toFixed(4) });
  const p2Sel = select([{ value: 'M', label: 'Surface Mach number' }, { value: 'cf', label: 'Skin friction cf' }], S.plot2, v => { S.plot2 = v; drawPlots(); });
  const p2Card = h('div', { class: 'plot-card' }, h('div', { class: 'plot-head' }, h('h4', {}, 'Along the surface'), p2Sel));
  const p2Plot = new Plot(p2Card, { xlabel: 'x / c', ylabel: 'M', xname: 'x/c', xfmt: v => v.toFixed(3), yfmt: v => v.toFixed(4) });
  const plots = h('div', { class: 'plots' }, cpCard, p2Card);

  const sweepNote = h('div', { class: 'hint', style: { margin: '0 2px' } });
  const clCard = card('Lift curve  cl vs α', 'Instant sweep with shock-expansion theory (solid) against linear theory cl = 4α/√(M²−1) (dashed). The dot is the current angle.');
  const clPlot = new Plot(clCard, { xlabel: 'α (deg)', ylabel: 'cl', xname: 'α', yname: 'cl', xfmt: v => v.toFixed(2), yfmt: v => v.toFixed(4) });
  const cdCard = card('Drag vs Mach  cd vs M∞', 'Total drag at the current α as Mach rises: wave drag falls roughly like 1/√(M²−1). Dashed = linear theory wave drag.');
  const cdPlot = new Plot(cdCard, { xlabel: 'M∞', ylabel: 'cd', xname: 'M', yname: 'cd', xfmt: v => v.toFixed(2), yfmt: v => v.toFixed(5) });
  const sweeps = h('div', { class: 'plots' }, clCard, cdCard);
  main.append(cfdBar, metrics.el, stageWrap, resCard, plots, sweepNote, sweeps);

  // ---------------- side ----------------
  const side = h('div');
  const insEl = h('div');
  side.append(h('div', { class: 'side-section' }, h('h3', {}, 'What you\'re seeing'), insEl));
  const learn = h('div', { class: 'side-section' }, h('h3', {}, 'Learn the concepts'));
  for (const c of superConcepts) learn.append(h('details', { class: 'concept' }, h('summary', {}, c.title), h('div', { class: 'body', html: c.html })));
  side.append(learn);

  // ---------------- geometry + solve ----------------
  function buildGeom() {
    if (S.shape !== 'analyze') return sharpAirfoil(S.shape, { t: S.t, xm: S.xm, flat: S.flat, n: S.shape === 'biconvex' ? 120 : 72 });
    const g = getAnalyzeGeom();
    const key = JSON.stringify(g);
    if (geom && geom._key === key) return geom;
    const M = session.buildGeometry({ ...g, npanel: Math.min(g.npanel || 199, 199) });
    const X = M.geom.xpoint;
    return { name: M.geom.name, x: Array.from(X.x), z: Array.from(X.z), _key: key };
  }
  const solveAt = (alpha, M) => solveSupersonic({ ...geom, M, alpha, g: G, viscous: S.viscous, Re: S.Re, xtr: S.xtr });

  function update() {
    geom = buildGeom();
    R = solveAt(S.alpha, S.M);
    const tm = S.M > 1 ? thetaMax(S.M, G) / DEG : 0;
    tmaxHint.textContent = S.M > 1 ? `Largest turn an attached shock can make at M∞ = ${S.M.toFixed(2)}: θmax = ${tm.toFixed(2)}°` : 'Subsonic free stream: no attached shocks. Use Live CFD.';
    if (S.model === 'cfd') {
      // keep a running/converged CFD solution when only the tab was switched
      const key = JSON.stringify([R.body.length, R.body[1], R.body[R.body.length >> 1], S.M, S.alpha, S.grid]);
      stage.setScene(cfdScene());
      if (key !== cfdKey || !solver || !solver.T) { cfdKey = key; scheduleCFD(); }
    }
    else stage.setScene(theoryScene());
    showMetrics(); drawPlots(); drawSweeps(); insights(); header();
  }

  function header() {
    const name = geom?.name || '';
    const sub = `Supersonic · ${S.model === 'cfd' ? 'Euler CFD' : 'shock-expansion theory'} · M∞ = ${S.M.toFixed(2)} · α = ${S.alpha.toFixed(1)}°${S.model === 'theory' && S.viscous && R.ok ? ` · Re = ${fmtSI(S.Re)}` : ''}`;
    let st;
    if (S.model === 'cfd') st = solver && solver.T ? (S.converged ? ['ok', `CFD converged · ${solver.iter} iterations`] : ['busy', `CFD running · iteration ${solver.iter}`]) : ['busy', 'Starting CFD…'];
    else st = R.ok ? ['ok', 'Theory · exact'] : ['bad', 'Theory not valid here'];
    setHeader(name, sub, st[0], st[1]);
  }

  // ---------------- drawing ----------------
  const drawTheory = (ctx, Rr, thin) => drawSupersonicTheory(ctx, Rr, { thick: thin });
  function drawLabels(ctx, Rr, forces) {
    label(ctx, { x: BOUNDS.x0 + 0.06, y: BOUNDS.y1 - 0.08 }, `M∞ = ${S.M.toFixed(2)}, α = ${S.alpha.toFixed(1)}°`);
    if (!Rr) return;
    if (Rr.ok && ctx.layers.waves && S.model === 'theory') {
      const D = Rr.D[0];
      if (D.shock) { const p = D.shock.pts[0], a = D.le.ray; label(ctx, { x: p[0] + 0.42 * Math.cos(a), y: p[1] + 0.42 * Math.sin(a) }, `nose shock β = ${(D.le.beta / DEG).toFixed(1)}°`, { dx: 6 }); }
      const big = D.verts.reduce((b, v) => (v.fan && (!b || v.a1 - v.a2 > b.a1 - b.a2) ? v : b), null);
      if (big && big.a1 - big.a2 > 0.6 * DEG) label(ctx, { x: big.x + 0.35 * Math.cos(big.a1), y: big.y + 0.35 * Math.sin(big.a1) }, 'expansion fan', { dx: 4 });
    }
    // lift and drag arrows at the quarter chord
    if (forces && ctx.layers.labels) {
      const LE = Rr.upperW[0], a = S.alpha * DEG, Q = { x: LE[0] + 0.25 * Math.cos(a), y: LE[1] - 0.25 * Math.sin(a) };
      const sc = 0.9, cl = forces.cl, cd = forces.cd;
      if (Math.abs(cl) > 1e-4) { arrow(ctx, Q, { x: Q.x, y: Q.y + sc * Math.max(-0.6, Math.min(0.6, cl)) }, cssVar('--accent'), 2); label(ctx, { x: Q.x, y: Q.y + sc * Math.max(-0.6, Math.min(0.6, cl)) }, 'lift', { dx: 8, color: cssVar('--accent') }); }
      if (cd > 1e-5) { const L = Math.min(0.6, cd * 10 * sc); arrow(ctx, Q, { x: Q.x + L, y: Q.y }, '#ff8a3d', 2); label(ctx, { x: Q.x + L, y: Q.y }, 'drag ×10', { dx: 6, dy: 10, color: '#ff8a3d' }); }
    }
  }
  const spawn = init => ({ x: init ? BOUNDS.x0 + Math.random() * (BOUNDS.x1 - BOUNDS.x0) : BOUNDS.x0 + 0.02, y: BOUNDS.y0 + Math.random() * (BOUNDS.y1 - BOUNDS.y0) });
  const seeds = () => Array.from({ length: 18 }, (_, i) => ({ x: BOUNDS.x0 + 1e-3, y: BOUNDS.y0 + (BOUNDS.y1 - BOUNDS.y0) * (i + 0.5) / 18 }));
  const bodyPts = () => R.body.map(([x, y]) => ({ x, y }));
  function theoryScene() {
    const pts = bodyPts(), free = { M: S.M, th: 0, p: 1, T: 1, rho: 1, p0: 1 };
    const sample = R.ok ? R.sample : (x, y) => (pointInPoly(x, y, pts) ? null : free);
    return { bounds: BOUNDS, speed: 1 / Math.max(S.M, 0.15), sample, spawn, seeds,
      draw: ctx => {
        drawTheory(ctx, R, false);
        drawBody(ctx, pts);
        drawLabels(ctx, R, R.ok ? { cl: R.cl, cd: R.cd } : null);
        if (!R.ok) label(ctx, { x: 0.5 * (BOUNDS.x0 + BOUNDS.x1), y: BOUNDS.y0 + 0.12 }, 'Theory not valid here — see the note on the right, or switch to Live CFD', { align: 'center', color: '#ffb4b4' });
      } };
  }
  function cfdScene() {
    const pts = bodyPts();
    return { bounds: BOUNDS, thinOverlay: true, sonic: true, speed: 1 / Math.max(S.M, 0.15), spawn, seeds,
      sample: (x, y) => (solver && solver.T ? solver.sample(x, y) : (pointInPoly(x, y, pts) ? null : { M: S.M, th: 0, p: 1, T: 1, rho: 1, p0: 1 })),
      draw: ctx => { drawTheory(ctx, R, true); drawBody(ctx, pts); drawLabels(ctx, R, cfdForces); } };
  }

  // ---------------- live CFD ----------------
  function setModel(v) {
    S.model = v; modelSeg.set(v); cfdKey = null;
    if (v === 'cfd') { S.running = true; paintRun(); } else { clearTimeout(cfdTimer); }
    syncVis(); update();
  }
  function scheduleCFD() { clearTimeout(cfdTimer); cfdStatus.textContent = 'starting…'; cfdTimer = setTimeout(startCFD, 220); }
  function startCFD() {
    if (S.model !== 'cfd' || !S.visible) return;
    try { if (!solver) solver = new Euler2D(); } catch (e) { cfdStatus.textContent = 'CFD unavailable: ' + e.message; return; }
    stage.setScene(cfdScene());
    if (!stage.layout()) { cfdTimer = setTimeout(startCFD, 200); return; }
    const T = stage.T, x0 = T.wx(0), x1 = T.wx(T.W), y0 = T.wy(T.H), y1 = T.wy(0);
    let nx = S.grid, ny = Math.max(16, Math.round(nx * (y1 - y0) / (x1 - x0)));
    if (nx * ny > 700000) { const k = Math.sqrt(700000 / (nx * ny)); nx = Math.round(nx * k); ny = Math.round(ny * k); }
    solver.setup({ nx, ny, x0, y0, dx: (x1 - x0) / nx, dy: (y1 - y0) / ny, g: G, M: S.M, polys: [bodyPts()], pback: S.M < 1 ? 1 / G : 0 });
    solver.readback(); stage.refreshField(); stage.stage.__solver = solver;
    hist = { x: [], y: [] }; resPlot.setData({ series: [] }); S.running = true; S.converged = false; paintRun(); cfdForces = null;
  }
  function measureCFD() {
    // surface pressure sampled just outside each panel, integrated for forces
    const off = 1.6 * Math.max(solver.dx, solver.dy), q = 0.5 * G * S.M * S.M, a = S.alpha * DEG;
    const LE = R.upperW[0], Q = [LE[0] + 0.25 * Math.cos(a), LE[1] - 0.25 * Math.sin(a)];
    let fx = 0, fy = 0, m = 0;
    const surf = [];
    for (let side = 0; side < 2; side++) {
      const Wp = side ? R.lowerW : R.upperW, C = side ? R.chordLower : R.chordUpper, sg = side ? -1 : 1, out = { x: [], cp: [], M: [] };
      for (let i = 0; i < Wp.length - 1; i++) {
        const A = Wp[i], B = Wp[i + 1], dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy); if (L < 1e-9) continue;
        const nx = -sg * dy / L, ny = sg * dx / L, mx = 0.5 * (A[0] + B[0]), my = 0.5 * (A[1] + B[1]);
        const st = solver.sample(mx + nx * off, my + ny * off); if (!st) continue;
        const cp = (st.p - 1) / q, Fx = -cp * nx * L, Fy = -cp * ny * L;
        fx += Fx; fy += Fy; m += (mx - Q[0]) * Fy - (my - Q[1]) * Fx;
        out.x.push(0.5 * (C[i][0] + C[i + 1][0]) - C[0][0]); out.cp.push(cp); out.M.push(st.M);
      }
      surf.push(out);
    }
    return { cl: fy, cd: fx, cm: -m, surf };
  }
  function cfdLoop() {
    if (!alive) return;
    requestAnimationFrame(cfdLoop);
    if (S.model !== 'cfd' || !S.visible || !solver || !solver.T || !S.running) return;
    const cells = solver.nx * solver.ny, k = Math.max(2, Math.min(60, Math.round(3.2e6 / cells)));
    solver.step(k);
    if (++frameN % 6 === 0) {
      solver.readback(); stage.refreshField(); stage.stage.__solver = solver;
      if (isFinite(solver.residual) && solver.residual > 0) { hist.x.push(solver.iter); hist.y.push(Math.log10(solver.residual)); }
      resPlot.setData({ series: [{ x: hist.x, y: hist.y, color: cssVar('--accent'), label: 'residual' }] });
      const drop = solver.res0 > 0 ? solver.residual / solver.res0 : 1;
      if (solver.iter > 400 && (drop < 2e-4 || solver.residual < 1e-7)) { S.running = false; S.converged = true; paintRun(); }
      cfdStatus.textContent = `${solver.nx}×${solver.ny} cells · iteration ${solver.iter} · ${S.converged ? 'converged ✓' : 'residual ' + (isFinite(solver.residual) ? solver.residual.toExponential(1) : '—')}`;
      cfdForces = measureCFD();
      showMetrics(); drawPlots(); header();
      if (frameN % 30 === 0 || S.converged) insights();
    }
  }
  requestAnimationFrame(cfdLoop);

  // ---------------- metrics, plots, insights ----------------
  const f4 = v => (isFinite(v) ? v.toFixed(4) : '—'), f5 = v => (isFinite(v) ? v.toFixed(5) : '—');
  function showMetrics() {
    const regime = S.M < 0.8 ? 'subsonic' : S.M < 1.2 ? 'transonic' : S.M < 5 ? 'supersonic' : 'hypersonic';
    const list = [{ k: 'M∞', v: S.M.toFixed(2), s: regime }];
    if (S.model === 'cfd') {
      const c = cfdForces;
      list.push({ k: 'Lift cl', v: c ? f4(c.cl) : '…', s: R.ok ? `theory ${f4(R.cl)}` : 'Euler CFD', tip: 'From the CFD surface pressure (inviscid, so no friction).' },
        { k: 'Drag cd', v: c ? f5(c.cd) : '…', s: R.ok ? `theory wave ${f5(R.cdw)}` : 'pressure (wave) drag', tip: 'Pressure drag from the CFD. In supersonic flow this is wave drag.' },
        { k: 'L/D', v: c && c.cd > 0 ? (c.cl / c.cd).toFixed(1) : '—', s: 'inviscid' },
        { k: 'Moment cm', v: c ? f4(c.cm) : '…', s: 'about ¼ chord' });
    } else if (R.ok) {
      const rel = R.clLin ? ((R.cl / R.clLin - 1) * 100) : 0;
      list.push({ k: 'Lift cl', v: f4(R.cl), s: `linear ${f4(R.clLin)} (${rel >= 0 ? '+' : ''}${rel.toFixed(1)}%)`, tip: 'Shock-expansion theory. The subtitle is linear (Ackeret) theory for the same shape.' },
        { k: 'Drag cd', v: f5(R.cd), s: S.viscous ? `wave ${f5(R.cdw)} · friction ${f5(R.cdf)}` : 'wave drag only', tip: 'Wave drag comes from the pressure distribution (shocks); friction from the boundary layer estimate.' },
        { k: 'L/D', v: R.cd > 0 ? (R.cl / R.cd).toFixed(1) : '—', s: `${(R.cd * 1e4).toFixed(0)} drag counts` },
        { k: 'Moment cm', v: f4(R.cm), s: R.cm < 0 ? 'nose-down, about ¼ chord' : 'nose-up, about ¼ chord' },
        { k: 'Nose shocks β', v: R.beta.map(b => (b === null ? 'fan' : (b / DEG).toFixed(1) + '°')).join(' / '), s: 'upper / lower', tip: 'Angle of the leading-edge shock on each side ("fan" = the surface turns away and the flow expands instead).' });
    } else list.push({ k: 'Theory', v: 'not valid', s: R.fail === 'detached' ? 'detached nose shock' : R.fail });
    metrics.set(list);
  }
  const css = n => cssVar(n);
  function drawPlots() {
    const cu = css('--upper'), clo = css('--lower'), series = [];
    const src = S.model === 'cfd' ? cfdForces?.surf : (R.ok ? R.surf : null);
    if (src) {
      series.push({ x: src[0].x, y: src[0].cp, color: cu, label: S.model === 'cfd' ? 'upper (CFD)' : 'upper' }, { x: src[1].x, y: src[1].cp, color: clo, label: S.model === 'cfd' ? 'lower (CFD)' : 'lower' });
    }
    if (R.ok) {
      const dashLab = S.model === 'cfd' ? 'theory' : 'linear';
      const yU = S.model === 'cfd' ? R.surf[0].cp : R.surf[0].cpLin, yL = S.model === 'cfd' ? R.surf[1].cp : R.surf[1].cpLin;
      series.push({ x: R.surf[0].x, y: yU, color: cu, dash: [5, 4], width: 1.2, alpha: 0.75, label: dashLab, noHover: true }, { x: R.surf[1].x, y: yL, color: clo, dash: [5, 4], width: 1.2, alpha: 0.75, noHover: true });
    }
    cpPlot.setData({ series });
    // second plot
    const q = S.plot2, s2 = [];
    if (q === 'M' && src) s2.push({ x: src[0].x, y: src[0].M, color: cu, label: 'upper' }, { x: src[1].x, y: src[1].M, color: clo, label: 'lower' });
    if (q === 'cf' && R.ok && S.model === 'theory' && S.viscous) s2.push({ x: R.surf[0].x, y: R.surf[0].cf, color: cu, label: 'upper' }, { x: R.surf[1].x, y: R.surf[1].cf, color: clo, label: 'lower' });
    p2Plot.setOpts({ ylabel: q === 'M' ? 'local M' : 'cf (on q∞)', yname: q, yfmt: v => (Math.abs(v) < 0.01 ? v.toExponential(3) : v.toPrecision(4)) });
    p2Plot.setData({ series: s2, hlines: q === 'M' ? [{ y: S.M, color: css('--text-3'), label: 'M∞', bound: false }] : [] });
    p2Card.style.opacity = s2.length ? 1 : 0.5;
  }
  function drawSweeps() {
    const sharp = S.shape !== 'analyze' || R.ok;
    sweeps.style.display = sharp && S.M > 1 ? '' : 'none';
    sweepNote.style.display = sweeps.style.display;
    if (!(sharp && S.M > 1)) return;
    sweepNote.textContent = 'Instant theory sweeps around the current point (sharp sections only).';
    const A = [], cl = [], clL = [];
    for (let a = -8; a <= 12.001; a += 0.5) { const r = solveAt(a, S.M); if (r.ok) { A.push(a); cl.push(r.cl); clL.push(r.clLin); } }
    const Ms = [], cd = [], cdw = [], cdL = [];
    for (let m = 1.1; m <= 5.001; m += 0.05) { const r = solveAt(S.alpha, m); if (r.ok) { Ms.push(m); cd.push(r.cd); cdw.push(r.cdw); cdL.push(r.cdwLin); } }
    const ac = css('--accent'), or = '#ff8a3d';
    clPlot.setData({ series: [{ x: A, y: cl, color: ac, label: 'shock-expansion', points: true },
      { x: A, y: clL, color: ac, dash: [5, 4], width: 1.2, label: 'linear', noHover: true },
      ...(R.ok ? [{ x: [S.alpha], y: [R.cl], color: or, points: true, pointSize: 5, label: 'now', line: false }] : [])] });
    const s = [{ x: Ms, y: cd, color: ac, label: S.viscous ? 'total' : 'wave', points: true }];
    if (S.viscous) s.push({ x: Ms, y: cdw, color: css('--upper'), label: 'wave' });
    s.push({ x: Ms, y: cdL, color: css('--upper'), dash: [5, 4], width: 1.2, label: 'linear wave', noHover: true });
    if (R.ok) s.push({ x: [S.M], y: [R.cd], color: or, points: true, pointSize: 5, label: 'now', line: false });
    cdPlot.setData({ series: s });
  }

  function insights() {
    const out = [];
    const add = (k, t, d) => out.push({ k, t, d });
    if (S.model === 'theory') {
      if (!R.ok) {
        const e = explainFailure(R);
        add('b', e.t, e.d);
      } else {
        const D = R.D, tm = thetaMax(S.M, G);
        const noseTurn = Math.max(D[0].th[0], D[1].th[0]);
        if (noseTurn > 0) add(noseTurn > 0.75 * tm ? 'w' : 'i', `Nose shock attached (turning ${(noseTurn / DEG).toFixed(1)}° of a possible ${(tm / DEG).toFixed(1)}°)`,
          `The sharp leading edge turns the flow through an oblique shock that touches the nose. ${noseTurn > 0.75 * tm ? 'It is close to detaching: a bit more α or thickness, or a lower Mach number, and a bow shock will stand off the nose.' : 'Pressure jumps across it, then the flow expands smoothly around the rest of the surface.'}`);
        const dl = Math.abs(R.clLin) > 1e-6 ? (R.cl / R.clLin - 1) * 100 : 0;
        add('i', `Lift ${Math.abs(dl) < 3 ? 'close to' : 'differs from'} linear theory (${dl >= 0 ? '+' : ''}${dl.toFixed(1)}%)`,
          `Linear theory says Cp = 2θ/√(M²−1): pressure depends only on the local surface slope, so lift is cl ≈ 4α/√(M²−1) = ${R.clAckeretPlate.toFixed(4)} for any thin shape. The exact result departs from it as angles grow${S.M < 1.4 ? ' and as M∞ approaches 1' : ''}.`);
        if (S.viscous) {
          const fw = R.cdw / R.cd;
          add('i', `Drag is ${(100 * fw).toFixed(0)}% wave drag, ${(100 * (1 - fw)).toFixed(0)}% friction`,
            'Wave drag comes from shocks: front-facing surfaces sit at higher pressure than rear-facing ones, even with no viscosity. It grows with thickness² and α², which is why supersonic wings are thin and sharp.');
        } else add('i', 'Inviscid: drag here is all wave drag', 'Unlike subsonic flow (d\'Alembert: zero drag without viscosity), supersonic flow has drag even with no friction, because shocks raise the pressure on the front of the airfoil.');
        // best L/D (linear estimate)
        const r0 = solveAt(0, S.M), bet = Math.sqrt(S.M * S.M - 1);
        if (r0.ok && r0.cd > 0) {
          const aOpt = Math.sqrt(r0.cd * bet / 4), ld = 2 * aOpt / (bet * r0.cd);
          add('g', `Best L/D ≈ ${ld.toFixed(1)} near α ≈ ${(aOpt / DEG).toFixed(1)}°`, `Linear estimate: L/D peaks where drag due to lift (4α²/β) equals the zero-lift drag (${r0.cd.toFixed(4)}). Supersonic L/D is far below subsonic values because of wave drag.`);
        }
        const xcp = 0.25 - R.cm / (R.cl || 1e-9);
        if (Math.abs(R.cl) > 0.01) add('i', `Centre of pressure near ${(xcp * 100).toFixed(0)}% chord`, 'In subsonic flow lift acts near the quarter chord; in supersonic flow it moves back toward mid-chord. That shift is why aircraft pitch nose-down and need more trim when they go supersonic.');
        if (S.M < 1.3) add('w', 'Low supersonic Mach number', 'Close to Mach 1 the theory is least accurate (shocks are strong and curved, and linear theory blows up as 1/√(M²−1)). Compare with Live CFD.');
        add('i', `Trailing edge: ${D[0].te.type === 'shock' ? 'shock on top' : 'fan on top'}, ${D[1].te.type === 'shock' ? 'shock below' : 'fan below'}`, `The two streams leave with different pressures, so a shock and an expansion form at the trailing edge until both match, leaving a slip line at ${(R.delta / DEG).toFixed(2)}° (dashed).`);
      }
    } else {
      add('i', 'Live CFD: 2-D Euler equations on the GPU', 'The flow is solved cell by cell (finite volume, HLLC fluxes) on a grid around the airfoil. It captures detached bow shocks, transonic shocks and curved waves that the simple theory cannot, but has no viscosity (no friction or separation). Shocks are smeared over a few cells; a finer grid sharpens them.');
      if (!R.ok && R.fail === 'detached') add('i', 'Round or blunt nose: watch the bow shock stand off', 'Behind the curved bow shock there is a small subsonic region (inside the white sonic line), and the nose pressure rises close to the stagnation value. This is why blunt noses have high wave drag but are used where heating matters (re-entry, hypersonics).');
      if (S.M < 1) add('i', 'Subsonic free stream', `Below Mach 1 there are no shocks unless the flow speeds up past Mach 1 somewhere on the surface (supercritical flow); then a shock ends the supersonic pocket. The sonic line marks local Mach 1. The CFD grid is small for subsonic flow, so numbers are only approximate.`);
      else if (S.M < 1.2) add('w', 'Transonic', 'Between about Mach 0.85 and 1.2 the flow is mixed subsonic and supersonic: shocks are strong, and drag peaks (the "sound barrier"). Only the CFD can model this.');
      if (R.ok && cfdForces) {
        const d = R.cl ? (cfdForces.cl / R.cl - 1) * 100 : 0;
        add(Math.abs(d) < 5 ? 'g' : 'w', `CFD lift vs theory: ${d >= 0 ? '+' : ''}${d.toFixed(1)}%`, S.converged ? 'Converged. Differences come from shock smearing on the grid and the theory ignoring waves reflected from the shock.' : 'Still converging — the number will settle as the residual drops.');
      }
    }
    insEl.replaceChildren(...out.map(i => h('div', { class: 'insight' }, h('div', { class: 'ic ' + i.k }, { i: 'i', w: '!', b: '!', g: '✓' }[i.k]), h('div', {}, h('div', { class: 't' }, i.t), h('div', { class: 'd', html: i.d })))));
    if (S.model === 'theory' && !R.ok && R.fail !== 'vacuum') {
      const b = h('button', { class: 'btn primary', style: { marginTop: '8px' } }, 'Switch to Live CFD');
      b.addEventListener('click', () => setModel('cfd'));
      insEl.append(b);
    }
  }

  function syncVis() {
    const s = S.shape, show = (el, on) => { el.style.display = on ? '' : 'none'; };
    show(tS.el, s !== 'plate' && s !== 'analyze'); show(xmS.el, s === 'diamond'); show(flatS.el, s === 'hexagon');
    shapeNote.textContent = s === 'analyze' ? 'Uses the airfoil chosen in the Analyze tab. Round-nose sections (all NACA airfoils) need Live CFD: their bow shock stands off the nose.' : SHAPES.find(q => q.id === s).note;
    const cfd = S.model === 'cfd';
    show(cfdBar, cfd); show(resCard, cfd);
    modelHint.textContent = cfd ? 'Solves the 2-D Euler equations on the GPU. Works for any shape and Mach number, takes a few seconds to settle, no friction.'
      : 'Exact oblique-shock and Prandtl–Meyer relations along the surface. Instant, but needs a sharp nose and M∞ > 1.';
    secV.el.style.opacity = cfd ? 0.45 : 1;
    for (const c of [reS.el, trS.el]) c.style.opacity = S.viscous ? 1 : 0.45;
    stage.setLayers({ waves: cfd ? overlayT.get() : true });
  }

  paintRun(); syncVis();
  return {
    controls, main, side,
    show() { S.visible = true; main.style.display = 'flex'; geom = null; update(); stage.dirty = true; },
    hide() { S.visible = false; main.style.display = 'none'; clearTimeout(cfdTimer); },
    destroy() { alive = false; stage.destroy(); solver && solver.dispose(); },
  };
}
