// mfoil.js — JavaScript port of mfoil (subsonic airfoil analysis, coupled panel + integral BL).
// Original MATLAB code: Copyright (C) 2025 Krzysztof J. Fidkowski, MIT license (see LICENSE-mfoil).
// Port follows mfoil.m version 2026-02-17 function by function; indices are 0-based here.

import { luFactor, luSolve, gaussSolveInPlace, solveSmall, norm2 } from '../../lib/linalg.js';
import { spline, ppval, ppder } from '../../lib/spline.js';
import * as C from './correlations.js';
const { z4, lc, sc, cat, dot } = C;

const PI = Math.PI;
const cosd = a => Math.cos(a * PI / 180);
const sind = a => Math.sin(a * PI / 180);

// ============================ MODEL ============================

export function defaultParam() {
  return {
    verb: 1, rtol: 1e-10, niglob: 50,
    ncrit: 9.0, Cuq: 1.0, Dlr: 0.9, SlagK: 5.6,
    CtauC: 1.8, CtauE: 3.3,
    GA: 6.7, GB: 0.75, GC: 18.0,
    Minf: 0, Vinf: 0, muinf: 0, mu0: 0, rho0: 1, H0: 0, Tsrat: 0.35, gam: 1.4,
    KTb: 1, KTl: 0, cps: 0,
    simi: false, turb: false, wake: false,
    denseSolve: false, // true: use the plain dense solver (validation)
  };
}

const emptyPanel = () => ({ N: 0, x: new Float64Array(0), z: new Float64Array(0), s: new Float64Array(0), tx: new Float64Array(0), tz: new Float64Array(0) });
const emptyIsol = () => ({ AIC: null, gamref: null, gam: null, sstag: 0, sstag_g: [0, 0], sstag_ue: [0, 0], Istag: [0, 0], xstag: [0, 0], sgnue: null, xi: null, uewi: null, uewiref: null });
const emptyVsol = () => ({ Is: [], wgap: null, ue_m: null, sigma_m: null, ue_sigma: null, turb: null, xt: 0, Xt: [[0, 0], [0, 0]] });
const emptyGlob = () => ({ Nsys: 0, U: null, dU: null, dalpha: 0, conv: true, R: null, R_U: null, R_x: null, history: [] });
const emptyPost = () => ({ cp: null, cpi: null, cl: 0, cl_ue: null, cl_alpha: 0, cm: 0, cdpi: 0, cd: 0, cdf: 0, cdp: 0, th: null, ds: null, sa: null, ue: null, uei: null, cf: null, Ret: null, Hk: null });

export class Mfoil {
  constructor({ naca = '0012', coords = null, npanel = 199 } = {}) {
    this.version = '2026-02-17 (JS port)';
    this.geom = { chord: 1, wakelen: 1.0, npoint: 0, name: 'noname', xpoint: null, xref: [0.25, 0] };
    this.foil = emptyPanel();
    this.wake = emptyPanel();
    this.oper = { Vinf: 1, alpha: 0, rho: 1, cltgt: 0, givencl: false, initbl: true, viscous: false, redowake: false,
      Re: 1e5, Ma: 0, forcet: [false, false, false], xft: [1, 1, 1], xift: [0, 0, 0] };
    this.isol = emptyIsol(); this.vsol = emptyVsol(); this.glob = emptyGlob(); this.post = emptyPost();
    this.param = defaultParam();
    this.messages = [];
    if (coords) set_coords(this, coords); else naca_points(this, naca);
    make_panels(this, npanel);
  }

  setoper(args) {
    const o = this.oper;
    if (args.alpha !== undefined) { o.alpha = args.alpha; o.givencl = false; }
    if (args.cl !== undefined) { o.cltgt = args.cl; o.givencl = true; }
    if (args.Re !== undefined) { o.Re = args.Re; o.viscous = true; }
    if (args.Ma !== undefined) o.Ma = args.Ma;
    if (args.xftl !== undefined) o.xft[0] = args.xftl;
    if (args.xftu !== undefined) o.xft[1] = args.xftu;
    if (args.visc !== undefined) {
      if (o.viscous !== args.visc) clear_solution(this);
      o.viscous = args.visc;
    }
  }

  solve() { if (this.oper.viscous) solve_viscous(this); else solve_inviscid(this); }
  geom_change({ coords = null, naca = '0012' } = {}) {
    if (coords) set_coords(this, coords); else naca_points(this, naca);
    make_panels(this, this.foil.N - 1);
  }
  geom_flap(xzhinge, eta) { mgeom_flap(this, xzhinge, eta); }
  geom_addcamber(xz) { mgeom_addcamber(this, xz); }
  geom_derotate() { mgeom_derotate(this); }
  geom_panel(npanel) { make_panels(this, npanel); }
}

function vprint(M, verb, msg) { if (verb <= M.param.verb) M.messages.push(msg); }

// ============================ POST-PROCESSING ============================

export function calc_force(M) {
  const chord = M.geom.chord, xref = M.geom.xref;
  const Vinf = M.param.Vinf, rho = M.oper.rho, alpha = M.oper.alpha;
  const qinf = 0.5 * rho * Vinf * Vinf;
  const N = M.foil.N, fx = M.foil.x, fz = M.foil.z;

  let ue;
  if (M.oper.viscous) { ue = new Float64Array(M.glob.Nsys); for (let i = 0; i < M.glob.Nsys; i++) ue[i] = M.glob.U[4 * i + 3]; }
  else ue = get_ueinv(M);
  const [cp, cp_ue] = C.get_cp(ue, M.param); M.post.cp = cp;
  M.post.cpi = C.get_cp(get_ueinv(M), M.param)[0];

  let cl = 0, cl_alpha = 0, cm = 0, cdpi = 0; const cl_ue = new Float64Array(N);
  const ca = cosd(alpha), sa = sind(alpha);
  for (let k = 1; k <= N; k++) {
    let i = k, ip = k - 1; if (k === N) { i = 0; ip = N - 1; }
    const x1 = fx[ip], z1 = fz[ip], x2 = fx[i], z2 = fz[i];
    const dxv0 = x2 - x1, dxv1 = z2 - z1;
    const dx10 = x1 - xref[0], dx11 = z1 - xref[1], dx20 = x2 - xref[0], dx21 = z2 - xref[1];
    const dx1nds = dxv0 * dx10 + dxv1 * dx11, dx2nds = dxv0 * dx20 + dxv1 * dx21;
    const dx = -dxv0 * ca - dxv1 * sa, dz = dxv1 * ca - dxv0 * sa;
    const cp1 = cp[ip], cp2 = cp[i], cpbar = 0.5 * (cp1 + cp2);
    cl += dx * cpbar;
    cl_ue[ip] += dx * 0.5 * cp_ue[ip]; cl_ue[i] += dx * 0.5 * cp_ue[i];
    cl_alpha += cpbar * (sa * dxv0 - ca * dxv1) * PI / 180;
    cm += cp1 * dx1nds / 3 + cp1 * dx2nds / 6 + cp2 * dx1nds / 6 + cp2 * dx2nds / 3;
    cdpi += dz * cpbar;
  }
  cl /= chord; cm /= chord * chord; cdpi /= chord;
  Object.assign(M.post, { cl, cl_ue, cl_alpha, cm, cdpi });

  let cd = 0, cdf = 0;
  if (M.oper.viscous) {
    const Is3 = M.vsol.Is[2], iw = Is3[Is3.length - 1];
    const U = M.glob.U.subarray(4 * iw, 4 * iw + 4);
    const H = U[1] / U[0], uew = C.get_uk(U[3], M.param)[0];
    cd = 2.0 * (U[0] / chord) * (uew / Vinf) ** ((5 + H) / 2);
    let Df = 0;
    for (let is = 0; is < 2; is++) {
      const Is = M.vsol.Is[is];
      let param = build_param(M, is);
      param = station_param(M, param, Is[0]);
      let cf1 = 0, ue1 = 0, rho1 = rho, x1 = M.isol.xstag[0], z1 = M.isol.xstag[1];
      for (let i = 0; i < Is.length; i++) {
        param = station_param(M, param, Is[i]);
        const Ui = Ust(M, Is[i]);
        const cf2 = C.get_cf(Ui, param)[0], ue2 = C.get_uk(Ui[3], param)[0], rho2 = C.get_rho(Ui, param)[0];
        const x2 = fx[Is[i]], z2 = fz[Is[i]];
        const dxx = (x2 - x1) * ca + (z2 - z1) * sa;
        Df += 0.25 * (rho1 * cf1 * ue1 * ue1 + rho2 * cf2 * ue2 * ue2) * dxx;
        cf1 = cf2; ue1 = ue2; x1 = x2; z1 = z2; rho1 = rho2;
      }
    }
    cdf = Df / (qinf * chord);
  }
  M.post.cd = cd; M.post.cdf = cdf; M.post.cdp = cd - cdf;
  vprint(M, 1, `alpha=${alpha.toFixed(2)}deg, cl=${cl.toFixed(6)}, cm=${cm.toFixed(6)}, cdpi=${cdpi.toFixed(6)}, cd=${cd.toFixed(6)}, cdf=${cdf.toFixed(6)}, cdp=${(cd - cdf).toFixed(6)}`);
}

// state at node j as plain array [th, ds, sa, ue]
function Ust(M, j) { const U = M.glob.U; return [U[4 * j], U[4 * j + 1], U[4 * j + 2], U[4 * j + 3]]; }

export function get_distributions(M) {
  const Nsys = M.glob.Nsys, U = M.glob.U;
  const th = new Float64Array(Nsys), ds = new Float64Array(Nsys), sa = new Float64Array(Nsys), ue = new Float64Array(Nsys);
  for (let j = 0; j < Nsys; j++) {
    th[j] = U[4 * j]; ds[j] = U[4 * j + 1]; sa[j] = U[4 * j + 2]; ue[j] = C.get_uk(U[4 * j + 3], M.param)[0];
  }
  Object.assign(M.post, { th, ds, sa, ue, uei: get_ueinv(M) });
  const cf = new Float64Array(Nsys), Ret = new Float64Array(Nsys), Hk = new Float64Array(Nsys);
  for (let is = 0; is < 3; is++) {
    const Is = M.vsol.Is[is];
    let param = build_param(M, is);
    for (const j of Is) {
      const Uj = Ust(M, j);
      param = station_param(M, param, j);
      const uk = C.get_uk(Uj[3], param)[0];
      cf[j] = C.get_cf(Uj, param)[0] * uk * uk / (param.Vinf * param.Vinf);
      Ret[j] = C.get_Ret(Uj, param)[0];
      Hk[j] = C.get_Hk(Uj, param)[0];
    }
  }
  Object.assign(M.post, { cf, Ret, Hk });
}

// ============================ INVISCID ============================

export function clear_solution(M) {
  M.isol = emptyIsol(); M.vsol = emptyVsol(); M.glob = emptyGlob(); M.post = emptyPost();
  M.wake = emptyPanel();
}

export function solve_inviscid(M) {
  if (!(M.foil.N > 0)) throw new Error('No panels');
  M.oper.viscous = false;
  init_thermo(M);
  M.isol.sgnue = new Float64Array(M.foil.N).fill(1);
  build_gamma(M, M.oper.alpha);
  if (M.oper.givencl) cltrim_inviscid(M);
  calc_force(M);
  M.glob.conv = true;
}

function cltrim_inviscid(M) {
  let i;
  const N = M.foil.N, gr = M.isol.gamref;
  for (i = 1; i <= 15; i++) {
    const alpha = M.oper.alpha;
    calc_force(M);
    const R = M.post.cl - M.oper.cltgt;
    if (Math.abs(R) < 1e-10) break;
    const s0 = -sind(alpha) * PI / 180, s1 = cosd(alpha) * PI / 180;
    let cl_a = M.post.cl_alpha;
    for (let k = 0; k < N; k++) cl_a += M.post.cl_ue[k] * (gr[2 * k] * s0 + gr[2 * k + 1] * s1);
    const dalpha = -R / cl_a;
    M.oper.alpha = alpha + Math.min(Math.max(dalpha, -2), 2);
  }
  if (i >= 15) vprint(M, 1, '** inviscid cl trim not converged **');
  setGam(M);
}

function setGam(M) {
  const N = M.foil.N, gr = M.isol.gamref, ca = cosd(M.oper.alpha), sa = sind(M.oper.alpha);
  const g = new Float64Array(N);
  for (let k = 0; k < N; k++) g[k] = gr[2 * k] * ca + gr[2 * k + 1] * sa;
  M.isol.gam = g;
}

// inviscid edge velocity at airfoil (and wake) nodes
export function get_ueinv(M) {
  const N = M.foil.N, gr = M.isol.gamref, ca = cosd(M.oper.alpha), sa = sind(M.oper.alpha);
  const hasWake = M.oper.viscous && M.wake.N > 0;
  const Nw = hasWake ? M.wake.N : 0;
  const ue = new Float64Array(N + Nw);
  for (let k = 0; k < N; k++) ue[k] = M.isol.sgnue[k] * (gr[2 * k] * ca + gr[2 * k + 1] * sa);
  if (hasWake) {
    const wr = M.isol.uewiref;
    for (let k = 0; k < Nw; k++) ue[N + k] = wr[2 * k] * ca + wr[2 * k + 1] * sa;
    ue[N] = ue[N - 1];
  }
  return ue;
}

// 0/90-degree reference ue, returns [Nsys x 2] as array of [a,b]
function get_ueinvref(M) {
  const N = M.foil.N, gr = M.isol.gamref;
  const hasWake = M.oper.viscous && M.wake.N > 0;
  const Nw = hasWake ? M.wake.N : 0;
  const out = new Float64Array(2 * (N + Nw));
  for (let k = 0; k < N; k++) { out[2 * k] = M.isol.sgnue[k] * gr[2 * k]; out[2 * k + 1] = M.isol.sgnue[k] * gr[2 * k + 1]; }
  if (hasWake) {
    const wr = M.isol.uewiref;
    for (let k = 0; k < Nw; k++) { out[2 * (N + k)] = wr[2 * k]; out[2 * (N + k) + 1] = wr[2 * k + 1]; }
    out[2 * N] = out[2 * (N - 1)]; out[2 * N + 1] = out[2 * (N - 1) + 1];
  }
  return out;
}

export function build_gamma(M, alpha) {
  const N = M.foil.N, fx = M.foil.x, fz = M.foil.z, n1 = N + 1;
  const A = new Float64Array(n1 * n1), rhs = new Float64Array(n1 * 2);
  const te = TE_info(M.foil);
  const nogap = Math.abs(te.hTE) < 1e-10 * M.geom.chord;
  vprint(M, 1, '<<< Solving inviscid problem >>>');
  for (let i = 0; i < N; i++) {
    const xi = fx[i], zi = fz[i], r = i * n1;
    for (let j = 0; j < N - 1; j++) {
      const [aij, bij] = panel_linvortex_stream(fx[j], fz[j], fx[j + 1], fz[j + 1], xi, zi);
      A[r + j] += aij; A[r + j + 1] += bij;
    }
    A[r + N] = -1;
    rhs[2 * i] = -zi; rhs[2 * i + 1] = xi;
    if (!nogap) {
      const a = panel_constsource_stream(fx[N - 1], fz[N - 1], fx[0], fz[0], xi, zi);
      A[r] -= a * (0.5 * te.tcp); A[r + N - 1] += a * (0.5 * te.tcp);
      const [av, bv] = panel_linvortex_stream(fx[N - 1], fz[N - 1], fx[0], fz[0], xi, zi);
      A[r] -= (av + bv) * (-0.5 * te.tdp); A[r + N - 1] += (av + bv) * (-0.5 * te.tdp);
    }
  }
  if (nogap) {
    const r = (N - 1) * n1;
    for (let j = 0; j < n1; j++) A[r + j] = 0;
    A[r + 0] = 1; A[r + 1] = -2; A[r + 2] = 1; A[r + N - 3] = -1; A[r + N - 2] = 2; A[r + N - 1] = -1;
  }
  A[N * n1 + 0] = 1; A[N * n1 + N - 1] = 1; // Kutta condition
  M.isol.AIC = luFactor(A, n1);
  const g = luSolve(M.isol.AIC, rhs, 2);
  M.isol.gamref = g.slice(0, 2 * N); // [N x 2] row-major
  setGam(M);
}

// velocity at (x,z) from gamma G on airfoil + freestream; optionally d(V)/d(G)
export function inviscid_velocity(foil, G, Vinf, alpha, x, z, dolin = false, te = null) {
  const N = foil.N, X = foil.x, Zc = foil.z;
  let Vx = 0, Vz = 0;
  const VGx = dolin ? new Float64Array(N) : null, VGz = dolin ? new Float64Array(N) : null;
  te = te || TE_info(foil);
  for (let j = 0; j < N - 1; j++) {
    const c = panel_linvortex_velocity(X[j], Zc[j], X[j + 1], Zc[j + 1], x, z, false);
    Vx += c[0] * G[j] + c[2] * G[j + 1]; Vz += c[1] * G[j] + c[3] * G[j + 1];
    if (dolin) { VGx[j] += c[0]; VGz[j] += c[1]; VGx[j + 1] += c[2]; VGz[j + 1] += c[3]; }
  }
  if (te.hasPanel) {
    const a = panel_constsource_velocity(X[N - 1], Zc[N - 1], X[0], Zc[0], x, z);
    let f1 = -0.5 * te.tcp, f2 = 0.5 * te.tcp;
    Vx += a[0] * (f1 * G[0] + f2 * G[N - 1]); Vz += a[1] * (f1 * G[0] + f2 * G[N - 1]);
    if (dolin) { VGx[0] += a[0] * f1; VGz[0] += a[1] * f1; VGx[N - 1] += a[0] * f2; VGz[N - 1] += a[1] * f2; }
    const c = panel_linvortex_velocity(X[N - 1], Zc[N - 1], X[0], Zc[0], x, z, false);
    const abx = c[0] + c[2], abz = c[1] + c[3];
    f1 = 0.5 * te.tdp; f2 = -0.5 * te.tdp;
    Vx += abx * (f1 * G[0] + f2 * G[N - 1]); Vz += abz * (f1 * G[0] + f2 * G[N - 1]);
    if (dolin) { VGx[0] += abx * f1; VGz[0] += abz * f1; VGx[N - 1] += abx * f2; VGz[N - 1] += abz * f2; }
  }
  Vx += Vinf * cosd(alpha); Vz += Vinf * sind(alpha);
  return dolin ? [Vx, Vz, VGx, VGz] : [Vx, Vz];
}

export function build_wake(M) {
  const N = M.foil.N, Vinf = M.oper.Vinf, fx = M.foil.x, fz = M.foil.z;
  const Nw = Math.ceil(N / 10 + 10 * M.geom.wakelen);
  const S = M.foil.s;
  const ds1 = 0.5 * (S[1] - S[0] + S[N - 1] - S[N - 2]);
  const sv = space_geom(ds1, M.geom.wakelen * M.geom.chord, Nw);
  const wx = new Float64Array(Nw), wz = new Float64Array(Nw), tx = new Float64Array(Nw), tz = new Float64Array(Nw);
  const nx = fx[N - 1] - fx[0], nz = fz[N - 1] - fz[0];
  let t0 = nz, t1 = -nx;
  if (!(t0 > 0)) {
    // sharp TE (zero-length TE panel): use the bisector of the TE tangents instead
    const te = TE_info(M.foil); t0 = te.t[0]; t1 = te.t[1];
    if (!(t0 > 0)) throw new Error('Wrong wake direction; ensure airfoil points are CCW');
  }
  wx[0] = 0.5 * (fx[0] + fx[N - 1]) + 1e-5 * t0 * M.geom.chord;
  wz[0] = 0.5 * (fz[0] + fz[N - 1]) + 1e-5 * t1 * M.geom.chord;
  const sw = new Float64Array(Nw);
  for (let i = 0; i < Nw; i++) sw[i] = S[N - 1] + sv[i];
  const G = M.isol.gam, al = M.oper.alpha, te = TE_info(M.foil);
  for (let i = 0; i < Nw - 1; i++) {
    let [v1x, v1z] = inviscid_velocity(M.foil, G, Vinf, al, wx[i], wz[i], false, te);
    let n = Math.hypot(v1x, v1z); v1x /= n; v1z /= n; tx[i] = v1x; tz[i] = v1z;
    const h = sv[i + 1] - sv[i];
    wx[i + 1] = wx[i] + h * v1x; wz[i + 1] = wz[i] + h * v1z;
    let [v2x, v2z] = inviscid_velocity(M.foil, G, Vinf, al, wx[i + 1], wz[i + 1], false, te);
    n = Math.hypot(v2x, v2z); v2x /= n; v2z /= n; tx[i + 1] = v2x; tz[i + 1] = v2z;
    wx[i + 1] = wx[i] + h * 0.5 * (v1x + v2x); wz[i + 1] = wz[i] + h * 0.5 * (v1z + v2z);
  }
  const uewi = new Float64Array(Nw), uewiref = new Float64Array(2 * Nw);
  const gr = M.isol.gamref, g0 = new Float64Array(N), g90 = new Float64Array(N);
  for (let k = 0; k < N; k++) { g0[k] = gr[2 * k]; g90[k] = gr[2 * k + 1]; }
  for (let i = 0; i < Nw; i++) {
    let v = inviscid_velocity(M.foil, G, Vinf, al, wx[i], wz[i], false, te);
    uewi[i] = v[0] * tx[i] + v[1] * tz[i];
    v = inviscid_velocity(M.foil, g0, Vinf, 0, wx[i], wz[i], false, te);
    uewiref[2 * i] = v[0] * tx[i] + v[1] * tz[i];
    v = inviscid_velocity(M.foil, g90, Vinf, 90, wx[i], wz[i], false, te);
    uewiref[2 * i + 1] = v[0] * tx[i] + v[1] * tz[i];
  }
  M.wake = { N: Nw, x: wx, z: wz, s: sw, tx, tz };
  M.isol.uewi = uewi; M.isol.uewiref = uewiref;
}

export function stagpoint_find(M) {
  const N = M.foil.N, gam = M.isol.gam;
  let j0 = -1;
  for (let k = 0; k < N; k++) if (gam[k] > 0) { j0 = k; break; }
  if (j0 < 1) throw new Error('no stagnation point');
  const I = [j0 - 1, j0];
  const G0 = gam[I[0]], G1 = gam[I[1]], S0 = M.foil.s[I[0]], S1 = M.foil.s[I[1]];
  M.isol.Istag = I;
  const den = G1 - G0, w1 = G1 / den, w2 = -G0 / den;
  M.isol.sstag = w1 * S0 + w2 * S1;
  M.isol.xstag = [M.foil.x[I[0]] * w1 + M.foil.x[I[1]] * w2, M.foil.z[I[0]] * w1 + M.foil.z[I[1]] * w2];
  const st_g1 = G1 * (S0 - S1) / (den * den);
  M.isol.sstag_g = [st_g1, -st_g1];
  const sgnue = new Float64Array(N).fill(-1);
  for (let k = 0; k < N; k++) if (gam[k] > 0) sgnue[k] = 1;
  M.isol.sgnue = sgnue;
  set_xi(M);
}

function set_xi(M) {
  const N = M.foil.N, Nw = M.wake.N, xi = new Float64Array(N + Nw);
  for (let k = 0; k < N; k++) xi[k] = Math.abs(M.foil.s[k] - M.isol.sstag);
  for (let k = 0; k < Nw; k++) xi[N + k] = M.wake.s[k] - M.isol.sstag;
  M.isol.xi = xi;
}

function rebuild_isol(M) {
  vprint(M, 2, 'Rebuilding the inviscid solution.');
  setGam(M);
  if (!M.oper.viscous) stagpoint_find(M);
  else if (M.oper.redowake) { build_wake(M); identify_surfaces(M); calc_ue_m(M); }
}

// ============================ PANELING ============================

export function make_panels(M, npanel) {
  clear_solution(M);
  const r = spline_curvature(M.geom.xpoint, npanel + 1, 2, 0.1);
  M.foil = { N: r.X.x.length, x: r.X.x, z: r.X.z, s: r.S, tx: r.XS.x, tz: r.XS.z };
}

export function TE_info(foil) {
  const X = foil.x, Z = foil.z, N = X.length;
  let t1x = X[0] - X[1], t1z = Z[0] - Z[1]; let n = Math.hypot(t1x, t1z); t1x /= n; t1z /= n;
  let t2x = X[N - 1] - X[N - 2], t2z = Z[N - 1] - Z[N - 2]; n = Math.hypot(t2x, t2z); t2x /= n; t2z /= n;
  let tx = 0.5 * (t1x + t2x), tz = 0.5 * (t1z + t2z); n = Math.hypot(tx, tz); tx /= n; tz /= n;
  const sx = X[N - 1] - X[0], sz = Z[N - 1] - Z[0];
  const hTE = -sx * tz + sz * tx;
  const dtdx = t1x * t2z - t2x * t1z;
  const sl = Math.hypot(sx, sz);
  let tcp = 0, tdp = 0;
  const hasPanel = sl > 1e-12;
  if (hasPanel) { const px = sx / sl, pz = sz / sl; tcp = Math.abs(tx * pz - tz * px); tdp = tx * px + tz * pz; }
  return { t: [tx, tz], hTE, dtdx, tcp, tdp, hasPanel };
}

// ---- panel influence functions (endpoints (x1,z1)-(x2,z2), control point (xi,zi)) ----
function panelLocal(x1, z1, x2, z2, xi, zi) {
  const dx = x2 - x1, dz = z2 - z1, d = Math.hypot(dx, dz);
  const tx = dx / d, tz = dz / d, nx = -tz, nz = tx;
  const rx = xi - x1, rz = zi - z1;
  const x = rx * tx + rz * tz, z = rx * nx + rz * nz;
  return { tx, tz, nx, nz, x, z, d };
}

// returns [ax, az, bx, bz]
export function panel_linvortex_velocity(x1, z1, x2, z2, xi, zi, onmid) {
  const { tx, tz, nx, nz, x, z, d } = panelLocal(x1, z1, x2, z2, xi, zi);
  let ug1, ug2, wg1, wg2;
  if (onmid) { ug1 = 0.25; ug2 = 0.25; wg1 = -1 / (2 * PI); wg2 = 1 / (2 * PI); }
  else {
    const r1 = Math.hypot(x, z), r2 = Math.hypot(x - d, z);
    const th1 = Math.atan2(z, x), th2 = Math.atan2(z, x - d);
    const lr = Math.log(r1 / r2);
    let temp1 = (th2 - th1) / (2 * PI);
    let temp2 = (2 * z * lr - 2 * x * (th2 - th1)) / (4 * PI * d);
    ug1 = temp1 + temp2; ug2 = -temp2;
    temp1 = -lr / (2 * PI);
    temp2 = (x * lr - d + z * (th2 - th1)) / (2 * PI * d);
    wg1 = temp1 + temp2; wg2 = -temp2;
  }
  return [ug1 * tx + wg1 * nx, ug1 * tz + wg1 * nz, ug2 * tx + wg2 * nx, ug2 * tz + wg2 * nz];
}

export function panel_linvortex_stream(x1, z1, x2, z2, xi, zi) {
  const { x, z, d } = panelLocal(x1, z1, x2, z2, xi, zi);
  const r1 = Math.hypot(x, z), r2 = Math.hypot(x - d, z);
  const th1 = Math.atan2(z, x), th2 = Math.atan2(z, x - d);
  const ep = 1e-10;
  const logr1 = r1 < ep ? 0 : Math.log(r1), logr2 = r2 < ep ? 0 : Math.log(r2);
  const P1 = (0.5 / PI) * (z * (th2 - th1) - d + x * logr1 - (x - d) * logr2);
  const P2 = x * P1 + (0.5 / PI) * (0.5 * r2 * r2 * logr2 - 0.5 * r1 * r1 * logr1 - r2 * r2 / 4 + r1 * r1 / 4);
  return [P1 - P2 / d, P2 / d];
}

// returns [ax, az]
export function panel_constsource_velocity(x1, z1, x2, z2, xi, zi) {
  const { tx, tz, nx, nz, x, z, d } = panelLocal(x1, z1, x2, z2, xi, zi);
  const r1 = Math.hypot(x, z), r2 = Math.hypot(x - d, z);
  let th1 = Math.atan2(z, x), th2 = Math.atan2(z, x - d);
  const ep = 1e-9;
  let logr1, logr2;
  if (r1 < ep) { logr1 = 0; th1 = PI; th2 = PI; } else logr1 = Math.log(r1);
  if (r2 < ep) { logr2 = 0; th1 = 0; th2 = 0; } else logr2 = Math.log(r2);
  const u = (0.5 / PI) * (logr1 - logr2), w = (0.5 / PI) * (th2 - th1);
  return [u * tx + w * nx, u * tz + w * nz];
}

export function panel_constsource_stream(x1, z1, x2, z2, xi, zi) {
  const { x, z, d } = panelLocal(x1, z1, x2, z2, xi, zi);
  const r1 = Math.hypot(x, z), r2 = Math.hypot(x - d, z);
  let th1 = Math.atan2(z, x), th2 = Math.atan2(z, x - d);
  const ep = 1e-9;
  let logr1, logr2;
  if (r1 < ep) { logr1 = 0; th1 = PI; th2 = PI; } else logr1 = Math.log(r1);
  if (r2 < ep) { logr2 = 0; th1 = 0; th2 = 0; } else logr2 = Math.log(r2);
  let P = (x * (th1 - th2) + d * th2 + z * logr1 - z * logr2) / (2 * PI);
  if (th1 + th2 > PI) P -= 0.25 * d; else P += 0.75 * d;
  return P;
}

// returns [ax, az, bx, bz]
export function panel_linsource_velocity(x1, z1, x2, z2, xi, zi) {
  const { tx, tz, nx, nz, x, z, d } = panelLocal(x1, z1, x2, z2, xi, zi);
  const r1 = Math.hypot(x, z), r2 = Math.hypot(x - d, z);
  const th1 = Math.atan2(z, x), th2 = Math.atan2(z, x - d);
  const lr = Math.log(r1 / r2);
  let temp1 = lr / (2 * PI);
  let temp2 = (x * lr - d + z * (th2 - th1)) / (2 * PI * d);
  const ug1 = temp1 - temp2, ug2 = temp2;
  temp1 = (th2 - th1) / (2 * PI);
  temp2 = (-z * lr + x * (th2 - th1)) / (2 * PI * d);
  const wg1 = temp1 - temp2, wg2 = temp2;
  return [ug1 * tx + wg1 * nx, ug1 * tz + wg1 * nz, ug2 * tx + wg2 * nx, ug2 * tz + wg2 * nz];
}

export function panel_linsource_stream(x1, z1, x2, z2, xi, zi) {
  const { x, z, d } = panelLocal(x1, z1, x2, z2, xi, zi);
  const r1 = Math.hypot(x, z), r2 = Math.hypot(x - d, z);
  let th1 = Math.atan2(z, x), th2 = Math.atan2(z, x - d);
  if (th1 < 0) th1 += 2 * PI;
  if (th2 < 0) th2 += 2 * PI;
  const ep = 1e-9;
  let logr1, logr2;
  if (r1 < ep) { logr1 = 0; th1 = PI; th2 = PI; } else logr1 = Math.log(r1);
  if (r2 < ep) { logr2 = 0; th1 = 0; th2 = 0; } else logr2 = Math.log(r2);
  const P1 = (0.5 / PI) * (x * (th1 - th2) + th2 * d + z * logr1 - z * logr2);
  const P2 = x * P1 + (0.5 / PI) * (0.5 * r2 * r2 * th2 - 0.5 * r1 * r1 * th1 - 0.5 * z * d);
  return [P1 - P2 / d, P2 / d];
}

// ============================ GEOMETRY ============================

function mgeom_flap(M, xzhinge, eta) {
  const X = M.geom.xpoint, N = X.x.length, xh = xzhinge[0], zh = xzhinge[1];
  const xs = Float64Array.from(X.x), zs = Float64Array.from(X.z);
  const ce = cosd(eta), se = sind(eta);
  const onFlap = [];
  for (let i = 0; i < N; i++) if (xs[i] > xh) {
    onFlap.push(i);
    const dx = xs[i] - xh, dz = zs[i] - zh;
    xs[i] = xh + ce * dx + se * dz; zs[i] = zh - se * dx + ce * dz;
  }
  const remove = new Set(onFlap.filter(i => xs[i] < xh));
  const kx = [], kz = [];
  for (let i = 0; i < N; i++) if (!remove.has(i)) { kx.push(xs[i]); kz.push(zs[i]); }
  M.geom.xpoint = { x: Float64Array.from(kx), z: Float64Array.from(kz) }; M.geom.npoint = kx.length;
  if (M.foil.N > 0) make_panels(M, M.foil.N - 1);
  clear_solution(M);
}

function mgeom_addcamber(M, xz) {
  const X = M.geom.xpoint;
  const dz = ppval(spline(xz.x, xz.z), X.x);
  const z = Float64Array.from(X.z, (v, i) => v + dz[i]);
  M.geom.xpoint = { x: Float64Array.from(X.x), z }; M.geom.npoint = z.length;
  if (M.foil.N > 0) make_panels(M, M.foil.N - 1);
  clear_solution(M);
}

function mgeom_derotate(M) {
  const X = M.geom.xpoint, N = X.x.length;
  let I = 0; for (let i = 1; i < N; i++) if (X.x[i] < X.x[I]) I = i;
  const xLE = X.x[I], zLE = X.z[I];
  const xTE = 0.5 * (X.x[0] + X.x[N - 1]), zTE = 0.5 * (X.z[0] + X.z[N - 1]);
  const th = Math.atan2(zTE - zLE, xTE - xLE), c = Math.cos(th), s = Math.sin(th);
  const x = new Float64Array(N), z = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const dx = X.x[i] - xLE, dz = X.z[i] - zLE;
    x[i] = xLE + c * dx + s * dz; z[i] = zLE - s * dx + c * dz;
  }
  M.geom.xpoint = { x, z }; M.geom.npoint = N;
  if (M.foil.N > 0) make_panels(M, M.foil.N - 1);
  clear_solution(M);
}

export function space_geom(dx0, L, Np) {
  const N = Np - 1;
  const d = L / dx0, a = N * (N - 1) * (N - 2) / 6, b = N * (N - 1) / 2, c = N - d;
  const disc = Math.max(b * b - 4 * a * c, 0);
  let r = 1 + (-b + Math.sqrt(disc)) / (2 * a);
  for (let k = 0; k < 10; k++) {
    const R = r ** N - 1 - d * (r - 1), R_r = N * r ** (N - 1) - d, dr = -R / R_r;
    if (Math.abs(dr) < 1e-6) break;
    r = r - R / R_r;
  }
  const x = new Float64Array(Np);
  for (let i = 1; i < Np; i++) x[i] = x[i - 1] + dx0 * r ** (i - 1);
  return x;
}

// X: {x, z} arrays (or array of [x,z] pairs)
export function set_coords(M, X) {
  let xs, zs;
  if (Array.isArray(X)) { xs = Float64Array.from(X, p => p[0]); zs = Float64Array.from(X, p => p[1]); }
  else { xs = Float64Array.from(X.x); zs = Float64Array.from(X.z); }
  let A = 0;
  for (let i = 0; i < xs.length - 1; i++) A += (xs[i + 1] - xs[i]) * (zs[i + 1] + zs[i]);
  if (A < 0) { xs.reverse(); zs.reverse(); }
  M.geom.npoint = xs.length;
  M.geom.xpoint = { x: xs, z: zs };
  let mn = Infinity, mx = -Infinity; for (const v of xs) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
  M.geom.chord = mx - mn;
}

export function naca_points(M, digits) {
  digits = String(digits).trim();
  M.geom.name = `NACA ${digits}`;
  const N = 100, te = 1.5;
  const x = new Float64Array(N + 1), t = new Float64Array(N + 1), c = new Float64Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const f = i / N;
    x[i] = 1 - (te + 1) * f * (1 - f) ** te - (1 - f) ** (te + 1);
  }
  const tmax = Number(digits.slice(-2)) * 0.01;
  for (let i = 0; i <= N; i++) {
    const xx = x[i];
    t[i] = (0.2969 * Math.sqrt(xx) - 0.126 * xx - 0.3516 * xx ** 2 + 0.2843 * xx ** 3 - 0.1015 * xx ** 4) * tmax / 0.2;
  }
  if (digits.length === 4) {
    const m = Number(digits[0]) * 0.01, p = Number(digits[1]) * 0.1;
    for (let i = 0; i <= N; i++) {
      const xx = x[i];
      if (xx < p) c[i] = m / (p * p) * (2 * p * xx - xx * xx);
      else c[i] = m / (1 - p) ** 2 * ((1 - 2 * p) + 2 * p * xx - xx * xx);
    }
  } else if (digits.length === 5) {
    const n = Number(digits[1]);
    const valid = digits[0] === '2' && digits[2] === '0' && n > 0 && n < 6;
    if (!valid) throw new Error('5-digit NACA must begin with 2X0, X in 1-5');
    const m = [0.058, 0.126, 0.2025, 0.29, 0.391][n - 1], cc = [361.4, 51.64, 15.957, 6.643, 3.23][n - 1];
    for (let i = 0; i <= N; i++) {
      const xx = x[i];
      c[i] = xx > m ? (cc / 6) * m ** 3 * (1 - xx) : (cc / 6) * (xx ** 3 - 3 * m * xx ** 2 + m * m * (3 - m) * xx);
    }
  } else throw new Error('Provide 4 or 5 NACA digits');
  if (!digits.split('').every(ch => ch >= '0' && ch <= '9')) throw new Error('NACA digits must be numbers');
  const np = 2 * N + 1, xs = new Float64Array(np), zs = new Float64Array(np);
  for (let i = 0; i <= N; i++) { xs[i] = x[N - i]; zs[i] = c[N - i] - t[N - i]; }
  for (let i = 1; i <= N; i++) { xs[N + i] = x[i]; zs[N + i] = c[i] + t[i]; }
  M.geom.npoint = np; M.geom.xpoint = { x: xs, z: zs };
  let mn = Infinity, mx = -Infinity; for (const v of xs) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
  M.geom.chord = mx - mn;
}

const QX = [0.046910077030668, 0.230765344947158, 0.5, 0.769234655052842, 0.953089922969332];
const QW = [0.118463442528095, 0.239314335249683, 0.284444444444444, 0.239314335249683, 0.118463442528095];

function spline2d(x, z) {
  const N = x.length;
  let S = new Float64Array(N);
  for (let i = 1; i < N; i++) S[i] = S[i - 1] + Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1]);
  let PX = spline(S, x), PZ = spline(S, z);
  for (let pass = 0; pass < 10; pass++) {
    const Snew = new Float64Array(N); Snew[0] = S[0];
    for (let i = 0; i < N - 1; i++) {
      const ds = S[i + 1] - S[i];
      const a = PX.coefs, b = PZ.coefs, o = 4 * i;
      let sint = 0;
      for (let q = 0; q < 5; q++) {
        const st = QX[q] * ds;
        const xs = 3 * a[o] * st * st + 2 * a[o + 1] * st + a[o + 2];
        const zs = 3 * b[o] * st * st + 2 * b[o + 1] * st + b[o + 2];
        sint += QW[q] * Math.sqrt(xs * xs + zs * zs);
      }
      Snew[i + 1] = Snew[i] + sint * ds;
    }
    S = Snew;
    PX = spline(S, x); PZ = spline(S, z);
  }
  return { PX, PZ, breaks: S };
}

function spline_curvature(Xin, N, Ufac, TEfac) {
  let xmin = Infinity, xmax = -Infinity;
  for (const v of Xin.x) { xmin = Math.min(xmin, v); xmax = Math.max(xmax, v); }
  const PP = spline2d(Xin.x, Xin.z);
  const nfine = 501, L = PP.breaks[PP.breaks.length - 1];
  let s = new Float64Array(nfine);
  for (let i = 0; i < nfine; i++) s[i] = L * i / (nfine - 1);
  const xf = ppval(PP.PX, s), zf = ppval(PP.PZ, s);
  const PPf = spline2d(xf, zf);
  s = PPf.breaks;
  const sk = new Float64Array(nfine);
  for (let i = 0; i < nfine - 1; i++) {
    const ds = s[i + 1] - s[i], o = 4 * i, a = PPf.PX.coefs, b = PPf.PZ.coefs;
    let kint = 0;
    for (let q = 0; q < 5; q++) {
      const st = QX[q] * ds;
      const xss = 6 * a[o] * st + 2 * a[o + 1], zss = 6 * b[o] * st + 2 * b[o + 1];
      kint += QW[q] * Math.sqrt(xss * xss + zss * zss);
    }
    let skint = 0.01 * Ufac + 0.5 * kint * ds;
    const xx = (0.5 * (xf[i] + xf[i + 1]) - xmin) / (xmax - xmin);
    skint += TEfac * 0.5 * Math.exp(-100 * (1.0 - xx));
    sk[i + 1] = sk[i] + skint;
  }
  let sum = 0; for (const v of sk) sum += v;
  for (let i = 0; i < nfine; i++) sk[i] += 2.0 * sum / nfine;
  const skl = new Float64Array(N);
  for (let i = 0; i < N; i++) skl[i] = sk[0] + (sk[nfine - 1] - sk[0]) * i / (N - 1);
  const snew = ppval(spline(sk, s), skl);
  return {
    X: { x: ppval(PPf.PX, snew), z: ppval(PPf.PZ, snew) },
    S: snew,
    XS: { x: ppder(PPf.PX, snew), z: ppder(PPf.PZ, snew) },
  };
}

// ============================ VISCOUS ============================

export function calc_ue_m(M) {
  const N = M.foil.N, Nw = M.wake.N, fx = M.foil.x, fz = M.foil.z, wx = M.wake.x, wz = M.wake.z;
  if (!(Nw > 0)) throw new Error('No wake');
  const Np = N + Nw - 2; // number of source panels
  const te = TE_info(M.foil);
  // Cgam = d(wake uei)/d(gamma) [Nw x N]
  const Cgam = new Float64Array(Nw * N);
  for (let i = 0; i < Nw; i++) {
    const [, , VGx, VGz] = inviscid_velocity(M.foil, M.isol.gam, 0, 0, wx[i], wz[i], true, te);
    for (let k = 0; k < N; k++) Cgam[i * N + k] = VGx[k] * M.wake.tx[i] + VGz[k] * M.wake.tz[i];
  }
  // B = d(airfoil surf streamfunction)/d(source) [(N+1) x Np]
  const B = new Float64Array((N + 1) * Np);
  for (let i = 0; i < N; i++) {
    const xi = fx[i], zi = fz[i], r = i * Np;
    for (let j = 0; j < N - 1; j++) B[r + j] = panel_constsource_stream(fx[j], fz[j], fx[j + 1], fz[j + 1], xi, zi);
    for (let j = 0; j < Nw - 1; j++) {
      const x1 = wx[j], z1 = wz[j], x2 = wx[j + 1], z2 = wz[j + 1];
      const xm = 0.5 * (x1 + x2), zm = 0.5 * (z1 + z2);
      let x3 = x2, z3 = z2;
      if (j === Nw - 2) { x3 = 2 * x2 - xm; z3 = 2 * z2 - zm; }
      const c = N - 1 + j;
      let [a, b] = panel_linsource_stream(x1, z1, xm, zm, xi, zi);
      if (j > 0) { B[r + c] += 0.5 * a + b; B[r + c - 1] += 0.5 * a; }
      else B[r + c] += b;
      [a, b] = panel_linsource_stream(xm, zm, x3, z3, xi, zi);
      B[r + c] += a + 0.5 * b;
      if (j < Nw - 2) B[r + c + 1] += 0.5 * b; else B[r + c] += 0.5 * b;
    }
  }
  // Bp = -AIC \ B  (N rows kept)
  const BpFull = luSolve(M.isol.AIC, B, Np);
  const Bp = new Float64Array(N * Np);
  for (let k = 0; k < N * Np; k++) Bp[k] = -BpFull[k];
  // Csig = d(wake uei)/d(source) [Nw x Np]
  const Csig = new Float64Array(Nw * Np);
  for (let i = 0; i < Nw; i++) {
    const xi = wx[i], zi = wz[i], tix = M.wake.tx[i], tiz = M.wake.tz[i], r = i * Np;
    const js = i === 0 ? 1 : 0, je = i === 0 ? N - 3 : N - 2;
    for (let j = js; j <= je; j++) {
      const a = panel_constsource_velocity(fx[j], fz[j], fx[j + 1], fz[j + 1], xi, zi);
      Csig[r + j] = a[0] * tix + a[1] * tiz;
    }
    for (let j = 0; j < Nw; j++) {
      const I0 = Math.max(j - 1, 0), I2 = Math.min(j + 1, Nw - 1);
      let X1 = 0.5 * (wx[I0] + wx[j]), Z1 = 0.5 * (wz[I0] + wz[j]);
      const X2 = wx[j], Z2 = wz[j];
      let X3 = 0.5 * (wx[j] + wx[I2]), Z3 = 0.5 * (wz[j] + wz[I2]);
      if (j === Nw - 1) { X3 = 2 * X2 - X1; Z3 = 2 * Z2 - Z1; }
      const d1 = Math.hypot(X2 - X1, Z2 - Z1), d2 = Math.hypot(X3 - X2, Z3 - Z2);
      if (i === j) {
        if (j === 0) {
          const dl = Math.hypot(fx[1] - fx[0], fz[1] - fz[0]);
          const du = Math.hypot(fx[N - 1] - fx[N - 2], fz[N - 1] - fz[N - 2]);
          Csig[r + 0] += (0.5 / PI) * (Math.log(dl / d2) + 1);
          Csig[r + N - 2] += (0.5 / PI) * (Math.log(du / d2) + 1);
          Csig[r + N - 1] += -0.5 / PI;
        } else if (j === Nw - 1) {
          // last point: no self effect of last panel (ghost extension)
        } else {
          const aa = (0.25 / PI) * Math.log(d1 / d2);
          Csig[r + N - 2 + j] += aa + 0.5 / PI;
          Csig[r + N - 1 + j] += aa - 0.5 / PI;
        }
      } else {
        if (j === 0) {
          const v = panel_linsource_velocity(X2, Z2, X3, Z3, xi, zi);
          const a = v[0] * tix + v[1] * tiz, b = v[2] * tix + v[3] * tiz;
          Csig[r + N - 1] += b; Csig[r + 0] += a; Csig[r + N - 2] += a;
        } else if (j === Nw - 1) {
          const v = panel_constsource_velocity(X1, Z1, X3, Z3, xi, zi);
          Csig[r + Np - 1] += v[0] * tix + v[1] * tiz;
        } else {
          const v1 = panel_linsource_velocity(X1, Z1, X2, Z2, xi, zi);
          const v2 = panel_linsource_velocity(X2, Z2, X3, Z3, xi, zi);
          const a1 = v1[0] * tix + v1[1] * tiz, b1 = v1[2] * tix + v1[3] * tiz;
          const a2 = v2[0] * tix + v2[1] * tiz, b2 = v2[2] * tix + v2[3] * tiz;
          Csig[r + N - 2 + j] += a1 + 0.5 * b1;
          Csig[r + N - 1 + j] += 0.5 * a2 + b2;
        }
      }
    }
  }
  // ue_sigma = [Bp; Cgam*Bp + Csig], first wake row = last airfoil row
  const Nt = N + Nw, ue_sigma = new Float64Array(Nt * Np);
  ue_sigma.set(Bp, 0);
  for (let i = 0; i < Nw; i++) {
    const r = (N + i) * Np;
    if (i === 0) { for (let p = 0; p < Np; p++) ue_sigma[r + p] = Bp[(N - 1) * Np + p]; continue; }
    for (let p = 0; p < Np; p++) ue_sigma[r + p] = Csig[i * Np + p];
    for (let k = 0; k < N; k++) {
      const c = Cgam[i * N + k]; if (c === 0) continue;
      const rk = k * Np;
      for (let p = 0; p < Np; p++) ue_sigma[r + p] += c * Bp[rk + p];
    }
  }
  M.vsol.ue_sigma = ue_sigma;
  rebuild_ue_m(M);
}

// sigma_m stored as two entries per panel: {c1, v1, c2, v2}
function rebuild_ue_m(M) {
  const N = M.foil.N, Nw = M.wake.N, Nt = N + Nw, Np = N + Nw - 2, sg = M.isol.sgnue;
  const c1 = new Int32Array(Np), c2 = new Int32Array(Np), v1 = new Float64Array(Np), v2 = new Float64Array(Np);
  for (let i = 0; i < N - 1; i++) {
    const ds = M.foil.s[i + 1] - M.foil.s[i];
    c1[i] = i; v1[i] = -sg[i] / ds; c2[i] = i + 1; v2[i] = sg[i + 1] / ds;
  }
  for (let i = 0; i < Nw - 1; i++) {
    const ds = M.wake.s[i + 1] - M.wake.s[i], p = N - 1 + i;
    c1[p] = N + i; v1[p] = -1 / ds; c2[p] = N + i + 1; v2[p] = 1 / ds;
  }
  M.vsol.sigma_m = { c1, c2, v1, v2, Np };
  const ue_m = new Float64Array(Nt * Nt), us = M.vsol.ue_sigma;
  for (let r = 0; r < Nt; r++) {
    const sgr = r < N ? sg[r] : 1, ro = r * Nt, so = r * Np;
    for (let p = 0; p < Np; p++) {
      const u = us[so + p]; if (u === 0) continue;
      ue_m[ro + c1[p]] += sgr * u * v1[p];
      ue_m[ro + c2[p]] += sgr * u * v2[p];
    }
  }
  M.vsol.ue_m = ue_m;
}

// source strengths on all panels from the current mass flow
export function get_sigma(M) {
  const { c1, c2, v1, v2, Np } = M.vsol.sigma_m, U = M.glob.U;
  const sig = new Float64Array(Np);
  for (let p = 0; p < Np; p++) {
    sig[p] = v1[p] * U[4 * c1[p] + 3] * U[4 * c1[p] + 1] + v2[p] * U[4 * c2[p] + 3] * U[4 * c2[p] + 1];
  }
  return sig;
}

export function init_thermo(M) {
  const p = M.param, g = p.gam, gmi = g - 1;
  const rhoinf = M.oper.rho, Vinf = M.oper.Vinf;
  p.Vinf = Vinf;
  p.muinf = rhoinf * Vinf * M.geom.chord / M.oper.Re;
  const Minf = M.oper.Ma; p.Minf = Minf;
  let finf = 1;
  if (Minf > 0) {
    p.KTb = Math.sqrt(1 - Minf * Minf);
    p.KTl = Minf * Minf / (1 + p.KTb) ** 2;
    p.H0 = (1 + 0.5 * gmi * Minf * Minf) * Vinf * Vinf / (gmi * Minf * Minf);
    const Tr = 1 - 0.5 * Vinf * Vinf / p.H0;
    finf = Tr ** 1.5 * (1 + p.Tsrat) / (Tr + p.Tsrat);
    p.cps = 2 / (g * Minf * Minf) * (((1 + 0.5 * gmi * Minf * Minf) / (1 + 0.5 * gmi)) ** (g / gmi) - 1);
  } else { p.KTb = 1; p.KTl = 0; p.H0 = 0; p.cps = 0; }
  p.mu0 = p.muinf / finf;
  p.rho0 = rhoinf * (1 + 0.5 * gmi * Minf * Minf) ** (1 / gmi);
}

export function identify_surfaces(M) {
  const N = M.foil.N, Nw = M.wake.N, I = M.isol.Istag;
  const lower = []; for (let k = I[0]; k >= 0; k--) lower.push(k);
  const upper = []; for (let k = I[1]; k < N; k++) upper.push(k);
  const wake = []; for (let k = 0; k < Nw; k++) wake.push(N + k);
  M.vsol.Is = [lower, upper, wake];
}

function set_wake_gap(M) {
  const te = TE_info(M.foil);
  const flen = 2.5;
  const dtdx = Math.min(Math.max(te.dtdx, -3 / flen), 3 / flen);
  const Lw = flen * te.hTE, Nw = M.wake.N, N = M.foil.N;
  const wgap = new Float64Array(Nw);
  for (let i = 0; i < Nw; i++) {
    const xib = (M.isol.xi[N + i] - M.isol.xi[N - 1]) / Lw;
    if (xib <= 1) wgap[i] = te.hTE * (1 + (2 + flen * dtdx) * xib) * (1 - xib) ** 2;
  }
  M.vsol.wgap = wgap;
}

function stagpoint_move(M) {
  const N = M.foil.N, Nsys = M.glob.Nsys;
  let I = M.isol.Istag.slice();
  const ue = new Float64Array(Nsys); for (let j = 0; j < Nsys; j++) ue[j] = M.glob.U[4 * j + 3];
  const sstag0 = M.isol.sstag;
  let newpanel = true;
  if (ue[I[1]] < 0) {
    vprint(M, 2, 'Moving stagnation point up');
    let I2 = -1; for (let j = I[1]; j < Nsys; j++) if (ue[j] > 0) { I2 = j; break; }
    for (let j = I[1]; j < I2; j++) ue[j] = -ue[j];
    I = [I2 - 1, I2];
  } else if (ue[I[0]] < 0) {
    vprint(M, 2, 'Moving stagnation point down');
    let I1 = -1; for (let j = I[0]; j >= 0; j--) if (ue[j] > 0) { I1 = j; break; }
    for (let j = I1 + 1; j <= I[0]; j++) ue[j] = -ue[j];
    I = [I1, I1 + 1];
  } else newpanel = false;
  const u0 = ue[I[0]], u1 = ue[I[1]], S0 = M.foil.s[I[0]], S1 = M.foil.s[I[1]];
  if (!(u0 > 0 && u1 > 0)) throw new Error('stagpoint_move: velocity error');
  const den = u0 + u1, w1 = u1 / den, w2 = u0 / den;
  M.isol.sstag = w1 * S0 + w2 * S1;
  M.isol.xstag = [M.foil.x[I[0]] * w1 + M.foil.x[I[1]] * w2, M.foil.z[I[0]] * w1 + M.foil.z[I[1]] * w2];
  M.isol.sstag_ue = [u1 * (S1 - S0) / (den * den), -u0 * (S1 - S0) / (den * den)];
  vprint(M, 2, `Moving stagnation point: s=${sstag0} -> s=${M.isol.sstag}`);
  set_xi(M);
  if (newpanel) {
    vprint(M, 2, `New stagnation panel = ${I[0]} ${I[1]}`);
    M.isol.Istag = I;
    const sgnue = new Float64Array(N).fill(1); for (let k = 0; k <= I[0]; k++) sgnue[k] = -1;
    M.isol.sgnue = sgnue;
    identify_surfaces(M);
    for (let j = 0; j < Nsys; j++) M.glob.U[4 * j + 3] = ue[j];
    rebuild_ue_m(M);
  }
}

export function solve_viscous(M) {
  const t0 = now();
  solve_inviscid(M);
  M.oper.viscous = true;
  init_thermo(M);
  build_wake(M);
  stagpoint_find(M);
  identify_surfaces(M);
  set_wake_gap(M);
  calc_ue_m(M);
  M.timing = { setup: now() - t0 };
  init_boundary_layer(M);
  stagpoint_move(M);
  solve_coupled(M);
  calc_force(M);
  get_distributions(M);
  M.timing.total = now() - t0;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function solve_coupled(M) {
  const nNewton = M.param.niglob;
  M.glob.conv = false;
  M.glob.history = [];
  vprint(M, 1, '<<< Beginning coupled solver iterations >>>');
  for (let iN = 1; iN <= nNewton; iN++) {
    build_glob_sys(M);
    calc_force(M);
    const Rnorm = norm2(M.glob.R);
    M.glob.history.push(Rnorm);
    vprint(M, 1, `Newton iteration ${iN}, Rnorm = ${Rnorm.toExponential(5)}`);
    if (Rnorm < M.param.rtol) { M.glob.conv = true; break; }
    if (!isFinite(Rnorm)) break;
    solve_glob(M);
    update_state(M);
    stagpoint_move(M);
    update_transition(M);
  }
  if (!M.glob.conv) vprint(M, 1, '** Global Newton NOT CONVERGED **');
}

function update_state(M) {
  const Nsys = M.glob.Nsys, U = M.glob.U, dU = M.glob.dU, turb = M.vsol.turb;
  let ctmax = -Infinity;
  for (let i = 0; i < Nsys; i++) if (turb[i]) ctmax = Math.max(ctmax, U[4 * i + 2]);
  let omega = 1.0;
  for (let k = 0; k < 2; k++) {
    let fmin = Infinity;
    for (let i = 0; i < Nsys; i++) fmin = Math.min(fmin, dU[4 * i + k] / U[4 * i + k]);
    const om = fmin < -0.5 ? Math.abs(0.5 / fmin) : 1;
    if (om < omega) { omega = om; vprint(M, 3, `th/ds decrease: omega = ${omega}`); }
  }
  for (let i = 0; i < Nsys; i++) {
    const Uk = U[4 * i + 2], dUk = dU[4 * i + 2];
    if (!turb[i] && Uk < 0.2) continue;
    if (turb[i] && Uk < 0.1 * ctmax) continue;
    if (Uk === 0 || dUk === 0) continue;
    if (Uk + dUk < 0) {
      const om = 0.8 * Math.abs(Uk / dUk);
      if (om < omega) { omega = om; vprint(M, 3, `neg sa: omega = ${omega}`); }
    }
  }
  let dumax = 0, dumaxT = 0;
  for (let i = 0; i < Nsys; i++) {
    const d = Math.abs(dU[4 * i + 2]);
    if (turb[i]) dumaxT = Math.max(dumaxT, d); else dumax = Math.max(dumax, d);
  }
  let om = dumax > 0 ? Math.abs(2 / dumax) : 1;
  if (om < omega) { omega = om; vprint(M, 3, `amp: omega = ${omega}`); }
  om = dumaxT > 0 ? Math.abs(0.05 / dumaxT) : 1;
  if (om < omega) { omega = om; vprint(M, 3, `ctau: omega = ${omega}`); }
  let fmax = 0;
  for (let i = 0; i < Nsys; i++) fmax = Math.max(fmax, Math.abs(dU[4 * i + 3]) / M.oper.Vinf);
  om = fmax > 0 ? 0.2 / fmax : 1;
  if (om < omega) { omega = om; vprint(M, 3, `ue: omega = ${omega}`); }
  if (Math.abs(M.glob.dalpha) > 2) omega = Math.min(omega, Math.abs(2 / M.glob.dalpha));

  vprint(M, 2, `state update: under-relaxation = ${omega}`);
  for (let k = 0; k < 4 * Nsys; k++) U[k] += omega * dU[k];
  M.oper.alpha += omega * M.glob.dalpha;

  for (let is = 0; is < 3; is++) {
    const Hkmin = is === 2 ? 1.00005 : 1.02;
    let param = build_param(M, is);
    for (const j of M.vsol.Is[is]) {
      param = station_param(M, param, j);
      const Hk = C.get_Hk(Ust(M, j), param)[0];
      if (Hk < Hkmin) U[4 * j + 1] += 2 * (Hkmin - Hk) * U[4 * j];
    }
  }
  for (let i = 0; i < Nsys; i++) if (turb[i] && U[4 * i + 2] < 0) U[4 * i + 2] = 0.1 * ctmax;
  if (Math.abs(omega * M.glob.dalpha) > 1e-10) rebuild_isol(M);
}

function jacobian_add_Rx(M) {
  const Nsys = M.glob.Nsys, N = M.foil.N, nc = 4 * Nsys;
  const x_st = new Float64Array(Nsys);
  for (let k = 0; k < N; k++) x_st[k] = -M.isol.sgnue[k];
  for (let k = N; k < Nsys; k++) x_st[k] = -1;
  const Rx = M.glob.R_x, RU = M.glob.R_U, Ist = M.isol.Istag, st_ue = M.isol.sstag_ue, rn = M.glob.rowNodes;
  for (let r = 0; r < 3 * Nsys; r++) {
    let R_st = 0; const ro = r * Nsys;
    for (let q = 0; q < 4; q++) { const k = rn[4 * r + q]; if (k < 0) break; R_st += Rx[ro + k] * x_st[k]; }
    if (R_st === 0) continue;
    RU[r * nc + 4 * Ist[0] + 3] += R_st * st_ue[0];
    RU[r * nc + 4 * Ist[1] + 3] += R_st * st_ue[1];
  }
}

// Solves the global Newton system for dU (and dalpha in cl-constrained mode).
// The ue equations are folded in exactly by switching from delta* to mass m = ue*delta*
// as the unknown, which leaves a system that is sparse except for the m columns.
export function solve_glob(M) {
  const Nsys = M.glob.Nsys, N = M.foil.N, docl = M.oper.givencl ? 1 : 0, U = M.glob.U;
  const ue = new Float64Array(Nsys), ds = new Float64Array(Nsys);
  let uemax = 0; for (let j = 0; j < Nsys; j++) uemax = Math.max(uemax, Math.abs(U[4 * j + 3]));
  for (let j = 0; j < Nsys; j++) { ue[j] = Math.max(U[4 * j + 3], 1e-10 * uemax); ds[j] = U[4 * j + 1]; }
  const ueinv = get_ueinv(M);
  jacobian_add_Rx(M);
  const ue_m = M.vsol.ue_m;
  // ue residual
  const Rue = new Float64Array(Nsys);
  for (let i = 0; i < Nsys; i++) {
    let s = 0; const ro = i * Nsys;
    for (let k = 0; k < Nsys; k++) s += ue_m[ro + k] * ds[k] * ue[k];
    Rue[i] = ue[i] - (ueinv[i] + s);
  }
  let Rcla = 0, Ru_alpha = null, cl_ue = null, cl_alpha = 0;
  if (docl) {
    Rcla = M.post.cl - M.oper.cltgt;
    cl_ue = M.post.cl_ue; cl_alpha = M.post.cl_alpha;
    const ref = get_ueinvref(M), a = M.oper.alpha, s0 = -sind(a), s1 = cosd(a);
    Ru_alpha = new Float64Array(Nsys);
    for (let i = 0; i < Nsys; i++) Ru_alpha[i] = -(ref[2 * i] * s0 + ref[2 * i + 1] * s1) * PI / 180;
  }
  if (M.param.denseSolve) return solve_glob_dense(M, ue, ds, Rue, docl, Rcla, Ru_alpha, cl_ue, cl_alpha);

  // ---- reduced system in (th, sa, m) ----
  const pos = new Int32Array(Nsys); let p = 0;
  for (const Is of M.vsol.Is) for (const j of Is) pos[j] = p++;
  const nm = 2 * Nsys, n = 3 * Nsys + docl, ac = 3 * Nsys;
  // ue_m with columns permuted to elimination order
  const uemP = new Float64Array(Nsys * Nsys);
  for (let q = 0; q < Nsys; q++) {
    const ro = q * Nsys;
    for (let k = 0; k < Nsys; k++) uemP[ro + pos[k]] = ue_m[ro + k];
  }
  if (!M.glob.Abuf || M.glob.Abuf.length !== n * n) M.glob.Abuf = new Float64Array(n * n); else M.glob.Abuf.fill(0);
  const A = M.glob.Abuf, b = new Float64Array(n);
  const RU = M.glob.R_U, nc = 4 * Nsys, R = M.glob.R, rn = M.glob.rowNodes, Ist = M.isol.Istag;
  const bq = new Float64Array(Nsys), touched = [], cols = [];
  for (let r = 0; r < 3 * Nsys; r++) {
    const node = (r / 3) | 0, eq = r % 3, rr = 3 * pos[node] + eq, ar = rr * n, ro = r * nc;
    touched.length = 0;
    // nodes this row depends on: its stencil plus the stagnation nodes (from R_x)
    cols.length = 0;
    for (let q = 0; q < 4; q++) { const k = rn[4 * r + q]; if (k < 0) break; cols.push(k); }
    if (!cols.includes(Ist[0])) cols.push(Ist[0]);
    if (!cols.includes(Ist[1])) cols.push(Ist[1]);
    for (let ci = 0; ci < 4 * cols.length; ci++) {
      const c = 4 * cols[ci >> 2] + (ci & 3);
      const v = RU[ro + c]; if (v === 0) continue;
      const q = c >> 2, k = c & 3;
      if (k === 0) A[ar + 2 * pos[q]] += v;
      else if (k === 2) A[ar + 2 * pos[q] + 1] += v;
      else {
        if (bq[q] === 0) touched.push(q);
        if (k === 1) { A[ar + nm + pos[q]] += v / ue[q]; bq[q] -= v * ds[q] / ue[q]; }
        else bq[q] += v;
      }
    }
    let rhs = -R[r];
    for (const q of touched) {
      const bv = bq[q]; bq[q] = 0;
      if (bv === 0) continue;
      const uo = q * Nsys;
      for (let k = 0; k < Nsys; k++) A[ar + nm + k] += bv * uemP[uo + k];
      rhs += bv * Rue[q];
      if (docl) A[ar + ac] -= bv * Ru_alpha[q];
    }
    b[rr] = rhs;
  }
  if (docl) {
    const ar = (n - 1) * n;
    let rhs = -Rcla, acoef = cl_alpha;
    for (let q = 0; q < N; q++) {
      const c = cl_ue[q]; if (c === 0) continue;
      const uo = q * Nsys;
      for (let k = 0; k < Nsys; k++) A[ar + nm + k] += c * uemP[uo + k];
      rhs += c * Rue[q]; acoef -= c * Ru_alpha[q];
    }
    A[ar + ac] = acoef; b[n - 1] = rhs;
  }
  if (M.param.debugCapture) M.glob.debugA = { A: A.slice(), b: b.slice(), n, nm };
  const x = gaussSolveInPlace(A, b, n, 0.1);
  // unpack
  const dm = new Float64Array(Nsys);
  for (let j = 0; j < Nsys; j++) dm[j] = x[nm + pos[j]];
  const dalpha = docl ? x[ac] : 0;
  const dU = new Float64Array(4 * Nsys);
  for (let i = 0; i < Nsys; i++) {
    let s = -Rue[i] - (docl ? Ru_alpha[i] * dalpha : 0); const ro = i * Nsys;
    for (let k = 0; k < Nsys; k++) s += ue_m[ro + k] * dm[k];
    dU[4 * i + 3] = s;
  }
  for (let j = 0; j < Nsys; j++) {
    dU[4 * j] = x[2 * pos[j]];
    dU[4 * j + 2] = x[2 * pos[j] + 1];
    dU[4 * j + 1] = (dm[j] - ds[j] * dU[4 * j + 3]) / ue[j];
  }
  M.glob.dU = dU;
  if (docl) M.glob.dalpha = dalpha;
}

// Plain dense version of the global solve (same equations as mfoil.m), for validation.
function solve_glob_dense(M, ue, ds, Rue, docl, Rcla, Ru_alpha, cl_ue, cl_alpha) {
  const Nsys = M.glob.Nsys, N = M.foil.N, n = 4 * Nsys + docl, nc = 4 * Nsys;
  const A = new Float64Array(n * n), b = new Float64Array(n);
  const RU = M.glob.R_U, ue_m = M.vsol.ue_m;
  for (let r = 0; r < 3 * Nsys; r++) { A.set(RU.subarray(r * nc, r * nc + nc), r * n); b[r] = -M.glob.R[r]; }
  for (let i = 0; i < Nsys; i++) {
    const r = 3 * Nsys + i, ar = r * n;
    for (let k = 0; k < Nsys; k++) {
      A[ar + 4 * k + 3] = (i === k ? 1 : 0) - ue_m[i * Nsys + k] * ds[k];
      A[ar + 4 * k + 1] = -ue_m[i * Nsys + k] * ue[k];
    }
    if (docl) A[ar + nc] = Ru_alpha[i];
    b[r] = -Rue[i];
  }
  if (docl) {
    const ar = nc * n;
    for (let k = 0; k < N; k++) A[ar + 4 * k + 3] = cl_ue[k];
    A[ar + nc] = cl_alpha; b[nc] = -Rcla;
  }
  const x = gaussSolveInPlace(A, b, n);
  M.glob.dU = x.slice(0, nc);
  if (docl) M.glob.dalpha = x[nc];
}

// ---- global residual system ----
function build_glob_sys(M) {
  const Nsys = M.glob.Nsys, nc = 4 * Nsys;
  if (!M.glob.R_U || M.glob.R_U.length !== 3 * Nsys * nc) {
    M.glob.R_U = new Float64Array(3 * Nsys * nc);
    M.glob.R_x = new Float64Array(3 * Nsys * Nsys);
  } else { M.glob.R_U.fill(0); M.glob.R_x.fill(0); }
  M.glob.R = new Float64Array(3 * Nsys);
  // rowNodes: which nodes each residual row depends on (max 4), so solvers can skip zeros
  const rowNodes = new Int32Array(3 * Nsys * 4).fill(-1);
  M.glob.rowNodes = rowNodes;
  const R = M.glob.R, RU = M.glob.R_U, RX = M.glob.R_x;
  const markNode = (row, node) => {
    const o = row * 4;
    for (let k = 0; k < 4; k++) { if (rowNodes[o + k] === node) return; if (rowNodes[o + k] < 0) { rowNodes[o + k] = node; return; } }
  };
  const addRU = (row, node, vals, off) => { markNode(row, node); const o = row * nc + 4 * node; for (let k = 0; k < 4; k++) RU[o + k] += vals[off + k]; };

  for (let is = 0; is < 3; is++) {
    const Is = M.vsol.Is[is], Ns = Is.length;
    const xi = Is.map(j => M.isol.xi[j]);
    const Us = Is.map(j => Ust(M, j));
    const Aux = is === 2 ? Array.from(M.vsol.wgap) : new Array(Ns).fill(0);
    const xg = is < 2 ? Is.map(j => M.foil.x[j]) : null;
    const xft = M.oper.xft[is] * M.geom.chord;
    let param = build_param(M, is);
    const i0 = (is < 2 && xi[0] < 1e-8 * xi[Ns - 1]) ? 1 : 0;
    let R1, R1_U, R1_x, J;
    if (is < 2) {
      const st = stagnation_state(Us[i0], Us[i0 + 1], xi[i0], xi[i0 + 1]);
      param.turb = false; param.simi = true;
      const rs = residual_station(param, [st.xst, st.xst], st.Ust, st.Ust, [Aux[i0], Aux[i0]]);
      param.simi = false;
      // R1_Ust = R1_Ut(:,1:4) + R1_Ut(:,5:8)
      const R1_Ust = rs.R_U.map(row => [row[0] + row[4], row[1] + row[5], row[2] + row[6], row[3] + row[7]]);
      R1 = rs.R;
      R1_U = R1_Ust.map(row => { const o = new Array(8).fill(0); for (let c = 0; c < 8; c++) for (let k = 0; k < 4; k++) o[c] += row[k] * st.Ust_U[k][c]; return o; });
      R1_x = R1_Ust.map(row => { const o = [0, 0]; for (let c = 0; c < 2; c++) for (let k = 0; k < 4; k++) o[c] += row[k] * st.Ust_x[k][c]; return o; });
      J = [Is[i0], Is[i0 + 1]];
      if (i0 === 1) {
        vprint(M, 2, 'hit stagnation!');
        const g = Is[0];
        for (let k = 0; k < 3; k++) {
          const row = 3 * g + k;
          R[row] = Us[0][k] - st.Ust[k];
          markNode(row, g); markNode(row, J[0]); markNode(row, J[1]);
          RU[row * nc + 4 * g + k] += 1;
          for (let c = 0; c < 8; c++) RU[row * nc + 4 * J[c >> 2] + (c & 3)] -= st.Ust_U[k][c];
          RX[row * Nsys + J[0]] = -st.Ust_x[k][0];
          RX[row * Nsys + J[1]] = -st.Ust_x[k][1];
        }
      }
    } else {
      const ws = wake_sys(M, param);
      R1 = ws.R; R1_U = ws.R_U; J = ws.J; R1_x = null;
      param.turb = true; param.wake = true;
    }
    // store first point system
    {
      const g = Is[i0];
      for (let k = 0; k < 3; k++) {
        const row = 3 * g + k;
        R[row] = R1[k];
        for (let jj = 0; jj < J.length; jj++) {
          addRU(row, J[jj], R1_U[k], 4 * jj);
          if (R1_x) RX[row * Nsys + J[jj]] += R1_x[k][jj];
        }
      }
    }
    // march over the rest of the points
    let tran = false;
    for (let i = i0 + 1; i < Ns; i++) {
      M.oper.forcet[is] = false;
      if (!tran && !param.turb && is < 2 && (xg[i - 1] - xft) * (xg[i] - xft) < 0) {
        tran = true;
        M.oper.xift[is] = xi[i - 1] + (xi[i] - xi[i - 1]) * (xft - xg[i - 1]) / (xg[i] - xg[i - 1]);
        M.oper.forcet[is] = true;
      }
      tran = !!(M.vsol.turb[Is[i - 1]] ^ M.vsol.turb[Is[i]]);
      let res;
      if (tran) {
        param.is = is;
        res = residual_transition(M, param, [xi[i - 1], xi[i]], Us[i - 1], Us[i], [Aux[i - 1], Aux[i]]);
        store_transition(M, is, i);
      } else {
        res = residual_station(param, [xi[i - 1], xi[i]], Us[i - 1], Us[i], [Aux[i - 1], Aux[i]]);
      }
      const g = Is[i];
      for (let k = 0; k < 3; k++) {
        const row = 3 * g + k;
        R[row] += res.R[k];
        addRU(row, Is[i - 1], res.R_U[k], 0);
        addRU(row, Is[i], res.R_U[k], 4);
        RX[row * Nsys + Is[i - 1]] += res.R_x[k][0];
        RX[row * Nsys + Is[i]] += res.R_x[k][1];
      }
      if (tran) param.turb = true;
    }
  }
}

function stagnation_state(U1, U2, x1, x2) {
  const dx = x2 - x1, dx_x = [-1, 1];
  const rx = x2 / x1, rx_x = [-rx / x1, 1 / x1];
  const w1 = x2 / dx, w1_x = [-w1 / dx * dx_x[0] + 0, -w1 / dx * dx_x[1] + 1 / dx];
  const w2 = -x1 / dx, w2_x = [-w2 / dx * dx_x[0] - 1 / dx, -w2 / dx * dx_x[1]];
  const Ust = [0, 1, 2, 3].map(k => U1[k] * w1 + U2[k] * w2);
  const wk1 = rx / dx, wk1_x = [rx_x[0] / dx - wk1 / dx * dx_x[0], rx_x[1] / dx - wk1 / dx * dx_x[1]];
  const wk2 = -1 / (rx * dx), wk2_x = [-wk2 * (rx_x[0] / rx + dx_x[0] / dx), -wk2 * (rx_x[1] / rx + dx_x[1] / dx)];
  const K = wk1 * U1[3] + wk2 * U2[3];
  const K_U = [0, 0, 0, wk1, 0, 0, 0, wk2];
  const K_x = [U1[3] * wk1_x[0] + U2[3] * wk2_x[0], U1[3] * wk1_x[1] + U2[3] * wk2_x[1]];
  const xst = 1e-6;
  Ust[3] = K * xst;
  const Ust_U = [];
  for (let k = 0; k < 3; k++) { const r = new Array(8).fill(0); r[k] = w1; r[4 + k] = w2; Ust_U.push(r); }
  Ust_U.push(K_U.map(v => v * xst));
  const Ust_x = [];
  for (let k = 0; k < 3; k++) Ust_x.push([U1[k] * w1_x[0] + U2[k] * w2_x[0], U1[k] * w1_x[1] + U2[k] * w2_x[1]]);
  Ust_x.push([K_x[0] * xst, K_x[1] * xst]);
  return { Ust, Ust_U, Ust_x, xst };
}

function thwaites_init(K, nu) {
  const th = Math.sqrt(0.45 * nu / (6 * K));
  return [th, 2.2 * th];
}

function wake_sys(M, param0) {
  const Is = M.vsol.Is;
  const il = Is[0][Is[0].length - 1], iu = Is[1][Is[1].length - 1], iw = Is[2][0];
  const Ul = Ust(M, il), Uu = Ust(M, iu), Uw = Ust(M, iw);
  const hTE = TE_info(M.foil).hTE;
  const param = { ...param0, turb: true, wake: false };
  let ctl, ctl_Ul, ctu, ctu_Uu;
  if (M.vsol.turb[il]) { ctl = Ul[2]; ctl_Ul = [0, 0, 1, 0]; } else [ctl, ctl_Ul] = C.get_cttr(Ul, param);
  if (M.vsol.turb[iu]) { ctu = Uu[2]; ctu_Uu = [0, 0, 1, 0]; } else [ctu, ctu_Uu] = C.get_cttr(Uu, param);
  const thsum = Ul[0] + Uu[0];
  const ctw = (ctl * Ul[0] + ctu * Uu[0]) / thsum;
  const ctw_Ul = lc(Ul[0] / thsum, ctl_Ul, (ctl - ctw) / thsum, [1, 0, 0, 0]);
  const ctw_Uu = lc(Uu[0] / thsum, ctu_Uu, (ctu - ctw) / thsum, [1, 0, 0, 0]);
  const R = [Uw[0] - (Ul[0] + Uu[0]), Uw[1] - (Ul[1] + Uu[1] + hTE), Uw[2] - ctw];
  const R_U = [
    [-1, 0, 0, 0, -1, 0, 0, 0, 1, 0, 0, 0],
    [0, -1, 0, 0, 0, -1, 0, 0, 0, 1, 0, 0],
    [...ctw_Ul.map(v => -v), ...ctw_Uu.map(v => -v), 0, 0, 1, 0],
  ];
  return { R, R_U, J: [il, iu, iw] };
}

function wake_init(M, ue) {
  const iw = M.vsol.Is[2][0], Uw = Ust(M, iw);
  const { R } = wake_sys(M, M.param);
  return [Uw[0] - R[0], Uw[1] - R[1], Uw[2] - R[2], ue];
}

function build_param(M, is) {
  const p = { ...M.param };
  p.wake = is === 2; p.turb = p.wake; p.simi = false;
  return p;
}

function station_param(M, param, i) {
  param.turb = !!M.vsol.turb[i];
  param.simi = M.isol.Istag[0] === i || M.isol.Istag[1] === i;
  return param;
}

function init_boundary_layer(M) {
  const Hmaxl = 3.8, Hmaxt = 2.5;
  const ueinv = get_ueinv(M);
  M.glob.Nsys = M.foil.N + M.wake.N;
  const Nsys = M.glob.Nsys;
  if (!M.oper.initbl && M.glob.U && M.glob.U.length === 4 * Nsys && M.vsol.turb && M.vsol.turb.length === Nsys) {
    vprint(M, 1, '<<< Starting with current boundary layer >>>');
    for (let j = 0; j < Nsys; j++) M.glob.U[4 * j + 3] = ueinv[j];
    return;
  }
  vprint(M, 1, '<<< Initializing the boundary layer >>>');
  M.glob.U = new Float64Array(4 * Nsys);
  M.vsol.turb = new Uint8Array(Nsys);

  for (let is = 0; is < 3; is++) {
    const Is = M.vsol.Is[is], N = Is.length;
    const xi = Is.map(j => M.isol.xi[j]);
    const xg = is < 2 ? Is.map(j => M.foil.x[j]) : null;
    let ue = Is.map(j => ueinv[j]);
    const U = []; for (let i = 0; i < N; i++) U.push([0, 0, 0, 0]);
    const Aux = is === 2 ? Array.from(M.vsol.wgap) : new Array(N).fill(0);
    const xft = M.oper.xft[is] * M.geom.chord;
    let uemax = 0; for (const v of ue) uemax = Math.max(uemax, Math.abs(v));
    ue = ue.map(v => Math.max(v, 1e-8 * uemax));
    let param = build_param(M, is);
    let i0 = 0;
    if (is < 2) {
      let K, hitstag;
      if (xi[0] < 1e-8 * xi[N - 1]) { K = ue[1] / xi[1]; hitstag = true; }
      else { K = ue[0] / xi[0]; hitstag = false; }
      const [th, ds] = thwaites_init(K, param.mu0 / param.rho0);
      const xst = 1e-6;
      let Us = [th, ds, 0, K * xst];
      for (let iN = 1; iN <= 20; iN++) {
        param.turb = false; param.simi = true;
        const rs = residual_station(param, [xst, xst], Us, Us, [0, 0]);
        param.simi = false;
        if (norm2(rs.R) < 1e-10) break;
        const A = rs.R_U.map(row => [row[0] + row[4], row[1] + row[5], row[2] + row[6]]);
        const d = solveSmall(A, rs.R.map(v => -v));
        const dU = [d[0], d[1], d[2], 0];
        const dm = Math.max(Math.abs(dU[0] / Us[0]), Math.abs(dU[1] / Us[1]));
        const omega = dm > 0.2 ? 0.2 / dm : 1;
        Us = Us.map((v, k) => v + omega * dU[k]);
      }
      if (hitstag) { U[0] = Us.slice(); U[0][3] = ue[0]; i0 = 1; }
      U[i0] = Us.slice(); U[i0][3] = ue[i0];
    } else {
      U[0] = wake_init(M, ue[0]);
      param.turb = true;
      M.vsol.turb[Is[0]] = 1;
    }

    let tran = false, i = i0 + 1, Hktgt = 0, ct = 0;
    while (i < N) {
      M.oper.forcet[is] = false;
      if (!tran && !param.turb && is < 2 && (xg[i - 1] - xft) * (xg[i] - xft) < 0) {
        tran = true;
        M.oper.xift[is] = xi[i - 1] + (xi[i] - xi[i - 1]) * (xft - xg[i - 1]) / (xg[i] - xg[i - 1]);
        M.oper.forcet[is] = true;
        vprint(M, 1, `forced transition during marching: xft=${xft.toFixed(5)}, xift=${M.oper.xift[is].toFixed(5)}`);
      }
      U[i] = U[i - 1].slice(); U[i][3] = ue[i];
      if (tran) { ct = C.get_cttr(U[i], param)[0]; U[i][2] = ct; }
      M.vsol.turb[Is[i]] = (tran || param.turb) ? 1 : 0;
      let direct = true;
      const nNewton = 30, iNswitch = 12;
      let iN;
      for (iN = 1; iN <= nNewton; iN++) {
        let R, R_U;
        if (tran) {
          try {
            param.is = is;
            const rt = residual_transition(M, param, [xi[i - 1], xi[i]], U[i - 1], U[i], [Aux[i - 1], Aux[i]]);
            R = rt.R; R_U = rt.R_U;
          } catch (e) {
            vprint(M, 1, 'Transition calculation failed in BL init. Continuing.');
            M.vsol.xt = 0.5 * (xi[i - 1] + xi[i]);
            U[i] = U[i - 1].slice(); U[i][3] = ue[i]; U[i][2] = ct;
            R = [0, 0, 0];
          }
        } else {
          const rs = residual_station(param, [xi[i - 1], xi[i]], U[i - 1], U[i], [Aux[i - 1], Aux[i]]);
          R = rs.R; R_U = rs.R_U;
        }
        if (norm2(R) < 1e-10) break;
        let dU;
        if (direct) {
          const A = R_U.map(row => [row[4], row[5], row[6]]);
          const d = solveSmall(A, R.map(v => -v)); dU = [d[0], d[1], d[2], 0];
        } else {
          const [Hk, Hk_U] = C.get_Hk(U[i], param);
          const A = [R_U[0].slice(4, 8), R_U[1].slice(4, 8), R_U[2].slice(4, 8), Hk_U];
          dU = solveSmall(A, [-R[0], -R[1], -R[2], Hktgt - Hk]);
        }
        let dm = Math.max(Math.abs(dU[0] / U[i - 1][0]), Math.abs(dU[1] / U[i - 1][1]));
        if (!direct) dm = Math.max(dm, Math.abs(dU[3] / U[i - 1][3]));
        if (param.turb) dm = Math.max(dm, Math.abs(dU[2] / U[i - 1][2]));
        else if (direct) dm = Math.max(dm, Math.abs(dU[2] / 10));
        const omega = dm > 0.3 ? 0.3 / dm : 1;
        const Ui = U[i].map((v, k) => v + omega * dU[k]);
        if (param.turb) Ui[2] = Math.max(Math.min(Ui[2], 0.3), 1e-7);
        const Hmax = param.turb ? Hmaxt : Hmaxl;
        const HkUi = C.get_Hk(Ui, param)[0];
        if (direct && (HkUi > Hmax || iN > iNswitch)) {
          direct = false;
          vprint(M, 2, `** switching to inverse: i=${i}, iNewton=${iN}`);
          const Hk = C.get_Hk(U[i - 1], param)[0], Hkr = (xi[i] - xi[i - 1]) / U[i - 1][0];
          if (param.wake) {
            let H2 = Hk;
            for (let k = 0; k < 6; k++) H2 = H2 - (H2 + 0.03 * Hkr * (H2 - 1) ** 3 - Hk) / (1 + 0.09 * Hkr * (H2 - 1) ** 2);
            Hktgt = Math.max(H2, 1.01);
          } else if (param.turb) Hktgt = Hk - 0.15 * Hkr;
          else Hktgt = Hk + 0.03 * Hkr;
          if (!param.wake) Hktgt = Math.max(Hktgt, Hmax);
          if (iN > iNswitch) { U[i] = U[i - 1].slice(); U[i][3] = ue[i]; }
        } else U[i] = Ui;
      }
      if (iN > nNewton) iN = nNewton;
      if (iN >= nNewton) {
        vprint(M, 1, `** BL init not converged: is=${is}, i=${i} **`);
        U[i] = U[i - 1].slice(); U[i][3] = ue[i];
        if (is < 2) {
          U[i][0] = U[i - 1][0] * (xi[i] / xi[i - 1]) ** 0.5;
          U[i][1] = U[i - 1][1] * (xi[i] / xi[i - 1]) ** 0.5;
        } else {
          const rlen = (xi[i] - xi[i - 1]) / (10 * U[i - 1][1]);
          U[i][1] = (U[i - 1][1] + U[i - 1][0] * rlen) / (1 + rlen);
        }
      }
      if (!param.turb && !tran && U[i][2] > param.ncrit) {
        vprint(M, 2, `Identified transition at (is=${is}, i=${i}): n=${U[i][2].toFixed(5)}, ncrit=${param.ncrit}`);
        tran = true;
        continue;
      }
      if (tran) {
        store_transition(M, is, i);
        param.turb = true; tran = false;
      }
      i++;
    }
    for (let k = 0; k < N; k++) M.glob.U.set(U[k], 4 * Is[k]);
  }
}

function store_transition(M, is, i) {
  const forcet = M.oper.forcet[is], xft = M.oper.xft[is] * M.geom.chord;
  const i0 = M.vsol.Is[is][i - 1], i1 = M.vsol.Is[is][i];
  if (!(i0 < M.foil.N && i1 < M.foil.N)) throw new Error('Can only store transition on airfoil');
  const xi0 = M.isol.xi[i0], xi1 = M.isol.xi[i1], x0 = M.foil.x[i0], x1 = M.foil.x[i1];
  const xift = xi0 + (xi1 - xi0) * (xft - x0) / (x1 - x0);
  let xt, spre;
  if (!forcet || (M.vsol.xt > 0 && M.vsol.xt < xift)) { xt = M.vsol.xt; spre = 'free'; }
  else { xt = xift; M.oper.xift[is] = xt; spre = 'forced'; }
  if (xt < xi0 || xt > xi1) vprint(M, 1, `Warning: transition (${xt.toFixed(3)}) off interval (${xi0.toFixed(3)},${xi1.toFixed(3)})!`);
  M.vsol.Xt[is] = [xt, x0 + (xt - xi0) / (xi1 - xi0) * (x1 - x0)];
  M.vsol.Xtype = M.vsol.Xtype || ['free', 'free'];
  M.vsol.Xtype[is] = spre;
  vprint(M, 1, `${spre} transition on ${['lower', 'upper'][is]} side at x=${M.vsol.Xt[is][1].toFixed(5)}`);
}

function update_transition(M) {
  for (let is = 0; is < 2; is++) {
    const Is = M.vsol.Is[is], N = Is.length, xft = M.oper.xft[is] * M.geom.chord;
    let param = build_param(M, is);
    let ilam0 = -1; for (let k = 0; k < N; k++) if (!M.vsol.turb[Is[k]]) ilam0 = k;
    const sa = Is.map(j => M.glob.U[4 * j + 2]);
    const ilam = march_amplification(M, is);
    if (M.oper.forcet[is]) {
      const i0 = Is[ilam], i1 = Is[ilam + 1];
      M.oper.xift[is] = M.isol.xi[i0] + (M.isol.xi[i1] - M.isol.xi[i0]) * (xft - M.foil.x[i0]) / (M.foil.x[i1] - M.foil.x[i0]);
    }
    if (ilam === ilam0) { for (let k = 0; k < N; k++) M.glob.U[4 * Is[k] + 2] = sa[k]; continue; }
    vprint(M, 2, `Update transition: last lam [${ilam0}]->[${ilam}]`);
    if (ilam < ilam0) {
      param.turb = true;
      const sa0 = C.get_cttr(Ust(M, Is[ilam + 1]), param)[0];
      let sa1 = sa0; if (ilam0 < N - 1) sa1 = M.glob.U[4 * Is[ilam0 + 1] + 2];
      const xi = Is.map(j => M.isol.xi[j]);
      const dx = xi[Math.min(ilam0 + 1, N - 1)] - xi[ilam + 1];
      for (let i = ilam + 1; i <= ilam0; i++) {
        let f = (dx === 0 || i === ilam + 1) ? 0 : (xi[i] - xi[ilam + 1]) / dx;
        if (ilam + 1 === ilam0) f = 1;
        M.glob.U[4 * Is[i] + 2] = sa0 + f * (sa1 - sa0);
        if (!(M.glob.U[4 * Is[i] + 2] > 0)) throw new Error('negative ctau in update_transition');
        M.vsol.turb[Is[i]] = 1;
      }
    } else {
      for (let i = ilam0; i <= ilam; i++) M.vsol.turb[Is[i]] = 0;
    }
  }
}

function march_amplification(M, is) {
  const Is = M.vsol.Is[is], N = Is.length;
  const param = build_param(M, is);
  const U = Is.map(j => Ust(M, j));
  const turb = Is.map(j => M.vsol.turb[j]);
  const xft = M.oper.xft[is] * M.geom.chord;
  U[0][2] = 0;
  param.turb = false; param.wake = false;
  let i = 1;
  while (i < N) {
    const U1 = U[i - 1], U2 = U[i].slice();
    if (turb[i]) U2[2] = U1[2] * 1.01;
    const dx = M.isol.xi[Is[i]] - M.isol.xi[Is[i - 1]];
    const nNewton = 20;
    let iN;
    for (iN = 1; iN <= nNewton; iN++) {
      const [d1, d1_U] = C.get_damp(U1, param);
      const [d2, d2_U] = C.get_damp(U2, param);
      const [damp, damp_U] = C.upwind(0.5, null, d1, d1_U, d2, d2_U);
      const Ramp = U2[2] - U1[2] - damp * dx;
      if (iN > 12) vprint(M, 3, `i=${i}, iNewton=${iN}, Ramp=${Ramp}`);
      if (Math.abs(Ramp) < 1e-12) break;
      const Ramp_U7 = 1 - damp_U[6] * dx;
      const dU = -Ramp / Ramp_U7;
      const dmax = 0.5 * (1.01 - iN / nNewton);
      const omega = Math.abs(dU) > dmax ? dmax / Math.abs(dU) : 1;
      U2[2] += omega * dU;
    }
    if (iN > nNewton) iN = nNewton;
    if (iN >= nNewton) vprint(M, 1, 'march amp Newton unconverged!');
    M.oper.forcet[is] = false;
    if ((M.foil.x[Is[i - 1]] - xft) * (M.foil.x[Is[i]] - xft) < 0) {
      M.oper.forcet[is] = true;
      vprint(M, 2, `forced transition (is,i=${is},${i})`);
      break;
    } else if (U2[2] > param.ncrit) {
      vprint(M, 2, `march_amplification (is,i=${is},${i}): ${U2[2]} is above critical.`);
      break;
    } else {
      M.glob.U[4 * Is[i] + 2] = U2[2];
      U[i][2] = U2[2];
    }
    i++;
  }
  return i - 1;
}

// ---- small dense matrix helpers (arrays of rows) ----
const mm = (A, B) => A.map(r => B[0].map((_, j) => { let s = 0; for (let k = 0; k < r.length; k++) s += r[k] * B[k][j]; return s; }));
const mv = (A, v) => A.map(r => dot(r, v));
const outer = (u, v) => u.map(a => v.map(b => a * b));
const madd = (...Ms) => Ms[0].map((r, i) => r.map((_, j) => Ms.reduce((s, X) => s + X[i][j], 0)));
const eye4 = c => [0, 1, 2, 3].map(i => [0, 1, 2, 3].map(j => (i === j ? c : 0)));
const col = (A, j) => A.map(r => r[j]);

function residual_transition(M, param, x, U1, U2, Aux) {
  const sa = [U1[2], U2[2]];
  const is = param.is, forcet = M.oper.forcet[is], xift = M.oper.xift[is];
  const x1 = x[0], x2 = x[1], dx = x2 - x1;
  let xt, w1, w2, Ut, Ut_xt, Ut_x1, Ut_x2, xt_U1, xt_U2, xt_x1, xt_x2, ncrit;
  if (!forcet) {
    xt = x1 + 0.5 * dx;
    ncrit = param.ncrit;
    const nNewton = 20;
    let iN, damp1, damp1_U1, dampt, dampt_Ut, Rxt_xt;
    vprint(M, 3, `Transition interval = [${x1}, ${x2}]`);
    for (iN = 1; iN <= nNewton; iN++) {
      w2 = (xt - x1) / dx; w1 = 1 - w2;
      Ut = lc(w1, U1, w2, U2); Ut_xt = lc(1 / dx, U2, -1 / dx, U1);
      Ut[2] = ncrit; Ut_xt[2] = 0;
      [damp1, damp1_U1] = C.get_damp(U1, param);
      [dampt, dampt_Ut] = C.get_damp(Ut, param); dampt_Ut[2] = 0;
      const Rxt = ncrit - sa[0] - 0.5 * (xt - x1) * (damp1 + dampt);
      Rxt_xt = -0.5 * (damp1 + dampt) - 0.5 * (xt - x1) * dot(dampt_Ut, Ut_xt);
      let dxt = -Rxt / Rxt_xt;
      const dmax = 0.2 * dx * (1.1 - iN / nNewton);
      if (Math.abs(dxt) > dmax) dxt = dxt * dmax / Math.abs(dxt);
      if (Math.abs(Rxt) < 1e-10) break;
      if (iN < nNewton) xt += dxt;
    }
    if (iN > nNewton) vprint(M, 1, 'Transition location calculation failed.');
    const Rxt_U = cat(lc(1, damp1_U1, w1, dampt_Ut), sc(dampt_Ut, w2)).map(v => -0.5 * (xt - x1) * v);
    Rxt_U[2] -= 1;
    Ut_x1 = sc(lc(1, U2, -1, U1), (w2 - 1) / dx); Ut_x2 = sc(lc(1, U2, -1, U1), -w2 / dx);
    Ut_x1[2] = 0; Ut_x2[2] = 0;
    const Rxt_x1 = 0.5 * (damp1 + dampt) - 0.5 * (xt - x1) * dot(dampt_Ut, Ut_x1);
    const Rxt_x2 = -0.5 * (xt - x1) * dot(dampt_Ut, Ut_x2);
    const xt_U = Rxt_U.map(v => -v / Rxt_xt);
    xt_U1 = xt_U.slice(0, 4); xt_U2 = xt_U.slice(4, 8);
    xt_x1 = -Rxt_x1 / Rxt_xt; xt_x2 = -Rxt_x2 / Rxt_xt;
  } else {
    xt = xift;
    w2 = (xt - x1) / dx; w1 = 1 - w2;
    Ut = lc(w1, U1, w2, U2); Ut_xt = lc(1 / dx, U2, -1 / dx, U1);
    Ut_x1 = sc(lc(1, U2, -1, U1), (w2 - 1) / dx); Ut_x2 = sc(lc(1, U2, -1, U1), -w2 / dx);
    xt_U1 = z4(); xt_U2 = z4();
    xt_x1 = w1; xt_x2 = w2;
  }
  M.vsol.xt = xt;
  Ut_x1 = lc(1, Ut_x1, xt_x1, Ut_xt);
  Ut_x2 = lc(1, Ut_x2, xt_x2, Ut_xt);
  const dU21 = lc(1, U2, -1, U1);
  const Ut_U1 = madd(eye4(w1), outer(dU21, xt_U1.map(v => v / dx)));
  const Ut_U2 = madd(eye4(w2), outer(dU21, xt_U2.map(v => v / dx)));
  // laminar and turbulent states at transition
  const Utl = Ut.slice(), Utl_U1 = Ut_U1.map(r => r.slice()), Utl_U2 = Ut_U2.map(r => r.slice());
  const Utl_x1 = Ut_x1.slice(), Utl_x2 = Ut_x2.slice();
  if (!forcet) { Utl[2] = ncrit; Utl_U1[2] = z4(); Utl_U2[2] = z4(); Utl_x1[2] = 0; Utl_x2[2] = 0; }
  const Utt = Ut.slice(), Utt_U1 = Ut_U1.map(r => r.slice()), Utt_U2 = Ut_U2.map(r => r.slice());
  const Utt_x1 = Ut_x1.slice(), Utt_x2 = Ut_x2.slice();
  const p2 = build_param(M, 0);
  p2.turb = true;
  const [cttr, cttr_Ut] = C.get_cttr(Ut, p2);
  Utt[2] = cttr;
  Utt_U1[2] = mv(Ut_U1[0].map((_, j) => col(Ut_U1, j)), cttr_Ut);
  Utt_U2[2] = mv(Ut_U2[0].map((_, j) => col(Ut_U2, j)), cttr_Ut);
  Utt_x1[2] = dot(cttr_Ut, Ut_x1); Utt_x2[2] = dot(cttr_Ut, Ut_x2);
  // laminar/turbulent residuals
  p2.turb = false;
  const rl = residual_station(p2, [x1, xt], U1, Utl, Aux);
  const Rl = rl.R.slice();
  const Rl_U1 = rl.R_U.map(r => r.slice(0, 4)), Rl_Utl = rl.R_U.map(r => r.slice(4, 8));
  if (forcet) { Rl[2] = 0; Rl_U1[2] = z4(); Rl_Utl[2] = z4(); }
  p2.turb = true;
  const rt = residual_station(p2, [xt, x2], Utt, U2, Aux);
  const Rt_Utt = rt.R_U.map(r => r.slice(0, 4)), Rt_U2 = rt.R_U.map(r => r.slice(4, 8));
  const R = [0, 1, 2].map(k => Rl[k] + rt.R[k]);
  if (!R.every(isFinite)) throw new Error('bad transition residual');
  const Rlx2 = col(rl.R_x, 1), Rtx1 = col(rt.R_x, 0);
  const R_U1 = madd(Rl_U1, mm(Rl_Utl, Utl_U1), outer(Rlx2, xt_U1), mm(Rt_Utt, Utt_U1), outer(Rtx1, xt_U1));
  const R_U2 = madd(mm(Rl_Utl, Utl_U2), outer(Rlx2, xt_U2), mm(Rt_Utt, Utt_U2), Rt_U2, outer(Rtx1, xt_U2));
  const R_U = R_U1.map((r, k) => r.concat(R_U2[k]));
  const a1 = mv(Rl_Utl, Utl_x1), b1 = mv(Rt_Utt, Utt_x1), a2 = mv(Rl_Utl, Utl_x2), b2 = mv(Rt_Utt, Utt_x2);
  const R_x = [0, 1, 2].map(k => [
    rl.R_x[k][0] + rl.R_x[k][1] * xt_x1 + rt.R_x[k][0] * xt_x1 + a1[k] + b1[k],
    rt.R_x[k][1] + rl.R_x[k][1] * xt_x2 + rt.R_x[k][0] * xt_x2 + a2[k] + b2[k],
  ]);
  return { R, R_U, R_x };
}

// Viscous residual at one non-transition station between states U1 and U2.
// Returns R (3), R_U (3 rows x 8), R_x (3 rows x 2).
export function residual_station(param, x, U1in, U2in, Aux) {
  const U1 = U1in.slice(), U2 = U2in.slice();
  U1[1] -= Aux[0]; U2[1] -= Aux[1];
  const Um = lc(0.5, U1, 0.5, U2);
  const th = [U1[0], U2[0]], ds = [U1[1], U2[1]], sa = [U1[2], U2[2]];
  const [uk1, uk1_u] = C.get_uk(U1[3], param);
  const [uk2, uk2_u] = C.get_uk(U2[3], param);

  let thlog = Math.log(th[1] / th[0]);
  let thlog_U = [-1 / th[0], 0, 0, 0, 1 / th[1], 0, 0, 0];
  let uelog = Math.log(uk2 / uk1);
  let uelog_U = [0, 0, 0, -uk1_u / uk1, 0, 0, 0, uk2_u / uk2];
  let xlog = Math.log(x[1] / x[0]), xlog_x = [-1 / x[0], 1 / x[1]];
  let dx = x[1] - x[0], dx_x = [-1, 1];

  const [upw, upw_U] = C.get_upw(U1, U2, param);

  const [H1, H1_U1] = C.get_H(U1);
  const [H2, H2_U2] = C.get_H(U2);
  const H = 0.5 * (H1 + H2), H_U = sc(cat(H1_U1, H2_U2), 0.5);

  const [Hs1, Hs1_U1] = C.get_Hs(U1, param);
  const [Hs2, Hs2_U2] = C.get_Hs(U2, param);
  const [Hs, Hs_U] = C.upwind(0.5, null, Hs1, Hs1_U1, Hs2, Hs2_U2);

  let Hslog = Math.log(Hs2 / Hs1);
  let Hslog_U = cat(sc(Hs1_U1, -1 / Hs1), sc(Hs2_U2, 1 / Hs2));

  if (param.simi) {
    thlog = 0; thlog_U = sc(thlog_U, 0);
    Hslog = 0; Hslog_U = sc(Hslog_U, 0);
    uelog = 1; uelog_U = sc(uelog_U, 0);
    xlog = 1; xlog_x = [0, 0];
    dx = 0.5 * (x[0] + x[1]); dx_x = [0.5, 0.5];
  }

  const [Hw1, Hw1_U1] = C.get_Hw(U1, Aux[0]);
  const [Hw2, Hw2_U2] = C.get_Hw(U2, Aux[1]);
  const Hw = 0.5 * (Hw1 + Hw2), Hw_U = sc(cat(Hw1_U1, Hw2_U2), 0.5);

  let Rlag, Rlag_U, Rlag_x;
  if (param.turb) {
    const salog = Math.log(sa[1] / sa[0]);
    const salog_U = [0, 0, -1 / sa[0], 0, 0, 0, 1 / sa[1], 0];
    const [de1, de1_U1] = C.get_de(U1, param);
    const [de2, de2_U2] = C.get_de(U2, param);
    const [de, de_U] = C.upwind(0.5, null, de1, de1_U1, de2, de2_U2);
    const [Us1, Us1_U1] = C.get_Us(U1, param);
    const [Us2, Us2_U2] = C.get_Us(U2, param);
    const [Us, Us_U] = C.upwind(0.5, null, Us1, Us1_U1, Us2, Us2_U2);
    const [Hk1, Hk1_U1] = C.get_Hk(U1, param);
    const [Hk2, Hk2_U2] = C.get_Hk(U2, param);
    const [Hk, Hk_U] = C.upwind(upw, upw_U, Hk1, Hk1_U1, Hk2, Hk2_U2);
    const [Ret1, Ret1_U1] = C.get_Ret(U1, param);
    const [Ret2, Ret2_U2] = C.get_Ret(U2, param);
    const [Ret, Ret_U] = C.upwind(0.5, null, Ret1, Ret1_U1, Ret2, Ret2_U2);
    const [cf1, cf1_U1] = C.get_cf(U1, param);
    const [cf2, cf2_U2] = C.get_cf(U2, param);
    const [cf, cf_U] = C.upwind(upw, upw_U, cf1, cf1_U1, cf2, cf2_U2);
    const dsa = 0.5 * (ds[0] + ds[1]), dsa_U = [0, 0.5, 0, 0, 0, 0.5, 0, 0];
    const [uq, uq_U] = C.get_uq(dsa, dsa_U, cf, cf_U, Hk, Hk_U, Ret, Ret_U, param);
    const [cteq1, cteq1_U1] = C.get_cteq(U1, param);
    const [cteq2, cteq2_U2] = C.get_cteq(U2, param);
    const [cteq, cteq_U] = C.upwind(upw, upw_U, cteq1, cteq1_U1, cteq2, cteq2_U2);
    const [saa, saa_U] = C.upwind(upw, upw_U, sa[0], [0, 0, 1, 0], sa[1], [0, 0, 1, 0]);
    const Klag = param.SlagK, beta = param.GB;
    const Clag = Klag / beta * 1 / (1 + Us), Clag_U = sc(Us_U, -Clag / (1 + Us));
    const ald = param.wake ? param.Dlr : 1.0;
    const Cuq = param.Cuq;
    Rlag = Clag * (cteq - ald * saa) * dx - 2 * de * salog + 2 * de * (uq * dx - uelog) * Cuq;
    Rlag_U = lc((cteq - ald * saa) * dx, Clag_U, Clag * dx, cteq_U, -Clag * dx * ald, saa_U,
      -2 * salog, de_U, -2 * de, salog_U,
      2 * (uq * dx - uelog) * Cuq, de_U, 2 * de * dx * Cuq, uq_U, -2 * de * Cuq, uelog_U);
    Rlag_x = [0, 1].map(k => Clag * (cteq - ald * saa) * dx_x[k] + 2 * de * uq * dx_x[k]);
  } else if (param.simi) {
    Rlag = sa[0] + sa[1]; Rlag_U = [0, 0, 1, 0, 0, 0, 1, 0]; Rlag_x = [0, 0];
  } else {
    const [damp1, damp1_U1] = C.get_damp(U1, param);
    const [damp2, damp2_U2] = C.get_damp(U2, param);
    const [damp, damp_U] = C.upwind(0.5, null, damp1, damp1_U1, damp2, damp2_U2);
    Rlag = sa[1] - sa[0] - damp * dx;
    Rlag_U = lc(1, [0, 0, -1, 0, 0, 0, 1, 0], -dx, damp_U);
    Rlag_x = [-damp * dx_x[0], -damp * dx_x[1]];
  }

  const [Ms1, Ms1_U1] = C.get_Mach2(U1, param);
  const [Ms2, Ms2_U2] = C.get_Mach2(U2, param);
  const [Ms, Ms_U] = C.upwind(0.5, null, Ms1, Ms1_U1, Ms2, Ms2_U2);

  const [cfxt1, cfxt1_U1, cfxt1_x1] = C.get_cfxt(U1, x[0], param);
  const [cfxt2, cfxt2_U2, cfxt2_x2] = C.get_cfxt(U2, x[1], param);
  const [cfxtm, cfxtm_Um, cfxtm_xm] = C.get_cfxt(Um, 0.5 * (x[0] + x[1]), param);
  const cfxt = 0.25 * cfxt1 + 0.5 * cfxtm + 0.25 * cfxt2;
  const cfxt_U = sc(cat(lc(1, cfxt1_U1, 1, cfxtm_Um), lc(1, cfxtm_Um, 1, cfxt2_U2)), 0.25);
  const cfxt_x = [0.25 * (cfxt1_x1 + cfxtm_xm), 0.25 * (cfxtm_xm + cfxt2_x2)];

  const Rmom = thlog + (2 + H + Hw - Ms) * uelog - 0.5 * xlog * cfxt;
  const Rmom_U = lc(1, thlog_U, uelog, H_U, uelog, Hw_U, -uelog, Ms_U, 2 + H + Hw - Ms, uelog_U, -0.5 * xlog, cfxt_U);
  const Rmom_x = [0, 1].map(k => -0.5 * xlog_x[k] * cfxt - 0.5 * xlog * cfxt_x[k]);

  const [cDixt1, cDixt1_U1, cDixt1_x1] = C.get_cDixt(U1, x[0], param);
  const [cDixt2, cDixt2_U2, cDixt2_x2] = C.get_cDixt(U2, x[1], param);
  const [cDixt, cDixt_U] = C.upwind(upw, upw_U, cDixt1, cDixt1_U1, cDixt2, cDixt2_U2);
  const cDixt_x = [(1 - upw) * cDixt1_x1, upw * cDixt2_x2];

  const [cfxtu, cfxtu_U] = C.upwind(upw, upw_U, cfxt1, cfxt1_U1, cfxt2, cfxt2_U2);
  const cfxtu_x = [(1 - upw) * cfxt1_x1, upw * cfxt2_x2];

  const [Hss1, Hss1_U1] = C.get_Hss(U1, param);
  const [Hss2, Hss2_U2] = C.get_Hss(U2, param);
  const [Hss, Hss_U] = C.upwind(0.5, null, Hss1, Hss1_U1, Hss2, Hss2_U2);

  const fac = 2 * Hss / Hs + 1 - H - Hw;
  const Rshape = Hslog + fac * uelog + xlog * (0.5 * cfxtu - cDixt);
  const Rshape_U = lc(1, Hslog_U, 2 / Hs * uelog, Hss_U, -2 * Hss / (Hs * Hs) * uelog, Hs_U, -uelog, H_U, -uelog, Hw_U,
    fac, uelog_U, 0.5 * xlog, cfxtu_U, -xlog, cDixt_U);
  const Rshape_x = [0, 1].map(k => xlog_x[k] * (0.5 * cfxtu - cDixt) + xlog * (0.5 * cfxtu_x[k] - cDixt_x[k]));

  return { R: [Rmom, Rshape, Rlag], R_U: [Rmom_U, Rshape_U, Rlag_U], R_x: [Rmom_x, Rshape_x, Rlag_x] };
}

// exported internals for tests
export const _internal = { residual_station, residual_transition, stagnation_state, build_glob_sys, jacobian_add_Rx, wake_sys, build_param, init_boundary_layer, stagpoint_move, solve_glob, update_state, update_transition };
