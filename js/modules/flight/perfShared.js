// Aircraft state shared by the Performance, Turn & V–n and Envelope tabs, and the controls that edit it.
import { h, section, slider, segmented, select, field, info, cssVar } from '../../lib/ui.js';
import * as P from '../../solvers/performance.js';
import { GEOMETRY } from '../../solvers/stability.js';
import { atmosphere, geometric, geopotential } from '../../solvers/atmosphere.js';
import { units, unit, toDisp, fromDisp, num } from './common.js';

const FT = 0.3048, KT = 0.514444;
// Starting flight condition for each aircraft (geometric altitude, TAS)
const START = {
  c172: { z: geometric(3000 * FT), V: 105 * KT }, glider: { z: geometric(1000), V: 50 * KT }, a320: { z: geometric(35000 * FT), M: 0.78 },
  cca: { z: geometric(30000 * FT), M: 0.7 }, f16: { z: geometric(15000 * FT), M: 0.8 },
};

export const perf = { id: 'a320', mass: 0, fuel: 0, dT: 0, rating: 'max', z: 0, V: 0, cg: 0.3, ht: 1, vt: 1, dih: 0, version: 0 };
export const ac = () => P.byId(perf.id);
export const W = () => perf.mass * 9.80665;
const listeners = new Set();
export const onPerf = f => { listeners.add(f); return () => listeners.delete(f); };
export function changed(src) { perf.version++; for (const f of listeners) f(src); }
export function setAircraft(id) {
  const a = P.byId(id), s = START[id];
  perf.id = id; perf.mass = a.mass.def; perf.rating = P.defaultRating(a);
  perf.fuel = Math.min(a.mass.fuel, (a.mass.def - a.mass.empty) * 0.8);
  perf.z = s.z; perf.V = s.V ?? s.M * atmosphere(s.z).a;
  perf.cg = GEOMETRY[id].cg[2]; perf.ht = 1; perf.vt = 1; perf.dih = 0;
}
// Input for the stability solver: the current condition (Mach capped at 0.9: subsonic derivatives only), with the
// tail incidence rigged so the aircraft's starting condition trims at mid CG with the elevator at zero
export function stabInput() {
  const s = START[perf.id], atm = atmosphere(perf.z, perf.dT);
  return { id: perf.id, mass: perf.mass, z: perf.z, dT: perf.dT, V: Math.min(perf.V, 0.9 * atm.a), cg: perf.cg, ht: perf.ht, vt: perf.vt, dihedral: perf.dih,
    zDesign: s.z, Vdesign: s.V ?? s.M * atmosphere(s.z).a, capped: perf.V > 0.9 * atm.a };
}

// CG position, tail sizes and dihedral: the 'what if' design changes for the stability tabs
export function designSection(onChange) {
  const sec = section('Balance and design');
  const build = () => {
    const g = GEOMETRY[perf.id];
    const cgS = slider({ label: 'CG position (% MAC)', min: Math.round((g.cg[0] - 0.1) * 100), max: Math.round((g.cg[1] + 0.2) * 100), step: 0.5, value: perf.cg * 100, format: v => (+v).toFixed(1),
      info: `Centre of gravity as a fraction of the mean aerodynamic chord. Certified range ${Math.round(g.cg[0] * 100)}–${Math.round(g.cg[1] * 100)}%; the slider goes beyond it so you can see what happens.`, onInput: v => { perf.cg = v / 100; changed('cg'); onChange('cg'); } });
    const htS = slider({ label: 'Horizontal tail size', min: 0.4, max: 1.8, step: 0.05, value: perf.ht, format: v => `× ${(+v).toFixed(2)}`, info: `Area relative to the real ${g.ht.S} m².`, onInput: v => { perf.ht = v; changed('ht'); onChange('ht'); } });
    const vtS = slider({ label: 'Fin size', min: 0.4, max: 1.8, step: 0.05, value: perf.vt, format: v => `× ${(+v).toFixed(2)}`, info: `Area relative to the real ${g.vt.S} m².`, onInput: v => { perf.vt = v; changed('vt'); onChange('vt'); } });
    const dS = slider({ label: 'Extra dihedral', min: -6, max: 8, step: 0.5, value: perf.dih, format: v => `${v > 0 ? '+' : ''}${(+v).toFixed(1)}°`, info: `Added to the real ${g.dihedral}°. Dihedral makes a wing that drops in a sideslip lift itself back up.`, onInput: v => { perf.dih = v; changed('dih'); onChange('dih'); } });
    const reset = h('button', { class: 'btn', type: 'button', onclick: () => { perf.cg = g.cg[2]; perf.ht = 1; perf.vt = 1; perf.dih = 0; build(); changed('cg'); onChange('cg'); } }, 'Reset design');
    sec.body.replaceChildren(cgS.el, h('div', { class: 'hint' }, `Certified CG range ${Math.round(g.cg[0] * 100)}–${Math.round(g.cg[1] * 100)}% MAC`), htS.el, vtS.el, dS.el, reset);
  };
  build();
  return { el: sec.el, rebuild: build };
}
setAircraft('a320');
// the starting aircraft and condition, used to tell which settings the user changed
export const PERF0 = { ...perf };

const massU = () => (units() === 'us' ? { k: 1 / 0.45359237, u: 'lb' } : { k: 1, u: 'kg' });
export const showMass = m => `${num(m * massU().k, 0)} ${massU().u}`;
export const showForce = N => (units() === 'us' ? `${num(N / 4.448222, 0)} lbf` : N >= 1e4 ? `${num(N / 1000, 1)} kN` : `${num(N, 0)} N`);
export const showRoc = v => (units() === 'us' ? `${num(v / FT * 60, 0)} ft/min` : `${num(v, 2)} m/s`);
export const rocDisp = v => (units() === 'us' ? v / FT * 60 : v);
export const rocUnit = () => (units() === 'us' ? 'ft/min' : 'm/s');
export const showRange = m => (units() === 'us' ? `${num(m / 1852, 0)} nm` : `${num(m / 1000, 0)} km`);
export const rangeDisp = m => (units() === 'us' ? m / 1852 : m / 1000);
export const rangeUnit = () => (units() === 'us' ? 'nm' : 'km');
export const showRunway = m => (units() === 'us' ? `${num(m / FT, 0)} ft` : `${num(m, 0)} m`);
export const showTime = s => (!isFinite(s) ? '—' : s < 120 ? `${s.toFixed(0)} s` : s < 7200 ? `${(s / 60).toFixed(1)} min` : `${(s / 3600).toFixed(2)} h`);

// The "Aircraft" section: picker, description, mass, fuel, temperature offset and engine rating
export function aircraftSection(onChange) {
  const sec = section('Aircraft');
  const build = () => {
    const a = ac(), mu = massU();
    const sel = select(P.AIRCRAFT.map(x => ({ value: x.id, label: x.name })), perf.id, v => { setAircraft(v); build(); changed('aircraft'); onChange('aircraft'); });
    const desc = h('div', { class: 'hint' }, a.note);
    const mMin = a.id === 'glider' ? a.mass.empty + 70 : a.mass.empty + (a.mass.fuel ? a.mass.fuel * 0.1 : 0);
    const mS = slider({ label: `Gross mass (${mu.u})`, min: Math.round(mMin * mu.k), max: Math.round(a.mass.max * mu.k), step: a.mass.max > 5000 ? 100 : 5, value: perf.mass * mu.k, format: v => num(+v, 0),
      info: `Empty ${showMass(a.mass.empty)}, maximum ${showMass(a.mass.max)}.${a.mass.ballast ? ' Above about ' + showMass(a.mass.max - a.mass.ballast) + ' the extra is water ballast.' : ''}`,
      onInput: v => { perf.mass = v / mu.k; perf.fuel = Math.min(perf.fuel, perf.mass - a.mass.empty); if (fS) fS.set(perf.fuel * mu.k); changed('mass'); onChange('mass'); } });
    let fS = null;
    if (a.mass.fuel) fS = slider({ label: `Fuel aboard (${mu.u})`, min: 0, max: Math.round(a.mass.fuel * mu.k), step: a.mass.fuel > 5000 ? 100 : 1, value: perf.fuel * mu.k, format: v => num(+v, 0),
      info: 'Fuel within the gross mass; the rest is payload. Range and endurance burn 95% of it (5% reserve).',
      onInput: v => { perf.fuel = Math.min(v / mu.k, perf.mass - a.mass.empty); changed('fuel'); onChange('fuel'); } });
    const dTS = slider({ label: 'Temperature offset ΔT', min: -30, max: 40, step: 1, value: perf.dT, format: v => (v > 0 ? '+' : '') + (+v).toFixed(0) + ' K', info: 'Hot day (ISA+) or cold day (ISA−). Thinner hot air raises the true speeds and lowers thrust.', onInput: v => { perf.dT = v; changed('dT'); onChange('dT'); } });
    const r = P.RATINGS[a.engine];
    const rSeg = r.length > 1 ? field('Thrust', segmented(r, perf.rating, v => { perf.rating = v; changed('rating'); onChange('rating'); }).el, 'Afterburner roughly doubles thrust at sea level but more than doubles fuel flow.') : null;
    sec.body.replaceChildren(...[field('Aircraft', sel), desc, mS.el, fS && fS.el, dTS.el, rSeg].filter(Boolean));
  };
  build();
  return { el: sec.el, rebuild: build };
}

// Altitude and speed sliders for the current flight condition
export function conditionSection(onChange, { speed = true, title = 'Flight condition' } = {}) {
  const sec = section(title);
  let zS, vS;
  const build = () => {
    const a = ac(), zMax = a.plot.zMax;
    zS = slider({ label: `Pressure altitude (${unit('alt').u})`, min: 0, max: Math.round(toDisp('alt', geopotential(zMax))), step: units() === 'us' ? 100 : 50, value: toDisp('alt', geopotential(perf.z)), format: v => num(+v, 0),
      info: 'What the altimeter reads at standard setting (FL350 = 35,000 ft). On a non-standard day the true height differs.', onInput: v => { perf.z = geometric(fromDisp('alt', v)); changed('z'); onChange('z'); } });
    const vMax = a.plot.Mmax * atmosphere(0).a;
    vS = speed ? slider({ label: `True airspeed (${unit('speed').u})`, min: 0, max: Math.round(toDisp('speed', vMax)), step: 1, value: toDisp('speed', perf.V), format: v => num(+v, 0),
      info: 'Speed through the air. The Mach number and calibrated airspeed are shown in the readouts.', onInput: v => { perf.V = fromDisp('speed', v); changed('V'); onChange('V'); } }) : null;
    sec.body.replaceChildren(...[zS.el, vS && vS.el].filter(Boolean));
  };
  build();
  return { el: sec.el, rebuild: build, setV: v => { perf.V = v; vS && vS.set(toDisp('speed', v)); } };
}

// ---- small chart helper for custom canvases ----
export function axes(c, W, H, o) {
  const pl = o.pl ?? 58, pr = o.pr ?? 16, pt = o.pt ?? 14, pb = o.pb ?? 40, iw = W - pl - pr, ih = H - pt - pb;
  const sx = x => pl + (x - o.x0) / (o.x1 - o.x0) * iw, sy = y => pt + (o.y1 - y) / (o.y1 - o.y0) * ih;
  const ix = X => o.x0 + (X - pl) / iw * (o.x1 - o.x0), iy = Y => o.y1 - (Y - pt) / ih * (o.y1 - o.y0);
  const nice = (a, b, n) => { const r = (b - a) / n, p = 10 ** Math.floor(Math.log10(r)), f = r / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; };
  const xs = o.xstep || nice(o.x0, o.x1, Math.max(3, iw / 80)), ys = o.ystep || nice(o.y0, o.y1, Math.max(3, ih / 45));
  c.font = '10.5px ' + cssVar('--mono'); c.lineWidth = 1; c.strokeStyle = cssVar('--border'); c.fillStyle = cssVar('--text-3');
  c.beginPath();
  for (let v = Math.ceil(o.x0 / xs) * xs; v <= o.x1 + 1e-9; v += xs) { const X = Math.round(sx(v)) + 0.5; c.moveTo(X, pt); c.lineTo(X, pt + ih); }
  for (let v = Math.ceil(o.y0 / ys) * ys; v <= o.y1 + 1e-9; v += ys) { const Y = Math.round(sy(v)) + 0.5; c.moveTo(pl, Y); c.lineTo(pl + iw, Y); }
  c.stroke();
  const fx = o.xfmt || (v => +v.toFixed(6)), fy = o.yfmt || (v => +v.toFixed(6));
  c.textAlign = 'center'; c.textBaseline = 'top';
  for (let v = Math.ceil(o.x0 / xs) * xs; v <= o.x1 + 1e-9; v += xs) c.fillText(fx(Math.abs(v) < xs * 1e-6 ? 0 : v), sx(v), pt + ih + 5);
  c.textAlign = 'right'; c.textBaseline = 'middle';
  for (let v = Math.ceil(o.y0 / ys) * ys; v <= o.y1 + 1e-9; v += ys) c.fillText(fy(Math.abs(v) < ys * 1e-6 ? 0 : v), pl - 6, sy(v));
  c.fillStyle = cssVar('--text-2'); c.font = '11px ' + cssVar('--font'); c.textAlign = 'center'; c.textBaseline = 'bottom';
  c.fillText(o.xlabel || '', pl + iw / 2, H - 3);
  c.save(); c.translate(12, pt + ih / 2); c.rotate(-Math.PI / 2); c.textBaseline = 'middle'; c.fillText(o.ylabel || '', 0, 0); c.restore();
  const tr = { sx, sy, ix, iy, pl, pt, iw, ih, W, H };
  tr.clip = () => { c.save(); c.beginPath(); c.rect(pl, pt, iw, ih); c.clip(); };
  tr.line = (pts, color, w = 1.6, dash = null, alpha = 1) => {
    c.strokeStyle = color; c.lineWidth = w; c.setLineDash(dash || []); c.globalAlpha = alpha; c.beginPath(); let pen = false;
    for (const [x, y] of pts) { if (!isFinite(x) || !isFinite(y)) { pen = false; continue; } const X = sx(x), Y = sy(y); pen ? c.lineTo(X, Y) : c.moveTo(X, Y); pen = true; }
    c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
  };
  tr.text = (x, y, s, color, align = 'left', base = 'middle', font = '11px') => { c.fillStyle = color; c.font = font + ' ' + cssVar('--font'); c.textAlign = align; c.textBaseline = base; c.fillText(s, sx(x), sy(y)); };
  tr.dot = (x, y, color, r = 4.5) => { c.fillStyle = color; c.strokeStyle = cssVar('--bg-elev'); c.lineWidth = 2; c.beginPath(); c.arc(sx(x), sy(y), r, 0, 2 * Math.PI); c.fill(); c.stroke(); };
  return tr;
}
export function legend(c, tr, items, x = tr.pl + 10, y = tr.pt + 12) {
  c.font = '11px ' + cssVar('--font'); c.textAlign = 'left'; c.textBaseline = 'middle';
  for (const [color, label, dash, w] of items) {
    c.fillStyle = cssVar('--bg-elev'); c.globalAlpha = 0.8; c.fillRect(x - 4, y - 7, c.measureText(label).width + 30, 14); c.globalAlpha = 1;
    c.strokeStyle = color; c.lineWidth = w || 2; c.setLineDash(dash || []); c.beginPath(); c.moveTo(x, y); c.lineTo(x + 16, y); c.stroke(); c.setLineDash([]);
    c.fillStyle = cssVar('--text-2'); c.fillText(label, x + 21, y); y += 16;
  }
}
export { info };
