// 2-D frame / truss / cable analysis by the direct stiffness method (all SI units).
//
// Elements: Euler–Bernoulli beam-columns (axial + bending), truss bars and tension-only cables.
// Member-end hinges are modelled with their own rotation DOF, so a hinged end keeps exact
// stiffness and mass terms. Supports may be inclined (rotated node frame), elastic (springs) or
// have prescribed settlements. Member loads: point forces, point moments, linearly varying
// distributed loads (global, projected or local), self weight, and uniform / gradient temperature.
// Internal forces along members follow from statics using the exact end forces, and the deflected
// shape from integrating M/EI, so results are exact for any load pattern (one element per member).
// Modal analysis (consistent mass) and linear buckling (geometric stiffness) use subdivided members.

import { sectionProps, materialById } from './sections.js';
import { cholesky, cholSolve, symEig, symGenEig } from '../lib/eigen.js';

export const SUPPORT_DOFS = {
  fixed: [1, 1, 1], pin: [1, 1, 0], roller: [0, 1, 0], slider: [0, 1, 1], contact: [1, 1, 0], spring: [0, 0, 0], free: [0, 0, 0],
};
const deg = Math.PI / 180;

// ---------------------------------------------------------------- model preparation
export function prepare(model) {
  const nodeIndex = new Map(model.nodes.map((n, i) => [n.id, i]));
  const secCache = new Map();
  const sec = id => {
    if (!secCache.has(id)) { const s = model.sections.find(s => s.id === id) || model.sections[0]; secCache.set(id, { ...sectionProps(s), name: s.name, shape: s.shape, dims: s.dims }); }
    return secCache.get(id);
  };
  const members = model.members.map(m => {
    const i = nodeIndex.get(m.a), j = nodeIndex.get(m.b);
    const A = model.nodes[i], B = model.nodes[j];
    const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy);
    const S = sec(m.sec), M = materialById(model.materials || [], m.mat);
    return {
      src: m, id: m.id, i, j, L, c: dx / L, s: dy / L, type: m.type || 'frame',
      relA: !!m.relA && (m.type || 'frame') === 'frame', relB: !!m.relB && (m.type || 'frame') === 'frame',
      E: M.E, G: M.E / (2 * (1 + M.nu)), A: S.A, I: S.Ix, rho: M.rho, alpha: M.alpha, fy: M.fy, h: S.h, sec: S, mat: M,
    };
  });
  return { model, nodeIndex, members, memberIndex: new Map(members.map((m, k) => [m.id, k])) };
}

// Loads on a member expressed in its local axes as functions of s ∈ [0, L].
// Returns { dist: [{s0,s1,qx0,qx1,qy0,qy1}], point: [{s,px,py}], mom: [{s,m}], dT, kap }
export function memberLocalLoads(P, mi) {
  const m = P.members[mi], { c, s, L } = m, model = P.model;
  const out = { dist: [], point: [], mom: [], dT: 0, kap: 0 };
  const toLocal = (gx, gy) => [c * gx + s * gy, -s * gx + c * gy];
  const g = model.settings?.g ?? 9.80665;
  if (model.settings?.selfWeight && m.rho > 0) {
    const w = m.rho * m.A * g, [qx, qy] = toLocal(0, -w);
    out.dist.push({ s0: 0, s1: L, qx0: qx, qx1: qx, qy0: qy, qy1: qy, self: true });
  }
  for (const ld of model.loads) {
    if (ld.member !== m.id) continue;
    if (ld.kind === 'dist') {
      const t0 = Math.max(0, Math.min(1, ld.t0 ?? 0)), t1 = Math.max(0, Math.min(1, ld.t1 ?? 1));
      if (t1 <= t0) continue;
      let q0, q1;
      const dir = ld.dir || 'gy';
      if (dir === 'ly') { q0 = [0, ld.w1]; q1 = [0, ld.w2]; }
      else if (dir === 'lx') { q0 = [ld.w1, 0]; q1 = [ld.w2, 0]; }
      else {
        // global direction, per length of member or per projected length
        const proj = dir === 'gyp' ? Math.abs(c) : dir === 'gxp' ? Math.abs(s) : 1;
        const gx = dir[1] === 'x', f = proj;
        q0 = toLocal(gx ? ld.w1 * f : 0, gx ? 0 : ld.w1 * f);
        q1 = toLocal(gx ? ld.w2 * f : 0, gx ? 0 : ld.w2 * f);
      }
      out.dist.push({ s0: t0 * L, s1: t1 * L, qx0: q0[0], qx1: q1[0], qy0: q0[1], qy1: q1[1] });
    } else if (ld.kind === 'point') {
      const [px, py] = toLocal(ld.fx || 0, ld.fy || 0);
      out.point.push({ s: Math.max(0, Math.min(1, ld.t ?? 0.5)) * L, px, py });
    } else if (ld.kind === 'mpoint') {
      out.mom.push({ s: Math.max(0, Math.min(1, ld.t ?? 0.5)) * L, m: ld.m || 0 });
    } else if (ld.kind === 'thermal') {
      out.dT += ld.dT || 0;
      // dTg = T(top, local +y) − T(bottom): hotter top shortens curvature sign: kappa = −α·dTg/h
      if (m.type === 'frame' && m.h > 0) out.kap += -m.alpha * (ld.dTg || 0) / m.h;
    }
  }
  return out;
}

// Restrict member loads to [sa, sb] and shift to the sub-element coordinate.
function sliceLoads(LL, sa, sb, last) {
  const out = { dist: [], point: [], mom: [], dT: LL.dT, kap: LL.kap };
  for (const d of LL.dist) {
    const a = Math.max(d.s0, sa), b = Math.min(d.s1, sb);
    if (b - a <= 1e-12) continue;
    const lerp = (v0, v1, s) => v0 + (v1 - v0) * (s - d.s0) / (d.s1 - d.s0 || 1);
    out.dist.push({ s0: a - sa, s1: b - sa, qx0: lerp(d.qx0, d.qx1, a), qx1: lerp(d.qx0, d.qx1, b), qy0: lerp(d.qy0, d.qy1, a), qy1: lerp(d.qy0, d.qy1, b) });
  }
  for (const p of LL.point) if (p.s >= sa && (p.s < sb || (last && p.s <= sb + 1e-12))) out.point.push({ ...p, s: p.s - sa });
  for (const p of LL.mom) if (p.s >= sa && (p.s < sb || (last && p.s <= sb + 1e-12))) out.mom.push({ ...p, s: p.s - sa });
  return out;
}

const G3 = [[-0.7745966692414834, 5 / 9], [0, 8 / 9], [0.7745966692414834, 5 / 9]];

// Work-equivalent nodal loads (local, order u1 v1 θ1 u2 v2 θ2) for an element with loads LL.
function equivalentLoads(L, LL, frame, E, A, I, alpha) {
  const f = new Float64Array(6);
  const addV = (x, py) => {
    const xi = x / L;
    if (frame) { f[1] += (1 - 3 * xi * xi + 2 * xi ** 3) * py; f[2] += L * (xi - 2 * xi * xi + xi ** 3) * py; f[4] += (3 * xi * xi - 2 * xi ** 3) * py; f[5] += L * (-xi * xi + xi ** 3) * py; }
    else { f[1] += (1 - xi) * py; f[4] += xi * py; }
  };
  const addU = (x, px) => { const xi = x / L; f[0] += (1 - xi) * px; f[3] += xi * px; };
  for (const d of LL.dist) {
    const a = d.s0, b = d.s1, hl = (b - a) / 2, mid = (a + b) / 2;
    for (const [g, w] of G3) {
      const x = mid + hl * g, t = (x - a) / (b - a || 1);
      addU(x, (d.qx0 + (d.qx1 - d.qx0) * t) * w * hl);
      addV(x, (d.qy0 + (d.qy1 - d.qy0) * t) * w * hl);
    }
  }
  for (const p of LL.point) { addU(p.s, p.px); addV(p.s, p.py); }
  for (const p of LL.mom) {
    const xi = p.s / L;
    if (frame) { f[1] += (-6 * xi + 6 * xi * xi) / L * p.m; f[2] += (1 - 4 * xi + 3 * xi * xi) * p.m; f[4] += (6 * xi - 6 * xi * xi) / L * p.m; f[5] += (-2 * xi + 3 * xi * xi) * p.m; }
    else { f[1] -= p.m / L; f[4] += p.m / L; }
  }
  if (LL.dT) { const F = E * A * alpha * LL.dT; f[0] -= F; f[3] += F; }
  if (frame && LL.kap) { const Mk = E * I * LL.kap; f[2] -= Mk; f[5] += Mk; }
  return f;
}

function localK(e) {
  const { L, E, A, I } = e, k = Array.from({ length: 6 }, () => new Float64Array(6));
  const ea = E * A / L;
  k[0][0] = ea; k[0][3] = -ea; k[3][0] = -ea; k[3][3] = ea;
  if (e.frame) {
    const a = 12 * E * I / L ** 3, b = 6 * E * I / L ** 2, c = 4 * E * I / L, d = 2 * E * I / L;
    const B = [[a, b, -a, b], [b, c, -b, d], [-a, -b, a, -b], [b, d, -b, c]], ix = [1, 2, 4, 5];
    for (let r = 0; r < 4; r++) for (let q = 0; q < 4; q++) k[ix[r]][ix[q]] = B[r][q];
  }
  return k;
}
function localM(e) {
  const { L, rho, A } = e, m = Array.from({ length: 6 }, () => new Float64Array(6)), mt = rho * A * L;
  if (e.frame) {
    const f = mt / 420, M = [
      [140, 0, 0, 70, 0, 0], [0, 156, 22 * L, 0, 54, -13 * L], [0, 22 * L, 4 * L * L, 0, 13 * L, -3 * L * L],
      [70, 0, 0, 140, 0, 0], [0, 54, 13 * L, 0, 156, -22 * L], [0, -13 * L, -3 * L * L, 0, -22 * L, 4 * L * L]];
    for (let r = 0; r < 6; r++) for (let q = 0; q < 6; q++) m[r][q] = M[r][q] * f;
  } else { m[0][0] = m[1][1] = m[3][3] = m[4][4] = mt / 2; }
  return m;
}
function localKg(e, N) {
  const { L } = e, k = Array.from({ length: 6 }, () => new Float64Array(6));
  if (e.frame) {
    const f = N / (30 * L), B = [[36, 3 * L, -36, 3 * L], [3 * L, 4 * L * L, -3 * L, -L * L], [-36, -3 * L, 36, -3 * L], [3 * L, -L * L, -3 * L, 4 * L * L]], ix = [1, 2, 4, 5];
    for (let r = 0; r < 4; r++) for (let q = 0; q < 4; q++) k[ix[r]][ix[q]] = B[r][q] * f;
  } else { const f = N / L; k[1][1] = f; k[1][4] = -f; k[4][1] = -f; k[4][4] = f; }
  return k;
}
// global = Tᵀ k T for T = blockdiag([c s 0; −s c 0; 0 0 1])
function toGlobal(k, c, s) {
  const T = [[c, s, 0, 0, 0, 0], [-s, c, 0, 0, 0, 0], [0, 0, 1, 0, 0, 0], [0, 0, 0, c, s, 0], [0, 0, 0, -s, c, 0], [0, 0, 0, 0, 0, 1]];
  const kt = Array.from({ length: 6 }, () => new Float64Array(6)), out = Array.from({ length: 6 }, () => new Float64Array(6));
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) { let v = 0; for (let q = 0; q < 6; q++) v += k[i][q] * T[q][j]; kt[i][j] = v; }
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) { let v = 0; for (let q = 0; q < 6; q++) v += T[q][i] * kt[q][j]; out[i][j] = v; }
  return out;
}

// ---------------------------------------------------------------- mesh
// nsub: number of sub-elements per frame member (trusses/cables are never subdivided).
export function buildMesh(P, nsub = 1) {
  const model = P.model, nodes = model.nodes.map(n => ({ x: n.x, y: n.y, mass: n.mass || 0, orig: n.id }));
  const elems = [];
  let ndof = nodes.length * 3;
  const extraDofs = []; // rotation dofs owned by hinged member ends
  P.members.forEach((m, mi) => {
    // for modes/buckling (nsub > 1) truss bars become pin-ended beams so they can bow and buckle on their own
    const LL = memberLocalLoads(P, mi), asBeam = nsub > 1 && m.type === 'truss' && m.I > 0, frame = m.type === 'frame' || asBeam;
    const n = frame ? Math.max(1, nsub) : 1;
    const relA = m.relA || asBeam, relB = m.relB || asBeam;
    let prev = m.i;
    for (let k = 0; k < n; k++) {
      let next;
      if (k === n - 1) next = m.j;
      else { const t = (k + 1) / n; nodes.push({ x: nodes[m.i].x + (nodes[m.j].x - nodes[m.i].x) * t, y: nodes[m.i].y + (nodes[m.j].y - nodes[m.i].y) * t, mass: 0, internal: mi }); next = nodes.length - 1; }
      const sa = m.L * k / n, sb = m.L * (k + 1) / n;
      elems.push({ member: mi, k, n1: prev, n2: next, sa, sb, L: sb - sa, c: m.c, s: m.s, frame, type: asBeam ? 'frame' : m.type, E: m.E, A: m.A, I: m.I, rho: m.rho, alpha: m.alpha,
        rel1: k === 0 && relA, rel2: k === n - 1 && relB, loads: sliceLoads(LL, sa, sb, k === n - 1) });
      prev = next;
    }
  });
  // internal nodes were appended after original nodes: dofs 3*i for all nodes
  ndof = nodes.length * 3;
  for (const e of elems) {
    const r1 = e.frame ? (e.rel1 ? (extraDofs.push(e), ndof++) : e.n1 * 3 + 2) : -1;
    const r2 = e.frame ? (e.rel2 ? (extraDofs.push(e), ndof++) : e.n2 * 3 + 2) : -1;
    e.dofs = [e.n1 * 3, e.n1 * 3 + 1, r1, e.n2 * 3, e.n2 * 3 + 1, r2];
    e.feq = equivalentLoads(e.L, e.loads, e.frame, e.E, e.A, e.I, e.alpha);
  }
  return { P, nodes, elems, ndof };
}

// ---------------------------------------------------------------- assembly + boundary conditions
function assemble(mesh, kind = 'K', axial = null) {
  const n = mesh.ndof, K = Array.from({ length: n }, () => new Float64Array(n));
  mesh.elems.forEach((e, ei) => {
    if (kind === 'K' && e.type === 'cable' && e.slack) return;
    const kl = kind === 'K' ? localK(e) : kind === 'M' ? localM(e) : localKg(e, axial[ei]);
    const kg = toGlobal(kl, e.c, e.s), d = e.dofs;
    for (let a = 0; a < 6; a++) { if (d[a] < 0) continue; const row = K[d[a]]; for (let b = 0; b < 6; b++) if (d[b] >= 0) row[d[b]] += kg[a][b]; }
  });
  return K;
}

// Support frames, restraints, springs. Returns {rot: Map(node -> angle), fixed: Map(dof -> prescribed), springs: Map(dof -> k)}
function boundary(mesh) {
  const model = mesh.P.model, rot = new Map(), fixed = new Map(), springs = new Map(), supportAt = new Map();
  for (const sp of model.supports) {
    const i = mesh.P.nodeIndex.get(sp.node); if (i === undefined) continue;
    supportAt.set(i, sp);
    const ang = (sp.angle || 0) * deg; if (Math.abs(ang) > 1e-12) rot.set(i, ang);
    let dofs = SUPPORT_DOFS[sp.type] || [0, 0, 0];
    if (sp.type === 'contact' && !(sp.mu > 0)) dofs = [0, 1, 0];
    const pres = [sp.dx || 0, sp.dy || 0, sp.dr || 0];
    for (let k = 0; k < 3; k++) if (dofs[k]) fixed.set(i * 3 + k, pres[k]);
    if (sp.type === 'spring') { if (sp.kx > 0) springs.set(i * 3, sp.kx); if (sp.ky > 0) springs.set(i * 3 + 1, sp.ky); if (sp.kr > 0) springs.set(i * 3 + 2, sp.kr); }
  }
  return { rot, fixed, springs, supportAt };
}
// In-place K' = Rᵀ K R for rotated nodes (u = R u', R = [c −s; s c])
function rotateMatrix(K, rot) {
  const n = K.length;
  for (const [i, a] of rot) {
    const c = Math.cos(a), s = Math.sin(a), p = i * 3, q = p + 1;
    for (let r = 0; r < n; r++) { const x = K[r][p], y = K[r][q]; K[r][p] = c * x + s * y; K[r][q] = -s * x + c * y; }
    for (let r = 0; r < n; r++) { const x = K[p][r], y = K[q][r]; K[p][r] = c * x + s * y; K[q][r] = -s * x + c * y; }
  }
}
function rotateVec(F, rot, inverse = false) {
  for (const [i, a] of rot) {
    const c = Math.cos(a), s = inverse ? -Math.sin(a) : Math.sin(a), p = i * 3, x = F[p], y = F[p + 1];
    // forward: F' = Rᵀ F ; inverse (u = R u'): u = R u'
    if (!inverse) { F[p] = c * x + s * y; F[p + 1] = -s * x + c * y; }
    else { F[p] = c * x + s * y; F[p + 1] = -s * x + c * y; }
  }
}

function loadVector(mesh) {
  const F = new Float64Array(mesh.ndof), model = mesh.P.model;
  for (const ld of model.loads) {
    const i = mesh.P.nodeIndex.get(ld.node); if (i === undefined) continue;
    if (ld.kind === 'force') { F[i * 3] += ld.fx || 0; F[i * 3 + 1] += ld.fy || 0; }
    else if (ld.kind === 'moment') F[i * 3 + 2] += ld.m || 0;
  }
  for (const e of mesh.elems) {
    const { c, s } = e, f = e.feq, g = [c * f[0] - s * f[1], s * f[0] + c * f[1], f[2], c * f[3] - s * f[4], s * f[3] + c * f[4], f[5]];
    for (let a = 0; a < 6; a++) if (e.dofs[a] >= 0) F[e.dofs[a]] += g[a];
  }
  return F;
}

const dofName = (mesh, d) => {
  if (d >= mesh.nodes.length * 3) return { node: null, text: 'a hinge rotation' };
  const i = Math.floor(d / 3), k = d % 3, n = mesh.nodes[i];
  return { node: n.orig ?? null, internal: n.internal, text: ['x-translation', 'y-translation', 'rotation'][k] };
};

// ---------------------------------------------------------------- static solve on a mesh
function solveMesh(mesh) {
  const K = assemble(mesh, 'K');
  const bc = boundary(mesh);
  rotateMatrix(K, bc.rot);
  for (const [d, k] of bc.springs) K[d][d] += k;
  const F = loadVector(mesh), Fl = Float64Array.from(F);
  rotateVec(Fl, bc.rot);
  // auto-restrain rotation dofs with no stiffness (pure pin joints)
  const auto = [];
  let dmax = 0; for (let d = 0; d < mesh.ndof; d++) dmax = Math.max(dmax, Math.abs(K[d][d]));
  for (let i = 0; i < mesh.nodes.length; i++) { const d = i * 3 + 2; if (!bc.fixed.has(d) && Math.abs(K[d][d]) <= 1e-14 * dmax) { auto.push(d); bc.fixed.set(d, 0); } }
  const free = [], fixedList = [...bc.fixed.keys()];
  for (let d = 0; d < mesh.ndof; d++) if (!bc.fixed.has(d)) free.push(d);
  const u = new Float64Array(mesh.ndof);
  for (const [d, v] of bc.fixed) u[d] = v;
  const nf = free.length;
  const Kff = free.map(r => { const row = new Float64Array(nf); for (let q = 0; q < nf; q++) row[q] = K[r][free[q]]; return row; });
  const rhs = free.map(r => { let v = Fl[r]; for (const [d, val] of bc.fixed) if (val) v -= K[r][d] * val; return v; });
  // lost moments applied at auto-restrained pins
  const lostMoments = auto.filter(d => Math.abs(Fl[d]) > 0).map(d => dofName(mesh, d));
  let L = nf ? cholesky(Kff) : [];
  if (L.fail !== undefined) {
    // mechanism: smallest-eigenvalue mode of Kff shows how it moves
    let shape = null;
    if (nf <= 600) {
      const { vectors } = symEig(Kff);
      shape = new Float64Array(mesh.ndof); vectors[0].forEach((v, q) => { shape[free[q]] = v; });
      rotateVec(shape, bc.rot, true);
    }
    return { ok: false, error: 'mechanism', dof: dofName(mesh, free[L.fail]), shape, mesh };
  }
  const uf = nf ? cholSolve(L, rhs) : [];
  free.forEach((d, q) => { u[d] = uf[q]; });
  // reactions in support frames: R' = K'u' − F'
  const Ku = new Float64Array(mesh.ndof);
  for (let r = 0; r < mesh.ndof; r++) { let v = 0; const row = K[r]; for (let q = 0; q < mesh.ndof; q++) v += row[q] * u[q]; Ku[r] = v; }
  const Rl = new Float64Array(mesh.ndof);
  for (const d of fixedList) Rl[d] = Ku[d] - Fl[d];
  for (const [d, k] of bc.springs) Rl[d] = -k * u[d];
  // back to global
  const ug = Float64Array.from(u); rotateVec(ug, bc.rot, true);
  const Rg = Float64Array.from(Rl); rotateVec(Rg, bc.rot, true);
  // element end forces (local): f = k T u − feq
  const endF = mesh.elems.map(e => {
    const ue = e.dofs.map(d => (d >= 0 ? ug[d] : 0)), { c, s } = e;
    const ul = [c * ue[0] + s * ue[1], -s * ue[0] + c * ue[1], ue[2], c * ue[3] + s * ue[4], -s * ue[3] + c * ue[4], ue[5]];
    const k = localK(e), f = new Float64Array(6);
    for (let a = 0; a < 6; a++) { let v = -e.feq[a]; for (let b = 0; b < 6; b++) v += k[a][b] * ul[b]; f[a] = v; }
    return { f, ul };
  });
  return { ok: true, mesh, u: ug, Rl, Rg, bc, endF, auto, lostMoments, free, F };
}

// ---------------------------------------------------------------- public: static analysis
export function analyze(model, { cableIterations = 20 } = {}) {
  if (!model.members.length) return { ok: false, error: 'empty' };
  const P = prepare(model);
  for (const m of P.members) if (!(m.L > 0)) return { ok: false, error: 'zero-length', member: m.id };
  let mesh = buildMesh(P, 1), sol;
  // tension-only cables: iterate removing slack cables
  for (let it = 0; it < cableIterations; it++) {
    sol = solveMesh(mesh);
    if (!sol.ok) break;
    let changed = false;
    mesh.elems.forEach((e, ei) => {
      if (e.type !== 'cable') return;
      const N = e.slack ? (e.E * e.A / e.L) * (sol.endF[ei].ul[3] - sol.endF[ei].ul[0]) : -sol.endF[ei].f[0];
      const slack = N < -1e-9 * Math.max(1, Math.abs(N));
      if (slack !== !!e.slack) { e.slack = slack; changed = true; }
    });
    if (!changed) break;
  }
  if (!sol.ok) return { ...sol, P };
  return post(P, sol);
}

// Internal force and displacement distributions for each member
function post(P, sol) {
  const { mesh } = sol, model = P.model;
  const nodes = model.nodes.map((n, i) => ({ id: n.id, ux: sol.u[i * 3], uy: sol.u[i * 3 + 1], rz: sol.u[i * 3 + 2] }));
  const reactions = [];
  for (const sp of model.supports) {
    const i = P.nodeIndex.get(sp.node); if (i === undefined) continue;
    const a = (sp.angle || 0) * deg;
    const R = { node: sp.node, type: sp.type, angle: sp.angle || 0, Rx: sol.Rg[i * 3], Ry: sol.Rg[i * 3 + 1], Mz: sol.Rg[i * 3 + 2], Rt: sol.Rl[i * 3], Rn: sol.Rl[i * 3 + 1] };
    if (Math.abs(a) < 1e-12) { R.Rt = R.Rx; R.Rn = R.Ry; }
    if (sp.type === 'contact') {
      R.N = R.Rn; R.F = R.Rt; R.mu = sp.mu || 0;
      R.lift = R.N < -1e-9 * Math.max(1, Math.abs(R.N) + Math.abs(R.F));
      R.slip = !R.lift && Math.abs(R.F) > (R.mu || 0) * Math.abs(R.N) * (1 + 1e-9) + 1e-12;
      R.muReq = Math.abs(R.N) > 0 ? Math.abs(R.F) / Math.abs(R.N) : Infinity;
    }
    reactions.push(R);
  }
  const members = P.members.map((m, mi) => {
    const ei = mesh.elems.findIndex(e => e.member === mi);
    const e = mesh.elems[ei], { f, ul } = sol.endF[ei];
    const LL = memberLocalLoads(P, mi);
    const d = diagrams(m, LL, f, ul, e.slack);
    return { id: m.id, mi, L: m.L, type: m.type, slack: !!e.slack, end: { N1: -f[0], V1: f[1], M1: -f[2], N2: f[3], V2: -f[4], M2: f[5] }, ul, ...d, stress: memberStress(m, d) };
  });
  // load / reaction totals for the global equilibrium check
  let Fx = 0, Fy = 0, Mo = 0;
  for (const ld of model.loads) {
    const i = P.nodeIndex.get(ld.node);
    if (i !== undefined) { const n = model.nodes[i]; if (ld.kind === 'force') { Fx += ld.fx || 0; Fy += ld.fy || 0; Mo += n.x * (ld.fy || 0) - n.y * (ld.fx || 0); } else if (ld.kind === 'moment') Mo += ld.m || 0; }
  }
  P.members.forEach((m, mi) => {
    const r = memberResultant(P, mi); Fx += r.Fx; Fy += r.Fy; Mo += r.Mo;
  });
  let Rx = 0, Ry = 0, Rm = 0;
  for (const r of reactions) { const n = model.nodes[P.nodeIndex.get(r.node)]; Rx += r.Rx; Ry += r.Ry; Rm += r.Mz + n.x * r.Ry - n.y * r.Rx; }
  let maxDisp = { v: 0 };
  for (const mem of members) for (let k = 0; k < mem.x.length; k++) { const v = Math.hypot(mem.gu[k], mem.gv[k]); if (v > maxDisp.v) maxDisp = { v, member: mem.id, x: mem.x[k] }; }
  return { ok: true, P, sol, nodes, reactions, members, totals: { Fx, Fy, Mo, Rx, Ry, Rm }, maxDisp, autoPins: sol.auto.length, lostMoments: sol.lostMoments };
}

// Resultant of member loads in global axes and its moment about the origin
export function memberResultant(P, mi) {
  const m = P.members[mi], LL = memberLocalLoads(P, mi), n0 = P.model.nodes[m.i];
  let fx = 0, fy = 0, mo = 0; // local resultants, moment about member start
  for (const d of LL.dist) {
    const L = d.s1 - d.s0, Fx = (d.qx0 + d.qx1) / 2 * L, Fy = (d.qy0 + d.qy1) / 2 * L;
    fx += Fx; fy += Fy; mo += firstMoment(d.s0, d.s1, d.qy0, d.qy1);
  }
  for (const p of LL.point) { fx += p.px; fy += p.py; mo += p.py * p.s; }
  for (const p of LL.mom) mo += p.m;
  const { c, s } = m, Fx = c * fx - s * fy, Fy = s * fx + c * fy;
  return { Fx, Fy, Mo: mo + n0.x * Fy - n0.y * Fx, local: { fx, fy, mo } };
}

// N, V, M, slope and deflection along a member from the start-end forces (exact statics).
function diagrams(m, LL, f, ul, slack) {
  const L = m.L, frame = m.type === 'frame';
  // sample positions: uniform + load discontinuities (duplicated for jumps)
  const cuts = new Set([0, L]);
  for (const d of LL.dist) { cuts.add(d.s0); cuts.add(d.s1); }
  for (const p of LL.point) cuts.add(p.s);
  for (const p of LL.mom) cuts.add(p.s);
  const NS = 120, xs = [];
  for (let k = 0; k <= NS; k++) xs.push(L * k / NS);
  for (const c of cuts) if (c > 0 && c < L) { xs.push(c - 1e-9 * L, c + 1e-9 * L); }
  xs.sort((a, b) => a - b);
  const N = [], V = [], M = [];
  for (const x of xs) {
    let fx = f[0], fy = f[1], mm = -f[2] + f[1] * x;
    for (const d of LL.dist) {
      if (x <= d.s0) continue;
      const b = Math.min(x, d.s1), len = b - d.s0, slope = (d.s1 > d.s0) ? 1 / (d.s1 - d.s0) : 0;
      const qyb = d.qy0 + (d.qy1 - d.qy0) * len * slope, qxb = d.qx0 + (d.qx1 - d.qx0) * len * slope;
      const Fy = (d.qy0 + qyb) / 2 * len, Fx = (d.qx0 + qxb) / 2 * len;
      fx += Fx; fy += Fy; mm += Fy * x - firstMoment(d.s0, b, d.qy0, qyb);
    }
    for (const p of LL.point) if (p.s < x) { fx += p.px; fy += p.py; mm += p.py * (x - p.s); }
    for (const p of LL.mom) if (p.s < x) mm -= p.m;
    N.push(-fx); V.push(fy); M.push(mm);
  }
  // clean round-off noise (e.g. 1e-15 moments in pin-ended members)
  let Fs = 0; for (let k = 0; k < N.length; k++) Fs = Math.max(Fs, Math.abs(N[k]), Math.abs(V[k]));
  for (let k = 0; k < N.length; k++) {
    if (Math.abs(N[k]) < 1e-10 * Fs) N[k] = 0;
    if (Math.abs(V[k]) < 1e-10 * Fs) V[k] = 0;
    if (Math.abs(M[k]) < 1e-10 * Fs * L) M[k] = 0;
  }
  // deflection: integrate EI v'' = M + EI·kap, u' = N/EA + αΔT
  const n = xs.length, u = new Float64Array(n), v = new Float64Array(n), th = new Float64Array(n);
  u[0] = ul[0]; v[0] = ul[1]; th[0] = frame ? ul[2] : (ul[4] - ul[1]) / L;
  for (let k = 1; k < n; k++) {
    const h = xs[k] - xs[k - 1];
    const e0 = N[k - 1] / (m.E * m.A) + m.alpha * LL.dT, e1 = N[k] / (m.E * m.A) + m.alpha * LL.dT;
    u[k] = u[k - 1] + (e0 + e1) / 2 * h;
    if (frame) {
      const k0 = M[k - 1] / (m.E * m.I) + LL.kap, k1 = M[k] / (m.E * m.I) + LL.kap;
      th[k] = th[k - 1] + (k0 + k1) / 2 * h;
      v[k] = v[k - 1] + th[k - 1] * h + (2 * k0 + k1) / 6 * h * h;
    } else { th[k] = th[0]; v[k] = v[0] + th[0] * xs[k]; }
  }
  // remove the small integration drift so end values match the solved DOFs exactly
  const du = ul[3] - u[n - 1], dv = ul[4] - v[n - 1];
  for (let k = 0; k < n; k++) { const t = xs[k] / L; u[k] += du * t; v[k] += dv * t; if (frame) th[k] += dv / L; }
  if (slack) for (let k = 0; k < n; k++) { N[k] = 0; V[k] = 0; M[k] = 0; }
  // global displacement components along the member
  const gu = new Float64Array(n), gv = new Float64Array(n);
  for (let k = 0; k < n; k++) { gu[k] = m.c * u[k] - m.s * v[k]; gv[k] = m.s * u[k] + m.c * v[k]; }
  const ext = a => { let lo = Infinity, hi = -Infinity, ilo = 0, ihi = 0; a.forEach((x, k) => { if (x < lo) { lo = x; ilo = k; } if (x > hi) { hi = x; ihi = k; } }); return { min: lo, max: hi, xmin: xs[ilo], xmax: xs[ihi], abs: Math.max(Math.abs(lo), Math.abs(hi)) }; };
  let vmax = { abs: 0, x: 0 };
  // deflection relative to the chord between the member ends
  const rel = v.map((val, k) => val - (v[0] + (v[n - 1] - v[0]) * xs[k] / L));
  rel.forEach((r, k) => { if (Math.abs(r) > vmax.abs) vmax = { abs: Math.abs(r), x: xs[k], v: r }; });
  if (vmax.abs < 1e-12 * L) vmax = { abs: 0, x: 0, v: 0 };
  return { x: xs, N, V, M, u, v, th, gu, gv, ext: { N: ext(N), V: ext(V), M: ext(M) }, sag: vmax };
}
// ∫ q(s)·s ds for q varying linearly from q0 at a to q1 at b
const firstMoment = (a, b, q0, q1) => (b - a) * (q0 * (2 * a + b) + q1 * (a + 2 * b)) / 6;

// Combined axial + bending stress at the extreme fibres, shear stress at the neutral axis.
function memberStress(m, d) {
  const S = m.sec, A = S.A, I = S.Ix;
  let best = { vm: 0 }, sigMax = -Infinity, sigMin = Infinity, tauMax = 0;
  for (let k = 0; k < d.x.length; k++) {
    const N = d.N[k], M = d.M[k], V = d.V[k];
    const top = N / A - M * S.ctop / I, bot = N / A + M * S.cbot / I;
    const tau = Math.abs(V) * S.Qmax / (I * S.bNA);
    const vmNA = Math.sqrt((N / A) ** 2 + 3 * tau * tau);
    sigMax = Math.max(sigMax, top, bot); sigMin = Math.min(sigMin, top, bot); tauMax = Math.max(tauMax, tau);
    const vm = Math.max(Math.abs(top), Math.abs(bot), vmNA);
    if (vm > best.vm) best = { vm, x: d.x[k], top, bot, tau, N, M, V };
  }
  const Nc = Math.min(0, d.ext.N.min); // most compressive
  const Pcr = Math.PI ** 2 * m.E * I / (m.L * m.L);
  return {
    sigMax, sigMin, tauMax, vmMax: best.vm, at: best, util: best.vm / m.fy, fy: m.fy, Pcr,
    eulerUtil: Nc < 0 ? -Nc / Pcr : 0, slenderness: m.L / S.r,
  };
}

// ---------------------------------------------------------------- modal analysis
function chooseNsub(P, maxDof = 420) {
  const nf = P.members.filter(m => m.type !== 'cable').length;
  if (!nf) return 1;
  const base = P.model.nodes.length * 3 + 2 * nf;
  return Math.max(1, Math.min(10, Math.floor((maxDof - base) / (3 * nf)) + 1));
}

export function modal(model, { nModes = 8, nsub } = {}) {
  const P = prepare(model);
  for (const m of P.members) if (!(m.L > 0)) return { ok: false, error: 'zero-length' };
  const mesh = buildMesh(P, nsub || chooseNsub(P));
  const K = assemble(mesh, 'K'), M = assemble(mesh, 'M');
  for (let i = 0; i < mesh.nodes.length; i++) { M[i * 3][i * 3] += mesh.nodes[i].mass; M[i * 3 + 1][i * 3 + 1] += mesh.nodes[i].mass; }
  const bc = boundary(mesh);
  rotateMatrix(K, bc.rot); rotateMatrix(M, bc.rot);
  for (const [d, k] of bc.springs) K[d][d] += k;
  let dmax = 0; for (let d = 0; d < mesh.ndof; d++) dmax = Math.max(dmax, K[d][d]);
  for (let i = 0; i < mesh.nodes.length; i++) { const d = i * 3 + 2; if (!bc.fixed.has(d) && Math.abs(K[d][d]) <= 1e-14 * dmax) bc.fixed.set(d, 0); }
  const free = []; for (let d = 0; d < mesh.ndof; d++) if (!bc.fixed.has(d)) free.push(d);
  if (!free.length) return { ok: false, error: 'no free dofs' };
  const sub = A => free.map(r => Float64Array.from(free, q => A[r][q]));
  const Kf = sub(K), Mf = sub(M);
  // B = M must be positive definite; massless free dofs are not allowed
  const res = symGenEig(Kf, Mf);
  if (res.error) return { ok: false, error: 'massless', dof: dofName(mesh, free[res.row]) };
  // influence vectors for participation (global x, y), expressed in support frames
  const rx = new Float64Array(mesh.ndof), ry = new Float64Array(mesh.ndof);
  for (let i = 0; i < mesh.nodes.length; i++) { rx[i * 3] = 1; ry[i * 3 + 1] = 1; }
  rotateVec(rx, bc.rot); rotateVec(ry, bc.rot);
  const rxf = free.map(d => rx[d]), ryf = free.map(d => ry[d]);
  const Mv = (v) => Mf.map(row => row.reduce((s, a, q) => s + a * v[q], 0));
  const Mrx = Mv(rxf), Mry = Mv(ryf);
  const totX = rxf.reduce((s, a, q) => s + a * Mrx[q], 0), totY = ryf.reduce((s, a, q) => s + a * Mry[q], 0);
  const modes = [];
  for (let k = 0; k < res.values.length && modes.length < nModes; k++) {
    const w2 = res.values[k];
    if (w2 < -1e-6 * Math.abs(res.values[res.values.length - 1])) continue;
    const phi = res.vectors[k]; // M-normalised
    const Lx = phi.reduce((s, a, q) => s + a * Mrx[q], 0), Ly = phi.reduce((s, a, q) => s + a * Mry[q], 0);
    const shape = new Float64Array(mesh.ndof); free.forEach((d, q) => { shape[d] = phi[q]; });
    rotateVec(shape, bc.rot, true);
    const phiM = Float64Array.from(shape); // mass-normalised (φᵀMφ = 1), global components
    const w = Math.sqrt(Math.max(0, w2));
    modes.push({ omega: w, f: w / (2 * Math.PI), T: w > 0 ? 2 * Math.PI / w : Infinity, phi: phiM, Lx, Ly, shape: normalizeShape(shape, mesh), effX: Lx * Lx / (totX || 1), effY: Ly * Ly / (totY || 1), mass: { totX, totY } });
  }
  return { ok: true, mesh, modes, totalMass: totX, nsub: mesh.elems.length };
}
function normalizeShape(shape, mesh) {
  let mx = 0; for (let i = 0; i < mesh.nodes.length; i++) mx = Math.max(mx, Math.hypot(shape[i * 3], shape[i * 3 + 1]));
  if (mx > 0) for (let k = 0; k < shape.length; k++) shape[k] /= mx;
  return shape;
}

// ---------------------------------------------------------------- linear buckling
export function buckling(model, { nModes = 4, nsub } = {}) {
  const P = prepare(model);
  const mesh = buildMesh(P, nsub || chooseNsub(P, 360));
  const sol = solveMesh(mesh);
  if (!sol.ok) return { ok: false, error: sol.error };
  const axial = sol.endF.map(({ f }) => (-f[0] + f[3]) / 2);
  if (!axial.some(N => N < 0)) return { ok: false, error: 'no-compression' };
  const K = assemble(mesh, 'K'), Kg = assemble(mesh, 'G', axial);
  const bc = boundary(mesh);
  rotateMatrix(K, bc.rot); rotateMatrix(Kg, bc.rot);
  for (const [d, k] of bc.springs) K[d][d] += k;
  for (const d of sol.auto) bc.fixed.set(d, 0);
  const free = []; for (let d = 0; d < mesh.ndof; d++) if (!bc.fixed.has(d)) free.push(d);
  const sub = A => free.map(r => Float64Array.from(free, q => A[r][q]));
  const negKg = sub(Kg).map(r => r.map(v => -v));
  const res = symGenEig(negKg, sub(K)); // −Kg φ = μ K φ, λ = 1/μ
  if (res.error) return { ok: false, error: 'singular' };
  const modes = [];
  for (let k = res.values.length - 1; k >= 0 && modes.length < nModes; k--) {
    const mu = res.values[k]; if (!(mu > 1e-12)) break;
    const shape = new Float64Array(mesh.ndof); free.forEach((d, q) => { shape[d] = res.vectors[k][q]; });
    rotateVec(shape, bc.rot, true);
    modes.push({ lambda: 1 / mu, shape: normalizeShape(shape, mesh) });
  }
  return { ok: true, mesh, modes, axial };
}

// Deformed polyline of a mesh element for a dof vector (Hermite cubic for frames).
export function elementCurve(mesh, e, U, scale, nseg = 8) {
  const n1 = mesh.nodes[e.n1], n2 = mesh.nodes[e.n2], { c, s, L } = e;
  const g = d => (d >= 0 ? U[d] : 0);
  const u1 = g(e.dofs[0]), v1 = g(e.dofs[1]), u2 = g(e.dofs[3]), v2 = g(e.dofs[4]);
  const lu1 = c * u1 + s * v1, lv1 = -s * u1 + c * v1, lu2 = c * u2 + s * v2, lv2 = -s * u2 + c * v2;
  const t1 = e.frame ? g(e.dofs[2]) : (lv2 - lv1) / L, t2 = e.frame ? g(e.dofs[5]) : (lv2 - lv1) / L;
  const pts = [];
  for (let k = 0; k <= nseg; k++) {
    const xi = k / nseg, x = xi * L;
    const lu = lu1 + (lu2 - lu1) * xi;
    const lv = e.frame ? (1 - 3 * xi * xi + 2 * xi ** 3) * lv1 + L * (xi - 2 * xi * xi + xi ** 3) * t1 + (3 * xi * xi - 2 * xi ** 3) * lv2 + L * (-xi * xi + xi ** 3) * t2 : lv1 + (lv2 - lv1) * xi;
    pts.push([n1.x + c * x + scale * (c * lu - s * lv), n1.y + s * x + scale * (s * lu + c * lv)]);
  }
  return pts;
}
