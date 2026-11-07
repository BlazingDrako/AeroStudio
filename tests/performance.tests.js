// Aircraft performance checks: closed-form drag-polar results, the constant-altitude/constant-speed range
// integral, ceilings, turn and V–n identities, engine lapse at static sea level, and handbook comparisons.
import * as P from '../js/solvers/performance.js';
import * as A from '../js/solvers/atmosphere.js';

export function performanceTests(log) {
  const near = (name, v, ref, tol, unit = '') => log(name, Math.abs(v - ref) <= tol, `got ${(+v).toPrecision(6)}${unit}, expected ${(+ref).toPrecision(6)}${unit} (±${tol})`);
  const rel = (name, v, ref, tol) => log(name, Math.abs(v / ref - 1) <= tol, `got ${(+v).toPrecision(6)}, expected ${(+ref).toPrecision(6)} (±${(tol * 100).toFixed(1)}%)`);
  const KT = 0.514444, FT = 0.3048, g = A.G0, sl = A.atmosphere(0);

  // ---- drag polar closed forms (sailplane: subsonic, no engine) ----
  const gl = P.byId('glider'), Wg = 400 * g, pg = P.polar(gl, 0.05), sg = P.speeds(gl, sl, Wg, 'none');
  rel('(L/D)max = 1 / (2√(CD0·K))', sg.LDmax, 1 / (2 * Math.sqrt(pg.CD0 * pg.K)), 1e-6);
  rel('minimum-drag speed Vmd = √(2W/ρS)·(K/CD0)^¼', sg.Vmd, Math.sqrt(2 * Wg / (sl.rho * gl.S)) * (pg.K / pg.CD0) ** 0.25, 1e-5);
  const VmpTheory = sg.Vmd / 3 ** 0.25;
  log('minimum-power speed Vmp = Vmd/3^¼ (or the stall, if higher)', Math.abs(sg.Vmp - Math.max(VmpTheory, sg.Vs)) < 1e-3 * sg.Vmp, `Vmp ${sg.Vmp.toFixed(3)}, theory ${VmpTheory.toFixed(3)}, stall ${sg.Vs.toFixed(3)} m/s`);
  log('sailplane glide ratio 38–40 (15 m standard class)', sg.LDmax > 37.5 && sg.LDmax < 41, `L/D ${sg.LDmax.toFixed(1)}`);
  log('sailplane minimum sink ≈ 0.6 m/s', Math.abs(sg.sinkMin - 0.62) < 0.08, `${sg.sinkMin.toFixed(3)} m/s`);
  const gb = P.speeds(gl, sl, 525 * g, 'none');
  rel('water ballast: same L/D, speed × √(W ratio)', gb.Vmd / sg.Vmd, Math.sqrt(525 / 400), 1e-4);

  // ---- engines at static sea level ----
  rel('turbofan: full thrust at static sea level', P.thrust(P.byId('a320'), sl, 0, 'max').T, 240e3, 1e-9);
  const f16 = P.byId('f16');
  rel('afterburner: full thrust at static sea level', P.thrust(f16, sl, 0, 'ab').T, 131e3, 1e-9);
  rel('military thrust = 58% of afterburner', P.thrust(f16, sl, 0, 'mil').T, 0.58 * 131e3, 1e-9);
  rel('piston: rated power at sea level (Gagg–Ferrar)', P.thrust(P.byId('c172'), sl, 30, 'max').P, 134e3, 1e-9);
  log('thrust lapses with altitude', P.thrust(f16, A.atmosphere(11000), 200, 'mil').T < 0.4 * P.thrust(f16, sl, 200, 'mil').T, '');
  log('hot day reduces jet thrust at speed', P.thrust(P.byId('a320'), A.atmosphere(0, 30), 80, 'max').T < P.thrust(P.byId('a320'), sl, 80, 'max').T, '');

  // ---- climb and ceilings ----
  const c172 = P.byId('c172'), Wc = 1111 * g, sc = P.speeds(c172, sl, Wc, 'max'), cc = P.ceilings(c172, 0, Wc, 'max');
  near('service ceiling has RoC = 100 ft/min', P.roCmax(c172, cc.service, 0, Wc, 'max').RoC / FT * 60, 100, 0.5, ' ft/min');
  log('absolute ceiling above service ceiling', cc.abs > cc.service, `${(cc.service / FT).toFixed(0)} / ${(cc.abs / FT).toFixed(0)} ft`);
  rel('C172 (2,450 lb) sea-level climb ≈ 730 ft/min (POH)', sc.RoCmax / FT * 60, 730, 0.12);
  rel('C172 service ceiling ≈ 14,000 ft (POH)', cc.service / FT, 14000, 0.10);
  rel('C172 top speed ≈ 126 kt at sea level', sc.VmaxAero / KT, 126, 0.08);
  log('Vx < Vy (best angle slower than best rate)', sc.Vx < sc.Vy, `Vx ${(sc.Vx / KT).toFixed(0)} kt, Vy ${(sc.Vy / KT).toFixed(0)} kt`);
  const st = P.state(c172, sl, sc.VmaxAero, Wc, 'max');
  near('thrust = drag at top speed (Ps = 0)', st.Ps, 0, 1e-3, ' m/s');
  const tc = P.timeToClimb(c172, 0, Wc, 'max', 8000 * FT);
  log('time to climb to 8,000 ft is finite and ≈ 10–20 min', tc.t > 600 && tc.t < 1200, `${(tc.t / 60).toFixed(1)} min`);

  // ---- takeoff and landing ----
  const tk = P.takeoff(c172, { W: Wc, rating: 'max' });
  rel('C172 takeoff ground roll ≈ 945 ft (POH, sea level)', tk.ground / FT, 945, 0.2);
  rel('C172 takeoff over 50 ft ≈ 1,685 ft (POH, sea level)', tk.total / FT, 1685, 0.2);
  log('hot day lengthens the takeoff', P.takeoff(c172, { W: Wc, rating: 'max', dT: 25, elev: 1500 }).total > 1.3 * tk.total, '');
  log('headwind shortens the takeoff', P.takeoff(c172, { W: Wc, rating: 'max', wind: 10 * KT }).ground < 0.8 * tk.ground, '');
  const ld = P.landing(c172, { W: Wc });
  rel('C172 landing over 50 ft ≈ 1,335 ft (POH)', ld.total / FT, 1335, 0.2);

  // ---- range: exact constant-altitude, constant-speed integral ----
  const a320 = P.byId('a320'), zc = A.geometric(35000 * FT), atm = A.atmosphere(zc), M = 0.70, V = M * atm.a;
  const q = 0.5 * atm.rho * V * V, pa = P.polar(a320, M), a = q * a320.S * pa.CD0, b = pa.K / (q * a320.S);
  const c = P.fuelFlow(a320, atm, V, 1, 'max');               // kg/s per N = TSFC
  const m0 = 70000, burn = 12000, W0 = m0 * g, W1 = (m0 - burn) * g;
  const exact = V / (c * g) / Math.sqrt(a * b) * (Math.atan(W0 * Math.sqrt(b / a)) - Math.atan(W1 * Math.sqrt(b / a)));
  rel('cruise integration vs exact constant-speed range', P.cruise(a320, { z: zc, dT: 0, m0, burn, rating: 'max', rule: M }).range, exact, 2e-4);
  const pr = P.payloadRange(a320, { z: zc, dT: 0, rating: 'max', rule: 'lrc' });
  log('payload–range: range grows as payload is traded for fuel', pr.every((p, i) => i === 0 || p.R > pr[i - 1].R), pr.map(p => `${(p.R / 1852).toFixed(0)} nm @ ${(p.payload / 1000).toFixed(1)} t`).join(', '));
  const srM = P.cruiseSpeed(a320, atm, 65000 * g, 'max', 'mrc'), srL = P.cruiseSpeed(a320, atm, 65000 * g, 'max', 'lrc');
  rel('long-range cruise gives 99% of max specific range', P.specificRange(a320, atm, srL, 65000 * g, 'max'), 0.99 * P.specificRange(a320, atm, srM, 65000 * g, 'max'), 1e-4);
  log('long-range cruise is faster than max-range cruise', srL > srM, `${(srM / atm.a).toFixed(3)} → ${(srL / atm.a).toFixed(3)} M`);

  // ---- turning ----
  const Wf = 12000 * g, z15 = A.atmosphere(15000 * FT), ts = P.turnSummary(f16, z15, Wf, 'ab');
  rel('corner speed = √(2·nmax·W/(ρ·S·CLmax))', ts.corner, Math.sqrt(2 * 9 * Wf / (z15.rho * f16.S * f16.CLmax)), 1e-9);
  rel('instantaneous turn rate at the corner = g√(n²−1)/V', ts.rateInstMax, g * Math.sqrt(80) / ts.corner, 1e-6);
  const tA = P.turnAt(f16, z15, ts.Vsus, Wf, 'ab');
  near('sustained turn: Ps = 0 at the sustained load factor', P.nForPs(f16, z15, ts.Vsus, Wf, 'ab', 0), tA.nSus, 1e-6 * tA.nSus);
  log('fighter at 15,000 ft: sustained 12–18°/s, instantaneous 18–24°/s', ts.rateSusMax * 180 / Math.PI > 12 && ts.rateSusMax * 180 / Math.PI < 18 && ts.rateInstMax * 180 / Math.PI > 18 && ts.rateInstMax * 180 / Math.PI < 24, `${(ts.rateSusMax * 180 / Math.PI).toFixed(1)} / ${(ts.rateInstMax * 180 / Math.PI).toFixed(1)} °/s`);

  // ---- V–n ----
  const vn = P.vnDiagram(a320, { W: 65000 * g });
  rel('maneuvering speed VA = Vs·√nmax', vn.VA, vn.Vs1 * Math.sqrt(2.5), 1e-12);
  near('stall curve reaches nmax at VA', vn.nStall(vn.VA), 2.5, 1e-9);
  const mu = 2 * 65000 * g / a320.S / (A.SEA.rho * (a320.S / a320.b) * a320.CLa * g);
  rel('Pratt gust alleviation factor Kg = 0.88μ/(5.3+μ)', vn.Kg, 0.88 * mu / (5.3 + mu), 1e-12);

  // ---- supersonic and energy ----
  const sF = P.speeds(f16, sl, Wf, 'ab');
  log('fighter: supersonic at sea level with afterburner (≈ M 1.2)', sF.VmaxAero / sl.a > 1.1 && sF.VmaxAero / sl.a < 1.35, `M ${(sF.VmaxAero / sl.a).toFixed(3)}`);
  log('fighter: subsonic-limited without afterburner at sea level', P.speeds(f16, sl, Wf, 'mil').VmaxAero / sl.a < 1.1, '');
  const ec = P.energyClimb(f16, { W: Wf, dT: 0, rating: 'ab', z1: 36000 * FT, M1: 1.5 });
  log('energy climb: energy height rises and Ps stays positive', ec.path.every((p, i) => p.Ps > 0 && (i === 0 || p.He > ec.path[i - 1].He)), `${ec.path.length} points, ${ec.time.toFixed(0)} s to 36,000 ft at M 1.5`);
  log('energy climb time to 36,000 ft / M 1.5 is 40–150 s', ec.time > 40 && ec.time < 150, `${ec.time.toFixed(0)} s`);
  near('energy height He = h + V²/2g', P.energyHeight(1000, 100), 1000 + 10000 / (2 * g), 1e-9, ' m');
}
