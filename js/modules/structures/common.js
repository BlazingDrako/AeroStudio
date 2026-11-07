// Shared UI helpers for the Structures module: unit-aware numeric inputs and small layout pieces.
import { h, info, parseNum, select } from '../../lib/ui.js';
import { units, fmtNum } from '../../solvers/units.js';
export { fmtNum, units };
export { card, metricsGrid, insightsList } from '../compressible/common.js';

// A labelled numeric input in the current unit system. q = unit quantity key (or null for plain numbers).
// get() returns the SI value, set(v) receives the SI value.
export function numField(label, q, get, set, { tip, digits = 5, suffix, hint, min, max } = {}) {
  const inp = h('input', { class: 'num-input st-num', type: 'text', inputmode: 'decimal', 'aria-label': label });
  const show = () => { const v = get(); inp.value = isFinite(v) ? fmtNum(q ? units.fromSI(q, v) : v, digits) : ''; };
  const commit = () => {
    let v = parseNum(inp.value.replace(/[^\d.eE+\-kKmM,]/g, ''));
    if (!isFinite(v)) { show(); return; }
    if (q) v = units.toSI(q, v);
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    set(v); show();
  };
  inp.addEventListener('change', commit);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { commit(); inp.blur(); } });
  show();
  const unit = q ? units.label(q) : suffix || '';
  const el = h('label', { class: 'st-field' }, h('span', { class: 'st-lab' }, label, tip ? info(tip) : null), h('span', { class: 'st-in' }, inp, unit ? h('span', { class: 'st-unit' }, unit) : null));
  if (hint) el.append(h('div', { class: 'hint' }, hint));
  el.refresh = show;
  return el;
}

export function selField(label, options, value, onChange, tip) {
  const s = select(options, value, onChange);
  return h('label', { class: 'st-field st-field-sel' }, h('span', { class: 'st-lab' }, label, tip ? info(tip) : null), s);
}

export function segField(label, options, value, onChange, tip) {
  const el = h('div', { class: 'seg seg-wrap st-seg' });
  const btns = options.map(o => {
    const b = h('button', { type: 'button', title: o.title || '' }, o.label);
    b.addEventListener('click', () => { set(o.value); onChange(o.value); });
    el.append(b); return [o.value, b];
  });
  const set = v => btns.forEach(([ov, b]) => b.classList.toggle('on', ov === v));
  set(value);
  const wrap = h('div', { class: 'st-block' }, label ? h('div', { class: 'st-lab' }, label, tip ? info(tip) : null) : null, el);
  wrap.set = set;
  return wrap;
}

export function checkField(label, checked, onChange, tip) {
  const inp = h('input', { type: 'checkbox' }); inp.checked = !!checked;
  inp.addEventListener('change', () => onChange(inp.checked));
  return h('label', { class: 'toggle' }, h('span', { class: 'tl' }, label, tip ? info(tip) : null), inp, h('span', { class: 'sw' }));
}

export function table(head, rows, { cls = '' } = {}) {
  return h('div', { class: 'table-wrap' }, h('table', { class: 'data ' + cls },
    h('thead', {}, h('tr', {}, ...head.map((x, i) => h('th', { style: i === 0 ? { textAlign: 'left' } : null }, x)))),
    h('tbody', {}, ...rows.map(r => h('tr', { class: r.cls || '' }, ...(r.cells || r).map((c, i) => h('td', { style: i === 0 ? { textAlign: 'left', fontFamily: 'var(--font)' } : null }, c)))))));
}

export function toCSV(head, rows) {
  const esc = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [head, ...rows.map(r => r.cells || r)].map(r => r.map(esc).join(',')).join('\n');
}
