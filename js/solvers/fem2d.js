// 2-D linear elasticity by finite elements: automatic triangular meshing of a region bounded by
// lines and arcs (with holes), 6-node quadratic triangles (plane stress or plane strain), boundary
// conditions per boundary curve, a sparse (skyline) Cholesky solve with reverse Cuthill–McKee
// ordering, and averaged nodal stresses. No DOM: runs in a worker or on the main thread. SI units.
//
// Geometry: { loops: [{ hole: bool, curves: [curve, ...] }] }, curves join end to start, each
//   curve = { id, kind: 'line', p0: [x, y], p1: [x, y] } | { id, kind: 'arc', c: [x, y], r, a0, a1 } (radians)
// Boundary conditions (per curve id), all forces per unit length already include the thickness:
//   { type: 'free' } | { type: 'fixed' } | { type: 'roller' } (no motion normal to the curve)
//   | { type: 'rollerX' } | { type: 'rollerY' } | { type: 'pressure', p } (stress, + pushes on the surface)
//   | { type: 'force', fx, fy } (total force spread uniformly) | { type: 'bearing', F, angle } (pin load on a hole, cosine)
//   | { type: 'shear', q } (tangential traction, stress)

// ---------------------------------------------------------------- curves
export function curvePoint(c, t) {
  if (c.kind === 'line') return [c.p0[0] + (c.p1[0] - c.p0[0]) * t, c.p0[1] + (c.p1[1] - c.p0[1]) * t];
  const a = c.a0 + (c.a1 - c.a0) * t; return [c.c[0] + c.r * Math.cos(a), c.c[1] + c.r * Math.sin(a)];
}
export function curveLength(c) { return c.kind === 'line' ? Math.hypot(c.p1[0] - c.p0[0], c.p1[1] - c.p0[1]) : c.r * Math.abs(c.a1 - c.a0); }
function distToCurve(c, x, y) {
  if (c.kind === 'line') return segDist(c.p0[0], c.p0[1], c.p1[0], c.p1[1], x, y);
  const dx = x - c.c[0], dy = y - c.c[1], d = Math.hypot(dx, dy);
  let a = Math.atan2(dy, dx);
  const lo = Math.min(c.a0, c.a1), hi = Math.max(c.a0, c.a1);
  while (a < lo) a += 2 * Math.PI; while (a > lo + 2 * Math.PI) a -= 2 * Math.PI;
  if (a <= hi) return Math.abs(d - c.r);
  const e0 = curvePoint(c, 0), e1 = curvePoint(c, 1);
  return Math.min(Math.hypot(x - e0[0], y - e0[1]), Math.hypot(x - e1[0], y - e1[1]));
}
function segDist(ax, ay, bx, by, x, y) {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  let t = L2 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(ax + dx * t - x, ay + dy * t - y);
}

// ---------------------------------------------------------------- size function
function sizeField(geom, opts) {
  const { hmax, circ = 40, grad = 0.25 } = opts;
  const feats = [];
  const all = geom.loops.flatMap(l => l.curves);
  for (const c of all) if (c.kind === 'arc') feats.push({ c, h: Math.min(hmax, Math.max(hmax / 60, 2 * Math.PI * c.r / circ)) });
  // re-entrant corners between consecutive curves
  for (const loop of geom.loops) {
    const n = loop.curves.length;
    for (let i = 0; i < n; i++) {
      const c0 = loop.curves[i], c1 = loop.curves[(i + 1) % n];
      const p = curvePoint(c1, 0), L = Math.min(curveLength(c0), curveLength(c1)) * 0.02;
      const pa = curvePoint(c0, 1 - L / curveLength(c0)), pb = curvePoint(c1, L / curveLength(c1));
      const mid = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
      const cross = (p[0] - pa[0]) * (pb[1] - p[1]) - (p[1] - pa[1]) * (pb[0] - p[0]);
      if (Math.abs(cross) < 1e-12 * L * L) continue;
      if (!insideLoopsCurves(geom, mid[0], mid[1])) feats.push({ pt: p, h: hmax / 5 });
    }
  }
  if (opts.refine) for (const r of opts.refine) feats.push({ pt: [r.x, r.y], h: r.h });
  return (x, y) => {
    let h = hmax;
    for (const f of feats) {
      const d = f.c ? distToCurve(f.c, x, y) : Math.hypot(x - f.pt[0], y - f.pt[1]);
      const v = f.h + grad * d; if (v < h) h = v;
    }
    return h;
  };
}
// coarse inside test straight from the curves (polygonised finely), used only for corner classification
function insideLoopsCurves(geom, x, y) {
  let inside = false;
  for (const loop of geom.loops) {
    const pts = [];
    for (const c of loop.curves) { const n = c.kind === 'arc' ? 32 : 1; for (let k = 0; k < n; k++) pts.push(curvePoint(c, k / n)); }
    if (pip(pts, x, y)) inside = !inside;
  }
  return inside;
}
function pip(pts, x, y) {
  let ins = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}

// ---------------------------------------------------------------- boundary discretisation
function discretize(geom, hf) {
  const loops = [];
  geom.loops.forEach((loop, li) => {
    const pts = [], tags = []; // tags[k]: curve for edge k → k+1, plus parameter for midpoint refinement
    loop.curves.forEach(c => {
      const M = 160, L = curveLength(c);
      const cum = [0];
      for (let k = 1; k <= M; k++) { const p = curvePoint(c, (k - 0.5) / M); cum.push(cum[k - 1] + (L / M) / hf(p[0], p[1])); }
      let n = Math.max(1, Math.round(cum[M]));
      if (c.kind === 'arc') n = Math.max(n, Math.ceil(Math.abs(c.a1 - c.a0) / (Math.PI / 6)));
      // parameter values with equal increments of ∫ds/h
      let j = 0;
      for (let k = 0; k < n; k++) {
        const target = cum[M] * k / n;
        while (j < M && cum[j + 1] < target) j++;
        const t = (j + (target - cum[j]) / ((cum[j + 1] - cum[j]) || 1)) / M;
        pts.push(curvePoint(c, k === 0 ? 0 : t)); tags.push({ curve: c, t0: k === 0 ? 0 : t, t1: null });
      }
    });
    // fill in end parameters (edge k runs from node k to node k+1)
    for (let k = 0; k < tags.length; k++) { const nx = tags[(k + 1) % tags.length]; tags[k].t1 = nx.curve === tags[k].curve && nx.t0 > tags[k].t0 ? nx.t0 : 1; }
    loops.push({ pts, tags, hole: !!loop.hole, li });
  });
  return loops;
}

// ---------------------------------------------------------------- Delaunay (Bowyer–Watson)
function delaunay(P) {
  const n = P.length / 2;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { x0 = Math.min(x0, P[2 * i]); x1 = Math.max(x1, P[2 * i]); y0 = Math.min(y0, P[2 * i + 1]); y1 = Math.max(y1, P[2 * i + 1]); }
  const d = Math.max(x1 - x0, y1 - y0) * 20, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const X = Float64Array.from([...P, cx - d, cy - d, cx + d, cy - d, cx, cy + d]);
  const s0 = n, s1 = n + 1, s2 = n + 2;
  // triangle storage
  let A = [], B = [], C = [], CX = [], CY = [], R2 = [], alive = [];
  const add = (a, b, c) => {
    const ax = X[2 * a], ay = X[2 * a + 1], bx = X[2 * b], by = X[2 * b + 1], qx = X[2 * c], qy = X[2 * c + 1];
    const D = 2 * (ax * (by - qy) + bx * (qy - ay) + qx * (ay - by));
    const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = qx * qx + qy * qy;
    const ux = (a2 * (by - qy) + b2 * (qy - ay) + c2 * (ay - by)) / D, uy = (a2 * (qx - bx) + b2 * (ax - qx) + c2 * (bx - ax)) / D;
    A.push(a); B.push(b); C.push(c); CX.push(ux); CY.push(uy); R2.push((ax - ux) ** 2 + (ay - uy) ** 2); alive.push(1);
  };
  add(s0, s1, s2);
  // insert in a locality-preserving order (grid snake) so the cavity search stays local
  const order = [...Array(n).keys()];
  const gs = Math.max(1, Math.round(Math.sqrt(n / 4)));
  const key = i => { const gx = Math.floor((X[2 * i] - x0) / ((x1 - x0) || 1) * gs * 0.9999), gy = Math.floor((X[2 * i + 1] - y0) / ((y1 - y0) || 1) * gs * 0.9999); return gy * gs + (gy % 2 ? gs - 1 - gx : gx); };
  order.sort((a, b) => key(a) - key(b));
  let liveIdx = [0];
  for (const p of order) {
    const px = X[2 * p], py = X[2 * p + 1];
    const bad = [];
    const keep = [];
    for (const t of liveIdx) {
      const dx = px - CX[t], dy = py - CY[t];
      if (dx * dx + dy * dy < R2[t] * (1 - 1e-12)) bad.push(t); else keep.push(t);
    }
    // boundary edges of the cavity
    const edges = new Map();
    for (const t of bad) {
      for (const [u, v] of [[A[t], B[t]], [B[t], C[t]], [C[t], A[t]]]) {
        const k = u < v ? u * 1e7 + v : v * 1e7 + u;
        if (edges.has(k)) edges.delete(k); else edges.set(k, [u, v]);
      }
      alive[t] = 0;
    }
    liveIdx = keep;
    for (const [u, v] of edges.values()) { add(u, v, p); liveIdx.push(A.length - 1); }
  }
  const tris = [];
  for (const t of liveIdx) if (A[t] < n && B[t] < n && C[t] < n) tris.push(A[t], B[t], C[t]);
  return tris;
}

// ---------------------------------------------------------------- mesh
export function meshRegion(geom, opts = {}) {
  const bb = bbox(geom), size = Math.max(bb.w, bb.h);
  const hmax = opts.hmax || size / 12;
  const hf = sizeField(geom, { ...opts, hmax });
  let loops = discretize(geom, hf);
  // interior points from a quadtree graded by the size function
  const interior = [];
  const rnd = mulberry(12345);
  const segs = () => loops.flatMap(l => l.pts.map((p, k) => { const q = l.pts[(k + 1) % l.pts.length]; return [p[0], p[1], q[0], q[1]]; }));
  let S = segs();
  const polyLoops = () => loops.map(l => l.pts);
  const inside = (x, y) => { let ins = false; for (const pts of polyLoops()) if (pip(pts, x, y)) ins = !ins; return ins; };
  const bdist = (x, y) => { let d = Infinity; for (const s of S) { const v = segDist(s[0], s[1], s[2], s[3], x, y); if (v < d) d = v; } return d; };
  const root = { x: bb.x0 - 1e-9, y: bb.y0 - 1e-9, s: size * 1.0001 };
  const stack = [root];
  let guard = 0;
  while (stack.length && guard++ < 400000) {
    const c = stack.pop(), mx = c.x + c.s / 2, my = c.y + c.s / 2;
    const h = hf(mx, my);
    if (c.s > h * 1.05) { const s2 = c.s / 2; stack.push({ x: c.x, y: c.y, s: s2 }, { x: c.x + s2, y: c.y, s: s2 }, { x: c.x, y: c.y + s2, s: s2 }, { x: c.x + s2, y: c.y + s2, s: s2 }); continue; }
    // stagger every other row of equal cells so triangles come out closer to equilateral
    const row = Math.round((c.y - root.y) / c.s), sx = row % 2 ? 0.25 * c.s : -0.25 * c.s;
    const px = mx + sx + (rnd() - 0.5) * 1e-3 * c.s, py = my + (rnd() - 0.5) * 1e-3 * c.s;
    if (!inside(px, py)) continue;
    if (bdist(px, py) < 0.6 * hf(px, py)) continue;
    interior.push(px, py);
  }
  // conforming Delaunay: split boundary edges that the triangulation misses, then retry
  let tris, P, nb, bEdges;
  for (let iter = 0; iter < 10; iter++) {
    const bpts = loops.flatMap(l => l.pts);
    nb = bpts.length;
    P = new Float64Array(2 * nb + interior.length);
    bpts.forEach((p, i) => { P[2 * i] = p[0]; P[2 * i + 1] = p[1]; });
    P.set(interior, 2 * nb);
    tris = delaunay(P);
    const have = new Set();
    for (let t = 0; t < tris.length; t += 3) for (const [u, v] of [[tris[t], tris[t + 1]], [tris[t + 1], tris[t + 2]], [tris[t + 2], tris[t]]]) have.add(u < v ? u + ',' + v : v + ',' + u);
    bEdges = []; let off = 0; let missing = 0;
    const newLoops = loops.map(l => {
      const pts = [], tags = [];
      for (let k = 0; k < l.pts.length; k++) {
        const a = off + k, b = off + (k + 1) % l.pts.length;
        pts.push(l.pts[k]); tags.push(l.tags[k]);
        if (!have.has(a < b ? a + ',' + b : b + ',' + a)) {
          missing++;
          const tg = l.tags[k], tm = (tg.t0 + tg.t1) / 2;
          pts.push(curvePoint(tg.curve, tm));
          tags[tags.length - 1] = { curve: tg.curve, t0: tg.t0, t1: tm };
          tags.push({ curve: tg.curve, t0: tm, t1: tg.t1 });
        }
      }
      off += l.pts.length;
      return { ...l, pts, tags };
    });
    if (!missing) break;
    loops = newLoops; S = segs();
    // drop interior points that are now too close to the refined boundary
    const keep = [];
    for (let i = 0; i < interior.length; i += 2) if (bdist(interior[i], interior[i + 1]) >= 0.45 * hf(interior[i], interior[i + 1])) keep.push(interior[i], interior[i + 1]);
    interior.length = 0; interior.push(...keep);
  }
  // keep triangles inside the region, oriented counter-clockwise
  const T = [];
  for (let t = 0; t < tris.length; t += 3) {
    let [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]];
    const gx = (P[2 * a] + P[2 * b] + P[2 * c]) / 3, gy = (P[2 * a + 1] + P[2 * b + 1] + P[2 * c + 1]) / 3;
    if (!inside(gx, gy)) continue;
    const ar = area2(P, a, b, c);
    if (Math.abs(ar) < 1e-14 * size * size) continue;
    if (ar < 0) [b, c] = [c, b];
    T.push(a, b, c);
  }
  // boundary edge records
  let off = 0; bEdges = [];
  for (const l of loops) { for (let k = 0; k < l.pts.length; k++) bEdges.push({ a: off + k, b: off + (k + 1) % l.pts.length, ...l.tags[k] }); off += l.pts.length; }
  // drop unused points and renumber
  const used = new Int32Array(P.length / 2).fill(-1); let nn = 0;
  for (const v of T) if (used[v] < 0) used[v] = nn++;
  const Q = new Float64Array(2 * nn);
  for (let i = 0; i < used.length; i++) if (used[i] >= 0) { Q[2 * used[i]] = P[2 * i]; Q[2 * used[i] + 1] = P[2 * i + 1]; }
  const tri = Int32Array.from(T, v => used[v]);
  bEdges = bEdges.filter(e => used[e.a] >= 0 && used[e.b] >= 0).map(e => ({ ...e, a: used[e.a], b: used[e.b] }));
  const isB = new Uint8Array(nn); for (const e of bEdges) { isB[e.a] = 1; isB[e.b] = 1; }
  smooth(Q, tri, isB, 5);
  return { xy: Q, tri, nCorner: nn, bEdges, hf, hmax, quality: quality(Q, tri) };
}
const area2 = (P, a, b, c) => (P[2 * b] - P[2 * a]) * (P[2 * c + 1] - P[2 * a + 1]) - (P[2 * c] - P[2 * a]) * (P[2 * b + 1] - P[2 * a + 1]);
function bbox(geom) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const l of geom.loops) for (const c of l.curves) for (let k = 0; k <= 16; k++) { const p = curvePoint(c, k / 16); x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function smooth(P, tri, isB, iters) {
  const n = P.length / 2, nb = Array.from({ length: n }, () => new Set()), inc = Array.from({ length: n }, () => []);
  for (let t = 0; t < tri.length; t += 3) for (let k = 0; k < 3; k++) { const a = tri[t + k]; nb[a].add(tri[t + (k + 1) % 3]); nb[a].add(tri[t + (k + 2) % 3]); inc[a].push(t); }
  for (let it = 0; it < iters; it++) for (let i = 0; i < n; i++) {
    if (isB[i] || !nb[i].size) continue;
    let sx = 0, sy = 0; for (const j of nb[i]) { sx += P[2 * j]; sy += P[2 * j + 1]; }
    const ox = P[2 * i], oy = P[2 * i + 1];
    P[2 * i] = sx / nb[i].size; P[2 * i + 1] = sy / nb[i].size;
    if (inc[i].some(t => area2(P, tri[t], tri[t + 1], tri[t + 2]) <= 0)) { P[2 * i] = ox; P[2 * i + 1] = oy; }
  }
}
function quality(P, tri) {
  let qmin = 1, qsum = 0;
  for (let t = 0; t < tri.length; t += 3) {
    const [a, b, c] = [tri[t], tri[t + 1], tri[t + 2]], A = area2(P, a, b, c) / 2;
    const l2 = (u, v) => (P[2 * u] - P[2 * v]) ** 2 + (P[2 * u + 1] - P[2 * v + 1]) ** 2;
    const q = 4 * Math.sqrt(3) * A / (l2(a, b) + l2(b, c) + l2(c, a));
    qmin = Math.min(qmin, q); qsum += q;
  }
  return { min: qmin, avg: qsum / (tri.length / 3) };
}

// ---------------------------------------------------------------- quadratic triangles
// 6-node elements: corners 0,1,2 then mid-edges 3 (0-1), 4 (1-2), 5 (2-0). Mid-nodes on arcs sit on the arc.
export function toQuadratic(m) {
  const nc = m.nCorner, xy = Array.from(m.xy), mid = new Map(), ne = m.tri.length / 3;
  const el = new Int32Array(ne * 6);
  const bmap = new Map(); for (const e of m.bEdges) bmap.set(e.a < e.b ? e.a + ',' + e.b : e.b + ',' + e.a, e);
  const midNode = (a, b) => {
    const k = a < b ? a + ',' + b : b + ',' + a;
    if (mid.has(k)) return mid.get(k);
    let x = (xy[2 * a] + xy[2 * b]) / 2, y = (xy[2 * a + 1] + xy[2 * b + 1]) / 2;
    const be = bmap.get(k);
    if (be && be.curve.kind === 'arc') { const p = curvePoint(be.curve, (be.t0 + be.t1) / 2); x = p[0]; y = p[1]; }
    const id = xy.length / 2; xy.push(x, y); mid.set(k, id);
    if (be) be.m = id;
    return id;
  };
  for (let e = 0; e < ne; e++) {
    const [a, b, c] = [m.tri[3 * e], m.tri[3 * e + 1], m.tri[3 * e + 2]];
    el.set([a, b, c, midNode(a, b), midNode(b, c), midNode(c, a)], 6 * e);
  }
  return { ...m, xy: Float64Array.from(xy), el, nNodes: xy.length / 2, nc };
}

const GP3 = [[1 / 6, 1 / 6, 1 / 6], [2 / 3, 1 / 6, 1 / 6], [1 / 6, 2 / 3, 1 / 6]];
function shapeDeriv(xi, et) {
  const L1 = 1 - xi - et, L2 = xi, L3 = et;
  return {
    N: [L1 * (2 * L1 - 1), L2 * (2 * L2 - 1), L3 * (2 * L3 - 1), 4 * L1 * L2, 4 * L2 * L3, 4 * L3 * L1],
    dx: [-(4 * L1 - 1), 4 * L2 - 1, 0, 4 * (L1 - L2), 4 * L3, -4 * L3],
    de: [-(4 * L1 - 1), 0, 4 * L3 - 1, -4 * L2, 4 * L2, 4 * (L1 - L3)],
  };
}
function Bmat(X, Y, xi, et) {
  const { N, dx, de } = shapeDeriv(xi, et);
  let j11 = 0, j12 = 0, j21 = 0, j22 = 0;
  for (let i = 0; i < 6; i++) { j11 += dx[i] * X[i]; j12 += dx[i] * Y[i]; j21 += de[i] * X[i]; j22 += de[i] * Y[i]; }
  const det = j11 * j22 - j12 * j21, i11 = j22 / det, i12 = -j12 / det, i21 = -j21 / det, i22 = j11 / det;
  const Nx = new Float64Array(6), Ny = new Float64Array(6);
  for (let i = 0; i < 6; i++) { Nx[i] = i11 * dx[i] + i12 * de[i]; Ny[i] = i21 * dx[i] + i22 * de[i]; }
  return { N, Nx, Ny, det };
}
function Dmat(E, nu, plane) {
  if (plane === 'strain') { const f = E / ((1 + nu) * (1 - 2 * nu)); return [[f * (1 - nu), f * nu, 0], [f * nu, f * (1 - nu), 0], [0, 0, f * (1 - 2 * nu) / 2]]; }
  const f = E / (1 - nu * nu); return [[f, f * nu, 0], [f * nu, f, 0], [0, 0, f * (1 - nu) / 2]];
}

// ---------------------------------------------------------------- RCM ordering + skyline Cholesky
function rcm(n, el) {
  const adj = Array.from({ length: n }, () => new Set());
  for (let e = 0; e < el.length; e += 6) for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) if (i !== j) adj[el[e + i]].add(el[e + j]);
  const deg = adj.map(s => s.size), seen = new Uint8Array(n), order = [];
  const bfs = s => { const lv = [s]; const mark = new Uint8Array(n); mark[s] = 1; let last = s, q = 0; while (q < lv.length) { const u = lv[q++]; last = u; for (const v of adj[u]) if (!mark[v]) { mark[v] = 1; lv.push(v); } } return last; };
  for (let s0 = 0; s0 < n; s0++) {
    if (seen[s0]) continue;
    let s = s0; for (let k = 0; k < 2; k++) s = bfs(s); // pseudo-peripheral start
    const q = [s]; seen[s] = 1;
    for (let h = 0; h < q.length; h++) {
      const u = q[h]; order.push(u);
      const nb = [...adj[u]].filter(v => !seen[v]).sort((a, b) => deg[a] - deg[b]);
      for (const v of nb) { seen[v] = 1; q.push(v); }
    }
  }
  order.reverse();
  const perm = new Int32Array(n); order.forEach((u, i) => { perm[u] = i; });
  return perm;
}
class Skyline {
  constructor(n, first) {
    this.n = n; this.first = first; this.start = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) this.start[i + 1] = this.start[i] + (i - first[i] + 1);
    this.a = new Float64Array(this.start[n]);
  }
  add(i, j, v) { if (j > i) [i, j] = [j, i]; this.a[this.start[i] + j - this.first[i]] += v; }
  get(i, j) { return this.a[this.start[i] + j - this.first[i]]; }
  factor() {
    const { n, first, start, a } = this;
    for (let i = 0; i < n; i++) {
      const fi = first[i], si = start[i] - fi;
      for (let j = fi; j <= i; j++) {
        const fj = first[j], sj = start[j] - fj, k0 = Math.max(fi, fj);
        let s = a[si + j];
        for (let k = k0; k < j; k++) s -= a[si + k] * a[sj + k];
        if (j < i) a[si + j] = s / a[sj + j];
        else { if (!(s > 0)) return { fail: i }; a[si + i] = Math.sqrt(s); }
      }
    }
    return {};
  }
  solve(b) {
    const { n, first, start, a } = this, x = Float64Array.from(b);
    for (let i = 0; i < n; i++) { const fi = first[i], si = start[i] - fi; let s = x[i]; for (let k = fi; k < i; k++) s -= a[si + k] * x[k]; x[i] = s / a[si + i]; }
    for (let i = n - 1; i >= 0; i--) { const fi = first[i], si = start[i] - fi; x[i] /= a[si + i]; const xi = x[i]; for (let k = fi; k < i; k++) x[k] -= a[si + k] * xi; }
    return x;
  }
}

// ---------------------------------------------------------------- solve
export function solvePlate(spec) {
  const t0 = now();
  const { geom, E, nu, thickness: th = 0.01, plane = 'stress', bcs = {}, mesh: mopts = {} } = spec;
  const m1 = meshRegion(geom, mopts);
  const tMesh = now();
  const M = toQuadratic(m1), n = M.nNodes, ne = M.el.length / 6, X = M.xy;
  const D = Dmat(E, nu, plane);
  const perm = rcm(n, M.el), dof = (node, k) => 2 * perm[node] + k, N = 2 * n;
  // skyline profile
  const first = new Int32Array(N).fill(N);
  for (let e = 0; e < ne; e++) {
    let mn = N; for (let i = 0; i < 6; i++) mn = Math.min(mn, dof(M.el[6 * e + i], 0));
    for (let i = 0; i < 6; i++) for (let k = 0; k < 2; k++) { const d = dof(M.el[6 * e + i], k); if (mn < first[d]) first[d] = mn; }
  }
  for (let d = 0; d < N; d++) if (first[d] > d) first[d] = d;
  const K = new Skyline(N, first);
  const Xe = new Float64Array(6), Ye = new Float64Array(6), ke = new Float64Array(144);
  let area = 0;
  for (let e = 0; e < ne; e++) {
    for (let i = 0; i < 6; i++) { Xe[i] = X[2 * M.el[6 * e + i]]; Ye[i] = X[2 * M.el[6 * e + i] + 1]; }
    ke.fill(0);
    for (const [xi, et, w] of GP3) {
      const { Nx, Ny, det } = Bmat(Xe, Ye, xi, et), f = w * det * th;
      area += w * det;
      // ke += Bᵀ D B f, B columns: node i → (u: [Nx,0,Ny], v: [0,Ny,Nx])
      for (let i = 0; i < 6; i++) for (let a = 0; a < 2; a++) {
        const bi = a === 0 ? [Nx[i], 0, Ny[i]] : [0, Ny[i], Nx[i]];
        const db = [D[0][0] * bi[0] + D[0][1] * bi[1], D[1][0] * bi[0] + D[1][1] * bi[1], D[2][2] * bi[2]];
        for (let j = 0; j < 6; j++) {
          ke[(2 * i + a) * 12 + 2 * j] += (db[0] * Nx[j] + db[2] * Ny[j]) * f;
          ke[(2 * i + a) * 12 + 2 * j + 1] += (db[1] * Ny[j] + db[2] * Nx[j]) * f;
        }
      }
    }
    for (let p = 0; p < 12; p++) { const dp = dof(M.el[6 * e + (p >> 1)], p & 1); for (let q = 0; q <= p; q++) { const dq = dof(M.el[6 * e + (q >> 1)], q & 1); K.add(dp, dq, ke[p * 12 + q]); } }
  }
  // loads and constraints per boundary edge (3 nodes a, m, b)
  const F = new Float64Array(N);
  let maxDiag = 0; for (let d = 0; d < N; d++) maxDiag = Math.max(maxDiag, K.get(d, d));
  const kp = 1e7 * maxDiag;
  const curveLen = new Map();
  M.bEdges = M.bEdges.filter(e => e.m !== undefined);
  for (const e of M.bEdges) curveLen.set(e.curve.id, (curveLen.get(e.curve.id) || 0) + edgeLength(X, e));
  const constrained = []; // {node, nx, ny} directions with penalty
  const cons = new Map();
  const constrain = (node, nx, ny, curve) => { const k = node + ':' + nx.toFixed(6) + ':' + ny.toFixed(6); if (cons.has(k)) return; cons.set(k, 1); constrained.push({ node, nx, ny, curve }); };
  const insideMesh = (x, y) => pointInMesh(m1, x, y);
  for (const e of M.bEdges) {
    const bc = bcs[e.curve.id]; if (!bc || bc.type === 'free') continue;
    const nodes = [e.a, e.m, e.b];
    // outward normal of the domain at the edge midpoint
    const ax = X[2 * e.a], ay = X[2 * e.a + 1], bx = X[2 * e.b], by = X[2 * e.b + 1];
    let nx = by - ay, ny = -(bx - ax); const L = Math.hypot(nx, ny); nx /= L; ny /= L;
    const mx = X[2 * e.m], my = X[2 * e.m + 1], eps = 1e-3 * L;
    if (insideMesh(mx + nx * eps, my + ny * eps)) { nx = -nx; ny = -ny; }
    if (bc.type === 'fixed') { for (const v of nodes) { constrain(v, 1, 0, e.curve.id); constrain(v, 0, 1, e.curve.id); } continue; }
    if (bc.type === 'rollerX') { for (const v of nodes) constrain(v, 1, 0, e.curve.id); continue; }
    if (bc.type === 'rollerY') { for (const v of nodes) constrain(v, 0, 1, e.curve.id); continue; }
    if (bc.type === 'roller') {
      // normal at each node (exact for arcs)
      for (const v of nodes) {
        let qx = nx, qy = ny;
        if (e.curve.kind === 'arc') { const dx = X[2 * v] - e.curve.c[0], dy = X[2 * v + 1] - e.curve.c[1], d = Math.hypot(dx, dy), s = Math.sign(dx * nx + dy * ny) || 1; qx = s * dx / d; qy = s * dy / d; }
        constrain(v, qx, qy, e.curve.id);
      }
      continue;
    }
    // tractions (force per length) integrated with 3-point Gauss on the quadratic edge
    const pts = nodes.map(v => [X[2 * v], X[2 * v + 1]]);
    for (const [g, w] of [[-Math.sqrt(0.6), 5 / 9], [0, 8 / 9], [Math.sqrt(0.6), 5 / 9]]) {
      const Na = g * (g - 1) / 2, Nm = 1 - g * g, Nb = g * (g + 1) / 2, dNa = g - 0.5, dNm = -2 * g, dNb = g + 0.5;
      const x = Na * pts[0][0] + Nm * pts[1][0] + Nb * pts[2][0], y = Na * pts[0][1] + Nm * pts[1][1] + Nb * pts[2][1];
      const tx = dNa * pts[0][0] + dNm * pts[1][0] + dNb * pts[2][0], ty = dNa * pts[0][1] + dNm * pts[1][1] + dNb * pts[2][1];
      const J = Math.hypot(tx, ty);
      let onx = ty / J, ony = -tx / J; if (onx * nx + ony * ny < 0) { onx = -onx; ony = -ony; }
      let fx = 0, fy = 0;
      if (bc.type === 'pressure') { fx = -bc.p * th * onx; fy = -bc.p * th * ony; }
      else if (bc.type === 'shear') { fx = bc.q * th * (-ony); fy = bc.q * th * onx; }
      else if (bc.type === 'force') { const Lc = curveLen.get(e.curve.id); fx = (bc.fx || 0) / Lc; fy = (bc.fy || 0) / Lc; }
      else if (bc.type === 'bearing' && e.curve.kind === 'arc') {
        const c = e.curve.c, r = e.curve.r, phi = Math.atan2(y - c[1], x - c[0]), th0 = bc.angle * Math.PI / 180;
        const cs = Math.cos(phi - th0);
        if (cs > 0) { const p0 = 2 * bc.F / (Math.PI * r); fx = p0 * cs * Math.cos(phi); fy = p0 * cs * Math.sin(phi); }
      }
      const f = w * J;
      [[Na, 0], [Nm, 1], [Nb, 2]].forEach(([Ni, k]) => { F[dof(nodes[k], 0)] += Ni * fx * f; F[dof(nodes[k], 1)] += Ni * fy * f; });
    }
  }
  for (const c of constrained) {
    const du = dof(c.node, 0), dv = dof(c.node, 1);
    K.add(du, du, kp * c.nx * c.nx); K.add(dv, dv, kp * c.ny * c.ny); K.add(dv, du, kp * c.nx * c.ny);
  }
  // weak springs remove rigid-body modes left by roller-only supports (negligible otherwise)
  const ks = 1e-9 * maxDiag; for (let d = 0; d < N; d++) K.add(d, d, ks);
  const tAsm = now();
  const fr = K.factor();
  if (fr.fail !== undefined) return { ok: false, error: 'singular' };
  const U = K.solve(F);
  const tSolve = now();
  // unpermute
  const u = new Float64Array(N);
  for (let i = 0; i < n; i++) { u[2 * i] = U[dof(i, 0)]; u[2 * i + 1] = U[dof(i, 1)]; }
  // rigid-body check: soft springs carrying load means the supports did not restrain it
  // net force the weak springs carry: ≈ 0 when the supports (or a balanced load set) hold the part
  let sx = 0, sy = 0, Ftot = 0, smom = 0;
  for (let i = 0; i < n; i++) { const fx = ks * U[dof(i, 0)], fy = ks * U[dof(i, 1)]; sx += fx; sy += fy; smom += X[2 * i] * fy - X[2 * i + 1] * fx; Ftot += Math.hypot(F[dof(i, 0)], F[dof(i, 1)]); }
  const unrestrained = Math.hypot(sx, sy) > 0.05 * (Ftot || 1);
  const noSupports = !constrained.length;
  // reactions per curve
  const reactions = {};
  for (const c of constrained) {
    const val = -kp * (c.nx * u[2 * c.node] + c.ny * u[2 * c.node + 1]);
    const r = reactions[c.curve] || (reactions[c.curve] = { fx: 0, fy: 0 });
    r.fx += val * c.nx; r.fy += val * c.ny;
  }
  let Fx = 0, Fy = 0; for (let i = 0; i < n; i++) { Fx += F[dof(i, 0)]; Fy += F[dof(i, 1)]; }
  // nodal stresses (averaged)
  const S = stresses(M, u, D, nu, plane);
  const out = { ok: true, mesh: M, u, ...S, reactions, load: { fx: Fx, fy: Fy }, area, thickness: th, unrestrained, noSupports, plane, nu, E,
    stats: { nodes: n, elements: ne, dofs: N, band: K.start[N] / N, tMesh: tMesh - t0, tAsm: tAsm - tMesh, tSolve: tSolve - tAsm, quality: m1.quality } };
  return out;
}
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
function edgeLength(X, e) {
  const p = [e.a, e.m, e.b].map(v => [X[2 * v], X[2 * v + 1]]);
  let L = 0; for (const [g, w] of [[-Math.sqrt(0.6), 5 / 9], [0, 8 / 9], [Math.sqrt(0.6), 5 / 9]]) { const tx = (g - 0.5) * p[0][0] - 2 * g * p[1][0] + (g + 0.5) * p[2][0], ty = (g - 0.5) * p[0][1] - 2 * g * p[1][1] + (g + 0.5) * p[2][1]; L += w * Math.hypot(tx, ty); }
  return L;
}
function pointInMesh(m, x, y) {
  const P = m.xy, T = m.tri;
  for (let t = 0; t < T.length; t += 3) {
    const a = T[t], b = T[t + 1], c = T[t + 2];
    const d1 = (P[2 * b] - P[2 * a]) * (y - P[2 * a + 1]) - (P[2 * b + 1] - P[2 * a + 1]) * (x - P[2 * a]);
    const d2 = (P[2 * c] - P[2 * b]) * (y - P[2 * b + 1]) - (P[2 * c + 1] - P[2 * b + 1]) * (x - P[2 * b]);
    const d3 = (P[2 * a] - P[2 * c]) * (y - P[2 * c + 1]) - (P[2 * a + 1] - P[2 * c + 1]) * (x - P[2 * c]);
    if (d1 >= 0 && d2 >= 0 && d3 >= 0) return true;
  }
  return false;
}

const LOCAL = [[0, 0], [1, 0], [0, 1], [0.5, 0], [0.5, 0.5], [0, 0.5]];
function stresses(M, u, D, nu, plane) {
  const n = M.nNodes, ne = M.el.length / 6, X = M.xy;
  const sx = new Float64Array(n), sy = new Float64Array(n), txy = new Float64Array(n), cnt = new Float64Array(n);
  const Xe = new Float64Array(6), Ye = new Float64Array(6), ue = new Float64Array(12);
  const elemVM = new Float64Array(ne);
  for (let e = 0; e < ne; e++) {
    for (let i = 0; i < 6; i++) { const v = M.el[6 * e + i]; Xe[i] = X[2 * v]; Ye[i] = X[2 * v + 1]; ue[2 * i] = u[2 * v]; ue[2 * i + 1] = u[2 * v + 1]; }
    let vmMax = 0;
    LOCAL.forEach(([xi, et], k) => {
      const { Nx, Ny } = Bmat(Xe, Ye, xi, et);
      let ex = 0, ey = 0, g = 0;
      for (let i = 0; i < 6; i++) { ex += Nx[i] * ue[2 * i]; ey += Ny[i] * ue[2 * i + 1]; g += Ny[i] * ue[2 * i] + Nx[i] * ue[2 * i + 1]; }
      const s0 = D[0][0] * ex + D[0][1] * ey, s1 = D[1][0] * ex + D[1][1] * ey, s2 = D[2][2] * g;
      const v = M.el[6 * e + k];
      sx[v] += s0; sy[v] += s1; txy[v] += s2; cnt[v]++;
      vmMax = Math.max(vmMax, vonMises(s0, s1, s2, plane === 'strain' ? nu * (s0 + s1) : 0));
    });
    elemVM[e] = vmMax;
  }
  const vm = new Float64Array(n), s1 = new Float64Array(n), s2 = new Float64Array(n), um = new Float64Array(n);
  let maxVM = { v: -1 }, maxS1 = { v: -Infinity }, minS2 = { v: Infinity }, maxU = 0;
  for (let i = 0; i < n; i++) {
    sx[i] /= cnt[i]; sy[i] /= cnt[i]; txy[i] /= cnt[i];
    const c = (sx[i] + sy[i]) / 2, r = Math.hypot((sx[i] - sy[i]) / 2, txy[i]);
    s1[i] = c + r; s2[i] = c - r;
    vm[i] = vonMises(sx[i], sy[i], txy[i], plane === 'strain' ? nu * (sx[i] + sy[i]) : 0);
    um[i] = Math.hypot(u[2 * i], u[2 * i + 1]);
    if (vm[i] > maxVM.v) maxVM = { v: vm[i], node: i };
    if (s1[i] > maxS1.v) maxS1 = { v: s1[i], node: i };
    if (s2[i] < minS2.v) minS2 = { v: s2[i], node: i };
    maxU = Math.max(maxU, um[i]);
  }
  return { fields: { sx, sy, txy, vm, s1, s2, um, ux: u.filter((_, k) => k % 2 === 0), uy: u.filter((_, k) => k % 2 === 1) }, maxVM, maxS1, minS2, maxU, elemVM };
}
const vonMises = (sx, sy, txy, sz) => Math.sqrt(0.5 * ((sx - sy) ** 2 + (sy - sz) ** 2 + (sz - sx) ** 2) + 3 * txy * txy);

// ---------------------------------------------------------------- sampling
// Locate (x, y) in the mesh and interpolate a nodal field with the quadratic shape functions.
export function makeSampler(res) {
  const M = res.mesh, X = M.xy, ne = M.el.length / 6;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < M.nNodes; i++) { x0 = Math.min(x0, X[2 * i]); x1 = Math.max(x1, X[2 * i]); y0 = Math.min(y0, X[2 * i + 1]); y1 = Math.max(y1, X[2 * i + 1]); }
  const G = Math.max(4, Math.round(Math.sqrt(ne / 2))), cw = (x1 - x0) / G || 1, ch = (y1 - y0) / G || 1;
  const cells = Array.from({ length: G * G }, () => []);
  for (let e = 0; e < ne; e++) {
    let ax = Infinity, ay = Infinity, bx = -Infinity, by = -Infinity;
    for (let i = 0; i < 3; i++) { const v = M.el[6 * e + i]; ax = Math.min(ax, X[2 * v]); bx = Math.max(bx, X[2 * v]); ay = Math.min(ay, X[2 * v + 1]); by = Math.max(by, X[2 * v + 1]); }
    const i0 = Math.max(0, Math.floor((ax - x0) / cw)), i1 = Math.min(G - 1, Math.floor((bx - x0) / cw)), j0 = Math.max(0, Math.floor((ay - y0) / ch)), j1 = Math.min(G - 1, Math.floor((by - y0) / ch));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cells[j * G + i].push(e);
  }
  return (x, y) => {
    const i = Math.floor((x - x0) / cw), j = Math.floor((y - y0) / ch);
    if (i < 0 || j < 0 || i >= G || j >= G) return null;
    let best = null, bestMin = -Infinity;
    for (const e of cells[j * G + i]) {
      const a = M.el[6 * e], b = M.el[6 * e + 1], c = M.el[6 * e + 2];
      const ax = X[2 * a], ay = X[2 * a + 1], det = (X[2 * b] - ax) * (X[2 * c + 1] - ay) - (X[2 * c] - ax) * (X[2 * b + 1] - ay);
      const xi = ((x - ax) * (X[2 * c + 1] - ay) - (X[2 * c] - ax) * (y - ay)) / det, et = ((X[2 * b] - ax) * (y - ay) - (x - ax) * (X[2 * b + 1] - ay)) / det;
      const mn = Math.min(xi, et, 1 - xi - et);
      if (mn > bestMin) { bestMin = mn; best = { e, xi, et }; }
      if (mn >= 0) break;
    }
    if (!best || bestMin < -1e-3) return null;
    const { N } = shapeDeriv(best.xi, best.et);
    return { e: best.e, value: f => { let s = 0; for (let k = 0; k < 6; k++) s += N[k] * f[M.el[6 * best.e + k]]; return s; } };
  };
}
