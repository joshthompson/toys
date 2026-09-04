import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';

export type MenuEntry =
  | { separator: true }
  | { label: string; disabled?: boolean; onSelect: () => void };

type Props = {
  x: number;
  y: number;
  entries: MenuEntry[];
  onClose: () => void;
};

export function ContextMenu(props: Props) {
  let el!: HTMLDivElement;
  const [pos, setPos] = createSignal({ x: props.x, y: props.y });

  onMount(() => {
    // Flip back inside the viewport if the menu would hang off an edge.
    const r = el.getBoundingClientRect();
    setPos({
      x: props.x + r.width > window.innerWidth ? Math.max(0, props.x - r.width) : props.x,
      y: props.y + r.height > window.innerHeight ? Math.max(0, props.y - r.height) : props.y,
    });
  });

  // Any press outside, Escape, or focus moving into an iframe dismisses it.
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
  window.addEventListener('pointerdown', props.onClose);
  window.addEventListener('blur', props.onClose);
  window.addEventListener('keydown', onKey);
  onCleanup(() => {
    window.removeEventListener('pointerdown', props.onClose);
    window.removeEventListener('blur', props.onClose);
    window.removeEventListener('keydown', onKey);
  });

  return (
    <div
      ref={el}
      class="context-menu"
      role="menu"
      style={{ left: `${pos().x}px`, top: `${pos().y}px` }}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <For each={props.entries}>
        {(entry) => (
          <Show
            when={!('separator' in entry)}
            fallback={<div class="context-separator" role="separator" />}
          >
            {(() => {
              const item = entry as Extract<MenuEntry, { label: string }>;
              return (
                <button
                  role="menuitem"
                  class="context-item"
                  aria-disabled={item.disabled}
                  onClick={() => {
                    if (item.disabled) return;
                    item.onSelect();
                    props.onClose();
                  }}
                >
                  {item.label}
                </button>
              );
            })()}
          </Show>
        )}
      </For>
    </div>
  );
}
