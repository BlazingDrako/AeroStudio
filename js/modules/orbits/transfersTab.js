// Transfers: Hohmann and bi-elliptic transfers between circular orbits, with an inclination change shared between the
// burns, the lead angle for a rendezvous and the wait between opportunities. Animated top view, Δv against the radius
// ratio (the 11.94 and 15.58 crossovers), and the cost of a plane change by where it is done.
import { h, section, segmented, slider, select, field, toggle, icon } from '../../lib/ui.js';
import { Plot } from '../../lib/plot.js';
import * as O from '../../solvers/orbits.js';
import { metricsGrid, insightsList, card, canvasBox, km, kms, ms, dur, css, D, fmtAlt } from './common.js';

const PRESETS = [
  { label: 'LEO → GEO from the Cape', body: 'earth', h1: 200, h2: 35786, di: 28.5, method: 'hohmann' },
  { label: 'LEO → GEO from Kourou', body: 'earth', h1: 200, h2: 35786, di: 5.2, method: 'hohmann' },
  { label: 'ISS reboost (+10 km)', body: 'earth', h1: 410, h2: 420, di: 0, method: 'hohmann' },
  { label: 'LEO → GPS (MEO)', body: 'earth', h1: 300, h2: 20180, di: 0, method: 'hohmann' },
  { label: 'LEO → Moon distance', body: 'earth', h1: 200, h2: 378000, di: 0, method: 'compare', rb: 2 },
  { label: 'Low lunar orbit → 5 000 km', body: 'moon', h1: 100, h2: 5000, di: 0, method: 'hohmann' },
  { label: 'Earth → Mars (around the Sun)', body: 'sun', h1: 1.496e8 - 695700, h2: 2.2794e8 - 695700, di: 1.85, method: 'hohmann' },
  { label: 'Ratio 20: bi-elliptic wins', body: 'earth', h1: 300, h2: 20 * 6678 - 6378, di: 0, method: 'compare', rb: 1.6 },
];

export function transfersTab({ keep }) {
  const S = keep({ body: 'earth', h1: 200, h2: 35786, method: 'hohmann', rb: 1.5, di: 28.5, split: 'split', rendezvous: true, speed: 1 });
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });
  const metrics = metricsGrid();
  const top = canvasBox('cf-chart', 'max(420px, 52vh)');
  const vCard = h('div', { class: 'plot-card' });
  const regime = h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap', marginBottom: '8px', alignItems: 'center' } });
  vCard.append(h('div', { class: 'plot-head' }, h('h4', {}, 'The transfer from above')), regime, top.el);
  const rCard = card('Total Δv against the radius ratio', 'In units of the first circular speed, for r₂/r₁ from 1 to 100. Hohmann peaks at 15.58; bi-elliptic with rb → ∞ wins above 11.94; with a finite rb it wins only further out. Marker: this transfer.');
  const rPlot = new Plot(rCard, { xlabel: 'r₂ / r₁', ylabel: 'Δv / v_c1', logx: true, xname: 'r₂/r₁', yname: 'Δv/vc₁', xfmt: v => v.toFixed(2), yfmt: v => v.toFixed(4), legendPos: 'above' });
  const pCard = card('Cost of the plane change', 'Total Δv for this transfer as the inclination change grows, by where it is done. Separately in the initial orbit is costly when that orbit is fast; folded into the burns is far cheaper; a small share at the first burn is cheapest of all.');
  const pPlot = new Plot(pCard, { xlabel: 'inclination change Δi (°)', ylabel: 'total Δv (km/s)', xname: 'Δi', yname: 'Δv', xfmt: v => v.toFixed(1) + '°', yfmt: v => v.toFixed(3) + ' km/s', legendPos: 'above' });
  const insCard = card('Notes'); const insEl = h('div'); insCard.append(insEl);
  const burnCard = card('Burns', 'Each burn as a change of speed and direction. With a plane change the burn is the vector difference between the old and new velocity: Δv² = v₁² + v₂² − 2v₁v₂·cos Δθ.');
  const burnEl = h('div'); burnCard.append(burnEl);
  for (const p of [rPlot, pPlot]) p.wrap.style.height = '260px';
  main.append(metrics.el, vCard, h('div', { class: 'cf-grid2b' }, rCard, pCard), h('div', { class: 'cf-grid2b' }, burnCard, insCard));

  let anim = 0, playing = false, raf = 0;
  const play = h('button', { class: 'btn sm primary', type: 'button' });
  const paintPlay = () => play.replaceChildren(icon(playing ? 'pause' : 'play', 14), playing ? ' Pause' : ' Fly the transfer');
  paintPlay();
  play.addEventListener('click', () => {
    playing = !playing; paintPlay();
    if (!playing) { cancelAnimationFrame(raf); return; }
    if (anim >= 1) anim = 0;
    let last = performance.now();
    const step = t => {
      if (!playing) return;
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      anim = Math.min(1, anim + dt / 9 * S.speed);
      top.draw();
      if (anim >= 1) { playing = false; paintPlay(); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  });

  const build = () => {
    const B = O.body(S.body), sun = S.body === 'sun';
    const unit = sun ? 1e6 : 1, uL = sun ? 'million km' : 'km';
    const lo = sun ? 1e5 : 50, hi = sun ? 1.5e10 : 2e6;
    const secO = section('Orbits');
    secO.body.append(
      field('Central body', select(Object.values(O.BODIES).map(b => ({ value: b.id, label: b.label })), S.body, v => { const k = O.body(v).R / B.R; S.body = v; S.h1 = Math.max(v === 'sun' ? 1e5 : 50, S.h1 * k); S.h2 = Math.max(S.h1 * 1.01, S.h2 * k); build(); paint(); })),
      slider({ label: `Initial circular orbit, altitude (${uL})`, min: lo / unit, max: hi / unit, log: true, value: S.h1 / unit, format: v => fmtAlt(v), onInput: v => { S.h1 = v * unit; paint(); } }).el,
      slider({ label: `Final circular orbit, altitude (${uL})`, min: lo / unit, max: hi / unit, log: true, value: S.h2 / unit, format: v => fmtAlt(v), onInput: v => { S.h2 = v * unit; paint(); } }).el,
      h('div', { class: 'hint' }, sun ? 'Around the Sun the radii are the planets\' distances: Earth 149.6, Mars 227.9 million km (altitudes here are above the Sun\'s surface).' : 'Going down works too: the burns are retrograde instead.'));
    const secM = section('Transfer');
    const m = segmented([{ value: 'hohmann', label: 'Hohmann' }, { value: 'bielliptic', label: 'Bi-elliptic' }, { value: 'compare', label: 'Compare both' }], S.method, v => { S.method = v; build(); paint(); });
    m.el.classList.add('seg-wrap');
    secM.body.append(field('Method', m.el, 'Hohmann: two burns on half an ellipse. Bi-elliptic: three burns, out beyond the target to rb and back.'));
    if (S.method !== 'hohmann') secM.body.append(slider({ label: 'Bi-elliptic apoapsis rb / r₂', min: 1.01, max: 20, log: true, value: S.rb, digits: 2, info: 'How far beyond the target orbit the intermediate apoapsis is. Further is cheaper but takes much longer.', onInput: v => { S.rb = v; paint(); } }).el);
    const secP = section('Plane change');
    const sp = segmented([{ value: 'split', label: 'Best split' }, { value: 'end', label: 'All at the far burn' }, { value: 'start', label: 'All at the first' }], S.split, v => { S.split = v; paint(); });
    sp.el.classList.add('seg-wrap');
    secP.body.append(slider({ label: 'Inclination change Δi (°)', min: 0, max: 90, step: 0.1, value: S.di, digits: 1, info: 'Turn the orbit plane by this much on the way. 28.5° takes an orbit launched due east from Cape Canaveral to the equator.', onInput: v => { S.di = v; paint(); } }).el,
      field('Where to turn the plane', sp.el, 'Applies to the Hohmann transfer. A bi-elliptic transfer does the whole change at rb, where it is slowest.'));
    const secR = section('Rendezvous and animation');
    secR.body.append(toggle('Show a target to meet', S.rendezvous, v => { S.rendezvous = v; top.draw(); }, { tip: 'A target already in the final orbit. It must lead by the phase angle at the first burn to be there when the transfer arrives.' }).el,
      slider({ label: 'Animation speed', min: 0.25, max: 4, step: 0.25, value: S.speed, digits: 2, onInput: v => { S.speed = v; } }).el,
      h('div', { class: 'row', style: { marginTop: '6px' } }, play));
    const secX = section('Examples');
    const list = h('div', { class: 'example-list' });
    for (const p of PRESETS) { const b = h('button', { type: 'button' }, p.label); b.addEventListener('click', () => { Object.assign(S, { rb: S.rb, ...p }); delete S.label; anim = 0; build(); paint(); }); list.append(b); }
    secX.body.append(list);
    controls.replaceChildren(secO.el, secM.el, secP.el, secR.el, secX.el);
  };

  let R = null;
  const compute = () => {
    const B = O.body(S.body), r1 = B.R + S.h1 * 1e3, r2 = B.R + S.h2 * 1e3, di = S.di * D;
    const Hp = O.hohmannPlane(r1, r2, di, B.mu, S.split);
    const rb = Math.max(r1, r2) * S.rb;
    const Be = O.biElliptic(r1, r2, rb, B.mu);
    // bi-elliptic plane change all at rb, where the speed is lowest
    const vb1 = O.visViva(B.mu, rb, Be.a1), vb2 = O.visViva(B.mu, rb, Be.a2);
    const be = { ...Be, dv2: O.turnBurn(vb1, vb2, di) };
    be.dv = be.dv1 + be.dv2 + be.dv3;
    const rv = O.rendezvous(r1, r2, B.mu);
    R = { B, r1, r2, rb, di, Hp, be, rv, vc1: Math.sqrt(B.mu / r1) };
  };
  const paint = () => {
    compute();
    const { B, r1, r2, Hp, be, rv, vc1, di } = R;
    const best = S.method === 'bielliptic' ? be : S.method === 'compare' ? (be.dv < Hp.dv ? be : Hp) : Hp;
    metrics.set([
      { k: 'Total Δv', v: ms(best.dv), s: S.method === 'compare' ? (best === be ? 'bi-elliptic is cheaper' : 'Hohmann is cheaper') : `${(best.dv / vc1 * 100).toFixed(1)}% of the first circular speed` },
      { k: 'Hohmann', v: ms(Hp.dv), s: `${ms(Hp.dv1)} + ${ms(Hp.dv2)}`, tip: 'The two burns, with the plane change shared as chosen.' },
      { k: 'Bi-elliptic', v: ms(be.dv), s: `${ms(be.dv1)} + ${ms(be.dv2)} + ${ms(be.dv3)}`, cls: S.method === 'hohmann' ? 'dim' : '' },
      { k: 'Time of flight', v: dur(S.method === 'bielliptic' ? be.tof : Hp.tof), s: S.method === 'compare' ? `bi-elliptic ${dur(be.tof)}` : 'half the transfer period' },
      { k: 'Radius ratio', v: (r2 / r1).toFixed(3), s: r2 / r1 > 15.58 ? 'bi-elliptic always wins here' : r2 / r1 > 11.94 ? 'bi-elliptic can win with far rb' : 'Hohmann is best here' },
      { k: 'Target lead angle', v: (rv.lead / D).toFixed(1) + '°', s: `next chance every ${dur(rv.synodic)}`, tip: 'At the first burn the target must be this far ahead in the final orbit to arrive together. The geometry repeats once per synodic period.' },
    ]);
    // ratio plot
    const xs = [], hoh = [], binf = [], bcur = [];
    for (let k = 0; k <= 160; k++) { const x = 10 ** (k / 80); xs.push(x); hoh.push(O.hohmann(1, x, 1).dv); binf.push(x > 1.0001 ? O.biElliptic(1, x, 1e12, 1).dv : NaN); bcur.push(O.biElliptic(1, x, x * S.rb, 1).dv); }
    rPlot.setData({ series: [
      { x: xs, y: hoh, color: css('--accent'), label: 'Hohmann', width: 2.4 },
      { x: xs, y: bcur, color: css('--turb'), label: `bi-elliptic, rb = ${S.rb.toFixed(2)} r₂`, dash: [5, 4] },
      { x: xs, y: binf, color: css('--text-3'), label: 'bi-elliptic, rb → ∞', dash: [1.5, 3] },
      { x: [r2 / r1], y: [O.hohmann(1, r2 / r1, 1).dv], color: css('--text'), points: true, line: false, pointSize: 4.5, noLegend: true },
    ], vlines: [{ x: 11.94, color: css('--border-strong'), dash: [2, 4] }, { x: 15.58, color: css('--border-strong'), dash: [2, 4] }] });
    // plane change plot
    const ds = [], sSplit = [], sEnd = [], sSep = [];
    for (let k = 0; k <= 90; k++) { const a = k * D; ds.push(k); const q = O.hohmannPlane(r1, r2, a, B.mu, 'split'); sSplit.push(q.dv / 1e3); sEnd.push(O.hohmannPlane(r1, r2, a, B.mu, 'end').dv / 1e3); sSep.push(q.separate / 1e3); }
    pPlot.setData({ series: [
      { x: ds, y: sSep, color: css('--bad'), label: 'separately, in the initial orbit', dash: [5, 4] },
      { x: ds, y: sEnd, color: css('--lower'), label: 'all at the far burn' },
      { x: ds, y: sSplit, color: css('--accent'), label: 'best split', width: 2.4 },
    ], vlines: [{ x: S.di, color: css('--text-2'), dash: [3, 3] }] });
    // burns table
    const rows = [];
    const row = (n, where, v0, v1, dv, turn) => h('tr', {}, h('td', { style: { textAlign: 'left' } }, n), h('td', { style: { textAlign: 'left', fontFamily: 'var(--font)' } }, where), h('td', {}, kms(v0)), h('td', {}, kms(v1)), h('td', {}, turn), h('td', { style: { fontWeight: 600 } }, ms(dv)));
    if (S.method !== 'bielliptic') {
      rows.push(h('tr', {}, h('td', { colspan: 6, style: { textAlign: 'left', color: 'var(--text-2)', fontFamily: 'var(--font)' } }, 'Hohmann')));
      rows.push(row('1', `${r2 > r1 ? 'prograde' : 'retrograde'} at r₁`, Hp.v1, Hp.vt1, Hp.dv1, (Hp.frac * S.di).toFixed(2) + '°'));
      rows.push(row('2', `${r2 > r1 ? 'prograde' : 'retrograde'} at r₂`, Hp.vt2, Hp.v2, Hp.dv2, ((1 - Hp.frac) * S.di).toFixed(2) + '°'));
    }
    if (S.method !== 'hohmann') {
      const v1 = Math.sqrt(B.mu / r1), v2 = Math.sqrt(B.mu / r2);
      rows.push(h('tr', {}, h('td', { colspan: 6, style: { textAlign: 'left', color: 'var(--text-2)', fontFamily: 'var(--font)' } }, 'Bi-elliptic')));
      rows.push(row('1', 'prograde at r₁', v1, O.visViva(B.mu, r1, be.a1), be.dv1, '0°'));
      rows.push(row('2', 'at rb (raise far end)', O.visViva(B.mu, R.rb, be.a1), O.visViva(B.mu, R.rb, be.a2), be.dv2, S.di.toFixed(2) + '°'));
      rows.push(row('3', 'retrograde at r₂', O.visViva(B.mu, r2, be.a2), v2, be.dv3, '0°'));
    }
    burnEl.replaceChildren(h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ...['#', 'where', 'v before', 'v after', 'turn', 'Δv'].map((x, i) => h('th', { style: i < 2 ? { textAlign: 'left' } : null }, x)))), h('tbody', {}, ...rows))));
    regime.replaceChildren(...[h('span', { class: 'regime' }, h('span', { class: 'dot', style: { background: 'var(--accent)' } }), S.method === 'bielliptic' ? 'Bi-elliptic' : 'Hohmann'),
      S.method === 'compare' ? h('span', { class: 'regime' }, h('span', { class: 'dot', style: { background: 'var(--turb)' } }), 'Bi-elliptic') : null,
      h('span', { class: 'hint', style: { margin: 0 } }, `transfer ellipse e = ${Hp.et.toFixed(3)}${di > 0 ? `, plane turned ${S.di.toFixed(1)}°` : ''}`)].filter(Boolean));
    // notes
    const L = [];
    const ratio = Math.max(r1, r2) / Math.min(r1, r2);
    if (S.method === 'compare') L.push(be.dv < Hp.dv ? { type: 'g', t: `Bi-elliptic saves ${ms(Hp.dv - be.dv)}`, d: `But it takes ${dur(be.tof)} instead of ${dur(Hp.tof)}. Burning far out, where the craft is slow, changes the orbit's far end cheaply.` } : { type: 'i', t: `Hohmann is ${ms(be.dv - Hp.dv)} cheaper here`, d: ratio < 11.94 ? 'Below a radius ratio of 11.94 no bi-elliptic transfer can beat Hohmann.' : 'Push rb further out: between ratios 11.94 and 15.58 bi-elliptic needs a distant apoapsis to win.' });
    if (di > 0) {
      const all = O.hohmannPlane(r1, r2, di, B.mu, 'end'), sep = Hp.separate;
      L.push({ type: 'i', t: `Combining saves ${ms(sep - Hp.dv)}`, d: `Turning the plane separately in the initial orbit would cost ${ms(sep)} in all. Folding it into the burns costs ${ms(Hp.dv)}${S.split === 'split' ? `, doing ${(Hp.frac * 100).toFixed(1)}% of it (${(Hp.frac * S.di).toFixed(2)}°) at the first burn and the rest at the second (${ms(all.dv - Hp.dv)} better than all at the far burn)` : ''}.` });
      if (di > 45 * D) L.push({ type: 'w', t: 'Large plane changes rival the transfer itself', d: '2v·sin(Δi/2) grows quickly: a 60° change costs the full orbital speed. Missions avoid them by launching into the right plane, or by going far out (bi-elliptic) where turning is cheap.' });
    }
    L.push({ type: 'i', t: `Wait for the phase: lead ${(rv.lead / D).toFixed(1)}°`, d: `The transfer takes ${dur(Hp.tof)}; in that time the target covers ${((Math.PI - rv.lead) / D).toFixed(1)}° of its orbit. If the phase is wrong you wait up to a synodic period, ${dur(rv.synodic)}, or use a phasing orbit.` });
    if (S.body === 'sun') L.push({ type: 'i', t: 'Around the Sun these are the planets\' orbits', d: 'The Δv here is relative to the Sun. Leaving Earth\'s orbit around the Sun needs the first burn as hyperbolic excess speed v∞; the Δv budget tab adds the burns to leave and enter planetary orbits.' });
    insightsList(insEl, L);
    top.draw();
  };

  top.set(({ W, H, g }) => {
    if (!R) return;
    const { B, r1, r2, rb, Hp, be, rv } = R;
    const showBi = S.method !== 'hohmann', showH = S.method !== 'bielliptic';
    const ext = Math.max(r1, r2, showBi ? rb : 0) * 1.08, k = Math.min(W - 40, H - 52) / 2 / ext, cx = W / 2, cy = (H - 22) / 2; // room at the foot for the caption
    const X = (r, th) => [cx + k * r * Math.cos(th), cy - k * r * Math.sin(th)];
    const col = n => css(n);
    // body (draw at least a dot)
    g.beginPath(); g.arc(cx, cy, Math.max(3, B.R * k), 0, 2 * Math.PI); g.fillStyle = B.color; g.fill();
    const circle = (r, color, w, dash) => { g.strokeStyle = color; g.lineWidth = w; g.setLineDash(dash || []); g.beginPath(); g.arc(cx, cy, r * k, 0, 2 * Math.PI); g.stroke(); g.setLineDash([]); };
    // ellipse with periapsis direction th0, from true anomaly n0 to n1
    const conic = (a, e, th0, n0, n1, color, w, dash) => { const p = a * (1 - e * e); g.strokeStyle = color; g.lineWidth = w; g.setLineDash(dash || []); g.beginPath(); for (let j = 0; j <= 120; j++) { const nu = n0 + (n1 - n0) * j / 120, r = p / (1 + e * Math.cos(nu)), [x, y] = X(r, th0 + nu); j ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); g.setLineDash([]); };
    circle(r1, col('--text-3'), 1.4); circle(r2, col('--text-2'), 1.4, [6, 4]);
    // transfer ellipses: start at angle π (left), go counter-clockwise
    const up = r2 > r1;
    const hTh0 = up ? Math.PI : 0; // periapsis direction of the Hohmann ellipse
    const hE = Hp.et, hA = Hp.at;
    if (showH) { conic(hA, hE, hTh0, 0, 2 * Math.PI, col('--accent'), 1, [2, 4]); conic(hA, hE, hTh0, up ? 0 : Math.PI, up ? Math.PI : 2 * Math.PI, col('--accent'), 2.6); }
    // bi-elliptic: first ellipse r1 → rb (periapsis at angle π), second rb → r2 (apoapsis at 0, periapsis at π)
    const e1 = (rb - r1) / (rb + r1), e2 = (rb - r2) / (rb + r2);
    if (showBi) { conic(be.a1, e1, Math.PI, 0, Math.PI, col('--turb'), 2.2, [7, 4]); conic(be.a2, e2, Math.PI, Math.PI, 2 * Math.PI, col('--turb'), 2.2, [7, 4]); }
    // burn markers
    const burn = (r, th, label, color) => { const [x, y] = X(r, th); g.beginPath(); g.arc(x, y, 5.5, 0, 2 * Math.PI); g.fillStyle = color; g.fill(); g.strokeStyle = col('--bg-elev'); g.lineWidth = 2; g.stroke(); g.fillStyle = color; g.font = '600 11.5px ' + col('--font'); g.textBaseline = 'middle'; const left = Math.cos(th) < 0; g.textAlign = left ? 'right' : 'left'; g.lineJoin = 'round'; g.strokeStyle = col('--bg-elev'); g.lineWidth = 3.5; g.strokeText(label, x + (left ? -10 : 10), y - 12); g.fillText(label, x + (left ? -10 : 10), y - 12); };
    if (showH) { burn(r1, Math.PI, `Δv₁ ${ms(Hp.dv1)}`, col('--accent')); burn(r2, 0, `Δv₂ ${ms(Hp.dv2)}`, col('--accent')); }
    if (showBi) { burn(r1, Math.PI, showH ? '' : `Δv₁ ${ms(be.dv1)}`, col('--turb')); burn(rb, 0, `Δv₂ ${ms(be.dv2)} (at rb)`, col('--turb')); burn(r2, Math.PI, `Δv₃ ${ms(be.dv3)}`, col('--turb')); }
    // animated craft along the chosen transfer (anim 0..1 over the time of flight)
    const useBi = S.method === 'bielliptic';
    const tof = useBi ? be.tof : Hp.tof;
    const posAt = f => {
      if (!useBi) { const M = up ? f * Math.PI : Math.PI + f * Math.PI; const nu = O.trueFromMean(M, hE); return [O.rAt({ a: hA, e: hE }, nu), hTh0 + nu]; }
      const t = f * be.tof, t1 = Math.PI * Math.sqrt(be.a1 ** 3 / B.mu);
      if (t <= t1) { const nu = O.trueFromMean(t / t1 * Math.PI, e1); return [O.rAt({ a: be.a1, e: e1 }, nu), Math.PI + nu]; }
      const nu = O.trueFromMean(Math.PI + (t - t1) / (be.tof - t1) * Math.PI, e2); return [O.rAt({ a: be.a2, e: e2 }, nu), Math.PI + nu];
    };
    const [rc, thc] = posAt(anim), [sx, sy] = X(rc, thc);
    g.beginPath(); g.arc(sx, sy, 6, 0, 2 * Math.PI); g.fillStyle = col('--text'); g.fill(); g.strokeStyle = col('--bg-elev'); g.lineWidth = 2; g.stroke();
    // target in the final orbit: leads by rv.lead at the start (Hohmann timing)
    if (S.rendezvous) {
      const n2 = Math.sqrt(B.mu / r2 ** 3), th = Math.PI + rv.lead + n2 * anim * tof * (up ? 1 : 1);
      const [tx, ty] = X(r2, th);
      g.beginPath(); g.rect(tx - 5, ty - 5, 10, 10); g.fillStyle = col('--warn'); g.fill();
      g.fillStyle = col('--warn'); g.font = '11px ' + col('--font'); g.textAlign = 'left'; g.lineJoin = 'round'; g.strokeStyle = col('--bg-elev'); g.lineWidth = 3.5; g.strokeText('target', tx + 8, ty + 4); g.fillText('target', tx + 8, ty + 4);
      if (anim === 0) { // the lead angle arc
        g.strokeStyle = col('--warn'); g.lineWidth = 1.2; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(cx, cy); g.lineTo(...X(r2, Math.PI)); g.moveTo(cx, cy); g.lineTo(tx, ty); g.stroke(); g.setLineDash([]);
        g.beginPath(); g.arc(cx, cy, Math.min(r1, r2) * k * 0.55, -Math.PI, -(Math.PI + rv.lead), rv.lead > 0); g.stroke();
      }
      if (useBi) { g.fillStyle = col('--text-3'); g.font = '10.5px ' + col('--font'); g.fillText('(target timed for the Hohmann)', tx + 8, ty + 18); }
    }
    g.fillStyle = col('--text-3'); g.font = '10.5px ' + col('--font'); g.textAlign = 'left'; g.textBaseline = 'bottom';
    g.fillText(`t = ${dur(anim * tof)} of ${dur(tof)} · grey: initial orbit · dashed: final orbit`, 10, H - 8);
  });

  let visible = false;
  build();
  return {
    controls, main,
    show() { visible = true; paint(); },
    hide() { visible = false; playing = false; paintPlay(); cancelAnimationFrame(raf); },
    destroy() { playing = false; cancelAnimationFrame(raf); },
  };
}
