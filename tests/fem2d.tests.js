// 2-D FEA checks: patch test, mesh validity, Kirsch/Heywood hole Kt, cantilever vs Timoshenko beam,
// pin-loaded lug equilibrium, plane strain.
import { solvePlate, meshRegion, makeSampler } from '../js/solvers/fem2d.js';
import { FEA_MODELS, ktHole } from '../js/modules/structures/feaModels.js';

const E = 70e9, nu = 0.3, t = 0.01;
const model = id => FEA_MODELS.find(m => m.id === id);
const defaults = m => Object.fromEntries(m.params.map(([k, , , v]) => [k, v]));

export function fem2dTests(log) {
  const near = (name, v, ref, rtol, unit = '') => log(name, Math.abs(v - ref) <= rtol * Math.abs(ref), `got ${(+v).toPrecision(6)}${unit}, expected ${(+ref).toPrecision(6)}${unit} (±${(rtol * 100).toFixed(1)}%)`);

  // 1. patch test: uniform tension, roller supports → uniform σx exactly
  const Lx = 0.2, W = 0.1, s0 = 50e6;
  const rect = { loops: [{ curves: [
    { id: 'b', kind: 'line', p0: [0, 0], p1: [Lx, 0] }, { id: 'r', kind: 'line', p0: [Lx, 0], p1: [Lx, W] },
    { id: 't', kind: 'line', p0: [Lx, W], p1: [0, W] }, { id: 'l', kind: 'line', p0: [0, W], p1: [0, 0] }] }] };
  let r = solvePlate({ geom: rect, E, nu, thickness: t, bcs: { l: { type: 'rollerX' }, b: { type: 'rollerY' }, r: { type: 'force', fx: s0 * W * t, fy: 0 } }, mesh: { hmax: 0.02 } });
  let dev = 0; for (let i = 0; i < r.mesh.nNodes; i++) dev = Math.max(dev, Math.abs(r.fields.sx[i] - s0), Math.abs(r.fields.sy[i]), Math.abs(r.fields.txy[i]));
  log('patch test: uniform tension reproduced exactly', dev < 1e-5 * s0, `max deviation ${(dev / s0).toExponential(2)} σ₀ over ${r.stats.elements} elements`);
  near('patch test: end displacement = σL/E', Math.max(...r.fields.ux), s0 * Lx / E, 1e-5);
  near('patch test: Poisson contraction = −νσW/E', Math.min(...r.fields.uy), -nu * s0 * W / E, 1e-6);

  // 2. mesh validity: positive elements, area of a plate with a hole
  const hm = model('hole'), hp = defaults(hm), b = hm.build(hp, t);
  const msh = meshRegion(b.geom, { hmax: hp.W / 8 });
  let neg = 0; for (let k = 0; k < msh.tri.length; k += 3) { const [a, c, d] = [msh.tri[k], msh.tri[k + 1], msh.tri[k + 2]], P = msh.xy; if ((P[2 * c] - P[2 * a]) * (P[2 * d + 1] - P[2 * a + 1]) - (P[2 * d] - P[2 * a]) * (P[2 * c + 1] - P[2 * a + 1]) <= 0) neg++; }
  log('mesher: every triangle valid and counter-clockwise', neg === 0, `${msh.tri.length / 3} triangles, min quality ${msh.quality.min.toFixed(3)}, mean ${msh.quality.avg.toFixed(3)}`);
  log('mesher: element quality acceptable (min > 0.3)', msh.quality.min > 0.3, `min ${msh.quality.min.toFixed(3)}`);
  r = solvePlate({ geom: b.geom, E, nu, thickness: t, bcs: b.bcs, mesh: { hmax: hp.W / 8 } });
  near('plate with hole: area (curved T6 edges)', r.area, hp.L * hp.W - Math.PI * hp.d ** 2 / 4, 2e-4);

  // 3. stress concentration at a hole vs Heywood (finite width)
  r = solvePlate({ geom: b.geom, E, nu, thickness: t, bcs: b.bcs, mesh: { hmax: hp.W / 10, circ: 64 } });
  const smp = makeSampler(r), top = smp(hp.L / 2, hp.W / 2 + hp.d / 2 + 1e-7);
  const kt = top.value(r.fields.sx) / b.ref.nominal;
  near('hole Kt (d/W = 0.25) vs Heywood 2 + (1 − d/W)³', kt, ktHole(hp.d, hp.W), 0.03);
  log('hole: reaction-free body is balanced (ΣFx = 0)', Math.abs(r.load.fx) < 1e-9 * hp.s * hp.W * t, `ΣFx = ${r.load.fx.toExponential(2)} N`);
  // net section force equals the applied load
  let Fnet = 0; const nS = 400;
  for (let k = 0; k < nS; k++) { const y = hp.W / 2 + hp.d / 2 + (hp.W / 2 - hp.d / 2) * (k + 0.5) / nS, s = smp(hp.L / 2, y); if (s) Fnet += s.value(r.fields.sx) * t * (hp.W / 2 - hp.d / 2) / nS; }
  near('hole: net-section stress integrates to half the load', Fnet, hp.s * hp.W * t / 2, 0.01);

  // 4. cantilever: tip deflection vs Timoshenko beam (bending + shear)
  const bm = model('beam'), bp = { L: 0.5, h: 0.05, P: 1000 }, bb = bm.build(bp, t);
  r = solvePlate({ geom: bb.geom, E, nu, thickness: t, bcs: bb.bcs, mesh: { hmax: bp.h / 4 } });
  const I = t * bp.h ** 3 / 12, G = E / (2 * (1 + nu)), dB = bp.P * bp.L ** 3 / (3 * E * I) + bp.P * bp.L / (5 / 6 * G * t * bp.h);
  const sB = makeSampler(r), tipv = sB(bp.L - 1e-7, bp.h / 2).value(r.fields.uy);
  near('cantilever (L/h = 10): tip deflection vs Timoshenko', -tipv, dB, 0.02);
  const mid = sB(bp.L / 2, bp.h - 1e-7).value(r.fields.sx);
  near('cantilever: mid-span top-fibre stress = Mc/I', mid, bp.P * bp.L / 2 * (bp.h / 2) / I, 0.02);

  // 5. lug: reactions balance the pin load
  const lm = model('lug'), lp = defaults(lm), lb = lm.build(lp, t);
  r = solvePlate({ geom: lb.geom, E, nu, thickness: t, bcs: lb.bcs, mesh: { hmax: lp.W / 6 } });
  near('lug: bearing load integrates to F', r.load.fy, lp.F, 1e-3);
  near('lug: base reaction balances the pin load', -r.reactions.base.fy, lp.F, 1e-4);

  // 6. plane strain: laterally restrained strip in tension, σz = νσx → σx·(1−ν²) stiffness
  r = solvePlate({ geom: rect, E, nu, thickness: t, plane: 'strain', bcs: { l: { type: 'rollerX' }, b: { type: 'rollerY' }, r: { type: 'force', fx: s0 * W * t, fy: 0 } }, mesh: { hmax: 0.025 } });
  near('plane strain: end displacement = σL(1−ν²)/E', Math.max(...r.fields.ux), s0 * Lx * (1 - nu * nu) / E, 1e-6);
}
