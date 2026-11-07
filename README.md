# AeroStudio

Free, visual aerospace engineering tools that run in the browser. Every result comes with a
picture to attach the concept to.

## Run it

- **macOS:** double-click `start.command` (first time: right-click → Open).
- **Windows:** double-click `start.bat`.
- **macOS app:** double-click `AeroStudio.app` in this folder (no Terminal window; quit it from the Dock to stop the server).
- **Any system:** `python3 serve.py`, then open http://localhost:8765

If AeroStudio is already running, launching again just opens it in the browser; if port 8765 is taken by
something else, the next free port is used.

A tiny local server is needed because browsers block JavaScript modules and background
workers on `file://` pages. Python 3 is the only requirement; there is no build step and nothing to install.
The same folder can be hosted as-is on any static web host (for example GitHub Pages) so people need nothing installed at all.

## Modules

| Module | What it does |
| --- | --- |
| [Airfoil Lab](docs/modules/airfoil-lab.md) | Viscous airfoil analysis (an XFOIL-class port of mfoil) with live flow visualization, polar sweeps, supersonic sections, and vehicle aero from F1 cars to fighters |
| [Shocks & Nozzles](docs/modules/shocks-and-nozzles.md) | Compressible-flow calculator, shocks and expansion fans you can see, nozzles and plumes, the θ–β–M chart, a shock tube and a live Euler CFD solver |
| [Fluid Flow Sandbox](docs/modules/fluid-flow-sandbox.md) | Real-time 2-D viscous flow on the GPU (lattice Boltzmann): 12 scenes, obstacles you draw and drag, forces, probes and spectra |
| [Rocket Engines](docs/modules/rocket-engines.md) | Liquid engines sized from a thrust requirement with equilibrium chemistry, compared with eight real engines; altitude, plumes, propellants and cooling |
| [Jet Engine Cycles](docs/modules/jet-engine-cycles.md) | Turbojet to scramjet cycles station by station, trade studies, stage calculators, inlets, turbomachinery and chemical equilibrium |
| [Structures Workbench](docs/modules/structures-workbench.md) | Free-body diagrams and statics, 2-D and 3-D frames, 2-D FEA, sections, Mohr's circle, vibration and buckling |
| [Flight & Atmosphere](docs/modules/flight-and-atmosphere.md) | Standard atmosphere, airspeeds and turbulence; performance, envelope, stability and dynamic modes for five aircraft |
| [Orbital Mechanics](docs/modules/orbital-mechanics.md) | The six elements in 3D with the satellite moving by Kepler's equation, Hohmann, bi-elliptic and plane-change transfers, ground tracks with J2 drift, and Δv budgets from the pad to Mars |
| [Guidance, Navigation & Control](docs/modules/gnc.md) | Control loops, fly-by-wire, autopilots, navigation, INS/GNSS Kalman filtering and collaborative flight |
| [Formula Library](docs/modules/formula-library.md) | 127 formulas in 11 topics: solve for any variable, plot, switch units, read what each one means |

Planned: Wings & 3D Aero, Propellers & Rotors, Fatigue & Composites, Launch & Reentry,
Spacecraft Systems and Aircraft Design.

## Using it

- **Search:** press **⌘K** (Ctrl+K on Windows), **/**, or **Search** in the sidebar to find any module, tab, concept
  note, formula, flow scene or vehicle. Opening a concept unfolds the note and scrolls to it.
- **Your settings are remembered** in this browser. The icon buttons at the top right of each module:
  **Copy link** (a link that opens the module with your settings; nothing is uploaded), **Save / Open** (a `.json`
  project file), **Report** (a printable page of inputs and results, or save it as a PDF) and **Reset**.
- **Open in another module:** take what you're working on further elsewhere: an airfoil into the Fluid Flow Sandbox
  (and back), a rocket engine's nozzle into Shocks & Nozzles or its chemistry into the CEA tool (and back), a ramp
  onto the θ–β–M chart (and back), and an engine cycle's flight condition into the inlet tool or Airspeeds.
- **Export:** hover any plot for a PNG image or its data as CSV; every visual view (flow fields, engine cut-aways,
  structures) has a button that saves it as a PNG.

## More

- [Validation](docs/validation.md): how every solver is checked against closed-form results, published data and reference codes
- [Development](docs/development.md): code layout, how modules, saving, export and search fit together, and adding a module
- Airfoil Lab's solver is a JavaScript port of [mfoil](LICENSE-mfoil.txt) by K. J. Fidkowski (MIT license).

## License

Copyright (C) 2026 Andrew Aguiar. AeroStudio is free software under the
[GNU General Public License v3.0](LICENSE): you may use, study, share and change it, but any copy or modified
version you distribute must keep this copyright notice, credit the original, and be released under the same license.
See [COPYRIGHT](COPYRIGHT) for details.
