/**
 * Maska sloja. Zone i potezi su u koordinatama slike (0-1 po širini i visini originala),
 * pa ostaju na istom dijelu slike i kad se promijeni format platna.
 */
export interface Zone {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Stroke {
  mode: 'add' | 'erase';
  /** Radijus kao udio širine slike. */
  r: number;
  /** Mekoća 0-1. */
  soft: number;
  /** Ravna lista [x0, y0, x1, y1, ...] u koordinatama slike. */
  points: number[];
}

export type MaskArea = 'full' | 'zones' | 'brush';

export interface Mask {
  /** Osnova: cijela slika, zone ili ništa (samo ono što četkica doda). */
  area: MaskArea;
  zones: Zone[];
  /** Presjek sa pragom svjetline. */
  threshold: { on: boolean; value: number; invert: boolean };
  brush: { size: number; softness: number };
  /** Četkica dodaje preko osnove, gumica briše; kasniji potez pobjeđuje. */
  strokes: Stroke[];
  /** Povećava se na svaku promjenu, za keš. */
  rev: number;
}

export const defaultMask = (): Mask => ({
  area: 'full',
  zones: [],
  threshold: { on: false, value: 50, invert: false },
  brush: { size: 80, softness: 50 },
  strokes: [],
  rev: 0,
});

export const isTrivialMask = (m: Mask) => m.area === 'full' && !m.threshold.on && m.strokes.length === 0;

/** Gdje je slika na platnu: canvas = o + norm * d. */
export interface ImageMap {
  ox: number;
  oy: number;
  dw: number;
  dh: number;
}

export const zoneToCanvas = (z: Zone, m: ImageMap) => ({ x: m.ox + z.x * m.dw, y: m.oy + z.y * m.dh, w: z.w * m.dw, h: z.h * m.dh });

function stamp(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, soft: number) {
  if (soft > 0.01) {
    const g = ctx.createRadialGradient(x, y, r * (1 - soft), x, y, r);
    g.addColorStop(0, '#fff');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = '#fff';
  }
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

const make = () => {
  const c = document.createElement('canvas');
  return { c, ctx: c.getContext('2d')! };
};

/** Rasterizovana maska jednog sloja. Potezi se dodaju postepeno, bez ponovnog crtanja svega. */
export class MaskRaster {
  readonly out = make();
  private add = make();
  private erase = make();
  private geomKey = '';
  private doneStrokes = 0;
  private donePoints = 0;
  private seen = 0;
  private first: Stroke | undefined;
  key = '';

  build(m: Mask, map: ImageMap, w: number, h: number, threshold: () => HTMLCanvasElement) {
    const geomKey = `${w}x${h}|${map.ox},${map.oy},${map.dw},${map.dh}`;
    if (geomKey !== this.geomKey || m.strokes.length < this.seen || (this.seen > 0 && m.strokes[0] !== this.first)) {
      for (const l of [this.out, this.add, this.erase]) {
        l.c.width = w;
        l.c.height = h;
      }
      this.geomKey = geomKey;
      this.doneStrokes = 0;
      this.donePoints = 0;
      this.seen = 0;
    }
    this.rasterStrokes(m.strokes, map);

    const { ctx } = this.out;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    if (m.area === 'full') ctx.fillRect(0, 0, w, h);
    else if (m.area === 'zones') {
      for (const z of m.zones) {
        const r = zoneToCanvas(z, map);
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }
    }
    if (m.threshold.on) {
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(threshold(), 0, 0);
    }
    if (m.strokes.length) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(this.add.c, 0, 0);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(this.erase.c, 0, 0);
    }
    ctx.globalCompositeOperation = 'source-over';
    return this.out.c;
  }

  private rasterStrokes(strokes: Stroke[], map: ImageMap) {
    for (let i = this.doneStrokes; i < strokes.length; i++) {
      const s = strokes[i];
      const r = Math.max(0.5, s.r * map.dw);
      // Dodavanje crta u "add" i briše iz "erase" (i obrnuto), pa kasniji potez uvijek pobjeđuje.
      const [paint, clear] = s.mode === 'add' ? [this.add.ctx, this.erase.ctx] : [this.erase.ctx, this.add.ctx];
      paint.globalCompositeOperation = 'source-over';
      clear.globalCompositeOperation = 'destination-out';
      const step = Math.max(1, r * 0.15);
      const start = i === this.doneStrokes ? this.donePoints : 0;
      const n = s.points.length / 2;
      for (let k = start; k < n; k++) {
        const x = map.ox + s.points[k * 2] * map.dw, y = map.oy + s.points[k * 2 + 1] * map.dh;
        if (k === 0) {
          stamp(paint, x, y, r, s.soft);
          stamp(clear, x, y, r, s.soft);
          continue;
        }
        const px = map.ox + s.points[k * 2 - 2] * map.dw, py = map.oy + s.points[k * 2 - 1] * map.dh;
        const dist = Math.hypot(x - px, y - py);
        const count = Math.max(1, Math.ceil(dist / step));
        for (let j = 1; j <= count; j++) {
          const t = j / count;
          stamp(paint, px + (x - px) * t, py + (y - py) * t, r, s.soft);
          stamp(clear, px + (x - px) * t, py + (y - py) * t, r, s.soft);
        }
      }
      clear.globalCompositeOperation = 'source-over';
    }
    this.seen = strokes.length;
    this.first = strokes[0];
    if (strokes.length) {
      this.doneStrokes = strokes.length - 1;
      this.donePoints = strokes[strokes.length - 1].points.length / 2;
    }
  }
}

/** Alfa kanal: 1 gdje je svjetlina iznad praga (ili ispod, ako je invert), sa mekim prelazom. */
export function thresholdCanvas(source: ImageData, value: number, invert: boolean): HTMLCanvasElement {
  const { width: w, height: h, data } = source;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const out = ctx.createImageData(w, h);
  const t = value / 100, soft = 0.03;
  for (let i = 0; i < w * h; i++) {
    const l = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255;
    let a = Math.min(1, Math.max(0, (l - (t - soft)) / (2 * soft)));
    if (invert) a = 1 - a;
    out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = 255;
    out.data[i * 4 + 3] = a * 255;
  }
  ctx.putImageData(out, 0, 0);
  return c;
}
