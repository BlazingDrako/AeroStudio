// Drawing helpers shared by the GNC tabs: Bode plot with margins, an s-plane with root migration, aircraft silhouettes.
import { cssVar } from '../../lib/ui.js';
import * as Ct from '../../solvers/control.js';
import { num } from '../flight/common.js';
import { axes } from '../flight/perfShared.js';

const DEG = 180 / Math.PI;
export const f3 = v => (!isFinite(v) ? '—' : num(v, Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : Math.abs(v) >= 1 ? 2 : 3));

// Bode plot of a loop L(s) with its margins mg (control.js margins()): gain on top, phase below
export function drawBode(c, Wd, Hd, L, mg) {
  const fl = Ct.factor(L);
  let [w0, w1] = Ct.freqRange(fl);
  const marks = [...mg.gc.map(g => g.w), ...mg.ph.map(p => p.w)].filter(w => w > 0);
  if (marks.length) { w0 = Math.min(w0, Math.min(...marks) / 3); w1 = Math.max(w1, Math.max(...marks) * 3); }
  w0 = Math.max(1e-3, w0); w1 = Math.min(1e4, w1);
  const lw0 = Math.floor(Math.log10(w0)), lw1 = Math.ceil(Math.log10(w1));
  const b = Ct.bode(L, 10 ** lw0, 10 ** lw1, 500), H1 = Math.round(Hd * 0.52);
  const dbs = b.map(p => p.db).filter(isFinite), dlo = Math.max(-80, Math.min(-10, ...dbs)), dhi = Math.min(80, Math.max(10, ...dbs));
  const xf = v => { const w = 10 ** v; return w >= 1 ? f3(w) : w.toString(); };
  const tr = axes(c, Wd, H1, { x0: lw0, x1: lw1, y0: dlo - 5, y1: dhi + 5, xstep: 1, xlabel: '', ylabel: 'Gain (dB)', pb: 22, xfmt: xf, yfmt: v => num(v, 0) });
  tr.clip();
  tr.line([[lw0, 0], [lw1, 0]], cssVar('--border-strong'), 1.3);
  tr.line(b.map(p => [Math.log10(p.w), p.db]), cssVar('--accent'), 2.2);
  const pm = mg.pm, gu = mg.gmUp, gd = mg.gmDown;
  if (pm) { tr.line([[Math.log10(pm.w), dlo - 10], [Math.log10(pm.w), dhi + 10]], cssVar('--good'), 1, [3, 3]); tr.dot(Math.log10(pm.w), 0, cssVar('--good'), 4); }
  for (const [g, col] of [[gu, '--warn'], [gd, '--lower']]) if (g && g.w > 0) {
    const x = Math.log10(g.w); tr.line([[x, 0], [x, g.db]], cssVar(col), 2.4); tr.dot(x, g.db, cssVar(col), 4);
    tr.text(x, g.db / 2, `  ${g === gu ? 'GM' : 'GM↓'} ${f3(Math.abs(g.db))} dB`, cssVar(col), 'left', 'middle', '600 10.5px');
  }
  c.restore();
  c.save(); c.translate(0, H1);
  const phs = b.map(p => p.ph * DEG), plo = Math.max(-720, Math.floor((Math.min(-200, ...phs)) / 90) * 90), phi = Math.min(360, Math.ceil(Math.max(0, ...phs) / 90) * 90);
  const tp = axes(c, Wd, Hd - H1, { x0: lw0, x1: lw1, y0: plo, y1: phi, xstep: 1, ystep: (phi - plo) > 360 ? 180 : 90, xlabel: 'Frequency ω (rad/s)', ylabel: 'Phase (°)', pt: 8, xfmt: xf, yfmt: v => num(v, 0) });
  tp.clip();
  for (let k = -900; k <= 540; k += 360) tp.line([[lw0, k], [lw1, k]], cssVar('--bad'), 1.1, [5, 4], 0.7);
  tp.line(b.map(p => [Math.log10(p.w), p.ph * DEG]), cssVar('--accent'), 2.2);
  if (pm) {
    const x = Math.log10(pm.w), ph = b.reduce((a, q) => (Math.abs(q.w - pm.w) < Math.abs(a.w - pm.w) ? q : a)).ph * DEG, base = Math.round((ph - 180) / 360) * 360 + 180;
    tp.line([[x, base], [x, ph]], cssVar('--good'), 2.4); tp.dot(x, ph, cssVar('--good'), 4);
    tp.text(x, (base + ph) / 2, `  PM ${f3(pm.pmDeg)}°`, cssVar('--good'), 'left', 'middle', '600 10.5px');
  }
  c.restore(); c.restore();
}

// s-plane with equal scales: the roots in `fit` set the view; open-loop poles ×, zeros ○, closed-loop ●,
// and migration paths (arrays of {re, im}) drawn as lines. labels: [[root, text]]
export function drawSPlane(c, Wd, Hd, { fit, paths = [], ol = [], zeros = [], cl = [], labels = [], note = '' }) {
  const pl = 52, pr = 14, pt = 12, pb = 36, iw = Wd - pl - pr, ih = Hd - pt - pb;
  const big = Math.max(0.02, ...fit.map(z => Math.hypot(...z)));
  let x0 = -1.2 * Math.max(0.15 * big, ...fit.map(z => -z[0])), x1 = 1.25 * Math.max(0.3 * big, ...fit.map(z => z[0]));
  let Y = 1.2 * Math.max(0.3 * big, ...fit.map(z => Math.abs(z[1])));
  const kx = (x1 - x0) / iw, ky = 2 * Y / ih;
  if (ky > kx) { const add = (ky * iw - (x1 - x0)) / 2; x0 -= add; x1 += add; } else Y = kx * ih / 2;
  const tr = axes(c, Wd, Hd, { pl, pr, pt, pb, x0, x1, y0: -Y, y1: Y, xlabel: 'Real part σ (1/s)', ylabel: 'Imaginary part ω (rad/s)', xfmt: v => f3(v), yfmt: v => f3(v) });
  const Rr = Math.max(-x0, Y);
  tr.clip();
  c.fillStyle = cssVar('--bad'); c.globalAlpha = 0.06; c.fillRect(tr.sx(0), pt, tr.sx(x1) - tr.sx(0), ih); c.globalAlpha = 1;
  tr.line([[0, -1e4], [0, 1e4]], cssVar('--border-strong'), 1.2); tr.line([[-1e4, 0], [1e4, 0]], cssVar('--border-strong'), 1);
  for (const z of [0.2, 0.4, 0.6, 0.8]) {
    const a = Math.acos(z), r = 3 * Rr;
    tr.line([[0, 0], [-r * Math.cos(a), r * Math.sin(a)]], cssVar('--text-3'), 0.8, [2, 4], 0.7); tr.line([[0, 0], [-r * Math.cos(a), -r * Math.sin(a)]], cssVar('--text-3'), 0.8, [2, 4], 0.7);
    const lx = -0.92 * Rr, ly = lx * -Math.tan(a);
    if (Math.abs(ly) < Y * 0.95) tr.text(lx, ly, `ζ ${z}`, cssVar('--text-3'), 'left', 'bottom', '10px');
  }
  for (const p of paths) tr.line(p.map(q => [q.re, q.im]), cssVar('--accent'), 1.8, null, 0.6);
  const t2 = cssVar('--text-2');
  c.lineWidth = 2; c.strokeStyle = t2;
  for (const z of ol) { const X = tr.sx(z[0]), Yp = tr.sy(z[1]); c.beginPath(); c.moveTo(X - 5, Yp - 5); c.lineTo(X + 5, Yp + 5); c.moveTo(X + 5, Yp - 5); c.lineTo(X - 5, Yp + 5); c.stroke(); }
  for (const z of zeros) { c.beginPath(); c.arc(tr.sx(z[0]), tr.sy(z[1]), 5, 0, 2 * Math.PI); c.stroke(); }
  for (const [z, s] of labels) if (z[1] >= 0) tr.text(z[0], z[1], `  ${s}`, t2, 'left', 'bottom', '10.5px');
  for (const z of cl) tr.dot(z[0], z[1], z[0] > 2e-3 ? cssVar('--bad') : cssVar('--warn'), 5.5);
  c.restore();
  if (note) { c.fillStyle = cssVar('--text-3'); c.font = '10.5px ' + cssVar('--font'); c.textAlign = 'left'; c.textBaseline = 'bottom'; c.fillText(note, pl + 6, pt + ih - 4); }
  return tr;
}

// silhouettes, nose along +x
export function plane(c, color) {
  c.fillStyle = color; c.beginPath();
  c.moveTo(26, 0); c.quadraticCurveTo(22, -4, 10, -4); c.lineTo(-18, -3); c.lineTo(-26, -13); c.lineTo(-30, -13); c.lineTo(-26, -2); c.lineTo(-28, 2); c.lineTo(-18, 3); c.lineTo(10, 3); c.quadraticCurveTo(22, 3, 26, 0); c.fill();
  c.globalAlpha = 0.85; c.beginPath(); c.moveTo(4, 0); c.lineTo(-8, 7); c.lineTo(-12, 7); c.lineTo(-6, 0); c.fill(); c.globalAlpha = 1;
}
export function topView(c, color) {
  c.fillStyle = color; c.beginPath();
  c.moveTo(14, 0); c.lineTo(4, -2); c.lineTo(0, -14); c.lineTo(-4, -14); c.lineTo(-3, -2); c.lineTo(-10, -2); c.lineTo(-12, -6); c.lineTo(-14, -6); c.lineTo(-13, 0);
  c.lineTo(-14, 6); c.lineTo(-12, 6); c.lineTo(-10, 2); c.lineTo(-3, 2); c.lineTo(-4, 14); c.lineTo(0, 14); c.lineTo(4, 2); c.closePath(); c.fill();
}
