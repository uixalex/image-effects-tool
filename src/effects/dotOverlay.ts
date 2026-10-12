import { css, hex, luma } from '../core/color';
import { sizeFactor, SIZE_MOTIONS } from '../core/motion';
import { hash2, rng } from '../core/random';
import type { EffectModule } from '../core/types';

export const dotOverlay: EffectModule = {
  id: 'dotOverlay',
  name: 'Dot overlay',
  vector: true,
  motion: { types: SIZE_MOTIONS },
  params: [
    { key: 'density', label: 'Density', type: 'number', min: 1, max: 100, step: 1, default: 55 },
    { key: 'minSize', label: 'Min size', type: 'number', min: 0.5, max: 40, step: 0.5, default: 1.5 },
    { key: 'maxSize', label: 'Max size', type: 'number', min: 1, max: 120, step: 0.5, default: 22 },
    { key: 'edges', label: 'Edge sensitivity', type: 'number', min: 0, max: 100, step: 1, default: 70, unit: '%' },
    { key: 'seed', label: 'Seed', type: 'number', min: 1, max: 999, step: 1, default: 11 },
    {
      key: 'colorMode',
      label: 'Dot color',
      type: 'select',
      options: [
        { value: 'solid', label: 'Solid color' },
        { value: 'contrast', label: 'Contrast (black on light, white on dark)' },
      ],
      default: 'contrast',
    },
    { key: 'color', label: 'Color', type: 'color', default: hex('#000000'), showIf: (p) => p.colorMode === 'solid' },
  ],

  render(input, p, ctx) {
    const { width: w, height: h } = input;
    const k = Math.min(1, 800 / Math.max(w, h));
    const gw = Math.max(3, Math.round(w * k)), gh = Math.max(3, Math.round(h * k));
    const data = input.sample(gw, gh).data;
    const lum = new Float32Array(gw * gh);
    for (let i = 0; i < lum.length; i++) lum[i] = luma(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    const L = (x: number, y: number) => lum[Math.min(gh - 1, Math.max(0, y)) * gw + Math.min(gw - 1, Math.max(0, x))];

    const random = rng(p.seed);
    const u = input.unit;
    const spacing = Math.max(2, (40 - (p.density / 100) * 36) * u);
    const sens = p.edges / 100;
    const minS = Math.min(p.minSize, p.maxSize) * u, maxS = Math.max(p.minSize, p.maxSize) * u;
    const a = input.anim;
    // Tačke skupljamo pa crtamo po boji (bez Path2D, da isti kod radi i za SVG export).
    const dark: number[] = [], light: number[] = [];
    let n = 0;

    for (let y = spacing / 2; y < h; y += spacing) {
      for (let x = spacing / 2; x < w; x += spacing) {
        const px = x + (random() - 0.5) * spacing, py = y + (random() - 0.5) * spacing;
        const gx = Math.floor(px * k), gy = Math.floor(py * k);
        const b = L(gx, gy);
        const sx = L(gx + 1, gy - 1) + 2 * L(gx + 1, gy) + L(gx + 1, gy + 1) - L(gx - 1, gy - 1) - 2 * L(gx - 1, gy) - L(gx - 1, gy + 1);
        const sy = L(gx - 1, gy + 1) + 2 * L(gx, gy + 1) + L(gx + 1, gy + 1) - L(gx - 1, gy - 1) - 2 * L(gx, gy - 1) - L(gx + 1, gy - 1);
        const e = Math.min(1, Math.hypot(sx, sy) * 2);

        // Ivice privlače tačke, a svjetlina određuje i vjerovatnoću i veličinu.
        const chance = sens * e + (1 - sens) * b;
        if (random() > chance) continue;
        const t = b * (1 - sens * e) * (0.55 + 0.45 * random());
        const f = a ? sizeFactor(a, px / w, py / h, hash2(n++, 0, 9)) : 1;
        const r = ((minS + (maxS - minS) * t) / 2) * f;
        (p.colorMode === 'contrast' && b < 0.5 ? light : dark).push(px, py, r);
      }
    }

    const fill = (dots: number[], color: string) => {
      if (!dots.length) return;
      ctx.beginPath();
      for (let i = 0; i < dots.length; i += 3) {
        ctx.moveTo(dots[i] + dots[i + 2], dots[i + 1]);
        ctx.arc(dots[i], dots[i + 1], dots[i + 2], 0, Math.PI * 2);
      }
      ctx.fillStyle = color;
      ctx.fill();
    };
    fill(dark, p.colorMode === 'contrast' ? '#000' : css(p.color));
    fill(light, '#fff');
  },
};
