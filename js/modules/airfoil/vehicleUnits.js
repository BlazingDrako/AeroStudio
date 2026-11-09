// Display units for the Vehicle aero tab. Everything is computed in SI (speeds in km/h, heights in m, ride height
// in mm); only what is shown changes. US units (mph, lb, lbf, ft, in, hp) are the default.
const KEY = 'pteronautics.vehicleUnits';
let sys = 'us';
try { const s = localStorage.getItem(KEY); if (s === 'us' || s === 'metric') sys = s; } catch { /* storage blocked: keep the default */ }

export const UNIT_SYSTEMS = [{ value: 'us', label: 'US (mph, lb, ft)' }, { value: 'metric', label: 'Metric (km/h, kg, m)' }];
export const unitSystem = () => sys;
export function setUnitSystem(s) { sys = s; try { localStorage.setItem(KEY, s); } catch { /* not saved */ } }

const G0 = 9.81, us = () => sys === 'us';
const n0 = x => Math.round(x).toLocaleString();
export const fmt = {
  speed: kmh => (us() ? `${n0(kmh / 1.609344)} mph` : `${n0(kmh)} km/h`),
  alt: m => (us() ? `${n0(m * 3.28084)} ft` : `${n0(m)} m`),
  // a vertical force shown as the weight it equals (cars: "1,355 kg of downforce")
  load: N => (us() ? `${n0(Math.abs(N) / G0 * 2.20462)} lb` : `${n0(Math.abs(N) / G0)} kg`),
  mass: kg => (us() ? `${n0(kg * 2.20462)} lb` : kg >= 1000 ? `${+(kg / 1000).toFixed(1)} t` : `${n0(kg)} kg`),
  force: N => { const a = Math.abs(N); return us() ? `${n0(a * 0.224809)} lbf` : a >= 1e4 ? `${(a / 1000).toFixed(a >= 1e5 ? 0 : 1)} kN` : `${n0(a)} N`; },
  power: W => (us() ? `${n0(W / 745.7)} hp` : `${n0(W / 1000)} kW`),
};

// Sliders run in display units. scale: display = internal × k; step in display units; label suffix.
const SLIDER = {
  speed: { us: { k: 1 / 1.609344, step: 1, u: 'mph', d: 0 }, metric: { k: 1, step: 1, u: 'km/h', d: 0 } },
  alt: { us: { k: 3.28084, step: 100, u: 'ft', d: 0 }, metric: { k: 1, step: 100, u: 'm', d: 0 } },
  ride: { us: { k: 1 / 25.4, step: 0.05, u: 'in', d: 2 }, metric: { k: 1, step: 1, u: 'mm', d: 0 } },
};
export function sliderUnits(key) {
  const s = SLIDER[key]; if (!s) return null;
  const c = s[sys];
  return { ...c, fmt: x => `${(+x).toFixed(c.d)} ${c.u}` };
}
