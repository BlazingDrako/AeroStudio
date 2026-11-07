// 3-D orbit view on a 2-D canvas: an orthographic camera you turn by dragging and zoom with the wheel. Draws the
// central body, the equatorial plane, the orbit (solid above the equator, dashed below, hidden behind the body), the
// line of nodes and apsides, r, v and h, the angles of the six elements, and Kepler's equal-area sectors.
import { h } from '../../lib/ui.js';
import * as O from '../../solvers/orbits.js';
import { css, D } from './common.js';

export class OrbitView {
  constructor({ height = 'max(440px, 56vh)' } = {}) {
    this.el = h('div', { class: 'cf-chart orb-view', style: { height } });
    this.cv = h('canvas');
    this.el.append(this.cv);
    this.g = this.cv.getContext('2d', { alpha: true });
    this.cam = { az: -55 * D, el: 22 * D, zoom: 1 };
    this.data = null;
    this.layers = { plane: true, nodes: true, apsides: true, vectors: true, angles: true, areas: false, axes: true };
    let drag = null;
    this.cv.style.cursor = 'grab'; this.cv.style.touchAction = 'none';
    this.cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, az: this.cam.az, el: this.cam.el }; this.cv.setPointerCapture(e.pointerId); this.cv.style.cursor = 'grabbing'; });
    this.cv.addEventListener('pointermove', e => {
      if (!drag) return;
      this.cam.az = drag.az - (e.clientX - drag.x) * 0.008;
      this.cam.el = Math.max(-89 * D, Math.min(89 * D, drag.el + (e.clientY - drag.y) * 0.008));
      this.draw();
    });
    const up = () => { drag = null; this.cv.style.cursor = 'grab'; };
    this.cv.addEventListener('pointerup', up); this.cv.addEventListener('pointercancel', up);
    this.cv.addEventListener('wheel', e => { e.preventDefault(); this.cam.zoom = Math.max(0.3, Math.min(12, this.cam.zoom * Math.exp(-e.deltaY * 0.0015))); this.draw(); }, { passive: false });
    this.ro = new ResizeObserver(() => this.draw()); this.ro.observe(this.el);
    this.onTheme = () => this.draw(); addEventListener('themechange', this.onTheme);
  }
  setView(az, el) { this.cam.az = az * D; this.cam.el = el * D; this.draw(); }
  set(data) { this.data = data; this.draw(); }
  setLayers(o) { Object.assign(this.layers, o); this.draw(); }
  destroy() { this.ro.disconnect(); removeEventListener('themechange', this.onTheme); }

  draw() {
    const d = this.data; if (!d) return;
    const dpr = Math.min(devicePixelRatio || 1, 2), W = this.el.clientWidth, H = this.el.clientHeight;
    if (!W || !H) return;
    if (this.cv.width !== Math.round(W * dpr) || this.cv.height !== Math.round(H * dpr)) { this.cv.width = Math.round(W * dpr); this.cv.height = Math.round(H * dpr); }
    const g = this.g; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const { el, B } = d, L = this.layers, R = B.R;
    const P = O.props(el, B.mu), ra = el.e < 1 ? P.ra : 3 * P.rp;
    const ext = Math.max(ra, P.rp, 1.7 * R) * 1.08;
    const k = Math.min(W, H) / 2 / ext * this.cam.zoom, cx = W / 2, cy = H / 2;
    const { az, el: ce } = this.cam;
    const dir = [Math.cos(ce) * Math.cos(az), Math.cos(ce) * Math.sin(az), Math.sin(ce)];
    const rgt = [-Math.sin(az), Math.cos(az), 0], upv = [-Math.sin(ce) * Math.cos(az), -Math.sin(ce) * Math.sin(az), Math.cos(ce)];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const S = p => [cx + k * dot(p, rgt), cy - k * dot(p, upv), dot(p, dir)];
    // hidden behind the body: inside its disc on screen and further away than its front surface
    const hidden = p => { const dp = dot(p, dir), q = dot(p, p) - dp * dp; return q < R * R && dp < Math.sqrt(R * R - q); };
    const col = { accent: css('--accent'), text: css('--text'), t2: css('--text-2'), t3: css('--text-3'), border: css('--border'), strong: css('--border-strong'), warn: css('--warn'), good: css('--good'), bad: css('--bad'), turb: css('--turb'), lower: css('--lower'), upper: css('--upper') || css('--accent'), sunk: css('--bg-sunk'), elev: css('--bg-elev'), font: css('--font'), mono: css('--mono') };
    const dark = document.documentElement.dataset.resolvedTheme === 'dark';
    // polyline with occlusion; style(i) may return null to skip a segment
    const poly = (pts, color, w = 1.5, dash = null, alpha = 1) => {
      g.strokeStyle = color; g.lineWidth = w; g.globalAlpha = alpha; g.setLineDash(dash || []); g.beginPath();
      let pen = false;
      for (const p of pts) { if (hidden(p)) { pen = false; continue; } const [x, y] = S(p); pen ? g.lineTo(x, y) : g.moveTo(x, y); pen = true; }
      g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
    };
    const arrow = (a, b, color, w = 2, label = null) => {
      if (hidden(b) && hidden(a)) return;
      const [x0, y0] = S(a), [x1, y1] = S(b), ang = Math.atan2(y1 - y0, x1 - x0), len = Math.hypot(x1 - x0, y1 - y0);
      g.strokeStyle = color; g.fillStyle = color; g.lineWidth = w; g.globalAlpha = hidden(b) ? 0.35 : 1;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      if (len > 6) { const hs = Math.min(9, len * 0.35); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 - hs * Math.cos(ang - 0.4), y1 - hs * Math.sin(ang - 0.4)); g.lineTo(x1 - hs * Math.cos(ang + 0.4), y1 - hs * Math.sin(ang + 0.4)); g.closePath(); g.fill(); }
      if (label) texts.push({ text: label, color, font: '600 12px ', x: x1 + 5 * Math.cos(ang) + 3, y: y1 + 5 * Math.sin(ang) + 4, ax: x1, ay: y1, alpha: hidden(b) ? 0.35 : 1 });
      g.globalAlpha = 1;
    };
    // labels are collected and drawn last, each moved to the nearest free spot so none sit on top of another
    const texts = [];
    const label = (p, text, color, dx = 6, dy = -6, font = '11px ') => { if (hidden(p)) return; const [x, y] = S(p); texts.push({ text, color, font, x: x + dx, y: y + dy, ax: x, ay: y }); };
    const drawTexts = () => {
      const placed = [], hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.lineJoin = 'round';
      for (const t of texts) {
        g.font = t.font + col.font;
        const w = g.measureText(t.text).width, hh = 12, box = (x, y) => ({ x: x - 2, y: y - hh + 1, w: w + 4, h: hh + 2 });
        const tries = [[0, 0], [0, 12], [0, -12], [-(t.x - t.ax) * 2 - w, 0], [0, 24], [0, -24], [-(t.x - t.ax) * 2 - w, 12], [-(t.x - t.ax) * 2 - w, -12]];
        let at = tries.map(([dx, dy]) => [t.x + dx, t.y + dy]).find(([x, y]) => { const b = box(x, y); return b.x >= 0 && b.x + b.w <= W && b.y >= 0 && b.y + b.h <= H - 18 && !placed.some(q => hit(b, q)); });
        if (!at) at = [t.x, t.y];
        placed.push(box(...at));
        g.globalAlpha = t.alpha ?? 1;
        g.strokeStyle = col.elev; g.lineWidth = 3; g.globalAlpha = (t.alpha ?? 1) * 0.85; g.strokeText(t.text, at[0], at[1]);
        g.globalAlpha = t.alpha ?? 1; g.fillStyle = t.color; g.fillText(t.text, at[0], at[1]);
      }
      g.globalAlpha = 1;
    };
    const dotAt = (p, r, color, ring = false) => { if (hidden(p)) return; const [x, y] = S(p); g.beginPath(); g.arc(x, y, r, 0, 2 * Math.PI); g.fillStyle = color; g.fill(); if (ring) { g.strokeStyle = col.elev; g.lineWidth = 2; g.stroke(); } };
    const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
    const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    // arc of radius rr from unit vector u toward unit vector w (perpendicular), from angle 0 to th
    const arc = (u, w, rr, th0, th1, n = 40) => Array.from({ length: n + 1 }, (_, j) => { const t = th0 + (th1 - th0) * j / n; return add(mul(u, rr * Math.cos(t)), mul(w, rr * Math.sin(t))); });

    // faint background stars, fixed to the sky so turning the camera feels like turning the view
    if (!this.stars) { let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647; this.stars = Array.from({ length: 140 }, () => { const z = 2 * rnd() - 1, t = 2 * Math.PI * rnd(), q = Math.sqrt(1 - z * z); return [[q * Math.cos(t), q * Math.sin(t), z], 0.4 + rnd() * 0.9]; }); }
    g.fillStyle = col.t3;
    for (const [s, r] of this.stars) { if (dot(s, dir) < 0) continue; const x = cx + Math.max(W, H) * 0.75 * dot(s, rgt), y = cy - Math.max(W, H) * 0.75 * dot(s, upv); g.globalAlpha = dark ? 0.55 : 0.25; g.fillRect(x, y, r, r); }
    g.globalAlpha = 1;

    const { P: Pv, Q: Qv, W: Wv } = O.perifocal(el.i, el.raan, el.argp);
    const pts = O.orbitPoints(el, 360).map(p => [p[0], p[1], p[2]]);
    const rNow = O.coe2rv(el, B.mu);

    // equatorial plane: a translucent disc with rings, reaching a little beyond the orbit
    const pr = Math.max(ra, 1.6 * R) * 1.15;
    if (L.plane) {
      const ring = rr => Array.from({ length: 121 }, (_, j) => { const t = j / 120 * 2 * Math.PI; return [rr * Math.cos(t), rr * Math.sin(t), 0]; });
      g.beginPath(); ring(pr).forEach((p, j) => { const [x, y] = S(p); j ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath();
      g.fillStyle = col.accent; g.globalAlpha = dark ? 0.06 : 0.045; g.fill(); g.globalAlpha = 1;
      for (const f of [0.25, 0.5, 0.75, 1]) poly(ring(pr * f), col.border, f === 1 ? 1.1 : 0.8);
      for (let a = 0; a < 180; a += 30) { const c = Math.cos(a * D), s = Math.sin(a * D); poly(Array.from({ length: 61 }, (_, m) => [pr * c * (m / 30 - 1), pr * s * (m / 30 - 1), 0]), col.border, 0.7); }
    }
    // the body: shaded disc lit from the camera's upper left, then an equator and a few meridians
    const [bx, by] = S([0, 0, 0]), br = R * k;
    const grad = g.createRadialGradient(bx - br * 0.35, by - br * 0.4, br * 0.1, bx, by, br);
    const bc = d.color || B.color;
    grad.addColorStop(0, shade(bc, 0.35)); grad.addColorStop(0.7, bc); grad.addColorStop(1, shade(bc, -0.45));
    g.beginPath(); g.arc(bx, by, br, 0, 2 * Math.PI); g.fillStyle = grad; g.fill();
    const front = p => dot(p, dir) > 0;
    const bodyLine = (ptsB, w, a) => { g.strokeStyle = 'rgba(255,255,255,' + a + ')'; g.lineWidth = w; g.beginPath(); let pen = false; for (const p of ptsB) { if (!front(p)) { pen = false; continue; } const [x, y] = S(p); pen ? g.lineTo(x, y) : g.moveTo(x, y); pen = true; } g.stroke(); };
    // the body turns: meridians drawn at the current rotation angle (gst)
    const gst = d.gst || 0;
    bodyLine(Array.from({ length: 121 }, (_, j) => { const t = j / 120 * 2 * Math.PI; return [R * Math.cos(t), R * Math.sin(t), 0]; }), 1.2, 0.55);
    for (let m = 0; m < 6; m++) { const lo = gst + m * 30 * D; bodyLine(Array.from({ length: 61 }, (_, j) => { const la = -Math.PI / 2 + j / 60 * Math.PI; return [R * Math.cos(la) * Math.cos(lo), R * Math.cos(la) * Math.sin(lo), R * Math.sin(la)]; }), 0.7, 0.25); }
    for (const la of [-60, -30, 30, 60]) bodyLine(Array.from({ length: 121 }, (_, j) => { const t = j / 120 * 2 * Math.PI; return [R * Math.cos(la * D) * Math.cos(t), R * Math.cos(la * D) * Math.sin(t), R * Math.sin(la * D)]; }), 0.7, 0.2);
    if (k * R > 14) dotAt([0, 0, R], 2.2, 'rgba(255,255,255,0.8)');

    // inertial axes: X toward the vernal equinox ♈, Z toward the north pole
    if (L.axes) {
      const ax = pr * 1.02;
      arrow([R, 0, 0], [ax, 0, 0], col.t3, 1.2, '♈ X'); arrow([0, R, 0], [0, ax * 0.6, 0], col.t3, 1, 'Y'); arrow([0, 0, R], [0, 0, R + (ax - R) * 0.55], col.t3, 1.2, 'Z (north)');
    }
    // Kepler's second law: sectors swept in equal times
    if (L.areas && el.e < 1) {
      const N = 12, M0 = 0;
      for (let s = 0; s < N; s++) {
        const nus = Array.from({ length: 21 }, (_, j) => O.trueFromMean(M0 + (s + j / 20) / N * 2 * Math.PI, el.e));
        const sp = nus.map(nu => { const r = O.rAt(el, nu); return add(mul(Pv, r * Math.cos(nu)), mul(Qv, r * Math.sin(nu))); });
        g.beginPath(); const [x0, y0] = S([0, 0, 0]); g.moveTo(x0, y0); for (const p of sp) { const [x, y] = S(p); g.lineTo(x, y); } g.closePath();
        g.fillStyle = s % 2 ? col.accent : col.turb; g.globalAlpha = 0.13; g.fill(); g.globalAlpha = 1;
      }
    }
    // the orbit: solid and bright above the equatorial plane, dashed below
    const above = [], below = [];
    for (let j = 0; j < pts.length - 1; j++) (pts[j][2] + pts[j + 1][2] >= 0 ? above : below).push(j);
    const seg = (idx, color, w, dash, alpha) => {
      g.strokeStyle = color; g.lineWidth = w; g.globalAlpha = alpha; g.setLineDash(dash || []); g.beginPath();
      for (const j of idx) { const a = pts[j], b = pts[j + 1]; if (hidden(a) || hidden(b)) continue; const [x0, y0] = S(a), [x1, y1] = S(b); g.moveTo(x0, y0); g.lineTo(x1, y1); }
      g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
    };
    seg(below, col.accent, 1.8, [5, 4], 0.6); seg(above, col.accent, 2.6, null, 1);
    // drop lines from the orbit to the plane help read the tilt
    if (L.plane && el.i > 1 * D && el.i < 179 * D) for (let j = 0; j < pts.length; j += 30) { const p = pts[j]; poly([p, [p[0], p[1], 0]], col.t3, 0.7, [2, 3], 0.6); }

    // line of nodes, ascending node ☊ and descending node ☋
    const nodeU = [Math.cos(el.raan), Math.sin(el.raan), 0], nodeV = [-Math.sin(el.raan), Math.cos(el.raan), 0];
    const rAsc = O.rAt(el, -el.argp), rDsc = O.rAt(el, Math.PI - el.argp);
    const inclined = el.i > 0.3 * D && el.i < 179.7 * D;
    if (L.nodes && inclined) {
      poly(Array.from({ length: 41 }, (_, j) => mul(nodeU, -rDsc + (rAsc + rDsc) * j / 40)), col.warn, 1.2, [6, 4]);
      const an = mul(nodeU, rAsc), dn = mul(nodeU, -rDsc);
      dotAt(an, 4.5, col.warn, true); label(an, '☊ ascending node', col.warn, 8, -6, '600 11px ');
      dotAt(dn, 3.5, col.warn, true); label(dn, '☋', col.warn, 7, -4, '600 12px ');
    }
    // apsides
    const peri = mul(Pv, P.rp), apo = mul(Pv, -P.ra);
    if (L.apsides && el.e > 0.002) {
      poly(Array.from({ length: 41 }, (_, j) => add(peri, mul(add(apo, mul(peri, -1)), j / 40))), col.t3, 1, [2, 4]);
      dotAt(peri, 4, col.good, true); label(peri, 'periapsis', col.good, 8, 12);
      if (isFinite(P.ra)) { dotAt(apo, 3.5, col.lower, true); label(apo, 'apoapsis', col.lower, 8, 12); }
    }
    // angles of the elements
    if (L.angles) {
      const rr = Math.max(R * 1.45, Math.min(Math.min(P.rp, ra) * 0.8, ext * 0.3), ext * 0.16);
      if (inclined) {
        // Ω: in the equatorial plane from ♈ to the ascending node
        if (el.raan > 0.5 * D) { const a = arc([1, 0, 0], [0, 1, 0], rr * 1.05, 0, el.raan); poly(a, col.warn, 1.6); label(a[Math.floor(a.length / 2)], 'Ω ' + (el.raan / D).toFixed(0) + '°', col.warn, 4, -4, '600 11px '); }
        // i: between the equator and the orbit plane, at the ascending node
        const an = mul(nodeU, rAsc * 0.82), across = O.vec.cross(Wv, nodeU);
        const a = arc(nodeV, [0, 0, 1], rr * 0.5, 0, el.i, 24).map(p => add(an, p));
        poly(a, col.bad, 1.6); label(a[Math.floor(a.length / 2)], 'i ' + (el.i / D).toFixed(1) + '°', col.bad, 5, 0, '600 11px ');
        poly([an, add(an, mul(nodeV, rr * 0.6))], col.bad, 0.9, [2, 2]); poly([an, add(an, mul(across, rr * 0.6))], col.bad, 0.9, [2, 2]);
        // ω: in the orbit plane from the ascending node to periapsis
        if (el.e > 0.002 && el.argp > 0.5 * D) { const inPlaneV = O.vec.cross(Wv, nodeU); const a2 = arc(nodeU, inPlaneV, rr * 0.8, 0, el.argp); poly(a2, col.good, 1.6); label(a2[Math.floor(a2.length / 2)], 'ω ' + (el.argp / D).toFixed(0) + '°', col.good, 4, -4, '600 11px '); }
      }
      // ν: from periapsis to the satellite
      const nu = O.wrap2pi(el.nu);
      if (nu > 0.5 * D && el.e > 0.002) { const a3 = arc(Pv, Qv, rr * 0.62, 0, nu); poly(a3, col.turb, 1.6); label(a3[Math.floor(a3.length / 2)], 'ν ' + (nu / D).toFixed(0) + '°', col.turb, 4, -4, '600 11px '); }
    }
    // vectors at the satellite
    const sat = rNow.r, v = rNow.v, vn = O.vec.norm(v);
    if (L.vectors) {
      poly([[0, 0, 0], sat], col.t2, 1.1, [3, 3]);
      const vs = ext * 0.28 / Math.max(vn, 1);
      arrow(sat, add(sat, mul(v, vs)), col.bad, 2.2, 'v');
      const hn = Wv, hl = ext * 0.32;
      arrow([0, 0, 0], mul(hn, hl), col.good, 2, 'h');
      label(mul(sat, 0.5), 'r', col.t2, 4, -4, '600 12px ');
    }
    // satellite
    if (!hidden(sat)) { const [x, y] = S(sat); g.beginPath(); g.arc(x, y, 9, 0, 2 * Math.PI); g.fillStyle = col.accent; g.globalAlpha = 0.18; g.fill(); g.globalAlpha = 1; }
    dotAt(sat, 5, col.text, true);
    // extras from the caller (another orbit, a marker)
    if (d.extra) for (const x of d.extra) poly(x.pts, x.color, x.width || 1.5, x.dash, x.alpha ?? 1);
    // legend / caption
    drawTexts();
    g.font = '10.5px ' + col.font; g.fillStyle = col.t3; g.textAlign = 'left'; g.textBaseline = 'bottom';
    g.fillText(W < 560 ? 'Drag to turn · scroll to zoom' : 'Drag to turn · scroll to zoom · solid above the equator, dashed below', 10, H - 8);
  }
}

function shade(hex, f) {
  hex = hex.replace('#', ''); if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const n = parseInt(hex, 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(x => Math.round(f > 0 ? x + (255 - x) * f : x * (1 + f)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
