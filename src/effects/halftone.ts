import { css, hex, luma } from '../core/color';
import { sizeFactor, SIZE_MOTIONS } from '../core/motion';
import { hash2 } from '../core/random';
import type { EffectModule } from '../core/types';

export const halftone: EffectModule = {
  id: 'halftone',
  name: 'Halftone',
  vector: true,
  motion: { types: SIZE_MOTIONS },
  params: [
    { key: 'cell', label: 'Cell size', type: 'number', min: 3, max: 80, step: 1, default: 9 },
    { key: 'min', label: 'Min size', type: 'number', min: 0, max: 100, step: 1, default: 0, unit: '%' },
    { key: 'max', label: 'Max size', type: 'number', min: 0, max: 150, step: 1, default: 80, unit: '%' },
    {
      key: 'shape',
      label: 'Shape',
      type: 'select',
      options: [
        { value: 'square', label: 'Square' },
        { value: 'circle', label: 'Circle' },
      ],
      default: 'square',
    },
    { key: 'invert', label: 'Invert', type: 'boolean', default: false },
    { key: 'color', label: 'Shape color', type: 'color', default: hex('#FFFFFF') },
    { key: 'bg', label: 'Background', type: 'color', default: hex('#0A4BFF') },
  ],

  render(input, p, ctx) {
    const { width: w, height: h } = input;
    const cell = Math.max(2, p.cell * input.unit);
    if (p.bg.a > 0) {
      ctx.fillStyle = css(p.bg);
      ctx.fillRect(0, 0, w, h);
    }
    const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
    const data = input.sample(cols, rows).data;
    const min = p.min / 100, max = p.max / 100;

    ctx.fillStyle = css(p.color);
    ctx.beginPath();
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = (y * cols + x) * 4;
        let l = luma(data[i], data[i + 1], data[i + 2]);
        if (p.invert) l = 1 - l;
        const cx = x * cell + cell / 2, cy = y * cell + cell / 2;
        const f = input.anim ? sizeFactor(input.anim, cx / w, cy / h, hash2(x, y, 1)) : 1;
        const size = (min + (max - min) * l) * cell * f;
        if (size < 0.5) continue;
        if (p.shape === 'circle') {
          ctx.moveTo(cx + size / 2, cy);
          ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
        } else {
          ctx.rect(cx - size / 2, cy - size / 2, size, size);
        }
      }
    }
    ctx.fill();
  },
};
