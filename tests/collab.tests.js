// Collaborative-flight checks: the semi-infinite vortex against the 2-D Biot–Savart result, wake symmetry and the best formation
// spacing against tip-vortex alignment; the Hungarian, bottleneck and auction algorithms against brute force; beacon
// location exact with no noise and Monte Carlo against the Cramér–Rao bound; rendezvous timing and minimum-drag speed.
import * as T from '../js/solvers/collab.js';
import { AIRCRAFT } from '../js/solvers/performance.js';
import { atmosphere, rng } from '../js/solvers/atmosphere.js';

export function collabTests(log) {
  const near = (name, v, ref, tol, unit = '') => log(name, Math.abs(v - ref) <= tol, `got ${(+v).toFixed(6)}${unit}, expected ${(+ref).toFixed(6)}${unit} (±${tol})`);
  const rel = (name, v, ref, tol) => log(name, Math.abs(v / ref - 1) <= tol, `got ${(+v).toPrecision(6)}, expected ${(+ref).toPrecision(6)} (±${(tol * 100).toFixed(1)}%)`);

  // ---- vortex and wake ----
  const G = 50, d = 7;
  rel('trailing vortex far downstream: w = Γ/(2πd)', T.vortexAt(d, 0, 0, 0, 1, G, 0, 1e9).w, G / (2 * Math.PI * d), 1e-9);
  rel('…level with where it starts: exactly half', T.vortexAt(d, 0, 0, 0, 1, G, 0, 0).w, G / (4 * Math.PI * d), 1e-12);
  log('right tip vortex: upwash outboard, downwash inboard', T.vortexAt(3, 0, 0, 0, 1, G, 0.3).w > 0 && T.vortexAt(-3, 0, 0, 0, 1, G, 0.3).w < 0, '');
  const ac = AIRCRAFT.find(a => a.id === 'a320'), atm = atmosphere(11000), W = 65000 * 9.80665, V = 0.78 * atm.a, b = ac.b;
  const pair = (y, z = 0) => T.formation({ pos: [{ x: 0, y: 0, z: 0 }, { x: 4 * b, y, z }], b, W, rho: atm.rho, V });
  near('wake is mirror-symmetric left/right', pair(0.85 * b)[1].ratio, pair(-0.85 * b)[1].ratio, 1e-12);
  near('…and above/below', pair(0.85 * b, 0.1 * b)[1].ratio, pair(0.85 * b, -0.1 * b)[1].ratio, 1e-12);
  let best = [0, -1]; for (let f = 0.5; f <= 1.3; f += 0.005) { const r = pair(f * b)[1].ratio; if (r > best[1]) best = [f, r]; }
  log('best lateral spacing ≈ follower tip on leader\'s vortex (b/2 + πb/8 = 0.89b)', best[0] > 0.8 && best[0] < 0.93, `${best[0].toFixed(3)} b`);
  log('…cuts the follower\'s induced drag by 40–70% (horseshoe-vortex prediction)', best[1] > 0.4 && best[1] < 0.7, `${(best[1] * 100).toFixed(1)}%`);
  log('…flying too far inboard sits in the downwash and costs drag', pair(0.4 * b)[1].ratio < 0, `${(pair(0.4 * b)[1].ratio * 100).toFixed(0)}%`);
  const v5 = T.formation({ pos: T.pattern('v', 5, 0.86 * b, 4 * b), b, W, rho: atm.rho, V });
  log('in a V, the leader gains almost nothing (< 2%)', Math.abs(v5[0].ratio) < 0.02, `${(v5[0].ratio * 100).toFixed(1)}%`);
  log('…and the trailing aircraft gain the most', v5[3].ratio > v5[1].ratio, `${(v5[1].ratio * 100).toFixed(0)}% → ${(v5[3].ratio * 100).toFixed(0)}%`);

  // ---- assignment ----
  const rnd = rng(17), u = () => (rnd() + 4) / 8;
  const mat = (r, c) => [...Array(r)].map(() => [...Array(c)].map(() => Math.round(u() * 1000) / 10));
  let okH = true, okB = true, okA = true, worstGap = 0;
  for (let k = 0; k < 40; k++) {
    const C = k % 2 ? mat(5, 5) : mat(4, 6), bf = T.bruteForce(C), h = T.hungarian(C);
    if (Math.abs(h.total - bf.total) > 1e-9) okH = false;
    if (Math.abs(T.bottleneck(C).worst - T.bruteForce(C, 'max').worst) > 1e-9) okB = false;
    const eps = 0.01, a = T.auction(C, eps); worstGap = Math.max(worstGap, a.total - bf.total);
    if (a.total - bf.total > C.length * eps + 1e-9) okA = false;
  }
  log('Hungarian algorithm = brute force (40 random cases, square and rectangular)', okH, '');
  log('bottleneck assignment = brute-force smallest worst cost', okB, '');
  log('auction lands within n·ε of the optimum', okA, `largest gap ${worstGap.toFixed(4)}`);

  // ---- beacon location ----
  const S = [[-8000, -3000], [6000, -5000], [9000, 7000], [-5000, 8000]], p = [1500, 2500];
  for (const mode of ['bearing', 'tdoa']) {
    const f = T.locate(S, T.measure(S, p, mode), mode);
    log(`${mode === 'bearing' ? 'bearings' : 'time differences'}: no noise gives the exact position`, Math.hypot(f[0] - p[0], f[1] - p[1]) < 1e-3, `${Math.hypot(f[0] - p[0], f[1] - p[1]).toExponential(2)} m`);
  }
  const mcCheck = (mode, sig) => {
    const pts = T.monteCarlo(S, p, mode, sig, 3000, rng(5)), m = [0, 1].map(a => pts.reduce((s, q) => s + q[a], 0) / pts.length);
    const tr = pts.reduce((s, q) => s + (q[0] - m[0]) ** 2 + (q[1] - m[1]) ** 2, 0) / pts.length, C = T.crlb(S, p, mode, sig);
    return [Math.sqrt(tr), Math.sqrt(C[0][0] + C[1][1])];
  };
  const [mb, cb] = mcCheck('bearing', 0.5 * Math.PI / 180), [mt, ct] = mcCheck('tdoa', 30);
  rel('bearings (0.5°): Monte Carlo scatter matches the Cramér–Rao bound', mb, cb, 0.08);
  rel('time differences (30 m): Monte Carlo scatter matches the Cramér–Rao bound', mt, ct, 0.08);
  log('two receivers give one time difference: not enough for a 2-D fix', T.crlb(S.slice(0, 2), p, 'tdoa', 30) === null, '');
  const line = [[-9000, 0], [0, 0], [9000, 0]], Cl = T.crlb(line, [0, 6000], 'tdoa', 30), Cg = T.crlb(S.slice(0, 3), [0, 0], 'tdoa', 30);
  log('receivers in a line pin the beacon far worse than ones spread around it', Math.sqrt(Cl[0][0] + Cl[1][1]) > 1.5 * Math.sqrt(Cg[0][0] + Cg[1][1]), `${Math.sqrt(Cl[0][0] + Cl[1][1]).toFixed(0)} m vs ${Math.sqrt(Cg[0][0] + Cg[1][1]).toFixed(0)} m`);

  // ---- rendezvous ----
  const dr = [{ dist: 60000, vmin: 90, vmax: 220 }, { dist: 25000, vmin: 90, vmax: 220 }, { dist: 3000, vmin: 90, vmax: 220 }];
  const rv = T.rendezvous(dr);
  near('earliest join-up time = the farthest drone at full speed', rv.T, 60000 / 220, 1e-9, ' s');
  log('…every drone arrives at that moment, within its speed range', rv.plan.every(q => Math.abs(q.arrive - rv.T) < 1e-9 && q.v >= q.vmin - 1e-9 && q.v <= q.vmax + 1e-9), rv.plan.map(q => q.v.toFixed(0) + ' m/s').join(', '));
  near('…the close one holds for the time it cannot lose by slowing down', rv.plan[2].hold, rv.T - 3000 / 90, 1e-9, ' s');
  log('asking for an earlier time than that is infeasible', !T.rendezvous(dr, rv.T - 10).feasible, '');
  const dia = T.pattern('diamond', 4, 10, 15, 1);
  log('diamond: the slot flies directly behind the lead, stepped down', dia[3].y === 0 && dia[3].x > dia[1].x && dia[3].z < 0, `slot at x ${dia[3].x} m, z ${dia[3].z} m`);
  const vmd = T.minDragSpeed(ac, atm, W), Dm = v => T.dragSplit(ac, atm, v, W).D;
  log('minimum-drag speed: drag rises either side of it', Dm(vmd) < Dm(vmd * 0.95) && Dm(vmd) < Dm(vmd * 1.05), `${vmd.toFixed(1)} m/s`);
  near('…where induced drag equals zero-lift drag', T.dragSplit(ac, atm, vmd, W).share, 0.5, 1e-6);
}
