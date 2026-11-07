// Atmosphere tab: US Standard Atmosphere 1976 (0–86 km) with hot/cold days. A draggable column of the
// atmosphere (layers, temperature profile, landmarks), a profile plot of any property, insights and a table.
import { h, section, slider, segmented, toggle, select, field, cssVar, downloadText } from '../../lib/ui.js';
import { Plot } from '../../lib/plot.js';
import * as A from '../../solvers/atmosphere.js';
import { card, metricsGrid, insightsList, units, onUnits, unit, toDisp, fromDisp, show, temp, num, canvasBox, altAxis } from './common.js';

const RANGES = { avi: 20000, mid: 50000, full: A.Z_MAX };
const LANDMARKS = [
  { z: 8849, t: 'Mt Everest' },
  { z: 11300, t: 'Airliner cruise' },
  { z: 18300, t: 'Concorde' },
  { z: 19000, t: 'Armstrong limit', tip: 'blood boils at body temperature' },
  { z: 21300, t: 'U-2' },
  { z: 25930, t: 'SR-71 altitude record' },
  { z: 35000, t: 'Weather balloons burst' },
  { z: 41420, t: 'Highest skydive (2014)' },
  { z: 83000, t: 'Noctilucent clouds' },
];
const QTY = {
  T: { label: 'Temperature', get: s => s.T, unit: () => 'K', name: 'T' },
  p: { label: 'Pressure', get: s => toDisp('press', s.p), unit: () => unit('press').u, name: 'p', log: true },
  rho: { label: 'Density', get: s => toDisp('rho', s.rho), unit: () => unit('rho').u, name: 'ρ', log: true },
  a: { label: 'Speed of sound', get: s => toDisp('speed', s.a), unit: () => unit('speed').u, name: 'a' },
  mu: { label: 'Dynamic viscosity', get: s => toDisp('mu', s.mu), unit: () => unit('mu').u, name: 'μ' },
  nu: { label: 'Kinematic viscosity', get: s => toDisp('nu', s.nu), unit: () => unit('nu').u, name: 'ν', log: true },
  lambda: { label: 'Mean free path', get: s => toDisp('len', s.lambda), unit: () => unit('len').u, name: 'λ', log: true },
  g: { label: 'Gravity', get: s => toDisp('accel', s.g), unit: () => unit('accel').u, name: 'g' },
  ratios: { label: 'Ratios θ, δ, σ', unit: () => '', name: 'ratio', log: true },
};

export function atmosphereTab({ keep = o => o } = {}) {
  const S = keep({ z: 0, dT: 0, range: 'avi', qty: 'T', log: false });
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });
  let altS, dTS;

  function buildControls() {
    const u = unit('alt'), zTop = RANGES[S.range];
    const secA = section('Altitude');
    altS = slider({
      label: S.dT ? 'Pressure altitude' : 'Altitude', min: 0, max: Math.round(toDisp('alt', zTop)), step: units() === 'us' ? 100 : 50, value: toDisp('alt', S.z),
      format: v => `${num(+v, 0)} ${u.u}`, info: 'Geometric height above mean sea level on a standard day. With a temperature offset the pressure is kept, so this becomes the pressure altitude (what an altimeter set to 29.92 inHg / 1013 hPa reads) and the real height is shown as true altitude.',
      onInput: v => { S.z = fromDisp('alt', v); update(); },
    });
    const presets = h('div', { class: 'flt-presets' }, ...[['Sea level', 0], ['FL180', A.geometric(18000 * 0.3048)], ['FL350', A.geometric(35000 * 0.3048)], ['U-2', 21300], ['SR-71', 25930], ['50 km', 50000]].map(([t, z]) =>
      h('button', { class: 'btn', type: 'button', onclick: () => { if (z > RANGES[S.range]) { S.range = z > RANGES.mid ? 'full' : z > RANGES.avi ? 'mid' : 'avi'; } S.z = z; buildControls(); update(); } }, t)));
    dTS = slider({
      label: 'Temperature offset ΔT', min: -40, max: 40, step: 1, value: S.dT, format: v => (v > 0 ? '+' : '') + (+v).toFixed(0) + ' K',
      info: 'Hot or cold day: every temperature in the column is shifted by ΔT while pressure at each pressure altitude stays standard. ISA+20 is a hot summer day at sea level (35 °C).',
      hint: 'Same pressure, different temperature → different density, density altitude and true altitude.',
      onInput: v => { const was = !!S.dT; S.dT = v; if (was !== !!v) buildControls(); update(); },
    });
    secA.body.append(altS.el, presets, dTS.el);
    const secC = section('Column and plot');
    const rng = segmented([{ value: 'avi', label: '0–20 km' }, { value: 'mid', label: '0–50 km' }, { value: 'full', label: '0–86 km' }], S.range, v => { S.range = v; if (S.z > RANGES[v]) S.z = RANGES[v]; buildControls(); update(); });
    const qSel = select(Object.entries(QTY).map(([k, q]) => ({ value: k, label: q.label })), S.qty, v => { S.qty = v; S.log = !!QTY[v].log; logT.set(S.log); update(); });
    const logT = toggle('Log scale', S.log, v => { S.log = v; update(); }, { tip: 'Pressure and density fall roughly exponentially with height, so a log axis shows them as nearly straight lines (the slope is the scale height).' });
    secC.body.append(field('Height range', rng.el), field('Plot quantity', qSel), logT.el);
    controls.replaceChildren(secA.el, secC.el);
  }

  // ---- main area ----
  const metrics = metricsGrid();
  const col = canvasBox('560px', drawColumn, 'flt-column');
  const colCard = card('The atmosphere column', 'Sky colour darkens as the air thins. The white line is the standard temperature profile (bottom axis); drag anywhere to change altitude.', col.el);
  const plotCard = card('Profile', 'The selected property against altitude. The dashed line marks the current altitude.');
  const plotHost = h('div', { class: 'flt-plot-tall' }); plotCard.append(plotHost);
  const plot = new Plot(plotHost, { legend: true });
  const insCard = card('What is happening here');
  const ins = h('div'); insCard.append(ins);
  const stepSel = h('span');
  const tableHost = h('div', { class: 'table-wrap flt-table' });
  const csvBtn = h('button', { class: 'btn', type: 'button', onclick: () => exportCsv() }, 'CSV');
  const tableCard = h('div', { class: 'plot-card' }, h('div', { class: 'plot-head' }, h('h4', {}, 'Standard atmosphere table'), h('div', { class: 'row' }, stepSel, csvBtn)), tableHost);
  main.append(metrics.el, h('div', { class: 'flt-grid2' }, colCard, plotCard), insCard, tableCard);

  // drag on the column to set altitude
  let colTr = null, dragging = false;
  const fromY = e => { const r = col.canvas.getBoundingClientRect(); return colTr ? colTr.iz(e.clientY - r.top) : S.z; };
  col.canvas.addEventListener('pointerdown', e => { dragging = true; col.canvas.setPointerCapture(e.pointerId); S.z = Math.max(0, Math.min(RANGES[S.range], fromY(e))); altS.set(toDisp('alt', S.z)); update(); });
  col.canvas.addEventListener('pointermove', e => { if (!dragging) return; S.z = Math.max(0, Math.min(RANGES[S.range], fromY(e))); altS.set(toDisp('alt', S.z)); update(); });
  col.canvas.addEventListener('pointerup', () => { dragging = false; });

  function drawColumn(c, W, H) {
    const zTop = RANGES[S.range], pl = 14, pr = 14, pt = 12, pb = 36, iw = W - pl - pr, ih = H - pt - pb;
    const y = z => pt + (1 - z / zTop) * ih;
    colTr = { iz: Y => (1 - (Y - pt) / ih) * zTop };
    // sky: colour by absolute height so zooming keeps the colours honest
    const sky = [[0, '#9fd0ff'], [6000, '#6aa8f0'], [12000, '#3f7fd6'], [25000, '#22489a'], [45000, '#10224f'], [65000, '#070f29'], [86000, '#02040c']];
    const skyAt = z => { for (let i = 1; i < sky.length; i++) if (z <= sky[i][0]) { const [z0, c0] = sky[i - 1], [z1, c1] = sky[i], t = (z - z0) / (z1 - z0); return mix(c0, c1, t); } return sky[sky.length - 1][1]; };
    const g = c.createLinearGradient(0, y(0), 0, y(zTop));
    for (let i = 0; i <= 12; i++) g.addColorStop(i / 12, skyAt(zTop * i / 12));
    c.fillStyle = g; c.beginPath(); c.roundRect(pl, pt, iw, ih, 8); c.fill();
    c.save(); c.beginPath(); c.roundRect(pl, pt, iw, ih, 8); c.clip();
    // ozone layer band
    if (zTop > 15000) { c.fillStyle = 'rgba(170, 120, 255, 0.13)'; c.fillRect(pl, y(Math.min(35000, zTop)), iw, y(15000) - y(Math.min(35000, zTop))); }
    // temperature axis
    const prof = []; for (let i = 0; i <= 300; i++) { const z = zTop * i / 300; prof.push([z, A.atmosphere(z).T]); }
    let T0 = 180, T1 = 300; for (const [, T] of prof) { T0 = Math.min(T0, T + Math.min(0, S.dT) - 8); T1 = Math.max(T1, T + Math.max(0, S.dT) + 8); }
    const x = T => pl + 40 + (T - T0) / (T1 - T0) * (iw - 80);
    c.strokeStyle = 'rgba(255,255,255,0.09)'; c.lineWidth = 1; c.beginPath();
    for (let T = Math.ceil(T0 / 20) * 20; T <= T1; T += 20) { c.moveTo(x(T), pt); c.lineTo(x(T), pt + ih); }
    c.stroke();
    // layer boundaries and names
    c.font = '600 11px ' + cssVar('--font'); c.textBaseline = 'middle';
    const bounds = [[11000, 'Tropopause'], [20000, ''], [32000, ''], [47000, 'Stratopause'], [51000, ''], [71000, '']].map(([Hh, t]) => [A.geometric(Hh), t]);
    for (const [zb, t] of bounds) {
      if (zb > zTop) continue;
      c.strokeStyle = 'rgba(255,255,255,0.28)'; c.setLineDash(t ? [6, 4] : [2, 5]); c.beginPath(); c.moveTo(pl, y(zb)); c.lineTo(pl + iw, y(zb)); c.stroke(); c.setLineDash([]);
      if (t) { c.fillStyle = 'rgba(255,255,255,0.6)'; c.textAlign = 'right'; c.fillText(t, pl + iw - 8, y(zb) - 8); }
    }
    const regions = [[0, A.geometric(11000), 'TROPOSPHERE'], [A.geometric(11000), A.geometric(47000), 'STRATOSPHERE'], [A.geometric(51000), A.Z_MAX, 'MESOSPHERE']];
    c.font = '700 11px ' + cssVar('--font'); c.textAlign = 'right';
    for (const [a, b, t] of regions) { if (a >= zTop) continue; const m = (a + Math.min(b, zTop)) / 2; c.fillStyle = 'rgba(255,255,255,0.5)'; c.fillText(t, pl + iw - 8, y(m)); }
    if (zTop > 15000) { c.fillStyle = 'rgba(220, 200, 255, 0.75)'; c.font = '11px ' + cssVar('--font'); c.fillText('ozone layer: absorbs UV, heats the stratosphere', pl + iw - 8, y(Math.min(25000, zTop * 0.9)) + 16); }
    // landmarks (left)
    c.textAlign = 'left'; c.font = '11px ' + cssVar('--font');
    let lastY = Infinity;                               // labels placed bottom-up, pushed apart so they never overlap
    for (const L of LANDMARKS) {
      if (L.z > zTop * 0.985) continue;
      const Y = y(L.z), Yl = Math.min(Y, lastY - 14); lastY = Yl;
      c.strokeStyle = 'rgba(255,255,255,0.6)'; c.beginPath(); c.moveTo(pl, Y); c.lineTo(pl + 8, Y); c.lineTo(pl + 12, Yl); c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.85)'; c.fillText(`${L.t} · ${show('alt', L.z)}`, pl + 15, Yl);
    }
    // temperature profiles
    const line = (off, color, dash, w) => { c.strokeStyle = color; c.lineWidth = w; c.setLineDash(dash); c.beginPath(); prof.forEach(([z, T], i) => { const X = x(T + off), Y = y(z); i ? c.lineTo(X, Y) : c.moveTo(X, Y); }); c.stroke(); c.setLineDash([]); };
    line(0, 'rgba(255,255,255,0.95)', [], 2.2);
    if (S.dT) line(S.dT, S.dT > 0 ? '#ffb070' : '#9fe3ff', [6, 4], 2);
    // current altitude
    const s = A.atmosphere(S.z, S.dT), Y = y(Math.min(S.z, zTop)), X = x(s.T);
    c.strokeStyle = '#ffd34d'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(pl, Y); c.lineTo(pl + iw, Y); c.stroke();
    c.fillStyle = '#ffd34d'; c.strokeStyle = '#1a1a1a'; c.lineWidth = 2; c.beginPath(); c.arc(X, Y, 6, 0, 2 * Math.PI); c.fill(); c.stroke();
    const below = (1 - s.p / A.SEA.p) * 100;
    const lab = `${show('alt', S.z)} · ${s.T.toFixed(1)} K · ${below.toFixed(below > 99 ? 3 : 1)}% of the air's mass is below`;
    c.font = '600 11.5px ' + cssVar('--font'); const tw = c.measureText(lab).width + 14;
    const bx = Math.min(Math.max(X - tw / 2, pl + 6), pl + iw - tw - 6), by = Y < pt + 34 ? Y + 10 : Y - 30;
    c.fillStyle = 'rgba(10, 14, 24, 0.82)'; c.beginPath(); c.roundRect(bx, by, tw, 21, 6); c.fill();
    c.fillStyle = '#fff'; c.textAlign = 'left'; c.fillText(lab, bx + 7, by + 11);
    c.restore();
    // bottom axis
    c.fillStyle = cssVar('--text-3'); c.font = '10.5px ' + cssVar('--mono'); c.textAlign = 'center'; c.textBaseline = 'top';
    for (let T = Math.ceil(T0 / 20) * 20; T <= T1; T += 20) c.fillText(T, x(T), pt + ih + 4);
    c.fillStyle = cssVar('--text-2'); c.font = '11px ' + cssVar('--font'); c.fillText('Temperature (K)', pl + iw / 2, pt + ih + 19);
  }

  function updatePlot() {
    const zTop = RANGES[S.range], q = QTY[S.qty], n = 240, zs = [], std = [], day = [], th = [], de = [], si = [];
    for (let i = 0; i <= n; i++) {
      const z = zTop * i / n, s0 = A.atmosphere(z), s1 = A.atmosphere(z, S.dT);
      zs.push(altAxis.k(z));
      if (S.qty === 'ratios') { th.push(s1.theta); de.push(s1.delta); si.push(s1.sigma); } else { std.push(q.get(s0)); day.push(q.get(s1)); }
    }
    const zNow = altAxis.k(S.z);
    let series;
    if (S.qty === 'ratios') series = [{ x: th, y: zs, color: cssVar('--lower'), label: 'θ = T/T₀' }, { x: de, y: zs, color: cssVar('--accent'), label: 'δ = p/p₀' }, { x: si, y: zs, color: cssVar('--good'), label: 'σ = ρ/ρ₀' }];
    else {
      series = [{ x: std, y: zs, color: cssVar('--accent'), label: 'standard day' }];
      if (S.dT && !['p', 'g'].includes(S.qty)) series.push({ x: day, y: zs, color: S.dT > 0 ? cssVar('--lower') : cssVar('--turb') || cssVar('--good'), dash: [6, 4], label: `ISA${S.dT > 0 ? '+' : ''}${S.dT}` });
    }
    plot.setOpts({ xlabel: `${q.label}${q.unit() ? ' (' + q.unit() + ')' : ''}`, ylabel: altAxis.label(), logx: S.log, xname: q.name, yname: 'alt', xfmt: v => num(v, 4), yfmt: altAxis.fmt, ylim: [0, altAxis.k(zTop)] });
    plot.setData({ series, hlines: [{ y: zNow, color: cssVar('--text-3'), bound: false }] });
  }

  function updateTable() {
    const us = units() === 'us', zTop = RANGES[S.range];
    const steps = us ? [[1000, '1,000 ft'], [5000, '5,000 ft'], [10000, '10,000 ft']] : [[500, '500 m'], [1000, '1 km'], [5000, '5 km']];
    if (!S.step || !steps.some(s => s[0] === S.step)) S.step = steps[S.range === 'avi' ? 1 : 2][0];
    stepSel.replaceChildren(select(steps.map(([v, l]) => ({ value: v, label: 'every ' + l })), String(S.step), v => { S.step = +v; updateTable(); }));
    const rows = [];
    for (let d = 0; fromDisp('alt', d) <= zTop + 1; d += S.step) rows.push(A.atmosphere(fromDisp('alt', d), S.dT));
    let best = 0; rows.forEach((r, i) => { if (Math.abs(r.z - S.z) < Math.abs(rows[best].z - S.z)) best = i; });
    const head = [`Altitude ${unit('alt').u}`, 'T K', us ? 'T °F' : 'T °C', `p ${unit('press').u}`, `ρ ${unit('rho').u}`, 'σ', `a ${unit('speed').u}`, `ν ${unit('nu').u}`];
    const cells = r => [num(toDisp('alt', r.z), 0), r.T.toFixed(2), us ? ((r.T - 273.15) * 1.8 + 32).toFixed(1) : (r.T - 273.15).toFixed(1), sig(toDisp('press', r.p)), sig(toDisp('rho', r.rho)), sig(r.sigma), num(toDisp('speed', r.a), 1), sig(toDisp('nu', r.nu))];
    S.tableRows = { head, rows: rows.map(cells) };
    tableHost.replaceChildren(h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ...head.map(x => h('th', {}, x)))),
      h('tbody', {}, ...rows.map((r, i) => h('tr', { class: i === best ? 'hl' : '' }, ...cells(r).map(x => h('td', {}, x)))))));
  }
  function exportCsv() {
    const { head, rows } = S.tableRows;
    downloadText(`standard-atmosphere${S.dT ? '-ISA' + (S.dT > 0 ? '+' : '') + S.dT : ''}.csv`, [head.join(','), ...rows.map(r => r.map(x => String(x).replace(/,/g, '')).join(','))].join('\n'));
  }

  function update() {
    const s = A.atmosphere(S.z, S.dT);
    const m = [
      { k: 'Temperature', v: temp(s.T), s: S.dT ? `standard ${s.Tstd.toFixed(2)} K` : `θ = T/T₀ = ${s.theta.toFixed(4)}` },
      { k: 'Pressure', v: show('press', s.p), s: `δ = p/p₀ = ${s.delta.toFixed(5)}` },
      { k: 'Density', v: show('rho', s.rho), s: `σ = ρ/ρ₀ = ${s.sigma.toFixed(5)}` },
      { k: 'Speed of sound', v: show('speed', s.a), s: units() === 'us' ? `${s.a.toFixed(1)} m/s` : `${(s.a / 0.514444).toFixed(1)} kt` },
      { k: 'Dynamic viscosity μ', v: num(toDisp('mu', s.mu), 4), s: unit('mu').u, tip: 'Sutherland\'s law: depends on temperature only, not pressure.' },
      { k: 'Kinematic viscosity ν', v: num(toDisp('nu', s.nu), 4), s: `${unit('nu').u} (Re = V·L/ν)` },
      { k: 'Pressure altitude', v: show('alt', s.pressureAlt), s: `FL${String(Math.round(s.pressureAlt / 0.3048 / 100)).padStart(3, '0')}`, tip: 'Geopotential height with this pressure in the standard atmosphere. Flight levels are pressure altitudes in hundreds of feet.' },
      { k: 'Density altitude', v: show('alt', s.densityAlt), s: 'how high the air "feels"', cls: S.dT > 0 && s.densityAlt - s.pressureAlt > 600 ? 'warn' : '', tip: 'Height in the standard atmosphere with this density. Wings, propellers and engines perform as if they were at the density altitude.' },
      { k: 'True altitude', v: show('alt', s.trueAlt), s: S.dT ? `${s.trueAlt > S.z ? '+' : ''}${show('alt', s.trueAlt - S.z)} vs indicated` : 'geometric height', tip: 'Real height above sea level. A warm column of air is taller, so on a hot day you are higher than the altimeter says; on a cold day lower.' },
      { k: 'Gravity', v: show('accel', s.g), s: `${((1 - s.g / A.G0) * 100).toFixed(2)}% less than sea level` },
      { k: 'Mean free path', v: show('len', s.lambda, 3), s: `${num(s.collisionFreq, 3)} collisions/s`, tip: 'Average distance a molecule travels between collisions. The air behaves as a continuum while this is much smaller than the body.' },
      { k: 'Scale height', v: show('alt', s.scaleHeight), s: 'pressure ÷ e every this much', tip: 'H = RT/g. In an isothermal layer pressure falls by a factor e = 2.718 every scale height.' },
    ];
    metrics.set(m);
    col.paint(); updatePlot(); updateTable(); insights(s);
  }

  function insights(s) {
    const L = [];
    const lapse = s.lapse * 1000;
    const why = s.layerIndex === 0 ? 'The ground is heated by the Sun and warms the air from below; rising air expands and cools.'
      : s.layerIndex <= 1 || s.layerIndex === 4 ? 'Heating and cooling balance here, so the temperature stays constant (isothermal layer).'
        : s.layerIndex <= 3 ? 'Ozone absorbs the Sun\'s ultraviolet light and heats this layer from within, so it warms with height.'
          : 'Above the ozone heating the air radiates heat to space, so it cools with height again.';
    L.push({ type: 'i', t: `${s.layer}: ${lapse === 0 ? 'temperature constant' : lapse < 0 ? `cools ${(-lapse).toFixed(1)} K per km` : `warms ${lapse.toFixed(1)} K per km`}`, d: why });
    const below = (1 - s.p / A.SEA.p) * 100;
    L.push({ type: 'i', t: `${below.toFixed(below > 99 ? 2 : 1)}% of the atmosphere is below you`, d: `Pressure is the weight of the air above. Half of all the air lies below about ${show('alt', 5574)}, and 99% below about ${show('alt', 31000)}.` });
    if (S.z > 19000) L.push({ type: 'b', t: 'Above the Armstrong limit', d: 'Pressure is below 6.3 kPa, where water boils at body temperature (37 °C). An unprotected person loses consciousness in seconds: a pressure suit is required.' });
    else if (s.pressureAlt > 14000 * 0.3048) L.push({ type: 'w', t: 'Supplemental oxygen required', d: 'Above 14,000 ft cabin altitude pilots must use oxygen at all times (FAA 14 CFR 91.211); above 12,500 ft after 30 minutes. Airliners pressurise the cabin to about 6,000–8,000 ft.' });
    if (S.dT) {
      const dDa = s.densityAlt - s.pressureAlt;
      L.push({ type: S.dT > 0 ? 'w' : 'g', t: `Density altitude ${show('alt', s.densityAlt)} (${dDa > 0 ? '+' : ''}${show('alt', dDa)})`, d: S.dT > 0 ? 'Hot air is thinner: takeoff runs are longer, climb is weaker and engines make less thrust, as if the airfield were higher. Rule of thumb: about 120 ft of density altitude per °C above standard.' : 'Cold, dense air improves lift, thrust and climb: the aircraft performs as if it were lower.' });
      L.push({ type: S.dT < 0 ? 'w' : 'i', t: `True altitude ${S.dT > 0 ? 'above' : 'below'} indicated by ${show('alt', Math.abs(s.trueAlt - S.z))}`, d: S.dT < 0 ? 'Cold air is denser, so the pressure levels sit lower: the aircraft is closer to the terrain than the altimeter shows ("high to low, look out below"). Approach minimums get a cold-temperature correction.' : 'Warm air is less dense, so the pressure levels sit higher: the aircraft is higher than the altimeter shows.' });
    }
    if (s.lambda > 1e-3) L.push({ type: 'w', t: 'Air is getting rarefied', d: `Molecules travel ${show('len', s.lambda, 4)} between collisions. For a small probe the Knudsen number λ/L is no longer tiny, and continuum flow equations start to fail (slip flow, then free-molecular flow).` });
    insightsList(ins, L);
  }

  buildControls();
  const off = onUnits(() => { buildControls(); update(); });
  update();
  return { controls, main, show: () => { col.paint(); plot.draw(); }, destroy: () => off() };
}

// five significant figures, plain notation down to 1e-6 (keeps a table column readable)
const sig = v => (Math.abs(v) >= 1e-6 ? String(+v.toPrecision(5)) : v.toExponential(4));

function mix(a, b, t) {
  const p = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16));
  const A = p(a), B = p(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`;
}
