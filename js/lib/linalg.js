// Dense linear algebra helpers (row-major Float64Array storage).
// Shared by all solvers in the app.

// LU factorization with partial pivoting, in place. A is n*n row-major.
export function luFactor(A, n) {
  const piv = new Int32Array(n);
  for (let k = 0; k < n; k++) {
    let p = k, vmax = Math.abs(A[k * n + k]);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(A[i * n + k]);
      if (v > vmax) { vmax = v; p = i; }
    }
    piv[k] = p;
    if (p !== k) swapRows(A, n, n, k, p);
    const akk = A[k * n + k];
    if (akk === 0) continue; // singular; leave zeros (caller will see NaN/Inf)
    const rk = k * n;
    for (let i = k + 1; i < n; i++) {
      const ri = i * n;
      const l = A[ri + k] / akk;
      if (l === 0) continue;
      A[ri + k] = l;
      for (let j = k + 1; j < n; j++) A[ri + j] -= l * A[rk + j];
    }
  }
  return { lu: A, piv, n };
}

// Solve with a factorization from luFactor. B is n*m row-major (m right-hand sides).
// Returns a new array with the solution.
export function luSolve(F, B, m = 1) {
  const { lu, piv, n } = F;
  const X = Float64Array.from(B);
  for (let k = 0; k < n; k++) if (piv[k] !== k) swapRows(X, m, m, k, piv[k]);
  // forward (unit lower)
  for (let i = 1; i < n; i++) {
    const ri = i * n, xi = i * m;
    for (let k = 0; k < i; k++) {
      const l = lu[ri + k];
      if (l === 0) continue;
      const xk = k * m;
      for (let j = 0; j < m; j++) X[xi + j] -= l * X[xk + j];
    }
  }
  // backward (upper)
  for (let i = n - 1; i >= 0; i--) {
    const ri = i * n, xi = i * m;
    for (let k = i + 1; k < n; k++) {
      const u = lu[ri + k];
      if (u === 0) continue;
      const xk = k * m;
      for (let j = 0; j < m; j++) X[xi + j] -= u * X[xk + j];
    }
    const d = 1 / lu[ri + i];
    for (let j = 0; j < m; j++) X[xi + j] *= d;
  }
  return X;
}

function swapRows(A, stride, len, a, b) {
  const ra = a * stride, rb = b * stride;
  for (let j = 0; j < len; j++) { const t = A[ra + j]; A[ra + j] = A[rb + j]; A[rb + j] = t; }
}

// Gaussian elimination that skips zero multipliers.
// Very fast for matrices whose leading columns are sparse (fill stays local).
// tau < 1 enables threshold pivoting: the first row (in order) whose pivot is within
// a factor tau of the column maximum is chosen, which keeps fill-in local
// (standard practice in sparse LU; tau = 0.1 keeps element growth bounded).
// A (n*n) and b (n) are overwritten. Returns x.
export function gaussSolveInPlace(A, b, n, tau = 1) {
  for (let k = 0; k < n; k++) {
    let p = -1, vmax = 0;
    for (let i = k; i < n; i++) {
      const v = Math.abs(A[i * n + k]);
      if (v > vmax) { vmax = v; p = i; }
    }
    if (p < 0) continue; // structurally singular column
    if (tau < 1) {
      const thr = tau * vmax;
      for (let i = k; i < p; i++) if (Math.abs(A[i * n + k]) >= thr) { p = i; break; }
    }
    if (p !== k) {
      const rk = k * n, rp = p * n;
      for (let j = k; j < n; j++) { const t = A[rk + j]; A[rk + j] = A[rp + j]; A[rp + j] = t; }
      const t = b[k]; b[k] = b[p]; b[p] = t;
    }
    const rk = k * n, akk = A[rk + k];
    // find extent of nonzeros in pivot row to bound the update
    let jmax = n - 1;
    while (jmax > k && A[rk + jmax] === 0) jmax--;
    for (let i = k + 1; i < n; i++) {
      const ri = i * n;
      const aik = A[ri + k];
      if (aik === 0) continue;
      const l = aik / akk;
      A[ri + k] = 0;
      for (let j = k + 1; j <= jmax; j++) A[ri + j] -= l * A[rk + j];
      b[i] -= l * b[k];
    }
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    const ri = i * n;
    let s = b[i];
    for (let j = i + 1; j < n; j++) s -= A[ri + j] * x[j];
    x[i] = s / A[ri + i];
  }
  return x;
}

// Small dense solve for arrays-of-arrays (used for 3x3/4x4 local systems).
export function solveSmall(A, b) {
  const n = b.length;
  const M = A.map(r => r.slice(0, n));
  const x = b.slice();
  for (let k = 0; k < n; k++) {
    let p = k, vmax = Math.abs(M[k][k]);
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > vmax) { vmax = Math.abs(M[i][k]); p = i; }
    if (p !== k) { const t = M[k]; M[k] = M[p]; M[p] = t; const tb = x[k]; x[k] = x[p]; x[p] = tb; }
    for (let i = k + 1; i < n; i++) {
      const l = M[i][k] / M[k][k];
      if (l === 0) continue;
      for (let j = k; j < n; j++) M[i][j] -= l * M[k][j];
      x[i] -= l * x[k];
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = x[i];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

export function norm2(v) { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i]; return Math.sqrt(s); }
