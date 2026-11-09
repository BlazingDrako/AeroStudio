// Stall: each strip of the wing follows its own section's lift curve (a simple model section, or polars computed by
// the Airfoil Lab's viscous solver at the local Reynolds number), so the wing reaches CLmax and stalls. Shows where the
// stall starts, how the wing's CL–α curve differs from the section's, and tufts on the 3-D view.
import { h, icon, segmented, field, section } from '../../lib/ui.js';
import { Plot } from '../../lib/plot.js';
import * as Wg from '../../solvers/wing.js';
import { store, schedule, wingSection, flightSection, metricsGrid, insightsList, card, css, fmt, bound, put, reStr, kt, groundH } from './common.js';
import { WingView } from './view3d.js';

// ---- Airfoil Lab polars, run in the solver's own worker and cached by section and Reynolds number ----
const polarCache = new Map();
let worker = null, sweepId = 0;
function polar(code, Re, M, onProgress) {
  const key = `${code}|${Re.toPrecision(2)}|${M.toFixed(2)}`;
  if (polarCache.has(key)) return polarCache.get(key);
  const pr = new Promise((resolve, reject) => {
    if (!worker) worker = new Worker(new URL('../../solvers/mfoil/worker.js', import.meta.url), { type: 'module' });
    const id = ++sweepId, pts = [], alphas = [];
    for (let a = -6; a <= 22; a += 1) alphas.push(a);
    const on = ev => {
      const m = ev.data; if (m.id !== id) return;
      if (m.type === 'sweepPoint') { if (m.pt.ok) pts.push(m.pt); onProgress && onProgress(m.done / m.total); }
      if (m.type === 'sweepDone') { worker.removeEventListener('message', on); resolve(pts); }
    };
    worker.addEventListener('message', on);
    worker.postMessage({ type: 'sweep', id, alphas, spec: { geom: { kind: 'naca', code, npanel: 160, flap: { xh: 0.75, eta: 0 } }, oper: { mode: 'alpha', Re: +Re.toPrecision(2), Ma: +M.toFixed(2), viscous: true, xftl: 1, xftu: 1 }, param: { ncrit: 9, niglob: 60 } } });
    setTimeout(() => reject(new Error('timed out')), 120000);
  });
  polarCache.set(key, pr);
  pr.catch(() => polarCache.delete(key));
  return pr;
}

// a section between the root's and the tip's, blended linearly; its peak found numerically
function blend(r, t, w) {
  if (w <= 0) return r; if (w >= 1) return t;
  const cl = a => (1 - w) * r.cl(a) + w * t.cl(a), cd = a => (1 - w) * r.cd(a) + w * t.cd(a);
  let aS = r.alphaStall, cM = -Infinity;
  for (let a = Math.min(r.alphaStall, t.alphaStall) - 4; a <= Math.max(r.alphaStall, t.alphaStall) + 4; a += 0.05) { const c = cl(a); if (c > cM) { cM = c; aS = a; } }
  return { cl, cd, alphaStall: aS, clmax: cM, a: (1 - w) * r.a + w * t.a };
}

export function stallTab({ keep }) {
  const S = keep({ src: 'model', clRoot: 1.5, clTip: 1.4, amax: 24, tufts: true, pressure: true });
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });
  const metrics = metricsGrid();
  const view = new WingView();
  view.setLayers({ tufts: true, wake: false, arrows: true, pressure: S.pressure });
  const vCard = card('Tufts on the wing', 'Wool tufts taped to a wing show the flow: lying straight back where it is attached (green), flipping forward and fluttering where it has separated (red). Here a strip is stalled once the angle it sees passes its section\'s stall angle. Arrows: lift along the span.');
  const status = h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap', marginBottom: '8px', alignItems: 'center' } });
  vCard.append(status, view.el);
  const aCard = card('Lift curve: wing and section', 'The wing (accent) lifts less per degree than its section (thin lines) because of downwash, reaches a lower CLmax and stalls at a higher angle. Dashed: the linear vortex lattice, which never stalls. The dot marks the first strip to stall.');
  const aPlot = new Plot(aCard, { xlabel: 'angle of attack α (°)', ylabel: 'CL, cl', xname: 'α', yname: 'CL', xfmt: v => v.toFixed(1) + '°', yfmt: v => v.toFixed(3), legendPos: 'above' });
  const sCard = card('Local cl against the section\'s cl,max', 'Where the two curves meet, the wing is stalling. The red dots are strips past their stall angle.');
  const sPlot = new Plot(sCard, { xlabel: 'spanwise position y / (b/2)', ylabel: 'local cl', xname: 'η', yname: 'cl', xfmt: v => v.toFixed(3), yfmt: v => v.toFixed(3), legendPos: 'above', yZero: true });
  const mCard = card('Stall margin along the span', 'How many degrees each strip has left before its section stalls. The lowest point is where the stall begins; you want it inboard, well away from the ailerons (shaded).');
  const mPlot = new Plot(mCard, { xlabel: 'spanwise position y / (b/2)', ylabel: 'margin (°)', xname: 'η', yname: 'margin', xfmt: v => v.toFixed(3), yfmt: v => v.toFixed(2) + '°' });
  for (const p of [sPlot, mPlot]) p.wrap.style.height = '230px';
  aPlot.wrap.style.height = '270px';
  const insCard = card('Notes'); const insEl = h('div'); insCard.append(insEl);
  main.append(metrics.el, vCard, h('div', { class: 'cf-grid2b' }, aCard, insCard), h('div', { class: 'cf-grid2b' }, sCard, mCard));

  // ---- pitch-up animation ----
  let playing = false, raf = 0;
  const play = h('button', { class: 'btn sm primary', type: 'button' });
  const paintPlay = () => play.replaceChildren(icon(playing ? 'pause' : 'play', 14), playing ? ' Pause' : ' Pitch up slowly');
  paintPlay();
  let alphaS;
  play.addEventListener('click', () => {
    playing = !playing; paintPlay();
    if (!playing) { cancelAnimationFrame(raf); schedule(); return; }
    if (store.C.alpha >= S.amax - 0.5) store.C.alpha = 0;
    let last = performance.now();
    const step = t => {
      if (!playing) return;
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      store.C.alpha = Math.min(S.amax, store.C.alpha + dt * 2.2);
      alphaS && alphaS.set(store.C.alpha);
      paintAlpha();
      if (store.C.alpha >= S.amax) { playing = false; paintPlay(); schedule(); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  });

  // ---- sections ----
  let secs = null, secMsg = '', polarState = { key: '', busy: false, prog: 0, err: '' };
  const modelSecs = () => {
    const W = store.W, beta = store.sol ? store.sol.beta : 1, a = 0.95 * 2 * Math.PI / beta;
    return { root: Wg.modelSection({ clmax: S.clRoot, alpha0: Wg.nacaAlpha0(W.root), a }), tip: Wg.modelSection({ clmax: S.clTip, alpha0: Wg.nacaAlpha0(W.tip), a }), label: 'model sections' };
  };
  const wantPolars = () => {
    const A = store.air, W = store.W, M = Math.min(0.6, A.M);
    const Rr = Math.min(5e7, Math.max(5e4, A.ReRoot)), Rt = Math.min(5e7, Math.max(5e4, A.ReTip));
    const key = `${W.root}|${Rr.toPrecision(2)}|${W.tip}|${Rt.toPrecision(2)}|${M.toFixed(2)}`;
    if (polarState.key === key && (secs && secs.key === key || polarState.busy)) return;
    polarState = { key, busy: true, prog: 0, err: '' }; paintStatus();
    const prog = f => { polarState.prog = f; paintStatus(); };
    polar(W.root, Rr, M, f => prog(f / 2)).then(pr => polar(W.tip, Rt, M, f => prog(0.5 + f / 2)).then(pt => {
      if (polarState.key !== key) return;
      const r = Wg.tableSection(pr, { alpha0: Wg.nacaAlpha0(W.root) }), t = Wg.tableSection(pt, { alpha0: Wg.nacaAlpha0(W.tip) });
      polarState.busy = false;
      if (!r || !t) { polarState.err = 'The viscous solver did not converge on enough points; using the model sections.'; paintStatus(); return; }
      secs = { root: r, tip: t, key, label: `Airfoil Lab polars at Re ${reStr(Rr)} (root) and ${reStr(Rt)} (tip)` };
      if (visible) { lastKey = geomKey(); compute(); paintAlpha(); } else sweep = null;
    })).catch(e => { if (polarState.key === key) { polarState.busy = false; polarState.err = 'Polar sweep failed: ' + e.message; paintStatus(); } });
  };
  const currentSecs = () => {
    if (S.src === 'polar') { wantPolars(); if (secs && secs.key === polarState.key) return secs; secMsg = 'model sections until the polars are ready'; return modelSecs(); }
    secMsg = ''; return modelSecs();
  };

  // ---- compute ----
  let sweep = null, now = null, used = null;
  const blends = new Map();
  const sectFor = (eta, part) => {
    const w = Math.min(1, Math.abs(eta)), k = Math.round(w * 100);
    if (!blends.has(k)) blends.set(k, blend(used.root, used.tip, k / 100));
    return blends.get(k);
  };
  const opts = () => ({ M: store.air.Mc, ground: groundH(), nS: 16, sect: sectFor });
  const compute = () => {
    used = currentSecs(); blends.clear();
    sweep = Wg.sweepAlpha(store.W, { a0: -4, a1: S.amax, step: 0.5, ...opts() });
    now = null;
  };
  const nowAt = () => {
    const a = store.C.alpha;
    let warm = sweep.pts[0]; for (const p of sweep.pts) if (Math.abs(p.alpha - a) < Math.abs(warm.alpha - a)) warm = p;
    now = Wg.nonlinear(store.W, { ...opts(), alpha: a, warm });
    return now;
  };

  // ---- controls ----
  let wingCtl, flightCtl;
  const changed = kind => { if (kind === 'preset') build(); else { wingCtl && wingCtl.update(); flightCtl && flightCtl.update(); } schedule(); };
  let lastKey = '';
  const geomKey = () => JSON.stringify([store.W, store.C.V, store.C.alt, store.C.ground, store.C.hb, S.src, S.clRoot, S.clTip, S.amax]);
  const geomChanged = () => geomKey() !== lastKey;
  const build = () => {
    const src = segmented([{ value: 'model', label: 'Model sections' }, { value: 'polar', label: 'Airfoil Lab polars' }], S.src, v => { S.src = v; build(); schedule(); });
    src.el.classList.add('seg-wrap');
    const box = section('Sections');
    put(box.body, field('Section data', src.el, '<b>Model sections</b>: a smooth lift curve with the cl,max you set. <b>Airfoil Lab polars</b>: the viscous panel solver run on the root and tip sections at their Reynolds numbers (a few seconds the first time), so cl,max and the stall angle come from the boundary layer.'),
      S.src === 'model' ? bound(S, 'clRoot', 'Root section cl,max', 0.6, 2.4, { step: 0.01, digits: 2, onInput: () => schedule(), tip: 'Typical: 1.3–1.7 for a 12% section at Re of a few million. Flaps and slats raise it.' }) : null,
      S.src === 'model' ? bound(S, 'clTip', 'Tip section cl,max', 0.6, 2.4, { step: 0.01, digits: 2, onInput: () => schedule(), tip: 'A smaller tip chord means a lower Reynolds number and usually a lower cl,max: one more reason tips stall first.' }) : null,
      bound(S, 'amax', 'Sweep up to α', 10, 30, { step: 1, digits: 0, unit: '°', onInput: () => schedule() }),
      h('div', { class: 'row', style: { marginTop: '6px' } }, play));
    wingCtl = wingSection(changed); flightCtl = flightSection(changed, { alphaRange: [-4, 30] });
    alphaS = flightCtl.alpha;
    controls.replaceChildren(box.el, flightCtl.el, wingCtl.el);
  };

  // ---- painting ----
  const paintStatus = () => {
    const bits = [];
    const lbl = used ? used.label : '';
    if (S.src === 'polar' && polarState.busy) bits.push(h('span', { class: 'regime' }, h('span', { class: 'dot', style: { background: 'var(--warn)' } }), `Running the Airfoil Lab solver… ${(polarState.prog * 100).toFixed(0)}%`));
    if (polarState.err && S.src === 'polar') bits.push(h('span', { class: 'hint', style: { margin: 0, color: 'var(--bad)' } }, polarState.err));
    bits.push(h('span', { class: 'hint', style: { margin: 0 } }, lbl + (secMsg ? ` (${secMsg})` : '')));
    status.replaceChildren(...bits);
  };
  const paintAlpha = () => {
    if (!sweep) return;
    const n = nowAt(), W = store.W, P = Wg.planform(W), A = store.air;
    const wing = n.strips.filter(s => s.part === 'wing' && s.y >= 0);
    const minM = wing.reduce((a, s) => s.margin < a.margin ? s : a, wing[0]);
    const stalledFrac = wing.filter(s => s.stalled).reduce((a, s) => a + s.len, 0) / P.s;
    const fs = sweep.firstStall;
    const CD = n.CDi + n.CDp;
    metrics.set([
      { k: 'Wing CL', v: fmt(n.CL, 3), s: `linear lattice: ${fmt(store.sol.CLa * (store.C.alpha - store.sol.alphaL0) * Math.PI / 180, 3)}`, cls: n.strips.some(s => s.stalled) ? 'warn' : '' },
      { k: 'CLmax', v: fmt(sweep.CLmax, 3), s: `at α ${sweep.alphaCLmax.toFixed(1)}° · section ${fmt(used.root.clmax, 2)}`, tip: 'The wing reaches its maximum lift when enough of the span has stalled. It is always below the section cl,max: the load is not uniform, so some stations get there first.' },
      { k: 'First stall', v: fs ? `${(fs.eta * 100).toFixed(0)}% semi-span` : 'none', s: fs ? `at α ${fs.alpha.toFixed(1)}°` : `below ${S.amax}°`, cls: fs && fs.eta > 0.6 ? 'bad' : fs ? 'good' : '', tip: 'The first strip whose effective angle passes its section\'s stall angle as α increases.' },
      { k: 'Stall margin now', v: `${minM.margin.toFixed(1)}°`, s: minM.margin < 0 ? `${(stalledFrac * 100).toFixed(0)}% of the span stalled` : `least at ${(minM.eta * 100).toFixed(0)}% semi-span`, cls: minM.margin < 0 ? 'bad' : minM.margin < 2 ? 'warn' : '' },
      { k: 'Drag CDi + CDp', v: fmt(CD, 4), s: `L/D ${(n.CL / CD).toFixed(1)} · profile ${fmt(n.CDp, 4)}`, tip: 'Induced drag from the lattice plus profile drag from each strip\'s section at its own angle. No fuselage, no interference.' },
      { k: 'Stall speed for this lift', v: kt(store.C.V * Math.sqrt(Math.max(0, n.CL) / sweep.CLmax)), s: `${(store.C.V * Math.sqrt(Math.max(0, n.CL) / sweep.CLmax)).toFixed(1)} m/s TAS at ${store.C.alt.toFixed(0)} m`, tip: 'If the wing must carry the lift it makes now, it reaches CLmax at V·√(CL/CLmax).' },
    ]);
    // spanwise plots
    const eta = wing.map(s => s.eta);
    const st = wing.filter(s => s.stalled);
    sPlot.setData({ series: [
      { x: eta, y: wing.map(s => s.cl), color: css('--accent'), label: 'local cl', width: 2.4 },
      { x: eta, y: wing.map(s => s.clmax), color: css('--bad'), dash: [5, 4], label: 'section cl,max' },
      ...(st.length ? [{ x: st.map(s => s.eta), y: st.map(s => s.cl), color: css('--bad'), points: true, line: false, pointSize: 3.5, label: 'stalled', noHover: false }] : []),
    ] });
    const [br, bg, bb] = hexRgb(css('--warn'));
    mPlot.setData({ series: [{ x: eta, y: wing.map(s => s.margin), color: css('--accent'), width: 2.4 }], hlines: [{ y: 0, color: css('--bad'), label: 'stalled' }], vbands: [{ x0: 0.6, x1: 1, color: `rgba(${br},${bg},${bb},0.10)` }] });
    // lift curve
    const pts = sweep.pts, al = pts.map(p => p.alpha);
    const lin = store.sol, alin = [-4, S.amax];
    const secA = []; for (let a = -4; a <= S.amax; a += 0.25) secA.push(a);
    aPlot.setData({ series: [
      { x: al, y: pts.map(p => p.CL), color: css('--accent'), label: 'wing (strips follow the sections)', width: 2.6 },
      { x: alin, y: alin.map(a => lin.CLa * (a - lin.alphaL0) * Math.PI / 180), color: css('--text-3'), dash: [5, 4], label: 'linear lattice' },
      { x: secA, y: secA.map(a => used.root.cl(a)), color: css('--lower'), width: 1.2, label: `root section (NACA ${W.root})` },
      ...(W.tip !== W.root || S.src === 'polar' || S.clTip !== S.clRoot ? [{ x: secA, y: secA.map(a => used.tip.cl(a)), color: css('--turb'), width: 1.2, dash: [2, 3], label: `tip section (NACA ${W.tip})` }] : []),
      ...(fs ? [{ x: [fs.alpha], y: [pts.find(p => p.alpha === fs.alpha).CL], color: css('--bad'), points: true, line: false, pointSize: 5, label: 'first stall', noLegend: true }] : []),
    ], vlines: [{ x: store.C.alpha, color: css('--text-2'), dash: [3, 3] }] });
    view.set({ sol: n.sol, strips: n.strips, ground: groundH() });
    paintStatus();
    // notes
    const L = [];
    if (fs) {
      if (fs.eta > 0.6) L.push({ type: 'b', t: 'Tip stall', d: `The stall starts at ${(fs.eta * 100).toFixed(0)}% of the semi-span, where the ailerons are. Roll control fades just when it is needed, and if one tip goes first the wing drops: the start of a spin. Fixes: washout (try −3° to −5°), a less tapered or less swept planform, a tip section with a higher cl,max, stall strips on the inboard leading edge, or slats/cuffs outboard.` });
      else if (fs.eta < 0.35) L.push({ type: 'g', t: 'Root stall: the benign kind', d: 'The stall begins inboard. The separated wake buffets the tail, warning the pilot, while the outboard wing and ailerons still work.' });
      else L.push({ type: 'w', t: `Stall begins mid-span (${(fs.eta * 100).toFixed(0)}%)`, d: 'Acceptable for most wings; a little washout moves it further inboard.' });
    }
    if (W.sweep > 15) L.push({ type: 'i', t: 'Swept wings and pitch-up', d: 'When a swept-back wing stalls at the tips, the lift that is lost is behind the centre of gravity, so the nose rises and drives the wing deeper into the stall. Fences, sawtooth leading edges and vortilons all fight this. (Spanwise boundary-layer drift, which makes it worse, is not in this strip model.)' });
    L.push({ type: 'i', t: 'Why the wing\'s CLmax is lower', d: `With uneven loading the first station reaches cl,max while the rest still has margin. Here the wing reaches CLmax ${fmt(sweep.CLmax, 2)}, ${((1 - sweep.CLmax / used.root.clmax) * 100).toFixed(0)}% below the root section's ${fmt(used.root.clmax, 2)}. Typical straight wings reach about 90% of the section value.` });
    L.push({ type: 'i', t: 'About this model', d: 'Each strip follows its 2-D section (the α-correction method on a one-panel-chord vortex lattice). It catches where and when the stall starts. Past CLmax real wings separate in 3-D and the answer depends on history, so treat the post-stall curve as a sketch.' });
    insightsList(insEl, L);
  };
  const hexRgb = c => { const m = /^#?([0-9a-f]{6})$/i.exec((c || '').trim()); if (!m) return [200, 120, 0]; const n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  // the α sweep reruns only when the wing, the flight condition or the sections change; α alone is one quick solve
  const paint = () => { if (!store.sol) return; if (geomChanged() || !sweep) { lastKey = geomKey(); compute(); } paintAlpha(); };

  let visible = false, dirty = true;
  store.subs.add(() => { if (visible) paint(); else dirty = true; });
  build();
  return {
    controls, main,
    show() { visible = true; build(); paint(); dirty = false; view.setAnimate(true); },
    hide() { visible = false; if (playing) schedule(); playing = false; paintPlay(); cancelAnimationFrame(raf); view.setAnimate(false); },
    destroy() { playing = false; cancelAnimationFrame(raf); view.destroy(); },
  };
}
