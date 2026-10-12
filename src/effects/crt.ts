import { runShader } from '../core/gl';
import { hash2 } from '../core/random';
import type { EffectModule } from '../core/types';

const FRAG = `
uniform float u_curve;
uniform float u_scan;
uniform float u_scanSize;
uniform float u_mask;
uniform float u_bloom;
uniform float u_bloomRadius;
uniform float u_aberr;
uniform float u_vignette;
uniform float u_flicker;
uniform float u_roll;
void main() {
  // Zakrivljenje ekrana (barrel).
  vec2 c = v_uv * 2.0 - 1.0;
  c *= 1.0 + u_curve * 0.12 * dot(c, c);
  vec2 uv = c * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec2 px = 1.0 / u_res;
  vec3 col = vec3(
    texture2D(u_src, uv + vec2(u_aberr, 0.0) * px).r,
    texture2D(u_src, uv).g,
    texture2D(u_src, uv - vec2(u_aberr, 0.0) * px).b
  );

  // Bloom: svijetli dijelovi razliveni u spirali uzoraka.
  if (u_bloom > 0.0) {
    vec3 bl = vec3(0.0);
    for (int i = 0; i < 24; i++) {
      float fi = float(i);
      float ang = fi * 2.39996;
      float r = sqrt(fi + 0.5) / sqrt(24.0) * u_bloomRadius;
      vec3 s = texture2D(u_src, uv + vec2(cos(ang), sin(ang)) * r * px).rgb;
      bl += max(s - 0.45, 0.0) * 1.8;
    }
    col += bl / 24.0 * u_bloom;
  }

  vec2 pos = uv * u_res;
  float scan = 0.5 + 0.5 * cos(pos.y / u_scanSize * 6.2831);
  col *= 1.0 - u_scan * 0.65 * scan;

  // RGB maska (aperture grille).
  float m = mod(floor(pos.x / max(1.0, u_scanSize * 0.5)), 3.0);
  vec3 mask = m < 0.5 ? vec3(1.0, 0.4, 0.4) : m < 1.5 ? vec3(0.4, 1.0, 0.4) : vec3(0.4, 0.4, 1.0);
  col *= mix(vec3(1.0), mask * 1.6, u_mask);

  // Traka koja putuje odozgo nadolje.
  float band = fract(uv.y - u_roll);
  col *= 1.0 + 0.18 * smoothstep(0.0, 0.06, band) * smoothstep(0.14, 0.06, band) * step(0.0001, u_roll);

  float vig = smoothstep(1.4, 0.4, length(c));
  col *= mix(1.0, vig, u_vignette);
  gl_FragColor = vec4(clamp(col * u_flicker, 0.0, 1.0), 1.0);
}`;

export const crt: EffectModule = {
  id: 'crt',
  name: 'CRT',
  params: [
    { key: 'curve', label: 'Curvature', type: 'number', min: 0, max: 100, step: 1, default: 40, unit: '%' },
    { key: 'scan', label: 'Scanlines', type: 'number', min: 0, max: 100, step: 1, default: 55, unit: '%' },
    { key: 'scanSize', label: 'Scanline size', type: 'number', min: 1, max: 12, step: 0.5, default: 3 },
    { key: 'mask', label: 'RGB mask', type: 'number', min: 0, max: 100, step: 1, default: 30, unit: '%' },
    { key: 'bloom', label: 'Bloom', type: 'number', min: 0, max: 100, step: 1, default: 45, unit: '%' },
    { key: 'bloomRadius', label: 'Bloom radius', type: 'number', min: 2, max: 60, step: 1, default: 18 },
    { key: 'aberration', label: 'Color fringing', type: 'number', min: 0, max: 20, step: 0.5, default: 2 },
    { key: 'vignette', label: 'Vignette', type: 'number', min: 0, max: 100, step: 1, default: 60, unit: '%' },
  ],
  motion: {
    types: [
      { value: 'flicker', label: 'Flicker' },
      { value: 'roll', label: 'Rolling bar' },
    ],
  },

  render(input, p, ctx) {
    const u = input.unit;
    const a = input.anim;
    const flicker = a?.type === 'flicker' ? 1 - a.intensity * 0.25 * hash2(a.step(20), 0, 3) : 1;
    const roll = a?.type === 'roll' ? ((a.phase / (Math.PI * 2)) % 1) + 1e-3 : 0;
    const canvas = runShader(
      FRAG,
      input.width,
      input.height,
      {
        u_curve: p.curve / 100,
        u_scan: p.scan / 100,
        u_scanSize: Math.max(1, p.scanSize * u),
        u_mask: p.mask / 100,
        u_bloom: (p.bloom / 100) * 2,
        u_bloomRadius: p.bloomRadius * u,
        u_aberr: p.aberration * u,
        u_vignette: p.vignette / 100,
        u_flicker: flicker,
        u_roll: roll,
      },
      input.source,
    );
    ctx.drawImage(canvas, 0, 0);
  },
};
