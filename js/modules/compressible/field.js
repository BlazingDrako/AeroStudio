// FieldStage: draws a 2-D compressible flow field (color map / schlieren), overlays, particles,
// streamlines and a hover readout. Scenes supply either sample(x, y) → state or fill(grid).
// A state is { M, th (flow angle, rad), p, T, rho, p0 } relative to a reference; null = no flow (solid/ambient).
import { h, cssVar } from '../../lib/ui.js';

// Flow colormap (smooth sequential: indigo → blue → cyan → mint → sand → orange → crimson), t in [0,1] → [r,g,b]
const FLOW_STOPS = [[0, 27, 31, 94], [0.16, 38, 84, 196], [0.32, 34, 160, 214], [0.48, 110, 214, 190], [0.62, 214, 232, 160], [0.76, 246, 200, 100], [0.88, 236, 124, 58], [1, 184, 38, 66]];
export function turbo(t) {
  t = Math.min(1, Math.max(0, t));
  for (let i = 1; i < FLOW_STOPS.length; i++) if (t <= FLOW_STOPS[i][0]) {
    const a = FLOW_STOPS[i - 1], b = FLOW_STOPS[i], f = (t - a[0]) / (b[0] - a[0]), e = f * f * (3 - 2 * f) * 0.35 + f * 0.65;
    return [a[1] + e * (b[1] - a[1]), a[2] + e * (b[2] - a[2]), a[3] + e * (b[3] - a[3])];
  }
  return FLOW_STOPS[FLOW_STOPS.length - 1].slice(1);
}
// Exhaust glow: black → deep red → orange → yellow → white
export function fire(t) {
  t = Math.min(1, Math.max(0, t));
  const stops = [[0, 8, 6, 20], [0.3, 120, 18, 30], [0.55, 235, 90, 20], [0.78, 255, 190, 60], [1, 255, 250, 225]];
  for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) {
    const a = stops[i - 1], b = stops[i], f = (t - a[0]) / (b[0] - a[0]);
    return [a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2]), a[3] + f * (b[3] - a[3])];
  }
  return [255, 250, 225];
}
export const QUANTITIES = {
  M: { label: 'Mach number', short: 'M' },
  p: { label: 'Pressure', short: 'p' },
  T: { label: 'Temperature', short: 'T' },
  rho: { label: 'Density', short: 'ρ' },
  p0: { label: 'Total-pressure loss', short: 'p₀' },
  schlieren: { label: 'Schlieren (density gradient)', short: '|∇ρ|' },
  glow: { label: 'Exhaust glow (temperature)', short: 'T' },
};

export class FieldStage {
  constructor(container, { height = 'max(420px, 52vh)' } = {}) {
    this.stage = h('div', { class: 'stage cf-stage', style: { height } });
    this.canvas = h('canvas');
    this.readout = h('div', { class: 'readout' });
    this.legend = h('div', { class: 'legend' });
    this.legendBar = h('canvas', { width: 180, height: 10 });
    this.stage.append(this.canvas, this.readout, this.legend);
    container.append(this.stage);
    this.stage.__fs = this; // lets tests force a repaint when the page is hidden
    this.ctx = this.canvas.getContext('2d');
    this.off = document.createElement('canvas');
    this.trail = document.createElement('canvas'); // particle comet trails (device pixels)
    this.layers = { field: true, particles: true, streamlines: false, waves: true, labels: true, contours: true };
    this.quantity = 'M';
    this.scene = null; this.grid = null; this.particles = [];
    this.mouse = null; this.job = null;
    this.t0 = performance.now(); this.last = this.t0;
    this.ro = new ResizeObserver(() => { this.dirty = true; });
    this.ro.observe(this.stage);
    this.canvas.addEventListener('mousemove', e => { const r = this.canvas.getBoundingClientRect(); this.mouse = { x: e.clientX - r.left, y: e.clientY - r.top }; this.updateReadout(); });
    this.canvas.addEventListener('mouseleave', () => { this.mouse = null; this.readout.style.display = 'none'; });
    this.onTheme = () => { this.dirty = true; };
    addEventListener('themechange', this.onTheme);
    this.alive = true;
    const loop = now => { if (!this.alive) return; this.frame(now); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  destroy() { this.alive = false; this.ro.disconnect(); removeEventListener('themechange', this.onTheme); }
  setScene(scene) { this.scene = scene; this.dirty = true; this.particles = []; this.clearTrails = true; }
  setQuantity(q) { this.quantity = q; this.paintDirty = true; }
  // re-sample the current scene (live data such as CFD) without resetting particles
  refreshField() { this.refreshPending = true; }
  setLayers(l) { Object.assign(this.layers, l); this.paintDirty = true; if ('particles' in l && !l.particles) { this.particles = []; this.clearTrails = true; } }

  // world ↔ screen
  layout() {
    const W = this.stage.clientWidth, H = this.stage.clientHeight, dpr = Math.min(devicePixelRatio || 1, 2);
    if (!W || !H) return false;
    const cw = Math.round(W * dpr), ch = Math.round(H * dpr);
    if (this.canvas.width !== cw || this.canvas.height !== ch) { this.canvas.width = cw; this.canvas.height = ch; }
    if (this.trail.width !== cw || this.trail.height !== ch) { this.trail.width = cw; this.trail.height = ch; }
    this.clearTrails = true;
    const b = this.scene.bounds, pad = this.scene.pad ?? 16;
    const s = Math.min((W - 2 * pad) / (b.x1 - b.x0), (H - 2 * pad - (this.scene.padBottom || 0)) / (b.y1 - b.y0));
    const cx = 0.5 * (b.x0 + b.x1), cy = 0.5 * (b.y0 + b.y1);
    const ox = W / 2 - cx * s, oy = (H - (this.scene.padBottom || 0)) / 2 + cy * s;
    this.T = { W, H, dpr, s, sx: x => ox + x * s, sy: y => oy - y * s, wx: X => (X - ox) / s, wy: Y => (oy - Y) / s };
    return true;
  }

  // Grid of states. Built coarse first (instant), then refined to screen resolution over a few frames.
  newGrid(cell) {
    const T = this.T, nx = Math.ceil(T.W / cell), ny = Math.ceil(T.H / cell), n = nx * ny;
    const G = { nx, ny, cell, x0: T.wx(0), y0: T.wy(0), dx: cell / T.s, dy: -cell / T.s,
      M: new Float32Array(n), th: new Float32Array(n), p: new Float32Array(n), T: new Float32Array(n), rho: new Float32Array(n), p0: new Float32Array(n), k: new Uint8Array(n) };
    G.set = (i, s) => { if (!s) { G.k[i] = 0; return; } G.k[i] = s.k ?? 1; G.M[i] = s.M; G.th[i] = s.th || 0; G.p[i] = s.p; G.T[i] = s.T; G.rho[i] = s.rho; G.p0[i] = s.p0 ?? 1; };
    return G;
  }
  fillRows(G, j0, j1) {
    const f = this.scene.sample;
    for (let j = j0; j < j1; j++) { const y = G.y0 + (j + 0.5) * G.dy, o = j * G.nx; for (let i = 0; i < G.nx; i++) G.set(o + i, f(G.x0 + (i + 0.5) * G.dx, y)); }
  }
  fineCell() { return this.scene.cell || Math.max(0.75, 1.5 / this.T.dpr); }
  buildCoarse() {
    const G = this.newGrid(Math.max(3, this.fineCell()));
    if (this.scene.sample) this.fillRows(G, 0, G.ny);
    if (this.scene.fill) this.scene.fill(G, this);
    this.finishGrid(G);
    // schedule refinement
    const F = this.newGrid(this.fineCell());
    this.job = { G: F, row: 0, start: performance.now() + 90 };
  }
  stepJob(now) {
    const J = this.job; if (!J || now < J.start) return;
    if (!this.scene.sample) { if (this.scene.fill) this.scene.fill(J.G, this); J.row = J.G.ny; }
    else { const t1 = performance.now() + 10; while (J.row < J.G.ny && performance.now() < t1) { const r = Math.min(J.G.ny, J.row + 8); this.fillRows(J.G, J.row, r); J.row = r; } }
    if (J.row >= J.G.ny) { this.job = null; this.finishGrid(J.G); this.paintField(); this.updateReadout(); }
  }
  finishGrid(G) {
    this.grid = G;
    const { nx, ny, cell } = G;
    this.sonic = [];
    if (this.scene.sonic) { // M = 1 iso-line by marching squares
      const st = Math.max(1, Math.round(2 / cell));
      for (let j = 0; j + st < ny; j += st) for (let i = 0; i + st < nx; i += st) {
        const c0 = j * nx + i, c1 = c0 + st, c2 = c0 + st * nx + st, c3 = c0 + st * nx;
        if (G.k[c0] !== 1 || G.k[c1] !== 1 || G.k[c2] !== 1 || G.k[c3] !== 1) continue;
        const a = G.M[c0] - 1, b = G.M[c1] - 1, c = G.M[c2] - 1, d = G.M[c3] - 1, pts = [];
        const X0 = (i + 0.5) * cell, Y0 = (j + 0.5) * cell, X1 = X0 + st * cell, Y1 = Y0 + st * cell;
        const e = (v1, v2, x1, y1, x2, y2) => { if (v1 * v2 < 0) { const t = v1 / (v1 - v2); pts.push(x1 + t * (x2 - x1), y1 + t * (y2 - y1)); } };
        e(a, b, X0, Y0, X1, Y0); e(b, c, X1, Y0, X1, Y1); e(c, d, X1, Y1, X0, Y1); e(d, a, X0, Y1, X0, Y0);
        if (pts.length >= 4) this.sonic.push(pts[0], pts[1], pts[2], pts[3]);
      }
    }
    this.streams = [];
    if (this.scene.seeds) for (const s of this.scene.seeds()) this.streams.push(this.trace(s.x, s.y, s.dir || 1));
  }
  lookup(x, y) {
    const G = this.grid; if (!G) return -1;
    const i = Math.floor((x - G.x0) / G.dx), j = Math.floor((y - G.y0) / G.dy);
    if (i < 0 || j < 0 || i >= G.nx || j >= G.ny) return -1;
    return j * G.nx + i;
  }
  stateAt(x, y) {
    const G = this.grid, i = this.lookup(x, y);
    if (i < 0 || !G.k[i]) return null;
    return { M: G.M[i], th: G.th[i], p: G.p[i], T: G.T[i], rho: G.rho[i], p0: G.p0[i], k: G.k[i] };
  }
  vel(x, y) { const i = this.lookup(x, y), G = this.grid; if (i < 0 || G.k[i] !== 1) return null; const V = G.M[i] * Math.sqrt(G.T[i]); return [V * Math.cos(G.th[i]), V * Math.sin(G.th[i])]; }
  trace(x, y, dir) {
    const pts = [{ x, y }], h0 = Math.max(this.grid.dx, (this.scene.bounds.x1 - this.scene.bounds.x0) / 600), b = this.scene.bounds;
    for (let k = 0; k < 4000; k++) {
      const v1 = this.vel(x, y); if (!v1) break;
      const n1 = Math.hypot(v1[0], v1[1]) || 1;
      const xm = x + 0.5 * h0 * dir * v1[0] / n1, ym = y + 0.5 * h0 * dir * v1[1] / n1;
      const v2 = this.vel(xm, ym); if (!v2) break;
      const n2 = Math.hypot(v2[0], v2[1]) || 1;
      x += h0 * dir * v2[0] / n2; y += h0 * dir * v2[1] / n2;
      pts.push({ x, y });
      if (x < b.x0 - 1 || x > b.x1 + 1 || y < b.y0 - 1 || y > b.y1 + 1) break;
    }
    return pts;
  }

  range(q) {
    const sc = this.scene, G = this.grid;
    if (sc.ranges && sc.ranges[q]) return sc.ranges[q];
    let lo = Infinity, hi = -Infinity;
    const A = G[q === 'glow' ? 'T' : q];
    for (let i = 0; i < A.length; i++) if (G.k[i] === 1) { const v = A[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (hi - lo < 1e-6) { lo -= 0.05 * Math.abs(lo) + 1e-3; hi += 0.05 * Math.abs(hi) + 1e-3; }
    // pad so a few uniform regions sit in the middle of the palette, not on its harsh ends
    const span = Math.max(hi - lo, 0.2 * Math.abs(hi));
    lo = Math.max(q === 'M' ? 0 : lo - span, lo - 0.22 * span); hi = hi + 0.14 * span;
    return [lo, hi];
  }

  paintField() {
    const G = this.grid, q = this.quantity, off = this.off;
    off.width = G.nx; off.height = G.ny;
    const oc = off.getContext('2d'), img = oc.createImageData(G.nx, G.ny), D = img.data;
    const dark = document.documentElement.dataset.resolvedTheme === 'dark';
    const amb = dark ? [20, 23, 30] : [233, 236, 241];
    const nx = G.nx, ny = G.ny;
    if (q === 'schlieren') {
      // knife-edge schlieren: grey background, dark where density rises along the flow, light where it falls
      const R = G.rho, gx = new Float32Array(R.length), gm = new Float32Array(R.length), mags = [];
      for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
        const c = j * nx + i; if (G.k[c] !== 1) continue;
        const l = G.k[c - 1] === 1 ? R[c - 1] : R[c], r = G.k[c + 1] === 1 ? R[c + 1] : R[c], u = G.k[c - nx] === 1 ? R[c - nx] : R[c], d = G.k[c + nx] === 1 ? R[c + nx] : R[c];
        gx[c] = r - l; gm[c] = Math.hypot(r - l, u - d); if (gm[c] > 0) mags.push(gm[c]);
      }
      mags.sort((a, b) => a - b);
      const ref = mags.length ? mags[Math.floor(mags.length * 0.995)] || mags[mags.length - 1] : 1;
      const k = 2.2 / (ref || 1), base = dark ? 118 : 168, span = dark ? 105 : 85;
      for (let c = 0; c < R.length; c++) {
        const o = 4 * c;
        if (G.k[c] === 1) {
          const sgn = Math.tanh(-k * (0.65 * gx[c] + 0.35 * gm[c] * Math.sign(gx[c] || 1)));
          const shade = Math.tanh(k * 0.5 * gm[c]);
          const v = base + span * sgn - 25 * shade;
          D[o] = v * 0.97; D[o + 1] = v * 0.99; D[o + 2] = Math.min(255, v * 1.04 + 4); D[o + 3] = 255;
        } else if (G.k[c] === 2) { D[o] = amb[0]; D[o + 1] = amb[1]; D[o + 2] = amb[2]; D[o + 3] = 255; }
        else D[o + 3] = 0;
      }
    } else {
      const A = G[q === 'glow' ? 'T' : q], [lo, hi] = this.range(q), map = q === 'glow' ? fire : turbo;
      const ambG = q === 'glow' ? [6, 5, 12] : amb;
      const LUT = new Uint8ClampedArray(256 * 3);
      for (let i = 0; i < 256; i++) { const [r, g, b] = map(i / 255); LUT[3 * i] = r; LUT[3 * i + 1] = g; LUT[3 * i + 2] = b; }
      const sc = 255 / (hi - lo);
      for (let c = 0; c < A.length; c++) {
        const o = 4 * c;
        if (G.k[c] === 1) { const t = Math.max(0, Math.min(255, (A[c] - lo) * sc)) | 0; D[o] = LUT[3 * t]; D[o + 1] = LUT[3 * t + 1]; D[o + 2] = LUT[3 * t + 2]; D[o + 3] = 255; }
        else if (G.k[c] === 2) { D[o] = ambG[0]; D[o + 1] = ambG[1]; D[o + 2] = ambG[2]; D[o + 3] = 255; }
        else D[o + 3] = 0;
      }
    }
    oc.putImageData(img, 0, 0);
    this.contours = q === 'schlieren' ? [] : this.makeContours(q);
    this.paintLegend();
  }
  // iso-lines of the shown quantity (marching squares on a decimated grid)
  makeContours(q) {
    const G = this.grid, A = G[q === 'glow' ? 'T' : q], [lo, hi] = this.range(q);
    const st = Math.max(1, Math.round(3 / G.cell)), nl = 14, segs = [];
    const val = (i, j) => { const c = j * G.nx + i; return G.k[c] === 1 ? A[c] : NaN; };
    for (let j = 0; j + st < G.ny; j += st) for (let i = 0; i + st < G.nx; i += st) {
      const a = val(i, j), b = val(i + st, j), c = val(i + st, j + st), d = val(i, j + st);
      if (!(a === a && b === b && c === c && d === d)) continue;
      const mn = Math.min(a, b, c, d), mx = Math.max(a, b, c, d);
      if (mx - mn < (hi - lo) * 0.004 || mx - mn > (hi - lo) * 0.2) continue; // skip near-uniform cells (noise) and shock jumps
      for (let L = 1; L < nl; L++) {
        const v = lo + (hi - lo) * L / nl; if (v < mn || v > mx) continue;
        const pts = [];
        const e = (v1, v2, x1, y1, x2, y2) => { if ((v1 - v) * (v2 - v) < 0) { const t = (v - v1) / (v2 - v1); pts.push([x1 + t * (x2 - x1), y1 + t * (y2 - y1)]); } };
        const X0 = (i + 0.5) * G.cell, Y0 = (j + 0.5) * G.cell, X1 = X0 + st * G.cell, Y1 = Y0 + st * G.cell;
        e(a, b, X0, Y0, X1, Y0); e(b, c, X1, Y0, X1, Y1); e(c, d, X1, Y1, X0, Y1); e(d, a, X0, Y1, X0, Y0);
        if (pts.length >= 2) segs.push(pts[0][0], pts[0][1], pts[1][0], pts[1][1]);
      }
    }
    return segs;
  }
  paintLegend() {
    const q = this.quantity, sc = this.scene;
    if (!this.layers.field || sc.noField) { this.legend.style.display = 'none'; return; }
    this.legend.style.display = '';
    const name = (sc.qlabel && sc.qlabel[q]) || QUANTITIES[q].label;
    if (q === 'schlieren') { this.legend.replaceChildren(h('div', {}, 'Schlieren (knife edge)'), h('div', { class: 'ticks' }, h('span', {}, 'dark = compression · light = expansion'))); return; }
    const c = this.legendBar, g = c.getContext('2d'), map = q === 'glow' ? fire : turbo;
    for (let i = 0; i < 180; i++) { const [r, gg, b] = map(i / 179); g.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`; g.fillRect(i, 0, 1, 10); }
    const [lo, hi] = this.range(q), f = v => Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
    this.legend.replaceChildren(h('div', {}, name), c, h('div', { class: 'ticks' }, h('span', {}, f(lo)), h('span', {}, f(0.5 * (lo + hi))), h('span', {}, f(hi))));
  }

  frame(now) {
    if (!this.scene) return;
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    if (this.dirty) { if (!this.layout()) return; if (!this.scene.noField) { this.buildCoarse(); this.paintField(); } else { this.grid = null; this.job = null; this.sonic = []; this.streams = []; this.contours = []; this.legend.style.display = 'none'; } this.dirty = false; this.paintDirty = false; this.updateReadout(); }
    else if (this.paintDirty) { if (!this.scene.noField && this.grid) this.paintField(); this.paintDirty = false; }
    if (this.refreshPending && !this.dirty && this.T && !this.scene.noField) {
      const G = this.newGrid(Math.max(this.fineCell(), 1.25));
      if (this.scene.sample) this.fillRows(G, 0, G.ny);
      if (this.scene.fill) this.scene.fill(G, this);
      this.job = null; this.finishGrid(G); this.paintField(); this.refreshPending = false; this.updateReadout();
    }
    if (this.job) this.stepJob(now);
    const T = this.T, g = this.ctx, sc = this.scene;
    g.setTransform(T.dpr, 0, 0, T.dpr, 0, 0);
    g.clearRect(0, 0, T.W, T.H);
    const dark = document.documentElement.dataset.resolvedTheme === 'dark';
    const glow = this.quantity === 'glow';
    if (glow) { g.fillStyle = '#06050c'; g.fillRect(0, 0, T.W, T.H); }
    const fieldOn = this.layers.field && !sc.noField;
    if (fieldOn && this.grid) {
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(this.off, 0, 0, this.grid.nx * this.grid.cell, this.grid.ny * this.grid.cell);
    }
    const onField = glow || (fieldOn && this.quantity !== 'schlieren');
    const ink = onField ? 'rgba(255,255,255,0.9)' : (dark ? 'rgba(230,234,240,0.85)' : 'rgba(20,24,33,0.8)');
    const ctx = { g, T, layers: this.layers, dark, ink, t: (now - this.t0) / 1000, dt, quantity: this.quantity, fieldOn: onField, css: cssVar, thinOverlay: !!sc.thinOverlay };
    if (fieldOn && this.layers.contours && this.contours && this.contours.length) {
      const C = this.contours; g.beginPath();
      for (let i = 0; i < C.length; i += 4) { g.moveTo(C[i], C[i + 1]); g.lineTo(C[i + 2], C[i + 3]); }
      g.strokeStyle = glow ? 'rgba(255,230,200,0.18)' : 'rgba(255,255,255,0.22)'; g.lineWidth = 0.7; g.stroke();
    }
    if (this.layers.streamlines && this.streams) {
      g.strokeStyle = ink; g.globalAlpha = 0.6; g.lineWidth = 1.1; g.lineJoin = 'round';
      for (const s of this.streams) { g.beginPath(); s.forEach((p, i) => i ? g.lineTo(T.sx(p.x), T.sy(p.y)) : g.moveTo(T.sx(p.x), T.sy(p.y))); g.stroke(); }
      g.globalAlpha = 1;
    }
    if (this.sonic && this.sonic.length && this.layers.waves) {
      const S = this.sonic; g.beginPath();
      for (let i = 0; i < S.length; i += 4) { g.moveTo(S[i], S[i + 1]); g.lineTo(S[i + 2], S[i + 3]); }
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 3.2; g.lineCap = 'round'; g.stroke();
      g.strokeStyle = onField ? 'rgba(255,255,255,0.95)' : ink; g.lineWidth = 1.5; g.stroke();
    }
    if (this.layers.particles && sc.spawn && this.grid) this.stepParticles(ctx, onField);
    else if (this.clearTrails) { this.trail.getContext('2d').clearRect(0, 0, this.trail.width, this.trail.height); this.clearTrails = false; }
    if (sc.draw) sc.draw(ctx);
  }

  stepParticles(ctx, onField) {
    const { g, T, dt } = ctx, sc = this.scene, area = T.W * T.H;
    const N = Math.round((sc.nParticles || 420) * Math.min(1.6, Math.max(0.6, area / 6e5))), speed = (sc.speed || 1) * (sc.bounds.x1 - sc.bounds.x0) / 5;
    const tc = this.trail.getContext('2d');
    tc.setTransform(T.dpr, 0, 0, T.dpr, 0, 0);
    if (this.clearTrails) { tc.clearRect(0, 0, T.W, T.H); this.clearTrails = false; }
    // fade old trails
    tc.globalCompositeOperation = 'destination-in'; tc.fillStyle = `rgba(0,0,0,${Math.pow(0.9, dt * 60)})`; tc.fillRect(0, 0, T.W, T.H);
    tc.globalCompositeOperation = 'source-over';
    // Scenes spawn inflow particles at bounds.x0, but on a wide stage the view shows more flow to the
    // left of that. Shift inflow spawns to the visible left edge so particles cover the whole picture.
    const bx0 = sc.bounds.x0, bw = sc.bounds.x1 - bx0, ext = Math.max(0, bx0 - T.wx(0));
    const spawn = init => {
      const p = sc.spawn(init);
      if (ext > 0) {
        const x = p.x;
        if (!init) { if (p.x < bx0 + 0.06 * bw) p.x -= ext; }
        else if (Math.random() < ext / (ext + bw)) p.x = bx0 - ext + Math.random() * ext;
        if (p.x !== x && !this.vel(p.x, p.y)) p.x = x; // no flow data there (e.g. live CFD domain): keep the scene's spot
      }
      return p;
    };
    while (this.particles.length < N) { const p = spawn(true); this.particles.push({ ...p, px: p.x, py: p.y, age: Math.random() * (sc.maxAge || 12), wait: 0 }); }
    if (this.particles.length > N) this.particles.length = N;
    const col = onField ? '255,255,255' : (ctx.dark ? '225,230,238' : '30,36,48');
    tc.strokeStyle = `rgba(${col},0.75)`; tc.lineWidth = 1.25; tc.lineCap = 'round'; tc.beginPath();
    const heads = [];
    for (const p of this.particles) {
      if (p.wait > 0) { p.wait -= dt; continue; } // staggered re-entry so inflow particles don't march as a front
      const v = this.vel(p.x, p.y);
      p.age += dt;
      if (!v || p.age > (sc.maxAge || 12)) { Object.assign(p, spawn(false)); p.px = p.x; p.py = p.y; p.age = 0; p.wait = Math.random() * 1.2; continue; }
      p.px = p.x; p.py = p.y;
      p.x += v[0] * speed * dt; p.y += v[1] * speed * dt;
      const X0 = T.sx(p.px), Y0 = T.sy(p.py), X = T.sx(p.x), Y = T.sy(p.y);
      if (Math.abs(X - X0) + Math.abs(Y - Y0) > 60) continue;
      tc.moveTo(X0, Y0); tc.lineTo(X, Y); heads.push(X, Y);
    }
    tc.stroke();
    g.drawImage(this.trail, 0, 0, T.W, T.H);
    g.fillStyle = `rgba(${col},0.95)`;
    for (let i = 0; i < heads.length; i += 2) { g.beginPath(); g.arc(heads[i], heads[i + 1], 1.15, 0, 6.2832); g.fill(); }
  }

  updateReadout() {
    if (!this.mouse || !this.scene || !this.T) return;
    const x = this.T.wx(this.mouse.x), y = this.T.wy(this.mouse.y);
    let html = this.scene.readout ? this.scene.readout(x, y, this.grid ? this.stateAt(x, y) : null) : null;
    if (html === undefined || html === null) {
      const s = this.grid ? this.stateAt(x, y) : null;
      if (!s || s.k !== 1) { this.readout.style.display = 'none'; return; }
      const r = this.scene.refNames || { p: 'p/p∞', T: 'T/T∞', rho: 'ρ/ρ∞', p0: 'p₀/p₀∞' };
      html = `M ${s.M.toFixed(3)}<br>${r.p} ${s.p.toFixed(3)}<br>${r.T} ${s.T.toFixed(3)}<br>${r.rho} ${s.rho.toFixed(3)}<br>${r.p0} ${s.p0.toFixed(3)}<br>flow angle ${(s.th * 180 / Math.PI).toFixed(2)}°`;
    }
    if (!html) { this.readout.style.display = 'none'; return; }
    this.readout.innerHTML = html; this.readout.style.display = 'block';
    const w = this.readout.offsetWidth, hh = this.readout.offsetHeight;
    this.readout.style.left = Math.min(this.mouse.x + 14, this.T.W - w - 6) + 'px';
    this.readout.style.top = Math.min(this.mouse.y + 14, this.T.H - hh - 6) + 'px';
  }
}

// ---------- overlay drawing helpers ----------
export function poly(ctx, pts, { fill, stroke, width = 1.5, close = true, dash } = {}) {
  const { g, T } = ctx; g.beginPath();
  if (ctx.thinOverlay && stroke && width >= 2.4) { width = 1.4; dash = [7, 5]; } // theory lines drawn over CFD
  pts.forEach((p, i) => i ? g.lineTo(T.sx(p.x), T.sy(p.y)) : g.moveTo(T.sx(p.x), T.sy(p.y)));
  if (close) g.closePath();
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) {
    g.lineJoin = 'round'; g.lineCap = 'round'; g.setLineDash(dash || []);
    if (width >= 2.4 && !dash) { // shocks: soft halo under a crisp core
      g.save(); g.globalAlpha = 0.22; g.strokeStyle = stroke; g.lineWidth = width * 3.2; g.stroke(); g.globalAlpha = 0.35; g.lineWidth = width * 1.8; g.stroke(); g.restore();
    }
    g.strokeStyle = stroke; g.lineWidth = width; g.stroke(); g.setLineDash([]);
  }
}
// Solid bodies and walls: shaded metal with a soft shadow and a highlighted edge.
export function body(ctx, pts) {
  const { g, T } = ctx;
  let y0 = Infinity, y1 = -Infinity; for (const p of pts) { const Y = T.sy(p.y); if (Y < y0) y0 = Y; if (Y > y1) y1 = Y; }
  y0 = Math.max(y0, -10); y1 = Math.min(y1, T.H + 10);
  const gr = g.createLinearGradient(0, y0, 0, y1 + 1);
  if (ctx.dark || ctx.fieldOn) { gr.addColorStop(0, '#9aa4b4'); gr.addColorStop(0.45, '#6b7484'); gr.addColorStop(1, '#3b4250'); }
  else { gr.addColorStop(0, '#d7dde6'); gr.addColorStop(0.5, '#b4bcc8'); gr.addColorStop(1, '#8f98a6'); }
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 10; g.shadowOffsetY = 2;
  poly(ctx, pts, { fill: gr });
  g.restore();
  poly(ctx, pts, { stroke: ctx.dark || ctx.fieldOn ? 'rgba(255,255,255,0.45)' : 'rgba(30,36,48,0.45)', width: 1.1 });
}
export function line(ctx, a, b, color, width = 1.5, dash) { poly(ctx, [a, b], { stroke: color, width, close: false, dash }); }
export function label(ctx, p, text, { color, align = 'left', base = 'middle', dx = 0, dy = 0, bg = true, size = 11.5 } = {}) {
  if (!ctx.layers.labels) return;
  const { g, T } = ctx, X = T.sx(p.x) + dx, Y = T.sy(p.y) + dy;
  g.font = `600 ${size}px ` + ctx.css('--font'); g.textAlign = align; g.textBaseline = base;
  if (bg) {
    const w = g.measureText(text).width, hgt = size + 6;
    let x0 = align === 'left' ? X - 4 : align === 'right' ? X - w - 4 : X - w / 2 - 4;
    let y0 = base === 'middle' ? Y - hgt / 2 : base === 'top' ? Y - 3 : Y - hgt + 3;
    g.fillStyle = ctx.dark || ctx.fieldOn ? 'rgba(10,12,16,0.62)' : 'rgba(255,255,255,0.8)';
    g.beginPath(); g.roundRect ? g.roundRect(x0, y0, w + 8, hgt, 4) : g.rect(x0, y0, w + 8, hgt); g.fill();
  }
  g.fillStyle = color || (ctx.dark || ctx.fieldOn ? '#fff' : '#161a21');
  g.fillText(text, X, Y);
}
export function arrow(ctx, a, b, color, width = 1.6) {
  const { g, T } = ctx, X1 = T.sx(a.x), Y1 = T.sy(a.y), X2 = T.sx(b.x), Y2 = T.sy(b.y), ang = Math.atan2(Y2 - Y1, X2 - X1);
  g.strokeStyle = color; g.fillStyle = color; g.lineWidth = width; g.beginPath(); g.moveTo(X1, Y1); g.lineTo(X2, Y2); g.stroke();
  g.beginPath(); g.moveTo(X2, Y2); g.lineTo(X2 - 8 * Math.cos(ang - 0.4), Y2 - 8 * Math.sin(ang - 0.4)); g.lineTo(X2 - 8 * Math.cos(ang + 0.4), Y2 - 8 * Math.sin(ang + 0.4)); g.closePath(); g.fill();
}
export function arcAngle(ctx, c, r, a0, a1, color, text) {
  const { g, T } = ctx; g.strokeStyle = color; g.lineWidth = 1.2; g.beginPath();
  g.arc(T.sx(c.x), T.sy(c.y), r, -a1, -a0); g.stroke();
  if (text) label(ctx, { x: c.x + (r + 12) / T.s * Math.cos(0.5 * (a0 + a1)), y: c.y + (r + 12) / T.s * Math.sin(0.5 * (a0 + a1)) }, text, { color, align: 'center', bg: false, size: 11 });
}
