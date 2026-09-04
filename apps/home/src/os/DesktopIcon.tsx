import { createSignal, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { arrows, step } from '../shared/arrows';
import { longPress } from '../shared/longPress';
import { colours } from './toys';
import { BIN_KEY, DESKTOP_KEY } from './shell';

type Props = {
  label: string;
  position: { x: number; y: number };
  selected: boolean;
  image?: string;
  /** Draw the image as artwork on the desktop rather than inside a coloured tile. */
  bare?: boolean;
  glyph?: string;
  /**
   * A small glyph in the corner of the artwork, for an icon that is a picture of its
   * own contents and so says nothing about what sort of file it is.
   */
  stamp?: string;
  colour?: number;
  disabled?: boolean;
  external?: boolean;
  isBin?: boolean;
  binCount?: number;
  /** Set on a folder, which makes this icon something other icons can be dropped into. */
  folderId?: string;
  /** The folder this icon is currently in. Unset means it is out on the desktop. */
  home?: string;
  /** An icon is currently hovering over this one mid-drag. */
  dropTarget?: boolean;
  /** The label is a text field, being edited. Files only — apps aren't renameable. */
  renaming?: boolean;
  /** Renaming finished: the new name, or null if it was abandoned. */
  onRenamed?: (name: string | null) => void;
  /** Start renaming this one. Absent on anything whose name isn't yours to change. */
  onRename?: () => void;
  onSelect: () => void;
  onOpen: () => void;
  onMove: (x: number, y: number) => void;
  /** Where the icon being dragged is now: the bin, a folder's id, or nowhere. */
  onDragOver?: (onto: string | null) => void;
  onDropOn?: (onto: string) => void;
  onContextMenu: (x: number, y: number) => void;
};

/** The keys that open a thing: Enter, the space bar, and command-down. */
export const opens = (e: KeyboardEvent) =>
  e.key === 'Enter' || e.key === ' ' || ((e.metaKey || e.ctrlKey) && e.key === 'ArrowDown');

/** Touch has no double-click, so a single tap opens there. */
const isTouch = () => window.matchMedia('(pointer: coarse)').matches;

/** Pointer travel (px) before a press counts as a drag rather than a click. */
const DRAG_THRESHOLD = 4;

/**
 * What's under the pointer, ignoring the icon being dragged — which would
 * otherwise hit-test as itself, since it sits under the cursor.
 */
const targetBeneath = (el: HTMLElement, x: number, y: number) => {
  const previous = el.style.pointerEvents;
  el.style.pointerEvents = 'none';
  const hit = document.elementFromPoint(x, y);
  el.style.pointerEvents = previous;
  return hit;
};

export function DesktopIcon(props: Props) {
  const [dragging, setDragging] = createSignal(false);
  /**
   * Where the icon is drawn while it is being carried, in screen coordinates.
   *
   * An icon in a folder window is drawn inside that window and clipped by it, which is
   * right for an icon sitting still and useless for one being taken somewhere else:
   * dragging it towards the desktop would have it disappear at the window's edge. So
   * for as long as it is being carried it comes out of wherever it lives and is drawn
   * on top of everything, at the pointer — the same way it looks going the other way,
   * from the desktop into a window that would otherwise be in front of it.
   */
  const [carried, setCarried] = createSignal<{ x: number; y: number } | null>(null);
  const open = () => !props.disabled && props.onOpen();

  let origin:
    | { px: number; py: number; x: number; y: number; left: number; top: number }
    | null = null;
  // Set once the pointer passes the threshold; suppresses the click/dblclick that
  // would otherwise fire at the end of a drag.
  let moved = false;

  /**
   * What this icon would go into if it were let go here: the bin, a folder, or nothing.
   * An icon is never a target for itself, and a folder dragged over its own contents
   * would be a folder going into itself.
   */
  const dropInto = (el: HTMLElement, x: number, y: number) => {
    const under = targetBeneath(el, x, y);
    if (!props.isBin && under?.closest('.icon.is-bin')) return BIN_KEY;

    // A folder's icon, or the inside of an open window onto one — both are the folder.
    const folder =
      under?.closest<HTMLElement>('.icon[data-folder]')?.dataset.folder ??
      under?.closest<HTMLElement>('[data-folder-area]')?.dataset.folderArea;
    // Not into itself, and not into the folder it is already sitting in: that is a
    // drag from one part of a folder to another, which is a move and not a drop.
    if (folder) return folder !== props.folderId && folder !== props.home ? folder : null;

    // Out of a folder and onto the desktop. An icon already on the desktop is only
    // being moved about, so the desktop is nothing to it.
    return props.home && under?.closest('.desktop') ? DESKTOP_KEY : null;
  };

  /**
   * Give up the drag this press had started. A hold that has wandered a few pixels has
   * already nudged the icon, so it goes back to where it was picked up — a long press
   * is meant to open a menu, not to move anything.
   */
  const dropDrag = () => {
    if (origin && moved) props.onMove(origin.x, origin.y);
    origin = null;
    moved = false;
    setCarried(null);
    setDragging(false);
    props.onDragOver?.(null);
  };

  // Holding an icon opens its menu, the way right-clicking one does. Selecting is
  // already done: the press did it on the way down, whichever button it came from.
  const press = longPress((x, y) => {
    dropDrag();
    props.onContextMenu(x, y);
  });

  const onPointerDown = (e: PointerEvent & { currentTarget: HTMLElement }) => {
    props.onSelect();
    press.down(e);
    // Right-click selects and opens the menu; only the primary button drags.
    if (e.button !== 0) return;
    // Both where it sits in its container and where it sits on the screen: the first
    // is what gets saved, the second is what it is drawn at while it is in the air.
    const box = e.currentTarget.getBoundingClientRect();
    origin = {
      px: e.clientX,
      py: e.clientY,
      x: props.position.x,
      y: props.position.y,
      left: box.left,
      top: box.top,
    };
    moved = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent & { currentTarget: HTMLElement }) => {
    press.move(e);
    if (!origin) return;
    const dx = e.clientX - origin.px;
    const dy = e.clientY - origin.py;
    if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

    moved = true;
    setDragging(true);
    setCarried({ x: origin.left + dx, y: origin.top + dy });
    props.onMove(origin.x + dx, origin.y + dy);
    props.onDragOver?.(dropInto(e.currentTarget, e.clientX, e.clientY));
  };

  const onPointerUp = (e: PointerEvent & { currentTarget: HTMLElement }) => {
    press.cancel();
    const onto = moved ? dropInto(e.currentTarget, e.clientX, e.clientY) : null;
    origin = null;
    setCarried(null);
    setDragging(false);
    props.onDragOver?.(null);
    if (onto) props.onDropOn?.(onto);
  };

  const onPointerCancel = () => {
    press.cancel();
    origin = null;
    moved = false;
    setCarried(null);
    setDragging(false);
    props.onDragOver?.(null);
  };

  // Everything a settled icon responds to. Held apart from the markup because a
  // renaming icon takes none of it: it's a label being typed into, not a thing to
  // press, and dragging it around mid-edit would take the text field with it.
  const interactions = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onClick: () => !moved && isTouch() && open(),
    onDblClick: () => !moved && open(),
    // Wherever the keyboard lands is what's picked out, so that arrowing across the
    // icons selects them as it goes. Already part of a selection is left alone: the
    // desktop only replaces a selection with one that wasn't in it.
    onFocus: () => props.onSelect(),
    onKeyDown: (e: KeyboardEvent & { currentTarget: HTMLElement }) => {
      // F2 renames, as it has since long before this desktop. Enter opens, and so does
      // command-down, which is how the machines this desktop isn't have always done it.
      if (e.key === 'F2' && props.onRename) {
        e.preventDefault();
        props.onRename();
      } else if (opens(e)) {
        e.preventDefault();
        open();
      } else if (arrows(e.key)) {
        // Checked after `opens`, which has command-down for opening: the arrows only
        // walk when they are pressed on their own.
        e.preventDefault();
        step(e.currentTarget, e.key);
      }
    },
  };

  return (
    <Dynamic
      // A text field inside a <button> is neither valid nor operable, so an icon
      // being renamed stops being a button for as long as the edit lasts.
      component={props.renaming ? 'div' : 'button'}
      class="icon"
      classList={{
        'is-selected': props.selected,
        'is-dragging': dragging(),
        'is-bare': props.bare,
        'is-bin': props.isBin,
        'is-drop-target': props.dropTarget,
        'is-renaming': props.renaming,
      }}
      style={{
        // Fixed while carried, which takes it out of any window that would clip it —
        // and out of the stacking order that would put a window in front of it.
        position: carried() ? 'fixed' : undefined,
        left: `${carried()?.x ?? props.position.x}px`,
        top: `${carried()?.y ?? props.position.y}px`,
        '--icon-colour': props.colour === undefined ? undefined : colours[props.colour % colours.length],
      }}
      aria-disabled={props.disabled}
      // What another icon dropped here would go into. Read straight off the DOM by
      // whichever icon is being dragged, since a drag knows what it is over long
      // before anything in Solid does.
      data-folder={props.folderId}
      title={props.disabled ? `${props.label} — coming soon` : props.label}
      onContextMenu={(e: MouseEvent) => {
        // Stop it reaching the desktop, which would show the desktop menu instead.
        e.preventDefault();
        e.stopPropagation();
        props.onContextMenu(e.clientX, e.clientY);
      }}
      {...(props.renaming ? {} : interactions)}
    >
      <span class="icon-art">
        <Show when={props.image} fallback={<span class="icon-glyph">{props.glyph ?? '★'}</span>}>
          <img src={props.image} alt="" draggable={false} />
        </Show>
        <Show when={props.stamp}>
          <span class="icon-stamp" aria-hidden="true">
            {props.stamp}
          </span>
        </Show>
        <Show when={props.binCount}>
          <span class="icon-count">{props.binCount}</span>
        </Show>
      </span>
      <Show
        when={props.renaming}
        fallback={
          <span class="icon-label">
            {props.label}
            <Show when={props.disabled}>
              <span class="icon-badge">coming soon</span>
            </Show>
          </span>
        }
      >
        <input
          class="icon-rename"
          value={props.label}
          spellcheck={false}
          // Committed on Enter or on losing focus, abandoned on Escape — as renaming
          // an icon has always worked.
          onKeyDown={(e) => {
            if (e.key === 'Enter') props.onRenamed?.(e.currentTarget.value);
            else if (e.key === 'Escape') props.onRenamed?.(null);
            else return;
            e.preventDefault();
            e.stopPropagation();
          }}
          onBlur={(e) => props.onRenamed?.(e.currentTarget.value)}
          ref={(el) => {
            // After the paint that puts it on screen, or the focus goes nowhere.
            requestAnimationFrame(() => {
              el.focus();
              // Select the stem, not the extension — the bit anyone means to change.
              const dot = el.value.lastIndexOf('.');
              el.setSelectionRange(0, dot > 0 ? dot : el.value.length);
            });
          }}
        />
      </Show>
    </Dynamic>
  );
}
