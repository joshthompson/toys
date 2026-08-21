/**
 * Shared shell constants and types.
 *
 * These live here rather than in App.tsx because App imports the window panes and
 * the panes need these values — importing them back from App would form a cycle,
 * and any pane reading one at module-eval time (a `const` array of swatches, say)
 * would hit the temporal dead zone and blow up at boot.
 */
import type { DesktopFile, FileKind } from './files';
import type { Toy } from './toys';

export const BIN_KEY = '__bin__';
export const BIN_GLYPH = '🗑️';
/**
 * The icon a dropped file gets, by kind. Pictures are the exception — they're drawn as
 * their own thumbnail, so they never reach this.
 */
export const glyphFor = (kind: FileKind) =>
  ({ image: '🖼️', audio: '🎵', video: '🎬', text: '📝', other: '📄' })[kind];

/**
 * The apps that open a dropped file. Named here because both the desktop and the app
 * itself build window titles out of them, and a media window renames itself as you
 * step through the desktop's other files of the same kind.
 */
export const IMAGE_APP = "Josh's Image Looking App";
export const WRITING_APP = "Josh's Computer Writing App";
export const AUDIO_APP = "Josh's Listening To Stuff App";
export const VIDEO_APP = "Josh's Video Playback App";
export const DEFAULT_DESKTOP = '#3c8585';
export const TASKBAR_HEIGHT = 40;

/** How big the desktop icons are drawn. */
export type IconSize = 'small' | 'medium' | 'large';

export const DEFAULT_ICON_SIZE: IconSize = 'medium';

/**
 * Geometry per icon size. `slot` is the whole icon — the box the layout grid, the
 * drag clamps and the marquee hit tests all work in — and `art` is the square tile
 * inside it. The CSS reads all three off custom properties on the desktop.
 */
export const ICON_METRICS: Record<IconSize, { slot: { w: number; h: number }; art: number; label: number }> = {
  small: { slot: { w: 72, h: 84 }, art: 40, label: 11 },
  medium: { slot: { w: 88, h: 96 }, art: 52, label: 12 },
  large: { slot: { w: 112, h: 126 }, art: 72, label: 14 },
};

/** The icon size dropdown, in order. */
export const ICON_SIZE_OPTIONS: { value: IconSize; name: string }[] = [
  { value: 'small', name: 'Small' },
  { value: 'medium', name: 'Medium (Default)' },
  { value: 'large', name: 'Large' },
];

export const isIconSize = (v: unknown): v is IconSize => v === 'small' || v === 'medium' || v === 'large';

/** 'Recycle Bin', 'Recycle Bin Bin', 'Recycle Bin Bin Bin', … */
export const binName = (depth: number) => `Recycle Bin${' Bin'.repeat(depth)}`;

/** Where an icon sits on the desktop, in viewport coordinates. */
export type Point = { x: number; y: number };

/**
 * 'on' is the desktop. The other two hand the screen over to PowerScreen: 'off' is
 * a dead black screen, 'restarting' plays the boot splash and then reloads.
 */
export type Power = 'on' | 'off' | 'restarting';

export type WindowContent =
  | { type: 'toy'; toy: Toy }
  | { type: 'bin'; depth: number }
  | { type: 'settings' }
  | { type: 'about' }
  /** A dropped image, and every other picture on the desktop behind it. */
  | { type: 'picture'; fileId: string }
  /** A dropped text file, open in Josh's Computer Writing App. */
  | { type: 'writing'; fileId: string }
  /** A dropped sound, with a worm dancing to it. */
  | { type: 'audio'; fileId: string }
  /** A dropped video, playing. */
  | { type: 'video'; fileId: string }
  /** The nearest thing this desktop has to an error dialog. */
  | { type: 'notice'; body: string };

export type WindowState = {
  id: number;
  title: string;
  content: WindowContent;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  minimized: boolean;
  maximized: boolean;
};

/**
 * One level of bin. Index 0 is the original Recycle Bin; each time you delete the
 * outermost bin a new level is pushed that contains it, so every level keeps its
 * own contents intact however deeply it ends up nested.
 */
export type BinLevel = { toys: Toy[]; files: DesktopFile[] };

/** Everything the non-toy window panes need from the desktop. */
export type Panes = {
  binLevels: () => BinLevel[];
  openBin: (depth: number) => void;
  restore: (name: string) => void;
  restoreFile: (id: string) => void;
  emptyLevel: (depth: number) => void;
  colour: () => string;
  setColour: (colour: string) => void;
  /** The picture being tiled across the desktop, if one is. */
  wallpaper: () => DesktopFile | undefined;
  /** A picture on the desktop to tile, or null to go back to the plain colour. */
  setWallpaper: (id: string | null) => void;
  iconSize: () => IconSize;
  setIconSize: (size: IconSize) => void;
  /** A screensaver id from the registry in ./screensavers, or NO_SCREENSAVER. */
  screensaver: () => string;
  setScreensaver: (id: string) => void;
  /** Hand the screen to the chosen screensaver now, without waiting to go idle. */
  previewScreensaver: () => void;
  toyCount: () => number;
  /** A file still on the desktop, or nothing if it's been binned since the window opened. */
  fileById: (id: string) => DesktopFile | undefined;
  /**
   * The desktop's files of one kind, in icon order. The media apps treat the desktop as
   * the folder they're flicking through, so this is their prev/next list.
   */
  filesOfKind: (kind: FileKind) => DesktopFile[];
  /** Write the writing app's text back to the file it came from. */
  saveText: (id: string, text: string) => void;
};
