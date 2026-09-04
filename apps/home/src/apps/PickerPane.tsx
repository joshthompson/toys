import { createMemo, createSignal, For, Show } from 'solid-js';
import { FOLDER_GLYPH, glyphFor, type Panes } from '../os/shell';
import { formatBytes } from '../os/files';

type Props = { panes: Panes };

/**
 * The OS's file dialog, which opens and saves.
 *
 * The app that asked isn't here. It said what it wants — a file of some kind, or
 * somewhere to put one — and then went quiet, and it hears one thing back. Where you
 * look on the way to that answer is between you and this window, which is the whole
 * point of the dialog belonging to the computer rather than to the app.
 *
 * The two jobs are the same window because they are the same job: find the place, then
 * say which file. Only the answer differs — one that exists, or one that doesn't yet.
 */
export function PickerPane(props: Props) {
  const ask = () => props.panes.picking();
  const saving = () => ask()?.mode === 'save';

  /** Which folder is being looked in. Nothing means the desktop, where everything starts. */
  const [where, setWhere] = createSignal<string | undefined>(undefined);
  const [chosen, setChosen] = createSignal<string | null>(null);
  const [typed, setTyped] = createSignal('');

  // The suggested name, taken once when the dialog goes up rather than tracked, so that
  // it doesn't type over what somebody is in the middle of putting in the box.
  createMemo(() => {
    const asked = ask();
    if (asked?.mode === 'save') setTyped((was) => was || asked.suggested);
  })();

  const here = () => props.panes.itemsIn(where());
  const folders = () => here().folders;
  /** Only the kinds that were asked for, when any kinds were. */
  const files = () => {
    const asked = ask();
    const all = here().files;
    return asked?.mode === 'open' && asked.kinds
      ? all.filter((f) => asked.kinds!.includes(f.kind))
      : all;
  };

  /** A name already spoken for in this folder. Saving over one is not on offer. */
  const clashes = () => props.panes.namesIn(where()).includes(typed().trim());
  const ready = () => (saving() ? !!typed().trim() && !clashes() : !!chosen());

  /** What the dialog says it is for, in the corner where a status line goes. */
  const asking = () => {
    const asked = ask();
    if (!asked) return 'Nothing is waiting on this.';
    if (asked.mode === 'save') return 'Where shall it go?';
    return asked.kinds ? `${asked.kinds.join(', ')} files` : 'Any file';
  };

  const inside = (id?: string) => {
    setWhere(id);
    setChosen(null);
  };

  const settle = () => {
    if (!ready()) return;
    if (saving()) props.panes.settlePick({ name: typed().trim(), folder: where() });
    else props.panes.settlePick(chosen()!);
  };

  return (
    <div class="picker-pane">
      <header class="picker-bar">
        <span class="picker-label">{saving() ? 'Save in:' : 'Look in:'}</span>
        <span class="picker-where">
          {where() ? `${FOLDER_GLYPH} ${props.panes.folderById(where()!)?.name}` : '🖥️ Desktop'}
        </span>
        <button
          class="chrome-button"
          aria-disabled={!where()}
          title="Up one folder"
          onClick={() => inside(where() ? props.panes.holderOf(where()!) : undefined)}
        >
          ↑
        </button>
      </header>

      <div class="picker-list">
        <Show
          when={folders().length || files().length}
          fallback={
            <p class="picker-empty">
              {saving() ? 'Nothing in here yet.' : 'Nothing in here to open.'}
            </p>
          }
        >
          {/* Folders are never the answer — they're where the answer goes, or is. */}
          <For each={folders()}>
            {(folder) => (
              <button class="picker-row" onClick={() => inside(folder.id)}>
                <span class="picker-art" aria-hidden="true">
                  {FOLDER_GLYPH}
                </span>
                <span class="picker-name">{folder.name}</span>
                <span class="picker-size">Folder</span>
              </button>
            )}
          </For>

          <For each={files()}>
            {(file) => (
              <button
                class="picker-row"
                classList={{ 'is-chosen': !saving() && chosen() === file.id }}
                // Saving, a file in the list is a name to borrow rather than a thing to
                // pick: it is already taken, which the box below will say plainly.
                onClick={() => (saving() ? setTyped(file.name) : setChosen(file.id))}
                onDblClick={() => !saving() && props.panes.settlePick(file.id)}
              >
                <span class="picker-art" aria-hidden="true">
                  {glyphFor(file.kind)}
                </span>
                <span class="picker-name">{file.name}</span>
                <span class="picker-size">{formatBytes(file.size)}</span>
              </button>
            )}
          </For>
        </Show>
      </div>

      <Show when={saving()}>
        <label class="picker-field">
          File name:
          <input
            autofocus
            spellcheck={false}
            value={typed()}
            onInput={(e) => setTyped(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') settle();
              else if (e.key === 'Escape') props.panes.settlePick(null);
              else return;
              e.preventDefault();
            }}
          />
        </label>
      </Show>

      <footer class="picker-actions">
        <span class="picker-asked">
          <Show
            when={clashes()}
            fallback={asking()}
          >
            <span class="picker-clash">There's already a {typed().trim()} in here.</span>
          </Show>
        </span>
        <button class="chrome-button" aria-disabled={!ready()} onClick={settle}>
          {saving() ? 'Save' : 'Open'}
        </button>
        <button class="chrome-button" onClick={() => props.panes.settlePick(null)}>
          Cancel
        </button>
      </footer>
    </div>
  );
}
