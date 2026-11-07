# Airfoil Lab

[← Back to the README](../../README.md)

- Solver: JavaScript port of **mfoil** (K. J. Fidkowski, MIT license; see `LICENSE-mfoil.txt`):
  linear-vortex panel method coupled to an integral boundary layer with eⁿ transition, solved with
  Newton's method (the XFOIL approach). Includes forced transition, Kármán–Tsien compressibility, target-cl mode, flaps.
- Flow field is evaluated on the GPU (WebGL2) per pixel with the same panel formulas: pressure or speed
  color, streamlines (stream-function contours), sonic line, animated particles. Exact hover readouts.
- **Supersonic tab** (`js/solvers/supersonic.js`, `js/modules/airfoil/supersonicTab.js`): shock-expansion theory on sharp
  sections (diamond, hexagonal, biconvex, flat plate) with linear/Busemann comparison and a compressible skin-friction
  estimate, or live 2-D Euler CFD (shared with Shocks & Nozzles) for any airfoil, including round-nose NACA sections.
- Coupled Newton system is solved with a structured elimination (delta* swapped for mass m = ue·delta*), which gives
  the same answer as a dense solve, about 3–5× faster in practice.

## Vehicle aero tab

- **What it is**: side profiles of a 2022+ Formula 1 car, a GT3-class race car, a Golf Mk2-class hatchback, an A320-class
  airliner, an F-16-class fighter and an AIM-9 Sidewinder missile (`#/airfoil?tab=vehicles&v=f1`). Outlines were measured
  from the side-view images in `assets/Vehicle profiles/` and scaled to published lengths, wheelbases and heights; they are
  drawn in the Airfoil Lab's style (same pressure colour scale, grey bodies, plain arrows). Streamlines, moving particles and
  pressure colours show the flow; arrows show the vertical force on each part in kilograms or kilonewtons, each ending where
  that part's force acts (car bodies are split into upper-surface lift and underside suction). Sliders: speed, ride height
  and wing angles for cars; angle of attack, speed, altitude, load factor and a near-the-runway switch for planes; canard
  deflection for the missile (sliced through its canards and tail fins, subsonic speeds only).
  A Units switch shows everything in US units (mph, lb, lbf, ft, in, hp; the default) or metric; the choice is
  remembered in the browser (`js/modules/airfoil/vehicleUnits.js`). Calculations always run in SI.
- **Computed** (`js/solvers/panel2d.js`): an inviscid Hess–Smith panel method for several bodies at once (constant sources
  on every panel, a vortex and a Kutta condition per wing element), with the road as a mirror image (a rolling road).
  Panels are resampled finer close to the ground. The F1 floor is the roof of its venturi tunnels.
- **Real units**: each race car's effective width (F1 ≈ 0.53 m, GT ≈ 0.33 m) is set so its default setup matches its
  published C_L·A (≈ 4.5 m² and ≈ 2.2 m²); sliders then change the force as computed. The road car uses their average.
  Planes and the missile: lift = load factor × weight, split between wing and tail (or canards and tail fins) as computed, with ISA density, required C_L, stall margin
  and a simple drag polar. Car drag is a published typical C_D·A.
- **Drawn, not computed**: wakes, wheels and wing mounts (beside the centre-line slice), and the planes' fuselage, fin and
  engine (beside the slice through the wing and tailplane), and the missile's body and vertical fins. No viscosity, so no separation, stall or computed drag; the road
  car's smooth-floor downforce is explained against the slight lift of real road cars.
