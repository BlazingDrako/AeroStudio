// App-wide search (⌘K / Ctrl+K, or the Search button in the sidebar).
//
// The index is built once from what the modules already describe about themselves: their titles, blurbs and tabs,
// the concept notes at the bottom of each module, the Formula Library (every formula and its topic notes), and
// extra links a module offers (flow-sandbox scenes, Vehicle aero vehicles). Results are ranked by where the words
// match: a title beats tags, which beat body text. Opening a concept goes to its module, unfolds the note and
// scrolls to it.
import { h, icon } from './ui.js';
import { TOPICS, FORMULAS } from '../modules/formulas/library.js';

const strip = html => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
// lower case, accents off, Greek letters spelled out so "theta" finds θ and "delta v" finds Δv
const GREEK = { α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', θ: 'theta', λ: 'lambda', μ: 'mu', ν: 'nu', π: 'pi', ρ: 'rho', σ: 'sigma', τ: 'tau', φ: 'phi', ω: 'omega', η: 'eta', ζ: 'zeta', ψ: 'psi', χ: 'chi', ξ: 'xi', κ: 'kappa' };
const norm = s => String(s || '').toLowerCase().replace(/[αβγδεθλμνπρστφωηζψχξκ]/g, c => ' ' + GREEK[c] + ' ')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[₀-₉]/g, c => String(c.charCodeAt(0) - 0x2080));
const words = s => norm(s).split(/[^a-z0-9*]+/).filter(Boolean);

let INDEX = null;
function build(modules) {
  const out = [];
  const add = o => {
    o.nTitle = norm(o.title); o.wTitle = words(o.title + ' ' + (o.alias || '')); // alias: short names that count like the title
    o.nTags = norm(o.tags || ''); o.wTags = words((o.tags || '') + ' ' + (o.sub || ''));
    o.nBody = norm(o.body || '');
    out.push(o);
  };
  const byModule = {};
  for (const m of modules) {
    byModule[m.id] = m;
    const planned = m.status !== 'live';
    add({ kind: planned ? 'Planned' : 'Module', title: m.title, sub: planned ? 'Planned module' : m.group, href: '#/' + m.id, icon: m.icon,
      tags: (m.features || []).join(' '), body: m.blurb, rank: planned ? 1 : 4 });
    for (const t of m.tabs || []) add({ kind: 'Tab', title: t.label, sub: m.title, href: `#/${m.id}?tab=${t.id}`, icon: m.icon, tags: m.title, rank: 3 });
    for (const c of m.concepts || []) add({ kind: 'Concept', title: c.title, sub: m.title, href: '#/' + m.id, concept: c.title, icon: m.icon, body: strip(c.html), rank: 2 });
    for (const l of m.links || []) add({ kind: l.kind || 'Example', title: l.title, sub: l.sub ? `${m.title} · ${l.sub}` : m.title, href: l.href, icon: m.icon, alias: l.alias, body: l.body, rank: 2 });
  }
  const fl = byModule.formulas || { icon: 'book' };
  const topic = Object.fromEntries(TOPICS.map(t => [t.id, t]));
  for (const t of TOPICS) {
    add({ kind: 'Topic', title: t.title, sub: 'Formula Library', href: '#/formulas?t=' + t.id, icon: t.icon || fl.icon, body: t.blurb, rank: 2 });
    for (const c of t.concepts || []) add({ kind: 'Concept', title: c.title, sub: 'Formula Library · ' + t.title, href: '#/formulas?t=' + t.id, concept: c.title, icon: t.icon || fl.icon, body: strip(c.html), rank: 1 });
  }
  for (const f of FORMULAS) {
    add({ kind: 'Formula', title: f.name, sub: (topic[f.topic]?.title || 'Formula Library'), eq: f.eq, href: '#/formulas?f=' + f.id, icon: 'book',
      tags: `${f.tags || ''} ${strip(f.eq)} ${(f.vars || []).map(v => v.name).join(' ')}`, body: [f.about, f.origin, f.typical, f.watch].filter(Boolean).join(' '), rank: 2 });
  }
  return out;
}

const reEsc = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// how well one query word matches an item (0 = not at all)
function wordScore(item, w) {
  let best = 0;
  for (const tw of item.wTitle) { if (tw === w) best = Math.max(best, 12); else if (tw.startsWith(w)) best = Math.max(best, 9); }
  if (best) return best;
  if (w.length > 3 && item.nTitle.includes(w)) return 6;
  for (const tw of item.wTags) { if (tw === w) best = Math.max(best, 5); else if (tw.startsWith(w)) best = Math.max(best, 4); }
  if (best) return best;
  if (w.length > 3 && item.nTags.includes(w)) return 3;
  // body text: the start of a word only, so "isp" doesn't match "display"
  if (w.length > 1 && new RegExp('(^|[^a-z0-9])' + reEsc(w)).test(item.nBody)) return 1.2;
  return 0;
}

// strict: every word must match. Loose (used when strict finds little): the score of the words that do match,
// so "von karman" still finds the Kármán vortex street
function score(item, q, qWords, loose) {
  let s = 0, hit = 0;
  for (const w of qWords) {
    const b = wordScore(item, w);
    if (!b) { if (!loose) return 0; continue; }
    s += b; hit++;
  }
  if (!hit || (loose && hit < Math.ceil(qWords.length / 2))) return 0;
  if (qWords.length > 1) {
    if (item.nTitle.includes(q)) s += 14; else if (item.nTags.includes(q)) s += 6; else if (item.nBody.includes(q)) s += 4;
  }
  if (item.nTitle === q) s += 10;
  return (s + item.rank * 0.6) * (loose ? 0.5 : 1);
}

export function search(query, limit = 40) {
  const q = norm(query).replace(/\s+/g, ' ').trim(), qWords = words(query);
  if (!qWords.length) return [];
  const rank = loose => INDEX.map(it => ({ it, s: score(it, q, qWords, loose) })).filter(r => r.s > 0)
    .sort((a, b) => b.s - a.s || a.it.title.length - b.it.title.length).map(r => r.it);
  let out = rank(false);
  // a few near misses when the exact search finds little (more when it finds nothing)
  if (out.length < 3 && qWords.length > 1) { const seen = new Set(out); out = out.concat(rank(true).filter(it => !seen.has(it)).slice(0, out.length ? 4 : 12)); }
  return out.slice(0, limit);
}

// ---------- results: highlighting and a snippet around the first body match ----------
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function mark(text, qWords) {
  const n = norm(text);
  if (n.length !== text.length) return esc(text); // only when positions line up (no expanded Greek)
  const spans = [];
  for (const w of qWords) for (let i = n.indexOf(w); i >= 0; i = n.indexOf(w, i + w.length)) {
    if (i === 0 || /[^a-z0-9]/.test(n[i - 1])) spans.push([i, i + w.length]);
  }
  if (!spans.length) return esc(text);
  spans.sort((a, b) => a[0] - b[0]);
  let out = '', at = 0;
  for (const [a, b] of spans) { if (a < at) continue; out += esc(text.slice(at, a)) + '<mark>' + esc(text.slice(a, b)) + '</mark>'; at = b; }
  return out + esc(text.slice(at));
}
function snippet(item, qWords) {
  if (!item.body) return '';
  const n = norm(item.body);
  if (n.length !== item.body.length) return esc(item.body.slice(0, 110)) + (item.body.length > 110 ? '…' : '');
  let i = -1;
  for (const w of qWords) { const j = n.indexOf(w); if (j >= 0 && (i < 0 || j < i)) i = j; }
  if (i < 0) return esc(item.body.slice(0, 110)) + (item.body.length > 110 ? '…' : '');
  const a = Math.max(0, i - 40), b = Math.min(item.body.length, i + 90);
  return (a > 0 ? '…' : '') + mark(item.body.slice(a, b), qWords) + (b < item.body.length ? '…' : '');
}

// ---------- opening a result ----------
function openConcept(title, tries = 40) {
  const want = norm(title);
  const el = [...document.querySelectorAll('#view details.concept')].find(d => norm(d.querySelector('summary')?.textContent).trim() === want);
  if (!el) { if (tries > 0) setTimeout(() => openConcept(title, tries - 1), 100); return; }
  el.open = true;
  // jump (not smooth) and again once the tab has finished laying out, so late content can't push it away
  el.scrollIntoView({ block: 'center' });
  setTimeout(() => el.scrollIntoView({ block: 'center' }), 400);
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}
function go(item) {
  if (location.hash === item.href) dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = item.href;
  if (item.concept) setTimeout(() => openConcept(item.concept), 150);
}

// ---------- the search window ----------
let ov = null;
const SUGGEST = ['Mach disk', 'Dutch roll', 'Hohmann transfer', 'Boundary layer', 'Kalman filter', 'Buckling'];

export function openSearch() {
  if (ov) { ov.querySelector('input').focus(); return; }
  const input = h('input', { class: 'sp-input', type: 'search', placeholder: 'Search modules, concepts and formulas…', 'aria-label': 'Search Pteronautics', autocomplete: 'off', spellcheck: 'false' });
  const list = h('div', { class: 'sp-list', role: 'listbox' });
  const foot = h('div', { class: 'sp-foot' }, h('span', {}, h('kbd', {}, '↑'), h('kbd', {}, '↓'), ' to move'), h('span', {}, h('kbd', {}, '↵'), ' to open'), h('span', {}, h('kbd', {}, 'esc'), ' to close'));
  const box = h('div', { class: 'sp-box', role: 'dialog', 'aria-label': 'Search' }, h('div', { class: 'sp-top' }, icon('search', 18), input), list, foot);
  ov = h('div', { class: 'sp-overlay' }, box);
  let results = [], active = 0, offset = 0; // offset: a heading row above the results
  const close = () => { ov?.remove(); ov = null; };
  const pick = i => { const it = results[i]; if (!it) return; close(); go(it); };
  const paint = () => {
    [...list.querySelectorAll('.sp-row')].forEach((row, i) => { row.classList.toggle('on', i === active); row.setAttribute('aria-selected', i === active); });
    list.children[active + offset]?.scrollIntoView({ block: 'nearest' });
  };
  const render = () => {
    const q = input.value.trim(), qWords = words(q);
    results = q ? search(q) : INDEX.filter(it => it.kind === 'Module');
    active = 0; offset = q ? 0 : 1;
    list.replaceChildren();
    if (!results.length) {
      list.append(h('div', { class: 'sp-empty' }, `Nothing found for “${q}”. Try `,
        ...SUGGEST.slice(0, 3).flatMap((s, i) => { const a = h('a', { href: '#' }, s); a.addEventListener('click', e => { e.preventDefault(); input.value = s; render(); }); return [i ? ', ' : '', a]; }), '.'));
      return;
    }
    if (!q) list.append(h('div', { class: 'sp-group' }, 'Modules'));
    results.forEach((it, i) => {
      const row = h('div', { class: 'sp-row', role: 'option' },
        h('div', { class: 'sp-ic' }, icon(it.icon || 'book', 16)),
        h('div', { class: 'sp-txt' },
          h('div', { class: 'sp-title', html: mark(it.title, qWords) + (it.eq && strip(it.eq).length <= 36 ? ` <span class="sp-eq">${it.eq}</span>` : '') }),
          h('div', { class: 'sp-sub' }, it.sub || ''),
          q && it.kind !== 'Module' && it.kind !== 'Tab' && it.body ? h('div', { class: 'sp-snip', html: snippet(it, qWords) }) : null),
        h('span', { class: 'sp-kind k-' + it.kind.toLowerCase() }, it.kind));
      row.addEventListener('mousemove', () => { if (active !== i) { active = i; paint(); } });
      row.addEventListener('click', () => pick(i));
      list.append(row);
    });
    paint();
  };
  input.addEventListener('input', render);
  input.addEventListener('keydown', e => {
    const n = results.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); if (n) { active = (active + 1) % n; paint(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (n) { active = (active - 1 + n) % n; paint(); } }
    else if (e.key === 'Enter') { e.preventDefault(); pick(active); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  ov.addEventListener('pointerdown', e => { if (e.target === ov) close(); });
  document.body.append(ov);
  render();
  input.focus();
}

export function initSearch(modules) {
  INDEX = build(modules);
  addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (ov) { ov.remove(); ov = null; } else openSearch(); return; }
    // "/" opens search when you're not typing in a field
    if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.target.closest('input, textarea, select, [contenteditable]')) { e.preventDefault(); openSearch(); }
  });
}

export const searchShortcut = () => (/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K');
