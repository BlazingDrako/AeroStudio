// Unit systems for the Structures module. Everything is stored and solved in SI base units
// (m, N, Pa, kg, K); these tables convert to and from what the user sees.
//   SI value = shown value × f

const SYSTEMS = {
  si_kn: {
    label: 'SI — kN, m, mm',
    len: ['m', 1], dim: ['mm', 1e-3], force: ['kN', 1e3], moment: ['kN·m', 1e3], dist: ['kN/m', 1e3],
    stress: ['MPa', 1e6], modulus: ['GPa', 1e9], area: ['mm²', 1e-6], inertia: ['mm⁴', 1e-12], smod: ['mm³', 1e-9],
    disp: ['mm', 1e-3], rot: ['mrad', 1e-3], mass: ['kg', 1], density: ['kg/m³', 1], kspring: ['kN/m', 1e3],
    krot: ['kN·m/rad', 1e3], dtemp: ['°C', 1], alpha: ['µ/°C', 1e-6], lmass: ['kg/m', 1], strain: ['µε', 1e-6], accel: ['m/s²', 1],
  },
  si_n: {
    label: 'SI — N, m, mm',
    len: ['m', 1], dim: ['mm', 1e-3], force: ['N', 1], moment: ['N·m', 1], dist: ['N/m', 1],
    stress: ['MPa', 1e6], modulus: ['GPa', 1e9], area: ['mm²', 1e-6], inertia: ['mm⁴', 1e-12], smod: ['mm³', 1e-9],
    disp: ['mm', 1e-3], rot: ['mrad', 1e-3], mass: ['kg', 1], density: ['kg/m³', 1], kspring: ['N/m', 1],
    krot: ['N·m/rad', 1], dtemp: ['°C', 1], alpha: ['µ/°C', 1e-6], lmass: ['kg/m', 1], strain: ['µε', 1e-6], accel: ['m/s²', 1],
  },
  si_mm: {
    label: 'SI — N, mm',
    len: ['mm', 1e-3], dim: ['mm', 1e-3], force: ['N', 1], moment: ['N·mm', 1e-3], dist: ['N/mm', 1e3],
    stress: ['MPa', 1e6], modulus: ['GPa', 1e9], area: ['mm²', 1e-6], inertia: ['mm⁴', 1e-12], smod: ['mm³', 1e-9],
    disp: ['mm', 1e-3], rot: ['mrad', 1e-3], mass: ['kg', 1], density: ['kg/m³', 1], kspring: ['N/mm', 1e3],
    krot: ['N·mm/rad', 1e-3], dtemp: ['°C', 1], alpha: ['µ/°C', 1e-6], lmass: ['kg/m', 1], strain: ['µε', 1e-6], accel: ['m/s²', 1],
  },
  us_kip: {
    label: 'US — kip, ft, in',
    len: ['ft', 0.3048], dim: ['in', 0.0254], force: ['kip', 4448.2216], moment: ['kip·ft', 4448.2216 * 0.3048], dist: ['kip/ft', 4448.2216 / 0.3048],
    stress: ['ksi', 6.894757e6], modulus: ['ksi', 6.894757e6], area: ['in²', 0.0254 ** 2], inertia: ['in⁴', 0.0254 ** 4], smod: ['in³', 0.0254 ** 3],
    disp: ['in', 0.0254], rot: ['mrad', 1e-3], mass: ['lb', 0.45359237], density: ['lb/ft³', 0.45359237 / 0.3048 ** 3], kspring: ['kip/in', 4448.2216 / 0.0254],
    krot: ['kip·in/rad', 4448.2216 * 0.0254], dtemp: ['°F', 5 / 9], alpha: ['µ/°F', 1.8e-6], lmass: ['lb/ft', 0.45359237 / 0.3048], strain: ['µε', 1e-6], accel: ['ft/s²', 0.3048],
  },
  us_lb: {
    label: 'US — lbf, in',
    len: ['in', 0.0254], dim: ['in', 0.0254], force: ['lbf', 4.4482216], moment: ['lbf·in', 4.4482216 * 0.0254], dist: ['lbf/in', 4.4482216 / 0.0254],
    stress: ['psi', 6894.757], modulus: ['Msi', 6.894757e9], area: ['in²', 0.0254 ** 2], inertia: ['in⁴', 0.0254 ** 4], smod: ['in³', 0.0254 ** 3],
    disp: ['in', 0.0254], rot: ['mrad', 1e-3], mass: ['lb', 0.45359237], density: ['lb/in³', 0.45359237 / 0.0254 ** 3], kspring: ['lbf/in', 4.4482216 / 0.0254],
    krot: ['lbf·in/rad', 4.4482216 * 0.0254], dtemp: ['°F', 5 / 9], alpha: ['µ/°F', 1.8e-6], lmass: ['lb/in', 0.45359237 / 0.0254], strain: ['µε', 1e-6], accel: ['in/s²', 0.0254],
  },
};

export const UNIT_SYSTEMS = Object.entries(SYSTEMS).map(([value, s]) => ({ value, label: s.label }));

let current = 'si_kn';
try { const s = localStorage.getItem('aerostudio-struct-units'); if (s && SYSTEMS[s]) current = s; } catch { }

export const units = {
  get system() { return current; },
  set(sys) {
    if (!SYSTEMS[sys] || sys === current) return;
    current = sys;
    try { localStorage.setItem('aerostudio-struct-units', sys); } catch { }
    dispatchEvent(new Event('unitschange'));
  },
  label: q => SYSTEMS[current][q][0],
  factor: q => SYSTEMS[current][q][1],
  toSI: (q, v) => v * SYSTEMS[current][q][1],
  fromSI: (q, v) => v / SYSTEMS[current][q][1],
  isUS: () => current.startsWith('us'),
  // formatted value with unit label
  fmt(q, v, digits = 4) { return fmtNum(v / SYSTEMS[current][q][1], digits) + ' ' + SYSTEMS[current][q][0]; },
  num(q, v, digits = 4) { return fmtNum(v / SYSTEMS[current][q][1], digits); },
};

// Compact significant-figure formatting: 12.35, 0.001235, 1.235e+7
export function fmtNum(v, digits = 4) {
  if (v === undefined || v === null || !isFinite(v)) return '—';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-4) return v.toExponential(Math.max(1, digits - 1)).replace('e+', 'e');
  const d = Math.max(0, digits - 1 - Math.floor(Math.log10(a)));
  let s = v.toFixed(Math.min(d, 8));
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}
