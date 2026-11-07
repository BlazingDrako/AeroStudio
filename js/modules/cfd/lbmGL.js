// Lattice-Boltzmann solver and renderer on the GPU (WebGL2). Runs the same algorithm as the CPU
// reference in js/solvers/lbm.js (see there for the method, cell types and boundary conditions).
// Storage: three RGBA32F textures per state (f0–f3, f4–f7, [f8, ρ, ux, uy]), ping-ponged; a cell texture
// (RGBA16F: type, next-to-solid flag, cell velocity) that can be updated while running.
// Extra passes: dye advection (RGBA16F, semi-Lagrangian), a display field (vorticity, speed, Cp),
// and drawing to the canvas. Interactive extras not in the CPU reference: stirring and dye sources.
import { W, BCX, BCY, feq } from '../../solvers/lbm.js';

const DYE_EVERY = 4;   // dye is moved every few steps: fewer interpolations = less smearing
const MAX_SRC = 12;    // dye sources

const VS = `#version 300 es
in vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const COMMON = `#version 300 es
precision highp float;
precision highp int;
const int EX[9] = int[9](0, 1, 0, -1, 0, 1, -1, -1, 1);
const int EY[9] = int[9](0, 0, 1, 0, -1, 1, 1, -1, -1);
const float WQ[9] = float[9](${W.map(w => w.toFixed(10)).join(', ')});
const int OPP[9] = int[9](0, 3, 4, 1, 2, 7, 8, 5, 6);
const int MIRY[9] = int[9](0, 1, 4, 3, 2, 8, 7, 6, 5);
float comp(vec4 v, int i) { return i == 0 ? v.x : i == 1 ? v.y : i == 2 ? v.z : v.w; }
// cell texture: r = type (0 fluid, 1 solid, 0.25 forced), g = next to a solid, ba = cell velocity
bool isSolid(vec4 m) { return m.r > 0.75; }
bool isForced(vec4 m) { return m.r > 0.1 && m.r < 0.75; }
`;

const FS_LBM = COMMON + `
uniform sampler2D uA, uB, uC, uMask;
uniform ivec2 uN, uBC;
uniform float uIn, uTau, uCs, uWob;
uniform vec3 uSponge;
uniform vec2 uF, uLid, uStirU;
uniform vec3 uStir;
layout(location = 0) out vec4 oA;
layout(location = 1) out vec4 oB;
layout(location = 2) out vec4 oC;
float fget(ivec2 c, int q) {
  if (q < 4) return comp(texelFetch(uA, c, 0), q);
  if (q < 8) return comp(texelFetch(uB, c, 0), q - 4);
  return texelFetch(uC, c, 0).x;
}
float feq(int q, float r, vec2 u) {
  float eu = float(EX[q]) * u.x + float(EY[q]) * u.y;
  return WQ[q] * r * (1.0 + 3.0 * eu + 4.5 * eu * eu - 1.5 * dot(u, u));
}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 mc = texelFetch(uMask, c, 0);
  if (mc.r > 0.1) {
    vec2 v = mc.ba;
    if (isForced(mc)) v.y += uWob; // small side-to-side wobble of jets (seeds their instability)
    oA = vec4(feq(0, 1.0, v), feq(1, 1.0, v), feq(2, 1.0, v), feq(3, 1.0, v));
    oB = vec4(feq(4, 1.0, v), feq(5, 1.0, v), feq(6, 1.0, v), feq(7, 1.0, v));
    oC = vec4(feq(8, 1.0, v), 1.0, v);
    return;
  }
  float f[9];
  for (int q = 0; q < 9; q++) {
    ivec2 s = c - ivec2(EX[q], EY[q]);
    int d = q; bool done = false; float v = 0.0;
    if (s.y < 0 || s.y >= uN.y) {
      if (uBC.y == 2) s.y = (s.y + uN.y) % uN.y;
      else if (uBC.y == 1) { v = fget(c, OPP[q]) + 6.0 * WQ[q] * float(EX[q]) * (s.y < 0 ? uLid.x : uLid.y); done = true; }
      else { s.y = c.y; d = MIRY[q]; }
    }
    if (!done) {
      if (s.x < 0) {
        if (uBC.x == 1) s.x += uN.x;
        else if (uBC.x == 2) { v = fget(c, OPP[q]); done = true; }
        else { v = feq(d, 1.0, vec2(uIn, 0.0)); done = true; }
      } else if (s.x >= uN.x) {
        if (uBC.x == 1) s.x -= uN.x;
        else if (uBC.x == 2) { v = fget(c, OPP[q]); done = true; }
        else s.x = uN.x - 1;
      }
    }
    if (!done) {
      vec4 ms = texelFetch(uMask, s, 0);
      v = isSolid(ms) ? fget(c, OPP[q]) + 6.0 * WQ[q] * (float(EX[q]) * ms.b + float(EY[q]) * ms.a) : fget(s, d);
    }
    f[q] = v;
  }
  float rho = 0.0; vec2 m = vec2(0.0);
  for (int q = 0; q < 9; q++) { rho += f[q]; m += vec2(float(EX[q]), float(EY[q])) * f[q]; }
  vec2 F = uF;
  if (uStir.z > 0.0) { // stirring: nudge the local velocity toward the pointer's
    vec2 dd = (vec2(c) + 0.5 - uStir.xy) / uStir.z;
    float w = exp(-dot(dd, dd));
    if (w > 0.01) F += rho * 0.12 * w * (uStirU - m / rho);
  }
  vec2 u = (m + 0.5 * F) / rho;
  if (!(rho > 0.05 && rho < 20.0)) { rho = 1.0; u = vec2(uIn, 0.0); for (int q = 0; q < 9; q++) f[q] = feq(q, 1.0, u); }
  float fe[9];
  float pxx = 0.0, pyy = 0.0, pxy = 0.0;
  for (int q = 0; q < 9; q++) {
    fe[q] = feq(q, rho, u);
    float ne = f[q] - fe[q], ex = float(EX[q]), ey = float(EY[q]);
    pxx += ex * ex * ne; pyy += ey * ey * ne; pxy += ex * ey * ne;
  }
  float t = uTau;
  if (uCs > 0.0) { float Q = sqrt(2.0 * (pxx * pxx + pyy * pyy + 2.0 * pxy * pxy)); t = 0.5 * (uTau + sqrt(uTau * uTau + 18.0 * uCs * uCs * Q / rho)); }
  float om = 1.0 / t, fk = 1.0 - 0.5 / t;
  float sg = 0.0;
  if (uSponge.x > 0.0) { // absorbing layer: relax the density toward 1 near the slip walls and the outlet
    float a = 0.0;
    if (uSponge.y > 0.0) { float d = min(float(c.y) + 0.5, float(uN.y - c.y) - 0.5); if (d < uSponge.y) a = (1.0 - d / uSponge.y) * (1.0 - d / uSponge.y); }
    if (uSponge.z > 0.0) { float d = float(uN.x - c.x) - 0.5; if (d < uSponge.z) a = max(a, (1.0 - d / uSponge.z) * (1.0 - d / uSponge.z)); }
    sg = uSponge.x * a;
  }
  bool forced = F.x != 0.0 || F.y != 0.0;
  float g[9];
  for (int q = 0; q < 9; q++) {
    float Fq = 0.0;
    if (forced) { vec2 e = vec2(float(EX[q]), float(EY[q])); float eu = dot(e, u); Fq = WQ[q] * fk * (3.0 * dot(e - u, F) + 9.0 * eu * dot(e, F)); }
    g[q] = f[q] - om * (f[q] - fe[q]) + Fq;
    if (sg > 0.0) g[q] += sg * (feq(q, 1.0, u) - fe[q]);
  }
  oA = vec4(g[0], g[1], g[2], g[3]); oB = vec4(g[4], g[5], g[6], g[7]); oC = vec4(g[8], rho, u);
}`;

// Dye: r = streaks released at the inlet, g = dye from obstacle surfaces and jets, b = dye sources and stirring.
const FS_DYE = COMMON + `
uniform sampler2D uDye, uC, uMask;
uniform ivec2 uN;
uniform float uStreaks, uBody, uSpace, uDecay, uDt;
uniform vec3 uStir;
uniform vec2 uSrc[${MAX_SRC}];
uniform int uNSrc;
out vec4 o;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 mk = texelFetch(uMask, c, 0);
  if (isSolid(mk)) { o = vec4(0.0); return; }
  vec2 u = texelFetch(uC, c, 0).zw;
  vec4 d = texture(uDye, (vec2(c) + 0.5 - uDt * u) / vec2(uN)) * pow(uDecay, uDt);
  if (uStreaks > 0.5 && c.x < 2) {
    float m = mod(float(c.y) + 0.5 * uSpace, uSpace);
    d.r = m < uSpace * 0.4 ? 1.0 : 0.0;
  }
  if (uBody > 0.5 && mk.g > 0.5) d.g = 1.0;
  if (isForced(mk)) d.g = 1.0;
  vec2 p = vec2(c) + 0.5;
  for (int i = 0; i < ${MAX_SRC}; i++) { if (i >= uNSrc) break; if (distance(p, uSrc[i]) < 2.5) d.b = 1.0; }
  if (uStir.z > 0.0 && distance(p, uStir.xy) < 0.6 * uStir.z) d.b = 1.0;
  o = d;
}`;

// Force on each solid cell from its fluid neighbours (momentum exchange; same formula as LBM.cellForces)
const FS_FORCE = COMMON + `
uniform sampler2D uA, uB, uC, uMask;
uniform ivec2 uN;
out vec4 o;
float fget(ivec2 c, int q) {
  if (q < 4) return comp(texelFetch(uA, c, 0), q);
  if (q < 8) return comp(texelFetch(uB, c, 0), q - 4);
  return texelFetch(uC, c, 0).x;
}
void main() {
  ivec2 s = ivec2(gl_FragCoord.xy);
  vec4 ms = texelFetch(uMask, s, 0);
  if (!isSolid(ms)) { o = vec4(0.0); return; }
  vec2 F = vec2(0.0);
  for (int q = 1; q < 9; q++) {
    ivec2 n = s + ivec2(EX[q], EY[q]);
    if (n.x < 0 || n.y < 0 || n.x >= uN.x || n.y >= uN.y) continue;
    if (texelFetch(uMask, n, 0).r > 0.1) continue;
    vec2 e = vec2(float(EX[q]), float(EY[q]));
    F -= e * (2.0 * fget(n, OPP[q]) + 6.0 * WQ[q] * dot(e, ms.ba));
  }
  o = vec4(F, 0.0, 0.0);
}`;

// Display field: x = vorticity·L/U, y = speed/U, z = Cp, w = 0
const FS_FIELD = COMMON + `
uniform sampler2D uC;
uniform ivec2 uN;
uniform float uU, uL;
out vec4 o;
vec2 vel(ivec2 c) { return texelFetch(uC, clamp(c, ivec2(0), uN - 1), 0).zw; }
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 C = texelFetch(uC, c, 0);
  float w = 0.5 * ((vel(c + ivec2(1, 0)).y - vel(c - ivec2(1, 0)).y) - (vel(c + ivec2(0, 1)).x - vel(c - ivec2(0, 1)).x));
  float cp = (C.y - 1.0) / 3.0 / (0.5 * uU * uU);
  o = vec4(w * uL / uU, length(C.zw) / uU, cp, 0.0);
}`;

const FS_DRAW = COMMON + `
uniform sampler2D uField, uDye, uMask;
uniform vec2 uView;
uniform int uMode;
uniform float uRange;
uniform vec3 uBg, uInkA, uInkB, uInkC, uNeg, uPos, uSolid;
out vec4 o;
vec3 viridis(float t) {
  const vec3 c0 = vec3(0.2777273, 0.0054073, 0.3340998), c1 = vec3(0.1050930, 1.4046135, 1.3845902),
    c2 = vec3(-0.3308618, 0.2148476, 0.0950952), c3 = vec3(-4.6342305, -5.7991010, -19.3324410),
    c4 = vec3(6.2282699, 14.1799334, 56.6905526), c5 = vec3(4.7763850, -13.7451454, -65.3530326),
    c6 = vec3(-5.4354559, 4.6458526, 26.3124352);
  t = clamp(t, 0.0, 1.0);
  return c0 + t * (c1 + t * (c2 + t * (c3 + t * (c4 + t * (c5 + t * c6)))));
}
vec3 diverging(float t) { t = clamp(t, -1.0, 1.0); return t > 0.0 ? mix(uBg, uPos, pow(t, 0.75)) : mix(uBg, uNeg, pow(-t, 0.75)); }
void main() {
  vec2 uv = gl_FragCoord.xy / uView;
  vec4 F = texture(uField, uv);
  vec3 col;
  if (uMode == 0) {
    vec4 d = texture(uDye, uv);
    col = mix(uBg, uInkA, clamp(d.r, 0.0, 1.0) * 0.85);
    col = mix(col, uInkB, clamp(d.g * 2.2, 0.0, 1.0) * 0.92);
    col = mix(col, uInkC, clamp(d.b * 1.8, 0.0, 1.0) * 0.92);
  } else if (uMode == 1) col = diverging(F.x / uRange);
  else if (uMode == 2) col = viridis(F.y / uRange);
  else col = diverging(F.z > 0.0 ? F.z / uRange : F.z / (1.5 * uRange));
  float s = smoothstep(0.5, 0.8, texture(uMask, uv).r);
  o = vec4(mix(col, uSolid, s), 1.0);
}`;

export class LBMGL {
  constructor(canvas = document.createElement('canvas')) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('This GPU cannot render to float textures (EXT_color_buffer_float).');
    this.gl = gl;
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
    const prog = (fs, names) => {
      const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(p, 0, 'aPos'); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {}; for (const n of names) u[n] = gl.getUniformLocation(p, n);
      return { p, u };
    };
    this.P = {
      lbm: prog(FS_LBM, ['uA', 'uB', 'uC', 'uMask', 'uN', 'uBC', 'uIn', 'uTau', 'uCs', 'uF', 'uLid', 'uStir', 'uStirU', 'uWob', 'uSponge']),
      dye: prog(FS_DYE, ['uDye', 'uC', 'uMask', 'uN', 'uStreaks', 'uBody', 'uSpace', 'uDecay', 'uDt', 'uStir', 'uSrc', 'uNSrc']),
      field: prog(FS_FIELD, ['uC', 'uN', 'uU', 'uL']),
      force: prog(FS_FORCE, ['uA', 'uB', 'uC', 'uMask', 'uN']),
      draw: prog(FS_DRAW, ['uField', 'uDye', 'uMask', 'uView', 'uMode', 'uRange', 'uBg', 'uInkA', 'uInkB', 'uInkC', 'uNeg', 'uPos', 'uSolid']),
    };
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.dye = { streaks: true, body: true, spacing: 8, decay: 0.99995 };
    this.stir = null;      // { x, y, r, ux, uy } in cells and lattice velocity
    this.sources = [];     // dye sources [[x, y], …] in cells
    this.wobble = 0;       // sideways velocity added to jet (forced) cells
  }
  tex(fmt, data, linear = false, wrapS = false, wrapT = false) {
    const gl = this.gl, t = gl.createTexture();
    const ifmt = fmt === '32f' ? gl.RGBA32F : gl.RGBA16F;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, this.nx, this.ny, 0, gl.RGBA, gl.FLOAT, data);
    const filt = linear ? gl.LINEAR : gl.NEAREST;
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, filt], [gl.TEXTURE_MAG_FILTER, filt],
      [gl.TEXTURE_WRAP_S, wrapS ? gl.REPEAT : gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, wrapT ? gl.REPEAT : gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return t;
  }
  fbo(...texs) {
    const gl = this.gl, f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    texs.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
    gl.drawBuffers(texs.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    return f;
  }
  dispose() {
    const gl = this.gl; if (!this.S) return;
    for (const s of this.S) { gl.deleteTexture(s.A); gl.deleteTexture(s.B); gl.deleteTexture(s.C); gl.deleteFramebuffer(s.fb); }
    for (const d of this.D) { gl.deleteTexture(d.t); gl.deleteFramebuffer(d.fb); }
    gl.deleteTexture(this.field.t); gl.deleteFramebuffer(this.field.fb); gl.deleteTexture(this.mask);
    gl.deleteTexture(this.forceT.t); gl.deleteFramebuffer(this.forceT.fb);
    this.S = null;
  }
  // setup({ nx, ny, U, inflow, tau, cs, bc, lid, force, cells (or solid), vel, init, L, dyeInit(i, j) → [r, g, b, a] | null })
  // U is the reference speed for the display; the other options mean the same as for the CPU LBM.
  // `cells` and `vel` are kept by reference: change them, then call updateCells() for the changed region.
  setup({ nx, ny, U = 0.1, inflow = U, tau = 0.6, cs = 0, bc = {}, lid = [0, 0], force = [0, 0], cells = null, solid = null, vel = null, init = null, L = 1, dyeInit = null, sponge = null }) {
    this.dispose();
    Object.assign(this, { nx, ny, U, inflow, tau, cs, lid, force, L, sponge, bx: BCX[bc.x || 'flow'], by: BCY[bc.y || 'slip'] });
    const n = nx * ny;
    this.cells = cells || solid || new Uint8Array(n);
    this.vel = vel || new Float32Array(2 * n);
    const A = new Float32Array(4 * n), B = new Float32Array(4 * n), C = new Float32Array(4 * n);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const m = this.cells[k] ? [1, this.vel[2 * k], this.vel[2 * k + 1]] : (init && init(i, j)) || [1, U, 0];
      for (let q = 0; q < 4; q++) { A[4 * k + q] = feq(q, m[0], m[1], m[2]); B[4 * k + q] = feq(q + 4, m[0], m[1], m[2]); }
      C[4 * k] = feq(8, m[0], m[1], m[2]); C[4 * k + 1] = m[0]; C[4 * k + 2] = m[1]; C[4 * k + 3] = m[2];
    }
    this.mask = this.tex('16f', null, true);
    this.updateCells();
    this.S = [0, 1].map(s => { const t = [this.tex('32f', s ? null : A), this.tex('32f', s ? null : B), this.tex('32f', s ? null : C)]; return { A: t[0], B: t[1], C: t[2], fb: this.fbo(...t) }; });
    this.D = [0, 1].map(() => { const t = this.tex('16f', null, true, this.bx === 1, this.by === 2); return { t, fb: this.fbo(t) }; });
    const ft = this.tex('16f', null, true); this.field = { t: ft, fb: this.fbo(ft) };
    const fo = this.tex('32f', null); this.forceT = { t: fo, fb: this.fbo(fo) };
    this.cur = 0; this.dyeCur = 0; this.iter = 0;
    this.dyeInit = dyeInit;
    this.clearDye();
  }
  // Re-upload the cell texture for cells x0 ≤ i < x1, y0 ≤ j < y1 (default: everything) after changing cells/vel
  updateCells(x0 = 0, y0 = 0, x1 = this.nx, y1 = this.ny) {
    const { nx, ny, cells, vel, gl } = this;
    x0 = Math.max(0, Math.floor(x0) - 1); y0 = Math.max(0, Math.floor(y0) - 1);
    x1 = Math.min(nx, Math.ceil(x1) + 1); y1 = Math.min(ny, Math.ceil(y1) + 1);
    const w = x1 - x0, hgt = y1 - y0; if (w <= 0 || hgt <= 0) return;
    const buf = new Float32Array(4 * w * hgt);
    for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) {
      const k = j * nx + i, o = 4 * ((j - y0) * w + (i - x0)), t = cells[k];
      buf[o] = t === 1 ? 1 : t === 2 ? 0.25 : 0;
      if (t) { buf[o + 2] = vel[2 * k]; buf[o + 3] = vel[2 * k + 1]; }
      else {
        let near = 0;
        for (let dj = -1; dj <= 1 && !near; dj++) for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj;
          if (ii >= 0 && jj >= 0 && ii < nx && jj < ny && cells[jj * nx + ii] === 1) { near = 1; break; }
        }
        buf[o + 1] = near;
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, this.mask);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, w, hgt, gl.RGBA, gl.FLOAT, buf);
  }
  clearDye() {
    const gl = this.gl;
    for (const d of this.D) { gl.bindFramebuffer(gl.FRAMEBUFFER, d.fb); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
    if (this.dyeInit) {
      const { nx, ny } = this, buf = new Float32Array(4 * nx * ny);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const v = this.dyeInit(i, j); if (v) buf.set(v, 4 * (j * nx + i)); }
      gl.bindTexture(gl.TEXTURE_2D, this.D[this.dyeCur].t);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, nx, ny, gl.RGBA, gl.FLOAT, buf);
    }
  }
  bind(unit, tex, loc) { const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(loc, unit); }
  step(k = 1) {
    if (!this.S) return;
    const gl = this.gl, L = this.P.lbm, Dp = this.P.dye, st = this.stir;
    gl.bindVertexArray(this.vao); gl.viewport(0, 0, this.nx, this.ny);
    const srcs = new Float32Array(2 * MAX_SRC); this.sources.slice(0, MAX_SRC).forEach((p, i) => srcs.set(p, 2 * i));
    for (let s = 0; s < k; s++) {
      const a = this.S[this.cur], b = this.S[1 - this.cur];
      gl.useProgram(L.p);
      gl.uniform2i(L.u.uN, this.nx, this.ny); gl.uniform2i(L.u.uBC, this.bx, this.by);
      gl.uniform1f(L.u.uIn, this.inflow); gl.uniform1f(L.u.uTau, this.tau); gl.uniform1f(L.u.uCs, this.cs);
      gl.uniform2f(L.u.uF, this.force[0], this.force[1]); gl.uniform2f(L.u.uLid, this.lid[0], this.lid[1]); gl.uniform1f(L.u.uWob, this.wobble);
      const sp = this.sponge; gl.uniform3f(L.u.uSponge, sp ? sp.sigma : 0, sp ? sp.y || 0 : 0, sp ? sp.x || 0 : 0);
      gl.uniform3f(L.u.uStir, st ? st.x : 0, st ? st.y : 0, st ? st.r : 0); gl.uniform2f(L.u.uStirU, st ? st.ux : 0, st ? st.uy : 0);
      this.bind(0, a.A, L.u.uA); this.bind(1, a.B, L.u.uB); this.bind(2, a.C, L.u.uC); this.bind(3, this.mask, L.u.uMask);
      gl.bindFramebuffer(gl.FRAMEBUFFER, b.fb);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.cur = 1 - this.cur; this.iter++;
      if (this.iter % DYE_EVERY) continue;
      const da = this.D[this.dyeCur], db = this.D[1 - this.dyeCur];
      gl.useProgram(Dp.p);
      gl.uniform2i(Dp.u.uN, this.nx, this.ny);
      gl.uniform1f(Dp.u.uStreaks, this.dye.streaks ? 1 : 0); gl.uniform1f(Dp.u.uBody, this.dye.body ? 1 : 0);
      gl.uniform1f(Dp.u.uSpace, this.dye.spacing); gl.uniform1f(Dp.u.uDecay, this.dye.decay); gl.uniform1f(Dp.u.uDt, DYE_EVERY);
      gl.uniform3f(Dp.u.uStir, st ? st.x : 0, st ? st.y : 0, st ? st.r : 0);
      gl.uniform2fv(Dp.u.uSrc, srcs); gl.uniform1i(Dp.u.uNSrc, Math.min(MAX_SRC, this.sources.length));
      this.bind(0, da.t, Dp.u.uDye); this.bind(1, b.C, Dp.u.uC); this.bind(2, this.mask, Dp.u.uMask);
      gl.bindFramebuffer(gl.FRAMEBUFFER, db.fb);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.dyeCur = 1 - this.dyeCur;
    }
  }
  // render(mode: 0 dye | 1 vorticity | 2 speed | 3 pressure, range, colors { bg, inkA, inkB, inkC, neg, pos, solid } as [r,g,b] 0–1)
  render(mode, range, colors) {
    if (!this.S) return;
    const gl = this.gl, F = this.P.field, Dr = this.P.draw;
    gl.bindVertexArray(this.vao);
    gl.useProgram(F.p); gl.viewport(0, 0, this.nx, this.ny);
    gl.uniform2i(F.u.uN, this.nx, this.ny); gl.uniform1f(F.u.uU, this.U); gl.uniform1f(F.u.uL, this.L);
    this.bind(0, this.S[this.cur].C, F.u.uC);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.field.fb); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.useProgram(Dr.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.uniform2f(Dr.u.uView, this.canvas.width, this.canvas.height);
    gl.uniform1i(Dr.u.uMode, mode); gl.uniform1f(Dr.u.uRange, range);
    for (const k of ['bg', 'inkA', 'inkB', 'inkC', 'neg', 'pos', 'solid']) gl.uniform3fv(Dr.u['u' + k[0].toUpperCase() + k.slice(1)], colors[k]);
    this.bind(0, this.field.t, Dr.u.uField); this.bind(1, this.D[this.dyeCur].t, Dr.u.uDye); this.bind(2, this.mask, Dr.u.uMask);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  // Read [ρ, ux, uy] for a block of cells (whole grid by default)
  readMacro(x = 0, y = 0, w = this.nx, hgt = this.ny) {
    const gl = this.gl, buf = new Float32Array(4 * w * hgt);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.S[this.cur].fb);
    gl.readBuffer(gl.COLOR_ATTACHMENT2);
    gl.readPixels(x, y, w, hgt, gl.RGBA, gl.FLOAT, buf);
    const n = w * hgt, rho = new Float32Array(n), ux = new Float32Array(n), uy = new Float32Array(n);
    for (let k = 0; k < n; k++) { rho[k] = buf[4 * k + 1]; ux[k] = buf[4 * k + 2]; uy[k] = buf[4 * k + 3]; }
    return { rho, ux, uy };
  }
  probe(i, j) { const m = this.readMacro(i, j, 1, 1); return { rho: m.rho[0], ux: m.ux[0], uy: m.uy[0] }; }
  // Run the force pass on the current state
  forcePass() {
    const gl = this.gl, P = this.P.force;
    gl.bindVertexArray(this.vao); gl.useProgram(P.p); gl.viewport(0, 0, this.nx, this.ny);
    gl.uniform2i(P.u.uN, this.nx, this.ny);
    const a = this.S[this.cur];
    this.bind(0, a.A, P.u.uA); this.bind(1, a.B, P.u.uB); this.bind(2, a.C, P.u.uC); this.bind(3, this.mask, P.u.uMask);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.forceT.fb); gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  // Read the force texture for a block of cells → { Fx, Fy } (whole grid by default)
  readForces(x = 0, y = 0, w = this.nx, hgt = this.ny) {
    const gl = this.gl, buf = new Float32Array(4 * w * hgt);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.forceT.fb); gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(x, y, w, hgt, gl.RGBA, gl.FLOAT, buf);
    const n = w * hgt, Fx = new Float32Array(n), Fy = new Float32Array(n);
    for (let k = 0; k < n; k++) { Fx[k] = buf[4 * k]; Fy[k] = buf[4 * k + 1]; }
    return { Fx, Fy };
  }
  // Total force on each body: bodies = [{ cells: [cell index…] }] → [[Fx, Fy], …] (lattice units)
  bodyForces(bodies) {
    if (!this.S) return [];
    this.forcePass();
    const nx = this.nx;
    return bodies.map(b => {
      if (!b.cells || !b.cells.length) return [0, 0];
      let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
      for (const k of b.cells) { const i = k % nx, j = (k - i) / nx; if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
      const w = x1 - x0 + 1, F = this.readForces(x0, y0, w, y1 - y0 + 1);
      let fx = 0, fy = 0;
      for (const k of b.cells) { const i = k % nx, j = (k - i) / nx, m = (j - y0) * w + (i - x0); fx += F.Fx[m]; fy += F.Fy[m]; }
      return [fx, fy];
    });
  }
}
