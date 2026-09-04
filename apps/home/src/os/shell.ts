/**
 * Shared shell constants and types.
 *
 * These live here rather than in App.tsx because App imports the window panes and
 * the panes need these values — importing them back from App would form a cycle,
 * and any pane reading one at module-eval time (a `const` array of swatches, say)
 * would hit the temporal dead zone and blow up at boot.
 */
import type { DesktopFile, FileKind } from './files';
import { posterFor } from './posters';
import type { MenuEntry } from './ContextMenu';
import type { Toy } from './toys';

export const FOLDER_GLYPH = '📁';
/** What a folder is called before anybody calls it anything. */
export const NEW_FOLDER = 'New Folder';

/** Where a dragged icon can be let go: the bin, the desktop itself, or a folder's id. */
export const DESKTOP_KEY = '__desktop__';

export const BIN_KEY = '__bin__';
export const BIN_GLYPH = '🗑️';
export const CAMERA_KEY = '__camera__';
export const CAMERA_GLYPH = '📷';
export const MATHS_KEY = '__maths__';
export const MATHS_GLYPH = '🧮';
export const BANK_KEY = '__bank__';
export const BANK_GLYPH = '🏦';

/**
 * Icons the computer owns rather than the user: the bin and the apps built into the
 * desktop. They select, they drag, they sit in the corner — but there is nothing behind
 * them to throw away, so every delete leaves them where they are.
 *
 * In the order they stack up from the bottom-left, the bin nearest the floor.
 */
export const FIXED_ICONS = [BIN_KEY, CAMERA_KEY, MATHS_KEY, BANK_KEY];

export const isFixedIcon = (key: string) => FIXED_ICONS.includes(key);
/**
 * The icon a dropped file gets, by kind. Pictures and videos are the exceptions —
 * they're drawn as their own artwork, and only fall back to this.
 */
export const glyphFor = (kind: FileKind) =>
  ({ image: '🖼️', audio: '🎵', video: '🎬', text: '📝', other: '📄' })[kind];

/**
 * The stamp in the corner of a file drawn as itself, saying which sort of file it is:
 * a camera for a photograph, a clapperboard for a film. Nothing else is drawn that way,
 * so nothing else needs one.
 */
export const stampFor = (kind: FileKind) => (kind === 'video' ? '🎬' : CAMERA_GLYPH);

/**
 * How a file's icon is drawn. A picture is its own thumbnail and a video is its first
 * frame, both framed like a photograph with a stamp in the corner saying which they
 * are; everything else — and any video whose frame hasn't arrived, or never will — is a
 * glyph standing straight on the desktop.
 */
export const artFor = (file: DesktopFile) => {
  const image = file.kind === 'image' ? file.url : posterFor(file);
  return {
    image,
    glyph: glyphFor(file.kind),
    bare: !image,
    stamp: image ? stampFor(file.kind) : undefined,
  };
};

/**
 * The apps that open a dropped file. Named here because both the desktop and the app
 * itself build window titles out of them, and a media window renames itself as you
 * step through the desktop's other files of the same kind.
 */
export const IMAGE_APP = "Image Looking App";
export const WRITING_APP = "Computer Writing App";
export const AUDIO_APP = "Listening To Stuff App";
export const VIDEO_APP = "Video Playback App";
export const CAMERA_APP = "Camera Photo App";
export const MATHS_APP = "Maths App";
/**
 * The second calculator, which turns up on its own and disagrees. It is the same app —
 * same keypad, same arithmetic, same regard for the truth — wearing red so that you
 * can tell which of them is shouting.
 */
export const MATHS_RIVAL_APP = "Other Maths App";
export const BANK_APP = "JBank";
export const RUN_APP = 'Run';
export const RUN_GLYPH = '🏃';
export const WRITING_GLYPH = '📝';
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

/**
 * Money, in moneys, which is the only denomination this computer deals in. Halves of
 * one turn up — the calculator prices its work by mood — and nothing is ever finer
 * than that, which keeps every balance on this desktop exactly representable. Out is
 * negative, and the balance is the sum of the lot.
 */
export type Transaction = {
  id: number;
  at: number;
  /** What it was for, in the words of whoever took it. */
  what: string;
  amount: number;
  /**
   * Which app had the money off you. Optional only because the opening balance was
   * nobody's doing, and because a ledger saved before the bank kept track of this has
   * entries that can no longer be attributed to anyone.
   */
  from?: string;
};

/**
 * An app asking for money, waiting on somebody to say yes or no.
 *
 * The asking and the paying are deliberately two different moments in two different
 * windows: an app can put a price on something, and only the bank can take the money,
 * and the bank will not take it without being told to. What the app gets back is the
 * answer to the question it asked, which is all it is entitled to.
 */
export type Charge = { id: number; from: string; what: string; amount: number };

/**
 * What the account is opened with, and the only money that will ever go into it. It is
 * a hundred sums at the calculator's going rate, which is either generous or a warning
 * depending on how you look at it.
 */
export const OPENING_BALANCE = 100;

/**
 * The one rule the bank has, and it is not negotiable because there is nobody to
 * negotiate with: the balance does not go under. No overdraft, no arrangement, no
 * letter about it afterwards. An account with no way of being paid into has to stop
 * somewhere, and it stops at nothing.
 */
export const affordable = (balance: number, amount: number) => amount <= balance;

/** '9 moneys', '1 money', '-1 money'. */
export const moneys = (amount: number) =>
  `${amount.toLocaleString('en-GB')} ${Math.abs(amount) === 1 ? 'money' : 'moneys'}`;

/**
 * What the OS's file dialog has been asked for, and what it comes back with.
 *
 * Opening and saving are the same window doing two jobs, because they are the same job
 * from the user's side: find the place, then say which file. What differs is only what
 * the answer is made of — one that exists, or one that doesn't yet.
 */
export type PickAsk =
  | { mode: 'open'; kinds: FileKind[] | null }
  | { mode: 'save'; suggested: string };

export type PickResult = string | { name: string; folder?: string };

/**
 * A folder. There is nothing in one — a folder holds no list of its contents. What is
 * inside it is worked out the other way about, from every item that says it is: one
 * item can only be in one place, and that way it cannot be in two lists at once or in
 * none of them, which is the failure a folder full of ids invites.
 */
export type Folder = { id: string; name: string };

/** How the contents of a folder window are put in order. */
export const ARRANGEMENTS = [
  { id: 'name', name: 'by Name' },
  { id: 'kind', name: 'by Kind' },
  { id: 'size', name: 'by Size' },
  { id: 'added', name: 'by Date' },
] as const;

export type Arrangement = (typeof ARRANGEMENTS)[number]['id'];

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
  /** The camera, at the resolution this computer believes in. */
  | { type: 'camera' }
  /**
   * A calculator that would rather give you a ballpark than a number. `rival` is the
   * red one, which is the same calculator with a lower opinion of the first.
   */
  | { type: 'maths'; rival?: boolean }
  /** What little money you have, and every money of it accounted for. */
  | { type: 'bank' }
  /** Type the name of a thing; the computer opens the thing. */
  | { type: 'run' }
  /** What's inside a folder. */
  | { type: 'folder'; folderId: string }
  /** The Open dialog, up because an app has asked for a file. */
  | { type: 'picker' }
  /** A dropped image, and every other picture on the desktop behind it. */
  | { type: 'picture'; fileId: string }
  /**
   * A text file open in the writing app — or, with no file at all, a blank document
   * that hasn't been saved yet and so isn't anywhere. Nothing lands on the desktop
   * until it's saved.
   */
  | { type: 'writing'; fileId?: string }
  /** A dropped sound, with a worm dancing to it. */
  | { type: 'audio'; fileId: string }
  /** A dropped video, playing. */
  | { type: 'video'; fileId: string }
  /** The nearest thing this desktop has to an error dialog. */
  | { type: 'notice'; body: string }
  /**
   * Words and nothing else — the rules of a game, an about box. Framed apps ask for
   * one of these over postMessage rather than building a dialog of their own.
   */
  | { type: 'text'; body: string };

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
  /**
   * Open the second calculator, or bring it up if it's already about. The maths app
   * calls this on itself when it wants somebody to argue with.
   */
  openRivalMaths: () => void;
  /**
   * The Run box's whole job: a name in, a thing opened. False means nothing on this
   * computer answers to it, and that the computer has already said so.
   */
  run: (typed: string) => boolean;
  /**
   * The bank, which is the computer's rather than any one app's: an app that takes
   * money off you writes it here, and the bank app is only the window onto it.
   */
  bank: {
    balance: () => number;
    transactions: () => Transaction[];
    open: () => void;
    /**
     * Ask for money. The bank window comes up with the request on it, and nothing at
     * all happens until it is approved or declined — at which point `settle` is told
     * which it was, and the app can get on with whatever it was holding back.
     *
     * There is no matching way to put money in. The balance goes one way, and only as
     * far as nothing: ask for more than there is and the answer is no, whoever is
     * pressing whichever button.
     */
    request: (from: string, what: string, amount: number, settle: (paid: boolean) => void) => void;
    /** What is waiting to be approved, if anything. The bank draws this. */
    pending: () => Charge | null;
    /** Settles the first charge, unless there isn't the money — then it declines it. */
    approve: () => void;
    decline: () => void;
  };
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
  /**
   * Put a new text file on the desktop and hand back the id it was given, which is
   * what turns a blank document into a file the writing app can go on saving to.
   */
  saveNewText: (name: string, text: string, folder?: string) => string | undefined;
  /** The names taken in one folder, or on the desktop when given none. */
  namesIn: (folder?: string) => string[];
  /**
   * Folders, from the point of view of whoever is looking in one. `undefined` for the
   * folder means the desktop, which is the folder everything else is in.
   */
  folderById: (id: string) => Folder | undefined;
  itemsIn: (folder?: string) => { folders: Folder[]; files: DesktopFile[]; toys: Toy[] };
  /** Open a toy by name, for a folder window that has one in it. */
  openToyNamed: (name: string) => void;
  newFolder: (inside?: string) => void;
  openFolder: (id: string) => void;
  /** The folder something is in, or nothing at all when it's out on the desktop. */
  holderOf: (id: string) => string | undefined;
  /** Put an item in a folder, or on the desktop when told no folder. */
  moveInto: (id: string, folder?: string) => void;
  /** A file by id, opened in whatever app takes it. */
  openFileById: (id: string) => void;
  /** Anything at all by its key, opened in whatever takes it. */
  openIcon: (key: string) => void;
  /** Bin a file, or a folder and everything in it. */
  deleteItem: (id: string) => void;
  /** Where an icon stands, in the coordinates of whatever it is standing in. */
  positionOf: (id: string) => Point | undefined;
  placeAt: (id: string, x: number, y: number) => void;
  /** How big an icon is, for a pane working out where one will fit. */
  iconSlot: () => { w: number; h: number };
  /** Line the contents of a folder up, in the order asked for. */
  arrangeIn: (folder: string, how: Arrangement) => void;
  /** Icons let go over something: the bin, the desktop, or a folder. */
  dropOn: (ids: string[], onto: string) => void;
  /** Every folder from the desktop down to this one, for a window to show its path. */
  pathTo: (folder: string) => Folder[];
  /** What a drag is currently hovering over, so a pane can light itself up. */
  hovering: () => string | null;
  /** And what a pane's own icons report as they are dragged about. */
  hover: (onto: string | null) => void;
  /** The OS's own right-click menu, opened wherever a pane wants one. */
  menu: (x: number, y: number, entries: MenuEntry[]) => void;
  /**
   * What right-clicking an icon offers — built by the OS rather than by whichever
   * window the icon happens to be sitting in, so that a thing has one menu wherever
   * it is. `chosen` is what the gesture applies to: the icon, or the selection it is
   * part of.
   */
  iconMenu: (key: string, chosen: string[]) => MenuEntry[];
  /** Renaming, which is the OS's: one icon on the whole machine is being typed over. */
  renaming: () => string | null;
  startRename: (id: string) => void;
  endRename: (id: string, name: string | null) => void;
  /** Whether a thing can be renamed at all. Apps can't: their names aren't yours. */
  renameable: (key: string) => boolean;
  /**
   * Ask for a file. The Open dialog comes up and calls back with what was chosen, or
   * with nothing if it was closed or cancelled — the same shape as asking the bank for
   * money, and for the same reason: the app doesn't get to do the choosing.
   */
  pickFile: (kinds: FileKind[] | null, settle: (id: string | null) => void) => void;
  /**
   * The same dialog, asked for somewhere to put something instead. What comes back is
   * a name and the folder to put it in — the file itself is the app's business, since
   * only the app knows what is going in it.
   */
  saveFile: (
    suggested: string,
    settle: (place: { name: string; folder?: string } | null) => void,
  ) => void;
  /** What the dialog is being asked for, if it is up. */
  picking: () => PickAsk | null;
  settlePick: (chosen: PickResult | null) => void;
  /** Open a window that just says something. Titles are unique, so asking twice
      raises the window that's already up rather than stacking another on it. */
  showText: (title: string, body: string) => void;
  /**
   * Put a file on the desktop. Not subject to the limit on files dragged in from
   * outside — that one is about what the desktop will accept from elsewhere, and this
   * is the computer saving its own work.
   */
  saveToDesktop: (name: string, blob: Blob) => void;
  /**
   * White out the whole screen, taskbar and all. The camera uses it as its flash: the
   * screen is the only light this computer has, so the more of it that lights up the
   * better the picture it gets back.
   */
  flash: (lit: boolean) => void;
};
