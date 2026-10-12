import { audio } from '../core/audio';
import { randomParams } from '../core/randomize';
import { getEffect } from '../core/registry';
import { BLEND_MODES, store, type Layer } from '../core/state';
import type { ParamDef } from '../core/types';
import { closeColorPicker, colorSwatch } from './colorPicker';
import { h, icons } from './dom';
import { gradientEditor } from './gradientEditor';
import { badge } from './layers';
import { maskSection } from './maskPanel';
import { isTyping } from './viewport';

export function numberControl(label: string, opts: { min: number; max: number; step: number; unit?: string }, get: () => number, set: (v: number) => void) {
  const range = h('input', { type: 'range', min: opts.min, max: opts.max, step: opts.step, value: get() });
  const num = h('input', { class: 'num-input', type: 'number', min: opts.min, max: opts.max, step: opts.step, value: get() });
  const paintRange = () => range.style.setProperty('--p', `${((Number(range.value) - opts.min) / (opts.max - opts.min)) * 100}%`);
  range.addEventListener('input', () => {
    num.value = range.value;
    paintRange();
    set(Number(range.value));
  });
  num.addEventListener('change', () => {
    const v = Math.min(opts.max, Math.max(opts.min, Number(num.value) || 0));
    num.value = range.value = String(v);
    paintRange();
    set(v);
  });
  paintRange();
  return h(
    'div',
    { class: 'ctrl' },
    h('div', { class: 'ctrl-head' }, h('label', {}, label), h('div', { class: 'num-wrap' }, num, opts.unit ? h('span', { class: 'unit' }, opts.unit) : null)),
    range,
  );
}

export function toggleControl(label: string, get: () => boolean, set: (v: boolean) => void) {
  const input = h('input', { type: 'checkbox', checked: get(), onchange: () => set(input.checked) });
  return h('label', { class: 'ctrl ctrl-toggle' }, h('span', {}, label), h('span', { class: 'toggle' }, input, h('span', { class: 'toggle-ui' })));
}

function selectControl(label: string, options: { value: string; label: string }[], get: () => string, set: (v: string) => void) {
  const sel = h('select', { onchange: () => set(sel.value) }, ...options.map((o) => h('option', { value: o.value }, o.label)));
  sel.value = get();
  return h('div', { class: 'ctrl' }, h('label', {}, label), sel);
}

function paramControl(layer: Layer, def: ParamDef): HTMLElement {
  const get = () => layer.params[def.key];
  const set = (v: unknown) => store.setParam(layer.id, def.key, v);
  switch (def.type) {
    case 'number':
      return numberControl(def.label, def, get, set);
    case 'select':
      return selectControl(def.label, def.options, get, set);
    case 'boolean':
      return toggleControl(def.label, get, set);
    case 'color':
      return h('div', { class: 'ctrl ctrl-inline' }, h('label', {}, def.label), colorSwatch(get, set));
    case 'gradient':
      return h('div', { class: 'ctrl' }, h('label', {}, def.label), gradientEditor(get(), set));
    case 'text': {
      const input = h('input', { class: 'text-input', value: get(), placeholder: def.placeholder ?? '', spellcheck: false });
      input.addEventListener('input', () => set(input.value));
      return h('div', { class: 'ctrl' }, h('label', {}, def.label), input);
    }
  }
}

/** Ulaz sloja: lanac (rezultat slojeva ispod) ili originalna slika. */
function inputControl(layer: Layer) {
  const hint = h('p', { class: 'section-hint' });
  const bar = h('div', { class: 'segmented full' });
  const sync = () => {
    const below = (layer.input ?? 'original') === 'below';
    bar.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.input === (below ? 'below' : 'original')));
    hint.textContent = below ? 'This effect is applied to the result of the layers below it.' : 'This effect is applied to the original image.';
  };
  for (const [value, label] of [['below', 'Layers below'], ['original', 'Original image']] as const) {
    bar.append(
      h('button', {
        'data-input': value,
        onclick: () => {
          store.updateLayer(layer.id, { input: value });
          sync();
        },
      }, label),
    );
  }
  sync();
  return h('div', { class: 'ctrl' }, h('label', {}, 'Input'), bar, hint);
}

/** Sekcija "Animation": tip, brzina i intenzitet animacije sloja. */
function motionControls(layer: Layer, types: { value: string; label: string }[]) {
  const mo = layer.motion;
  const update = (patch: Partial<Layer['motion']>) => {
    Object.assign(mo, patch);
    store.emit('params');
  };
  const sub = h(
    'div',
    { class: 'mask-block', hidden: !mo.on },
    selectControl('Type', types, () => mo.type, (v) => update({ type: v })),
    selectControl(
      'React to audio',
      [
        { value: 'off', label: 'Off' },
        { value: 'level', label: 'Volume' },
        { value: 'bass', label: 'Bass' },
        { value: 'mid', label: 'Mids' },
        { value: 'treble', label: 'Treble' },
      ],
      () => mo.audio,
      (v) => update({ audio: v as Layer['motion']['audio'] }),
    ),
    h('p', { class: 'section-hint audio-hint', hidden: !!audio.track }, 'Load music with the note button in the bottom bar. The animation intensity then follows the sound.'),
    numberControl('Speed', { min: 0.1, max: 4, step: 0.1, unit: '×' }, () => mo.speed, (v) => update({ speed: v })),
    numberControl('Intensity', { min: 0, max: 100, step: 1, unit: '%' }, () => mo.intensity, (v) => update({ intensity: v })),
  );
  return h(
    'section',
    { class: 'section' },
    h('h3', {}, 'Animation'),
    toggleControl('Enable animation', () => mo.on, (v) => {
      update({ on: v });
      sub.hidden = !v;
      if (v) store.setPlaying(true);
    }),
    sub,
  );
}

/** Sekcija "Interaction": sloj se vidi (ili nestaje) u krugu oko kursora. */
function interactControls(layer: Layer) {
  const it = layer.interact;
  const update = (patch: Partial<Layer['interact']>) => {
    Object.assign(it, patch);
    sub.hidden = it.mode === 'off';
    store.emit('params');
  };
  const sub = h(
    'div',
    { class: 'mask-block', hidden: it.mode === 'off' },
    numberControl('Radius', { min: 20, max: 800, step: 5 }, () => it.radius, (v) => update({ radius: v })),
    numberControl('Softness', { min: 0, max: 100, step: 1, unit: '%' }, () => it.softness, (v) => update({ softness: v })),
    h('p', { class: 'section-hint' }, 'Move the mouse over the canvas. Exports use the last cursor position.'),
  );
  return h(
    'section',
    { class: 'section' },
    h('h3', {}, 'Interaction'),
    selectControl(
      'Mouse',
      [
        { value: 'off', label: 'Off' },
        { value: 'reveal', label: 'Reveal around cursor' },
        { value: 'hide', label: 'Hide around cursor' },
      ],
      () => it.mode,
      (v) => update({ mode: v as Layer['interact']['mode'] }),
    ),
    sub,
  );
}

/** Desni panel: kontrole aktivnog sloja, generisane iz definicije parametara efekta. */
export function controlsPanel(root: HTMLElement) {
  let rows: { def: ParamDef; el: HTMLElement }[] = [];
  let layerId: string | null = null;
  let mask: ReturnType<typeof maskSection> | null = null;

  const build = () => {
    closeColorPicker();
    const layer = store.active;
    layerId = layer?.id ?? null;
    rows = [];
    mask = null;
    if (!layer) {
      root.replaceChildren(h('div', { class: 'panel-empty' }, 'Select a layer or add a new effect.'));
      return;
    }
    const effect = getEffect(layer.effectId);

    const layerSection = h(
      'section',
      { class: 'section' },
      h('h3', {}, 'Layer'),
      inputControl(layer),
      numberControl('Opacity', { min: 0, max: 100, step: 1, unit: '%' }, () => Math.round(layer.opacity * 100), (v) => store.updateLayer(layer.id, { opacity: v / 100 })),
      selectControl('Blend mode', BLEND_MODES, () => layer.blend, (v) => store.updateLayer(layer.id, { blend: v as Layer['blend'] })),
    );

    const effectSection = h('section', { class: 'section' }, h('h3', {}, effect.name));
    for (const def of effect.params) {
      const el = paramControl(layer, def);
      rows.push({ def, el });
      effectSection.append(el);
    }

    const motionSection = effect.motion ? motionControls(layer, effect.motion.types) : null;
    mask = maskSection(layer);
    const dice = h('button', {
      class: 'btn btn-small randomize-btn',
      title: 'Random settings for this layer (R). Ctrl+Z undoes it.',
      html: `${icons.dice}<span>Randomize</span>`,
      onclick: () => randomize(),
    });
    root.replaceChildren(
      h('div', { class: 'panel-title' }, badge(layer.effectId), h('span', { class: 'panel-title-text' }, layer.name), dice),
      layerSection,
      effectSection,
      ...(motionSection ? [motionSection] : []),
      interactControls(layer),
      mask.el,
    );
    refresh();
  };

  /** Nasumični parametri aktivnog sloja; panel se pravi iznova da pokaže nove vrijednosti. */
  const randomize = () => {
    const layer = store.active;
    if (!layer) return;
    const scroll = root.scrollTop;
    layer.params = randomParams(layer.effectId, layer.params);
    store.emit('params');
    build();
    root.scrollTop = scroll;
  };
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey && !isTyping(e)) randomize();
  });
  audio.onChange(() => root.querySelectorAll<HTMLElement>('.audio-hint').forEach((el) => (el.hidden = !!audio.track)));

  const refresh = () => {
    const layer = store.active;
    if (!layer) return;
    for (const { def, el } of rows) el.hidden = def.showIf ? !def.showIf(layer.params) : false;
  };

  store.on((topic) => {
    if (topic === 'active') build();
    else if (topic === 'params') refresh();
    else if (topic === 'mask') mask?.sync();
    else if (topic === 'layers' && store.active && store.active.id === layerId) {
      const title = root.querySelector('.panel-title-text');
      if (title) title.textContent = store.active.name;
    }
  });
  build();
}
