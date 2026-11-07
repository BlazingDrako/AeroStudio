// Stability checks: the eigen-solver, Nelson's Navion example (published eigenvalues), trim and neutral-point
// identities, classical mode approximations, trends with CG and dihedral, and the relaxed-stability fighter.
import * as St from '../js/solvers/stability.js';
import { geometric, G0 } from '../js/solvers/atmosphere.js';

export function stabilityTests(log) {
  const near = (name, v, ref, tol, unit = '') => log(name, Math.abs(v - ref) <= tol, `got ${(+v).toPrecision(6)}${unit}, expected ${(+ref).toPrecision(6)}${unit} (±${tol})`);
  const rel = (name, v, ref, tol) => log(name, Math.abs(v / ref - 1) <= tol, `got ${(+v).toPrecision(6)}, expected ${(+ref).toPrecision(6)} (±${(tol * 100).toFixed(1)}%)`);
  const FT = 0.3048, KT = 0.514444;
  const has = (roots, re, im, tol) => roots.some(z => Math.abs(z[0] - re) <= tol * Math.hypot(re, im) && Math.abs(Math.abs(z[1]) - im) <= tol * Math.hypot(re, im));

  // ---- eigen-solver ----
  const T = [[0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1], [-24, -50, -35, -10]];   // roots −1, −2, −3, −4
  const r = St.eig(T).map(z => z[0]).sort((a, b) => a - b);
  log('eigenvalues of a companion matrix (−4, −3, −2, −1)', r.every((v, i) => Math.abs(v - [-4, -3, -2, -1][i]) < 1e-8), r.map(v => v.toFixed(9)).join(', '));
  const Rm = [[0, -2, 0, 0], [2, 0, 0, 0], [0, 0, -1, 0], [0, 0, 0, 3]];
  log('complex pair ±2i and reals −1, 3', has(St.eig(Rm), 0, 2, 1e-9) && has(St.eig(Rm), -1, 0, 1e-9) && has(St.eig(Rm), 3, 0, 1e-9), JSON.stringify(St.eig(Rm)));

  // ---- Nelson, Navion: dimensional derivatives and published eigenvalues ----
  const lon = St.longFromDim({ U: 176 * FT, Xu: -0.045, Xw: 0.036, Zu: -0.369, Zw: -2.02, Mu: 0, Mw: -0.05 / FT, Mwd: -0.0051 / FT, Mq: -2.05 });
  const eL = St.eig(lon.A);
  log('Navion short period −2.51 ± 2.59i (Nelson)', has(eL, -2.51, 2.59, 0.015), JSON.stringify(eL.map(z => z.map(v => +v.toFixed(4)))));
  log('Navion phugoid −0.017 ± 0.213i (Nelson)', has(eL, -0.017, 0.213, 0.01), '');
  const lat = St.latFromDim({ U: 176 * FT, Yb: -45.72 * FT, Lb: -15.97, Lp: -8.40, Lr: 2.19, Nb: 4.49, Np: -0.35, Nr: -0.76 });
  const eT = St.eig(lat.A);
  log('Navion Dutch roll −0.487 ± 2.335i (Nelson)', has(eT, -0.487, 2.335, 0.01), JSON.stringify(eT.map(z => z.map(v => +v.toFixed(4)))));
  log('Navion roll −8.43 and spiral −0.0088 (Nelson)', has(eT, -8.43, 0, 0.005) && eT.some(z => Math.abs(z[0] + 0.0088) < 0.0003), '');
  const lam = eT.find(z => z[1] > 0), v = St.eigvec(lat.A, ...lam);
  const res = Math.max(...lat.A.map((row, i) => { let sr = -lam[0] * v[i][0] + lam[1] * v[i][1], si = -lam[0] * v[i][1] - lam[1] * v[i][0]; row.forEach((a, j) => { sr += a * v[j][0]; si += a * v[j][1]; }); return Math.hypot(sr, si); }));
  log('eigenvector satisfies (A − λI)v = 0', res < 1e-9, `max residual ${res.toExponential(2)}`);

  // ---- trim and neutral point ----
  const c172 = { id: 'c172', mass: 1043, z: geometric(5000 * FT), V: 120 * KT, cg: 0.27 };
  const a = St.analyse(c172), d = a.d;
  near('trim: lift equals weight', d.CL0 + d.CLa * a.trim.alpha + d.CLde * a.trim.de, d.CLtrim, 1e-12);
  near('trim: pitching moment zero', d.Cm0 + d.Cma * a.trim.alpha + d.Cmde * a.trim.de, 0, 1e-12);
  near('Cmα = 0 with the CG at the neutral point', St.derivatives({ ...c172, cg: d.hn, it: a.it }).Cma, 0, 1e-9);
  log('maneuver point lies aft of the neutral point', a.perG.hm > d.hn, `hn ${d.hn.toFixed(3)}, hm ${a.perG.hm.toFixed(3)}`);
  log('light single: static margin 10–25% at mid CG', d.SM > 0.10 && d.SM < 0.25, `${(d.SM * 100).toFixed(1)}%`);
  log('light single: nose-up elevator to pull g', a.perG.dePerG < 0, `${(a.perG.dePerG * 180 / Math.PI).toFixed(2)}°/g`);

  // ---- classical approximations against the full model (light single) ----
  const D = St.longDim(d), sp = a.L.sp, ph = a.L.ph;
  const wsp = Math.sqrt(D.Zw * D.Mq - D.Mw * D.U);
  rel('short period ωn ≈ √(Zw·Mq − Mw·U)', sp.wn, wsp, 0.12);
  // Lanchester's approximation runs high: for Nelson's Navion it gives 0.258 rad/s against the exact 0.213 (17%)
  rel('phugoid ωn ≈ √(−g·Zu/U) (Lanchester, within 20%)', ph.wn, Math.sqrt(-G0 * D.Zu / D.U), 0.2);
  const DL = St.latDim(d);
  rel('roll mode τ ≈ −1/Lp', a.Lt.roll.tau, -1 / DL.Lp, 0.15);
  rel('Dutch roll ωn ≈ √(Nβ + Yβ·Nr/U)', a.Lt.dr.wn, Math.sqrt(DL.Nb + DL.Yb * DL.Nr / DL.U), 0.2);
  log('light single: Level 1 in every mode (MIL-F-8785C, Cat B)', ['sp', 'ph', 'dr', 'roll', 'spiral'].every(k => a.hq[k] === 1), JSON.stringify(a.hq));
  log('light single: short period 4–8 rad/s, phugoid 25–45 s', sp.wn > 4 && sp.wn < 8 && ph.period > 25 && ph.period < 45, `ωsp ${sp.wn.toFixed(2)} rad/s, Tph ${ph.period.toFixed(1)} s`);

  // ---- trends ----
  const aft = St.analyse({ ...c172, cg: d.hn + 0.06, it: a.it });
  log('CG behind the neutral point: a divergent real root', aft.L.roots.some(z => z[1] === 0 && z[0] > 0), JSON.stringify(aft.L.roots.map(z => z.map(v => +v.toFixed(3)))));
  const dih = St.analyse({ ...c172, dihedral: 6, it: a.it });
  log('more dihedral: spiral more stable, roll–yaw coupling stronger', dih.Lt.spiral.re < a.Lt.spiral.re && dih.d.Clb < d.Clb, `spiral ${a.Lt.spiral.re.toFixed(4)} → ${dih.Lt.spiral.re.toFixed(4)}`);
  const bigFin = St.analyse({ ...c172, vt: 1.5, it: a.it });
  log('bigger fin: higher weathercock stability and Dutch-roll frequency', bigFin.d.Cnb > d.Cnb && bigFin.Lt.dr.wn > a.Lt.dr.wn, `Cnβ ${d.Cnb.toFixed(3)} → ${bigFin.d.Cnb.toFixed(3)}`);
  const a320 = St.analyse({ id: 'a320', mass: 65000, z: geometric(35000 * FT), V: 0.78 * 296.5, cg: 0.3 });
  log('airliner at cruise: lightly damped Dutch roll (why yaw dampers exist)', a320.Lt.dr.zeta < 0.1, `ζ ${a320.Lt.dr.zeta.toFixed(3)}`);

  // ---- relaxed static stability ----
  const f16 = St.analyse({ id: 'f16', mass: 9295, z: geometric(15000 * FT), V: 0.6 * 322.2, cg: 0.35 });
  near('fighter: neutral point ≈ 0.31 MAC (≈ 4% unstable at 0.35)', f16.d.hn, 0.31, 0.01);
  const up = f16.L.roots.find(z => z[1] === 0 && z[0] > 0);
  log('fighter unaugmented: pitch divergence doubles in 0.4–1.5 s', up && Math.LN2 / up[0] > 0.4 && Math.LN2 / up[0] < 1.5, up ? `${(Math.LN2 / up[0]).toFixed(2)} s` : 'no divergent root');

  // ---- time response ----
  const one = St.simulate([[-2]], null, [1], () => 0, 1, 0.001);
  near('RK4 response of ẋ = −2x at t = 1', one.x[one.x.length - 1][0], Math.exp(-2), 1e-6);
}
