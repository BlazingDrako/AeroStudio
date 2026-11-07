// Inlets & shocks: design a 2-D supersonic inlet (pitot, N-ramp external compression with a terminal
// normal shock, or an all-oblique scramjet inlet) and see every shock, region and loss.
import { h, section, field, select, segmented } from '../../lib/ui.js';
import { Plot } from '../../lib/plot.js';
import * as G from '../../solvers/gasdyn.js';
import { milSpecRecovery, oswatitschRamps, analyzeInlet, inletGeometry } from '../../solvers/inlets.js';
import { bound, card, metricsGrid, insightsList, canvasBox, heat, rgb, fmt, put } from './common.js';

const DEG = Math.PI / 180;

export function inletTab({ keep = o => o } = {}) {
  const S = keep({ M0: 2.5, N: 2, design: 'opt', mode: 'ext', g: 1.4, ang: [8, 8, 8, 8] });
  const controls = h('div'), main = h('div', { class: 'cf-main-inner' });
  const metrics = metricsGrid();
  const box = canvasBox('cf-chart inlet-chart');
  const recCard = card('Total-pressure recovery vs Mach', 'Optimum (Oswatitsch) recovery for 0–4 oblique shocks followed by a normal shock, against the MIL-E-5008B standard. The dot is your inlet.');
  const recPlot = new Plot(recCard, { xlabel: 'Flight Mach M₀', ylabel: 'pt₂/pt₀', xname: 'M₀', yname: 'recovery', yfmt: v => v.toFixed(4) });
  const tblCard = card('Shock by shock'); const tbl = h('div', { class: 'table-wrap' }); tblCard.append(tbl);
  const insCard = card('Notes'); const insEl = h('div'); insCard.append(insEl);
  main.append(metrics.el, box.el, h('div', { class: 'cf-grid2b' }, recCard, tblCard), insCard);
  const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  const build = () => {
    const sec = section('Inlet');
    const modeSeg = segmented([{ value: 'ext', label: 'External compression' }, { value: 'scram', label: 'Scramjet (all-oblique)' }], S.mode, v => { S.mode = v; if (v === 'scram' && S.M0 < 4) S.M0 = 7; if (v === 'scram' && S.N < 1) S.N = 2; build(); run(); });
    modeSeg.el.classList.add('seg-wrap');
    const desSeg = segmented([{ value: 'opt', label: 'Optimum (Oswatitsch)' }, { value: 'man', label: 'Manual angles' }], S.design, v => { S.design = v; build(); run(); });
    desSeg.el.classList.add('seg-wrap');
    put(sec.body, field('Type', modeSeg.el),
      bound(S, 'M0', 'Flight Mach M₀', 1.05, S.mode === 'scram' ? 16 : 6, { step: 0.01, onInput: run }).el,
      bound(S, 'N', 'Oblique shocks (ramps)', S.mode === 'scram' ? 1 : 0, 4, { step: 1, digits: 0, onInput: () => { S.N = Math.round(S.N); build(); run(); } }).el,
      S.N > 0 ? field('Ramp angles', desSeg.el) : null);
    if (S.design === 'man') for (let i = 0; i < S.N; i++) put(sec.body, bound(S.ang, i, `Ramp ${i + 1} deflection`, 0.5, 30, { step: 0.1, digits: 1, unit: 'deg', onInput: run }).el);
    put(sec.body, bound(S, 'g', 'γ', 1.1, 1.67, { step: 0.01, digits: 3, onInput: run }).el);
    controls.replaceChildren(sec.el);
  };

  let R = null, pending = false;
  const run = () => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; compute(); }); };
  const compute = () => {
    const g = S.g;
    let thetas;
    if (S.design === 'opt' && S.mode === 'ext') thetas = oswatitschRamps(S.M0, S.N, g).thetas;
    else if (S.design === 'opt') {
      // scramjet: equal-strength shocks giving a static temperature rise of about ψ ≈ 6 total (or less at low Mach)
      const target = Math.min(6.5, 1 + 0.2 * S.M0 * S.M0 * 0.6);
      let lo = 1.0001, hi = S.M0;
      const res = Mn => { let M = S.M0, T = 1; const th = []; for (let k = 0; k < S.N; k++) { if (M <= Mn) return { T: Infinity, th }; const b = Math.asin(Mn / M), t = G.thetaFromBeta(M, b, g); th.push(t); const o = G.obliqueShock(M, b, g); M = o.M2; T *= o.T2_T1; } return { T, th }; };
      for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2, r = res(m); const tot = analyzeInlet(S.M0, r.th, { g, terminal: 'none' }); if (!tot.ok || tot.TRatio > target) hi = m; else lo = m; }
      thetas = res(lo).th;
    } else thetas = S.ang.slice(0, S.N).map(a => a * DEG);
    if (S.design === 'opt') thetas.forEach((t, i) => { S.ang[i] = +(t / DEG).toFixed(2); });
    R = analyzeInlet(S.M0, thetas, { g, terminal: S.mode === 'ext' ? 'normal' : 'none' });
    R.geo = inletGeometry(R);
    paint();
  };
  const paint = () => {
    const mil = milSpecRecovery(S.M0), last = R.regions[R.regions.length - 1];
    const ke = 1 - 2 / ((S.g - 1) * S.M0 * S.M0) * ((1 / R.recovery) ** ((S.g - 1) / S.g) - 1);
    metrics.set([
      { k: 'Recovery pt₂/pt₀', v: fmt(R.recovery, 4), s: R.ok ? `${((R.recovery / mil - 1) * 100).toFixed(1)}% vs MIL spec` : 'shock detached', cls: R.ok ? '' : 'bad', tip: 'Total-pressure recovery of the shock system (before subsonic diffuser losses).' },
      { k: 'MIL-E-5008B', v: fmt(mil, 4) },
      { k: S.mode === 'ext' ? 'Mach after shocks' : 'Mach into isolator', v: fmt(R.Mexit, 3) },
      { k: 'p / p₀ (static)', v: fmt(R.pRatio, 3) },
      { k: 'T / T₀ (static)', v: fmt(R.TRatio, 3), s: S.mode === 'scram' ? 'this is ψ for the cycle' : '' },
      { k: 'Kinetic-energy η', v: fmt(ke, 4), tip: 'η_KE: fraction of the freestream kinetic energy the compressed flow could recover by expanding back to p₀. Hypersonic designers use it instead of pt recovery.' },
      { k: 'Total turning', v: (R.turning / DEG).toFixed(2) + '°', tip: 'Flow turning on the ramps; the cowl must be angled to match, which adds cowl drag.' },
    ]);
    // table
    const head = ['#', 'Shock', 'M upstream', 'θ', 'β', 'Mn', 'p₀₂/p₀₁', 'cumulative'];
    let cum = 1;
    tbl.replaceChildren(h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ...head.map(x => h('th', {}, x)))), h('tbody', {}, ...R.shocks.map((s, i) => { cum *= s.p02; const Mn = s.kind === 'normal' ? s.Mup : s.Mup * Math.sin(s.beta); return h('tr', {}, h('td', {}, i + 1), h('td', { style: { fontFamily: 'var(--font)' } }, s.kind), h('td', {}, fmt(s.Mup, 3)), h('td', {}, s.theta ? (s.theta / DEG).toFixed(2) + '°' : '—'), h('td', {}, s.beta ? (s.beta / DEG).toFixed(2) + '°' : '90°'), h('td', {}, fmt(Mn, 3)), h('td', {}, fmt(s.p02, 4)), h('td', {}, fmt(cum, 4))); }))));
    // notes
    const list = [];
    if (!R.ok) list.push({ type: 'b', t: 'Shock detached', d: R.note });
    if (S.mode === 'ext') {
      const ns = R.shocks.find(s => s.kind === 'normal');
      if (ns) list.push({ type: ns.Mup > 1.4 ? 'w' : 'g', t: `Terminal normal shock at M = ${ns.Mup.toFixed(2)}`, d: ns.Mup > 1.35 ? 'Above about M 1.3–1.4 the normal shock separates the boundary layer on the ramp; add a ramp or use bleed.' : 'Weak enough to avoid shock-induced separation.' });
      list.push({ type: 'i', t: 'Shock-on-lip design', d: 'All oblique shocks focus on the cowl lip at the design Mach, so the inlet captures its full streamtube with no spillage. Off-design, shocks move and air spills (lower Mach) or enters the duct (higher Mach).' });
    } else {
      list.push({ type: R.Mexit > 1 ? 'g' : 'b', t: `Isolator entry M = ${R.Mexit.toFixed(2)}`, d: 'A scramjet keeps the flow supersonic; the isolator protects the inlet from the combustor pressure rise (a pre-combustion shock train).' });
      list.push({ type: 'i', t: `ψ = T₃/T₀ ≈ ${R.TRatio.toFixed(2)}`, d: 'Typical scramjets use ψ ≈ 6–8: enough pressure for combustion without so much heating that products dissociate.' });
    }
    if (S.N === 0 && S.M0 > 1.6) list.push({ type: 'w', t: 'Pitot inlet losses', d: `A plain normal-shock inlet keeps only ${(R.recovery * 100).toFixed(0)}% of total pressure at M${S.M0.toFixed(1)}. Fine below Mach ~1.6 (F-16), poor above.` });
    insightsList(insEl, list);
    paintPlot(); paintGeo();
  };
  const paintPlot = () => {
    const xs = []; for (let M = 1.01; M <= 6; M += 0.05) xs.push(M);
    const cols = ['--sep', '--lower', '--warn', '--upper', '--turb'];
    const series = [0, 1, 2, 3, 4].map(N => ({ x: xs, y: xs.map(M => analyzeInlet(M, oswatitschRamps(M, N, S.g).thetas, { g: S.g, terminal: 'normal' }).recovery), color: cssv(cols[N]), label: N === 0 ? 'normal shock' : `${N} oblique + normal`, width: 1.6 }));
    series.push({ x: xs, y: xs.map(milSpecRecovery), color: cssv('--text'), dash: [5, 4], label: 'MIL-E-5008B', width: 1.6 });
    series.push({ x: [S.M0], y: [R.recovery], color: cssv('--accent'), line: false, points: true, pointSize: 5, label: 'this inlet' });
    recPlot.setData({ series });
  };
  const paintGeo = () => box.set(({ W, H, g }) => {
    g.clearRect(0, 0, W, H);
    const geo = R.geo, lip = geo.lip, corners = geo.corners;
    // extents
    const wallEnd = S.mode === 'ext' ? lip[0] * 1.7 : lip[0] * 1.9;
    const xmin = -0.15 * lip[0], xmax = wallEnd, ymin = -0.25, ymax = lip[1] * 1.45;
    const sc = Math.min((W - 40) / (xmax - xmin), (H - 40) / (ymax - ymin));
    const X = x => 20 + (x - xmin) * sc, Y = y => H - 20 - (y - ymin) * sc;
    const Mmax = S.M0, Mmin = Math.min(...R.regions.map(r => r.M));
    const col = M => rgb(heat(1 - (M - Mmin) / Math.max(1e-6, Mmax - Mmin)));
    // freestream background
    g.fillStyle = col(S.M0); g.globalAlpha = 0.35; g.fillRect(0, 0, W, H); g.globalAlpha = 0.75;
    // wall after the last corner
    let wd = 0; for (const s of R.shocks) if (s.kind === 'oblique') wd += s.theta;
    const lastC = corners[corners.length - 1];
    const wallAt = x => lastC[1] + Math.tan(wd) * (x - lastC[0]);
    // region polygons
    for (let k = 1; k <= corners.length; k++) {
      const reg = R.regions[k]; if (!reg) break;
      g.fillStyle = col(reg.M);
      g.beginPath();
      if (k < corners.length) { g.moveTo(X(corners[k - 1][0]), Y(corners[k - 1][1])); g.lineTo(X(corners[k][0]), Y(corners[k][1])); g.lineTo(X(lip[0]), Y(lip[1])); }
      else { g.moveTo(X(lastC[0]), Y(lastC[1])); g.lineTo(X(lip[0]), Y(Math.min(wallAt(lip[0]), lip[1]))); g.lineTo(X(lip[0]), Y(lip[1])); }
      g.closePath(); g.fill();
    }
    // internal duct region (after normal or cowl shock)
    const fin = R.regions[R.regions.length - 1];
    g.fillStyle = col(fin.M);
    g.beginPath(); g.moveTo(X(lip[0]), Y(lip[1])); g.lineTo(X(wallEnd), Y(lip[1])); g.lineTo(X(wallEnd), Y(S.mode === 'ext' ? wallAt(lip[0]) - 0.15 : Math.min(wallAt(lip[0]), lip[1] - 0.12))); g.lineTo(X(lip[0]), Y(Math.min(wallAt(lip[0]), lip[1] - 0.02))); g.closePath(); g.fill();
    g.globalAlpha = 1;
    // ramp body
    g.fillStyle = cssv('--border-strong'); g.strokeStyle = cssv('--text-2'); g.lineWidth = 2;
    g.beginPath(); g.moveTo(X(xmin), Y(0)); for (const c of corners) g.lineTo(X(c[0]), Y(c[1]));
    const xl = lip[0], yw = Math.min(wallAt(xl), lip[1] - 0.02);
    g.lineTo(X(xl), Y(yw));
    if (S.mode === 'ext') { g.quadraticCurveTo(X(xl + (wallEnd - xl) * 0.4), Y(yw), X(wallEnd), Y(yw - 0.15)); g.lineTo(X(wallEnd), Y(ymin)); }
    else { g.lineTo(X(wallEnd), Y(Math.min(wallAt(xl), lip[1] - 0.12))); g.lineTo(X(wallEnd), Y(ymin)); }
    g.lineTo(X(xmin), Y(ymin)); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(X(xmin), Y(0)); for (const c of corners) g.lineTo(X(c[0]), Y(c[1])); g.lineTo(X(xl), Y(yw)); g.stroke();
    // cowl
    g.fillStyle = cssv('--border-strong');
    g.beginPath(); g.moveTo(X(lip[0]), Y(lip[1])); g.lineTo(X(wallEnd), Y(lip[1] + 0.02)); g.lineTo(X(wallEnd), Y(lip[1] + 0.14)); g.lineTo(X(lip[0] + 0.25), Y(lip[1] + 0.1)); g.closePath(); g.fill(); g.stroke();
    // shocks
    g.strokeStyle = cssv('--bad'); g.lineWidth = 2.2;
    for (const [a, b] of geo.shocks) { g.beginPath(); g.moveTo(X(a[0]), Y(a[1])); g.lineTo(X(b[0]), Y(b[1])); g.stroke(); }
    const cs = R.shocks.find(s => s.kind === 'normal' || s.kind === 'cowl');
    if (cs && cs.kind === 'normal') { g.beginPath(); g.moveTo(X(lip[0]), Y(lip[1])); g.lineTo(X(lip[0]), Y(yw)); g.stroke(); }
    if (cs && cs.kind === 'cowl') {
      const ang = wd - cs.beta, d = [Math.cos(ang), Math.sin(ang)];
      // intersect with ramp wall line
      const t = (wallAt(lip[0]) - lip[1]) / (d[1] - Math.tan(wd) * d[0]);
      const hit = [lip[0] + t * d[0], lip[1] + t * d[1]];
      g.beginPath(); g.moveTo(X(lip[0]), Y(lip[1])); g.lineTo(X(hit[0]), Y(hit[1])); g.stroke();
    }
    // labels
    g.font = '12px ' + cssv('--font'); g.fillStyle = cssv('--text'); g.textAlign = 'center';
    g.fillText(`M₀ = ${S.M0.toFixed(2)}`, X(xmin + 0.12 * lip[0]), Y(lip[1] * 0.6));
    for (let k = 1; k < R.regions.length; k++) {
      let p;
      if (k < corners.length) p = [(corners[k - 1][0] + corners[k][0] + lip[0]) / 3, (corners[k - 1][1] + corners[k][1] + lip[1]) / 3];
      else if (k === corners.length && S.N > 0) p = [(lastC[0] + 2 * lip[0]) / 3, (lastC[1] + lip[1] + yw) / 3];
      else p = [lip[0] + (wallEnd - lip[0]) * 0.45, (lip[1] + yw) / 2];
      g.fillText('M ' + R.regions[k].M.toFixed(2), X(p[0]), Y(p[1]));
    }
    g.textAlign = 'left'; g.fillStyle = cssv('--text-3'); g.font = '11px ' + cssv('--font');
    g.fillText('Color = local Mach (cool = fast, warm = slow). Red lines = shocks, focused on the cowl lip.', 12, 18);
  });

  build(); compute();
  return { controls, main };
}
