// Interactive θ–β–M chart and pressure–deflection shock polar.
import { h, section, slider, segmented, toggle, field, info, cssVar } from '../../lib/ui.js';
import * as G from '../../solvers/gasdyn.js';
import { gasPicker, card, fmt } from './common.js';
import { sendTo, sendSection } from '../../lib/send.js';

const { DEG } = G;
const MACHS = [1.05, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 2, 2.2, 2.5, 3, 3.5, 4, 5, 6, 8, 10, 20];

export function tbmTab({ keep = o => o } = {}) {
  const S = keep({ M: 2.5, theta: 15, g: 1.4, R: 287.05, gas: 'air', view: 'tbm', branch: 'weak', showSonic: true, showMax: true });
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });
  const secV = section('Chart');
  const viewSeg = segmented([{ value: 'tbm', label: 'θ–β–M' }, { value: 'polar', label: 'Shock polar' }], 'tbm', v => { S.view = v; draw(); });
  secV.body.append(viewSeg.el, h('div', { class: 'hint' }, 'Click or drag on the chart to pick a point. In θ–β–M mode that sets both the Mach number and the deflection.'));
  const secI = section('Selected point');
  const mS = slider({ label: 'Upstream Mach M₁', min: 1.01, max: 20, log: true, value: S.M, digits: 3, onInput: v => { S.M = v; draw(); } });
  const tS = slider({ label: 'Deflection θ', min: 0, max: 45.5, step: 0.05, value: S.theta, format: v => (+v).toFixed(2) + '°', onInput: v => { S.theta = v; draw(); } });
  const brSeg = segmented([{ value: 'weak', label: 'Weak' }, { value: 'strong', label: 'Strong' }], 'weak', v => { S.branch = v; draw(); });
  secI.body.append(mS.el, tS.el, field('Highlight branch', brSeg.el, 'Every θ < θmax has two shock angles. Weak (lower β) is the one normally seen.'), gasPicker(S, () => draw()));
  const secL = section('Layers', { collapsible: true });
  secL.body.append(toggle('θmax locus', true, v => { S.showMax = v; draw(); }).el, toggle('Sonic line (M₂ = 1)', true, v => { S.showSonic = v; draw(); }).el);
  controls.append(secV.el, secI.el, secL.el, sendSection([
    { label: 'Shocks & expansions', sub: 'See this shock on a compression ramp, with the flow field', go: () => sendTo({ mod: 'compressible', tab: 'waves',
      note: `A ${+S.theta.toFixed(2)}° ramp at M ${+S.M.toFixed(3)}`, values: { id: 'ramp', M: S.M, angle: S.theta, strong: S.branch === 'strong', g: S.g, R: S.R, gas: S.gas } }) },
  ]));

  const chart = h('div', { class: 'cf-chart' });
  const canvas = h('canvas'); chart.append(canvas);
  const tip = h('div', { class: 'readout', style: { position: 'absolute' } }); chart.append(tip);
  const resCard = card('Oblique-shock solution', 'Both solutions for the selected M₁ and θ. Weak = smaller β (usually supersonic behind); strong = larger β (always subsonic behind).');
  const resEl = h('div', { class: 'cf-grid2b' }); resCard.append(resEl);
  const sketchCard = card('What it looks like', 'Wedge and shock drawn to scale for the highlighted branch.');
  const sk = h('canvas', { style: { width: '100%', height: '220px', display: 'block' } }); sketchCard.append(sk);
  main.append(chart, h('div', { class: 'cf-grid2' }, resCard, sketchCard));

  const ctx = canvas.getContext('2d');
  let tr = null, hover = null, drag = false;
  const curveCache = new Map();
  const curve = (M, g) => {
    const k = M + '|' + g; if (curveCache.has(k)) return curveCache.get(k);
    const mu = Math.asin(1 / M), pts = [];
    for (let i = 0; i <= 300; i++) { const b = mu + (Math.PI / 2 - mu) * i / 300; pts.push([G.thetaFromBeta(M, b, g), b]); }
    curveCache.set(k, pts); return pts;
  };
  function layout() {
    const W = chart.clientWidth, H = chart.clientHeight, dpr = Math.min(devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    const pl = 56, pr = 18, pt = 16, pb = 42, iw = W - pl - pr, ih = H - pt - pb;
    if (S.view === 'tbm') tr = { W, H, dpr, pl, pt, iw, ih, x0: 0, x1: 46, y0: 0, y1: 90 };
    else { const pmax = G.normalShock(S.M, S.g).p2_p1 * 1.08; const tm = G.thetaMax(S.M, S.g) / DEG * 1.25 + 2; tr = { W, H, dpr, pl, pt, iw, ih, x0: -tm, x1: tm, y0: 0.8, y1: pmax }; }
    tr.sx = v => pl + (v - tr.x0) / (tr.x1 - tr.x0) * iw; tr.sy = v => pt + (tr.y1 - v) / (tr.y1 - tr.y0) * ih;
    tr.ix = X => tr.x0 + (X - pl) / iw * (tr.x1 - tr.x0); tr.iy = Y => tr.y1 - (Y - pt) / ih * (tr.y1 - tr.y0);
  }
  function axes(xl, yl, xs, ys) {
    const c = ctx, t = tr; c.font = '10.5px ' + cssVar('--mono'); c.strokeStyle = cssVar('--border'); c.fillStyle = cssVar('--text-3'); c.lineWidth = 1;
    c.beginPath();
    for (let v = Math.ceil(t.x0 / xs) * xs; v <= t.x1 + 1e-9; v += xs) { const X = Math.round(t.sx(v)) + 0.5; c.moveTo(X, t.pt); c.lineTo(X, t.pt + t.ih); }
    for (let v = Math.ceil(t.y0 / ys) * ys; v <= t.y1 + 1e-9; v += ys) { const Y = Math.round(t.sy(v)) + 0.5; c.moveTo(t.pl, Y); c.lineTo(t.pl + t.iw, Y); }
    c.stroke();
    c.textAlign = 'center'; c.textBaseline = 'top';
    for (let v = Math.ceil(t.x0 / xs) * xs; v <= t.x1 + 1e-9; v += xs) c.fillText(+v.toFixed(2), t.sx(v), t.pt + t.ih + 5);
    c.textAlign = 'right'; c.textBaseline = 'middle';
    for (let v = Math.ceil(t.y0 / ys) * ys; v <= t.y1 + 1e-9; v += ys) c.fillText(+v.toFixed(2), t.pl - 6, t.sy(v));
    c.fillStyle = cssVar('--text-2'); c.font = '12px ' + cssVar('--font'); c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillText(xl, t.pl + t.iw / 2, t.H - 4);
    c.save(); c.translate(14, t.pt + t.ih / 2); c.rotate(-Math.PI / 2); c.textBaseline = 'middle'; c.fillText(yl, 0, 0); c.restore();
  }
  function path(pts, color, width = 1.4, dash = null, alpha = 1) {
    const c = ctx; c.strokeStyle = color; c.lineWidth = width; c.setLineDash(dash || []); c.globalAlpha = alpha; c.beginPath();
    let pen = false; for (const [x, y] of pts) { if (!isFinite(x) || !isFinite(y)) { pen = false; continue; } const X = tr.sx(x), Y = tr.sy(y); pen ? c.lineTo(X, Y) : c.moveTo(X, Y); pen = true; }
    c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
  }
  function dot(x, y, color, r = 5, ring = true) { const c = ctx; c.fillStyle = color; c.strokeStyle = cssVar('--bg-elev'); c.lineWidth = 2; c.beginPath(); c.arc(tr.sx(x), tr.sy(y), r, 0, 2 * Math.PI); c.fill(); if (ring) c.stroke(); }

  function draw() {
    layout();
    const c = ctx, g = S.g; c.setTransform(tr.dpr, 0, 0, tr.dpr, 0, 0); c.clearRect(0, 0, tr.W, tr.H);
    const acc = cssVar('--accent'), t3 = cssVar('--text-3'), t2 = cssVar('--text-2'), bad = cssVar('--bad'), warn = cssVar('--warn');
    const th = S.theta * DEG, M = S.M;
    const bw = G.betaFromTheta(M, th, g, 'weak'), bs = G.betaFromTheta(M, th, g, 'strong');
    if (S.view === 'tbm') {
      axes('Deflection angle θ (deg)', 'Shock wave angle β (deg)', 5, 10);
      c.save(); c.beginPath(); c.rect(tr.pl, tr.pt, tr.iw, tr.ih); c.clip();
      // curves
      for (const m of MACHS) {
        const pts = curve(m, g).map(([t, b]) => [t / DEG, b / DEG]);
        const bm = G.betaMax(m, g) / DEG;
        path(pts.filter(p => p[1] <= bm + 1e-9), t2, 1.1, null, 0.75);
        path(pts.filter(p => p[1] >= bm - 1e-9), t3, 1, [3, 3], 0.6);
        const lab = pts[Math.round(pts.length * 0.07)];
        const tm = G.thetaMax(m, g) / DEG;
        c.fillStyle = t3; c.font = '10px ' + cssVar('--mono'); c.textAlign = 'left'; c.textBaseline = 'middle';
        c.fillText(m, tr.sx(tm) + 3, tr.sy(bm));
      }
      // limit curve M → ∞
      const inf = []; for (let i = 0; i <= 200; i++) { const b = (Math.PI / 2) * i / 200; inf.push([G.thetaFromBeta(1e4, b, g) / DEG, b / DEG]); }
      path(inf, t3, 1.4, [6, 3]);
      if (S.showMax) { const L = []; for (let m = 1.0005; m < 60; m *= 1.03) L.push([G.thetaMax(m, g) / DEG, G.betaMax(m, g) / DEG]); path(L, bad, 1.6, [6, 4]); }
      if (S.showSonic) { const L = []; for (let m = 1.0005; m < 60; m *= 1.03) { const b = G.betaSonic(m, g); L.push([G.thetaFromBeta(m, b, g) / DEG, b / DEG]); } path(L, warn, 1.6, [2, 3]); }
      // selected Mach curve
      const sel = curve(M, g).map(([t, b]) => [t / DEG, b / DEG]); path(sel, acc, 2.6);
      c.restore();
      // θ line
      c.strokeStyle = acc; c.setLineDash([4, 4]); c.lineWidth = 1; c.beginPath(); c.moveTo(tr.sx(S.theta), tr.pt); c.lineTo(tr.sx(S.theta), tr.pt + tr.ih); c.stroke(); c.setLineDash([]);
      if (isFinite(bw)) { dot(S.theta, bw / DEG, S.branch === 'weak' ? acc : t2, S.branch === 'weak' ? 6 : 4.5); dot(S.theta, bs / DEG, S.branch === 'strong' ? acc : t2, S.branch === 'strong' ? 6 : 4.5); }
      // legend
      const items = [[acc, `M₁ = ${M.toFixed(3)}`, null], [t2, 'weak branch', null], [t3, 'strong branch', [3, 3]], ...(S.showMax ? [[bad, 'θmax (detachment)', [6, 4]]] : []), ...(S.showSonic ? [[warn, 'M₂ = 1', [2, 3]]] : [])];
      let x = tr.pl + 10, y = tr.pt + 12; c.font = '11px ' + cssVar('--font');
      for (const [col, lab, d] of items) { c.strokeStyle = col; c.lineWidth = 2; c.setLineDash(d || []); c.beginPath(); c.moveTo(x, y); c.lineTo(x + 16, y); c.stroke(); c.setLineDash([]); c.fillStyle = t2; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(lab, x + 20, y); y += 16; }
      if (!isFinite(bw)) { c.fillStyle = bad; c.font = '600 12px ' + cssVar('--font'); c.textAlign = 'center'; c.fillText(`θ > θmax = ${(G.thetaMax(M, g) / DEG).toFixed(2)}° → detached shock`, tr.sx(S.theta), tr.pt + tr.ih - 20); }
    } else {
      // pressure–deflection polar for M1, plus reflected polar from state 2 (weak)
      const yr = tr.y1 - tr.y0, ys = yr > 40 ? 10 : yr > 16 ? 2 : yr > 6 ? 1 : 0.5;
      axes('Flow deflection θ (deg)', 'Pressure ratio p/p₁', tr.x1 > 30 ? 10 : 5, ys);
      c.save(); c.beginPath(); c.rect(tr.pl, tr.pt, tr.iw, tr.ih); c.clip();
      const polar = (m, p0, th0, col, w) => {
        const pts = []; const mu = Math.asin(1 / m);
        for (let i = 0; i <= 300; i++) { const b = mu + (Math.PI / 2 - mu) * i / 300, os = G.obliqueShock(m, b, g); pts.push([(th0 + os.theta) / DEG, p0 * os.p2_p1]); }
        const neg = pts.map(([t, p]) => [2 * th0 / DEG - t, p]);
        path(pts, col, w); path(neg, col, w);
      };
      polar(M, 1, 0, acc, 2.4);
      if (isFinite(bw)) {
        const os = G.obliqueShock(M, bw, g);
        dot(S.theta, os.p2_p1, acc); dot(-S.theta, os.p2_p1, acc, 4);
        if (os.M2 > 1) {
          polar(os.M2, os.p2_p1, th, cssVar('--lower'), 1.8);
          const b2 = G.betaFromTheta(os.M2, th, g);
          if (isFinite(b2)) { const o2 = G.obliqueShock(os.M2, b2, g); dot(0, os.p2_p1 * o2.p2_p1, cssVar('--lower')); c.fillStyle = t2; c.font = '11px ' + cssVar('--font'); c.textAlign = 'left'; c.fillText(`regular reflection: p₃/p₁ = ${(os.p2_p1 * o2.p2_p1).toFixed(3)}`, tr.sx(0) + 8, tr.sy(os.p2_p1 * o2.p2_p1) - 8); }
          else { c.fillStyle = bad; c.font = '600 11px ' + cssVar('--font'); c.textAlign = 'center'; c.fillText('reflected polar misses θ = 0 → Mach reflection', tr.sx(0), tr.pt + 20); }
        }
      }
      // expansion branch (Prandtl–Meyer) for completeness
      const ex = []; for (let d = 0; d <= Math.min(40, G.isen.numax(g) / DEG - G.isen.nu(M, g) / DEG); d += 0.25) { const e = G.expansion(M, d * DEG, g); ex.push([-d, e.p2_p1]); }
      path(ex, cssVar('--good'), 1.6, [5, 3]); path(ex.map(([t, p]) => [-t, p]), cssVar('--good'), 1.6, [5, 3]);
      c.restore();
      const items = [[acc, `shock polar, M₁ = ${M.toFixed(2)}`], [cssVar('--lower'), 'reflected-shock polar from state 2'], [cssVar('--good'), 'Prandtl–Meyer expansion']];
      let x = tr.pl + 10, y = tr.pt + 12; c.font = '11px ' + cssVar('--font');
      for (const [col, lab] of items) { c.strokeStyle = col; c.lineWidth = 2; c.beginPath(); c.moveTo(x, y); c.lineTo(x + 16, y); c.stroke(); c.fillStyle = t2; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(lab, x + 20, y); y += 16; }
    }
    if (hover) { tip.innerHTML = hover.html; tip.style.display = 'block'; tip.style.left = Math.min(hover.X + 14, tr.W - tip.offsetWidth - 6) + 'px'; tip.style.top = Math.max(6, hover.Y - 50) + 'px'; } else tip.style.display = 'none';
    results(bw, bs); sketch(S.branch === 'weak' ? bw : bs);
  }

  function results(bw, bs) {
    const g = S.g, M = S.M;
    const col = (name, b) => {
      if (!isFinite(b)) return h('div', {}, h('h4', { style: { marginBottom: '6px' } }, name), h('div', { class: 'hint' }, `No attached solution: θ exceeds θmax = ${(G.thetaMax(M, g) / DEG).toFixed(3)}°.`));
      const o = G.obliqueShock(M, b, g);
      const rows = [['Shock angle β', (b / DEG).toFixed(3) + '°', true], ['Mn₁ = M₁ sin β', fmt(o.Mn1)], ['Mn₂', fmt(o.Mn2)], ['M₂', fmt(o.M2), true], ['p₂/p₁', fmt(o.p2_p1)], ['ρ₂/ρ₁', fmt(o.rho2_rho1)], ['T₂/T₁', fmt(o.T2_T1)], ['p₀₂/p₀₁', fmt(o.p02_p01)], ['Δs/R', fmt(o.ds_R)]];
      return h('div', {}, h('h4', { style: { marginBottom: '6px' } }, name), h('div', { class: 'cf-res', style: { gridTemplateColumns: '1fr' } }, ...rows.map(([k, v, hl]) => h('div', { class: 'r' + (hl ? ' hl' : '') }, h('span', {}, k), h('span', {}, v)))));
    };
    const extra = h('div', { class: 'cf-res', style: { gridColumn: '1 / -1', marginTop: '6px' } },
      ...[['θmax', (G.thetaMax(M, g) / DEG).toFixed(3) + '°'], ['β at θmax', (G.betaMax(M, g) / DEG).toFixed(3) + '°'], ['Mach angle μ₁', (Math.asin(1 / M) / DEG).toFixed(3) + '°'], ['β for M₂ = 1', (G.betaSonic(M, g) / DEG).toFixed(3) + '°']].map(([k, v]) => h('div', { class: 'r' }, h('span', {}, k), h('span', {}, v))));
    resEl.replaceChildren(col('Weak shock', bw), col('Strong shock', bs), extra);
  }
  function sketch(b) {
    const W = sk.clientWidth, H = 220, dpr = Math.min(devicePixelRatio || 1, 2);
    sk.width = W * dpr; sk.height = H * dpr;
    const c = sk.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    const th = S.theta * DEG, ox = W * 0.32, oy = H - 30, L = W * 0.6;
    c.fillStyle = cssVar('--border-strong'); c.beginPath(); c.moveTo(0, oy); c.lineTo(ox, oy); c.lineTo(ox + L, oy - L * Math.tan(th)); c.lineTo(ox + L, H); c.lineTo(0, H); c.closePath(); c.fill();
    c.strokeStyle = cssVar('--text-3'); c.setLineDash([4, 4]); c.beginPath(); c.moveTo(ox, oy); c.lineTo(W, oy); c.stroke(); c.setLineDash([]);
    if (isFinite(b)) { const R = Math.min(L * 1.4, (oy - 10) / Math.sin(b)); c.strokeStyle = cssVar('--bad'); c.lineWidth = 3; c.beginPath(); c.moveTo(ox, oy); c.lineTo(ox + R * Math.cos(b), oy - R * Math.sin(b)); c.stroke();
      c.fillStyle = cssVar('--text'); c.font = '12px ' + cssVar('--font'); c.fillText(`β = ${(b / DEG).toFixed(2)}°`, ox + R * Math.cos(b) * 0.55 + 8, oy - R * Math.sin(b) * 0.55);
    } else { c.fillStyle = cssVar('--bad'); c.font = '600 12px ' + cssVar('--font'); c.fillText('detached bow shock', ox - 60, 30); c.strokeStyle = cssVar('--bad'); c.lineWidth = 3; c.beginPath(); c.ellipse(ox - 10, oy, 40, oy - 20, 0, Math.PI * 0.5, Math.PI * 1.5); c.stroke(); }
    c.fillStyle = cssVar('--text-2'); c.font = '12px ' + cssVar('--font'); c.fillText(`θ = ${S.theta.toFixed(2)}°`, ox + 50, oy - 6);
    c.strokeStyle = cssVar('--accent'); c.lineWidth = 2; for (let k = 0; k < 4; k++) { const y = 30 + k * 32; c.beginPath(); c.moveTo(10, y); c.lineTo(60, y); c.lineTo(54, y - 4); c.moveTo(60, y); c.lineTo(54, y + 4); c.stroke(); }
    c.fillStyle = cssVar('--text-2'); c.fillText(`M₁ = ${S.M.toFixed(2)}`, 10, 18);
  }

  const pick = e => {
    const r = canvas.getBoundingClientRect(), X = e.clientX - r.left, Y = e.clientY - r.top;
    const x = tr.ix(X), y = tr.iy(Y);
    return { X, Y, x, y };
  };
  canvas.addEventListener('mousedown', e => { drag = true; apply(pick(e)); });
  addEventListener('mouseup', () => { drag = false; });
  canvas.addEventListener('mousemove', e => { const p = pick(e); if (drag) apply(p); hoverAt(p); draw(); });
  canvas.addEventListener('mouseleave', () => { hover = null; draw(); });
  function apply(p) {
    if (S.view === 'tbm') {
      const th = Math.max(0.01, Math.min(45.5, p.x)), be = Math.max(1, Math.min(89.9, p.y));
      const M = G.machFromThetaBeta(th * DEG, be * DEG, S.g);
      if (isFinite(M) && M > 1.005 && M < 50) { S.M = M; S.theta = th; S.branch = be > G.betaMax(M, S.g) / DEG ? 'strong' : 'weak'; brSeg.set(S.branch); mS.set(M); tS.set(th); }
    } else { S.theta = Math.max(0, Math.min(45, Math.abs(p.x))); tS.set(S.theta); }
  }
  function hoverAt(p) {
    if (p.X < tr.pl || p.X > tr.pl + tr.iw || p.Y < tr.pt || p.Y > tr.pt + tr.ih) { hover = null; return; }
    if (S.view === 'tbm') {
      const M = G.machFromThetaBeta(Math.max(1e-4, p.x) * DEG, p.y * DEG, S.g);
      hover = { X: p.X, Y: p.Y, html: isFinite(M) && M > 1 ? `θ ${p.x.toFixed(2)}° · β ${p.y.toFixed(2)}°<br>→ M₁ = ${M.toFixed(3)}<br>M₂ = ${G.obliqueShock(M, p.y * DEG, S.g).M2.toFixed(3)}` : `θ ${p.x.toFixed(2)}° · β ${p.y.toFixed(2)}°<br>no shock here` };
    } else hover = { X: p.X, Y: p.Y, html: `θ ${p.x.toFixed(2)}° · p/p₁ ${p.y.toFixed(3)}` };
  }
  const ro = new ResizeObserver(() => draw()); ro.observe(chart);
  const onTheme = () => draw(); addEventListener('themechange', onTheme);
  return { controls, main, show: () => requestAnimationFrame(draw), destroy: () => { ro.disconnect(); removeEventListener('themechange', onTheme); }, load: p => { Object.assign(S, p); mS.set(S.M); tS.set(S.theta); brSeg.set(S.branch); draw(); } };
}
