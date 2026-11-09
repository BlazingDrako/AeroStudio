// Shared state for the Wings & 3D Aero module: one wing and one flight condition that every tab reads and edits,
// the linear vortex-lattice solution at that condition, and the controls that edit them.
import { h, section, select, field, segmented, fmtSI } from '../../lib/ui.js';
import * as Wg from '../../solvers/wing.js';
import { atmosphere } from '../../solvers/atmosphere.js';
import { bound, put } from '../propulsion/common.js';
export { bound, boundToggle, boundSelect, boundSeg, metricsGrid, insightsList, card, put, resultRows, canvasBox } from '../propulsion/common.js';

export const D = Math.PI / 180;
export const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

// flight conditions that suit each preset (true airspeed m/s, altitude m, angle of attack deg)
export const COND = {
  rect: { V: 40, alt: 0, alpha: 5 }, ellip: { V: 40, alt: 0, alpha: 5 }, taper: { V: 40, alt: 0, alpha: 5 }, swept: { V: 60, alt: 0, alpha: 5 },
  fsw: { V: 60, alt: 0, alpha: 5 }, delta: { V: 80, alt: 0, alpha: 8 },
  c172: { V: 55, alt: 1500, alpha: 4 }, glider: { V: 30, alt: 1000, alpha: 5 }, a320: { V: 230, alt: 11000, alpha: 3.6 },
  cca: { V: 200, alt: 9000, alpha: 3 }, f16: { V: 240, alt: 9000, alpha: 3 },
};
export const WING0 = (() => { const w = Wg.defaults(); Wg.applyPreset(w, 'c172'); return JSON.parse(JSON.stringify(w)); })();
export const COND0 = { ...COND.c172, ground: false, hb: 0.15 };

export const store = { W: JSON.parse(JSON.stringify(WING0)), C: { ...COND0 }, sol: null, ll: null, err: null, ver: 0, subs: new Set() };

// the flight condition: air, Mach number, Reynolds numbers at root and tip
export function air(C = store.C, W = store.W) {
  const a = atmosphere(C.alt), P = Wg.planform(W);
  const M = C.V / a.a, q = 0.5 * a.rho * C.V * C.V;
  const Re = c => a.rho * C.V * c / a.mu;
  return { atm: a, M, Mc: Math.min(M, 0.85), q, Re, ReRoot: Re(P.cr), ReTip: Re(Math.max(P.ct, P.cr * 0.05)), ReMac: Re(P.mac), P };
}
export const groundH = (C = store.C, W = store.W) => C.ground ? C.hb * Wg.planform(W).b : null;

export function recompute() {
  const t0 = performance.now();
  try {
    const A = air();
    store.sol = Wg.analyze(store.W, { alpha: store.C.alpha, M: A.Mc, ground: groundH() });
    store.ll = Wg.liftingLine(store.W, { alpha: store.C.alpha });
    store.air = A; store.err = null;
  } catch (e) { console.error(e); store.err = e; }
  store.ms = performance.now() - t0;
  store.ver++;
  for (const f of store.subs) f();
}
let pending = false;
export function schedule() { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; recompute(); }); }

export function loadPreset(id) {
  Wg.applyPreset(store.W, id);
  Object.assign(store.C, COND[id] || {});
}
export const preset = () => Wg.PRESETS.find(p => p.id === store.W.preset);

// ---- formatting ----
export const fmt = (v, d = 3) => isFinite(v) ? (+v).toFixed(d) : '—';
export const pct = (v, d = 1) => isFinite(v) ? (v > 0 ? '+' : '') + (v * 100).toFixed(d) + '%' : '—';
export const force = N => !isFinite(N) ? '—' : Math.abs(N) >= 1e6 ? (N / 1e6).toFixed(2) + ' MN' : Math.abs(N) >= 1e4 ? (N / 1e3).toFixed(1) + ' kN' : Math.round(N) + ' N';
export const moment = Nm => !isFinite(Nm) ? '—' : Math.abs(Nm) >= 1e6 ? (Nm / 1e6).toFixed(2) + ' MN·m' : Math.abs(Nm) >= 1e3 ? (Nm / 1e3).toFixed(1) + ' kN·m' : Math.round(Nm) + ' N·m';
export const len = m => m < 1 ? (m * 100).toFixed(1) + ' cm' : m.toFixed(2) + ' m';
export const kt = V => Math.round(V / 0.514444) + ' kn';
export const reStr = Re => fmtSI(Re).replace(/\s/g, '');

export const AIRFOILS = ['0004', '0005', '0006', '0009', '0012', '0015', '2404', '2410', '2412', '2414', '2415', '4412', '4415', '6412'];

// ---- controls ----
// onChange(kind): 'geom' when the wing changed, 'cond' when only the condition did
export function wingSection(onChange, { title = 'Wing' } = {}) {
  const W = store.W, sec = section(title);
  const mark = () => { W.preset = ''; presetSel.value = ''; };
  const groups = [...new Set(Wg.PRESETS.map(p => p.group))];
  const presetSel = select([{ value: '', label: 'Custom wing' }, ...groups.map(g => ({ group: g, items: Wg.PRESETS.filter(p => p.group === g).map(p => ({ value: p.id, label: p.label })) }))],
    W.preset || '', v => { if (!v) return; loadPreset(v); onChange('preset'); });
  const g = () => onChange('geom');
  const shape = segmented([{ value: 'trapezoid', label: 'Straight-tapered' }, { value: 'elliptic', label: 'Elliptic' }], W.shape, v => { W.shape = v; mark(); onChange('preset'); });
  shape.el.classList.add('seg-wrap');
  const foil = (key, label) => field(label, select(AIRFOILS.map(c => ({ value: c, label: 'NACA ' + c })).concat(AIRFOILS.includes(W[key]) ? [] : [{ value: W[key], label: 'NACA ' + W[key] }]), W[key], v => { W[key] = v; mark(); g(); }),
    'Sets the zero-lift angle (thin-airfoil theory) and, in the Stall tab, the section polar. The lattice itself is a thin lifting surface, so thickness only enters through the polars.');
  const p = Wg.planform(W), hint = h('div', { class: 'hint' });
  put(sec.body,
    field('Preset', presetSel, preset() ? preset().note : 'Your own wing. Pick a preset to start from a textbook wing or one of the five aircraft from Flight & Atmosphere.'),
    field('Planform', shape.el),
    bound(W, 'S', 'Area S', 0.5, 600, { log: true, digits: 1, unit: 'm²', onInput: () => { mark(); g(); }, tip: 'Reference area: the planform carried through the fuselage. The shape of the results does not depend on it; forces do.' }),
    bound(W, 'AR', 'Aspect ratio b²/S', 1, 30, { log: true, digits: 2, onInput: () => { mark(); g(); }, tip: 'Span squared over area. The single biggest lever on induced drag: CDi = CL²/(π·AR·e).' }),
    W.shape === 'elliptic' ? null : bound(W, 'taper', 'Taper ratio λ = ct/cr', 0, 1, { step: 0.01, digits: 2, onInput: () => { mark(); g(); }, tip: 'Tip chord over root chord. Around 0.35–0.45 an untwisted straight wing loads almost elliptically; lower tapers overload the tips.' }),
    bound(W, 'sweep', 'Quarter-chord sweep Λ', -40, 60, { step: 0.5, digits: 1, unit: '°', onInput: () => { mark(); g(); }, tip: `Positive is swept back. Leading-edge sweep here: ${p.sweepLE.toFixed(1)}°.` }),
    bound(W, 'twist', 'Twist at the tip', -10, 5, { step: 0.1, digits: 1, unit: '°', onInput: () => { mark(); g(); }, tip: 'Tip incidence relative to the root, varying linearly. Negative is washout: the tips meet the air at a smaller angle, which unloads them and delays tip stall.' }),
    bound(W, 'dihedral', 'Dihedral Γ', -10, 15, { step: 0.1, digits: 1, unit: '°', onInput: () => { mark(); g(); }, tip: 'Upward tilt of each half-wing. Mainly a roll-stability device; it tilts the lift inward by cos Γ and changes the lift a little.' }),
    foil('root', 'Root section'), foil('tip', 'Tip section'), hint);
  const update = () => { const q = Wg.planform(W); hint.textContent = `Span ${len(q.b)}, root chord ${len(q.cr)}, tip chord ${len(q.ct)}, MAC ${len(q.mac)}, leading-edge sweep ${q.sweepLE.toFixed(1)}°.`; };
  update();
  return { el: sec.el, update };
}

export function flightSection(onChange, { alpha = true, alphaRange = [-6, 20] } = {}) {
  const C = store.C, sec = section('Flight condition'), hint = h('div', { class: 'hint' });
  let aEl = null;
  put(sec.body,
    alpha ? aEl = bound(C, 'alpha', 'Angle of attack α', alphaRange[0], alphaRange[1], { step: 0.1, digits: 1, unit: '°', onInput: () => onChange('cond'), tip: 'Measured from the root chord. The linear lattice keeps going past the stall; the Stall tab follows the section polars.' }) : null,
    bound(C, 'V', 'True airspeed V', 5, 320, { log: true, digits: 0, unit: 'm/s', onInput: () => onChange('cond'), tip: 'Sets the Mach number (compressibility by Göthert\'s rule), the Reynolds numbers and the forces.' }),
    bound(C, 'alt', 'Altitude', 0, 15000, { step: 50, digits: 0, unit: 'm', onInput: () => onChange('cond'), tip: 'US Standard Atmosphere: density, speed of sound and viscosity.' }),
    hint);
  const update = () => { const A = air(); hint.textContent = `${kt(C.V)} · Mach ${A.M.toFixed(3)}${A.M > 0.85 ? ' (held at 0.85: linear theory fails near the speed of sound)' : ''} · q ${(A.q / 1000).toFixed(2)} kPa · Re ${reStr(A.ReRoot)} root, ${reStr(A.ReTip)} tip.`; };
  update();
  return { el: sec.el, update, alpha: aEl };
}
