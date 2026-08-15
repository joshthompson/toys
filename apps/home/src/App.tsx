import { createSignal, For, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { toys, resolve, isExternal, type Toy } from './toys';
import { DesktopIcon } from './DesktopIcon';
import { ToyWindow } from './ToyWindow';
import { Taskbar } from './Taskbar';

export const BIN_KEY = '__bin__';
export const BIN_TITLE = 'Recycle Bin';
export const BIN_GLYPH = '🗑️';

const TASKBAR_HEIGHT = 40;
/** Left edge of the first window — clear of the desktop icon column. */
const CASCADE_ORIGIN = 130;
/** One icon slot. Icons drag freely, but start life on this grid. */
const ICON_W = 88;
const ICON_H = 96;

export type WindowContent = { type: 'toy'; toy: Toy } | { type: 'bin' };

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

type Point = { x: number; y: number };

/** Toys down the left in columns, bin in the bottom-left corner. */
const initialPositions = (): Record<string, Point> => {
  const positions: Record<string, Point> = {};
  const binY = Math.max(8, window.innerHeight - TASKBAR_HEIGHT - 8 - ICON_H);
  // Leave the bottom slot of the first column free so the bin doesn't land on a toy.
  const perColumn = Math.max(1, Math.floor((binY - 8) / ICON_H));

  toys.forEach((toy, i) => {
    positions[toy.name] = {
      x: 8 + Math.floor(i / perColumn) * ICON_W,
      y: 8 + (i % perColumn) * ICON_H,
    };
  });
  positions[BIN_KEY] = { x: 8, y: binY };
  return positions;
};

export function App() {
  // A store, not a signal: <For> keys by object reference, so replacing a window
  // object on every drag frame would tear down and rebuild its iframe. Fine-grained
  // store writes keep each window's DOM node — and its iframe — alive.
  const [windows, setWindows] = createStore<WindowState[]>([]);
  const [positions, setPositions] = createStore<Record<string, Point>>(initialPositions());
  const [selected, setSelected] = createSignal<string | null>(null);
  const [binHover, setBinHover] = createSignal(false);
  /** In the bin: hidden from the desktop, restorable. */
  const [binned, setBinned] = createSignal<string[]>([]);
  /** Emptied out of the bin: gone for this session. */
  const [purged, setPurged] = createSignal<string[]>([]);

  let nextId = 1;
  let nextZ = 1;
  let cascade = 0;

  const binnedToys = () => toys.filter((t) => binned().includes(t.name));
  const liveToys = () => toys.filter((t) => !binned().includes(t.name) && !purged().includes(t.name));

  const patch = (id: number, changes: Partial<WindowState>) => {
    const i = windows.findIndex((w) => w.id === id);
    if (i >= 0) setWindows(i, changes);
  };

  /** True when no other un-minimised window sits above this one. */
  const isTop = (win: WindowState) => windows.every((w) => w.minimized || w.z <= win.z);

  const focus = (id: number) => patch(id, { z: ++nextZ, minimized: false });

  const close = (id: number) => setWindows((ws) => ws.filter((w) => w.id !== id));

  const onTaskClick = (id: number) => {
    const win = windows.find((w) => w.id === id);
    if (!win) return;
    // Classic behaviour: the focused window's task button minimises it, otherwise raise.
    if (!win.minimized && isTop(win)) patch(id, { minimized: true });
    else focus(id);
  };

  const spawn = (title: string, content: WindowContent, width: number, height: number) => {
    const existing = windows.find((w) => w.title === title);
    if (existing) {
      focus(existing.id);
      return;
    }

    const w = Math.max(240, Math.min(width, window.innerWidth - CASCADE_ORIGIN - 16));
    const h = Math.max(160, Math.min(height, window.innerHeight - TASKBAR_HEIGHT - 96));
    const step = cascade++ * 28;

    setWindows(windows.length, {
      id: nextId++,
      title,
      content,
      x: Math.max(8, Math.min(CASCADE_ORIGIN + step, window.innerWidth - w - 8)),
      y: Math.max(8, Math.min(24 + step, window.innerHeight - TASKBAR_HEIGHT - h - 8)),
      w,
      h,
      z: ++nextZ,
      minimized: false,
      maximized: false,
    });
  };

  const openToy = (toy: Toy) => {
    if (!toy.href || binned().includes(toy.name) || purged().includes(toy.name)) return;
    spawn(toy.name, { type: 'toy', toy }, 880, 560);
  };

  const openBin = () => spawn(BIN_TITLE, { type: 'bin' }, 440, 320);

  const binToy = (name: string) => {
    setBinned((b) => [...b, name]);
    // A binned toy can't stay open behind the bin.
    setWindows((ws) => ws.filter((w) => w.title !== name));
    if (selected() === name) setSelected(null);
  };

  const restore = (name: string) => setBinned((b) => b.filter((n) => n !== name));

  const emptyBin = () => {
    setPurged((p) => [...p, ...binned()]);
    setBinned([]);
  };

  const moveIcon = (key: string, x: number, y: number) =>
    setPositions(key, {
      x: Math.max(0, Math.min(x, window.innerWidth - ICON_W)),
      y: Math.max(0, Math.min(y, window.innerHeight - TASKBAR_HEIGHT - ICON_H)),
    });

  return (
    <main class="desktop" onPointerDown={(e) => e.target === e.currentTarget && setSelected(null)}>
      <div class="desktop-icons">
        <For each={liveToys()}>
          {(toy) => (
            <DesktopIcon
              iconKey={toy.name}
              label={toy.name}
              image={toy.image && resolve(toy.image)}
              colour={toys.indexOf(toy)}
              position={positions[toy.name]}
              selected={selected() === toy.name}
              disabled={!toy.href}
              external={!!toy.href && isExternal(toy.href)}
              onSelect={() => setSelected(toy.name)}
              onOpen={() => openToy(toy)}
              onMove={(x, y) => moveIcon(toy.name, x, y)}
              onDragOverBin={setBinHover}
              onDropInBin={() => {
                setBinHover(false);
                binToy(toy.name);
              }}
            />
          )}
        </For>

        <DesktopIcon
          iconKey={BIN_KEY}
          label={BIN_TITLE}
          glyph={BIN_GLYPH}
          isBin
          binCount={binned().length}
          dropTarget={binHover()}
          position={positions[BIN_KEY]}
          selected={selected() === BIN_KEY}
          onSelect={() => setSelected(BIN_KEY)}
          onOpen={openBin}
          onMove={(x, y) => moveIcon(BIN_KEY, x, y)}
        />
      </div>

      <For each={windows}>
        {(win) => (
          <ToyWindow
            win={win}
            active={isTop(win)}
            binned={binnedToys()}
            onFocus={() => focus(win.id)}
            onClose={() => close(win.id)}
            onMinimize={() => patch(win.id, { minimized: true })}
            onToggleMaximize={() => patch(win.id, { maximized: !win.maximized, z: ++nextZ })}
            onMove={(x, y) => patch(win.id, { x, y })}
            onResize={(x, y, w, h) => patch(win.id, { x, y, w, h })}
            onRestore={restore}
            onEmptyBin={emptyBin}
          />
        )}
      </For>

      <Taskbar
        windows={windows}
        toys={liveToys()}
        onLaunch={openToy}
        onOpenBin={openBin}
        binCount={binned().length}
        onTaskClick={onTaskClick}
        taskbarHeight={TASKBAR_HEIGHT}
      />
    </main>
  );
}
