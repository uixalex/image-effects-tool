import type { MaskArea } from '../core/mask';
import { store, type Layer, type Tool } from '../core/state';
import { numberControl, toggleControl } from './controls';
import { h } from './dom';

const AREAS: { value: MaskArea; label: string }[] = [
  { value: 'full', label: 'Full' },
  { value: 'zones', label: 'Zones' },
  { value: 'brush', label: 'Brush' },
];

/** Sekcija "Mask" za aktivni sloj. sync() osvježava dijelove koji zavise od stanja maske. */
export function maskSection(layer: Layer) {
  const m = layer.mask;
  const touch = () => store.touchMask(layer);

  const areaBar = h(
    'div',
    { class: 'segmented full' },
    ...AREAS.map((a) =>
      h('button', {
        'data-area': a.value,
        onclick: () => {
          m.area = a.value;
          touch();
        },
      }, a.label),
    ),
  );

  const toolLink = (tool: Tool, text: string) => h('button', { class: 'link', onclick: () => store.setTool(tool) }, text);

  const zoneInfo = h('span', { class: 'mask-count' });
  const clearZones = h('button', {
    class: 'btn btn-small',
    onclick: () => {
      m.zones = [];
      store.selectedZone = null;
      touch();
    },
  }, 'Clear zones');
  const zonesBlock = h(
    'div',
    { class: 'mask-block' },
    h('p', { class: 'section-hint' }, 'Pick the ', toolLink('zone', 'Zone tool (M)'), ' and draw rectangles on the canvas. Drag a zone to move it, use the handles to resize, Delete removes it.'),
    h('div', { class: 'mask-row' }, zoneInfo, clearZones),
  );

  const thresholdBlock = h(
    'div',
    { class: 'mask-block' },
    numberControl('Threshold', { min: 0, max: 100, step: 1, unit: '%' }, () => m.threshold.value, (v) => {
      m.threshold.value = v;
      touch();
    }),
    toggleControl('Only darker than threshold', () => m.threshold.invert, (v) => {
      m.threshold.invert = v;
      touch();
    }),
  );

  const strokeInfo = h('span', { class: 'mask-count' });
  const clearBrush = h('button', {
    class: 'btn btn-small',
    onclick: () => {
      m.strokes = [];
      touch();
    },
  }, 'Clear brush');

  const el = h(
    'section',
    { class: 'section' },
    h('h3', {}, 'Mask'),
    h('div', { class: 'ctrl' }, h('label', {}, 'Area'), areaBar),
    zonesBlock,
    toggleControl('Brightness threshold', () => m.threshold.on, (v) => {
      m.threshold.on = v;
      touch();
    }),
    thresholdBlock,
    h('div', { class: 'mask-divider' }),
    h('p', { class: 'section-hint' }, toolLink('brush', 'Brush (B)'), ' adds, ', toolLink('eraser', 'eraser (E)'), ' removes. Works on top of any area.'),
    numberControl('Brush size', { min: 2, max: 400, step: 1 }, () => m.brush.size, (v) => {
      m.brush.size = v;
      store.emit('tool');
    }),
    numberControl('Softness', { min: 0, max: 100, step: 1, unit: '%' }, () => m.brush.softness, (v) => {
      m.brush.softness = v;
      store.emit('tool');
    }),
    h('div', { class: 'mask-row' }, strokeInfo, clearBrush),
  );

  const sync = () => {
    areaBar.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.area === m.area));
    zonesBlock.hidden = m.area !== 'zones';
    thresholdBlock.hidden = !m.threshold.on;
    zoneInfo.textContent = m.zones.length === 1 ? '1 zone' : `${m.zones.length} zones`;
    clearZones.disabled = !m.zones.length;
    strokeInfo.textContent = m.strokes.length ? `Strokes: ${m.strokes.length}` : 'No strokes';
    clearBrush.disabled = !m.strokes.length;
  };
  sync();
  return { el, sync };
}
