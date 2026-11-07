# Validation

[← Back to the README](../README.md)

Every solver is checked against closed-form results, textbook tables, published data or reference codes.

Open http://localhost:8765/tests/ to run the suite (add `?only=flight` for the atmosphere, airspeed, turbulence and performance checks, `?only=performance` for performance alone, `?only=stability` for stability alone, `?only=control` for the control, augmentation and autopilot checks, `?only=augment` or `?only=autopilot` for one of them, `?only=navigation` for navigation and INS/GNSS, `?only=ins` for INS/GNSS alone, `?only=collab` for collaborative flight, `?only=gasdyn` for just the compressible-flow checks, `?only=propulsion` for the engine and equilibrium checks, `?only=structures` for the structures checks, `?only=fem2d` for the 2D FEA checks, `?only=vibration` for the vibration checks, `?only=frame3d` for the 3D frame checks, `?only=formulas` for the Formula Library and `?only=cfd` for the Fluid Flow Sandbox, `?only=vehicles` for the Airfoil Lab's Vehicle aero tab):

- structures: beams (simply supported, cantilever, propped, fixed-fixed, continuous, hinged), trusses, inclined supports, thermal loads and portal frames vs. closed-form results; natural frequencies and Euler buckling loads; mechanism detection; friction/tipping/ladder limits; section properties; eigen and LP solvers;
- vibration: exact SDOF integrator vs closed forms, step/pulse load factors, half-sine shock peak 1.77, Den Hartog absorber, modal superposition vs static deflection;
- 3D frames: biaxial cantilever, tip twist TL/GJ, L-bent (bending + torsion), tripod, simply supported and rolled I-beams, member-end pins, restrained heating, cantilever frequencies (bending and torsion), effective mass, Euler buckling (cantilever, pinned truss bar, I-column weak axis), mechanism detection;
- 2D FEA: patch test, mesh validity, hole Kt vs Heywood, net-section equilibrium, cantilever vs Timoshenko, lug load balance, plane strain;

- fluid flow sandbox: Poiseuille channel profile vs the exact parabola, mass conservation (periodic box, closed cavity with a
  sliding lid), GPU solver vs the CPU reference (inflow/outflow, walls, slip, periodic, body force, moving obstacles, jets,
  sliding lid, turbulence model), lid-driven cavity at Re = 100 vs Ghia, Ghia & Shin (1982), cylinder at Re = 100 shedding
  with St ≈ 0.17 and a steady wake at Re = 30, shape areas (circle, NACA 0012), and every scene running stably;
  forces: GPU wall forces vs the CPU reference cell by cell, momentum balance (drag = driving force, to 0.03%), cylinder C_D at
  Re = 30 and 100 and St from the lift matching the wake probe, no trapped sound waves with the absorbing layers, and the
  frequency and spectrum tools on a noisy, unevenly sampled sine; shareable links surviving the round trip (and scaling to a
  finer grid);
- vehicle aero: panel method vs the exact circle (Cp = 1 and −3, no net force), NACA 0012 at 5° vs the Airfoil Lab's
  inviscid lift (within 0.2%) and Kutta–Joukowski, the ground plane vs a mirror-image wing (exact), an inverted wing gaining
  downforce near the ground and returning to free-air values far from it; valid vehicle geometry; plausible effective widths;
  a realistic F1 downforce split; ground effect, wing-angle balance shifts and speed² scaling on the F1 car; tail loads, cruise
  C_L and L/D for the aircraft, stall at 9 g, the runway's effect on 2-D lift, and the standard atmosphere; canard control
  and the lift limit at altitude for the missile;
- flight & atmosphere: US Standard Atmosphere 1976 table values (T, p, ρ at 0–86 km, sea-level viscosity, mean free path,
  number density, scale height, gravity), geometric ↔ geopotential height, pressure and density altitude inversions, the
  closed-form true altitude of a warm troposphere, CAS = EAS = TAS at sea level, 661.47 kt at Mach 1, the Rayleigh pitot
  value at Mach 2, CAS/EAS/TAS/Mach round trips (subsonic and supersonic), Dryden scales and intensities, spectra
  integrating to σ², and simulated gust RMS and spectrum matching the model; the other modules using the shared atmosphere;
- aircraft performance: (L/D)max, Vmd and Vmp closed forms, ballast scaling, static engine thrust and power, ceilings
  (RoC = 100 ft/min at the service ceiling), Ps = 0 at top speed, the exact constant-speed range integral, long-range
  cruise at 99% of max specific range, payload–range ordering, corner speed and turn-rate identities, the V–n stall curve
  and gust alleviation factor, energy-climb consistency, and Cessna 172 handbook climb, ceiling, top speed, takeoff and
  landing distances (within 8–20%);
- stability: eigenvalues of known matrices, Nelson's Navion example (short period, phugoid, Dutch roll, roll and spiral
  eigenvalues within 1–1.5%), eigenvector residuals, trim residuals, Cmα = 0 at the neutral point, maneuver point aft of
  it, short-period / phugoid / roll / Dutch-roll approximations against the full model, divergence with the CG behind the
  neutral point, dihedral and fin-size trends, the airliner's weak Dutch roll and the fighter's relaxed stability;
- control: polynomial transfer functions against a direct C(jωI − A)⁻¹B solve (Navion), poles equal to eigenvalues, the
  second-order overshoot, peak time, phase margin and crossover closed forms, the K/(s+1)³ gain margin and Routh limit,
  Padé gain and phase, the 1/s delay margin, root-locus points and asymptotes, PID and lead-network frequency response,
  washout DC gain, a light-single pitch damper and an airliner yaw damper raising damping, and the fighter: pitch-rate
  feedback only slowing its divergence, α feedback stabilising it, and the gain-reduction margin matching the Routh limit;
- augmentation: the time simulator against the linear closed loop (within 0.2%), the fighter's C* fly-by-wire law
  (stable, Level 1 Category A, margins ≥ 40° and 6 dB both ways, steady C* equal to the command) and the unaugmented
  fighter departing, rate and position limits and transport delay honoured, the rate-limited sine's triangle amplitude
  πR/(2ω) and 66.9° lag, the airliner yaw damper reaching Level 1 and its washout passing a steady yaw rate exactly, a
  pitch damper cutting turbulence response, and a pilot model that settles with a fast actuator but diverges when the
  tail is rate limited to 10°/s;
- autopilots: heading hold against its linear closed loop (within 0.1%), the coordinated-turn rate g·tan φ / V, height lost
  in a bank on pitch hold and held by the altitude hold, altitude capture within the climb-rate limit, a climbing turn
  with a speed change captured on all three, integrator windup (18.9 kt overshoot) removed by anti-windup, level change
  against a vertical-speed climb at FL350, speed on elevator for the sailplane, the short way round and a latched 180°
  turn, and the default gains for all five aircraft (all loops stable, inner loops ≥ 3× faster);
- navigation: Vincenty's Flinders Peak – Buninyong line (54 972.271 m, 306°52′05.37″, 127°10′25.07″) and its direct
  round trip, the WGS-84 quarter meridian (10 001 965.729 m), the equator and pole-to-pole geodesics, rhumb lines along a
  meridian and the equator, ECEF round trips, the local frame's d²/2M curvature drop, great circle vs rhumb vs sphere
  New York–London, Clairaut's vertex, the wind triangle and its inverse, dead-reckoning drift and the 1-in-60 rule, and
  VOR, DME and ILS geometry;
- INS and GNSS: the 84.4-minute Schuler period; position error from a 1 mg accelerometer bias (peak 2∇R/g), a 0.01°/h
  gyro drift (−Rε(t − sin ωst/ωs), the 0.6 nm/h rule), an initial tilt and an initial velocity error; levelling cancelling
  accelerometer biases and the gyrocompass heading error εE/(Ω cos L); the error model's natural frequencies ωs ± Ω sin L
  (Foucault) and Ω; the vertical channel's √(R/2g) = 9.5 min divergence and baro-aided steady state; the GPS period
  (half a sidereal day); least squares recovering position (< 1 mm) and a 1 ms clock error; closed-form DOP for a
  symmetric sky; GDOP never improving when a satellite is removed; Monte Carlo error = σ·HDOP; the scalar Kalman filter
  closed form; and the INS/GNSS filter through an outage (σ below a single fix, growth, recovery, consistency, heading
  observable only with S-turns);
- collaborative flight: the semi-infinite vortex against Γ/(2πd) and half that level with its start; wake symmetry;
  the best follower spacing near tip-vortex alignment (0.89b) with a 40–70% induced-drag saving and a penalty inboard;
  the V leader gaining nothing; the diamond slot behind and below the lead; Hungarian and bottleneck assignment against
  brute force and the auction within n·ε; exact beacon fixes without noise and Monte Carlo against the Cramér–Rao bound
  for bearings and time differences; rendezvous timing and holding; the minimum-drag speed;
- formula library: solver vs textbook values (isentropic, shocks, pitot, Prandtl–Meyer, ISA, orbits, Kepler, buckling), every
  multiple-root case, unit conversions, and every formula solving and back-solving each of its variables;
- orbital mechanics: Kepler's equation to 10⁻¹² up to e = 0.99, elements → state → elements round trip, |r| and |v|
  against the conic and vis-viva, h = √(μp), the 400 km circular speed and period, GEO period = sidereal day, equal areas
  in equal times on a Molniya orbit, Hohmann LEO → GEO against Vallado example 6-1 (2.457 + 1.478 km/s, 5.256 h), the
  bi-elliptic crossovers at 11.94 and 15.58 and the 0.536 peak, 2v·sin(Δi/2), combined plane changes for GTO from the
  Cape (≈ 4.23 km/s with the best split), ISS node regression ≈ −4.95°/day, the 98.2° sun-synchronous inclination at
  705 km, the 63.43° critical inclination, a fixed GEO sub-point, GPS at 2 revolutions per day, the ISS track's 23.6°
  shift, coverage half-angles, Earth → Mars Hohmann (v∞ 2.94 km/s, 259 days, synodic 780 days, TMI ≈ 3.6 km/s), the
  rocket equation and the Cape's 408 m/s rotation gain;
- rocket engines: contour identities (throat and exit radii, Vc = L*·At, bell length 80% of a 15° cone, cone divergence
  factor), the expansion table against the CEA rocket solution (sonic throat, exit ε and Mach), thrust meeting the
  requirement, F_vac − F(pa) = pa·Ae, Isp = CF·c*/g₀, the gas-generator loss, ideal efficiencies reproducing CEA Isp,
  ideal expansion, separation of a vacuum nozzle at sea level, plume regimes, Bartz peak at the throat and the RS-25 flux
  level, bulk densities, fuel-rich optimum mixture ratios, and vacuum and sea-level Isp within 4.5% of published data
  for all eight example engines;
- propulsion: equilibrium flame temperatures and rocket performance vs NASA CEA, cycle code vs the closed-form ideal turbojet, ISA, inlet recovery, turbomachinery identities;
- gas-dynamics relations against textbook table values (normal/oblique shock, Prandtl–Meyer, Fanno, Rayleigh, Sod shock tube, nozzle critical pressures, MOC area ratio);

- finite-difference "ping" checks of every boundary-layer correlation, the station and transition residuals, and the
  full coupled Jacobian (second-order convergence expected);
- fast solver vs. plain dense solver (agree to ~1e-15);
- physics checks (zero lift for symmetric airfoil at α=0, thin-airfoil lift slope, NACA 0012 drag vs. XFOIL).

Note: the port fixes one derivative typo in the original (`get_damp`, `d/dH[0.1·exp(-20H)]`). It changes only
the Jacobian, not converged results.
