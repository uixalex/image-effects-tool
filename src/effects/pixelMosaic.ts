import { css, hex, luma } from '../core/color';
import { font, MONO_FONTS } from '../core/fonts';
import { hash2 } from '../core/random';
import type { EffectModule } from '../core/types';

export const pixelMosaic: EffectModule = {
  id: 'pixelMosaic',
  name: 'Pixel mosaic',
  vector: true,
  motion: { types: [{ value: 'numbers', label: 'Changing numbers' }] },
  params: [
    { key: 'cell', label: 'Cell size', type: 'number', min: 4, max: 120, step: 1, default: 24 },
    { key: 'gap', label: 'Gap', type: 'number', min: 0, max: 10, step: 0.5, default: 1 },
    {
      key: 'mode',
      label: 'Cell colors',
      type: 'select',
      options: [
        { value: 'gray', label: 'Grayscale' },
        { value: 'color', label: 'From image' },
      ],
      default: 'gray',
    },
    { key: 'levels', label: 'Levels', type: 'number', min: 2, max: 64, step: 1, default: 12 },
    { key: 'percent', label: 'Cells with numbers', type: 'number', min: 0, max: 100, step: 1, default: 15, unit: '%' },
    { key: 'seed', label: 'Seed', type: 'number', min: 1, max: 999, step: 1, default: 7 },
    { key: 'font', label: 'Font', type: 'select', options: MONO_FONTS, default: 'JetBrains Mono' },
    { key: 'fontSize', label: 'Number size', type: 'number', min: 20, max: 100, step: 1, default: 60, unit: '%' },
    { key: 'textColor', label: 'Number color', type: 'color', default: hex('#000000') },
    { key: 'numberBg', label: 'Numbered cell background', type: 'color', default: hex('#FFFFFF') },
    { key: 'bg', label: 'Background', type: 'color', default: hex('#000000') },
  ],

  render(input, p, ctx) {
    const { width: w, height: h } = input;
    const cell = Math.max(2, p.cell * input.unit);
    const gap = Math.min(p.gap * input.unit, cell - 1);
    if (p.bg.a > 0) {
      ctx.fillStyle = css(p.bg);
      ctx.fillRect(0, 0, w, h);
    }
    const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
    const data = input.sample(cols, rows).data;
    const steps = Math.max(1, p.levels - 1);
    const q = (v: number) => Math.round(Math.round((v / 255) * steps) / steps * 255);
    const size = cell - gap;
    const numbered: { x: number; y: number; digit: number }[] = [];
    const a = input.anim;
    const step = a ? a.step(6) : 0;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = (y * cols + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const l = luma(r, g, b);
        if (p.mode === 'gray') {
          const v = q(l * 255);
          ctx.fillStyle = `rgb(${v},${v},${v})`;
        } else {
          ctx.fillStyle = `rgb(${q(r)},${q(g)},${q(b)})`;
        }
        ctx.fillRect(x * cell + gap / 2, y * cell + gap / 2, size, size);
        let digit = Math.round(l * 9);
        // Nule u potpuno tamnim dijelovima ne nose informaciju, pa ih preskačemo.
        if (digit === 0) continue;
        // U animaciji se dio ćelija sa brojem bira iznova u svakom koraku, a cifre im se mijenjaju.
        const moving = a && hash2(x, y, p.seed + 1) < a.intensity;
        if (hash2(x, y, moving ? p.seed + step * 101 : p.seed) >= p.percent / 100) continue;
        if (moving) digit = 1 + Math.floor(hash2(x, y, step * 31 + 7) * 9);
        numbered.push({ x, y, digit });
      }
    }

    if (!numbered.length) return;
    ctx.font = font(p.font, size * (p.fontSize / 100), 700);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const n of numbered) {
      const x0 = n.x * cell + gap / 2, y0 = n.y * cell + gap / 2;
      if (p.numberBg.a > 0) {
        ctx.fillStyle = css(p.numberBg);
        ctx.fillRect(x0, y0, size, size);
      }
      ctx.fillStyle = css(p.textColor);
      ctx.fillText(String(n.digit), x0 + size / 2, y0 + size / 2 + size * 0.04);
    }
  },
};
