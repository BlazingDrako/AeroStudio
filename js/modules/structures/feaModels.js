// Parametric plate geometries for 2-D FEA, each with default boundary conditions, a probe line
// and a hand-calculation reference to compare against. All SI. No DOM (used by tests too).

const L = (id, p0, p1, label) => ({ id, kind: 'line', p0, p1, label });
const A = (id, c, r, a0, a1, label) => ({ id, kind: 'arc', c, r, a0, a1, label });
const PI = Math.PI;

// Heywood's fit for a central hole in a finite-width strip (net-section Kt)
export const ktHole = (d, W) => 2 + (1 - d / W) ** 3;

export const FEA_MODELS = [
  {
    id: 'hole', label: 'Plate with a hole (tension)',
    params: [['L', 'Length', 'dim', 0.3], ['W', 'Width', 'dim', 0.1], ['d', 'Hole diameter', 'dim', 0.025], ['s', 'Applied stress σ₀', 'stress', 100e6]],
    check: p => p.d < 0.9 * p.W && p.d < 0.9 * p.L,
    build(p, t) {
      const { L: Lx, W, d } = p, r = d / 2, cx = Lx / 2, cy = W / 2, P = p.s * W * t;
      return {
        geom: { loops: [
          { curves: [L('bottom', [0, 0], [Lx, 0], 'Bottom edge'), L('right', [Lx, 0], [Lx, W], 'Right end'), L('top', [Lx, W], [0, W], 'Top edge'), L('left', [0, W], [0, 0], 'Left end')] },
          { hole: true, curves: [A('hole', [cx, cy], r, 0, 2 * PI, 'Hole')] }] },
        bcs: { left: { type: 'force', fx: -P, fy: 0 }, right: { type: 'force', fx: P, fy: 0 } },
        probe: { p0: [cx, cy + r], p1: [cx, W], label: 'net section above the hole', field: 'sx' },
        ref: { nominal: P / ((W - d) * t), nomLabel: 'σ_net = P/((W−d)t)', kt: ktHole(d, W), ktLabel: 'Heywood: Kt = 2 + (1 − d/W)³', field: 'sx' },
        refine: [],
      };
    },
  },
  {
    id: 'notch', label: 'Bar with two U-notches (tension)',
    params: [['L', 'Length', 'dim', 0.3], ['W', 'Width', 'dim', 0.1], ['r', 'Notch radius', 'dim', 0.01], ['s', 'Applied stress σ₀', 'stress', 100e6]],
    check: p => 2 * p.r < 0.8 * p.W && 2 * p.r < 0.8 * p.L,
    build(p, t) {
      const { L: Lx, W, r } = p, cx = Lx / 2, P = p.s * W * t;
      return {
        geom: { loops: [{ curves: [
          L('bottom1', [0, 0], [cx - r, 0], 'Bottom edge'), A('notchB', [cx, 0], r, PI, 0, 'Bottom notch'), L('bottom2', [cx + r, 0], [Lx, 0], 'Bottom edge'),
          L('right', [Lx, 0], [Lx, W], 'Right end'),
          L('top2', [Lx, W], [cx + r, W], 'Top edge'), A('notchT', [cx, W], r, 0, -PI, 'Top notch'), L('top1', [cx - r, W], [0, W], 'Top edge'),
          L('left', [0, W], [0, 0], 'Left end')] }] },
        bcs: { left: { type: 'force', fx: -P, fy: 0 }, right: { type: 'force', fx: P, fy: 0 } },
        probe: { p0: [cx, r], p1: [cx, W - r], label: 'across the notch roots', field: 'sx' },
        ref: { nominal: P / ((W - 2 * r) * t), nomLabel: 'σ_net = P/((W−2r)t)', field: 'sx' },
      };
    },
  },
  {
    id: 'fillet', label: 'Stepped bar with shoulder fillets',
    params: [['L', 'Length', 'dim', 0.3], ['D', 'Wide width D', 'dim', 0.12], ['d', 'Narrow width d', 'dim', 0.08], ['r', 'Fillet radius', 'dim', 0.008], ['s', 'Stress in narrow part', 'stress', 100e6]],
    check: p => p.d < p.D && p.r < 0.45 * p.L && p.r <= (p.D - p.d) / 2 * 4,
    build(p, t) {
      const { L: Lx, D, d, r } = p, h = (D - d) / 2, xs = Lx / 2, P = p.s * d * t;
      // step at x = xs: wide part on the left (0..xs), narrow on the right
      const rr = Math.min(r, h * 0.999 + 1e-12);
      const curves = [
        L('bottomW', [0, 0], [xs, 0], 'Bottom (wide)'),
      ];
      // bottom step: from (xs,0) up to (xs, h - rr), fillet to (xs + rr, h), then narrow bottom
      if (h - rr > 1e-9) curves.push(L('stepB', [xs, 0], [xs, h - rr], 'Shoulder'));
      curves.push(A('filletB', [xs + rr, h - rr], rr, PI, PI / 2, 'Lower fillet'), L('bottomN', [xs + rr, h], [Lx, h], 'Bottom (narrow)'),
        L('right', [Lx, h], [Lx, h + d], 'Right end'), L('topN', [Lx, h + d], [xs + rr, h + d], 'Top (narrow)'),
        A('filletT', [xs + rr, h + d + rr], rr, -PI / 2, -PI, 'Upper fillet'));
      if (h - rr > 1e-9) curves.push(L('stepT', [xs, h + d + rr], [xs, D], 'Shoulder'));
      curves.push(L('topW', [xs, D], [0, D], 'Top (wide)'), L('left', [0, D], [0, 0], 'Left end'));
      return {
        geom: { loops: [{ curves }] },
        bcs: { left: { type: 'force', fx: -P, fy: 0 }, right: { type: 'force', fx: P, fy: 0 } },
        probe: { p0: [xs + rr, h], p1: [xs + rr, h + d / 2], label: 'from the fillet toe into the narrow part', field: 'sx' },
        ref: { nominal: P / (d * t), nomLabel: 'σ_nom = P/(d·t)', field: 'sx' },
      };
    },
  },
  {
    id: 'lug', label: 'Pin-loaded lug (attachment fitting)',
    params: [['W', 'Lug width', 'dim', 0.06], ['H', 'Base to hole centre', 'dim', 0.07], ['d', 'Hole diameter', 'dim', 0.025], ['F', 'Pin load', 'force', 40e3], ['ang', 'Load angle', null, 90]],
    check: p => p.d < 0.85 * p.W && p.H > p.W * 0.3,
    build(p, t) {
      const { W, H, d } = p, R = W / 2, cx = R;
      return {
        geom: { loops: [
          { curves: [L('base', [0, 0], [W, 0], 'Base'), L('sideR', [W, 0], [W, H], 'Right side'), A('head', [cx, H], R, 0, PI, 'Head'), L('sideL', [0, H], [0, 0], 'Left side')] },
          { hole: true, curves: [A('hole', [cx, H], d / 2, 0, 2 * PI, 'Pin hole')] }] },
        bcs: { base: { type: 'fixed' }, hole: { type: 'bearing', F: p.F, angle: p.ang } },
        probe: { p0: [cx + d / 2, H], p1: [W, H], label: 'net section beside the hole', field: 'sy' },
        ref: { nominal: p.F / ((W - d) * t), nomLabel: 'net tension F/((W−d)t)', extra: { label: 'Bearing stress F/(d·t)', value: p.F / (d * t) }, field: 'sy' },
      };
    },
  },
  {
    id: 'bracket', label: 'L-bracket with corner fillet',
    params: [['a', 'Leg length', 'dim', 0.15], ['b', 'Arm length', 'dim', 0.15], ['w', 'Section depth', 'dim', 0.03], ['r', 'Inner fillet radius', 'dim', 0.008], ['F', 'Tip load (down)', 'force', 2e3]],
    check: p => p.w < 0.6 * Math.min(p.a, p.b) && p.r < 0.8 * Math.min(p.a, p.b) - p.w,
    build(p, t) {
      const { a, b, w, r } = p;
      // vertical leg x∈[0,w], y∈[0,a]; horizontal arm at the top y∈[a-w, a], x∈[0,b]
      const curves = [L('foot', [0, 0], [w, 0], 'Foot'), L('legIn', [w, 0], [w, a - w - r], 'Leg (inside)')];
      if (r > 1e-9) curves.push(A('fillet', [w + r, a - w - r], r, PI, PI / 2, 'Corner fillet'));
      curves.push(L('armIn', [w + r, a - w], [b, a - w], 'Arm (underside)'), L('tip', [b, a - w], [b, a], 'Arm tip'), L('armTop', [b, a], [0, a], 'Arm top'), L('legOut', [0, a], [0, 0], 'Leg (outside)'));
      const M = p.F * (b - w / 2);
      return {
        geom: { loops: [{ curves }] },
        bcs: { foot: { type: 'fixed' }, tip: { type: 'force', fx: 0, fy: -p.F } },
        probe: { p0: [0, a - w - r - w], p1: [w, a - w - r - w], label: 'across the leg below the corner', field: 'sy' },
        ref: { nominal: 6 * M / (t * w * w), nomLabel: 'bending Mc/I = 6M/(t·w²) in the leg', field: 'vm' },
      };
    },
  },
  {
    id: 'beam', label: 'Deep cantilever vs beam theory',
    params: [['L', 'Length', 'dim', 0.4], ['h', 'Depth', 'dim', 0.08], ['P', 'Tip load (down)', 'force', 5e3]],
    check: p => p.h < p.L,
    build(p, t) {
      const { L: Lx, h } = p;
      return {
        geom: { loops: [{ curves: [L('bottom', [0, 0], [Lx, 0], 'Bottom'), L('tip', [Lx, 0], [Lx, h], 'Free end'), L('top', [Lx, h], [0, h], 'Top'), L('root', [0, h], [0, 0], 'Root')] }] },
        bcs: { root: { type: 'fixed' }, tip: { type: 'force', fx: 0, fy: -p.P } },
        probe: { p0: [Lx / 2, 0], p1: [Lx / 2, h], label: 'through the depth at mid-span', field: 'sx' },
        ref: { nominal: 6 * p.P * Lx / (t * h * h), nomLabel: 'root bending stress 6PL/(t·h²)', field: 'sx', beam: { P: p.P, L: Lx, h } },
      };
    },
  },
];

// Custom geometry: polygon outline + circular holes drawn by the user.
export function customModel(c, t) {
  const pts = c.outline, n = pts.length, curves = [];
  // counter-clockwise outline
  let area = 0; for (let i = 0; i < n; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % n]; area += x0 * y1 - x1 * y0; }
  const P = area < 0 ? [...pts].reverse() : pts;
  for (let i = 0; i < n; i++) curves.push(L('e' + (i + 1), P[i], P[(i + 1) % n], `Edge ${i + 1}`));
  const loops = [{ curves }, ...c.holes.map((h, k) => ({ hole: true, curves: [A('h' + (k + 1), [h.x, h.y], h.r, 0, 2 * PI, `Hole ${k + 1}`)] }))];
  void t;
  return { geom: { loops }, bcs: c.bcs || {}, probe: c.probe || null, ref: null };
}
export const defaultCustom = () => ({
  outline: [[0, 0], [0.2, 0], [0.2, 0.06], [0.12, 0.1], [0, 0.1]], holes: [{ x: 0.07, y: 0.05, r: 0.015 }],
  bcs: { e5: { type: 'fixed' }, e2: { type: 'force', fx: 0, fy: -5e3 } },
});
