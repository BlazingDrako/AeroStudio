// Structure tab: draw a 2-D structure, then read its free-body diagram, equilibrium equations,
// reactions, internal-force diagrams, deflections, stresses, friction/tipping limits, vibration
// modes and buckling loads — all from one model.
import { h, section, info, select, downloadText } from '../../lib/ui.js';
import { Plot } from '../../lib/plot.js';
import { analyze, modal, buckling, prepare } from '../../solvers/frame2d.js';
import { analyzeStatics, letters } from '../../solvers/statics.js';
import { MATERIALS, SHAPES, sectionProps } from '../../solvers/sections.js';
import { sharedStore, loadSaved, exampleModel, EXAMPLES, blankModel, normalize } from './model.js';
import { StructureEditor } from './editor.js';
import { numField, selField, segField, checkField, table, toCSV, card, metricsGrid, insightsList, units, fmtNum } from './common.js';

const SUPPORTS = [
  { value: 'fixed', label: 'Fixed', title: 'Restrains x, y and rotation (built-in / welded).' },
  { value: 'pin', label: 'Pin', title: 'Restrains x and y; free to rotate.' },
  { value: 'roller', label: 'Roller', title: 'Restrains movement normal to the surface only.' },
  { value: 'slider', label: 'Slider', title: 'Restrains the normal direction and rotation; slides along the surface.' },
  { value: 'contact', label: 'Contact', title: 'Unilateral contact with friction: N ≥ 0 and |F| ≤ µN. Checked for slipping and lift-off (tipping).' },
  { value: 'spring', label: 'Spring', title: 'Elastic support with stiffnesses kx, ky, kθ.' },
];
const LOAD_KINDS = [
  { value: 'force', label: 'Force at a node' }, { value: 'moment', label: 'Moment at a node' },
  { value: 'dist', label: 'Distributed load on a member' }, { value: 'point', label: 'Point load on a member' },
  { value: 'mpoint', label: 'Moment on a member' }, { value: 'thermal', label: 'Temperature change on a member' },
];
const DIRS = [
  { value: 'gy', label: 'Global Y, per member length' }, { value: 'gyp', label: 'Global Y, per horizontal projection' },
  { value: 'gx', label: 'Global X, per member length' }, { value: 'gxp', label: 'Global X, per vertical projection' },
  { value: 'ly', label: 'Perpendicular to the member (local y)' }, { value: 'lx', label: 'Along the member (local x)' },
];
const VIEWS = [
  { id: 'model', label: 'Model' }, { id: 'fbd', label: 'Free body' }, { id: 'N', label: 'Axial N' }, { id: 'V', label: 'Shear V' },
  { id: 'M', label: 'Moment M' }, { id: 'defl', label: 'Deflection' }, { id: 'stress', label: 'Stress' }, { id: 'modes', label: 'Vibration' }, { id: 'buckling', label: 'Buckling' },
];

export function structureTab() {
  const saved = loadSaved();
  const store = sharedStore();
  const ui = { view: 'model', labels: true, mTension: false, diagScale: 1, deflScale: 1, animate: true, mode: 0, fbdBody: -1, plotMember: null, plotQty: 'M', table: 'reactions' };
  const pal = {
    member: { type: 'frame', relA: false, relB: false },
    support: { type: 'pin', angle: 0, mu: 0.3, kx: 1e6, ky: 1e6, kr: 0 },
    load: { kind: 'force', fx: 0, fy: -10e3, m: 10e3, w1: -10e3, w2: -10e3, dir: 'gy', t0: 0, t1: 1, dT: 30, dTg: 0 },
  };
  let res = { static: null, statics: null, modal: null, buckling: null, prepared: null };
  let selection = null, dirty = true, ready = false;

  const app = {
    ui,
    results: () => res,
    get prepared() { return res.prepared; },
    memberDefaults: () => ({ type: pal.member.type, relA: pal.member.relA, relB: pal.member.relB, sec: store.model.defaults.sec, mat: store.model.defaults.mat }),
    loadPalette: () => pal.load,
    onTool: () => { if (ready) renderPalette(); },
    onSelect: hit => { selection = hit; if (ready) renderSelection(); },
    applySupport(nodeId) {
      store.commit();
      const mdl = store.model, p = pal.support;
      mdl.supports = mdl.supports.filter(s => s.node !== nodeId);
      const sp = { node: nodeId, type: p.type, angle: p.angle };
      if (p.type === 'contact') sp.mu = p.mu;
      if (p.type === 'spring') Object.assign(sp, { kx: p.kx, ky: p.ky, kr: p.kr });
      mdl.supports.push(sp);
      editor.select({ kind: 'support', id: nodeId });
      store.changed();
    },
    applyLoad({ node, member, t, kind }) {
      store.commit();
      const p = pal.load, id = store.id('l');
      kind = kind || p.kind;
      let ld;
      if (node) ld = p.kind === 'moment' ? { id, kind: 'moment', node, m: p.m } : { id, kind: 'force', node, fx: p.fx, fy: p.fy };
      else if (kind === 'dist') ld = { id, kind: 'dist', member, w1: p.w1, w2: p.w2, dir: p.dir, t0: p.t0, t1: p.t1 };
      else if (kind === 'point') ld = { id, kind: 'point', member, t, fx: p.fx, fy: p.fy };
      else if (kind === 'mpoint') ld = { id, kind: 'mpoint', member, t, m: p.m };
      else if (kind === 'thermal') ld = { id, kind: 'thermal', member, dT: p.dT, dTg: p.dTg };
      store.model.loads.push(ld);
      editor.select({ kind: 'load', id });
      store.changed();
    },
    live() { liveRecompute(); },
  };
  const editor = new StructureEditor(store, app);

  // ---------------------------------------------------------------- analysis
  function recompute() {
    const m = store.model;
    let st = null, sx = null, P = null;
    try { st = m.members.length ? analyze(m) : null; } catch (e) { console.error(e); st = { ok: false, error: 'exception', msg: String(e) }; }
    try { sx = m.members.length ? analyzeStatics(m, { scale: m.settings.scaleLoad || 'all' }) : null; } catch (e) { console.error(e); sx = null; }
    try { P = m.members.length ? prepare(m) : null; } catch { P = null; }
    res = { static: st, statics: sx, modal: null, buckling: null, prepared: P };
    dirty = true;
    scheduleDynamics();
  }
  let dynTimer = 0;
  function scheduleDynamics() {
    clearTimeout(dynTimer);
    dynTimer = setTimeout(() => {
      const m = store.model, cur = res;
      if (!cur.static?.ok) { renderResults(); return; }
      try { cur.modal = modal(m); } catch (e) { console.error(e); cur.modal = { ok: false, error: 'exception' }; }
      try { cur.buckling = buckling(m); } catch (e) { console.error(e); cur.buckling = { ok: false, error: 'exception' }; }
      if (cur === res) { renderResults(); editor.draw(); }
    }, 180);
  }
  let liveRaf = 0;
  function liveRecompute() { if (liveRaf) return; liveRaf = requestAnimationFrame(() => { liveRaf = 0; recompute(); renderResults(); editor.draw(); }); }

  // ---------------------------------------------------------------- controls
  const controls = h('div', { class: 'st-controls' });
  const exSel = select([{ value: '', label: 'Load an example…' }, ...groupExamples()], '', id => {
    if (!id) return;
    store.replace(exampleModel(id)); exSel.value = '';
    editor.select(null); ui.fbdBody = -1; ui.mode = 0; editor.fit(); editor.draw();
  });
  const fileIn = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0]; if (!f) return;
    try { const m = normalize(JSON.parse(await f.text())); store.replace(m); editor.fit(); editor.draw(); } catch { alert('That file is not a valid structure.'); }
    fileIn.value = '';
  });
  const btn = (label, fn, title) => { const b = h('button', { type: 'button', class: 'btn sm', title: title || '' }, label); b.addEventListener('click', fn); return b; };
  const fileRow = h('div', { class: 'st-row' },
    btn('New', () => { if (store.model.nodes.length && !confirm('Start a new, empty structure? (Undo can bring it back.)')) return; store.replace(blankModel()); editor.select(null); editor.fitted = false; editor.fit(); editor.draw(); }, 'Start from an empty canvas'),
    btn('Save', () => downloadText('structure.json', JSON.stringify(store.model, null, 1), 'application/json'), 'Download this structure as a JSON file'),
    btn('Open', () => fileIn.click(), 'Open a structure JSON file'), fileIn);
  const sFile = section('Structure');
  sFile.body.append(exSel, fileRow, h('div', { class: 'hint' }, 'Draw with the tools on the canvas. Scroll to zoom, drag the background to pan. Hold Alt to place points off the grid.'));

  const sTool = section('Tool');
  const sSel = section('Selection');
  const sSec = section('Sections & materials', { collapsible: true, collapsed: true });
  const sAna = section('Analysis options', { collapsible: true, collapsed: true });
  controls.append(sFile.el, sTool.el, sSel.el, sSec.el, sAna.el);

  function renderPalette() {
    const t = editor.tool, b = sTool.body;
    b.replaceChildren();
    const titles = { select: 'Select & move', member: 'Draw members', node: 'Add nodes', support: 'Place supports', load: 'Add loads', delete: 'Delete' };
    sTool.el.querySelector('h3').textContent = 'Tool — ' + titles[t];
    if (t === 'select') b.append(h('div', { class: 'hint' }, 'Click a node, member, support or load to edit it below. Drag nodes to reshape the structure; results update live.'));
    if (t === 'node') b.append(h('div', { class: 'hint' }, 'Click empty space to add a node, or click a member to split it into two.'));
    if (t === 'delete') b.append(h('div', { class: 'hint' }, 'Click any item to delete it. Deleting a node removes its members.'));
    if (t === 'member') {
      b.append(segField('Member type', [{ value: 'frame', label: 'Beam / frame', title: 'Carries axial force, shear and bending.' }, { value: 'truss', label: 'Truss bar', title: 'Pinned at both ends: axial force only.' }, { value: 'cable', label: 'Cable', title: 'Tension only: goes slack in compression.' }], pal.member.type, v => { pal.member.type = v; renderPalette(); }));
      if (pal.member.type === 'frame') b.append(h('div', { class: 'st-row2' }, checkField('Hinge at start', pal.member.relA, v => { pal.member.relA = v; }, 'A moment-free pin at the first end of each new member.'), checkField('Hinge at end', pal.member.relB, v => { pal.member.relB = v; })));
      b.append(sectionPicker(store.model.defaults.sec, v => { store.model.defaults.sec = v; }), materialPicker(store.model.defaults.mat, v => { store.model.defaults.mat = v; }));
      b.append(h('div', { class: 'hint' }, 'Click to start, click again for each joint. Esc, right-click or double-click ends the chain. Clicking on a member joins to it.'));
    }
    if (t === 'support') {
      const p = pal.support;
      b.append(segField('Type', SUPPORTS, p.type, v => { p.type = v; renderPalette(); }));
      b.append(angleField('Surface angle', () => p.angle, v => { p.angle = v; }));
      if (p.type === 'contact') b.append(numField('Friction coefficient µ', null, () => p.mu, v => { p.mu = Math.max(0, v); }, { tip: 'Static friction coefficient. 0 = smooth (normal force only).' }));
      if (p.type === 'spring') b.append(numField('kx', 'kspring', () => p.kx, v => { p.kx = Math.max(0, v); }), numField('ky', 'kspring', () => p.ky, v => { p.ky = Math.max(0, v); }), numField('kθ', 'krot', () => p.kr, v => { p.kr = Math.max(0, v); }));
      b.append(h('div', { class: 'hint' }, 'Click a node to place it (replaces any support there). The angle tilts the support surface: 90° is a wall on the right, −90° a wall on the left, 180° a ceiling.'));
    }
    if (t === 'load') loadEditor(b, pal.load, true);
  }
  function angleField(label, get, set) {
    const f = numField(label, null, get, set, { suffix: '°', tip: 'Rotation of the support surface, counter-clockwise from horizontal ground.' });
    const quick = h('div', { class: 'st-quick' }, ...[0, 90, -90, 180, 30, 45].map(a => { const q = h('button', { type: 'button', class: 'btn sm ghost' }, a + '°'); q.addEventListener('click', () => { set(a); f.refresh(); }); return q; }));
    return h('div', {}, f, quick);
  }
  // load fields; palette=true edits the defaults for new loads, otherwise edits a model load and commits
  function loadEditor(b, L, palette, onCh = () => { }) {
    const ch = () => onCh();
    if (palette) b.append(selField('Load type', LOAD_KINDS, L.kind, v => { L.kind = v; renderPalette(); }));
    const k = L.kind;
    if (k === 'force' || k === 'point') {
      const mag = () => Math.hypot(L.fx, L.fy), ang = () => Math.atan2(L.fy, L.fx) * 180 / Math.PI;
      const fx = numField('Fx', 'force', () => L.fx, v => { L.fx = v; ch(); upd(); }), fy = numField('Fy', 'force', () => L.fy, v => { L.fy = v; ch(); upd(); });
      const fm = numField('Magnitude', 'force', mag, v => { const a = ang() * Math.PI / 180; L.fx = v * Math.cos(a); L.fy = v * Math.sin(a); ch(); upd(); });
      const fa = numField('Direction', null, ang, v => { const m = mag() || 1; L.fx = m * Math.cos(v * Math.PI / 180); L.fy = m * Math.sin(v * Math.PI / 180); ch(); upd(); }, { suffix: '°', tip: 'Measured counter-clockwise from +x. −90° points straight down.' });
      const upd = () => { fx.refresh(); fy.refresh(); fm.refresh(); fa.refresh(); };
      b.append(h('div', { class: 'st-grid2' }, fx, fy, fm, fa));
      if (k === 'point' && !palette) b.append(numField('Position along member', null, () => L.t * 100, v => { L.t = Math.max(0, Math.min(100, v)) / 100; ch(); }, { suffix: '%' }));
    }
    if (k === 'moment' || k === 'mpoint') {
      b.append(numField('Moment M', 'moment', () => L.m, v => { L.m = v; ch(); }, { tip: 'Counter-clockwise positive.' }));
      if (k === 'mpoint' && !palette) b.append(numField('Position along member', null, () => L.t * 100, v => { L.t = Math.max(0, Math.min(100, v)) / 100; ch(); }, { suffix: '%' }));
    }
    if (k === 'dist') {
      b.append(selField('Direction', DIRS, L.dir || 'gy', v => { L.dir = v; ch(); }, 'Global loads act in a fixed direction (gravity, wind). "Per projection" spreads the load over the horizontal (or vertical) footprint, as for snow on a roof. Positive values point along +x / +y (or the member\'s local +y, to its left).'));
      b.append(h('div', { class: 'st-grid2' },
        numField('w at start', 'dist', () => L.w1, v => { L.w1 = v; ch(); }), numField('w at end', 'dist', () => L.w2, v => { L.w2 = v; ch(); }),
        numField('From', null, () => (L.t0 ?? 0) * 100, v => { L.t0 = Math.max(0, Math.min(100, v)) / 100; ch(); }, { suffix: '%' }), numField('To', null, () => (L.t1 ?? 1) * 100, v => { L.t1 = Math.max(0, Math.min(100, v)) / 100; ch(); }, { suffix: '%' })));
      if (palette) b.append(h('div', { class: 'st-quick' }, ...[['Uniform', () => { L.w2 = L.w1; }], ['Triangle ↗', () => { L.w2 = L.w1 || L.w2; L.w1 = 0; }], ['Triangle ↘', () => { L.w1 = L.w1 || L.w2; L.w2 = 0; }]].map(([t, f]) => { const q = h('button', { type: 'button', class: 'btn sm ghost' }, t); q.addEventListener('click', () => { f(); renderPalette(); }); return q; })));
    }
    if (k === 'thermal') {
      b.append(numField('Uniform ΔT', 'dtemp', () => L.dT, v => { L.dT = v; ch(); }, { tip: 'Temperature rise of the whole member. Free members just get longer; restrained ones develop axial force N = −EAαΔT.' }));
      b.append(numField('ΔT top − bottom', 'dtemp', () => L.dTg, v => { L.dTg = v; ch(); }, { tip: 'Temperature difference across the depth (top = member\'s local +y side). Makes the member curve: κ = −α·ΔT/h.' }));
    }
    if (palette) b.append(h('div', { class: 'hint' }, k === 'force' || k === 'moment' ? 'Click a node to apply it (clicking a member adds it there as a point load).' : 'Click a member to apply it.'));
  }

  function sectionPicker(value, onChange) {
    return selField('Section', store.model.sections.map(s => ({ value: s.id, label: s.name })), value, onChange, 'Edit or add sections under "Sections & materials".');
  }
  function materialPicker(value, onChange) {
    const opts = [...(store.model.materials || []).map(m => ({ value: m.id, label: m.name + ' (custom)' })), ...MATERIALS.map(m => ({ value: m.id, label: m.name }))];
    return selField('Material', opts, value, onChange);
  }

  function renderSelection() {
    const b = sSel.body; b.replaceChildren();
    const mdl = store.model, sel = editor.sel;
    const commitEdit = () => { store.changed(); };
    const del = () => { editor.deleteHit(sel); };
    if (!sel) { b.append(h('div', { class: 'hint' }, `${mdl.nodes.length} nodes · ${mdl.members.length} members · ${mdl.supports.length} supports · ${mdl.loads.length} loads. Click something on the canvas to edit it.`)); return; }
    const head = (title) => h('div', { class: 'st-selhead' }, h('b', {}, title), btn('Delete', del));
    // each edit records history once per field change
    const edit = fn => v => { store.commit(); fn(v); commitEdit(); };
    if (sel.kind === 'node') {
      const i = mdl.nodes.findIndex(n => n.id === sel.id), n = mdl.nodes[i]; if (!n) return;
      b.append(head(`Node ${letters(i)}`), h('div', { class: 'st-grid2' },
        numField('x', 'len', () => n.x, edit(v => { n.x = v; })), numField('y', 'len', () => n.y, edit(v => { n.y = v; }))),
        numField('Lumped mass', 'mass', () => n.mass || 0, edit(v => { n.mass = Math.max(0, v); }), { tip: 'Extra point mass at this node, used for vibration modes (an engine, a fuel tank, a payload).' }));
      const sp = mdl.supports.find(s => s.node === n.id);
      b.append(h('div', { class: 'hint' }, sp ? `Support: ${sp.type}. Click the support glyph to edit it.` : 'No support. Use the Support tool to add one.'));
    } else if (sel.kind === 'member') {
      const i = mdl.members.findIndex(m => m.id === sel.id), m = mdl.members[i]; if (!m) return;
      const a = store.node(m.a), bb = store.node(m.b), L = Math.hypot(bb.x - a.x, bb.y - a.y), ang = Math.atan2(bb.y - a.y, bb.x - a.x) * 180 / Math.PI;
      b.append(head(`Member ${i + 1} (${letters(mdl.nodes.indexOf(a))}→${letters(mdl.nodes.indexOf(bb))})`),
        h('div', { class: 'hint' }, `L = ${units.fmt('len', L, 5)} · angle ${ang.toFixed(2)}°`),
        segField('Type', [{ value: 'frame', label: 'Beam / frame' }, { value: 'truss', label: 'Truss bar' }, { value: 'cable', label: 'Cable' }], m.type || 'frame', edit(v => { m.type = v; renderSelection(); })));
      if ((m.type || 'frame') === 'frame') b.append(h('div', { class: 'st-row2' }, checkField('Hinge at start', m.relA, edit(v => { m.relA = v; })), checkField('Hinge at end', m.relB, edit(v => { m.relB = v; }))));
      b.append(sectionPicker(m.sec, edit(v => { m.sec = v; })), materialPicker(m.mat, edit(v => { m.mat = v; })));
      const r = res.static?.ok && res.static.members.find(x => x.id === m.id);
      if (r) b.append(h('div', { class: 'cf-res st-mini' }, ...[
        ['N range', `${units.num('force', r.ext.N.min, 4)} … ${units.fmt('force', r.ext.N.max, 4)}`], ['|V| max', units.fmt('force', r.ext.V.abs, 4)], ['|M| max', units.fmt('moment', r.ext.M.abs, 4)],
        ['σ (von Mises) max', units.fmt('stress', r.stress.vmMax, 4)], ['Utilisation σ/σy', (r.stress.util * 100).toFixed(1) + '%'], ['Sag (rel. chord)', units.fmt('disp', r.sag.abs, 3)]].map(([k, v]) => h('div', { class: 'r' }, h('span', {}, k), h('span', {}, v)))),
        btn('Plot along this member', () => { ui.plotMember = m.id; renderResults(); plotCard.scrollIntoView({ behavior: 'smooth', block: 'center' }); }));
    } else if (sel.kind === 'support') {
      const sp = mdl.supports.find(s => s.node === sel.id); if (!sp) return;
      const i = mdl.nodes.findIndex(n => n.id === sp.node);
      b.append(head(`Support at ${letters(i)}`), segField('Type', SUPPORTS, sp.type, edit(v => { sp.type = v; if (v === 'contact' && sp.mu === undefined) sp.mu = 0.3; if (v === 'spring') { sp.kx ??= 1e6; sp.ky ??= 1e6; sp.kr ??= 0; } renderSelection(); })),
        angleField('Surface angle', () => sp.angle || 0, edit(v => { sp.angle = v; })));
      if (sp.type === 'contact') b.append(numField('Friction coefficient µ', null, () => sp.mu || 0, edit(v => { sp.mu = Math.max(0, v); })));
      if (sp.type === 'spring') b.append(numField('kx', 'kspring', () => sp.kx || 0, edit(v => { sp.kx = Math.max(0, v); })), numField('ky', 'kspring', () => sp.ky || 0, edit(v => { sp.ky = Math.max(0, v); })), numField('kθ', 'krot', () => sp.kr || 0, edit(v => { sp.kr = Math.max(0, v); })));
      if (['fixed', 'pin', 'roller', 'slider'].includes(sp.type)) b.append(h('div', { class: 'st-grid2' },
        numField('Settlement ∥', 'disp', () => sp.dx || 0, edit(v => { sp.dx = v; }), { tip: 'Prescribed movement along the support surface (if restrained).' }),
        numField('Settlement ⊥', 'disp', () => sp.dy || 0, edit(v => { sp.dy = v; }), { tip: 'Prescribed movement normal to the surface, e.g. a foundation sinking (negative = down for flat ground).' })));
    } else if (sel.kind === 'load') {
      const L = mdl.loads.find(l => l.id === sel.id); if (!L) return;
      const where = L.node ? `node ${letters(mdl.nodes.findIndex(n => n.id === L.node))}` : `member ${mdl.members.findIndex(m => m.id === L.member) + 1}`;
      b.append(head(`${LOAD_KINDS.find(k => k.value === L.kind)?.label.replace(/ at a node| on a member/, '')} on ${where}`));
      const snap = JSON.stringify(L);
      let committed = false;
      loadEditor(b, L, false, () => { if (!committed) { store.past.push(JSON.stringify({ ...store.model, loads: store.model.loads.map(l => (l.id === L.id ? JSON.parse(snap) : l)) })); store.future = []; committed = true; } store.changed(); });
      const vary = h('label', { class: 'toggle' }, h('span', { class: 'tl' }, 'Increase this load in friction checks', info('The friction/tipping check finds how far this load can grow (others stay fixed) before something slips, tips or a cable goes slack.')));
      const cb = h('input', { type: 'checkbox' }); cb.checked = mdl.settings.scaleLoad === L.id;
      cb.addEventListener('change', () => { store.commit(); mdl.settings.scaleLoad = cb.checked ? L.id : 'all'; store.changed(); });
      vary.append(cb, h('span', { class: 'sw' })); b.append(vary);
    }
  }

  // ---- sections & materials manager
  let secEdit = null;
  function renderSections() {
    const b = sSec.body; b.replaceChildren();
    const mdl = store.model;
    if (!secEdit || !mdl.sections.find(s => s.id === secEdit)) secEdit = mdl.sections[0]?.id;
    const s = mdl.sections.find(x => x.id === secEdit);
    b.append(h('div', { class: 'st-row' }, select(mdl.sections.map(x => ({ value: x.id, label: x.name })), secEdit, v => { secEdit = v; renderSections(); }),
      btn('New', () => { store.commit(); const id = store.id('s'); mdl.sections.push({ id, name: 'Section ' + mdl.sections.length + 1, shape: 'rect', dims: { ...SHAPES.rect.def } }); secEdit = id; store.changed(); renderSections(); }, 'Add a section'),
      btn('Copy', () => { store.commit(); const id = store.id('s'); mdl.sections.push({ ...JSON.parse(JSON.stringify(s)), id, name: s.name + ' copy' }); secEdit = id; store.changed(); renderSections(); })));
    if (!s) return;
    const nameIn = h('input', { class: 'text-input', value: s.name });
    nameIn.addEventListener('change', () => { store.commit(); s.name = nameIn.value || s.name; store.changed(); renderSections(); renderPalette(); });
    b.append(h('label', { class: 'st-field st-field-sel' }, h('span', { class: 'st-lab' }, 'Name'), nameIn));
    b.append(selField('Shape', Object.entries(SHAPES).map(([value, x]) => ({ value, label: x.label })), s.shape, v => { store.commit(); s.shape = v; s.dims = { ...SHAPES[v].def }; store.changed(); renderSections(); }));
    const q = { A: 'area', I: 'inertia', J: 'inertia' };
    b.append(h('div', { class: 'st-grid2' }, ...SHAPES[s.shape].fields.map(([k, lab]) => numField(lab, q[k] || 'dim', () => s.dims[k], v => { if (!(v > 0)) return; store.commit(); s.dims[k] = v; store.changed(); renderSections(); }))));
    try {
      const p = sectionProps(s);
      b.append(h('div', { class: 'cf-res st-mini' }, ...[['A', units.fmt('area', p.A, 4)], ['I', units.fmt('inertia', p.Ix, 4)], ['S = I/c', units.fmt('smod', p.Sx, 4)], ['Depth', units.fmt('dim', p.h, 4)]].map(([k, v]) => h('div', { class: 'r' }, h('span', {}, k), h('span', {}, v)))));
    } catch { }
    b.append(h('div', { class: 'hint' }, 'The Sections tab shows full properties, stress distributions and the shear centre.'));
    // custom materials
    b.append(h('div', { class: 'st-lab', style: { marginTop: '12px' } }, 'Custom materials'));
    for (const m of mdl.materials) {
      const nameM = h('input', { class: 'text-input', value: m.name });
      nameM.addEventListener('change', () => { store.commit(); m.name = nameM.value || m.name; store.changed(); renderSections(); renderPalette(); });
      b.append(h('div', { class: 'st-matbox' }, nameM, h('div', { class: 'st-grid2' },
        numField('E', 'modulus', () => m.E, v => { store.commit(); m.E = v; store.changed(); }), numField('ν', null, () => m.nu, v => { store.commit(); m.nu = v; store.changed(); }),
        numField('ρ', 'density', () => m.rho, v => { store.commit(); m.rho = v; store.changed(); }), numField('σ yield', 'stress', () => m.fy, v => { store.commit(); m.fy = v; store.changed(); }),
        numField('α', 'alpha', () => m.alpha, v => { store.commit(); m.alpha = v; store.changed(); }))));
    }
    b.append(btn('Add custom material', () => { store.commit(); mdl.materials.push({ ...MATERIALS[0], id: store.id('mat'), name: 'My material' }); store.changed(); renderSections(); }));
  }

  function renderAnalysisOpts() {
    const b = sAna.body; b.replaceChildren();
    const mdl = store.model;
    b.append(checkField('Include self weight', mdl.settings.selfWeight, v => { store.commit(); mdl.settings.selfWeight = v; store.changed(); }, 'Adds each member\'s weight (ρ·g·A per length) as a distributed load.'));
    b.append(numField('Gravity g', 'accel', () => mdl.settings.g, v => { store.commit(); mdl.settings.g = v; store.changed(); }));
    const loadOpts = [{ value: 'all', label: 'All loads together' }, ...mdl.loads.filter(l => l.kind !== 'thermal').map(l => ({ value: l.id, label: describeLoad(l) }))];
    b.append(selField('Friction check: increase', loadOpts, mdl.settings.scaleLoad || 'all', v => { store.commit(); mdl.settings.scaleLoad = v; store.changed(); }, 'For contacts and cables: which load grows until something slips, tips or goes slack. The others stay fixed.'));
    b.append(checkField('Labels', ui.labels, v => { ui.labels = v; editor.draw(); }));
    b.append(checkField('Draw M on the tension side', ui.mTension, v => { ui.mTension = v; editor.draw(); }, 'Off: positive (sagging) moment drawn on the member\'s +y side, as in most US textbooks. On: drawn on the tension side, the European convention.'));
    b.append(checkField('Animate deflections and modes', ui.animate, v => { ui.animate = v; editor.draw(); }));
  }
  function describeLoad(l) {
    const mdl = store.model, nl = id => letters(mdl.nodes.findIndex(n => n.id === id)), ml = id => mdl.members.findIndex(m => m.id === id) + 1;
    if (l.kind === 'force') return `Force at ${nl(l.node)} (${units.fmt('force', Math.hypot(l.fx, l.fy), 3)})`;
    if (l.kind === 'moment') return `Moment at ${nl(l.node)}`;
    if (l.kind === 'dist') return `Distributed on member ${ml(l.member)}`;
    if (l.kind === 'point') return `Point load on member ${ml(l.member)}`;
    if (l.kind === 'mpoint') return `Moment on member ${ml(l.member)}`;
    return `Load ${l.id}`;
  }

  // ---------------------------------------------------------------- main area
  const main = h('div', { class: 'cf-main-inner st-main' });
  const viewTabs = h('div', { class: 'tabs tabs-wrap st-views', role: 'tablist' });
  const viewBtns = {};
  for (const v of VIEWS) { const b = h('button', { type: 'button', role: 'tab' }, v.label); b.addEventListener('click', () => setView(v.id)); viewTabs.append(b); viewBtns[v.id] = b; }
  const viewExtra = h('div', { class: 'st-viewextra' });
  function setView(v) { ui.view = v; for (const [k, b] of Object.entries(viewBtns)) b.classList.toggle('on', k === v); renderViewExtra(); editor.draw(); }
  function renderViewExtra() {
    const v = ui.view, e = viewExtra; e.replaceChildren();
    const rangeCtl = (label, key, min, max) => {
      const r = h('input', { type: 'range', min: Math.log10(min), max: Math.log10(max), step: 0.01, value: Math.log10(ui[key]) });
      const p = () => r.style.setProperty('--fill', ((r.value - r.min) / (r.max - r.min) * 100) + '%'); p();
      r.addEventListener('input', () => { ui[key] = 10 ** +r.value; p(); editor.draw(); });
      return h('label', { class: 'st-range' }, h('span', {}, label), r);
    };
    if (['N', 'V', 'M'].includes(v)) e.append(rangeCtl('Scale', 'diagScale', 0.2, 5));
    if (['defl', 'modes', 'buckling'].includes(v)) e.append(rangeCtl('Exaggeration', 'deflScale', 0.1, 10));
    if (v === 'modes' || v === 'buckling') {
      const r = v === 'modes' ? res.modal : res.buckling;
      if (r?.ok && r.modes.length) e.append(select(r.modes.map((m, k) => ({ value: k, label: v === 'modes' ? `Mode ${k + 1} — ${fmtNum(m.f, 4)} Hz` : `Mode ${k + 1} — λ = ${fmtNum(m.lambda, 4)}` })), Math.min(ui.mode, r.modes.length - 1), x => { ui.mode = +x; editor.draw(); }, { class: 'select st-sel-sm' }));
      else e.append(h('span', { class: 'hint' }, r ? '' : 'Computing…'));
    }
    if (v === 'fbd') {
      const S = res.statics;
      if (S?.x && S.T.bodies.length > 1) e.append(select([{ value: -1, label: 'Whole structure' }, ...S.T.bodies.map((B, k) => ({ value: k, label: `Isolate body ${k + 1} (members ${B.members.map(j => S.T.P.members[j].id).map(id => store.model.members.findIndex(m => m.id === id) + 1).join(', ')})` }))], ui.fbdBody, x => { ui.fbdBody = +x; editor.draw(); }, { class: 'select st-sel-sm' }));
    }
  }
  const status = h('div', { class: 'st-status' });
  const metrics = metricsGrid();
  const stepsBox = h('div', { class: 'st-steps' });
  const stepsCard = card('Equilibrium, step by step', 'The free-body equations written the way you would by hand: whole structure first, then individual bodies and joints, each time choosing an equation with a single unknown (moments are taken about points where other unknowns act).', stepsBox);
  const insightsBox = h('div', {});
  const insightsCard = card('What the results say', null, insightsBox);
  const plotHost = h('div', { class: 'st-plot' });
  const plotSel = h('div', { class: 'row', style: { gap: '6px' } });
  const plotCard = h('div', { class: 'plot-card' }, h('div', { class: 'plot-head' }, h('h4', {}, 'Along a member'), plotSel), plotHost);
  const plot = new Plot(plotHost, { xlabel: 'x', ylabel: '', legend: true });
  const tableTabs = h('div', { class: 'tabs st-ttabs' });
  const tableBox = h('div', {});
  const csvBtn = h('button', { type: 'button', class: 'btn sm' }, 'CSV');
  const tableCard = h('div', { class: 'plot-card' }, h('div', { class: 'plot-head' }, h('h4', {}, 'Results tables'), h('div', { class: 'row', style: { gap: '8px' } }, tableTabs, csvBtn)), tableBox);
  const tabsDef = [['reactions', 'Reactions'], ['members', 'Members'], ['nodes', 'Displacements'], ['modes', 'Modes & buckling']];
  const tBtns = {};
  for (const [id, lab] of tabsDef) { const b = h('button', { type: 'button' }, lab); b.addEventListener('click', () => { ui.table = id; renderTables(); }); tableTabs.append(b); tBtns[id] = b; }
  let lastTable = null;
  csvBtn.addEventListener('click', () => { if (lastTable) downloadText(`structure-${ui.table}.csv`, toCSV(lastTable.head, lastTable.rows)); });

  main.append(h('div', { class: 'st-viewbar' }, viewTabs, viewExtra), editor.stage, status, metrics.el,
    h('div', { class: 'cf-grid2' }, stepsCard, insightsCard), plotCard, tableCard);

  // ---------------------------------------------------------------- results rendering
  function renderResults() {
    const R = res.static, S = res.statics, mdl = store.model;
    if (!mdl.members.length) {
      status.innerHTML = '<span class="hint">Draw a structure to begin: pick the <b>Member</b> tool, click to place joints, then add supports and loads — or load an example.</span>';
      metrics.set([]); stepsBox.replaceChildren(); insightsList(insightsBox, []); tableBox.replaceChildren(); plot.setData({ series: [] }); return;
    }
    // determinacy line
    const parts = [];
    if (S) {
      const cls = { determinate: ['g', 'Statically determinate'], indeterminate: ['i', `Statically indeterminate (degree ${S.degree})`], unstable: ['b', 'Unstable — a mechanism'], 'unstable-indeterminate': ['b', 'Unstable — part of it is a mechanism'] }[S.classification];
      parts.push(`<span class="st-pill ${cls[0]}">${cls[1]}</span>`);
      const uc = S.unknownCount;
      parts.push(`<span class="hint">Unknowns ${S.nu} = ${uc.reactions} reaction${uc.reactions === 1 ? '' : 's'}${uc.members ? ` + ${uc.members} member force${uc.members === 1 ? '' : 's'}` : ''}${uc.pins ? ` + ${uc.pins} pin force components` : ''} · Equations ${S.ne} = 3 × ${S.bodies} bod${S.bodies === 1 ? 'y' : 'ies'}${S.joints ? ` + 2 × ${S.joints} joint${S.joints === 1 ? '' : 's'}` : ''} · rank ${S.rank}</span>`);
    }
    if (R?.ok) {
      const t = R.totals, sc = Math.max(1, Math.abs(t.Fx), Math.abs(t.Fy));
      const resid = Math.max(Math.abs(t.Fx + t.Rx), Math.abs(t.Fy + t.Ry)) / sc;
      parts.push(`<span class="hint">ΣF check: ${resid < 1e-8 ? '✓ balanced' : resid.toExponential(1)}</span>`);
    }
    status.innerHTML = parts.join(' ');
    // metrics
    const ms = [];
    if (R?.ok) {
      let mM = { v: 0 }, mV = { v: 0 }, mN = { v: 0 }, mU = { v: 0 };
      R.members.forEach((m, k) => { if (m.ext.M.abs > mM.v) mM = { v: m.ext.M.abs, k }; if (m.ext.V.abs > mV.v) mV = { v: m.ext.V.abs, k }; const n = Math.max(Math.abs(m.ext.N.min), Math.abs(m.ext.N.max)); if (n > mN.v) mN = { v: n, k }; if (m.stress.util > mU.v) mU = { v: m.stress.util, k, s: m.stress.vmMax }; });
      const mem = k => `member ${k + 1}`;
      ms.push({ k: 'Max |M|', v: units.fmt('moment', mM.v, 4), s: mM.v ? mem(mM.k) : '' });
      ms.push({ k: 'Max |V|', v: units.fmt('force', mV.v, 4), s: mV.v ? mem(mV.k) : '' });
      ms.push({ k: 'Max |N|', v: units.fmt('force', mN.v, 4), s: mN.v ? mem(mN.k) : '' });
      ms.push({ k: 'Max deflection', v: units.fmt('disp', R.maxDisp.v, 3), s: R.maxDisp.member ? `member ${mdl.members.findIndex(m => m.id === R.maxDisp.member) + 1}` : '' });
      ms.push({ k: 'Peak stress', v: units.fmt('stress', mU.s || 0, 4), s: `${(mU.v * 100).toFixed(0)}% of yield`, cls: mU.v > 1 ? 'bad' : '', tip: 'Largest von Mises stress: axial + bending at the extreme fibres, or axial + shear at the neutral axis.' });
      const bk = res.buckling;
      ms.push({ k: 'Buckling factor λcr', v: bk?.ok ? fmtNum(bk.modes[0]?.lambda, 4) : bk?.error === 'no-compression' ? '—' : bk ? '—' : '…', s: bk?.ok ? (bk.modes[0]?.lambda < 1 ? 'buckles under these loads' : 'loads × λ cause buckling') : bk?.error === 'no-compression' ? 'nothing in compression' : '', tip: 'Linear (eigenvalue) buckling of the whole structure, members subdivided. Loads multiplied by λ make the structure buckle.' });
      const md = res.modal;
      ms.push({ k: '1st natural frequency', v: md?.ok && md.modes[0] ? fmtNum(md.modes[0].f, 4) + ' Hz' : md ? '—' : '…', s: md?.ok ? `${md.modes.length} modes found` : '' });
    } else if (R && !R.ok) ms.push({ k: 'Stiffness analysis', v: R.error === 'mechanism' ? 'Mechanism' : 'Not solved', cls: 'bad', s: R.error === 'mechanism' && R.dof ? `free ${R.dof.text}${R.dof.node ? ' at ' + letters(mdl.nodes.findIndex(n => n.id === R.dof.node)) : ''}` : '' });
    if (S?.limit?.status === 'optimal' || S?.limit?.status === 'unbounded') ms.push({ k: 'Friction/tipping factor', v: S.limit.status === 'unbounded' ? '∞' : fmtNum(S.limit.lambda, 4), s: S.limit.lambda >= 1 ? 'holds' : 'moves', cls: S.limit.lambda < 1 ? 'bad' : '' });
    metrics.set(ms);
    renderSteps();
    renderInsights();
    renderPlot();
    renderTables();
    renderViewExtra();
    if (editor.sel) renderSelection();
  }

  // equation text
  function fmtEq(T, S, solveFor) {
    const { terms, c, kind } = T, U = S.S.unknowns;
    const parts = [];
    const coefStr = (a, u) => {
      if (kind === 'M' && u.kind === 'F') return units.num('len', a, 4);
      return Math.abs(Math.abs(a) - 1) < 1e-12 ? '' : fmtNum(a, 4);
    };
    for (const t of terms) {
      const u = U[t.u];
      const val = t.known ? `(${units.num(u.kind === 'M' ? 'moment' : 'force', t.value, 4)})` : `<b>${sub(u.name)}</b>`;
      const cs = coefStr(Math.abs(t.coef), u);
      parts.push({ sign: t.coef < 0 ? '−' : '+', txt: cs ? `${cs}·${val}` : val });
    }
    if (Math.abs(c) > 0) parts.push({ sign: c < 0 ? '−' : '+', txt: units.num(kind === 'M' ? 'moment' : 'force', Math.abs(c), 4) });
    if (!parts.length) return '0 = 0';
    return parts.map((p, i) => (i === 0 ? (p.sign === '−' ? '−' : '') : ` ${p.sign} `) + p.txt).join('') + ' = 0';
    void solveFor;
  }
  const sub = name => name.replace(/_([A-Za-z0-9]+)/g, '<sub>$1</sub>');
  const valStr = (S, j, v) => units.fmt(S.S.unknowns[j].kind === 'M' ? 'moment' : 'force', v, 4);

  function renderSteps() {
    const S = res.statics, R = res.static, box = stepsBox; box.replaceChildren();
    if (!S) { box.append(h('div', { class: 'hint' }, 'No equilibrium analysis.')); return; }
    const intro = h('div', { class: 'hint st-conv' }, `Sign convention: forces positive along +x, +y; moments counter-clockwise positive. Lever arms in ${units.label('len')}, forces in ${units.label('force')}, moments in ${units.label('moment')}.`);
    box.append(intro);
    if (S.classification !== 'determinate' || !S.steps) {
      const why = S.unstable
        ? (S.consistent ? 'The supports cannot resist every possible load (it is a mechanism), but this particular load pattern happens to be in equilibrium.' : 'The supports and connections cannot hold these loads: the equilibrium equations have no solution. Add or change a support (the red dashed shape shows how it would move).')
        : `There are more unknowns (${S.nu}) than independent equilibrium equations (${S.rank}), so statics alone cannot find them: ${S.degree} extra condition${S.degree > 1 ? 's' : ''} of compatibility (how the members deform) are needed. The stiffness method below supplies them — its reactions depend on EI and EA.`;
      box.append(h('div', { class: 'st-why' }, why));
      if (R?.ok) {
        const rows = R.reactions.map(r => { const i = store.model.nodes.findIndex(n => n.id === r.node); return [letters(i), r.type, units.num('force', r.Rx, 4), units.num('force', r.Ry, 4), Math.abs(r.Mz) > 0 ? units.num('moment', r.Mz, 4) : '—']; });
        box.append(h('div', { class: 'st-lab', style: { margin: '8px 0 4px' } }, 'Reactions from the stiffness method'), table(['Node', 'Support', `Rx (${units.label('force')})`, `Ry (${units.label('force')})`, `M (${units.label('moment')})`], rows));
        // equilibrium check of the whole structure
        const t = R.totals;
        box.append(h('div', { class: 'cf-steps', style: { marginTop: '8px' } }, `Check, whole structure:\nΣFx = ${units.num('force', t.Fx, 4)} + ${units.num('force', t.Rx, 4)} = ${units.num('force', t.Fx + t.Rx, 3)}\nΣFy = ${units.num('force', t.Fy, 4)} + ${units.num('force', t.Ry, 4)} = ${units.num('force', t.Fy + t.Ry, 3)}\nΣM_O = ${units.num('moment', t.Mo, 4)} + ${units.num('moment', t.Rm, 4)} = ${units.num('moment', t.Mo + t.Rm, 3)}`));
      }
      return;
    }
    const list = h('div', { class: 'st-steplist' });
    let lastGroup = null, n = 0;
    for (const st of S.steps) {
      if (st.all) {
        list.append(h('div', { class: 'st-step' }, h('div', { class: 'st-eq' }, `Solve the remaining ${st.rest.length} equations together:`), h('div', { class: 'st-ans', html: st.rest.map(j => `${sub(S.S.unknowns[j].name)} = ${valStr(S, j, S.x[j])}`).join('<br>') })));
        continue;
      }
      if (st.eq.group.label !== lastGroup) { lastGroup = st.eq.group.label; list.append(h('div', { class: 'st-group' }, 'Free body: ' + lastGroup)); }
      n++;
      if (st.simultaneous) {
        list.append(h('div', { class: 'st-step' }, h('span', { class: 'st-n' }, n),
          h('div', {}, h('div', { class: 'st-eq', html: `${st.eq.name}: ${fmtEq(st.terms, S)}` }), h('div', { class: 'st-eq', html: `${st.eq2.name}: ${fmtEq(st.terms2, S)}` }),
            h('div', { class: 'st-ans', html: `⇒ ${sub(S.S.unknowns[st.solveFor[0]].name)} = ${valStr(S, st.solveFor[0], st.value)}, ${sub(S.S.unknowns[st.solveFor[1]].name)} = ${valStr(S, st.solveFor[1], st.value2)}` }))));
      } else {
        const j = st.solveFor[0], u = S.S.unknowns[j];
        const isMem = u.role === 'member' || u.role === 'cable', zero = Math.abs(st.value) < 1e-9 * Math.max(1, ...S.x.map(Math.abs));
        const dirNote = zero ? (isMem ? ' <span class="hint">(zero-force member)</span>' : '') : u.kind === 'F' && st.value < 0 ? ` <span class="hint">(acts opposite to the assumed direction${isMem ? ': compression' : ''})</span>` : isMem ? ' <span class="hint">(tension)</span>' : '';
        list.append(h('div', { class: 'st-step' }, h('span', { class: 'st-n' }, n),
          h('div', {}, h('div', { class: 'st-eq', html: `${st.eq.name}: ${fmtEq(st.terms, S)}` }), h('div', { class: 'st-ans', html: `⇒ ${sub(u.name)} = ${valStr(S, j, st.value)}${dirNote}` }))));
      }
    }
    box.append(list);
    if (S.lost?.length) box.append(h('div', { class: 'st-why' }, `A moment applied at a pinned joint (${S.lost.join(', ')}) cannot be carried there and was ignored.`));
  }

  function renderInsights() {
    const R = res.static, S = res.statics, mdl = store.model, out = [];
    const nl = i => letters(i);
    if (!mdl.supports.length) out.push({ type: 'w', t: 'No supports yet', d: 'Pick the Support tool (the triangle) and click a node. A simple beam needs a pin at one end and a roller at the other.' });
    if (R && !R.ok) {
      if (R.error === 'mechanism') out.push({ type: 'b', t: 'The structure is a mechanism', d: `Nothing stops ${R.dof?.text || 'some motion'}${R.dof?.node ? ' at node ' + nl(mdl.nodes.findIndex(n => n.id === R.dof.node)) : ''}. The red dashed shape shows how it can move. Add a support, make a joint rigid (remove a hinge), or add a bracing member.` });
      else if (R.error === 'zero-length') out.push({ type: 'b', t: 'Zero-length member', d: 'Two nodes of a member coincide. Delete it or move a node.' });
      else if (R.error === 'exception') out.push({ type: 'b', t: 'Analysis failed', d: R.msg || '' });
    }
    if (S) {
      if (S.classification === 'determinate') out.push({ type: 'g', t: 'Statically determinate', d: 'Equilibrium alone gives every reaction and internal force, so they do not depend on the members\' stiffness. Changing the section changes deflections and stresses but not the forces.' });
      if (S.classification === 'indeterminate') out.push({ type: 'i', t: `Indeterminate to degree ${S.degree}`, d: 'Redundant supports or members share the load according to their stiffness. Stiffer paths attract more force; support settlements and temperature changes now cause stresses too.' });
      if (S.unstable && S.consistent) out.push({ type: 'w', t: 'Unstable but balanced', d: 'This exact load pattern is in equilibrium, but any other load (even a tiny sideways one) would move the structure.' });
      const lim = S.limit;
      if (lim) {
        const what = mdl.settings.scaleLoad && mdl.settings.scaleLoad !== 'all' ? describeLoad(mdl.loads.find(l => l.id === mdl.settings.scaleLoad) || {}) : 'all loads';
        const hasContact = mdl.supports.some(sp => sp.type === 'contact');
        if (lim.status === 'unbounded') out.push({ type: 'g', t: `${hasContact ? 'Contacts' : 'Cables'} hold for any size of ${what === 'all loads' ? 'the loads' : what}`, d: hasContact ? 'The geometry is self-locking: friction can always balance this load pattern, however large.' : 'Every cable stays in tension for this load pattern, whatever its size.' });
        else if (lim.status === 'infeasible') out.push({ type: 'b', t: 'It cannot stand even without the increased load', d: 'The fixed loads alone already make it slide, tip or slacken a cable. Increase friction, widen the base or move the load.' });
        else if (lim.status === 'optimal') {
          const desc = lim.mech.map(m => m.kind === 'lift' ? `lifts off at ${nl(m.node)} (tips about the other contacts)` : m.kind === 'slip' ? `slips at ${nl(m.node)}` : m.kind === 'slack' ? `cable ${m.member + 1} goes slack` : `slides at smooth contact ${nl(m.node)}`).join(', ');
          const ok = lim.lambda >= 1;
          out.push({ type: ok ? 'g' : 'b', t: ok ? `Holds — ${what} can grow ×${fmtNum(lim.lambda, 3)} before it moves` : `Moves — it can only hold ${(lim.lambda * 100).toFixed(1)}% of ${what}`, d: `At the limit it ${desc || 'starts to move'}. (Rigid-body limit analysis: the largest load for which equilibrium is possible with N ≥ 0, |F| ≤ µN and cables in tension.)` });
        }
      }
      if (S.checks) for (const c of S.checks) {
        if (c.node !== undefined && c.lift) out.push({ type: 'b', t: `Contact ${nl(c.node)} would need to pull`, d: 'The normal force came out negative: the body lifts off here.' });
        else if (c.node !== undefined && isFinite(c.muReq) && c.N > 0) out.push({ type: c.slip ? 'b' : 'i', t: `Contact ${nl(c.node)}: friction needed µ = ${fmtNum(c.muReq, 3)}`, d: `Available µ = ${c.mu}. N = ${units.fmt('force', c.N, 4)}, F = ${units.fmt('force', Math.abs(c.F), 4)}.` + (c.slip ? ' It slips.' : '') });
      }
    }
    if (R?.ok) {
      const over = R.members.filter(m => m.stress.util > 1);
      if (over.length) out.push({ type: 'b', t: `${over.length} member${over.length > 1 ? 's' : ''} above yield`, d: `Members ${over.map(m => mdl.members.findIndex(x => x.id === m.id) + 1).join(', ')} exceed the material yield stress. Use a bigger section or a stronger material.` });
      const buck = R.members.filter(m => m.stress.eulerUtil > 0.5 && m.type !== 'cable');
      for (const m of buck.slice(0, 3)) {
        const k = mdl.members.findIndex(x => x.id === m.id) + 1;
        out.push({ type: m.stress.eulerUtil > 1 ? 'b' : 'w', t: `Member ${k}: compression ${(m.stress.eulerUtil * 100).toFixed(0)}% of its Euler load`, d: `P_cr = π²EI/L² = ${units.fmt('force', m.stress.Pcr, 4)} for a pin-ended member (slenderness L/r = ${m.stress.slenderness.toFixed(0)}). Its real end conditions are in the global buckling analysis.` });
      }
      const slack = R.members.filter(m => m.slack);
      if (slack.length) out.push({ type: 'w', t: 'Slack cable', d: `Cable ${slack.map(m => mdl.members.findIndex(x => x.id === m.id) + 1).join(', ')} would be in compression, so it carries nothing.` });
      if (R.autoPins && S?.T?.bodies?.length === 0) out.push({ type: 'i', t: 'Pin-jointed truss', d: 'All joints are pins, so the bars carry only axial force (unless loaded between joints).' });
      const lc = R.contacts;
      for (const r of R.reactions) if (r.type === 'contact' && r.lift) out.push({ type: 'w', t: `Stiffness analysis: contact ${nl(mdl.nodes.findIndex(n => n.id === r.node))} in tension`, d: 'The stiffness method treats contacts as bonded; a negative normal force means it would actually separate.' });
      void lc;
      // deflection / span check for beam-like members
      let worst = null; for (const m of R.members) if (m.type === 'frame') { const r = m.sag.abs / m.L; if (!worst || r > worst.r) worst = { r, m }; }
      if (worst && worst.r > 1e-6) out.push({ type: worst.r > 1 / 250 ? 'w' : 'i', t: `Largest member sag: L/${(1 / worst.r).toFixed(0)}`, d: `Deflection relative to the member's own chord. Typical serviceability limits are L/360 (floors) to L/180 (roofs); aircraft parts are judged on strength and stiffness requirements instead.` });
      const bk = res.buckling;
      if (bk?.ok && bk.modes[0]) out.push({ type: bk.modes[0].lambda < 1 ? 'b' : bk.modes[0].lambda < 2 ? 'w' : 'i', t: `Global buckling at ${fmtNum(bk.modes[0].lambda, 3)} × the loads`, d: 'From the eigenvalue problem (K + λK_G)φ = 0. Real structures buckle earlier because of imperfections; designers keep a margin above 1.' });
      const md = res.modal;
      if (md?.ok && md.modes[0]) out.push({ type: 'i', t: `Lowest natural frequency ${fmtNum(md.modes[0].f, 3)} Hz`, d: `Loads that vibrate near this frequency (engines, gusts, footsteps, rotor blade passing) cause resonance. Total mass ${units.fmt('mass', md.totalMass, 4)}.` });
    }
    insightsList(insightsBox, out);
  }

  function renderPlot() {
    const R = res.static, mdl = store.model;
    plotSel.replaceChildren();
    if (!R?.ok) { plot.setData({ series: [] }); return; }
    if (!ui.plotMember || !mdl.members.find(m => m.id === ui.plotMember)) ui.plotMember = mdl.members[0]?.id;
    plotSel.append(select(mdl.members.map((m, k) => ({ value: m.id, label: `Member ${k + 1}` })), ui.plotMember, v => { ui.plotMember = v; renderPlot(); }, { class: 'select st-sel-sm' }),
      select([{ value: 'M', label: 'Bending moment' }, { value: 'V', label: 'Shear force' }, { value: 'N', label: 'Axial force' }, { value: 'v', label: 'Transverse deflection' }, { value: 'th', label: 'Slope' }, { value: 'sig', label: 'Fibre stresses' }], ui.plotQty, v => { ui.plotQty = v; renderPlot(); }, { class: 'select st-sel-sm' }));
    const mr = R.members.find(m => m.id === ui.plotMember); if (!mr) return;
    const xs = mr.x.map(x => units.fromSI('len', x)), q = ui.plotQty, col = cssv('--accent');
    let series = [], yl = '';
    if (q === 'M') { series = [{ x: xs, y: mr.M.map(v => units.fromSI('moment', v)), color: cssv('--accent'), label: 'M' }]; yl = `M (${units.label('moment')})`; }
    if (q === 'V') { series = [{ x: xs, y: mr.V.map(v => units.fromSI('force', v)), color: cssv('--lam'), label: 'V' }]; yl = `V (${units.label('force')})`; }
    if (q === 'N') { series = [{ x: xs, y: mr.N.map(v => units.fromSI('force', v)), color: cssv('--turb'), label: 'N' }]; yl = `N (${units.label('force')})`; }
    if (q === 'v') { series = [{ x: xs, y: Array.from(mr.v, v => units.fromSI('disp', v)), color: col, label: 'v (local)' }]; yl = `v (${units.label('disp')})`; }
    if (q === 'th') { series = [{ x: xs, y: Array.from(mr.th, v => units.fromSI('rot', v)), color: col, label: 'θ' }]; yl = `θ (${units.label('rot')})`; }
    if (q === 'sig') {
      const P = res.prepared?.members[mr.mi], S = P.sec;
      series = [{ x: xs, y: mr.x.map((_, i) => units.fromSI('stress', mr.N[i] / S.A - mr.M[i] * S.ctop / S.Ix)), color: cssv('--accent'), label: 'top fibre' },
        { x: xs, y: mr.x.map((_, i) => units.fromSI('stress', mr.N[i] / S.A + mr.M[i] * S.cbot / S.Ix)), color: cssv('--lower'), label: 'bottom fibre' }];
      yl = `σ (${units.label('stress')})`;
      const fy = units.fromSI('stress', P.fy);
      plot.setOpts({ xlabel: `x (${units.label('len')})`, ylabel: yl, xname: 'x', yname: 'σ' });
      plot.setData({ series, hlines: [{ y: fy, color: cssv('--bad'), label: 'yield', bound: false }, { y: -fy, color: cssv('--bad'), bound: false }] });
      return;
    }
    plot.setOpts({ xlabel: `x (${units.label('len')})`, ylabel: yl, xname: 'x', yname: q });
    plot.setData({ series });
  }
  const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  function renderTables() {
    const R = res.static, mdl = store.model;
    for (const [k, b] of Object.entries(tBtns)) b.classList.toggle('on', k === ui.table);
    tableBox.replaceChildren(); lastTable = null;
    if (ui.table === 'modes') {
      const md = res.modal, bk = res.buckling;
      const box = h('div', { class: 'cf-grid2b' });
      if (md?.ok) { const head = ['Mode', 'f (Hz)', 'T (s)', 'ω (rad/s)', 'Eff. mass x', 'Eff. mass y']; const rows = md.modes.map((m, k) => [k + 1, fmtNum(m.f, 5), fmtNum(m.T, 4), fmtNum(m.omega, 5), (m.effX * 100).toFixed(1) + '%', (m.effY * 100).toFixed(1) + '%']); box.append(table(head, rows)); lastTable = { head, rows }; }
      else box.append(h('div', { class: 'hint' }, md ? 'No vibration modes (structure unstable or massless).' : 'Computing…'));
      if (bk?.ok) box.append(table(['Buckling mode', 'Load factor λ'], bk.modes.map((m, k) => [k + 1, fmtNum(m.lambda, 5)])));
      else box.append(h('div', { class: 'hint' }, bk?.error === 'no-compression' ? 'No compression — no buckling.' : ''));
      tableBox.append(box); return;
    }
    if (!R?.ok) { tableBox.append(h('div', { class: 'hint' }, 'No stiffness results (the structure must be stable).')); return; }
    const F = units.label('force'), Mo = units.label('moment'), D = units.label('disp');
    let head, rows;
    if (ui.table === 'reactions') {
      head = ['Node', 'Support', `Rx (${F})`, `Ry (${F})`, `M (${Mo})`, `Normal (${F})`, `Tangential (${F})`];
      rows = R.reactions.map(r => { const i = mdl.nodes.findIndex(n => n.id === r.node); return [letters(i), r.type + (r.angle ? ` @${r.angle}°` : ''), units.num('force', r.Rx, 5), units.num('force', r.Ry, 5), units.num('moment', r.Mz, 5), units.num('force', r.Rn, 5), units.num('force', r.Rt, 5)]; });
      const t = R.totals; rows.push({ cells: ['Σ', '', units.num('force', t.Rx, 5), units.num('force', t.Ry, 5), '', '', ''], cls: 'st-sum' });
    } else if (ui.table === 'members') {
      head = ['#', 'Type', `L (${units.label('len')})`, `N start (${F})`, `N end (${F})`, `|V| max (${F})`, `M start (${Mo})`, `M end (${Mo})`, `|M| max (${Mo})`, `σ vm (${units.label('stress')})`, 'σ/σy', 'P/P_euler'];
      rows = R.members.map((m, k) => [k + 1, m.type + (m.slack ? ' (slack)' : ''), units.num('len', m.L, 4), units.num('force', m.end.N1, 4), units.num('force', m.end.N2, 4), units.num('force', m.ext.V.abs, 4), units.num('moment', m.end.M1, 4), units.num('moment', m.end.M2, 4), units.num('moment', m.ext.M.abs, 4), units.num('stress', m.stress.vmMax, 4), (m.stress.util * 100).toFixed(1) + '%', m.stress.eulerUtil ? (m.stress.eulerUtil * 100).toFixed(1) + '%' : '—']);
    } else {
      head = ['Node', `x (${units.label('len')})`, `y (${units.label('len')})`, `uₓ (${D})`, `u_y (${D})`, `θ (${units.label('rot')})`];
      rows = R.nodes.map((n, i) => [letters(i), units.num('len', mdl.nodes[i].x, 4), units.num('len', mdl.nodes[i].y, 4), units.num('disp', n.ux, 4), units.num('disp', n.uy, 4), units.num('rot', n.rz, 4)]);
    }
    tableBox.append(table(head, rows)); lastTable = { head, rows };
  }

  // ---------------------------------------------------------------- wiring
  const unsub = store.on(kind => {
    recompute();
    if (kind === 'replace') { renderPalette(); renderSections(); renderAnalysisOpts(); if (editor.sel && !existsSel(editor.sel)) editor.select(null); }
    renderResults(); renderSelection(); renderSections(); renderAnalysisOpts();
    editor.draw();
  });
  const existsSel = s => { const m = store.model; return s.kind === 'node' || s.kind === 'support' ? m.nodes.some(n => n.id === s.id) && (s.kind === 'node' || m.supports.some(x => x.node === s.id)) : s.kind === 'member' ? m.members.some(x => x.id === s.id) : m.loads.some(x => x.id === s.id); };
  const onUnits = () => { renderPalette(); renderSelection(); renderSections(); renderAnalysisOpts(); renderResults(); editor.draw(); };
  addEventListener('unitschange', onUnits);

  ready = true;
  recompute();
  renderPalette(); renderSelection(); renderSections(); renderAnalysisOpts(); setView('model'); renderResults();
  if (!saved) setTimeout(() => { editor.fit(); editor.draw(); }, 0);

  return {
    controls, main,
    show() { requestAnimationFrame(() => { if (!editor.fitted) editor.fit(); editor.draw(); }); },
    destroy() { removeEventListener('unitschange', onUnits); editor._animOn = false; unsub(); },
  };
}

function groupExamples() {
  const groups = [];
  for (const e of EXAMPLES) { let g = groups.find(x => x.group === e.group); if (!g) groups.push(g = { group: e.group, items: [] }); g.items.push({ value: e.id, label: e.label }); }
  return groups;
}
