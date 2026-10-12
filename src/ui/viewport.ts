import type { RGBA } from '../core/color';
import { pointer, type Renderer } from '../core/renderer';
import { setEyedropper } from './colorPicker';
import { h, icons } from './dom';

export interface Point {
  x: number;
  y: number;
}

/** Alat koji prima događaje pokazivača u koordinatama platna. down vraća false ako klik ne koristi (onda je pan). */
export interface ToolHandler {
  down(e: PointerEvent, p: Point): boolean;
  move(e: PointerEvent, p: Point): void;
  up(e: PointerEvent, p: Point): void;
  hover(p: Point | null): void;
}

/** Srednji dio: canvas sa zoomom (točkić) i panom (alat Ruka, Space ili srednje dugme). */
export class Viewport {
  readonly el: HTMLElement;
  readonly stage: HTMLElement;
  zoom = 1;
  x = 0;
  y = 0;
  tool: ToolHandler | null = null;
  /** Plutajuća traka na dnu (transport + zoom). */
  readonly bar: HTMLElement;
  private viewListeners = new Set<() => void>();
  private zoomLabel = h('span', { class: 'zoom-label' }, '100%');
  private empty: HTMLElement;
  private picking: ((c: RGBA | null) => void) | null = null;
  private space = false;
  private insets: () => { left: number; right: number } = () => ({ left: 0, right: 0 });
  /** Before/After: original lijevo od linije, efekat desno. */
  private compare = false;
  private split = 0.5;
  private compareLine: HTMLElement;
  /** Poziva se kad se kursor pomjeri nad platnom (za interakciju mišem). */
  onPointer: () => void = () => {};

  constructor(private renderer: Renderer, onFile: () => void) {
    const canvas = renderer.out;
    canvas.className = 'view-canvas';
    this.empty = h(
      'div',
      { class: 'empty-state' },
      h(
        'div',
        { class: 'empty-card' },
        h('div', { class: 'empty-icon', html: icons.image }),
        h('h2', {}, 'Add an image or video'),
        h('p', {}, 'Drop it here or choose a file from your computer.'),
        h('button', { class: 'btn btn-primary', onclick: onFile }, 'Choose file'),
        h('span', { class: 'empty-hint' }, 'PNG, JPG, WEBP, MP4, WebM, MOV'),
      ),
    );
    const before = renderer.sourceCanvas;
    before.className = 'view-canvas compare-canvas';
    before.hidden = true;
    const handle = h('div', { class: 'compare-handle', title: 'Drag to compare' });
    this.compareLine = h('div', { class: 'compare-line', hidden: true }, h('span', { class: 'compare-tag left' }, 'Before'), h('span', { class: 'compare-tag right' }, 'After'), handle);
    handle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        this.split = Math.min(1, Math.max(0, this.toCanvas(ev.clientX, ev.clientY).x / this.renderer.width));
        this.apply();
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
    this.stage = h('div', { class: 'stage' }, canvas, before, this.compareLine, this.empty);

    this.bar = h(
      'div',
      { class: 'zoom-bar' },
      h('button', { class: 'icon-btn', title: 'Zoom out', html: icons.minus, onclick: () => this.zoomBy(1 / 1.25) }),
      this.zoomLabel,
      h('button', { class: 'icon-btn', title: 'Zoom in', html: icons.plus, onclick: () => this.zoomBy(1.25) }),
      h('span', { class: 'bar-sep' }),
      h('button', { class: 'icon-btn', title: 'Fit to window', html: icons.fit, onclick: () => this.fit() }),
    );
    this.el = h('div', { class: 'viewport' }, this.stage, this.bar);

    this.stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = this.stage.getBoundingClientRect();
      this.zoomAt(Math.pow(1.0015, -e.deltaY), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !isTyping(e)) {
        e.preventDefault();
        this.space = true;
        this.stage.classList.add('grab');
      }
      if (e.key === 'Escape' && this.picking) this.endPick(null);
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.space = false;
        this.stage.classList.remove('grab');
      }
    });

    this.stage.addEventListener('pointerdown', (e) => this.onDown(e));
    this.stage.addEventListener('pointermove', (e) => {
      const p = this.toCanvas(e.clientX, e.clientY);
      if (!this.stage.hasPointerCapture(e.pointerId)) this.tool?.hover(p);
      const inside = p.x >= 0 && p.y >= 0 && p.x <= this.renderer.width && p.y <= this.renderer.height;
      pointer.pos = inside ? { x: p.x / this.renderer.width, y: p.y / this.renderer.height } : null;
      this.onPointer();
    });
    this.stage.addEventListener('pointerleave', () => {
      this.tool?.hover(null);
      pointer.pos = null;
      this.onPointer();
    });

    new ResizeObserver(() => this.apply()).observe(this.stage);

    setEyedropper(
      () =>
        new Promise((resolve) => {
          this.picking = resolve;
          this.stage.classList.add('picking');
        }),
    );
  }

  private onDown(e: PointerEvent) {
    // Dugmad preko platna (prazno stanje, alati) moraju dobiti svoj klik; pan bi im ga oteo.
    if ((e.target as Element).closest('.tool-bar, .empty-state, .compare-handle') || this.renderer.out.hidden) return;
    const p = this.toCanvas(e.clientX, e.clientY);
    if (this.picking && e.button === 0 && !this.space) {
      this.endPick(this.renderer.pick(p.x, p.y));
      return;
    }
    if (e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    this.stage.setPointerCapture(e.pointerId);

    let move: (ev: PointerEvent) => void;
    let finish: (ev: PointerEvent) => void = () => {};
    if (e.button === 0 && !this.space && this.tool?.down(e, p)) {
      const tool = this.tool;
      move = (ev) => tool.move(ev, this.toCanvas(ev.clientX, ev.clientY));
      finish = (ev) => tool.up(ev, this.toCanvas(ev.clientX, ev.clientY));
    } else {
      const sx = e.clientX - this.x, sy = e.clientY - this.y;
      this.stage.classList.add('panning');
      move = (ev) => {
        this.x = ev.clientX - sx;
        this.y = ev.clientY - sy;
        this.apply();
      };
      finish = () => this.stage.classList.remove('panning');
    }
    const up = (ev: PointerEvent) => {
      finish(ev);
      this.stage.removeEventListener('pointermove', move);
      this.stage.removeEventListener('pointerup', up);
      this.stage.removeEventListener('pointercancel', up);
    };
    this.stage.addEventListener('pointermove', move);
    this.stage.addEventListener('pointerup', up);
    this.stage.addEventListener('pointercancel', up);
  }

  private endPick(c: RGBA | null) {
    this.picking?.(c);
    this.picking = null;
    this.stage.classList.remove('picking');
  }

  onView(fn: () => void) {
    this.viewListeners.add(fn);
  }

  setHasImage(has: boolean) {
    this.empty.hidden = has;
    this.renderer.out.hidden = !has;
    this.apply();
  }

  get comparing() {
    return this.compare;
  }

  setCompare(on: boolean) {
    this.compare = on;
    this.apply();
  }

  /** Klijentske koordinate u piksele platna. */
  toCanvas(cx: number, cy: number): Point {
    const r = this.stage.getBoundingClientRect();
    return { x: (cx - r.left - this.x) / this.zoom, y: (cy - r.top - this.y) / this.zoom };
  }

  /** Pikseli platna u koordinate unutar stage elementa. */
  toScreen(x: number, y: number): Point {
    return { x: this.x + x * this.zoom, y: this.y + y * this.zoom };
  }

  /** Paneli lebde preko platna, pa "uklopi" računa samo slobodan prostor između njih. */
  setInsets(fn: () => { left: number; right: number }) {
    this.insets = fn;
  }

  fit() {
    const { width: sw, height: sh } = this.stage.getBoundingClientRect();
    const cw = this.renderer.width, ch = this.renderer.height;
    if (!sw || !sh) return;
    const { left, right } = this.insets();
    const aw = sw - left - right;
    // Gore je traka alata, dole transport: slika ide u prostor između njih.
    const top = 130, bottom = 100;
    this.zoom = Math.min((aw - 64) / cw, (sh - top - bottom) / ch, 1);
    this.x = left + (aw - cw * this.zoom) / 2;
    this.y = top + (sh - top - bottom - ch * this.zoom) / 2;
    this.apply();
  }

  private zoomBy(f: number) {
    const r = this.stage.getBoundingClientRect();
    this.zoomAt(f, r.width / 2, r.height / 2);
  }

  private zoomAt(f: number, px: number, py: number) {
    const z = Math.min(16, Math.max(0.05, this.zoom * f));
    f = z / this.zoom;
    this.x = px - (px - this.x) * f;
    this.y = py - (py - this.y) * f;
    this.zoom = z;
    this.apply();
  }

  private apply() {
    const c = this.renderer.out;
    c.style.transform = `translate(${this.x}px, ${this.y}px) scale(${this.zoom})`;
    c.style.imageRendering = this.zoom >= 2 ? 'pixelated' : 'auto';

    const before = this.renderer.sourceCanvas;
    const show = this.compare && !c.hidden;
    before.hidden = this.compareLine.hidden = !show;
    if (show) {
      before.style.transform = c.style.transform;
      before.style.imageRendering = c.style.imageRendering;
      before.style.clipPath = `inset(0 ${(1 - this.split) * 100}% 0 0)`;
      const tl = this.toScreen(this.split * c.width, 0);
      Object.assign(this.compareLine.style, { left: `${tl.x}px`, top: `${tl.y}px`, height: `${c.height * this.zoom}px` });
    }
    this.zoomLabel.textContent = `${Math.round(this.zoom * 100)}%`;
    for (const fn of this.viewListeners) fn();
  }
}

export function isTyping(e: Event) {
  const t = e.target as HTMLElement;
  if (t instanceof HTMLInputElement) return !['range', 'checkbox', 'button'].includes(t.type);
  return t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable;
}
