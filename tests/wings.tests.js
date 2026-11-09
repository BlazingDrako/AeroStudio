// Wings & 3D Aero checks: lifting-line theory against Glauert's closed forms, the vortex lattice against the elliptic
// wing, Helmbold/DATCOM lift slopes and a swept-wing worked example, Trefftz-plane drag, far-wake downwash, ground effect
// against Wieselsberger, Göthert's compressibility rule, symmetry, winglets, and the nonlinear stall loop.
import * as Wg from '../js/solvers/wing.js';
import { liftSlope } from '../js/solvers/stability.js';

export function wingsTests(log) {
  const near = (name, v, ref, tol, unit = '') => log(name, Math.abs(v - ref) <= tol, `got ${(+v).toPrecision(6)}${unit}, expected ${(+ref).toPrecision(6)}${unit} (±${tol})`);
  const rel = (name, v, ref, tol) => log(name, Math.abs(v / ref - 1) <= tol, `got ${(+v).toPrecision(5)}, reference ${(+ref).toPrecision(5)} (±${(tol * 100).toFixed(1)}%), diff ${((v / ref - 1) * 100).toFixed(2)}%`);
  const wing = o => ({ ...Wg.defaults(), twist: 0, dihedral: 0, sweep: 0, root: '0012', tip: '0012', ...o, winglet: { ...Wg.defaults().winglet, ...(o.winglet || {}) } });
  const D = Math.PI / 180;

  // --- sections ---
  near('NACA 2412 zero-lift angle (thin-airfoil theory)', Wg.nacaAlpha0('2412'), -2.08, 0.05, '°');
  near('NACA 0012 zero-lift angle', Wg.nacaAlpha0('0012'), 0, 1e-12, '°');
  const ms = Wg.modelSection({ clmax: 1.4, alpha0: -2 });
  near('model section peaks at its cl,max', ms.clmax, 1.4, 0.03);
  near('model section: zero lift at α0', ms.cl(-2), 0, 1e-9);

  // --- lifting line ---
  const ell = wing({ shape: 'elliptic', S: 8, AR: 8 });
  const ll = Wg.liftingLine(ell, { alpha: 5 });
  near('lifting line, elliptic wing: CL = 2πAα/(A+2)', ll.CL, 2 * Math.PI * 8 / 10 * 5 * D, 1e-6);
  near('lifting line, elliptic wing: e = 1', ll.e, 1, 1e-6);
  near('lifting line, elliptic wing: CDi = CL²/(πA)', ll.CDi, ll.CL ** 2 / (Math.PI * 8), 1e-9);
  const llr = Wg.liftingLine(wing({ S: 6, AR: 6, taper: 1 }), { alpha: 5 });
  log('lifting line, rectangular AR 6: e ≈ 0.95 (Glauert)', llr.e > 0.93 && llr.e < 0.97, `e = ${llr.e.toFixed(4)}`);
  const llt = Wg.liftingLine(wing({ S: 6, AR: 6, taper: 0.35 }), { alpha: 5 });
  log('lifting line: taper near 0.35 is more efficient than a rectangle', llt.e > llr.e && llt.e > 0.99, `λ 0.35: e ${llt.e.toFixed(4)}, λ 1: ${llr.e.toFixed(4)}`);

  // --- vortex lattice: elliptic wing ---
  const ve = Wg.analyze(ell, { alpha: 5, nS: 30, nC: 6 });
  near('vortex lattice, elliptic wing: e ≈ 1', ve.e, 1, 0.02);
  rel('vortex lattice, elliptic wing: CLα vs lifting-surface theory (≈ 4% below lifting line at AR 8)', ve.CLa, 2 * Math.PI * 8 / 10, 0.07);
  log('vortex lattice: lifting surface gives a lower slope than lifting line', ve.CLa < 2 * Math.PI * 8 / 10, `VLM ${ve.CLa.toFixed(3)} vs LLT ${(2 * Math.PI * 0.8).toFixed(3)} /rad`);
  near('elliptic wing: lift centroid at 4/(3π) of the semi-span', ve.ycp, 4 / (3 * Math.PI), 0.01);
  const wing2 = ve.strips.filter(s => s.y > 0 && s.eta < 0.85).map(s => s.ai);
  log('elliptic wing: induced angle constant along the span within 10% (lifting-surface effects)', Math.max(...wing2) - Math.min(...wing2) < 0.1 * Math.abs(wing2[0]), `αi ${Math.min(...wing2).toFixed(3)}…${Math.max(...wing2).toFixed(3)}°`);
  const half = ve.strips.length / 2;
  log('symmetric loading left and right', ve.strips.slice(0, half).every((s, i) => Math.abs(s.G - ve.strips[ve.strips.length - 1 - i].G) < 1e-9), '');

  // --- vortex lattice vs Helmbold and a swept-wing example ---
  for (const [AR, sw, lam] of [[6, 0, 1], [8, 0, 0.5], [4, 30, 0.5], [10, 25, 0.3]]) {
    const s = Wg.analyze(wing({ S: AR, AR, taper: lam, sweep: sw }), { alpha: 4 });
    rel(`CLα, AR ${AR}, sweep ${sw}°, λ ${lam}: vortex lattice vs Helmbold/DATCOM`, s.CLa, liftSlope(AR, sw, 0), 0.05);
  }
  const bert = Wg.analyze(wing({ S: 5, AR: 5, taper: 1, sweep: 45 }), { alpha: 4, nS: 4, nC: 1, spacing: 'uniform' });
  rel('swept wing AR 5, Λ 45°, λ 1, 4 uniform panels per side: Bertin & Cummings worked example (3.443 /rad)', bert.CLa, 3.443, 0.005);
  rel('same wing on a fine lattice vs Helmbold/DATCOM', Wg.analyze(wing({ S: 5, AR: 5, taper: 1, sweep: 45 }), { alpha: 4 }).CLa, liftSlope(5, 45, 0), 0.06);
  const rect = Wg.analyze(wing({ S: 6, AR: 6, taper: 1 }), { alpha: 4 });
  near('unswept wing: aerodynamic centre near the quarter-chord of the MAC', rect.xac, 0.25, 0.03);
  const swx = Wg.analyze(wing({ S: 6, AR: 6, taper: 0.5, sweep: 30 }), { alpha: 4 });
  log('swept-back tapered wing: aerodynamic centre moves aft of the MAC quarter chord (as in DATCOM charts)', swx.xac > rect.xac && swx.xac < 0.4, `x_ac = ${swx.xac.toFixed(3)} MAC`);
  rel('lattice converges: CL with nS 16 vs 32', Wg.analyze(wing({ S: 8, AR: 8, taper: 0.4 }), { alpha: 4, nS: 16 }).CL, Wg.analyze(wing({ S: 8, AR: 8, taper: 0.4 }), { alpha: 4, nS: 32 }).CL, 0.01);
  const rl = Wg.analyze(wing({ S: 6, AR: 6, taper: 1 }), { alpha: 5, nC: 1, nS: 30 });
  log('rectangular AR 6: lattice CL a little below lifting line (which over-predicts at moderate AR)', rl.CL < llr.CL && rl.CL > 0.9 * llr.CL, `lattice ${rl.CL.toFixed(4)}, lifting line ${llr.CL.toFixed(4)}`);
  log('rectangular AR 6: lattice e between lifting line and 1 (lifting line overloads the tips)', rl.e > llr.e && rl.e < 1, `lattice ${rl.e.toFixed(4)}, lifting line ${llr.e.toFixed(4)}`);
  const tp = wing({ S: 8, AR: 8, taper: 0.4 }), tpl = Wg.analyze(tp, { alpha: 5, nC: 1, nS: 30 }), tpll = Wg.liftingLine(tp, { alpha: 5 });
  rel('tapered AR 8, λ 0.4: lattice e vs lifting line', tpl.e, tpll.e, 0.015);
  log('tapered AR 8, λ 0.4: lattice CL a little below lifting line', tpl.CL < tpll.CL && tpl.CL > 0.92 * tpll.CL, `lattice ${tpl.CL.toFixed(4)}, lifting line ${tpll.CL.toFixed(4)}`);
  near('image-sheet ground factor returns to 1 far from the ground (h/b = 10)', Wg.imageGround(10, 1), 1, 2e-3);
  const tw = Wg.analyze(wing({ S: 8, AR: 8, taper: 0.4, twist: -4 }), { alpha: 0 });
  log('washout: zero-lift angle of the wing rises above 0', tw.alphaL0 > 0.5, `α(L=0) = ${tw.alphaL0.toFixed(2)}°`);
  near('cambered wing (2412): α(L=0) equals the section α0', Wg.analyze(wing({ S: 8, AR: 8, root: '2412', tip: '2412' }), { alpha: 2 }).alphaL0, Wg.nacaAlpha0('2412'), 0.02, '°');

  // --- downwash ---
  const far = 50 * ve.P.b;
  const e1 = Wg.downwash(ve, [far, 0, 0]);
  near('elliptic wing: far-wake downwash = 2CL/(πA) (twice that at the wing)', e1 * D, 2 * ve.CL / (Math.PI * 8), 0.02 * 2 * ve.CL / (Math.PI * 8));
  const v1 = Wg.analyze(ell, { alpha: 5, nS: 30, nC: 1 });
  const ec = Wg.downwash(v1, [v1.P.cr * 0.25, 0.3 * v1.P.s + 0.37 * v1.P.s / 30, 0]);
  log('downwash on the lifting line is about half the far-wake value', Math.abs(ec / Wg.downwash(v1, [far, 0, 0]) - 0.5) < 0.06, `ratio ${(ec / Wg.downwash(v1, [far, 0, 0])).toFixed(3)}`);

  // --- ground effect ---
  const gW = wing({ S: 8, AR: 8, taper: 0.5 });
  const free = Wg.analyze(gW, { alpha: 4 });
  for (const hb of [0.1, 0.2]) {
    const g = Wg.analyze(gW, { alpha: 4, ground: hb * free.P.b });
    const kFree = free.CDi / free.CL ** 2, kG = g.CDi / g.CL ** 2;
    rel(`ground effect at h/b = ${hb}: induced-drag factor vs the image lifting line`, kG / kFree, Wg.imageGround(hb * free.P.b, free.P.b), 0.03);
    log(`ground effect at h/b = ${hb}: stronger than Wieselsberger's empirical fit`, kG / kFree < Wg.wieselsberger(hb * free.P.b, free.P.b), `${(kG / kFree).toFixed(3)} vs ${Wg.wieselsberger(hb * free.P.b, free.P.b).toFixed(3)}`);
    log(`ground effect at h/b = ${hb}: lift slope rises`, g.CLa > free.CLa, `${g.CLa.toFixed(3)} vs ${free.CLa.toFixed(3)} /rad`);
  }

  // --- compressibility ---
  for (const [AR, sw] of [[8, 0], [6, 30]]) {
    const w = wing({ S: AR, AR, taper: 0.5, sweep: sw });
    const r = Wg.analyze(w, { alpha: 3, M: 0.6 }).CLa / Wg.analyze(w, { alpha: 3, M: 0 }).CLa;
    rel(`Göthert's rule at M 0.6 (AR ${AR}, ${sw}°): slope ratio vs Helmbold`, r, liftSlope(AR, sw, 0.6) / liftSlope(AR, sw, 0), 0.03);
  }

  // --- winglets ---
  const base = wing({ S: 8, AR: 8, taper: 0.4 });
  const s0 = Wg.analyze(base, { alpha: 4 });
  const wl = { ...base, winglet: { on: true, h: 0.15, cant: 0, taper: 0.5, sweep: 30 } };
  const s1 = Wg.analyze(wl, { alpha: 4 });
  const k0 = s0.CDi / s0.CL ** 2, k1 = s1.CDi / s1.CL ** 2;
  log('winglet lowers induced drag at the same lift', k1 < k0 * 0.97, `CDi/CL² ${k1.toFixed(5)} vs ${k0.toFixed(5)} (${((k1 / k0 - 1) * 100).toFixed(1)}%)`);
  log('winglet carries inboard side force', s1.strips.some(s => s.part === 'winglet' && s.G > 0), '');
  const ext = Wg.equalMomentExtension(base, s1, { alpha: 4 });
  near('equal-moment span extension matches the root bending moment', ext.Mb / s1.Mb, 1, 0.01);
  const flat = { ...base, winglet: { on: true, h: 0.15, cant: 90, taper: 1, sweep: 0 } };
  const big = { ...base, S: 8 * 1.15, AR: (Wg.planform(base).b * 1.15) ** 2 / (8 * 1.15) };
  log('a fully canted (90°) winglet acts like a span extension', Math.abs(Wg.analyze(flat, { alpha: 4 }).CDi / Wg.analyze(flat, { alpha: 4 }).CL ** 2 - Wg.analyze(big, { alpha: 4 }).CDi * big.S / 8 / (Wg.analyze(big, { alpha: 4 }).CL * big.S / 8) ** 2) / k0 < 0.08, '');

  // --- nonlinear strips ---
  const lin = sect => () => ({ cl: a => 2 * Math.PI / (1) * (a) * D, cd: () => 0.01, alphaStall: 90, clmax: 99, a: 2 * Math.PI });
  const nl = Wg.nonlinear(base, { alpha: 5, sect: lin() });
  const ln = Wg.solveLattice(Wg.lattice(base, { nS: 20, nC: 1 }), 5);
  rel('nonlinear loop with a thin-airfoil section reproduces the linear lattice', nl.CL, ln.CL, 0.002);
  const ms12 = (eta) => Wg.modelSection({ clmax: 1.4, alpha0: 0 });
  const r1 = Wg.sweepAlpha(wing({ S: 6, AR: 6, taper: 1 }), { a0: 0, a1: 20, step: 1, sect: ms12 });
  log('rectangular wing stalls first near the root', r1.firstStall && r1.firstStall.eta < 0.4, r1.firstStall ? `first stall at η ${r1.firstStall.eta.toFixed(2)}, α ${r1.firstStall.alpha}°` : 'no stall');
  log('wing CLmax is below the section cl,max', r1.CLmax < 1.4 && r1.CLmax > 1.0, `CLmax ${r1.CLmax.toFixed(3)} at ${r1.alphaCLmax}°`);
  const r2 = Wg.sweepAlpha(wing({ S: 8, AR: 8, taper: 0.2 }), { a0: 0, a1: 20, step: 1, sect: ms12 });
  log('highly tapered wing stalls first near the tip', r2.firstStall && r2.firstStall.eta > 0.55, r2.firstStall ? `η ${r2.firstStall.eta.toFixed(2)}` : 'no stall');
  const r3 = Wg.sweepAlpha(wing({ S: 8, AR: 8, taper: 0.2, twist: -6 }), { a0: 0, a1: 30, step: 1, sect: ms12 });
  log('washout moves the first stall inboard', r3.firstStall && r3.firstStall.eta < r2.firstStall.eta, r3.firstStall ? `η ${r3.firstStall.eta.toFixed(2)} vs ${r2.firstStall.eta.toFixed(2)}` : 'no stall');
  const r4 = Wg.sweepAlpha(wing({ S: 10, AR: 6, taper: 0.4, sweep: 35 }), { a0: 0, a1: 30, step: 1, sect: ms12 });
  log('swept-back wing stalls first outboard', r4.firstStall && r4.firstStall.eta > 0.5, r4.firstStall ? `η ${r4.firstStall.eta.toFixed(2)}` : 'no stall');
  const r5 = Wg.sweepAlpha(wing({ S: 10, AR: 7, taper: 0.4, sweep: -25 }), { a0: 0, a1: 30, step: 1, sect: ms12 });
  log('forward-swept wing stalls first inboard', r5.firstStall && r4.firstStall && r5.firstStall.eta < r4.firstStall.eta, r5.firstStall ? `η ${r5.firstStall.eta.toFixed(2)}` : 'no stall');

  // --- roll-up ---
  const ru = Wg.rollup(ve, { spans: 4, frames: 20 });
  const last = ru[ru.length - 1];
  log('wake roll-up keeps the sheet symmetric', Math.abs(last.y[0] + last.y[last.y.length - 1]) < 1e-6 * ve.P.b, '');
  const tipY = Math.abs(last.y[last.y.length - 1]) / ve.P.s;
  log('tip vortex moves inboard as the sheet rolls up (towards π/4 of the semi-span)', tipY < 1 && tipY > 0.6, `tip at ${tipY.toFixed(3)} s`);
  log('the wake descends', last.z[Math.floor(last.z.length / 2)] < 0, `centre z ${last.z[Math.floor(last.z.length / 2)].toFixed(4)} m`);
}
