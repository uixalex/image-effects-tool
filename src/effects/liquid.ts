import { runShader } from '../core/gl';
import type { EffectModule } from '../core/types';

const FRAG = `
uniform float u_amount;
uniform float u_scale;
uniform float u_mode;
uniform float u_seed;
uniform float u_phase;
void main() {
  vec2 aspect = vec2(u_res.x / u_res.y, 1.0);
  vec2 p = v_uv * aspect * u_scale;
  // Kružno kretanje kroz šum: kraj loopa se spaja s početkom.
  vec2 t = vec2(cos(u_phase), sin(u_phase)) * 0.6;
  vec2 off;
  if (u_mode < 0.5) {
    off = vec2(fbm(p + t + u_seed), fbm(p + vec2(5.2, 1.3) - t + u_seed)) - 0.5;
  } else if (u_mode < 1.5) {
    vec2 c = (v_uv - 0.5) * aspect;
    float d = length(c);
    off = (c / max(d, 1e-4)) * sin(d * u_scale * 6.2831 - u_phase) * 0.5 / aspect;
  } else {
    off = vec2(sin(v_uv.y * u_scale * 6.2831 + u_phase), cos(v_uv.x * u_scale * 3.1415 + u_phase) * 0.3) * 0.5;
  }
  gl_FragColor = texture2D(u_src, clamp(v_uv + off * u_amount, 0.0, 1.0));
}`;

const MODES = ['liquid', 'ripple', 'wave'];

export const liquid: EffectModule = {
  id: 'liquid',
  name: 'Liquid',
  params: [
    {
      key: 'mode',
      label: 'Mode',
      type: 'select',
      options: [
        { value: 'liquid', label: 'Liquid (noise)' },
        { value: 'ripple', label: 'Ripple' },
        { value: 'wave', label: 'Wave' },
      ],
      default: 'liquid',
    },
    { key: 'amount', label: 'Amount', type: 'number', min: 0, max: 100, step: 1, default: 30, unit: '%' },
    { key: 'scale', label: 'Scale', type: 'number', min: 0.5, max: 20, step: 0.1, default: 3 },
    { key: 'seed', label: 'Seed', type: 'number', min: 1, max: 999, step: 1, default: 4 },
  ],
  motion: { types: [{ value: 'flow', label: 'Flow' }] },

  render(input, p, ctx) {
    const a = input.anim;
    const canvas = runShader(
      FRAG,
      input.width,
      input.height,
      {
        u_amount: (p.amount / 100) * 0.25 * (a ? 0.5 + a.intensity : 1),
        u_scale: p.scale,
        u_mode: MODES.indexOf(p.mode),
        u_seed: p.seed * 7.31,
        u_phase: a ? a.phase : 0,
      },
      input.source,
    );
    ctx.drawImage(canvas, 0, 0);
  },
};
