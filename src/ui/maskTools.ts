import type { Stroke, Zone } from '../core/mask';
import type { Renderer } from '../core/renderer';
import { store, type Layer, type Tool } from '../core/state';
import { h, icons, toast } from './dom';
import { isTyping, type Point, type ToolHandler, type Viewport } from './viewport';

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const HANDLES: [Handle, number, number][] = [
  ['nw', 0, 0], ['n', 0.5, 0], ['ne', 1, 0], ['e', 1, 0.5],
  ['se', 1, 1], ['s', 0.5, 1], ['sw', 0, 1], ['w', 0, 0.5],
];

const TOOLS: { id: Tool; label: string; key: string; icon: string }[] = [
  { id: 'hand', label: 'Hand', key: 'V', icon: icons.hand },
  { id: 'zone', label: 'Zone', key: 'M', icon: icons.zone },
  { id: 'brush', label: 'Brush', key: 'B', icon: icons.brush },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: icons.eraser },
];

const NS = 'http://www.w3.org/2000/svg';
function el(tag: string, attrs: Record<string, string | number>) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

type DragState =
  | { kind: 'move'; layer: Layer; zone: Zone; start: Point; orig: Zone }
  | { kind: 'resize'; layer: Layer; zone: Zone; handle: Handle; orig: Zone; created: boolean }
  | { kind: 'stroke'; layer: Layer; stroke: Stroke; last: Point };

let nextZone = 1;

/** Alati maske na platnu: zone (crtanje, pomjeranje, promjena veličine), četkica i gumica. */
export function maskTools(viewport: Viewport, renderer: Renderer) {
  const svg = el('svg', { class: 'mask-overlay' }) as SVGSVGElement;
  viewport.stage.append(svg);

  const bar = h('div', { class: 'tool-bar' });
  const buttons = TOOLS.map((t) =>
    h('button', {
      class: 'icon-btn tool',
      title: `${t.label} (${t.key})`,
      html: t.icon,
      'data-tool': t.id,
      onclick: () => store.setTool(t.id),
    }),
  );
  bar.append(...buttons);
  viewport.el.append(bar);

  let hover: Point | null = null;
  let drag: DragState | null = null;

  const map = () => renderer.map;
  const toImage = (p: Point) => ({ u: (p.x - map().ox) / map().dw, v: (p.y - map().oy) / map().dh });
  const zoneScreen = (z: Zone) => {
    const m = map();
    const a = viewport.toScreen(m.ox + z.x * m.dw, m.oy + z.y * m.dh);
    return { x: a.x, y: a.y, w: z.w * m.dw * viewport.zoom, h: z.h * m.dh * viewport.zoom };
  };
  const brushRadius = (layer: Layer) => (layer.mask.brush.size / 2) * (Math.max(renderer.width, renderer.height) / 1000);

  const handler: ToolHandler = {
    down(_e, p) {
      if (store.tool === 'hand' || !store.state.media) return false;
      const layer = store.active;
      if (!layer) {
        toast('Select or add a layer first.');
        return true;
      }
      if (store.tool === 'zone') zoneDown(layer, p);
      else brushDown(layer, p, store.tool === 'brush' ? 'add' : 'erase');
      return true;
    },
    move(_e, p) {
      hover = p;
      if (!drag) return draw();
      const { u, v } = toImage(p);
      if (drag.kind === 'move') {
        const s = toImage(drag.start);
        drag.zone.x = drag.orig.x + (u - s.u);
        drag.zone.y = drag.orig.y + (v - s.v);
      } else if (drag.kind === 'resize') {
        const o = drag.orig;
        let l = o.x, r = o.x + o.w, t = o.y, b = o.y + o.h;
        if (drag.handle.includes('w')) l = u;
        if (drag.handle.includes('e')) r = u;
        if (drag.handle.includes('n')) t = v;
        if (drag.handle.includes('s')) b = v;
        Object.assign(drag.zone, { x: Math.min(l, r), y: Math.min(t, b), w: Math.abs(r - l), h: Math.abs(b - t) });
      } else {
        // Novu tačku dodajemo tek kad se pokazivač pomjeri bar ~2px na ekranu.
        if (Math.hypot(p.x - drag.last.x, p.y - drag.last.y) * viewport.zoom < 2) return draw();
        drag.stroke.points.push(u, v);
        drag.last = p;
      }
      store.touchMask(drag.layer);
    },
    up() {
      if (drag?.kind === 'resize' && drag.created) {
        const { layer, zone } = drag;
        const s = zoneScreen(zone);
        if (s.w < 4 || s.h < 4) {
          layer.mask.zones = layer.mask.zones.filter((z) => z !== zone);
          store.selectedZone = null;
          store.touchMask(layer);
        }
      }
      drag = null;
      draw();
    },
    hover(p) {
      hover = p;
      draw();
    },
  };
  viewport.tool = handler;

  function zoneDown(layer: Layer, p: Point) {
    const zones = layer.mask.zones;
    const sp = viewport.toScreen(p.x, p.y);
    const selected = zones.find((z) => z.id === store.selectedZone);
    if (selected) {
      const s = zoneScreen(selected);
      for (const [handle, fx, fy] of HANDLES) {
        if (Math.abs(sp.x - (s.x + s.w * fx)) <= 7 && Math.abs(sp.y - (s.y + s.h * fy)) <= 7) {
          drag = { kind: 'resize', layer, zone: selected, handle, orig: { ...selected }, created: false };
          return;
        }
      }
    }
    for (let i = zones.length - 1; i >= 0; i--) {
      const s = zoneScreen(zones[i]);
      if (sp.x >= s.x && sp.x <= s.x + s.w && sp.y >= s.y && sp.y <= s.y + s.h) {
        store.selectZone(zones[i].id);
        drag = { kind: 'move', layer, zone: zones[i], start: p, orig: { ...zones[i] } };
        return;
      }
    }
    const { u, v } = toImage(p);
    const zone: Zone = { id: `z${Date.now().toString(36)}${nextZone++}`, x: u, y: v, w: 0, h: 0 };
    zones.push(zone);
    if (layer.mask.area !== 'zones') {
      layer.mask.area = 'zones';
      toast('Layer mask is now: zones.');
    }
    store.selectedZone = zone.id;
    drag = { kind: 'resize', layer, zone, handle: 'se', orig: { ...zone }, created: true };
    store.touchMask(layer);
  }

  function brushDown(layer: Layer, p: Point, mode: Stroke['mode']) {
    if (mode === 'add' && layer.mask.area === 'full' && !layer.mask.threshold.on) {
      layer.mask.area = 'brush';
      toast('Layer mask is now: brush. The effect only shows where you paint.');
    }
    const { u, v } = toImage(p);
    const stroke: Stroke = {
      mode,
      r: brushRadius(layer) / map().dw,
      soft: layer.mask.brush.softness / 100,
      points: [u, v],
    };
    layer.mask.strokes.push(stroke);
    drag = { kind: 'stroke', layer, stroke, last: p };
    store.touchMask(layer);
  }

  function draw() {
    svg.replaceChildren();
    const layer = store.active;
    viewport.stage.dataset.tool = store.tool;
    buttons.forEach((b) => b.classList.toggle('on', b.dataset.tool === store.tool));
    if (!layer || !store.state.media) return;

    if (store.tool === 'zone' || layer.mask.area === 'zones') {
      layer.mask.zones.forEach((z, i) => {
        const s = zoneScreen(z);
        const sel = store.tool === 'zone' && z.id === store.selectedZone;
        svg.append(el('rect', { x: s.x, y: s.y, width: Math.max(0, s.w), height: Math.max(0, s.h), class: `zone${sel ? ' selected' : ''}` }));
        const tag = el('text', { x: s.x + 6, y: s.y + 15, class: 'zone-tag' });
        tag.textContent = `Z${i + 1}`;
        svg.append(tag);
        if (sel) {
          for (const [, fx, fy] of HANDLES) {
            svg.append(el('rect', { x: s.x + s.w * fx - 4, y: s.y + s.h * fy - 4, width: 8, height: 8, class: 'zone-handle' }));
          }
        }
      });
    }

    if ((store.tool === 'brush' || store.tool === 'eraser') && hover) {
      const c = viewport.toScreen(hover.x, hover.y);
      const r = brushRadius(layer) * viewport.zoom;
      svg.append(el('circle', { cx: c.x, cy: c.y, r, class: 'brush-ring' }));
      const inner = r * (1 - layer.mask.brush.softness / 100);
      if (inner > 2 && inner < r - 2) svg.append(el('circle', { cx: c.x, cy: c.y, r: inner, class: 'brush-ring inner' }));
    }
  }

  window.addEventListener('keydown', (e) => {
    if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    const tool = TOOLS.find((t) => t.key.toLowerCase() === e.key.toLowerCase());
    if (tool) {
      store.setTool(tool.id);
      return;
    }
    const layer = store.active;
    if ((e.key === 'Delete' || e.key === 'Backspace') && layer && store.selectedZone && store.tool === 'zone') {
      e.preventDefault();
      layer.mask.zones = layer.mask.zones.filter((z) => z.id !== store.selectedZone);
      store.selectedZone = null;
      store.touchMask(layer);
    }
    if (e.key === 'Escape' && store.selectedZone) store.selectZone(null);
  });

  viewport.onView(draw);
  store.on((topic) => {
    if (topic !== 'params') draw();
  });
  draw();
}
