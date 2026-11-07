// Supersonic airfoil analysis by shock-expansion theory, plus linear (Ackeret) and second-order
// (Busemann) theory for comparison and a compressible flat-plate skin-friction estimate.
// Pure functions, no DOM. Built on the gas-dynamics relations in gasdyn.js.
//
// Frames: the free stream flows along +x. The airfoil (unit chord, leading edge at the origin) is
// rotated nose-up by α about its leading edge. Each surface is marched from the leading edge in a
// frame where the flow is on the +y side of the wall (the lower surface is mirrored y → −y), so a
// wall turning toward +y compresses the flow and one turning away expands it.
//
// Field states are relative to the free stream: { M, th (flow angle), p, T, rho, p0 } (p0 = p0/p0∞).
import * as G from './gasdyn.js';

const { isen, DEG } = G;
export { DEG };

// ---------- sharp supersonic sections (unit chord, LE at origin) ----------
export const SHAPES = [
  { id: 'diamond', label: 'Diamond (double wedge)', note: 'Two flat faces per side. The classic supersonic section: one shock at the nose, one expansion fan at the crest.' },
  { id: 'hexagon', label: 'Hexagonal (modified double wedge)', note: 'Wedge, flat middle, wedge. Stiffer than a diamond for the same thickness (used on early missiles and fins).' },
  { id: 'biconvex', label: 'Biconvex (parabolic arc)', note: 'Smoothly curved faces: the flow expands continuously along the surface, so the Cp falls steadily.' },
  { id: 'plate', label: 'Flat plate', note: 'Zero thickness: lift only from angle of attack. The textbook limit of every thin section.' },
];

// Returns { name, x, z } ordered upper TE → LE → lower TE (Selig order), unit chord.
export function sharpAirfoil(id, { t = 0.06, xm = 0.5, flat = 0.4, n = 60 } = {}) {
  const up = [];
  if (id === 'plate') t = 0;
  if (id === 'diamond') {
    const n1 = Math.max(2, Math.round(n * xm)), n2 = Math.max(2, n - n1);
    for (let i = 0; i <= n1; i++) { const x = xm * i / n1; up.push([x, 0.5 * t * x / xm]); }
    for (let i = 1; i <= n2; i++) { const x = xm + (1 - xm) * i / n2; up.push([x, 0.5 * t * (1 - x) / (1 - xm)]); }
  } else if (id === 'hexagon') {
    const a = 0.5 * (1 - flat), b = a + flat, k = Math.max(2, Math.round(n / 3));
    for (let i = 0; i <= k; i++) { const x = a * i / k; up.push([x, 0.5 * t * x / a]); }
    for (let i = 1; i <= k; i++) up.push([a + flat * i / k, 0.5 * t]);
    for (let i = 1; i <= k; i++) { const x = b + (1 - b) * i / k; up.push([x, 0.5 * t * (1 - x) / (1 - b)]); }
  } else if (id === 'biconvex') {
    for (let i = 0; i <= n; i++) { const x = i / n; up.push([x, 2 * t * x * (1 - x)]); }
  } else { // flat plate
    for (let i = 0; i <= n; i++) up.push([i / n, 0]);
  }
  const lo = up.map(([x, z]) => [x, -z]);
  const P = [...up.slice().reverse(), ...lo.slice(1)];
  const s = SHAPES.find(q => q.id === id);
  const name = id === 'plate' ? 'Flat plate' : `${s ? s.label.split(' (')[0] : id} ${(t * 100).toFixed(1)}%`;
  return { name, x: P.map(p => p[0]), z: P.map(p => p[1]) };
}

// Split a closed contour into upper and lower surfaces, each running LE → TE.
export function splitSurfaces(x, z) {
  let iLE = 0;
  for (let i = 1; i < x.length; i++) if (x[i] < x[iLE] || (x[i] === x[iLE] && Math.abs(z[i]) < Math.abs(z[iLE]))) iLE = i;
  const a = [], b = [];
  for (let i = iLE; i >= 0; i--) a.push([x[i], z[i]]);
  for (let i = iLE; i < x.length; i++) b.push([x[i], z[i]]);
  const mean = S => S.reduce((s, p) => s + p[1], 0) / S.length;
  return mean(a) >= mean(b) ? { upper: a, lower: b } : { upper: b, lower: a };
}

// ---------- state helpers ----------
function mkState(M, th, p0r, F) {
  const T = isen.T0_T(F.M, F.g) / isen.T0_T(M, F.g);
  const p = p0r * isen.p0_p(F.M, F.g) / isen.p0_p(M, F.g);
  return { M, th, p, T, rho: p / T, p0: p0r };
}
// turn a uniform supersonic stream by dth (+ = compression through an oblique shock, − = Prandtl–Meyer fan)
function turn(s, dth, F) {
  if (Math.abs(dth) < 1e-12) return { type: 'none', down: s };
  if (dth > 0) {
    const b = G.betaFromTheta(s.M, dth, F.g, 'weak');
    if (isNaN(b)) return { type: 'detached', dth, thetaMax: G.thetaMax(s.M, F.g) };
    const os = G.obliqueShock(s.M, b, F.g);
    return { type: 'shock', beta: b, ray: s.th + b, down: mkState(os.M2, s.th + dth, s.p0 * os.p02_p01, F) };
  }
  const nu1 = isen.nu(s.M, F.g), nu2 = nu1 - dth;
  if (nu2 >= isen.numax(F.g) * 0.999) return { type: 'vacuum', dth };
  const M2 = G.M_from_nu(nu2, F.g);
  return { type: 'fan', a1: s.th + isen.mu(s.M), a2: s.th + dth + isen.mu(M2), K: nu1 + s.th, p0: s.p0, down: mkState(M2, s.th + dth, s.p0, F) };
}
// state inside a centred fan at ray angle a (θ + μ = a with ν + θ = K)
function fanState(w, a, F) {
  const f = M => (w.K - isen.nu(M, F.g)) + Math.asin(1 / M) - a;
  const M = G.bisect(f, Math.min(w.Mlo, w.Mhi), Math.max(w.Mlo, w.Mhi), 1e-7, 50);
  return mkState(isFinite(M) ? M : w.Mhi, w.K - isen.nu(isFinite(M) ? M : w.Mhi, F.g), w.p0, F);
}
const below = (px, py, ox, oy, a) => Math.cos(a) * (py - oy) - Math.sin(a) * (px - ox) < 0; // point clockwise of ray

// ---------- one surface (frame: flow on +y side) ----------
// V: [[x, y], ...] LE → TE in the surface frame. Returns panel states, waves and the LE shock path.
function marchSurface(V, F) {
  const free = F.free, K = V.length - 1;
  const th = [], ds = [];
  for (let i = 0; i < K; i++) { const dx = V[i + 1][0] - V[i][0], dy = V[i + 1][1] - V[i][1]; th.push(Math.atan2(dy, dx)); ds.push(Math.hypot(dx, dy)); }
  const S = new Array(K);
  const le = turn(free, th[0], F);
  if (le.type === 'detached') return { fail: 'detached', dth: th[0], thetaMax: le.thetaMax };
  if (le.type === 'vacuum') return { fail: 'vacuum' };
  S[0] = le.down;
  if (!(S[0].M > 1)) return { fail: 'subsonic', at: 0, x: V[0][0] }; // weak shock near θmax can leave M < 1 behind it
  const nu = [isen.nu(S[0].M, F.g)];
  for (let i = 1; i < K; i++) {
    const n2 = nu[i - 1] - (th[i] - th[i - 1]);           // isentropic turning along the surface
    if (!(n2 > 1e-9)) return { fail: 'subsonic', at: i, x: V[i][0] };
    const n3 = Math.min(n2, isen.numax(F.g) * 0.999);
    nu.push(n3);
    S[i] = mkState(G.M_from_nu(n3, F.g), th[i], S[0].p0, F);
  }
  // wave fronts leaving each vertex: a1 = upstream Mach line, a2 = downstream Mach line
  const verts = [];
  if (le.type === 'fan') verts.push({ x: V[0][0], y: V[0][1], a1: le.a1, a2: le.a2, fan: { K: le.K, p0: le.p0, Mlo: free.M, Mhi: S[0].M } });
  else verts.push({ x: V[0][0], y: V[0][1], a1: S[0].th + isen.mu(S[0].M), a2: S[0].th + isen.mu(S[0].M) });
  for (let i = 1; i < K; i++) {
    const a1 = S[i - 1].th + isen.mu(S[i - 1].M), a2 = S[i].th + isen.mu(S[i].M);
    const v = { x: V[i][0], y: V[i][1], a1, a2 };
    if (a2 < a1 - 1e-6) v.fan = { K: nu[i - 1] + S[i - 1].th, p0: S[0].p0, Mlo: S[i - 1].M, Mhi: S[i].M };
    verts.push(v);
  }
  return { V, th, ds, S, nu, le, verts };
}

// march the leading-edge shock outward, bending it as each Mach wave from the surface reaches it
function shockPath(D, F) {
  if (D.le.type !== 'shock') return null;
  const pts = [[D.V[0][0], D.V[0][1]]];
  let ang = D.le.ray;
  const waves = D.verts.slice(1).map((v, i) => ({ x: v.x, y: v.y, a: v.a2, th: D.S[i + 1].th }));
  if (D.te) waves.push({ x: D.te.x, y: D.te.y, a: D.te.a2, th: D.te.down.th });
  for (const w of waves) {
    const [sx, sy] = pts[pts.length - 1];
    // intersect ray (sx,sy)+t(cos ang, sin ang) with wave (w.x,w.y)+u(cos a, sin a)
    const c1 = Math.cos(ang), s1 = Math.sin(ang), c2 = Math.cos(w.a), s2 = Math.sin(w.a);
    const den = c1 * s2 - s1 * c2; if (Math.abs(den) < 1e-12) continue;
    const t = ((w.x - sx) * s2 - (w.y - sy) * c2) / den, u = ((w.x - sx) * s1 - (w.y - sy) * c1) / den;
    if (t <= 1e-9 || u <= 0) continue;
    pts.push([sx + t * c1, sy + t * s1]);
    const b = w.th > 0 ? G.betaFromTheta(F.M, w.th, F.g, 'weak') : F.mu;
    if (isFinite(b)) ang = b;
  }
  return { pts, finalAng: ang };
}

// ---------- full solve ----------
// opts: { x, z (contour), alpha (deg), M, g, viscous, Re, xtr (trip x/c, 1 = free), Retr }
export function solveSupersonic(o) {
  const g = o.g || 1.4, M = o.M, alpha = (o.alpha || 0) * DEG;
  const F = { M, g, mu: Math.asin(1 / M) };
  F.free = { M, th: 0, p: 1, T: 1, rho: 1, p0: 1 };
  const q = 0.5 * g * M * M, bet = Math.sqrt(M * M - 1);
  const { upper, lower } = splitSurfaces(o.x, o.z);
  // rotate nose-up by α about the leading edge (world frame)
  const LE = upper[0], ca = Math.cos(alpha), sa = Math.sin(alpha);
  const rot = ([x, z]) => [LE[0] + (x - LE[0]) * ca + (z - LE[1]) * sa, LE[1] - (x - LE[0]) * sa + (z - LE[1]) * ca];
  const Uw = upper.map(rot), Lw = lower.map(rot);
  const body = [...Uw.slice().reverse(), ...Lw.slice(1)];
  const base = { ok: false, M, g, alpha: o.alpha || 0, name: o.name, upperW: Uw, lowerW: Lw, body, chordUpper: upper, chordLower: lower, F };
  if (!(M > 1)) return { ...base, fail: 'subsonic-freestream' };
  const D = [marchSurface(Uw, F), marchSurface(Lw.map(([x, y]) => [x, -y]), F)];
  const bad = D.find(d => d.fail);
  if (bad) return { ...base, fail: bad.fail, detail: bad, side: D[0].fail ? 'upper' : 'lower' };

  // ---- trailing edge: both streams turn to a common direction δ with equal pressure (slip line) ----
  const su = D[0].S[D[0].S.length - 1], sl = D[1].S[D[1].S.length - 1];
  const pAfter = (s, dth) => { const w = turn(s, dth, F); return w.down ? w.down.p : NaN; };
  const f = d => pAfter(su, d - su.th) - pAfter(sl, -d - sl.th);
  // bracket δ by the largest turn each side can make: an attached shock (θmax) or a fan short of ν_max
  const tmU = G.thetaMax(su.M, g), tmL = G.thetaMax(sl.M, g), numax = isen.numax(g) * 0.995;
  let dH = Math.min(su.th + tmU, -sl.th + (numax - isen.nu(sl.M, g))) - 1e-7;
  let dL = Math.max(-sl.th - tmL, su.th - (numax - isen.nu(su.M, g))) + 1e-7;
  let delta = dL < dH ? G.bisect(f, dL, dH) : NaN;
  if (!isFinite(delta)) delta = 0.5 * (su.th - sl.th);
  for (const [d, s, dd] of [[D[0], su, delta - su.th], [D[1], sl, -delta - sl.th]]) {
    const w = turn(s, dd, F), last = d.V[d.V.length - 1];
    d.te = { x: last[0], y: last[1], ...w, down: w.down || s };
    d.te.a2 = w.type === 'shock' ? w.ray : w.type === 'fan' ? w.a2 : s.th + isen.mu(s.M);
    if (w.type === 'fan') d.te.fan = { K: w.K, p0: w.p0, Mlo: s.M, Mhi: w.down.M };
  }
  for (const d of D) d.shock = shockPath(d, F);

  // ---- surface distributions and loads ----
  const C2 = ((g + 1) * M ** 4 - 4 * bet * bet) / (2 * bet ** 4); // Busemann second-order coefficient
  const surf = [], force = { fx: 0, fy: 0, m: 0, fxf: 0, fyf: 0, lx: 0, ly: 0, lm: 0 };
  const Q = rot([LE[0] + 0.25, LE[1]]); // quarter chord (world)
  const Re = o.Re || 1e7, xtr = o.xtr ?? 1, Retr = o.Retr || 1e6;
  for (let side = 0; side < 2; side++) {
    const d = D[side], sg = side === 0 ? 1 : -1, W = side === 0 ? Uw : Lw, chordS = side === 0 ? upper : lower;
    const out = { x: [], xc: [], cp: [], cpLin: [], cpBus: [], M: [], cf: [], turb: [] };
    let sLen = 0;
    for (let i = 0; i < d.S.length; i++) {
      const st = d.S[i], A = W[i], B = W[i + 1], dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1e-12;
      const cp = (st.p - 1) / q, thf = d.th[i];
      const cpLin = 2 * thf / bet, cpBus = cpLin + C2 * thf * thf;
      // outward normal: left of travel on the upper surface, right of travel on the lower
      const nx = -sg * dy / L, ny = sg * dx / L, mx = 0.5 * (A[0] + B[0]), my = 0.5 * (A[1] + B[1]);
      const Fx = -cp * nx * L, Fy = -cp * ny * L, FxL = -cpLin * nx * L, FyL = -cpLin * ny * L;
      force.fx += Fx; force.fy += Fy; force.m += (mx - Q[0]) * Fy - (my - Q[1]) * Fx;
      force.lx += FxL; force.ly += FyL; force.lm += (mx - Q[0]) * FyL - (my - Q[1]) * FxL;
      // skin friction: Eckert reference temperature on the local edge state, laminar → turbulent
      let cfq = 0, turb = false;
      sLen += 0.5 * L;
      const xc = 0.5 * (chordS[i][0] + chordS[i + 1][0]) - LE[0];
      if (o.viscous) {
        const ue = st.M * Math.sqrt(st.T) / M, mue = st.T ** 0.76;
        const Rex = Re * st.rho * ue / mue * Math.max(sLen, 1e-6);
        turb = xc >= xtr || Rex > Retr;
        const r = turb ? 0.89 : 0.85, Taw = 1 + r * 0.5 * (g - 1) * st.M * st.M;
        const Ts = 1 + 0.032 * st.M * st.M + 0.58 * (Taw - 1);
        const Res = Rex * (1 / Ts) ** 1.76;
        const cfs = turb ? 0.370 / Math.log10(Math.max(Res, 10)) ** 2.584 : 0.664 / Math.sqrt(Math.max(Res, 1));
        cfq = cfs / Ts * st.rho * ue * ue; // based on free-stream dynamic pressure
        const tx = dx / L, ty = dy / L;
        force.fxf += cfq * tx * L; force.fyf += cfq * ty * L; force.m += (mx - Q[0]) * cfq * ty * L - (my - Q[1]) * cfq * tx * L;
      }
      sLen += 0.5 * L;
      out.x.push(xc); out.cp.push(cp); out.cpLin.push(cpLin); out.cpBus.push(cpBus); out.M.push(st.M); out.cf.push(cfq); out.turb.push(turb);
    }
    surf.push(out);
  }
  const cl = force.fy + force.fyf, cdw = force.fx, cdf = force.fxf;
  const res = {
    ...base, ok: true, D, delta, surf,
    cl, cd: cdw + cdf, cdw, cdf, cm: -force.m,
    clLin: force.ly, cdwLin: force.lx, cmLin: -force.lm,
    clAckeretPlate: 4 * alpha / bet,
    beta: D.map(d => d.le.type === 'shock' ? d.le.beta : null),
    leType: D.map(d => d.le.type),
    q, bet, viscous: !!o.viscous, Re,
  };
  res.peak = { Mmax: Math.max(...surf.flatMap(s => s.M)), Mmin: Math.min(...surf.flatMap(s => s.M)) };
  res.sample = makeSampler(res);
  return res;
}

// ---------- field sampler: state at any world point ----------
function makeSampler(R) {
  const F = R.F, free = F.free, [Uw, Lw] = [R.upperW, R.lowerW];
  const LE = Uw[0], TE = [(Uw[Uw.length - 1][0] + Lw[Lw.length - 1][0]) / 2, (Uw[Uw.length - 1][1] + Lw[Lw.length - 1][1]) / 2];
  let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
  for (const [x, y] of R.body) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
  const inside = (x, y) => x >= bx0 && x <= bx1 && y >= by0 && y <= by1 && pip(x, y, R.body);
  const interp = (S, x) => { for (let i = 0; i < S.length - 1; i++) if ((S[i][0] - x) * (S[i + 1][0] - x) <= 0 && S[i][0] !== S[i + 1][0]) return S[i][1] + (x - S[i][0]) / (S[i + 1][0] - S[i][0]) * (S[i + 1][1] - S[i][1]); return NaN; };
  // dividing line between the two surfaces' flows, tabulated along x (mean of the surfaces)
  const NT = 512, mid = new Float64Array(NT + 1), span = TE[0] - LE[0] || 1;
  for (let k = 0; k <= NT; k++) {
    const x = LE[0] + span * k / NT, a = interp(Uw, x), b = interp(Lw, x);
    mid[k] = isFinite(a) && isFinite(b) ? 0.5 * (a + b) : LE[1] + (TE[1] - LE[1]) * k / NT;
  }
  const upperSide = (x, y) => {
    if (x <= LE[0]) return y >= LE[1];
    if (x >= TE[0]) return y - TE[1] >= Math.tan(R.delta) * (x - TE[0]);
    const f = (x - LE[0]) / span * NT, k = Math.min(NT - 1, f | 0), w = f - k;
    return y >= mid[k] + w * (mid[k + 1] - mid[k]);
  };
  const one = (D, x, y) => {
    // 1) ahead of the leading-edge wave → free stream
    if (x <= D.V[0][0] + 1e-12) return free;
    if (D.shock) {
      const P = D.shock.pts; let ys = NaN;
      for (let i = 0; i < P.length - 1; i++) if (x >= P[i][0] && x <= P[i + 1][0]) { ys = P[i][1] + (x - P[i][0]) * (P[i + 1][1] - P[i][1]) / (P[i + 1][0] - P[i][0]); break; }
      if (!isFinite(ys)) { const L = P[P.length - 1]; ys = L[1] + (x - L[0]) * Math.tan(D.shock.finalAng); }
      if (y > ys) return free;
    } else {
      const v = D.verts[0];
      if (!below(x, y, v.x, v.y, v.a1)) return free;
    }
    // 2) behind the trailing-edge shock (it is steeper than the crest fan, so it cuts through that fan's rays)
    const t0 = D.te;
    if (t0.type === 'shock' && x > t0.x && below(x, y, t0.x, t0.y, t0.ray)) return t0.down;
    // 3) last vertex whose downstream Mach line the point is past (wave fronts are ordered along the surface)
    const n = D.verts.length, past = i => i === 0 ? below(x, y, D.verts[0].x, D.verts[0].y, D.verts[0].a2) || !D.verts[0].fan : below(x, y, D.verts[i].x, D.verts[i].y, D.verts[i].a2);
    if (D.verts[0].fan && !below(x, y, D.verts[0].x, D.verts[0].y, D.verts[0].a2)) return fanState(D.verts[0].fan, Math.atan2(y - D.verts[0].y, x - D.verts[0].x), F);
    let lo = 0, hi = n - 1;
    if (past(hi)) lo = hi;
    else while (hi - lo > 1) { const m = (lo + hi) >> 1; if (past(m)) lo = m; else hi = m; }
    if (lo < n - 1) {
      const v = D.verts[lo + 1];
      if (v.fan && below(x, y, v.x, v.y, v.a1)) return fanState(v.fan, Math.atan2(y - v.y, x - v.x), F);
      return D.S[lo];
    }
    // 4) trailing-edge wave
    const t = D.te;
    if (t.type === 'shock') return D.S[D.S.length - 1];
    if (t.type === 'fan') {
      if (below(x, y, t.x, t.y, t.a2)) return t.down;
      if (below(x, y, t.x, t.y, t.a1)) return fanState(t.fan, Math.atan2(y - t.y, x - t.x), F);
    }
    return D.S[D.S.length - 1];
  };
  return (x, y) => {
    if (inside(x, y)) return null;
    if (upperSide(x, y)) return one(R.D[0], x, y);
    const s = one(R.D[1], x, -y);
    return s === free ? free : { ...s, th: -s.th };
  };
}
function pip(x, y, P) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; }
  return c;
}

// Mach and angle limits that explain a failed theory solve, for the UI.
export function explainFailure(R) {
  if (R.fail === 'subsonic-freestream') return { t: 'Theory needs supersonic flow', d: 'Shock-expansion theory only works for M∞ > 1. Below that, use Live CFD (Euler), or the Analyze tab for fully subsonic flow.' };
  if (R.fail === 'detached') {
    const d = R.detail;
    const round = d.dth > 40 * DEG;
    return { t: round ? 'Round nose: the bow shock stands off' : 'Leading-edge shock detaches',
      d: round ? `The nose turns the flow by ${(d.dth / DEG).toFixed(0)}°, but at M∞ = ${R.M.toFixed(2)} an attached shock can turn it at most ${(d.thetaMax / DEG).toFixed(1)}°. A rounded nose always has a detached bow shock with a small subsonic region behind it, which shock-expansion theory cannot model. Switch to <b>Live CFD (Euler)</b> to see it.`
        : `The ${R.side} surface turns the flow by ${(d.dth / DEG).toFixed(1)}° at the nose, more than the ${(d.thetaMax / DEG).toFixed(1)}° an attached shock can manage at M∞ = ${R.M.toFixed(2)}. Lower α or thickness, raise the Mach number, or switch to Live CFD (Euler).` };
  }
  if (R.fail === 'subsonic') return { t: 'Flow is compressed back to subsonic', d: 'Isentropic compression along the surface slowed the flow below Mach 1, so the theory breaks down. Reduce thickness or α, or use Live CFD (Euler).' };
  return { t: 'No theory solution', d: 'The expansion would exceed the Prandtl–Meyer limit. Reduce α.' };
}
