import { css, hsvToRgb, parseHex, rgbToHsv, toHex, type RGBA } from '../core/color';
import { drag, h, icons } from './dom';

let eyedropper: (() => Promise<RGBA | null>) | null = null;

/** Viewport registruje funkciju koja čeka klik na sliku i vraća boju. */
export function setEyedropper(fn: () => Promise<RGBA | null>) {
  eyedropper = fn;
}

let current: { el: HTMLElement; close: () => void } | null = null;

export function closeColorPicker() {
  current?.close();
}

/** Figma-stil color picker kao popover pored elementa. */
export function openColorPicker(anchor: HTMLElement, initial: RGBA, onChange: (c: RGBA) => void) {
  closeColorPicker();

  let { h: hue, s, v } = rgbToHsv(initial);
  let alpha = initial.a;

  const svHandle = h('div', { class: 'cp-handle' });
  const sv = h('div', { class: 'cp-sv' }, svHandle);
  const hueHandle = h('div', { class: 'cp-slider-handle' });
  const hueBar = h('div', { class: 'cp-slider cp-hue' }, hueHandle);
  const alphaFill = h('div', { class: 'cp-alpha-fill' });
  const alphaHandle = h('div', { class: 'cp-slider-handle' });
  const alphaBar = h('div', { class: 'cp-slider cp-alpha' }, alphaFill, alphaHandle);
  const preview = h('div', { class: 'cp-preview' });
  const hexInput = h('input', { class: 'cp-hex', spellcheck: false, maxLength: 7 });
  const alphaInput = h('input', { class: 'cp-alpha-input', type: 'number', min: 0, max: 100 });

  const color = () => hsvToRgb(hue, s, v, alpha);

  const sync = (fromInput = false) => {
    const c = color();
    sv.style.background = `hsl(${hue}, 100%, 50%)`;
    svHandle.style.left = `${s * 100}%`;
    svHandle.style.top = `${(1 - v) * 100}%`;
    hueHandle.style.left = `${(hue / 360) * 100}%`;
    alphaHandle.style.left = `${alpha * 100}%`;
    alphaFill.style.background = `linear-gradient(to right, transparent, ${css({ ...c, a: 1 })})`;
    preview.style.setProperty('--c', css(c));
    if (!fromInput) {
      hexInput.value = toHex(c);
      alphaInput.value = String(Math.round(alpha * 100));
    }
  };

  const emit = (fromInput = false) => {
    sync(fromInput);
    onChange(color());
  };

  const pointerOn = (el: HTMLElement, fn: (x: number, y: number) => void) => {
    el.addEventListener('pointerdown', (e) => {
      const apply = (ev: PointerEvent) => {
        const r = el.getBoundingClientRect();
        fn(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)));
        emit();
      };
      apply(e);
      drag(e, apply);
    });
  };
  pointerOn(sv, (x, y) => {
    s = x;
    v = 1 - y;
  });
  pointerOn(hueBar, (x) => (hue = x * 359.9));
  pointerOn(alphaBar, (x) => (alpha = x));

  hexInput.addEventListener('input', () => {
    const c = parseHex(hexInput.value);
    if (!c || hexInput.value.replace('#', '').length < 6) return;
    ({ h: hue, s, v } = rgbToHsv(c));
    emit(true);
  });
  hexInput.addEventListener('blur', () => sync());
  alphaInput.addEventListener('input', () => {
    const n = Number(alphaInput.value);
    if (Number.isNaN(n)) return;
    alpha = Math.min(100, Math.max(0, n)) / 100;
    emit(true);
  });

  const pickBtn = h('button', {
    class: 'icon-btn',
    title: 'Pick color from image',
    html: icons.dropper,
    onclick: async () => {
      if (!eyedropper) return;
      el.classList.add('picking');
      const c = await eyedropper();
      el.classList.remove('picking');
      if (!c) return;
      ({ h: hue, s, v } = rgbToHsv(c));
      emit();
    },
  });

  const el = h(
    'div',
    { class: 'popover color-picker' },
    sv,
    h('div', { class: 'cp-row' }, pickBtn, h('div', { class: 'cp-sliders' }, hueBar, alphaBar), preview),
    h('div', { class: 'cp-row cp-inputs' }, h('span', { class: 'cp-label' }, 'Hex'), hexInput, alphaInput, h('span', { class: 'cp-label' }, '%')),
  );
  document.body.append(el);
  sync();

  // Pozicija: lijevo od kontrole ako ima mjesta, inače desno; uvijek unutar prozora.
  const r = anchor.getBoundingClientRect();
  const pw = el.offsetWidth, ph = el.offsetHeight;
  let left = r.left - pw - 12;
  if (left < 8) left = Math.min(window.innerWidth - pw - 8, r.right + 12);
  const top = Math.max(8, Math.min(window.innerHeight - ph - 8, r.top - 20));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;

  const onDown = (e: PointerEvent) => {
    const t = e.target as Node;
    if (el.contains(t) || anchor.contains(t) || el.classList.contains('picking')) return;
    close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !el.classList.contains('picking')) close();
  };
  const close = () => {
    el.remove();
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey);
    if (current?.el === el) current = null;
  };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey);
  current = { el, close };
}

/** Dugme sa bojom (checkerboard ispod za providnost) koje otvara picker. */
export function colorSwatch(get: () => RGBA, onChange: (c: RGBA) => void): HTMLButtonElement {
  const btn = h('button', { class: 'swatch' });
  const paint = () => btn.style.setProperty('--c', css(get()));
  btn.addEventListener('click', () =>
    openColorPicker(btn, get(), (c) => {
      onChange(c);
      paint();
    }),
  );
  paint();
  return btn;
}
