# Jet Engine Cycles

[← Back to the README](../../README.md)

- **Cycle analysis** (`js/solvers/cycles.js`): turbojet (optional afterburner), turbofan (separate or mixed exhaust, afterburner,
  "match fan PR" for the mixer), turboprop (free power turbine, optimal work split, BSFC/ESP), ramjet (Rayleigh thermal-choking
  check) and scramjet (Heiser & Pratt first-law model, constant-pressure or constant-area combustion). Station-by-station states
  (SAE ARP 755 numbering), ISA atmosphere, polytropic or isentropic efficiencies, convergent or C-D nozzles. Three gas models:
  ideal (γ = 1.4), two-γ (Mattingly's model with losses) and real gas (NASA polynomials with equilibrium combustion products).
  Animated cut-away colored by total temperature, T–s diagram, station table, efficiency and energy breakdown.
- **Trade studies**: sweep any design/flight variable with an optional family of curves, carpet plot, and a specific impulse vs
  Mach chart comparing every engine type.
- **Stage calculators**: atmosphere, inlet, compressor, combustor (with Rayleigh limit), turbine, nozzle, mixer and propeller
  (actuator disk), each with the equations shown step by step.
- **Inlets & shocks** (`js/solvers/inlets.js`): pitot, N-ramp external compression (Oswatitsch optimum or manual ramps) and
  all-oblique scramjet inlets, shock-on-lip geometry, recovery vs MIL-E-5008B.
- **Turbomachinery** (`js/solvers/turbo.js`): axial compressor and turbine stages (velocity triangles, animated cascades, de Haller,
  diffusion factor, Zweifel), centrifugal and mixed-flow impellers (Wiesner/Stodola/Stanitz slip, inducer Mach), specific-speed
  chart and an illustrative compressor map with surge margin.
- **Chemical equilibrium** (`js/solvers/thermo.js`): Gibbs minimization by the NASA CEA method (Gordon & McBride, RP-1311) for
  TP, HP and SP problems and the CEA rocket problem (equilibrium or frozen), using NASA TM-4513 polynomials for 28 species
  (`js/solvers/thermoData.js`). Validated: H₂/O₂ flame 3078.7 K (CEA 3079 K), CH₄/air 2225.7 K (CEA 2226 K).
