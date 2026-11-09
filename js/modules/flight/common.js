// Shared pieces for the Flight & Atmosphere module: display units, cards, metrics, insights.
// Everything is computed in SI; only what is shown changes. US aviation units (ft, kt) are the default.
import { h, info, segmented } from '../../lib/ui.js';
export { card, metricsGrid, insightsList } from '../compressible/common.js';

const KEY = 'pteronautics.flightUnits';
let sys = 'us';
try { const s = localStorage.getItem(KEY); if (s === 'us' || s === 'si') sys = s; } catch { /* storage blocked: keep the default */ }
const listeners = new Set();
export const units = () => sys;
export function setUnits(s) { sys = s; try { localStorage.setItem(KEY, s); } catch { /* not saved */ } for (const f of listeners) f(); }
export function onUnits(f) { listeners.add(f); return () => listeners.delete(f); }
export function unitsControl() {
  const seg = segmented([{ value: 'us', label: 'US (ft, kt)' }, { value: 'si', label: 'SI (m, m/s)' }], sys, v => setUnits(v));
  onUnits(() => seg.set(sys));
  return seg.el;
}

// k converts SI to display: shown = SI × k
const U = {
  alt: { us: { k: 1 / 0.3048, u: 'ft', d: 0 }, si: { k: 1, u: 'm', d: 0 } },
  len: { us: { k: 1 / 0.3048, u: 'ft', d: 1 }, si: { k: 1, u: 'm', d: 1 } },
  speed: { us: { k: 1 / 0.514444, u: 'kt', d: 1 }, si: { k: 1, u: 'm/s', d: 1 } },
  gust: { us: { k: 1 / 0.3048, u: 'ft/s', d: 2 }, si: { k: 1, u: 'm/s', d: 2 } },
  press: { us: { k: 1 / 3386.389, u: 'inHg', d: 3 }, si: { k: 0.01, u: 'hPa', d: 2 } },
  q: { us: { k: 1 / 47.880259, u: 'lbf/ft²', d: 1 }, si: { k: 0.001, u: 'kPa', d: 3 } },
  rho: { us: { k: 1 / 515.3788, u: 'slug/ft³', d: 6 }, si: { k: 1, u: 'kg/m³', d: 4 } },
  mu: { us: { k: 1 / 47.880259, u: 'lbf·s/ft²', d: 9 }, si: { k: 1, u: 'Pa·s', d: 8 } },
  nu: { us: { k: 1 / 0.09290304, u: 'ft²/s', d: 7 }, si: { k: 1, u: 'm²/s', d: 7 } },
  accel: { us: { k: 1 / 0.3048, u: 'ft/s²', d: 3 }, si: { k: 1, u: 'm/s²', d: 4 } },
  re1: { us: { k: 0.3048, u: '/ft', d: 0 }, si: { k: 1, u: '/m', d: 0 } },
};
export const unit = key => U[key][sys];
export const toDisp = (key, v) => v * U[key][sys].k;
export const fromDisp = (key, v) => v / U[key][sys].k;
// Altitude axes on plots: thousands of feet or kilometres (keeps tick labels short)
export const altAxis = { k: z => z * U.alt[sys].k / 1000, label: () => (sys === 'us' ? 'Altitude (1,000 ft)' : 'Altitude (km)'), fmt: v => (sys === 'us' ? `${(v * 1000).toFixed(0)} ft` : `${(v * 1000).toFixed(0)} m`) };

// Number formatting: fixed digits, scientific for very large/small values, thousands separators for big ones
export function num(v, d = 3) {
  if (v === undefined || v === null || !isFinite(v)) return '—';
  if (d === 0 || Math.abs(v) < 1e-12) v = d === 0 ? Math.round(v) + 0 : 0;
  const a = Math.abs(v);
  if (a !== 0 && (a < 10 ** -Math.min(d, 3) || a >= 1e7)) return v.toExponential(Math.max(2, Math.min(d, 4)));
  if (a >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: Math.min(d, a >= 1e4 ? 0 : 1) });
  return (+v).toFixed(d);
}
export function show(key, v, d) { const c = U[key][sys]; return `${num(v * c.k, d ?? c.d)} ${c.u}`; }
export const tempC = T => `${(T - 273.15).toFixed(1)} °C`;
export const tempF = T => `${((T - 273.15) * 9 / 5 + 32).toFixed(1)} °F`;
export const temp = T => `${T.toFixed(2)} K · ${sys === 'us' ? tempF(T) : tempC(T)}`;
export const pressBoth = p => (sys === 'us' ? `${(p / 3386.389).toFixed(2)} inHg · ${(p / 6894.757).toFixed(3)} psi` : `${(p / 100).toFixed(1)} hPa · ${(p / 1000).toFixed(3)} kPa`);

// Readout rows (key: value) in a compact grid
export function resRows(rows) {
  return h('div', { class: 'cf-res' }, ...rows.map(([k, v, hl, tip]) => h('div', { class: 'r' + (hl ? ' hl' : '') }, h('span', {}, k, tip ? info(tip) : null), h('span', {}, v))));
}

// Canvas that keeps its backing store matched to its CSS size; draw(ctx, W, H) is called on resize and theme change
export function canvasBox(height, draw, cls = '') {
  const wrap = h('div', { class: 'flt-canvas ' + cls, style: { height } });
  const c = h('canvas'); wrap.append(c);
  const ctx = c.getContext('2d');
  const paint = () => {
    const W = wrap.clientWidth, H = wrap.clientHeight, dpr = Math.min(devicePixelRatio || 1, 2);
    if (!W || !H) return;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    draw(ctx, W, H);
  };
  new ResizeObserver(paint).observe(wrap);
  addEventListener('themechange', paint);
  return { el: wrap, canvas: c, paint };
}
