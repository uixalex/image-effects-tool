import { audio } from './audio';
import { isVideo, store, type DocState } from './state';

/** Projekat je jedan JSON fajl: podešavanja + slika/video + zvuk (kao data URL), da radi i na drugom računaru. */
const FORMAT = 'image-effects-tool/project';
export const PROJECT_EXT = 'fxproj';

type SavedDoc = Pick<DocState, 'layers' | 'activeId' | 'format' | 'showOriginal' | 'timing'>;

interface SavedFile {
  name: string;
  type: string;
  data: string;
}

interface ProjectFile {
  format: typeof FORMAT;
  version: 1;
  doc: SavedDoc;
  media: SavedFile | null;
  audio: SavedFile | null;
}

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });

async function pack(url: string, name: string): Promise<SavedFile> {
  const blob = await (await fetch(url)).blob();
  return { name, type: blob.type, data: await toDataUrl(blob) };
}

export async function saveProject(): Promise<Blob> {
  const { layers, activeId, format, showOriginal, timing, media, mediaName } = store.state;
  const ext = media ? (isVideo(media) ? 'video' : 'image') : '';
  const project: ProjectFile = {
    format: FORMAT,
    version: 1,
    doc: structuredClone({ layers, activeId, format, showOriginal, timing }),
    media: media ? await pack(media.src, `${mediaName || ext}`) : null,
    audio: audio.track ? await pack(audio.track.el.src, audio.track.name) : null,
  };
  return new Blob([JSON.stringify(project)], { type: 'application/json' });
}

const unpack = async (f: SavedFile) => new File([await (await fetch(f.data)).blob()], f.name, { type: f.type });

export async function readProject(file: File): Promise<{ doc: SavedDoc; media: File | null; audio: File | null }> {
  let project: ProjectFile;
  try {
    project = JSON.parse(await file.text());
  } catch {
    throw new Error('This is not a project file.');
  }
  if (project?.format !== FORMAT) throw new Error('This is not a project file.');
  return {
    doc: project.doc,
    media: project.media ? await unpack(project.media) : null,
    audio: project.audio ? await unpack(project.audio) : null,
  };
}

export const isProjectFile = (f: File) => f.name.toLowerCase().endsWith(`.${PROJECT_EXT}`);
