import { hsvToRgb, type Gradient, type RGBA } from './color';
import { getEffect } from './registry';
import type { Params } from './types';

/**
 * Nasumični parametri koji i dalje izgledaju dobro: brojevi iz srednjeg dijela raspona,
 * boje iz jedne skladne palete (bazna nijansa + srodne), gradijenti od tamnog ka svijetlom.
 */
export function randomParams(effectId: string, current: Params): Params {
  const effect = getEffect(effectId);
  const rand = Math.random;
  const baseHue = rand() * 360;
  const scheme = [0, 30, 180, 210, -30, 150][Math.floor(rand() * 6)];
  let colorIndex = 0;
  const color = (alpha: number, dark = false): RGBA => {
    const hue = (baseHue + (colorIndex++ % 2 ? scheme : 0) + (rand() - 0.5) * 30 + 360) % 360;
    return hsvToRgb(hue, 0.45 + rand() * 0.45, dark ? 0.08 + rand() * 0.15 : 0.7 + rand() * 0.3, alpha);
  };

  const out: Params = { ...current };
  for (const def of effect.params) {
    const key = def.key;
    switch (def.type) {
      case 'number': {
        if (key === 'seed') {
          out[key] = 1 + Math.floor(rand() * def.max);
          break;
        }
        const span = def.max - def.min;
        const v = def.min + span * (0.1 + rand() * 0.6);
        out[key] = Math.round(v / def.step) * def.step;
        break;
      }
      case 'boolean':
        // Invert i slični prekidači mijenjaju se rjeđe, da slika ne postane negativ svaki put.
        out[key] = key === 'invert' ? rand() < 0.25 : rand() < 0.5;
        break;
      case 'select':
        // Fontove ne diramo, a ostale opcije biramo nasumično.
        if (key !== 'font') out[key] = def.options[Math.floor(rand() * def.options.length)].value;
        break;
      case 'color': {
        const isBg = /bg|background|dark|shadow/i.test(key + def.label);
        const prev = current[key] as RGBA;
        // Providne pozadine ostaju providne.
        out[key] = color(prev?.a ?? 1, isBg);
        break;
      }
      case 'gradient': {
        const stops = 2 + Math.floor(rand() * 3);
        const g: Gradient = [];
        // Gradijent ide od tamnog ka svijetlom, da mapiranje svjetline ostane čitljivo.
        for (let i = 0; i <= stops; i++) {
          const hue = (baseHue + i * (scheme / stops) + 360) % 360;
          g.push({ pos: i / stops, color: hsvToRgb(hue, 0.4 + rand() * 0.5, 0.12 + (0.88 * i) / stops, 1) });
        }
        out[key] = g;
        break;
      }
      case 'text':
        break;
    }
  }
  return out;
}
