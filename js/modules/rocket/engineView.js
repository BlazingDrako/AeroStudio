// Rocket engine cut-away: chamber and nozzle drawn to scale, the gas colored by temperature, Mach number,
// pressure or wall heat flux, and the exhaust plume for the current ambient pressure (expansion fans or lip
// shocks, shock cells / Mach diamonds, Mach disk, separation inside the nozzle). Hover for local values.
import { h, cssVar, canvasTag } from '../../lib/ui.js';
import * as R from '../../solvers/rocket.js';
import { heat, rgb } from './common.js';

const MODES = {
  T: { label: 'Temperature', unit: 'K', get: p => p.T, fmt: v => v.toFixed(0) + ' K' },
  M: { label: 'Mach number', unit: '', get: p => p.M, fmt: v => v.toFixed(2) },
  p: { label: 'Pressure (log)', unit: 'bar', get: p => Math.log10(p.P), fmt: v => (10 ** v / 1e5).toPrecision(3) + ' bar' },
  q: { label: 'Wall heat flux', unit: 'MW/m²', get: (p, i, B) => B ? B.pts[i].q / 1e6 : 0, fmt: v => v.toFixed(1) + ' MW/m²' },
};
// flame tint by fuel: hydrogen burns almost invisibly pale blue, methane blue-violet, kerosene and others orange
const flameColor = fuel => fuel === 'H2(L)' ? [150, 185, 255] : fuel === 'CH4(L)' ? [140, 140, 255] : fuel === 'RP-1' || fuel === 'Jet-A(L)' ? [255, 150, 55] : [255, 175, 110];

export class EngineView {
  constructor({ height } = {}) {
    this.el = h('div', { class: 'stage cf-stage eng-stage rk-stage' });
    if (height) this.el.style.height = height;
    this.cv = h('canvas'); this.el.append(this.cv);
    this.tip = h('div', { class: 'readout' }); this.el.append(this.tip);
    this.legend = h('div', { class: 'legend' }); this.el.append(this.legend);
    this.g = this.cv.getContext('2d');
    this.mode = 'T'; this.t = 0; this.D = null; this.pa = 0; this.B = null; this.plumeOn = true; this.visible = false;
    this.reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    new ResizeObserver(() => this.draw()).observe(this.el);
    addEventListener('themechange', () => this.draw());
    this.io = new IntersectionObserver(es => { this.visible = es.some(e => e.isIntersecting); if (this.visible) this.loop(); });
    this.io.observe(this.el);
    this.cv.addEventListener('mousemove', e => this.hover(e));
    this.cv.addEventListener('mouseleave', () => { this.tip.style.display = 'none'; this.hx = null; this.draw(); });
  }
  set({ D, pa, mode, B, plume, coolX } = {}) {
    if (coolX !== undefined) this.coolX = coolX;
    if (D !== undefined) this.D = D;
    if (pa !== undefined) this.pa = pa;
    if (mode !== undefined) this.mode = mode;
    if (B !== undefined) this.B = B;
    if (plume !== undefined) this.plumeOn = plume;
    this.P = this.D && this.plumeOn ? R.plume(this.D, this.pa) : null;
    this.paintLegend();
    this.draw();
  }
  loop() {
    if (this.raf || this.reduce) return;
    const step = ts => {
      this.raf = null;
      if (!this.visible || document.hidden || !this.el.isConnected) return;
      this.t = ts / 1000; this.draw();
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }
  destroy() { this.io.disconnect(); if (this.raf) cancelAnimationFrame(this.raf); }

  range() {
    const D = this.D, m = MODES[this.mode];
    const vals = D.along.map((p, i) => m.get(p, i, this.B)).filter(isFinite);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (this.mode === 'T') lo = Math.min(lo, 300);
    if (this.mode === 'q') lo = 0;
    if (hi - lo < 1e-9) hi = lo + 1;
    return [lo, hi];
  }
  paintLegend() {
    if (!this.D) { this.legend.replaceChildren(); return; }
    const [lo, hi] = this.range(), m = MODES[this.mode];
    const bar = h('canvas', { width: 180, height: 10 }), g = bar.getContext('2d');
    for (let i = 0; i < 180; i++) { g.fillStyle = rgb(heat(i / 179)); g.fillRect(i, 0, 1, 10); }
    this.legend.replaceChildren(h('div', {}, m.label), bar, h('div', { class: 'ticks' }, h('span', {}, m.fmt(lo)), h('span', {}, m.fmt(hi))));
  }

  layout(W, H) {
    const D = this.D, geo = D.geo, P = this.P;
    const L = geo.length, Rmax = Math.max(geo.Rc, geo.Re);
    // plume length depends only on the engine, so the drawing does not jump as the altitude changes
    const pl = this.plumeOn ? Math.min(2.2 * L, Math.max(1.6 * D.De, 1.6 * L)) : 0;
    const total = L + pl, padL = 28, padR = 16;
    const s = Math.min((W - padL - padR) / total, (H - 56) / (2 * Rmax * 1.12));
    const x0 = padL + (W - padL - padR - total * s) / 2;
    return { s, X: x => x0 + (x - geo.xInj) * s, Y: r => H / 2 - r * s, cy: H / 2, pl, W, H, inv: X => geo.xInj + (X - x0) / s };
  }

  draw() {
    const cv = this.cv, dpr = Math.min(devicePixelRatio || 1, 2), W = this.el.clientWidth, H = this.el.clientHeight;
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = this.g; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const D = this.D; if (!D) return;
    const geo = D.geo, Ly = this.layout(W, H), { X, Y, s, cy } = Ly;
    this.Ly = Ly;
    const pts = geo.pts;
    const C = { text: cssVar('--text'), t2: cssVar('--text-2'), t3: cssVar('--text-3'), border: cssVar('--border-strong'), bg: cssVar('--bg-elev'), accent: cssVar('--accent'), bad: cssVar('--bad'), warn: cssVar('--warn') };
    const dark = document.documentElement.dataset.resolvedTheme === 'dark';
    // axis
    g.strokeStyle = C.border; g.setLineDash([6, 5]); g.lineWidth = 1; g.beginPath(); g.moveTo(8, cy); g.lineTo(W - 8, cy); g.stroke(); g.setLineDash([]);

    // plume first (behind the nozzle walls)
    if (this.P) this.drawPlume(g, Ly, C, dark);

    // gas inside the engine, colored by the selected quantity
    const path = () => { g.beginPath(); g.moveTo(X(pts[0][0]), Y(pts[0][1])); for (const [x, r] of pts) g.lineTo(X(x), Y(r)); for (let i = pts.length - 1; i >= 0; i--) g.lineTo(X(pts[i][0]), Y(-pts[i][1])); g.closePath(); };
    const [lo, hi] = this.range(), m = MODES[this.mode];
    g.save(); path(); g.clip();
    const sepX = this.P && this.P.regime === 'separated' ? this.P.xSep : Infinity;
    for (let i = 0; i < D.along.length - 1; i++) {
      const a = D.along[i], b = D.along[i + 1];
      const v = 0.5 * (m.get(a, i, this.B) + m.get(b, i + 1, this.B));
      g.fillStyle = rgb(heat((v - lo) / (hi - lo)));
      const x0 = X(a.x), x1 = X(b.x) + 0.8, rr = Math.max(a.r, b.r);
      g.fillRect(x0, Y(rr) - 1, x1 - x0, 2 * rr * s + 2);
    }
    if (isFinite(sepX)) { // separated region near the wall: dark recirculating ambient air
      const P = this.P, xs = X(sepX), xe = X(geo.xE);
      g.fillStyle = dark ? 'rgba(20,24,32,0.82)' : 'rgba(225,230,238,0.9)';
      g.beginPath(); g.moveTo(xs, Y(P.Rsep));
      for (const [x, r] of pts) if (x >= sepX) g.lineTo(X(x), Y(r));
      g.lineTo(xe, Y(this.jetR(geo.xE - sepX, true))); g.lineTo(xs, Y(P.Rsep)); g.fill();
      g.beginPath(); g.moveTo(xs, Y(-P.Rsep));
      for (const [x, r] of pts) if (x >= sepX) g.lineTo(X(x), Y(-r));
      g.lineTo(xe, Y(-this.jetR(geo.xE - sepX, true))); g.lineTo(xs, Y(-P.Rsep)); g.fill();
    }
    g.restore();

    // walls: liner + outer jacket (regeneratively cooled part), then a thin radiative extension for vacuum bells
    const tw = Math.max(4, Math.min(12, 0.2 * D.Rt * s));
    const regenEnd = this.coolX ?? (D.S.eps > 60 ? geo.pts.find(([x, r]) => x > 0 && (r / D.Rt) ** 2 > 0.3 * D.S.eps)?.[0] ?? geo.xE : geo.xE);
    for (const sgn of [1, -1]) {
      g.fillStyle = dark ? '#3a4150' : '#9aa3b2';
      g.beginPath();
      const reg = pts.filter(([x]) => x <= regenEnd);
      g.moveTo(X(reg[0][0]), Y(sgn * reg[0][1]));
      for (const [x, r] of reg) g.lineTo(X(x), Y(sgn * r));
      for (let i = reg.length - 1; i >= 0; i--) g.lineTo(X(reg[i][0]), Y(sgn * reg[i][1]) - sgn * tw);
      g.closePath(); g.fill();
      g.strokeStyle = dark ? '#c9d1dc' : '#4b5563'; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(X(pts[0][0]), Y(sgn * pts[0][1])); for (const [x, r] of pts) g.lineTo(X(x), Y(sgn * r)); g.stroke();
      g.lineWidth = 1; g.beginPath(); reg.forEach(([x, r], i) => { const yy = Y(sgn * r) - sgn * tw; i ? g.lineTo(X(x), yy) : g.moveTo(X(x), yy); }); g.stroke();
      // cooling channels (dashes inside the jacket)
      g.strokeStyle = cssVar('--upper'); g.globalAlpha = 0.7; g.lineWidth = 1; g.setLineDash([3, 3]);
      g.beginPath(); reg.forEach(([x, r], i) => { const yy = Y(sgn * r) - sgn * tw * 0.5; i ? g.lineTo(X(x), yy) : g.moveTo(X(x), yy); }); g.stroke();
      g.setLineDash([]); g.globalAlpha = 1;
    }
    // injector face and dome
    const xi = X(geo.xInj), rc = geo.Rc * s;
    g.fillStyle = dark ? '#4a5263' : '#7b8494'; g.fillRect(xi - 5, cy - rc - tw, 5, 2 * rc + 2 * tw);
    g.strokeStyle = dark ? '#c9d1dc' : '#4b5563'; g.lineWidth = 1.4;
    g.beginPath(); g.ellipse(xi - 5, cy, Math.min(rc * 0.45, 26), rc + tw, 0, Math.PI / 2, 1.5 * Math.PI); g.stroke();
    for (let k = -3; k <= 3; k++) { g.fillStyle = cssVar('--lower'); g.beginPath(); g.arc(xi + 1, cy + k * rc / 4, 1.3, 0, 7); g.fill(); }

    // labels
    if (W > 420) {
      g.font = '11px ' + cssVar('--font'); g.fillStyle = C.t2; g.textAlign = 'center'; g.textBaseline = 'bottom';
      const ch = D.along[0], th = D.throat, ex = D.along[D.along.length - 1];
      // two-line label (name over values) on a readable tag; top = y of the first line's top edge
      const tag2 = (x, top, a, b) => { const wa = g.measureText(a).width; g.font = '10.5px ' + cssVar('--mono'); const w = Math.max(wa, g.measureText(b).width) + 14; g.font = '11px ' + cssVar('--font'); canvasTag(g, x - w / 2, top - 4, w, 30); };
      const lab = (x, y, a, b) => { tag2(x, y - 25, a, b); g.fillStyle = C.t2; g.fillText(a, x, y - 13); g.fillStyle = C.t3; g.font = '10.5px ' + cssVar('--mono'); g.fillText(b, x, y); g.font = '11px ' + cssVar('--font'); };
      const cx = v => Math.max(62, Math.min(W - 62, v));
      lab(cx(X((geo.xInj + geo.xF) / 2)), Y(geo.Rc) - tw - 6, 'Chamber', `${ch.T.toFixed(0)} K · ${(D.Pc / 1e5).toFixed(0)} bar`);
      g.textBaseline = 'top';
      const yb = Y(-D.Rt) + tw + 6;
      tag2(cx(X(0)), yb, 'Throat', `M 1 · ${(th.P / 1e5).toFixed(1)} bar`);
      g.fillStyle = C.t2; g.fillText('Throat', cx(X(0)), yb); g.fillStyle = C.t3; g.font = '10.5px ' + cssVar('--mono'); g.fillText(`M 1 · ${(th.P / 1e5).toFixed(1)} bar`, cx(X(0)), yb + 13); g.font = '11px ' + cssVar('--font');
      g.textBaseline = 'bottom';
      lab(cx(X(geo.xE)), Y(geo.Re) - tw - 6, 'Exit', `M ${ex.M.toFixed(2)} · ${(D.pe / 1e5).toFixed(3)} bar`);
      g.strokeStyle = C.t3; g.setLineDash([2, 3]); g.lineWidth = 1;
      g.beginPath(); g.moveTo(X(0), Y(D.Rt)); g.lineTo(X(0), Y(-D.Rt)); g.stroke(); g.setLineDash([]);
    }
    // hover cursor
    if (this.hx != null) { g.strokeStyle = C.text; g.globalAlpha = 0.5; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(this.hx, 10); g.lineTo(this.hx, H - 10); g.stroke(); g.setLineDash([]); g.globalAlpha = 1; }
  }

  // jet boundary radius at distance xp downstream of where the jet leaves the wall
  jetR(xp, inside = false) {
    const P = this.P, D = this.D;
    const R0 = P.Rexit ?? D.De / 2;
    const wob = this.reduce ? 0 : 0.012 * Math.sin(this.t * 23 + xp * 9);
    const spread = inside ? 0 : 0.035 * xp;
    // Fan: the jet leaves the lip at the Prandtl–Meyer turning angle δ. The visible plume angle is compressed
    // smoothly (40°·(1 − e^(−δ/40°))) and the radius saturates, so the drawing stays on screen and changes
    // continuously from under-expanded to vacuum.
    const DEG = Math.PI / 180, Rcap = 1.8 * Math.max(D.geo.Rc, D.De / 2);
    const fan = d => {
      const tv = Math.tan(40 * DEG * (1 - Math.exp(-Math.max(0, d) / (40 * DEG)))), span = Math.max(1e-6, Rcap - R0);
      return R0 + span * (1 - Math.exp(-xp * tv / span));
    };
    if (P.regime === 'vacuum') return (fan(P.delta) + spread) * (1 + wob);
    const Rj = P.Dj / 2, Lc = Math.max(P.cell, 0.2 * D.De);
    const decay = Math.exp(-xp / (3.5 * Lc));
    const osc = Rj + (R0 - Rj) * Math.cos(2 * Math.PI * xp / Lc) * decay;
    // under-expanded: rise along the fan to the first cell's peak, then follow the shock-cell oscillation
    const r = R0 < Rj ? Math.min(fan(P.delta), xp < Lc / 2 ? 2 * Rj - R0 : osc) : osc;
    return (r + spread) * (1 + wob);
  }

  drawPlume(g, Ly, C, dark) {
    const { X, Y, s, cy, pl, W } = Ly, D = this.D, P = this.P, geo = D.geo;
    const start = P.regime === 'separated' ? P.xSep : geo.xE, end = geo.xE + pl;
    const fc = flameColor(D.S.fuel), Te = D.along[D.along.length - 1].T;
    const bright = Math.min(1, 0.35 + Te / 2200), fl = this.reduce ? 1 : 0.92 + 0.08 * Math.sin(this.t * 31) * Math.sin(this.t * 7.3);
    const N = 90, top = [];
    for (let i = 0; i <= N; i++) { const x = start + (end - start) * i / N; top.push([x, this.jetR(x - start)]); }
    // outer glow
    const grad = g.createLinearGradient(X(start), 0, X(end), 0);
    grad.addColorStop(0, `rgba(${fc},${0.85 * bright * fl})`); grad.addColorStop(0.5, `rgba(${fc},${0.35 * bright})`); grad.addColorStop(1, `rgba(${fc},0)`);
    g.fillStyle = grad;
    g.beginPath(); top.forEach(([x, r], i) => i ? g.lineTo(X(x), Y(r)) : g.moveTo(X(x), Y(r)));
    for (let i = N; i >= 0; i--) g.lineTo(X(top[i][0]), Y(-top[i][1])); g.closePath(); g.fill();
    // hot core
    const core = g.createLinearGradient(X(start), 0, X(start + (end - start) * 0.6), 0);
    core.addColorStop(0, `rgba(255,245,220,${0.75 * bright * fl})`); core.addColorStop(1, 'rgba(255,245,220,0)');
    g.fillStyle = core;
    g.beginPath(); top.forEach(([x, r], i) => i ? g.lineTo(X(x), Y(0.45 * r)) : g.moveTo(X(x), Y(0.45 * r)));
    for (let i = N; i >= 0; i--) g.lineTo(X(top[i][0]), Y(-0.45 * top[i][1])); g.closePath(); g.fill();
    if (P.regime === 'vacuum') {
      g.fillStyle = C.t3; g.font = '11px ' + cssVar('--font'); g.textAlign = 'right'; g.textBaseline = 'bottom';
      g.fillText('Vacuum: plume fans out, no shock cells', W - 12, Ly.H - 10);
      return;
    }
    // shock cells: waves from the jet boundary crossing at the axis, bright diamonds where they meet
    const Lc = Math.max(P.cell, 0.2 * D.De), nCells = Math.min(8, Math.floor((end - start) / Lc));
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1;
    for (let k = 0; k < nCells; k++) {
      const xa = start + k * Lc, xm = xa + Lc / 2, xb = xa + Lc, ra = this.jetR(xa - start), rb = this.jetR(xb - start);
      const fade = Math.exp(-k / 3);
      g.globalAlpha = fade;
      if (k === 0 && P.machDisk) {
        const xd = start + Math.min(P.mdX, 0.45 * Lc), rd = 0.33 * Math.min(ra, P.Dj / 2);
        g.beginPath(); g.moveTo(X(xa), Y(ra)); g.lineTo(X(xd), Y(rd)); g.lineTo(X(xd), Y(-rd)); g.lineTo(X(xa), Y(-ra));
        g.moveTo(X(xd), Y(rd)); g.lineTo(X(xb), Y(rb)); g.moveTo(X(xd), Y(-rd)); g.lineTo(X(xb), Y(-rb)); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 2.6; g.beginPath(); g.moveTo(X(xd), Y(rd)); g.lineTo(X(xd), Y(-rd)); g.stroke();
        g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,0.35)';
        this.glow(g, X(xd + 0.05 * Lc), cy, rd * s * 1.4, fade * fl);
      } else {
        g.beginPath(); g.moveTo(X(xa), Y(ra)); g.lineTo(X(xm), cy); g.lineTo(X(xb), Y(rb)); g.moveTo(X(xa), Y(-ra)); g.lineTo(X(xm), cy); g.lineTo(X(xb), Y(-rb)); g.stroke();
        this.glow(g, X(xm), cy, Math.max(4, 0.35 * ra * s), fade * fl);
      }
    }
    g.globalAlpha = 1;
    if (P.regime === 'separated') {
      g.strokeStyle = C.bad; g.lineWidth = 1.8;
      const xs = X(P.xSep), r0 = P.Rsep;
      for (const sg of [1, -1]) { g.beginPath(); g.moveTo(xs, Y(sg * r0)); g.lineTo(xs + 0.6 * r0 * s, Y(sg * r0 * 0.55)); g.stroke(); }
      g.fillStyle = C.bad; g.font = '600 11px ' + cssVar('--font'); g.textAlign = 'center'; g.textBaseline = 'top';
      g.fillText('separation', xs, Y(-r0) + 10);
    }
  }
  glow(g, x, y, r, a) {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(255,255,240,${0.95 * a})`); gr.addColorStop(1, 'rgba(255,255,240,0)');
    g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, r * 1.5, r, 0, 0, 7); g.fill();
  }

  hover(e) {
    const D = this.D, Ly = this.Ly; if (!D || !Ly) return;
    const r = this.cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const x = Ly.inv(mx), geo = D.geo;
    let html = '';
    if (x >= geo.xInj && x <= geo.xE) {
      let i = 0, bd = Infinity; D.along.forEach((p, k) => { const d = Math.abs(p.x - x); if (d < bd) { bd = d; i = k; } });
      const p = D.along[i];
      html = `x = ${(p.x * 100).toFixed(1)} cm from throat · r = ${(p.r * 100).toFixed(1)} cm<br>A/At = ${p.eps.toFixed(2)} · M = ${p.M.toFixed(3)}<br>p = ${(p.P / 1e5).toPrecision(4)} bar · T = ${p.T.toFixed(0)} K<br>u = ${p.u.toFixed(0)} m/s · molar mass ${(p.W * 1000).toFixed(2)} g/mol`;
      if (this.B) { const b = this.B.pts[i]; html += `<br>q = ${(b.q / 1e6).toFixed(2)} MW/m² · h<sub>g</sub> = ${(b.hg / 1000).toFixed(2)} kW/m²K`; }
      this.hx = Ly.X(p.x);
    } else if (this.P && x > geo.xE) {
      const P = this.P;
      html = P.regime === 'vacuum' ? 'Plume in vacuum: keeps expanding' : `Plume · fully expanded jet M<sub>j</sub> = ${P.Mj.toFixed(2)}<br>D<sub>j</sub> = ${(P.Dj).toFixed(2)} m · shock cell ≈ ${P.cell.toFixed(2)} m<br>p<sub>e</sub>/p<sub>a</sub> = ${P.ratio.toFixed(3)}${P.machDisk ? ' · Mach disk' : ''}`;
      this.hx = mx;
    } else { this.tip.style.display = 'none'; this.hx = null; this.draw(); return; }
    this.tip.innerHTML = html; this.tip.style.display = 'block';
    const tw = this.tip.offsetWidth;
    this.tip.style.left = Math.min(mx + 14, this.el.clientWidth - tw - 6) + 'px';
    this.tip.style.top = Math.max(6, my - 70) + 'px';
    if (this.reduce || !this.visible) this.draw();
  }
}
export const VIEW_MODES = Object.entries(MODES).map(([value, m]) => ({ value, label: m.label.replace(' (log)', '') }));
