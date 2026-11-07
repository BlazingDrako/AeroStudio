// Performance tab: forces in a steady climb, drag/thrust and power curves, the climb hodograph, climb and speeds
// against altitude, cruise (specific range, payload–range) and takeoff/landing distances for the chosen aircraft.
import { h, section, slider, segmented, field, cssVar } from '../../lib/ui.js';
import * as P from '../../solvers/performance.js';
import { atmosphere, airspeeds, G0 } from '../../solvers/atmosphere.js';
import { card, metricsGrid, insightsList, units, onUnits, unit, toDisp, fromDisp, show, num, canvasBox } from './common.js';
import { perf, ac, W, aircraftSection, conditionSection, axes, legend, showMass, showForce, showRoc, rocDisp, rocUnit, showRange, rangeDisp, rangeUnit, showRunway, showTime } from './perfShared.js';

const FT = 0.3048, KT = 0.514444, DEG = 180 / Math.PI;

export function performanceTab({ keep = o => o } = {}) {
  const S = keep({ curve: 'thrust', rule: 'lrc', elev: 0, wind: 0 });
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });
  let R = null, seen = -1; // results of the last computation; perf.version they were made from

  const acSec = aircraftSection(src => { if (src === 'aircraft') cond.rebuild(); schedule(); });
  const cond = conditionSection(() => schedule());
  const rwy = section('Runway', { collapsible: true });
  const buildRwy = () => {
    const eS = slider({ label: `Field elevation (${unit('alt').u})`, min: 0, max: Math.round(toDisp('alt', 3000)), step: units() === 'us' ? 100 : 25, value: toDisp('alt', S.elev), format: v => num(+v, 0), info: 'Denver is 5,434 ft (1,656 m); La Paz El Alto is 13,325 ft (4,061 m).', onInput: v => { S.elev = fromDisp('alt', v); schedule(); } });
    const wS = slider({ label: `Headwind (${unit('speed').u})`, min: Math.round(toDisp('speed', -10 * KT)), max: Math.round(toDisp('speed', 30 * KT)), step: 1, value: toDisp('speed', S.wind), format: v => num(+v, 0), info: 'Negative for a tailwind. A headwind means less ground speed is needed to reach flying airspeed.', onInput: v => { S.wind = fromDisp('speed', v); schedule(); } });
    rwy.body.replaceChildren(eS.el, wS.el);
  };
  buildRwy();
  const crz = section('Cruise', { collapsible: true });
  crz.body.append(field('Cruise speed', segmented([{ value: 'mrc', label: 'Max range' }, { value: 'lrc', label: 'Long range' }, { value: 'end', label: 'Endurance' }], S.rule, v => { S.rule = v; schedule(); }).el,
    '<b>Max range</b>: the speed with the most distance per kg of fuel.<br><b>Long range</b>: a little faster, giving up 1% of range for several % of speed (what airlines fly).<br><b>Endurance</b>: least fuel per hour, for loitering.'),
  h('div', { class: 'hint' }, 'Cruise is flown at the altitude above, burning the fuel aboard down to a 5% reserve.'));
  controls.append(acSec.el, cond.el, rwy.el, crz.el);

  // ---- layout ----
  const metrics = metricsGrid();
  const forces = canvasBox('330px', drawForces);
  const forcesCard = card('Forces in steady flight', 'Lift L, drag D, thrust T and weight W at the chosen speed. The flight path tilts by the climb angle γ, where sin γ = (T − D)/W. Click the speed tape to change speed.', forces.el);
  const curveSeg = segmented([{ value: 'thrust', label: 'Thrust & drag' }, { value: 'power', label: 'Power' }], S.curve, v => { S.curve = v; curves.paint(); });
  const curves = canvasBox('330px', drawCurves);
  const curvesCard = h('div', { class: 'plot-card' }, h('div', { class: 'plot-head' }, h('h4', {}, 'Drag curve'), curveSeg.el), curves.el);
  const hodo = canvasBox('300px', drawHodo);
  const hodoCard = card('Climb hodograph', 'Vertical speed against horizontal speed. The top of the curve is the best rate of climb (Vy); the tangent from the origin is the steepest climb (Vx) or, gliding, the best glide.', hodo.el);
  const alt = canvasBox('300px', drawAlt);
  const altSeg = segmented([{ value: 'speeds', label: 'Speeds' }, { value: 'climb', label: 'Climb' }], 'speeds', v => { S.altView = v; alt.paint(); });
  S.altView = 'speeds';
  const altCard = h('div', { class: 'plot-card' }, h('div', { class: 'plot-head' }, h('h4', {}, 'Against altitude'), altSeg.el), alt.el);
  const sr = canvasBox('280px', drawSR);
  const srCard = card('Specific range', 'Distance flown per unit of fuel at this altitude and weight. Its peak is the max-range speed; long-range cruise is the faster speed with 99% of it.', sr.el);
  const pr = canvasBox('280px', drawPR);
  const prCard = card('Payload–range', 'Range at the chosen cruise altitude and speed: maximum payload until the takeoff mass limit, then trading payload for fuel until the tanks are full, then the ferry range.', pr.el);
  const rw = canvasBox('250px', drawRunway);
  const rwCard = card('Takeoff and landing', 'Distances to scale (heights exaggerated). Takeoff: ground roll to liftoff, then an arc and climb to the screen height. Landing: 3° approach from the screen height, flare, free roll, then braking.', rw.el);
  const insCard = card('What is happening here'); const ins = h('div'); insCard.append(ins);
  main.append(metrics.el, h('div', { class: 'flt-grid2' }, forcesCard, curvesCard), h('div', { class: 'flt-grid2' }, hodoCard, altCard), h('div', { class: 'flt-grid2' }, srCard, prCard), h('div', { class: 'flt-grid2' }, rwCard, insCard));

  // clicking the speed tape sets the speed
  forces.canvas.addEventListener('pointerdown', e => {
    if (!R || !R.tape) return;
    const r = forces.canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (y < R.tape.y - 14 || y > R.tape.y + 20) return;
    cond.setV(Math.max(0, R.tape.iv(x))); schedule();
  });

  let raf = 0;
  function schedule() { clearTimeout(raf); raf = setTimeout(compute, 16); }

  function compute() {
    const a = ac(), w = W(), atm = atmosphere(perf.z, perf.dT), r = perf.rating, glider = a.engine === 'none';
    const sp = P.speeds(a, atm, w, r), st = P.state(a, atm, perf.V, w, r), asp = airspeeds('tas', perf.V, atm);
    const Vhi = Math.min(Math.max((sp.VmaxAero || sp.Vmd * 2) * 1.12, sp.Vmd * 1.8), Math.max(sp.Vlimit * 1.08, sp.Vmd * 1.5), (a.wave ? 2.5 : a.mcrit + 0.3) * atm.a);
    R = { a, w, atm, r, glider, sp, st, asp, Vhi };
    // curves against speed
    const n = 160, Vs0 = sp.Vs * 0.85;
    R.curve = Array.from({ length: n + 1 }, (_, i) => { const V = Vs0 + (Vhi - Vs0) * i / n; return P.state(a, atm, V, w, r); });
    // against altitude
    const zs = Array.from({ length: 36 }, (_, i) => a.plot.zMax * i / 35);
    R.byAlt = zs.map(z => { const at = atmosphere(z, perf.dT); return { z, sp: P.speeds(a, at, w, r) }; });
    if (!glider) {
      R.ceil = P.ceilings(a, perf.dT, w, r);
      R.ttc = perf.z > 0 && perf.z < R.ceil.abs ? P.timeToClimb(a, perf.dT, w, r, perf.z) : { t: perf.z ? Infinity : 0 };
      const rr = a.engine === 'ab' ? 'mil' : r;
      const burn = Math.max(0, Math.min(perf.fuel, perf.mass - a.mass.empty) * 0.95);
      R.cruise = burn > 0 ? P.cruise(a, { z: perf.z, dT: perf.dT, m0: perf.mass, burn, rating: rr, rule: S.rule }) : null;
      R.endur = burn > 0 ? P.cruise(a, { z: perf.z, dT: perf.dT, m0: perf.mass, burn, rating: rr, rule: 'end' }) : null;
      R.crV = R.cruise ? R.cruise.Vstart : NaN;
      R.mrc = P.cruiseSpeed(a, atm, w, rr, 'mrc'); R.lrc = P.cruiseSpeed(a, atm, w, rr, 'lrc');
      R.srCurve = R.curve.map(s => ({ V: s.V, sr: P.specificRange(a, atm, s.V, w, rr) }));
      R.pr = P.payloadRange(a, { z: perf.z, dT: perf.dT, rating: rr, rule: S.rule });
      R.to = P.takeoff(a, { elev: S.elev, dT: perf.dT, W: w, wind: S.wind, rating: r });
    }
    R.ld = P.landing(a, { elev: S.elev, dT: perf.dT, W: w, wind: S.wind });
    seen = perf.version;
    paintAll();
  }

  function paintAll() {
    const { a, sp, st, asp, glider } = R;
    const m = [
      { k: 'Stall speed', v: show('speed', sp.Vs), s: `${show('speed', airspeeds('tas', sp.Vs, R.atm).cas, 0)} CAS, clean, 1 g` },
      { k: glider ? 'Best glide' : 'Min-drag speed', v: show('speed', sp.Vmd), s: `L/D max ${sp.LDmax.toFixed(1)}`, tip: 'Speed of least drag: best glide angle without power, and best endurance for a jet.' },
    ];
    if (glider) {
      m.push({ k: 'Minimum sink', v: showRoc(sp.sinkMin), s: `at ${show('speed', sp.Vmp, 0)}` });
      m.push({ k: 'Glide range from here', v: showRange(perf.z * sp.LDmax), s: 'still air, best glide' });
      m.push({ k: 'Time aloft from here', v: showTime(perf.z / sp.sinkMin), s: 'at minimum sink, no lift' });
    } else {
      m.push({ k: 'Best rate Vy', v: showRoc(sp.RoCmax), s: `at ${show('speed', sp.Vy, 0)}`, cls: sp.RoCmax <= 0 ? 'bad' : '' });
      m.push({ k: 'Best angle Vx', v: `${(sp.gammaMax * DEG).toFixed(1)}°`, s: `at ${show('speed', sp.Vx, 0)}` });
      m.push({ k: 'Top speed', v: isFinite(sp.VmaxAero) ? show('speed', sp.Vmax, 0) : '—', s: !isFinite(sp.VmaxAero) ? 'cannot hold altitude' : sp.limitedBy === 'limit' ? `limit (thrust allows ${show('speed', sp.VmaxAero, 0)})` : `M ${(sp.Vmax / R.atm.a).toFixed(3)}, thrust = drag`, cls: !isFinite(sp.VmaxAero) ? 'bad' : '' });
      m.push({ k: 'Service ceiling', v: show('alt', R.ceil.service), s: `absolute ${show('alt', R.ceil.abs)}`, tip: 'Service ceiling: best climb has dropped to 100 ft/min. Absolute: it has reached zero.' });
      m.push({ k: 'Time to climb here', v: showTime(R.ttc.t), s: 'at best rate from sea level' });
      m.push({ k: 'Range', v: R.cruise ? showRange(R.cruise.range) : '—', s: R.cruise ? `${showTime(R.cruise.time)} at ${show('speed', R.cruise.Vstart, 0)}${R.cruise.feasible ? '' : ' (not enough thrust)'}` : 'no fuel aboard' });
      m.push({ k: 'Endurance', v: R.endur ? showTime(R.endur.time) : '—', s: R.endur ? `at ${show('speed', R.endur.Vstart, 0)}` : '' });
    }
    m.push({ k: 'This speed', v: `M ${asp.M.toFixed(3)}`, s: `${show('speed', asp.cas, 0)} CAS · L/D ${st.LD.toFixed(1)}`, cls: st.stalled ? 'bad' : '' });
    m.push({ k: glider ? 'Sink here' : 'Climb here', v: showRoc(st.Ps), s: `γ = ${(st.gamma * DEG).toFixed(2)}°`, cls: st.Ps < 0 && !glider ? 'warn' : '' });
    metrics.set(m);
    curvesCard.querySelector('h4').textContent = S.curve === 'power' ? 'Power curve' : 'Drag curve';
    forces.paint(); curves.paint(); hodo.paint(); alt.paint(); sr.paint(); pr.paint(); rw.paint();
    srCard.style.display = prCard.style.display = glider ? 'none' : '';
    insights();
  }

  // ---------- drawings ----------
  const V2d = v => toDisp('speed', v);
  function drawForces(c, Wd, Hd) {
    if (!R) return;
    const { st, sp, w, glider, Vhi } = R;
    const cx = Wd * 0.42, cy = Hd * 0.42, Lw = Math.min(Hd * 0.3, Wd * 0.22);
    const g = st.stalled ? 0 : st.gamma, cg = Math.cos(g), sg = Math.sin(g);
    // flight path
    c.strokeStyle = cssVar('--text-3'); c.setLineDash([5, 4]); c.lineWidth = 1.2; c.beginPath();
    c.moveTo(cx - Wd * 0.4 * cg, cy + Wd * 0.4 * sg); c.lineTo(cx + Wd * 0.4 * cg, cy - Wd * 0.4 * sg); c.stroke(); c.setLineDash([]);
    c.strokeStyle = cssVar('--border-strong'); c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Wd * 0.3, cy); c.stroke();
    if (Math.abs(g) > 0.002) { c.beginPath(); c.arc(cx, cy, 60, 0, -g, g > 0); c.stroke(); c.fillStyle = cssVar('--text-2'); c.font = '11px ' + cssVar('--font'); c.textAlign = 'left'; c.fillText(`γ = ${(g * DEG).toFixed(1)}°`, cx + 66, cy - (g > 0 ? 8 : -14)); }
    // aircraft
    c.save(); c.translate(cx, cy); c.rotate(-g); c.scale(1.6, 1.6); plane(c, cssVar('--text')); c.restore();
    // arrows: W and L at true scale; T and D magnified so they can be seen
    const kW = Lw / w, maxTD = Math.max(st.T, st.D, 1e-9);
    let mag = 1; while (maxTD * kW * mag < Lw * 0.45 && mag < 1000) mag *= mag === 1 ? 2 : mag % 10 === 2 ? 2.5 : 2;
    const arrow = (dx, dy, len, color, label) => {
      if (len < 2) return;
      const ex = cx + dx * len, ey = cy + dy * len;
      c.strokeStyle = color; c.fillStyle = color; c.lineWidth = 2.6; c.beginPath(); c.moveTo(cx, cy); c.lineTo(ex, ey); c.stroke();
      const an = Math.atan2(ey - cy, ex - cx); c.beginPath(); c.moveTo(ex, ey); c.lineTo(ex - 10 * Math.cos(an - 0.4), ey - 10 * Math.sin(an - 0.4)); c.lineTo(ex - 10 * Math.cos(an + 0.4), ey - 10 * Math.sin(an + 0.4)); c.fill();
      c.font = '600 11.5px ' + cssVar('--font'); c.textAlign = dx > 0.3 ? 'left' : dx < -0.3 ? 'right' : 'center'; c.textBaseline = dy > 0.3 ? 'top' : dy < -0.3 ? 'bottom' : 'middle';
      c.fillText(label, ex + dx * 6, ey + dy * 6);
    };
    const Lmag = st.stalled ? R.a.CLmax * st.q * R.a.S : w * cg;
    arrow(0, 1, w * kW, cssVar('--text-2'), `W ${showForce(w)}`);
    arrow(-sg, -cg, Lmag * kW, cssVar('--accent'), `L ${showForce(Lmag)}`);
    arrow(-cg, sg, st.D * kW * mag, cssVar('--lower'), `D ${showForce(st.D)}`);
    if (!glider) arrow(cg, -sg, st.T * kW * mag, cssVar('--good'), `T ${showForce(st.T)}`);
    c.fillStyle = cssVar('--text-3'); c.font = '11px ' + cssVar('--font'); c.textAlign = 'left'; c.textBaseline = 'top';
    c.fillText(mag > 1 ? `T and D drawn ×${mag} (L/D = ${st.LD.toFixed(1)}: drag is small next to weight)` : '', 10, 8);
    if (st.stalled) { c.fillStyle = cssVar('--bad'); c.font = '600 12px ' + cssVar('--font'); c.fillText(`Below the stall: needs C_L ${st.CL.toFixed(2)} > C_Lmax ${R.a.CLmax}`, 10, 24); }
    // speed tape
    const tl = 30, tr = Wd - 20, ty = Hd - 46, vmax = Vhi, X = v => tl + (tr - tl) * Math.min(1, Math.max(0, v / vmax));
    R.tape = { y: ty, iv: x => (x - tl) / (tr - tl) * vmax };
    c.fillStyle = cssVar('--bg-sunk'); c.fillRect(tl, ty, tr - tl, 10);
    c.fillStyle = cssVar('--bad'); c.globalAlpha = 0.5; c.fillRect(tl, ty, X(sp.Vs) - tl, 10);
    if (sp.Vlimit < vmax) c.fillRect(X(sp.Vlimit), ty, tr - X(sp.Vlimit), 10); c.globalAlpha = 1;
    if (!glider && isFinite(sp.VmaxAero)) { c.fillStyle = cssVar('--good'); c.globalAlpha = 0.45; c.fillRect(X(Math.max(sp.Vmin, sp.Vs)), ty, X(sp.Vmax) - X(Math.max(sp.Vmin, sp.Vs)), 10); c.globalAlpha = 1; }
    const marks = [['Vs', sp.Vs], [glider ? 'best glide' : 'Vmd', sp.Vmd], ...(glider ? [['min sink', sp.Vmp]] : [['Vx', sp.Vx], ['Vy', sp.Vy], ['Vmax', sp.VmaxAero]]), [R.a.limits.VNE ? 'VNE' : R.a.limits.MMO ? 'VMO/MMO' : 'limit', sp.Vlimit]];
    c.font = '10.5px ' + cssVar('--font'); c.textAlign = 'center'; c.textBaseline = 'top';
    let lastX = -99, row = 0;
    for (const [t, v] of marks.filter(m => isFinite(m[1]) && m[1] <= vmax).sort((p, q) => p[1] - q[1])) {
      const x = X(v); row = x - lastX < 46 ? 1 - row : 0; lastX = x;
      c.strokeStyle = cssVar('--text-2'); c.lineWidth = 1; c.beginPath(); c.moveTo(x, ty - 2); c.lineTo(x, ty + 12); c.stroke();
      c.fillStyle = cssVar('--text-2'); c.fillText(t, x, ty + 14 + row * 12);
    }
    const xv = X(perf.V); c.fillStyle = cssVar('--warn'); c.beginPath(); c.moveTo(xv, ty - 1); c.lineTo(xv - 6, ty - 11); c.lineTo(xv + 6, ty - 11); c.fill();
    c.fillStyle = cssVar('--text-3'); c.textAlign = 'left'; c.textBaseline = 'bottom'; c.fillText(`TAS 0 – ${num(V2d(vmax), 0)} ${unit('speed').u}  ·  red: below stall / above limit  ·  green: level flight possible`, tl, ty - 14);
  }

  function drawCurves(c, Wd, Hd) {
    if (!R) return;
    const { curve, sp, glider } = R, pw = S.curve === 'power';
    const us = units() === 'us', fK = pw ? (us ? 1 / 745.7 : 1e-3) : (us ? 1 / 4.448222 : 1e-3), fU = pw ? (us ? 'hp' : 'kW') : (us ? 'lbf' : 'kN');
    const xs = curve.map(s => V2d(s.V));
    const get = (s, k) => (pw ? { tot: s.Preq, p: s.Dp * s.V, i: s.Di * s.V, av: s.Pav }[k] : { tot: s.D, p: s.Dp, i: s.Di, av: s.T }[k]) * fK;
    const ymax = Math.max(...curve.map(s => get(s, 'tot')).filter(isFinite).slice(0, curve.length), ...(!glider ? curve.map(s => get(s, 'av')) : [0])) * 1.08;
    const ycap = Math.min(ymax, Math.max(...curve.map(s => get(s, 'tot'))) * 1.1, glider ? Infinity : Math.max(...curve.map(s => get(s, 'av'))) * 1.6);
    const tr = axes(c, Wd, Hd, { x0: xs[0], x1: xs[xs.length - 1], y0: 0, y1: Math.max(ycap, 1e-6), xlabel: `True airspeed (${unit('speed').u})`, ylabel: `${pw ? 'Power' : 'Force'} (${fU})`, xfmt: v => num(v, 0), yfmt: v => num(v, 0), pl: 64 });
    tr.clip();
    c.fillStyle = cssVar('--bad'); c.globalAlpha = 0.08; c.fillRect(tr.pl, tr.pt, tr.sx(V2d(sp.Vs)) - tr.pl, tr.ih);
    if (sp.Vlimit < curve[curve.length - 1].V) c.fillRect(tr.sx(V2d(sp.Vlimit)), tr.pt, tr.pl + tr.iw - tr.sx(V2d(sp.Vlimit)), tr.ih);
    c.globalAlpha = 1;
    const ser = k => curve.map((s, i) => [xs[i], get(s, k)]);
    tr.line(ser('p'), cssVar('--text-3'), 1.3, [5, 4]);
    tr.line(ser('i'), cssVar('--text-3'), 1.3, [2, 3]);
    tr.line(ser('tot'), cssVar('--lower'), 2.4);
    if (!glider) tr.line(ser('av'), cssVar('--good'), 2.4);
    // excess between the curves at Vy (power) or Vx (thrust)
    if (!glider) {
      const Vk = pw ? sp.Vy : sp.Vx, s = P.state(R.a, R.atm, Vk, R.w, R.r);
      const x = V2d(Vk), y0 = get(s, 'tot'), y1 = get(s, 'av');
      c.strokeStyle = cssVar('--accent'); c.lineWidth = 2; c.beginPath(); c.moveTo(tr.sx(x), tr.sy(y0)); c.lineTo(tr.sx(x), tr.sy(y1)); c.stroke();
      tr.text(x, (y0 + y1) / 2, pw ? ` max excess power → Vy` : ` max excess thrust → Vx`, cssVar('--accent'), 'left');
      if (isFinite(sp.VmaxAero) && sp.VmaxAero <= curve[curve.length - 1].V) { const sm = P.state(R.a, R.atm, sp.VmaxAero, R.w, R.r); tr.dot(V2d(sp.VmaxAero), get(sm, 'tot'), cssVar('--text')); tr.text(V2d(sp.VmaxAero), get(sm, 'tot'), ' Vmax', cssVar('--text-2'), 'right', 'bottom'); }
    }
    const kMin = pw ? sp.Vmp : sp.Vmd, sMin = P.state(R.a, R.atm, kMin, R.w, R.r);
    tr.dot(V2d(kMin), get(sMin, 'tot'), cssVar('--lower')); tr.text(V2d(kMin), get(sMin, 'tot'), pw ? 'min power' : 'min drag', cssVar('--text-2'), 'center', 'top');
    c.strokeStyle = cssVar('--warn'); c.setLineDash([3, 3]); c.lineWidth = 1.2; c.beginPath(); c.moveTo(tr.sx(V2d(perf.V)), tr.pt); c.lineTo(tr.sx(V2d(perf.V)), tr.pt + tr.ih); c.stroke(); c.setLineDash([]);
    c.restore();
    legend(c, tr, [[cssVar('--lower'), pw ? 'power required DV' : 'drag D', null, 2.4], ...(!glider ? [[cssVar('--good'), pw ? 'power available TV' : 'thrust available T', null, 2.4]] : []), [cssVar('--text-3'), 'parasite (∝ V²)', [5, 4], 1.3], [cssVar('--text-3'), 'induced (∝ 1/V²)', [2, 3], 1.3]], tr.pl + tr.iw - 175);
  }

  function drawHodo(c, Wd, Hd) {
    if (!R) return;
    const { curve, sp, glider } = R;
    const pts = curve.filter(s => !s.stalled || s.V >= sp.Vs * 0.999).map(s => [V2d(s.V * Math.cos(s.gamma)), rocDisp(s.Ps)]);
    const ys = pts.map(p => p[1]).filter(isFinite), xs = pts.map(p => p[0]);
    let y0 = Math.min(0, ...ys), y1 = Math.max(0, ...ys); const pad = (y1 - y0) * 0.1 || 1; y0 -= pad; y1 += pad;
    if (!glider) y0 = Math.max(y0, -Math.max(...ys) * 1.2);
    const tr = axes(c, Wd, Hd, { x0: 0, x1: Math.max(...xs) * 1.04, y0, y1, xlabel: `Horizontal speed (${unit('speed').u})`, ylabel: `Vertical speed (${rocUnit()})`, xfmt: v => num(v, 0), yfmt: v => num(v, units() === 'us' ? 0 : 1), pl: 62 });
    tr.clip();
    c.strokeStyle = cssVar('--border-strong'); c.beginPath(); c.moveTo(tr.pl, tr.sy(0)); c.lineTo(tr.pl + tr.iw, tr.sy(0)); c.stroke();
    tr.line(pts, cssVar('--accent'), 2.4);
    // tangent from the origin: steepest climb (powered) or flattest glide
    const k = glider ? sp.Vmd : sp.Vx, sk = P.state(R.a, R.atm, k, R.w, R.r), kx = V2d(k * Math.cos(sk.gamma)), ky = rocDisp(sk.Ps);
    tr.line([[0, 0], [kx * 1.6, ky * 1.6]], cssVar('--lower'), 1.4, [6, 4]);
    tr.dot(kx, ky, cssVar('--lower')); tr.text(kx, ky, glider ? `  best glide ${show('speed', k, 0)} (1 : ${sp.LDmax.toFixed(1)})` : `  Vx ${show('speed', k, 0)}, γ ${(sk.gamma * DEG).toFixed(1)}°`, cssVar('--text-2'), 'left', 'top');
    const t = glider ? sp.Vmp : sp.Vy, st = P.state(R.a, R.atm, t, R.w, R.r);
    tr.dot(V2d(t * Math.cos(st.gamma)), rocDisp(st.Ps), cssVar('--good')); tr.text(V2d(t * Math.cos(st.gamma)), rocDisp(st.Ps), glider ? `min sink ${showRoc(-st.Ps)}  ` : `Vy ${showRoc(st.Ps)}  `, cssVar('--text-2'), 'right', glider ? 'top' : 'bottom');
    const sc = R.st; if (!sc.stalled) tr.dot(V2d(sc.V * Math.cos(sc.gamma)), rocDisp(sc.Ps), cssVar('--warn'), 5);
    c.restore();
  }

  function drawAlt(c, Wd, Hd) {
    if (!R) return;
    const { byAlt, glider, a } = R, zk = z => toDisp('alt', z) / 1000;
    if (S.altView === 'climb' && !glider) {
      const pts = byAlt.map(b => [rocDisp(b.sp.RoCmax), zk(b.z)]);
      const tr = axes(c, Wd, Hd, { x0: 0, x1: Math.max(...pts.map(p => p[0])) * 1.08, y0: 0, y1: zk(a.plot.zMax), xlabel: `Best rate of climb (${rocUnit()})`, ylabel: units() === 'us' ? 'Altitude (1,000 ft)' : 'Altitude (km)', xfmt: v => num(v, 0) });
      tr.clip(); tr.line(pts, cssVar('--accent'), 2.4);
      for (const [z, t, col] of [[R.ceil.service, 'service ceiling', cssVar('--warn')], [R.ceil.abs, 'absolute ceiling', cssVar('--bad')]]) if (z > 0 && z < a.plot.zMax) { tr.line([[0, zk(z)], [1e9, zk(z)]], col, 1.2, [5, 4]); tr.text(tr.ix(tr.pl + tr.iw - 6), zk(z), `${t} ${show('alt', z)}`, col, 'right', 'bottom'); }
      tr.line([[0, zk(perf.z)], [1e9, zk(perf.z)]], cssVar('--text-3'), 1, [2, 3]);
      c.restore();
      return;
    }
    const series = [['Vs', b => b.sp.Vs, cssVar('--bad'), null], [glider ? 'best glide' : 'Vmd', b => b.sp.Vmd, cssVar('--lower'), [5, 4]], ...(glider ? [] : [['Vy', b => b.sp.Vy, cssVar('--good'), [5, 4]], ['Vmax (thrust)', b => b.sp.VmaxAero, cssVar('--accent'), null]]), ['speed limit', b => b.sp.Vlimit, cssVar('--text-3'), [2, 3]]];
    const all = series.flatMap(([, f]) => byAlt.map(b => V2d(f(b)))).filter(isFinite);
    const tr = axes(c, Wd, Hd, { x0: 0, x1: Math.min(Math.max(...all), V2d(R.Vhi) * 1.6) * 1.05, y0: 0, y1: zk(a.plot.zMax), xlabel: `True airspeed (${unit('speed').u})`, ylabel: units() === 'us' ? 'Altitude (1,000 ft)' : 'Altitude (km)', xfmt: v => num(v, 0) });
    tr.clip();
    // shade the level-flight envelope between stall and Vmax
    if (!glider) {
      const okPts = byAlt.filter(b => isFinite(b.sp.VmaxAero));
      c.fillStyle = cssVar('--good'); c.globalAlpha = 0.1; c.beginPath();
      okPts.forEach((b, i) => { const X = tr.sx(V2d(Math.max(b.sp.Vs, b.sp.Vmin || b.sp.Vs))), Y = tr.sy(zk(b.z)); i ? c.lineTo(X, Y) : c.moveTo(X, Y); });
      [...okPts].reverse().forEach(b => c.lineTo(tr.sx(V2d(Math.min(b.sp.VmaxAero, b.sp.Vlimit))), tr.sy(zk(b.z)))); c.fill(); c.globalAlpha = 1;
    }
    for (const [, f, col, dash] of series) tr.line(byAlt.map(b => [V2d(f(b)), zk(b.z)]), col, 2, dash);
    tr.dot(V2d(perf.V), zk(perf.z), cssVar('--warn'), 5);
    c.restore();
    legend(c, tr, series.map(([t, , col, dash]) => [col, t, dash]), tr.pl + tr.iw - 120);
  }

  function drawSR(c, Wd, Hd) {
    if (!R || R.glider) return;
    // metres per kg of fuel → nm per 1,000 lb / km per tonne (or per 100 lb / 100 kg for small aircraft)
    const us = units() === 'us', small = R.a.mass.max < 5000, per = small ? 100 : 1000;
    const kk = us ? 0.45359237 * per / 1852 : per / 1000, ll = us ? `nm per ${per.toLocaleString()} lb` : small ? 'km per 100 kg' : 'km per tonne';
    const pts = R.srCurve.map(p => [V2d(p.V), p.sr * kk]);
    const ys = pts.map(p => p[1]).filter(isFinite);
    if (!ys.length) { c.fillStyle = cssVar('--text-3'); c.fillText('Cannot hold level flight here', 20, 30); return; }
    const tr = axes(c, Wd, Hd, { x0: pts[0][0], x1: pts[pts.length - 1][0], y0: 0, y1: Math.max(...ys) * 1.12, xlabel: `True airspeed (${unit('speed').u})`, ylabel: `Specific range (${ll})`, xfmt: v => num(v, 0), yfmt: v => num(v, 1) });
    tr.clip(); tr.line(pts, cssVar('--accent'), 2.4);
    const rr = R.a.engine === 'ab' ? 'mil' : R.r;
    for (const [V, t, col] of [[R.mrc, 'max range', cssVar('--good')], [R.lrc, 'long range (99%)', cssVar('--lower')]]) { const y = P.specificRange(R.a, R.atm, V, R.w, rr) * kk; if (isFinite(y)) { tr.dot(V2d(V), y, col); tr.text(V2d(V), y, `  ${t} ${show('speed', V, 0)} · M ${(V / R.atm.a).toFixed(2)}`, cssVar('--text-2'), 'left', t.startsWith('max') ? 'bottom' : 'top'); } }
    c.restore();
  }
  function drawPR(c, Wd, Hd) {
    if (!R || R.glider || !R.pr) return;
    const mk = units() === 'us' ? 1 / 0.45359237 / 1000 : 1e-3, mu = units() === 'us' ? '1,000 lb' : 't';
    const small = R.a.mass.max < 5000, mk2 = small ? mk * 1000 : mk, mu2 = small ? (units() === 'us' ? 'lb' : 'kg') : mu;
    const pts = R.pr.map(p => [rangeDisp(p.R), p.payload * mk2]);
    const tr = axes(c, Wd, Hd, { x0: 0, x1: Math.max(...pts.map(p => p[0])) * 1.08, y0: 0, y1: Math.max(R.a.mass.payload * mk2 * 1.2, 1e-6), xlabel: `Range (${rangeUnit()})`, ylabel: `Payload (${mu2})`, xfmt: v => num(v, 0), yfmt: v => num(v, small ? 0 : 1), pl: 62 });
    tr.clip();
    c.fillStyle = cssVar('--accent'); c.globalAlpha = 0.1; c.beginPath(); c.moveTo(tr.sx(0), tr.sy(0)); pts.forEach(p => c.lineTo(tr.sx(p[0]), tr.sy(p[1]))); c.lineTo(tr.sx(pts[pts.length - 1][0]), tr.sy(0)); c.fill(); c.globalAlpha = 1;
    tr.line(pts, cssVar('--accent'), 2.4);
    R.pr.forEach((p, i) => { if (i) { tr.dot(rangeDisp(p.R), p.payload * mk2, cssVar('--accent')); tr.text(rangeDisp(p.R), p.payload * mk2, ` ${p.label}`, cssVar('--text-2'), 'left', 'bottom'); } });
    const pay = Math.max(0, perf.mass - R.a.mass.empty - perf.fuel);
    if (R.cruise) tr.dot(rangeDisp(R.cruise.range), pay * mk2, cssVar('--warn'), 5);
    c.restore();
  }
  function drawRunway(c, Wd, Hd) {
    if (!R) return;
    const to = R.to, ld = R.ld, L = Math.max(to && !to.fail ? to.total : 0, ld.total) * 1.12;
    const x0 = 20, x1 = Wd - 20, X = d => x0 + (x1 - x0) * d / L, rowH = (Hd - 40) / 2;
    const row = (y, segs, label, screen) => {
      c.fillStyle = cssVar('--bg-sunk'); c.fillRect(x0, y + rowH - 16, x1 - x0, 8);
      c.fillStyle = cssVar('--text-2'); c.font = '600 11.5px ' + cssVar('--font'); c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText(label, x0, y);
      let d = 0;
      for (const s of segs) {
        const xa = X(d), xb = X(d + s.len);
        c.fillStyle = s.color; c.fillRect(xa, y + rowH - 16, Math.max(1, xb - xa), 8);
        if (s.h) { c.strokeStyle = s.color; c.lineWidth = 2; c.beginPath(); c.moveTo(xa, y + rowH - 16 - s.h[0] * 34); c.quadraticCurveTo((xa + xb) / 2, y + rowH - 16 - (s.h[0] + s.h[1]) * 17 - (s.h[1] > s.h[0] ? 0 : 6), xb, y + rowH - 16 - s.h[1] * 34); c.stroke(); }
        c.fillStyle = cssVar('--text-2'); c.font = '10.5px ' + cssVar('--font'); c.textAlign = 'center'; c.textBaseline = 'top';
        if (xb - xa > 46) c.fillText(`${s.name} ${showRunway(s.len)}`, (xa + xb) / 2, y + rowH - 4);
        d += s.len;
      }
      c.strokeStyle = cssVar('--warn'); c.setLineDash([3, 3]); c.lineWidth = 1; c.beginPath(); c.moveTo(screen.x, y + 14); c.lineTo(screen.x, y + rowH - 16); c.stroke(); c.setLineDash([]);
      c.fillStyle = cssVar('--warn'); c.font = '10.5px ' + cssVar('--font'); c.textAlign = screen.align; c.textBaseline = 'top'; c.fillText(`${showRunway(screen.h)} screen`, screen.x + (screen.align === 'left' ? 4 : -4), y + 14);
    };
    if (to && !to.fail) row(4, [{ len: to.ground, color: cssVar('--accent'), name: 'ground roll' }, { len: to.air, color: cssVar('--good'), name: 'air', h: [0, 1] }], `Takeoff ${showRunway(to.total)} · liftoff ${show('speed', to.Vlof, 0)} TAS`, { x: X(to.total), h: to.screen, align: 'right' });
    else if (to && to.fail) { c.fillStyle = cssVar('--bad'); c.font = '600 12px ' + cssVar('--font'); c.textAlign = 'left'; c.fillText('Takeoff impossible: thrust cannot overcome drag and friction', x0, 20); }
    else { c.fillStyle = cssVar('--text-3'); c.font = '12px ' + cssVar('--font'); c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText('Launched by winch or aerotow', x0, 8); }
    row(rowH + 20, [{ len: ld.air, color: cssVar('--good'), name: 'air', h: [1, 0] }, { len: ld.free, color: cssVar('--text-3'), name: 'free roll' }, { len: ld.ground, color: cssVar('--lower'), name: 'braking' }], `Landing ${showRunway(ld.total)} · approach ${show('speed', ld.Va, 0)} TAS${isFinite(ld.field) ? ` · field length required ${showRunway(ld.field)}` : ''}`, { x: X(0), h: ld.screen, align: 'left' });
  }

  function insights() {
    const { a, sp, st, glider } = R, L = [];
    if (st.stalled) L.push({ type: 'b', t: 'Slower than the stall speed', d: `Level flight here needs C_L = ${st.CL.toFixed(2)}, more than the wing can make (${a.CLmax}). Speed up past ${show('speed', sp.Vs, 0)}.` });
    else if (perf.V < sp.Vmd && !glider) L.push({ type: 'w', t: 'On the back side of the drag curve', d: 'Below the minimum-drag speed, flying slower needs MORE thrust: induced drag (∝ 1/V²) grows faster than parasite drag falls. Speed is unstable here; on approach pilots hold it with power.' });
    if (glider) {
      L.push({ type: 'i', t: `Glides 1 : ${sp.LDmax.toFixed(1)} at ${show('speed', sp.Vmd, 0)}`, d: `From ${show('alt', perf.z)} it can glide ${showRange(perf.z * sp.LDmax)} in still air. Adding water ballast does not change the best glide ratio, only the speed it happens at (× √weight): better for fast cross-country flights in strong lift.` });
    } else {
      L.push({ type: 'i', t: `Best rate ${show('speed', sp.Vy, 0)} vs best angle ${show('speed', sp.Vx, 0)}`, d: 'Vy maximises excess power (T−D)·V: the most height per minute. Vx maximises excess thrust T−D: the most height per distance, for clearing obstacles. Both converge at the absolute ceiling, where only one speed can hold altitude.' });
      if (a.engine === 'piston') L.push({ type: 'i', t: 'Propeller: thrust falls with speed', d: 'Power is roughly constant, so thrust ≈ ηP/V. That is why piston aircraft are compared on power curves, and why max endurance is at the minimum-power speed, slower than best glide.' });
      if (a.engine === 'hbp' || a.engine === 'dry') L.push({ type: 'i', t: 'Jet: thrust roughly constant with speed', d: 'With constant thrust, the best climb angle is at the minimum-drag speed and best rate is much faster. Jets get their range by flying high, where the same equivalent airspeed means a much higher true speed for the same drag.' });
      if (a.engine === 'ab') L.push({ type: 'i', t: perf.rating === 'ab' ? 'Afterburner lit' : 'Military (dry) thrust', d: perf.rating === 'ab' ? 'Burning fuel in the exhaust nearly doubles thrust at the cost of about twice the fuel per newton. Supersonic dash and maximum climb use it; cruise does not.' : 'Without afterburner the transonic drag rise stops the aircraft near Mach 1. Range and endurance are computed at military power.' });
      if (perf.dT > 10) L.push({ type: 'w', t: 'Hot day', d: 'Thin air: higher true takeoff speeds and longer ground roll, and jet engines lose thrust above their flat-rating temperature.' });
      if (R.to && !R.to.fail && R.to.total > 0) L.push({ type: 'i', t: `Takeoff needs ${showRunway(R.to.total)}`, d: 'All engines operating. Airliners are certified for an engine failure at the worst moment (balanced field length), which needs considerably more runway.' });
      if (st.M > 0.75 && !a.wave) L.push({ type: 'w', t: 'Transonic drag rise', d: `Above the critical Mach (${a.mcrit}) shocks form on the wing and drag climbs steeply, which caps the cruise Mach.` });
    }
    insightsList(ins, L);
  }

  const offU = onUnits(() => { acSec.rebuild(); cond.rebuild(); buildRwy(); schedule(); });
  compute();
  return {
    controls, main,
    show: () => { if (seen !== perf.version) { acSec.rebuild(); cond.rebuild(); compute(); seen = perf.version; } else [forces, curves, hodo, alt, sr, pr, rw].forEach(x => x.paint()); },
    destroy: () => { offU(); clearTimeout(raf); },
  };
}

// side-view aircraft silhouette, nose to +x, about 60 px long
export function plane(c, color) {
  c.fillStyle = color; c.beginPath();
  c.moveTo(26, 0); c.quadraticCurveTo(22, -4, 10, -4); c.lineTo(-18, -3); c.lineTo(-26, -13); c.lineTo(-30, -13); c.lineTo(-26, -2); c.lineTo(-28, 2); c.lineTo(-18, 3); c.lineTo(10, 3); c.quadraticCurveTo(22, 3, 26, 0); c.fill();
  c.globalAlpha = 0.85; c.beginPath(); c.moveTo(4, 0); c.lineTo(-8, 7); c.lineTo(-12, 7); c.lineTo(-6, 0); c.fill(); c.globalAlpha = 1;
}
