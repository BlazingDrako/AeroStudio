// Autopilots: cascaded loops around the small-disturbance aircraft.
// Pitch: altitude → vertical-speed command (limited) → pitch-attitude command (limited) → elevator, with pitch-rate
// (and, for an unstable airframe, α) damping inside; or vertical-speed hold, pitch hold, or speed-on-elevator.
// Thrust: an autothrottle holding airspeed through a first-order engine lag. Lateral: heading → bank command (limited)
// → aileron with roll damping, and a washed-out yaw damper with sideslip feedback on the rudder.
// Linear analysis breaks each loop in turn (the others closed) for margins and crossover frequencies; the time
// simulation adds limits, integrator anti-windup, actuator rate limits, engine lag, the lift lost in a banked turn,
// exact turn kinematics (ψ̇ = r / cos φ, gravity ∝ sin φ), the ground track and Dryden turbulence.
// DOM-free, SI. Sources: Blakelock, Automatic Control of Aircraft and Missiles; Stevens, Lewis & Johnson ch. 4;
// Nelson ch. 10 (displacement autopilots); McLean, Automatic Flight Control Systems.
import * as Ct from './control.js';
import * as Pf from './performance.js';
import { drydenSeries, G0 } from './atmosphere.js';

// Trim thrust: fraction of full thrust needed in level flight, full thrust (N) and engine lag (s)
export function engineOf(an, ac, rating) {
  const atm = an.d.atm, V = an.d.V;
  if (ac.engine === 'none') return { none: true, Tmax: 0, tau0: 0, lag: 1 };
  const Tmax = Pf.thrust(ac, atm, V, rating).T, D = Pf.state(ac, atm, V, an.d.W, rating).D;
  return { Tmax, tau0: Math.min(1, D / Tmax), lag: ac.engine === 'piston' ? 0.5 : 3, D };
}

// ---------- linear model with one loop broken ----------
// Signals are rows over the states plus one external input (last entry). A state list is built from the modes in use.
function builder(names) {
  const n = names.length, ix = Object.fromEntries(names.map((k, i) => [k, i]));
  const z = () => new Array(n + 1).fill(0);
  const e = k => { const r = z(); if (k === 'in') r[n] = 1; else if (k in ix) r[ix[k]] = 1; return r; };
  const lin = (...terms) => { const r = z(); for (const [k, v] of terms) if (v) v.forEach((x, i) => { r[i] += k * x; }); return r; };
  return { n, ix, z, e, lin };
}
// ap: { pitch: 'alt'|'vs'|'pitch'|'speed'|'off', thr: 'speed'|'off', lat: 'hdg'|'bank'|'off', g: gains, wa, taue }
export function linearLon(an, eng, ap0, brk) {
  const ap = ap0.pitch === 'flch' ? { ...ap0, pitch: 'alt' } : ap0;   // level change is temporary: analyse the capture/hold
  const g = ap.g, A = an.lon.A, Be = an.lon.B.map(b => -b), U = an.d.V, m = an.d.m;
  const useThr = ap.thr === 'speed' && !eng.none, pitchOn = ap.pitch !== 'off';
  const names = ['u', 'w', 'q', 'th', 'h', 'de'];
  if (useThr) names.push('tau');
  if (ap.pitch === 'alt' || ap.pitch === 'vs') names.push('Ivs');
  if (useThr || ap.pitch === 'speed') names.push('IV');
  const B = builder(names), { e, lin, z } = B, row = {};
  const hdot = lin([U, e('th')], [-1, e('w')]), eV = lin([-1, e('u')]);
  let thc = z();
  if (ap.pitch === 'alt' || ap.pitch === 'vs') {
    const vsc = ap.pitch === 'alt' ? lin([-g.Kh, e('h')]) : z(), evs = lin([1, vsc], [-1, hdot]);
    thc = lin([g.Kvs, evs], [g.Kvsi, e('Ivs')]); row.Ivs = evs;
  } else if (ap.pitch === 'speed') { thc = lin([-g.KVp, eV], [-g.KVpi, e('IV')]); row.IV = eV; }
  let y = null;
  if (brk === 'theta') { y = thc; thc = e('in'); }
  let dec = pitchOn ? lin([g.Kth, thc], [-g.Kth, e('th')], [-g.Kq, e('q')], [-(g.Ka || 0) / U, e('w')]) : lin([-g.Kq, e('q')], [-(g.Ka || 0) / U, e('w')]);
  if (brk === 'elev') { y = dec; dec = e('in'); }
  row.de = lin([ap.wa, dec], [-ap.wa, e('de')]);
  if (useThr) {
    let tc = lin([g.KV, eV], [g.KVi, e('IV')]); row.IV = eV;
    if (brk === 'thr') { y = tc; tc = e('in'); }
    row.tau = lin([1 / ap.taue, tc], [-1 / ap.taue, e('tau')]);
  }
  const xs = ['u', 'w', 'q', 'th'];
  xs.forEach((k, i) => { row[k] = lin(...xs.map((kj, j) => [A[i][j], e(kj)]), [Be[i], e('de')], ...(useThr && i === 0 ? [[eng.Tmax / m, e('tau')]] : [])); });
  row.h = hdot;
  return assemble(B, names, row, y);
}
export function linearLat(an, ap, brk) {
  const g = ap.g, A = an.lat.A, Ba = an.lat.Ba, Br = an.lat.Br.map(b => -b);
  const names = ['b', 'p', 'r', 'ph', 'psi', 'da', 'dr'];
  if (g.tw > 0) names.push('xw');
  if (ap.lat === 'hdg') names.push('Ipsi');
  const B = builder(names), { e, lin, z } = B, row = {};
  let phc = z();
  if (ap.lat === 'hdg') { const ep = lin([-1, e('psi')]); phc = lin([g.Kpsi, ep], [g.Kpsii, e('Ipsi')]); row.Ipsi = ep; }
  let y = null;
  if (brk === 'bank') { y = phc; phc = e('in'); }
  let dac = ap.lat === 'off' ? lin([-g.Kp, e('p')]) : lin([g.Kphi, phc], [-g.Kphi, e('ph')], [-g.Kp, e('p')]);
  if (brk === 'ail') { y = dac; dac = e('in'); }
  row.da = lin([ap.wa, dac], [-ap.wa, e('da')]);
  const rw = g.tw > 0 ? lin([1, e('r')], [-1, e('xw')]) : e('r');
  if (g.tw > 0) row.xw = lin([1 / g.tw, e('r')], [-1 / g.tw, e('xw')]);
  let drc = lin([-g.Kr, rw], [g.Kb, e('b')]);
  if (brk === 'rud') { y = drc; drc = e('in'); }
  row.dr = lin([ap.wa, drc], [-ap.wa, e('dr')]);
  const xs = ['b', 'p', 'r', 'ph'];
  xs.forEach((k, i) => { row[k] = lin(...xs.map((kj, j) => [A[i][j], e(kj)]), [Ba[i], e('da')], [Br[i], e('dr')]); });
  row.psi = e('r');
  return assemble(B, names, row, y);
}
function assemble(B, names, row, y) {
  const n = B.n, Am = names.map(k => (row[k] || B.z()).slice(0, n)), Bm = names.map(k => (row[k] || B.z())[n]);
  return { A: Am, B: Bm, C: y ? y.slice(0, n) : null, D: y ? y[n] : 0, names };
}
// Loop transfer function with the loop broken at `brk` (negative-feedback convention: closing it is 1 + L = 0)
export function loopAt(an, eng, ap, axis, brk) {
  const s = axis === 'lon' ? linearLon(an, eng, ap, brk) : linearLat(an, ap, brk);
  const G = Ct.ssToTf(s.A, s.B, s.C, s.D), L = { num: G.num.map(v => -v), den: G.den };
  while (L.num.length > 1 && L.den.length > 1 && Math.abs(L.num[L.num.length - 1]) < 1e-14 && L.den[L.den.length - 1] === 0) { L.num.pop(); L.den.pop(); }
  return L;
}
// Every loop's margins and crossover, and the closed-loop roots
export function analyse(an, eng, ap) {
  const out = { lon: {}, lat: {} };
  const lonLoops = [['elev', 'Pitch inner loop (elevator)'], ...(ap.pitch !== 'off' && ap.pitch !== 'pitch' ? [['theta', ap.pitch === 'speed' ? 'Speed on pitch' : ap.pitch === 'vs' ? 'Vertical speed' : 'Altitude / vertical speed']] : []), ...(ap.thr === 'speed' && !eng.none ? [['thr', 'Autothrottle']] : [])];
  const latLoops = [['ail', 'Bank inner loop (aileron)'], ...(ap.lat === 'hdg' ? [['bank', 'Heading']] : []), ['rud', 'Yaw damper (rudder)']];
  for (const [axis, loops] of [['lon', lonLoops], ['lat', latLoops]]) {
    for (const [k, label] of loops) {
      const L = loopAt(an, eng, ap, axis, k), mg = Ct.margins(L);
      out[axis][k] = { label, L, mg };
    }
    const L0 = out[axis][loops[0][0]].L;
    out[axis].roots = Ct.roots(Ct.polyAdd(L0.den, L0.num));
  }
  return out;
}

// ---------- time simulation ----------
// cmds(t) → { dh, vs, dth, dV, dpsi, phi } (changes from the starting condition; only those the modes use)
export function simulate(an, ac, eng, ap, { T, dt = 0.01, cmds, gust, hw = {} }) {
  const g = ap.g, A = an.lon.A, Be = an.lon.B.map(b => -b), Al = an.lat.A, Ba = an.lat.Ba, Br = an.lat.Br.map(b => -b);
  const U = an.d.V, m = an.d.m, useThr = ap.thr === 'speed' && !eng.none;
  const lim = { th: g.thMax, phi: g.phiMax, vs: g.vsMax };
  const rate = hw.rate > 0 ? hw.rate : Infinity, pos = hw.pos > 0 ? hw.pos : Infinity, trimUp = -an.trim.de, aw = ap.antiWindup !== false;
  // state indices
  const I = { u: 0, w: 1, q: 2, th: 3, h: 4, de: 5, tau: 6, Ivs: 7, IV: 8, b: 9, p: 10, r: 11, ph: 12, psi: 13, da: 14, dr: 15, xw: 16, Ipsi: 17, xN: 18, yE: 19, IVp: 20 }, N = 21;
  // level change (FLCH): climb or descend at fixed thrust with the elevator holding speed, then capture the altitude
  const mode = { flch: false, dir: 0 };
  // climb thrust: full, or less when full would accelerate the aircraft beyond a climb within 60% of the pitch limit
  const climbThr = eng.none ? 0 : Math.min(1, eng.tau0 + an.d.W * Math.sin(0.6 * lim.th) / eng.Tmax);
  let gw = null, gv = null;
  if (gust && gust.W20 > 0) {
    const gd = 0.02, gs = drydenSeries({ h: gust.h ?? 3000, W20: gust.W20, V: U, dt: gd, n: Math.ceil(T / gd) + 3, seed: gust.seed || 3 });
    const at = arr => t => { const k = t / gd, i = Math.min(arr.length - 2, Math.floor(k)), f = k - i; return arr[i] * (1 - f) + arr[i + 1] * f; };
    gw = at(gs.w); gv = at(gs.v);
  }
  const wrap = a => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
  const sat = (v, l) => Math.max(-l, Math.min(l, v));
  // the controller: commands and internal signals from the state (also used for recording)
  const law = (x, t) => {
    const c = cmds(t), hdot = U * x[I.th] - x[I.w], eV = (c.dV || 0) - x[I.u], s = { hdot, eV };
    // pitch outer loops
    let thc = c.dth || 0, vsSat = false, thSat = false;
    s.flch = ap.pitch === 'flch' && mode.flch;
    if (s.flch) thc = -(g.KVp * eV + g.KVpi * x[I.IVp]);
    else if (ap.pitch === 'alt' || ap.pitch === 'vs' || ap.pitch === 'flch') {
      let vsc = ap.pitch === 'vs' ? c.vs || 0 : g.Kh * ((c.dh || 0) - x[I.h]);
      if (Math.abs(vsc) > lim.vs) { vsc = sat(vsc, lim.vs); vsSat = true; }
      const evs = vsc - hdot; s.evs = evs; s.vsc = vsc;
      thc = g.Kvs * evs + g.Kvsi * x[I.Ivs];
    } else if (ap.pitch === 'speed') thc = -(g.KVp * eV + g.KVpi * x[I.IV]);
    if (Math.abs(thc) > lim.th) { thc = sat(thc, lim.th); thSat = true; }
    s.thc = thc; s.vsSat = vsSat; s.thSat = thSat;
    s.dec = (ap.pitch !== 'off' ? g.Kth * (thc - x[I.th]) : 0) - g.Kq * x[I.q] - (g.Ka || 0) * x[I.w] / U;
    // autothrottle (total throttle stays within idle and full)
    if (useThr && s.flch) { s.tc = ((c.dh || 0) > x[I.h] ? climbThr : 0.02) - eng.tau0; s.thrSat = true; }
    else if (useThr) {
      let tc = g.KV * eV + g.KVi * x[I.IV]; const tot = eng.tau0 + tc;
      s.thrSat = tot > 1 || tot < 0.02; tc = Math.max(0.02, Math.min(1, tot)) - eng.tau0; s.tc = tc;
    }
    // lateral
    let phc = c.phi || 0, phSat = false;
    if (ap.lat === 'hdg') {
      s.epsi = wrap((c.dpsi || 0) - x[I.psi]);
      // near ±180° keep turning the way the turn started, instead of dithering between left and right
      if (mode.dir && Math.abs(s.epsi) > 150 * Math.PI / 180 && Math.sign(s.epsi) !== mode.dir) s.epsi += mode.dir * 2 * Math.PI;
      phc = g.Kpsi * s.epsi + g.Kpsii * x[I.Ipsi];
    }
    if (Math.abs(phc) > lim.phi) { phc = sat(phc, lim.phi); phSat = true; }
    s.phc = phc; s.phSat = phSat;
    s.dac = ap.lat === 'off' ? -g.Kp * x[I.p] : g.Kphi * (phc - x[I.ph]) - g.Kp * x[I.p];
    const rw = g.tw > 0 ? x[I.r] - x[I.xw] : x[I.r];
    s.drc = -g.Kr * rw + g.Kb * x[I.b];
    return s;
  };
  const f = (x, t) => {
    const s = law(x, t), d = new Array(N).fill(0), gw0 = gw ? gw(t) : 0, gv0 = gv ? gv(t) : 0;
    // actuators (rate and position limits on the elevator, about trim)
    let rde = sat(hw.wa * (s.dec - x[I.de]), rate); const tot = trimUp + x[I.de];
    if ((tot >= pos && rde > 0) || (tot <= -pos && rde < 0)) rde = 0;
    d[I.de] = rde; d[I.da] = hw.wa * (s.dac - x[I.da]); d[I.dr] = hw.wa * (s.drc - x[I.dr]);
    if (useThr) d[I.tau] = (s.tc - x[I.tau]) / eng.lag;
    // longitudinal: linear, plus the lift lost by banking (the vertical component of lift is L cos φ)
    const lon = [x[I.u], x[I.w], x[I.q], x[I.th]];
    for (let i = 0; i < 4; i++) {
      let v = 0; for (let j = 0; j < 4; j++) v += A[i][j] * lon[j];
      v += Be[i] * x[I.de] - A[i][1] * gw0;
      if (i === 0 && useThr) v += eng.Tmax / m * x[I.tau];
      d[i] = v;
    }
    d[I.w] += G0 * (1 - Math.cos(x[I.ph]));
    d[I.h] = s.hdot;
    // lateral: linear, with gravity ∝ sin φ (exact coordinated-turn rate g tan φ / V)
    const lat = [x[I.b], x[I.p], x[I.r], x[I.ph]];
    for (let i = 0; i < 4; i++) {
      let v = 0; for (let j = 0; j < 3; j++) v += Al[i][j] * lat[j];
      v += (i === 0 ? G0 / U * Math.sin(x[I.ph]) : Al[i][3] * x[I.ph]) + Ba[i] * x[I.da] + Br[i] * x[I.dr] - Al[i][0] * gv0 / U;
      d[I.b + i] = v;
    }
    d[I.psi] = x[I.r] / Math.cos(x[I.ph]);
    if (g.tw > 0) d[I.xw] = (x[I.r] - x[I.xw]) / g.tw;
    // integrators, frozen while their loop's output is saturated and the error would push it further (anti-windup)
    if (s.evs !== undefined) d[I.Ivs] = aw && s.thSat && Math.sign(s.evs) === Math.sign(s.thc) ? 0 : s.evs;
    if (s.flch) d[I.IVp] = aw && s.thSat && Math.sign(-s.eV) === Math.sign(s.thc) ? 0 : s.eV;
    else if (useThr) d[I.IV] = aw && s.thrSat && Math.sign(s.eV) === Math.sign(s.tc) ? 0 : s.eV;
    else if (ap.pitch === 'speed') d[I.IV] = aw && s.thSat && Math.sign(-s.eV) === Math.sign(s.thc) ? 0 : s.eV;
    if (ap.lat === 'hdg') d[I.Ipsi] = aw && s.phSat && Math.sign(s.epsi) === Math.sign(s.phc) ? 0 : s.epsi;
    // ground track
    const V = U + x[I.u], hd = (ap.psi0 || 0) + x[I.psi];
    d[I.xN] = V * Math.cos(hd); d[I.yE] = V * Math.sin(hd);
    return d;
  };
  const n = Math.ceil(T / dt), every = Math.max(1, Math.round(n / 1500));
  let x = new Array(N).fill(0);
  const rec = { t: [], x: [], s: [], departed: null, U, eng };
  for (let i = 0; i <= n; i++) {
    const t = i * dt;
    if (ap.lat === 'hdg') {
      // latch the turn direction while the heading error is large (a +180° change turns right, the way it was asked)
      const raw = (cmds(t).dpsi || 0) - x[I.psi], e = wrap(raw);
      if (Math.abs(e) < 90 * Math.PI / 180) mode.dir = 0;
      else if (!mode.dir) mode.dir = Math.abs(Math.abs(e) - Math.PI) < 1e-6 ? Math.sign(raw) || 1 : Math.sign(e);
    }
    if (ap.pitch === 'flch') {
      // switch between level change and altitude capture once per step, handing the integrators over so the
      // commands carry on smoothly (bumpless transfer)
      const c = cmds(t), eh = (c.dh || 0) - x[I.h], hdot = U * x[I.th] - x[I.w], band = 2 * Math.max(Math.abs(hdot), g.vsMax) / g.Kh;
      const want = Math.abs(eh) > band && (mode.flch || Math.abs(eh) > 1.5 * band);
      if (want !== mode.flch) {
        const s0 = law(x, t); mode.flch = want;
        const eV = (c.dV || 0) - x[I.u];
        if (want) x[I.IVp] = g.KVpi ? (-s0.thc - g.KVp * eV) / g.KVpi : 0;
        else {
          const evs = Math.max(-g.vsMax, Math.min(g.vsMax, g.Kh * eh)) - hdot;
          x[I.Ivs] = g.Kvsi ? (s0.thc - g.Kvs * evs) / g.Kvsi : 0;
          if (useThr) x[I.IV] = g.KVi ? (x[I.tau] - g.KV * eV) / g.KVi : 0;
        }
      }
    }
    if (i % every === 0) { rec.t.push(t); rec.x.push(x.slice()); rec.s.push(law(x, t)); }
    if (i === n) break;
    const k1 = f(x, t), k2 = f(x.map((v, j) => v + dt / 2 * k1[j]), t + dt / 2), k3 = f(x.map((v, j) => v + dt / 2 * k2[j]), t + dt / 2), k4 = f(x.map((v, j) => v + dt * k3[j]), t + dt);
    x = x.map((v, j) => v + dt / 6 * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
    x[I.de] = Math.max(-pos - trimUp, Math.min(pos - trimUp, x[I.de]));
    if (Math.abs(x[I.w] / U) > 0.4 || Math.abs(x[I.th]) > 0.8 || Math.abs(x[I.b]) > 0.4 || Math.abs(x[I.ph]) > 1.2 || !x.every(isFinite)) {
      rec.departed = { t: t + dt, what: Math.abs(x[I.w] / U) > 0.4 ? 'angle of attack' : Math.abs(x[I.th]) > 0.8 ? 'pitch attitude' : Math.abs(x[I.b]) > 0.4 ? 'sideslip' : 'bank angle' };
      break;
    }
  }
  rec.I = I;
  return rec;
}

// ---------- default gains ----------
// Found by sweeping each loop with the inner loops closed (successive loop closure): inner loops with ≥ 45° and
// 6 dB where the airframe allows, outer loops several times slower. Gains that scale with speed are written that way:
// the heading loop crosses over near c·g/V·Kψ, so Kψ ∝ V; the vertical-speed loop needs Kvs ∝ 1/V (γ = ḣ/V).
const INNER = { c172: { Kth: 3, Kq: 0.5, Ka: 0 }, glider: { Kth: 3, Kq: 0.5, Ka: 0 }, a320: { Kth: 2, Kq: 0.8, Ka: 0 }, cca: { Kth: 2, Kq: 0.5, Ka: 0 }, f16: { Kth: 1.5, Kq: 0.5, Ka: 0.3 } };
const LAT = { c172: { Kphi: 4, Kp: 0.3, c: 0.35, Kb: 0 }, glider: { Kphi: 1, Kp: 0.8, c: 0.17, Kb: 2 }, a320: { Kphi: 0.5, Kp: 0.8, c: 0.17, Kb: 0 }, cca: { Kphi: 0.5, Kp: 0.15, c: 0.25, Kb: 0 }, f16: { Kphi: 0.5, Kp: 0.15, c: 0.25, Kb: 0 } };
export function defaults(id, an, eng) {
  const V = an.d.V, m = an.d.m, i = INNER[id] || INNER.a320, l = LAT[id] || LAT.a320, D = Math.PI / 180, FT = 0.3048;
  const Kvs = 2 / V, KV = eng.none ? 0 : 0.2 * m / eng.Tmax;
  return {
    ...i, Kh: 0.4, Kvs, Kvsi: 0.3 * Kvs, KV, KVi: 0.1 * KV, KVp: 2 / V, KVpi: 0.1 / V,
    Kphi: l.Kphi, Kp: l.Kp, Kpsi: l.c * V / G0, Kpsii: 0, Kr: 1.5, tw: 2, Kb: l.Kb,
    thMax: 15 * D, phiMax: (id === 'f16' || id === 'cca' ? 30 : 25) * D, vsMax: (V > 150 ? 2000 : V > 40 ? 800 : 400) * FT / 60,
  };
}
