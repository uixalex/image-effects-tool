/** r, g, b: 0-255, a: 0-1 */
export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface GradientStop {
  pos: number; // 0-1
  color: RGBA;
}

export type Gradient = GradientStop[];

export const rgba = (r: number, g: number, b: number, a = 1): RGBA => ({ r, g, b, a });

export function hex(str: string, a = 1): RGBA {
  const c = parseHex(str);
  if (!c) throw new Error(`Bad hex ${str}`);
  return { ...c, a };
}

export function parseHex(str: string): RGBA | null {
  let s = str.trim().replace(/^#/, '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(s)) return null;
  const n = (i: number) => parseInt(s.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: s.length === 8 ? n(6) / 255 : 1 };
}

export function toHex(c: RGBA): string {
  const h = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  return (h(c.r) + h(c.g) + h(c.b)).toUpperCase();
}

export function css(c: RGBA): string {
  return `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${c.a})`;
}

export function rgbToHsv(c: RGBA): { h: number; s: number; v: number } {
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvToRgb(h: number, s: number, v: number, a = 1): RGBA {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return { r: f(5) * 255, g: f(3) * 255, b: f(1) * 255, a };
}

export function lerpColor(a: RGBA, b: RGBA, t: number): RGBA {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
    a: a.a + (b.a - a.a) * t,
  };
}

export function sortStops(g: Gradient): Gradient {
  return [...g].sort((a, b) => a.pos - b.pos);
}

/** Boja gradijenta na poziciji t (0-1). */
export function sampleGradient(g: Gradient, t: number): RGBA {
  const s = sortStops(g);
  if (t <= s[0].pos) return s[0].color;
  for (let i = 1; i < s.length; i++) {
    if (t <= s[i].pos) {
      const span = s[i].pos - s[i - 1].pos || 1;
      return lerpColor(s[i - 1].color, s[i].color, (t - s[i - 1].pos) / span);
    }
  }
  return s[s.length - 1].color;
}

export function gradientCss(g: Gradient, direction = 'to right'): string {
  const stops = sortStops(g).map((s) => `${css(s.color)} ${(s.pos * 100).toFixed(1)}%`);
  return `linear-gradient(${direction}, ${stops.join(', ')})`;
}

/** 256 boja (RGBA bajtovi) duž gradijenta. */
export function gradientLUT(g: Gradient): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const c = sampleGradient(g, i / 255);
    lut[i * 4] = c.r;
    lut[i * 4 + 1] = c.g;
    lut[i * 4 + 2] = c.b;
    lut[i * 4 + 3] = c.a * 255;
  }
  return lut;
}

/** Relativna svjetlina 0-1 iz 0-255 kanala. */
export const luma = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
