import { createSignal, createEffect, onCleanup, For, Show } from 'solid-js';
import { BIN_GLYPH, type WindowState } from './shell';
import { artwork, isExternal, resolve, type Toy } from './toys';

type Props = {
  windows: WindowState[];
  toys: Toy[];
  binName: string;
  binCount: number;
  onLaunch: (toy: Toy) => void;
  onOpenBin: () => void;
  onTaskClick: (id: number) => void;
  onShutDown: () => void;
  onRestart: () => void;
  onFactoryReset: () => void;
  taskbarHeight: number;
};

/** Start menu power items. Shut Down sits at the bottom, nearest the Start button. */
const POWER_ITEMS = [
  { label: 'Return to Factory Settings', glyph: '☢️', key: 'onFactoryReset' },
  { label: 'Restart', glyph: '🔄', key: 'onRestart' },
  { label: 'Shut Down', glyph: '⏻', key: 'onShutDown' },
] as const;

/** Task button art for the windows that aren't toys. */
const glyphFor = (win: WindowState) =>
  win.content.type === 'bin' ? BIN_GLYPH : win.content.type === 'settings' ? '⚙️' : '★';

const formatTime = (d: Date) =>
  d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toUpperCase();

export function Taskbar(props: Props) {
  const [now, setNow] = createSignal(formatTime(new Date()));
  const [menuOpen, setMenuOpen] = createSignal(false);

  const timer = setInterval(() => setNow(formatTime(new Date())), 1000);
  onCleanup(() => clearInterval(timer));

  // Dismiss the Start menu on any click that isn't inside it. Pointer events inside a
  // toy's iframe never reach this document, so `blur` covers clicks landing on a window.
  createEffect(() => {
    if (!menuOpen()) return;
    const close = () => setMenuOpen(false);
    const dismiss = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.start-region')) close();
    };
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('blur', close);
    onCleanup(() => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('blur', close);
    });
  });

  const run = (action: () => void) => {
    action();
    setMenuOpen(false);
  };

  return (
    <div class="taskbar" style={{ '--taskbar-height': `${props.taskbarHeight}px` }}>
      <div class="start-region">
        <button
          class="chrome-button start-button"
          aria-expanded={menuOpen()}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span class="start-glyph" aria-hidden="true">
            ★
          </span>
          Start
        </button>

        <Show when={menuOpen()}>
          <div class="start-menu" role="menu">
            <div class="start-banner">Josh OS '95</div>
            <ul class="start-list">
              <For each={props.toys}>
                {(toy) => (
                  <li>
                    <button
                      role="menuitem"
                      class="start-item"
                      aria-disabled={!toy.href}
                      onClick={() => toy.href && run(() => props.onLaunch(toy))}
                    >
                      <Show
                        when={artwork(toy)}
                        fallback={
                          <span class="start-item-art" aria-hidden="true">
                            ★
                          </span>
                        }
                      >
                        <img class="start-item-art" classList={{ 'is-bare': !!toy.icon }} src={resolve(artwork(toy)!)} alt="" />
                      </Show>
                      {toy.name}
                      <Show when={toy.href && isExternal(toy.href)}>
                        <span class="start-item-hint" aria-hidden="true">
                          ↗
                        </span>
                      </Show>
                      <Show when={!toy.href}>
                        <span class="start-item-hint">soon</span>
                      </Show>
                    </button>
                  </li>
                )}
              </For>
              {/* Bin every toy and the list above this vanishes — so does its divider. */}
              <Show when={props.toys.length}>
                <li class="start-separator" role="separator" />
              </Show>
              <li>
                <button
                  role="menuitem"
                  class="start-item"
                  onClick={() => run(props.onOpenBin)}
                >
                  <span class="start-item-art is-glyph" aria-hidden="true">
                    {BIN_GLYPH}
                  </span>
                  {props.binName}
                  <Show when={props.binCount}>
                    <span class="start-item-hint">{props.binCount}</span>
                  </Show>
                </button>
              </li>

              <li class="start-separator" role="separator" />
              <For each={POWER_ITEMS}>
                {(item) => (
                  <li>
                    <button
                      role="menuitem"
                      class="start-item"
                      onClick={() => run(props[item.key])}
                    >
                      <span class="start-item-art is-glyph" aria-hidden="true">
                        {item.glyph}
                      </span>
                      {item.label}
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </div>
        </Show>
      </div>

      <div class="taskbar-apps">
        <For each={props.windows}>
          {(win) => (
            <button
              class="chrome-button task-button"
              classList={{ 'is-pressed': !win.minimized }}
              onClick={() => props.onTaskClick(win.id)}
            >
              <Show
                when={win.content.type === 'toy' && artwork(win.content.toy)}
                fallback={
                  <span class="task-art is-glyph" aria-hidden="true">
                    {glyphFor(win)}
                  </span>
                }
              >
                {(image) => (
                  <img
                    class="task-art"
                    classList={{ 'is-bare': win.content.type === 'toy' && !!win.content.toy.icon }}
                    src={resolve(image())}
                    alt=""
                  />
                )}
              </Show>
              {win.title}
            </button>
          )}
        </For>
      </div>

      <div class="taskbar-time">{now()}</div>
    </div>
  );
}
