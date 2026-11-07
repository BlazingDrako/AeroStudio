// Canvas editor and result renderer for the 2-D structure.
// World units are metres (y up); the view is a pan/zoom transform. Tools: select/move, member,
// node, support, load, delete. Views: model, free-body diagram, N, V, M, deflection, stress,
// vibration modes, buckling modes (and an animated mechanism when the structure is unstable).
import { h, cssVar, icon } from '../../lib/ui.js';
import { units, fmtNum } from '../../solvers/units.js';
import { letters } from '../../solvers/statics.js';
import { elementCurve } from '../../solvers/frame2d.js';
import { projT, distToSeg } from './model.js';

const TOOLS = [
  { id: 'select', label: 'Select', key: 'v', tip: 'Select and drag nodes (V). Drag empty space to pan, scroll to zoom.', svg: '<path d="M5 3l14 8-6 1.5L10 19z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' },
  { id: 'member', label: 'Member', key: 'm', tip: 'Draw members (M): click to start, click to place each joint, Esc or right-click to finish.', svg: '<circle cx="5" cy="18" r="2.2" fill="currentColor"/><circle cx="19" cy="6" r="2.2" fill="currentColor"/><path d="M6.5 16.5l11-9" stroke="currentColor" stroke-width="2"/>' },
  { id: 'node', label: 'Node', key: 'n', tip: 'Add a node (N), or click a member to split it.', svg: '<circle cx="12" cy="12" r="3.5" fill="currentColor"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4" stroke="currentColor" stroke-width="1.5"/>' },
  { id: 'support', label: 'Support', key: 's', tip: 'Click a node to place the support chosen in the panel (S).', svg: '<path d="M12 6l-6 9h12z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M4 18h16M6 21l2-3M10 21l2-3M14 21l2-3" stroke="currentColor" stroke-width="1.4"/>' },
  { id: 'load', label: 'Load', key: 'l', tip: 'Click a node (force, moment) or a member (distributed, point, thermal) to add the load chosen in the panel (L).', svg: '<path d="M12 3v14M7 12l5 6 5-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 21h14" stroke="currentColor" stroke-width="1.6"/>' },
  { id: 'delete', label: 'Delete', key: 'x', tip: 'Click anything to delete it (X).', svg: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' },
];

export class StructureEditor {
  constructor(store, app) {
    this.store = store; this.app = app;
    this.tool = 'select'; this.sel = null; this.hover = null; this.chain = null; this.cursor = null;
    this.scale = 60; this.ox = 80; this.oy = 300; this.fitted = false;
    this.t0 = performance.now(); this.anim = 0;
    this.stage = h('div', { class: 'stage st-stage', tabindex: 0 });
    this.canvas = h('canvas');
    this.readout = h('div', { class: 'readout' });
    this.toolbar = h('div', { class: 'st-tools' });
    this.banner = h('div', { class: 'st-banner' });
    this.legend = h('div', { class: 'legend', style: { display: 'none' } });
    this.stage.append(this.canvas, this.toolbar, this.readout, this.banner, this.legend);
    this.ctx = this.canvas.getContext('2d');
    this.toolBtns = {};
    for (const t of TOOLS) {
      const b = h('button', { type: 'button', class: 'st-tool', title: `${t.tip}` , 'aria-label': t.label, html: `<svg viewBox="0 0 24 24" width="18" height="18">${t.svg}</svg>` });
      b.addEventListener('click', () => this.setTool(t.id));
      this.toolbar.append(b); this.toolBtns[t.id] = b;
    }
    const sep = () => h('span', { class: 'st-sep' });
    const undo = h('button', { type: 'button', class: 'st-tool', title: 'Undo (⌘/Ctrl+Z)', html: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' });
    const redo = h('button', { type: 'button', class: 'st-tool', title: 'Redo (⇧⌘/Ctrl+Shift+Z)', html: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M15 7l5 5-5 5M20 12H9a5 5 0 0 0 0 10h3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' });
    const fit = h('button', { type: 'button', class: 'st-tool', title: 'Fit to view (F)', html: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' });
    undo.addEventListener('click', () => store.undo()); redo.addEventListener('click', () => store.redo()); fit.addEventListener('click', () => { this.fit(); this.draw(); });
    this.toolbar.append(sep(), undo, redo, fit);
    this.setTool('select');
    new ResizeObserver(() => { if (!this.fitted && this.store.model.nodes.length) this.fit(); this.draw(); }).observe(this.stage);
    addEventListener('themechange', () => this.draw());
    this.bind();
  }

  setTool(t) {
    this.tool = t; this.chain = null;
    for (const [k, b] of Object.entries(this.toolBtns)) b.classList.toggle('on', k === t);
    this.stage.dataset.tool = t;
    this.app.onTool && this.app.onTool(t);
    this.draw();
  }

  // ---------------------------------------------------------------- transforms
  X(x) { return this.ox + x * this.scale; }
  Y(y) { return this.oy - y * this.scale; }
  wx(X) { return (X - this.ox) / this.scale; }
  wy(Y) { return (this.oy - Y) / this.scale; }
  fit() {
    const W = this.stage.clientWidth, H = this.stage.clientHeight, ns = this.store.model.nodes;
    if (!W || !H) return;
    this.fitted = true;
    if (!ns.length) { const s = 10 * units.factor('len'); this.scale = Math.min(W, H) / (s * 1.2); this.ox = W * 0.15; this.oy = H * 0.7; return; }
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const n of ns) { x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y); }
    const span = Math.max(x1 - x0, y1 - y0, 0.5);
    const narrow = W < 600, padL = narrow ? 66 : 110, padR = narrow ? 30 : 100, padT = 80, padB = 90;
    this.scale = Math.min((W - padL - padR) / Math.max(x1 - x0, span * 0.25), (H - padT - padB) / Math.max(y1 - y0, span * 0.25));
    this.ox = padL + (W - padL - padR - (x1 - x0) * this.scale) / 2 - x0 * this.scale;
    this.oy = padT + (H - padT - padB - (y1 - y0) * this.scale) / 2 + y1 * this.scale;
  }
  gridStep() {
    const f = units.factor('len'), target = 26 / this.scale / f;
    const p = 10 ** Math.floor(Math.log10(target)), m = target / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p * f;
  }
  modelSize() {
    const ns = this.store.model.nodes; if (!ns.length) return 1;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const n of ns) { x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y); }
    return Math.max(x1 - x0, y1 - y0, 1e-3);
  }

  // ---------------------------------------------------------------- input
  bind() {
    const cv = this.canvas;
    let drag = null;
    const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('contextmenu', e => { e.preventDefault(); if (this.chain) { this.chain = null; this.draw(); } });
    cv.addEventListener('pointerdown', e => {
      this.stage.focus({ preventScroll: true });
      const [mx, my] = pos(e);
      if (e.button === 1 || (e.button === 0 && e.altKey && e.shiftKey)) { drag = { pan: true, mx, my, ox: this.ox, oy: this.oy }; cv.setPointerCapture(e.pointerId); return; }
      if (e.button !== 0) return;
      const hit = this.hitTest(mx, my);
      const snap = this.snap(mx, my, e.altKey);
      switch (this.tool) {
        case 'select':
          if (hit) {
            this.select(hit);
            if (hit.kind === 'node') drag = { node: hit.id, mx, my, moved: false };
          } else { this.select(null); drag = { pan: true, mx, my, ox: this.ox, oy: this.oy }; }
          break;
        case 'member': this.memberClick(snap); break;
        case 'node': this.store.commit(); { const n = this.store.ensureNode(snap.x, snap.y, 8 / this.scale); this.select({ kind: 'node', id: n.id }); } this.store.changed(); break;
        case 'support': if (hit && hit.kind === 'node' || hit?.kind === 'support') this.app.applySupport(hit.kind === 'node' ? hit.id : hit.id); else this.flash('Click a node to place the support'); break;
        case 'load': this.loadClick(hit, mx, my, e.altKey); break;
        case 'delete': if (hit) this.deleteHit(hit); break;
      }
      if (drag) cv.setPointerCapture(e.pointerId);
      this.draw();
    });
    cv.addEventListener('pointermove', e => {
      const [mx, my] = pos(e);
      this.cursor = { mx, my, ...this.snap(mx, my, e.altKey) };
      if (drag && drag.pan) { this.ox = drag.ox + mx - drag.mx; this.oy = drag.oy + my - drag.my; this.draw(); return; }
      if (drag && drag.node) {
        if (!drag.moved && Math.hypot(mx - drag.mx, my - drag.my) < 3) return;
        const n = this.store.node(drag.node);
        if (!drag.moved) { this.store.commit(); drag.moved = true; }
        const s = this.snap(mx, my, e.altKey, drag.node);
        n.x = s.x; n.y = s.y;
        this.app.live && this.app.live();
        this.draw(); return;
      }
      this.hover = this.hitTest(mx, my);
      this.updateReadout();
      this.draw();
    });
    const end = () => { if (drag && drag.node && drag.moved) this.store.changed(); drag = null; };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', () => { this.cursor = null; this.hover = null; this.readout.style.display = 'none'; this.draw(); });
    cv.addEventListener('dblclick', () => { if (this.chain) { this.chain = null; this.draw(); } });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const [mx, my] = pos(e), k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      const wx = this.wx(mx), wy = this.wy(my);
      this.scale = Math.min(1e5, Math.max(0.5, this.scale * k));
      this.ox = mx - wx * this.scale; this.oy = my + wy * this.scale;
      this.draw();
    }, { passive: false });
    this.stage.addEventListener('keydown', e => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.store.redo() : this.store.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); this.store.redo(); return; }
      if (e.target !== this.stage) return;
      if (e.key === 'Escape') { this.chain = null; this.select(null); this.draw(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel) { e.preventDefault(); this.deleteHit(this.sel); return; }
      if (e.key === 'f') { this.fit(); this.draw(); return; }
      const t = TOOLS.find(t => t.key === e.key.toLowerCase()); if (t && !mod) this.setTool(t.id);
    });
  }

  snap(mx, my, free = false, exclude = null) {
    const tol = 10 / this.scale, x = this.wx(mx), y = this.wy(my);
    for (const n of this.store.model.nodes) if (n.id !== exclude && Math.hypot(n.x - x, n.y - y) <= tol) return { x: n.x, y: n.y, node: n.id };
    if (free) return { x, y };
    const g = this.gridStep();
    return { x: Math.round(x / g) * g, y: Math.round(y / g) * g };
  }

  memberClick(s) {
    const st = this.store, tol = 8 / this.scale;
    if (!this.chain) { this.chain = { x: s.x, y: s.y }; return; }
    if (Math.hypot(s.x - this.chain.x, s.y - this.chain.y) < 1e-9) return;
    st.commit();
    const a = st.ensureNode(this.chain.x, this.chain.y, tol), b = st.ensureNode(s.x, s.y, tol);
    const m = st.addMember(a, b, this.app.memberDefaults());
    if (m) this.select({ kind: 'member', id: m.id }, false);
    this.chain = { x: b.x, y: b.y };
    st.changed();
  }
  loadClick(hit, mx, my, free) {
    const p = this.app.loadPalette();
    const onNode = p.kind === 'force' || p.kind === 'moment';
    if (onNode) {
      let nodeId = hit && hit.kind === 'node' ? hit.id : null;
      if (!nodeId && hit && hit.kind === 'member') {
        // a nodal load clicked on a member: put it there as a point load instead
        return this.loadOnMember(hit.id, mx, my, free, p.kind === 'force' ? 'point' : 'mpoint');
      }
      if (!nodeId) { this.flash('Click a node (or a member) to place the load'); return; }
      this.app.applyLoad({ node: nodeId });
    } else {
      if (!hit || hit.kind !== 'member') { this.flash('Click a member to place this load'); return; }
      this.loadOnMember(hit.id, mx, my, free, p.kind);
    }
  }
  loadOnMember(id, mx, my, free, kind) {
    const m = this.store.member(id), a = this.store.node(m.a), b = this.store.node(m.b);
    let t = Math.max(0, Math.min(1, projT(a, b, this.wx(mx), this.wy(my))));
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (!free) { const g = this.gridStep() / 2; t = Math.max(0, Math.min(1, Math.round(t * L / g) * g / L)); }
    this.app.applyLoad({ member: id, t, kind });
  }
  deleteHit(hit) {
    const st = this.store; st.commit();
    const mdl = st.model;
    if (hit.kind === 'node') st.deleteNode(hit.id);
    else if (hit.kind === 'member') st.deleteMember(hit.id);
    else if (hit.kind === 'support') mdl.supports = mdl.supports.filter(s => s.node !== hit.id);
    else if (hit.kind === 'load') mdl.loads = mdl.loads.filter(l => l.id !== hit.id);
    if (this.sel && this.sel.kind === hit.kind && this.sel.id === hit.id) this.select(null, false);
    st.changed();
  }
  select(hit, notify = true) { this.sel = hit; if (notify || true) this.app.onSelect && this.app.onSelect(hit); }
  flash(msg) { this.banner.textContent = msg; this.banner.classList.add('show'); clearTimeout(this._fl); this._fl = setTimeout(() => this.banner.classList.remove('show'), 1800); }

  hitTest(mx, my) {
    const mdl = this.store.model;
    // loads and supports first (their glyphs sit on top)
    if (this.hits) for (let i = this.hits.length - 1; i >= 0; i--) { const hb = this.hits[i]; if (hb.test(mx, my)) return { kind: hb.kind, id: hb.id }; }
    let best = null, bd = 9;
    for (const n of mdl.nodes) { const d = Math.hypot(this.X(n.x) - mx, this.Y(n.y) - my); if (d < bd) { bd = d; best = { kind: 'node', id: n.id }; } }
    if (best) return best;
    bd = 7;
    for (const m of mdl.members) {
      const a = this.store.node(m.a), b = this.store.node(m.b);
      const d = distToSeg({ x: this.X(a.x), y: this.Y(a.y) }, { x: this.X(b.x), y: this.Y(b.y) }, mx, my);
      if (d < bd) { bd = d; best = { kind: 'member', id: m.id }; }
    }
    return best;
  }

  // ---------------------------------------------------------------- drawing
  draw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.render(); });
  }
  render() {
    const c = this.canvas, W = this.stage.clientWidth, H = this.stage.clientHeight;
    if (!W || !H) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const g = this.ctx; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    this.W = W; this.H = H;
    this.col = {
      text: cssVar('--text'), t2: cssVar('--text-2'), t3: cssVar('--text-3'), border: cssVar('--border'), strong: cssVar('--border-strong'),
      accent: cssVar('--accent'), good: cssVar('--good'), bad: cssVar('--bad'), warn: cssVar('--warn'), load: cssVar('--lower'), turb: cssVar('--turb'), lam: cssVar('--lam'), bg: cssVar('--bg-elev'), stage: cssVar('--stage'), mono: cssVar('--mono'), font: cssVar('--font'),
    };
    this.hits = []; this.legendMsg = null;
    this.drawGrid(g);
    const ui = this.app.ui, res = this.app.results(), view = ui.view;
    const R = res.static;
    const faded = ['N', 'V', 'M', 'defl', 'stress', 'modes', 'buckling'].includes(view) && R && R.ok;
    // mechanism animation
    let animating = false;
    if (R && !R.ok && R.error === 'mechanism' && R.shape) { this.drawMechanism(g, R); animating = true; }
    if (view === 'defl' && R?.ok) { this.drawMembers(g, { faded: true, dashed: true }); this.drawDeflection(g, R); animating = ui.animate; }
    else if (view === 'modes' || view === 'buckling') {
      this.drawMembers(g, { faded: true, dashed: true });
      animating = this.drawModes(g, view === 'modes' ? res.modal : res.buckling, view) || animating;
    } else if (view === 'stress' && R?.ok) this.drawStress(g, R);
    else if (view === 'N' && R?.ok) { /* drawn by drawAxial */ }
    else this.drawMembers(g, { faded });
    if (['N', 'V', 'M'].includes(view) && R?.ok) this.drawDiagram(g, R, view);
    const showLoads = !['modes', 'buckling', 'N', 'V', 'M', 'defl', 'stress'].includes(view) || !(R && R.ok);
    if (view === 'fbd') this.drawFBD(g, res);
    else { this.drawSupports(g, faded); if (showLoads) this.drawLoads(g, faded); }
    this.drawNodes(g, faded);
    if (ui.labels) this.drawLabels(g, view);
    this.drawSelection(g);
    this.drawCursor(g);
    this.showLegend(view === 'stress' && R?.ok);
    if (animating) { if (!this._animOn) { this._animOn = true; const tick = () => { if (!this._animOn) return; this.render(); this._animRaf = requestAnimationFrame(tick); }; this._animRaf = requestAnimationFrame(tick); } }
    else if (this._animOn) { this._animOn = false; cancelAnimationFrame(this._animRaf); }
  }
  phase() { return (performance.now() - this.t0) / 1000; }

  drawGrid(g) {
    const step = this.gridStep(), { W, H } = this;
    const x0 = Math.floor(this.wx(0) / step), x1 = Math.ceil(this.wx(W) / step), y0 = Math.floor(this.wy(H) / step), y1 = Math.ceil(this.wy(0) / step);
    if ((x1 - x0) * (y1 - y0) > 40000) return;
    g.fillStyle = this.col.strong;
    for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) {
      const X = this.X(i * step), Y = this.Y(j * step), major = i % 5 === 0 && j % 5 === 0;
      g.globalAlpha = major ? 0.9 : 0.45; g.fillRect(X - (major ? 1 : 0.6), Y - (major ? 1 : 0.6), major ? 2 : 1.2, major ? 2 : 1.2);
    }
    g.globalAlpha = 1;
    // axes
    g.strokeStyle = this.col.border; g.lineWidth = 1; g.beginPath();
    g.moveTo(this.X(0), 0); g.lineTo(this.X(0), H); g.moveTo(0, this.Y(0)); g.lineTo(W, this.Y(0)); g.stroke();
    // scale bar
    const f = units.factor('len'), lab = fmtNum(step * 5 / f, 3) + ' ' + units.label('len');
    const L = step * 5 * this.scale, bx = W - L - 18, by = H - 16;
    g.strokeStyle = this.col.t3; g.lineWidth = 1.2; g.beginPath(); g.moveTo(bx, by - 4); g.lineTo(bx, by); g.lineTo(bx + L, by); g.lineTo(bx + L, by - 4); g.stroke();
    g.fillStyle = this.col.t3; g.font = `10.5px ${this.col.mono}`; g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText(lab, bx + L / 2, by - 3);
  }

  memberPts(m) { const a = this.store.node(m.a), b = this.store.node(m.b); return [a, b]; }
  drawMembers(g, { faded = false, dashed = false } = {}) {
    const R = this.app.results().static;
    for (const m of this.store.model.members) {
      const [a, b] = this.memberPts(m);
      const X1 = this.X(a.x), Y1 = this.Y(a.y), X2 = this.X(b.x), Y2 = this.Y(b.y);
      const type = m.type || 'frame';
      const slack = R?.ok && R.members.find(x => x.id === m.id)?.slack;
      g.strokeStyle = faded ? this.col.strong : (slack ? this.col.warn : this.col.text);
      g.lineWidth = type === 'frame' ? (faded ? 2 : 3.2) : type === 'truss' ? (faded ? 1.6 : 2.4) : 1.6;
      g.setLineDash(type === 'cable' ? [6, 4] : dashed ? [5, 4] : []);
      g.lineCap = 'round';
      g.beginPath(); g.moveTo(X1, Y1); g.lineTo(X2, Y2); g.stroke(); g.setLineDash([]);
      // hinges
      const L = Math.hypot(X2 - X1, Y2 - Y1) || 1, ux = (X2 - X1) / L, uy = (Y2 - Y1) / L;
      for (const [rel, X, Y, s] of [[m.relA, X1, Y1, 1], [m.relB, X2, Y2, -1]]) {
        if (!rel || type !== 'frame') continue;
        const cx = X + s * ux * 9, cy = Y + s * uy * 9;
        g.beginPath(); g.arc(cx, cy, 4.2, 0, 2 * Math.PI); g.fillStyle = this.col.stage; g.fill(); g.lineWidth = 1.6; g.strokeStyle = faded ? this.col.strong : this.col.text; g.stroke();
      }
    }
    // rubber band for member tool
    if (this.tool === 'member' && this.chain && this.cursor) {
      g.strokeStyle = this.col.accent; g.lineWidth = 2; g.setLineDash([6, 4]);
      g.beginPath(); g.moveTo(this.X(this.chain.x), this.Y(this.chain.y)); g.lineTo(this.X(this.cursor.x), this.Y(this.cursor.y)); g.stroke(); g.setLineDash([]);
      const L = Math.hypot(this.cursor.x - this.chain.x, this.cursor.y - this.chain.y), ang = Math.atan2(this.cursor.y - this.chain.y, this.cursor.x - this.chain.x) * 180 / Math.PI;
      this.tag(g, (this.X(this.chain.x) + this.X(this.cursor.x)) / 2, (this.Y(this.chain.y) + this.Y(this.cursor.y)) / 2 - 14, `${units.num('len', L, 4)} ${units.label('len')} · ${ang.toFixed(1)}°`, this.col.accent);
    }
  }
  drawNodes(g, faded) {
    const sup = new Set(this.store.model.supports.map(s => s.node));
    for (const n of this.store.model.nodes) {
      const X = this.X(n.x), Y = this.Y(n.y);
      g.beginPath(); g.arc(X, Y, sup.has(n.id) ? 3.6 : 3.2, 0, 2 * Math.PI);
      g.fillStyle = this.col.bg; g.fill(); g.lineWidth = 1.6; g.strokeStyle = faded ? this.col.strong : this.col.text; g.stroke();
      if (n.mass > 0) { g.fillStyle = this.col.t2; g.beginPath(); g.arc(X, Y, 5.5, 0, 2 * Math.PI); g.globalAlpha = 0.35; g.fill(); g.globalAlpha = 1; }
    }
  }
  drawLabels(g, view) {
    g.font = `600 11px ${this.col.font}`; g.textBaseline = 'middle'; g.textAlign = 'center';
    this.store.model.nodes.forEach((n, i) => {
      const X = this.X(n.x), Y = this.Y(n.y);
      g.fillStyle = this.col.t2; g.fillText(letters(i), X - 10, Y - 11);
    });
    if (view !== 'model') return;
    g.font = `10px ${this.col.mono}`;
    this.store.model.members.forEach((m, i) => {
      const [a, b] = this.memberPts(m), X = (this.X(a.x) + this.X(b.x)) / 2, Y = (this.Y(a.y) + this.Y(b.y)) / 2;
      const t = String(i + 1), w = g.measureText(t).width + 8;
      g.fillStyle = this.col.bg; g.strokeStyle = this.col.border; g.lineWidth = 1;
      roundRect(g, X - w / 2, Y - 8, w, 16, 4); g.fill(); g.stroke();
      g.fillStyle = this.col.t3; g.fillText(t, X, Y + 0.5);
    });
  }
  tag(g, X, Y, text, color) {
    g.font = `10.5px ${this.col.mono}`; const w = g.measureText(text).width + 10;
    g.fillStyle = this.col.bg; g.globalAlpha = 0.88; roundRect(g, X - w / 2, Y - 8, w, 16, 4); g.fill(); g.globalAlpha = 1;
    g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, X, Y + 0.5);
  }

  // ---- supports
  drawSupports(g, faded) {
    for (const sp of this.store.model.supports) {
      const n = this.store.node(sp.node); if (!n) continue;
      const X = this.X(n.x), Y = this.Y(n.y), a = (sp.angle || 0) * Math.PI / 180;
      g.save(); g.translate(X, Y); g.rotate(-a);
      g.strokeStyle = faded ? this.col.t3 : this.col.t2; g.fillStyle = this.col.bg; g.lineWidth = 1.5; g.lineJoin = 'round';
      supportGlyph(g, sp, this.col);
      g.restore();
      const cx = X + Math.sin(a) * 12, cy = Y + Math.cos(a) * 12;
      this.hits.push({ kind: 'support', id: sp.node, test: (mx, my) => Math.hypot(mx - cx, my - cy) < 11 });
    }
  }

  // ---- loads
  loadScale() {
    let F = 0, Wd = 0, Mm = 0;
    for (const l of this.store.model.loads) {
      if (l.kind === 'force' || l.kind === 'point') F = Math.max(F, Math.hypot(l.fx || 0, l.fy || 0));
      if (l.kind === 'dist') Wd = Math.max(Wd, Math.abs(l.w1), Math.abs(l.w2));
      if (l.kind === 'moment' || l.kind === 'mpoint') Mm = Math.max(Mm, Math.abs(l.m));
    }
    return { F: F || 1, W: Wd || 1, M: Mm || 1 };
  }
  drawLoads(g, faded) {
    const sc = this.loadScale(), col = faded ? this.col.t3 : this.col.load;
    for (const l of this.store.model.loads) {
      if (l.node) {
        const n = this.store.node(l.node); if (!n) continue;
        const X = this.X(n.x), Y = this.Y(n.y);
        if (l.kind === 'force') {
          const F = Math.hypot(l.fx, l.fy); if (!F) continue;
          const len = 26 + 30 * F / sc.F, ux = l.fx / F, uy = -l.fy / F;
          const tx = X - ux * (len + 4), ty = Y - uy * (len + 4);
          arrow(g, tx, ty, X - ux * 4, Y - uy * 4, col, 2);
          this.loadTag(g, tx - ux * 4, ty - uy * 4, units.fmt('force', F, 3), col, ux, uy);
          this.hits.push({ kind: 'load', id: l.id, test: (mx, my) => distToSeg({ x: tx, y: ty }, { x: X, y: Y }, mx, my) < 6 });
        } else if (l.kind === 'moment') {
          momentArc(g, X, Y, 18, l.m, col);
          this.tag(g, X + 26, Y - 22, units.fmt('moment', Math.abs(l.m), 3), col);
          this.hits.push({ kind: 'load', id: l.id, test: (mx, my) => Math.abs(Math.hypot(mx - X, my - Y) - 18) < 6 });
        }
      } else {
        const m = this.store.member(l.member); if (!m) continue;
        const [a, b] = this.memberPts(m), X1 = this.X(a.x), Y1 = this.Y(a.y), X2 = this.X(b.x), Y2 = this.Y(b.y);
        const P = t => [X1 + (X2 - X1) * t, Y1 + (Y2 - Y1) * t];
        if (l.kind === 'dist') this.drawDist(g, l, a, b, P, sc, col);
        else if (l.kind === 'point') {
          const [X, Y] = P(l.t), F = Math.hypot(l.fx, l.fy); if (!F) continue;
          const len = 26 + 30 * F / sc.F, ux = l.fx / F, uy = -l.fy / F;
          const tx = X - ux * len, ty = Y - uy * len;
          arrow(g, tx, ty, X - ux * 2, Y - uy * 2, col, 2);
          this.loadTag(g, tx - ux * 4, ty - uy * 4, units.fmt('force', F, 3), col, ux, uy);
          this.hits.push({ kind: 'load', id: l.id, test: (mx, my) => distToSeg({ x: tx, y: ty }, { x: X, y: Y }, mx, my) < 6 });
        } else if (l.kind === 'mpoint') {
          const [X, Y] = P(l.t); momentArc(g, X, Y, 16, l.m, col);
          this.tag(g, X + 24, Y - 20, units.fmt('moment', Math.abs(l.m), 3), col);
          this.hits.push({ kind: 'load', id: l.id, test: (mx, my) => Math.abs(Math.hypot(mx - X, my - Y) - 16) < 6 });
        } else if (l.kind === 'thermal') {
          const [X, Y] = P(0.5), L = Math.hypot(X2 - X1, Y2 - Y1) || 1, nx = (Y2 - Y1) / L, ny = -(X2 - X1) / L;
          const txt = `ΔT ${fmtNum(units.fromSI('dtemp', l.dT), 3)}${units.label('dtemp')}` + (l.dTg ? ` · ∇ ${fmtNum(units.fromSI('dtemp', l.dTg), 3)}` : '');
          g.strokeStyle = this.col.bad; g.lineWidth = 5; g.globalAlpha = 0.25; g.beginPath(); g.moveTo(X1, Y1); g.lineTo(X2, Y2); g.stroke(); g.globalAlpha = 1;
          this.tag(g, X - nx * 16, Y - ny * 16, txt, this.col.bad);
          this.hits.push({ kind: 'load', id: l.id, test: (mx, my) => Math.hypot(mx - (X - nx * 16), my - (Y - ny * 16)) < 14 });
        }
      }
    }
  }
  loadTag(g, X, Y, text, col, ux, uy) {
    g.font = `10.5px ${this.col.mono}`; const w = g.measureText(text).width;
    const ox = -ux * (w / 2 + 6), oy = -uy * 9;
    this.tag(g, X + ox, Y + oy, text, col);
  }
  drawDist(g, l, a, b, P, sc, col) {
    const m = this.store.member(l.member), t0 = l.t0 ?? 0, t1 = l.t1 ?? 1, dir = l.dir || 'gy';
    const L = Math.hypot(b.x - a.x, b.y - a.y), c = (b.x - a.x) / L, s = (b.y - a.y) / L;
    // world direction of a positive load
    let d = dir[0] === 'l' ? (dir === 'ly' ? [-s, c] : [c, s]) : (dir[1] === 'x' ? [1, 0] : [0, 1]);
    const n = Math.max(3, Math.round(Math.hypot(...[P(t1)[0] - P(t0)[0], P(t1)[1] - P(t0)[1]]) / 22));
    const tails = [];
    for (let k = 0; k <= n; k++) {
      const t = t0 + (t1 - t0) * k / n, w = l.w1 + (l.w2 - l.w1) * k / n;
      const [X, Y] = P(t), len = 6 + 34 * Math.abs(w) / sc.W, sgn = Math.sign(w) || 1;
      const ux = d[0] * sgn, uy = -d[1] * sgn;
      const tx = X - ux * len, ty = Y - uy * len;
      tails.push([tx, ty]);
      if (Math.abs(w) > 0) arrow(g, tx, ty, X - ux * 1.5, Y - uy * 1.5, col, 1.3, 6);
    }
    g.strokeStyle = col; g.lineWidth = 1.3; g.beginPath(); tails.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
    const mid = tails[Math.floor(tails.length / 2)], unit = units.label('dist');
    const lab = Math.abs(l.w1 - l.w2) < 1e-9 * Math.max(1, Math.abs(l.w1)) ? `${units.num('dist', Math.abs(l.w1), 3)} ${unit}` : `${units.num('dist', l.w1, 3)} → ${units.num('dist', l.w2, 3)} ${unit}`;
    const sgnm = Math.sign(l.w1 + l.w2) || 1;
    this.tag(g, mid[0] - d[0] * sgnm * 12, mid[1] + d[1] * sgnm * 12, lab + (dir === 'gyp' || dir === 'gxp' ? ' (proj.)' : ''), col);
    const poly = tails.concat([P(t1), P(t0)]);
    this.hits.push({ kind: 'load', id: l.id, test: (mx, my) => pointInPoly(mx, my, poly) });
    void m;
  }

  // ---- FBD
  drawFBD(g, res) {
    const R = res.static, S = res.statics, ui = this.app.ui;
    this.drawLoads(g, false);
    const body = ui.fbdBody ?? -1;
    if (body >= 0 && S?.x) { this.drawBodyForces(g, S, body); return; }
    if (!R || !R.ok) { if (S?.x) this.drawStaticsReactions(g, S); return; }
    const sc = Math.max(1e-9, ...R.reactions.map(r => Math.max(Math.abs(r.Rx), Math.abs(r.Ry))));
    const col = this.col.good;
    for (const r of R.reactions) {
      const i = this.store.model.nodes.findIndex(n => n.id === r.node), n = this.store.model.nodes[i];
      const X = this.X(n.x), Y = this.Y(n.y), lab = letters(i);
      const inc = Math.abs(r.angle) > 1e-9 || r.type === 'contact';
      const a = r.angle * Math.PI / 180, comps = inc
        ? [[r.Rt, [Math.cos(a), Math.sin(a)], r.type === 'contact' ? `F_${lab}` : `${lab}_t`], [r.Rn, [-Math.sin(a), Math.cos(a)], r.type === 'contact' ? `N_${lab}` : `${lab}_n`]]
        : [[r.Rx, [1, 0], `${lab}_x`], [r.Ry, [0, 1], `${lab}_y`]];
      for (const [v, d, name] of comps) {
        if (Math.abs(v) < 1e-9 * sc) continue;
        const ux = d[0] * Math.sign(v), uy = -d[1] * Math.sign(v), len = 28 + 30 * Math.abs(v) / sc;
        const tx = X - ux * (len + 5), ty = Y - uy * (len + 5);
        arrow(g, tx, ty, X - ux * 5, Y - uy * 5, col, 2.2);
        this.tag(g, tx - ux * 8 + (uy ? 0 : 0), ty - uy * 10, `${name} = ${units.fmt('force', Math.abs(v), 4)}`, col);
      }
      if (Math.abs(r.Mz) > 1e-9 * sc * this.modelSize()) {
        momentArc(g, X, Y, 20, r.Mz, col);
        this.tag(g, X - 34, Y + 26, `M_${lab} = ${units.fmt('moment', Math.abs(r.Mz), 4)}`, col);
      }
    }
  }
  drawStaticsReactions(g, S) {
    // unstable or stiffness failed but statics solved: draw reactions from the statics solution
    for (const u of S.values || []) {
      if (!['reaction', 'normal', 'friction'].includes(u.role) || u.kind !== 'F') continue;
      const n = this.store.model.nodes[u.node], X = this.X(n.x), Y = this.Y(n.y), v = u.value;
      const ux = u.dir[0] * Math.sign(v), uy = -u.dir[1] * Math.sign(v);
      arrow(g, X - ux * 45, Y - uy * 45, X - ux * 5, Y - uy * 5, this.col.good, 2.2);
      this.tag(g, X - ux * 52, Y - uy * 56, `${u.name} = ${units.fmt('force', Math.abs(v), 4)}`, this.col.good);
    }
  }
  drawBodyForces(g, S, body) {
    const { items, unknowns } = S.S, x = S.x, nodes = this.store.model.nodes;
    // highlight body members
    const T = S.T, B = T.bodies[body];
    g.strokeStyle = this.col.accent; g.lineWidth = 4; g.globalAlpha = 0.35;
    for (const k of B.members) { const m = T.P.members[k], a = nodes[m.i], b = nodes[m.j]; g.beginPath(); g.moveTo(this.X(a.x), this.Y(a.y)); g.lineTo(this.X(b.x), this.Y(b.y)); g.stroke(); }
    g.globalAlpha = 1;
    // aggregate unknown forces acting on the body
    const agg = new Map();
    for (const it of items) {
      if (it.tb !== body || it.u < 0) continue;
      const u = unknowns[it.u], key = it.u;
      const v = x[it.u];
      if (!agg.has(key)) agg.set(key, { name: u.name, px: it.px, py: it.py, fx: 0, fy: 0, m: 0, role: u.role });
      const a = agg.get(key);
      if (u.role === 'member') { a.fx += it.fx * v; a.fy += it.fy * v; } else { a.fx += it.fx * v; a.fy += it.fy * v; a.m += it.m * v; }
    }
    const sc = Math.max(1e-9, ...[...agg.values()].map(a => Math.hypot(a.fx, a.fy)));
    for (const a of agg.values()) {
      const X = this.X(a.px), Y = this.Y(a.py), F = Math.hypot(a.fx, a.fy);
      const col = a.role === 'pin' ? this.col.turb : a.role === 'member' || a.role === 'cable' ? this.col.lam : this.col.good;
      if (F > 1e-9 * sc) {
        const ux = a.fx / F, uy = -a.fy / F, len = 28 + 30 * F / sc;
        arrow(g, X - ux * (len + 5), Y - uy * (len + 5), X - ux * 5, Y - uy * 5, col, 2.2);
        this.tag(g, X - ux * (len + 14), Y - uy * (len + 14), `${a.name} = ${units.fmt('force', F, 4)}`, col);
      }
      if (Math.abs(a.m) > 0) { momentArc(g, X, Y, 20, a.m, col); this.tag(g, X - 30, Y + 26, `${a.name} = ${units.fmt('moment', Math.abs(a.m), 4)}`, col); }
    }
  }

  // ---- diagrams
  drawDiagram(g, R, q) {
    const ui = this.app.ui;
    let mx = 0; for (const m of R.members) mx = Math.max(mx, m.ext[q].abs);
    if (!(mx > 0)) { this.flash(`${q} is zero everywhere`); return; }
    if (q === 'N') { this.drawAxial(g, R, mx); return; }
    const k = 55 * (ui.diagScale || 1) / mx; // px per unit
    const colPos = q === 'M' ? this.col.accent : q === 'V' ? this.col.lam : this.col.turb, colNeg = this.col.load;
    const flip = q === 'M' && ui.mTension ? -1 : 1;
    const qty = q === 'M' ? 'moment' : 'force';
    for (const mr of R.members) {
      const m = this.store.member(mr.id), [a, b] = this.memberPts(m);
      const L = mr.L, c = (b.x - a.x) / L, s = (b.y - a.y) / L, nx = -s, ny = c;
      const vals = mr[q], xs = mr.x;
      const base = x => [this.X(a.x + c * x), this.Y(a.y + s * x)];
      // fill positive and negative parts separately
      for (const sign of [1, -1]) {
        g.beginPath();
        let started = false;
        for (let i = 0; i < xs.length; i++) {
          const v = vals[i] * (sign * vals[i] > 0 ? 1 : 0);
          const [X, Y] = base(xs[i]);
          const px = X + nx * v * k * flip, py = Y - ny * v * k * flip;
          if (!started) { g.moveTo(X, Y); started = true; }
          g.lineTo(px, py);
        }
        const [Xe, Ye] = base(L); g.lineTo(Xe, Ye); g.closePath();
        g.fillStyle = sign > 0 ? colPos : colNeg; g.globalAlpha = 0.22; g.fill(); g.globalAlpha = 1;
      }
      g.beginPath();
      for (let i = 0; i < xs.length; i++) { const [X, Y] = base(xs[i]), v = vals[i]; const px = X + nx * v * k * flip, py = Y - ny * v * k * flip; i ? g.lineTo(px, py) : g.moveTo(px, py); }
      g.strokeStyle = colPos; g.lineWidth = 1.6; g.stroke();
      // labels at extremes and ends
      const marks = [];
      const ex = mr.ext[q];
      const add = (x, v) => { if (Math.abs(v) < 0.02 * mx) return; if (marks.some(p => Math.abs(p.x - x) < 0.08 * L && Math.abs(p.v - v) < 0.05 * mx)) return; marks.push({ x, v }); };
      add(ex.xmax, ex.max); add(ex.xmin, ex.min); add(0, vals[0]); add(L, vals[vals.length - 1]);
      for (const p of marks) {
        const [X, Y] = base(p.x), off = p.v * k * flip, sgn = Math.sign(off) || 1;
        this.tag(g, X + nx * (off + sgn * 12), Y - ny * (off + sgn * 12), units.num(qty, p.v, 3), p.v >= 0 ? colPos : colNeg);
      }
    }
    this.legendText(`${q === 'N' ? 'Axial force N (tension +)' : q === 'V' ? 'Shear force V' : 'Bending moment M (sagging +' + (ui.mTension ? ', drawn on the tension side)' : ')')} · ${units.label(qty)}`);
  }
  // axial force: members coloured by tension (blue) / compression (orange), width ∝ |N|
  drawAxial(g, R, mx) {
    const ui = this.app.ui, ten = this.col.accent, com = this.col.load;
    g.lineCap = 'butt';
    for (const mr of R.members) {
      const m = this.store.member(mr.id), [a, b] = this.memberPts(m), c = (b.x - a.x) / mr.L, s = (b.y - a.y) / mr.L;
      for (let i = 1; i < mr.x.length; i++) {
        const N = (mr.N[i] + mr.N[i - 1]) / 2;
        g.strokeStyle = Math.abs(N) < 1e-9 * mx ? this.col.strong : N > 0 ? ten : com;
        g.lineWidth = 2 + 9 * Math.min(1, Math.abs(N) / mx * (ui.diagScale || 1));
        g.beginPath(); g.moveTo(this.X(a.x + c * mr.x[i - 1]), this.Y(a.y + s * mr.x[i - 1])); g.lineTo(this.X(a.x + c * mr.x[i]), this.Y(a.y + s * mr.x[i])); g.stroke();
      }
      const mid = mr.N[Math.floor(mr.N.length / 2)], vary = mr.ext.N.max - mr.ext.N.min > 0.02 * mx;
      const txt = Math.abs(mid) < 1e-9 * mx && !vary ? '0' : vary ? `${units.num('force', mr.N[0], 3)}…${units.num('force', mr.N[mr.N.length - 1], 3)}` : units.num('force', mid, 3);
      this.tag(g, this.X((a.x + b.x) / 2), this.Y((a.y + b.y) / 2), txt, Math.abs(mid) < 1e-9 * mx ? this.col.t3 : mid > 0 ? ten : com);
    }
    this.legendText(`Axial force N · ${units.label('force')} — blue: tension, orange: compression, grey: zero-force member`);
  }
  legendText(t) { this.legendMsg = t; }
  showLegend(stress) {
    const L = this.legend;
    if (stress) {
      L.style.display = '';
      if (L.dataset.mode !== 'stress') { L.dataset.mode = 'stress'; L.innerHTML = `<div>Von Mises stress / yield</div><div class="st-grad"></div><div class="ticks"><span>0</span><span>0.5</span><span>1.0</span><span>≥1.2</span></div>`; }
    } else if (this.legendMsg) { L.style.display = ''; L.dataset.mode = 'text'; if (L.textContent !== this.legendMsg) L.textContent = this.legendMsg; }
    else { L.style.display = 'none'; L.dataset.mode = ''; }
  }

  drawDeflection(g, R) {
    const ui = this.app.ui, size = this.modelSize();
    const maxd = R.maxDisp.v || 1e-30;
    const auto = 0.08 * size / maxd, sc = auto * (ui.deflScale || 1) * (ui.animate ? Math.sin(this.phase() * 2.4) : 1);
    this.deflAuto = auto;
    g.strokeStyle = this.col.accent; g.lineWidth = 2.6; g.lineCap = 'round'; g.lineJoin = 'round';
    for (const mr of R.members) {
      const m = this.store.member(mr.id), [a] = this.memberPts(m), c = (this.store.node(m.b).x - a.x) / mr.L, s = (this.store.node(m.b).y - a.y) / mr.L;
      g.beginPath();
      for (let i = 0; i < mr.x.length; i++) {
        const x = a.x + c * mr.x[i] + sc * mr.gu[i], y = a.y + s * mr.x[i] + sc * mr.gv[i];
        i ? g.lineTo(this.X(x), this.Y(y)) : g.moveTo(this.X(x), this.Y(y));
      }
      g.stroke();
    }
    // max displacement marker
    const md = R.maxDisp, mr = R.members.find(m => m.id === md.member);
    if (mr) {
      const m = this.store.member(mr.id), a = this.store.node(m.a), b = this.store.node(m.b), c = (b.x - a.x) / mr.L, s = (b.y - a.y) / mr.L;
      const i = mr.x.indexOf(md.x), x = a.x + c * md.x + sc * mr.gu[i], y = a.y + s * md.x + sc * mr.gv[i];
      g.fillStyle = this.col.accent; g.beginPath(); g.arc(this.X(x), this.Y(y), 4, 0, 2 * Math.PI); g.fill();
      this.tag(g, this.X(x), this.Y(y) - 16, `δmax = ${units.fmt('disp', md.v, 3)}`, this.col.accent);
    }
    this.legendText(`Deflected shape × ${fmtNum(auto * (ui.deflScale || 1), 3)} (exaggerated)`);
  }

  drawStress(g, R) {
    for (const mr of R.members) {
      const m = this.store.member(mr.id), [a, b] = this.memberPts(m), c = (b.x - a.x) / mr.L, s = (b.y - a.y) / mr.L;
      const P = this.app.prepared?.members[mr.mi];
      const S = P?.sec, fy = P?.fy || 1;
      g.lineCap = 'butt'; g.lineWidth = m.type === 'frame' ? 6 : 4.5;
      for (let i = 1; i < mr.x.length; i++) {
        const N = (mr.N[i] + mr.N[i - 1]) / 2, M = (mr.M[i] + mr.M[i - 1]) / 2;
        const vm = S ? Math.max(Math.abs(N / S.A - M * S.ctop / S.Ix), Math.abs(N / S.A + M * S.cbot / S.Ix)) : 0;
        g.strokeStyle = heat(vm / fy);
        g.beginPath(); g.moveTo(this.X(a.x + c * mr.x[i - 1]), this.Y(a.y + s * mr.x[i - 1])); g.lineTo(this.X(a.x + c * mr.x[i]), this.Y(a.y + s * mr.x[i])); g.stroke();
      }
      const u = mr.stress.util, [X, Y] = [this.X((a.x + b.x) / 2), this.Y((a.y + b.y) / 2)];
      this.tag(g, X, Y - 14, `${(u * 100).toFixed(0)}%`, u > 1 ? this.col.bad : u > 0.8 ? this.col.warn : this.col.t2);
    }
  }

  drawModes(g, res, view) {
    const ui = this.app.ui;
    if (!res) return false;
    if (!res.ok) { this.legendText(res.error === 'no-compression' ? 'No member is in compression, so nothing can buckle.' : res.error === 'massless' ? 'Give the members a density (or nodes a mass) to find vibration modes.' : 'This analysis needs a stable structure.'); return false; }
    const mode = res.modes[Math.min(ui.mode || 0, res.modes.length - 1)]; if (!mode) return false;
    const size = this.modelSize(), amp = 0.1 * size * (ui.deflScale || 1);
    const w = view === 'modes' ? 2 * Math.PI * 0.6 : 2 * Math.PI * 0.35;
    const sc = amp * (ui.animate ? Math.sin(this.phase() * w) : 1);
    g.strokeStyle = view === 'modes' ? this.col.accent : this.col.bad; g.lineWidth = 2.6; g.lineCap = 'round'; g.lineJoin = 'round';
    for (const e of res.mesh.elems) {
      const pts = elementCurve(res.mesh, e, mode.shape, sc, e.frame ? 6 : 1);
      g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(this.X(x), this.Y(y)) : g.moveTo(this.X(x), this.Y(y)))); g.stroke();
    }
    if (view === 'modes') this.legendText(`Mode ${(ui.mode || 0) + 1}: f = ${fmtNum(mode.f, 4)} Hz · T = ${fmtNum(mode.T, 4)} s · effective mass x ${(mode.effX * 100).toFixed(1)}%, y ${(mode.effY * 100).toFixed(1)}%`);
    else this.legendText(`Buckling mode ${(ui.mode || 0) + 1}: load factor λ = ${fmtNum(mode.lambda, 4)} (the applied loads × λ buckle the structure)`);
    return ui.animate;
  }

  drawMechanism(g, R) {
    const mesh = R.mesh, sc = 0.08 * this.modelSize() * Math.sin(this.phase() * 3);
    g.strokeStyle = this.col.bad; g.lineWidth = 2.4; g.setLineDash([5, 4]);
    for (const e of mesh.elems) {
      const pts = elementCurve(mesh, e, R.shape, sc, e.frame ? 6 : 1);
      g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(this.X(x), this.Y(y)) : g.moveTo(this.X(x), this.Y(y)))); g.stroke();
    }
    g.setLineDash([]);
  }

  drawSelection(g) {
    const sel = this.sel, hov = this.hover;
    for (const [it, alpha] of [[hov, 0.35], [sel, 1]]) {
      if (!it) continue;
      g.strokeStyle = this.col.accent; g.globalAlpha = alpha; g.lineWidth = 2;
      if (it.kind === 'node' || it.kind === 'support') { const n = this.store.node(it.id); if (n) { g.beginPath(); g.arc(this.X(n.x), this.Y(n.y), it.kind === 'support' ? 16 : 8, 0, 2 * Math.PI); g.stroke(); } }
      else if (it.kind === 'member') { const m = this.store.member(it.id); if (m) { const [a, b] = this.memberPts(m); g.lineWidth = 9; g.globalAlpha = alpha * 0.3; g.lineCap = 'round'; g.beginPath(); g.moveTo(this.X(a.x), this.Y(a.y)); g.lineTo(this.X(b.x), this.Y(b.y)); g.stroke(); } }
      else if (it.kind === 'load') { const hb = this.hits.find(x => x.kind === 'load' && x.id === it.id); if (hb) { /* glyph highlight via tag */ } }
      g.globalAlpha = 1;
    }
  }
  drawCursor(g) {
    const c = this.cursor; if (!c || !['member', 'node'].includes(this.tool)) return;
    const X = this.X(c.x), Y = this.Y(c.y);
    g.strokeStyle = this.col.accent; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(X - 7, Y); g.lineTo(X + 7, Y); g.moveTo(X, Y - 7); g.lineTo(X, Y + 7); g.stroke();
    if (!this.chain) this.tag(g, X + 8 + 40, Y - 14, `(${units.num('len', c.x, 4)}, ${units.num('len', c.y, 4)})`, this.col.t2);
  }

  updateReadout() {
    const ui = this.app.ui, R = this.app.results().static, hv = this.hover, c = this.cursor;
    const ro = this.readout;
    if (!hv || !c) { ro.style.display = 'none'; return; }
    let html = '';
    const mdl = this.store.model;
    if (hv.kind === 'member' && R?.ok) {
      const mr = R.members.find(m => m.id === hv.id), m = this.store.member(hv.id), [a, b] = this.memberPts(m);
      const t = Math.max(0, Math.min(1, projT(a, b, c.mx !== undefined ? this.wx(c.mx) : c.x, this.wy(c.my)))), x = t * mr.L;
      let i = 0, bd = Infinity; mr.x.forEach((xx, k) => { const d = Math.abs(xx - x); if (d < bd) { bd = d; i = k; } });
      const idx = mdl.members.indexOf(m) + 1;
      html = `<b>Member ${idx}</b> · x = ${units.fmt('len', mr.x[i], 4)}<br>N = ${units.fmt('force', mr.N[i], 4)}<br>V = ${units.fmt('force', mr.V[i], 4)}<br>M = ${units.fmt('moment', mr.M[i], 4)}<br>δ = ${units.fmt('disp', Math.hypot(mr.gu[i], mr.gv[i]), 3)}`;
      const P = this.app.prepared?.members[mr.mi];
      if (P) { const S = P.sec, top = mr.N[i] / S.A - mr.M[i] * S.ctop / S.Ix, bot = mr.N[i] / S.A + mr.M[i] * S.cbot / S.Ix; html += `<br>σ top ${units.fmt('stress', top, 3)} · bottom ${units.fmt('stress', bot, 3)}`; }
    } else if (hv.kind === 'node') {
      const i = mdl.nodes.findIndex(n => n.id === hv.id), n = mdl.nodes[i];
      html = `<b>Node ${letters(i)}</b> (${units.num('len', n.x, 4)}, ${units.num('len', n.y, 4)}) ${units.label('len')}`;
      if (R?.ok) { const d = R.nodes[i]; html += `<br>uₓ = ${units.fmt('disp', d.ux, 3)}, u_y = ${units.fmt('disp', d.uy, 3)}<br>θ = ${units.fmt('rot', d.rz, 3)}`; const r = R.reactions.find(r => r.node === n.id); if (r) html += `<br>Rₓ = ${units.fmt('force', r.Rx, 4)}, R_y = ${units.fmt('force', r.Ry, 4)}${Math.abs(r.Mz) > 0 ? `<br>M = ${units.fmt('moment', r.Mz, 4)}` : ''}`; }
    } else if (hv.kind === 'member') {
      const m = this.store.member(hv.id), [a, b] = this.memberPts(m);
      html = `<b>Member ${mdl.members.indexOf(m) + 1}</b> · ${m.type || 'frame'} · L = ${units.fmt('len', Math.hypot(b.x - a.x, b.y - a.y), 4)}`;
    } else if (hv.kind === 'load') html = 'Load — click to select, Delete to remove';
    else if (hv.kind === 'support') html = 'Support — click to edit';
    void ui;
    ro.innerHTML = html; ro.style.display = html ? 'block' : 'none';
    const w = ro.offsetWidth, hgt = ro.offsetHeight;
    ro.style.left = Math.min(c.mx + 14, this.W - w - 6) + 'px'; ro.style.top = Math.min(c.my + 14, this.H - hgt - 6) + 'px';
  }
}

// ---------------------------------------------------------------- glyph helpers
function supportGlyph(g, sp, col) {
  const ground = (y, w = 15) => {
    g.beginPath(); g.moveTo(-w, y); g.lineTo(w, y); g.stroke();
    g.save(); g.lineWidth = 1; g.beginPath();
    for (let x = -w + 3; x <= w; x += 5) { g.moveTo(x, y); g.lineTo(x - 5, y + 5); }
    g.stroke(); g.restore();
  };
  switch (sp.type) {
    case 'fixed':
      g.lineWidth = 2.4; g.beginPath(); g.moveTo(-15, 0); g.lineTo(15, 0); g.stroke(); g.lineWidth = 1;
      g.beginPath(); for (let x = -12; x <= 15; x += 5) { g.moveTo(x, 0); g.lineTo(x - 5, 6); } g.stroke(); break;
    case 'pin':
      g.beginPath(); g.moveTo(0, 0); g.lineTo(-9, 14); g.lineTo(9, 14); g.closePath(); g.fill(); g.stroke(); ground(14); break;
    case 'roller':
      g.beginPath(); g.moveTo(0, 0); g.lineTo(-8, 11); g.lineTo(8, 11); g.closePath(); g.fill(); g.stroke();
      for (const x of [-5, 5]) { g.beginPath(); g.arc(x, 14, 2.6, 0, 2 * Math.PI); g.stroke(); }
      ground(17); break;
    case 'slider':
      g.beginPath(); g.rect(-9, 0, 18, 9); g.fill(); g.stroke();
      for (const x of [-5, 5]) { g.beginPath(); g.arc(x, 12, 2.6, 0, 2 * Math.PI); g.stroke(); }
      ground(15); break;
    case 'contact':
      ground(1.5, 18);
      if (sp.mu > 0) { g.save(); g.rotate(0); g.fillStyle = col.t3; g.font = `9.5px ${col.mono}`; g.textAlign = 'left'; g.fillText(`µ=${sp.mu}`, 12, -5); g.restore(); }
      break;
    case 'spring': {
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, 3);
      for (let k = 0; k < 6; k++) g.lineTo(k % 2 ? -5 : 5, 4 + k * 2.4);
      g.lineTo(0, 18); g.stroke(); ground(18, 10);
      if (sp.kr > 0) { g.beginPath(); g.arc(0, 0, 7, Math.PI * 0.2, Math.PI * 1.6); g.stroke(); }
      break;
    }
    default: break;
  }
}
function arrow(g, x1, y1, x2, y2, color, w = 2, head = 8) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  g.strokeStyle = color; g.fillStyle = color; g.lineWidth = w; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2 - Math.cos(a) * head * 0.6, y2 - Math.sin(a) * head * 0.6); g.stroke();
  g.beginPath(); g.moveTo(x2, y2); g.lineTo(x2 - head * Math.cos(a - 0.4), y2 - head * Math.sin(a - 0.4)); g.lineTo(x2 - head * Math.cos(a + 0.4), y2 - head * Math.sin(a + 0.4)); g.closePath(); g.fill();
}
// counter-clockwise positive (world), drawn in screen space
function momentArc(g, X, Y, r, m, color) {
  const ccw = m >= 0;
  g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 2;
  const a0 = Math.PI * 0.15, a1 = Math.PI * 1.55;
  g.beginPath(); g.arc(X, Y, r, -a0, -a1, true); g.stroke();
  // arrow head at the end in the direction of rotation (screen angles are clockwise-positive)
  const end = ccw ? -a1 : -a0, dir = ccw ? -1 : 1;
  const ex = X + r * Math.cos(end), ey = Y + r * Math.sin(end);
  const tx = -Math.sin(end) * dir, ty = Math.cos(end) * dir;
  const hx = ex + tx * 7, hy = ey + ty * 7;
  g.beginPath(); g.moveTo(hx, hy); g.lineTo(ex - ty * 4 - tx * 2, ey + tx * 4 - ty * 2); g.lineTo(ex + ty * 4 - tx * 2, ey - tx * 4 - ty * 2); g.closePath(); g.fill();
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function pointInPoly(x, y, poly) { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside; } return inside; }
// utilisation colour: green → yellow → orange → red (≥ 1.2)
export function heat(u) {
  const stops = [[0, [46, 160, 90]], [0.5, [190, 200, 60]], [0.8, [240, 170, 40]], [1.0, [230, 80, 40]], [1.2, [180, 20, 60]]];
  u = Math.max(0, Math.min(1.2, u || 0));
  for (let i = 1; i < stops.length; i++) if (u <= stops[i][0]) { const [t0, c0] = stops[i - 1], [t1, c1] = stops[i], f = (u - t0) / (t1 - t0); return `rgb(${c0.map((c, k) => Math.round(c + f * (c1[k] - c))).join(',')})`; }
  return 'rgb(180,20,60)';
}
export { TOOLS };
void icon;
