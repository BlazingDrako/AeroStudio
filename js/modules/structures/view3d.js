// Orbitable 3-D view for the space-frame tab: orthographic projection with Z up, drawn on a canvas.
// Drag to orbit, Shift/right-drag or two fingers to pan, wheel / pinch to zoom, click to select.
import { h, cssVar } from '../../lib/ui.js';
import { letters } from '../../solvers/statics.js';
import { elementCurve3d, memberAxes } from '../../solvers/frame3d.js';
import { units, fmtNum } from '../../solvers/units.js';
import { heat } from './editor.js';

const deg = Math.PI / 180;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const P3 = n => [n.x, n.y, n.z || 0];

export class Viewer3D {
  constructor(app) {
    this.app = app;
    this.az = -58; this.el = 24; this.scale = 60; this.pan = [0, 0]; this.center = [0, 0, 0]; this.fitted = false;
    this.stage = h('div', { class: 'stage st-stage st-3d', tabindex: '0' });
    this.canvas = h('canvas'); this.ctx = this.canvas.getContext('2d');
    this.legend = h('div', { class: 'legend st-legend', style: { display: 'none' } });
    this.banner = h('div', { class: 'st-banner' });
    this.readout = h('div', { class: 'readout' });
    this.stage.append(this.canvas, this.legend, this.banner, this.readout);
    this.pending = null; this.hover = null; this.t0 = performance.now();
    this.pointers = new Map();
    new ResizeObserver(() => { if (!this.fitted) this.fit(); this.draw(); }).observe(this.stage);
    this.bind();
    addEventListener('themechange', () => this.draw());
  }

  // ---------------------------------------------------------------- camera
  basis() {
    const a = this.az * deg, e = this.el * deg;
    this.r = [-Math.sin(a), Math.cos(a), 0];
    this.u = [-Math.sin(e) * Math.cos(a), -Math.sin(e) * Math.sin(a), Math.cos(e)];
    this.v = [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)];
  }
  P(p) {
    const c = this.center, d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    return [this.W / 2 + this.pan[0] + this.scale * dot(d, this.r), this.H / 2 + this.pan[1] - this.scale * dot(d, this.u), dot(d, this.v)];
  }
  bounds() {
    const ns = this.app.model().nodes;
    if (!ns.length) return { lo: [-1, -1, 0], hi: [1, 1, 1], size: 2 };
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const n of ns) P3(n).forEach((v, k) => { lo[k] = Math.min(lo[k], v); hi[k] = Math.max(hi[k], v); });
    return { lo, hi, size: Math.max(1e-3, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])) };
  }
  fit() {
    const W = this.stage.clientWidth, H = this.stage.clientHeight; if (!W || !H) return;
    this.W = W; this.H = H; this.basis();
    const { lo, hi, size } = this.bounds();
    this.center = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    let sx = 0, sy = 0;
    for (const n of this.app.model().nodes) { const d = [n.x - this.center[0], n.y - this.center[1], (n.z || 0) - this.center[2]]; sx = Math.max(sx, Math.abs(dot(d, this.r))); sy = Math.max(sy, Math.abs(dot(d, this.u))); }
    sx = Math.max(sx, size * 0.08); sy = Math.max(sy, size * 0.08);
    const mx = W < 520 ? 34 : 70, my = W < 520 ? 44 : 64;
    this.scale = Math.min((W / 2 - mx) / sx, (H / 2 - my) / sy);
    this.pan = [0, 6]; this.fitted = true;
  }
  setView(name) {
    const v = { iso: [-58, 24], front: [-90, 0], side: [0, 0], top: [-90, 90] }[name];
    if (v) { [this.az, this.el] = v; this.fit(); this.draw(); }
  }

  // ---------------------------------------------------------------- interaction
  bind() {
    const c = this.canvas;
    let drag = null;
    const pos = e => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('pointerdown', e => {
      this.stage.focus({ preventScroll: true });
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, pos(e));
      if (this.pointers.size === 2) { const [a, b] = [...this.pointers.values()]; drag = { pinch: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], moved: true }; return; }
      const p = pos(e);
      drag = { x: p[0], y: p[1], lx: p[0], ly: p[1], moved: false, pan: e.button === 2 || e.button === 1 || e.shiftKey };
    });
    c.addEventListener('pointermove', e => {
      const p = pos(e);
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
      if (drag && drag.pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        this.zoomAt(mid, d / drag.pinch); this.pan[0] += mid[0] - drag.mid[0]; this.pan[1] += mid[1] - drag.mid[1];
        drag.pinch = d; drag.mid = mid; this.draw(); return;
      }
      if (drag && !drag.pinch) {
        const dx = p[0] - drag.lx, dy = p[1] - drag.ly;
        if (!drag.moved && Math.hypot(p[0] - drag.x, p[1] - drag.y) > 4) drag.moved = true;
        if (drag.moved) {
          if (drag.pan) { this.pan[0] += dx; this.pan[1] += dy; }
          else { this.az -= dx * 0.45; this.el = Math.max(-90, Math.min(90, this.el + dy * 0.45)); }
          drag.lx = p[0]; drag.ly = p[1]; this.draw();
        }
        return;
      }
      // hover readout
      const hit = this.hit(p);
      const key = hit ? hit.kind + hit.id : '';
      if (key !== (this.hover ? this.hover.kind + this.hover.id : '')) { this.hover = hit; this.draw(); }
      this.showReadout(hit, p);
    });
    const end = e => {
      const p = pos(e);
      this.pointers.delete(e.pointerId);
      if (drag && !drag.moved && !drag.pinch) this.click(p);
      if (this.pointers.size === 0) drag = null;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', e => { this.pointers.delete(e.pointerId); drag = null; });
    c.addEventListener('pointerleave', () => { this.readout.style.display = 'none'; if (this.hover) { this.hover = null; this.draw(); } });
    c.addEventListener('wheel', e => { e.preventDefault(); this.zoomAt(pos(e), Math.exp(-e.deltaY * 0.0015)); this.draw(); }, { passive: false });
    this.stage.addEventListener('keydown', e => this.app.onKey && this.app.onKey(e));
  }
  zoomAt([x, y], f) {
    const s0 = this.scale; this.scale = Math.max(1e-3, Math.min(1e7, s0 * f)); const k = this.scale / s0;
    // keep the point under the cursor fixed
    const cx = this.W / 2 + this.pan[0], cy = this.H / 2 + this.pan[1];
    this.pan[0] += (x - cx) * (1 - k); this.pan[1] += (y - cy) * (1 - k);
  }
  hit([x, y]) {
    const mdl = this.app.model();
    let best = null, bd = 11;
    for (const n of mdl.nodes) { const q = this.P(P3(n)); const d = Math.hypot(q[0] - x, q[1] - y); if (d < bd) { bd = d; best = { kind: 'node', id: n.id }; } }
    if (best) return best;
    bd = 7;
    const nm = new Map(mdl.nodes.map(n => [n.id, n]));
    for (const m of mdl.members) {
      const a = this.P(P3(nm.get(m.a))), b = this.P(P3(nm.get(m.b)));
      const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2));
      const d = Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y);
      if (d < bd) { bd = d; best = { kind: 'member', id: m.id, t }; }
    }
    return best;
  }
  click(p) {
    const hit = this.hit(p), tool = this.app.ui.tool;
    if (tool === 'member') {
      if (hit?.kind === 'node') {
        if (this.pending && this.pending !== hit.id) { this.app.addMember(this.pending, hit.id); this.pending = hit.id; }
        else this.pending = hit.id;
      } else this.pending = null;
      this.draw(); return;
    }
    if (tool === 'delete') { if (hit) this.app.deleteHit(hit); return; }
    this.app.select(hit);
  }
  showReadout(hit, p) {
    const txt = hit ? this.app.describe(hit) : null;
    if (!txt) { this.readout.style.display = 'none'; return; }
    this.readout.innerHTML = txt; this.readout.style.display = 'block';
    const W = this.W, w = this.readout.offsetWidth;
    this.readout.style.left = Math.min(W - w - 8, p[0] + 14) + 'px'; this.readout.style.top = Math.max(6, p[1] - 34) + 'px';
  }
  flash(msg) { this.banner.textContent = msg; this.banner.classList.add('show'); clearTimeout(this._bt); this._bt = setTimeout(() => this.banner.classList.remove('show'), 1800); }

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
    this.W = W; this.H = H; this.basis();
    if (!this.fitted) this.fit();
    this.col = {
      text: cssVar('--text'), t2: cssVar('--text-2'), t3: cssVar('--text-3'), border: cssVar('--border'), strong: cssVar('--border-strong'),
      accent: cssVar('--accent'), good: cssVar('--good'), bad: cssVar('--bad'), warn: cssVar('--warn'), load: cssVar('--lower'), bg: cssVar('--bg-elev'), mono: cssVar('--mono'), font: cssVar('--font'),
    };
    const ui = this.app.ui, mdl = this.app.model(), res = this.app.results(), R = res.static, view = ui.view;
    this.nm = new Map(mdl.nodes.map((n, i) => [n.id, { n, i }]));
    this.size = this.bounds().size;
    this.drawGround(g);
    let animating = false, legend = null;
    const ok = R && R.ok;
    const fade = ok && view !== 'model';
    if (R && !R.ok && R.error === 'mechanism' && R.shape) { this.drawMembers(g, { faded: true, dashed: true }); this.drawShape(g, R.mesh, R.shape, this.size * 0.06 * Math.sin(this.phase() * 3), this.col.bad); animating = true; }
    else if (!ok || view === 'model') this.drawMembers(g, {});
    else if (view === 'defl') { this.drawMembers(g, { faded: true, dashed: true }); this.drawDeflection(g, R); animating = ui.animate; }
    else if (view === 'N' || view === 'T') { legend = this.drawAxial(g, R, view); }
    else if (view === 'stress') { this.drawStress(g, R); legend = 'stress'; }
    else if (view === 'V' || view === 'M') { this.drawMembers(g, { faded: true }); this.drawDiagrams(g, R, view); }
    else if (view === 'modes' || view === 'buckling') {
      this.drawMembers(g, { faded: true, dashed: true });
      const set = view === 'modes' ? res.modal : res.buckling, md = set?.ok && set.modes[ui.mode];
      if (md) { const amp = this.size * 0.12 * ui.deflScale; this.drawShape(g, set.mesh, md.shape, view === 'modes' && ui.animate ? amp * Math.sin(this.phase() * 2.4) : amp, this.col.accent); animating = view === 'modes' && ui.animate; }
    }
    this.drawSupports(g, fade);
    if (!fade || view === 'defl') this.drawLoads(g, fade);
    this.drawNodes(g, fade);
    if (ui.labels) this.drawLabels(g);
    this.drawSelection(g);
    this.drawTriad(g);
    this.showLegend(legend, R);
    if (animating) { if (!this._anim) { this._anim = true; const tick = () => { if (!this._anim || !this.stage.isConnected) { this._anim = false; return; } this.render(); this._animRaf = requestAnimationFrame(tick); }; this._animRaf = requestAnimationFrame(tick); } }
    else if (this._anim) { this._anim = false; cancelAnimationFrame(this._animRaf); }
  }
  stop() { this._anim = false; cancelAnimationFrame(this._animRaf); }
  phase() { return (performance.now() - this.t0) / 1000; }

  line(g, a, b) { const p = this.P(a), q = this.P(b); g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke(); }
  poly(g, pts, close = false) { g.beginPath(); pts.forEach((p, k) => { const q = this.P(p); if (k) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); }); if (close) g.closePath(); }

  drawGround(g) {
    const { lo, hi, size } = this.bounds();
    const span = Math.max(hi[0] - lo[0], hi[1] - lo[1], size * 0.4);
    const raw = span / 8, p10 = 10 ** Math.floor(Math.log10(raw)), f = raw / p10, step = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p10;
    const pad = step * 1.5, z = lo[2];
    const x0 = Math.floor((lo[0] - pad) / step) * step, x1 = Math.ceil((hi[0] + pad) / step) * step, y0 = Math.floor((lo[1] - pad) / step) * step, y1 = Math.ceil((hi[1] + pad) / step) * step;
    g.strokeStyle = this.col.border; g.lineWidth = 1; g.globalAlpha = 0.7;
    for (let x = x0; x <= x1 + 1e-9; x += step) this.line(g, [x, y0, z], [x, y1, z]);
    for (let y = y0; y <= y1 + 1e-9; y += step) this.line(g, [x0, y, z], [x1, y, z]);
    g.globalAlpha = 1;
    // grid spacing note
    g.fillStyle = this.col.t3; g.font = `10.5px ${this.col.mono}`; g.textAlign = 'right'; g.textBaseline = 'bottom';
    g.fillText(`grid ${fmtNum(step / units.factor('len'), 3)} ${units.label('len')}`, this.W - 12, this.H - 10);
  }
  drawTriad(g) {
    const o = [this.W - 46, this.H - 52], L = 24;
    const ax = [[[1, 0, 0], 'X', '#d9534f'], [[0, 1, 0], 'Y', '#3fa66b'], [[0, 0, 1], 'Z', '#3b82d6']];
    ax.sort((a, b) => dot(a[0], this.v) - dot(b[0], this.v));
    g.lineWidth = 2; g.font = `600 11px ${this.col.font}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const [d, lab, c] of ax) {
      const x = o[0] + L * dot(d, this.r), y = o[1] - L * dot(d, this.u);
      g.strokeStyle = c; g.fillStyle = c; g.beginPath(); g.moveTo(o[0], o[1]); g.lineTo(x, y); g.stroke();
      const k = 1.32; g.fillText(lab, o[0] + (x - o[0]) * k + (Math.abs(x - o[0]) + Math.abs(y - o[1]) < 4 ? 8 : 0), o[1] + (y - o[1]) * k);
    }
  }
  memberEnds(m) { return [P3(this.nm.get(m.a).n), P3(this.nm.get(m.b).n)]; }
  sortedMembers() {
    const mdl = this.app.model();
    return mdl.members.map((m, k) => { const [a, b] = this.memberEnds(m); return { m, k, a, b, d: dot([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], this.v) }; }).sort((x, y) => x.d - y.d);
  }
  drawMembers(g, { faded = false, dashed = false } = {}) {
    g.lineCap = 'round';
    for (const { m, a, b } of this.sortedMembers()) {
      const truss = m.type === 'truss';
      g.strokeStyle = faded ? this.col.strong : truss ? this.col.t2 : this.col.text;
      g.globalAlpha = faded ? 0.8 : 1;
      g.lineWidth = faded ? 1.4 : truss ? 1.8 : 3;
      g.setLineDash(dashed ? [5, 4] : []);
      this.line(g, a, b);
      g.setLineDash([]);
      if (!faded) for (const [rel, p, q] of [[m.relA, a, b], [m.relB, b, a]]) if (rel) {
        const L = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]), t = Math.min(0.12, 9 / (this.scale * L + 1e-9));
        const c = this.P([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]);
        g.fillStyle = this.col.bg; g.strokeStyle = this.col.text; g.lineWidth = 1.5; g.beginPath(); g.arc(c[0], c[1], 3.6, 0, 7); g.fill(); g.stroke();
      }
    }
    g.globalAlpha = 1;
  }
  drawNodes(g, faded) {
    for (const n of this.app.model().nodes) {
      const q = this.P(P3(n));
      g.fillStyle = faded ? this.col.t3 : this.col.text; g.beginPath(); g.arc(q[0], q[1], faded ? 2.2 : 3, 0, 7); g.fill();
    }
    if (this.pending && this.nm.get(this.pending)) {
      const q = this.P(P3(this.nm.get(this.pending).n));
      g.strokeStyle = this.col.accent; g.lineWidth = 2; g.beginPath(); g.arc(q[0], q[1], 8, 0, 7); g.stroke();
    }
  }
  drawLabels(g) {
    const mdl = this.app.model();
    g.font = `600 11px ${this.col.font}`; g.textAlign = 'left'; g.textBaseline = 'bottom'; g.fillStyle = this.col.t2;
    if (mdl.nodes.length <= 80) mdl.nodes.forEach((n, i) => { const q = this.P(P3(n)); g.fillText(letters(i), q[0] + 6, q[1] - 4); });
  }
  drawSelection(g) {
    const sel = this.app.selection();
    for (const s of [this.hover, sel]) {
      if (!s) continue;
      const strong = s === sel;
      g.strokeStyle = this.col.accent; g.globalAlpha = strong ? 0.9 : 0.45;
      if (s.kind === 'node' && this.nm.get(s.id)) { const q = this.P(P3(this.nm.get(s.id).n)); g.lineWidth = 2; g.beginPath(); g.arc(q[0], q[1], 8, 0, 7); g.stroke(); }
      if (s.kind === 'member') { const m = this.app.model().members.find(x => x.id === s.id); if (m) { g.lineWidth = 8; g.lineCap = 'round'; g.globalAlpha = strong ? 0.35 : 0.2; const [a, b] = this.memberEnds(m); this.line(g, a, b); } }
    }
    g.globalAlpha = 1;
  }
  drawSupports(g, faded) {
    const col = faded ? this.col.t3 : this.col.t2;
    for (const sp of this.app.model().supports) {
      const nn = this.nm.get(sp.node); if (!nn) continue;
      const q = this.P(P3(nn.n)), r = sp.r || [0, 0, 0, 0, 0, 0], nT = r[0] + r[1] + r[2], nR = r[3] + r[4] + r[5];
      const springs = (sp.k || []).some((k, d) => k > 0 && !r[d]);
      g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1.4; g.globalAlpha = faded ? 0.7 : 1;
      const x = q[0], y = q[1];
      if (nT === 3 && nR === 3) { g.globalAlpha *= 0.85; g.fillRect(x - 8, y + 3, 16, 7); g.globalAlpha = faded ? 0.7 : 1; g.beginPath(); for (let k = -8; k <= 8; k += 4) { g.moveTo(x + k, y + 10); g.lineTo(x + k - 4, y + 14); } g.stroke(); }
      else if (nT === 3) { g.beginPath(); g.moveTo(x, y + 2); g.lineTo(x - 8, y + 14); g.lineTo(x + 8, y + 14); g.closePath(); g.globalAlpha *= 0.35; g.fill(); g.globalAlpha = faded ? 0.7 : 1; g.stroke(); g.beginPath(); g.moveTo(x - 11, y + 16); g.lineTo(x + 11, y + 16); g.stroke(); }
      else if (nT > 0) { g.beginPath(); g.moveTo(x, y + 2); g.lineTo(x - 7, y + 11); g.lineTo(x + 7, y + 11); g.closePath(); g.stroke(); g.beginPath(); g.arc(x - 3.5, y + 14, 2.4, 0, 7); g.arc(x + 3.5, y + 14, 2.4, 0, 7); g.stroke(); }
      if (nR > 0 && nR < 3) { g.beginPath(); g.rect(x - 4, y - 4, 8, 8); g.stroke(); }
      if (springs) { g.beginPath(); g.moveTo(x, y + 2); for (let k = 1; k <= 6; k++) g.lineTo(x + (k % 2 ? 5 : -5), y + 2 + k * 2.5); g.lineTo(x, y + 19); g.stroke(); }
      if (nT === 0 && nR === 3) { g.beginPath(); g.rect(x - 5, y - 5, 10, 10); g.stroke(); }
      g.globalAlpha = 1;
    }
  }
  arrow(g, tip, dir, len, color, { label = null, double = false, headLen = 8 } = {}) {
    const tail = [tip[0] - dir[0] * len, tip[1] - dir[1] * len, tip[2] - dir[2] * len];
    const a = this.P(tail), b = this.P(tip);
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 1.8;
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
    if (L < 1) { g.beginPath(); g.arc(b[0], b[1], 4, 0, 7); g.stroke(); }
    else {
      const ux = dx / L, uy = dy / L;
      const head = (px, py) => { g.beginPath(); g.moveTo(px, py); g.lineTo(px - headLen * ux + headLen * 0.45 * uy, py - headLen * uy - headLen * 0.45 * ux); g.lineTo(px - headLen * ux - headLen * 0.45 * uy, py - headLen * uy + headLen * 0.45 * ux); g.closePath(); g.fill(); };
      head(b[0], b[1]); if (double) head(b[0] - 7 * ux, b[1] - 7 * uy);
    }
    if (label) { g.font = `10.5px ${this.col.mono}`; g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText(label, a[0], a[1] - 3); }
  }
  drawLoads(g, faded) {
    const mdl = this.app.model(), col = faded ? this.col.t3 : this.col.load, Ls = this.size * 0.11;
    g.globalAlpha = faded ? 0.6 : 1;
    const lbl = this.app.ui.labels, nDist = mdl.loads.filter(l => l.kind === 'dist').length;
    for (const ld of mdl.loads) {
      if (ld.kind === 'node') {
        const nn = this.nm.get(ld.node); if (!nn) continue;
        const p = P3(nn.n), F = [ld.fx || 0, ld.fy || 0, ld.fz || 0], Mv = [ld.mx || 0, ld.my || 0, ld.mz || 0];
        const fm = Math.hypot(...F), mm = Math.hypot(...Mv);
        if (fm > 0) this.arrow(g, p, F.map(v => v / fm), Ls, col, { label: lbl ? units.fmt('force', fm, 3) : null });
        if (mm > 0) this.arrow(g, p, Mv.map(v => v / mm), Ls * 0.8, this.col.warn, { double: true, label: lbl ? units.fmt('moment', mm, 3) : null });
      } else if (ld.member) {
        const m = mdl.members.find(x => x.id === ld.member); if (!m) continue;
        const [a, b] = this.memberEnds(m), ax = memberAxes(a, b, m.roll || 0), at = t => [0, 1, 2].map(c => a[c] + (b[c] - a[c]) * t);
        const dirOf = (d, local) => local ? ax.R[d] : [0, 1, 2].map(c => (c === d ? 1 : 0));
        if (ld.kind === 'dist') {
          const d = { x: 0, y: 1, z: 2 }[(ld.dir || 'gz')[1]], local = (ld.dir || 'gz')[0] === 'l', e = dirOf(d, local);
          const w1 = ld.w1 ?? 0, w2 = ld.w2 ?? w1, wm = Math.max(Math.abs(w1), Math.abs(w2)) || 1, t0 = ld.t0 ?? 0, t1 = ld.t1 ?? 1;
          const n = Math.max(3, Math.min(12, Math.round(ax.L * this.scale / 28)));
          const tails = [];
          for (let k = 0; k <= n; k++) {
            const t = t0 + (t1 - t0) * k / n, w = w1 + (w2 - w1) * k / n, len = Ls * 0.55 * Math.abs(w) / wm, sg = Math.sign(w) || 1;
            const p = at(t);
            if (len > 0) this.arrow(g, p, e.map(v => v * sg), len, col, { headLen: 6 });
            tails.push(p.map((v, c) => v - e[c] * sg * len));
          }
          g.strokeStyle = col; g.lineWidth = 1.2; this.poly(g, tails); g.stroke();
          if (lbl && (nDist <= 6 || this.app.selection()?.id === ld.member)) { const q = this.P(tails[Math.floor(n / 2)]); g.font = `10.5px ${this.col.mono}`; g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText(units.fmt('dist', w1, 3) + (w2 !== w1 ? ' → ' + units.num('dist', w2, 3) : ''), q[0], q[1] - 3); }
        } else if (ld.kind === 'point') {
          const F = ld.axes === 'l' ? [0, 1, 2].map(c => ax.R[0][c] * (ld.fx || 0) + ax.R[1][c] * (ld.fy || 0) + ax.R[2][c] * (ld.fz || 0)) : [ld.fx || 0, ld.fy || 0, ld.fz || 0];
          const fm = Math.hypot(...F), p = at(ld.t ?? 0.5);
          if (fm > 0) this.arrow(g, p, F.map(v => v / fm), Ls, col, { label: lbl ? units.fmt('force', fm, 3) : null });
          if (ld.tx) this.arrow(g, p, ax.R[0].map(v => v * Math.sign(ld.tx)), Ls * 0.7, this.col.warn, { double: true });
        } else if (ld.kind === 'torque') {
          for (const t of [0.25, 0.5, 0.75]) this.arrow(g, at(t), ax.R[0].map(v => v * Math.sign(ld.mt || 1)), Ls * 0.45, this.col.warn, { double: true, headLen: 6 });
          if (lbl) { const q = this.P(at(0.5)); g.fillStyle = this.col.warn; g.font = `10.5px ${this.col.mono}`; g.textAlign = 'center'; g.textBaseline = 'top'; g.fillText(units.fmt('moment', ld.mt || 0, 3) + '/' + units.label('len'), q[0], q[1] + 6); }
        } else if (ld.kind === 'thermal') {
          const q = this.P(at(0.5)); g.fillStyle = this.col.warn; g.font = `600 10.5px ${this.col.mono}`; g.textAlign = 'center'; g.textBaseline = 'top';
          g.fillText(`ΔT ${fmtNum(units.fromSI('dtemp', ld.dT || 0), 3)}${units.label('dtemp')}`, q[0], q[1] + 6);
        }
      }
    }
    if (mdl.settings.selfWeight) { g.fillStyle = col; g.font = `11px ${this.col.font}`; g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText('+ self weight', 12, 12); }
    g.globalAlpha = 1;
  }

  // deformed shape from the exact member displacement fields
  drawDeflection(g, R) {
    const ui = this.app.ui, mx = Math.max(R.maxD.v, R.maxMemberD.v);
    if (!(mx > 0)) return;
    let sc = this.size * 0.08 / mx * ui.deflScale;
    if (ui.animate) sc *= 0.5 + 0.5 * Math.sin(this.phase() * 2.2);
    this.deflScaleUsed = this.size * 0.08 / mx * ui.deflScale;
    g.strokeStyle = this.col.accent; g.lineWidth = 2.4; g.lineCap = 'round';
    const mdl = this.app.model();
    R.members.forEach((mr, k) => {
      const m = mdl.members[k], [a, b] = this.memberEnds(m), ex = [(b[0] - a[0]) / mr.L, (b[1] - a[1]) / mr.L, (b[2] - a[2]) / mr.L];
      this.poly(g, mr.s.map((s, i) => [0, 1, 2].map(c => a[c] + ex[c] * s + sc * mr.dg[i][c]))); g.stroke();
    });
    g.fillStyle = this.col.accent;
    mdl.nodes.forEach((n, i) => { const q = this.P([n.x + sc * R.U[6 * i], n.y + sc * R.U[6 * i + 1], (n.z || 0) + sc * R.U[6 * i + 2]]); g.beginPath(); g.arc(q[0], q[1], 2.6, 0, 7); g.fill(); });
    this.note(g, `deflection exaggerated ×${fmtNum(this.deflScaleUsed, 3)}`);
  }
  drawShape(g, mesh, shape, sc, color) {
    g.strokeStyle = color; g.lineWidth = 2.4; g.lineCap = 'round';
    for (const e of mesh.elems) { const pts = elementCurve3d(mesh, e, shape, sc, e.beam ? 5 : 1); this.poly(g, pts); g.stroke(); }
  }
  note(g, txt) { g.fillStyle = this.col.t3; g.font = `10.5px ${this.col.font}`; g.textAlign = 'right'; g.textBaseline = 'top'; g.fillText(txt, this.W - 12, 12); }

  // axial force or torque: coloured members with width by magnitude
  drawAxial(g, R, view) {
    const key = view === 'N' ? 'N' : 'T', mdl = this.app.model();
    let mx = 0; for (const mr of R.members) mx = Math.max(mx, Math.abs(mr.ext[key]));
    const tol = 1e-3 * (mx || 1);
    const order = this.sortedMembers();
    g.lineCap = 'round';
    for (const { m, k, a, b } of order) {
      const mr = R.members[k], v = mr.ext[key];
      const zero = Math.abs(v) <= tol;
      g.strokeStyle = zero ? this.col.strong : key === 'N' ? (v > 0 ? this.col.accent : this.col.bad) : this.col.warn;
      g.lineWidth = zero ? 1.4 : 2 + 5 * Math.abs(v) / (mx || 1);
      this.line(g, a, b);
      void m;
    }
    if (this.app.ui.labels && mdl.members.length <= 60) {
      g.font = `10.5px ${this.col.mono}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const { k, a, b } of order) {
        const v = R.members[k].ext[key]; if (Math.abs(v) <= 0.01 * mx) continue;
        const q = this.P([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]), t = units.num(key === 'N' ? 'force' : 'moment', v, 3);
        g.fillStyle = this.col.bg; const w = g.measureText(t).width + 6; g.globalAlpha = 0.85; g.fillRect(q[0] - w / 2, q[1] - 7, w, 14); g.globalAlpha = 1;
        g.fillStyle = key === 'N' ? (v > 0 ? this.col.accent : this.col.bad) : this.col.warn; g.fillText(t, q[0], q[1]);
      }
    }
    return key;
  }
  drawStress(g, R) {
    const mdl = this.app.model();
    g.lineCap = 'butt';
    for (const { k, a, b } of this.sortedMembers()) {
      const mr = R.members[k], fy = this.app.prepared()?.members[k]?.fy || 1, ex = [(b[0] - a[0]) / mr.L, (b[1] - a[1]) / mr.L, (b[2] - a[2]) / mr.L];
      g.lineWidth = mdl.members[k].type === 'truss' ? 4 : 6;
      for (let i = 1; i < mr.s.length; i++) {
        if (mr.s[i] - mr.s[i - 1] < 1e-12) continue;
        g.strokeStyle = heat(Math.max(mr.vm[i], mr.vm[i - 1]) / fy);
        this.line(g, [0, 1, 2].map(c => a[c] + ex[c] * mr.s[i - 1]), [0, 1, 2].map(c => a[c] + ex[c] * mr.s[i]));
      }
    }
    if (this.app.ui.labels && mdl.members.length <= 60) {
      g.font = `600 10.5px ${this.col.mono}`; g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillStyle = this.col.text;
      for (const { k, a, b } of this.sortedMembers()) { const q = this.P([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]); g.fillText(`${Math.round(R.members[k].stress.util * 100)}%`, q[0], q[1] - 6); }
    }
  }
  // shear / moment diagrams drawn in each member's bending planes
  drawDiagrams(g, R, view) {
    const ui = this.app.ui, mdl = this.app.model();
    const comps = view === 'M' ? [['Mz', 1, this.col.accent], ['My', 2, this.col.warn]] : [['Vy', 1, this.col.accent], ['Vz', 2, this.col.warn]];
    const show = ui.comp === 'both' ? comps : comps.filter(c => (ui.comp === 'y' ? c[0].endsWith('y') : c[0].endsWith('z')));
    let mx = 0; for (const mr of R.members) for (const [k] of show) mx = Math.max(mx, Math.abs(mr.ext[k]));
    if (!(mx > 0)) { this.note(g, 'all zero'); return; }
    const sc = this.size * 0.1 / mx * ui.diagScale;
    const labels = [];
    for (const [key, ax, color] of show) {
      R.members.forEach((mr, k) => {
        const m = mdl.members[k], [a, b] = this.memberEnds(m), A = memberAxes(a, b, m.roll || 0), ex = A.R[0], dir = A.R[ax];
        const vals = mr[key]; let any = false; for (const v of vals) if (Math.abs(v) > 1e-9 * mx) { any = true; break; }
        if (!any) return;
        // moments are drawn on the tension side (the side the member bends towards): −y for +Mz, +z for +My
        const sgn = key === 'Mz' ? -1 : key === 'My' ? 1 : 1;
        const base = mr.s.map(s => [0, 1, 2].map(c => a[c] + ex[c] * s));
        const tips = mr.s.map((s, i) => base[i].map((v, c) => v + dir[c] * sgn * vals[i] * sc));
        g.fillStyle = color; g.globalAlpha = 0.16; this.poly(g, [base[0], ...tips, base[base.length - 1]], true); g.fill();
        g.globalAlpha = 0.95; g.strokeStyle = color; g.lineWidth = 1.6; this.poly(g, tips); g.stroke();
        g.globalAlpha = 0.35; g.lineWidth = 1; for (let i = 0; i < tips.length; i += 6) this.line(g, base[i], tips[i]);
        g.globalAlpha = 1;
        // label the extreme value
        let ki = 0; for (let i = 1; i < vals.length; i++) if (Math.abs(vals[i]) > Math.abs(vals[ki])) ki = i;
        if (Math.abs(vals[ki]) > 0.02 * mx) labels.push({ p: tips[ki], v: vals[ki], color, q: key[0] === 'M' ? 'moment' : 'force' });
      });
    }
    if (ui.labels && labels.length <= 80) {
      g.font = `10.5px ${this.col.mono}`; g.textAlign = 'center'; g.textBaseline = 'bottom';
      for (const L of labels) { const q = this.P(L.p); g.fillStyle = L.color; g.fillText(units.num(L.q, L.v, 3), q[0], q[1] - 3); }
    }
  }
  showLegend(kind, R) {
    const el = this.legend;
    if (!kind || !R?.ok) { el.style.display = 'none'; return; }
    el.style.display = '';
    if (kind === 'stress') el.innerHTML = `<div>Von Mises / yield (peak in each segment)</div><div class="st-grad"></div><div class="ticks"><span>0</span><span>50%</span><span>80%</span><span>100%</span><span>120%</span></div>`;
    else if (kind === 'N') el.innerHTML = `<div><span style="color:var(--accent);font-weight:600">■ tension</span> &nbsp; <span style="color:var(--bad);font-weight:600">■ compression</span></div><div class="hint" style="margin:2px 0 0">Width ∝ |N|, values in ${units.label('force')}</div>`;
    else el.innerHTML = `<div><span style="color:var(--warn);font-weight:600">■ torque T</span></div><div class="hint" style="margin:2px 0 0">Width ∝ |T|, values in ${units.label('moment')}</div>`;
  }
}
