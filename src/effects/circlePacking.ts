import { css, hex, luma } from '../core/color';
import { sizeFactor, SIZE_MOTIONS } from '../core/motion';
import { hash2, rng } from '../core/random';
import type { EffectModule, Params, RenderInput } from '../core/types';

const INF = 1e20;

/** Tačna euklidska distanca (Felzenszwalb), 1D prolaz nad kvadriranim distancama. */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Za svaki piksel unutar maske: udaljenost do najbližeg piksela van maske. */
function distanceToOutside(mask: Uint8Array, w: number, h: number): Float32Array {
  const grid = new Float64Array(w * h);
  for (let i = 0; i < grid.length; i++) grid[i] = mask[i] ? INF : 0;
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) grid[y * w + x] = d[x];
  }
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) {
    // Rub slike se računa kao izlaz iz oblasti.
    const x = i % w, y = (i / w) | 0;
    out[i] = Math.min(Math.sqrt(grid[i]), x + 1, y + 1, w - x, h - y);
  }
  return out;
}

interface Circle {
  x: number;
  y: number;
  r: number;
}

/** Pakovanje je skupo, a za animaciju se ne mijenja; keširamo ga po izvoru i parametrima rasporeda. */
const packCache = new WeakMap<ImageData, { key: string; circles: Circle[] }>();

function pack(input: RenderInput, p: Params): Circle[] {
  const { width: w, height: h } = input;
  const k = Math.min(1, 700 / Math.max(w, h));
  const gw = Math.max(1, Math.round(w * k)), gh = Math.max(1, Math.round(h * k));
  const sampled = input.sample(gw, gh);
  const key = [w, h, p.side, p.threshold, p.minR, p.maxR, p.density, p.gap, p.seed].join('|');
  const cached = packCache.get(sampled);
  if (cached?.key === key) return cached.circles;
  const circles = packCircles(input, p, sampled.data, k, gw, gh);
  packCache.set(sampled, { key, circles });
  return circles;
}

function packCircles(input: RenderInput, p: Params, data: Uint8ClampedArray, k: number, gw: number, gh: number): Circle[] {
  const { width: w, height: h } = input;
  const mask = new Uint8Array(gw * gh);
  const t = p.threshold / 100;
  for (let i = 0; i < mask.length; i++) {
    const l = luma(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    mask[i] = (p.side === 'bright' ? l > t : l < t) ? 1 : 0;
  }
  const dt = distanceToOutside(mask, gw, gh);

  const u = input.unit;
  const minR = Math.max(0.5, Math.min(p.minR, p.maxR) * u), maxR = Math.max(1, Math.max(p.minR, p.maxR) * u);
  const gap = p.gap * u;
  const candidates: number[] = [];
  for (let i = 0; i < dt.length; i++) if (dt[i] / k - gap >= minR) candidates.push(i);
  if (!candidates.length) return [];

  const circles: Circle[] = [];
  const cellSize = maxR * 2 + gap;
  const hc = Math.ceil(w / cellSize), hr = Math.ceil(h / cellSize);
  const buckets: Circle[][] = Array.from({ length: hc * hr }, () => []);
  const random = rng(p.seed);

  const fit = (x: number, y: number, edge: number) => {
    let r = Math.min(maxR, edge);
    const cx = Math.floor(x / cellSize), cy = Math.floor(y / cellSize);
    for (let j = cy - 1; j <= cy + 1; j++) {
      if (j < 0 || j >= hr) continue;
      for (let i = cx - 1; i <= cx + 1; i++) {
        if (i < 0 || i >= hc) continue;
        for (const c of buckets[j * hc + i]) {
          r = Math.min(r, Math.hypot(c.x - x, c.y - y) - c.r - gap);
          if (r < minR) return r;
        }
      }
    }
    return r;
  };

  // Od najvećih ka najmanjim: u svakom koraku prihvatamo samo krugove barem ciljne veličine.
  const levels = 16;
  const tries = 150 + p.density * 60;
  for (let s = 0; s <= levels; s++) {
    const target = maxR * Math.pow(minR / maxR, s / levels);
    for (let n = 0; n < tries; n++) {
      const idx = candidates[(random() * candidates.length) | 0];
      const x = ((idx % gw) + random()) / k, y = (((idx / gw) | 0) + random()) / k;
      const edge = dt[idx] / k - gap - 1 / k;
      if (edge < target) continue;
      const r = fit(x, y, edge);
      if (r < target) continue;
      const c = { x, y, r };
      circles.push(c);
      buckets[Math.floor(y / cellSize) * hc + Math.floor(x / cellSize)].push(c);
      if (circles.length > 30000) return circles;
    }
  }
  return circles;
}

export const circlePacking: EffectModule = {
  id: 'circlePacking',
  name: 'Circle packing',
  vector: true,
  motion: { types: SIZE_MOTIONS },
  params: [
    {
      key: 'side',
      label: 'Area',
      type: 'select',
      options: [
        { value: 'bright', label: 'Brighter than threshold' },
        { value: 'dark', label: 'Darker than threshold' },
      ],
      default: 'bright',
    },
    { key: 'threshold', label: 'Threshold', type: 'number', min: 0, max: 100, step: 1, default: 45, unit: '%' },
    { key: 'minR', label: 'Min radius', type: 'number', min: 1, max: 100, step: 0.5, default: 6 },
    { key: 'maxR', label: 'Max radius', type: 'number', min: 2, max: 300, step: 1, default: 48 },
    { key: 'density', label: 'Density', type: 'number', min: 1, max: 100, step: 1, default: 60 },
    { key: 'gap', label: 'Gap', type: 'number', min: 0, max: 20, step: 0.5, default: 1 },
    { key: 'seed', label: 'Seed', type: 'number', min: 1, max: 999, step: 1, default: 3 },
    {
      key: 'mode',
      label: 'Style',
      type: 'select',
      options: [
        { value: 'stroke', label: 'Outline' },
        { value: 'fill', label: 'Fill' },
      ],
      default: 'stroke',
    },
    { key: 'lineWidth', label: 'Line width', type: 'number', min: 0.25, max: 10, step: 0.25, default: 1, showIf: (p) => p.mode === 'stroke' },
    { key: 'color', label: 'Color', type: 'color', default: hex('#FFFFFF') },
    { key: 'bg', label: 'Background', type: 'color', default: hex('#000000') },
  ],

  render(input, p, ctx) {
    if (p.bg.a > 0) {
      ctx.fillStyle = css(p.bg);
      ctx.fillRect(0, 0, input.width, input.height);
    }
    const circles = pack(input, p);
    ctx.beginPath();
    const lineWidth = p.lineWidth * input.unit;
    const inset = p.mode === 'stroke' ? lineWidth / 2 : 0;
    const a = input.anim;
    circles.forEach((c, i) => {
      const f = a ? sizeFactor(a, c.x / input.width, c.y / input.height, hash2(i, 0, 5)) : 1;
      const r = Math.max(0.1, c.r * Math.min(1, f) - inset);
      ctx.moveTo(c.x + r, c.y);
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    });
    if (p.mode === 'fill') {
      ctx.fillStyle = css(p.color);
      ctx.fill();
    } else {
      ctx.strokeStyle = css(p.color);
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
  },
};
