import { createSignal, For } from 'solid-js';
import { RUN_GLYPH, type Panes } from '../os/shell';

/**
 * Run — type the name of a thing and the computer opens it.
 *
 * The Windows one offered to open "a program, folder, document, or Internet resource",
 * which was ambitious of it, and then mostly told you it couldn't find whatever you had
 * typed. This one has a smaller world to look in and so does rather better: the apps
 * under any name you might try, the toys, and anything sitting on the desktop.
 *
 * It closes itself when it finds something and stays open when it doesn't, which is
 * what you want either way — the second case is the one where you were going to type
 * again.
 */

/**
 * What has been typed into it, newest first, kept out here rather than in the window so
 * that closing the box and opening it again doesn't lose the list. Windows remembered
 * yours forever; this one remembers until the machine is reloaded, which given what it
 * is a machine for is long enough.
 */
const typedBefore: string[] = [];
const REMEMBERED = 12;

export function RunPane(props: { panes: Panes; onClose: () => void }) {
  const [typed, setTyped] = createSignal(typedBefore[0] ?? '');
  let field!: HTMLInputElement;

  const go = () => {
    const name = typed().trim();
    if (!name) return;

    // Kept whether it worked or not, the same as Windows kept it: half the use of the
    // list is getting back to the thing you typed wrong to see what you did to it.
    if (typedBefore[0] !== name) typedBefore.unshift(name);
    typedBefore.length = Math.min(typedBefore.length, REMEMBERED);

    if (props.panes.run(name)) return props.onClose();
    // It has said its piece in a window of its own by now. Leaving the text selected
    // makes typing over it the next thing that happens.
    field.select();
  };

  return (
    <div class="run-pane">
      <div class="run-blurb">
        <span class="run-art" aria-hidden="true">
          {RUN_GLYPH}
        </span>
        <p>Type the name of an app, a toy or a file, and Josh OS will open it for you.</p>
      </div>

      <label class="run-field">
        Open:
        <input
          ref={field}
          autofocus
          list="run-history"
          spellcheck={false}
          autocomplete="off"
          value={typed()}
          onInput={(e) => setTyped(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go();
            else if (e.key === 'Escape') props.onClose();
            else return;
            e.preventDefault();
          }}
        />
      </label>
      <datalist id="run-history">
        <For each={typedBefore}>{(was) => <option value={was} />}</For>
      </datalist>

      <footer class="run-bar">
        <button class="chrome-button" aria-disabled={!typed().trim()} onClick={go}>
          OK
        </button>
        <button class="chrome-button" onClick={props.onClose}>
          Cancel
        </button>
        <button
          class="chrome-button"
          onClick={() =>
            props.panes.showText(
              'Browse',
              "There's nothing to browse. Everything this computer has is on the desktop, in the bin, or in the Start menu, and you can see all three from here.",
            )
          }
        >
          Browse…
        </button>
      </footer>
    </div>
  );
}
