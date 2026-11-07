# Orbital Mechanics

[← Back to the README](../../README.md)

Two-body orbits around Earth, the Moon, Mars, Venus, Jupiter or the Sun (`js/solvers/orbits.js`, no DOM). The Orbit &
elements and Ground tracks tabs share one orbit, so a preset or edit in one shows in the other.

- **Orbit & elements**: set the orbit by periapsis and apoapsis altitude or by a and e, plus i, Ω, ω and ν, or load an
  example (ISS, Hubble, sun-synchronous, GPS, Molniya, Tundra, GEO, GTO, LRO, MRO). A 3-D view you turn by dragging and
  zoom with the wheel: the body turning at its true rate, the equatorial plane, the orbit (solid north of the equator,
  dashed south, hidden behind the body), the line of nodes, the apsides, r, v and h, arcs for each element angle, and
  Kepler's equal-area sectors. The satellite moves by Kepler's equation (orbit in 12 s or 40 s, or 600× / 60× real
  time). Altitude, speed and flight-path angle through one orbit; the state vectors converted back to elements as a
  check; notes on drag, sun-synchronous and critical-inclination orbits, and J2 drift.
- **Transfers**: Hohmann and bi-elliptic transfers between circular orbits, or both compared, with an inclination change
  done at the best split between the burns, all at the far burn, or all at the first. Animated top view with the burns,
  a target and the lead angle it needs; Δv against r₂/r₁ showing the 11.94 and 15.58 crossovers; the cost of a plane
  change by where it is made; a table of each burn's speeds and turn. Examples from an ISS reboost to Earth → Mars.
- **Ground tracks**: the sub-satellite point on a simplified world map with J2 drift of the node, periapsis and mean
  motion (or a pure two-body orbit), up to 40 revolutions, played back with the area that sees the satellite above a
  minimum elevation and the launch sites and ground stations inside it. Revolutions per day, westward shift per orbit,
  repeat cycles, node drift against inclination and the sun-synchronous inclination against altitude.
- **Δv budget**: missions from the launch pad to LEO (ISS), a sun-synchronous orbit, GEO, low lunar orbit, a Moon landing
  and return, Earth escape, and orbits around Mars, Venus and Jupiter (Juno-like capture). Launch from seven sites:
  circular speed minus the ground's eastward speed along the launch azimuth, plus gravity and drag losses; a plane
  change if the target inclination is below the site latitude; patched-conic departures and captures
  (√(v∞² + 2μ/r) − √(μ/r)) from Sun-centred Hohmann transfers, or aerocapture. Each leg turned into propellant per
  kilogram delivered with the rocket equation, and the propellant fraction against Δv for several Isp values.

Solver: Kepler's equation by Newton's method, elements ↔ state vectors (perifocal rotation; circular and equatorial
special cases), vis-viva, Hohmann, bi-elliptic, combined plane changes (golden-section search for the split), rendezvous
lead angle and synodic period, J2 secular rates, sun-synchronous inclination, ground tracks, coverage half-angle,
track shift and repeat cycles, interplanetary Hohmann excess speeds and launch Δv with Earth's rotation.
