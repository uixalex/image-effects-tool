import { store, type DocState } from './state';

/** Ono što undo vraća. Učitana slika/video nije dio istorije. */
type Snapshot = Pick<DocState, 'layers' | 'activeId' | 'format' | 'showOriginal' | 'timing'>;

const LIMIT = 100;
/** Koliko se čeka poslije zadnje promjene prije nego što postane korak (klizač, kucanje). */
const SETTLE_MS = 350;

const take = (): Snapshot => {
  const { layers, activeId, format, showOriginal, timing } = store.state;
  return structuredClone({ layers, activeId, format, showOriginal, timing });
};

/** JSON za poređenje stanja; rev je samo interni brojač keša. */
const key = (snap: Snapshot) => JSON.stringify(snap, (k, v) => (k === 'rev' ? undefined : v));

let stack: { snap: Snapshot; json: string }[] = [];
let index = -1;
let restoring = false;
let pointerDown = false;
let timer = 0;
let revSeed = 1e6;

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

/** Zapisuje trenutno stanje kao novi korak, ako se razlikuje od zadnjeg. */
function commit() {
  clearTimeout(timer);
  if (restoring) return;
  const snap = take();
  const json = key(snap);
  if (stack[index]?.json === json) return;
  stack = stack.slice(0, index + 1);
  stack.push({ snap, json });
  if (stack.length > LIMIT) stack.shift();
  index = stack.length - 1;
  notify();
}

function schedule() {
  clearTimeout(timer);
  // Dok je miš pritisnut (klizač, četkica, pomjeranje zone) čekamo da se pusti, pa je cijeli pokret jedan korak.
  if (!pointerDown) timer = window.setTimeout(commit, SETTLE_MS);
}

function restore(i: number) {
  if (i < 0 || i >= stack.length || i === index) return;
  index = i;
  const snap = structuredClone(stack[i].snap);
  const formatChanged = snap.format !== store.state.format;
  restoring = true;
  Object.assign(store.state, snap);
  // Nove revizije maski, da renderer ne koristi stari keš maske.
  for (const l of store.state.layers) l.mask.rev = ++revSeed;
  store.selectedZone = null;
  if (formatChanged) store.emit('source');
  store.emit('layers');
  store.emit('active');
  store.emit('mask');
  store.emit('anim');
  restoring = false;
  notify();
}

export const history = {
  undo: () => {
    // Nezapisana promjena (npr. upravo pomjeren klizač) prvo postaje korak, pa se tek onda vraća.
    commit();
    restore(index - 1);
  },
  redo: () => {
    commit();
    restore(index + 1);
  },
  canUndo: () => index > 0 || (index === 0 && key(take()) !== stack[0].json),
  canRedo: () => index < stack.length - 1,
  onChange: (fn: () => void) => listeners.add(fn),
};

export function initHistory() {
  stack = [{ snap: take(), json: key(take()) }];
  index = 0;
  store.on((topic) => {
    if (restoring || topic === 'tool') return;
    schedule();
  });
  window.addEventListener('pointerdown', () => {
    pointerDown = true;
    clearTimeout(timer);
  }, true);
  window.addEventListener('pointerup', () => {
    pointerDown = false;
    schedule();
  }, true);
}
