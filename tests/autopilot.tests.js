// Autopilot checks: heading hold against its linear closed loop, the exact coordinated-turn rate g·tan φ / V, the lift
// lost in a banked turn (and an altitude hold recovering it), altitude capture within the vertical-speed limit, the
// autothrottle, integrator windup and anti-windup, level change (FLCH) against a vertical-speed climb at altitude,
// speed on elevator for the sailplane, turning the short way round, and the default gains for all five aircraft
// (every loop stable, inner loops at least three times faster than the loops around them).
import * as Ap from '../js/solvers/autopilot.js';
import * as Ct from '../js/solvers/control.js';
import * as St from '../js/solvers/stability.js';
import * as Pf from '../js/solvers/performance.js';
import { geometric, atmosphere, G0 } from '../js/solvers/atmosphere.js';

export function autopilotTests(log) {
  const D = Math.PI / 180, FT = 0.3048, KT = 0.514444;
  const COND = { c172: [1050, 3000 * FT, 105 * KT], glider: [400, 1000, 50 * KT], a320: [65000, 35000 * FT, 'M0.78'], cca: [2300, 30000 * FT, 'M0.7'], f16: [12000, 15000 * FT, 'M0.8'] };
  const setup = id => {
    const [mass, zp, v] = COND[id], z = geometric(zp), V = typeof v === 'string' ? +v.slice(1) * atmosphere(z).a : v, ac = Pf.byId(id);
    const an = St.analyse({ id, mass, z, V, cg: St.GEOMETRY[id].cg[2] }), eng = Ap.engineOf(an, ac, Pf.defaultRating(ac)), g = Ap.defaults(id, an, eng);
    return { an, ac, eng, g, ap: (o = {}) => ({ pitch: eng.none ? 'speed' : 'alt', thr: eng.none ? 'off' : 'speed', lat: 'hdg', g, wa: 20, taue: eng.lag, antiWindup: true, ...o }) };
  };
  const hw = { wa: 20, rate: 60 * D, pos: 25 * D };
  const c = setup('c172');

  // ---- heading hold = its linear closed loop for a small step ----
  {
    const ap = c.ap(), L = Ap.loopAt(c.an, c.eng, ap, 'lat', 'bank'), lin = Ct.response(Ct.feedback(L), t => (t >= 1 ? 1 * D : 0), 20, 0.005);
    const sim = Ap.simulate(c.an, c.ac, c.eng, ap, { T: 20, dt: 0.005, cmds: t => ({ dpsi: t >= 1 ? 1 * D : 0 }), hw: { wa: 20 } });
    const at = t => { const h = lin.t[1] - lin.t[0], k = Math.min(lin.t.length - 2, Math.floor(t / h)), f = (t - lin.t[k]) / h; return lin.y[k] * (1 - f) + lin.y[k + 1] * f; };
    let err = 0; sim.t.forEach((t, i) => { err = Math.max(err, Math.abs(sim.x[i][sim.I.psi] - at(t))); });
    log('heading hold: simulation matches the linear closed loop for a 1° step', err < 0.02 * D, `max difference ${(err / D).toFixed(4)}° (${(err / D * 100).toFixed(2)}% of the step)`);
  }
  // ---- coordinated turn ----
  {
    const sim = Ap.simulate(c.an, c.ac, c.eng, c.ap({ lat: 'bank' }), { T: 40, cmds: t => ({ phi: t > 1 ? 25 * D : 0 }), hw });
    const n = sim.t.length - 1, I = sim.I, x = sim.x[n], rate = (sim.x[n][I.psi] - sim.x[n - 10][I.psi]) / (sim.t[n] - sim.t[n - 10]);
    const V = c.an.d.V + x[I.u], ref = G0 * Math.tan(x[I.ph]) / V;
    log('steady 25° bank: turn rate g·tan φ / V (exact kinematics, within 2%)', Math.abs(rate / ref - 1) < 0.02, `${(rate / D).toFixed(3)}°/s vs ${(ref / D).toFixed(3)}°/s at φ ${(x[I.ph] / D).toFixed(2)}°`);
  }
  // ---- lift lost in a banked turn ----
  {
    const turn = pitch => Ap.simulate(c.an, c.ac, c.eng, c.ap({ pitch, lat: 'bank' }), { T: 30, cmds: t => ({ phi: t > 1 ? 30 * D : 0 }), hw });
    const hp = turn('pitch'), ha = turn('alt'), dh = s => Math.min(...s.x.map(x => x[s.I.h])) / FT;
    log('30° bank on pitch hold only: the aircraft sinks over 30 ft (lift L cos φ < W)', dh(hp) < -30, `${dh(hp).toFixed(0)} ft in 30 s`);
    log('…with altitude hold the loss stays under 15 ft', dh(ha) > -15, `${dh(ha).toFixed(1)} ft`);
  }
  // ---- altitude capture ----
  {
    const sim = Ap.simulate(c.an, c.ac, c.eng, c.ap(), { T: 150, cmds: t => ({ dh: t > 2 ? 1000 * FT : 0 }), hw }), I = sim.I;
    const hs = sim.x.map(x => x[I.h] / FT), vs = sim.s.map(s => Math.abs(s.hdot)), end = hs[hs.length - 1];
    log('altitude capture: +1,000 ft, within 5 ft at the end and under 2% overshoot', Math.abs(end - 1000) < 5 && Math.max(...hs) < 1020, `end ${end.toFixed(1)} ft, peak ${Math.max(...hs).toFixed(1)} ft`);
    log('…climbing no faster than the vertical-speed limit', Math.max(...vs) <= c.g.vsMax * 1.05, `peak ${(Math.max(...vs) / FT * 60).toFixed(0)} ft/min, limit ${(c.g.vsMax / FT * 60).toFixed(0)}`);
  }
  // ---- autothrottle and windup ----
  {
    const k = setup('cca'), sim = Ap.simulate(k.an, k.ac, k.eng, k.ap(), { T: 120, cmds: t => ({ dh: t > 2 ? 1000 * FT : 0, dpsi: t > 2 ? 90 * D : 0, dV: t > 2 ? 10 * KT : 0 }), hw }), x = sim.x[sim.x.length - 1];
    log('climbing turn with a speed change: speed, height and heading all captured', Math.abs(x[sim.I.u] / KT - 10) < 0.5 && Math.abs(x[sim.I.h] / FT - 1000) < 10 && Math.abs(x[sim.I.psi] / D - 90) < 1, `ΔV ${(x[sim.I.u] / KT).toFixed(2)} kt, Δh ${(x[sim.I.h] / FT).toFixed(1)} ft, ψ ${(x[sim.I.psi] / D).toFixed(2)}°`);
    const wind = aw => { const s = Ap.simulate(c.an, c.ac, c.eng, c.ap({ antiWindup: aw }), { T: 240, cmds: t => ({ dh: t > 2 ? 2000 * FT : 0 }), hw }); return Math.max(...s.x.map(x => x[s.I.u])) / KT; };
    const on = wind(true), off = wind(false);
    log('integrator windup: with the throttle at full in a long climb, speed overshoots after level-off without anti-windup', off > 10 && on < 2, `peak speed gain ${off.toFixed(1)} kt without, ${on.toFixed(1)} kt with anti-windup`);
  }
  // ---- level change at altitude ----
  {
    const a = setup('a320'), loss = pitch => { const s = Ap.simulate(a.an, a.ac, a.eng, a.ap({ pitch }), { T: 300, cmds: t => ({ dh: t > 2 ? 2000 * FT : 0 }), hw }); return { v: Math.min(...s.x.map(x => x[s.I.u])) / KT, h: s.x[s.x.length - 1][s.I.h] / FT }; };
    const vs = loss('alt'), fl = loss('flch');
    log('airliner at FL350, +2,000 ft: a vertical-speed climb bleeds speed; level change holds it', fl.v > vs.v / 2 && vs.v < -20 && Math.abs(fl.h - 2000) < 10, `speed lost ${(-vs.v).toFixed(1)} kt (V/S) vs ${(-fl.v).toFixed(1)} kt (FLCH), FLCH ends at ${fl.h.toFixed(0)} ft`);
  }
  // ---- sailplane: speed on elevator ----
  {
    const s = setup('glider'), sim = Ap.simulate(s.an, s.ac, s.eng, s.ap(), { T: 60, cmds: t => ({ dV: t > 1 ? 10 * KT : 0 }), hw }), x = sim.x[sim.x.length - 1];
    log('sailplane: speed held on the elevator (+10 kt)', Math.abs(x[sim.I.u] / KT - 10) < 0.5, `ΔV ${(x[sim.I.u] / KT).toFixed(2)} kt`);
  }
  // ---- the short way round ----
  {
    const sim = Ap.simulate(c.an, c.ac, c.eng, c.ap(), { T: 90, cmds: t => ({ dpsi: t > 1 ? 270 * D : 0 }), hw }), x = sim.x[sim.x.length - 1];
    log('heading change of +270° is flown as a 90° left turn', Math.abs(x[sim.I.psi] / D + 90) < 1, `ψ ${(x[sim.I.psi] / D).toFixed(2)}°`);
  }
  {
    const s = setup('glider'), sim = Ap.simulate(s.an, s.ac, s.eng, s.ap(), { T: 60, cmds: t => ({ dpsi: t > 1 ? 180 * D : 0 }), hw }), x = sim.x[sim.x.length - 1];
    log('exactly 180°: the turn direction is latched (no dithering despite adverse yaw)', Math.abs(Math.abs(x[sim.I.psi] / D) - 180) < 1, `ψ ${(x[sim.I.psi] / D).toFixed(2)}° (sailplane)`);
  }
  // ---- default gains ----
  const rep = [];
  let allOk = true, sepOk = true;
  for (const id of Object.keys(COND)) {
    const s = setup(id), A = Ap.analyse(s.an, s.eng, s.ap());
    for (const ax of ['lon', 'lat']) if (!A[ax].roots.every(z => z[0] < 2e-3)) { allOk = false; rep.push(`${id} ${ax} unstable`); }
    const wc = (ax, k) => (A[ax][k] && A[ax][k].mg.pm ? A[ax][k].mg.pm.w : NaN);
    const pr = wc('lon', 'elev') / wc('lon', 'theta'), lr = wc('lat', 'ail') / wc('lat', 'bank');
    if (!(pr >= 3 && lr >= 3)) sepOk = false;
    rep.push(`${id} ×${pr.toFixed(1)} / ×${lr.toFixed(1)}`);
  }
  log('default gains: every loop stable on all five aircraft', allOk, rep.filter(r => r.includes('unstable')).join(', '));
  log('default gains: inner loops cross over ≥ 3× faster than the loop around them (pitch / roll)', sepOk, rep.filter(r => !r.includes('unstable')).join('; '));
}
