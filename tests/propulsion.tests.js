// Propulsion checks: chemical equilibrium against NASA CEA reference values, cycle code against the
// closed-form ideal turbojet, ISA, inlet shock recovery and turbomachinery identities.
import * as TH from '../js/solvers/thermo.js';
import * as C from '../js/solvers/cycles.js';
import * as IN from '../js/solvers/inlets.js';
import * as TB from '../js/solvers/turbo.js';

export function propulsionTests(log) {
  const near = (name, v, ref, tol, unit = '') => log(name, Math.abs(v - ref) <= tol, `got ${(+v).toPrecision(6)}${unit}, expected ${ref}${unit} (±${tol})`);
  const atm = 101325;

  // --- equilibrium (CEA reference values) ---
  const h2 = TH.flame({ reactants: [{ id: 'H2', mass: 1 }, { id: 'O2', mass: TH.stoichOF('H2', 'O2') }], P: atm });
  near('CEA: H2/O2 stoichiometric adiabatic flame, 1 atm', h2.T, 3079, 8, ' K');
  const of = TH.stoichOF('CH4', 'Air');
  const ch4 = TH.flame({ reactants: [{ id: 'CH4', mass: 1 }, { id: 'Air', mass: of }], P: atm });
  near('CEA: CH4/air φ=1 adiabatic flame, 1 atm', ch4.T, 2226, 6, ' K');
  near('stoichiometric O/F for CH4/air', of, 17.2, 0.1);
  near('Jet-A lower heating value', TH.lowerHeatingValue('Jet-A(L)') / 1e6, 43.0, 0.3, ' MJ/kg');
  near('H2 lower heating value', TH.lowerHeatingValue('H2') / 1e6, 119.96, 0.2, ' MJ/kg');
  const elem = h2.sys.els.map((e, i) => { let b = 0; h2.sys.sp.forEach((s, j) => { b += (s.el[e] || 0) * h2.n[j]; }); return Math.abs(b / h2.sys.b0[i] - 1); });
  log('equilibrium conserves elements', Math.max(...elem) < 1e-8, `max relative element error ${Math.max(...elem).toExponential(2)}`);
  const tp = TH.flame({ reactants: [{ id: 'H2', mass: 1e-9 }, { id: 'Air', mass: 1 }], P: atm, T: 300, prob: 'TP' });
  near('TP: air at 300 K stays N2/O2 (x_O2)', TH.moleFractions(tp).find(x => x.name === 'O2').x, 0.2095, 2e-3);
  const r = TH.rocket({ reactants: [{ id: 'H2(L)', mass: 1 }, { id: 'O2(L)', mass: 6 }], Pc: 68.046 * atm, pcpe: 68.046 });
  near('rocket: throat is sonic', r.throat.M, 1, 1e-4);
  near('rocket LOX/LH2 O/F 6, 1000 psia: c*', r.cstar, 2306, 15, ' m/s');
  near('rocket LOX/LH2: Isp (pe = 1 atm)', r.exit.u / 9.80665, 382, 4, ' s');
  const rf = TH.rocket({ reactants: [{ id: 'H2(L)', mass: 1 }, { id: 'O2(L)', mass: 6 }], Pc: 68.046 * atm, pcpe: 68.046, frozen: true });
  log('frozen Isp below equilibrium Isp', rf.exit.u < r.exit.u, `${(rf.exit.u / 9.80665).toFixed(1)} s < ${(r.exit.u / 9.80665).toFixed(1)} s`);
  const re = TH.rocket({ reactants: [{ id: 'RP-1', mass: 1 }, { id: 'O2(L)', mass: 2.6 }], Pc: 6.895e6, eps: 40 });
  near('rocket: area-ratio exit matches requested ε', re.eps, 40, 1e-3);

  // --- atmosphere ---
  near('ISA 11 km temperature', C.isa(11000).T, 216.77, 0.05, ' K');
  near('ISA 11 km pressure', C.isa(11000).p, 22700, 30, ' Pa');
  near('ISA 20 km pressure', C.isa(20000).p, 5529, 10, ' Pa');

  // --- cycle code vs closed-form ideal turbojet (Mattingly) ---
  const P = { ...C.defaults('turbojet'), gas: 'ideal', M0: 0.9, alt: 11000, piC: 10, Tt4: 1600, eC: 1, eT: 1, etaB: 1, piB: 1, etaM: 1, piN: 1, nozzle: 'cd', inlet: { model: 'mil', pidMax: 1 } };
  const res = C.runCycle(P);
  const cp = 1004.5, T0 = res.T0, a0 = Math.sqrt(1.4 * 287.05 * T0), M0 = 0.9, hPR = res.gas.LHV;
  const tr = 1 + 0.2 * M0 * M0, tl = 1600 / T0, tc = 10 ** (0.4 / 1.4), f = (tl - tr * tc) / (hPR / (cp * T0) - tl), tt = 1 - tr * (tc - 1) / ((1 + f) * tl);
  const V9 = Math.sqrt(2 * cp * 1600 * tt * (1 - (tr * tc * tt) ** -1));
  near('ideal turbojet specific thrust vs closed form', res.perf.Fs, (1 + f) * V9 - M0 * a0, 0.2, ' N·s/kg');
  near('ideal turbojet fuel/air ratio vs closed form', res.perf.f, f, 1e-5);
  const ram = C.runCycle({ ...C.defaults('ramjet'), gas: 'ideal', etaB: 1, piB: 1, piN: 1, inlet: { model: 'mil', pidMax: 1 } });
  log('ramjet: Tt0 = Tt2 (adiabatic inlet)', Math.abs(ram.S[0].Tt - ram.S[1].Tt) < 1e-6, `${ram.S[0].Tt.toFixed(3)} K`);
  for (const t of Object.keys(C.ENGINE_TYPES)) for (const g of ['ideal', 'twoGamma', 'real']) {
    const rr = C.runCycle({ ...C.defaults(t), gas: g });
    log(`${t} (${g}) solves with 0 < ηo < 1`, rr.perf.valid && rr.perf.etaO > 0 && rr.perf.etaO < 1 && rr.perf.etaP <= 1.0001, `Fs ${rr.perf.Fs.toFixed(1)}, ηth ${rr.perf.etaTh.toFixed(3)}, ηp ${rr.perf.etaP.toFixed(3)}`);
  }
  const fan = C.defaults('turbofan');
  const pf = C.matchFanPR({ ...fan, bpr: 1, piC: 25, mixed: true });
  const mm = C.runCycle({ ...fan, bpr: 1, piC: 25, mixed: true, piF: pf });
  log('mixed turbofan: matched fan PR equalises pt13 and pt5', Math.abs(mm.mixMismatch) < 1e-4, `πf = ${pf.toFixed(4)}, mismatch ${mm.mixMismatch.toExponential(2)}`);

  // --- inlets ---
  near('normal-shock inlet recovery at M2', IN.analyzeInlet(2, []).recovery, 0.72087, 1e-4);
  near('MIL-E-5008B at M2', IN.milSpecRecovery(2), 0.925, 1e-9);
  const o = IN.oswatitschRamps(3, 2), ar = IN.analyzeInlet(3, o.thetas);
  log('Oswatitsch shocks have equal normal Mach', ar.shocks.every(s => Math.abs((s.kind === 'normal' ? s.Mup : s.Mup * Math.sin(s.beta)) - o.Mn) < 1e-6), `Mn = ${o.Mn.toFixed(5)}`);
  log('more ramps recover more pressure at M3', [0, 1, 2, 3].map(N => IN.analyzeInlet(3, IN.oswatitschRamps(3, N).thetas).recovery).every((v, i, a) => !i || v > a[i - 1]), '');

  // --- turbomachinery ---
  const ax = TB.axialCompressor({ U: 350, phi: 0.55, psi: 0.35, R: 0.5 });
  near('axial: Euler work ψU² = U·ΔCθ', ax.Ct2 - ax.Ct1, 0.35 * 350, 1e-9, ' m/s');
  near('axial: 50% reaction gives symmetric triangles (α1 = β2)', ax.angles.a1, ax.angles.b2, 1e-12);
  const tu = TB.axialTurbine({ U: 400, phi: 0.6, psi: 2 * (1 - 0.5), R: 0.5 });
  near('turbine: ψ = 2(1−R) gives zero exit swirl', tu.angles.a3, 0, 1e-12);
  const ce = TB.centrifugal({ beta2b: 0, Z: 1e9, phi2: 0.3 });
  near('centrifugal: radial blades, infinite Z → σ = 1', ce.sigma, 1, 1e-6);
}
