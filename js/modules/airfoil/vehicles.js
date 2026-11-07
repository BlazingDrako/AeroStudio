// Vehicle side profiles for the Vehicle aero tab, with published reference data. No DOM.
// Coordinates in metres; air flows in +x (the vehicle faces −x); the ground is y = 0.
//
// Each build(p) returns
//   parts    computed outlines (panel method): [{ name, short, role, pts | [pts…], lifting }]
//   details  drawn only: wheels, wing mounts, the F1 floor edge, and the fuselage, fin and engine of the planes
//            (ghost shapes are drawn merged into one silhouette)
//            [{ kind: 'wheel', x, y, r, rim, arch? } | { kind: 'fill', role, pts, front? } | { kind: 'line', role, pts, w, front? }]
//            roles: dark (mounts, floor edge), ghost (faded fuselage, fin and engine beside the slice)
//   axles, cg, ground, wake
// Cars are a centre-line slice, drawn as their side silhouette; wheels sit beside it. Planes are a slice through the
// wing and tailplane about a third of the way out, so the fuselage, fin and engine beside it are drawn faded.
//
// Dimensions (rounded, public figures for the class):
//   F1 (2022+)       wheelbase 3.60 m, height 0.95 m, tyres 720 mm on 18-inch rims, 798 kg with driver
//   GT3 coupé        length ≈ 4.6 m, wheelbase ≈ 2.6 m, height ≈ 1.24 m, tyres ≈ 680 mm
//   hatchback        Golf Mk2-class: length 3.98 m, wheelbase 2.55 m, height 1.45 m, tyres ≈ 580 mm
//   A320             length 37.6 m, fuselage 3.95 m, height 11.76 m, wing area 122.6 m²
//   F-16             length 15.0 m, height 5.1 m, wing area 27.9 m²
//   AIM-9 Sidewinder length 2.85 m, body 127 mm, 85 kg
// Published data used for real units (typical, rounded):
//   road car C_D·A ≈ 0.66 m², lift C_L·A ≈ +0.3 m²;  GT car C_D·A ≈ 0.95 m², C_L·A ≈ −2.2 m²;
//   F1 car C_D·A ≈ 1.3 m², C_L·A ≈ −4.5 m²;  A320 65 t in cruise, L/D ≈ 17, C_L,max ≈ 1.5;  F-16 12 t, L/D ≈ 8, C_L,max ≈ 1.6;
//   AIM-9 85 kg, fin and canard area ≈ 0.27 m² (one pair each), C_N,max ≈ 2 on that area with body lift
import { atmosphere } from '../../solvers/atmosphere.js';
import { nacaPoints } from '../cfd/shapes.js';
import { resample } from '../../solvers/panel2d.js';

// NACA section, chord c, leading edge at (x, y), angle a in degrees: nose up for a normal wing; for an upside-down
// (inverted) wing a positive angle lifts the trailing edge, which makes more downforce.
export function wing(code, c, x, y, a = 0, inverted = false, n = 28) {
  const r = a * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
  return nacaPoints(code, n).map(([px, py]) => {
    const X = px * c * cs + py * c * sn, Y = -px * c * sn + py * c * cs; // rotate nose up by a
    return [x + X, inverted ? y - Y : y + Y];
  });
}
// Smooth curve through points (Catmull–Rom), `per` points per segment, including both ends
function curve(P, per = 6) {
  const out = [P[0]];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    for (let k = 1; k <= per; k++) out.push(cr(p0, p1, p2, p3, k / per));
  }
  return out;
}
function cr(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [0, 1].map(d => 0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3));
}
// Smooth closed outline (Catmull–Rom), keeping corners that turn by more than `corner` degrees sharp.
// Used to draw panel outlines and drawn shapes without visible facets.
export function smoothClosed(P, per = 4, corner = 35) {
  const n = P.length, cc = Math.cos(corner * Math.PI / 180);
  const sharp = P.map((p, i) => {
    const a = P[(i - 1 + n) % n], b = P[(i + 1) % n], ux = p[0] - a[0], uy = p[1] - a[1], vx = b[0] - p[0], vy = b[1] - p[1];
    const l = Math.hypot(ux, uy) * Math.hypot(vx, vy); return !(l > 0) || (ux * vx + uy * vy) / l < cc;
  });
  const out = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, p1 = P[i], p2 = P[j], p0 = sharp[i] ? p1 : P[(i - 1 + n) % n], p3 = sharp[j] ? p2 : P[(i + 2) % n];
    out.push(p1);
    for (let k = 1; k < per; k++) out.push(cr(p0, p1, p2, p3, k / per));
  }
  return out;
}
// Closed outline from runs joined end to start: [smooth?, points]
function outline(runs) {
  const out = [];
  for (const [smooth, pts] of runs) { const c = smooth ? curve(pts) : pts; out.push(...(out.length ? c.slice(1) : c)); }
  if (Math.hypot(out[0][0] - out.at(-1)[0], out[0][1] - out.at(-1)[1]) < 1e-9) out.pop();
  return out;
}
const shift = (P, dx, dy) => P.map(([x, y]) => [x + dx, y + dy]);
const mirrorY = P => P.map(([x, y]) => [x, -y]).reverse();
// panel spacing: finer close to the ground so the gap under a car is resolved
const nearGround = (smax, smin) => (x, y) => Math.min(smax, Math.max(smin, 0.6 * y));
const te = W => W[0]; // trailing edge of a wing outline
// move every detail's points by dy (except wheels and anything marked fixed)
const shiftDetails = (D, dy) => D.map(d => (d.kind === 'wheel' || d.fixed ? d : { ...d, pts: shift(d.pts, 0, dy) }));

// Outlines below were measured from side-view reference images (assets/Vehicle profiles) and scaled to the real
// vehicle's length, wheelbase and height.

// ---------------------------------------------------------------- Formula 1 (2022+ rules)
// Traced from assets/Vehicle profiles/f1.webp: wheelbase scaled to 3.6 m, heights scaled so the top is ≈ 1 m. The
// airbox is faired into a level top, so it does not make a sharp, localised pressure spike.
function f1Car(p) {
  const dh = p.ride / 1000 - 0.04;
  const body = outline([
    [false, [[4.84, 0.40], [4.87, 0.52], [4.80, 0.60]]],                                                   // rear crash structure
    // engine cover, then a smooth, level top over the roll hoop down to the cockpit
    [true, [[4.80, 0.60], [4.49, 0.64], [4.30, 0.70], [3.94, 0.81], [3.49, 0.93], [3.15, 0.975], [2.9, 0.975], [2.72, 0.91], [2.6, 0.80], [2.46, 0.71], [2.2, 0.68], [1.95, 0.69], [1.77, 0.70], [1.5, 0.66], [1.32, 0.65], [1.0, 0.59], [0.64, 0.50], [0.32, 0.43], [0.09, 0.365], [-0.06, 0.315], [-0.13, 0.295], [-0.12, 0.28], [0.0, 0.31], [0.25, 0.355], [0.55, 0.36], [0.9, 0.31], [1.2, 0.27], [1.5, 0.26]]], // cockpit, nose
    // underside: the roof of the venturi tunnels (2022+ ground-effect floor): inlet, throat, then the diffuser
    [true, [[1.5, 0.26], [1.75, 0.22], [2.4, 0.135], [3.0, 0.10], [3.6, 0.11], [4.2, 0.18], [4.6, 0.28], [4.84, 0.40]]],
  ]);
  const bodyP = resample(shift(body, 0, dh), nearGround(0.07, 0.02));
  // front wing: mainplane and two flaps; rear wing: mainplane and DRS flap, high up between the endplates
  const f0 = wing('6409', 0.28, -0.12, 0.085 + dh, p.front, true);
  const f1 = wing('6409', 0.18, te(f0)[0] - 0.03, te(f0)[1] + 0.025, p.front + 14, true);
  const f2 = wing('6409', 0.14, te(f1)[0] - 0.025, te(f1)[1] + 0.02, p.front + 28, true);
  const r0 = wing('4412', 0.30, 4.68, 0.87 + dh, p.rear, true);
  const r1 = wing('6409', 0.22, te(r0)[0] - 0.04, te(r0)[1] + 0.03, p.rear + 18, true);
  const fr = 1.0, rr = 4.6, R = 0.36;
  const details = shiftDetails([
    // endplates and the halo sit beside the centre line, so they are drawn faded behind the slice
    { kind: 'fill', role: 'ghost', pts: [[4.555, 0.93], [4.6, 0.99], [4.85, 0.99], [5.12, 0.965], [5.30, 0.91], [5.28, 0.77], [5.17, 0.55], [5.08, 0.50], [5.01, 0.29], [4.89, 0.16], [4.80, 0.085], [4.67, 0.21], [4.58, 0.53]] },
    { kind: 'fill', role: 'ghost', pts: [[-0.14, 0.25], [-0.105, 0.31], [-0.02, 0.245], [0.01, 0.08], [-0.13, 0.08]] },
    { kind: 'fill', role: 'ghost', pts: smoothClosed([[1.86, 0.70], [1.95, 0.84], [2.04, 0.885], [2.2, 0.89], [2.4, 0.865], [2.6, 0.83], [2.74, 0.80], [2.74, 0.76], [2.58, 0.79], [2.4, 0.82], [2.2, 0.845], [2.05, 0.84], [1.97, 0.80], [1.9, 0.70]], 5) }, // halo
    { kind: 'line', role: 'dark', w: 0.022, pts: [[1.66, 0.052], [4.2, 0.052]], front: true },            // floor edge / plank at ride height
    { kind: 'line', role: 'dark', w: 0.03, pts: [[4.78, 0.58], [4.78, 0.86]] },                            // wing pillar, behind the wing
  ], dh);
  details.push({ kind: 'wheel', x: fr, y: R, r: R, rim: 0.229, cover: true }, { kind: 'wheel', x: rr, y: R, r: R, rim: 0.229, cover: true });
  return {
    parts: [
      { name: 'Front wing', role: 'wing', pts: [f0, f1, f2], lifting: true },
      { name: 'Body and floor', short: 'Body & floor', role: 'body', pts: [bodyP], lifting: false },
      { name: 'Rear wing', role: 'wing', pts: [r0, r1], lifting: true },
    ],
    details, axles: [fr, rr], cg: [2.55, 0.30 + dh], ground: true,
    wake: { x: 4.9, y0: 0.31 + dh, y1: 1.0 + dh },
  };
}

// ---------------------------------------------------------------- GT3-class race car (911-shaped coupé)
function gtCar(p) {
  const dh = p.ride / 1000 - 0.07;
  const body = outline([
    [false, [[4.55, 0.32], [4.56, 0.62], [4.53, 0.86], [4.45, 0.95]]],                                   // rear bumper
    [true, [[4.45, 0.95], [4.2, 0.975], [3.87, 0.99], [3.73, 1.05], [3.46, 1.14], [3.19, 1.21], [2.92, 1.26], [2.64, 1.29], [2.37, 1.30], [2.1, 1.26], [1.83, 1.13], [1.56, 0.99], [1.42, 0.92], [1.15, 0.88], [0.94, 0.85], [0.74, 0.82], [0.54, 0.75], [0.33, 0.67], [0.2, 0.60], [0.06, 0.52], [0.0, 0.42], [0.0, 0.25], [0.04, 0.16]]],
    [false, [[0.04, 0.16], [-0.06, 0.105], [-0.06, 0.085], [0.4, 0.075]]],                               // front splitter
    [true, [[0.4, 0.075], [1.0, 0.07], [2.0, 0.07], [3.2, 0.07], [3.65, 0.11], [4.1, 0.22], [4.55, 0.32]]], // floor and diffuser
  ]);
  const bodyP = resample(shift(body, 0, dh), nearGround(0.07, 0.015));
  const rw = wing('6409', 0.38, 4.08, 1.13 + dh, p.rear, true);
  const fr = 1.06, rr = 3.49, R = 0.34;
  const details = shiftDetails([
    { kind: 'line', role: 'dark', w: 0.03, pts: [[4.3, 0.95], [4.22, 1.08], [4.27, 1.16]] },              // swan-neck mount, behind the wing
  ], dh);
  details.push({ kind: 'wheel', x: fr, y: R, r: R, rim: 0.23 }, { kind: 'wheel', x: rr, y: R, r: R, rim: 0.23 });
  return {
    parts: [{ name: 'Body, splitter and floor', short: 'Body & floor', role: 'body', pts: bodyP, lifting: false }, { name: 'Rear wing', role: 'wing', pts: rw, lifting: true }],
    details, axles: [fr, rr], cg: [2.2, 0.45 + dh], ground: true,
    wake: { x: 4.56, y0: 0.32 + dh, y1: 0.99 + dh },
  };
}

// ---------------------------------------------------------------- Golf-class hatchback (Mk2 proportions)
function roadCar(p) {
  const dh = p.ride / 1000 - 0.14;
  const body = outline([
    [false, [[3.9, 0.42], [3.97, 0.50], [3.96, 0.62], [3.9, 0.66], [3.87, 0.96]]],                       // rear bumper
    [true, [[3.87, 0.96], [3.83, 1.03], [3.75, 1.11], [3.62, 1.21], [3.45, 1.34], [3.36, 1.39], [3.27, 1.41], [3.06, 1.43], [2.85, 1.44], [2.59, 1.45], [2.29, 1.45], [1.95, 1.43], [1.72, 1.41], [1.61, 1.34], [1.43, 1.20], [1.26, 1.07], [1.15, 0.99], [1.05, 0.97], [0.79, 0.94], [0.54, 0.89], [0.28, 0.83], [0.15, 0.81], [0.1, 0.75]]],
    [false, [[0.1, 0.75], [0.08, 0.57], [0.01, 0.54], [0.0, 0.42], [0.03, 0.36]]],                       // grille and front bumper
    [true, [[0.03, 0.36], [0.1, 0.28], [0.3, 0.19], [0.6, 0.15], [1.2, 0.14], [2.8, 0.14], [3.3, 0.17], [3.6, 0.25], [3.9, 0.42]]], // underbody
  ]);
  const bodyP = resample(shift(body, 0, dh), nearGround(0.07, 0.03));
  const fr = 0.75, rr = 3.30, R = 0.29;
  const details = [{ kind: 'wheel', x: fr, y: R, r: R, rim: 0.17 }, { kind: 'wheel', x: rr, y: R, r: R, rim: 0.17 }];
  return {
    parts: [{ name: 'Body', role: 'body', pts: bodyP, lifting: false }],
    details, axles: [fr, rr], cg: [1.5, 0.55 + dh], ground: true,
    wake: { x: 3.97, y0: 0.42 + dh, y1: 1.39 + dh },
  };
}

// ---------------------------------------------------------------- planes and missile (slice beside the fuselage)
// The aircraft pitches about its centre of gravity by the angle of attack.
function rotateAbout(P, cx, cy, deg) {
  const r = -deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  return P.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]);
}
const rotDetails = (D, cx, cy, a) => D.map(d => (d.kind === 'wheel' ? { ...d, ...(([[x, y]]) => ({ x, y }))(rotateAbout([[d.x, d.y]], cx, cy, a)) } : { ...d, pts: rotateAbout(d.pts, cx, cy, a) }));
const ghost = pts => ({ kind: 'fill', role: 'ghost', pts: smoothClosed(pts, 5) });
// A320 side view: fuselage as one closed outline (nose to tail and back), fin, belly fairing, engine and pylon
const A320_FUS = [[0, 2.76], [0.04, 3.04], [0.13, 3.22], [0.31, 3.4], [0.58, 3.58], [0.93, 3.77], [1.28, 3.95], [1.62, 4.22], [2.24, 4.7], [2.86, 5.04], [3.48, 5.26], [4.1, 5.39], [4.72, 5.48], [5.34, 5.52], [7.7, 5.55], [16, 5.55], [27.63, 5.55], [28.89, 5.54], [30.13, 5.48], [31.37, 5.44], [32.61, 5.39], [33.85, 5.3], [35.09, 5.21], [36.24, 5.08], [36.86, 4.97], [37.22, 4.88], [37.44, 4.82], [37.48, 4.53], [37.44, 4.24], [37.22, 4.17], [36.95, 4.06], [36.33, 3.86], [35.71, 3.69], [35.09, 3.49], [33.85, 3.15], [32.61, 2.84], [31.37, 2.56], [30.13, 2.27], [28.89, 2.0], [27.65, 1.78], [26.41, 1.6], [25.17, 1.49], [23.93, 1.45], [16, 1.45], [5.34, 1.45], [4.1, 1.49], [2.86, 1.6], [2.24, 1.72], [1.62, 1.83], [0.93, 2.03], [0.58, 2.18], [0.31, 2.36], [0.13, 2.58], [0.03, 2.68]];
const A320_FIN = [[35.11, 5.0], [36.73, 11.28], [36.66, 11.41], [34.89, 11.41], [34.49, 11.06], [33.23, 9.51], [31.99, 8.05], [30.75, 6.59], [30.04, 5.97], [29.51, 5.68], [28.85, 5.5], [28.2, 5.3], [30, 5.0]];
const A320_FAIRING = [[21.87, 1.6], [21.87, 1.49], [20.21, 1.41], [18.97, 1.32], [17.67, 1.3], [16.29, 1.3], [15.23, 1.41], [14.35, 1.49], [14.35, 1.6]];
const A320_ENGINE = [[11.42, 2.16], [11.31, 1.36], [11.45, 0.52], [12.13, 0.3], [12.91, 0.23], [13.79, 0.32], [14.52, 0.48], [15.45, 0.74], [16.47, 1.01], [16.49, 1.47], [15.45, 1.6], [14.52, 1.87], [13.24, 2.09], [12.24, 2.16]];
const A320_PYLON = [[12.6, 2.1], [15.4, 2.3], [17.6, 2.2], [16.4, 1.4], [14.8, 1.75]];
export const TAILSTRIKE = 11; // on the runway an A320 can pitch up only about this far before the tail touches
function airliner(p) {
  const cg = [17.0, 3.4], a = p.runway ? Math.min(p.alpha, TAILSTRIKE) : p.alpha;
  const wingP = rotateAbout(wing('2412', 4.3, 15.4, 2.3, 0), cg[0], cg[1], a);
  const tailP = rotateAbout(wing('0012', 2.6, 33.2, 4.15, -2.6), cg[0], cg[1], a);
  const D = [A320_FUS, A320_FIN, A320_FAIRING, A320_PYLON, A320_ENGINE].map(ghost);
  return {
    parts: [{ name: 'Wing', role: 'wing', pts: [wingP], lifting: true }, { name: 'Tailplane', role: 'tail', pts: [tailP], lifting: true }],
    details: rotDetails(D, cg[0], cg[1], a), cg, ground: !!p.runway,
  };
}
// F-16 side silhouette (fuselage, fin, ventral fins and nozzle in one outline), traced from the reference image
const F16 = [[15, 4.91], [13.75, 4.89], [11.56, 2.98], [10.09, 2.51], [8.4, 2.55], [7.41, 2.61], [6.3, 2.76], [5.77, 2.95], [5.16, 3.07], [4.9, 3.1], [4.21, 3.1], [3.82, 3.01], [3.48, 2.89], [3.12, 2.7], [2.84, 2.52], [2.39, 2.46], [1.43, 2.25], [0.85, 2.06], [0.5, 1.95], [0, 1.88], [0.53, 1.84], [0.75, 1.78], [1.17, 1.71], [1.66, 1.68], [4.5, 1.71], [4.62, 1.52], [4.67, 1.15], [4.96, 1.08], [5.8, 1.02], [7.73, 1.02], [8.08, 0.89], [9.29, 0.86], [9.34, 1.0], [10.57, 1.0], [10.88, 0.51], [11.67, 0.65], [11.82, 0.7], [11.86, 1.0], [12.5, 1.02], [13.2, 1.08], [14.56, 1.3], [14.57, 2.14], [13.72, 2.31], [13.2, 2.4], [13.3, 2.48], [13.95, 2.42], [14.03, 2.7], [14.08, 2.85], [14.03, 2.95], [14.94, 4.76], [15.03, 4.8]];
function fighter(p) {
  const cg = [8.4, 1.9];
  const wingP = rotateAbout(wing('2404', 3.4, 7.6, 2.0, 0), cg[0], cg[1], p.alpha);
  const tailP = rotateAbout(wing('0005', 2.2, 12.85, 1.8, -1.7), cg[0], cg[1], p.alpha);
  return {
    parts: [{ name: 'Wing', role: 'wing', pts: [wingP], lifting: true }, { name: 'Tailplane', role: 'tail', pts: [tailP], lifting: true }],
    details: rotDetails([ghost(F16)], cg[0], cg[1], p.alpha), cg, ground: !!p.runway,
  };
}
// AIM-9 Sidewinder: body (seeker dome, then a 127 mm cylinder), triangular canards and swept tail fins, from the
// reference image. The slice runs through the horizontal canards and tail fins just outside the body, at a third of
// their span; the body and the vertical fins (same shape) are drawn faded behind.
const AIM9_BODY = [[0, 0], [0.004, 0.02], [0.02, 0.031], [0.06, 0.044], [0.1, 0.052], [0.14, 0.057], [0.18, 0.061], [0.24, 0.0635], [1.4, 0.0635], [2.84, 0.0635], [2.845, 0.05]];
const AIM9_CANARD = [[0.24, 0.05], [0.26, 0.06], [0.468, 0.244], [0.488, 0.244], [0.488, 0.05]];
const AIM9_FIN = [[2.09, 0.05], [2.11, 0.06], [2.25, 0.214], [2.3, 0.226], [2.81, 0.24], [2.84, 0.235], [2.84, 0.05]];
function missile(p) {
  const cg = [1.4, 0];
  const can = rotateAbout(wing('0005', 0.16, 0.329, 0, 0), 0.39, 0, p.canard);         // canards turn about their hinge
  const canP = rotateAbout(can, cg[0], cg[1], p.alpha);
  const tailP = rotateAbout(wing('0004', 0.675, 2.165, 0, 0), cg[0], cg[1], p.alpha);
  const body = [...AIM9_BODY, ...mirrorY(AIM9_BODY).slice(1, -1)];
  const D = [body, AIM9_CANARD, mirrorY(AIM9_CANARD), AIM9_FIN, mirrorY(AIM9_FIN)].map(P => ({ kind: 'fill', role: 'ghost', pts: P === body ? smoothClosed(P, 5) : P }));
  return {
    parts: [{ name: 'Canards', role: 'canard', pts: [canP], lifting: true }, { name: 'Tail fins', role: 'tail', pts: [tailP], lifting: true }],
    details: rotDetails(D, cg[0], cg[1], p.alpha), cg, ground: false,
  };
}

const ride = (v, min, max) => ({ key: 'ride', label: 'Ride height', min, max, step: 1, value: v, fmt: x => x.toFixed(0) + ' mm', info: 'Gap between the floor and the road. The whole car moves up or down.' });
const speed = (v, max) => ({ key: 'speed', label: 'Speed', min: 30, max, step: 1, value: v, fmt: x => x.toFixed(0) + ' km/h', info: 'Changes the forces (they grow with speed²) but not the shape of the flow.' });

export const VEHICLES = [
  { id: 'road', group: 'Cars', label: 'Road car (hatchback)', kind: 'car', mass: 1000, CdA: 0.66, CLA: 0.3, build: roadCar,
    blurb: 'A compact hatchback (Golf Mk2 proportions). Air speeds up over the curved roof, so the pressure there drops and pulls the body up; at the nose the air is stopped and pushes on it.',
    params: [speed(130, 250), ride(140, 100, 220)] },
  { id: 'gt', group: 'Cars', label: 'GT race car (GT3-class)', kind: 'car', mass: 1300, CdA: 0.95, CLA: -2.2, calibrate: true, build: gtCar,
    blurb: 'A GT3 racer: a front splitter, a smooth floor ending in a diffuser, and a big rear wing on swan-neck mounts. All three pull the car onto the track.',
    params: [speed(220, 320), ride(70, 40, 140), { key: 'rear', label: 'Rear wing angle', min: 0, max: 16, step: 0.5, value: 8, fmt: x => x.toFixed(1) + '°', info: 'Trailing edge up = more downforce (and, on a real car, more drag).' }] },
  { id: 'f1', group: 'Cars', label: 'Formula 1 car (2022+)', kind: 'car', mass: 798, CdA: 1.3, CLA: -4.5, calibrate: true, build: f1Car,
    blurb: 'A Formula 1 car: a three-element front wing, a rear wing with its DRS flap, and a floor shaped to work with the road (ground effect). Downforce lets it corner and brake far harder than its tyres alone could.',
    params: [speed(250, 340), ride(40, 20, 100),
      { key: 'front', label: 'Front wing angle', min: -2, max: 10, step: 0.5, value: 3, fmt: x => x.toFixed(1) + '°', info: 'Angle of the front wing mainplane (the flaps follow it). More angle = more front downforce, moving the balance forward.' },
      { key: 'rear', label: 'Rear wing angle', min: -2, max: 14, step: 0.5, value: 5, fmt: x => x.toFixed(1) + '°', info: 'Angle of the rear wing mainplane (the flap follows it). Teams run low angles at fast tracks like Monza and high angles at Monaco.' }] },
  { id: 'airliner', group: 'Planes', label: 'Airliner (A320-class)', kind: 'plane', mass: 65000, S: 122.6, CLmax: 1.5, LD: 17, CD0: 0.022, nmax: 2.5, build: airliner,
    blurb: 'A slice through the wing and tailplane of a narrow-body airliner, a third of the way out, with the fuselage, fin and engine drawn faded behind. In steady flight lift balances weight; the tailplane usually pushes down a little.',
    params: [{ key: 'alpha', label: 'Angle of attack', min: -4, max: 14, step: 0.5, value: 3, fmt: x => x.toFixed(1) + '°', info: 'Angle between the wing and the oncoming air. The aircraft is drawn pitched by this angle.' },
      { key: 'speed', label: 'Speed', min: 220, max: 950, step: 5, value: 830, fmt: x => x.toFixed(0) + ' km/h', info: 'True airspeed.' },
      { key: 'alt', label: 'Altitude', min: 0, max: 12500, step: 100, value: 11000, fmt: x => x.toFixed(0) + ' m', info: 'Higher = thinner air, so the wing needs a higher lift coefficient (or more speed) to carry the same weight.' },
      { key: 'n', label: 'Load factor', min: 0.5, max: 2.5, step: 0.1, value: 1, fmt: x => x.toFixed(1) + ' g', info: 'Lift divided by weight: 1 g in level flight, more in a turn or pull-up. Airliners are certified to 2.5 g.' },
      { key: 'runway', label: 'Near the runway', type: 'toggle', value: false, info: 'On the ground run: the wing about 2.3 m above the runway (ground effect). ' }] },
  { id: 'fighter', group: 'Planes', label: 'Fighter (F-16-class)', kind: 'plane', mass: 12000, S: 27.9, CLmax: 1.6, LD: 8, CD0: 0.02, nmax: 9, build: fighter,
    blurb: 'A slice through the thin wing and tailplane of a fighter, with the fuselage and fin drawn faded behind. Pull the load factor up to 9 g and see how much lift the wing must make.',
    params: [{ key: 'alpha', label: 'Angle of attack', min: -4, max: 16, step: 0.5, value: 3, fmt: x => x.toFixed(1) + '°', info: 'Angle between the wing and the oncoming air.' },
      { key: 'speed', label: 'Speed', min: 250, max: 1400, step: 10, value: 900, fmt: x => x.toFixed(0) + ' km/h', info: 'True airspeed.' },
      { key: 'alt', label: 'Altitude', min: 0, max: 15000, step: 100, value: 9000, fmt: x => x.toFixed(0) + ' m' },
      { key: 'n', label: 'Load factor', min: 0.5, max: 9, step: 0.1, value: 1, fmt: x => x.toFixed(1) + ' g', info: 'Lift divided by weight. 9 g is the structural limit of an F-16.' },
      { key: 'runway', label: 'Near the runway', type: 'toggle', value: false, info: 'On the ground run: the wing about 2 m above the runway (ground effect). ' }] },
  { id: 'aim9', group: 'Missiles', label: 'Air-to-air missile (AIM-9 Sidewinder)', kind: 'plane', missile: true, mass: 85, S: 0.27, CLmax: 2.0, LD: 4, CD0: 0.12, nmax: 35, build: missile,
    blurb: 'A Sidewinder heat-seeking missile: small canards at the nose steer it, big swept tail fins keep it pointing into the airflow. The slice runs through the horizontal canards and tail fins; the body and vertical fins are drawn faded behind.',
    params: [{ key: 'alpha', label: 'Angle of attack', min: -4, max: 16, step: 0.5, value: 4, fmt: x => x.toFixed(1) + '°', info: 'Angle between the missile body and the oncoming air.' },
      { key: 'canard', label: 'Canard deflection', min: -15, max: 15, step: 0.5, value: 5, fmt: x => x.toFixed(1) + '°', info: 'How far the steering canards are turned, leading edge up. This is how the guidance system commands a turn.' },
      { key: 'speed', label: 'Speed', min: 300, max: 1000, step: 10, value: 950, fmt: x => x.toFixed(0) + ' km/h', info: 'True airspeed. Real Sidewinders fly at Mach 2 to 2.5; this panel method is for subsonic flow, so the range stops below Mach 1.' },
      { key: 'alt', label: 'Altitude', min: 0, max: 15000, step: 100, value: 1000, fmt: x => x.toFixed(0) + ' m' },
      { key: 'n', label: 'Load factor', min: 1, max: 40, step: 0.5, value: 10, fmt: x => x.toFixed(1) + ' g', info: 'Lift divided by weight. Sidewinders can pull more than 30 g.' }] },
];

export const defaults = v => Object.fromEntries(v.params.map(p => [p.key, p.value]));
// Bodies for the panel solver from a built vehicle: each part may hold several outlines
export const outlinesOf = part => (Array.isArray(part.pts[0][0]) ? part.pts : [part.pts]);
export function solverBodies(built) {
  const bodies = [], owner = [];
  built.parts.forEach((part, i) => { for (const pts of outlinesOf(part)) { bodies.push({ pts, lifting: part.lifting }); owner.push(i); } });
  return { bodies, owner };
}

// International Standard Atmosphere density (shared US 1976 model)
export function isaDensity(h) { return atmosphere(h).rho; }
