// Turn & V–n tab: the turn-rate "doghouse" (energy–maneuverability) chart, a picture of the turn from above
// and behind, and the V–n diagram with maneuver and gust envelopes.
import { h, cssVar } from '../../lib/ui.js';
import * as P from '../../solvers/performance.js';
import { atmosphere, airspeeds, G0 } from '../../solvers/atmosphere.js';
import { card, metricsGrid, insightsList, units, onUnits, unit, toDisp, show, num, canvasBox } from './common.js';
import { perf, ac, W, aircraftSection, conditionSection, axes, legend } from './perfShared.js';

const DEG = 180 / Math.PI, FT = 0.3048;

export function turnTab() {
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });
  let R = null, seen = -1;
  const acSec = aircraftSection(src => { if (src === 'aircraft') cond.rebuild(); schedule(); });
  const cond = conditionSection(() => schedule());
  controls.append(acSec.el, cond.el);

  const metrics = metricsGrid();
  const dog = canvasBox('440px', drawDoghouse);
  const dogCard = card('Turn performance ("doghouse" chart)', 'Turn rate against speed at this altitude. Left: the wing stalls (C_Lmax). Top right: the structure limits the load factor. The corner is where they meet: the fastest possible turn. Ps lines show whether the aircraft gains (+) or loses (−) energy while turning; Ps = 0 is the sustained turn. Dashed straight lines are constant turn radius; dotted curves constant load factor.', dog.el);
  const pic = canvasBox('440px', drawPicture);
  const picCard = card('The turn at this speed', 'Left: the circles flown in a sustained (energy-neutral) turn and the tightest instantaneous turn, to scale. Right: from behind, the tilted lift balances the weight and pulls the aircraft round.', pic.el);
  const vn = canvasBox('380px', drawVn);
  const vnCard = card('V–n diagram', 'The load factors the aircraft may be flown at (solid) and the gust loads it must survive (dashed), against equivalent airspeed. Left curves: stall. Above VA a full control deflection can exceed the limit load.', vn.el);
  const insCard = card('What is happening here'); const ins = h('div'); insCard.append(ins);
  main.append(metrics.el, h('div', { class: 'flt-grid2' }, dogCard, picCard), h('div', { class: 'flt-grid2' }, vnCard, insCard));

  let raf = 0;
  const schedule = () => { clearTimeout(raf); raf = setTimeout(compute, 16); };

  function compute() {
    const a = ac(), w = W(), atm = atmosphere(perf.z, perf.dT), r = perf.rating;
    const sum = P.turnSummary(a, atm, w, r), at = P.turnAt(a, atm, Math.max(perf.V, 1), w, r);
    const vnd = P.vnDiagram(a, { W: w, z: perf.z });
    const mach = a.engine === 'hbp' || a.engine === 'dry' || a.engine === 'ab';
    R = { a, w, atm, r, sum, at, vnd, mach }; seen = perf.version;
    const sp = P.speeds(a, atm, w, r); R.sp = sp;
    metrics.set([
      { k: 'Corner speed', v: show('speed', sum.corner, 0), s: mach ? `M ${(sum.corner / atm.a).toFixed(2)} · ${show('speed', airspeeds('tas', sum.corner, atm).cas, 0)} CAS` : `${show('speed', airspeeds('tas', sum.corner, atm).cas, 0)} CAS`, tip: 'Slowest speed at which the wing can pull the full limit load factor. Turn rate is highest here.' },
      { k: 'Max instantaneous turn', v: `${(sum.rateInstMax * DEG).toFixed(1)}°/s`, s: `${a.limits.nPos} g at the corner` },
      { k: 'Max sustained turn', v: `${(sum.rateSusMax * DEG).toFixed(1)}°/s`, s: `${sum.nAtSus.toFixed(2)} g at ${show('speed', sum.Vsus, 0)}`, tip: 'Fastest turn that can be held without losing speed or height: thrust equals drag.' },
      { k: 'Tightest radius', v: show('len', sum.radiusMin, 0), s: 'instantaneous' },
      { k: 'Sustained here', v: at.nSus > 1 ? `${at.nSus.toFixed(2)} g` : '—', s: at.nSus > 1 ? `bank ${(at.bankSus * DEG).toFixed(0)}° · ${(at.rateSus * DEG).toFixed(1)}°/s · r ${show('len', at.radiusSus, 0)}` : 'cannot hold a level turn', cls: at.nSus > 1 ? '' : 'warn' },
      { k: 'Instantaneous here', v: `${at.nInst.toFixed(2)} g`, s: `${(at.rateInst * DEG).toFixed(1)}°/s · r ${show('len', at.radiusInst, 0)} · ${at.nInst < a.limits.nPos ? 'stall-limited' : 'structure-limited'}` },
      { k: 'Maneuvering speed VA', v: show('speed', vnd.VA, 0), s: 'EAS: full deflection safe below', tip: 'Below VA the wing stalls before the limit load factor is reached, so an abrupt full control input cannot overstress it.' },
      { k: 'Gust load at VC', v: `${(1 + vnd.gustC).toFixed(2)} g`, s: `${show('gust', vnd.UC)} gust · Kg ${vnd.Kg.toFixed(2)}`, cls: 1 + vnd.gustC > a.limits.nPos ? 'bad' : '' },
    ]);
    dog.paint(); pic.paint(); vn.paint(); insights();
  }

  // x axis: Mach for jets, speed for light aircraft
  const xOf = V => (R.mach ? V / R.atm.a : toDisp('speed', V));
  function drawDoghouse(c, Wd, Hd) {
    if (!R) return;
    const { a, atm, w, r, sum } = R;
    const V0 = sum.Vs * 0.95, V1 = Math.min(sum.Vhi, a.plot.Mmax * atm.a), n = 220;
    const Vs = Array.from({ length: n + 1 }, (_, i) => V0 + (V1 - V0) * i / n);
    const T = Vs.map(V => P.turnAt(a, atm, V, w, r));
    const yMax = Math.max(...T.map(t => t.rateInst * DEG)) * 1.15 || 10;
    const tr = axes(c, Wd, Hd, { x0: xOf(V0) * (R.mach ? 0.95 : 0.95), x1: xOf(V1), y0: 0, y1: yMax, xlabel: R.mach ? 'Mach number' : `True airspeed (${unit('speed').u})`, ylabel: 'Turn rate (°/s)', xfmt: v => (R.mach ? v.toFixed(2) : num(v, 0)), yfmt: v => num(v, 0) });
    tr.clip();
    const t3 = cssVar('--text-3');
    // constant-radius lines ω = V/R
    const rU = units() === 'us' ? FT : 1, base = sum.radiusMin / rU, mag = 10 ** Math.floor(Math.log10(base));
    const radii = [1, 2, 3, 5, 10, 20].map(k => k * mag * rU).filter(R0 => R0 >= sum.radiusMin * 0.9).slice(0, 4);
    for (const R0 of radii) {
      const pts = Vs.map(V => [xOf(V), V / R0 * DEG]); tr.line(pts, t3, 1, [6, 5], 0.6);
      const k = pts.findIndex(p => p[1] > yMax * 0.94); const pp = pts[k > 0 ? k : pts.length - 1];
      tr.text(pp[0], Math.min(pp[1], yMax * 0.96), ` r ${show('len', R0, 0)}`, t3, 'left', 'top', '10px');
    }
    // constant load factor curves
    for (let nn = 2; nn <= a.limits.nPos; nn += a.limits.nPos > 5 ? 1 : 0.5) {
      const pts = Vs.map(V => [xOf(V), G0 * Math.sqrt(nn * nn - 1) / V * DEG]); tr.line(pts, t3, 0.8, [1, 3], 0.7);
      tr.text(pts[pts.length - 1][0], pts[pts.length - 1][1], `${nn}g `, t3, 'right', 'bottom', '10px');
    }
    // Ps contours
    const ref = Math.abs(P.speeds(a, atmosphere(0, perf.dT), w, r).RoCmax || 3), step = niceStep(ref / 2.5);
    const levels = []; for (let k = -3; k <= 3; k++) levels.push(k * step);
    const pal = [cssVar('--bad'), cssVar('--lower'), cssVar('--warn'), cssVar('--accent'), cssVar('--good'), cssVar('--lam'), cssVar('--turb')];
    levels.forEach((Ps, i) => {
      const pts = Vs.map((V, j) => { const nn = P.nForPs(a, atm, V, w, r, Ps); return nn >= 1 && nn <= T[j].nInst + 1e-9 ? [xOf(V), G0 * Math.sqrt(nn * nn - 1) / V * DEG] : [NaN, NaN]; });
      if (!pts.some(p => isFinite(p[0]))) return;
      tr.line(pts, Ps === 0 ? cssVar('--accent') : pal[i], Ps === 0 ? 2.6 : 1.3, Ps === 0 ? null : [4, 3], Ps === 0 ? 1 : 0.85);
      const top = pts.reduce((m, p) => (isFinite(p[1]) && p[1] > m[1] ? p : m), [NaN, -Infinity]);   // label at the peak
      const lab = units() === 'us' ? `${num(Ps / FT, 0)} ft/s` : `${num(Ps, 1)} m/s`;
      tr.text(top[0], top[1], `Ps ${Ps > 0 ? '+' : ''}${lab}`, Ps === 0 ? cssVar('--accent') : pal[i], 'center', 'bottom', Ps === 0 ? '600 10.5px' : '10px');
    });
    // limits: stall (left) and structure (top)
    tr.line(Vs.map((V, j) => [xOf(V), T[j].nStall <= a.limits.nPos && T[j].nStall > 1 ? T[j].rateInst * DEG : NaN]), cssVar('--bad'), 2.6);
    tr.line(Vs.map((V, j) => [xOf(V), T[j].nStall >= a.limits.nPos ? T[j].rateInst * DEG : NaN]), cssVar('--text'), 2.6);
    const lim = P.speedLimit(a, atm);
    if (lim < V1 * 1.01) { tr.line([[xOf(lim), 0], [xOf(lim), yMax]], cssVar('--text'), 2, [6, 3]); tr.text(xOf(lim), yMax * 0.5, 'speed limit ', cssVar('--text-2'), 'right'); }
    tr.dot(xOf(sum.corner), sum.rateInstMax * DEG, cssVar('--text'), 5.5); tr.text(xOf(sum.corner), sum.rateInstMax * DEG, '  corner', cssVar('--text'), 'left', 'bottom', '600 11px');
    tr.dot(xOf(sum.Vsus), sum.rateSusMax * DEG, cssVar('--accent'), 5);
    // current speed
    const xv = xOf(perf.V); c.strokeStyle = cssVar('--warn'); c.setLineDash([3, 3]); c.lineWidth = 1.2; c.beginPath(); c.moveTo(tr.sx(xv), tr.pt); c.lineTo(tr.sx(xv), tr.pt + tr.ih); c.stroke(); c.setLineDash([]);
    if (R.at.nSus > 1) tr.dot(xv, R.at.rateSus * DEG, cssVar('--warn'), 4.5);
    tr.dot(xv, R.at.rateInst * DEG, cssVar('--warn'), 4.5);
    c.restore();
    legend(c, tr, [[cssVar('--bad'), 'stall limit (C_Lmax)', null, 2.6], [cssVar('--text'), `structural limit (${a.limits.nPos} g)`, null, 2.6], [cssVar('--accent'), 'sustained turn (Ps = 0)', null, 2.6]], tr.pl + tr.iw - 190, tr.pt + tr.ih - 52);
  }

  function drawPicture(c, Wd, Hd) {
    if (!R) return;
    const { at } = R;
    // top-down circles
    const half = Wd * 0.55, cx = half / 2, cy = Hd / 2 + 10, rMax = Math.min(half, Hd) * 0.4;
    const rS = at.nSus > 1 ? at.radiusSus : Infinity, rI = at.radiusInst;
    const big = isFinite(rS) ? rS : rI * 3, k = rMax / big;
    c.fillStyle = cssVar('--text-2'); c.font = '600 11.5px ' + cssVar('--font'); c.textAlign = 'center'; c.textBaseline = 'top'; c.fillText('From above', cx, 6);
    if (isFinite(rS)) { c.strokeStyle = cssVar('--accent'); c.lineWidth = 2.4; c.beginPath(); c.arc(cx, cy, rS * k, 0, 2 * Math.PI); c.stroke(); }
    c.strokeStyle = cssVar('--lower'); c.setLineDash([6, 4]); c.lineWidth = 2; c.beginPath(); c.arc(cx, cy, rI * k, 0, 2 * Math.PI); c.stroke(); c.setLineDash([]);
    c.fillStyle = cssVar('--text-3'); c.beginPath(); c.arc(cx, cy, 2.5, 0, 2 * Math.PI); c.fill();
    const rr = isFinite(rS) ? rS * k : rI * k;
    c.save(); c.translate(cx + rr, cy); c.rotate(-Math.PI / 2); topView(c, cssVar('--text')); c.restore();
    // scale bar
    const us = units() === 'us', unitM = us ? 1852 : 1000, nice = niceStep(big / 2 / unitM) * unitM, px = nice * k;
    c.strokeStyle = cssVar('--text-2'); c.lineWidth = 1.5; c.beginPath(); c.moveTo(14, Hd - 18); c.lineTo(14 + px, Hd - 18); c.moveTo(14, Hd - 22); c.lineTo(14, Hd - 14); c.moveTo(14 + px, Hd - 22); c.lineTo(14 + px, Hd - 14); c.stroke();
    c.fillStyle = cssVar('--text-2'); c.font = '10.5px ' + cssVar('--font'); c.textAlign = 'left'; c.textBaseline = 'bottom'; c.fillText(`${+(nice / unitM).toPrecision(3)} ${us ? 'nm' : 'km'}`, 14, Hd - 24);
    c.textAlign = 'center'; c.textBaseline = 'top';
    c.fillStyle = cssVar('--accent'); c.fillText(isFinite(rS) ? `sustained: ${show('len', rS, 0)}, ${(360 / (at.rateSus * DEG)).toFixed(0)} s per circle` : 'no sustained level turn', cx, 26);
    c.fillStyle = cssVar('--lower'); c.fillText(`instantaneous: ${show('len', rI, 0)}, bleeding energy`, cx, 40);
    // rear view: bank angle and forces
    const bx = half + (Wd - half) * 0.42, by = Hd * 0.55, nn = isFinite(rS) ? at.nSus : Math.max(1, at.nInst), phi = Math.acos(1 / nn), L0 = Math.min(Hd * 0.22, (Wd - half) * 0.3);
    c.fillStyle = cssVar('--text-2'); c.font = '600 11.5px ' + cssVar('--font'); c.fillText(`From behind (${isFinite(rS) ? 'sustained' : 'instantaneous'})`, bx, 6);
    c.save(); c.translate(bx, by); c.rotate(phi);
    c.fillStyle = cssVar('--text'); c.fillRect(-L0 * 1.1, -2, L0 * 2.2, 4); c.beginPath(); c.arc(0, 0, 9, 0, 2 * Math.PI); c.fill(); c.fillRect(-2, -20, 4, 14); c.fillRect(-L0 * 0.35, -9, L0 * 0.7, 3);
    c.restore();
    const arr = (dx, dy, len, col, lab, dash) => { const ex = bx + dx * len, ey = by + dy * len; c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 2.4; c.setLineDash(dash || []); c.beginPath(); c.moveTo(bx, by); c.lineTo(ex, ey); c.stroke(); c.setLineDash([]); const an = Math.atan2(ey - by, ex - bx); c.beginPath(); c.moveTo(ex, ey); c.lineTo(ex - 9 * Math.cos(an - 0.4), ey - 9 * Math.sin(an - 0.4)); c.lineTo(ex - 9 * Math.cos(an + 0.4), ey - 9 * Math.sin(an + 0.4)); c.fill(); c.font = '600 11px ' + cssVar('--font'); c.textAlign = dx > 0.2 ? 'left' : dx < -0.2 ? 'right' : 'center'; c.textBaseline = dy > 0 ? 'top' : 'bottom'; c.fillText(lab, ex + dx * 6, ey + dy * 6); };
    const Lp = Math.min(L0 * 1.3, (Wd - bx) * 0.62);   // lift drawn at a fixed length; weight is L/n
    arr(Math.sin(phi), -Math.cos(phi), Lp, cssVar('--accent'), `L = ${nn.toFixed(2)} W`);
    arr(0, 1, Lp / nn, cssVar('--text-2'), 'W');
    arr(Math.sin(phi), 0, Lp * Math.sin(phi), cssVar('--lower'), 'pulls into the turn', [4, 3]);
    c.strokeStyle = cssVar('--border-strong'); c.lineWidth = 1; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(bx, by); c.lineTo(bx, by - L0 * 1.4); c.stroke(); c.setLineDash([]);
    c.fillStyle = cssVar('--text-2'); c.font = '11px ' + cssVar('--font'); c.textAlign = 'center'; c.textBaseline = 'top';
    c.fillText(`bank ${(phi * DEG).toFixed(0)}° · n = 1/cos φ = ${nn.toFixed(2)} g`, bx, Hd - 22);
  }

  function drawVn(c, Wd, Hd) {
    if (!R) return;
    const v = R.vnd, a = R.a, X = Ve => toDisp('speed', Ve);
    const nTop = Math.max(a.limits.nPos, 1 + v.gustC, 1 + v.gustD) * 1.12, nBot = Math.min(a.limits.nNeg, 1 - v.gustC, 1 - v.gustD) * 1.12;
    const tr = axes(c, Wd, Hd, { x0: 0, x1: X(v.VD) * 1.08, y0: nBot, y1: nTop, xlabel: `Equivalent airspeed (${unit('speed').u} EAS)`, ylabel: 'Load factor n (g)', xfmt: v => num(v, 0), yfmt: v => num(v, 1) });
    tr.clip();
    const n = 120, pos = [], neg = [];
    for (let i = 0; i <= n; i++) { const Ve = v.VA * i / n; pos.push([X(Ve), v.nStall(Ve)]); }
    for (let i = 0; i <= n; i++) { const Ve = v.VG * i / n; neg.push([X(Ve), v.nStallNeg(Ve)]); }
    const env = [...pos, [X(v.VD), a.limits.nPos], [X(v.VD), 0], [X(v.VC), a.limits.nNeg], [X(v.VG), a.limits.nNeg], ...[...neg].reverse()];
    c.fillStyle = cssVar('--accent'); c.globalAlpha = 0.12; c.beginPath(); env.forEach(([x, y], i) => (i ? c.lineTo(tr.sx(x), tr.sy(y)) : c.moveTo(tr.sx(x), tr.sy(y)))); c.closePath(); c.fill(); c.globalAlpha = 1;
    tr.line(env, cssVar('--accent'), 2.4);
    // stall curves continued (dotted) to show where they would go
    const ext = []; for (let i = 0; i <= n; i++) { const Ve = v.VA * (1 + 0.6 * i / n); ext.push([X(Ve), v.nStall(Ve)]); } tr.line(ext, cssVar('--bad'), 1, [2, 3]);
    // gust lines
    const gl = (Ve, dn, col) => { tr.line([[0, 1], [X(Ve), 1 + dn]], col, 1.2, [5, 4]); tr.line([[0, 1], [X(Ve), 1 - dn]], col, 1.2, [5, 4]); };
    gl(v.VC, v.gustC, cssVar('--lower')); gl(v.VD, v.gustD, cssVar('--warn'));
    tr.line([[X(v.VC), 1 + v.gustC], [X(v.VD), 1 + v.gustD], [X(v.VD), 1 - v.gustD], [X(v.VC), 1 - v.gustC]], cssVar('--lower'), 1.6, [5, 4]);
    tr.line([[0, 1], [X(v.VD) * 2, 1]], cssVar('--text-3'), 1, [2, 4]);
    tr.line([[0, 0], [X(v.VD) * 2, 0]], cssVar('--border-strong'), 1);
    for (const [Ve, t] of [[v.Vs1, 'VS'], [v.VA, 'VA'], [v.VC, 'VC'], [v.VD, 'VD']]) { tr.line([[X(Ve), nBot], [X(Ve), nTop]], cssVar('--text-3'), 0.8, [2, 4]); tr.text(X(Ve), nBot, t, cssVar('--text-2'), 'center', 'bottom', '600 10.5px'); }
    tr.text(X(v.VA) + 2, a.limits.nPos, ` +${a.limits.nPos} g limit`, cssVar('--text-2'), 'left', 'bottom');
    tr.text(X(v.VG) + 2, a.limits.nNeg, ` ${a.limits.nNeg} g limit`, cssVar('--text-2'), 'left', 'top');
    // the current speed (as EAS) with the load factor the wing could pull
    const Ve = airspeeds('tas', perf.V, R.atm).eas;
    if (Ve < X(v.VD) * 2) { const nn = Math.min(v.nStall(Ve), a.limits.nPos); tr.line([[X(Ve), 0], [X(Ve), nn]], cssVar('--warn'), 2); tr.dot(X(Ve), nn, cssVar('--warn')); }
    c.restore();
    legend(c, tr, [[cssVar('--accent'), 'maneuver envelope', null, 2.4], [cssVar('--lower'), `gust ${show('gust', v.UC, 0)} at VC`, [5, 4]], [cssVar('--warn'), `gust ${show('gust', v.UD, 0)} at VD`, [5, 4]]], tr.pl + tr.iw - 170, tr.pt + tr.ih - 60);
  }

  function insights() {
    const { a, at, sum, vnd } = R, L = [];
    L.push({ type: 'i', t: `Corner speed ${show('speed', sum.corner, 0)}`, d: `Slower, the wing stalls before reaching ${a.limits.nPos} g; faster, the structure limits the load while the turn widens (radius ∝ V²). Fighter pilots fight near the corner because it gives the fastest nose-pointing.` });
    if (at.nSus < at.nInst - 0.05) L.push({ type: 'w', t: `${at.nInst.toFixed(1)} g now, but only ${Math.max(at.nSus, 1).toFixed(1)} g can be held`, d: 'Pulling harder than the sustained load factor raises induced drag (∝ n²) beyond the thrust, so the aircraft bleeds speed or height. That energy is spent to point the nose now; it has to be regained later.' });
    if (at.nSus <= 1) L.push({ type: 'b', t: 'Cannot hold a level turn here', d: 'Thrust cannot even balance the drag in level flight at this speed and altitude.' });
    L.push({ type: 'i', t: 'Turn rate and radius', d: 'ω = g√(n²−1)/V and r = V²/(g√(n²−1)): for the same load factor, slower is tighter and quicker. At altitude the same EAS means a higher TAS, so turns get wider.' });
    if (1 + vnd.gustC > a.limits.nPos) L.push({ type: 'b', t: 'Gusts exceed the maneuver limit', d: `At VC a ${show('gust', vnd.UC, 0)} gust gives ${(1 + vnd.gustC).toFixed(2)} g, more than the ${a.limits.nPos} g limit: the gust case sizes the wing. Light, low-wing-loading aircraft are often gust-critical.` });
    else L.push({ type: 'g', t: 'Gust loads within the maneuver limit', d: `A ${show('gust', vnd.UC, 0)} gust at VC adds ${vnd.gustC.toFixed(2)} g (alleviation factor ${vnd.Kg.toFixed(2)}: the aircraft rises with the gust and softens it).` });
    if (a.engine === 'none') L.push({ type: 'i', t: 'Thermalling', d: `A glider circles in rising air. Steeper banks give smaller circles that fit the strong core of a thermal, but sink faster: the Ps lines here are the sink rate while circling.` });
    insightsList(ins, L);
  }

  const offU = onUnits(() => { acSec.rebuild(); cond.rebuild(); schedule(); });
  compute();
  return {
    controls, main,
    show: () => { if (seen !== perf.version) { acSec.rebuild(); cond.rebuild(); compute(); } else [dog, pic, vn].forEach(x => x.paint()); },
    destroy: () => { offU(); clearTimeout(raf); },
  };
}

function niceStep(x) { const p = 10 ** Math.floor(Math.log10(x)), f = x / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; }
// plan-view aircraft, nose to +x
function topView(c, color) {
  c.fillStyle = color; c.beginPath();
  c.moveTo(14, 0); c.lineTo(4, -2); c.lineTo(0, -14); c.lineTo(-4, -14); c.lineTo(-3, -2); c.lineTo(-10, -2); c.lineTo(-12, -6); c.lineTo(-14, -6); c.lineTo(-13, 0);
  c.lineTo(-14, 6); c.lineTo(-12, 6); c.lineTo(-10, 2); c.lineTo(-3, 2); c.lineTo(-4, 14); c.lineTo(0, 14); c.lineTo(4, 2); c.closePath(); c.fill();
}
