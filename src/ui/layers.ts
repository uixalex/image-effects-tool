import { allEffects } from '../core/registry';
import { store, type Layer } from '../core/state';
import { h, icons } from './dom';

const BADGES: Record<string, string> = {
  ascii: 'A',
  gradientMap: 'GM',
  halftone: 'HT',
  circlePacking: 'CP',
  pixelMosaic: 'PX',
  dotOverlay: 'DO',
  hud: 'HUD',
  dither: 'DI',
  glitch: 'GL',
  meshGradient: 'MG',
  lineHalftone: 'LH',
  contours: 'TP',
  liquid: 'LQ',
  crt: 'CRT',
  duotone: 'DU',
};

/** Mala obojena oznaka efekta (boje su u CSS-u po data-effect). */
export function badge(effectId: string) {
  return h('span', { class: 'layer-badge', 'data-effect': effectId }, BADGES[effectId] ?? effectId.slice(0, 2).toUpperCase());
}

/** Lijevi panel: lista slojeva (gornji sloj prvi), dodavanje, vidljivost, redoslijed. */
export function layersPanel(root: HTMLElement) {
  const list = h('div', { class: 'layer-list' });
  const menu = h(
    'div',
    { class: 'add-menu', hidden: true },
    ...allEffects().map((e) =>
      h('button', {
        class: 'add-menu-item',
        onclick: () => {
          menu.hidden = true;
          store.addLayer(e.id);
        },
      }, badge(e.id), e.name),
    ),
  );
  const addBtn = h('button', {
    class: 'icon-btn round',
    title: 'Add layer',
    html: icons.plus,
    onclick: (e: MouseEvent) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    },
  });
  document.addEventListener('pointerdown', (e) => {
    if (!menu.contains(e.target as Node) && e.target !== addBtn && !addBtn.contains(e.target as Node)) menu.hidden = true;
  });

  const originalRow = h('div', { class: 'layer-row layer-original' });

  root.append(
    h('div', { class: 'panel-head' }, h('h2', {}, 'Layers'), h('div', { class: 'add-wrap' }, addBtn, menu)),
    list,
    originalRow,
  );

  let dragId: string | null = null;

  const row = (layer: Layer) => {
    const el = h('div', {
      class: `layer-row${layer.id === store.state.activeId ? ' active' : ''}${layer.visible ? '' : ' hidden-layer'}`,
      draggable: true,
      onclick: () => store.setActive(layer.id),
    });

    const eye = h('button', {
      class: 'icon-btn eye',
      title: layer.visible ? 'Hide' : 'Show',
      html: layer.visible ? icons.eye : icons.eyeOff,
      onclick: (e: MouseEvent) => {
        e.stopPropagation();
        store.updateLayer(layer.id, { visible: !layer.visible }, 'layers');
      },
    });

    const name = h('span', { class: 'layer-name', title: 'Double-click to rename' }, layer.name);
    name.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const input = h('input', { class: 'text-input rename', value: layer.name });
      const commit = () => store.updateLayer(layer.id, { name: input.value.trim() || layer.name }, 'layers');
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') input.blur();
        if (ev.key === 'Escape') {
          input.value = layer.name;
          input.blur();
        }
      });
      input.addEventListener('blur', commit);
      name.replaceWith(input);
      input.select();
    });

    const del = h('button', {
      class: 'icon-btn del',
      title: 'Delete layer',
      html: icons.trash,
      onclick: (e: MouseEvent) => {
        e.stopPropagation();
        store.removeLayer(layer.id);
      },
    });

    el.addEventListener('dragstart', (e) => {
      dragId = layer.id;
      e.dataTransfer!.effectAllowed = 'move';
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => {
      dragId = null;
      el.classList.remove('dragging');
      list.querySelectorAll('.drop-above, .drop-below').forEach((n) => n.classList.remove('drop-above', 'drop-below'));
    });
    el.addEventListener('dragover', (e) => {
      if (!dragId || dragId === layer.id) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const above = e.clientY < r.top + r.height / 2;
      el.classList.toggle('drop-above', above);
      el.classList.toggle('drop-below', !above);
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-above', 'drop-below'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!dragId) return;
      const above = el.classList.contains('drop-above');
      const layers = store.state.layers;
      const from = layers.findIndex((l) => l.id === dragId);
      let to = layers.findIndex((l) => l.id === layer.id);
      // Lista je prikazana obrnuto: "iznad" u listi znači veći indeks.
      if (above) to += 1;
      if (from < to) to -= 1;
      store.moveLayer(dragId, to);
    });

    el.append(badge(layer.effectId), name, eye, del);
    return el;
  };

  const render = () => {
    const layers = store.state.layers;
    list.replaceChildren(...[...layers].reverse().map(row));
    if (!layers.length) list.append(h('div', { class: 'layer-empty' }, 'No layers yet. Click + to add an effect.'));

    const on = store.state.showOriginal;
    originalRow.className = `layer-row layer-original${on ? '' : ' hidden-layer'}`;
    originalRow.replaceChildren(
      h('span', { class: 'layer-badge', 'data-effect': 'original' }),
      h('span', { class: 'layer-name' }, 'Original'),
      h('button', {
        class: 'icon-btn eye',
        title: on ? 'Hide original' : 'Show original',
        html: on ? icons.eye : icons.eyeOff,
        onclick: () => {
          store.state.showOriginal = !on;
          store.emit('layers');
        },
      }),
    );
  };

  store.on((topic) => {
    if (topic === 'layers' || topic === 'source') render();
  });
  render();
}
