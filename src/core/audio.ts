import type { AudioBand } from './motion';

export const SAMPLE_RATE = 48000;
/** Koliko puta u sekundi mjerimo jačinu zvuka. */
const ENV_RATE = 60;

export interface AudioTrack {
  name: string;
  el: HTMLAudioElement;
  /** Dekodiran zvuk na 48 kHz (za izvoz u video). */
  buffer: AudioBuffer;
  duration: number;
  env: Record<AudioBand, Float32Array>;
}

let track: AudioTrack | null = null;
const listeners = new Set<() => void>();

export const audio = {
  get track() {
    return track;
  },
  onChange(fn: () => void) {
    listeners.add(fn);
  },
  set(t: AudioTrack | null) {
    if (track) {
      track.el.pause();
      URL.revokeObjectURL(track.el.src);
    }
    track = t;
    listeners.forEach((fn) => fn());
  },
};

/** Jačina opsega (0-1) u trenutku t. Zvuk se ponavlja ako je t duže od pjesme. */
export function audioLevel(band: AudioBand, t: number): number {
  if (!track) return 0;
  const env = track.env[band];
  const i = Math.floor((((t % track.duration) + track.duration) % track.duration) * ENV_RATE);
  return env[Math.min(env.length - 1, Math.max(0, i))];
}

const FILTERS: Record<AudioBand, { type: BiquadFilterType; freq: number } | null> = {
  level: null,
  bass: { type: 'lowpass', freq: 150 },
  mid: { type: 'bandpass', freq: 1000 },
  treble: { type: 'highpass', freq: 4000 },
};

async function envelope(buffer: AudioBuffer, band: AudioBand): Promise<Float32Array> {
  // Filtriramo cijelu pjesmu offline, pa mjerimo RMS u kratkim prozorima.
  const ctx = new OfflineAudioContext(1, buffer.length, buffer.sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const f = FILTERS[band];
  if (f) {
    const biquad = ctx.createBiquadFilter();
    biquad.type = f.type;
    biquad.frequency.value = f.freq;
    biquad.Q.value = 0.8;
    src.connect(biquad).connect(ctx.destination);
  } else src.connect(ctx.destination);
  src.start();
  const data = (await ctx.startRendering()).getChannelData(0);

  const win = Math.floor(buffer.sampleRate / ENV_RATE);
  const n = Math.ceil(data.length / win);
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const end = Math.min(data.length, (i + 1) * win);
    for (let j = i * win; j < end; j++) s += data[j] * data[j];
    env[i] = Math.sqrt(s / Math.max(1, end - i * win));
  }
  // Normalizacija na glasne dijelove pjesme, pa brz udar i sporije opadanje (kao VU metar).
  const sorted = [...env].sort((a, b) => a - b);
  const peak = sorted[Math.floor(sorted.length * 0.97)] || 1;
  let v = 0;
  for (let i = 0; i < n; i++) {
    const x = Math.min(1, env[i] / peak);
    v = x > v ? x : v + (x - v) * 0.15;
    env[i] = v;
  }
  return env;
}

export async function loadAudio(file: File): Promise<AudioTrack> {
  const bytes = await file.arrayBuffer();
  const buffer = await new OfflineAudioContext(2, SAMPLE_RATE, SAMPLE_RATE).decodeAudioData(bytes);
  const [level, bass, mid, treble] = await Promise.all((['level', 'bass', 'mid', 'treble'] as const).map((b) => envelope(buffer, b)));
  const el = new Audio(URL.createObjectURL(file));
  el.loop = true;
  el.preload = 'auto';
  return { name: file.name.replace(/\.[^.]+$/, ''), el, buffer, duration: buffer.duration, env: { level, bass, mid, treble } };
}
