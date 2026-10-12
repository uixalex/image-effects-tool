import { hex, luma } from '../core/color';
import { hash2 } from '../core/random';
import type { EffectModule } from '../core/types';

/** Bayer matrica n x n, vrijednosti 0..1. */
function bayer(n: number): Float32Array {
  let m = [[0]];
  while (m.length < n) {
    const s = m.length;
    const next = Array.from({ length: s * 2 }, () => new Array(s * 2).fill(0));
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const v = m[y][x] * 4;
        next[y][x] = v;
        next[y][x + s] = v + 2;
        next[y + s][x] = v + 3;
        next[y + s][x + s] = v + 1;
      }
    }
    m = next;
  }
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out[y * n + x] = (m[y][x] + 0.5) / (n * n);
  return out;
}
const BAYER: Record<string, Float32Array> = { bayer2: bayer(2), bayer4: bayer(4), bayer8: bayer(8) };

/** Raspodjela greške: [dx, dy, težina]. */
const DIFFUSION: Record<string, [number, number, number][]> = {
  floyd: [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]],
  atkinson: [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]],
};

export const dither: EffectModule = {
  id: 'dither',
  name: 'Dithering',
  params: [
    { key: 'pixel', label: 'Pixel size', type: 'number', min: 1, max: 24, step: 0.5, default: 3 },
    {
      key: 'algorithm',
      label: 'Algorithm',
      type: 'select',
      options: [
        { value: 'bayer2', label: 'Bayer 2×2' },
        { value: 'bayer4', label: 'Bayer 4×4' },
        { value: 'bayer8', label: 'Bayer 8×8' },
        { value: 'floyd', label: 'Floyd-Steinberg' },
        { value: 'atkinson', label: 'Atkinson' },
      ],
      default: 'bayer4',
    },
    {
      key: 'palette',
      label: 'Palette',
      type: 'select',
      options: [
        { value: 'two', label: 'Two colors (1-bit)' },
        { value: 'image', label: 'Image colors' },
      ],
      default: 'two',
    },
    { key: 'levels', label: 'Levels per channel', type: 'number', min: 2, max: 8, step: 1, default: 3, showIf: (p) => p.palette === 'image' },
    { key: 'dark', label: 'Dark color', type: 'color', default: hex('#111014'), showIf: (p) => p.palette === 'two' },
    { key: 'light', label: 'Light color', type: 'color', default: hex('#EDE8DC'), showIf: (p) => p.palette === 'two' },
    { key: 'contrast', label: 'Contrast', type: 'number', min: -100, max: 100, step: 1, default: 10 },
    { key: 'brightness', label: 'Brightness', type: 'number', min: -50, max: 50, step: 1, default: 0 },
  ],
  motion: {
    types: [
      { value: 'shimmer', label: 'Shimmer' },
      { value: 'pulse', label: 'Brightness pulse' },
    ],
    apply(p, a) {
      return a.type === 'pulse' ? { ...p, brightness: p.brightness + a.intensity * 30 * Math.sin(a.phase) } : p;
    },
  },

  render(input, p, ctx) {
    const { width: w, height: h } = input;
    const px = Math.max(1, p.pixel * input.unit);
    const cols = Math.ceil(w / px), rows = Math.ceil(h / px);
    const src = input.sample(cols, rows).data;
    const contrast = p.contrast >= 0 ? 1 + (p.contrast / 100) * 3 : Math.max(0, 1 + p.contrast / 100);
    const bright = p.brightness / 100;
    const two = p.palette === 'two';
    const channels = two ? 1 : 3;
    const levels = two ? 2 : p.levels;
    const steps = levels - 1;

    // Vrijednosti 0-1 po kanalu, nakon kontrasta i svjetline.
    const n = cols * rows;
    const val = new Float32Array(n * channels);
    for (let i = 0; i < n; i++) {
      if (two) val[i] = (luma(src[i * 4], src[i * 4 + 1], src[i * 4 + 2]) - 0.5) * contrast + 0.5 + bright;
      else for (let c = 0; c < 3; c++) val[i * 3 + c] = (src[i * 4 + c] / 255 - 0.5) * contrast + 0.5 + bright;
    }

    const a = input.anim;
    const shimmer = a?.type === 'shimmer' ? a.step(10) : -1;
    const matrix = BAYER[p.algorithm];
    const out = new Float32Array(n * channels);
    if (matrix) {
      const m = Math.round(Math.sqrt(matrix.length));
      // Shimmer pomjera Bayer mrežu, pa uzorak treperi.
      const ox = shimmer >= 0 ? Math.floor(hash2(shimmer, 1, 3) * m) : 0, oy = shimmer >= 0 ? Math.floor(hash2(shimmer, 2, 3) * m) : 0;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const t = matrix[((y + oy) % m) * m + ((x + ox) % m)] - 0.5;
          for (let c = 0; c < channels; c++) {
            const i = (y * cols + x) * channels + c;
            out[i] = Math.min(steps, Math.max(0, Math.round(val[i] * steps + t))) / steps;
          }
        }
      }
    } else {
      const kernel = DIFFUSION[p.algorithm];
      const jitter = shimmer >= 0 ? (a!.intensity * 0.15) : 0;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          for (let c = 0; c < channels; c++) {
            const i = (y * cols + x) * channels + c;
            const v = val[i] + (jitter ? (hash2(x, y, shimmer * 7 + c) - 0.5) * jitter : 0);
            const q = Math.min(steps, Math.max(0, Math.round(v * steps))) / steps;
            out[i] = q;
            const err = v - q;
            for (const [dx, dy, wgt] of kernel) {
              const nx = x + dx, ny = y + dy;
              if (nx < 0 || nx >= cols || ny >= rows) continue;
              val[(ny * cols + nx) * channels + c] += err * wgt;
            }
          }
        }
      }
    }

    const tmp = document.createElement('canvas');
    tmp.width = cols;
    tmp.height = rows;
    const tctx = tmp.getContext('2d')!;
    const img = tctx.createImageData(cols, rows);
    const d = img.data;
    for (let i = 0; i < n; i++) {
      if (two) {
        const c = out[i] > 0.5 ? p.light : p.dark;
        d[i * 4] = c.r;
        d[i * 4 + 1] = c.g;
        d[i * 4 + 2] = c.b;
        d[i * 4 + 3] = c.a * 255;
      } else {
        d[i * 4] = out[i * 3] * 255;
        d[i * 4 + 1] = out[i * 3 + 1] * 255;
        d[i * 4 + 2] = out[i * 3 + 2] * 255;
        d[i * 4 + 3] = 255;
      }
    }
    tctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, cols * px, rows * px);
  },
};
