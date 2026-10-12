import { css, hex } from '../core/color';
import { font, MONO_FONTS } from '../core/fonts';
import { hash2, rng } from '../core/random';
import type { EffectModule, Params } from '../core/types';

interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Okviri dolaze iz zona maski (ako je izabrano) ili se generišu iz seeda. */
function frames(p: Params, w: number, h: number): Frame[] {
  const random = rng(p.seed);
  const out: Frame[] = [];
  for (let i = 0; i < p.frames; i++) {
    const fw = (0.2 + random() * 0.3) * w, fh = (0.2 + random() * 0.3) * h;
    out.push({ x: Math.round(0.04 * w + random() * (0.92 * w - fw)), y: Math.round(0.04 * h + random() * (0.92 * h - fh)), w: Math.round(fw), h: Math.round(fh) });
  }
  return out;
}

const coord = (v: number) => Math.max(0, v).toFixed(1).padStart(4, '0');

export const hud: EffectModule = {
  id: 'hud',
  name: 'HUD',
  vector: true,
  motion: {
    types: [
      { value: 'coords', label: 'Updating coordinates' },
      { value: 'blink', label: 'Blinking labels' },
      { value: 'both', label: 'Both' },
    ],
  },
  usesZones: true,
  params: [
    { key: 'grid', label: 'Dot grid', type: 'boolean', default: true },
    { key: 'gridSpacing', label: 'Grid spacing', type: 'number', min: 8, max: 200, step: 1, default: 40, showIf: (p) => p.grid },
    { key: 'gridDot', label: 'Dot size', type: 'number', min: 0.5, max: 8, step: 0.5, default: 2, showIf: (p) => p.grid },
    { key: 'gridColor', label: 'Grid color', type: 'color', default: hex('#FFFFFF', 0.3), showIf: (p) => p.grid },
    {
      key: 'frameSource',
      label: 'Frames',
      type: 'select',
      options: [
        { value: 'random', label: 'Random' },
        { value: 'zones', label: 'Zones from layer masks' },
      ],
      default: 'random',
    },
    { key: 'frames', label: 'Frame count', type: 'number', min: 0, max: 12, step: 1, default: 3, showIf: (p) => p.frameSource === 'random' },
    { key: 'seed', label: 'Seed', type: 'number', min: 1, max: 999, step: 1, default: 2, showIf: (p) => p.frameSource === 'random' },
    { key: 'borders', label: 'Frame outlines', type: 'boolean', default: true },
    { key: 'lines', label: 'Dashed lines', type: 'boolean', default: true },
    { key: 'labels', label: 'Labels', type: 'boolean', default: true },
    { key: 'prefix', label: 'Label prefix', type: 'text', default: 'S', showIf: (p) => p.labels },
    { key: 'coords', label: 'Coordinates', type: 'boolean', default: true },
    { key: 'corner', label: 'Corner markers', type: 'number', min: 0, max: 20, step: 0.5, default: 5 },
    { key: 'font', label: 'Font', type: 'select', options: MONO_FONTS, default: 'JetBrains Mono' },
    { key: 'fontSize', label: 'Text size', type: 'number', min: 6, max: 40, step: 0.5, default: 14 },
    { key: 'lineColor', label: 'Line color', type: 'color', default: hex('#FFFFFF', 0.45) },
    { key: 'accent', label: 'Corner color', type: 'color', default: hex('#FF7AC2') },
    { key: 'textColor', label: 'Text color', type: 'color', default: hex('#FFFFFF') },
    { key: 'labelBg', label: 'Label background', type: 'color', default: hex('#0B0B0F', 0.85) },
  ],

  render(input, p, ctx) {
    const { width: w, height: h } = input;
    const u = input.unit;

    if (p.grid) {
      ctx.fillStyle = css(p.gridColor);
      const s = p.gridSpacing * u, d = p.gridDot * u;
      for (let y = s / 2; y < h; y += s) for (let x = s / 2; x < w; x += s) ctx.fillRect(x - d / 2, y - d / 2, d, d);
    }

    const list = p.frameSource === 'zones' ? input.zones : frames(p, w, h);
    ctx.lineWidth = Math.max(1, u);

    if (p.lines) {
      ctx.strokeStyle = css(p.lineColor);
      ctx.setLineDash([4 * u, 4 * u]);
      ctx.beginPath();
      for (const f of list) {
        ctx.moveTo(0, f.y + 0.5);
        ctx.lineTo(w, f.y + 0.5);
        ctx.moveTo(f.x + 0.5, 0);
        ctx.lineTo(f.x + 0.5, h);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (p.borders) {
      ctx.strokeStyle = css(p.lineColor);
      for (const f of list) ctx.strokeRect(f.x + 0.5, f.y + 0.5, f.w, f.h);
    }

    if (p.corner > 0) {
      const c = p.corner * u;
      ctx.fillStyle = css(p.accent);
      for (const f of list) {
        for (const [x, y] of [[f.x, f.y], [f.x + f.w, f.y], [f.x, f.y + f.h], [f.x + f.w, f.y + f.h]]) {
          ctx.fillRect(x - c / 2, y - c / 2, c, c);
        }
      }
    }

    const size = p.fontSize * u;
    ctx.font = font(p.font, size, 400);
    ctx.textBaseline = 'middle';
    const pad = size * 0.45, bh = size * 1.6;
    const tag = (text: string, x: number, y: number, outlined: boolean) => {
      const tw = ctx.measureText(text).width + pad * 2;
      const bx = Math.max(0, Math.min(w - tw, x)), by = Math.max(0, Math.min(h - bh, y));
      ctx.fillStyle = css(p.labelBg);
      ctx.fillRect(bx, by, tw, bh);
      if (outlined) {
        ctx.strokeStyle = css(p.lineColor);
        ctx.strokeRect(bx + 0.5, by + 0.5, tw - 1, bh - 1);
      }
      ctx.fillStyle = css(p.textColor);
      ctx.fillText(text, bx + pad, by + bh / 2);
    };

    const a = input.anim;
    const coordStep = a && a.type !== 'blink' ? a.step(10) : 0;
    const blinkStep = a && a.type !== 'coords' ? a.step(4) : -1;
    const jitter = (i: number, axis: number) => (coordStep ? (hash2(i, coordStep, axis) - 0.5) * 4 * a!.intensity : 0);
    list.forEach((f, i) => {
      if (blinkStep >= 0 && hash2(i, blinkStep, 9) < a!.intensity * 0.5) return;
      const gap = (p.corner * u) / 2 + 2 * u;
      if (p.labels) tag(`${p.prefix}${String(i + 1).padStart(2, '0')}`, f.x + gap, f.y - bh - gap, true);
      if (p.coords) tag(`${coord((f.x / w) * 20 + jitter(i, 1))},${coord((f.y / h) * 20 + jitter(i, 2))}`, f.x + gap, f.y + f.h - bh - gap, false);
    });
  },
};
