// Formula Library engine: unit tables and a general "solve for any variable" root finder.
// Every formula is written once as f(x) => [lhs, rhs] in SI units. To solve for one variable the
// others are held fixed and the residual is scanned across that variable's physical range; each sign
// change is refined by bisection and kept only if the residual really goes to zero (not a pole).
// Several roots (subsonic/supersonic A/A*, weak/strong oblique shock) are all returned.

// ---- units: SI value = shown × f + o ----
export const UNITS = {
  dimless: [['–', 1]],
  length: [['m', 1], ['km', 1e3], ['mm', 1e-3], ['cm', 1e-2], ['ft', 0.3048], ['in', 0.0254], ['mi', 1609.344], ['nmi', 1852]],
  altitude: [['m', 1], ['km', 1e3], ['ft', 0.3048]],
  radius: [['km', 1e3], ['m', 1], ['mi', 1609.344], ['nmi', 1852], ['AU', 1.495978707e11]],
  dist: [['km', 1e3], ['m', 1], ['mi', 1609.344], ['nmi', 1852], ['ft', 0.3048]],
  area: [['m²', 1], ['cm²', 1e-4], ['mm²', 1e-6], ['ft²', 0.09290304], ['in²', 6.4516e-4]],
  inertia: [['cm⁴', 1e-8], ['mm⁴', 1e-12], ['m⁴', 1], ['in⁴', 4.162314e-7]],
  speed: [['m/s', 1], ['km/h', 1 / 3.6], ['kt', 1852 / 3600], ['ft/s', 0.3048], ['mph', 0.44704], ['km/s', 1e3]],
  dv: [['m/s', 1], ['km/s', 1e3], ['ft/s', 0.3048]],
  vspeed: [['m/s', 1], ['ft/min', 0.00508]],
  accel: [['m/s²', 1], ['g', 9.80665], ['ft/s²', 0.3048]],
  force: [['N', 1], ['kN', 1e3], ['MN', 1e6], ['lbf', 4.4482216], ['kip', 4448.2216]],
  weight: [['N', 1], ['kN', 1e3], ['lbf', 4.4482216]],
  mass: [['kg', 1], ['t', 1e3], ['g', 1e-3], ['lb', 0.45359237], ['slug', 14.593903]],
  mdot: [['kg/s', 1], ['lb/s', 0.45359237], ['kg/h', 1 / 3600]],
  pressure: [['Pa', 1], ['kPa', 1e3], ['MPa', 1e6], ['bar', 1e5], ['atm', 101325], ['psi', 6894.757], ['psf', 47.880259]],
  stress: [['MPa', 1e6], ['kPa', 1e3], ['Pa', 1], ['GPa', 1e9], ['psi', 6894.757], ['ksi', 6.894757e6]],
  modulus: [['GPa', 1e9], ['MPa', 1e6], ['Msi', 6.894757e9], ['ksi', 6.894757e6]],
  density: [['kg/m³', 1], ['g/cm³', 1e3], ['slug/ft³', 515.37882], ['lb/ft³', 16.018463]],
  temp: [['K', 1], ['°C', 1, 273.15], ['°F', 5 / 9, 459.67 * 5 / 9], ['°R', 5 / 9]],
  dtemp: [['K', 1], ['°C', 1], ['°F', 5 / 9]],
  time: [['s', 1], ['min', 60], ['h', 3600], ['day', 86400], ['yr', 365.25 * 86400]],
  angle: [['°', Math.PI / 180], ['rad', 1]],
  perangle: [['1/rad', 1], ['1/°', 180 / Math.PI]],
  power: [['kW', 1e3], ['W', 1], ['MW', 1e6], ['hp', 745.69987]],
  energy: [['J', 1], ['kJ', 1e3], ['MJ', 1e6], ['kWh', 3.6e6], ['BTU', 1055.0559]],
  spenergy: [['MJ/kg', 1e6], ['kJ/kg', 1e3], ['J/kg', 1], ['BTU/lb', 2326]],
  orbenergy: [['MJ/kg', 1e6], ['km²/s²', 1e6], ['J/kg', 1]],
  viscosity: [['µPa·s', 1e-6], ['Pa·s', 1], ['cP', 1e-3]],
  gasconst: [['J/(kg·K)', 1], ['ft·lbf/(slug·°R)', 0.1672255]],
  cp: [['J/(kg·K)', 1], ['kJ/(kg·K)', 1e3], ['BTU/(lb·°R)', 4186.8]],
  molar: [['g/mol', 1e-3], ['kg/mol', 1]],
  lapse: [['K/km', 1e-3], ['K/m', 1], ['°F/1000 ft', 5 / 9 / 304.8]],
  tsfc: [['kg/(N·h)', 1 / 3600], ['lb/(lbf·h)', 0.45359237 / 4.4482216 / 3600], ['g/(kN·s)', 1e-6], ['kg/(N·s)', 1]],
  bsfc: [['g/(kW·h)', 1e-3 / 3.6e6], ['lb/(hp·h)', 0.45359237 / 745.69987 / 3600], ['kg/J', 1]],
  isp: [['s', 1]],
  freq: [['Hz', 1], ['rad/s', 1 / (2 * Math.PI)], ['rpm', 1 / 60]],
  angvel: [['rad/s', 1], ['°/s', Math.PI / 180], ['rpm', 2 * Math.PI / 60]],
  stiff: [['N/m', 1], ['kN/m', 1e3], ['N/mm', 1e3], ['lbf/in', 175.12685]],
  damping: [['N·s/m', 1], ['kN·s/m', 1e3], ['lbf·s/in', 175.12685]],
  moment: [['N·m', 1], ['kN·m', 1e3], ['N·mm', 1e-3], ['lbf·ft', 1.3558179], ['lbf·in', 0.11298483], ['kip·ft', 1355.8179]],
  dist_load: [['N/m', 1], ['kN/m', 1e3], ['lbf/ft', 14.593903], ['lbf/in', 175.12685]],
  lmass: [['kg/m', 1], ['lb/ft', 1.4881639]],
  strain: [['µε', 1e-6], ['%', 1e-2], ['–', 1]],
  alpha: [['µ/K', 1e-6], ['µ/°F', 1.8e-6], ['1/K', 1]],
  gravparam: [['km³/s²', 1e9], ['m³/s²', 1]],
  heatflux: [['kW/m²', 1e3], ['W/m²', 1], ['W/cm²', 1e4], ['BTU/(ft²·s)', 11356.527]],
  conduct: [['W/(m·K)', 1], ['BTU/(h·ft·°F)', 1.7307347]],
  htc: [['W/(m²·K)', 1], ['BTU/(h·ft²·°F)', 5.6782633]],
  circulation: [['m²/s', 1], ['ft²/s', 0.09290304]],
  liftpu: [['N/m', 1], ['kN/m', 1e3], ['lbf/ft', 14.593903]],
  vol: [['m³', 1], ['L', 1e-3], ['ft³', 0.028316847]],
};

// preferred display unit per kind in each system (first entry is used when not listed)
const US_PREF = {
  length: 'ft', altitude: 'ft', radius: 'mi', dist: 'nmi', area: 'ft²', inertia: 'in⁴', speed: 'kt', dv: 'ft/s', vspeed: 'ft/min',
  accel: 'ft/s²', force: 'lbf', weight: 'lbf', mass: 'lb', mdot: 'lb/s', pressure: 'psf', stress: 'ksi', modulus: 'Msi',
  density: 'slug/ft³', temp: '°R', dtemp: '°F', power: 'hp', energy: 'BTU', spenergy: 'BTU/lb', gasconst: 'ft·lbf/(slug·°R)',
  cp: 'BTU/(lb·°R)', lapse: '°F/1000 ft', tsfc: 'lb/(lbf·h)', bsfc: 'lb/(hp·h)', stiff: 'lbf/in', damping: 'lbf·s/in',
  moment: 'lbf·ft', dist_load: 'lbf/ft', lmass: 'lb/ft', alpha: 'µ/°F', heatflux: 'BTU/(ft²·s)', conduct: 'BTU/(h·ft·°F)',
  htc: 'BTU/(h·ft²·°F)', circulation: 'ft²/s', liftpu: 'lbf/ft', vol: 'ft³',
};

export function unitList(kind) { return UNITS[kind] || UNITS.dimless; }
export function findUnit(kind, name) { return unitList(kind).find(u => u[0] === name) || unitList(kind)[0]; }
export function preferredUnit(kind, system, siDefault) {
  if (system === 'us' && kind === 'length' && (siDefault === 'mm' || siDefault === 'cm')) return 'in';
  if (system === 'us' && US_PREF[kind]) return US_PREF[kind];
  return siDefault || unitList(kind)[0][0];
}
export const toSI = (kind, unit, v) => { const u = findUnit(kind, unit); return v * u[1] + (u[2] || 0); };
export const fromSI = (kind, unit, v) => { const u = findUnit(kind, unit); return (v - (u[2] || 0)) / u[1]; };

// ---- constants (SI) ----
export const K = {
  g0: 9.80665, Rair: 287.053, gam: 1.4, cpAir: 1004.7, Ru: 8.314462618, sigma: 5.670374e-8,
  muE: 3.986004418e14, RE: 6371e3, rho0: 1.225, p0: 101325, T0: 288.15, a0: 340.294, mu0: 1.7894e-5,
};

// ---- the root finder ----
// formula: { vars: [{id, min, max, log?}], f(x) => [lhs, rhs] }, x: SI values by id, tid: unknown id.
// Returns { value, roots: [...] } with value = root nearest the previous value of the unknown.
export function solveFormula(formula, x, tid) {
  const v = formula.vars.find(q => q.id === tid);
  const lo = v.min, hi = v.max, useLog = v.log ?? (lo > 0 && hi / lo > 50);
  const N = useLog ? Math.min(800, Math.max(200, Math.ceil(Math.log10(hi / lo) * 50))) : 400;
  const at = k => useLog ? lo * Math.pow(hi / lo, k / N) : lo + (hi - lo) * k / N;
  const y = { ...x };
  const res = t => {
    y[tid] = t;
    let a, b;
    try { [a, b] = formula.f(y); } catch { return NaN; }
    const s = Math.abs(a) + Math.abs(b);
    return s === 0 ? 0 : (a - b) / s;
  };
  const roots = [];
  let t0 = at(0), r0 = res(t0);
  if (r0 === 0 || Math.abs(r0) < 1e-12) roots.push(t0);
  for (let k = 1; k <= N; k++) {
    const t1 = at(k), r1 = res(t1);
    if (r1 === 0 || Math.abs(r1) < 1e-12) roots.push(t1);
    else if (isFinite(r0) && isFinite(r1) && r0 !== 0 && r0 * r1 < 0) {
      let a = t0, b = t1, ra = r0;
      for (let i = 0; i < 80; i++) {
        const m = useLog ? Math.sqrt(a * b) : (a + b) / 2, rm = res(m);
        if (rm === 0) { a = b = m; break; }
        if (rm * ra < 0) b = m; else { a = m; ra = rm; }
        if (Math.abs(b - a) <= 1e-13 * Math.max(Math.abs(a), Math.abs(b), 1e-300)) break;
      }
      const m = useLog ? Math.sqrt(a * b) : (a + b) / 2;
      if (Math.abs(res(m)) < 1e-7) roots.push(m);
    }
    t0 = t1; r0 = r1;
  }
  // merge near-duplicates (a root exactly on a grid point is found twice)
  const uniq = [];
  for (const r of roots) if (!uniq.some(u => Math.abs(u - r) <= 1e-9 * Math.max(Math.abs(u), Math.abs(r), 1e-12))) uniq.push(r);
  if (!uniq.length) return { value: NaN, roots: [] };
  const prev = x[tid];
  let best = uniq[0];
  if (isFinite(prev)) {
    const d = r => useLog && prev > 0 ? Math.abs(Math.log(r / prev)) : Math.abs(r - prev);
    for (const r of uniq) if (d(r) < d(best)) best = r;
  }
  return { value: best, roots: uniq };
}

// Evaluate the residual at given values (for a consistency check / tests)
export function residual(formula, x) {
  const [a, b] = formula.f(x);
  const s = Math.abs(a) + Math.abs(b);
  return s === 0 ? 0 : (a - b) / s;
}

// Sweep the unknown against one input: returns { xs, ys } (SI). Continuation keeps one branch.
export function sweep(formula, x, tid, xid, xa, xb, n = 120, logx = false) {
  const xs = [], ys = [];
  let prev = x[tid];
  for (let k = 0; k <= n; k++) {
    const t = logx ? xa * Math.pow(xb / xa, k / n) : xa + (xb - xa) * k / n;
    const y = { ...x, [xid]: t, [tid]: prev };
    const r = solveFormula(formula, y, tid);
    xs.push(t); ys.push(r.value);
    if (isFinite(r.value)) prev = r.value;
  }
  return { xs, ys };
}

// Compact significant-figure formatting
export function fmtVal(v, digits = 4) {
  if (v === undefined || v === null || !isFinite(v)) return '—';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e7 || a < 1e-4) return v.toExponential(digits - 1).replace('e+', 'e');
  const d = Math.max(0, digits - 1 - Math.floor(Math.log10(a)));
  let s = v.toFixed(Math.min(d, 8));
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}
