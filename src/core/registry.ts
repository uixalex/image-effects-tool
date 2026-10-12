import type { EffectModule } from './types';

const effects = new Map<string, EffectModule>();

export function registerEffect(effect: EffectModule) {
  effects.set(effect.id, effect);
}

export function getEffect(id: string): EffectModule {
  const e = effects.get(id);
  if (!e) throw new Error(`Nepoznat efekat: ${id}`);
  return e;
}

export function allEffects(): EffectModule[] {
  return [...effects.values()];
}
