// 2-D compressible Euler solver on the GPU (WebGL2 fragment shaders, RGBA32F textures).
// Finite volume on a Cartesian grid: MUSCL (van Leer limiter, primitive variables) + HLLC fluxes,
// two-stage SSP Runge–Kutta. Bodies are masked cells; walls are slip walls that mirror the velocity
// about the true surface normal (stored per solid cell), so inclined walls behave well on the staircase.
// Non-dimensional: free-stream ρ = 1, a = 1, p = 1/γ, u = M.

const VS = `#version 300 es
in vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uS, uB, uMask;
uniform ivec2 uN;
uniform vec4 uInf;
uniform float uDt, uDx, uDy, uG, uA, uW, uPb, uOrd;
out vec4 o;

bool solid(ivec2 c) {
  if (c.x < 0 || c.x >= uN.x) return false;
  c.y = clamp(c.y, 0, uN.y - 1);
  return texelFetch(uMask, c, 0).r > 0.5;
}
vec4 cons(vec4 W) { return vec4(W.x, W.x * W.y, W.x * W.z, W.w / (uG - 1.0) + 0.5 * W.x * (W.y * W.y + W.z * W.z)); }
vec4 prim(vec4 U) {
  float r = max(U.x, 1e-6); float u = U.y / r, v = U.z / r;
  return vec4(r, u, v, max((uG - 1.0) * (U.w - 0.5 * r * (u * u + v * v)), 1e-6));
}
vec4 fetchW(ivec2 c) {
  if (c.x < 0) return prim(uInf);
  bool right = c.x >= uN.x;
  c.x = min(c.x, uN.x - 1); c.y = clamp(c.y, 0, uN.y - 1);
  vec4 W = prim(texelFetch(uS, c, 0));
  if (right && uPb > 0.0 && W.y * W.y + W.z * W.z < uG * W.w / W.x) W.w = uPb; // subsonic outflow at fixed back pressure
  return W;
}
vec4 vl(vec4 a, vec4 b) { vec4 p = a * b; vec4 m = step(1e-30, p); vec4 d = a + b; return m * 2.0 * p / (d + (1.0 - m) * (1.0 + abs(d))); } // van Leer limiter; 0 when slopes disagree (denominator kept ≥ 1 there)

vec4 fluxX(vec4 W) { float E = W.w / (uG - 1.0) + 0.5 * W.x * (W.y * W.y + W.z * W.z); return vec4(W.x * W.y, W.x * W.y * W.y + W.w, W.x * W.y * W.z, W.y * (E + W.w)); }
// HLLC flux in the x direction for primitive states (ρ, un, ut, p)
vec4 hllc(vec4 L, vec4 R) {
  float aL = sqrt(uG * L.w / L.x), aR = sqrt(uG * R.w / R.x);
  float SL = min(L.y - aL, R.y - aR), SR = max(L.y + aL, R.y + aR);
  vec4 FL = fluxX(L), FR = fluxX(R);
  if (SL >= 0.0) return FL;
  if (SR <= 0.0) return FR;
  float den = L.x * (SL - L.y) - R.x * (SR - R.y);
  float Ss = (R.w - L.w + L.x * L.y * (SL - L.y) - R.x * R.y * (SR - R.y)) / den;
  vec4 UL = cons(L), UR = cons(R);
  if (Ss >= 0.0) {
    float k = L.x * (SL - L.y) / (SL - Ss);
    vec4 Us = k * vec4(1.0, Ss, L.z, UL.w / L.x + (Ss - L.y) * (Ss + L.w / (L.x * (SL - L.y))));
    return FL + SL * (Us - UL);
  }
  float k = R.x * (SR - R.y) / (SR - Ss);
  vec4 Us = k * vec4(1.0, Ss, R.z, UR.w / R.x + (Ss - R.y) * (Ss + R.w / (R.x * (SR - R.y))));
  return FR + SR * (Us - UR);
}
// reconstructed face flux between cells a (left/below) and b (right/above); ghost cells hold wall data
vec4 faceFlux(ivec2 a, ivec2 b, ivec2 e, bool y) {
  vec4 wl = fetchW(a), wr = fetchW(b), wll = fetchW(a - e), wrr = fetchW(b + e);
  vec4 WL = wl + 0.5 * uOrd * vl(wl - wll, wr - wl);
  vec4 WR = wr - 0.5 * uOrd * vl(wr - wl, wrr - wr);
  if (WL.x <= 0.0 || WL.w <= 0.0) WL = wl;
  if (WR.x <= 0.0 || WR.w <= 0.0) WR = wr;
  if (y) { vec4 f = hllc(WL.xzyw, WR.xzyw); return f.xzyw; }
  return hllc(WL, WR);
}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 U0 = texelFetch(uS, c, 0);
  if (solid(c)) { o = uInf; return; }
  ivec2 ex = ivec2(1, 0), ey = ivec2(0, 1);
  vec4 Fe = faceFlux(c, c + ex, ex, false), Fw = faceFlux(c - ex, c, ex, false);
  vec4 Gn = faceFlux(c, c + ey, ey, true), Gs = faceFlux(c - ey, c, ey, true);
  vec4 L = -(Fe - Fw) / uDx - (Gn - Gs) / uDy;
  vec4 U = uA * texelFetch(uB, c, 0) + uW * (U0 + uDt * L);
  vec4 W = prim(U);
  W.x = max(W.x, 1e-4); W.w = max(W.w, 1e-5);
  o = cons(W);
}`;

// Ghost-cell pass: solid cells next to the fluid take the state at their image point across the true
// surface (bilinear from fluid cells), with the velocity mirrored about the surface normal → slip wall.
const GS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uS, uMask;
uniform ivec2 uN;
uniform vec4 uInf;
uniform float uDx, uDy, uG;
out vec4 o;
vec4 prim(vec4 U) { float r = max(U.x, 1e-6); float u = U.y / r, v = U.z / r; return vec4(r, u, v, max((uG - 1.0) * (U.w - 0.5 * r * (u * u + v * v)), 1e-6)); }
vec4 cons(vec4 W) { return vec4(W.x, W.x * W.y, W.x * W.z, W.w / (uG - 1.0) + 0.5 * W.x * (W.y * W.y + W.z * W.z)); }
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 m = texelFetch(uMask, c, 0);
  vec4 U = texelFetch(uS, c, 0);
  if (m.r < 0.5) { o = U; return; }          // fluid: copy
  if (m.r > 1.5) { o = uInf; return; }       // deep inside a body: unused
  vec2 n = m.gb;
  vec2 f = vec2(c) + 2.0 * m.a * vec2(n.x / uDx, n.y / uDy); // image point (cell-index units)
  ivec2 i0 = ivec2(floor(f)); vec2 t = f - vec2(i0);
  vec4 acc = vec4(0.0); float ws = 0.0;
  for (int b = 0; b < 2; b++) for (int a = 0; a < 2; a++) {
    ivec2 q = clamp(i0 + ivec2(a, b), ivec2(0), uN - 1);
    if (texelFetch(uMask, q, 0).r > 0.5) continue;
    float w = (a == 1 ? t.x : 1.0 - t.x) * (b == 1 ? t.y : 1.0 - t.y) + 1e-6;
    acc += w * prim(texelFetch(uS, q, 0)); ws += w;
  }
  if (ws <= 0.0) {                          // fall back to the nearest fluid neighbour
    for (int k = 0; k < 4 && ws <= 0.0; k++) {
      ivec2 q = clamp(c + (k == 0 ? ivec2(1, 0) : k == 1 ? ivec2(-1, 0) : k == 2 ? ivec2(0, 1) : ivec2(0, -1)), ivec2(0), uN - 1);
      if (texelFetch(uMask, q, 0).r < 0.5) { acc = prim(texelFetch(uS, q, 0)); ws = 1.0; }
    }
    if (ws <= 0.0) { o = uInf; return; }
  }
  vec4 W = acc / ws;
  W.yz -= 2.0 * dot(W.yz, n) * n;
  o = cons(W);
}`;

export class Euler2D {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = 1;
    const gl = this.canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('This GPU cannot render to float textures (EXT_color_buffer_float).');
    this.gl = gl;
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
    const link = fs => { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.bindAttribLocation(p, 0, 'aPos'); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; };
    const p = link(FS), pg = link(GS);
    this.prog = p; this.gprog = pg;
    this.u = {}; for (const n of ['uS', 'uB', 'uMask', 'uN', 'uInf', 'uDt', 'uDx', 'uDy', 'uG', 'uA', 'uW', 'uPb', 'uOrd']) this.u[n] = gl.getUniformLocation(p, n);
    this.ug = {}; for (const n of ['uS', 'uMask', 'uN', 'uInf', 'uDx', 'uDy', 'uG']) this.ug[n] = gl.getUniformLocation(pg, n);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }
  tex(data) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.nx, this.ny, 0, gl.RGBA, gl.FLOAT, data);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return t;
  }
  fbo(t) { const gl = this.gl, f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); return f; }
  dispose() {
    const gl = this.gl; if (!this.T) return;
    for (const t of [...this.T, this.mask]) gl.deleteTexture(t);
    for (const f of this.F) gl.deleteFramebuffer(f);
    this.T = null;
  }
  // setup({ nx, ny, x0, y0, dx, dy, g, M, polys, init(x,y)→[ρ,u,v,p] | null, pback })
  setup(o) {
    this.dispose();
    Object.assign(this, { nx: o.nx, ny: o.ny, x0: o.x0, y0: o.y0, dx: o.dx, dy: o.dy, g: o.g, M: o.M, pback: o.pback || 0 });
    const { nx, ny, g } = this, n = nx * ny;
    const inf = [1, o.M, 0, 1 / g];
    const E = W => W[3] / (g - 1) + 0.5 * W[0] * (W[1] * W[1] + W[2] * W[2]);
    this.inf = [inf[0], inf[0] * inf[1], 0, E(inf)];
    // mask: solid flag + outward normal of the nearest surface point
    const mask = new Float32Array(4 * n), U = new Float32Array(4 * n);
    const polys = (o.polys || []).map(P => { let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity; for (const p of P) { a = Math.min(a, p.x); b = Math.max(b, p.x); c = Math.min(c, p.y); d = Math.max(d, p.y); } return { P, a, b, c, d }; });
    const inside = (x, y) => { for (const q of polys) { if (x < q.a || x > q.b || y < q.c || y > q.d) continue; if (pip(x, y, q.P)) return true; } return false; };
    const S = new Uint8Array(n);
    for (let j = 0; j < ny; j++) { const y = this.y0 + (j + 0.5) * this.dy; for (let i = 0; i < nx; i++) S[j * nx + i] = inside(this.x0 + (i + 0.5) * this.dx, y) ? 1 : 0; }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i; if (!S[k]) continue;
      mask[4 * k] = 2;
      let near = false;
      for (let dj = -2; dj <= 2 && !near; dj++) for (let di = -2; di <= 2; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < nx && jj < ny && !S[jj * nx + ii]) { near = true; break; } }
      if (!near) continue;
      mask[4 * k] = 1;
      const x = this.x0 + (i + 0.5) * this.dx, y = this.y0 + (j + 0.5) * this.dy;
      let bd = Infinity, bx = 0, by = 1, qx = x, qy = y;
      for (const q of polys) {
        const P = q.P;
        for (let m = 0; m < P.length; m++) {
          const A = P[m], B = P[(m + 1) % P.length], ex = B.x - A.x, ey = B.y - A.y, L2 = ex * ex + ey * ey || 1;
          const t = Math.max(0, Math.min(1, ((x - A.x) * ex + (y - A.y) * ey) / L2)), px = A.x + t * ex, py = A.y + t * ey;
          const d = (px - x) ** 2 + (py - y) ** 2;
          if (d < bd) { bd = d; const l = Math.hypot(ey, ex) || 1; bx = ey / l; by = -ex / l; qx = px; qy = py; }
        }
      }
      // orient the normal toward the fluid: a point just off the surface along +n must be outside the body
      const e = 0.3 * Math.min(this.dx, this.dy);
      if (inside(qx + bx * e, qy + by * e)) { bx = -bx; by = -by; }
      mask[4 * k + 1] = bx; mask[4 * k + 2] = by; mask[4 * k + 3] = Math.sqrt(bd);
    }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, x = this.x0 + (i + 0.5) * this.dx, y = this.y0 + (j + 0.5) * this.dy;
      const W = (o.init && o.init(x, y)) || inf;
      U[4 * k] = W[0]; U[4 * k + 1] = W[0] * W[1]; U[4 * k + 2] = W[0] * W[2]; U[4 * k + 3] = E(W);
    }
    this.solidMask = S; this.maskData = mask;
    this.mask = this.tex(mask);
    this.T = [this.tex(U), this.tex(null), this.tex(null), this.tex(null)]; // U^n, U1, U^n+1, ghost-filled scratch
    this.F = this.T.map(t => this.fbo(t));
    // stable time step from an upper bound on |u| + a anywhere in the flow
    const a0 = Math.sqrt(1 + 0.5 * (g - 1) * o.M * o.M);
    const smax = a0 * Math.sqrt((g + 1) / (g - 1)) * 1.02;
    this.dt = (o.cfl || 0.42) / (smax / this.dx + smax / this.dy);
    this.iter = 0; this.time = 0; this.prevRho = null; this.residual = NaN; this.res0 = NaN;
    this.read = new Float32Array(4 * n);
    this.out = null; // readback buffers are sized to the grid
  }
  ghost(src) {
    const gl = this.gl, u = this.ug;
    gl.useProgram(this.gprog);
    gl.uniform2i(u.uN, this.nx, this.ny); gl.uniform4fv(u.uInf, this.inf); gl.uniform1f(u.uDx, this.dx); gl.uniform1f(u.uDy, this.dy); gl.uniform1f(u.uG, this.g);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.F[3]); gl.viewport(0, 0, this.nx, this.ny);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.T[src]); gl.uniform1i(u.uS, 0);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.mask); gl.uniform1i(u.uMask, 2);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.useProgram(this.prog);
  }
  pass(src, base, dst, A, W) {
    const gl = this.gl, u = this.u;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.F[dst]);
    gl.viewport(0, 0, this.nx, this.ny);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.T[src]); gl.uniform1i(u.uS, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.T[base]); gl.uniform1i(u.uB, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.mask); gl.uniform1i(u.uMask, 2);
    gl.uniform1f(u.uA, A); gl.uniform1f(u.uW, W);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  step(k = 1) {
    if (!this.T) return;
    const gl = this.gl, u = this.u;
    gl.useProgram(this.prog); gl.bindVertexArray(this.vao);
    gl.uniform2i(u.uN, this.nx, this.ny); gl.uniform4fv(u.uInf, this.inf);
    gl.uniform1f(u.uDt, this.dt); gl.uniform1f(u.uDx, this.dx); gl.uniform1f(u.uDy, this.dy); gl.uniform1f(u.uG, this.g); gl.uniform1f(u.uPb, this.pback); gl.uniform1f(u.uOrd, this.order ?? 1);
    for (let s = 0; s < k; s++) {
      this.ghost(0); this.pass(3, 0, 1, 0, 1);       // U1 = U + dt L(U)
      this.ghost(1); this.pass(3, 0, 2, 0.5, 0.5);   // U = ½U + ½(U1 + dt L(U1))
      [this.T[0], this.T[2]] = [this.T[2], this.T[0]]; [this.F[0], this.F[2]] = [this.F[2], this.F[0]];
      this.iter++; this.time += this.dt;
    }
  }
  // Copy the solution back and convert to flow states relative to the free stream.
  readback() {
    const gl = this.gl, { nx, ny, g, M } = this, n = nx * ny;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.F[0]);
    gl.readPixels(0, 0, nx, ny, gl.RGBA, gl.FLOAT, this.read);
    const R = this.read;
    const out = this.out || (this.out = { M: new Float32Array(n), th: new Float32Array(n), p: new Float32Array(n), T: new Float32Array(n), rho: new Float32Array(n), p0: new Float32Array(n) });
    const p0inf = (1 / g) * (1 + 0.5 * (g - 1) * M * M) ** (g / (g - 1)), ex = g / (g - 1);
    let dsum = 0, cnt = 0;
    for (let k = 0; k < n; k++) {
      const r = Math.max(R[4 * k], 1e-6), u = R[4 * k + 1] / r, v = R[4 * k + 2] / r;
      const p = Math.max((g - 1) * (R[4 * k + 3] - 0.5 * r * (u * u + v * v)), 1e-7);
      const a2 = g * p / r, m2 = (u * u + v * v) / a2;
      if (this.prevRho && !this.solidMask[k]) { dsum += Math.abs(r - this.prevRho[k]); cnt++; }
      out.rho[k] = r; out.p[k] = g * p; out.T[k] = a2; out.M[k] = Math.sqrt(m2); out.th[k] = Math.atan2(v, u);
      out.p0[k] = p * (1 + 0.5 * (g - 1) * m2) ** ex / p0inf;
    }
    if (this.prevRho && cnt) {
      const steps = Math.max(1, this.iter - this.prevIter);
      this.residual = dsum / cnt / steps / (this.dt || 1);
      if (!(this.res0 > 0) && this.residual > 0) this.res0 = this.residual;
    }
    this.prevRho = Float32Array.from(out.rho); this.prevIter = this.iter;
    return out;
  }
  // bilinear sample of the last readback at world (x, y); skips solid neighbours
  sample(x, y) {
    const o = this.out; if (!o) return null;
    const fx = (x - this.x0) / this.dx - 0.5, fy = (y - this.y0) / this.dy - 0.5;
    const i = Math.floor(fx), j = Math.floor(fy);
    if (i < -1 || j < -1 || i >= this.nx || j >= this.ny) return null;
    const ci = Math.min(this.nx - 1, Math.max(0, Math.round(fx))), cj = Math.min(this.ny - 1, Math.max(0, Math.round(fy)));
    if (this.solidMask[cj * this.nx + ci]) return null;
    const tx = fx - i, ty = fy - j;
    let ws = 0; const acc = [0, 0, 0, 0, 0, 0];
    for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
      const ii = Math.min(this.nx - 1, Math.max(0, i + a)), jj = Math.min(this.ny - 1, Math.max(0, j + b)), k = jj * this.nx + ii;
      if (this.solidMask[k]) continue;
      const w = (a ? tx : 1 - tx) * (b ? ty : 1 - ty) + 1e-9;
      acc[0] += w * o.M[k]; acc[1] += w * o.th[k]; acc[2] += w * o.p[k]; acc[3] += w * o.T[k]; acc[4] += w * o.rho[k]; acc[5] += w * o.p0[k]; ws += w;
    }
    if (!ws) return null;
    return { M: acc[0] / ws, th: acc[1] / ws, p: acc[2] / ws, T: acc[3] / ws, rho: acc[4] / ws, p0: acc[5] / ws };
  }
}
function pip(x, y, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) c = !c; }
  return c;
}
