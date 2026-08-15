import { For, Show } from 'solid-js';
import { BIN_GLYPH } from './App';
import { resolve, type Toy } from './toys';

type Props = {
  binned: Toy[];
  onRestore: (name: string) => void;
  onEmpty: () => void;
};

export function BinPane(props: Props) {
  return (
    <div class="bin-pane">
      <Show
        when={props.binned.length}
        fallback={
          <p class="bin-empty">
            <span class="bin-empty-glyph" aria-hidden="true">
              {BIN_GLYPH}
            </span>
            Recycle Bin is empty.
            <small>Drag a toy onto the bin to put it here.</small>
          </p>
        }
      >
        <ul class="bin-list">
          <For each={props.binned}>
            {(toy) => (
              <li class="bin-row">
                <Show
                  when={toy.image}
                  fallback={
                    <span class="bin-row-art" aria-hidden="true">
                      ★
                    </span>
                  }
                >
                  <img class="bin-row-art" src={resolve(toy.image!)} alt="" />
                </Show>
                <span class="bin-row-name">{toy.name}</span>
                <button class="chrome-button" onClick={() => props.onRestore(toy.name)}>
                  Put back
                </button>
              </li>
            )}
          </For>
        </ul>
        <footer class="bin-actions">
          <button class="chrome-button" onClick={props.onEmpty}>
            Empty Recycle Bin
          </button>
        </footer>
      </Show>
    </div>
  );
}
