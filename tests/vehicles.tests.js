// Vehicle aero checks: the multi-body panel method against exact results, the Airfoil Lab's inviscid solver and
// the ground-image construction, then the vehicle models themselves.
import { solvePanels, resample } from '../js/solvers/panel2d.js';
import { nacaPoints } from '../js/modules/cfd/shapes.js';
import { Mfoil } from '../js/solvers/mfoil/mfoil.js';
import { VEHICLES, defaults, solverBodies, isaDensity } from '../js/modules/airfoil/vehicles.js';
import { evaluate, effectiveWidth } from '../js/modules/airfoil/vehicleTab.js';

const circle = (cx, cy, r, n = 160) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos(2 * Math.PI * i / n), cy + r * Math.sin(2 * Math.PI * i / n)]);
// NACA section, chord c, leading edge at (x, y), angle of attack a (deg, nose up), optionally upside down
export function wingPts(code, c, x, y, a = 0, inverted = false, n = 60) {
  const r = -a * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
  return nacaPoints(code, n).map(([px, py]) => { const X = px * c * cs - py * c * sn, Y = px * c * sn + py * c * cs; return [x + X, inverted ? y - Y : y + Y]; });
}

export function vehiclesTests(log) {
  const near = (name, v, ref, tol, extra = '') => log(name, Math.abs(v - ref) <= tol, `got ${(+v).toFixed(5)}, expected ${(+ref).toFixed(5)} (±${tol})${extra}`);

  // circle: Cp = 1 − 4 sin²θ, so 1 at the front and −3 at the top; no net force (d'Alembert)
  {
    const S = solvePanels([{ pts: circle(0, 0, 1), lifting: false }]);
    near('panel method, circle: stagnation Cp = 1', Math.max(...S.Cp), 1, 0.01);
    near('panel method, circle: Cp at the top = −3', Math.min(...S.Cp), -3, 0.02);
    const F = S.forces[0];
    log('panel method, circle: no net force in inviscid flow (d\'Alembert)', Math.hypot(F.fx, F.fy) < 1e-3, `|F| = ${Math.hypot(F.fx, F.fy).toExponential(1)}`);
  }
  // NACA 0012 at 5°: lift vs the Airfoil Lab's inviscid (linear-vorticity) solver, and Kutta–Joukowski
  {
    const a = 5 * Math.PI / 180, S = solvePanels([{ pts: nacaPoints('0012', 100), lifting: true }], { alpha: a });
    const F = S.forces[0], cl = F.fy * Math.cos(a) - F.fx * Math.sin(a);
    const M = new Mfoil({ naca: '0012' }); M.param.verb = 0; M.setoper({ alpha: 5 }); M.solve();
    near('panel method, NACA 0012 at 5°: lift matches the Airfoil Lab (inviscid)', cl, M.post.cl, 0.01 * M.post.cl);
    let circ = 0; for (let i = 0; i < S.N; i++) circ += S.Vt[i] * S.panels[i].len;
    near('panel method, NACA 0012: pressure lift = Kutta–Joukowski lift (C_L = −2Γ/c)', cl, -2 * circ, 0.01 * cl);
  }
  // ground images: a body above the ground must see exactly the flow of itself plus its mirror image in free air
  {
    const up = wingPts('4412', 1, 0, 0.5, 6), mirror = up.map(([x, y]) => [x, -y]);
    const g = solvePanels([{ pts: up, lifting: true }], { ground: true }), pair = solvePanels([{ pts: up, lifting: true }, { pts: mirror, lifting: true }]);
    near('ground effect: ground plane = mirror-image wing in free air (lift)', g.forces[0].fy, pair.forces[0].fy, 1e-6 * Math.abs(pair.forces[0].fy) + 1e-9);
    const v = g.velocity(0.5, 0);
    log('ground effect: no flow through the ground', Math.abs(v[1]) < 1e-9, `vertical velocity at the ground ${v[1].toExponential(1)}`);
  }
  // inverted wing in ground effect: downforce grows as it gets closer to the ground, and fades to the free-air value
  {
    const free = -solvePanels([{ pts: wingPts('4412', 1, 0, 0, 4, true), lifting: true }]).forces[0].fy;
    const at = h => -solvePanels([{ pts: wingPts('4412', 1, 0, h + 0.1, 4, true), lifting: true }], { ground: true }).forces[0].fy;
    const hs = [0.1, 0.2, 0.5, 1, 2], d = hs.map(at), far = at(20);
    const mono = d.every((v, i) => i === 0 || v < d[i - 1]);
    log('ground effect: an upside-down wing makes more downforce the closer it gets to the ground', mono && d[0] > 1.3 * free, `C_L,down at h/c = ${hs.join(', ')}: ${d.map(v => v.toFixed(3)).join(', ')} (free air ${free.toFixed(3)})`);
    near('ground effect: far from the ground the wing behaves as in free air (h/c = 20)', far, free, 0.01 * free);
  }
  // ---- the vehicles
  const run = (id, over = {}) => {
    const v = VEHICLES.find(x => x.id === id), p = { ...defaults(v), ...over }, b = v.build(p), sb = solverBodies(b);
    const S = solvePanels(sb.bodies, { ground: b.ground });
    return { v, p, b, sb, S, R: evaluate(v, p, b, S, sb.owner) };
  };
  {
    const bad = [];
    for (const v of VEHICLES) {
      const { b, sb, S } = run(v.id);
      if (b.ground && sb.bodies.some(x => x.pts.some(q => q[1] <= 0))) bad.push(`${v.id}: below the ground`);
      sb.bodies.forEach((x, i) => sb.bodies.forEach((y, j) => { if (i !== j) { const Sy = solvePanels([y]); if (x.pts.some(q => Sy.inside(q[0], q[1]))) bad.push(`${v.id}: parts overlap`); } }));
      if (!S.forces.every(f => isFinite(f.fy))) bad.push(`${v.id}: no solution`);
    }
    log('vehicles: every profile is valid (no overlapping parts, nothing below the road, solves)', !bad.length, bad.length ? [...new Set(bad)].join('; ') : `${VEHICLES.length} vehicles`);
  }
  {
    const f1 = run('f1'), gt = run('gt');
    const wf = effectiveWidth(f1.v), wg = effectiveWidth(gt.v);
    log('calibration: each race car\'s effective width is a plausible fraction of its ≈ 2 m real width', wf > 0.3 && wf < 1.2 && wg > 0.2 && wg < 1.2, `F1 ${wf.toFixed(3)} m, GT ${wg.toFixed(3)} m (3-D losses: air round the sides and wing tips)`);
    const share = r => r.R.parts.map(x => x.N / r.R.lift);
    const sf = share(f1);
    log('F1 car: downforce split is realistic (front wing 20–35%, floor 25–50%, rear wing 25–45%)', sf[0] > 0.2 && sf[0] < 0.35 && sf[1] > 0.25 && sf[1] < 0.5 && sf[2] > 0.25 && sf[2] < 0.45, `front ${(100 * sf[0]).toFixed(0)}%, floor ${(100 * sf[1]).toFixed(0)}%, rear ${(100 * sf[2]).toFixed(0)}%`);
    const wings = f1.R.parts.filter(x => x.role === 'wing');
    log('F1 car: front wing, rear wing and floor all push the car down', f1.R.parts.every(x => x.N < 0) && wings.length === 2, f1.R.parts.map(x => `${x.name} ${Math.round(x.N / 9.81)} kg`).join(', '));
    near('F1 car at 250 km/h: downforce ≈ 1,350 kg (matches the published C_L·A ≈ 4.5 m² by calibration)', -f1.R.lift / 9.81, 0.5 * 1.225 * (250 / 3.6) ** 2 * 4.5 / 9.81, 140, ' kg');
    const lo = run('f1', { ride: 25 }), hi = run('f1', { ride: 80 });
    log('F1 car: lowering the car adds floor downforce (ground effect)', lo.R.parts[1].N < f1.R.parts[1].N && f1.R.parts[1].N < hi.R.parts[1].N, `floor at 25 / 40 / 80 mm: ${[lo, f1, hi].map(r => Math.round(-r.R.parts[1].N / 9.81)).join(' / ')} kg`);
    const morefront = run('f1', { front: 8 }), morerear = run('f1', { rear: 12 });
    log('F1 car: more front wing moves the balance forward, more rear wing moves it back', morefront.R.frontShare > f1.R.frontShare && morerear.R.frontShare < f1.R.frontShare, `front share ${(100 * f1.R.frontShare).toFixed(1)}% → ${(100 * morefront.R.frontShare).toFixed(1)}% (front 8°), ${(100 * morerear.R.frontShare).toFixed(1)}% (rear 12°)`);
    const fast = run('f1', { speed: 300 });
    near('downforce grows with speed²', fast.R.lift / f1.R.lift, (300 / 250) ** 2, 1e-9);
  }
  {
    near('standard atmosphere: density at 11 km geometric = 0.3648 kg/m³ (US 1976)', isaDensity(11000), 0.3648, 0.0005);
    for (const id of ['airliner', 'fighter']) {
      const r = run(id), tail = r.R.parts.find(x => x.role === 'tail'), wing = r.R.parts.find(x => x.role === 'wing');
      const W = r.v.mass * 9.81;
      log(`${id}: lift = weight, the tailplane pushes down by a few percent and the wing carries the rest`, Math.abs(wing.N + tail.N - W) < 1e-6 * W && tail.N < 0 && -tail.N < 0.1 * W, `wing ${(wing.N / 1000).toFixed(0)} kN, tail ${(tail.N / 1000).toFixed(1)} kN, weight ${(W / 1000).toFixed(0)} kN`);
    }
    const a = run('airliner');
    log('airliner in cruise: lift coefficient ≈ 0.5, L/D ≈ 16, comfortably above the stall', a.R.CL > 0.4 && a.R.CL < 0.65 && a.R.LD > 14 && a.R.stallMargin > 2, `C_L = ${a.R.CL.toFixed(3)}, L/D = ${a.R.LD.toFixed(1)}, stall margin ${a.R.stallMargin.toFixed(2)}×`);
    const f9 = run('fighter', { n: 9, speed: 600, alt: 3000 });
    log('fighter: 9 g at 600 km/h would stall the wing', f9.R.stallMargin < 1, `C_L needed ${f9.R.CL.toFixed(2)} vs max ${f9.v.CLmax}`);
    const ratios = [0, 3, 6, 9].map(a => run('airliner', { runway: true, alpha: a }).S.forces[0].fy / run('airliner', { alpha: a }).S.forces[0].fy);
    log('airliner near the runway: the 2-D wing lift changes by under 15% at normal angles (more at small angles, less at large ones)', ratios.every(r => Math.abs(r - 1) < 0.15) && ratios[0] > 1 && ratios[3] < ratios[0], `lift ratio near/away from the ground at 0, 3, 6, 9°: ${ratios.map(r => r.toFixed(3)).join(', ')}`);
  }
  {
    const m0 = run('aim9'), m1 = run('aim9', { canard: 12 }), share = r => r.R.parts[0].N / r.R.lift;
    log('missile: turning the canards up gives them a bigger share of the lift', m0.R.ok && share(m1) > share(m0) && share(m0) > 0, `canard share ${(100 * share(m0)).toFixed(1)}% → ${(100 * share(m1)).toFixed(1)}% (canards 5° → 12°)`);
    const low = run('aim9', { n: 10, alt: 0, speed: 950 }), high = run('aim9', { n: 30, alt: 12000, speed: 950 });
    log('missile: 10 g low down is easy; 30 g at 12 km below Mach 1 needs more lift than it can make', low.R.stallMargin > 1.5 && high.R.stallMargin < 1, `lift margin ${low.R.stallMargin.toFixed(2)}× low, ${high.R.stallMargin.toFixed(2)}× high`);
  }

  // resampling keeps corners and the outline length, and follows the requested spacing
  {
    const sq = [[0, 0], [1, 0], [1, 1], [0, 1]], R = resample(sq, () => 0.05);
    const per = R.reduce((s, p, i) => s + Math.hypot(R[(i + 1) % R.length][0] - p[0], R[(i + 1) % R.length][1] - p[1]), 0);
    const corners = sq.every(c => R.some(p => Math.hypot(p[0] - c[0], p[1] - c[1]) < 1e-9));
    log('resampling: corners kept, outline length kept, ≈ requested spacing', corners && Math.abs(per - 4) < 1e-9 && Math.abs(R.length - 80) <= 4, `${R.length} points, perimeter ${per.toFixed(6)}`);
  }
}
