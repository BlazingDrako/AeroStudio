// AeroStudio shell: navigation, routing, theming. Modules register in `modules` below.
import { h, icon } from './lib/ui.js';
import { airfoilModule } from './modules/airfoil/index.js';
import { compressibleModule } from './modules/compressible/index.js';
import { propulsionModule } from './modules/propulsion/index.js';
import { structuresModule } from './modules/structures/index.js';
import { formulasModule } from './modules/formulas/index.js';
import { cfdModule } from './modules/cfd/index.js';
import { flightModule } from './modules/flight/index.js';
import { gncModule } from './modules/gnc/index.js';
import { rocketModule } from './modules/rocket/index.js';
import { orbitsModule } from './modules/orbits/index.js';
import { PREVIEWS } from './previews.js';
import { watchViews } from './lib/export.js';
import { initSearch, openSearch, searchShortcut } from './lib/search.js';
import { loadSkin, setSkin, currentSkin, toggleSkinMenu, initEggs, flyby } from './lib/eggs.js';

// Each module: { id, title, icon, group, status: 'live' | 'planned', blurb, features, mount(root), unmount() }
const modules = [
  { ...airfoilModule, icon: 'airfoil', group: 'Aerodynamics', status: 'live',
    blurb: 'Viscous airfoil analysis with live flow visualization: pressure, streamlines, boundary layer, transition and stall, plus vehicle aerodynamics in real units.',
    features: ['Panel method + boundary layer (XFOIL-class), with lift and drag forces', 'NACA 4/5-digit or your own coordinates, flaps and polar sweeps', 'Supersonic sections and vehicle aero, from F1 cars to fighters'] },
  { id: 'wings', title: 'Wings & 3D Aero', icon: 'wing', group: 'Aerodynamics', status: 'planned',
    blurb: 'From airfoil to whole wing: see lift spread across the span, tip vortices roll up and induced drag appear, and how sweep, taper and twist decide where a wing stalls first.',
    features: ['Vortex-lattice and lifting-line solvers, with section polars from the Airfoil Lab', 'Planform, sweep, taper, twist, dihedral and winglets', 'Spanwise lift, induced drag, downwash at the tail and tip stall'] },
  { ...compressibleModule, icon: 'shock', group: 'Aerodynamics', status: 'live',
    blurb: 'Shocks, expansion fans and nozzles you can see: watch a shock move through a nozzle as back pressure drops, and Mach diamonds form in the plume.',
    features: ['Step-by-step calculator: isentropic, shocks, Prandtl–Meyer, Fanno, Rayleigh', 'Nine flow scenarios with a schlieren view, plus a shock tube', 'Conical, bell and MOC nozzles and the θ–β–M chart'] },
  { ...cfdModule, icon: 'wind', group: 'Aerodynamics', status: 'live',
    blurb: 'Real-time 2-D viscous flow on your GPU: vortex streets, stalling wings, jets and cavities. Draw obstacles and drag them through the fluid.',
    features: ['Lattice-Boltzmann solver with a turbulence model', '12 scenes: bluff bodies, an airfoil, channel, step, cavity and jets', 'Dye, vorticity, speed and pressure views'] },
  { ...rocketModule, icon: 'flame', group: 'Propulsion', status: 'live',
    blurb: 'Design a liquid rocket engine from a thrust requirement: equilibrium chamber chemistry, a to-scale chamber and bell, and the plume changing from sea level to vacuum.',
    features: ['Sizing, Isp and thrust compared with Merlin, RS-25, Raptor and more', 'Over/under-expansion, flow separation and Mach diamonds vs altitude', 'Propellant comparison and Bartz wall heat flux for cooling'] },
  { ...propulsionModule, icon: 'nozzle', group: 'Propulsion', status: 'live',
    blurb: 'Turbojets, turbofans, turboprops, ramjets and scramjets station by station, with an animated cut-away, a T–s diagram and design trade studies.',
    features: ['Cycle analysis with ideal, two-γ or real-gas models', 'Inlet shock systems, stage calculators and turbomachinery', 'Chemical equilibrium (CEA method) for flames and rocket Isp'] },
  { id: 'rotors', title: 'Propellers & Rotors', icon: 'rotor', group: 'Propulsion', status: 'planned',
    blurb: 'Propellers, helicopter rotors and drones by blade element momentum theory: see the flow through the disk, why blades are twisted, and how a rotor autorotates.',
    features: ['Blade element momentum theory, propeller maps and efficiency', 'Helicopter hover, forward flight and autorotation', 'Multirotor drones: hover power, endurance and payload'] },
  { ...structuresModule, icon: 'beam', group: 'Structures', status: 'live',
    blurb: 'Draw a beam, truss or frame and get its free-body diagram, reactions, shear and moment diagrams, deflection and stress, step by step.',
    features: ['Statics with determinacy, friction and tipping checks', 'Stiffness-method 2-D and 3-D frames, trusses and 2-D finite elements', 'Sections, Mohr\'s circle, vibration modes and buckling'] },
  { id: 'materials', title: 'Fatigue & Composites', icon: 'crack', group: 'Structures', status: 'planned',
    blurb: 'How aerospace structures wear out and what they are made of: watch a crack grow cycle by cycle, and build a composite laminate ply by ply.',
    features: ['S–N curves, mean-stress corrections and Miner\'s rule', 'Fracture toughness and crack growth (Paris law)', 'Laminate theory and Tsai–Wu failure, ply by ply'] },
  { ...flightModule, icon: 'plane', group: 'Flight', status: 'live',
    blurb: 'The air an aircraft flies through and what it can do in it: performance, the flight envelope and stability, for five aircraft from a sailplane to a fighter.',
    features: ['Standard atmosphere, airspeeds and Dryden turbulence', 'Climb, range, takeoff, landing, turns and the V–n diagram', 'Trim, root loci and the five dynamic modes, animated'] },
  { ...gncModule, icon: 'target', group: 'Flight', status: 'live', navTitle: 'Guidance & Navigation',
    blurb: 'Feedback that flies the aircraft: design control loops, then fly augmented and fly-by-wire aircraft, autopilots, navigation and formations.',
    features: ['Bode, Nyquist and a draggable root locus; dampers and fly-by-wire', 'Autopilots on a flight display; great circles, VOR, DME and ILS', 'INS/GNSS Kalman filter and collaborative formation flight'] },
  { ...orbitsModule, icon: 'globe', group: 'Flight', status: 'live',
    blurb: 'Two-body orbits, transfers and Δv budgets in an interactive 3D view, from the shape of a single orbit to a full mission plan.',
    features: ['The six orbital elements in 3D, with the satellite moving by Kepler\'s equation', 'Hohmann, bi-elliptic and plane-change transfers, animated', 'Ground tracks with J2 drift, and Δv budgets from the pad to Mars'] },
  { id: 'launch', title: 'Launch & Reentry', icon: 'rocket', group: 'Flight', status: 'planned',
    blurb: 'Get to orbit and back: stage a rocket, fly its gravity turn through max-Q into orbit, then bring a capsule home through the heat of reentry.',
    features: ['Staging, the rocket equation and payload to orbit', 'Gravity-turn ascent with drag, max-Q and gravity losses', 'Reentry corridor, deceleration and stagnation heating'] },
  { id: 'spacecraft', title: 'Spacecraft Systems', icon: 'satellite', group: 'Flight', status: 'planned',
    blurb: 'What keeps a satellite working: pointing it with reaction wheels and thrusters, keeping it at the right temperature through sunlight and eclipse, and budgeting its power and radio link.',
    features: ['Attitude dynamics and control: spin, gravity gradient, reaction wheels', 'Thermal balance through sunlight and eclipse', 'Power and link budgets for a mission'] },
  { id: 'design', title: 'Aircraft Design', icon: 'design', group: 'Design', status: 'planned',
    blurb: 'Size a whole aircraft from a mission: weight estimates, the constraint diagram that picks the wing and engine, and a layout built with the other modules.',
    features: ['Mission profile and weight fractions to a takeoff weight', 'T/W vs W/S constraint diagram from takeoff, climb, cruise and turns', 'Wing, tail and engine sized with the Airfoil Lab, Wings and Jet Engine Cycles'] },
  { ...formulasModule, icon: 'book', group: 'Reference', status: 'live',
    blurb: 'Over 100 aerospace formulas you can solve for any variable, with a live plot, unit switching and a plain-language explanation of each.',
    features: ['Solve for any variable, with every solution shown', 'Atmosphere and aero through propulsion, structures and orbits', 'Assumptions, typical values and links into the full tools'] },
];

const view = document.getElementById('view');
const nav = document.getElementById('nav');
let current = null;

function buildNav() {
  nav.replaceChildren();
  nav.append(h('div', { class: 'brand' },
    h('img', { class: 'brand-mark', src: 'assets/favicon.svg?v=3', alt: '', width: 32, height: 32, onclick: flyby }),
    h('div', {}, h('div', { class: 'brand-name' }, 'AeroStudio'), h('div', { class: 'brand-sub' }, 'See the physics'))));
  const find = h('button', { class: 'nav-item nav-search', type: 'button', title: `Search modules, concepts and formulas (${searchShortcut()})` }, icon('search'), h('span', { class: 'nav-label' }, 'Search'), h('span', { class: 'kbd' }, searchShortcut()));
  find.addEventListener('click', () => openSearch());
  const home = h('a', { class: 'nav-item', href: '#/', 'data-id': 'home' }, icon('home'), h('span', { class: 'nav-label' }, 'Home'));
  nav.append(find, home);
  let group = null;
  for (const m of modules) {
    if (m.group !== group) { group = m.group; nav.append(h('div', { class: 'nav-group' }, group)); }
    nav.append(h('a', { class: 'nav-item' + (m.status === 'planned' ? ' planned' : ''), href: '#/' + m.id, 'data-id': m.id, title: m.title + (m.status === 'planned' ? ' (coming soon)' : '') }, icon(m.icon), h('span', { class: 'nav-label' }, m.navTitle || m.title)));
  }
  const themeBtn = h('button', { class: 'nav-item', type: 'button' });
  const paintTheme = () => { const dark = resolvedTheme() === 'dark'; themeBtn.replaceChildren(icon(dark ? 'sun' : 'moon'), h('span', { class: 'nav-label' }, dark ? 'Light theme' : 'Dark theme')); };
  // shift-click opens the secret themes; a plain click leaves any secret theme and flips light/dark
  themeBtn.addEventListener('click', e => {
    if (e.shiftKey) { toggleSkinMenu(themeBtn, id => { setSkin(id); applyTheme(); paintTheme(); }); return; }
    if (currentSkin()) { setSkin(''); setTheme('light'); } else setTheme(resolvedTheme() === 'dark' ? 'light' : 'dark');
    paintTheme();
  });
  paintTheme();
  nav.append(h('div', { class: 'sidebar-foot' }, themeBtn, h('div', { class: 'sidebar-credit' }, 'Made by Andrew Aguiar')));
}

function resolvedTheme() {
  if (currentSkin()) return 'dark'; // the secret themes are all drawn on top of dark mode
  const t = document.documentElement.dataset.theme;
  if (t === 'light' || t === 'dark') return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('aerostudio-theme', t); } catch { }
  applyTheme();
}
function applyTheme() {
  document.documentElement.dataset.resolvedTheme = resolvedTheme();
  dispatchEvent(new Event('themechange'));
}

function route() {
  const id = (location.hash.replace(/^#\/?/, '') || 'home').split('?')[0];
  for (const a of nav.querySelectorAll('.nav-item[data-id]')) a.classList.toggle('active', a.dataset.id === id);
  if (current && current.unmount) current.unmount();
  view.replaceChildren();
  const m = modules.find(m => m.id === id);
  if (!m) { current = null; renderHome(); return; }
  current = m;
  document.title = `${m.title} — AeroStudio`;
  if (m.status === 'live') m.mount(view);
  else renderPlanned(m);
}

function renderHome() {
  document.title = 'AeroStudio';
  const card = m => {
    const live = m.status === 'live';
    const tag = h('span', { class: 'tag' + (live ? ' live' : '') }, live ? 'Ready' : 'Coming soon');
    return h(live ? 'a' : 'div', { class: 'card' + (live ? '' : ' dim'), href: live ? '#/' + m.id : null },
      PREVIEWS[m.id] ? h('div', { class: 'card-preview', html: PREVIEWS[m.id]() }) : null,
      h('div', { class: 'row' }, h('div', { class: 'ci' }, icon(m.icon, 20)), h('div', { class: 'grow' }), tag),
      h('h3', {}, m.title), h('p', {}, m.blurb), h('ul', {}, ...m.features.map(f => h('li', {}, f))));
  };
  const live = modules.filter(m => m.status === 'live'), planned = modules.filter(m => m.status !== 'live');
  const groups = [...new Set(live.map(m => m.group))];
  const section = (title, list, extra) => h('section', { class: 'home-section' + (extra || '') },
    h('div', { class: 'home-section-head' }, h('h2', {}, title), h('span', {}, list.length + (list.length === 1 ? ' tool' : ' tools'))),
    h('div', { class: 'cards' }, ...list.map(card)));
  const browse = h('a', { class: 'btn hero-btn', href: '#tools' }, 'Browse tools');
  browse.addEventListener('click', e => { e.preventDefault(); view.querySelector('#tools')?.scrollIntoView({ behavior: 'smooth' }); });
  view.append(h('div', { class: 'home' },
    h('header', { class: 'home-hero' },
      h('div', { class: 'home-hero-art', 'aria-hidden': 'true', html: HERO_PLANE_SVG }),
      h('div', { class: 'home-hero-text' },
        h('span', { class: 'hero-pill' }, `${live.length} tools · free · runs in your browser`),
        h('h1', {}, 'Aerospace engineering ', h('span', { class: 'accent' }, 'you can see.')),
        h('p', {}, 'Professional-grade analysis tools with a visual to attach every concept to: watch pressure build on a wing, the boundary layer thicken and separate, shocks form and engines breathe.'),
        h('div', { class: 'hero-actions' }, h('a', { class: 'btn primary hero-btn', href: '#/airfoil' }, 'Open Airfoil Lab', icon('arrow-right', 16)), browse))),
    h('div', { class: 'home-inner', id: 'tools' },
      ...groups.map(g => section(g, live.filter(m => m.group === g))),
      planned.length ? section('Coming soon', planned, ' soon') : null,
      h('footer', { class: 'home-credit' }, 'Made by Andrew Aguiar'))));
}

// The logo plane, large, climbing across the home-page hero: a flickering exhaust flame and
// speed streaks rushing past make it look like it is flying (all CSS; still when reduced motion is on)
const HERO_PLANE_SVG = `<svg viewBox="0 0 300 200">
  <defs>
    <linearGradient id="hero-plume" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="var(--hl)"/><stop offset="1" stop-color="var(--hl)" stop-opacity="0"/></linearGradient>
    <linearGradient id="hero-core" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="#ffe2b8"/><stop offset=".5" stop-color="#ffb36b"/><stop offset="1" stop-color="#ff8a3d" stop-opacity="0"/></linearGradient>
  </defs>
  <g transform="translate(166 92) rotate(-34) scale(1.55) translate(-76 -19)">
    <g class="hp-streaks">
      <line x1="70" y1="-36" x2="96" y2="-36" style="animation-duration:1.6s;animation-delay:-0.0s"/>
      <line x1="110" y1="-6" x2="144" y2="-6" style="animation-duration:1.3s;animation-delay:-0.5s"/>
      <line x1="95" y1="56" x2="117" y2="56" style="animation-duration:1.8s;animation-delay:-1.1s"/>
      <line x1="40" y1="-16" x2="58" y2="-16" style="animation-duration:1.5s;animation-delay:-0.8s"/>
      <line x1="60" y1="68" x2="90" y2="68" style="animation-duration:1.4s;animation-delay:-0.25s"/>
      <line x1="130" y1="36" x2="154" y2="36" style="animation-duration:1.7s;animation-delay:-1.4s"/>
      <line x1="120" y1="-48" x2="140" y2="-48" style="animation-duration:1.9s;animation-delay:-0.6s"/>
      <line x1="20" y1="12" x2="48" y2="12" style="animation-duration:1.5s;animation-delay:-1.7s"/>
      <line x1="115" y1="80" x2="133" y2="80" style="animation-duration:1.6s;animation-delay:-0.95s"/>
    </g>
  </g>
  <g class="hp-float">
    <g transform="translate(166 92) rotate(-34) scale(1.55) translate(-76 -19)">
      <path class="hp-plume" d="M14.4 22.6 L-58 23.9 L-58 25.3 L14.4 26.6 Z"/>
      <path class="hp-core" d="M14.4 23.3 L-16 24.3 L-16 24.9 L14.4 25.9 Z"/>
      <path class="far" d="M55.7 16.9 L34.6 3.4 L27.3 3.4 L23.3 18.8 Z"/>
      <path d="M43.5 30.0 L38.0 34.4 L33.7 34.4 L32.8 29.5 Z"/>
      <path d="M21.5 21.2 L14.4 22.3 L14.4 26.9 L21.5 27.5 Z"/>
      <path class="far" d="M74 23.2 L18 25.6 L12 27.4 L16 27.6 L70 26 Z"/>
      <path d="M134.0 23.1 L129.1 21.5 L122.4 19.9 L115.0 18.8 L107.1 18.0 L102.8 16.9 L95.5 16.5 L85.7 16.3 L78.3 15.8 L63.0 16.5 L51.4 16.9 L35.5 17.9 L23.3 19.4 L21.5 20.9 L21.5 27.6 L28.8 29.1 L45.3 30.0 L85.7 30.3 L88.1 29.1 L92.4 26.6 L106.5 26.0 L112.6 26.5 L118.7 26.5 L122.4 25.6 L129.7 24.4 Z"/>
      <path class="wing-root" d="M84 23.4 L44 24.2"/>
      <path d="M52.7 17.1 L31.2 3.0 L23.6 3.0 L19.9 19.7 Z"/>
      <path class="glass" d="M107.1 18.0 L102.8 14.4 L97.9 12.5 L90.6 11.9 L83.2 12.7 L74.7 15.6 L78.3 15.8 L95.5 16.5 L102.8 16.9 Z"/>
    </g>
  </g>
</svg>`;

function renderPlanned(m) {
  view.append(h('div', { class: 'home' }, h('div', { class: 'home-inner' },
    h('div', { class: 'hero' }, h('div', { class: 'ci', style: { width: '44px', height: '44px', borderRadius: '11px', display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent)', marginBottom: '14px' } }, icon(m.icon, 24)),
      h('h1', {}, m.title), h('p', {}, m.blurb)),
    h('div', { class: 'cards' }, h('div', { class: 'card' }, h('h3', {}, 'Planned features'), h('ul', {}, ...m.features.map(f => h('li', {}, f)))),
      h('div', { class: 'card' }, h('h3', {}, 'Status'), h('p', {}, 'This module is on the roadmap. The app is built so each tool is a self-contained module sharing the same controls, plots and visualization engine.'))))));
}

try { const t = localStorage.getItem('aerostudio-theme'); if (t) document.documentElement.dataset.theme = t; } catch { }
loadSkin();
document.documentElement.dataset.resolvedTheme = resolvedTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { document.documentElement.dataset.resolvedTheme = resolvedTheme(); dispatchEvent(new Event('themechange')); });
buildNav();
initEggs();
document.body.append(h('footer', { class: 'made-by' }, 'Made by Andrew Aguiar'));
addEventListener('hashchange', route);
watchViews(view);
initSearch(modules);
route();
if (document.fonts) document.fonts.ready.then(() => dispatchEvent(new Event('themechange')));
