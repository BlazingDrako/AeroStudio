// Stress & strain tab: plane stress transformation with an interactive Mohr's circle and rotating
// element, principal stresses, failure criteria, Hooke's law strains, and strain-gauge rosettes.
import { h, section, slider } from '../../lib/ui.js';
import { Plot } from '../../lib/plot.js';
import { MATERIALS } from '../../solvers/sections.js';
import { numField, selField, segField, card, metricsGrid, insightsList, units, fmtNum } from './common.js';
import { canvasBox } from '../propulsion/common.js';

const D = Math.PI / 180;

export function stressState(sx, sy, txy, sz = 0) {
  const C = (sx + sy) / 2, R = Math.hypot((sx - sy) / 2, txy);
  const s1 = C + R, s2 = C - R, thp = 0.5 * Math.atan2(2 * txy, sx - sy);
  const pr = [s1, s2, sz].sort((a, b) => b - a);
  const vm = Math.sqrt(0.5 * ((sx - sy) ** 2 + (sy - sz) ** 2 + (sz - sx) ** 2) + 3 * txy * txy);
  return { C, R, s1, s2, thp, ths: thp - Math.PI / 4, p: pr, tauAbs: (pr[0] - pr[2]) / 2, vm, tresca: pr[0] - pr[2] };
}
export function rotate(sx, sy, txy, th) {
  const c = Math.cos(2 * th), s = Math.sin(2 * th), a = (sx + sy) / 2, b = (sx - sy) / 2;
  return { sx: a + b * c + txy * s, sy: a - b * c - txy * s, txy: -b * s + txy * c };
}

export function stressTab({ keep = o => o } = {}) {
  const st = keep({ mode: 'stress', sx: 80e6, sy: -40e6, sz: 0, txy: 30e6, th: 0, mat: 'al2024', rosette: 'rect', ea: 600e-6, eb: 450e-6, ec: -200e-6 });
  const controls = h('div', { class: 'st-controls' });
  const sMode = section('Input'), sMat = section('Material'), sRot = section('Rotate the element');
  controls.append(sMode.el, sMat.el, sRot.el);
  const thSlider = slider({ label: 'Angle θ (°)', min: -90, max: 90, step: 0.5, value: 0, digits: 1, info: 'Rotate the stress element counter-clockwise by θ. On Mohr\'s circle the point moves by 2θ. Drag on the circle too.', onInput: v => { st.th = v * D; update(); } });
  sRot.body.append(thSlider.el, h('div', { class: 'st-quick' }, ...[['Principal', () => stressState(st.sx, st.sy, st.txy).thp], ['Max shear', () => stressState(st.sx, st.sy, st.txy).ths], ['Reset', () => 0]].map(([l, f]) => { const b = h('button', { type: 'button', class: 'btn sm ghost' }, l); b.addEventListener('click', () => { st.th = f(); thSlider.set(st.th / D); update(); }); return b; })));

  function renderControls() {
    const b = sMode.body; b.replaceChildren();
    b.append(segField('', [{ value: 'stress', label: 'Stress state' }, { value: 'rosette', label: 'Strain rosette' }], st.mode, v => { st.mode = v; renderControls(); update(); }));
    if (st.mode === 'stress') {
      b.append(numField('σx', 'stress', () => st.sx, v => { st.sx = v; update(); }), numField('σy', 'stress', () => st.sy, v => { st.sy = v; update(); }), numField('τxy', 'stress', () => st.txy, v => { st.txy = v; update(); }, { tip: 'Positive τxy acts in +y on the +x face.' }), numField('σz (out of plane)', 'stress', () => st.sz, v => { st.sz = v; update(); }, { tip: 'Usually 0 (plane stress). Matters for the absolute maximum shear and for failure criteria.' }));
    } else {
      b.append(segField('Rosette', [{ value: 'rect', label: '0° / 45° / 90°' }, { value: 'delta', label: '0° / 60° / 120°' }], st.rosette, v => { st.rosette = v; renderControls(); update(); }),
        numField('ε_a (0°)', 'strain', () => st.ea, v => { st.ea = v; update(); }), numField(`ε_b (${st.rosette === 'rect' ? 45 : 60}°)`, 'strain', () => st.eb, v => { st.eb = v; update(); }), numField(`ε_c (${st.rosette === 'rect' ? 90 : 120}°)`, 'strain', () => st.ec, v => { st.ec = v; update(); }),
        h('div', { class: 'hint' }, 'Gauge readings converted to εx, εy, γxy, then to stresses with plane-stress Hooke\'s law.'));
    }
    sMat.body.replaceChildren(selField('Material', MATERIALS.map(m => ({ value: m.id, label: m.name })), st.mat, v => { st.mat = v; update(); }));
  }

  const main = h('div', { class: 'cf-main-inner' });
  const metrics = metricsGrid();
  const mohr = canvasBox('cf-chart st-mohr'), elem = canvasBox('cf-chart st-elem');
  const plotHost = h('div', { class: 'st-plot st-plot-sm' }), plot = new Plot(plotHost, { legend: true });
  const res = h('div', {}), ins = h('div', {});
  main.append(metrics.el, h('div', { class: 'st-pair st-pair-mohr' }, card('Mohr\'s circle', 'Horizontal: normal stress σ. Vertical: shear stress τ, plotted positive downward so the point turns the same way as the element (2θ counter-clockwise). Drag anywhere on the circle.', mohr.el), card('Stress element', 'The material square at angle θ with the stresses acting on its faces.', elem.el)),
    h('div', { class: 'st-pair' }, card('Transformation with angle', null, plotHost), card('Strains & failure', null, res)), card('Notes', null, ins));

  let S = null, mat = null;
  function strainsFromRosette() {
    const { ea, eb, ec } = st;
    if (st.rosette === 'rect') return { ex: ea, ey: ec, gxy: 2 * eb - ea - ec };
    return { ex: ea, ey: (2 * eb + 2 * ec - ea) / 3, gxy: 2 * (eb - ec) / Math.sqrt(3) };
  }
  function update() {
    mat = MATERIALS.find(m => m.id === st.mat) || MATERIALS[0];
    const E = mat.E, nu = mat.nu, G = E / (2 * (1 + nu));
    let ex, ey, ez, gxy;
    if (st.mode === 'rosette') {
      ({ ex, ey, gxy } = strainsFromRosette());
      st.sx = E / (1 - nu * nu) * (ex + nu * ey); st.sy = E / (1 - nu * nu) * (ey + nu * ex); st.txy = G * gxy; st.sz = 0;
      ez = -nu / (1 - nu) * (ex + ey);
    } else {
      ex = (st.sx - nu * (st.sy + st.sz)) / E; ey = (st.sy - nu * (st.sx + st.sz)) / E; ez = (st.sz - nu * (st.sx + st.sy)) / E; gxy = st.txy / G;
    }
    S = stressState(st.sx, st.sy, st.txy, st.sz);
    const r = rotate(st.sx, st.sy, st.txy, st.th);
    const eC = (ex + ey) / 2, eR = Math.hypot((ex - ey) / 2, gxy / 2);
    metrics.set([
      { k: 'σ₁', v: units.fmt('stress', S.s1, 4), s: 'max principal (in-plane)' }, { k: 'σ₂', v: units.fmt('stress', S.s2, 4), s: 'min principal (in-plane)' },
      { k: 'θp', v: (S.thp / D).toFixed(2) + '°', s: 'x-axis to σ₁ direction' }, { k: 'τ max in-plane', v: units.fmt('stress', S.R, 4), s: `at θ = ${(S.ths / D).toFixed(2)}°` },
      { k: 'τ max absolute', v: units.fmt('stress', S.tauAbs, 4), s: '(σmax − σmin)/2, 3-D' },
      { k: 'Von Mises', v: units.fmt('stress', S.vm, 4), s: `SF = ${fmtNum(mat.fy / S.vm, 3)}`, cls: S.vm > mat.fy ? 'bad' : '' },
      { k: 'Tresca', v: units.fmt('stress', S.tresca, 4), s: `SF = ${fmtNum(mat.fy / S.tresca, 3)}`, cls: S.tresca > mat.fy ? 'bad' : '' },
    ]);
    const u = 0.5 * (st.sx * ex + st.sy * ey + st.sz * ez + st.txy * gxy);
    res.replaceChildren(h('div', { class: 'cf-res' }, ...[
      ['At θ: σx\'', units.fmt('stress', r.sx, 4)], ['At θ: σy\'', units.fmt('stress', r.sy, 4)], ['At θ: τx\'y\'', units.fmt('stress', r.txy, 4)],
      ['εx', units.fmt('strain', ex, 4)], ['εy', units.fmt('strain', ey, 4)], ['εz', units.fmt('strain', ez, 4)], ['γxy', units.fmt('strain', gxy, 4)],
      ['ε₁ / ε₂', `${units.num('strain', eC + eR, 4)} / ${units.num('strain', eC - eR, 4)} ${units.label('strain')}`], ['Volumetric strain', units.fmt('strain', ex + ey + ez, 4)],
      ['Strain energy density', `${fmtNum(u / 1e3, 4)} kJ/m³`], ['Shear modulus G', units.fmt('modulus', G, 4)],
      ['Yield σy', units.fmt('stress', mat.fy, 4)],
      ...(st.mode === 'rosette' ? [['σx (from gauges)', units.fmt('stress', st.sx, 4)], ['σy (from gauges)', units.fmt('stress', st.sy, 4)], ['τxy (from gauges)', units.fmt('stress', st.txy, 4)]] : []),
    ].map(([k, v]) => h('div', { class: 'r' }, h('span', {}, k), h('span', {}, v)))));
    const notes = [];
    if (S.s1 > 0 && S.s2 < 0) notes.push({ type: 'i', t: 'Mixed tension and compression', d: 'The largest shear acts on planes at 45° to the principal directions: ductile metals yield by sliding on these planes.' });
    if (S.tauAbs > S.R * 1.0001) notes.push({ type: 'w', t: 'Out-of-plane shear governs', d: `Both in-plane principals have the same sign (or σz is far from them), so the largest shear (${units.fmt('stress', S.tauAbs, 3)}) acts on a plane tilted out of the x-y plane. The in-plane circle underestimates it.` });
    notes.push({ type: S.vm > mat.fy ? 'b' : 'g', t: S.vm > mat.fy ? 'Predicted to yield' : `Elastic, safety factor ${fmtNum(mat.fy / S.vm, 3)} (von Mises)`, d: 'Von Mises (distortion energy) fits ductile metals best; Tresca (max shear) is slightly more conservative. Brittle materials and composites need different criteria (max principal stress, Tsai-Wu).' });
    insightsList(ins, notes);
    // transformation plot
    const th = [], a = [], b = [], c = [];
    for (let k = -90; k <= 90; k += 1) { const q = rotate(st.sx, st.sy, st.txy, k * D); th.push(k); a.push(units.fromSI('stress', q.sx)); b.push(units.fromSI('stress', q.sy)); c.push(units.fromSI('stress', q.txy)); }
    plot.setOpts({ xlabel: 'θ (°)', ylabel: `stress (${units.label('stress')})`, xname: 'θ', yname: 'σ' });
    plot.setData({ series: [{ x: th, y: a, color: cssv('--accent'), label: 'σx\'' }, { x: th, y: b, color: cssv('--lower'), label: 'σy\'' }, { x: th, y: c, color: cssv('--lam'), label: 'τx\'y\'' }], vlines: [{ x: st.th / D, color: cssv('--text-3') }] });
    mohr.draw(); elem.draw();
  }

  // Mohr's circle
  let mx = null;
  mohr.set(({ W, H, g }) => {
    if (!S) return;
    g.clearRect(0, 0, W, H);
    const pts = [S.p[0], S.p[2], 0];
    let lo = Math.min(...pts), hi = Math.max(...pts);
    const span = Math.max(hi - lo, 2 * S.tauAbs, 1);
    const s = Math.min((W - 80) / (span * 1.15), (H - 60) / (Math.max(2 * S.tauAbs, span * 0.3) * 1.25));
    const cx0 = (lo + hi) / 2, X = v => W / 2 + (v - cx0) * s, Y = t => H / 2 + t * s; // τ positive downward
    mx = { X, Y, s, cx0, W, H };
    const t3 = cssv('--text-3'), t2 = cssv('--text-2'), acc = cssv('--accent'), bad = cssv('--lower');
    g.strokeStyle = cssv('--border-strong'); g.lineWidth = 1; g.beginPath(); g.moveTo(20, Y(0)); g.lineTo(W - 20, Y(0)); g.moveTo(X(0), 14); g.lineTo(X(0), H - 14); g.stroke();
    g.fillStyle = t3; g.font = `11px ${cssv('--font')}`; g.textAlign = 'right'; g.textBaseline = 'bottom'; g.fillText('σ', W - 22, Y(0) - 3); g.textAlign = 'left'; g.fillText('τ (+ down)', X(0) + 4, H - 14);
    // 3-D circles
    const circ = (a, b, col, w, dash) => { g.strokeStyle = col; g.lineWidth = w; g.setLineDash(dash || []); g.beginPath(); g.arc(X((a + b) / 2), Y(0), Math.abs(a - b) / 2 * s, 0, 2 * Math.PI); g.stroke(); g.setLineDash([]); };
    if (Math.abs(st.sz) > 0 || S.s2 > 0 || S.s1 < 0) { circ(S.p[0], S.p[2], t3, 1, [4, 4]); circ(S.s1, st.sz, t3, 1, [2, 3]); circ(S.s2, st.sz, t3, 1, [2, 3]); }
    circ(S.s1, S.s2, acc, 2);
    // diameter X-Y
    const Xp = [X(st.sx), Y(st.txy)], Yp = [X(st.sy), Y(-st.txy)];
    g.strokeStyle = t2; g.lineWidth = 1.2; g.beginPath(); g.moveTo(...Xp); g.lineTo(...Yp); g.stroke();
    const dot = (p, col, lab, dx = 6, dy = -6) => { g.fillStyle = col; g.beginPath(); g.arc(p[0], p[1], 4.5, 0, 2 * Math.PI); g.fill(); g.font = `600 11px ${cssv('--font')}`; g.textAlign = dx < 0 ? 'right' : 'left'; g.textBaseline = 'middle'; g.fillText(lab, p[0] + dx, p[1] + dy); };
    dot(Xp, t2, 'X (σx, τxy)'); dot(Yp, t2, 'Y (σy, −τxy)');
    // rotated
    const r = rotate(st.sx, st.sy, st.txy, st.th);
    const Rp = [X(r.sx), Y(r.txy)], Rq = [X(r.sy), Y(-r.txy)];
    g.strokeStyle = bad; g.lineWidth = 1.6; g.beginPath(); g.moveTo(...Rp); g.lineTo(...Rq); g.stroke();
    dot(Rp, bad, `X' (θ = ${(st.th / D).toFixed(1)}°)`, 8, 12); dot(Rq, bad, 'Y\'', -8, 12);
    // principal points
    dot([X(S.s1), Y(0)], acc, `σ₁ ${units.num('stress', S.s1, 3)}`, 6, 12); dot([X(S.s2), Y(0)], acc, `σ₂ ${units.num('stress', S.s2, 3)}`, -6, 12);
    dot([X(S.C), Y(-S.R)], cssv('--lam'), `τmax ${units.num('stress', S.R, 3)}`, 6, -8);
    g.fillStyle = t3; g.beginPath(); g.arc(X(S.C), Y(0), 2.5, 0, 2 * Math.PI); g.fill();
    // 2θp arc
    const a0 = Math.atan2(st.txy, st.sx - S.C);
    g.strokeStyle = acc; g.lineWidth = 1; g.beginPath(); g.arc(X(S.C), Y(0), Math.min(28, S.R * s * 0.4), 0, a0, a0 < 0); g.stroke();
    g.fillStyle = t3; g.font = `10.5px ${cssv('--mono')}`; g.textAlign = 'center'; g.fillText(`2θp = ${(2 * S.thp / D).toFixed(1)}°`, X(S.C), Y(0) + Math.min(28, S.R * s * 0.4) + 12);
  });
  let dragging = false;
  const pick = e => {
    if (!mx || !S) return;
    const r = mohr.cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const ang = Math.atan2((y - mx.Y(0)) / mx.s, (x - mx.X(S.C)) / mx.s); // angle of X' from +σ axis (τ down)
    const a0 = Math.atan2(st.txy, st.sx - S.C);
    let th = (a0 - ang) / 2;
    // map so that dragging follows: point X' at angle a0 − 2θ
    while (th > Math.PI / 2) th -= Math.PI; while (th < -Math.PI / 2) th += Math.PI;
    st.th = th; thSlider.set(th / D); update();
  };
  mohr.cv.addEventListener('pointerdown', e => { dragging = true; mohr.cv.setPointerCapture(e.pointerId); pick(e); });
  mohr.cv.addEventListener('pointermove', e => { if (dragging) pick(e); });
  mohr.cv.addEventListener('pointerup', () => { dragging = false; });

  // stress element
  elem.set(({ W, H, g }) => {
    if (!S) return;
    g.clearRect(0, 0, W, H);
    const r = rotate(st.sx, st.sy, st.txy, st.th), cx = W / 2, cy = H / 2, half = Math.min(W, H) * 0.17;
    const t3 = cssv('--text-3'), txt = cssv('--text'), acc = cssv('--accent'), sh = cssv('--lam');
    g.strokeStyle = cssv('--border-strong'); g.setLineDash([3, 4]); g.beginPath(); g.moveTo(cx - half * 2.4, cy); g.lineTo(cx + half * 2.4, cy); g.moveTo(cx, cy + half * 2.4); g.lineTo(cx, cy - half * 2.4); g.stroke(); g.setLineDash([]);
    g.save(); g.translate(cx, cy); g.rotate(-st.th);
    g.fillStyle = cssv('--accent-soft'); g.strokeStyle = txt; g.lineWidth = 1.6; g.fillRect(-half, -half, 2 * half, 2 * half); g.strokeRect(-half, -half, 2 * half, 2 * half);
    const mxs = Math.max(Math.abs(r.sx), Math.abs(r.sy), Math.abs(r.txy), 1e-30);
    const L = v => 14 + 34 * Math.abs(v) / mxs;
    const arr = (x1, y1, x2, y2, col) => { const a = Math.atan2(y2 - y1, x2 - x1); g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 2; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); g.beginPath(); g.moveTo(x2, y2); g.lineTo(x2 - 8 * Math.cos(a - 0.4), y2 - 8 * Math.sin(a - 0.4)); g.lineTo(x2 - 8 * Math.cos(a + 0.4), y2 - 8 * Math.sin(a + 0.4)); g.closePath(); g.fill(); };
    // normal stresses (screen y down: +y face is at −half)
    for (const sgn of [1, -1]) {
      if (Math.abs(r.sx) > 1e-9 * mxs) { const l = L(r.sx), x0 = sgn * (half + 4); if (r.sx > 0) arr(x0, 0, x0 + sgn * l, 0, acc); else arr(x0 + sgn * l, 0, x0, 0, acc); }
      if (Math.abs(r.sy) > 1e-9 * mxs) { const l = L(r.sy), y0 = -sgn * (half + 4); if (r.sy > 0) arr(0, y0, 0, y0 - sgn * l, acc); else arr(0, y0 - sgn * l, 0, y0, acc); }
    }
    // shear: on +x face acts in +y (screen up) when τ > 0
    if (Math.abs(r.txy) > 1e-9 * mxs) {
      const l = L(r.txy) * 0.8, t = Math.sign(r.txy), o = half + 9;
      arr(o, t * l / 2, o, -t * l / 2, sh); arr(-o, -t * l / 2, -o, t * l / 2, sh);
      arr(-t * l / 2, -o, t * l / 2, -o, sh); arr(t * l / 2, o, -t * l / 2, o, sh);
    }
    g.restore();
    g.fillStyle = t3; g.font = `11px ${cssv('--mono')}`; g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText(`σx' = ${units.fmt('stress', r.sx, 3)}`, 10, 10); g.fillText(`σy' = ${units.fmt('stress', r.sy, 3)}`, 10, 26); g.fillText(`τx'y' = ${units.fmt('stress', r.txy, 3)}`, 10, 42);
    g.fillText(`θ = ${(st.th / D).toFixed(1)}°`, 10, H - 22);
  });

  const onUnits = () => { renderControls(); update(); };
  addEventListener('unitschange', onUnits);
  renderControls(); update();
  return {
    controls, main,
    load(p) { st.mode = 'stress'; if (p.sx !== undefined) st.sx = p.sx; if (p.sy !== undefined) st.sy = p.sy; if (p.txy !== undefined) st.txy = p.txy; st.sz = 0; if (p.mat) st.mat = p.mat; st.th = 0; thSlider.set(0); renderControls(); update(); },
    show() { mohr.draw(); elem.draw(); plot.draw(); },
    destroy() { removeEventListener('unitschange', onUnits); },
  };
}
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
