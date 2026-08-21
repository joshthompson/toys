import { createSignal, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { longPress } from './longPress';
import { colours } from './toys';

type Props = {
  label: string;
  position: { x: number; y: number };
  selected: boolean;
  image?: string;
  /** Draw the image as artwork on the desktop rather than inside a coloured tile. */
  bare?: boolean;
  glyph?: string;
  colour?: number;
  disabled?: boolean;
  external?: boolean;
  isBin?: boolean;
  binCount?: number;
  /** Bin only: an icon is currently hovering over it mid-drag. */
  dropTarget?: boolean;
  /** The label is a text field, being edited. Files only — apps aren't renameable. */
  renaming?: boolean;
  /** Renaming finished: the new name, or null if it was abandoned. */
  onRenamed?: (name: string | null) => void;
  onSelect: () => void;
  onOpen: () => void;
  onMove: (x: number, y: number) => void;
  onDragOverBin?: (over: boolean) => void;
  onDropInBin?: () => void;
  onContextMenu: (x: number, y: number) => void;
};

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
  const open = () => !props.disabled && props.onOpen();

  let origin: { px: number; py: number; x: number; y: number } | null = null;
  // Set once the pointer passes the threshold; suppresses the click/dblclick that
  // would otherwise fire at the end of a drag.
  let moved = false;

  const overBin = (el: HTMLElement, x: number, y: number) =>
    !props.isBin && !!targetBeneath(el, x, y)?.closest('.icon.is-bin');

  /**
   * Give up the drag this press had started. A hold that has wandered a few pixels has
   * already nudged the icon, so it goes back to where it was picked up — a long press
   * is meant to open a menu, not to move anything.
   */
  const dropDrag = () => {
    if (origin && moved) props.onMove(origin.x, origin.y);
    origin = null;
    moved = false;
    setDragging(false);
    props.onDragOverBin?.(false);
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
    origin = { px: e.clientX, py: e.clientY, x: props.position.x, y: props.position.y };
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
    props.onMove(origin.x + dx, origin.y + dy);
    props.onDragOverBin?.(overBin(e.currentTarget, e.clientX, e.clientY));
  };

  const onPointerUp = (e: PointerEvent & { currentTarget: HTMLElement }) => {
    press.cancel();
    const dropped = moved && overBin(e.currentTarget, e.clientX, e.clientY);
    origin = null;
    setDragging(false);
    props.onDragOverBin?.(false);
    if (dropped) props.onDropInBin?.();
  };

  const onPointerCancel = () => {
    press.cancel();
    origin = null;
    moved = false;
    setDragging(false);
    props.onDragOverBin?.(false);
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
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
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
        left: `${props.position.x}px`,
        top: `${props.position.y}px`,
        '--icon-colour': props.colour === undefined ? undefined : colours[props.colour % colours.length],
      }}
      aria-disabled={props.disabled}
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
