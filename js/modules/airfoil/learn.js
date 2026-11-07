// Concept explainers for the Airfoil Lab. Each ties to something visible on screen.
export const concepts = [
  {
    title: 'How an airfoil makes lift',
    html: `<p>The airfoil turns the oncoming air slightly downward. To do that, the flow over the top speeds up and its pressure drops; under the bottom it slows and pressure rises. The pressure difference, summed over the surface, is the lift.</p>
<p>Watch the particles: they race over the top and arrive at the trailing edge sooner than the ones underneath — the "equal transit time" story is a myth.</p>
<span class="eq">L = ½ ρ V∞² · c · cl</span>`,
  },
  {
    title: 'Pressure coefficient, Cp',
    html: `<p>Cp measures local pressure relative to the freestream, scaled by dynamic pressure:</p>
<span class="eq">Cp = (p − p∞) / (½ ρ V∞²) = 1 − (V/V∞)²</span>
<p>Cp = 1 at the stagnation point (flow at rest), 0 where the speed equals the freestream, and negative where the air is faster. Aerodynamicists plot −Cp upward, so the upper-surface "suction" curve sits on top. The area between the two curves is the lift.</p>`,
  },
  {
    title: 'Angle of attack and the lift slope',
    html: `<p>Thin-airfoil theory predicts lift grows by 2π per radian of angle of attack — about 0.11 per degree. Thickness adds a little; viscosity takes a little away. Camber shifts the whole line up, so a cambered airfoil makes lift at α = 0.</p>
<p>Try it: run a polar sweep and compare the slope of the cl–α line with 0.11/deg.</p>`,
  },
  {
    title: 'The boundary layer',
    html: `<p>Right at the surface the air sticks (no-slip). A thin layer — the boundary layer — carries the velocity from zero up to the outer flow speed. The colored band on the airfoil shows its <b>displacement thickness δ*</b>: how far the outer flow is pushed away by the slowed air (exaggerated for visibility).</p>
<p><b>θ</b> (momentum thickness) measures the momentum lost; the <b>shape factor H = δ*/θ</b> describes the velocity profile's fullness. H ≈ 2.6 laminar, ≈ 1.4 turbulent; H rising toward 3–4 warns of separation.</p>`,
  },
  {
    title: 'Laminar, turbulent, transition',
    html: `<p>A laminar boundary layer is smooth and low-friction but fragile. Small disturbances (Tollmien–Schlichting waves) grow as they travel downstream. The <b>eⁿ method</b> tracks their amplification n; when n reaches <b>N-crit</b>, the layer becomes turbulent.</p>
<p>N-crit ≈ 9 matches an average wind tunnel; 11–14 a very quiet sailplane flight; 4–8 dirty or turbulent air. You can also trip the boundary layer at a fixed x/c, like a strip of tape on a model wing.</p>`,
  },
  {
    title: 'Separation and stall',
    html: `<p>Toward the trailing edge the pressure rises again (an adverse pressure gradient). The slow air near the wall can stall against it and reverse direction — the flow <b>separates</b> (skin friction cf &lt; 0, red on the surface).</p>
<p>At high angle of attack separation moves forward, the wake thickens, lift stops growing and drag shoots up: the airfoil stalls. Turbulent layers resist separation better than laminar ones, which is why golf balls have dimples.</p>`,
  },
  {
    title: 'Reynolds number',
    html: `<span class="eq">Re = ρ V c / μ</span>
<p>The ratio of inertial to viscous forces. Small drones and model aircraft fly at 10⁴–10⁵ (thick laminar layers, separation bubbles), light aircraft around 10⁶–10⁷, airliner wings 10⁷–10⁸. Higher Re means thinner boundary layers and lower drag coefficients.</p>`,
  },
  {
    title: 'Where drag comes from',
    html: `<p><b>Friction drag</b>: shear stress in the boundary layer, integrated over the surface. <b>Pressure (form) drag</b>: the boundary layer prevents full pressure recovery at the tail, leaving net rearward force.</p>
<p>Total drag here comes from the momentum deficit in the far wake (Squire–Young formula):</p>
<span class="eq">cd = 2 θ∞/c · (ue/V∞)^((5+H)/2)</span>`,
  },
  {
    title: 'Compressibility and critical Mach',
    html: `<p>As freestream Mach rises, the air compresses and pressure peaks grow. The <b>Kármán–Tsien correction</b> scales the incompressible Cp to account for this.</p>
<p>When local speed somewhere reaches Mach 1 (Cp drops to the critical value Cp*), the freestream Mach is "critical". Beyond it a supersonic pocket forms, ending in a shock wave — the yellow line in the field marks local Mach 1. Transonic airfoils are shaped to keep this pocket weak.</p>`,
  },
  {
    title: 'How this solver works',
    html: `<p>Two models are solved together with Newton's method, the same approach XFOIL uses:</p>
<p>1. A <b>panel method</b> represents the airfoil with ~200 linear-vortex panels; the strengths are chosen so no air passes through the surface and the flow leaves the trailing edge smoothly (Kutta condition).</p>
<p>2. <b>Integral boundary-layer equations</b> (momentum, kinetic energy, and amplification or shear-lag) march along the surface and wake. The boundary layer feeds back by blowing the outer flow outward (source panels).</p>
<p>Ported from <i>mfoil</i> by K. J. Fidkowski (MIT license). The convergence plot shows the Newton residual dropping — quadratically near the end.</p>`,
  },
];

// Concepts for the Supersonic tab.
export const superConcepts = [
  {
    title: 'Why supersonic airfoils are sharp',
    html: `<p>Above Mach 1, air ahead of the airfoil gets no warning that it is coming: pressure waves cannot travel upstream. The flow must turn abruptly at the nose, through a <b>shock wave</b>.</p>
<p>A shock can only turn the flow so far (θmax, about 23° at Mach 2). A sharp nose keeps the turn small, so the shock stays <b>attached</b> and weak. A round nose needs a 90° turn, so a curved <b>bow shock</b> stands off in front of it, with a high-pressure subsonic region behind — lots of wave drag.</p>`,
  },
  {
    title: 'Shock-expansion theory',
    html: `<p>Walk along each surface from the nose:</p>
<p>1. At the nose the surface turns into the flow → an <b>oblique shock</b> (pressure jumps up, Mach drops).<br>
2. Wherever the surface turns away from the flow → a <b>Prandtl–Meyer expansion fan</b> (pressure falls smoothly, Mach rises). Gentle turns toward the flow are treated as smooth compressions.<br>
3. At the trailing edge the two streams meet at different pressures, so one more shock and fan bring them to equal pressure along a <b>slip line</b>.</p>
<p>Each step uses exact gas-dynamics relations, so it is accurate for thin, sharp sections as long as shocks stay attached.</p>`,
  },
  {
    title: 'Linear (Ackeret) theory',
    html: `<p>For thin airfoils and small angles, the pressure depends only on the local surface slope θ:</p>
<span class="eq">Cp = 2θ / √(M² − 1)</span>
<p>That gives simple results: <b>cl = 4α/√(M²−1)</b> (much smaller than the subsonic 2πα), and wave drag <b>cd = 4(α² + K·t²)/√(M²−1)</b>, with K depending on the shape. It breaks down near Mach 1, where √(M²−1) → 0. The dashed lines in the plots show it.</p>`,
  },
  {
    title: 'Wave drag',
    html: `<p>In subsonic flow, an ideal fluid exerts no drag (d'Alembert's paradox). Supersonic flow is different: front-facing surfaces sit behind a shock at high pressure, rear-facing ones in an expansion at low pressure. The net push backward is <b>wave drag</b>, energy carried away by the shock waves.</p>
<p>It has two parts: <b>thickness</b> wave drag (∝ t²) and <b>drag due to lift</b> (∝ α²). Best L/D comes where drag due to lift equals all the zero-lift drag.</p>`,
  },
  {
    title: 'Aerodynamic center moves aft',
    html: `<p>Subsonic airfoils carry lift near the quarter chord. In supersonic flow the lift is spread evenly along the chord (on a flat plate, exactly uniform), so the centre of pressure moves back toward <b>mid-chord</b>.</p>
<p>For an aircraft this means a strong nose-down pitching moment when it goes supersonic, which must be trimmed out (Concorde pumped fuel aft to compensate).</p>`,
  },
  {
    title: 'Live CFD (Euler)',
    html: `<p>The CFD option solves the 2-D <b>Euler equations</b> (inviscid compressible flow) on a grid of cells, on your GPU. Each step moves mass, momentum and energy between cells using an approximate Riemann solver (HLLC) with second-order reconstruction.</p>
<p>It handles what simple theory cannot: detached bow shocks on round noses, transonic flow near Mach 1, and waves bending as they interact. It has no viscosity, and shocks are smeared over a few cells; a finer grid makes them sharper.</p>`,
  },
];
