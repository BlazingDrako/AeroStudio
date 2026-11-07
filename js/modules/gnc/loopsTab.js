// Control loops tab: pick a feedback loop on the current aircraft (pitch rate, attitude, α, nz, roll, bank, yaw rate,
// sideslip), a compensator, actuator lag and sensor delay, and see the loop four ways at once: a root locus you can
// drag the gain along, the closed-loop step response with the surface deflection, the Bode plot with margins, and the
// Nyquist plot. Transfer functions come straight from the stability model's state matrices.
import { h, section, slider, segmented, toggle, select, field, cssVar } from '../../lib/ui.js';
import * as St from '../../solvers/stability.js';
import * as Ct from '../../solvers/control.js';
import { card, metricsGrid, insightsList, onUnits, num, canvasBox } from '../flight/common.js';
import { drawBode as drawBodeL } from './plots.js';
import { perf, aircraftSection, conditionSection, designSection, stabInput, axes, legend, setAircraft, changed } from '../flight/perfShared.js';

const DEG = 180 / Math.PI;
// starting gain and time window for each loop; the yaw damper starts with a washout
const DEF = { q: { k: 0.3, T: 5 }, theta: { k: 1.5, T: 10 }, alpha: { k: 0.5, T: 5 }, nz: { k: 2, T: 5 }, p: { k: 0.3, T: 3 }, phi: { k: 1, T: 10 }, r: { k: 1, T: 10, wash: true }, beta: { k: 0.3, T: 10 } };
const TYPES = [{ value: 'P', label: 'Gain' }, { value: 'PI', label: 'PI' }, { value: 'PID', label: 'PID' }, { value: 'lead', label: 'Lead–lag' }];
const SCENARIOS = [
  { value: '', label: 'Choose a scenario…' },
  { value: 'pd', label: 'Pitch damper: light single', ac: 'c172', s: { loop: 'q', type: 'P', k: 0.3, wash: false, delay: 0 } },
  { value: 'yd', label: 'Yaw damper: airliner in cruise', ac: 'a320', s: { loop: 'r', type: 'P', k: 1.5, wash: true, tw: 2, delay: 0 } },
  { value: 'fq', label: 'Unstable fighter: pitch rate only', ac: 'f16', s: { loop: 'q', type: 'P', k: 0.5, wash: false, delay: 0, T: 30 } },
  { value: 'fa', label: 'Unstable fighter: α feedback', ac: 'f16', s: { loop: 'alpha', type: 'P', k: 0.5, wash: false, delay: 0, T: 5 } },
  { value: 'fd', label: 'Unstable fighter: α loop with 120 ms delay', ac: 'f16', s: { loop: 'alpha', type: 'P', k: 1.5, wash: false, delay: 120, T: 5 } },
  { value: 'pi', label: 'Attitude hold with integral: airliner', ac: 'a320', s: { loop: 'theta', type: 'PI', k: 0.5, ki: 0.1, wash: false, delay: 0, T: 30 } },
];
const f3 = v => (!isFinite(v) ? '—' : num(v, Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : Math.abs(v) >= 1 ? 2 : 3));
const sgn = v => (v < 0 ? '−' : '+');

export function loopsTab({ keep = o => o } = {}) {
  const S = keep({ loop: 'q', type: 'P', k: 0.3, ki: 0.3, kd: 0.05, z: 1, p: 10, wash: false, tw: 1, act: true, wa: 20, delay: 0, T: 5, view: 'fast' });
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });
  let R = null, seen = -1, locTr = null, locus = null;

  // ---------- controls ----------
  const scSec = section('Try a scenario');
  const scSel = select(SCENARIOS.map(({ value, label }) => ({ value, label })), '', v => applyScenario(v));
  scSec.body.append(scSel, h('div', { class: 'hint' }, 'Each one sets the aircraft, loop and compensator to show one idea. Change anything afterwards.'));
  const acSec = aircraftSection(src => { if (src === 'aircraft') { cond.rebuild(); des.rebuild(); } schedule(); });
  const cond = conditionSection(() => schedule());
  const des = designSection(() => schedule());
  const loopSec = section('Feedback loop');
  const compSec = section('Compensator');
  const hwSec = section('Actuator and sensor');
  controls.append(scSec.el, acSec.el, cond.el, des.el, loopSec.el, compSec.el, hwSec.el);

  const loopDef = () => Ct.LOOPS.find(l => l.id === S.loop);
  function buildLoop() {
    const sel = select(Ct.LOOPS.map(l => ({ value: l.id, label: `${l.label} → ${l.input}` })), S.loop, v => {
      S.loop = v; const d = DEF[v]; S.k = d.k; S.T = d.T; S.wash = !!d.wash; buildComp(); buildHw(); schedule();
    });
    const L = loopDef();
    loopSec.body.replaceChildren(field('Measured output → surface', sel), h('div', { class: 'hint' }, `Typical use: ${L.role}. The surface sign is chosen so a positive command gives a positive ${L.short}${L.input === 'elevator' ? ' (trailing edge up = nose up)' : ''}.`));
  }
  let kS = null;
  function buildComp() {
    const L = loopDef(), per = `° per ${L.unit}`;
    const typeSeg = segmented(TYPES, S.type, v => { S.type = v; buildComp(); schedule(); });
    kS = slider({ label: S.type === 'lead' ? `Gain K (${per})` : `Proportional Kp (${per})`, min: 0.01, max: 100, log: true, value: S.k, format: v => f3(+v),
      info: 'Surface deflection per unit of error. Drag the closed-loop roots on the root locus to change it too.', onInput: v => { S.k = v; schedule(); } });
    const items = [field('Type', typeSeg.el), kS.el];
    if (S.type === 'PI' || S.type === 'PID') items.push(slider({ label: `Integral Ki (${per} per s)`, min: 0.001, max: 50, log: true, value: S.ki, format: v => f3(+v), info: 'Builds up while any error remains, so a steady error is driven to zero. Adds a pole at the origin and a zero at −Ki/Kp.', onInput: v => { S.ki = v; schedule(); } }).el);
    if (S.type === 'PID') items.push(slider({ label: `Derivative Kd (${per}·s)`, min: 0.001, max: 5, log: true, value: S.kd, format: v => f3(+v), info: 'Responds to the rate of change of the error: phase lead, filtered at 50 rad/s so it does not amplify noise.', onInput: v => { S.kd = v; schedule(); } }).el);
    if (S.type === 'lead') {
      items.push(slider({ label: 'Zero z (rad/s)', min: 0.01, max: 200, log: true, value: S.z, format: v => f3(+v), onInput: v => { S.z = v; schedule(); } }).el,
        slider({ label: 'Pole p (rad/s)', min: 0.01, max: 200, log: true, value: S.p, format: v => f3(+v), info: 'p > z: lead (phase advance between z and p). p < z: lag (more low-frequency gain).', onInput: v => { S.p = v; schedule(); } }).el);
    }
    compSec.body.replaceChildren(...items);
  }
  function buildHw() {
    const wT = toggle('Washout on the feedback', S.wash, v => { S.wash = v; buildHw(); schedule(); }, { tip: 'τs/(τs + 1) in the sensor path: the loop reacts to changes but ignores steady values (a yaw damper that does not fight a steady turn).' });
    const items = [wT.el];
    if (S.wash) items.push(slider({ label: 'Washout time constant τ (s)', min: 0.2, max: 20, log: true, value: S.tw, format: v => f3(+v), onInput: v => { S.tw = v; schedule(); } }).el);
    const aT = toggle('Actuator lag', S.act, v => { S.act = v; buildHw(); schedule(); }, { tip: 'Hydraulic actuators follow the command as a first-order lag ωa/(s + ωa).' });
    items.push(aT.el);
    if (S.act) items.push(slider({ label: 'Actuator bandwidth ωa (rad/s)', min: 5, max: 100, step: 1, value: S.wa, format: v => (+v).toFixed(0), info: 'About 20 rad/s for a fighter tailplane actuator (Stevens & Lewis); faster for small surfaces.', onInput: v => { S.wa = v; schedule(); } }).el);
    items.push(slider({ label: 'Sensor and computer delay (ms)', min: 0, max: 200, step: 5, value: S.delay, format: v => (+v).toFixed(0), info: 'Sampling, filtering and computation in a digital flight computer. Modelled with a second-order Padé approximation.', onInput: v => { S.delay = v; schedule(); } }).el);
    hwSec.body.replaceChildren(...items);
  }
  buildLoop(); buildComp(); buildHw();

  function applyScenario(v) {
    const sc = SCENARIOS.find(s => s.value === v); if (!sc || !sc.ac) return;
    if (perf.id !== sc.ac) { setAircraft(sc.ac); changed('aircraft'); }
    else { perf.cg = St.GEOMETRY[sc.ac].cg[2]; changed('cg'); }
    acSec.rebuild(); cond.rebuild(); des.rebuild();
    Object.assign(S, { act: true, wa: 20, T: DEF[sc.s.loop].T }, sc.s);
    buildLoop(); buildComp(); buildHw(); compute();
  }

  // ---------- main area ----------
  const metrics = metricsGrid();
  const blk = canvasBox('132px', drawBlock);
  const blkCard = card('The loop', 'Command r, error e = r − measured y, compensator C(s), actuator, aircraft G(s), and the sensor path back. The loop transfer function L(s) is everything met going once round.', blk.el);
  const viewSeg = segmented([{ value: 'fast', label: 'Fast modes' }, { value: 'slow', label: 'Slow modes' }], S.view, v => { S.view = v; loc.paint(); });
  const loc = canvasBox('400px', drawLocus);
  const locCard = h('div', { class: 'plot-card' }, h('div', { class: 'plot-head' }, h('h4', {}, 'Root locus: drag the closed-loop roots'), h('div', { class: 'row' }, viewSeg.el)), loc.el,
    h('div', { class: 'hint', style: { marginTop: '4px' } }, '× open-loop poles, ○ zeros. As the gain rises the closed-loop roots (●) travel from the poles towards the zeros along the coloured branches. Drag a root to set the gain. Radial lines: constant damping ratio ζ; the shaded half is unstable.'));
  const tSeg = segmented([2, 5, 10, 30, 120].map(t => ({ value: t, label: `${t} s` })), S.T, v => { S.T = v; compute(); });
  const stp = canvasBox('380px', drawStep);
  const stpCard = h('div', { class: 'plot-card' }, h('div', { class: 'plot-head' }, h('h4', {}, 'Step response'), h('div', { class: 'row' }, tSeg.el)), stp.el,
    h('div', { class: 'hint', style: { marginTop: '4px' } }, 'Top: the measured output after a unit step in the command. Bottom: the surface deflection the loop asks for.'));
  const bod = canvasBox('400px', drawBode);
  const bodCard = card('Bode plot of the loop L(jω)', 'Gain (dB) and phase of the signal going once round the loop. At the 0 dB crossover the phase must stay clear of −180° (phase margin); where the phase reaches −180° the gain must be below 0 dB (gain margin).', bod.el);
  const nyq = canvasBox('400px', drawNyquist);
  const nyqCard = card('Nyquist plot', 'L(jω) as ω sweeps from 0 to ∞ (solid) and back from −∞ (dashed). Distances above 1 are compressed logarithmically so the whole curve fits; the critical point −1 stays exact. The curve must encircle −1 anticlockwise once per unstable open-loop pole.', nyq.el);
  const eqCard = card('Transfer functions, step by step'); const eqHost = h('div', { class: 'gnc-eq' }); eqCard.append(eqHost);
  const insCard = card('What is happening here'); const ins = h('div'); insCard.append(ins);
  main.append(metrics.el, blkCard, h('div', { class: 'flt-grid2' }, locCard, stpCard), h('div', { class: 'flt-grid2' }, bodCard, nyqCard), h('div', { class: 'flt-grid2' }, insCard, eqCard));

  let timer = 0;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(compute, 16); };

  // ---------- compute ----------
  function comp() {
    if (S.type === 'PI') return Ct.pid({ kp: S.k, ki: S.ki });
    if (S.type === 'PID') return Ct.pid({ kp: S.k, ki: S.ki, kd: S.kd });
    if (S.type === 'lead') return Ct.leadLag(S.k, S.z, S.p);
    return Ct.gain(S.k);
  }
  function compute() {
    tSeg.set(S.T);
    const inp = stabInput(), an = St.analyse(inp), pl = Ct.aircraftPlant(an, S.loop), L0 = pl.loop;
    const C = comp(), A = S.act ? Ct.actuator(S.wa) : Ct.gain(1), W = S.wash ? Ct.washout(S.tw) : Ct.gain(1), D = S.delay > 0 ? Ct.pade(S.delay / 1000) : Ct.gain(1);
    const H = Ct.tfMul(W, D), F = Ct.tfMul(C, A, pl.G), L = Ct.tfMul(F, H);
    const T = Ct.feedback(F, H), E = Ct.feedback(Ct.tfMul(C, A), Ct.tfMul(pl.G, H));
    const fp = Ct.factor(pl.G), fl = Ct.factor(L), clp = Ct.roots(T.den);
    const mg = Ct.margins(L), mg0 = S.delay > 0 ? Ct.margins(Ct.tfMul(F, W)) : null;
    const stable = clp.every(z => z[0] < 0), olUnstable = fp.p.filter(z => z[0] > 0).length;
    const y = Ct.step(T, S.T), u = Ct.step(E, S.T);
    const dc = stable ? Ct.dcGain(T) : undefined, si = Ct.stepInfo(y, dc);
    // Branches depend on the loop's shape, not its overall gain: trace them once relative to a reference gain and
    // reuse them while only the gain changes (dragging), so the curves stay still and only the roots move
    const r9 = v => +v.toPrecision(9);
    const key = JSON.stringify([perf.version, S.loop, S.type, r9(S.ki / S.k), r9(S.kd / S.k), S.z, S.p, S.wash, S.tw, S.act, S.wa, S.delay]);
    const m = locus && locus.key === key ? S.k / locus.kRef : 0;
    if (!(m > 0.002 && m < 500) || (!dragging && (m < 0.05 || m > 20))) {
      const pms = Ct.poles(pl.G).map(z => Math.hypot(...z)).filter(v => v > 1e-6);
      locus = { key, kRef: S.k, ki: S.ki / S.k, kd: S.kd / S.k, branches: Ct.rootLocus(L, 1e-3, 1e3, 120, { floor: 0.004 * Math.min(...pms, 1) }) };
    }
    const branches = locus.branches;
    // label every loop pole: aircraft mode, actuator, delay, washout or compensator
    const modes = L0.axis === 'lon' ? [['short period', an.L.sp.lam], ['phugoid', an.L.ph.lam]] : [['Dutch roll', an.Lt.dr ? an.Lt.dr.lam : []], ['roll', an.Lt.roll ? an.Lt.roll.lam : []], ['spiral', an.Lt.spiral ? an.Lt.spiral.lam : []]];
    const nameOf = z => {
      for (const [n, lam] of modes) if (lam.some(l => Math.hypot(l[0] - z[0], Math.abs(l[1]) - Math.abs(z[1])) < 1e-6 * (1 + Math.hypot(...z)))) return n;
      if (S.act && Math.abs(z[0] + S.wa) < 1e-6 * S.wa && !z[1]) return 'actuator';
      if (S.wash && Math.abs(z[0] + 1 / S.tw) < 1e-6 && !z[1]) return 'washout';
      if (S.delay > 0 && Ct.poles(D).some(d => Math.hypot(d[0] - z[0], d[1] - z[1]) < 1e-6 * (1 + Math.hypot(...z)))) return 'delay (Padé)';
      return 'compensator';
    };
    // the fast closed-loop modes (above the slow band, below the actuator and delay) and the least damped of them
    const plantMax = Math.max(...fp.p.map(z => Math.hypot(...z))), plantMin = Math.min(...fp.p.map(z => Math.hypot(...z)).filter(m => m > 1e-6));
    const lim = Math.min(S.act ? 0.6 * S.wa : Infinity, S.delay > 0 ? 3000 / S.delay : Infinity), band = Math.sqrt(plantMax * plantMin);
    const fast = clp.filter(z => Math.hypot(...z) > band && Math.hypot(...z) < lim);
    const olFast = fp.p.filter(z => Math.hypot(...z) > band);
    const leastDamped = rs => { const cx = rs.filter(z => z[1] > 0).map(Ct.damping).sort((a, b) => a.zeta - b.zeta)[0]; return cx || null; };
    R = { an, pl, L0, C, A, W, D, H, F, L, T, E, fp, fl, clp, mg, mg0, stable, olUnstable, y, u, si, dc, branches, nameOf, plantMax, plantMin, fast, cl: leadingFast(fast), ol: leastDamped(olFast) };
    function leadingFast(rs) { const d = leastDamped(rs); if (d) return d; const r = rs.sort((a, b) => b[0] - a[0])[0]; return r ? { real: true, re: r[0], tau: -1 / r[0] } : null; }
    seen = perf.version;
    setMetrics(); blk.paint(); loc.paint(); stp.paint(); bod.paint(); nyq.paint(); equations(); insights();
  }

  function setMetrics() {
    const { mg, stable, clp, si, u, L0, cl, ol, olUnstable } = R;
    const unst = clp.filter(z => z[0] > 0), worst = unst.sort((a, b) => b[0] - a[0])[0];
    const pm = mg.pm, peakU = Math.max(...u.y.map(Math.abs));
    const na = { v: '—', s: 'closed loop unstable', cls: '' };
    metrics.set([
      { k: 'Closed loop', v: stable ? 'stable' : 'UNSTABLE', s: stable ? `all ${clp.length} roots in the left half` : `${unst.length} root${unst.length > 1 ? 's' : ''} in the right half · doubles in ${f3(Math.LN2 / worst[0])} s`, cls: stable ? '' : 'bad', tip: 'Roots of 1 + L(s) = 0. Any root with a positive real part grows.' },
      { k: 'Open loop', v: olUnstable ? `${olUnstable} unstable pole${olUnstable > 1 ? 's' : ''}` : 'stable', s: 'the aircraft on its own', cls: olUnstable ? 'warn' : '' },
      !stable ? { k: 'Phase margin', ...na } : { k: 'Phase margin', v: pm ? `${f3(pm.pmDeg)}°` : '∞', s: pm ? `at crossover ωc ${f3(pm.w)} rad/s` : 'gain never reaches 0 dB', cls: pm && pm.pmDeg < 30 ? (pm.pmDeg < 0 ? 'bad' : 'warn') : '', tip: 'Extra phase lag the loop could take at crossover before it oscillates. Aim for 45–60°.' },
      !stable ? { k: 'Gain margin', ...na } : { k: 'Gain margin', v: mg.gmUp ? `${f3(mg.gmUp.gmDb)} dB` : '∞', s: mg.gmDown ? `and −${f3(mg.gmDown.db)} dB downward` : mg.gmUp ? `phase crossover ${f3(mg.gmUp.w)} rad/s` : 'phase never reaches −180°', cls: mg.gmUp && mg.gmUp.gmDb < 6 ? 'warn' : '', tip: 'How much the gain can rise (and, for a loop that stabilises an unstable aircraft, fall) before the closed loop goes unstable. Aim for at least 6 dB.' },
      !stable ? { k: 'Delay margin', ...na } : { k: 'Delay margin', v: pm && pm.pmDeg > 0 ? `${f3(pm.delay * 1000)} ms` : '—', s: 'extra delay to instability', tip: 'Phase margin divided by the crossover frequency.' },
      { k: L0.axis === 'lon' ? 'Short-period damping' : 'Fast-mode damping', v: cl ? (cl.real ? 'no oscillation' : `ζ ${cl.zeta.toFixed(2)}`) : '—', s: cl ? (cl.real ? `slowest τ ${f3(cl.tau)} s` : `ωn ${f3(cl.wn)} rad/s`) + (ol ? ` · open loop ζ ${ol.zeta.toFixed(2)}` : '') : '', cls: cl && !cl.real && cl.zeta < 0.2 ? 'warn' : '' },
      !stable ? { k: 'Overshoot', v: '—', s: 'diverges' } : S.wash ? { k: 'Overshoot', v: '—', s: 'washout: no steady command' } : { k: 'Overshoot', v: isFinite(si.overshoot) ? `${f3(si.overshoot * 100)}%` : '—', s: isFinite(si.rise) ? `rise ${f3(si.rise)} s · settles ${isFinite(si.settle) ? f3(si.settle) + ' s' : '> window'}` : (stable ? 'no steady value' : 'diverges') },
      { k: 'Steady response', v: stable && !S.wash ? f3(R.dc) : '—', s: !stable ? '' : S.wash ? 'washout opens the loop for steady signals' : `${L0.short} per unit command`, tip: 'Final value of the output after a unit step command (1 = no steady error).' },
      { k: 'Peak surface', v: `${f3(peakU)}°`, s: `per ${L0.unit} of command`, cls: peakU > 25 ? 'warn' : '' },
    ]);
  }

  // ---------- block diagram ----------
  function drawBlock(c, Wd, Hd) {
    if (!R) return;
    const L0 = R.L0, t1 = cssVar('--text'), t2 = cssVar('--text-2'), bd = cssVar('--border-strong'), ac = cssVar('--accent');
    const y = 44, yb = 106, bh = 40;
    const xs = [16, Wd * 0.1, Wd * 0.16, Wd * 0.38, Wd * 0.6, Wd * 0.92];
    c.lineWidth = 1.4; c.strokeStyle = bd; c.fillStyle = t2;
    const box = (x0, x1, title, sub, col) => {
      c.fillStyle = cssVar('--bg-sunk'); c.strokeStyle = col || bd; c.lineWidth = 1.4;
      c.beginPath(); c.roundRect(x0, y - bh / 2, x1 - x0, bh, 6); c.fill(); c.stroke();
      c.fillStyle = t1; c.font = '600 12px ' + cssVar('--font'); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(title, (x0 + x1) / 2, y - 7);
      c.fillStyle = t2; c.font = '10.5px ' + cssVar('--font'); c.fillText(sub, (x0 + x1) / 2, y + 9);
    };
    const arrow = (x0, y0, x1, y1) => { c.strokeStyle = t2; c.fillStyle = t2; c.lineWidth = 1.4; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); const a = Math.atan2(y1 - y0, x1 - x0); c.beginPath(); c.moveTo(x1, y1); c.lineTo(x1 - 8 * Math.cos(a - 0.4), y1 - 8 * Math.sin(a - 0.4)); c.lineTo(x1 - 8 * Math.cos(a + 0.4), y1 - 8 * Math.sin(a + 0.4)); c.fill(); };
    const lab = (x, yy, s) => { c.fillStyle = t2; c.font = 'italic 11px ' + cssVar('--font'); c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillText(s, x, yy - 4); };
    const sx = xs[1], gap = Math.max(10, Wd * 0.025);
    const bx = [[sx + 22, xs[3] - gap], [xs[3] + gap, xs[4] - gap], [xs[4] + gap, xs[5] - 30]];
    const ctext = { P: `K = ${f3(S.k)}`, PI: `${f3(S.k)} + ${f3(S.ki)}/s`, PID: 'Kp + Ki/s + Kd s', lead: `(s/${f3(S.z)} + 1)/(s/${f3(S.p)} + 1)` }[S.type];
    arrow(xs[0], y, sx - 9, y); lab((xs[0] + sx) / 2, y, 'r');
    c.strokeStyle = t2; c.lineWidth = 1.4; c.beginPath(); c.arc(sx, y, 9, 0, 2 * Math.PI); c.stroke();
    c.font = '11px ' + cssVar('--font'); c.fillStyle = t2; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('Σ', sx, y); c.fillText('−', sx - 14, y + 14);
    arrow(sx + 9, y, bx[0][0], y); lab((sx + bx[0][0]) / 2 + 4, y, 'e');
    box(bx[0][0], bx[0][1], 'Compensator C(s)', ctext, ac);
    arrow(bx[0][1], y, bx[1][0], y); lab((bx[0][1] + bx[1][0]) / 2, y, 'δc');
    box(bx[1][0], bx[1][1], 'Actuator', S.act ? `${S.wa.toFixed(0)}/(s + ${S.wa.toFixed(0)})` : 'ideal (off)');
    arrow(bx[1][1], y, bx[2][0], y); lab((bx[1][1] + bx[2][0]) / 2, y, 'δ');
    box(bx[2][0], bx[2][1], 'Aircraft G(s)', `${L0.short} / ${L0.input}`);
    arrow(bx[2][1], y, Wd - 8, y); lab((bx[2][1] + Wd - 8) / 2, y, L0.short);
    // feedback path
    const xr = (bx[2][1] + Wd - 8) / 2;
    c.strokeStyle = t2; c.lineWidth = 1.4; c.beginPath(); c.moveTo(xr, y); c.lineTo(xr, yb); c.stroke();
    const sens = [S.delay > 0 ? `delay ${S.delay} ms` : null, S.wash ? `washout τ ${f3(S.tw)} s` : null].filter(Boolean).join(' · ') || 'ideal sensor';
    const fx0 = Wd * 0.38, fx1 = Wd * 0.62;
    c.fillStyle = cssVar('--bg-sunk'); c.strokeStyle = bd; c.beginPath(); c.roundRect(fx0, yb - 15, fx1 - fx0, 30, 6); c.fill(); c.stroke();
    c.fillStyle = t1; c.font = '600 11.5px ' + cssVar('--font'); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(`Sensor H(s): ${sens}`, (fx0 + fx1) / 2, yb);
    arrow(xr, yb, fx1, yb);
    c.strokeStyle = t2; c.beginPath(); c.moveTo(fx0, yb); c.lineTo(sx, yb); c.stroke(); arrow(sx, yb, sx, y + 9);
  }

  // ---------- root locus ----------
  // roots the view must show: slow view = the slow band, fast view = everything up to 3× the fastest aircraft mode
  function locusRoots() {
    const { fp, fl, clp, plantMax } = R, all = [...fp.p, ...fp.z, ...fl.p, ...fl.z, ...clp];
    const cut = S.view === 'slow' ? 0.3 * plantMax : 3 * plantMax;
    const sel = all.filter(z => Math.hypot(...z) < cut);
    return sel.length ? sel : all;
  }
  function drawLocus(c, Wd, Hd) {
    if (!R) return;
    const rs = dragging && frozen ? frozen : locusRoots(), pl = 52, pr = 14, pt = 12, pb = 36, iw = Wd - pl - pr, ih = Hd - pt - pb;
    if (!dragging) frozen = rs;
    const big = Math.max(0.02, ...rs.map(z => Math.hypot(...z)));
    let x0 = -1.2 * Math.max(0.15 * big, ...rs.map(z => -z[0])), x1 = 1.25 * Math.max(0.3 * big, ...rs.map(z => z[0]));
    let Y = 1.2 * Math.max(0.3 * big, ...rs.map(z => Math.abs(z[1])));
    // equal scales on both axes: widen whichever direction is short
    const kx = (x1 - x0) / iw, ky = 2 * Y / ih;
    if (ky > kx) { const add = (ky * iw - (x1 - x0)) / 2; x0 -= add; x1 += add; } else Y = kx * ih / 2;
    const Rr = Math.max(-x0, Y);
    const tr = axes(c, Wd, Hd, { pl, pr, pt, pb, x0, x1, y0: -Y, y1: Y, xlabel: 'Real part σ (1/s)', ylabel: 'Imaginary part ω (rad/s)', xfmt: v => f3(v), yfmt: v => f3(v) });
    locTr = tr;
    tr.clip();
    c.fillStyle = cssVar('--bad'); c.globalAlpha = 0.06; c.fillRect(tr.sx(0), pt, tr.sx(x1) - tr.sx(0), ih); c.globalAlpha = 1;
    tr.line([[0, -1e3], [0, 1e3]], cssVar('--border-strong'), 1.2); tr.line([[-1e3, 0], [1e3, 0]], cssVar('--border-strong'), 1);
    for (const z of [0.2, 0.4, 0.6, 0.8]) {
      const a = Math.acos(z), r = 3 * Rr;
      tr.line([[0, 0], [-r * Math.cos(a), r * Math.sin(a)]], cssVar('--text-3'), 0.8, [2, 4], 0.7); tr.line([[0, 0], [-r * Math.cos(a), -r * Math.sin(a)]], cssVar('--text-3'), 0.8, [2, 4], 0.7);
      const lx = -0.92 * Rr, ly = lx * -Math.tan(a);
      if (Math.abs(ly) < Y * 0.95) tr.text(lx, ly, `ζ ${z}`, cssVar('--text-3'), 'left', 'bottom', '10px');
    }
    const cols = ['--accent', '--good', '--turb', '--lower', '--warn', '--text-2'];
    R.branches.forEach((b, i) => tr.line(b.map(p => [p.re, p.im]), cssVar(cols[i % cols.length]), 1.8, null, 0.75));
    const t2 = cssVar('--text-2');
    c.lineWidth = 2; c.strokeStyle = t2;
    for (const z of R.fl.p) { const X = tr.sx(z[0]), Yp = tr.sy(z[1]); c.beginPath(); c.moveTo(X - 5, Yp - 5); c.lineTo(X + 5, Yp + 5); c.moveTo(X + 5, Yp - 5); c.lineTo(X - 5, Yp + 5); c.stroke(); }
    for (const z of R.fl.z) { c.beginPath(); c.arc(tr.sx(z[0]), tr.sy(z[1]), 5, 0, 2 * Math.PI); c.stroke(); }
    // label plant poles by mode (once per pair)
    const seenNames = new Set();
    for (const z of R.fl.p) { if (z[1] < 0) continue; const n = R.nameOf(z); if (seenNames.has(n)) continue; seenNames.add(n); if (tr.sx(z[0]) > pl && tr.sx(z[0]) < pl + iw && Math.abs(z[1]) < Y) tr.text(z[0], z[1], `  ${n}`, t2, 'left', 'bottom', '10.5px'); }
    for (const z of R.clp) tr.dot(z[0], z[1], z[0] > 0 ? cssVar('--bad') : cssVar('--warn'), 5.5);
    c.restore();
    c.fillStyle = cssVar('--text-3'); c.font = '10.5px ' + cssVar('--font'); c.textAlign = 'left'; c.textBaseline = 'top';
    c.textBaseline = 'bottom'; c.fillText(`branches: gain from 0 to ∞ · current ${S.type === 'lead' ? 'K' : 'Kp'} = ${f3(S.k)}`, pl + 6, pt + ih - 4);
  }
  // drag the closed-loop roots along the locus
  let dragging = false, frozen = null, raf = 0;   // the view stays put while dragging; one update per frame
  const pick = e => {
    if (!R || !locTr) return;
    const rect = loc.canvas.getBoundingClientRect(), X = e.clientX - rect.left, Y = e.clientY - rect.top;
    let best = null, bd = 18;
    for (const b of R.branches) for (const p of b) { if (!(p.k > 0)) continue; const d = Math.hypot(locTr.sx(p.re) - X, locTr.sy(p.im) - Y); if (d < bd) { bd = d; best = p; } }
    if (!best || !locus) return;
    S.k = Math.min(100, Math.max(0.01, locus.kRef * best.k)); S.ki = locus.ki * S.k; S.kd = locus.kd * S.k;
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; buildComp(); compute(); });
  };
  loc.canvas.style.touchAction = 'none'; loc.canvas.style.cursor = 'crosshair';
  loc.canvas.addEventListener('pointerdown', e => { dragging = true; loc.canvas.setPointerCapture(e.pointerId); pick(e); });
  loc.canvas.addEventListener('pointermove', e => { if (dragging) pick(e); });
  loc.canvas.addEventListener('pointerup', () => { dragging = false; loc.paint(); });

  // ---------- step response ----------
  function drawStep(c, Wd, Hd) {
    if (!R) return;
    const { y, u, L0, stable, dc } = R, H1 = Math.round(Hd * 0.58);
    const clipY = (vals, ref) => { const lim = 4 * Math.max(1, Math.abs(ref || 0)); let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals); lo = Math.max(lo, -lim); hi = Math.min(hi, lim); const pd = (hi - lo) * 0.08 || 0.1; return [lo - pd, hi + pd]; };
    const [a0, a1] = clipY([...y.y, 1], 1);
    const tr = axes(c, Wd, H1, { x0: 0, x1: S.T, y0: a0, y1: a1, xlabel: '', ylabel: `${L0.short} (${L0.unit} per ${L0.unit} commanded)`, pb: 22, xfmt: v => f3(v), yfmt: v => f3(v) });
    tr.clip();
    tr.line([[0, 1], [S.T, 1]], cssVar('--text-3'), 1.2, [5, 4]);
    if (stable && isFinite(dc)) { tr.line([[0, dc * 1.02], [S.T, dc * 1.02]], cssVar('--border'), 1, [2, 3]); tr.line([[0, dc * 0.98], [S.T, dc * 0.98]], cssVar('--border'), 1, [2, 3]); }
    tr.line(y.t.map((t, i) => [t, y.y[i]]), stable ? cssVar('--accent') : cssVar('--bad'), 2.4);
    c.restore();
    legend(c, tr, [[cssVar('--text-3'), 'command', [5, 4], 1.2], [stable ? cssVar('--accent') : cssVar('--bad'), stable ? 'closed loop' : 'closed loop (diverges)', null, 2.4]], tr.pl + tr.iw - 170);
    c.save(); c.translate(0, H1);
    const [b0, b1] = clipY(u.y, Math.max(...u.y.slice(0, 5).map(Math.abs)));
    const tb = axes(c, Wd, Hd - H1, { x0: 0, x1: S.T, y0: b0, y1: b1, xlabel: 'Time (s)', ylabel: `surface (°)`, pt: 8, xfmt: v => f3(v), yfmt: v => f3(v) });
    tb.clip(); tb.line([[0, 0], [S.T, 0]], cssVar('--border-strong'), 1);
    tb.line(u.t.map((t, i) => [t, u.y[i]]), cssVar('--good'), 2);
    c.restore(); c.restore();
  }

  // ---------- Bode ----------
  function drawBode(c, Wd, Hd) { if (R) drawBodeL(c, Wd, Hd, R.L, R.mg); }

  // ---------- Nyquist ----------
  function drawNyquist(c, Wd, Hd) {
    if (!R) return;
    const { L, fl, mg, clp, olUnstable } = R;
    const comp = ([x, y]) => { const r = Math.hypot(x, y); if (!(r > 0)) return [0, 0]; const rr = r <= 1 ? r : Math.min(4, 1 + Math.log10(r)); return [x / r * rr, y / r * rr]; };
    const pts = Ct.freqGrid(fl, 1e-4, 1e4, 900).map(w => comp(Ct.freqResp(L, w))), n = pts.length - 3;
    const ext = Math.max(1.6, ...pts.map(p => Math.hypot(...p))) * 1.08;
    const pl = 46, pr = 14, pt = 12, pb = 36, iw = Wd - pl - pr, ih = Hd - pt - pb;
    const ax = iw / ih >= 1 ? [ext * iw / ih, ext] : [ext, ext * ih / iw];
    const tr = axes(c, Wd, Hd, { pl, pr, pt, pb, x0: -ax[0], x1: ax[0], y0: -ax[1], y1: ax[1], xlabel: 'Real part (compressed above 1)', ylabel: 'Imaginary part', xfmt: v => f3(v), yfmt: v => f3(v) });
    tr.clip();
    tr.line([[-10, 0], [10, 0]], cssVar('--border-strong'), 1); tr.line([[0, -10], [0, 10]], cssVar('--border-strong'), 1);
    const circ = (r, col, dash) => tr.line(Array.from({ length: 121 }, (_, i) => [r * Math.cos(i / 120 * 2 * Math.PI), r * Math.sin(i / 120 * 2 * Math.PI)]), col, 1, dash);
    circ(1, cssVar('--text-3'), [3, 3]); circ(2, cssVar('--border'), [2, 4]); circ(3, cssVar('--border'), [2, 4]);
    tr.text(0, -2, ' |L| = 10', cssVar('--text-3'), 'left', 'top', '10px'); tr.text(0, -3, ' 100', cssVar('--text-3'), 'left', 'top', '10px');
    tr.line(pts.map(([x, y]) => [x, -y]), cssVar('--accent'), 1.4, [5, 4], 0.6);
    tr.line(pts, cssVar('--accent'), 2.2);
    // direction arrows at a few points
    c.fillStyle = cssVar('--accent');
    for (const f of [0.3, 0.5, 0.7]) {
      const i = Math.floor(f * n), [xa, ya] = pts[i], [xb, yb] = pts[i + 2]; const a = Math.atan2(tr.sy(yb) - tr.sy(ya), tr.sx(xb) - tr.sx(xa)), X = tr.sx(xa), Y = tr.sy(ya);
      if (Math.hypot(tr.sx(xb) - X, tr.sy(yb) - Y) < 0.5) continue;
      c.beginPath(); c.moveTo(X + 7 * Math.cos(a), Y + 7 * Math.sin(a)); c.lineTo(X + 7 * Math.cos(a + 2.5), Y + 7 * Math.sin(a + 2.5)); c.lineTo(X + 7 * Math.cos(a - 2.5), Y + 7 * Math.sin(a - 2.5)); c.fill();
    }
    tr.dot(-1, 0, cssVar('--bad'), 5); tr.text(-1, 0, '−1 ', cssVar('--bad'), 'right', 'bottom', '600 11px');
    c.restore();
    const Z = clp.filter(z => z[0] > 0).length;
    c.fillStyle = cssVar('--text-2'); c.font = '11px ' + cssVar('--font'); c.textAlign = 'left'; c.textBaseline = 'top';
    c.fillText(`P = ${olUnstable} unstable open-loop pole${olUnstable === 1 ? '' : 's'} → needs ${olUnstable} anticlockwise encirclement${olUnstable === 1 ? '' : 's'} of −1`, pl + 6, pt + 4);
    c.fillText(`Z = ${Z} unstable closed-loop pole${Z === 1 ? '' : 's'}${Z ? ' (criterion not met)' : ' (criterion met)'}`, pl + 6, pt + 20);
  }

  // ---------- equations ----------
  function factorsText(rs) {
    const out = [];
    for (const [re, im] of rs) {
      if (im < 0) continue;
      if (im === 0) out.push(Math.abs(re) < 1e-7 ? 's' : `(s ${sgn(-re)} ${f3(Math.abs(re))})`);
      else { const b = -2 * re, w2 = re * re + im * im; out.push(`(s² ${sgn(b)} ${f3(Math.abs(b))}s + ${f3(w2)})`); }
    }
    return out.join(' ') || '1';
  }
  function tfText(f) { return `${f3(f.k)} · ${factorsText(f.z)} / [${factorsText(f.p)}]`; }
  function equations() {
    const { pl, L0, fp, clp, nameOf, C } = R;
    const cText = { P: `C(s) = ${f3(S.k)}`, PI: `C(s) = ${f3(S.k)} + ${f3(S.ki)}/s`, PID: `C(s) = ${f3(S.k)} + ${f3(S.ki)}/s + ${f3(S.kd)}s/(0.02s + 1)`, lead: `C(s) = ${f3(S.k)} (s/${f3(S.z)} + 1)/(s/${f3(S.p)} + 1)` }[S.type];
    const parts = [S.act ? `A(s) = ${S.wa.toFixed(0)}/(s + ${S.wa.toFixed(0)})` : null, S.wash ? `W(s) = ${f3(S.tw)}s/(${f3(S.tw)}s + 1)` : null, S.delay > 0 ? `e^(−${(S.delay / 1000).toFixed(3)}s) ≈ Padé (1 − sT/2 + s²T²/12)/(1 + sT/2 + s²T²/12)` : null].filter(Boolean);
    const row = (z, extra) => { const d = Ct.damping(z); return h('tr', {}, h('td', { style: { textAlign: 'left', fontFamily: 'var(--font)' } }, extra), h('td', {}, `${f3(z[0])}${z[1] ? ' ± ' + f3(Math.abs(z[1])) + 'j' : ''}`), h('td', {}, z[1] ? f3(d.wn) : '—'), h('td', {}, z[1] ? d.zeta.toFixed(3) : '—'), h('td', {}, z[0] > 0 ? `doubles ${f3(Math.LN2 / z[0])} s` : z[0] < 0 ? (z[1] ? `period ${f3(2 * Math.PI / Math.abs(z[1]))} s` : `τ ${f3(-1 / z[0])} s`) : 'neutral')); };
    const tbl = (title, rs, name) => h('div', {}, h('h4', { style: { margin: '10px 0 4px' } }, title), h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ...['', 'root', 'ωn', 'ζ', ''].map(x => h('th', {}, x)))), h('tbody', {}, ...rs.filter(z => z[1] >= 0).map(z => row(z, name(z))))));
    eqHost.replaceChildren(
      h('p', {}, `1. The aircraft from ${L0.input} to ${L0.short}, from the small-disturbance state matrices: G(s) = C(sI − A)⁻¹B${pl.D ? ' + D' : ''}, in ${L0.unit} per degree.`),
      h('span', { class: 'eq' }, `G(s) = ${tfText(fp)}`),
      h('p', {}, '2. The compensator and hardware in the loop:'),
      h('span', { class: 'eq', html: [cText, ...parts].join('<br>') }),
      h('p', {}, `3. Going once round the loop, L(s) = C·${S.act ? 'A·' : ''}G${S.wash || S.delay ? '·H' : ''}; the closed-loop roots solve 1 + L(s) = 0, a polynomial of order ${R.T.den.length - 1}.`),
      h('span', { class: 'eq' }, `y/r = C${S.act ? 'A' : ''}G / (1 + L)`),
      tbl('Open-loop poles (the aircraft alone)', fp.p, nameOf),
      tbl('Closed-loop roots', clp, z => (z[0] > 0 ? 'unstable' : Math.hypot(...z) > Math.sqrt(R.plantMax * R.plantMin) ? 'fast' : 'slow')),
    );
  }

  // ---------- insights ----------
  function insights() {
    const { stable, olUnstable, fp, clp, mg, mg0, L0, si, dc, cl, ol, pl } = R, list = [];
    const unst = clp.filter(z => z[0] > 0);
    const zeroAtOrigin = fp.z.some(z => Math.hypot(...z) < 1e-6);
    if (!stable) {
      const slow = unst.every(z => Math.LN2 / z[0] > 8);
      if (olUnstable && L0.id === 'q' && zeroAtOrigin && slow) list.push({ type: 'b', t: 'Pitch-rate feedback only slows the divergence', d: `The fast divergence is gone, but one root is left creeping out (doubling in ${f3(Math.LN2 / unst[0][0])} s). q/δe has a zero at the origin, and as the gain rises the unstable pole slides towards that zero without ever crossing into the left half plane. Feedback of angle of attack (or nz) supplies the missing pitch stiffness: switch the loop to α.` });
      else if (olUnstable && R.mg.gmDown === null && unst.length && S.k < 0.2) list.push({ type: 'b', t: 'Not enough gain to stabilise the aircraft', d: 'The aircraft diverges on its own, and the loop is too weak to hold it. Raise the gain until the right-half-plane root crosses the imaginary axis on the root locus.' });
      else if (L0.axis === 'lat' && slow && unst.every(z => !z[1])) list.push({ type: 'w', t: `Only a slow spiral divergence (doubling in ${f3(Math.LN2 / Math.max(...unst.map(z => z[0])))} s)`, d: `The fast modes are fine, but the loop has pulled the spiral root just into the right half plane${fp.z.some(z => z[0] > 0 && !z[1]) ? `, towards a right-half-plane zero of ${L0.short}/${L0.input} at +${f3(fp.z.find(z => z[0] > 0 && !z[1])[0])} rad/s` : ''}. A pilot (or the heading and bank loops of an autopilot) corrects a divergence this slow without noticing; lower the gain to avoid it.` });
      else list.push({ type: 'b', t: 'The closed loop is unstable', d: `${unst.length} closed-loop root${unst.length > 1 ? 's are' : ' is'} in the right half plane. ${mg.pm && mg.pm.pmDeg < 0 ? 'The phase margin is negative: at crossover the fed-back signal arrives more than half a cycle late and reinforces the error.' : 'Look at where the roots crossed the imaginary axis on the root locus: lower (or raise) the gain to bring them back.'}` });
    } else if (olUnstable) list.push({ type: 'g', t: 'An unstable aircraft, made stable by feedback', d: `On its own the aircraft has ${olUnstable} right-half-plane pole${olUnstable > 1 ? 's' : ''}; with the loop closed every root decays. The loop is <b>conditionally stable</b>: ${mg.gmDown ? `lower the gain by more than ${f3(mg.gmDown.db)} dB and it diverges again` : 'too little gain and it diverges again'}, so a flight computer failure here means losing the aircraft. That is why fly-by-wire fighters carry three or four redundant channels.` });
    if (stable && olUnstable && L0.id === 'alpha' && cl && !cl.real && cl.zeta < 0.35) list.push({ type: 'w', t: 'Stiffness without damping', d: `α feedback puts back the pitch stiffness the aft CG removed, but adds no damping: the short period is left at ζ ${cl.zeta.toFixed(2)}. Real fly-by-wire laws feed back pitch rate as well as α (or nz), which is the next tab, Augmentation & FBW.` });
    if (stable && mg.pm) {
      if (mg.pm.pmDeg < 30) list.push({ type: 'w', t: `Thin phase margin (${f3(mg.pm.pmDeg)}°)`, d: 'The response will overshoot and ring, and a little extra delay or an actuator slower than expected would make it oscillate. Lower the gain, or add lead.' });
      else if (mg.pm.pmDeg >= 45) list.push({ type: 'g', t: `Healthy phase margin (${f3(mg.pm.pmDeg)}°)`, d: `Crossover at ${f3(mg.pm.w)} rad/s; the loop could take another ${f3(mg.pm.delay * 1000)} ms of delay before it oscillated.` });
    }
    if (stable && mg.gmUp && mg.gmUp.gmDb < 6) list.push({ type: 'w', t: `Small gain margin (${f3(mg.gmUp.gmDb)} dB)`, d: `Raising the gain by a factor ${f3(10 ** (mg.gmUp.gmDb / 20))} would put a root on the imaginary axis at ${f3(mg.gmUp.w)} rad/s. Military specifications ask for at least 6 dB.` });
    if (mg0 && mg0.pm && mg.pm) list.push({ type: 'i', t: `The ${S.delay} ms delay costs ${f3(mg0.pm.pmDeg - mg.pm.pmDeg)}° of phase margin`, d: `A delay T adds phase lag ωT that grows with frequency: at the ${f3(mg.pm.w)} rad/s crossover that is ${f3(mg.pm.w * S.delay / 1000 * DEG)}°. Fast loops need fast computers.` });
    if (S.act && mg.pm && mg.pm.w > S.wa / 3) list.push({ type: 'w', t: 'Crossover close to the actuator bandwidth', d: `The loop crosses over at ${f3(mg.pm.w)} rad/s, within a factor 3 of the ${S.wa.toFixed(0)} rad/s actuator: its lag eats phase margin and its rate limit will be hit in large manoeuvres.` });
    if (cl && ol && !cl.real && cl.zeta > ol.zeta + 0.05) list.push({ type: 'g', t: `Damping raised from ζ ${ol.zeta.toFixed(2)} to ${cl.zeta.toFixed(2)}`, d: `This is what a ${L0.role} is for: the feedback adds artificial ${L0.axis === 'lon' ? 'pitch' : L0.id === 'p' || L0.id === 'phi' ? 'roll' : 'yaw'} damping, so the mode dies out in fewer cycles.` });
    if (stable && L0.id === 'q' && zeroAtOrigin && Math.abs(dc) < 0.05) list.push({ type: 'i', t: 'A damper, not a command system', d: 'With a pure gain the steady pitch rate goes back to zero: q/δe has a zero at the origin (a steady elevator gives a steady pitch angle, not a steady pitch rate). That is fine for a damper. A pitch-rate command system adds an integrator (PI) so the pilot\'s stick commands a rate that is held.' });
    if (stable && !S.wash && !olUnstable && (S.type === 'P' || S.type === 'lead') && isFinite(dc) && Math.abs(dc) > 0.05 && Math.abs(1 - dc) > 0.03 && ['theta', 'phi', 'alpha', 'nz', 'beta'].includes(L0.id)) list.push({ type: 'i', t: `Steady error: the output settles at ${f3(dc)} of the command`, d: `With proportional feedback some error must remain to hold the surface deflection: e = 1/(1 + L(0)). Raise the gain to shrink it, or add integral action (PI), which keeps adding deflection until the error is zero.` });
    if (L0.id === 'r' && !S.wash) list.push({ type: 'w', t: 'This yaw damper fights every turn', d: 'In a steady turn the yaw rate is not zero, so a plain yaw-rate damper applies rudder against the turn. A washout filter on the yaw-rate signal passes the Dutch-roll oscillation but blocks the steady turn rate.' });
    if (L0.id === 'nz' && fp.z.some(z => z[0] > 0)) list.push({ type: 'i', t: 'A right-half-plane zero: the response starts the wrong way', d: `To pull up, the tail first pushes down, so the aircraft's centre of gravity briefly accelerates downward before the lift builds. That zero at +${f3(fp.z.find(z => z[0] > 0)[0])} rad/s caps how fast an nz loop can be made: high gain drives a root towards it.` });
    if (!list.length) list.push({ type: 'i', t: 'Try changing the gain', d: 'Drag the closed-loop roots on the root locus and watch the step response, margins and Nyquist curve change together.' });
    insightsList(ins, list);
  }

  const offU = onUnits(() => { acSec.rebuild(); cond.rebuild(); schedule(); });
  compute();
  return {
    controls, main,
    show: () => { if (seen !== perf.version) { acSec.rebuild(); cond.rebuild(); des.rebuild(); compute(); } else [blk, loc, stp, bod, nyq].forEach(x => x.paint()); },
    destroy: () => { offU(); clearTimeout(timer); cancelAnimationFrame(raf); },
  };
}
