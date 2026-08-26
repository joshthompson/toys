/**
 * Files dropped on the desktop.
 *
 * The rest of the desktop persists through localStorage, but a 5MB file would blow
 * its whole quota in one drop, so file contents live in IndexedDB instead and this
 * module is the only thing that talks to it. Positions stay in localStorage with
 * every other icon's — a file's id is an icon key like any other.
 */

/** The biggest file the desktop will take. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Which app opens the file, and which icon it gets. */
export type FileKind = 'image' | 'audio' | 'video' | 'text' | 'other';

/** A file as it sits in IndexedDB. The blob is the file itself. */
export type StoredFile = {
  id: string;
  name: string;
  /** The browser's MIME type, which for plenty of files is the empty string. */
  type: string;
  size: number;
  /** Drop order, which is also the order the icons come back in. */
  added: number;
  blob: Blob;
};

/** A stored file with the bits the desktop works out for itself. */
export type DesktopFile = StoredFile & {
  kind: FileKind;
  /**
   * A blob: URL for the file, made once when it lands and good until it's thrown
   * away — thumbnails, the picture viewer and any download all point at this.
   */
  url: string;
};

const IMAGE_NAMES = /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i;
const AUDIO_NAMES = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba|wma)$/i;
const VIDEO_NAMES = /\.(mp4|m4v|webm|ogv|mov|avi|mkv|wmv)$/i;
const TEXT_NAMES =
  /\.(txt|text|md|markdown|csv|tsv|log|json|ya?ml|toml|ini|conf|env|css|html?|xml|js|jsx|mjs|cjs|ts|tsx|py|rb|rs|go|sh|zsh|sql|c|h|cpp|java|gitignore)$/i;
/** Text types the browser labels as `application/…` rather than `text/…`. */
const TEXT_TYPES = /^application\/(json|xml|javascript|ecmascript|x-sh|x-yaml|toml)/i;

/**
 * What kind of file this is, by MIME type where there is one and by name where there
 * isn't. Some names could be either — `.ogg` and `.mov` turn up as both — so the type
 * is trusted first and the extension only settles it when the browser said nothing.
 */
export const kindOf = (name: string, type: string): FileKind => {
  if (type.startsWith('image/') || IMAGE_NAMES.test(name)) return 'image';
  if (type.startsWith('audio/') || AUDIO_NAMES.test(name)) return 'audio';
  if (type.startsWith('video/') || VIDEO_NAMES.test(name)) return 'video';
  if (type.startsWith('text/') || TEXT_TYPES.test(type) || TEXT_NAMES.test(name)) return 'text';
  return 'other';
};

/** '4.2 MB' — for the file's own windows, which are the only place the size is shown. */
export const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} bytes`;
  const kb = bytes / 1024;
  return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
};

/** An id that's also this file's icon key, so it must not collide with a toy name. */
export const newFileId = () =>
  `file:${crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;

export const isFileId = (key: string) => key.startsWith('file:');

/** Everything the desktop needs off a stored file to draw and open it. */
export const hydrate = (file: StoredFile): DesktopFile => ({
  ...file,
  kind: kindOf(file.name, file.type),
  url: URL.createObjectURL(file.blob),
});

/**
 * Save a file off the desktop and onto the computer the desktop is pretending to be.
 *
 * The blob: URL is already sitting on the file, so this is a link and a click — built
 * here and thrown away, since nothing on screen needs to be a link. Firefox only
 * follows the click of an anchor that is in the document, hence the visit.
 */
export const downloadFile = (file: DesktopFile) => {
  const link = document.createElement('a');
  link.href = file.url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
};

/* IndexedDB ---------------------------------------------------------------- */

const DB_NAME = 'josh-os-files';
const STORE = 'files';

let connection: Promise<IDBDatabase> | undefined;

const connect = () =>
  (connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));

/** One request in its own transaction, as a promise. */
const request = async <T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  const store = (await connect()).transaction(STORE, mode).objectStore(STORE);
  const req = work(store);
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};

/**
 * Every file that survived the last reload, in the order they were dropped.
 *
 * Storage being unavailable — a private window, a browser with it switched off — is
 * not an error here: the desktop opens with no files and the ones dropped this session
 * still work, they just won't come back.
 */
export const readFiles = async (): Promise<StoredFile[]> => {
  try {
    const all: StoredFile[] = await request('readonly', (s) => s.getAll());
    return all.sort((a, b) => a.added - b.added);
  } catch {
    return [];
  }
};

export const writeFile = async (file: StoredFile) => {
  try {
    await request('readwrite', (s) => s.put(file));
  } catch {
    // In memory is as far as this one gets.
  }
};

export const removeFile = async (id: string) => {
  try {
    await request('readwrite', (s) => s.delete(id));
  } catch {
    // Already unreachable as far as the desktop is concerned.
  }
};

/** Factory reset. */
export const clearFiles = async () => {
  try {
    await request('readwrite', (s) => s.clear());
  } catch {
    // Nothing to do.
  }
};
