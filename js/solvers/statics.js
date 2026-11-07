// Rigid-body statics of the drawn structure: free-body diagrams, equilibrium equations,
// determinacy/stability, a textbook-order solution, and friction / tipping / cable slack checks.
//
// The structure is split into rigid bodies (frame members joined rigidly), two-force members
// (trusses, cables, and frame members hinged at both ends with no load between) and pins (nodes
// where bodies meet through hinges). Unknowns: support reactions, two-force member forces and pin
// forces. Equations: 3 per body + 2 per pin. Unilateral supports (contact N ≥ 0, |F| ≤ µN; cables
// T ≥ 0) are handled by a linear program that finds the largest load factor that can be held.

import { prepare, memberLocalLoads, memberResultant, SUPPORT_DOFS } from './frame2d.js';
import { rankInfo, linprog } from '../lib/eigen.js';
import { luFactor, luSolve } from '../lib/linalg.js';

const deg = Math.PI / 180;

export function nodeLabel(model, id) {
  const i = model.nodes.findIndex(n => n.id === id);
  return i < 0 ? '?' : letters(i);
}
export function letters(i) { let s = ''; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; }

// ---------------------------------------------------------------- topology
export function topology(model) {
  const P = prepare(model);
  const loadsOn = new Set(model.loads.filter(l => l.member).map(l => l.member));
  const selfW = !!model.settings?.selfWeight;
  const twoForce = P.members.map(m => m.type !== 'frame' || (m.src.relA && m.src.relB && !loadsOn.has(m.id) && !(selfW && m.rho > 0)));
  // union-find bodies over rigid connections
  const parent = P.members.map((_, k) => k), find = k => (parent[k] === k ? k : (parent[k] = find(parent[k])));
  const rigidAt = new Map(); // node index -> members rigidly attached
  P.members.forEach((m, k) => {
    if (twoForce[k]) return;
    if (!m.relA) (rigidAt.get(m.i) || rigidAt.set(m.i, []).get(m.i)).push(k);
    if (!m.relB) (rigidAt.get(m.j) || rigidAt.set(m.j, []).get(m.j)).push(k);
  });
  for (const list of rigidAt.values()) for (let q = 1; q < list.length; q++) parent[find(list[q])] = find(list[0]);
  const bodyOf = new Map(), bodies = [];
  P.members.forEach((m, k) => {
    if (twoForce[k]) return;
    const r = find(k);
    if (!bodyOf.has(r)) { bodyOf.set(r, bodies.length); bodies.push({ members: [], nodes: new Set() }); }
    const b = bodies[bodyOf.get(r)]; b.members.push(k); b.nodes.add(m.i); b.nodes.add(m.j);
  });
  const memberBody = P.members.map((_, k) => (twoForce[k] ? -1 : bodyOf.get(find(k))));
  // attachments at each node: [{body, rigid}]
  const att = model.nodes.map(() => []);
  P.members.forEach((m, k) => {
    const b = memberBody[k]; if (b < 0) return;
    for (const [ni, rel] of [[m.i, m.relA], [m.j, m.relB]]) {
      const ex = att[ni].find(a => a.body === b && a.rigid === !rel);
      if (!ex) att[ni].push({ body: b, rigid: !rel });
    }
  });
  // a node merges into its body when exactly one rigid attachment exists there
  const merged = att.map(a => (a.length === 1 && a[0].rigid ? a[0].body : -1));
  return { P, twoForce, bodies, memberBody, att, merged };
}

// ---------------------------------------------------------------- equations
// Build unknowns and equilibrium equations. loadFilter(ld) selects which loads contribute (null = all;
// self weight is included when selfWeight passes through filter 'self').
export function buildSystem(model, T, loadFilter = null) {
  const { P, twoForce, bodies, att, merged } = T;
  const nodes = model.nodes, unknowns = [];
  const lbl = i => letters(i);
  const U = (u) => { unknowns.push(u); return unknowns.length - 1; };
  // where do node-level moments go: merged body, or the first rigid attachment at a pin node
  const momentBody = i => { if (merged[i] >= 0) return merged[i]; const r = att[i].find(a => a.rigid); return r ? r.body : -1; };
  // supports
  const supU = new Map(); // node index -> [{u, dir:[x,y] | 'M'}]
  for (const sp of model.supports) {
    const i = P.nodeIndex.get(sp.node); if (i === undefined) continue;
    const a = (sp.angle || 0) * deg, inc = Math.abs(a) > 1e-9;
    const tdir = [Math.cos(a), Math.sin(a)], ndir = [-Math.sin(a), Math.cos(a)];
    let dofs = SUPPORT_DOFS[sp.type] || [0, 0, 0];
    if (sp.type === 'spring') dofs = [sp.kx > 0 ? 1 : 0, sp.ky > 0 ? 1 : 0, sp.kr > 0 ? 1 : 0];
    if (sp.type === 'contact') dofs = [sp.mu > 0 ? 1 : 0, 1, 0];
    const list = [];
    const contact = sp.type === 'contact';
    if (dofs[0]) list.push({ u: U({ kind: 'F', name: contact ? `F_${lbl(i)}` : inc ? `${lbl(i)}_t` : `${lbl(i)}_x`, node: i, dir: tdir, role: contact ? 'friction' : 'reaction', sp }), dir: tdir });
    if (dofs[1]) list.push({ u: U({ kind: 'F', name: contact ? `N_${lbl(i)}` : inc ? `${lbl(i)}_n` : `${lbl(i)}_y`, node: i, dir: ndir, role: contact ? 'normal' : 'reaction', sp }), dir: ndir });
    // a moment restraint only acts if something rigid is attached at that node
    if (dofs[2] && momentBody(i) >= 0) list.push({ u: U({ kind: 'M', name: `M_${lbl(i)}`, node: i, role: 'reaction', sp }), dir: 'M' });
    supU.set(i, list);
  }
  // two-force members (tension +)
  const tfU = new Map();
  P.members.forEach((m, k) => { if (twoForce[k]) tfU.set(k, U({ kind: 'F', name: `F_${lbl(m.i)}${lbl(m.j)}`, member: k, role: m.type === 'cable' ? 'cable' : 'member' })); });
  // pin forces on bodies at pin nodes
  const pinU = new Map(); // `${node}|${attIdx}` -> [ux, uy]
  att.forEach((list, i) => {
    if (merged[i] >= 0 || !list.length) return;
    list.forEach((a, q) => {
      const tag = list.length > 1 ? `${lbl(i)}${a.body + 1}` : lbl(i);
      pinU.set(`${i}|${q}`, [U({ kind: 'F', name: `P${tag}_x`, node: i, body: a.body, dir: [1, 0], role: 'pin' }), U({ kind: 'F', name: `P${tag}_y`, node: i, body: a.body, dir: [0, 1], role: 'pin' })]);
    });
  });
  const lost = [];
  // collect force contributions per "particle" (body b or pin node i)
  // a force item: {target: {body}|{node}, x, y, coef vector or constant}
  const items = []; // {tb: body|-1, tn: node|-1, px, py, fx, fy, m, u, const, label}
  const target = i => (merged[i] >= 0 ? { tb: merged[i], tn: -1 } : { tb: -1, tn: i });
  const use = ld => (loadFilter ? loadFilter(ld) : true);
  for (const ld of model.loads) {
    const i = P.nodeIndex.get(ld.node); if (i === undefined || !use(ld)) continue;
    const n = nodes[i];
    if (ld.kind === 'force') items.push({ ...target(i), px: n.x, py: n.y, fx: ld.fx || 0, fy: ld.fy || 0, m: 0, u: -1, label: `load at ${lbl(i)}`, load: ld });
    else if (ld.kind === 'moment') {
      const b = momentBody(i);
      if (b >= 0) items.push({ tb: b, tn: -1, px: n.x, py: n.y, fx: 0, fy: 0, m: ld.m || 0, u: -1, label: `moment at ${lbl(i)}`, load: ld });
      else lost.push(lbl(i));
    }
  }
  // member loads (resultants) act on the member's body
  P.members.forEach((m, k) => {
    const b = T.memberBody[k]; if (b < 0) return;
    const parts = memberParts(P, k, model, use);
    for (const r of parts) items.push({ tb: b, tn: -1, px: 0, py: 0, fx: r.Fx, fy: r.Fy, m: r.Mo, u: -1, label: r.label, load: r.load, origin: true });
  });
  // support reactions
  for (const [i, list] of supU) {
    const n = nodes[i], tg = target(i);
    for (const s of list) {
      if (s.dir === 'M') {
        const b = momentBody(i);
        if (b >= 0) items.push({ tb: b, tn: -1, px: n.x, py: n.y, fx: 0, fy: 0, m: 1, u: s.u });
        else unknowns[s.u].idle = true;
      } else items.push({ ...tg, px: n.x, py: n.y, fx: s.dir[0], fy: s.dir[1], m: 0, u: s.u });
    }
  }
  // two-force members: tension pulls each end node toward the other
  for (const [k, u] of tfU) {
    const m = P.members[k];
    for (const [ni, sgn] of [[m.i, 1], [m.j, -1]]) { const n = nodes[ni]; items.push({ ...target(ni), px: n.x, py: n.y, fx: sgn * m.c, fy: sgn * m.s, m: 0, u }); }
  }
  // pin forces: +on body, −on the pin node
  for (const [key, [ux, uy]] of pinU) {
    const [i, q] = key.split('|').map(Number), b = att[i][q].body, n = nodes[i];
    items.push({ tb: b, tn: -1, px: n.x, py: n.y, fx: 1, fy: 0, m: 0, u: ux }, { tb: b, tn: -1, px: n.x, py: n.y, fx: 0, fy: 1, m: 0, u: uy });
    items.push({ tb: -1, tn: i, px: n.x, py: n.y, fx: -1, fy: 0, m: 0, u: ux }, { tb: -1, tn: i, px: n.x, py: n.y, fx: 0, fy: -1, m: 0, u: uy });
  }
  const nu = unknowns.length;
  // equation builders
  const eqF = (sel, axis) => { const a = new Float64Array(nu); let c = 0; for (const it of items) if (sel(it)) { const v = axis === 0 ? it.fx : it.fy; if (it.u >= 0) a[it.u] += v; else c += v; } return { a, c }; };
  const eqM = (sel, qx, qy) => {
    const a = new Float64Array(nu); let c = 0;
    for (const it of items) if (sel(it)) {
      // moment of force about (qx, qy) + couple; member-load items carry moment about origin
      const mom = it.origin ? it.m - (qx * it.fy - qy * it.fx) : (it.px - qx) * it.fy - (it.py - qy) * it.fx + it.m;
      if (it.u >= 0) a[it.u] += mom; else c += mom;
    }
    return { a, c };
  };
  const eqs = [];
  bodies.forEach((B, b) => {
    const sel = it => it.tb === b, ref = nodes[[...B.nodes][0]];
    eqs.push({ ...eqF(sel, 0), kind: 'F', name: `ΣFx = 0 (body ${b + 1})`, owner: { body: b }, axis: 'x' });
    eqs.push({ ...eqF(sel, 1), kind: 'F', name: `ΣFy = 0 (body ${b + 1})`, owner: { body: b }, axis: 'y' });
    eqs.push({ ...eqM(sel, ref.x, ref.y), kind: 'M', name: `ΣM = 0 (body ${b + 1})`, owner: { body: b }, about: [ref.x, ref.y] });
  });
  const pinNodes = [];
  nodes.forEach((n, i) => {
    if (merged[i] >= 0) return;
    const has = items.some(it => it.tn === i);
    if (!has) return;
    pinNodes.push(i);
    eqs.push({ ...eqF(it => it.tn === i, 0), kind: 'F', name: `ΣFx = 0 (joint ${lbl(i)})`, owner: { node: i }, axis: 'x' });
    eqs.push({ ...eqF(it => it.tn === i, 1), kind: 'F', name: `ΣFy = 0 (joint ${lbl(i)})`, owner: { node: i }, axis: 'y' });
  });
  return { unknowns, eqs, items, eqF, eqM, supU, tfU, pinU, pinNodes, lost, bodies, nu };
}

// Member loads split per load so each can be scaled independently; resultant + moment about origin
function memberParts(P, k, model, use) {
  const out = [], m = P.members[k];
  const sw = model.settings?.selfWeight && m.rho > 0 && use({ kind: 'self' });
  const own = model.loads.filter(l => l.member === m.id && l.kind !== 'thermal' && use(l));
  const saved = model.loads, savedS = model.settings;
  try {
    for (const ld of own) {
      P.model = { ...model, loads: [ld], settings: { ...savedS, selfWeight: false } };
      const r = memberResultant(P, k); out.push({ ...r, load: ld, label: 'member load' });
    }
    if (sw) {
      P.model = { ...model, loads: [], settings: { ...savedS, selfWeight: true } };
      const r = memberResultant(P, k); out.push({ ...r, load: { kind: 'self' }, label: 'self weight' });
    }
  } finally { P.model = model; model.loads = saved; }
  return out;
}

// ---------------------------------------------------------------- solve
export function analyzeStatics(model, { scale = 'all' } = {}) {
  if (!model.members.length) return { ok: false, error: 'empty' };
  const T = topology(model);
  for (const m of T.P.members) if (!(m.L > 0)) return { ok: false, error: 'zero-length' };
  const S = buildSystem(model, T);
  const { unknowns, eqs, nu } = S, ne = eqs.length;
  const A = eqs.map(e => Array.from(e.a)), c = eqs.map(e => e.c);
  // scale columns of moment unknowns for a fair rank test
  const L0 = Math.max(1e-9, ...T.P.members.map(m => m.L));
  const As = A.map(r => r.map((v, j) => v / (unknowns[j].kind === 'M' ? L0 : 1))).map((r, i) => r.map(v => v / (eqs[i].kind === 'M' ? L0 : 1)));
  const ri = rankInfo(As, 1e-9);
  const rank = ri.rank;
  const out = { ok: true, T, S, nu, ne, rank, degree: nu - rank, unstable: rank < ne, bodies: T.bodies.length, joints: S.pinNodes.length, lost: S.lost };
  out.unknownCount = { reactions: unknowns.filter(u => ['reaction', 'normal', 'friction'].includes(u.role)).length, members: S.tfU.size, pins: S.pinU.size * 2 };
  out.classification = out.unstable ? (out.degree > 0 ? 'unstable-indeterminate' : 'unstable') : out.degree > 0 ? 'indeterminate' : 'determinate';
  // linear solve when the system is square and full rank; otherwise least squares for a consistency check
  let x = null;
  if (!out.unstable && out.degree === 0) {
    const n = nu, M = new Float64Array(n * n), b = new Float64Array(n);
    // pick nu independent equations (all of them when ne == nu)
    const rows = independentRows(As, rank);
    rows.forEach((r, i) => { for (let j = 0; j < n; j++) M[i * n + j] = A[r][j]; b[i] = -c[r]; });
    x = Array.from(luSolve(luFactor(M, n), b));
  } else if (out.unstable) {
    // check whether these particular loads can still be held (consistent system)
    x = leastSquares(A, c.map(v => -v), nu);
    const res = Math.max(...A.map((r, i) => Math.abs(r.reduce((s, a, j) => s + a * x[j], 0) + c[i])));
    const scaleF = Math.max(1e-9, ...c.map(Math.abs));
    out.consistent = res < 1e-6 * scaleF;
    if (!out.consistent) x = null;
    out.mechanismHint = describeMechanism(As, eqs);
  }
  out.x = x;
  if (x) {
    out.values = unknowns.map((u, j) => ({ ...u, value: x[j] }));
    out.steps = textbookSteps(model, T, S, x, out);
    out.checks = unilateralChecks(model, S, x);
  }
  // friction / tipping / cable slack: limit load factor by LP
  const unilateral = unknowns.some(u => u.role === 'normal' || u.role === 'cable');
  if (unilateral && !out.unstable) out.limit = limitAnalysis(model, T, scale);
  else if (unilateral && out.unstable) out.limit = limitAnalysis(model, T, scale);
  return out;
}

function independentRows(As, rank) {
  const rows = [], cur = [];
  for (let i = 0; i < As.length && rows.length < rank; i++) {
    const test = [...cur, As[i]];
    if (rankInfo(test, 1e-9).rank > cur.length) { cur.push(As[i]); rows.push(i); }
  }
  return rows;
}
function leastSquares(A, b, n) {
  // normal equations with tiny Tikhonov regularisation (minimum-norm-ish solution)
  const N = new Float64Array(n * n), r = new Float64Array(n);
  let tr = 0;
  for (let i = 0; i < A.length; i++) for (let j = 0; j < n; j++) { r[j] += A[i][j] * b[i]; for (let k = 0; k < n; k++) N[j * n + k] += A[i][j] * A[i][k]; }
  for (let j = 0; j < n; j++) tr += N[j * n + j];
  for (let j = 0; j < n; j++) N[j * n + j] += 1e-12 * (tr / n || 1);
  return Array.from(luSolve(luFactor(N, n), r));
}
function describeMechanism(As, eqs) {
  // equations that cannot be satisfied independently -> the bodies/joints that can move
  const ri = rankInfo(As.map(r => r.slice()).length ? transpose(As) : [], 1e-9);
  const owners = ri.freeCols.map(i => eqs[i]?.owner).filter(Boolean);
  return owners;
}
const transpose = A => A[0].map((_, j) => A.map(r => r[j]));

// ---------------------------------------------------------------- textbook-order steps
// Greedily choose equations with a single remaining unknown (whole structure first, then bodies,
// then joints), trying moment points at every node so each step isolates one unknown.
function textbookSteps(model, T, S, x, out) {
  const { unknowns, eqF, eqM, items } = S, nodes = model.nodes, nu = unknowns.length;
  const cands = [];
  const ext = it => it.u < 0 || ['reaction', 'normal', 'friction'].includes(unknowns[it.u].role);
  // whole structure: only external forces (internal pin and member forces cancel)
  const wholeSel = it => ext(it) && !(it.tn >= 0 && it.u >= 0 && unknowns[it.u].role === 'pin');
  const supNodes = [...new Set(unknowns.filter(u => u.node !== undefined && u.role !== 'pin').map(u => u.node))];
  const allNodes = nodes.map((_, i) => i);
  const single = T.bodies.length + S.pinNodes.length > 1;
  const whole = { label: single ? 'whole structure' : 'body', sel: wholeSel };
  if (single) {
    cands.push({ ...eqF(wholeSel, 0), kind: 'F', name: 'ΣFx = 0', group: whole });
    cands.push({ ...eqF(wholeSel, 1), kind: 'F', name: 'ΣFy = 0', group: whole });
    for (const i of [...supNodes, ...allNodes.filter(i => !supNodes.includes(i))]) cands.push({ ...eqM(wholeSel, nodes[i].x, nodes[i].y), kind: 'M', name: `ΣM_${letters(i)} = 0`, group: whole, about: i });
  }
  T.bodies.forEach((B, b) => {
    const sel = it => it.tb === b, grp = { label: T.bodies.length > 1 ? `body ${b + 1} (members ${B.members.map(k => T.P.members[k].id).join(', ')})` : 'the structure', sel, body: b };
    cands.push({ ...eqF(sel, 0), kind: 'F', name: 'ΣFx = 0', group: grp });
    cands.push({ ...eqF(sel, 1), kind: 'F', name: 'ΣFy = 0', group: grp });
    const pts = [...B.nodes];
    for (const i of pts) cands.push({ ...eqM(sel, nodes[i].x, nodes[i].y), kind: 'M', name: `ΣM_${letters(i)} = 0`, group: grp, about: i });
  });
  for (const i of S.pinNodes) {
    const sel = it => it.tn === i, grp = { label: `joint ${letters(i)}`, sel, node: i };
    cands.push({ ...eqF(sel, 0), kind: 'F', name: 'ΣFx = 0', group: grp });
    cands.push({ ...eqF(sel, 1), kind: 'F', name: 'ΣFy = 0', group: grp });
  }
  const known = new Array(nu).fill(false), steps = [];
  const tolA = row => 1e-9 * Math.max(1e-30, ...row.map(Math.abs));
  const remaining = e => { const t = tolA(e.a); const r = []; for (let j = 0; j < nu; j++) if (!known[j] && Math.abs(e.a[j]) > t) r.push(j); return r; };
  const usedEq = new Set();
  let guard = 0;
  while (known.some(k => !k) && guard++ < 4 * nu + 10) {
    let pick = null;
    for (let q = 0; q < cands.length && !pick; q++) {
      if (usedEq.has(q)) continue;
      const r = remaining(cands[q]);
      if (r.length === 1) pick = { q, j: r[0] };
    }
    if (pick) {
      const e = cands[pick.q]; usedEq.add(pick.q);
      known[pick.j] = true;
      steps.push({ eq: e, solveFor: [pick.j], terms: termsOf(e, S, x, known, pick.j), value: x[pick.j] });
      continue;
    }
    // two equations sharing the same two unknowns
    let pair = null;
    const sets = new Map();
    cands.forEach((e, q) => { if (usedEq.has(q)) return; const r = remaining(e); if (r.length === 2) { const k = r.join(','); (sets.get(k) || sets.set(k, []).get(k)).push(q); } });
    for (const [k, qs] of sets) {
      if (qs.length < 2) continue;
      const [j1, j2] = k.split(',').map(Number);
      for (let a = 0; a < qs.length && !pair; a++) for (let b = a + 1; b < qs.length && !pair; b++) {
        const e1 = cands[qs[a]], e2 = cands[qs[b]], det = e1.a[j1] * e2.a[j2] - e1.a[j2] * e2.a[j1];
        if (Math.abs(det) > 1e-9 * Math.abs(e1.a[j1] * e2.a[j2]) + 1e-300) pair = [qs[a], qs[b], j1, j2];
      }
      if (pair) break;
    }
    if (pair) {
      const [q1, q2, j1, j2] = pair; usedEq.add(q1); usedEq.add(q2);
      steps.push({ eq: cands[q1], eq2: cands[q2], solveFor: [j1, j2], terms: termsOf(cands[q1], S, x, known, -1), terms2: termsOf(cands[q2], S, x, known, -1), value: x[j1], value2: x[j2], simultaneous: true });
      known[j1] = known[j2] = true;
      continue;
    }
    // remaining unknowns solved together
    const rest = known.map((k, j) => (k ? -1 : j)).filter(j => j >= 0);
    steps.push({ rest, simultaneous: true, all: true });
    rest.forEach(j => { known[j] = true; });
  }
  return steps;
}
// symbolic terms of an equation for display: unknowns not yet known stay symbolic
function termsOf(e, S, x, known, solving) {
  const { unknowns } = S, t = [];
  for (let j = 0; j < unknowns.length; j++) {
    const a = e.a[j]; if (Math.abs(a) < 1e-12 * Math.max(1e-300, ...e.a.map(Math.abs))) continue;
    t.push({ coef: a, u: j, known: known[j] && j !== solving, value: x[j] });
  }
  return { terms: t, c: e.c, kind: e.kind };
}

// contact / cable checks for a determinate solution
function unilateralChecks(model, S, x) {
  const out = [];
  for (const [i, list] of S.supU) {
    const sp = list[0] && S.unknowns[list[0].u].sp;
    if (!sp || sp.type !== 'contact') continue;
    const N = list.find(l => S.unknowns[l.u].role === 'normal'), F = list.find(l => S.unknowns[l.u].role === 'friction');
    const n = N ? x[N.u] : 0, f = F ? x[F.u] : 0, mu = sp.mu || 0;
    out.push({ node: i, N: n, F: f, mu, muReq: Math.abs(n) > 0 ? Math.abs(f) / Math.abs(n) : Infinity, lift: n < -1e-9 * (Math.abs(n) + Math.abs(f) + 1e-30), slip: n >= 0 && Math.abs(f) > mu * n * (1 + 1e-9) + 1e-12 });
  }
  for (const [k, u] of S.tfU) if (S.unknowns[u].role === 'cable') out.push({ cable: k, T: x[u], slack: x[u] < 0 });
  return out;
}

// ---------------------------------------------------------------- limit analysis (LP)
// Maximise λ such that fixed loads + λ·(scaled loads) can be equilibrated with contacts in compression,
// friction within the cone and cables in tension.
export function limitAnalysis(model, T, scale = 'all') {
  const isVar = ld => (scale === 'all' ? true : scale === 'self' ? ld.kind === 'self' : ld.id === scale);
  const Sv = buildSystem(model, T, ld => isVar(ld));
  const Sf = buildSystem(model, T, ld => !isVar(ld));
  const { unknowns, nu } = Sv, ne = Sv.eqs.length;
  const LMAX = 1e6;
  // variables: x (nu, free) + λ (≥ 0)
  const nv = nu + 1;
  const Aeq = Sv.eqs.map(e => { const r = new Array(nv).fill(0); for (let j = 0; j < nu; j++) r[j] = e.a[j]; r[nu] = e.c; return r; });
  const beq = Sf.eqs.map(e => -e.c);
  const Aub = [], bub = [];
  const row = () => new Array(nv).fill(0);
  const contacts = [];
  for (const [i, list] of Sv.supU) {
    const sp = list[0] && unknowns[list[0].u].sp;
    if (sp && sp.type === 'contact') {
      const N = list.find(l => unknowns[l.u].role === 'normal'), F = list.find(l => unknowns[l.u].role === 'friction');
      const r1 = row(); r1[N.u] = -1; Aub.push(r1); bub.push(0);
      if (F) { const mu = sp.mu; const r2 = row(); r2[F.u] = 1; r2[N.u] = -mu; Aub.push(r2); bub.push(0); const r3 = row(); r3[F.u] = -1; r3[N.u] = -mu; Aub.push(r3); bub.push(0); }
      contacts.push({ node: i, N: N.u, F: F ? F.u : -1, mu: sp.mu || 0 });
    }
  }
  const cables = [];
  for (const [k, u] of Sv.tfU) if (unknowns[u].role === 'cable') { const r = row(); r[u] = -1; Aub.push(r); bub.push(0); cables.push({ member: k, u }); }
  const rl = row(); rl[nu] = 1; Aub.push(rl); bub.push(LMAX);
  const nonneg = new Array(nv).fill(false); nonneg[nu] = true;
  const c = new Array(nv).fill(0); c[nu] = 1;
  const varLoad = Sv.eqs.some(e => Math.abs(e.c) > 0);
  if (!varLoad) return { status: 'no-variable-load' };
  const lp = linprog({ c, Aeq, beq, Aub, bub, nonneg });
  if (lp.status === 'infeasible') return { status: 'infeasible', contacts, cables, scale };
  if (lp.status !== 'optimal') return { status: lp.status };
  const lam = lp.x[nu];
  if (lam >= LMAX * 0.999) return { status: 'unbounded', lambda: Infinity, scale };
  const x = lp.x;
  const scaleF = Math.max(1e-9, ...contacts.map(ct => Math.abs(x[ct.N]) + (ct.F >= 0 ? Math.abs(x[ct.F]) : 0)), ...cables.map(cb => Math.abs(x[cb.u])));
  const tol = 1e-6 * scaleF;
  const mech = [];
  for (const ct of contacts) {
    const N = x[ct.N], F = ct.F >= 0 ? x[ct.F] : 0;
    if (N <= tol) mech.push({ node: ct.node, kind: 'lift' });
    else if (ct.mu > 0 && Math.abs(F) >= ct.mu * N - tol) mech.push({ node: ct.node, kind: 'slip', dir: Math.sign(F) });
    else if (!(ct.mu > 0)) mech.push({ node: ct.node, kind: 'slip-smooth' });
  }
  for (const cb of cables) if (x[cb.u] <= tol) mech.push({ member: cb.member, kind: 'slack' });
  return { status: 'optimal', lambda: lam, x, mech, contacts, cables, scale, unknowns };
}
