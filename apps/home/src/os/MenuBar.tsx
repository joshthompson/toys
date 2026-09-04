import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js';
import type { Menu } from './osApi';

type Props = {
  menus: Menu[];
  onSelect: (id: string) => void;
};

/**
 * The bar of menus along the top of an app's window — File, Help, whatever the app
 * asked for, plus the OS's own.
 *
 * It behaves the way a 1995 menu bar did: a click opens a heading, and while one is
 * open sliding across the bar walks between them without clicking again.
 */
export function MenuBar(props: Props) {
  const [open, setOpen] = createSignal<number | null>(null);
  const close = () => setOpen(null);

  // An open menu is dismissed the way every other one on this desktop is: a press
  // somewhere else, Escape, or the focus leaving for an iframe.
  createEffect(() => {
    if (open() === null) return;

    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const onPress = (e: PointerEvent) => {
      // Presses on the bar are its own — a heading toggling, an item being picked.
      if (!(e.target as HTMLElement)?.closest?.('.menu-bar')) close();
    };

    window.addEventListener('pointerdown', onPress);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey);
    onCleanup(() => {
      window.removeEventListener('pointerdown', onPress);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKey);
    });
  });

  return (
    <div class="menu-bar" role="menubar">
      <For each={props.menus}>
        {(menu, i) => (
          <div class="menu-slot">
            <button
              class="menu-title"
              classList={{ 'is-open': open() === i() }}
              role="menuitem"
              aria-haspopup="true"
              aria-expanded={open() === i()}
              onClick={() => setOpen(open() === i() ? null : i())}
              // Only once something is open: otherwise merely crossing the bar on the
              // way somewhere else would drop menus open behind the pointer.
              onPointerEnter={() => open() !== null && setOpen(i())}
            >
              {menu.label}
            </button>

            <Show when={open() === i()}>
              <div class="context-menu menu-drop" role="menu">
                <For each={menu.items}>
                  {(item) => (
                    <Show
                      when={!('separator' in item)}
                      fallback={<div class="context-separator" role="separator" />}
                    >
                      {(() => {
                        const pick = item as Extract<typeof item, { id: string }>;
                        return (
                          <button
                            class="context-item"
                            role="menuitem"
                            aria-disabled={pick.disabled}
                            onClick={() => {
                              if (pick.disabled) return;
                              close();
                              props.onSelect(pick.id);
                            }}
                          >
                            {pick.label}
                          </button>
                        );
                      })()}
                    </Show>
                  )}
                </For>
              </div>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}
