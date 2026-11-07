// Shared UI pieces for the Shocks & Nozzles module.
import { h, info, select, field } from '../../lib/ui.js';
import { GASES } from '../../solvers/gasdyn.js';

export const fmt = (v, d = 4) => {
  if (v === undefined || v === null || !isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(3);
  return (+v).toFixed(d);
};
export const fmtDeg = r => (isFinite(r) ? (r * 180 / Math.PI).toFixed(3) + '°' : '—');

// Gas picker: preset list + custom γ / R
export function gasPicker(state, onChange) {
  const opts = [...GASES.map(g => ({ value: g.id, label: `${g.label} (γ=${+g.g.toFixed(3)})` })), { value: 'custom', label: 'Custom γ, R…' }];
  const gIn = h('input', { class: 'num-input', value: state.g, style: { width: '64px' }, 'aria-label': 'gamma' });
  const rIn = h('input', { class: 'num-input', value: state.R, style: { width: '74px' }, 'aria-label': 'gas constant' });
  const custom = h('div', { class: 'row', style: { marginTop: '6px', display: 'none' } }, h('span', { class: 'hint', style: { margin: 0 } }, 'γ'), gIn, h('span', { class: 'hint', style: { margin: 0 } }, 'R J/kg·K'), rIn);
  const sel = select(opts, state.gas || 'air', v => {
    custom.style.display = v === 'custom' ? '' : 'none';
    if (v !== 'custom') { const gs = GASES.find(x => x.id === v); state.g = gs.g; state.R = gs.R; gIn.value = +gs.g.toFixed(4); rIn.value = gs.R; }
    state.gas = v; onChange();
  });
  const upd = () => { const g = parseFloat(gIn.value), R = parseFloat(rIn.value); if (g > 1 && g < 3) state.g = g; if (R > 0) state.R = R; onChange(); };
  gIn.addEventListener('change', upd); rIn.addEventListener('change', upd);
  return field('Gas', h('div', {}, sel, custom), 'Ratio of specific heats γ = cp/cv and gas constant R. Air ≈ 1.4; hot rocket exhaust ≈ 1.15–1.25; monatomic gases (He, Ar) = 5/3.');
}

export function metricsGrid() {
  const el = h('div', { class: 'metrics cf-metrics' });
  return {
    el,
    set(list) {
      el.replaceChildren(...list.map(m => h('div', { class: 'metric' + (m.cls ? ' ' + m.cls : '') },
        h('div', { class: 'k' }, m.k, m.tip ? info(m.tip) : null), h('div', { class: 'v', title: String(m.v) }, m.v), h('div', { class: 's' }, m.s || ''))));
    },
  };
}

export function insightsList(el, list) {
  const icons = { i: 'i', w: '!', b: '×', g: '✓' };
  el.replaceChildren(...list.map(x => h('div', { class: 'insight' }, h('div', { class: 'ic ' + x.type }, icons[x.type] || 'i'),
    h('div', {}, h('div', { class: 't' }, x.t), h('div', { class: 'd', html: x.d })))));
}

// Region table: states relative to freestream; dimensional columns if ref {p (Pa), T (K), R, g, M}
export function regionTable(regions, ref, names = { p: 'p/p∞', T: 'T/T∞', rho: 'ρ/ρ∞', p0: 'p₀/p₀∞' }) {
  const dim = ref && ref.p > 0 && ref.T > 0;
  const head = ['Region', 'M', 'θ', names.p, names.T, names.rho, names.p0];
  if (dim) head.push('p kPa', 'T K', 'V m/s');
  const rows = regions.map(r => {
    const s = r.s, cells = [r.name, fmt(s.M), isFinite(s.th) ? (s.th * 180 / Math.PI).toFixed(2) + '°' : '—', fmt(s.p), fmt(s.T), fmt(s.rho), fmt(s.p0)];
    if (dim) { const T = s.T * ref.T; cells.push(fmt(s.p * ref.p / 1000, 3), fmt(T, 1), fmt(s.M * Math.sqrt(ref.g * ref.R * T), 1)); }
    return h('tr', {}, ...cells.map((c, i) => h('td', { style: i === 0 ? { textAlign: 'left', fontFamily: 'var(--font)' } : null }, c, i === 0 && r.note ? h('span', { class: 'hint', style: { marginLeft: '6px' } }, r.note) : null)));
  });
  return h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ...head.map((x, i) => h('th', { style: i === 0 ? { textAlign: 'left' } : null }, x)))), h('tbody', {}, ...rows)));
}

export function card(title, tip, ...children) {
  return h('div', { class: 'plot-card' }, h('div', { class: 'plot-head' }, h('h4', {}, title), tip ? info(tip) : null), ...children);
}

// layer toggles + quantity segmented for a FieldStage, placed in a floating panel on the stage
import { segmented, toggle } from '../../lib/ui.js';
export function stageLayers(stage, { quantities = ['M', 'p', 'T', 'p0', 'schlieren'], extra = [], initial = 'M', layers = {} } = {}) {
  const names = { M: 'Mach', p: 'p', T: 'T', rho: 'ρ', p0: 'p₀', schlieren: 'Schlieren', glow: 'Glow' };
  const head = h('button', { class: 'layers-head', type: 'button' }, h('h4', {}, 'View'), h('span', { class: 'chev', html: '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 4.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>' }));
  const body = h('div', { class: 'layers-body' });
  const box = h('div', { class: 'layers' }, head, body);
  head.addEventListener('click', () => box.classList.toggle('collapsed'));
  const q = segmented(quantities.map(v => ({ value: v, label: names[v] })), initial, v => stage.setQuantity(v));
  q.el.classList.add('seg-wrap');
  body.append(h('div', { style: { marginBottom: '6px' } }, q.el));
  const L = { field: true, particles: true, streamlines: false, waves: true, labels: true, contours: true, ...layers };
  stage.setLayers(L);
  const tips = { field: 'Color the flow by the selected quantity.', particles: 'Tracer particles moving at the local velocity.', streamlines: 'Lines everywhere tangent to the velocity.', waves: 'Shocks (thick), expansion-fan Mach waves (thin) and sonic lines.', labels: 'Text labels on the picture.', contours: 'Thin iso-lines of the colored quantity.' };
  for (const [k, lab] of [['field', 'Color field'], ['contours', 'Contour lines'], ['particles', 'Particles'], ['streamlines', 'Streamlines'], ['waves', 'Waves & shocks'], ['labels', 'Labels'], ...extra]) {
    body.append(toggle(lab, L[k], v => stage.setLayers({ [k]: v }), { tip: tips[k] }).el);
  }
  if (innerWidth < 1300) box.classList.add('collapsed');
  stage.stage.append(box);
  return { box, q };
}
