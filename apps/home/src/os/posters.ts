/**
 * First frames.
 *
 * A dropped video gets its own opening frame for an icon, which means decoding one out
 * of a file the browser has only ever seen as a blob. That happens once per file, off
 * screen, and what comes back is kept here as a small data: URL. Icons read it through
 * a signal, so a video starts out as the film-reel glyph and turns into a still the
 * moment there is one — and files the browser has no decoder for simply never do.
 */
import { createSignal } from 'solid-js';
import type { DesktopFile } from './files';

/** The longest side of a kept frame, in px. An icon is 52px, so this is plenty. */
const POSTER_SIZE = 128;

/** How long a file gets to produce a frame before it's given up on. */
const GIVE_UP_AFTER = 8000;

/** Where in the film the still is taken from — see `grab`. */
const POSTER_AT = 0.2;

const [posters, setPosters] = createSignal<Record<string, string>>({});
/** Every file already asked about, decoded or not: nothing is attempted twice. */
const asked = new Set<string>();

/** Whatever frame the video is showing, shrunk, as a data: URL. */
const still = (video: HTMLVideoElement) => {
  const { videoWidth: width, videoHeight: height } = video;
  if (!width || !height) return null;
  const canvas = document.createElement('canvas');
  const scale = Math.min(POSTER_SIZE / Math.max(width, height), 1);
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  try {
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch {
    // A canvas the browser has decided is tainted won't give its pixels back.
    return null;
  }
};

/**
 * Take a still out of a video file. The element never joins the document — it exists to
 * decode and is dropped as soon as it has. The frame comes from a fraction of a second
 * in rather than from zero: films that open on black are common, and frame zero is also
 * the one a browser is least dependable about having ready.
 */
const grab = (file: DesktopFile) => {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = file.url;

  let settled = false;
  const finish = (poster: string | null) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    // Stop it buffering the rest of a film nobody is watching.
    video.removeAttribute('src');
    video.load();
    if (poster) setPosters((all) => ({ ...all, [file.id]: poster }));
  };

  const timer = setTimeout(() => finish(null), GIVE_UP_AFTER);

  video.addEventListener('loadeddata', () => {
    // Never past the end of a clip shorter than the seek itself. A seek of nowhere
    // fires no `seeked` event, so a clip that short is drawn where it already stands.
    const at = Math.min(POSTER_AT, (video.duration || 0) / 2);
    if (at > 0) video.currentTime = at;
    else finish(still(video));
  });
  video.addEventListener('seeked', () => finish(still(video)));
  video.addEventListener('error', () => finish(null));
};

/**
 * This video's first frame, once there is one. Reading it is what asks for it: the
 * first icon to draw a video sets the decode going, and every icon of that file redraws
 * when the frame lands. Anything that isn't a video has no frame to take.
 */
export const posterFor = (file: DesktopFile) => {
  if (file.kind !== 'video') return undefined;
  if (!asked.has(file.id)) {
    asked.add(file.id);
    // Out of whatever render is reading this, so no signal is set mid-render.
    queueMicrotask(() => grab(file));
  }
  return posters()[file.id];
};

/** Let a destroyed file's frame go with it. */
export const forgetPoster = (id: string) => {
  asked.delete(id);
  setPosters((all) => {
    if (!(id in all)) return all;
    const rest = { ...all };
    delete rest[id];
    return rest;
  });
};
