// Cross-section properties and a material library. All SI (m, Pa, kg/m³).
// A section is built from parts (rectangles and circles, holes with sign -1). Properties about the
// horizontal centroidal axis come from integrating the width b(y) exactly between part edges
// (Gauss-Legendre), which also gives Q(y), the plastic modulus and the shear-stress profile.

export const MATERIALS = [
  { id: 'steel', name: 'Structural steel (A36 / S275)', E: 200e9, nu: 0.3, rho: 7850, fy: 250e6, fu: 400e6, alpha: 12e-6 },
  { id: 'steel50', name: 'High-strength steel (A992 / S355)', E: 200e9, nu: 0.3, rho: 7850, fy: 345e6, fu: 450e6, alpha: 12e-6 },
  { id: 'ss304', name: 'Stainless steel 304', E: 193e9, nu: 0.29, rho: 8000, fy: 215e6, fu: 505e6, alpha: 17.3e-6 },
  { id: '4130', name: 'Steel 4130 (normalized)', E: 205e9, nu: 0.29, rho: 7850, fy: 435e6, fu: 670e6, alpha: 12.2e-6 },
  { id: 'al6061', name: 'Aluminum 6061-T6', E: 68.9e9, nu: 0.33, rho: 2700, fy: 276e6, fu: 310e6, alpha: 23.6e-6 },
  { id: 'al2024', name: 'Aluminum 2024-T3', E: 73.1e9, nu: 0.33, rho: 2780, fy: 345e6, fu: 483e6, alpha: 23.2e-6 },
  { id: 'al7075', name: 'Aluminum 7075-T6', E: 71.7e9, nu: 0.33, rho: 2810, fy: 503e6, fu: 572e6, alpha: 23.6e-6 },
  { id: 'ti64', name: 'Titanium Ti-6Al-4V', E: 113.8e9, nu: 0.342, rho: 4430, fy: 880e6, fu: 950e6, alpha: 8.6e-6 },
  { id: 'cfrp', name: 'CFRP, quasi-isotropic laminate', E: 50e9, nu: 0.3, rho: 1600, fy: 450e6, fu: 450e6, alpha: 2e-6 },
  { id: 'gfrp', name: 'GFRP, quasi-isotropic laminate', E: 20e9, nu: 0.3, rho: 1900, fy: 200e6, fu: 200e6, alpha: 12e-6 },
  { id: 'wood', name: 'Softwood (Douglas fir, along grain)', E: 12.4e9, nu: 0.3, rho: 530, fy: 40e6, fu: 50e6, alpha: 4e-6 },
  { id: 'concrete', name: 'Concrete (C30, compression)', E: 30e9, nu: 0.2, rho: 2400, fy: 30e6, fu: 30e6, alpha: 10e-6 },
];

// Shape definitions: dims in metres. `fields` lists [key, label] for the editor.
export const SHAPES = {
  rect: { label: 'Solid rectangle', fields: [['b', 'Width b'], ['h', 'Depth h']], def: { b: 0.05, h: 0.1 } },
  circle: { label: 'Solid round', fields: [['d', 'Diameter d']], def: { d: 0.05 } },
  tube: { label: 'Round tube', fields: [['d', 'Outer diameter D'], ['t', 'Wall t']], def: { d: 0.06, t: 0.004 } },
  box: { label: 'Rectangular tube (box)', fields: [['b', 'Width b'], ['h', 'Depth h'], ['t', 'Wall t']], def: { b: 0.1, h: 0.15, t: 0.006 } },
  ibeam: { label: 'I-beam / wide flange', fields: [['b', 'Flange width b'], ['h', 'Depth h'], ['tf', 'Flange tf'], ['tw', 'Web tw']], def: { b: 0.15, h: 0.3, tf: 0.0107, tw: 0.0071 } },
  channel: { label: 'Channel (C)', fields: [['b', 'Flange width b'], ['h', 'Depth h'], ['tf', 'Flange tf'], ['tw', 'Web tw']], def: { b: 0.075, h: 0.2, tf: 0.0115, tw: 0.0085 } },
  tee: { label: 'Tee', fields: [['b', 'Flange width b'], ['h', 'Depth h'], ['tf', 'Flange tf'], ['tw', 'Stem tw']], def: { b: 0.1, h: 0.1, tf: 0.01, tw: 0.008 } },
  angle: { label: 'Angle (L)', fields: [['b', 'Leg width b'], ['h', 'Leg height h'], ['t', 'Thickness t']], def: { b: 0.075, h: 0.075, t: 0.008 } },
  zsec: { label: 'Z-section', fields: [['b', 'Flange width b'], ['h', 'Depth h'], ['t', 'Thickness t']], def: { b: 0.06, h: 0.15, t: 0.004 } },
  hat: { label: 'Hat stringer', fields: [['b', 'Crown width b'], ['h', 'Height h'], ['f', 'Flange width f'], ['t', 'Thickness t']], def: { b: 0.03, h: 0.03, f: 0.015, t: 0.0016 } },
  custom: { label: 'Custom (enter properties)', fields: [['A', 'Area A'], ['I', 'Inertia I'], ['ctop', 'c top'], ['cbot', 'c bottom'], ['J', 'Torsion J']], def: { A: 2e-3, I: 5e-6, ctop: 0.05, cbot: 0.05, J: 1e-6 } },
};

// parts: {k:'r', x, y, w, h, s} (x,y = lower-left) or {k:'c', x, y, r, s} (centre). Origin at bottom-left of bounding box.
export function sectionParts(shape, d) {
  const R = (x, y, w, h, s = 1) => ({ k: 'r', x, y, w, h, s });
  switch (shape) {
    case 'rect': return [R(0, 0, d.b, d.h)];
    case 'circle': return [{ k: 'c', x: d.d / 2, y: d.d / 2, r: d.d / 2, s: 1 }];
    case 'tube': { const r = d.d / 2; return [{ k: 'c', x: r, y: r, r, s: 1 }, { k: 'c', x: r, y: r, r: Math.max(0, r - d.t), s: -1 }]; }
    case 'box': return [R(0, 0, d.b, d.h), R(d.t, d.t, Math.max(0, d.b - 2 * d.t), Math.max(0, d.h - 2 * d.t), -1)];
    case 'ibeam': return [R(0, 0, d.b, d.tf), R((d.b - d.tw) / 2, d.tf, d.tw, d.h - 2 * d.tf), R(0, d.h - d.tf, d.b, d.tf)];
    case 'channel': return [R(0, 0, d.b, d.tf), R(0, d.tf, d.tw, d.h - 2 * d.tf), R(0, d.h - d.tf, d.b, d.tf)];
    case 'tee': return [R((d.b - d.tw) / 2, 0, d.tw, d.h - d.tf), R(0, d.h - d.tf, d.b, d.tf)];
    case 'angle': return [R(0, 0, d.b, d.t), R(0, d.t, d.t, d.h - d.t)];
    case 'zsec': return [R(0, 0, d.b, d.t), R(d.b - d.t, d.t, d.t, d.h - 2 * d.t), R(d.b - d.t, d.h - d.t, d.b, d.t)];
    case 'hat': {
      const W = 2 * d.f + d.b + 2 * d.t, t = d.t;
      return [R(0, 0, d.f + t, t), R(d.f, t, t, d.h - 2 * t), R(d.f, d.h - t, d.b + 2 * t, t), R(d.f + d.b + t, t, t, d.h - 2 * t), R(W - d.f - t, 0, d.f + t, t)];
    }
    default: return [];
  }
}

// chord width of a part at height y
function partWidth(p, y) {
  if (p.k === 'r') return y >= p.y && y <= p.y + p.h ? p.w : 0;
  const dy = y - p.y; return Math.abs(dy) < p.r ? 2 * Math.sqrt(p.r * p.r - dy * dy) : 0;
}
const GL = [[-0.9061798459386640, 0.2369268850561891], [-0.5384693101056831, 0.4786286704993665], [0, 0.5688888888888889], [0.5384693101056831, 0.4786286704993665], [0.9061798459386640, 0.2369268850561891]];

// ∫ b(y)·g(y) dy over [ya, yb], exact for rectangles (Gauss-Legendre between part edges).
function integ(parts, g, ya, yb) {
  if (!(yb > ya)) return 0;
  const br = new Set([ya, yb]);
  for (const p of parts) for (const y of p.k === 'r' ? [p.y, p.y + p.h] : [p.y - p.r, p.y, p.y + p.r]) if (y > ya && y < yb) br.add(y);
  const ys = [...br].sort((a, b) => a - b), curved = parts.some(p => p.k === 'c');
  let span = 0; for (const p of parts) span = Math.max(span, p.k === 'r' ? p.h : 2 * p.r);
  let sum = 0;
  for (let i = 0; i + 1 < ys.length; i++) {
    const a = ys[i], b = ys[i + 1];
    const n = curved ? Math.max(4, Math.ceil(400 * (b - a) / span)) : 1;
    for (let j = 0; j < n; j++) {
      const lo = a + (b - a) * j / n, hi = a + (b - a) * (j + 1) / n, m = (lo + hi) / 2, r = (hi - lo) / 2;
      for (const [x, w] of GL) { const y = m + r * x; sum += widthAt(parts, y) * g(y) * w * r; }
    }
  }
  return sum;
}
const widthAt = (parts, y) => parts.reduce((s, p) => s + p.s * partWidth(p, y), 0);

export function sectionProps(sec) {
  const { shape, dims: d } = sec;
  if (shape === 'custom') {
    const A = d.A, I = d.I, c = Math.max(d.ctop, d.cbot);
    return { A, Ix: I, Iy: I, J: d.J, ctop: d.ctop, cbot: d.cbot, h: d.ctop + d.cbot, Sx: I / c, Zx: 1.5 * I / c, Qmax: A * (d.ctop + d.cbot) / 8, bNA: A / (d.ctop + d.cbot), r: Math.sqrt(I / A), custom: true, parts: [] };
  }
  const parts = sectionParts(shape, d);
  // exact area properties per part
  let A = 0, Sx_ = 0, Sy_ = 0, Ixx0 = 0, Iyy0 = 0, Ixy0 = 0;
  for (const p of parts) {
    if (p.k === 'r') {
      const a = p.w * p.h * p.s, cx = p.x + p.w / 2, cy = p.y + p.h / 2;
      A += a; Sx_ += a * cx; Sy_ += a * cy;
      Ixx0 += p.s * p.w * p.h ** 3 / 12 + a * cy * cy; Iyy0 += p.s * p.h * p.w ** 3 / 12 + a * cx * cx; Ixy0 += a * cx * cy;
    } else {
      const a = Math.PI * p.r * p.r * p.s, i0 = p.s * Math.PI * p.r ** 4 / 4;
      A += a; Sx_ += a * p.x; Sy_ += a * p.y; Ixx0 += i0 + a * p.y * p.y; Iyy0 += i0 + a * p.x * p.x; Ixy0 += a * p.x * p.y;
    }
  }
  const xc = Sx_ / A, yc = Sy_ / A, Ix = Ixx0 - A * yc * yc, Iy = Iyy0 - A * xc * xc, Ixy = Ixy0 - A * xc * yc;
  const ymin = Math.min(...parts.map(p => p.k === 'r' ? p.y : p.y - p.r)), ymax = Math.max(...parts.map(p => p.k === 'r' ? p.y + p.h : p.y + p.r));
  const xmin = Math.min(...parts.map(p => p.k === 'r' ? p.x : p.x - p.r)), xmax = Math.max(...parts.map(p => p.k === 'r' ? p.x + p.w : p.x + p.r));
  const ctop = ymax - yc, cbot = yc - ymin;
  // first moment of the area above y0 about the centroid, for tau = VQ/(Ib)
  const Qabove = y0 => integ(parts, y => y - yc, Math.max(y0, ymin), ymax);
  const Qmax = Qabove(yc), bNA = widthAt(parts, yc);
  // plastic neutral axis splits the area in half
  let lo = ymin, hi = ymax;
  for (let i = 0; i < 64; i++) { const m = (lo + hi) / 2; if (integ(parts, () => 1, m, ymax) > A / 2) lo = m; else hi = m; }
  const ypna = (lo + hi) / 2;
  const Zx = integ(parts, y => ypna - y, ymin, ypna) + integ(parts, y => y - ypna, ypna, ymax);
  const J = torsionJ(shape, d);
  const Iavg = (Ix + Iy) / 2, Rm = Math.hypot((Ix - Iy) / 2, Ixy);
  return {
    A, Ix, Iy, Ixy, I1: Iavg + Rm, I2: Iavg - Rm, thetaP: 0.5 * Math.atan2(-2 * Ixy, Ix - Iy), J, xc, yc, ctop, cbot, h: ymax - ymin, w: xmax - xmin,
    Sx: Ix / Math.max(ctop, cbot), Stop: Ix / ctop, Sbot: Ix / cbot, Zx, ypna, Qmax, bNA, r: Math.sqrt(Ix / A), ry: Math.sqrt(Iy / A),
    shapeFactor: Zx / (Ix / Math.max(ctop, cbot)), shearCentre: shearCentre(shape, d),
    parts, Qabove, widthAt: y => widthAt(parts, y), ymin, ymax, xmin, xmax,
  };
}

// Torsion constant: exact for circles and tubes, Bredt-Batho for thin closed boxes,
// Saint-Venant series for a solid rectangle, sum of b·t³/3 for open thin-walled shapes.
export function torsionJ(shape, d) {
  const rectJ = (a, b) => { const L = Math.max(a, b), t = Math.min(a, b); return L * t ** 3 * (1 / 3 - 0.21 * t / L * (1 - t ** 4 / (12 * L ** 4))); };
  switch (shape) {
    case 'rect': return rectJ(d.b, d.h);
    case 'circle': return Math.PI * d.d ** 4 / 32;
    case 'tube': return Math.PI * (d.d ** 4 - Math.max(0, d.d - 2 * d.t) ** 4) / 32;
    case 'box': { const bm = d.b - d.t, hm = d.h - d.t; return 2 * d.t * bm * bm * hm * hm / (bm + hm); }
    case 'ibeam': return (2 * d.b * d.tf ** 3 + (d.h - 2 * d.tf) * d.tw ** 3) / 3;
    case 'channel': return (2 * d.b * d.tf ** 3 + (d.h - 2 * d.tf) * d.tw ** 3) / 3;
    case 'tee': return (d.b * d.tf ** 3 + (d.h - d.tf) * d.tw ** 3) / 3;
    case 'angle': return (d.b + d.h - d.t) * d.t ** 3 / 3;
    case 'zsec': return (2 * d.b + d.h - 2 * d.t) * d.t ** 3 / 3;
    case 'hat': return (2 * d.f + d.b + 2 * d.h) * d.t ** 3 / 3;
    default: return d.J || 0;
  }
}

// Shear centre (x from the left edge) for shapes where it is off the centroid; null if it coincides.
function shearCentre(shape, d) {
  if (shape === 'channel') {
    const hm = d.h - d.tf, bm = d.b - d.tw / 2;
    const e = 3 * bm * bm * d.tf / (6 * bm * d.tf + hm * d.tw); // from web centreline
    return { x: d.tw / 2 - e, y: d.h / 2, note: 'e = 3b²tf/(6b·tf + h·tw) from the web centreline' };
  }
  if (shape === 'angle') return { x: d.t / 2, y: d.t / 2, note: 'at the intersection of the leg centrelines' };
  if (shape === 'tee') return { x: d.b / 2, y: d.h - d.tf / 2, note: 'at the intersection of flange and stem centrelines' };
  return null;
}

// Torsional shear stress per unit torque: tau_max = T * k
export function torsionStressFactor(shape, d, J) {
  switch (shape) {
    case 'circle': return (d.d / 2) / J;
    case 'tube': return (d.d / 2) / J;
    case 'box': return 1 / (2 * (d.b - d.t) * (d.h - d.t) * d.t);
    case 'rect': { const t = Math.min(d.b, d.h); return t / J; }
    case 'ibeam': case 'channel': case 'tee': return Math.max(d.tf, d.tw) / J;
    case 'angle': case 'zsec': case 'hat': return d.t / J;
    default: return d.ctop ? Math.max(d.ctop, d.cbot) / J : NaN;
  }
}

export const defaultSection = () => ({ id: 's1', name: 'Default section', shape: 'ibeam', dims: { ...SHAPES.ibeam.def } });
export const materialById = (list, id) => list.find(m => m.id === id) || MATERIALS.find(m => m.id === id) || MATERIALS[0];
