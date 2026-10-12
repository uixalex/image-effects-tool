import { css, hex, luma } from '../core/color';
import type { EffectModule } from '../core/types';

export const lineHalftone: EffectModule = {
  id: 'lineHalftone',
  name: 'Line halftone',
  vector: true,
  params: [
    { key: 'spacing', label: 'Line spacing', type: 'number', min: 2, max: 60, step: 0.5, default: 9 },
    { key: 'angle', label: 'Angle', type: 'number', min: 0, max: 180, step: 1, default: 30, unit: '°' },
    { key: 'min', label: 'Min thickness', type: 'number', min: 0, max: 100, step: 1, default: 4, unit: '%' },
    { key: 'max', label: 'Max thickness', type: 'number', min: 0, max: 100, step: 1, default: 90, unit: '%' },
    { key: 'invert', label: 'Invert', type: 'boolean', default: false },
    { key: 'wave', label: 'Wave amount', type: 'number', min: 0, max: 40, step: 0.5, default: 0 },
    { key: 'waveFreq', label: 'Wave frequency', type: 'number', min: 1, max: 40, step: 0.5, default: 8, showIf: (p) => p.wave > 0 },
    { key: 'color', label: 'Line color', type: 'color', default: hex('#111111') },
    { key: 'bg', label: 'Background', type: 'color', default: hex('#F2EEE4') },
  ],
  motion: {
    types: [
      { value: 'wave', label: 'Wave' },
      { value: 'breathe', label: 'Breathe' },
    ],
  },

  render(input, p, ctx) {
    const { width: w, height: h } = input;
    const u = input.unit;
    if (p.bg.a > 0) {
      ctx.fillStyle = css(p.bg);
      ctx.fillRect(0, 0, w, h);
    }
    const k = Math.min(1, 700 / Math.max(w, h));
    const gw = Math.max(2, Math.round(w * k)), gh = Math.max(2, Math.round(h * k));
    const data = input.sample(gw, gh).data;
    const darkness = (x: number, y: number) => {
      const gx = Math.min(gw - 1, Math.max(0, Math.floor(x * k))), gy = Math.min(gh - 1, Math.max(0, Math.floor(y * k)));
      const i = (gy * gw + gx) * 4;
      const l = luma(data[i], data[i + 1], data[i + 2]);
      return p.invert ? l : 1 - l;
    };

    const a = input.anim;
    const spacing = Math.max(1.5, p.spacing * u);
    const ang = (p.angle * Math.PI) / 180;
    const dir = [Math.cos(ang), Math.sin(ang)], nor = [-Math.sin(ang), Math.cos(ang)];
    const diag = Math.hypot(w, h);
    const cx = w / 2, cy = h / 2;
    const step = Math.max(1, spacing / 2);
    const waveAmp = (p.wave * u) + (a?.type === 'wave' ? a.intensity * spacing * 0.6 : 0);
    const waveFreq = ((p.waveFreq || 8) * Math.PI * 2) / diag;
    const breathe = a?.type === 'breathe' ? 1 + 0.5 * a.intensity * Math.sin(a.phase) : 1;
    const phase = a?.type === 'wave' ? a.phase : 0;
    const minT = (p.min / 100) * spacing, maxT = (p.max / 100) * spacing;

    ctx.fillStyle = css(p.color);
    ctx.beginPath();
    const lines = Math.ceil(diag / spacing / 2) + 1;
    for (let li = -lines; li <= lines; li++) {
      const off = li * spacing;
      const upper: number[] = [], lower: number[] = [];
      const flush = () => {
        if (upper.length >= 4) {
          ctx.moveTo(upper[0], upper[1]);
          for (let i = 2; i < upper.length; i += 2) ctx.lineTo(upper[i], upper[i + 1]);
          for (let i = lower.length - 2; i >= 0; i -= 2) ctx.lineTo(lower[i], lower[i + 1]);
        }
        upper.length = lower.length = 0;
      };
      for (let t = -diag / 2; t <= diag / 2; t += step) {
        const wv = waveAmp ? Math.sin(t * waveFreq + li * 0.7 + phase) * waveAmp : 0;
        const x = cx + dir[0] * t + nor[0] * (off + wv), y = cy + dir[1] * t + nor[1] * (off + wv);
        if (x < -spacing || x > w + spacing || y < -spacing || y > h + spacing) {
          flush();
          continue;
        }
        const thick = Math.min(spacing * 1.2, (minT + (maxT - minT) * darkness(x, y)) * breathe);
        if (thick < 0.25) {
          flush();
          continue;
        }
        upper.push(x + nor[0] * thick / 2, y + nor[1] * thick / 2);
        lower.push(x - nor[0] * thick / 2, y - nor[1] * thick / 2);
      }
      flush();
    }
    ctx.fill();
  },
};
