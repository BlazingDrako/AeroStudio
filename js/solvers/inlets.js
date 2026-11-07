// Supersonic inlet shock systems: pitot (normal shock), N-ramp external compression with a
// terminal normal shock (Oswatitsch optimum or user ramp angles), and all-oblique scramjet inlets.
import * as G from './gasdyn.js';

const { DEG } = G;

// MIL-E-5008B ram recovery (standard reference curve)
export function milSpecRecovery(M) {
  if (M <= 1) return 1;
  if (M < 5) return 1 - 0.075 * (M - 1) ** 1.35;
  return 800 / (M ** 4 + 935);
}

// Oswatitsch: for N oblique shocks + normal shock, maximum recovery when all shocks share the same normal Mach number.
export function oswatitschRamps(M0, N, g = 1.4) {
  if (N <= 0 || M0 <= 1) return { Mn: M0, thetas: [] };
  const run = Mn => {
    let M = M0; const thetas = [];
    for (let k = 0; k < N; k++) {
      if (M <= Mn) return { ok: false, M, thetas };
      const b = Math.asin(Mn / M), th = G.thetaFromBeta(M, b, g);
      if (!(th > 0)) return { ok: false, M, thetas };
      thetas.push(th);
      M = G.obliqueShock(M, b, g).M2;
    }
    return { ok: true, M, thetas };
  };
  // find Mn such that final Mach before the normal shock equals Mn
  let lo = 1.0000001, hi = M0;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2, r = run(mid);
    if (!r.ok || r.M < mid) hi = mid; else lo = mid;
  }
  const r = run(lo);
  return { Mn: lo, thetas: r.thetas };
}

// Analyze a ramp shock system. thetas: ramp deflections (rad, each relative to previous flow);
// terminal: 'normal' (external compression) or 'none' (scramjet: optional cowl shock turns flow back to axial).
export function analyzeInlet(M0, thetas, { g = 1.4, terminal = 'normal', cowl = true } = {}) {
  const shocks = [], regions = [{ M: M0, p: 1, T: 1, p0: 1, dir: 0 }];
  let M = M0, p = 1, T = 1, p0 = 1, dir = 0, ok = true, note = '';
  for (const th of thetas) {
    const b = G.betaFromTheta(M, th, g, 'weak');
    if (!isFinite(b)) { ok = false; note = `Ramp of ${(th / DEG).toFixed(1)}° exceeds θmax at M=${M.toFixed(2)}: the shock detaches.`; break; }
    const s = G.obliqueShock(M, b, g);
    shocks.push({ kind: 'oblique', beta: b, theta: th, dirIn: dir, Mup: M, p02: s.p02_p01 });
    M = s.M2; p *= s.p2_p1; T *= s.T2_T1; p0 *= s.p02_p01; dir += th;
    regions.push({ M, p, T, p0, dir });
  }
  if (ok && terminal === 'normal' && M > 1) {
    const s = G.normalShock(M, g);
    shocks.push({ kind: 'normal', Mup: M, dirIn: dir, p02: s.p02_p01 });
    M = s.M2; p *= s.p2_p1; T *= s.T2_T1; p0 *= s.p02_p01;
    regions.push({ M, p, T, p0, dir });
  } else if (ok && terminal === 'none' && cowl && dir > 1e-6) {
    // cowl shock turns the flow back parallel to the axis
    const b = G.betaFromTheta(M, dir, g, 'weak');
    if (isFinite(b)) {
      const s = G.obliqueShock(M, b, g);
      shocks.push({ kind: 'cowl', beta: b, theta: dir, dirIn: dir, Mup: M, p02: s.p02_p01 });
      M = s.M2; p *= s.p2_p1; T *= s.T2_T1; p0 *= s.p02_p01; dir = 0;
      regions.push({ M, p, T, p0, dir });
    } else { ok = false; note = 'The cowl shock needed to turn the flow back to axial would detach (unstart risk).'; }
  }
  return { ok, note, shocks, regions, recovery: p0, Mexit: M, pRatio: p, TRatio: T, turning: dir };
}

// Shock-on-lip geometry in units of the capture height. Returns ramp corners and the lip point.
export function inletGeometry(res, { capture = 1 } = {}) {
  const sh = res.shocks.filter(s => s.kind === 'oblique');
  if (!sh.length) return { corners: [[0, 0]], lip: [0.2, capture], shocks: [] };
  // first shock from origin reaches the lip at height = capture
  const ang1 = sh[0].beta;
  const lip = [capture / Math.tan(ang1), capture];
  const corners = [[0, 0]], lines = [[[0, 0], lip]];
  let c = [0, 0], wallDir = 0;
  for (let k = 1; k < sh.length; k++) {
    wallDir += sh[k - 1].theta;
    // corner on wall: c + t*(cos wallDir, sin wallDir); shock at angle wallDir + beta_k must hit the lip
    const a = wallDir + sh[k].beta, d = [Math.cos(wallDir), Math.sin(wallDir)], e = [Math.cos(a), Math.sin(a)];
    // c + t d + u e = lip
    const rx = lip[0] - c[0], ry = lip[1] - c[1], det = d[0] * e[1] - d[1] * e[0];
    const t = (rx * e[1] - ry * e[0]) / det;
    c = [c[0] + t * d[0], c[1] + t * d[1]];
    corners.push(c); lines.push([c, lip]);
  }
  wallDir += sh[sh.length - 1].theta;
  return { corners, lip, shocks: lines, wallDir };
}
