// Shared state for the Orbital Mechanics module: one orbit that the Orbit & elements and Ground tracks tabs both show
// and edit, kept in friendly units (km above the surface, degrees) and turned into SI elements by elOf().
import * as O from '../../solvers/orbits.js';
import { h, slider, section, select, field } from '../../lib/ui.js';
export { metricsGrid, insightsList, card, put, canvasBox, resultRows } from '../propulsion/common.js';

export const D = Math.PI / 180;
export const ORBIT0 = { body: 'earth', hp: 600, ha: 39750, i: 63.4, raan: 40, argp: 270, nu: 30, preset: 'molniya', shape: 'alt' };
export const orbit = { ...ORBIT0, subs: new Set() };
export const changed = () => { for (const f of orbit.subs) f(); };

export function elOf(S = orbit) {
  const B = O.body(S.body), rp = B.R + S.hp * 1e3, ra = B.R + Math.max(S.hp, S.ha) * 1e3;
  return { a: (rp + ra) / 2, e: (ra - rp) / (ra + rp), i: S.i * D, raan: S.raan * D, argp: S.argp * D, nu: S.nu * D };
}
export function loadPreset(id, S = orbit) {
  const p = O.ORBIT_PRESETS.find(x => x.id === id);
  if (!p) return;
  const B = O.body(p.body);
  Object.assign(S, { body: p.body, hp: (p.a * (1 - p.e) - B.R) / 1e3, ha: (p.a * (1 + p.e) - B.R) / 1e3, i: p.i / D, raan: p.raan / D, argp: p.argp / D, nu: p.nu / D, preset: id });
}

// ---- formatting ----
export const km = m => { const k = m / 1e3; return Math.abs(k) >= 1e6 ? (k / 1e6).toFixed(2) + ' M km' : Math.abs(k) >= 1e4 ? Math.round(k).toLocaleString('en-US') + ' km' : k.toFixed(Math.abs(k) < 100 ? 1 : 0) + ' km'; };
export const kms = v => (v / 1e3).toFixed(v < 1e4 ? 3 : 2) + ' km/s';
export const ms = v => (v >= 1e4 ? (v / 1e3).toFixed(2) + ' km/s' : Math.round(v) + ' m/s');
export const deg = (r, d = 1) => (r / D).toFixed(d) + '°';
export function dur(s) {
  if (!isFinite(s)) return '∞';
  if (s < 120) return s.toFixed(0) + ' s';
  if (s < 3 * 3600) return (s / 60).toFixed(1) + ' min';
  if (s < 3 * 86400) return (s / 3600).toFixed(2) + ' h';
  if (s < 3 * 365.25 * 86400) return (s / 86400).toFixed(1) + ' days';
  return (s / (365.25 * 86400)).toFixed(2) + ' years';
}
export const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

// ---- the orbit controls shared by both tabs that show this orbit ----
// returns { el, sync() }; sync repaints the sliders after the orbit changed elsewhere (a preset, another tab)
export function orbitControls({ onChange, angles = ['i', 'raan', 'argp', 'nu'], title = 'Orbit' }) {
  const S = orbit, sec = section(title), presetSec = section('Examples');
  const B = () => O.body(S.body);
  const fire = () => { S.preset = ''; onChange(); };
  let sl = {};
  const build = () => {
    const shapeSeg = h('div', { class: 'seg seg-wrap', role: 'tablist' });
    for (const [v, l] of [['alt', 'Periapsis & apoapsis'], ['ae', 'a & e']]) {
      const b = h('button', { type: 'button', class: S.shape === v ? 'on' : '' }, l);
      b.addEventListener('click', () => { S.shape = v; build(); });
      shapeSeg.append(b);
    }
    const maxAlt = S.body === 'sun' ? 3e8 : S.body === 'jupiter' ? 3e7 : 1e6;
    const lo = S.body === 'sun' ? 1e5 : 10;
    const body = field('Central body', select(Object.values(O.BODIES).map(b => ({ value: b.id, label: b.label })), S.body, v => {
      const b0 = B(), b1 = O.body(v), k = b1.R / b0.R; S.body = v; S.hp = Math.max(lo, S.hp * k); S.ha = Math.max(S.hp, S.ha * k); build(); fire();
    }), 'μ, radius, J2 and rotation rate of each body. Altitudes are kept in proportion to its radius when you switch.');
    sl = {};
    if (S.shape === 'alt') {
      sl.hp = slider({ label: 'Periapsis altitude (km)', min: lo, max: maxAlt, log: true, value: S.hp, format: v => fmtAlt(v), info: 'Lowest point above the surface (perigee for Earth, perilune for the Moon). Below about 150 km Earth\'s atmosphere brings a satellite down within days.', onInput: v => { S.hp = v; if (S.ha < v) { S.ha = v; sl.ha.set(v); } fire(); } });
      sl.ha = slider({ label: 'Apoapsis altitude (km)', min: lo, max: maxAlt, log: true, value: S.ha, format: v => fmtAlt(v), info: 'Highest point above the surface. Equal to the periapsis for a circular orbit.', onInput: v => { S.ha = v; if (S.hp > v) { S.hp = v; sl.hp.set(v); } fire(); } });
    } else {
      const el = elOf(S);
      sl.a = slider({ label: 'Semi-major axis a (km)', min: B().R / 1e3 + lo, max: B().R / 1e3 + maxAlt, log: true, value: el.a / 1e3, format: v => fmtAlt(v), info: 'Half the longest diameter of the ellipse. It alone fixes the period and the energy.', onInput: v => setAE(v * 1e3, elOf(S).e) });
      sl.e = slider({ label: 'Eccentricity e', min: 0, max: 0.97, step: 0.001, value: el.e, digits: 3, info: '0 is a circle; toward 1 the ellipse stretches into a long cigar. Periapsis r = a(1 − e), apoapsis a(1 + e).', onInput: v => setAE(elOf(S).a, v) });
    }
    const ang = {
      i: ['Inclination i (°)', 0, 180, 'Tilt of the orbit plane against the equator. Above 90° the orbit is retrograde (against the rotation of the body).'],
      raan: ['Right ascension of the ascending node Ω (°)', 0, 360, 'Where the orbit crosses the equator going north, measured east from the vernal equinox direction ♈ (on the ground track: the longitude of that crossing at the start).'],
      argp: ['Argument of periapsis ω (°)', 0, 360, 'Angle within the orbit plane from the ascending node to periapsis: which way the ellipse points.'],
      nu: ['True anomaly ν (°)', 0, 360, 'Where the satellite is now: the angle from periapsis to the satellite, seen from the centre of the body.'],
    };
    for (const k of angles) { const [l, a, b, tip] = ang[k]; sl[k] = slider({ label: l, min: a, max: b, step: 0.1, value: S[k], digits: 1, info: tip, onInput: v => { S[k] = v; k === 'nu' ? onChange('nu') : fire(); } }); }
    sec.body.replaceChildren(body, field('Set the size and shape by', shapeSeg), ...Object.values(sl).map(s => s.el));
  };
  const setAE = (a, e) => {
    const R = B().R, rp = a * (1 - e), ra = a * (1 + e);
    S.hp = Math.max(1, (rp - R) / 1e3); S.ha = Math.max(S.hp, (ra - R) / 1e3); fire();
  };
  const presets = h('div', { class: 'example-list' });
  for (const p of O.ORBIT_PRESETS) {
    const b = h('button', { type: 'button', title: p.note }, h('b', {}, p.label), ' · ', h('span', {}, p.short));
    b.addEventListener('click', () => { loadPreset(p.id); build(); onChange(); });
    presets.append(b);
  }
  presetSec.body.append(presets);
  build();
  return {
    el: h('div', {}, sec.el, presetSec.el),
    sync() { build(); },
    setNu(v) { if (sl.nu) sl.nu.set(v); },
  };
}
export const fmtAlt = v => (v >= 1e5 ? Math.round(v).toLocaleString('en-US') : v >= 100 ? v.toFixed(0) : v.toFixed(1));
