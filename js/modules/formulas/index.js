// Formula Library module: browse, search and solve aerospace formulas for any variable,
// with a live plot and an explanation of each formula. Views: library home, topic, formula, favourites.
import { h, info, segmented, icon, downloadText, cssVar } from '../../lib/ui.js';
import { Plot } from '../../lib/plot.js';
import { solveFormula, sweep, unitList, preferredUnit, toSI, fromSI, fmtVal } from '../../solvers/formulas.js';
import { TOPICS, FORMULAS, byId, topicById, CONSTANTS } from './library.js';

// ---- persistent preferences ----
const load = k => { try { return JSON.parse(localStorage.getItem('pteronautics-fl-' + k)); } catch { return null; } };
const save = (k, v) => { try { localStorage.setItem('pteronautics-fl-' + k, JSON.stringify(v)); } catch { } };
let system = load('units') === 'us' ? 'us' : 'si';
let logAxes = load('log') === true;
const favs = new Set(Array.isArray(load('favs')) ? load('favs') : []);

// ---- per-formula working state (kept for the session, survives remounts) ----
const state = {};
function st(f) {
  if (!state[f.id]) {
    const x = {};
    for (const v of f.vars) x[v.id] = v.val;
    state[f.id] = { x, target: f.target || f.vars[0].id, units: {}, xvar: null, fam: '', roots: [] };
  }
  return state[f.id];
}
const unitOf = (f, v) => st(f).units[v.id] || preferredUnit(v.kind, system, v.unit);
const shown = (f, v, si) => fromSI(v.kind, unitOf(f, v), si);
const plain = s => String(s).replace(/<sub>(.*?)<\/sub>/g, '$1').replace(/<sup>(.*?)<\/sup>/g, '^$1').replace(/<[^>]+>/g, '');
const fmt = x => fmtVal(x, 5);
const uLabel = u => (u === '–' ? '' : ' ' + u);
const parse = s => {
  s = String(s).trim().replace(/[,\s]/g, '').replace(/×10\^?/, 'e');
  return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s) ? parseFloat(s) : NaN;
};
const firstSentence = s => (s.match(/^.*?[.!?](\s|$)/) || [s])[0].trim();

// Slider / plot window around the current value (SI)
function windowFor(v, cur) {
  const canLog = v.min > 0 && v.log !== false && v.max / v.min > 50;
  if (canLog) {
    const c = cur > 0 ? cur : Math.sqrt(v.min * v.max);
    return { lo: Math.max(v.min, c / 10), hi: Math.min(v.max, c * 10), log: true };
  }
  const full = v.max - v.min, span = Math.abs(cur) > 0 ? Math.abs(cur) * 1.5 : full / 20;
  if (full <= 4 * span) return { lo: v.min, hi: v.max, log: false };
  return { lo: Math.max(v.min, cur - span), hi: Math.min(v.max, cur + span), log: false };
}

// Plot window: linear around the current value by default, a decade either side on log axes
function plotWindow(v, cur) {
  const w = windowFor(v, cur);
  if (!w.log) return w;
  if (logAxes) return w;
  const c = cur > 0 ? cur : Math.sqrt(v.min * v.max);
  return { lo: Math.max(v.min, c / 5), hi: Math.min(v.max, c * 3), log: false };
}

function searchFormulas(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/);
  const scored = [];
  for (const f of FORMULAS) {
    const name = f.name.toLowerCase();
    const hay = [f.name, f.tags, topicById[f.topic].title, plain(f.eq), f.about, ...f.vars.map(v => v.name + ' ' + plain(v.sym))].join(' ').toLowerCase();
    if (!words.every(w => hay.includes(w))) continue;
    let s = 0;
    for (const w of words) { if (name.includes(w)) s += 3; if ((f.tags || '').includes(w)) s += 2; }
    if (name.startsWith(q)) s += 5;
    scored.push([s, f]);
  }
  return scored.sort((a, b) => b[0] - a[0]).map(x => x[1]);
}

export const formulasModule = {
  id: 'formulas',
  title: 'Formula Library',
  mount(root) {
    const side = h('aside', { class: 'af-controls fl-side' });
    const main = h('section', { class: 'fl-main' });
    root.append(h('div', { class: 'af fl' }, side, main));
    let plot = null;
    const params = () => new URLSearchParams(location.hash.split('?')[1] || '');
    const go = (p = {}) => {
      const qs = new URLSearchParams(p).toString(), url = '#/formulas' + (qs ? '?' + qs : '');
      if (location.hash !== url) history.pushState(null, '', url);
      render();
      main.scrollTop = 0;
    };
    const linkTo = (p, ...kids) => h('a', { href: '#/formulas?' + new URLSearchParams(p), onclick: e => { e.preventDefault(); go(p); } }, ...kids);

    // ---------- sidebar ----------
    const search = h('input', { class: 'text-input fl-search', type: 'search', placeholder: 'Search formulas  ( / )', 'aria-label': 'Search formulas' });
    const nav = h('div', { class: 'fl-nav' });
    const unitSeg = segmented([{ value: 'si', label: 'SI units' }, { value: 'us', label: 'US units' }], system, val => {
      system = val; save('units', val);
      for (const k in state) state[k].units = {};
      render();
    });
    const consts = h('details', { class: 'concept fl-consts' }, h('summary', {}, 'Constants'),
      h('div', { class: 'body' }, h('table', { class: 'fl-ctable' }, ...CONSTANTS.map(c => h('tr', { title: c[1] }, h('td', { class: 'sym' }, c[0]), h('td', {}, c[1]), h('td', { class: 'val' }, c[2]))))));
    side.append(
      h('div', { class: 'section' }, h('div', { class: 'fl-brand' }, h('h2', { class: 'af-title' }, 'Formula Library'),
        h('div', { class: 'af-sub' }, `${FORMULAS.length} formulas in ${TOPICS.length} topics`)), search),
      h('div', { class: 'section fl-navsec' }, nav),
      h('div', { class: 'section' }, unitSeg.el, h('div', { class: 'hint' }, 'Each value can also use its own unit.')),
      h('div', { class: 'section' }, consts));
    search.addEventListener('input', () => renderNav());
    search.addEventListener('keydown', e => {
      if (e.key === 'Enter') { const r = searchFormulas(search.value); if (r[0]) go({ f: r[0].id }); }
      if (e.key === 'Escape') { search.value = ''; renderNav(); search.blur(); }
    });
    const onKey = e => {
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) { e.preventDefault(); search.focus(); search.select(); }
    };
    addEventListener('keydown', onKey);

    function navItem(f, active) {
      return h('a', { class: 'fl-item' + (active ? ' on' : ''), href: '#/formulas?f=' + f.id, onclick: e => { e.preventDefault(); go({ f: f.id }); } },
        h('span', { class: 'n' }, f.name), favs.has(f.id) ? h('span', { class: 'fav', 'aria-label': 'favourite' }, '★') : null);
    }
    function renderNav() {
      const p = params(), fid = p.get('f'), f = byId[fid];
      const tid = f ? f.topic : p.get('t');
      nav.replaceChildren();
      const q = search.value.trim();
      if (q) {
        const res = searchFormulas(q);
        nav.append(h('div', { class: 'fl-navhead' }, res.length ? `${res.length} match${res.length === 1 ? '' : 'es'}` : 'No formulas match. Try a variable name like "Mach" or "thrust".'));
        for (const r of res) nav.append(h('div', { class: 'fl-res' }, navItem(r, r.id === fid), h('div', { class: 'fl-restopic' }, topicById[r.topic].title)));
        return;
      }
      const top = (label, ic, p, active, count) => h('a', { class: 'fl-top' + (active ? ' on' : ''), href: '#/formulas?' + new URLSearchParams(p), onclick: e => { e.preventDefault(); go(p); } }, icon(ic), label, count != null ? h('span', { class: 'fl-count' }, count) : null);
      nav.append(top('All topics', 'book', {}, !fid && !tid && !p.get('fav')));
      nav.append(top('Favourites', 'star', { fav: 1 }, !!p.get('fav'), favs.size));
      nav.append(h('div', { class: 'fl-group' }, 'Topics'));
      for (const t of TOPICS) {
        const list = FORMULAS.filter(x => x.topic === t.id);
        nav.append(top(t.title, t.icon, { t: t.id }, t.id === tid && !fid, list.length));
        if (t.id === tid) nav.append(h('div', { class: 'fl-sub' }, ...list.map(x => navItem(x, x.id === fid))));
      }
    }

    // ---------- views ----------
    function render() {
      if (plot) plot = null;
      const p = params();
      const f = byId[p.get('f')];
      const t = topicById[p.get('t')];
      renderNav();
      if (f) { document.title = `${f.name} — Formula Library`; main.replaceChildren(formulaView(f)); }
      else if (t) { document.title = `${t.title} — Formula Library`; main.replaceChildren(topicView(t)); }
      else if (p.get('fav')) { document.title = 'Favourites — Formula Library'; main.replaceChildren(favView()); }
      else { document.title = 'Formula Library — Pteronautics'; main.replaceChildren(homeView()); }
    }

    function formulaCard(f) {
      return h('a', { class: 'fl-fcard', href: '#/formulas?f=' + f.id, onclick: e => { e.preventDefault(); go({ f: f.id }); } },
        h('div', { class: 'row' }, h('h4', {}, f.name), h('div', { class: 'grow' }), favs.has(f.id) ? h('span', { class: 'fav' }, '★') : null),
        h('div', { class: 'fl-eqsm', html: f.eq }), h('p', {}, firstSentence(f.about)));
    }

    function homeView() {
      const cards = TOPICS.map(t => {
        const list = FORMULAS.filter(x => x.topic === t.id);
        return h('a', { class: 'card fl-tcard', href: '#/formulas?t=' + t.id, onclick: e => { e.preventDefault(); go({ t: t.id }); } },
          h('div', { class: 'row' }, h('div', { class: 'ci' }, icon(t.icon, 20)), h('div', { class: 'grow' }), h('span', { class: 'tag' }, `${list.length} formulas`)),
          h('h3', {}, t.title), h('p', {}, t.blurb),
          h('div', { class: 'fl-chips' }, ...list.slice(0, 4).map(x => h('span', { class: 'fl-chip' }, x.name)), list.length > 4 ? h('span', { class: 'fl-chip more' }, `+${list.length - 4}`) : null));
      });
      const steps = [
        ['Find', 'Search by name, symbol or idea ("Mach", "buckling", "range"), or browse a topic.'],
        ['Solve', 'Choose the variable you want with the circle on its row. Change any other value, by typing or with its slider, and the answer updates live.'],
        ['See and understand', 'The plot shows how the answer changes with any input. Below it: what the formula means, where it comes from, when it holds and typical values.'],
      ];
      return h('div', { class: 'fl-page' },
        h('div', { class: 'hero' }, h('h1', {}, 'Formula Library'),
          h('p', {}, `${FORMULAS.length} aerospace formulas you can solve for any variable, plot and understand. From the standard atmosphere to re-entry heating, with units you can switch at will.`)),
        h('div', { class: 'fl-steps' }, ...steps.map((s, i) => h('div', { class: 'fl-step' }, h('div', { class: 'num' }, i + 1), h('div', {}, h('b', {}, s[0]), h('p', {}, s[1]))))),
        h('div', { class: 'cards' }, ...cards));
    }

    function topicView(t) {
      const list = FORMULAS.filter(x => x.topic === t.id);
      return h('div', { class: 'fl-page' },
        h('div', { class: 'fl-crumbs' }, linkTo({}, 'Formula Library'), ' › ', t.title),
        h('div', { class: 'fl-thead' }, h('div', { class: 'ci' }, icon(t.icon, 24)), h('div', {}, h('h1', {}, t.title), h('p', {}, t.blurb))),
        h('h3', { class: 'fl-h3' }, 'Key ideas'),
        h('div', { class: 'cf-concepts' }, ...t.concepts.map((c, i) => h('details', { class: 'concept', open: i === 0 }, h('summary', {}, c.title), h('div', { class: 'body', html: c.html })))),
        h('h3', { class: 'fl-h3' }, `Formulas (${list.length})`),
        h('div', { class: 'fl-fgrid' }, ...list.map(formulaCard)));
    }

    function favView() {
      const list = FORMULAS.filter(f => favs.has(f.id));
      return h('div', { class: 'fl-page' },
        h('div', { class: 'fl-crumbs' }, linkTo({}, 'Formula Library'), ' › Favourites'),
        h('h1', { class: 'fl-h1' }, 'Favourites'),
        list.length ? h('div', { class: 'fl-fgrid' }, ...list.map(formulaCard))
          : h('div', { class: 'fl-empty' }, h('b', {}, 'Keep the formulas you use most here'), h('p', {}, 'Open any formula and press the star next to its name.'), h('button', { class: 'btn', onclick: () => go({}) }, 'Browse topics')));
    }

    // ---------- the formula page ----------
    function formulaView(f) {
      plot = null;
      const s = st(f), t = topicById[f.topic];
      const siblings = FORMULAS.filter(x => x.topic === f.topic), idx = siblings.indexOf(f);
      const star = h('button', { class: 'btn sm fl-star' + (favs.has(f.id) ? ' on' : ''), type: 'button', title: 'Add to favourites', 'aria-pressed': favs.has(f.id) }, icon('star', 15), favs.has(f.id) ? 'Saved' : 'Save');
      star.addEventListener('click', () => {
        if (favs.has(f.id)) favs.delete(f.id); else favs.add(f.id);
        save('favs', [...favs]);
        const on = favs.has(f.id);
        star.classList.toggle('on', on); star.setAttribute('aria-pressed', on); star.lastChild.textContent = on ? 'Saved' : 'Save';
        renderNav();
      });
      const head = h('div', { class: 'fl-fhead' },
        h('div', { class: 'fl-crumbs' }, linkTo({}, 'Formula Library'), ' › ', linkTo({ t: t.id }, t.title)),
        h('div', { class: 'row fl-titlerow' }, h('h1', { class: 'fl-h1' }, f.name), star, h('div', { class: 'grow' }),
          f.link ? h('a', { class: 'btn sm', href: f.link.href, title: 'Go deeper in the full tool' }, 'Open in ' + f.link.label + ' →') : null));
      const eqLen = plain(f.eq).length;
      const eq = h('div', { class: 'fl-eq' + (eqLen > 70 ? ' xlong' : eqLen > 42 ? ' long' : ''), html: f.eq });

      // ----- solve card -----
      const rows = {}, rowWrap = h('div', { class: 'fl-rows' });
      const msg = h('div', { class: 'fl-msg' });
      const rootsEl = h('div', { class: 'fl-roots' });
      const exNote = f.example ? h('div', { class: 'hint' }, 'Example values: ' + f.example) : null;
      const reset = h('button', { class: 'btn sm ghost', type: 'button', title: 'Restore the example values' }, icon('reset', 14), 'Reset');
      reset.addEventListener('click', () => { delete state[f.id]; main.replaceChildren(formulaView(f)); });

      for (const v of f.vars) {
        const radio = h('input', { type: 'radio', name: 'fl-target', 'aria-label': 'Solve for ' + v.name, title: 'Solve for ' + v.name });
        const input = h('input', { class: 'num-input fl-num', type: 'text', inputmode: 'decimal', 'aria-label': v.name });
        const units = unitList(v.kind);
        let unitEl;
        if (units.length > 1) {
          unitEl = h('select', { class: 'select fl-unit', 'aria-label': v.name + ' unit' }, ...units.map(u => h('option', { value: u[0] }, u[0])));
          unitEl.value = unitOf(f, v);
          unitEl.addEventListener('change', () => { s.units[v.id] = unitEl.value; paint(); drawPlot(); });
        } else unitEl = h('span', { class: 'fl-unit1' }, units[0][0] === '–' ? '' : units[0][0]);
        const range = h('input', { type: 'range', min: 0, max: 1000, step: 1, 'aria-label': v.name + ' slider' });
        const err = h('div', { class: 'fl-err' });
        const el = h('div', { class: 'fl-var' },
          h('label', { class: 'fl-pick' }, radio),
          h('span', { class: 'fl-sym', html: v.sym }),
          h('span', { class: 'fl-name' }, v.name, v.desc ? info(v.desc) : null),
          input, unitEl,
          h('div', { class: 'fl-slide' }, range), err);
        const row = { v, el, radio, input, unitEl, range, err, win: windowFor(v, s.x[v.id]) };
        rows[v.id] = row;
        rowWrap.append(el);

        radio.addEventListener('change', () => {
          s.target = v.id;
          if (s.xvar === v.id) s.xvar = null;
          if (s.fam === v.id) s.fam = '';
          for (const r of Object.values(rows)) r.err.textContent = '';
          solve(); buildPlotControls(); drawPlot();
        });
        input.addEventListener('input', () => {
          if (s.target === v.id) return;
          const n = parse(input.value);
          if (!isFinite(n)) { err.textContent = input.value.trim() ? 'Enter a number, like 1500 or 1.5e3.' : ''; return; }
          const si = toSI(v.kind, unitOf(f, v), n);
          if (si < v.min || si > v.max) { err.textContent = `Allowed range: ${fmt(shown(f, v, v.min))} to ${fmt(shown(f, v, v.max))}${uLabel(unitOf(f, v))}.`; return; }
          err.textContent = '';
          s.x[v.id] = si;
          row.win = windowFor(v, si);
          paintSlider(row);
          solve(true); drawPlot();
        });
        input.addEventListener('blur', () => { if (s.target !== v.id) { err.textContent = ''; input.value = fmt(shown(f, v, s.x[v.id])); } });
        input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
        range.addEventListener('input', () => {
          const w = row.win, p = +range.value / 1000;
          const si = w.log ? w.lo * Math.pow(w.hi / w.lo, p) : w.lo + (w.hi - w.lo) * p;
          s.x[v.id] = +si.toPrecision(4);
          err.textContent = '';
          input.value = fmt(shown(f, v, s.x[v.id]));
          solve(); drawPlot();
        });
        range.addEventListener('change', () => { row.win = windowFor(v, s.x[v.id]); paintSlider(row); });
      }

      function paintSlider(r) {
        const w = r.win, val = s.x[r.v.id];
        let p = w.log ? Math.log(val / w.lo) / Math.log(w.hi / w.lo) : (val - w.lo) / (w.hi - w.lo);
        p = Math.min(1, Math.max(0, isFinite(p) ? p : 0.5));
        r.range.value = Math.round(p * 1000);
        r.range.style.setProperty('--fill', p * 100 + '%');
      }
      function paint(skipFocused = false) {
        for (const r of Object.values(rows)) {
          const tg = r.v.id === s.target;
          r.el.classList.toggle('tgt', tg);
          r.radio.checked = tg;
          r.input.readOnly = tg;
          r.range.disabled = tg;
          if (r.unitEl.tagName === 'SELECT') r.unitEl.value = unitOf(f, r.v);
          if (tg) r.input.value = isFinite(s.value) ? fmt(shown(f, r.v, s.value)) : '—';
          else if (!(skipFocused && document.activeElement === r.input)) r.input.value = fmt(shown(f, r.v, s.x[r.v.id]));
          if (!tg) paintSlider(r);
        }
        const tv = f.vars.find(q => q.id === s.target);
        rootsEl.replaceChildren();
        if (isFinite(s.value) && s.roots.length > 1) {
          rootsEl.append(h('span', { class: 'hint' }, `${s.roots.length} solutions for ${plain(tv.sym)}:`),
            ...s.roots.map(r => {
              const b = h('button', { class: 'fl-root' + (Math.abs(r - s.value) <= 1e-9 * Math.max(Math.abs(r), 1e-12) ? ' on' : ''), type: 'button' }, fmt(shown(f, tv, r)) + uLabel(unitOf(f, tv)));
              b.addEventListener('click', () => { s.x[s.target] = r; solve(); drawPlot(); });
              return b;
            }));
        }
        msg.textContent = isFinite(s.value) ? '' : `No physical solution for ${tv.name.toLowerCase()} with these inputs (searched ${fmt(shown(f, tv, tv.min))} to ${fmt(shown(f, tv, tv.max))}${uLabel(unitOf(f, tv))}). Check that the inputs make sense together.`;
      }
      function solve(skipFocused = false) {
        const r = solveFormula(f, s.x, s.target);
        s.value = r.value; s.roots = r.roots;
        if (isFinite(r.value)) s.x[s.target] = r.value;
        paint(skipFocused);
      }

      const solveCard = h('div', { class: 'plot-card fl-solve' },
        h('div', { class: 'plot-head' }, h('h4', {}, 'Solve'), h('span', { class: 'hint fl-hint' }, 'Choose which value to find'), h('div', { class: 'grow' }), reset),
        h('div', { class: 'fl-colhead' }, h('span', {}, 'Find'), h('span', {}), h('span', {}, 'Variable'), h('span', {}, 'Value'), h('span', {}, 'Unit')),
        rowWrap, rootsEl, msg, exNote);

      // ----- plot card -----
      const xSel = h('select', { class: 'select fl-psel', 'aria-label': 'Plot against' });
      const famSel = h('select', { class: 'select fl-psel', 'aria-label': 'Compare values of' });
      const ylab = h('b', { class: 'fl-ylab' });
      const csv = h('button', { class: 'btn sm ghost', type: 'button', title: 'Download the plotted data' }, icon('download', 14), 'CSV');
      const logBox = h('input', { type: 'checkbox' });
      logBox.checked = logAxes;
      logBox.addEventListener('change', () => { logAxes = logBox.checked; save('log', logAxes); drawPlot(); });
      const logToggle = h('label', { class: 'fl-logt', title: 'Log scales show power laws as straight lines and cover a wider range' }, logBox, 'Log scale');
      const plotBox = h('div', { class: 'fl-plotbox' });
      const plotCard = h('div', { class: 'plot-card fl-plotcard' },
        h('div', { class: 'plot-head fl-plothead' }, h('h4', {}, 'Plot'), ylab, h('span', { class: 'hint' }, 'against'), xSel, h('span', { class: 'hint' }, 'compare'), famSel, h('div', { class: 'grow' }), logToggle, csv),
        plotBox, h('div', { class: 'hint' }, 'The dot is your current values. Hover the curve for exact numbers.'));
      xSel.addEventListener('change', () => { s.xvar = xSel.value; if (s.fam === s.xvar) s.fam = ''; buildPlotControls(); drawPlot(); });
      famSel.addEventListener('change', () => { s.fam = famSel.value; drawPlot(); });
      let lastPlot = null;
      csv.addEventListener('click', () => {
        if (!lastPlot) return;
        const { xv, tv, curves } = lastPlot;
        const head = [`${plain(xv.sym)} (${unitOf(f, xv)})`, ...curves.map(c => `${plain(tv.sym)} (${unitOf(f, tv)})${c.label ? ' at ' + c.label : ''}`)].map(q => '"' + q.replace(/"/g, "'") + '"');
        const lines = [head.join(',')];
        for (let i = 0; i < curves[0].x.length; i++) lines.push([curves[0].x[i], ...curves.map(c => c.y[i])].map(q => isFinite(q) ? +q.toPrecision(6) : '').join(','));
        downloadText(`${f.id}.csv`, lines.join('\n'));
      });

      function buildPlotControls() {
        const others = f.vars.filter(v => v.id !== s.target);
        if (!s.xvar || s.xvar === s.target || !others.find(v => v.id === s.xvar)) s.xvar = others[0]?.id;
        xSel.replaceChildren(...others.map(v => h('option', { value: v.id }, `${plain(v.sym)} — ${v.name.toLowerCase()}`)));
        xSel.value = s.xvar;
        const famOpts = others.filter(v => v.id !== s.xvar);
        famSel.replaceChildren(h('option', { value: '' }, 'nothing'), ...famOpts.map(v => h('option', { value: v.id }, plain(v.sym))));
        famSel.value = s.fam;
        famSel.disabled = !famOpts.length;
        ylab.innerHTML = f.vars.find(v => v.id === s.target).sym;
      }

      function drawPlot() {
        if (!plot) return;
        const tv = f.vars.find(v => v.id === s.target), xv = f.vars.find(v => v.id === s.xvar);
        if (!xv) return;
        const w = plotWindow(xv, s.x[xv.id]);
        const colors = [cssVar('--accent'), cssVar('--lower'), cssVar('--turb')];
        const curves = [];
        const fv = s.fam ? f.vars.find(v => v.id === s.fam) : null;
        let famVals = [null];
        if (fv) {
          const c = s.x[fv.id], fw = windowFor(fv, c);
          famVals = fw.log ? [c / 2, c, c * 2] : [c - (fw.hi - fw.lo) / 4, c, c + (fw.hi - fw.lo) / 4];
          famVals = famVals.filter(q => q >= fv.min && q <= fv.max);
        }
        famVals.forEach((fvVal, i) => {
          const x = fv ? { ...s.x, [fv.id]: fvVal } : s.x;
          const r = sweep(f, x, tv.id, xv.id, w.lo, w.hi, 110, w.log);
          curves.push({
            x: r.xs.map(q => shown(f, xv, q)), y: r.ys.map(q => shown(f, tv, q)),
            label: fv ? `${plain(fv.sym)} = ${fmtVal(shown(f, fv, fvVal), 3)}${uLabel(unitOf(f, fv))}` : '',
            color: fv ? colors[[1, 0, 2][i] ?? 0] : colors[0],
          });
        });
        const pt = isFinite(s.value) ? { x: [shown(f, xv, s.x[xv.id])], y: [shown(f, tv, s.value)], color: cssVar('--good'), line: false, points: true, pointSize: 5, label: 'current', noLegend: true } : null;
        const ys = curves.flatMap(c => c.y).filter(q => isFinite(q));
        const logy = w.log && ys.length > 1 && Math.min(...ys) > 0 && Math.max(...ys) / Math.min(...ys) > 3;
        plot.setOpts({
          xlabel: `${plain(xv.sym)}  ${xv.name.toLowerCase()}${unitOf(f, xv) === '–' ? '' : ' (' + unitOf(f, xv) + ')'}${w.log ? ', log scale' : ''}`,
          ylabel: `${plain(tv.sym)}${unitOf(f, tv) === '–' ? '' : ' (' + unitOf(f, tv) + ')'}`, logx: w.log, logy, legend: !!fv,
          xname: plain(xv.sym), yname: plain(tv.sym), xfmt: q => fmtVal(q, 4), yfmt: q => fmtVal(q, 4),
        });
        plot.setData({ series: [...curves.map(c => ({ ...c, width: 2 })), ...(pt ? [pt] : [])] });
        lastPlot = { xv, tv, curves };
      }

      // ----- concept card -----
      const block = (title, body) => h('div', { class: 'fl-block' }, h('h4', {}, title), typeof body === 'string' ? h('p', { html: body }) : body);
      const concept = h('div', { class: 'fl-concept' },
        h('h3', { class: 'fl-h3' }, 'Understand it'),
        h('div', { class: 'fl-cgrid' },
          block('What it means', f.about),
          block('Where it comes from', f.origin),
          block('When it holds', h('ul', {}, ...f.assume.map(a => h('li', {}, a)))),
          h('div', { class: 'fl-pair' }, block('Typical values', f.typical), block('Watch out', f.watch))),
        h('div', { class: 'fl-more' }, 'More background: ', linkTo({ t: t.id }, `key ideas in ${t.title}`), '.'));
      const varTable = h('div', { class: 'fl-block fl-varlist' }, h('h4', {}, 'Symbols'),
        h('table', { class: 'fl-vtable' }, ...f.vars.map(v => h('tr', {}, h('td', { class: 'sym', html: v.sym }), h('td', {}, v.name, v.desc ? h('div', { class: 'hint' }, v.desc) : null)))));
      concept.querySelector('.fl-cgrid').append(varTable);

      const rel = (f.related || []).map(id => byId[id]).filter(Boolean);
      const footer = h('div', { class: 'fl-foot' },
        rel.length ? h('div', { class: 'fl-related' }, h('h3', { class: 'fl-h3' }, 'Related formulas'), h('div', { class: 'fl-fgrid' }, ...rel.map(formulaCard))) : null,
        h('div', { class: 'fl-prevnext' },
          idx > 0 ? h('button', { class: 'btn', type: 'button', onclick: () => go({ f: siblings[idx - 1].id }) }, '← ' + siblings[idx - 1].name) : h('span'),
          idx < siblings.length - 1 ? h('button', { class: 'btn', type: 'button', onclick: () => go({ f: siblings[idx + 1].id }) }, siblings[idx + 1].name + ' →') : h('span')));

      const page = h('div', { class: 'fl-page fl-formula' }, head, eq, h('div', { class: 'fl-work' }, solveCard, plotCard), concept, footer);
      solve(); buildPlotControls();
      // the plot needs to be in the document to size itself
      requestAnimationFrame(() => {
        if (!page.isConnected) return;
        plot = new Plot(plotBox, { pad: [10, 14, 38, 62], xPad: false });
        drawPlot();
      });
      return page;
    }

    render();
    this._cleanup = () => { removeEventListener('keydown', onKey); };
  },
  unmount() { this._cleanup && this._cleanup(); },
};
