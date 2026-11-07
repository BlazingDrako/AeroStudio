# Shocks & Nozzles

[← Back to the README](../../README.md)

- **Calculator**: isentropic, normal shock, oblique shock, Prandtl–Meyer, Fanno, Rayleigh and pitot problems from any one
  known quantity (inverse relations by bisection), with the substituted equations shown step by step, optional dimensional
  values, and worked examples.
- **Shocks & expansions**: normal shock, compression ramp (attached, strong-branch, or detached bow shock), expansion corner,
  isentropic compression (Mach waves coalescing into a shock), wedge, diamond airfoil (shock-expansion theory with lift/wave
  drag vs Ackeret theory, trailing-edge waves and slip line), blunt-body bow shock (Billig correlation, pitot pressure),
  shock reflection (regular or Mach), and a moving sound source (Mach cone). Subsonic cases use linearized
  Prandtl–Glauert theory (potential flow + Kármán–Tsien for the blunt body). Views: Mach, p, T, p₀ loss, schlieren.
- **Nozzles & plumes**: converging, conical, Rao 80% bell (approximate angles) and minimum-length MOC contours; quasi-1D
  flow through every back-pressure regime including the normal-shock location; thrust, CF, Isp, mass flow; CF vs back
  pressure; exhaust plume by a planar wave-lattice method of characteristics, giving Mach diamonds (with an exhaust-glow
  view), Mach-disk and separation warnings.
- **Live CFD (Euler)**: a GPU (WebGL2) finite-volume solver of the 2-D Euler equations — HLLC fluxes, MUSCL
  reconstruction, SSP-RK2, ghost-cell immersed boundaries — for every scenario except the Mach cone, with the exact theory
  overlaid as dashed lines and a convergence plot. Validated on a Mach 2.5, 15° ramp: M₂ 1.8737 vs 1.8735 exact, p₂/p₁
  2.4672 vs 2.4675, shock angle 36.93° vs 36.94°.
- **θ–β–M chart / shock polar**: click or drag to pick M₁ and θ; weak and strong solutions; reflected-shock polar.
- **Shock tube**: exact Riemann solution with different driver and test gases, animated gas parcels, x–t diagram.
