import { createResource, createSignal, onCleanup, Show } from 'solid-js';
import { formatBytes } from './files';
import type { Panes } from './shell';

type Props = {
  fileId: string;
  panes: Panes;
};

/** Typing pauses this long before the file is written back. */
const SAVE_AFTER_MS = 600;

/**
 * Josh's Computer Writing App — a text file, and a big box to write in.
 *
 * There's no Save: it writes itself back a moment after you stop typing, which is
 * what everyone expects of a notepad now even if it isn't what 1995 did.
 */
export function WritingPane(props: Props) {
  const [saved, setSaved] = createSignal(true);

  /**
   * The file's text, read once. Keyed on the id alone so that writing the file back —
   * which replaces the blob — can't re-fetch and pull the text out from under the
   * cursor mid-sentence.
   */
  const [text] = createResource(
    () => props.fileId,
    async (id) => (await props.panes.fileById(id)?.blob.text()) ?? '',
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));

  const edit = (value: string) => {
    setSaved(false);
    clearTimeout(timer);
    timer = setTimeout(() => {
      props.panes.saveText(props.fileId, value);
      setSaved(true);
    }, SAVE_AFTER_MS);
  };

  const file = () => props.panes.fileById(props.fileId);

  return (
    <div class="writing-pane">
      <Show
        when={!text.loading}
        fallback={<p class="writing-loading">Opening {file()?.name ?? 'the file'}…</p>}
      >
        <textarea
          class="writing-page"
          spellcheck={false}
          value={text() ?? ''}
          onInput={(e) => edit(e.currentTarget.value)}
          placeholder="Write something."
        />
      </Show>

      <footer class="writing-bar">
        <span class="writing-name">{file()?.name ?? 'Untitled'}</span>
        <span class="writing-status">
          <Show when={file()} fallback="Not on the desktop any more">
            {(f) => (
              <>
                {formatBytes(f().size)} — {saved() ? 'Saved' : 'Saving…'}
              </>
            )}
          </Show>
        </span>
      </footer>
    </div>
  );
}
