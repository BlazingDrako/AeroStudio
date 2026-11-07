// Stability & trim tab: the aircraft as a balance (wing lift, tail load, weight and the CG / neutral point on the
// mean aerodynamic chord), Cm–α lines for several CG positions, trim elevator against speed, and the derivatives.
import { h, cssVar } from '../../lib/ui.js';
import * as St from '../../solvers/stability.js';
import { card, metricsGrid, insightsList, onUnits, unit, toDisp, show, num, canvasBox } from './common.js';
import { perf, aircraftSection, conditionSection, designSection, stabInput, axes, legend, showForce } from './perfShared.js';

const DEG = 180 / Math.PI;

export function stabilityTab() {
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });
  let R = null, seen = -1;
  const acSec = aircraftSection(src => { if (src === 'aircraft') { cond.rebuild(); des.rebuild(); } schedule(); });
  const cond = conditionSection(() => schedule());
  const des = designSection(() => schedule());
  controls.append(acSec.el, cond.el, des.el);

  const metrics = metricsGrid();
  const bal = canvasBox('360px', drawBalance);
  const balCard = card('The aircraft as a balance', 'Weight acts at the CG; the wing and body lift acts near the wing\'s aerodynamic centre; the tail adds a small force far behind to balance the pitching moments. Below, the mean aerodynamic chord (MAC) magnified: the CG must stay ahead of the neutral point for the aircraft to be stable.', bal.el);
  const cm = canvasBox('320px', drawCm);
  const cmCard = card('Pitching moment against angle of attack', 'Cm–α at the trim elevator for several CG positions. A stable aircraft has a negative slope: a nose-up disturbance makes a nose-down moment. At the neutral point the slope is zero.', cm.el);
  const tv = canvasBox('320px', drawTrimV);
  const tvCard = card('Trim elevator against speed', 'Elevator needed to fly level at each speed. A stable aircraft needs more up-elevator (more pull) to fly slower: the curve slopes the right way. With the CG behind the neutral point it reverses.', tv.el);
  const derCard = card('Stability derivatives', 'Nondimensional derivatives estimated from the geometry (per radian; rates normalised by c̄/2V or b/2V).');
  const derHost = h('div', { class: 'flt-derivs' }); derCard.append(derHost);
  const insCard = card('What is happening here'); const ins = h('div'); insCard.append(ins);
  main.append(metrics.el, h('div', { class: 'flt-grid2' }, balCard, cmCard), h('div', { class: 'flt-grid2' }, tvCard, insCard), derCard);

  let raf = 0;
  const schedule = () => { clearTimeout(raf); raf = setTimeout(compute, 16); };

  function compute() {
    const inp = stabInput(), r = St.analyse(inp), d = r.d, g = d.g;
    // tail load in trim: tail angle of attack = α(1 − dε/dα) − ε0 + i_t + τ·δe
    const eps0 = 2 * g.CL0 / (Math.PI * d.A), at = r.trim.alpha * (1 - d.deda) - eps0 + r.it + g.ht.tau * r.trim.de;
    const Lt = g.ht.eta * d.q * d.St * d.CLat * at;
    R = { inp, r, d, g, Lt, Lwb: d.W - Lt }; seen = perf.version;
    const SMp = d.SM * 100;
    metrics.set([
      { k: 'Neutral point', v: `${(d.hn * 100).toFixed(1)}% MAC`, s: `wing-body a.c. ${(d.hacwb * 100).toFixed(1)}%`, tip: 'The CG position at which the aircraft is neutrally stable in pitch (Cmα = 0).' },
      { k: 'Static margin', v: `${SMp.toFixed(1)}%`, s: SMp > 0 ? 'stable' : 'UNSTABLE', cls: SMp < 0 ? 'bad' : SMp < 5 ? 'warn' : '', tip: 'Distance from the CG forward to the neutral point, in % of MAC. Typical: 5–20%.' },
      { k: 'Cmα', v: d.Cma.toFixed(3), s: '/rad · = CLα·(h − hn)' },
      { k: 'Trim angle of attack', v: `${(r.trim.alpha * DEG).toFixed(2)}°`, s: `C_L ${d.CLtrim.toFixed(3)}${inp.capped ? ' · at M 0.9 (subsonic model)' : ''}` },
      { k: 'Trim elevator', v: `${(r.trim.de * DEG).toFixed(2)}°`, s: r.trim.de < 0 ? 'trailing edge up' : 'trailing edge down', cls: Math.abs(r.trim.de * DEG) > 20 ? 'bad' : '' },
      { k: 'Elevator per g', v: `${(r.perG.dePerG * DEG).toFixed(2)}°/g`, s: `maneuver point ${(r.perG.hm * 100).toFixed(1)}% MAC`, cls: r.perG.dePerG > 0 ? 'bad' : '', tip: 'Extra elevator to pull one more g. The maneuver point (where this goes to zero) is aft of the neutral point because pitch damping helps.' },
      { k: 'Tail load', v: showForce(Math.abs(Lt)), s: Lt < 0 ? 'pushing DOWN' : 'lifting up', tip: 'Force the horizontal tail makes to balance the aircraft. Usually down, which the wing must carry as extra lift.' },
      { k: 'Weathercock Cnβ', v: d.Cnb.toFixed(3), s: d.Cnb > 0 ? 'turns into the wind' : 'UNSTABLE in yaw', cls: d.Cnb <= 0 ? 'bad' : '' },
      { k: 'Dihedral effect Clβ', v: d.Clb.toFixed(3), s: d.Clb < 0 ? 'rolls away from sideslip' : 'rolls INTO sideslip', cls: d.Clb >= 0 ? 'warn' : '' },
    ]);
    bal.paint(); cm.paint(); tv.paint(); derivs(); insights();
  }

  function drawBalance(c, Wd, Hd) {
    if (!R) return;
    const { d, g, r, Lt, Lwb } = R;
    const L = g.L, pad = 30, k = (Wd - 2 * pad) / L, X = x => pad + x * k, y0 = Hd * 0.32;
    const xle = g.xw * L - 0.25 * d.c, xs = h => xle + h * d.c;
    const xcg = xs(d.h), xac = xs(d.hacwb), xt = xle + 0.25 * d.c + g.ht.l;
    // fuselage and surfaces
    const fh = Math.max(10, Math.min(28, g.wf * k * 0.7));
    c.fillStyle = cssVar('--bg-sunk'); c.strokeStyle = cssVar('--border-strong'); c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(X(0), y0); c.quadraticCurveTo(X(0), y0 - fh, X(L * 0.18), y0 - fh); c.lineTo(X(L * 0.62), y0 - fh); c.lineTo(X(L), y0 - fh * 0.35); c.lineTo(X(L), y0 + fh * 0.1); c.lineTo(X(L * 0.62), y0 + fh * 0.6); c.lineTo(X(L * 0.18), y0 + fh); c.quadraticCurveTo(X(0), y0 + fh, X(0), y0); c.fill(); c.stroke();
    const wy = g.wing === 'high' ? y0 - fh : g.wing === 'low' ? y0 + fh * 0.8 : y0;
    c.fillStyle = cssVar('--text-3'); c.fillRect(X(xle), wy - 3, d.c * k, 6);
    const ct = Math.sqrt(d.St / g.ht.AR);                           // tail mean chord
    c.fillRect(X(xt - 0.25 * ct), y0 - fh * 0.5 - 2, ct * k, 4);
    c.beginPath(); c.moveTo(X(L * 0.86), y0 - fh * 0.5); c.lineTo(X(L * 0.93), y0 - fh * 0.5 - g.vt.z * k * 1.6); c.lineTo(X(L), y0 - fh * 0.5 - g.vt.z * k * 1.6); c.lineTo(X(L), y0 - fh * 0.35); c.fill();
    // forces: one scale for all
    const s = Hd * 0.2 / d.W;
    const arrow = (x, len, col, lab) => {
      const X0 = X(x), y1 = y0 - len * s;
      c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 2.6; c.beginPath(); c.moveTo(X0, y0); c.lineTo(X0, y1); c.stroke();
      const dir = Math.sign(len) || 1; c.beginPath(); c.moveTo(X0, y1); c.lineTo(X0 - 6, y1 + 10 * dir); c.lineTo(X0 + 6, y1 + 10 * dir); c.fill();
      c.font = '600 11px ' + cssVar('--font'); c.textAlign = 'center'; c.textBaseline = dir > 0 ? 'bottom' : 'top'; c.fillText(lab, X0, y1 - 4 * dir);
    };
    arrow(xac, Lwb, cssVar('--accent'), `wing + body ${showForce(Lwb)}`);
    arrow(xcg, -d.W, cssVar('--text-2'), `W ${showForce(d.W)}`);
    arrow(xt, Lt * Math.max(1, Math.min(6, d.W / (Math.abs(Lt) * 6 + 1e-9))), Lt < 0 ? cssVar('--lower') : cssVar('--good'), `tail ${Lt < 0 ? '↓' : '↑'} ${showForce(Math.abs(Lt))}`);
    // CG symbol
    c.fillStyle = cssVar('--warn'); c.beginPath(); c.arc(X(xcg), y0, 6, 0, 2 * Math.PI); c.fill();
    // MAC strip
    const my = Hd * 0.74, mx0 = pad, mx1 = Wd - pad, toX = hh => mx0 + (hh + 0.1) / 1.15 * (mx1 - mx0);   // −10% … 105% MAC
    c.fillStyle = cssVar('--bg-sunk'); c.fillRect(toX(0), my - 8, toX(1) - toX(0), 16);
    c.fillStyle = cssVar('--good'); c.globalAlpha = 0.35; c.fillRect(toX(g.cg[0]), my - 8, toX(g.cg[1]) - toX(g.cg[0]), 16); c.globalAlpha = 1;
    c.fillStyle = cssVar('--text-3'); c.font = '10px ' + cssVar('--mono'); c.textAlign = 'center'; c.textBaseline = 'top';
    for (let p = 0; p <= 1.0001; p += 0.1) { c.fillRect(toX(p), my + 8, 1, 4); c.fillText(`${Math.round(p * 100)}%`, toX(p), my + 13); }
    const mark = (hh, col, lab, row, dash) => { const x = toX(Math.max(-0.1, Math.min(1.05, hh))); c.strokeStyle = col; c.lineWidth = 2.4; c.setLineDash(dash || []); c.beginPath(); c.moveTo(x, my - 14); c.lineTo(x, my + 10); c.stroke(); c.setLineDash([]); c.fillStyle = col; c.font = '600 11px ' + cssVar('--font'); c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillText(lab, x, my - 16 - row * 13); };
    mark(d.hacwb, cssVar('--text-3'), 'wing a.c.', 0, [3, 3]);
    mark(d.hn, cssVar('--accent'), `NP ${(d.hn * 100).toFixed(1)}%`, Math.abs(d.hn - d.h) < 0.06 ? 1 : 0);
    mark(r.perG.hm, cssVar('--turb'), 'maneuver pt', Math.abs(r.perG.hm - d.hn) < 0.08 ? 2 : 0, [4, 3]);
    mark(d.h, cssVar('--warn'), `CG ${(d.h * 100).toFixed(1)}%`, 0);
    c.fillStyle = cssVar('--text-3'); c.font = '10.5px ' + cssVar('--font'); c.textAlign = 'left'; c.textBaseline = 'top';
    c.fillText('Mean aerodynamic chord (magnified) · green: certified CG range', mx0, my + 28);
  }

  function drawCm(c, Wd, Hd) {
    if (!R) return;
    const { inp, r, d, g } = R;
    const cgs = [[g.cg[0], 'forward limit', cssVar('--good'), [5, 4]], [d.h, 'current CG', cssVar('--warn'), null], [g.cg[1], 'aft limit', cssVar('--lower'), [5, 4]], [d.hn, 'at neutral point', cssVar('--accent'), [2, 3]]];
    const a0 = -4, a1 = 14, de = r.trim.de;
    const lines = cgs.map(([h, lab, col, dash]) => { const dd = St.derivatives({ ...inp, cg: h, it: r.it }); return { lab, col, dash, f: a => dd.Cm0 + dd.Cma * a / DEG + dd.Cmde * de }; });
    const ys = lines.flatMap(l => [l.f(a0), l.f(a1)]);
    const ym = Math.max(0.05, ...ys.map(Math.abs)) * 1.1;
    const tr = axes(c, Wd, Hd, { x0: a0, x1: a1, y0: -ym, y1: ym, xlabel: 'Angle of attack α (°)', ylabel: 'Pitching moment Cm', xfmt: v => num(v, 0), yfmt: v => v.toFixed(2) });
    tr.clip();
    tr.line([[a0, 0], [a1, 0]], cssVar('--border-strong'), 1);
    for (const l of lines) tr.line([[a0, l.f(a0)], [a1, l.f(a1)]], l.col, l.lab === 'current CG' ? 2.6 : 1.6, l.dash);
    tr.dot(r.trim.alpha * DEG, 0, cssVar('--warn'), 5); tr.text(r.trim.alpha * DEG, 0, '  trim', cssVar('--text-2'), 'left', 'top');
    c.restore();
    legend(c, tr, lines.map(l => [l.col, l.lab, l.dash, 2]), tr.pl + tr.iw - 140);
    c.fillStyle = cssVar('--text-3'); c.font = '10.5px ' + cssVar('--font'); c.textAlign = 'left'; c.textBaseline = 'bottom';
    c.fillText(`elevator held at trim ${(de * DEG).toFixed(1)}°: nose up ↑, nose down ↓`, tr.pl + 8, tr.pt + tr.ih - 4);
  }

  function drawTrimV(c, Wd, Hd) {
    if (!R) return;
    const { inp, r, d, g } = R;
    const Vs = Math.sqrt(2 * d.W / (d.atm.rho * d.S * d.ac.CLmax)), V1 = Math.min(0.9 * d.atm.a, St.derivatives({ ...inp, it: r.it }).atm.a * 0.9);
    const Vlim = Math.min(V1, (d.ac.limits.VNE ?? d.ac.limits.VC ?? d.ac.limits.VD) / Math.sqrt(d.atm.sigma) * 1.1);
    const cgs = [[g.cg[0], 'forward limit', cssVar('--good'), [5, 4]], [d.h, 'current CG', cssVar('--warn'), null], [g.cg[1], 'aft limit', cssVar('--lower'), [5, 4]], [Math.max(d.hn + 0.04, g.cg[1] + 0.05), 'behind the NP', cssVar('--bad'), [2, 3]]];
    const n = 50, xs = Array.from({ length: n + 1 }, (_, i) => 1.15 * Vs + (Vlim - 1.15 * Vs) * i / n);
    const series = cgs.map(([h, lab, col, dash]) => ({ lab, col, dash, pts: xs.map(V => { const dd = St.derivatives({ ...inp, V, cg: h, it: r.it }); return [toDisp('speed', V), St.trim(dd).de * DEG]; }) }));
    const ys = series.flatMap(s => s.pts.map(p => p[1])).filter(isFinite);
    const lo = Math.max(-30, Math.min(...ys)), hi = Math.min(30, Math.max(...ys)), pd = (hi - lo) * 0.1 + 0.5;
    const tr = axes(c, Wd, Hd, { x0: toDisp('speed', xs[0]), x1: toDisp('speed', xs[n]), y0: lo - pd, y1: hi + pd, xlabel: `True airspeed (${unit('speed').u})`, ylabel: 'Trim elevator δe (°, + down)', xfmt: v => num(v, 0), yfmt: v => num(v, 0) });
    tr.clip();
    tr.line([[-1e9, 0], [1e9, 0]], cssVar('--border-strong'), 1);
    for (const s of series) tr.line(s.pts, s.col, s.lab === 'current CG' ? 2.6 : 1.6, s.dash);
    tr.dot(toDisp('speed', d.V), r.trim.de * DEG, cssVar('--warn'), 5);
    c.restore();
    legend(c, tr, series.map(s => [s.col, s.lab, s.dash, 2]), tr.pl + tr.iw - 140, tr.pt + tr.ih - 66);
  }

  function derivs() {
    const d = R.d;
    const L = [['CLα', d.CLa, 'lift slope'], ['Cmα', d.Cma, 'pitch stiffness'], ['Cmq', d.Cmq, 'pitch damping'], ['Cmα̇', d.Cmad, 'downwash lag damping'], ['CLq', d.CLq, 'lift from pitch rate'], ['CLδe', d.CLde, 'elevator lift'], ['Cmδe', d.Cmde, 'elevator power'], ['dε/dα', d.deda, 'downwash gradient']];
    const T = [['Cyβ', d.Cyb, 'side force from sideslip'], ['Cnβ', d.Cnb, 'weathercock stability'], ['Clβ', d.Clb, 'dihedral effect'], ['Clp', d.Clp, 'roll damping'], ['Cnp', d.Cnp, 'yaw from roll rate'], ['Clr', d.Clr, 'roll from yaw rate'], ['Cnr', d.Cnr, 'yaw damping'], ['Clδa', d.Clda, 'aileron power'], ['Cnδa', d.Cnda, 'adverse yaw'], ['Cnδr', d.Cndr, 'rudder power']];
    const tbl = (title, rows) => h('div', {}, h('h4', { style: { margin: '2px 0 6px' } }, title), h('table', { class: 'data' }, h('tbody', {}, ...rows.map(([k, v, m]) => h('tr', {}, h('td', { style: { textAlign: 'left', fontFamily: 'var(--font)' } }, k), h('td', {}, v.toFixed(4)), h('td', { style: { textAlign: 'left', fontFamily: 'var(--font)', color: 'var(--text-3)' } }, m))))));
    derHost.replaceChildren(tbl('Longitudinal', L), tbl('Lateral-directional', T));
  }

  function insights() {
    const { d, r, g, Lt } = R, L = [];
    if (d.SM < 0) L.push({ type: 'b', t: `Statically unstable: CG ${(-d.SM * 100).toFixed(1)}% MAC behind the neutral point`, d: g.relaxed ? 'This is deliberate in the F-16: with relaxed static stability the tail carries an upward load in maneuvers instead of a download, so less trim drag and a more agile aircraft. A fly-by-wire computer stabilises it about 40 times a second; without it the nose would diverge within a second or so.' : 'A nose-up disturbance now makes a nose-up moment, so the disturbance grows. Unpowered, the pilot cannot keep up: the aircraft must be loaded with the CG further forward.' });
    else if (d.SM < 0.05) L.push({ type: 'w', t: 'Very little static margin', d: 'The aircraft is stable but light and twitchy in pitch; small stick inputs give large responses, and the elevator per g is small.' });
    else L.push({ type: 'g', t: `Stable with ${(d.SM * 100).toFixed(1)}% static margin`, d: 'Disturbed in pitch, the aircraft returns to its trimmed angle of attack. Moving the CG forward adds margin but needs more up-elevator to trim and to flare at landing: the forward CG limit is set by elevator power.' });
    if (d.h < g.cg[0] || d.h > g.cg[1]) L.push({ type: 'w', t: 'Outside the certified CG range', d: `Certified ${Math.round(g.cg[0] * 100)}–${Math.round(g.cg[1] * 100)}% MAC. Forward: not enough elevator to flare. Aft: too little stability and stick force per g.` });
    if (Lt < 0) L.push({ type: 'i', t: 'The tail pushes down', d: `The wing carries ${showForce(-Lt)} more than the weight to make up for it: trim drag. Moving the CG aft reduces the download, which is why airliners pump fuel to a tail tank in cruise.` });
    L.push({ type: 'i', t: 'Neutral point vs maneuver point', d: `In a pull-up the tail also meets a curved flow (pitch rate), which adds damping. So the elevator per g goes to zero further aft, at the maneuver point (${(r.perG.hm * 100).toFixed(1)}%), than the trim-change point (neutral point, ${(d.hn * 100).toFixed(1)}%).` });
    if (d.Cnb > 0 && d.Clb < 0) L.push({ type: 'i', t: 'Lateral: weathercock and dihedral', d: 'The fin turns the nose into a sideslip (Cnβ > 0); dihedral, sweep and a high wing roll the aircraft away from it (Clβ < 0). Too much dihedral effect against the fin causes Dutch roll; too little causes a spiral divergence (see Dynamic modes).' });
    insightsList(ins, L);
  }

  const offU = onUnits(() => { acSec.rebuild(); cond.rebuild(); schedule(); });
  compute();
  return {
    controls, main,
    show: () => { if (seen !== perf.version) { acSec.rebuild(); cond.rebuild(); des.rebuild(); compute(); } else [bal, cm, tv].forEach(x => x.paint()); },
    destroy: () => { offU(); clearTimeout(raf); },
  };
}
