// Winglets & span: what a winglet buys in induced drag, what it costs in root bending moment, and how it compares
// with simply extending the span by an amount that adds the same bending moment (the fair comparison, after Jones).
import { h, section, toggle } from '../../lib/ui.js';
import { Plot } from '../../lib/plot.js';
import * as Wg from '../../solvers/wing.js';
import { store, schedule, wingSection, flightSection, metricsGrid, insightsList, card, css, fmt, pct, bound, put, groundH } from './common.js';
import { WingView } from './view3d.js';

export function wingletTab() {
  const W = store.W, C = store.C;
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });
  const metrics = metricsGrid();
  const view = new WingView();
  view.setLayers({ wake: true, arrows: true, pressure: true });
  const vCard = card('Wing with winglets', 'The winglet carries an inward side force (arrows), which turns the tip vortex flow and leaves less energy in the wake. Use the Front button to see it end-on.');
  vCard.append(view.el);
  const lCard = card('Load along the span and up the winglet', 'c·cl/c̄ against distance along the wing and then up the winglet (past 1). Without a winglet the load must fall to zero at the tip; a winglet lets it stay higher there.');
  const lPlot = new Plot(lCard, { xlabel: 'distance along the span and winglet / (b/2)', ylabel: 'c·cl / c̄', xname: 's', yname: 'load', xfmt: v => v.toFixed(3), yfmt: v => v.toFixed(3), legendPos: 'above', yZero: true });
  const gCard = card('Induced-drag saving against winglet height', 'At the same lift. Accent: this winglet (current cant). Dashed: the same added length laid flat as a span extension. Green: a span extension sized to add the same root bending moment as the winglet, the fair structural comparison.');
  const gPlot = new Plot(gCard, { xlabel: 'winglet height / semi-span', ylabel: 'change in induced drag (%)', xname: 'h', yname: 'ΔCDi', xfmt: v => v.toFixed(3), yfmt: v => v.toFixed(1) + '%', legendPos: 'above' });
  for (const p of [lPlot, gPlot]) p.wrap.style.height = '260px';
  const insCard = card('Notes'); const insEl = h('div'); insCard.append(insEl);
  main.append(metrics.el, vCard, h('div', { class: 'cf-grid2b' }, lCard, gCard), insCard);

  let wingCtl, flightCtl;
  const changed = kind => { if (kind === 'preset') build(); else { wingCtl && wingCtl.update(); flightCtl && flightCtl.update(); } schedule(); };
  const build = () => {
    const g = W.winglet, sw = section('Winglet');
    const on = () => { W.preset = ''; schedule(); };
    put(sw.body, toggle('Fit winglets', g.on, v => { g.on = v; W.preset = ''; build(); schedule(); }, { tip: 'Adds a winglet at each tip. It stays on in the other tabs until you switch it off here.' }).el,
      bound(g, 'h', 'Height', 0.02, 0.35, { step: 0.005, digits: 3, unit: 'semi-spans', onInput: on, tip: 'Winglet length as a fraction of the semi-span. Airliners: about 0.08–0.15.' }),
      bound(g, 'cant', 'Cant from vertical', 0, 90, { step: 1, digits: 0, unit: '°', onInput: on, tip: '0° is vertical; 90° lays it flat, making it a span extension. Blended winglets are canted 15–30°.' }),
      bound(g, 'taper', 'Winglet taper', 0.1, 1, { step: 0.01, digits: 2, onInput: on }),
      bound(g, 'sweep', 'Winglet leading-edge sweep', 0, 60, { step: 1, digits: 0, unit: '°', onInput: on }),
      h('div', { class: 'hint' }, g.on ? 'The winglet is part of the wing in every tab while it is fitted.' : 'Off: the comparisons below still show what this winglet would do.'));
    wingCtl = wingSection(changed); flightCtl = flightSection(changed);
    controls.replaceChildren(sw.el, flightCtl.el, wingCtl.el);
  };

  let cKey = '', curve = null;
  const paint = () => {
    if (!store.sol) return;
    const M = store.air.Mc, gr = groundH();
    const Woff = { ...W, winglet: { ...W.winglet, on: false } }, Won = { ...W, winglet: { ...W.winglet, on: true } };
    const s0 = Wg.analyze(Woff, { alpha: C.alpha, M, ground: gr }), s1 = Wg.analyze(Won, { alpha: C.alpha, M, ground: gr });
    const k0 = s0.CDi / s0.CL ** 2, k1 = s1.CDi / s1.CL ** 2;
    const mb0 = s0.Mb / s0.CL, mb1 = s1.Mb / s1.CL;   // bending moment per unit lift
    const ext = Wg.equalMomentExtension(Woff, s1, { alpha: C.alpha, M, nS: 16, nC: 3 });
    const kExt = ext.CDiF / s1.CL ** 2;               // same lift as the winglet case, same reference area
    metrics.set([
      { k: 'Span efficiency e', v: fmt(s1.e, 4), s: `without: ${fmt(s0.e, 4)}`, tip: 'Based on the projected span, so a non-planar wing can exceed 1.' },
      { k: 'Induced drag, same lift', v: pct(k1 / k0 - 1), s: 'winglet vs none', cls: k1 < k0 ? 'good' : 'bad' },
      { k: 'Root bending moment', v: pct(mb1 / mb0 - 1), s: 'same lift', cls: mb1 > mb0 * 1.02 ? 'warn' : '', tip: 'Of each half-wing at its root. The winglet adds load near the tip, on the longest lever arm.' },
      { k: 'Equal-moment span extension', v: isFinite(ext.ext) ? '+' + (ext.ext * 100).toFixed(1) + '% span' : '—', s: `its induced drag: ${pct(kExt / k0 - 1)}`, tip: 'The flat span increase that raises the root bending moment as much as this winglet does.' },
      { k: 'Winglet vs extension', v: pct(k1 / kExt - 1), s: k1 < kExt ? 'winglet wins' : 'extension wins', cls: k1 < kExt ? 'good' : 'warn', tip: 'Induced drag with the winglet relative to the equal-moment span extension, at the same lift.' },
      { k: 'Winglet side force', v: fmt(s1.strips.filter(s => s.part === 'winglet' && s.y > 0).reduce((a, s) => a + s.G * s.len, 0) / (0.25 * W.S), 4), s: 'per side, as a coefficient on S/2', tip: 'Inward on each winglet. It is tilted slightly forward by the tip vortex flow, which is the thrust that cancels some induced drag.' },
    ]);
    // spanwise load along the arc
    const right = s => s.strips.filter(x => x.arc >= 0);
    const a0 = right(s0), a1 = right(s1);
    lPlot.setData({ series: [
      { x: a1.map(x => x.arc), y: a1.map(x => x.ccl), color: css('--accent'), label: 'with winglet', width: 2.4 },
      { x: a0.map(x => x.arc), y: a0.map(x => x.ccl), color: css('--text-3'), dash: [5, 4], label: 'without' },
    ], vlines: [{ x: 1, color: css('--text-3'), dash: [2, 3] }] });
    // drag-saving curves on a coarse lattice
    const key = JSON.stringify([{ ...W, winglet: { ...W.winglet, h: 0 } }, C.alpha, M]);
    if (key !== cKey) {
      const hs = [0.03, 0.06, 0.1, 0.14, 0.19, 0.25, 0.32], o = { alpha: C.alpha, M, nS: 12, nC: 2 };
      const b0 = Wg.analyze(Woff, o), kb = b0.CDi / b0.CL ** 2;
      curve = hs.map(hh => {
        const wl = Wg.analyze({ ...W, winglet: { ...W.winglet, on: true, h: hh } }, o);
        const fl = Wg.analyze({ ...W, winglet: { ...W.winglet, on: true, h: hh, cant: 90, sweep: 0, taper: W.winglet.taper } }, o);
        const ex = Wg.equalMomentExtension(Woff, wl, { ...o });
        return { h: hh, wl: (wl.CDi / wl.CL ** 2 / kb - 1) * 100, fl: (fl.CDi / fl.CL ** 2 / kb - 1) * 100, ex: (ex.CDiF / wl.CL ** 2 / kb - 1) * 100 };
      });
      cKey = key;
    }
    gPlot.setData({ series: [
      { x: curve.map(p => p.h), y: curve.map(p => p.wl), color: css('--accent'), label: `winglet, cant ${W.winglet.cant.toFixed(0)}°`, width: 2.4, points: true, pointSize: 2.5 },
      { x: curve.map(p => p.h), y: curve.map(p => p.fl), color: css('--text-3'), dash: [5, 4], label: 'same length, flat' },
      { x: curve.map(p => p.h), y: curve.map(p => p.ex), color: css('--good'), label: 'equal-moment extension', width: 2, points: true, pointSize: 2.5 },
    ], vlines: [{ x: W.winglet.h, color: css('--text-2'), dash: [3, 3] }], hlines: [{ y: 0, color: css('--text-3') }] });
    view.set({ sol: s1, wake: Wg.rollup(s1, { spans: 1.6, frames: 28, sub: 3 }), ground: gr });
    const L = [];
    L.push({ type: 'i', t: 'How a winglet works', d: 'Air spills round the tip from the high-pressure underside to the low-pressure top. A winglet in that swirl is a small wing meeting the air at an angle: its lift points inward and slightly forward, a thrust that cancels part of the induced drag. Seen from the wake, it spreads the vorticity higher and further out, which is what lowers the drag.' });
    L.push({ type: k1 < kExt ? 'g' : 'w', t: k1 < kExt ? 'Better than the equal-moment extension here' : 'A span extension does better here', d: `For the same added root bending moment, a +${(ext.ext * 100).toFixed(1)}% span extension changes induced drag by ${pct(kExt / k0 - 1)} against the winglet's ${pct(k1 / k0 - 1)}. Jones and Lasinski found the two are close when compared this way; winglets earn their place where gate width limits the span, and on existing wings that cannot take a longer spar.` });
    if (W.winglet.cant > 70) L.push({ type: 'i', t: 'Nearly flat', d: 'A winglet canted this far is really a span extension (a raked tip).' });
    L.push({ type: 'i', t: 'Not modelled', d: 'Profile drag of the winglet\'s own surface and junction (which can eat most of a small winglet\'s saving at low lift), and the structure\'s weight. Winglets pay off most when CL is high: climb and heavy cruise.' });
    insightsList(insEl, L);
  };

  let visible = false;
  store.subs.add(() => { if (visible) paint(); });
  build();
  return {
    controls, main,
    show() { visible = true; build(); paint(); view.setView(205, 12); },
    hide() { visible = false; },
    destroy() { view.destroy(); },
  };
}
