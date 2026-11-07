// Collaborative flight: the physics and algorithms behind several aircraft flying together.
// (1) Formation flight: each aircraft's wake as a pair of semi-infinite trailing vortices (Biot–Savart, Burnham–Hallock
//     core), the upwash it puts on aircraft behind, and the induced-drag and fuel saving that gives (Blake & Multhopp
//     1998; NASA Autonomous Formation Flight, 2001; Airbus fello'fly, 2021). Patterns include display-team diamonds and
//     deltas as well as echelons and V formations.
// (2) Fleet tasks: sharing jobs (survey areas, deliveries) across a fleet with the Hungarian algorithm (Kuhn 1955,
//     Munkres 1957) for least total flying, the bottleneck version for the earliest finish, and Bertsekas's auction
//     (1988) as the distributed alternative.
// (3) Search and rescue: several aircraft locating a distress beacon by bearings (triangulation) or time differences of
//     arrival, Gauss–Newton least squares, and the Cramér–Rao lower bound (Torrieri 1984).
// (4) Rendezvous: timing a join-up so every aircraft arrives together, within its speed range, and the fuel it costs.
import { polar, fuelFlow } from './performance.js';

// ---------- (1) wake and formation ----------
// Induced velocity (v lateral, w up) at (y, z) from a trailing vortex starting X metres upstream of the point, at
// (yv, zv), of a lifting wing's tip on side s (+1 right, −1 left), circulation Γ, core radius rc.
export function vortexAt(y, z, yv, zv, s, G, rc, X = Infinity) {
  const dy = y - yv, dz = z - zv, r2 = dy * dy + dz * dz, f = X === Infinity ? 1 : 0.5 * (1 + X / Math.sqrt(X * X + r2));
  const k = s * G / (2 * Math.PI) / (r2 + rc * rc) * f;
  return { v: -k * dz, w: k * dy };
}
// Formation of identical aircraft. pos: [{x (m, downstream positive), y (m, right), z (m, up)}]. Each aircraft flies
// with elliptic loading: lift W, circulation Γ = W/(ρ V b₀), tip vortices b₀ = πb/4 apart. Returns, per aircraft, the
// mean upwash and the induced-drag change from all the others' wakes.
// The vortex core spreads with age like a Lamb–Oseen vortex with an eddy viscosity ν = 2×10⁻⁴·Γ (Squire 1965):
// rc² = rc₀² + 5.03·ν·t, t = X/V the time since the generating aircraft passed.
export function formation({ pos, b, W, rho, V, rcFrac = 0.05, nuFrac = 2e-4, n = 41 }) {
  const b0 = Math.PI * b / 4, G = W / (rho * V * b0), rc = rcFrac * b, q = 0.5 * rho * V * V, Di0 = W * W / (q * Math.PI * b * b);
  // Gauss–Chebyshev points across the span carry the elliptic lift exactly: l(y) ∝ √(1 − (2y/b)²)
  const ys = [], wt = [];
  for (let k = 1; k <= n; k++) { const th = k * Math.PI / (n + 1); ys.push(-0.5 * b * Math.cos(th)); wt.push(Math.sin(th) ** 2); }
  const wsum = wt.reduce((a, c) => a + c, 0);
  return pos.map((p, i) => {
    let wbar = 0, roll = 0;
    ys.forEach((yy, k) => {
      let w = 0;
      pos.forEach((o, j) => {
        if (j === i) return;
        const X = p.x - o.x, rcx = Math.sqrt(rc * rc + 5.03 * nuFrac * G * Math.max(0, X) / V);
        w += vortexAt(p.y + yy, p.z, o.y + b0 / 2, o.z, 1, G, rcx, X).w + vortexAt(p.y + yy, p.z, o.y - b0 / 2, o.z, -1, G, rcx, X).w;
      });
      wbar += wt[k] * w / wsum; roll += wt[k] * w * yy / wsum;
    });
    const dD = -W * wbar / V;   // lift tilted forward by the upwash angle w/V
    return { wbar, dD, ratio: -dD / Di0, roll, Di0, G, rc };
  });
}
// Positions for a pattern: lateral spacing dy (m, centre to centre), longitudinal dx (m), vertical dz (m)
export function pattern(kind, N, dy, dx, dz = 0) {
  const out = [];
  for (let i = 0; i < N; i++) {
    if (kind === 'echelon') out.push({ x: i * dx, y: i * dy, z: i * dz });
    else if (kind === 'abreast') out.push({ x: 0, y: (i - (N - 1) / 2) * dy, z: 0 });
    else if (kind === 'diamond' || kind === 'delta') {
      // display-team slots: lead, left and right wing, slot behind the lead (stepped down), then for the delta two
      // more on the outside of the wings
      const slots = [[0, 0], [1, -1], [1, 1], [2, 0], [2, -2], [2, 2], [3, -1], [3, 1]];
      const [r, c] = slots[i] || [Math.ceil(i / 2) + 1, (i % 2 ? 1 : -1) * Math.ceil(i / 2)];
      out.push({ x: r * dx, y: c * dy, z: -r * dz });
    }
    else { const k = Math.ceil(i / 2), side = i % 2 ? 1 : -1; out.push({ x: k * dx, y: i ? side * k * dy : 0, z: k * dz }); }
  }
  return out;
}
// Induced share of total drag in level flight, from the aircraft's own polar
export function dragSplit(ac, atm, V, W) {
  const q = 0.5 * atm.rho * V * V, { CD0, K } = polar(ac, V / atm.a), CL = W / (q * ac.S);
  const D0 = q * ac.S * CD0, Di = q * ac.S * K * CL * CL;
  return { D0, Di, D: D0 + Di, CL, share: Di / (D0 + Di), fuel: fuelFlow(ac, atm, V, D0 + Di, 'max') };
}

// ---------- (2) assignment ----------
// Hungarian algorithm (Jonker–Volgenant style shortest augmenting path, O(n³)) for a rectangular cost matrix
// rows ≤ columns or not; returns col assigned to each row (−1 if none) and the total.
export function hungarian(cost) {
  const nr = cost.length, nc = cost[0].length, n = Math.max(nr, nc), big = 1e18;
  const a = (i, j) => (i < nr && j < nc ? cost[i][j] : 0);
  const u = new Float64Array(n + 1), v = new Float64Array(n + 1), p = new Int32Array(n + 1), way = new Int32Array(n + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i; let j0 = 0; const minv = new Float64Array(n + 1).fill(big), used = new Uint8Array(n + 1);
    do {
      used[j0] = 1; const i0 = p[j0]; let delta = big, j1 = 0;
      for (let j = 1; j <= n; j++) if (!used[j]) { const cur = a(i0 - 1, j - 1) - u[i0] - v[j]; if (cur < minv[j]) { minv[j] = cur; way[j] = j0; } if (minv[j] < delta) { delta = minv[j]; j1 = j; } }
      for (let j = 0; j <= n; j++) if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const asg = new Array(nr).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j] && p[j] <= nr && j <= nc) asg[p[j] - 1] = j - 1;
  return { asg, total: asg.reduce((s, j, i) => s + (j >= 0 ? cost[i][j] : 0), 0) };
}
// Bottleneck assignment: the smallest possible worst cost (every task done soonest), then the least total among those
export function bottleneck(cost) {
  const nr = cost.length, nc = cost[0].length, vals = [...new Set(cost.flat())].sort((x, y) => x - y), need = Math.min(nr, nc);
  const feasible = th => {   // bipartite matching on edges with cost ≤ th (Kuhn's augmenting paths)
    const mt = new Array(nc).fill(-1);
    const tryK = (i, seen) => { for (let j = 0; j < nc; j++) if (cost[i][j] <= th && !seen[j]) { seen[j] = 1; if (mt[j] < 0 || tryK(mt[j], seen)) { mt[j] = i; return true; } } return false; };
    let m = 0; for (let i = 0; i < nr; i++) if (tryK(i, new Uint8Array(nc))) m++;
    return m >= need;
  };
  let lo = 0, hi = vals.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (feasible(vals[mid])) hi = mid; else lo = mid + 1; }
  const th = vals[lo], pen = 1e6 * (1 + Math.max(...vals));
  const h = hungarian(cost.map(r => r.map(c => (c <= th + 1e-12 ? c : pen))));
  return { asg: h.asg, total: h.asg.reduce((s, j, i) => s + (j >= 0 ? cost[i][j] : 0), 0), worst: th };
}
// Forward auction (Bertsekas): agents bid for tasks; ends within n·ε of the optimal total. rows ≤ columns.
export function auction(cost, eps) {
  const nr = cost.length, nc = cost[0].length, price = new Float64Array(nc), owner = new Array(nc).fill(-1), asg = new Array(nr).fill(-1);
  let bids = 0, free = [...Array(nr).keys()];
  while (free.length && bids < 1e6) {
    const i = free.pop(); let best = -Infinity, second = -Infinity, bj = -1;
    for (let j = 0; j < nc; j++) { const val = -cost[i][j] - price[j]; if (val > best) { second = best; best = val; bj = j; } else if (val > second) second = val; }
    if (second === -Infinity) second = best;
    price[bj] += best - second + eps; bids++;
    if (owner[bj] >= 0) { asg[owner[bj]] = -1; free.push(owner[bj]); }
    owner[bj] = i; asg[i] = bj;
  }
  return { asg, total: asg.reduce((s, j, i) => s + cost[i][j], 0), bids, price: [...price] };
}
export function bruteForce(cost, objective = 'sum') {
  const nr = cost.length, nc = cost[0].length; let best = Infinity, bestA = null;
  const rec = (i, used, a, s, w) => {
    if (i === nr) { const v = objective === 'sum' ? s : w + s * 1e-9; if (v < best) { best = v; bestA = [...a]; } return; }
    for (let j = 0; j < nc; j++) if (!used[j]) { used[j] = 1; a.push(j); rec(i + 1, used, a, s + cost[i][j], Math.max(w, cost[i][j])); a.pop(); used[j] = 0; }
  };
  rec(0, new Uint8Array(nc), [], 0, 0);
  return { asg: bestA, total: bestA.reduce((s, j, i) => s + cost[i][j], 0), worst: Math.max(...bestA.map((j, i) => cost[i][j])) };
}

// ---------- (3) locating a beacon ----------
// Bearing from a sensor to a point, clockwise from north (y), in radians
export const bearing = (s, p) => Math.atan2(p[0] - s[0], p[1] - s[1]);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const inv2 = M => { const d = M[0][0] * M[1][1] - M[0][1] * M[1][0]; return [[M[1][1] / d, -M[0][1] / d], [-M[1][0] / d, M[0][0] / d]]; };
// Cramér–Rao lower bound on the 2-D position covariance
export function crlb(sensors, p, mode, sigma) {
  let J = [[0, 0], [0, 0]];
  if (mode === 'bearing') {
    for (const s of sensors) { const dx = p[0] - s[0], dy = p[1] - s[1], r2 = dx * dx + dy * dy, g = [dy / r2, -dx / r2]; for (let a = 0; a < 2; a++) for (let c = 0; c < 2; c++) J[a][c] += g[a] * g[c] / sigma ** 2; }
  } else {
    const u = sensors.map(s => { const dx = p[0] - s[0], dy = p[1] - s[1], r = Math.hypot(dx, dy); return [dx / r, dy / r]; });
    const H = u.slice(1).map(ui => [ui[0] - u[0][0], ui[1] - u[0][1]]), m = H.length;
    // time differences against sensor 0 share its noise: R = σ²(I + 11ᵀ), R⁻¹ = (I − 11ᵀ/(m+1))/σ²
    for (let i = 0; i < m; i++) for (let k = 0; k < m; k++) { const ri = ((i === k ? 1 : 0) - 1 / (m + 1)) / sigma ** 2; for (let a = 0; a < 2; a++) for (let c = 0; c < 2; c++) J[a][c] += H[i][a] * ri * H[k][c]; }
  }
  const det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
  return det > 1e-30 ? inv2(J) : null;
}
export function measure(sensors, p, mode) {
  if (mode === 'bearing') return sensors.map(s => bearing(s, p));
  const d0 = Math.hypot(p[0] - sensors[0][0], p[1] - sensors[0][1]);
  return sensors.slice(1).map(s => Math.hypot(p[0] - s[0], p[1] - s[1]) - d0);
}
// Gauss–Newton fix from measurements z; starts from the bearing lines' least-squares crossing (Stansfield) or the sensors' centroid
export function locate(sensors, z, mode, x0 = null, it = 20) {
  let p;
  if (x0) p = [...x0];
  else if (mode === 'bearing') {
    // each bearing line: cos θ·x − sin θ·y = cos θ·xs − sin θ·ys
    let A = [[0, 0], [0, 0]], bb = [0, 0];
    sensors.forEach((s, i) => { const r = [Math.cos(z[i]), -Math.sin(z[i])], c = r[0] * s[0] + r[1] * s[1]; for (let a = 0; a < 2; a++) { bb[a] += r[a] * c; for (let k = 0; k < 2; k++) A[a][k] += r[a] * r[k]; } });
    const Ai = inv2(A); p = [Ai[0][0] * bb[0] + Ai[0][1] * bb[1], Ai[1][0] * bb[0] + Ai[1][1] * bb[1]];
    if (!isFinite(p[0])) p = [0, 0];
  } else { p = [0, 0]; sensors.forEach(s => { p[0] += s[0] / sensors.length; p[1] += s[1] / sensors.length; }); p[1] += 1; }
  for (let k = 0; k < it; k++) {
    const h = measure(sensors, p, mode), e = 1e-3, H = [];
    for (let a = 0; a < 2; a++) { const q = [...p]; q[a] += e; const hq = measure(sensors, q, mode); H.push(hq.map((v, i) => (mode === 'bearing' ? wrap(v - h[i]) : v - h[i]) / e)); }
    const r = z.map((v, i) => (mode === 'bearing' ? wrap(v - h[i]) : v - h[i]));
    let A = [[0, 0], [0, 0]], g = [0, 0];
    for (let i = 0; i < r.length; i++) for (let a = 0; a < 2; a++) { g[a] += H[a][i] * r[i]; for (let c = 0; c < 2; c++) A[a][c] += H[a][i] * H[c][i]; }
    const det = A[0][0] * A[1][1] - A[0][1] * A[1][0]; if (Math.abs(det) < 1e-30) break;
    const Ai = inv2(A), dp = [Ai[0][0] * g[0] + Ai[0][1] * g[1], Ai[1][0] * g[0] + Ai[1][1] * g[1]];
    p = [p[0] + dp[0], p[1] + dp[1]];
    if (Math.hypot(...dp) < 1e-6) break;
  }
  return p;
}
export function monteCarlo(sensors, p, mode, sigma, n, rnd) {
  const z0 = measure(sensors, p, mode), noise = mode === 'bearing' ? () => z0.map(v => v + sigma * rnd()) : () => { const e0 = sigma * rnd(); return z0.map(v => v + sigma * rnd() - e0); };
  const pts = []; for (let k = 0; k < n; k++) pts.push(locate(sensors, noise(), mode, p));
  return pts;
}

// ---------- (4) rendezvous ----------
// Every drone reaches the join-up point at time T. Earliest common time T* = max(dᵢ / Vmaxᵢ). A drone that would have
// to fly slower than its minimum speed flies at Vmin and burns off the extra time in a holding pattern.
export function rendezvous(drones, T) {
  const Tstar = Math.max(...drones.map(d => d.dist / d.vmax));
  const tt = T == null ? Tstar : T;
  const plan = drones.map(d => {
    const v = d.dist / tt;
    if (v > d.vmax * (1 + 1e-9)) return { ...d, v: d.vmax, hold: 0, arrive: d.dist / d.vmax, ok: false };
    if (v < d.vmin) return { ...d, v: d.vmin, hold: tt - d.dist / d.vmin, arrive: tt, ok: true };
    return { ...d, v, hold: 0, arrive: tt, ok: true };
  });
  return { T: tt, Tstar, plan, feasible: plan.every(p => p.ok) };
}
// Fuel to fly distance d at speed V (level, unaccelerated), plus holding at Vhold for tHold
export function legFuel(ac, atm, W, d, V, tHold = 0, Vhold = V) {
  const D = v => dragSplit(ac, atm, v, W).D;
  return fuelFlow(ac, atm, V, D(V), 'max') * d / V + fuelFlow(ac, atm, Vhold, D(Vhold), 'max') * tHold;
}
// Speed of least drag in level flight: q·S·√(CD0/K) = W (the best range speed for a constant-TSFC jet is 1.32× this)
export function minDragSpeed(ac, atm, W) { const { CD0, K } = polar(ac, 0.3); return Math.sqrt(2 * W / (atm.rho * ac.S) * Math.sqrt(K / CD0)); }
