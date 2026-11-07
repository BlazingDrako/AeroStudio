// Formula Library checks: the general solver against textbook values (several with two roots),
// unit conversions, and a consistency sweep over every formula in the library.
import { solveFormula, toSI, fromSI } from '../js/solvers/formulas.js';
import { FORMULAS, byId } from '../js/modules/formulas/library.js';

export function formulasTests(log) {
  const near = (name, v, ref, tol) => log(name, Math.abs(v - ref) <= tol, `got ${(+v).toPrecision(6)}, expected ${ref} (±${tol})`);
  const solve = (id, target, vals = {}) => {
    const f = byId[id], x = {};
    for (const v of f.vars) x[v.id] = v.val;
    Object.assign(x, vals);
    return solveFormula(f, x, target);
  };
  const D = Math.PI / 180;

  // single-root checks (Anderson, Modern Compressible Flow; ISA tables; Bate–Mueller–White)
  near('isentropic T0/T at M=2', solve('isoT', 'TR', { M: 2, g: 1.4 }).value, 1.8, 1e-9);
  near('isentropic p0/p at M=2', solve('isoP', 'PR', { M: 2 }).value, 7.8244, 1e-3);
  near('inverse: M from p0/p = 7.8244', solve('isoP', 'M', { PR: 7.8244, M: 1 }).value, 2.0, 1e-4);
  near('normal shock M2 at M1=2', solve('nsM2', 'M2', { M1: 2 }).value, 0.57735, 1e-5);
  near('normal shock p02/p01 at M1=2', solve('nsP0', 'P0R', { M1: 2 }).value, 0.72087, 1e-4);
  near('inverse: M1 from p02/p01 = 0.72087', solve('nsP0', 'M1', { P0R: 0.72087, M1: 1.5 }).value, 2.0, 1e-3);
  near('Rayleigh pitot p02/p1 at M=2', solve('pitotSup', 'PR', { M1: 2 }).value, 5.6404, 1e-3);
  near('Prandtl–Meyer: M for ν = 26.38°', solve('pm', 'M', { nu: 26.38 * D }).value, 2.0, 1e-3);
  near('ISA pressure at 11 km', solve('isaP', 'p', { h: 11000 }).value, 22632, 5);
  near('ISA altitude for p = 26 436 Pa', solve('isaP', 'h', { p: 26436, h: 5000 }).value, 10000, 5);
  near('sea-level speed of sound', solve('sound', 'a', { T: 288.15 }).value, 340.29, 0.02);
  near('circular speed at r = 6 771 km', solve('vcirc', 'v', { r: 6771e3 }).value, 7672.6, 0.5);
  near('GEO radius from a sidereal day', solve('period', 'a', { T: 86164.1 }).value / 1e3, 42164, 1);
  near('Hohmann LEO(300 km) → GEO total Δv', solve('hohmann', 'dv', { r1: 6678e3, r2: 42164e3 }).value, 3893, 2);
  near('Euler buckling, pinned 1 m, I = 1 cm⁴, E = 200 GPa', solve('euler', 'P', { E: 200e9, I: 1e-8, K: 1, L: 1 }).value, 19739, 1);
  near('Kepler: E for M = 60°, e = 0.7', solve('kepler', 'E', { M: 60 * D, e: 0.7 }).value, 1.7375, 1e-3);
  near('Tsiolkovsky: mass ratio for 9.4 km/s at 350 s', solve('rocketEq', 'm0', { dv: 9400, Isp: 350, mf: 1 }).value, Math.exp(9400 / (350 * 9.80665)), 1e-3);

  // multiple roots
  const am = solve('areaMach', 'M', { AR: 2 }).roots.map(r => +r.toFixed(4)).sort((a, b) => a - b);
  log('area–Mach A/A* = 2 has two roots', am.length === 2 && Math.abs(am[0] - 0.3059) < 2e-4 && Math.abs(am[1] - 2.1972) < 2e-4, `roots ${am.join(', ')} (expected 0.3059, 2.1972)`);
  const ob = solve('tbm', 'b', { M1: 3, th: 20 * D }).roots.map(r => r / D).sort((a, b) => a - b);
  log('θ–β–M, M=3, θ=20°: weak and strong β', ob.length === 2 && Math.abs(ob[0] - 37.76) < 0.02 && Math.abs(ob[1] - 82.15) < 0.05, `β = ${ob.map(q => q.toFixed(2)).join('°, ')}° (expected 37.76°, 82.15°)`);
  const det = solve('tbm', 'b', { M1: 2, th: 30 * D });
  log('θ–β–M, M=2, θ=30° is detached (no solution)', !isFinite(det.value) && det.roots.length === 0, `roots ${det.roots.length}`);
  const fan = solve('fanno', 'M', { fL: 0.3 }).roots.map(r => +r.toFixed(3)).sort((a, b) => a - b);
  log('Fanno 4fL*/D = 0.3 has subsonic and supersonic roots', fan.length === 2 && fan[0] < 1 && fan[1] > 1, `roots ${fan.join(', ')}`);
  const mag = solve('magnify', 'r', { A: 4, z: 0.05 }).roots;
  log('amplification 4 at ζ = 0.05: below and above resonance', mag.length === 2 && mag[0] < 1 && mag[1] > 1, `r = ${mag.map(q => q.toFixed(4)).join(', ')}`);
  const pr = solve('Preq', 'V', {}).roots;
  log('power required: two speeds for one power', pr.length === 2, `V = ${pr.map(q => q.toFixed(2)).join(', ')} m/s`);

  // units
  near('°F → K', toSI('temp', '°F', 59), 288.15, 1e-9);
  near('K → °C', fromSI('temp', '°C', 300), 26.85, 1e-9);
  near('kt → m/s', toSI('speed', 'kt', 100), 51.4444, 1e-4);
  near('ksi → Pa', toSI('stress', 'ksi', 1), 6.894757e6, 1);
  near('lb/(lbf·h) TSFC round trip', fromSI('tsfc', 'lb/(lbf·h)', toSI('tsfc', 'lb/(lbf·h)', 0.55)), 0.55, 1e-12);

  // every formula: defaults are consistent and each variable can be recovered from the others
  let worst = '', fails = 0;
  for (const f of FORMULAS) {
    const x = {};
    for (const v of f.vars) x[v.id] = v.val;
    const t = f.target || f.vars[0].id;
    const r = solveFormula(f, x, t);
    if (!isFinite(r.value)) { fails++; worst += `${f.id}: no solution at defaults; `; continue; }
    x[t] = r.value;
    for (const v of f.vars) {
      if (v.id === t) continue;
      const s = solveFormula(f, { ...x }, v.id);
      const ok = s.roots.some(z => Math.abs(z - v.val) <= 1e-4 * Math.max(Math.abs(v.val), 1e-9) || Math.abs(z - v.val) < 1e-9 * (v.max - v.min));
      if (!ok) { fails++; worst += `${f.id}.${v.id}; `; }
    }
  }
  log(`library: all ${FORMULAS.length} formulas solve and back-solve every variable`, fails === 0, fails ? worst : 'ok');
  log('library: formula ids are unique', new Set(FORMULAS.map(f => f.id)).size === FORMULAS.length, '');
}
