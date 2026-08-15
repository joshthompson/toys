import { createSignal, Show } from 'solid-js';
import { colours } from './toys';

type Props = {
  iconKey: string;
  label: string;
  position: { x: number; y: number };
  selected: boolean;
  image?: string;
  glyph?: string;
  colour?: number;
  disabled?: boolean;
  external?: boolean;
  isBin?: boolean;
  binCount?: number;
  /** Bin only: an icon is currently hovering over it mid-drag. */
  dropTarget?: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onMove: (x: number, y: number) => void;
  onDragOverBin?: (over: boolean) => void;
  onDropInBin?: () => void;
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

  const onPointerDown = (e: PointerEvent & { currentTarget: HTMLElement }) => {
    props.onSelect();
    origin = { px: e.clientX, py: e.clientY, x: props.position.x, y: props.position.y };
    moved = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent & { currentTarget: HTMLElement }) => {
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
    const dropped = moved && overBin(e.currentTarget, e.clientX, e.clientY);
    origin = null;
    setDragging(false);
    props.onDragOverBin?.(false);
    if (dropped) props.onDropInBin?.();
  };

  const onPointerCancel = () => {
    origin = null;
    moved = false;
    setDragging(false);
    props.onDragOverBin?.(false);
  };

  return (
    <button
      class="icon"
      classList={{
        'is-selected': props.selected,
        'is-dragging': dragging(),
        'is-bin': props.isBin,
        'is-drop-target': props.dropTarget,
      }}
      style={{
        left: `${props.position.x}px`,
        top: `${props.position.y}px`,
        '--icon-colour': props.colour === undefined ? undefined : colours[props.colour % colours.length],
      }}
      aria-disabled={props.disabled}
      title={props.disabled ? `${props.label} — coming soon` : props.label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onClick={() => !moved && isTouch() && open()}
      onDblClick={() => !moved && open()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
    >
      <span class="icon-art">
        <Show when={props.image} fallback={<span class="icon-glyph">{props.glyph ?? '★'}</span>}>
          <img src={props.image} alt="" draggable={false} />
        </Show>
        <Show when={props.external}>
          <span class="icon-shortcut" aria-hidden="true">
            ↗
          </span>
        </Show>
        <Show when={props.binCount}>
          <span class="icon-count">{props.binCount}</span>
        </Show>
      </span>
      <span class="icon-label">
        {props.label}
        <Show when={props.disabled}>
          <span class="icon-badge">coming soon</span>
        </Show>
      </span>
    </button>
  );
}
