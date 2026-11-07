// Packing a sandbox setup (obstacles, painted walls, probes, line, dye sources, options) into a short URL-safe
// string, and back. Positions are stored as fractions of the grid height so a link works at any grid size. No DOM.

const TYPES = ['circle', 'square', 'plate', 'triangle', 'airfoil', 'box'];
const r4 = v => Math.round(v * 1e4) / 1e4;

const b64 = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

// Run lengths of a 0/1 array, starting with a run of zeros, in base 36
function rle(a) {
  const out = []; let v = 0, n = 0;
  for (let k = 0; k < a.length; k++) { if (a[k] === v) n++; else { out.push(n.toString(36)); v = a[k]; n = 1; } }
  out.push(n.toString(36));
  return out.join('.');
}
function unrle(s, n) {
  const a = new Uint8Array(n); let k = 0, v = 0;
  for (const part of s.split('.')) { const len = parseInt(part, 36) || 0; if (v) a.fill(1, k, Math.min(n, k + len)); k += len; v = 1 - v; }
  return a;
}

// setup: { nx, ny, objects, paint (Uint8Array), probes [[x,y]], line {x0,y0,x1,y1} | null, sources [[x,y]], turb }
export function encodeSetup({ nx, ny, objects, paint, probes = [], line = null, sources = [], turb = true }) {
  const f = v => r4(v / ny);
  const d = { v: 1 };
  d.o = objects.map(o => { const e = [TYPES.indexOf(o.type), f(o.x), f(o.y), f(o.size), Math.round((o.angle || 0) * 10) / 10]; if (o.type === 'airfoil') e.push(o.naca || '0012'); if (o.type === 'box') e.push(f(o.w), f(o.h)); if (o.ref) e.push('r'); return e; });
  if (paint && paint.some(v => v)) d.w = [nx, ny, rle(paint)];
  if (probes.length) d.p = probes.map(([x, y]) => [f(x), f(y)]);
  if (line) d.l = [f(line.x0), f(line.y0), f(line.x1), f(line.y1)];
  if (sources.length) d.d = sources.map(([x, y]) => [f(x), f(y)]);
  if (!turb) d.t = 0;
  return b64(JSON.stringify(d));
}

// → { objects, paint (at the given grid size) | null, probes, line, sources, turb } or null if the string is not valid
export function decodeSetup(str, nx, ny) {
  let d; try { d = JSON.parse(unb64(str)); } catch { return null; }
  if (!d || d.v !== 1) return null;
  const f = v => +v * ny;
  const objects = (d.o || []).map(e => {
    const type = TYPES[e[0]]; if (!type) return null;
    const o = { type, x: f(e[1]), y: f(e[2]), size: f(e[3]), angle: +e[4] || 0 };
    let k = 5;
    if (type === 'airfoil') o.naca = String(e[k++] || '0012');
    if (type === 'box') { o.w = f(e[k++]); o.h = f(e[k++]); }
    if (e[k] === 'r') o.ref = true;
    return isFinite(o.x) && isFinite(o.y) && o.size > 0 ? o : null;
  }).filter(Boolean);
  let paint = null;
  if (d.w) {
    const [pnx, pny, s] = d.w, src = unrle(s, pnx * pny);
    paint = new Uint8Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const si = Math.min(pnx - 1, Math.floor((i + 0.5) * pnx / nx)), sj = Math.min(pny - 1, Math.floor((j + 0.5) * pny / ny));
      paint[j * nx + i] = src[sj * pnx + si];
    }
  }
  const pts = a => (a || []).map(([x, y]) => [f(x), f(y)]).filter(([x, y]) => isFinite(x) && isFinite(y));
  return {
    objects, paint, probes: pts(d.p), sources: pts(d.d),
    line: d.l ? { x0: f(d.l[0]), y0: f(d.l[1]), x1: f(d.l[2]), y1: f(d.l[3]) } : null,
    turb: d.t !== 0,
  };
}
