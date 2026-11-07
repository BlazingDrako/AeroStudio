// Altitude & expansion: the designed engine flown from the pad to vacuum. Thrust and Isp vs altitude, the
// over-/under-expansion regimes and flow separation, the plume changing shape, and the expansion ratio that would
// be ideal at each altitude.
import { h, section, select, field, icon, hexToRgb } from '../../lib/ui.js';
import { Plot } from '../../lib/plot.js';
import * as R from '../../solvers/rocket.js';
import { store, schedule, bound, metricsGrid, insightsList, card, put, kN, bar, REGIMES } from './common.js';
import { EngineView } from './engineView.js';

const ALTS = (() => { const a = []; for (let z = 0; z <= 90; z += z < 20 ? 0.5 : z < 40 ? 1 : 2.5) a.push(z); return a; })();

export function altitudeTab() {
  const S = store.S;
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });
  const metrics = metricsGrid();
  const view = new EngineView();
  const vcard = card('Plume at altitude', 'The same engine at the ambient pressure of the chosen altitude. Low down the nozzle is over-expanded (lip shocks pinch the jet; it may separate); higher up it is under-expanded (the jet balloons); in vacuum it fans out.');
  const regime = h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap', marginBottom: '8px' } });
  vcard.append(regime, view.el);
  const fCard = card('Thrust vs altitude', 'Fixed geometry: F = CF,vac·Pc·At − pₐAₑ until the flow separates. Dashed: the same throat and chamber with half and double the expansion ratio.');
  const fPlot = new Plot(fCard, { xlabel: 'altitude (km)', ylabel: 'thrust (kN)', xname: 'altitude', yname: 'thrust', xfmt: v => v.toFixed(1) + ' km', yfmt: v => v.toFixed(1) + ' kN', legendPos: 'bottom' });
  const iCard = card('Specific impulse vs altitude', 'The envelope (dotted) is an ideally expanded nozzle at every altitude (pₑ = pₐ): no fixed nozzle can beat it, and a fixed nozzle touches it only at its design altitude.');
  const iPlot = new Plot(iCard, { xlabel: 'altitude (km)', ylabel: 'Isp (s)', xname: 'altitude', yname: 'Isp', xfmt: v => v.toFixed(1) + ' km', yfmt: v => v.toFixed(1) + ' s', legendPos: 'bottom' });
  const eCard = card('Ideal expansion ratio vs altitude', 'Area ratio that makes pₑ = pₐ at each altitude, for this chamber pressure and propellant. It grows without limit toward vacuum; real nozzles stop where weight and length outweigh the gain.');
  const ePlot = new Plot(eCard, { xlabel: 'altitude (km)', ylabel: 'ideal Ae/At', xname: 'altitude', yname: 'ε', logy: true, xfmt: v => v.toFixed(1) + ' km', yfmt: v => v.toFixed(1) });
  const insCard = card('Notes'); const insEl = h('div'); insCard.append(insEl);
  for (const p of [fPlot, iPlot]) p.wrap.style.height = '260px';
  ePlot.wrap.style.height = '220px';
  main.append(metrics.el, vcard, h('div', { class: 'cf-grid2b' }, fCard, iCard), h('div', { class: 'cf-grid2b' }, eCard, insCard));

  let playing = false, raf = null;
  const play = h('button', { class: 'btn sm primary', type: 'button' });
  const paintPlay = () => play.replaceChildren(icon(playing ? 'pause' : 'play', 14), playing ? ' Pause' : ' Fly an ascent');
  paintPlay();
  let altS;
  play.addEventListener('click', () => {
    playing = !playing; paintPlay();
    if (!playing) { cancelAnimationFrame(raf); return; }
    if (S.alt >= 89) S.alt = 0;
    let last = performance.now();
    const step = t => {
      if (!playing) return;
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      // roughly a real ascent: slow off the pad, then accelerating; ~12 s of animation to 90 km
      S.alt = Math.min(90, S.alt + dt * (2 + S.alt * 0.35));
      altS.set(S.alt); paintAlt();
      if (S.alt >= 90) { playing = false; paintPlay(); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  });

  const build = () => {
    const secA = section('Altitude');
    altS = bound(S, 'alt', 'Altitude', 0, 90, { step: 0.1, digits: 1, unit: 'km', onInput: () => paintAlt(), tip: 'US Standard Atmosphere 1976; above 86 km treated as vacuum.' });
    put(secA.body, altS, h('div', { class: 'row', style: { marginBottom: '10px' } }, play));
    const secS = section('Flow separation');
    put(secS.body, field('Criterion', select(Object.entries(R.SEP_CRITERIA).map(([value, label]) => ({ value, label })), S.sepModel || 'kb', v => { S.sepModel = v; build(); schedule(); }),
      'Where an over-expanded nozzle separates is empirical. <b>Kalt–Badal</b>: p_sep/pₐ = 0.667(Pc/pₐ)^−0.2. <b>Schmucker</b>: p_sep/pₐ = (1.88 M − 1)^−0.64. <b>Summerfield</b>: a fixed fraction k (0.25–0.4).'),
      S.sepModel === 'summerfield' ? bound(S, 'sep', 'Separation pressure k', 0.15, 0.6, { step: 0.01, digits: 2, onInput: () => schedule(), tip: 'Separation where wall pressure < k·pₐ.' }) : null);
    const secD = section('Design (shared with Engine design)');
    put(secD.body, bound(S, 'eps', 'Expansion ratio Ae/At', 1.5, 300, { log: true, digits: 1, onInput: () => { S.preset = ''; schedule(); } }),
      bound(S, 'Pc', 'Chamber pressure Pc', 3, 350, { log: true, digits: 1, unit: 'bar', onInput: () => { S.preset = ''; schedule(); } }),
      h('div', { class: 'hint' }, 'Changing these resizes the engine for the same thrust requirement.'));
    controls.replaceChildren(secA.el, secS.el, secD.el);
  };

  let curves = null;
  const computeCurves = () => {
    const D = store.D;
    const alt = (eps) => {
      const Dx = eps === S.eps ? D : R.design({ ...S, eps });
      return ALTS.map(z => { const p = Dx.perf(R.ambient(z * 1000)); return { F: p.Isp * G * D.mdot / 1e3, Isp: p.Isp, sep: p.sep, regime: p.regime }; });
    };
    const G = R.G0;
    const env = ALTS.map(z => { const pa = R.ambient(z * 1000); return pa > 0 ? R.adaptedIsp(D, pa) : { Isp: NaN, eps: NaN }; });
    curves = { cur: alt(S.eps), half: alt(Math.max(1.5, S.eps / 2)), dbl: alt(Math.min(400, S.eps * 2)), env };
    // design altitude: where pe = pa
    let zd = NaN; for (let i = 1; i < ALTS.length; i++) { const a = R.ambient(ALTS[i - 1] * 1000), b = R.ambient(ALTS[i] * 1000); if (a >= D.pe && b < D.pe) { zd = ALTS[i - 1] + (ALTS[i] - ALTS[i - 1]) * Math.log(a / D.pe) / Math.log(a / b); break; } }
    curves.zd = zd;
    // separation band
    const sepIdx = curves.cur.map((c, i) => c.sep ? i : -1).filter(i => i >= 0);
    curves.sepTop = sepIdx.length ? ALTS[sepIdx[sepIdx.length - 1]] : NaN;
  };
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const paintCurves = () => {
    const c = curves, D = store.D;
    const [br, bg, bb] = hexToRgb(css('--bad'));
    const vband = isFinite(c.sepTop) ? [{ x0: 0, x1: c.sepTop, color: `rgba(${br},${bg},${bb},0.12)` }] : [];
    const vl = [{ x: S.alt, color: css('--text-2'), dash: [3, 3] }]; if (isFinite(c.zd)) vl.push({ x: c.zd, color: css('--good'), dash: [2, 4] });
    fPlot.setData({ series: [
      { x: ALTS, y: c.cur.map(v => v.F), color: css('--accent'), label: `ε ${S.eps.toFixed(0)}`, width: 2.4 },
      { x: ALTS, y: c.half.map(v => v.F), color: css('--lower'), dash: [5, 4], label: `ε ${(S.eps / 2).toFixed(0)}` },
      { x: ALTS, y: c.dbl.map(v => v.F), color: css('--turb'), dash: [5, 4], label: `ε ${(S.eps * 2).toFixed(0)}` },
    ], vlines: vl, vbands: vband });
    iPlot.setData({ series: [
      { x: ALTS, y: c.cur.map(v => v.Isp), color: css('--accent'), label: `ε ${S.eps.toFixed(0)}`, width: 2.4 },
      { x: ALTS, y: c.half.map(v => v.Isp), color: css('--lower'), dash: [5, 4], label: `ε ${(S.eps / 2).toFixed(0)}` },
      { x: ALTS, y: c.dbl.map(v => v.Isp), color: css('--turb'), dash: [5, 4], label: `ε ${(S.eps * 2).toFixed(0)}` },
      { x: ALTS, y: c.env.map(v => v.Isp), color: css('--text-3'), dash: [1.5, 3], label: 'ideal expansion' },
    ], vlines: vl, vbands: vband });
    ePlot.setData({ series: [{ x: ALTS, y: c.env.map(v => v.eps), color: css('--accent'), label: 'ideal ε' }], hlines: [{ y: S.eps, color: css('--text-3'), label: `this nozzle: ε ${S.eps.toFixed(0)}` }], vlines: vl });
    const L = [];
    if (isFinite(c.zd)) L.push({ type: 'g', t: `Design altitude ≈ ${c.zd.toFixed(1)} km`, d: `Exit pressure ${bar(D.pe)} equals ambient here. Below it the nozzle is over-expanded, above it under-expanded.` });
    else if (D.pe > 101325) L.push({ type: 'i', t: 'Under-expanded even at sea level', d: 'Exit pressure is above 1 atm, so a longer nozzle would help at every altitude. Typical of high-Pc engines with a modest ε, or of small sounding-rocket motors.' });
    if (isFinite(c.sepTop)) L.push({ type: 'b', t: `Separated below ${c.sepTop.toFixed(1)} km`, d: `The ${R.SEP_CRITERIA[S.sepModel || 'kb']} criterion predicts the jet leaves the wall inside the nozzle until the ambient pressure falls enough. Thrust shown there is for the separated (shorter-acting) nozzle.` });
    const g = c.cur[0].Isp > 0 ? (c.cur[c.cur.length - 1].Isp / c.cur[0].Isp - 1) * 100 : NaN;
    if (isFinite(g)) L.push({ type: 'i', t: `Vacuum Isp is ${g.toFixed(0)}% above sea level`, d: `All of the gain is the pressure term: the atmosphere pushes back on the exit area with pₐAₑ = ${kN(101325 * D.Ae)} at sea level.` });
    L.push({ type: 'i', t: 'Why not just fit a huge nozzle?', d: 'Doubling ε adds vacuum Isp with diminishing returns while the nozzle mass and length grow roughly with Aₑ. Boosters also cannot separate on the pad, which caps ε near 15–40. Altitude-compensating designs (aerospikes, dual-bell, extendible nozzles) try to follow the envelope.' });
    insightsList(insEl, L);
  };
  const paintAlt = () => {
    const D = store.D; if (!D) return;
    const pa = R.ambient(S.alt * 1000), pf = D.perf(pa), P = R.plume(D, pa);
    metrics.set([
      { k: 'Ambient pressure', v: pa > 0 ? bar(pa) : '0 (vacuum)', s: `${S.alt.toFixed(1)} km` },
      { k: 'Thrust', v: kN(pf.F), s: `${((pf.F / D.vac.F) * 100).toFixed(1)}% of vacuum`, cls: pf.sep ? 'bad' : '' },
      { k: 'Isp', v: pf.Isp.toFixed(1) + ' s', s: `CF ${pf.CF.toFixed(3)}` },
      { k: 'pₑ / pₐ', v: pa > 0 ? (D.pe / pa).toFixed(3) : '∞', s: REGIMES[pf.regime][0] },
      { k: 'Jet Mach (expanded)', v: isFinite(P.Mj) ? P.Mj.toFixed(2) : '∞', s: `exit M ${P.Me.toFixed(2)}`, tip: 'Mach number the jet reaches once its pressure matches ambient.' },
      { k: 'Shock-cell length', v: isFinite(P.cell) ? P.cell.toFixed(2) + ' m' : '—', s: P.machDisk ? 'with a Mach disk' : isFinite(P.cell) ? 'regular diamonds' : 'none in vacuum', tip: 'Spacing of the Mach diamonds, ≈ 1.22·Dj·√(Mj² − 1) (Tam).' },
    ]);
    const [rl, rc] = REGIMES[pf.regime];
    regime.replaceChildren(h('span', { class: 'regime' }, h('span', { class: 'dot', style: { background: `var(${rc})` } }), rl),
      h('span', { class: 'hint', style: { margin: 0 } }, pf.sep ? `separates where p = ${bar(pf.ps)} (A/At ${pf.epsSep.toFixed(1)})` : P.regime === 'over' ? `lip shock angle ${(P.beta * 57.3).toFixed(1)}°${P.machDisk ? ', Mach disk' : ''}` : P.regime === 'under' ? `jet turns out ${(P.delta * 57.3).toFixed(1)}° at the lip` : ''));
    view.set({ D, pa });
    if (curves) {
      const vl = [{ x: S.alt, color: css('--text-2'), dash: [3, 3] }]; if (isFinite(curves.zd)) vl.push({ x: curves.zd, color: css('--good'), dash: [2, 4] });
      for (const p of [fPlot, iPlot, ePlot]) { p.data.vlines = vl; p.draw(); }
    }
  };
  const paint = () => { if (!store.D) return; computeCurves(); paintCurves(); paintAlt(); };

  let visible = false, dirty = true;
  store.subs.add(() => { if (visible) paint(); else dirty = true; });
  build();
  return {
    controls, main,
    show() { visible = true; build(); if (dirty) paint(); else paintAlt(); dirty = false; },
    hide() { visible = false; playing = false; paintPlay(); cancelAnimationFrame(raf); },
    destroy() { playing = false; cancelAnimationFrame(raf); view.destroy(); },
  };
}
