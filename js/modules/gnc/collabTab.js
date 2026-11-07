// Collaborative flight tab, four tools. Formation & wake: the upwash behind each aircraft and the drag it saves the ones
// behind, from airliner pairs (Airbus fello'fly) to display-team diamonds. Fleet tasks: sharing survey jobs across a
// fleet and re-planning when an aircraft loses its data link. Beacon search: search-and-rescue aircraft locating a
// distress beacon by bearings or time differences. Rendezvous: timing a join-up so everyone arrives together.
import { h, section, slider, segmented, select, field, cssVar, icon } from '../../lib/ui.js';
import * as Cb from '../../solvers/collab.js';
import { AIRCRAFT, stallSpeed } from '../../solvers/performance.js';
import { atmosphere, rng, G0 } from '../../solvers/atmosphere.js';
import { card, metricsGrid, insightsList, onUnits, units, num, canvasBox } from '../flight/common.js';
import { axes, legend } from '../flight/perfShared.js';
import { topView, f3 } from './plots.js';

const FT = 0.3048, NM = 1852, KT = 0.514444, LB = 0.45359237, DEG = 180 / Math.PI, D = Math.PI / 180;
const us = () => units() === 'us';
const bigU = () => (us() ? NM : 1000), bigL = () => (us() ? 'nm' : 'km');
const len = m => { const a = Math.abs(m); if (us()) return a < NM ? `${num(m / FT, 0)} ft` : `${f3(m / NM)} nm`; return a < 1000 ? `${num(m, a < 10 ? 1 : 0)} m` : `${f3(m / 1000)} km`; };
const spd = v => (us() ? `${num(v / KT, 0)} kt` : `${num(v, 0)} m/s`);
const mass = kg => (us() ? `${num(kg / LB, 0)} lb` : `${num(kg, 0)} kg`);
const tmin = s => (s >= 90 ? `${num(s / 60, 1)} min` : `${num(s, 0)} s`);
const pct = v => { const a = Math.abs(v) * 100; return a < 0.05 ? '0%' : `${v < 0 ? '−' : ''}${a < 10 ? a.toFixed(1) : a.toFixed(0)}%`; };
const ACS = { a320: 'Airliner (A320-class)', f16: 'Display jet (fighter model)', c172: 'Light aircraft (C172-class)' };
const acOf = id => AIRCRAFT.find(a => a.id === id);
function eqAxes(c, W, H, ext, o, cx = 0, cy = 0) {
  const iw = W - (o.pl ?? 58) - 16, ih = H - 54, ex = iw >= ih ? ext * iw / ih : ext, ey = iw >= ih ? ext : ext * ih / iw;
  return axes(c, W, H, { x0: cx - ex, x1: cx + ex, y0: cy - ey, y1: cy + ey, ...o });
}
function ellipse(c, tr, cov, k, color, w = 1.8, dash = null, cx = 0, cy = 0) {
  const [a, b, d] = cov, m = (a + d) / 2, q = Math.sqrt(((a - d) / 2) ** 2 + b * b), l1 = Math.max(0, m + q), l2 = Math.max(0, m - q), th = 0.5 * Math.atan2(2 * b, a - d);
  const pts = []; for (let i = 0; i <= 72; i++) { const t = i / 72 * 2 * Math.PI, u = k * Math.sqrt(l1) * Math.cos(t), v = k * Math.sqrt(l2) * Math.sin(t); pts.push([cx + u * Math.cos(th) - v * Math.sin(th), cy + u * Math.sin(th) + v * Math.cos(th)]); }
  tr.line(pts, color, w, dash);
}
const dot = (c, tr, x, y, r, color, fill = true) => { c.beginPath(); c.arc(tr.sx(x), tr.sy(y), r, 0, 2 * Math.PI); if (fill) { c.fillStyle = color; c.fill(); } else { c.strokeStyle = color; c.lineWidth = 1.8; c.stroke(); } };
const tag = (c, tr, x, y, s, color, dx = 9, dy = -9) => { c.fillStyle = color || cssVar('--text-2'); c.font = '11px ' + cssVar('--font'); c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(s, tr.sx(x) + dx, tr.sy(y) + dy); };
// Drag points on a map: pts() gives world [x, y] pairs, set(i, x, y) moves one
function draggable(box, getTr, pts, set) {
  let drag = -1;
  box.canvas.style.touchAction = 'none';
  const at = e => { const r = box.canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const hit = (tr, mx, my) => { let best = 14, k = -1; pts().forEach((p, i) => { const d = Math.hypot(tr.sx(p[0]) - mx, tr.sy(p[1]) - my); if (d < best) { best = d; k = i; } }); return k; };
  box.canvas.addEventListener('pointerdown', e => { const tr = getTr(); if (!tr) return; drag = hit(tr, ...at(e)); if (drag >= 0) box.canvas.setPointerCapture(e.pointerId); });
  box.canvas.addEventListener('pointermove', e => {
    const tr = getTr(); if (!tr) return; const [mx, my] = at(e);
    if (drag < 0) { box.canvas.style.cursor = hit(tr, mx, my) >= 0 ? 'grab' : 'default'; return; }
    set(drag, tr.ix(mx), tr.iy(my));
  });
  box.canvas.addEventListener('pointerup', () => { drag = -1; });
}
const PRESETS = {
  fello: { label: 'Airliner pair, 3 km apart (fello\'fly)', ac: 'a320', pat: 'echelon', N: 2, lat: 0.86, lon: 3000, step: 0, alt: 11000, mach: 0.78 },
  vfive: { label: 'V of five light aircraft', ac: 'c172', pat: 'v', N: 5, lat: 0.86, lon: 40, step: 0, alt: 1500, mach: 0.17 },
  diamond: { label: 'Display diamond (four jets)', ac: 'f16', pat: 'diamond', N: 4, lat: 0.75, lon: 12, step: 1, alt: 300, mach: 0.55 },
  delta: { label: 'Display delta (six jets)', ac: 'f16', pat: 'delta', N: 6, lat: 0.75, lon: 12, step: 1, alt: 300, mach: 0.55 },
};

export function collabTab({ keep = o => o } = {}) {
  const S = keep({ tool: 'form',
    preset: 'fello', ac: 'a320', pat: 'echelon', N: 2, lat: 0.86, lon: 3000, step: 0, alt: 11000, mach: 0.78,
    nA: 5, nT: 5, obj: 'sum', eps: 2, lost: [], lostMode: 'home', fleet: null, tasks: null, seedA: 4,
    mode: 'tdoa', sigB: 1, sigT: 100, sensors: null, beacon: [3000, 4000], nS: 4,
    nR: 4, Tfac: 1, rac: 'c172', seedR: 3, rset: null });
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });
  const toolSec = section('Tool');
  const toolSeg = segmented([{ value: 'form', label: 'Formation & wake' }, { value: 'task', label: 'Fleet tasks' }, { value: 'sar', label: 'Beacon search' }, { value: 'rv', label: 'Rendezvous' }], S.tool, v => { S.tool = v; build(); });
  toolSeg.el.classList.add('seg-wrap');
  toolSec.body.append(toolSeg.el);
  const inSec = section('Inputs');
  controls.append(toolSec.el, inSec.el);
  const metrics = metricsGrid(), body = h('div'), insCard = card('What is happening here'), ins = h('div'), eqCard = card('Step by step'), eq = h('div');
  insCard.append(ins); eqCard.append(eq);
  main.append(metrics.el, body, h('div', { class: 'flt-grid2' }, insCard, eqCard));
  let R = null, canvases = [];
  const sl = (label, min, max, step, get, set, opts = {}) => slider({ label, min, max, step, value: get(), format: opts.fmt || (v => num(+v, opts.d ?? 0)), info: opts.info, onInput: v => { set(+v); compute(); } }).el;
  const seg = (label, opts, get, set, tip) => { const s = segmented(opts, get(), v => { set(v); compute(); }); s.el.classList.add('seg-wrap'); return field(label, s.el, tip); };
  const repaint = () => canvases.forEach(c => c.paint());
  function build() {
    ({ form: buildForm, task: buildTask, sar: buildSar, rv: buildRv })[S.tool]();
    compute();
  }
  function compute() { ({ form: computeForm, task: computeTask, sar: computeSar, rv: computeRv })[S.tool](); repaint(); }

  // ================= Formation & wake =================
  let topC, mapC, profC;
  function buildForm() {
    const geo = h('div');
    const fillGeo = () => geo.replaceChildren(
      field('Aircraft', select(Object.entries(ACS).map(([v, l]) => ({ value: v, label: l })), S.ac, v => { S.ac = v; S.preset = 'custom'; compute(); })),
      field('Pattern', select([{ value: 'echelon', label: 'Echelon' }, { value: 'v', label: 'V' }, { value: 'diamond', label: 'Diamond' }, { value: 'delta', label: 'Delta' }, { value: 'abreast', label: 'Line abreast' }], S.pat, v => { S.pat = v; S.preset = 'custom'; compute(); })),
      sl('Aircraft', 2, 7, 1, () => S.N, v => { S.N = v; }),
      sl('Lateral spacing (spans, centre to centre)', 0.4, 1.5, 0.01, () => S.lat, v => { S.lat = v; }, { d: 2, info: '1.0 puts the wingtips exactly in line. The best place is a little less: the follower\'s tip just inside the leader\'s tip vortex.' }),
      sl('Distance behind (spans)', 0.5, 400, 0.1, () => S.lon / acOf(S.ac).b, v => { S.lon = v * acOf(S.ac).b; }, { fmt: v => num(+v, +v < 10 ? 1 : 0), info: 'Centre to centre along the flight path, in wingspans. The airliner preset is 3 km; display teams fly about one span apart.' }),
      sl('Step down per row (m)', 0, 10, 0.5, () => S.step, v => { S.step = v; }, { d: 1, info: 'Display teams step each row down a little so pilots can see the lead and stay out of the strongest wake.' }),
      sl(`Altitude (${us() ? 'ft' : 'm'})`, 0, 12500 / (us() ? FT : 1), us() ? 500 : 100, () => S.alt / (us() ? FT : 1), v => { S.alt = v * (us() ? FT : 1); }),
      sl('Mach', 0.12, 0.85, 0.01, () => S.mach, v => { S.mach = v; }, { d: 2 }));
    fillGeo();
    inSec.body.replaceChildren(
      field('Preset', select([...Object.entries(PRESETS).map(([v, p]) => ({ value: v, label: p.label })), { value: 'custom', label: 'Custom' }], S.preset, v => { if (PRESETS[v]) { Object.assign(S, PRESETS[v]); S.preset = v; fillGeo(); compute(); } })),
      geo, h('div', { class: 'hint' }, 'Each aircraft flies level at its default weight. Wakes are modelled as two trailing vortices per aircraft whose cores spread with age.'));
    topC = canvasBox('340px', drawTop); mapC = canvasBox('300px', drawMap); profC = canvasBox('300px', drawProf);
    canvases = [topC, mapC, profC];
    body.replaceChildren(
      card('The formation from above', 'Each aircraft\'s change in induced drag from the others\' wakes: green saves, red costs. Dashed lines: the tip vortices trailing behind each aircraft.', topC.el),
      h('div', { class: 'flt-grid2' },
        card('Where a follower gains', 'One follower behind one leader at this distance: induced-drag saving against lateral and vertical position. The dot is the spacing chosen.', mapC.el),
        card('Saving against lateral spacing', 'The same follower, level with the leader. Inboard it sits in the downwash and pays; just inside the tip vortex it gains the most.', profC.el)));
  }
  function computeForm() {
    const ac = acOf(S.ac), atm = atmosphere(S.alt), V = S.mach * atm.a, W = ac.mass.def * G0, b = ac.b;
    const pos = Cb.pattern(S.pat, S.N, S.lat * b, S.lon, S.step), res = Cb.formation({ pos, b, W, rho: atm.rho, V });
    const ds = Cb.dragSplit(ac, atm, V, W), vs = stallSpeed(ac, atm, W);
    const saves = res.map(r => r.ratio * ds.share), avg = saves.reduce((a, c) => a + c, 0) / S.N, best = Math.max(...res.map(r => r.ratio)), worst = Math.min(...res.map(r => r.ratio));
    const fuelHr = ds.fuel * 3600 * S.N, fuelSaved = fuelHr * avg;
    R = { ac, atm, V, W, b, pos, res, ds, saves };
    // map and profile for one follower
    const nx = 46, nz = 24, grid = [];
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const y = (0.3 + 1.3 * i / (nx - 1)) * b, z = (-0.45 + 0.9 * j / (nz - 1)) * b;
      grid.push([y / b, z / b, Cb.formation({ pos: [{ x: 0, y: 0, z: 0 }, { x: S.lon, y, z }], b, W, rho: atm.rho, V })[1].ratio]);
    }
    const prof = []; for (let f = 0.3; f <= 1.6001; f += 0.01) prof.push([f, Cb.formation({ pos: [{ x: 0, y: 0, z: 0 }, { x: S.lon, y: f * b, z: 0 }], b, W, rho: atm.rho, V })[1].ratio]);
    const pk = prof.reduce((a, p) => (p[1] > a[1] ? p : a), [0, -1]);
    Object.assign(R, { grid, nx, nz, prof, pk });
    const tooSlow = V < 1.2 * vs;
    metrics.set([
      { k: 'Fuel saved by the formation', v: pct(avg), s: `${mass(fuelSaved)} per hour for all ${S.N}`, cls: avg > 0.02 ? 'good' : avg < 0 ? 'bad' : '' },
      { k: 'Best position', v: pct(best), s: 'of its own induced drag', cls: 'good' },
      { k: 'Worst position', v: pct(worst), s: worst < -0.005 ? 'sits in someone\'s downwash' : worst < 0.005 ? 'the leader: nothing ahead of it' : 'still gains', cls: worst < -0.02 ? 'bad' : '' },
      { k: 'Induced drag share', v: pct(ds.share), s: `CL ${f3(ds.CL)} at ${spd(V)}: the most a formation can attack` },
      { k: 'Ideal follower spacing', v: `${f3(pk[0])} spans`, s: `${pct(pk[1])} of induced drag; tips ${len((1 - pk[0]) * b)} overlapped` },
      { k: 'Leader\'s vortex strength', v: `${num(res[0].G, 0)} m²/s`, s: `Γ = W/(ρ V · πb/4); core ${len(res[0].rc)}`, cls: tooSlow ? 'warn' : '' },
    ]);
    const L = [];
    L.push({ type: 'i', t: 'Why flying in a wake saves fuel', d: 'A lifting wing pushes air down behind it and sheds a vortex from each tip. Outside those vortices the air rises. A follower flying in that rising air has its lift tilted slightly forward, which cancels part of its induced drag: it is flying on the leader\'s wasted energy, the way geese do in a V.' });
    if (S.ac === 'a320') L.push({ type: avg > 0.03 ? 'g' : 'i', t: `Airliners: ${pct(saves[saves.length - 1])} of the follower's fuel, ideally`, d: 'Airbus\'s fello\'fly trials (2021) flew an A350 about 3 km behind another and measured a saving of more than 5% on the follower. In service the expected figure is 5–10% per trip once the follower holds position through the wake\'s wandering and the time spent joining up is counted. At cruise induced drag is about a third of the total, so even a perfect slot saves at most that share.' });
    if (S.pat === 'diamond' || S.pat === 'delta') L.push({ type: 'w', t: `Display teams fly for the look, not the fuel: the slot ${pct(res[3] ? res[3].ratio : 0)}`, d: 'In a diamond the slot pilot sits directly behind the lead, in its downwash and turbulence, and steps down to stay clear of the strongest flow. The wingmen sit near the lead\'s tips and gain, but they are so close (wingtip to canopy, under a metre apart in the tightest manoeuvres) that the wake mostly means extra stick work. Teams like the Blue Angels and the Red Arrows rehearse for months to fly it smoothly.' });
    if (S.pat === 'v' || S.pat === 'echelon') L.push({ type: 'i', t: 'The leader works hardest', d: `The lead aircraft gains almost nothing (${pct(res[0].ratio)}); each follower sits in the upwash of the one ahead and, in a V, of the others too. Migrating birds rotate the lead position; a fleet would too.` });
    L.push({ type: 'i', t: `Small errors in position cost a lot`, d: `Move ${num(0.1 * b, 1)} m (a tenth of a span) inboard of the best slot and the saving falls to ${pct(Cb.formation({ pos: [{ x: 0, y: 0, z: 0 }, { x: S.lon, y: (pk[0] - 0.1) * b, z: 0 }], b, W, rho: atm.rho, V })[1].ratio)}. The wake also rolls the follower towards the leader, which needs constant aileron. Automatic formation flight needs precise relative navigation (GNSS between the aircraft) and an autopilot that holds position, not just heading and height.` });
    insightsList(ins, L);
    eq.replaceChildren(h('span', { class: 'eq', html: [
      `Lift W = ${num(W / 1000, 1)} kN, elliptic loading: circulation Γ = W/(ρ V b₀), b₀ = πb/4 = ${num(Math.PI * b / 4, 2)} m → Γ = ${num(res[0].G, 1)} m²/s`,
      'Each tip vortex (Biot–Savart, semi-infinite): w = Γ/(2π) · Δy/(r² + rc²) · ½(1 + X/√(X² + r²))',
      'Core: rc² = (0.05b)² + 5.03·ν·t,  ν = 2×10⁻⁴·Γ,  t = X/V (Lamb–Oseen spreading)',
      'Follower: mean upwash w̄ weighted by its elliptic lift;  ΔD = −W·w̄/V',
      `Own induced drag Dᵢ = W²/(q π b²) = ${num(res[0].Di0, 0)} N;  saving = −ΔD/Dᵢ;  fuel saving ≈ that × induced share (${pct(ds.share)})`,
    ].join('<br>') }));
  }
  function drawTop(c, W, H) {
    if (!R) return;
    const { pos, res, b } = R, xs = pos.map(p => p.x), ys = pos.map(p => p.y);
    const span = Math.max(Math.max(...ys) - Math.min(...ys) + 2 * b, (Math.max(...xs) - Math.min(...xs)) * 1.0 + 2 * b);
    const cx = (Math.max(...ys) + Math.min(...ys)) / 2, cy = -(Math.max(...xs) + Math.min(...xs)) / 2;
    const tr = eqAxes(c, W, H, span / 2 * 1.1, { xlabel: 'Lateral (m)', ylabel: 'Along the flight path (m)', xfmt: v => num(v, 0), yfmt: v => num(-v, 0) }, cx, cy);
    tr.clip();
    const b0 = Math.PI * b / 4, yb = tr.iy(tr.pt + tr.ih);
    pos.forEach(p => { for (const s of [-1, 1]) tr.line([[p.y + s * b0 / 2, -p.x], [p.y + s * b0 / 2, yb]], cssVar('--text-3'), 1, [4, 4], 0.7); });
    c.restore();
    const px = Math.abs(tr.sx(b) - tr.sx(0));
    pos.forEach((p, i) => {
      const r = res[i].ratio, col = Math.abs(r) < 0.02 ? cssVar('--text-2') : r > 0 ? cssVar('--good') : cssVar('--bad');
      const k = Math.max(px / 28, 0.7); c.save(); c.translate(tr.sx(p.y), tr.sy(-p.x)); c.rotate(-Math.PI / 2); c.scale(k, k); topView(c, col); c.restore();
      tag(c, tr, p.y, -p.x, `${i ? i + 1 : 'lead'}  ${pct(r)}`, col, 14 * k + 4, 0);
    });
  }
  function drawMap(c, W, H) {
    if (!R) return;
    const { grid, nx, nz } = R, tr = axes(c, W, H, { x0: 0.3, x1: 1.6, y0: -0.45, y1: 0.45, xlabel: 'Lateral offset (spans)', ylabel: 'Height offset (spans)', xfmt: v => num(v, 1), yfmt: v => num(v, 1) });
    const cw = tr.iw / nx + 1, ch = tr.ih / nz + 1, good = cssVar('--good'), bad = cssVar('--bad');
    for (const [y, z, r] of grid) { c.globalAlpha = Math.min(0.85, Math.abs(r) * 1.3); c.fillStyle = r > 0 ? good : bad; c.fillRect(tr.sx(y) - cw / 2, tr.sy(z) - ch / 2, cw, ch); }
    c.globalAlpha = 1;
    const b0 = Math.PI / 8; c.strokeStyle = cssVar('--text-2'); c.lineWidth = 1.5; c.beginPath(); c.arc(tr.sx(b0), tr.sy(0), 5, 0, 2 * Math.PI); c.stroke();
    tag(c, tr, b0, 0, 'leader\'s tip vortex', cssVar('--text-2'), 8, 12);
    dot(c, tr, S.lat, -S.step / R.b, 5, cssVar('--accent'));
  }
  function drawProf(c, W, H) {
    if (!R) return;
    const pr = R.prof, ys = pr.map(p => p[1] * 100), tr = axes(c, W, H, { x0: 0.3, x1: 1.6, y0: Math.min(...ys) * 1.1, y1: Math.max(...ys) * 1.15, xlabel: 'Lateral spacing (spans)', ylabel: 'Induced-drag saving (%)', xfmt: v => num(v, 1), yfmt: v => num(v, 0) });
    tr.clip(); tr.line([[0.3, 0], [1.6, 0]], cssVar('--text-3'), 1); tr.line(pr.map(p => [p[0], p[1] * 100]), cssVar('--accent'), 2.4); c.restore();
    tr.dot(R.pk[0], R.pk[1] * 100, cssVar('--good'), 5); tr.dot(S.lat, Cb.formation({ pos: [{ x: 0, y: 0, z: 0 }, { x: S.lon, y: S.lat * R.b, z: 0 }], b: R.b, W: R.W, rho: R.atm.rho, V: R.V })[1].ratio * 100, cssVar('--accent'), 5);
    tag(c, tr, R.pk[0], R.pk[1] * 100, `best ${f3(R.pk[0])}`, cssVar('--good'));
  }

  // ================= Fleet tasks =================
  let taskC, ganttC, taskTr = null;
  const AREA = 40000, BASE = [0, -AREA * 0.45];
  function seedFleet() {
    const r = rng(S.seedA), uni = () => Math.tanh(r() * 0.9);   // spread over roughly (−1, 1)
    S.fleet = [...Array(7)].map((_, i) => [(i - 3) * AREA * 0.1 + uni() * AREA * 0.05, BASE[1] + AREA * (0.08 + 0.1 * Math.abs(uni()))]);
    S.tasks = [...Array(8)].map(() => [uni() * AREA * 0.85, AREA * (0.3 + 0.55 * uni())]);
  }
  function buildTask() {
    if (!S.fleet) seedFleet();
    const lostBox = h('div');
    const fillLost = () => lostBox.replaceChildren(...[...Array(S.nA)].map((_, i) => {
      const id = i + 1, b = h('button', { class: 'btn', type: 'button', style: { margin: '0 6px 6px 0', borderColor: S.lost.includes(i) ? 'var(--bad)' : '' }, onclick: () => { S.lost = S.lost.includes(i) ? S.lost.filter(k => k !== i) : [...S.lost, i]; fillLost(); compute(); } }, `${S.lost.includes(i) ? 'Link lost' : 'Linked'}: ${id}`);
      return b;
    }));
    fillLost();
    inSec.body.replaceChildren(
      sl('Aircraft in the fleet', 2, 7, 1, () => S.nA, v => { S.nA = v; S.lost = S.lost.filter(k => k < v); fillLost(); }),
      sl('Survey jobs', 2, 8, 1, () => S.nT, v => { S.nT = v; }),
      field('Plan for', (() => { const g = segmented([{ value: 'sum', label: 'Least total flying' }, { value: 'max', label: 'Earliest finish' }, { value: 'auction', label: 'Auction' }], S.obj, v => { S.obj = v; buildTask(); compute(); }); g.el.classList.add('seg-wrap'); return g.el; })(),
        'Least total flying: the Hungarian algorithm. Earliest finish: the bottleneck assignment, which minimises the slowest job. Auction: each aircraft bids for jobs and prices rise until no one wants to switch; it needs no central planner.'),
      S.obj === 'auction' ? sl('Auction bid increment ε (s)', 0.5, 60, 0.5, () => S.eps, v => { S.eps = v; }, { d: 1, info: 'Larger steps finish in fewer bids but can end up to n·ε from the best plan.' }) : h('div'),
      field('Data link', lostBox, 'Click an aircraft to cut its link to the ground station. Its jobs are re-planned across the others.'),
      seg('On link loss', [{ value: 'home', label: 'Return to base' }, { value: 'finish', label: 'Finish job, then return' }], () => S.lostMode, v => { S.lostMode = v; }, 'What a lost-link aircraft does is agreed before flight, so the rest of the team and air traffic control know what to expect.'),
      h('button', { class: 'btn', type: 'button', onclick: () => { S.seedA++; seedFleet(); compute(); } }, icon('reset', 14), 'New layout'),
      h('div', { class: 'hint' }, 'Drag the aircraft and the jobs on the map. Light aircraft at 110 kt; cost is flying time to the job.'));
    taskC = canvasBox('420px', drawTask); ganttC = canvasBox('220px', drawGantt);
    canvases = [taskC, ganttC];
    draggable(taskC, () => taskTr, () => [...S.fleet.slice(0, S.nA), ...S.tasks.slice(0, S.nT)], (i, x, y) => { if (i < S.nA) S.fleet[i] = [x, y]; else S.tasks[i - S.nA] = [x, y]; compute(); });
    body.replaceChildren(
      card('Who flies where', 'Blue: aircraft and their routes to the job they were given. Grey squares: jobs. Red dashed: an aircraft that has lost its link, flying its agreed lost-link route.', taskC.el),
      card('When each job starts', 'Flying time from each aircraft to its job. The plan for least total flying and the plan for the earliest finish are often different.', ganttC.el));
  }
  function computeTask() {
    const V = 110 * KT, fleet = S.fleet.slice(0, S.nA), tasks = S.tasks.slice(0, S.nT);
    const tt = (a, t) => Math.hypot(a[0] - t[0], a[1] - t[1]) / V;
    // a lost-link aircraft that finishes its job keeps it; one that goes home drops it
    const full = solve(fleet.map((a, i) => i), tasks.map((t, j) => j));
    const kept = S.lostMode === 'finish' ? S.lost.map(i => [i, full.asg[i]]).filter(p => p[1] >= 0) : [];
    const active = fleet.map((_, i) => i).filter(i => !S.lost.includes(i)), open = tasks.map((_, j) => j).filter(j => !kept.some(k => k[1] === j));
    const plan = solve(active, open);
    function solve(rows, cols) {
      if (!rows.length || !cols.length) return { asg: rows.map(() => -1), bids: 0 };
      const C = rows.map(i => cols.map(j => tt(fleet[i], tasks[j])));
      let r;
      if (rows.length <= cols.length || S.obj !== 'auction') r = S.obj === 'max' ? Cb.bottleneck(C) : S.obj === 'auction' ? Cb.auction(C, S.eps) : Cb.hungarian(C);
      else r = Cb.hungarian(C);   // the auction here needs no more aircraft than jobs
      const asg = new Array(fleet.length).fill(-1); rows.forEach((i, k) => { asg[i] = r.asg[k] >= 0 ? cols[r.asg[k]] : -1; });
      return { asg, bids: r.bids || 0 };
    }
    const asg = new Array(fleet.length).fill(-1); active.forEach(i => { asg[i] = plan.asg[i]; }); kept.forEach(([i, j]) => { asg[i] = j; });
    const times = fleet.map((a, i) => (asg[i] >= 0 ? tt(a, tasks[asg[i]]) : null));
    const done = times.filter(t => t != null), unassigned = tasks.map((_, j) => j).filter(j => !asg.includes(j));
    const tot = done.reduce((a, c) => a + c, 0), fin = done.length ? Math.max(...done) : 0;
    const alt = (() => { const C = fleet.map(a => tasks.map(t => tt(a, t))); const s = Cb.hungarian(C), m = Cb.bottleneck(C); return { sumT: s.total, sumW: Math.max(...s.asg.map((j, i) => (j >= 0 ? C[i][j] : 0))), maxT: m.total, maxW: m.worst }; })();
    R = { fleet, tasks, asg, times, unassigned, V };
    metrics.set([
      { k: 'Total flying to the jobs', v: tmin(tot), s: `${done.length} jobs covered` },
      { k: 'Last job started at', v: tmin(fin), s: S.obj === 'max' ? 'as early as possible' : 'not necessarily the earliest' },
      { k: 'Jobs waiting', v: num(unassigned.length, 0), s: unassigned.length ? 'more jobs than linked aircraft: they wait for the next sortie' : 'every job has an aircraft', cls: unassigned.length ? 'warn' : 'good' },
      { k: 'Lost link', v: S.lost.length ? `${S.lost.length} aircraft` : 'none', s: S.lost.length ? (S.lostMode === 'home' ? 'returning to base; jobs re-planned' : 'finishing its job, then returning') : 'all reporting', cls: S.lost.length ? 'warn' : '' },
      S.obj === 'auction' ? { k: 'Auction bids', v: num(plan.bids, 0), s: `ε = ${f3(S.eps)} s; within ${tmin(S.nA * S.eps)} of the best plan` } : { k: 'The two plans compared', v: `${tmin(alt.sumT)} vs ${tmin(alt.maxT)}`, s: `total flying; last start ${tmin(alt.sumW)} vs ${tmin(alt.maxW)}` },
    ]);
    const L = [];
    L.push({ type: 'i', t: 'Sharing out the jobs is an assignment problem', d: `With ${S.nA} aircraft and ${S.nT} jobs there are ${num([...Array(Math.min(S.nA, S.nT))].reduce((a, _, k) => a * (Math.max(S.nA, S.nT) - k), 1), 0)} possible pairings. The Hungarian algorithm (Kuhn, 1955) finds the best one in about n³ steps instead of trying them all: it adjusts a price on each job and each aircraft until the cheapest pairings line up.` });
    L.push({ type: 'i', t: 'Least total flying or earliest finish?', d: 'Minimising the total saves fuel but can leave one aircraft with a long trip. For a search or a fire, finishing the slowest job soonest matters more: the bottleneck plan accepts more total flying to bring the last start forward.' });
    if (S.obj === 'auction') L.push({ type: 'i', t: 'An auction needs no central planner', d: 'Each aircraft bids for the job worth most to it, raising its price by the margin over its second choice plus ε. Outbid aircraft bid again. When nobody wants to switch the auction ends, within n·ε of the best plan (Bertsekas, 1988). Aircraft can run it among themselves over a data link, so the team keeps working if the ground station drops out.' });
    if (S.lost.length) L.push({ type: 'w', t: 'Lost link: predictable beats clever', d: 'An uncrewed aircraft that loses its command link follows a procedure agreed before flight: carry on for a set time, then fly a published route home or to a holding point, squawking 7400 on its transponder. Everyone (the team, the operator, air traffic control) knows what it will do. The rest of the fleet re-plans around the gap.' });
    insightsList(ins, L);
    eq.replaceChildren(h('span', { class: 'eq', html: [
      `Cost cᵢⱼ = distance from aircraft i to job j ÷ ${spd(V)}`,
      'Least total: minimise Σ cᵢ,σ(i) over pairings σ (Hungarian, O(n³))',
      'Earliest finish: minimise maxᵢ cᵢ,σ(i): binary-search a threshold, check a full matching exists using only cheaper pairs, then least total among those',
      'Auction: aircraft i bids for j* = argmax(−cᵢⱼ − pⱼ), raising pⱼ* by (best − second best) + ε',
    ].join('<br>') }));
  }
  function drawTask(c, W, H) {
    if (!R) return;
    const u = bigU(), tr = eqAxes(c, W, H, AREA / u, { xlabel: `East (${bigL()})`, ylabel: `North (${bigL()})`, xfmt: v => num(v, 0), yfmt: v => num(v, 0) }, 0, 0);
    taskTr = { sx: x => tr.sx(x / u), sy: y => tr.sy(y / u), ix: X => tr.ix(X) * u, iy: Y => tr.iy(Y) * u };
    const T = (x, y) => [x / u, y / u];
    c.fillStyle = cssVar('--text-3'); c.fillRect(tr.sx(BASE[0] / u) - 7, tr.sy(BASE[1] / u) - 7, 14, 14);
    tag(c, tr, ...T(...BASE), 'base', cssVar('--text-3'), 10, 0);
    R.tasks.forEach((t, j) => { c.strokeStyle = R.unassigned.includes(j) ? cssVar('--warn') : cssVar('--text-2'); c.lineWidth = 1.8; c.strokeRect(tr.sx(t[0] / u) - 7, tr.sy(t[1] / u) - 7, 14, 14); tag(c, tr, ...T(...t), `job ${String.fromCharCode(65 + j)}`, cssVar('--text-2'), 10, 0); });
    R.fleet.forEach((a, i) => {
      const lost = S.lost.includes(i), j = R.asg[i];
      if (j >= 0) tr.line([T(...a), T(...R.tasks[j])], lost ? cssVar('--bad') : cssVar('--accent'), 2, lost ? [6, 4] : null);
      if (lost) tr.line([j >= 0 ? T(...R.tasks[j]) : T(...a), T(...BASE)], cssVar('--bad'), 1.6, [6, 4]);
      dot(c, tr, ...T(...a), 7, lost ? cssVar('--bad') : cssVar('--accent'));
      tag(c, tr, ...T(...a), `${i + 1}`, cssVar('--text'), -4, 0);
    });
  }
  function drawGantt(c, W, H) {
    if (!R) return;
    const n = R.fleet.length, tm = Math.max(1, ...R.times.filter(t => t != null)) / 60;
    const tr = axes(c, W, H, { x0: 0, x1: tm * 1.15, y0: 0.4, y1: n + 0.6, ystep: 1, xlabel: 'Flying time to the job (min)', ylabel: 'Aircraft', xfmt: v => num(v, 0), yfmt: v => (Number.isInteger(v) && v >= 1 && v <= n ? String(n + 1 - v) : '') });
    R.times.forEach((t, i) => {
      const y = n - i, lost = S.lost.includes(i);
      if (t == null) { tag(c, tr, 0, y, lost ? 'returning to base' : 'no job', cssVar(lost ? '--bad' : '--text-3'), 4, 0); return; }
      c.fillStyle = cssVar(lost ? '--bad' : '--accent'); c.globalAlpha = 0.75; c.fillRect(tr.sx(0), tr.sy(y) - 8, tr.sx(t / 60) - tr.sx(0), 16); c.globalAlpha = 1;
      tag(c, tr, t / 60, y, `job ${String.fromCharCode(65 + R.asg[i])}`, cssVar('--text-2'), 6, 0);
    });
  }

  // ================= Beacon search =================
  let sarC, sarTr = null;
  function seedSensors() { const r = 9000; S.sensors = [...Array(6)].map((_, i) => { const a = (i / 6) * 2 * Math.PI + 0.4; return [r * Math.sin(a), r * Math.cos(a)]; }); }
  function buildSar() {
    if (!S.sensors) seedSensors();
    inSec.body.replaceChildren(
      seg('Method', [{ value: 'bearing', label: 'Bearings' }, { value: 'tdoa', label: 'Time differences' }], () => S.mode, v => { S.mode = v; },
        'Bearings: each aircraft\'s direction finder measures which way the signal comes from. Time differences: the aircraft share accurately timed receptions, and each difference puts the beacon on a hyperbola.'),
      sl('Search aircraft', 2, 6, 1, () => S.nS, v => { S.nS = v; }),
      sl('Bearing error σ (°)', 0.2, 10, 0.1, () => S.sigB, v => { S.sigB = v; }, { d: 1 }),
      sl('Timing error σ (ns)', 10, 1000, 10, () => S.sigT, v => { S.sigT = v; }, { info: 'Light travels 0.3 m per nanosecond: 100 ns of timing error is 30 m of range difference.' }),
      h('button', { class: 'btn', type: 'button', onclick: () => { seedSensors(); S.beacon = [3000, 4000]; compute(); } }, icon('reset', 14), 'Reset positions'),
      h('div', { class: 'hint' }, 'Drag the aircraft (blue) and the beacon (red). The shading shows how well this team could locate a beacon anywhere on the map.'));
    sarC = canvasBox('460px', drawSar);
    canvases = [sarC];
    draggable(sarC, () => sarTr, () => [...S.sensors.slice(0, S.nS), S.beacon], (i, x, y) => { if (i < S.nS) S.sensors[i] = [x, y]; else S.beacon = [x, y]; compute(); });
    body.replaceChildren(card('Locating the beacon', 'Lines: what each measurement says (bearing lines, or hyperbolas of constant time difference). Grey dots: fixes from 200 sets of noisy measurements. Ellipses: the best any method could do (Cramér–Rao bound, 1σ and 2σ). Shading: that bound across the map (lighter is better).', sarC.el));
  }
  function computeSar() {
    const sens = S.sensors.slice(0, S.nS), sig = S.mode === 'bearing' ? S.sigB * D : S.sigT * 1e-9 * 299792458, p = S.beacon;
    const need = S.mode === 'bearing' ? 2 : 3, C = sens.length >= need ? Cb.crlb(sens, p, S.mode, sig) : null;
    const cloud = C ? Cb.monteCarlo(sens, p, S.mode, sig, 200, rng(9)) : [];
    const shade = []; const ext = 16000, ng = 34;
    if (sens.length >= need) for (let j = 0; j < ng; j++) for (let i = 0; i < 2 * ng; i++) { const q = [-2 * ext + 2 * ext * (i + 0.5) / ng, -ext + 2 * ext * (j + 0.5) / ng], cq = Cb.crlb(sens, q, S.mode, sig); shade.push([q, cq ? Math.sqrt(cq[0][0] + cq[1][1]) : Infinity]); }
    const rms = cloud.length ? Math.sqrt(cloud.reduce((s, q) => s + (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2, 0) / cloud.length) : NaN;
    R = { sens, sig, C, cloud, shade, ext, ng, z: Cb.measure(sens, p, S.mode) };
    const sr = C ? Math.sqrt(C[0][0] + C[1][1]) : Infinity, cep = C ? 0.59 * (Math.sqrt(C[0][0]) + Math.sqrt(C[1][1])) : Infinity;
    metrics.set([
      { k: 'Best possible accuracy (1σ)', v: C ? len(sr) : 'no fix', s: C ? 'Cramér–Rao bound, radial' : `needs at least ${need} aircraft`, cls: C ? (sr < 200 ? 'good' : sr > 2000 ? 'bad' : '') : 'bad' },
      { k: 'Search circle (50%)', v: C ? len(cep) : '—', s: 'CEP: half the fixes fall inside', tip: 'Approximately 0.59(σx + σy).' },
      { k: 'Monte Carlo scatter', v: C ? len(rms) : '—', s: '200 noisy fixes, RMS about the truth' },
      { k: 'Measurement error', v: S.mode === 'bearing' ? `${f3(S.sigB)}°` : `${num(S.sigT, 0)} ns`, s: S.mode === 'bearing' ? `${len(sig * Math.hypot(p[0] - sens[0][0], p[1] - sens[0][1]))} sideways at aircraft 1's range` : `${len(sig)} of range difference` },
    ]);
    const L = [];
    L.push({ type: 'i', t: 'Search and rescue from several aircraft', d: 'Emergency beacons (406 MHz ELTs on aircraft, EPIRBs on boats, personal locator beacons) are located first by satellites (Cospas-Sarsat), to a few kilometres, then by search aircraft homing on the signal. Several aircraft sharing their measurements fix the beacon far faster than one flying a search pattern.' });
    if (S.mode === 'bearing') L.push({ type: 'i', t: 'Bearings: crossing lines', d: 'Each direction finder gives a line; where they cross is the beacon. A bearing error σ becomes a sideways error of σ × range, so distant aircraft contribute little, and lines crossing at a shallow angle smear the fix along them. Lines crossing near 90° are best.' });
    else L.push({ type: 'i', t: 'Time differences: crossing hyperbolas', d: 'The signal reaches each aircraft at a slightly different time. The difference between two of them fixes the difference in distance, which puts the beacon on a hyperbola with the two aircraft as its foci. Three aircraft give two hyperbolas and a fix. Accuracy depends on timing, not range: 100 ns is 30 m. The aircraft need well-synchronised clocks, which GNSS provides.' });
    L.push({ type: sr > 2000 ? 'w' : 'g', t: 'Geometry matters as much as the sensors', d: 'Aircraft spread around the beacon pin it from every side; aircraft bunched together or in a line leave it poorly fixed in one direction (the long axis of the ellipse). The shading shows where this layout works: move an aircraft and watch the good region move. The Cramér–Rao bound is the smallest error any unbiased method can achieve with these measurements; the least-squares fix here reaches it.' });
    insightsList(ins, L);
    eq.replaceChildren(h('span', { class: 'eq', html: [
      S.mode === 'bearing' ? 'Bearing from aircraft i: θᵢ = atan2(x − xᵢ, y − yᵢ) + noise σ' : 'Range difference to aircraft 0: Δᵢ = |p − sᵢ| − |p − s₀| + noise (shared s₀ noise: R = σ²(I + 11ᵀ))',
      S.mode === 'bearing' ? 'Start: the bearing lines\' least-squares crossing; then Gauss–Newton on θ' : 'Start: centre of the aircraft; then Gauss–Newton on Δ',
      'Cramér–Rao: J = Hᵀ R⁻¹ H (H the measurement gradients), covariance ≥ J⁻¹',
      C ? `Here: σx = ${len(Math.sqrt(C[0][0]))}, σy = ${len(Math.sqrt(C[1][1]))}, radial ${len(sr)}` : 'Here: not enough aircraft for a fix',
    ].join('<br>') }));
  }
  function drawSar(c, W, H) {
    if (!R) return;
    const u = bigU(), ext = R.ext / u, tr = eqAxes(c, W, H, ext, { xlabel: `East (${bigL()})`, ylabel: `North (${bigL()})`, xfmt: v => num(v, 0), yfmt: v => num(v, 0) });
    sarTr = { sx: x => tr.sx(x / u), sy: y => tr.sy(y / u), ix: X => tr.ix(X) * u, iy: Y => tr.iy(Y) * u };
    tr.clip();
    const cw = (tr.sx(2 * ext / R.ng) - tr.sx(0)) + 1, acc = cssVar('--accent');
    for (const [q, s] of R.shade) { const a = !isFinite(s) ? 0.5 : Math.min(0.5, Math.max(0, Math.log10(s / 30) / 4)); c.globalAlpha = a; c.fillStyle = acc; c.fillRect(tr.sx(q[0] / u) - cw / 2, tr.sy(q[1] / u) - cw / 2, cw, cw); }
    c.globalAlpha = 1;
    const p = S.beacon;
    if (S.mode === 'bearing') R.sens.forEach(s => { const th = Cb.bearing(s, p), L = 3 * R.ext; tr.line([[s[0] / u, s[1] / u], [(s[0] + L * Math.sin(th)) / u, (s[1] + L * Math.cos(th)) / u]], cssVar('--text-2'), 1, [5, 4]); });
    else R.sens.slice(1).forEach(si => {
      // hyperbola |p − si| − |p − s0| = const, drawn parametrically in the pair's own frame
      const s0 = R.sens[0], mx = (s0[0] + si[0]) / 2, my = (s0[1] + si[1]) / 2, cF = Math.hypot(si[0] - s0[0], si[1] - s0[1]) / 2, ang = Math.atan2(si[1] - s0[1], si[0] - s0[0]);
      const dd = Math.hypot(p[0] - si[0], p[1] - si[1]) - Math.hypot(p[0] - s0[0], p[1] - s0[1]), a = dd / 2, bb = Math.sqrt(Math.max(0, cF * cF - a * a)), pts = [];
      for (let t = -3; t <= 3.001; t += 0.05) { const X = -Math.sign(a || 1) * Math.abs(a) * Math.cosh(t), Y = bb * Math.sinh(t); pts.push([(mx + X * Math.cos(ang) - Y * Math.sin(ang)) / u, (my + X * Math.sin(ang) + Y * Math.cos(ang)) / u]); }
      tr.line(pts, cssVar('--text-2'), 1, [5, 4]);
    });
    c.fillStyle = cssVar('--text-3'); c.globalAlpha = 0.6;
    for (const q of R.cloud) { c.beginPath(); c.arc(tr.sx(q[0] / u), tr.sy(q[1] / u), 1.6, 0, 2 * Math.PI); c.fill(); }
    c.globalAlpha = 1;
    if (R.C) { const k = 1 / (u * u), cov = [R.C[0][0] * k, R.C[0][1] * k, R.C[1][1] * k]; ellipse(c, tr, cov, 1, cssVar('--bad'), 2, null, p[0] / u, p[1] / u); ellipse(c, tr, cov, 2, cssVar('--bad'), 1.3, [5, 4], p[0] / u, p[1] / u); }
    c.restore();
    R.sens.forEach((s, i) => { dot(c, tr, s[0] / u, s[1] / u, 7, acc); tag(c, tr, s[0] / u, s[1] / u, `${i + 1}`, cssVar('--text'), -3, 0); });
    dot(c, tr, p[0] / u, p[1] / u, 6, cssVar('--bad')); tag(c, tr, p[0] / u, p[1] / u, 'beacon', cssVar('--bad'));
  }

  // ================= Rendezvous =================
  let rvC, distC, fuelC;
  function seedRv() { const r = rng(S.seedR); S.rset = [...Array(6)].map((_, i) => { const a = i / 6 * 2 * Math.PI + r() * 0.4, d = (15 + 45 * Math.abs(r()) / 1.5) * 1000; return [d * Math.sin(a), d * Math.cos(a)]; }); }
  function buildRv() {
    if (!S.rset) seedRv();
    inSec.body.replaceChildren(
      field('Aircraft', select([{ value: 'c172', label: ACS.c172 }, { value: 'a320', label: ACS.a320 }], S.rac, v => { S.rac = v; compute(); })),
      sl('Aircraft joining', 2, 6, 1, () => S.nR, v => { S.nR = v; }),
      sl('Join-up time (× earliest possible)', 1, 2.5, 0.01, () => S.Tfac, v => { S.Tfac = v; }, { d: 2, info: 'Meeting later lets everyone fly slower, which can save fuel, until the near ones are down to their minimum speed and have to hold.' }),
      h('button', { class: 'btn', type: 'button', onclick: () => { S.seedR++; seedRv(); compute(); } }, icon('reset', 14), 'New starting positions'),
      h('div', { class: 'hint' }, 'Drag the aircraft on the map. Each flies straight to the join-up point at the centre at a constant speed, holding first if it would arrive early even at its slowest.'));
    rvC = canvasBox('380px', drawRv); distC = canvasBox('260px', drawDist); fuelC = canvasBox('260px', drawFuel);
    canvases = [rvC, distC, fuelC];
    draggable(rvC, () => R && R.tr, () => S.rset.slice(0, S.nR), (i, x, y) => { S.rset[i] = [x, y]; compute(); });
    body.replaceChildren(
      card('Converging on the join-up point', 'Routes in to the join-up point. A circle marks an aircraft that holds before its final leg.', rvC.el),
      h('div', { class: 'flt-grid2' },
        card('Distance to go', 'Every line reaches zero at the same moment.', distC.el),
        card('Fuel against join-up time', 'Total fuel for the team. Too early and the far aircraft race; too late and the near ones hold. The dot marks the time chosen.', fuelC.el)));
  }
  function computeRv() {
    const ac = acOf(S.rac), alt = S.rac === 'a320' ? 9000 : 1500, atm = atmosphere(alt), W = ac.mass.def * G0;
    const vmin = 1.3 * stallSpeed(ac, atm, W), vmax = S.rac === 'a320' ? 0.8 * atm.a : 120 * KT;
    const drones = S.rset.slice(0, S.nR).map(p => ({ dist: Math.hypot(...p), vmin, vmax, p }));
    const T0 = Cb.rendezvous(drones).Tstar, rv = Cb.rendezvous(drones, T0 * S.Tfac);
    const fuelAt = T => Cb.rendezvous(drones, T).plan.reduce((s, q) => s + Cb.legFuel(ac, atm, W, q.dist, q.v, q.hold, q.vmin), 0);
    const fc = []; for (let f = 1; f <= 2.5001; f += 0.02) fc.push([f, fuelAt(T0 * f)]);
    const bestF = fc.reduce((a, q) => (q[1] < a[1] ? q : a), [0, Infinity]), vmd = Cb.minDragSpeed(ac, atm, W);
    R = { ...R, drones, rv, T0, fc, bestF, vmin, vmax, ac, atm, vmd };
    const holders = rv.plan.filter(q => q.hold > 1);
    metrics.set([
      { k: 'Earliest join-up', v: tmin(T0), s: 'the farthest aircraft at full speed' },
      { k: 'Chosen join-up', v: tmin(rv.T), s: `${f3(S.Tfac)}× the earliest` },
      { k: 'Team fuel', v: mass(fuelAt(rv.T)), s: `least at ${f3(bestF[0])}× (${mass(bestF[1])})`, cls: Math.abs(S.Tfac - bestF[0]) < 0.1 ? 'good' : '' },
      { k: 'Holding', v: holders.length ? `${holders.length} aircraft` : 'none', s: holders.length ? `longest ${tmin(Math.max(...holders.map(q => q.hold)))} at ${spd(vmin)}` : 'everyone just adjusts speed' },
      { k: 'Speed range', v: `${spd(vmin)} – ${spd(vmax)}`, s: `1.3 × stall to the limit; least drag at ${spd(vmd)}` },
    ]);
    const L = [];
    L.push({ type: 'i', t: 'Meeting at the same moment', d: 'The earliest everyone can arrive is set by the farthest aircraft flying flat out. Each of the others then flies its distance in that same time, so the nearer ones slow down. An aircraft that cannot slow down enough (it would drop below its minimum safe speed) arrives at that speed and holds first. Join-ups for formation flights, air-to-air refuelling and display teams all work this way, and air traffic control uses the same timing to sequence arrivals.' });
    if (bestF[0] > 1.05) L.push({ type: 'g', t: `Waiting a little saves fuel: best at ${f3(bestF[0])}× the earliest`, d: `Racing costs fuel because drag rises with the square of speed above the minimum-drag speed (${spd(vmd)} here). Meeting later lets the far aircraft slow towards it. Wait too long and the near ones spend the time holding, burning fuel to stay in the same place. The best join-up time is where those balance.` });
    else L.push({ type: 'i', t: 'Here the earliest join-up is also the cheapest', d: `These aircraft cruise close to their most economical speed already (least drag at ${spd(vmd)}), so slowing the far ones saves little, while every extra minute is a minute of holding for the near ones. Faster aircraft with a wider speed range, such as the airliner, show a real minimum.` });
    insightsList(ins, L);
    eq.replaceChildren(h('span', { class: 'eq', html: [
      `Earliest common time T* = maxᵢ dᵢ / Vmax = ${tmin(T0)}`,
      'Speed for arrival at T: Vᵢ = dᵢ / T;  if Vᵢ < Vmin fly at Vmin and hold for T − dᵢ/Vmin',
      'Fuel = fuel flow at D(V) × dᵢ/V + fuel flow at D(Vmin) × t_hold,   D(V) = qS·CD0 + K·W²/(qS)',
      `Minimum-drag speed: induced = zero-lift drag → V = √(2W/(ρS)·√(K/CD0)) = ${spd(vmd)}`,
    ].join('<br>') }));
  }
  function drawRv(c, W, H) {
    if (!R || !R.rv) return;
    const u = bigU(), ext = Math.max(...R.drones.map(d => d.dist)) * 1.15 / u, tr = eqAxes(c, W, H, ext, { xlabel: `East (${bigL()})`, ylabel: `North (${bigL()})`, xfmt: v => num(v, 0), yfmt: v => num(v, 0) });
    R.tr = { sx: x => tr.sx(x / u), sy: y => tr.sy(y / u), ix: X => tr.ix(X) * u, iy: Y => tr.iy(Y) * u };
    R.rv.plan.forEach((q, i) => {
      const [x, y] = q.p; tr.line([[x / u, y / u], [0, 0]], cssVar('--accent'), 1.8);
      if (q.hold > 1) { c.strokeStyle = cssVar('--warn'); c.lineWidth = 1.6; c.beginPath(); c.arc(tr.sx(x / u), tr.sy(y / u), 13, 0, 2 * Math.PI); c.stroke(); }
      dot(c, tr, x / u, y / u, 7, cssVar('--accent')); tag(c, tr, x / u, y / u, `${i + 1}: ${spd(q.v)}${q.hold > 1 ? `, hold ${tmin(q.hold)}` : ''}`, cssVar('--text-2'), 14, 0);
    });
    dot(c, tr, 0, 0, 6, cssVar('--good')); tag(c, tr, 0, 0, 'join-up', cssVar('--good'));
  }
  function drawDist(c, W, H) {
    if (!R || !R.rv) return;
    const u = bigU(), T = R.rv.T, dmax = Math.max(...R.drones.map(d => d.dist)) / u;
    const tr = axes(c, W, H, { x0: 0, x1: T / 60 * 1.05, y0: 0, y1: dmax * 1.08, xlabel: 'Time (min)', ylabel: `Distance to go (${bigL()})`, xfmt: v => num(v, 0), yfmt: v => num(v, 0) });
    tr.clip();
    R.rv.plan.forEach(q => { const d = q.dist / u; tr.line(q.hold > 1 ? [[0, d], [q.hold / 60, d], [T / 60, 0]] : [[0, d], [T / 60, 0]], cssVar('--accent'), 2); });
    c.restore();
  }
  function drawFuel(c, W, H) {
    if (!R || !R.fc) return;
    const k = us() ? 1 / LB : 1, ys = R.fc.map(p => p[1] * k), tr = axes(c, W, H, { x0: 1, x1: 2.5, y0: Math.min(...ys) * 0.97, y1: Math.max(...ys) * 1.02, xlabel: 'Join-up time (× earliest)', ylabel: `Team fuel (${us() ? 'lb' : 'kg'})`, xfmt: v => num(v, 1), yfmt: v => num(v, 0) });
    tr.clip(); tr.line(R.fc.map(p => [p[0], p[1] * k]), cssVar('--accent'), 2.4); c.restore();
    tr.dot(R.bestF[0], R.bestF[1] * k, cssVar('--good'), 5);
    const cur = R.fc.reduce((a, p) => (Math.abs(p[0] - S.Tfac) < Math.abs(a[0] - S.Tfac) ? p : a));
    tr.dot(cur[0], cur[1] * k, cssVar('--accent'), 5);
  }

  const offU = onUnits(() => build());
  build();
  return { controls, main, show: () => repaint(), destroy: () => offU() };
}
