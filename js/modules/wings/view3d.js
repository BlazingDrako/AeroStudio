// 3-D wing view on a 2-D canvas: an orthographic camera you turn by dragging and zoom with the wheel. Draws the
// lattice panels coloured by their pressure difference ΔCp (the Airfoil Lab's scale), lift arrows along the span,
// the trailing vortex sheet rolling up behind the wing, stall tufts, the ground plane and a tail marker.
import { h, segmented } from '../../lib/ui.js';
import { divergingJS } from '../airfoil/flowView.js';
import { css, D } from './common.js';

const hexRgb = c => { const m = /^#?([0-9a-f]{6})$/i.exec(c.trim()); if (m) { const n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; } const r = /rgba?\(([^)]+)\)/.exec(c); return r ? r[1].split(',').slice(0, 3).map(Number) : [255, 255, 255]; };

export class WingView {
  constructor({ height = 'max(400px, 52vh)', views = true } = {}) {
    this.el = h('div', { class: 'cf-chart wg-view', style: { height } });
    this.cv = h('canvas');
    this.legend = h('div', { class: 'legend wg-legend' });
    this.el.append(this.cv, this.legend);
    this.g = this.cv.getContext('2d', { alpha: true });
    this.cam = { az: 215 * D, el: 24 * D, zoom: 1 };
    this.layers = { pressure: true, arrows: true, wake: true, tufts: false, ground: true };
    this.data = null; this.t = 0; this.raf = 0; this.animate = false;
    let drag = null;
    this.cv.style.cursor = 'grab'; this.cv.style.touchAction = 'none';
    this.cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, az: this.cam.az, el: this.cam.el }; this.cv.setPointerCapture(e.pointerId); this.cv.style.cursor = 'grabbing'; });
    this.cv.addEventListener('pointermove', e => {
      if (!drag) return;
      this.cam.az = drag.az - (e.clientX - drag.x) * 0.008;
      this.cam.el = Math.max(-89 * D, Math.min(89.5 * D, drag.el + (e.clientY - drag.y) * 0.008));
      this.draw();
    });
    const up = () => { drag = null; this.cv.style.cursor = 'grab'; };
    this.cv.addEventListener('pointerup', up); this.cv.addEventListener('pointercancel', up);
    this.cv.addEventListener('wheel', e => { e.preventDefault(); this.cam.zoom = Math.max(0.4, Math.min(8, this.cam.zoom * Math.exp(-e.deltaY * 0.0015))); this.draw(); }, { passive: false });
    this.ro = new ResizeObserver(() => this.draw()); this.ro.observe(this.el);
    this.onTheme = () => this.draw(); addEventListener('themechange', this.onTheme);
    if (views) {
      const seg = segmented([{ value: '3d', label: '3-D' }, { value: 'top', label: 'Top' }, { value: 'front', label: 'Front' }, { value: 'side', label: 'Side' }], '3d', v => {
        const V = { '3d': [215, 24], top: [180, 89.5], front: [180, 0], side: [270, 0] }[v]; this.setView(...V);
      });
      seg.el.classList.add('wg-views');
      this.el.append(seg.el);
    }
  }
  setView(az, el) { this.cam.az = az * D; this.cam.el = el * D; this.draw(); }
  // d: { sol, wake: rollup frames, strips: nonlinear strips (tufts), tail: [x,y,z], ground: h | null, scale: ΔCp scale }
  set(d) { this.data = d; this.draw(); }
  setLayers(o) { Object.assign(this.layers, o); this.draw(); }
  setAnimate(on) {
    this.animate = on; cancelAnimationFrame(this.raf);
    if (!on) { this.draw(); return; }
    let last = performance.now();
    const step = t => { if (!this.animate) return; this.t += (t - last) / 1000; last = t; if (this.el.isConnected) this.draw(); this.raf = requestAnimationFrame(step); };
    this.raf = requestAnimationFrame(step);
  }
  destroy() { this.animate = false; cancelAnimationFrame(this.raf); this.ro.disconnect(); removeEventListener('themechange', this.onTheme); }

  proj() {
    const { az, el } = this.cam, ca = Math.cos(az), sa = Math.sin(az), ce = Math.cos(el), se = Math.sin(el);
    // camera looks along −f, f = (ce·ca, ce·sa, se); screen right u, screen up w
    return p => {
      const x = p[0] - this.c[0], y = p[1] - this.c[1], z = p[2] - this.c[2];
      const u = -sa * x + ca * y, w = -se * (ca * x + sa * y) + ce * z, d = ce * (ca * x + sa * y) + se * z;
      return [this.cx + this.k * u, this.cy - this.k * w, d];
    };
  }

  draw() {
    const d = this.data; if (!d || !d.sol) return;
    const dpr = Math.min(devicePixelRatio || 1, 2), W = this.el.clientWidth, H = this.el.clientHeight;
    if (!W || !H) return;
    if (this.cv.width !== Math.round(W * dpr) || this.cv.height !== Math.round(H * dpr)) { this.cv.width = Math.round(W * dpr); this.cv.height = Math.round(H * dpr); }
    const g = this.g; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const sol = d.sol, L = sol.L, P = L.P, b = P.b;
    const bg = hexRgb(css('--bg-elev') || '#ffffff'), text2 = css('--text-2'), text3 = css('--text-3'), border = css('--border'), accent = css('--accent');
    const wakeLen = d.wake ? Math.min(d.wakeLen || 1.3 * b, d.wake[d.wake.length - 1].x) : 0;
    // fit the wing (and some wake) in view
    const xmax = Math.max(...L.st.map(s => s.x + s.c)), zmax = Math.max(...L.st.map(s => s.z)), zmin = Math.min(0, ...L.st.map(s => s.z));
    this.c = [(xmax + (this.layers.wake && d.wake ? wakeLen * 0.3 : 0)) / 2, 0, (zmax + zmin) / 2];
    this.k = Math.min(W / (b * 1.32), H / (Math.max(b * 0.55, xmax + wakeLen * 0.3) * 1.3)) * this.cam.zoom;
    this.cx = W / 2; this.cy = H / 2;
    const pr = this.proj();
    const line = (pts, color, width = 1, dash = null, alpha = 1) => {
      g.beginPath(); pts.forEach((p, i) => { const q = pr(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); });
      g.strokeStyle = color; g.lineWidth = width; g.globalAlpha = alpha; g.setLineDash(dash || []); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
    };
    const items = [];   // painter's algorithm: [depth, draw()]

    // ground (or a faint reference grid below the wing)
    if (this.layers.ground) {
      const zg = d.ground !== null && d.ground !== undefined ? -d.ground : zmin - 0.25 * b;
      const x0 = -0.5 * b, x1 = xmax + (this.layers.wake && d.wake ? wakeLen : 0.6 * b), y0 = -0.75 * b, y1 = 0.75 * b, n = 10;
      const isG = d.ground !== null && d.ground !== undefined;
      g.globalAlpha = isG ? 0.55 : 0.28;
      for (let i = 0; i <= n; i++) { const x = x0 + (x1 - x0) * i / n; line([[x, y0, zg], [x, y1, zg]], border, 1); const y = y0 + (y1 - y0) * i / n; line([[x0, y, zg], [x1, y, zg]], border, 1); }
      g.globalAlpha = 1;
      if (isG) { const q = pr([x0, y1, zg]); g.fillStyle = text3; g.font = '11px ' + css('--font'); g.fillText('ground', q[0] + 4, q[1] - 4); }
    }

    // panels
    const scale = d.scale || Math.max(0.5, ...Array.from(sol.dcp).map(Math.abs));
    for (let i = 0; i < L.pan.length; i++) {
      const p = L.pan[i], cs = p.corners.map(pr);
      const dep = cs.reduce((a, c) => a + c[2], 0) / 4;
      const v = sol.dcp[i] / scale;
      const col = this.layers.pressure ? divergingJS(-Math.max(-1, Math.min(1, v)), bg) : [bg[0] * 0.9 + 20, bg[1] * 0.9 + 20, bg[2] * 0.9 + 20];
      items.push([dep, () => {
        g.beginPath(); cs.forEach((c, k) => k ? g.lineTo(c[0], c[1]) : g.moveTo(c[0], c[1])); g.closePath();
        g.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`; g.fill();
        g.strokeStyle = border; g.globalAlpha = 0.5; g.lineWidth = 0.6; g.stroke(); g.globalAlpha = 1;
      }]);
    }
    // outline
    items.push([1e9, () => {
      const le = L.st.map(s => [s.x, s.y, s.z]), te = L.st.map(s => [s.x + s.c, s.y, s.z]).reverse();
      line([...le, ...te, le[0]], text2, 1.3);
    }]);

    // lift arrows: along each strip's normal, length ∝ c·cl
    if (this.layers.arrows) {
      const ss = sol.strips, mx = Math.max(1e-9, ...ss.map(s => Math.abs(s.ccl)));
      const every = Math.max(1, Math.round(ss.length / 28));
      ss.forEach((s, k) => {
        if (k % every) return;
        const st = L.strips[k], base = [st.x + st.c * 0.25, st.y, st.z];
        const n = st.n0, Lh = 0.28 * b * s.ccl / mx;
        const tip = [base[0], base[1] + n[1] * Lh, base[2] + n[2] * Lh];
        items.push([1e9 + 1, () => {
          const a = pr(base), c = pr(tip);
          g.strokeStyle = accent; g.fillStyle = accent; g.lineWidth = 1.4;
          g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(c[0], c[1]); g.stroke();
          const ang = Math.atan2(c[1] - a[1], c[0] - a[0]), hl = Math.min(7, Math.hypot(c[0] - a[0], c[1] - a[1]) * 0.5);
          if (hl > 1.5) { g.beginPath(); g.moveTo(c[0], c[1]); g.lineTo(c[0] - hl * Math.cos(ang - 0.4), c[1] - hl * Math.sin(ang - 0.4)); g.lineTo(c[0] - hl * Math.cos(ang + 0.4), c[1] - hl * Math.sin(ang + 0.4)); g.closePath(); g.fill(); }
        }]);
      });
      // lift envelope through the arrow tips
      items.push([1e9 + 2, () => {
        const pts = ss.map((s, k) => { const st = L.strips[k], Lh = 0.28 * b * s.ccl / mx; return [st.x + st.c * 0.25, st.y + st.n0[1] * Lh, st.z + st.n0[2] * Lh]; });
        line(pts, accent, 1.2, [4, 3], 0.8);
      }]);
    }

    // trailing wake: each shed point traced through the roll-up frames, starting at the trailing edge
    if (this.layers.wake && d.wake) {
      const fr = d.wake.filter(f => f.x <= wakeLen + 1e-9), n = fr[0].y.length;
      const xTE = L.st.map(s => s.x + s.c), kap = sol.kap, km = Math.max(1e-12, ...Array.from(kap).map(Math.abs));
      const wc = css('--turb');
      // about a dozen threads evenly across the span, plus the two tips
      const pick = new Set([0, n - 1]), y0 = fr[0].y;
      for (let k = 0; k <= 12; k++) { const yt = -P.s + 2 * P.s * k / 12; let best = 0; for (let i = 1; i < n; i++) if (Math.abs(y0[i] - yt) < Math.abs(y0[best] - yt)) best = i; pick.add(best); }
      for (const i of pick) {
        const strong = Math.abs(kap[i]) / km, tipLine = i === 0 || i === n - 1;
        const pts = fr.map(f => [xTE[i] + f.x, f.y[i], f.z[i]]);
        const w = tipLine ? 2.6 : 0.8 + 1.4 * strong, al = tipLine ? 0.95 : 0.3 + 0.5 * strong;
        items.push([1e9 - 1, () => {
          if (this.animate) { g.lineDashOffset = -this.t * 40; line(pts, wc, w, [6, 7], al); g.lineDashOffset = 0; } else line(pts, wc, w, null, al);
        }]);
      }
    }

    // tufts: short threads on the upper surface; stalled strips show them flipped and red
    if (this.layers.tufts && d.strips) {
      const ok = css('--good'), bad = css('--bad');
      d.strips.forEach((s, k) => {
        const st = L.strips.find(x => Math.abs(x.y - s.y) < 1e-9 && Math.abs(x.z - s.z) < 1e-9) || L.strips[k];
        if (!st) return;
        for (const f of [0.25, 0.62]) {
          const p0 = [st.x + st.c * f, st.y, st.z + 0.002 * b], l = Math.max(st.c * 0.32, 0.018 * b);
          const wig = s.stalled ? Math.sin(this.t * 9 + k * 1.7 + f * 5) : 0;
          const p1 = s.stalled ? [p0[0] - l * 0.6, p0[1] + l * 0.6 * wig, p0[2] + l * 0.35] : [p0[0] + l, p0[1], p0[2]];
          items.push([1e9 + 3, () => line([p0, p1], s.stalled ? bad : ok, 2.4)]);
        }
      });
    }

    // tail marker
    if (d.tail) {
      items.push([1e9 + 4, () => {
        const q = pr(d.tail); g.fillStyle = css('--lower'); g.beginPath(); g.arc(q[0], q[1], 4.5, 0, 2 * Math.PI); g.fill();
        g.font = '11px ' + css('--font'); g.fillText('tail', q[0] + 7, q[1] + 4);
        const sp = 0.18 * b; line([[d.tail[0], d.tail[1] - sp, d.tail[2]], [d.tail[0], d.tail[1] + sp, d.tail[2]]], css('--lower'), 1.5, [3, 3]);
      }]);
    }

    items.sort((a, c) => a[0] - c[0]);
    for (const [, f] of items) f();

    // axes hint
    const ax = [[0, 0, 0], [0.12 * b, 0, 0]], q0 = pr(ax[0]);
    g.globalAlpha = 0.7; g.fillStyle = text3; g.font = '10px ' + css('--font');
    const qx = pr(ax[1]); g.fillText('→ flow', Math.min(W - 50, Math.max(4, qx[0] + 4)), Math.min(H - 6, Math.max(12, qx[1])));
    g.globalAlpha = 1; void q0;

    // legend
    if (this.layers.pressure) {
      const stops = []; for (let k = 0; k <= 10; k++) { const t = -1 + 2 * k / 10, c = divergingJS(-t, bg); stops.push(`rgb(${c}) ${k * 10}%`); }
      this.legend.innerHTML = `<div style="display:flex;align-items:center;gap:8px"><span>ΔCp</span><span style="display:inline-block;width:120px;height:9px;border-radius:3px;background:linear-gradient(90deg,${stops.join(',')})"></span><span>−${scale.toFixed(1)} … +${scale.toFixed(1)}</span></div><div style="margin-top:3px">blue: lifting (lower minus upper pressure)</div>`;
      this.legend.style.display = '';
    } else this.legend.style.display = 'none';
  }
}
