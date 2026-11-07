// Cubic splines matching MATLAB's spline() (not-a-knot end conditions) and ppval().
// A piecewise polynomial is { breaks: Float64Array(n), coefs: Float64Array(4*(n-1)) }
// with coefs per piece [a,b,c,d]: a*t^3 + b*t^2 + c*t + d, t = x - breaks[i].

export function spline(x, y) {
  const n = x.length;
  const coefs = new Float64Array(4 * (n - 1));
  const breaks = Float64Array.from(x);
  if (n === 2) {
    const m = (y[1] - y[0]) / (x[1] - x[0]);
    coefs.set([0, 0, m, y[0]]);
    return { breaks, coefs };
  }
  if (n === 3) {
    // not-a-knot with 3 points = the interpolating parabola
    const d1 = (y[1] - y[0]) / (x[1] - x[0]), d2 = (y[2] - y[1]) / (x[2] - x[1]);
    const c2 = (d2 - d1) / (x[2] - x[0]);
    for (let i = 0; i < 2; i++) {
      const t = x[i] - x[0];
      const slope = d1 - c2 * (x[1] - x[0]) + 2 * c2 * t;
      const val = y[0] + (d1 - c2 * (x[1] - x[0])) * t + c2 * t * t;
      coefs.set([0, c2, slope, val], 4 * i);
    }
    return { breaks, coefs };
  }
  const dx = new Float64Array(n - 1), dd = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) { dx[i] = x[i + 1] - x[i]; dd[i] = (y[i + 1] - y[i]) / dx[i]; }
  const sub = new Float64Array(n), dia = new Float64Array(n), sup = new Float64Array(n), r = new Float64Array(n);
  const x31 = x[2] - x[0], xn = x[n - 1] - x[n - 3];
  dia[0] = dx[1]; sup[0] = x31;
  r[0] = ((dx[0] + 2 * x31) * dx[1] * dd[0] + dx[0] * dx[0] * dd[1]) / x31;
  for (let i = 1; i < n - 1; i++) {
    sub[i] = dx[i]; dia[i] = 2 * (dx[i] + dx[i - 1]); sup[i] = dx[i - 1];
    r[i] = 3 * (dx[i] * dd[i - 1] + dx[i - 1] * dd[i]);
  }
  sub[n - 1] = xn; dia[n - 1] = dx[n - 3];
  r[n - 1] = (dx[n - 2] * dx[n - 2] * dd[n - 3] + (2 * xn + dx[n - 2]) * dx[n - 3] * dd[n - 2]) / xn;
  // Thomas algorithm
  for (let i = 1; i < n; i++) {
    const w = sub[i] / dia[i - 1];
    dia[i] -= w * sup[i - 1];
    r[i] -= w * r[i - 1];
  }
  const s = new Float64Array(n);
  s[n - 1] = r[n - 1] / dia[n - 1];
  for (let i = n - 2; i >= 0; i--) s[i] = (r[i] - sup[i] * s[i + 1]) / dia[i];
  for (let i = 0; i < n - 1; i++) {
    const dzzdx = (dd[i] - s[i]) / dx[i], dzdxdx = (s[i + 1] - dd[i]) / dx[i];
    coefs[4 * i] = (dzdxdx - dzzdx) / dx[i];
    coefs[4 * i + 1] = 2 * dzzdx - dzdxdx;
    coefs[4 * i + 2] = s[i];
    coefs[4 * i + 3] = y[i];
  }
  return { breaks, coefs };
}

function piece(pp, xq) {
  const b = pp.breaks, n = b.length;
  if (xq <= b[1]) return 0;
  if (xq >= b[n - 2]) return n - 2;
  let lo = 1, hi = n - 2; // b[lo] <= xq < b[hi]
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (b[mid] <= xq) lo = mid; else hi = mid; }
  return lo;
}

export function ppval(pp, xq) {
  const out = new Float64Array(xq.length);
  for (let k = 0; k < xq.length; k++) {
    const i = piece(pp, xq[k]), t = xq[k] - pp.breaks[i], c = pp.coefs;
    out[k] = ((c[4 * i] * t + c[4 * i + 1]) * t + c[4 * i + 2]) * t + c[4 * i + 3];
  }
  return out;
}

export function ppder(pp, xq) {
  const out = new Float64Array(xq.length);
  for (let k = 0; k < xq.length; k++) {
    const i = piece(pp, xq[k]), t = xq[k] - pp.breaks[i], c = pp.coefs;
    out[k] = (3 * c[4 * i] * t + 2 * c[4 * i + 1]) * t + c[4 * i + 2];
  }
  return out;
}

export function interpSpline(x, y, xq) { return ppval(spline(x, y), xq); }
