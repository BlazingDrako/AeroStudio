// Nozzles & plumes: quasi-1D nozzle flow for several contours, back-pressure regimes, normal shock
// inside the nozzle, the exhaust plume (wave lattice → Mach diamonds), thrust and Isp.
import { atmosphere } from '../../solvers/atmosphere.js';
import { h, section, slider, segmented, toggle, select, field, info } from '../../lib/ui.js';
import { Plot } from '../../lib/plot.js';
import { FieldStage, poly, line, label, body } from './field.js';
import { gasPicker, metricsGrid, insightsList, card, stageLayers, fmt } from './common.js';
import * as G from '../../solvers/gasdyn.js';

const { isen, DEG } = G;
const REG = {
  noflow: ['No flow', '--text-3'], subsonic: ['Subsonic (not choked)', '--lam'], choked: ['Just choked', '--accent'],
  shock: ['Normal shock inside', '--bad'], over: ['Over-expanded', '--warn'], design: ['Design (ideally expanded)', '--good'], under: ['Under-expanded', '--turb'],
};
export function isaPressure(hm) { return atmosphere(hm).p; }

export function nozzleTab({ keep = o => o } = {}) {
  const S = keep({ type: 'conical', eps: 4, half: 15, nChar: 14, g: 1.4, R: 287.05, gas: 'air', pb: 0.4, p0: 1000, T0: 300, At: 10, contraction: 3 });
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });

  // ---------- controls ----------
  const secN = section('Nozzle');
  const typeSel = select([
    { value: 'converging', label: 'Converging only' }, { value: 'conical', label: 'Conical C-D (cone)' },
    { value: 'bell', label: 'Bell — Rao 80% parabolic' }, { value: 'moc', label: 'Minimum-length (method of characteristics, 2-D)' },
  ], S.type, v => { S.type = v; sync(); update(); });
  const epsS = slider({ label: 'Area ratio Ae/At', min: 1.05, max: 100, log: true, value: S.eps, format: v => (+v).toFixed(2), info: 'Exit area / throat area. Sets the design exit Mach number. Rockets: 10–80 (vacuum stages 100+). Wind tunnels: 1.7 (M=2) to 25 (M=5).', onInput: v => { S.eps = v; update(); } });
  const meHint = h('div', { class: 'hint' });
  const halfS = slider({ label: 'Cone half-angle', min: 5, max: 30, step: 0.5, value: S.half, format: v => (+v).toFixed(1) + '°', info: 'Wider cones are shorter and lighter but lose thrust because the exhaust leaves at an angle: λ = (1 + cos α)/2.', onInput: v => { S.half = v; update(); } });
  const ncS = slider({ label: 'Characteristics', min: 4, max: 40, step: 1, value: S.nChar, digits: 0, info: 'Number of Mach waves in the corner expansion fan. More = smoother wall, more accurate area ratio.', onInput: v => { S.nChar = Math.round(v); update(); } });
  secN.body.append(field('Type', typeSel), epsS.el, meHint, halfS.el, ncS.el);

  const secO = section('Operating point');
  const pbS = slider({ label: 'Back pressure pb/p₀', min: 0.001, max: 1, log: true, value: S.pb, format: v => (+v).toFixed(4), info: 'Ambient (back) pressure divided by chamber stagnation pressure. Drag it down to walk through every regime: subsonic → choked → shock in nozzle → over-expanded → design → under-expanded.', onInput: v => { S.pb = v; altFromPb(); update(); } });
  const jump = h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '4px', marginBottom: '10px' } });
  const jb = (txt, tip, fn) => { const b = h('button', { class: 'btn sm', title: tip }, txt); b.addEventListener('click', fn); jump.append(b); return b; };
  const bump = (v) => { S.pb = Math.min(0.999, Math.max(0.0011, v)); pbS.set(S.pb); altFromPb(); update(); };
  jb('1st crit.', 'Just choked: sonic throat, subsonic exit', () => bump(last.crit.p1 * 0.9999));
  jb('Shock', 'A normal shock halfway down the divergent section', () => bump(0.5 * (last.crit.p1 + last.crit.p2)));
  jb('2nd crit.', 'Normal shock sitting at the exit plane', () => bump(last.crit.p2 * 0.999));
  jb('Over', 'Over-expanded: oblique shocks at the lip', () => bump(Math.min(Math.sqrt(last.crit.p2 * last.crit.p3), 1.8 * last.crit.p3)));
  jb('Design', 'Exit pressure = back pressure', () => bump(last.crit.p3));
  jb('Under', 'Under-expanded: expansion fans at the lip', () => bump(last.crit.p3 / 3));
  const altS = slider({ label: 'or set by altitude', min: 0, max: 80, step: 0.1, value: 0, format: v => (+v).toFixed(1) + ' km', info: 'Sets pb from the standard atmosphere at this altitude, using the chamber pressure below.', onInput: v => { S.pb = Math.min(0.999, Math.max(0.001, isaPressure(v * 1000) / 1000 / S.p0)); pbS.set(S.pb); update(); } });
  const altFromPb = () => { const pa = S.pb * S.p0 * 1000; let lo = 0, hi = 80000; for (let i = 0; i < 50; i++) { const m = 0.5 * (lo + hi); if (isaPressure(m) > pa) lo = m; else hi = m; } altS.set(pa > 101325 ? 0 : 0.5 * (lo + hi) / 1000); };
  const pbHint = h('div', { class: 'hint' });
  secO.body.append(pbS.el, jump, altS.el, pbHint);

  const secC = section('Chamber & gas');
  const p0S = slider({ label: 'Chamber pressure p₀', min: 10, max: 30000, log: true, value: S.p0, format: v => (+v).toFixed(0) + ' kPa', onInput: v => { S.p0 = v; altFromPb(); update(); } });
  const T0S = slider({ label: 'Chamber temperature T₀', min: 100, max: 4000, step: 1, value: S.T0, format: v => (+v).toFixed(0) + ' K', onInput: v => { S.T0 = v; update(); } });
  const AtS = slider({ label: 'Throat area At', min: 0.1, max: 10000, log: true, value: S.At, format: v => (+v).toFixed(2) + ' cm²', onInput: v => { S.At = v; update(); } });
  secC.body.append(gasPicker(S, () => update()), p0S.el, T0S.el, AtS.el,
    h('div', { class: 'hint' }, 'Presets: cold-air tunnel ≈ air, 300 K. Rocket ≈ "Rocket exhaust", 3000–3500 K, 5–20 MPa.'));
  const preset = select([{ value: '', label: 'Load a preset…' }, { value: 'tunnel', label: 'Supersonic wind tunnel (M≈2.5, air)' }, { value: 'rocket', label: 'Sea-level rocket (ε=16, bell)' }, { value: 'vac', label: 'Upper-stage vacuum nozzle (ε=80)' }, { value: 'shock', label: 'Shock in a C-D nozzle (ε=2)' }, { value: 'f1', label: 'Mach diamonds: under-expanded jet' }, { value: 'f2', label: 'Mach diamonds: over-expanded jet' }], '', v => {
    const P = { tunnel: { type: 'conical', eps: 2.64, gas: 'air', g: 1.4, R: 287.05, p0: 600, T0: 300, pb: 0.06 }, rocket: { type: 'bell', eps: 16, gas: 'comb', g: 1.22, R: 330, p0: 7000, T0: 3400, pb: 101.325 / 7000 }, vac: { type: 'bell', eps: 80, gas: 'comb', g: 1.22, R: 330, p0: 5000, T0: 3400, pb: 0.0012 }, shock: { type: 'conical', eps: 2, gas: 'air', g: 1.4, R: 287.05, p0: 300, T0: 300, pb: 0.7 }, f1: { type: 'bell', eps: 3, gas: 'comb', g: 1.22, R: 330, p0: 3000, T0: 3200, pb: 0.036 }, f2: { type: 'conical', eps: 2.2, half: 12, gas: 'air', g: 1.4, R: 287.05, p0: 800, T0: 900, pb: 0.115 } }[v];
    if (P) { Object.assign(S, P); sync(); update(); }
    preset.value = '';
  });
  secC.body.prepend(field('Examples', preset));
  controls.append(secN.el, secO.el, secC.el);

  // ---------- main ----------
  const badge = h('span', { class: 'regime' });
  const metrics = metricsGrid();
  const stageWrap = h('div');
  const stage = new FieldStage(stageWrap, { height: 'max(380px, 46vh)' });
  stageLayers(stage, { quantities: ['M', 'p', 'T', 'schlieren', 'glow'] });
  const regBar = h('div', { class: 'cf-regbar' });
  const pCard = card('Pressure along the nozzle', 'p/p₀ vs x. Grey curves show the classic family: subsonic, choked, shock-in-nozzle and design. The bold curve is your operating point; the dashed line is the back pressure.');
  const pPlot = new Plot(pCard, { xlabel: 'x / throat radius', ylabel: 'p / p₀', xname: 'x', yname: 'p/p₀', xfmt: v => v.toFixed(2), yfmt: v => v.toFixed(4), legend: false });
  const mCard = card('Mach number along the nozzle', 'Quasi-1D Mach number. Jumps down at a normal shock.');
  const mPlot = new Plot(mCard, { xlabel: 'x / throat radius', ylabel: 'M', xname: 'x', yname: 'M', xfmt: v => v.toFixed(2), yfmt: v => v.toFixed(3), legend: false });
  const cfCard = card('Thrust coefficient vs back pressure', 'CF = F/(p₀At) for this nozzle (solid) and for an ideal nozzle that always expands exactly to pb (dashed). They touch at the design point; the gap elsewhere is the cost of a fixed nozzle — why altitude-compensating nozzles exist.');
  const cfPlot = new Plot(cfCard, { xlabel: 'pb / p₀ (log₁₀)', ylabel: 'CF', xname: 'log pb/p₀', yname: 'CF', xfmt: v => (10 ** v).toPrecision(3), yfmt: v => v.toFixed(4) });
  const insEl = h('div');
  const insCard = h('div', { class: 'plot-card' }, h('div', { class: 'plot-head' }, h('h4', {}, 'What you\'re seeing')), insEl);
  const resCard = card('Results', 'Exit state and performance from quasi-1D theory, with the divergence factor λ applied to the momentum thrust.');
  const resEl = h('div', { class: 'cf-res' }); resCard.append(resEl);
  main.append(h('div', { class: 'row', style: { flexWrap: 'wrap' } }, badge, h('div', { class: 'hint', style: { margin: 0 } }, 'Drag the back-pressure slider or use the regime buttons.')), metrics.el, stageWrap, regBar,
    h('div', { class: 'plots' }, pCard, mCard), h('div', { class: 'cf-grid2' }, resCard, insCard), cfCard);

  let last = null;
  function sync() {
    typeSel.value = S.type; epsS.set(S.eps); halfS.set(S.half); pbS.set(S.pb); p0S.set(S.p0); T0S.set(S.T0); altFromPb();
    const conv = S.type === 'converging';
    epsS.el.style.display = conv ? 'none' : ''; meHint.style.display = conv ? 'none' : '';
    halfS.el.style.display = S.type === 'conical' ? '' : 'none'; ncS.el.style.display = S.type === 'moc' ? '' : 'none';
    for (const b of jump.children) b.style.display = conv && !/1st|Under/.test(b.textContent) ? 'none' : '';
  }

  function update() {
    const g = S.g, eps = S.type === 'converging' ? 1 : S.eps;
    const geo = G.nozzleGeometry({ type: S.type, eps, halfAngleDeg: S.half, g, nChar: S.nChar, contraction: S.contraction });
    const flow = G.nozzleFlow(geo, g, S.pb);
    last = flow;
    const lam = geo.info.lambda ?? 1;
    const th = G.thrust(flow, g, { p0: S.p0 * 1000, T0: S.T0, At: S.At * 1e-4, R: S.R, pa: S.pb * S.p0 * 1000, lambda: lam });
    meHint.textContent = `Design exit Mach ${flow.crit.Msup.toFixed(3)} · design pe/p₀ = ${flow.crit.p3.toFixed(5)}` + (geo.info.type === 'moc' ? ` · MOC area ratio ${geo.info.moc.AeAt.toFixed(3)} vs exact ${geo.info.moc.AeAtExact.toFixed(3)}` : '') + (geo.info.type === 'bell' ? ` · θn ${(geo.info.thetaN / DEG).toFixed(1)}°, θe ${(geo.info.thetaE / DEG).toFixed(1)}° (approx. Rao charts)` : '');
    pbHint.textContent = `pb = ${(S.pb * S.p0).toFixed(2)} kPa · critical ratios: 1st ${flow.crit.p1.toFixed(4)}, 2nd ${flow.crit.p2.toFixed(4)}, 3rd (design) ${flow.crit.p3.toFixed(5)}`;
    const [rn, rc] = REG[flow.regime];
    badge.replaceChildren(h('span', { class: 'dot', style: { background: `var(${rc})` } }), rn);
    const peb = flow.pe / S.pb;
    metrics.set([
      { k: 'Exit Mach', v: fmt(flow.Me, 3) }, { k: 'pe / pb', v: fmt(peb, 3), s: peb > 1.005 ? 'under-expanded' : peb < 0.995 ? 'over-expanded' : 'matched' },
      { k: 'Mass flow', v: th.mdot >= 1 ? th.mdot.toFixed(2) + ' kg/s' : (th.mdot * 1000).toFixed(1) + ' g/s', s: flow.choked ? 'choked' : 'not choked' },
      { k: 'Thrust', v: Math.abs(th.F) >= 1e4 ? (th.F / 1000).toFixed(1) + ' kN' : th.F.toFixed(1) + ' N' },
      { k: 'CF', v: fmt(th.CF, 4) }, { k: 'Isp', v: th.Isp.toFixed(1) + ' s' }, { k: 'Exit velocity', v: th.Ve.toFixed(0) + ' m/s' },
    ]);
    // ---- regime bar (log scale) ----
    paintRegBar(flow);
    // ---- plots ----
    const fam = [];
    const pv = []; const c = flow.crit;
    if (!flow.conv) {
      for (const k of [0.35, 0.7]) pv.push(c.p1 + (1 - c.p1) * k);
      pv.push(c.p1 * 0.99999);
      for (const k of [0.25, 0.5, 0.75]) pv.push(c.p2 + (c.p1 - c.p2) * k);
      pv.push(c.p2 * 0.9999, c.p3 * 0.5);
    } else pv.push(0.7, 0.9, c.p1 * 0.9999);
    const css = getComputedStyle(document.documentElement), col = v => css.getPropertyValue(v).trim();
    for (const p of pv) { const f = G.nozzleFlow(geo, g, p); fam.push({ x: f.prof.x, y: f.prof.p, color: col('--text-3'), width: 1, alpha: 0.5, noHover: true }); }
    const P = flow.prof;
    pPlot.setData({ series: [...fam, { x: P.x, y: P.p, color: col(rc), width: 2.6, label: 'p/p₀' }],
      hlines: [{ y: S.pb, color: col('--text-2'), label: 'pb/p₀ = ' + S.pb.toFixed(4) }], vlines: [{ x: 0, color: col('--border-strong') }] });
    pPlot.setOpts({ ylim: [0, 1.04] });
    mPlot.setData({ series: [{ x: P.x, y: P.M, color: col(rc), width: 2.4, label: 'M' }], hlines: [{ y: 1, color: col('--text-3'), label: 'M = 1' }], vlines: [{ x: 0, color: col('--border-strong') }] });
    // CF vs pb
    const xs = [], cfa = [], cfo = [];
    for (let i = 0; i <= 120; i++) {
      const lp = -3.3 + 3.3 * i / 120, pb = 10 ** lp;
      if (pb >= 0.999) continue;
      const f = G.nozzleFlow(geo, g, pb), t = G.thrust(f, g, { p0: 1, T0: 1, At: 1, R: 1, pa: pb, lambda: lam });
      xs.push(lp); cfa.push(t.CF);
      const Mo = G.M_from_p(pb, g), cfOpt = pb < 1 / isen.p0_p(1, g) ? isen.mfp(1, g) * Mo * Math.sqrt(g / isen.T0_T(Mo, g)) : NaN;
      cfo.push(cfOpt);
    }
    cfPlot.setData({ series: [{ x: xs, y: cfa, color: col('--accent'), label: 'this nozzle' }, { x: xs, y: cfo, color: col('--good'), dash: [5, 4], label: 'ideal (pe = pb)' },
      { x: [Math.log10(S.pb)], y: [th.CF], color: col(rc), points: true, pointSize: 5, line: false, label: 'operating point' }] });
    // ---- results ----
    const r = [];
    const add = (k, v, hl) => r.push(h('div', { class: 'r' + (hl ? ' hl' : '') }, h('span', {}, k), h('span', {}, v)));
    add('Regime', rn, true); add('Exit Mach Me', fmt(flow.Me)); add('Exit pressure pe', (flow.pe * S.p0).toFixed(3) + ' kPa'); add('pe / p₀', fmt(flow.pe, 5));
    add('Exit temperature Te', th.Te.toFixed(1) + ' K'); add('Exit velocity Ve', th.Ve.toFixed(1) + ' m/s'); add('Mass flow ṁ', th.mdot.toFixed(4) + ' kg/s');
    add('Exit area Ae', (th.Ae * 1e4).toFixed(2) + ' cm²'); add('Thrust F', th.F.toFixed(1) + ' N', true); add('Thrust coefficient CF', fmt(th.CF)); add('Specific impulse Isp', th.Isp.toFixed(1) + ' s');
    add('c* (characteristic vel.)', th.cstar.toFixed(1) + ' m/s'); add('Divergence factor λ', fmt(lam));
    if (flow.shock) { add('Shock: upstream M₁', fmt(flow.shock.M1), true); add('Shock: downstream M₂', fmt(flow.shock.M2)); add('Shock at A/At', fmt(flow.shock.A_At)); add('Shock at x / L', fmt(flow.shock.x / geo.xe, 3)); add('p₀₂/p₀₁ across shock', fmt(flow.shock.p02_p01)); }
    if (geo.info.length) add('Divergent length / Rt', fmt(geo.info.length, 2));
    resEl.replaceChildren(...r);
    // ---- plume ----
    let jet = null, md = null;
    const sup = ['over', 'design', 'under'].includes(flow.regime) || (flow.conv && flow.regime === 'under');
    if (sup && Math.abs(peb - 1) > 0.002) jet = G.jetPlume(flow.Me, peb, g, { nFan: 9, xmax: 160 });
    const ins = [];
    const Re = geo.rs[geo.rs.length - 1];
    if (jet && jet.ok) {
      if (peb < 1) {
        const bS = G.betaFromPressure(flow.Me, 1 / peb, g);
        const os = isFinite(bS) ? G.obliqueShock(flow.Me, bS, g) : null;
        if (!os || os.theta > G.thetaMax(os.M2, g)) md = { x: geo.xe + (jet.firstAxis ? jet.firstAxis.x : 1) * Re, h: 0.35 * Re, why: 'Mach reflection: the lip shock is too strong to reflect regularly at the axis' };
      } else if (peb > 2) {
        const xm = 0.67 * 2 * Math.sqrt(1 / S.pb);
        md = { x: geo.xe + xm, h: Math.min(0.8, 0.12 * Math.sqrt(peb)) * Re * 1.4, why: 'Strongly under-expanded: Mach disk at x/D* ≈ 0.67√(p₀/pa) (Ashkenas–Sherman)' };
      }
    }
    // ---- insights ----
    const regimeText = {
      noflow: 'Back pressure equals chamber pressure: nothing flows.',
      subsonic: `Back pressure is above the 1st critical (${c.p1.toFixed(4)}). The nozzle is a venturi: flow speeds up to the throat, then slows again. Mass flow still depends on pb.`,
      choked: 'The throat has just reached M = 1. From here down, lowering pb cannot increase the mass flow — the nozzle is choked.',
      shock: `pb is between the 2nd (${c.p2.toFixed(4)}) and 1st (${c.p1.toFixed(4)}) critical pressures. The flow goes supersonic after the throat, then a normal shock (M₁ = ${flow.shock?.M1.toFixed(3)}) brings it back to subsonic so it can recover to pb at the exit. Lower pb pushes the shock toward the exit.`,
      over: `Exit pressure (${flow.pe.toFixed(4)} p₀) is below ambient (${S.pb.toFixed(4)} p₀). Oblique shocks from the lip squeeze the jet, which then over-shoots — a train of shock cells forms.`,
      design: 'Exit pressure matches the back pressure: the jet leaves parallel and uniform with no waves. This is the most efficient operating point for this nozzle.',
      under: `Exit pressure (${flow.pe.toFixed(4)} p₀) is above ambient. Expansion fans at the lip let the jet bulge outward; they reflect from the free boundary as compressions, producing Mach diamonds. Typical of rockets at high altitude.`,
    };
    ins.push({ type: flow.regime === 'shock' ? 'b' : flow.regime === 'design' ? 'g' : 'i', t: rn, d: regimeText[flow.regime] });
    if (flow.regime === 'over' && peb < 0.4) ins.push({ type: 'w', t: 'Flow separation likely', d: `pe/pb = ${peb.toFixed(2)} < ~0.4 (Summerfield criterion). A real nozzle would separate from the wall inside the bell, with side loads. The ideal full-flowing solution is shown; the red marks show roughly where wall pressure falls below 0.4 pb.` });
    if (md) ins.push({ type: 'w', t: 'Mach disk', d: md.why + '. Drawn schematically; the cell pattern past it is the ideal wave model.' });
    if (jet && jet.ok && jet.crossed && peb > 1) ins.push({ type: 'i', t: 'Intercepting shock', d: 'Compression waves reflected from the jet boundary converge (same-family characteristics cross). In reality they merge into the barrel-shaped intercepting shock that bounds each cell.' });
    if (jet && jet.ok && isFinite(jet.cellLen)) ins.push({ type: 'i', t: `Shock-cell length ≈ ${(jet.cellLen * Re).toFixed(2)} Rt`, d: `= ${(jet.cellLen / 2).toFixed(2)} exit widths (planar wave model). Prandtl's round-jet estimate L ≈ 1.306·√(Mj²−1)·Dj gives ${(1.306 * Math.sqrt(Math.max(0, jet.Mb ** 2 - 1))).toFixed(2)} Dj, with Mj = ${jet.Mb.toFixed(2)} the fully-expanded jet Mach number.` });
    if (geo.info.type === 'moc') ins.push({ type: 'g', t: 'Method-of-characteristics contour', d: `The wall is built so every Mach wave from the sharp throat corner is cancelled when it reaches the wall: uniform, parallel exit flow in the shortest possible length. Maximum wall angle θw,max = ν(Me)/2 = ${(geo.info.moc.twmax / DEG).toFixed(2)}°. (Planar, so Ae/At = ye/yt.)` });
    if (geo.info.type === 'conical') ins.push({ type: 'i', t: `Divergence loss ${(100 * (1 - lam)).toFixed(2)}%`, d: `Gas leaves a ${S.half}° cone at up to ${S.half}° off-axis; only the axial momentum produces thrust (λ = (1+cos α)/2).` });
    if (geo.info.type === 'bell') ins.push({ type: 'i', t: 'Bell (thrust-optimized parabola)', d: 'Turns the flow quickly near the throat (θn) then gently straightens it (θe): 80% of a 15° cone\'s length with less divergence loss. Contour from Rao\'s parabolic approximation; angles interpolated from published charts.' });
    if (jet && jet.ok) ins.push({ type: 'i', t: 'Plume model', d: 'Planar wave-lattice (method of characteristics with finite waves): expansions split into several waves, compressions treated as single weak-shock waves, no mixing. Real round jets have shorter, faster-decaying cells.' });
    insightsList(insEl, ins);
    // ---- stage scene ----
    stage.setScene(makeScene(geo, flow, jet, md, Re, peb, g));
  }

  function paintRegBar(flow) {
    const c = flow.crit, lg = v => (Math.log10(Math.max(v, 1e-3)) + 3) / 3 * 100;
    const zone = (a, b, cls, txt, tip) => h('div', { class: 'z', title: tip, style: { left: lg(a) + '%', width: Math.max(0.6, lg(b) - lg(a)) + '%', background: `color-mix(in srgb, var(${cls}) 30%, transparent)`, borderColor: `var(${cls})` } }, h('span', {}, txt));
    const zs = flow.conv ? [zone(1e-3, c.pcrit, '--turb', 'Under-expanded', 'Choked, sonic exit, pe > pb'), zone(c.pcrit, 1, '--lam', 'Subsonic', 'Not choked')]
      : [zone(1e-3, c.p3, '--turb', 'Under', 'pe > pb'), zone(c.p3, c.p2, '--warn', 'Over-expanded', 'Oblique shocks outside'), zone(c.p2, c.p1, '--bad', 'Shock in nozzle', 'Normal shock in the divergent section'), zone(c.p1, 1, '--lam', 'Subsonic', 'Venturi, not choked')];
    regBar.replaceChildren(h('div', { class: 'track' }, ...zs, h('div', { class: 'mk', style: { left: lg(S.pb) + '%' } })),
      h('div', { class: 'ticks' }, ...['0.001', '0.01', '0.1', '1'].map((t, i) => h('span', { style: { left: (i / 3 * 100) + '%' } }, t)), h('span', { class: 'ttl' }, 'pb / p₀ (log)')));
  }

  function makeScene(geo, flow, jet, md, Re, peb, g) {
    const x0 = geo.xs[0], xe = geo.xe, Ln = xe - x0;
    const Rc = geo.rs[0], wallT = 0.18 * Math.max(1, Rc / 2);
    const cells = jet && jet.ok && isFinite(jet.cellLen) ? jet.cellLen * Re : 0;
    const plumeL = Math.max(1.4 * Ln, 7 * Re, 8, Math.min(2.15 * cells, 9 * Ln + 20));
    const Ymax = Math.max(Rc + wallT, Re * Math.max(1.9, (jet && jet.ok ? jet.ymax * 1.15 : 0)), 2);
    const b = { x0: x0 - 0.2, x1: xe + plumeL, y0: -Ymax, y1: Ymax };
    const ref = flow.p0e;
    // plume polygons in world coordinates (scale by Re, shift by xe), both halves
    const polys = [];
    if (jet && jet.ok) {
      for (const P of jet.polys) {
        const pts = P.pts.map(p => ({ x: xe + p.x * Re, y: p.y * Re }));
        const s = { M: P.s.M, th: P.s.theta, p: P.s.p * flow.p0e, T: P.s.T, rho: P.s.rho * flow.p0e, p0: flow.p0e };
        polys.push({ pts, s }, { pts: pts.map(p => ({ x: p.x, y: -p.y })), s: { ...s, th: -s.th } });
      }
    }
    const exitS = G.nozzleStateAt(flow, xe);
    const jetUniform = !jet || !jet.ok;
    const fill = (Gd) => {
      const { nx, ny } = Gd;
      // per-column cache: wall radius, slope and quasi-1D state
      const colR = new Float64Array(nx), colD = new Float64Array(nx), colS = new Array(nx);
      for (let i = 0; i < nx; i++) { const x = Gd.x0 + (i + 0.5) * Gd.dx; if (x <= xe && x >= x0) { colR[i] = G.radiusAt(geo, x); colD[i] = (G.radiusAt(geo, x + 0.01) - G.radiusAt(geo, x - 0.01)) / 0.02; colS[i] = G.nozzleStateAt(flow, x); } }
      for (let j = 0; j < ny; j++) {
        const y = Gd.y0 + (j + 0.5) * Gd.dy;
        for (let i = 0; i < nx; i++) {
          const x = Gd.x0 + (i + 0.5) * Gd.dx, k = j * nx + i;
          if (x <= xe) {
            const r = colR[i];
            if (x < x0 || Math.abs(y) > r) { Gd.set(k, { M: 0, th: 0, p: S.pb, T: 1, rho: 1, p0: 1, k: 2 }); continue; }
            const s = colS[i], dr = colD[i];
            Gd.set(k, { M: s.M, th: Math.atan(dr * y / r), p: s.p, T: s.T, rho: s.rho, p0: s.p0 });
          } else {
            if (jetUniform && flow.regime !== 'noflow' && Math.abs(y) < Re * (1 + 0.04 * (x - xe) / Re * (flow.Me < 1 ? 1 : 0.3))) Gd.set(k, { M: exitS.M, th: 0, p: exitS.p, T: exitS.T, rho: exitS.rho, p0: exitS.p0 });
            else Gd.set(k, { M: 0, th: 0, p: S.pb, T: 1, rho: 1, p0: 1, k: 2 });
          }
        }
      }
      // rasterize plume regions
      for (const P of polys) {
        let xa = Infinity, xb = -Infinity, ya = Infinity, yb = -Infinity;
        for (const p of P.pts) { xa = Math.min(xa, p.x); xb = Math.max(xb, p.x); ya = Math.min(ya, p.y); yb = Math.max(yb, p.y); }
        const i0 = Math.max(0, Math.floor((xa - Gd.x0) / Gd.dx)), i1 = Math.min(nx - 1, Math.ceil((xb - Gd.x0) / Gd.dx));
        const j0 = Math.max(0, Math.floor((yb - Gd.y0) / Gd.dy)), j1 = Math.min(ny - 1, Math.ceil((ya - Gd.y0) / Gd.dy));
        if (i1 < i0 || j1 < j0) continue;
        for (let j = j0; j <= j1; j++) { const y = Gd.y0 + (j + 0.5) * Gd.dy; for (let i = i0; i <= i1; i++) { const x = Gd.x0 + (i + 0.5) * Gd.dx; if (x > xe && inPoly(x, y, P.pts)) Gd.set(j * nx + i, P.s); } }
      }
      // Mach disk: subsonic patch behind it (schematic)
      if (md) {
        const ns = G.normalShock(Math.max(1.01, flow.Me * 1.4), g);
        for (let j = 0; j < ny; j++) { const y = Gd.y0 + (j + 0.5) * Gd.dy; if (Math.abs(y) > md.h) continue; for (let i = 0; i < nx; i++) { const x = Gd.x0 + (i + 0.5) * Gd.dx; if (x > md.x && x < md.x + 0.6 * md.h * (1 - (y / md.h) ** 2)) { const k = j * nx + i; Gd.M[k] = ns.M2; Gd.T[k] = Math.min(1, Gd.T[k] * ns.T2_T1); } } }
      }
    };
    // separation estimate (Summerfield)
    let xSep = null;
    if (flow.regime === 'over' && peb < 0.4) { const P = flow.prof; for (let i = 0; i < P.x.length; i++) if (P.x[i] > 0 && P.p[i] < 0.4 * S.pb) { xSep = P.x[i]; break; } }
    const wallPts = sgn => { const out = []; for (let i = 0; i < geo.xs.length; i++) out.push({ x: geo.xs[i], y: sgn * geo.rs[i] }); for (let i = geo.xs.length - 1; i >= 0; i--) out.push({ x: geo.xs[i], y: sgn * (geo.rs[i] + wallT) }); return out; };
    // glow color range from the exhaust only, so shock-heated diamonds stand out
    let tLo = exitS.T, tHi = exitS.T;
    for (const P of polys) { tLo = Math.min(tLo, P.s.T); tHi = Math.max(tHi, P.s.T); }
    if (tHi - tLo < 0.02) { tLo -= 0.05; tHi += 0.02; }
    const glowRange = [tLo - 0.35 * (tHi - tLo), tHi + 0.08 * (tHi - tLo)];
    return {
      bounds: b, fill, speed: 1.1, nParticles: 520, ranges: { glow: glowRange },
      refNames: { p: 'p/p₀', T: 'T/T₀', rho: 'ρ/ρ₀', p0: 'p₀ local/p₀' },
      qlabel: { M: 'Mach number', p: 'Pressure p/p₀', T: 'Temperature T/T₀', glow: 'Exhaust glow (T/T₀)' },
      spawn: init => {
        if (init && Math.random() < 0.8) { const x = x0 + Math.random() * (b.x1 - x0); const r = x <= xe ? G.radiusAt(geo, x) : Re * 1.3; return { x, y: (Math.random() * 2 - 1) * r * 0.97 }; }
        return { x: x0 + 0.05, y: (Math.random() * 2 - 1) * Rc * 0.96 };
      },
      readout: (x, y, s) => {
        if (!s || s.k !== 1) return null;
        return `M ${s.M.toFixed(3)}<br>p/p₀ ${s.p.toFixed(4)}<br>T/T₀ ${s.T.toFixed(4)}<br>T ${(s.T * S.T0).toFixed(0)} K · p ${(s.p * S.p0).toFixed(1)} kPa<br>V ${(s.M * Math.sqrt(S.g * S.R * s.T * S.T0)).toFixed(0)} m/s`;
      },
      draw: ctx => {
        const dark = ctx.dark || ctx.fieldOn;
        const wcol = ctx.css('--text-3'), wfill = ctx.css('--border-strong');
        if (ctx.layers.waves && jet && jet.ok) {
          for (const w of jet.waves) {
            const comp = w.sign < 0, glowQ = ctx.quantity === 'glow';
            const a = comp ? (glowQ ? 0.22 : 0.6) : (glowQ ? 0.07 : 0.2);
            const col = dark ? `rgba(255,255,255,${a})` : `rgba(20,24,33,${a})`;
            for (const sg of [1, -1]) {
              ctx.g.beginPath();
              w.pts.forEach((p, i) => { const X = ctx.T.sx(xe + p.x * Re), Y = ctx.T.sy(sg * p.y * Re); i ? ctx.g.lineTo(X, Y) : ctx.g.moveTo(X, Y); });
              ctx.g.strokeStyle = col; ctx.g.lineWidth = comp ? 1.2 : 0.7; ctx.g.stroke();
            }
          }
          for (const sg of [1, -1]) poly(ctx, jet.boundary.map(p => ({ x: xe + p.x * Re, y: sg * p.y * Re })), { stroke: dark ? 'rgba(255,255,255,0.75)' : 'rgba(20,24,33,0.6)', width: 1.3, close: false, dash: [6, 4] });
        }
        if (ctx.layers.waves && geo.info.type === 'moc' && flow.regime !== 'shock' && flow.regime !== 'subsonic') {
          const M = geo.info.moc, col = dark ? 'rgba(255,255,255,0.45)' : 'rgba(20,24,33,0.4)';
          for (let i = 0; i < M.n; i++) for (const sg of [1, -1]) { const pts = [{ x: 0, y: 1 }, ...M.P[i].filter(Boolean).slice(0, i + 1)]; poly(ctx, pts.map(p => ({ x: p.x, y: sg * p.y })), { stroke: col, width: 0.8, close: false }); }
          for (let j = 0; j < M.n; j++) for (const sg of [1, -1]) { const pts = []; for (let i = j; i < M.n; i++) pts.push(M.P[i][j]); pts.push(M.wall[j + 1]); poly(ctx, pts.map(p => ({ x: p.x, y: sg * p.y })), { stroke: col, width: 0.8, close: false }); }
        }
        if (flow.shock && isFinite(flow.shock.x) && ctx.layers.waves) {
          const r = G.radiusAt(geo, flow.shock.x);
          line(ctx, { x: flow.shock.x, y: -r }, { x: flow.shock.x, y: r }, dark ? '#fff' : '#111', 3);
        }
        if (md && ctx.layers.waves) { line(ctx, { x: md.x, y: -md.h }, { x: md.x, y: md.h }, dark ? '#fff' : '#111', 3); label(ctx, { x: md.x, y: md.h }, 'Mach disk', { dy: -12, align: 'center' }); }
        body(ctx, wallPts(1));
        body(ctx, wallPts(-1));
        // labels go on top of the walls, just outside the nozzle so they are never hidden
        if (flow.shock && isFinite(flow.shock.x) && ctx.layers.waves) {
          const r = G.radiusAt(geo, flow.shock.x);
          label(ctx, { x: flow.shock.x, y: r + wallT }, `normal shock  M ${flow.shock.M1.toFixed(2)} → ${flow.shock.M2.toFixed(2)}`, { dy: -14, align: 'center', base: 'bottom' });
          line(ctx, { x: flow.shock.x, y: r }, { x: flow.shock.x, y: r + wallT }, dark ? 'rgba(255,255,255,0.7)' : 'rgba(20,24,33,0.6)', 1, [2, 2]);
        }
        if (xSep !== null) { for (const sg of [1, -1]) { const r = G.radiusAt(geo, xSep); line(ctx, { x: xSep, y: sg * r }, { x: xSep + 0.25 * Re, y: sg * (r - 0.25 * Re) }, ctx.css('--bad'), 3); } label(ctx, { x: xSep, y: G.radiusAt(geo, xSep) }, 'separation (est.)', { color: ctx.css('--bad'), dy: -14, align: 'center' }); }
        label(ctx, { x: 0, y: -1 - wallT }, 'throat', { dy: 12, align: 'center', bg: false, color: ctx.css('--text-2') });
        label(ctx, { x: xe, y: -Re - wallT }, `exit M ${flow.Me.toFixed(2)}`, { dy: 12, align: 'center', bg: false, color: ctx.css('--text-2') });
        label(ctx, { x: x0 + 0.1, y: Rc + wallT }, `chamber p₀ ${S.p0.toFixed(0)} kPa`, { dy: -12, bg: false, color: ctx.css('--text-2') });
        label(ctx, { x: b.x1 - 0.2, y: b.y1 - 0.2 }, `ambient pb ${(S.pb * S.p0).toFixed(2)} kPa`, { align: 'right', base: 'top' });
      },
    };
  }
  sync(); update();
  return { controls, main, destroy: () => stage.destroy(), load: p => { Object.assign(S, p); sync(); update(); } };
}

function inPoly(x, y, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
