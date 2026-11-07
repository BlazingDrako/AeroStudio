// Vibration checks: exact SDOF integrator vs closed forms, dynamic load factors, shock spectra,
// Den Hartog absorber, transmissibility, and modal superposition vs static beam deflection.
import { sdofResponse, freeResponse, magnification, transmissibility, makeInput, shockSpectrum, absorberFRF, denHartog, modalFRF } from '../js/solvers/vibration.js';
import { modal } from '../js/solvers/frame2d.js';

export function vibrationTests(log) {
  const near = (name, v, ref, tol, unit = '') => log(name, Math.abs(v - ref) <= tol * Math.max(Math.abs(ref), 1e-12), `got ${(+v).toPrecision(6)}${unit}, expected ${(+ref).toPrecision(6)}${unit} (±${(tol * 100).toFixed(2)}%)`);
  const TAU = 2 * Math.PI, wn = TAU * 2;
  // free vibration vs closed form
  const dt = 0.002, n = 2000;
  let r = sdofResponse(wn, 0.05, new Float64Array(n), dt, 1, 0.3);
  let err = 0; for (let i = 0; i < n; i++) err = Math.max(err, Math.abs(r.u[i] - freeResponse(wn, 0.05, 1, 0.3, i * dt)));
  log('free vibration (ζ = 0.05): integrator matches closed form', err < 1e-9, `max error ${err.toExponential(2)}`);
  r = sdofResponse(wn, 1.5, new Float64Array(n), dt / 4, 1, 0);
  err = 0; for (let i = 0; i < n; i++) err = Math.max(err, Math.abs(r.u[i] - freeResponse(wn, 1.5, 1, 0, i * dt / 4)));
  log('overdamped (ζ = 1.5, Newmark): matches closed form', err < 1e-4, `max error ${err.toExponential(2)}`);
  // step load: DLF = 2
  const step = makeInput('step', {}, dt, 2).f;
  r = sdofResponse(wn, 0, step, dt);
  near('suddenly applied load: peak = 2 × static (undamped)', Math.max(...r.u) * wn * wn, 2, 1e-4);
  // harmonic steady state amplitude
  const z = 0.05, rr = 0.8, inp = makeInput('harmonic', { freq: rr * wn / TAU }, dt, 40).f;
  r = sdofResponse(wn, z, inp, dt);
  let amp = 0; for (let i = r.u.length - 2000; i < r.u.length; i++) amp = Math.max(amp, Math.abs(r.u[i]));
  near('harmonic steady state: amplitude = M(r,ζ)·F/k', amp * wn * wn, magnification(rr, z), 0.005);
  // undamped resonance grows linearly: envelope ≈ (F/2k)·ωt
  const res = sdofResponse(wn, 0, makeInput('harmonic', { freq: wn / TAU }, dt / 2, 5).f, dt / 2);
  let a5 = 0; for (let i = res.u.length - 1200; i < res.u.length; i++) a5 = Math.max(a5, Math.abs(res.u[i]));
  near('resonance (ζ = 0): amplitude grows as ωt/2 · F/k', a5 * wn * wn, wn * 5 / 2, 0.01);
  // pulse shock spectra
  const rect = shockSpectrum('rect', 0, { n: 40, rmin: 0.6, rmax: 3 });
  near('rectangular pulse, td/Tn ≥ ½: peak DLF = 2', Math.min(...rect.peak), 2, 0.01);
  const sr = shockSpectrum('rect', 0, { n: 2, rmin: 0.05, rmax: 0.051 });
  near('short rectangular pulse: DLF = 2 sin(π td/Tn)', sr.peak[0], 2 * Math.sin(Math.PI * 0.05), 0.01);
  const hs = shockSpectrum('halfsine', 0, { n: 120, rmin: 0.3, rmax: 2 });
  near('half-sine pulse: maximum DLF ≈ 1.77 (Harris)', Math.max(...hs.peak), 1.768, 0.01);
  // transmissibility crossover
  near('base excitation: transmissibility = 1 at r = √2 (any ζ)', transmissibility(Math.SQRT2, 0.3), 1, 1e-12);
  // Den Hartog optimum: equal peaks, amplification √(1 + 2/µ)
  const mu = 0.05, opt = denHartog(mu), k1 = 1, m1 = 1, m2 = mu, w1 = 1, k2 = m2 * (opt.f * w1) ** 2, c2 = 2 * opt.zeta * m2 * opt.f * w1;
  let pk = 0; for (let i = 1; i < 4000; i++) { const w = i / 2000; pk = Math.max(pk, absorberFRF(m1, k1, 0, m2, k2, c2, 1, w).X1 * k1); }
  near('Den Hartog absorber (µ = 0.05): peak amplification √(1 + 2/µ)', pk, Math.sqrt(1 + 2 / mu), 0.03);
  // modal superposition at ω → 0 reproduces the static midspan deflection of a simply supported beam
  const E = 200e9, b = 0.1, h = 0.2, I = b * h ** 3 / 12, L = 6;
  const mdl = { nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: L / 2, y: 0 }, { id: 'c', x: L, y: 0 }], members: [{ id: 'm1', a: 'a', b: 'b', type: 'frame', sec: 's', mat: 'm' }, { id: 'm2', a: 'b', b: 'c', type: 'frame', sec: 's', mat: 'm' }],
    supports: [{ node: 'a', type: 'pin' }, { node: 'c', type: 'roller' }], loads: [], sections: [{ id: 's', shape: 'rect', dims: { b, h } }], materials: [{ id: 'm', E, nu: 0.3, rho: 7850, fy: 250e6, alpha: 0 }], settings: {} };
  const md = modal(mdl, { nModes: 12, nsub: 8 });
  const dof = 1 * 3 + 1, Hs = modalFRF(md.modes, 0.02, dof, dof, 0, 1)[0];
  near('modal superposition (ω → 0): midspan flexibility = L³/48EI', Hs, L ** 3 / (48 * E * I), 0.01);
  near('modal superposition: first mode alone gives 98.6% (= 96/π⁴)', md.modes.filter(m => Math.abs(m.phi[dof]) > 1e-12)[0].phi[dof] ** 2 / md.modes.filter(m => Math.abs(m.phi[dof]) > 1e-12)[0].omega ** 2 / (L ** 3 / (48 * E * I)), 96 / Math.PI ** 4 * 1.0, 0.01);
}
