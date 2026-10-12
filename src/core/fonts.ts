export const MONO_FONTS = [
  { value: 'JetBrains Mono', label: 'JetBrains Mono' },
  { value: 'IBM Plex Mono', label: 'IBM Plex Mono' },
  { value: 'Space Mono', label: 'Space Mono' },
  { value: 'Courier New', label: 'Courier New' },
  { value: 'monospace', label: 'System mono' },
];

const pending = new Set<string>();
let onLoaded: () => void = () => {};

export function setFontLoadedHandler(fn: () => void) {
  onLoaded = fn;
}

/** Vraća CSS font string. Ako font još nije učitan, pokreće učitavanje i kasnije traži novi render. */
export function font(family: string, size: number, weight = 400): string {
  const spec = `${weight} ${size}px "${family}"`;
  const key = `${weight} "${family}"`;
  if (family !== 'monospace' && !document.fonts.check(spec) && !pending.has(key)) {
    pending.add(key);
    document.fonts.load(spec).then(() => onLoaded());
  }
  return family === 'monospace' ? `${weight} ${size}px monospace` : spec;
}
