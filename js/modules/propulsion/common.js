// Shared UI helpers for the Jet Engine Cycles module.
import { h, slider, info, field, select, segmented, toggle } from '../../lib/ui.js';
export { fmt, metricsGrid, insightsList, card } from '../compressible/common.js';

export const shared = { cycle: null };
// append children, skipping null/false placeholders
export const put = (el, ...kids) => el.append(...kids.filter(Boolean));   // last cycle design, read by the trade-study tab

// Slider bound to obj[key]
export function bound(obj, key, label, min, max, { step, digits = 2, tip, log, hint, unit = '', scale = 1, onInput } = {}) {
  const s = slider({
    label: unit ? `${label} (${unit})` : label, min, max, step, log, digits, info: tip, hint,
    value: obj[key] / scale,
    onInput: v => { obj[key] = v * scale; onInput && onInput(v); },
  });
  // usable directly as a DOM node, or via .el like the other controls
  const el = s.el; el.el = el; el.set = v => s.set(v / scale); el.get = () => s.get() * scale;
  return el;
}
export function boundToggle(obj, key, label, onChange, tip) { const t = toggle(label, !!obj[key], v => { obj[key] = v; onChange(v); }, { tip }); t.el.el = t.el; t.el.set = t.set; return t.el; }
export function boundSelect(obj, key, label, options, onChange, tip) { return field(label, select(options, obj[key], v => { obj[key] = v; onChange(v); }), tip); }
export function boundSeg(obj, key, label, options, onChange, tip) { const s = segmented(options, obj[key], v => { obj[key] = v; onChange(v); }); s.el.classList.add('seg-wrap'); return field(label, s.el, tip); }

// Temperature color map (cool blue → red → yellow-white), t in [0,1]
const STOPS = [[0, [40, 90, 200]], [0.25, [60, 170, 220]], [0.45, [120, 200, 120]], [0.62, [240, 190, 60]], [0.8, [235, 90, 40]], [1, [255, 245, 200]]];
export function heat(t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < STOPS.length; i++) if (t <= STOPS[i][0]) {
    const [t0, c0] = STOPS[i - 1], [t1, c1] = STOPS[i], u = (t - t0) / (t1 - t0);
    return c0.map((c, k) => Math.round(c + u * (c1[k] - c)));
  }
  return STOPS[STOPS.length - 1][1];
}
export const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;

export function resultRows(el, rows) {
  el.replaceChildren(...rows.map(r => h('div', { class: 'r' + (r[2] ? ' hl' : '') }, h('span', {}, r[0], r[3] ? info(r[3]) : null), h('span', {}, r[1]))));
}

// Canvas helper with DPR scaling and resize redraw
export function canvasBox(cls = 'cf-chart', height) {
  const wrap = h('div', { class: cls }), cv = h('canvas');
  if (height) wrap.style.height = height;
  wrap.append(cv);
  const ctx = cv.getContext('2d');
  let drawFn = null;
  const fit = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2), W = wrap.clientWidth, H = wrap.clientHeight;
    if (!W || !H) return null;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); // every draw starts from a blank canvas
    return { W, H, g: ctx };
  };
  const draw = () => { const r = fit(); if (r && drawFn) drawFn(r); };
  new ResizeObserver(draw).observe(wrap);
  addEventListener('themechange', draw);
  return { el: wrap, cv, set(fn) { drawFn = fn; draw(); }, draw };
}

export const kPa = p => (p / 1000).toFixed(p < 1e4 ? 2 : 1);
export const deg = r => (r * 180 / Math.PI).toFixed(1) + '°';
