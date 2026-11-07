// Small UI toolkit shared by all modules: sliders, toggles, selects, sections, info tips.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

// ---- tooltips ----
let tipEl = null;
function showTip(target, html) {
  if (!tipEl) { tipEl = h('div', { class: 'tip' }); document.body.append(tipEl); }
  tipEl.innerHTML = html; tipEl.style.display = 'block';
  const r = target.getBoundingClientRect(), tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
  let x = r.right + 8, y = r.top - 4;
  if (x + tw > innerWidth - 8) x = Math.max(8, r.left - tw - 8);
  if (y + th > innerHeight - 8) y = innerHeight - th - 8;
  tipEl.style.left = x + 'px'; tipEl.style.top = Math.max(8, y) + 'px';
}
function hideTip() { if (tipEl) tipEl.style.display = 'none'; }
export function info(html) {
  const el = h('span', { class: 'info', tabindex: 0, 'aria-label': 'More info' }, 'i');
  el.addEventListener('mouseenter', () => showTip(el, html));
  el.addEventListener('focus', () => showTip(el, html));
  el.addEventListener('mouseleave', hideTip);
  el.addEventListener('blur', hideTip);
  return el;
}

// ---- section ----
export function section(title, { collapsible = false, collapsed = false, right = null } = {}) {
  const body = h('div', { class: 'section-body' });
  const head = h('div', { class: 'section-head' }, h('h3', {}, title),
    h('div', { class: 'row' }, right, collapsible ? h('span', { class: 'chev', html: chevron }) : null));
  const el = h('div', { class: 'section' + (collapsible ? ' collapsible' : '') + (collapsed ? ' collapsed' : '') }, head, body);
  if (collapsible) head.addEventListener('click', e => { if (e.target.closest('button,input,select')) return; el.classList.toggle('collapsed'); });
  return { el, body };
}
const chevron = '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 4.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>';

// ---- slider with numeric entry ----
// opts: {label, min, max, step, value, log, format, unit, info, onInput(v), onChange(v), digits}
export function slider(opts) {
  const { min, max, log = false } = opts;
  const step = opts.step ?? (max - min) / 200;
  const toPos = v => log ? (Math.log10(v) - Math.log10(min)) / (Math.log10(max) - Math.log10(min)) * 1000 : v;
  const fromPos = p => log ? 10 ** (Math.log10(min) + (p / 1000) * (Math.log10(max) - Math.log10(min))) : p;
  const range = h('input', { type: 'range', min: log ? 0 : min, max: log ? 1000 : max, step: log ? 1 : step, 'aria-label': opts.label });
  const fmt = opts.format || (v => (+v).toFixed(opts.digits ?? 2));
  const num = h('input', { class: 'num-input', type: 'text', inputmode: 'decimal', 'aria-label': opts.label + ' value' });
  let value = opts.value;
  const paint = () => {
    const p = log ? range.value / 10 : (range.value - min) / (max - min) * 100;
    range.style.setProperty('--fill', p + '%');
  };
  const set = (v, fire = false, final = false) => {
    if (!isFinite(v)) return;
    value = v;
    range.value = toPos(Math.min(Math.max(v, min), max));
    if (document.activeElement !== num) num.value = fmt(v);
    paint();
    if (fire) { opts.onInput && opts.onInput(v); if (final) opts.onChange && opts.onChange(v); }
  };
  range.addEventListener('input', () => {
    let v = fromPos(+range.value);
    if (log) { const e = 10 ** Math.floor(Math.log10(v)); v = Math.round(v / e * 100) / 100 * e; }
    set(v, true);
  });
  range.addEventListener('change', () => opts.onChange && opts.onChange(value));
  const commit = () => {
    const v = parseNum(num.value);
    if (isFinite(v)) set(v, true, true); else num.value = fmt(value);
  };
  num.addEventListener('change', commit);
  num.addEventListener('keydown', e => { if (e.key === 'Enter') { commit(); num.blur(); } });
  num.addEventListener('blur', () => { num.value = fmt(value); });
  const label = h('span', { class: 'field-label' }, opts.label, opts.info ? info(opts.info) : null);
  const el = h('div', { class: 'field' }, h('div', { class: 'field-top' }, label, num), range,
    opts.hint ? h('div', { class: 'hint' }, opts.hint) : null);
  set(value);
  return { el, set: v => set(v), get: () => value, range, num };
}

export function parseNum(s) {
  s = String(s).trim().replace(/,/g, '');
  const m = s.match(/^([-+]?[\d.]+(?:e[-+]?\d+)?)\s*([kKmM]?)$/);
  if (!m) return NaN;
  let v = parseFloat(m[1]);
  if (m[2] === 'k' || m[2] === 'K') v *= 1e3;
  if (m[2] === 'm' || m[2] === 'M') v *= 1e6;
  return v;
}

export function fmtSI(v) {
  if (!isFinite(v)) return '—';
  if (Math.abs(v) >= 1e6) { const s = (v / 1e6).toFixed(v >= 1e7 ? 0 : 2); return (s.includes('.') ? s.replace(/\.?0+$/, '') : s) + 'M'; }
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(0) + 'k';
  return String(v);
}

// ---- segmented control ----
export function segmented(options, value, onChange) {
  const el = h('div', { class: 'seg', role: 'tablist' });
  const btns = options.map(o => {
    const b = h('button', { type: 'button', role: 'tab', title: o.title || '' }, o.label);
    b.addEventListener('click', () => { set(o.value); onChange(o.value); });
    el.append(b);
    return [o.value, b];
  });
  const set = v => { for (const [ov, b] of btns) { b.classList.toggle('on', ov === v); b.setAttribute('aria-selected', ov === v); } };
  set(value);
  return { el, set };
}

// ---- toggle switch ----
export function toggle(label, checked, onChange, { swatch = null, tip = null } = {}) {
  const input = h('input', { type: 'checkbox' });
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  const el = h('label', { class: 'toggle' },
    h('span', { class: 'tl' }, swatch ? h('span', { class: 'swatch', style: { background: swatch } }) : null, label, tip ? info(tip) : null),
    input, h('span', { class: 'sw' }));
  return { el, set: v => { input.checked = v; }, get: () => input.checked };
}

export function select(options, value, onChange, attrs = {}) {
  const el = h('select', { class: 'select', ...attrs });
  for (const o of options) {
    if (o.group) {
      const g = h('optgroup', { label: o.group });
      for (const x of o.items) g.append(h('option', { value: x.value }, x.label));
      el.append(g);
    } else el.append(h('option', { value: o.value }, o.label));
  }
  el.value = value;
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

export function field(label, control, tip, hint) {
  return h('div', { class: 'field' },
    h('div', { class: 'field-top' }, h('span', { class: 'field-label' }, label, tip ? info(tip) : null)),
    control, hint ? h('div', { class: 'hint' }, hint) : null);
}

export function icon(name, size = 18) {
  const paths = {
    airfoil: '<path d="M2 12c3-4.5 9-5.5 20-1-6 2.2-13 3.5-20 1z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M1 7h5M1 17h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity=".5"/>',
    home: '<path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
    shock: '<path d="M3 12h7M14 12h7M10 5l4 7-4 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    flame: '<path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-3.5 2.5-5 .5 2 1.5 2.5 2.5 2.5C12 8 11 6 12 3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
    nozzle: '<path d="M3 7h6l4 3h0l8-5v14l-8-5-4 3H3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
    beam: '<path d="M3 9h18v4H3zM6 13v6M18 13v6M2 19h20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
    target: '<circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    globe: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><ellipse cx="12" cy="12" rx="11" ry="4" fill="none" stroke="currentColor" stroke-width="1.3" transform="rotate(-20 12 12)"/>',
    wind: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    sun: '<circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
    plane: '<path d="M21 15l-8-4V5a1 1 0 0 0-2 0v6l-8 4v2l8-2v4l-2 1.5V22l3-1 3 1v-1.5L13 19v-4l8 2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
    book: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 0 4 20.5zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5a1.5 1.5 0 0 1 1.5 1.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M6.5 8h2.5M15 8h2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
    star: '<path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
    balance: '<path d="M12 4v16M7 20h10M4 8h16M6.5 8L4 14a2.8 2.8 0 0 0 5 0zM17.5 8L15 14a2.8 2.8 0 0 0 5 0z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>',
    wave: '<path d="M2 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0 1.5 3 2 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    thermo: '<path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 9v7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    wing: '<path d="M12 3v18M12 7.5L2.5 14v2l9.5-3 9.5 3v-2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/><path d="M9.5 20h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    rotor: '<circle cx="12" cy="12" r="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 10c-1.2-3-1.2-5.8.3-7 1.4 1.2 1.4 4 .4 7M13.8 12.9c3.2-.4 5.8.6 6.4 2.4-1.7.7-4.4-.4-6.6-2.4M10.3 13c-1.9 2.6-4.2 4-6 3.5.2-1.8 2.4-3.6 5.4-4.1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>',
    crack: '<rect x="4" y="4" width="16" height="16" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4 12l3.5-1.5 2 2 3-2.5 2 2 2-1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>',
    rocket: '<path d="M12 2.5c2.8 2.3 3.8 5.5 3.8 9.5v5H8.2v-5c0-4 1-7.2 3.8-9.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="9.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8.2 13l-3 3v3l3-1.8M15.8 13l3 3v3l-3-1.8M10.5 19.5L12 22l1.5-2.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>',
    satellite: '<rect x="9" y="9" width="6" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M2 9.5h5v5H2zM17 9.5h5v5h-5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M7 12h2M15 12h2M12 9V5.5M10 5h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
    design: '<path d="M4 20V4l16 16z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 16v-4.5l4.5 4.5z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M4 8h2M4 12h1.5M4 16h2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3.1-3.1a4 4 0 0 0-5.7-5.7L12 6.3M14 10a4 4 0 0 0-5.7 0l-3.1 3.1a4 4 0 0 0 5.7 5.7l1.1-1.1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    upload: '<path d="M12 15V4m0 0l-4 4m4-4l4 4M5 19h14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    print: '<path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M7 14h10v6H7z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
    search: '<circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    send: '<path d="M7 17L17 7M9 7h8v8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
    play: '<path d="M8 5v14l11-7z" fill="currentColor"/>',
    pause: '<path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor"/>',
    reset: '<path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    download: '<path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  };
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.innerHTML = paths[name] || '';
  return s;
}

export function cssVar(name, el = document.documentElement) { return getComputedStyle(el).getPropertyValue(name).trim(); }

export function hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function downloadText(filename, text, type = 'text/csv') {
  const blob = new Blob([text], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
