import { createEffect, createResource, createSignal, onMount, Show } from 'solid-js';
import { formatBytes } from '../os/files';
import { WRITING_APP, type Panes } from '../os/shell';
import type { Menu } from '../os/osApi';

type Props = {
  /** The file this window opened on, or nothing at all for a blank document. */
  fileId?: string;
  panes: Panes;
  /** The window is named after whichever file is open in it, so saving renames it. */
  onTitle: (title: string) => void;
  /** The File menu, drawn by the OS along the top of the window. */
  onMenus: (menus: () => Menu[], select: (id: string) => void) => void;
};

/** What the File menu offers, and what each one means. */
const FILE_MENU = {
  save: 'file:save',
  saveAs: 'file:save-as',
  load: 'file:load',
} as const;

/** What a new document is called if you don't call it anything. */
const UNNAMED = 'Untitled.txt';

/**
 * Josh's Computer Writing App — a text file, and a big box to write in.
 *
 * It saves when you tell it to and not before, and a document that has never been
 * saved is not a file: it is a window with some words in it and nothing on the desktop.
 * That is the older arrangement and the worse one by every modern measure, and it is
 * the one this computer keeps — a file here is a thing you can pick up and look at, and
 * something quietly writing one the moment you open a window would make it something
 * else entirely.
 *
 * What it costs is that the box can hold something no file does. So it says which of
 * the two you are looking at at all times, and it will not load another file over
 * unsaved work without asking first.
 */
export function WritingPane(props: Props) {
  /**
   * Two different questions, which is why they are two signals: `current` is the file
   * the box saves into, and `opened` is the file the box was filled from. Saving a new
   * document sets the first and not the second — the text is already on the screen, and
   * re-reading it would tear the page down and build it again under the cursor.
   */
  const [current, setCurrent] = createSignal(props.fileId);
  const [opened, setOpened] = createSignal(props.fileId);
  /** Whether the box and the file say the same thing. A blank page starts as itself. */
  const [clean, setClean] = createSignal(true);
  /** A file waiting on the question of what to do about unsaved changes. */
  const [pending, setPending] = createSignal<string | null>(null);

  /**
   * The file's text, read when the window lands on it. Keyed on the id alone, so that
   * writing the file back — which replaces the blob — can't re-fetch and pull the text
   * out from under the cursor mid-sentence. A blank document reads nothing.
   */
  const [text] = createResource(opened, async (id) => (await props.panes.fileById(id)?.blob.text()) ?? '');

  const file = () => {
    const id = current();
    return id ? props.panes.fileById(id) : undefined;
  };
  let page!: HTMLTextAreaElement;

  createEffect(() => {
    const named = file()?.name;
    if (named) props.onTitle(`${named} — ${WRITING_APP}`);
  });

  /** Into the file it came from — or, if it hasn't got one, wherever you say. */
  const save = () => {
    const id = current();
    if (!id || !props.panes.fileById(id)) return saveAs();
    props.panes.saveText(id, page.value);
    setClean(true);
  };

  /**
   * Somewhere new. The OS puts up its Save dialog and comes back with a name and the
   * folder to put it in; making the file out of those is this app's half of the job,
   * since only this app knows what is going in it.
   */
  const saveAs = () =>
    props.panes.saveFile(file()?.name ?? UNNAMED, (place) => {
      if (!place) return;
      const made = props.panes.saveNewText(place.name, page.value, place.folder);
      if (!made) return;
      // The file the box now belongs to — but not the file it is read from, since what
      // is on the screen is already exactly what has just been written.
      setCurrent(made);
      setClean(true);
    });

  /**
   * Load, which is the OS's Open dialog rather than anything this app draws. It says
   * it wants a text file and then waits: what comes back is a file or nothing at all,
   * and nothing at all is the answer whenever the dialog is cancelled or shut.
   */
  const browse = () =>
    props.panes.pickFile(['text'], (id) => {
      if (id) wants(id);
    });

  onMount(() =>
    props.onMenus(
      () => [
        {
          label: 'File',
          items: [
            { id: FILE_MENU.save, label: 'Save', disabled: clean() && !!current() },
            { id: FILE_MENU.saveAs, label: 'Save As…' },
            { separator: true },
            { id: FILE_MENU.load, label: 'Load…' },
          ],
        },
      ],
      (id) => {
        if (id === FILE_MENU.save) save();
        else if (id === FILE_MENU.saveAs) saveAs();
        else if (id === FILE_MENU.load) browse();
      },
    ),
  );

  /** Move the window onto another file, having settled what happens to this one. */
  const load = (id: string) => {
    setPending(null);
    if (id === current()) return;
    setCurrent(id);
    setOpened(id);
    setClean(true);
  };

  /** Asked for another file: straight there if there's nothing to lose, or the question. */
  const wants = (id: string) => (clean() ? load(id) : setPending(id));

  /**
   * The page isn't there when the window opens — it arrives with the file, by which
   * time the window has offered the keyboard round and found nobody in here to take
   * it. So it's taken up on the way in instead, unless something else has claimed it
   * meanwhile: opening a big file and clicking on another window while it reads is
   * not an invitation to have the keyboard snatched back.
   */
  const claim = (box: HTMLTextAreaElement) => {
    page = box;
    queueMicrotask(() => {
      const held = document.activeElement;
      // Nobody has it, or the only thing holding it is the window around this page.
      if (!held || held === document.body || held.contains(box)) {
        box.focus({ preventScroll: true });
      }
    });
  };

  return (
    <div class="writing-pane">
      <Show
        when={!text.loading}
        fallback={<p class="writing-loading">Opening {file()?.name ?? 'the file'}…</p>}
      >
        <textarea
          class="writing-page"
          autofocus
          ref={claim}
          spellcheck={false}
          value={text() ?? ''}
          onInput={() => setClean(false)}
          onKeyDown={(e) => {
            // The shortcut everybody's fingers already know.
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
              e.preventDefault();
              save();
            }
          }}
          placeholder="Write something."
        />
      </Show>

      {/* The other question it asks, and it only asks it about losing work. */}
      <Show when={pending()}>
        {(id) => (
          <p class="writing-ask">
            <span>{file()?.name ?? 'This document'} has changes you haven't saved.</span>
            <button
              class="chrome-button"
              onClick={() => {
                save();
                if (current()) load(id());
              }}
            >
              Save first
            </button>
            <button class="chrome-button" onClick={() => load(id())}>
              Discard
            </button>
            <button class="chrome-button" onClick={() => setPending(null)}>
              Cancel
            </button>
          </p>
        )}
      </Show>

      {/* Nothing to press down here: saving and loading are the File menu's, and a
          bar with its own buttons for them would be two places to look. */}
      <footer class="writing-bar">
        <span class="writing-name">{file()?.name ?? 'Untitled'}</span>
        <span class="writing-status">
          <Show when={file()} fallback={current() ? 'Not on the desktop any more' : 'Never saved'}>
            {(f) => (
              <>
                {formatBytes(f().size)} · {clean() ? 'Saved' : 'Not saved'}
              </>
            )}
          </Show>
        </span>
      </footer>
    </div>
  );
}
