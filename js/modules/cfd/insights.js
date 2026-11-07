// Plain-language notes on what the flow is doing at the current settings.
import { nuFromTau } from '../../solvers/lbm.js';
import { cylinderSt, cylinderCd } from './measure.js';

const i = (t, d) => ({ type: 'i', t, d });
const w = (t, d) => ({ type: 'w', t, d });

function bluff(Re, onset, St, what) {
  if (Re < onset * 0.15) return [i('Creeping flow', `Viscosity dominates and the flow wraps smoothly round the ${what} with no separation.`)];
  if (Re < onset) return [i('Separated, steady wake', `The flow separates and two counter-rotating eddies sit still behind the ${what}. Above Re ≈ ${onset} they can no longer stay put and start to shed.`)];
  if (Re < 190) return [i('Kármán vortex street', `Vortices peel off alternately from each side, forming a staggered street. The shedding frequency follows the Strouhal number St = f·D/U ≈ ${St} for this shape.`)];
  return [i('Vigorous shedding (turbulent in reality)', 'Real wakes turn three-dimensional and then turbulent at these Reynolds numbers. This 2-D sandbox keeps its vortices sharper and more regular than a wind tunnel would.')];
}

const SCENE = {
  cylinder: ({ Re }) => {
    const out = bluff(Re, 47, '0.16–0.19', 'cylinder');
    if (Re >= 1000) out.push(i('Drag crisis is far away', 'On a real cylinder the boundary layer stays laminar up to Re ≈ 2×10⁵; then it turns turbulent, separation moves aft and drag suddenly halves. Golf-ball dimples trigger it early.'));
    return out;
  },
  square: ({ Re }) => [...bluff(Re, 50, '0.13–0.15', 'square'), i('Separation fixed at the corners', 'A sharp corner forces the flow to leave the surface right there, at any Re. That is why sharp-edged bodies have a drag coefficient that barely changes with Re, unlike the cylinder.')],
  plate: ({ Re, obj }) => {
    const a = obj ? Math.abs(((obj.angle % 180) + 180) % 180 - 90) : 0;
    if (a < 30) return [i('A plate nearly edge-on', 'Turned almost parallel to the flow, the plate barely disturbs it: only thin boundary layers and a narrow wake. Drag is mostly skin friction.')];
    return [...bluff(Re, 30, '≈ 0.15 (based on plate length)', 'plate'), i('The bluffest body', 'Separation is fixed at the two edges and the wake is as wide as the plate or wider. A flat plate across the flow has a 2-D drag coefficient near 2, about twice a cylinder\'s at the same Re.')];
  },
  triangle: ({ Re }) => bluff(Re, 40, '≈ 0.2', 'triangle'),
  tandem: ({ Re }) => [...bluff(Re, 47, '≈ 0.17', 'front cylinder'), i('Wake interference', 'The rear cylinder sits in the slow, unsteady wake of the front one, so it feels less drag but strong buffeting. Below a spacing of about 3.5 D the front cylinder\'s shear layers reattach on the rear one and it stops shedding on its own; drag on the rear cylinder can even turn negative.')],
  airfoil: ({ Re, obj }) => {
    const a = obj ? obj.angle : 0, out = [];
    if (Math.abs(a) < 4) out.push(i('Attached flow', 'At small angles the flow follows both surfaces and leaves smoothly at the trailing edge (the Kutta condition). Faster flow over the top means lower pressure there, which is the lift.'));
    else if (Math.abs(a) < 10) out.push(i('Lifting, close to its limit', 'The upper-surface flow has to climb back up to free-stream pressure toward the trailing edge. At these low Reynolds numbers the boundary layer is thick and laminar, so it separates near the trailing edge first.'));
    else out.push(i('Stalled', 'The flow cannot follow the upper surface any more; it separates near the leading edge and the wing sheds large vortices like a bluff body. Lift falls and drag rises sharply.'));
    out.push(i('Low Reynolds number', `Re = ${Re.toFixed(0)} is the world of insects and small model aircraft. An airliner wing works at Re ≈ 10⁷, where the boundary layer is turbulent, much thinner and far more resistant to separation, so it stalls nearer 15°.`));
    return out;
  },
  channel: ({ Re, t }) => {
    const out = [i('Poiseuille flow', 'Between two walls a steady pressure gradient balances wall friction, giving a parabolic velocity profile: fastest in the middle, zero at the walls. The mean speed is ⅔ of the centreline speed.')];
    if (t < 0.2 * Re) out.push(i('Still developing', 'Viscosity spreads the motion in from the walls; the profile settles after about 0.1·H²/ν, which is roughly 0.1·Re channel heights of travel. Watch the dye lines change from a flat "plug" shape to a parabola.'));
    out.push(i('Laminar at any Re here', 'Real channel flow turns turbulent above Re ≈ 2000 when disturbed. This 2-D, disturbance-free flow stays laminar much longer; draw an obstacle to disturb it.'));
    return out;
  },
  step: ({ Re }) => [i('Separation at a corner', `The flow leaves the step edge and a recirculating bubble forms behind it, reattaching to the lower wall several step heights downstream. The bubble grows roughly in proportion to Re in the laminar range.${Re > 400 ? ' Above about Re ≈ 400 a second bubble can appear on the upper wall.' : ''}`),
    i('Adverse pressure gradient', 'In the widening channel the flow slows and its pressure rises (switch to the Pressure view). Rising pressure pushes back on slow fluid near the walls, which is what makes the flow separate and recirculate.')],
  cavity: ({ Re }) => [i('One big driven vortex', `The lid drags the fluid round into a single primary vortex. Small counter-rotating eddies form in the bottom corners${Re > 1000 ? ', and at this Re one appears in the top-left corner too' : ''}. As Re rises the vortex centre moves toward the middle of the box.`),
    i('A benchmark', 'Ghia, Ghia & Shin (1982) tabulated this flow precisely, and solver tests still compare against their numbers. This sandbox\'s test suite does too.')],
  jet: ({ Re }) => [i('Shear-layer instability', `Where fast jet fluid meets still fluid, the shear layer is unstable (Kelvin–Helmholtz): small waves grow and roll up into vortices${Re < 30 ? ' (at this low Re viscosity damps them, so the jet stays smooth)' : ''}. The vortices pull in surrounding fluid (entrainment), so the jet widens and slows.`),
    i('Momentum is conserved', 'A free jet carries constant momentum flux. As it entrains still fluid it carries more mass, so it has to slow down: a plane jet\'s centreline speed falls as 1/√x.')],
  jets2: ({ Re }) => [i('Stagnation point', 'Where the jets meet, the fluid comes to rest and its pressure rises to the stagnation value ½ρU² above ambient (see the Pressure view). The flow escapes sideways.'),
    ...(Re > 100 ? [i('An unstable balance', 'Any small imbalance pushes the collision point toward one jet, which then pushes back. Above a modest Re the meeting point flaps from side to side.')] : [])],
  empty: ({ hasObjects }) => (hasObjects ? [] : [i('Add something', 'Pick a shape under Draw and click in the flow to place it, or paint with the brush. The flow reacts as soon as you draw.')]),
};

export function sceneInsights(id, ctx) {
  const out = [];
  if (ctx.unstable) out.push({ type: 'b', t: 'The simulation went unstable', d: 'Values blew up somewhere in the grid. Restart, lower the Reynolds number, use a finer grid or switch the turbulence model on.' });
  out.push(...(SCENE[id] ? SCENE[id](ctx) : []));
  if (['cylinder', 'square', 'plate', 'triangle', 'tandem'].includes(id) && ctx.Re >= 47) out.push(i('Walls nearby', 'The top and bottom are slip walls 4.5 D from the centre (11% blockage). Squeezing the flow raises the shedding frequency and drag slightly compared with open air.'));
  const bl = ctx.L / Math.sqrt(ctx.Re);
  if (bl < 1.2) out.push(w('Grid too coarse for this Re', `The boundary layer is only about ${bl.toFixed(1)} cells thick. The picture stays qualitative; use a finer grid for sharper detail.`));
  if (!ctx.turb && ctx.tau < 0.51) out.push(w('Close to the stability limit', `τ = ${ctx.tau.toFixed(4)}: the lattice viscosity ν = ${nuFromTau(ctx.tau).toExponential(1)} is very small. Without the turbulence model the simulation may blow up.`));
  out.push(...measured(id, ctx));
  if (ctx.moving) out.push(i('Moving obstacle', 'A dragged obstacle pushes the fluid with it: its walls move, so fluid next to them is carried along (no-slip), and it leaves a wake behind it even in still fluid.'));
  return out;
}

// Notes comparing the measured forces with reference values
function measured(id, { Re, meas }) {
  if (!meas || !meas.S || meas.S.settling) return [];
  const { o, S } = meas, out = [];
  const shed = S.shedding ? `, Strouhal number St = ${S.St.toFixed(3)} (lift oscillating ±${S.clAmp.toFixed(2)})` : ', steady wake';
  if (o.type === 'circle' && (id === 'cylinder' || id === 'tandem' || id === 'empty')) {
    const st = cylinderSt(Re), cd = cylinderCd(Re);
    let d = `Measured on the cylinder: mean drag C<sub>D</sub> = ${S.cd.toFixed(3)}${shed}. Open-flow references at Re = ${Re.toFixed(0)}: C<sub>D</sub> ≈ ${cd.toFixed(2)} (White's empirical fit)`;
    if (isFinite(st)) d += `, St ≈ ${st.toFixed(3)} (Williamson's fit for laminar shedding)`;
    d += id === 'cylinder' ? '. The nearby walls raise both a little.' : id === 'tandem' && o.ref ? '. The rear cylinder changes the front one\'s wake, so expect differences.' : '.';
    out.push({ type: 'g', t: 'Measured vs reference', d });
  } else if (o.type === 'airfoil') {
    const m = +String(o.naca || '0012')[0] / 100, p = +String(o.naca || '0012')[1] / 10;
    const a0 = m > 0 && p > 0 ? zeroLiftAngle(m, p) : 0, a = o.angle * Math.PI / 180;
    const clThin = 2 * Math.PI * (a - a0);
    out.push({ type: 'g', t: 'Measured lift and drag', d: `C<sub>L</sub> = ${S.cl.toFixed(3)}, C<sub>D</sub> = ${S.cd.toFixed(3)}, lift-to-drag ratio L/D = ${(S.cl / S.cd).toFixed(1)}${S.shedding ? ` (lift oscillating ±${S.clAmp.toFixed(2)})` : ''}. Thin-airfoil theory, which ignores viscosity, predicts C<sub>L</sub> ≈ ${clThin.toFixed(2)} at this angle. At Re = ${Re.toFixed(0)} the thick boundary layers cut the lift and add a lot of drag: a full-size wing reaches L/D of 50–100.` });
  } else out.push({ type: 'g', t: 'Measured', d: `On the ${o.type === 'box' ? 'block' : o.type}: mean drag C<sub>D</sub> = ${S.cd.toFixed(3)}, mean lift C<sub>L</sub> = ${S.cl.toFixed(3)}${shed}.` });
  return out;
}
// Zero-lift angle α_L0 (radians; negative for positive camber) of a NACA 4-digit mean line, from thin-airfoil theory:
// α_L0 = −(1/π) ∫₀^π (dz/dx)(cos θ − 1) dθ
function zeroLiftAngle(m, p) {
  let s = 0; const n = 400;
  for (let k = 0; k < n; k++) {
    const th = Math.PI * (k + 0.5) / n, x = 0.5 * (1 - Math.cos(th));
    const dz = x < p ? 2 * m / (p * p) * (p - x) : 2 * m / ((1 - p) ** 2) * (p - x);
    s += dz * (Math.cos(th) - 1) * Math.PI / n;
  }
  return -s / Math.PI;
}
