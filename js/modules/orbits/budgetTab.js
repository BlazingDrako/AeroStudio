// Δv budget: a mission from the launch pad, leg by leg (launch with rotation and losses, Hohmann and plane-change
// burns, patched-conic departures and captures, landings), with the rocket equation turning each leg into propellant.
import { h, section, slider, select, field, segmented } from '../../lib/ui.js';
import { Plot } from '../../lib/plot.js';
import * as O from '../../solvers/orbits.js';
import { metricsGrid, insightsList, card, canvasBox, ms, dur, css, D } from './common.js';

const SITES = [
  { id: 'cape', label: 'Cape Canaveral (28.5° N)', lat: 28.5 }, { id: 'kourou', label: 'Kourou (5.2° N)', lat: 5.2 },
  { id: 'baikonur', label: 'Baikonur (45.9° N)', lat: 45.9 }, { id: 'vandenberg', label: 'Vandenberg (34.7° N)', lat: 34.7 },
  { id: 'wenchang', label: 'Wenchang (19.6° N)', lat: 19.6 }, { id: 'sriharikota', label: 'Sriharikota (13.7° N)', lat: 13.7 },
  { id: 'equator', label: 'On the equator (0°)', lat: 0 },
];
const MISSIONS = [
  { id: 'iss', label: 'Low Earth orbit (ISS)' }, { id: 'sso', label: 'Sun-synchronous orbit' }, { id: 'geo', label: 'Geostationary orbit' },
  { id: 'llo', label: 'Low lunar orbit' }, { id: 'moon', label: 'Moon landing and return' }, { id: 'escape', label: 'Escape from Earth' },
  { id: 'mars', label: 'Mars orbit' }, { id: 'venus', label: 'Venus orbit' }, { id: 'jupiter', label: 'Jupiter orbit' },
];

export function budgetTab({ keep }) {
  const S = keep({ mission: 'geo', site: 'cape', park: 200, losses: 1.9, isp: 320, ispL: 330, capture: 'burn' });
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });
  const metrics = metricsGrid();
  const chart = canvasBox('cf-chart', 'auto');
  const wCard = card('Δv budget, leg by leg', 'Each bar is one burn or phase, stacked from the launch pad. Launch includes the speed Earth\'s rotation gives for free and the gravity and drag losses.');
  wCard.append(chart.el);
  const tCard = card('Legs', 'How each leg is worked out, with the propellant it needs from the rocket equation for the Isp chosen (launch legs use the launch Isp).');
  const tEl = h('div'); tCard.append(tEl);
  const mCard = card('The rocket equation', 'Propellant as a share of the starting mass against Δv, m_p/m₀ = 1 − e^(−Δv/(Isp·g₀)). Markers: the in-space part of this mission for the chosen Isp.');
  const mPlot = new Plot(mCard, { xlabel: 'Δv (km/s)', ylabel: 'propellant fraction', xname: 'Δv', yname: 'fraction', xfmt: v => v.toFixed(2) + ' km/s', yfmt: v => (v * 100).toFixed(1) + '%', legendPos: 'above', ylim: [0, 1] });
  mPlot.wrap.style.height = '260px';
  const insCard = card('Notes'); const insEl = h('div'); insCard.append(insEl);
  main.append(metrics.el, wCard, tCard, h('div', { class: 'cf-grid2b' }, mCard, insCard));

  const build = () => {
    const secM = section('Mission');
    const site = SITES.find(s => s.id === S.site) || SITES[0];
    secM.body.append(
      field('Destination', select(MISSIONS.map(m => ({ value: m.id, label: m.label })), S.mission, v => { S.mission = v; build(); paint(); })),
      field('Launch site', select(SITES.map(s => ({ value: s.id, label: s.label })), S.site, v => { S.site = v; paint(); }), 'Sets the latitude: the lowest inclination you can launch into directly, and how much eastward speed the ground gives (465 m/s × cos latitude).'),
      slider({ label: 'Parking orbit altitude (km)', min: 150, max: 1000, step: 5, value: S.park, digits: 0, info: 'The circular low orbit reached first, where the upper stage coasts before the next burn.', onInput: v => { S.park = v; paint(); } }).el,
      h('div', { class: 'hint' }, `From ${site.label.split(' (')[0]} the lowest inclination reachable directly is ${site.lat.toFixed(1)}°.`));
    const secL = section('Losses and engines');
    secL.body.append(
      slider({ label: 'Gravity and drag losses to orbit (km/s)', min: 0.8, max: 2.5, step: 0.05, value: S.losses, digits: 2, info: 'Thrust spent holding the rocket up against gravity while it climbs (1.0–1.5 km/s), pushing through the air (0.1–0.3) and steering (0.1–0.2). Typical totals 1.5–2.0 km/s, which puts low Earth orbit at about 9.3 km/s.', onInput: v => { S.losses = v; paint(); } }).el,
      slider({ label: 'Launch vehicle Isp, average (s)', min: 250, max: 450, step: 1, value: S.ispL, digits: 0, info: 'An average over the stages. Kerosene first stages give about 300 s at sea level rising to 340 s; hydrogen upper stages 450 s.', onInput: v => { S.ispL = v; paint(); } }).el,
      slider({ label: 'In-space Isp (s)', min: 200, max: 465, step: 1, value: S.isp, digits: 0, info: 'Storable bipropellant (MMH/N₂O₄) about 320 s; LOX/methane 360–380 s; LOX/hydrogen up to 465 s. Electric propulsion (1 500–4 000 s) does not fit impulsive burns and is left out.', onInput: v => { S.isp = v; paint(); } }).el);
    if (['mars', 'venus', 'jupiter'].includes(S.mission)) {
      const c = segmented([{ value: 'burn', label: 'Capture burn' }, { value: 'aero', label: 'Aerocapture' }], S.capture, v => { S.capture = v; paint(); });
      c.el.classList.add('seg-wrap');
      secL.body.append(field('Arrival', c.el, 'A burn into a low circular orbit, or diving into the atmosphere to brake (a heat shield instead of propellant; a small burn then raises periapsis out of the air).'));
    }
    controls.replaceChildren(secM.el, secL.el);
  };

  let R = null;
  const compute = () => {
    const E = O.BODIES.earth, site = SITES.find(s => s.id === S.site) || SITES[0], lat = site.lat * D;
    const rP = E.R + S.park * 1e3, vP = Math.sqrt(E.mu / rP), legs = [];
    const add = (name, dv, how, kind = 'space') => legs.push({ name, dv, how, kind });
    const launch = inc => {
      const L = O.launchDv(S.park * 1e3, Math.max(inc, lat), lat, S.losses * 1e3, E);
      add(`Launch to ${S.park.toFixed(0)} km, ${(Math.max(inc, lat) / D).toFixed(1)}°`, L.dv, `circular speed ${ms(L.vc)} − ${ms(L.gain)} from the ground's rotation (azimuth ${(L.az / D).toFixed(1)}°) + ${ms(S.losses * 1e3)} losses`, 'launch');
      if (inc < lat - 1e-9) { const di = lat - inc; add(`Plane change ${(di / D).toFixed(1)}° in the parking orbit`, O.planeChange(vP, di), `2v·sin(Δi/2) at ${ms(vP)}: the inclination wanted is below the site latitude`); }
      return L;
    };
    const m = S.mission;
    if (m === 'iss') {
      launch(51.64 * D);
      const H = O.hohmann(rP, E.R + 418e3, E.mu);
      if (S.park < 418) add('Raise to the ISS (418 km)', H.dv, `Hohmann ${ms(H.dv1)} + ${ms(H.dv2)}, then rendezvous`);
    } else if (m === 'sso') {
      const hs = 700e3, i = O.sunSyncInclination(E.R + hs, 0);
      launch(i);
      const H = O.hohmann(rP, E.R + hs, E.mu);
      add('Raise to 700 km', H.dv, `Hohmann ${ms(H.dv1)} + ${ms(H.dv2)}; inclination ${(i / D).toFixed(2)}° is retrograde, so the ground's rotation costs speed`);
    } else if (m === 'geo') {
      launch(lat);
      const Hp = O.hohmannPlane(rP, 42164e3, lat, E.mu, 'split');
      add('Perigee burn into GTO', Hp.dv1, `prograde ${ms(Hp.v1)} → ${ms(Hp.vt1)}, with ${(Hp.frac * lat / D).toFixed(2)}° of the plane change`);
      add('Apogee burn: circularise and turn to 0°', Hp.dv2, `${ms(Hp.vt2)} → ${ms(Hp.v2)} while turning the plane ${((1 - Hp.frac) * lat / D).toFixed(2)}°, after ${dur(Hp.tof)}`);
    } else if (m === 'llo' || m === 'moon') {
      launch(lat);
      const M = O.BODIES.moon, H = O.hohmann(rP, M.a, E.mu), vM = Math.sqrt(E.mu / M.a), vinf = Math.abs(vM - H.vt2);
      add('Trans-lunar injection', H.dv1, `Hohmann first burn out to the Moon's distance; ${dur(H.tof)} coast`);
      const rL = M.R + 100e3, loi = O.hyperbolicBurn(vinf, rL, M.mu);
      add('Lunar orbit insertion, 100 km', loi, `arrives ${ms(vinf)} relative to the Moon (v∞); brake into a circular orbit: √(v∞² + 2μ/r) − √(μ/r)`);
      if (m === 'moon') {
        const at = (rL + M.R) / 2, vL = Math.sqrt(M.mu / rL), d1 = vL - O.visViva(M.mu, rL, at), d2 = O.visViva(M.mu, M.R, at);
        add('Descent to the surface', d1 + d2 + 150, `descent orbit ${ms(d1)}, then cancel ${ms(d2)} at the surface, + 150 m/s for hovering and gravity losses`);
        add('Ascent to lunar orbit', d1 + d2 + 60, 'the descent in reverse; no atmosphere, so the losses are small');
        add('Trans-Earth injection', loi, 'the insertion burn in reverse; Earth\'s atmosphere then brakes the capsule (reentry, no propellant)');
      }
    } else if (m === 'escape') {
      launch(lat);
      add('Escape burn (C3 = 0)', O.hyperbolicBurn(0, rP, E.mu), `(√2 − 1)·${ms(vP)}: just enough to coast away from Earth on a parabola`);
    } else {
      launch(lat);
      const T = O.BODIES[m], X = O.interplanetary(E, T);
      add(`Departure toward ${T.label}`, O.hyperbolicBurn(X.vinfDep, rP, E.mu), `Sun-centred Hohmann needs v∞ = ${ms(X.vinfDep)}; from the parking orbit √(v∞² + 2μ/r) − √(μ/r); ${dur(X.tof)} cruise`);
      if (m === 'jupiter') {
        // Juno-like: capture into a long ellipse (periapsis 4 200 km above the clouds, apoapsis 8.1 million km, 53 days)
        const rp = T.R + 4200e3, a = (rp + 8.1e9) / 2, capt = Math.sqrt(X.vinfArr ** 2 + 2 * T.mu / rp) - O.visViva(T.mu, rp, a);
        if (S.capture === 'aero') add('Aerocapture at Jupiter', 150, 'in principle; never flown (the entry would be at about 60 km/s)');
        else add('Capture into a 53-day ellipse', capt, `arrives at v∞ = ${ms(X.vinfArr)}; a short burn at a periapsis just above the clouds (Juno needed about 540 m/s). A circular orbit would cost several km/s more`);
      } else {
        const rC = T.R + 300e3, capt = O.hyperbolicBurn(X.vinfArr, rC, T.mu);
        if (S.capture === 'aero') add(`Aerocapture at ${T.label}`, 150, `the atmosphere removes ${ms(capt)}; about 150 m/s of burns raise periapsis and trim the orbit`);
        else add(`Capture into orbit, ${((rC - T.R) / 1e3).toFixed(0)} km`, capt, `arrives at v∞ = ${ms(X.vinfArr)}; braking burn deep in ${T.label}'s gravity well`);
      }
    }
    const out = legs;
    let mass = 1; // kg at the end, working backwards
    for (let j = out.length - 1; j >= 0; j--) { const l = out[j], mr = O.massRatio(l.dv, l.kind === 'launch' ? S.ispL : S.isp); l.mr = mr; l.prop = mass * (mr - 1); mass *= mr; l.m0 = mass; }
    const launchDv = out.filter(l => l.kind === 'launch').reduce((s, l) => s + l.dv, 0), space = out.filter(l => l.kind !== 'launch').reduce((s, l) => s + l.dv, 0);
    R = { legs: out, total: launchDv + space, launch: launchDv, space, mass, site, lat };
  };

  const paint = () => {
    compute();
    const { legs, total, launch, space, mass, site } = R;
    const spaceMR = O.massRatio(space, S.isp);
    metrics.set([
      { k: 'From the pad', v: (total / 1e3).toFixed(2) + ' km/s', s: `${legs.length} legs` },
      { k: 'To the parking orbit', v: (launch / 1e3).toFixed(2) + ' km/s', s: `from ${site.label.split(' (')[0]}` },
      { k: 'In space', v: (space / 1e3).toFixed(2) + ' km/s', s: 'beyond the parking orbit' },
      { k: 'In-space mass ratio', v: spaceMR.toFixed(2), s: `${((1 - 1 / spaceMR) * 100).toFixed(1)}% propellant at Isp ${S.isp} s`, tip: 'm₀/m_f = e^(Δv/(Isp·g₀)) for the legs after the parking orbit, as one stage with no dry mass dropped.' },
      { k: 'Lift-off mass per kg', v: mass < 1e4 ? mass.toFixed(0) + ' kg' : mass.toExponential(2) + ' kg', s: 'propellant only, ideal staging', tip: 'Everything before the final kilogram, counting only propellant (no tanks, engines or structure). Real rockets carry 2–4× more because of the dry mass of each stage.' },
    ]);
    // table
    const rows = legs.map((l, j) => h('tr', {},
      h('td', { style: { textAlign: 'left', fontFamily: 'var(--font)' } }, h('b', {}, l.name), h('div', { class: 'hint', style: { margin: '2px 0 0', whiteSpace: 'normal', maxWidth: '520px' } }, l.how)),
      h('td', {}, ms(l.dv)), h('td', {}, (legs.slice(0, j + 1).reduce((s, x) => s + x.dv, 0) / 1e3).toFixed(2) + ' km/s'), h('td', {}, l.mr.toFixed(3)), h('td', {}, l.prop < 1e4 ? l.prop.toFixed(2) + ' kg' : l.prop.toExponential(2) + ' kg')));
    tEl.replaceChildren(h('div', { class: 'table-wrap' }, h('table', { class: 'data orb-legs' }, h('thead', {}, h('tr', {}, ...['Leg', 'Δv', 'running total', 'mass ratio', 'propellant per kg delivered'].map((x, i) => h('th', { style: i === 0 ? { textAlign: 'left' } : null }, x)))), h('tbody', {}, ...rows))));
    // rocket equation
    const xs = Array.from({ length: 121 }, (_, k) => k * 0.1);
    const ser = [[300, '--lower'], [380, '--turb'], [450, '--good']].map(([isp, c]) => ({ x: xs, y: xs.map(v => O.propFraction(v * 1e3, isp)), color: css(c), label: `Isp ${isp} s`, dash: [5, 4] }));
    ser.push({ x: xs, y: xs.map(v => O.propFraction(v * 1e3, S.isp)), color: css('--accent'), label: `Isp ${S.isp} s (chosen)`, width: 2.4 });
    ser.push({ x: [space / 1e3], y: [O.propFraction(space, S.isp)], color: css('--text'), points: true, line: false, pointSize: 4.5, noLegend: true });
    mPlot.setData({ series: ser, vlines: [{ x: space / 1e3, color: css('--text-2'), dash: [3, 3] }] });
    // notes
    const L = [];
    const L0 = O.launchDv(S.park * 1e3, R.lat, R.lat, 0);
    L.push({ type: 'i', t: `The ground gives ${ms(L0.gain)} for free`, d: `Launching due east from ${site.lat.toFixed(1)}° latitude. At the equator it would be 465 m/s; launching west (retrograde) costs that much instead. That is why most launch sites are near the coast on the east side of a continent, with sea downrange.` });
    if (S.mission === 'geo') { const k = O.hohmann(O.BODIES.earth.R + S.park * 1e3, 42164e3, O.BODIES.earth.mu); L.push({ type: 'i', t: `The latitude costs ${ms(space - k.dv)} on the way to GEO`, d: 'Geostationary orbit is equatorial, so the launch site\'s latitude has to be turned out of the orbit. Kourou (5°) beats Cape Canaveral (28.5°) and Baikonur (46°) by hundreds of m/s, which is why it carries so many commercial satellites.' }); }
    if (S.mission === 'sso') L.push({ type: 'w', t: 'Retrograde costs extra', d: 'Sun-synchronous orbits lean past the pole (98°), so the rocket flies slightly west and the ground\'s rotation works against it. Launch sites with open sea to the south (Vandenberg, Sriharikota) are used.' });
    if (['mars', 'venus', 'jupiter'].includes(S.mission)) L.push({ type: 'i', t: 'Burn deep in the gravity well (Oberth)', d: 'A departure burn in low orbit, where the craft is already fast, adds far more energy than the same Δv far away. The departure costs much less than v∞ + escape speed would suggest.' });
    if (S.mission === 'moon') L.push({ type: 'i', t: 'Most of an Apollo mission was getting to orbit', d: 'Roughly 9.5 km/s to orbit and 3.1 km/s to the Moon, then about 0.9 to stop in lunar orbit, 2 to land, 2 to return to orbit and 0.9 to come home. The Saturn V weighed about 2 900 t for a 5 t capsule back on Earth.' });
    L.push({ type: 'i', t: 'Why rockets are staged', d: `The whole budget at one Isp of ${S.ispL} s needs a mass ratio of ${O.massRatio(total, S.ispL).toFixed(0)}: over ${(100 * O.propFraction(total, S.ispL)).toFixed(1)}% of the rocket would have to be propellant, leaving almost nothing for tanks and engines. Dropping empty stages on the way makes it possible.` });
    insightsList(insEl, L);
    chart.el.style.height = Math.max(150, legs.length * 34 + 56) + 'px';
    chart.draw();
  };

  chart.set(({ W, H, g }) => {
    if (!R) return;
    const { legs, total } = R;
    const pl = Math.min(260, W * 0.36), pr = 70, pt = 10, rowH = 34, iw = W - pl - pr;
    const scale = iw / total;
    const colors = { launch: css('--lower'), space: css('--accent') };
    g.font = '12px ' + css('--font'); g.textBaseline = 'middle';
    // km/s grid
    g.strokeStyle = css('--border'); g.lineWidth = 1; g.fillStyle = css('--text-3'); g.textAlign = 'center';
    const step = total > 12e3 ? 2000 : 1000;
    for (let v = 0; v <= total + 1; v += step) { const x = pl + v * scale; g.beginPath(); g.moveTo(x, pt); g.lineTo(x, pt + legs.length * rowH); g.stroke(); g.font = '10.5px ' + css('--mono'); g.fillText((v / 1e3).toFixed(0), x, pt + legs.length * rowH + 12); }
    g.fillText('cumulative Δv (km/s)', pl + iw / 2, H - 8);
    let acc = 0;
    legs.forEach((l, j) => {
      const y = pt + j * rowH, x0 = pl + acc * scale, w = Math.max(1.5, l.dv * scale);
      g.fillStyle = colors[l.kind] || colors.space; g.globalAlpha = 0.9;
      g.beginPath(); g.roundRect ? g.roundRect(x0, y + 6, w, rowH - 12, 4) : g.rect(x0, y + 6, w, rowH - 12); g.fill(); g.globalAlpha = 1;
      if (j < legs.length - 1) { g.strokeStyle = css('--text-3'); g.setLineDash([2, 3]); g.beginPath(); g.moveTo(x0 + w, y + rowH - 6); g.lineTo(x0 + w, y + rowH + 6); g.stroke(); g.setLineDash([]); }
      g.fillStyle = css('--text'); g.textAlign = 'right'; g.font = '12px ' + css('--font');
      let name = l.name; while (g.measureText(name).width > pl - 12 && name.length > 4) name = name.slice(0, -2) + '…';
      g.fillText(name, pl - 10, y + rowH / 2);
      g.textAlign = 'left'; g.font = '600 11.5px ' + css('--mono'); g.fillStyle = css('--text-2');
      const lab = ms(l.dv), tw = g.measureText(lab).width;
      if (w > tw + 12) { g.fillStyle = '#fff'; g.fillText(lab, x0 + 6, y + rowH / 2); } else g.fillText(lab, x0 + w + 6, y + rowH / 2);
      acc += l.dv;
    });
  });

  let visible = false;
  build();
  return {
    controls, main,
    show() { visible = true; paint(); },
    hide() { visible = false; },
  };
}
