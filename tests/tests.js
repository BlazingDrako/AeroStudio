// Validation suite for the mfoil port. Open tests/index.html through the local server.
import { Mfoil, init_thermo, calc_force, _internal as I } from '../js/solvers/mfoil/mfoil.js';
import * as C from '../js/solvers/mfoil/correlations.js';
import { gasdynTests } from './gasdyn.tests.js';
import { supersonicTests } from './supersonic.tests.js';
import { propulsionTests } from './propulsion.tests.js';
import { structuresTests } from './structures.tests.js';
import { fem2dTests } from './fem2d.tests.js';
import { vibrationTests } from './vibration.tests.js';
import { frame3dTests } from './frame3d.tests.js';
import { formulasTests } from './formulas.tests.js';
import { cfdTests } from './cfd.tests.js';
import { vehiclesTests } from './vehicles.tests.js';
import { flightTests } from './flight.tests.js';
import { performanceTests } from './performance.tests.js';
import { stabilityTests } from './stability.tests.js';
import { controlTests } from './control.tests.js';
import { augmentTests } from './augment.tests.js';
import { autopilotTests } from './autopilot.tests.js';
import { navigationTests } from './navigation.tests.js';
import { insTests } from './ins.tests.js';
import { collabTests } from './collab.tests.js';
import { rocketTests } from './rocket.tests.js';
import { orbitsTests } from './orbits.tests.js';
import { wingsTests } from './wings.tests.js';

const results = [];
const log = (name, pass, detail = '') => { results.push({ name, pass, detail }); };

// ---------- 1. derivative ping tests (mirrors ping_test in mfoil.m) ----------
function pingCorrelations() {
  const M = new Mfoil({ naca: '0012' });
  M.oper.alpha = 3; M.oper.Ma = 0.4; M.oper.viscous = true;
  const fns = ['get_Hk', 'get_Ret', 'get_cf', 'get_cDi', 'get_Hs', 'get_Us', 'get_cDi_turbwall', 'get_cDi_lam',
    'get_cDi_lamwake', 'get_cDi_outer', 'get_cDi_lamstress', 'get_cteq', 'get_cttr', 'get_de', 'get_damp', 'get_Mach2', 'get_Hss'];
  const Uv = [[0.01, 0.02, 8.4, 0.9], [0.023, 0.05, 0.031, 1.1]];
  let worst = { rate: 99 };
  for (const Re of [2e3, 1e5]) {
    M.oper.Re = Re; init_thermo(M);
    for (let it = 0; it < 3; it++) {
      const param = { ...I.build_param(M, 0), turb: it > 0, wake: it === 2 };
      for (const fname of fns) {
        const f = C[fname];
        for (let k = 0; k < 4; k++) {
          const U = Uv[Math.min(it, 1)].slice();
          let ep = 1e-4; const E = [0, 0];
          const [v0, g0] = f(U, param);
          for (let e = 0; e < 2; e++) {
            const Up = U.slice(); Up[k] += ep;
            const [v1, g1] = f(Up, param);
            E[e] = Math.abs((v1 - v0) / ep - 0.5 * (g1[k] + g0[k]));
            ep /= 2;
          }
          // ignore errors at round-off level (e.g. functions exactly linear in U[k])
          if (E[1] > 5e-11 && E[1] > 1e-9 * Math.max(1, Math.abs(g0[k]))) {
            const rate = Math.log2(E[0] / E[1]);
            if (rate < worst.rate) worst = { rate, where: `${fname} Re=${Re} ${['lam', 'turb', 'wake'][it]} dU${k}`, E: E[1] };
            if (rate < 1.5) log(`ping ${fname} (${['lam', 'turb', 'wake'][it]}, Re=${Re}, U${k})`, false, `rate=${rate.toFixed(2)} err=${E[1].toExponential(2)}`);
          }
        }
      }
      // residual_station
      const U1 = Uv[Math.min(it, 1)].slice(), U2 = U1.map((v, i) => v * [1.1, 0.8, 0.9, 1.2][i]);
      for (let k = 0; k < 8; k++) {
        let ep = 1e-4; const E = [0, 0];
        const xi = [0.7, 0.8], Aux = [0.002, 0.0018], dxv = [-0.2, 0.3];
        const r0 = I.residual_station(param, xi, U1, U2, Aux);
        for (let e = 0; e < 2; e++) {
          const a = U1.slice(), b = U2.slice(); if (k < 4) a[k] += ep; else b[k - 4] += ep;
          const xp = [xi[0] + ep * dxv[0], xi[1] + ep * dxv[1]];
          const r1 = I.residual_station(param, xp, a, b, Aux);
          let s = 0;
          for (let q = 0; q < 3; q++) {
            const fd = (r1.R[q] - r0.R[q]) / ep;
            const an = 0.5 * (r1.R_U[q][k] + r0.R_U[q][k]) + 0.5 * ((r0.R_x[q][0] + r1.R_x[q][0]) * dxv[0] + (r0.R_x[q][1] + r1.R_x[q][1]) * dxv[1]);
            s += (fd - an) ** 2;
          }
          E[e] = Math.sqrt(s); ep /= 2;
        }
        if (E[1] > 5e-11) {
          const rate = Math.log2(E[0] / E[1]);
          if (rate < worst.rate) worst = { rate, where: `residual_station ${['lam', 'turb', 'wake'][it]} dU${k}`, E: E[1] };
          if (rate < 1.5) log(`ping residual_station (${['lam', 'turb', 'wake'][it]}, Re=${Re}, U${k})`, false, `rate=${rate.toFixed(2)}`);
        }
      }
    }
  }
  log('derivative ping: all BL correlations + station residual', !results.some(r => !r.pass && r.name.startsWith('ping')),
    `worst convergence rate ${worst.rate.toFixed(2)} (expect ~2) at ${worst.where}`);
}

// transition residual ping (check_ping style)
function pingTransition() {
  const M = new Mfoil({ naca: '0012' });
  M.oper.Re = 2e6; M.oper.Ma = 0.4; M.oper.viscous = true; init_thermo(M);
  const param = { ...I.build_param(M, 0), is: 0 };
  let U1 = [0.01, 0.02, 8.95, 0.9], U2 = [0.013, 0.023, 0.028, 0.85], x = [0.7, 0.8];
  const dU = [0.3, 0.7, 0.2, 0.5, 0.9, 0.1, 0.4, 0.6], dx = [0.25, 0.65], ep = 1e-4;
  const v = [], vu = [];
  for (let e = 0; e < 3; e++) {
    const r = I.residual_transition(M, param, x, U1, U2, [0, 0]);
    v.push(r.R);
    vu.push(r.R.map((_, q) => r.R_U[q].reduce((s, a, k) => s + a * dU[k], 0) + r.R_x[q][0] * dx[0] + r.R_x[q][1] * dx[1]));
    U1 = U1.map((a, k) => a + ep * dU[k]); U2 = U2.map((a, k) => a + ep * dU[k + 4]); x = x.map((a, k) => a + ep * dx[k]);
  }
  const E = [1, 2].map(i => Math.hypot(...v[0].map((_, q) => (v[i][q] - v[0][q]) / (ep * i) - 0.5 * (vu[0][q] + vu[i][q]))));
  const rate = Math.log2(E[1] / E[0]);
  log('derivative ping: transition residual', rate > 1.5, `rate=${rate.toFixed(2)} (expect ~2)`);
}

// ---------- 2. global system Jacobian ping ----------
function pingGlobal() {
  const M = new Mfoil({ naca: '2412', npanel: 99 });
  M.param.verb = 0; M.param.niglob = 50;
  M.setoper({ alpha: 1, Re: 1e6 });
  M.solve();
  const Nsys = M.glob.Nsys, n4 = 4 * Nsys;
  let seed = 1; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const U0 = Float64Array.from(M.glob.U);
  const dU = Float64Array.from({ length: n4 }, (_, c) => (rnd() - 0.5) * Math.abs(U0[c])), ep = 1e-4;
  const v = [], vu = [];
  for (let e = 0; e < 3; e++) {
    I.build_glob_sys(M);
    const R = Float64Array.from(M.glob.R), RU = M.glob.R_U;
    const Jv = new Float64Array(3 * Nsys);
    for (let r = 0; r < 3 * Nsys; r++) { let s = 0; for (let c = 0; c < n4; c++) s += RU[r * n4 + c] * dU[c]; Jv[r] = s; }
    v.push(R); vu.push(Jv);
    for (let c = 0; c < n4; c++) M.glob.U[c] += ep * dU[c];
  }
  M.glob.U.set(U0);
  const E = [1, 2].map(i => { let s = 0; for (let r = 0; r < 3 * Nsys; r++) s += ((v[i][r] - v[0][r]) / (ep * i) - 0.5 * (vu[0][r] + vu[i][r])) ** 2; return Math.sqrt(s); });
  const rate = Math.log2(E[1] / E[0]);
  const hist = M.glob.history.map(h => h.toExponential(1)).join(' → ');
  log('derivative ping: full coupled-system Jacobian', rate > 1.5, `rate=${rate.toFixed(2)} (expect ~2), err=${E[0].toExponential(2)}\nNewton residuals: ${hist}`);
}

// ---------- 3. structured solver vs plain dense solver ----------
function compareSolvers() {
  const cases = [
    { naca: '2412', alpha: 4, Re: 1e6 },
    { naca: '0012', alpha: 2, Re: 1e6, Ma: 0.4 },
    { naca: '4412', cl: 1.0, Re: 3e6 },
  ];
  for (const c of cases) {
    const out = [];
    for (const dense of [false, true]) {
      const M = new Mfoil({ naca: c.naca });
      M.param.verb = 0; M.param.denseSolve = dense;
      const op = { Re: c.Re }; if (c.alpha !== undefined) op.alpha = c.alpha; if (c.cl !== undefined) op.cl = c.cl; if (c.Ma) op.Ma = c.Ma;
      M.setoper(op);
      const t0 = performance.now(); M.solve(); const t = performance.now() - t0;
      out.push({ cl: M.post.cl, cd: M.post.cd, cm: M.post.cm, it: M.glob.history.length, conv: M.glob.conv, t, alpha: M.oper.alpha });
    }
    const [f, d] = out;
    const rel = Math.max(Math.abs(f.cl - d.cl) / Math.abs(d.cl), Math.abs(f.cd - d.cd) / d.cd);
    log(`fast solver = dense solver: NACA ${c.naca} ${c.alpha !== undefined ? 'α=' + c.alpha : 'cl=' + c.cl} Re=${c.Re}${c.Ma ? ' M=' + c.Ma : ''}`,
      f.conv && d.conv && rel < 1e-8,
      `cl=${f.cl.toFixed(6)} cd=${f.cd.toFixed(6)} cm=${f.cm.toFixed(5)} α=${f.alpha.toFixed(4)} | iters ${f.it}/${d.it} | time fast ${f.t.toFixed(0)} ms vs dense ${d.t.toFixed(0)} ms | max rel diff ${rel.toExponential(1)}`);
  }
}

// ---------- 4. physics sanity checks ----------
function physics() {
  let M = new Mfoil({ naca: '0012' }); M.param.verb = 0; M.setoper({ alpha: 0 }); M.solve();
  log('symmetric airfoil at α=0 has zero lift (inviscid)', Math.abs(M.post.cl) < 1e-8, `cl=${M.post.cl.toExponential(2)}`);
  M = new Mfoil({ naca: '0012' }); M.param.verb = 0; M.setoper({ alpha: 5 }); M.solve();
  const slope = M.post.cl / (5 * Math.PI / 180) / (2 * Math.PI);
  log('NACA 0012 inviscid lift slope ≈ 2π×(1+0.77 t/c)', Math.abs(slope - 1.0924) < 0.03, `cl=${M.post.cl.toFixed(4)}, slope/2π=${slope.toFixed(4)}`);
  M = new Mfoil({ naca: '0012' }); M.param.verb = 0; M.setoper({ alpha: 0, Re: 1e6 }); M.solve();
  log('NACA 0012, Re=1e6, α=0 drag near XFOIL (cd≈0.0054)', M.glob.conv && Math.abs(M.post.cd - 0.0054) < 0.0006,
    `cd=${M.post.cd.toFixed(5)}, transition x/c lower ${M.vsol.Xt[0][1].toFixed(3)} upper ${M.vsol.Xt[1][1].toFixed(3)}`);
  M = new Mfoil({ naca: '2412' }); M.param.verb = 0; M.setoper({ alpha: 2, Re: 1e6 }); M.setoper({ xftu: 0.1, xftl: 0.1 }); M.solve();
  log('forced transition (trip at x/c=0.1) converges', M.glob.conv,
    `cd=${M.post.cd.toFixed(5)}, transition lower ${M.vsol.Xt[0][1].toFixed(3)} upper ${M.vsol.Xt[1][1].toFixed(3)}`);
}

export async function runAll(out) {
  const only = new URLSearchParams(location.search).get('only');
  const gas = function gasdyn() { gasdynTests(log); };
  const sup = function supersonic() { supersonicTests(log); };
  const prop = function propulsion() { propulsionTests(log); };
  const struct = function structures() { structuresTests(log); };
  const fem = function fem2d() { fem2dTests(log); };
  const vib = function vibration() { vibrationTests(log); };
  const f3d = function frame3d() { frame3dTests(log); };
  const fl = function formulas() { formulasTests(log); };
  const cfd = function cfd() { cfdTests(log); };
  const veh = function vehicles() { vehiclesTests(log); };
  const flt = function flight() { flightTests(log); };
  const perf = function performance() { performanceTests(log); };
  const stab = function stability() { stabilityTests(log); };
  const ctl = function control() { controlTests(log); };
  const aug = function augment() { augmentTests(log); };
  const apt = function autopilot() { autopilotTests(log); };
  const nav = function navigation() { navigationTests(log); };
  const insT = function ins() { insTests(log); };
  const team = function collab() { collabTests(log); };
  const rkt = function rocket() { rocketTests(log); };
  const orb = function orbits() { orbitsTests(log); };
  const wng = function wings() { wingsTests(log); };
  const steps = only === 'wings' ? [wng] : only === 'orbits' ? [orb] : only === 'rocket' ? [rkt] : only === 'collab' ? [team] : only === 'ins' ? [insT] : only === 'navigation' ? [nav, insT] : only === 'autopilot' ? [apt] : only === 'augment' ? [aug] : only === 'control' ? [ctl, aug, apt] : only === 'stability' ? [stab] : only === 'performance' ? [perf] : only === 'flight' ? [flt, perf, stab, ctl, aug, apt] : only === 'vehicles' ? [veh] : only === 'cfd' ? [cfd] : only === 'formulas' ? [fl] : only === 'gasdyn' ? [gas] : only === 'supersonic' ? [sup] : only === 'propulsion' ? [prop] : only === 'structures' ? [struct, fem, vib, f3d] : only === 'frame3d' ? [f3d] : only === 'fem2d' ? [fem] : only === 'vibration' ? [vib] : [gas, sup, prop, rkt, orb, wng, struct, fem, vib, f3d, fl, cfd, veh, flt, perf, stab, ctl, aug, apt, nav, insT, team, pingCorrelations, pingTransition, pingGlobal, compareSolvers, physics];
  for (const s of steps) {
    try { await s(); } catch (e) { log(s.name + ' threw', false, e.stack || String(e)); }
    render(out);
    await new Promise(r => setTimeout(r, 0));
  }
  window.__results = results;
  return results;
}

function render(out) {
  out.innerHTML = results.map(r => `<div class="r ${r.pass ? 'ok' : 'bad'}"><b>${r.pass ? 'PASS' : 'FAIL'}</b> ${r.name}<div class="d">${r.detail}</div></div>`).join('');
}
