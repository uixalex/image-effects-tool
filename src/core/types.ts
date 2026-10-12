import type { Gradient, RGBA } from './color';
import type { Anim } from './motion';

export type Params = Record<string, any>;

interface ParamBase {
  key: string;
  label: string;
  /** Kontrola se prikazuje samo kad uslov vrati true. */
  showIf?: (p: Params) => boolean;
}

export type ParamDef = ParamBase &
  (
    | { type: 'number'; min: number; max: number; step: number; default: number; unit?: string }
    | { type: 'boolean'; default: boolean }
    | { type: 'select'; options: { value: string; label: string }[]; default: string }
    | { type: 'color'; default: RGBA }
    | { type: 'gradient'; default: Gradient }
    | { type: 'text'; default: string; placeholder?: string }
  );

/** Ulaz koji renderer daje svakom efektu. */
export interface RenderInput {
  width: number;
  height: number;
  /** Izvorna slika već izrezana na format platna, u punoj izlaznoj rezoluciji. */
  source: HTMLCanvasElement;
  /** Izvor umanjen na cols x rows (svaki piksel je prosjek svoje ćelije). Keširano. */
  sample(cols: number, rows: number): ImageData;
  /** Jedinica veličine: 1 = 1px na platnu čija je duža stranica 1000px. Efekti množe svoje veličine s njom, pa izgled ne zavisi od rezolucije. */
  unit: number;
  /** Zone (u pikselima platna) svih vidljivih slojeva koji kao masku koriste zone. */
  zones: { x: number; y: number; w: number; h: number }[];
  /** Animacija sloja, ili null kad je isključena. */
  anim: Anim | null;
}

export interface EffectModule {
  id: string;
  name: string;
  params: ParamDef[];
  /** Efekat čita input.zones, pa se mora ponovo crtati kad se zone promijene. */
  usesZones?: boolean;
  /**
   * Crta efekat u ctx dimenzija input.width x input.height. Canvas je prazan (providan) prije poziva.
   * Vektorski efekti dobijaju i SvgContext (isti API), pa se tako izvoze u SVG.
   */
  render(input: RenderInput, p: Params, ctx: CanvasRenderingContext2D): void;
  /**
   * Animacija: tipovi koje efekat nudi i opcionalna funkcija koja mijenja parametre kroz vrijeme.
   * Animacije koje rade po ćeliji (talas, scramble) efekat čita iz input.anim u renderu.
   */
  motion?: {
    types: { value: string; label: string }[];
    apply?: (p: Params, a: Anim) => Params;
  };
  /** Crta samo oblike i tekst preko Canvas 2D API-ja, pa se može izvesti kao pravi SVG. */
  vector?: boolean;
}

export function defaultParams(effect: EffectModule): Params {
  const out: Params = {};
  for (const def of effect.params) out[def.key] = structuredClone(def.default);
  return out;
}
