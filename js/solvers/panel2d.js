// Inviscid 2-D panel method for several bodies, optionally above a ground plane. No DOM.
//
// Method (Hess–Smith): each body outline is split into straight panels carrying a constant source strength,
// and each lifting body also carries one uniform vortex strength over all its panels. Unknowns are found from
// "no flow through any panel" (at each panel midpoint) plus, for each lifting body, the Kutta condition (equal
// speeds leaving the upper and lower sides at the sharp trailing edge). Non-lifting bodies (car bodies, fuselages)
// get no vortex, so carry no circulation.
// Ground effect uses the method of images: every panel has a mirror image below y = 0, so the ground is a
// streamline. With no boundary layer on it, this is the same as a moving ground (a rolling road).
//
// Units: free-stream speed 1 at angle `alpha` (radians). Pressure coefficient Cp = 1 − |V|². Forces are per unit
// span and per unit dynamic pressure (so multiply by ½ρV² for newtons per metre of span).
//
// bodies: [{ pts: [[x, y], …] closed polygon (no repeated last point), lifting: bool }]
//   lifting bodies must start at their sharp trailing edge (first panel leaves the TE along one surface,
//   last panel returns to it along the other), like nacaPoints() in js/modules/cfd/shapes.js.
import { luFactor, luSolve } from '../lib/linalg.js';

const TWO_PI = 2 * Math.PI;

function signedArea(P) { let a = 0; for (let i = 0, j = P.length - 1; i < P.length; j = i++) a += (P[j][0] - P[i][0]) * (P[j][1] + P[i][1]); return a / 2; }

// Panels with counter-clockwise ordering (outward normal on the right of the direction of travel).
function makePanels(bodies) {
  const panels = [], ranges = [];
  bodies.forEach((b, bi) => {
    let P = b.pts.map(p => [p[0], p[1]]);
    if (signedArea(P) < 0) { // clockwise: reverse but keep the first point (the trailing edge) first
      P = [P[0], ...P.slice(1).reverse()];
    }
    const start = panels.length;
    for (let i = 0; i < P.length; i++) {
      const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % P.length];
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 1e-12) continue;
      const tx = (x2 - x1) / len, ty = (y2 - y1) / len;
      panels.push({ x1, y1, x2, y2, len, tx, ty, nx: ty, ny: -tx, mx: (x1 + x2) / 2, my: (y1 + y2) / 2, body: bi });
    }
    ranges.push([start, panels.length]);
  });
  return { panels, ranges };
}

// Velocity at (px, py) from panel p carrying source strength q and vortex strength g (counter-clockwise
// positive), both per unit length. `self` = the point is this panel's own midpoint (outer side).
function panelVel(p, px, py, q, g, self) {
  const dx = px - p.x1, dy = py - p.y1;
  const xl = dx * p.tx + dy * p.ty, yl = dx * p.nx + dy * p.ny;   // local coordinates
  let lnr, dth;
  if (self) { lnr = 0; dth = Math.PI; }
  else {
    const L = p.len, r1 = xl * xl + yl * yl, r2 = (xl - L) * (xl - L) + yl * yl;
    lnr = 0.5 * Math.log(r1 / r2);
    dth = Math.atan2(yl * L, xl * (xl - L) + yl * yl);
  }
  const u = (q * lnr - g * dth) / TWO_PI, v = (q * dth + g * lnr) / TWO_PI;
  return [u * p.tx + v * p.nx, u * p.ty + v * p.ny];
}

export function solvePanels(bodies, { ground = false, alpha = 0 } = {}) {
  const { panels, ranges } = makePanels(bodies);
  const N = panels.length;
  const lift = []; bodies.forEach((b, i) => { if (b.lifting) lift.push(i); });
  const M = N + lift.length;
  const Vinf = [Math.cos(alpha), Math.sin(alpha)];
  const gIndex = new Int32Array(bodies.length).fill(-1); lift.forEach((b, k) => { gIndex[b] = N + k; });

  // influence of each unknown on the velocity at each panel midpoint: normal (An) and tangential (At)
  const An = new Float64Array(N * M), At = new Float64Array(N * M);
  for (let i = 0; i < N; i++) {
    const pi = panels[i];
    for (let j = 0; j < N; j++) {
      const pj = panels[j];
      let [su, sv] = panelVel(pj, pi.mx, pi.my, 1, 0, i === j);
      let [wu, wv] = panelVel(pj, pi.mx, pi.my, 0, 1, i === j);
      if (ground) { // image below the ground: the mirror of the field at the mirrored point
        const [a, b] = panelVel(pj, pi.mx, -pi.my, 1, 0, false), [c, d] = panelVel(pj, pi.mx, -pi.my, 0, 1, false);
        su += a; sv -= b; wu += c; wv -= d;
      }
      An[i * M + j] = su * pi.nx + sv * pi.ny; At[i * M + j] = su * pi.tx + sv * pi.ty;
      const k = gIndex[pj.body];
      if (k >= 0) { An[i * M + k] += wu * pi.nx + wv * pi.ny; At[i * M + k] += wu * pi.tx + wv * pi.ty; }
    }
  }
  // free stream with its image (the mirror of a uniform horizontal stream is itself; with alpha ≠ 0 near the
  // ground the vertical part is not allowed, so ground runs use alpha = 0 and tilt the bodies instead)
  const A = new Float64Array(M * M), rhs = new Float64Array(M);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < M; j++) A[i * M + j] = An[i * M + j];
    rhs[i] = -(Vinf[0] * panels[i].nx + Vinf[1] * panels[i].ny);
  }
  lift.forEach((b, k) => { // Kutta: tangential velocities on the first and last panels cancel
    const [s, e] = ranges[b], r = N + k, f = s, l = e - 1;
    for (let j = 0; j < M; j++) A[r * M + j] = At[f * M + j] + At[l * M + j];
    rhs[r] = -(Vinf[0] * (panels[f].tx + panels[l].tx) + Vinf[1] * (panels[f].ty + panels[l].ty));
  });
  const x = luSolve(luFactor(A, M), rhs);

  const q = x.subarray(0, N), gamma = bodies.map((_, b) => (gIndex[b] >= 0 ? x[gIndex[b]] : 0));
  const Vt = new Float64Array(N), Cp = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let v = Vinf[0] * panels[i].tx + Vinf[1] * panels[i].ty;
    for (let j = 0; j < M; j++) v += At[i * M + j] * x[j];
    Vt[i] = v; Cp[i] = 1 - v * v;
  }
  // forces on each body (per unit dynamic pressure and span): F = −∮ Cp n dl; x of the vertical force's centre
  const forces = bodies.map((_, b) => {
    const [s, e] = ranges[b]; let fx = 0, fy = 0, m = 0;
    for (let i = s; i < e; i++) { const p = panels[i], c = -Cp[i] * p.len; fx += c * p.nx; fy += c * p.ny; m += c * p.ny * p.mx; }
    return { fx, fy, xcp: Math.abs(fy) > 1e-12 ? m / fy : NaN, gamma: gamma[b] };
  });

  // velocity anywhere in the flow (inside bodies is meaningless; use inside() to mask)
  const strength = panels.map((p, j) => [q[j], gamma[p.body]]);
  function velocity(px, py) {
    let u = Vinf[0], v = Vinf[1];
    for (let j = 0; j < N; j++) {
      const p = panels[j], [qs, g] = strength[j];
      const a = panelVel(p, px, py, qs, g, false); u += a[0]; v += a[1];
      if (ground) { const b = panelVel(p, px, -py, qs, g, false); u += b[0]; v -= b[1]; }
    }
    return [u, v];
  }
  const polys = bodies.map(b => b.pts);
  function inside(px, py) {
    if (ground && py < 0) return true;
    for (const P of polys) {
      let c = false;
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
        const [xi, yi] = P[i], [xj, yj] = P[j];
        if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) c = !c;
      }
      if (c) return true;
    }
    return false;
  }
  // velocity on a GX × GY grid of cell centres over [x0, x1] × [y0, y1] (fast version of velocity());
  // mask = 1 inside bodies or below the ground
  function grid(x0, x1, y0, y1, GX, GY) {
    const n = GX * GY, U = new Float32Array(n), V = new Float32Array(n), mask = new Uint8Array(n);
    const X1 = new Float64Array(N), Y1 = new Float64Array(N), TX = new Float64Array(N), TY = new Float64Array(N), L = new Float64Array(N), QS = new Float64Array(N), G = new Float64Array(N);
    for (let j = 0; j < N; j++) { const p = panels[j]; X1[j] = p.x1; Y1[j] = p.y1; TX[j] = p.tx; TY[j] = p.ty; L[j] = p.len; QS[j] = q[j]; G[j] = gamma[p.body]; }
    const k2 = 1 / TWO_PI;
    const add = (px, py, out) => { // velocity induced by all panels at (px, py), added to out[0..1]
      let u = 0, v = 0;
      for (let j = 0; j < N; j++) {
        const dx = px - X1[j], dy = py - Y1[j], tx = TX[j], ty = TY[j], Lj = L[j];
        const xl = dx * tx + dy * ty, yl = dx * ty - dy * tx;
        const r1 = xl * xl + yl * yl, r2 = (xl - Lj) * (xl - Lj) + yl * yl;
        const lnr = 0.5 * Math.log(r1 / r2), dth = Math.atan2(yl * Lj, xl * (xl - Lj) + yl * yl);
        const ul = (QS[j] * lnr - G[j] * dth) * k2, vl = (QS[j] * dth + G[j] * lnr) * k2;
        u += ul * tx + vl * ty; v += ul * ty - vl * tx;
      }
      out[0] = u; out[1] = v;
    };
    const a = [0, 0], b = [0, 0];
    for (let gy = 0; gy < GY; gy++) {
      const py = y0 + (gy + 0.5) / GY * (y1 - y0);
      for (let gx = 0; gx < GX; gx++) {
        const px = x0 + (gx + 0.5) / GX * (x1 - x0), k = gy * GX + gx;
        if (inside(px, py)) { mask[k] = 1; continue; }
        add(px, py, a); let u = Vinf[0] + a[0], v = Vinf[1] + a[1];
        if (ground) { add(px, -py, b); u += b[0]; v -= b[1]; }
        U[k] = u; V[k] = v;
      }
    }
    return { U, V, mask, GX, GY, x0, x1, y0, y1 };
  }
  return { panels, ranges, q, gamma, Vt, Cp, forces, velocity, inside, grid, N };
}

// Resample a closed outline so panel lengths follow spacing(x, y) (e.g. finer near the ground). Corners
// (direction changes over `cornerDeg`) are kept. Returns a new point list starting at the same first point.
export function resample(P, spacing, cornerDeg = 25) {
  const n = P.length, keep = [];
  for (let i = 0; i < n; i++) {
    const a = P[(i - 1 + n) % n], b = P[i], c = P[(i + 1) % n];
    const t1 = Math.atan2(b[1] - a[1], b[0] - a[0]), t2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
    let d = Math.abs(t2 - t1); if (d > Math.PI) d = 2 * Math.PI - d;
    if (i === 0 || d * 180 / Math.PI > cornerDeg) keep.push(i);
  }
  const out = [];
  for (let k = 0; k < keep.length; k++) {
    const i0 = keep[k], i1 = keep[(k + 1) % keep.length], seg = [];
    for (let i = i0; ; i = (i + 1) % n) { seg.push(P[i]); if (i === i1 && seg.length > 1) break; if (seg.length > n + 1) break; }
    // walk along this run of points placing new points at the local spacing
    const cum = [0]; for (let i = 1; i < seg.length; i++) cum.push(cum[i - 1] + Math.hypot(seg[i][0] - seg[i - 1][0], seg[i][1] - seg[i - 1][1]));
    const total = cum[cum.length - 1];
    const at = s => { let i = 1; while (i < cum.length - 1 && cum[i] < s) i++; const t = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1); return [seg[i - 1][0] + t * (seg[i][0] - seg[i - 1][0]), seg[i - 1][1] + t * (seg[i][1] - seg[i - 1][1])]; };
    const pts = [0]; let s = 0;
    while (s < total) { const p = at(s); s += Math.max(1e-6, spacing(p[0], p[1])); if (s < total - 0.3 * spacing(p[0], p[1])) pts.push(s); }
    for (const sv of pts) out.push(at(sv));
  }
  return out;
}
