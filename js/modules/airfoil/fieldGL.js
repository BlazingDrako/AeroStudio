// GPU flow-field evaluation (WebGL2). Every pixel sums the exact panel influences
// (linear-vortex airfoil panels, TE panel, constant-source viscous panels) using the
// same formulas as the solver, producing velocity, stream function and an inside mask.

const FIELD_FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uPanels;  // texel i: (x, z, gamma, sigma of panel i->i+1)
uniform int uN, uNw;
uniform vec4 uView;         // xmin, xmax, zmin, zmax
uniform vec2 uFree;         // Vinf*cos(alpha), Vinf*sin(alpha)
uniform vec3 uTE;           // tcp, tdp, hasTE
uniform int uVisc;
in vec2 vUV;
out vec4 outField;
const float PI = 3.14159265358979;
const float I2PI = 0.15915494309189535;

void main() {
  vec2 P = vec2(mix(uView.x, uView.y, vUV.x), mix(uView.z, uView.w, vUV.y));
  vec2 V = uFree;
  float psi = uFree.x * P.y - uFree.y * P.x;
  float wind = 0.0;
  vec4 A = texelFetch(uPanels, ivec2(0, 0), 0);
  vec4 G0 = A; // first node (lower TE)
  for (int j = 0; j < 4096; j++) {
    if (j >= uN - 1) break;
    vec4 B = texelFetch(uPanels, ivec2(j + 1, 0), 0);
    vec2 d = B.xy - A.xy; float L = length(d);
    vec2 t = d / L, n = vec2(-t.y, t.x);
    vec2 r = P - A.xy;
    float x = dot(r, t), z = dot(r, n);
    float r1s = x * x + z * z, r2s = (x - L) * (x - L) + z * z;
    float lr1 = 0.5 * log(max(r1s, 1e-30)), lr2 = 0.5 * log(max(r2s, 1e-30));
    float lr = lr1 - lr2;
    float dth = atan(z * L, x * (x - L) + z * z);
    wind += dth;
    // linear vortex: velocity
    float t2 = (2.0 * z * lr - 2.0 * x * dth) / (4.0 * PI * L);
    float ug1 = dth * I2PI + t2, ug2 = -t2;
    float w2 = (x * lr - L + z * dth) * I2PI / L;
    float wg1 = -lr * I2PI + w2, wg2 = -w2;
    float g1 = A.z, g2 = B.z;
    V += (ug1 * g1 + ug2 * g2) * t + (wg1 * g1 + wg2 * g2) * n;
    // linear vortex: stream function
    float P1 = I2PI * (z * dth - L + x * lr1 - (x - L) * lr2);
    float P2 = x * P1 + I2PI * (0.5 * r2s * lr2 - 0.5 * r1s * lr1 - 0.25 * r2s + 0.25 * r1s);
    psi += (P1 - P2 / L) * g1 + (P2 / L) * g2;
    // constant source panel (viscous displacement effect)
    if (uVisc == 1) {
      float s = A.w;
      V += s * (lr * I2PI * t + dth * I2PI * n);
    }
    A = B;
  }
  // trailing-edge panel (from node N-1 back to node 0)
  {
    vec4 B = G0; // A is now node N-1
    vec2 d = B.xy - A.xy; float L = length(d);
    if (L > 1e-9) {
      vec2 t = d / L, n = vec2(-t.y, t.x);
      vec2 r = P - A.xy;
      float x = dot(r, t), z = dot(r, n);
      float r1s = x * x + z * z, r2s = (x - L) * (x - L) + z * z;
      float lr1 = 0.5 * log(max(r1s, 1e-30)), lr2 = 0.5 * log(max(r2s, 1e-30));
      float lr = lr1 - lr2;
      float dth = atan(z * L, x * (x - L) + z * z);
      wind += dth;
      if (uTE.z > 0.5) {
        float gN = A.z, gA = B.z;
        // source part: strength 0.5*tcp*(gN - g1)
        float ss = 0.5 * uTE.x * (gN - gA);
        V += ss * (lr * I2PI * t + dth * I2PI * n);
        // vortex part: uniform strength 0.5*tdp*(g1 - gN)  (a+b coefficients)
        float gv = 0.5 * uTE.y * (gA - gN);
        float t2 = (2.0 * z * lr - 2.0 * x * dth) / (4.0 * PI * L);
        float w2 = (x * lr - L + z * dth) * I2PI / L;
        V += gv * ((dth * I2PI) * t + (-lr * I2PI) * n);
        float P1 = I2PI * (z * dth - L + x * lr1 - (x - L) * lr2);
        psi += gv * P1;
      }
    }
  }
  // wake source panels
  if (uVisc == 1) {
    vec4 Aw = texelFetch(uPanels, ivec2(uN, 0), 0);
    for (int k = 0; k < 4096; k++) {
      if (k >= uNw - 1) break;
      vec4 Bw = texelFetch(uPanels, ivec2(uN + k + 1, 0), 0);
      vec2 d = Bw.xy - Aw.xy; float L = length(d);
      vec2 t = d / L, n = vec2(-t.y, t.x);
      vec2 r = P - Aw.xy;
      float x = dot(r, t), z = dot(r, n);
      float r1s = x * x + z * z, r2s = (x - L) * (x - L) + z * z;
      float lr = 0.5 * log(max(r1s, 1e-30) / max(r2s, 1e-30));
      float dth = atan(z * L, x * (x - L) + z * z);
      V += Aw.w * (lr * I2PI * t + dth * I2PI * n);
      Aw = Bw;
    }
  }
  float inside = abs(wind) > PI ? 1.0 : 0.0;
  outField = vec4(V, psi, inside);
}`;

const VS = `#version 300 es
in vec2 aPos; out vec2 vUV;
void main() { vUV = 0.5 * (aPos + 1.0); gl_Position = vec4(aPos, 0.0, 1.0); }`;

const DISPLAY_FS = `#version 300 es
precision highp float;
uniform sampler2D uField;
uniform int uMode;          // 0 none, 1 Cp, 2 speed
uniform float uVinf;
uniform vec3 uKT;           // KTb, KTl, Minf
uniform float uCps;         // sonic cp (if Minf > 0)
uniform float uCpMin;       // color range low end
uniform float uPsiStep;     // stream function contour spacing (0 = off)
uniform float uPsi0;        // contour offset (dividing streamline)
uniform vec3 uBg;
uniform float uDark;
in vec2 vUV;
out vec4 outColor;

vec3 diverging(float t) { // t in [-1,1]: blue (suction) .. neutral .. red (pressure)
  vec3 neg = vec3(0.09, 0.55, 0.85), neg2 = vec3(0.59, 0.85, 0.97);
  vec3 pos = vec3(1.00, 0.42, 0.36), pos2 = vec3(1.0, 0.79, 0.67);
  vec3 c;
  if (t < 0.0) { float a = -t; c = mix(uBg, mix(neg, neg2, smoothstep(0.55, 1.0, a)), smoothstep(0.0, 0.9, pow(a, 0.75))); }
  else { float a = t; c = mix(uBg, mix(pos, pos2, smoothstep(0.6, 1.0, a)), smoothstep(0.0, 0.9, pow(a, 0.75))); }
  return c;
}
vec3 sequential(float t) { // magma-like, t in [0,1]
  vec3 c0 = vec3(0.05, 0.03, 0.18), c1 = vec3(0.45, 0.12, 0.55), c2 = vec3(0.90, 0.30, 0.35), c3 = vec3(0.99, 0.75, 0.40), c4 = vec3(0.99, 0.99, 0.75);
  t = clamp(t, 0.0, 1.0);
  if (t < 0.25) return mix(c0, c1, t / 0.25);
  if (t < 0.5) return mix(c1, c2, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c2, c3, (t - 0.5) / 0.25);
  return mix(c3, c4, (t - 0.75) / 0.25);
}

void main() {
  vec4 f = texture(uField, vUV);
  if (f.w > 0.5) { outColor = vec4(0.0); return; }
  float q2 = dot(f.xy, f.xy) / (uVinf * uVinf);
  float cp = 1.0 - q2;
  if (uKT.z > 0.0) cp = cp / (uKT.x + 0.5 * uKT.y * (1.0 + uKT.x) * cp);
  vec3 col = uBg;
  if (uMode == 1) {
    float t = cp < 0.0 ? -clamp(cp / uCpMin, 0.0, 1.0) : clamp(cp, 0.0, 1.0);
    col = diverging(t);
  } else if (uMode == 2) {
    float s = sqrt(q2);
    col = mix(uBg, sequential(clamp((s - 0.0) / 1.8, 0.0, 1.0)), 0.92);
  }
  // streamlines = iso-lines of the stream function
  if (uPsiStep > 0.0) {
    float g = (f.z - uPsi0) / uPsiStep;
    float w = fwidth(g);
    float dist = abs(fract(g + 0.5) - 0.5);
    float line = 1.0 - smoothstep(0.0, 1.2 * w, dist);
    vec3 lc = uDark > 0.5 ? vec3(1.0) : vec3(0.08, 0.1, 0.16);
    col = mix(col, lc, line * (uDark > 0.5 ? 0.55 : 0.6));
  }
  // sonic line (local Mach = 1)
  if (uKT.z > 0.0) {
    float g = cp - uCps;
    float w = fwidth(g);
    float line = 1.0 - smoothstep(0.0, 1.5 * w, abs(g));
    col = mix(col, vec3(1.0, 0.92, 0.2), line);
    if (cp < uCps) col = mix(col, vec3(1.0, 0.85, 0.2), 0.18);
  }
  outColor = vec4(col, 1.0);
}`;

export class FieldGL {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, antialias: false, preserveDrawingBuffer: true });
    this.ok = !!gl && !!gl.getExtension('EXT_color_buffer_float');
    if (!this.ok) return;
    this.gl = gl;
    this.linear = !!gl.getExtension('OES_texture_float_linear');
    this.progField = this.program(VS, FIELD_FS);
    this.progDisp = this.program(VS, DISPLAY_FS);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    for (const p of [this.progField, this.progDisp]) {
      const loc = gl.getAttribLocation(p, 'aPos');
      if (loc >= 0) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0); }
    }
    this.panelTex = gl.createTexture();
    this.targets = {};
    this.data = null;
  }

  program(vs, fs) {
    const gl = this.gl;
    const mk = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    p.u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); p.u[info.name] = gl.getUniformLocation(p, info.name); }
    return p;
  }

  // res: packed solver result
  setSolution(res) {
    if (!this.ok) return;
    const gl = this.gl, N = res.N, Nw = res.viscous ? res.Nw : 0;
    const w = N + Nw, arr = new Float32Array(4 * w);
    const G = res.field.G, sig = res.field.sigma;
    for (let i = 0; i < N; i++) {
      arr[4 * i] = res.foil.x[i]; arr[4 * i + 1] = res.foil.z[i]; arr[4 * i + 2] = G[i];
      arr[4 * i + 3] = sig && i < N - 1 ? sig[i] : 0;
    }
    for (let k = 0; k < Nw; k++) {
      const o = 4 * (N + k);
      arr[o] = res.wake.x[k]; arr[o + 1] = res.wake.z[k]; arr[o + 2] = 0;
      arr[o + 3] = sig && k < Nw - 1 ? sig[N - 1 + k] : 0;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.panelTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, 1, 0, gl.RGBA, gl.FLOAT, arr);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const a = res.alpha * Math.PI / 180;
    this.data = { N, Nw, free: [res.Vinf * Math.cos(a), res.Vinf * Math.sin(a)], te: [res.field.tcp, res.field.tdp, res.field.hasTE ? 1 : 0], visc: res.viscous ? 1 : 0, res };
  }

  target(name, w, h) {
    const gl = this.gl;
    let t = this.targets[name];
    if (!t || t.w !== w || t.h !== h) {
      if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
      const filt = this.linear ? gl.LINEAR : gl.NEAREST;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      t = this.targets[name] = { tex, fb, w, h };
    }
    return t;
  }

  computeField(name, w, h, view) {
    const gl = this.gl, p = this.progField, d = this.data;
    const t = this.target(name, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    gl.viewport(0, 0, w, h);
    gl.useProgram(p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.panelTex);
    gl.uniform1i(p.u.uPanels, 0);
    gl.uniform1i(p.u.uN, d.N); gl.uniform1i(p.u.uNw, d.Nw);
    gl.uniform4f(p.u.uView, view.x0, view.x1, view.z0, view.z1);
    gl.uniform2f(p.u.uFree, d.free[0], d.free[1]);
    gl.uniform3f(p.u.uTE, d.te[0], d.te[1], d.te[2]);
    gl.uniform1i(p.u.uVisc, d.visc);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return t;
  }

  // renders the colored field to the canvas. opts: {mode, psiStep, psi0, cpMin, bg, dark, scale}
  render(view, opts) {
    if (!this.ok || !this.data) return;
    const gl = this.gl, c = this.canvas;
    const w = Math.max(2, Math.round(c.width * (opts.scale || 1))), h = Math.max(2, Math.round(c.height * (opts.scale || 1)));
    const t = this.computeField('display', w, h, view);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, c.width, c.height);
    const p = this.progDisp, r = this.data.res;
    gl.useProgram(p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.uniform1i(p.u.uField, 0);
    gl.uniform1i(p.u.uMode, opts.mode);
    gl.uniform1f(p.u.uVinf, r.Vinf);
    gl.uniform3f(p.u.uKT, r.KTb, r.KTl, r.Ma);
    gl.uniform1f(p.u.uCps, r.cps);
    gl.uniform1f(p.u.uCpMin, opts.cpMin);
    gl.uniform1f(p.u.uPsiStep, opts.psiStep);
    gl.uniform1f(p.u.uPsi0, opts.psi0 || 0);
    gl.uniform3f(p.u.uBg, opts.bg[0], opts.bg[1], opts.bg[2]);
    gl.uniform1f(p.u.uDark, opts.dark ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // low-res velocity grid for particle advection: returns {w, h, data: Float32Array(4*w*h)}
  sampleGrid(view, w, h) {
    if (!this.ok || !this.data) return null;
    const gl = this.gl;
    const t = this.computeField('grid', w, h, view);
    const data = new Float32Array(4 * w * h);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, data);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { w, h, data, view: { ...view } };
  }
}
