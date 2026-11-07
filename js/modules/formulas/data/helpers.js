// Shared helpers for the formula data files.
// v(id, symbol HTML, name, unit kind, default SI value, min SI, max SI, { unit, log, desc })
export const v = (id, sym, name, kind, val, min, max, o = {}) => ({ id, sym, name, kind, val, min, max, ...o });
export const deg = Math.PI / 180;
export { K } from '../../../solvers/formulas.js';

// common variables, reused across formulas
export const GAM = (o = {}) => v('g', 'γ', 'Ratio of specific heats', 'dimless', 1.4, 1.01, 1.8, { desc: 'cp/cv: 1.4 for air, 1.67 for monatomic gases, about 1.2 for hot combustion products.', ...o });
export const RHO = (val = 1.225, o = {}) => v('rho', 'ρ', 'Density', 'density', val, 1e-8, 2e4, o);
