import { createSignal, createEffect, onCleanup, For, Show } from 'solid-js';
import {
  BIN_GLYPH,
  MATHS_APP,
  MATHS_GLYPH,
  CAMERA_APP,
  CAMERA_GLYPH,
  BANK_APP,
  BANK_GLYPH,
  RUN_APP,
  RUN_GLYPH,
  WRITING_APP,
  WRITING_GLYPH,
  type WindowState,
} from './shell';
import { artwork, isExternal, resolve, type Toy } from './toys';

type Props = {
  windows: WindowState[];
  toys: Toy[];
  binName: string;
  binCount: number;
  onLaunch: (toy: Toy) => void;
  onOpenCamera: () => void;
  onOpenMaths: () => void;
  onOpenBank: () => void;
  onOpenWriting: () => void;
  onOpenRun: () => void;
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
const TASK_GLYPHS: Partial<Record<WindowState['content']['type'], string>> = {
  bin: BIN_GLYPH,
  settings: '⚙️',
  camera: CAMERA_GLYPH,
  maths: MATHS_GLYPH,
  bank: BANK_GLYPH,
  run: RUN_GLYPH,
  writing: WRITING_GLYPH,
  picture: '🖼️',
  audio: '🎵',
  video: '🎬',
};

const glyphFor = (win: WindowState) => TASK_GLYPHS[win.content.type] ?? '★';

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
              {/* The computer's own apps first: the things you open to do something
                  with the computer, as against the things you open to have a go on. */}
              <li class="start-heading" role="presentation">
                Utilities
              </li>
              <li>
                <button role="menuitem" class="start-item" onClick={() => run(props.onOpenMaths)}>
                  <span class="start-item-art is-glyph" aria-hidden="true">
                    {MATHS_GLYPH}
                  </span>
                  {MATHS_APP}
                </button>
              </li>
              <li>
                <button role="menuitem" class="start-item" onClick={() => run(props.onOpenBank)}>
                  <span class="start-item-art is-glyph" aria-hidden="true">
                    {BANK_GLYPH}
                  </span>
                  {BANK_APP}
                </button>
              </li>
              <li>
                <button role="menuitem" class="start-item" onClick={() => run(props.onOpenCamera)}>
                  <span class="start-item-art is-glyph" aria-hidden="true">
                    {CAMERA_GLYPH}
                  </span>
                  {CAMERA_APP}
                </button>
              </li>
              <li>
                <button role="menuitem" class="start-item" onClick={() => run(props.onOpenWriting)}>
                  <span class="start-item-art is-glyph" aria-hidden="true">
                    {WRITING_GLYPH}
                  </span>
                  {WRITING_APP}
                </button>
              </li>
              <li>
                <button role="menuitem" class="start-item" onClick={() => run(props.onOpenBin)}>
                  <span class="start-item-art is-glyph" aria-hidden="true">
                    {BIN_GLYPH}
                  </span>
                  {props.binName}
                  <Show when={props.binCount}>
                    <span class="start-item-hint">{props.binCount}</span>
                  </Show>
                </button>
              </li>

              {/* Bin every toy and this whole group goes, heading and all. */}
              <Show when={props.toys.length}>
                <li class="start-separator" role="separator" />
                <li class="start-heading" role="presentation">
                  Programs
                </li>
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
                          <img
                            class="start-item-art"
                            classList={{ 'is-bare': !!toy.icon }}
                            src={resolve(artwork(toy)!)}
                            alt=""
                          />
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
              </Show>

              <li class="start-separator" role="separator" />
              <li>
                <button role="menuitem" class="start-item" onClick={() => run(props.onOpenRun)}>
                  <span class="start-item-art is-glyph" aria-hidden="true">
                    {RUN_GLYPH}
                  </span>
                  {RUN_APP}…
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
