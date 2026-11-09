# Development

[← Back to the README](../README.md)

Pteronautics is plain JavaScript modules: no build step, no dependencies. Edit a file and reload.
Run it with `python3 serve.py` (the server sends `Cache-Control: no-store`, so every reload picks up your edits).

## Code layout

```
index.html, css/styles.css     app shell and design tokens (light/dark)
js/app.js                      navigation + module registry (add new modules here)
js/lib/                        shared: ui controls, plotting, linear algebra, splines,
                               state.js (save/share), export.js (PNG/CSV/report), search.js (⌘K)
js/solvers/mfoil/              solver port (no DOM; runs in a Web Worker)
js/modules/airfoil/            Airfoil Lab UI, GPU field renderer, insights, concept cards
js/modules/propulsion/         Jet Engine Cycles UI (cycle, trades, stages, inlets, turbomachinery, CEA)
js/modules/structures/         Structures Workbench UI (canvas editor, FBD/statics, 3D frames, FEA, vibration, sections, Mohr's circle)
js/modules/cfd/                Fluid Flow Sandbox UI, GPU lattice-Boltzmann solver and renderer, scenes, shapes and geometry
js/solvers/lbm.js              lattice-Boltzmann CPU reference (no DOM)
js/solvers/panel2d.js          multi-body panel method with ground effect (Airfoil Lab's Vehicle aero tab, no DOM)
js/modules/flight/             Flight & Atmosphere UI (atmosphere, airspeeds, turbulence, performance, turns, envelope, stability, modes)
js/solvers/atmosphere.js       standard atmosphere, airspeeds, wind profile, Dryden turbulence, spectra (no DOM)
js/solvers/performance.js      aircraft models and performance: speeds, climb, range, runway, turns, V–n, Ps map (no DOM)
js/solvers/stability.js        geometry-based derivatives, trim, state matrices, eigen-analysis, handling qualities (no DOM)
js/modules/rocket/             Rocket Engines UI (engine design and cut-away, altitude & expansion, propellants, cooling)
js/solvers/rocket.js           engine sizing, contour, expansion table, separation, plume, Bartz heat flux (no DOM)
js/modules/wings/              Wings & 3D Aero UI (planform editor, 3-D wing view, stall, wake & downwash, winglets, aircraft)
js/solvers/wing.js             vortex lattice, lifting line, Trefftz drag, ground effect, Göthert, stall strips, wake roll-up (no DOM)
js/modules/orbits/             Orbital Mechanics UI (3-D orbit view, transfers, ground tracks on a simplified world map, Δv budget)
js/solvers/orbits.js           Kepler's equation, elements ↔ state, Hohmann/bi-elliptic/plane changes, J2, ground tracks, Δv budgets (no DOM)
js/modules/gnc/                Guidance, Navigation & Control UI (control loops, augmentation & FBW, autopilots, navigation, INS & GNSS, collaborative flight)
js/solvers/control.js          transfer functions, margins, root locus, step response, compensators (no DOM)
js/solvers/augment.js          augmentation laws, loop at the actuator, nonlinear time simulation, MIL-F-8785C levels (no DOM)
js/solvers/autopilot.js        autopilot modes and cascades, loop analysis, simulation with limits and anti-windup (no DOM)
js/solvers/navigation.js       WGS-84 geodesy, Vincenty, rhumb lines, wind triangle, dead reckoning, VOR/DME/ILS (no DOM)
js/solvers/collab.js           formation wakes, Hungarian/bottleneck/auction assignment, beacon location and CRLB, rendezvous (no DOM)
js/solvers/ins.js              INS error model, Schuler/vertical channel, GPS constellation, least squares, DOP, INS/GNSS Kalman filter (no DOM)
js/modules/formulas/           Formula Library UI; data/ holds the formulas, library.js the topics and constants
js/solvers/formulas.js         Formula Library solver and unit tables (no DOM)
js/solvers/frame2d.js, frame3d.js, statics.js, sections.js, units.js   structures solvers (no DOM)
tests/                         validation suite
```

Each module is `{ id, title, mount(root), unmount() }` and shares the UI kit, plots and visualization helpers.

## How the shared pieces fit

- **Modules** register in `js/app.js`. A module object is `{ id, title, mount(root), unmount() }`, plus optional
  `tabs` (`[{ id, label }]`), `concepts` (`[{ title, html }]`) and `links` (`[{ title, sub, href, body, alias }]`)
  that the search index reads.
- **Saving and sharing** (`js/lib/state.js`): a module opens a `session(id, { title, tab })`, adds `session.toolbar()` to
  its header and calls `session.watch(root)`. Each tab wraps its settings object in `keep({ ... })` before building its
  controls; the object is filled in place from the last save or a shared link, and only values that differ from the
  defaults are stored. Keys starting with `_`, keys that start out `null` (computed results) and transient keys
  (`hover`, `playing`, …) are not saved. `session.extra(key, { get, set, reset })` adds custom state such as the
  drawn structure. Links are deflate-compressed into `?s=…`.
- **Export** (`js/lib/export.js`): every `Plot` gets a PNG/CSV button. `watchViews()` puts a PNG button on every other
  canvas's container; a view is captured by drawing its canvases (2-D and WebGL, which use `preserveDrawingBuffer`)
  and its `.legend` onto one image. The Report button reads the control panel's inputs and clones the results with
  plots and views turned into pictures, rendered in the light theme behind an opaque cover.
- **Open in another module** (`js/lib/send.js`): `sendSection([{ label, sub, go }])` adds the panel to a tab's controls;
  `sendTo({ mod, tab, key, values, note })` opens the target through a share link marked `merge`, so the values are
  deep-merged into that tab's remembered settings (same names and units as its settings object) instead of replacing
  them. `go` can return a string to explain why nothing can be sent yet.
- **Search** (`js/lib/search.js`): the index is built at start-up from the module objects and the Formula Library.

## Adding a module

1. Make `js/modules/<name>/index.js` exporting the module object, following an existing tabbed module
   (`js/modules/rocket/index.js` is a compact example), and `learn.js` with its concept notes.
2. Keep the physics in `js/solvers/<name>.js` with no DOM access, so it can be tested on its own.
3. Register it in `js/app.js` (replacing the planned entry, if there is one) and add a card preview in `js/previews.js`.
4. Add tests in `tests/<name>.tests.js` and register them in `tests/tests.js`; add a page in `docs/modules/`.

## Tests

Open http://localhost:8765/tests/ (see [validation.md](validation.md) for what is checked and how to run a subset).
