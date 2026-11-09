// Planform & lift: the wing's shape (edited by sliders or by dragging the tip on a top view) and how its lift spreads
// across the span, from the vortex lattice, compared with lifting-line theory and the elliptic ideal. A 3-D view
// shows the loading on every panel, the lift along the span and the wake leaving the trailing edge.
import { h, toggle } from '../../lib/ui.js';
import { Plot } from '../../lib/plot.js';
import { sendSection, sendTo } from '../../lib/send.js';
import * as Wg from '../../solvers/wing.js';
import { store, schedule, wingSection, flightSection, metricsGrid, insightsList, card, css, fmt, force, moment, len, D, reStr, preset } from './common.js';
import { WingView } from './view3d.js';

export function planformTab({ keep }) {
  const V = keep({ pressure: true, arrows: true, wake: true, ground: true, animate: true });
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });
  const metrics = metricsGrid();
  const view = new WingView();
  view.setLayers(V);
  const vCard = card('The wing in 3-D', 'Each lattice panel is coloured by its loading ΔCp (the pressure below minus the pressure above). Arrows: lift per unit span, c·cl, along each strip. Purple: the trailing vortex sheet, rolling up into the tip vortices. Drag to turn, scroll to zoom.');
  const layerRow = h('div', { class: 'row', style: { gap: '4px 14px', flexWrap: 'wrap', marginBottom: '8px' } });
  for (const [k, l, tip] of [['pressure', 'Loading ΔCp', 'Panel colour: how hard each piece of the wing is lifting. The leading edge works hardest.'], ['arrows', 'Lift along the span', 'c·cl at each strip, the spanwise load that sets induced drag and bending.'], ['wake', 'Trailing wake', 'The vortex sheet shed wherever the lift changes along the span, rolling up as it goes.'], ['ground', 'Grid', 'A reference grid below the wing.']])
    layerRow.append(toggle(l, V[k], v => { V[k] = v; view.setLayers({ [k]: v }); }, { tip }).el);
  layerRow.append(toggle('Animate the wake', V.animate, v => { V.animate = v; view.setAnimate(v); }).el);
  vCard.append(layerRow, view.el);

  const pCard = card('Planform (drag the tip)', 'Top view, flow from the top. Drag the round handle at the tip quarter chord to change span (aspect ratio, at constant area) and sweep; drag the square handle on the tip trailing edge to change the taper. Dashed: the quarter-chord line. The bar marks the mean aerodynamic chord; the triangle, the aerodynamic centre.');
  const plan = planEditor(() => { schedule(); }, () => { build(); });
  pCard.append(plan.el);

  const lCard = card('Spanwise load', 'c·cl / c̄: lift per unit span, made dimensionless with the mean aerodynamic chord. The dashed curve is the elliptic loading with the same total lift: the least induced drag for this span. Lifting-line theory (dotted) is shown for straight wings.');
  const lPlot = new Plot(lCard, { xlabel: 'spanwise position y / (b/2)', ylabel: 'c·cl / c̄', xname: 'η', yname: 'c·cl/c̄', xfmt: v => v.toFixed(3), yfmt: v => v.toFixed(3), legendPos: 'above', yZero: true });
  const cCard = card('Local lift coefficient', 'cl at each station. Where it peaks is where a wing with the same section everywhere will stall first: the root for a rectangle, outboard for strong taper or sweep.');
  const cPlot = new Plot(cCard, { xlabel: 'spanwise position y / (b/2)', ylabel: 'local cl', xname: 'η', yname: 'cl', xfmt: v => v.toFixed(3), yfmt: v => v.toFixed(3), legendPos: 'above', yZero: true });
  for (const p of [lPlot, cPlot]) p.wrap.style.height = '250px';
  const insCard = card('Notes'); const insEl = h('div'); insCard.append(insEl);
  main.append(metrics.el, vCard, h('div', { class: 'cf-grid2b' }, pCard, insCard), h('div', { class: 'cf-grid2b' }, lCard, cCard));

  let wingCtl, flightCtl;
  const changed = kind => { if (kind === 'preset') { build(); } else { wingCtl && wingCtl.update(); flightCtl && flightCtl.update(); } schedule(); };
  const build = () => {
    wingCtl = wingSection(changed); flightCtl = flightSection(changed);
    controls.replaceChildren(wingCtl.el, flightCtl.el, sendSection([
      { label: 'Airfoil Lab', sub: 'Analyse the root section at its Reynolds number and local lift', go: () => {
        const s = store.sol, A = store.air, root = s.strips.reduce((a, x) => Math.abs(x.y) < Math.abs(a.y) ? x : a);
        const Re = Math.round(Math.min(5e7, Math.max(2e4, A.ReRoot)) / 1000) * 1000;
        return sendTo({ mod: 'airfoil', key: 'analyze', note: `NACA ${store.W.root} at the root: Re ${reStr(Re)}, cl ${root.cl.toFixed(2)}`, values: { geom: { kind: 'naca', code: store.W.root }, oper: { mode: 'cl', cl: +root.cl.toFixed(3), Re, Ma: +Math.min(0.7, A.M).toFixed(3) } } });
      } },
    ]));
  };

  const paint = () => {
    const s = store.sol, W = store.W, A = store.air; if (!s) return;
    const P = s.P, q = A.q, Lf = s.CL * q * W.S;
    metrics.set([
      { k: 'Lift coefficient CL', v: fmt(s.CL, 3), s: `at α ${store.C.alpha.toFixed(1)}°`, tip: 'Total lift over q·S, from the vortex lattice (thin lifting surface, no viscosity).' },
      { k: 'Lift slope CLα', v: (s.CLa * D).toFixed(4) + ' /°', s: `${s.CLa.toFixed(3)} /rad · 2-D: ${(2 * Math.PI / s.beta).toFixed(2)}`, tip: 'A finite wing lifts less per degree than its section: the downwash it makes takes away part of the angle.' },
      { k: 'Induced drag CDi', v: fmt(s.CDi, 5), s: `${(s.CDi / Math.max(1e-9, s.CL ** 2) * Math.PI * W.AR).toFixed(3)}·CL²/(πA)`, tip: 'Drag due to lift, from the energy left in the wake (Trefftz plane). It grows with CL² and falls with span.' },
      { k: 'Span efficiency e', v: fmt(s.e, 4), s: s.e > 0.995 ? 'elliptic-like loading' : `${((1 / s.e - 1) * 100).toFixed(1)}% more CDi than elliptic`, tip: 'e = CL²/(π·AR·CDi). 1 for elliptic loading on a flat wing; above 1 only with non-planar wings (winglets, dihedral).' },
      { k: 'Lift', v: force(Lf), s: `${Math.round(Lf / 9.80665).toLocaleString('en-US')} kg at 1 g`, tip: 'CL·q·S at this airspeed and altitude.' },
      { k: 'Root bending moment', v: moment(s.Mb * A.atm.rho * store.C.V ** 2), s: `lift centroid at ${(s.ycp * 100).toFixed(1)}% semi-span`, tip: 'Of one half-wing, about the centre line. Elliptic loading puts the centroid at 4/(3π) = 42.4%.' },
      { k: 'Aerodynamic centre', v: (s.xac * 100).toFixed(1) + '% MAC', s: `${len(P.xMac + s.xac * P.mac)} aft of the root LE`, tip: 'The point about which the pitching moment does not change with α. Sweep and taper move it relative to the MAC.' },
      { k: 'Zero-lift angle', v: s.alphaL0.toFixed(2) + '°', s: `Cm₀ ${fmt(s.Cm0, 4)} (twist only)`, tip: 'Angle of the root chord at which the whole wing lifts nothing. Camber lowers it; washout raises it.' },
    ]);
    // spanwise plots: the right half of the main wing
    const st = s.strips.filter(x => x.y >= 0 && x.part === 'wing');
    const eta = st.map(x => x.eta);
    const ellK = 4 * s.CL * W.S / (Math.PI * P.b * P.mac);
    const ee = []; for (let i = 0; i <= 60; i++) ee.push(i / 60);
    const series = [
      { x: eta, y: st.map(x => x.ccl), color: css('--accent'), label: 'vortex lattice', width: 2.4 },
      { x: ee, y: ee.map(e => ellK * Math.sqrt(1 - e * e)), color: css('--text-3'), dash: [5, 4], label: 'elliptic, same lift' },
    ];
    const straight = Math.abs(W.sweep) < 8 && !(W.winglet && W.winglet.on);
    if (straight) series.push({ x: store.ll.strips.map(x => x.eta), y: store.ll.strips.map(x => x.ccl), color: css('--lower'), dash: [1.5, 3], label: 'lifting line' });
    lPlot.setData({ series });
    const cs = [{ x: eta, y: st.map(x => x.cl), color: css('--accent'), label: 'vortex lattice', width: 2.4 }];
    if (straight) cs.push({ x: store.ll.strips.map(x => x.eta), y: store.ll.strips.map(x => x.cl), color: css('--lower'), dash: [1.5, 3], label: 'lifting line' });
    cPlot.setData({ series: cs, hlines: [{ y: s.CL, color: css('--text-3'), dash: [3, 3], label: `wing CL ${s.CL.toFixed(3)}` }] });
    // 3-D view
    view.set({ sol: s, wake: V.wake ? Wg.rollup(s, { spans: 2.2, frames: 36, sub: 3 }) : null, ground: store.sol.L.ground });
    plan.draw();
    // notes
    const L = [], p = preset();
    if (p) L.push({ type: 'i', t: p.label, d: p.note });
    const peak = st.reduce((a, x) => x.cl > a.cl ? x : a, st[0]);
    if (peak) L.push({ type: peak.eta > 0.6 ? 'w' : 'g', t: `Highest local cl at ${(peak.eta * 100).toFixed(0)}% of the semi-span`, d: peak.eta > 0.6 ? 'With the same section everywhere, the stall starts out there, near the ailerons: the wing can drop suddenly. Washout (negative tip twist) or less taper and sweep move it inboard. See the Stall tab.' : 'The stall should start inboard, where it is gentle and gives warning with buffet over the tail, while the ailerons keep working.' });
    if (s.e < 0.97 && !(W.winglet && W.winglet.on)) L.push({ type: 'i', t: `Induced drag ${((1 / s.e - 1) * 100).toFixed(1)}% above elliptic`, d: W.taper > 0.7 && W.shape !== 'elliptic' ? 'A rectangle carries too much lift near the tips. A taper ratio around 0.35–0.45 brings an untwisted straight wing close to elliptic.' : W.taper < 0.25 ? 'This much taper loads the tips too heavily. Washout or a higher taper ratio spreads the load back toward elliptic.' : 'Twist, taper and sweep all reshape the spanwise load. Matching the dashed elliptic curve minimises induced drag for this span.' });
    if (Math.abs(W.sweep) > 15) L.push({ type: 'i', t: `Sweep ${W.sweep > 0 ? 'back' : 'forward'} ${Math.abs(W.sweep).toFixed(0)}°`, d: W.sweep > 0 ? 'Swept-back wings carry more lift outboard than the same straight wing (each section sits in the upwash of the ones ahead of it). The lift slope drops roughly with cos Λ, and the aerodynamic centre moves aft.' : 'Forward sweep moves the load inboard: the root works hardest and stalls first. Aeroelastic divergence (the tips twisting up under load) is its main problem.' });
    if (store.air.M > 0.3) L.push({ type: 'i', t: `Mach ${store.air.M.toFixed(2)}: compressibility included`, d: `Göthert's rule: the wing is solved stretched along the flow by 1/√(1 − M²) = ${(1 / s.beta).toFixed(3)}. Lift slope rises by less than the 2-D Prandtl–Glauert factor because the stretched wing has a lower aspect ratio.${store.air.M > 0.7 ? ' Above about M 0.7 real wings meet shock waves and drag rise, which this linear model cannot see.' : ''}` });
    if (store.C.alpha > 12) L.push({ type: 'w', t: 'High angle of attack', d: 'This linear model keeps lifting past the stall. The Stall tab follows each section\'s polar instead.' });
    insightsList(insEl, L);
  };

  let visible = false, dirty = true;
  store.subs.add(() => { if (visible) paint(); else dirty = true; });
  build();
  return {
    controls, main,
    show() { visible = true; build(); paint(); dirty = false; if (V.animate) view.setAnimate(true); },
    hide() { visible = false; view.setAnimate(false); },
    destroy() { view.destroy(); },
  };
}

// top-view editor: round handle at the tip quarter chord (span and sweep), square handle at the tip trailing edge (taper)
function planEditor(onDrag, onDone) {
  const el = h('div', { class: 'wg-plan' }), cv = h('canvas'); el.append(cv);
  const g = cv.getContext('2d');
  let map = null, drag = null, hover = null;
  const handles = () => {
    const W = store.W, P = Wg.planform(W), out = [{ id: 'q', y: P.s, x: P.xc4(1) }];
    if (W.shape !== 'elliptic') out.push({ id: 't', y: P.s, x: P.xle(1) + P.ct });
    return out;
  };
  const draw = () => {
    const W = store.W, P = Wg.planform(W), s = store.sol;
    const dpr = Math.min(devicePixelRatio || 1, 2), Wd = el.clientWidth, Hd = el.clientHeight;
    if (!Wd || !Hd) return;
    if (cv.width !== Math.round(Wd * dpr) || cv.height !== Math.round(Hd * dpr)) { cv.width = Math.round(Wd * dpr); cv.height = Math.round(Hd * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, Wd, Hd);
    const n = 80, xs = []; for (let i = 0; i <= n; i++) { const e = i / n; xs.push([e, P.xle(e), P.xle(e) + P.chord(e)]); }
    const xmin = Math.min(0, ...xs.map(r => r[1])), xmax = Math.max(...xs.map(r => r[2]));
    // keep the scale steady while dragging so the handle stays under the pointer
    if (!drag || !map) {
      const k = Math.min((Wd - 40) / (2 * P.s * 1.08), (Hd - 50) / Math.max(1e-6, (xmax - xmin) * 1.15));
      map = { k, cx: Wd / 2, cy: 26 + ((Hd - 50) - (xmax - xmin) * k) / 2 - xmin * k };
    }
    const X = y => map.cx + y * map.k, Y = x => map.cy + x * map.k;
    // fill
    g.beginPath();
    xs.forEach((r, i) => i ? g.lineTo(X(r[0] * P.s), Y(r[1])) : g.moveTo(X(0), Y(r[1])));
    for (let i = n; i >= 0; i--) g.lineTo(X(xs[i][0] * P.s), Y(xs[i][2]));
    for (let i = 0; i <= n; i++) g.lineTo(X(-xs[i][0] * P.s), Y(xs[i][2]));
    for (let i = n; i >= 0; i--) g.lineTo(X(-xs[i][0] * P.s), Y(xs[i][1]));
    g.closePath();
    g.fillStyle = css('--accent-soft') || 'rgba(22,119,179,0.15)'; g.fill();
    g.strokeStyle = css('--accent'); g.lineWidth = 1.6; g.stroke();
    // quarter-chord line
    g.setLineDash([5, 4]); g.strokeStyle = css('--text-3'); g.lineWidth = 1;
    g.beginPath(); g.moveTo(X(-P.s), Y(P.xc4(1))); g.lineTo(X(0), Y(P.xc4(0))); g.lineTo(X(P.s), Y(P.xc4(1))); g.stroke(); g.setLineDash([]);
    // MAC and aerodynamic centre
    g.strokeStyle = css('--good'); g.lineWidth = 2.2;
    for (const sg of [-1, 1]) { g.beginPath(); g.moveTo(X(sg * P.yMac), Y(P.xMac)); g.lineTo(X(sg * P.yMac), Y(P.xMac + P.mac)); g.stroke(); }
    if (s) {
      const xa = P.xMac + s.xac * P.mac;
      g.fillStyle = css('--good'); g.beginPath(); g.moveTo(X(0) - 6, Y(xa)); g.lineTo(X(0) + 6, Y(xa)); g.lineTo(X(0), Y(xa) - 9); g.closePath(); g.fill();
    }
    // labels
    g.fillStyle = css('--text-2'); g.font = '11px ' + css('--font'); g.textAlign = 'center';
    g.fillText(`b = ${len(P.b)}   S = ${W.S.toFixed(1)} m²   AR ${W.AR.toFixed(2)}   λ ${P.lam.toFixed(2)}   Λc/4 ${W.sweep.toFixed(1)}°`, Wd / 2, 16);
    g.fillStyle = css('--good'); g.fillText('MAC', X(P.yMac), Y(P.xMac) - 5);
    g.fillStyle = css('--text-3'); g.fillText('↓ flow', 30, Hd - 10); g.textAlign = 'left';
    // handles
    for (const hd of handles()) {
      const hx = X(hd.y), hy = Y(hd.x), on = (drag && drag.id === hd.id) || hover === hd.id;
      g.fillStyle = css('--bg-elev'); g.strokeStyle = css('--accent'); g.lineWidth = on ? 3 : 2;
      g.beginPath(); if (hd.id === 'q') g.arc(hx, hy, on ? 8 : 6.5, 0, 2 * Math.PI); else g.rect(hx - (on ? 7 : 5.5), hy - (on ? 7 : 5.5), on ? 14 : 11, on ? 14 : 11);
      g.fill(); g.stroke();
    }
  };
  const pick = e => {
    if (!map) return null; const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    for (const hd of handles()) if (Math.hypot(mx - (map.cx + hd.y * map.k), my - (map.cy + hd.x * map.k)) < 12) return hd.id;
    return null;
  };
  cv.addEventListener('pointerdown', e => { const id = pick(e); if (!id) return; drag = { id }; cv.setPointerCapture(e.pointerId); e.preventDefault(); });
  cv.addEventListener('pointermove', e => {
    if (!drag) { const id = pick(e); if (id !== hover) { hover = id; cv.style.cursor = id ? 'grab' : 'default'; draw(); } return; }
    const W = store.W, r = cv.getBoundingClientRect(), y = (e.clientX - r.left - map.cx) / map.k, x = (e.clientY - r.top - map.cy) / map.k;
    const P = Wg.planform(W);
    if (drag.id === 'q') {
      const s = Math.max(0.2, Math.abs(y));
      W.AR = Math.min(30, Math.max(1, (2 * s) ** 2 / W.S));
      const s2 = Math.sqrt(W.AR * W.S) / 2;
      W.sweep = Math.round(Math.min(60, Math.max(-40, Math.atan2(x - P.cr / 4, s2) / D)) * 2) / 2;
    } else {
      const ct = Math.max(0, (x - P.xc4(1)) * 4 / 3), b = P.b;
      W.taper = Math.round(Math.min(1, Math.max(0, ct * b / Math.max(1e-9, 2 * W.S - ct * b))) * 100) / 100;
    }
    W.preset = '';
    draw(); onDrag();
  });
  const end = () => { if (drag) { drag = null; map = null; draw(); onDone(); } };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  new ResizeObserver(() => { map = null; draw(); }).observe(el);
  addEventListener('themechange', draw);
  return { el, draw: () => { if (!drag) map = null; draw(); } };
}
