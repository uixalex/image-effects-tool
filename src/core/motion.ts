/** Podešavanja animacije jednog sloja. */
export interface LayerMotion {
  on: boolean;
  type: string;
  /** Množilac brzine (1 = jedan ciklus svake 2 sekunde). */
  speed: number;
  /** 0-100 */
  intensity: number;
  /** Reakcija na zvuk: intenzitet se množi jačinom izabranog opsega. */
  audio: AudioBand | 'off';
}

export type AudioBand = 'level' | 'bass' | 'mid' | 'treble';

/** Globalni tajming: loop od X sekundi koji se savršeno ponavlja, ili slobodno vrijeme. */
export interface Timing {
  mode: 'loop' | 'free';
  duration: number;
}

/** Ono što efekat dobija u renderu kad mu je animacija uključena. */
export interface Anim {
  type: string;
  /** 0-1 */
  intensity: number;
  /** Faza u radijanima. U loop modu je cijeli broj ciklusa po loopu, pa se kraj spaja s početkom. */
  phase: number;
  /** Cijeli broj koraka za diskretne promjene (scramble, treptanje). rate je broj promjena u sekundi. */
  step(rate: number): number;
}

/** Bazna frekvencija: pola ciklusa u sekundi. */
const BASE_HZ = 0.5;

export function makeAnim(m: LayerMotion, timing: Timing, t: number): Anim {
  const speed = Math.max(0.05, m.speed);
  if (timing.mode === 'loop') {
    const d = Math.max(0.1, timing.duration);
    const u = (((t % d) + d) % d) / d;
    const cycles = Math.max(1, Math.round(BASE_HZ * speed * d));
    return {
      type: m.type,
      intensity: m.intensity / 100,
      phase: u * cycles * Math.PI * 2,
      step: (rate) => Math.floor(u * Math.max(1, Math.round(rate * speed * d))),
    };
  }
  return {
    type: m.type,
    intensity: m.intensity / 100,
    phase: t * BASE_HZ * speed * Math.PI * 2,
    step: (rate) => Math.floor(t * rate * speed),
  };
}

/** Faktor veličine za tačku (x, y u 0-1) za zajedničke tipove: disanje, talas, šum. */
export function sizeFactor(a: Anim, x: number, y: number, seed: number): number {
  const k = 0.6 * a.intensity;
  switch (a.type) {
    case 'breathe':
      return 1 + k * Math.sin(a.phase);
    case 'wave':
      return 1 + k * Math.sin(a.phase - (x + y) * Math.PI * 4);
    case 'noise':
      return 1 + k * Math.sin(a.phase + seed * Math.PI * 2);
    default:
      return 1;
  }
}

export const SIZE_MOTIONS = [
  { value: 'breathe', label: 'Breathe' },
  { value: 'wave', label: 'Wave' },
  { value: 'noise', label: 'Noise' },
];
