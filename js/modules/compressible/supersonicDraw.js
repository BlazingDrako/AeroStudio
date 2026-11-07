// Draws the wave pattern from solveSupersonic (shock-expansion theory on a sharp airfoil): the bent
// leading-edge shock, expansion fans / Mach waves from the surface, trailing-edge waves and the slip line.
// Shared by Airfoil Lab › Supersonic and the diamond scenario in Shocks & expansions.
import { line } from './field.js';
import { DEG } from '../../solvers/gasdyn.js';

const W = (side, p) => ({ x: p[0], y: side ? -p[1] : p[1] });

// distance along a ray (surface frame) until it meets this side's leading-edge shock or trailing-edge shock
function clipRay(D, ox, oy, a, Lmax, { te = true } = {}) {
  const c = Math.cos(a), s = Math.sin(a);
  let best = Lmax;
  const hit = (ax, ay, bx, by) => {
    const ex = bx - ax, ey = by - ay, den = c * ey - s * ex;
    if (Math.abs(den) < 1e-12) return;
    const t = ((ax - ox) * ey - (ay - oy) * ex) / den, u = ((ax - ox) * s - (ay - oy) * c) / den;
    if (t > 1e-6 && u >= 0 && u <= 1 && t < best) best = t;
  };
  if (D.shock) {
    const P = D.shock.pts, L = P[P.length - 1];
    for (let i = 0; i < P.length - 1; i++) hit(P[i][0], P[i][1], P[i + 1][0], P[i + 1][1]);
    hit(L[0], L[1], L[0] + 10 * Math.cos(D.shock.finalAng), L[1] + 10 * Math.sin(D.shock.finalAng));
  }
  if (te && D.te && D.te.type === 'shock') hit(D.te.x, D.te.y, D.te.x + 10 * Math.cos(D.te.ray), D.te.y + 10 * Math.sin(D.te.ray));
  return best;
}

export function drawSupersonicTheory(ctx, R, { thick = false, Lfar = 4 } = {}) {
  if (!R || !R.ok || !ctx.layers.waves) return;
  const shockCol = ctx.fieldOn || ctx.dark ? '#ffffff' : '#111', fanCol = ctx.fieldOn || ctx.dark ? 'rgba(255,255,255,0.75)' : 'rgba(20,24,33,0.6)';
  const g = ctx.g;
  for (let side = 0; side < 2; side++) {
    const D = R.D[side];
    if (D.shock) {
      const P = D.shock.pts.map(p => W(side, p)), last = D.shock.pts[D.shock.pts.length - 1];
      P.push(W(side, [last[0] + Lfar * Math.cos(D.shock.finalAng), last[1] + Lfar * Math.sin(D.shock.finalAng)]));
      for (let i = 0; i < P.length - 1; i++) line(ctx, P[i], P[i + 1], shockCol, 2.6);
    }
    // Mach waves / fans from the surface, stopped where they run into a shock
    const nV = D.verts.length, step = Math.max(1, Math.round(nV / 9));
    D.verts.forEach((v, i) => {
      const spread = v.a1 - v.a2;
      const rays = v.fan && spread > 0.6 * DEG ? [0, 0.25, 0.5, 0.75, 1].map(k => v.a1 + (v.a2 - v.a1) * k) : (i % step === 0 && i > 0 ? [v.a2] : []);
      rays.forEach((a, k) => {
        const L = clipRay(D, v.x, v.y, a, 2.5), edge = rays.length === 1 || k === 0 || k === rays.length - 1;
        g.globalAlpha = rays.length === 1 ? 0.35 : edge ? 0.95 : 0.45;
        line(ctx, W(side, [v.x, v.y]), W(side, [v.x + L * Math.cos(a), v.y + L * Math.sin(a)]), fanCol, edge && rays.length > 1 ? 1.2 : 0.7);
        g.globalAlpha = 1;
      });
    });
    // trailing-edge wave (stopped at the leading-edge shock if it catches up with it)
    const t = D.te, o = W(side, [t.x, t.y]);
    if (t.type === 'shock') { const L = clipRay(D, t.x, t.y, t.ray, Lfar, { te: false }); line(ctx, o, W(side, [t.x + L * Math.cos(t.ray), t.y + L * Math.sin(t.ray)]), shockCol, thick ? 2.6 : 1.8); }
    else if (t.type === 'fan') for (let k = 0; k < 5; k++) {
      const a = t.a1 + (t.a2 - t.a1) * k / 4, L = clipRay(D, t.x, t.y, a, 2.5, { te: false }); g.globalAlpha = k === 0 || k === 4 ? 0.9 : 0.4;
      line(ctx, o, W(side, [t.x + L * Math.cos(a), t.y + L * Math.sin(a)]), fanCol, 0.8); g.globalAlpha = 1;
    }
  }
  // slip line
  const te = R.upperW[R.upperW.length - 1];
  line(ctx, { x: te[0], y: te[1] }, { x: te[0] + 3 * Math.cos(R.delta), y: te[1] + 3 * Math.sin(R.delta) }, ctx.fieldOn || ctx.dark ? 'rgba(255,255,255,0.7)' : '#555', 1.1, [6, 4]);
}
