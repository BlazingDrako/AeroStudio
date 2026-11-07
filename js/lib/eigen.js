// Dense symmetric eigenvalue solvers, Cholesky, and a small linear-programming (simplex) solver.
// Matrices here are arrays of row arrays (number[][]) unless noted.

// Householder tridiagonalisation + implicit QL (EISPACK tred2/tql2, as in JAMA).
// Returns { values (ascending), vectors (vectors[k] is the k-th eigenvector) }.
export function symEig(A) {
  const n = A.length;
  if (n === 0) return { values: [], vectors: [] };
  const V = A.map(r => Float64Array.from(r)), d = new Float64Array(n), e = new Float64Array(n);
  if (n === 1) return { values: [A[0][0]], vectors: [[1]] };
  tred2(V, d, e, n); tql2(V, d, e, n);
  const idx = [...Array(n).keys()].sort((a, b) => d[a] - d[b]);
  return { values: idx.map(i => d[i]), vectors: idx.map(i => Array.from({ length: n }, (_, k) => V[k][i])) };
}

function tred2(V, d, e, n) {
  for (let j = 0; j < n; j++) d[j] = V[n - 1][j];
  for (let i = n - 1; i > 0; i--) {
    let scale = 0, h = 0;
    for (let k = 0; k < i; k++) scale += Math.abs(d[k]);
    if (scale === 0) {
      e[i] = d[i - 1];
      for (let j = 0; j < i; j++) { d[j] = V[i - 1][j]; V[i][j] = 0; V[j][i] = 0; }
    } else {
      for (let k = 0; k < i; k++) { d[k] /= scale; h += d[k] * d[k]; }
      let f = d[i - 1], g = Math.sqrt(h);
      if (f > 0) g = -g;
      e[i] = scale * g; h -= f * g; d[i - 1] = f - g;
      for (let j = 0; j < i; j++) e[j] = 0;
      for (let j = 0; j < i; j++) {
        f = d[j]; V[j][i] = f; g = e[j] + V[j][j] * f;
        for (let k = j + 1; k <= i - 1; k++) { g += V[k][j] * d[k]; e[k] += V[k][j] * f; }
        e[j] = g;
      }
      f = 0;
      for (let j = 0; j < i; j++) { e[j] /= h; f += e[j] * d[j]; }
      const hh = f / (h + h);
      for (let j = 0; j < i; j++) e[j] -= hh * d[j];
      for (let j = 0; j < i; j++) {
        f = d[j]; g = e[j];
        for (let k = j; k <= i - 1; k++) V[k][j] -= f * e[k] + g * d[k];
        d[j] = V[i - 1][j]; V[i][j] = 0;
      }
    }
    d[i] = h;
  }
  for (let i = 0; i < n - 1; i++) {
    V[n - 1][i] = V[i][i]; V[i][i] = 1;
    const h = d[i + 1];
    if (h !== 0) {
      for (let k = 0; k <= i; k++) d[k] = V[k][i + 1] / h;
      for (let j = 0; j <= i; j++) {
        let g = 0;
        for (let k = 0; k <= i; k++) g += V[k][i + 1] * V[k][j];
        for (let k = 0; k <= i; k++) V[k][j] -= g * d[k];
      }
    }
    for (let k = 0; k <= i; k++) V[k][i + 1] = 0;
  }
  for (let j = 0; j < n; j++) { d[j] = V[n - 1][j]; V[n - 1][j] = 0; }
  V[n - 1][n - 1] = 1; e[0] = 0;
}

function tql2(V, d, e, n) {
  for (let i = 1; i < n; i++) e[i - 1] = e[i];
  e[n - 1] = 0;
  let f = 0, tst1 = 0;
  const eps = 2 ** -52;
  for (let l = 0; l < n; l++) {
    tst1 = Math.max(tst1, Math.abs(d[l]) + Math.abs(e[l]));
    let m = l;
    while (m < n) { if (Math.abs(e[m]) <= eps * tst1) break; m++; }
    if (m === n) m = n - 1;
    if (m > l) {
      let iter = 0;
      do {
        iter++;
        let g = d[l], p = (d[l + 1] - g) / (2 * e[l]), r = Math.hypot(p, 1);
        if (p < 0) r = -r;
        d[l] = e[l] / (p + r); d[l + 1] = e[l] * (p + r);
        const dl1 = d[l + 1];
        let h = g - d[l];
        for (let i = l + 2; i < n; i++) d[i] -= h;
        f += h;
        p = d[m];
        let c = 1, c2 = 1, c3 = 1, s = 0, s2 = 0;
        const el1 = e[l + 1];
        for (let i = m - 1; i >= l; i--) {
          c3 = c2; c2 = c; s2 = s;
          g = c * e[i]; h = c * p; r = Math.hypot(p, e[i]);
          e[i + 1] = s * r; s = e[i] / r; c = p / r;
          p = c * d[i] - s * g;
          d[i + 1] = h + s * (c * g + s * d[i]);
          for (let k = 0; k < n; k++) { h = V[k][i + 1]; V[k][i + 1] = s * V[k][i] + c * h; V[k][i] = c * V[k][i] - s * h; }
        }
        p = -s * s2 * c3 * el1 * e[l] / dl1;
        e[l] = s * p; d[l] = c * p;
      } while (Math.abs(e[l]) > eps * tst1 && iter < 80);
    }
    d[l] += f; e[l] = 0;
  }
}

// Cholesky A = L Lᵀ (A symmetric positive definite). Returns L (number[][]) or {fail: row} if not PD.
export function cholesky(A, relTol = 1e-11) {
  const n = A.length, L = A.map(() => new Float64Array(n));
  let dmax = 0; for (let i = 0; i < n; i++) dmax = Math.max(dmax, Math.abs(A[i][i]));
  for (let j = 0; j < n; j++) {
    let s = A[j][j];
    const Lj = L[j];
    for (let k = 0; k < j; k++) s -= Lj[k] * Lj[k];
    if (!(s > relTol * dmax)) return { fail: j, pivot: s / (dmax || 1) };
    const djj = Math.sqrt(s); Lj[j] = djj;
    for (let i = j + 1; i < n; i++) {
      const Li = L[i]; let t = A[i][j];
      for (let k = 0; k < j; k++) t -= Li[k] * Lj[k];
      Li[j] = t / djj;
    }
  }
  return L;
}
export function cholSolve(L, b) {
  const n = L.length, y = Float64Array.from(b);
  for (let i = 0; i < n; i++) { const Li = L[i]; let s = y[i]; for (let k = 0; k < i; k++) s -= Li[k] * y[k]; y[i] = s / Li[i]; }
  for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k][i] * y[k]; y[i] = s / L[i][i]; }
  return y;
}

// Generalised symmetric problem A x = λ B x with B positive definite (B = L Lᵀ).
// Returns ascending eigenvalues and B-normalised vectors.
export function symGenEig(A, B) {
  const L = cholesky(B, 1e-14);
  if (L.fail !== undefined) return { error: 'not positive definite', row: L.fail };
  const n = A.length;
  // Y = L⁻¹ A (column by column, forward substitution)
  const Y = A.map(r => Float64Array.from(r));
  for (let c = 0; c < n; c++) for (let i = 0; i < n; i++) { let s = Y[i][c]; for (let k = 0; k < i; k++) s -= L[i][k] * Y[k][c]; Y[i][c] = s / L[i][i]; }
  // C = Y L⁻ᵀ = (L⁻¹ Yᵀ)ᵀ
  const C = Array.from({ length: n }, () => new Float64Array(n));
  for (let r = 0; r < n; r++) {
    // solve L z = Y[r]ᵀ row -> z is row r of C
    const z = C[r];
    for (let i = 0; i < n; i++) { let s = Y[r][i]; for (let k = 0; k < i; k++) s -= L[i][k] * z[k]; z[i] = s / L[i][i]; }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) { const a = 0.5 * (C[i][j] + C[j][i]); C[i][j] = a; C[j][i] = a; }
  const { values, vectors } = symEig(C);
  // x = L⁻ᵀ y
  const X = vectors.map(y => { const x = Float64Array.from(y); for (let i = n - 1; i >= 0; i--) { let s = x[i]; for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k]; x[i] = s / L[i][i]; } return x; });
  return { values, vectors: X };
}

// Linear program: maximise c·x subject to Aeq x = beq, Aub x ≤ bub; x[j] ≥ 0 when nonneg[j], otherwise free.
// Dense two-phase simplex with Bland's rule (small problems only).
// Returns { status: 'optimal' | 'infeasible' | 'unbounded', x, value }.
export function linprog({ c, Aeq = [], beq = [], Aub = [], bub = [], nonneg }) {
  const nv = c.length;
  nonneg = nonneg || new Array(nv).fill(true);
  // column map: each free variable gets + and − columns
  const cols = [];
  for (let j = 0; j < nv; j++) { cols.push([j, 1]); if (!nonneg[j]) cols.push([j, -1]); }
  const rows = [];
  for (let i = 0; i < Aeq.length; i++) rows.push({ a: Aeq[i], b: beq[i], slack: 0 });
  for (let i = 0; i < Aub.length; i++) rows.push({ a: Aub[i], b: bub[i], slack: 1 });
  const m = rows.length, ns = Aub.length, nx = cols.length;
  const N = nx + ns + m; // x cols, slacks, artificials
  const T = Array.from({ length: m + 1 }, () => new Float64Array(N + 1));
  const basis = new Int32Array(m);
  let si = 0;
  for (let i = 0; i < m; i++) {
    const r = rows[i], row = T[i];
    for (let k = 0; k < nx; k++) row[k] = r.a[cols[k][0]] * cols[k][1];
    if (r.slack) { row[nx + si] = 1; si++; }
    row[N] = r.b;
    if (row[N] < 0) for (let k = 0; k <= N; k++) row[k] = -row[k];
    row[nx + ns + i] = 1; basis[i] = nx + ns + i;
  }
  const pivot = (pr, pc) => {
    const prow = T[pr], pv = prow[pc];
    for (let k = 0; k <= N; k++) prow[k] /= pv;
    for (let i = 0; i <= m; i++) if (i !== pr) { const f = T[i][pc]; if (f !== 0) { const r = T[i]; for (let k = 0; k <= N; k++) r[k] -= f * prow[k]; } }
    basis[pr] = pc;
  };
  const run = (allowed) => {
    const obj = T[m];
    for (let it = 0; it < 5000; it++) {
      let pc = -1;
      for (let k = 0; k < N; k++) if (allowed(k) && obj[k] < -1e-10) { pc = k; break; } // Bland
      if (pc < 0) return 'optimal';
      let pr = -1, best = Infinity;
      for (let i = 0; i < m; i++) { const a = T[i][pc]; if (a > 1e-12) { const q = T[i][N] / a; if (q < best - 1e-12 || (Math.abs(q - best) <= 1e-12 && basis[i] < basis[pr])) { best = q; pr = i; } } }
      if (pr < 0) return 'unbounded';
      pivot(pr, pc);
    }
    return 'iterlimit';
  };
  // phase 1: minimise sum of artificials  -> objective row = -sum(rows)
  const obj = T[m]; obj.fill(0);
  for (let i = 0; i < m; i++) for (let k = 0; k <= N; k++) if (k < nx + ns || k === N) obj[k] -= T[i][k];
  run(k => true);
  const scale = Math.max(1, ...rows.map(r => Math.abs(r.b)));
  if (-obj[N] > 1e-7 * scale) return { status: 'infeasible' };
  // drive artificials out of the basis where possible
  for (let i = 0; i < m; i++) if (basis[i] >= nx + ns) { for (let k = 0; k < nx + ns; k++) if (Math.abs(T[i][k]) > 1e-9) { pivot(i, k); break; } }
  // phase 2
  obj.fill(0);
  for (let k = 0; k < nx; k++) obj[k] = -c[cols[k][0]] * cols[k][1];
  for (let i = 0; i < m; i++) { const b = basis[i], f = obj[b]; if (f !== 0) for (let k = 0; k <= N; k++) obj[k] -= f * T[i][k]; }
  const st = run(k => k < nx + ns);
  if (st === 'unbounded') return { status: 'unbounded' };
  const xs = new Float64Array(nx);
  for (let i = 0; i < m; i++) if (basis[i] < nx) xs[basis[i]] = T[i][N];
  const x = new Float64Array(nv);
  for (let k = 0; k < nx; k++) x[cols[k][0]] += cols[k][1] * xs[k];
  let value = 0; for (let j = 0; j < nv; j++) value += c[j] * x[j];
  return { status: 'optimal', x, value };
}

// Rank / null-space of a dense matrix (rows x cols, number[][]) by Gaussian elimination with full pivoting.
export function rankInfo(A, relTol = 1e-9) {
  const m = A.length, n = m ? A[0].length : 0;
  const M = A.map(r => Float64Array.from(r));
  let amax = 0; for (const r of M) for (const v of r) amax = Math.max(amax, Math.abs(v));
  const tol = relTol * (amax || 1);
  const colPerm = [...Array(n).keys()], pivRows = [];
  let rank = 0;
  for (let k = 0; k < Math.min(m, n); k++) {
    let bi = -1, bj = -1, bv = tol;
    for (let i = k; i < m; i++) for (let j = k; j < n; j++) { const v = Math.abs(M[i][j]); if (v > bv) { bv = v; bi = i; bj = j; } }
    if (bi < 0) break;
    [M[k], M[bi]] = [M[bi], M[k]];
    if (bj !== k) { for (const r of M) { const t = r[k]; r[k] = r[bj]; r[bj] = t; } [colPerm[k], colPerm[bj]] = [colPerm[bj], colPerm[k]]; }
    for (let i = k + 1; i < m; i++) { const f = M[i][k] / M[k][k]; if (f) for (let j = k; j < n; j++) M[i][j] -= f * M[k][j]; }
    rank++;
  }
  // unknowns that are pivots are determined (if the rest are fixed); the rest are redundant
  return { rank, pivotCols: colPerm.slice(0, rank), freeCols: colPerm.slice(rank) };
}
