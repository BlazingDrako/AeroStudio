// Augmentation & fly-by-wire tab: wrap feedback round one control surface (elevator for pitch, rudder for yaw) and
// fly the result. Left and right, the same input flown without and with the computer (or, with a pilot in the loop,
// with and without the actuator rate limit). Time histories show the surface hitting its rate and position limits;
// the s-plane shows the roots migrating as the feedback is turned up; the handling-qualities chart grades the result;
// the Bode plot gives the margins with the loop broken at the actuator.
import { h, section, slider, segmented, toggle, select, field, cssVar, icon } from '../../lib/ui.js';
import * as St from '../../solvers/stability.js';
import * as Ct from '../../solvers/control.js';
import * as Au from '../../solvers/augment.js';
import { SEVERITY } from '../../solvers/atmosphere.js';
import { card, metricsGrid, insightsList, onUnits, num, canvasBox } from '../flight/common.js';
import { perf, aircraftSection, conditionSection, designSection, stabInput, axes, legend, setAircraft, changed } from '../flight/perfShared.js';
import { drawBode, drawSPlane, plane, topView, f3 } from './plots.js';

const DEG = 180 / Math.PI, D = Math.PI / 180;
const MODES = [{ value: 'direct', label: 'Dampers only' }, { value: 'rate', label: 'Pitch-rate command' }, { value: 'cstar', label: 'C* command' }];
const AMP = { direct: 2, rate: 5, cstar: 1, lat: 2 };
const UNIT = { direct: '° elevator', rate: '°/s', cstar: 'g', lat: '° rudder' };
const BASE = { wa: 20, rate: 60, pos: 25, fs: 64, delay: 20, turb: 'off', width: 1, pilotGain: 2, pilotTau: 0.25, kstick: 1, kff: 0, knz: 0, kb: 0 };
const SCENARIOS = [
  { value: '', label: 'Choose a scenario…' },
  { value: 'yd', label: 'Yaw damper: airliner in cruise', ac: 'a320', s: { axis: 'lat', kr: 1, wash: true, tw: 2, input: 'upset', T: 30, cat: 'B' } },
  { value: 'pd', label: 'Pitch damper: airliner in turbulence', ac: 'a320', s: { axis: 'lon', mode: 'direct', ka: 0, kq: 0.5, input: 'none', turb: 'moderate', T: 30, cat: 'B' } },
  { value: 'sas', label: 'Unstable fighter: α and q feedback', ac: 'f16', s: { axis: 'lon', mode: 'direct', ka: 0.5, kq: 0.2, input: 'upset', T: 10, cat: 'A' } },
  { value: 'cstar', label: 'Unstable fighter: C* fly-by-wire', ac: 'f16', s: { axis: 'lon', mode: 'cstar', ka: 0.35, kq: 0.15, kp: 0.5, ki: 1, input: 'step', T: 10, cat: 'A' } },
  { value: 'rate', label: 'Unstable fighter: pitch-rate command', ac: 'f16', s: { axis: 'lon', mode: 'rate', ka: 0.5, kq: 0.15, kp: 0.1, ki: 0.5, input: 'step', T: 10, cat: 'A' } },
  { value: 'delay', label: 'Fly-by-wire with 150 ms of delay', ac: 'f16', s: { axis: 'lon', mode: 'cstar', ka: 0.35, kq: 0.15, kp: 0.5, ki: 1, delay: 150, input: 'step', T: 10, cat: 'A' } },
  { value: 'pio', label: 'Pilot-induced oscillation: rate-limited tail', ac: 'f16', s: { axis: 'lon', mode: 'rate', ka: 0.5, kq: 0.15, kp: 0.1, ki: 0.5, kff: 0.3, input: 'pilot', rate: 10, T: 15, cat: 'A' } },
];

export function fbwTab({ keep = o => o } = {}) {
  const S = keep({ axis: 'lon', mode: 'cstar', ka: 0.35, kq: 0.15, kp: 0.5, ki: 1, kr: 1, wash: true, tw: 2, input: 'step', T: 10, cat: 'A', playing: true, ...BASE });
  S.amp = AMP.cstar;
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });
  let R = null, seen = -1;

  // ---------- controls ----------
  const scSec = section('Try a scenario');
  const scSel = select(SCENARIOS.map(({ value, label }) => ({ value, label })), '', v => applyScenario(v));
  scSec.body.append(scSel, h('div', { class: 'hint' }, 'Each sets the aircraft, the control law and the input to show one idea.'));
  const acSec = aircraftSection(src => { if (src === 'aircraft') { cond.rebuild(); des.rebuild(); } schedule(); });
  const cond = conditionSection(() => schedule());
  const des = designSection(() => schedule());
  const lawSec = section('Control law'), hwSec = section('Actuator and computer'), inSec = section('What to fly');
  controls.append(scSec.el, lawSec.el, inSec.el, hwSec.el, acSec.el, cond.el, des.el);

  const sl = (label, min, max, step, key, fmt, info, log) => slider({ label, min, max, step, log, value: S[key], format: fmt || (v => f3(+v)), info, onInput: v => { S[key] = v; schedule(); } }).el;
  function buildLaw() {
    const axisSeg = segmented([{ value: 'lon', label: 'Pitch (elevator)' }, { value: 'lat', label: 'Yaw (rudder)' }], S.axis, v => {
      S.axis = v; if (v === 'lat' && S.input === 'pilot') S.input = 'doublet'; S.amp = v === 'lat' ? AMP.lat : AMP[S.mode]; buildLaw(); buildInput(); schedule();
    });
    const items = [field('Axis', axisSeg.el)];
    if (S.axis === 'lon') {
      const modeSeg = segmented(MODES, S.mode, v => { S.mode = v; S.amp = AMP[v]; buildLaw(); buildInput(); schedule(); });
      modeSeg.el.classList.add('seg-wrap');
      items.push(field('Command system', modeSeg.el, 'Dampers only: the stick moves the elevator directly and the feedback adds damping and stiffness. Pitch-rate and C* command: the stick asks for a pitch rate or a blend of g and pitch rate, and an integrator holds it.'),
        sl('α feedback Kα (° per °)', 0, 2, 0.01, 'ka', null, 'Adds pitch stiffness: the elevator pushes the nose down as α rises. This is what stabilises an aircraft whose CG is behind the neutral point.'),
        sl('Pitch-rate feedback Kq (° per °/s)', 0, 1.5, 0.01, 'kq', null, 'Adds pitch damping: the classic pitch damper.'),
        sl('Load-factor feedback Knz (° per g)', 0, 5, 0.05, 'knz', null, 'Normal acceleration feedback: like α feedback but measured by an accelerometer, which also responds to gusts.'));
      if (S.mode === 'direct') items.push(sl('Stick gearing (° elevator per ° stick)', 0.2, 3, 0.05, 'kstick'));
      else {
        const u = S.mode === 'rate' ? '°/s' : 'g';
        items.push(sl(`Proportional Kp (° per ${u} of error)`, 0, S.mode === 'rate' ? 1 : 5, 0.01, 'kp'),
          sl(`Integral Ki (° per ${u}·s of error)`, 0, S.mode === 'rate' ? 3 : 10, 0.01, 'ki', null, 'Keeps moving the elevator until the commanded value is reached exactly.'),
          sl(`Feed-forward Kff (° per ${u} commanded)`, 0, S.mode === 'rate' ? 1 : 5, 0.01, 'kff', null, 'Moves the elevator at once on a command instead of waiting for the integrator. It does not change stability, but too much overshoots.'));
      }
    } else {
      items.push(sl('Yaw-rate feedback Kr (° per °/s)', 0, 5, 0.01, 'kr', null, 'The yaw damper: rudder against yaw rate damps the Dutch roll.'),
        toggle('Washout on the yaw-rate signal', S.wash, v => { S.wash = v; buildLaw(); schedule(); }, { tip: 'τs/(τs + 1): the damper ignores a steady yaw rate, so it does not fight a turn.' }).el);
      if (S.wash) items.push(sl('Washout time constant τ (s)', 0.3, 10, 0.1, 'tw'));
      items.push(sl('Sideslip feedback Kβ (° per °)', 0, 3, 0.01, 'kb', null, 'Rudder against sideslip: extra directional stiffness (raises the Dutch-roll frequency), not damping.'));
    }
    const cat = segmented([{ value: 'A', label: 'Cat A' }, { value: 'B', label: 'Cat B' }, { value: 'C', label: 'Cat C' }], S.cat, v => { S.cat = v; schedule(); });
    items.push(field('Flight phase for the levels', cat.el, 'MIL-F-8785C: A precise manoeuvring (combat, formation), B cruise and climb, C takeoff and landing.'));
    lawSec.body.replaceChildren(...items);
  }
  function buildInput() {
    const opts = [{ value: 'step', label: 'Step' }, { value: 'doublet', label: 'Doublet' }, { value: 'pulse', label: 'Pulse' }, { value: 'upset', label: 'Upset' }, { value: 'none', label: 'Gusts only' }];
    if (S.axis === 'lon') opts.push({ value: 'pilot', label: 'Pilot tracking' });
    const seg = segmented(opts, S.input, v => { S.input = v; if (v === 'pilot') S.amp = 5; else S.amp = S.axis === 'lat' ? AMP.lat : AMP[S.mode]; buildInput(); schedule(); });
    seg.el.classList.add('seg-wrap');
    const items = [field('Input', seg.el, 'Step, doublet and pulse go through the command path. Upset: start with 2° of extra α (or β) and no input. Pilot tracking: a pilot model tries to capture a pitch-attitude step.')];
    const u = S.axis === 'lat' ? UNIT.lat : UNIT[S.mode];
    if (['step', 'doublet', 'pulse'].includes(S.input)) items.push(sl(`Size (${u})`, 0.1, S.axis === 'lon' && S.mode === 'cstar' ? 6 : 20, 0.1, 'amp'));
    if (S.input === 'doublet' || S.input === 'pulse') items.push(sl('Width (s)', 0.2, 5, 0.1, 'width'));
    if (S.input === 'pilot') items.push(sl('Target pitch change (°)', 1, 15, 0.5, 'amp'),
      sl(`Pilot gain (${S.mode === 'rate' ? '°/s' : S.mode === 'cstar' ? 'g' : '° stick'} per ° of error)`, 0.2, 6, 0.1, 'pilotGain', null, 'How aggressively the pilot chases the target. High gain plus a rate-limited surface is the recipe for pilot-induced oscillation.'),
      sl('Pilot reaction delay (s)', 0.05, 0.5, 0.01, 'pilotTau', null, 'Human neuromuscular and perception delay, typically 0.2–0.3 s.'));
    const tb = segmented([{ value: 'off', label: 'Off' }, ...SEVERITY.map(s => ({ value: s.id, label: s.label }))], S.turb, v => { S.turb = v; schedule(); });
    const tSeg = segmented([5, 10, 15, 30, 60].map(t => ({ value: t, label: `${t} s` })), S.T, v => { S.T = v; schedule(); });
    items.push(field('Turbulence (Dryden)', tb.el), field('Duration', tSeg.el));
    inSec.body.replaceChildren(...items);
  }
  function buildHw() {
    hwSec.body.replaceChildren(
      sl('Actuator bandwidth ωa (rad/s)', 5, 80, 1, 'wa', v => (+v).toFixed(0)),
      sl('Rate limit (°/s)', 5, 150, 1, 'rate', v => (+v).toFixed(0), 'How fast the hydraulics can move the surface. The F-16 tailplane is about 60°/s. Below what the loop asks for, the surface lags further and further behind.'),
      sl('Position limit (± °)', 5, 30, 0.5, 'pos', v => (+v).toFixed(1)),
      sl('Computer frame rate (Hz)', 10, 200, 1, 'fs', v => (+v).toFixed(0), 'The flight computer samples the sensors and updates the command this many times a second (the F-16 analog computer was continuous; digital ones run at 40–80 Hz).'),
      sl('Sensor and computing delay (ms)', 0, 250, 5, 'delay', v => (+v).toFixed(0)),
    );
  }
  buildLaw(); buildInput(); buildHw();

  function applyScenario(v) {
    const sc = SCENARIOS.find(x => x.value === v); if (!sc || !sc.ac) return;
    if (perf.id !== sc.ac) { setAircraft(sc.ac); changed('aircraft'); } else { perf.cg = St.GEOMETRY[sc.ac].cg[2]; changed('cg'); }
    acSec.rebuild(); cond.rebuild(); des.rebuild();
    Object.assign(S, BASE, { ka: 0, kq: 0, kp: 0, ki: 0 }, sc.s);
    S.amp = sc.s.input === 'pilot' ? 5 : sc.s.axis === 'lat' ? AMP.lat : AMP[sc.s.mode];
    buildLaw(); buildInput(); buildHw(); compute();
  }

  // ---------- main area ----------
  const metrics = metricsGrid();
  const playBtn = h('button', { class: 'btn', type: 'button', onclick: () => { S.playing = !S.playing; paintPlay(); if (S.playing) { S.t0 = performance.now() - (S.tp || 0) * 1000; loop(); } else S.tp = animTime(); } });
  const paintPlay = () => playBtn.replaceChildren(icon(S.playing ? 'pause' : 'play', 14), S.playing ? 'Pause' : 'Play');
  const replay = h('button', { class: 'btn', type: 'button', onclick: () => { S.t0 = performance.now(); S.tp = 0; if (!S.playing) { S.playing = true; paintPlay(); } loop(); } }, icon('reset', 14), 'Replay');
  paintPlay();
  const anim = canvasBox('300px', drawAnim, 'flt-scene');
  const animCard = h('div', { class: 'plot-card' }, h('div', { class: 'plot-head' }, h('h4', {}, 'Watch it fly'), h('div', { class: 'row' }, replay, playBtn)), anim.el);
  const hist = canvasBox('440px', drawHist);
  const histCard = card('Time histories', 'Solid: with the computer. Dashed: the comparison case. The bottom panel shows the surface: command (dashed) and actual (solid), with red where it is moving at its rate limit.', hist.el);
  const sp = canvasBox('380px', drawRoots);
  const spCard = card('Root migration', 'Open-loop roots (×) move along the lines to the closed-loop roots (●) as the feedback gains are raised from zero to their values.', sp.el);
  const hq = canvasBox('380px', drawHQ);
  const hqCard = card('Handling qualities (MIL-F-8785C)', 'Pitch: control anticipation parameter CAP = ωsp²/(n/α) against short-period damping. Yaw: Dutch-roll damping against frequency. Green Level 1, amber Level 2.', hq.el);
  const bod = canvasBox('380px', (c, W, H) => R && drawBode(c, W, H, R.L, R.mg));
  const bodCard = card('Loop broken at the actuator', 'Inject a signal at the actuator input and see what the computer sends back: the margins of the whole augmentation loop.', bod.el);
  const eqCard = card('The control law'); const eqHost = h('div'); eqCard.append(eqHost);
  const insCard = card('What is happening here'); const ins = h('div'); insCard.append(ins);
  main.append(metrics.el, h('div', { class: 'flt-grid2' }, animCard, histCard), h('div', { class: 'flt-grid2' }, spCard, hqCard), h('div', { class: 'flt-grid2' }, insCard, bodCard), eqCard);

  let timer = 0;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(compute, 30); };

  // ---------- compute ----------
  const law = () => (S.axis === 'lon'
    ? { ka: S.ka, kq: S.kq, knz: S.knz * D, mode: S.mode, kp: S.mode === 'cstar' ? S.kp * D : S.kp, ki: S.mode === 'cstar' ? S.ki * D : S.ki, kff: S.mode === 'cstar' ? S.kff * D : S.kff, kstick: S.kstick }
    : { kr: S.kr, tw: S.wash ? S.tw : 0, kb: S.kb, kstick: 1 });
  const cmdScale = () => (S.axis === 'lon' && S.mode === 'cstar' ? 1 : D);   // command units → SI
  function compute() {
    const inp = stabInput(), an = St.analyse(inp), lw = law(), axis = S.axis;
    const hw = { wa: S.wa, rate: S.rate * D, pos: S.pos * D, delay: S.delay / 1000, fs: S.fs };
    const { P, L } = Au.loopTf(an, lw, axis, { wa: S.wa, delay: S.delay / 1000 });
    const clp = Au.closedLoopRoots(L), mg = Ct.margins(L);
    const pms = Ct.poles(Au.plantTf(P, axis === 'lon' ? 'q' : 'r')).map(z => Math.hypot(...z)).filter(v => v > 1e-6);
    const paths = Ct.rootLocus(L, 1e-3, 1, 50, { floor: 0.004 * Math.min(...pms, 1) });
    // simulation inputs
    const U = an.d.V, gustSev = SEVERITY.find(s => s.id === S.turb);
    const opts = { T: S.T, dt: S.T > 30 ? 0.004 : 0.0025, gust: gustSev ? { W20: gustSev.W20, h: perf.z, seed: 5 } : null };
    if (S.input === 'upset') opts.x0 = axis === 'lon' ? [0, 2 * D * U, 0, 0] : [2 * D, 0, 0, 0];
    else if (S.input === 'pilot') opts.pilot = { gain: S.pilotGain, tau: S.pilotTau, amp: S.amp * D, t0: 0.5 };
    else if (S.input !== 'none') opts.input = { type: S.input, amp: S.amp * cmdScale(), t0: 0.5, width: S.width };
    if (opts.pilot && S.mode === 'cstar') opts.pilot.gain = S.pilotGain / D;   // g per rad of attitude error
    const sim = Au.simulate(an, lw, axis, hw, opts);
    // comparison: with a pilot, the same loop without the rate limit; otherwise the aircraft without the computer,
    // given the steady surface the computer ended up using (or the stick gearing)
    let cmp, cmpLabel;
    if (S.input === 'pilot') { cmp = Au.simulate(an, lw, axis, { ...hw, rate: Infinity }, opts); cmpLabel = 'No rate limit'; }
    else {
      // stick (or pedal) straight to the surface; for a command system, the steady surface per unit command that
      // the computer itself settles on, so both aircraft are asked for the same thing
      let olGain = axis === 'lat' ? 1 : S.mode === 'direct' ? S.kstick : 0;
      if (axis === 'lon' && S.mode !== 'direct') {
        const one = cmdScale(), st = Au.simulate(an, lw, axis, hw, { T: 8, input: { type: 'step', amp: one, t0: 0 } });
        olGain = st.departed ? lw.kp + lw.kff : (st.d[st.d.length - 1] - st.trimUp) / one;
      }
      cmp = Au.simulate(an, lw, axis, hw, { ...opts, augmented: false, olGain });
      cmpLabel = 'Unaugmented';
    }
    // modes
    const lim = Math.min(0.6 * S.wa, S.delay > 0 ? 3000 / S.delay : Infinity);
    const olMode = axis === 'lon' ? an.L.sp : an.Lt.dr;
    const cx = clp.filter(z => z[1] > 0.2 && Math.hypot(...z) < lim).map(z => ({ z, ...Ct.damping(z) }));
    let clMode = null;
    if (axis === 'lon') { const band = Math.sqrt(Math.max(...pms) * Math.min(...pms)); clMode = cx.filter(m => m.wn > band).sort((a, b) => b.wn - a.wn)[0] || null; }
    else { const w0 = olMode ? olMode.wn : 1; clMode = cx.sort((a, b) => Math.abs(Math.log(a.wn / w0)) - Math.abs(Math.log(b.wn / w0)))[0] || null; }
    const nA = Au.nAlpha(an);
    const level = m => (!m ? 4 : axis === 'lon' ? Au.spLevel(m.zeta, m.wn ** 2 / nA, S.cat) : Au.drLevel(m.zeta, m.wn, S.cat));
    R = { an, P, L, clp, mg, paths, sim, cmp, cmpLabel, olMode, clMode, nA, level, axis, lw, U, pms };
    seen = perf.version;
    S.t0 = performance.now(); S.tp = 0;
    setMetrics(); hist.paint(); sp.paint(); hq.paint(); bod.paint(); equations(); insights(); loop();
  }

  const modeText = m => (!m ? '—' : m.real ? (m.re > 0 ? 'diverges' : 'no oscillation') : `ζ ${m.zeta.toFixed(2)}`);
  function setMetrics() {
    const { olMode, clMode, clp, mg, sim, axis, nA, level } = R;
    const stable = clp.every(z => z[0] < 2e-3), unst = clp.filter(z => z[0] >= 2e-3).sort((a, b) => b[0] - a[0]);
    const olDiv = olMode && olMode.real && olMode.roots ? olMode.roots.find(x => x.re > 0) : null;
    const satR = sim.satRate.filter(Boolean).length / sim.satRate.length, peak = Math.max(...sim.d.map(Math.abs)) * DEG;
    const lvl = level(clMode), olLvl = olMode && !olMode.real ? level(olMode) : 4;
    const name = axis === 'lon' ? 'Short period' : 'Dutch roll';
    const list = [
      { k: `${name}, unaugmented`, v: olDiv ? 'DIVERGES' : modeText(olMode), s: olDiv ? `doubles in ${f3(olDiv.t2)} s` : olMode && !olMode.real ? `ωn ${f3(olMode.wn)} rad/s · Level ${olLvl > 3 ? '>3' : olLvl}` : '', cls: olDiv ? 'bad' : '' },
      { k: `${name}, augmented`, v: stable ? modeText(clMode) : 'UNSTABLE', s: stable ? (clMode ? `ωn ${f3(clMode.wn)} rad/s · Level ${lvl > 3 ? '>3' : lvl} (Cat ${S.cat})` : 'no oscillatory pair') : `doubles in ${f3(Math.LN2 / unst[0][0])} s`, cls: !stable ? 'bad' : lvl === 1 ? '' : 'warn' },
      axis === 'lon' ? { k: 'CAP', v: clMode ? f3(clMode.wn ** 2 / nA) : '—', s: `n/α ${f3(nA)} g/rad`, tip: 'Control anticipation parameter: initial pitch acceleration per g of final load factor.' } : { k: 'ζωn', v: clMode ? f3(clMode.zeta * clMode.wn) : '—', s: 'rad/s: how fast the wag decays' },
      !stable ? { k: 'Phase margin', v: '—', s: 'closed loop unstable' } : { k: 'Phase margin', v: mg.pm ? `${f3(mg.pm.pmDeg)}°` : '∞', s: mg.pm ? `crossover ${f3(mg.pm.w)} rad/s · delay margin ${f3(mg.pm.delay * 1000)} ms` : '', cls: mg.pm && mg.pm.pmDeg < 30 ? 'warn' : '' },
      !stable ? { k: 'Gain margin', v: '—', s: 'closed loop unstable' } : { k: 'Gain margin', v: mg.gmUp ? `+${f3(mg.gmUp.gmDb)} dB` : '∞', s: mg.gmDown ? `and −${f3(mg.gmDown.db)} dB (gain can fall)` : '', cls: (mg.gmUp && mg.gmUp.gmDb < 6) || (mg.gmDown && mg.gmDown.db < 6) ? 'warn' : '' },
      { k: 'Peak surface', v: `${f3(peak)}°`, s: `limit ±${S.pos}°`, cls: peak >= S.pos * 0.999 ? 'warn' : '' },
      { k: 'At rate limit', v: `${f3(satR * 100)}%`, s: 'of the time', cls: satR > 0.2 ? 'bad' : satR > 0.02 ? 'warn' : '' },
    ];
    if (sim.departed) list.push({ k: 'Departed', v: `${f3(sim.departed.t)} s`, s: `${sim.departed.what} beyond the model`, cls: 'bad' });
    else if (S.axis === 'lon' && S.mode !== 'direct' && S.input === 'step') { const y = sim.y[sim.y.length - 1][S.mode === 'rate' ? 'q' : 'cstar'] / (S.amp * cmdScale()); list.push({ k: 'Tracking', v: `${f3(y * 100)}%`, s: 'of the command at the end' }); }
    metrics.set(list);
  }

  // ---------- animation ----------
  let raf = 0;
  const animTime = () => { if (!R) return 0; const T = Math.max(R.sim.t[R.sim.t.length - 1], R.cmp.t[R.cmp.t.length - 1]); const t = S.playing ? (performance.now() - S.t0) / 1000 : S.tp || 0; return Math.min(t % (T + 1.5), T); };
  function loop() { cancelAnimationFrame(raf); const tick = () => { if (!main.isConnected || !S.playing) return; anim.paint(); raf = requestAnimationFrame(tick); }; raf = requestAnimationFrame(tick); }
  const sampleAt = (rec, t) => { const ts = rec.t; if (t >= ts[ts.length - 1]) return ts.length - 1; let lo = 0, hi = ts.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ts[m] <= t) lo = m; else hi = m; } return lo; };
  function heights(rec, U) { if (rec._h) return rec._h; const out = [0]; for (let i = 1; i < rec.t.length; i++) { const x = rec.x[i], dt = rec.t[i] - rec.t[i - 1]; out.push(out[i - 1] + dt * (R.axis === 'lon' ? U * x[3] - x[1] : x[2])); } rec._h = out; return out; }
  function drawAnim(c, Wd, Hd) {
    if (!R) return;
    const t = animTime(), half = Wd / 2;
    [[R.cmp, R.cmpLabel, 0], [R.sim, S.input === 'pilot' ? `Rate limit ${S.rate}°/s` : 'With the computer', half]].forEach(([rec, label, x0]) => {
      const i = sampleAt(rec, t), x = rec.x[i], hh = heights(rec, R.U), cx = x0 + half / 2;
      c.save(); c.beginPath(); c.rect(x0, 0, half, Hd); c.clip();
      c.fillStyle = cssVar('--text-2'); c.font = '600 12px ' + cssVar('--font'); c.textAlign = 'center'; c.textBaseline = 'top'; c.fillText(label, cx, 8);
      const gone = rec.departed && t >= rec.departed.t;
      if (R.axis === 'lon') {
        const hs = Math.max(1, ...hh.map(Math.abs)), cy = Hd * 0.52 - Math.max(-Hd * 0.25, Math.min(Hd * 0.25, hh[i] / hs * Hd * 0.22));
        const off = (rec.t[i] * 60) % 80;
        c.strokeStyle = cssVar('--border'); c.lineWidth = 1; c.beginPath(); for (let X = x0 - off; X < x0 + half; X += 80) { c.moveTo(X, Hd - 42); c.lineTo(X + 30, Hd - 42); } c.stroke();
        c.save(); c.translate(cx, cy); c.rotate(-x[3]); c.scale(1.9, 1.9); plane(c, gone ? cssVar('--bad') : cssVar('--text')); c.restore();
        const gam = x[3] - x[1] / R.U;
        c.strokeStyle = cssVar('--accent'); c.lineWidth = 2; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + 70 * Math.cos(gam), cy - 70 * Math.sin(gam)); c.stroke();
        c.fillStyle = cssVar('--text-2'); c.font = '11px ' + cssVar('--mono'); c.textAlign = 'center'; c.textBaseline = 'bottom';
        c.fillText(`θ ${(x[3] * DEG).toFixed(1)}°  α ${(x[1] / R.U * DEG).toFixed(1)}°  nz ${(rec.y[i].nz + 1).toFixed(2)} g`, cx, Hd - 10);
      } else {
        const ry = Hd * 0.32, ty = Hd * 0.68, L0 = Math.min(half * 0.3, 60);
        c.save(); c.translate(cx, ry); c.rotate(x[3]); c.fillStyle = gone ? cssVar('--bad') : cssVar('--text'); c.fillRect(-L0, -2, 2 * L0, 4); c.beginPath(); c.arc(0, 0, 7, 0, 2 * Math.PI); c.fill(); c.fillRect(-2, -20, 4, 15); c.restore();
        const ps = hh[i];
        c.save(); c.translate(cx, ty); c.rotate(ps - Math.PI / 2); c.scale(1.7, 1.7); topView(c, gone ? cssVar('--bad') : cssVar('--text')); c.restore();
        const vd = ps + x[0];
        c.strokeStyle = cssVar('--accent'); c.lineWidth = 2; c.beginPath(); c.moveTo(cx, ty); c.lineTo(cx + 55 * Math.sin(vd), ty - 55 * Math.cos(vd)); c.stroke();
        c.fillStyle = cssVar('--text-2'); c.font = '11px ' + cssVar('--mono'); c.textAlign = 'center'; c.textBaseline = 'bottom';
        c.fillText(`β ${(x[0] * DEG).toFixed(1)}°  φ ${(x[3] * DEG).toFixed(1)}°  r ${(x[2] * DEG).toFixed(1)}°/s`, cx, Hd - 10);
      }
      if (gone) { c.fillStyle = cssVar('--bad'); c.font = '600 11.5px ' + cssVar('--font'); c.textAlign = 'center'; c.textBaseline = 'top'; c.fillText(`Departed at ${rec.departed.t.toFixed(1)} s (${rec.departed.what})`, cx, 26); }
      c.restore();
    });
    c.strokeStyle = cssVar('--border'); c.lineWidth = 1; c.beginPath(); c.moveTo(half, 6); c.lineTo(half, Hd - 6); c.stroke();
    c.fillStyle = cssVar('--text-3'); c.font = '11px ' + cssVar('--mono'); c.textAlign = 'right'; c.textBaseline = 'top'; c.fillText(`t = ${t.toFixed(1)} s`, Wd - 8, 8);
  }

  // ---------- time histories ----------
  function panel(c, Wd, top, Hp, o) {
    c.save(); c.translate(0, top);
    const vals = o.fit.flat().filter(isFinite), lo = Math.min(0, ...vals), hi = Math.max(0, ...vals), pd = (hi - lo) * 0.1 || 0.5;
    const tr = axes(c, Wd, Hp, { x0: 0, x1: S.T, y0: lo - pd, y1: hi + pd, xlabel: o.xlabel || '', ylabel: o.ylabel, pt: 8, pb: o.xlabel ? 34 : 18, xfmt: v => f3(v), yfmt: v => f3(v) });
    tr.clip();
    if (o.shade) { c.fillStyle = cssVar('--bad'); c.globalAlpha = 0.14; for (const [a, b] of o.shade) c.fillRect(tr.sx(a), tr.pt, Math.max(1, tr.sx(b) - tr.sx(a)), tr.ih); c.globalAlpha = 1; }
    tr.line([[0, 0], [S.T, 0]], cssVar('--border-strong'), 1);
    for (const l of o.hlines || []) tr.line([[0, l.y], [S.T, l.y]], l.color, 1.2, l.dash);
    for (const s of o.series) tr.line(s.t.map((t, i) => [t, s.v[i]]), s.color, s.w || 2, s.dash);
    c.restore();
    if (o.legend) legend(c, tr, o.legend, tr.pl + tr.iw - 150, tr.pt + 10);
    c.restore();
  }
  function drawHist(c, Wd, Hd) {
    if (!R) return;
    const { sim, cmp } = R, lon = R.axis === 'lon', h1 = Math.round(Hd * 0.36), h2 = Math.round(Hd * 0.28), h3 = Hd - h1 - h2;
    const col = (rec, f) => rec.y.map(f), A = cssVar('--accent'), B = cssVar('--text-3');
    const trk = lon ? (S.mode === 'cstar' ? { k: 'cstar', s: 1, l: 'C* (g)' } : { k: 'q', s: DEG, l: 'q (°/s)' }) : { k: 'r', s: DEG, l: 'r (°/s)' };
    const ya = col(sim, y => y[trk.k] * trk.s), yb = col(cmp, y => y[trk.k] * trk.s);
    const cmdLine = lon && S.mode !== 'direct' && S.input !== 'pilot' ? sim.r.map(v => v * (S.mode === 'cstar' ? 1 : DEG)) : null;
    const fit1 = [ya, cmdLine || [], yb.map(v => Math.max(-3 * Math.max(1, ...ya.map(Math.abs)), Math.min(3 * Math.max(1, ...ya.map(Math.abs)), v)))];
    panel(c, Wd, 0, h1, { ylabel: trk.l, fit: fit1, series: [{ t: cmp.t, v: yb, color: B, dash: [5, 4], w: 1.6 }, ...(cmdLine ? [{ t: sim.t, v: cmdLine, color: cssVar('--warn'), dash: [2, 3], w: 1.4 }] : []), { t: sim.t, v: ya, color: A, w: 2.2 }],
      legend: [[A, S.input === 'pilot' ? `rate limit ${S.rate}°/s` : 'with computer', null, 2.2], [B, R.cmpLabel.toLowerCase(), [5, 4], 1.6], ...(cmdLine ? [[cssVar('--warn'), 'command', [2, 3], 1.4]] : [])] });
    const k2 = lon ? { k: 'alpha', s: DEG, l: 'α (°)' } : { k: 'beta', s: DEG, l: 'β (°)' };
    const a2 = col(sim, y => y[k2.k] * k2.s), b2 = col(cmp, y => y[k2.k] * k2.s), att = sim.x.map(x => x[3] * DEG);
    panel(c, Wd, h1, h2, { ylabel: lon ? 'α, θ (°)' : 'β, φ (°)', fit: [a2, att, b2.map(v => Math.max(-4 * Math.max(1, ...a2.map(Math.abs)), Math.min(4 * Math.max(1, ...a2.map(Math.abs)), v)))], series: [{ t: cmp.t, v: b2, color: B, dash: [5, 4], w: 1.6 }, { t: sim.t, v: att, color: cssVar('--good'), w: 1.6 }, { t: sim.t, v: a2, color: A, w: 2.2 }],
      legend: [[A, lon ? 'α' : 'β', null, 2.2], [cssVar('--good'), lon ? 'θ' : 'φ', null, 1.6]] });
    const d = sim.d.map(v => v * DEG), dcmd = sim.dc.map(v => v * DEG), shade = [];
    let st = null; sim.satRate.forEach((s, i) => { if (s && st === null) st = sim.t[i]; if (!s && st !== null) { shade.push([st, sim.t[i]]); st = null; } }); if (st !== null) shade.push([st, sim.t[sim.t.length - 1]]);
    panel(c, Wd, h1 + h2, h3, { ylabel: lon ? 'elevator up (°)' : 'rudder (°)', xlabel: 'Time (s)', fit: [d, dcmd.map(v => Math.max(-S.pos * 1.3, Math.min(S.pos * 1.3, v)))], shade, hlines: Math.max(...d.map(Math.abs)) > S.pos * 0.6 ? [{ y: S.pos, color: cssVar('--bad'), dash: [4, 3] }, { y: -S.pos, color: cssVar('--bad'), dash: [4, 3] }] : [],
      series: [{ t: sim.t, v: dcmd, color: cssVar('--lower'), dash: [4, 3], w: 1.4 }, { t: sim.t, v: d, color: cssVar('--lower'), w: 2.2 }] });
  }

  // ---------- root migration and handling qualities ----------
  function drawRoots(c, Wd, Hd) {
    if (!R) return;
    const { P, clp, paths, pms } = R, ol = Ct.poles(Au.plantTf(P, R.axis === 'lon' ? 'q' : 'r'));
    const cut = Math.max(3 * Math.max(...pms), R.clMode ? 1.5 * R.clMode.wn : 0), fit = [...ol, ...clp].filter(z => Math.hypot(...z) < cut);
    const names = R.axis === 'lon' ? [['short period', R.an.L.sp.lam], ['phugoid', R.an.L.ph.lam]] : [['Dutch roll', R.an.Lt.dr ? R.an.Lt.dr.lam : []], ['roll', R.an.Lt.roll ? R.an.Lt.roll.lam : []], ['spiral', R.an.Lt.spiral ? R.an.Lt.spiral.lam : []]];
    const labels = []; for (const [n, lam] of names) if (lam && lam.length) { const z = lam.find(l => l[1] >= 0) || lam[0]; labels.push([z, n]); }
    drawSPlane(c, Wd, Hd, { fit, paths, ol, cl: clp, labels, note: 'feedback gains × 0 → × 1' });
  }
  function drawHQ(c, Wd, Hd) {
    if (!R) return;
    const { olMode, clMode, nA } = R, good = cssVar('--good'), warn = cssVar('--warn');
    if (R.axis === 'lon') {
      const ly = v => Math.log10(v), Lm = Au.SP_LIMITS[S.cat];
      const tr = axes(c, Wd, Hd, { x0: 0, x1: 2.2, y0: ly(0.01), y1: ly(20), xlabel: 'Short-period damping ratio ζsp', ylabel: 'CAP (g⁻¹ s⁻²), log', xfmt: v => v.toFixed(1), yfmt: v => String(+(10 ** v).toPrecision(2)), ystep: 1, pb: 38 });
      tr.clip();
      const box = (l, col, alpha) => { const X0 = tr.sx(l.z[0]), X1 = tr.sx(l.z[1]), Y0 = tr.sy(ly(l.cap[1])), Y1 = tr.sy(ly(l.cap[0])); c.fillStyle = col; c.globalAlpha = alpha; c.fillRect(X0, Y0, X1 - X0, Y1 - Y0); c.globalAlpha = 1; c.strokeStyle = col; c.lineWidth = 1.5; c.strokeRect(X0, Y0, X1 - X0, Y1 - Y0); };
      box(Lm[1], warn, 0.08); box(Lm[0], good, 0.14);
      tr.text(Lm[0].z[1] - 0.03, ly(Lm[0].cap[1] * 0.85), 'Level 1', good, 'right', 'top', '600 11px');
      tr.text(Lm[1].z[1] - 0.03, ly(Lm[1].cap[1] * 0.85), 'Level 2', warn, 'right', 'top', '600 11px');
      const pt = (m, col, lab) => { if (!m || m.real) return false; const z = Math.min(2.15, Math.max(0.01, m.zeta)), cp = Math.max(0.011, Math.min(19, m.wn ** 2 / nA)); tr.dot(z, ly(cp), col, 6); tr.text(z, ly(cp), `  ${lab}`, cssVar('--text'), 'left', 'bottom', '600 11px'); return true; };
      if (!pt(olMode, cssVar('--text-3'), 'unaugmented')) tr.text(1.1, ly(0.02), olMode && olMode.re > 0 ? 'Unaugmented: diverges (no point on this chart)' : 'Unaugmented: no oscillation', cssVar('--text-3'), 'center', 'middle', '11px');
      if (!pt(clMode, cssVar('--accent'), 'augmented')) tr.text(1.1, ly(0.045), 'Augmented: no oscillatory short period', cssVar('--accent'), 'center', 'middle', '11px');
      c.restore();
    } else {
      const lm = Au.DR_LIMITS[S.cat], wmax = Math.max(4, (olMode ? olMode.wn : 1) * 1.6, (clMode ? clMode.wn : 1) * 1.6);
      const tr = axes(c, Wd, Hd, { x0: 0, x1: wmax, y0: 0, y1: 1, xlabel: 'Dutch-roll natural frequency ωn (rad/s)', ylabel: 'Dutch-roll damping ratio ζ', xfmt: v => f3(v), yfmt: v => v.toFixed(1), pb: 38 });
      tr.clip();
      const region = (zmin, zw, wmin, col, alpha) => { c.fillStyle = col; c.globalAlpha = alpha; c.beginPath(); const pts = []; for (let i = 0; i <= 80; i++) { const w = wmin + (wmax - wmin) * i / 80; pts.push([w, Math.max(zmin, zw / w)]); } c.moveTo(tr.sx(wmin), tr.sy(1.2)); pts.forEach(([w, z]) => c.lineTo(tr.sx(w), tr.sy(Math.min(1.2, z)))); c.lineTo(tr.sx(wmax), tr.sy(1.2)); c.closePath(); c.fill(); c.globalAlpha = 1; tr.line(pts.map(([w, z]) => [w, Math.min(1.2, z)]), col, 1.5); tr.line([[wmin, 0], [wmin, 1.2]], col, 1.2, [4, 3]); };
      region(0.02, 0.05, 0.4, warn, 0.08); region(lm.z, lm.zw, lm.w, good, 0.14);
      tr.text(wmax * 0.97, 0.95, 'Level 1', good, 'right', 'top', '600 11px');
      const pt = (m, col, lab) => { if (!m) return; const z = Math.max(0.005, Math.min(0.99, m.zeta)); tr.dot(m.wn, z, col, 6); tr.text(m.wn, z, `  ${lab}`, cssVar('--text'), 'left', 'bottom', '600 11px'); };
      pt(olMode && !olMode.real ? olMode : null, cssVar('--text-3'), 'unaugmented'); pt(clMode, cssVar('--accent'), 'augmented');
      c.restore();
    }
  }

  // ---------- law written out ----------
  function equations() {
    const lw = R.lw, lines = [];
    if (R.axis === 'lon') {
      const fb = [S.ka ? `${f3(S.ka)}·α` : null, S.kq ? `${f3(S.kq)}·q` : null, S.knz ? `${f3(S.knz)}·nz` : null].filter(Boolean).join(' + ') || '0';
      if (S.mode === 'direct') lines.push(`δ = ${f3(S.kstick)}·stick − (${fb})`);
      else { const y = S.mode === 'rate' ? 'q' : 'C*'; lines.push(`e = ${y}_cmd − ${y}${S.mode === 'cstar' ? ',   C* = nz + (Vco/g)·q,  Vco = 122 m/s (400 ft/s)' : ''}`, `δ = ${f3(S.kff)}·${y}_cmd + ${f3(S.kp)}·e + ${f3(S.ki)}·∫e dt − (${fb})`); }
      lines.push('δ in degrees of up elevator; α, θ in degrees, q in °/s, nz in g');
    } else {
      lines.push(`δr = pedal − (${f3(S.kr)}·${S.wash ? `[${f3(S.tw)}s/(${f3(S.tw)}s + 1)]·r` : 'r'}${S.kb ? ` + ${f3(S.kb)}·β` : ''})`, 'δr in degrees (sign chosen so + gives nose-right yaw); r in °/s, β in degrees');
    }
    lines.push(`Actuator ${S.wa}/(s + ${S.wa}), ±${S.pos}°, ${S.rate}°/s · computer ${S.fs} Hz · delay ${S.delay} ms`);
    const order = R.L.den.length - 1;
    eqHost.replaceChildren(h('span', { class: 'eq', html: lines.join('<br>') }),
      h('p', { class: 'hint' }, `Linear analysis: the loop broken at the actuator, L(s) = A(s)·e^(−sT)·Σ Cᵢ(s)Gᵢ(s), order ${order} (the delay as a second-order Padé; the computer's sampling is left out). The time histories use the full simulation: sampled computer, true delay, rate and position limits.`));
  }

  // ---------- insights ----------
  function insights() {
    const { olMode, clMode, clp, mg, sim, cmp, axis, level } = R, list = [];
    const stable = clp.every(z => z[0] < 2e-3), relaxed = R.an.d.SM < 0;
    const olDiv = olMode && olMode.real && olMode.roots && olMode.roots.find(x => x.re > 0);
    const satR = sim.satRate.filter(Boolean).length / sim.satRate.length;
    if (olDiv && stable && !sim.departed) list.push({ type: 'g', t: 'An unstable aircraft, flown by its computer', d: `On its own the nose diverges, doubling every ${f3(olDiv.t2)} s${cmp.departed ? ` (the left aircraft departs after ${f3(cmp.departed.t)} s)` : ''}. With α feedback replacing the missing stiffness and q feedback adding damping, the computer flies a stable aircraft. In return the tail can carry an up-load in a turn, and the aircraft is lighter and more agile: relaxed static stability.` });
    if (!stable) list.push({ type: 'b', t: 'The augmented aircraft is unstable', d: `${S.delay >= 100 ? `${S.delay} ms of delay is more than this loop can stand: delay adds phase lag ωT that eats the phase margin. ` : ''}${relaxed && !S.ka && !S.knz ? 'Without α (or nz) feedback nothing replaces the pitch stiffness the aft CG removed. ' : ''}Look at which roots crossed into the right half on the root-migration plot.` });
    if (sim.departed && stable) list.push({ type: 'b', t: `Departed after ${f3(sim.departed.t)} s although the linear loop is stable`, d: `The surface spent ${f3(satR * 100)}% of the time at its ${S.rate}°/s rate limit. A rate-limited actuator turns the command into a triangle wave that lags it by up to 90°: the loop the linear analysis assumed is no longer there. ${S.input === 'pilot' ? 'With the pilot closing an outer loop round it, that lag is the classic cause of pilot-induced oscillation (PIO): the YF-22 (1992) and JAS 39 Gripen (1989, 1993) accidents involved rate limiting. Rate-limit PIOs start suddenly: lower the pilot gain a little and the response settles; raise it past a critical value and the oscillation grows within a cycle or two (a "cliff", not a gradual loss of damping).' : ''}` });
    else if (S.input === 'pilot') list.push({ type: cmp.departed ? 'w' : 'g', t: 'Pilot in the loop', d: `The pilot model sees the attitude ${S.pilotTau}s late and commands in proportion to the error. That adds an outer loop with its own phase lag on top of the computer's. Turn the rate limit down and the gain up to find where the oscillation starts.` });
    if (satR > 0.02 && !sim.departed) list.push({ type: 'w', t: `Rate limited ${f3(satR * 100)}% of the time`, d: 'While the surface moves at its maximum rate it falls behind the command (red bands on the bottom panel). Short spells are fine; long ones add phase lag and can drive an oscillation.' });
    if (stable && clMode) {
      const l = level(clMode), name = axis === 'lon' ? 'short period' : 'Dutch roll';
      list.push({ type: l === 1 ? 'g' : 'w', t: `Augmented ${name}: Level ${l > 3 ? '>3' : l} for Category ${S.cat}`, d: axis === 'lon' ? `ζ ${clMode.zeta.toFixed(2)}, CAP ${f3(clMode.wn ** 2 / R.nA)}. Level 1 for Category ${S.cat} needs ζ ${Au.SP_LIMITS[S.cat][0].z.join('–')} and CAP ${Au.SP_LIMITS[S.cat][0].cap.join('–')}. More Kq raises damping; more Kα (or Knz) raises the frequency and CAP.` : `ζ ${clMode.zeta.toFixed(2)}, ωn ${f3(clMode.wn)} rad/s. Level 1 for Category ${S.cat} needs ζ ≥ ${Au.DR_LIMITS[S.cat].z}, ζωn ≥ ${Au.DR_LIMITS[S.cat].zw} and ωn ≥ ${Au.DR_LIMITS[S.cat].w}. Kr adds damping; Kβ adds frequency.` });
    }
    if (stable && mg.pm && (mg.pm.pmDeg < 35 || (mg.gmUp && mg.gmUp.gmDb < 6))) list.push({ type: 'w', t: 'Thin stability margins', d: `Phase margin ${f3(mg.pm.pmDeg)}°${mg.gmUp ? `, gain margin ${f3(mg.gmUp.gmDb)} dB` : ''}. Flight-control specifications ask for at least 45° and 6 dB, because the real aircraft, actuator and sensors differ from the model.` });
    if (stable && mg.gmDown && relaxed) list.push({ type: 'i', t: `Conditionally stable: the gain can fall only ${f3(mg.gmDown.db)} dB`, d: 'An unstable airframe needs a minimum amount of feedback. Lose a sensor or a computer channel and the aircraft is lost, which is why fly-by-wire systems are triplex or quadruplex, with votes between channels.' });
    if (axis === 'lat' && !S.wash && S.kr > 0) list.push({ type: 'w', t: 'The yaw damper will fight turns', d: 'Without washout the damper opposes any steady yaw rate, including the one in a coordinated turn, so the pilot has to hold extra rudder. Switch the washout on.' });
    if (axis === 'lon' && S.mode !== 'direct' && S.input === 'step' && !sim.departed) { const y = sim.y[sim.y.length - 1][S.mode === 'rate' ? 'q' : 'cstar'] / (S.amp * cmdScale()); if (Math.abs(y - 1) > 0.05) list.push({ type: 'i', t: `Tracking ${f3(y * 100)}% of the command after ${S.T} s`, d: S.ki > 0 ? 'The integrator gets there eventually: raise Ki (watching the phase margin) or add some feed-forward to get there sooner.' : 'Without integral action a steady error remains.' }); }
    if (S.turb !== 'off') list.push({ type: 'i', t: 'Flying through turbulence', d: 'The same Dryden gust history hits both aircraft. Feedback that adds damping smooths the ride; α and nz feedback also react to the gusts themselves, moving the surface in rough air.' });
    if (!list.length) list.push({ type: 'i', t: 'Change a gain', d: 'Watch the roots migrate, the levels change and the two aircraft diverge from each other.' });
    insightsList(ins, list);
  }

  const offU = onUnits(() => { acSec.rebuild(); cond.rebuild(); schedule(); });
  compute();
  return {
    controls, main,
    show: () => { if (seen !== perf.version) { acSec.rebuild(); cond.rebuild(); des.rebuild(); compute(); } else { [hist, sp, hq, bod].forEach(x => x.paint()); if (S.playing) loop(); } },
    destroy: () => { offU(); clearTimeout(timer); cancelAnimationFrame(raf); },
  };
}
