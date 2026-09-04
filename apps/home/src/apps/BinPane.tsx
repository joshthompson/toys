import { For, Show } from 'solid-js';
import { BIN_GLYPH, binName, glyphFor, type Panes } from '../os/shell';
import { resolve, artwork } from '../os/toys';

type Props = {
  depth: number;
  panes: Panes;
};

export function BinPane(props: Props) {
  const level = () => props.panes.binLevels()[props.depth];
  /** Every bin below the top one holds the previous bin, plus whatever was dropped on it. */
  const nested = () => props.depth > 0;
  /** Binned toys and files, plus the nested bin if there is one. */
  const count = () => level().toys.length + level().files.length + (nested() ? 1 : 0);
  const isEmpty = () => !count();
  /** Emptying a bin destroys the files in it outright, so say so before it's clicked. */
  const emptyable = () => level().toys.length + level().files.length > 0;

  return (
    <div class="bin-pane">
      <Show
        when={!isEmpty()}
        fallback={
          <p class="bin-empty">
            <span class="bin-empty-glyph" aria-hidden="true">
              {BIN_GLYPH}
            </span>
            {binName(props.depth)} is empty.
            <small>Drag a toy or a file onto the bin, or right-click one and pick Delete.</small>
          </p>
        }
      >
        <ul class="bin-list">
          <Show when={nested()}>
            <li class="bin-row is-bin">
              <span class="bin-row-art is-glyph" aria-hidden="true">
                {BIN_GLYPH}
              </span>
              <span class="bin-row-name">{binName(props.depth - 1)}</span>
              <button
                class="chrome-button"
                onClick={() => props.panes.openBin(props.depth - 1)}
              >
                Open
              </button>
            </li>
          </Show>

          <For each={level().toys}>
            {(toy) => (
              <li class="bin-row">
                <Show
                  when={artwork(toy)}
                  fallback={
                    <span class="bin-row-art is-glyph" aria-hidden="true">
                      ★
                    </span>
                  }
                >
                  <img class="bin-row-art" classList={{ 'is-bare': !!toy.icon }} src={resolve(artwork(toy)!)} alt="" />
                </Show>
                <span class="bin-row-name">{toy.name}</span>
                <button class="chrome-button" onClick={() => props.panes.restore(toy.name)}>
                  Put back
                </button>
              </li>
            )}
          </For>

          <For each={level().files}>
            {(file) => (
              <li class="bin-row">
                <Show
                  when={file.kind === 'image'}
                  fallback={
                    <span class="bin-row-art is-glyph" aria-hidden="true">
                      {glyphFor(file.kind)}
                    </span>
                  }
                >
                  <img class="bin-row-art" src={file.url} alt="" />
                </Show>
                <span class="bin-row-name">{file.name}</span>
                <button class="chrome-button" onClick={() => props.panes.restoreFile(file.id)}>
                  Put back
                </button>
              </li>
            )}
          </For>
        </ul>

        <footer class="bin-actions">
          <span class="bin-status">
            {count()} item{count() === 1 ? '' : 's'}
          </span>
          <button
            class="chrome-button"
            title={level().files.length ? 'Deletes the files in here for good' : undefined}
            aria-disabled={!emptyable()}
            onClick={() => emptyable() && props.panes.emptyLevel(props.depth)}
          >
            Empty
          </button>
        </footer>
      </Show>
    </div>
  );
}
