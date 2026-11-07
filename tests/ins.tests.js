// INS and GNSS checks against textbook closed forms (Titterton & Weston 2004 ch. 12; Groves 2013 ch. 14; Misra & Enge
// 2011 ch. 6): the 84.4-minute Schuler period; position error from an accelerometer bias, a gyro drift, an initial
// tilt and an initial velocity error; self-alignment and gyrocompassing; the Foucault rotation; the unstable vertical
// channel and baro aiding; the GPS orbit period; least squares with a clock bias; DOP of a symmetric sky; and the
// Kalman filter, from the scalar closed form to an INS/GNSS run with an outage.
import * as I from '../js/solvers/ins.js';
import * as Ct from '../js/solvers/control.js';

export function insTests(log) {
  const D = Math.PI / 180, HR = 3600, R = I.R_E, g = I.G0, ws = I.SCHULER;
  const near = (name, v, ref, tol, unit = '') => log(name, Math.abs(v - ref) <= tol, `got ${(+v).toFixed(6)}${unit}, expected ${(+ref).toFixed(6)}${unit} (±${tol})`);
  const rel = (name, v, ref, tol) => log(name, Math.abs(v / ref - 1) <= tol, `got ${(+v).toPrecision(7)}, expected ${(+ref).toPrecision(7)} (±${(tol * 100).toFixed(2)}%)`);
  const at = (run, t) => run.x[Math.round(t / (run.t[1] - run.t[0]))];
  const zero5 = [0, 0, 0, 0, 0];

  // ---- matrix exponential ----
  const w = 0.3, E = I.expm([[0, 1], [-w * w, 0]], 7);
  near('expm of a harmonic oscillator gives cos ωt', E[0][0], Math.cos(w * 7), 1e-12);
  near('…and sin(ωt)/ω', E[0][1], Math.sin(w * 7) / w, 1e-12);

  // ---- Schuler (Earth rate off: the textbook single-channel results) ----
  near('Schuler period 2π√(R/g) = 84.4 min', 2 * Math.PI / ws / 60, 84.4, 0.05, ' min');
  const acc = 1e-3 * g;   // 1 mg
  const ra = I.insRun({ lat: 45 * D, T: 4 * HR, dt: 5, bias: [0, 0, 0, acc, 0], aligned: false, earth: false });
  const pN = ra.x.filter((_, k) => ra.t[k] < 2 * Math.PI / ws).map(x => x[0]), peak = Math.max(...pN), tPeak = ra.t[pN.indexOf(peak)];
  rel('1 mg accelerometer bias: peak error 2∇R/g = 12.74 km', peak, 2 * acc / ws ** 2, 1e-4);
  near('…reached half a Schuler period after the start', tPeak / 60, Math.PI / ws / 60, 0.1, ' min');
  near('…and back to zero after one full period', at(ra, 2 * Math.PI / ws)[0], 0, 15, ' m');
  const eps = 0.01 * D / HR, rg = I.insRun({ lat: 45 * D, T: 4 * HR, dt: 5, bias: [0, eps, 0, 0, 0], aligned: false, earth: false });
  const t3 = 3 * HR;
  rel('0.01°/h gyro drift: δp = −Rε(t − sin ωst / ωs)', at(rg, t3)[0], -R * eps * (t3 - Math.sin(ws * t3) / ws), 1e-4);
  near('…the rule of thumb: about 0.6 nm/h', R * eps * HR / 1852, 0.6, 0.02, ' nm/h');
  const tilt = 1e-4, rt = I.insRun({ lat: 45 * D, T: 2 * HR, dt: 5, bias: zero5, aligned: false, earth: false, tilt0: tilt });
  rel('0.1 mrad initial tilt: δp = Rφ(1 − cos ωst)', at(rt, 1800)[0], R * tilt * (1 - Math.cos(ws * 1800)), 1e-5);
  const rv = I.insRun({ lat: 45 * D, T: 2 * HR, dt: 5, bias: zero5, aligned: false, earth: false, vel0: 0.1 });
  rel('0.1 m/s initial velocity error: δp = δv·sin(ωst)/ωs', at(rv, 1000)[0], 0.1 * Math.sin(ws * 1000) / ws, 1e-5);

  // ---- alignment ----
  const bAcc = [0, 0, 0, acc, acc];
  const al = I.insRun({ lat: 45 * D, T: HR, dt: 5, bias: bAcc, aligned: true, earth: false });
  log('levelling cancels accelerometer biases exactly (no Earth rate)', Math.hypot(at(al, HR)[0], at(al, HR)[1]) < 1e-6, `${Math.hypot(at(al, HR)[0], at(al, HR)[1]).toExponential(2)} m after 1 h`);
  const alE = I.insRun({ lat: 45 * D, T: HR, dt: 5, bias: bAcc, aligned: true }), unE = I.insRun({ lat: 45 * D, T: HR, dt: 5, bias: bAcc, aligned: false });
  const eA = Math.max(...alE.x.map(x => Math.hypot(x[0], x[1]))), eU = Math.max(...unE.x.map(x => Math.hypot(x[0], x[1])));
  log('…with Earth rate the levelled tilt mis-resolves Earth rate, but under 10% of the unaligned error remains', eA < 0.1 * eU, `${eA.toFixed(1)} m vs ${eU.toFixed(0)} m`);
  const x0 = I.alignedState(45 * D, [0, eps, 0, 0, 0]);
  near('gyrocompassing: heading error εE/(Ω cos L) = 0.054° for 0.01°/h at 45°', x0[6] / D, 0.0539, 0.0005, '°');
  const F = I.errorModel(45 * D), dphiE = F[5].reduce((s, f, j) => s + f * x0[j], 0);
  near('…which is the heading that stops the east tilt drifting', dphiE, 0, 1e-15, ' rad/s');

  // ---- Earth rate: the natural frequencies of the error model ----
  const lat = 45 * D, Fl = I.errorModel(lat), A7 = [...Array(7)].map((_, i) => [...Fl[i].slice(0, 7)]);
  const den = Ct.ssToTf(A7, A7.map(() => [1]), [[1, 0, 0, 0, 0, 0, 0]], [[0]]).den, fr = Ct.roots(den).map(z => Math.abs(z.im ?? z[1])).filter(v => v > 1e-6).sort((a, b) => a - b);
  const wl = fr[2], wh = fr[fr.length - 1], Os = I.OMEGA_E * Math.sin(lat);
  rel('Earth rate splits the Schuler mode: mean of the pair = ωs', (wl + wh) / 2, ws, 0.002);
  rel('…half the split = Ω·sin L (the Foucault rotation, 34 h at 45°)', (wh - wl) / 2, Os, 0.002);
  rel('…and a third mode at Earth rate Ω (the 24-hour oscillation)', fr[0], I.OMEGA_E, 1e-6);

  // ---- vertical channel ----
  const va = 1e-4 * g, kv = Math.sqrt(2 * g / R), vu = I.vertical({ T: 1800, accel: va });
  near('vertical channel time constant √(R/2g) = 9.5 min', vu.tau / 60, 9.5, 0.05, ' min');
  rel('…unaided: δh = ∇(cosh kt − 1)/k² at 30 min', vu.h[vu.h.length - 1], va * (Math.cosh(kv * 1800) - 1) / kv ** 2, 1e-6);
  const vb = I.vertical({ T: 7200, accel: va, baro: true, tau: 120, baroErr: 20 }), wn = 2 * Math.PI / 120, c2 = wn * wn + kv * kv;
  rel('…baro-aided: settles at (∇ + c₂·h_baro)/(c₂ − 2g/R)', vb.h[vb.h.length - 1], (va + c2 * 20) / (c2 - kv * kv), 1e-4);

  // ---- GNSS ----
  near('GPS orbit period: half a sidereal day (43 082 s)', I.GPS_PERIOD, 86164.0905 / 2, 10, ' s');
  const sats = I.gpsSats(5000);
  log('satellites stay on their 26 560 km orbit (Earth rotation applied)', sats.every(s => Math.abs(Math.hypot(...s.pos) - I.A_GPS) < 1e-6), '24 satellites');
  const ep = I.gnssEpoch({ lat: 40 * D, lon: -75 * D, h: 100, t: 3600, sigma: 0, clock: 1e-3, nMC: 0 });
  log('least squares from the Earth\'s centre recovers the position (< 1 mm, zero noise)', Math.hypot(...ep.fixErr) < 1e-3, `${(Math.hypot(...ep.fixErr) * 1000).toFixed(4)} mm in ${ep.fix.iter} iterations, ${ep.used.length} satellites`);
  near('…and a 1 ms receiver clock error as 299 792.458 m of range', ep.fix.x[3], 299792.458, 1e-3, ' m');
  log('…converging in at most 8 iterations', ep.fix.iter <= 8, `${ep.fix.iter}`);
  const n = 4, e = 20 * D, los = [...Array(n)].map((_, k) => { const a = k * 2 * Math.PI / n; return [Math.cos(e) * Math.sin(a), Math.cos(e) * Math.cos(a), Math.sin(e)]; }).concat([[0, 0, 1]]);
  const dp = I.dop(los), A = n * Math.sin(e) ** 2 + 1, B = n * Math.sin(e) + 1, C = n + 1, det = A * C - B * B;
  near('DOP, 4 satellites at 20° plus one overhead: HDOP = 2/(√n cos e)', dp.H, Math.sqrt(4 / (n * Math.cos(e) ** 2)), 1e-9);
  near('…VDOP from the up/clock block', dp.V, Math.sqrt(C / det), 1e-9);
  near('…TDOP from the up/clock block', dp.T, Math.sqrt(A / det), 1e-9);
  log('…vertical worse than horizontal (all satellites above you)', dp.V > dp.H, `VDOP ${dp.V.toFixed(2)}, HDOP ${dp.H.toFixed(2)}`);
  log('three satellites give no fix (4 unknowns: x, y, z and the clock)', I.dop(los.slice(0, 3)) === null, '');
  const full = I.gnssEpoch({ lat: 40 * D, lon: -75 * D, t: 3600, nMC: 0 });
  const worse = full.used.every(s => { const d = I.dop(full.used.filter(u => u !== s).map(u => u.los)); return !d || d.G >= full.dop.G - 1e-12; });
  log('removing any one satellite never improves GDOP', worse, `GDOP ${full.dop.G.toFixed(2)} with ${full.used.length}`);
  const mc = I.gnssEpoch({ lat: 40 * D, lon: -75 * D, t: 3600, sigma: 5, nMC: 1500, seed: 11 });
  const rmsH = Math.sqrt(mc.cloud.reduce((s, c) => s + c[0] ** 2 + c[1] ** 2, 0) / mc.cloud.length);
  rel('Monte Carlo horizontal RMS error = σ·HDOP', rmsH, 5 * mc.dop.H, 0.06);

  // ---- Kalman filter ----
  let x = new Float64Array([0]), P = [new Float64Array([4])]; const Rk = [[1]], P0 = 4;
  for (let k = 1; k <= 10; k++) ({ x, P } = I.kfUpdate(x, P, [1], [[1]], Rk));
  near('scalar Kalman filter: P after k updates = P₀R/(R + kP₀)', P[0][0], P0 * 1 / (1 + 10 * P0), 1e-12);
  const kf = I.insGnssKF({ lat: 45 * D, T: 3600, grade: I.GRADES.nav, gpsSigma: 5, outage: [1200, 2100], seed: 5 });
  const idx = t => kf.t.findIndex(v => v >= t), sigR = k => Math.sqrt(kf.P[k][0] + kf.P[k][13]);
  const sB = sigR(idx(1190)), sO = sigR(idx(2095)), s1 = sigR(idx(2100)), sA = sigR(idx(2110));
  log('INS/GNSS: with fixes the filter beats a single fix (σ < 5 m per axis)', Math.sqrt(kf.P[idx(1190)][0]) < 5, `${Math.sqrt(kf.P[idx(1190)][0]).toFixed(2)} m`);
  log('…uncertainty grows through a 15-minute outage', sO > 3 * sB, `${sB.toFixed(1)} → ${sO.toFixed(1)} m (radial 1σ)`);
  log('…the first fix back brings it straight down to one fix\'s accuracy (5√2 m radial)', s1 < 1.02 * 5 * Math.SQRT2, `${s1.toFixed(1)} m`);
  log('…and within 10 s it is near the pre-outage level again', sA < 3 * sB, `${sA.toFixed(1)} m vs ${sB.toFixed(1)} m before`);
  let inside = 0; kf.t.forEach((_, k) => { const ex = kf.x[k][0] - kf.xh[k][0]; if (Math.abs(ex) <= 2 * Math.sqrt(kf.P[k][0])) inside++; });
  log('…filter is consistent: north error within 2σ most of the time', inside / kf.t.length > 0.88, `${(100 * inside / kf.t.length).toFixed(0)}% of samples`);
  const hs = man => { const r = I.insGnssKF({ lat: 45 * D, T: 1800, grade: I.GRADES.tact, outage: [1e9, 1e9], manoeuvre: man, seed: 2 }); return Math.sqrt(r.P[r.P.length - 1][6 * 12 + 6]); };
  const h0 = hs(false), h1 = hs(true);
  log('heading is barely observable flying straight; S-turns reveal it', h1 < 0.5 * h0, `heading σ ${(h0 / D).toFixed(2)}° straight vs ${(h1 / D).toFixed(2)}° with S-turns`);
}
