// Flow scenarios for the Shocks & Expansions tab. Each builder returns a FieldStage scene plus
// results: regions (table), metrics, insights, and optional surface-pressure plot data.
// Supersonic flows use exact oblique-shock / Prandtl–Meyer relations (shock-expansion theory);
// subsonic flows use linearized Prandtl–Glauert thin-body theory (or potential flow for the blunt body).
import * as G from '../../solvers/gasdyn.js';
import { poly, line, label, arrow, arcAngle, body } from './field.js';
import { solveSupersonic, sharpAirfoil, explainFailure } from '../../solvers/supersonic.js';
import { drawSupersonicTheory } from './supersonicDraw.js';

const { isen, DEG } = G;
const deg = r => (r / DEG).toFixed(2) + '°';

// state relative to freestream static, given local Mach, flow angle and p0/p0∞
function mkState(M, th, p0r, F) {
  const T = isen.T0_T(F.M, F.g) / isen.T0_T(M, F.g);
  const p = p0r * isen.p0_p(F.M, F.g) / isen.p0_p(M, F.g);
  return { M, th, p, T, rho: p / T, p0: p0r };
}
// state from local velocity ratio V/V∞ (isentropic, subsonic potential flows)
function velState(u, v, F) {
  const V2 = u * u + v * v, g = F.g;
  let T = 1 + 0.5 * (g - 1) * F.M * F.M * (1 - V2);
  T = Math.max(T, 0.05);
  const M = Math.sqrt(V2) * F.M / Math.sqrt(T), p = T ** (g / (g - 1));
  return { M, th: Math.atan2(v, u), p, T, rho: p / T, p0: 1 };
}

// ---------- supersonic wave engine for a wall with flow on its upper (left-of-travel) side ----------
// corners: [{x, y, thAfter}]; returns wave list with downstream states.
function buildWaves(corners, up, F) {
  const waves = [];
  let s = up;
  for (const c of corners) {
    const dth = c.thAfter - s.th;
    if (Math.abs(dth) < 1e-10) { waves.push({ ...c, type: 'none', up: s, down: s }); continue; }
    if (s.M <= 1) { waves.push({ ...c, type: 'subsonic', up: s, down: s, dth }); break; }
    if (dth > 0) {
      const b = G.betaFromTheta(s.M, dth, F.g, F.strong && waves.length === 0 ? 'strong' : 'weak');
      if (isNaN(b)) { waves.push({ ...c, type: 'detached', up: s, dth, thetaMax: G.thetaMax(s.M, F.g) }); break; }
      const os = G.obliqueShock(s.M, b, F.g);
      const down = mkState(os.M2, c.thAfter, s.p0 * os.p02_p01, F);
      waves.push({ ...c, type: 'shock', up: s, down, beta: b, ray: s.th + b, dth, os });
      s = down;
    } else {
      const nu1 = isen.nu(s.M, F.g), nu2 = nu1 - dth;
      if (nu2 >= isen.numax(F.g)) { waves.push({ ...c, type: 'vacuum', up: s, dth }); break; }
      const M2 = G.M_from_nu(nu2, F.g);
      const down = mkState(M2, c.thAfter, s.p0, F);
      const K = nu1 + s.th;
      waves.push({ ...c, type: 'fan', up: s, down, a1: s.th + isen.mu(s.M), a2: c.thAfter + isen.mu(M2), K, p0: s.p0, dth });
      s = down;
    }
  }
  return waves;
}
function fanState(w, a, F) {
  // inside fan: ray angle a = θ + μ with ν + θ = K
  const M = G.bisect(M => (w.K - isen.nu(M, F.g)) + Math.asin(1 / M) - a, w.up.M, w.down.M, 1e-7, 60);
  return isFinite(M) ? mkState(M, w.K - isen.nu(M, F.g), w.p0, F) : (a > 0.5 * (w.a1 + w.a2) ? w.up : w.down);
}
// ray angle from a wave origin; points behind-left of the origin wrap to > π so they count as "ahead"
const rayAng = (x, y, w) => { const a = Math.atan2(y - w.y, x - w.x); return a < -0.5 * Math.PI ? a + 2 * Math.PI : a; };
// is (x, y) on the downstream (clockwise) side of a traced shock polyline?
// The path runs left to right (shock angles stay below 90°), so it is a function y(x): behind = below it.
function behindPath(path, x, y) {
  const P = path.pts, n = P.length;
  if (x <= P[0].x) return rayAng(x, y, P[0]) < path.ang0;
  let i = 0;
  if (x >= P[n - 1].x) i = n - 2;
  else { let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m].x <= x) lo = m; else hi = m; } i = lo; }
  const A = P[i], B = P[i + 1];
  return y < A.y + (x - A.x) * (B.y - A.y) / ((B.x - A.x) || 1e-12);
}
function classify(x, y, waves, up, F) {
  let s = up;
  for (let k = 0; k < waves.length; k++) {
    const w = waves[k];
    if (w.type === 'none') { s = w.down; continue; }
    if (w.type === 'shock') {
      if (w.path ? behindPath(w.path, x, y) : rayAng(x, y, w) < w.ray) s = w.down; else return s;
      continue;
    }
    const a = rayAng(x, y, w);
    if (w.type === 'fan') {
      if (a <= w.a2) s = w.down;
      else if (a < w.a1) return fanState(w, a, F);
      else return s;
    } else return s;
  }
  return s;
}
// Bend the leading shock where later waves (e.g. a shoulder expansion fan) catch up with it: march it
// outward, at each step using the local flow direction behind it to pick the oblique-shock angle. The
// fan weakens the shock until it fades into a Mach wave. Reflected waves from the interaction are ignored.
function traceLeadShock(waves, F, Lmax) {
  const w = waves[0];
  if (!w || w.type !== 'shock' || waves.length < 2) return;
  const rest = waves.slice(1), ds = Lmax / 400, pts = [{ x: w.x, y: w.y }];
  let ang = w.ray, x = w.x, y = w.y;
  for (let i = 0; i < 400; i++) {
    x += ds * Math.cos(ang); y += ds * Math.sin(ang); pts.push({ x, y });
    const d = classify(x, y, rest, w.down, F);
    const turn = d.th - w.up.th;
    const b = turn > 1e-9 ? G.betaFromTheta(w.up.M, turn, F.g) : Math.asin(1 / w.up.M);
    if (isFinite(b)) ang = w.up.th + b;
  }
  w.path = { pts, ang0: w.ray };
}
// length along a ray from (ox, oy) at angle a until it meets a traced shock path
function clipRay(path, ox, oy, a, Lmax) {
  if (!path) return Lmax;
  const c = Math.cos(a), s = Math.sin(a), P = path.pts;
  let best = Lmax;
  for (let i = 0; i < P.length - 1; i++) {
    const ax = P[i].x, ay = P[i].y, ex = P[i + 1].x - ax, ey = P[i + 1].y - ay, den = c * ey - s * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((ax - ox) * ey - (ay - oy) * ex) / den, u = ((ax - ox) * s - (ay - oy) * c) / den;
    if (t > 1e-6 && u >= 0 && u <= 1 && t < best) { best = t; break; }
  }
  return best;
}
const mirror = s => s && { ...s, th: -s.th };
// draw waves of one surface (sign = +1 upper, -1 mirrored lower)
function drawWaves(ctx, waves, sign, L, F, { maxRays = 7 } = {}) {
  if (!ctx.layers.waves) return;
  const shockCol = ctx.fieldOn || ctx.dark ? '#ffffff' : '#111', fanCol = ctx.fieldOn || ctx.dark ? 'rgba(255,255,255,0.7)' : 'rgba(20,24,33,0.55)';
  const lead = waves[0] && waves[0].path;
  for (const w of waves) {
    const P = { x: w.x, y: sign * w.y };
    if (w.type === 'shock') {
      if (w.path) poly(ctx, w.path.pts.map(p => ({ x: p.x, y: sign * p.y })), { stroke: shockCol, width: 2.6, close: false });
      else { const Ls = w === waves[0] ? L : clipRay(lead, w.x, w.y, w.ray, L); line(ctx, P, { x: w.x + Ls * Math.cos(w.ray), y: sign * (w.y + Ls * Math.sin(w.ray)) }, shockCol, 2.6); }
    }
    if (w.type === 'fan') {
      for (let k = 0; k < maxRays; k++) {
        const a = w.a1 + (w.a2 - w.a1) * k / (maxRays - 1), Lr = w === waves[0] ? L : clipRay(lead, w.x, w.y, a, L);
        { const edge = k === 0 || k === maxRays - 1; ctx.g.globalAlpha = edge ? 1 : 0.45; line(ctx, P, { x: w.x + Lr * Math.cos(a), y: sign * (w.y + Lr * Math.sin(a)) }, fanCol, edge ? 1.2 : 0.7); ctx.g.globalAlpha = 1; }
      }
    }
  }
}

// ---------- subsonic linear (Prandtl–Glauert) thin-body theory ----------
// segs: [{a, b, s}] wall slope s on [a, b] for the thickness part (upper side; symmetric below if symmetric=true)
// Complex log helpers
const clog = (re, im) => [0.5 * Math.log(re * re + im * im), Math.atan2(im, re)];
function linearPerturb(x, y, segs, F, { symmetric = false, alpha = 0, plate = null } = {}) {
  const beta = Math.sqrt(Math.max(1e-4, 1 - F.M * F.M));
  const sgn = y >= 0 || !symmetric ? 1 : -1;
  // one-sided walls: points that dip below y = 0 (e.g. past an expansion step) take the y = 0+ value
  const Y = beta * (symmetric ? Math.abs(y) : Math.max(y, 0)) + 1e-9;
  // F(Z) = (1/π) ∫ (−s/β) / (ξ − Z) dξ = −(s/(πβ)) [log(b − Z) − log(a − Z)]
  let Fr = 0, Fi = 0;
  for (const g of segs) {
    const [lb, ab] = clog(g.b - x, -Y), [la, aa] = clog(g.a - x, -Y);
    const k = -g.s / (Math.PI * beta);
    Fr += k * (lb - la); Fi += k * (ab - aa);
  }
  let u = Fr, v = -beta * Fi;
  if (symmetric && sgn < 0) v = -v; // thickness: u symmetric, v antisymmetric
  if (plate) {
    // flat-plate lifting solution on [0,c]: F = −i (α/β) (sqrt((Z−c)/Z) − 1) in stretched coordinates
    const c = plate.c, zr = x, zi = sgn * Y;
    // w = (Z − c)/Z
    const d = zr * zr + zi * zi, wr = ((zr - c) * zr + zi * zi) / d, wi = (zi * zr - (zr - c) * zi) / d;
    // principal sqrt
    const m = Math.hypot(wr, wi), sr = Math.sqrt(0.5 * (m + wr)), si = Math.sign(wi || 1) * Math.sqrt(Math.max(0, 0.5 * (m - wr)));
    const k = alpha / beta;
    // −i k (s − 1) = k si + i(−k (sr − 1))  → Fr += k si, Fi += −k (sr − 1)
    const Lr = k * si, Li = -k * (sr - 1);
    u += Lr; v += -beta * Li;
  }
  return [u, v];
}

// ---------- scenario builders ----------
export const SCENARIOS = [
  { id: 'normal', label: 'Normal shock (duct)' },
  { id: 'ramp', label: 'Compression ramp / wedge (oblique shock)' },
  { id: 'corner', label: 'Expansion corner (Prandtl–Meyer fan)' },
  { id: 'isocomp', label: 'Isentropic compression (waves → shock)' },
  { id: 'wedge', label: 'Wedge with shoulder (shock + fan)' },
  { id: 'diamond', label: 'Diamond airfoil at angle of attack' },
  { id: 'blunt', label: 'Blunt body (bow shock)' },
  { id: 'reflect', label: 'Shock reflection from a wall' },
  { id: 'cone', label: 'Sound waves & Mach cone' },
];

export function buildScene(id, P) {
  const F = { M: P.M, g: P.g, strong: P.strong };
  const free = { M: F.M, th: 0, p: 1, T: 1, rho: 1, p0: 1 };
  const sup = F.M > 1;
  const R = { regions: [], metrics: [], insights: [], cp: null };
  const speed = 1 / Math.max(F.M, 0.15);
  const spawnLeft = (b, yFn) => (init) => ({ x: init ? b.x0 + Math.random() * (b.x1 - b.x0) : b.x0 + Math.random() * 0.05 * (b.x1 - b.x0), y: yFn ? yFn() : b.y0 + Math.random() * (b.y1 - b.y0) });
  const seedsLeft = (b, n, y0 = b.y0, y1 = b.y1) => () => Array.from({ length: n }, (_, i) => ({ x: b.x0 + 1e-3, y: y0 + (y1 - y0) * (i + 0.5) / n }));
  const subNote = () => R.insights.push({ type: 'i', t: 'Subsonic: no shock waves', d: `At M∞ = ${F.M.toFixed(2)} pressure signals travel upstream faster than the flow (a > V), so the air "hears" the body coming and turns smoothly. Shocks need M > 1. Flow shown with linearized Prandtl–Glauert theory.` });
  const critCheck = (maxM) => { if (maxM > 1) R.insights.push({ type: 'w', t: 'Locally supersonic', d: `Peak local Mach ≈ ${maxM.toFixed(2)} > 1: the free stream is above the critical Mach number. Real flow would form a supersonic pocket ending in a shock (transonic flow), which linear theory can't capture.` }); };

  if (id === 'normal') {
    const b = { x0: -3, x1: 3, y0: -1.1, y1: 1.1 };
    const ns = sup ? G.normalShock(F.M, F.g) : null;
    R.cfd = { polys: [[{ x: -60, y: 1 }, { x: 60, y: 1 }, { x: 60, y: 30 }, { x: -60, y: 30 }], [{ x: -60, y: -1 }, { x: 60, y: -1 }, { x: 60, y: -30 }, { x: -60, y: -30 }]],
      pback: ns ? ns.p2_p1 / F.g : 1 / F.g, init: ns ? (x => x < 0 ? null : [ns.rho2_rho1, F.M / ns.rho2_rho1, 0, ns.p2_p1 / F.g]) : null };
    const s2 = ns ? mkState(ns.M2, 0, ns.p02_p01, F) : free;
    R.regions.push({ name: '1 · upstream', s: free }, ...(ns ? [{ name: '2 · downstream', s: s2 }] : []));
    if (ns) {
      R.metrics.push({ k: 'M₂', v: ns.M2.toFixed(4) }, { k: 'p₂/p₁', v: ns.p2_p1.toFixed(4) }, { k: 'T₂/T₁', v: ns.T2_T1.toFixed(4) }, { k: 'ρ₂/ρ₁ = u₁/u₂', v: ns.rho2_rho1.toFixed(4) }, { k: 'p₀₂/p₀₁', v: ns.p02_p01.toFixed(4) }, { k: 'Δs/R', v: ns.ds_R.toFixed(4) });
      R.insights.push({ type: 'i', t: 'Supersonic → subsonic in a jump', d: `The flow crosses the shock in a few mean free paths: speed drops ${ns.rho2_rho1.toFixed(2)}×, pressure rises ${ns.p2_p1.toFixed(2)}×. Downstream is always subsonic (M₂ = ${ns.M2.toFixed(3)}).` });
      R.insights.push({ type: ns.p02_p01 < 0.9 ? 'w' : 'g', t: `Total-pressure loss ${(100 * (1 - ns.p02_p01)).toFixed(1)}%`, d: 'Shocks are irreversible: entropy rises and stagnation pressure falls. That lost p₀ is why supersonic inlets use several weak oblique shocks instead of one strong normal shock.' });
    } else {
      R.insights.push({ type: 'b', t: 'No normal shock below M = 1', d: 'An "expansion shock" (subsonic → supersonic jump) would decrease entropy, violating the second law. A stationary normal shock needs M₁ > 1.' });
    }
    return { ...R, scene: {
      bounds: b, speed, ranges: null,
      sample: (x, y) => (Math.abs(y) > 1 ? null : (x < 0 || !ns) ? free : s2),
      spawn: spawnLeft(b, () => -0.95 + 1.9 * Math.random()), seeds: seedsLeft(b, 9, -0.9, 0.9),
      draw: ctx => {
        const wall = ctx.css('--border-strong');
        body(ctx, [{ x: b.x0 - 40, y: 1 }, { x: b.x1 + 40, y: 1 }, { x: b.x1 + 40, y: 1.1 }, { x: b.x0 - 40, y: 1.1 }]);
        body(ctx, [{ x: b.x0 - 40, y: -1 }, { x: b.x1 + 40, y: -1 }, { x: b.x1 + 40, y: -1.1 }, { x: b.x0 - 40, y: -1.1 }]);
        if (ns && ctx.layers.waves) line(ctx, { x: 0, y: -1 }, { x: 0, y: 1 }, ctx.fieldOn || ctx.dark ? '#fff' : '#111', 3);
        label(ctx, { x: -1.5, y: 0.7 }, `M₁ = ${F.M.toFixed(2)}`, { align: 'center' });
        if (ns) label(ctx, { x: 1.5, y: 0.7 }, `M₂ = ${ns.M2.toFixed(3)}`, { align: 'center' });
        if (ns) label(ctx, { x: 0, y: -0.75 }, 'normal shock', { align: 'center' });
      },
    } };
  }

  if (id === 'ramp' || id === 'corner') {
    const th = P.angle * DEG * (id === 'corner' ? -1 : 1);
    const L = 4, b = id === 'ramp' ? { x0: -1.6, x1: 4.2, y0: -0.25, y1: 3 } : { x0: -1.6, x1: 4.2, y0: -2.2, y1: 2 };
    const wallY = x => x <= 0 ? 0 : x * Math.tan(th);
    const bodyPoly = [{ x: b.x0 - 1, y: 0 }, { x: 0, y: 0 }, { x: L + 40, y: (L + 40) * Math.tan(th) }, { x: L + 40, y: b.y0 - 40 }, { x: b.x0 - 1, y: b.y0 - 40 }];
    R.cfd = { polys: [[{ x: b.x0 - 60, y: 0 }, { x: 0, y: 0 }, { x: 60, y: 60 * Math.tan(th) }, { x: 60, y: -80 }, { x: b.x0 - 60, y: -80 }]] };
    let sample, drawExtra = () => { }, seeds;
    if (sup) {
      const waves = buildWaves([{ x: 0, y: 0, thAfter: th }], free, F);
      const w = waves[0];
      if (w.type === 'detached') {
        // detached shock: Billig-type shape standing off the corner (schematic)
        const Rn = 0.5, Mloc = F.M;
        const det = detachedShape(Mloc, F.g, 0, 0, Rn);
        R.regions.push({ name: '1 · free stream', s: free });
        const sNose = mkState(G.normalShock(F.M, F.g).M2, 0, G.normalShock(F.M, F.g).p02_p01, F);
        R.regions.push({ name: '2 · behind normal part', s: sNose, note: 'subsonic pocket' });
        R.metrics.push({ k: 'θ', v: deg(th) }, { k: 'θmax', v: deg(w.thetaMax) }, { k: 'Shock', v: 'detached' }, { k: 'Stand-off', v: '≈ ' + det.delta.toFixed(2) + ' (schematic)' });
        R.insights.push({ type: 'b', t: 'Shock detaches', d: `θ = ${deg(th)} exceeds θmax = ${deg(w.thetaMax)} at M = ${F.M.toFixed(2)}. No straight attached shock can turn the flow that much, so a curved bow shock stands ahead of the corner with a subsonic region behind it. Raise M or lower θ to reattach.` });
        sample = (x, y) => {
          if (y < wallY(x)) return null;
          const xs = det.xs(y);
          if (x < xs) return free;
          return det.post(y, F, mkState);
        };
        drawExtra = ctx => {
          if (ctx.layers.waves) poly(ctx, det.pts(b.y1 + 0.3), { stroke: ctx.fieldOn || ctx.dark ? '#fff' : '#111', width: 2.6, close: false });
          if (det.xs(b.y1) < b.x0) label(ctx, { x: b.x0 + 0.3, y: b.y1 - 0.75 }, '← bow shock stands further upstream (off view)');
        };
      } else {
        R.regions.push({ name: '1 · free stream', s: free }, ...(w.down && w.type !== 'none' ? [{ name: '2 · after ' + (w.type === 'shock' ? 'shock' : 'fan'), s: w.down }] : []));
        if (w.type === 'shock') {
          R.metrics.push({ k: 'Shock angle β', v: deg(w.beta), s: w.beta > G.betaMax(F.M, F.g) ? 'strong solution' : 'weak solution' }, { k: 'M₂', v: w.down.M.toFixed(4) }, { k: 'p₂/p₁', v: w.os.p2_p1.toFixed(4) }, { k: 'T₂/T₁', v: w.os.T2_T1.toFixed(4) }, { k: 'p₀₂/p₀₁', v: w.os.p02_p01.toFixed(4) }, { k: 'θmax', v: deg(w.os.thetaMax) });
          R.insights.push({ type: 'i', t: 'Oblique shock turns the flow', d: `The ramp deflects the flow by θ = ${deg(th)}. Only the normal component (Mn₁ = ${w.os.Mn1.toFixed(3)}) is shocked; the tangential velocity is unchanged, so M₂ = ${w.down.M.toFixed(3)} ${w.down.M > 1 ? 'stays supersonic' : 'is subsonic (strong shock)'}.` });
          if (F.strong) R.insights.push({ type: 'w', t: 'Strong-shock branch', d: 'This solution is allowed by the equations but appears only when the downstream pressure is forced high (e.g., in a confined duct). Free ramps produce the weak shock.' });
          if (th > 0.85 * w.os.thetaMax) R.insights.push({ type: 'w', t: 'Close to detachment', d: `θ is ${(100 * th / w.os.thetaMax).toFixed(0)}% of θmax. A little more turning (or a little less Mach) and the shock pops off the corner.` });
        } else if (w.type === 'fan') {
          R.metrics.push({ k: 'Turn angle', v: deg(-th) }, { k: 'ν₁ → ν₂', v: `${deg(isen.nu(F.M, F.g))} → ${deg(isen.nu(w.down.M, F.g))}` }, { k: 'M₂', v: w.down.M.toFixed(4) }, { k: 'p₂/p₁', v: w.down.p.toFixed(4) }, { k: 'Fan head μ₁', v: deg(isen.mu(F.M)) }, { k: 'Fan tail μ₂−|θ|', v: deg(w.a2) });
          R.insights.push({ type: 'i', t: 'Expansion fan: smooth, isentropic', d: `A continuous fan of Mach waves centred on the corner accelerates the flow from M ${F.M.toFixed(2)} to ${w.down.M.toFixed(3)}. Total pressure is unchanged — expansions are reversible, unlike shocks.` });
        } else if (w.type === 'vacuum') {
          R.insights.push({ type: 'b', t: 'Turn exceeds ν_max', d: `The flow can turn at most ν_max − ν₁ = ${deg(isen.numax(F.g) - isen.nu(F.M, F.g))}. Beyond that it expands to vacuum and separates from the wall.` });
        }
        sample = (x, y) => (y < wallY(x) ? null : classify(x, y, waves, free, F));
        drawExtra = ctx => drawWaves(ctx, waves, 1, 8, F);
      }
    } else {
      subNote();
      const segs = [{ a: 0, b: L, s: Math.tan(th) }];
      const yb = x => (x <= 0 ? 0 : x >= L ? L * Math.tan(th) : x * Math.tan(th));
      let maxM = 0;
      sample = (x, y) => {
        if (y < yb(x) - 1e-9) return null;
        const pv = linearPerturb(x, y, segs, F);
        const s = velState(1 + Math.max(-0.9, Math.min(1.5, pv[0])), pv[1], F);
        if (s.M > maxM) maxM = s.M;
        return s;
      };
      for (let x = 0.01; x < L; x += 0.05) sample(x, yb(x) + 0.02);
      critCheck(maxM);
      R.regions.push({ name: 'free stream', s: free });
      R.metrics.push({ k: 'Peak local M', v: maxM.toFixed(3) }, { k: 'PG factor 1/β', v: F.M < 0.999 ? (1 / Math.sqrt(1 - F.M * F.M)).toFixed(3) : '∞', s: F.M < 0.999 ? '' : 'linear theory breaks down at M = 1' });
      bodyPoly.splice(2, 1, { x: L, y: L * Math.tan(th) }, { x: L + 3, y: L * Math.tan(th) });
      bodyPoly[3] = { x: L + 3, y: L * Math.tan(th) }; bodyPoly.splice(4, 0, { x: L + 3, y: b.y0 - 2 });
    }
    seeds = () => Array.from({ length: 12 }, (_, i) => ({ x: b.x0 + 1e-3, y: (id === 'ramp' ? 0.05 : -0.0) + 0.02 + (b.y1 - 0.1) * (i + 0.5) / 12 }));
    const drawBody = ctx => {
      if (!sup) { const Lt = L * Math.tan(th); body(ctx, [{ x: b.x0 - 1, y: 0 }, { x: 0, y: 0 }, { x: L, y: Lt }, { x: b.x1 + 40, y: Lt }, { x: b.x1 + 40, y: b.y0 - 3 }, { x: b.x0 - 1, y: b.y0 - 3 }]); }
      else body(ctx, bodyPoly);
    };
    return { ...R, scene: {
      bounds: b, speed, sample, seeds,
      spawn: init => { const x = init ? b.x0 + Math.random() * (b.x1 - b.x0) : b.x0 + 0.02; return { x, y: Math.max(wallY(x), 0) + 0.02 + Math.random() * (b.y1 - Math.max(wallY(x), 0)) }; },
      draw: ctx => {
        drawExtra(ctx); drawBody(ctx);
        arcAngle(ctx, { x: 0, y: 0 }, 46, Math.min(0, th), Math.max(0, th), ctx.fieldOn || ctx.dark ? '#fff' : '#333', `θ=${Math.abs(P.angle).toFixed(1)}°`);
        label(ctx, { x: b.x0 + 0.3, y: b.y1 - 0.3 }, `M∞ = ${F.M.toFixed(2)}`);
        if (R.regions[1]) label(ctx, { x: 3.2, y: id === 'ramp' ? 3.2 * Math.tan(th) + 0.35 : Math.max(-1.6, 3.2 * Math.tan(th) + 0.35) }, `M₂ = ${R.regions[1].s.M.toFixed(2)}`, { align: 'center' });
      },
    } };
  }

  if (id === 'isocomp') {
    const thT = P.angle * DEG, L = 3, b = { x0: -1, x1: 6, y0: -0.3, y1: 3.8 };
    const smooth = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
    const thw = x => thT * smooth(x / L);
    const N = 400, wx = [], wy = []; let yy = 0;
    for (let i = 0; i <= N; i++) { const x = L * i / N; if (i) yy += Math.tan(0.5 * (thw(x) + thw(L * (i - 1) / N))) * L / N; wx.push(x); wy.push(yy); }
    const yw = x => x <= 0 ? 0 : x >= L ? wy[N] + (x - L) * Math.tan(thT) : wy[Math.round(x / L * N)];
    const wallShape = [{ x: b.x0 - 1, y: 0 }, ...wx.map((x, i) => ({ x, y: wy[i] })), { x: b.x1 + 40, y: yw(b.x1 + 40) }, { x: b.x1 + 40, y: -40 }, { x: b.x0 - 40, y: -40 }];
    R.cfd = { polys: [wallShape] };
    if (!sup) {
      subNote();
      const segs = []; for (let i = 0; i < 40; i++) { const a = L * i / 40, c = L * (i + 1) / 40; segs.push({ a, b: c, s: Math.tan(thw(0.5 * (a + c))) }); }
      segs.push({ a: L, b: 60, s: Math.tan(thT) });
      R.regions.push({ name: 'free stream', s: free });
      return { ...R, scene: { bounds: b, speed, sample: (x, y) => { if (y < yw(x)) return null; const pv = linearPerturb(x, y, segs, F); return velState(1 + Math.max(-0.9, Math.min(1.5, pv[0])), pv[1], F); },
        spawn: init => { const x = init ? b.x0 + Math.random() * 7 : b.x0 + 0.02; return { x, y: Math.max(0, yw(x)) + 0.03 + Math.random() * 3.6 }; },
        seeds: () => Array.from({ length: 12 }, (_, i) => ({ x: b.x0 + 1e-3, y: 0.05 + 3.6 * (i + 0.5) / 12 })),
        draw: ctx => { body(ctx, wallShape); label(ctx, { x: b.x0 + 0.3, y: b.y1 - 0.3 }, `M∞ = ${F.M.toFixed(2)}`); } } };
    }
    // simple-wave region: ν = ν∞ − θw; each wall point sends a straight Mach wave at θ + μ
    const nu0 = isen.nu(F.M, F.g);
    const thFinal = thT;
    if (nu0 - thFinal <= 0) {
      R.insights.push({ type: 'b', t: 'Too much turning', d: `An isentropic compression can only slow the flow to M = 1 (turn ≤ ν∞ = ${deg(nu0)}). Lower the turning or raise M∞.` });
    }
    const wave = i => { const th = thw(wx[i]), nu = Math.max(1e-6, nu0 - th), M = G.M_from_nu(nu, F.g); const ang = th + Math.asin(1 / M); return { x: wx[i], y: wy[i], th, M, ang, c: Math.cos(ang), s: Math.sin(ang), st: mkState(M, th, 1, F) }; };
    const W = []; for (let i = 0; i <= N; i += 4) W.push(wave(i));
    const nW = W.length;
    // f > 0: point is ahead of (above) wave k
    const side = (k, x, y) => { const w = W[k]; return (y - w.y) * w.c - (x - w.x) * w.s; };
    // where neighbouring waves first cross: the shock starts here (cusp of the envelope)
    let cusp = null;
    for (let i = 1; i < nW; i++) {
      const a = W[i - 1], c = W[i], s1 = Math.tan(a.ang), s2 = Math.tan(c.ang);
      if (s2 <= s1 + 1e-12) continue;
      const x = (c.y - a.y + s1 * a.x - s2 * c.x) / (s1 - s2), y = a.y + s1 * (x - a.x);
      if (y > a.y && (!cusp || x < cusp.x)) cusp = { x, y, k: i };
    }
    // state just ahead of the shock: behind the early waves only (scan from the first wave)
    const upState = (x, y) => { let k = 0; while (k < nW && side(k, x, y) <= 0) k++; return k ? W[k - 1] : null; };
    // state just behind: the latest wave that reaches the point (scan from the last wave)
    const downState = (x, y) => { let k = nW - 1; while (k >= 0 && side(k, x, y) > 0) k--; return k >= 0 ? W[k] : null; };
    // march the shock from the cusp: its angle follows the oblique-shock relation for the turn between
    // the two sides, so it strengthens as it swallows the converging waves and ends as the full-turn shock
    const SH = [];
    if (cusp) {
      let x = cusp.x, y = cusp.y, ang = W[cusp.k].ang;
      const ds = 0.01, xEnd = b.x1 + 1, yEnd = b.y1 + 1;
      SH.push({ x, y, p0: 1 });
      for (let i = 0; i < 3000 && x < xEnd && y < yEnd; i++) {
        x += ds * Math.cos(ang); y += ds * Math.sin(ang);
        const u = upState(x, y), d = downState(x, y);
        const Mu = u ? u.M : F.M, thu = u ? u.th : 0, thd = d ? d.th : thu;
        let p0 = 1;
        if (Mu > 1) {
          const turn = thd - thu, bb = turn > 1e-9 ? G.betaFromTheta(Mu, turn, F.g) : Math.asin(1 / Mu);
          if (isFinite(bb)) { ang = thu + bb; p0 = G.obliqueShock(Mu, bb, F.g).p02_p01; }
        }
        SH.push({ x, y, p0 });
      }
      if (SH.length < 2) SH.length = 0;
    }
    const shockY = x => {
      if (!SH.length || x < SH[0].x) return Infinity;
      let lo = 0, hi = SH.length - 1;
      if (x >= SH[hi].x) return SH[hi].y + (x - SH[hi].x) * Math.tan(Math.atan2(SH[hi].y - SH[hi - 1].y, SH[hi].x - SH[hi - 1].x));
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (SH[m].x <= x) lo = m; else hi = m; }
      return SH[lo].y + (x - SH[lo].x) * (SH[hi].y - SH[lo].y) / (SH[hi].x - SH[lo].x || 1e-12);
    };
    // total-pressure loss behind the shock: follow the streamline back (local flow angle) to the shock
    const p0Behind = (x, y, th) => {
      const t = Math.tan(th), h = i => (SH[i].y - y) - t * (SH[i].x - x);
      if (h(0) > 0) return 1; // streamline passes under the cusp: isentropic
      let lo = 0, hi = SH.length - 1;
      if (h(hi) <= 0) return SH[hi].p0;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (h(m) <= 0) lo = m; else hi = m; }
      return SH[hi].p0;
    };
    const sEnd = mkState(G.M_from_nu(Math.max(1e-6, nu0 - thFinal), F.g), thFinal, 1, F);
    const bS = G.betaFromTheta(F.M, thFinal, F.g), os = isNaN(bS) ? null : G.obliqueShock(F.M, bS, F.g);
    const sShock = os ? mkState(os.M2, thFinal, os.p02_p01, F) : null;
    const sample = (x, y) => {
      if (y < yw(x)) return null;
      if (!SH.length || x <= SH[0].x) { const w = downState(x, y); return w ? w.st : free; }
      if (y > shockY(x)) { const w = upState(x, y); return w ? w.st : free; }
      const w = downState(x, y); if (!w) return free;
      const p0 = p0Behind(x, y, w.th);
      return p0 < 1 - 1e-9 ? mkState(w.M, w.th, p0, F) : w.st;
    };
    // where each drawn Mach wave ends: at the shock (from either side) or off the view
    const waveEnd = w => {
      let Lr = 12;
      for (let i = 0; i < SH.length - 1; i++) {
        const A = SH[i], B = SH[i + 1], ex = B.x - A.x, ey = B.y - A.y, den = w.c * ey - w.s * ex;
        if (Math.abs(den) < 1e-14) continue;
        const t = ((A.x - w.x) * ey - (A.y - w.y) * ex) / den, u = ((A.x - w.x) * w.s - (A.y - w.y) * w.c) / den;
        if (t > 1e-6 && u >= 0 && u <= 1) { Lr = t; break; }
      }
      return Lr;
    };
    const drawn = [];
    for (let k = 0; k < nW; k += 5) drawn.push([W[k], waveEnd(W[k])]);
    if ((nW - 1) % 5) drawn.push([W[nW - 1], waveEnd(W[nW - 1])]);
    R.regions.push({ name: '1 · free stream', s: free }, { name: '2 · after isentropic turn (near wall)', s: sEnd }, ...(sShock ? [{ name: '3 · same turn by one oblique shock', s: sShock }] : []));
    R.metrics.push({ k: 'Total turn', v: deg(thFinal) }, { k: 'M after (isentropic)', v: sEnd.M.toFixed(3) }, { k: 'p/p∞ isentropic', v: sEnd.p.toFixed(3) }, ...(os ? [{ k: 'p/p∞ via shock', v: os.p2_p1.toFixed(3) }, { k: 'p₀ loss via shock', v: (100 * (1 - os.p02_p01)).toFixed(2) + '%' }] : []), ...(cusp ? [{ k: 'Shock forms at', v: `x=${cusp.x.toFixed(2)}, y=${cusp.y.toFixed(2)}` }] : []));
    R.insights.push({ type: 'i', t: 'Compression waves converge', d: 'Each bit of concave wall sends out a weak Mach wave. Behind each wave the flow is slower, so the Mach angle is larger and the next wave is steeper: the waves converge and coalesce into a shock away from the wall. The shock grows stronger (and steeper) as it swallows more waves.' });
    R.insights.push({ type: 'g', t: 'Why inlets use curved ramps', d: `Near the wall the compression is isentropic: same pressure rise with no total-pressure loss${os ? ` (vs ${(100 * (1 - os.p02_p01)).toFixed(2)}% for a single shock of the same turn)` : ''}. Isentropic-spike inlets exploit this. Switch the colour field to total-pressure loss to see the loss appear only above the shock's starting point.` });
    return { ...R, scene: { bounds: b, speed, sample,
      spawn: init => { const x = init ? b.x0 + Math.random() * 7 : b.x0 + 0.02; return { x, y: Math.max(0, yw(x)) + 0.03 + Math.random() * 3.6 }; },
      seeds: () => Array.from({ length: 12 }, (_, i) => ({ x: b.x0 + 1e-3, y: 0.05 + 3.6 * (i + 0.5) / 12 })),
      draw: ctx => {
        if (ctx.layers.waves) {
          const col = ctx.fieldOn || ctx.dark ? 'rgba(255,255,255,0.75)' : 'rgba(20,24,33,0.6)';
          for (const [w, Lr] of drawn) line(ctx, w, { x: w.x + Lr * w.c, y: w.y + Lr * w.s }, col, 1);
          if (SH.length > 1) { poly(ctx, SH, { stroke: ctx.fieldOn || ctx.dark ? '#fff' : '#111', width: 2.6, close: false }); label(ctx, cusp, 'shock forms', { dx: -8, dy: -12, align: 'right' }); }
        }
        body(ctx, wallShape);
        label(ctx, { x: b.x0 + 0.3, y: b.y1 - 0.3 }, `M∞ = ${F.M.toFixed(2)}`);
        label(ctx, { x: L + 1.6, y: yw(L + 1.6) + 0.28 }, `M ${sEnd.M.toFixed(2)}`, { align: 'center', size: 10.5 });
      } } };
  }

  if (id === 'wedge' || id === 'diamond') {
    const tau = id === 'wedge' ? Math.tan(P.angle * DEG) : P.thick, alpha = (id === 'diamond' ? P.alpha : 0) * DEG;
    // geometry in body frame then rotated nose-up by α about the leading edge (same frame as Airfoil Lab)
    const c = 1, rot = (x, y) => { const ca = Math.cos(-alpha), sa = Math.sin(-alpha); return { x: x * ca - y * sa, y: x * sa + y * ca }; };
    let pts;
    if (id === 'wedge') pts = { LE: { x: 0, y: 0 }, US: { x: 1, y: tau }, LS: { x: 1, y: -tau }, TEu: { x: 40, y: tau }, TEl: { x: 40, y: -tau } };
    else pts = { LE: rot(0, 0), US: rot(0.5, tau / 2 * c), LS: rot(0.5, -tau / 2 * c), TE: rot(1, 0) };
    const ang = (a, b2) => Math.atan2(b2.y - a.y, b2.x - a.x);
    const b = id === 'wedge' ? { x0: -0.8, x1: 4.6, y0: -2.1, y1: 2.1 } : { x0: -0.7, x1: 2.3, y0: -1.15, y1: 1.15 };
    const bodyPts = id === 'wedge' ? [pts.LE, pts.US, pts.TEu, pts.TEl, pts.LS] : [pts.LE, pts.US, pts.TE, pts.LS];
    R.cfd = { polys: [bodyPts] };
    const inside = (x, y) => pointInPoly(x, y, bodyPts);
    if (!sup) {
      subNote();
      let maxM = 0, sample;
      if (id === 'wedge') {
        const segs = [{ a: 0, b: 1, s: tau }];
        sample = (x, y) => { if (inside(x, y)) return null; const pv = linearPerturb(x, y, segs, F, { symmetric: true }); const s = velState(1 + Math.max(-0.9, Math.min(1.5, pv[0])), pv[1], F); return s; };
      } else {
        const segs = [{ a: 0, b: 0.5, s: tau }, { a: 0.5, b: 1, s: -tau }];
        sample = (x, y) => {
          if (inside(x, y)) return null;
          // to chord frame (rotate by +α about the leading edge)
          const ca = Math.cos(alpha), sa = Math.sin(alpha);
          const xc = x * ca - y * sa, yc = x * sa + y * ca;
          const pv = linearPerturb(xc, yc, segs, F, { symmetric: true, alpha, plate: { c: 1 } });
          let u = 1 + Math.max(-0.9, Math.min(1.5, pv[0])), v = alpha + pv[1];
          // back to world frame (rotate by −α)
          const uw = u * Math.cos(-alpha) - v * Math.sin(-alpha), vw = u * Math.sin(-alpha) + v * Math.cos(-alpha);
          return velState(uw, vw, F);
        };
        // surface Cp (linear theory), lift: cl = 2πα/β
        const beta = Math.sqrt(1 - F.M * F.M), xs = [], cu = [], cl = [];
        for (let i = 1; i < 100; i++) {
          const x = i / 100;
          const pu = linearPerturb(x, 1e-6, segs, F, { symmetric: true, alpha, plate: { c: 1 } }), pl = linearPerturb(x, -1e-6, segs, F, { symmetric: true, alpha, plate: { c: 1 } });
          xs.push(x); cu.push(-2 * pu[0]); cl.push(-2 * pl[0]);
        }
        R.cp = { x: xs, upper: cu, lower: cl, note: 'Linear subsonic theory (Prandtl–Glauert)' };
        R.metrics.push(F.M > 0.98 ? { k: 'cl (thin airfoil)', v: '—', s: 'linear theory fails near M = 1' } : { k: 'cl (thin airfoil)', v: (2 * Math.PI * alpha / beta).toFixed(4) }, { k: 'cd (inviscid)', v: '0', s: "d'Alembert: no wave drag" });
      }
      for (let x = 0.02; x < 1; x += 0.03) { const s1 = sample(x, 0.12 + 0.0), s2 = sample(x, -0.12); if (s1) maxM = Math.max(maxM, s1.M); if (s2) maxM = Math.max(maxM, s2.M); }
      critCheck(maxM);
      R.regions.push({ name: 'free stream', s: free });
      R.metrics.unshift({ k: 'Peak local M (near body)', v: maxM.toFixed(3) });
      return { ...R, scene: { bounds: b, speed, sample,
        spawn: init => ({ x: init ? b.x0 + Math.random() * (b.x1 - b.x0) : b.x0 + 0.02, y: b.y0 + Math.random() * (b.y1 - b.y0) }),
        seeds: seedsLeft(b, 16),
        draw: ctx => { body(ctx, bodyPts); label(ctx, { x: b.x0 + 0.15, y: b.y1 - 0.15 }, `M∞ = ${F.M.toFixed(2)}${alpha ? `, α = ${P.alpha.toFixed(1)}°` : ''}`); } } };
    }
    // supersonic diamond: the same shock-expansion engine as Airfoil Lab › Supersonic
    if (id === 'diamond') return diamondSupersonic(P, F, free, R, b);
    // supersonic wedge: nose shock + shoulder fan; the fan catches up with the shock and bends it
    const m = p => ({ x: p.x, y: -p.y });
    const up = buildWaves([{ ...pts.LE, thAfter: ang(pts.LE, pts.US) }, { ...pts.US, thAfter: 0 }], free, F);
    const lo = buildWaves([{ ...m(pts.LE), thAfter: ang(m(pts.LE), m(pts.LS)) }, { ...m(pts.LS), thAfter: 0 }], free, F);
    traceLeadShock(up, F, 8); traceLeadShock(lo, F, 8);
    const det = [...up, ...lo].find(w => w.type === 'detached' || w.type === 'vacuum');
    const sample = (x, y) => {
      if (inside(x, y)) return null;
      if (det) return free;
      return y >= 0 ? classify(x, y, up, free, F) : mirror(classify(x, -y, lo, free, F));
    };
    if (det) R.insights.push({ type: 'b', t: 'Nose shock detaches', d: `The wedge turns the flow by ${deg(det.dth)} but θmax is ${deg(det.thetaMax)} at M∞ = ${F.M.toFixed(2)}. The real flow has a detached bow shock; shock-expansion theory no longer applies. Reduce the angle, raise M, or try Live CFD.` });
    const names = ['nose shock', 'shoulder fan'];
    R.regions.push({ name: 'free stream', s: free });
    up.filter(w => w.down && w.type !== 'none').forEach((w, i) => R.regions.push({ name: `upper · after ${names[i]}`, s: w.down }));
    lo.filter(w => w.down && w.type !== 'none').forEach((w, i) => R.regions.push({ name: `lower · after ${names[i]}`, s: mirror(w.down) }));
    if (!det && up[0].type === 'shock') {
      const q = 0.5 * F.g * F.M * F.M;
      R.metrics.push({ k: 'Nose shock β', v: deg(up[0].beta) }, { k: 'M on face', v: up[0].down.M.toFixed(3) }, { k: 'p face / p∞', v: up[0].down.p.toFixed(3) }, { k: 'M after shoulder', v: up[1].down.M.toFixed(3) }, { k: 'p after / p∞', v: up[1].down.p.toFixed(3) }, { k: 'Wave cd (per unit t)', v: ((up[0].down.p - 1) / q).toFixed(4) });
      R.insights.push({ type: 'i', t: 'Shock at the nose, fan at the shoulder', d: 'The nose turns the flow up through an oblique shock; at the shoulder the surface turns back and a Prandtl–Meyer fan expands the flow. The fan catches up with the nose shock and weakens it, so the shock bends back and fades toward a Mach wave far from the body.' });
    } else if (!det) {
      R.metrics.push({ k: 'Wedge angle', v: '0°' });
      R.insights.push({ type: 'i', t: 'Zero thickness: no waves', d: 'A flat plate aligned with the flow does not turn it, so there are no shocks or fans — only infinitely weak Mach waves.' });
    }
    return { ...R, scene: { bounds: b, speed, sample,
      spawn: init => ({ x: init ? b.x0 + Math.random() * (b.x1 - b.x0) : b.x0 + 0.02, y: b.y0 + Math.random() * (b.y1 - b.y0) }),
      seeds: seedsLeft(b, 16),
      draw: ctx => {
        if (!det) { drawWaves(ctx, up, 1, 8, F); drawWaves(ctx, lo, -1, 8, F); }
        body(ctx, bodyPts);
        label(ctx, { x: b.x0 + 0.15, y: b.y1 - 0.15 }, `M∞ = ${F.M.toFixed(2)}`);
        if (!det && up[0].type === 'shock') {
          label(ctx, { x: 0.85, y: 0.85 * pts.US.y + 0.3 }, `M ${up[0].down.M.toFixed(2)}`, { align: 'center', size: 10.5 });
          label(ctx, { x: 3.2, y: pts.US.y + 0.2 }, `M ${up[1].down.M.toFixed(2)}`, { align: 'center', size: 10.5 });
        }
      } } };
  }

  if (id === 'blunt') {
    // Rankine half-body (h = 1): nose at x = −1/π, nose radius ≈ 1.5/π
    const b = { x0: -3.2, x1: 3.4, y0: -2.6, y1: 2.6 };
    const psi = (x, y) => y + Math.atan2(y, x) / Math.PI;
    const xNose = -1 / Math.PI, Rn = 1.5 / Math.PI;
    const inside = (x, y) => x > xNose - 1e-9 && Math.abs(psi(x, y)) < 1 && !(x < 0 && Math.abs(y) < 1e-9 && x < xNose);
    const bodyCurve = []; for (let i = 0; i <= 120; i++) { const yb = -0.999 + 1.998 * i / 120, a = Math.PI * (1 - Math.abs(yb)); bodyCurve.push({ x: Math.abs(yb) < 1e-6 ? xNose : yb / Math.tan(Math.sign(yb) * a), y: yb }); }
    const outline = [{ x: b.x1 + 40, y: -1 }, ...bodyCurve.filter(p => p.x < b.x1 + 2), { x: b.x1 + 40, y: 1 }];
    R.cfd = { polys: [outline] };
    if (!sup) {
      let maxM = 0;
      const MCAP = 1.6, pMin = isen.p0_p(F.M, F.g) / isen.p0_p(MCAP, F.g);
      const sample = (x, y) => {
        if (inside(x, y)) return null;
        const r2 = x * x + y * y, u = 1 + x / (Math.PI * r2), v = y / (Math.PI * r2);
        // Kármán–Tsien correction of the incompressible Cp
        const V2 = u * u + v * v, cp0 = 1 - V2, bt = Math.sqrt(1 - F.M * F.M);
        // K–T is only valid below the critical Mach number; past it the denominator heads to 0, so the
        // supersonic pocket is capped at M = MCAP instead of blowing up
        const den = bt + F.M * F.M / (1 + bt) * cp0 / 2, cp = den > 1e-6 ? cp0 / den : -Infinity;
        const p = Math.max(pMin, 1 + 0.5 * F.g * F.M * F.M * cp), Tq = p ** ((F.g - 1) / F.g);
        const T0 = isen.T0_T(F.M, F.g), M = Math.sqrt(Math.max(0, (T0 / Tq - 1) * 2 / (F.g - 1)));
        if (M > maxM && r2 < 4) maxM = M;
        return { M, th: Math.atan2(v, u), p, T: Tq, rho: p / Tq, p0: 1 };
      };
      for (const p of bodyCurve) sample(p.x * 1.01 - 0.01, p.y * 1.03);
      R.insights.push({ type: 'i', t: 'Subsonic: smooth stagnation flow', d: 'The flow slows to rest at the nose (stagnation point, p = p₀) and speeds up around the shoulder. No shock — the flow adjusts gradually because the body\'s pressure field reaches far upstream. Shown with potential flow + Kármán–Tsien compressibility correction.' });
      critCheck(maxM);
      if (maxM > MCAP - 1e-3) R.insights.push({ type: 'w', t: 'Supersonic pocket capped', d: `The compressibility correction breaks down past the critical Mach number, so the local Mach number is capped at ${MCAP} in this view. Use Live CFD to see the real transonic flow and its terminating shock.` });
      R.regions.push({ name: 'free stream', s: free }, { name: 'stagnation point', s: mkState(1e-6, 0, 1, F) });
      R.metrics.push({ k: 'p₀/p∞ (stagnation)', v: isen.p0_p(F.M, F.g).toFixed(4) }, { k: 'Peak local M', v: maxM.toFixed(3) }, { k: 'T₀/T∞', v: isen.T0_T(F.M, F.g).toFixed(4) });
      return { ...R, scene: { bounds: b, speed, sample, sonic: true,
        spawn: init => ({ x: init ? b.x0 + Math.random() * (b.x1 - b.x0) : b.x0 + 0.02, y: b.y0 + Math.random() * (b.y1 - b.y0) }), seeds: seedsLeft(b, 18),
        draw: ctx => { body(ctx, outline); label(ctx, { x: b.x0 + 0.2, y: b.y1 - 0.2 }, `M∞ = ${F.M.toFixed(2)}`); } } };
    }
    const det = detachedShape(F.M, F.g, xNose, 0, Rn);
    const ns = G.normalShock(F.M, F.g), p02 = ns.p02_p1;
    // body points with tangent angle for modified-Newtonian surface state
    const bodyS = bodyCurve.map((p, i) => {
      const a = bodyCurve[Math.max(0, i - 1)], c = bodyCurve[Math.min(bodyCurve.length - 1, i + 1)];
      let dx = c.x - a.x, dy = c.y - a.y;
      if (p.y < 0) { dx = -dx; dy = -dy; } // point the tangent downstream on the lower half
      const th = Math.atan2(dy, dx);
      const s2 = Math.cos(th) ** 2 > 1 ? 0 : Math.sin(th) ** 2; // sin² of surface inclination to the flow
      const pb = 1 + (p02 - 1) * s2;
      const M = G.M_from_p(Math.min(1, pb / p02), F.g);
      return { ...p, st: mkState(Math.max(M, 1e-4), th, ns.p02_p01, F) };
    });
    const nearest = (x, y) => {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < bodyS.length; i += 8) { const p = bodyS[i], d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) { bd = d; bi = i; } }
      for (let i = Math.max(0, bi - 8); i <= Math.min(bodyS.length - 1, bi + 8); i++) { const p = bodyS[i], d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) { bd = d; bi = i; } }
      return [bodyS[bi], Math.sqrt(bd)];
    };
    const sample = (x, y) => {
      if (inside(x, y)) return null;
      const xs = det.xs(y); if (x < xs) return free;
      const sS = det.post(y, F, mkState); const [bp, db] = nearest(x, y);
      const ds = Math.max(1e-6, x - xs), w = Math.min(1, db / (db + ds));
      const lerp = (a, c) => a * w + c * (1 - w);
      const M = lerp(sS.M, bp.st.M), th = lerp(sS.th, bp.st.th);
      return mkState(M, th, sS.p0, F);
    };
    R.regions.push({ name: 'free stream', s: free }, { name: 'behind normal shock (centreline)', s: mkState(ns.M2, 0, ns.p02_p01, F) }, { name: 'stagnation point', s: mkState(1e-6, 0, ns.p02_p01, F) });
    R.metrics.push({ k: 'Stand-off Δ/Rn', v: (det.delta / Rn).toFixed(3) }, { k: 'Pitot p₀₂/p∞', v: p02.toFixed(4), s: 'Rayleigh pitot formula' }, { k: 'p₀₂/p₀∞', v: ns.p02_p01.toFixed(4) }, { k: 'T stag / T∞', v: isen.T0_T(F.M, F.g).toFixed(3) }, { k: 'Cp max', v: ((p02 - 1) / (0.5 * F.g * F.M * F.M)).toFixed(4) });
    R.insights.push({ type: 'i', t: 'Bow shock with a subsonic pocket', d: `A blunt nose can't be wrapped by an attached shock. The bow shock stands off by Δ ≈ ${(det.delta / Rn).toFixed(2)} nose radii; it is normal on the centreline (subsonic behind it) and weakens toward a Mach wave far out. The dotted line marks where the flow becomes sonic again.` });
    R.insights.push({ type: 'g', t: 'Pitot tubes in supersonic flow', d: `A pitot probe sits in this stagnation region, so it reads p₀₂ (after the shock), not p₀∞. Use the Rayleigh pitot formula to get the Mach number: here p₀₂/p∞ = ${p02.toFixed(3)} ↔ M = ${F.M.toFixed(2)}. (The Calculator tab inverts it.)` });
    R.insights.push({ type: 'w', t: 'Model', d: 'Shock shape from Billig\'s correlation; shock-layer colors interpolate between local oblique-shock states and a modified-Newtonian surface pressure. Good for intuition, not a CFD solution.' });
    return { ...R, scene: { bounds: b, speed, sample, sonic: true,
      spawn: init => ({ x: init ? b.x0 + Math.random() * (b.x1 - b.x0) : b.x0 + 0.02, y: b.y0 + Math.random() * (b.y1 - b.y0) }), seeds: seedsLeft(b, 18),
      draw: ctx => {
        if (ctx.layers.waves) poly(ctx, det.pts(b.y1 + 0.5), { stroke: ctx.fieldOn || ctx.dark ? '#fff' : '#111', width: 2.6, close: false });
        body(ctx, outline);
        label(ctx, { x: b.x0 + 0.2, y: b.y1 - 0.2 }, `M∞ = ${F.M.toFixed(2)}`);
        label(ctx, { x: xNose - det.delta, y: 0 }, 'Δ', { dx: -4, dy: -14, align: 'center', bg: false });
      } } };
  }

  if (id === 'reflect') {
    const th = P.angle * DEG, H = 1.6, b = { x0: -1.1, x1: 5.6, y0: -0.15, y1: H + 0.15 };
    const xg = 0; // top-wall ramp corner (deflects flow down by θ)
    const tth = Math.tan(th), topY = x => x <= xg ? H : H - (x - xg) * tth;
    R.cfd = { polys: [[{ x: b.x0 - 40, y: 0 }, { x: b.x1 + 40, y: 0 }, { x: b.x1 + 40, y: -40 }, { x: b.x0 - 40, y: -40 }], [{ x: b.x0 - 40, y: H }, { x: xg, y: H }, { x: b.x1 + 40, y: topY(b.x1 + 40) }, { x: b.x1 + 40, y: H + 40 }, { x: b.x0 - 40, y: H + 40 }]] };
    const inkOf = ctx => ctx.fieldOn || ctx.dark ? '#fff' : '#111';
    const walls = ctx => {
      body(ctx, [{ x: b.x0 - 1, y: 0 }, { x: b.x1 + 40, y: 0 }, { x: b.x1 + 40, y: -1 }, { x: b.x0 - 1, y: -1 }]);
      body(ctx, [{ x: b.x0 - 1, y: H }, { x: xg, y: H }, { x: b.x1 + 40, y: topY(b.x1 + 40) }, { x: b.x1 + 40, y: H + 1 }, { x: b.x0 - 1, y: H + 1 }]);
    };
    const outside = (x, y) => y < 0 || y > topY(x);
    const spawn = init => { const x = init ? b.x0 + Math.random() * (b.x1 - b.x0) : b.x0 + 0.02; return { x, y: 0.02 + Math.random() * (topY(x) - 0.04) }; };
    const seeds = seedsLeft(b, 10, 0.05, H - 0.05);
    // subsonic flow in the converging channel: angle blends from 0 at the floor to −θ at the ramp,
    // Mach number from quasi-1-D area change (A* set by the state s0 at full height H)
    const wallAngle = (x, y) => x <= xg ? 0 : -th * Math.min(1, Math.max(0, y / topY(x)));
    const channel = (s0, p0r) => {
      const Astar = H / isen.A_As(s0.M, F.g), xChoke = th > 1e-9 ? xg + (H - Astar) / tth : Infinity;
      const at = (x, y) => { const A = topY(x); const M = A > Astar * (1 + 1e-9) ? G.M_from_A(A / Astar, F.g, false) : 1; return mkState(M, wallAngle(x, y), p0r, F); };
      return { at, xChoke };
    };
    const chokeNote = (xc, what) => { if (xc < b.x1) R.insights.push({ type: 'w', t: 'The channel chokes', d: `The subsonic flow speeds up as the channel narrows and reaches M = 1 at x ≈ ${xc.toFixed(2)}. Past that point this channel can't pass the incoming mass flow, so in a real duct ${what}. Shown here: M held at 1 (quasi-1-D estimate).` }); };

    if (!sup) {
      const ch = channel(free, 1);
      R.insights.push({ type: 'i', t: 'Subsonic: no shock to reflect', d: 'Below M = 1 the ramp is felt everywhere at once: the flow turns smoothly and speeds up as the channel narrows (quasi-1-D estimate).' });
      chokeNote(ch.xChoke, 'the upstream flow would slow down (less mass flow) until it fits');
      R.regions.push({ name: 'free stream', s: free });
      return { ...R, scene: { bounds: b, speed, sample: (x, y) => outside(x, y) ? null : ch.at(x, y), spawn, seeds,
        draw: ctx => { walls(ctx); label(ctx, { x: b.x0 + 0.1, y: H / 2 }, `M₁ = ${F.M.toFixed(2)}`); } } };
    }

    // incident shock detached: a curved, nearly normal shock stands ahead of the ramp across the channel
    const b1 = G.betaFromTheta(F.M, th, F.g);
    if (isNaN(b1)) {
      const ns = G.normalShock(F.M, F.g), s2n = mkState(ns.M2, 0, ns.p02_p01, F), ch = channel(s2n, ns.p02_p01);
      const xs = y => xg - 0.25 - 0.3 * (y / H) ** 2; // schematic shape: furthest upstream at the ramp
      R.insights.push({ type: 'b', t: 'Incident shock detaches', d: `θ = ${deg(th)} is more than θmax = ${deg(G.thetaMax(F.M, F.g))} at M = ${F.M.toFixed(2)}, so no attached oblique shock can turn the flow. A near-normal shock spans the channel ahead of the ramp (shape drawn schematically) and the flow behind it is subsonic.` });
      chokeNote(ch.xChoke, 'the shock would be pushed upstream and out of the channel (an inlet "unstart")');
      R.regions.push({ name: '1 · free stream', s: free }, { name: '2 · behind the normal shock', s: s2n });
      R.metrics.push({ k: 'θmax', v: deg(G.thetaMax(F.M, F.g)) }, { k: 'M behind shock', v: ns.M2.toFixed(3) }, { k: 'p₂/p₁', v: ns.p2_p1.toFixed(3) }, { k: 'p₀ loss', v: (100 * (1 - ns.p02_p01)).toFixed(2) + '%' });
      const pts = Array.from({ length: 31 }, (_, i) => { const y = H * i / 30; return { x: xs(y), y }; });
      return { ...R, scene: { bounds: b, speed, spawn, seeds,
        sample: (x, y) => outside(x, y) ? null : x < xs(y) ? free : ch.at(x, y),
        draw: ctx => {
          if (ctx.layers.waves) poly(ctx, pts, { stroke: inkOf(ctx), width: 2.6, close: false });
          walls(ctx);
          label(ctx, { x: b.x0 + 0.1, y: H / 2 }, `M₁ = ${F.M.toFixed(2)}`);
          label(ctx, { x: xg + 0.6, y: 0.3 }, `M ${ns.M2.toFixed(2)} (subsonic)`);
          label(ctx, { x: xs(H * 0.82), y: H * 0.82 }, 'detached shock', { dx: 10 });
        } } };
    }

    // chain of regular reflections: each bounce turns the flow back parallel to the wall it hits
    const chain = [];
    let s = free, from = { x: xg, y: H }, toBottom = true, stop = null;
    for (let n = 0; n < 10; n++) {
      if (s.M <= 1) { stop = { why: 'subsonic', at: from, s }; break; }
      const bb = G.betaFromTheta(s.M, th, F.g);
      if (isNaN(bb)) { stop = { why: 'mach', at: from, s }; break; }
      const os = G.obliqueShock(s.M, bb, F.g), ang = toBottom ? s.th - bb : s.th + bb;
      const c = Math.cos(ang), sn = Math.sin(ang);
      const t = toBottom ? from.y / -sn : (H - (from.x - xg) * tth - from.y) / (sn + c * tth);
      const B = { x: from.x + t * c, y: from.y + t * sn };
      chain.push({ A: from, B, up: s, beta: bb, ang, os, down: mkState(os.M2, toBottom ? -th : 0, s.p0 * os.p02_p01, F) });
      s = chain[chain.length - 1].down; from = B; toBottom = !toBottom;
      if (B.x > b.x1 + 2) break;
    }
    // segment k spans the channel; a point has passed it if it lies downstream at its own height
    const passed = (seg, x, y) => {
      const top = seg.A.y > seg.B.y ? seg.A : seg.B;
      if (y > top.y) return false;
      return x > seg.A.x + (y - seg.A.y) * (seg.B.x - seg.A.x) / (seg.B.y - seg.A.y);
    };
    const o1 = chain[0].os, s2 = chain[0].down;
    // first reflection impossible → Mach reflection (schematic): triple point, Mach stem, slip line
    const mach = chain.length === 1 && stop ? (() => {
      const M2 = s2.M, tm2 = M2 > 1 ? G.thetaMax(M2, F.g) : 0;
      const stemH = Math.min(0.6 * H, 0.25 * H + 0.02 * Math.max(0, th - tm2) / DEG);
      const tp = { x: xg + (H - stemH) / Math.tan(b1), y: stemH };
      const foot = tp.x + 0.08 * stemH, cS = (tp.x - foot) / (stemH * stemH);
      const stemX = y => foot + cS * y * y;
      const ns = G.normalShock(F.M, F.g), sStem = mkState(ns.M2, 0, ns.p02_p01, F);
      let ar = null, sRef = null, refEnd = null;
      if (M2 > 1) {
        const bm = G.betaMax(M2, F.g), osr = G.obliqueShock(M2, bm, F.g);
        ar = s2.th + bm; sRef = mkState(osr.M2, s2.th + tm2, s2.p0 * osr.p02_p01, F);
        const c = Math.cos(ar), sn = Math.sin(ar), t = (H - (tp.x - xg) * tth - tp.y) / (sn + c * tth);
        refEnd = { x: tp.x + t * c, y: tp.y + t * sn };
      }
      const slipAng = 0.5 * (0 + (sRef ? sRef.th : s2.th));
      return { stemH, tp, stemX, sStem, ar, sRef, refEnd, slipAng, tm2 };
    })() : null;
    const sample = (x, y) => {
      if (outside(x, y)) return null;
      if (mach) {
        const { tp, stemX, slipAng, ar } = mach;
        if (y <= tp.y) { if (x < stemX(y)) return free; }
        else if (!passed(chain[0], x, y)) return free;
        if (x > tp.x && y < tp.y + (x - tp.x) * Math.tan(slipAng)) return mach.sStem;
        if (y <= tp.y && x <= tp.x) return mach.sStem;
        if (ar !== null && Math.cos(ar) * (y - tp.y) - Math.sin(ar) * (x - tp.x) < 0) return mach.sRef;
        return s2;
      }
      let st = free;
      for (const seg of chain) { if (passed(seg, x, y)) st = seg.down; else break; }
      return st;
    };
    R.regions.push({ name: '1 · free stream', s: free }, ...chain.map((c, i) => ({ name: `${i + 2} · behind ${i === 0 ? 'incident' : i === 1 ? 'reflected' : `reflection ${i}`} shock`, s: c.down })));
    if (mach) R.regions.push({ name: 'behind Mach stem', s: mach.sStem }, ...(mach.sRef ? [{ name: 'behind reflected shock (from triple point)', s: mach.sRef }] : []));
    if (!mach) {
      const c1 = chain[1];
      R.metrics.push({ k: 'Incident β₁', v: deg(b1) }, { k: 'M₂', v: o1.M2.toFixed(3) }, ...(c1 ? [{ k: 'Reflected β₂', v: deg(c1.beta), s: `angle to wall ${deg(c1.ang)}` }, { k: 'M₃', v: c1.down.M.toFixed(3) }, { k: 'p₃/p₁', v: c1.down.p.toFixed(3) }] : []));
      R.insights.push({ type: 'i', t: 'Regular reflection', d: `The incident shock turns the flow ${deg(th)} toward the wall. The wall forces it back parallel, which takes a second (reflected) shock in M₂ = ${o1.M2.toFixed(2)} flow.${c1 ? ` The reflected shock is not a mirror image: its angle to the wall is ${deg(c1.ang)} vs ${deg(b1)}.` : ''}` });
      if (chain.length > 2) R.insights.push({ type: 'i', t: 'Shocks keep bouncing', d: `The reflected shock reaches the ramp wall and reflects again. Every bounce turns the flow by θ and lowers the Mach number (${chain.map(c => c.down.M.toFixed(2)).join(' → ')}), until a regular reflection is no longer possible.` });
      if (stop) R.insights.push({ type: 'w', t: stop.why === 'mach' ? 'Later reflection becomes a Mach reflection' : 'Flow has become subsonic', d: stop.why === 'mach' ? `At x ≈ ${stop.at.x.toFixed(2)} the flow (M = ${stop.s.M.toFixed(2)}) can no longer be turned ${deg(th)} by an attached shock, so a Mach stem would form there (not drawn).` : `After x ≈ ${stop.at.x.toFixed(2)} the flow is subsonic, so there are no more reflected shocks.` });
    } else {
      R.metrics.push({ k: 'Incident β₁', v: deg(b1) }, { k: 'M₂', v: o1.M2.toFixed(3) }, { k: 'θmax at M₂', v: s2.M > 1 ? deg(mach.tm2) : '— (M₂ < 1)' }, { k: 'Reflection', v: 'Mach' });
      R.insights.push({ type: 'b', t: 'Mach reflection', d: s2.M > 1 ? `Behind the incident shock M₂ = ${o1.M2.toFixed(2)} can be turned at most ${deg(mach.tm2)}, less than the ${deg(th)} needed. A near-normal Mach stem forms at the wall with a triple point and slip line (drawn schematically). The same thing creates the Mach disk in over-expanded jets.` : `Behind the incident shock the flow is already subsonic (M₂ = ${o1.M2.toFixed(2)}), so no reflected oblique shock is possible. A near-normal Mach stem forms at the wall (drawn schematically).` });
    }
    return { ...R, scene: { bounds: b, speed, sample, spawn, seeds,
      draw: ctx => {
        const ink = inkOf(ctx);
        if (ctx.layers.waves) {
          if (!mach) for (const c of chain) line(ctx, c.A, c.B, ink, 2.6);
          else {
            const { tp, stemX, stemH, refEnd, slipAng } = mach;
            line(ctx, chain[0].A, tp, ink, 2.6);
            poly(ctx, Array.from({ length: 13 }, (_, i) => { const y = stemH * (1 - i / 12); return { x: stemX(y), y }; }), { stroke: ink, width: 2.6, close: false });
            if (refEnd) line(ctx, tp, refEnd, ink, 2);
            line(ctx, tp, { x: tp.x + 6 * Math.cos(slipAng), y: tp.y + 6 * Math.sin(slipAng) }, ink, 1.1, [5, 4]);
          }
        }
        walls(ctx);
        label(ctx, { x: b.x0 + 0.1, y: H / 2 }, `M₁ = ${F.M.toFixed(2)}`);
        if (mach) {
          label(ctx, mach.tp, 'triple point', { dx: 8, dy: -10 });
          label(ctx, { x: mach.stemX(mach.stemH / 2), y: mach.stemH / 2 }, 'Mach stem', { dx: 10 });
        } else {
          const mid = c => ({ x: 0.5 * (c.A.x + c.B.x), y: 0.5 * (c.A.y + c.B.y) });
          chain.forEach((c, i) => {
            const m = mid(c), n = chain[i + 1] ? mid(chain[i + 1]) : { x: m.x + 1.2, y: m.y };
            const p = { x: 0.5 * (m.x + n.x), y: Math.min(topY(0.5 * (m.x + n.x)) - 0.2, Math.max(0.2, 0.5 * (m.y + n.y))) };
            if (p.x < b.x1 - 0.3) label(ctx, p, `${i + 2}: M ${c.down.M.toFixed(2)}`, { align: 'center', size: 10.5 });
          });
        }
      } } };
  }

  if (id === 'cone') {
    const b = { x0: -6, x1: 6, y0: -3.2, y1: 3.2 };
    const M = F.M;
    if (M > 1) R.insights.push({ type: 'i', t: 'Mach cone', d: `The source outruns its own sound. Every wavefront it ever emitted lies inside a cone of half-angle μ = asin(1/M) = ${deg(Math.asin(1 / M))}. Outside it is the "zone of silence": nothing can be heard until the cone (the sonic boom) sweeps past.` });
    else if (M === 1 || Math.abs(M - 1) < 0.01) R.insights.push({ type: 'w', t: 'Sonic: waves pile up', d: 'At M = 1 all wavefronts touch at the source: a flat wall of compressed waves. This is the "sound barrier".' });
    else R.insights.push({ type: 'i', t: 'Subsonic: sound escapes ahead', d: `Wavefronts bunch up ahead (Doppler shift) but still outrun the source, so the air ahead is "warned" — that's why subsonic flow turns smoothly before reaching a body.` });
    R.metrics.push({ k: 'Mach angle μ', v: M > 1 ? deg(Math.asin(1 / M)) : '—' }, { k: 'Doppler (ahead)', v: M < 1 ? (1 / (1 - M)).toFixed(2) + '× pitch' : '—' });
    return { ...R, scene: { bounds: b, noField: true,
      draw: ctx => {
        const { g, T, t } = ctx, period = 0.35, a = 1.1, life = 6.5;
        const ink = ctx.dark ? '230,234,240' : '20,24,33';
        // source position cycles across the view
        const span = b.x1 - b.x0 + 4, V = M * a;
        const xs = tt => b.x0 - 2 + ((V * tt) % span + span) % span;
        const tNow = t;
        g.lineWidth = 1.3;
        for (let k = Math.floor((tNow - life) / period); k <= Math.floor(tNow / period); k++) {
          const te = k * period; if (te > tNow) continue;
          const age = tNow - te, r = a * age;
          // skip wavefronts emitted before the last wrap
          const x0 = xs(te); if (V > 0 && xs(tNow) < x0 && Math.floor(V * te / span) !== Math.floor(V * tNow / span)) continue;
          g.strokeStyle = `rgba(${ink},${Math.max(0, 0.75 * (1 - age / life))})`;
          g.beginPath(); g.arc(T.sx(x0), T.sy(0), r * T.s, 0, 2 * Math.PI); g.stroke();
        }
        const xn = xs(tNow);
        if (M > 1) {
          const mu = Math.asin(1 / M), L = 20;
          g.strokeStyle = ctx.css('--bad'); g.lineWidth = 2;
          g.beginPath(); g.moveTo(T.sx(xn - L * Math.cos(mu)), T.sy(L * Math.sin(mu))); g.lineTo(T.sx(xn), T.sy(0)); g.lineTo(T.sx(xn - L * Math.cos(mu)), T.sy(-L * Math.sin(mu))); g.stroke();
          label(ctx, { x: xn - 2.6, y: 2.6 * Math.tan(mu) + 0.3 }, 'Mach wave (shock if strong)', { color: ctx.css('--bad'), align: 'center' });
          label(ctx, { x: Math.min(xn + 1.2, b.x1 - 1.5), y: 2.4 }, 'zone of silence', { align: 'center' });
        }
        g.fillStyle = ctx.css('--accent'); g.beginPath(); g.arc(T.sx(xn), T.sy(0), 6, 0, 2 * Math.PI); g.fill();
        label(ctx, { x: b.x0 + 0.3, y: b.y1 - 0.3 }, `source moving at M = ${M.toFixed(2)} →`);
      } } };
  }
  return { ...R, scene: { bounds: { x0: 0, x1: 1, y0: 0, y1: 1 }, sample: () => free } };
}

// Diamond airfoil above Mach 1: shock-expansion theory from the shared supersonic airfoil solver
function diamondSupersonic(P, F, free, R, b) {
  const shape = P.thick > 1e-6 ? sharpAirfoil('diamond', { t: P.thick, xm: 0.5 }) : sharpAirfoil('plate');
  const S = solveSupersonic({ x: shape.x, z: shape.z, alpha: P.alpha, M: F.M, g: F.g });
  const bodyPts = S.body.map(([x, y]) => ({ x, y }));
  R.cfd = { polys: [bodyPts] };
  const sample = S.ok ? S.sample : (x, y) => (pointInPoly(x, y, bodyPts) ? null : free);
  R.regions.push({ name: 'free stream', s: free });
  if (!S.ok) {
    const e = explainFailure(S);
    R.insights.push({ type: 'b', t: e.t, d: e.d.replace(/<[^>]+>/g, '') });
  } else {
    const kind = t => (t === 'shock' ? 'shock' : t === 'fan' ? 'fan' : 'no wave');
    for (const [side, D] of [['upper', S.D[0]], ['lower', S.D[1]]]) {
      const fix = side === 'lower' ? mirror : s => s, crest = D.verts.find(v => v.fan);
      R.regions.push({ name: `${side} · front face (${kind(D.le.type)})`, s: fix(D.S[0]) },
        { name: `${side} · rear face (${crest ? 'fan' : 'no wave'})`, s: fix(D.S[D.S.length - 1]) },
        { name: `${side} · wake (${kind(D.te.type)})`, s: fix(D.te.down) });
    }
    R.metrics.push({ k: 'cl', v: S.cl.toFixed(4), s: `linear: ${S.clLin.toFixed(4)}` }, { k: 'cd (wave drag)', v: S.cdw.toFixed(5), s: `linear: ${S.cdwLin.toFixed(5)}` },
      { k: 'L/D', v: Math.abs(S.cdw) > 1e-9 ? (S.cl / S.cdw).toFixed(2) : '—' }, { k: 'cm (c/4)', v: S.cm.toFixed(4) });
    const [u, l] = S.surf;
    R.cp = { x: u.x, upper: u.cp, lower: l.cp, linUpper: u.cpLin, linLower: l.cpLin, note: 'Shock-expansion theory (solid) vs Ackeret linear theory (dashed)' };
    R.insights.push({ type: 'i', t: 'Supersonic lift and wave drag', d: `Pressure is uniform on each face (constant between waves). Even with zero viscosity there is drag — wave drag — because the pressure on the front faces is higher than on the rear faces. Linear (Ackeret) theory predicts cl = 4α/√(M²−1) = ${S.clAckeretPlate.toFixed(3)}.` });
    R.insights.push({ type: 'i', t: 'Trailing-edge waves and slip line', d: `Upper and lower flows leave the trailing edge at different pressures, so a shock and an expansion form there until both reach the same pressure and direction (${deg(S.delta)}). The dashed line is a slip line: equal pressure, different velocity and entropy. The crest fans bend the nose shocks back as they catch up with them.` });
  }
  R.insights.push({ type: 'g', t: 'More in Airfoil Lab › Supersonic', d: 'The same theory runs there on more sections (hexagonal, biconvex, flat plate), with skin friction, lift curves, drag-vs-Mach sweeps and live CFD on any airfoil.' });
  return { ...R, scene: { bounds: b, speed: 1 / Math.max(F.M, 0.15), sample,
    spawn: init => ({ x: init ? b.x0 + Math.random() * (b.x1 - b.x0) : b.x0 + 0.02, y: b.y0 + Math.random() * (b.y1 - b.y0) }),
    seeds: () => Array.from({ length: 16 }, (_, i) => ({ x: b.x0 + 1e-3, y: b.y0 + (b.y1 - b.y0) * (i + 0.5) / 16 })),
    draw: ctx => {
      drawSupersonicTheory(ctx, S, { thick: true, Lfar: 6 });
      body(ctx, bodyPts);
      label(ctx, { x: b.x0 + 0.15, y: b.y1 - 0.15 }, `M∞ = ${F.M.toFixed(2)}, α = ${P.alpha.toFixed(1)}°`);
      if (!S.ok) label(ctx, { x: 0.5 * (b.x0 + b.x1), y: b.y0 + 0.12 }, 'Theory not valid here — see the note below, or try Live CFD', { align: 'center', color: '#ffb4b4' });
    } } };
}

// Billig correlation for a bow shock ahead of a blunt (cylinder-like) nose of radius Rn at (xFront, y0)
export function detachedShape(M, g, xFront, y0, Rn) {
  const mu = Math.asin(1 / M), delta = Rn * 0.386 * Math.exp(4.67 / (M * M)), Rc = Rn * 1.386 * Math.exp(1.8 / Math.pow(Math.max(M - 1, 0.02), 0.75));
  const c2 = 1 / Math.tan(mu) ** 2, t2 = Math.tan(mu) ** 2;
  const xs = y => xFront - delta + Rc * c2 * (Math.sqrt(1 + (y - y0) ** 2 * t2 / (Rc * Rc)) - 1);
  const dxdy = y => Rc * c2 * ((y - y0) * t2 / (Rc * Rc)) / Math.sqrt(1 + (y - y0) ** 2 * t2 / (Rc * Rc));
  const post = (y, F, mkS) => {
    const d = dxdy(y), beta = Math.max(Math.asin(1 / F.M) + 1e-6, Math.atan2(1, Math.abs(d)));
    const os = G.obliqueShock(F.M, Math.min(beta, Math.PI / 2), F.g);
    const sgn = y >= y0 ? 1 : -1;
    return mkS(Math.max(os.M2, 1e-4), sgn * os.theta, os.p02_p01, F);
  };
  const pts = Ymax => { const out = []; for (let i = -60; i <= 60; i++) { const y = y0 + Ymax * i / 60; out.push({ x: xs(y), y }); } return out; };
  return { xs, post, pts, delta, Rc };
}

export function pointInPoly(x, y, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
