# Guidance, Navigation & Control

[← Back to the README](../../README.md)

A separate module that shares the Flight & Atmosphere aircraft, flight condition and CG (`js/modules/flight/perfShared.js`),
so a choice made in either carries over, and the same US / SI switch. Its solver, `js/solvers/control.js` (no DOM), works on
real polynomials: transfer functions come from the stability model's state matrices by the Faddeev–LeVerrier recursion;
roots are found with the frequency scaled to about 1 so modes several decades apart stay accurate; Bode phase is the sum
of the pole and zero angles, so it is continuous without unwrapping; margins come from a dense sweep refined by bisection,
including the ω = 0 crossing of an open-loop-unstable aircraft.

- **Control loops**: pick an output (q, θ, α, nz, p, φ, r or β) and its surface, a compensator (gain, PI, PID with a
  filtered derivative, lead–lag), an optional washout, a first-order actuator and a sensor delay (second-order Padé). The
  loop is shown as a block diagram, a root locus whose closed-loop roots can be dragged to set the gain, the step response
  with the surface deflection, a Bode plot with gain and phase margins marked, and a Nyquist plot with distances above 1
  compressed logarithmically and the encirclement count. Metrics give closed-loop stability, phase, gain (up and, for a
  conditionally stable loop, down) and delay margins, closed-loop damping, step figures and peak surface deflection.
  The transfer functions are written out factored, with every pole labelled by mode. Scenarios: a light-single pitch
  damper, an airliner yaw damper, the relaxed-stability fighter with pitch-rate feedback only (the q/δe zero at the origin
  leaves a slow divergence) and with α feedback (stable but lightly damped), the same with 120 ms of delay, and an
  airliner attitude hold with integral action.
- **Augmentation & FBW** (`js/solvers/augment.js`, no DOM): feedback round one surface. Pitch: α, q and nz feedback, with
  the stick moving the elevator directly ("dampers only") or through a pitch-rate or C* (nz + Vco·q/g) command law with
  proportional, integral and feed-forward paths. Yaw: a yaw damper with washout and sideslip feedback. The loop broken
  at the actuator gives the closed-loop roots, root migration as the gains rise from zero, and gain (up and down), phase
  and delay margins; the plant transfer functions share the aircraft's characteristic polynomial so it is never
  duplicated. A time simulation adds what the linear analysis leaves out: first-order actuator with rate and position
  limits about trim, a flight computer sampled at its frame rate with a true transport delay, Dryden gusts, and a pilot
  model (gain on attitude error, reaction delay). The same input is flown side by side with and without the computer (or,
  with the pilot, with and without the rate limit), with time histories (rate-limit spells shaded), a CAP–ζ or Dutch-roll
  chart with MIL-F-8785C Category A/B/C levels, the Bode plot, insights and the law written out. Scenarios: airliner yaw
  damper and pitch damper in turbulence, the relaxed-stability fighter with α + q feedback, C* and pitch-rate fly-by-wire,
  150 ms of delay, and a rate-limited pilot-induced oscillation.
- **Autopilots** (`js/solvers/autopilot.js`, no DOM): cascaded loops on the small-disturbance aircraft. Pitch modes:
  altitude hold with capture (height error → limited climb-rate command → limited pitch command → elevator), level change
  (climb or idle thrust with speed on the elevator, switching to altitude capture with bumpless integrator hand-over),
  vertical speed, pitch hold, and speed on elevator (the sailplane). An autothrottle holds speed through a first-order
  engine lag (trim thrust from the performance model). Lateral: heading → limited bank → aileron with roll damping (the
  short way round, with the turn direction latched near 180°), bank hold, and a washed-out yaw damper with sideslip
  feedback. The simulation adds limits, conditional-integration anti-windup, elevator rate limit, the lift lost in a
  bank, exact turn kinematics (ψ̇ = r / cos φ, gravity ∝ sin φ), the ground track and Dryden gusts; the linear analysis
  breaks each loop in turn with the others closed. Default gains for each aircraft come from loop-by-loop sweeps (inner
  loops 3–35× faster than the loops around them). Shown on a primary flight display with mode annunciators and target
  bugs, a north-up map with a ghost comparison run (anti-windup switched, autothrottle off, another mode, default gains,
  no yaw damper), time histories against the targets, a loop table with Bode plots, every gain tunable live, insights
  and the laws written out. Scenarios: V/S climb versus level change at FL350, an idle descent, turns, a 25° bank on
  pitch hold, integrator windup, a climbing turn with a speed change, turbulence, the sailplane, and the fighter.
- **Navigation** (`js/solvers/navigation.js`, no DOM), three tools. *Routes*: WGS-84 geodetic ↔ ECEF (Bowring) ↔ local NED,
  Vincenty's inverse and direct geodesic, rhumb lines on the ellipsoid (isometric latitude and Helmert's meridian arc),
  haversine on a mean-radius sphere and Clairaut's vertex, between 24 major airports: a globe you can turn, a Mercator
  chart, the course along the way, distances, courses, the extra length of the rhumb line, flight time, the frames step
  by step. *Wind & dead reckoning*: the wind triangle and its inverse, then a leg flown on a wrong forecast with the
  drift, the end error split along and across track, and 1σ error ellipses from heading and speed errors.
  *Radio nav*: VOR radial, TO/FROM and course deviation (on a draggable plan view and a course deviation indicator),
  DME slant range, and ILS localizer and glide-slope deviation from the side, from above and on the indicator.
- **INS & GNSS** (`js/solvers/ins.js`, no DOM), three tools. *Inertial drift*: the 12-state phi-angle error model of a
  local-level INS for a slow vehicle (Titterton & Weston §12.3; Groves §14.2: position, velocity and attitude errors,
  three gyro and two accelerometer biases), propagated exactly with e^(FΔt), for four sensor grades or any biases, with
  or without self-alignment (levelling and gyrocompassing) and Earth rotation: position error and its 1σ envelope from
  random biases and noise, the error track (Schuler loops turned by the Foucault effect), attitude errors, and the
  unstable vertical channel with and without baro aiding. *GNSS fix & DOP*: a nominal 24-satellite GPS constellation
  (Walker 24/6/1, circular orbits), sky plot with satellites you can switch off, elevation mask, iterative least squares
  for position and receiver clock bias, a Monte Carlo cloud of fixes against the DOP ellipse, and HDOP/VDOP over the day
  for eight places from the equator to 78°. *INS + GNSS filter*: a loosely coupled Kalman filter on the same error
  model, truth with random biases and sensor noise, GNSS fixes at a chosen rate and accuracy with an outage, straight
  flight or S-turns: position error against the INS alone and a single fix, heading and bias estimates with ±1σ bands,
  and covariance ellipses before, at the end of and after the outage.
- **Collaborative flight** (`js/solvers/collab.js`, no DOM), four tools. *Formation & wake*: each aircraft's wake as two
  semi-infinite trailing vortices (Biot–Savart, Burnham–Hallock core spreading with age), the follower's induced-drag
  change from its lift-weighted mean upwash, and the fuel saving from the aircraft's own polar; presets for an airliner
  pair 3 km apart (fello'fly), a V of light aircraft and display-team diamonds and deltas; the formation from above, a
  map of the saving against lateral and vertical position, and the saving against spacing. *Fleet tasks*: Hungarian,
  bottleneck and auction assignment of survey jobs on a draggable map, with lost-link aircraft returning to base or
  finishing first and the rest re-planned. *Beacon search*: bearings or time differences from draggable aircraft,
  Gauss–Newton fixes, a Monte Carlo cloud, the Cramér–Rao ellipse and a map of the bound. *Rendezvous*: the earliest
  common join-up time, speeds and holding within each aircraft's speed range, and team fuel against join-up time.
