// Formula Library catalogue: topics (with concept overviews), every formula, and reference constants.
import { fluids } from './data/fluids.js';
import { flight } from './data/flight.js';
import { solids } from './data/solids.js';
import { space } from './data/space.js';

export const TOPICS = [
  {
    id: 'atmo', title: 'Atmosphere & gas properties', icon: 'globe',
    blurb: 'The air every aircraft flies through: how pressure, density, temperature and viscosity change with altitude.',
    concepts: [
      { title: 'Why the atmosphere matters', html: '<p>Every aerodynamic force scales with air density, and every engine depends on the air it swallows. At 11 km an airliner flies in air with a quarter of sea-level density, so it must fly roughly twice as fast to make the same lift — which also happens to be efficient for its jet engines.</p>' },
      { title: 'The standard atmosphere', html: '<p>The International Standard Atmosphere (ISA) is an agreed average: 15 °C and 101 325 Pa at sea level, temperature falling 6.5 K per km up to 11 km, then constant to 20 km. Real days differ, so pilots and engineers correct to ISA ("ISA + 20" means 20 K warmer than standard).</p><span class="eq">T = 288.15 − 0.0065 h    (h ≤ 11 km)<br>p = 101 325 (T / 288.15)^5.2559</span>' },
      { title: 'State of a gas', html: '<p>Pressure, density and temperature are tied by the ideal gas law p = ρRT. The speed of sound, a = √(γRT), depends only on temperature — so it falls with altitude in the troposphere and then holds steady.</p>' },
      { title: 'Different airspeeds', html: '<p><b>True airspeed</b> is speed through the air. <b>Equivalent airspeed</b> is the sea-level speed with the same dynamic pressure — what the wing "feels". <b>Indicated</b> airspeed is what the instrument reads (EAS plus instrument and compressibility errors). <b>Ground speed</b> adds the wind.</p>' },
    ],
  },
  {
    id: 'aero', title: 'Aerodynamics (low speed)', icon: 'airfoil',
    blurb: 'Lift, drag and the boundary layer: how wings work below about Mach 0.3.',
    concepts: [
      { title: 'Forces and coefficients', html: '<p>Aerodynamic forces are written as a coefficient × dynamic pressure × reference area: L = q S C<sub>L</sub>, D = q S C<sub>D</sub>. The coefficients hide all the physics of shape and attitude and depend mainly on angle of attack, Reynolds number and Mach number. That lets a small wind-tunnel model predict a full-size aircraft.</p>' },
      { title: 'How a wing makes lift', html: '<p>A wing turns the air downward. By Newton\'s third law the air pushes the wing up. Equivalently, the flow over the top speeds up and its pressure drops (Bernoulli), while the flow underneath slows slightly. Both descriptions are correct and describe the same flow. The sharp trailing edge fixes how much circulation develops (the Kutta condition).</p>' },
      { title: 'Finite wings and induced drag', html: '<p>At the wingtips, high-pressure air from below spills to the low-pressure top, forming trailing vortices. They induce downwash over the wing, tilting the lift backward — induced drag. Long, slender wings (high aspect ratio) suffer less, which is why sailplanes have such long wings.</p>' },
      { title: 'Viscosity and the boundary layer', html: '<p>Air sticks to surfaces, so a thin boundary layer forms where the speed rises from zero to the outer flow. Laminar layers are smooth and low-friction; turbulent ones mix more, have higher friction, but resist separation better. When the boundary layer separates near the trailing edge at high angle, the wing stalls.</p>' },
      { title: 'The drag polar', html: '<p>Total drag = parasite drag (roughly constant coefficient) + drag due to lift (∝ C<sub>L</sub>²). Their balance sets the best glide speed, best range and best endurance — so the drag polar is the bridge between aerodynamics and aircraft performance.</p><span class="eq">C<sub>D</sub> = C<sub>D,0</sub> + C<sub>L</sub>² / (π e AR)</span>' },
    ],
  },
  {
    id: 'comp', title: 'Compressible flow', icon: 'shock',
    blurb: 'Mach number, shocks, expansion fans and nozzles: what happens when air gets squeezed.',
    concepts: [
      { title: 'When compressibility matters', html: '<p>Below Mach 0.3 the density changes by under 5% and the flow can be treated as incompressible. Above that, density, temperature and pressure all change together and the flow behaves qualitatively differently near and above Mach 1.</p>' },
      { title: 'Stagnation (total) conditions', html: '<p>Total temperature and pressure are what you get by bringing the flow to rest. Total temperature is conserved in any adiabatic flow; total pressure is conserved only without losses, so total-pressure loss measures how wasteful shocks and friction are.</p><span class="eq">T₀/T = 1 + ½(γ−1)M²     p₀/p = (T₀/T)^(γ/(γ−1))</span>' },
      { title: 'Shocks and expansions', html: '<p>Supersonic flow cannot send pressure signals upstream, so it changes direction through waves. Turning into the flow (compression) forms a shock — a sudden, lossy jump. Turning away (expansion) forms a smooth, lossless fan of Mach waves (Prandtl–Meyer). A normal shock always leaves subsonic flow behind it; an oblique shock usually leaves supersonic flow.</p>' },
      { title: 'Nozzles', html: '<p>Subsonic flow speeds up in a narrowing duct; supersonic flow speeds up in a widening one. So to go supersonic a nozzle must converge to a throat (where M = 1) and then diverge — the de Laval nozzle used on every rocket and supersonic jet. Once the throat is sonic, the mass flow is fixed (choked).</p>' },
    ],
  },
  {
    id: 'prop', title: 'Jet propulsion', icon: 'nozzle',
    blurb: 'Thrust, efficiencies, gas-turbine cycles and range.',
    concepts: [
      { title: 'How thrust is made', html: '<p>Every air-breathing engine takes in air, adds energy to it and throws it out faster than it came in. Thrust is the momentum gained per second. You can make the same thrust by accelerating a little air a lot (turbojet) or a lot of air a little (turbofan, propeller) — the second is far more efficient.</p>' },
      { title: 'Two efficiencies', html: '<p><b>Thermal efficiency</b>: how much fuel energy becomes jet kinetic energy (set by the cycle — pressure ratio and turbine temperature). <b>Propulsive efficiency</b>: how much of that jet energy actually pushes the aircraft (set by how close jet speed is to flight speed). Overall efficiency is their product.</p>' },
      { title: 'The gas-turbine (Brayton) cycle', html: '<p>Compress, burn at constant pressure, expand through a turbine that drives the compressor, then through a nozzle or fan. Higher pressure ratio raises the ideal efficiency; higher turbine inlet temperature raises specific thrust. Material limits on the turbine set the practical ceiling.</p>' },
      { title: 'Range', html: '<p>The Breguet range equation multiplies three efficiencies: engine (V/TSFC), aerodynamic (L/D) and structural (log of the fuel weight fraction). It explains why airliners fly near Mach 0.8 at high altitude with large-bypass engines and long wings.</p>' },
    ],
  },
  {
    id: 'rocket', title: 'Rockets', icon: 'flame',
    blurb: 'Specific impulse, nozzles and the rocket equation.',
    concepts: [
      { title: 'Carrying everything', html: '<p>A rocket carries its own oxidizer, so it works in vacuum, but it must accelerate all its propellant too. That gives the rocket equation, where Δv depends only on exhaust velocity and the logarithm of the mass ratio.</p><span class="eq">Δv = I<sub>sp</sub> g₀ ln(m₀ / m<sub>f</sub>)</span>' },
      { title: 'Specific impulse', html: '<p>Isp (in seconds) is the effective exhaust velocity divided by g₀. It is set by how hot and how light the exhaust is (c* ∝ √(T₀/𝓜)) and by how well the nozzle expands it (C<sub>F</sub>). Thrust = C<sub>F</sub> × c* × ṁ separates chamber and nozzle performance.</p>' },
      { title: 'Staging', html: '<p>Because Δv grows only logarithmically, a single stage struggles to reach orbit. Dropping empty tanks and engines (staging) resets the mass ratio. Most orbital rockets use two or three stages.</p>' },
      { title: 'Nozzle expansion and altitude', html: '<p>A nozzle is best when the exit pressure equals ambient. At sea level a large nozzle over-expands (losing thrust, possibly separating); in vacuum a bigger nozzle always helps. That is why upper-stage engines have much bigger nozzles.</p>' },
    ],
  },
  {
    id: 'perf', title: 'Flight performance', icon: 'plane',
    blurb: 'Stall, turns, climb, glide, takeoff and power curves.',
    concepts: [
      { title: 'Steady flight', html: '<p>In steady level flight lift equals weight and thrust equals drag. Each flight speed needs a particular C<sub>L</sub>; the slowest is set by C<sub>L,max</sub> (stall).</p>' },
      { title: 'Power and drag curves', html: '<p>Drag is U-shaped against speed: induced drag falls with speed, parasite drag rises. The bottom (minimum drag, max L/D) gives best glide and jet endurance. Power required = drag × speed has its own minimum at a slower speed — best endurance for propeller aircraft. Below these speeds is the "back side", where slowing down needs more power.</p>' },
      { title: 'Turning', html: '<p>Banking tilts the lift vector; to stay level the wing must make more lift, so the load factor n = 1/cos φ rises. Stall speed rises with √n. Turn radius ∝ V²/√(n²−1): slow and high-g turns are tightest.</p>' },
      { title: 'Climbing and gliding', html: '<p>Climb rate is excess power divided by weight. With the engine off, the glide ratio equals L/D — an airliner can glide about 17 km for every km of height.</p>' },
    ],
  },
  {
    id: 'stab', title: 'Stability & control', icon: 'balance',
    blurb: 'Static margin, tail sizing and natural motions.',
    concepts: [
      { title: 'Static stability', html: '<p>An aircraft is statically stable if, after a disturbance, it tends to return. In pitch this means the centre of gravity must be ahead of the neutral point. The distance between them (static margin) measures how stable it is.</p>' },
      { title: 'The tail\'s job', html: '<p>The wing alone is unstable in pitch about its aerodynamic centre if the CG is behind it. The horizontal tail, far behind, adds a restoring moment. Its strength is the tail volume coefficient V<sub>H</sub>; wing downwash reduces its effectiveness.</p>' },
      { title: 'Dynamic modes', html: '<p>Disturbed aircraft oscillate in characteristic modes: the slow <b>phugoid</b> (speed–height exchange), the quick <b>short period</b> (pitch), and lateral modes such as <b>Dutch roll</b>, <b>roll subsidence</b> and the slow <b>spiral</b>. Good handling needs each mode to be well damped or slow enough to correct.</p>' },
    ],
  },
  {
    id: 'struct', title: 'Structures', icon: 'beam',
    blurb: 'Stress, strain, bending, torsion, buckling and section properties.',
    concepts: [
      { title: 'Stress and strain', html: '<p>Stress is internal force per area; strain is the fractional stretch. In the elastic range they are proportional (σ = Eε). Beyond yield, metals deform permanently. Design keeps stresses below allowables with a factor of safety (1.5 on limit load in aircraft).</p>' },
      { title: 'Bending', html: '<p>A bent beam stretches on one side and compresses on the other, with stress growing linearly from the neutral axis: σ = My/I. The second moment of area I rises with depth cubed, which is why beams are deep and why I-sections and tubes are efficient.</p>' },
      { title: 'Stiffness vs strength', html: '<p>Strength (stress limit) prevents breaking; stiffness (E, I, GJ) controls deflection, vibration and buckling. Aircraft are often stiffness-limited: wings must not flutter, panels must not buckle.</p>' },
      { title: 'Buckling', html: '<p>Slender members in compression fail by sudden sideways buckling at the Euler load π²EI/(KL)², long before the material yields. Thin aircraft skins buckle locally too — they are stiffened by stringers and frames.</p>' },
      { title: 'Combined stress and failure', html: '<p>Real parts see bending, shear and torsion together. Ductile metals are checked with the von Mises equivalent stress. Holes and notches concentrate stress (K<sub>t</sub>) and start fatigue cracks, the main life limit for metal airframes.</p>' },
    ],
  },
  {
    id: 'vib', title: 'Vibration', icon: 'wave',
    blurb: 'Natural frequencies, damping, resonance and isolation.',
    concepts: [
      { title: 'Natural frequency', html: '<p>Elastic structures vibrate at their own natural frequencies, set by stiffness and mass (ω = √(k/m) for one mass on a spring). A continuous structure like a wing has many modes: bending, torsion and combinations.</p>' },
      { title: 'Resonance and damping', html: '<p>Force a structure near a natural frequency and the response grows to 1/(2ζ) times the static deflection — ten times for 5% damping. Designers keep rotor, engine and propeller frequencies away from structural modes (a Campbell diagram) or add damping.</p>' },
      { title: 'Isolation', html: '<p>Mounting equipment on soft springs makes the natural frequency low, so vibration well above it barely passes through. Isolation only begins above √2 times the natural frequency.</p>' },
      { title: 'Flutter', html: '<p>Flutter is a self-excited vibration where aerodynamic forces feed energy into a coupled bending–torsion mode. Above the flutter speed the oscillation grows violently, so every aircraft must show it is free of flutter with margin.</p>' },
    ],
  },
  {
    id: 'orbit', title: 'Orbital mechanics', icon: 'globe',
    blurb: 'Orbits, transfers, Δv and Kepler\'s laws.',
    concepts: [
      { title: 'Falling around a planet', html: '<p>An orbit is free fall with enough sideways speed that the ground curves away as fast as you fall. Lower orbits are faster; the ISS at 400 km circles in 92 minutes at 7.7 km/s.</p>' },
      { title: 'Kepler\'s laws', html: '<p>(1) Orbits are ellipses with the planet at a focus. (2) A line from planet to satellite sweeps equal areas in equal times — faster near periapsis. (3) The period squared is proportional to the semi-major axis cubed.</p>' },
      { title: 'Energy and vis-viva', html: '<p>The size of an orbit is its energy: ε = −μ/(2a). Speed at any point follows from vis-viva, v² = μ(2/r − 1/a). Burning prograde at one point raises the opposite side of the orbit.</p>' },
      { title: 'Δv budgets', html: '<p>Mission planning adds up Δv: about 9.4 km/s to reach low orbit (including losses), 3.9 km/s more to GEO, about 3.2 km/s to escape from LEO. The rocket equation then turns Δv into propellant mass.</p>' },
    ],
  },
  {
    id: 'heat', title: 'Thermodynamics & heating', icon: 'thermo',
    blurb: 'Cycles, heat transfer and aerodynamic heating.',
    concepts: [
      { title: 'Energy and entropy', html: '<p>The first law says energy is conserved; the second law says some heat must always be rejected, capping any engine at the Carnot efficiency 1 − T<sub>C</sub>/T<sub>H</sub>. Real cycles lose more through friction, mixing and heat leaks.</p>' },
      { title: 'Three ways heat moves', html: '<p><b>Conduction</b> through solids (q = kΔT/L), <b>convection</b> into moving fluids (q = hΔT) and <b>radiation</b> from every surface (q = εσT⁴). Spacecraft rely almost entirely on radiation to reject heat.</p>' },
      { title: 'Aerodynamic heating', html: '<p>At high speed the boundary layer converts kinetic energy into heat. Skin temperature approaches the recovery temperature, and stagnation-point heating grows with V³. Blunt noses, ablative or insulating heat shields and radiative cooling make re-entry survivable.</p>' },
    ],
  },
];

export const FORMULAS = [...fluids, ...flight, ...solids, ...space];
export const byId = Object.fromEntries(FORMULAS.map(f => [f.id, f]));
export const topicById = Object.fromEntries(TOPICS.map(t => [t.id, t]));

export const CONSTANTS = [
  ['g₀', 'Standard gravity', '9.80665 m/s²'],
  ['R', 'Gas constant, air', '287.053 J/(kg·K)'],
  ['γ', 'Ratio of specific heats, air', '1.4'],
  ['cₚ', 'Specific heat, air', '1 004.7 J/(kg·K)'],
  ['Rᵤ', 'Universal gas constant', '8.314 J/(mol·K)'],
  ['σ', 'Stefan–Boltzmann constant', '5.670×10⁻⁸ W/(m²·K⁴)'],
  ['ρ₀', 'Sea-level density (ISA)', '1.225 kg/m³'],
  ['p₀', 'Sea-level pressure (ISA)', '101 325 Pa'],
  ['T₀', 'Sea-level temperature (ISA)', '288.15 K'],
  ['a₀', 'Sea-level speed of sound', '340.29 m/s'],
  ['μ₀', 'Sea-level viscosity', '1.789×10⁻⁵ Pa·s'],
  ['μ⊕', 'Earth gravitational parameter', '398 600.4 km³/s²'],
  ['R⊕', 'Earth mean radius', '6 371 km'],
  ['μ☉', 'Sun gravitational parameter', '1.327×10¹¹ km³/s²'],
  ['AU', 'Astronomical unit', '1.496×10⁸ km'],
];
