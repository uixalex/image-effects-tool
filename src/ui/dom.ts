type Props = Record<string, any> & { class?: string; style?: Partial<CSSStyleDeclaration> };
type Child = Node | string | null | undefined | false;

/** Mali helper za pravljenje DOM elemenata. Ključevi koji počinju sa "on" su event listeneri. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el) (el as any)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

/** Prati povlačenje pokazivača od pointerdown do pointerup. */
export function drag(e: PointerEvent, move: (e: PointerEvent) => void, up?: (e: PointerEvent) => void) {
  const target = e.currentTarget as HTMLElement;
  target.setPointerCapture(e.pointerId);
  const onMove = (ev: PointerEvent) => move(ev);
  const onUp = (ev: PointerEvent) => {
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', onUp);
    target.removeEventListener('pointercancel', onUp);
    up?.(ev);
  };
  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onUp);
  target.addEventListener('pointercancel', onUp);
}

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const icons = {
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: svg('<path d="M3 3l18 18"/><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6A17.4 17.4 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  upload: svg('<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>'),
  download: svg('<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>'),
  dropper: svg('<path d="M14.5 5.5l4 4M17 3a2.1 2.1 0 0 1 3 3l-2.5 2.5-3-3L17 3z"/><path d="M15.5 8.5L7 17l-3 1 1-3 8.5-8.5"/>'),
  fit: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  hand: svg('<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5v-6a1.5 1.5 0 0 1 3 0v6M14 10.5V6a1.5 1.5 0 0 1 3 0v8c0 4-2.5 7-6.5 7-2.4 0-3.8-1-5.2-3L3.5 15a1.6 1.6 0 0 1 2.4-2.1L8 15"/>'),
  zone: svg('<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M11 4h2M11 20h2M4 11v2M20 11v2"/>'),
  brush: svg('<path d="M18.4 3.6a2 2 0 0 1 2.8 2.8l-8.5 8.5-2.8-2.8 8.5-8.5z"/><path d="M9.9 12.1C7 12 5.5 13.8 5.2 16.2 5 18 4 19.4 2.8 20.2c3.2.7 7.4.4 9.2-2.3.9-1.4.9-2.7.7-3"/>'),
  eraser: svg('<path d="M20 20H8.5L3.8 15.3a1.5 1.5 0 0 1 0-2.1l9.6-9.6a1.5 1.5 0 0 1 2.1 0l4.7 4.7a1.5 1.5 0 0 1 0 2.1L11 19.7"/><path d="M8.5 9l7 7"/>'),
  play: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M7 4.8v14.4a1 1 0 0 0 1.5.86l11.6-7.2a1 1 0 0 0 0-1.72L8.5 3.94A1 1 0 0 0 7 4.8z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="6" y="4" width="4.2" height="16" rx="1.2"/><rect x="13.8" y="4" width="4.2" height="16" rx="1.2"/></svg>',
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  redo: svg('<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
  save: svg('<path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V3z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>'),
  dice: svg('<path d="M12 2.8l8 4.6v9.2l-8 4.6-8-4.6V7.4z"/><path d="M4 7.4l8 4.6 8-4.6M12 12v9.2"/><circle cx="12" cy="7.3" r="1" fill="currentColor"/><circle cx="7.6" cy="12.6" r="1" fill="currentColor"/><circle cx="8.4" cy="16.4" r="1" fill="currentColor"/><circle cx="16" cy="14.5" r="1" fill="currentColor"/>'),
  music: svg('<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>'),
  compare: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 2v20"/><path d="M3 13l4-4 5 5"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  image: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>'),
};

export function toast(message: string) {
  const el = h('div', { class: 'toast' }, message);
  document.body.append(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3000);
}
