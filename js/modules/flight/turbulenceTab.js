// Wind & turbulence tab: Dryden gusts (MIL-F-8785C) flown through at a chosen airspeed, with an animated gust
// field, gust histories, the gust load factor on the aircraft, spectra checked against theory, and the
// log-law wind profile near the ground.
import { h, section, slider, segmented, select, field, cssVar, icon } from '../../lib/ui.js';
import { Plot } from '../../lib/plot.js';
import * as A from '../../solvers/atmosphere.js';
import { card, metricsGrid, insightsList, units, onUnits, unit, toDisp, fromDisp, show, num, canvasBox } from './common.js';

const KT = 0.514444, FT = 0.3048;
const DT = 0.02;

export function turbulenceTab({ keep = o => o } = {}) {
  const S = keep({ h: 500 * FT, sev: 'moderate', W20: 30 * KT, V: 120 * KT, dur: 60, seed: 1, comp: 'w', terrain: 'runway', WS: 2400, CLa: 5.0, view: 'sigma', playing: true });
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });

  function buildControls() {
    const secT = section('Turbulence');
    const sevSeg = segmented([...A.SEVERITY.map(s => ({ value: s.id, label: s.label })), { value: 'custom', label: 'Custom' }], S.sev, v => { S.sev = v; if (v !== 'custom') { S.W20 = A.SEVERITY.find(s => s.id === v).W20; w20S.set(toDisp('speed', S.W20)); } regen(); });
    const w20S = slider({ label: 'Wind at 20 ft, W₂₀', min: 0, max: Math.round(toDisp('speed', 60 * KT)), step: 1, value: toDisp('speed', S.W20), format: v => `${num(+v, 0)} ${unit('speed').u}`, info: 'MIL-F-8785C sets the low-altitude turbulence intensity from the mean wind 20 ft above the ground: σw = 0.1·W₂₀. Light 15 kt, moderate 30 kt, severe 45 kt.', onInput: v => { S.W20 = fromDisp('speed', v); S.sev = 'custom'; sevSeg.set('custom'); regen(); } });
    const altS = slider({ label: 'Height above ground', min: Math.round(toDisp('alt', 10 * FT)), max: Math.round(toDisp('alt', 5000 * FT)), log: true, value: toDisp('alt', S.h), format: v => `${num(+v, 0)} ${unit('alt').u}`, info: 'Near the ground eddies are squashed by the surface: small and strong horizontally, smaller still vertically. Above 2,000 ft the scale is 1,750 ft in every direction.', onInput: v => { S.h = fromDisp('alt', v); regen(); } });
    secT.body.append(field('Severity', sevSeg.el), w20S.el, altS.el);
    const secA = section('Aircraft');
    const vS = slider({ label: 'True airspeed', min: Math.round(toDisp('speed', 40 * KT)), max: Math.round(toDisp('speed', 500 * KT)), step: 1, value: toDisp('speed', S.V), format: v => `${num(+v, 0)} ${unit('speed').u}`, onInput: v => { S.V = fromDisp('speed', v); regen(); } });
    const wsK = units() === 'us' ? 1 / 47.880259 : 0.001, wsU = units() === 'us' ? 'lb/ft²' : 'kPa';
    const wsS = slider({ label: `Wing loading W/S (${wsU})`, min: +(300 * wsK).toFixed(2), max: +(8000 * wsK).toFixed(1), log: true, value: S.WS * wsK, format: v => (+v).toFixed(units() === 'us' ? 1 : 2), info: 'Weight per wing area. Light aircraft ≈ 15 lb/ft² (0.7 kPa), airliners ≈ 120 lb/ft² (5.7 kPa), fighters ≈ 70–110 lb/ft². Heavier wing loading → smoother ride.', onInput: v => { S.WS = v / wsK; regen(); } });
    const claS = slider({ label: 'Lift-curve slope C_Lα', min: 2.5, max: 6.3, step: 0.05, value: S.CLa, format: v => `${(+v).toFixed(2)} /rad`, info: 'Whole-aircraft lift slope. About 2π for a thin 2-D wing, less for finite span and sweep (≈ 4.5–5.5 for airliners, ≈ 3–4 for low-aspect-ratio fighters).', onInput: v => { S.CLa = v; regen(); } });
    secA.body.append(vS.el, wsS.el, claS.el);
    const secW = section('Wind near the ground', { collapsible: true });
    secW.body.append(field('Surface', select(A.ROUGHNESS.map(r => ({ value: r.id, label: r.label })), S.terrain, v => { S.terrain = v; update(); }), 'Surface roughness length z₀ sets how fast the wind slows toward the ground.'));
    const reBtn = h('button', { class: 'btn', type: 'button', onclick: () => { S.seed++; regen(); } }, icon('reset', 14), 'New random gusts');
    controls.replaceChildren(secT.el, secA.el, secW.el, h('div', { class: 'section' }, h('div', { class: 'section-body' }, reBtn)));
  }

  const metrics = metricsGrid();
  const playBtn = h('button', { class: 'btn', type: 'button', onclick: () => { S.playing = !S.playing; if (S.playing) { t0 = performance.now() - (S.tPaused || 0) * 1000; loop(); } else S.tPaused = (performance.now() - t0) / 1000; paintPlay(); scene.paint(); } });
  const paintPlay = () => playBtn.replaceChildren(icon(S.playing ? 'pause' : 'play', 14), S.playing ? 'Pause' : 'Play');
  paintPlay();
  const scene = canvasBox('250px', drawScene, 'flt-scene');
  const sceneCard = h('div', { class: 'plot-card' }, h('div', { class: 'plot-head' }, h('h4', {}, 'Flying through frozen turbulence'), playBtn), scene.el);
  const histCard = card('Gust velocities', 'u: along the flight path (headwind +), v: sideways, w: vertical (up +). Time histories of one random realisation.');
  const histHost = h('div', { class: 'plot' }); histCard.append(histHost);
  const pH = new Plot(histHost, { legend: true, xname: 't', yname: 'gust' });
  const loadCard = card('Gust load factor Δn', 'Extra load factor from the vertical gust, Δn = ρ V C_Lα w / (2 W/S) (quasi-steady, no gust alleviation). This is what passengers feel as bumps.');
  const loadHost = h('div', { class: 'plot' }); loadCard.append(loadHost);
  const pN = new Plot(loadHost, { legend: true, xname: 't', yname: 'Δn' });
  const compSel = select([{ value: 'u', label: 'u (longitudinal)' }, { value: 'v', label: 'v (lateral)' }, { value: 'w', label: 'w (vertical)' }], S.comp, v => { S.comp = v; spectrum(); });
  const psdHost = h('div', { class: 'plot' });
  const psdCard = h('div', { class: 'plot-card' }, h('div', { class: 'plot-head' }, h('h4', {}, 'Spectrum: simulated vs Dryden'), compSel), psdHost);
  const pP = new Plot(psdHost, { legend: true, logx: true, logy: true, xname: 'ω', yname: 'Φ' });
  const viewSeg = segmented([{ value: 'sigma', label: 'Intensity σ' }, { value: 'L', label: 'Scale L' }], S.view, v => { S.view = v; vsAlt(); });
  const altHost = h('div', { class: 'plot' });
  const altCard = h('div', { class: 'plot-card' }, h('div', { class: 'plot-head' }, h('h4', {}, 'Turbulence vs height'), viewSeg.el), altHost);
  const pA = new Plot(altHost, { legend: true, xname: 'value', yname: 'h' });
  const windCard = card('Wind profile (log law)', 'Mean wind u(h) = W₂₀ · ln(h/z₀) / ln(20 ft/z₀) for the selected surface, with the other surfaces dashed.');
  const windHost = h('div', { class: 'plot' }); windCard.append(windHost);
  const pW = new Plot(windHost, { legend: true, xname: 'wind', yname: 'h' });
  const insCard = card('What is happening here'); const ins = h('div'); insCard.append(ins);
  main.append(metrics.el, sceneCard, h('div', { class: 'flt-grid2e' }, histCard, loadCard, psdCard, altCard, windCard, insCard));

  let ser = null, dn = null, t0 = performance.now(), raf = 0;
  function regen() {
    const n = Math.round(S.dur / DT);
    ser = A.drydenSeries({ h: S.h, W20: S.W20, V: S.V, dt: DT, n, seed: S.seed });
    const atm = A.atmosphere(S.h);
    const k = atm.rho * S.V * S.CLa / (2 * S.WS);
    dn = Float64Array.from(ser.w, w => k * w);
    S.kn = k; S.atm = atm;
    update();
  }

  function update() {
    const P = ser.params;
    const dnRms = A.rms(dn); let dnMax = 0; for (const v of dn) dnMax = Math.max(dnMax, Math.abs(v));
    S.dnRms = dnRms; S.dnMax = dnMax;
    metrics.set([
      { k: 'σu (along path)', v: show('gust', P.su), s: `scale Lu ${show('alt', P.Lu)}` },
      { k: 'σv (sideways)', v: show('gust', P.sv), s: `scale Lv ${show('alt', P.Lv)}` },
      { k: 'σw (vertical)', v: show('gust', P.sw), s: `scale Lw ${show('alt', P.Lw)}` },
      { k: 'Eddy crossing time', v: `${(P.Lw / S.V).toFixed(2)} s`, s: 'τ = Lw / V', tip: 'Time to fly through one vertical-gust scale length. Short τ = sharp, high-frequency bumps.' },
      { k: 'RMS Δα', v: `${(P.sw / S.V * 180 / Math.PI).toFixed(2)}°`, s: 'angle-of-attack jitter = σw/V' },
      { k: 'RMS Δn', v: `±${dnRms.toFixed(3)} g`, s: `peak ${dnMax.toFixed(2)} g in ${S.dur} s`, cls: dnMax > 1 ? 'bad' : dnMax > 0.5 ? 'warn' : '' },
      { k: 'Mean wind here', v: show('speed', A.windProfile(S.h, S.W20, z0())), s: `log law, z₀ = ${z0()} m` },
      { k: 'Regime', v: P.regime === 'low' ? 'low altitude' : P.regime === 'high' ? 'medium/high' : 'blend', s: P.regime === 'low' ? 'below 1,000 ft' : P.regime === 'high' ? 'above 2,000 ft' : '1,000–2,000 ft' },
    ]);
    histories(); spectrum(); vsAlt(); wind(); insights();
    scene.paint();
  }
  const z0 = () => A.ROUGHNESS.find(r => r.id === S.terrain).z0;

  function histories() {
    const t = Array.from(ser.t), g = k => Array.from(ser[k], v => toDisp('gust', v));
    pH.setOpts({ xlabel: 'Time (s)', ylabel: `Gust (${unit('gust').u})`, xfmt: v => v.toFixed(2), yfmt: v => v.toFixed(2) });
    pH.setData({ series: [{ x: t, y: g('u'), color: cssVar('--lower'), label: 'u', width: 1.1 }, { x: t, y: g('v'), color: cssVar('--good'), label: 'v', width: 1.1, alpha: 0.75 }, { x: t, y: g('w'), color: cssVar('--accent'), label: 'w', width: 1.4 }] });
    pN.setOpts({ xlabel: 'Time (s)', ylabel: 'Δn (g)', xfmt: v => v.toFixed(2), yfmt: v => v.toFixed(3) });
    pN.setData({ series: [{ x: t, y: Array.from(dn), color: cssVar('--accent'), label: 'Δn = k·w', width: 1.3 }], hlines: [{ y: S.dnRms, color: cssVar('--warn'), label: '+RMS', dash: [5, 4] }, { y: -S.dnRms, color: cssVar('--warn'), dash: [5, 4] }] });
  }
  function spectrum() {
    // a longer record for a smooth spectrum (same statistics as the history shown)
    const long = A.drydenSeries({ h: S.h, W20: S.W20, V: S.V, dt: DT, n: 2 ** 15, seed: S.seed + 1000 });
    const P = long.params, L = { u: P.Lu, v: P.Lv, w: P.Lw }[S.comp], sg = { u: P.su, v: P.sv, w: P.sw }[S.comp];
    const W = A.welch(long[S.comp], DT, 1024), k = toDisp('gust', 1) ** 2;
    const xs = [], ys = [], th = [];
    for (let i = 1; i < W.w.length; i++) { xs.push(W.w[i]); ys.push(W.P[i] * k); th.push(A.drydenPSD(S.comp, W.w[i], sg, L, S.V) * k); }
    pP.setOpts({ xlabel: 'Frequency ω (rad/s)', ylabel: `Φ (${unit('gust').u})²/(rad/s)`, xfmt: v => v.toPrecision(3), yfmt: v => v.toExponential(2) });
    pP.setData({ series: [{ x: xs, y: ys, color: cssVar('--text-3'), label: 'simulated (Welch)', width: 1.1 }, { x: xs, y: th, color: cssVar('--accent'), label: 'Dryden theory', width: 2.2 }], vlines: [{ x: S.V / L, color: cssVar('--warn') }] });
  }
  function vsAlt() {
    const hs = [], su = [], sw = [], lu = [], lw = [];
    for (let i = 0; i <= 120; i++) { const hh = 10 * FT * (500) ** (i / 120); const P = A.dryden(hh, S.W20); hs.push(toDisp('alt', hh)); su.push(toDisp('gust', P.su)); sw.push(toDisp('gust', P.sw)); lu.push(toDisp('alt', P.Lu)); lw.push(toDisp('alt', P.Lw)); }
    const sig = S.view === 'sigma';
    pA.setOpts({ xlabel: sig ? `σ (${unit('gust').u})` : `Scale length L (${unit('alt').u})`, ylabel: `Height (${unit('alt').u})`, logy: true, logx: !sig, xfmt: v => num(v, 2), yfmt: v => num(v, 0) });
    pA.setData({ series: sig ? [{ x: su, y: hs, color: cssVar('--lower'), label: 'σu = σv' }, { x: sw, y: hs, color: cssVar('--accent'), label: 'σw' }] : [{ x: lu, y: hs, color: cssVar('--lower'), label: 'Lu = Lv' }, { x: lw, y: hs, color: cssVar('--accent'), label: 'Lw' }], hlines: [{ y: toDisp('alt', S.h), color: cssVar('--text-3'), dash: [2, 3], bound: false }] });
  }
  function wind() {
    const series = A.ROUGHNESS.map(r => {
      const hs = [], ws = [];
      for (let i = 0; i <= 100; i++) { const hh = Math.max(r.z0 * 1.01, 0.5 * 600 ** (i / 100)); hs.push(toDisp('alt', hh)); ws.push(toDisp('speed', A.windProfile(hh, S.W20, r.z0))); }
      const sel = r.id === S.terrain;
      return { x: ws, y: hs, color: sel ? cssVar('--accent') : cssVar('--text-3'), dash: sel ? null : [3, 4], width: sel ? 2.4 : 1, label: sel ? r.label : null, noHover: !sel, alpha: sel ? 1 : 0.6 };
    });
    pW.setOpts({ xlabel: `Mean wind (${unit('speed').u})`, ylabel: `Height (${unit('alt').u})`, logy: true, xfmt: v => num(v, 1), yfmt: v => num(v, 1) });
    pW.setData({ series, hlines: [{ y: toDisp('alt', 6.096), color: cssVar('--warn'), label: '20 ft', bound: false }] });
  }
  function insights() {
    const P = ser.params, L = [];
    if (P.regime === 'low') L.push({ type: 'i', t: 'Near the ground, eddies are flattened', d: `The surface limits how big a vertical eddy can be (Lw = height), while horizontal ones stretch further (Lu = ${show('alt', P.Lu)}). Horizontal gusts are also stronger: σu/σw = ${(P.su / P.sw).toFixed(2)}.` });
    else L.push({ type: 'i', t: 'Away from the ground, turbulence is isotropic', d: 'Above about 2,000 ft the eddies have the same size (1,750 ft) and strength in every direction.' });
    L.push({ type: 'i', t: 'Frozen turbulence (Taylor\'s hypothesis)', d: `The gust pattern barely changes in the time the aircraft takes to cross it, so flying faster just plays the same spatial pattern faster: frequency ω = V·Ω. The orange line on the spectrum is the corner frequency V/L = ${(S.V / ({ u: P.Lu, v: P.Lv, w: P.Lw }[S.comp])).toFixed(2)} rad/s.` });
    L.push({ type: S.dnMax > 0.5 ? 'w' : 'g', t: `Ride: ±${S.dnRms.toFixed(2)} g RMS`, d: `Δn per unit gust is ${(S.kn * (units() === 'us' ? FT : 1)).toFixed(3)} g per ${unit('gust').u}. It grows with airspeed and lift slope, and shrinks with wing loading: that is why a light aircraft bounces in the same air that an airliner shrugs off. Above about 0.5 g unsecured objects and passengers leave their seats.` });
    if (S.W20 >= 40 * KT) L.push({ type: 'b', t: 'Severe turbulence', d: 'Momentary loss of control is possible. Pilots slow to the turbulence penetration speed so a gust cannot push the wing past its stall or structural limits.' });
    insightsList(ins, L);
  }

  // ---- animated scene: the aircraft flies left to right through the frozen gust field ----
  function drawScene(c, W, H) {
    if (!ser) return;
    const now = S.playing ? (performance.now() - t0) / 1000 : (S.tPaused ?? 0);
    const tNow = now % (S.dur - 8), win = 8;            // seconds of flight shown
    const xPlane = W * 0.3, pxPerS = W / win;
    const midY = H * 0.55, wScale = Math.min(H * 0.32 / Math.max(3.2 * ser.params.sw, 1e-6), 40);
    const ground = cssVar('--text-3');
    // sky band and ground hint
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, cssVar('--bg-sunk')); g.addColorStop(1, cssVar('--bg-elev'));
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    if (S.h < 300) { c.fillStyle = ground; c.globalAlpha = 0.25; c.fillRect(0, H - 8, W, 8); c.globalAlpha = 1; }
    // gust arrows: sample the field every 0.1 s of flight
    const i0 = Math.floor((tNow - win * 0.3) / DT);
    const step = Math.max(1, Math.round(0.1 / DT));
    for (let i = Math.max(0, i0 - (i0 % step)); i < ser.w.length; i += step) {
      const t = i * DT, X = xPlane + (t - tNow) * pxPerS;
      if (X < -10) continue; if (X > W + 10) break;
      const w = ser.w[i], len = w * wScale;
      c.strokeStyle = w > 0 ? cssVar('--accent') : cssVar('--lower'); c.fillStyle = c.strokeStyle; c.lineWidth = 1.6; c.globalAlpha = 0.75;
      c.beginPath(); c.moveTo(X, midY); c.lineTo(X, midY - len); c.stroke();
      if (Math.abs(len) > 4) { const d = Math.sign(len); c.beginPath(); c.moveTo(X, midY - len); c.lineTo(X - 3, midY - len + 5 * d); c.lineTo(X + 3, midY - len + 5 * d); c.fill(); }
      c.globalAlpha = 1;
    }
    // the aircraft: bobs with the gust load, pitches with Δα
    const iNow = Math.min(ser.w.length - 1, Math.max(0, Math.round(tNow / DT)));
    const wNow = ser.w[iNow], da = Math.atan2(wNow, S.V);
    let z = 0; for (let k = Math.max(0, iNow - 40); k <= iNow; k++) z += dn[k] * Math.exp(-(iNow - k) / 15); // smoothed heave for the picture
    const Y = midY - H * 0.18 - Math.max(-H * 0.12, Math.min(H * 0.12, z * 6));
    c.save(); c.translate(xPlane, Y); c.rotate(-da * 3);
    c.fillStyle = cssVar('--text'); c.beginPath();
    c.moveTo(26, 0); c.quadraticCurveTo(22, -4, 10, -4); c.lineTo(-18, -3); c.lineTo(-26, -13); c.lineTo(-30, -13); c.lineTo(-26, -2); c.lineTo(-28, 2); c.lineTo(-18, 3); c.lineTo(10, 3); c.quadraticCurveTo(22, 3, 26, 0); c.fill();
    c.globalAlpha = 0.85; c.beginPath(); c.moveTo(4, 0); c.lineTo(-8, 7); c.lineTo(-12, 7); c.lineTo(-6, 0); c.fill(); c.globalAlpha = 1;
    c.restore();
    // readout
    c.fillStyle = cssVar('--text-2'); c.font = '11.5px ' + cssVar('--font'); c.textAlign = 'left'; c.textBaseline = 'top';
    c.fillText(`t = ${tNow.toFixed(1)} s   w = ${num(toDisp('gust', wNow), 2)} ${unit('gust').u}   Δα = ${(da * 180 / Math.PI).toFixed(2)}°   Δn = ${dn[iNow] >= 0 ? '+' : ''}${dn[iNow].toFixed(2)} g`, 10, 8);
    c.fillStyle = cssVar('--text-3'); c.textBaseline = 'bottom';
    c.fillText('blue: updraft · orange: downdraft · the gust pattern is fixed in the air; the aircraft flies through it', 10, H - 6);
  }
  function loop() {
    cancelAnimationFrame(raf);
    const tick = () => { if (!main.isConnected || !S.playing) return; scene.paint(); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
  }

  buildControls();
  const off = onUnits(() => { buildControls(); update(); });
  regen();
  return { controls, main, show: () => { if (S.playing) { t0 = performance.now() - (S.tPaused ?? 0) * 1000; loop(); } [pH, pN, pP, pA, pW].forEach(p => p.draw()); }, destroy: () => { off(); cancelAnimationFrame(raf); } };
}
