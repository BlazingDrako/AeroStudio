# Rocket Engines

[← Back to the README](../../README.md)

One engine design is shared by every tab (`js/solvers/rocket.js`, no DOM; chemistry from `js/solvers/thermo.js`).

- **Engine design**: pick propellants, O/F (or search for the maximum-Isp O/F), chamber pressure, thrust at sea level or
  in vacuum, L*, contraction ratio (Huzel & Huang correlation or by hand), expansion ratio, 80% Rao bell or cone, c* and
  nozzle efficiencies, equilibrium or frozen expansion, and the power cycle (a gas generator dumps a fraction of the flow
  at one third of the main Isp). Sizing: At = F/(CF·Pc), chamber volume L*·At, contour with a 1.5 Rt / 0.382 Rt throat.
  A to-scale animated cut-away colored by temperature, Mach number or pressure along a quasi-1D equilibrium expansion
  table, with the plume at any altitude. Examples load real engines and compare thrust and Isp with published values.
- **Altitude & expansion**: thrust and Isp from 0 to 90 km for the design and for half and double its ε, the
  ideally-expanded envelope and the ideal ε at each altitude, the design altitude, and an animated ascent. Flow
  separation by Kalt–Badal (default), Schmucker or Summerfield; a separated nozzle is treated as truncated where the jet
  leaves the wall. The plume: lip expansion fans or shocks, fully expanded Mach number and diameter, shock-cell length
  1.22·Dj·√(Mj² − 1) (Tam), and a Mach disk when regular reflection at the axis is impossible.
- **Propellants**: eight combinations (LOX with LH₂, LCH₄, RP-1 and ethanol; N₂O₄ with MMH, UDMH and hydrazine;
  H₂O₂/RP-1) swept over O/F at a common Pc and ε: best-Isp mixture ratio, chamber temperature, molar mass, γ, c*, vacuum
  and sea-level Isp, bulk density and density impulse; Isp vs bulk density chart; open any row in Engine design.
- **Cooling**: Bartz heat transfer coefficient with the σ property correction (Eucken Prandtl number, empirical gas
  viscosity), adiabatic wall temperature, heat flux along the wall, total heat load and the coolant temperature rise
  against its limit (RP-1 coking, etc.), liner conduction for copper, steel, Inconel or niobium, and the radiation
  equilibrium temperature that shows where an uncooled extension can take over.
