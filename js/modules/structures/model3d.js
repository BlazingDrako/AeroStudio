// 3-D frame model store (SI units, Z up), undo/redo, persistence and example generators.
const KEY = 'pteronautics-frame3d-v1';
const SEC = {
  w310: { id: 's1', name: 'W310×39 I-beam', shape: 'ibeam', dims: { b: 0.165, h: 0.31, tf: 0.0097, tw: 0.0058 } },
  w250: { id: 's2', name: 'W250×49 column', shape: 'ibeam', dims: { b: 0.202, h: 0.247, tf: 0.011, tw: 0.0074 } },
  hss: { id: 's3', name: 'HSS 150×150×8 box', shape: 'box', dims: { b: 0.15, h: 0.15, t: 0.008 } },
  pipe: { id: 's4', name: 'Pipe Ø114×6', shape: 'tube', dims: { d: 0.114, t: 0.006 } },
  angle: { id: 's5', name: 'Angle L75×75×8', shape: 'angle', dims: { b: 0.075, h: 0.075, t: 0.008 } },
  tube25: { id: 's6', name: 'Tube Ø25.4×1.24 (4130)', shape: 'tube', dims: { d: 0.0254, t: 0.00124 } },
  tube19: { id: 's7', name: 'Tube Ø19×0.9 (4130)', shape: 'tube', dims: { d: 0.01905, t: 0.000889 } },
  spar: { id: 's8', name: 'Spar box 120×40×3', shape: 'box', dims: { b: 0.04, h: 0.12, t: 0.003 } },
  rib: { id: 's9', name: 'Rib channel 80×25×1.6', shape: 'channel', dims: { b: 0.025, h: 0.08, tf: 0.0016, tw: 0.0016 } },
};
const sec = (...keys) => keys.map(k => ({ ...SEC[k], dims: { ...SEC[k].dims } }));

export function blankModel3d() {
  return {
    nodes: [], members: [], supports: [], loads: [], sections: sec('w310', 'hss', 'pipe'), materials: [],
    settings: { selfWeight: false, g: 9.80665 }, defaults: { sec: 's1', mat: 'steel' },
  };
}

export class Store3D {
  constructor(model) { this.model = model; this.past = []; this.future = []; this.listeners = new Set(); this.seq = 1; this.syncSeq(); }
  syncSeq() {
    let mx = 0;
    for (const arr of [this.model.nodes, this.model.members, this.model.loads, this.model.sections]) for (const o of arr) { const n = parseInt(String(o.id).replace(/\D/g, ''), 10); if (n > mx) mx = n; }
    this.seq = mx + 1;
  }
  id(p) { return p + (this.seq++); }
  snapshot() { return JSON.stringify(this.model); }
  commit() { this.past.push(this.snapshot()); if (this.past.length > 200) this.past.shift(); this.future = []; }
  changed(kind = 'model') { for (const f of this.listeners) f(kind); try { localStorage.setItem(KEY, this.snapshot()); } catch { } }
  undo() { if (!this.past.length) return; this.future.push(this.snapshot()); this.model = JSON.parse(this.past.pop()); this.syncSeq(); this.changed('replace'); }
  redo() { if (!this.future.length) return; this.past.push(this.snapshot()); this.model = JSON.parse(this.future.pop()); this.syncSeq(); this.changed('replace'); }
  replace(m, keep = true) { if (keep) this.commit(); this.model = m; this.syncSeq(); this.changed('replace'); }
  on(f) { this.listeners.add(f); return () => this.listeners.delete(f); }
  node(id) { return this.model.nodes.find(n => n.id === id); }
  member(id) { return this.model.members.find(m => m.id === id); }
  support(id) { return this.model.supports.find(s => s.node === id); }
  addNode(x, y, z) {
    const tol = 1e-6, ex = this.model.nodes.find(n => Math.abs(n.x - x) < tol && Math.abs(n.y - y) < tol && Math.abs((n.z || 0) - z) < tol);
    if (ex) return ex;
    const n = { id: this.id('n'), x, y, z }; this.model.nodes.push(n); return n;
  }
  addMember(a, b, props = {}) {
    if (a === b) return null;
    const ex = this.model.members.find(m => (m.a === a && m.b === b) || (m.a === b && m.b === a));
    if (ex) return ex;
    const d = this.model.defaults, m = { id: this.id('m'), a, b, sec: d.sec, mat: d.mat, roll: 0, type: 'frame', relA: false, relB: false, ...props };
    this.model.members.push(m); return m;
  }
  deleteNode(id) {
    const mdl = this.model, gone = new Set(mdl.members.filter(m => m.a === id || m.b === id).map(m => m.id));
    mdl.nodes = mdl.nodes.filter(n => n.id !== id);
    mdl.members = mdl.members.filter(m => !gone.has(m.id));
    mdl.supports = mdl.supports.filter(s => s.node !== id);
    mdl.loads = mdl.loads.filter(l => l.node !== id && !gone.has(l.member));
  }
  deleteMember(id) {
    const mdl = this.model; mdl.members = mdl.members.filter(m => m.id !== id); mdl.loads = mdl.loads.filter(l => l.member !== id);
  }
  // split a member at t, re-mapping its loads
  splitMember(m, t = 0.5) {
    const A = this.node(m.a), B = this.node(m.b);
    const n = this.addNode(A.x + (B.x - A.x) * t, A.y + (B.y - A.y) * t, (A.z || 0) + ((B.z || 0) - (A.z || 0)) * t);
    const m2 = { ...m, id: this.id('m'), a: n.id, relA: false };
    m.b = n.id; m.relB = false;
    this.model.members.splice(this.model.members.indexOf(m) + 1, 0, m2);
    const keep = [];
    for (const ld of this.model.loads) {
      if (ld.member !== m.id) { keep.push(ld); continue; }
      if (ld.kind === 'point') { if ((ld.t ?? 0.5) <= t) keep.push({ ...ld, t: (ld.t ?? 0.5) / t }); else keep.push({ ...ld, member: m2.id, t: ((ld.t ?? 0.5) - t) / (1 - t) }); }
      else if (ld.kind === 'dist') {
        const t0 = ld.t0 ?? 0, t1 = ld.t1 ?? 1, w2 = ld.w2 ?? ld.w1, wAt = tt => ld.w1 + (w2 - ld.w1) * (tt - t0) / (t1 - t0 || 1);
        if (t0 < t) keep.push({ ...ld, t0: t0 / t, t1: Math.min(t1, t) / t, w2: t1 > t ? wAt(t) : w2 });
        if (t1 > t) keep.push({ ...ld, id: this.id('l'), member: m2.id, t0: Math.max(0, (t0 - t) / (1 - t)), t1: (t1 - t) / (1 - t), w1: t0 < t ? wAt(t) : ld.w1, w2 });
      } else { keep.push(ld); keep.push({ ...ld, id: this.id('l'), member: m2.id }); }
    }
    this.model.loads = keep;
    return n;
  }
}

let shared = null;
export function sharedStore3d() {
  if (!shared) {
    let m = null;
    try { const s = localStorage.getItem(KEY); if (s) m = normalize3d(JSON.parse(s)); } catch { m = null; }
    shared = new Store3D(m || example3d('lbent'));
  }
  return shared;
}

export function normalize3d(m) {
  if (!m || !Array.isArray(m.nodes) || !Array.isArray(m.members)) throw new Error('bad model');
  const b = blankModel3d();
  const out = { ...b, ...m, settings: { ...b.settings, ...(m.settings || {}) }, defaults: { ...b.defaults, ...(m.defaults || {}) } };
  out.nodes = m.nodes.map(n => ({ id: String(n.id), x: +n.x || 0, y: +n.y || 0, z: +n.z || 0 }));
  out.supports = (m.supports || []).filter(s => s.r && s.r.length === 6);
  out.loads = m.loads || []; out.sections = m.sections?.length ? m.sections : b.sections; out.materials = m.materials || [];
  return out;
}

// ---------------------------------------------------------------- examples
const FIX = [1, 1, 1, 1, 1, 1], PIN = [1, 1, 1, 0, 0, 0];
function builder(sections, defaults) {
  const s = new Store3D({ ...blankModel3d(), sections, defaults });
  const api = {
    s, m: s.model,
    n: (x, y, z) => s.addNode(x, y, z).id,
    mem: (a, b, p) => s.addMember(a, b, p),
    sup: (node, r, k) => { s.model.supports = s.model.supports.filter(q => q.node !== node); s.model.supports.push({ node, type: r === FIX ? 'fixed' : r === PIN ? 'pinned' : 'custom', r: [...r], ...(k ? { k } : {}) }); },
    load: ld => s.model.loads.push({ id: s.id('l'), ...ld }),
  };
  return api;
}

export const EXAMPLES_3D = [
  { id: 'lbent', label: 'L-shaped bracket (bending + torsion)', group: 'Learn' },
  { id: 'canti', label: 'Cantilever with an inclined load (biaxial bending)', group: 'Learn' },
  { id: 'tripod', label: 'Tripod (space truss, statically determinate)', group: 'Learn' },
  { id: 'grid', label: 'Floor grillage (beams sharing load by bending and twisting)', group: 'Learn', params: [['nx', 'Beams along X', 3], ['ny', 'Beams along Y', 3], ['L', 'Span', 6, 'len'], ['P', 'Central load', 50e3, 'force']] },
  { id: 'portal', label: '3D portal frame (gravity + wind)', group: 'Buildings' },
  { id: 'building', label: 'Multi-storey building frame', group: 'Buildings', params: [['bx', 'Bays in X', 2], ['by', 'Bays in Y', 2], ['ns', 'Storeys', 3], ['Lx', 'Bay width X', 6, 'len'], ['Ly', 'Bay width Y', 5, 'len'], ['H', 'Storey height', 3.5, 'len'], ['w', 'Floor beam load', -20e3, 'dist'], ['F', 'Wind per floor node', 8e3, 'force']] },
  { id: 'tower', label: 'Lattice tower (space truss, wind)', group: 'Buildings', params: [['nl', 'Panels', 6], ['B', 'Base width', 4, 'len'], ['Bt', 'Top width', 1.5, 'len'], ['H', 'Height', 18, 'len'], ['F', 'Wind at top', 20e3, 'force']] },
  { id: 'engine', label: 'Engine mount (welded 4130 tubes)', group: 'Aerospace' },
  { id: 'wing', label: 'Wing: spars, ribs and drag bracing (lift)', group: 'Aerospace' },
];

export function example3d(id, params) {
  const ex = EXAMPLES_3D.find(e => e.id === id) || EXAMPLES_3D[0];
  const p = {}; for (const [k, , v] of ex.params || []) p[k] = v; Object.assign(p, params || {});
  let B;
  switch (ex.id) {
    case 'lbent': {
      B = builder(sec('pipe', 'w310', 'hss'), { sec: 's4', mat: 'steel' });
      const a = B.n(0, 0, 0), b = B.n(1.5, 0, 0), c = B.n(1.5, 1, 0);
      B.mem(a, b); B.mem(b, c); B.sup(a, FIX);
      B.load({ kind: 'node', node: c, fz: -5e3 });
      break;
    }
    case 'canti': {
      B = builder(sec('w310', 'hss', 'pipe'), { sec: 's1', mat: 'steel' });
      const a = B.n(0, 0, 0), b = B.n(4, 0, 0);
      B.mem(a, b); B.sup(a, FIX);
      const F = 10e3, th = 20 * Math.PI / 180;
      B.load({ kind: 'node', node: b, fy: F * Math.sin(th), fz: -F * Math.cos(th) });
      break;
    }
    case 'tripod': {
      B = builder(sec('pipe', 'angle', 'hss'), { sec: 's4', mat: 'steel' });
      const top = B.n(0, 0, 3);
      for (let k = 0; k < 3; k++) { const a = k * 2 * Math.PI / 3 + Math.PI / 2, n = B.n(+(1.5 * Math.cos(a)).toFixed(4), +(1.5 * Math.sin(a)).toFixed(4), 0); B.mem(n, top, { type: 'truss' }); B.sup(n, PIN); }
      B.load({ kind: 'node', node: top, fz: -30e3, fx: 4e3 });
      break;
    }
    case 'grid': {
      B = builder(sec('w310', 'hss', 'pipe'), { sec: 's1', mat: 'steel' });
      const nx = Math.max(1, Math.round(p.nx)), ny = Math.max(1, Math.round(p.ny)), L = p.L;
      // nx beams run along X (at y positions), ny beams along Y; ends simply supported
      const ids = {};
      const key = (i, j) => i + ',' + j;
      const xs = Array.from({ length: ny + 2 }, (_, i) => L * i / (ny + 1)), ys = Array.from({ length: nx + 2 }, (_, j) => L * j / (nx + 1));
      for (let i = 0; i < xs.length; i++) for (let j = 0; j < ys.length; j++) {
        const edgeX = i === 0 || i === xs.length - 1, edgeY = j === 0 || j === ys.length - 1;
        if (edgeX && edgeY) continue;
        ids[key(i, j)] = B.n(xs[i], ys[j], 0);
      }
      for (let j = 1; j < ys.length - 1; j++) for (let i = 0; i + 1 < xs.length; i++) B.mem(ids[key(i, j)], ids[key(i + 1, j)]);
      for (let i = 1; i < xs.length - 1; i++) for (let j = 0; j + 1 < ys.length; j++) B.mem(ids[key(i, j)], ids[key(i, j + 1)]);
      for (const [k, id] of Object.entries(ids)) {
        const [i, j] = k.split(',').map(Number);
        if (i === 0 || i === xs.length - 1 || j === 0 || j === ys.length - 1) B.sup(id, [1, 1, 1, 0, 0, 0]);
      }
      // central load (nearest interior node)
      const ci = Math.round((xs.length - 1) / 2), cj = Math.round((ys.length - 1) / 2);
      B.load({ kind: 'node', node: ids[key(ci, cj)], fz: -p.P });
      break;
    }
    case 'portal': {
      B = builder(sec('w310', 'w250', 'hss'), { sec: 's1', mat: 'steel' });
      const Lx = 6, Ly = 4, H = 4;
      const base = [[0, 0], [Lx, 0], [Lx, Ly], [0, Ly]].map(([x, y]) => B.n(x, y, 0));
      const top = [[0, 0], [Lx, 0], [Lx, Ly], [0, Ly]].map(([x, y]) => B.n(x, y, H));
      for (let k = 0; k < 4; k++) { B.mem(base[k], top[k], { sec: 's2' }); B.sup(base[k], FIX); }
      for (let k = 0; k < 4; k++) { const mm = B.mem(top[k], top[(k + 1) % 4]); B.load({ kind: 'dist', member: mm.id, dir: 'gz', w1: -15e3, w2: -15e3 }); }
      B.load({ kind: 'node', node: top[0], fx: 10e3 }); B.load({ kind: 'node', node: top[3], fx: 10e3 });
      B.load({ kind: 'node', node: top[0], fy: 6e3 }); B.load({ kind: 'node', node: top[1], fy: 6e3 });
      break;
    }
    case 'building': {
      B = builder(sec('w310', 'w250', 'hss'), { sec: 's1', mat: 'steel' });
      const bx = Math.max(1, Math.round(p.bx)), by = Math.max(1, Math.round(p.by)), ns = Math.max(1, Math.round(p.ns));
      const id = (i, j, k) => B.n(i * p.Lx, j * p.Ly, k * p.H);
      for (let k = 0; k <= ns; k++) for (let i = 0; i <= bx; i++) for (let j = 0; j <= by; j++) {
        const n = id(i, j, k);
        if (k === 0) { B.sup(n, FIX); continue; }
        B.mem(id(i, j, k - 1), n, { sec: 's2' });
        if (i > 0) { const mm = B.mem(id(i - 1, j, k), n); B.load({ kind: 'dist', member: mm.id, dir: 'gz', w1: p.w, w2: p.w }); }
        if (j > 0) { const mm = B.mem(id(i, j - 1, k), n); B.load({ kind: 'dist', member: mm.id, dir: 'gz', w1: p.w, w2: p.w }); }
        if (i === 0) B.load({ kind: 'node', node: n, fx: p.F * (j === 0 || j === by ? 0.5 : 1) });
      }
      break;
    }
    case 'tower': {
      B = builder(sec('angle', 'pipe', 'hss'), { sec: 's4', mat: 'steel' });
      const nl = Math.max(1, Math.round(p.nl));
      const ring = k => { const t = k / nl, w = (p.B + (p.Bt - p.B) * t) / 2, z = p.H * t; return [[-w, -w], [w, -w], [w, w], [-w, w]].map(([x, y]) => B.n(+x.toFixed(5), +y.toFixed(5), +z.toFixed(5))); };
      let prev = ring(0); prev.forEach(n => B.sup(n, PIN));
      for (let k = 1; k <= nl; k++) {
        const cur = ring(k);
        for (let q = 0; q < 4; q++) {
          B.mem(prev[q], cur[q], { type: 'truss', sec: 's4' });
          B.mem(cur[q], cur[(q + 1) % 4], { type: 'truss', sec: 's5' });
          B.mem(prev[q], cur[(q + 1) % 4], { type: 'truss', sec: 's5' });
          B.mem(prev[(q + 1) % 4], cur[q], { type: 'truss', sec: 's5' });
        }
        if (k === nl || k % 3 === 0) B.mem(cur[0], cur[2], { type: 'truss', sec: 's5' });
        prev = cur;
      }
      for (const n of prev) B.load({ kind: 'node', node: n, fx: p.F / 4, fz: -2e3 });
      break;
    }
    case 'engine': {
      // firewall at x = 0 (4 bolts), engine ring at x = −0.55 m; welded 4130 tubes as frame members
      B = builder(sec('tube25', 'tube19', 'pipe'), { sec: 's6', mat: '4130' });
      const fw = [[0.25, 0.22], [-0.25, 0.22], [-0.25, -0.2], [0.25, -0.2]].map(([y, z]) => B.n(0, y, z));
      const ring = [[0.17, 0.17], [-0.17, 0.17], [-0.17, -0.17], [0.17, -0.17]].map(([y, z]) => B.n(-0.55, y, z));
      fw.forEach(n => B.sup(n, PIN));
      for (let k = 0; k < 4; k++) {
        B.mem(fw[k], ring[k]); B.mem(fw[k], ring[(k + 1) % 4], { sec: 's7' });
        B.mem(ring[k], ring[(k + 1) % 4]);
      }
      // engine 110 kg at 4.5 g down (load factor), 2.7 kN thrust, 600 N·m prop torque, shared by the 4 mounts
      const W = 110 * 9.80665 * 4.5, T = 2700, Q = 600, r = 0.17 * Math.SQRT2;
      ring.forEach(n => {
        const N = B.m.nodes.find(q => q.id === n), ang = Math.atan2(N.z, N.y), ft = Q / (4 * r); // tangential force per mount
        B.load({ kind: 'node', node: n, fx: -T / 4, fy: -ft * Math.sin(ang), fz: -W / 4 + ft * Math.cos(ang) });
      });
      break;
    }
    case 'wing': {
      // two box spars along Y (span), channel ribs along X (chord), tube drag bracing; root fixed; lift shared 65/35 by the spars
      B = builder(sec('spar', 'rib', 'tube25'), { sec: 's8', mat: 'al2024' });
      const span = 4.5, nr = 6, xf = 0, xr = 0.6;
      let pf = null, pr = null;
      for (let k = 0; k <= nr; k++) {
        const y = span * k / nr, f = B.n(xf, +y.toFixed(5), 0), r = B.n(xr, +y.toFixed(5), 0);
        if (k === 0) { B.sup(f, FIX); B.sup(r, FIX); }
        else {
          const lift = 2000 * Math.sqrt(Math.max(0, 1 - ((y - span / nr / 2) / span) ** 2)); // elliptic-ish N/m
          const m1 = B.mem(pf, f), m2 = B.mem(pr, r);
          B.load({ kind: 'dist', member: m1.id, dir: 'gz', w1: 0.65 * lift, w2: 0.65 * lift });
          B.load({ kind: 'dist', member: m2.id, dir: 'gz', w1: 0.35 * lift, w2: 0.35 * lift });
          B.mem(k % 2 ? pf : pr, k % 2 ? r : f, { type: 'truss', sec: 's6' }); // drag bracing
        }
        B.mem(f, r, { sec: 's9' });
        pf = f; pr = r;
      }
      break;
    }
  }
  const m = B.s.model;
  m.example = ex.id;
  return JSON.parse(JSON.stringify(m));
}
