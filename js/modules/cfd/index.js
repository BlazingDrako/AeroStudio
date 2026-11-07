// Fluid Flow Sandbox: real-time 2-D viscous flow (lattice Boltzmann on the GPU) with obstacles you can
// place, paint, drag and reshape, plus stirring and dye.
import { h, info, section, slider, segmented, toggle, select, field, icon, cssVar } from '../../lib/ui.js';
import { tauForRe, nuFromTau } from '../../solvers/lbm.js';
import { LBMGL } from './lbmGL.js';
import { SCENES, GRIDS, U_LAT, gridSize } from './scenes.js';
import { Geometry, SHAPES, shapeLabel, outline, validNaca } from './shapes.js';
import { sceneInsights } from './insights.js';
import { concepts } from './learn.js';
import { createMeasure, MAX_PROBES } from './measureUI.js';
import { encodeSetup, decodeSetup } from './share.js';
import { sendTo } from '../../lib/send.js';

const VIEWS = [
  { value: 'dye', label: 'Dye', mode: 0, title: 'Ink carried by the flow.' },
  { value: 'vort', label: 'Vorticity', mode: 1, range: 3, title: 'Local spin of the fluid. Red counter-clockwise, blue clockwise.' },
  { value: 'speed', label: 'Speed', mode: 2, range: 1.6, title: 'Flow speed relative to the reference speed U.' },
  { value: 'press', label: 'Pressure', mode: 3, range: 1, title: 'Pressure coefficient Cp = (p − p∞) / ½ρU².' },
];
const TOOLS = [
  { value: 'move', label: 'Move', hint: 'Click an obstacle to select it; drag it to move it through the flow. Delete removes the selected one.' },
  { value: 'brush', label: 'Brush', hint: 'Paint solid walls by dragging.' },
  { value: 'erase', label: 'Erase', hint: 'Drag to erase painted walls. Click inside a shape to remove it.' },
  { value: 'stir', label: 'Stir', hint: 'Drag through the fluid to push it around. Stirring leaves a trail of green dye.' },
  { value: 'dye', label: 'Dye', hint: 'Click to release a steady stream of green dye from that point; click it again to stop it.' },
];
const MTOOLS = [
  { value: 'probe', label: 'Probe', hint: `Click to place a probe that records the velocity there (up to ${MAX_PROBES}); click a probe again to remove it.` },
  { value: 'line', label: 'Line', hint: 'Drag to draw a line; the velocity along it is plotted below. Drawing a new line replaces the old one.' },
];
const CS = 0.15;       // Smagorinsky constant
const VMAX = 0.12;     // fastest an obstacle may move (lattice units), keeps the lattice Mach number low

// any CSS colour → [r, g, b] in 0–1
const ctx2 = document.createElement('canvas').getContext('2d');
function rgb(css, fallback = '#888888') {
  ctx2.fillStyle = fallback; ctx2.fillStyle = css || fallback;
  const s = ctx2.fillStyle;
  if (s[0] === '#') return [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16) / 255);
  const m = s.match(/[\d.]+/g) || [128, 128, 128];
  return m.slice(0, 3).map(v => +v / 255);
}
const hexOf = a => `rgb(${a.map(v => Math.round(v * 255)).join(',')})`;
const fmtRe = v => (v >= 100 ? v.toFixed(0) : v.toFixed(1));

export const cfdModule = {
  id: 'cfd',
  title: 'Fluid Flow Sandbox',
  concepts,
  // scenes are searchable and open by link (#/cfd?s=id)
  links: SCENES.map(sc => ({ title: sc.label, sub: sc.group, href: '#/cfd?s=' + sc.id, body: sc.blurb })),
  mount(root) {
    if (/[?&]tab=vehicles/.test(location.hash)) { // the vehicle tab moved to the Airfoil Lab
      location.replace('#/airfoil?' + location.hash.split('?')[1]); return;
    }
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    const scene0 = SCENES.find(s => s.id === q.get('s')) || SCENES[0];
    const S = {
      scene: scene0, Re: +q.get('re') > 0 ? Math.min(2000, Math.max(1, +q.get('re'))) : scene0.Re,
      grid: GRIDS.find(g => g.id === q.get('grid')) || GRIDS[1], view: VIEWS.find(v => v.value === q.get('view')) ? q.get('view') : 'dye',
      turb: q.get('turb') !== '0', speed: 12, running: true, unstable: false, tool: 'move', shape: 'circle', brush: 3, selected: null,
    };
    let solver = null, geo = null, sc = null, err = null, alive = true, colors = null, pendingSetup = q.get('g'), stageVisible = true, lost = false;
    let drag = null, stroke = null, stir = null, hover = null, lineDraft = false;

    // ---------------- controls
    const controls = h('aside', { class: 'af-controls' });
    const groups = [];
    for (const s of SCENES) { let g = groups.find(x => x.group === s.group); if (!g) groups.push(g = { group: s.group, items: [] }); g.items.push({ value: s.id, label: s.label }); }
    const secScene = section('Scene');
    const sceneSel = select(groups, S.scene.id, v => { S.scene = SCENES.find(s => s.id === v); S.Re = S.scene.Re; reSl.set(S.Re); buildScene(); });
    const sceneDesc = h('div', { class: 'hint' });
    const resetBtn2 = h('button', { class: 'btn sm', type: 'button', title: 'Put the scene back as it was, removing your drawings' }, 'Reset scene');
    resetBtn2.addEventListener('click', () => buildScene());
    const linkBtn = h('button', { class: 'btn sm', type: 'button', title: 'Copy a link that opens this scene with your obstacles, probes and settings' }, 'Copy link');
    const linkOut = h('input', { class: 'num-input fs-link', readonly: true, 'aria-label': 'Link to this setup', style: { display: 'none' } });
    linkBtn.addEventListener('click', async () => {
      const url = shareUrl(); linkOut.value = url; linkOut.style.display = '';
      let ok = false; try { await navigator.clipboard.writeText(url); ok = true; } catch { }
      linkBtn.textContent = ok ? 'Copied ✓' : 'Copy the link below';
      if (!ok) { linkOut.focus(); linkOut.select(); }
      setTimeout(() => { linkBtn.textContent = 'Copy link'; }, 2000);
    });
    secScene.body.append(field('Flow situation', sceneSel), sceneDesc, h('div', { class: 'row', style: { marginTop: '8px', flexWrap: 'wrap' } }, resetBtn2, linkBtn), linkOut);

    const secFlow = section('Flow');
    const reSl = slider({ label: 'Reynolds number Re', min: 1, max: 2000, log: true, value: S.Re, format: fmtRe,
      info: 'Re = U·L/ν. Changing it changes the fluid\'s viscosity while the flow keeps running.',
      onInput: v => { S.Re = v; applyRe(); } });
    const reHint = h('div', { class: 'hint' });
    const turbT = toggle('Turbulence model', S.turb, v => { S.turb = v; if (solver) solver.cs = v ? CS : 0; refreshInfo(); writeHash(); },
      { tip: 'Smagorinsky sub-grid model: adds viscosity where the flow is strongly sheared, standing in for eddies too small for the grid. Keeps high-Re runs stable; it barely changes low-Re flow.' });
    secFlow.body.append(reSl.el, reHint, turbT.el);

    const secDraw = section('Draw');
    const toolSeg = segmented(TOOLS.map(t => ({ value: t.value, label: t.label })), S.tool, v => setTool(v));
    const shapeBtns = SHAPES.map(s => {
      const b = h('button', { class: 'btn sm fs-shape', type: 'button', title: `Click in the flow to place a ${s.label.toLowerCase()}` }, s.label);
      b.addEventListener('click', () => { S.shape = s.type; setTool('shape'); });
      return [s.type, b];
    });
    const brushSl = slider({ label: 'Brush size', min: 1, max: 20, step: 0.5, value: S.brush, format: v => v.toFixed(1) + ' cells', onInput: v => { S.brush = v; } });
    const toolHint = h('div', { class: 'hint' });
    const clearBtn = h('button', { class: 'btn sm', type: 'button', title: 'Remove everything you added: shapes, painted walls and dye sources' }, 'Clear my drawings');
    clearBtn.addEventListener('click', () => { geo.clearDrawn(); if (solver) solver.sources = []; select1(null); syncCells(); });
    secDraw.body.append(toolSeg.el, h('div', { class: 'field-label', style: { margin: '10px 0 6px' } }, 'Add a shape'), h('div', { class: 'fs-shapes' }, ...shapeBtns.map(x => x[1])),
      h('div', { style: { marginTop: '10px' } }, brushSl.el), toolHint, h('div', { style: { marginTop: '8px' } }, clearBtn));

    const secMeas = section('Measure');
    const mSeg = segmented(MTOOLS.map(t => ({ value: t.value, label: t.label })), null, v => setTool(v));
    const mClear = h('button', { class: 'btn sm', type: 'button' }, 'Remove probes and line');
    mClear.addEventListener('click', () => measure.clearProbes());
    secMeas.body.append(mSeg.el, h('div', { class: 'hint' }, 'Drag and lift on every obstacle you can move are measured all the time; see the Forces card below the flow.'), h('div', { style: { marginTop: '8px' } }, mClear));

    const secSel = section('Selected obstacle');
    const selTitle = h('div', { class: 'fs-seltitle' });
    const sizeSl = slider({ label: 'Size', min: 3, max: 200, step: 1, value: 20, format: v => v.toFixed(0) + ' cells', onInput: v => editSel({ size: v }) });
    const angSl = slider({ label: 'Angle', min: -180, max: 180, step: 1, value: 0, format: v => v.toFixed(0) + '°', onInput: v => editSel({ angle: v }) });
    const nacaIn = h('input', { class: 'num-input', style: { width: '80px' }, 'aria-label': 'NACA 4-digit code' });
    nacaIn.addEventListener('change', () => { if (validNaca(nacaIn.value)) editSel({ naca: nacaIn.value }); else nacaIn.value = S.selected?.naca || '2412'; });
    const nacaField = field('NACA section', nacaIn, 'Four digits: maximum camber (% chord), its position (tenths of chord), thickness (% chord). 0012 is symmetric and 12% thick; 2412 has 2% camber at 40% chord.');
    const delBtn = h('button', { class: 'btn sm', type: 'button' }, 'Remove');
    delBtn.addEventListener('click', () => removeSel());
    const toLab = h('button', { class: 'btn sm', type: 'button', title: 'Full viscous analysis of this section at this angle of attack, at a real-aircraft Reynolds number' }, icon('send', 14), 'Analyze in Airfoil Lab');
    toLab.addEventListener('click', () => { const o = S.selected; if (!o) return;
      sendTo({ mod: 'airfoil', tab: null, key: 'analyze', note: `NACA ${o.naca || '0012'} at ${o.angle || 0}° from the Fluid Flow Sandbox`,
        values: { geom: { kind: 'naca', code: o.naca || '0012' }, oper: { mode: 'alpha', alpha: Math.max(-10, Math.min(20, o.angle || 0)) } } }); });
    secSel.body.append(selTitle, sizeSl.el, angSl.el, nacaField, h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } }, delBtn, toLab));

    const secSim = section('Simulation');
    const runBtn = h('button', { class: 'btn sm', type: 'button' });
    const stepBtn = h('button', { class: 'btn sm', type: 'button', title: 'Advance 10 time steps' }, 'Step');
    const resetBtn = h('button', { class: 'btn sm', type: 'button', title: 'Restart the flow from rest, keeping the obstacles' }, icon('reset', 14), 'Restart');
    const paintRun = () => runBtn.replaceChildren(icon(S.running ? 'pause' : 'play', 14), S.running ? 'Pause' : 'Run');
    runBtn.addEventListener('click', () => { S.running = !S.running; paintRun(); });
    stepBtn.addEventListener('click', () => { S.running = false; paintRun(); if (solver) solver.step(10); });
    resetBtn.addEventListener('click', () => startFlow());
    const speedSl = slider({ label: 'Steps per frame', min: 1, max: 60, step: 1, value: S.speed, format: v => v.toFixed(0),
      info: 'How many time steps the solver takes between screen updates. Set automatically for your GPU on each restart; lower it to watch in slow motion.', onInput: v => { S.speed = Math.round(v); } });
    const gridSel = select(GRIDS.map(g => ({ value: g.id, label: g.label })), S.grid.id, v => { S.grid = GRIDS.find(g => g.id === v); changeGrid(); });
    const gridHint = h('div', { class: 'hint' });
    secSim.body.append(h('div', { class: 'row', style: { flexWrap: 'wrap' } }, runBtn, stepBtn, resetBtn), speedSl.el,
      field('Grid', gridSel, 'Number of cells. Finer grids show more detail and handle higher Re, but run slower and take longer (in steps) to develop. Your drawings are scaled to the new grid.'), gridHint);

    const secView = section('View');
    const viewSeg = segmented(VIEWS.map(v => ({ value: v.value, label: v.label, title: v.title })), S.view, v => { S.view = v; paintView(); });
    const dyeBox = h('div', { style: { marginTop: '8px' } });
    const streakT = toggle('Inlet streaks', true, v => { if (solver) solver.dye.streaks = v; }, { tip: 'Bands of ink released continuously at the left edge.' });
    const bodyT = toggle('Dye from surfaces', true, v => { if (solver) solver.dye.body = v; }, { tip: 'Ink released at obstacle surfaces. It marks fluid that has been through the boundary layer, so it traces the shear layers and the vortices they roll up into. Jets are always dyed.' });
    const clearDyeBtn = h('button', { class: 'btn sm', type: 'button' }, 'Clear dye');
    clearDyeBtn.addEventListener('click', () => solver && solver.clearDye());
    dyeBox.append(streakT.el, bodyT.el, clearDyeBtn);
    const imgBtn = h('button', { class: 'btn sm', type: 'button', title: 'Download a PNG picture of the flow as shown' }, icon('download', 14), 'Save image');
    imgBtn.addEventListener('click', () => saveImage());
    secView.body.append(viewSeg.el, dyeBox, h('div', { style: { marginTop: '10px' } }, imgBtn));
    controls.append(secScene.el, secFlow.el, secDraw.el, secSel.el, secMeas.el, secSim.el, secView.el);

    // ---------------- main
    const main = h('section', { class: 'cf-main' });
    const head = h('div', { class: 'af-head' }, h('div', {}, h('h2', { class: 'af-title' }, 'Fluid Flow Sandbox'),
      h('div', { class: 'af-sub' }, 'Real-time 2-D viscous flow on your GPU (lattice Boltzmann). Draw, drag and stir.')));
    const metrics = h('div', { class: 'metrics cf-metrics' });
    const canvas = h('canvas', { class: 'fs-gl' });
    const ov = h('canvas', { class: 'fs-ov' });
    const hud = h('div', { class: 'fs-hud' });
    const legend = h('div', { class: 'legend fs-legend' });
    const stage = h('div', { class: 'stage fs-stage' }, canvas, ov, hud, legend);
    const insEl = h('div');
    const insCard = h('div', { class: 'plot-card' }, h('div', { class: 'plot-head' }, h('h4', {}, 'What you\'re seeing')), insEl);
    const learn = h('div', { class: 'cf-learn' }, h('h3', {}, 'Learn the concepts'),
      h('div', { class: 'cf-concepts' }, ...concepts.map(c => h('details', { class: 'concept' }, h('summary', {}, c.title), h('div', { class: 'body', html: c.html })))));
    const measure = createMeasure({ solver: () => solver, geo: () => geo, U: U_LAT, refL: () => refL(), sym: () => S.scene.sym, scene: () => S.scene });
    main.append(head, metrics, stage, measure.hint, measure.el, insCard, learn);
    root.append(h('div', { class: 'af cf fs' }, controls, main));
    const octx = ov.getContext('2d');
    // first-visit hint, dismissed on the first click in the flow or after a while
    let hintSeen = false; try { hintSeen = localStorage.getItem('aerostudio-cfd-hint') === '1'; } catch { }
    const stageHint = h('div', { class: 'hint-overlay fs-hint' }, 'Drag the obstacle through the flow, or pick a tool on the left to draw, stir, add dye or measure.');
    const dismissHint = () => { stageHint.classList.add('gone'); try { localStorage.setItem('aerostudio-cfd-hint', '1'); } catch { } };
    if (!hintSeen) { stage.append(stageHint); setTimeout(dismissHint, 12000); } 
    // only draw while the flow is on screen (the solver keeps running so the plots below stay live)
    const io = new IntersectionObserver(es => { for (const e of es) stageVisible = e.isIntersecting; });
    io.observe(stage);
    // if the GPU resets (driver update, too many tabs), rebuild the solver and restart the flow
    const lostMsg = h('div', { class: 'hint-overlay fs-lost', style: { display: 'none' } }, 'The GPU was reset. Restarting the flow…');
    stage.append(lostMsg);
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); lost = true; lostMsg.style.display = ''; });
    canvas.addEventListener('webglcontextrestored', () => {
      try { solver = new LBMGL(canvas); lost = false; lostMsg.style.display = 'none'; startFlow(); }
      catch (e) { lostMsg.textContent = 'The GPU was reset and the sandbox could not restart: ' + e.message; }
    });

    try { solver = new LBMGL(canvas); } catch (e) { err = e.message; }
    if (err) stage.replaceChildren(h('div', { class: 'hint', style: { padding: '24px' } }, 'The sandbox needs WebGL2 with float render targets: ' + err));

    // ---------------- geometry and solver
    const refObj = () => geo && geo.objects.find(o => o.ref);
    const refL = () => { const r = refObj(); return r ? r.size : sc.L; };
    const tauNow = () => tauForRe(S.Re, U_LAT, refL());
    const forceNow = () => (sc.force ? sc.force(nuFromTau(tauNow())) : [0, 0]);
    function buildScene() {
      const { nx, ny } = gridSize(S.grid, S.scene.aspect);
      sc = S.scene.build(nx, ny);
      geo = new Geometry(nx, ny);
      for (const o of sc.objects) geo.add({ ...o });
      geo.setForced(sc.forced); geo.compose(true);
      S.selected = null; drag = stroke = stir = null;
      if (solver) solver.sources = [];
      measure.clearProbes();
      if (pendingSetup) { applySetup(pendingSetup); pendingSetup = null; }
      streakT.set(sc.dye ? sc.dye.streaks : true); bodyT.set(sc.dye ? sc.dye.body : true);
      streakT.el.style.display = sc.bc && sc.bc.x === 'flow' && (sc.inflow ?? U_LAT) > 0 ? '' : 'none';
      sceneDesc.textContent = S.scene.blurb;
      select1(S.scene.id === 'airfoil' ? refObj() : null);
      startFlow();
      if (colors) paintView();
    }
    function changeGrid() {
      const { nx, ny } = gridSize(S.grid, S.scene.aspect), f = ny / geo.ny;
      const selIdx = geo.objects.indexOf(S.selected);
      sc = S.scene.build(nx, ny);
      geo = geo.resampled(nx, ny); geo.setForced(sc.forced); geo.compose(true);
      if (solver) solver.sources = solver.sources.map(([x, y]) => [x * f, y * f]);
      measure.scale(f);
      drag = stroke = stir = null;
      select1(selIdx >= 0 ? geo.objects[selIdx] : null);
      startFlow();
    }
    function startFlow() {
      if (!solver) return;
      const { nx, ny } = geo;
      stage.style.aspectRatio = `${nx} / ${ny}`;
      stage.style.width = nx / ny < 2 ? `min(100%, ${(70 * nx / ny).toFixed(1)}vh)` : '';
      stage.style.alignSelf = nx / ny < 2 ? 'center' : '';
      solver.setup({ nx, ny, U: U_LAT, inflow: sc.inflow ?? U_LAT, tau: tauNow(), cs: S.turb ? CS : 0, bc: sc.bc, lid: sc.lid || [0, 0], force: forceNow(),
        cells: geo.cells, vel: geo.vel, init: sc.init, L: refL(), dyeInit: sc.dyeInit, sponge: sc.sponge });
      solver.dye.streaks = streakT.get(); solver.dye.body = bodyT.get();
      solver.dye.decay = sc.dye && sc.dye.decay ? sc.dye.decay : 0.99995;
      solver.wobble = 0;
      // time a few steps and pick steps-per-frame to use about 11 ms of each frame
      solver.probe(0, 0); const t0 = performance.now(); solver.step(16); solver.probe(0, 0);
      const ms = (performance.now() - t0) / 16;
      S.speed = Math.max(1, Math.min(60, Math.round(11 / Math.max(ms, 1e-3)))); speedSl.set(S.speed);
      S.unstable = false; S.running = true; paintRun();
      perf = { t: performance.now(), it: 0, rate: 0 };
      measure.reset();
      gridHint.textContent = `${nx} × ${ny} cells`;
      lastIns = '';
      refreshInfo(); writeHash();
    }
    function applyRe() {
      if (solver && sc && solver.S) { solver.tau = tauNow(); solver.force = forceNow(); solver.L = refL(); }
      refreshInfo(); writeHash();
    }
    function syncCells() {
      const r = geo.compose();
      if (r && solver && solver.S) solver.updateCells(...r);
    }
    // ---------------- sharing and pictures
    function shareUrl() {
      const g = encodeSetup({ nx: geo.nx, ny: geo.ny, objects: geo.objects.filter(o => !o.locked), paint: geo.paint,
        probes: measure.probes.map(p => [p.x, p.y]), line: measure.line, sources: solver ? solver.sources : [], turb: S.turb });
      return `${location.origin}${location.pathname}#/cfd?s=${S.scene.id}&re=${+S.Re.toPrecision(3)}&grid=${S.grid.id}&view=${S.view}&g=${g}`;
    }
    function applySetup(str) {
      const d = decodeSetup(str, geo.nx, geo.ny); if (!d) return;
      for (const o of [...geo.objects]) if (!o.locked) geo.remove(o);
      for (const o of d.objects) geo.add(o);
      if (d.paint) { geo.paint.set(d.paint); geo.mark(0, 0, geo.nx, geo.ny); }
      geo.compose(true);
      if (solver) solver.sources = d.sources.slice(0, 12);
      for (const [x, y] of d.probes) measure.toggleProbe(x, y);
      if (d.line) measure.setLine(d.line);
      S.turb = d.turb; turbT.set(d.turb);
      select1(S.scene.id === 'airfoil' ? refObj() : null);
    }
    function saveImage() {
      if (!solver || !solver.S) return;
      const v = VIEWS.find(x => x.value === S.view);
      solver.render(v.mode, v.range || 1, colors); drawOverlay();
      const W = canvas.width, H = canvas.height, c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d'); g.drawImage(canvas, 0, 0); g.drawImage(ov, 0, 0);
      const dpr = W / canvas.getBoundingClientRect().width, txt = `AeroStudio · ${S.scene.label} · Re ${fmtRe(S.Re)} · ${v.label} · t = ${(solver.iter * U_LAT / refL()).toFixed(1)} ${S.scene.sym}/U`;
      g.font = `${12 * dpr}px system-ui, sans-serif`; const tw = g.measureText(txt).width;
      g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(W - tw - 18 * dpr, H - 24 * dpr, tw + 12 * dpr, 18 * dpr);
      g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(txt, W - tw - 12 * dpr, H - 15 * dpr);
      c.toBlob(b => { if (!b) return; const a = h('a', { href: URL.createObjectURL(b), download: `aerostudio-${S.scene.id}.png` }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }, 'image/png');
    }

    function writeHash() {
      const url = `#/cfd?s=${S.scene.id}&re=${+S.Re.toPrecision(3)}&grid=${S.grid.id}&view=${S.view}${S.turb ? '' : '&turb=0'}`;
      if (location.hash !== url) history.replaceState(null, '', url);
    }

    // ---------------- selection and tools
    function select1(o) {
      S.selected = o || null;
      secSel.el.style.display = o ? '' : 'none';
      if (!o) return;
      selTitle.textContent = shapeLabel(o.type) + (o.ref ? ` (sets the Re length ${S.scene.sym})` : '');
      sizeSl.set(o.size);
      const air = o.type === 'airfoil';
      angSl.el.querySelector('.field-label').firstChild.textContent = air ? 'Angle of attack' : 'Angle';
      sizeSl.el.querySelector('.field-label').firstChild.textContent = air ? 'Chord' : o.type === 'circle' ? 'Diameter' : o.type === 'plate' ? 'Length' : 'Side';
      angSl.set(o.angle || 0);
      nacaField.style.display = air ? '' : 'none'; nacaIn.value = o.naca || '2412'; toLab.style.display = air ? '' : 'none';
    }
    function editSel(props) {
      const o = S.selected; if (!o || !geo) return;
      if (props.size) props.size = Math.max(3, Math.min(Math.min(geo.nx, geo.ny) * 0.9, props.size));
      geo.update(o, props); syncCells();
      if (o.ref) applyRe();
    }
    function removeSel() {
      const o = S.selected; if (!o || o.locked) return;
      geo.remove(o); select1(null); syncCells(); applyRe();
    }
    function setTool(t) {
      S.tool = t;
      toolSeg.set(TOOLS.some(x => x.value === t) ? t : null);
      mSeg.set(MTOOLS.some(x => x.value === t) ? t : null);
      for (const [ty, b] of shapeBtns) b.classList.toggle('on', t === 'shape' && ty === S.shape);
      brushSl.el.style.display = t === 'brush' || t === 'erase' ? '' : 'none';
      toolHint.textContent = t === 'shape' ? `Click in the flow to place a ${shapeLabel(S.shape).toLowerCase()}. Switch to Move to drag or reshape it.` : [...TOOLS, ...MTOOLS].find(x => x.value === t).hint;
      stage.dataset.tool = t;
    }
    const toCell = e => {
      const r = canvas.getBoundingClientRect();
      return [(e.clientX - r.left) / r.width * geo.nx, (1 - (e.clientY - r.top) / r.height) * geo.ny];
    };
    function defaultSize(type) {
      if (type === 'airfoil') return Math.round(geo.ny / 3);
      const r = refObj(); return Math.round(r && r.type !== 'airfoil' ? r.size : geo.ny / 9);
    }
    stage.addEventListener('pointerdown', e => {
      if (!geo || !solver || !solver.S || lost || e.button !== 0) return;
      if (!stageHint.classList.contains('gone')) dismissHint();
      const [x, y] = toCell(e);
      try { stage.setPointerCapture(e.pointerId); } catch { }
      if (S.tool === 'move') {
        const o = geo.topObjectAt(x, y);
        if (o && !o.locked) { select1(o); drag = { o, dx: o.x - x, dy: o.y - y, tx: o.x, ty: o.y }; }
        else select1(null);
      } else if (S.tool === 'brush' || S.tool === 'erase') {
        const o = S.tool === 'erase' ? geo.topObjectAt(x, y) : null;
        if (o && !o.locked) { if (S.selected === o) select1(null); geo.remove(o); applyRe(); }
        else { stroke = { x, y }; geo.paintDisc(x, y, S.brush, S.tool === 'brush' ? 1 : 0); }
        syncCells();
      } else if (S.tool === 'shape') {
        const o = { type: S.shape, x, y, size: defaultSize(S.shape), angle: S.shape === 'airfoil' ? 6 : 0 };
        if (S.shape === 'airfoil') o.naca = '2412';
        if (!refObj() && S.scene.id === 'empty') o.ref = true;
        geo.add(o); syncCells(); select1(o); applyRe();
      } else if (S.tool === 'stir') {
        stir = { x, y, lx: x, ly: y };
      } else if (S.tool === 'probe') {
        measure.toggleProbe(x, y);
      } else if (S.tool === 'line') {
        lineDraft = true; measure.setLine({ x0: x, y0: y, x1: x, y1: y });
      } else if (S.tool === 'dye') {
        const near = solver.sources.findIndex(([sx, sy]) => Math.hypot(sx - x, sy - y) < 5);
        if (near >= 0) solver.sources.splice(near, 1); else if (solver.sources.length < 12) solver.sources.push([x, y]);
      }
    });
    stage.addEventListener('pointermove', e => {
      if (!geo) return;
      const [x, y] = toCell(e); hover = [x, y];
      if (drag) { drag.tx = x + drag.dx; drag.ty = y + drag.dy; }
      if (stroke) { geo.paintLine(stroke.x, stroke.y, x, y, S.brush, S.tool === 'brush' ? 1 : 0); stroke = { x, y }; syncCells(); }
      if (stir) { stir.x = x; stir.y = y; }
      if (lineDraft && measure.line) { measure.line.x1 = x; measure.line.y1 = y; }
    });
    const endPointer = () => {
      if (drag) { geo.setVelocity(drag.o, [0, 0]); syncCells(); drag = null; }
      stroke = null; stir = null; if (solver) solver.stir = null;
      if (lineDraft) { lineDraft = false; const L = measure.line; if (L && Math.hypot(L.x1 - L.x0, L.y1 - L.y0) < 3) measure.setLine(null); else measure.refresh(); }
    };
    stage.addEventListener('pointerup', endPointer);
    stage.addEventListener('pointercancel', endPointer);
    stage.addEventListener('pointerleave', () => { hover = null; });
    const onKey = e => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && S.selected && !e.target.closest('input,select,textarea')) { e.preventDefault(); removeSel(); }
    };
    addEventListener('keydown', onKey);

    // ---------------- drawing
    function readColors() {
      const dark = (document.documentElement.dataset.resolvedTheme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
      colors = {
        bg: rgb(cssVar('--stage')), inkA: rgb(cssVar('--accent')), inkB: rgb(cssVar('--lower')), inkC: rgb(dark ? '#3ddc97' : '#14a36a'),
        neg: rgb(cssVar('--accent')), pos: rgb(dark ? '#ff6b5e' : '#d9342b'), solid: rgb(dark ? '#5a6270' : '#8a93a1'),
      };
    }
    function size() {
      const dpr = Math.min(devicePixelRatio || 1, 2), r = stage.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width * dpr)), hh = Math.max(1, Math.round(r.height * dpr));
      if (canvas.width !== w || canvas.height !== hh) { canvas.width = w; canvas.height = hh; }
      if (ov.width !== w || ov.height !== hh) { ov.width = w; ov.height = hh; }
    }
    function paintView() {
      viewSeg.set(S.view);
      dyeBox.style.display = S.view === 'dye' ? '' : 'none';
      const c = colors;
      if (S.view === 'dye') {
        const keys = [];
        if (streakT.get() && streakT.el.style.display !== 'none') keys.push([c.inkA, 'inlet streaks']);
        keys.push([c.inkB, 'from surfaces and jets'], [c.inkC, 'dye sources and stirring']);
        legend.replaceChildren(...keys.map(([col, t]) => h('div', { class: 'fs-key' }, h('i', { style: { background: hexOf(col) } }), t)));
      } else {
        const grad = S.view === 'speed' ? 'linear-gradient(90deg,#440154,#3b528b,#21918c,#5ec962,#fde725)' : `linear-gradient(90deg,${hexOf(c.neg)},${hexOf(c.bg)},${hexOf(c.pos)})`;
        const ticks = S.view === 'vort' ? ['−3', '0', '+3'] : S.view === 'speed' ? ['0', '0.8', '1.6'] : ['−1.5', '0', '+1'];
        const sym = S.scene.sym;
        const label = S.view === 'vort' ? `vorticity ω·${sym}/U` : S.view === 'speed' ? 'speed |u|/U' : 'pressure coefficient Cp';
        legend.replaceChildren(h('div', { class: 'hint', style: { margin: 0 } }, label), h('div', { class: 'fs-bar', style: { background: grad } }), h('div', { class: 'ticks' }, ...ticks.map(t => h('span', {}, t))));
      }
      writeHash();
    }
    function drawOverlay() {
      const W = ov.width, H = ov.height, nx = geo.nx, ny = geo.ny;
      const px = x => x / nx * W, py = y => (1 - y / ny) * H, sc1 = W / nx;
      octx.clearRect(0, 0, W, H);
      const acc = cssVar('--accent');
      octx.lineWidth = Math.max(1.5, devicePixelRatio || 1);
      const o = S.selected;
      if (o && geo.objects.includes(o)) {
        octx.strokeStyle = acc; octx.setLineDash([6, 4]);
        octx.beginPath();
        if (o.type === 'circle') octx.arc(px(o.x), py(o.y), o.size / 2 * sc1 + 3, 0, 2 * Math.PI);
        else outline(o).forEach(([x, y], i) => (i ? octx.lineTo(px(x), py(y)) : octx.moveTo(px(x), py(y))));
        octx.closePath(); octx.stroke(); octx.setLineDash([]);
      }
      if (solver) for (const [x, y] of solver.sources) {
        octx.fillStyle = hexOf(colors.inkC); octx.strokeStyle = cssVar('--bg-elev');
        octx.beginPath(); octx.arc(px(x), py(y), 5, 0, 2 * Math.PI); octx.fill(); octx.stroke();
      }
      if (hover && (S.tool === 'brush' || S.tool === 'erase')) {
        octx.strokeStyle = S.tool === 'brush' ? acc : cssVar('--text-3');
        octx.beginPath(); octx.arc(px(hover[0]), py(hover[1]), S.brush * sc1, 0, 2 * Math.PI); octx.stroke();
      }
      if (hover && S.tool === 'shape') {
        const g = { type: S.shape, x: hover[0], y: hover[1], size: defaultSize(S.shape), angle: S.shape === 'airfoil' ? 6 : 0, naca: '2412' };
        octx.strokeStyle = acc; octx.globalAlpha = 0.7; octx.beginPath();
        if (g.type === 'circle') octx.arc(px(g.x), py(g.y), g.size / 2 * sc1, 0, 2 * Math.PI);
        else outline(g).forEach(([x, y], i) => (i ? octx.lineTo(px(x), py(y)) : octx.moveTo(px(x), py(y))));
        octx.closePath(); octx.stroke(); octx.globalAlpha = 1;
      }
      measure.drawOverlay(octx, px, py, Math.min(devicePixelRatio || 1, 2));
      if (stir) { octx.strokeStyle = hexOf(colors.inkC); octx.beginPath(); octx.arc(px(stir.x), py(stir.y), Math.max(4, ny / 16) * sc1, 0, 2 * Math.PI); octx.stroke(); }
    }

    // ---------------- read-outs
    function measTiles() {
      const o = measure.targetObj(); if (!o) return [];
      const M = measure.bodyStats(o), name = shapeLabel(o.type).toLowerCase();
      if (!M || M.settling) return [{ k: 'Drag C_D', v: '…', s: `${name}: settling`, tip: 'Mean drag coefficient, measured once the flow has settled (t ≥ 15).' }];
      const out = [{ k: 'Drag C_D', v: M.cd.toFixed(3), s: `mean, on the ${name}`, tip: 'Mean drag coefficient over the last 40 time units: drag / (½ρU²·size).' }];
      if (M.shedding) out.push({ k: 'Strouhal St', v: M.St.toFixed(3), s: `lift ±${M.clAmp.toFixed(2)}`, tip: 'Shedding frequency f·size/U, from the oscillation of the lift.' });
      else out.push({ k: 'Lift C_L', v: M.cl.toFixed(3), s: 'steady', tip: 'Mean lift coefficient: lift / (½ρU²·size).' });
      return out;
    }

    let perf = { t: performance.now(), it: 0, rate: 0 }, lastIns = '';
    function refreshInfo() {
      if (!sc || !solver || !solver.S) return;
      const tau = solver.tau, L = refL(), sym = S.scene.sym;
      const tstar = solver.iter * U_LAT / L;
      reHint.textContent = `Based on the ${S.scene.length}: ${sym} = ${L.toFixed(0)} cells.`;
      const items = [
        { k: 'Reynolds number', v: fmtRe(S.Re), s: `Re = U·${sym}/ν` },
        { k: 'Time', v: `${tstar.toFixed(1)} ${sym}/U`, s: `${solver.iter.toLocaleString()} steps`, tip: `Convective time: how many lengths ${sym} the reference flow has travelled since the start.` },
        { k: 'Grid', v: `${solver.nx} × ${solver.ny}`, s: `${L.toFixed(0)} cells across ${sym}` },
        { k: 'Relaxation τ', v: tau.toFixed(4), s: `ν = ${nuFromTau(tau).toExponential(2)} (grid units)`, tip: 'Collision relaxation time. Viscosity ν = (τ − ½)/3; the method gets unstable as τ approaches ½.' },
        ...measTiles(),
        { k: 'Speed', v: perf.rate ? (perf.rate * solver.nx * solver.ny / 1e6).toFixed(0) + ' M' : '—', s: perf.rate ? `cell updates/s · ${perf.rate.toFixed(0)} steps/s` : 'measuring…', tip: 'How fast your GPU is running the solver.' },
      ];
      metrics.replaceChildren(...items.map(m => h('div', { class: 'metric' }, h('div', { class: 'k' }, m.k, m.tip ? info(m.tip) : null), h('div', { class: 'v' }, m.v), h('div', { class: 's' }, m.s))));
      hud.textContent = `Re ${fmtRe(S.Re)} · t = ${tstar.toFixed(1)} ${sym}/U`;
      const mo = measure.targetObj();
      const list = sceneInsights(S.scene.id, { Re: S.Re, L, tau, turb: S.turb, unstable: S.unstable, t: tstar, obj: refObj(), meas: mo ? { o: mo, S: measure.bodyStats(mo) } : null,
        hasObjects: geo.objects.length > 0 || geo.paint.some(v => v), moving: !!(drag && drag.o.v && (drag.o.v[0] || drag.o.v[1])) });
      const key = JSON.stringify(list);
      if (key !== lastIns) {
        lastIns = key;
        const icons = { i: 'i', w: '!', b: '×', g: '✓' };
        insEl.replaceChildren(...list.map(x => h('div', { class: 'insight' }, h('div', { class: 'ic ' + x.type }, icons[x.type]), h('div', {}, h('div', { class: 't' }, x.t), h('div', { class: 'd', html: x.d })))));
      }
    }

    // ---------------- main loop
    let frame = 0;
    function loop() {
      if (!alive) return;
      requestAnimationFrame(loop);
      if (!solver || !solver.S || lost) return;
      size();
      const steps = S.running ? S.speed : 0;
      if (drag) { // move the dragged obstacle; its walls move at the speed it is dragged
        const o = drag.o, dx = drag.tx - o.x, dy = drag.ty - o.y;
        if (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6) {
          let v = steps ? [dx / steps, dy / steps] : [0, 0];
          const m = Math.hypot(v[0], v[1]); if (m > VMAX) v = [v[0] * VMAX / m, v[1] * VMAX / m];
          geo.update(o, { x: drag.tx, y: drag.ty }, v);
        } else if (o.v && (o.v[0] || o.v[1])) geo.setVelocity(o, [0, 0]);
      }
      syncCells();
      if (stir) {
        let ux = steps ? (stir.x - stir.lx) / steps : 0, uy = steps ? (stir.y - stir.ly) / steps : 0;
        const m = Math.hypot(ux, uy); if (m > 0.15) { ux *= 0.15 / m; uy *= 0.15 / m; }
        solver.stir = { x: stir.x, y: stir.y, r: Math.max(4, geo.ny / 16), ux, uy };
        stir.lx = stir.x; stir.ly = stir.y;
      }
      if (sc.wobble) solver.wobble = sc.wobble.amp * U_LAT * Math.sin(2 * Math.PI * solver.iter / sc.wobble.period);
      if (steps) { solver.step(steps); perf.it += steps; }
      const v = VIEWS.find(x => x.value === S.view);
      if (stageVisible) { solver.render(v.mode, v.range || 1, colors); drawOverlay(); }
      if (steps && frame % 2 === 0) measure.sample();
      if (frame % 10 === 0) measure.refresh();
      const now = performance.now();
      if (now - perf.t > 600) { perf.rate = perf.it / ((now - perf.t) / 1000); perf.t = now; perf.it = 0; }
      if (++frame % 15 === 0) {
        if (frame % 60 === 0 && sc) { // stability check at the probe point
          const p = solver.probe(Math.min(geo.nx - 1, sc.probe[0]), Math.min(geo.ny - 1, sc.probe[1]));
          const bad = !(Math.abs(p.rho - 1) < 0.3 && Math.hypot(p.ux, p.uy) < 0.5);
          if (bad !== S.unstable) { S.unstable = bad; if (bad) { S.running = false; paintRun(); } }
        }
        refreshInfo();
      }
    }
    const onTheme = () => { readColors(); paintView(); };
    addEventListener('themechange', onTheme);
    const mq = matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener('change', onTheme);
    readColors(); paintRun(); setTool('move');
    buildScene(); paintView();
    requestAnimationFrame(loop);
    stage.__solver = () => solver; // test hooks
    stage.__geo = () => geo;
    stage.__measure = measure;
    this._cleanup = () => { alive = false; io.disconnect(); removeEventListener('themechange', onTheme); removeEventListener('keydown', onKey); mq.removeEventListener('change', onTheme); solver && solver.dispose(); };
  },
  unmount() { this._cleanup && this._cleanup(); },
};
