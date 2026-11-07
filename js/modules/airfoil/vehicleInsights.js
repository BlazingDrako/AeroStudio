// Notes for the Vehicle aero tab, and the "How this tab works" text.
const i = (t, d) => ({ type: 'i', t, d });
const w = (t, d) => ({ type: 'w', t, d });
import { TAILSTRIKE } from './vehicles.js';
import { fmt as U } from './vehicleUnits.js';
const kg = U.load; // a vertical force as the weight it equals

export const HOW = `<div class="vh-how-grid">
<div><b>Computed</b><p>The flow pattern, the pressure colours, how the vertical force is shared between the parts and how all of that changes with the sliders. The F1 floor is modelled as the roof of its venturi tunnels; the plank and floor edge beside them are drawn. An inviscid panel method (the core of XFOIL, as in the Airfoil Lab) solves for the flow round every part at once; the road or runway is modelled with mirror images, which acts like a rolling road. It matches the Airfoil Lab's inviscid lift within 0.2%.</p></div>
<div><b>Calibrated and published</b><p>Cars: the 2-D slice becomes a real downforce through an effective width, set so each race car's default setup matches its published downforce (C<sub>L</sub>·A ≈ 4.5 m² for F1, 2.2 m² for GT3); moving the sliders then changes the force as computed. The widths come out below the real 2 m (F1 ≈ 0.53 m, GT ≈ 0.33 m) because in 3-D air escapes round the sides and wing tips. Planes and the missile: total lift is load factor × weight, shared as computed. Drag uses published typical values (cars) or a simple drag polar (planes, missile).</p></div>
<div><b>Illustrated</b><p>Wakes behind the vehicles; the wheels and wing mounts (beside the centre-line slice); the fuselage, fin and engine (beside the slice through the wing and tail); the missile's body and vertical fins. Outlines were measured from side-view reference images and scaled to each vehicle's real length and height.</p></div>
<div><b>Not modelled</b><p>Viscosity: no boundary layers, separation, stall or skin friction, so no computed drag. Nothing three-dimensional: wing-tip vortices, air spilling round the sides of a car. Treat the numbers as well-founded estimates and the trends as reliable; for viscous flow use the Sandbox tab.</p></div>
</div>`;

export function vehicleInsights(v, p, R) {
  const out = [];
  if (v.kind === 'car') {
    const down = -R.lift;
    if (v.id === 'road') {
      out.push(i('Suction over the roof', 'Air speeds up over the curved roof and its pressure drops (blue), pulling the body up, much as over a wing. At the nose the air is brought to a stop and its pressure peaks (red).'));
      out.push(w('Real road cars lift slightly', `In this smooth, inviscid model the gap under the car acts as a venturi and sucks it down (${kg(R.lift)} ${down > 0 ? 'down' : 'up'}). Under a real road car the exhaust, suspension, fuel tank and wheels slow that air right down, and the flow separates at the rear, so measured road cars show a small net <b>lift</b>: typically C<sub>L</sub>·A ≈ +0.3 m², about ${kg(R.q * 0.3)} at this speed. That is why sporty road cars add spoilers and smooth undertrays.`));
    }
    if (v.id === 'gt' || v.id === 'f1') {
      const body = R.parts.find(x => x.role === 'body'), rear = R.parts.find(x => x.name === 'Rear wing'), front = R.parts.find(x => x.name === 'Front wing');
      out.push(i('Wings upside down', 'A racing car\'s wings are aircraft wings turned over: fast air under them, slow air over them, so they push down instead of up. That grip lets the tyres corner and brake far harder than their mechanical grip alone.'));
      if (body && body.N < 0) out.push(i('Ground effect under the floor', `The floor and the road form a narrow channel; the air speeds up through it and its pressure falls (deep blue under the car), sucking the car down: ${kg(body.N)} from the ${v.id === 'f1' ? 'body and floor' : 'body, splitter and floor'} here. The diffuser at the back widens the channel so the air can slow back down smoothly. Lower the ride height and watch it grow.`));
      if (p.ride < (v.id === 'f1' ? 25 : 50)) out.push(w('Very low: real floors stall', 'Real floors lose downforce when they get this close to the road: the boundary layers on the floor and road fill the gap and the flow separates in the diffuser. In 2022 F1 cars also bounced ("porpoising") as the floor stalled and recovered. This inviscid model keeps adding downforce instead.'));
      if (isFinite(R.invertSpeed)) out.push(i('Driving upside down', `Downforce equals the car's weight at about ${U.speed(R.invertSpeed * 3.6)}. Above that, in theory, the car could drive on the ceiling of a tunnel.`));
      if (front && rear && isFinite(R.frontShare)) out.push(i('Aero balance', `${Math.round(100 * R.frontShare)}% of the downforce sits on the front axle. Teams tune the wing angles to put the balance a little behind the weight distribution: too much front and the car oversteers (the rear slides), too little and it understeers.`));
      if (rear) out.push(i('The cost: drag', `Downforce is bought with drag: at ${U.speed(p.speed)} pushing this car through the air takes about ${U.power(R.power)}. Low-drag circuits like Monza run small wing angles; slow, twisty ones like Monaco run the biggest wings allowed.`));
    }
  } else if (v.missile) {
    const can = R.parts.find(x => x.role === 'canard');
    if (!R.ok) out.push({ type: 'b', t: 'No lift at this setting', d: 'The fins make no lift (or negative lift) here. Raise the angle of attack or the canard deflection.' });
    if (R.stallMargin < 1) out.push({ type: 'b', t: 'Not enough lift for this turn', d: `Pulling ${p.n.toFixed(1)} g at this speed and altitude needs C<sub>L</sub> = ${R.CL.toFixed(2)} on the fin area, more than the fins and body can give (about ${v.CLmax}). A real Sidewinder flies at Mach 2–2.5, where the dynamic pressure is 6–8 times higher than at this speed, which is how it reaches 30 g and more. Speed is what a missile turns with.` });
    out.push(i('Canards steer', 'The small canards near the nose are the control surfaces. Turning them leading edge up lifts the nose, which raises the angle of attack of the whole missile and so its lift. The big tail fins sit far behind the centre of gravity and keep it pointing into the airflow, like the feathers on a dart.'));
    if (can && R.ok) out.push(i('Who carries the load', `In this slice the canards carry ${Math.round(100 * can.N / R.lift)}% of the lift and the tail fins the rest. On the real missile the body adds a large share at higher angles of attack; it is not in the slice.`));
    out.push(w('Subsonic only', 'This panel method assumes incompressible air, so the speed stops below Mach 1. Real Sidewinders fly supersonic, where shock waves change the pressure pattern and the canards lose some of their effect. The Supersonic tab shows shocks on a 2-D section.'));
    if (R.stallMargin >= 1) out.push(i('Load factor', `At ${p.n.toFixed(1)} g the fins and body must make ${U.force(R.lift)} of lift, ${p.n.toFixed(0)} times the missile's ${U.mass(v.mass)} weight.`));
  } else {
    const tail = R.parts.find(x => x.role === 'tail'), wing = R.parts.find(x => x.role === 'wing');
    if (v.id === 'airliner' && p.runway && p.alpha > TAILSTRIKE) out.push(w('Tail strike', `On the runway an A320 can pitch up only about ${TAILSTRIKE}° before its tail touches the ground, so it is drawn and computed at ${TAILSTRIKE}°.`));
    if (!R.ok) out.push({ type: 'b', t: 'No lift at this angle', d: 'The wing makes no lift (or negative lift) at this angle of attack, so the aircraft cannot hold level flight. Raise the angle of attack.' });
    if (R.stallMargin < 1) out.push({ type: 'b', t: 'The wing would stall', d: `To make ${p.n.toFixed(1)} g of lift at this speed and altitude the wing needs C<sub>L</sub> = ${R.CL.toFixed(2)}, more than its maximum of about ${v.CLmax}. Fly faster, lower, or pull fewer g. This is why stall speed rises in a steep turn.` });
    else if (R.stallMargin < 1.3) out.push(w('Close to the stall', `The wing needs C<sub>L</sub> = ${R.CL.toFixed(2)} of its ${v.CLmax} maximum. Airliners keep at least a 1.3× margin (reference speeds are 1.23–1.3 × stall speed).`));
    if (tail && R.ok) out.push(tail.N < 0
      ? i('The tail pushes down', `The tailplane carries ${U.force(tail.N)} <b>downward</b>, so the wing must lift more than the weight. It balances the nose-down pitch of the cambered wing and a centre of gravity ahead of the wing's lift; the air coming off the wing is also deflected down (downwash), lowering the tail's angle of attack.`)
      : i('The tail lifts a little', 'At this angle the tailplane carries a small upward load. With the wing\'s downwash and the tail\'s own nose-down setting, it usually pushes down in cruise; raising the angle of attack makes it lift.'));
    if (p.runway) {
      const r = R.groundRatio, pct = isFinite(r) ? Math.round(100 * (r - 1)) : NaN;
      out.push(i('Ground effect', `${isFinite(pct) ? `In this 2-D slice the runway changes the wing's lift by ${pct >= 0 ? '+' : ''}${pct}% at this angle: at small angles the ground blocks the air from being pushed down and lift rises; at larger angles the narrowing gap under the trailing edge speeds the air up and pulls the other way. ` : ''}On a real 3-D wing the bigger effect is different: the ground weakens the wing-tip vortices, cutting induced drag by a large fraction, so the aircraft "floats" just before touchdown.`));
    }
    if (v.id === 'fighter' && p.n >= 6) out.push(i('High g', `At ${p.n.toFixed(1)} g the wing carries ${U.force(R.lift)}, as if the aircraft weighed ${U.mass(p.n * v.mass)}. The pilot feels the same multiple of their own weight.`));
    if (wing && R.ok && R.stallMargin >= 1) out.push(i('Lift = weight', `In steady, level flight lift balances weight: ${U.force(R.lift)} here. The wing makes it by turning the air downward: fast, low-pressure air above (blue), slower, higher-pressure air below.`));
  }
  return out;
}
