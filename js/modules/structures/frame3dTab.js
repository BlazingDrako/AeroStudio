// 3D Frame tab: build a space frame or space truss, then read reactions, axial force, biaxial shear
// and bending, torsion, combined stress, deflections, natural frequencies and buckling loads.
import { h, section, select, downloadText } from '../../lib/ui.js';
import { Plot } from '../../lib/plot.js';
import { analyze3d, modal3d, buckling3d, prepare3d, memberAxes, SUPPORT_TYPES, DOF_NAMES } from '../../solvers/frame3d.js';
import { letters } from '../../solvers/statics.js';
import { MATERIALS, SHAPES, sectionProps } from '../../solvers/sections.js';
import { sharedStore3d, example3d, EXAMPLES_3D, blankModel3d, normalize3d } from './model3d.js';
import { Viewer3D } from './view3d.js';
import { numField, selField, segField, checkField, table, toCSV, card, metricsGrid, insightsList, units, fmtNum } from './common.js';

const VIEWS = [
  { id: 'model', label: 'Model' }, { id: 'defl', label: 'Deflection' }, { id: 'N', label: 'Axial N' }, { id: 'V', label: 'Shear V' },
  { id: 'M', label: 'Moment M' }, { id: 'T', label: 'Torsion T' }, { id: 'stress', label: 'Stress' }, { id: 'modes', label: 'Vibration' }, { id: 'buckling', label: 'Buckling' },
];
const DIRS = [
  { value: 'gz', label: 'Global Z (vertical), per member length' }, { value: 'gzp', label: 'Global Z, per horizontal projection' },
  { value: 'gx', label: 'Global X, per member length' }, { value: 'gy', label: 'Global Y, per member length' },
  { value: 'ly', label: 'Local y (along the section depth)' }, { value: 'lz', label: 'Local z (across the section width)' }, { value: 'lx', label: 'Local x (along the member)' },
];
const SUP_OPTS = [{ value: 'none', label: 'None' }, ...Object.entries(SUPPORT_TYPES).map(([value, s]) => ({ value, label: s.label, title: s.title }))];

export function frame3dTab() {
  const store = sharedStore3d();
  const ui = { view: 'model', tool: 'select', labels: true, animate: true, diagScale: 1, deflScale: 1, mode: 0, comp: 'both', plotMember: null, plotQty: 'M', table: 'reactions', nModes: 8 };
  const add = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 3, connect: true };
  let res = { static: null, modal: null, buckling: null, P: null };
  let selection = null, exParams = null, secEdit = null;

  const nodeIdx = id => store.model.nodes.findIndex(n => n.id === id);
  const nodeName = id => letters(nodeIdx(id));
  const memName = m => { const a = nodeName(m.a), b = nodeName(m.b); return a.length + b.length > 2 ? `${a}–${b}` : a + b; };

  const app = {
    ui, model: () => store.model, results: () => res, prepared: () => res.P, selection: () => selection,
    select(hit) { selection = hit && { kind: hit.kind, id: hit.id }; if (hit?.kind === 'member') ui.plotMember = hit.id; renderSelection(); renderTool(); renderPlot(); viewer.draw(); },
    addMember(a, b) { store.commit(); const m = store.addMember(a, b); store.changed(); if (m) viewer.flash(`Member ${memName(m)} added`); },
    deleteHit(hit) { store.commit(); if (hit.kind === 'node') store.deleteNode(hit.id); else store.deleteMember(hit.id); if (selection?.id === hit.id) selection = null; store.changed(); },
    describe,
    onKey(e) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); store.redo(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection) { e.preventDefault(); app.deleteHit(selection); }
      if (e.key === 'Escape') { viewer.pending = null; app.select(null); }
    },
  };
  const viewer = new Viewer3D(app);
  const camBar = h('div', { class: 'st-cam' }, ...[['iso', '3D'], ['front', 'Front'], ['side', 'Side'], ['top', 'Top']].map(([v, l]) => { const b = h('button', { type: 'button', class: 'btn sm ghost', title: `${l} view` }, l); b.addEventListener('click', () => viewer.setView(v)); return b; }),
    (() => { const b = h('button', { type: 'button', class: 'btn sm ghost', title: 'Fit the structure in the view' }, 'Fit'); b.addEventListener('click', () => { viewer.fit(); viewer.draw(); }); return b; })());
  const hint3d = h('div', { class: 'hint-overlay st-3dhint' }, 'Drag to rotate · Shift-drag to pan · scroll to zoom · click to select');
  viewer.stage.append(camBar, hint3d);
  viewer.stage.addEventListener('pointerdown', () => setTimeout(() => hint3d.classList.add('gone'), 2500), { once: true });

  // ---------------------------------------------------------------- analysis
  function recompute() {
    const m = store.model;
    let st = null, P = null;
    try { st = m.members.length ? analyze3d(m) : null; } catch (e) { console.error(e); st = { ok: false, error: 'exception', msg: String(e.message || e) }; }
    try { P = m.members.length ? prepare3d(m) : null; } catch { P = null; }
    res = { static: st, modal: null, buckling: null, P };
    scheduleDynamics();
  }
  let dynTimer = 0;
  function scheduleDynamics() {
    clearTimeout(dynTimer);
    dynTimer = setTimeout(() => {
      const cur = res;
      if (!cur.static?.ok) { renderResults(); return; }
      try { cur.modal = modal3d(store.model, { nModes: ui.nModes }); } catch (e) { console.error(e); cur.modal = { ok: false, error: 'exception' }; }
      try { cur.buckling = buckling3d(store.model, { nModes: 4, stat: cur.static }); } catch (e) { console.error(e); cur.buckling = { ok: false, error: 'exception' }; }
      if (cur === res) { renderResults(); renderViewExtra(); viewer.draw(); }
    }, 200);
  }

  // ---------------------------------------------------------------- controls
  const controls = h('div', { class: 'st-controls' });
  const btn = (label, fn, title, cls = 'btn sm') => { const b = h('button', { type: 'button', class: cls, title: title || '' }, label); b.addEventListener('click', fn); return b; };
  const groups = []; for (const e of EXAMPLES_3D) { let g = groups.find(x => x.group === e.group); if (!g) groups.push(g = { group: e.group, items: [] }); g.items.push({ value: e.id, label: e.label }); }
  const exSel = select([{ value: '', label: 'Load an example…' }, ...groups], '', id => { if (!id) return; loadExample(id); exSel.value = ''; });
  const exBox = h('div', {});
  function loadExample(id, params) {
    store.replace(example3d(id, params)); selection = null; ui.mode = 0; ui.plotMember = null;
    const ex = EXAMPLES_3D.find(e => e.id === id);
    exParams = ex.params ? { id, p: Object.fromEntries(ex.params.map(([k, , v]) => [k, params?.[k] ?? v])) } : null;
    viewer.fitted = false; viewer.fit(); renderExParams(); viewer.draw();
  }
  function renderExParams() {
    exBox.replaceChildren();
    if (!exParams) return;
    const ex = EXAMPLES_3D.find(e => e.id === exParams.id);
    exBox.append(h('div', { class: 'st-matbox' }, h('div', { class: 'st-lab' }, ex.label),
      ...ex.params.map(([k, lab, , q]) => numField(lab, q || null, () => exParams.p[k], v => { exParams.p[k] = q ? v : Math.max(1, Math.min(12, Math.round(v))); })),
      btn('Rebuild', () => loadExample(exParams.id, exParams.p), 'Regenerate the example with these values')));
  }
  const fileIn = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0]; if (!f) return;
    try { store.replace(normalize3d(JSON.parse(await f.text()))); viewer.fitted = false; viewer.fit(); viewer.draw(); } catch { alert('That file is not a valid 3D frame.'); }
    fileIn.value = '';
  });
  const sFile = section('3D frame');
  sFile.body.append(exSel, exBox, h('div', { class: 'st-row' },
    btn('New', () => { if (store.model.nodes.length && !confirm('Start a new, empty frame? (Undo brings it back.)')) return; store.replace(blankModel3d()); selection = null; exParams = null; renderExParams(); }, 'Start from scratch'),
    btn('Save', () => downloadText('frame3d.json', JSON.stringify(store.model, null, 1), 'application/json'), 'Download as JSON'),
    btn('Open', () => fileIn.click(), 'Open a 3D frame JSON file'), fileIn,
    btn('Undo', () => store.undo(), 'Undo (Ctrl+Z)', 'btn sm ghost'), btn('Redo', () => store.redo(), 'Redo (Ctrl+Shift+Z)', 'btn sm ghost')),
  h('div', { class: 'hint' }, 'Global Z points up. Coordinates in ' + units.label('len') + '. Build by typing nodes, then connecting them with the member tool — or start from an example.'));
  const sTool = section('Build');
  const sSel = section('Selection');
  const sSec = section('Sections & materials', { collapsible: true, collapsed: true });
  const sAna = section('Analysis options', { collapsible: true, collapsed: true });
  controls.append(sFile.el, sTool.el, sSel.el, sSec.el, sAna.el);

  function renderTool() {
    const b = sTool.body; b.replaceChildren();
    b.append(segField('', [{ value: 'select', label: 'Select' }, { value: 'member', label: 'Connect nodes' }, { value: 'delete', label: 'Delete' }], ui.tool, v => { ui.tool = v; viewer.pending = null; viewer.stage.dataset.tool = v === 'member' ? 'member' : v; renderTool(); viewer.draw(); }));
    const tips = { select: 'Click a node or member to edit it, its supports and its loads.', member: 'Click one node, then another: a member joins them. Keep clicking to chain members; click empty space to stop.', delete: 'Click a node or member to delete it (with its loads).' };
    b.append(h('div', { class: 'hint' }, tips[ui.tool]));
    const selNode = selection?.kind === 'node' ? store.node(selection.id) : null;
    const xyz = (o, keys) => h('div', { class: 'st-xyz' }, ...keys.map(([k, lab]) => numField(lab, 'len', () => o[k], v => { o[k] = v; })));
    if (selNode) {
      b.append(h('div', { class: 'st-lab', style: { marginTop: '6px' } }, `New node offset from ${nodeName(selNode.id)}`), xyz(add, [['dx', 'ΔX'], ['dy', 'ΔY'], ['dz', 'ΔZ']]),
        checkField('Connect it with a member', add.connect, v => { add.connect = v; }),
        h('div', { class: 'st-row' }, btn('Add node', () => {
          if (!add.dx && !add.dy && !add.dz) { viewer.flash('Enter a non-zero offset'); return; }
          store.commit(); const n = store.addNode(selNode.x + add.dx, selNode.y + add.dy, (selNode.z || 0) + add.dz);
          if (add.connect) store.addMember(selNode.id, n.id);
          selection = { kind: 'node', id: n.id }; viewer.fitted = false; store.changed();
        }, 'Adds the node and selects it, so you can keep extending')));
    }
    b.append(h('div', { class: 'st-lab', style: { marginTop: '6px' } }, 'New node at'), xyz(add, [['x', 'X'], ['y', 'Y'], ['z', 'Z']]),
      h('div', { class: 'st-row' }, btn('Add node', () => { store.commit(); const n = store.addNode(add.x, add.y, add.z); selection = { kind: 'node', id: n.id }; viewer.fitted = false; store.changed(); })));
  }

  // ---------------------------------------------------------------- selection editor
  function renderSelection() {
    const b = sSel.body; b.replaceChildren();
    const mdl = store.model;
    if (!selection) { b.append(h('div', { class: 'hint' }, mdl.members.length ? 'Click a node or member in the view to edit it.' : 'No members yet.')); return; }
    if (selection.kind === 'node') return renderNodeSel(b, store.node(selection.id));
    if (selection.kind === 'member') return renderMemberSel(b, store.member(selection.id));
  }
  const change = fn => { store.commit(); fn(); store.changed(); };
  function renderNodeSel(b, n) {
    if (!n) { selection = null; return renderSelection(); }
    const mdl = store.model, i = nodeIdx(n.id);
    b.append(h('div', { class: 'st-selhead' }, h('b', {}, `Node ${letters(i)}`), btn('Delete', () => app.deleteHit({ kind: 'node', id: n.id }), 'Delete this node and its members', 'btn sm ghost')));
    b.append(h('div', { class: 'st-xyz' }, ...['x', 'y', 'z'].map(k => numField(k.toUpperCase(), 'len', () => n[k] || 0, v => change(() => { n[k] = v; viewer.fitted = false; })))));
    // support
    const sp = store.support(n.id), cur = sp ? sp.type || 'custom' : 'none';
    b.append(segField('Support', SUP_OPTS, cur, v => change(() => {
      mdl.supports = mdl.supports.filter(s => s.node !== n.id);
      if (v !== 'none') mdl.supports.push({ node: n.id, type: v, r: [...(SUPPORT_TYPES[v].r || sp?.r || [1, 1, 1, 0, 0, 0])], k: sp?.k || [0, 0, 0, 0, 0, 0] });
      renderSelection();
    })));
    if (sp) {
      const grid = h('div', { class: 'st-dofs' });
      DOF_NAMES.forEach((d, k) => {
        const c = h('input', { type: 'checkbox' }); c.checked = !!sp.r[k];
        c.addEventListener('change', () => change(() => { sp.r[k] = c.checked ? 1 : 0; sp.type = Object.entries(SUPPORT_TYPES).find(([, s]) => s.r && s.r.every((v, j) => v === sp.r[j]))?.[0] || 'custom'; renderSelection(); }));
        grid.append(h('label', { class: 'st-dof' }, c, h('span', {}, d)));
      });
      b.append(h('div', { class: 'st-lab' }, 'Restrained directions'), grid);
      if (sp.type === 'custom') {
        sp.k = sp.k || [0, 0, 0, 0, 0, 0];
        const free = DOF_NAMES.map((d, k) => k).filter(k => !sp.r[k]);
        if (free.length) b.append(h('div', { class: 'st-lab' }, 'Springs on the free directions'), ...free.map(k => numField(`k ${DOF_NAMES[k]}`, k < 3 ? 'kspring' : 'krot', () => sp.k[k] || 0, v => change(() => { sp.k[k] = Math.max(0, v); }))));
      }
    }
    // loads
    const loads = mdl.loads.filter(l => l.node === n.id);
    b.append(h('div', { class: 'st-lab', style: { marginTop: '8px' } }, 'Loads at this node'));
    for (const ld of loads) {
      b.append(h('div', { class: 'st-matbox' },
        h('div', { class: 'st-xyz' }, ...['fx', 'fy', 'fz'].map(k => numField(k.toUpperCase().replace('F', 'F'), 'force', () => ld[k] || 0, v => change(() => { ld[k] = v; })))),
        h('div', { class: 'st-xyz' }, ...['mx', 'my', 'mz'].map(k => numField(k.toUpperCase(), 'moment', () => ld[k] || 0, v => change(() => { ld[k] = v; })))),
        btn('Remove load', () => change(() => { mdl.loads = mdl.loads.filter(l => l !== ld); renderSelection(); }), '', 'btn sm ghost')));
    }
    b.append(btn('Add a force / moment', () => change(() => { mdl.loads.push({ id: store.id('l'), kind: 'node', node: n.id, fx: 0, fy: 0, fz: -10e3 }); renderSelection(); })));
    // results
    const R = res.static;
    if (R?.ok) {
      const U = R.U, r = R.reactions.find(x => x.node === n.id);
      b.append(h('div', { class: 'cf-res st-mini' },
        ...[0, 1, 2].map(d => h('div', { class: 'r' }, h('span', {}, `u${'xyz'[d]}`), h('span', {}, units.fmt('disp', U[6 * i + d], 4)))),
        ...[3, 4, 5].map(d => h('div', { class: 'r' }, h('span', {}, `θ${'xyz'[d - 3]}`), h('span', {}, units.fmt('rot', U[6 * i + d], 4)))),
        ...(r ? r.F.map((v, d) => (sp?.r[d] || sp?.k?.[d]) ? h('div', { class: 'r' }, h('span', {}, `R ${DOF_NAMES[d].replace('u', 'F').replace('θ', 'M')}`), h('span', {}, units.fmt(d < 3 ? 'force' : 'moment', v, 4))) : null).filter(Boolean) : [])));
    }
  }
  function renderMemberSel(b, m) {
    if (!m) { selection = null; return renderSelection(); }
    const mdl = store.model;
    b.append(h('div', { class: 'st-selhead' }, h('b', {}, `Member ${memName(m)}`), h('div', { class: 'row', style: { gap: '4px' } },
      btn('Split', () => change(() => { const n = store.splitMember(m, 0.5); selection = { kind: 'node', id: n.id }; }), 'Insert a node at mid-length', 'btn sm ghost'),
      btn('Delete', () => app.deleteHit({ kind: 'member', id: m.id }), '', 'btn sm ghost'))));
    b.append(segField('Type', [{ value: 'frame', label: 'Beam (rigid joints)', title: 'Carries axial force, shear, bending about both axes and torsion.' }, { value: 'truss', label: 'Truss bar', title: 'Pin-jointed: axial force only (loads along it are carried to the ends).' }], m.type || 'frame', v => change(() => { m.type = v; renderSelection(); })));
    b.append(selField('Section', mdl.sections.map(s => ({ value: s.id, label: s.name })), m.sec, v => change(() => { m.sec = v; mdl.defaults.sec = v; })));
    b.append(selField('Material', [...MATERIALS, ...mdl.materials].map(x => ({ value: x.id, label: x.name })), m.mat, v => change(() => { m.mat = v; mdl.defaults.mat = v; })));
    if (m.type !== 'truss') {
      b.append(numField('Roll angle', null, () => m.roll || 0, v => change(() => { m.roll = v; }), { suffix: '°', tip: 'Turns the section about the member axis. 0° puts the section depth (local y) in the vertical plane through the member, pointing up; for vertical members local y points along global X.' }));
      b.append(h('div', { class: 'st-row' }, checkField(`Pin at ${nodeName(m.a)}`, m.relA, v => change(() => { m.relA = v; })), checkField(`Pin at ${nodeName(m.b)}`, m.relB, v => change(() => { m.relB = v; }))));
    }
    const A = store.node(m.a), B = store.node(m.b), ax = memberAxes([A.x, A.y, A.z || 0], [B.x, B.y, B.z || 0], m.roll || 0);
    const axTxt = v => { const k = [0, 1, 2].reduce((p, c) => (Math.abs(v[c]) > Math.abs(v[p]) ? c : p), 0); return `${v[k] < 0 ? '−' : '+'}${'XYZ'[k]}${Math.abs(v[k]) < 0.999 ? ' (roughly)' : ''}`; };
    b.append(h('div', { class: 'hint' }, `Length ${units.fmt('len', ax.L, 4)}. Local y (depth) points ${axTxt(ax.R[1])}, local z ${axTxt(ax.R[2])}.`));
    // member loads
    const loads = mdl.loads.filter(l => l.member === m.id);
    b.append(h('div', { class: 'st-lab', style: { marginTop: '8px' } }, 'Loads on this member'));
    for (const ld of loads) {
      const box = h('div', { class: 'st-matbox' });
      if (ld.kind === 'dist') box.append(h('div', { class: 'st-lab' }, 'Distributed load'), selField('Direction', DIRS, ld.dir || 'gz', v => change(() => { ld.dir = v; })),
        numField('w at start', 'dist', () => ld.w1 ?? 0, v => change(() => { ld.w1 = v; })), numField('w at end', 'dist', () => ld.w2 ?? ld.w1 ?? 0, v => change(() => { ld.w2 = v; })));
      else if (ld.kind === 'point') box.append(h('div', { class: 'st-lab' }, 'Point load (global axes)'), numField('Position along member', null, () => (ld.t ?? 0.5) * 100, v => change(() => { ld.t = Math.max(0, Math.min(1, v / 100)); }), { suffix: '%' }),
        h('div', { class: 'st-xyz' }, ...['fx', 'fy', 'fz'].map(k => numField(k.toUpperCase(), 'force', () => ld[k] || 0, v => change(() => { ld[k] = v; })))));
      else if (ld.kind === 'torque') box.append(h('div', { class: 'st-lab' }, 'Distributed torque about the member axis'), numField('m_t', 'moment', () => ld.mt || 0, v => change(() => { ld.mt = v; }), { hint: `per ${units.label('len')} of length` }));
      else if (ld.kind === 'thermal') box.append(h('div', { class: 'st-lab' }, 'Uniform temperature change'), numField('ΔT', 'dtemp', () => ld.dT || 0, v => change(() => { ld.dT = v; })));
      box.append(btn('Remove load', () => change(() => { mdl.loads = mdl.loads.filter(l => l !== ld); renderSelection(); }), '', 'btn sm ghost'));
      b.append(box);
    }
    b.append(h('div', { class: 'st-row' },
      btn('+ Distributed', () => change(() => { mdl.loads.push({ id: store.id('l'), kind: 'dist', member: m.id, dir: 'gz', w1: -10e3, w2: -10e3 }); renderSelection(); })),
      btn('+ Point', () => change(() => { mdl.loads.push({ id: store.id('l'), kind: 'point', member: m.id, t: 0.5, fx: 0, fy: 0, fz: -10e3 }); renderSelection(); })),
      btn('+ Torque', () => change(() => { mdl.loads.push({ id: store.id('l'), kind: 'torque', member: m.id, mt: 1e3 }); renderSelection(); })),
      btn('+ ΔT', () => change(() => { mdl.loads.push({ id: store.id('l'), kind: 'thermal', member: m.id, dT: 30 }); renderSelection(); }))));
    const R = res.static, k = mdl.members.indexOf(m);
    if (R?.ok && R.members[k]) {
      const mr = R.members[k];
      b.append(h('div', { class: 'cf-res st-mini' },
        ...[['N', 'force'], ['Vy', 'force'], ['Vz', 'force'], ['T', 'moment'], ['My', 'moment'], ['Mz', 'moment']].map(([q, u]) => h('div', { class: 'r' }, h('span', {}, `max ${q}`), h('span', {}, units.fmt(u, mr.ext[q], 4)))),
        h('div', { class: 'r' }, h('span', {}, 'Von Mises / yield'), h('span', {}, `${fmtNum(mr.stress.util * 100, 3)}%`))));
      b.append(btn('Plot along this member', () => { ui.plotMember = m.id; renderPlot(); plotCard.scrollIntoView({ behavior: 'smooth', block: 'center' }); }));
    }
  }

  function renderSections() {
    const b = sSec.body; b.replaceChildren();
    const mdl = store.model;
    if (!secEdit || !mdl.sections.find(s => s.id === secEdit)) secEdit = mdl.sections[0]?.id;
    const s = mdl.sections.find(x => x.id === secEdit);
    b.append(h('div', { class: 'st-row' }, select(mdl.sections.map(x => ({ value: x.id, label: x.name })), secEdit, v => { secEdit = v; renderSections(); }),
      btn('New', () => change(() => { const id = store.id('s'); mdl.sections.push({ id, name: 'Section ' + (mdl.sections.length + 1), shape: 'box', dims: { ...SHAPES.box.def } }); secEdit = id; })),
      btn('Copy', () => change(() => { const id = store.id('s'); mdl.sections.push({ ...JSON.parse(JSON.stringify(s)), id, name: s.name + ' copy' }); secEdit = id; }))));
    if (!s) return;
    const nameIn = h('input', { class: 'text-input', value: s.name });
    nameIn.addEventListener('change', () => change(() => { s.name = nameIn.value || s.name; }));
    b.append(h('label', { class: 'st-field st-field-sel' }, h('span', { class: 'st-lab' }, 'Name'), nameIn));
    b.append(selField('Shape', Object.entries(SHAPES).map(([value, x]) => ({ value, label: x.label })), s.shape, v => change(() => { s.shape = v; s.dims = { ...SHAPES[v].def }; })));
    const q = { A: 'area', I: 'inertia', J: 'inertia' };
    b.append(h('div', { class: 'st-grid2' }, ...SHAPES[s.shape].fields.map(([k, lab]) => numField(lab, q[k] || 'dim', () => s.dims[k], v => { if (v > 0) change(() => { s.dims[k] = v; }); }))));
    try {
      const p = sectionProps(s);
      b.append(h('div', { class: 'cf-res st-mini' }, ...[['A', units.fmt('area', p.A, 4)], ['I strong (z)', units.fmt('inertia', p.Ix, 4)], ['I weak (y)', units.fmt('inertia', p.Iy, 4)], ['J torsion', units.fmt('inertia', p.J, 4)]].map(([k, v]) => h('div', { class: 'r' }, h('span', {}, k), h('span', {}, v)))));
    } catch { }
    const used = mdl.members.filter(m => m.sec === s.id).length;
    b.append(h('div', { class: 'st-row' }, btn('Assign to all members', () => change(() => { for (const m of mdl.members) m.sec = s.id; mdl.defaults.sec = s.id; })), h('span', { class: 'hint', style: { margin: 0 } }, `${used} member${used === 1 ? '' : 's'} use it`)));
    b.append(h('div', { class: 'hint' }, 'Custom shapes use the same inertia about both axes. For open sections (I, channel, angle) torsion is carried by thin-wall St Venant action only, which is weak; warping restraint is not modelled.'));
  }
  function renderAnalysisOpts() {
    const b = sAna.body; b.replaceChildren();
    const mdl = store.model;
    b.append(checkField('Include self weight', mdl.settings.selfWeight, v => change(() => { mdl.settings.selfWeight = v; renderAnalysisOpts(); }), 'Adds each member\'s weight ρ·g·A per length, acting in −Z.'));
    b.append(numField('Gravity g', 'accel', () => mdl.settings.g, v => change(() => { mdl.settings.g = v; })));
    b.append(numField('Vibration modes', null, () => ui.nModes, v => { ui.nModes = Math.max(1, Math.min(30, Math.round(v))); scheduleDynamics(); }));
    b.append(checkField('Labels', ui.labels, v => { ui.labels = v; viewer.draw(); }));
  }

  // ---------------------------------------------------------------- main area
  const main = h('div', { class: 'cf-main-inner' });
  const viewTabs = h('div', { class: 'tabs tabs-wrap st-views', role: 'tablist' }), viewBtns = {};
  for (const v of VIEWS) { const b = h('button', { type: 'button', role: 'tab' }, v.label); b.addEventListener('click', () => setView(v.id)); viewTabs.append(b); viewBtns[v.id] = b; }
  const viewExtra = h('div', { class: 'st-viewextra' });
  function setView(v) { ui.view = v; for (const [k, b] of Object.entries(viewBtns)) b.classList.toggle('on', k === v); renderViewExtra(); viewer.draw(); }
  function renderViewExtra() {
    const v = ui.view, e = viewExtra; e.replaceChildren();
    const rangeCtl = (label, key, min, max) => {
      const r = h('input', { type: 'range', min: Math.log10(min), max: Math.log10(max), step: 0.01, value: Math.log10(ui[key]) });
      const p = () => r.style.setProperty('--fill', ((r.value - r.min) / (r.max - r.min) * 100) + '%'); p();
      r.addEventListener('input', () => { ui[key] = 10 ** +r.value; p(); viewer.draw(); });
      return h('label', { class: 'st-range' }, h('span', {}, label), r);
    };
    if (v === 'V' || v === 'M') e.append(segField('', [{ value: 'y', label: v === 'M' ? 'Mz (strong)' : 'Vy' }, { value: 'z', label: v === 'M' ? 'My (weak)' : 'Vz' }, { value: 'both', label: 'Both' }], ui.comp, x => { ui.comp = x; viewer.draw(); }), rangeCtl('Scale', 'diagScale', 0.2, 5));
    if (['defl', 'modes', 'buckling'].includes(v)) e.append(rangeCtl('Exaggeration', 'deflScale', 0.1, 10));
    if (v === 'defl' || v === 'modes') e.append(checkField('Animate', ui.animate, x => { ui.animate = x; viewer.draw(); }));
    if (v === 'modes' || v === 'buckling') {
      const r = v === 'modes' ? res.modal : res.buckling;
      if (r?.ok && r.modes.length) e.append(select(r.modes.map((m, k) => ({ value: k, label: v === 'modes' ? `Mode ${k + 1} — ${fmtNum(m.f, 4)} Hz` : `Mode ${k + 1} — λ = ${fmtNum(m.lambda, 4)}` })), Math.min(ui.mode, r.modes.length - 1), x => { ui.mode = +x; viewer.draw(); }, { class: 'select st-sel-sm' }));
      else e.append(h('span', { class: 'hint', style: { margin: 0 } }, !res.static?.ok ? 'Needs a stable structure' : r?.none ? 'Nothing is in compression' : r ? 'No modes found' : 'Computing…'));
    }
  }
  const status = h('div', { class: 'st-status' });
  const metrics = metricsGrid();
  const insightsBox = h('div', {});
  const insightsCard = card('What the results say', null, insightsBox);
  const plotHost = h('div', { class: 'st-plot' });
  const plotSel = h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } });
  const plotCard = h('div', { class: 'plot-card' }, h('div', { class: 'plot-head', style: { flexWrap: 'wrap' } }, h('h4', {}, 'Along a member'), plotSel), plotHost);
  const plot = new Plot(plotHost, { xlabel: 'x', ylabel: '', legend: true });
  const tableTabs = h('div', { class: 'tabs tabs-wrap st-ttabs' }), tableBox = h('div', {});
  const csvBtn = h('button', { type: 'button', class: 'btn sm' }, 'CSV');
  const tableCard = h('div', { class: 'plot-card' }, h('div', { class: 'plot-head', style: { flexWrap: 'wrap' } }, h('h4', {}, 'Results tables'), h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } }, tableTabs, csvBtn)), tableBox);
  const tBtns = {};
  for (const [id, lab] of [['reactions', 'Reactions'], ['nodes', 'Displacements'], ['forces', 'End forces'], ['stress', 'Stresses'], ['modes', 'Modes & buckling']]) { const b = h('button', { type: 'button' }, lab); b.addEventListener('click', () => { ui.table = id; renderTables(); }); tableTabs.append(b); tBtns[id] = b; }
  let lastTable = null;
  csvBtn.addEventListener('click', () => { if (lastTable) downloadText(`frame3d-${ui.table}.csv`, toCSV(lastTable.head, lastTable.rows)); });
  main.append(h('div', { class: 'st-viewbar' }, viewTabs, viewExtra), viewer.stage, status, metrics.el, h('div', { class: 'st-pair' }, plotCard, insightsCard), tableCard);

  // ---------------------------------------------------------------- results
  function describe(hit) {
    const R = res.static;
    if (hit.kind === 'node') {
      const n = store.node(hit.id), i = nodeIdx(hit.id); if (!n) return null;
      let s = `<b>${letters(i)}</b> (${units.num('len', n.x, 4)}, ${units.num('len', n.y, 4)}, ${units.num('len', n.z || 0, 4)}) ${units.label('len')}`;
      if (R?.ok) s += `<br>|u| = ${units.fmt('disp', Math.hypot(R.U[6 * i], R.U[6 * i + 1], R.U[6 * i + 2]), 4)}`;
      return s;
    }
    const m = store.member(hit.id); if (!m) return null;
    const k = store.model.members.indexOf(m), sec = store.model.sections.find(s => s.id === m.sec);
    let s = `<b>${memName(m)}</b> ${m.type === 'truss' ? 'truss bar' : 'beam'} · ${sec?.name || ''}`;
    if (R?.ok && R.members[k]) {
      const mr = R.members[k];
      s += `<br>N ${units.fmt('force', mr.ext.N, 3)} · T ${units.fmt('moment', mr.ext.T, 3)}`;
      if (m.type !== 'truss') s += `<br>My ${units.fmt('moment', mr.ext.My, 3)} · Mz ${units.fmt('moment', mr.ext.Mz, 3)}`;
      s += `<br>stress ${Math.round(mr.stress.util * 100)}% of yield`;
    }
    return s;
  }

  function renderResults() {
    const R = res.static, mdl = store.model;
    if (!mdl.members.length) {
      status.innerHTML = '<span class="hint">Add nodes with the Build panel and connect them, or load an example.</span>';
      metrics.set([]); insightsList(insightsBox, []); tableBox.replaceChildren(); plot.setData({ series: [] }); renderSelection(); return;
    }
    const parts = [];
    const nT = mdl.members.filter(m => m.type === 'truss').length, nF = mdl.members.length - nT;
    const r = mdl.supports.reduce((s, sp) => s + (sp.r || []).reduce((a, v) => a + v, 0) + (sp.k || []).filter((k, d) => k > 0 && !sp.r[d]).length, 0);
    if (nF === 0) { const deg_ = mdl.members.length + mdl.supports.reduce((s, sp) => s + sp.r.slice(0, 3).reduce((a, v) => a + v, 0), 0) - 3 * mdl.nodes.length; parts.push(`<span class="st-pill ${deg_ === 0 ? 'g' : deg_ > 0 ? 'i' : 'b'}">${deg_ === 0 ? 'Space truss: m + r = 3j' : deg_ > 0 ? `Space truss, indeterminate (degree ${deg_})` : 'Space truss: too few members'}</span>`); }
    else if (nT === 0) { const rel = mdl.members.reduce((s, m) => s + (m.relA ? 2 : 0) + (m.relB ? 2 : 0), 0), deg_ = 6 * mdl.members.length + r - 6 * mdl.nodes.length - rel; parts.push(`<span class="st-pill ${deg_ === 0 ? 'g' : deg_ > 0 ? 'i' : 'b'}">${deg_ === 0 ? 'Statically determinate (by count)' : deg_ > 0 ? `Indeterminate, degree ${deg_}` : 'Too few restraints'}</span>`); }
    if (R?.ok) parts.push(`<span class="st-pill g">Solved</span><span class="hint">${R.ndof} unknown displacements · equilibrium error ${R.eqErr.toExponential(1)}</span>`);
    else if (R) parts.push(`<span class="st-pill b">${R.error === 'mechanism' ? 'Mechanism' : R.error === 'nosupports' ? 'No supports' : 'Cannot solve'}</span><span class="hint">${failMsg(R)}</span>`);
    status.innerHTML = parts.join(' ');
    if (!R?.ok) { metrics.set([]); insightsList(insightsBox, [{ type: 'b', t: 'No solution', d: failMsg(R) }]); tableBox.replaceChildren(); plot.setData({ series: [] }); renderSelection(); renderTables(); return; }
    const md = res.modal, bk = res.buckling;
    let maxM = { v: 0, k: 0 }, maxT = { v: 0, k: 0 }, maxN = { v: 0, k: 0 };
    R.members.forEach((mr, k) => {
      for (let i = 0; i < mr.s.length; i++) { const v = Math.hypot(mr.My[i], mr.Mz[i]); if (v > maxM.v) maxM = { v, k }; }
      if (Math.abs(mr.ext.T) > maxT.v) maxT = { v: Math.abs(mr.ext.T), k };
      if (Math.abs(mr.ext.N) > Math.abs(maxN.v)) maxN = { v: mr.ext.N, k };
    });
    const crit = R.crit, ck = mdl.members.findIndex(m => m.id === crit.id);
    const mName = k => memName(mdl.members[k]);
    metrics.set([
      { k: 'Max displacement', v: units.fmt('disp', Math.max(R.maxD.v, R.maxMemberD.v), 4), s: R.maxMemberD.v > R.maxD.v * 1.001 ? `along ${mName(R.maxMemberD.member)}` : `at node ${letters(R.maxD.node)}` },
      { k: 'Peak stress / yield', v: `${fmtNum(crit.stress.util * 100, 3)}%`, s: `member ${mName(ck)} · ${units.fmt('stress', crit.stress.vm, 3)}`, cls: crit.stress.util > 1 ? 'bad' : crit.stress.util > 0.8 ? 'warn' : '', tip: 'Von Mises combination of the peak normal stress (axial + bending about both axes at the extreme corner) and the peak shear (torsion + transverse shear). Conservative: the peaks may not occur at the same point of the section.' },
      { k: 'Max axial force', v: units.fmt('force', maxN.v, 4), s: Math.abs(maxN.v) > 1e-6 ? `${maxN.v < 0 ? 'compression' : 'tension'} in ${mName(maxN.k)}` : 'no axial force' },
      { k: 'Max bending moment', v: units.fmt('moment', maxM.v, 4), s: `resultant √(My²+Mz²) in ${mName(maxM.k)}` },
      { k: 'Max torque', v: units.fmt('moment', maxT.v, 4), s: maxT.v > 0 ? `in ${mName(maxT.k)}` : 'no twisting' },
      { k: 'First natural frequency', v: md?.ok && md.modes[0] ? `${fmtNum(md.modes[0].f, 4)} Hz` : md ? '—' : '…', s: md?.ok && md.modes[0] ? `mode mostly in ${md.modes[0].dominant}` : '' },
      { k: 'Buckling load factor', v: bk?.ok ? (bk.modes[0] ? fmtNum(bk.modes[0].lambda, 4) : 'none') : bk ? '—' : '…', s: bk?.ok && bk.modes[0] ? (bk.modes[0].lambda < 1 ? 'buckles under these loads' : 'loads × λ buckle the frame') : bk?.none ? 'nothing in compression' : '', cls: bk?.modes?.[0]?.lambda < 1 ? 'bad' : bk?.modes?.[0]?.lambda < 3 ? 'warn' : '' },
      { k: 'Structure mass', v: units.fmt('mass', R.mass, 4), s: `weight ${units.fmt('force', R.mass * (mdl.settings.g || 9.80665), 3)}` },
    ]);
    insightsList(insightsBox, insights(R));
    renderSelection(); renderPlot(); renderTables();
  }
  function failMsg(R) {
    if (!R) return '';
    if (R.error === 'mechanism') {
      const d = R.dir ?? 0;
      return `Node ${letters(R.node)} (or the part attached to it) can ${d < 3 ? 'move along ' + 'XYZ'[d] : 'rotate about ' + 'XYZ'[d - 3]} without resistance. Add a support restraint or a member (bracing), or check pinned ends — the animation shows the free motion.`;
    }
    if (R.error === 'nosupports') return 'Give at least one node a support (select a node → Support).';
    if (R.error === 'zero-length') return 'Two ends of a member are at the same point.';
    if (R.error === 'section') return 'A member has a section with zero area.';
    return R.msg || 'Unexpected error.';
  }
  function insights(R) {
    const mdl = store.model, out = [], P = res.P;
    out.push(R.eqErr < 1e-8 ? { type: 'g', t: 'Equilibrium checks out', d: `The reactions balance every applied load in all six directions (forces and moments about the origin), to ${R.eqErr.toExponential(1)} relative error.` } : { type: 'w', t: 'Equilibrium error', d: `Loads and reactions differ by ${R.eqErr.toExponential(2)} (relative). The model may be nearly unstable.` });
    const c = R.crit, k = mdl.members.findIndex(m => m.id === c.id);
    if (c.stress.util > 1) out.push({ type: 'b', t: `Member ${memName(mdl.members[k])} yields`, d: `Peak von Mises stress ${units.fmt('stress', c.stress.vm, 3)} is ${fmtNum(c.stress.util * 100, 3)}% of the yield stress of ${P.members[k].mat.name}. Use a bigger section or a stronger material.` });
    else if (c.stress.util > 0.8) out.push({ type: 'w', t: `Member ${memName(mdl.members[k])} is highly stressed`, d: `${fmtNum(c.stress.util * 100, 3)}% of yield at its worst point — little margin for load factors.` });
    else out.push({ type: 'g', t: 'Stresses are below yield', d: `The worst point (member ${memName(mdl.members[k])}) reaches ${fmtNum(c.stress.util * 100, 3)}% of yield.` });
    // torsion in open sections
    const tors = R.members.map((mr, i) => ({ mr, i })).filter(({ mr, i }) => { const S = P.members[i].sec; return mdl.members[i].type !== 'truss' && ['ibeam', 'channel', 'angle', 'tee', 'zsec', 'hat'].includes(S.shape) && Math.abs(mr.ext.T) * S.kt > 0.25 * Math.max(mr.stress.vm, 1); });
    if (tors.length) out.push({ type: 'w', t: 'Torsion in open sections', d: `${tors.map(t => memName(mdl.members[t.i])).slice(0, 5).join(', ')}${tors.length > 5 ? '…' : ''} twist${tors.length === 1 ? 's' : ''} noticeably. Open shapes (I, channel, angle) have tiny St Venant stiffness J; a closed tube or box of similar weight is typically 100× stiffer in torsion. (Warping restraint at fixed ends, not modelled here, helps open sections somewhat.)` });
    const biax = R.members.filter((mr, i) => mdl.members[i].type !== 'truss' && Math.abs(mr.ext.My) > 0.2 * Math.abs(mr.ext.Mz) && Math.abs(mr.ext.Mz) > 0.2 * Math.abs(mr.ext.My) && Math.abs(mr.ext.My) > 0);
    if (biax.length) out.push({ type: 'i', t: 'Biaxial bending', d: `${biax.length} member${biax.length === 1 ? ' bends' : 's bend'} about both axes. Bending stresses add at one corner: σ = N/A ± My·z/Iy ± Mz·y/Iz. Rolled I-sections are 5–15× weaker about their weak axis.` });
    const eul = R.members.map((mr, i) => ({ mr, i })).filter(x => x.mr.euler && x.mr.euler.ratio > 0.5).sort((a, b) => b.mr.euler.ratio - a.mr.euler.ratio);
    if (eul.length) out.push({ type: eul[0].mr.euler.ratio > 1 ? 'b' : 'w', t: 'Slender members in compression', d: `${memName(mdl.members[eul[0].i])} carries ${fmtNum(eul[0].mr.euler.ratio * 100, 3)}% of its own pin-ended Euler load π²EI/L² (weak axis). See the Buckling view for the whole-frame buckling load.` });
    const L = R.maxMemberD.member >= 0 ? R.members[R.maxMemberD.member].L : 1;
    if (R.maxMemberD.v > L / 250) out.push({ type: 'w', t: 'Large deflection', d: `Up to ${units.fmt('disp', R.maxMemberD.v, 3)}, more than L/250 of member ${memName(mdl.members[R.maxMemberD.member])} (a common serviceability limit). Linear analysis assumes deflections stay small.` });
    const md = res.modal;
    if (md?.ok && md.modes[0]) {
      const m0 = md.modes[0], eff = md.modes.reduce((s, q) => s.map((v, d) => v + q.eff[d]), [0, 0, 0]).map((v, d) => v / (md.massFree[d] || 1));
      out.push({ type: m0.f < 1 ? 'w' : 'i', t: `First mode ${fmtNum(m0.f, 3)} Hz (${m0.dominant})`, d: `${md.modes.length} modes capture ${eff.map((v, d) => `${'XYZ'[d]} ${Math.round(v * 100)}%`).join(', ')} of the mass for shaking in each direction.${m0.f < 1 ? ' Below 1 Hz the structure is flexible enough for wind or footfall to excite it.' : ''}` });
    }
    const bk = res.buckling;
    if (bk?.ok && bk.modes[0]) out.push({ type: bk.modes[0].lambda < 1 ? 'b' : bk.modes[0].lambda < 3 ? 'w' : 'g', t: `Buckling load factor λ = ${fmtNum(bk.modes[0].lambda, 3)}`, d: bk.modes[0].lambda < 1 ? 'The frame buckles before reaching these loads.' : `The loads can grow ${fmtNum(bk.modes[0].lambda, 3)}× before elastic buckling (imperfections and yielding lower this in practice; design codes want a margin).` });
    if (mdl.members.some(m => m.type === 'truss') && mdl.loads.some(l => l.member && mdl.members.find(m => m.id === l.member)?.type === 'truss')) out.push({ type: 'i', t: 'Loads on truss bars', d: 'Loads applied along a truss bar are carried to its two ends as if it were simply supported, and its bending stress is included.' });
    return out;
  }

  function renderPlot() {
    const R = res.static, mdl = store.model;
    plotSel.replaceChildren();
    if (!R?.ok) { plot.setData({ series: [] }); return; }
    if (!mdl.members.find(m => m.id === ui.plotMember)) ui.plotMember = R.crit.id;
    const k = mdl.members.findIndex(m => m.id === ui.plotMember), mr = R.members[k], m = mdl.members[k];
    plotSel.append(select(mdl.members.map(x => ({ value: x.id, label: memName(x) })), ui.plotMember, v => { ui.plotMember = v; renderPlot(); }, { class: 'select st-sel-sm' }),
      select([{ value: 'N', label: 'Axial force' }, { value: 'V', label: 'Shear Vy, Vz' }, { value: 'M', label: 'Moment Mz, My' }, { value: 'T', label: 'Torque' }, { value: 'd', label: 'Deflection' }, { value: 's', label: 'Stress' }], ui.plotQty, v => { ui.plotQty = v; renderPlot(); }, { class: 'select st-sel-sm' }));
    const x = mr.s.map(s => units.fromSI('len', s)), q = ui.plotQty, series = [];
    const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const add_ = (name, arr, u, color) => series.push({ name, x, y: arr.map(v => units.fromSI(u, v)), color });
    let ylabel = '';
    if (q === 'N') { add_('N', mr.N, 'force', css('--accent')); ylabel = `N (${units.label('force')})`; }
    if (q === 'V') { add_('Vy', mr.Vy, 'force', css('--accent')); add_('Vz', mr.Vz, 'force', css('--warn')); ylabel = units.label('force'); }
    if (q === 'M') { add_('Mz (about the strong axis)', mr.Mz, 'moment', css('--accent')); add_('My (about the weak axis)', mr.My, 'moment', css('--warn')); ylabel = units.label('moment'); }
    if (q === 'T') { add_('T', mr.T, 'moment', css('--warn')); ylabel = units.label('moment'); }
    if (q === 'd') {
      const A = store.node(m.a), B = store.node(m.b), ax = memberAxes([A.x, A.y, A.z || 0], [B.x, B.y, B.z || 0], m.roll || 0);
      const loc = r => mr.dg.map(d => d[0] * ax.R[r][0] + d[1] * ax.R[r][1] + d[2] * ax.R[r][2]);
      add_('v (local y)', loc(1), 'disp', css('--accent')); add_('w (local z)', loc(2), 'disp', css('--warn')); add_('u (axial)', loc(0), 'disp', css('--text-3')); ylabel = units.label('disp');
    }
    if (q === 's') { add_('Peak normal σ', mr.sig, 'stress', css('--accent')); add_('Peak shear τ', mr.tau, 'stress', css('--warn')); add_('Von Mises', mr.vm, 'stress', css('--bad')); ylabel = units.label('stress'); }
    plot.setOpts({ xlabel: `distance from ${nodeName(m.a)} (${units.label('len')})`, ylabel });
    plot.setData({ series, hlines: q === 's' ? [{ y: units.fromSI('stress', res.P.members[k].fy), label: 'yield', color: css('--bad'), bound: false }] : [] });
  }

  function renderTables() {
    for (const [k, b] of Object.entries(tBtns)) b.classList.toggle('on', k === ui.table);
    const R = res.static, mdl = store.model;
    lastTable = null;
    if (!R?.ok) { tableBox.replaceChildren(h('div', { class: 'hint' }, 'No results yet.')); return; }
    let head, rows;
    const f = (q, v) => units.num(q, v, 4);
    if (ui.table === 'reactions') {
      head = ['Node', `Rx ${units.label('force')}`, `Ry ${units.label('force')}`, `Rz ${units.label('force')}`, `Mx ${units.label('moment')}`, `My ${units.label('moment')}`, `Mz ${units.label('moment')}`];
      rows = R.reactions.map(r => [letters(r.i), ...r.F.map((v, d) => f(d < 3 ? 'force' : 'moment', v))]);
      const sum = [0, 0, 0]; for (const r of R.reactions) for (let d = 0; d < 3; d++) sum[d] += r.F[d];
      rows.push({ cls: 'sum', cells: ['Σ forces', ...sum.map(v => f('force', v)), '', '', ''] });
    } else if (ui.table === 'nodes') {
      head = ['Node', `ux ${units.label('disp')}`, `uy`, `uz`, `θx ${units.label('rot')}`, 'θy', 'θz'];
      rows = mdl.nodes.map((n, i) => [letters(i), ...[0, 1, 2].map(d => f('disp', R.U[6 * i + d])), ...[3, 4, 5].map(d => f('rot', R.U[6 * i + d]))]);
    } else if (ui.table === 'forces') {
      head = ['Member', 'End', `N ${units.label('force')}`, 'Vy', 'Vz', `T ${units.label('moment')}`, 'My', 'Mz'];
      rows = [];
      R.members.forEach((mr, k) => { const m = mdl.members[k], n = mr.s.length - 1; for (const [lab, i] of [[nodeName(m.a), 0], [nodeName(m.b), n]]) rows.push([i ? '' : memName(m), lab, f('force', mr.N[i]), f('force', mr.Vy[i]), f('force', mr.Vz[i]), f('moment', mr.T[i]), f('moment', mr.My[i]), f('moment', mr.Mz[i])]); });
    } else if (ui.table === 'stress') {
      head = ['Member', 'Section', `σ max ${units.label('stress')}`, `τ max`, 'von Mises', '% yield', 'N / Euler'];
      rows = R.members.map((mr, k) => { const m = mdl.members[k]; return { cls: mr.stress.util > 1 ? 'bad' : '', cells: [memName(m), mdl.sections.find(s => s.id === m.sec)?.name || '', f('stress', mr.stress.sMax), f('stress', mr.stress.tMax), f('stress', mr.stress.vm), fmtNum(mr.stress.util * 100, 3), mr.euler ? fmtNum(mr.euler.ratio * 100, 3) + '%' : '—'] }; });
    } else {
      const md = res.modal, bk = res.buckling;
      head = ['Mode', 'Frequency Hz', 'Period s', 'Main direction', 'Eff. mass X %', 'Y %', 'Z %', 'Buckling λ'];
      const n = Math.max(md?.modes?.length || 0, bk?.modes?.length || 0);
      rows = Array.from({ length: n }, (_, k) => { const q = md?.modes?.[k], b = bk?.modes?.[k]; return [k + 1, q ? fmtNum(q.f, 5) : '', q ? fmtNum(q.T, 4) : '', q ? q.dominant : '', ...[0, 1, 2].map(d => (q ? fmtNum(q.eff[d] / (md.massFree[d] || 1) * 100, 3) : '')), b ? fmtNum(b.lambda, 5) : '']; });
      if (!n) rows = [['—', md ? 'none' : 'computing…', '', '', '', '', '', '']];
    }
    lastTable = { head, rows };
    tableBox.replaceChildren(table(head, rows));
  }

  // ---------------------------------------------------------------- wiring
  const unsub = store.on(kind => {
    if (kind === 'replace') { if (selection && !(selection.kind === 'node' ? store.node(selection.id) : store.member(selection.id))) selection = null; viewer.fitted = false; }
    recompute(); renderTool(); renderSections(); renderAnalysisOpts(); renderResults(); renderViewExtra(); viewer.draw();
  });
  const onUnits = () => { renderTool(); renderSections(); renderAnalysisOpts(); renderExParams(); renderResults(); viewer.draw(); };
  addEventListener('unitschange', onUnits);
  recompute(); renderTool(); renderSections(); renderAnalysisOpts(); setView('model'); renderResults();
  if (store.model.example) { const ex = EXAMPLES_3D.find(e => e.id === store.model.example); if (ex?.params) { exParams = { id: ex.id, p: Object.fromEntries(ex.params.map(([k, , v]) => [k, v])) }; renderExParams(); } }
  return {
    controls, main,
    show() { requestAnimationFrame(() => { viewer.fitted = false; viewer.fit(); viewer.draw(); plot.draw(); }); },
    hide() { viewer.stop(); },
    destroy() { viewer.stop(); unsub(); removeEventListener('unitschange', onUnits); clearTimeout(dynTimer); },
  };
}
