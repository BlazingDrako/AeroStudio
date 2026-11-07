// Autopilots tab: pick modes (altitude, level change, vertical speed, pitch or speed on elevator; autothrottle; heading
// or bank hold), give new targets, tune every gain, and watch the autopilot fly it on a primary flight display with
// mode annunciators and a moving map. Time histories compare against a second run (anti-windup flipped, autothrottle
// off, another mode, the default gains); the loop table gives every loop's crossover and margins, inner to outer.
import { h, section, slider, segmented, toggle, select, field, cssVar, icon } from '../../lib/ui.js';
import * as St from '../../solvers/stability.js';
import * as Ct from '../../solvers/control.js';
import * as Ap from '../../solvers/autopilot.js';
import * as Pf from '../../solvers/performance.js';
import { SEVERITY, geopotential } from '../../solvers/atmosphere.js';
import { card, metricsGrid, insightsList, onUnits, unit, toDisp, fromDisp, units, num, canvasBox } from '../flight/common.js';
import { perf, aircraftSection, conditionSection, designSection, stabInput, axes, legend, setAircraft, changed } from '../flight/perfShared.js';
import { drawBode, topView, f3 } from './plots.js';

const DEG = 180 / Math.PI, D = Math.PI / 180, FT = 0.3048, KT = 0.514444, FPM = FT / 60;
const PITCH = [{ value: 'alt', label: 'ALT' }, { value: 'flch', label: 'FLCH' }, { value: 'vs', label: 'V/S' }, { value: 'pitch', label: 'PITCH' }, { value: 'speed', label: 'SPD' }];
const LATM = [{ value: 'hdg', label: 'HDG' }, { value: 'bank', label: 'ROLL' }, { value: 'off', label: 'OFF' }];
const CMP = [{ value: 'none', label: 'Nothing' }, { value: 'aw', label: 'Anti-windup switched' }, { value: 'noat', label: 'Autothrottle off' }, { value: 'alt', label: 'Altitude hold instead' }, { value: 'flch', label: 'Level change instead' }, { value: 'def', label: 'Default gains' }, { value: 'noyd', label: 'Yaw damper off' }];
const TGT0 = { dh: 0, vs: 0, dth: 0, dV: 0, dpsi: 0, phi: 0 };
const SCENARIOS = [
  { value: '', label: 'Choose a scenario…' },
  { value: 'vs', label: 'Airliner at FL350: climb 2,000 ft on V/S', ac: 'a320', s: { pitch: 'alt', thr: 'speed', lat: 'hdg', tgt: { dh: 2000 * FT }, T: 240, cmp: 'flch' } },
  { value: 'flch', label: 'Airliner: idle descent of 4,000 ft (level change)', ac: 'a320', s: { pitch: 'flch', thr: 'speed', lat: 'hdg', tgt: { dh: -4000 * FT }, T: 120, cmp: 'alt' } },
  { value: 'turn', label: 'Light single: turn 90° to a new heading', ac: 'c172', s: { pitch: 'alt', thr: 'speed', lat: 'hdg', tgt: { dpsi: 90 * D }, T: 60, cmp: 'noyd' } },
  { value: 'sag', label: 'Light single: 25° bank on pitch hold', ac: 'c172', s: { pitch: 'pitch', thr: 'speed', lat: 'bank', tgt: { phi: 25 * D }, T: 60, cmp: 'alt' } },
  { value: 'windup', label: 'Light single: long climb and integrator windup', ac: 'c172', s: { pitch: 'alt', thr: 'speed', lat: 'hdg', tgt: { dh: 2000 * FT }, T: 240, aw: false, cmp: 'aw' } },
  { value: 'combo', label: 'Drone: climbing turn with a speed change', ac: 'cca', s: { pitch: 'alt', thr: 'speed', lat: 'hdg', tgt: { dh: 1000 * FT, dpsi: 90 * D, dV: 10 * KT }, T: 120, cmp: 'def' } },
  { value: 'turb', label: 'Airliner: altitude hold in severe turbulence', ac: 'a320', s: { pitch: 'alt', thr: 'speed', lat: 'hdg', tgt: {}, T: 120, turb: 'severe', cmp: 'noyd' } },
  { value: 'glider', label: 'Sailplane: speed on the elevator, then a turn', ac: 'glider', s: { pitch: 'speed', thr: 'speed', lat: 'hdg', tgt: { dV: 10 * KT, dpsi: 180 * D }, T: 120, cmp: 'none' } },
  { value: 'f16', label: 'Fighter: autopilot over its stability augmentation', ac: 'f16', s: { pitch: 'flch', thr: 'speed', lat: 'hdg', tgt: { dh: 5000 * FT, dpsi: -120 * D }, T: 120, cmp: 'alt' } },
];

export function autopilotTab({ keep = o => o } = {}) {
  const S = keep({ pitch: 'alt', thr: 'speed', lat: 'hdg', tgt: { ...TGT0, dh: 1000 * FT, dpsi: 90 * D }, T: 120, turb: 'off', cmp: 'none', aw: true, wa: 20, rate: 60, playing: true, speed: 4, loopSel: null, g: null, gFor: null });
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });
  let R = null, seen = -1;

  // ---------- controls ----------
  const scSec = section('Try a scenario');
  const scSel = select(SCENARIOS.map(({ value, label }) => ({ value, label })), '', v => applyScenario(v));
  scSec.body.append(scSel, h('div', { class: 'hint' }, 'Each sets the aircraft, the modes and the targets, and picks a second run to compare with.'));
  const acSec = aircraftSection(src => { if (src === 'aircraft') { cond.rebuild(); des.rebuild(); S.g = null; } schedule(); });
  const cond = conditionSection(() => { S.g = null; schedule(); });
  const des = designSection(() => schedule());
  const modeSec = section('Autopilot modes'), tgtSec = section('New targets (at t = 2 s)'), gainSec = section('Tune the loops', { collapsible: true, collapsed: true }), runSec = section('Run');
  controls.append(scSec.el, modeSec.el, tgtSec.el, runSec.el, gainSec.el, acSec.el, cond.el, des.el);

  const sl = (label, min, max, step, get, set, opts = {}) => slider({ label, min, max, step, value: get(), format: opts.fmt || (v => f3(+v)), info: opts.info, log: opts.log, onInput: v => { set(+v); schedule(); } }).el;
  const noEngine = () => Pf.byId(perf.id).engine === 'none';
  function buildModes() {
    const ne = noEngine();
    if (ne) { if (['alt', 'flch', 'vs'].includes(S.pitch)) S.pitch = 'speed'; S.thr = 'off'; }
    const p = segmented(PITCH.filter(o => !ne || ['pitch', 'speed'].includes(o.value)), S.pitch, v => { S.pitch = v; if (v === 'speed') S.thr = 'off'; buildModes(); buildTargets(); schedule(); });
    const t = segmented([{ value: 'speed', label: 'SPEED' }, { value: 'off', label: 'MANUAL' }], S.thr, v => { S.thr = v; if (v === 'speed' && S.pitch === 'speed') S.pitch = 'alt'; buildModes(); buildTargets(); schedule(); });
    const l = segmented(LATM, S.lat, v => { S.lat = v; buildTargets(); schedule(); });
    modeSec.body.replaceChildren(
      field('Pitch', p.el, 'ALT: capture and hold an altitude, climbing at up to the vertical-speed limit. FLCH (level change): fixed climb or idle thrust with the elevator holding speed, then capture. V/S: hold a vertical speed. PITCH: hold an attitude. SPD: hold airspeed with the elevator (no engine needed).'),
      ne ? h('div', { class: 'hint' }, 'No engine: speed is held with the elevator, and height cannot be held.') : field('Thrust', t.el, 'SPEED: an autothrottle holds airspeed through the engine\'s spool-up lag. MANUAL: the throttle stays where trim put it.'),
      field('Lateral', l.el, 'HDG: turn to and hold a heading (the bank is limited). ROLL: hold a bank angle. OFF: only the roll damper and yaw damper.'));
  }
  function buildTargets() {
    const items = [], au = unit('alt').u, su = unit('speed').u;
    if (S.pitch === 'alt' || S.pitch === 'flch') items.push(sl(`Altitude change (${au})`, Math.round(toDisp('alt', -6000 * FT)), Math.round(toDisp('alt', 6000 * FT)), units() === 'us' ? 100 : 50, () => toDisp('alt', S.tgt.dh), v => { S.tgt.dh = fromDisp('alt', v); }, { fmt: v => num(+v, 0) }));
    if (S.pitch === 'vs') items.push(sl(`Vertical speed (${units() === 'us' ? 'ft/min' : 'm/s'})`, units() === 'us' ? -4000 : -20, units() === 'us' ? 4000 : 20, units() === 'us' ? 100 : 0.5, () => (units() === 'us' ? S.tgt.vs / FPM : S.tgt.vs), v => { S.tgt.vs = units() === 'us' ? v * FPM : v; }, { fmt: v => num(+v, units() === 'us' ? 0 : 1) }));
    if (S.pitch === 'pitch') items.push(sl('Pitch change (°)', -10, 10, 0.5, () => S.tgt.dth * DEG, v => { S.tgt.dth = v * D; }));
    if (S.thr === 'speed' || S.pitch === 'speed' || S.pitch === 'flch') items.push(sl(`Speed change (${su})`, Math.round(toDisp('speed', -30 * KT)), Math.round(toDisp('speed', 30 * KT)), 1, () => toDisp('speed', S.tgt.dV), v => { S.tgt.dV = fromDisp('speed', v); }, { fmt: v => num(+v, 0) }));
    if (S.lat === 'hdg') items.push(sl('Heading change (°)', -270, 270, 5, () => S.tgt.dpsi * DEG, v => { S.tgt.dpsi = v * D; }, { fmt: v => num(+v, 0), info: 'The autopilot turns the short way round: +270° is flown as a 90° left turn.' }));
    if (S.lat === 'bank') items.push(sl('Bank angle (°)', -45, 45, 1, () => S.tgt.phi * DEG, v => { S.tgt.phi = v * D; }, { fmt: v => num(+v, 0) }));
    tgtSec.body.replaceChildren(...items);
  }
  function buildRun() {
    const tb = segmented([{ value: 'off', label: 'Off' }, ...SEVERITY.map(s => ({ value: s.id, label: s.label }))], S.turb, v => { S.turb = v; schedule(); });
    const tSeg = segmented([30, 60, 120, 240].map(t => ({ value: t, label: `${t} s` })), S.T, v => { S.T = v; schedule(); });
    const cmp = select(CMP, S.cmp, v => { S.cmp = v; schedule(); });
    runSec.body.replaceChildren(field('Compare with', cmp, 'A second run drawn dashed on the time histories and as a ghost on the map.'), field('Turbulence (Dryden)', tb.el), field('Duration', tSeg.el),
      toggle('Integrator anti-windup', S.aw, v => { S.aw = v; schedule(); }, { tip: 'Stop each integrator while its loop\'s output is at a limit (throttle full, pitch or bank limit). Without it the integrator keeps charging and the aircraft overshoots once the limit is released.' }).el,
      sl('Elevator rate limit (°/s)', 5, 120, 1, () => S.rate, v => { S.rate = v; }, { fmt: v => num(+v, 0) }));
  }
  // gains in friendly units: [label, key, scale (display = SI × scale), min, max, info]
  const GAINS = () => [
    ['Pitch inner loop'],
    ['Kθ: elevator per pitch error (°/°)', 'Kth', 1, 0, 8], ['Kq: pitch damping (° per °/s)', 'Kq', 1, 0, 2], ['Kα: α feedback (°/°)', 'Ka', 1, 0, 2, 'Needed only for an airframe that is unstable on its own (the fighter).'],
    ['Altitude and vertical speed'],
    ['Kh: climb rate per height error (ft/min per ft)', 'Kh', 60, 0, 60, 'Vertical-speed command = Kh × height error, limited. Small Kh: a gentle capture far from the target.'], ['Kvs: pitch per climb-rate error (° per 100 ft/min)', 'Kvs', DEG * 100 * FPM, 0, 3], ['Kvs,i: integral (° per 100 ft/min per s)', 'Kvsi', DEG * 100 * FPM, 0, 1],
    ['Vertical-speed limit (ft/min)', 'vsMax', 1 / FPM, 100, 6000], ['Pitch limit (°)', 'thMax', DEG, 3, 30],
    ['Speed'],
    ['Autothrottle KV (% throttle per kt)', 'KV', 100 * KT, 0, 30], ['Autothrottle integral (% per kt·s)', 'KVi', 100 * KT, 0, 5], ['Speed on elevator (° per kt)', 'KVp', DEG * KT, 0, 2], ['Speed on elevator, integral (° per kt·s)', 'KVpi', DEG * KT, 0, 0.5],
    ['Bank and heading'],
    ['Kφ: aileron per bank error (°/°)', 'Kphi', 1, 0, 8], ['Kp: roll damping (° per °/s)', 'Kp', 1, 0, 2], ['Kψ: bank per heading error (°/°)', 'Kpsi', 1, 0, 15, 'Its crossover is about Kψ·g/V: a fast aircraft needs a larger Kψ.'], ['Kψ,i: heading integral (° per °·s)', 'Kpsii', 1, 0, 0.5], ['Bank limit (°)', 'phiMax', DEG, 5, 45],
    ['Yaw damper'],
    ['Kr: rudder per yaw rate (° per °/s)', 'Kr', 1, 0, 5], ['Washout τ (s)', 'tw', 1, 0, 10], ['Kβ: rudder per sideslip (°/°)', 'Kb', 1, 0, 4],
  ];
  function buildGains() {
    const items = [];
    for (const row of GAINS()) {
      if (row.length === 1) { items.push(h('h4', { style: { margin: '10px 0 2px', fontSize: '12px', color: 'var(--text-2)' } }, row[0])); continue; }
      const [label, k, sc, mn, mx, info] = row;
      items.push(sl(label, mn, mx, (mx - mn) / 400, () => S.g[k] * sc, v => { S.g[k] = v / sc; }, { info }));
    }
    items.push(h('button', { class: 'btn', type: 'button', onclick: () => { S.g = null; compute(); buildGains(); } }, icon('reset', 14), 'Default gains for this aircraft'));
    gainSec.body.replaceChildren(...items);
  }
  buildModes(); buildTargets(); buildRun();

  function applyScenario(v) {
    const sc = SCENARIOS.find(x => x.value === v); if (!sc || !sc.ac) return;
    if (perf.id !== sc.ac) { setAircraft(sc.ac); changed('aircraft'); } else { perf.cg = St.GEOMETRY[sc.ac].cg[2]; changed('cg'); }
    acSec.rebuild(); cond.rebuild(); des.rebuild();
    Object.assign(S, { turb: 'off', aw: true, cmp: 'none', rate: 60 }, sc.s, { tgt: { ...TGT0, ...sc.s.tgt } });
    S.g = null; buildModes(); buildTargets(); buildRun(); compute();
  }

  // ---------- main area ----------
  const metrics = metricsGrid();
  const playBtn = h('button', { class: 'btn', type: 'button', onclick: () => { S.playing = !S.playing; paintPlay(); if (S.playing) { S.t0 = performance.now() - (S.tp || 0) * 1000 / S.speed; loop(); } else S.tp = animTime(); } });
  const paintPlay = () => playBtn.replaceChildren(icon(S.playing ? 'pause' : 'play', 14), S.playing ? 'Pause' : 'Play');
  const replay = h('button', { class: 'btn', type: 'button', onclick: () => { S.t0 = performance.now(); S.tp = 0; if (!S.playing) { S.playing = true; paintPlay(); } loop(); } }, icon('reset', 14), 'Replay');
  const spSeg = segmented([1, 4, 10].map(v => ({ value: v, label: `×${v}` })), S.speed, v => { const t = animTime(); S.speed = v; S.t0 = performance.now() - t * 1000 / v; });
  paintPlay();
  const pfd = canvasBox('330px', drawPFD, 'flt-scene'), map = canvasBox('330px', drawMap);
  const flyCard = h('div', { class: 'plot-card' }, h('div', { class: 'plot-head' }, h('h4', {}, 'Primary flight display and map'), h('div', { class: 'row' }, spSeg.el, replay, playBtn)), h('div', { class: 'flt-grid2e' }, pfd.el, map.el),
    h('div', { class: 'hint', style: { marginTop: '4px' } }, 'Top row of the display: the active modes (thrust, pitch, lateral), with the next mode armed in blue. Magenta bugs mark the targets. The map is north-up; the dashed ghost is the comparison run.'));
  const hist = canvasBox('520px', drawHist);
  const histCard = card('Time histories', 'Solid: this run. Dashed grey: the comparison. Dotted: the targets.', hist.el);
  const loopHost = h('div');
  const bod = canvasBox('340px', (c, W, H) => { if (R && R.selLoop) drawBode(c, W, H, R.selLoop.L, R.selLoop.mg); });
  const loopCard = card('The loops, inner to outer', 'Each loop broken in turn with every other loop closed (successive loop closure). Click a row to see its Bode plot. A cascade works when each inner loop is several times faster than the loop around it.', loopHost, bod.el);
  const eqCard = card('The control laws'); const eqHost = h('div'); eqCard.append(eqHost);
  const insCard = card('What is happening here'); const ins = h('div'); insCard.append(ins);
  main.append(metrics.el, flyCard, histCard, h('div', { class: 'flt-grid2' }, loopCard, h('div', {}, insCard, eqCard)));

  let timer = 0;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(compute, 40); };

  // ---------- compute ----------
  function compute() {
    const inp = stabInput(), an = St.analyse(inp), ac = Pf.byId(perf.id), eng = Ap.engineOf(an, ac, perf.rating);
    const def = Ap.defaults(perf.id, an, eng), key = perf.id + ':' + perf.version;
    if (!S.g || S.gFor !== perf.id) { S.g = { ...def }; S.gFor = perf.id; buildGains(); }
    if (eng.none && S.thr === 'speed') S.thr = 'off';
    const mk = (o = {}) => ({ pitch: S.pitch, thr: S.thr, lat: S.lat, g: S.g, wa: S.wa, taue: eng.lag, antiWindup: S.aw, ...o });
    const ap = mk(), sev = SEVERITY.find(s => s.id === S.turb);
    const cmds = t => (t >= 2 ? S.tgt : TGT0);
    const run = a => Ap.simulate(an, ac, eng, a, { T: S.T, dt: S.T > 120 ? 0.02 : 0.01, cmds, gust: sev ? { W20: sev.W20, h: perf.z, seed: 4 } : null, hw: { wa: S.wa, rate: S.rate * D, pos: 25 * D } });
    const sim = run(ap);
    let cmp = null, cmpLabel = '';
    const C = { aw: [{ antiWindup: !S.aw }, S.aw ? 'without anti-windup' : 'with anti-windup'], noat: [{ thr: 'off' }, 'autothrottle off'], alt: [{ pitch: eng.none ? 'speed' : 'alt' }, eng.none ? 'speed on elevator' : 'altitude hold'], flch: [{ pitch: eng.none ? 'speed' : 'flch' }, 'level change'], def: [{ g: def }, 'default gains'], noyd: [{ g: { ...S.g, Kr: 0, Kb: 0 } }, 'no yaw damper'] }[S.cmp];
    if (C) { cmp = run(mk(C[0])); cmpLabel = C[1]; }
    const A = Ap.analyse(an, eng, ap);
    R = { an, ac, eng, ap, sim, cmp, cmpLabel, A, def, cmds };
    const loops = [...Object.entries(A.lon).filter(([k]) => k !== 'roots').map(([k, v]) => ({ k, ax: 'lon', ...v })), ...Object.entries(A.lat).filter(([k]) => k !== 'roots').map(([k, v]) => ({ k, ax: 'lat', ...v }))];
    R.loops = loops; R.selLoop = loops.find(l => l.ax + l.k === S.loopSel) || loops[0];
    seen = perf.version;
    S.t0 = performance.now(); S.tp = 0;
    setMetrics(); loopTable(); hist.paint(); bod.paint(); map.paint(); equations(); insights(); loop();
  }

  const lastOf = rec => rec.x[rec.x.length - 1];
  function captureTime(rec, k, target, tol) { const I = rec.I; let tc = null; for (let i = rec.t.length - 1; i >= 0; i--) { if (Math.abs(rec.x[i][I[k]] - target) > tol) { tc = i < rec.t.length - 1 ? rec.t[i + 1] : null; break; } if (i === 0) tc = 0; } return tc; }
  function setMetrics() {
    const { sim, A, loops } = R, I = sim.I, x = lastOf(sim), list = [];
    const stable = ['lon', 'lat'].every(ax => A[ax].roots.every(z => z[0] < 2e-3));
    const worst = loops.filter(l => l.mg.pm).sort((a, b) => a.mg.pm.pmDeg - b.mg.pm.pmDeg)[0];
    list.push({ k: 'All loops', v: stable ? 'stable' : 'UNSTABLE', s: worst ? `weakest: ${worst.label.toLowerCase()} ${f3(worst.mg.pm.pmDeg)}°` : '', cls: stable ? (worst && worst.mg.pm.pmDeg < 30 ? 'warn' : '') : 'bad' });
    if (S.pitch === 'alt' || S.pitch === 'flch') { const tc = captureTime(sim, 'h', S.tgt.dh, 20 * FT); list.push({ k: 'Altitude', v: `${num(toDisp('alt', x[I.h]), 0)} ${unit('alt').u}`, s: `target ${num(toDisp('alt', S.tgt.dh), 0)} · ${tc === null ? 'not captured' : `within 20 ft after ${f3(Math.max(0, tc - 2))} s`}`, cls: tc === null ? 'warn' : '' }); }
    else list.push({ k: 'Height change', v: `${num(toDisp('alt', x[I.h]), 0)} ${unit('alt').u}`, s: `range ${num(toDisp('alt', Math.min(...sim.x.map(q => q[I.h]))), 0)} to ${num(toDisp('alt', Math.max(...sim.x.map(q => q[I.h]))), 0)}` });
    const vmin = Math.min(...sim.x.map(q => q[I.u])), vmax = Math.max(...sim.x.map(q => q[I.u]));
    list.push({ k: 'Speed change', v: `${fx(toDisp('speed', x[I.u]))} ${unit('speed').u}`, s: `target ${fx(toDisp('speed', S.tgt.dV), 0)} · range ${fx(toDisp('speed', vmin))} to ${fx(toDisp('speed', vmax))}`, cls: vmin < -15 * KT ? 'warn' : '' });
    if (S.lat === 'hdg') { const tc = captureTime(sim, 'psi', wrapTo(S.tgt.dpsi), 1 * D); list.push({ k: 'Heading change', v: `${fx(x[I.psi] * DEG)}°`, s: tc === null ? 'not captured' : `within 1° after ${f3(Math.max(0, tc - 2))} s`, cls: tc === null ? 'warn' : '' }); }
    list.push({ k: 'Peak bank', v: `${fx(Math.max(...sim.x.map(q => Math.abs(q[I.ph]))) * DEG)}°`, s: `limit ${fx(S.g.phiMax * DEG, 0)}° · peak sideslip ${fx(Math.max(...sim.x.map(q => Math.abs(q[I.b]))) * DEG)}°` });
    if (S.thr === 'speed' && !R.eng.none) { const sat = sim.s.filter(s => s.thrSat).length / sim.s.length; list.push({ k: 'Throttle at a limit', v: `${f3(sat * 100)}%`, s: `of the time · trim ${f3(R.eng.tau0 * 100)}%`, cls: sat > 0.3 ? 'warn' : '' }); }
    if (sim.departed) list.push({ k: 'Departed', v: `${f3(sim.departed.t)} s`, s: sim.departed.what, cls: 'bad' });
    metrics.set(list);
  }
  const fx = (v, d = 1) => (Math.abs(v) < 0.5 * 10 ** -d ? 0 : v).toFixed(d);
  const wrapTo = a => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
  function loopTable() {
    const { loops } = R, rows = [];
    const pairs = { theta: 'elev', bank: 'ail', thr: null };
    for (const l of loops) {
      const pm = l.mg.pm, gm = l.mg.gmUp, inner = pairs[l.k] ? loops.find(q => q.k === pairs[l.k]) : null;
      const ratio = inner && inner.mg.pm && pm ? inner.mg.pm.w / pm.w : null;
      const tr = h('tr', { style: { cursor: 'pointer', background: R.selLoop === l ? 'var(--accent-soft)' : '' }, onclick: () => { S.loopSel = l.ax + l.k; R.selLoop = l; loopTable(); bod.paint(); } },
        h('td', { style: { textAlign: 'left', fontFamily: 'var(--font)' } }, l.label), h('td', {}, pm ? f3(pm.w) : '—'), h('td', { style: { color: pm && pm.pmDeg < 30 ? 'var(--warn)' : '' } }, pm ? `${f3(pm.pmDeg)}°` : '∞'),
        h('td', {}, gm ? `${f3(gm.gmDb)} dB` : '∞'), h('td', {}, pm && pm.delay ? `${f3(pm.delay)} s` : '—'), h('td', { style: { color: ratio !== null && ratio < 3 ? 'var(--warn)' : '' } }, ratio !== null ? `inner ×${f3(ratio)}` : ''));
      rows.push(tr);
    }
    loopHost.replaceChildren(h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ...['Loop', 'ωc (rad/s)', 'PM', 'GM', 'delay margin', ''].map(x => h('th', {}, x)))), h('tbody', {}, ...rows)));
  }

  // ---------- animation ----------
  let raf = 0;
  const animTime = () => { if (!R) return 0; const T = R.sim.t[R.sim.t.length - 1]; const t = S.playing ? (performance.now() - S.t0) / 1000 * S.speed : S.tp || 0; return Math.min(t % (T + 3 * S.speed), T); };
  function loop() { cancelAnimationFrame(raf); const tick = () => { if (!main.isConnected || !S.playing) return; pfd.paint(); map.paint(); raf = requestAnimationFrame(tick); }; raf = requestAnimationFrame(tick); }
  const idxAt = (rec, t) => { const ts = rec.t; if (t >= ts[ts.length - 1]) return ts.length - 1; let lo = 0, hi = ts.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ts[m] <= t) lo = m; else hi = m; } return lo; };

  function fma(rec, i) {
    const s = rec.s[i], x = rec.x[i], I = rec.I, c = R.cmds(rec.t[i]), ap = R.ap;
    const thr = ap.thr === 'speed' && !R.eng.none ? (s.flch ? ((c.dh || 0) > x[I.h] ? 'THR CLB' : 'THR IDLE') : 'SPEED') : 'MAN THR';
    let pit = { pitch: 'PITCH', speed: 'SPD', vs: 'V/S' }[ap.pitch] || '', arm = '';
    if (ap.pitch === 'alt' || (ap.pitch === 'flch' && !s.flch)) { const e = Math.abs((c.dh || 0) - x[I.h]); pit = e < 6 ? 'ALT' : s.vsSat ? 'V/S' : 'ALT*'; if (pit === 'V/S') arm = 'ALT'; }
    if (s.flch) { pit = 'FLCH'; arm = 'ALT'; }
    const lat = ap.lat === 'hdg' ? (Math.abs(s.epsi || 0) < 0.5 * D ? 'HDG HOLD' : 'HDG SEL') : ap.lat === 'bank' ? 'ROLL' : '—';
    return { thr, pit, arm, lat };
  }
  function drawPFD(c, Wd, Hd) {
    if (!R) return;
    const rec = R.sim, t = animTime(), i = idxAt(rec, t), x = rec.x[i], I = rec.I, cmd = R.cmds(rec.t[i]);
    const th = x[I.th] * DEG, ph = x[I.ph], tape = 58, top = 30, bot = 40, cx = Wd / 2, cy = top + (Hd - top - bot) / 2, ah = Hd - top - bot, aw = Wd - 2 * tape - 20, ppd = ah / 36;
    // attitude
    c.save(); c.beginPath(); c.rect(cx - aw / 2, top, aw, ah); c.clip();
    c.translate(cx, cy); c.rotate(-ph); c.translate(0, th * ppd);
    c.fillStyle = '#3d7cc9'; c.fillRect(-aw * 2, -ah * 4, aw * 4, ah * 4); c.fillStyle = '#8a5a2b'; c.fillRect(-aw * 2, 0, aw * 4, ah * 4);
    c.strokeStyle = '#fff'; c.fillStyle = '#fff'; c.lineWidth = 1.4; c.font = '10px ' + cssVar('--mono'); c.textAlign = 'right'; c.textBaseline = 'middle';
    c.beginPath(); c.moveTo(-aw * 2, 0); c.lineTo(aw * 2, 0); c.stroke();
    for (let p = -30; p <= 30; p += 5) { if (!p) continue; const y = -p * ppd, w = p % 10 ? 18 : 34; c.beginPath(); c.moveTo(-w, y); c.lineTo(w, y); c.stroke(); if (!(p % 10)) { c.fillText(String(Math.abs(p)), -w - 4, y); } }
    c.restore();
    // bank scale and pointer
    c.save(); c.translate(cx, cy); c.strokeStyle = '#fff'; c.lineWidth = 1.4; const rb = Math.min(aw, ah) * 0.42;
    for (const b of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) { const a = (b - 90) * D, l = b % 30 ? 6 : 11; c.beginPath(); c.moveTo(rb * Math.cos(a), rb * Math.sin(a)); c.lineTo((rb - l) * Math.cos(a), (rb - l) * Math.sin(a)); c.stroke(); }
    c.rotate(-ph); c.fillStyle = '#fff'; c.beginPath(); c.moveTo(0, -rb + 2); c.lineTo(-6, -rb + 12); c.lineTo(6, -rb + 12); c.fill(); c.restore();
    // aircraft symbol
    c.strokeStyle = '#ffcc33'; c.lineWidth = 3.5; c.beginPath(); c.moveTo(cx - 60, cy); c.lineTo(cx - 22, cy); c.lineTo(cx - 12, cy + 8); c.moveTo(cx + 60, cy); c.lineTo(cx + 22, cy); c.lineTo(cx + 12, cy + 8); c.stroke(); c.fillStyle = '#ffcc33'; c.fillRect(cx - 3, cy - 3, 6, 6);
    // tapes
    const tapeBg = cssVar('--bg-sunk'), tx = cssVar('--text'), magenta = '#e040fb';
    const V = toDisp('speed', R.an.d.V + x[I.u]), Vt = toDisp('speed', R.an.d.V + (cmd.dV || 0)), z0 = geopotential(perf.z), Hh = toDisp('alt', z0 + x[I.h]), Ht = toDisp('alt', z0 + (cmd.dh || 0));
    const drawTape = (x0, val, tgt, step, fmt, side) => {
      c.save(); c.fillStyle = tapeBg; c.fillRect(x0, top, tape, ah); c.beginPath(); c.rect(x0, top, tape, ah); c.clip();
      const pp = ah / (step * 8); c.strokeStyle = cssVar('--text-3'); c.fillStyle = cssVar('--text-2'); c.font = '10px ' + cssVar('--mono'); c.textBaseline = 'middle'; c.textAlign = side === 'l' ? 'right' : 'left';
      for (let v = Math.floor((val - step * 5) / step) * step; v <= val + step * 5; v += step) { const y = cy - (v - val) * pp; c.beginPath(); c.moveTo(side === 'l' ? x0 + tape - 7 : x0, y); c.lineTo(side === 'l' ? x0 + tape : x0 + 7, y); c.stroke(); c.fillText(fmt(v), side === 'l' ? x0 + tape - 10 : x0 + 10, y); }
      if (tgt !== null) { const y = Math.max(top + 4, Math.min(top + ah - 4, cy - (tgt - val) * pp)); c.fillStyle = magenta; c.fillRect(side === 'l' ? x0 + tape - 5 : x0, y - 5, 5, 10); }
      c.restore();
      c.fillStyle = '#000'; c.strokeStyle = '#fff'; c.lineWidth = 1.2; c.fillRect(x0 + 2, cy - 11, tape - 4, 22); c.strokeRect(x0 + 2, cy - 11, tape - 4, 22);
      c.fillStyle = '#fff'; c.font = '600 12px ' + cssVar('--mono'); c.textAlign = 'center'; c.fillText(fmt(val), x0 + tape / 2, cy + 1);
      if (tgt !== null) { c.fillStyle = magenta; c.font = '11px ' + cssVar('--mono'); c.fillText(fmt(tgt), x0 + tape / 2, top - 8); }
    };
    const showSpdBug = R.ap.thr === 'speed' || R.ap.pitch === 'speed' || R.ap.pitch === 'flch';
    drawTape(4, V, showSpdBug ? Vt : null, units() === 'us' ? 10 : 5, v => num(v, 0), 'l');
    drawTape(Wd - tape - 4, Hh, R.ap.pitch === 'alt' || R.ap.pitch === 'flch' ? Ht : null, units() === 'us' ? 100 : 25, v => num(v, 0), 'r');
    // heading scale
    const hdg = ((x[I.psi] * DEG) % 360 + 360) % 360, hy = top + ah + 6, hw = aw;
    c.save(); c.beginPath(); c.rect(cx - hw / 2, hy, hw, bot - 8); c.clip(); c.fillStyle = tapeBg; c.fillRect(cx - hw / 2, hy, hw, bot - 8);
    c.strokeStyle = cssVar('--text-3'); c.fillStyle = cssVar('--text-2'); c.font = '10px ' + cssVar('--mono'); c.textAlign = 'center'; c.textBaseline = 'top';
    const ppdH = hw / 60;
    for (let v = Math.floor((hdg - 35) / 5) * 5; v <= hdg + 35; v += 5) { const X = cx + (v - hdg) * ppdH; c.beginPath(); c.moveTo(X, hy); c.lineTo(X, hy + (v % 10 ? 4 : 8)); c.stroke(); if (!(v % 10)) { const lab = ((v % 360) + 360) % 360; c.fillText(String(lab === 0 ? 360 : lab).padStart(3, '0'), X, hy + 10); } }
    if (R.ap.lat === 'hdg') { let d = ((cmd.dpsi || 0) * DEG - (x[I.psi] * DEG)); d = ((d + 540) % 360) - 180; const X = Math.max(cx - hw / 2 + 4, Math.min(cx + hw / 2 - 4, cx + d * ppdH)); c.fillStyle = magenta; c.fillRect(X - 5, hy, 10, 5); }
    c.restore();
    c.fillStyle = '#fff'; c.beginPath(); c.moveTo(cx, hy + 1); c.lineTo(cx - 5, hy - 6); c.lineTo(cx + 5, hy - 6); c.fill();
    // vertical speed
    const vs = rec.s[i].hdot, vsd = units() === 'us' ? vs / FPM : vs;
    c.fillStyle = tx; c.font = '11px ' + cssVar('--mono'); c.textAlign = 'right'; c.textBaseline = 'top'; c.fillText(`${vsd >= 0 ? '+' : ''}${num(vsd, units() === 'us' ? 0 : 1)} ${units() === 'us' ? 'fpm' : 'm/s'}`, Wd - 6, top + ah + 4);
    c.textAlign = 'left'; c.fillText(`${unit('speed').u} TAS`, 6, top + ah + 4);
    // flight mode annunciator
    const m = fma(rec, i), bw = (Wd - 8) / 3;
    [[m.thr, ''], [m.pit, m.arm], [m.lat, '']].forEach(([a, b], k) => {
      const X = 4 + k * bw; c.fillStyle = '#111'; c.fillRect(X, 2, bw - 4, top - 6); c.strokeStyle = cssVar('--border'); c.strokeRect(X, 2, bw - 4, top - 6);
      c.font = '600 12px ' + cssVar('--mono'); c.textBaseline = 'middle'; c.textAlign = 'center'; c.fillStyle = '#3ddc84'; c.fillText(a, X + (bw - 4) / 2 - (b ? 16 : 0), top / 2 - 1);
      if (b) { c.fillStyle = '#4fc3f7'; c.font = '11px ' + cssVar('--mono'); c.fillText(b, X + bw - 26, top / 2 - 1); }
    });
    c.fillStyle = cssVar('--text-3'); c.font = '10.5px ' + cssVar('--mono'); c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillText(`t = ${rec.t[i].toFixed(1)} s${rec.departed && t >= rec.departed.t ? ' · DEPARTED' : ''}`, cx, Hd - 2);
  }
  function drawMap(c, Wd, Hd) {
    if (!R) return;
    const recs = [R.sim, R.cmp].filter(Boolean), I = R.sim.I, t = animTime();
    const pts = recs.flatMap(r => r.x.map(x => [x[I.yE], x[I.xN]]));
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    let x0 = Math.min(0, ...xs), x1 = Math.max(0, ...xs), y0 = Math.min(0, ...ys), y1 = Math.max(0, ...ys);
    const span = Math.max(x1 - x0, y1 - y0, 500) * 1.15, mx = (x0 + x1) / 2, my = (y0 + y1) / 2, pad = 16, sc = Math.min(Wd, Hd) - 2 * pad;
    const X = e => Wd / 2 + (e - mx) / span * sc, Y = n => Hd / 2 - (n - my) / span * sc;
    c.fillStyle = cssVar('--bg-sunk'); c.fillRect(0, 0, Wd, Hd);
    // grid every nice distance
    const nm = units() === 'us' ? 1852 : 1000, raw = span / 6 / nm, p10 = 10 ** Math.floor(Math.log10(raw)), step = (raw / p10 < 2 ? 1 : raw / p10 < 5 ? 2 : 5) * p10 * nm;
    c.strokeStyle = cssVar('--border'); c.lineWidth = 1; c.beginPath();
    for (let e = Math.ceil((mx - span) / step) * step; e <= mx + span; e += step) { c.moveTo(X(e), 0); c.lineTo(X(e), Hd); }
    for (let n = Math.ceil((my - span) / step) * step; n <= my + span; n += step) { c.moveTo(0, Y(n)); c.lineTo(Wd, Y(n)); }
    c.stroke();
    // target heading line from the start
    if (R.ap.lat === 'hdg') { const a = S.tgt.dpsi; c.strokeStyle = '#e040fb'; c.setLineDash([6, 5]); c.lineWidth = 1.2; c.beginPath(); c.moveTo(X(0), Y(0)); c.lineTo(X(Math.sin(a) * span * 2), Y(Math.cos(a) * span * 2)); c.stroke(); c.setLineDash([]); }
    recs.forEach((r, k) => {
      const j = idxAt(r, t);
      c.strokeStyle = k ? cssVar('--text-3') : cssVar('--accent'); c.lineWidth = k ? 1.5 : 2.4; c.setLineDash(k ? [5, 4] : []);
      c.beginPath(); r.x.forEach((x, n) => { if (n > j) return; n ? c.lineTo(X(x[I.yE]), Y(x[I.xN])) : c.moveTo(X(x[I.yE]), Y(x[I.xN])); }); c.stroke(); c.setLineDash([]);
      const x = r.x[j]; c.save(); c.translate(X(x[I.yE]), Y(x[I.xN])); c.rotate(x[I.psi] - Math.PI / 2); c.scale(1.1, 1.1); topView(c, k ? cssVar('--text-3') : cssVar('--text')); c.restore();
    });
    c.fillStyle = cssVar('--text-2'); c.font = '600 11px ' + cssVar('--font'); c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText('N ↑', 8, 8);
    c.font = '10.5px ' + cssVar('--font'); c.fillText(`grid ${num(step / nm, step / nm < 1 ? 1 : 0)} ${units() === 'us' ? 'nm' : 'km'}${R.cmp ? ` · ghost: ${R.cmpLabel}` : ''}`, 8, 24);
  }

  // ---------- time histories ----------
  function panel(c, Wd, top, Hp, o) {
    c.save(); c.translate(0, top);
    const vals = o.fit.flat().filter(isFinite), lo = Math.min(...vals), hi = Math.max(...vals), pd = (hi - lo) * 0.12 || 1;
    const tr = axes(c, Wd, Hp, { x0: 0, x1: S.T, y0: lo - pd, y1: hi + pd, xlabel: o.xlabel || '', ylabel: o.ylabel, pt: 6, pb: o.xlabel ? 34 : 16, xfmt: v => f3(v), yfmt: v => num(v, Math.abs(hi - lo) > 20 ? 0 : 1) });
    tr.clip();
    for (const s of o.series) tr.line(s.t.map((t, i) => [t, s.v[i]]), s.color, s.w || 2, s.dash);
    c.restore();
    if (o.legend) legend(c, tr, o.legend, tr.pl + tr.iw - 160, tr.pt + 9);
    c.restore();
  }
  function drawHist(c, Wd, Hd) {
    if (!R) return;
    const { sim, cmp } = R, I = sim.I, n = 4, hp = Math.floor((Hd - 20) / n), A = cssVar('--accent'), G = cssVar('--text-3'), T = '#e040fb';
    const col = (r, f) => r.x.map(f), tg = (r, f) => r.t.map(t => f(R.cmds(t)));
    const ser = (f, tf, w) => [...(cmp ? [{ t: cmp.t, v: col(cmp, f), color: G, dash: [5, 4], w: 1.5 }] : []), ...(tf ? [{ t: sim.t, v: tg(sim, tf), color: T, dash: [2, 3], w: 1.3 }] : []), { t: sim.t, v: col(sim, f), color: w || A, w: 2.2 }];
    const fit = (f, tf) => [col(sim, f), ...(cmp ? [col(cmp, f)] : []), ...(tf ? [tg(sim, tf)] : [])];
    const hF = x => toDisp('alt', x[I.h]), hT = (S.pitch === 'alt' || S.pitch === 'flch') ? c0 => toDisp('alt', c0.dh || 0) : null;
    panel(c, Wd, 0, hp, { ylabel: `Δ altitude (${unit('alt').u})`, fit: fit(hF, hT), series: ser(hF, hT), legend: [[A, 'this run', null, 2.2], ...(cmp ? [[G, R.cmpLabel, [5, 4], 1.5]] : []), [T, 'target', [2, 3], 1.3]] });
    const vF = x => toDisp('speed', x[I.u]), vT = c0 => toDisp('speed', c0.dV || 0);
    panel(c, Wd, hp, hp, { ylabel: `Δ speed (${unit('speed').u})`, fit: fit(vF, vT), series: ser(vF, vT) });
    const pF = x => x[I.psi] * DEG, pT = S.lat === 'hdg' ? c0 => wrapTo(c0.dpsi || 0) * DEG : null;
    panel(c, Wd, 2 * hp, hp, { ylabel: 'Δ heading (°)', fit: fit(pF, pT), series: ser(pF, pT) });
    const phF = x => x[I.ph] * DEG, thF = x => x[I.th] * DEG, tF = S.thr === 'speed' && !R.eng.none ? sim.x.map(x => (R.eng.tau0 + x[I.tau]) * 100 / 5) : null;
    panel(c, Wd, 3 * hp, Hd - 3 * hp, { ylabel: 'bank, pitch (°)', xlabel: 'Time (s)', fit: [col(sim, phF), col(sim, thF), ...(tF ? [tF] : [])],
      series: [{ t: sim.t, v: col(sim, phF), color: cssVar('--good'), w: 2 }, { t: sim.t, v: col(sim, thF), color: A, w: 2 }, ...(tF ? [{ t: sim.t, v: tF, color: cssVar('--warn'), w: 1.6, dash: [6, 3] }] : [])],
      legend: [[cssVar('--good'), 'bank φ', null, 2], [A, 'pitch θ', null, 2], ...(tF ? [[cssVar('--warn'), 'throttle (% ÷ 5)', [6, 3], 1.6]] : [])] });
  }

  // ---------- laws and insights ----------
  function equations() {
    const g = S.g, L = [];
    const pl = { alt: 'ḣc = Kh·(hc − h), limited to ± the V/S limit;   θc = Kvs·(ḣc − ḣ) + Kvs,i·∫(ḣc − ḣ) dt, limited', vs: 'θc = Kvs·(ḣc − ḣ) + Kvs,i·∫(ḣc − ḣ) dt, limited', flch: 'far from the target: thrust at climb (or idle), θc = −(KVp·eV + KVp,i·∫eV dt);   near it: the ALT law, handed over smoothly', pitch: 'θc = the target attitude', speed: 'θc = −(KVp·(Vc − V) + KVp,i·∫(Vc − V) dt): nose down to speed up', off: 'no pitch outer loop' }[S.pitch];
    L.push(`Pitch: ${pl}`, `Elevator (up): δe = Kθ·(θc − θ) − Kq·q${g.Ka ? ' − Kα·α' : ''}`);
    if (S.thr === 'speed' && !R.eng.none) L.push(`Throttle: δT = trim + KV·(Vc − V) + KV,i·∫(Vc − V) dt, between idle and full; engine lag ${R.eng.lag} s`);
    L.push(S.lat === 'hdg' ? 'Bank: φc = Kψ·(ψc − ψ) + Kψ,i·∫(ψc − ψ) dt, limited (error taken the short way round)' : S.lat === 'bank' ? 'Bank: φc = the target bank' : 'No lateral outer loop', `Aileron: δa = Kφ·(φc − φ) − Kp·p;   rudder: δr = −Kr·[τs/(τs + 1)]·r + Kβ·β`);
    eqHost.replaceChildren(h('span', { class: 'eq', html: L.join('<br>') }), h('p', { class: 'hint' }, 'Small-disturbance dynamics about the trimmed condition, with exact turn kinematics (ψ̇ = r / cos φ, side force from gravity ∝ sin φ), the lift lost by banking, actuator and engine lags and every limit. The loop table uses the linearised model without the limits.'));
  }
  function insights() {
    const { sim, cmp, A, loops, eng, an } = R, I = sim.I, list = [], x = lastOf(sim), V = an.d.V;
    const stable = ['lon', 'lat'].every(ax => A[ax].roots.every(z => z[0] < 2e-3));
    if (!stable) list.push({ type: 'b', t: 'An autopilot loop is unstable', d: 'Look at the loop table for a negative phase margin. Usually an outer loop is too fast for the inner loop inside it: lower the outer gain or raise the inner one.' });
    if (sim.departed) list.push({ type: 'b', t: `Departed after ${f3(sim.departed.t)} s (${sim.departed.what})`, d: 'The motion left the range where the small-disturbance model holds.' });
    const vmin = Math.min(...sim.x.map(q => q[I.u]));
    if ((S.pitch === 'alt' || S.pitch === 'vs') && S.tgt.dh > 0 && vmin < -8 * KT && !eng.none) list.push({ type: 'w', t: `Climbing on vertical speed cost ${num(toDisp('speed', -vmin), 0)} ${unit('speed').u}`, d: `The elevator holds the climb rate whatever the speed does; if the engines cannot supply the extra power (W·ḣ), the speed bleeds away. At altitude the excess thrust is small, so airliners climb in level change (FLCH): climb thrust, with the elevator holding speed and the climb rate whatever is left. Compare with "Level change instead".` });
    if (S.pitch === 'flch') list.push({ type: 'i', t: 'Level change', d: `Thrust goes to climb (or idle for a descent) and the elevator holds the speed, so the climb rate is whatever excess power allows. About ${num(toDisp('alt', 2 * Math.max(g0(sim), S.g.vsMax) / S.g.Kh), 0)} ${unit('alt').u} from the target the altitude capture (ALT*) takes over, with its integrators set so the commands carry on without a jump.` });
    const satT = sim.s.filter(s => s.thrSat).length / sim.s.length;
    if (!S.aw && satT > 0.1) list.push({ type: 'w', t: 'Integrator windup', d: 'With the throttle at a limit the speed integrator keeps charging; when the limit is released it has to discharge, so the speed overshoots for a long time. Switch anti-windup on (or compare with it).' });
    else if (S.aw && satT > 0.1 && !sim.s.some(s => s.flch)) list.push({ type: 'i', t: `Throttle at a limit ${f3(satT * 100)}% of the time`, d: 'Anti-windup stops the integrator while the throttle is at full or idle, so the speed recovers without a large overshoot afterwards.' });
    if (S.lat !== 'off' && S.pitch === 'pitch') { const dh = Math.min(...sim.x.map(q => q[I.h])); if (dh < -15 * FT) list.push({ type: 'w', t: `Lost ${num(toDisp('alt', -dh), 0)} ${unit('alt').u} in the turn`, d: 'Banked, only L·cos φ of the lift holds the aircraft up. Holding the pitch attitude is not enough: it needs more angle of attack (back pressure, n = 1/cos φ). An altitude hold does this automatically; simple autopilots add a "turn compensation" term to the elevator.' }); }
    if (S.lat === 'hdg' && Math.abs(S.tgt.dpsi) > 20 * D) { const rate = 9.81 * Math.tan(S.g.phiMax) / V * DEG; list.push({ type: 'i', t: `Turn rate at the ${f3(S.g.phiMax * DEG)}° bank limit: ${f3(rate)}°/s`, d: `Turn rate = g·tan φ / V. At ${num(toDisp('speed', V), 0)} ${unit('speed').u} that is ${f3(rate)}°/s${rate < 3 ? ', below the 3°/s "standard rate" light aircraft fly' : ''}; a ${f3(Math.abs(wrapTo(S.tgt.dpsi)) * DEG)}° change takes at least ${f3(Math.abs(wrapTo(S.tgt.dpsi)) * DEG / rate)} s.` }); }
    const ratio = (o, i) => { const lo = loops.find(l => l.k === o), li = loops.find(l => l.k === i); return lo && li && lo.mg.pm && li.mg.pm ? li.mg.pm.w / lo.mg.pm.w : null; };
    const rp = ratio('theta', 'elev'), rl = ratio('bank', 'ail');
    if ((rp && rp < 3) || (rl && rl < 3)) list.push({ type: 'w', t: 'Inner and outer loops too close', d: `The ${rp && rp < 3 ? 'pitch' : 'roll'} inner loop is only ${f3(rp && rp < 3 ? rp : rl)}× faster than the loop around it. A cascade relies on each inner loop looking like a near-perfect follower to the outer one; at less than about 3–5× they interact and the outer loop loses phase margin.` });
    else list.push({ type: 'g', t: 'Successive loop closure', d: `Each loop wraps a faster one: the pitch inner loop crosses over ${rp ? f3(rp) + '×' : ''} faster than the altitude loop, the bank loop ${rl ? f3(rl) + '×' : ''} faster than the heading loop. That separation lets each loop be designed as if the one inside it were perfect.` });
    const at = loops.find(l => l.k === 'thr');
    if (at && at.mg.pm && at.mg.pm.pmDeg < 40) list.push({ type: 'i', t: `Autothrottle phase margin ${f3(at.mg.pm.pmDeg)}°`, d: 'Thrust changes speed slowly through the engine lag, and speed and height trade through the phugoid, so autothrottles are kept gentle: a crossover around 0.2 rad/s, with modest margins.' });
    if (R.ap.g.Ka) list.push({ type: 'i', t: 'Autopilot on top of stability augmentation', d: 'The fighter is unstable on its own, so the pitch inner loop includes α feedback (the job its fly-by-wire does). The autopilot loops then wrap that stabilised aircraft like any other.' });
    if (eng.none) list.push({ type: 'i', t: 'No engine', d: 'A sailplane holds speed with the elevator and trades height for it; it cannot hold an altitude except in rising air.' });
    if (S.turb !== 'off') list.push({ type: 'i', t: 'Turbulence', d: 'Both runs fly the same Dryden gust history. The altitude hold rides the gusts out with small deviations; a stiffer altitude loop holds height more tightly but works the elevator harder.' });
    insightsList(ins, list);
  }
  const g0 = rec => Math.max(...rec.s.map(s => Math.abs(s.hdot)));

  const offU = onUnits(() => { acSec.rebuild(); cond.rebuild(); buildTargets(); buildGains(); schedule(); });
  compute();
  return {
    controls, main,
    show: () => { if (seen !== perf.version) { acSec.rebuild(); cond.rebuild(); des.rebuild(); S.g = null; buildModes(); buildTargets(); compute(); } else { [hist, bod, map, pfd].forEach(x => x.paint()); if (S.playing) loop(); } },
    destroy: () => { offU(); clearTimeout(timer); cancelAnimationFrame(raf); },
  };
}
