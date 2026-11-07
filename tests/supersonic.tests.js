// Supersonic airfoil (shock-expansion) checks: hand calculations, the independent diamond scene in
// Shocks & Nozzles, thin-airfoil limits, shock detachment and the trailing-edge slip line.
import * as G from '../js/solvers/gasdyn.js';
import { solveSupersonic, sharpAirfoil } from '../js/solvers/supersonic.js';
import { buildScene } from '../js/modules/compressible/scenes.js';
import { Mfoil } from '../js/solvers/mfoil/mfoil.js';

export function supersonicTests(log) {
  const g = 1.4, D = G.DEG;
  const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);
  const solve = (shape, opts, oper) => { const A = sharpAirfoil(shape, opts); return solveSupersonic({ ...A, g, ...oper }); };

  // 1. flat plate by hand: shock below, Prandtl–Meyer fan above
  {
    const M = 3, a = 5 * D, q = 0.5 * g * M * M;
    const pl = G.obliqueShock(M, G.betaFromTheta(M, a, g), g).p2_p1, pu = G.expansion(M, a, g).p2_p1;
    const clH = (pl - pu) / q * Math.cos(a), cdH = (pl - pu) / q * Math.sin(a);
    const R = solve('plate', {}, { M, alpha: 5 });
    log('flat plate M=3, α=5°: cl matches hand calculation', R.ok && rel(R.cl, clH) < 1e-6, `cl=${R.cl?.toFixed(6)} hand=${clH.toFixed(6)}`);
    log('flat plate M=3, α=5°: wave cd matches hand calculation', R.ok && rel(R.cdw, cdH) < 1e-6, `cd=${R.cdw?.toFixed(6)} hand=${cdH.toFixed(6)}`);
    // pressure acts normal to the plate, at mid-chord: cm¼ = −N/4 with N = √(cl² + cd²)
    const N = Math.hypot(R.cl, R.cdw);
    log('flat plate: centre of pressure at mid-chord (cm¼ = −N/4)', R.ok && Math.abs(R.cm + N / 4) < 1e-6 * N, `cm=${R.cm?.toFixed(6)} −N/4=${(-N / 4).toFixed(6)}`);
  }

  // 2. diamond vs the independent implementation in the Shocks & Expansions tab
  for (const [M, al, t] of [[2.2, 5, 0.08], [3, 2, 0.05], [1.8, -3, 0.06]]) {
    const R = solve('diamond', { t, xm: 0.5 }, { M, alpha: al });
    const sc = buildScene('diamond', { M, g, alpha: al, thick: t, angle: 0 });
    const num = k => parseFloat(sc.metrics.find(m => m.k.startsWith(k)).v);
    const clS = num('cl'), cdS = num('cd');
    log(`diamond M=${M}, α=${al}°, t/c=${t}: agrees with Shocks & Expansions scene`, R.ok && Math.abs(R.cl - clS) < 2e-4 && Math.abs(R.cdw - cdS) < 2e-5,
      `cl ${R.cl?.toFixed(5)} vs ${clS} · cd ${R.cdw?.toFixed(6)} vs ${cdS}`);
  }

  // 3. thin-airfoil limit → Ackeret linear theory
  {
    const M = 2, a = 0.5, R = solve('biconvex', { t: 0.01, n: 120 }, { M, alpha: a }), bet = Math.sqrt(M * M - 1);
    const clA = 4 * a * D / bet;
    log('thin biconvex (1%), α=0.5°: cl → 4α/√(M²−1)', R.ok && rel(R.cl, clA) < 0.01, `cl=${R.cl?.toFixed(6)} linear=${clA.toFixed(6)} (${(100 * rel(R.cl, clA)).toFixed(2)}%)`);
    log('thin biconvex: wave cd → linear theory', R.ok && rel(R.cdw, R.cdwLin) < 0.03, `cd=${R.cdw?.toFixed(7)} linear=${R.cdwLin?.toFixed(7)}`);
    const cdT = 4 * (a * D) ** 2 / bet + (16 / 3) * 0.01 ** 2 / bet; // biconvex parabolic arc: K = 16/3
    log('thin biconvex: linear wave cd = (4α² + 16/3 t²)/β', rel(R.cdwLin, cdT) < 0.01, `integrated ${R.cdwLin?.toFixed(7)} closed form ${cdT.toFixed(7)}`);
  }

  // 4. symmetry
  for (const s of ['diamond', 'hexagon', 'biconvex']) {
    const R = solve(s, { t: 0.06 }, { M: 2, alpha: 0 });
    log(`${s} at α=0: zero lift and moment`, R.ok && Math.abs(R.cl) < 1e-10 && Math.abs(R.cm) < 1e-10 && R.cdw > 0, `cl=${R.cl?.toExponential(2)} cm=${R.cm?.toExponential(2)} cd=${R.cdw?.toFixed(5)}`);
  }

  // 5. attached / detached thresholds at the nose
  {
    const M = 1.5, tm = G.thetaMax(M, g) / D; // ≈ 12.1°
    const t = h => 2 * 0.5 * Math.tan(h * D); // diamond t/c for a nose half-angle h (xm = 0.5)
    const ok = solve('diamond', { t: t(tm - 0.5) }, { M, alpha: 0 }), no = solve('diamond', { t: t(tm + 0.5) }, { M, alpha: 0 });
    log(`diamond at M=1.5: shock attached just below θmax=${tm.toFixed(2)}°, detached just above`, ok.ok && !no.ok && no.fail === 'detached', `below: ${ok.ok ? 'ok' : ok.fail} · above: ${no.ok ? 'ok' : no.fail}`);
    const N = new Mfoil({ naca: '0012' }), X = N.geom.xpoint;
    const R = solveSupersonic({ x: Array.from(X.x), z: Array.from(X.z), M: 2, alpha: 2, g });
    log('NACA 0012 (round nose) at M=2: theory reports a detached bow shock', !R.ok && R.fail === 'detached', `fail=${R.fail}, nose turning ${(R.detail?.dth / D).toFixed(1)}°`);
  }

  // 6. trailing edge: equal pressure across the slip line
  {
    const R = solve('diamond', { t: 0.08 }, { M: 2.5, alpha: 6 });
    const pu = R.D[0].te.down.p, pl = R.D[1].te.down.p;
    log('trailing-edge waves bring both streams to the same pressure', R.ok && rel(pu, pl) < 1e-8, `p_upper=${pu.toFixed(6)} p_lower=${pl.toFixed(6)} slip angle ${(R.delta / D).toFixed(3)}°`);
  }

  // 7. field sampler
  {
    const R = solve('diamond', { t: 0.08 }, { M: 2.5, alpha: 4 });
    const s0 = R.sample(-0.5, 0.3), up = R.D[0].S, pt = R.upperW[10];
    const s1 = R.sample(pt[0] + 0.002, pt[1] + 0.01);
    log('field: free stream ahead of the nose', s0 && s0.p === 1 && s0.M === 2.5, `M=${s0?.M} p=${s0?.p}`);
    log('field: just above the front face = front-face state', s1 && rel(s1.p, up[0].p) < 1e-9, `p=${s1?.p.toFixed(5)} face=${up[0].p.toFixed(5)}`);
    log('field: inside the body returns null', R.sample(0.5, 0) === null, '');
  }

  // 8. skin friction sanity: turbulent flat plate at α=0
  {
    const Re = 1e7, R = solve('plate', {}, { M: 2, alpha: 0, viscous: true, Re, xtr: 0 });
    const inc = 2 * 0.455 / Math.log10(Re) ** 2.58; // both sides, incompressible Prandtl–Schlichting
    const r = R.cdf / inc;
    log('skin friction: turbulent plate at M=2 is 70–95% of the incompressible value', R.ok && r > 0.7 && r < 0.95, `cdf=${R.cdf?.toFixed(5)} incompressible ${inc.toFixed(5)} ratio ${r.toFixed(3)}`);
  }
}
