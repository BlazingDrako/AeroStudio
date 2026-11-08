// 2-D FEA tab: plates with holes, notches and fillets (or your own outline), meshed automatically
// with quadratic triangles; stress contours, deformed shape, a probe line through the hot spot,
// comparison with hand formulas (Kt charts, beam theory), reactions and a mesh convergence study.
import { h, section, info } from '../../lib/ui.js';
import { Plot } from '../../lib/plot.js';
import { solvePlate, makeSampler, curvePoint, curveLength } from '../../solvers/fem2d.js';
import { MATERIALS } from '../../solvers/sections.js';
import { FEA_MODELS, customModel, defaultCustom } from './feaModels.js';
import { numField, selField, segField, checkField, card, metricsGrid, insightsList, units, fmtNum, table } from './common.js';

const LEVELS = [{ label: 'Coarse', f: 5, circ: 24 }, { label: 'Medium', f: 8, circ: 40 }, { label: 'Fine', f: 12, circ: 64 }, { label: 'Very fine', f: 20, circ: 96 }, { label: 'Extra fine', f: 32, circ: 128 }];
const FIELDS = [
  { value: 'vm', label: 'Von Mises stress', q: 'stress' }, { value: 's1', label: 'Max principal σ₁', q: 'stress' }, { value: 's2', label: 'Min principal σ₂', q: 'stress' },
  { value: 'sx', label: 'σx', q: 'stress' }, { value: 'sy', label: 'σy', q: 'stress' }, { value: 'txy', label: 'τxy', q: 'stress' },
  { value: 'um', label: 'Displacement |u|', q: 'disp' }, { value: 'ux', label: 'Displacement uₓ', q: 'disp' }, { value: 'uy', label: 'Displacement u_y', q: 'disp' },
];
const BC_TYPES = [
  { value: 'free', label: 'Free' }, { value: 'fixed', label: 'Fixed (clamped)' }, { value: 'roller', label: 'Roller (no normal motion)' },
  { value: 'rollerX', label: 'Symmetry: uₓ = 0' }, { value: 'rollerY', label: 'Symmetry: u_y = 0' },
  { value: 'force', label: 'Force (total, spread evenly)' }, { value: 'pressure', label: 'Pressure' }, { value: 'shear', label: 'Shear traction' }, { value: 'bearing', label: 'Pin bearing load (holes)' },
];
const KEY = 'aerostudio-fea-v1';

export function feaTab({ keep = o => o } = {}) {
  const st = keep({
    model: 'hole', params: {}, mat: 'al2024', t: 0.01, plane: 'stress', level: 2, field: 'vm', showMesh: true, bands: true, deformed: false, defScale: 1,
    bc: {}, probe: {}, custom: defaultCustom(), tool: 'select', sel: null,
  }, { skip: ['tool', 'sel'] });
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s) Object.assign(st, s, { tool: 'select', sel: null }); } catch { }
  for (const m of FEA_MODELS) st.params[m.id] = { ...Object.fromEntries(m.params.map(([k, , , v]) => [k, v])), ...(st.params[m.id] || {}) };
  const save = () => { try { const { tool, sel, ...rest } = st; localStorage.setItem(KEY, JSON.stringify(rest)); } catch { } };

  let built = null, res = null, sampler = null, err = null, conv = null, solving = false;
  const modelDef = () => FEA_MODELS.find(m => m.id === st.model);
  const material = () => MATERIALS.find(m => m.id === st.mat) || MATERIALS[0];

  function build() {
    err = null;
    try {
      if (st.model === 'custom') {
        if (st.custom.outline.length < 3) { built = null; err = 'Draw an outline with the Outline tool (at least three points).'; return; }
        const bad = st.custom.holes.findIndex(hh => !holeFits(st.custom.outline, hh));
        if (bad >= 0) { built = null; err = `Hole ${bad + 1} crosses or lies outside the outline — move it, shrink it or remove it.`; return; }
        built = customModel(st.custom, st.t);
      } else {
        const m = modelDef(), p = st.params[m.id];
        if (m.check && !m.check(p)) { built = null; err = 'These dimensions do not make a valid shape (a hole or notch is too big for the part).'; return; }
        built = m.build(p, st.t);
      }
      built.bcs = { ...built.bcs, ...(st.bc[st.model] || {}) };
      if (st.probe[st.model]) built.probe = { ...(built.probe || {}), ...st.probe[st.model], label: 'your probe line' };
    } catch (e) { built = null; err = 'Geometry error: ' + e.message; }
  }
  const curves = () => built ? built.geom.loops.flatMap(l => l.curves) : [];
  const size = () => { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const c of curves()) for (let k = 0; k <= 12; k++) { const p = curvePoint(c, k / 12); x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); } return { x0, x1, y0, y1, s: Math.max(x1 - x0, y1 - y0) }; };

  function meshOpts(level = st.level) {
    const L = LEVELS[level], b = size(), smin = Math.min(b.x1 - b.x0, b.y1 - b.y0);
    // also resolve the thin direction of slender parts (a few elements through the depth)
    return { hmax: Math.min(b.s / L.f, smin / Math.max(3, L.f / 2.5)), circ: L.circ };
  }
  function solve() {
    build(); res = null; sampler = null;
    if (!built) { render(); return; }
    const mat = material();
    const loaded = Object.values(built.bcs).some(b => ['force', 'pressure', 'shear', 'bearing'].includes(b.type) && (b.fx || b.fy || b.p || b.q || b.F));
    if (!loaded) { err = 'No load yet: click an edge and give it a force, pressure, shear or pin load.'; render(); return; }
    try {
      res = solvePlate({ geom: built.geom, E: mat.E, nu: mat.nu, thickness: st.t, plane: st.plane, bcs: built.bcs, mesh: meshOpts() });
      if (!res.ok) { err = 'The stiffness matrix is singular — add supports.'; res = null; }
      else sampler = makeSampler(res);
    } catch (e) { console.error(e); err = 'Meshing failed for this shape: ' + e.message; res = null; }
    render();
  }
  let timer = 0;
  function schedule() { save(); clearTimeout(timer); solving = true; showBusy(); timer = setTimeout(() => { solving = false; solve(); }, 90); }

  // ---------------------------------------------------------------- controls
  const controls = h('div', { class: 'st-controls' });
  const sModel = section('Part'), sMat = section('Material & thickness'), sBC = section('Boundary conditions'), sMesh = section('Mesh'), sView = section('Display');
  controls.append(sModel.el, sMat.el, sBC.el, sMesh.el, sView.el);
  const btn = (label, fn, cls = 'btn sm') => { const b = h('button', { type: 'button', class: cls }, label); b.addEventListener('click', fn); return b; };

  function renderControls() {
    const b = sModel.body; b.replaceChildren();
    b.append(selField('Geometry', [...FEA_MODELS.map(m => ({ value: m.id, label: m.label })), { value: 'custom', label: 'Custom outline (draw your own)' }], st.model, v => { st.model = v; st.sel = null; st.tool = 'select'; conv = null; renderControls(); fitView(); schedule(); }));
    if (st.model !== 'custom') {
      const m = modelDef(), p = st.params[m.id];
      b.append(h('div', { class: 'st-grid2' }, ...m.params.map(([k, lab, q]) => numField(lab, q, () => p[k], v => { if (q === 'dim' && !(v > 0)) return; p[k] = v; conv = null; schedule(); }, { suffix: q ? undefined : '°' }))));
    } else {
      b.append(h('div', { class: 'hint' }, 'Use the canvas tools: Outline (click corners, click the first point to close), Hole (press and drag), Probe (drag a line). Click an edge to set its boundary condition.'));
      const holes = st.custom.holes;
      holes.forEach((ho, k) => b.append(h('div', { class: 'st-matbox' }, h('div', { class: 'st-selhead' }, h('b', {}, `Hole ${k + 1}`), btn('Remove', () => { holes.splice(k, 1); renderControls(); schedule(); })),
        h('div', { class: 'st-grid2' }, numField('Centre x', 'dim', () => ho.x, v => { ho.x = v; schedule(); }), numField('Centre y', 'dim', () => ho.y, v => { ho.y = v; schedule(); }), numField('Radius', 'dim', () => ho.r, v => { if (v > 0) { ho.r = v; schedule(); } })))));
      b.append(h('div', { class: 'st-row' }, btn('Reset to example', () => { st.custom = defaultCustom(); st.bc.custom = {}; renderControls(); fitView(); schedule(); })));
    }
    sMat.body.replaceChildren(
      selField('Material', MATERIALS.map(m => ({ value: m.id, label: m.name })), st.mat, v => { st.mat = v; schedule(); }),
      numField('Thickness', 'dim', () => st.t, v => { if (v > 0) { st.t = v; schedule(); } }, { tip: 'Out-of-plane thickness. Forces are totals through the thickness; stresses do not depend on it in plane stress.' }),
      segField('Idealisation', [{ value: 'stress', label: 'Plane stress', title: 'Thin plates loaded in their plane: σz = 0.' }, { value: 'strain', label: 'Plane strain', title: 'Long or thick bodies restrained along z: εz = 0.' }], st.plane, v => { st.plane = v; schedule(); }));
    renderBCs();
    sMesh.body.replaceChildren(
      segField('Mesh density', LEVELS.map((L, k) => ({ value: k, label: L.label.replace('Extra fine', 'Extra') })), st.level, v => { st.level = v; schedule(); }),
      h('div', { class: 'hint' }, 'The mesh is graded automatically: small elements around holes, notches, fillets and re-entrant corners, larger ones elsewhere. Elements are 6-node quadratic triangles.'),
      checkField('Show mesh', st.showMesh, v => { st.showMesh = v; draw(); }),
      h('div', { class: 'st-row' }, btn('Run convergence study', runConvergence)));
    sView.body.replaceChildren(
      selField('Contour', FIELDS, st.field, v => { st.field = v; render(); }),
      checkField('Contour bands', st.bands, v => { st.bands = v; draw(); }, 'Banded colours make iso-stress lines easy to read; off gives a smooth gradient.'),
      checkField('Deformed shape', st.deformed, v => { st.deformed = v; draw(); }),
      st.deformed ? rangeField('Exaggeration', st.defScale, 0.1, 10, v => { st.defScale = v; draw(); }) : null);
  }
  function rangeField(label, val, min, max, on) {
    const r = h('input', { type: 'range', min: Math.log10(min), max: Math.log10(max), step: 0.01, value: Math.log10(val) });
    const p = () => r.style.setProperty('--fill', ((r.value - r.min) / (r.max - r.min) * 100) + '%'); p();
    r.addEventListener('input', () => { p(); on(10 ** +r.value); });
    return h('label', { class: 'st-range', style: { marginTop: '6px' } }, h('span', {}, label), r);
  }
  function renderBCs() {
    const b = sBC.body; b.replaceChildren();
    if (!built) { b.append(h('div', { class: 'hint' }, 'No geometry yet.')); return; }
    const over = st.bc[st.model] || (st.bc[st.model] = {});
    const seen = new Map();
    for (const c of curves()) {
      const bc = built.bcs[c.id] || { type: 'free' };
      let label = c.label || c.id; const n = (seen.get(label) || 0) + 1; seen.set(label, n); if (n > 1) label += ` (${n})`;
      const set = nb => { over[c.id] = nb; renderBCs(); schedule(); };
      const types = BC_TYPES.filter(t => t.value !== 'bearing' || c.kind === 'arc');
      const row = h('div', { class: 'st-bcrow' + (st.sel === c.id ? ' on' : ''), 'data-curve': c.id });
      row.addEventListener('click', e => { if (e.target.closest('select,input,button')) return; st.sel = c.id; renderBCs(); draw(); });
      const sel = h('select', { class: 'select st-sel-sm' }, ...types.map(t => h('option', { value: t.value }, t.label)));
      sel.value = bc.type;
      sel.addEventListener('change', () => {
        const ty = sel.value, Ls = curveLength(c);
        const defaults = { force: { fx: 0, fy: -1000 }, pressure: { p: 10e6 }, shear: { q: 5e6 }, bearing: { F: 10e3, angle: 90 } };
        set({ type: ty, ...(defaults[ty] || {}) }); void Ls;
      });
      row.append(h('div', { class: 'st-bclab' }, h('span', { class: 'st-dot ' + bcClass(bc.type) }), label), sel);
      const vals = h('div', { class: 'st-grid2 st-bcvals' });
      const upd = (k, v) => set({ ...bc, [k]: v });
      if (bc.type === 'force') vals.append(numField('Fx (total)', 'force', () => bc.fx || 0, v => upd('fx', v)), numField('Fy (total)', 'force', () => bc.fy || 0, v => upd('fy', v)));
      if (bc.type === 'pressure') vals.append(numField('Pressure', 'stress', () => bc.p, v => upd('p', v), { tip: 'Positive pushes on the surface (compression).' }));
      if (bc.type === 'shear') vals.append(numField('Shear τ', 'stress', () => bc.q, v => upd('q', v), { tip: 'Tangential traction; positive runs along the boundary with the material on its left.' }));
      if (bc.type === 'bearing') vals.append(numField('Pin force', 'force', () => bc.F, v => upd('F', v)), numField('Direction', null, () => bc.angle, v => upd('angle', v), { suffix: '°', tip: 'Direction the pin pushes the material, counter-clockwise from +x. The contact pressure follows a cosine over half the hole.' }));
      if (vals.childNodes.length) row.append(vals);
      b.append(row);
    }
    b.append(h('div', { class: 'hint' }, 'Click an edge on the canvas to find it here. A part needs enough supports to stop it moving — or loads that balance, like a coupon pulled at both ends.'));
  }
  const bcClass = t => ({ fixed: 'fix', roller: 'rol', rollerX: 'rol', rollerY: 'rol', force: 'load', pressure: 'load', shear: 'load', bearing: 'load' }[t] || 'free');

  // ---------------------------------------------------------------- canvas
  const stage = h('div', { class: 'stage st-stage st-fea', tabindex: 0 });
  const cv = h('canvas'), ctx = cv.getContext('2d');
  const readout = h('div', { class: 'readout' }), legend = h('div', { class: 'legend st-cbar' }), busy = h('div', { class: 'st-busy' }, h('span', { class: 'spin-prop' }), 'Solving…');
  const toolbar = h('div', { class: 'st-tools' });
  stage.append(cv, toolbar, readout, legend, busy);
  const TOOLS = [
    ['select', 'Select edges, pan and zoom', '<path d="M5 3l14 8-6 1.5L10 19z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>'],
    ['probe', 'Probe: drag a line to plot stresses along it', '<path d="M4 20L20 4" stroke="currentColor" stroke-width="1.6" stroke-dasharray="3 2"/><circle cx="4" cy="20" r="2" fill="currentColor"/><circle cx="20" cy="4" r="2" fill="currentColor"/>'],
    ['outline', 'Outline: click corners, click the first point to close (custom geometry)', '<path d="M4 18L7 5l12 3-2 11z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>'],
    ['hole', 'Hole: press at the centre and drag out the radius (custom geometry)', '<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>'],
  ];
  const toolBtns = {};
  for (const [id, tip, svg] of TOOLS) { const b = h('button', { type: 'button', class: 'st-tool', title: tip, html: `<svg viewBox="0 0 24 24" width="18" height="18">${svg}</svg>` }); b.addEventListener('click', () => setTool(id)); toolbar.append(b); toolBtns[id] = b; }
  toolbar.append(h('span', { class: 'st-sep' }));
  const fitB = h('button', { type: 'button', class: 'st-tool', title: 'Fit to view', html: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' });
  fitB.addEventListener('click', () => { fitView(); draw(); }); toolbar.append(fitB);
  function setTool(t) {
    if ((t === 'outline' || t === 'hole') && st.model !== 'custom') { st.model = 'custom'; renderControls(); schedule(); }
    if (t === 'outline') { draft = []; }
    st.tool = t; for (const [k, b] of Object.entries(toolBtns)) b.classList.toggle('on', k === t); stage.dataset.tool = t; draw();
  }
  let view = null, draft = null, dragHole = null, dragProbe = null, cursor = null;
  function fitView() {
    const W = stage.clientWidth, H = stage.clientHeight; if (!W || !H) return;
    let bb = built ? size() : null;
    if (st.model === 'custom' && st.custom.outline.length) { const xs = st.custom.outline.map(p => p[0]), ys = st.custom.outline.map(p => p[1]); bb = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; bb.s = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0); }
    if (!bb || !isFinite(bb.s)) bb = { x0: 0, x1: 0.2, y0: 0, y1: 0.1, s: 0.2 };
    const narrow = W < 600, padL = narrow ? 60 : 80, padR = narrow ? 52 : 130, padT = 50, padB = 100;
    const sc = Math.min((W - padL - padR) / Math.max(bb.x1 - bb.x0, bb.s * 0.2), (H - padT - padB) / Math.max(bb.y1 - bb.y0, bb.s * 0.2));
    view = { s: sc, ox: padL + (W - padL - padR - (bb.x1 - bb.x0) * sc) / 2 - bb.x0 * sc, oy: padT + (H - padT - padB + (bb.y1 - bb.y0) * sc) / 2 + bb.y0 * sc };
  }
  const SX = x => view.ox + x * view.s, SY = y => view.oy - y * view.s, WX = X => (X - view.ox) / view.s, WY = Y => (view.oy - Y) / view.s;
  const gridStep = () => { const f = units.factor('dim'), target = 22 / view.s / f, p = 10 ** Math.floor(Math.log10(target)), m = target / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p * f; };
  const snap = (x, y, free) => { if (free) return [x, y]; const g = gridStep(); return [Math.round(x / g) * g, Math.round(y / g) * g]; };

  let raf = 0;
  function draw() { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; paint(); }); }
  function paint() {
    const W = stage.clientWidth, H = stage.clientHeight; if (!W || !H) return;
    if (!view) fitView();
    const dpr = Math.min(devicePixelRatio || 1, 2), PW = Math.round(W * dpr), PH = Math.round(H * dpr);
    if (cv.width !== PW || cv.height !== PH) { cv.width = PW; cv.height = PH; }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, PW, PH);
    const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const col = { text: css('--text'), t2: css('--text-2'), t3: css('--text-3'), acc: css('--accent'), bad: css('--bad'), good: css('--good'), load: css('--lower'), strong: css('--border-strong'), bg: css('--bg-elev'), mono: css('--mono') };
    const fieldDef = FIELDS.find(f => f.value === st.field);
    // deformed positions
    let dsc = 0;
    if (res && st.deformed && res.maxU > 0) dsc = 0.06 * size().s / res.maxU * st.defScale;
    const PX = res ? (i => SX(res.mesh.xy[2 * i] + dsc * res.u[2 * i]) * dpr) : null, PY = res ? (i => SY(res.mesh.xy[2 * i + 1] + dsc * res.u[2 * i + 1]) * dpr) : null;
    let range = null;
    if (res) {
      const f = res.fields[st.field]; let lo = Infinity, hi = -Infinity; for (let i = 0; i < f.length; i++) { if (f[i] < lo) lo = f[i]; if (f[i] > hi) hi = f[i]; }
      if (hi - lo < 1e-12 * Math.max(Math.abs(hi), 1)) { hi = lo + 1; }
      range = { lo, hi };
      rasterize(ctx, PW, PH, res, f, PX, PY, lo, hi, st.bands);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // grid in drawing mode
    if (st.model === 'custom' && (st.tool === 'outline' || st.tool === 'hole' || !res)) {
      const g = gridStep(), x0 = Math.floor(WX(0) / g), x1 = Math.ceil(WX(W) / g), y0 = Math.floor(WY(H) / g), y1 = Math.ceil(WY(0) / g);
      if ((x1 - x0) * (y1 - y0) < 30000) { ctx.fillStyle = col.strong; for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) ctx.fillRect(SX(i * g) - 0.6, SY(j * g) - 0.6, 1.2, 1.2); }
    }
    // mesh
    if (res && st.showMesh) {
      const M = res.mesh, el = M.el, ne = el.length / 6;
      ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 0.6; ctx.beginPath();
      for (let e = 0; e < ne; e++) {
        const c = [0, 3, 1, 4, 2, 5].map(k => el[6 * e + k]);
        ctx.moveTo(PX(c[0]) / dpr, PY(c[0]) / dpr); for (let k = 1; k <= 6; k++) { const v = c[k % 6]; ctx.lineTo(PX(v) / dpr, PY(v) / dpr); }
      }
      ctx.stroke();
    }
    // boundary curves with BC colours (undeformed)
    const bcs = built?.bcs || {};
    for (const c of curves()) {
      const bc = bcs[c.id] || { type: 'free' }, n = c.kind === 'arc' ? 48 : 1;
      const pts = []; for (let k = 0; k <= n; k++) pts.push(curvePoint(c, k / n));
      const kind = bcClass(bc.type);
      ctx.lineWidth = st.sel === c.id ? 4.5 : kind === 'free' ? 1.4 : 3;
      ctx.strokeStyle = st.sel === c.id ? col.acc : kind === 'fix' ? col.t2 : kind === 'rol' ? col.good : kind === 'load' ? col.load : (res ? 'rgba(0,0,0,0.5)' : col.text);
      ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(SX(x), SY(y)) : ctx.moveTo(SX(x), SY(y)))); ctx.stroke();
      glyphs(ctx, c, bc, col);
    }
    // custom drafting overlays
    if (st.model === 'custom' && !built && st.custom.outline.length) {
      const o = st.custom.outline;
      ctx.strokeStyle = col.t2; ctx.lineWidth = 1.6; ctx.beginPath(); o.forEach(([x, y], k) => (k ? ctx.lineTo(SX(x), SY(y)) : ctx.moveTo(SX(x), SY(y)))); ctx.closePath(); ctx.stroke();
      for (const ho of st.custom.holes) { ctx.strokeStyle = holeFits(o, ho) ? col.t2 : col.bad; ctx.lineWidth = holeFits(o, ho) ? 1.6 : 2.4; ctx.beginPath(); ctx.arc(SX(ho.x), SY(ho.y), ho.r * view.s, 0, 2 * Math.PI); ctx.stroke(); }
    }
    if (st.model === 'custom') {
      if (st.tool === 'outline' && draft) {
        ctx.strokeStyle = col.acc; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.beginPath();
        draft.forEach(([x, y], k) => (k ? ctx.lineTo(SX(x), SY(y)) : ctx.moveTo(SX(x), SY(y)))); if (cursor && draft.length) ctx.lineTo(SX(cursor.x), SY(cursor.y)); ctx.stroke(); ctx.setLineDash([]);
        for (const [x, y] of draft) { ctx.fillStyle = col.acc; ctx.beginPath(); ctx.arc(SX(x), SY(y), 3.5, 0, 2 * Math.PI); ctx.fill(); }
      }
      if (dragHole) { ctx.strokeStyle = col.acc; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(SX(dragHole.x), SY(dragHole.y), dragHole.r * view.s, 0, 2 * Math.PI); ctx.stroke(); }
      if (cursor && (st.tool === 'outline' || st.tool === 'hole')) { ctx.strokeStyle = col.acc; ctx.lineWidth = 1.2; const X = SX(cursor.x), Y = SY(cursor.y); ctx.beginPath(); ctx.moveTo(X - 6, Y); ctx.lineTo(X + 6, Y); ctx.moveTo(X, Y - 6); ctx.lineTo(X, Y + 6); ctx.stroke(); }
    }
    // probe line
    const pr = dragProbe || built?.probe;
    if (pr) {
      ctx.strokeStyle = col.text; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(SX(pr.p0[0]), SY(pr.p0[1])); ctx.lineTo(SX(pr.p1[0]), SY(pr.p1[1])); ctx.stroke(); ctx.setLineDash([]);
      for (const p of [pr.p0, pr.p1]) { ctx.fillStyle = col.text; ctx.beginPath(); ctx.arc(SX(p[0]), SY(p[1]), 3, 0, 2 * Math.PI); ctx.fill(); }
    }
    // hot spot
    if (res && fieldDef.q === 'stress') {
      const pk = st.field === 's2' ? res.minS2 : st.field === 's1' ? res.maxS1 : st.field === 'vm' ? res.maxVM : null;
      if (pk) {
        const X = PX(pk.node) / dpr, Y = PY(pk.node) / dpr;
        ctx.strokeStyle = col.text; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X, Y, 7, 0, 2 * Math.PI); ctx.stroke();
        tag(ctx, X + 12, Y - 14, `${st.field === 's2' ? 'min' : 'max'} ${units.fmt('stress', pk.v, 4)}`, col, 'left');
      }
    }
    if (err) { ctx.fillStyle = col.bad; ctx.font = `12px ${css('--font')}`; ctx.textAlign = 'center'; ctx.fillText(err, W / 2, 28); }
    // legend
    if (res && range) {
      const qd = fieldDef.q, n = st.bands ? 12 : 0, ticks = [0, 0.25, 0.5, 0.75, 1].map(t => units.num(qd, range.lo + (range.hi - range.lo) * t, 3));
      legend.style.display = '';
      const stops = [];
      if (n) for (let k = 0; k < n; k++) { const li = 3 * Math.round(k / (n - 1) * 255), c = `rgb(${LUT[li]},${LUT[li + 1]},${LUT[li + 2]})`; stops.push(`${c} ${(k / n * 100).toFixed(2)}%`, `${c} ${((k + 1) / n * 100).toFixed(2)}%`); }
      else for (let k = 0; k <= 10; k++) { const li = 3 * Math.round(k / 10 * 255); stops.push(`rgb(${LUT[li]},${LUT[li + 1]},${LUT[li + 2]}) ${k * 10}%`); }
      legend.innerHTML = `<div>${fieldDef.label} (${units.label(qd)})${dsc ? ` · deformed ×${fmtNum(dsc, 3)}` : ''}</div><div class="st-cgrad" style="background:linear-gradient(to right, ${stops.join(',')})"></div><div class="ticks">${ticks.map(t => `<span>${t}</span>`).join('')}</div>`;
    } else legend.style.display = 'none';
  }
  function tag(g, X, Y, text, col, align = 'center') {
    g.font = `10.5px ${col.mono}`; const w = g.measureText(text).width + 10, x0 = align === 'left' ? X : X - w / 2;
    g.fillStyle = col.bg; g.globalAlpha = 0.9; g.fillRect(x0, Y - 8, w, 16); g.globalAlpha = 1;
    g.fillStyle = col.text; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(text, x0 + 5, Y + 0.5);
  }
  function glyphs(g, c, bc, col) {
    const n = Math.max(2, Math.round(curveLength(c) * view.s / 26));
    const pts = [], nrm = [];
    for (let k = 0; k <= n; k++) {
      const t = (k + 0.5) / (n + 1), p = curvePoint(c, t), q = curvePoint(c, Math.min(1, t + 1e-4)), dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1;
      let nx = dy / L, ny = -dx / L; // outward test
      const tst = [p[0] + nx * 1e-4 * size().s, p[1] + ny * 1e-4 * size().s];
      if (insideGeom(tst[0], tst[1])) { nx = -nx; ny = -ny; }
      pts.push(p); nrm.push([nx, ny]);
    }
    const arrow = (x1, y1, x2, y2, color) => { const a = Math.atan2(y2 - y1, x2 - x1); g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 1.4; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); g.beginPath(); g.moveTo(x2, y2); g.lineTo(x2 - 6 * Math.cos(a - 0.4), y2 - 6 * Math.sin(a - 0.4)); g.lineTo(x2 - 6 * Math.cos(a + 0.4), y2 - 6 * Math.sin(a + 0.4)); g.closePath(); g.fill(); };
    if (bc.type === 'fixed') {
      g.strokeStyle = col.t2; g.lineWidth = 1;
      pts.forEach((p, k) => { const [nx, ny] = nrm[k], X = SX(p[0]), Y = SY(p[1]); g.beginPath(); g.moveTo(X, Y); g.lineTo(X + (nx * 7 + ny * 5), Y - (ny * 7 - nx * 5)); g.stroke(); });
    } else if (bc.type.startsWith('roller')) {
      g.strokeStyle = col.good; g.lineWidth = 1.2;
      pts.forEach((p, k) => { if (k % 2) return; const [nx, ny] = nrm[k]; g.beginPath(); g.arc(SX(p[0]) + nx * 5, SY(p[1]) - ny * 5, 3.5, 0, 2 * Math.PI); g.stroke(); });
    } else if (bc.type === 'force' || bc.type === 'pressure' || bc.type === 'shear') {
      pts.forEach((p, k) => {
        if (k % 2) return;
        const [nx, ny] = nrm[k]; let dx, dy;
        if (bc.type === 'force') { const F = Math.hypot(bc.fx || 0, bc.fy || 0) || 1; dx = (bc.fx || 0) / F; dy = (bc.fy || 0) / F; }
        else if (bc.type === 'pressure') { const sg = Math.sign(bc.p) || 1; dx = -nx * sg; dy = -ny * sg; }
        else { const sg = Math.sign(bc.q) || 1; dx = -ny * sg; dy = nx * sg; }
        const X = SX(p[0]), Y = SY(p[1]), Lp = 22;
        const outside = dx * nx + dy * ny < 0; // arrow comes from outside toward the edge
        if (outside) arrow(X - dx * Lp, Y + dy * Lp, X, Y, col.load); else arrow(X, Y, X + dx * Lp, Y - dy * Lp, col.load);
      });
      const mid = curvePoint(c, 0.5), [nx, ny] = nrm[Math.floor(nrm.length / 2)];
      const lab = bc.type === 'force' ? units.fmt('force', Math.hypot(bc.fx || 0, bc.fy || 0), 3) : units.fmt('stress', Math.abs(bc.type === 'pressure' ? bc.p : bc.q), 3);
      tag(g, SX(mid[0]) + nx * 40, SY(mid[1]) - ny * 40, lab, { ...col, text: col.load });
    } else if (bc.type === 'bearing' && c.kind === 'arc') {
      const th0 = bc.angle * Math.PI / 180;
      for (let k = -3; k <= 3; k++) {
        const phi = th0 + k * Math.PI / 8, len = 6 + 16 * Math.cos(phi - th0);
        const x = c.c[0] + c.r * Math.cos(phi), y = c.c[1] + c.r * Math.sin(phi), X = SX(x), Y = SY(y);
        arrow(X - Math.cos(phi) * len, Y + Math.sin(phi) * len, X, Y, col.load);
      }
      tag(g, SX(c.c[0]), SY(c.c[1]), units.fmt('force', bc.F, 3), { ...col, text: col.load });
    }
  }
  function insideGeom(x, y) {
    let ins = false;
    for (const l of built?.geom.loops || []) { const pts = []; for (const c of l.curves) { const n = c.kind === 'arc' ? 32 : 1; for (let k = 0; k < n; k++) pts.push(curvePoint(c, k / n)); } if (pip(pts, x, y)) ins = !ins; }
    return ins;
  }

  // interaction
  let pan = null;
  const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener('pointerdown', e => {
    stage.focus({ preventScroll: true });
    const [mx, my] = pos(e), wx = WX(mx), wy = WY(my), [sx, sy] = snap(wx, wy, e.altKey);
    cv.setPointerCapture(e.pointerId);
    if (st.tool === 'probe') { dragProbe = { p0: [wx, wy], p1: [wx, wy] }; return; }
    if (st.tool === 'outline') {
      draft = draft || [];
      const closes = Math.hypot(SX(draft[0]?.[0]) - mx, SY(draft[0]?.[1]) - my) < 16 || (draft[0] && Math.hypot(draft[0][0] - sx, draft[0][1] - sy) < 1e-9);
      if (draft.length >= 3 && closes) {
        st.custom.outline = draft; st.custom.bcs = {}; st.bc.custom = {}; st.probe.custom = null; draft = null;
        st.custom.holes = st.custom.holes.filter(hh => holeFits(st.custom.outline, hh));
        setTool('select'); renderControls(); schedule(); return;
      }
      draft.push([sx, sy]); draw(); return;
    }
    if (st.tool === 'hole') { dragHole = { x: sx, y: sy, r: 0 }; return; }
    // select an edge, else pan
    let best = null, bd = 8;
    for (const c of curves()) { const n = c.kind === 'arc' ? 48 : 1; let prev = curvePoint(c, 0); for (let k = 1; k <= n; k++) { const p = curvePoint(c, k / n); const d = segDistPx(SX(prev[0]), SY(prev[1]), SX(p[0]), SY(p[1]), mx, my); if (d < bd) { bd = d; best = c.id; } prev = p; } }
    if (best) { st.sel = best; renderBCs(); draw(); const row = sBC.body.querySelector(`[data-curve="${best}"]`); row && row.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
    pan = { mx, my, ox: view.ox, oy: view.oy };
  });
  cv.addEventListener('pointermove', e => {
    const [mx, my] = pos(e), wx = WX(mx), wy = WY(my);
    const [sx, sy] = snap(wx, wy, e.altKey); cursor = { x: sx, y: sy };
    if (pan) { view.ox = pan.ox + mx - pan.mx; view.oy = pan.oy + my - pan.my; draw(); return; }
    if (dragProbe) { dragProbe.p1 = [wx, wy]; draw(); return; }
    if (dragHole) { dragHole.r = Math.hypot(sx - dragHole.x, sy - dragHole.y); draw(); return; }
    if (st.tool !== 'select') { draw(); }
    // readout
    if (res && sampler) {
      const s = sampler(wx, wy);
      if (s) {
        const F = res.fields;
        readout.innerHTML = `(${units.num('dim', wx, 4)}, ${units.num('dim', wy, 4)}) ${units.label('dim')}<br>σ_vm ${units.fmt('stress', s.value(F.vm), 4)}<br>σx ${units.num('stress', s.value(F.sx), 4)} · σy ${units.num('stress', s.value(F.sy), 4)} · τxy ${units.num('stress', s.value(F.txy), 4)}<br>σ₁ ${units.num('stress', s.value(F.s1), 4)} · σ₂ ${units.num('stress', s.value(F.s2), 4)} ${units.label('stress')}<br>|u| ${units.fmt('disp', s.value(F.um), 3)}`;
        readout.style.display = 'block';
        const w = readout.offsetWidth, hh = readout.offsetHeight;
        readout.style.left = Math.min(mx + 14, stage.clientWidth - w - 6) + 'px'; readout.style.top = Math.min(my + 14, stage.clientHeight - hh - 6) + 'px';
      } else readout.style.display = 'none';
    }
  });
  const endDrag = () => {
    if (dragProbe) { const L = Math.hypot(dragProbe.p1[0] - dragProbe.p0[0], dragProbe.p1[1] - dragProbe.p0[1]); if (L * view.s > 6) { st.probe[st.model] = { p0: dragProbe.p0, p1: dragProbe.p1, field: st.field }; build(); renderProbe(); save(); } dragProbe = null; draw(); }
    if (dragHole) { if (dragHole.r * view.s > 3) { st.custom.holes.push({ x: dragHole.x, y: dragHole.y, r: dragHole.r }); renderControls(); schedule(); } dragHole = null; draw(); }
    pan = null;
  };
  cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);
  cv.addEventListener('pointerleave', () => { readout.style.display = 'none'; cursor = null; draw(); });
  cv.addEventListener('wheel', e => {
    e.preventDefault(); const [mx, my] = pos(e), k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), wx = WX(mx), wy = WY(my);
    view.s *= k; view.ox = mx - wx * view.s; view.oy = my + wy * view.s; draw();
  }, { passive: false });
  stage.addEventListener('keydown', e => { if (e.key === 'Escape') { draft = st.tool === 'outline' ? [] : null; dragHole = null; draw(); } });
  new ResizeObserver(() => { if (!view) fitView(); draw(); }).observe(stage);
  addEventListener('themechange', draw);
  function showBusy() {
    // a fresh propeller each time it appears, so it only turns into a jet fan on a long solve
    if (solving && !busy.classList.contains('show')) busy.firstChild.replaceWith(h('span', { class: 'spin-prop' }));
    busy.classList.toggle('show', solving);
  }

  // ---------------------------------------------------------------- results
  const metrics = metricsGrid();
  const probeHost = h('div', { class: 'st-plot' }), probePlot = new Plot(probeHost, { legend: true });
  const probeHead = h('div', { class: 'row', style: { gap: '6px' } });
  const probeCard = h('div', { class: 'plot-card' }, h('div', { class: 'plot-head' }, h('h4', {}, 'Along the probe line'), probeHead), probeHost);
  const convHost = h('div', { class: 'st-plot st-plot-sm' }), convPlot = new Plot(convHost, { legend: true });
  const convBox = h('div', {}), convCard = card('Mesh convergence', 'Peak stress for each mesh density. A converged answer stops changing as the mesh is refined; a stress that keeps rising signals a singularity (sharp corner or point load).', convBox, convHost);
  const insights = h('div', {}), reacts = h('div', {});
  const main = h('div', { class: 'cf-main-inner' });
  main.append(stage, metrics.el, h('div', { class: 'st-pair' }, probeCard, card('What the results say', null, insights)), h('div', { class: 'st-pair' }, card('Reactions and loads', 'Forces the supports exert on the part, per boundary edge, and the total applied load (they should balance).', reacts), convCard));

  function render() {
    showBusy(); renderBCs(); draw();
    if (!res || !res.ok) { metrics.set(err ? [{ k: 'Status', v: 'No result', s: err, cls: 'bad' }] : []); insightsList(insights, err ? [{ type: 'b', t: 'Cannot solve', d: err }] : []); reacts.replaceChildren(); probePlot.setData({ series: [] }); return; }
    const mat = material(), ref = built.ref, fy = mat.fy;
    const m = [
      { k: 'Max von Mises', v: units.fmt('stress', res.maxVM.v, 4), s: `${(res.maxVM.v / fy * 100).toFixed(0)}% of yield`, cls: res.maxVM.v > fy ? 'bad' : '' },
      { k: 'Max principal σ₁', v: units.fmt('stress', res.maxS1.v, 4) }, { k: 'Min principal σ₂', v: units.fmt('stress', res.minS2.v, 4) },
      { k: 'Max displacement', v: units.fmt('disp', res.maxU, 3) },
    ];
    let ktFE = null;
    if (ref) {
      const f = res.fields[ref.field]; let pk = -Infinity; for (let i = 0; i < f.length; i++) pk = Math.max(pk, f[i]);
      ktFE = pk / ref.nominal;
      m.push({ k: 'Kt (FEA)', v: fmtNum(ktFE, 4), s: `peak ${ref.field === 'vm' ? 'σ_vm' : ref.field === 'sx' ? 'σx' : 'σy'} / nominal`, tip: `Nominal stress: ${ref.nomLabel} = ${units.fmt('stress', ref.nominal, 4)}` });
      if (ref.kt) m.push({ k: 'Kt (handbook)', v: fmtNum(ref.kt, 4), s: `${((ktFE / ref.kt - 1) * 100).toFixed(1)}% difference`, tip: ref.ktLabel });
    }
    m.push({ k: 'Safety factor', v: fmtNum(fy / res.maxVM.v, 3), s: 'yield / peak von Mises', cls: res.maxVM.v > fy ? 'bad' : '' });
    m.push({ k: 'Mesh', v: `${res.stats.elements} el.`, s: `${res.stats.dofs} DOF · ${(res.stats.tMesh + res.stats.tAsm + res.stats.tSolve).toFixed(0)} ms` });
    metrics.set(m);
    // insights
    const out = [];
    if (res.unrestrained) out.push({ type: 'b', t: 'Not held in place', d: 'The loads do not balance and the supports do not stop rigid motion, so the results are meaningless. Add a fixed or roller edge.' });
    else if (res.noSupports) out.push({ type: 'i', t: 'Free body with balanced loads', d: 'No edge is supported; the loads cancel each other, like a test coupon pulled at both ends, so only deformation matters.' });
    if (ref && ref.kt) out.push({ type: Math.abs(ktFE / ref.kt - 1) < 0.05 ? 'g' : 'w', t: `Stress concentration Kt = ${fmtNum(ktFE, 3)} (handbook ${fmtNum(ref.kt, 3)})`, d: `${ref.ktLabel}, based on ${ref.nomLabel}. The hole raises the local stress ${fmtNum(ktFE, 3)}× above the average across the net section.` });
    else if (ref) out.push({ type: 'i', t: `Stress concentration Kt = ${fmtNum(ktFE, 3)}`, d: `Peak stress divided by the nominal ${ref.nomLabel} = ${units.fmt('stress', ref.nominal, 4)}. Compare with Peterson's charts; a larger radius lowers Kt.` });
    if (ref?.extra) out.push({ type: 'i', t: `${ref.extra.label} = ${units.fmt('stress', ref.extra.value, 4)}`, d: 'Lugs are also checked for bearing, shear-out and net-section tension (e.g. the Melcon & Hoblit / ESDU methods); FEA shows the stress peaks those methods allow for.' });
    if (ref?.beam) {
      const { P, L: Lb, h: hb } = ref.beam, I = st.t * hb ** 3 / 12, G = mat.E / (2 * (1 + mat.nu));
      const dB = P * Lb ** 3 / (3 * mat.E * I), dS = P * Lb / (5 / 6 * G * st.t * hb), tip = sampler(Lb * (1 - 1e-6), hb / 2);
      const dFE = tip ? -tip.value(res.fields.uy) : NaN;
      out.push({ type: 'i', t: `Tip deflection ${units.fmt('disp', dFE, 4)} vs beam theory ${units.fmt('disp', dB + dS, 4)}`, d: `Euler–Bernoulli bending gives ${units.fmt('disp', dB, 4)}; shear deformation (Timoshenko) adds ${units.fmt('disp', dS, 4)} — ${(dS / (dB + dS) * 100).toFixed(0)}% for L/h = ${fmtNum(Lb / hb, 3)}. Stubby beams are noticeably softer than simple bending predicts.` });
    }
    out.push({ type: res.maxVM.v > fy ? 'b' : 'g', t: res.maxVM.v > fy ? 'Local yielding predicted' : `Elastic everywhere — safety factor ${fmtNum(fy / res.maxVM.v, 3)}`, d: res.maxVM.v > fy ? 'The peak exceeds yield. In ductile metals a small yield zone at a notch redistributes load (static strength is often fine) but it governs fatigue life.' : 'Under fatigue loading, the peak (not the average) stress controls crack initiation: that is why aircraft fittings have generous radii.' });
    {
      const X = res.mesh.xy, nd = res.maxVM.node, px = X[2 * nd], py = X[2 * nd + 1], tol = 1e-6 * size().s;
      const atClampCorner = curves().some(c => c.kind === 'line' && ['fixed', 'roller', 'rollerX', 'rollerY'].includes((built.bcs[c.id] || {}).type) && [c.p0, c.p1].some(p => Math.hypot(p[0] - px, p[1] - py) < tol));
      if (atClampCorner) out.push({ type: 'w', t: 'Peak stress sits at the corner of a support', d: 'A perfectly rigid clamp ending at a sharp corner is a mathematical singularity: the stress there grows without limit as the mesh is refined. Read the stress a little away from the corner, or model the real attachment.' });
    }
    if (st.model === 'bracket' && st.params.bracket.r < 1e-4) out.push({ type: 'w', t: 'Sharp re-entrant corner: stress singularity', d: 'With no fillet the elastic stress is theoretically infinite at the corner; refining the mesh will keep raising the peak. Add a fillet radius, or run the convergence study to see it.' });
    if (res.stats.quality.min < 0.3) out.push({ type: 'w', t: 'Some poorly shaped elements', d: `Minimum element quality ${res.stats.quality.min.toFixed(2)}. Try a different mesh density.` });
    out.push({ type: 'i', t: `Mesh: ${res.stats.elements} quadratic triangles, ${res.stats.nodes} nodes`, d: `Element quality min ${res.stats.quality.min.toFixed(2)}, mean ${res.stats.quality.avg.toFixed(2)} (1 = equilateral). Solved in ${(res.stats.tMesh + res.stats.tAsm + res.stats.tSolve).toFixed(0)} ms with a skyline Cholesky solver (RCM ordering).` });
    insightsList(insights, out);
    // reactions
    const rows = [];
    for (const [id, r] of Object.entries(res.reactions)) { const c = curves().find(x => x.id === id); rows.push([c?.label || id, units.num('force', r.fx, 4), units.num('force', r.fy, 4)]); }
    rows.push({ cells: ['Applied loads (Σ)', units.num('force', res.load.fx, 4), units.num('force', res.load.fy, 4)], cls: 'st-sum' });
    reacts.replaceChildren(table(['Edge', `Fx (${units.label('force')})`, `Fy (${units.label('force')})`], rows));
    renderProbe(); renderConv();
  }
  function renderProbe() {
    probeHead.replaceChildren();
    const pr = built?.probe;
    if (!res?.ok || !pr) { probePlot.setData({ series: [] }); probeHead.append(h('span', { class: 'hint' }, 'Draw one with the probe tool')); return; }
    probeHead.append(h('span', { class: 'hint', style: { margin: 0 } }, pr.label || ''));
    const N = 160, L = Math.hypot(pr.p1[0] - pr.p0[0], pr.p1[1] - pr.p0[1]), xs = [], ser = { sx: [], sy: [], txy: [], vm: [] };
    for (let k = 0; k <= N; k++) {
      const t = k / N, x = pr.p0[0] + (pr.p1[0] - pr.p0[0]) * t, y = pr.p0[1] + (pr.p1[1] - pr.p0[1]) * t, s = sampler(x, y);
      xs.push(units.fromSI('dim', t * L));
      for (const f of Object.keys(ser)) ser[f].push(s ? units.fromSI('stress', s.value(res.fields[f])) : NaN);
    }
    const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const series = [{ x: xs, y: ser.sx, color: css('--accent'), label: 'σx' }, { x: xs, y: ser.sy, color: css('--lower'), label: 'σy' }, { x: xs, y: ser.txy, color: css('--lam'), label: 'τxy', width: 1.4 }, { x: xs, y: ser.vm, color: css('--text-3'), label: 'von Mises', dash: [4, 3] }];
    const hl = [];
    const ref = built.ref;
    if (ref && !ref.beam) hl.push({ y: units.fromSI('stress', ref.nominal), color: css('--text-3'), label: 'nominal ' + ref.nomLabel.split('=')[0].trim() });
    if (ref?.beam && !st.probe[st.model]) {
      const { P, L: Lb, h: hb } = ref.beam, I = st.t * hb ** 3 / 12, M = P * Lb / 2;
      series.push({ x: xs, y: xs.map(d => units.fromSI('stress', M * (units.toSI('dim', d) - hb / 2) / I)), color: css('--good'), label: 'beam theory My/I', dash: [6, 4] });
    }
    probePlot.setOpts({ xlabel: `distance along the line (${units.label('dim')})`, ylabel: `stress (${units.label('stress')})`, xname: 's', yname: 'σ' });
    probePlot.setData({ series, hlines: hl });
  }
  function runConvergence() {
    build(); if (!built) return;
    const mat = material(), pts = [];
    convBox.replaceChildren(h('div', { class: 'hint' }, 'Running…'));
    let k = 0;
    const step = () => {
      if (k >= LEVELS.length) { conv = { model: st.model, pts }; renderConv(); return; }
      try {
        const r = solvePlate({ geom: built.geom, E: mat.E, nu: mat.nu, thickness: st.t, plane: st.plane, bcs: built.bcs, mesh: meshOpts(k) });
        if (r.ok) { const f = built.ref ? r.fields[built.ref.field] : r.fields.vm; let pk = -Infinity; for (let i = 0; i < f.length; i++) pk = Math.max(pk, f[i]); pts.push({ level: LEVELS[k].label, dofs: r.stats.dofs, peak: pk, t: r.stats.tMesh + r.stats.tAsm + r.stats.tSolve }); }
      } catch (e) { console.error(e); }
      k++; convBox.replaceChildren(h('div', { class: 'hint' }, `Running… ${k}/${LEVELS.length}`)); setTimeout(step, 10);
    };
    setTimeout(step, 10);
  }
  function renderConv() {
    if (!conv || conv.model !== st.model) { convBox.replaceChildren(h('div', { class: 'hint' }, 'Solve the same part on five meshes to check that the peak stress has converged.'), btn('Run convergence study', runConvergence)); convPlot.setData({ series: [] }); return; }
    const p = conv.pts, last = p[p.length - 1]?.peak, fname = built?.ref ? (built.ref.field === 'vm' ? 'σ_vm' : built.ref.field === 'sx' ? 'σx' : 'σy') : 'σ_vm';
    convBox.replaceChildren(table(['Mesh', 'DOF', `peak ${fname} (${units.label('stress')})`, 'change vs finest', 'time'], p.map(q => [q.level, q.dofs, units.num('stress', q.peak, 5), ((q.peak / last - 1) * 100).toFixed(2) + '%', q.t.toFixed(0) + ' ms'])));
    const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    convPlot.setOpts({ xlabel: 'degrees of freedom', ylabel: `peak ${fname} (${units.label('stress')})`, xname: 'DOF', yname: 'σ' });
    convPlot.setData({ series: [{ x: p.map(q => q.dofs), y: p.map(q => units.fromSI('stress', q.peak)), color: css('--accent'), label: 'peak stress', points: true }] });
  }

  const onUnits = () => { renderControls(); render(); };
  addEventListener('unitschange', onUnits);
  build(); renderControls(); setTool('select'); solve();
  return {
    controls, main,
    show() { requestAnimationFrame(() => { fitView(); draw(); probePlot.draw(); convPlot.draw(); }); },
    destroy() { removeEventListener('unitschange', onUnits); },
  };
}

// ---------------------------------------------------------------- contour rasteriser
const LUT = (() => {
  const stops = [[0, [38, 70, 200]], [0.2, [30, 150, 235]], [0.4, [40, 200, 160]], [0.6, [150, 215, 60]], [0.8, [250, 190, 40]], [1, [220, 45, 35]]];
  const out = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255; let k = 1; while (k < stops.length - 1 && t > stops[k][0]) k++;
    const [t0, c0] = stops[k - 1], [t1, c1] = stops[k], f = (t - t0) / (t1 - t0);
    for (let j = 0; j < 3; j++) out[3 * i + j] = c0[j] + (c1[j] - c0[j]) * f;
  }
  return out;
})();
const SUB = [[0, 3, 5], [3, 1, 4], [5, 4, 2], [3, 4, 5]];
function rasterize(ctx, W, H, res, f, PX, PY, lo, hi, bands) {
  const img = ctx.createImageData(W, H), d = img.data, M = res.mesh, el = M.el, ne = el.length / 6, inv = 1 / (hi - lo), NB = 12;
  for (let e = 0; e < ne; e++) {
    for (const [a, b, c] of SUB) {
      const ia = el[6 * e + a], ib = el[6 * e + b], ic = el[6 * e + c];
      const x0 = PX(ia), y0 = PY(ia), x1 = PX(ib), y1 = PY(ib), x2 = PX(ic), y2 = PY(ic);
      const va = (f[ia] - lo) * inv, vb = (f[ib] - lo) * inv, vc = (f[ic] - lo) * inv;
      let minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
      let minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
      const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
      if (Math.abs(den) < 1e-12) continue;
      for (let y = minY; y <= maxY; y++) {
        const py = y + 0.5;
        for (let x = minX; x <= maxX; x++) {
          const px = x + 0.5;
          const l0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / den, l1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / den, l2 = 1 - l0 - l1;
          if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
          let t = l0 * va + l1 * vb + l2 * vc; t = t < 0 ? 0 : t > 1 ? 1 : t;
          if (bands) t = Math.min(NB - 1, Math.floor(t * NB)) / (NB - 1);
          const li = 3 * Math.round(t * 255), o = 4 * (y * W + x);
          d[o] = LUT[li]; d[o + 1] = LUT[li + 1]; d[o + 2] = LUT[li + 2]; d[o + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}
// a circular hole must sit inside the outline with some material around it
function holeFits(outline, ho) {
  if (!pip(outline, ho.x, ho.y)) return false;
  for (let i = 0; i < outline.length; i++) { const a = outline[i], b = outline[(i + 1) % outline.length]; if (segDistPx(a[0], a[1], b[0], b[1], ho.x, ho.y) < ho.r * 1.05) return false; }
  return true;
}
function pip(pts, x, y) { let ins = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins; } return ins; }
function segDistPx(ax, ay, bx, by, x, y) { const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy; let t = L2 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(ax + dx * t - x, ay + dy * t - y); }
void info;
