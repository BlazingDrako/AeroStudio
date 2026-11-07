// Rocket engine checks: geometry and sizing identities, the expansion table against the CEA rocket solution,
// thrust vs ambient pressure, flow separation, plume regimes, Bartz heat flux, and the model against published
// data for real engines.
import * as R from '../js/solvers/rocket.js';
import * as TH from '../js/solvers/thermo.js';

export function rocketTests(log) {
  const near = (name, v, ref, tol, unit = '') => log(name, Math.abs(v - ref) <= tol, `got ${(+v).toPrecision(6)}${unit}, expected ${ref}${unit} (±${tol})`);
  const rel = (name, v, ref, tol) => log(name, Math.abs(v / ref - 1) <= tol, `got ${(+v).toPrecision(5)}, reference ${ref} (±${(tol * 100).toFixed(1)}%), diff ${((v / ref - 1) * 100).toFixed(2)}%`);
  const base = { ...R.defaults() };
  const D = R.design(base);
  const pa = 101325;

  // --- geometry ---
  const g = D.geo, th = g.pts.reduce((a, p) => Math.abs(p[0]) < Math.abs(a[0]) ? p : a);
  near('contour: radius at x = 0 is the throat radius', th[1] / D.Rt, 1, 1e-9);
  near('contour: exit radius = Rt·√ε', g.pts[g.pts.length - 1][1] / D.Rt, Math.sqrt(base.eps), 1e-9);
  near('contour: chamber volume = L*·At', g.Vc / (base.Lstar * D.At), 1, 1e-3);
  const minR = Math.min(...g.pts.map(p => p[1]));
  near('contour: throat is the narrowest point', minR / D.Rt, 1, 1e-9);
  const xs = g.pts.map(p => p[0]);
  log('contour: x increases monotonically', xs.every((x, i) => i === 0 || x >= xs[i - 1] - 1e-12), `${xs.length} points from ${xs[0].toFixed(3)} to ${xs[xs.length - 1].toFixed(3)} m`);
  const cone = R.contour({ Rt: 0.1, eps: 16, contraction: 3, nozzle: 'cone', half: 15 });
  near('cone: divergence factor (1 + cos 15°)/2', cone.lambda, 0.98296, 1e-5);
  near('Rao bell is ~80% of a 15° cone length', g.Ldiv / ((Math.sqrt(base.eps) - 1) * D.Rt / Math.tan(15 * Math.PI / 180)), 0.8, 1e-9);
  near('Huzel & Huang contraction at Dt = 10 cm', R.autoContraction(0.1), 8 * 10 ** -0.6 + 1.25, 1e-12);

  // --- expansion table vs CEA rocket solution ---
  const sup = D.tbl.sup, sub = D.tbl.sub;
  near('table: minimum area ratio is 1 (throat)', Math.min(...D.tbl.rows.map(r => r.eps)), 1, 2e-3);
  near('table: Mach 1 at the throat', D.throat.M, 1, 0.01);
  rel('table: exit area ratio matches ε', D.along[D.along.length - 1].eps, base.eps, 1e-6);
  rel('table: exit Mach matches the CEA exit', D.along[D.along.length - 1].M, D.id.exit.M, 0.01);
  log('table: Mach increases along the supersonic branch', sup.every((r, i) => i === 0 || r.M > sup[i - 1].M - 1e-9), `M ${sup[0].M.toFixed(3)} → ${sup[sup.length - 1].M.toFixed(3)}`);
  log('table: subsonic branch is subsonic', sub.slice(0, -1).every(r => r.M < 1), `max ${Math.max(...sub.slice(0, -1).map(r => r.M)).toFixed(4)}`);
  const ftbl = R.expansionTable({ reactants: D.reactants, Pc: D.Pc, frozen: true, Pt: D.id.throat.P, Gt: D.id.throat.rho * D.id.throat.u, pMin: D.pe });
  log('frozen expansion is colder at the exit than equilibrium', ftbl.rows[ftbl.rows.length - 1].T < sup[sup.length - 1].T, `frozen ${ftbl.rows[ftbl.rows.length - 1].T.toFixed(0)} K vs equilibrium ${sup[sup.length - 1].T.toFixed(0)} K`);

  // --- sizing and performance identities ---
  rel('sizing: thrust at the specified condition equals the requirement', D.sl.F, base.F * 1e3, 1e-9);
  const Dv = R.design({ ...base, at: 'vac', F: 1000 });
  rel('sizing: vacuum thrust requirement met', Dv.vac.F, 1e6, 1e-9);
  const ppa = D.perf(pa), pv = D.perf(0);
  rel('F_vac − F(pa) = pa·Ae (no separation)', (pv.F - ppa.F) / D.ggThrustFactor, pa * D.Ae, 1e-9);
  rel('Isp = CF·c*/g0 (no gas generator)', (() => { const d = R.design({ ...base, cycle: 'staged' }); return d.vac.Isp / (d.CFvac * d.cstar / R.G0); })(), 1, 1e-9);
  rel('mass flow = Pc·At/c* (no gas generator)', (() => { const d = R.design({ ...base, cycle: 'staged' }); return d.mdot / (d.Pc * d.At / d.cstar); })(), 1, 1e-12);
  const gg = R.design({ ...base, cycle: 'gg', gg: 0.03 }), st = R.design({ ...base, cycle: 'staged' });
  rel('gas generator dumping 3% at Isp/3 costs 2% of Isp', gg.vac.Isp / st.vac.Isp, 0.98, 1e-9);
  const ideal = R.design({ ...base, etaC: 1, etaN: 1, nozzle: 'cone', half: 1e-6, cycle: 'staged' });
  rel('ideal efficiencies reproduce the CEA vacuum Isp', ideal.vac.Isp * R.G0, ideal.id.Ivac, 1e-6);
  const Pd = R.adaptedIsp(ideal, D.pe);
  rel('ideally expanded Isp at pa = pe equals the fixed nozzle there', Pd.Isp, ideal.perf(D.pe).Isp, 2e-3);
  log('adapted nozzle beats a fixed one off-design', R.adaptedIsp(D, pa * 0.1).Isp > D.perf(pa * 0.1).Isp && R.adaptedIsp(D, pa).Isp >= D.perf(pa).Isp - 0.3, `${R.adaptedIsp(D, pa * 0.1).Isp.toFixed(1)} s vs ${D.perf(pa * 0.1).Isp.toFixed(1)} s at 0.1 atm`);

  // --- separation ---
  const vac = R.design({ ...base, eps: 165, at: 'vac', F: 981 });
  const sepP = vac.perf(pa);
  log('vacuum nozzle separates at sea level', sepP.sep && sepP.regime === 'separated', `pe/pa = ${(vac.pe / pa).toFixed(3)}, separates at A/At ${sepP.epsSep?.toFixed(1)}`);
  const fullFlow = vac.CFvac - vac.eps * pa / vac.Pc;
  log('separated thrust exceeds the full-flowing estimate', sepP.CF > fullFlow, `CF ${sepP.CF.toFixed(3)} vs ${fullFlow.toFixed(3)} if it stayed attached`);
  near('Kalt–Badal separation pressure', R.sepPressure(vac, pa) / pa, 0.667 * (vac.Pc / pa) ** -0.2, 1e-12);
  log('booster nozzle stays attached at sea level', !D.sl.sep, `pe/pa = ${(D.pe / pa).toFixed(3)}`);

  // --- plume ---
  const under = R.plume(D, D.pe / 3), over = R.plume(D, D.pe * 1.4);
  log('under-expanded jet: Mj > Me and Dj > De', under.regime === 'under' && under.Mj > under.Me && under.Dj > D.De, `Mj ${under.Mj.toFixed(3)} vs Me ${under.Me.toFixed(3)}, Dj ${under.Dj.toFixed(3)} m vs De ${D.De.toFixed(3)} m`);
  log('over-expanded jet: Mj < Me and Dj < De', over.regime === 'over' && over.Mj < over.Me && over.Dj < D.De, `Mj ${over.Mj.toFixed(3)}, Dj ${over.Dj.toFixed(3)} m`);
  const des = R.plume(D, D.pe);
  near('ideally expanded jet: Mj = Me', des.Mj, des.Me, 1e-6);
  log('vacuum plume has no shock cells', !isFinite(R.plume(D, 0).cell), 'cell length ∞');

  // --- heat transfer ---
  const B = R.bartz(D, {});
  log('Bartz: heat flux peaks within one throat radius of the throat', Math.abs(B.peak.x) < D.Rt, `peak at x = ${(B.peak.x * 100).toFixed(2)} cm (Rt ${(D.Rt * 100).toFixed(1)} cm)`);
  near('Bartz: Eucken Prandtl number for γ = 1.2', R.prandtl(1.2), 0.8276, 1e-4);
  const rs = R.design({ ...base, ...R.ENGINES.find(e => e.id === 'rs25'), gg: 0 });
  const Brs = R.bartz(rs, { coolant: 'fuel' });
  log('Bartz: RS-25 throat heat flux of order 100 MW/m² (published ~160)', Brs.peak.q > 6e7 && Brs.peak.q < 2.5e8, `${(Brs.peak.q / 1e6).toFixed(0)} MW/m²`);
  log('Bartz: higher Pc raises the throat heat flux', R.bartz(R.design({ ...base, Pc: 200 })).peak.q > B.peak.q, '');
  log('radiative extension lowers the coolant heat load', R.bartz(vac, { epsCool: 20 }).Q < R.bartz(vac).Q, '');

  // --- propellants ---
  near('bulk density LOX/RP-1 at O/F 2.6', R.bulkDensity('RP-1', 'O2(L)', 2.6), 1024.7, 0.5, ' kg/m³');
  near('bulk density LOX/LH2 at O/F 6', R.bulkDensity('H2(L)', 'O2(L)', 6), 7 / (6 / 1141 + 1 / 70.8), 1e-9, ' kg/m³');
  for (const c of R.COMBOS) {
    const r0 = TH.rocket({ reactants: R.reactantsFor(c.fuel, c.ox, c.of), Pc: 7e6, eps: 40 });
    log(`${c.label}: typical O/F is fuel-rich of stoichiometric`, c.of < TH.stoichOF(c.fuel, c.ox), `O/F ${c.of} < ${TH.stoichOF(c.fuel, c.ox).toFixed(2)}; Ivac ${(r0.Ivac / R.G0).toFixed(1)} s`);
  }

  // --- real engines (published values, model with default efficiencies) ---
  for (const e of R.ENGINES) {
    const d = R.design({ ...base, ...e, gg: e.gg ?? 0 });
    if (e.pub.Ivac) rel(`${e.name}: vacuum Isp within 4.5% of published`, d.vac.Isp, e.pub.Ivac, 0.045);
    if (e.pub.Isl) rel(`${e.name}: sea-level Isp within 4.5% of published`, d.sl.Isp, e.pub.Isl, 0.045);
  }
}
