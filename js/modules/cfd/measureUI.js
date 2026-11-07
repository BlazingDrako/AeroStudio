// Measurement panel for the sandbox: drag and lift on each obstacle over time (with Strouhal number),
// velocity probes (time history and spectrum) and a velocity profile along a line.
import { h, info, segmented, select, downloadText, cssVar } from '../../lib/ui.js';
import { Plot } from '../../lib/plot.js';
import { meanOf, rmsAbout, windowFrom, crossingFreq, spectrum } from './measure.js';
import { shapeLabel } from './shapes.js';

const MAX_SAMPLES = 6000;
const WINDOW = 40;          // statistics over the last 40 L/U
const SETTLE = 15;          // no statistics before t = 15 L/U
export const MAX_PROBES = 4;
export const probeColor = i => ['#4c8dff', '#ff8a3d', '#2fbf7f', '#b26bff'][i % 4];

function card(title, tip, right, ...children) {
  return h('div', { class: 'plot-card' }, h('div', { class: 'plot-head' }, h('div', { class: 'row' }, h('h4', {}, title), tip ? info(tip) : null), h('div', { class: 'row' }, ...right)), ...children);
}
const btn = (label, title, fn) => { const b = h('button', { class: 'btn sm', type: 'button', title }, label); b.addEventListener('click', fn); return b; };
const csv = rows => rows.map(r => r.map(v => (typeof v === 'number' ? (isFinite(v) ? +v.toPrecision(7) : '') : v)).join(',')).join('\n');

// env: { solver(), geo(), U, refL(), sym(), scene() }
export function createMeasure(env) {
  const st = { t: [], it: [], bodies: new Map(), probes: [], line: null, target: null, probeView: 'history', probeQ: 'uy' };
  const lineName = () => env.sym();

  // ---- forces card
  const targetSel = h('select', { class: 'select', 'aria-label': 'Obstacle to show forces for' });
  targetSel.addEventListener('change', () => { st.target = +targetSel.value; refresh(true); });
  const fStats = h('div', { class: 'fs-stats' });
  const forcesCard = card('Forces on', 'Drag (along the flow) and lift (across it) from the momentum the fluid exchanges with the obstacle\'s walls, as coefficients C = F / (½ρU²·size), with the obstacle\'s own size (diameter, side, length or chord). Statistics use the last 40 time units once the flow has settled.',
    [targetSel, btn('CSV', 'Download the force history', () => exportForces())], fStats);
  const fPlot = new Plot(forcesCard, { xlabel: 't · U / L', ylabel: 'coefficient', xname: 't', yname: 'C', xfmt: v => v.toFixed(2), yfmt: v => v.toFixed(3), pad: [8, 12, 30, 46] });
  fPlot.wrap.style.height = '200px';

  // ---- probes card
  const probeSeg = segmented([{ value: 'history', label: 'History' }, { value: 'spectrum', label: 'Spectrum' }], 'history', v => { st.probeView = v; refresh(true); });
  const qSel = select([{ value: 'uy', label: 'Cross-flow v' }, { value: 'ux', label: 'Stream-wise u' }, { value: 'sp', label: 'Speed |u|' }, { value: 'cp', label: 'Pressure Cp' }], 'uy', v => { st.probeQ = v; refresh(true); }, { 'aria-label': 'Probe quantity' });
  const pStats = h('div', { class: 'fs-stats' });
  const probesCard = card('Probes', 'Velocity or pressure recorded at the probe points (place them with the Probe tool). The spectrum shows which frequencies the signal contains; the frequency is given as f·L/U, which is the Strouhal number when L is the body size.',
    [qSel, btn('CSV', 'Download the probe histories', () => exportProbes()), btn('Clear', 'Remove all probes', () => { st.probes = []; refresh(true); })], h('div', { style: { margin: '2px 0 4px' } }, probeSeg.el), pStats);
  const pPlot = new Plot(probesCard, { xlabel: 't · U / L', ylabel: 'v / U', xname: 't', yname: 'value', xfmt: v => v.toFixed(3), yfmt: v => v.toFixed(4), pad: [8, 12, 30, 46] });
  pPlot.wrap.style.height = '200px';

  // ---- profile card
  const lStats = h('div', { class: 'fs-stats' });
  const profileCard = card('Velocity along the line', 'Velocity components sampled along the line you drew with the Line tool, against distance along it.',
    [btn('CSV', 'Download the profile', () => exportProfile()), btn('Remove', 'Remove the line', () => { st.line = null; refresh(true); })], lStats);
  const lPlot = new Plot(profileCard, { xlabel: 'distance along the line / L', ylabel: 'velocity / U', xname: 's', yname: 'u', xfmt: v => v.toFixed(3), yfmt: v => v.toFixed(4), pad: [8, 12, 30, 46] });
  lPlot.wrap.style.height = '200px';

  const el = h('div', { class: 'fs-measure' }, forcesCard, probesCard, profileCard);
  const hint = h('div', { class: 'hint fs-mhint' }, 'Forces appear here for every obstacle you can move. Place probes or draw a line with the tools under Measure.');

  // ---------------- data
  const bodies = () => env.geo().objects.filter(o => !o.locked);
  function reset() { st.t = []; st.it = []; st.bodies = new Map(); for (const p of st.probes) { p.t = []; p.ux = []; p.uy = []; p.cp = []; } }
  function trim() {
    if (st.t.length <= MAX_SAMPLES) return;
    const cut = st.t.length - MAX_SAMPLES / 2;
    st.t.splice(0, cut); st.it.splice(0, cut);
    for (const b of st.bodies.values()) { b.cd.splice(0, cut); b.cl.splice(0, cut); }
  }
  function sample() {
    const s = env.solver(); if (!s || !s.S) return;
    const U = env.U, Lr = env.refL(), t = s.iter * U / Lr;
    if (st.t.length && s.iter <= st.it[st.it.length - 1]) return;
    const objs = bodies(), F = s.bodyForces(objs);
    st.t.push(t); st.it.push(s.iter);
    const n = st.t.length;
    objs.forEach((o, i) => {
      let b = st.bodies.get(o.id);
      if (!b) { b = { cd: new Array(n - 1).fill(NaN), cl: new Array(n - 1).fill(NaN) }; st.bodies.set(o.id, b); }
      const q = 0.5 * U * U * o.size;
      b.cd.push(F[i][0] / q); b.cl.push(F[i][1] / q);
    });
    for (const [id, b] of st.bodies) if (b.cd.length < n) { b.cd.push(NaN); b.cl.push(NaN); if (!objs.some(o => o.id === id) && b.cd.slice(-50).every(v => isNaN(v))) st.bodies.delete(id); }
    for (const p of st.probes) {
      const i = Math.min(s.nx - 1, Math.max(0, Math.floor(p.x))), j = Math.min(s.ny - 1, Math.max(0, Math.floor(p.y)));
      const m = s.probe(i, j);
      p.t.push(t); p.ux.push(m.ux / U); p.uy.push(m.uy / U); p.cp.push((m.rho - 1) / 3 / (0.5 * U * U));
      if (p.t.length > MAX_SAMPLES) for (const k of ['t', 'ux', 'uy', 'cp']) p[k].splice(0, MAX_SAMPLES / 2);
    }
    trim();
  }
  // statistics for one body: mean drag, lift mean and amplitude, Strouhal number from the lift
  function bodyStats(o) {
    const b = o && st.bodies.get(o.id); if (!b || !st.t.length) return null;
    const tEnd = st.t[st.t.length - 1];
    if (tEnd < SETTLE) return { settling: true, t: tEnd };
    const from = Math.max(SETTLE * 0.6, tEnd - WINDOW);
    const wd = windowFrom(st.t, b.cd, from), wl = windowFrom(st.t, b.cl, from);
    const ok = i => isFinite(wd.v[i]) && isFinite(wl.v[i]);
    const tt = [], cd = [], cl = []; wd.t.forEach((x, i) => { if (ok(i)) { tt.push(x); cd.push(wd.v[i]); cl.push(wl.v[i]); } });
    if (cd.length < 10) return { settling: true, t: tEnd };
    const out = { cd: meanOf(cd), cl: meanOf(cl), clAmp: rmsAbout(cl) * Math.SQRT2, cdRms: rmsAbout(cd), span: tt[tt.length - 1] - tt[0] };
    const cf = out.clAmp > 0.01 ? crossingFreq(tt, cl) : null;
    out.St = cf ? cf.f * o.size / env.refL() : NaN;
    out.shedding = !!cf;
    return out;
  }
  const targetObj = () => { const objs = bodies(); return objs.find(o => o.id === st.target) || objs.find(o => o.ref) || objs[0] || null; };

  // ---------------- profile along the line
  function profile() {
    const s = env.solver(), L = st.line; if (!s || !s.S || !L) return null;
    const len = Math.hypot(L.x1 - L.x0, L.y1 - L.y0); if (len < 2) return null;
    const x0 = Math.max(0, Math.floor(Math.min(L.x0, L.x1)) - 1), y0 = Math.max(0, Math.floor(Math.min(L.y0, L.y1)) - 1);
    const x1 = Math.min(s.nx - 1, Math.ceil(Math.max(L.x0, L.x1)) + 1), y1 = Math.min(s.ny - 1, Math.ceil(Math.max(L.y0, L.y1)) + 1);
    const w = x1 - x0 + 1, M = s.readMacro(x0, y0, w, y1 - y0 + 1), geo = env.geo();
    const n = Math.max(8, Math.round(len)), U = env.U, Lr = env.refL(), out = { s: [], x: [], y: [], ux: [], uy: [], sp: [] };
    for (let k = 0; k <= n; k++) {
      const x = L.x0 + (L.x1 - L.x0) * k / n, y = L.y0 + (L.y1 - L.y0) * k / n;
      const fx = x - 0.5 - x0, fy = y - 0.5 - y0, i = Math.max(0, Math.min(w - 2, Math.floor(fx))), j = Math.max(0, Math.min(y1 - y0 - 1, Math.floor(fy)));
      const tx = Math.min(1, Math.max(0, fx - i)), ty = Math.min(1, Math.max(0, fy - j));
      const gi = Math.min(geo.nx - 1, Math.floor(x)), gj = Math.min(geo.ny - 1, Math.floor(y));
      const solid = geo.cells[gj * geo.nx + gi] === 1;
      const at = (a, ii, jj) => a[jj * w + ii];
      const bil = a => (1 - ty) * ((1 - tx) * at(a, i, j) + tx * at(a, i + 1, j)) + ty * ((1 - tx) * at(a, i, j + 1) + tx * at(a, i + 1, j + 1));
      const ux = solid ? NaN : bil(M.ux) / U, uy = solid ? NaN : bil(M.uy) / U;
      out.s.push(len * k / n / Lr); out.x.push(x); out.y.push(y); out.ux.push(ux); out.uy.push(uy); out.sp.push(Math.hypot(ux, uy));
    }
    out.len = len;
    return out;
  }

  // ---------------- drawing the cards
  let lastTargets = '';
  function refresh() {
    const css = cssVar, c1 = css('--accent'), c2 = css('--lower'), c3 = css('--text-3');
    // target list
    const objs = bodies();
    const names = objs.map((o, i) => `${o.id}:${shapeLabel(o.type)} ${objs.filter((p, k) => k < i && p.type === o.type).length + 1}`);
    if (names.join('|') !== lastTargets) {
      lastTargets = names.join('|');
      targetSel.replaceChildren(...objs.map((o, i) => h('option', { value: o.id }, names[i].split(':')[1] + (o.ref ? ' (reference)' : ''))));
      const t = targetObj(); if (t) { targetSel.value = t.id; st.target = t.id; }
    }
    const o = targetObj();
    forcesCard.style.display = o ? '' : 'none';
    if (o) {
      const b = st.bodies.get(o.id), S = bodyStats(o);
      if (b) { // skip the impulsive start (t < 3), whose spike would squash the rest of the plot
        let i0 = 0; while (i0 < st.t.length - 2 && st.t[i0] < 3) i0++;
        const x = st.t.slice(i0);
        fPlot.setData({ series: [{ x, y: b.cd.slice(i0), color: c1, label: 'drag C_D' }, { x, y: b.cl.slice(i0), color: c2, label: 'lift C_L' }], hlines: [{ y: 0, color: c3, dash: [3, 3], bound: false }] });
      }
      const kv = (k, v, tip) => h('div', { class: 'fs-stat' }, h('span', {}, k, tip ? info(tip) : null), h('b', {}, v));
      if (!S || S.settling) fStats.replaceChildren(kv('Status', S ? `settling (t = ${S.t.toFixed(1)}, statistics from t = ${SETTLE})` : 'waiting for data'));
      else {
        const items = [kv('Mean drag C_D', S.cd.toFixed(3)), kv(S.shedding ? 'Lift amplitude' : 'Mean lift C_L', S.shedding ? '±' + S.clAmp.toFixed(3) : S.cl.toFixed(3))];
        if (S.shedding) items.push(kv('Strouhal St', S.St.toFixed(4), 'Shedding frequency f·size/U, from the lift oscillation.'));
        else items.push(kv('Wake', 'steady'));
        if (o.type === 'airfoil' && Math.abs(S.cd) > 1e-6) items.push(kv('Lift / drag', (S.cl / S.cd).toFixed(2)), kv('Mean lift C_L', S.cl.toFixed(3)));
        fStats.replaceChildren(...items);
      }
    }
    // probes
    probesCard.style.display = st.probes.length ? '' : 'none';
    if (st.probes.length) {
      const lab = { uy: 'v / U', ux: 'u / U', sp: '|u| / U', cp: 'Cp' }[st.probeQ];
      const val = p => (st.probeQ === 'sp' ? p.ux.map((u, i) => Math.hypot(u, p.uy[i])) : p[st.probeQ]);
      const sym = lineName();
      if (st.probeView === 'history') {
        pPlot.setOpts({ xlabel: `t · U / ${sym}`, ylabel: lab, xname: 't', yname: lab });
        pPlot.setData({ series: st.probes.map((p, i) => ({ x: p.t, y: val(p), color: probeColor(i), label: `probe ${i + 1}` })) });
        pStats.replaceChildren();
      } else {
        const sp = st.probes.map(p => { const w = windowFrom(p.t, val(p), Math.max(SETTLE * 0.6, (p.t[p.t.length - 1] || 0) - 2 * WINDOW)); return spectrum(w.t, w.v); });
        pPlot.setOpts({ xlabel: `frequency f · ${sym} / U`, ylabel: 'amplitude', xname: `f·${sym}/U`, yname: 'amplitude' });
        pPlot.setData({ series: sp.map((S, i) => (S ? { x: S.f.filter(f => f <= 1.2), y: S.a.slice(0, S.f.filter(f => f <= 1.2).length), color: probeColor(i), label: `probe ${i + 1}` } : null)).filter(Boolean) });
        pStats.replaceChildren(...sp.map((S, i) => (S && S.peak ? h('div', { class: 'fs-stat' }, h('span', { style: { color: probeColor(i) } }, `probe ${i + 1} peak`), h('b', {}, `f·${sym}/U = ${S.peak.f.toFixed(3)}`)) : null)).filter(Boolean));
      }
    }
    // profile
    profileCard.style.display = st.line ? '' : 'none';
    if (st.line) {
      const P = profile();
      if (P) {
        const sym = lineName(), series = [{ x: P.s, y: P.ux, color: c1, label: 'u / U (along x)' }, { x: P.s, y: P.uy, color: c2, label: 'v / U (along y)' }, { x: P.s, y: P.sp, color: c3, label: '|u| / U', dash: [4, 3], width: 1.3 }];
        const sc = env.scene();
        if (sc.id === 'channel' && Math.abs(st.line.x1 - st.line.x0) < 0.2 * P.len) { // exact Poiseuille profile across the channel
          const H = env.geo().ny;
          series.push({ x: P.s, y: P.y.map(y => 4 * y * (H - y) / (H * H)), color: css('--good') || '#2fbf7f', label: 'exact Poiseuille', dash: [6, 4], width: 1.4 });
        }
        lPlot.setOpts({ xlabel: `distance along the line / ${sym}` });
        lPlot.setData({ series, hlines: [{ y: 0, color: c3, dash: [3, 3], bound: false }] });
        const fin = P.sp.filter(isFinite);
        lStats.replaceChildren(h('div', { class: 'fs-stat' }, h('span', {}, 'Line length'), h('b', {}, `${(P.len / env.refL()).toFixed(2)} ${sym}`)), h('div', { class: 'fs-stat' }, h('span', {}, 'Max speed'), h('b', {}, fin.length ? (Math.max(...fin)).toFixed(3) + ' U' : '—')));
      }
    }
    hint.style.display = !o && !st.probes.length && !st.line ? '' : 'none';
  }

  // ---------------- exports
  function exportForces() {
    const objs = bodies(), ids = objs.map(o => o.id).filter(id => st.bodies.has(id));
    const head = ['t_U_over_L', 'step', ...ids.flatMap(id => { const o = objs.find(x => x.id === id); return [`${o.type}${id}_Cd`, `${o.type}${id}_Cl`]; })];
    const rows = st.t.map((t, i) => [t, st.it[i], ...ids.flatMap(id => [st.bodies.get(id).cd[i], st.bodies.get(id).cl[i]])]);
    downloadText(`forces-${env.scene().id}.csv`, csv([head, ...rows]));
  }
  function exportProbes() {
    const rows = [['probe', 'x_cells', 'y_cells', 't_U_over_L', 'u_over_U', 'v_over_U', 'Cp']];
    st.probes.forEach((p, k) => p.t.forEach((t, i) => rows.push([k + 1, p.x, p.y, t, p.ux[i], p.uy[i], p.cp[i]])));
    downloadText(`probes-${env.scene().id}.csv`, csv(rows));
  }
  function exportProfile() {
    const P = profile(); if (!P) return;
    const rows = [['s_over_L', 'x_cells', 'y_cells', 'u_over_U', 'v_over_U', 'speed_over_U'], ...P.s.map((s, i) => [s, P.x[i], P.y[i], P.ux[i], P.uy[i], P.sp[i]])];
    downloadText(`profile-${env.scene().id}.csv`, csv(rows));
  }

  // ---------------- editing probes and the line
  function toggleProbe(x, y) {
    const k = st.probes.findIndex(p => Math.hypot(p.x - x, p.y - y) < 5);
    if (k >= 0) st.probes.splice(k, 1);
    else if (st.probes.length < MAX_PROBES) st.probes.push({ x, y, t: [], ux: [], uy: [], cp: [] });
    refresh(true);
  }
  function setLine(L) { st.line = L; refresh(true); }
  function scale(f) { for (const p of st.probes) { p.x *= f; p.y *= f; } if (st.line) for (const k of ['x0', 'y0', 'x1', 'y1']) st.line[k] *= f; }
  function drawOverlay(g, px, py, dpr) {
    if (st.line) {
      const L = st.line;
      g.strokeStyle = cssVar('--text'); g.lineWidth = 2 * dpr; g.setLineDash([]);
      g.beginPath(); g.moveTo(px(L.x0), py(L.y0)); g.lineTo(px(L.x1), py(L.y1)); g.stroke();
      for (const [x, y] of [[L.x0, L.y0], [L.x1, L.y1]]) { g.beginPath(); g.arc(px(x), py(y), 3.5 * dpr, 0, 2 * Math.PI); g.fillStyle = cssVar('--text'); g.fill(); }
    }
    st.probes.forEach((p, i) => {
      const X = px(p.x), Y = py(p.y), r = 7 * dpr;
      g.fillStyle = probeColor(i); g.strokeStyle = cssVar('--bg-elev'); g.lineWidth = 1.5 * dpr;
      g.beginPath(); g.arc(X, Y, r, 0, 2 * Math.PI); g.fill(); g.stroke();
      g.fillStyle = '#fff'; g.font = `600 ${9 * dpr}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(i + 1), X, Y + 0.5);
    });
  }
  return { el, hint, reset, sample, refresh, bodyStats, targetObj, toggleProbe, setLine, scale, drawOverlay, get line() { return st.line; }, get probes() { return st.probes; }, clearProbes() { st.probes = []; st.line = null; refresh(true); } };
}
