import { hex, hsvToRgb, rgbToHsv, type RGBA } from '../core/color';
import { runShader, vec4 } from '../core/gl';
import type { EffectModule } from '../core/types';

const FRAG = `
uniform vec4 u_dark;
uniform vec4 u_light;
uniform float u_contrast;
uniform float u_bright;
void main() {
  float l = luma(texture2D(u_src, v_uv).rgb);
  l = clamp((l - 0.5) * u_contrast + 0.5 + u_bright, 0.0, 1.0);
  gl_FragColor = mix(u_dark, u_light, l);
}`;

const shiftHue = (c: RGBA, deg: number) => {
  const { h, s, v } = rgbToHsv(c);
  return hsvToRgb((((h + deg) % 360) + 360) % 360, s, v, c.a);
};

export const duotone: EffectModule = {
  id: 'duotone',
  name: 'Duotone',
  params: [
    { key: 'dark', label: 'Shadows', type: 'color', default: hex('#1F1A8A') },
    { key: 'light', label: 'Highlights', type: 'color', default: hex('#FF8FB8') },
    { key: 'contrast', label: 'Contrast', type: 'number', min: -100, max: 100, step: 1, default: 15 },
    { key: 'brightness', label: 'Brightness', type: 'number', min: -50, max: 50, step: 1, default: 0 },
  ],
  motion: {
    types: [
      { value: 'pulse', label: 'Contrast pulse' },
      { value: 'hue', label: 'Hue shift' },
    ],
    apply(p, a) {
      if (a.type === 'pulse') return { ...p, contrast: p.contrast + a.intensity * 80 * Math.sin(a.phase) };
      if (a.type === 'hue') {
        const deg = a.intensity * 180 * Math.sin(a.phase);
        return { ...p, dark: shiftHue(p.dark, deg), light: shiftHue(p.light, deg) };
      }
      return p;
    },
  },

  render(input, p, ctx) {
    const contrast = p.contrast >= 0 ? 1 + (p.contrast / 100) * 3 : Math.max(0, 1 + p.contrast / 100);
    ctx.drawImage(
      runShader(FRAG, input.width, input.height, { u_dark: vec4(p.dark), u_light: vec4(p.light), u_contrast: contrast, u_bright: p.brightness / 100 }, input.source),
      0,
      0,
    );
  },
};
