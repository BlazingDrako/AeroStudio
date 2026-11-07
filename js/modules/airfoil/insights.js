// Plain-language observations generated from a solution, so every number has a story.

const f2 = v => v.toFixed(2), f3 = v => v.toFixed(3);

export function makeInsights(r) {
  const out = [];
  if (!r || !r.ok) {
    out.push({ k: 'b', t: 'No solution', d: r && r.error ? r.error : 'The solver could not find a solution for these settings.' });
    return out;
  }
  const c = r.coef;
  if (r.viscous && !r.conv) out.push({ k: 'b', t: 'Not fully converged', d: 'The coupled solver stopped before the residual reached tolerance, so numbers may be off. This is common near stall or at very low Reynolds numbers. Try a slightly smaller angle of attack and step toward this condition — each solve starts from the previous one.' });

  // lift
  if (r.viscous && c.cd > 0) {
    const LD = c.cl / c.cd;
    out.push({ k: 'g', t: `Lift-to-drag ratio ${LD.toFixed(0)}`, d: `cl = ${f3(c.cl)} and cd = ${c.cd.toFixed(5)}: for every unit of drag this section makes ${Math.abs(LD).toFixed(0)} units of lift. Gliders aim for the angle where this ratio peaks.` });
  } else {
    out.push({ k: 'i', t: `Lift coefficient ${f3(c.cl)}`, d: `Ideal (inviscid) flow: no friction, so drag is zero — a result known as d'Alembert's paradox. Switch to Viscous to add the boundary layer, drag and stall.` });
  }

  // suction peak
  const Iu = r.Is[1];
  if (Iu && Iu.length) {
    let im = Iu[0];
    for (const i of Iu) if (r.cp[i] < r.cp[im]) im = i;
    const xm = r.foil.x[im];
    out.push({ k: 'i', t: `Suction peak Cp = ${f2(r.cp[im])} at x/c = ${f2(xm)}`, d: `Air speeds up over the upper surface, so its pressure drops below ambient (negative Cp, blue in the field). That low pressure pulling up is most of the lift.${xm < 0.05 ? ' A sharp peak right at the nose means a strong adverse pressure gradient follows, which is what eventually causes leading-edge stall.' : ''}` });
  }

  if (r.stag) out.push({ k: 'i', t: `Stagnation point at x/c = ${r.stag.x.toFixed(4)}`, d: `Here the oncoming flow splits above and below and briefly comes to rest (Cp = +1, the highest pressure). ${r.stag.z < -1e-4 ? 'It sits slightly under the nose because of the positive angle of attack.' : r.stag.z > 1e-4 ? 'It sits slightly above the nose because the angle of attack is negative.' : ''}` });

  if (r.viscous && r.dist) {
    const d = r.dist;
    // transition
    const tr = r.transition;
    if (tr) {
      const desc = is => tr[is].x === null ? 'stays laminar to the trailing edge' : `at x/c = ${tr[is].x.toFixed(2)} (${tr[is].type === 'forced' ? 'tripped' : 'natural'})`;
      out.push({ k: 'i', t: 'Laminar → turbulent transition', d: `Upper surface ${desc(1)}; lower surface ${desc(0)}. Ahead of transition the boundary layer is smooth and laminar (low friction); after it, turbulent eddies mix in fast air, raising friction but helping the flow resist separation. Raise N-crit (quieter air) to delay transition.` });
    }
    // separation + bubbles
    for (let is = 0; is < 2; is++) {
      const Is = r.Is[is], side = is === 1 ? 'Upper' : 'Lower';
      let k = 0;
      while (k < Is.length) {
        if (d.cf[Is[k]] < 0 && r.foil.x[Is[k]] > 0.001) {
          const k0 = k; while (k < Is.length && d.cf[Is[k]] < 0) k++;
          const k1 = k - 1, x0 = r.foil.x[Is[k0]], x1 = r.foil.x[Is[k1]];
          const lamStart = !d.turb[Is[k0]], reattached = k < Is.length;
          if (lamStart && reattached) out.push({ k: 'w', t: `${side} laminar separation bubble, x/c ${f2(x0)}–${f2(x1)}`, d: 'The laminar boundary layer separates in the rising pressure, the detached shear layer turns turbulent, and the flow reattaches. Bubbles are typical at low Reynolds numbers (model aircraft, drones) and add drag.' });
          else if (!reattached && lamStart) out.push({ k: 'w', t: `${side} laminar separation from x/c = ${f2(x0)}`, d: 'This side stays laminar, and the fragile laminar layer separates in the pressure rise just ahead of the trailing edge. The region is short, so its effect on drag is small; tripping the boundary layer (Transition settings) would remove it.' });
          else if (!reattached) out.push({ k: 'w', t: `${side} trailing-edge separation from x/c = ${f2(x0)}`, d: 'The boundary layer runs out of momentum against the adverse pressure gradient and leaves the surface (skin friction goes negative — the flow near the wall reverses). As angle of attack grows this point creeps forward: that is how trailing-edge stall develops.' });
          else out.push({ k: 'w', t: `${side} separated region x/c ${f2(x0)}–${f2(x1)}`, d: 'Wall skin friction is negative here: the near-wall flow is reversed before reattaching.' });
        } else k++;
      }
    }
    // drag split
    if (c.cd > 0) {
      const ff = c.cdf / c.cd;
      out.push({ k: 'i', t: `Drag: ${(ff * 100).toFixed(0)}% friction, ${((1 - ff) * 100).toFixed(0)}% pressure`, d: 'Friction drag comes from shear in the boundary layer. Pressure (form) drag appears because the thickened boundary layer and wake keep the pressure from fully recovering at the tail. Separation makes pressure drag grow quickly.' });
    }
  }

  // compressibility
  if (r.Ma > 0) {
    let cpmin = Infinity; for (let i = 0; i < r.N; i++) cpmin = Math.min(cpmin, r.cp[i]);
    const g = 1.4, M = r.Ma, p = 1 + 0.5 * g * M * M * cpmin;
    const Ml = Math.sqrt(Math.max(0, 2 / (g - 1) * ((1 + 0.5 * (g - 1) * M * M) * p ** (-(g - 1) / g) - 1)));
    if (cpmin < r.cps) out.push({ k: 'b', t: `Local flow is supersonic (peak Mach ≈ ${Ml.toFixed(2)})`, d: `Cp drops below the critical value Cp* = ${f2(r.cps)} (yellow outline in the field). In reality a shock wave would form and drag would rise sharply (wave drag). The Kármán–Tsien correction used here is only valid below this "critical Mach number", so treat these results as approximate.` });
    else out.push({ k: 'i', t: `Subcritical: peak local Mach ≈ ${Ml.toFixed(2)}`, d: `Compressibility at freestream Mach ${M.toFixed(2)} is included with the Kármán–Tsien correction. Local flow stays below Mach 1 (Cp* = ${f2(r.cps)}), so no shocks are expected.` });
  }

  if (Math.abs(c.cm) > 1e-4) out.push({ k: 'i', t: `Pitching moment cm = ${c.cm.toFixed(4)}`, d: `About the quarter-chord point. ${c.cm < 0 ? 'Negative means nose-down — typical for cambered airfoils, which is why airplanes need a tail to balance.' : 'Positive means nose-up.'}` });
  return out;
}
