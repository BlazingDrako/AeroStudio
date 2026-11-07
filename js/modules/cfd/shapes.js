// Obstacle shapes and the sandbox geometry (which cells are solid, forced or fluid). No DOM.
// Coordinates are in grid cells with y up; cell (i, j) has its centre at (i + ½, j + ½).
//
// An obstacle is { type, x, y, size, angle, naca?, w?, h?, locked?, ref? }:
//   circle    diameter = size
//   square    side = size
//   plate     flat plate, length = size, thickness ≈ 8% of that (≥ 2 cells); vertical (across the flow) at angle 0
//   triangle  equilateral, side = size, a corner pointing upstream at angle 0
//   airfoil   NACA 4-digit section, chord = size, (x, y) is the quarter chord, angle = angle of attack (nose up)
//   box       w × h rectangle (scene walls such as the step and nozzles)
// angle is in degrees, counter-clockwise (except the airfoil's angle of attack, which turns the nose up).

export const SHAPES = [
  { type: 'circle', label: 'Circle' },
  { type: 'square', label: 'Square' },
  { type: 'plate', label: 'Plate' },
  { type: 'triangle', label: 'Triangle' },
  { type: 'airfoil', label: 'Airfoil' },
];
export const shapeLabel = t => (SHAPES.find(s => s.type === t) || { label: t === 'box' ? 'Block' : t }).label;

// NACA 4-digit section, unit chord, closed trailing edge; points run from the trailing edge over the
// upper surface to the leading edge and back along the lower surface.
export function nacaPoints(code = '0012', n = 48) {
  const s = String(code).padStart(4, '0');
  const m = +s[0] / 100, p = +s[1] / 10, t = +s.slice(2, 4) / 100;
  const up = [], lo = [];
  for (let i = 0; i <= n; i++) {
    const x = 0.5 * (1 - Math.cos(Math.PI * i / n));
    const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    let yc = 0, dy = 0;
    if (m > 0 && p > 0) {
      if (x < p) { yc = m / (p * p) * (2 * p * x - x * x); dy = 2 * m / (p * p) * (p - x); }
      else { yc = m / ((1 - p) ** 2) * (1 - 2 * p + 2 * p * x - x * x); dy = 2 * m / ((1 - p) ** 2) * (p - x); }
    }
    const th = Math.atan(dy);
    up.push([x - yt * Math.sin(th), yc + yt * Math.cos(th)]);
    lo.push([x + yt * Math.sin(th), yc - yt * Math.cos(th)]);
  }
  return [...up.reverse(), ...lo.slice(1, -1)];
}
export const validNaca = s => /^\d{4}$/.test(String(s)) && +String(s).slice(2) >= 1;

// Outline polygon in cells (null for circles)
export function outline(o) {
  const s = o.size;
  let pts;
  if (o.type === 'circle') return null;
  if (o.type === 'square') pts = [[-s / 2, -s / 2], [s / 2, -s / 2], [s / 2, s / 2], [-s / 2, s / 2]];
  else if (o.type === 'plate') { const t = Math.max(2, 0.08 * s) / 2; pts = [[-t, -s / 2], [t, -s / 2], [t, s / 2], [-t, s / 2]]; }
  else if (o.type === 'triangle') { const hh = s * Math.sqrt(3) / 2; pts = [[-2 * hh / 3, 0], [hh / 3, -s / 2], [hh / 3, s / 2]]; }
  else if (o.type === 'airfoil') pts = nacaPoints(o.naca || '0012').map(([x, y]) => [(x - 0.25) * s, y * s]);
  else if (o.type === 'box') pts = [[-o.w / 2, -o.h / 2], [o.w / 2, -o.h / 2], [o.w / 2, o.h / 2], [-o.w / 2, o.h / 2]];
  else return [];
  const a = (o.type === 'airfoil' ? -1 : 1) * (o.angle || 0) * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
  return pts.map(([x, y]) => [o.x + x * c - y * sn, o.y + x * sn + y * c]);
}

export function bbox(o) {
  if (o.type === 'circle') return [o.x - o.size / 2, o.y - o.size / 2, o.x + o.size / 2, o.y + o.size / 2];
  const P = outline(o);
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, y] of P) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
  return [a, b, c, d];
}

function pip(x, y, P) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i], [xj, yj] = P[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
export function contains(o, x, y) {
  if (o.type === 'circle') return (x - o.x) ** 2 + (y - o.y) ** 2 <= (o.size / 2) ** 2;
  const [a, b, c, d] = bbox(o);
  return x >= a && x <= c && y >= b && y <= d && pip(x, y, outline(o));
}

// Indices of the grid cells whose centres lie inside the obstacle
export function rasterize(o, nx, ny) {
  const [a, b, c, d] = bbox(o), out = [];
  const P = o.type === 'circle' ? null : outline(o), r2 = (o.size / 2) ** 2;
  for (let j = Math.max(0, Math.floor(b)); j <= Math.min(ny - 1, Math.ceil(d)); j++)
    for (let i = Math.max(0, Math.floor(a)); i <= Math.min(nx - 1, Math.ceil(c)); i++) {
      const x = i + 0.5, y = j + 0.5;
      if (P ? pip(x, y, P) : (x - o.x) ** 2 + (y - o.y) ** 2 <= r2) out.push(j * nx + i);
    }
  return out;
}

// The sandbox geometry: obstacles (which can move), painted solid cells and forced (jet) cells, combined
// into `cells` (0 fluid, 1 solid, 2 forced) and `vel` (cell velocity) for the solver.
export class Geometry {
  constructor(nx, ny) {
    const n = nx * ny;
    Object.assign(this, { nx, ny, objects: [], nextId: 1 });
    this.paint = new Uint8Array(n); this.cover = new Uint16Array(n);
    this.forced = new Uint8Array(n); this.forcedVel = new Float32Array(2 * n); this.objVel = new Float32Array(2 * n);
    this.cells = new Uint8Array(n); this.vel = new Float32Array(2 * n);
    this.dirty = null;
  }
  mark(x0, y0, x1, y1) {
    const d = this.dirty;
    this.dirty = d ? [Math.min(d[0], x0), Math.min(d[1], y0), Math.max(d[2], x1), Math.max(d[3], y1)] : [x0, y0, x1, y1];
  }
  markObj(o) { const [a, b, c, d] = bbox(o); this.mark(a - 1, b - 1, c + 1, d + 1); }
  place(o) { o.cells = rasterize(o, this.nx, this.ny); for (const k of o.cells) this.cover[k]++; this.markObj(o); }
  lift(o) { for (const k of o.cells || []) { this.cover[k]--; this.objVel[2 * k] = 0; this.objVel[2 * k + 1] = 0; } this.markObj(o); }
  add(o) { o.id = this.nextId++; o.angle = o.angle || 0; this.objects.push(o); this.place(o); return o; }
  remove(o) { const i = this.objects.indexOf(o); if (i < 0) return; this.objects.splice(i, 1); this.lift(o); }
  // change an obstacle's position/size/angle; v = its velocity (cells per step) while it is being dragged
  update(o, props = {}, v = [0, 0]) {
    this.lift(o); Object.assign(o, props); this.place(o);
    o.v = v;
    for (const k of o.cells) { this.objVel[2 * k] = v[0]; this.objVel[2 * k + 1] = v[1]; }
  }
  setVelocity(o, v) {
    o.v = v;
    for (const k of o.cells) { this.objVel[2 * k] = v[0]; this.objVel[2 * k + 1] = v[1]; }
    this.markObj(o);
  }
  // paint (val = 1) or erase (0) a disc of radius r
  paintDisc(x, y, r, val) {
    const { nx, ny } = this;
    for (let j = Math.max(0, Math.floor(y - r)); j <= Math.min(ny - 1, Math.ceil(y + r)); j++)
      for (let i = Math.max(0, Math.floor(x - r)); i <= Math.min(nx - 1, Math.ceil(x + r)); i++)
        if ((i + 0.5 - x) ** 2 + (j + 0.5 - y) ** 2 <= r * r) this.paint[j * nx + i] = val;
    this.mark(x - r - 1, y - r - 1, x + r + 1, y + r + 1);
  }
  paintLine(x0, y0, x1, y1, r, val) {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / Math.max(0.5, r * 0.5)));
    for (let s = 0; s <= n; s++) this.paintDisc(x0 + (x1 - x0) * s / n, y0 + (y1 - y0) * s / n, r, val);
  }
  // forced regions: [{ x0, x1, y0, y1, u: [ux, uy] }] in cells
  setForced(regions = []) {
    const { nx, ny } = this;
    this.forced.fill(0); this.forcedVel.fill(0);
    for (const R of regions)
      for (let j = Math.max(0, Math.floor(R.y0)); j < Math.min(ny, Math.ceil(R.y1)); j++)
        for (let i = Math.max(0, Math.floor(R.x0)); i < Math.min(nx, Math.ceil(R.x1)); i++) {
          const k = j * nx + i; this.forced[k] = 1; this.forcedVel[2 * k] = R.u[0]; this.forcedVel[2 * k + 1] = R.u[1];
        }
    this.mark(0, 0, nx, ny);
  }
  clearDrawn() { this.paint.fill(0); for (const o of [...this.objects]) if (!o.locked) this.remove(o); this.mark(0, 0, this.nx, this.ny); }
  // Rebuild cells/vel in the dirty region; returns that region (or null)
  compose(all = false) {
    const { nx, ny } = this;
    const d = all ? [0, 0, nx, ny] : this.dirty; this.dirty = null;
    if (!d) return null;
    const x0 = Math.max(0, Math.floor(d[0])), y0 = Math.max(0, Math.floor(d[1])), x1 = Math.min(nx, Math.ceil(d[2]) + 1), y1 = Math.min(ny, Math.ceil(d[3]) + 1);
    for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) {
      const k = j * nx + i;
      if (this.paint[k] || this.cover[k]) { this.cells[k] = 1; this.vel[2 * k] = this.objVel[2 * k]; this.vel[2 * k + 1] = this.objVel[2 * k + 1]; }
      else if (this.forced[k]) { this.cells[k] = 2; this.vel[2 * k] = this.forcedVel[2 * k]; this.vel[2 * k + 1] = this.forcedVel[2 * k + 1]; }
      else { this.cells[k] = 0; this.vel[2 * k] = 0; this.vel[2 * k + 1] = 0; }
    }
    return [x0, y0, x1, y1];
  }
  topObjectAt(x, y) { for (let i = this.objects.length - 1; i >= 0; i--) if (contains(this.objects[i], x, y)) return this.objects[i]; return null; }
  // Copy to a new grid size, scaling obstacles and the painted cells; forced regions are set again by the caller
  resampled(nx, ny) {
    const g = new Geometry(nx, ny), f = ny / this.ny;
    for (const o of this.objects) {
      const c = { ...o, x: o.x * f, y: o.y * f, size: o.size * f, v: [0, 0] };
      if (o.w) { c.w = o.w * f; c.h = o.h * f; }
      delete c.cells; delete c.id; g.add(c);
    }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const si = Math.min(this.nx - 1, Math.floor((i + 0.5) / f)), sj = Math.min(this.ny - 1, Math.floor((j + 0.5) / f));
      g.paint[j * nx + i] = this.paint[sj * this.nx + si];
    }
    return g;
  }
}
