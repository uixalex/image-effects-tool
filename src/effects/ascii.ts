import { css, gradientLUT, hex, luma } from '../core/color';
import { font, MONO_FONTS } from '../core/fonts';
import { hash2 } from '../core/random';
import type { EffectModule } from '../core/types';

export const ascii: EffectModule = {
  id: 'ascii',
  name: 'ASCII',
  vector: true,
  motion: {
    types: [
      { value: 'flicker', label: 'Flicker' },
      { value: 'scramble', label: 'Scramble' },
      { value: 'wave', label: 'Grid wave' },
    ],
  },
  params: [
    { key: 'cell', label: 'Cell size', type: 'number', min: 4, max: 64, step: 1, default: 10 },
    { key: 'chars', label: 'Characters (sparse to dense)', type: 'text', default: ' -+×#', placeholder: ' .-+×#@' },
    { key: 'font', label: 'Font', type: 'select', options: MONO_FONTS, default: 'JetBrains Mono' },
    { key: 'bold', label: 'Bold', type: 'boolean', default: false },
    { key: 'invert', label: 'Invert', type: 'boolean', default: false },
    {
      key: 'colorMode',
      label: 'Character color',
      type: 'select',
      options: [
        { value: 'solid', label: 'Solid color' },
        { value: 'image', label: 'From image' },
        { value: 'gradient', label: 'Gradient' },
      ],
      default: 'solid',
    },
    { key: 'color', label: 'Character color', type: 'color', default: hex('#FFFFFF'), showIf: (p) => p.colorMode === 'solid' },
    {
      key: 'gradient',
      label: 'Gradient',
      type: 'gradient',
      default: [
        { pos: 0, color: hex('#3B5BFF') },
        { pos: 0.5, color: hex('#FF8FD1') },
        { pos: 1, color: hex('#FFE7A8') },
      ],
      showIf: (p) => p.colorMode === 'gradient',
    },
    { key: 'bg', label: 'Background', type: 'color', default: hex('#000000') },
  ],

  render(input, p, ctx) {
    const { width: w, height: h } = input;
    const cell = Math.max(2, p.cell * input.unit);
    const chars = Array.from(p.chars as string);
    if (p.bg.a > 0) {
      ctx.fillStyle = css(p.bg);
      ctx.fillRect(0, 0, w, h);
    }
    if (!chars.length) return;

    const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
    const data = input.sample(cols, rows).data;
    const lut = p.colorMode === 'gradient' ? gradientLUT(p.gradient) : null;
    const n = chars.length;
    const a = input.anim;
    const step = a?.type === 'flicker' ? a.step(8) : a?.type === 'scramble' ? a.step(12) : 0;

    ctx.font = font(p.font, cell, p.bold ? 700 : 400);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (p.colorMode === 'solid') ctx.fillStyle = css(p.color);

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = (y * cols + x) * 4;
        let l = luma(data[i], data[i + 1], data[i + 2]);
        if (p.invert) l = 1 - l;
        if (a?.type === 'wave') l = Math.min(1, Math.max(0, l + a.intensity * 0.5 * Math.sin(a.phase - (x / cols + y / rows) * Math.PI * 4)));
        let idx = Math.min(n - 1, Math.floor(l * n));
        if (a && idx > 0) {
          // Treperenje pomjera znak za jedan nivo, scramble ga mijenja nasumičnim. Prazne ćelije ostaju prazne.
          if (a.type === 'flicker' && hash2(x, y, step * 7919 + 1) < a.intensity * 0.5) {
            idx = Math.min(n - 1, Math.max(1, idx + (hash2(x, y, step + 3) < 0.5 ? -1 : 1)));
          } else if (a.type === 'scramble' && n > 1 && hash2(x, y, step * 7919 + 5) < a.intensity * 0.6) {
            idx = 1 + Math.floor(hash2(x, y, step + 11) * (n - 1));
          }
        }
        const ch = chars[idx];
        if (ch === ' ') continue;
        if (p.colorMode === 'image') {
          ctx.fillStyle = `rgb(${data[i]},${data[i + 1]},${data[i + 2]})`;
        } else if (lut) {
          const k = Math.round(l * 255) * 4;
          ctx.fillStyle = `rgba(${lut[k]},${lut[k + 1]},${lut[k + 2]},${lut[k + 3] / 255})`;
        }
        ctx.fillText(ch, x * cell + cell / 2, y * cell + cell / 2);
      }
    }
  },
};
