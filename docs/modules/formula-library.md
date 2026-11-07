# Formula Library

[← Back to the README](../../README.md)

- **127 formulas in 11 topics**: atmosphere and gas properties, low-speed aerodynamics, compressible flow, jet propulsion,
  rockets, flight performance, stability, structures, vibration, orbital mechanics, thermodynamics and heating.
- **Solve for any variable.** Each formula is written once as `f(x) => [lhs, rhs]` in SI (`js/modules/formulas/data/`).
  The solver (`js/solvers/formulas.js`) scans the unknown's physical range, refines every sign change by bisection and
  rejects poles, so formulas with more than one answer list them all (subsonic/supersonic A/A*, weak/strong oblique shock,
  both sides of the power curve, below/above resonance). The root nearest the previous value is kept, so plots follow
  one branch.
- **Plot** the answer against any input, optionally comparing three values of a third variable; linear or log axes; CSV export.
- **Units**: SI/US switch plus a unit menu on every value (temperatures handled with offsets). Inputs have log-scaled sliders.
- **Understand it**: every formula has what it means, where it comes from, when it holds, typical values, a pitfall,
  its symbols, related formulas and a link into the full tool. Each topic has a page of key ideas.
- Search (press `/`), favourites (saved in the browser), and shareable links: `#/formulas?f=tbm`, `#/formulas?t=orbit`.
