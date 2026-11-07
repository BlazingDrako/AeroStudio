// Structures checks: stiffness solver vs closed-form beam/truss/frame results, modal and buckling vs
// analytical values, rigid-body statics (determinacy, friction, tipping), section properties.
import { analyze, modal, buckling } from '../js/solvers/frame2d.js';
import { analyzeStatics } from '../js/solvers/statics.js';
import { sectionProps } from '../js/solvers/sections.js';
import { symEig, linprog } from '../js/lib/eigen.js';

const E = 200e9;
const mat = [{ id: 'm', name: 'test', E, nu: 0.3, rho: 7850, fy: 250e6, alpha: 12e-6 }];
const sec = [{ id: 's', name: 'rect', shape: 'rect', dims: { b: 0.1, h: 0.2 } }];
const I = 0.1 * 0.2 ** 3 / 12, A = 0.02;

function model(nodes, members, supports, loads, settings = {}) {
  return {
    nodes: nodes.map(([x, y], k) => ({ id: 'n' + k, x, y })),
    members: members.map(([a, b, o = {}], k) => ({ id: 'm' + k, a: 'n' + a, b: 'n' + b, type: 'frame', sec: 's', mat: 'm', ...o })),
    supports: supports.map(([n, type, o = {}]) => ({ node: 'n' + n, type, ...o })),
    loads: loads.map((l, k) => ({ id: 'l' + k, ...l, node: l.node !== undefined ? 'n' + l.node : undefined, member: l.member !== undefined ? 'm' + l.member : undefined })),
    sections: sec, materials: mat, settings: { selfWeight: false, g: 9.80665, ...settings },
  };
}
const R = (res, n) => res.reactions.find(r => r.node === 'n' + n);
const maxAbs = a => Math.max(...a.map(Math.abs));

export function structuresTests(log) {
  const near = (name, v, ref, rtol = 1e-6, unit = '') => {
    const ok = Math.abs(v - ref) <= rtol * Math.max(Math.abs(ref), 1e-12);
    log(name, ok, `got ${(+v).toPrecision(7)}${unit}, expected ${(+ref).toPrecision(7)}${unit}`);
  };
  const L = 6, w = 10e3, P = 20e3;

  // 1. simply supported beam, UDL
  let m = model([[0, 0], [L, 0]], [[0, 1]], [[0, 'pin'], [1, 'roller']], [{ kind: 'dist', member: 0, w1: -w, w2: -w, dir: 'gy' }]);
  let r = analyze(m);
  near('SS beam UDL: reaction = wL/2', R(r, 1).Ry, w * L / 2);
  near('SS beam UDL: Mmax = wL²/8', r.members[0].ext.M.max, w * L * L / 8, 1e-4);
  near('SS beam UDL: midspan deflection = 5wL⁴/384EI', -r.members[0].sag.v, 5 * w * L ** 4 / (384 * E * I), 1e-3);
  log('global equilibrium ΣFy', Math.abs(r.totals.Fy + r.totals.Ry) < 1e-9 * w * L, `residual ${(r.totals.Fy + r.totals.Ry).toExponential(2)} N`);

  // 2. cantilever, tip load
  m = model([[0, 0], [L, 0]], [[0, 1]], [[0, 'fixed']], [{ kind: 'force', node: 1, fx: 0, fy: -P }]);
  r = analyze(m);
  near('cantilever: tip deflection = PL³/3EI', -r.nodes[1].uy, P * L ** 3 / (3 * E * I));
  near('cantilever: fixed-end moment = PL', R(r, 0).Mz, P * L);
  near('cantilever: tip rotation = PL²/2EI', -r.nodes[1].rz, P * L * L / (2 * E * I));

  // 3. propped cantilever UDL (indeterminate)
  m = model([[0, 0], [L, 0]], [[0, 1]], [[0, 'fixed'], [1, 'roller']], [{ kind: 'dist', member: 0, w1: -w, w2: -w }]);
  r = analyze(m);
  near('propped cantilever: R_B = 3wL/8', R(r, 1).Ry, 3 * w * L / 8);
  near('propped cantilever: M_A = wL²/8', R(r, 0).Mz, w * L * L / 8);
  let s = analyzeStatics(m);
  log('propped cantilever: indeterminate to degree 1', s.classification === 'indeterminate' && s.degree === 1, `${s.classification}, degree ${s.degree}`);

  // 4. fixed-fixed UDL
  m = model([[0, 0], [L, 0]], [[0, 1]], [[0, 'fixed'], [1, 'fixed']], [{ kind: 'dist', member: 0, w1: -w, w2: -w }]);
  r = analyze(m);
  near('fixed-fixed UDL: end moment = wL²/12', -r.members[0].end.M1, w * L * L / 12);
  near('fixed-fixed UDL: midspan deflection = wL⁴/384EI', -r.members[0].sag.v, w * L ** 4 / (384 * E * I), 1e-3);

  // 5. point load off-centre, SS
  const a = 2, b = L - a;
  m = model([[0, 0], [L, 0]], [[0, 1]], [[0, 'pin'], [1, 'roller']], [{ kind: 'point', member: 0, t: a / L, fx: 0, fy: -P }]);
  r = analyze(m);
  near('SS beam point load: R_A = Pb/L', R(r, 0).Ry, P * b / L);
  near('SS beam point load: M under load = Pab/L', r.members[0].ext.M.max, P * a * b / L, 1e-6);
  near('SS beam point load: deflection under load = Pa²b²/3EIL', -r.members[0].v[r.members[0].x.findIndex(x => Math.abs(x - a) < 1e-6)], P * a * a * b * b / (3 * E * I * L), 1e-3);

  // 6. triangular load on SS beam: R_B = wL/3, Mmax = wL²/(9√3)
  m = model([[0, 0], [L, 0]], [[0, 1]], [[0, 'pin'], [1, 'roller']], [{ kind: 'dist', member: 0, w1: 0, w2: -w }]);
  r = analyze(m);
  near('triangular load: R_B = wL/3', R(r, 1).Ry, w * L / 3);
  near('triangular load: Mmax = wL²/(9√3)', r.members[0].ext.M.max, w * L * L / (9 * Math.sqrt(3)), 1e-4);

  // 7. two-span continuous beam, UDL: middle reaction 5wL/4 (L each span)
  m = model([[0, 0], [L, 0], [2 * L, 0]], [[0, 1], [1, 2]], [[0, 'pin'], [1, 'roller'], [2, 'roller']], [{ kind: 'dist', member: 0, w1: -w, w2: -w }, { kind: 'dist', member: 1, w1: -w, w2: -w }]);
  r = analyze(m);
  near('continuous beam: middle reaction = 5wL/4', R(r, 1).Ry, 1.25 * w * L);
  near('continuous beam: support moment = wL²/8', -r.members[0].end.M2, w * L * L / 8);

  // 8. truss: 3-4-5 triangle, load at apex
  m = model([[0, 0], [8, 0], [4, 3]], [[0, 1, { type: 'truss' }], [0, 2, { type: 'truss' }], [1, 2, { type: 'truss' }]], [[0, 'pin'], [1, 'roller']], [{ kind: 'force', node: 2, fx: 0, fy: -P }]);
  r = analyze(m);
  near('truss: inclined members F = −(P/2)/sin θ', r.members[1].end.N1, -(P / 2) / 0.6);
  near('truss: bottom chord F = (P/2)/tan θ', r.members[0].end.N1, (P / 2) / 0.75);
  s = analyzeStatics(m);
  log('truss: statically determinate (m + r = 2j)', s.classification === 'determinate', `${s.classification}, unknowns ${s.nu}, rank ${s.rank}`);
  const fx = s.values.find(u => u.name === 'F_AC');
  near('truss statics: method of joints gives same member force', fx.value, -(P / 2) / 0.6);

  // 9. thermal: fixed-fixed bar heated
  m = model([[0, 0], [L, 0]], [[0, 1]], [[0, 'fixed'], [1, 'fixed']], [{ kind: 'thermal', member: 0, dT: 50, dTg: 0 }]);
  r = analyze(m);
  near('thermal: restrained bar N = −EAαΔT', r.members[0].end.N1, -E * A * 12e-6 * 50);
  // thermal gradient on a simply supported beam: free bending, no reactions
  m = model([[0, 0], [L, 0]], [[0, 1]], [[0, 'pin'], [1, 'roller']], [{ kind: 'thermal', member: 0, dT: 0, dTg: -20 }]);
  r = analyze(m);
  near('thermal gradient (hot bottom): SS midspan sags κL²/8, κ = αΔT/h', r.members[0].sag.v, -(12e-6 * 20 / 0.2) * L * L / 8, 1e-3);
  log('thermal gradient: statically determinate beam has no reactions', Math.abs(R(r, 1).Ry) < 1e-6, `R_B = ${R(r, 1).Ry}`);

  // 10. internal hinge (Gerber beam): cantilever + hinge + simply supported
  m = model([[0, 0], [2, 0], [6, 0]], [[0, 1, { relB: true }], [1, 2]], [[0, 'fixed'], [2, 'roller']], [{ kind: 'dist', member: 1, w1: -w, w2: -w }]);
  r = analyze(m);
  log('hinge: moment at hinge = 0', Math.abs(r.members[0].end.M2) < 1e-9 * w * 16, `M = ${r.members[0].end.M2.toExponential(2)} N·m`);
  near('hinge: R_C = w·4/2', R(r, 2).Ry, w * 2);
  s = analyzeStatics(m);
  log('hinged beam: determinate', s.classification === 'determinate', s.classification);

  // 11. inclined roller
  m = model([[0, 0], [L, 0]], [[0, 1]], [[0, 'pin'], [1, 'roller', { angle: 30 }]], [{ kind: 'point', member: 0, t: 0.5, fx: 0, fy: -P }]);
  r = analyze(m);
  const rb = R(r, 1);
  near('inclined roller: reaction normal to the surface (Rx/Ry = −tan30°)', rb.Rx / rb.Ry, -Math.tan(Math.PI / 6), 1e-8);

  // 12. portal frame, lateral load (sway): equilibrium check
  m = model([[0, 0], [0, 4], [6, 4], [6, 0]], [[0, 1], [1, 2], [2, 3]], [[0, 'fixed'], [3, 'fixed']], [{ kind: 'force', node: 1, fx: P, fy: 0 }]);
  r = analyze(m);
  near('portal frame: ΣFx reactions = −P', r.totals.Rx, -P, 1e-9);
  log('portal frame: global moment balance', Math.abs(r.totals.Mo + r.totals.Rm) < 1e-9 * P * 6, `residual ${(r.totals.Mo + r.totals.Rm).toExponential(2)} N·m`);

  // 13. modal: simply supported beam f1 = (π/2L²)√(EI/ρA)
  m = model([[0, 0], [L, 0]], [[0, 1]], [[0, 'pin'], [1, 'roller']], []);
  let md = modal(m, { nsub: 10 });
  near('modal: SS beam f₁ = (π/2L²)√(EI/ρA)', md.modes.find(x => x.effY > 0.5 || x.f > 1).f, Math.PI / (2 * L * L) * Math.sqrt(E * I / (7850 * A)), 1e-3);
  m = model([[0, 0], [L, 0]], [[0, 1]], [[0, 'fixed']], []);
  md = modal(m, { nsub: 10 });
  near('modal: cantilever f₁ = 1.8751²/(2πL²)√(EI/ρA)', md.modes[0].f, 1.8751 ** 2 / (2 * Math.PI * L * L) * Math.sqrt(E * I / (7850 * A)), 1e-3);
  // 14. buckling
  m = model([[0, 0], [0, L]], [[0, 1]], [[0, 'pin'], [1, 'roller', { angle: 90 }]], [{ kind: 'force', node: 1, fx: 0, fy: -1000 }]);
  let bk = buckling(m, { nsub: 10 });
  near('buckling: pinned column P_cr = π²EI/L²', bk.modes[0].lambda * 1000, Math.PI ** 2 * E * I / (L * L), 1e-3);
  m = model([[0, 0], [0, L]], [[0, 1]], [[0, 'fixed']], [{ kind: 'force', node: 1, fx: 0, fy: -1000 }]);
  bk = buckling(m, { nsub: 10 });
  near('buckling: cantilever column P_cr = π²EI/4L²', bk.modes[0].lambda * 1000, Math.PI ** 2 * E * I / (4 * L * L), 1e-3);

  m = model([[0, 0], [0, L]], [[0, 1, { type: 'truss' }]], [[0, 'pin'], [1, 'roller', { angle: 90 }]], [{ kind: 'force', node: 1, fx: 0, fy: -1000 }]);
  bk = buckling(m, { nsub: 10 });
  near('buckling: a truss bar buckles at its own Euler load', bk.modes[0].lambda * 1000, Math.PI ** 2 * E * I / (L * L), 1e-3);

  // 15. statics: mechanism detection (beam on two rollers)
  m = model([[0, 0], [L, 0]], [[0, 1]], [[0, 'roller'], [1, 'roller']], [{ kind: 'force', node: 1, fx: P, fy: 0 }]);
  s = analyzeStatics(m);
  log('two rollers + horizontal load: unstable, not in equilibrium', s.unstable && !s.consistent, `${s.classification}, consistent ${s.consistent}`);
  const fr = analyze(m);
  log('stiffness solver reports a mechanism', !fr.ok && fr.error === 'mechanism', fr.error || 'solved');

  // 16. friction: block (b × h) on floor, weight W at centre, push P at height hp
  const W = 1000, bw = 1, hb = 2, mu = 0.3;
  const block = (hp, scaleId) => model([[0, 0], [bw, 0], [bw, hb], [0, hb], [bw / 2, hb / 2], [0, hp]],
    [[0, 1], [1, 2], [2, 3], [3, 5], [5, 0], [0, 4], [4, 2]],
    [[0, 'contact', { mu }], [1, 'contact', { mu }]],
    [{ kind: 'force', node: 4, fx: 0, fy: -W, id: 'w' }, { kind: 'force', node: 5, fx: 100, fy: 0, id: 'push' }]);
  let blk = block(0.2);
  blk.loads[0].id = 'w'; blk.loads[1].id = 'push';
  s = analyzeStatics(blk, { scale: 'push' });
  near('friction: low push slides at P = µW', s.limit.lambda * 100, mu * W, 1e-6);
  log('friction: mechanism is slip', s.limit.mech.some(x => x.kind === 'slip'), JSON.stringify(s.limit.mech));
  blk = block(1.9); blk.loads[0].id = 'w'; blk.loads[1].id = 'push';
  s = analyzeStatics(blk, { scale: 'push' });
  near('tipping: high push tips at P = W·(b/2)/h', s.limit.lambda * 100, W * (bw / 2) / 1.9, 1e-6);
  log('tipping: the pushed-side corner lifts off', s.limit.mech.some(x => x.kind === 'lift' && x.node === 0), JSON.stringify(s.limit.mech));

  // 17. ladder against a smooth wall: slips when tanθ = 2µ for a uniform ladder (θ from vertical)
  const th = Math.atan(2 * 0.4) * 0.98, Ll = 4;
  const lx = Ll * Math.sin(th), ly = Ll * Math.cos(th);
  const lad = model([[0, 0], [lx / 2, ly / 2], [lx, ly]], [[0, 1], [1, 2]], [[0, 'contact', { mu: 0.4 }], [2, 'contact', { mu: 0, angle: 90 }]], [{ kind: 'force', node: 1, fx: 0, fy: -W }]);
  s = analyzeStatics(lad);
  log('ladder just below the slip angle holds (proportional loads: never slips)', s.limit.status === 'unbounded', `status ${s.limit.status}, λ = ${s.limit.lambda}`);
  const lad2 = model([[0, 0], [lx / 2, ly / 2], [lx, ly]].map(([x, y]) => [x / 0.98 * 1.05, y]), [[0, 1], [1, 2]], [[0, 'contact', { mu: 0.4 }], [2, 'contact', { mu: 0, angle: 90 }]], [{ kind: 'force', node: 1, fx: 0, fy: -W }]);
  s = analyzeStatics(lad2);
  log('ladder past the slip angle cannot stand', s.limit.status === 'infeasible' || s.limit.lambda === 0, `status ${s.limit.status}`);

  // 18. section properties
  let p = sectionProps({ shape: 'rect', dims: { b: 0.1, h: 0.2 } });
  near('rectangle: I = bh³/12', p.Ix, I, 1e-12); near('rectangle: Z = bh²/4', p.Zx, 0.1 * 0.04 / 4, 1e-9);
  near('rectangle: τmax = 1.5 V/A factor Q/(Ib)', p.Qmax / (p.Ix * p.bNA), 1.5 / A, 1e-9);
  p = sectionProps({ shape: 'circle', dims: { d: 0.1 } });
  near('circle: I = πd⁴/64', p.Ix, Math.PI * 1e-4 / 64, 1e-6);
  p = sectionProps({ shape: 'ibeam', dims: { b: 0.2, h: 0.4, tf: 0.02, tw: 0.01 } });
  near('I-beam: I = (bh³ − (b−tw)(h−2tf)³)/12', p.Ix, (0.2 * 0.4 ** 3 - 0.19 * 0.36 ** 3) / 12, 1e-10);
  p = sectionProps({ shape: 'tee', dims: { b: 0.1, h: 0.1, tf: 0.01, tw: 0.01 } });
  near('tee: centroid from the base', p.yc, (0.001 * 0.095 + 0.0009 * 0.045) / 0.0019, 1e-10);

  // 19. numerics
  const ev = symEig([[2, -1, 0], [-1, 2, -1], [0, -1, 2]]).values;
  near('symEig: smallest eigenvalue 2 − √2', ev[0], 2 - Math.SQRT2, 1e-12);
  near('symEig: largest eigenvalue 2 + √2', ev[2], 2 + Math.SQRT2, 1e-12);
  const lp = linprog({ c: [3, 5], Aub: [[1, 0], [0, 2], [3, 2]], bub: [4, 12, 18] });
  near('linprog: textbook example optimum 36', lp.value, 36, 1e-9);
}
