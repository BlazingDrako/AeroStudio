# Structures Workbench

[← Back to the README](../../README.md)

One drawn model feeds every analysis. Draw members on a snapping grid, add supports and loads, and switch views.
Units are switchable (SI kN/m/mm, SI N/m, SI N/mm, US kip/ft/in, US lbf/in); everything is stored in SI.

- **Free-body diagrams & statics** (`js/solvers/statics.js`): splits the structure into rigid bodies, two-force members and
  pins; counts unknowns vs. independent equations (rank) to classify it as determinate, indeterminate (with degree) or a
  mechanism; solves determinate cases step by step in textbook order (whole structure → bodies → method of joints, picking
  moment points that isolate one unknown). Body-by-body FBDs with pin forces.
- **Friction, tipping, cables**: unilateral contacts (N ≥ 0, |F| ≤ µN) and tension-only cables are handled as a rigid-body
  limit analysis (linear program, `js/lib/eigen.js`): the largest factor on a chosen load before something slips, tips or
  goes slack, and which mechanism it is. Validated: crate slides at µW / tips at W·b/2h, ladder limit tan θ = 2µ.
- **Stiffness method** (`js/solvers/frame2d.js`): Euler–Bernoulli frames, truss bars, tension-only cables; member-end hinges
  (own rotation DOF), inclined supports, springs, settlements; point/distributed (global, projected, local; linearly varying,
  partial)/moment/thermal (uniform and gradient) member loads and self weight. Exact N, V, M diagrams and deflected shapes,
  combined stresses vs. yield, Euler checks. Detects mechanisms and animates them.
- **Vibration modes** (consistent mass, effective modal mass) and **linear buckling** (geometric stiffness); members are
  subdivided automatically, truss bars become pin-ended beams so they can buckle on their own.
- **Sections** (`js/solvers/sections.js`): rectangle, round, tube, box, I, channel, tee, angle, Z, hat stringer: A, centroid,
  I, principal axes, S, plastic Z, J, Q, shear centre; σ(y) and τ(y) = VQ/Ib through the depth; material library.
- **2D FEA** (`js/solvers/fem2d.js`): parts bounded by lines and arcs with holes (plate with a hole, U-notched bar, shoulder
  fillet, pin-loaded lug, L-bracket, deep cantilever) or your own drawn outline and holes. Automatic graded mesh (quadtree
  points + conforming Delaunay + smoothing), 6-node quadratic triangles with curved edges on arcs, plane stress or strain,
  per-edge supports (fixed, roller, symmetry) and loads (force, pressure, shear, cosine pin bearing), skyline Cholesky with
  RCM ordering. Contours of von Mises / principal / component stresses and displacements, deformed shape, probe line
  plots, Kt vs handbook, reactions, and a five-level mesh convergence study. Validated: patch test exact; hole Kt within
  0.2% of Heywood; cantilever within 1% of Timoshenko beam theory.
- **3D frames** (`js/solvers/frame3d.js`): space frames and space trusses with 12-DOF beams (axial, St Venant torsion,
  bending about both principal axes), section roll angle, member-end pins (static condensation), supports with any of the
  six restraints plus springs, node forces/moments, distributed (global, projected or local), point, torque and thermal
  member loads, self weight. Unresisted joint rotations are removed per node; real mechanisms are reported and animated.
  Exact N, Vy, Vz, T, My, Mz along members from statics, deflections by integrating curvature, combined stress (biaxial
  bending + torsion + shear, von Mises), equilibrium check in all six directions. Vibration modes with effective mass and
  linear buckling (geometric stiffness; open sections get approximate warping stiffness for torsional buckling).
  Orbitable 3D view (drag, pan, zoom, preset views) with moment/shear diagrams in each bending plane, axial/torque colouring,
  stress heat map, deflected and mode shapes. Examples: L-bracket, biaxial cantilever, tripod, grillage, portal, building,
  lattice tower, engine mount, wing spars with drag bracing.
- **Vibration** (`js/solvers/vibration.js`): spring–mass–damper lab (free, harmonic force, harmonic base motion, step, pulses,
  impact, sine sweep, half-sine base shock, synthetic Kanai–Tajimi earthquake) solved with the exact piecewise-linear
  recurrence; magnification/transmissibility families, pulse shock spectra and base-shock response spectra; animated
  mass. Tuned-mass absorber with Den Hartog optimum. Response of the drawn structure by modal superposition: frequency
  response (log axes, operating shapes), impacts, and base shaking with base-shear history and effective mass.
- **Stress & strain**: Mohr's circle (draggable) with rotating stress element, principal and absolute max shear, von Mises and
  Tresca, Hooke's-law strains, 0/45/90 and 0/60/120 strain-gauge rosettes.
