// Gas dynamics checks against textbook table values (Anderson, Modern Compressible Flow; NACA 1135).
import * as G from '../js/solvers/gasdyn.js';

export function gasdynTests(log) {
  const g = 1.4, D = G.DEG;
  const near = (name, v, ref, tol, unit = '') => log(name, Math.abs(v - ref) <= tol, `got ${(+v).toPrecision(6)}${unit}, expected ${ref}${unit} (±${tol})`);

  near('isentropic A/A* at M=2', G.isen.A_As(2, g), 1.6875, 1e-4);
  near('isentropic p/p0 at M=2', 1 / G.isen.p0_p(2, g), 0.12780, 1e-5);
  near('inverse A/A*=2 supersonic → M', G.M_from_A(2, g, true), 2.1972, 1e-3);
  near('inverse A/A*=2 subsonic → M', G.M_from_A(2, g, false), 0.30590, 1e-4);
  near('Prandtl–Meyer ν(2)', G.isen.nu(2, g) / D, 26.380, 2e-3, '°');
  near('inverse ν=26.38° → M', G.M_from_nu(26.38 * D, g), 2.0, 1e-3);

  const ns = G.normalShock(2, g);
  near('normal shock M=2: M2', ns.M2, 0.57735, 1e-5);
  near('normal shock M=2: p2/p1', ns.p2_p1, 4.5, 1e-9);
  near('normal shock M=2: ρ2/ρ1', ns.rho2_rho1, 2.6667, 1e-4);
  near('normal shock M=2: T2/T1', ns.T2_T1, 1.6875, 1e-4);
  near('normal shock M=2: p02/p01', ns.p02_p01, 0.72087, 1e-4);
  near('normal shock M=2: p02/p1 (Rayleigh pitot)', ns.p02_p1, 5.6404, 1e-3);
  for (const k of ['M2', 'p2_p1', 'rho2_rho1', 'T2_T1', 'p02_p01', 'p1_p02']) near(`normal shock inverse from ${k}`, G.normalShockFrom(k, ns[k], g), 2, 1e-6);

  const bw = G.betaFromTheta(3, 20 * D, g, 'weak'), os = G.obliqueShock(3, bw, g);
  near('oblique M=3, θ=20°: weak β', bw / D, 37.764, 0.01, '°');
  near('oblique M=3, θ=20°: M2', os.M2, 1.9941, 2e-3);
  near('oblique M=3, θ=20°: p2/p1', os.p2_p1, 3.7713, 2e-3);
  near('oblique M=3, θ=20°: strong β', G.betaFromTheta(3, 20 * D, g, 'strong') / D, 82.15, 0.05, '°');
  near('θmax at M=3', G.thetaMax(3, g) / D, 34.07, 0.02, '°');
  near('M from (θ,β) closed form', G.machFromThetaBeta(20 * D, bw, g), 3, 1e-6);
  log('oblique shock detaches past θmax', isNaN(G.betaFromTheta(2, 25 * D, g)), 'M=2, θ=25° → NaN (θmax≈23°)');

  const ex = G.expansion(1.5, 20 * D, g);
  near('Prandtl–Meyer: M=1.5 turned 20° → M2', ex.M2, 2.207, 3e-3);

  near('Fanno 4fL*/D at M=2', G.fanno.fL(2, g), 0.30500, 2e-4);
  near('Fanno p/p* at M=0.5', G.fanno.p(0.5, g), 2.1381, 2e-4);
  near('Rayleigh T0/T0* at M=2', G.rayleigh.T0(2, g), 0.79339, 2e-4);
  near('Rayleigh p0/p0* at M=0.5', G.rayleigh.p0(0.5, g), 1.1140, 2e-4);

  const sod = G.riemann({ rho: 1, u: 0, p: 1, g }, { rho: 0.125, u: 0, p: 0.1, g });
  near('Sod shock tube p*', sod.p, 0.30313, 1e-4);
  near('Sod shock tube u*', sod.u, 0.92745, 1e-4);
  near('Sod shock speed', sod.right.S, 1.7522, 1e-3);

  const geo = G.nozzleGeometry({ type: 'conical', eps: 2 });
  const f1 = G.nozzleFlow(geo, g, 0.5);
  near('C-D nozzle ε=2: 1st critical p/p0', f1.crit.p1, 0.9372, 1e-3);
  near('C-D nozzle ε=2: 3rd critical (design) p/p0', f1.crit.p3, 0.09396, 1e-4);
  near('C-D nozzle ε=2: 2nd critical (shock at exit) p/p0', f1.crit.p2, 0.5136, 1e-3);
  log('C-D nozzle ε=2, pb/p0=0.7 → shock inside', G.nozzleFlow(geo, g, 0.7).regime === 'shock', `regime ${G.nozzleFlow(geo, g, 0.7).regime}, shock M1=${G.nozzleFlow(geo, g, 0.7).shock?.M1.toFixed(3)}`);
  { // shock location check: exit pressure after shock must equal pb
    const f = G.nozzleFlow(geo, g, 0.7), pe = f.prof.p[f.prof.p.length - 1];
    near('shock-in-nozzle exit pressure = back pressure', pe, 0.7, 2e-3);
  }

  const moc = G.minLengthNozzle(2.4, g, 40);
  near('MOC minimum-length nozzle: area ratio vs isentropic (M=2.4)', moc.AeAt / moc.AeAtExact, 1, 0.01);

  const jet = G.jetPlume(2, 1, g);
  log('jet at design pressure has no waves', jet.ok && Math.abs(jet.totalTurn) < 1e-9, `turn=${jet.totalTurn}`);
  const ju = G.jetPlume(2, 2, g);
  log('underexpanded jet: boundary turns outward and builds cells', ju.ok && ju.totalTurn > 0 && ju.polys.length > 50, `turn ${(ju.totalTurn / D).toFixed(2)}°, ${ju.polys.length} regions, cell ≈ ${ju.cellLen.toFixed(2)} h`);
}
