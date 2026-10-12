import { isTrivialMask, MaskRaster, thresholdCanvas, zoneToCanvas, type ImageMap } from './mask';
import { audioLevel } from './audio';
import { makeAnim } from './motion';
import { getEffect } from './registry';
import { FORMATS, isVideo, mediaSize, type DocState, type FormatId, type Layer, type Media } from './state';
import type { Params, RenderInput } from './types';

/** Pozicija kursora nad platnom (0-1), ili null kad je van njega. Dijele je preview i izvoz. */
export const pointer: { pos: { x: number; y: number } | null } = { pos: null };

/** Najduža stranica previewa. Export bira svoju rezoluciju. */
export const MAX_SIDE = 2048;
/** Video je težak za preview u realnom vremenu, pa ga prikazujemo manjeg. */
export const MAX_SIDE_VIDEO = 1280;

function canvas2d(w = 1, h = 1, readback = false) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: readback })!;
  return { c, ctx };
}

/** Dimenzije platna za format; long je duža stranica. Parne vrijednosti (potrebno za video kodeke). */
export function outputSize(media: Media, format: FormatId, long: number): { w: number; h: number } {
  const { w: iw, h: ih } = mediaSize(media);
  const ratio = FORMATS.find((f) => f.value === format)!.ratio ?? iw / ih;
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  return ratio >= 1 ? { w: even(long), h: even(long / ratio) } : { w: even(long * ratio), h: even(long) };
}

export function previewLongSide(media: Media) {
  const { w, h } = mediaSize(media);
  return Math.min(isVideo(media) ? MAX_SIDE_VIDEO : MAX_SIDE, Math.max(w, h));
}

/** Slika iz koje efekat čita: original, ili kompozit slojeva ispod. Umanjene verzije (sample) se keširaju uz nju. */
class SourceImage {
  readonly c: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** Šta je trenutno u canvasu (za keš). */
  key = '';
  private samples = new Map<string, ImageData>();

  constructor() {
    const { c, ctx } = canvas2d(1, 1, true);
    this.c = c;
    this.ctx = ctx;
  }

  reset(key: string) {
    this.key = key;
    this.samples.clear();
  }

  sample = (cols: number, rows: number): ImageData => {
    cols = Math.max(1, Math.round(cols));
    rows = Math.max(1, Math.round(rows));
    const key = `${cols}x${rows}`;
    let data = this.samples.get(key);
    if (!data) {
      // Umanjivanje u koracima daje pravi prosjek ćelije umjesto preskakanja piksela.
      let src: HTMLCanvasElement = this.c;
      let w = src.width, h = src.height;
      while (w / 2 > cols && h / 2 > rows) {
        w = Math.max(cols, Math.round(w / 2));
        h = Math.max(rows, Math.round(h / 2));
        const step = canvas2d(w, h);
        step.ctx.drawImage(src, 0, 0, w, h);
        src = step.c;
      }
      const { ctx } = canvas2d(cols, rows, true);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0, cols, rows);
      data = ctx.getImageData(0, 0, cols, rows);
      this.samples.set(key, data);
    }
    return data;
  };
}

/** Kratak hash dugog ključa keša. */
function hash(str: string) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 33) ^ str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

interface LayerCache {
  /** Kompozit slojeva ispod, kad sloj uzima njih kao ulaz. */
  input?: SourceImage;
  canvas: HTMLCanvasElement;
  key: string;
  mask: MaskRaster;
  /** Efekat isječen maskom. */
  masked: HTMLCanvasElement;
  maskedKey: string;
  /** Rezultat nakon interakcije s kursorom. */
  interacted: HTMLCanvasElement;
}

export class Renderer {
  /** Kompozit svih slojeva; ovo se prikazuje i izvozi. */
  readonly out: HTMLCanvasElement;
  private outCtx: CanvasRenderingContext2D;
  private source = new SourceImage();
  private sourceVersion = 0;
  private cache = new Map<string, LayerCache>();
  private fontVersion = 0;
  private thresholds = new Map<string, HTMLCanvasElement>();
  private sourceData: ImageData | null = null;
  private media: Media | null = null;
  /** Gdje je originalna slika na platnu (za maske u koordinatama slike). */
  map: ImageMap = { ox: 0, oy: 0, dw: 1, dh: 1 };

  constructor() {
    const { c, ctx } = canvas2d(1, 1, true);
    this.out = c;
    this.outCtx = ctx;
  }

  get width() {
    return this.out.width;
  }
  get height() {
    return this.out.height;
  }
  get sourceCanvas() {
    return this.source.c;
  }

  /** Postavlja izvor (slika ili video) u traženom formatu; long je duža stranica platna. */
  setSource(media: Media | null, format: FormatId, long?: number) {
    this.media = media;
    if (!media) {
      this.out.width = this.out.height = 1;
      this.invalidateSource();
      return;
    }
    const { w, h } = outputSize(media, format, long ?? previewLongSide(media));
    this.source.c.width = this.out.width = w;
    this.source.c.height = this.out.height = h;
    const { w: iw, h: ih } = mediaSize(media);
    const scale = Math.max(w / iw, h / ih);
    const dw = iw * scale, dh = ih * scale;
    this.map = { ox: (w - dw) / 2, oy: (h - dh) / 2, dw, dh };
    this.drawFrame();
  }

  /** Ponovo crta trenutni frame izvora (za video, svaki frame). */
  drawFrame() {
    if (!this.media) return;
    const { ctx, c } = this.source;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.media, this.map.ox, this.map.oy, this.map.dw, this.map.dh);
    this.invalidateSource();
  }

  private invalidateSource() {
    this.source.reset('');
    this.thresholds.clear();
    this.sourceData = null;
    this.sourceVersion++;
  }

  private threshold(value: number, invert: boolean) {
    const key = `${value}|${invert}`;
    let c = this.thresholds.get(key);
    if (!c) {
      this.sourceData ??= this.source.ctx.getImageData(0, 0, this.source.c.width, this.source.c.height);
      c = thresholdCanvas(this.sourceData, value, invert);
      // Dok se vuče slajder nastaje mnogo pragova; čuvamo samo zadnjih nekoliko.
      if (this.thresholds.size > 6) this.thresholds.delete(this.thresholds.keys().next().value!);
      this.thresholds.set(key, c);
    }
    return c;
  }

  /** Fontovi su se učitali: sve što crta tekst treba ponovo. */
  invalidateAll() {
    this.fontVersion++;
  }

  /** Ulaz za efekat sloja u trenutku time, sa parametrima izmijenjenim animacijom. */
  layerInput(doc: DocState, layer: Layer, time: number): { input: RenderInput; params: Params; animKey: string } {
    const src = layer.input === 'below' && this.cache.get(layer.id)?.input?.key ? this.cache.get(layer.id)!.input! : this.source;
    const { width: w, height: h } = this.out;
    const effect = getEffect(layer.effectId);
    const zones = doc.layers
      .filter((l) => l.visible && l.mask.area === 'zones')
      .flatMap((l) => l.mask.zones.map((z) => zoneToCanvas(z, this.map)));
    const anim = layer.motion.on && effect.motion ? makeAnim(layer.motion, doc.timing, time) : null;
    // Audio reakcija: intenzitet prati jačinu izabranog opsega u ovom trenutku.
    if (anim && layer.motion.audio !== 'off') anim.intensity = Math.min(1, anim.intensity * audioLevel(layer.motion.audio, time) * 1.6);
    const params = anim && effect.motion?.apply ? effect.motion.apply(layer.params, anim) : layer.params;
    const input: RenderInput = { width: w, height: h, unit: Math.max(w, h) / 1000, source: src.c, sample: src.sample, zones, anim };
    const animKey = anim ? `${JSON.stringify(layer.motion)}|${anim.phase.toFixed(4)}|${anim.step(30)}|${anim.intensity.toFixed(3)}` : '';
    return { input, params, animKey: effect.usesZones ? animKey + JSON.stringify(zones) : animKey };
  }

  render(doc: DocState, time = 0) {
    const ctx = this.outCtx;
    const { width: w, height: h } = this.out;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    if (!doc.media) return;

    if (doc.showOriginal) ctx.drawImage(this.source.c, 0, 0);
    const alive = new Set<string>();
    // Potpis svega što je do sada nacrtano; slojevi koji uzimaju "ispod" se ponovo crtaju samo kad se on promijeni.
    let stack = `${this.sourceVersion}|${doc.showOriginal}`;

    for (const layer of doc.layers) {
      alive.add(layer.id);
      if (!layer.visible || layer.opacity <= 0) continue;
      let srcKey = String(this.sourceVersion);
      if (layer.input === 'below') {
        const entry = this.entry(layer.id);
        const inp = (entry.input ??= new SourceImage());
        if (inp.key !== stack) {
          if (inp.c.width !== w || inp.c.height !== h) {
            inp.c.width = w;
            inp.c.height = h;
          }
          inp.ctx.globalCompositeOperation = 'copy';
          inp.ctx.drawImage(this.out, 0, 0);
          inp.ctx.globalCompositeOperation = 'source-over';
          inp.reset(stack);
        }
        srcKey = `below:${stack}`;
      }
      const { canvas, key } = this.layerCanvas(doc, layer, time, srcKey);
      const result = this.interact(layer, canvas);
      const it = layer.interact;
      stack = hash(`${stack}|${key}|${layer.opacity}|${layer.blend}|${layer.mask.rev}|${JSON.stringify(it)}|${it.mode !== 'off' ? JSON.stringify(pointer.pos) : ''}`);
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = layer.blend;
      ctx.drawImage(result, 0, 0);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    for (const id of this.cache.keys()) if (!alive.has(id)) this.cache.delete(id);
  }

  /** Efekat sloja (keširan) isječen maskom. */
  private layerCanvas(doc: DocState, layer: Layer, time: number, srcKey: string): { canvas: HTMLCanvasElement; key: string } {
    const { width: w, height: h } = this.out;
    const effect = getEffect(layer.effectId);
    const { input, params, animKey } = this.layerInput(doc, layer, time);
    const key = `${srcKey}|${this.fontVersion}|${w}x${h}|${layer.effectId}|${JSON.stringify(params)}|${animKey}`;
    const entry = this.entry(layer.id);
    if (entry.key !== key) {
      const lc = entry.canvas;
      lc.width = w;
      lc.height = h;
      const lctx = lc.getContext('2d')!;
      lctx.clearRect(0, 0, w, h);
      try {
        effect.render(input, params, lctx);
      } catch (err) {
        console.error(`Error in layer ${layer.name}`, err);
      }
      entry.key = key;
    }
    if (isTrivialMask(layer.mask)) return { canvas: entry.canvas, key };

    const maskKey = `${key}|${layer.mask.rev}`;
    if (entry.maskedKey !== maskKey) {
      const m = this.maskCanvas(layer)!;
      const mc = entry.masked;
      if (mc.width !== w || mc.height !== h) {
        mc.width = w;
        mc.height = h;
      }
      const mctx = mc.getContext('2d')!;
      mctx.globalCompositeOperation = 'copy';
      mctx.drawImage(entry.canvas, 0, 0);
      mctx.globalCompositeOperation = 'destination-in';
      mctx.drawImage(m, 0, 0);
      mctx.globalCompositeOperation = 'source-over';
      entry.maskedKey = maskKey;
    }
    return { canvas: entry.masked, key };
  }

  /** Reveal/hide oko kursora: meki krug preko već maskiranog sloja. */
  private interact(layer: Layer, src: HTMLCanvasElement) {
    const it = layer.interact;
    if (it.mode === 'off') return src;
    const { width: w, height: h } = this.out;
    const c = this.entry(layer.id).interacted;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = c.getContext('2d')!;
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(src, 0, 0);
    const pos = pointer.pos;
    ctx.globalCompositeOperation = it.mode === 'reveal' ? 'destination-in' : 'destination-out';
    if (pos) {
      const r = Math.max(1, it.radius * (Math.max(w, h) / 1000));
      const x = pos.x * w, y = pos.y * h;
      const g = ctx.createRadialGradient(x, y, r * (1 - it.softness / 100), x, y, r);
      g.addColorStop(0, '#fff');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    } else if (it.mode === 'reveal') {
      ctx.clearRect(0, 0, w, h);
    }
    ctx.globalCompositeOperation = 'source-over';
    return c;
  }

  private entry(id: string) {
    let entry = this.cache.get(id);
    if (!entry) {
      entry = { canvas: document.createElement('canvas'), key: '', mask: new MaskRaster(), masked: document.createElement('canvas'), maskedKey: '', interacted: document.createElement('canvas') };
      this.cache.set(id, entry);
    }
    return entry;
  }

  /** Raster maske sloja, ili null ako maska pokriva cijelo platno. */
  maskCanvas(layer: Layer): HTMLCanvasElement | null {
    if (isTrivialMask(layer.mask)) return null;
    const { width: w, height: h } = this.out;
    return this.entry(layer.id).mask.build(layer.mask, this.map, w, h, () => this.threshold(layer.mask.threshold.value, layer.mask.threshold.invert));
  }

  /** Nemaskirani raster efekta (za SVG export rasterskih slojeva). */
  effectCanvas(_doc: DocState, layer: Layer) {
    return this.entry(layer.id).canvas;
  }

  /** Boja piksela kompozita (za eyedropper). */
  pick(x: number, y: number) {
    const px = Math.max(0, Math.min(this.out.width - 1, Math.floor(x)));
    const py = Math.max(0, Math.min(this.out.height - 1, Math.floor(y)));
    const d = this.outCtx.getImageData(px, py, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: 1 };
  }
}
