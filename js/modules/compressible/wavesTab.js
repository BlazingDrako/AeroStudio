// Shocks & Expansions tab: pick a scenario, see the flow, read every region's state.
import { h, section, slider, segmented, toggle, select, field, info } from '../../lib/ui.js';
import { Plot } from '../../lib/plot.js';
import { FieldStage } from './field.js';
import { SCENARIOS, buildScene } from './scenes.js';
import { gasPicker, metricsGrid, insightsList, regionTable, card, stageLayers } from './common.js';
import { thetaMax, DEG } from '../../solvers/gasdyn.js';
import { Euler2D } from '../../solvers/euler2d.js';
import { icon } from '../../lib/ui.js';
import { sendTo, sendSection } from '../../lib/send.js';

const DEFAULTS = {
  normal: { M: 2 }, ramp: { M: 2.5, angle: 15 }, corner: { M: 2, angle: 20 }, isocomp: { M: 3, angle: 18 },
  wedge: { M: 2.5, angle: 12 }, diamond: { M: 2.2, angle: 0, alpha: 5, thick: 0.08 }, blunt: { M: 3 }, reflect: { M: 2.6, angle: 10 }, cone: { M: 1.6 },
};

export function wavesTab(shell) {
  const S = (shell.keep || (o => o))({ id: 'ramp', M: 2.5, angle: 15, alpha: 5, thick: 0.08, strong: false, g: 1.4, R: 287.05, gas: 'air', pinf: 101.325, Tinf: 288.15, model: 'theory', res: 420, running: true });
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });

  // ---- controls ----
  const secS = section('Scenario');
  const scSel = select(SCENARIOS.map(s => ({ value: s.id, label: s.label })), S.id, v => { S.id = v; Object.assign(S, DEFAULTS[v]); syncSliders(); update(); });
  const desc = h('div', { class: 'hint' });
  secS.body.append(field('Flow situation', scSel), desc);
  const secF = section('Free stream');
  const mS = slider({ label: 'Mach number M∞', min: 0.1, max: 8, step: 0.01, value: S.M, digits: 2, info: 'Below 1: subsonic (no shocks, smooth turning). Above 1: supersonic (shocks and expansion fans). Type any value.', onInput: v => { S.M = v; update(); } });
  const gasEl = gasPicker(S, () => update());
  const pS = slider({ label: 'Static pressure p∞', min: 0.1, max: 500, step: 0.1, value: S.pinf, format: v => (+v).toFixed(2) + ' kPa', info: 'Optional: used only for the dimensional columns of the region table (kPa, K, m/s). Sea level = 101.325 kPa, 288.15 K.', onInput: v => { S.pinf = v; refreshTable(); } });
  const tS = slider({ label: 'Static temperature T∞', min: 20, max: 3000, step: 1, value: S.Tinf, format: v => (+v).toFixed(1) + ' K', onInput: v => { S.Tinf = v; refreshTable(); } });
  secF.body.append(mS.el, gasEl, pS.el, tS.el);
  const secG = section('Geometry');
  const aS = slider({ label: 'Turning angle θ', min: 0, max: 45, step: 0.1, value: S.angle, format: v => (+v).toFixed(1) + '°', onInput: v => { S.angle = v; update(); } });
  const alS = slider({ label: 'Angle of attack α', min: -15, max: 15, step: 0.1, value: S.alpha, format: v => (+v).toFixed(1) + '°', onInput: v => { S.alpha = v; update(); } });
  const thS = slider({ label: 'Thickness t/c', min: 0, max: 0.3, step: 0.005, value: S.thick, digits: 3, info: 'Diamond airfoil maximum thickness / chord. Set 0 for a flat plate.', onInput: v => { S.thick = v; update(); } });
  const strongT = toggle('Strong-shock solution', false, v => { S.strong = v; update(); }, { tip: 'For a given θ the oblique-shock equation has two solutions. The weak one (smaller β) is what free ramps produce; the strong one (subsonic behind) needs a high downstream pressure.' });
  const tmaxHint = h('div', { class: 'hint' });
  secG.body.append(aS.el, alS.el, thS.el, strongT.el, tmaxHint);
  controls.append(secS.el, secF.el, secG.el, sendSection([
    { label: 'θ–β–M chart', sub: 'This Mach number and turning angle on the shock polar', go: () => {
      if (!['ramp', 'wedge'].includes(S.id)) return 'Pick the compression ramp or the wedge to send its angle to the chart';
      if (S.M <= 1.01) return 'The θ–β–M chart is for supersonic flow (M > 1)';
      sendTo({ mod: 'compressible', tab: 'tbm', note: `M ${+S.M.toFixed(3)}, θ ${+S.angle.toFixed(2)}° on the θ–β–M chart`,
        values: { M: S.M, theta: Math.min(45.5, S.angle), branch: S.strong ? 'strong' : 'weak', g: S.g, R: S.R, gas: S.gas } });
    } },
  ]));

  // ---- main ----
  const metrics = metricsGrid();
  const stageWrap = h('div');
  const stage = new FieldStage(stageWrap);
  const layerUI = stageLayers(stage);

  // ---- model switch: exact theory vs live CFD ----
  const modelSeg = segmented([{ value: 'theory', label: 'Theory (exact / linear)' }, { value: 'cfd', label: 'Live CFD (Euler)' }], 'theory', v => { S.model = v; S.running = true; update(); });
  const runBtn = h('button', { class: 'btn sm', type: 'button' }), resetBtn = h('button', { class: 'btn sm', type: 'button', title: 'Restart from uniform flow' }, icon('reset', 14), 'Restart');
  const resSel = select([{ value: '260', label: 'Coarse grid' }, { value: '420', label: 'Medium grid' }, { value: '640', label: 'Fine grid' }, { value: '900', label: 'Very fine grid' }], String(S.res), v => { S.res = +v; startCFD(); }, { style: { width: 'auto' } });
  const overlayT = toggle('Theory overlay', true, v => stage.setLayers({ waves: v }), { tip: 'Dashed lines show where exact theory puts the shocks and expansion fans, for comparison with the CFD solution.' });
  const cfdStatus = h('span', { class: 'hint', style: { margin: 0 } });
  const paintRun = () => runBtn.replaceChildren(icon(S.running ? 'pause' : 'play', 14), S.running ? 'Pause' : 'Run');
  runBtn.addEventListener('click', () => { S.running = !S.running; paintRun(); });
  resetBtn.addEventListener('click', () => startCFD());
  const cfdBar = h('div', { class: 'row cf-cfdbar', style: { flexWrap: 'wrap', gap: '8px' } }, runBtn, resetBtn, resSel, h('div', { style: { minWidth: '150px' } }, overlayT.el), cfdStatus);
  const resPlotCard = card('CFD convergence', 'Mean change in density per unit time (log scale). The solution is steady when this stops falling.');
  const resPlot = new Plot(resPlotCard, { xlabel: 'iteration', ylabel: 'log₁₀ residual', legend: false, xname: 'iter', yname: 'log₁₀ R', xfmt: v => v.toFixed(0), yfmt: v => v.toFixed(2), pad: [6, 8, 30, 44] });
  resPlot.wrap.style.height = '140px';
  const modelRow = h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '10px' } }, h('div', { style: { minWidth: '300px' } }, modelSeg.el), cfdBar);
  const cpCard = card('Surface pressure', 'Pressure coefficient on the upper and lower surfaces. Axis flipped so suction is up.');
  const cpPlot = new Plot(cpCard, { xlabel: 'x / c', ylabel: 'Cp', invertY: true, xname: 'x/c', yname: 'Cp', xfmt: v => v.toFixed(3), yfmt: v => v.toFixed(4) });
  const tableCard = card('Flow regions', 'State in each uniform region, relative to the free stream. Dimensional values use the free-stream p∞ and T∞ you set.');
  const tableBody = h('div'); tableCard.append(tableBody);
  const insEl = h('div');
  const insCard = h('div', { class: 'plot-card' }, h('div', { class: 'plot-head' }, h('h4', {}, 'What you\'re seeing')), insEl);
  const lower = h('div', { class: 'cf-grid2' }, tableCard, insCard);
  main.append(modelRow, metrics.el, stageWrap, resPlotCard, lower, cpCard);

  let last = null, solver = null, cfdErr = null, cfdTimer = null, hist = { x: [], y: [] }, frameN = 0, alive = true;
  const CFD_IDS = ['normal', 'ramp', 'corner', 'isocomp', 'wedge', 'diamond', 'blunt', 'reflect'];
  function startCFD() {
    if (!last || !last.cfd) return;
    try { if (!solver) solver = new Euler2D(); } catch (e) { cfdErr = e.message; cfdStatus.textContent = 'CFD unavailable: ' + cfdErr; return; }
    const sc = cfdScene();
    stage.setScene(sc);
    if (!stage.layout()) { cfdTimer = setTimeout(startCFD, 200); return; }
    const T = stage.T, x0 = T.wx(0), x1 = T.wx(T.W), y0 = T.wy(T.H), y1 = T.wy(0);
    let nx = S.res, ny = Math.max(16, Math.round(nx * (y1 - y0) / (x1 - x0)));
    if (nx * ny > 700000) { const k = Math.sqrt(700000 / (nx * ny)); nx = Math.round(nx * k); ny = Math.round(ny * k); }
    const c = last.cfd;
    solver.setup({ nx, ny, x0, y0, dx: (x1 - x0) / nx, dy: (y1 - y0) / ny, g: S.g, M: S.M, polys: c.polys, init: c.init, pback: c.pback ?? (S.M < 1 ? 1 / S.g : 0) });
    solver.readback(); stage.refreshField(); stage.stage.__solver = solver; // test hook
    hist = { x: [], y: [] }; resPlot.setData({ series: [] }); S.running = true; paintRun(); S.converged = false;
  }
  function cfdScene() {
    const th = last.scene;
    return { bounds: th.bounds, thinOverlay: true, sonic: true, speed: th.speed, spawn: th.spawn, seeds: th.seeds, draw: th.draw,
      sample: (x, y) => (solver ? solver.sample(x, y) : null) };
  }
  function cfdLoop() {
    if (!alive) return;
    requestAnimationFrame(cfdLoop);
    if (S.model !== 'cfd' || !solver || !solver.T || !S.running) return;
    const cells = solver.nx * solver.ny, k = Math.max(2, Math.min(60, Math.round(3.2e6 / cells)));
    solver.step(k);
    if (++frameN % 6 === 0) {
      solver.readback(); stage.refreshField(); stage.stage.__solver = solver; // test hook
      if (isFinite(solver.residual) && solver.residual > 0) { hist.x.push(solver.iter); hist.y.push(Math.log10(solver.residual)); }
      const css = getComputedStyle(document.documentElement);
      resPlot.setData({ series: [{ x: hist.x, y: hist.y, color: css.getPropertyValue('--accent').trim(), label: 'residual' }] });
      const drop = solver.res0 > 0 ? solver.residual / solver.res0 : 1;
      if (solver.iter > 400 && (drop < 2e-4 || solver.residual < 1e-7)) { S.running = false; S.converged = true; paintRun(); }
      cfdStatus.textContent = `${solver.nx}×${solver.ny} cells · iteration ${solver.iter} · t = ${solver.time.toFixed(2)} · ${S.converged ? 'converged ✓' : 'residual ' + (isFinite(solver.residual) ? solver.residual.toExponential(1) : '—')}`;
    }
  }
  requestAnimationFrame(cfdLoop);
  const refreshTable = () => { if (last) tableBody.replaceChildren(regionTable(last.regions, { p: S.pinf * 1000, T: S.Tinf, R: S.R, g: S.g })); };
  function syncSliders() {
    scSel.value = S.id; mS.set(S.M); aS.set(S.angle ?? 10); alS.set(S.alpha ?? 0); thS.set(S.thick ?? 0.08);
  }
  function update() {
    const id = S.id;
    const sc = SCENARIOS.find(s => s.id === id);
    desc.textContent = {
      normal: 'A straight shock across a duct: the flow jumps from supersonic to subsonic.',
      ramp: 'Concave corner. Supersonic: oblique shock (or detached bow shock past θmax). Subsonic: smooth turning.',
      corner: 'Convex corner. Supersonic: a centred Prandtl–Meyer expansion fan. Subsonic: smooth acceleration.',
      isocomp: 'A gently curved ramp sends Mach waves that converge and coalesce into a shock.',
      wedge: 'Symmetric wedge followed by a flat afterbody: nose shock plus shoulder expansion.',
      diamond: 'Shock-expansion theory on a diamond (double-wedge) airfoil: lift and wave drag, compared to linear theory.',
      blunt: 'Detached bow shock in front of a blunt nose; subsonic pocket, sonic line, pitot pressure.',
      reflect: 'An oblique shock hits a wall and reflects — regular reflection or a Mach stem.',
      cone: 'A point source emitting sound: Doppler bunching below M = 1, a Mach cone above.',
    }[id];
    const show = (el, on) => { el.style.display = on ? '' : 'none'; };
    show(aS.el, ['ramp', 'corner', 'isocomp', 'wedge', 'reflect'].includes(id));
    show(alS.el, id === 'diamond'); show(thS.el, id === 'diamond'); show(strongT.el, id === 'ramp');
    aS.el.querySelector('.field-label').firstChild.textContent = id === 'wedge' ? 'Wedge half-angle' : id === 'reflect' ? 'Deflection θ (generator)' : id === 'isocomp' ? 'Total turning' : 'Turning angle θ';
    tmaxHint.textContent = S.M > 1 ? `θmax at M = ${S.M.toFixed(2)}: ${(thetaMax(S.M, S.g) / DEG).toFixed(2)}° (largest turn an attached shock can make)` : 'Subsonic: no θmax — no shocks form.';
    show(tmaxHint, ['ramp', 'wedge', 'reflect', 'diamond'].includes(id));
    const res = buildScene(id, { M: S.M, g: S.g, angle: S.angle, alpha: S.alpha, thick: S.thick, strong: S.strong });
    last = res;
    const cfdOK = CFD_IDS.includes(id) && res.cfd;
    modelSeg.el.style.opacity = cfdOK ? '' : '0.5';
    if (!cfdOK && S.model === 'cfd') { S.model = 'theory'; modelSeg.set('theory'); }
    const cfdOn = S.model === 'cfd';
    show(cfdBar, cfdOn); show(resPlotCard, cfdOn);
    stage.setLayers({ waves: cfdOn ? overlayT.get() : true });
    if (cfdOn) { clearTimeout(cfdTimer); stage.setScene(cfdScene()); cfdStatus.textContent = 'starting…'; cfdTimer = setTimeout(startCFD, 180); }
    else stage.setScene(res.scene);
    metrics.set([{ k: 'M∞', v: S.M.toFixed(3), s: S.M < 1 ? 'subsonic' : S.M < 1.2 ? 'transonic/low supersonic' : S.M < 5 ? 'supersonic' : 'hypersonic' }, ...res.metrics].slice(0, 7));
    refreshTable();
    show(tableCard, id !== 'cone');
    insightsList(insEl, res.insights);
    if (res.cp) {
      show(cpCard, true);
      const series = [{ x: res.cp.x, y: res.cp.upper, color: 'var(--upper)', label: 'upper' }, { x: res.cp.x, y: res.cp.lower, color: 'var(--lower)', label: 'lower' }];
      const css = getComputedStyle(document.documentElement);
      series[0].color = css.getPropertyValue('--upper').trim(); series[1].color = css.getPropertyValue('--lower').trim();
      if (res.cp.linUpper) series.push({ x: res.cp.x, y: res.cp.linUpper, color: series[0].color, dash: [5, 4], label: 'upper (linear)', width: 1.2 }, { x: res.cp.x, y: res.cp.linLower, color: series[1].color, dash: [5, 4], label: 'lower (linear)', width: 1.2 });
      cpPlot.setData({ series });
      cpCard.querySelector('h4').textContent = 'Surface pressure — ' + res.cp.note;
    } else show(cpCard, false);
  }
  paintRun(); syncSliders(); update();
  return { controls, main, title: 'Shocks & expansions', destroy: () => { alive = false; stage.destroy(); solver && solver.dispose(); }, load: p => { Object.assign(S, p); syncSliders(); update(); } };
}
