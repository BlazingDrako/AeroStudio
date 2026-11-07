// 3-D frame checks against closed-form beam, torsion, truss, vibration and buckling results.
import { analyze3d, modal3d, buckling3d } from '../js/solvers/frame3d.js';
import { sectionProps } from '../js/solvers/sections.js';

const tube = { id: 's1', name: 'tube', shape: 'tube', dims: { d: 0.1, t: 0.005 } };
const ib = { id: 's2', name: 'I', shape: 'ibeam', dims: { b: 0.15, h: 0.3, tf: 0.0107, tw: 0.0071 } };
const E = 200e9, G = E / 2.6, RHO = 7850;
const base = (nodes, members, supports, loads, sec = tube, extra = {}) => ({ nodes, members, supports, loads, sections: [sec], materials: [], settings: { selfWeight: false }, ...extra });
const N = (id, x, y, z) => ({ id, x, y, z });
const M = (id, a, b, more = {}) => ({ id, a, b, sec: 's1', mat: 'steel', ...more });
const FIX = [1, 1, 1, 1, 1, 1];

export function frame3dTests(log) {
  const near = (name, v, ref, tol, unit = '') => log(name, Math.abs(v - ref) <= tol * Math.max(Math.abs(ref), 1e-12), `got ${(+v).toPrecision(6)}${unit}, expected ${(+ref).toPrecision(6)}${unit} (±${(tol * 100).toFixed(2)}%)`);
  const S = sectionProps(tube), I = S.Ix, J = S.J, A = S.A, L = 2, P = 1000;

  // 1. cantilever along X, tip loads in Y and Z, tip torque
  let m = base([N('n1', 0, 0, 0), N('n2', L, 0, 0)], [M('m1', 'n1', 'n2')], [{ node: 'n1', r: FIX }], [{ id: 'l1', kind: 'node', node: 'n2', fy: P, fz: -2 * P, mx: 300 }]);
  let r = analyze3d(m);
  near('3D cantilever: tip deflection in Y = PL³/3EI', r.U[7], P * L ** 3 / (3 * E * I), 1e-9);
  near('3D cantilever: tip deflection in Z = PL³/3EI (biaxial, independent)', r.U[8], -2 * P * L ** 3 / (3 * E * I), 1e-9);
  near('3D cantilever: tip twist = TL/GJ', r.U[9], 300 * L / (G * J), 1e-9);
  near('3D cantilever: root moment about Y = 2P·L', Math.abs(r.reactions[0].F[4]), 2 * P * L, 1e-9);
  log('3D cantilever: equilibrium of loads and reactions', r.eqErr < 1e-10, `relative error ${r.eqErr.toExponential(2)}`);

  // 2. L-shaped bent: torsion in the first arm
  const a = 1.5, b = 1;
  m = base([N('n1', 0, 0, 0), N('n2', a, 0, 0), N('n3', a, b, 0)], [M('m1', 'n1', 'n2'), M('m2', 'n2', 'n3')], [{ node: 'n1', r: FIX }], [{ id: 'l1', kind: 'node', node: 'n3', fz: -P }]);
  r = analyze3d(m);
  const dRef = P * b ** 3 / (3 * E * I) + P * a ** 3 / (3 * E * I) + P * b * b * a / (G * J);
  near('L-bent: tip deflection = Pb³/3EI + Pa³/3EI + Pb²a/GJ', -r.U[6 * 2 + 2], dRef, 1e-9);
  near('L-bent: torque in the first arm = P·b', Math.abs(r.members[0].ext.T), P * b, 1e-9);
  near('L-bent: bending moment at the root = P·a', Math.abs(r.members[0].Mz[0]), P * a, 1e-9);

  // 3. tripod (statically determinate space truss)
  const h = 3, rr = 1.2, Lleg = Math.hypot(h, rr);
  const legs = [0, 1, 2].map(k => N('b' + k, rr * Math.cos(k * 2 * Math.PI / 3), rr * Math.sin(k * 2 * Math.PI / 3), 0));
  m = base([N('top', 0, 0, h), ...legs], legs.map((n, k) => M('m' + k, n.id, 'top', { type: 'truss' })), legs.map(n => ({ node: n.id, r: [1, 1, 1, 0, 0, 0] })), [{ id: 'l1', kind: 'node', node: 'top', fz: -3 * P }]);
  r = analyze3d(m);
  near('tripod: each leg carries P/(3 sin θ) in compression', r.members[0].N[0], -3 * P / (3 * h / Lleg), 1e-9);
  const m2 = JSON.parse(JSON.stringify(m)); m2.members.pop(); m2.nodes.pop(); m2.supports.pop();
  r = analyze3d(m2);
  log('bipod (one leg removed) is reported as a mechanism', !r.ok && r.error === 'mechanism', r.ok ? 'solved' : r.error);

  // 4. simply supported beam with uniform load in Z
  const w = -5000, Ls = 4;
  m = base([N('n1', 0, 0, 0), N('n2', Ls, 0, 0)], [M('m1', 'n1', 'n2', { sec: 's2' })], [{ node: 'n1', r: [1, 1, 1, 1, 0, 0] }, { node: 'n2', r: [0, 1, 1, 0, 0, 0] }], [{ id: 'l1', kind: 'dist', member: 'm1', dir: 'gz', w1: w, w2: w }], ib);
  r = analyze3d(m);
  const Sib = sectionProps(ib), mid = r.members[0].s.findIndex(s => Math.abs(s - Ls / 2) < 1e-9);
  near('simply supported beam: midspan moment = wL²/8 (strong axis)', Math.abs(r.members[0].Mz[mid]), Math.abs(w) * Ls * Ls / 8, 1e-9);
  near('simply supported beam: midspan deflection = 5wL⁴/384EI', Math.abs(r.members[0].dg[mid][2]), 5 * Math.abs(w) * Ls ** 4 / (384 * E * Sib.Ix), 1e-4);
  // roll the I-beam 90°: now it bends about its weak axis
  m.members[0].roll = 90; r = analyze3d(m);
  near('roll 90°: same beam bends about the weak axis (5wL⁴/384EIy)', Math.abs(r.members[0].dg[mid][2]), 5 * Math.abs(w) * Ls ** 4 / (384 * E * Sib.Iy), 1e-4);

  // 5. end release: propped beam with a pinned end carries no moment there
  m = base([N('n1', 0, 0, 0), N('n2', Ls, 0, 0)], [M('m1', 'n1', 'n2', { relB: true })], [{ node: 'n1', r: FIX }, { node: 'n2', r: FIX }], [{ id: 'l1', kind: 'dist', member: 'm1', dir: 'gz', w1: w, w2: w }]);
  r = analyze3d(m);
  const mr = r.members[0];
  log('member-end pin: moment at the released end is zero', Math.hypot(mr.My[mr.My.length - 1], mr.Mz[mr.Mz.length - 1]) < 1e-9 * Math.abs(w) * Ls * Ls, `M_end = ${Math.hypot(mr.My[mr.My.length - 1], mr.Mz[mr.Mz.length - 1]).toExponential(2)}`);
  near('member-end pin: fixed-end moment = wL²/8 (propped cantilever)', Math.abs(mr.Mz[0]), Math.abs(w) * Ls * Ls / 8, 1e-9);

  // 6. thermal: fully fixed bar heated
  m = base([N('n1', 0, 0, 0), N('n2', 0, Ls, 1)], [M('m1', 'n1', 'n2')], [{ node: 'n1', r: FIX }, { node: 'n2', r: FIX }], [{ id: 'l1', kind: 'thermal', member: 'm1', dT: 40 }]);
  r = analyze3d(m);
  near('restrained heating: N = −EAα·ΔT', r.members[0].N[0], -E * A * 12e-6 * 40, 1e-9);

  // 7. modal: cantilever first bending frequency (pair of equal modes for a tube)
  m = base([N('n1', 0, 0, 0), N('n2', 0, 0, L)], [M('m1', 'n1', 'n2')], [{ node: 'n1', r: FIX }], []);
  const md = modal3d(m, { nModes: 6, nsub: 10 });
  const f1 = 1.8751 ** 2 / (2 * Math.PI) * Math.sqrt(E * I / (RHO * A * L ** 4));
  near('vertical cantilever: first natural frequency (1.875²/2π)√(EI/mL⁴)', md.modes[0].f, f1, 1e-3, ' Hz');
  near('vertical cantilever: second mode is the same frequency in the other plane', md.modes[1].f, f1, 1e-3, ' Hz');
  const fT = 1 / (4 * L) * Math.sqrt(G / RHO);
  const tor = md.modes.find(q => Math.abs(q.f / fT - 1) < 0.02);
  log('vertical cantilever: torsion mode at (1/4L)√(G/ρ)', !!tor, tor ? `got ${tor.f.toPrecision(6)} Hz, expected ${fT.toPrecision(6)} Hz` : 'not found');
  const effX = md.modes.reduce((s, q) => s + q.eff[0], 0);
  log('effective modal mass in X adds up to most of the free mass', effX / md.massFree[0] > 0.85, `${(effX / md.massFree[0] * 100).toFixed(1)}%`);

  // 8. buckling: cantilever column (K = 2)
  m = base([N('n1', 0, 0, 0), N('n2', 0, 0, L)], [M('m1', 'n1', 'n2')], [{ node: 'n1', r: FIX }], [{ id: 'l1', kind: 'node', node: 'n2', fz: -P }]);
  const bk = buckling3d(m, { nsub: 8 });
  near('cantilever column: buckling load π²EI/(2L)²', bk.modes[0].lambda * P, Math.PI ** 2 * E * I / (4 * L * L), 1e-3);
  // pinned-pinned truss bar subdivided as a beam buckles at π²EI/L²
  m = base([N('n1', 0, 0, 0), N('n2', L, 0, 0)], [M('m1', 'n1', 'n2', { type: 'truss' })], [{ node: 'n1', r: [1, 1, 1, 0, 0, 0] }, { node: 'n2', r: [0, 1, 1, 0, 0, 0] }], [{ id: 'l1', kind: 'node', node: 'n2', fx: -P }]);
  const bk2 = buckling3d(m, { nsub: 8 });
  near('pinned truss bar: buckling load π²EI/L²', bk2.modes[0] ? bk2.modes[0].lambda * P : NaN, Math.PI ** 2 * E * I / (L * L), 1e-3);

  // 9. I-column: weak-axis flexural buckling governs once warping stiffens the torsional mode
  const w250 = { id: 's1', name: 'W250', shape: 'ibeam', dims: { b: 0.202, h: 0.247, tf: 0.011, tw: 0.0074 } }, Sw = sectionProps(w250), Lc = 3.5;
  m = base([N('n1', 0, 0, 0), N('n2', 0, 0, Lc)], [M('m1', 'n1', 'n2')], [{ node: 'n1', r: [1, 1, 1, 0, 0, 1] }, { node: 'n2', r: [1, 1, 0, 0, 0, 1] }], [{ id: 'l1', kind: 'node', node: 'n2', fz: -P }], w250);
  const bk3 = buckling3d(m, { nsub: 8 });
  near('pinned I-column: weak-axis Euler load π²EIy/L² (no spurious twisting mode)', bk3.modes[0].lambda * P, Math.PI ** 2 * E * Sw.Iy / (Lc * Lc), 2e-3);
}
