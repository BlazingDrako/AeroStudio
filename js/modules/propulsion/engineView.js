// Animated engine cut-away: flow path colored by total temperature, blade rows, flames, shocks,
// moving gas parcels and hoverable station markers.
import { h, cssVar } from '../../lib/ui.js';
import { heat, rgb, kPa } from './common.js';

// duct key points: [x, hub, casing]; comps: rotating rows, burners, etc.
function geometry(P) {
  const T = P.type;
  if (T === 'turbojet') {
    const ab = P.ab, end = ab ? 1.0 : 0.9, cd = P.nozzle === 'cd';
    const core = [[0.0, 0, 0.6], [0.05, 0.1, 0.6], [0.12, 0.2, 0.58], [0.40, 0.36, 0.46], [0.43, 0.3, 0.55], [0.56, 0.26, 0.55], [0.57, 0.32, 0.5], [0.68, 0.3, 0.56], [0.78, 0, 0.56]];
    if (ab) core.push([0.88, 0, 0.56]);
    const ns = ab ? 0.88 : 0.78;
    if (cd) core.push([ns + (end - ns) * 0.6, 0, 0.38], [end, 0, 0.46]); else core.push([end, 0, 0.4]);
    return {
      ducts: [{ id: 'core', pts: core, st: [['0', 0], ['2', 0.12], ['3', 0.4], ['4', 0.56], ['5', 0.68], ...(ab ? [['7', 0.88]] : []), ['9', end]] }],
      comps: [{ k: 'comp', x0: 0.13, x1: 0.39, rows: 9 }, { k: 'burn', x0: 0.45, x1: 0.55 }, { k: 'turb', x0: 0.575, x1: 0.67, rows: 3 }, ...(ab ? [{ k: 'ab', x0: 0.8, x1: 0.88 }] : [])],
      st: { '2': 0.12, '3': 0.4, '4': 0.56, '5': 0.68, '7': 0.88, '9': end }, rmax: 0.7,
    };
  }
  if (T === 'turbofan') {
    const mixed = P.mixed, ab = P.ab && mixed, cd = P.nozzle === 'cd';
    const inlet = [[0.0, 0, 0.93], [0.06, 0.14, 0.93], [0.09, 0.2, 0.93], [0.16, 0.22, 0.93]];
    let core = [[0.16, 0.2, 0.42], [0.40, 0.26, 0.31], [0.42, 0.2, 0.36], [0.52, 0.2, 0.36], [0.53, 0.25, 0.34], [0.60, 0.24, 0.36], [0.74, 0.2, 0.46], [0.84, 0, 0.46]];
    const st = [['0', 0], ['2', 0.09], ['13', 0.16], ['3', 0.40], ['4', 0.52], ['45', 0.60], ['5', 0.74]];
    let byp, end;
    if (!mixed) {
      byp = [[0.16, 0.45, 0.93], [0.40, 0.42, 0.9], [0.62, 0.4, 0.72]];
      end = 0.9; core = core.slice(0, -1).concat([[0.84, 0, 0.46], [end, 0, cd ? 0.4 : 0.38]]);
      st.push(['9', end]);
      return { ducts: [{ id: 'inlet', pts: inlet, st: [['0', 0], ['2', 0.09], ['13', 0.16]] }, { id: 'core', pts: core, st: st.slice(2) }, { id: 'bypass', pts: byp, st: [['13', 0.16], ['19', 0.62]] }],
        comps: [{ k: 'fan', x0: 0.10, x1: 0.13, rows: 1, duct: 'inlet' }, { k: 'comp', x0: 0.17, x1: 0.39, rows: 9 }, { k: 'burn', x0: 0.43, x1: 0.51 }, { k: 'turb', x0: 0.53, x1: 0.59, rows: 2 }, { k: 'turb', x0: 0.61, x1: 0.73, rows: 4 }],
        st: { '2': 0.09, '13': 0.16, '3': 0.4, '4': 0.52, '45': 0.6, '5': 0.74, '9': end, '19': 0.62 }, rmax: 1, nacelle: [[0.0, 0.95], [0.16, 0.95], [0.45, 0.91], [0.62, 0.74]] };
    }
    end = 1.0;
    byp = [[0.16, 0.45, 0.93], [0.40, 0.42, 0.9], [0.74, 0.47, 0.78]];
    core = core.slice(0, 6).concat([[0.74, 0.2, 0.46], [0.78, 0.14, 0.76], [0.86, 0, 0.72]]);
    if (ab) core.push([0.93, 0, 0.7]);
    if (cd) core.push([ab ? 0.96 : 0.94, 0, 0.5], [end, 0, 0.58]); else core.push([end, 0, 0.52]);
    st.push(['6A', 0.80]); if (ab) st.push(['7', 0.93]); st.push(['9', end]);
    return { ducts: [{ id: 'inlet', pts: inlet, st: [['0', 0], ['2', 0.09], ['13', 0.16]] }, { id: 'core', pts: core, st: st.slice(2) }, { id: 'bypass', pts: byp, st: [['13', 0.16], ['13', 0.74]] }],
      comps: [{ k: 'fan', x0: 0.10, x1: 0.13, rows: 1, duct: 'inlet' }, { k: 'comp', x0: 0.17, x1: 0.39, rows: 9 }, { k: 'burn', x0: 0.43, x1: 0.51 }, { k: 'turb', x0: 0.53, x1: 0.59, rows: 2 }, { k: 'turb', x0: 0.61, x1: 0.73, rows: 4 }, ...(ab ? [{ k: 'ab', x0: 0.86, x1: 0.93 }] : [])],
      st: { '2': 0.09, '13': 0.16, '3': 0.4, '4': 0.52, '45': 0.6, '5': 0.74, '6A': 0.8, '7': 0.93, '9': end }, rmax: 1, nacelle: [[0.0, 0.95], [0.16, 0.95], [0.45, 0.91], [0.78, 0.8], [end, cd ? 0.62 : 0.56]] };
  }
  if (T === 'turboprop') {
    const core = [[0.10, 0.1, 0.3], [0.14, 0.13, 0.3], [0.38, 0.2, 0.24], [0.40, 0.12, 0.3], [0.52, 0.12, 0.3], [0.53, 0.16, 0.26], [0.72, 0.15, 0.34], [0.80, 0.0, 0.35], [0.86, 0, 0.36]];
    return { ducts: [{ id: 'core', pts: core, st: [['0', 0.1], ['2', 0.14], ['3', 0.38], ['4', 0.52], ['45', 0.62], ['5', 0.72], ['9', 0.86]] }],
      comps: [{ k: 'prop', x0: 0.04, x1: 0.05 }, { k: 'comp', x0: 0.15, x1: 0.37, rows: 6 }, { k: 'burn', x0: 0.41, x1: 0.51 }, { k: 'turb', x0: 0.53, x1: 0.61, rows: 2 }, { k: 'turb', x0: 0.63, x1: 0.71, rows: 2 }],
      st: { '2': 0.14, '3': 0.38, '4': 0.52, '45': 0.62, '5': 0.72, '9': 0.86 }, rmax: 1.05 };
  }
  if (T === 'ramjet') {
    const cd = P.nozzle !== 'conv';
    const core = [[0.14, 0.17, 0.5], [0.28, 0.32, 0.55], [0.40, 0.0, 0.58], [0.76, 0, 0.6], cd ? [0.87, 0, 0.36] : [1.0, 0, 0.4], ...(cd ? [[1.0, 0, 0.52]] : [])];
    return { ducts: [{ id: 'core', pts: core, st: [['0', 0.14], ['2', 0.40], ['4', 0.76], ['9', 1.0]] }],
      comps: [{ k: 'spike', x0: 0, x1: 0.4 }, { k: 'holder', x0: 0.44, x1: 0.45 }, { k: 'burn', x0: 0.46, x1: 0.74 }],
      shocks: [[[0, 0], [0.14, 0.5]], [[0.08, 0.095], [0.14, 0.5]], [[0.31, 0.29], [0.31, 0.555]]],
      st: { '2': 0.4, '4': 0.76, '9': 1.0 }, rmax: 0.7 };
  }
  // scramjet
  const core = [[0.30, 0.3, 0.45], [0.40, 0.3, 0.45], [0.68, 0.3, 0.52], [1.0, 0.08, 0.82]];
  return { ducts: [{ id: 'core', pts: core, st: [['3', 0.3], ['3', 0.40], ['4', 0.68], ['10', 1.0]] }],
    comps: [{ k: 'spike2', x0: 0, x1: 0.3 }, { k: 'inject', x0: 0.42, x1: 0.43 }, { k: 'burn', x0: 0.43, x1: 0.66, thin: true }],
    shocks: [[[0, 0], [0.3, 0.45]], [[0.15, 0.13], [0.3, 0.45]], [[0.3, 0.45], [0.36, 0.3]], [[0.36, 0.3], [0.42, 0.45]]],
    st: { '3': 0.4, '4': 0.68, '10': 1.0 }, rmax: 0.9 };
}

const interp = (pts, x, k) => {
  if (x <= pts[0][0]) return pts[0][k];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const a = pts[i - 1], b = pts[i], t = (x - a[0]) / (b[0] - a[0] || 1); return a[k] + t * (b[k] - a[k]); }
  return pts[pts.length - 1][k];
};

export class EngineView {
  constructor() {
    this.el = h('div', { class: 'stage cf-stage eng-stage' });
    this.cv = h('canvas'); this.el.append(this.cv);
    this.tip = h('div', { class: 'readout' }); this.el.append(this.tip);
    this.legend = h('div', { class: 'legend' }); this.el.append(this.legend);
    this.g = this.cv.getContext('2d');
    this.t = 0; this.parts = []; this.running = false; this.hover = null;
    new ResizeObserver(() => this.draw()).observe(this.el);
    this.cv.addEventListener('mousemove', e => { const r = this.cv.getBoundingClientRect(); this.mouse = [e.clientX - r.left, e.clientY - r.top]; this.pick(); });
    this.cv.addEventListener('mouseleave', () => { this.mouse = null; this.hover = null; this.tip.style.display = 'none'; });
    addEventListener('themechange', () => this.draw());
  }
  set(res, P) {
    this.res = res; this.P = P; this.geo = geometry(P);
    const byId = {}; for (const s of res.S) byId[s.id] = s;
    this.byId = byId;
    let lo = Infinity, hi = -Infinity; for (const s of res.S) { lo = Math.min(lo, s.Tt); hi = Math.max(hi, s.Tt); }
    this.Tlo = Math.min(lo, res.T0); this.Thi = Math.max(hi, this.Tlo + 50);
    if (this.parts.length === 0 || this.partType !== P.type + P.mixed) this.seed();
    this.legend.innerHTML = `Total temperature<canvas width="180" height="10"></canvas><div class="ticks"><span>${this.Tlo.toFixed(0)} K</span><span>${((this.Tlo + this.Thi) / 2).toFixed(0)}</span><span>${this.Thi.toFixed(0)} K</span></div>`;
    const lc = this.legend.querySelector('canvas').getContext('2d');
    for (let i = 0; i < 180; i++) { lc.fillStyle = rgb(heat(i / 179)); lc.fillRect(i, 0, 1, 10); }
    this.draw();
  }
  seed() {
    this.partType = this.P.type + this.P.mixed; this.parts = [];
    for (const d of this.geo.ducts) {
      const n = d.id === 'bypass' ? 70 : d.id === 'inlet' ? 30 : 120;
      const x0 = d.pts[0][0], x1 = d.pts[d.pts.length - 1][0];
      for (let i = 0; i < n; i++) this.parts.push({ d, x: x0 + Math.random() * (x1 - x0), f: 0.08 + Math.random() * 0.84, side: Math.random() < 0.5 ? 1 : -1 });
    }
  }
  start() { if (this.running) return; this.running = true; let last = performance.now(); const loop = now => { if (!this.running) return; const dt = Math.min(0.05, (now - last) / 1000); last = now; this.step(dt); this.draw(); this.raf = requestAnimationFrame(loop); }; this.raf = requestAnimationFrame(loop); }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }
  TtAt(d, x) {
    const st = d.st.filter(([id]) => this.byId[id]);
    if (!st.length) return this.res.T0;
    if (x <= st[0][1]) return this.byId[st[0][0]].Tt;
    for (let i = 1; i < st.length; i++) if (x <= st[i][1]) {
      const a = this.byId[st[i - 1][0]], b = this.byId[st[i][0]], t = (x - st[i - 1][1]) / (st[i][1] - st[i - 1][1] || 1);
      // heat release spreads over the burner; compression ramps
      return a.Tt + (b.Tt - a.Tt) * (b.comb ? Math.sin(t * Math.PI / 2) : t);
    }
    return this.byId[st[st.length - 1][0]].Tt;
  }
  step(dt) {
    this.t += dt;
    for (const p of this.parts) {
      const T = this.TtAt(p.d, p.x), w = interp(p.d.pts, p.x, 2) - interp(p.d.pts, p.x, 1);
      const v = 0.05 * Math.sqrt(T / this.res.T0) * Math.min(2.5, 0.25 / Math.max(0.08, w));
      p.x += v * dt;
      const x1 = p.d.pts[p.d.pts.length - 1][0];
      if (p.x > x1 + 0.03) { p.x = p.d.pts[0][0]; p.f = 0.08 + Math.random() * 0.84; }
    }
  }
  frame() {
    const W = this.el.clientWidth, H = this.el.clientHeight, pad = 28;
    const rmax = this.geo.rmax * 1.08;
    const sx = x => pad + (x + 0.03) / 1.09 * (W - 2 * pad);
    const sc = Math.min((H / 2 - 24) / rmax, (W - 2 * pad) / 1.09 * 0.55);
    const cy = H / 2 + 6;
    return { W, H, sx, sy: (r, side) => cy - side * r * sc, cy, sc };
  }
  draw() {
    if (!this.res) return;
    const c = this.cv, dpr = Math.min(devicePixelRatio || 1, 2), W = this.el.clientWidth, H = this.el.clientHeight;
    if (!W || !H) return;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const g = this.g; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const F = this.frame(), { sx, sy } = F, geo = this.geo, t = this.t;
    const wall = cssVar('--text-2'), metal = cssVar('--border-strong'), txt = cssVar('--text-3');
    const norm = T => (T - this.Tlo) / (this.Thi - this.Tlo);
    // centerline
    g.strokeStyle = metal; g.setLineDash([6, 5]); g.lineWidth = 1; g.beginPath(); g.moveTo(sx(-0.03), F.cy); g.lineTo(sx(1.06), F.cy); g.stroke(); g.setLineDash([]);
    // freestream arrows
    g.strokeStyle = txt; g.fillStyle = txt; g.lineWidth = 1.2;
    for (const r of [0.25, 0.6]) for (const side of [1, -1]) { const y = sy(r * geo.rmax, side), x0 = sx(-0.03), x1 = sx(-0.03) + 20; g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); g.beginPath(); g.moveTo(x1 + 5, y); g.lineTo(x1, y - 3); g.lineTo(x1, y + 3); g.fill(); }
    // duct fills by temperature
    for (const d of geo.ducts) {
      const x0 = d.pts[0][0], x1 = d.pts[d.pts.length - 1][0], n = Math.max(20, Math.round((x1 - x0) * 160));
      for (const side of [1, -1]) for (let i = 0; i < n; i++) {
        const a = x0 + (x1 - x0) * i / n, b = x0 + (x1 - x0) * (i + 1) / n, m = (a + b) / 2;
        g.fillStyle = rgb(heat(norm(this.TtAt(d, m)))); g.globalAlpha = 0.85;
        g.beginPath(); g.moveTo(sx(a), sy(interp(d.pts, a, 1), side)); g.lineTo(sx(b) + 0.6, sy(interp(d.pts, b, 1), side)); g.lineTo(sx(b) + 0.6, sy(interp(d.pts, b, 2), side)); g.lineTo(sx(a), sy(interp(d.pts, a, 2), side)); g.fill();
      }
      g.globalAlpha = 1;
    }
    // components
    for (const cp of geo.comps) {
      const d = geo.ducts.find(q => q.id === (cp.duct || 'core'));
      if (cp.k === 'comp' || cp.k === 'turb' || cp.k === 'fan') {
        const rows = cp.rows, col = cp.k === 'turb' ? '#c8a26a' : cssVar('--text-2');
        for (let i = 0; i < rows; i++) {
          const x = rows === 1 ? (cp.x0 + cp.x1) / 2 : cp.x0 + (cp.x1 - cp.x0) * i / (rows - 1);
          const hub = interp(d.pts, x, 1), cas = interp(d.pts, x, 2);
          const wpx = Math.max(2, (sx(cp.x1) - sx(cp.x0)) / Math.max(rows, 1) * (cp.k === 'fan' ? 0.9 : 0.45));
          for (const side of [1, -1]) {
            g.fillStyle = col; g.globalAlpha = i % 2 ? 0.55 : 0.85;
            const y0 = sy(hub, side), y1 = sy(cas, side);
            g.fillRect(sx(x) - wpx / 2, Math.min(y0, y1), wpx, Math.abs(y1 - y0));
            // rotation shimmer on rotor rows
            if (i % 2 === 0 || cp.k === 'fan') {
              g.globalAlpha = 0.5; g.fillStyle = cssVar('--bg-elev');
              const ph = ((t * (cp.k === 'fan' ? 1.2 : 2.4) + i * 0.17) % 1);
              const yy = sy(hub + (cas - hub) * ph, side);
              g.fillRect(sx(x) - wpx / 2, yy - 1.5, wpx, 3);
            }
          }
        }
        g.globalAlpha = 1;
      } else if (cp.k === 'burn' || cp.k === 'ab') {
        for (const side of [1, -1]) {
          const xm = (cp.x0 + cp.x1) / 2, hub = interp(d.pts, xm, 1), cas = interp(d.pts, xm, 2), rm = (hub + cas) / 2;
          const n = cp.k === 'ab' ? 4 : 3;
          for (let k = 0; k < n; k++) {
            const fl = 0.85 + 0.15 * Math.sin(t * 9 + k * 2.1 + side);
            const r = cp.k === 'ab' ? (k + 0.5) / n * cas : rm + (k - 1) * (cas - hub) * 0.18 * (cp.thin ? 0.5 : 1);
            const gx = sx(cp.x0), len = (sx(cp.x1) - sx(cp.x0)) * fl, y = sy(r, side);
            const grd = g.createLinearGradient(gx, y, gx + len, y);
            grd.addColorStop(0, 'rgba(120,180,255,0.9)'); grd.addColorStop(0.3, 'rgba(255,200,80,0.85)'); grd.addColorStop(1, 'rgba(255,90,20,0)');
            g.fillStyle = grd; g.beginPath(); g.ellipse(gx + len / 2, y, len / 2, Math.max(2, (cas - hub) * F.sc * 0.12), 0, 0, 2 * Math.PI); g.fill();
          }
          if (cp.k === 'burn' && this.P.type !== 'ramjet' && this.P.type !== 'scramjet') {
            g.strokeStyle = wall; g.lineWidth = 1.4; g.beginPath();
            g.moveTo(sx(cp.x0 - 0.01), sy(rm - (cas - hub) * 0.32, side)); g.lineTo(sx(cp.x1), sy(rm - (cas - hub) * 0.32, side));
            g.moveTo(sx(cp.x0 - 0.01), sy(rm + (cas - hub) * 0.32, side)); g.lineTo(sx(cp.x1), sy(rm + (cas - hub) * 0.32, side)); g.stroke();
          }
        }
      } else if (cp.k === 'prop') {
        const x = sx(0.045), ph = t * 5;
        for (const k of [0, 1, 2, 3]) {
          const ang = ph + k * Math.PI / 2, len = Math.cos(ang) * 1.0;
          g.fillStyle = cssVar('--text-2'); g.globalAlpha = 0.35 + 0.5 * Math.abs(Math.sin(ang));
          g.beginPath(); g.ellipse(x, F.cy - len * F.sc / 2, 5 + 3 * Math.abs(Math.sin(ang)), Math.abs(len) * F.sc / 2, 0, 0, 2 * Math.PI); g.fill();
        }
        g.globalAlpha = 1;
        // spinner
        g.fillStyle = metal; g.beginPath(); g.moveTo(sx(0.0), F.cy); g.quadraticCurveTo(sx(0.03), sy(0.14, 1), sx(0.1), sy(0.12, 1)); g.lineTo(sx(0.1), sy(0.12, -1)); g.quadraticCurveTo(sx(0.03), sy(0.14, -1), sx(0.0), F.cy); g.fill();
      } else if (cp.k === 'holder') {
        g.strokeStyle = wall; g.lineWidth = 1.5;
        for (const side of [1, -1]) for (const r of [0.15, 0.32, 0.48]) { const x = sx(cp.x0), y = sy(r, side); g.beginPath(); g.moveTo(x + 6, y - 5); g.lineTo(x, y); g.lineTo(x + 6, y + 5); g.stroke(); }
      } else if (cp.k === 'inject') {
        g.fillStyle = wall;
        for (const side of [1, -1]) { const x = sx(cp.x0); g.fillRect(x - 1.5, sy(0.45, side), 3, (side > 0 ? 1 : -1) * 0.05 * F.sc); }
      }
    }
    // walls
    g.strokeStyle = wall; g.lineWidth = 2;
    for (const d of geo.ducts) for (const side of [1, -1]) for (const k of [1, 2]) {
      if (d.id === 'inlet' && k === 1) continue;
      g.beginPath(); d.pts.forEach((p, i) => { const X = sx(p[0]), Y = sy(p[k], side); i ? g.lineTo(X, Y) : g.moveTo(X, Y); }); g.stroke();
    }
    if (geo.nacelle) { g.lineWidth = 2.5; for (const side of [1, -1]) { g.beginPath(); geo.nacelle.forEach((p, i) => { const X = sx(p[0]), Y = sy(p[1], side); i ? g.lineTo(X, Y) : g.moveTo(X, Y); }); g.stroke(); } }
    // spikes
    if (geo.comps.some(c => c.k === 'spike' || c.k === 'spike2')) {
      const pts = this.P.type === 'ramjet' ? [[0, 0], [0.28, 0.32], [0.40, 0]] : [[0, 0], [0.15, 0.13], [0.30, 0.3], [1.0, 0.08]];
      g.fillStyle = metal;
      for (const side of [1, -1]) { g.beginPath(); g.moveTo(sx(0), F.cy); for (const p of pts) g.lineTo(sx(p[0]), sy(p[1], side)); g.lineTo(sx(pts[pts.length - 1][0]), F.cy); g.closePath(); g.fill(); }
    }
    // shocks
    if (geo.shocks) {
      g.strokeStyle = cssVar('--bad'); g.lineWidth = 1.6;
      for (const side of [1, -1]) for (const [a, b] of geo.shocks) { g.beginPath(); g.moveTo(sx(a[0]), sy(a[1], side)); g.lineTo(sx(b[0]), sy(b[1], side)); g.stroke(); }
    }
    // particles
    g.fillStyle = cssVar('--text'); g.globalAlpha = 0.55;
    for (const p of this.parts) {
      const hub = interp(p.d.pts, p.x, 1), cas = interp(p.d.pts, p.x, 2), r = hub + p.f * (cas - hub);
      if (p.x > p.d.pts[p.d.pts.length - 1][0]) continue;
      g.fillRect(sx(p.x) - 1, sy(r, p.side) - 1, 2, 2);
    }
    g.globalAlpha = 1;
    // stations
    g.font = '10.5px ' + cssVar('--font'); g.textAlign = 'center'; g.textBaseline = 'middle';
    this.stX = [];
    for (const [id, x] of Object.entries(geo.st)) {
      if (!this.byId[id]) continue;
      const low = id === '19', X = sx(x), Y = low ? F.H - 14 : 14;
      g.strokeStyle = cssVar('--text-3'); g.setLineDash([2, 3]); g.lineWidth = 1; g.beginPath(); g.moveTo(X, low ? 30 : Y + 8); g.lineTo(X, low ? Y - 8 : F.H - 30); g.stroke(); g.setLineDash([]);
      const on = this.hover === id;
      g.fillStyle = on ? cssVar('--accent') : cssVar('--bg-elev'); g.strokeStyle = cssVar('--accent'); g.lineWidth = 1.3;
      g.beginPath(); g.arc(X, Y, 9, 0, 2 * Math.PI); g.fill(); g.stroke();
      g.fillStyle = on ? '#fff' : cssVar('--accent'); g.fillText(id, X, Y + 0.5);
      this.stX.push([id, X]);
    }
  }
  pick() {
    if (!this.mouse || !this.stX) return;
    let best = null, bd = 26;
    for (const [id, X] of this.stX) { const d = Math.abs(X - this.mouse[0]); if (d < bd) { bd = d; best = id; } }
    this.hover = best;
    if (!best) { this.tip.style.display = 'none'; return; }
    const s = this.byId[best];
    this.tip.innerHTML = `<b>${best}</b> ${s.name}<br>Tt ${s.Tt.toFixed(1)} K · pt ${kPa(s.pt)} kPa` + (s.M !== undefined ? `<br>M ${s.M.toFixed(3)} · V ${s.V.toFixed(0)} m/s` : '') + (s.note ? `<br>${s.note}` : '');
    this.tip.style.display = 'block';
    const tw = this.tip.offsetWidth;
    this.tip.style.left = Math.min(this.mouse[0] + 14, this.el.clientWidth - tw - 6) + 'px';
    this.tip.style.top = Math.max(30, this.mouse[1] - 20) + 'px';
    if (!this.running) this.draw();
  }
}
