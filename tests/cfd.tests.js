// Fluid Flow Sandbox checks: the CPU lattice-Boltzmann reference against exact solutions, the GPU solver
// against the CPU reference, vortex shedding behind a cylinder, the lid-driven cavity benchmark, and shapes.
import { LBM, nuFromTau, tauForRe, circleMask } from '../js/solvers/lbm.js';
import { LBMGL } from '../js/modules/cfd/lbmGL.js';
import { SCENES, U_LAT } from '../js/modules/cfd/scenes.js';
import { Geometry, rasterize, nacaPoints, contains } from '../js/modules/cfd/shapes.js';
import { crossingFreq, spectrum } from '../js/modules/cfd/measure.js';
import { encodeSetup, decodeSetup } from '../js/modules/cfd/share.js';

function sceneGeometry(id, nx, ny) {
  const sc = SCENES.find(s => s.id === id).build(nx, ny), g = new Geometry(nx, ny);
  for (const o of sc.objects) g.add({ ...o });
  g.setForced(sc.forced); g.compose(true);
  return { sc, g };
}

export function cfdTests(log) {
  const near = (name, v, ref, tol, extra = '') => log(name, Math.abs(v - ref) <= tol, `got ${v.toFixed(5)}, expected ${ref.toFixed(5)} (±${tol})${extra}`);

  // ---- shapes and geometry
  {
    const r = 30, n = rasterize({ type: 'circle', x: 100, y: 100, size: 2 * r }, 200, 200).length;
    log('circle covers π r² cells', Math.abs(n / (Math.PI * r * r) - 1) < 0.01, `${n} cells vs ${(Math.PI * r * r).toFixed(1)}`);
    const P = nacaPoints('0012', 80); let A = 0;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) A += (P[j][0] + P[i][0]) * (P[j][1] - P[i][1]);
    A = Math.abs(A) / 2;
    near('NACA 0012 section area = 0.0817 c² (exact integral, closed trailing edge)', A, 0.0817, 0.0003);
    const foil = { type: 'airfoil', x: 100, y: 50, size: 150, naca: '0012', angle: 0 };
    const m = rasterize(foil, 300, 100).length;
    log('rasterized airfoil area matches the section', Math.abs(m / (0.0817 * 150 * 150) - 1) < 0.03, `${m} cells vs ${(0.0817 * 150 * 150).toFixed(0)}`);
    const tilted = { ...foil, angle: 10 }, le = [100 - 0.25 * 150 * Math.cos(-10 * Math.PI / 180) + 2, 50 - 0.25 * 150 * Math.sin(-10 * Math.PI / 180)];
    log('positive angle of attack raises the leading edge', le[1] > 50 && contains(tilted, le[0], le[1]), `leading edge at y = ${le[1].toFixed(1)} (quarter chord at 50)`);
    const g = new Geometry(40, 20);
    g.setForced([{ x0: 0, x1: 40, y0: 8, y1: 12, u: [0.1, 0] }]);
    const o = g.add({ type: 'square', x: 20, y: 10, size: 6 }); g.compose(true);
    g.update(o, { x: 22 }, [0.05, 0]); g.compose();
    const kIn = 10 * 40 + 22, kJet = 10 * 40 + 5;
    log('geometry: obstacles beat jets; dragged walls carry their velocity', g.cells[kIn] === 1 && Math.abs(g.vel[2 * kIn] - 0.05) < 1e-7 && g.cells[kJet] === 2 && Math.abs(g.vel[2 * kJet] - 0.1) < 1e-7,
      `cell under the square: type ${g.cells[kIn]}, u ${g.vel[2 * kIn]}; jet cell: type ${g.cells[kJet]}, u ${g.vel[2 * kJet].toFixed(3)}`);
  }

  // ---- shareable links
  {
    const nx = 300, ny = 100, paint = new Uint8Array(nx * ny);
    for (let j = 40; j < 60; j++) for (let i = 200; i < 210; i++) paint[j * nx + i] = 1;
    const objects = [{ type: 'circle', x: 60, y: 50, size: 11, angle: 0, ref: true }, { type: 'airfoil', x: 120, y: 48.5, size: 33, angle: 7.5, naca: '4415' }];
    const str = encodeSetup({ nx, ny, objects, paint, probes: [[150, 50]], line: { x0: 100, y0: 2, x1: 100, y1: 98 }, sources: [[20, 30]], turb: false });
    const same = decodeSetup(str, nx, ny), big = decodeSetup(str, 600, 200);
    const okSame = same && same.objects.length === 2 && same.objects[1].naca === '4415' && Math.abs(same.objects[1].angle - 7.5) < 1e-9 && same.objects[0].ref
      && same.paint.every((v, k) => v === paint[k]) && Math.abs(same.probes[0][0] - 150) < 0.01 && same.line && !same.turb && same.sources.length === 1;
    let cells = 0; for (const v of big.paint) cells += v;
    log('shareable link: setup survives the round trip (and scales to a finer grid)', okSame && Math.abs(big.objects[0].x - 120) < 0.02 && cells === 800,
      `${str.length} characters; painted cells at 2× grid: ${cells} (expected 800)`);
    log('shareable link: a damaged link is ignored', decodeSetup('not-a-setup', nx, ny) === null, 'decodeSetup returned null');
  }

  // ---- signal tools
  {
    const t = [], v = []; let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
    for (let i = 0; i < 3000; i++) { const x = i * 0.0137 + 0.004 * Math.sin(i); t.push(x); v.push(0.3 + 0.8 * Math.sin(2 * Math.PI * 0.183 * x) + 0.05 * rnd()); }
    const cf = crossingFreq(t, v), S = spectrum(t, v, 1024);
    log('frequency from zero crossings (noisy, unevenly sampled sine)', cf && Math.abs(cf.f / 0.183 - 1) < 0.005, `f = ${cf ? cf.f.toFixed(5) : '—'} vs 0.18300`);
    log('spectrum peak at the right frequency (within ¼ bin) and amplitude (±5%)', S && Math.abs(S.peak.f - 0.183) < 0.25 / (t[t.length - 1] - t[0]) && Math.abs(S.peak.a / 0.8 - 1) < 0.05, S ? `peak at f = ${S.peak.f.toFixed(4)}, amplitude ${S.peak.a.toFixed(3)} (expected 0.183, 0.8)` : 'no spectrum');
  }

  // ---- CPU reference vs exact results
  {
    const ny = 32, tau = 0.8, F = 1e-6, nu = nuFromTau(tau);
    const L = new LBM({ nx: 3, ny, U: 0, tau, bc: { x: 'periodic', y: 'wall' }, force: [F, 0], init: () => [1, 0, 0] });
    L.step(30000);
    let e = 0, umax = 0;
    for (let j = 0; j < ny; j++) { const y = j + 0.5, ex = F / (2 * nu) * y * (ny - y); umax = Math.max(umax, ex); e = Math.max(e, Math.abs(L.ux[j * 3 + 1] - ex)); }
    log('Poiseuille channel: velocity profile matches the parabola', e / umax < 0.01, `max error ${(100 * e / umax).toFixed(3)}% of u_max`);
  }
  {
    const nx = 40, ny = 30;
    const L = new LBM({ nx, ny, U: 0.05, tau: 0.53, cs: 0.15, bc: { x: 'periodic', y: 'periodic' }, solid: circleMask(nx, ny, 20, 15, 5),
      init: (i, j) => [1 + 0.01 * Math.sin(i / 3), 0.05 * Math.sin(j / 4), 0.03 * Math.cos(i / 5)] });
    const m0 = L.mass(); L.step(400);
    const d = Math.abs(L.mass() - m0) / m0;
    log('mass is conserved (periodic box, obstacle, turbulence model)', d < 1e-12, `relative drift ${d.toExponential(2)} after 400 steps`);
    const C = new LBM({ nx: 30, ny: 30, U: 0.1, inflow: 0, tau: 0.6, bc: { x: 'wall', y: 'wall' }, lid: [0, 0.1], init: () => [1, 0, 0] });
    const c0 = C.mass(); C.step(400);
    const dc = Math.abs(C.mass() - c0) / c0;
    log('mass is conserved in a closed cavity with a sliding lid', dc < 1e-12, `relative drift ${dc.toExponential(2)} after 400 steps`);
  }

  // ---- GPU solver
  let gpu = null;
  try { gpu = new LBMGL(); } catch (e) { log('GPU solver checks skipped: ' + e.message, true, 'WebGL2 with float render targets is needed'); return; }
  try {
    const compare = (name, o, steps) => {
      const C = new LBM(o); gpu.setup(o); C.step(steps); gpu.step(steps);
      const G = gpu.readMacro(); let e = 0;
      for (let k = 0; k < o.nx * o.ny; k++) e = Math.max(e, Math.abs(G.ux[k] - C.ux[k]), Math.abs(G.uy[k] - C.uy[k]));
      log(name, e < 1e-4, `max velocity difference ${e.toExponential(2)} after ${steps} steps (U = 0.1)`);
    };
    // velocities are multiples of 1/32 so the GPU's half-float cell texture stores them exactly
    const nx = 96, ny = 40;
    compare('GPU matches CPU: inflow/outflow, no-slip walls, cylinder, turbulence model', { nx, ny, U: 0.1, tau: 0.53, cs: 0.15, bc: { x: 'flow', y: 'wall' }, solid: circleMask(nx, ny, 24, 19.3, 5), init: (i, j) => (i > 30 && j > 20 ? [1, 0.1, 0.02] : null) }, 300);
    compare('GPU matches CPU: slip walls, periodic ends, body force', { nx, ny, U: 0.1, tau: 0.53, cs: 0.15, bc: { x: 'periodic', y: 'slip' }, force: [2e-6, 0], solid: circleMask(nx, ny, 24, 19.3, 5) }, 200);
    compare('GPU matches CPU: absorbing layers at the slip walls and outlet', { nx, ny, U: 0.1, tau: 0.53, cs: 0.15, bc: { x: 'flow', y: 'slip' }, solid: circleMask(nx, ny, 24, 19.3, 5), sponge: { sigma: 0.05, y: 6, x: 10 }, init: (i, j) => [1 + 0.02 * Math.sin(j / 3), 0.1, 0] }, 300);
    {
      const cells = circleMask(nx, ny, 40, 20, 6), vel = new Float32Array(2 * nx * ny);
      for (let k = 0; k < nx * ny; k++) if (cells[k]) { vel[2 * k] = 0.0625; vel[2 * k + 1] = -0.03125; }
      for (let j = 15; j < 25; j++) for (let i = 70; i < 73; i++) { const k = j * nx + i; cells[k] = 2; vel[2 * k] = -0.09375; }
      compare('GPU matches CPU: moving obstacle, jet cells, sliding lid, open inlet', { nx, ny, U: 0.1, inflow: 0.0625, tau: 0.56, cs: 0.15, bc: { x: 'flow', y: 'wall' }, lid: [0, 0.09375], cells, vel, init: () => [1, 0, 0] }, 300);
      compare('GPU matches CPU: side walls, periodic top and bottom', { nx, ny, U: 0.1, inflow: 0, tau: 0.6, bc: { x: 'wall', y: 'periodic' }, cells, vel, init: (i, j) => [1, 0.05 * Math.sin(j / 6), 0] }, 300);
    }

    // forces: GPU momentum exchange vs the CPU reference, cell by cell (moving obstacle)
    {
      const cells = circleMask(nx, ny, 40, 20, 6), vel = new Float32Array(2 * nx * ny);
      for (let k = 0; k < nx * ny; k++) if (cells[k]) { vel[2 * k] = 0.03125; vel[2 * k + 1] = -0.0625; }
      const o = { nx, ny, U: 0.1, tau: 0.56, cs: 0.15, bc: { x: 'flow', y: 'slip' }, cells, vel };
      const C = new LBM(o); gpu.setup(o); C.step(250); gpu.step(250);
      const Fc = C.cellForces(); gpu.forcePass(); const Fg = gpu.readForces();
      let e = 0, m = 0; for (let k = 0; k < nx * ny; k++) { e = Math.max(e, Math.abs(Fg.Fx[k] - Fc.Fx[k]), Math.abs(Fg.Fy[k] - Fc.Fy[k])); m = Math.max(m, Math.abs(Fc.Fx[k]), Math.abs(Fc.Fy[k])); }
      log('GPU wall forces match the CPU reference cell by cell (moving obstacle)', e < 1e-3 * m, `max difference ${e.toExponential(2)} (largest cell force ${m.toExponential(2)})`);
    }
    // momentum balance: a cylinder holding back body-force-driven flow in a periodic, slip-walled box.
    // At steady state the drag must equal the total force on the fluid, F × (number of fluid cells).
    {
      const bx = 120, by = 60, cells = circleMask(bx, by, 60, 30, 8), F = 2e-6;
      let nf = 0; for (const c of cells) if (!c) nf++;
      gpu.setup({ nx: bx, ny: by, U: 0.05, tau: 0.8, bc: { x: 'periodic', y: 'slip' }, force: [F, 0], cells, init: () => [1, 0, 0] });
      gpu.step(60000);
      const pts = []; for (let k = 0; k < cells.length; k++) if (cells[k]) pts.push(k);
      const [fx, fy] = gpu.bodyForces([{ cells: pts }])[0];
      log('momentum balance: drag on the cylinder = driving force on the fluid', Math.abs(fx / (F * nf) - 1) < 0.005 && Math.abs(fy) < 1e-3 * fx, `drag ${fx.toExponential(4)} vs F·N = ${(F * nf).toExponential(4)} (${(100 * (fx / (F * nf) - 1)).toFixed(3)}%), side force ${fy.toExponential(1)}`);
    }

    // lid-driven cavity at Re = 100 vs Ghia, Ghia & Shin (1982), u along the vertical centreline
    {
      const N = 96;
      gpu.setup({ nx: N, ny: N, U: U_LAT, inflow: 0, tau: tauForRe(100, U_LAT, N), bc: { x: 'wall', y: 'wall' }, lid: [0, U_LAT], init: () => [1, 0, 0], L: N });
      gpu.step(80000);
      const M = gpu.readMacro(N / 2 - 1, 0, 2, N);
      const u = y => { const f = y * N - 0.5, j = Math.max(0, Math.min(N - 2, Math.floor(f))), t = f - j; const a = (M.ux[2 * j] + M.ux[2 * j + 1]) / 2, b = (M.ux[2 * j + 2] + M.ux[2 * j + 3]) / 2; return (a + t * (b - a)) / U_LAT; };
      let umin = Infinity; for (let j = 0; j < N; j++) umin = Math.min(umin, (M.ux[2 * j] + M.ux[2 * j + 1]) / 2 / U_LAT);
      near('lid-driven cavity, Re = 100: strongest return flow u/U (Ghia: −0.2109)', umin, -0.2109, 0.008);
      near('lid-driven cavity, Re = 100: u/U at y = 0.8516 (Ghia: 0.2315)', u(0.8516), 0.2315, 0.012);
      near('lid-driven cavity, Re = 100: u/U at y = 0.1719 (Ghia: −0.1015)', u(0.1719), -0.1015, 0.008);
    }

    // cylinder at the medium grid used by the app
    const run = Re => {
      const { sc, g } = sceneGeometry('cylinder', 540, 180);
      gpu.setup({ nx: 540, ny: 180, U: U_LAT, tau: tauForRe(Re, U_LAT, sc.L), cs: 0.15, bc: sc.bc, cells: g.cells, vel: g.vel, init: sc.init, L: sc.L, sponge: sc.sponge });
      const conv = sc.L / U_LAT, t = [], v = [], cd = [], cl = [], q = 0.5 * U_LAT * U_LAT * sc.L, body = [{ cells: g.objects[0].cells }];
      const total = Math.round(110 * conv), start = Math.round(50 * conv), every = 20;
      for (let s = 0; s < total; s += every) {
        gpu.step(every);
        if (s >= start) { t.push(s); v.push(gpu.probe(sc.probe[0], sc.probe[1]).uy / U_LAT); const [fx, fy] = gpu.bodyForces(body)[0]; cd.push(fx / q); cl.push(fy / q); }
      }
      return { t, v, cd, cl, D: sc.L };
    };
    const r = run(100);
    const mean = r.v.reduce((a, b) => a + b, 0) / r.v.length;
    const cross = []; for (let i = 1; i < r.v.length; i++) if ((r.v[i - 1] - mean) * (r.v[i] - mean) < 0) cross.push(r.t[i - 1] + (r.t[i] - r.t[i - 1]) * (mean - r.v[i - 1]) / (r.v[i] - r.v[i - 1]));
    const amp = (Math.max(...r.v) - Math.min(...r.v)) / 2;
    const St = cross.length > 3 ? (cross.length - 1) / 2 / (cross[cross.length - 1] - cross[0]) * r.D / U_LAT : NaN;
    log('cylinder, Re = 100: the wake sheds vortices', amp > 0.1, `cross-flow velocity amplitude ${amp.toFixed(3)} U at 3 D behind`);
    log('cylinder, Re = 100: Strouhal number ≈ 0.17 (0.164 unconfined; 11% blockage raises it)', St > 0.155 && St < 0.2, `St = ${St.toFixed(4)} from ${cross.length} zero crossings`);
    const mcd = r.cd.reduce((a, b) => a + b, 0) / r.cd.length, lf = crossingFreq(r.t, r.cl);
    const Stl = lf ? lf.f * r.D / U_LAT : NaN;
    log('cylinder, Re = 100: Strouhal number from the lift matches the wake probe', Math.abs(Stl / St - 1) < 0.01, `St from lift ${Stl.toFixed(4)}, from the probe ${St.toFixed(4)}`);
    log('cylinder, Re = 100: mean drag C_D in the expected range (1.46 open flow by White\'s fit; walls raise it)', mcd > 1.3 && mcd < 1.8, `C_D = ${mcd.toFixed(3)}, lift amplitude ±${lf ? lf.amp.toFixed(3) : '—'}`);
    const r30 = run(30);
    const tail = r30.v.slice(-Math.round(r30.v.length / 3));
    const sw = Math.max(...tail) - Math.min(...tail);
    log('cylinder, Re = 30: wake stays steady (below the onset of shedding at Re ≈ 47)', sw < 0.02, `cross-flow velocity swing ${sw.toFixed(4)} U`);
    const cd30 = r30.cd.slice(-50).reduce((a, b) => a + b, 0) / 50, cl30 = Math.max(...r30.cl.slice(-50).map(Math.abs));
    log('cylinder, Re = 30: steady drag C_D ≈ 1.8 (2.04 by White\'s fit, 1.7–1.8 measured in open flow; walls raise it), no lift', cd30 > 1.6 && cd30 < 2.5 && cl30 < 0.01, `C_D = ${cd30.toFixed(3)}, |C_L| ≤ ${cl30.toExponential(1)}`);

    // airfoil: no trapped sound waves (density at the slip wall stays near 1 once the start-up has passed)
    {
      const { sc, g } = sceneGeometry('airfoil', 540, 180), c = sc.L;
      gpu.setup({ nx: 540, ny: 180, U: U_LAT, tau: tauForRe(1000, U_LAT, c), cs: 0.15, bc: sc.bc, cells: g.cells, vel: g.vel, L: c, sponge: sc.sponge });
      gpu.step(Math.round(25 * c / U_LAT));
      let lo = Infinity, hi = -Infinity;
      for (let k = 0; k < 120; k++) { gpu.step(20); const r = gpu.probe(270, 178).rho; lo = Math.min(lo, r); hi = Math.max(hi, r); }
      log('airfoil, Re = 1000: absorbing layers keep sound waves from building up between the walls', (hi - lo) / 2 < 0.01, `density swing at the wall ±${((hi - lo) / 2).toFixed(4)} (±0.07 without the layers)`);
    }

    // every scene builds and runs without blowing up
    const bad = [];
    for (const s of SCENES) {
      const ny = 90, nx = Math.round(ny * s.aspect), { sc, g } = sceneGeometry(s.id, nx, ny);
      const L = sc.objects.find(o => o.ref)?.size ?? sc.L, tau = tauForRe(s.Re, U_LAT, L);
      gpu.setup({ nx, ny, U: U_LAT, inflow: sc.inflow ?? U_LAT, tau, cs: 0.15, bc: sc.bc, lid: sc.lid || [0, 0], force: sc.force ? sc.force(nuFromTau(tau)) : [0, 0], cells: g.cells, vel: g.vel, init: sc.init, L, dyeInit: sc.dyeInit, sponge: sc.sponge });
      gpu.step(3000);
      const M = gpu.readMacro(); let ok = true, umax = 0;
      for (let k = 0; k < nx * ny; k++) { if (!(Math.abs(M.rho[k] - 1) < 0.3)) ok = false; umax = Math.max(umax, Math.hypot(M.ux[k], M.uy[k])); }
      if (!ok || !(umax < 0.4) || !(umax > 0.01)) bad.push(`${s.id} (max |u| ${umax.toFixed(3)})`);
    }
    log('every scene runs stably for 3000 steps', !bad.length, bad.length ? 'problems: ' + bad.join(', ') : `${SCENES.length} scenes checked`);
  } finally { gpu.dispose(); }
}
