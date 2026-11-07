// 3-D space frame / space truss analysis by the direct stiffness method (SI units, global Z up).
//
// Elements: 12-DOF Euler–Bernoulli beams (axial, torsion GJ, bending about both principal axes) and
// axial-only truss bars. Local axes: x along the member, y along the section depth (the "h" of the
// section, bending about local z uses the section's strong-axis Ix), z across the width. By default
// local y lies in the vertical plane through the member pointing up; vertical members use global X.
// A roll angle turns the section about its axis. Member-end pins release both bending moments and
// are removed by static condensation, so a pinned end carries exactly zero moment.
// Node rotations that nothing resists (a joint where only truss bars or pinned ends meet) are removed
// per node, so they never show up as false mechanisms; genuine mechanisms are reported with a shape.
// Internal forces along members come from statics using the exact end forces, so diagrams are exact
// for any load pattern; deflections integrate the curvature. Modal analysis (consistent mass) and
// linear buckling (geometric stiffness) use subdivided members.

import { sectionProps, materialById, torsionStressFactor } from './sections.js';
import { cholesky, cholSolve, symEig, symGenEig } from '../lib/eigen.js';

const deg = Math.PI / 180;
export const DOF_NAMES = ['ux', 'uy', 'uz', 'θx', 'θy', 'θz'];
export const SUPPORT_TYPES = {
  fixed: { label: 'Fixed', r: [1, 1, 1, 1, 1, 1], title: 'All three movements and all three rotations restrained.' },
  pinned: { label: 'Pinned', r: [1, 1, 1, 0, 0, 0], title: 'Ball joint: restrained in X, Y and Z, free to rotate.' },
  rollerZ: { label: 'Roller Z', r: [0, 0, 1, 0, 0, 0], title: 'Rests on a horizontal surface: only vertical movement restrained.' },
  guideX: { label: 'Slides in X', r: [0, 1, 1, 0, 0, 0], title: 'Restrained in Y and Z, free to slide along X and rotate.' },
  guideY: { label: 'Slides in Y', r: [1, 0, 1, 0, 0, 0], title: 'Restrained in X and Z, free to slide along Y and rotate.' },
  custom: { label: 'Custom', r: null, title: 'Choose each restraint and spring yourself.' },
};

// ---------------------------------------------------------------- small vector helpers
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const P3 = n => [n.x, n.y, n.z || 0];

// Local axes (rows ex, ey, ez) for a member from A to B with a roll angle in degrees.
export function memberAxes(A, B, rollDeg = 0) {
  const d = sub(B, A), L = Math.hypot(d[0], d[1], d[2]);
  const ex = [d[0] / L, d[1] / L, d[2] / L];
  const vertical = Math.hypot(d[0], d[1]) < 1e-6 * L;
  const ref = vertical ? [1, 0, 0] : [0, 0, 1];
  const r = dot(ref, ex), y0 = nrm([ref[0] - r * ex[0], ref[1] - r * ex[1], ref[2] - r * ex[2]]), z0 = cross(ex, y0);
  const c = Math.cos(rollDeg * deg), s = Math.sin(rollDeg * deg);
  const ey = [c * y0[0] + s * z0[0], c * y0[1] + s * z0[1], c * y0[2] + s * z0[2]];
  return { L, R: [ex, ey, cross(ex, ey)], vertical };
}

// Shear stress per unit shear force for local y (depth) and z (width), rough but standard estimates.
function shearFactors(S, shape, d) {
  const A = S.A;
  let ky = S.Qmax && S.Ix && S.bNA ? S.Qmax / (S.Ix * S.bNA) : 1.5 / A, kz = 1.5 / A;
  if (shape === 'ibeam' || shape === 'channel') kz = 1.5 / (2 * d.b * d.tf);
  else if (shape === 'box') kz = 1.5 / (2 * (d.b - 2 * d.t) * d.t + 1e-30);
  else if (shape === 'circle') { ky = kz = 4 / (3 * A); }
  else if (shape === 'tube') { ky = kz = 2 / A; }
  else if (shape === 'tee') kz = 1.5 / (d.b * d.tf);
  return { ky, kz };
}

// ---------------------------------------------------------------- model preparation
export function prepare3d(model) {
  const nodeIndex = new Map(model.nodes.map((n, i) => [n.id, i]));
  const secCache = new Map();
  const sec = id => {
    if (!secCache.has(id)) {
      const s = model.sections.find(x => x.id === id) || model.sections[0];
      const S = sectionProps(s), d = s.dims, round = s.shape === 'circle' || s.shape === 'tube';
      const cz = S.custom ? Math.max(d.ctop, d.cbot) : Math.max(S.xc - S.xmin, S.xmax - S.xc);
      const kt = torsionStressFactor(s.shape, d, S.J);
      // warping constant of thin-walled open sections (used for torsional buckling)
      let Iw = 0;
      if (s.shape === 'ibeam') Iw = S.Iy * (d.h - d.tf) ** 2 / 4;
      else if (s.shape === 'channel') { const h0 = d.h - d.tf, b0 = d.b - d.tw / 2; Iw = d.tf * b0 ** 3 * h0 ** 2 / 12 * (3 * b0 * d.tf + 2 * h0 * d.tw) / (6 * b0 * d.tf + h0 * d.tw); }
      else if (s.shape === 'zsec') { const h0 = d.h - d.t, b0 = d.b - d.t / 2; Iw = d.t * b0 ** 3 * h0 ** 2 / 12 * (b0 + 2 * h0) / (2 * b0 + h0); }
      secCache.set(id, {
        id: s.id, name: s.name, shape: s.shape, dims: d, A: S.A, Iz: S.Ix, Iy: S.Iy, J: S.J, Ip: S.Ix + S.Iy,
        cy: Math.max(S.ctop, S.cbot), cz, round, Iw, kt: isFinite(kt) ? kt : 0, ...shearFactors(S, s.shape, d), raw: S,
      });
    }
    return secCache.get(id);
  };
  const members = model.members.map(m => {
    const i = nodeIndex.get(m.a), j = nodeIndex.get(m.b);
    const A = P3(model.nodes[i]), B = P3(model.nodes[j]);
    const ax = memberAxes(A, B, m.roll || 0), S = sec(m.sec), M = materialById(model.materials || [], m.mat);
    const type = m.type === 'truss' ? 'truss' : 'frame';
    return {
      src: m, id: m.id, i, j, A, B, L: ax.L, R: ax.R, type, relA: type === 'frame' && !!m.relA, relB: type === 'frame' && !!m.relB,
      E: M.E, G: M.E / (2 * (1 + M.nu)), rho: M.rho, alpha: M.alpha, fy: M.fy, mat: M, sec: S,
      A_: S.A, Iy: S.Iy, Iz: S.Iz, J: S.J, Ip: S.Ip,
    };
  });
  return { model, nodeIndex, members, memberIndex: new Map(members.map((m, k) => [m.id, k])) };
}

// Member loads in local axes as functions of s ∈ [0, L]:
// { dist: [{s0,s1,q0:[x,y,z],q1:[x,y,z]}], tq: [{s0,s1,m0,m1}], point: [{s,p:[x,y,z],t}], dT }
export function memberLoads3d(P, mi) {
  const m = P.members[mi], { L, R } = m, model = P.model;
  const loc = g => [dot(R[0], g), dot(R[1], g), dot(R[2], g)];
  const out = { dist: [], tq: [], point: [], dT: 0 };
  const g = model.settings?.g ?? 9.80665;
  if (model.settings?.selfWeight && m.rho > 0) { const q = loc([0, 0, -m.rho * m.A_ * g]); out.dist.push({ s0: 0, s1: L, q0: q, q1: q, self: true }); }
  for (const ld of model.loads) {
    if (ld.member !== m.id) continue;
    if (ld.kind === 'dist') {
      const t0 = Math.max(0, Math.min(1, ld.t0 ?? 0)), t1 = Math.max(0, Math.min(1, ld.t1 ?? 1));
      if (t1 <= t0) continue;
      const dir = ld.dir || 'gz', w1 = ld.w1 ?? 0, w2 = ld.w2 ?? w1;
      const ax = { x: 0, y: 1, z: 2 }[dir[1]];
      let q0, q1;
      if (dir[0] === 'l') { q0 = [0, 0, 0]; q1 = [0, 0, 0]; q0[ax] = w1; q1[ax] = w2; }
      else {
        // global direction, per unit member length, or per unit projected length ('p' suffix)
        const e = [0, 0, 0]; e[ax] = 1;
        const f = dir.endsWith('p') ? Math.sqrt(Math.max(0, 1 - R[0][ax] ** 2)) : 1;
        q0 = loc(e.map(v => v * w1 * f)); q1 = loc(e.map(v => v * w2 * f));
      }
      out.dist.push({ s0: t0 * L, s1: t1 * L, q0, q1 });
    } else if (ld.kind === 'point') {
      const p = ld.axes === 'l' ? [ld.fx || 0, ld.fy || 0, ld.fz || 0] : loc([ld.fx || 0, ld.fy || 0, ld.fz || 0]);
      out.point.push({ s: Math.max(0, Math.min(1, ld.t ?? 0.5)) * L, p, t: ld.tx || 0 });
    } else if (ld.kind === 'torque') {
      out.tq.push({ s0: 0, s1: L, m0: ld.mt || 0, m1: ld.mt || 0 });
    } else if (ld.kind === 'thermal') out.dT += ld.dT || 0;
  }
  return out;
}

function sliceLoads(LL, sa, sb, last) {
  const out = { dist: [], tq: [], point: [], dT: LL.dT };
  for (const d of LL.dist) {
    const a = Math.max(d.s0, sa), b = Math.min(d.s1, sb);
    if (b - a <= 1e-12) continue;
    const at = s => d.q0.map((v, k) => v + (d.q1[k] - v) * (s - d.s0) / (d.s1 - d.s0 || 1));
    out.dist.push({ s0: a - sa, s1: b - sa, q0: at(a), q1: at(b) });
  }
  for (const d of LL.tq) {
    const a = Math.max(d.s0, sa), b = Math.min(d.s1, sb);
    if (b - a <= 1e-12) continue;
    const at = s => d.m0 + (d.m1 - d.m0) * (s - d.s0) / (d.s1 - d.s0 || 1);
    out.tq.push({ s0: a - sa, s1: b - sa, m0: at(a), m1: at(b) });
  }
  for (const p of LL.point) if (p.s >= sa && (p.s < sb || (last && p.s <= sb + 1e-12))) out.point.push({ ...p, s: p.s - sa });
  return out;
}

// ---------------------------------------------------------------- element matrices (local)
// DOF order: u1 v1 w1 θx1 θy1 θz1 u2 v2 w2 θx2 θy2 θz2
const XY = [1, 5, 7, 11], XZ = [2, 4, 8, 10];
const zeros12 = () => Array.from({ length: 12 }, () => new Float64Array(12));
// add a 4×4 bending block; rotations about local y have the opposite sign to dw/dx
function addBlock(k, idx, B, sgn) {
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    const s = sgn < 0 && ((r % 2) ^ (c % 2)) ? -1 : 1;
    k[idx[r]][idx[c]] += s * B[r][c];
  }
}
const add2 = (k, a, b, v) => { k[a][a] += v; k[b][b] += v; k[a][b] -= v; k[b][a] -= v; };

function localK(e) {
  const k = zeros12(), { L, E, G } = e;
  add2(k, 0, 6, E * e.A_ / L);
  if (e.beam) {
    if (e.GJ !== 0) add2(k, 3, 9, (e.GJ ?? G * e.J) / L);
    for (const [idx, I, sg] of [[XY, e.Iz, 1], [XZ, e.Iy, -1]]) {
      const a = 12 * E * I / L ** 3, b = 6 * E * I / L ** 2, c = 4 * E * I / L, d = 2 * E * I / L;
      addBlock(k, idx, [[a, b, -a, b], [b, c, -b, d], [-a, -b, a, -b], [b, d, -b, c]], sg);
    }
  }
  return k;
}
function localM(e) {
  const m = zeros12(), { L, rho } = e, mt = rho * e.A_ * L;
  const two = (a, b, v) => { m[a][a] += 2 * v; m[b][b] += 2 * v; m[a][b] += v; m[b][a] += v; };
  two(0, 6, mt / 6);
  if (e.beam) {
    if (e.GJ !== 0) two(3, 9, rho * e.Ip * L / 6);
    const B = [[156, 22 * L, 54, -13 * L], [22 * L, 4 * L * L, 13 * L, -3 * L * L], [54, 13 * L, 156, -22 * L], [-13 * L, -3 * L * L, -22 * L, 4 * L * L]].map(r => r.map(v => v * mt / 420));
    addBlock(m, XY, B, 1); addBlock(m, XZ, B, -1);
  } else { two(1, 7, mt / 6); two(2, 8, mt / 6); }
  return m;
}
// geometric stiffness for axial force N (tension positive)
function localKG(e, N) {
  const k = zeros12(), { L } = e;
  if (e.beam) {
    const B = [[36, 3 * L, -36, 3 * L], [3 * L, 4 * L * L, -3 * L, -L * L], [-36, -3 * L, 36, -3 * L], [3 * L, -L * L, -3 * L, 4 * L * L]].map(r => r.map(v => v * N / (30 * L)));
    addBlock(k, XY, B, 1); addBlock(k, XZ, B, -1);
    if (e.GJ !== 0) add2(k, 3, 9, N * e.Ip / (e.A_ * L));
  } else { add2(k, 1, 7, N / L); add2(k, 2, 8, N / L); }
  return k;
}

const G3 = [[-0.7745966692414834, 5 / 9], [0, 8 / 9], [0.7745966692414834, 5 / 9]];
// work-equivalent nodal loads (local)
function equivalentLoads(e, LL) {
  const f = new Float64Array(12), L = e.L;
  const addP = (s, p, t) => {
    const xi = s / L;
    f[0] += (1 - xi) * p[0]; f[6] += xi * p[0];
    f[3] += (1 - xi) * t; f[9] += xi * t;
    if (e.beam) {
      const N1 = 1 - 3 * xi * xi + 2 * xi ** 3, N2 = L * (xi - 2 * xi * xi + xi ** 3), N3 = 3 * xi * xi - 2 * xi ** 3, N4 = L * (-xi * xi + xi ** 3);
      f[1] += N1 * p[1]; f[5] += N2 * p[1]; f[7] += N3 * p[1]; f[11] += N4 * p[1];
      f[2] += N1 * p[2]; f[4] -= N2 * p[2]; f[8] += N3 * p[2]; f[10] -= N4 * p[2];
    } else { f[1] += (1 - xi) * p[1]; f[7] += xi * p[1]; f[2] += (1 - xi) * p[2]; f[8] += xi * p[2]; }
  };
  for (const d of LL.dist) {
    const a = d.s0, b = d.s1, hl = (b - a) / 2, mid = (a + b) / 2;
    for (const [gp, w] of G3) {
      const s = mid + hl * gp, t = (s - a) / (b - a || 1);
      addP(s, d.q0.map((v, k) => (v + (d.q1[k] - v) * t) * w * hl), 0);
    }
  }
  for (const d of LL.tq) {
    const a = d.s0, b = d.s1, hl = (b - a) / 2, mid = (a + b) / 2;
    for (const [gp, w] of G3) { const s = mid + hl * gp, t = (s - a) / (b - a || 1); addP(s, [0, 0, 0], (d.m0 + (d.m1 - d.m0) * t) * w * hl); }
  }
  for (const p of LL.point) addP(p.s, p.p, p.t || 0);
  if (LL.dT) { const F = e.E * e.A_ * e.alpha * LL.dT; f[0] -= F; f[6] += F; }
  return f;
}

// small dense inverse (Gauss–Jordan), n ≤ 6
function inv(A) {
  const n = A.length, M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c]; for (let j = 0; j < 2 * n; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; if (f) for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j]; }
  }
  return M.map(r => r.slice(n));
}

// Static condensation of released end rotations. Returns the condensed matrices plus the recovery
// map θ_b = C·u_a + d used to rebuild the released rotations.
function condense(e, k, f, extra = []) {
  const rel = [...(e.relA ? [4, 5] : []), ...(e.relB ? [10, 11] : [])];
  if (!rel.length) return { k, f, extra, rec: null };
  const keep = [...Array(12).keys()].filter(i => !rel.includes(i));
  const Kbb = inv(rel.map(r => rel.map(c => k[r][c])));
  // C = −Kbb⁻¹ Kba (rel × 12, zero on released columns)
  const C = rel.map((_, r) => { const row = new Float64Array(12); for (const a of keep) { let s = 0; for (let q = 0; q < rel.length; q++) s += Kbb[r][q] * k[rel[q]][a]; row[a] = -s; } return row; });
  const dv = rel.map((_, r) => { let s = 0; for (let q = 0; q < rel.length; q++) s += Kbb[r][q] * (f ? f[rel[q]] : 0); return s; });
  // T: 12×12 with identity on kept dofs and C on released rows → condensed X* = Tᵀ X T
  const T = zeros12(); for (const a of keep) T[a][a] = 1; rel.forEach((r, q) => { for (const a of keep) T[r][a] = C[q][a]; });
  const tr = X => { const Y = zeros12(); for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) { let s = 0; for (let p = 0; p < 12; p++) { if (!T[p][i]) continue; for (let q = 0; q < 12; q++) if (T[q][j]) s += T[p][i] * X[p][q] * T[q][j]; } Y[i][j] = s; } return Y; };
  const kc = tr(k);
  let fc = null;
  if (f) { fc = new Float64Array(12); for (const a of keep) { let s = f[a]; for (let q = 0; q < rel.length; q++) s += C[q][a] * f[rel[q]]; fc[a] = s; } }
  return { k: kc, f: fc, extra: extra.map(tr), rec: { rel, C, d: dv } };
}

// local (12) ↔ global (12) with R rows = local axes
function toGlobalMat(k, R) {
  // Kg = Tᵀ k T, T = diag(R,R,R,R)
  const out = zeros12(), tmp = zeros12();
  for (let i = 0; i < 12; i++) for (let J = 0; J < 4; J++) for (let c = 0; c < 3; c++) {
    tmp[i][3 * J + c] = k[i][3 * J] * R[0][c] + k[i][3 * J + 1] * R[1][c] + k[i][3 * J + 2] * R[2][c];
  }
  for (let I = 0; I < 4; I++) for (let r = 0; r < 3; r++) for (let j = 0; j < 12; j++) {
    out[3 * I + r][j] = R[0][r] * tmp[3 * I][j] + R[1][r] * tmp[3 * I + 1][j] + R[2][r] * tmp[3 * I + 2][j];
  }
  return out;
}
const vecToGlobal = (f, R) => { const o = new Float64Array(12); for (let I = 0; I < 4; I++) for (let c = 0; c < 3; c++) o[3 * I + c] = R[0][c] * f[3 * I] + R[1][c] * f[3 * I + 1] + R[2][c] * f[3 * I + 2]; return o; };
const vecToLocal = (u, R) => { const o = new Float64Array(12); for (let I = 0; I < 4; I++) for (let r = 0; r < 3; r++) o[3 * I + r] = R[r][0] * u[3 * I] + R[r][1] * u[3 * I + 1] + R[r][2] * u[3 * I + 2]; return o; };

// ---------------------------------------------------------------- mesh
// nsub = 1: one element per member (exact statics). nsub > 1: subdivided for modes / buckling;
// truss bars then become pin-ended beams without torsion so they can bow and buckle on their own.
export function buildMesh3d(P, nsub = 1, Nfun = null) {
  const model = P.model, nodes = model.nodes.map(n => ({ x: n.x, y: n.y, z: n.z || 0, orig: true }));
  const elems = [];
  P.members.forEach((m, mi) => {
    const ns = typeof nsub === 'function' ? nsub(mi) : nsub;
    const asBeam = ns > 1 && m.type === 'truss' && m.Iz > 0 && m.Iy > 0, beam = m.type === 'frame' || asBeam;
    const n = beam ? Math.max(1, ns) : 1;
    const LL = memberLoads3d(P, mi);
    let prev = m.i;
    for (let k = 0; k < n; k++) {
      let nxt;
      if (k === n - 1) nxt = m.j;
      else { const t = (k + 1) / n; nodes.push({ x: m.A[0] + (m.B[0] - m.A[0]) * t, y: m.A[1] + (m.B[1] - m.A[1]) * t, z: m.A[2] + (m.B[2] - m.A[2]) * t, member: mi }); nxt = nodes.length - 1; }
      const sa = m.L * k / n, sb = m.L * (k + 1) / n;
      elems.push({
        mi, n1: prev, n2: nxt, s0: sa, L: sb - sa, R: m.R, beam, E: m.E, G: m.G, rho: m.rho, alpha: m.alpha,
        A_: m.A_, Iy: m.Iy, Iz: m.Iz, J: m.J, Ip: m.Ip,
        // for buckling, warping restraint of open sections adds π²EIw/L² (member length) to GJ
        GJ: asBeam ? 0 : m.G * m.J + (Nfun ? Math.PI ** 2 * m.E * (m.sec.Iw || 0) / (m.L * m.L) : 0),
        relA: (m.relA || asBeam) && k === 0, relB: (m.relB || asBeam) && k === n - 1,
        LL: sliceLoads(LL, sa, sb, k === n - 1), N: Nfun ? Nfun(mi, (sa + sb) / 2) : 0,
      });
      prev = nxt;
    }
  });
  return { P, nodes, elems, ndof: 6 * nodes.length, nsub };
}

// Assemble K (and optionally M / KG) and the load vector; condensed elements store their recovery map.
function assemble(mesh, { mass = false, geo = false, loads = true } = {}) {
  const n = mesh.ndof, K = Array.from({ length: n }, () => new Float64Array(n));
  const M = mass ? Array.from({ length: n }, () => new Float64Array(n)) : null;
  const KG = geo ? Array.from({ length: n }, () => new Float64Array(n)) : null;
  const F = new Float64Array(n);
  for (const e of mesh.elems) {
    const kl = localK(e), fl = loads ? equivalentLoads(e, e.LL) : null;
    const ex = [];
    if (mass) ex.push(localM(e));
    if (geo) ex.push(localKG(e, e.N));
    const c = condense(e, kl, fl, ex);
    e.kc = c.k; e.fc = c.f; e.rec = c.rec;
    const dofs = [...Array(6).keys()].map(i => 6 * e.n1 + i).concat([...Array(6).keys()].map(i => 6 * e.n2 + i));
    const scatter = (G, X) => { const Xg = toGlobalMat(X, e.R); for (let i = 0; i < 12; i++) { const Gi = G[dofs[i]]; for (let j = 0; j < 12; j++) Gi[dofs[j]] += Xg[i][j]; } };
    scatter(K, c.k);
    let q = 0;
    if (mass) scatter(M, c.extra[q++]);
    if (geo) scatter(KG, c.extra[q++]);
    if (fl) { const fg = vecToGlobal(c.f, e.R); for (let i = 0; i < 12; i++) F[dofs[i]] += fg[i]; }
  }
  return { K, M, KG, F };
}

// Free-DOF basis: supported directions removed, and per node the rotation directions that carry no
// stiffness at all (only pinned ends / truss bars meet there). Each column has ≤ 3 non-zeros.
function freeBasis(mesh, K, restr) {
  const nn = mesh.nodes.length, cols = [];
  let rmax = 0; for (let i = 0; i < nn; i++) for (let d = 3; d < 6; d++) rmax = Math.max(rmax, K[6 * i + d][6 * i + d]);
  const tol = 1e-9 * (rmax || 1);
  for (let i = 0; i < nn; i++) {
    for (let d = 0; d < 3; d++) if (!restr[6 * i + d]) cols.push({ node: i, idx: [6 * i + d], v: [1], dir: d });
    const free = [3, 4, 5].filter(d => !restr[6 * i + d]);
    if (!free.length) continue;
    const B = free.map(a => free.map(b => K[6 * i + a][6 * i + b]));
    const { values, vectors } = symEig(B);
    values.forEach((lam, k) => {
      if (lam <= tol) return;
      const v = vectors[k];
      // label with the dominant global axis
      let dm = 0; for (let q = 1; q < v.length; q++) if (Math.abs(v[q]) > Math.abs(v[dm])) dm = q;
      cols.push({ node: i, idx: free.map(d => 6 * i + d), v: Array.from(v), dir: free[dm] });
    });
  }
  return cols;
}
function reduce(X, cols) {
  const n = cols.length, R = Array.from({ length: n }, () => new Float64Array(n));
  for (let a = 0; a < n; a++) {
    const ca = cols[a];
    for (let b = a; b < n; b++) {
      const cb = cols[b]; let s = 0;
      for (let p = 0; p < ca.idx.length; p++) { const Xp = X[ca.idx[p]]; for (let q = 0; q < cb.idx.length; q++) s += ca.v[p] * Xp[cb.idx[q]] * cb.v[q]; }
      R[a][b] = s; R[b][a] = s;
    }
  }
  return R;
}
const reduceVec = (F, cols) => cols.map(c => c.idx.reduce((s, d, p) => s + c.v[p] * F[d], 0));
function expand(x, cols, ndof) { const u = new Float64Array(ndof); cols.forEach((c, a) => c.idx.forEach((d, p) => { u[d] += c.v[p] * x[a]; })); return u; }

function restraints(mesh) {
  const model = mesh.P.model, restr = new Uint8Array(mesh.ndof), springs = new Float64Array(mesh.ndof);
  for (const sp of model.supports) {
    const i = mesh.P.nodeIndex.get(sp.node); if (i === undefined) continue;
    const r = sp.r || SUPPORT_TYPES[sp.type]?.r || [0, 0, 0, 0, 0, 0];
    for (let d = 0; d < 6; d++) { if (r[d]) restr[6 * i + d] = 1; else if (sp.k && sp.k[d] > 0) springs[6 * i + d] = sp.k[d]; }
  }
  return { restr, springs };
}

// recover the full local end displacements (including condensed rotations) for an element
function localEndDisp(e, U) {
  const ug = new Float64Array(12);
  for (let i = 0; i < 6; i++) { ug[i] = U[6 * e.n1 + i]; ug[6 + i] = U[6 * e.n2 + i]; }
  const ul = vecToLocal(ug, e.R);
  if (e.rec) e.rec.rel.forEach((r, q) => { let s = e.rec.d[q]; for (let a = 0; a < 12; a++) s += e.rec.C[q][a] * ul[a]; ul[r] = s; });
  return ul;
}

// ---------------------------------------------------------------- static analysis
function solveMesh(mesh, { mass = false, geo = false } = {}) {
  const { K, M, KG, F } = assemble(mesh, { mass, geo });
  const model = mesh.P.model, { restr, springs } = restraints(mesh);
  // nodal loads
  for (const ld of model.loads) {
    if (ld.kind !== 'node') continue;
    const i = mesh.P.nodeIndex.get(ld.node); if (i === undefined) continue;
    ['fx', 'fy', 'fz', 'mx', 'my', 'mz'].forEach((k, d) => { F[6 * i + d] += ld[k] || 0; });
  }
  const Ke = K.map(r => Float64Array.from(r));
  for (let d = 0; d < mesh.ndof; d++) if (springs[d]) K[d][d] += springs[d];
  const cols = freeBasis(mesh, K, restr);
  const Kr = reduce(K, cols);
  return { K, Ke, M, KG, F, restr, springs, cols, Kr };
}

export function analyze3d(model) {
  const P = prepare3d(model);
  if (!P.members.length) return { ok: false, error: 'empty' };
  for (const m of P.members) if (!(m.L > 0)) return { ok: false, error: 'zero-length', member: m.id };
  for (const m of P.members) if (!(m.A_ > 0) || !(m.E > 0)) return { ok: false, error: 'section', member: m.id };
  const mesh = buildMesh3d(P, 1);
  const S = solveMesh(mesh);
  const n = S.cols.length;
  if (!model.supports.length) return { ok: false, error: 'nosupports', P, mesh };
  const Fr = reduceVec(S.F, S.cols);
  const L = n ? cholesky(S.Kr, 1e-12) : [];
  if (L.fail !== undefined) {
    const c = S.cols[L.fail];
    let shape = null;
    if (n <= 600) { const { values, vectors } = symEig(S.Kr); let k0 = 0; for (let k = 1; k < values.length; k++) if (values[k] < values[k0]) k0 = k; shape = expand(vectors[k0], S.cols, mesh.ndof); }
    // describe the free motion by the node that moves most in it
    let node = c.node, dir = c.dir;
    if (shape) {
      let best = 0;
      for (let i = 0; i < model.nodes.length; i++) for (let d = 0; d < 3; d++) if (Math.abs(shape[6 * i + d]) > best) { best = Math.abs(shape[6 * i + d]); node = i; dir = d; }
      if (best < 1e-6) { best = 0; for (let i = 0; i < model.nodes.length; i++) for (let d = 3; d < 6; d++) if (Math.abs(shape[6 * i + d]) > best) { best = Math.abs(shape[6 * i + d]); node = i; dir = d; } }
    }
    return { ok: false, error: 'mechanism', node, dir, P, mesh, shape };
  }
  const ur = n ? cholSolve(L, Fr) : [];
  const U = expand(ur, S.cols, mesh.ndof);
  // reactions: R = Ke·u − F (includes spring forces at elastic supports)
  const Rf = new Float64Array(mesh.ndof);
  for (let i = 0; i < mesh.ndof; i++) { let s = -S.F[i]; const Ki = S.Ke[i]; for (let j = 0; j < mesh.ndof; j++) s += Ki[j] * U[j]; Rf[i] = s; }
  const reactions = model.supports.map(sp => {
    const i = P.nodeIndex.get(sp.node); if (i === undefined) return null;
    const F = Array.from({ length: 6 }, (_, d) => (S.restr[6 * i + d] || S.springs[6 * i + d] ? Rf[6 * i + d] : 0));
    return { node: sp.node, i, F };
  }).filter(Boolean);
  // members
  const members = mesh.elems.map(e => memberResult(P, e, U));
  // equilibrium check about the origin
  const app = appliedResultant(P), reac = [0, 0, 0, 0, 0, 0];
  for (const r of reactions) { const p = P3(model.nodes[r.i]); addWrench(reac, p, r.F.slice(0, 3), r.F.slice(3)); }
  const scaleF = Math.max(1e-9, ...app.map(Math.abs).slice(0, 3), ...reac.slice(0, 3).map(Math.abs));
  const scaleM = Math.max(1e-9, ...app.map(Math.abs).slice(3), ...reac.slice(3).map(Math.abs));
  const err = Math.max(...[0, 1, 2].map(k => Math.abs(app[k] + reac[k]) / scaleF), ...[3, 4, 5].map(k => Math.abs(app[k] + reac[k]) / scaleM));
  // maximum displacement
  let maxD = { v: 0, node: -1, vec: [0, 0, 0] };
  for (let i = 0; i < model.nodes.length; i++) { const v = Math.hypot(U[6 * i], U[6 * i + 1], U[6 * i + 2]); if (v > maxD.v) maxD = { v, node: i, vec: [U[6 * i], U[6 * i + 1], U[6 * i + 2]] }; }
  let maxMemberD = { v: 0, member: -1, s: 0 };
  for (const mr of members) mr.dg.forEach((d, k) => { const v = Math.hypot(...d); if (v > maxMemberD.v) maxMemberD = { v, member: mr.mi, s: mr.s[k] }; });
  let crit = null; for (const mr of members) if (!crit || mr.stress.util > crit.stress.util) crit = mr;
  const mass = P.members.reduce((s, m) => s + m.rho * m.A_ * m.L, 0);
  return { ok: true, P, mesh, U, reactions, members, applied: app, reactionSum: reac, eqErr: err, maxD, maxMemberD, crit, mass, ndof: n };
}

function addWrench(acc, p, f, m = [0, 0, 0]) { const r = cross(p, f); for (let k = 0; k < 3; k++) { acc[k] += f[k]; acc[3 + k] += r[k] + m[k]; } }

// Resultant (force, moment about origin) of every applied load, in global axes
export function appliedResultant(P) {
  const out = [0, 0, 0, 0, 0, 0], model = P.model;
  for (const ld of model.loads) if (ld.kind === 'node') { const i = P.nodeIndex.get(ld.node); if (i === undefined) continue; addWrench(out, P3(model.nodes[i]), [ld.fx || 0, ld.fy || 0, ld.fz || 0], [ld.mx || 0, ld.my || 0, ld.mz || 0]); }
  P.members.forEach((m, mi) => {
    const LL = memberLoads3d(P, mi), R = m.R;
    const g = l => [0, 1, 2].map(c => R[0][c] * l[0] + R[1][c] * l[1] + R[2][c] * l[2]);
    const pos = s => [0, 1, 2].map(c => m.A[c] + R[0][c] * s);
    for (const d of LL.dist) { const a = d.s0, b = d.s1, hl = (b - a) / 2, mid = (a + b) / 2; for (const [gp, w] of G3) { const s = mid + hl * gp, t = (s - a) / (b - a || 1); addWrench(out, pos(s), g(d.q0.map((v, k) => (v + (d.q1[k] - v) * t) * w * hl))); } }
    for (const d of LL.tq) { const tot = (d.m0 + d.m1) / 2 * (d.s1 - d.s0); addWrench(out, [0, 0, 0], [0, 0, 0], R[0].map(v => v * tot)); }
    for (const p of LL.point) addWrench(out, pos(p.s), g(p.p), R[0].map(v => v * (p.t || 0)));
  });
  return out;
}

// ---------------------------------------------------------------- member results
// Internal forces at s from the exact end forces f (forces by node on member, local) and the loads.
// Positive-face convention: N tension +, Vy/Vz along +y/+z, T and My/Mz as right-hand vectors on +x face.
function internalAt(f, LL, s, right = true) {
  let Fx = 0, Fy = 0, Fz = 0, Tq = 0, My = 0, Mz = 0;
  const GP = [[-0.5773502691896257, 1], [0.5773502691896257, 1]];
  for (const d of LL.dist) {
    const a = d.s0, b = Math.min(d.s1, s); if (b <= a) continue;
    const hl = (b - a) / 2, mid = (a + b) / 2;
    for (const [gp, w] of GP) {
      const x = mid + hl * gp, t = (x - d.s0) / (d.s1 - d.s0 || 1), W = w * hl;
      const qx = d.q0[0] + (d.q1[0] - d.q0[0]) * t, qy = d.q0[1] + (d.q1[1] - d.q0[1]) * t, qz = d.q0[2] + (d.q1[2] - d.q0[2]) * t;
      Fx += qx * W; Fy += qy * W; Fz += qz * W; Mz += (s - x) * qy * W; My -= (s - x) * qz * W;
    }
  }
  for (const d of LL.tq) {
    const a = d.s0, b = Math.min(d.s1, s); if (b <= a) continue;
    const ta = d.m0 + (d.m1 - d.m0) * (a - d.s0) / (d.s1 - d.s0 || 1), tb = d.m0 + (d.m1 - d.m0) * (b - d.s0) / (d.s1 - d.s0 || 1);
    Tq += (ta + tb) / 2 * (b - a);
  }
  for (const p of LL.point) {
    if (right ? p.s > s : p.s >= s) continue;
    Fx += p.p[0]; Fy += p.p[1]; Fz += p.p[2]; Tq += p.t || 0; Mz += (s - p.s) * p.p[1]; My -= (s - p.s) * p.p[2];
  }
  return {
    N: -(f[0] + Fx), Vy: -(f[1] + Fy), Vz: -(f[2] + Fz), T: -(f[3] + Tq),
    Mz: -f[5] + s * f[1] + Mz, My: -f[4] - s * f[2] + My,
  };
}

function memberResult(P, e, U) {
  const m = P.members[e.mi], S = m.sec, L = e.L;
  const ul = localEndDisp(e, U);
  // end forces f = k·u − f_eq (condensed: released moments are zero)
  const f = new Float64Array(12);
  for (let i = 0; i < 12; i++) { let s = -(e.fc ? e.fc[i] : 0); for (let j = 0; j < 12; j++) s += e.kc[i][j] * ul[j]; f[i] = s; }
  if (e.rec) for (const r of e.rec.rel) f[r] = 0;
  // sample positions: uniform + both sides of point loads
  const ss = []; const NS = 48;
  for (let k = 0; k <= NS; k++) ss.push({ s: L * k / NS, right: true });
  for (const p of e.LL.point) if (p.s > 1e-9 * L && p.s < L * (1 - 1e-9)) { ss.push({ s: p.s, right: false }, { s: p.s, right: true }); }
  for (const d of e.LL.dist) for (const b of [d.s0, d.s1]) if (b > 1e-9 * L && b < L * (1 - 1e-9)) ss.push({ s: b, right: true });
  ss.sort((a, b) => a.s - b.s || (a.right ? 1 : 0) - (b.right ? 1 : 0));
  const s = [], N = [], Vy = [], Vz = [], T = [], My = [], Mz = [];
  for (const q of ss) {
    const r = internalAt(f, e.LL, q.s, q.right);
    s.push(q.s); N.push(r.N); Vy.push(r.Vy); Vz.push(r.Vz); T.push(r.T); My.push(r.My); Mz.push(r.Mz);
  }
  // clean round-off
  const clean = arr => { let mx = 0; for (const v of arr) mx = Math.max(mx, Math.abs(v)); return mx; };
  const ref = Math.max(clean(N), clean(Vy) * L, clean(Vz) * L, clean(My), clean(Mz), clean(T), 1e-30);
  for (const arr of [N, T, My, Mz]) for (let k = 0; k < arr.length; k++) if (Math.abs(arr[k]) < 1e-10 * ref) arr[k] = 0;
  for (const arr of [Vy, Vz]) for (let k = 0; k < arr.length; k++) if (Math.abs(arr[k]) * L < 1e-10 * ref) arr[k] = 0;
  // displacements along the member: integrate curvature / strain / twist, matching end values
  const n = s.length, v = new Float64Array(n), w = new Float64Array(n), ua = new Float64Array(n), ph = new Float64Array(n);
  // values at interval midpoints so curvature is integrated with Simpson's rule (exact for uniform loads)
  const mid = [null];
  for (let k = 1; k < n; k++) mid.push(internalAt(f, e.LL, (s[k - 1] + s[k]) / 2, true));
  const integ2 = (kap, kapM, y0, y1, out) => {
    let sl = 0; const y = new Float64Array(n);
    for (let k = 1; k < n; k++) { const h = s[k] - s[k - 1], km = kapM(mid[k]); y[k] = y[k - 1] + sl * h + h * h * (kap[k - 1] + 2 * km) / 6; sl += h / 6 * (kap[k - 1] + 4 * km + kap[k]); }
    const c = (y1 - y0 - y[n - 1]) / L;
    for (let k = 0; k < n; k++) out[k] = y0 + y[k] + c * s[k];
  };
  const integ1 = (str, strM, y0, y1, out) => {
    const y = new Float64Array(n);
    for (let k = 1; k < n; k++) y[k] = y[k - 1] + (str[k - 1] + 4 * strM(mid[k]) + str[k]) / 6 * (s[k] - s[k - 1]);
    const c = (y1 - y0 - y[n - 1]) / L;
    for (let k = 0; k < n; k++) out[k] = y0 + y[k] + c * s[k];
  };
  const EIz = m.E * (m.Iz || 1), EIy = m.E * (m.Iy || 1), GJ = m.G * m.J || 1, EA = m.E * m.A_;
  integ2(Mz.map(x => x / EIz), q => q.Mz / EIz, ul[1], ul[7], v);
  integ2(My.map(x => -x / EIy), q => -q.My / EIy, ul[2], ul[8], w);
  if (e.beam) integ1(T.map(x => x / GJ), q => q.T / GJ, ul[3], ul[9], ph);
  integ1(N.map(x => x / EA), q => q.N / EA, ul[0], ul[6], ua);
  const R = m.R, dg = [];
  for (let k = 0; k < n; k++) dg.push([0, 1, 2].map(c => R[0][c] * ua[k] + R[1][c] * v[k] + R[2][c] * w[k]));
  // stresses: peak normal stress at the extreme fibres, shear from torsion plus transverse shear
  let worst = { util: 0, vm: 0, sigma: 0, tau: 0, s: 0 };
  const sig = [], tau = [], vm = [];
  for (let k = 0; k < n; k++) {
    const bend = S.round ? Math.hypot(My[k], Mz[k]) * S.cy / S.Iz : Math.abs(My[k]) * S.cz / S.Iy + Math.abs(Mz[k]) * S.cy / S.Iz;
    const sg = Math.abs(N[k] / S.A) + bend;
    const tv = m.type === 'frame' ? Math.abs(T[k]) * S.kt + (S.round ? Math.hypot(Vy[k], Vz[k]) * S.ky : Math.abs(Vy[k]) * S.ky + Math.abs(Vz[k]) * S.kz) : 0;
    const v_ = Math.sqrt(sg * sg + 3 * tv * tv);
    sig.push(sg); tau.push(tv); vm.push(v_);
    if (v_ > worst.vm) worst = { vm: v_, util: v_ / m.fy, sigma: sg, tau: tv, s: s[k] };
  }
  let sMax = 0, tMax = 0; for (let k = 0; k < n; k++) { sMax = Math.max(sMax, sig[k]); tMax = Math.max(tMax, tau[k]); }
  const ext = arr => { let lo = 0, hi = 0; for (const x of arr) { if (x < lo) lo = x; if (x > hi) hi = x; } return Math.abs(lo) > Math.abs(hi) ? lo : hi; };
  // axial buckling check for compression members (Euler, pinned ends or as-modelled K = 1)
  const Nmin = Math.min(...N), Imin = Math.min(m.Iy, m.Iz);
  const Pcr = Math.PI ** 2 * m.E * Imin / (m.L * m.L);
  return {
    id: m.id, mi: e.mi, L, f, ul, s, N, Vy, Vz, T, My, Mz, dg, twist: ph, sig, tau, vm,
    ext: { N: ext(N), Vy: ext(Vy), Vz: ext(Vz), T: ext(T), My: ext(My), Mz: ext(Mz) },
    stress: { ...worst, sMax, tMax }, euler: Nmin < 0 ? { Pcr, ratio: -Nmin / Pcr } : null,
  };
}

// Interpolate a member result at position s (used by buckling to find sub-element axial forces)
function valueAt(mr, key, s) {
  const xs = mr.s, ys = mr[key];
  if (s <= xs[0]) return ys[0];
  for (let k = 1; k < xs.length; k++) if (s <= xs[k]) { const t = (s - xs[k - 1]) / (xs[k] - xs[k - 1] || 1); return ys[k - 1] + (ys[k] - ys[k - 1]) * t; }
  return ys[ys.length - 1];
}

// ---------------------------------------------------------------- modal analysis
function chooseNsub(P, budget) {
  const nm = P.members.filter(m => m.type === 'frame' || m.Iz > 0).length || 1, nn = P.model.nodes.length;
  return Math.max(1, Math.min(8, Math.floor((budget / 6 - nn) / nm) + 1));
}

export function modal3d(model, { nModes = 10, nsub } = {}) {
  const P = prepare3d(model);
  if (!P.members.length || !model.supports.length) return { ok: false, error: 'empty' };
  for (const m of P.members) if (!(m.L > 0)) return { ok: false, error: 'zero-length' };
  const mesh = buildMesh3d(P, nsub || chooseNsub(P, 330));
  const S = solveMesh(mesh, { mass: true });
  const n = S.cols.length;
  if (!n) return { ok: false, error: 'nodof' };
  const Mr = reduce(S.M, S.cols);
  let mmax = 0; for (let i = 0; i < n; i++) mmax = Math.max(mmax, Mr[i][i]);
  for (let i = 0; i < n; i++) if (Mr[i][i] < 1e-10 * mmax) Mr[i][i] = 1e-10 * mmax; // massless spring-only rotations
  const Lk = cholesky(S.Kr, 1e-12);
  if (Lk.fail !== undefined) return { ok: false, error: 'mechanism' };
  const ge = symGenEig(S.Kr, Mr);
  if (ge.error) return { ok: false, error: 'eig' };
  // rigid-body influence vectors for effective mass
  const infl = [0, 1, 2].map(d => { const r = new Float64Array(mesh.ndof); for (let i = 0; i < mesh.nodes.length; i++) r[6 * i + d] = 1; return reduceVec(r, S.cols); });
  const Mi = infl.map(r => Mr.map(row => row.reduce((s, v, j) => s + v * r[j], 0)));
  const tot = infl.map((r, d) => r.reduce((s, v, j) => s + v * Mi[d][j], 0));
  const modes = [];
  for (let k = 0; k < ge.values.length && modes.length < nModes; k++) {
    const lam = ge.values[k]; if (!(lam > 0)) continue;
    const x = ge.vectors[k], phi = expand(x, S.cols, mesh.ndof);
    const Lfac = Mi.map(mi => mi.reduce((s, v, j) => s + v * x[j], 0));
    let mx = 0; for (let i = 0; i < mesh.nodes.length; i++) mx = Math.max(mx, Math.hypot(phi[6 * i], phi[6 * i + 1], phi[6 * i + 2]));
    const shape = phi.map(v => v / (mx || 1));
    const w = Math.sqrt(lam);
    modes.push({ omega: w, f: w / (2 * Math.PI), T: 2 * Math.PI / w, phi, shape, L: Lfac, eff: Lfac.map(l => l * l), dominant: dominantDir(phi, mesh) });
  }
  const mass = P.members.reduce((s, m) => s + m.rho * m.A_ * m.L, 0);
  return { ok: true, mesh, modes, mass, massFree: tot, ndof: n };
}

function dominantDir(phi, mesh) {
  const t = [0, 0, 0]; let r = 0;
  for (let i = 0; i < mesh.nodes.length; i++) { for (let d = 0; d < 3; d++) t[d] += phi[6 * i + d] ** 2; }
  for (let i = 0; i < mesh.nodes.length; i++) r += phi[6 * i + 3] ** 2 + phi[6 * i + 4] ** 2 + phi[6 * i + 5] ** 2;
  void r;
  const k = t.indexOf(Math.max(...t));
  return 'XYZ'[k];
}

// ---------------------------------------------------------------- linear buckling
export function buckling3d(model, { nModes = 4, nsub, stat } = {}) {
  const R = stat || analyze3d(model);
  if (!R.ok) return { ok: false, error: 'static' };
  const P = R.P;
  if (!R.members.some(mr => Math.min(...mr.N) < -1e-9 * Math.max(1, Math.abs(mr.ext.N)))) return { ok: true, modes: [], none: true };
  // every member in compression gets at least two elements so it can buckle on its own
  let ns = nsub;
  if (!ns) {
    const comp = R.members.map(mr => Math.min(...mr.N) < -1e-6 * Math.max(1, Math.abs(mr.ext.N)));
    const uni = chooseNsub(P, 330);
    ns = uni >= 2 ? uni : mi => (comp[mi] ? 2 : 1);
  }
  const mesh = buildMesh3d(P, ns, (mi, s) => valueAt(R.members[mi], 'N', s));
  const S = solveMesh(mesh, { geo: true });
  const KGr = reduce(S.KG, S.cols).map(r => r.map(v => -v));
  const ge = symGenEig(KGr, S.Kr);
  if (ge.error) return { ok: false, error: 'eig' };
  const modes = [];
  for (let k = ge.values.length - 1; k >= 0 && modes.length < nModes; k--) {
    const mu = ge.values[k]; if (!(mu > 1e-12)) break;
    const phi = expand(ge.vectors[k], S.cols, mesh.ndof);
    let mx = 0; for (let i = 0; i < mesh.nodes.length; i++) mx = Math.max(mx, Math.hypot(phi[6 * i], phi[6 * i + 1], phi[6 * i + 2]));
    modes.push({ lambda: 1 / mu, shape: phi.map(v => v / (mx || 1)) });
  }
  return { ok: true, mesh, modes };
}

// Deformed shape of a mesh element as global points (Hermite cubic in each bending plane)
export function elementCurve3d(mesh, e, U, scale, n = 6) {
  const ul = localEndDisp(e, U), L = e.L, R = e.R, A = mesh.nodes[e.n1];
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const xi = k / n, s = L * xi;
    let v, w;
    if (e.beam) {
      const N1 = 1 - 3 * xi * xi + 2 * xi ** 3, N2 = L * (xi - 2 * xi * xi + xi ** 3), N3 = 3 * xi * xi - 2 * xi ** 3, N4 = L * (-xi * xi + xi ** 3);
      v = N1 * ul[1] + N2 * ul[5] + N3 * ul[7] + N4 * ul[11];
      w = N1 * ul[2] - N2 * ul[4] + N3 * ul[8] - N4 * ul[10];
    } else { v = (1 - xi) * ul[1] + xi * ul[7]; w = (1 - xi) * ul[2] + xi * ul[8]; }
    const u = (1 - xi) * ul[0] + xi * ul[6];
    pts.push([0, 1, 2].map(c => [A.x, A.y, A.z][c] + R[0][c] * s + scale * (R[0][c] * u + R[1][c] * v + R[2][c] * w)));
  }
  return pts;
}
