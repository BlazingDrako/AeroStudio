// Small line-art previews for the home-page cards. Each draws a module's signature visual in a 320×120 box,
// using theme colors from CSS so it follows light and dark. Hover animations (see .card-preview in styles.css):
// .flow = dashes drift, .trace = a bright dash runs along the line (needs pathLength="100"),
// .spin = turns about its own center, .flicker = flame pulse, .press = pushes down, .flex = sags and recovers, .jitter = shakes.

const W = 320, H = 120;
const f = v => +v.toFixed(1);
const pts = a => a.map(([x, y], i) => (i ? 'L' : 'M') + f(x) + ' ' + f(y)).join(' ');
const svg = body => `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${body}</svg>`;
const trace = (d, cls = '') => `<path class="trace ${cls}" pathLength="100" d="${d}"/>`;

// NACA 4-digit surface, pitched nose-up by angle a (deg) about the quarter chord, placed at (x0, y0) with chord c px
function naca(m, p, t, c, x0, y0, a) {
  const up = [], lo = [], ca = Math.cos(a * Math.PI / 180), sa = Math.sin(a * Math.PI / 180);
  for (let i = 0; i <= 40; i++) {
    const x = (1 - Math.cos(Math.PI * i / 40)) / 2;
    const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const yc = x < p ? m / p / p * (2 * p * x - x * x) : m / (1 - p) ** 2 * (1 - 2 * p + 2 * p * x - x * x);
    const tr = (X, Y) => { const dx = (X - 0.25) * c, dy = -Y * c; return [x0 + dx * ca - dy * sa, y0 + dx * sa + dy * ca]; };
    up.push(tr(x, yc + yt)); lo.push(tr(x, yc - yt));
  }
  return { up, lo };
}

function airfoil() {
  const { up, lo } = naca(0.02, 0.4, 0.12, 150, 128, 62, 8);
  let s = '';
  for (const k of [-3, -2, -1, 1, 2, 3]) {
    const y0 = 64 + k * 14, line = [];
    for (let x = 0; x <= W; x += 6) {
      const g = Math.exp(-(((x - 150) / 70) ** 2));
      const d = k < 0 ? 12 / -k : 4 / k; // lines over the top crowd upward; upwash ahead, downwash behind
      line.push([x, y0 - g * d + (x - 150) * 0.05 * g]);
    }
    s += `<path class="pv-stream flow" d="${pts(line)}"/>`;
  }
  s += `<path class="pv-fill" d="${pts(up)} ${pts(lo.slice().reverse()).replace('M', 'L')} Z"/>`;
  s += `<path class="pv-up" d="${pts(up)}"/><path class="pv-lo" d="${pts(lo)}"/>`;
  s += `<path class="pv-arrow bob" d="M128 60 L128 20 M123 27 L128 20 L133 27"/>`;
  return svg(s);
}

function compressible() {
  // converging–diverging nozzle with a normal shock in the diverging part, then Mach diamonds in the plume
  const top = [], bot = [];
  for (let x = 20; x <= 190; x += 5) {
    const r = x < 90 ? 16 + 30 * ((90 - x) / 70) ** 1.6 : 16 + 22 * Math.sqrt((x - 90) / 100);
    top.push([x, 60 - r]); bot.push([x, 60 + r]);
  }
  let s = `<defs><linearGradient id="pv-mach" x1="0" x2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".08"/><stop offset=".62" stop-color="var(--accent)" stop-opacity=".45"/><stop offset=".63" stop-color="var(--lower)" stop-opacity=".25"/><stop offset="1" stop-color="var(--lower)" stop-opacity=".12"/></linearGradient></defs>`;
  s += `<path class="pv-grad" d="${pts(top)} ${pts(bot.slice().reverse()).replace('M', 'L')} Z"/>`;
  s += `<path class="pv-wall" d="${pts(top)}"/><path class="pv-wall" d="${pts(bot)}"/>`;
  s += `<path class="pv-shock jitter" d="M146 ${f(60 - 16 - 22 * Math.sqrt(.56))} L146 ${f(60 + 16 + 22 * Math.sqrt(.56))}"/>`;
  let d = '';
  for (let i = 0; i < 4; i++) { const x = 190 + i * 30, h = 32 - i * 5; d += `M${x} ${60 - h} L${x + 15} 60 L${x} ${60 + h} M${x + 15} 60 L${x + 30} ${60 - h + 5} M${x + 15} 60 L${x + 30} ${60 + h - 5} `; }
  s += `<path class="pv-wave flow" d="${d}"/>`;
  return svg(s);
}

function cfd() {
  // cylinder shedding a Kármán vortex street
  let s = `<path class="pv-stream flow" d="M0 30 C60 30 70 22 110 24 S220 34 320 30 M0 90 C60 90 70 98 110 96 S220 86 320 90"/>`;
  for (let i = 0; i < 6; i++) {
    const x = 92 + i * 38, upper = i % 2 === 0, y = upper ? 50 : 70, r = 9 + i * 1.3;
    const sp = [];
    for (let t = 0; t <= 3.4 * Math.PI; t += 0.25) { const rr = r * t / (3.4 * Math.PI); sp.push([x + rr * Math.cos(upper ? t : -t), y + rr * Math.sin(upper ? t : -t)]); }
    // spin about the spiral's own center (upper vortices turn one way, lower the other)
    s += `<g class="spin ${upper ? '' : 'rev'}" style="transform-origin:${x}px ${y}px"><path class="${upper ? 'pv-vort-a' : 'pv-vort-b'}" d="${pts(sp)}"/></g>`;
  }
  s += `<circle class="pv-body" cx="60" cy="60" r="16"/>`;
  return svg(s);
}

function propulsion() {
  // turbofan cut-away: nacelle, fan, compressor, combustor, turbine, nozzle
  let s = `<path class="pv-wall" d="M28 22 Q40 14 70 16 L250 24 L292 40 M28 98 Q40 106 70 104 L250 96 L292 80"/>`;
  s += `<path class="pv-fill" d="M70 50 Q60 60 70 70 L120 66 L232 68 L262 62 L262 58 L232 52 L120 54 Z"/>`;
  for (let i = 0; i < 2; i++) s += `<path class="pv-blade" d="M${52 + i * 9} 22 L${56 + i * 9} 98"/>`;
  for (let i = 0; i < 7; i++) { const x = 92 + i * 8, h = 24 - i * 2; s += `<path class="pv-blade" d="M${x} ${54 - h} L${x + 3} 54 M${x} ${66 + h} L${x + 3} 66"/>`; }
  s += `<path class="pv-flame flicker" d="M158 46 Q172 40 186 46 Q172 50 158 46 Z M158 74 Q172 80 186 74 Q172 70 158 74 Z"/>`;
  for (let i = 0; i < 4; i++) { const x = 196 + i * 9, h = 12 + i * 3; s += `<path class="pv-blade warm" d="M${x} ${52 - h} L${x + 3} 52 M${x} ${68 + h} L${x + 3} 68"/>`; }
  s += `<path class="pv-stream flow" d="M0 40 L40 40 M0 60 L48 60 M0 80 L40 80 M266 56 L320 54 M266 64 L320 66"/>`;
  return svg(s);
}

function structures() {
  // simply supported beam: distributed load on top, parabolic bending-moment diagram underneath
  let arrows = '';
  for (let x = 50; x <= 270; x += 20) arrows += `<path class="pv-arrow thin" d="M${x} 10 L${x} 28 M${x - 3} 23 L${x} 28 L${x + 3} 23"/>`;
  let s = `<g class="press">${arrows}<path class="pv-arrow thin" d="M50 10 L270 10"/></g>`;
  s += `<rect class="pv-beam" x="40" y="30" width="240" height="9" rx="1.5"/>`;
  s += `<path class="pv-support" d="M50 39 L42 51 L58 51 Z M270 39 L262 49 L278 49 Z"/><circle class="pv-support" cx="266" cy="51.5" r="2"/><circle class="pv-support" cx="274" cy="51.5" r="2"/>`;
  const m = []; for (let x = 50; x <= 270; x += 5) { const u = (x - 50) / 220; m.push([x, 62 + 48 * 4 * u * (1 - u)]); }
  s += `<g class="flex"><path class="pv-mfill" d="M50 62 ${pts(m).replace('M', 'L')} L270 62 Z"/><path class="pv-mline" d="${pts(m)}"/></g><path class="pv-axis" d="M44 62 L276 62"/>`;
  return svg(s);
}

function flight() {
  // like the Flight module's wind & turbulence scene: an aircraft flying through a frozen gust field
  // (blue arrows = updraft, orange = downdraft). The field repeats every 160 units so it can scroll seamlessly.
  const P = 160, midY = 76;
  const w = x => 0.6 * Math.sin(2 * Math.PI * x / P) + 0.35 * Math.sin(6 * Math.PI * x / P + 1) + 0.2 * Math.sin(10 * Math.PI * x / P + 2);
  let up = '', dn = '';
  for (let x = 0; x < W + P; x += 10) {
    const len = w(x) * 22, d = Math.sign(len), tip = midY - len;
    const a = `M${x} ${midY} L${x} ${f(tip)}` + (Math.abs(len) > 4 ? ` M${x - 3} ${f(tip + 5 * d)} L${x} ${f(tip)} L${x + 3} ${f(tip + 5 * d)}` : '');
    if (len > 0) up += a; else dn += a;
  }
  let s = `<g class="scroll"><path class="pv-gust-up" d="${up}"/><path class="pv-gust-dn" d="${dn}"/></g>`;
  s += `<path class="pv-dash" d="M0 ${midY} L${W} ${midY}"/>`;
  // aircraft silhouette (same outline as the module's scene), nose to the right
  s += `<g class="heave" transform="translate(110 36) scale(1.5)"><path class="pv-plane" d="M26 0 Q22 -4 10 -4 L-18 -3 L-26 -13 L-30 -13 L-26 -2 L-28 2 L-18 3 L10 3 Q22 3 26 0 Z"/><path class="pv-plane dim" d="M4 0 L-8 7 L-12 7 L-6 0 Z"/></g>`;
  return svg(s);
}

function gnc() {
  // navigation map: range rings round a radio beacon, a dashed route through waypoints, the aircraft travelling along it
  const wps = [[28, 92], [96, 34], [168, 84], [236, 36], [298, 74]];
  const route = wps.map(([x, y], i) => (i ? 'L' : 'M') + x + ' ' + y).join(' ');
  let s = '';
  for (const r of [24, 48, 72]) s += `<circle class="pv-grid" cx="160" cy="60" r="${r}"/>`;
  s += `<path class="pv-grid" d="M160 -20 L160 140 M60 60 L260 60"/>`;
  s += `<path class="pv-beacon" d="M160 54 L165 57 L165 63 L160 66 L155 63 L155 57 Z"/>`;
  s += `<path class="pv-route" d="${route}"/>`;
  for (const [x, y] of wps) s += `<path class="pv-wp" d="M${x} ${y - 5} L${x + 5} ${y} L${x} ${y + 5} L${x - 5} ${y} Z"/>`;
  s += `<path class="pv-travel" pathLength="100" d="${route}"/>`;
  return svg(s);
}

function formulas() {
  const c = []; for (let x = 0; x <= 120; x += 4) c.push([190 + x, 98 - 0.0055 * x * x]);
  let s = `<text class="pv-eq" x="24" y="56">L = ½ ρ V² S C<tspan class="pv-sub" dy="4">L</tspan></text>`;
  s += `<rect class="pv-caret" x="24" y="74" width="8" height="2" rx="1"/>`;
  s += `<path class="pv-axis" d="M190 20 L190 98 L314 98"/><path class="pv-up" d="${pts(c)}"/>`;
  s += `<path class="pv-dot-track" pathLength="100" d="${pts(c)}"/>`;
  return svg(s);
}

function rocket() {
  // side view of a rocket's tail end: body running off the left edge, swept fins, a bell nozzle and its plume
  let s = `<path class="pv-stream flow" d="M-80 24 L74 24 M-80 96 L74 96 M-80 12 L50 12 M-80 108 L50 108"/>`;
  s += `<path class="pv-flame flicker" d="M192 37 Q258 30 330 60 Q258 90 192 83 Z"/>`;
  s += `<path class="pv-flame-core flicker" d="M192 48 Q232 45 276 60 Q232 75 192 72 Z"/>`;
  s += `<path class="pv-wave flow" d="M202 50 L217 60 L202 70 M217 60 L232 50 M217 60 L232 70 M232 50 L247 60 L232 70"/>`;
  s += `<path class="pv-fill" d="M140 53 C152 55 164 46 194 35 L194 85 C164 74 152 65 140 67 Z"/>`;
  s += `<path class="pv-wall" d="M140 53 C152 55 164 46 194 35 M140 67 C152 65 164 74 194 85"/>`;
  s += `<path class="pv-rbody" d="M-80 38 L128 38 L140 46 L140 74 L128 82 L-80 82 Z"/>`;
  s += `<path class="pv-axis" d="M20 38 L20 82 M128 38 L128 82"/>`;
  s += `<path class="pv-fin" d="M70 38 L112 38 L138 10 L116 10 Z M70 82 L112 82 L138 110 L116 110 Z"/>`;
  return svg(s);
}

function orbits() {
  let s = `<circle class="pv-body" cx="160" cy="60" r="12"/>`;
  s += `<ellipse class="pv-dash flow" cx="160" cy="60" rx="38" ry="30"/><ellipse class="pv-up" cx="160" cy="60" rx="120" ry="50"/>`;
  s += `<path class="pv-lo" d="M122 60 A79 42 0 0 1 280 60"/>`;
  s += trace('M122 60 A79 42 0 0 1 280 60', 'lo');
  return svg(s);
}

function wings() {
  // close-up top view of an airliner: fuselage running off the top edge, swept wings with engines,
  // the tailplane below, and tip vortices trailing back from both wingtips
  const wing = 'M160 18 L26 48 L26 60 L160 64 L294 60 L294 48 Z', tail = 'M160 84 L114 98 L114 108 L160 106 L206 108 L206 98 Z';
  let s = `<path class="pv-stream flow" d="M62 62 L62 130 M98 63 L98 130 M222 63 L222 130 M258 62 L258 130"/>`;
  s += `<path class="pv-fill" d="${tail}"/><path class="pv-wall" d="${tail}"/>`;
  s += `<path class="pv-fill" d="${wing}"/><path class="pv-wall" d="${wing}"/>`;
  s += `<rect class="pv-rbody" x="94" y="22" width="11" height="24" rx="4"/><rect class="pv-rbody" x="215" y="22" width="11" height="24" rx="4"/>`;
  s += `<path class="pv-rbody" d="M147 -10 L147 68 Q149 94 153 112 Q160 117 167 112 Q171 94 173 68 L173 -10 Z"/>`;
  for (const [x, upper] of [[26, true], [294, false]]) {
    for (const [y, r] of [[78, 10], [104, 9]]) {
      const sp = [];
      for (let t = 0; t <= 3 * Math.PI; t += 0.25) { const rr = r * t / (3 * Math.PI); sp.push([x + rr * Math.cos(upper ? t : -t), y + rr * Math.sin(upper ? t : -t)]); }
      s += `<g class="spin ${upper ? '' : 'rev'}" style="transform-origin:${x}px ${y}px"><path class="${upper ? 'pv-vort-a' : 'pv-vort-b'}" d="${pts(sp)}"/></g>`;
    }
  }
  return svg(s);
}

function rotors() {
  // a three-bladed propeller seen from the front: tapered blades round a spinner, the disk they sweep, and air flowing past
  let blades = '';
  for (const a of [0, 120, 240]) blades += `<path class="pv-fin" transform="rotate(${a} 160 60)" d="M160 52 C167 44 169 26 164 8 C162 5 158 5 156 8 C152 26 153 44 160 52 Z"/>`;
  let s = `<path class="pv-stream flow" d="M0 26 L92 26 M0 60 L84 60 M0 94 L92 94 M228 26 L320 26 M236 60 L320 60 M228 94 L320 94"/>`;
  s += `<circle class="pv-dash" cx="160" cy="60" r="54"/><circle class="pv-support" cx="160" cy="60" r="15"/>`;
  s += `<g class="spin" style="transform-origin:160px 60px">${blades}</g><circle class="pv-body" cx="160" cy="60" r="8"/>`;
  return svg(s);
}

function materials() {
  // a riveted skin panel pulled top and bottom, a fatigue crack growing out of one rivet hole,
  // and the panel's end peeled back into composite plies at 0°, 45° and 90°
  let arrows = '';
  for (const x of [50, 90, 130, 170, 210]) arrows += `M${x} 2 L${x} 12 M${x - 3} 5 L${x} 2 L${x + 3} 5 M${x} 108 L${x} 118 M${x - 3} 115 L${x} 118 L${x + 3} 115 `;
  let s = `<g class="press"><path class="pv-arrow thin" d="${arrows}"/></g>`;
  s += `<defs><clipPath id="pv-ply0"><rect x="226" y="18" width="120" height="84"/></clipPath><clipPath id="pv-ply1"><rect x="244" y="18" width="120" height="84"/></clipPath><clipPath id="pv-ply2"><rect x="262" y="18" width="120" height="84"/></clipPath></defs>`;
  const hatch = (k, ang) => {
    let d = '';
    for (let i = -18; i <= 18; i++) {
      const c = 260 + i * 10;
      if (ang === 0) d += `M200 ${60 + i * 10} L340 ${60 + i * 10} `;
      else if (ang === 90) d += `M${c} 0 L${c} 120 `;
      else d += `M${c - 60} 120 L${c + 60} 0 `;
    }
    return `<rect class="pv-beam" x="${226 + 18 * k}" y="18" width="120" height="84" rx="1.5"/><path class="pv-ply" clip-path="url(#pv-ply${k})" d="${d}"/>`;
  };
  s += hatch(0, 0) + hatch(1, 45) + hatch(2, 90);
  s += `<rect class="pv-beam" x="24" y="18" width="208" height="84" rx="2"/>`;
  for (const x of [50, 90, 130, 170, 210]) s += `<circle class="pv-support" cx="${x}" cy="60" r="4"/>`;
  s += `<path class="pv-shock jitter" d="M126 60 L121 58 L116 61 L110 59 L104 61 M134 60 L139 62 L144 59 L150 61 L156 59"/>`;
  return svg(s);
}

function launch() {
  // a capsule coming home blunt end first: the bow shock standing off its heat shield, glowing hot gas between them,
  // the oncoming air turned by the shock, and the wake closing in behind
  let s = `<path class="pv-stream flow" d="M-40 60 L92 60 M-40 38 L96 38 M-40 82 L96 82 M-40 14 L112 12 Q150 2 200 -2 M-40 106 L112 108 Q150 118 200 122"/>`;
  s += `<path class="pv-stream flow" d="M198 48 C230 54 260 57 340 58 M198 72 C230 66 260 63 340 62"/>`;
  s += `<path class="pv-flame flicker r" d="M146 4 Q100 26 100 60 Q100 94 146 116 L134 98 Q118 60 134 22 Z"/>`;
  s += `<path class="pv-shock jitter" d="M160 -6 Q98 18 98 60 Q98 102 160 126"/>`;
  s += `<path class="pv-rbody" d="M134 22 L192 46 Q197 60 192 74 L134 98 Q118 60 134 22 Z"/>`;
  s += `<path class="pv-lo" d="M134 22 Q118 60 134 98"/><path class="pv-axis" d="M178 41 L178 79"/>`;
  s += `<rect class="pv-support" x="148" y="49" width="16" height="22" rx="3"/><circle class="pv-axis" cx="156" cy="57" r="3.5"/>`;
  return svg(s);
}

function spacecraft() {
  // a satellite with its solar wings in sunlight, a reaction wheel turning inside it, and Earth below
  let s = `<path class="pv-stream flow" d="M0 22 L60 22 M0 42 L56 42 M0 78 L56 78 M0 98 L60 98"/>`;
  s += `<circle class="pv-body" cx="300" cy="190" r="110"/>`;
  s += `<path class="pv-axis" d="M128 60 L148 60 M172 60 L192 60 M160 46 L160 36 M154 34 L166 34"/>`;
  for (const x0 of [70, 192]) {
    s += `<rect class="pv-fin" x="${x0}" y="46" width="58" height="28" rx="1.5"/>`;
    s += `<path class="pv-axis" d="M${x0 + 14.5} 46 L${x0 + 14.5} 74 M${x0 + 29} 46 L${x0 + 29} 74 M${x0 + 43.5} 46 L${x0 + 43.5} 74 M${x0} 60 L${x0 + 58} 60"/>`;
  }
  s += `<rect class="pv-rbody" x="146" y="46" width="28" height="28" rx="3"/>`;
  s += `<g class="spin" style="transform-origin:160px 60px"><circle class="pv-mline" cx="160" cy="60" r="8"/><path class="pv-mline" d="M160 52 L160 68 M152 60 L168 60"/></g>`;
  return svg(s);
}

function design() {
  // a layout drawing on a grid: top view of an aircraft with its wings shaded, and dimension lines for the span and length
  let s = '';
  for (let x = 0; x <= W; x += 20) s += `<path class="pv-grid" d="M${x} 0 L${x} ${H}"/>`;
  for (let y = 0; y <= H; y += 20) s += `<path class="pv-grid" d="M0 ${y} L${W} ${y}"/>`;
  const wing = 'M190 54 L160 18 L146 18 L150 54 L150 66 L146 102 L160 102 L190 66 Z';
  s += `<path class="pv-fin" d="M78 54 L62 34 L54 34 L56 54 Z M78 66 L62 86 L54 86 L56 66 Z"/>`;
  s += `<path class="pv-fin" d="${wing}"/>${trace(wing)}`;
  s += `<path class="pv-rbody" d="M48 56 L60 54 L232 54 Q262 54 274 60 Q262 66 232 66 L60 66 L48 64 Z"/>`;
  s += `<path class="pv-dash" d="M162 18 L306 18 M162 102 L306 102 M48 66 L48 116 M274 66 L274 116"/>`;
  s += `<path class="pv-arrow thin" d="M300 18 L300 102 M297 23 L300 18 L303 23 M297 97 L300 102 L303 97 M48 112 L274 112 M53 109 L48 112 L53 115 M269 109 L274 112 L269 115"/>`;
  return svg(s);
}

export const PREVIEWS = { airfoil, compressible, cfd, turbine: propulsion, structures, flight, gnc, formulas, rocket, orbits, wings, rotors, materials, launch, spacecraft, design };
