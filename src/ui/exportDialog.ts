import { ExportCancelled, exportDoc, isMotionFormat, type ExportFormat } from '../core/exporter';
import { audio } from '../core/audio';
import { allEffects } from '../core/registry';
import { outputSize, previewLongSide } from '../core/renderer';
import { isVideo, store } from '../core/state';
import { h, icons, toast } from './dom';

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'png', label: 'PNG' },
  { value: 'jpg', label: 'JPG' },
  { value: 'svg', label: 'SVG' },
  { value: 'mp4', label: 'MP4' },
  { value: 'webm', label: 'WebM' },
  { value: 'gif', label: 'GIF' },
];

const SIDES = [480, 720, 1080, 1440, 2048, 3840];

let last: { format: ExportFormat; fps: Record<string, number>; long: Record<string, number> } = {
  format: 'png',
  fps: { video: 30, gif: 15 },
  long: {},
};

/** Modalni prozor za izvoz. getTime vraća trenutno vrijeme animacije (za slike i SVG). */
export function openExportDialog(getTime: () => number) {
  const doc = store.state;
  const media = doc.media;
  if (!media) return toast('Open an image or video first.');

  let format = last.format;
  let busy = false;
  let cancelled = false;

  const music = audio.track;
  const defaultDuration = isVideo(media) && media.duration && isFinite(media.duration)
    ? Math.round(media.duration * 10) / 10
    : music
      ? Math.min(120, Math.round(music.duration * 10) / 10)
      : doc.timing.mode === 'loop' ? doc.timing.duration : 4;

  const formatBar = h('div', { class: 'segmented full' });
  const resSelect = h('select');
  const quality = h('input', { type: 'range', min: 40, max: 100, step: 1, value: 92 });
  const qualityLabel = h('span', { class: 'num-label' });
  const duration = h('input', { class: 'text-input num', type: 'number', min: 0.5, max: 120, step: 0.5, value: defaultDuration });
  const fpsSelect = h('select');
  const note = h('p', { class: 'section-hint' });
  const progressFill = h('div', { class: 'progress-fill' });
  const progressLabel = h('span', { class: 'progress-label' });
  const progress = h('div', { class: 'progress', hidden: true }, h('div', { class: 'progress-track' }, progressFill), progressLabel);

  const row = (label: string, control: HTMLElement) => h('div', { class: 'ctrl' }, h('label', {}, label), control);
  const qualityRow = row('Quality', h('div', { class: 'range-row' }, quality, qualityLabel));
  const timeRows = h('div', { class: 'export-grid' }, row('Duration (s)', duration), row('FPS', fpsSelect));

  const cancelBtn = h('button', { class: 'btn' }, 'Cancel');
  const goBtn = h('button', { class: 'btn btn-primary', html: `${icons.download}<span>Export</span>` });

  const sheet = h(
    'div',
    { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Export' },
    h('div', { class: 'sheet-head' }, h('h2', {}, 'Export'), h('button', { class: 'icon-btn', title: 'Close', html: icons.close, onclick: () => close() })),
    row('Format', formatBar),
    row('Resolution', resSelect),
    qualityRow,
    timeRows,
    note,
    progress,
    h('div', { class: 'sheet-actions' }, cancelBtn, goBtn),
  );
  const backdrop = h('div', { class: 'backdrop' }, sheet);
  document.body.append(backdrop);

  const key = () => (isMotionFormat(format) ? (format === 'gif' ? 'gif' : 'video') : 'image');

  const sync = () => {
    formatBar.replaceChildren(
      ...FORMATS.map((f) =>
        h('button', {
          class: f.value === format ? 'on' : '',
          onclick: () => {
            if (busy) return;
            format = f.value;
            sync();
          },
        }, f.label),
      ),
    );

    // Rezolucija: kao preview, plus standardne veličine.
    const preview = previewLongSide(media);
    const k = key();
    const fallback = k === 'gif' ? 480 : k === 'video' ? Math.min(1080, preview) : preview;
    const chosen = last.long[k] ?? fallback;
    const sides = [...new Set([preview, ...SIDES])].sort((a, b) => a - b);
    resSelect.replaceChildren(
      ...sides.map((s) => {
        const { w, h: hh } = outputSize(media, doc.format, s);
        return h('option', { value: s, selected: s === chosen }, `${w} × ${hh}${s === preview ? '  (same as preview)' : ''}`);
      }),
    );

    qualityRow.hidden = format !== 'jpg';
    qualityLabel.textContent = `${quality.value}%`;
    timeRows.hidden = !isMotionFormat(format);
    const fpsOptions = format === 'gif' ? [10, 12, 15, 20, 25] : [24, 25, 30, 60];
    const fps = last.fps[format === 'gif' ? 'gif' : 'video'];
    fpsSelect.replaceChildren(...fpsOptions.map((f) => h('option', { value: f, selected: f === fps }, String(f))));

    note.textContent =
      format === 'svg'
        ? `Vector layers (${allEffects().filter((e) => e.vector).map((e) => e.name).join(', ')}) stay vectors. Other layers and the original are embedded as images.`
        : isMotionFormat(format)
          ? music && format !== 'gif'
            ? `Music "${music.name}" is included in the video.`
            : doc.timing.mode === 'loop' && !isVideo(media)
            ? `The loop is ${doc.timing.duration} s. Export the same duration for a seamless loop.`
            : ''
          : 'Exports the current frame.';
    note.hidden = !note.textContent;
  };

  quality.addEventListener('input', () => (qualityLabel.textContent = `${quality.value}%`));
  resSelect.addEventListener('change', () => (last.long[key()] = Number(resSelect.value)));
  fpsSelect.addEventListener('change', () => (last.fps[format === 'gif' ? 'gif' : 'video'] = Number(fpsSelect.value)));

  const close = () => {
    if (busy) {
      cancelled = true;
      return;
    }
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('pointerdown', (e) => e.target === backdrop && !busy && close());
  cancelBtn.addEventListener('click', close);

  goBtn.addEventListener('click', async () => {
    if (busy) return;
    last.format = format;
    busy = true;
    cancelled = false;
    goBtn.disabled = true;
    cancelBtn.textContent = 'Stop';
    progress.hidden = false;
    const setProgress = (f: number) => {
      progressFill.style.width = `${Math.round(f * 100)}%`;
      progressLabel.textContent = isMotionFormat(format) ? `${Math.round(f * 100)}%` : 'Preparing...';
    };
    setProgress(0);
    const wasPlaying = store.playing;
    store.setPlaying(false);
    try {
      const result = await exportDoc(
        doc,
        {
          format,
          long: Number(resSelect.value),
          quality: Number(quality.value) / 100,
          duration: Math.max(0.1, Number(duration.value) || defaultDuration),
          fps: Number(fpsSelect.value),
          time: getTime(),
        },
        { progress: setProgress, cancelled: () => cancelled },
      );
      const a = h('a', { href: URL.createObjectURL(result.blob), download: `${doc.mediaName || 'export'}-effects.${result.ext}` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast(result.note ?? `Exported: ${result.ext.toUpperCase()}`);
      busy = false;
      close();
    } catch (err) {
      busy = false;
      goBtn.disabled = false;
      cancelBtn.textContent = 'Cancel';
      progress.hidden = true;
      if (err instanceof ExportCancelled) toast('Export stopped.');
      else {
        console.error(err);
        toast(`Export failed: ${err instanceof Error ? err.message : err}`);
      }
    } finally {
      // Video je tokom izvoza premotavan; ponovo crtamo preview.
      store.emit('params');
      if (wasPlaying) store.setPlaying(true);
    }
  });

  sync();
}
