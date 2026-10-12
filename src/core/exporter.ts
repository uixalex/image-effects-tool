import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from 'mp4-muxer';
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from 'webm-muxer';
import { audio, SAMPLE_RATE } from './audio';
import { getEffect } from './registry';
import { Renderer } from './renderer';
import { isVideo, type DocState } from './state';
import { SvgContext } from './svgContext';

export type ExportFormat = 'png' | 'jpg' | 'svg' | 'mp4' | 'webm' | 'gif';

export const isMotionFormat = (f: ExportFormat) => f === 'mp4' || f === 'webm' || f === 'gif';

export interface ExportOptions {
  format: ExportFormat;
  /** Duža stranica izlaza u pikselima. */
  long: number;
  /** JPG kvalitet 0-1. */
  quality: number;
  /** Trajanje u sekundama (video i GIF). */
  duration: number;
  fps: number;
  /** Trenutak animacije za slike i SVG. */
  time: number;
}

export interface ExportResult {
  blob: Blob;
  ext: string;
  /** Napomena za korisnika (npr. kad je korišten rezervni enkoder). */
  note?: string;
}

export class ExportCancelled extends Error {}

interface Job {
  progress: (fraction: number) => void;
  cancelled: () => boolean;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Izvoz koristi zaseban renderer u traženoj rezoluciji, pa preview ostaje netaknut. */
export async function exportDoc(doc: DocState, opts: ExportOptions, job: Job): Promise<ExportResult> {
  if (!doc.media) throw new Error('No source');
  const r = new Renderer();
  r.setSource(doc.media, doc.format, opts.long);

  if (opts.format === 'png' || opts.format === 'jpg') {
    r.render(doc, opts.time);
    const type = opts.format === 'png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob | null>((res) => r.out.toBlob(res, type, opts.quality));
    if (!blob) throw new Error("Couldn't create the image");
    return { blob, ext: opts.format };
  }
  if (opts.format === 'svg') {
    return { blob: new Blob([buildSvg(doc, r, opts.time)], { type: 'image/svg+xml' }), ext: 'svg' };
  }
  if (opts.format === 'gif') return encodeGif(doc, r, opts, job);
  return encodeVideo(doc, r, opts, job);
}

/** Prolazi kroz sve frameove: za video izvor traži odgovarajući frame, pa renderuje. */
async function forEachFrame(doc: DocState, r: Renderer, opts: ExportOptions, job: Job, consume: (i: number) => Promise<void> | void) {
  const frames = Math.max(1, Math.round(opts.duration * opts.fps));
  const video = isVideo(doc.media) ? doc.media : null;
  const wasPlaying = video && !video.paused;
  video?.pause();
  try {
    for (let i = 0; i < frames; i++) {
      if (job.cancelled()) throw new ExportCancelled();
      const t = i / opts.fps;
      if (video) {
        await seek(video, t % (video.duration || 1));
        r.drawFrame();
      }
      r.render(doc, t);
      await consume(i);
      job.progress((i + 1) / frames);
      await tick();
    }
  } finally {
    if (wasPlaying) video!.play();
  }
  return frames;
}

function seek(video: HTMLVideoElement, t: number) {
  return new Promise<void>((resolve) => {
    if (Math.abs(video.currentTime - t) < 1e-4 && video.readyState >= 2) return resolve();
    video.addEventListener('seeked', () => resolve(), { once: true });
    video.currentTime = t;
  });
}

const MP4_CODECS = ['avc1.640034', 'avc1.640033', 'avc1.4d0034', 'avc1.640028', 'avc1.42001f'];
const WEBM_CODECS: [string, 'V_VP9' | 'V_VP8'][] = [
  ['vp09.00.41.08', 'V_VP9'],
  ['vp09.00.10.08', 'V_VP9'],
  ['vp8', 'V_VP8'],
];

async function pickCodec(codecs: string[], width: number, height: number, bitrate: number, framerate: number) {
  if (typeof VideoEncoder === 'undefined') return null;
  for (const codec of codecs) {
    try {
      const { supported } = await VideoEncoder.isConfigSupported({ codec, width, height, bitrate, framerate });
      if (supported) return codec;
    } catch {
      /* sljedeći */
    }
  }
  return null;
}

async function encodeVideo(doc: DocState, r: Renderer, opts: ExportOptions, job: Job): Promise<ExportResult> {
  const { width, height } = r.out;
  const fps = opts.fps;
  const bitrate = Math.min(40e6, Math.round(width * height * fps * 0.15));
  const isMp4 = opts.format === 'mp4';
  const codec = await pickCodec(isMp4 ? MP4_CODECS : WEBM_CODECS.map((c) => c[0]), width, height, bitrate, fps);
  if (!codec) return recordFallback(doc, r, opts, job, bitrate);

  const sound = await encodeAudio(opts.duration);
  const audioCfg = sound ? { numberOfChannels: sound.channels, sampleRate: SAMPLE_RATE } : null;
  const mp4 = isMp4
    ? new Mp4Muxer({
        target: new Mp4Target(),
        video: { codec: 'avc', width, height, frameRate: fps },
        audio: audioCfg ? { codec: 'opus', ...audioCfg } : undefined,
        fastStart: 'in-memory',
      })
    : null;
  const webm = isMp4
    ? null
    : new WebmMuxer({
        target: new WebmTarget(),
        video: { codec: WEBM_CODECS.find((c) => c[0] === codec)![1], width, height, frameRate: fps },
        audio: audioCfg ? { codec: 'A_OPUS', ...audioCfg } : undefined,
      });

  // Chunkove skupljamo pa ih dodajemo poredane po vremenu, da su video i audio pravilno isprepleteni.
  const videoChunks: [EncodedVideoChunk, EncodedVideoChunkMetadata | undefined][] = [];
  let failure: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => videoChunks.push([chunk, meta]),
    error: (e) => (failure = e),
  });
  encoder.configure({ codec, width, height, bitrate, framerate: fps });

  try {
    await forEachFrame(doc, r, opts, job, async (i) => {
      if (failure) throw failure;
      const frame = new VideoFrame(r.out, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 4) await new Promise((res) => setTimeout(res, 2));
    });
    await encoder.flush();
    if (failure) throw failure;
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }

  const audioChunks = sound?.chunks ?? [];
  let a = 0;
  for (const [chunk, meta] of videoChunks) {
    while (a < audioChunks.length && audioChunks[a][0].timestamp <= chunk.timestamp) {
      const [ac, am] = audioChunks[a++];
      if (mp4) mp4.addAudioChunk(ac, am);
      else webm!.addAudioChunk(ac, am);
    }
    if (mp4) mp4.addVideoChunk(chunk, meta);
    else webm!.addVideoChunk(chunk, meta);
  }
  for (; a < audioChunks.length; a++) {
    if (mp4) mp4.addAudioChunk(audioChunks[a][0], audioChunks[a][1]);
    else webm!.addAudioChunk(audioChunks[a][0], audioChunks[a][1]);
  }

  const note = audio.track && !sound ? "This browser can't encode audio, the video was exported without sound." : undefined;
  if (mp4) {
    mp4.finalize();
    return { blob: new Blob([mp4.target.buffer], { type: 'video/mp4' }), ext: 'mp4', note };
  }
  webm!.finalize();
  return { blob: new Blob([webm!.target.buffer], { type: 'video/webm' }), ext: 'webm', note };
}

/** Kodira učitani zvuk (Opus) za trajanje videa; kraći zvuk se ponavlja. Vraća null ako zvuka nema ili ga browser ne može kodirati. */
async function encodeAudio(duration: number) {
  const track = audio.track;
  if (!track || typeof AudioEncoder === 'undefined') return null;
  const channels = Math.min(2, track.buffer.numberOfChannels);
  const config: AudioEncoderConfig = { codec: 'opus', sampleRate: SAMPLE_RATE, numberOfChannels: channels, bitrate: 160_000 };
  try {
    if (!(await AudioEncoder.isConfigSupported(config)).supported) return null;
  } catch {
    return null;
  }
  const chunks: [EncodedAudioChunk, EncodedAudioChunkMetadata | undefined][] = [];
  let failure: unknown = null;
  const enc = new AudioEncoder({ output: (c, m) => chunks.push([c, m]), error: (e) => (failure = e) });
  enc.configure(config);
  const src = Array.from({ length: channels }, (_, c) => track.buffer.getChannelData(c));
  const total = Math.round(duration * SAMPLE_RATE);
  const block = 4800;
  for (let start = 0; start < total; start += block) {
    const frames = Math.min(block, total - start);
    const data = new Float32Array(frames * channels);
    for (let c = 0; c < channels; c++) {
      for (let i = 0; i < frames; i++) data[c * frames + i] = src[c][(start + i) % src[c].length];
    }
    const ad = new AudioData({ format: 'f32-planar', sampleRate: SAMPLE_RATE, numberOfFrames: frames, numberOfChannels: channels, timestamp: Math.round((start / SAMPLE_RATE) * 1e6), data });
    enc.encode(ad);
    ad.close();
  }
  await enc.flush();
  enc.close();
  if (failure) return null;
  return { channels, chunks };
}

/** Rezerva kad browser nema WebCodecs: snima canvas u realnom vremenu preko MediaRecordera. */
async function recordFallback(doc: DocState, r: Renderer, opts: ExportOptions, job: Job, bitrate: number): Promise<ExportResult> {
  const wanted = opts.format === 'mp4' ? ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'] : ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'];
  const mime = wanted.find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) throw new Error("This browser can't record video.");
  const stream = r.out.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((res) => (rec.onstop = res));
  rec.start();
  try {
    await forEachFrame(doc, r, opts, job, async () => {
      track.requestFrame();
      await new Promise((res) => setTimeout(res, 1000 / opts.fps));
    });
  } finally {
    rec.stop();
    await stopped;
  }
  const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
  return {
    blob: new Blob(chunks, { type: mime.split(';')[0] }),
    ext,
    note: ext !== opts.format ? `This browser can't encode ${opts.format.toUpperCase()}, exported as ${ext.toUpperCase()}.` : 'Used the slower real-time recording method.',
  };
}

async function encodeGif(doc: DocState, r: Renderer, opts: ExportOptions, job: Job): Promise<ExportResult> {
  const { width, height } = r.out;
  const ctx = r.out.getContext('2d', { willReadFrequently: true })!;
  const gif = GIFEncoder();
  const delay = Math.round(1000 / opts.fps);
  await forEachFrame(doc, r, opts, job, () => {
    const data = ctx.getImageData(0, 0, width, height).data;
    const palette = quantize(data, 256, { format: 'rgb565' });
    const index = applyPalette(data, palette, 'rgb565');
    gif.writeFrame(index, width, height, { palette, delay });
  });
  gif.finish();
  return { blob: new Blob([gif.bytes() as Uint8Array<ArrayBuffer>], { type: 'image/gif' }), ext: 'gif' };
}

const CSS_BLEND: Partial<Record<GlobalCompositeOperation, string>> = { 'source-over': 'normal' };

/** SVG: vektorski slojevi ostaju vektori, ostalo (original, Gradient Map) se ugrađuje kao slika. Maske idu kao SVG mask. */
function buildSvg(doc: DocState, r: Renderer, time: number): string {
  r.render(doc, time);
  const { width: w, height: h } = r.out;
  const defs: string[] = [];
  const body: string[] = [`<rect width="${w}" height="${h}" fill="#000"/>`];
  const image = (c: HTMLCanvasElement) => `<image width="${w}" height="${h}" href="${c.toDataURL('image/png')}"/>`;

  if (doc.showOriginal) body.push(image(r.sourceCanvas));

  doc.layers.forEach((layer, i) => {
    if (!layer.visible || layer.opacity <= 0) return;
    const effect = getEffect(layer.effectId);
    let content: string;
    if (effect.vector) {
      const svg = new SvgContext();
      const { input, params } = r.layerInput(doc, layer, time);
      effect.render(input, params, svg as unknown as CanvasRenderingContext2D);
      content = svg.toString();
    } else {
      content = image(r.effectCanvas(doc, layer));
    }
    const mask = r.maskCanvas(layer);
    let attrs = '';
    if (mask) {
      defs.push(`<mask id="m${i}" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}">${image(mask)}</mask>`);
      attrs += ` mask="url(#m${i})"`;
    }
    if (layer.opacity < 1) attrs += ` opacity="${layer.opacity}"`;
    const blend = CSS_BLEND[layer.blend] ?? layer.blend;
    if (blend !== 'normal') attrs += ` style="mix-blend-mode:${blend}"`;
    body.push(`<g id="${layer.name.replace(/[^\w-]+/g, '_')}"${attrs}>\n${content}\n</g>`);
  });

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    defs.length ? `<defs>${defs.join('')}</defs>` : '',
    ...body,
    '</svg>',
  ].join('\n');
}
