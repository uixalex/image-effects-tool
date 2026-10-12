/**
 * Podskup Canvas 2D API-ja koji vektorski efekti koriste, ali umjesto piksela pravi SVG elemente.
 * Efekat ne zna razliku: isti render() crta i preview i SVG export.
 */

const n = (v: number) => String(Math.round(v * 100) / 100);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "rgba(r,g,b,a)" u SVG atribute boja + providnost (SVG 1.1 ne poznaje rgba). */
function paint(style: string, kind: 'fill' | 'stroke'): string {
  const m = style.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (!m) return `${kind}="${esc(style)}"`;
  const a = m[4] === undefined ? 1 : Number(m[4]);
  const color = `rgb(${Math.round(+m[1])},${Math.round(+m[2])},${Math.round(+m[3])})`;
  return a < 1 ? `${kind}="${color}" ${kind}-opacity="${n(a)}"` : `${kind}="${color}"`;
}

const measure = document.createElement('canvas').getContext('2d')!;

export class SvgContext {
  fillStyle = '#000';
  strokeStyle = '#000';
  lineWidth = 1;
  font = '10px sans-serif';
  textAlign: CanvasTextAlign = 'start';
  textBaseline: CanvasTextBaseline = 'alphabetic';
  lineJoin: CanvasLineJoin = 'miter';
  lineCap: CanvasLineCap = 'butt';
  imageSmoothingEnabled = true;
  private dash: number[] = [];
  private path = '';
  private parts: string[] = [];

  /** SVG elementi nacrtani do sada. */
  toString() {
    return this.parts.join('\n');
  }

  setLineDash(d: number[]) {
    this.dash = d;
  }

  clearRect() {}

  fillRect(x: number, y: number, w: number, h: number) {
    this.parts.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" ${paint(this.fillStyle, 'fill')}/>`);
  }

  strokeRect(x: number, y: number, w: number, h: number) {
    this.parts.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="none" ${this.strokeAttrs()}/>`);
  }

  beginPath() {
    this.path = '';
  }

  moveTo(x: number, y: number) {
    this.path += `M${n(x)} ${n(y)}`;
  }

  lineTo(x: number, y: number) {
    this.path += `L${n(x)} ${n(y)}`;
  }

  rect(x: number, y: number, w: number, h: number) {
    this.path += `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`;
  }

  /** Efekti crtaju samo pune krugove, pa ih pišemo kao dva luka. */
  arc(cx: number, cy: number, r: number) {
    this.path += `M${n(cx + r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 0 ${n(cx - r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 0 ${n(cx + r)} ${n(cy)}Z`;
  }

  fill() {
    if (this.path) this.parts.push(`<path d="${this.path}" ${paint(this.fillStyle, 'fill')}/>`);
  }

  stroke() {
    if (this.path) this.parts.push(`<path d="${this.path}" fill="none" ${this.strokeAttrs()}/>`);
  }

  measureText(text: string) {
    measure.font = this.font;
    return measure.measureText(text);
  }

  fillText(text: string, x: number, y: number) {
    const f = this.font.match(/^(\d+)\s+([\d.]+)px\s+(.+)$/);
    const [weight, size, family] = f ? [f[1], Number(f[2]), f[3]] : ['400', 10, 'monospace'];
    const anchor = this.textAlign === 'center' ? 'middle' : this.textAlign === 'right' || this.textAlign === 'end' ? 'end' : 'start';
    const baseline = this.textBaseline === 'middle' ? ' dominant-baseline="central"' : this.textBaseline === 'top' ? ' dominant-baseline="hanging"' : '';
    this.parts.push(
      `<text x="${n(x)}" y="${n(y)}" font-family='${esc(family)}' font-size="${n(size)}" font-weight="${weight}" text-anchor="${anchor}"${baseline} ${paint(this.fillStyle, 'fill')}>${esc(text)}</text>`,
    );
  }

  private strokeAttrs() {
    const dash = this.dash.length ? ` stroke-dasharray="${this.dash.map(n).join(' ')}"` : '';
    return `${paint(this.strokeStyle, 'stroke')} stroke-width="${n(this.lineWidth)}"${dash}`;
  }
}
