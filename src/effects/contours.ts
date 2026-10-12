import { css, hex, luma, sampleGradient } from '../core/color';
import type { EffectModule } from '../core/types';

/** Marching squares: za svaki slučaj (4 bita uglova a,b,c,d) parovi ivica. Ivice: 0 gore, 1 desno, 2 dole, 3 lijevo. */
const CASES: number[][] = [
  [], [3, 2], [2, 1], [3, 1], [0, 1], [0, 3, 2, 1], [0, 2], [0, 3],
  [0, 3], [0, 2], [0, 1, 3, 2], [0, 1], [3, 1], [2, 1], [3, 2], [],
];

function boxBlur(v: Float32Array, w: number, h: number, passes: number) {
  const tmp = new Float32Array(v.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0, n = 0;
        for (let d = -1; d <= 1; d++) {
          const xx = x + d;
          if (xx >= 0 && xx < w) {
            s += v[y * w + xx];
            n++;
          }
        }
        tmp[y * w + x] = s / n;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0, n = 0;
        for (let d = -1; d <= 1; d++) {
          const yy = y + d;
          if (yy >= 0 && yy < h) {
            s += tmp[yy * w + x];
            n++;
          }
        }
        v[y * w + x] = s / n;
      }
    }
  }
}

export const contours: EffectModule = {
  id: 'contours',
  name: 'Contour lines',
  vector: true,
  params: [
    { key: 'levels', label: 'Levels', type: 'number', min: 2, max: 60, step: 1, default: 14 },
    { key: 'detail', label: 'Detail', type: 'number', min: 40, max: 500, step: 10, default: 220 },
    { key: 'smooth', label: 'Smoothing', type: 'number', min: 0, max: 8, step: 1, default: 2 },
    { key: 'lineWidth', label: 'Line width', type: 'number', min: 0.25, max: 8, step: 0.25, default: 1.2 },
    { key: 'major', label: 'Thick line every', type: 'number', min: 0, max: 10, step: 1, default: 5 },
    {
      key: 'colorMode',
      label: 'Line color',
      type: 'select',
      options: [
        { value: 'solid', label: 'Solid color' },
        { value: 'gradient', label: 'Gradient by height' },
      ],
      default: 'solid',
    },
    { key: 'color', label: 'Color', type: 'color', default: hex('#EDEDED'), showIf: (p) => p.colorMode === 'solid' },
    {
      key: 'gradient',
      label: 'Gradient',
      type: 'gradient',
      default: [
        { pos: 0, color: hex('#3B5BFF') },
        { pos: 0.5, color: hex('#FF7AC2') },
        { pos: 1, color: hex('#FFE29A') },
      ],
      showIf: (p) => p.colorMode === 'gradient',
    },
    { key: 'bg', label: 'Background', type: 'color', default: hex('#0B0B0D') },
  ],
  motion: {
    types: [
      { value: 'flow', label: 'Flowing levels' },
      { value: 'breathe', label: 'Line width pulse' },
    ],
  },

  render(input, p, ctx) {
    const { width: w, height: h } = input;
    if (p.bg.a > 0) {
      ctx.fillStyle = css(p.bg);
      ctx.fillRect(0, 0, w, h);
    }
    const scale = p.detail / Math.max(w, h);
    const gw = Math.max(2, Math.round(w * scale)), gh = Math.max(2, Math.round(h * scale));
    const data = input.sample(gw, gh).data;
    const v = new Float32Array(gw * gh);
    for (let i = 0; i < v.length; i++) v[i] = luma(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    boxBlur(v, gw, gh, p.smooth);

    const a = input.anim;
    // Pomak nivoa za cijeli razmak između nivoa: kraj loopa izgleda isto kao početak.
    const shift = a?.type === 'flow' ? ((a.phase / (Math.PI * 2)) % 1 + 1) % 1 : 0;
    const widthMul = a?.type === 'breathe' ? 1 + 0.6 * a.intensity * Math.sin(a.phase) : 1;
    const sx = w / gw, sy = h / gh;
    const X = (x: number) => (x + 0.5) * sx, Y = (y: number) => (y + 0.5) * sy;

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let k = 0; k < p.levels; k++) {
      const level = (k + 0.5 + shift) / p.levels;
      if (level >= 1) continue;
      ctx.beginPath();
      for (let y = 0; y < gh - 1; y++) {
        for (let x = 0; x < gw - 1; x++) {
          const va = v[y * gw + x], vb = v[y * gw + x + 1], vc = v[(y + 1) * gw + x + 1], vd = v[(y + 1) * gw + x];
          const c = (va > level ? 8 : 0) | (vb > level ? 4 : 0) | (vc > level ? 2 : 0) | (vd > level ? 1 : 0);
          const segs = CASES[c];
          if (!segs.length) continue;
          const edge = (e: number): [number, number] => {
            const t = (p0: number, p1: number) => (p1 === p0 ? 0.5 : (level - p0) / (p1 - p0));
            if (e === 0) return [X(x + t(va, vb)), Y(y)];
            if (e === 1) return [X(x + 1), Y(y + t(vb, vc))];
            if (e === 2) return [X(x + t(vd, vc)), Y(y + 1)];
            return [X(x), Y(y + t(va, vd))];
          };
          for (let s = 0; s < segs.length; s += 2) {
            const [x1, y1] = edge(segs[s]), [x2, y2] = edge(segs[s + 1]);
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
          }
        }
      }
      const major = p.major > 0 && k % p.major === 0;
      ctx.lineWidth = Math.max(0.25, p.lineWidth * input.unit * widthMul * (major ? 2.2 : 1));
      ctx.strokeStyle = p.colorMode === 'gradient' ? css(sampleGradient(p.gradient, level)) : css(p.color);
      ctx.stroke();
    }
  },
};
