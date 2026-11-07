// Airspeeds tab: CAS ↔ EAS ↔ TAS ↔ Mach from any one of them through the pitot impact pressure, a "speed ladder"
// showing what separates each pair, the equations with numbers, and a CAS/Mach climb schedule with its crossover.
import { h, section, slider, segmented, field, cssVar } from '../../lib/ui.js';
import { Plot } from '../../lib/plot.js';
import * as A from '../../solvers/atmosphere.js';
import { card, metricsGrid, insightsList, units, onUnits, unit, toDisp, fromDisp, show, num, canvasBox, altAxis } from './common.js';

const KT = 0.514444, FT = 0.3048;
// atmosphere at a pressure altitude (geopotential height H)
const atmAt = (H, dT) => A.atmosphere(A.geometric(H), dT);
const KINDS = [{ value: 'cas', label: 'CAS' }, { value: 'eas', label: 'EAS' }, { value: 'tas', label: 'TAS' }, { value: 'mach', label: 'Mach' }];

export function airspeedTab({ keep = o => o } = {}) {
  const S = keep({ H: 35000 * FT, dT: 0, kind: 'cas', v: 250 * KT, mach: 0.8, schedCas: 290 * KT, schedMach: 0.78 });
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });
  let valS;

  function buildControls() {
    const secA = section('Flight condition');
    const altS = slider({ label: 'Pressure altitude', min: 0, max: Math.round(toDisp('alt', 25000)), step: units() === 'us' ? 100 : 50, value: toDisp('alt', S.H), format: v => `${num(+v, 0)} ${unit('alt').u}`, info: 'Standard-atmosphere height with this pressure (what the altimeter reads at 29.92 inHg / 1013 hPa). FL350 = 35,000 ft.', onInput: v => { S.H = fromDisp('alt', v); update(); } });
    const dTS = slider({ label: 'Temperature offset ΔT', min: -40, max: 40, step: 1, value: S.dT, format: v => (v > 0 ? '+' : '') + (+v).toFixed(0) + ' K', info: 'Changes the speed of sound and density, so TAS and EAS change for the same CAS; Mach stays tied to CAS (both come from pressures).', onInput: v => { S.dT = v; update(); } });
    secA.body.append(altS.el, dTS.el);
    const secV = section('Known speed');
    const kSeg = segmented(KINDS, S.kind, k => { const r = A.airspeeds(S.kind, S.kind === 'mach' ? S.mach : S.v, atmAt(S.H, S.dT)); S.kind = k; if (k === 'mach') S.mach = r.M; else S.v = r[k]; buildValue(); update(); });
    const valHost = h('div');
    const buildValue = () => {
      valS = S.kind === 'mach'
        ? slider({ label: 'Mach number', min: 0.05, max: 3.5, step: 0.005, value: S.mach, digits: 3, onInput: v => { S.mach = v; update(); } })
        : slider({ label: `${S.kind.toUpperCase()}`, min: 0, max: Math.round(toDisp('speed', 1100 * KT)), step: 1, value: toDisp('speed', S.v), format: v => `${num(+v, 0)} ${unit('speed').u}`, onInput: v => { S.v = fromDisp('speed', v); update(); } });
      valHost.replaceChildren(valS.el);
    };
    buildValue();
    secV.body.append(field('Speed type', kSeg.el, '<b>CAS</b> calibrated: what the airspeed indicator shows (corrected for instrument and position error).<br><b>EAS</b> equivalent: sets the dynamic pressure q = ½ρ₀EAS².<br><b>TAS</b> true: speed through the air.<br><b>Mach</b>: TAS ÷ local speed of sound.'), valHost);
    const secC = section('Climb schedule');
    const cS = slider({ label: 'Schedule CAS', min: Math.round(toDisp('speed', 150 * KT)), max: Math.round(toDisp('speed', 450 * KT)), step: 1, value: toDisp('speed', S.schedCas), format: v => `${num(+v, 0)} ${unit('speed').u}`, onInput: v => { S.schedCas = fromDisp('speed', v); update(); } });
    const mS = slider({ label: 'Schedule Mach', min: 0.4, max: 0.95, step: 0.01, value: S.schedMach, digits: 2, onInput: v => { S.schedMach = v; update(); } });
    secC.body.append(cS.el, mS.el, h('div', { class: 'hint' }, 'Airliners climb at a constant CAS, then switch to a constant Mach at the crossover altitude (e.g. 290 kt / M 0.78).'));
    controls.replaceChildren(secA.el, secV.el, secC.el);
  }

  const metrics = metricsGrid();
  const ladder = canvasBox('300px', drawLadder);
  const ladderCard = card('Speed ladder', 'Each step from one speed to the next removes one effect: CAS → EAS removes compressibility of the pitot reading, EAS → TAS removes density, TAS → Mach divides by the speed of sound.', ladder.el);
  const stepsCard = card('Step by step', 'The conversion with this condition\'s numbers.');
  const steps = h('div', { class: 'cf-steps' }); stepsCard.append(steps);
  const schedCard = card('Climb schedule: speeds vs altitude', 'TAS and Mach while holding the schedule CAS, then the schedule Mach above the crossover altitude.');
  const p1h = h('div', { class: 'flt-plot-tall' }); schedCard.append(p1h);
  const pl1 = new Plot(p1h, { legend: true });
  const insCard = card('What is happening here'); const ins = h('div'); insCard.append(ins);
  main.append(metrics.el, h('div', { class: 'flt-grid2' }, ladderCard, stepsCard), h('div', { class: 'flt-grid2' }, schedCard, insCard));

  let cur = null;
  function drawLadder(c, W, H) {
    if (!cur) return;
    const r = cur.r, vals = [['CAS', r.cas], ['EAS', r.eas], ['TAS', r.tas]];
    const maxV = Math.max(r.cas, r.tas, r.eas, 1) * 1.12;
    const pl = 60, pr = 20, pt = 30, pb = 34, iw = W - pl - pr, ih = H - pt - pb;
    const colW = Math.min(90, iw / 6), gap = (iw - 4 * colW) / 3;
    const y = v => pt + ih * (1 - v / maxV);
    const t2 = cssVar('--text-2'), t3 = cssVar('--text-3'), acc = cssVar('--accent');
    c.font = '10.5px ' + cssVar('--mono'); c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillStyle = t3; c.strokeStyle = cssVar('--border'); c.lineWidth = 1;
    const tick = maxV * toDisp('speed', 1) > 400 ? 100 : 50;
    for (let d = 0; fromDisp('speed', d) <= maxV; d += tick) { const Y = y(fromDisp('speed', d)); c.beginPath(); c.moveTo(pl, Y); c.lineTo(pl + iw, Y); c.stroke(); c.fillText(d, pl - 6, Y); }
    c.save(); c.translate(14, pt + ih / 2); c.rotate(-Math.PI / 2); c.textAlign = 'center'; c.fillStyle = t2; c.font = '11px ' + cssVar('--font'); c.fillText(`Speed (${unit('speed').u})`, 0, 0); c.restore();
    const cols = [...vals.map(([k, v], i) => ({ k, v, x: pl + i * (colW + gap), color: [cssVar('--good'), cssVar('--lower'), acc][i] }))];
    for (const o of cols) {
      c.fillStyle = o.color; c.globalAlpha = 0.85; c.fillRect(o.x, y(o.v), colW, pt + ih - y(o.v)); c.globalAlpha = 1;
      c.fillStyle = cssVar('--text'); c.font = '600 12px ' + cssVar('--font'); c.textAlign = 'center'; c.textBaseline = 'bottom';
      c.fillText(`${num(toDisp('speed', o.v), 1)}`, o.x + colW / 2, y(o.v) - 4);
      c.fillStyle = t2; c.textBaseline = 'top'; c.fillText(o.k, o.x + colW / 2, pt + ih + 6);
    }
    // Mach column: a gauge with the sonic line
    const mx = pl + 3 * (colW + gap), mMax = Math.max(1.2, r.M * 1.15), my = m => pt + ih * (1 - m / mMax);
    c.fillStyle = cssVar('--bg-sunk'); c.fillRect(mx, pt, colW, ih);
    c.fillStyle = r.M >= 1 ? cssVar('--bad') : cssVar('--warn'); c.globalAlpha = 0.85; c.fillRect(mx, my(r.M), colW, pt + ih - my(r.M)); c.globalAlpha = 1;
    c.strokeStyle = cssVar('--text'); c.setLineDash([4, 3]); c.beginPath(); c.moveTo(mx - 4, my(1)); c.lineTo(mx + colW + 4, my(1)); c.stroke(); c.setLineDash([]);
    c.fillStyle = t2; c.font = '10.5px ' + cssVar('--font'); c.textAlign = 'right'; c.textBaseline = 'bottom'; c.fillText('M = 1', mx + colW - 3, my(1) - 2);
    c.fillStyle = cssVar('--text'); c.font = '600 12px ' + cssVar('--font'); c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillText(r.M.toFixed(3), mx + colW / 2, my(r.M) - 4);
    c.fillStyle = t2; c.textBaseline = 'top'; c.fillText('Mach', mx + colW / 2, pt + ih + 6);
    // arrows between columns, labelled with the effect
    const arrow = (x0, x1, Y, text) => {
      c.strokeStyle = t3; c.fillStyle = t3; c.lineWidth = 1.2; c.beginPath(); c.moveTo(x0 + 6, Y); c.lineTo(x1 - 6, Y); c.stroke();
      c.beginPath(); c.moveTo(x1 - 6, Y); c.lineTo(x1 - 12, Y - 4); c.lineTo(x1 - 12, Y + 4); c.fill();
      c.font = '10.5px ' + cssVar('--font'); c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillStyle = t2;
      text.forEach((t, i) => c.fillText(t, (x0 + x1) / 2, Y - 4 - (text.length - 1 - i) * 13));
    };
    const top = pt + 12;
    arrow(cols[0].x + colW, cols[1].x, top, ['compressibility', `${r.cas - r.eas >= 0 ? '−' : '+'}${num(Math.abs(toDisp('speed', r.cas - r.eas)), 1)}`]);
    arrow(cols[1].x + colW, cols[2].x, top, ['÷ √σ (density)', `σ = ${cur.atm.sigma.toFixed(4)}`]);
    arrow(cols[2].x + colW, mx, top, ['÷ a (sound)', `a = ${num(toDisp('speed', cur.atm.a), 1)}`]);
  }

  function update() {
    const atm = atmAt(S.H, S.dT);
    const r = A.airspeeds(S.kind, S.kind === 'mach' ? S.mach : S.v, atm);
    cur = { atm, r };
    metrics.set([
      { k: 'CAS', v: show('speed', r.cas), s: 'what the ASI reads' },
      { k: 'EAS', v: show('speed', r.eas), s: 'sets the loads' },
      { k: 'TAS', v: show('speed', r.tas), s: units() === 'us' ? `${(r.tas * 3.6 / 1.609344).toFixed(0)} mph` : `${(r.tas * 3.6).toFixed(0)} km/h` },
      { k: 'Mach', v: r.M.toFixed(3), s: r.M < 0.8 ? 'subsonic' : r.M < 1.2 ? 'transonic' : r.M < 5 ? 'supersonic' : 'hypersonic', cls: r.M >= 1 ? 'bad' : '' },
      { k: 'Dynamic pressure q', v: show('q', r.q), s: '½ρV²', tip: 'q = ½ρV² = ½ρ₀EAS². Aerodynamic forces scale with q.' },
      { k: 'Impact pressure qc', v: show('q', r.qc), s: 'p₀ − p (pitot − static)', tip: 'What the pitot tube actually measures. Larger than q at high speed because the air is compressed as it is brought to rest.' },
      { k: 'Total temperature', v: `${r.T0.toFixed(1)} K`, s: `ram rise +${(r.T0 - atm.T).toFixed(1)} K`, tip: 'T₀ = T(1 + 0.2M²): the temperature the air reaches when stopped. Skin and probe temperatures approach this.' },
      { k: 'Reynolds number', v: num(toDisp('re1', r.Re1), 0), s: `per ${units() === 'us' ? 'ft' : 'm'} of length` },
    ]);
    ladder.paint(); stepsText(atm, r); schedule(); insights(atm, r);
  }

  function stepsText(atm, r) {
    const sp = v => `${num(toDisp('speed', v), 2)} ${unit('speed').u}`;
    const kPa = v => (v / 1000).toFixed(3) + ' kPa';
    const lines = [
      `<span class="c">// atmosphere at pressure altitude ${show('alt', S.H)}${S.dT ? `, ISA${S.dT > 0 ? '+' : ''}${S.dT}` : ''}</span>`,
      `p = ${kPa(atm.p)}   T = ${atm.T.toFixed(2)} K   ρ = ${atm.rho.toFixed(5)} kg/m³   a = √(γRT) = ${sp(atm.a)}`,
      `σ = ρ/ρ₀ = ${atm.sigma.toFixed(5)}`,
      '',
      `<span class="c">// impact pressure from Mach (${r.M <= 1 ? 'isentropic, M ≤ 1' : 'normal shock ahead of the pitot, M > 1'})</span>`,
      r.M <= 1 ? `qc = p[(1 + 0.2M²)^3.5 − 1] = ${kPa(r.qc)}` : `qc = p{[1.2M²]^3.5 · [6/(7M² − 1)]^2.5 − 1} = ${kPa(r.qc)}`,
      '',
      '<span class="c">// CAS: the speed giving this qc at sea level (p₀ = 101.325 kPa, a₀ = 340.29 m/s)</span>',
      `CAS = a₀√{5[(qc/p₀ + 1)^(2/7) − 1]} = ${sp(r.cas)}${r.cas > A.SEA.a ? '  (supersonic form used)' : ''}`,
      `EAS = TAS·√σ = ${sp(r.eas)}`,
      `TAS = M·a = ${sp(r.tas)}`,
      `q = ½ρ₀·EAS² = ${kPa(r.q)}`,
    ];
    steps.innerHTML = lines.join('\n');
  }

  function schedule() {
    const hMax = 15500, n = 160, zs = [], tasC = [], tasS = [], mC = [], mS = [];
    let cross = null;
    for (let i = 0; i <= n; i++) {
      const z = hMax * i / n, atm = atmAt(z, S.dT);
      const c = A.airspeeds('cas', S.schedCas, atm), m = A.airspeeds('mach', S.schedMach, atm);
      zs.push(altAxis.k(z)); tasC.push(toDisp('speed', c.tas)); mC.push(c.M);
      const use = c.M < S.schedMach ? c : m;
      tasS.push(toDisp('speed', use.tas)); mS.push(use.M);
      if (cross === null && c.M >= S.schedMach) cross = z;
    }
    const scale = Math.max(...tasC) / 1.2;
    pl1.setOpts({ xlabel: `TAS (${unit('speed').u})  ·  Mach × ${num(scale, 0)}`, ylabel: 'Pressure ' + altAxis.label().toLowerCase(), xname: 'value', yname: 'alt', xfmt: v => num(v, 1), yfmt: altAxis.fmt });
    pl1.setData({
      series: [
        { x: tasC, y: zs, color: cssVar('--text-3'), dash: [4, 4], label: `TAS at ${show('speed', S.schedCas, 0)} CAS`, width: 1.3 },
        { x: tasS, y: zs, color: cssVar('--accent'), label: 'TAS on schedule', width: 2.4 },
        { x: mS.map(v => v * scale), y: zs, color: cssVar('--lower'), label: 'Mach on schedule (scaled)', width: 2 },
      ],
      hlines: [
        ...(cross !== null ? [{ y: altAxis.k(cross), color: cssVar('--warn'), label: `crossover ${show('alt', cross)}` }] : []),
        { y: altAxis.k(S.H), color: cssVar('--text-3'), dash: [2, 3], bound: false },
      ],
    });
    S.cross = cross;
  }

  function insights(atm, r) {
    const L = [];
    const pct = (r.tas / r.cas - 1) * 100;
    L.push({ type: 'i', t: `TAS is ${pct >= 0 ? pct.toFixed(0) + '% higher' : (-pct).toFixed(0) + '% lower'} than CAS here`, d: 'The airspeed indicator measures pressure, not speed. Thin air at altitude gives less pressure for the same true speed, so the indicator under-reads. Rule of thumb: TAS ≈ CAS + 2% per 1,000 ft.' });
    if (r.cas - r.eas > 1) L.push({ type: 'i', t: `Compressibility: CAS is ${show('speed', r.cas - r.eas)} above EAS`, d: 'At high speed the air piles up in the pitot tube and reads a higher pressure than ½ρV². The ASI is calibrated for that at sea level only, so at altitude CAS over-states EAS.' });
    if (S.cross !== null) L.push({ type: 'i', t: `Crossover altitude ${show('alt', S.cross)}`, d: `Climbing at constant ${show('speed', S.schedCas, 0)} CAS, Mach rises (the air cools and thins) until it reaches M ${S.schedMach.toFixed(2)}. Above that the pilot holds Mach instead, and CAS falls. Higher Mach or lower CAS → higher crossover. CAS and Mach both come from pressures, so the crossover pressure altitude does not change on a hot or cold day.` });
    if (r.M > 0.75 && r.M < 1.2) L.push({ type: 'w', t: 'Transonic', d: 'Above about M 0.75 local supersonic regions and shocks form on a typical wing, raising drag sharply (drag divergence). Airliners cruise at M 0.78–0.85 with swept, supercritical wings.' });
    if (r.M >= 1) L.push({ type: 'b', t: 'Supersonic: a shock stands ahead of the pitot', d: 'The pitot tube now reads the pressure behind a normal shock, so the Rayleigh pitot formula replaces the isentropic one. Many air-data systems switch to Mach from this formula above M 1.' });
    if (r.T0 - atm.T > 50) L.push({ type: 'w', t: `Ram heating: +${(r.T0 - atm.T).toFixed(0)} K`, d: 'The air stopped on the nose and leading edges heats up. Concorde\'s nose reached about 127 °C at M 2; the SR-71\'s skin needed titanium.' });
    insightsList(ins, L);
  }

  buildControls();
  const off = onUnits(() => { buildControls(); update(); });
  update();
  return { controls, main, show: () => { ladder.paint(); pl1.draw(); }, destroy: () => off() };
}
