import { css, gradientCss, sampleGradient, toHex, type Gradient, type RGBA } from '../core/color';
import { openColorPicker } from './colorPicker';
import { drag, h, icons } from './dom';

/**
 * Gradient editor: klik na traku dodaje tačku, prevlačenje je pomjera,
 * povlačenje nadolje (ili dugme / Delete) je briše. Minimalno dvije tačke.
 */
export function gradientEditor(initial: Gradient, onChange: (g: Gradient) => void): HTMLElement {
  let stops = initial.map((s) => ({ ...s, color: { ...s.color } }));
  let selected = 0;

  const fill = h('div', { class: 'ge-fill' });
  const bar = h('div', { class: 'ge-bar', title: 'Click to add a stop' }, fill);
  const track = h('div', { class: 'ge-track' });
  const swatch = h('button', { class: 'swatch' });
  const hexLabel = h('span', { class: 'ge-hex' });
  const posInput = h('input', { class: 'num-input', type: 'number', min: 0, max: 100, step: 1 });
  const delBtn = h('button', { class: 'icon-btn', title: 'Delete stop', html: icons.trash });

  const emit = () => onChange(stops.map((s) => ({ pos: s.pos, color: { ...s.color } })));

  const render = () => {
    fill.style.background = gradientCss(stops);
    track.replaceChildren(
      ...stops.map((s, i) => {
        const m = h('div', {
          class: `ge-stop${i === selected ? ' selected' : ''}`,
          tabIndex: 0,
          style: { left: `${s.pos * 100}%` },
        });
        m.style.setProperty('--c', css(s.color));
        m.addEventListener('pointerdown', (e) => onStopDown(e, i));
        m.addEventListener('keydown', (e) => {
          if (e.key === 'Delete' || e.key === 'Backspace') remove(i);
        });
        return m;
      }),
    );
    const s = stops[selected];
    swatch.style.setProperty('--c', css(s.color));
    hexLabel.textContent = `#${toHex(s.color)}${s.color.a < 1 ? ` ${Math.round(s.color.a * 100)}%` : ''}`;
    if (document.activeElement !== posInput) posInput.value = String(Math.round(s.pos * 100));
    delBtn.disabled = stops.length <= 2;
  };

  const remove = (i: number) => {
    if (stops.length <= 2) return;
    stops.splice(i, 1);
    selected = Math.min(selected, stops.length - 1);
    render();
    emit();
  };

  const posFromEvent = (e: PointerEvent) => {
    const r = bar.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };

  const onStopDown = (e: PointerEvent, i: number) => {
    e.preventDefault();
    selected = i;
    render();
    const marker = track.children[i] as HTMLElement;
    marker.focus();
    const startY = e.clientY;
    let removing = false;
    drag(
      e,
      (ev) => {
        removing = stops.length > 2 && ev.clientY - startY > 36;
        marker.classList.toggle('removing', removing);
        stops[i].pos = posFromEvent(ev);
        marker.style.left = `${stops[i].pos * 100}%`;
        fill.style.background = gradientCss(stops);
        posInput.value = String(Math.round(stops[i].pos * 100));
        if (!removing) emit();
      },
      () => {
        if (removing) remove(i);
        else render();
      },
    );
  };

  bar.addEventListener('pointerdown', (e) => {
    const pos = posFromEvent(e);
    stops.push({ pos, color: { ...sampleGradient(stops, pos) } });
    selected = stops.length - 1;
    render();
    emit();
  });

  swatch.addEventListener('click', () => {
    openColorPicker(swatch, stops[selected].color, (c: RGBA) => {
      stops[selected].color = c;
      render();
      emit();
    });
  });

  posInput.addEventListener('input', () => {
    const n = Number(posInput.value);
    if (Number.isNaN(n)) return;
    stops[selected].pos = Math.min(100, Math.max(0, n)) / 100;
    render();
    emit();
  });

  delBtn.addEventListener('click', () => remove(selected));

  render();
  return h(
    'div',
    { class: 'gradient-editor' },
    bar,
    track,
    h('div', { class: 'ge-detail' }, swatch, hexLabel, h('div', { class: 'ge-pos' }, posInput, h('span', { class: 'unit' }, '%')), delBtn),
  );
}
