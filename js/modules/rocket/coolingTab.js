// Cooling: convective heat flux from the hot gas to the wall along the engine (Bartz), the total heat load,
// whether the propellant chosen as coolant can absorb it, the temperature drop through the liner, and where an
// uncooled radiative nozzle extension could take over.
import { h, section, select, field, segmented, toggle } from '../../lib/ui.js';
import { Plot } from '../../lib/plot.js';
import * as R from '../../solvers/rocket.js';
import { store, bound, metricsGrid, insightsList, card, put, len, propLabel } from './common.js';
import { EngineView } from './engineView.js';

export function coolingTab() {
  const C = { coolant: 'fuel', liner: 'copper', t: 1.0, Twg: 800, emiss: 0.8, ext: null };
  const S = store.S;
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });
  const metrics = metricsGrid();
  const view = new EngineView({ height: 'clamp(260px, 32vh, 380px)' });
  view.set({ mode: 'q', plume: false });
  const vcard = card('Wall heat flux', 'The engine colored by the convective heat flux into the wall. It peaks just upstream of the throat, where the gas is still dense but already fast; that is where cooling is hardest.');
  vcard.append(view.el);
  const qCard = card('Heat flux along the wall', 'Bartz equation: h_g = 0.026/Dt^0.2 · (μ^0.2 cp / Pr^0.6)₀ · (Pc/c*)^0.8 · (Dt/Rc)^0.1 · (At/A)^0.9 · σ. The (At/A)^0.9 term is why the flux falls off so quickly in the nozzle.');
  const qPlot = new Plot(qCard, { xlabel: 'distance from throat (cm)', ylabel: 'heat flux (MW/m²)', xname: 'x', yname: 'q', xfmt: v => v.toFixed(1) + ' cm', yfmt: v => v.toFixed(2) + ' MW/m²' });
  const tCard = card('Wall temperatures', 'Adiabatic wall temperature (what an insulated wall would reach), the gas-side wall temperature you hold it at, the coolant-side wall temperature after conducting through the liner, and the temperature an uncooled wall would settle at by radiating to space.');
  const tPlot = new Plot(tCard, { xlabel: 'distance from throat (cm)', ylabel: 'temperature (K)', xname: 'x', yname: 'T', xfmt: v => v.toFixed(1) + ' cm', yfmt: v => v.toFixed(0) + ' K', legendPos: 'bottom' });
  for (const p of [qPlot, tPlot]) p.wrap.style.height = '260px';
  const insCard = card('Can it be cooled?'); const insEl = h('div'); insCard.append(insEl);
  main.append(metrics.el, vcard, h('div', { class: 'cf-grid2b' }, qCard, tCard), insCard);

  const build = () => {
    const sec = section('Regenerative cooling');
    const seg = segmented([{ value: 'fuel', label: `Fuel (${propLabel(S.fuel)})` }, { value: 'ox', label: `Oxidizer (${propLabel(S.ox)})` }], C.coolant, v => { C.coolant = v; paint(); });
    seg.el.classList.add('seg-wrap');
    put(sec.body, field('Coolant', seg.el, 'The propellant pumped through the wall channels before it is injected. Almost always the fuel; LOX cooling is rare because a leak means a fire.'),
      field('Liner material', select(Object.entries(R.LINERS).map(([value, l]) => ({ value, label: l.label })), C.liner, v => { C.liner = v; paint(); }), 'Copper alloys conduct heat 15–20× better than steel or nickel alloys, so the liner stays cool enough even at the throat.'),
      bound(C, 't', 'Liner thickness', 0.3, 5, { step: 0.05, digits: 2, unit: 'mm', onInput: paint, tip: 'Hot-wall thickness between the gas and the coolant channels.' }),
      bound(C, 'Twg', 'Gas-side wall temperature', 400, 1600, { step: 10, digits: 0, unit: 'K', onInput: paint, tip: 'The temperature the hot wall is held at. A hotter wall takes less heat (smaller Taw − Twg) but material strength falls.' }),
      bound(C, 'emiss', 'Wall emissivity (radiative extension)', 0.2, 0.95, { step: 0.01, digits: 2, onInput: paint, tip: 'For the uncooled-wall curve: a dark oxidised niobium or carbon–carbon extension radiates with ε ≈ 0.8.' }),
      toggle('Radiatively cooled nozzle extension', ext(), v => { C.ext = v; paint(); }, { tip: 'Stop the cooling jacket where an uncooled niobium wall would stay below 1600 K by radiating, as on Merlin Vacuum and RL10. Its heat is radiated away instead of going into the coolant. On by default for ε > 60.' }).el);
    controls.replaceChildren(sec.el, h('div', { class: 'hint', style: { padding: '0 4px' } }, 'The engine itself (propellants, Pc, thrust, ε) is set on the Engine design tab.'));
  };

  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  let B = null;
  const ext = () => C.ext ?? S.eps > 60;
  const paint = () => {
    const D = store.D; if (!D) return;
    const opts = { Twg: C.Twg, coolant: C.coolant, liner: C.liner, t: C.t / 1000, emiss: C.emiss };
    B = R.bartz(D, opts);
    const radPt = B.pts.find(p => p.x > 0 && p.Trad < R.LINERS.niobium.Tmax);
    if (ext() && radPt) B = R.bartz(D, { ...opts, epsCool: Math.max(3, radPt.eps) });
    const pk = B.peak, liner = B.liner;
    const th = B.pts.reduce((a, p) => Math.abs(p.x) < Math.abs(a.x) ? p : a);
    metrics.set([
      { k: 'Peak heat flux', v: (pk.q / 1e6).toFixed(1) + ' MW/m²', s: `${(pk.x * 100).toFixed(1)} cm ${pk.x < 0 ? 'before' : 'after'} the throat` },
      { k: 'h_g at throat', v: (th.hg / 1000).toFixed(1) + ' kW/m²K', s: `σ ${th.sigma.toFixed(2)}`, tip: 'Gas-side convective coefficient.' },
      { k: 'Adiabatic wall T', v: th.Taw.toFixed(0) + ' K', s: `recovery r ${B.rec.toFixed(3)}` },
      { k: 'Heat into the coolant', v: (B.Q / 1e6).toFixed(B.Q < 1e7 ? 2 : 1) + ' MW', s: B.Q < B.Qall * 0.999 ? `cooled to A/At ${B.epsCool.toFixed(0)}; ${((B.Qall - B.Q) / 1e6).toFixed(1)} MW radiated` : `${(B.Qconv / B.Q * 100).toFixed(0)}% upstream of the throat` },
      { k: 'Coolant flow', v: B.mc.toFixed(B.mc < 10 ? 2 : 1) + ' kg/s', s: propLabel(B.coolant) },
      { k: 'Coolant temperature rise', v: B.dT.toFixed(0) + ' K', s: `${B.Tin.toFixed(0)} → ${B.Tout.toFixed(0)} K`, cls: B.Tout > B.cprop.Tmax ? 'bad' : '' },
      { k: 'ΔT through the liner', v: (pk.q * C.t / 1000 / B.k).toFixed(0) + ' K', s: `${liner.label.split(' (')[0]}, ${C.t.toFixed(2)} mm`, cls: pk.Twc < B.Tout ? 'bad' : '' },
      { k: 'Gas properties', v: `Pr ${B.Pr.toFixed(3)}`, s: `μ ${(B.mu0 * 1e5).toFixed(2)}×10⁻⁵ Pa·s, cp ${(B.cp0 / 1000).toFixed(2)} kJ/kgK` },
    ]);
    view.set({ D, B, mode: 'q', plume: false, coolX: B.xCool });
    const xs = B.pts.map(p => p.x * 100);
    qPlot.setData({ series: [{ x: xs, y: B.pts.map(p => p.q / 1e6), color: css('--bad'), label: 'q', extra: i => `h_g ${(B.pts[i].hg / 1000).toFixed(2)} kW/m²K · A/At ${B.pts[i].eps.toFixed(2)}` }], vlines: [{ x: 0, color: css('--text-3') }] });
    tPlot.setData({ series: [
      { x: xs, y: B.pts.map(p => p.Taw), color: css('--lower'), label: 'adiabatic wall' },
      { x: xs, y: B.pts.map(() => C.Twg), color: css('--warn'), label: 'gas-side wall', dash: [5, 4] },
      { x: xs, y: B.pts.map(p => p.Twc), color: css('--upper'), label: 'coolant-side wall' },
      { x: xs, y: B.pts.map(p => p.Trad), color: css('--turb'), label: 'uncooled (radiating)' },
    ], hlines: [{ y: liner.Tmax, color: css('--text-3'), label: `${liner.label.split(' (')[0]} limit ${liner.Tmax} K` }], vlines: [{ x: 0, color: css('--text-3') }] });
    // where can a radiative extension start? first point downstream where radiating wall T < niobium limit
    const nb = R.LINERS.niobium.Tmax, rad = radPt;
    const L = [];
    L.push(B.Tout > B.cprop.Tmax
      ? { type: 'b', t: `${propLabel(B.coolant)} would overheat`, d: `Absorbing ${(B.Q / 1e6).toFixed(1)} MW raises the coolant to ${B.Tout.toFixed(0)} K, above its ${B.cprop.Tmax} K limit (${B.cprop.note}). Options: film cooling, a radiative or ablative nozzle extension, or a higher Pc (smaller engine, less wall area per kg/s).` }
      : { type: 'g', t: `${propLabel(B.coolant)} can absorb the heat`, d: `The coolant warms by ${B.dT.toFixed(0)} K to ${B.Tout.toFixed(0)} K (limit ≈ ${B.cprop.Tmax} K, ${B.cprop.note}). The heat goes back into the chamber with the propellant, so it is not lost.` });
    if (pk.Twc < B.Tout) L.push({ type: 'w', t: 'Liner too thick or too poor a conductor', d: `At the peak the liner needs ${(pk.q * C.t / 1000 / B.k).toFixed(0)} K to conduct the heat, leaving the coolant side at ${pk.Twc.toFixed(0)} K, colder than the coolant itself. Use a thinner wall or a copper alloy.` });
    if (C.Twg > liner.Tmax) L.push({ type: 'b', t: 'Gas-side wall above the material limit', d: `${liner.label} is usable to about ${liner.Tmax} K.` });
    if (rad) L.push({ type: 'i', t: `Radiative cooling works beyond A/At ≈ ${rad.eps.toFixed(0)}`, d: `Downstream of ${len(rad.x)} past the throat an uncooled niobium wall would settle below ${nb} K by radiating to space — how Merlin Vacuum and RL10 nozzle extensions work. In the atmosphere, hot gas outside reduces this margin.` });
    else L.push({ type: 'i', t: 'No radiatively cooled section possible', d: 'Even at the exit an uncooled wall would get hotter than a niobium extension can stand; the whole nozzle must be cooled.' });
    L.push({ type: 'i', t: 'Model limits', d: 'Bartz with the Eucken Prandtl number and an empirical viscosity fit is accurate to roughly ±30%; real engines also use film cooling at the injector and the throat, which this does not include.' });
    insightsList(insEl, L);
  };

  let visible = false, dirty = true;
  store.subs.add(() => { if (visible) { build(); paint(); } else dirty = true; });
  build();
  return {
    controls, main,
    show() { visible = true; build(); paint(); dirty = false; },
    hide() { visible = false; },
    destroy() { view.destroy(); },
  };
}
