/**
 * Zajednički WebGL za jednostavne efekte u jednom prolazu (fragment shader preko cijelog platna).
 * Izvor je dostupan kao u_src (već okrenut kako treba), veličina platna kao u_res, a v_uv ide 0-1 od gornjeg lijevog ugla.
 */

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

/** Šum i pomoćne funkcije koje shaderi mogu koristiti. */
export const GLSL_NOISE = `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    a *= 0.5;
  }
  return v;
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

interface Ctx {
  gl: WebGLRenderingContext;
  canvas: HTMLCanvasElement;
  srcTex: WebGLTexture;
  programs: Map<string, WebGLProgram>;
}

let ctx: Ctx | null = null;

function init(): Ctx {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
  if (!gl) throw new Error('WebGL is not available');
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const srcTex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, srcTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return { gl, canvas, srcTex, programs: new Map() };
}

function program(c: Ctx, frag: string) {
  let prog = c.programs.get(frag);
  if (prog) return prog;
  const { gl } = c;
  prog = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, `precision highp float;\nvarying vec2 v_uv;\nuniform sampler2D u_src;\nuniform vec2 u_res;\n${GLSL_NOISE}\n${frag}`]] as const) {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader');
    gl.attachShader(prog, sh);
  }
  gl.bindAttribLocation(prog, 0, 'a_pos');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
  c.programs.set(frag, prog);
  return prog;
}

export type Uniforms = Record<string, number | number[]>;

/** Renderuje fragment shader u canvas veličine w x h i vraća ga (crtati odmah, canvas se dijeli). */
export function runShader(frag: string, w: number, h: number, uniforms: Uniforms, source?: HTMLCanvasElement): HTMLCanvasElement {
  ctx ??= init();
  const { gl, canvas } = ctx;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const prog = program(ctx, frag);
  gl.useProgram(prog);
  gl.viewport(0, 0, w, h);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, ctx.srcTex);
  if (source) {
    // Bez okretanja: v_uv već ide od gornjeg lijevog ugla, kao i redovi canvasa.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }
  gl.uniform1i(gl.getUniformLocation(prog, 'u_src'), 0);
  gl.uniform2f(gl.getUniformLocation(prog, 'u_res'), w, h);
  for (const [name, v] of Object.entries(uniforms)) {
    const loc = gl.getUniformLocation(prog, name);
    if (!loc) continue;
    if (typeof v === 'number') gl.uniform1f(loc, v);
    else if (v.length === 2) gl.uniform2fv(loc, v);
    else if (v.length === 3) gl.uniform3fv(loc, v);
    else if (v.length === 4) gl.uniform4fv(loc, v);
    else gl.uniform1fv(loc, v);
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  return canvas;
}

/** RGBA boja (0-255, a 0-1) u vec4 za shader. */
export const vec4 = (c: { r: number; g: number; b: number; a: number }) => [c.r / 255, c.g / 255, c.b / 255, c.a];
