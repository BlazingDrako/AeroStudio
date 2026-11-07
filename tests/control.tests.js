// Control checks: state space to transfer function against a direct frequency-response solve, closed-form
// second-order results (overshoot, phase margin, crossover), a textbook gain margin, Padé delays, the delay margin,
// root-locus points, and the aircraft loops (pitch damper, yaw damper, the relaxed-stability fighter).
import * as Ct from '../js/solvers/control.js';
import * as St from '../js/solvers/stability.js';
import { geometric } from '../js/solvers/atmosphere.js';
import { solveSmall } from '../js/lib/linalg.js';

export function controlTests(log) {
  const near = (name, v, ref, tol, unit = '') => log(name, Math.abs(v - ref) <= tol, `got ${(+v).toPrecision(6)}${unit}, expected ${(+ref).toPrecision(6)}${unit} (±${tol})`);
  const DEG = 180 / Math.PI, FT = 0.3048;
  const has = (rs, re, im, tol) => rs.some(z => Math.abs(z[0] - re) <= tol && Math.abs(Math.abs(z[1]) - Math.abs(im)) <= tol);

  // ---- polynomials and roots ----
  const p = Ct.polyFromRoots([[-0.05, 0.2], [-0.05, -0.2], [-3, 4], [-3, -4], [-60, 0]]);
  const r = Ct.roots(p);
  log('roots spread over three decades (0.2 to 60 rad/s)', has(r, -0.05, 0.2, 1e-9) && has(r, -3, 4, 1e-9) && has(r, -60, 0, 1e-8), JSON.stringify(r.map(z => z.map(v => +v.toFixed(10)))));
  log('exact zero roots', Ct.roots([1, 3, 2, 0, 0]).filter(z => z[0] === 0 && z[1] === 0).length === 2, '');

  // ---- state space → transfer function ----
  const comp = Ct.ssToTf([[0, 1], [-2, -3]], [0, 1], [1, 0]);
  log('companion form gives 1/(s² + 3s + 2)', comp.num.length === 1 && Math.abs(comp.num[0] - 1) < 1e-12 && comp.den.every((c, i) => Math.abs(c - [1, 3, 2][i]) < 1e-12), JSON.stringify(comp));
  // Nelson's Navion (as in the stability tests): G(jω) from the polynomials equals C (jωI − A)⁻¹ B solved directly
  const lon = St.longFromDim({ U: 176 * FT, Xu: -0.045, Xw: 0.036, Zu: -0.369, Zw: -2.02, Mu: 0, Mw: -0.05 / FT, Mwd: -0.0051 / FT, Mq: -2.05, Zde: -28.15 * FT, Mde: -11.88 });
  const C = [0, 0, 1, 0], G = Ct.ssToTf(lon.A, lon.B, C);
  let worst = 0;
  for (const w of [0.01, 0.2, 1, 3, 30]) {
    const n = 4, M = Array.from({ length: 2 * n }, () => new Array(2 * n).fill(0));
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const a = -lon.A[i][j]; M[i][j] = a; M[n + i][n + j] = a; }
    for (let i = 0; i < n; i++) { M[i][n + i] = -w; M[n + i][i] = w; }
    const x = solveSmall(M, [...lon.B, 0, 0, 0, 0]);
    const ref = [C.reduce((s, c, i) => s + c * x[i], 0), C.reduce((s, c, i) => s + c * x[n + i], 0)], got = Ct.freqResp(G, w);
    worst = Math.max(worst, Math.hypot(got[0] - ref[0], got[1] - ref[1]) / Math.hypot(...ref));
  }
  log('Navion q/δe: polynomial transfer function matches C(jωI − A)⁻¹B', worst < 1e-9, `worst relative error ${worst.toExponential(2)}`);
  const pe = Ct.poles(G), ee = St.eig(lon.A);
  log('transfer-function poles are the eigenvalues of A', ee.every(z => has(pe, z[0], z[1], 1e-8)), '');
  log('q/δe has a zero at the origin (q = sθ)', Ct.zeros(G).some(z => Math.hypot(...z) < 1e-8), JSON.stringify(Ct.zeros(G).map(z => z.map(v => +v.toFixed(5)))));

  // ---- second-order system (Ogata; Franklin, Powell & Emami-Naeini) ----
  const zeta = 0.5, wn = 2, so = Ct.secondOrder(zeta, wn);
  const Lso = Ct.tf([wn * wn], [1, 2 * zeta * wn, 0]), Tso = Ct.feedback(Lso);
  const st = Ct.step(Tso, 12, 0.0005), si = Ct.stepInfo(st, Ct.dcGain(Tso));
  near('ζ = 0.5 step overshoot e^(−πζ/√(1−ζ²)) = 16.3%', si.overshoot * 100, so.overshoot * 100, 0.02, '%');
  near('ζ = 0.5, ωn = 2 peak time π/ωd = 1.814 s', si.peakTime, so.peakTime, 0.002, ' s');
  const mso = Ct.margins(Lso);
  near('ζ = 0.5 phase margin 51.8° (closed form)', mso.pm.pmDeg, so.pm * DEG, 0.01, '°');
  near('ζ = 0.5 gain crossover ωn√(√(1+4ζ⁴) − 2ζ²)', mso.pm.w, so.wc, 1e-6, ' rad/s');
  log('second-order loop: infinite gain margin (phase never reaches −180°)', !mso.gmUp, '');

  // ---- gain margin: K/(s + 1)³ crosses −180° at ω = √3 where |L| = K/8 (Routh: stable for K < 8) ----
  const L3 = Ct.tf([2], [1, 3, 3, 1]), m3 = Ct.margins(L3);
  near('K/(s+1)³: phase crossover at √3 rad/s', m3.gmUp.w, Math.sqrt(3), 1e-6, ' rad/s');
  near('K = 2: gain margin 20·log10(4) = 12.04 dB', m3.gmUp.gmDb, 20 * Math.log10(4), 1e-6, ' dB');
  const cl8 = Ct.clPoles(L3, 4);   // K = 8
  log('K = 8: closed-loop poles on the imaginary axis at ±j√3', has(cl8, 0, Math.sqrt(3), 1e-6), JSON.stringify(cl8.map(z => z.map(v => +v.toFixed(6)))));

  // ---- delays ----
  const Tdel = 0.1, P2 = Ct.pade(Tdel, 2);
  const w1 = 1 / Tdel, fr = Ct.freqResp(P2, w1);
  near('second-order Padé is all-pass (|G| = 1)', Math.hypot(...fr), 1, 1e-12);
  near('Padé phase at ωT = 1: −2·atan((ωT/2)/(1 − (ωT)²/12))', Math.atan2(fr[1], fr[0]), -2 * Math.atan(0.5 / (1 - 1 / 12)), 1e-12, ' rad');
  log('Padé phase within 0.1° of the true delay at ωT = 1', Math.abs(Math.atan2(fr[1], fr[0]) + 1) * DEG < 0.1, `${(Math.abs(Math.atan2(fr[1], fr[0]) + 1) * DEG).toFixed(4)}°`);
  const mi = Ct.margins(Ct.tf([1], [1, 0]));
  near('1/s: phase margin 90° at 1 rad/s, delay margin π/2 s', mi.pm.delay, Math.PI / 2, 1e-6, ' s');

  // ---- root locus K/(s(s + 2)): s² + 2s + K ----
  const Lrl = Ct.tf([1], [1, 2, 0]);
  log('root locus: K = 1 gives a double root at −1', Ct.clPoles(Lrl, 1).every(z => Math.hypot(z[0] + 1, z[1]) < 1e-6), '');
  log('root locus: K = 5 gives −1 ± 2j', has(Ct.clPoles(Lrl, 5), -1, 2, 1e-9), '');
  const br = Ct.rootLocus(Lrl, 1e-3, 1e3, 120);
  log('root-locus branches start at the open-loop poles 0 and −2', br.length === 2 && br.some(b => Math.abs(b[0].re) < 1e-12) && br.some(b => Math.abs(b[0].re + 2) < 1e-12), '');
  // (s + 1)/(s(s + 2)(s + 5)): branches meet on the real axis and split; traced branches must stay continuous
  const bj = Ct.rootLocus(Ct.tf([1, 1], [1, 7, 10, 0]), 1e-3, 1e3, 120);
  let jump = 0; for (const b of bj) for (let i = 1; i < b.length; i++) jump = Math.max(jump, Math.hypot(b[i].re - b[i - 1].re, b[i].im - b[i - 1].im) / (0.05 + Math.hypot(b[i - 1].re, b[i - 1].im)));
  log('root-locus branches are continuous through the break-away point (every step under 3% of the root size)', jump < 0.03, `largest relative step ${jump.toFixed(4)}`);
  log('high-gain branches run along the asymptote Re(s) = −1', br.every(b => Math.abs(b[b.length - 1].re + 1) < 1e-6), '');

  // ---- compensators ----
  const c = Ct.pid({ kp: 2, ki: 0.5, kd: 0.3, tf: 0.02 });
  // Kd·jω/(jωτ + 1) = Kd ω (ωτ + j)/(1 + (ωτ)²)
  const w = 3, cr = Ct.freqResp(c, w), dd = 1 + (0.02 * w) ** 2, ref = [2 + 0.3 * w * 0.02 * w / dd, -0.5 / w + 0.3 * w / dd];
  log('PID Kp + Ki/s + Kd·s/(τs + 1) at 3 rad/s', Math.hypot(cr[0] - ref[0], cr[1] - ref[1]) < 1e-12, `got ${cr.map(v => v.toFixed(6))}, expected ${ref.map(v => v.toFixed(6))}`);
  near('washout blocks steady signals (DC gain 0)', Ct.dcGain(Ct.washout(1)), 0, 1e-15);
  const ll = Ct.leadLag(1, 1, 10), m = Math.sqrt(10), lph = Ct.bode(ll, m, m, 1)[0].ph;
  near('lead network: maximum phase asin((p−z)/(p+z)) at √(zp)', lph * DEG, Math.asin(9 / 11) * DEG, 1e-9, '°');

  // ---- aircraft loops ----
  const c172 = St.analyse({ id: 'c172', mass: 1043, z: geometric(5000 * FT), V: 120 * 0.514444, cg: 0.27 });
  const q = Ct.aircraftPlant(c172, 'q');
  log('light single: q per degree of up-elevator is positive at high frequency', q.G.num[0] > 0, `leading coefficient ${q.G.num[0].toFixed(4)}`);
  const sp0 = c172.L.sp.zeta, cl = Ct.clPoles(Ct.tfMul(Ct.gain(0.3), q.G));
  // the two fastest closed-loop roots are the short period (a real pair means more than critically damped)
  const top = cl.slice().sort((a, b) => Math.hypot(...b) - Math.hypot(...a)).slice(0, 2), spz = top[0][1] ? Ct.damping(top[0]).zeta : 1;
  log('pitch damper (0.3°/(°/s)) raises short-period damping', spz > sp0 + 0.1, `ζ ${sp0.toFixed(3)} → ${spz.toFixed(3)}`);
  const a320 = St.analyse({ id: 'a320', mass: 65000, z: geometric(35000 * FT), V: 0.78 * 296.5, cg: 0.3 });
  const rG = Ct.aircraftPlant(a320, 'r').G, yd = Ct.tfMul(Ct.gain(1.5), Ct.washout(2), rG);
  const dr0 = a320.Lt.dr.zeta, dr1 = Ct.clPoles(yd).filter(z => z[1] > 0.3).map(Ct.damping).sort((a, b) => a.zeta - b.zeta)[0];
  log('airliner yaw damper with washout: Dutch-roll damping above 0.3', dr1 && dr1.zeta > 0.3 && dr0 < 0.1, `ζ ${dr0.toFixed(3)} → ${dr1 ? dr1.zeta.toFixed(3) : '—'}`);
  const f16 = St.analyse({ id: 'f16', mass: 9295, z: geometric(15000 * FT), V: 0.6 * 322.2, cg: 0.35 });
  const fq = Ct.aircraftPlant(f16, 'q').G, up = Ct.poles(fq).find(z => z[1] === 0 && z[0] > 0);
  log('fighter at 35% MAC: q/δe has a right-half-plane pole (doubling 0.4–1.5 s)', up && Math.LN2 / up[0] > 0.4 && Math.LN2 / up[0] < 1.5, up ? `doubles in ${(Math.LN2 / up[0]).toFixed(2)} s` : '');
  const fcl = Ct.clPoles(Ct.tfMul(Ct.gain(0.5), fq)), slow = fcl.filter(z => z[0] > 0);
  log('fighter: pitch-rate feedback alone only slows the divergence (the q/δe zero at the origin traps a root)', slow.length === 1 && Math.LN2 / slow[0][0] > 10, slow.length ? `doubles in ${(Math.LN2 / slow[0][0]).toFixed(1)} s` : 'no divergent root');
  const fa = Ct.aircraftPlant(f16, 'alpha').G, acl = Ct.clPoles(Ct.tfMul(Ct.gain(0.5), fa));
  log('fighter: angle-of-attack feedback (0.5°/°) stabilises it completely', acl.every(z => z[0] < 0), JSON.stringify(acl.map(z => z.map(v => +v.toFixed(3)))));
  log('fighter: too little α gain and it diverges again (conditionally stable)', Ct.clPoles(Ct.tfMul(Ct.gain(0.02), fa)).some(z => z[0] > 0), '');
  const am = Ct.margins(Ct.tfMul(Ct.gain(0.5), fa));
  log('fighter α loop: margins report a gain-reduction margin', !!am.gmDown && am.gmDown.db > 0, am.gmDown ? `gain can fall ${am.gmDown.db.toFixed(1)} dB` : JSON.stringify(am.ph));
  if (am.gmDown) { const kmin = 0.5 / am.gmDown.mag, rm = Ct.clPoles(Ct.tfMul(Ct.gain(kmin), fa));
    log('…and at that lowest gain a closed-loop root sits at the origin (Routh)', rm.some(z => Math.hypot(...z) < 1e-6), `K_min ${kmin.toFixed(4)}°/°`); }
}
