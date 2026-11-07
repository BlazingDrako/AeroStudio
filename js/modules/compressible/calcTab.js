// Calculator: solve isentropic, normal/oblique shock, Prandtl–Meyer, Fanno, Rayleigh and pitot problems
// from any one known quantity, with the substituted equations shown step by step.
import { h, section, segmented, select, field, info, parseNum } from '../../lib/ui.js';
import { Plot } from '../../lib/plot.js';
import * as G from '../../solvers/gasdyn.js';
import { gasPicker, card, fmt } from './common.js';

const { isen, DEG, fanno, rayleigh } = G;
const f4 = v => fmt(v, 4), f5 = v => fmt(v, 5), d3 = r => isFinite(r) ? (r / DEG).toFixed(3) + '°' : '—';

const REL = {
  isen: { label: 'Isentropic flow', givens: [['M', 'Mach number M'], ['T', 'T/T₀'], ['p', 'p/p₀'], ['rho', 'ρ/ρ₀'], ['Asub', 'A/A* (subsonic)'], ['Asup', 'A/A* (supersonic)'], ['mu', 'Mach angle μ (deg)'], ['nu', 'Prandtl–Meyer ν (deg)']] },
  normal: { label: 'Normal shock', givens: [['M1', 'Upstream M₁'], ['M2', 'Downstream M₂'], ['p2_p1', 'p₂/p₁'], ['rho2_rho1', 'ρ₂/ρ₁'], ['T2_T1', 'T₂/T₁'], ['p02_p01', 'p₀₂/p₀₁'], ['p1_p02', 'p₁/p₀₂'], ['p02_p1', 'p₀₂/p₁ (pitot)']] },
  oblique: { label: 'Oblique shock', givens: [['theta', 'M₁ and deflection θ'], ['beta', 'M₁ and shock angle β'], ['Mn1', 'M₁ and normal Mach Mn₁'], ['tb', 'θ and β → find M₁']] },
  pm: { label: 'Prandtl–Meyer expansion', givens: [['turn', 'M₁ and turn angle Δθ'], ['M2', 'M₁ and M₂ → find Δθ'], ['p2', 'M₁ and p₂/p₁ → find M₂'], ['nu', 'ν (deg) → M']] },
  fanno: { label: 'Fanno (friction)', givens: [['M', 'Mach number M'], ['duct', 'M₁ and 4fL/D → M₂'], ['fLsub', '4fL*/D (subsonic)'], ['fLsup', '4fL*/D (supersonic)'], ['Tst', 'T/T*'], ['pst', 'p/p*'], ['p0sub', 'p₀/p₀* (subsonic)'], ['p0sup', 'p₀/p₀* (supersonic)']] },
  rayleigh: { label: 'Rayleigh (heat addition)', givens: [['M', 'Mach number M'], ['heat', 'M₁ and T₀₂/T₀₁ → M₂'], ['T0sub', 'T₀/T₀* (subsonic)'], ['T0sup', 'T₀/T₀* (supersonic)'], ['pst', 'p/p*'], ['p0sub', 'p₀/p₀* (subsonic)'], ['p0sup', 'p₀/p₀* (supersonic)']] },
  pitot: { label: 'Pitot tube → Mach', givens: [['p0p', 'p_pitot / p_static'], ['pp0', 'p_static / p_pitot']] },
};
// which inputs each mode needs: [key, label, default]
const INPUTS = {
  'isen': g => [[g, REL.isen.givens.find(x => x[0] === g)[1], { M: 2, T: 0.5, p: 0.5283, rho: 0.5, Asub: 2, Asup: 2, mu: 30, nu: 26.38 }[g]]],
  'normal': g => [[g, REL.normal.givens.find(x => x[0] === g)[1], { M1: 2, M2: 0.6, p2_p1: 4.5, rho2_rho1: 2.5, T2_T1: 1.5, p02_p01: 0.8, p1_p02: 0.2, p02_p1: 5.64 }[g]]],
  'oblique': g => g === 'tb' ? [['th', 'Deflection θ (deg)', 20], ['b', 'Shock angle β (deg)', 40]] : [['M1', 'Upstream M₁', 3], [g, { theta: 'Deflection θ (deg)', beta: 'Shock angle β (deg)', Mn1: 'Normal Mach Mn₁' }[g], { theta: 20, beta: 40, Mn1: 1.8 }[g]]],
  'pm': g => g === 'nu' ? [['nu', 'ν (deg)', 26.38]] : [['M1', 'Upstream M₁', 1.5], [g, { turn: 'Turn angle Δθ (deg)', M2: 'Downstream M₂', p2: 'p₂/p₁' }[g], { turn: 20, M2: 2.5, p2: 0.4 }[g]]],
  'fanno': g => g === 'duct' ? [['M1', 'Inlet M₁', 0.3], ['fL', 'Duct 4fL/D', 1.5]] : [[g, REL.fanno.givens.find(x => x[0] === g)[1], { M: 0.5, fLsub: 1, fLsup: 0.3, Tst: 1.1, pst: 2, p0sub: 1.5, p0sup: 1.5 }[g]]],
  'rayleigh': g => g === 'heat' ? [['M1', 'Inlet M₁', 0.2], ['r', 'T₀₂/T₀₁', 3]] : [[g, REL.rayleigh.givens.find(x => x[0] === g)[1], { M: 0.5, T0sub: 0.6, T0sup: 0.8, pst: 1.5, p0sub: 1.1, p0sup: 1.3 }[g]]],
  'pitot': g => [[g, g === 'p0p' ? 'p_pitot / p_static' : 'p_static / p_pitot', g === 'p0p' ? 3 : 0.3]],
};

const EXAMPLES = [
  { t: 'Normal shock at M₁ = 2.5 in air at 50 kPa, 220 K. Find M₂, p₂, T₂ and the p₀ loss.', rel: 'normal', given: 'M1', v: { M1: 2.5 }, p: 50, T: 220 },
  { t: 'A pitot tube in a supersonic stream reads 270 kPa; static pressure is 40 kPa. Find M.', rel: 'pitot', given: 'p0p', v: { p0p: 6.75 }, p: 40, T: 220 },
  { t: 'A 15° wedge in Mach 3 air (100 kPa, 250 K). Find β, M₂ and p₂.', rel: 'oblique', given: 'theta', v: { M1: 3, theta: 15 }, p: 100, T: 250 },
  { t: 'Flow at M = 1.8 turns 20° around a convex corner. Find M₂ and p₂/p₁.', rel: 'pm', given: 'turn', v: { M1: 1.8, turn: 20 } },
  { t: 'What area ratio gives an exit Mach number of 2.8? (isentropic)', rel: 'isen', given: 'M', v: { M: 2.8 } },
  { t: 'A nozzle has A/A* = 5. Find the supersonic exit Mach and p/p₀.', rel: 'isen', given: 'Asup', v: { Asup: 5 } },
  { t: 'At what Mach number does p/p₀ = 0.5283? (the critical pressure ratio)', rel: 'isen', given: 'p', v: { p: 0.5283 } },
  { t: 'Air enters a duct at M = 0.3 with 4fL/D = 1.5. Find the exit Mach; is it choked?', rel: 'fanno', given: 'duct', v: { M1: 0.3, fL: 1.5 } },
  { t: 'Combustor: M₁ = 0.2 and heating triples T₀. Find M₂.', rel: 'rayleigh', given: 'heat', v: { M1: 0.2, r: 3 } },
  { t: 'Downstream of a normal shock M₂ = 0.5. What was M₁?', rel: 'normal', given: 'M2', v: { M2: 0.5 } },
  { t: 'C-D nozzle, Ae/At = 2, pb/p₀ = 0.7: where is the shock? (opens Nozzles tab)', go: ['nozzle', { type: 'conical', eps: 2, pb: 0.7, gas: 'air', g: 1.4, R: 287.05 }] },
  { t: 'M = 2 flow over a 25° wedge — attached or detached? (opens θ–β–M chart)', go: ['tbm', { M: 2, theta: 25 }] },
];

export function calcTab(shell) {
  const S = (shell.keep || (o => o))({ rel: 'normal', given: 'M1', vals: {}, g: 1.4, R: 287.05, gas: 'air', p: '', T: '', branch: 'weak' });
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });
  const secR = section('Problem type');
  const relSel = select(Object.entries(REL).map(([k, r]) => ({ value: k, label: r.label })), S.rel, v => { S.rel = v; S.given = REL[v].givens[0][0]; S.vals = {}; build(); solve(); });
  const givenSel = h('select', { class: 'select' });
  givenSel.addEventListener('change', () => { S.given = givenSel.value; S.vals = {}; buildInputs(); solve(); });
  const inputsEl = h('div');
  const branchSeg = segmented([{ value: 'weak', label: 'Weak' }, { value: 'strong', label: 'Strong' }], 'weak', v => { S.branch = v; solve(); });
  const branchF = field('Oblique-shock branch', branchSeg.el, 'Two shock angles turn the flow by the same θ. Weak is what you normally see.');
  secR.body.append(field('Relation', relSel), field('What do you know?', givenSel), inputsEl, branchF, gasPicker(S, () => solve()));
  const secD = section('Dimensional values (optional)');
  const pIn = h('input', { class: 'text-input', placeholder: 'e.g. 101.325', inputmode: 'decimal' }), TIn = h('input', { class: 'text-input', placeholder: 'e.g. 288.15', inputmode: 'decimal' });
  pIn.addEventListener('input', () => { S.p = pIn.value; solve(); }); TIn.addEventListener('input', () => { S.T = TIn.value; solve(); });
  const dimHint = h('div', { class: 'hint' });
  secD.body.append(field('Static pressure (state 1) kPa', pIn), field('Static temperature (state 1) K', TIn), dimHint);
  const secE = section('Worked examples', { collapsible: true });
  const exl = h('div', { class: 'example-list' });
  for (const e of EXAMPLES) { const b = h('button', { type: 'button' }, e.t); b.addEventListener('click', () => loadExample(e)); exl.append(b); }
  secE.body.append(exl);
  controls.append(secR.el, secD.el, secE.el);

  const status = h('div', { class: 'row', style: { flexWrap: 'wrap' } });
  const resCard = card('Results', 'Every quantity for this state. Ratios are to stagnation (₀), sonic (*) or upstream (₁) values as labelled.');
  const resEl = h('div', { class: 'cf-res' }); resCard.append(resEl);
  const dimCard = card('Dimensional values', 'From the static p and T you entered for state 1, using the gas constant R.');
  const dimEl = h('div', { class: 'cf-res' }); dimCard.append(dimEl);
  const stepCard = card('Step by step', 'The equations used, with your numbers substituted. Copy into your homework at your own risk.');
  const stepEl = h('div', { class: 'cf-steps' }); stepCard.append(stepEl);
  const plotCard = card('Where this sits', 'The relation\'s ratios across Mach number; the vertical line marks your solution.');
  const plot = new Plot(plotCard, { xlabel: 'Mach number', ylabel: 'ratio', xname: 'M', yname: 'value', xfmt: v => v.toFixed(3), yfmt: v => v.toPrecision(4) });
  const openBtn = h('button', { class: 'btn sm' }, 'Visualize this →');
  openBtn.addEventListener('click', () => S.visual && shell.go(S.visual[0], S.visual[1]));
  main.append(h('div', { class: 'row' }, status, h('div', { class: 'grow' }), openBtn), resCard, dimCard, h('div', { class: 'cf-grid2' }, stepCard, plotCard));

  function build() {
    relSel.value = S.rel;
    givenSel.replaceChildren(...REL[S.rel].givens.map(([k, l]) => h('option', { value: k }, l)));
    givenSel.value = S.given; buildInputs();
  }
  function buildInputs() {
    const list = INPUTS[S.rel](S.given);
    inputsEl.replaceChildren();
    for (const [k, l, d] of list) {
      if (S.vals[k] === undefined) S.vals[k] = d;
      const inp = h('input', { class: 'text-input', value: S.vals[k], inputmode: 'decimal', 'aria-label': l });
      inp.addEventListener('input', () => { S.vals[k] = parseNum(inp.value); solve(); });
      inputsEl.append(field(l, inp));
    }
    branchF.style.display = S.rel === 'oblique' && S.given !== 'tb' ? '' : 'none';
  }
  function loadExample(e) {
    if (e.go) { shell.go(e.go[0], e.go[1]); return; }
    S.rel = e.rel; S.given = e.given; S.vals = { ...e.v };
    pIn.value = S.p = e.p ?? ''; TIn.value = S.T = e.T ?? '';
    build(); solve();
  }

  function solve() {
    const g = S.g, V = S.vals, steps = [], R = [], D = [];
    let err = null, Msol = NaN, plotFn = null, visual = null;
    const row = (k, v, hl) => R.push([k, v, hl]);
    const st = (...lines) => steps.push(...lines);
    const gm = (g - 1) / 2;
    try {
      if (S.rel === 'isen' || S.rel === 'pitot') {
        let M;
        if (S.rel === 'pitot') {
          const r = S.given === 'p0p' ? V.p0p : 1 / V.pp0;
          const crit = isen.p0_p(1, g);
          st(`Given p_pitot/p = ${f4(r)}. Sonic value of p₀/p = ((γ+1)/2)^(γ/(γ−1)) = ${f4(crit)}.`);
          if (r < 1) throw 'A pitot reading must be ≥ the static pressure.';
          if (r <= crit) { M = G.M_from_p(1 / r, g); st('Ratio below sonic value → subsonic: the probe reads the true p₀.', `p₀/p = (1 + (γ−1)/2·M²)^(γ/(γ−1))  ⇒  M = √{ [ (p₀/p)^((γ−1)/γ) − 1 ] · 2/(γ−1) } = ${f4(M)}`); }
          else {
            M = G.machFromPitot(r, g);
            const ns = G.normalShock(M, g);
            st('Ratio above sonic value → supersonic: a bow shock stands ahead of the probe; it reads p₀₂.', 'Rayleigh pitot formula:', `p₀₂/p₁ = [ (γ+1)²M₁² / (4γM₁² − 2(γ−1)) ]^(γ/(γ−1)) · [ (1 − γ + 2γM₁²)/(γ+1) ]`, `Solved by bisection: M₁ = ${f4(M)}  (check: p₀₂/p₁ = ${f4(ns.p02_p1)})`, `Behind the shock: M₂ = ${f4(ns.M2)}, p₀₂/p₀₁ = ${f4(ns.p02_p01)}`);
            row('Behind probe shock M₂', f4(ns.M2)); row('p₀₂/p₀₁', f4(ns.p02_p01)); row('True p₀₁/p₁', f4(isen.p0_p(M, g)));
            visual = ['waves', { id: 'blunt', M }];
          }
          row('Mach number M', f5(M), true);
        } else {
          const gv = V[S.given];
          switch (S.given) {
            case 'M': M = gv; break;
            case 'T': M = G.M_from_T(gv, g); st(`T/T₀ = ${f4(gv)}  ⇒  M = √[ (T₀/T − 1)·2/(γ−1) ]`); break;
            case 'p': M = G.M_from_p(gv, g); st(`p/p₀ = ${f4(gv)}  ⇒  T/T₀ = (p/p₀)^((γ−1)/γ) = ${f4(gv ** ((g - 1) / g))}  ⇒  M = √[ (T₀/T − 1)·2/(γ−1) ]`); break;
            case 'rho': M = G.M_from_rho(gv, g); st(`ρ/ρ₀ = ${f4(gv)}  ⇒  T/T₀ = (ρ/ρ₀)^(γ−1)  ⇒  M`); break;
            case 'Asub': case 'Asup': M = G.M_from_A(gv, g, S.given === 'Asup'); st(`A/A* = ${f4(gv)} has two roots; taking the ${S.given === 'Asup' ? 'supersonic' : 'subsonic'} one by bisection.`); break;
            case 'mu': M = 1 / Math.sin(gv * DEG); st(`μ = asin(1/M)  ⇒  M = 1/sin(${gv}°)`); break;
            case 'nu': M = G.M_from_nu(gv * DEG, g); st(`ν = ${gv}° ⇒ M by inverting the Prandtl–Meyer function (bisection).`); break;
          }
          if (!(M > 0) || !isFinite(M)) throw 'No real Mach number gives that value. Check the input range (e.g. ratios must be between 0 and 1, A/A* ≥ 1).';
          const a = G.isentropicAll(M, g);
          st(`T₀/T = 1 + (γ−1)/2·M² = 1 + ${fmt(gm, 3)}·${f4(M)}² = ${f4(1 / a.T_T0)}`, `p₀/p = (T₀/T)^(γ/(γ−1)) = ${f4(1 / a.p_p0)}`, `ρ₀/ρ = (T₀/T)^(1/(γ−1)) = ${f4(1 / a.rho_rho0)}`, `A/A* = (1/M)·[ (2/(γ+1))(1 + (γ−1)/2·M²) ]^((γ+1)/(2(γ−1))) = ${f4(a.A_As)}`);
          if (M >= 1) st(`μ = asin(1/M) = ${d3(a.mu)}`, `ν = √((γ+1)/(γ−1))·atan√((γ−1)(M²−1)/(γ+1)) − atan√(M²−1) = ${d3(a.nu)}`);
          row('Mach number M', f5(M), true); row('T/T₀', f5(a.T_T0)); row('p/p₀', f5(a.p_p0)); row('ρ/ρ₀', f5(a.rho_rho0)); row('A/A*', f5(a.A_As), true);
          row('T/T*', f5(a.Ts)); row('p/p*', f5(a.ps)); row('Mach angle μ', d3(a.mu)); row('Prandtl–Meyer ν', d3(a.nu)); row('Mass-flow param ṁ√(RT₀)/(p₀A)', f5(a.mfp));
          visual = ['nozzle', { type: 'conical', eps: Math.max(1.05, M >= 1 ? a.A_As : 2), g, R: S.R, gas: S.gas, pb: M >= 1 ? a.p_p0 : 0.9 }];
        }
        Msol = M;
        plotFn = M => ({ 'p/p₀': 1 / isen.p0_p(M, g), 'T/T₀': 1 / isen.T0_T(M, g), 'ρ/ρ₀': 1 / isen.r0_r(M, g), 'A*/A': 1 / isen.A_As(M, g) });
        dims(M, null);
      } else if (S.rel === 'normal') {
        const M1 = G.normalShockFrom(S.given, V[S.given], g);
        if (!(M1 >= 1)) throw S.given === 'M2' ? `M₂ must lie between √((γ−1)/(2γ)) = ${f4(Math.sqrt((g - 1) / (2 * g)))} and 1.` : 'No normal shock gives that value (upstream flow must be supersonic; ratios must be in range).';
        const n = G.normalShock(M1, g);
        if (S.given !== 'M1') st(`Inverting the given ${REL.normal.givens.find(x => x[0] === S.given)[1]} = ${f4(V[S.given])} gives M₁ = ${f5(M1)}.`);
        st(`M₂² = [1 + (γ−1)/2·M₁²] / [γM₁² − (γ−1)/2] = [1 + ${fmt(gm, 3)}·${f4(M1 * M1)}] / [${fmt(g, 3)}·${f4(M1 * M1)} − ${fmt(gm, 3)}]  ⇒  M₂ = ${f4(n.M2)}`,
          `p₂/p₁ = 1 + 2γ/(γ+1)·(M₁² − 1) = ${f4(n.p2_p1)}`, `ρ₂/ρ₁ = (γ+1)M₁² / [(γ−1)M₁² + 2] = ${f4(n.rho2_rho1)}   (= u₁/u₂)`,
          `T₂/T₁ = (p₂/p₁)/(ρ₂/ρ₁) = ${f4(n.T2_T1)}`, `p₀₂/p₀₁ = (ρ₂/ρ₁)^(γ/(γ−1)) · (p₁/p₂)^(1/(γ−1)) = ${f4(n.p02_p01)}`, `Δs/R = −ln(p₀₂/p₀₁) = ${f4(n.ds_R)}`, `p₀₂/p₁ = (p₂/p₁)·(p₀/p)|M₂ = ${f4(n.p02_p1)}  (pitot reading)`);
        row('Upstream M₁', f5(M1), true); row('Downstream M₂', f5(n.M2), true); row('p₂/p₁', f5(n.p2_p1)); row('ρ₂/ρ₁ = u₁/u₂', f5(n.rho2_rho1)); row('T₂/T₁', f5(n.T2_T1));
        row('p₀₂/p₀₁', f5(n.p02_p01), true); row('p₀ loss', (100 * (1 - n.p02_p01)).toFixed(3) + '%'); row('p₀₂/p₁ (pitot)', f5(n.p02_p1)); row('p₁/p₀₂', f5(n.p1_p02)); row('Δs/R', f5(n.ds_R)); row('A₂*/A₁*', f5(1 / n.p02_p01));
        Msol = M1;
        plotFn = M => { const q = G.normalShock(M, g); return q ? { 'M₂': q.M2, 'p₀₂/p₀₁': q.p02_p01, 'ρ₂/ρ₁ ÷ 6': q.rho2_rho1 / 6, 'T₂/T₁ ÷ 5': q.T2_T1 / 5 } : {}; };
        dims(M1, { M: n.M2, p: n.p2_p1, T: n.T2_T1, p0: n.p02_p01 });
        visual = ['waves', { id: 'normal', M: M1 }];
      } else if (S.rel === 'oblique') {
        let M1, beta, theta;
        if (S.given === 'tb') {
          theta = V.th * DEG; beta = V.b * DEG; M1 = G.machFromThetaBeta(theta, beta, g);
          st('M₁² = 2(cot β + tan θ) / [sin 2β − tan θ·(γ + cos 2β)]', `     = ${f4(M1 * M1)}  ⇒  M₁ = ${f4(M1)}`);
          if (!(M1 > 1)) throw 'No supersonic Mach number gives that θ–β pair (need β > θ and β > μ).';
        } else {
          M1 = V.M1;
          if (!(M1 > 1)) throw 'Oblique shocks need supersonic upstream flow (M₁ > 1).';
          if (S.given === 'theta') {
            theta = V.theta * DEG; beta = G.betaFromTheta(M1, theta, g, S.branch);
            st('θ–β–M relation:  tan θ = 2 cot β · (M₁² sin²β − 1) / [M₁²(γ + cos 2β) + 2]', `θmax at M₁ = ${f4(M1)} is ${d3(G.thetaMax(M1, g))} (at β = ${d3(G.betaMax(M1, g))}).`);
            if (!isFinite(beta)) throw `Detached shock: θ = ${V.theta}° exceeds θmax = ${d3(G.thetaMax(M1, g))}. No attached oblique shock exists — a curved bow shock forms instead.`;
            st(`Solving for the ${S.branch} root by bisection: β = ${d3(beta)}  (other root: ${d3(G.betaFromTheta(M1, theta, g, S.branch === 'weak' ? 'strong' : 'weak'))})`);
          } else if (S.given === 'beta') {
            beta = V.beta * DEG;
            if (beta < Math.asin(1 / M1) || beta > Math.PI / 2) throw `β must lie between the Mach angle μ = ${d3(Math.asin(1 / M1))} and 90°.`;
            theta = G.thetaFromBeta(M1, beta, g); st(`tan θ = 2 cot β · (M₁² sin²β − 1) / [M₁²(γ + cos 2β) + 2]  ⇒  θ = ${d3(theta)}`);
          } else {
            if (V.Mn1 < 1 || V.Mn1 > M1) throw 'Mn₁ must be between 1 and M₁.';
            beta = Math.asin(V.Mn1 / M1); theta = G.thetaFromBeta(M1, beta, g); st(`β = asin(Mn₁/M₁) = ${d3(beta)}, θ = ${d3(theta)}`);
          }
        }
        const o = G.obliqueShock(M1, beta, g);
        st(`Mn₁ = M₁ sin β = ${f4(o.Mn1)}  → normal-shock relations with Mn₁:`, `Mn₂ = ${f4(o.Mn2)},  p₂/p₁ = 1 + 2γ/(γ+1)(Mn₁² − 1) = ${f4(o.p2_p1)}`, `M₂ = Mn₂ / sin(β − θ) = ${f4(o.Mn2)} / sin(${d3(beta - theta)}) = ${f4(o.M2)}`, `p₀₂/p₀₁ = ${f4(o.p02_p01)}`);
        row('Upstream M₁', f5(M1), true); row('Deflection θ', d3(theta), true); row('Shock angle β', d3(beta), true); row('Branch', beta > G.betaMax(M1, g) ? 'strong' : 'weak');
        row('Mn₁', f5(o.Mn1)); row('Mn₂', f5(o.Mn2)); row('Downstream M₂', f5(o.M2), true); row('p₂/p₁', f5(o.p2_p1)); row('ρ₂/ρ₁', f5(o.rho2_rho1)); row('T₂/T₁', f5(o.T2_T1)); row('p₀₂/p₀₁', f5(o.p02_p01));
        row('θmax', d3(o.thetaMax)); row('Mach angle μ₁', d3(o.mu1));
        Msol = M1;
        plotFn = M => { if (M <= 1) return {}; const b = G.betaFromTheta(M, theta, g, 'weak'); return isFinite(b) ? { 'β (rad)': b, 'M₂': G.obliqueShock(M, b, g).M2, 'θmax (rad)': G.thetaMax(M, g) } : { 'θmax (rad)': G.thetaMax(M, g) }; };
        dims(M1, { M: o.M2, p: o.p2_p1, T: o.T2_T1, p0: o.p02_p01 });
        visual = ['tbm', { M: M1, theta: theta / DEG, branch: beta > G.betaMax(M1, g) ? 'strong' : 'weak' }];
      } else if (S.rel === 'pm') {
        let M1, M2, dth;
        if (S.given === 'nu') { M1 = G.M_from_nu(V.nu * DEG, g); st(`Invert ν(M) = ${V.nu}° ⇒ M = ${f4(M1)}`); row('Mach number M', f5(M1), true); row('Mach angle μ', d3(Math.asin(1 / M1))); row('ν_max', d3(isen.numax(g))); Msol = M1; }
        else {
          M1 = V.M1; if (!(M1 >= 1)) throw 'Prandtl–Meyer expansions need M₁ ≥ 1.';
          const nu1 = isen.nu(M1, g);
          st(`ν(M) = √((γ+1)/(γ−1))·atan√((γ−1)(M²−1)/(γ+1)) − atan√(M²−1)`, `ν₁ = ν(${f4(M1)}) = ${d3(nu1)}`);
          if (S.given === 'turn') { dth = V.turn * DEG; if (nu1 + dth >= isen.numax(g)) throw `Turn too large: ν₁ + Δθ exceeds ν_max = ${d3(isen.numax(g))} (expansion to vacuum).`; M2 = G.M_from_nu(nu1 + dth, g); st(`ν₂ = ν₁ + Δθ = ${d3(nu1 + dth)}  ⇒  M₂ = ${f4(M2)} (invert ν)`); }
          else if (S.given === 'M2') { M2 = V.M2; if (M2 < M1) throw 'An expansion increases Mach number: need M₂ > M₁ (otherwise it is a compression).'; dth = isen.nu(M2, g) - nu1; st(`ν₂ = ν(${f4(M2)}) = ${d3(isen.nu(M2, g))}  ⇒  Δθ = ν₂ − ν₁ = ${d3(dth)}`); }
          else { const r = V.p2; if (!(r > 0 && r < 1)) throw 'An expansion lowers pressure: need 0 < p₂/p₁ < 1.'; M2 = G.M_from_p(r / isen.p0_p(M1, g), g); dth = isen.nu(M2, g) - nu1; st(`p₂/p₀ = (p₂/p₁)(p₁/p₀) ⇒ M₂ = ${f4(M2)}, Δθ = ${d3(dth)}`); }
          const e = G.expansion(M1, dth, g);
          st(`p₂/p₁ = (p₀/p)|M₁ / (p₀/p)|M₂ = ${f4(e.p2_p1)}  (p₀ constant: isentropic)`, `Fan spans from μ₁ = ${d3(e.mu1)} (to the upstream flow) to μ₂ = ${d3(e.mu2)} (to the turned flow).`);
          row('Upstream M₁', f5(M1), true); row('Turn angle Δθ', d3(dth), true); row('Downstream M₂', f5(M2), true); row('ν₁', d3(nu1)); row('ν₂', d3(nu1 + dth)); row('p₂/p₁', f5(e.p2_p1)); row('T₂/T₁', f5(e.T2_T1)); row('ρ₂/ρ₁', f5(e.rho2_rho1)); row('μ₁ (fan head)', d3(e.mu1)); row('μ₂ (fan tail)', d3(e.mu2)); row('p₀₂/p₀₁', '1 (isentropic)');
          dims(M1, { M: M2, p: e.p2_p1, T: e.T2_T1, p0: 1 });
          visual = ['waves', { id: 'corner', M: M1, angle: dth / DEG }];
          Msol = M2;
        }
        plotFn = M => (M >= 1 ? { 'ν (rad)': isen.nu(M, g), 'μ (rad)': Math.asin(1 / M) } : {});
      } else if (S.rel === 'fanno' || S.rel === 'rayleigh') {
        const F = S.rel === 'fanno' ? fanno : rayleigh;
        let M, extra = null;
        const inv = (fn, v, sup) => G.invertBranch(fn, v, g, sup);
        if (S.rel === 'fanno') {
          switch (S.given) {
            case 'M': M = V.M; break;
            case 'fLsub': M = inv(fanno.fL, V.fLsub, false); break; case 'fLsup': M = inv(fanno.fL, V.fLsup, true); break;
            case 'Tst': M = invert1(fanno.T, V.Tst); break; case 'pst': M = invert1(fanno.p, V.pst); break;
            case 'p0sub': M = inv(fanno.p0, V.p0sub, false); break; case 'p0sup': M = inv(fanno.p0, V.p0sup, true); break;
            case 'duct': {
              const M1 = V.M1, f1 = fanno.fL(M1, g), f2 = f1 - V.fL;
              st(`4fL*/D at M₁ = ${f4(M1)}: ${f4(f1)}`, `4fL*/D at exit = ${f4(f1)} − ${f4(V.fL)} = ${f4(f2)}`);
              if (f2 < 0) { st(`Negative → the duct is longer than L* : the flow CHOKES. The inlet Mach must drop (subsonic) or a shock forms (supersonic) until 4fL*/D at the inlet equals ${f4(V.fL)}.`); const Mc = inv(fanno.fL, V.fL, M1 > 1); extra = { choked: true, M1, Mnew: Mc }; M = 1; }
              else { M = inv(fanno.fL, f2, M1 > 1); extra = { M1 }; st(`Invert ⇒ M₂ = ${f4(M)} (same branch as M₁; friction drives M toward 1)`); }
              break;
            }
          }
        } else {
          switch (S.given) {
            case 'M': M = V.M; break;
            case 'T0sub': M = inv(rayleigh.T0, V.T0sub, false); break; case 'T0sup': M = inv(rayleigh.T0, V.T0sup, true); break;
            case 'pst': M = invert1(rayleigh.p, V.pst); break;
            case 'p0sub': M = inv(rayleigh.p0, V.p0sub, false); break; case 'p0sup': M = inv(rayleigh.p0, V.p0sup, true); break;
            case 'heat': {
              const M1 = V.M1, t1 = rayleigh.T0(M1, g), t2 = t1 * V.r;
              st(`T₀/T₀* at M₁ = ${f4(M1)}: ${f4(t1)}`, `T₀₂/T₀* = ${f4(t1)} × ${f4(V.r)} = ${f4(t2)}`);
              if (t2 > 1) { st(`> 1 → more heat than the flow can absorb: THERMAL CHOKING. The most T₀ can rise at this M₁ is ×${f4(1 / t1)}; the inlet condition must change.`); M = 1; extra = { choked: true, M1 }; }
              else { M = inv(rayleigh.T0, t2, M1 > 1); extra = { M1 }; st(`Invert ⇒ M₂ = ${f4(M)} (heating drives M toward 1)`); }
              break;
            }
          }
        }
        function invert1(fn, v) { const a = inv(fn, v, false), b = inv(fn, v, true); const r = isFinite(a) ? a : b; if (isFinite(a) && isFinite(b)) st(`Note: both a subsonic (${f4(a)}) and supersonic (${f4(b)}) root exist; showing the first.`); return r; }
        if (!(M > 0) || !isFinite(M)) throw 'No Mach number on that branch gives this value (check the range).';
        const q = k => F[k](M, g);
        if (S.rel === 'fanno') {
          st(`T/T* = (γ+1)/(2 + (γ−1)M²) = ${f4(q('T'))}`, `p/p* = (1/M)√[(γ+1)/(2+(γ−1)M²)] = ${f4(q('p'))}`, `p₀/p₀* = (1/M)[(2+(γ−1)M²)/(γ+1)]^((γ+1)/(2(γ−1))) = ${f4(q('p0'))}`, `4fL*/D = (1−M²)/(γM²) + (γ+1)/(2γ)·ln[(γ+1)M²/(2+(γ−1)M²)] = ${f4(q('fL'))}`);
          row('Mach number M', f5(M), true); row('4fL*/D', f5(q('fL')), true); row('T/T*', f5(q('T'))); row('p/p*', f5(q('p'))); row('ρ/ρ*', f5(q('rho'))); row('p₀/p₀*', f5(q('p0'))); row('V/V*', f5(q('V')));
          plotFn = M => ({ 'T/T*': fanno.T(M, g), 'p/p* ÷ 3': fanno.p(M, g) / 3, 'p₀/p₀*': Math.min(4, fanno.p0(M, g)), '4fL*/D': Math.min(4, fanno.fL(M, g)) });
        } else {
          st(`p/p* = (1+γ)/(1+γM²) = ${f4(q('p'))}`, `T/T* = M²(1+γ)²/(1+γM²)² = ${f4(q('T'))}`, `T₀/T₀* = 2(γ+1)M²(1 + (γ−1)/2·M²)/(1+γM²)² = ${f4(q('T0'))}`, `p₀/p₀* = (1+γ)/(1+γM²)·[(2+(γ−1)M²)/(γ+1)]^(γ/(γ−1)) = ${f4(q('p0'))}`);
          row('Mach number M', f5(M), true); row('T₀/T₀*', f5(q('T0')), true); row('T/T*', f5(q('T'))); row('p/p*', f5(q('p'))); row('ρ/ρ*', f5(q('rho'))); row('p₀/p₀*', f5(q('p0'))); row('V/V*', f5(q('V')));
          plotFn = M => ({ 'T₀/T₀*': rayleigh.T0(M, g), 'T/T*': rayleigh.T(M, g), 'p/p* ÷ 2.4': rayleigh.p(M, g) / 2.4, 'p₀/p₀*': Math.min(2, rayleigh.p0(M, g)) });
        }
        if (extra) {
          row('Inlet M₁', f5(extra.M1), true);
          if (extra.choked) row('Status', 'CHOKED', true);
          else if (S.rel === 'fanno') { row('p₂/p₁', f5(fanno.p(M, g) / fanno.p(extra.M1, g))); row('T₂/T₁', f5(fanno.T(M, g) / fanno.T(extra.M1, g))); row('p₀₂/p₀₁', f5(fanno.p0(M, g) / fanno.p0(extra.M1, g))); dims(extra.M1, { M, p: fanno.p(M, g) / fanno.p(extra.M1, g), T: fanno.T(M, g) / fanno.T(extra.M1, g), p0: fanno.p0(M, g) / fanno.p0(extra.M1, g) }); }
          else { row('p₂/p₁', f5(rayleigh.p(M, g) / rayleigh.p(extra.M1, g))); row('T₂/T₁', f5(rayleigh.T(M, g) / rayleigh.T(extra.M1, g))); row('p₀₂/p₀₁', f5(rayleigh.p0(M, g) / rayleigh.p0(extra.M1, g))); dims(extra.M1, { M, p: rayleigh.p(M, g) / rayleigh.p(extra.M1, g), T: rayleigh.T(M, g) / rayleigh.T(extra.M1, g), p0: rayleigh.p0(M, g) / rayleigh.p0(extra.M1, g) }); }
        } else dims(M, null);
        Msol = M;
      }
    } catch (e) { err = typeof e === 'string' ? e : (e.message || String(e)); }

    S.visual = visual; openBtn.style.display = visual ? '' : 'none';
    status.replaceChildren(err ? h('span', { class: 'regime' }, h('span', { class: 'dot', style: { background: 'var(--bad)' } }), 'No solution') : h('span', { class: 'regime' }, h('span', { class: 'dot', style: { background: 'var(--good)' } }), REL[S.rel].label + ' · γ = ' + (+S.g.toFixed(4))));
    resEl.replaceChildren(...(err ? [h('div', { class: 'hint', style: { color: 'var(--bad)', gridColumn: '1/-1', fontSize: '13px' } }, err)] : R.map(([k, v, hl]) => h('div', { class: 'r' + (hl ? ' hl' : '') }, h('span', {}, k), h('span', {}, v)))));
    stepEl.replaceChildren(...[`γ = ${fmt(S.g, 4)},  (γ−1)/2 = ${fmt(gm, 4)}`, ...steps].map(s => h('div', {}, s)));
    dimCard.style.display = D.length ? '' : 'none';
    dimEl.replaceChildren(...D.map(([k, v, hl]) => h('div', { class: 'r' + (hl ? ' hl' : '') }, h('span', {}, k), h('span', {}, v))));
    dimHint.textContent = D.length ? '' : 'Enter p and T to get velocities, densities and dimensional pressures.';
    // plot
    if (plotFn && !err) {
      const lo = S.rel === 'normal' || S.rel === 'oblique' || S.rel === 'pm' ? 1.001 : 0.02, hi = Math.max(4, (Msol || 2) * 1.4);
      const xs = [], ser = {};
      for (let i = 0; i <= 300; i++) { const M = lo + (hi - lo) * i / 300; xs.push(M); const o = plotFn(M); for (const k in o) (ser[k] = ser[k] || new Array(i).fill(NaN)).push(o[k]); for (const k in ser) if (ser[k].length < i + 1) ser[k].push(NaN); }
      const css = getComputedStyle(document.documentElement), cols = ['--accent', '--lower', '--good', '--turb', '--bad'].map(c => css.getPropertyValue(c).trim());
      plot.setData({ series: Object.entries(ser).map(([k, y], i) => ({ x: xs, y, label: k, color: cols[i % cols.length] })), vlines: isFinite(Msol) ? [{ x: Msol, color: css.getPropertyValue('--text').trim(), dash: [4, 3] }] : [] });
      plotCard.style.display = '';
    } else plotCard.style.display = 'none';

    function dims(M1, down) {
      const p = parseNum(S.p), T = parseNum(S.T);
      if (!(p > 0 && T > 0)) return;
      const Rg = S.R, a = Math.sqrt(g * Rg * T), rho = p * 1000 / (Rg * T);
      const add = (k, v, hl) => D.push([k, v, hl]);
      add('Speed of sound a₁', a.toFixed(2) + ' m/s'); add('Velocity V₁', (M1 * a).toFixed(2) + ' m/s', true); add('Density ρ₁', rho.toFixed(4) + ' kg/m³');
      add('Stagnation p₀₁', (p * isen.p0_p(M1, g)).toFixed(3) + ' kPa'); add('Stagnation T₀', (T * isen.T0_T(M1, g)).toFixed(2) + ' K'); add('Dynamic pressure q₁', (0.5 * g * p * M1 * M1).toFixed(3) + ' kPa');
      if (down) {
        const T2 = T * down.T, a2 = Math.sqrt(g * Rg * T2), p2 = p * down.p;
        add('p₂', p2.toFixed(3) + ' kPa', true); add('T₂', T2.toFixed(2) + ' K', true); add('ρ₂', (p2 * 1000 / (Rg * T2)).toFixed(4) + ' kg/m³'); add('a₂', a2.toFixed(2) + ' m/s'); add('V₂', (down.M * a2).toFixed(2) + ' m/s', true); add('p₀₂', (p * isen.p0_p(M1, g) * down.p0).toFixed(3) + ' kPa');
        st(`Dimensional: a₁ = √(γRT₁) = √(${fmt(g, 3)}·${fmt(Rg, 2)}·${fmt(T, 2)}) = ${a.toFixed(2)} m/s,  V₁ = M₁a₁ = ${(M1 * a).toFixed(2)} m/s`, `p₂ = (p₂/p₁)·p₁ = ${f4(down.p)}·${fmt(p, 3)} = ${p2.toFixed(3)} kPa,  T₂ = ${f4(down.T)}·${fmt(T, 2)} = ${T2.toFixed(2)} K`);
      } else st(`Dimensional: a = √(γRT) = ${a.toFixed(2)} m/s,  V = M·a = ${(M1 * a).toFixed(2)} m/s,  p₀ = ${(p * isen.p0_p(M1, g)).toFixed(3)} kPa`);
    }
  }
  build(); solve();
  return { controls, main, load: p => { Object.assign(S, p); build(); solve(); } };
}
