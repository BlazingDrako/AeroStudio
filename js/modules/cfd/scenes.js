// Ready-made flow scenes. Each build(nx, ny) returns:
//   objects   obstacles (see shapes.js); `ref: true` marks the one whose size is the Reynolds-number length
//   L         reference length in cells (used when there is no ref obstacle)
//   bc, inflow, lid, force(ν)   solver boundary conditions and driving
//   forced    jet regions [{ x0, x1, y0, y1, u }]
//   init(i, j), dyeInit(i, j)   initial flow and dye
//   dye       { streaks, body, decay } defaults (decay 1 = dye never fades, for closed flows)
//   wobble    { amp, period }: jets wobble sideways by amp·U with this period (steps) to seed their instability
//   probe     a cell used to watch for instability
//   sponge    absorbing layers (see LBM in js/solvers/lbm.js); added to every scene with slip walls by withSponge()
// Speeds are in lattice units; U_LAT is the reference speed of every scene.
export const U_LAT = 0.1;

const ob = (type, x, y, size, extra = {}) => ({ type, x, y, size, angle: 0, ...extra });
const box = (x0, y0, x1, y1) => ({ type: 'box', x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, size: Math.max(x1 - x0, y1 - y0), locked: true });
// small sideways nudge behind a body so shedding starts sooner
const kick = (cx, cy, D) => (i, j) => (i > cx && i < cx + 4 * D && j > cy && j < cy + D ? [1, U_LAT, 0.15 * U_LAT] : null);
// absorbing layers along slip walls and the outlet stop sound waves from being trapped between the walls
export const sponge = (nx, ny) => ({ sigma: 0.05, y: Math.round(ny * 0.08), x: Math.round(nx * 0.05) });
const external = { bc: { x: 'flow', y: 'slip' }, dye: { streaks: true, body: true } };

function body(type, extra = {}) {
  return (nx, ny) => {
    const D = Math.round(ny / 9), cx = Math.round(nx / 5), cy = ny / 2;
    return { ...external, objects: [ob(type, cx, cy, D, { ref: true, ...extra })], L: D, init: kick(cx, cy, D), probe: [cx + 3 * D, Math.floor(cy)] };
  };
}
// A nozzle along x: walls above and below a slot of width h, a closed back end, and forced cells blowing at speed u
// (sign gives the direction). (x, y) is the nozzle exit centre.
function nozzle(x, y, h, len, dir) {
  const t = Math.max(2, Math.round(h / 4)), back = x - dir * len;
  const xa = Math.min(x, back), xb = Math.max(x, back);
  const objs = [box(xa, y + h / 2, xb, y + h / 2 + t), box(xa, y - h / 2 - t, xb, y - h / 2)];
  const bx0 = dir > 0 ? xa - t : xb, bx1 = dir > 0 ? xa : xb + t;
  objs.push(box(bx0, y - h / 2 - t, bx1, y + h / 2 + t));
  const fx0 = dir > 0 ? xa : xb - 2, fx1 = dir > 0 ? xa + 2 : xb;
  return { objs, forced: { x0: fx0, x1: fx1, y0: y - h / 2, y1: y + h / 2, u: [dir * U_LAT, 0] } };
}
const stripesX = (nx, every, width) => (i) => ((i % every) < width ? [0, 0, 1, 0] : null);

export const SCENES = [
  { id: 'cylinder', group: 'Bodies in a stream', label: 'Cylinder', aspect: 3, Re: 150, sym: 'D', length: 'cylinder diameter D',
    blurb: 'Uniform flow past a circular cylinder. Raise the Reynolds number to watch the wake go from attached flow, to a steady pair of eddies, to the alternating Kármán vortex street.',
    build: body('circle') },
  { id: 'square', group: 'Bodies in a stream', label: 'Square', aspect: 3, Re: 150, sym: 'D', length: 'side D',
    blurb: 'A square cylinder. The flow has to separate at the sharp front corners, whatever the Reynolds number, so the wake is wider and sheds more slowly than behind a circle.',
    build: body('square') },
  { id: 'plate', group: 'Bodies in a stream', label: 'Flat plate (across the flow)', aspect: 3, Re: 150, sym: 'D', length: 'plate length D',
    blurb: 'A thin plate square-on to the flow, the bluntest body there is: very wide wake, big vortices, high drag. Select it with Move and change its angle to turn it into a wing.',
    build: body('plate') },
  { id: 'triangle', group: 'Bodies in a stream', label: 'Triangle', aspect: 3, Re: 150, sym: 'D', length: 'side D',
    blurb: 'An equilateral triangle pointing into the flow. The flow stays attached along the slanted faces and separates at the back corners. Rotate it 180° (select it with Move) to face the flat side upstream.',
    build: body('triangle') },
  { id: 'airfoil', group: 'Bodies in a stream', label: 'Airfoil', aspect: 3, Re: 1000, sym: 'c', length: 'chord c',
    blurb: 'A NACA 2412 wing section. Change the angle of attack in "Selected obstacle" and watch the flow over the upper surface separate and the wing stall. Reynolds numbers here are thousands of times lower than a real aircraft\'s.',
    build: (nx, ny) => {
      const c = Math.round(ny / 3), x = Math.round(nx * 0.25), y = ny / 2;
      return { ...external, objects: [ob('airfoil', x, y, c, { ref: true, naca: '2412', angle: 8 })], L: c, probe: [Math.round(x + 1.5 * c), Math.floor(y)] };
    } },
  { id: 'tandem', group: 'Bodies in a stream', label: 'Two cylinders in tandem', aspect: 3.5, Re: 150, sym: 'D', length: 'cylinder diameter D',
    blurb: 'Two cylinders one behind the other, 4 D apart. The downstream one sits in the first one\'s wake and is buffeted by its vortices. Drag them closer together (Move tool) and the gap fills with trapped, slow fluid.',
    build: (nx, ny) => {
      const D = Math.round(ny / 9), cx = Math.round(nx / 6), cy = ny / 2;
      return { ...external, objects: [ob('circle', cx, cy, D, { ref: true }), ob('circle', cx + 4 * D, cy, D)], L: D, init: kick(cx, cy, D), probe: [cx + 6 * D, Math.floor(cy)] };
    } },

  { id: 'channel', group: 'Internal flows', label: 'Channel (Poiseuille) flow', aspect: 4, Re: 100, sym: 'H', length: 'channel height H (with the centreline speed)',
    blurb: 'Fluid at rest between two walls is pushed along by a steady pressure gradient. The dye lines bend into the parabolic Poiseuille profile as viscosity spreads the motion in from the walls. The ends are joined (periodic), so whatever leaves on the right comes back on the left. Draw an obstacle in it.',
    build: (nx, ny) => ({
      objects: [], L: ny, bc: { x: 'periodic', y: 'wall' }, inflow: 0, force: nu => [8 * nu * U_LAT / (ny * ny), 0],
      init: () => [1, 0, 0], dyeInit: stripesX(nx, Math.round(nx / 6), Math.max(3, Math.round(nx / 90))), dye: { streaks: false, body: true, decay: 1 }, probe: [Math.round(nx / 2), Math.floor(ny / 2)],
    }) },
  { id: 'step', group: 'Internal flows', label: 'Backward-facing step', aspect: 5, Re: 300, sym: 'h', length: 'step height h',
    blurb: 'Flow in a channel suddenly widens over a step. It cannot turn the corner, so it separates, and a long recirculating bubble forms behind the step before the flow reattaches to the lower wall. The bubble grows with Re.',
    build: (nx, ny) => {
      const h = Math.round(ny / 2), xs = Math.round(nx * 0.1);
      return { objects: [box(0, 0, xs, h)], L: h, bc: { x: 'flow', y: 'wall' }, init: (i, j) => (j >= h ? null : [1, 0, 0]), dye: { streaks: true, body: true }, probe: [xs + 3 * h, Math.floor(h / 2)] };
    } },
  { id: 'cavity', group: 'Internal flows', label: 'Lid-driven cavity', aspect: 1, Re: 400, sym: 'L', length: 'cavity size L (with the lid speed)',
    blurb: 'A square box of fluid whose lid slides to the right. The lid drags the fluid round into one big vortex, with small counter-rotating eddies in the bottom corners. A classic test case for flow solvers.',
    build: (nx, ny) => ({
      objects: [], L: nx, bc: { x: 'wall', y: 'wall' }, lid: [0, U_LAT], inflow: 0, init: () => [1, 0, 0],
      dyeInit: (i, j) => (Math.floor(j / Math.max(3, Math.round(ny / 16))) % 2 ? [0, 0, 1, 0] : null), dye: { streaks: false, body: false, decay: 1 }, probe: [Math.round(nx / 2), Math.round(ny / 2)],
    }) },

  { id: 'jet', group: 'Jets', label: 'Jet into still fluid', aspect: 3, Re: 300, sym: 'h', length: 'nozzle width h',
    blurb: 'A jet blows into fluid at rest. The fast and still fluid shear against each other, and the shear layers roll up into vortices (the Kelvin–Helmholtz instability) that mix the jet with its surroundings, so it spreads and slows down.',
    build: (nx, ny) => {
      const h = Math.round(ny / 10), y = ny / 2, nz = nozzle(Math.round(nx * 0.08), y, h, Math.round(nx * 0.06), 1);
      return { objects: nz.objs, forced: [nz.forced], L: h, inflow: 0, bc: { x: 'flow', y: 'slip' }, init: () => [1, 0, 0], dye: { streaks: false, body: false }, wobble: { amp: 0.04, period: 4 * h / U_LAT }, probe: [Math.round(nx * 0.4), Math.floor(y)] };
    } },
  { id: 'jets2', group: 'Jets', label: 'Two colliding jets', aspect: 3, Re: 200, sym: 'h', length: 'nozzle width h',
    blurb: 'Two equal jets meet head-on. Between them is a stagnation point, where the flow stops and the pressure peaks, and the fluid escapes sideways. Above a modest Re the collision flaps from side to side.',
    build: (nx, ny) => {
      const h = Math.round(ny / 10), y = ny / 2;
      const a = nozzle(Math.round(nx * 0.33), y, h, Math.round(nx * 0.06), 1), b = nozzle(Math.round(nx * 0.67), y, h, Math.round(nx * 0.06), -1);
      return { objects: [...a.objs, ...b.objs], forced: [a.forced, b.forced], L: h, inflow: 0, bc: { x: 'flow', y: 'slip' }, init: () => [1, 0, 0], dye: { streaks: false, body: false }, wobble: { amp: 0.02, period: 9 * h / U_LAT }, probe: [Math.round(nx / 2), Math.floor(y)] };
    } },

  { id: 'empty', group: 'Your own', label: 'Empty wind tunnel', aspect: 3, Re: 200, sym: 'D', length: 'size of the first shape you add',
    blurb: 'Uniform flow and nothing in it. Pick a shape and click to place it, paint obstacles with the brush, stir the fluid, or click with the Dye tool to release ink.',
    build: (nx, ny) => ({ ...external, objects: [], L: Math.round(ny / 9), probe: [Math.round(nx / 2), Math.floor(ny / 2)] }) },
];

// Grid sizes by total cell count; the shape follows the scene's aspect ratio
export const GRIDS = [
  { id: 'coarse', label: 'Coarse', cells: 43200 },
  { id: 'medium', label: 'Medium', cells: 97200 },
  { id: 'fine', label: 'Fine', cells: 202800 },
  { id: 'vfine', label: 'Very fine', cells: 388800 },
];
export function gridSize(grid, aspect) {
  const ny = Math.round(Math.sqrt(grid.cells / aspect));
  return { nx: Math.round(ny * aspect), ny };
}

// Every scene with slip walls gets absorbing layers
for (const s of SCENES) {
  const build = s.build;
  s.build = (nx, ny) => { const b = build(nx, ny); if (b.bc && b.bc.y === 'slip' && !b.sponge) b.sponge = sponge(nx, ny); return b; };
}
