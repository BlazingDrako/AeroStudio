// Exact (double precision) flow-field evaluation at single points — same math as the GPU shader.
// Used for hover readouts, the dividing-streamline value, and as a fallback grid when WebGL2 is missing.
const I2PI = 1 / (2 * Math.PI);

export function evalPoint(res, px, pz) {
  const N = res.N, X = res.foil.x, Z = res.foil.z, G = res.field.G, sig = res.field.sigma;
  const a = res.alpha * Math.PI / 180;
  let u = res.Vinf * Math.cos(a), v = res.Vinf * Math.sin(a);
  let psi = u * pz - v * px, wind = 0;
  const panel = (x1, z1, x2, z2) => {
    const dx = x2 - x1, dz = z2 - z1, L = Math.hypot(dx, dz);
    const tx = dx / L, tz = dz / L, nx = -tz, nz = tx;
    const rx = px - x1, rz = pz - z1;
    const x = rx * tx + rz * tz, z = rx * nx + rz * nz;
    const r1s = x * x + z * z, r2s = (x - L) * (x - L) + z * z;
    const lr1 = 0.5 * Math.log(Math.max(r1s, 1e-300)), lr2 = 0.5 * Math.log(Math.max(r2s, 1e-300));
    const dth = Math.atan2(z * L, x * (x - L) + z * z);
    return { tx, tz, nx, nz, x, z, L, r1s, r2s, lr1, lr2, lr: lr1 - lr2, dth };
  };
  for (let j = 0; j < N - 1; j++) {
    const p = panel(X[j], Z[j], X[j + 1], Z[j + 1]);
    wind += p.dth;
    const t2 = (2 * p.z * p.lr - 2 * p.x * p.dth) / (4 * Math.PI * p.L);
    const ug1 = p.dth * I2PI + t2, ug2 = -t2;
    const w2 = (p.x * p.lr - p.L + p.z * p.dth) * I2PI / p.L;
    const wg1 = -p.lr * I2PI + w2, wg2 = -w2;
    const ut = ug1 * G[j] + ug2 * G[j + 1], wn = wg1 * G[j] + wg2 * G[j + 1];
    u += ut * p.tx + wn * p.nx; v += ut * p.tz + wn * p.nz;
    const P1 = I2PI * (p.z * p.dth - p.L + p.x * p.lr1 - (p.x - p.L) * p.lr2);
    const P2 = p.x * P1 + I2PI * (0.5 * p.r2s * p.lr2 - 0.5 * p.r1s * p.lr1 - 0.25 * p.r2s + 0.25 * p.r1s);
    psi += (P1 - P2 / p.L) * G[j] + (P2 / p.L) * G[j + 1];
    if (sig) {
      const s = sig[j];
      u += s * (p.lr * I2PI * p.tx + p.dth * I2PI * p.nx); v += s * (p.lr * I2PI * p.tz + p.dth * I2PI * p.nz);
    }
  }
  const dTE = Math.hypot(X[0] - X[N - 1], Z[0] - Z[N - 1]);
  if (dTE > 1e-9) {
    const p = panel(X[N - 1], Z[N - 1], X[0], Z[0]);
    wind += p.dth;
    if (res.field.hasTE) {
      const ss = 0.5 * res.field.tcp * (G[N - 1] - G[0]);
      u += ss * (p.lr * I2PI * p.tx + p.dth * I2PI * p.nx); v += ss * (p.lr * I2PI * p.tz + p.dth * I2PI * p.nz);
      const gv = 0.5 * res.field.tdp * (G[0] - G[N - 1]);
      u += gv * (p.dth * I2PI * p.tx - p.lr * I2PI * p.nx); v += gv * (p.dth * I2PI * p.tz - p.lr * I2PI * p.nz);
      psi += gv * I2PI * (p.z * p.dth - p.L + p.x * p.lr1 - (p.x - p.L) * p.lr2);
    }
  }
  if (sig && res.wake) {
    const WX = res.wake.x, WZ = res.wake.z;
    for (let k = 0; k < res.Nw - 1; k++) {
      const p = panel(WX[k], WZ[k], WX[k + 1], WZ[k + 1]);
      const s = sig[N - 1 + k];
      u += s * (p.lr * I2PI * p.tx + p.dth * I2PI * p.nx); v += s * (p.lr * I2PI * p.tz + p.dth * I2PI * p.nz);
    }
  }
  return { u, v, psi, inside: Math.abs(wind) > Math.PI };
}

export function cpFromSpeed(q, res) {
  let cp = 1 - (q / res.Vinf) ** 2;
  if (res.Ma > 0) cp = cp / (res.KTb + 0.5 * res.KTl * (1 + res.KTb) * cp);
  return cp;
}

// coarse grid on the CPU (fallback for browsers without WebGL2)
export function cpuGrid(res, view, w, h) {
  const data = new Float32Array(4 * w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = view.x0 + (view.x1 - view.x0) * (i + 0.5) / w, z = view.z0 + (view.z1 - view.z0) * (j + 0.5) / h;
    const f = evalPoint(res, x, z), o = 4 * (j * w + i);
    data[o] = f.u; data[o + 1] = f.v; data[o + 2] = f.psi; data[o + 3] = f.inside ? 1 : 0;
  }
  return { w, h, data, view: { ...view } };
}
