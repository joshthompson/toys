/**
 * Shared shell constants and types.
 *
 * These live here rather than in App.tsx because App imports the window panes and
 * the panes need these values — importing them back from App would form a cycle,
 * and any pane reading one at module-eval time (a `const` array of swatches, say)
 * would hit the temporal dead zone and blow up at boot.
 */
import type { Toy } from './toys';

export const BIN_KEY = '__bin__';
export const BIN_GLYPH = '🗑️';
export const DEFAULT_DESKTOP = '#3c8585';
export const TASKBAR_HEIGHT = 40;

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
  | { type: 'about' };

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
export type BinLevel = { toys: Toy[] };

/** Everything the non-toy window panes need from the desktop. */
export type Panes = {
  binLevels: () => BinLevel[];
  openBin: (depth: number) => void;
  restore: (name: string) => void;
  emptyLevel: (depth: number) => void;
  colour: () => string;
  setColour: (colour: string) => void;
  toyCount: () => number;
};
