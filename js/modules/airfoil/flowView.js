// Composite flow visualization: GPU field (pressure/speed + streamlines), animated particles,
// and a vector overlay (airfoil, boundary layer, pressure arrows, forces, key points).
import { h, cssVar, hexToRgb, icon } from '../../lib/ui.js';
import { FieldGL } from './fieldGL.js';
import { evalPoint, cpFromSpeed, cpuGrid } from './fieldCPU.js';

export class FlowView {
  constructor(container) {
    this.stage = h('div', { class: 'stage' });
    this.glCanvas = h('canvas', { 'aria-label': 'Flow field' });
    this.pCanvas = h('canvas');
    this.oCanvas = h('canvas');
    this.readout = h('div', { class: 'readout' });
    this.legend = h('div', { class: 'legend' });
    this.tools = h('div', { class: 'stage-tools' });
    this.hint = h('div', { class: 'hint-overlay' }, 'Scroll to zoom · drag to pan · double-click to reset');
    this.stage.append(this.glCanvas, this.pCanvas, this.oCanvas, this.readout, this.legend, this.tools, this.hint);
    setTimeout(() => this.hint.classList.add('gone'), 9000);
    container.append(this.stage);
    this.gpu = new FieldGL(this.glCanvas);
    if (!this.gpu.ok) this.ctx2dField = this.glCanvas.getContext('2d');
    this.po = this.pCanvas.getContext('2d');
    this.oo = this.oCanvas.getContext('2d');
    this.layers = { field: 'cp', streamlines: true, particles: true, bl: true, arrows: false, markers: true, forces: true };
    this.blScale = 4;
    this.res = null;
    this.view = { cx: 0.5, cz: 0, scale: 0 }; // scale: world units per css px
    this.particles = [];
    this.running = true;
    this.quality = 0.75;
    this.buildTools();
    new ResizeObserver(() => this.resize()).observe(this.stage);
    this.bindInput();
    addEventListener('themechange', () => this.render());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.loop(); });
    this.loop();
  }

  buildTools() {
    const play = h('button', { class: 'btn sm', title: 'Pause / play particles' });
    const setIcon = () => { play.replaceChildren(icon(this.running ? 'pause' : 'play', 14)); };
    play.addEventListener('click', () => { this.running = !this.running; setIcon(); if (this.running) this.loop(); });
    setIcon();
    const reset = h('button', { class: 'btn sm', title: 'Reset view' }, icon('reset', 14));
    reset.addEventListener('click', () => this.resetView());
    const zoomLE = h('button', { class: 'btn sm', title: 'Zoom to leading edge' }, 'LE');
    zoomLE.addEventListener('click', () => this.zoomTo(0.02, 0, 0.12));
    const zoomTE = h('button', { class: 'btn sm', title: 'Zoom to trailing edge' }, 'TE');
    zoomTE.addEventListener('click', () => this.zoomTo(0.98, 0, 0.15));
    this.tools.append(play, reset, zoomLE, zoomTE);
  }

  get W() { return this.stage.clientWidth; }
  get H() { return this.stage.clientHeight; }

  resetView() {
    const W = this.W || 800;
    this.view = { cx: 0.5, cz: 0, scale: 1.65 / Math.max(300, W) };
    this.onViewChange(true);
  }
  zoomTo(cx, cz, width) {
    this.view = { cx, cz, scale: width / this.W };
    this.onViewChange(true);
  }

  rect() {
    const { cx, cz, scale } = this.view, W = this.W, H = this.H;
    return { x0: cx - 0.5 * W * scale, x1: cx + 0.5 * W * scale, z0: cz - 0.5 * H * scale, z1: cz + 0.5 * H * scale };
  }
  toScreen(x, z) { const r = this.rect(); return [(x - r.x0) / this.view.scale, (r.z1 - z) / this.view.scale]; }
  toWorld(X, Y) { const r = this.rect(); return [r.x0 + X * this.view.scale, r.z1 - Y * this.view.scale]; }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2), W = this.W, H = this.H;
    if (!W || !H) return;
    if (!this.view.scale) this.view.scale = 1.65 / Math.max(300, W);
    for (const c of [this.glCanvas, this.pCanvas, this.oCanvas]) {
      c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    }
    this.dpr = dpr;
    this.onViewChange(true);
  }

  setLayers(l) { Object.assign(this.layers, l); this.render(); if (l.particles !== undefined) this.clearParticles(); }
  setBLScale(s) { this.blScale = s; this.drawOverlay(); }

  setResult(res) {
    this.res = res;
    if (!res || !res.ok) { this.render(); return; }
    if (this.gpu.ok) this.gpu.setSolution(res);
    // dividing streamline: psi at the stagnation point
    const st = res.stag || { x: res.foil.x[0], z: res.foil.z[0] };
    this.psi0 = evalPoint(res, st.x, st.z).psi;
    let cpmin = 0; for (let i = 0; i < res.N; i++) cpmin = Math.min(cpmin, res.cp[i]);
    this.cpMin = Math.max(-6, Math.min(-1, Math.floor(cpmin * 2) / 2));
    this.render();
  }

  onViewChange(final) {
    this.interacting = !final;
    this.render(final ? 1 : 0.5);
    this.clearParticles();
    clearTimeout(this._vt);
    if (!final) this._vt = setTimeout(() => { this.interacting = false; this.render(1); }, 160);
  }

  render(qualityFactor = 1) {
    if (!this.W) return;
    this.renderField(qualityFactor);
    this.sampleGrid();
    this.drawOverlay();
    this.drawLegend();
  }

  bgRGB() {
    const s = cssVar('--stage');
    const rgb = s.startsWith('#') ? hexToRgb(s) : [12, 14, 18];
    return rgb.map(v => v / 255);
  }
  isDark() { return document.documentElement.dataset.resolvedTheme === 'dark'; }

  psiStep() {
    const r = this.rect(), vh = r.z1 - r.z0;
    return (this.res?.Vinf || 1) * 2 ** Math.round(Math.log2(vh / 26));
  }

  renderField(qf) {
    const res = this.res;
    if (this.gpu.ok) {
      const gl = this.gpu.gl;
      if (!res || !res.ok) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); return; }
      const t0 = performance.now();
      const mode = { cp: 1, speed: 2, none: 0 }[this.layers.field];
      // the field pass runs at reduced resolution; isolines are drawn at full resolution
      const scale = Math.min(1, this.quality * qf / this.dpr * 1.5);
      this.gpu.render(this.rect(), { mode, psiStep: this.layers.streamlines ? this.psiStep() : 0, psi0: this.psi0, cpMin: this.cpMin, bg: this.bgRGB(), dark: this.isDark(), scale });
      const dt = performance.now() - t0;
      if (qf === 1) { if (dt > 60 && this.quality > 0.35) this.quality *= 0.8; else if (dt < 15 && this.quality < 1) this.quality = Math.min(1, this.quality * 1.15); }
    } else if (this.ctx2dField) {
      // CPU fallback: coarse heatmap
      const g = this.ctx2dField; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, this.glCanvas.width, this.glCanvas.height);
      if (!res || !res.ok || this.layers.field === 'none') return;
      const w = 120, hgt = Math.max(20, Math.round(120 * this.H / this.W));
      const grid = cpuGrid(res, this.rect(), w, hgt); this.cpuGridCache = grid;
      const img = new ImageData(w, hgt), bg = this.bgRGB().map(v => v * 255);
      for (let j = 0; j < hgt; j++) for (let i = 0; i < w; i++) {
        const o = 4 * (j * w + i), q = Math.hypot(grid.data[o], grid.data[o + 1]);
        const p = 4 * ((hgt - 1 - j) * w + i);
        if (grid.data[o + 3] > 0.5) { img.data[p + 3] = 0; continue; }
        const cp = cpFromSpeed(q, res);
        const col = this.layers.field === 'cp' ? divergingJS(cp < 0 ? -Math.min(1, cp / this.cpMin) : Math.min(1, cp), bg) : seqJS(Math.min(1, q / res.Vinf / 1.8));
        img.data[p] = col[0]; img.data[p + 1] = col[1]; img.data[p + 2] = col[2]; img.data[p + 3] = 255;
      }
      const off = h('canvas', { width: w, height: hgt }); off.getContext('2d').putImageData(img, 0, 0);
      g.imageSmoothingEnabled = true; g.drawImage(off, 0, 0, this.glCanvas.width, this.glCanvas.height);
    }
  }

  sampleGrid() {
    const res = this.res;
    if (!res || !res.ok) { this.grid = null; return; }
    const w = 200, hgt = Math.max(16, Math.round(200 * this.H / this.W));
    this.grid = this.gpu.ok ? this.gpu.sampleGrid(this.rect(), w, hgt) : (this.cpuGridCache || cpuGrid(res, this.rect(), 80, Math.round(80 * this.H / this.W)));
  }

  velAt(x, z) {
    const g = this.grid; if (!g) return null;
    const v = g.view, fx = (x - v.x0) / (v.x1 - v.x0) * g.w - 0.5, fz = (z - v.z0) / (v.z1 - v.z0) * g.h - 0.5;
    const i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= g.w - 1 || j >= g.h - 1) return null;
    const a = fx - i, b = fz - j, d = g.data, w = g.w;
    const o00 = 4 * (j * w + i), o10 = o00 + 4, o01 = o00 + 4 * w, o11 = o01 + 4;
    if (d[o00 + 3] + d[o10 + 3] + d[o01 + 3] + d[o11 + 3] > 0.5) return null;
    const u = (1 - a) * (1 - b) * d[o00] + a * (1 - b) * d[o10] + (1 - a) * b * d[o01] + a * b * d[o11];
    const vv = (1 - a) * (1 - b) * d[o00 + 1] + a * (1 - b) * d[o10 + 1] + (1 - a) * b * d[o01 + 1] + a * b * d[o11 + 1];
    return [u, vv];
  }

  // ---------- particles ----------
  clearParticles() {
    this.particles = [];
    this.po.setTransform(1, 0, 0, 1, 0, 0); this.po.clearRect(0, 0, this.pCanvas.width, this.pCanvas.height);
  }
  spawn(p, anywhere) {
    const r = this.rect();
    const a = (this.res?.alpha || 0) * Math.PI / 180;
    if (anywhere || Math.random() < 0.65) { p.x = r.x0 + Math.random() * (r.x1 - r.x0); p.z = r.z0 + Math.random() * (r.z1 - r.z0); }
    else {
      // inflow boundaries (flow comes from the left, tilted by alpha)
      const sideFrac = Math.abs(Math.sin(a)) * (r.x1 - r.x0) / ((r.z1 - r.z0) + Math.abs(Math.sin(a)) * (r.x1 - r.x0));
      if (Math.random() < sideFrac) { p.x = r.x0 + Math.random() * (r.x1 - r.x0); p.z = a > 0 ? r.z0 : r.z1; }
      else { p.x = r.x0; p.z = r.z0 + Math.random() * (r.z1 - r.z0); }
    }
    p.age = 0; p.life = 1.5 + Math.random() * 3.5; p.fresh = true;
  }
  loop() {
    if (this._raf) return;
    let last = performance.now();
    const step = (t) => {
      this._raf = null;
      if (document.hidden || !this.running || !this.stage.isConnected) return;
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      this.stepParticles(dt);
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }
  stepParticles(dt) {
    const g = this.po, dpr = this.dpr || 1;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(0, 0, this.W, this.H);
    g.globalCompositeOperation = 'source-over';
    if (!this.layers.particles || !this.grid || this.interacting) return;
    const density = this.layers.streamlines ? 900 : 420;
    const target = Math.round(Math.min(2400, this.W * this.H / density));
    if (this.particles.length > target) this.particles.length = target;
    while (this.particles.length < target) { const p = {}; this.spawn(p, true); this.particles.push(p); }
    const r = this.rect(), Vinf = this.res.Vinf;
    const speed = (r.x1 - r.x0) / 3.2 / Vinf; // freestream crosses view in ~3 s
    const dark = this.isDark();
    g.lineWidth = 1.4; g.lineCap = 'round';
    g.strokeStyle = dark ? 'rgba(240,244,255,0.62)' : 'rgba(20,28,45,0.5)';
    g.beginPath();
    for (const p of this.particles) {
      p.age += dt;
      const v1 = this.velAt(p.x, p.z);
      if (!v1 || p.age > p.life) { this.spawn(p); continue; }
      const h1 = dt * speed;
      const xm = p.x + 0.5 * h1 * v1[0], zm = p.z + 0.5 * h1 * v1[1];
      const v2 = this.velAt(xm, zm);
      if (!v2) { this.spawn(p); continue; }
      const nx = p.x + h1 * v2[0], nz = p.z + h1 * v2[1];
      if (!p.fresh) {
        const [X0, Y0] = [(p.x - r.x0) / this.view.scale, (r.z1 - p.z) / this.view.scale];
        const [X1, Y1] = [(nx - r.x0) / this.view.scale, (r.z1 - nz) / this.view.scale];
        g.moveTo(X0, Y0); g.lineTo(X1, Y1);
      }
      p.fresh = false; p.x = nx; p.z = nz;
    }
    g.stroke();
  }

  // ---------- overlay ----------
  drawOverlay() {
    const g = this.oo, dpr = this.dpr || 1, W = this.W, H = this.H;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const res = this.res;
    if (!res || !res.ok) {
      g.fillStyle = cssVar('--text-3'); g.font = '13px ' + cssVar('--font'); g.textAlign = 'center';
      g.fillText(res && res.error ? 'Solver error: ' + res.error : (res ? 'No valid solution — try a smaller angle of attack' : 'Solving…'), W / 2, H / 2);
      return;
    }
    const S = (x, z) => this.toScreen(x, z);
    const N = res.N, fx = res.foil.x, fz = res.foil.z;
    // boundary layer band
    if (this.layers.bl && res.viscous) this.drawBL(g, res, S);
    // airfoil body
    g.beginPath();
    for (let i = 0; i < N; i++) { const [X, Y] = S(fx[i], fz[i]); if (i === 0) g.moveTo(X, Y); else g.lineTo(X, Y); }
    g.closePath();
    g.fillStyle = this.isDark() ? '#2b313c' : '#cfd5de'; g.fill();
    g.strokeStyle = cssVar('--text'); g.lineWidth = 1.3; g.stroke();
    if (this.layers.arrows) this.drawPressureArrows(g, res, S);
    if (this.layers.forces) this.drawForces(g, res, S);
    if (this.layers.markers) this.drawMarkers(g, res, S);
    this.drawScale(g);
  }

  normals(res, idx) {
    const t = res.tangents;
    const nx = new Float64Array(idx.length), nz = new Float64Array(idx.length);
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k]; let tx, tz;
      if (t) { tx = t.x[i]; tz = t.z[i]; }
      else { const a = Math.max(0, i - 1), b = Math.min(res.N - 1, i + 1); tx = res.foil.x[b] - res.foil.x[a]; tz = res.foil.z[b] - res.foil.z[a]; }
      const L = Math.hypot(tx, tz) || 1; nx[k] = -tz / L; nz[k] = tx / L;
    }
    return { nx, nz };
  }

  drawBL(g, res, S) {
    const d = res.dist, sc = this.blScale;
    const xall = i => i < res.N ? res.foil.x[i] : res.wake.x[i - res.N];
    const zall = i => i < res.N ? res.foil.z[i] : res.wake.z[i - res.N];
    const colLam = cssVar('--lam'), colTurb = cssVar('--turb'), colSep = cssVar('--sep');
    for (let is = 0; is < 2; is++) {
      const Is = res.Is[is], { nx, nz } = this.normals(res, Is);
      for (let k = 0; k < Is.length - 1; k++) {
        const i0 = Is[k], i1 = Is[k + 1];
        const sep = d.cf[i1] < 0 || d.cf[i0] < 0;
        const col = sep ? colSep : (d.turb[i1] ? colTurb : colLam);
        const a = S(xall(i0), zall(i0)), b = S(xall(i1), zall(i1));
        const c = S(xall(i1) + nx[k + 1] * d.ds[i1] * sc, zall(i1) + nz[k + 1] * d.ds[i1] * sc);
        const e = S(xall(i0) + nx[k] * d.ds[i0] * sc, zall(i0) + nz[k] * d.ds[i0] * sc);
        g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.lineTo(...c); g.lineTo(...e); g.closePath();
        g.fillStyle = col; g.globalAlpha = sep ? 0.55 : 0.35; g.fill();
        g.globalAlpha = 0.95; g.strokeStyle = col; g.lineWidth = 1.4;
        g.beginPath(); g.moveTo(...e); g.lineTo(...c); g.stroke();
      }
    }
    g.globalAlpha = 1;
    // wake: displacement thickness split above/below the wake line (as in mfoil)
    const Iw = res.Is[2], { nx, nz } = this.normals(res, Iw);
    const ds = d.ds, N = res.N;
    const rl = 0.5 * (1 + (ds[0] - ds[N - 1]) / ds[N]), ru = 1 - rl;
    const up = [], lo = [];
    for (let k = 0; k < Iw.length; k++) {
      const i = Iw[k], x = xall(i), z = zall(i);
      up.push(S(x + nx[k] * ds[i] * ru * sc, z + nz[k] * ds[i] * ru * sc));
      lo.push(S(x - nx[k] * ds[i] * rl * sc, z - nz[k] * ds[i] * rl * sc));
    }
    g.beginPath(); up.forEach((p, k) => k ? g.lineTo(...p) : g.moveTo(...p)); for (let k = lo.length - 1; k >= 0; k--) g.lineTo(...lo[k]); g.closePath();
    g.fillStyle = cssVar('--wake'); g.globalAlpha = 0.25; g.fill(); g.globalAlpha = 0.8;
    g.strokeStyle = cssVar('--wake'); g.lineWidth = 1.2;
    g.beginPath(); up.forEach((p, k) => k ? g.lineTo(...p) : g.moveTo(...p)); g.stroke();
    g.beginPath(); lo.forEach((p, k) => k ? g.lineTo(...p) : g.moveTo(...p)); g.stroke();
    g.globalAlpha = 1;
  }

  drawPressureArrows(g, res, S) {
    const N = res.N, cp = res.cp, { nx, nz } = this.normals(res, Int32Array.from({ length: N }, (_, i) => i));
    const chordPx = 1 / this.view.scale, L = 0.09 * chordPx; // arrow length for |cp| = 1
    const every = Math.max(1, Math.round(N / 70));
    const cSuc = '#3d8bff', cPres = '#ff5a3c';
    for (let i = 1; i < N - 1; i += every) {
      const c = cp[i], [X, Y] = S(res.foil.x[i], res.foil.z[i]);
      const len = Math.min(3, Math.abs(c)) * L;
      if (len < 3) continue;
      const dx = nx[i], dy = -nz[i];
      let x0, y0, x1, y1;
      if (c < 0) { x0 = X; y0 = Y; x1 = X + dx * len; y1 = Y + dy * len; } // suction pulls outward
      else { x0 = X + dx * len; y0 = Y + dy * len; x1 = X; y1 = Y; } // pressure pushes inward
      arrow(g, x0, y0, x1, y1, c < 0 ? cSuc : cPres, 1.2, 5);
    }
  }

  drawForces(g, res, S) {
    const a = res.alpha * Math.PI / 180, cl = res.coef.cl, cd = res.coef.cd;
    const [X, Y] = S(res.xref[0], res.xref[1]);
    // arrow length for coefficient 1, kept on screen when zoomed in
    const Lpx = Math.min(0.22 / this.view.scale, 0.28 * this.H / Math.max(1, Math.abs(cl)));
    // lift is perpendicular to the freestream, drag parallel to it
    const lx = -Math.sin(a), lz = Math.cos(a), dx = Math.cos(a), dz = Math.sin(a);
    const colL = '#22c55e', colD = '#f59e0b';
    arrow(g, X, Y, X + lx * cl * Lpx, Y - lz * cl * Lpx, colL, 2.5, 9);
    label(g, 'Lift', X + lx * cl * Lpx - 8, Y - lz * cl * Lpx + (cl >= 0 ? 4 : -4), colL, 'right');
    if (res.viscous && cd > 0) {
      const dl = Math.max(cd * Lpx * 10, 12);
      arrow(g, X, Y, X + dx * dl, Y - dz * dl, colD, 2.5, 8);
      label(g, 'Drag ×10', X + dx * dl + 6, Y - dz * dl + 12, colD);
    }
    // freestream indicator
    const r = this.rect(), [fx0, fy0] = [24, this.H - 70];
    const fl = 46;
    arrow(g, fx0, fy0, fx0 + Math.cos(a) * fl, fy0 - Math.sin(a) * fl, cssVar('--text-2'), 2, 8);
    label(g, `V∞  α = ${res.alpha.toFixed(2)}°`, fx0, fy0 + 16, cssVar('--text-2'));
  }

  drawMarkers(g, res, S) {
    const font = '11px ' + cssVar('--font');
    g.font = font;
    if (res.stag) {
      const [X, Y] = S(res.stag.x, res.stag.z);
      g.fillStyle = '#fbbf24'; g.strokeStyle = cssVar('--bg-elev'); g.lineWidth = 2;
      g.beginPath(); g.arc(X, Y, 4.5, 0, 2 * Math.PI); g.fill(); g.stroke();
      label(g, 'Stagnation point', X - 8, Y + 20, '#fbbf24', 'right');
    }
    if (res.viscous && res.transition) {
      for (let is = 0; is < 2; is++) {
        const tr = res.transition[is];
        if (tr.x === null) continue;
        const p = surfacePoint(res, is, tr.x);
        if (!p) continue;
        const [X, Y] = S(p.x, p.z), dir = is === 1 ? -1 : 1;
        g.strokeStyle = cssVar('--turb'); g.lineWidth = 2.2;
        g.beginPath(); g.moveTo(X, Y); g.lineTo(X, Y + dir * 16); g.stroke();
        label(g, `${tr.type === 'forced' ? 'Trip' : 'Transition'} x/c=${tr.x.toFixed(2)}`, X, Y + dir * 24 + (dir > 0 ? 6 : 0), cssVar('--turb'), 'center');
      }
      // separation regions (cf < 0) on the airfoil
      for (let is = 0; is < 2; is++) {
        const Is = res.Is[is];
        for (let k = 1; k < Is.length; k++) {
          const i = Is[k], ip = Is[k - 1];
          if (res.dist.cf[i] < 0 && res.dist.cf[ip] >= 0) {
            const [X, Y] = S(res.foil.x[i], res.foil.z[i]), dir = is === 1 ? -1 : 1;
            g.fillStyle = cssVar('--sep');
            g.beginPath(); g.arc(X, Y, 4, 0, 2 * Math.PI); g.fill();
            // keep clear of the transition label when both sit near the nose
            const near = res.transition[is].x !== null && Math.abs(res.transition[is].x - res.foil.x[i]) < 0.15;
            label(g, `Separation x/c=${res.foil.x[i].toFixed(2)}`, X + (near ? 14 : 0), Y + dir * (near ? 44 : 40), cssVar('--sep'), near ? 'left' : 'center');
            break;
          }
        }
      }
    }
    if (res.flapHinge) {
      const [X, Y] = S(res.flapHinge[0], res.flapHinge[1]);
      g.strokeStyle = cssVar('--text-2'); g.lineWidth = 1.5;
      g.beginPath(); g.arc(X, Y, 4, 0, 2 * Math.PI); g.stroke();
    }
  }

  drawScale(g) {
    // chord-length scale bar
    const s = this.view.scale, target = 120 * s;
    const p = 10 ** Math.floor(Math.log10(target)), m = target / p, step = (m < 2 ? 1 : m < 5 ? 2 : 5) * p;
    const px = step / s, x = this.W - px - 16, y = this.H - 14;
    g.strokeStyle = cssVar('--text-3'); g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(x, y - 4); g.lineTo(x, y); g.lineTo(x + px, y); g.lineTo(x + px, y - 4); g.stroke();
    label(g, `${+step.toPrecision(3)} c`, x + px / 2, y - 7, cssVar('--text-3'), 'center');
  }

  drawLegend() {
    const L = this.legend, res = this.res;
    L.replaceChildren();
    if (!res || !res.ok || this.layers.field === 'none') { L.style.display = 'none'; return; }
    L.style.display = '';
    const c = h('canvas', { width: 180, height: 10 }), g = c.getContext('2d'), bg = this.bgRGB().map(v => v * 255);
    for (let i = 0; i < 180; i++) {
      const t = i / 179;
      let col;
      if (this.layers.field === 'cp') {
        const cp = this.cpMin + t * (1 - this.cpMin);
        col = divergingJS(cp < 0 ? -Math.min(1, cp / this.cpMin) : Math.min(1, cp), bg);
      } else col = seqJS(t);
      g.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`; g.fillRect(i, 0, 1, 10);
    }
    if (this.layers.field === 'cp') {
      const z = (0 - this.cpMin) / (1 - this.cpMin);
      const ticks = h('div', { class: 'ticks', style: { position: 'relative', height: '13px' } },
        h('span', { style: { position: 'absolute', left: 0 } }, this.cpMin.toFixed(1)),
        h('span', { style: { position: 'absolute', left: `${(z * 100).toFixed(1)}%`, transform: 'translateX(-50%)' } }, '0'),
        h('span', { style: { position: 'absolute', right: 0 } }, '+1'));
      L.append(h('div', {}, 'Pressure coefficient Cp'), c, ticks,
        h('div', { class: 'ticks' }, h('span', {}, '← suction'), h('span', {}, 'pressure →')));
    } else {
      L.append(h('div', {}, 'Local speed V / V∞'), c, h('div', { class: 'ticks' }, h('span', {}, '0'), h('span', {}, '0.9'), h('span', {}, '1.8')));
    }
    if (res.Ma > 0) L.append(h('div', { style: { marginTop: '4px', color: '#e3b505' } }, '— sonic line (local Mach 1)'));
  }

  // ---------- input ----------
  bindInput() {
    const c = this.oCanvas;
    c.style.cursor = 'grab';
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const r = c.getBoundingClientRect(), X = e.clientX - r.left, Y = e.clientY - r.top;
      const [wx, wz] = this.toWorld(X, Y);
      const f = Math.exp(e.deltaY * (e.deltaMode ? 0.05 : 0.0016));
      const ns = Math.min(0.02, Math.max(2e-6, this.view.scale * f));
      // keep the point under the cursor fixed
      this.view.cx = wx - (X - this.W / 2) * ns;
      this.view.cz = wz + (Y - this.H / 2) * ns;
      this.view.scale = ns;
      this.onViewChange(false);
    }, { passive: false });
    let drag = null;
    c.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, cx: this.view.cx, cz: this.view.cz }; c.setPointerCapture(e.pointerId); c.style.cursor = 'grabbing'; });
    c.addEventListener('pointermove', e => {
      if (drag) {
        this.view.cx = drag.cx - (e.clientX - drag.x) * this.view.scale;
        this.view.cz = drag.cz + (e.clientY - drag.y) * this.view.scale;
        this.onViewChange(false);
        this.readout.style.display = 'none';
        return;
      }
      this.showReadout(e);
    });
    c.addEventListener('pointerup', () => { if (drag) { drag = null; c.style.cursor = 'grab'; this.onViewChange(true); } });
    c.addEventListener('pointerleave', () => { this.readout.style.display = 'none'; });
    c.addEventListener('dblclick', () => this.resetView());
  }

  showReadout(e) {
    const res = this.res; if (!res || !res.ok) return;
    const r = this.oCanvas.getBoundingClientRect(), X = e.clientX - r.left, Y = e.clientY - r.top;
    const [x, z] = this.toWorld(X, Y);
    const f = evalPoint(res, x, z);
    if (f.inside) { this.readout.style.display = 'none'; return; }
    const q = Math.hypot(f.u, f.v) / res.Vinf, cp = cpFromSpeed(q * res.Vinf, res);
    let extra = '';
    if (res.Ma > 0) {
      // local Mach from isentropic relations with the corrected Cp
      const g = 1.4, M = res.Ma, p = 1 + 0.5 * g * M * M * cp;
      const Ml = Math.sqrt(Math.max(0, 2 / (g - 1) * ((1 + 0.5 * (g - 1) * M * M) * p ** (-(g - 1) / g) - 1)));
      extra = `<br>local Mach ${Ml.toFixed(3)}`;
    }
    this.readout.innerHTML = `x/c ${x.toFixed(3)}  z/c ${z.toFixed(3)}<br>V/V∞ ${q.toFixed(3)}<br>Cp ${cp.toFixed(3)}${extra}`;
    this.readout.style.display = 'block';
    const tw = this.readout.offsetWidth;
    this.readout.style.left = Math.min(X + 14, this.W - tw - 6) + 'px';
    this.readout.style.top = Math.max(6, Y - 50) + 'px';
  }
}

// --- helpers ---
function arrow(g, x0, y0, x1, y1, color, w, head) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy); if (L < 1) return;
  const ux = dx / L, uy = dy / L, hh = Math.min(head, L * 0.6);
  g.strokeStyle = color; g.fillStyle = color; g.lineWidth = w; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1 - ux * hh * 0.6, y1 - uy * hh * 0.6); g.stroke();
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 - ux * hh - uy * hh * 0.5, y1 - uy * hh + ux * hh * 0.5);
  g.lineTo(x1 - ux * hh + uy * hh * 0.5, y1 - uy * hh - ux * hh * 0.5); g.closePath(); g.fill();
}
function label(g, text, x, y, color, align = 'left') {
  g.font = '11.5px ' + cssVar('--font'); g.textAlign = align; g.textBaseline = 'middle';
  g.lineWidth = 3.5; g.strokeStyle = cssVar('--stage'); g.lineJoin = 'round'; g.strokeText(text, x, y);
  g.fillStyle = color; g.fillText(text, x, y);
}
export function surfacePoint(res, is, xq) {
  const Is = res.Is[is];
  for (let k = 0; k < Is.length - 1; k++) {
    const a = Is[k], b = Is[k + 1], xa = res.foil.x[a], xb = res.foil.x[b];
    if ((xa - xq) * (xb - xq) <= 0 && xa !== xb) {
      const t = (xq - xa) / (xb - xa);
      return { x: xq, z: res.foil.z[a] + t * (res.foil.z[b] - res.foil.z[a]) };
    }
  }
  return null;
}
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
export function divergingJS(t, bg) {
  const neg = [26, 115, 255], neg2 = [140, 217, 255], pos = [255, 84, 51], pos2 = [255, 204, 89];
  let c;
  if (t < 0) { const a = -t; c = mix(bg, mix(neg, neg2, smooth(0.55, 1, a)), smooth(0, 0.9, a ** 0.75)); }
  else { c = mix(bg, mix(pos, pos2, smooth(0.6, 1, t)), smooth(0, 0.9, t ** 0.75)); }
  return c.map(Math.round);
}
export function seqJS(t) {
  const cs = [[13, 8, 46], [115, 31, 140], [230, 77, 89], [252, 191, 102], [252, 252, 191]];
  t = Math.min(1, Math.max(0, t)) * 4; const i = Math.min(3, Math.floor(t));
  return mix(cs[i], cs[i + 1], t - i).map(Math.round);
}
