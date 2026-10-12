import './styles.css';
import './effects';
import { audio, loadAudio } from './core/audio';
import { setFontLoadedHandler } from './core/fonts';
import { isProjectFile, PROJECT_EXT, readProject, saveProject } from './core/project';
import { history, initHistory } from './core/history';
import { Renderer } from './core/renderer';
import { FORMATS, isVideo, store, type FormatId, type Media } from './core/state';
import { controlsPanel } from './ui/controls';
import { h, icons, toast } from './ui/dom';
import { openExportDialog } from './ui/exportDialog';
import { layersPanel } from './ui/layers';
import { maskTools } from './ui/maskTools';
import { isTyping, Viewport } from './ui/viewport';

const renderer = new Renderer();

// ---------- Vrijeme i render ----------
/** Vrijeme animacije u sekundama. */
let time = 0;
let lastTick = 0;
let looping = false;

function draw() {
  if (isVideo(store.state.media)) renderer.drawFrame();
  renderer.render(store.state, time);
  timeLabel.textContent = `${time.toFixed(1)} s`;
}

let frame = 0;
function scheduleRender() {
  if (frame || store.playing) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    draw();
  });
}

function loop(now: number) {
  if (!store.playing) {
    looping = false;
    return;
  }
  const track = audio.track;
  if (track && !track.el.paused) {
    // Sa muzikom vrijeme prati pjesmu, da animacija i zvuk budu usklađeni.
    time = track.el.currentTime;
  } else {
    time += Math.min(0.1, (now - lastTick) / 1000);
    const { mode, duration } = store.state.timing;
    if (mode === 'loop') time %= Math.max(0.1, duration);
  }
  lastTick = now;
  draw();
  requestAnimationFrame(loop);
}

// ---------- Input ----------
const fileInput = h('input', { type: 'file', accept: `image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime,.mov,.${PROJECT_EXT}`, hidden: true });
const openFile = () => fileInput.click();

function loadVideo(url: string) {
  return new Promise<HTMLVideoElement>((resolve, reject) => {
    const v = h('video', { muted: true, loop: true, playsInline: true, preload: 'auto' });
    v.addEventListener('loadeddata', () => resolve(v), { once: true });
    v.addEventListener('error', () => reject(new Error('video')), { once: true });
    v.src = url;
  });
}

const isAudioFile = (f: File) => f.type.startsWith('audio/') || /.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f.name);

async function loadFile(file: File): Promise<void> {
  if (isProjectFile(file)) return openProject(file);
  if (isAudioFile(file)) return loadMusic(file);
  const video = file.type.startsWith('video/') || /\.(mov|mp4|webm)$/i.test(file.name);
  if (!video && !file.type.startsWith('image/')) return toast('Supported: images (PNG, JPG, WEBP) and video (MP4, WebM, MOV).');
  const url = URL.createObjectURL(file);
  let media: Media;
  try {
    if (video) media = await loadVideo(url);
    else {
      const img = new Image();
      img.src = url;
      await img.decode();
      media = img;
    }
  } catch {
    URL.revokeObjectURL(url);
    return toast(video ? "This browser can't play this video format." : "The image couldn't be loaded.");
  }
  const old = store.state.media;
  if (old) {
    if (isVideo(old)) old.pause();
    URL.revokeObjectURL(old.src);
  }
  store.state.media = media;
  store.state.mediaName = file.name.replace(/\.[^.]+$/, '');
  store.emit('source');
  if (isVideo(media)) store.setPlaying(true);
}

fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  if (f) loadFile(f);
  fileInput.value = '';
});

window.addEventListener('dragover', (e) => {
  e.preventDefault();
  document.body.classList.add('dropping');
});
window.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) document.body.classList.remove('dropping');
});
window.addEventListener('drop', (e) => {
  document.body.classList.remove('dropping');
  const f = e.dataTransfer?.files?.[0];
  if (!f) return;
  e.preventDefault();
  loadFile(f);
});

// ---------- Projekat ----------
async function openProject(file: File) {
  try {
    const project = await readProject(file);
    if (project.media) await loadFile(project.media);
    if (project.audio) await loadMusic(project.audio);
    store.loadDoc(project.doc);
    toast('Project opened.');
  } catch (err) {
    toast(err instanceof Error ? err.message : "The project couldn't be opened.");
  }
}

async function downloadProject() {
  if (!store.state.media && !store.state.layers.length) return toast('Nothing to save yet.');
  const blob = await saveProject();
  const a = h('a', { href: URL.createObjectURL(blob), download: `${store.state.mediaName || 'project'}.${PROJECT_EXT}` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Project saved. Open it again with the Open button.');
}

// ---------- Muzika ----------
const audioInput = h('input', { type: 'file', accept: 'audio/*,.mp3,.wav,.m4a,.ogg,.flac', hidden: true });
audioInput.addEventListener('change', () => {
  const f = audioInput.files?.[0];
  if (f) loadMusic(f);
  audioInput.value = '';
});

async function loadMusic(file: File) {
  toast('Analyzing music...');
  try {
    audio.set(await loadAudio(file));
    toast('Music loaded. Set "React to audio" in a layer\x27s Animation section.');
    if (store.playing) audio.track!.el.play().catch(() => {});
  } catch {
    toast("This audio file couldn't be read.");
  }
}

// ---------- Gornja traka ----------
const formatBar = h(
  'div',
  { class: 'segmented' },
  ...FORMATS.map((f) =>
    h('button', {
      class: f.value === store.state.format ? 'on' : '',
      'data-format': f.value,
      onclick: () => {
        store.state.format = f.value as FormatId;
        formatBar.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.format === f.value));
        store.emit('source');
      },
    }, f.label),
  ),
);

const sizeLabel = h('span', { class: 'size-label' });
const undoBtn = h('button', { class: 'icon-btn', title: 'Undo (Ctrl+Z)', html: icons.undo, onclick: () => history.undo() });
const redoBtn = h('button', { class: 'icon-btn', title: 'Redo (Ctrl+Shift+Z)', html: icons.redo, onclick: () => history.redo() });

const topbar = h(
  'header',
  { class: 'topbar' },
  h(
    'div',
    { class: 'topbar-side' },
    h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }), h('span', {}, 'Image Effects')),
    h('button', { class: 'btn btn-ghost', onclick: openFile, html: `${icons.upload}<span>Open</span>` }),
    h('button', { class: 'btn btn-ghost', onclick: downloadProject, title: 'Save the whole project (layers, masks, media) as a file', html: `${icons.save}<span>Save</span>` }),
    h('div', { class: 'undo-group' }, undoBtn, redoBtn),
  ),
  h('div', { class: 'topbar-center' }, formatBar, sizeLabel),
  h('div', { class: 'topbar-side end' }, h('button', { class: 'btn btn-primary', onclick: () => openExportDialog(() => time), html: `${icons.download}<span>Export</span>` })),
);

// ---------- Raspored ----------
const left = h('aside', { class: 'panel panel-left' });
const right = h('aside', { class: 'panel panel-right' });
const viewport = new Viewport(renderer, openFile);

// Platno ide preko cijele površine, a paneli lebde iznad njega.
document.getElementById('app')!.append(topbar, h('main', { class: 'workspace' }, viewport.el, left, right), fileInput, audioInput);
viewport.setInsets(() => ({ left: left.offsetLeft + left.offsetWidth, right: viewport.el.clientWidth - right.offsetLeft }));

layersPanel(left);
controlsPanel(right);
maskTools(viewport, renderer);

// ---------- Transport (play/pause, loop) u donjoj traci ----------
const playBtn = h('button', { class: 'icon-btn play-btn', title: 'Play (P)', html: icons.play, onclick: () => store.setPlaying(!store.playing) });
const timeLabel = h('span', { class: 'time-label' }, '0.0 s');
const modeBar = h('div', { class: 'segmented mini' });
const durationInput = h('input', { class: 'num-input duration', type: 'number', min: 0.5, max: 60, step: 0.5, value: store.state.timing.duration, title: 'Loop length in seconds' });
const durationWrap = h('div', { class: 'num-wrap' }, durationInput, h('span', { class: 'unit' }, 's'));
const musicBtn = h('button', { class: 'icon-btn', title: 'Add music (audio-reactive)', html: icons.music, onclick: () => audioInput.click() });
const musicChip = h('span', { class: 'music-chip', hidden: true });
const compareBtn = h('button', {
  class: 'icon-btn',
  title: 'Before / After (C)',
  html: icons.compare,
  onclick: () => toggleCompare(),
});
const toggleCompare = () => {
  viewport.setCompare(!viewport.comparing);
  compareBtn.classList.toggle('on', viewport.comparing);
};
viewport.bar.prepend(playBtn, timeLabel, h('span', { class: 'bar-sep' }), modeBar, durationWrap, h('span', { class: 'bar-sep' }), musicBtn, musicChip, compareBtn, h('span', { class: 'bar-sep' }));

audio.onChange(() => {
  const t = audio.track;
  musicBtn.classList.toggle('on', !!t);
  musicChip.hidden = !t;
  musicChip.replaceChildren();
  if (t) {
    musicChip.append(
      h('span', { class: 'music-name', title: t.name }, t.name),
      h('button', { class: 'music-remove', title: 'Remove music', html: icons.close, onclick: () => audio.set(null) }),
    );
  }
  scheduleRender();
});

window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey && !isTyping(e)) toggleCompare();
});

// Interakcija mišem: novi kadar kad se kursor pomjeri (dok animacija ne radi, petlja to već radi sama).
viewport.onPointer = () => {
  if (store.state.layers.some((l) => l.visible && l.interact.mode !== 'off')) scheduleRender();
};

const syncTransport = () => {
  playBtn.innerHTML = store.playing ? icons.pause : icons.play;
  playBtn.title = store.playing ? 'Pause (P)' : 'Play (P)';
  playBtn.classList.toggle('on', store.playing);
  const { mode } = store.state.timing;
  modeBar.replaceChildren(
    ...([['loop', 'Loop'], ['free', 'Free']] as const).map(([m, label]) =>
      h('button', {
        class: m === mode ? 'on' : '',
        title: m === 'loop' ? 'Plays for the set number of seconds and loops seamlessly' : 'Runs endlessly',
        onclick: () => {
          store.state.timing.mode = m;
          store.emit('anim');
        },
      }, label),
    ),
  );
  durationWrap.hidden = mode !== 'loop';
};

durationInput.addEventListener('change', () => {
  const v = Math.min(60, Math.max(0.5, Number(durationInput.value) || 4));
  durationInput.value = String(v);
  store.state.timing.duration = v;
  store.emit('anim');
});

window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'p' && !isTyping(e) && !e.metaKey && !e.ctrlKey) store.setPlaying(!store.playing);
});

// ---------- Undo / Redo ----------
initHistory();
const syncHistory = () => {
  undoBtn.disabled = !history.canUndo();
  redoBtn.disabled = !history.canRedo();
};
history.onChange(syncHistory);
syncHistory();

window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || isTyping(e)) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) history.undo();
  else if ((k === 'z' && e.shiftKey) || k === 'y') history.redo();
  else return;
  e.preventDefault();
});

// ---------- Reakcije na promjene ----------
store.on((topic) => {
  if (topic === 'source') {
    renderer.setSource(store.state.media, store.state.format);
    viewport.setHasImage(!!store.state.media);
    sizeLabel.textContent = store.state.media ? `${renderer.width} × ${renderer.height}` : '';
    viewport.fit();
  }
  if (topic === 'anim') {
    syncTransport();
    const media = store.state.media;
    if (store.playing) {
      if (isVideo(media)) media.play().catch(() => {});
      audio.track?.el.play().catch(() => {});
      if (!looping) {
        looping = true;
        lastTick = performance.now();
        requestAnimationFrame(loop);
      }
    } else {
      if (isVideo(media)) media.pause();
      audio.track?.el.pause();
    }
  }
  scheduleRender();
});

setFontLoadedHandler(() => {
  renderer.invalidateAll();
  scheduleRender();
});

viewport.setHasImage(false);
syncTransport();
