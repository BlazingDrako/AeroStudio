// Easter eggs.
// - Secret themes: shift-click the theme button for HUD, Blueprint and Mission Control. A secret theme
//   sits on top of dark mode (data-skin on <html>), so canvases keep their dark drawing and plots pick up
//   the new colours from the CSS variables.
// - Logo flyby: click the logo in the top left and either the jet crosses the screen leaving a contrail,
//   or the B-2 makes a slow, straight stealth pass that a radar sweep fails to pick up (50/50).
import { h, cssVar } from './ui.js';

export const SKINS = [
  { id: 'hud', name: 'HUD', sub: 'Fighter head-up display' },
  { id: 'blueprint', name: 'Blueprint', sub: 'Cyanotype engineering drawing' },
  { id: 'mission', name: 'Mission Control', sub: '1960s amber CRT and teletype' },
];
const KEY = 'pteronautics-skin';

export const currentSkin = () => document.documentElement.dataset.skin || '';

// Read the saved theme before the first paint
export function loadSkin() {
  let s = '';
  try { s = localStorage.getItem(KEY) || ''; } catch { }
  if (SKINS.some(k => k.id === s)) document.documentElement.dataset.skin = s;
}

// Set (or clear, with '') the secret theme. The caller recomputes the resolved theme and fires themechange.
export function setSkin(id) {
  const root = document.documentElement;
  if (id) root.dataset.skin = id; else delete root.dataset.skin;
  try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch { }
  paintOverlay();
}

// ---------- secret menu ----------
let menu = null;
export function toggleSkinMenu(anchor, onPick) {
  if (menu) { closeMenu(); return; }
  const now = currentSkin();
  const opt = (id, name, sub) => {
    const b = h('button', { class: 'skin-opt' + (id === now ? ' on' : ''), type: 'button', role: 'menuitemradio', 'aria-checked': String(id === now) },
      h('span', { class: 'skin-swatch', 'data-swatch': id || 'standard' }),
      h('span', { class: 'skin-txt' }, h('b', {}, name), h('span', {}, sub)));
    b.addEventListener('click', () => { closeMenu(); onPick(id); });
    return b;
  };
  menu = h('div', { class: 'skin-menu', role: 'menu', 'aria-label': 'Secret themes' },
    h('div', { class: 'skin-head' }, 'Secret themes'),
    ...SKINS.map(s => opt(s.id, s.name, s.sub)),
    now ? opt('', 'Standard', 'Back to light and dark') : null);
  document.body.append(menu);
  // next to the button: to its right on the desktop sidebar, below it when the sidebar is a top bar
  const r = anchor.getBoundingClientRect(), m = menu.getBoundingClientRect();
  const side = r.right + 8 + m.width <= innerWidth;
  const left = side ? r.right + 8 : Math.max(8, Math.min(innerWidth - m.width - 8, r.right - m.width));
  const top = side ? Math.max(8, Math.min(innerHeight - m.height - 8, r.bottom - m.height)) : r.bottom + 6;
  Object.assign(menu.style, { left: left + 'px', top: top + 'px' });
  menu.querySelector('button')?.focus();
  setTimeout(() => {
    addEventListener('pointerdown', outside, true);
    addEventListener('keydown', esc, true);
  });
}
function outside(e) { if (menu && !menu.contains(e.target)) closeMenu(); }
function esc(e) { if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); } }
function closeMenu() {
  menu?.remove(); menu = null;
  removeEventListener('pointerdown', outside, true);
  removeEventListener('keydown', esc, true);
}

// ---------- per-theme overlays ----------
let overlay = null, metTimer = 0, titleObs = null;
const metStart = Date.now();

function paintOverlay() {
  overlay?.remove(); overlay = null; endLock(); endPoll();
  clearInterval(metTimer); titleObs?.disconnect(); titleObs = null;
  const s = currentSkin();
  if (!s) return;
  overlay = h('div', { class: 'skin-fx', 'aria-hidden': 'true' });
  if (s === 'hud') {
    overlay.innerHTML = HUD_SVG;
    overlay.querySelector('.hud-fpm').addEventListener('click', e => lockOn(e.currentTarget));
  }
  if (s === 'blueprint') {
    const block = h('div', { class: 'bp-title' });
    overlay.append(block);
    const fill = () => {
      const page = (document.title.split(' — ')[0] || 'Pteronautics');
      const d = new Date(), date = `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleString('en', { month: 'short' }).toUpperCase()} ${d.getFullYear()}`;
      block.innerHTML = `<div class="bp-row bp-big"><span>PTERONAUTICS</span><span>DWG NO. PN-${String(hash(page)).padStart(4, '0')}</span></div>
        <div class="bp-row"><span class="bp-k">TITLE</span><span>${page.toUpperCase()}</span></div>
        <div class="bp-row bp-cells"><span><i>DRAWN</i>A. AGUIAR</span><span><i>SCALE</i>NTS</span><span><i>SHEET</i>1 OF 1</span><span><i>DATE</i>${date}</span></div>`;
    };
    fill();
    const t = document.querySelector('title');
    if (t) { titleObs = new MutationObserver(fill); titleObs.observe(t, { childList: true, characterData: true, subtree: true }); }
  }
  if (s === 'mission') {
    const met = h('div', { class: 'mc-met', title: 'Mission elapsed time' });
    met.addEventListener('click', goNoGo);
    overlay.append(h('div', { class: 'mc-vignette' }), met);
    const tick = () => {
      const t = Math.floor((Date.now() - metStart) / 1000);
      const p = (n, w = 2) => String(n).padStart(w, '0');
      met.innerHTML = `<span>MET</span> ${p(Math.floor(t / 86400), 3)}:${p(Math.floor(t / 3600) % 24)}:${p(Math.floor(t / 60) % 60)}:${p(t % 60)}`;
    };
    tick(); metTimer = setInterval(tick, 1000);
  }
  document.body.append(overlay);
}
export function initEggs() { paintOverlay(); }
const hash = s => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 9973, 7);

// Pitch ladder (5° per rung, split bars, dashed below the horizon), heading tape, flight path marker,
// speed and altitude boxes. Faint and click-through, so it never gets in the way.
const HUD_SVG = (() => {
  let ladder = '';
  for (let k = -6; k <= 6; k++) {
    if (!k) continue;
    const y = -k * 70, deg = Math.abs(k * 5), dash = k < 0 ? ' stroke-dasharray="14 8"' : '', tick = k < 0 ? -12 : 12;
    ladder += `<path d="M-250 ${y} H-110 V${y + tick} M110 ${y + tick} V${y} H250"${dash}/>
      <text x="-262" y="${y + 5}" text-anchor="end">${deg}</text><text x="262" y="${y + 5}">${deg}</text>`;
  }
  let tape = '';
  for (let d = -40; d <= 40; d += 5) {
    const hdg = (360 + 90 + d) % 360, x = d * 8, major = hdg % 10 === 0;
    tape += `<path d="M${x} -372 V${major ? -360 : -366}"/>` + (major ? `<text x="${x}" y="-380" text-anchor="middle">${String(hdg / 10).padStart(2, '0')}</text>` : '');
  }
  return `<svg viewBox="-500 -420 1000 840" preserveAspectRatio="xMidYMid slice">
    <g class="hud-ladder"><path d="M-420 0 H-110 M110 0 H420"/>${ladder}</g>
    <g class="hud-tape">${tape}<path d="M0 -352 l-7 10 h14 z"/></g>
    <g class="hud-fpm"><circle class="hud-hit" r="24"/><circle r="11"/><path d="M-11 0 H-30 M11 0 H30 M0 -11 V-22"/></g>
    <g class="hud-box"><rect x="-430" y="-16" width="86" height="30"/><text x="-387" y="6" text-anchor="middle">M 0.82</text>
      <rect x="344" y="-16" width="86" height="30"/><text x="387" y="6" text-anchor="middle">35000</text>
      <text x="-430" y="44">G 1.0</text><text x="430" y="44" text-anchor="end">ARM</text></g>
  </svg>`;
})();

// ---------- HUD: click the flight path marker to lock on to the nearest chart or view ----------
let lock = null;
function lockOn(fpm) {
  endLock();
  const m = fpm.getBoundingClientRect(), cx = m.left + m.width / 2, cy = m.top + m.height / 2;
  // candidates: every canvas (plots, flow fields, 3D views) and the home page's pictures, if on screen
  let best = null, bestD = Infinity;
  for (const el of document.querySelectorAll('main canvas, main .card-preview, main .home-hero-art svg')) {
    const r = el.getBoundingClientRect();
    const w = Math.min(r.right, innerWidth) - Math.max(r.left, 0), ht = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
    if (w < 40 || ht < 30) continue;
    const d = Math.hypot(Math.max(r.left - cx, 0, cx - r.right), Math.max(r.top - cy, 0, cy - r.bottom));
    if (d < bestD) { bestD = d; best = el; }
  }
  const box = h('div', { class: 'hud-lock' }, h('i'), h('i'), h('i'), h('i'), h('b', {}, 'LOCK'), h('span'));
  const flash = h('div', { class: 'hud-lockflash' }, best ? 'LOCK' : 'NO TGT');
  Object.assign(flash.style, { left: cx + 'px', top: cy - 46 + 'px' });
  document.body.append(box, flash);
  lock = { box, flash, raf: 0, timer: 0 };
  if (!best) { box.remove(); lock.timer = setTimeout(endLock, 1200); return; }
  const rng = (bestD / 220 + 0.4).toFixed(1);
  const t0 = performance.now();
  const place = now => { // starts as a wide box round the marker, snaps onto the target, then follows it on scroll
    const r = best.getBoundingClientRect(), k = Math.min(1, (now - t0) / 260), e = 1 - Math.pow(1 - k, 3);
    const s0 = { l: cx - 60, t: cy - 60, w: 120, h: 120 }, s1 = { l: r.left - 6, t: r.top - 6, w: r.width + 12, h: r.height + 12 };
    const L = s0.l + (s1.l - s0.l) * e, T = s0.t + (s1.t - s0.t) * e;
    Object.assign(box.style, { left: L + 'px', top: T + 'px', width: s0.w + (s1.w - s0.w) * e + 'px', height: s0.h + (s1.h - s0.h) * e + 'px' });
    box.lastChild.textContent = `TGT ${String(hash(best.className.baseVal ?? best.className) % 90 + 10)}  RNG ${rng} NM`;
    if (k >= 1) box.classList.add('locked');
    lock.raf = requestAnimationFrame(place);
  };
  lock.raf = requestAnimationFrame(place);
  lock.timer = setTimeout(() => { box.classList.add('gone'); setTimeout(endLock, 400); }, 3200);
}
function endLock() {
  if (!lock) return;
  cancelAnimationFrame(lock.raf); clearTimeout(lock.timer);
  lock.box.remove(); lock.flash.remove(); lock = null;
}

// ---------- Mission Control: click the clock for the flight director's go/no-go poll ----------
const POLL = ['BOOSTER', 'RETRO', 'FIDO', 'GUIDO', 'SURGEON', 'EECOM', 'GNC', 'TELCOM', 'NETWORK', 'CAPCOM'];
let poll = null;
function goNoGo() {
  if (poll) return;
  const lines = ['FLIGHT: ALL FLIGHT CONTROLLERS, GO/NO-GO FOR LAUNCH.', ...POLL.map(p => `${p.padEnd(8)}... GO`), 'FLIGHT: HOUSTON, WE ARE GO FOR LAUNCH.'];
  const pre = h('pre'), cur = h('span', { class: 'mc-cursor' });
  const box = h('div', { class: 'mc-poll' }, h('div', { class: 'mc-poll-head' }, 'MOCR LOOP · FLIGHT DIRECTOR'), pre);
  document.querySelector('.skin-fx')?.append(box);
  poll = { box, timer: 0 };
  let li = 0, ci = 0, text = '';
  const type = () => {
    if (!poll) return;
    if (li >= lines.length) { pre.append(cur); poll.timer = setTimeout(() => { box.classList.add('gone'); poll.timer = setTimeout(endPoll, 500); }, 3500); return; }
    const line = lines[li];
    text += line[ci++];
    const last = li === lines.length - 1;
    pre.textContent = text; pre.append(cur);
    if (ci >= line.length) { text += '\n'; li++; ci = 0; }
    // teletype rhythm: a pause after each callout, a longer one before the answer "GO"
    const next = ci === 0 ? (last ? 0 : 380) : line.slice(ci - 3, ci) === '...' ? 260 : 26;
    if (ci === 0 && li === lines.length - 1) box.classList.add('final');
    poll.timer = setTimeout(type, next);
  };
  type();
}
function endPoll() { if (!poll) return; clearTimeout(poll.timer); poll.box.remove(); poll = null; }

// ---------- logo flyby ----------
const PLANE = [ // the logo plane (nose to the right), with fill opacity per part
  ['M55.7 16.9 L34.6 3.4 L27.3 3.4 L23.3 18.8 Z', .55],
  ['M43.5 30.0 L38.0 34.4 L33.7 34.4 L32.8 29.5 Z', 1],
  ['M21.5 21.2 L14.4 22.3 L14.4 26.9 L21.5 27.5 Z', 1],
  ['M74 23.2 L18 25.6 L12 27.4 L16 27.6 L70 26 Z', .55],
  ['M134.0 23.1 L129.1 21.5 L122.4 19.9 L115.0 18.8 L107.1 18.0 L102.8 16.9 L95.5 16.5 L85.7 16.3 L78.3 15.8 L63.0 16.5 L51.4 16.9 L35.5 17.9 L23.3 19.4 L21.5 20.9 L21.5 27.6 L28.8 29.1 L45.3 30.0 L85.7 30.3 L88.1 29.1 L92.4 26.6 L106.5 26.0 L112.6 26.5 L118.7 26.5 L122.4 25.6 L129.7 24.4 Z', 1],
  ['M84 23.4 L44 24.2', .85, 'line'], // wing root, where the swept wing meets the body
  ['M52.7 17.1 L31.2 3.0 L23.6 3.0 L19.9 19.7 Z', 1],
];
const GLASS = 'M107.1 18.0 L102.8 14.4 L97.9 12.5 L90.6 11.9 L83.2 12.7 L74.7 15.6 L78.3 15.8 L95.5 16.5 L102.8 16.9 Z';
let flying = false;

export function flyby(e) {
  if (flying || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (e?.shiftKey) return launch();
  if (Math.random() < 0.5) return bomber();
  flying = true;
  const cv = h('canvas', { class: 'flyby', 'aria-hidden': 'true' });
  document.body.append(cv);
  const g = cv.getContext('2d'), dpr = Math.min(2, devicePixelRatio || 1);
  const W = innerWidth, H = innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const accent = cssVar('--accent'), soft = cssVar('--accent-soft'), trailCol = cssVar('--text-2'), flame = cssVar('--hl');
  const paths = PLANE.map(([d, a, kind]) => [new Path2D(d), a, kind]), glass = new Path2D(GLASS);
  const scale = Math.max(0.7, Math.min(1.1, W / 1400));
  const CROSS = 3.2, FADE = 3.6; // seconds to cross, seconds for the contrail to fade
  // a gentle climbing S-curve from off the left edge to off the right edge
  const y0 = H * (0.62 + Math.random() * 0.12), y1 = H * (0.22 + Math.random() * 0.1), amp = H * 0.05;
  const pos = u => [-160 + (W + 320) * u, y0 + (y1 - y0) * (u * u * (3 - 2 * u)) + amp * Math.sin(u * Math.PI * 2)];
  // the plane's position and heading at a point u along the path
  const at = u => {
    const [x, y] = pos(u), [xa, ya] = pos(Math.min(1, u + 0.002)), ang = Math.atan2(ya - y, xa - x);
    const c = Math.cos(ang) * scale, sn = Math.sin(ang) * scale; // exhaust: just behind the tail
    return { x, y, ang, ex: x + c * (14 - 76) - sn * (24.6 - 19), ey: y + sn * (14 - 76) + c * (24.6 - 19) };
  };
  const trail = [];
  let lastU = 0;
  const t0 = performance.now();
  const frame = now => {
    const t = (now - t0) / 1000, u = Math.min(1, t / CROSS);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const { x, y, ang } = at(u);
    // fill the contrail in small steps along the path, so a dropped frame doesn't leave a straight kink
    for (let v = lastU + 0.003; lastU < 1 && v <= u + 1e-9; v += 0.003) {
      const p = at(Math.min(v, 1)); trail.push({ x: p.ex, y: p.ey, t: v * CROSS }); lastU = v;
    }
    // contrail: forms a little way behind the engine, then spreads out and fades
    g.lineCap = 'butt'; g.strokeStyle = trailCol;
    // drawn in runs of a few points, one stroke each, so overlapping segments don't show as stripes
    g.lineJoin = 'round';
    for (let i = 0; i < trail.length - 1; i += 6) {
      const run = trail.slice(i, i + 7), age = t - run[run.length >> 1].t;
      const a = Math.min(1, age / 0.25) * Math.max(0, 1 - age / FADE);
      if (a <= 0) continue;
      g.globalAlpha = 0.42 * a; g.lineWidth = (2 + age * 4) * scale;
      g.beginPath(); g.moveTo(run[0].x, run[0].y);
      for (const q of run) g.lineTo(q.x, q.y);
      g.stroke();
    }
    g.globalAlpha = 1;
    if (u < 1) {
      g.save(); g.translate(x, y); g.rotate(ang); g.scale(scale, scale); g.translate(-76, -19);
      g.fillStyle = flame; g.globalAlpha = 0.55 + Math.random() * 0.35;
      g.beginPath(); g.moveTo(14.4, 22.8); g.lineTo(-4 - Math.random() * 10, 24.6); g.lineTo(14.4, 26.4); g.fill();
      // drawn like the home hero: a see-through body, so the swept wing behind it shows through
      g.lineJoin = 'round'; g.strokeStyle = accent; g.fillStyle = soft;
      for (const [p, a, kind] of paths) {
        g.globalAlpha = a;
        if (kind === 'line') { g.lineWidth = 1.1; g.stroke(p); continue; }
        g.lineWidth = 1.6; g.fill(p); g.stroke(p);
      }
      g.globalAlpha = 1; g.fillStyle = accent; g.globalAlpha = .45; g.fill(glass);
      g.restore();
    }
    if (t < CROSS + FADE) requestAnimationFrame(frame);
    else { cv.remove(); flying = false; }
  };
  requestAnimationFrame(frame);
}

// ---------- the B-2 pass ----------
// Seen from above (like the logo): a slow, dead-straight pass with a ground shadow and twin contrails.
// A radar ring sweeps out across the screen and the bomber all but vanishes as the ring crosses it.
const B2 = 'M50 30 L5 59.2 L5 66.07 L20.63 55.94 L36.26 66.07 L43.13 61.6 L50 66.07 L56.87 61.6 L63.74 66.07 L79.37 55.94 L95 66.07 L95 59.2 Z';
const B2_LINES = 'M45.4 38 L43.4 60.5 M54.6 38 L56.6 60.5 M44.8 41.6 L37.8 43.6 M55.2 41.6 L62.2 43.6';
const B2_COCKPIT = 'M47.6 35 L52.4 35 L53.3 36.8 L46.7 36.8 Z';
const B2_ENGINES = [[39.9, 63], [60.1, 63]]; // exhaust points, in the same units as the outline
const B2_MID = [50, 48]; // turn the drawing about this point

function bomber() {
  flying = true;
  const cv = h('canvas', { class: 'flyby', 'aria-hidden': 'true' });
  document.body.append(cv);
  const g = cv.getContext('2d'), dpr = Math.min(2, devicePixelRatio || 1);
  const W = innerWidth, H = innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const bg = cssVar('--bg-elev'), accent = cssVar('--accent'), soft = cssVar('--accent-soft'), trailCol = cssVar('--text-2'), shade = cssVar('--text'), flame = cssVar('--hl');
  const body = new Path2D(B2), lines = new Path2D(B2_LINES), cockpit = new Path2D(B2_COCKPIT);
  const sc = Math.max(0.9, Math.min(1.6, W / 1000)); // outline units to pixels (about 90-145 px wingspan)
  const CROSS = 6, FADE = 3.4; // a heavy bomber: twice as long on screen as the jet
  // straight line, either direction, gently up or down
  const dir = Math.random() < 0.5 ? 1 : -1, m = 140 * sc;
  const ya = H * (0.3 + Math.random() * 0.45), yb = H * (0.25 + Math.random() * 0.5);
  const xa = dir > 0 ? -m : W + m, xb = dir > 0 ? W + m : -m;
  const ang = Math.atan2(yb - ya, xb - xa), rot = ang + Math.PI / 2; // the drawing's nose points up
  const cos = Math.cos(rot) * sc, sin = Math.sin(rot) * sc;
  const toWorld = (px, py, x, y) => [x + cos * (px - B2_MID[0]) - sin * (py - B2_MID[1]), y + sin * (px - B2_MID[0]) + cos * (py - B2_MID[1])];
  const pos = u => [xa + (xb - xa) * u, ya + (yb - ya) * u];
  // radar: a ring grows from a point near the middle of its path and sweeps past it
  const [rx, ry] = pos(0.35 + Math.random() * 0.3);
  const rcx = rx + (Math.random() - .5) * W * 0.5, rcy = ry + (Math.random() < .5 ? -1 : 1) * H * (0.25 + Math.random() * 0.2);
  const R_START = CROSS * 0.3, R_SPEED = Math.hypot(W, H) / 2.6, BAND = 70 * sc;
  const shadow = { dx: 26 * sc, dy: 40 * sc };
  const trails = [[], []];
  let lastU = 0;
  const t0 = performance.now();
  const frame = now => {
    const t = (now - t0) / 1000, u = Math.min(1, t / CROSS);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const [x, y] = pos(u);
    for (let v = lastU + 0.002; lastU < 1 && v <= u + 1e-9; v += 0.002) {
      const [px, py] = pos(Math.min(v, 1));
      B2_ENGINES.forEach(([ex, ey], i) => { const [wx, wy] = toWorld(ex, ey, px, py); trails[i].push({ x: wx, y: wy, t: v * CROSS }); });
      lastU = v;
    }
    // radar ring
    const rr = (t - R_START) * R_SPEED;
    if (rr > 0) {
      const ra = Math.max(0, 1 - rr / Math.hypot(W, H));
      g.globalAlpha = 0.5 * ra; g.strokeStyle = accent; g.lineWidth = 1.5;
      g.beginPath(); g.arc(rcx, rcy, rr, 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 0.08 * ra; g.lineWidth = BAND * 0.6;
      g.beginPath(); g.arc(rcx, rcy, Math.max(0, rr - BAND * 0.3), 0, Math.PI * 2); g.stroke();
    }
    // twin contrails: thin and tidy, then spreading and fading
    g.strokeStyle = trailCol; g.lineJoin = 'round'; g.lineCap = 'butt';
    for (const tr of trails) for (let i = 0; i < tr.length - 1; i += 6) {
      const run = tr.slice(i, i + 7), age = t - run[run.length >> 1].t;
      const a = Math.min(1, age / 0.35) * Math.max(0, 1 - age / FADE);
      if (a <= 0) continue;
      g.globalAlpha = 0.32 * a; g.lineWidth = (1.2 + age * 2.6) * sc;
      g.beginPath(); g.moveTo(run[0].x, run[0].y);
      for (const q of run) g.lineTo(q.x, q.y);
      g.stroke();
    }
    if (u < 1) {
      // stealth: fades to almost nothing while the radar ring passes over it
      const off = rr > 0 ? Math.abs(Math.hypot(x - rcx, y - rcy) - rr) : Infinity;
      const vis = 0.1 + 0.9 * Math.min(1, off / BAND);
      const place = (ox, oy) => { g.setTransform(dpr, 0, 0, dpr, 0, 0); g.translate(x + ox, y + oy); g.rotate(rot); g.scale(sc, sc); g.translate(-B2_MID[0], -B2_MID[1]); };
      place(shadow.dx, shadow.dy);
      g.globalAlpha = 0.1 * vis; g.fillStyle = shade; g.fill(body);
      place(0, 0);
      g.globalAlpha = (0.5 + Math.random() * 0.3) * vis; g.fillStyle = flame;
      for (const [ex, ey] of B2_ENGINES) {
        g.beginPath(); g.moveTo(ex - 2.4, ey); g.lineTo(ex, ey + 6 + Math.random() * 6); g.lineTo(ex + 2.4, ey); g.fill();
      }
      g.lineJoin = 'round'; g.lineCap = 'round'; g.strokeStyle = accent;
      g.globalAlpha = vis; g.fillStyle = bg; g.fill(body); g.fillStyle = soft; g.fill(body);
      g.lineWidth = 2.2; g.stroke(body);
      g.globalAlpha = 0.45 * vis; g.lineWidth = 1.4; g.stroke(lines);
      g.globalAlpha = vis; g.fillStyle = flame; g.fill(cockpit);
    }
    g.globalAlpha = 1;
    if (t < CROSS + FADE) requestAnimationFrame(frame);
    else { cv.remove(); flying = false; }
  };
  requestAnimationFrame(frame);
}

// ---------- shift-click the logo: a rocket launches up the screen ----------
// Accelerates off the pad, pitches over a little, and leaves a smoke column that spreads and drifts
// downwind (more wind higher up), plus a ground cloud at lift-off.
function launch() {
  flying = true;
  const cv = h('canvas', { class: 'flyby', 'aria-hidden': 'true' });
  document.body.append(cv);
  const g = cv.getContext('2d'), dpr = Math.min(2, devicePixelRatio || 1);
  const W = innerWidth, H = innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const bg = cssVar('--bg-elev'), accent = cssVar('--accent'), soft = cssVar('--accent-soft'), smoke = cssVar('--text-3'), flame = cssVar('--hl');
  const sc = Math.max(0.75, Math.min(1.2, H / 800));
  const x0 = W * (0.35 + Math.random() * 0.3), wind = (Math.random() < 0.5 ? -1 : 1) * (18 + Math.random() * 14);
  const BURN = 3.4, END = 7; // seconds on screen, seconds until the smoke is gone
  const puffs = [];
  const at = t => { // position and pitch: a hold-down beat, then accelerating, pitching over slightly downwind
    const tt = Math.max(0, t - 0.35), y = H + 10 - 0.5 * 170 * tt * tt * sc - 20 * tt;
    const ang = Math.min(0.28, tt * tt * 0.05) * Math.sign(wind);
    return { x: x0 + Math.sign(wind) * 6 * tt * tt * tt, y, ang, tt };
  };
  const t0 = performance.now();
  let lastT = 0;
  const frame = now => {
    const t = (now - t0) / 1000, dt = Math.min(0.05, t - lastT); lastT = t;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const r = at(t), onScreen = r.y > -140;
    // new smoke at the nozzle; on the pad it billows sideways into a ground cloud
    if (t < BURN && onScreen) {
      const nx = r.x, ny = r.y;
      const pad = r.tt < 0.9;
      for (let i = 0; i < (pad ? 3 : 2); i++) {
        puffs.push({ x: nx + (Math.random() - .5) * 6, y: ny + Math.random() * 8, t,
          vx: pad ? (Math.random() - .5) * 220 : (Math.random() - .5) * 14, vy: pad ? -Math.random() * 20 : 30 + Math.random() * 30,
          r0: (pad ? 10 : 5) * sc, life: pad ? 3.6 : 2.6 + Math.random() });
      }
    }
    for (const p of puffs) { // drift downwind, more so higher up; slow down; grow; fade
      const age = t - p.t, high = 1 - Math.max(0, Math.min(1, p.y / H));
      p.vx *= 1 - 1.6 * dt; p.vy *= 1 - 1.6 * dt;
      p.x += (p.vx + wind * (0.3 + high)) * dt; p.y += p.vy * dt;
      const a = Math.min(1, age / 0.2) * Math.max(0, 1 - age / p.life);
      if (a <= 0) continue;
      g.globalAlpha = 0.07 * a; g.fillStyle = smoke;
      g.beginPath(); g.arc(p.x, p.y, p.r0 + age * 20 * sc, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    if (onScreen) {
      g.save(); g.translate(r.x, r.y); g.rotate(r.ang); g.scale(sc, sc);
      // plume: a flickering outer flame and a bright core below the nozzle
      const len = (r.tt > 0 ? 34 : 18) + Math.random() * 12;
      g.globalAlpha = 0.75; g.fillStyle = flame;
      g.beginPath(); g.moveTo(-6, 0); g.quadraticCurveTo(0, len * 1.4, 6, 0); g.fill();
      g.globalAlpha = 0.95; g.fillStyle = '#ffe6df';
      g.beginPath(); g.moveTo(-3, 0); g.quadraticCurveTo(0, len * 0.7, 3, 0); g.fill();
      // the rocket: nozzle, fins, body with a stage band, nose cone (same line style as the logo plane)
      g.globalAlpha = 1; g.lineJoin = 'round'; g.lineWidth = 1.5; g.strokeStyle = accent;
      const shape = (d, fillSoft = true) => { const p = new Path2D(d); g.fillStyle = bg; g.fill(p); if (fillSoft) { g.fillStyle = soft; g.fill(p); } g.stroke(p); };
      shape('M-5 -6 L-6.5 0 L6.5 0 L5 -6 Z');
      shape('M-8 -10 L-16 2 L-16 -6 L-8 -26 Z'); shape('M8 -10 L16 2 L16 -6 L8 -26 Z');
      shape('M-8 -6 L-8 -78 L8 -78 L8 -6 Z');
      shape('M-8 -78 C-8 -92 -3 -102 0 -106 C3 -102 8 -92 8 -78 Z');
      g.beginPath(); g.moveTo(-8, -48); g.lineTo(8, -48); g.stroke();
      g.globalAlpha = .45; g.fillStyle = accent; g.beginPath(); g.arc(0, -64, 3, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    if (t < END) requestAnimationFrame(frame);
    else { cv.remove(); flying = false; }
  };
  requestAnimationFrame(frame);
}
