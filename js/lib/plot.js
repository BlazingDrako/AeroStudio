// Minimal, fast canvas chart: line/scatter series, nice ticks, legend, hover readout.
import { h, cssVar } from './ui.js';
import { plotExportButton } from './export.js';

function niceStep(range, target) {
  const raw = range / Math.max(1, target), p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}
function ticks(a, b, target) {
  if (!(b > a)) return [a];
  const s = niceStep(b - a, target), out = [];
  for (let v = Math.ceil(a / s - 1e-9) * s; v <= b + 1e-9 * s; v += s) out.push(Math.abs(v) < s * 1e-9 ? 0 : v);
  return out;
}
function fmtTick(v, step) {
  const d = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  if (Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0)) return v.toExponential(1);
  return v.toFixed(Math.min(d, 6));
}

export class Plot {
  constructor(container, opts = {}) {
    this.opts = { xlabel: '', ylabel: '', invertY: false, legend: true, pad: [8, 12, 34, 50], ...opts };
    this.wrap = h('div', { class: 'plot' });
    this.canvas = h('canvas');
    this.tip = h('div', { class: 'ptip' });
    this.wrap.append(this.canvas, this.tip, plotExportButton(this));
    this.wrap.__plot = this;
    container.append(this.wrap);
    this.ctx = this.canvas.getContext('2d');
    this.data = { series: [] };
    this.hover = null;
    new ResizeObserver(() => this.draw()).observe(this.wrap);
    this.canvas.addEventListener('mousemove', e => this.onMove(e));
    this.canvas.addEventListener('mouseleave', () => { this.hover = null; this.tip.style.display = 'none'; this.draw(); });
    addEventListener('themechange', () => this.draw());
  }

  setData(d) { this.data = d; this.draw(); }
  setOpts(o) { Object.assign(this.opts, o); this.draw(); }

  // optional log axes: values are mapped through log10 before scaling
  TX(v) { return this.opts.logx ? (v > 0 ? Math.log10(v) : NaN) : v; }
  TY(v) { return this.opts.logy ? (v > 0 ? Math.log10(v) : NaN) : v; }
  bounds() {
    const o = this.opts;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const s of this.data.series) {
      if (s.skipBounds) continue;
      for (let i = 0; i < s.x.length; i++) {
        const x = this.TX(s.x[i]), y = this.TY(s.y[i]);
        if (!isFinite(x) || !isFinite(y)) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    for (const l of this.data.hlines || []) if (l.bound !== false) { const v = this.TY(l.y); if (isFinite(v)) { y0 = Math.min(y0, v); y1 = Math.max(y1, v); } }
    if (!isFinite(x0)) { x0 = 0; x1 = 1; y0 = 0; y1 = 1; }
    if (o.xlim) [x0, x1] = o.xlim.map(v => this.TX(v));
    if (o.ylim) [y0, y1] = o.ylim.map(v => this.TY(v));
    if (x1 - x0 < 1e-12) { x0 -= 0.5; x1 += 0.5; }
    if (y1 - y0 < 1e-12) { const c = y0; y0 = c - Math.max(1e-3, Math.abs(c) * 0.1); y1 = c + Math.max(1e-3, Math.abs(c) * 0.1); }
    if (!o.ylim) { const m = (y1 - y0) * 0.06; y0 -= m; y1 += m; if (o.yZero && y0 > 0 && !o.logy) y0 = 0; }
    if (!o.xlim && o.xPad) { const m = (x1 - x0) * 0.03; x0 -= m; x1 += m; }
    return { x0, x1, y0, y1 };
  }

  draw() {
    const c = this.canvas, dpr = Math.min(devicePixelRatio || 1, 2);
    const W = this.wrap.clientWidth, H = this.wrap.clientHeight;
    if (!W || !H) return;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const g = this.ctx; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const o = this.opts; let [pt, pr, pb, pl] = o.pad;
    // legendPos 'above': the legend gets its own rows over the plot area, so it never covers a curve
    const legItems = o.legend ? this.data.series.filter(s => s.label && !s.noLegend) : [];
    let legRows = null;
    if (legItems.length && o.legendPos === 'above') {
      g.font = '11px ' + cssVar('--font'); legRows = [[]]; let x = 0;
      const room = W - pl - pr - 8;
      for (const s of legItems) { const w = g.measureText(s.label).width + 26; if (x + w > room && legRows.at(-1).length) { legRows.push([]); x = 0; } legRows.at(-1).push(s); x += w; }
      pt += legRows.length * 15 + 2;
    }
    const B = this.bounds(); this.B = B;
    const iw = W - pl - pr, ih = H - pt - pb;
    const sx = x => pl + (this.TX(x) - B.x0) / (B.x1 - B.x0) * iw;
    const sy = y => o.invertY ? pt + (this.TY(y) - B.y0) / (B.y1 - B.y0) * ih : pt + (B.y1 - this.TY(y)) / (B.y1 - B.y0) * ih;
    this.sx = sx; this.sy = sy; this.inner = { pl, pt, iw, ih };
    const text = cssVar('--text-3'), grid = cssVar('--border'), axis = cssVar('--border-strong');
    g.font = '10.5px ' + cssVar('--mono'); g.fillStyle = text; g.lineWidth = 1;
    // grid + ticks
    // tick values in data space (log axes: 1-2-5 per decade)
    const logTicks = (a, b, target) => { const out = []; const per = (b - a) > target * 0.6 ? [1] : (b - a) > target * 0.25 ? [1, 3] : [1, 2, 5]; for (let e = Math.floor(a); e <= Math.ceil(b); e++) for (const m of per) { const v = m * 10 ** e, lv = Math.log10(v); if (lv >= a - 1e-9 && lv <= b + 1e-9) out.push(v); } return out; };
    const xt = o.logx ? logTicks(B.x0, B.x1, Math.max(3, iw / 80)) : ticks(B.x0, B.x1, Math.max(3, iw / 80));
    const yt = o.logy ? logTicks(B.y0, B.y1, Math.max(3, ih / 45)) : ticks(B.y0, B.y1, Math.max(3, ih / 45));
    const xs = xt.length > 1 ? xt[1] - xt[0] : 1, ys = yt.length > 1 ? yt[1] - yt[0] : 1;
    const fmtLog = v => (v >= 1e4 || v < 1e-3 ? v.toExponential(0) : String(+v.toPrecision(3)));
    g.strokeStyle = grid; g.beginPath();
    for (const v of xt) { const X = Math.round(sx(v)) + 0.5; g.moveTo(X, pt); g.lineTo(X, pt + ih); }
    for (const v of yt) { const Y = Math.round(sy(v)) + 0.5; g.moveTo(pl, Y); g.lineTo(pl + iw, Y); }
    g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (const v of xt) g.fillText(o.logx ? fmtLog(v) : fmtTick(v, xs), sx(v), pt + ih + 5);
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (const v of yt) g.fillText(o.logy ? fmtLog(v) : fmtTick(v, ys), pl - 6, sy(v));
    // zero lines
    g.strokeStyle = axis;
    if (!o.logy && B.y0 < 0 && B.y1 > 0) { g.beginPath(); const Y = Math.round(sy(0)) + 0.5; g.moveTo(pl, Y); g.lineTo(pl + iw, Y); g.stroke(); }
    // labels
    g.fillStyle = cssVar('--text-2'); g.font = '11px ' + cssVar('--font');
    g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText(o.xlabel, pl + iw / 2, H - 2);
    g.save(); g.translate(11, pt + ih / 2); g.rotate(-Math.PI / 2); g.textBaseline = 'middle'; g.fillText(o.ylabel, 0, 0); g.restore();
    // clip to plot area
    g.save(); g.beginPath(); g.rect(pl, pt, iw, ih); g.clip();
    for (const b of this.data.vbands || []) { g.fillStyle = b.color; g.fillRect(sx(b.x0), pt, sx(b.x1) - sx(b.x0), ih); }
    for (const l of this.data.hlines || []) {
      g.strokeStyle = l.color; g.setLineDash(l.dash || [5, 4]); g.lineWidth = 1.2; g.beginPath();
      g.moveTo(pl, sy(l.y)); g.lineTo(pl + iw, sy(l.y)); g.stroke(); g.setLineDash([]);
      if (l.label) {
        // labelAt: 0 = left end, 1 = right end (default), so a label can sit where the curve is away from the line
        const f = l.labelAt ?? 1; g.fillStyle = l.color; g.font = '10.5px ' + cssVar('--font');
        g.textAlign = f <= 0 ? 'left' : f >= 1 ? 'right' : 'center'; g.textBaseline = l.labelBelow ? 'top' : 'bottom';
        g.fillText(l.label, f <= 0 ? pl + 4 : f >= 1 ? pl + iw - 4 : pl + iw * f, sy(l.y) + (l.labelBelow ? 2 : -2));
      }
    }
    for (const l of this.data.vlines || []) {
      g.strokeStyle = l.color; g.setLineDash(l.dash || [4, 4]); g.lineWidth = 1; g.beginPath();
      g.moveTo(sx(l.x), pt); g.lineTo(sx(l.x), pt + ih); g.stroke(); g.setLineDash([]);
    }
    for (const s of this.data.series) {
      g.strokeStyle = s.color; g.fillStyle = s.color; g.globalAlpha = s.alpha ?? 1;
      g.lineWidth = s.width ?? 1.8; g.setLineDash(s.dash || []); g.lineJoin = 'round';
      if (s.line !== false) {
        g.beginPath(); let pen = false;
        for (let i = 0; i < s.x.length; i++) {
          if (!isFinite(s.y[i]) || !isFinite(s.x[i]) || (s.gaps && s.gaps[i])) { pen = false; continue; }
          const X = sx(s.x[i]), Y = sy(s.y[i]);
          if (!isFinite(X) || !isFinite(Y)) { pen = false; continue; }
          if (!pen) { g.moveTo(X, Y); pen = true; } else g.lineTo(X, Y);
        }
        g.stroke();
      }
      g.setLineDash([]);
      if (s.points) {
        const r = s.pointSize ?? 2.6;
        for (let i = 0; i < s.x.length; i++) {
          if (!isFinite(s.y[i])) continue;
          g.beginPath(); g.arc(sx(s.x[i]), sy(s.y[i]), r, 0, 2 * Math.PI);
          if (s.hollow && s.hollow[i]) { g.lineWidth = 1.2; g.stroke(); } else g.fill();
        }
      }
      g.globalAlpha = 1;
    }
    // hover
    if (this.hover) {
      const { X, Y, s } = this.hover;
      g.strokeStyle = cssVar('--text-3'); g.setLineDash([3, 3]); g.lineWidth = 1;
      g.beginPath(); g.moveTo(X, pt); g.lineTo(X, pt + ih); g.stroke(); g.setLineDash([]);
      g.fillStyle = s.color; g.strokeStyle = cssVar('--bg-elev'); g.lineWidth = 2;
      g.beginPath(); g.arc(X, Y, 4, 0, 2 * Math.PI); g.fill(); g.stroke();
    }
    g.restore();
    // legend
    if (legRows) {
      g.font = '11px ' + cssVar('--font'); g.textBaseline = 'middle'; g.textAlign = 'left';
      legRows.forEach((row, r) => {
        let x = pl + 4; const y = o.pad[0] + 7 + r * 15;
        for (const s of row) {
          g.strokeStyle = s.color; g.lineWidth = 2; g.setLineDash(s.dash || []);
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + 14, y); g.stroke(); g.setLineDash([]);
          g.fillStyle = cssVar('--text-2'); g.fillText(s.label, x + 18, y);
          x += g.measureText(s.label).width + 26;
        }
      });
    } else if (o.legend) {
      const items = legItems;
      g.font = '11px ' + cssVar('--font'); g.textBaseline = 'middle'; g.textAlign = 'left';
      let x = pl + 8, y = pt + 10;
      if (o.legendPos === 'bottom') y = pt + ih - 10;
      for (const s of items) {
        const w = g.measureText(s.label).width + 26;
        if (x + w > pl + iw) { x = pl + 8; y += o.legendPos === 'bottom' ? -15 : 15; }
        g.strokeStyle = s.color; g.lineWidth = 2; g.setLineDash(s.dash || []);
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + 14, y); g.stroke(); g.setLineDash([]);
        g.fillStyle = cssVar('--text-2'); g.fillText(s.label, x + 18, y);
        x += w;
      }
    }
  }

  onMove(e) {
    const r = this.canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    if (!this.sx) return;
    let best = null, bd = 30 * 30;
    for (const s of this.data.series) {
      if (s.noHover) continue;
      for (let i = 0; i < s.x.length; i++) {
        if (!isFinite(s.y[i])) continue;
        const X = this.sx(s.x[i]), Y = this.sy(s.y[i]), d = (X - mx) ** 2 + (Y - my) ** 2;
        if (d < bd) { bd = d; best = { X, Y, s, i }; }
      }
    }
    this.hover = best;
    if (best) {
      const s = best.s, fx = this.opts.xfmt || (v => v.toFixed(4)), fy = this.opts.yfmt || (v => v.toPrecision(4));
      this.tip.innerHTML = `<span style="color:${s.color}">●</span> ${s.label || ''}<br>${this.opts.xname || 'x'} = ${fx(s.x[best.i])}<br>${this.opts.yname || 'y'} = ${fy(s.y[best.i])}`
        + (s.extra ? '<br>' + s.extra(best.i) : '');
      this.tip.style.display = 'block';
      const tw = this.tip.offsetWidth;
      this.tip.style.left = Math.min(best.X + 12, this.wrap.clientWidth - tw - 4) + 'px';
      this.tip.style.top = Math.max(4, best.Y - 46) + 'px';
    } else this.tip.style.display = 'none';
    this.draw();
  }
}
