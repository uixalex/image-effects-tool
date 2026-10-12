import { gradientLUT, hex } from '../core/color';
import type { EffectModule, Params, RenderInput } from '../core/types';

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// Gauss sa fiksnih 49 uzoraka; radijus se postiže razmakom između uzoraka.
const BLUR = `
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_dir;
varying vec2 v_uv;
void main() {
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int i = -24; i <= 24; i++) {
    float x = float(i);
    float w = exp(-x * x / 128.0);
    acc += texture2D(u_tex, v_uv + u_dir * x) * w;
    wsum += w;
  }
  gl_FragColor = acc / wsum;
}`;

const MAP = `
precision highp float;
uniform sampler2D u_img;
uniform sampler2D u_lut;
uniform vec2 u_texel;
uniform float u_contrast;
uniform float u_glow;
uniform float u_glowWidth;
uniform vec4 u_glowColor;
uniform float u_grain;
uniform float u_grainSize;
uniform float u_shift;
uniform float u_seed;
varying vec2 v_uv;

float lum(vec2 uv) {
  return dot(texture2D(u_img, uv).rgb, vec3(0.2126, 0.7152, 0.0722));
}
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
void main() {
  float l = clamp((lum(v_uv) - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  // Klizanje palete: pomak sa ogledalom na krajevima, da nema skoka.
  float lm = 1.0 - abs(1.0 - mod(l + u_shift + 2.0, 2.0));
  vec4 g = texture2D(u_lut, vec2(lm * 255.0 / 256.0 + 0.5 / 256.0, 0.5));
  vec3 col = g.rgb;

  if (u_glow > 0.0) {
    vec2 o = u_texel * u_glowWidth;
    float tl = lum(v_uv + vec2(-o.x, o.y)), t = lum(v_uv + vec2(0.0, o.y)), tr = lum(v_uv + o);
    float ml = lum(v_uv - vec2(o.x, 0.0)), mr = lum(v_uv + vec2(o.x, 0.0));
    float bl = lum(v_uv - o), b = lum(v_uv - vec2(0.0, o.y)), br = lum(v_uv + vec2(o.x, -o.y));
    float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
    float gy = (tl + 2.0 * t + tr) - (bl + 2.0 * b + br);
    float e = clamp(length(vec2(gx, gy)) * u_contrast * 2.0, 0.0, 1.0);
    e = smoothstep(0.05, 0.6, e) * u_glow;
    col = mix(col, u_glowColor.rgb, clamp(e * u_glowColor.a, 0.0, 1.0));
  }

  if (u_grain > 0.0) {
    vec2 cellPos = floor(gl_FragCoord.xy / u_grainSize) + vec2(u_seed * 17.0, u_seed * 31.0);
    col += (hash(cellPos) - 0.5) * u_grain;
  }
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), g.a);
}`;

interface GL {
  gl: WebGLRenderingContext;
  canvas: HTMLCanvasElement;
  blur: WebGLProgram;
  map: WebGLProgram;
  srcTex: WebGLTexture;
  lutTex: WebGLTexture;
  fbos: { fb: WebGLFramebuffer; tex: WebGLTexture }[];
  size: [number, number];
}

let state: GL | null = null;

function compile(gl: WebGLRenderingContext, vs: string, fs: string) {
  const prog = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader');
    gl.attachShader(prog, sh);
  }
  gl.bindAttribLocation(prog, 0, 'a_pos');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
  return prog;
}

function texture(gl: WebGLRenderingContext) {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function init(): GL {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false })!;
  if (!gl) throw new Error('WebGL is not available');
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const fbos = [0, 1].map(() => {
    const tex = texture(gl);
    const fb = gl.createFramebuffer()!;
    return { fb, tex };
  });
  return {
    gl,
    canvas,
    blur: compile(gl, VERT, BLUR),
    map: compile(gl, VERT, MAP),
    srcTex: texture(gl),
    lutTex: texture(gl),
    fbos,
    size: [0, 0],
  };
}

function resize(s: GL, w: number, h: number) {
  if (s.size[0] === w && s.size[1] === h) return;
  const { gl } = s;
  s.canvas.width = w;
  s.canvas.height = h;
  for (const { fb, tex } of s.fbos) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  }
  s.size = [w, h];
}

function draw(s: GL, prog: WebGLProgram, target: WebGLFramebuffer | null, tex: WebGLTexture, uniforms: (u: (n: string) => WebGLUniformLocation | null) => void) {
  const { gl } = s;
  gl.bindFramebuffer(gl.FRAMEBUFFER, target);
  gl.viewport(0, 0, s.size[0], s.size[1]);
  gl.useProgram(prog);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  uniforms((n) => gl.getUniformLocation(prog, n));
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function renderGL(input: RenderInput, p: Params): HTMLCanvasElement {
  state ??= init();
  const s = state;
  const { gl } = s;
  const { width: w, height: h } = input;
  resize(s, w, h);

  gl.bindTexture(gl.TEXTURE_2D, s.srcTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, input.source);

  gl.bindTexture(gl.TEXTURE_2D, s.lutTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(gradientLUT(p.gradient)));

  // Blur: horizontalno u fbo0, vertikalno u fbo1. Bez blura mapa čita izvor direktno.
  let mapInput = s.srcTex;
  if (p.blur > 0) {
    const step = (p.blur * input.unit) / 16;
    draw(s, s.blur, s.fbos[0].fb, s.srcTex, (u) => gl.uniform2f(u('u_dir'), step / w, 0));
    draw(s, s.blur, s.fbos[1].fb, s.fbos[0].tex, (u) => gl.uniform2f(u('u_dir'), 0, step / h));
    mapInput = s.fbos[1].tex;
  }

  const c = 1 + p.contrast / 100;
  const contrast = p.contrast >= 0 ? 1 + (p.contrast / 100) * 3 : Math.max(0, c);
  draw(s, s.map, null, mapInput, (u) => {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, s.lutTex);
    gl.uniform1i(u('u_img'), 0);
    gl.uniform1i(u('u_lut'), 1);
    gl.uniform2f(u('u_texel'), 1 / w, 1 / h);
    gl.uniform1f(u('u_contrast'), contrast);
    gl.uniform1f(u('u_glow'), p.glow / 100);
    gl.uniform1f(u('u_glowWidth'), Math.max(0.5, p.glowWidth * input.unit));
    const g = p.glowColor;
    gl.uniform4f(u('u_glowColor'), g.r / 255, g.g / 255, g.b / 255, g.a);
    gl.uniform1f(u('u_grain'), p.grain / 100);
    gl.uniform1f(u('u_grainSize'), Math.max(1, p.grainSize * input.unit));
    gl.uniform1f(u('u_shift'), p._shift ?? 0);
    gl.uniform1f(u('u_seed'), (p._seed ?? 0) % 997);
  });
  return s.canvas;
}

export const gradientMap: EffectModule = {
  id: 'gradientMap',
  name: 'Gradient Map',
  motion: {
    types: [
      { value: 'slide', label: 'Palette slide' },
      { value: 'grain', label: 'Live grain' },
      { value: 'blur', label: 'Blur pulse' },
    ],
    apply(p, a) {
      if (a.type === 'slide') return { ...p, _shift: a.intensity * Math.sin(a.phase) };
      if (a.type === 'grain') return { ...p, _seed: a.step(6 + 18 * a.intensity) };
      if (a.type === 'blur') return { ...p, blur: Math.max(0, p.blur * (1 + a.intensity * Math.sin(a.phase))) };
      return p;
    },
  },
  params: [
    {
      key: 'gradient',
      label: 'Gradient',
      type: 'gradient',
      default: [
        { pos: 0, color: hex('#2E4A3E') },
        { pos: 0.4, color: hex('#FF5B3A') },
        { pos: 0.78, color: hex('#C7A4FF') },
        { pos: 1, color: hex('#F6F0FF') },
      ],
    },
    { key: 'contrast', label: 'Contrast', type: 'number', min: -100, max: 100, step: 1, default: 0 },
    { key: 'blur', label: 'Blur', type: 'number', min: 0, max: 60, step: 0.5, default: 6 },
    { key: 'grain', label: 'Grain amount', type: 'number', min: 0, max: 100, step: 1, default: 12, unit: '%' },
    { key: 'grainSize', label: 'Grain size', type: 'number', min: 1, max: 8, step: 0.5, default: 1.5 },
    { key: 'glow', label: 'Edge glow', type: 'number', min: 0, max: 100, step: 1, default: 60, unit: '%' },
    { key: 'glowWidth', label: 'Edge width', type: 'number', min: 1, max: 20, step: 0.5, default: 3 },
    { key: 'glowColor', label: 'Edge color', type: 'color', default: hex('#F1E8FF') },
  ],

  render(input, p, ctx) {
    ctx.drawImage(renderGL(input, p), 0, 0);
  },
};
