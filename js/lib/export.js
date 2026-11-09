// Exporting what's on screen: plots as PNG or CSV, visual views (stages, cut-aways, charts drawn on a canvas) as
// PNG, and a printable report of a module's inputs and results.
//
// Plots get their own export button (js/lib/plot.js). Views get one automatically: watchViews() looks for canvases
// added to the page and puts a small button on each canvas's container. A view is captured by drawing its canvases
// (2-D and WebGL alike) onto one image in their on-screen positions, plus its colour legend.
import { h, icon, cssVar, downloadText } from './ui.js';

const slug = s => String(s || 'export').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
const moduleName = () => document.title.replace(/\s*—\s*Pteronautics$/, '') || 'Pteronautics';
const fileBase = what => `Pteronautics ${slug(moduleName())} - ${slug(what)}`;

export function downloadCanvas(canvas, filename) {
  canvas.toBlob(b => {
    if (!b) return;
    const a = h('a', { href: URL.createObjectURL(b), download: filename });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
}

// nearest heading for a plot or view, used to name its file
export function titleFor(el) {
  const card = el.closest('.plot-card, .card, .cf-card, .fl-plotcard, section');
  const t = card && card.querySelector('h4, h3');
  return t ? t.firstChild?.textContent?.trim() || t.textContent.trim() : '';
}

// ---------- plots ----------
export function plotImage(plot, scale = 2) {
  const hover = plot.hover; plot.hover = null; plot.draw();
  const c = plot.canvas, out = document.createElement('canvas');
  const W = plot.wrap.clientWidth, H = plot.wrap.clientHeight;
  out.width = Math.round(W * scale); out.height = Math.round(H * scale);
  const g = out.getContext('2d');
  g.fillStyle = cssVar('--bg-elev') || '#fff'; g.fillRect(0, 0, out.width, out.height);
  g.drawImage(c, 0, 0, out.width, out.height);
  plot.hover = hover; plot.draw();
  return out;
}

export function plotCSV(plot) {
  const S = (plot.data.series || []).filter(s => s.x && s.y && s.x.length);
  const o = plot.opts, xn = o.xname || o.xlabel || 'x', yn = o.yname || o.ylabel || 'y';
  const q = v => `"${String(v).replace(/"/g, '""')}"`;
  const head = [], cols = [];
  S.forEach((s, i) => {
    const name = s.label || `series ${i + 1}`;
    head.push(q(`${name}: ${xn}`), q(`${name}: ${yn}`)); cols.push(s.x, s.y);
  });
  const n = Math.max(0, ...S.map(s => s.x.length)), rows = [head.join(',')];
  for (let i = 0; i < n; i++) rows.push(cols.map(c => (i < c.length && isFinite(c[i]) ? +(+c[i]).toPrecision(8) : '')).join(','));
  return rows.join('\n');
}

function menu(btn, items) {
  closeMenus();
  const m = h('div', { class: 'xp-menu', role: 'menu' });
  for (const [label, fn] of items) {
    const b = h('button', { type: 'button', role: 'menuitem' }, label);
    b.addEventListener('click', e => { e.stopPropagation(); closeMenus(); fn(); });
    m.append(b);
  }
  btn.parentElement.append(m);
  setTimeout(() => addEventListener('pointerdown', onAway, true), 0);
}
function onAway(e) { if (!e.target.closest('.xp-menu')) closeMenus(); }
function closeMenus() { for (const m of document.querySelectorAll('.xp-menu')) m.remove(); removeEventListener('pointerdown', onAway, true); }

export function plotExportButton(plot) {
  const b = h('button', { class: 'xp-btn', type: 'button', title: 'Export this plot', 'aria-label': 'Export this plot' }, icon('download', 14));
  b.addEventListener('click', e => {
    e.stopPropagation();
    const name = () => fileBase(titleFor(plot.wrap) || plot.opts.ylabel || 'plot');
    menu(b, [
      ['Image (PNG)', () => downloadCanvas(plotImage(plot), name() + '.png')],
      ['Data (CSV)', () => downloadText(name() + '.csv', plotCSV(plot))],
    ]);
  });
  return b;
}

// ---------- views ----------
const visible = el => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0; };

function drawLegend(g, lg, origin) {
  const r = lg.getBoundingClientRect(), x = r.left - origin.left, y = r.top - origin.top, cs = getComputedStyle(lg);
  g.save();
  g.fillStyle = cs.backgroundColor; g.strokeStyle = cs.borderTopColor; g.lineWidth = 1;
  g.beginPath(); g.roundRect ? g.roundRect(x, y, r.width, r.height, 8) : g.rect(x, y, r.width, r.height); g.fill(); g.stroke();
  for (const c of lg.querySelectorAll('canvas')) if (visible(c)) { const cr = c.getBoundingClientRect(); g.drawImage(c, cr.left - origin.left, cr.top - origin.top, cr.width, cr.height); }
  // text: every text node at its own position and style
  const walker = document.createTreeWalker(lg, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent.trim(); if (!t) continue;
    const range = document.createRange(); range.selectNodeContents(n);
    const tr = range.getBoundingClientRect(), es = getComputedStyle(n.parentElement);
    if (!tr.width) continue;
    g.font = `${es.fontWeight} ${es.fontSize} ${es.fontFamily}`; g.fillStyle = es.color; g.textBaseline = 'middle';
    g.fillText(t, tr.left - origin.left, tr.top - origin.top + tr.height / 2);
  }
  g.restore();
}

export function captureView(box, scale = 2) {
  const r = box.getBoundingClientRect(), W = Math.round(r.width), H = Math.round(r.height);
  const out = document.createElement('canvas'); out.width = W * scale; out.height = H * scale;
  const g = out.getContext('2d'); g.scale(scale, scale);
  const bg = getComputedStyle(box).backgroundColor;
  g.fillStyle = bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : cssVar('--bg-elev'); g.fillRect(0, 0, W, H);
  for (const c of box.querySelectorAll('canvas')) {
    if (c.closest('.legend, .layers, .xp-btn') || c.parentElement.__plot || !visible(c)) continue;
    const cr = c.getBoundingClientRect();
    try { g.drawImage(c, cr.left - r.left, cr.top - r.top, cr.width, cr.height); } catch { /* tainted or lost context */ }
  }
  for (const lg of box.querySelectorAll('.legend')) if (visible(lg)) drawLegend(g, lg, r);
  return out;
}

const isView = c => {
  const box = c.parentElement;
  if (!box || box.__plot || box.closest('.legend, .layers, .card-preview') || box.dataset.xp) return null;
  return box;
};

function addViewButton(box) {
  box.dataset.xp = '1';
  if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
  const b = h('button', { class: 'xp-btn xp-view', type: 'button', title: 'Save this view as an image', 'aria-label': 'Save this view as an image' }, icon('download', 14));
  b.addEventListener('click', e => {
    e.stopPropagation();
    // let the next frame render first so WebGL and animated canvases are captured mid-draw, not cleared
    requestAnimationFrame(() => downloadCanvas(captureView(box), fileBase(titleFor(box) || document.querySelector('.tabs button.on')?.textContent || 'view') + '.png'));
  });
  box.append(b);
}

// put an export button on every view (a canvas that isn't part of a plot) that appears inside root
export function watchViews(root) {
  const scan = () => { for (const c of root.querySelectorAll('canvas')) { const box = isView(c); if (box) addViewButton(box); } };
  let queued = false;
  const mo = new MutationObserver(() => { if (queued) return; queued = true; setTimeout(() => { queued = false; scan(); }, 60); });
  mo.observe(root, { childList: true, subtree: true });
  scan();
  return () => mo.disconnect();
}

// ---------- printable report ----------
const labelText = el => {
  if (!el) return '';
  const c = el.cloneNode(true); for (const x of c.querySelectorAll('.info')) x.remove();
  return c.textContent.replace(/\s+/g, ' ').trim();
};
const hiddenIn = (el, stop) => { for (let e = el; e && e !== stop; e = e.parentElement) if (e.style && e.style.display === 'none') return true; return false; };

// every input in a module's control panel, grouped by section: [{ title, rows: [[label, value]] }]
export function readInputs(panel) {
  const groups = [];
  const sections = panel.querySelectorAll('.section');
  for (const sec of sections.length ? sections : [panel]) {
    if (hiddenIn(sec, panel)) continue;
    const title = labelText(sec.querySelector('.section-head h3')) || '';
    const rows = [];
    for (const f of sec.querySelectorAll('.field, .toggle')) {
      if (hiddenIn(f, sec) || f.closest('.section') !== (sections.length ? sec : f.closest('.section'))) continue;
      if (f.classList.contains('toggle')) { const i = f.querySelector('input'); rows.push([labelText(f.querySelector('.tl')), i && i.checked ? 'On' : 'Off']); continue; }
      const label = labelText(f.querySelector(':scope > .field-top .field-label'));
      let value = '';
      const num = f.querySelector('.num-input'), sel = f.querySelector('select'), seg = f.querySelector('.seg button.on'), txt = f.querySelector('input.text-input');
      if (num) value = num.value;
      else if (sel) value = sel.selectedOptions[0]?.textContent || '';
      else if (seg) value = seg.textContent;
      else if (txt) value = txt.value;
      if (label && value && !/^Load an example|^Load a preset|^Examples$/i.test(value)) rows.push([label, value]);
    }
    if (rows.length) groups.push({ title, rows });
  }
  return groups;
}

// clone the results area with every plot and view turned into a picture and the controls taken out
function cloneResults(src) {
  const pics = new Map();
  for (const el of src.querySelectorAll('.plot, [data-xp]')) {
    if (!visible(el) || !(el.__plot || el.dataset.xp)) continue;
    try { pics.set(el, el.__plot ? plotImage(el.__plot).toDataURL('image/png') : captureView(el).toDataURL('image/png')); } catch (e) { console.warn(e); }
  }
  const mark = [...pics.keys()];
  mark.forEach((el, i) => { el.dataset.xpPic = i; });
  const copy = src.cloneNode(true);
  mark.forEach(el => { delete el.dataset.xpPic; });
  for (const el of copy.querySelectorAll('[data-xp-pic]')) {
    const img = h('img', { class: 'rp-pic', src: pics.get(mark[+el.dataset.xpPic]), alt: '' });
    el.replaceWith(img);
  }
  for (const el of copy.querySelectorAll('button, .layers, .stage-tools, .readout, .ptip, .xp-menu, input[type=range], input[type=file], .dropzone, .hint-overlay, canvas, .info, .tabs, .as-toolbar, .seg, .xp-btn')) el.remove();
  for (const s of copy.querySelectorAll('select')) s.replaceWith(h('span', { class: 'rp-sel' }, s.selectedOptions?.[0]?.textContent || ''));
  for (const i of copy.querySelectorAll('input')) i.replaceWith(h('span', {}, i.value));
  return copy.innerHTML;
}

export async function printReport({ title, controls, results }) {
  // pictures are drawn in the light theme for paper. The report window opens first as a solid cover in the
  // current colours, so the switch to light and back happens out of sight.
  const shell = reportShell(title);
  await new Promise(r => setTimeout(r, 40)); // let the cover paint
  const root = document.documentElement, prev = { theme: root.dataset.theme, resolved: root.dataset.resolvedTheme, skin: root.dataset.skin };
  const dark = prev.resolved === 'dark';
  if (dark) {
    delete root.dataset.skin; // a secret theme (HUD, Blueprint…) is drawn on dark mode, so it goes too
    root.dataset.theme = 'light'; root.dataset.resolvedTheme = 'light'; dispatchEvent(new Event('themechange'));
    await new Promise(r => setTimeout(r, 350));
  }
  let inputs = [], body = '';
  try {
    inputs = controls ? readInputs(controls) : [];
    body = results.map(cloneResults).join('');
  } finally {
    if (dark) {
      if (prev.theme) root.dataset.theme = prev.theme; else delete root.dataset.theme;
      if (prev.skin) root.dataset.skin = prev.skin;
      root.dataset.resolvedTheme = prev.resolved; dispatchEvent(new Event('themechange'));
    }
  }
  const tab = document.querySelector('.af-head .tabs button.on, .cf-head .tabs button.on')?.textContent || '';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const css = new URL('css/styles.css', location.href.split('#')[0]).href;
  const inputsHtml = inputs.map(g => `<div class="rp-group">${g.title ? `<h3>${esc(g.title)}</h3>` : ''}<table>${g.rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table></div>`).join('');
  const html = `<!doctype html><html data-theme="light" data-resolved-theme="light"><head><meta charset="utf-8">
<title>${esc(title)}${tab ? ' – ' + esc(tab) : ''} – Pteronautics report</title><link rel="stylesheet" href="${css}">
<style>
  body { background: #fff; color: #1a1d23; margin: 0; overflow: auto; height: auto; }
  .rp { max-width: 960px; margin: 0 auto; padding: 28px 32px 48px; }
  .rp-top { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; border-bottom: 2px solid #1a1d23; padding-bottom: 10px; margin-bottom: 18px; }
  .rp-top h1 { font-size: 22px; margin: 0; } .rp-top .meta { color: #5b6270; font-size: 12px; text-align: right; }
  .rp h2 { font-size: 15px; margin: 22px 0 10px; text-transform: uppercase; letter-spacing: .05em; color: #5b6270; }
  .rp-inputs { columns: 2 280px; column-gap: 28px; }
  .rp-group { break-inside: avoid; margin-bottom: 12px; } .rp-group h3 { font-size: 12.5px; margin: 0 0 4px; }
  .rp-group table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .rp-group td { padding: 3px 0; border-bottom: 1px solid #e3e6eb; } .rp-group td:last-child { text-align: right; font-family: var(--mono); padding-left: 10px; }
  .rp-results * { position: static !important; max-height: none !important; overflow: visible !important; }
  .rp-results [class*="grid"], .rp-results .cf-main-inner, .rp-results .fl-work { display: block !important; }
  .rp-results .stage, .rp-results .plot-card, .rp-results .card { min-height: 0 !important; height: auto !important; break-inside: avoid; margin-bottom: 14px; }
  .rp-pic { display: block; width: 100%; height: auto; border: 1px solid #e3e6eb; border-radius: 8px; margin: 6px 0 12px; break-inside: avoid; }
  @media print { .rp { padding: 0; } }
</style></head><body>
<div class="rp">
  <div class="rp-top"><h1>${esc(title)}${tab ? ' · ' + esc(tab) : ''}</h1><div class="meta">Pteronautics report<br>${esc(new Date().toLocaleString())}</div></div>
  ${inputsHtml ? `<h2>Inputs</h2><div class="rp-inputs">${inputsHtml}</div>` : ''}
  <h2>Results</h2><div class="rp-results">${body}</div>
</div></body></html>`;
  shell.show(html);
}

// the report opens over the app in a frame (no pop-up window to be blocked), with Print and Close.
// Until the report is ready it is an opaque cover with fixed colours, so nothing behind it can be seen changing.
function reportShell(title) {
  document.querySelector('.rp-overlay')?.remove();
  const cs = getComputedStyle(document.body);
  const frame = h('iframe', { class: 'rp-frame', title: 'Report preview', style: { display: 'none' } });
  const wait = h('div', { class: 'rp-wait', style: { color: cs.color } }, 'Preparing report…');
  const close = () => { ov.remove(); removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  const printBtn = h('button', { class: 'btn primary', type: 'button' }, icon('print', 15), 'Print or save as PDF');
  printBtn.addEventListener('click', () => frame.contentWindow.print());
  const closeBtn = h('button', { class: 'btn', type: 'button' }, 'Close');
  closeBtn.addEventListener('click', close);
  const head = h('div', { class: 'rp-head', style: { visibility: 'hidden' } }, h('strong', {}, 'Report preview'), h('span', { class: 'grow' }), printBtn, closeBtn);
  const ov = h('div', { class: 'rp-overlay', role: 'dialog', 'aria-label': title + ' report', style: { background: cs.backgroundColor, backdropFilter: 'none' } }, head, wait, frame);
  document.body.append(ov);
  addEventListener('keydown', onKey);
  return {
    show(html) {
      frame.srcdoc = html; frame.style.display = '';
      wait.remove(); head.style.visibility = ''; ov.style.background = ''; ov.style.backdropFilter = '';
      printBtn.focus();
    },
  };
}

