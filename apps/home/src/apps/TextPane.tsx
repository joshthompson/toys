import { For } from 'solid-js';

/**
 * A window with something to read in it and nothing to do — the OS's about box.
 *
 * Any app can ask for one of these over postMessage, which saves every toy building
 * its own dialog for its rules or its credits: it hands over the words, and they come
 * out looking like everything else on this desktop.
 */
export function TextPane(props: { body: string; onClose: () => void }) {
  /** Blank lines start a new paragraph; single ones are kept inside it. */
  const paragraphs = () =>
    props.body
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);

  return (
    <div class="pane text-pane">
      <div class="text-body">
        <For each={paragraphs()}>{(para) => <p>{para}</p>}</For>
      </div>
      <footer class="text-actions">
        <button class="chrome-button" onClick={props.onClose}>
          OK
        </button>
      </footer>
    </div>
  );
}
