import { createEffect, createSignal, For, Show } from 'solid-js';
import { DesktopIcon, opens } from '../os/DesktopIcon';
import { artwork, resolve } from '../os/toys';
import { arrows, enter } from '../shared/arrows';
import { between, overlaps, type Box } from '../shared/marquee';
import {
  ARRANGEMENTS,
  DESKTOP_KEY,
  FOLDER_GLYPH,
  artFor,
  type Arrangement,
  type Panes,
  type Point,
} from '../os/shell';

type Props = {
  folderId: string;
  panes: Panes;
  /** The window is named after whichever folder it is showing. */
  onTitle: (title: string) => void;
  /** And the OS is told, so that opening that folder again finds this window. */
  onShow: (folderId: string) => void;
};

/**
 * A folder window: a small desktop, and a way of walking between them.
 *
 * Everything the desktop does with icons, this does — they sit where they were put,
 * they drag, a rubber band picks several out, and what you do to one of a selection
 * you do to all of it. The only thing not shared with the desktop is the selection
 * itself, which stops at the window: what you have picked out in here is nobody else's
 * business.
 *
 * Opening a folder from inside one walks this window into it rather than putting up
 * another, the way a file manager does and unlike the way the desktop does. The path
 * along the bottom is both where you are and how you get back.
 */
export function FolderPane(props: Props) {
  /** The folder being shown, which is where it was opened on until you walk somewhere. */
  const [at, setAt] = createSignal(props.folderId);
  const [picked, setPicked] = createSignal<string[]>([]);
  const [band, setBand] = createSignal<Box | null>(null);
  /** Where a rubber band started, in this window's coordinates. */
  let bandFrom: Point | null = null;
  let area!: HTMLDivElement;
  let pane!: HTMLDivElement;

  const folder = () => props.panes.folderById(at());
  const here = () => props.panes.itemsIn(at());
  const path = () => props.panes.pathTo(at());
  const above = () => props.panes.holderOf(at());
  const count = () => here().folders.length + here().files.length + here().toys.length;
  /** Something is being dragged over this window and would land in the folder shown. */
  const catching = () => props.panes.hovering() === at();
  /** Every icon in here, by whatever key it goes under. */
  const keys = () => [
    ...here().folders.map((f) => f.id),
    ...here().toys.map((t) => t.name),
    ...here().files.map((f) => f.id),
  ];

  const isPicked = (key: string) => picked().includes(key);
  /** Pressing an icon picks just it — unless it is already part of a selection. */
  const pick = (key: string) => {
    if (!isPicked(key)) setPicked([key]);
  };
  /** What a gesture on `key` applies to: the whole selection if it's part of one. */
  const group = (key: string) => (isPicked(key) && picked().length > 1 ? picked() : [key]);

  /** Walking somewhere else, which the window is named after and the OS is told about. */
  const go = (folderId: string) => {
    setAt(folderId);
    setPicked([]);
  };

  createEffect(() => {
    const showing = folder();
    if (!showing) return;
    props.onTitle(showing.name);
    props.onShow(showing.id);
  });

  /** This window's coordinates, which is what positions in here are in. */
  const local = (x: number, y: number): Point => {
    const box = area.getBoundingClientRect();
    return { x: x - box.left + area.scrollLeft, y: y - box.top + area.scrollTop };
  };

  /**
   * Moving the selection, kept inside the window so nothing can be dragged out of its
   * own reach. Every icon moving together is clamped by whichever of them hits an edge
   * first, or a selection would deform as it went.
   */
  const move = (key: string, x: number, y: number) => {
    const box = area.getBoundingClientRect();
    const slot = props.panes.iconSlot();
    const moving = group(key).filter((k) => props.panes.positionOf(k));
    const from = props.panes.positionOf(key);
    if (!from) return;

    let dx = x - from.x;
    let dy = y - from.y;
    for (const k of moving) {
      const was = props.panes.positionOf(k)!;
      dx = Math.max(-was.x, Math.min(dx, Math.max(0, box.width - slot.w) - was.x));
      dy = Math.max(-was.y, Math.min(dy, Math.max(0, box.height - slot.h) - was.y));
    }
    for (const k of moving) {
      const was = props.panes.positionOf(k)!;
      props.panes.placeAt(k, was.x + dx, was.y + dy);
    }
  };

  /** Rubber band: press the floor of the folder and drag a rectangle over the icons. */
  const startBand = (e: PointerEvent & { currentTarget: HTMLElement }) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    bandFrom = local(e.clientX, e.clientY);
    setPicked([]);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const dragBand = (e: PointerEvent) => {
    if (!bandFrom) return;
    const box = between(bandFrom, local(e.clientX, e.clientY));
    setBand(box);
    setPicked(keys().filter((k) => overlaps(box, props.panes.positionOf(k), props.panes.iconSlot())));
  };

  const endBand = () => {
    bandFrom = null;
    setBand(null);
  };

  /** The menu for the empty space: what can be done to the folder itself. */
  const folderMenu = (x: number, y: number) =>
    props.panes.menu(x, y, [
      { label: 'New Folder', onSelect: () => props.panes.newFolder(at()) },
      { separator: true },
      ...ARRANGEMENTS.map((order) => ({
        label: `Arrange Items ${order.name}`,
        onSelect: () => props.panes.arrangeIn(at(), order.id as Arrangement),
      })),
    ]);

  /**
   * The menu for one thing in here — the OS's own, which is the same menu the desktop
   * puts up for the same thing. Anything else would mean a file having two menus
   * depending on which window you happened to right-click it in.
   */
  const itemMenu = (x: number, y: number, key: string) =>
    props.panes.menu(x, y, props.panes.iconMenu(key, group(key)));

  /** What every icon in here needs, whatever kind of thing it is. */
  const common = (key: string, open: () => void) => ({
    home: at(),
    position: props.panes.positionOf(key) ?? { x: 8, y: 8 },
    selected: isPicked(key),
    renaming: props.panes.renaming() === key,
    onRenamed: (name: string | null) => props.panes.endRename(key, name),
    onRename: props.panes.renameable(key) ? () => props.panes.startRename(key) : undefined,
    onSelect: () => pick(key),
    onOpen: open,
    onMove: (x: number, y: number) => move(key, x, y),
    onDragOver: props.panes.hover,
    onDropOn: (onto: string) => props.panes.dropOn(group(key), onto),
    onContextMenu: (x: number, y: number) => itemMenu(x, y, key),
  });

  /** The same keys the desktop answers, for a selection nothing is focused on. */
  const onKey = (e: KeyboardEvent) => {
    // The icon under the keyboard has first refusal; this is for a selection made with
    // a rubber band, where nothing is focused for the key to land on.
    if (e.defaultPrevented) return;

    // The arrows walk between icons once one has the keyboard; this hands it over.
    if (arrows(e.key)) {
      e.preventDefault();
      enter(area);
      return;
    }

    const [only, ...rest] = picked();
    if (!only) return;

    if (e.key === 'F2') {
      if (rest.length || !props.panes.renameable(only)) return;
      e.preventDefault();
      props.panes.startRename(only);
    } else if (opens(e) && e.key !== ' ') {
      e.preventDefault();
      // A folder is walked into rather than opened, the same as double-clicking one.
      picked().forEach((key) =>
        props.panes.folderById(key) ? go(key) : props.panes.openIcon(key),
      );
    }
  };

  return (
    <div class="folder-pane" ref={pane} tabindex={0} autofocus onKeyDown={onKey}>
      <header class="folder-bar">
        <button
          class="chrome-button"
          aria-disabled={!above()}
          title={above() ? 'The folder this one is in' : 'This folder is on the desktop'}
          onClick={() => {
            const up = above();
            if (up) go(up);
          }}
        >
          ↑ Up
        </button>
        <span class="folder-where">
          {FOLDER_GLYPH} {folder()?.name ?? 'Gone'}
        </span>
        <span class="folder-count">{count() === 1 ? '1 item' : `${count()} items`}</span>
      </header>

      {/* The floor of the folder. `data-folder-area` is what a dragged icon reads off
          the DOM to know it is over an open window onto this folder. */}
      <div
        class="folder-items"
        classList={{ 'is-catching': catching() }}
        ref={area}
        data-folder-area={at()}
        onPointerDown={(e) => {
          // Clicking a button doesn't focus it on a Mac, so a press anywhere in here —
          // on an icon or on the floor — hands the keyboard to the window. Without it
          // the keys go on landing on the desktop, which has a selection of its own
          // and would happily rename something else entirely.
          pane.focus({ preventScroll: true });
          startBand(e);
        }}
        onPointerMove={dragBand}
        onPointerUp={endBand}
        onPointerCancel={endBand}
        onContextMenu={(e) => {
          e.preventDefault();
          endBand();
          folderMenu(e.clientX, e.clientY);
        }}
      >
        <For each={here().folders}>
          {(sub) => (
            <DesktopIcon
              label={sub.name}
              glyph={FOLDER_GLYPH}
              bare
              folderId={sub.id}
              dropTarget={props.panes.hovering() === sub.id}
              {...common(sub.id, () => go(sub.id))}
            />
          )}
        </For>

        {/* Apps between the folders and the files, as they are on the desktop. */}
        <For each={here().toys}>
          {(toy) => (
            <DesktopIcon
              label={toy.name}
              image={artwork(toy) && resolve(artwork(toy)!)}
              bare={!!toy.icon}
              disabled={!toy.href}
              {...common(toy.name, () => props.panes.openToyNamed(toy.name))}
            />
          )}
        </For>

        <For each={here().files}>
          {(file) => (
            <DesktopIcon
              label={file.name}
              {...artFor(file)}
              {...common(file.id, () => props.panes.openFileById(file.id))}
            />
          )}
        </For>

        <Show when={band()}>
          {(box) => (
            <div
              class="marquee is-dark"
              style={{
                left: `${box().x}px`,
                top: `${box().y}px`,
                width: `${box().w}px`,
                height: `${box().h}px`,
              }}
            />
          )}
        </Show>

        <Show when={!count()}>
          <p class="folder-empty">
            This folder is empty.
            <small>
              Drag something onto it, or onto this window, or right-click in here to make
              another folder.
            </small>
          </p>
        </Show>
      </div>

      {/*
        Where you are, how to get back, and somewhere to put things.
 
        Every step of the path carries `data-folder-area`, which is the same mark the
        floor of the window carries — so a dragged icon reads a step of the path as
        that folder and needs to know nothing about paths at all. The desktop is the
        root of it and takes a drop like the rest, but is not somewhere this window
        goes: an icon's position belongs to the place it is in, and the desktop's
        belong to the desktop.
      */}
      <footer class="folder-path">
        <span
          class="folder-root"
          classList={{ 'is-catching': props.panes.hovering() === DESKTOP_KEY }}
          data-folder-area={DESKTOP_KEY}
          title="Drop something here to put it on the desktop"
        >
          🖥️ Desktop
        </span>
        <For each={path()}>
          {(step, i) => (
            <>
              <span class="folder-sep" aria-hidden="true">
                /
              </span>
              <button
                class="folder-step"
                classList={{
                  'is-here': i() === path().length - 1,
                  'is-catching': props.panes.hovering() === step.id,
                }}
                data-folder-area={step.id}
                title={`Open ${step.name} in this window, or drop something here to move it there`}
                onClick={() => go(step.id)}
              >
                {step.name}
              </button>
            </>
          )}
        </For>
      </footer>
    </div>
  );
}
