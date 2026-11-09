// Airfoil Lab: interactive viscous/inviscid airfoil analysis with flow visualization.
import { h, section, slider, segmented, toggle, select, field, info, icon, cssVar, fmtSI, downloadText, parseNum } from '../../lib/ui.js';
import { Plot } from '../../lib/plot.js';
import { FlowView } from './flowView.js';
import { makeInsights } from './insights.js';
import { session, toast } from '../../lib/state.js';
import { sendSection, sendTo } from '../../lib/send.js';
import { encodeSetup } from '../cfd/share.js';
import { concepts } from './learn.js';
import { presets, parseCoordinates } from './airfoilIO.js';
import { supersonicTab } from './supersonicTab.js';
import { vehicleTab } from './vehicleTab.js';
import { VEHICLES } from './vehicles.js';

class SolverClient {
  constructor(onResult) {
    this.worker = new Worker(new URL('../../solvers/mfoil/worker.js', import.meta.url), { type: 'module' });
    this.busy = false; this.pending = null; this.id = 0; this.onResult = onResult; this.sweepHandlers = {};
    this.worker.onmessage = ev => {
      const m = ev.data;
      if (m.type === 'result') {
        this.busy = false;
        this.onResult(m.res, this.lastSpec);
        if (this.pending) { const p = this.pending; this.pending = null; this.solve(p); }
      } else if (m.type === 'sweepPoint' || m.type === 'sweepDone') {
        const hnd = this.sweepHandlers[m.id]; if (hnd) hnd(m);
      }
    };
    this.worker.onerror = e => { this.busy = false; this.onResult({ ok: false, error: e.message || 'Worker error' }); };
  }
  solve(spec) {
    if (this.busy) { this.pending = spec; return; }
    this.busy = true; this.lastSpec = spec;
    this.worker.postMessage({ type: 'solve', id: ++this.id, spec });
  }
  sweep(spec, alphas, handler) {
    const id = ++this.id; this.sweepHandlers = { [id]: handler };
    this.worker.postMessage({ type: 'sweep', id, spec, alphas });
  }
  cancelSweep() { this.sweepHandlers = {}; this.worker.postMessage({ type: 'cancelSweep' }); }
  terminate() { this.worker.terminate(); }
}

const fmtForce = F => { const a = Math.abs(F); return a >= 1e4 ? (F / 1e3).toFixed(a >= 1e5 ? 0 : 1) + ' kN/m' : (F).toFixed(a >= 100 ? 0 : a >= 10 ? 1 : 2) + ' N/m'; };
const fmtLen = v => v < 1 ? (v * 100).toFixed(v < 0.1 ? 1 : 0) + ' cm' : (+v).toFixed(2) + ' m';
const RUN_COLORS = ['#3aa0d8', '#ff7a6b', '#22c55e', '#e5484d', '#a78bfa', '#14b8a6', '#eab308', '#ec4899'];

export const airfoilModule = {
  id: 'airfoil',
  title: 'Airfoil Lab',
  tabs: [{ id: 'analyze', label: 'Analyze' }, { id: 'polar', label: 'Polar sweep' }, { id: 'super', label: 'Supersonic' }, { id: 'vehicles', label: 'Vehicle aero' }], concepts,
  links: VEHICLES.map(v => ({ title: v.label, sub: 'Vehicle aero · ' + v.group, href: '#/airfoil?tab=vehicles&v=' + v.id, alias: v.id, body: v.blurb })),
  mount(root) {
    const sess = session('airfoil', { title: 'Airfoil Lab', tab: () => (S.tab === 'analyze' ? null : S.tab) });
    const S = sess.keep('analyze', {
      geom: { kind: 'naca', code: '2412', npanel: 199, flap: { xh: 0.75, eta: 0 } },
      custom: null,
      oper: { mode: 'alpha', alpha: 4, cl: 0.6, Re: 1e6, Ma: 0, viscous: true, xftl: 1, xftu: 1 },
      param: { ncrit: 9, niglob: 100 },
      chord: 1, live: true,
      res: null, tab: 'analyze', blq: 'cf', runs: [],
    }, { skip: ['res', 'runs', 'tab'], nulls: ['custom'] });
    if (S.geom.kind === 'coords' && !Array.isArray(S.geom.x)) S.geom = { ...S.geom, kind: 'naca' };
    const el = {};

    // ---------------- layout ----------------
    const controls = h('aside', { class: 'af-controls' });
    const main = h('section', { class: 'af-main' });
    const side = h('aside', { class: 'af-side' });
    root.append(h('div', { class: 'af' }, controls, h('div', { class: 'af-scroll' }, main, side)));

    // ---------------- controls: airfoil ----------------
    const secA = section('Airfoil');
    const presetSel = select([
      { group: 'NACA presets', items: presets.map(p => ({ value: p.code, label: p.label })) },
      { group: 'Other', items: [{ value: 'naca', label: 'Custom NACA digits…' }, { value: 'file', label: 'Loaded coordinates' }] },
    ], S.geom.kind === 'coords' ? 'file' : presets.some(p => p.code === S.geom.code) ? S.geom.code : 'naca', v => {
      if (v === 'naca') { nacaIn.focus(); return; }
      if (v === 'file') { if (S.custom) { S.geom = { ...S.geom, ...S.custom }; S.geom.kind = 'coords'; schedule(); } else fileIn.click(); return; }
      S.geom = { ...S.geom, kind: 'naca', code: v }; nacaIn.value = v; updateNote(); schedule();
    });
    const note = h('div', { class: 'hint' });
    const updateNote = () => {
      const p = presets.find(p => p.code === S.geom.code && S.geom.kind === 'naca');
      note.textContent = S.geom.kind === 'coords' ? `Loaded: ${S.custom?.name}` : p ? p.note : describeNaca(S.geom.code);
    };
    const nacaIn = h('input', { class: 'text-input', value: S.geom.code || '2412', maxlength: 5, placeholder: 'e.g. 2412 or 23012', 'aria-label': 'NACA digits' });
    nacaIn.addEventListener('change', () => {
      const v = nacaIn.value.trim();
      if (!/^\d{4}$|^2[1-5]0\d\d$/.test(v)) { nacaIn.style.borderColor = 'var(--bad)'; return; }
      nacaIn.style.borderColor = '';
      S.geom = { ...S.geom, kind: 'naca', code: v };
      presetSel.value = presets.some(p => p.code === v) ? v : 'naca';
      updateNote(); schedule();
    });
    const fileIn = h('input', { type: 'file', accept: '.dat,.txt,.csv', style: { display: 'none' } });
    const drop = h('div', { class: 'dropzone', tabindex: 0 }, 'Drop a .dat coordinate file or click to browse');
    const loadFile = async f => {
      try {
        const g = parseCoordinates(await f.text(), f.name);
        S.custom = g; S.geom = { ...S.geom, ...g }; presetSel.value = 'file'; updateNote(); schedule();
      } catch (e) { alert('Could not read airfoil file: ' + e.message); }
    };
    fileIn.addEventListener('change', () => fileIn.files[0] && loadFile(fileIn.files[0]));
    drop.addEventListener('click', () => fileIn.click());
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); e.dataTransfer.files[0] && loadFile(e.dataTransfer.files[0]); });
    const flapX = slider({ label: 'Flap hinge x/c', min: 0.5, max: 0.95, step: 0.01, value: S.geom.flap.xh, digits: 2,
      onInput: v => { S.geom = { ...S.geom, flap: { ...S.geom.flap, xh: v } }; if (S.geom.flap.eta) schedule(); } });
    const flapE = slider({ label: 'Flap deflection', min: -15, max: 30, step: 0.5, value: S.geom.flap.eta, format: v => (+v).toFixed(1) + '°',
      info: 'Deflecting a plain flap down (+) adds camber: more lift at the same angle, but more drag and a more nose-down moment.',
      onInput: v => { S.geom = { ...S.geom, flap: { ...S.geom.flap, eta: v } }; schedule(); } });
    const npan = slider({ label: 'Panels', min: 60, max: 360, step: 10, value: S.geom.npanel, digits: 0,
      info: 'Number of surface panels. More panels resolve the nose and tail better but solve more slowly. 160–240 is a good balance.',
      onChange: v => { S.geom = { ...S.geom, npanel: Math.round(v) }; schedule(); } });
    secA.body.append(field('Preset', presetSel), note, field('NACA digits', nacaIn, '4-digit: max camber %, camber position (tenths), thickness %. Example 2412 = 2% camber at 40% chord, 12% thick. 5-digit 2X0YY series are supported too.'),
      h('div', { class: 'field' }, drop, fileIn), flapE.el, flapX.el, npan.el);
    controls.append(secA.el);
    updateNote();

    // ---------------- controls: flow ----------------
    const secF = section('Flow conditions');
    const viscSeg = segmented([{ value: true, label: 'Viscous' }, { value: false, label: 'Inviscid' }], S.oper.viscous, v => { S.oper.viscous = v; syncVisibility(); schedule(); });
    const modeSeg = segmented([{ value: 'alpha', label: 'Set angle α' }, { value: 'cl', label: 'Set lift cl' }], S.oper.mode, v => { S.oper.mode = v; syncVisibility(); schedule(); });
    const alpha = slider({ label: 'Angle of attack α', min: -10, max: 20, step: 0.1, value: S.oper.alpha, format: v => (+v).toFixed(2) + '°',
      info: 'The angle between the chord line and the oncoming air. Lift rises roughly linearly with α until the flow separates and the airfoil stalls.',
      onInput: v => { S.oper.alpha = v; schedule(); } });
    const clT = slider({ label: 'Target lift cl', min: -0.5, max: 1.8, step: 0.01, value: S.oper.cl, digits: 3,
      info: 'The solver finds the angle of attack that produces this lift coefficient — useful for cruise design ("what α do I need for cl = 0.5?").',
      onInput: v => { S.oper.cl = v; schedule(); } });
    const re = slider({ label: 'Reynolds number', min: 2e4, max: 5e7, log: true, value: S.oper.Re, format: v => fmtSI(v),
      info: '<b>Re = ρVc/μ</b>. Small drone ≈ 50k–200k · glider ≈ 1–2M · light aircraft ≈ 3–6M · airliner wing ≈ 20–50M. Type values like 3e6 or 500k.',
      onInput: v => { S.oper.Re = v; schedule(); } });
    const ma = slider({ label: 'Mach number', min: 0, max: 0.85, step: 0.01, value: S.oper.Ma, digits: 2,
      info: 'Freestream Mach. Above ~0.3 compressibility matters; the Kármán–Tsien correction is applied. Watch for the yellow sonic line: past it, real flow forms shocks.',
      onInput: v => { S.oper.Ma = v; schedule(); } });
    // chord only sizes the force readouts (the solver works in coefficients); it never triggers a re-solve
    const chordS = slider({ label: 'Chord (for forces)', min: 0.05, max: 10, log: true, value: S.chord, format: v => fmtLen(v),
      info: 'Turns the coefficients into forces. With the chord fixed, the airspeed follows from the Reynolds number in sea-level air (V = Re·ν/c). Forces are per metre of span.',
      onInput: v => { S.chord = v; if (S.res) paintForces(S.res); } });
    secF.body.append(field('Flow model', viscSeg.el, 'Viscous couples a boundary-layer model to the panel method (drag, transition, separation). Inviscid is ideal flow: instant, but no drag.'),
      field('Solve for', modeSeg.el), alpha.el, clT.el, re.el, ma.el, chordS.el);
    controls.append(secF.el);

    // ---------------- controls: transition ----------------
    const secT = section('Transition', { collapsible: true });
    const ncrit = slider({ label: 'N-crit', min: 1, max: 14, step: 0.5, value: S.param.ncrit, digits: 1,
      info: 'Critical amplification for the eⁿ transition model. 9 ≈ average wind tunnel. Higher = quieter air, later transition. Lower = turbulent or dirty air.',
      onInput: v => { S.param.ncrit = v; schedule(); } });
    const fmtTrip = v => v >= 0.999 ? 'free' : (+v).toFixed(2);
    const tripU = slider({ label: 'Trip upper x/c', min: 0, max: 1, step: 0.01, value: S.oper.xftu, format: fmtTrip,
      info: 'Force transition at this chord position (like a zig-zag tape). 1 = free transition.', onInput: v => { S.oper.xftu = v; schedule(); } });
    const tripL = slider({ label: 'Trip lower x/c', min: 0, max: 1, step: 0.01, value: S.oper.xftl, format: fmtTrip, onInput: v => { S.oper.xftl = v; schedule(); } });
    secT.body.append(ncrit.el, tripU.el, tripL.el);
    controls.append(secT.el);

    // ---------------- controls: view layers (inside stage) ----------------
    // built below with the stage

    // ---------------- controls: solver ----------------
    const secS = section('Solver', { collapsible: true, collapsed: true });
    const nit = slider({ label: 'Max Newton iterations', min: 5, max: 200, step: 1, value: S.param.niglob, digits: 0, onChange: v => { S.param.niglob = Math.round(v); schedule(); } });
    const liveT = toggle('Update while dragging', S.live, v => { S.live = v; });
    const runBtn = h('button', { class: 'btn primary', style: { width: '100%' } }, 'Solve now');
    runBtn.addEventListener('click', () => solveNow());
    secS.body.append(nit.el, liveT.el, h('div', { class: 'field', style: { marginTop: '10px' } }, runBtn),
      h('div', { class: 'hint' }, 'Solves run in a background thread and warm-start from the previous solution, so small changes are fast.'));
    controls.append(secS.el);

    // ---------------- controls: hand the airfoil to the flow sandbox ----------------
    controls.append(sendSection([
      { label: 'Wings & 3D Aero · Stall', sub: 'Build a wing from this section and see where it stalls', go: () => {
        if (S.geom.kind !== 'naca' || !/^\d{4}$/.test(S.geom.code)) return 'The wing tools take NACA 4-digit sections; pick one (for example 2412)';
        return sendTo({ mod: 'wings', tab: 'stall', states: { wing: { root: S.geom.code, tip: S.geom.code, preset: '' }, stall: { src: 'polar' } }, note: `NACA ${S.geom.code} as the root and tip section, with Airfoil Lab polars` });
      } },
      { label: 'Fluid Flow Sandbox', sub: 'Watch this airfoil in real-time CFD (at a much lower Reynolds number)', go: () => {
        if (S.geom.kind !== 'naca' || !/^\d{4}$/.test(S.geom.code)) return 'The sandbox draws NACA 4-digit sections; pick one (for example 2412)';
        const a = S.oper.mode === 'alpha' || !isFinite(S.res?.alpha) ? S.oper.alpha : S.res.alpha;
        // same layout as the sandbox's own airfoil scene: chord ny/3, quarter chord at x = nx/4, mid-height
        const ny = 300, nx = 900, g = encodeSetup({ nx, ny, objects: [{ type: 'airfoil', x: nx * 0.25, y: ny / 2, size: ny / 3, angle: +(+a).toFixed(1), naca: S.geom.code, ref: true }], paint: null });
        toast(`NACA ${S.geom.code} at ${(+a).toFixed(1)}° in the Fluid Flow Sandbox (Re 1,000)`);
        location.hash = `#/cfd?s=airfoil&re=1000&g=${g}`;
      } },
    ]));

    const syncVisibility = () => {
      alpha.el.style.display = S.oper.mode === 'alpha' ? '' : 'none';
      clT.el.style.display = S.oper.mode === 'cl' ? '' : 'none';
      for (const c of [re.el]) c.style.opacity = S.oper.viscous ? 1 : 0.45;
      secT.el.style.opacity = S.oper.viscous ? 1 : 0.45;
    };
    syncVisibility();

    // ---------------- main: header ----------------
    el.title = h('h2', { class: 'af-title' }, 'NACA 2412');
    el.sub = h('div', { class: 'af-sub' }, '');
    el.status = h('span', { class: 'status busy' }, h('span', { class: 'dot' }), h('span', {}, 'Solving…'));
    const tabs = h('div', { class: 'tabs', role: 'tablist' });
    const tabBtns = {};
    for (const [k, label] of [['analyze', 'Analyze'], ['polar', 'Polar sweep'], ['super', 'Supersonic'], ['vehicles', 'Vehicle aero']]) {
      const b = h('button', { type: 'button', role: 'tab' }, label);
      b.addEventListener('click', () => setTab(k));
      tabs.append(b); tabBtns[k] = b;
    }
    main.append(h('div', { class: 'af-head' }, h('div', {}, el.title, el.sub), el.status, tabs, sess.toolbar()));
    sess.watch(root);

    // ---------------- main: analyze view ----------------
    const analyze = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', flex: '1 0 auto' } });
    const metrics = h('div', { class: 'metrics' });
    const metric = (k, tip) => {
      const v = h('div', { class: 'v' }, '—'), s = h('div', { class: 's' }, '');
      metrics.append(h('div', { class: 'metric' }, h('div', { class: 'k' }, k, tip ? info(tip) : null), v, s));
      return { v, s };
    };
    el.m = {
      lift: metric('Lift', 'Lift force per metre of span: L = cl · ½ρV² · c, in sea-level air with the chord set under Flow conditions.'),
      drag: metric('Drag', 'Drag force per metre of span: D = cd · ½ρV² · c, in sea-level air with the chord set under Flow conditions.'),
      cl: metric('Lift cl', 'Lift coefficient: lift per unit span divided by dynamic pressure × chord.'),
      cd: metric('Drag cd', 'Drag coefficient (total, from the wake momentum deficit). 1 drag count = 0.0001.'),
      ld: metric('L/D', 'Lift-to-drag ratio — the efficiency of the section.'),
      cm: metric('Moment cm', 'Pitching moment about the quarter chord (positive nose-up).'),
      xtr: metric('Transition x/c', 'Where the boundary layer becomes turbulent on the upper / lower surface.'),
      alpha: metric('α / time', 'Angle of attack (solved for, in target-cl mode) and solver time.'),
    };
    analyze.append(metrics);
    el.flowWrap = h('div', { style: { display: 'flex', flex: '1 0 auto', height: 'max(420px, 56vh)' } });
    analyze.append(el.flowWrap);
    const flow = new FlowView(el.flowWrap);
    flow.stage.style.flex = '1';

    // layers panel inside the stage (collapsible so it never hides the flow)
    const layersHead = h('button', { class: 'layers-head', type: 'button', 'aria-expanded': 'true' }, h('h4', {}, 'Layers'), h('span', { class: 'chev', html: '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 4.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>' }));
    const layers = h('div', { class: 'layers' }, layersHead);
    const layersBody = h('div', { class: 'layers-body' });
    layersHead.addEventListener('click', () => { const c = layers.classList.toggle('collapsed'); layersHead.setAttribute('aria-expanded', String(!c)); });
    if (flow.stage.clientWidth && flow.stage.clientWidth < 900 || innerWidth < 1300) layers.classList.add('collapsed');
    const fieldSel = segmented([{ value: 'cp', label: 'Pressure' }, { value: 'speed', label: 'Speed' }, { value: 'none', label: 'Off' }], 'cp', v => flow.setLayers({ field: v }));
    layers.append(layersBody);
    layersBody.append(h('div', { style: { marginBottom: '6px' } }, fieldSel.el));
    const lay = (k, label, on, sw, tip) => layersBody.append(toggle(label, on, v => flow.setLayers({ [k]: v }), { swatch: sw, tip }).el);
    lay('streamlines', 'Streamlines', true, null, 'Lines of constant stream function. Equal flow passes between neighbors, so lines bunch up where air speeds up.');
    lay('particles', 'Particles', true, null, 'Tracer particles moving with the local velocity.');
    lay('bl', 'Boundary layer', true, null, 'Displacement thickness δ*, exaggerated. Teal = laminar, purple = turbulent, red = separated.');
    lay('arrows', 'Pressure arrows', false, null, 'Arrows show local surface pressure: blue suction pulls outward, red pressure pushes inward.');
    lay('forces', 'Forces', true, null, 'Lift (perpendicular to the oncoming flow) and drag (×10, parallel to it), at the quarter chord.');
    lay('markers', 'Labels', true);
    const blScale = slider({ label: 'BL exaggeration', min: 1, max: 20, step: 1, value: 4, format: v => '×' + Math.round(v), onInput: v => flow.setBLScale(v) });
    blScale.el.style.marginTop = '6px';
    layersBody.append(blScale.el);
    flow.stage.append(layers);

    // plots
    const plots = h('div', { class: 'plots' });
    const cpCard = h('div', { class: 'plot-card' }, h('div', { class: 'plot-head' }, h('h4', {}, 'Surface pressure Cp'), info('Pressure coefficient along the chord. The axis is flipped (negative up), so the upper-surface suction curve sits on top. The area between the curves is the lift. Dashed = inviscid.')));
    const cpPlot = new Plot(cpCard, { xlabel: 'x / c', ylabel: 'Cp', invertY: true, xname: 'x/c', yname: 'Cp', xfmt: v => v.toFixed(3), yfmt: v => v.toFixed(3) });
    const blSel = select([
      { value: 'cf', label: 'Skin friction cf' }, { value: 'Hk', label: 'Shape factor H' }, { value: 'ds', label: 'Displacement thickness δ*' },
      { value: 'th', label: 'Momentum thickness θ' }, { value: 'ue', label: 'Edge velocity ue/V∞' }, { value: 'sa', label: 'Amplification n / √cτ' },
      { value: 'Ret', label: 'Reynolds number Reθ' }], 'cf', v => { S.blq = v; drawPlots(); });
    const blCard = h('div', { class: 'plot-card' }, h('div', { class: 'plot-head' }, h('h4', {}, 'Boundary layer'), blSel));
    const blPlot = new Plot(blCard, { xlabel: 'x / c', ylabel: 'cf', xname: 'x/c', xfmt: v => v.toFixed(3) });
    plots.append(cpCard, blCard);
    analyze.append(plots);
    main.append(analyze);

    // ---------------- main: polar view ----------------
    const polar = h('div', { style: { display: 'none', flexDirection: 'column', gap: '12px' } });
    main.append(polar);
    buildPolar();

    // ---------------- side: insights + learn ----------------
    const insSec = h('div', { class: 'side-section' }, h('h3', {}, 'What you\'re seeing'));
    el.ins = h('div');
    insSec.append(el.ins);
    const convSec = h('div', { class: 'side-section' }, h('h3', {}, 'Solver convergence'));
    const convPlot = new Plot(convSec, { xlabel: 'Newton iteration', ylabel: 'log₁₀ residual', legend: false, xname: 'iter', yname: 'log₁₀ R', xfmt: v => v.toFixed(0), yfmt: v => v.toFixed(2), pad: [6, 8, 30, 40] });
    convPlot.wrap.style.height = '150px';
    el.convNote = h('div', { class: 'hint' });
    convSec.append(el.convNote);
    const learnSec = h('div', { class: 'side-section' }, h('h3', {}, 'Learn the concepts'));
    for (const c of concepts) learnSec.append(h('details', { class: 'concept' }, h('summary', {}, c.title), h('div', { class: 'body', html: c.html })));
    side.append(insSec, convSec, learnSec);

    // sea-level ISA air: ρ = 1.225 kg/m³, ν = 1.461e-5 m²/s
    function paintForces(res) {
      const V = res.Re * 1.4607e-5 / S.chord, q = 0.5 * 1.225 * V * V, c = res.coef;
      const L = c.cl * q * S.chord, D = res.viscous ? c.cd * q * S.chord : 0;
      el.m.lift.v.textContent = fmtForce(L);
      el.m.lift.s.textContent = `per m span · V = ${V < 10 ? V.toFixed(1) : V.toFixed(0)} m/s`;
      el.m.drag.v.textContent = res.viscous ? fmtForce(D) : '0 (ideal)';
      el.m.drag.s.textContent = `per m span · c = ${fmtLen(S.chord)}`;
    }

    // ---------------- solver wiring ----------------
    const client = new SolverClient((res, spec) => onResult(res, spec));
    let schedTimer = null;
    function spec() {
      return { geom: S.geom.kind === 'coords' ? { ...S.geom, ...S.custom, npanel: S.geom.npanel, flap: S.geom.flap } : { kind: 'naca', code: S.geom.code, npanel: S.geom.npanel, flap: S.geom.flap },
        oper: { ...S.oper }, param: { ...S.param } };
    }
    function schedule() {
      if (!S.live) return;
      clearTimeout(schedTimer);
      schedTimer = setTimeout(solveNow, S.oper.viscous ? 30 : 10);
    }
    function solveNow() {
      setStatus('busy', 'Solving…');
      client.solve(spec());
    }
    function setStatus(kind, text) {
      el.status.className = 'status ' + kind;
      el.status.lastChild.textContent = text;
    }
    let pendingRes = null;
    function onResult(res) {
      if (S.tab === 'super' || S.tab === 'vehicles') { pendingRes = res; return; } // shown when the user comes back
      S.res = res;
      if (!res || !res.ok) {
        setStatus('bad', res && res.error ? 'Error' : 'No solution');
        flow.setResult(res);
        el.ins.replaceChildren(...makeInsights(res).map(insightEl));
        return;
      }
      const conv = !res.viscous || res.conv;
      setStatus(conv ? 'ok' : 'bad', res.viscous ? (conv ? `Converged · ${res.iters} iterations${res.warm ? ' (warm start)' : ''}` : 'Not converged') : 'Inviscid · exact');
      el.title.textContent = res.name;
      el.sub.textContent = `${res.viscous ? 'Viscous' : 'Inviscid'} · α = ${res.alpha.toFixed(2)}° · Re = ${fmtSI(res.Re)} · M = ${res.Ma.toFixed(2)} · ${res.N - 1} panels`;
      const c = res.coef;
      el.m.cl.v.textContent = c.cl.toFixed(4);
      el.m.cl.s.textContent = `cl/α ≈ ${(Math.abs(res.alpha) > 0.5 ? c.cl / res.alpha : NaN).toFixed(3)} per °`.replace('NaN', '—');
      el.m.cd.v.textContent = res.viscous ? c.cd.toFixed(5) : '0 (ideal)';
      el.m.cd.s.textContent = res.viscous ? `friction ${c.cdf.toFixed(5)} · pressure ${c.cdp.toFixed(5)}` : 'no viscosity → no drag';
      el.m.ld.v.textContent = res.viscous && c.cd > 0 ? (c.cl / c.cd).toFixed(1) : '∞';
      el.m.ld.s.textContent = res.viscous ? `${(c.cd * 1e4).toFixed(1)} drag counts` : '';
      paintForces(res);
      el.m.cm.v.textContent = c.cm.toFixed(4);
      el.m.cm.s.textContent = c.cm < 0 ? 'nose-down' : 'nose-up';
      const xtrTxt = t => t.x === null ? 'TE' : t.x.toFixed(2);
      el.m.xtr.v.textContent = res.viscous ? `${xtrTxt(res.transition[1])} / ${xtrTxt(res.transition[0])}` : '—';
      el.m.xtr.s.textContent = res.viscous ? 'upper / lower' : 'inviscid';
      el.m.alpha.v.textContent = res.alpha.toFixed(2) + '°';
      el.m.alpha.s.textContent = `${res.timeMs.toFixed(0)} ms`;
      if (S.oper.mode === 'cl') { alpha.set(res.alpha); }
      flow.setResult(res);
      drawPlots();
      el.ins.replaceChildren(...makeInsights(res).map(insightEl));
      // convergence
      if (res.viscous && res.history.length) {
        const it = res.history.map((_, i) => i + 1), y = res.history.map(v => Math.log10(Math.max(v, 1e-16)));
        convPlot.setData({ series: [{ x: it, y, color: cssVar('--accent'), points: true, label: 'residual' }], hlines: [{ y: Math.log10(1e-10), color: cssVar('--good'), label: 'tolerance' }] });
        el.convNote.textContent = 'Each Newton step solves for the boundary layer and outer flow together. Near the answer the error squares each step (quadratic convergence) — that is the steep drop at the end.';
      } else {
        convPlot.setData({ series: [] });
        el.convNote.textContent = 'Inviscid mode solves one linear system — no iterations needed.';
      }
    }
    function insightEl(i) {
      const ic = { i: 'i', w: '!', b: '!', g: '✓' }[i.k];
      return h('div', { class: 'insight' }, h('div', { class: 'ic ' + i.k }, ic), h('div', {}, h('div', { class: 't' }, i.t), h('div', { class: 'd' }, i.d)));
    }

    function drawPlots() {
      const r = S.res; if (!r || !r.ok) return;
      const cu = cssVar('--upper'), clo = cssVar('--lower'), cw = cssVar('--wake');
      const pick = (Is, arr) => ({ x: Array.from(Is, i => i < r.N ? r.foil.x[i] : r.wake.x[i - r.N]), y: Array.from(Is, i => arr[i]) });
      const series = [];
      const up = pick(r.Is[1], r.cp), lo = pick(r.Is[0], r.cp);
      series.push({ ...up, color: cu, label: 'upper' }, { ...lo, color: clo, label: 'lower' });
      if (r.viscous) {
        series.push({ ...pick(r.Is[1], r.cpi), color: cu, dash: [4, 4], width: 1.2, alpha: 0.7, label: 'inviscid', noHover: true });
        series.push({ ...pick(r.Is[0], r.cpi), color: clo, dash: [4, 4], width: 1.2, alpha: 0.7, noHover: true });
      }
      const hl = [];
      if (r.Ma > 0 && r.cps > -10) hl.push({ y: r.cps, color: '#e3b505', label: 'sonic Cp*', bound: false });
      cpPlot.setData({ series, hlines: hl });
      // boundary layer quantity
      if (!r.viscous) { blPlot.setOpts({ ylabel: '' }); blPlot.setData({ series: [], hlines: [] }); blCard.style.opacity = 0.5; return; }
      blCard.style.opacity = 1;
      const q = S.blq, d = r.dist;
      const arr = q === 'ue' ? d.ue.map(v => v / r.Vinf) : d[q];
      const labels = { cf: 'cf', Hk: 'H (kinematic)', ds: 'δ* / c', th: 'θ / c', ue: 'ue / V∞', sa: 'n  |  √cτ', Ret: 'Reθ' };
      blPlot.setOpts({ ylabel: labels[q], yname: q, yfmt: v => Math.abs(v) < 0.01 ? v.toExponential(3) : v.toPrecision(4) });
      const bs = [{ ...pick(r.Is[1], arr), color: cu, label: 'upper' }, { ...pick(r.Is[0], arr), color: clo, label: 'lower' }];
      if (q !== 'cf') bs.push({ ...pick(r.Is[2], arr), color: cw, label: 'wake' });
      const bands = [];
      for (let is = 0; is < 2; is++) {
        const Is = r.Is[is]; let k = 0;
        while (k < Is.length) {
          if (d.cf[Is[k]] < 0) { const k0 = k; while (k < Is.length && d.cf[Is[k]] < 0) k++; bands.push({ x0: r.foil.x[Is[k0]], x1: r.foil.x[Is[Math.min(k, Is.length - 1)]], color: 'rgba(229,72,77,0.12)' }); }
          else k++;
        }
      }
      const vl = r.transition.filter(t => t.x !== null).map(t => ({ x: t.x, color: t === r.transition[1] ? cu : clo }));
      blPlot.setData({ series: bs, vbands: bands, vlines: vl, hlines: q === 'cf' ? [{ y: 0, color: cssVar('--sep'), label: 'separation (cf < 0)', bound: false }] : [] });
    }

    // ---------------- polar sweep ----------------
    function buildPolar() {
      const a0 = h('input', { class: 'num-input', value: '-4' }), a1 = h('input', { class: 'num-input', value: '14' }), da = h('input', { class: 'num-input', value: '0.5' });
      const run = h('button', { class: 'btn primary' }, 'Run sweep');
      const cancel = h('button', { class: 'btn', disabled: true }, 'Stop');
      const csv = h('button', { class: 'btn' }, icon('download', 14), 'CSV');
      const prog = h('div', { class: 'progress', style: { width: '160px' } }, h('div'));
      const progText = h('span', { class: 'hint', style: { margin: 0 } }, '');
      const runsEl = h('div', { class: 'runs' });
      const bar = h('div', { class: 'panel', style: { padding: '12px 14px' } },
        h('div', { class: 'polar-bar' },
          h('div', { class: 'field' }, h('div', { class: 'field-label', style: { marginBottom: '4px' } }, 'α from'), a0),
          h('div', { class: 'field' }, h('div', { class: 'field-label', style: { marginBottom: '4px' } }, 'to'), a1),
          h('div', { class: 'field' }, h('div', { class: 'field-label', style: { marginBottom: '4px' } }, 'step'), da),
          run, cancel, csv, h('div', { class: 'row' }, prog, progText)),
        h('div', { class: 'hint', style: { marginTop: '8px' } }, 'Uses the airfoil, Reynolds number, Mach, and transition settings on the left. Each sweep is kept so you can compare airfoils or conditions; click × to remove one.'),
        h('div', { style: { marginTop: '8px' } }, runsEl));
      const grid = h('div', { class: 'polar-grid' });
      const mk = (title, xl, yl, tip) => {
        const card = h('div', { class: 'plot-card' }, h('div', { class: 'plot-head' }, h('h4', {}, title), tip ? info(tip) : null));
        grid.append(card);
        return new Plot(card, { xlabel: xl, ylabel: yl, xname: xl, yname: yl, xfmt: v => v.toFixed(4), yfmt: v => v.toFixed(4), xPad: true });
      };
      const pClA = mk('Lift curve  cl vs α', 'α (deg)', 'cl', 'Linear at first (slope ≈ 0.11 per degree), then it bends over and drops at stall.');
      const pPol = mk('Drag polar  cl vs cd', 'cd', 'cl', 'The classic drag polar. The tangent from the origin touches it at the best L/D.');
      const pCm = mk('Moment  cm vs α', 'α (deg)', 'cm');
      const pLD = mk('Efficiency  L/D vs α', 'α (deg)', 'L/D');
      const tableWrap = h('div', { class: 'panel', style: { maxHeight: '300px', overflow: 'auto' } });
      polar.append(bar, grid, tableWrap);

      let current = null;
      const redraw = () => {
        const sets = { clA: [], pol: [], cm: [], ld: [] };
        for (const run of S.runs) {
          const P = run.pts.filter(p => p.ok).sort((a, b) => a.alpha - b.alpha);
          const A = P.map(p => p.alpha), lab = run.label;
          sets.clA.push({ x: A, y: P.map(p => p.cl), color: run.color, label: lab, points: true });
          sets.pol.push({ x: P.map(p => p.cd), y: P.map(p => p.cl), color: run.color, label: lab, points: true });
          sets.cm.push({ x: A, y: P.map(p => p.cm), color: run.color, label: lab, points: true });
          sets.ld.push({ x: A, y: P.map(p => p.cd > 0 ? p.cl / p.cd : NaN), color: run.color, label: lab, points: true });
        }
        pClA.setData({ series: sets.clA }); pPol.setData({ series: sets.pol }); pCm.setData({ series: sets.cm }); pLD.setData({ series: sets.ld });
        runsEl.replaceChildren(...S.runs.map(r => {
          const x = h('button', { title: 'Remove' }, '×');
          x.addEventListener('click', () => { S.runs = S.runs.filter(q => q !== r); redraw(); });
          return h('span', { class: 'run-chip' }, h('span', { class: 'swatch', style: { background: r.color } }), r.label, x);
        }));
        const r = current || S.runs[S.runs.length - 1];
        if (r) {
          const P = r.pts.slice().sort((a, b) => a.alpha - b.alpha);
          const best = P.filter(p => p.ok && p.cd > 0).reduce((b, p) => (!b || p.cl / p.cd > b.cl / b.cd ? p : b), null);
          const clmax = P.filter(p => p.ok).reduce((b, p) => (!b || p.cl > b.cl ? p : b), null);
          tableWrap.replaceChildren(h('div', { style: { padding: '10px 12px 4px', display: 'flex', gap: '18px', flexWrap: 'wrap' } },
            h('b', {}, r.label),
            best ? h('span', {}, `Best L/D ${(best.cl / best.cd).toFixed(1)} at α = ${best.alpha}°`) : null,
            clmax ? h('span', {}, `cl max ${clmax.cl.toFixed(3)} at α = ${clmax.alpha}°`) : null),
            h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ...['α', 'cl', 'cd', 'cm', 'L/D', 'cdf', 'cdp', 'xtr up', 'xtr lo', 'status'].map(t => h('th', {}, t)))),
              h('tbody', {}, ...P.map(p => h('tr', {},
                h('td', {}, p.alpha.toFixed(2)), h('td', {}, fx(p.cl, 4)), h('td', {}, fx(p.cd, 5)), h('td', {}, fx(p.cm, 4)),
                h('td', {}, p.cd > 0 ? (p.cl / p.cd).toFixed(1) : '—'), h('td', {}, fx(p.cdf, 5)), h('td', {}, fx(p.cdp, 5)),
                h('td', {}, fx(p.xtrU, 3)), h('td', {}, fx(p.xtrL, 3)), h('td', { class: p.ok ? '' : 'bad' }, p.ok ? 'ok' : 'not converged'))))));
        }
      };
      const fx = (v, d) => v === null || v === undefined || !isFinite(v) ? '—' : v.toFixed(d);
      run.addEventListener('click', () => {
        const A0 = parseNum(a0.value), A1 = parseNum(a1.value), dA = Math.abs(parseNum(da.value));
        if (!(dA > 0) || !isFinite(A0) || !isFinite(A1)) return;
        const alphas = []; for (let a = Math.min(A0, A1); a <= Math.max(A0, A1) + 1e-9; a += dA) alphas.push(Math.round(a * 1000) / 1000);
        if (alphas.length > 400) { alert('That is a lot of points — use a bigger step.'); return; }
        const sp = spec();
        const label = `${S.res?.name || sp.geom.code} · Re ${fmtSI(sp.oper.Re)}${sp.oper.Ma ? ' · M ' + sp.oper.Ma : ''}${sp.oper.viscous ? '' : ' · inviscid'}`;
        current = { label, color: RUN_COLORS[S.runs.length % RUN_COLORS.length], pts: [] };
        S.runs.push(current);
        run.disabled = true; cancel.disabled = false;
        client.sweep(sp, alphas, m => {
          if (m.type === 'sweepPoint') {
            current.pts.push(m.pt);
            prog.firstChild.style.width = (100 * m.done / m.total).toFixed(0) + '%';
            progText.textContent = `${m.done} / ${m.total}`;
            redraw();
          } else { run.disabled = false; cancel.disabled = true; progText.textContent = `Done · ${current.pts.filter(p => p.ok).length} of ${current.pts.length} converged`; current = null; redraw(); }
        });
        redraw();
      });
      cancel.addEventListener('click', () => { client.cancelSweep(); run.disabled = false; cancel.disabled = true; progText.textContent = 'Stopped'; current = null; redraw(); });
      csv.addEventListener('click', () => {
        if (!S.runs.length) return;
        let out = 'run,alpha,cl,cd,cm,cdf,cdp,xtr_upper,xtr_lower,converged\n';
        for (const r of S.runs) for (const p of r.pts.slice().sort((a, b) => a.alpha - b.alpha))
          out += [JSON.stringify(r.label), p.alpha, p.cl, p.cd, p.cm, p.cdf, p.cdp, p.xtrU, p.xtrL, p.ok].join(',') + '\n';
        downloadText('polars.csv', out);
      });
      redraw();
    }

    // supersonic and vehicle tabs: their own controls, view and side panel, swapped in when the tab is open
    const ALT = {
      super: () => supersonicTab({
        getAnalyzeGeom: () => spec().geom, keep: (o, opt) => sess.keep('super', o, opt),
        setHeader: (title, sub, kind, text) => { if (S.tab !== 'super') return; el.title.textContent = title; el.sub.textContent = sub; setStatus(kind, text); },
      }),
      vehicles: () => vehicleTab({
        keep: (o, opt) => sess.keep('vehicles', o, opt),
        setHeader: (title, sub, kind, text) => { if (S.tab !== 'vehicles') return; el.title.textContent = title; el.sub.textContent = sub; setStatus(kind, text); },
      }),
    };
    const alt = {}; let curAlt = null, saved = null;
    function setTab(k) {
      S.tab = k;
      for (const [kk, b] of Object.entries(tabBtns)) { b.classList.toggle('on', kk === k); b.setAttribute('aria-selected', kk === k); }
      analyze.style.display = k === 'analyze' ? 'flex' : 'none';
      polar.style.display = k === 'polar' ? 'flex' : 'none';
      if (curAlt && curAlt !== k) { // leave the open supersonic/vehicle tab and restore the analysis panels
        alt[curAlt].hide();
        controls.replaceChildren(...saved.controls); side.replaceChildren(...saved.side);
        el.title.textContent = saved.title; el.sub.textContent = saved.sub; el.status.className = saved.status; el.status.lastChild.textContent = saved.statusText;
        curAlt = null;
      }
      if (ALT[k] && curAlt !== k) {
        if (!alt[k]) { alt[k] = ALT[k](); main.append(alt[k].main); }
        saved = { controls: [...controls.childNodes], side: [...side.childNodes], title: el.title.textContent, sub: el.sub.textContent, status: el.status.className, statusText: el.status.lastChild.textContent };
        controls.replaceChildren(alt[k].controls); side.replaceChildren(alt[k].side);
        curAlt = k; alt[k].show();
      }
      if (!ALT[k] && pendingRes) { const r = pendingRes; pendingRes = null; onResult(r); }
      if (k !== 'vehicles') { const url = k === 'analyze' ? '#/airfoil' : `#/airfoil?tab=${k}`; if (location.hash !== url) history.replaceState(null, '', url); }
      if (k === 'analyze') { flow.resize(); drawPlots(); }
    }
    const tab0 = new URLSearchParams(location.hash.split('?')[1] || '').get('tab');
    setTab(tabBtns[tab0] ? tab0 : 'analyze');
    solveNow();

    this._cleanup = () => { sess.dispose(); client.terminate(); flow.running = false; for (const t of Object.values(alt)) t.destroy(); };
  },
  unmount() { this._cleanup && this._cleanup(); },
};

function describeNaca(code) {
  if (/^\d{4}$/.test(code)) {
    const m = +code[0], p = +code[1] * 10, t = +code.slice(2);
    return m === 0 ? `Symmetric, ${t}% thick` : `${m}% camber at ${p}% chord, ${t}% thick`;
  }
  if (/^\d{5}$/.test(code)) return `Five-digit series, ${+code.slice(3)}% thick`;
  return '';
}
