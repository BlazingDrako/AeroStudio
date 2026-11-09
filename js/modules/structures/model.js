// Structure model store (SI units), undo/redo, persistence and example structures.
import { SHAPES } from '../../solvers/sections.js';

export function blankModel() {
  return {
    nodes: [], members: [], supports: [], loads: [],
    sections: [{ id: 's1', name: 'W310×39 (I-beam)', shape: 'ibeam', dims: { b: 0.165, h: 0.31, tf: 0.0097, tw: 0.0058 } }],
    materials: [],
    settings: { selfWeight: false, g: 9.80665, scaleLoad: 'all' },
    defaults: { sec: 's1', mat: 'steel' },
  };
}

export class Store {
  constructor(model) { this.model = model; this.past = []; this.future = []; this.listeners = new Set(); this.seq = 1; this.syncSeq(); }
  syncSeq() {
    let mx = 0;
    for (const arr of [this.model.nodes, this.model.members, this.model.loads, this.model.sections, this.model.materials]) for (const o of arr) { const n = parseInt(String(o.id).replace(/\D/g, ''), 10); if (n > mx) mx = n; }
    this.seq = mx + 1;
  }
  id(prefix) { return prefix + (this.seq++); }
  snapshot() { return JSON.stringify(this.model); }
  // record the current state before a change
  commit() { this.past.push(this.snapshot()); if (this.past.length > 200) this.past.shift(); this.future = []; }
  changed(kind = 'model') { for (const f of this.listeners) f(kind); save(this.model); }
  undo() { if (!this.past.length) return; this.future.push(this.snapshot()); this.model = JSON.parse(this.past.pop()); this.syncSeq(); this.changed('replace'); }
  redo() { if (!this.future.length) return; this.past.push(this.snapshot()); this.model = JSON.parse(this.future.pop()); this.syncSeq(); this.changed('replace'); }
  replace(model, keepHistory = true) { if (keepHistory) this.commit(); this.model = model; this.syncSeq(); this.changed('replace'); }
  on(f) { this.listeners.add(f); return () => this.listeners.delete(f); }

  // ---- editing helpers
  nodeAt(x, y, tol) { let best = null, bd = tol; for (const n of this.model.nodes) { const d = Math.hypot(n.x - x, n.y - y); if (d <= bd) { bd = d; best = n; } } return best; }
  addNode(x, y) { const n = { id: this.id('n'), x, y }; this.model.nodes.push(n); return n; }
  ensureNode(x, y, tol) {
    const ex = this.nodeAt(x, y, tol); if (ex) return ex;
    // split a member if the point lies on it
    for (const m of [...this.model.members]) {
      const a = this.node(m.a), b = this.node(m.b), t = projT(a, b, x, y);
      if (t > 1e-6 && t < 1 - 1e-6 && distToSeg(a, b, x, y) <= tol) { const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t; return this.splitMember(m, t, px, py); }
    }
    return this.addNode(x, y);
  }
  splitMember(m, t, x, y) {
    const n = this.addNode(x, y), mdl = this.model;
    const m2 = { ...m, id: this.id('m'), a: n.id, b: m.b, relA: false };
    m.b = n.id; m.relB = false;
    mdl.members.splice(mdl.members.indexOf(m) + 1, 0, m2);
    // re-map member loads onto the two halves
    const keep = [];
    for (const ld of mdl.loads) {
      if (ld.member !== m.id) { keep.push(ld); continue; }
      if (ld.kind === 'point' || ld.kind === 'mpoint') {
        if (ld.t <= t) { keep.push({ ...ld, t: ld.t / t }); } else keep.push({ ...ld, member: m2.id, t: (ld.t - t) / (1 - t) });
      } else if (ld.kind === 'dist') {
        const t0 = ld.t0 ?? 0, t1 = ld.t1 ?? 1, wAt = tt => ld.w1 + (ld.w2 - ld.w1) * (tt - t0) / (t1 - t0 || 1);
        if (t0 < t) keep.push({ ...ld, t0: t0 / t, t1: Math.min(t1, t) / t, w2: t1 > t ? wAt(t) : ld.w2 });
        if (t1 > t) keep.push({ ...ld, id: this.id('l'), member: m2.id, t0: Math.max(0, (t0 - t) / (1 - t)), t1: (t1 - t) / (1 - t), w1: t0 < t ? wAt(t) : ld.w1 });
      } else { keep.push(ld); keep.push({ ...ld, id: this.id('l'), member: m2.id }); }
    }
    mdl.loads = keep;
    return n;
  }
  node(id) { return this.model.nodes.find(n => n.id === id); }
  member(id) { return this.model.members.find(m => m.id === id); }
  addMember(a, b, props) {
    if (a.id === b.id) return null;
    if (this.model.members.some(m => (m.a === a.id && m.b === b.id) || (m.a === b.id && m.b === a.id))) return null;
    const m = { id: this.id('m'), a: a.id, b: b.id, type: 'frame', relA: false, relB: false, sec: this.model.defaults.sec, mat: this.model.defaults.mat, ...props };
    this.model.members.push(m); return m;
  }
  deleteNode(id) {
    const mdl = this.model;
    const gone = new Set(mdl.members.filter(m => m.a === id || m.b === id).map(m => m.id));
    mdl.members = mdl.members.filter(m => !gone.has(m.id));
    mdl.nodes = mdl.nodes.filter(n => n.id !== id);
    mdl.supports = mdl.supports.filter(s => s.node !== id);
    mdl.loads = mdl.loads.filter(l => l.node !== id && !gone.has(l.member));
  }
  deleteMember(id) {
    const mdl = this.model;
    mdl.members = mdl.members.filter(m => m.id !== id);
    mdl.loads = mdl.loads.filter(l => l.member !== id);
    // drop orphan nodes that have nothing attached
    const used = new Set(mdl.members.flatMap(m => [m.a, m.b]));
    for (const n of [...mdl.nodes]) if (!used.has(n.id)) this.deleteNode(n.id);
  }
}
export const projT = (a, b, x, y) => { const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy; return L2 ? ((x - a.x) * dx + (y - a.y) * dy) / L2 : 0; };
export const distToSeg = (a, b, x, y) => { const t = Math.max(0, Math.min(1, projT(a, b, x, y))); return Math.hypot(a.x + (b.x - a.x) * t - x, a.y + (b.y - a.y) * t - y); };

const KEY = 'pteronautics-structure-v1';
let saveTimer = 0;
function save(model) { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(model)); } catch { } }, 300); }
export function loadSaved() { try { const s = localStorage.getItem(KEY); if (s) { const m = JSON.parse(s); if (m && Array.isArray(m.nodes)) return normalize(m); } } catch { } return null; }
export function normalize(m) {
  const b = blankModel();
  return { ...b, ...m, settings: { ...b.settings, ...(m.settings || {}) }, defaults: { ...b.defaults, ...(m.defaults || {}) }, sections: m.sections?.length ? m.sections : b.sections, materials: m.materials || [] };
}

// ---------------------------------------------------------------- examples
function builder(base = {}) {
  const m = { ...blankModel(), ...base };
  let k = 1;
  const B = {
    m,
    node(x, y, extra) { const n = { id: 'n' + k++, x, y, ...extra }; m.nodes.push(n); return n.id; },
    member(a, b, o = {}) { const mm = { id: 'm' + k++, a, b, type: 'frame', relA: false, relB: false, sec: m.defaults.sec, mat: m.defaults.mat, ...o }; m.members.push(mm); return mm.id; },
    support(node, type, o = {}) { m.supports.push({ node, type, angle: 0, ...o }); },
    load(o) { const l = { id: 'l' + k++, ...o }; m.loads.push(l); return l.id; },
  };
  return B;
}
const kN = 1e3;
const W310 = { id: 's1', name: 'W310×39 (I-beam)', shape: 'ibeam', dims: { b: 0.165, h: 0.31, tf: 0.0097, tw: 0.0058 } };
const W200 = { id: 's2', name: 'W200×46 (column)', shape: 'ibeam', dims: { b: 0.203, h: 0.203, tf: 0.011, tw: 0.0072 } };
const HSS = { id: 's3', name: 'HSS 150×150×8', shape: 'box', dims: { b: 0.15, h: 0.15, t: 0.008 } };
const ROD = { id: 's4', name: 'Rod Ø20', shape: 'circle', dims: { d: 0.02 } };

export const EXAMPLES = [
  {
    id: 'beam', group: 'Beams', label: 'Simply supported beam', build() {
      const B = builder({ sections: [W310] });
      const a = B.node(0, 0), b = B.node(8, 0); const m = B.member(a, b);
      B.support(a, 'pin'); B.support(b, 'roller');
      B.load({ kind: 'dist', member: m, w1: -10 * kN, w2: -10 * kN, dir: 'gy', t0: 0, t1: 1 });
      B.load({ kind: 'point', member: m, t: 3 / 8, fx: 0, fy: -20 * kN });
      return B.m;
    },
  },
  {
    id: 'cantilever', group: 'Beams', label: 'Cantilever, tip load', build() {
      const B = builder({ sections: [W310] });
      const a = B.node(0, 0), b = B.node(4, 0); B.member(a, b);
      B.support(a, 'fixed'); B.load({ kind: 'force', node: b, fx: 0, fy: -15 * kN });
      return B.m;
    },
  },
  {
    id: 'continuous', group: 'Beams', label: 'Continuous beam, 3 spans (indeterminate)', build() {
      const B = builder({ sections: [W310] });
      const n = [0, 6, 12, 18].map(x => B.node(x, 0));
      for (let i = 0; i < 3; i++) { const m = B.member(n[i], n[i + 1]); B.load({ kind: 'dist', member: m, w1: -12 * kN, w2: -12 * kN, dir: 'gy', t0: 0, t1: 1 }); }
      B.support(n[0], 'pin'); for (let i = 1; i < 4; i++) B.support(n[i], 'roller');
      return B.m;
    },
  },
  {
    id: 'gerber', group: 'Beams', label: 'Beam with an internal hinge', build() {
      const B = builder({ sections: [W310] });
      const a = B.node(0, 0), h = B.node(3, 0), c = B.node(9, 0), d = B.node(12, 0);
      B.member(a, h, { relB: true }); const m2 = B.member(h, c); const m3 = B.member(c, d);
      B.support(a, 'fixed'); B.support(c, 'roller');
      B.load({ kind: 'dist', member: m2, w1: -8 * kN, w2: -8 * kN, dir: 'gy', t0: 0, t1: 1 });
      B.load({ kind: 'force', node: d, fx: 0, fy: -10 * kN });
      return B.m;
    },
  },
  {
    id: 'pratt', group: 'Trusses', label: 'Pratt truss bridge', build() {
      const B = builder({ sections: [HSS], defaults: { sec: 's3', mat: 'steel' } });
      const P = 6, w = 4, H = 4, bot = [], top = [];
      for (let i = 0; i <= P; i++) bot.push(B.node(i * w, 0));
      for (let i = 1; i < P; i++) top.push(B.node(i * w, H));
      const T = { type: 'truss' };
      for (let i = 0; i < P; i++) B.member(bot[i], bot[i + 1], T);
      for (let i = 0; i < P - 2; i++) B.member(top[i], top[i + 1], T);
      B.member(bot[0], top[0], T); B.member(top[P - 2], bot[P], T);
      for (let i = 1; i < P; i++) B.member(bot[i], top[i - 1], T);
      for (let i = 1; i < P / 2; i++) B.member(top[i - 1], bot[i + 1], T);
      for (let i = P / 2; i < P - 1; i++) B.member(bot[i], top[i], T);
      B.support(bot[0], 'pin'); B.support(bot[P], 'roller');
      for (let i = 1; i < P; i++) B.load({ kind: 'force', node: bot[i], fx: 0, fy: -60 * kN });
      return B.m;
    },
  },
  {
    id: 'roof', group: 'Trusses', label: 'Fink roof truss', build() {
      const B = builder({ sections: [HSS], defaults: { sec: 's3', mat: 'steel' } });
      const S = 12, R = 3, T = { type: 'truss' };
      const a = B.node(0, 0), b = B.node(4, 0), c = B.node(8, 0), d = B.node(12, 0);
      const e = B.node(3, 1.5), f = B.node(6, 3), g = B.node(9, 1.5);
      [[a, b], [b, c], [c, d], [a, e], [e, f], [f, g], [g, d], [e, b], [b, f], [f, c], [c, g]].forEach(([p, q]) => B.member(p, q, T));
      B.support(a, 'pin'); B.support(d, 'roller');
      for (const n of [e, f, g]) B.load({ kind: 'force', node: n, fx: 0, fy: -15 * kN });
      B.load({ kind: 'force', node: e, fx: 4 * kN, fy: 0 });
      void S; void R;
      return B.m;
    },
  },
  {
    id: 'portal', group: 'Frames', label: 'Portal frame (gravity + wind)', build() {
      const B = builder({ sections: [W310, W200] });
      const a = B.node(0, 0), b = B.node(0, 5), c = B.node(8, 5), d = B.node(8, 0);
      B.member(a, b, { sec: 's2' }); const beam = B.member(b, c); B.member(d, c, { sec: 's2' });
      B.support(a, 'fixed'); B.support(d, 'fixed');
      B.load({ kind: 'dist', member: beam, w1: -15 * kN, w2: -15 * kN, dir: 'gy', t0: 0, t1: 1 });
      B.load({ kind: 'force', node: b, fx: 20 * kN, fy: 0 });
      return B.m;
    },
  },
  {
    id: 'threehinge', group: 'Frames', label: 'Three-hinged gable frame', build() {
      const B = builder({ sections: [W310] });
      const a = B.node(0, 0), b = B.node(0, 4), c = B.node(6, 6), d = B.node(12, 4), e = B.node(12, 0);
      B.member(a, b); const r1 = B.member(b, c, { relB: true }); const r2 = B.member(c, d); B.member(d, e);
      B.support(a, 'pin'); B.support(e, 'pin');
      B.load({ kind: 'dist', member: r1, w1: -6 * kN, w2: -6 * kN, dir: 'gyp', t0: 0, t1: 1 });
      B.load({ kind: 'dist', member: r2, w1: -6 * kN, w2: -6 * kN, dir: 'gyp', t0: 0, t1: 1 });
      return B.m;
    },
  },
  {
    id: 'boom', group: 'Frames', label: 'Wall crane with a tie cable', build() {
      const B = builder({ sections: [W200, ROD] });
      const a = B.node(0, 0), b = B.node(4, 0), c = B.node(0, 3);
      B.member(a, b, { sec: 's2' }); B.member(c, b, { type: 'cable', sec: 's4' });
      B.support(a, 'pin', { angle: -90 }); B.support(c, 'pin', { angle: -90 });
      B.load({ kind: 'force', node: b, fx: 0, fy: -10 * kN });
      return B.m;
    },
  },
  {
    id: 'wing', group: 'Aircraft', label: 'Strut-braced wing spar', build() {
      const B = builder({
        sections: [{ id: 's1', name: 'Spar cap I-beam', shape: 'ibeam', dims: { b: 0.05, h: 0.14, tf: 0.006, tw: 0.003 } }, { id: 's2', name: 'Strut tube Ø45×1.6', shape: 'tube', dims: { d: 0.045, t: 0.0016 } }],
        defaults: { sec: 's1', mat: 'al2024' },
      });
      const root = B.node(0, 1.2), sp = B.node(2.6, 1.2), tip = B.node(5.2, 1.2), fus = B.node(0, 0);
      const m1 = B.member(root, sp), m2 = B.member(sp, tip);
      B.member(fus, sp, { type: 'truss', sec: 's2', mat: '4130' });
      B.support(root, 'pin', { angle: -90 }); B.support(fus, 'pin', { angle: -90 });
      // lift: roughly elliptical, as two linear segments (N/m, upward)
      B.load({ kind: 'dist', member: m1, w1: 3.2 * kN, w2: 2.9 * kN, dir: 'gy', t0: 0, t1: 1 });
      B.load({ kind: 'dist', member: m2, w1: 2.9 * kN, w2: 1.2 * kN, dir: 'gy', t0: 0, t1: 1 });
      B.m.settings.selfWeight = true;
      return B.m;
    },
  },
  {
    id: 'gear', group: 'Aircraft', label: 'Landing-gear leg with side brace', build() {
      const B = builder({ sections: [{ id: 's1', name: 'Oleo tube Ø100×6', shape: 'tube', dims: { d: 0.1, t: 0.006 } }, { id: 's2', name: 'Brace tube Ø50×3', shape: 'tube', dims: { d: 0.05, t: 0.003 } }], defaults: { sec: 's1', mat: '4130' } });
      const top = B.node(0, 1.6), mid = B.node(0, 0.8), axle = B.node(0, 0), br = B.node(0.9, 1.6);
      B.member(top, mid); B.member(mid, axle); B.member(br, mid, { type: 'truss', sec: 's2' });
      B.support(top, 'pin', { angle: 180 }); B.support(br, 'pin', { angle: 180 });
      B.load({ kind: 'force', node: axle, fx: -12 * kN, fy: 45 * kN });
      return B.m;
    },
  },
  {
    id: 'block', group: 'Friction', label: 'Crate: slide or tip?', build() {
      const B = builder({ sections: [{ id: 's1', name: 'Rigid frame', shape: 'box', dims: { b: 0.05, h: 0.05, t: 0.005 } }] });
      const a = B.node(0, 0), b = B.node(1, 0), c = B.node(1, 1.5), d = B.node(0, 1.5), g = B.node(0.5, 0.75), p = B.node(0, 1.2);
      [[a, b], [b, c], [c, d], [d, p], [p, a], [a, g], [g, c], [b, g], [g, d]].forEach(([x, y]) => B.member(x, y));
      B.support(a, 'contact', { mu: 0.4 }); B.support(b, 'contact', { mu: 0.4 });
      B.load({ kind: 'force', node: g, fx: 0, fy: -1000, id: 'lw' });
      const push = B.load({ kind: 'force', node: p, fx: 200, fy: 0 });
      B.m.settings.scaleLoad = push;
      B.m.loads[0].id = 'lw';
      return B.m;
    },
  },
  {
    id: 'ladder', group: 'Friction', label: 'Ladder against a wall', build() {
      const B = builder({ sections: [{ id: 's1', name: 'Ladder rail', shape: 'rect', dims: { b: 0.03, h: 0.08 } }], defaults: { sec: 's1', mat: 'al6061' } });
      const th = 24 * Math.PI / 180, L = 5, pt = t => [L * Math.sin(th) * t, L * Math.cos(th) * t];
      const a = B.node(...pt(0)), m = B.node(...pt(0.5)), p = B.node(...pt(0.75)), t = B.node(...pt(1));
      B.member(a, m); B.member(m, p); B.member(p, t);
      B.support(a, 'contact', { mu: 0.3 }); B.support(t, 'contact', { mu: 0.1, angle: 90 });
      B.load({ kind: 'force', node: m, fx: 0, fy: -150 });
      const person = B.load({ kind: 'force', node: p, fx: 0, fy: -700 });
      B.m.settings.scaleLoad = person;
      return B.m;
    },
  },
  {
    id: 'column', group: 'Stability', label: 'Column buckling', build() {
      const B = builder({ sections: [W200] , defaults: { sec: 's2', mat: 'steel' } });
      const a = B.node(0, 0), b = B.node(0, 3), c = B.node(0, 6);
      B.member(a, b); B.member(b, c);
      B.support(a, 'pin'); B.support(c, 'roller', { angle: 90 });
      B.load({ kind: 'force', node: c, fx: 0, fy: -500 * kN });
      B.load({ kind: 'force', node: b, fx: 2 * kN, fy: 0 });
      return B.m;
    },
  },
  {
    id: 'thermal', group: 'Stability', label: 'Rail between walls, heated', build() {
      const B = builder({ sections: [{ id: 's1', name: 'Rail (approx.)', shape: 'ibeam', dims: { b: 0.15, h: 0.172, tf: 0.03, tw: 0.0165 } }] });
      const a = B.node(0, 0), b = B.node(5, 0), c = B.node(10, 0); const m1 = B.member(a, b), m2 = B.member(b, c);
      B.support(a, 'fixed'); B.support(c, 'fixed'); B.support(b, 'roller');
      B.load({ kind: 'thermal', member: m1, dT: 40, dTg: 0 }); B.load({ kind: 'thermal', member: m2, dT: 40, dTg: 0 });
      return B.m;
    },
  },
];

// one store shared by the tabs that work on the drawn structure (Structure & FBD, Vibration)
let shared = null;
export function sharedStore() { if (!shared) shared = new Store(loadSaved() || exampleModel('beam')); return shared; }

export function exampleModel(id) { const ex = EXAMPLES.find(e => e.id === id) || EXAMPLES[0]; return normalize(ex.build()); }
export const shapeDefaults = shape => ({ ...SHAPES[shape].def });
