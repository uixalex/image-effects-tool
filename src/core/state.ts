import type { Params } from './types';
import { defaultParams } from './types';
import { getEffect } from './registry';
import { defaultMask, type Mask } from './mask';
import type { LayerMotion, Timing } from './motion';

export type BlendMode = GlobalCompositeOperation;

export const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: 'source-over', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'color-dodge', label: 'Color Dodge' },
  { value: 'color-burn', label: 'Color Burn' },
  { value: 'hard-light', label: 'Hard Light' },
  { value: 'soft-light', label: 'Soft Light' },
  { value: 'difference', label: 'Difference' },
  { value: 'exclusion', label: 'Exclusion' },
  { value: 'hue', label: 'Hue' },
  { value: 'saturation', label: 'Saturation' },
  { value: 'color', label: 'Color' },
  { value: 'luminosity', label: 'Luminosity' },
];

export type FormatId = 'original' | '1:1' | '4:5' | '16:9' | '9:16';

export const FORMATS: { value: FormatId; label: string; ratio: number | null }[] = [
  { value: 'original', label: 'Original', ratio: null },
  { value: '1:1', label: '1:1', ratio: 1 },
  { value: '4:5', label: '4:5', ratio: 4 / 5 },
  { value: '16:9', label: '16:9', ratio: 16 / 9 },
  { value: '9:16', label: '9:16', ratio: 9 / 16 },
];

export interface Layer {
  id: string;
  effectId: string;
  name: string;
  visible: boolean;
  opacity: number; // 0-1
  blend: BlendMode;
  params: Params;
  mask: Mask;
  motion: LayerMotion;
  interact: LayerInteract;
  /** Šta efekat obrađuje: rezultat slojeva ispod (lanac efekata) ili originalnu sliku. */
  input: 'below' | 'original';
}

/** Reakcija sloja na kursor: vidi se samo oko kursora (reveal) ili se oko njega gubi (hide). */
export interface LayerInteract {
  mode: 'off' | 'reveal' | 'hide';
  radius: number;
  softness: number;
}

export const defaultInteract = (): LayerInteract => ({ mode: 'off', radius: 160, softness: 60 });

export type Media = HTMLImageElement | HTMLVideoElement;

export const isVideo = (m: Media | null): m is HTMLVideoElement => m instanceof HTMLVideoElement;

export function mediaSize(m: Media) {
  return isVideo(m) ? { w: m.videoWidth, h: m.videoHeight } : { w: m.naturalWidth, h: m.naturalHeight };
}

export type Tool = 'hand' | 'zone' | 'brush' | 'eraser';

export interface DocState {
  media: Media | null;
  mediaName: string;
  timing: Timing;
  format: FormatId;
  showOriginal: boolean;
  /** Indeks 0 je najniži sloj. */
  layers: Layer[];
  activeId: string | null;
}

/**
 * layers: lista, vidljivost, redoslijed, imena
 * active: promjena aktivnog sloja
 * params: parametri, opacity ili blend sloja
 * source: slika ili format platna
 * mask: maska nekog sloja
 * tool: izabrani alat ili izabrana zona
 * anim: play/pause ili tajming animacije
 */
export type Topic = 'layers' | 'active' | 'params' | 'source' | 'mask' | 'tool' | 'anim';

type Listener = (topic: Topic) => void;

let nextId = 1;

class Store {
  state: DocState = {
    media: null,
    mediaName: '',
    timing: { mode: 'loop', duration: 4 },
    format: 'original',
    showOriginal: true,
    layers: [],
    activeId: null,
  };

  tool: Tool = 'hand';
  /** Izabrana zona aktivnog sloja (alat Zona). */
  selectedZone: string | null = null;
  playing = false;

  private listeners = new Set<Listener>();

  on(fn: Listener) {
    this.listeners.add(fn);
  }

  emit(topic: Topic) {
    for (const fn of this.listeners) fn(topic);
  }

  get active(): Layer | null {
    return this.state.layers.find((l) => l.id === this.state.activeId) ?? null;
  }

  addLayer(effectId: string) {
    const effect = getEffect(effectId);
    const count = this.state.layers.filter((l) => l.effectId === effectId).length;
    const layer: Layer = {
      id: `l${nextId++}`,
      effectId,
      name: count ? `${effect.name} ${count + 1}` : effect.name,
      visible: true,
      opacity: 1,
      blend: 'source-over',
      params: defaultParams(effect),
      mask: defaultMask(),
      motion: { on: false, type: effect.motion?.types[0]?.value ?? '', speed: 1, intensity: 50, audio: 'off' },
      interact: defaultInteract(),
      input: 'below',
    };
    this.state.layers.push(layer);
    this.state.activeId = layer.id;
    this.emit('layers');
    this.emit('active');
  }

  removeLayer(id: string) {
    const i = this.state.layers.findIndex((l) => l.id === id);
    if (i < 0) return;
    this.state.layers.splice(i, 1);
    if (this.state.activeId === id) {
      const next = this.state.layers[Math.min(i, this.state.layers.length - 1)];
      this.state.activeId = next?.id ?? null;
      this.emit('active');
    }
    this.emit('layers');
  }

  /** Pomjera sloj na novi indeks (0 = najniži). */
  moveLayer(id: string, toIndex: number) {
    const layers = this.state.layers;
    const from = layers.findIndex((l) => l.id === id);
    if (from < 0) return;
    const [layer] = layers.splice(from, 1);
    layers.splice(Math.max(0, Math.min(layers.length, toIndex)), 0, layer);
    this.emit('layers');
  }

  setActive(id: string | null) {
    if (this.state.activeId === id) return;
    this.state.activeId = id;
    this.selectedZone = null;
    this.emit('active');
    this.emit('layers');
  }

  updateLayer(id: string, patch: Partial<Layer>, topic: Topic = 'params') {
    const layer = this.state.layers.find((l) => l.id === id);
    if (!layer) return;
    Object.assign(layer, patch);
    this.emit(topic);
  }

  /** Učitava sačuvani dokument (projekat). Popunjava polja koja starije verzije nisu imale. */
  loadDoc(doc: Pick<DocState, 'layers' | 'activeId' | 'format' | 'showOriginal' | 'timing'>) {
    for (const l of doc.layers) {
      const effect = getEffect(l.effectId);
      l.params = { ...defaultParams(effect), ...l.params };
      l.mask = { ...defaultMask(), ...l.mask };
      const motion: LayerMotion = { on: false, type: effect.motion?.types[0]?.value ?? '', speed: 1, intensity: 50, audio: 'off' };
      l.motion = Object.assign(motion, l.motion);
      l.interact = { ...defaultInteract(), ...l.interact };
      // Projekti sačuvani prije lanca efekata su svaki sloj računali iz originala.
      l.input ??= 'original';
      nextId = Math.max(nextId, Number(l.id.replace(/D/g, '')) + 1 || nextId);
    }
    Object.assign(this.state, doc);
    this.selectedZone = null;
    this.emit('source');
    this.emit('layers');
    this.emit('active');
    this.emit('mask');
    this.emit('anim');
  }

  setPlaying(on: boolean) {
    if (this.playing === on) return;
    this.playing = on;
    this.emit('anim');
  }

  setTool(tool: Tool) {
    if (this.tool === tool) return;
    this.tool = tool;
    this.emit('tool');
  }

  selectZone(id: string | null) {
    this.selectedZone = id;
    this.emit('tool');
  }

  /** Poziva se nakon svake izmjene layer.mask. */
  touchMask(layer: Layer) {
    layer.mask.rev++;
    this.emit('mask');
  }

  setParam(id: string, key: string, value: unknown) {
    const layer = this.state.layers.find((l) => l.id === id);
    if (!layer) return;
    layer.params[key] = value;
    this.emit('params');
  }
}

export const store = new Store();
