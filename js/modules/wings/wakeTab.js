// Wake & downwash: the trailing vortex sheet seen end-on as it rolls up into two tip vortices, the downwash it leaves
// at the tailplane (and dε/dα, which sets the tail's contribution to stability), and ground effect.
import { h, icon, section, toggle } from '../../lib/ui.js';
import { Plot } from '../../lib/plot.js';
import * as Wg from '../../solvers/wing.js';
import { store, schedule, wingSection, flightSection, metricsGrid, insightsList, card, css, fmt, bound, put, len, groundH, D } from './common.js';
import { WingView } from './view3d.js';

export function wakeTab({ keep }) {
  const S = keep({ lt: 3.5, zt: 0.08, xs: 1.5, spans: 6 });
  const C = store.C;
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });
  const metrics = metricsGrid();
  const tCard = card('The wake, seen from behind', 'A slice through the wake at the chosen distance behind the wing, looking forward. Each dot is a piece of the vortex sheet the wing sheds; the sheet curls up from its edges into two tip vortices and sinks. Arrows: the cross-flow it induces, down between the vortices and up outside them.');
  const tBox = h('div', { class: 'wg-trefftz' }), tCv = h('canvas'); tBox.append(tCv);
  const tLeg = h('div', { class: 'hint', style: { marginTop: '6px' } });
  tCard.append(tBox, tLeg);
  const view = new WingView();
  view.setLayers({ wake: true, arrows: false, pressure: true });
  const vCard = card('Wing, wake and tail', 'The rolled-up sheet behind the wing, and the tail position where the downwash is read.');
  vCard.append(view.el);
  const eCard = card('Downwash behind the wing', 'Downwash angle ε on the centre line at the tail height, from the flat (not rolled-up) wake. It starts at about half its final value at the wing and grows to the far-wake value 2CL/(πA) (dashed) within a few chords.');
  const ePlot = new Plot(eCard, { xlabel: 'distance behind the wing\'s quarter chord (MACs)', ylabel: 'ε (°)', xname: 'x', yname: 'ε', xfmt: v => v.toFixed(2), yfmt: v => v.toFixed(3) + '°', legendPos: 'above', yZero: true });
  const gCard = card('Ground effect', 'Near the ground the wing\'s mirror image cancels part of its downwash: induced drag falls and the lift slope rises. Lattice (accent) against the image lifting line and Wieselsberger\'s classic fit. h is the height of the root quarter chord; b the span.');
  const gPlot = new Plot(gCard, { xlabel: 'height / span  h/b', ylabel: 'ratio to free air', xname: 'h/b', yname: 'ratio', xfmt: v => v.toFixed(3), yfmt: v => v.toFixed(3), legendPos: 'above' });
  for (const p of [ePlot, gPlot]) p.wrap.style.height = '250px';
  const insCard = card('Notes'); const insEl = h('div'); insCard.append(insEl);
  main.append(metrics.el, vCard, h('div', { class: 'cf-grid2b' }, tCard, eCard), h('div', { class: 'cf-grid2b' }, gCard, insCard));

  // ---- fly-back animation through the wake ----
  let playing = false, raf = 0, xsS = null;
  const play = h('button', { class: 'btn sm primary', type: 'button' });
  const paintPlay = () => play.replaceChildren(icon(playing ? 'pause' : 'play', 14), playing ? ' Pause' : ' Fly down the wake');
  paintPlay();
  play.addEventListener('click', () => {
    playing = !playing; paintPlay();
    if (!playing) { cancelAnimationFrame(raf); return; }
    if (S.xs >= S.spans - 0.05) S.xs = 0;
    let last = performance.now();
    const step = t => {
      if (!playing) return;
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      S.xs = Math.min(S.spans, S.xs + dt * S.spans / 8);
      xsS && xsS.set(S.xs); drawTrefftz();
      if (S.xs >= S.spans) { playing = false; paintPlay(); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  });

  let wingCtl, flightCtl;
  const changed = kind => { if (kind === 'preset') build(); else { wingCtl && wingCtl.update(); flightCtl && flightCtl.update(); } schedule(); };
  const build = () => {
    const sw = section('Wake and tail');
    xsS = bound(S, 'xs', 'Slice distance behind the wing', 0, S.spans, { step: 0.05, digits: 2, unit: 'spans', onInput: () => drawTrefftz(), tip: 'Where the end-on view is cut. The sheet is followed by 2-D vortex dynamics, with the distance standing in for time (x = V·t).' });
    put(sw.body, xsS, h('div', { class: 'row', style: { marginBottom: '10px' } }, play),
      bound(S, 'spans', 'Follow the wake for', 2, 20, { step: 0.5, digits: 1, unit: 'spans', onInput: () => { paintWake(); } }),
      bound(S, 'lt', 'Tail arm', 1, 8, { step: 0.05, digits: 2, unit: 'MACs', onInput: () => paintTail(), tip: 'Distance from the wing\'s quarter-chord MAC to the tail. Typical: 2.5–3.5 MACs for airliners, 3–4 for light aircraft.' }),
      bound(S, 'zt', 'Tail height above the wing', -0.3, 0.6, { step: 0.01, digits: 2, unit: 'semi-spans', onInput: () => paintTail(), tip: 'A T-tail sits well above the wake; a low tail sits close to it, where the downwash is strongest and changes fastest.' }));
    const sg = section('Ground effect');
    put(sg.body, toggle('Near the ground', C.ground, v => { C.ground = v; build(); schedule(); }, { tip: 'Adds a mirror-image wing below the ground plane (an exact flat-ground boundary for this inviscid model). Applies in every tab.' }).el,
      C.ground ? bound(C, 'hb', 'Height h/b', 0.04, 1, { log: true, digits: 3, onInput: () => schedule(), tip: 'Height of the root quarter chord over the span. Wing-in-ground-effect craft cruise below h/b ≈ 0.1; airliners touch down from h/b ≈ 0.1–0.2.' }) : null);
    wingCtl = wingSection(changed); flightCtl = flightSection(changed);
    controls.replaceChildren(sw.el, sg.el, flightCtl.el, wingCtl.el);
  };

  // ---- painting ----
  let wake = null;
  const tailPoint = () => { const P = store.sol.P; return [P.xRef + S.lt * P.mac, 0, S.zt * P.s]; };
  const paintWake = () => { wake = Wg.rollup(store.sol, { spans: S.spans, frames: Math.round(30 + S.spans * 8), sub: 3 }); S.xs = Math.min(S.xs, S.spans); drawTrefftz(); view.set({ sol: store.sol, wake, tail: tailPoint(), ground: groundH() }); };
  const paintTail = () => {
    const s = store.sol, P = s.P, W = store.W, tp = tailPoint();
    const s2 = { ...s, G: s.G2 };
    const eps = Wg.downwash(s, tp), deda = Wg.downwash(s2, tp) - eps;
    const simple = 2 * s.CLa / (Math.PI * W.AR);
    const far = 2 * s.CL / (Math.PI * W.AR) / D;
    // vortex spacing after roll-up: centroid of the right half's shed vorticity in the last frame
    const last = wake[wake.length - 1], n = last.y.length;
    let ky = 0, kk = 0; for (let i = (n - 1) / 2; i < n; i++) { const k = s.kap[i]; if (k > 0) { ky += k * last.y[i]; kk += k; } }
    const bp = kk > 0 ? 2 * ky / kk / P.b : NaN;
    // ground effect relative to free air at the same α
    let gTxt = 'off', gSub = 'switch on below';
    if (C.ground) { const f = Wg.analyze(W, { alpha: C.alpha, M: store.air.Mc, nS: 16, nC: 4 }); const kG = s.CDi / s.CL ** 2, kF = f.CDi / f.CL ** 2; gTxt = `CDi ×${(kG / kF).toFixed(3)}`; gSub = `CL ${((s.CL / f.CL - 1) * 100).toFixed(1)}% · h ${len(C.hb * P.b)}`; }
    metrics.set([
      { k: 'Downwash at the tail ε', v: eps.toFixed(2) + '°', s: `${S.lt.toFixed(1)} MACs aft, ${(S.zt * 100).toFixed(0)}% semi-span up`, tip: 'The tail meets the air at α − ε plus its own incidence. Trim and tail sizing depend on it.' },
      { k: 'dε/dα at the tail', v: fmt(deda, 3), s: `simple estimate 2CLα/(πA) = ${fmt(simple, 3)}`, tip: 'How much the downwash grows per degree of α. The tail\'s stabilising lift slope is cut by (1 − dε/dα). Flight & Atmosphere uses the simple far-wake estimate.' },
      { k: 'Far-wake downwash', v: far.toFixed(2) + '°', s: `half of it at the wing: ${(far / 2).toFixed(2)}°`, tip: 'For elliptic loading ε∞ = 2CL/(πA) exactly; other loadings are close.' },
      { k: 'Tip-vortex spacing', v: isFinite(bp) ? (bp * 100).toFixed(1) + '% span' : '—', s: 'π/4 = 78.5% for elliptic loading', tip: 'Where the rolled-up vortices settle: the centroid of the vorticity shed by each half-wing. It sets the wake hazard for following aircraft and the gains of formation flight.' },
      { k: 'Ground effect', v: gTxt, s: gSub, cls: C.ground ? 'good' : '' },
    ]);
    // downwash along x
    const xs = [], ys = [], x0 = P.xRef;
    for (let i = 0; i <= 70; i++) { const xm = 0.25 + i * 0.12; xs.push(xm); ys.push(Wg.downwash(s, [x0 + xm * P.mac, 0, S.zt * P.s])); }
    ePlot.setData({ series: [{ x: xs, y: ys, color: css('--accent'), label: 'centre line at tail height', width: 2.4 }],
      hlines: [{ y: far, color: css('--text-3'), dash: [5, 4], label: 'far wake 2CL/(πA)' }, { y: far / 2, color: css('--text-3'), dash: [1.5, 3], label: 'half: at the lifting line' }],
      vlines: [{ x: S.lt, color: css('--lower'), dash: [3, 3] }] });
    view.set({ sol: s, wake, tail: tp, ground: groundH() });
    // notes
    const L = [];
    L.push({ type: 'i', t: 'Why the downwash matters', d: `The tail's lift slope is multiplied by (1 − dε/dα) = ${fmt(1 - deda, 3)}: here ${((deda) * 100).toFixed(0)}% of the tail's response to a gust is lost to the wing's downwash. That shrinks the tail's contribution to the neutral point, so a bigger tail or a longer arm is needed.` });
    if (S.zt < 0.1 && S.zt > -0.1) L.push({ type: 'w', t: 'Tail close to the wake', d: 'At this height the tail sits in the wake core, where downwash is strongest. Raising it (a T-tail) reduces dε/dα in cruise, but at high α a T-tail can drop into the stalled wing\'s wake: the deep stall.' });
    if (C.ground) L.push({ type: 'g', t: 'In ground effect', d: 'The mirror image cuts the downwash: less induced drag (the "float" before touchdown), more lift per degree, and less downwash at the tail, so the nose tends to drop as the aircraft nears the runway.' });
    L.push({ type: 'i', t: 'Wake vortices', d: 'The rolled-up vortices persist for kilometres behind a heavy aircraft, sinking slowly. Separation rules (for example 4–6 nm behind a heavy jet on approach) exist because of them. The flat-wake downwash plot ignores the roll-up; the end-on view follows it.' });
    insightsList(insEl, L);
  };

  // ground-effect curves, computed on a coarse lattice and cached per wing
  let gKey = '', gData = null;
  const paintGround = () => {
    const W = store.W, key = JSON.stringify([W, C.alpha]);
    if (key !== gKey) {
      const hs = [0.05, 0.07, 0.1, 0.14, 0.2, 0.3, 0.45, 0.65, 1.0];
      const free = Wg.analyze(W, { alpha: C.alpha, nS: 12, nC: 2 });
      const b = free.P.b, kF = free.CDi / free.CL ** 2;
      gData = hs.map(hb => { const s = Wg.analyze(W, { alpha: C.alpha, nS: 12, nC: 2, ground: hb * b }); return { hb, k: s.CDi / s.CL ** 2 / kF, a: s.CLa / free.CLa }; });
      gKey = key;
    }
    const xs = []; for (let i = 0; i <= 80; i++) xs.push(0.04 * Math.pow(25, i / 80));
    gPlot.setData({ series: [
      { x: gData.map(p => p.hb), y: gData.map(p => p.k), color: css('--accent'), label: 'CDi factor, lattice', width: 2.4, points: true, pointSize: 2.5 },
      { x: xs, y: xs.map(r => Wg.imageGround(r, 1)), color: css('--accent'), dash: [5, 4], label: 'image lifting line' },
      { x: xs, y: xs.map(r => Wg.wieselsberger(r, 1)), color: css('--text-3'), dash: [1.5, 3], label: 'Wieselsberger' },
      { x: gData.map(p => p.hb), y: gData.map(p => p.a), color: css('--good'), label: 'CLα ratio, lattice', width: 2, points: true, pointSize: 2.5 },
    ], vlines: C.ground ? [{ x: C.hb, color: css('--text-2'), dash: [3, 3] }] : [] });
  };

  const drawTrefftz = () => {
    if (!wake) return;
    const dpr = Math.min(devicePixelRatio || 1, 2), Wd = tBox.clientWidth, Hd = tBox.clientHeight;
    if (!Wd || !Hd) return;
    if (tCv.width !== Math.round(Wd * dpr) || tCv.height !== Math.round(Hd * dpr)) { tCv.width = Math.round(Wd * dpr); tCv.height = Math.round(Hd * dpr); }
    const g = tCv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, Wd, Hd);
    const s = store.sol, P = s.P, b = P.b;
    const fi = Math.min(wake.length - 1, Math.round(S.xs / S.spans * (wake.length - 1)));
    const f = wake[Math.max(0, fi)];
    const zs0 = Math.min(...wake.map(w => Math.min(...w.z))), zs1 = Math.max(...L0(s).map(p => p.z), 0);
    const zTop = zs1 + 0.12 * b, zBot = C.ground ? Math.max(zs0 - 0.15 * b, -C.hb * b - 0.04 * b) : zs0 - 0.15 * b;
    const k = Math.min((Wd - 30) / (b * 1.25), (Hd - 54) / Math.max(0.3 * b, zTop - zBot));
    const cx = Wd / 2, cy = 42 + ((Hd - 50) - (zTop - zBot) * k) / 2 + zTop * k;
    const X = y => cx + y * k, Y = z => cy - z * k;
    // ground
    if (C.ground) { const zg = -C.hb * b; g.fillStyle = css('--border'); g.globalAlpha = 0.5; g.fillRect(0, Y(zg), Wd, Hd - Y(zg)); g.globalAlpha = 1; g.fillStyle = css('--text-3'); g.font = '11px ' + css('--font'); g.fillText('ground', 8, Y(zg) + 14); }
    // wing at x = 0, faint
    g.strokeStyle = css('--text-3'); g.lineWidth = 2; g.globalAlpha = 0.45; g.beginPath(); L0(s).forEach((p, i) => i ? g.lineTo(X(p.y), Y(p.z)) : g.moveTo(X(p.y), Y(p.z))); g.stroke(); g.globalAlpha = 1;
    // cross-flow arrows from the sheet's vortices
    const kap = s.kap, n = f.y.length, d2 = (0.04 * b / 2) ** 2;
    const vel = (y, z) => { let vy = 0, vz = 0; for (let j = 0; j < n; j++) { if (!kap[j]) continue; let dy = y - f.y[j], dz = z - f.z[j], r2 = dy * dy + dz * dz + d2; vy += -kap[j] * dz / (2 * Math.PI * r2); vz += kap[j] * dy / (2 * Math.PI * r2); if (C.ground) { const zi = -2 * C.hb * b - f.z[j]; dz = z - zi; r2 = dy * dy + dz * dz + d2; vy -= -kap[j] * dz / (2 * Math.PI * r2); vz -= kap[j] * dy / (2 * Math.PI * r2); } } return [vy, vz]; };
    const nx = 17, ny = 9, ys0 = -0.62 * b, ys1 = 0.62 * b, zz0 = zs0 - 0.15 * b, zz1 = zs1 + 0.12 * b;
    const zlo = C.ground ? Math.max(zz0, -C.hb * b + 0.02 * b) : zz0;
    const ref = Math.max(1e-9, Math.abs(s.CL) / (Math.PI * store.W.AR));
    g.strokeStyle = css('--text-2'); g.fillStyle = css('--text-2'); g.lineWidth = 1.1;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const y = ys0 + (ys1 - ys0) * i / (nx - 1), z = zlo + (zz1 - zlo) * j / (ny - 1);
      const [vy, vz] = vel(y, z), m = Math.hypot(vy, vz) / ref;
      if (m < 0.04) continue;
      const Lp = Math.min(16, 9 * Math.sqrt(m)), ux = vy / Math.hypot(vy, vz), uz = vz / Math.hypot(vy, vz);
      const x0 = X(y), y0 = Y(z), x1 = x0 + ux * Lp, y1 = y0 - uz * Lp;
      g.globalAlpha = Math.min(0.75, 0.25 + 0.2 * m);
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      const a = Math.atan2(y1 - y0, x1 - x0); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 - 4 * Math.cos(a - 0.5), y1 - 4 * Math.sin(a - 0.5)); g.lineTo(x1 - 4 * Math.cos(a + 0.5), y1 - 4 * Math.sin(a + 0.5)); g.closePath(); g.fill();
    }
    g.globalAlpha = 1;
    // the sheet
    g.strokeStyle = css('--turb'); g.lineWidth = 2; g.beginPath();
    for (let i = 0; i < n; i++) { const px = X(f.y[i]), py = Y(f.z[i]); i ? g.lineTo(px, py) : g.moveTo(px, py); }
    g.stroke();
    const km = Math.max(1e-12, ...Array.from(kap).map(Math.abs));
    for (let i = 0; i < n; i++) { const r = 1.2 + 3.5 * Math.sqrt(Math.abs(kap[i]) / km); g.fillStyle = css('--turb'); g.beginPath(); g.arc(X(f.y[i]), Y(f.z[i]), r, 0, 2 * Math.PI); g.fill(); }
    // labels
    g.fillStyle = css('--text-2'); g.font = '11px ' + css('--font'); g.textAlign = 'left';
    g.fillText(`${(f.x / b).toFixed(2)} spans (${len(f.x)}) behind the trailing edge`, 10, 16);
    g.fillStyle = css('--text-3'); g.fillText('looking forward, left wing on the left', 10, 31);
    const sink = -(f.z[(n - 1) / 2] - wake[0].z[(n - 1) / 2]);
    tLeg.textContent = `Sheet sunk ${len(Math.max(0, sink))} at the centre. Dots are sized by how much vorticity each carries: most leaves near the tips.`;
  };
  const L0 = s => s.L.st.map(p => ({ y: p.y, z: p.z }));

  const paint = () => { if (!store.sol) return; paintWake(); paintTail(); paintGround(); };
  new ResizeObserver(() => drawTrefftz()).observe(tBox);
  addEventListener('themechange', drawTrefftz);

  let visible = false;
  store.subs.add(() => { if (visible) paint(); });
  build();
  return {
    controls, main,
    show() { visible = true; build(); paint(); },
    hide() { visible = false; playing = false; paintPlay(); cancelAnimationFrame(raf); },
    destroy() { playing = false; cancelAnimationFrame(raf); view.destroy(); removeEventListener('themechange', drawTrefftz); },
  };
}
