import { luma } from '../core/color';
import { rng } from '../core/random';
import type { EffectModule } from '../core/types';

/** Radna rezolucija; pixel sort na punih 2048px je spor za preview. */
const WORK_SIDE = 1200;

export const glitch: EffectModule = {
  id: 'glitch',
  name: 'Glitch',
  params: [
    { key: 'split', label: 'RGB split', type: 'number', min: 0, max: 60, step: 0.5, default: 8 },
    { key: 'angle', label: 'Split angle', type: 'number', min: 0, max: 360, step: 1, default: 0, unit: '°' },
    { key: 'slices', label: 'Slices', type: 'number', min: 0, max: 40, step: 1, default: 8 },
    { key: 'shift', label: 'Slice shift', type: 'number', min: 0, max: 300, step: 1, default: 60 },
    { key: 'sort', label: 'Pixel sorting', type: 'boolean', default: true },
    {
      key: 'direction',
      label: 'Sort direction',
      type: 'select',
      options: [
        { value: 'h', label: 'Horizontal' },
        { value: 'v', label: 'Vertical' },
      ],
      default: 'v',
      showIf: (p) => p.sort,
    },
    { key: 'low', label: 'Sort from brightness', type: 'number', min: 0, max: 100, step: 1, default: 35, unit: '%', showIf: (p) => p.sort },
    { key: 'high', label: 'Sort to brightness', type: 'number', min: 0, max: 100, step: 1, default: 90, unit: '%', showIf: (p) => p.sort },
    { key: 'seed', label: 'Seed', type: 'number', min: 1, max: 999, step: 1, default: 5 },
  ],
  motion: {
    types: [
      { value: 'jitter', label: 'Jitter' },
      { value: 'pulse', label: 'Split pulse' },
    ],
    apply(p, a) {
      if (a.type === 'pulse') return { ...p, split: p.split * (1 + a.intensity * Math.sin(a.phase)) };
      if (a.type === 'jitter') {
        const s = a.step(8);
        const r = rng(p.seed * 31 + s)();
        return { ...p, seed: p.seed + s * 17, split: p.split * (1 - a.intensity * 0.6 + r * a.intensity * 1.2) };
      }
      return p;
    },
  },

  render(input, p, ctx) {
    const { width: w, height: h } = input;
    const k = Math.min(1, WORK_SIDE / Math.max(w, h));
    const ww = Math.max(1, Math.round(w * k)), hh = Math.max(1, Math.round(h * k));
    // Kopija izvora, jer je sample keširan i ne smije se mijenjati.
    const src = new Uint8ClampedArray(input.sample(ww, hh).data);
    const px = new Uint32Array(src.buffer);
    const lum = new Float32Array(ww * hh);
    for (let i = 0; i < lum.length; i++) lum[i] = luma(src[i * 4], src[i * 4 + 1], src[i * 4 + 2]);
    const scale = input.unit * k;

    if (p.sort) {
      const lo = Math.min(p.low, p.high) / 100, hi = Math.max(p.low, p.high) / 100;
      const vertical = p.direction === 'v';
      const lines = vertical ? ww : hh, len = vertical ? hh : ww;
      const idx = (line: number, t: number) => (vertical ? t * ww + line : line * ww + t);
      const run: number[] = [];
      const flush = () => {
        if (run.length > 1) {
          const sorted = run.map((i) => [lum[i], px[i]] as const).sort((a, b) => a[0] - b[0]);
          run.forEach((i, j) => {
            px[i] = sorted[j][1];
            lum[i] = sorted[j][0];
          });
        }
        run.length = 0;
      };
      for (let line = 0; line < lines; line++) {
        for (let t = 0; t < len; t++) {
          const i = idx(line, t);
          if (lum[i] >= lo && lum[i] <= hi) run.push(i);
          else flush();
        }
        flush();
      }
    }

    if (p.slices > 0 && p.shift > 0) {
      const random = rng(p.seed);
      const row = new Uint32Array(ww);
      for (let s = 0; s < p.slices; s++) {
        const y0 = Math.floor(random() * hh);
        const sh = Math.max(1, Math.floor(random() * random() * hh * 0.12));
        const dx = Math.round((random() - 0.5) * 2 * p.shift * scale);
        for (let y = y0; y < Math.min(hh, y0 + sh); y++) {
          const off = y * ww;
          for (let x = 0; x < ww; x++) row[x] = px[off + ((((x - dx) % ww) + ww) % ww)];
          px.set(row, off);
        }
      }
    }

    let out = new Uint8ClampedArray(px.buffer);
    if (p.split > 0) {
      const d = p.split * scale;
      const dx = Math.round(Math.cos((p.angle * Math.PI) / 180) * d), dy = Math.round(Math.sin((p.angle * Math.PI) / 180) * d);
      const res = new Uint8ClampedArray(out.length);
      const at = (x: number, y: number) => (Math.min(hh - 1, Math.max(0, y)) * ww + Math.min(ww - 1, Math.max(0, x))) * 4;
      for (let y = 0; y < hh; y++) {
        for (let x = 0; x < ww; x++) {
          const i = (y * ww + x) * 4;
          res[i] = out[at(x + dx, y + dy)];
          res[i + 1] = out[i + 1];
          res[i + 2] = out[at(x - dx, y - dy) + 2];
          res[i + 3] = 255;
        }
      }
      out = res;
    }

    const tmp = document.createElement('canvas');
    tmp.width = ww;
    tmp.height = hh;
    tmp.getContext('2d')!.putImageData(new ImageData(out, ww, hh), 0, 0);
    ctx.drawImage(tmp, 0, 0, w, h);
  },
};
