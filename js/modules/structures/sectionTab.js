// Sections tab: cross-section properties with a drawing, plus the normal- and shear-stress
// distributions for a given set of internal forces (N, V, M, T), and a link to Mohr's circle.
import { h, section, info } from '../../lib/ui.js';
import { Plot } from '../../lib/plot.js';
import { SHAPES, MATERIALS, sectionProps, torsionStressFactor } from '../../solvers/sections.js';
import { numField, selField, card, metricsGrid, insightsList, units, fmtNum, table } from './common.js';
import { canvasBox } from '../propulsion/common.js';

export function sectionTab({ go, keep = o => o }) {
  const st = keep({ shape: 'ibeam', dims: { ...SHAPES.ibeam.def }, mat: 'al2024', N: 0, V: 20e3, M: 15e3, T: 0, pickY: null });
  try { const s = JSON.parse(localStorage.getItem('pteronautics-section') || 'null'); if (s && SHAPES[s.shape]) Object.assign(st, s); } catch { }
  const save = () => { try { localStorage.setItem('pteronautics-section', JSON.stringify(st)); } catch { } };

  const controls = h('div', { class: 'st-controls' });
  const sShape = section('Cross-section'), sMat = section('Material'), sLoad = section('Internal forces at this section');
  controls.append(sShape.el, sMat.el, sLoad.el);

  function renderControls() {
    sShape.body.replaceChildren(
      selField('Shape', Object.entries(SHAPES).filter(([k]) => k !== 'custom').map(([value, x]) => ({ value, label: x.label })), st.shape, v => { st.shape = v; st.dims = { ...SHAPES[v].def }; st.pickY = null; renderControls(); update(); }),
      h('div', { class: 'st-grid2' }, ...SHAPES[st.shape].fields.map(([k, lab]) => numField(lab, 'dim', () => st.dims[k], v => { if (v > 0) { st.dims[k] = v; update(); } }))),
      h('div', { class: 'hint' }, 'Bending is about the horizontal axis through the centroid (x). Dimensions are outside dimensions; walls and flanges are thicknesses.'));
    sMat.body.replaceChildren(selField('Material', MATERIALS.map(m => ({ value: m.id, label: m.name })), st.mat, v => { st.mat = v; update(); }));
    sLoad.body.replaceChildren(
      numField('Axial force N', 'force', () => st.N, v => { st.N = v; update(); }, { tip: 'Tension positive.' }),
      numField('Shear force V', 'force', () => st.V, v => { st.V = v; update(); }, { tip: 'Vertical shear (along y). Shear stress τ = VQ/(Ib).' }),
      numField('Bending moment M', 'moment', () => st.M, v => { st.M = v; update(); }, { tip: 'About the horizontal centroidal axis; positive (sagging) compresses the top.' }),
      numField('Torque T', 'moment', () => st.T, v => { st.T = v; update(); }, { tip: 'Twisting moment about the member axis.' }),
      h('div', { class: 'hint' }, 'Click the section drawing to pick a point; its stress state appears below and can be opened in Mohr\'s circle.'));
  }

  const main = h('div', { class: 'cf-main-inner' });
  const metrics = metricsGrid();
  const draw = canvasBox('cf-chart st-secview');
  const sigHost = h('div', { class: 'st-plot st-plot-sm' }), tauHost = h('div', { class: 'st-plot st-plot-sm' });
  const sigPlot = new Plot(sigHost, { legend: true }), tauPlot = new Plot(tauHost, { legend: true });
  const propsBox = h('div', {}), pointBox = h('div', {}), insights = h('div', {});
  main.append(metrics.el,
    h('div', { class: 'st-pair' }, card('Section', 'Stress colour: normal stress σ = N/A − M·y/I (red tension, blue compression). Dashed: plastic neutral axis. ✕: shear centre.', draw.el), card('Properties', null, propsBox)),
    h('div', { class: 'cf-grid2b' }, card('Normal stress through the depth', null, sigHost), card('Shear stress through the depth', 'τ = VQ(y)/(I·b(y)) from vertical shear. Torsion adds its own shear, largest at the outer surface (shown in the metrics).', tauHost)),
    h('div', { class: 'st-pair' }, card('Stress at the picked point', null, pointBox), card('Notes', null, insights)));

  let P = null;
  function update() {
    save();
    try { P = sectionProps({ shape: st.shape, dims: st.dims }); } catch { P = null; }
    if (!P || !(P.A > 0)) { metrics.set([{ k: 'Section', v: 'invalid', cls: 'bad' }]); return; }
    const mat = MATERIALS.find(m => m.id === st.mat) || MATERIALS[0];
    const sTop = st.N / P.A - st.M * P.ctop / P.Ix, sBot = st.N / P.A + st.M * P.cbot / P.Ix;
    const tauV = Math.abs(st.V) * P.Qmax / (P.Ix * P.bNA), kT = torsionStressFactor(st.shape, st.dims, P.J), tauT = Math.abs(st.T) * kT;
    const vm = Math.max(Math.abs(sTop), Math.abs(sBot), Math.sqrt((st.N / P.A) ** 2 + 3 * (tauV + tauT) ** 2));
    metrics.set([
      { k: 'Area A', v: units.fmt('area', P.A, 4) },
      { k: 'Iₓ', v: units.fmt('inertia', P.Ix, 4), tip: 'Second moment of area about the horizontal centroidal axis.' },
      { k: 'Section modulus S', v: units.fmt('smod', P.Sx, 4), s: 'I / c_max' },
      { k: 'σ top / bottom', v: `${units.num('stress', sTop, 3)} / ${units.num('stress', sBot, 3)}`, s: units.label('stress') },
      { k: 'τ (shear) max', v: units.fmt('stress', tauV, 3), s: `at the neutral axis${st.T ? `; torsion ${units.num('stress', tauT, 3)}` : ''}` },
      { k: 'Von Mises max', v: units.fmt('stress', vm, 4), s: `${(vm / mat.fy * 100).toFixed(0)}% of yield`, cls: vm > mat.fy ? 'bad' : '' },
      { k: 'Mass per length', v: units.fmt('lmass', mat.rho * P.A, 4) },
    ]);
    const L = units.label('dim');
    const rows = [
      ['Area A', units.fmt('area', P.A, 5)], ['Centroid x̄, ȳ (from bottom-left)', `${units.num('dim', P.xc, 4)}, ${units.num('dim', P.yc, 4)} ${L}`],
      ['Iₓ (horizontal axis)', units.fmt('inertia', P.Ix, 5)], ['I_y (vertical axis)', units.fmt('inertia', P.Iy, 5)], ['Product Iₓᵧ', units.fmt('inertia', P.Ixy, 4)],
      ['Principal I₁ / I₂', `${units.num('inertia', P.I1, 4)} / ${units.num('inertia', P.I2, 4)} ${units.label('inertia')}`], ['Principal angle θp', `${(P.thetaP * 180 / Math.PI).toFixed(2)}°`],
      ['c top / c bottom', `${units.num('dim', P.ctop, 4)} / ${units.num('dim', P.cbot, 4)} ${L}`], ['S top / S bottom', `${units.num('smod', P.Stop, 4)} / ${units.num('smod', P.Sbot, 4)} ${units.label('smod')}`],
      ['Plastic modulus Z', units.fmt('smod', P.Zx, 5)], ['Shape factor Z/S', fmtNum(P.shapeFactor, 4)],
      ['Radius of gyration rₓ / r_y', `${units.num('dim', P.r, 4)} / ${units.num('dim', P.ry, 4)} ${L}`], ['Torsion constant J', units.fmt('inertia', P.J, 4)],
      ['Q at neutral axis', units.fmt('smod', P.Qmax, 4)], ['Width at neutral axis', units.fmt('dim', P.bNA, 4)],
      ['EI', `${fmtNum(mat.E * P.Ix / units.factor('force') / units.factor('len') ** 2, 4)} ${units.label('force')}·${units.label('len')}²`], ['EA', units.fmt('force', mat.E * P.A, 4)], ['GJ', `${fmtNum(mat.E / (2 * (1 + mat.nu)) * P.J / units.factor('force') / units.factor('len') ** 2, 4)} ${units.label('force')}·${units.label('len')}²`],
      ['Elastic moment Mᵧ = σᵧS', units.fmt('moment', mat.fy * P.Sx, 4)], ['Plastic moment Mₚ = σᵧZ', units.fmt('moment', mat.fy * P.Zx, 4)],
    ];
    if (P.shearCentre) rows.push(['Shear centre (x, y)', `${units.num('dim', P.shearCentre.x, 4)}, ${units.num('dim', P.shearCentre.y, 4)} ${L}`]);
    propsBox.replaceChildren(h('div', { class: 'cf-res st-props' }, ...rows.map(([k, v]) => h('div', { class: 'r' }, h('span', {}, k), h('span', {}, v)))));
    // distributions
    const ys = [], sig = [], tau = [];
    const n = 160;
    for (let i = 0; i <= n; i++) { const y = P.ymin + (P.ymax - P.ymin) * i / n; ys.push(y); }
    for (const y of ys) {
      sig.push(units.fromSI('stress', st.N / P.A - st.M * (y - P.yc) / P.Ix));
      const b = P.widthAt(Math.min(P.ymax - 1e-9 * P.h, Math.max(P.ymin + 1e-9 * P.h, y)));
      tau.push(b > 0 ? units.fromSI('stress', Math.abs(st.V) * P.Qabove(y) / (P.Ix * b)) : NaN);
    }
    const yd = ys.map(y => units.fromSI('dim', y - P.yc));
    const fy = units.fromSI('stress', mat.fy);
    sigPlot.setOpts({ xlabel: `σ (${units.label('stress')})`, ylabel: `y from centroid (${L})`, xname: 'σ', yname: 'y' });
    sigPlot.setData({ series: [{ x: sig, y: yd, color: cssv('--accent'), label: 'σ(y)' }], vlines: Math.abs(fy) < 5 * Math.max(...sig.map(Math.abs)) ? [{ x: fy, color: cssv('--bad') }, { x: -fy, color: cssv('--bad') }] : [] });
    tauPlot.setOpts({ xlabel: `τ (${units.label('stress')})`, ylabel: `y from centroid (${L})`, xname: 'τ', yname: 'y' });
    tauPlot.setData({ series: [{ x: tau, y: yd, color: cssv('--lam'), label: 'τ(y) = VQ/Ib' }] });
    renderPoint(mat, kT);
    const notes = [];
    if (P.shearCentre) notes.push({ type: 'w', t: 'Shear centre off the centroid', d: `Loads must pass through the shear centre (${P.shearCentre.note}) or the section twists as it bends. Channels and angles used as spar caps or stringers need this.` });
    if (Math.abs(P.Ixy) > 1e-6 * P.Ix) notes.push({ type: 'w', t: 'Unsymmetric section', d: `The principal axes are rotated ${(P.thetaP * 180 / Math.PI).toFixed(1)}°: a vertical load also makes it deflect sideways (unsymmetric bending). This 2-D tool uses Iₓ only.` });
    const open = ['ibeam', 'channel', 'tee', 'angle', 'zsec', 'hat'].includes(st.shape);
    notes.push({ type: 'i', t: open ? 'Open thin-walled section: weak in torsion' : 'Closed or solid section: stiff in torsion', d: open ? `J = Σ b·t³/3 is tiny compared with a closed tube of the same area. That is why wings use closed boxes (skins + spars) to carry torque.` : `Closed sections carry torque by a shear flow q = T/(2A_m) around the wall (Bredt–Batho).` });
    notes.push({ type: 'i', t: `Shape factor ${fmtNum(P.shapeFactor, 3)}`, d: 'The plastic moment exceeds first yield by this factor: 1.5 for a rectangle, about 1.1–1.2 for I-beams (material is already far from the axis), 1.7 for a solid round bar.' });
    insightsList(insights, notes);
    draw.draw();
  }

  function renderPoint(mat, kT) {
    if (st.pickY === null || st.pickY < P.ymin || st.pickY > P.ymax) st.pickY = P.ymax;
    const y = st.pickY, sig = st.N / P.A - st.M * (y - P.yc) / P.Ix;
    const b = P.widthAt(Math.min(P.ymax - 1e-9 * P.h, Math.max(P.ymin + 1e-9 * P.h, y)));
    const tau = b > 0 ? st.V * P.Qabove(y) / (P.Ix * b) : 0;
    const s1 = sig / 2 + Math.hypot(sig / 2, tau), s2 = sig / 2 - Math.hypot(sig / 2, tau), vm = Math.sqrt(sig * sig + 3 * tau * tau);
    pointBox.replaceChildren(
      h('div', { class: 'cf-res' }, ...[['y from centroid', units.fmt('dim', y - P.yc, 4)], ['σ', units.fmt('stress', sig, 4)], ['τ (from V)', units.fmt('stress', tau, 4)], ['σ₁ / σ₂', `${units.num('stress', s1, 4)} / ${units.num('stress', s2, 4)}`], ['Von Mises', units.fmt('stress', vm, 4)], ['Safety factor (yield)', fmtNum(mat.fy / (vm || 1e-30), 3)]].map(([k, v]) => h('div', { class: 'r' }, h('span', {}, k), h('span', {}, v)))),
      h('div', { class: 'st-row', style: { marginTop: '8px' } }, btn('Open in Mohr\'s circle', () => go('stress', { sx: sig, sy: 0, txy: tau, mat: st.mat }))));
    void kT;
  }
  const btn = (label, fn) => { const b = h('button', { type: 'button', class: 'btn sm' }, label); b.addEventListener('click', fn); return b; };

  // drawing
  let xform = null;
  draw.set(({ W, H, g }) => {
    if (!P) return;
    g.clearRect(0, 0, W, H);
    const pad = 46, s = Math.min((W - 2 * pad - 60) / P.w, (H - 2 * pad) / P.h);
    const ox = (W - 60 - P.w * s) / 2 - P.xmin * s, oy = (H + P.h * s) / 2 + P.ymin * s;
    const X = x => ox + x * s, Y = y => oy - y * s;
    xform = { X, Y, s, ox, oy };
    const smax = Math.max(Math.abs(st.N / P.A - st.M * P.ctop / P.Ix), Math.abs(st.N / P.A + st.M * P.cbot / P.Ix), 1e-30);
    // fill with stress colour row by row, clipped to the section parts
    g.save();
    g.beginPath();
    for (const p of P.parts) if (p.s > 0) { if (p.k === 'r') g.rect(X(p.x), Y(p.y + p.h), p.w * s, p.h * s); else { g.moveTo(X(p.x) + p.r * s, Y(p.y)); g.arc(X(p.x), Y(p.y), p.r * s, 0, 2 * Math.PI); } }
    for (const p of P.parts) if (p.s < 0) { if (p.k === 'r') { g.moveTo(X(p.x), Y(p.y)); g.lineTo(X(p.x), Y(p.y + p.h)); g.lineTo(X(p.x + p.w), Y(p.y + p.h)); g.lineTo(X(p.x + p.w), Y(p.y)); g.closePath(); } else { g.moveTo(X(p.x) + p.r * s, Y(p.y)); g.arc(X(p.x), Y(p.y), p.r * s, 0, 2 * Math.PI, true); } }
    g.clip('evenodd');
    const rows = Math.max(40, Math.round(P.h * s / 2));
    for (let i = 0; i < rows; i++) {
      const y0 = P.ymin + P.h * i / rows, y1 = P.ymin + P.h * (i + 1) / rows, ym = (y0 + y1) / 2;
      const sig = st.N / P.A - st.M * (ym - P.yc) / P.Ix;
      g.fillStyle = diverging(sig / smax);
      g.fillRect(X(P.xmin) - 1, Y(y1) - 0.5, P.w * s + 2, (y1 - y0) * s + 1);
    }
    g.restore();
    // outline
    g.strokeStyle = cssv('--text'); g.lineWidth = 1.4;
    for (const p of P.parts) { g.beginPath(); if (p.k === 'r') g.rect(X(p.x), Y(p.y + p.h), p.w * s, p.h * s); else g.arc(X(p.x), Y(p.y), p.r * s, 0, 2 * Math.PI); g.stroke(); }
    // axes
    const t3 = cssv('--text-3'), acc = cssv('--accent');
    g.setLineDash([6, 4]); g.strokeStyle = acc; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(X(P.xmin) - 22, Y(P.yc)); g.lineTo(X(P.xmin + P.w) + 22, Y(P.yc)); g.stroke();
    g.strokeStyle = t3; g.beginPath(); g.moveTo(X(P.xc), Y(P.ymin) + 16); g.lineTo(X(P.xc), Y(P.ymax) - 16); g.stroke();
    if (Math.abs(P.ypna - P.yc) > 1e-4 * P.h) { g.strokeStyle = cssv('--turb'); g.setLineDash([2, 3]); g.beginPath(); g.moveTo(X(P.xmin) - 14, Y(P.ypna)); g.lineTo(X(P.xmin + P.w) + 14, Y(P.ypna)); g.stroke(); }
    g.setLineDash([]);
    g.fillStyle = acc; g.beginPath(); g.arc(X(P.xc), Y(P.yc), 4, 0, 2 * Math.PI); g.fill();
    g.font = `11px ${cssv('--font')}`; g.fillStyle = acc; g.textAlign = 'left'; g.textBaseline = 'bottom'; g.fillText('neutral axis (x)', X(P.xmin + P.w) + 6, Y(P.yc) - 2);
    if (P.shearCentre) { const sx = X(P.shearCentre.x), sy = Y(P.shearCentre.y); g.strokeStyle = cssv('--bad'); g.lineWidth = 2; g.beginPath(); g.moveTo(sx - 5, sy - 5); g.lineTo(sx + 5, sy + 5); g.moveTo(sx + 5, sy - 5); g.lineTo(sx - 5, sy + 5); g.stroke(); g.fillStyle = cssv('--bad'); g.textAlign = 'right'; g.fillText('S.C.', sx - 7, sy - 4); }
    // picked point line
    if (st.pickY !== null) { g.strokeStyle = cssv('--text'); g.lineWidth = 1; g.beginPath(); g.moveTo(X(P.xmin) - 10, Y(st.pickY)); g.lineTo(X(P.xmin + P.w) + 10, Y(st.pickY)); g.stroke(); g.fillStyle = cssv('--text'); g.beginPath(); g.arc(X(P.xmin) - 10, Y(st.pickY), 3, 0, 2 * Math.PI); g.fill(); }
    // dimensions
    g.fillStyle = t3; g.font = `10.5px ${cssv('--mono')}`; g.textAlign = 'center'; g.textBaseline = 'top';
    g.fillText(`${units.num('dim', P.w, 4)} ${units.label('dim')}`, X(P.xmin + P.w / 2), Y(P.ymin) + 8);
    g.save(); g.translate(X(P.xmin) - 30, Y(P.ymin + P.h / 2)); g.rotate(-Math.PI / 2); g.textBaseline = 'middle'; g.fillText(`${units.num('dim', P.h, 4)} ${units.label('dim')}`, 0, 0); g.restore();
    // colour bar
    const bx = W - 44, by0 = 30, by1 = H - 30;
    for (let i = 0; i < 100; i++) { g.fillStyle = diverging(1 - 2 * i / 99); g.fillRect(bx, by0 + (by1 - by0) * i / 100, 12, (by1 - by0) / 100 + 1); }
    g.fillStyle = t3; g.textAlign = 'left'; g.textBaseline = 'middle'; g.font = `10px ${cssv('--mono')}`;
    g.fillText('+' + units.num('stress', smax, 3), bx - 2, by0 - 12); g.fillText('−' + units.num('stress', smax, 3), bx - 2, by1 + 12);
  });
  draw.cv.addEventListener('click', e => {
    if (!xform || !P) return;
    const r = draw.cv.getBoundingClientRect(), y = (xform.oy - (e.clientY - r.top)) / xform.s;
    st.pickY = Math.max(P.ymin, Math.min(P.ymax, y)); update();
  });

  const onUnits = () => { renderControls(); update(); };
  addEventListener('unitschange', onUnits);
  renderControls(); update();
  return { controls, main, show() { draw.draw(); sigPlot.draw(); tauPlot.draw(); }, destroy() { removeEventListener('unitschange', onUnits); } };
}
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
// blue (compression, −1) → neutral → red (tension, +1)
function diverging(t) {
  t = Math.max(-1, Math.min(1, t));
  const n = [200, 205, 212], pos = [214, 60, 50], neg = [45, 100, 210];
  const c = t >= 0 ? pos : neg, a = Math.abs(t);
  return `rgb(${n.map((v, k) => Math.round(v + (c[k] - v) * a)).join(',')})`;
}
void info; void table;
