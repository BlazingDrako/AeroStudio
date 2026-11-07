// High-level API around the mfoil port: builds/reuses a model from a plain spec,
// solves, and packages everything the UI needs (coefficients, distributions, field data).
import { Mfoil, get_sigma, TE_info, set_coords, make_panels, calc_force } from './mfoil.js';

export function geomKey(g) {
  return JSON.stringify({ k: g.kind, c: g.code, x: g.kind === 'coords' ? g.x.length + ':' + g.x[0] + ':' + g.z[3] + ':' + g.name : 0, n: g.npanel, f: g.flap });
}

export class AirfoilSession {
  constructor() { this.M = null; this.key = null; this.lastGoodVisc = false; }

  buildGeometry(g) {
    let M;
    if (g.kind === 'coords') {
      M = new Mfoil({ coords: { x: g.x, z: g.z }, npanel: g.npanel });
      M.geom.name = g.name || 'Custom airfoil';
    } else {
      M = new Mfoil({ naca: g.code, npanel: g.npanel });
    }
    if (g.flap && Math.abs(g.flap.eta) > 1e-9) {
      const xh = g.flap.xh * M.geom.chord + Math.min(...M.geom.xpoint.x);
      const zh = g.flap.zh !== undefined ? g.flap.zh : camberAt(M.geom.xpoint, xh);
      M.geom_flap([xh, zh], g.flap.eta);
      M.geom.name += ` (flap ${g.flap.eta > 0 ? '+' : ''}${g.flap.eta}°)`;
      M.flapHinge = [xh, zh];
    }
    this.M = M; this.key = geomKey(g); this.lastGoodVisc = false;
    return M;
  }

  // spec: { geom, oper: {alpha|cl, mode:'alpha'|'cl', Re, Ma, viscous, xftl, xftu}, param: {ncrit, niglob, rtol} }
  solve(spec) {
    const t0 = performance.now();
    const key = geomKey(spec.geom);
    if (!this.M || key !== this.key) this.buildGeometry(spec.geom);
    const M = this.M;
    M.messages = [];
    const o = spec.oper, p = spec.param || {};
    M.param.verb = 1;
    if (p.ncrit !== undefined) M.param.ncrit = p.ncrit;
    if (p.niglob !== undefined) M.param.niglob = p.niglob;
    if (p.rtol !== undefined) M.param.rtol = p.rtol;
    M.oper.Ma = o.Ma || 0;
    M.oper.Re = o.Re || 1e6;
    M.oper.xft = [o.xftl ?? 1, o.xftu ?? 1, 1];
    if (o.mode === 'cl') { M.oper.cltgt = o.cl; M.oper.givencl = true; }
    else { M.oper.alpha = o.alpha; M.oper.givencl = false; }
    if (M.oper.viscous !== !!o.viscous) this.lastGoodVisc = false;
    M.oper.viscous = !!o.viscous;

    let warm = false;
    if (M.oper.viscous) {
      // warm start from the previous converged viscous solution (much faster for small changes)
      warm = this.lastGoodVisc && spec.warm !== false;
      M.oper.initbl = !warm;
      if (o.mode === 'cl' && warm && this.lastAlpha !== undefined) M.oper.alpha = this.lastAlpha;
      try { M.solve(); } catch (e) { M.glob.conv = false; M.messages.push('Error: ' + e.message); }
      if (!M.glob.conv && warm) {
        // retry from scratch
        M.oper.initbl = true; warm = false;
        if (o.mode !== 'cl') M.oper.alpha = o.alpha;
        try { M.solve(); } catch (e) { M.glob.conv = false; M.messages.push('Error: ' + e.message); }
      }
      this.lastGoodVisc = !!M.glob.conv && isFinite(M.post.cl);
      this.lastAlpha = M.oper.alpha;
    } else {
      M.solve();
    }
    return packResult(M, performance.now() - t0, warm);
  }
}

function camberAt(X, xh) {
  // mean of the two surface z values at x = xh
  const zs = [];
  for (let i = 0; i < X.x.length - 1; i++) {
    const a = X.x[i], b = X.x[i + 1];
    if ((a - xh) * (b - xh) <= 0 && a !== b) zs.push(X.z[i] + (X.z[i + 1] - X.z[i]) * (xh - a) / (b - a));
  }
  if (zs.length < 2) return 0;
  return 0.5 * (Math.min(...zs) + Math.max(...zs));
}

function stagInviscid(M) {
  const N = M.foil.N, g = M.isol.gam;
  let j0 = -1; for (let k = 0; k < N; k++) if (g[k] > 0) { j0 = k; break; }
  if (j0 < 1) return null;
  const I = [j0 - 1, j0], den = g[I[1]] - g[I[0]], w1 = g[I[1]] / den, w2 = -g[I[0]] / den;
  return { I, x: M.foil.x[I[0]] * w1 + M.foil.x[I[1]] * w2, z: M.foil.z[I[0]] * w1 + M.foil.z[I[1]] * w2 };
}

function packResult(M, ms, warm) {
  const N = M.foil.N, visc = M.oper.viscous;
  const te = TE_info(M.foil);
  const r = {
    ok: isFinite(M.post.cl),
    name: M.geom.name, chord: M.geom.chord, xref: M.geom.xref,
    viscous: visc, conv: !!M.glob.conv, warm, timeMs: ms,
    iters: visc ? M.glob.history.length : 0, history: visc ? M.glob.history.slice() : [],
    messages: M.messages.slice(-30),
    alpha: M.oper.alpha, Re: M.oper.Re, Ma: M.oper.Ma, ncrit: M.param.ncrit,
    coef: { cl: M.post.cl, cd: M.post.cd, cm: M.post.cm, cdf: M.post.cdf, cdp: M.post.cdp, cdpi: M.post.cdpi },
    N, foil: { x: Float64Array.from(M.foil.x), z: Float64Array.from(M.foil.z), s: Float64Array.from(M.foil.s) },
    cps: M.param.cps, KTb: M.param.KTb, KTl: M.param.KTl, Vinf: M.oper.Vinf,
    flapHinge: M.flapHinge || null,
    geomPts: { x: Float64Array.from(M.geom.xpoint.x), z: Float64Array.from(M.geom.xpoint.z) },
  };
  r.cp = Float64Array.from(M.post.cp.subarray(0, visc ? M.glob.Nsys : N));
  r.cpi = Float64Array.from(M.post.cpi.subarray(0, visc ? M.glob.Nsys : N));
  if (visc) {
    const Nw = M.wake.N;
    r.Nw = Nw;
    r.wake = { x: Float64Array.from(M.wake.x), z: Float64Array.from(M.wake.z) };
    r.Is = M.vsol.Is.map(a => Int32Array.from(a));
    r.stag = { x: M.isol.xstag[0], z: M.isol.xstag[1] };
    const P = M.post;
    r.dist = {
      th: Float64Array.from(P.th), ds: Float64Array.from(P.ds), sa: Float64Array.from(P.sa),
      ue: Float64Array.from(P.ue), uei: Float64Array.from(P.uei), cf: Float64Array.from(P.cf),
      Hk: Float64Array.from(P.Hk), Ret: Float64Array.from(P.Ret), turb: Uint8Array.from(M.vsol.turb),
    };
    r.tangents = { x: Float64Array.from([...M.foil.tx, ...M.wake.tx]), z: Float64Array.from([...M.foil.tz, ...M.wake.tz]) };
    // a surface with no turbulent nodes stays laminar to the trailing edge (x = null)
    r.transition = [0, 1].map(is => {
      const hasTurb = M.vsol.Is[is].some(i => M.vsol.turb[i]);
      return hasTurb ? { xi: M.vsol.Xt[is][0], x: M.vsol.Xt[is][1], type: (M.vsol.Xtype || [])[is] || 'free' }
        : { xi: null, x: null, type: 'none' };
    });
    // field data: viscous gamma includes the source-induced change (gamma + Bp*sigma)
    const sigma = get_sigma(M), Np = sigma.length, us = M.vsol.ue_sigma;
    const G = Float64Array.from(M.isol.gam);
    for (let i = 0; i < N; i++) { let s = 0; for (let p = 0; p < Np; p++) s += us[i * Np + p] * sigma[p]; G[i] += s; }
    r.field = { G, sigma, tcp: te.tcp, tdp: te.tdp, hasTE: te.hasPanel };
  } else {
    const st = stagInviscid(M);
    if (st) {
      r.stag = { x: st.x, z: st.z };
      const lower = []; for (let k = st.I[0]; k >= 0; k--) lower.push(k);
      const upper = []; for (let k = st.I[1]; k < N; k++) upper.push(k);
      r.Is = [Int32Array.from(lower), Int32Array.from(upper), new Int32Array(0)];
    } else r.Is = [new Int32Array(0), Int32Array.from({ length: N }, (_, i) => i), new Int32Array(0)];
    r.field = { G: Float64Array.from(M.isol.gam), sigma: null, tcp: te.tcp, tdp: te.tdp, hasTE: te.hasPanel };
  }
  return r;
}
