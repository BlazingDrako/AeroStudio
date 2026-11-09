# Wings & 3D Aero

[← Back to the README](../../README.md)

Finite wings, from airfoil to whole wing (`js/solvers/wing.js`, no DOM). Every tab shares one wing and one flight
condition, so a preset, a drag on the planform or a winglet set in one tab shows in all of them.

## Solvers

- **Vortex lattice**: horseshoe vortices on a spanwise × chordwise grid (bound leg at each panel's quarter chord,
  control point at three quarters, legs trailing to infinity along x). Spanwise stations use sine spacing (dense at
  the tips) with control points at the parametric middle of each strip, which keeps the discrete wing from beating
  the elliptic optimum. Twist and the section's zero-lift angle (thin-airfoil theory for NACA 4-digit sections) tilt the
  normal at each control point; the panels stay flat. Handles sweep, taper, twist, dihedral, elliptic planforms and
  winglets (height, cant, taper, sweep). The influence matrix is factored once per geometry, so new angles are cheap.
- **Induced drag** in the Trefftz plane: the shed vortices at the strip edges and the normal wash at the strip
  midpoints. Lift, pitching moment, aerodynamic centre, zero-lift angle and root bending moment come from the same
  solution; a second right-hand side gives the lift slope.
- **Lifting line** (Glauert's Fourier series, odd terms) for straight wings, shown alongside the lattice.
- **Compressibility** by Göthert's rule: the wing is solved stretched along x by 1/β; forces and the downwash need no
  further factor. Mach is held at 0.85.
- **Ground effect**: a mirror-image wing below the ground, in the influence matrix and in the Trefftz plane.
- **Stall**: the α-correction method on a one-panel-chord lattice. Each strip gets an extra incidence until its lattice
  lift matches its section's cl at the angle it really sees; past the peak a light spanwise smoothing on stalled strips
  stops neighbours from settling on opposite branches. Sections are either a smooth model (lift slope, α₀, cl,max) or
  tabulated polars from the Airfoil Lab's viscous solver run in its Web Worker at the root and tip Reynolds numbers,
  blended linearly along the span.
- **Wake roll-up**: the Trefftz-plane vortices advected by their own velocity in 2-D (Krasny smoothing, RK2), with the
  distance behind the wing standing in for time.

## Tabs

- **Planform & lift**: the wing by sliders, presets (textbook wings and the five Flight & Atmosphere aircraft) or by
  dragging the tip on a top view (span and sweep at constant area; taper). A 3-D view you turn and zoom: panels coloured
  by ΔCp on the Airfoil Lab's scale, lift arrows along the span, the rolling-up wake. Spanwise load c·cl/c̄ against the
  elliptic loading with the same lift and the lifting line; local cl. CL, CLα, CDi, e, lift and root bending moment in
  real units, aerodynamic centre, zero-lift angle. Sends the root section to the Airfoil Lab at its Reynolds number.
- **Stall**: tufts on the 3-D view (attached green, stalled red and fluttering), the wing's CL–α curve against the
  root and tip sections and the linear lattice, local cl against cl,max, and the stall margin along the span with the
  aileron region shaded. First stall location and angle, CLmax, profile + induced drag, stall speed. "Pitch up slowly"
  sweeps α.
- **Wake & downwash**: the wake seen end-on at any distance behind the wing ("fly down the wake"), with the cross-flow
  it induces; the 3-D wake and a tail marker; downwash along the centre line at tail height against 2CL/(πA) and half of
  it; ε and dε/dα at the tail against 2CLα/(πA); tip-vortex spacing against π/4; ground effect on induced drag and lift
  slope against the image lifting line and Wieselsberger's fit.
- **Winglets & span**: e, induced drag and root bending moment with and without the winglet at the same lift; the span
  extension that adds the same bending moment and its drag; the load along the span and up the winglet; the saving
  against winglet height for this winglet, the same length laid flat, and the equal-moment extension.
- **Aircraft**: the five aircraft of Flight & Atmosphere at their cruise conditions, the lattice against the values
  that module uses (lift slope, Oswald e, dε/dα) and the Helmbold/DATCOM estimate, with where each wing stalls first
  relative to its ailerons. Opens the chosen aircraft in Flight & Atmosphere's Stability tab.

The Airfoil Lab's "Open in another module" panel sends a NACA 4-digit section here as the root and tip, with polars on.

## Limits

Thin, inviscid lifting surfaces: no thickness, no fuselage, no viscous drag except the strips' section drag in the
Stall tab, no transonic effects, no vortex lift on strakes or deltas, a flat (not rolled-up) wake for the downwash
numbers, and a post-stall answer that is a sketch (real stall is 3-D and history-dependent).
