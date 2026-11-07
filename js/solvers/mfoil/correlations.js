// Boundary-layer closure relations and their linearizations.
// Faithful port of the correlation functions in mfoil.m (K. J. Fidkowski, MIT license).
// Every function takes a station state U = [th, ds, sa, ue] and a param object,
// and returns [value, gradient-w.r.t.-U (length 4)].

// ---------- small vector helpers ----------
export const z4 = () => [0, 0, 0, 0];
export const z8 = () => [0, 0, 0, 0, 0, 0, 0, 0];
// linear combination: lc(c1, v1, c2, v2, ...)
export function lc() {
  const n = arguments[1].length, out = new Array(n).fill(0);
  for (let a = 0; a < arguments.length; a += 2) {
    const c = arguments[a], v = arguments[a + 1];
    if (c === 0) continue;
    for (let i = 0; i < n; i++) out[i] += c * v[i];
  }
  return out;
}
export const sc = (v, c) => v.map(x => x * c);
export const cat = (a, b) => a.concat(b);
export const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

// ---------- compressibility ----------
export function get_uk(u, p) {
  if (p.Minf > 0) {
    const l = p.KTl, V = p.Vinf;
    const den = 1 - l * (u / V) ** 2, den_u = -2 * l * u / (V * V);
    const uk = u * (1 - l) / den;
    return [uk, (1 - l) / den - (uk / den) * den_u];
  }
  return [u, 1];
}

export function get_cp(u, p) {
  // u: array; returns [cp, cp_u] arrays
  const n = u.length, cp = new Float64Array(n), cp_u = new Float64Array(n), V = p.Vinf;
  for (let i = 0; i < n; i++) {
    let c = 1 - (u[i] / V) ** 2, c_u = -2 * u[i] / (V * V);
    if (p.Minf > 0) {
      const l = p.KTl, b = p.KTb;
      const den = b + 0.5 * l * (1 + b) * c, den_cp = 0.5 * l * (1 + b);
      c = c / den; c_u = c_u * (1 - c * den_cp) / den;
    }
    cp[i] = c; cp_u[i] = c_u;
  }
  return [cp, cp_u];
}

export function get_Mach2(U, p) {
  if (p.Minf > 0) {
    const H0 = p.H0, g = p.gam;
    const [uk, uk_u] = get_uk(U[3], p);
    const c2 = (g - 1) * (H0 - 0.5 * uk * uk), c2_uk = (g - 1) * (-uk);
    const M2 = uk * uk / c2, M2_uk = 2 * uk / c2 - M2 / c2 * c2_uk;
    return [M2, [0, 0, 0, M2_uk * uk_u]];
  }
  return [0, z4()];
}

// ---------- shape parameters ----------
export function get_H(U) {
  const H = U[1] / U[0];
  return [H, [-H / U[0], 1 / U[0], 0, 0]];
}

export function get_Hw(U, wgap) {
  const Hw = wgap / U[0];
  return [Hw, [-Hw / U[0], 0, 0, 0]];
}

export function get_Hk(U, p) {
  const [H, H_U] = get_H(U);
  if (p.Minf > 0) {
    const [M2, M2_U] = get_Mach2(U, p);
    const den = 1 + 0.113 * M2, den_M2 = 0.113;
    const Hk = (H - 0.29 * M2) / den;
    return [Hk, lc(1 / den, H_U, -0.29 / den, M2_U, -Hk / den * den_M2, M2_U)];
  }
  return [H, H_U];
}

export function get_Hss(U, p) {
  const [M2, M2_U] = get_Mach2(U, p);
  const [Hk, Hk_U] = get_Hk(U, p);
  const num = 0.064 / (Hk - 0.8) + 0.251, num_U = sc(Hk_U, -0.064 / (Hk - 0.8) ** 2);
  return [M2 * num, lc(num, M2_U, M2, num_U)];
}

export function get_de(U, p) {
  const [Hk, Hk_U] = get_Hk(U, p);
  const aa = 3.15 + 1.72 / (Hk - 1), aa_U = sc(Hk_U, -1.72 / (Hk - 1) ** 2);
  let de = U[0] * aa + U[1];
  let de_U = lc(1, [aa, 1, 0, 0], U[0], aa_U);
  const dmx = 12.0;
  if (de > dmx * U[0]) { de = dmx * U[0]; de_U = [dmx, 0, 0, 0]; }
  return [de, de_U];
}

export function get_rho(U, p) {
  if (p.Minf > 0) {
    const [M2, M2_U] = get_Mach2(U, p);
    const gmi = p.gam - 1;
    const den = 1 + 0.5 * gmi * M2, den_M2 = 0.5 * gmi;
    const rho = p.rho0 / den ** (1 / gmi);
    return [rho, sc(M2_U, (-1 / gmi) * rho / den * den_M2)];
  }
  return [p.rho0, z4()];
}

export function get_Ret(U, p) {
  if (p.Minf > 0) {
    const [M2, M2_U] = get_Mach2(U, p);
    const [uk, uk_u] = get_uk(U[3], p);
    const H0 = p.H0, gmi = p.gam - 1, Ts = p.Tsrat;
    const Tr = 1 - 0.5 * uk * uk / H0, Tr_uk = -uk / H0;
    const f = Tr ** 1.5 * (1 + Ts) / (Tr + Ts), f_Tr = 1.5 * f / Tr - f / (Tr + Ts);
    const mu = p.mu0 * f, mu_uk = p.mu0 * f_Tr * Tr_uk;
    const den = 1 + 0.5 * gmi * M2, den_M2 = 0.5 * gmi;
    const rho = p.rho0 / den ** (1 / gmi), rho_U = sc(M2_U, (-1 / gmi) * rho / den * den_M2);
    const Ret = rho * uk * U[0] / mu;
    const Ret_U = lc(uk * U[0] / mu, rho_U, rho * U[0] / mu - Ret / mu * mu_uk, [0, 0, 0, uk_u], rho * uk / mu, [1, 0, 0, 0]);
    return [Ret, Ret_U];
  }
  const Ret = p.rho0 * U[0] * U[3] / p.mu0;
  return [Ret, [U[3] / p.mu0, 0, 0, U[0] / p.mu0]];
}

export function get_Hs(U, p) {
  let [Hk, Hk_U] = get_Hk(U, p);
  if (p.wake && Hk < 1.00005) { Hk = 1.00005; Hk_U = z4(); }
  if (!p.wake && Hk < 1.05) { Hk = 1.05; Hk_U = z4(); }
  let Hs, Hs_U;
  if (p.turb) {
    const Hsmin = 1.5, dHsinf = 0.015;
    const [Ret, Ret_U] = get_Ret(U, p);
    let Ho = 4, Ho_U = z4();
    if (Ret > 400) { Ho = 3 + 400 / Ret; Ho_U = sc(Ret_U, -400 / (Ret * Ret)); }
    let Reb = Ret, Reb_U = Ret_U;
    if (Ret < 200) { Reb = 200; Reb_U = z4(); }
    if (Hk < Ho) {
      const Hr = (Ho - Hk) / (Ho - 1);
      const Hr_U = lc(1 / (Ho - 1), Ho_U, -1 / (Ho - 1), Hk_U, -(Ho - Hk) / (Ho - 1) ** 2, Ho_U);
      const aa = (2 - Hsmin - 4 / Reb) * Hr * Hr;
      const aa_U = lc(4 / (Reb * Reb) * Hr * Hr, Reb_U, (2 - Hsmin - 4 / Reb) * 2 * Hr, Hr_U);
      Hs = Hsmin + 4 / Reb + aa * 1.5 / (Hk + 0.5);
      Hs_U = lc(-4 / (Reb * Reb), Reb_U, 1.5 / (Hk + 0.5), aa_U, -aa * 1.5 / (Hk + 0.5) ** 2, Hk_U);
    } else {
      const lrb = Math.log(Reb), lrb_U = sc(Reb_U, 1 / Reb);
      const aa = Hk - Ho + 4 / lrb;
      const aa_U = lc(1, Hk_U, -1, Ho_U, -4 / (lrb * lrb), lrb_U);
      const bb = 0.007 * lrb / (aa * aa) + dHsinf / Hk;
      const bb_U = lc(0.007 / (aa * aa), lrb_U, -0.007 * 2 * lrb / aa ** 3, aa_U, -dHsinf / (Hk * Hk), Hk_U);
      Hs = Hsmin + 4 / Reb + (Hk - Ho) ** 2 * bb;
      Hs_U = lc(-4 / (Reb * Reb), Reb_U, 2 * (Hk - Ho) * bb, Hk_U, -2 * (Hk - Ho) * bb, Ho_U, (Hk - Ho) ** 2, bb_U);
    }
    // slight Mach number correction
    const [M2, M2_U] = get_Mach2(U, p);
    const den = 1 + 0.014 * M2, den_M2 = 0.014;
    Hs = (Hs + 0.028 * M2) / den;
    Hs_U = lc(1 / den, Hs_U, 0.028 / den, M2_U, -Hs / den * den_M2, M2_U);
  } else {
    const a = Hk - 4.35;
    let Hs_Hk;
    if (Hk < 4.35) {
      const num = 0.0111 * a * a - 0.0278 * a ** 3;
      Hs = num / (Hk + 1) + 1.528 - 0.0002 * (a * Hk) ** 2;
      Hs_Hk = (0.0111 * 2 * a - 0.0278 * 3 * a * a) / (Hk + 1) - num / (Hk + 1) ** 2 - 0.0002 * 2 * a * Hk * (Hk + a);
    } else {
      Hs = 0.015 * a * a / Hk + 1.528;
      Hs_Hk = 0.015 * 2 * a / Hk - 0.015 * a * a / (Hk * Hk);
    }
    Hs_U = sc(Hk_U, Hs_Hk);
  }
  return [Hs, Hs_U];
}

export function get_Us(U, p) {
  const [Hs, Hs_U] = get_Hs(U, p);
  let [Hk, Hk_U] = get_Hk(U, p);
  const [H, H_U] = get_H(U);
  if (p.wake && Hk < 1.00005) { Hk = 1.00005; Hk_U = z4(); }
  if (!p.wake && Hk < 1.05) { Hk = 1.05; Hk_U = z4(); }
  const bi = 1 / p.GB;
  let Us = 0.5 * Hs * (1 - bi * (Hk - 1) / H);
  let Us_U = lc(0.5 * (1 - bi * (Hk - 1) / H), Hs_U, 0.5 * Hs * (-bi / H), Hk_U, 0.5 * Hs * bi * (Hk - 1) / (H * H), H_U);
  if (!p.wake && Us > 0.95) { Us = 0.98; Us_U = z4(); }
  if (p.wake && Us > 0.99995) { Us = 0.99995; Us_U = z4(); }
  return [Us, Us_U];
}

// ---------- skin friction ----------
export function get_cf(U, p) {
  if (p.wake) return [0, z4()];
  const [Hk, Hk_U] = get_Hk(U, p);
  const [Ret, Ret_U] = get_Ret(U, p);
  if (p.turb) {
    const [M2, M2_U] = get_Mach2(U, p);
    const Fc = Math.sqrt(1 + 0.5 * (p.gam - 1) * M2);
    const Fc_U = sc(M2_U, 0.5 / Fc * 0.5 * (p.gam - 1));
    let aa = -1.33 * Hk, aa_U = sc(Hk_U, -1.33);
    if (aa < -17) { aa = -20 + 3 * Math.exp((aa + 17) / 3); aa_U = sc(aa_U, (aa + 20) / 3); }
    let bb = Math.log(Ret / Fc), bb_U = lc(1 / Ret, Ret_U, -1 / Fc, Fc_U);
    if (bb < 3) { bb = 3; bb_U = z4(); }
    bb = bb / Math.LN10; bb_U = sc(bb_U, 1 / Math.LN10);
    const cc = -1.74 - 0.31 * Hk, cc_U = sc(Hk_U, -0.31);
    const dd = Math.tanh(4.0 - Hk / 0.875), dd_U = sc(Hk_U, (1 - dd * dd) * (-1 / 0.875));
    const cf0 = 0.3 * Math.exp(aa) * bb ** cc;
    const cf0_U = lc(cf0, aa_U, 0.3 * Math.exp(aa) * cc * bb ** (cc - 1), bb_U, cf0 * Math.log(bb), cc_U);
    const cf = (cf0 + 1.1e-4 * (dd - 1)) / Fc;
    return [cf, lc(1 / Fc, cf0_U, 1.1e-4 / Fc, dd_U, -cf / Fc, Fc_U)];
  }
  let num, num_Hk;
  if (Hk < 5.5) {
    num = 0.0727 * (5.5 - Hk) ** 3 / (Hk + 1) - 0.07;
    num_Hk = 0.0727 * (3 * (5.5 - Hk) ** 2 / (Hk + 1) * (-1) - (5.5 - Hk) ** 3 / (Hk + 1) ** 2);
  } else {
    num = 0.015 * (1 - 1 / (Hk - 4.5)) ** 2 - 0.07;
    num_Hk = 0.015 * 2 * (1 - 1 / (Hk - 4.5)) / (Hk - 4.5) ** 2;
  }
  return [num / Ret, lc(num_Hk / Ret, Hk_U, -num / (Ret * Ret), Ret_U)];
}

export function get_cfxt(U, x, p) {
  const [cf, cf_U] = get_cf(U, p);
  const cfxt = cf * x / U[0];
  const cfxt_U = sc(cf_U, x / U[0]); cfxt_U[0] -= cfxt / U[0];
  return [cfxt, cfxt_U, cf / U[0]];
}

// ---------- dissipation ----------
function cDi_lam_num(Hk) {
  if (Hk < 4) return [0.00205 * (4 - Hk) ** 5.5 + 0.207, 0.00205 * 5.5 * (4 - Hk) ** 4.5 * (-1)];
  const Hk1 = Hk - 4, q = 1 + 0.02 * Hk1 * Hk1;
  return [-0.0016 * Hk1 * Hk1 / q + 0.207, -0.0016 * (2 * Hk1 / q - Hk1 * Hk1 / (q * q) * 0.02 * 2 * Hk1)];
}

export function get_cDi_lam(U, p) {
  const [Hk, Hk_U] = get_Hk(U, p);
  const [Ret, Ret_U] = get_Ret(U, p);
  const [num, num_Hk] = cDi_lam_num(Hk);
  return [num / Ret, lc(num_Hk / Ret, Hk_U, -num / (Ret * Ret), Ret_U)];
}

export function get_cDi_turbwall(U, p) {
  if (p.wake) return [0, z4()];
  const [cf, cf_U] = get_cf(U, p);
  const [Hk, Hk_U] = get_Hk(U, p);
  const [Hs, Hs_U] = get_Hs(U, p);
  const [Us, Us_U] = get_Us(U, p);
  const [Ret, Ret_U] = get_Ret(U, p);
  const lr = Math.log(Ret), lr_U = sc(Ret_U, 1 / Ret);
  const Hmin = 1 + 2.1 / lr, Hmin_U = sc(lr_U, -2.1 / (lr * lr));
  const aa = Math.tanh((Hk - 1) / (Hmin - 1)), fac = 0.5 + 0.5 * aa;
  const fac_U = lc(0.5 * (1 - aa * aa) / (Hmin - 1), Hk_U, -0.5 * (1 - aa * aa) * (Hk - 1) / (Hmin - 1) ** 2, Hmin_U);
  const cDi = 0.5 * cf * Us * (2 / Hs) * fac;
  return [cDi, lc(Us / Hs * fac, cf_U, cf / Hs * fac, Us_U, -cDi / Hs, Hs_U, cf * Us / Hs, fac_U)];
}

export function get_cDi_lamwake(U, p0) {
  const p = { ...p0, turb: false };
  const [Hk, Hk_U] = get_Hk(U, p);
  const [Hs, Hs_U] = get_Hs(U, p);
  const [Ret, Ret_U] = get_Ret(U, p);
  const HsRet = Hs * Ret, HsRet_U = lc(Ret, Hs_U, Hs, Ret_U);
  const num = 2 * 1.1 * (1 - 1 / Hk) ** 2 * (1 / Hk);
  const num_Hk = 2 * 1.1 * (2 * (1 - 1 / Hk) * (1 / (Hk * Hk)) * (1 / Hk) + (1 - 1 / Hk) ** 2 * (-1 / (Hk * Hk)));
  return [num / HsRet, lc(num_Hk / HsRet, Hk_U, -num / (HsRet * HsRet), HsRet_U)];
}

export function get_cDi_outer(U, p) {
  if (!p.turb) return [0, z4()];
  const [Hs, Hs_U] = get_Hs(U, p);
  const [Us, Us_U] = get_Us(U, p);
  const ct = U[2] * U[2], ct_U = [0, 0, 2 * U[2], 0];
  const cDi = ct * (0.995 - Us) * 2 / Hs;
  return [cDi, lc((0.995 - Us) * 2 / Hs, ct_U, -ct * 2 / Hs, Us_U, -ct * (0.995 - Us) * 2 / (Hs * Hs), Hs_U)];
}

export function get_cDi_lamstress(U, p) {
  const [Hs, Hs_U] = get_Hs(U, p);
  const [Us, Us_U] = get_Us(U, p);
  const [Ret, Ret_U] = get_Ret(U, p);
  const HsRet = Hs * Ret, HsRet_U = lc(Ret, Hs_U, Hs, Ret_U);
  const num = 0.15 * (0.995 - Us) ** 2 * 2, num_Us = 0.15 * 2 * (0.995 - Us) * (-1) * 2;
  return [num / HsRet, lc(num_Us / HsRet, Us_U, -num / (HsRet * HsRet), HsRet_U)];
}

export function get_cDi(U, p) {
  if (p.turb) {
    let cDi = 0, cDi_U = z4(), cDil, cDil_U;
    if (!p.wake) {
      const [c0, c0_U] = get_cDi_turbwall(U, p);
      cDi += c0; cDi_U = lc(1, cDi_U, 1, c0_U);
      [cDil, cDil_U] = get_cDi_lam(U, p);
    } else {
      [cDil, cDil_U] = get_cDi_lamwake(U, p);
    }
    let [c0, c0_U] = get_cDi_outer(U, p);
    cDi += c0; cDi_U = lc(1, cDi_U, 1, c0_U);
    [c0, c0_U] = get_cDi_lamstress(U, p);
    cDi += c0; cDi_U = lc(1, cDi_U, 1, c0_U);
    if (cDil > cDi) { cDi = cDil; cDi_U = cDil_U; }
    if (p.wake) { cDi *= 2; cDi_U = sc(cDi_U, 2); }
    return [cDi, cDi_U];
  }
  return get_cDi_lam(U, p);
}

export function get_cDixt(U, x, p) {
  const [cDi, cDi_U] = get_cDi(U, p);
  const cDixt = cDi * x / U[0];
  const cDixt_U = sc(cDi_U, x / U[0]); cDixt_U[0] -= cDixt / U[0];
  return [cDixt, cDixt_U, cDi / U[0]];
}

// ---------- shear lag ----------
export function get_cteq(U, p) {
  const CC = 0.5 / (p.GA * p.GA * p.GB), C = p.GC;
  let [Hk, Hk_U] = get_Hk(U, p);
  const [Hs, Hs_U] = get_Hs(U, p);
  const [H, H_U] = get_H(U);
  const [Ret, Ret_U] = get_Ret(U, p);
  const [Us, Us_U] = get_Us(U, p);
  let Hkc, Hkc_U;
  if (p.wake) {
    if (Hk < 1.00005) { Hk = 1.00005; Hk_U = z4(); }
    Hkc = Hk - 1; Hkc_U = Hk_U;
  } else {
    if (Hk < 1.05) { Hk = 1.05; Hk_U = z4(); }
    Hkc = Hk - 1 - C / Ret;
    Hkc_U = lc(1, Hk_U, C / (Ret * Ret), Ret_U);
    if (Hkc < 0.01) { Hkc = 0.01; Hkc_U = z4(); }
  }
  const num = CC * Hs * (Hk - 1) * Hkc * Hkc;
  const num_U = lc(CC * (Hk - 1) * Hkc * Hkc, Hs_U, CC * Hs * Hkc * Hkc, Hk_U, CC * Hs * (Hk - 1) * 2 * Hkc, Hkc_U);
  const den = (1 - Us) * H * Hk * Hk;
  const den_U = lc(-H * Hk * Hk, Us_U, (1 - Us) * Hk * Hk, H_U, (1 - Us) * H * 2 * Hk, Hk_U);
  const cteq = Math.sqrt(num / den);
  return [cteq, lc(0.5 / cteq / den, num_U, -0.5 / cteq * num / (den * den), den_U)];
}

export function get_cttr(U, p0) {
  const p = { ...p0, wake: false };
  const [cteq, cteq_U] = get_cteq(U, p);
  let [Hk, Hk_U] = get_Hk(U, p);
  if (Hk < 1.05) { Hk = 1.05; Hk_U = z4(); }
  const C = p.CtauC, E = p.CtauE;
  const c = C * Math.exp(-E / (Hk - 1)), c_U = sc(Hk_U, c * E / (Hk - 1) ** 2);
  return [c * cteq, lc(cteq, c_U, c, cteq_U)];
}

// uq = equilibrium 1/ue * due/dx (vectors here are length 8: two stations)
export function get_uq(ds, ds_U, cf, cf_U, Hk, Hk_U, Ret, Ret_U, p) {
  const beta = p.GB;
  let A = p.GA, C = p.GC;
  if (p.wake) { A = A * p.Dlr; C = 0; }
  if (p.wake && Hk < 1.00005) { Hk = 1.00005; Hk_U = sc(Hk_U, 0); }
  if (!p.wake && Hk < 1.05) { Hk = 1.05; Hk_U = sc(Hk_U, 0); }
  let Hkc = Hk - 1 - C / Ret;
  let Hkc_U = lc(1, Hk_U, C / (Ret * Ret), Ret_U);
  if (Hkc < 0.01) { Hkc = 0.01; Hkc_U = sc(Hkc_U, 0); }
  const r = Hkc / (A * Hk);
  const ut = 0.5 * cf - r * r;
  const ut_U = lc(0.5, cf_U, -2 * r / (A * Hk), Hkc_U, 2 * r * Hkc / (A * Hk * Hk), Hk_U);
  const uq = ut / (beta * ds);
  return [uq, lc(1 / (beta * ds), ut_U, -uq / ds, ds_U)];
}

// ---------- transition ----------
export function get_damp(U, p) {
  let [Hk, Hk_U] = get_Hk(U, p);
  const [Ret, Ret_U] = get_Ret(U, p);
  const th = U[0];
  if (Hk < 1.05) { Hk = 1.05; Hk_U = z4(); }
  const Hmi = 1 / (Hk - 1), Hmi_U = sc(Hk_U, -Hmi * Hmi);
  const aa = 2.492 * Hmi ** 0.43, aa_U = sc(Hmi_U, 0.43 * aa / Hmi);
  const bb = Math.tanh(14 * Hmi - 9.24), bb_U = sc(Hmi_U, (1 - bb * bb) * 14);
  const lrc = aa + 0.7 * (bb + 1), lrc_U = lc(1, aa_U, 0.7, bb_U);
  const lr = Math.log(Ret) / Math.LN10, lr_U = sc(Ret_U, 1 / Ret / Math.LN10);
  const dl = 0.1;
  let damp = 0, damp_U = z4();
  if (lr >= lrc - dl) {
    const rn = (lr - (lrc - dl)) / (2 * dl), rn_U = lc(1 / (2 * dl), lr_U, -1 / (2 * dl), lrc_U);
    let rf, rf_U;
    if (rn >= 1) { rf = 1; rf_U = z4(); }
    else { rf = 3 * rn * rn - 2 * rn ** 3; rf_U = sc(rn_U, 6 * rn - 6 * rn * rn); }
    const ar = 3.87 * Hmi - 2.52, ar_U = sc(Hmi_U, 3.87);
    const ex = Math.exp(-ar * ar), ex_U = sc(ar_U, ex * (-2 * ar));
    const da = 0.028 * (Hk - 1) - 0.0345 * ex, da_U = lc(0.028, Hk_U, -0.0345, ex_U);
    const af = -0.05 + 2.7 * Hmi - 5.5 * Hmi * Hmi + 3 * Hmi ** 3 + 0.1 * Math.exp(-20 * Hmi);
    // note: mfoil.m has "-1*exp(-20*Hmi)" here; the exact derivative is -2*exp(-20*Hmi).
    // This only changes the Jacobian (Newton convergence), never the converged answer.
    const af_U = sc(Hmi_U, 2.7 - 11 * Hmi + 9 * Hmi * Hmi - 2 * Math.exp(-20 * Hmi));
    damp = rf * af * da / th;
    damp_U = lc(af * da / th, rf_U, rf * da / th, af_U, rf * af / th, da_U, -damp / th, [1, 0, 0, 0]);
  }
  // extra amplification to ensure dn/dx > 0 near ncrit
  const Cea = 5, nx = Cea * (U[2] - p.ncrit), nx_U = [0, 0, Cea, 0];
  const tnx = Math.tanh(nx), eex = 1 + tnx, eex_U = sc(nx_U, 1 - tnx * tnx);
  const ed = eex * 0.001 / th, ed_U = lc(0.001 / th, eex_U, -ed / th, [1, 0, 0, 0]);
  return [damp + ed, lc(1, damp_U, 1, ed_U)];
}

// ---------- upwinding ----------
export function get_upw(U1, U2, p) {
  const [Hk1, Hk1_U1] = get_Hk(U1, p);
  const [Hk2, Hk2_U2] = get_Hk(U2, p);
  const Hut = 1.0, C = p.wake ? 1.0 : 5.0;
  const Huc = C * Hut / (Hk2 * Hk2);
  const Huc_U = cat(z4(), sc(Hk2_U2, -2 * Huc / Hk2));
  const aa = (Hk2 - 1) / (Hk1 - 1), sga = Math.sign(aa);
  const la = Math.log(sga * aa);
  const la_U = cat(sc(Hk1_U1, -1 / (Hk1 - 1)), sc(Hk2_U2, 1 / (Hk2 - 1)));
  let Hls = la * la, Hls_U = sc(la_U, 2 * la);
  if (Hls > 15) { Hls = 15; Hls_U = z8(); }
  const e = Math.exp(-Hls * Huc);
  return [1 - 0.5 * e, lc(0.5 * e * Huc, Hls_U, 0.5 * e * Hls, Huc_U)];
}

// upwind average of two scalars; upw_U may be null (constant factor)
export function upwind(upw, upw_U, f1, f1_U1, f2, f2_U2) {
  const f = (1 - upw) * f1 + upw * f2;
  const f_U = cat(sc(f1_U1, 1 - upw), sc(f2_U2, upw));
  if (upw_U) for (let i = 0; i < 8; i++) f_U[i] += upw_U[i] * (f2 - f1);
  return [f, f_U];
}
