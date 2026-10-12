import { hex } from '../core/color';
import { runShader, vec4 } from '../core/gl';
import type { EffectModule } from '../core/types';

const FRAG = `
uniform vec4 u_c0;
uniform vec4 u_c1;
uniform vec4 u_c2;
uniform vec4 u_c3;
uniform float u_warp;
uniform float u_scale;
uniform float u_soft;
uniform float u_seed;
uniform float u_phase;
uniform float u_move;
uniform float u_image;
uniform float u_grain;
uniform float u_grainSize;
uniform float u_grainSeed;

vec2 point(float i) {
  vec2 base = vec2(hash12(vec2(i, u_seed)), hash12(vec2(u_seed, i + 3.0))) * 0.8 + 0.1;
  return base + u_move * 0.18 * vec2(cos(u_phase + i * 1.7), sin(u_phase + i * 2.3));
}

void main() {
  vec2 aspect = vec2(u_res.x / u_res.y, 1.0);
  vec2 t = vec2(cos(u_phase), sin(u_phase)) * 0.4 * u_move;
  vec2 p = v_uv;
  p += (vec2(fbm(p * u_scale + u_seed + t), fbm(p * u_scale + u_seed + 7.3 - t)) - 0.5) * u_warp;
  // Slika može savijati gradijent oko svojih oblika.
  p += (luma(texture2D(u_src, v_uv).rgb) - 0.5) * u_image * 0.3;

  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float d = length((p - point(fi)) * aspect);
    float w = 1.0 / pow(d + 0.02, u_soft);
    vec4 c = i == 0 ? u_c0 : i == 1 ? u_c1 : i == 2 ? u_c2 : u_c3;
    acc += c * w;
    wsum += w;
  }
  vec4 col = acc / wsum;
  vec2 gp = floor(v_uv * u_res / u_grainSize);
  col.rgb += (hash12(gp + u_grainSeed * 13.7) - 0.5) * u_grain;
  gl_FragColor = vec4(clamp(col.rgb, 0.0, 1.0), col.a);
}`;

export const meshGradient: EffectModule = {
  id: 'meshGradient',
  name: 'Mesh gradient',
  params: [
    { key: 'c0', label: 'Color 1', type: 'color', default: hex('#FF7AB6') },
    { key: 'c1', label: 'Color 2', type: 'color', default: hex('#7B61FF') },
    { key: 'c2', label: 'Color 3', type: 'color', default: hex('#22C1FF') },
    { key: 'c3', label: 'Color 4', type: 'color', default: hex('#FFD27A') },
    { key: 'softness', label: 'Softness', type: 'number', min: 1, max: 6, step: 0.1, default: 2.4 },
    { key: 'warp', label: 'Warp', type: 'number', min: 0, max: 100, step: 1, default: 45, unit: '%' },
    { key: 'scale', label: 'Warp scale', type: 'number', min: 0.5, max: 8, step: 0.1, default: 2 },
    { key: 'image', label: 'Image influence', type: 'number', min: 0, max: 100, step: 1, default: 0, unit: '%' },
    { key: 'grain', label: 'Grain', type: 'number', min: 0, max: 100, step: 1, default: 10, unit: '%' },
    { key: 'grainSize', label: 'Grain size', type: 'number', min: 1, max: 6, step: 0.5, default: 1.5 },
    { key: 'seed', label: 'Seed', type: 'number', min: 1, max: 999, step: 1, default: 12 },
  ],
  motion: { types: [{ value: 'flow', label: 'Flow' }] },

  render(input, p, ctx) {
    const a = input.anim;
    const canvas = runShader(
      FRAG,
      input.width,
      input.height,
      {
        u_c0: vec4(p.c0),
        u_c1: vec4(p.c1),
        u_c2: vec4(p.c2),
        u_c3: vec4(p.c3),
        u_warp: (p.warp / 100) * 0.6,
        u_scale: p.scale,
        u_soft: p.softness,
        u_seed: p.seed * 0.137,
        u_phase: a ? a.phase : 0,
        u_move: a ? 0.3 + a.intensity : 0,
        u_image: p.image / 100,
        u_grain: p.grain / 100,
        u_grainSize: Math.max(1, p.grainSize * input.unit),
        u_grainSeed: a ? a.step(24) % 997 : 0,
      },
      input.source,
    );
    ctx.drawImage(canvas, 0, 0);
  },
};
