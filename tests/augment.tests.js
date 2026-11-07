// Augmentation checks: the time simulator against the linear closed-loop transfer function, the rate limiter
// against its describing-function result, actuator limits and transport delay honoured, integral command tracking,
// the washed-out yaw damper, turbulence attenuation, and the relaxed-stability fighter's fly-by-wire law
// (stable, Level 1, margins at least 6 dB and 40°).
import * as Au from '../js/solvers/augment.js';
import * as Ct from '../js/solvers/control.js';
import * as St from '../js/solvers/stability.js';
import { geometric, atmosphere } from '../js/solvers/atmosphere.js';

export function augmentTests(log) {
  const D = Math.PI / 180, FT = 0.3048;
  const near = (name, v, ref, tol, unit = '') => log(name, Math.abs(v - ref) <= tol, `got ${(+v).toPrecision(6)}${unit}, expected ${(+ref).toPrecision(6)}${unit} (±${tol})`);
  const cond = (id, mass, zft, M, cg) => { const z = geometric(zft * FT); return St.analyse({ id, mass, z, V: M * atmosphere(z).a, cg }); };
  const a320 = cond('a320', 65000, 35000, 0.78, 0.30), f16 = cond('f16', 9295, 15000, 0.8, 0.35);
  const ideal = { wa: 20, rate: Infinity, pos: Infinity, delay: 0, fs: 0 };

  // ---- simulator = linear theory when nothing saturates ----
  const linCheck = (name, an, law, axis, y, amp, T) => {
    const { P, F, L, act } = Au.loopTf(an, law, axis, { wa: 20 });
    const fwd = Ct.tfMul(F, act, Au.plantTf(P, y)), Tcl = { num: Ct.polyMul(fwd.num, L.den), den: Ct.polyMul(fwd.den, Ct.polyAdd(L.den, L.num)) };
    const lin = Ct.response(Tcl, t => (t >= 0.5 ? amp : 0), T, 0.002);
    const sim = Au.simulate(an, law, axis, ideal, { T, dt: 0.002, input: { type: 'step', amp, t0: 0.5 } });
    let err = 0, peak = 0;
    const at = t => { const h = lin.t[1] - lin.t[0], k = Math.min(lin.t.length - 2, Math.floor(t / h)), f = (t - lin.t[k]) / h; return lin.y[k] * (1 - f) + lin.y[k + 1] * f; };
    sim.t.forEach((t, i) => { const v = at(t); err = Math.max(err, Math.abs(sim.y[i][y] - v)); peak = Math.max(peak, Math.abs(v)); });
    log(name, err < 0.01 * peak, `max difference ${(err / peak * 100).toFixed(3)}% of the peak`);
  };
  linCheck('simulator matches the linear closed loop: airliner pitch damper', a320, { kq: 0.5, mode: 'direct', kstick: 1 }, 'lon', 'q', 1 * D, 6);
  const fbw = { ka: 0.35, kq: 0.15, mode: 'cstar', kp: 0.5 * D, ki: 1 * D };
  linCheck('simulator matches the linear closed loop: fighter C* law', f16, fbw, 'lon', 'cstar', 1, 6);

  // ---- the fighter's fly-by-wire law ----
  const { L } = Au.loopTf(f16, fbw, 'lon', { wa: 20, delay: 0.02 });
  const cl = Au.closedLoopRoots(L), m = Ct.margins(L);
  log('fighter at 35% MAC unaugmented: pitch divergence', f16.L.roots.some(z => z[0] > 0.3), '');
  log('fighter C* fly-by-wire: every closed-loop root stable', cl.every(z => z[0] < 0), JSON.stringify(cl.map(z => z.map(v => +v.toFixed(3)))));
  const sp = cl.filter(z => z[1] > 0.5 && Math.hypot(...z) < 15).map(Ct.damping).sort((a, b) => b.wn - a.wn)[0];
  const cap = sp.wn ** 2 / Au.nAlpha(f16);
  log('fighter C* fly-by-wire: Level 1 short period (MIL-F-8785C Category A)', Au.spLevel(sp.zeta, cap, 'A') === 1, `ζ ${sp.zeta.toFixed(2)}, CAP ${cap.toFixed(2)}`);
  log('fighter C* fly-by-wire: margins ≥ 40° and ≥ 6 dB both ways (20 ms delay, 20 rad/s actuator)', m.pm.pmDeg >= 40 && m.gmUp.gmDb >= 6 && m.gmDown.db >= 6, `PM ${m.pm.pmDeg.toFixed(1)}°, GM +${m.gmUp.gmDb.toFixed(1)} / −${m.gmDown.db.toFixed(1)} dB`);
  const step = Au.simulate(f16, fbw, 'lon', { wa: 20, rate: 60 * D, pos: 25 * D, delay: 0.02, fs: 64 }, { T: 12, input: { type: 'step', amp: 1, t0: 0.5 } });
  near('C* command with integral action: steady C* equals the command', step.y[step.y.length - 1].cstar, 1, 0.02, ' g');
  const ol = Au.simulate(f16, fbw, 'lon', ideal, { T: 12, x0: [0, 0.5, 0, 0], augmented: false, olGain: 0 });   // 0.1° of α, no control
  log('unaugmented fighter departs (small-disturbance limit reached)', !!ol.departed || Math.abs(ol.y[ol.y.length - 1].alpha) > 0.2, ol.departed ? `${ol.departed.what} at ${ol.departed.t.toFixed(1)} s` : '');

  // ---- actuator limits and delay ----
  const lim = { wa: 40, rate: 20 * D, pos: 10 * D, delay: 0.1, fs: 50 };
  const hard = Au.simulate(f16, fbw, 'lon', lim, { T: 4, input: { type: 'doublet', amp: 3, t0: 0.5, width: 0.6 } });
  const maxRate = Math.max(...hard.drate.map(Math.abs)), maxPos = Math.max(...hard.d.map(Math.abs));
  log('surface rate never exceeds the 20°/s limit', maxRate <= 20 * D * (1 + 1e-9), `${(maxRate / D).toFixed(3)}°/s`);
  log('surface deflection never exceeds the 10° limit', maxPos <= 10 * D * (1 + 1e-9), `${(maxPos / D).toFixed(3)}°`);
  const first = hard.t[hard.dc.findIndex(v => Math.abs(v - hard.trimUp) > 1e-9)];
  log('transport delay: the surface command moves 0.1 s after the input (within one 20 ms frame)', first >= 0.6 - 1e-9 && first <= 0.62 + 1e-9, `first command at ${first.toFixed(3)} s`);

  // ---- rate limiter describing function: deep saturation turns a sine into a triangle ----
  // amplitude πR/(2ω) and a lag of π/2 − asin(πR/(2Aω)) behind the input (A = 1, ω = 2, R = 0.5: Aω/R = 4)
  const w = 2, R = 0.5, dt = 1e-4, nn = Math.round(6 * 2 * Math.PI / w / dt), u = new Float64Array(nn);
  for (let i = 0; i < nn; i++) u[i] = Math.sin(w * i * dt);
  const y = Au.rateLimiter(u, dt, R), per = Math.round(2 * Math.PI / w / dt), s0 = nn - per;
  let ymax = -1, iy = 0, umax = -1, iu = 0; for (let i = s0; i < nn; i++) { if (y[i] > ymax) { ymax = y[i]; iy = i; } if (u[i] > umax) { umax = u[i]; iu = i; } }
  near('rate-limited sine: amplitude πR/(2ω)', ymax, Math.PI * R / (2 * w), 1e-3);
  let lag = ((iy - iu) * dt * w) % (2 * Math.PI); if (lag < 0) lag += 2 * Math.PI;
  near('rate-limited sine: phase lag π/2 − asin(πR/(2Aω)) = 66.9°', lag / D, (Math.PI / 2 - Math.asin(Math.PI * R / (2 * w))) / D, 0.1, '°');

  // ---- yaw damper with washout ----
  const yd = Au.loopTf(a320, { kr: 1, tw: 2 }, 'lat', { wa: 20, delay: 0.02 });
  const dr = Au.closedLoopRoots(yd.L).filter(z => z[1] > 0.3).map(Ct.damping).sort((a, b) => a.zeta - b.zeta)[0];
  log('airliner yaw damper: Dutch roll Level 1 in cruise (ζ ≥ 0.08, ζωn ≥ 0.15)', Au.drLevel(dr.zeta, dr.wn, 'B') === 1 && a320.Lt.dr.zeta < 0.08, `ζ ${a320.Lt.dr.zeta.toFixed(3)} → ${dr.zeta.toFixed(3)}, ωn ${dr.wn.toFixed(2)}`);
  // steady yaw rate per unit rudder command, exactly (s → 0): G(0) / (1 + L(0)); washout makes L(0) = 0
  const steadyR = tw => { const { P, L } = Au.loopTf(a320, { kr: 1, tw }, 'lat', { wa: 20 }); const G0 = Ct.dcGain(Au.plantTf(P, 'r')); return G0 / (1 + Ct.dcGain(L)); };
  const r0 = Ct.dcGain(Au.plantTf(Au.plantOf(a320, 'lat'), 'r')), rw = steadyR(2), rn = steadyR(0);
  log('washout lets a steady yaw rate through unchanged; a plain damper cuts it', Math.abs(rw / r0 - 1) < 1e-9 && Math.abs(rn / r0) < 0.6, `steady r per unit rudder: none ${r0.toFixed(3)}, washout ${rw.toFixed(3)}, plain ${rn.toFixed(3)}`);

  const drk = kb => Au.closedLoopRoots(Au.loopTf(a320, { kr: 1, tw: 2, kb }, 'lat', { wa: 20 }).L).filter(z => z[1] > 0.3).map(Ct.damping).sort((a, b) => b.wn - a.wn)[0].wn;
  log('sideslip feedback stiffens the Dutch roll (higher frequency)', drk(1) > drk(0) * 1.1, `ωn ${drk(0).toFixed(3)} → ${drk(1).toFixed(3)} rad/s with Kβ = 1`);

  // ---- turbulence ----
  const gust = { W20: 30 * 0.514444, h: 35000 * FT, seed: 11 }, rms = a => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
  const rough = aug => rms(Au.simulate(a320, { kq: 1, mode: 'direct', kstick: 1 }, 'lon', ideal, { T: 60, dt: 0.005, gust, augmented: aug, olGain: 0 }).y.map(v => v.q));
  const qa = rough(true), qo = rough(false);
  log('pitch damper cuts the pitch-rate RMS in moderate turbulence', qa < 0.8 * qo, `RMS q ${(qo / D).toFixed(3)} → ${(qa / D).toFixed(3)} °/s`);

  // ---- pilot-induced oscillation: the same pilot and law, only the actuator rate limit differs ----
  const pioLaw = { ka: 0.5, kq: 0.15, mode: 'rate', kp: 0.1, ki: 0.5, kff: 0.3 }, pilot = { gain: 2, tau: 0.25, amp: 5 * D, t0: 0.5 };
  const pio = rate => Au.simulate(f16, pioLaw, 'lon', { wa: 20, rate: rate * D, pos: 25 * D, delay: 0.02, fs: 64 }, { T: 15, pilot });
  const fast = pio(80), slow = pio(10), late = s => { const th = s.x.filter((_, i) => s.t[i] > 10).map(x => x[3]); return th.length ? (Math.max(...th) - Math.min(...th)) / 2 / D : Infinity; };
  log('pilot tracking a 5° pitch step: settles with an 80°/s actuator', !fast.departed && late(fast) < 0.1 && Math.abs(fast.x[fast.x.length - 1][3] / D - 5) < 0.1, `late swing ±${late(fast).toFixed(3)}°`);
  log('…and diverges into a pilot-induced oscillation when the actuator is rate limited to 10°/s', !!slow.departed || late(slow) > 5, slow.departed ? `${slow.departed.what} beyond the model at ${slow.departed.t.toFixed(1)} s, rate-limited ${Math.round(slow.satRate.filter(Boolean).length / slow.satRate.length * 100)}% of the time` : `late swing ±${late(slow).toFixed(2)}°`);

  // ---- levels ----
  log('MIL-F-8785C short-period levels (Cat A): ζ 0.7, CAP 1 → 1; ζ 0.3 → 2; ζ 0.1 → 4', Au.spLevel(0.7, 1) === 1 && Au.spLevel(0.3, 1) === 2 && Au.spLevel(0.1, 1) === 4, '');
}
