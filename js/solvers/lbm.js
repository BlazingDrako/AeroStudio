// Lattice-Boltzmann flow solver (D2Q9, BGK collision) on the CPU. No DOM.
// This is the reference definition: the GPU solver (js/modules/cfd/lbmGL.js) runs the same algorithm
// step for step, and the tests compare the two.
//
// Lattice units: cell size = time step = 1, speed of sound² = 1/3, pressure p = ρ/3,
// kinematic viscosity ν = (τ − ½)/3.
// Each step, every fluid cell pulls the populations streaming into it from its neighbours, then relaxes
// them toward equilibrium (collision). Stored values are post-collision populations.
//
// Cell types (cells[k]): 0 fluid, 1 solid, 2 forced (fluid held at equilibrium, ρ = 1, u = vel[k]: jet nozzles).
// Solid cells may move with velocity vel[k] (dragged obstacles).
// Boundaries:
//   obstacles     halfway bounce-back with the wall velocity added (moving no-slip walls)
//   x: 'flow'     inflow at the left (equilibrium at ρ = 1, u = (inflow, 0); inflow = 0 is an open boundary at rest),
//                 zero-gradient outflow at the right
//   x: 'periodic' | 'wall' (no-slip side walls)
//   y: 'slip'     free-slip (mirror) walls, 'wall' no-slip walls sliding at lid = [bottom, top] x-velocity, 'periodic'
// Options: Smagorinsky turbulence model (cs > 0), a uniform body force (Guo forcing), and an absorbing
// sponge = { sigma, y, x } that relaxes the density toward 1 within y cells of the top and bottom and x cells of the
// outlet (rate sigma at the boundary, falling off quadratically). It soaks up pressure (sound) waves, which slip walls
// would otherwise trap between them as standing waves, without touching the velocity.

export const EX = [0, 1, 0, -1, 0, 1, -1, -1, 1];
export const EY = [0, 0, 1, 0, -1, 1, 1, -1, -1];
export const W = [4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36];
export const OPP = [0, 3, 4, 1, 2, 7, 8, 5, 6];   // reversed direction
export const MIRY = [0, 1, 4, 3, 2, 8, 7, 6, 5];  // direction mirrored in y (for slip walls)
export const BCX = { flow: 0, periodic: 1, wall: 2 };
export const BCY = { slip: 0, wall: 1, periodic: 2 };

export const nuFromTau = tau => (tau - 0.5) / 3;
export const tauFromNu = nu => 3 * nu + 0.5;
// Relaxation time for a Reynolds number based on velocity U and length L (both in lattice units)
export const tauForRe = (Re, U, L) => tauFromNu(U * L / Re);

export function feq(i, rho, ux, uy) {
  const eu = EX[i] * ux + EY[i] * uy;
  return W[i] * rho * (1 + 3 * eu + 4.5 * eu * eu - 1.5 * (ux * ux + uy * uy));
}

// Smagorinsky model: local relaxation time from the non-equilibrium momentum flux Π.
// ν_t = (cs·Δ)²|S| with |S| = 3Q/(2ρτ), Q = √(2 Π:Π), solved for τ = τ0 + 3ν_t.
export function tauEff(tau0, cs, rho, pxx, pyy, pxy) {
  if (!(cs > 0)) return tau0;
  const Q = Math.sqrt(2 * (pxx * pxx + pyy * pyy + 2 * pxy * pxy));
  return 0.5 * (tau0 + Math.sqrt(tau0 * tau0 + 18 * cs * cs * Q / rho));
}

// Cells inside a circle (cell centres at i + ½, j + ½)
export function circleMask(nx, ny, cx, cy, r, mask = new Uint8Array(nx * ny)) {
  for (let j = Math.max(0, Math.floor(cy - r - 1)); j < Math.min(ny, Math.ceil(cy + r + 1)); j++)
    for (let i = Math.max(0, Math.floor(cx - r - 1)); i < Math.min(nx, Math.ceil(cx + r + 1)); i++)
      if ((i + 0.5 - cx) ** 2 + (j + 0.5 - cy) ** 2 <= r * r) mask[j * nx + i] = 1;
  return mask;
}

// Sponge strength at cell (i, j); the same formula is used in the GPU shader
export function spongeAt(sp, i, j, nx, ny) {
  if (!sp || !(sp.sigma > 0)) return 0;
  let a = 0;
  if (sp.y > 0) { const d = Math.min(j + 0.5, ny - j - 0.5); if (d < sp.y) a = (1 - d / sp.y) ** 2; }
  if (sp.x > 0) { const d = nx - i - 0.5; if (d < sp.x) a = Math.max(a, (1 - d / sp.x) ** 2); }
  return sp.sigma * a;
}

export class LBM {
  constructor(o) { this.setup(o); }
  // setup({ nx, ny, U, inflow, tau, cs, bc: { x, y }, lid: [bottom, top], force: [fx, fy],
  //         cells (or solid): Uint8Array of cell types, vel: Float32Array(2n), init(i, j) → [ρ, ux, uy] | null })
  setup({ nx, ny, U = 0.1, inflow = U, tau = 0.6, cs = 0, bc = {}, lid = [0, 0], force = [0, 0], cells = null, solid = null, vel = null, init = null, sponge = null }) {
    Object.assign(this, { nx, ny, U, inflow, tau, cs, lid, fx: force[0], fy: force[1], sponge });
    this.bx = BCX[bc.x || 'flow']; this.by = BCY[bc.y || 'slip'];
    const n = nx * ny;
    this.cells = cells || solid || new Uint8Array(n);
    this.vel = vel || new Float32Array(2 * n);
    this.f = new Float64Array(9 * n); this.g = new Float64Array(9 * n);
    this.rho = new Float64Array(n); this.ux = new Float64Array(n); this.uy = new Float64Array(n);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, t = this.cells[k];
      const m = t ? [1, this.vel[2 * k], this.vel[2 * k + 1]] : (init && init(i, j)) || [1, U, 0];
      this.rho[k] = m[0]; this.ux[k] = m[1]; this.uy[k] = m[2];
      for (let q = 0; q < 9; q++) this.f[9 * k + q] = feq(q, m[0], m[1], m[2]);
    }
    this.iter = 0;
  }
  step(k = 1) { for (let s = 0; s < k; s++) this.step1(); }
  step1() {
    const { nx, ny, f, g, cells, vel, inflow, tau, cs, fx, fy, bx, by, lid } = this;
    const fi = new Float64Array(9), fe = new Float64Array(9);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, o = 9 * k;
      if (cells[k]) { // solid or forced: equilibrium at the cell's own velocity
        const vx = vel[2 * k], vy = vel[2 * k + 1];
        for (let q = 0; q < 9; q++) g[o + q] = feq(q, 1, vx, vy);
        this.rho[k] = 1; this.ux[k] = vx; this.uy[k] = vy;
        continue;
      }
      // streaming: pull the population arriving in each direction
      for (let q = 0; q < 9; q++) {
        let sx = i - EX[q], sy = j - EY[q], d = q, v = NaN;
        if (sy < 0 || sy >= ny) {
          if (by === 2) sy = (sy + ny) % ny;
          else if (by === 1) v = f[o + OPP[q]] + 6 * W[q] * EX[q] * lid[sy < 0 ? 0 : 1]; // (sliding) no-slip wall
          else { sy = j; d = MIRY[q]; }                  // free slip: mirror
        }
        if (v !== v) {
          if (sx < 0) { if (bx === 1) sx += nx; else if (bx === 2) v = f[o + OPP[q]]; else v = feq(d, 1, inflow, 0); }
          else if (sx >= nx) { if (bx === 1) sx -= nx; else if (bx === 2) v = f[o + OPP[q]]; else sx = nx - 1; } // zero-gradient outflow
        }
        if (v !== v) {
          const s = sy * nx + sx;
          v = cells[s] === 1 ? f[o + OPP[q]] + 6 * W[q] * (EX[q] * vel[2 * s] + EY[q] * vel[2 * s + 1]) : f[9 * s + d];
        }
        fi[q] = v;
      }
      // moments
      let rho = 0, mx = 0, my = 0;
      for (let q = 0; q < 9; q++) { rho += fi[q]; mx += EX[q] * fi[q]; my += EY[q] * fi[q]; }
      let ux = (mx + 0.5 * fx) / rho, uy = (my + 0.5 * fy) / rho;
      if (!(rho > 0.05 && rho < 20)) { rho = 1; ux = inflow; uy = 0; for (let q = 0; q < 9; q++) fi[q] = feq(q, 1, inflow, 0); } // safety reset
      // collision
      let pxx = 0, pyy = 0, pxy = 0;
      for (let q = 0; q < 9; q++) { fe[q] = feq(q, rho, ux, uy); const ne = fi[q] - fe[q]; pxx += EX[q] * EX[q] * ne; pyy += EY[q] * EY[q] * ne; pxy += EX[q] * EY[q] * ne; }
      const t = tauEff(tau, cs, rho, pxx, pyy, pxy), om = 1 / t, fk = 1 - 0.5 / t, sg = spongeAt(this.sponge, i, j, nx, ny);
      for (let q = 0; q < 9; q++) {
        let F = 0;
        if (fx || fy) { const ex = EX[q], ey = EY[q], eu = ex * ux + ey * uy; F = W[q] * fk * (3 * ((ex - ux) * fx + (ey - uy) * fy) + 9 * eu * (ex * fx + ey * fy)); }
        g[o + q] = fi[q] - om * (fi[q] - fe[q]) + F + (sg ? sg * (feq(q, 1, ux, uy) - fe[q]) : 0);
      }
      this.rho[k] = rho; this.ux[k] = ux; this.uy[k] = uy;
    }
    this.f = g; this.g = f; this.iter++;
  }
  mass() { let m = 0; for (let k = 0; k < this.nx * this.ny; k++) if (!this.cells[k]) for (let q = 0; q < 9; q++) m += this.f[9 * k + q]; return m; }
  // Force on every solid cell from the fluid (momentum exchange): each link from a fluid cell n into the solid
  // carries a population in and reflects one back, so the wall receives −e_q·(2 f*_p(n) + 6 w_q e_q·u_wall),
  // where q points from the wall to n and p = opp(q). Sum over an obstacle's cells for its drag and lift.
  cellForces() {
    const { nx, ny, cells, vel, f } = this, n = nx * ny, Fx = new Float64Array(n), Fy = new Float64Array(n);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const s = j * nx + i; if (cells[s] !== 1) continue;
      const vx = vel[2 * s], vy = vel[2 * s + 1];
      for (let q = 1; q < 9; q++) {
        const ii = i + EX[q], jj = j + EY[q];
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const k = jj * nx + ii; if (cells[k]) continue;
        const c = 2 * f[9 * k + OPP[q]] + 6 * W[q] * (EX[q] * vx + EY[q] * vy);
        Fx[s] -= EX[q] * c; Fy[s] -= EY[q] * c;
      }
    }
    return { Fx, Fy };
  }
}
